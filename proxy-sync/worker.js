/*
 * pj_price 販売連携 フェイズA（Cloudflare Worker「pj-sync」）
 * ------------------------------------------------------------
 * 目的: Amazon（FBA）と eBay の状況を定期的に取り込んでD1に貯め、
 *       食い違いや売れた事実を検出して Discord に通知する。**見える化だけ**。
 *
 * フェイズAでは Amazon・eBay へ書き込み操作を一切しない。
 * それを機械的に守るため、外へ出る通信はすべて net() を通し、
 * 読み取り専用の許可表（ALLOWED）に無いURL・メソッド・API呼び出し名は
 * 実行時に例外にしている（仕様10章のレビュー項目をコード側で担保する）。
 *
 * 突き合わせ: 「ASIN＋新品/中古」を主キーにする。
 *   Amazonの出品SKU（＝せどりすとSKU）: hobby-20260925-UG-B09TPBVJ5F-2000
 *   eBayのCustomLabel: FBA連動は E-<ASIN>[-U]、それ以外はせどりすとSKUそのまま
 *   どちらからでもASINと新品/中古が取り出せる。
 *
 * Secrets / バインディング（値はリポジトリに書かない。wrangler secret put で登録）:
 *   PJ_ACCESS_KEY            … pj_price から送る共有キー（ヘッダー X-PJ-Key）
 *   LWA_CLIENT_ID / LWA_CLIENT_SECRET / SPAPI_REFRESH_TOKEN_FE
 *   EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_USER_REFRESH_TOKEN
 *   DISCORD_WEBHOOK_URL
 *   D1 DB / KV SYNC_CACHE
 *
 * エンドポイント（読み取りとpj_priceからの登録のみ）:
 *   GET  /status    … 一覧。既定は scope=ebay の行だけ
 *   GET  /runs      … 直近の実行ログ（sync_runs）
 *   POST /listings  … pj_price から名簿（SKU・モード・ItemID等）を登録
 *   POST /sync      … 手動実行（kind: orders / inventory / rollcall / sweep / pricing / notify）
 */

const ALLOW_ORIGIN = "https://gamegamesan-dot.github.io";
const MP_FE = "A1VC38T7YXB528";                      // amazon.co.jp
const SP_HOST = "https://sellingpartnerapi-fe.amazon.com";
const EBAY_API = "https://api.ebay.com";

/* SP-APIの呼び出し間隔。Amazonの上限はAPIごとに違うので別々に持つ。
   getOrderItems は 0.5回/秒（＝2秒に1回）なので 2.1秒あける。
   getItemOffersBatch は 0.1回/秒なので 10.5秒。getOrders は回数が少ないので1秒。 */
const SP_GAP = {
  getOrders: 1000,
  getOrderItems: 2100,
  getInventorySummaries: 600,
  getItemOffersBatch: 10500,
};
const SP_GAP_DEFAULT = 700;
const SP_RETRY = 3;                // QuotaExceeded の再試行回数
const SP_BACKOFF = [700, 1500, 3000];

const ORDERS_LOOKBACK_MS = 36 * 60 * 60 * 1000;   // 初回の注文取り込みは36時間前から
const ORDERS_FIRST_DAYS = 7;                      // ?days= を付けたときの上限（受け入れテスト用）
const INV_LOOKBACK_MS = 3 * 60 * 60 * 1000;       // 初回の在庫差分は3時間前から
const ROLLCALL_BATCH = 50;         // getInventorySummaries の sellerSkus は1回50件まで
const ROLLCALL_MAX_CALLS = 40;     // 1回の実行で名指し照会する上限（50×40＝2000SKU）
const SWEEP_PAGES = 20;            // 全件スイープで1回に進めるページ数
const PRICING_BATCH = 20;          // getItemOffersBatch は1回20件まで
const PRICING_MAX_CALLS = 6;       // 0.1回/秒なので1回の実行では6回（120件）まで
/* GetMyeBaySelling の1ページ件数。OutputSelector を外して全項目を受けるので、
   1回の応答が大きくなりすぎないよう200→100にしてある（解析のCPUも半分になる）。 */
const EBAY_PAGE = 100;
const EBAY_MAX_PAGES = 30;
const DAILY_UTC_HOUR = 18;         // JST 3時台に日次処理を回す
const ITEMS_PER_RUN = 25;          // 1回の実行で明細を取る注文の数（2.1秒×25＝約53秒）
const ITEMS_PER_RUN_MAX = 120;     // 手動実行で増やせる上限
const ITEMS_DEADLINE_MS = 240000;  // 明細取得に使う時間の上限（これを越えたら次回へ回す）
const D1_MAX_KEYS = 40;            // 1命令のバインド変数上限（100）に収まる件数（40件＝80個）
const NOTIFY_MAX = 1800;           // Discord の1通の文字数上限に対する余裕

/* pj_price の CSV_PREFIX と同じ表。eBayに出すカテゴリだけ 'ebay'。 */
const PREFIX_SCOPE = {
  game: "ebay", hobby: "ebay", toy: "ebay",
  dvd: "out", cd: "out", book: "out", software: "out", pc: "out",
  electronics: "out", kitchen: "out", diy: "out", musicInst: "out",
};
/* 販売経路（SalesChannel）の区分。
   Amazon.co.jp … 実際の売上。FBA_SOLD の対象。
   Non-Amazon   … Amazon側が作る返送・取り寄せ（長期保管在庫の自動返送、
                  販売不可在庫の返送）と、自分が作るMCF注文が混ざる。
                  自分のMCFは出品者注文IDを "PJ-" で始める方針にして区別する
                  （フェイズCで使う。フェイズAでは作らない）。 */
const SALES_CH_AMAZON = "Amazon.co.jp";
const MCF_PREFIX = "PJ-";
/* 売れていない状態。FBA_SOLD にしない（eBayの数量を触る話につながるため）。 */
const DEAD_STATUS = /^(Canceled|Unfulfillable)$/i;
function orderKind(salesChannel, sellerOrderId) {
  const ch = String(salesChannel || "");
  if (!ch || ch === SALES_CH_AMAZON) return "sale";
  return String(sellerOrderId || "").indexOf(MCF_PREFIX) === 0 ? "mcf" : "removal";
}

/* せどりすとの状態コード。N だけが新品。 */
const COND_CODES = { N: "new", UM: "used", UVG: "used", UG: "used", UA: "used", UKN: "used" };

/* ---- 読み取り専用の許可表 ----
   ここに無い通信は net() が例外にする。書き込み系APIを足すには、この表を
   変えるしかない形にしてある（フェイズBでの変更が目に見えるように）。 */
const EBAY_READ_CALLS = ["GetMyeBaySelling"];
const ALLOWED = [
  { m: "POST", re: /^https:\/\/api\.amazon\.com\/auth\/o2\/token$/ },
  { m: "GET",  re: /^https:\/\/sellingpartnerapi-fe\.amazon\.com\/orders\/v0\/orders(\/|\?)/ },
  { m: "GET",  re: /^https:\/\/sellingpartnerapi-fe\.amazon\.com\/fba\/inventory\/v1\/summaries\?/ },
  // 価格の照会。読み取りだがPOSTしか用意されていないAPI。
  { m: "POST", re: /^https:\/\/sellingpartnerapi-fe\.amazon\.com\/batches\/products\/pricing\/v0\/itemOffers$/ },
  { m: "POST", re: /^https:\/\/api\.ebay\.com\/identity\/v1\/oauth2\/token$/ },
  { m: "GET",  re: /^https:\/\/api\.ebay\.com\/sell\/fulfillment\/v1\/order\?/ },
  // Trading API。X-EBAY-API-CALL-NAME が読み取り呼び出しのときだけ通す。
  { m: "POST", re: /^https:\/\/api\.ebay\.com\/ws\/api\.dll$/, calls: EBAY_READ_CALLS },
  { m: "POST", re: /^https:\/\/discord(app)?\.com\/api\/webhooks\// },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-pj-key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (origin === ALLOW_ORIGIN) h["Access-Control-Allow-Origin"] = ALLOW_ORIGIN;
  return h;
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}
// X-PJ-Key を定数時間で照合する（pj-title と同じ方式）
function authorized(request, env) {
  if (!env.PJ_ACCESS_KEY) return false;
  const a = request.headers.get("X-PJ-Key") || "";
  const b = env.PJ_ACCESS_KEY;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---- 実行ログの入れもの ----
   CPU時間は測れないので、数えられるものだけ持つ。 */
function newRun(kind) {
  return { kind, startedAt: nowIso(), t0: Date.now(),
           subrequests: 0, pages: 0, skus: 0, rows: 0, events: 0, errors: 0, notes: [] };
}
async function saveRun(env, run) {
  const ms = Date.now() - run.t0;
  try {
    await env.DB.prepare(
      `INSERT INTO sync_runs (kind, started_at, finished_at, elapsed_ms, subrequests,
         pages, skus, rows_written, events, errors, note)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`
    ).bind(run.kind, run.startedAt, nowIso(), ms, run.subrequests,
           run.pages, run.skus, run.rows, run.events, run.errors,
           run.notes.join(" / ").slice(0, 2000)).run();
  } catch (e) { /* ログの失敗で本処理を落とさない */ }
  return { kind: run.kind, elapsed_ms: ms, subrequests: run.subrequests, pages: run.pages,
           skus: run.skus, rows_written: run.rows, events: run.events, errors: run.errors,
           note: run.notes.join(" / ") };
}

/* ---- 外向きの通信。許可表に無ければ例外 ---- */
function assertReadOnly(url, method, headers) {
  const m = String(method || "GET").toUpperCase();
  for (const a of ALLOWED) {
    if (a.m !== m || !a.re.test(url)) continue;
    if (a.calls) {
      const call = (headers && (headers["X-EBAY-API-CALL-NAME"] || headers["x-ebay-api-call-name"])) || "";
      if (a.calls.indexOf(call) < 0) break;
    }
    return;
  }
  throw new Error("blocked_by_readonly_guard " + m + " " + url.split("?")[0]);
}
async function net(run, url, init) {
  const opt = init || {};
  assertReadOnly(url, opt.method || "GET", opt.headers);
  run.subrequests++;
  return fetch(url, opt);
}

/* ---- SKU の解析 ----
   カテゴリ-仕入日-状態コード-ASIN-仕入原価。形が違うものは scope='unknown'。 */
function parseSku(sku) {
  const s = String(sku || "").trim();
  const m = /^([A-Za-z]+)-(\d{8})-([A-Z]{1,3})-(B[0-9A-Z]{9})-(\d+)$/.exec(s);
  if (!m) return { sku: s, ok: false, scope: "unknown", asin: "", cond: "", condCode: "",
                   prefix: "", purchasedOn: "", cost: null };
  const [, prefix, ymd, code, asin, cost] = m;
  return {
    sku: s, ok: true, prefix,
    scope: PREFIX_SCOPE[prefix] || "unknown",
    asin, condCode: code, cond: COND_CODES[code] || "used",
    purchasedOn: ymd.slice(0, 4) + "-" + ymd.slice(4, 6) + "-" + ymd.slice(6, 8),
    cost: Number(cost),
  };
}
/* eBayのCustomLabel から ASIN＋新品/中古を取り出す。
   E-<ASIN> / E-<ASIN>-U（FBA連動）、M-<ASIN> / M-<ASIN>-U（無在庫）、
   せどりすとSKUそのまま（一点物）のいずれにも対応する。
   M- は E- と同じく ASIN＋新品/中古で照合し、あわせて無在庫の印を立てる。 */
function parseLabel(label) {
  const s = String(label || "").trim();
  let m = /^([EM])-(B[0-9A-Z]{9})(-U)?$/i.exec(s);
  if (m) {
    const drop = m[1].toUpperCase() === "M";
    return { ok: true, asin: m[2].toUpperCase(), cond: m[3] ? "used" : "new",
             scope: "ebay", from: drop ? "dropship" : "stable", dropship: drop };
  }
  const p = parseSku(s);
  if (p.ok) return { ok: true, asin: p.asin, cond: p.cond, scope: p.scope, from: "sedori" };
  return { ok: false, asin: "", cond: "", scope: "unknown", from: "" };
}

/* ---- Amazon SP-API ---- */
/* APIごとに待ち行列を持つ。ある API を待っている間に別の API を止めない。 */
const spLanes = {};
function spSlot(label) {
  const gap = SP_GAP[label] || SP_GAP_DEFAULT;
  const lane = spLanes[label] || (spLanes[label] = { chain: Promise.resolve(), last: 0 });
  lane.chain = lane.chain.then(async () => {
    const wait = lane.last + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lane.last = Date.now();
  }).catch(() => {});
  return lane.chain;
}
const isQuota = (status, body) =>
  status === 429 || /QuotaExceeded|TooManyRequests/i.test(String(body || ""));
/* SP-APIのエラー本文を読めるようにする。原因が分からないと直せないため、
   errors[].code / message / details を note に出す（購入者情報は含まれない）。 */
function spErr(text) {
  try {
    const d = JSON.parse(text || "{}");
    const e = (d && d.errors) || [];
    if (e.length)
      return e.map((x) => [x.code, x.message, x.details].filter(Boolean).join(": "))
              .join(" | ").slice(0, 400);
  } catch (err) { /* JSONでなければ生の文字列を少しだけ出す */ }
  return String(text || "").replace(/\s+/g, " ").slice(0, 200);
}

async function lwaToken(env, run) {
  const key = "lwa:fe";
  const cached = await env.SYNC_CACHE.get(key);
  if (cached) return cached;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.SPAPI_REFRESH_TOKEN_FE,
    client_id: env.LWA_CLIENT_ID,
    client_secret: env.LWA_CLIENT_SECRET,
  });
  const resp = await net(run, "https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error("lwa_" + resp.status);
  const d = await resp.json();
  const ttl = Math.max(60, (d.expires_in || 3600) - 300);
  await env.SYNC_CACHE.put(key, d.access_token, { expirationTtl: ttl });
  return d.access_token;
}

/* SP-API を叩く。上限（429/QuotaExceeded）は待って再試行する。
   戻りは { ok, status, data, quota }。生の応答は返さない（必要な項目だけ上位で取る）。 */
async function spCall(env, run, path, opt) {
  const o = opt || {};
  const token = await lwaToken(env, run);
  const url = SP_HOST + path;
  const headers = { "x-amz-access-token": token, "accept": "application/json" };
  if (o.body) headers["content-type"] = "application/json";
  for (let i = 0; i <= SP_RETRY; i++) {
    await spSlot(o.label);
    let resp, text = "";
    try {
      resp = await net(run, url, { method: o.method || "GET", headers, body: o.body });
      text = await resp.text();
    } catch (e) {
      run.errors++; run.notes.push(o.label + "_error " + e.message);
      return { ok: false, status: 0, data: null, quota: false, err: e.message };
    }
    if (resp.ok) {
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
      return { ok: true, status: resp.status, data, quota: false };
    }
    if (isQuota(resp.status, text) && i < SP_RETRY) {
      run.notes.push(o.label + " " + resp.status + " 上限。" + SP_BACKOFF[i] + "ms待って再試行");
      await sleep(SP_BACKOFF[i]);
      continue;
    }
    const emsg = spErr(text);
    run.errors++;
    run.notes.push(o.label + " -> " + resp.status + " " + emsg);
    return { ok: false, status: resp.status, data: null,
             quota: isQuota(resp.status, text), err: emsg };
  }
  return { ok: false, status: 429, data: null, quota: true, err: "quota" };
}

/* FBAの注文（AFN）。LastUpdatedAfter 以降の差分。購入者情報は要求しない
   （PIIロールを持たないので Amazon 側も返さない）。 */
async function amazonOrders(env, run, sinceIso) {
  const out = [];
  let token = "";
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ MarketplaceIds: MP_FE, FulfillmentChannels: "AFN" });
    if (token) q.set("NextToken", token); else q.set("LastUpdatedAfter", sinceIso);
    const r = await spCall(env, run, "/orders/v0/orders?" + q.toString(), { label: "getOrders" });
    if (!r.ok) return { orders: out, ok: false };
    run.pages++;
    const p = (r.data && r.data.payload) || {};
    for (const o of p.Orders || []) {
      const ch = String(o.SalesChannel || "");
      const soid = String(o.SellerOrderId || "");
      out.push({
        orderId: String(o.AmazonOrderId || ""),
        status: String(o.OrderStatus || ""),
        at: String(o.PurchaseDate || ""),
        channel: ch,
        sellerOrderId: soid,
        kind: orderKind(ch, soid),
      });
    }
    token = p.NextToken || "";
    if (!token) break;
  }
  return { orders: out, ok: true };
}
/* 注文明細。SKU・数量・金額だけ取る。
   呼び出し上限（0.5回/秒）に当たりやすいので、失敗は ok:false で返し、
   呼び出し側が待ち行列に残して次回やり直す。 */
async function amazonOrderItems(env, run, orderId) {
  const lines = [];
  let token = "";
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams();
    if (token) q.set("NextToken", token);
    const path = "/orders/v0/orders/" + encodeURIComponent(orderId) + "/orderItems"
      + (q.toString() ? "?" + q.toString() : "?");
    const r = await spCall(env, run, path, { label: "getOrderItems" });
    if (!r.ok) return { lines, ok: false };
    const p = (r.data && r.data.payload) || {};
    for (const it of p.OrderItems || []) {
      lines.push({
        lineId: String(it.OrderItemId || ""),
        sku: String(it.SellerSKU || ""),
        asin: String(it.ASIN || ""),
        qty: Number(it.QuantityOrdered || 0),
        amount: Number((it.ItemPrice && it.ItemPrice.Amount) || 0),
        currency: String((it.ItemPrice && it.ItemPrice.CurrencyCode) || "JPY"),
      });
    }
    token = p.NextToken || "";
    if (!token) break;
  }
  return { lines, ok: true };
}

/* FBA在庫。mode によって引数を変える。
   'since'   … startDateTime で差分だけ（入庫中の数量変化は検出されない点に注意）
   'skus'    … sellerSkus で名指し（1回50件まで）
   'sweep'   … 全件。nextToken を返し、呼び出し側がD1に保存して続きから進める */
/* ISO8601。ミリ秒を含めない形にする（SP-APIが受ける形を揃える）。 */
function isoSec(v) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
function invQuery(mode, arg) {
  const q = new URLSearchParams({
    details: "true", granularityType: "Marketplace", granularityId: MP_FE, marketplaceIds: MP_FE,
  });
  if (mode === "since") q.set("startDateTime", isoSec(arg));
  // リスト引数はカンマ区切りで渡す（同じ名前を繰り返すと 400 になる）
  else if (mode === "skus") q.set("sellerSkus", arg.join(","));
  else if (mode === "token" && arg) q.set("nextToken", arg);
  // mode === "all" は絞り込みなし（1ページ目だけ取る切り分け用）
  return q;
}
function invRow(s) {
  const d = s.inventoryDetails || {};
  return {
    sku: String(s.sellerSku || ""),
    asin: String(s.asin || ""),
    title: String(s.productName || ""),
    available: Number(d.fulfillableQuantity || 0),
    inbound: Number(d.inboundWorkingQuantity || 0) + Number(d.inboundShippedQuantity || 0)
             + Number(d.inboundReceivingQuantity || 0),
    reserved: Number((d.reservedQuantity && d.reservedQuantity.totalReservedQuantity) || 0),
  };
}
const BAD_TOKEN = /nextToken/i;
/* mode … 'since'（startDateTime の差分）/ 'skus'（名指し）/ 'all'（絞り込みなし）
   startToken … 続きから読むときの nextToken（D1に保存したもの）

   nextToken で続きを読むときも、**1ページ目と同じ絞り込みを必ず付ける**。
   付けないと 400「Invalid nextToken for the request, add startDateTime and try again」
   になる（2026-09-30 の受け入れテストで判明）。
   保存しておいたトークンが古くて無効なときは、破棄して1ページ目から読み直す。 */
async function fbaInventory(env, run, mode, arg, maxPages, startToken) {
  const base = invQuery(mode, arg);          // 1ページ目の絞り込み。以降も同じものを使う
  const rows = [];
  let token = String(startToken || "");
  let fallback = false, restarted = false, tries = 0;
  for (let page = 0; page < (maxPages || 1); page++) {
    const q = new URLSearchParams(base);
    if (token) q.set("nextToken", token);
    let r = await spCall(env, run, "/fba/inventory/v1/summaries?" + q.toString(),
                         { label: "getInventorySummaries" });
    /* 無効なトークンだったら捨てて1ページ目から読み直す（1回だけ） */
    if (!r.ok && r.status === 400 && token && BAD_TOKEN.test(String(r.err || "")) && !restarted) {
      restarted = true;
      token = "";
      run.notes.push("nextToken が無効なので1ページ目から読み直す");
      const q2 = new URLSearchParams(base);
      r = await spCall(env, run, "/fba/inventory/v1/summaries?" + q2.toString(),
                       { label: "getInventorySummaries" });
    }
    /* それでも400なら、startDateTime を外して1ページだけ試して原因を切り分ける。
       この回は1ページしか見ていないので差分の基準時刻は進めない。 */
    if (!r.ok && r.status === 400 && !token && mode === "since" && tries === 0) {
      tries++;
      const q3 = invQuery("all", null);
      run.notes.push("startDateTime を外して再試行");
      r = await spCall(env, run, "/fba/inventory/v1/summaries?" + q3.toString(),
                       { label: "getInventorySummaries" });
      if (r.ok) { fallback = true; run.notes.push("→ 通った（原因は startDateTime）"); }
    }
    if (!r.ok) return { rows, next: "", ok: false, fallback, restarted };
    run.pages++;
    const p = (r.data && r.data.payload) || {};
    for (const s of p.inventorySummaries || []) rows.push(invRow(s));
    token = (r.data && r.data.pagination && r.data.pagination.nextToken) || "";
    if (!token || fallback) break;
  }
  run.skus += rows.length;
  return { rows, next: token, ok: true, fallback, restarted };
}

/* Amazon最安値（参考表示用）。読み取りだがPOSTしか無いAPI。
   **新品の出品には新品の最安値、中古の出品には中古の最安値**を使う。
   条件は要求にも付けるが、**結果の振り分けは返ってきた要求（res.request）を正とする**。
   応答に条件が入っていないときに新品扱いで書くと、中古の値段を新品の行に入れて
   しまうので、振り分けられない結果は捨てる。
   あわせて、最安値と同じ値段の出品者数と、見えている出品件数も返す。 */
function landed(o) {
  return Number((o.ListingPrice && o.ListingPrice.Amount) || 0)
       + Number((o.Shipping && o.Shipping.Amount) || 0);
}
/* 出品1件の状態（非常に良い／良い／可 など）を取り出す。
   SP-APIの綴りが SubCondition / subCondition のどちらで返るか実データで確定できて
   いないので、**状態を表しそうなキーを総当たりで探す**。
   ConditionNotes（自由記述）は拾わない。 */
const COND_KEY = /^(sub[_-]?condition|condition)$/i;
const COND_VAL = /^(new|mint|verygood|very[_ -]?good|good|acceptable|refurbished|club|oem|used|collectible)$/i;
function subCondOf(o) {
  if (!o || typeof o !== "object") return "";
  for (const k of Object.keys(o)) {
    if (!COND_KEY.test(k)) continue;
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  // キー名が想定外でも、値が状態の語そのものなら拾う
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === "string" && COND_VAL.test(v.trim())) return v.trim();
  }
  return "";
}
function condOf(v) {
  const t = String(v || "").trim();
  if (!t) return "";
  // New 以外（Used / Collectible / Refurbished …）は中古側として扱う
  return /^new$/i.test(t) ? "new" : "used";
}
async function amazonLowest(env, run, keys) {
  const out = {};
  let skipped = 0, noCond = 0;
  for (let i = 0; i < keys.length && i / PRICING_BATCH < PRICING_MAX_CALLS; i += PRICING_BATCH) {
    const part = keys.slice(i, i + PRICING_BATCH);
    const body = JSON.stringify({
      requests: part.map((k) => ({
        uri: "/products/pricing/v0/items/" + k.asin + "/offers",
        method: "GET",
        MarketplaceId: MP_FE,
        ItemCondition: k.cond === "new" ? "New" : "Used",
        CustomerType: "Consumer",
      })),
    });
    const r = await spCall(env, run, "/batches/products/pricing/v0/itemOffers",
                           { method: "POST", body, label: "getItemOffersBatch" });
    if (!r.ok) continue;
    for (const res of (r.data && r.data.responses) || []) {
      const req = res.request || {};
      const p = (res.body && res.body.payload) || {};
      // ASINは返ってきた要求のURIから読む（応答に入っていないことがある）
      const m = /\/items\/([A-Z0-9]{10})\/offers/.exec(String(req.uri || ""));
      const asin = m ? m[1] : String(p.ASIN || (p.Identifier && p.Identifier.ASIN) || "");
      const cond = condOf(req.ItemCondition) || condOf(p.ItemCondition)
                || condOf(p.Identifier && p.Identifier.ItemCondition);
      if (!asin || !cond) { skipped++; continue; }
      /* 出品の「値段（本体＋送料）」と「状態」をそのまま持ち帰る。
         許容差額の中に何人いるか、「可」だけかどうかの判定は pj_price 側で行う
         （しきい値が設定で変わるものを Worker に焼き付けない）。 */
      const offers = [];
      for (const o of p.Offers || []) {
        /* 出品ごとに状態が分かるときは、要求した条件と違うものを混ぜない。
           分からなければ要求で絞れているものとして扱う。 */
        const sub = subCondOf(o);
        const oc = condOf(sub);
        if (oc && oc !== cond) continue;
        const v = landed(o);
        if (v > 0) offers.push({ p: Math.round(v), c: sub });
      }
      if (!offers.length) continue;
      if (!offers.some(function (o) { return o.c; })) noCond++;
      offers.sort(function (a, b) { return a.p - b.p; });
      const vals = offers.map(function (o) { return o.p; });
      const low = vals[0];
      const lowN = vals.filter(function (v) { return v <= low + 0.01; }).length;
      const total = Math.max(vals.length,
        Number((p.Summary && p.Summary.TotalOfferCount) || 0));
      out[asin + "|" + cond] = { low: low, lowN: lowN, total: total,
                                 offers: offers.slice(0, 10) };
    }
  }
  if (skipped) run.notes.push("最安値：条件が分からない結果 " + skipped + "件は使わなかった");
  if (noCond) run.notes.push("最安値：出品の状態が取れない商品 " + noCond + "件");
  return out;
}

/* ---- eBay ---- */
// ユーザートークン（認可コード方式のリフレッシュトークンから）。KVに短時間だけ置く。
async function ebayToken(env, run) {
  const key = "ebay:user";
  const cached = await env.SYNC_CACHE.get(key);
  if (cached) return cached;
  const basic = btoa(env.EBAY_CLIENT_ID + ":" + env.EBAY_CLIENT_SECRET);
  const resp = await net(run, EBAY_API + "/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded",
               "authorization": "Basic " + basic },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.EBAY_USER_REFRESH_TOKEN,
    }).toString(),
  });
  const text = await resp.text();
  if (!resp.ok) {
    // リフレッシュトークンは18か月で失効する。切れたら通知で気づけるようにする。
    throw new Error("ebay_token_" + resp.status + (/invalid_grant/.test(text)
      ? "（EBAY_USER_REFRESH_TOKEN が失効。再同意が必要）" : ""));
  }
  const d = JSON.parse(text);
  const ttl = Math.max(60, (d.expires_in || 7200) - 300);
  await env.SYNC_CACHE.put(key, d.access_token, { expirationTtl: ttl });
  return d.access_token;
}

/* 注文（Sell Fulfillment）。保存するのは注文ID・SKU・数量・金額・日時・状態だけ。
   応答には購入者の氏名・住所が含まれるが、ここで取り出さないので後段へ渡らない。 */
async function ebayOrders(env, run, sinceIso) {
  const token = await ebayToken(env, run);
  const out = [];
  let offset = 0;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({
      filter: "lastmodifieddate:[" + sinceIso + "..]",
      limit: "50", offset: String(offset),
    });
    const resp = await net(run, EBAY_API + "/sell/fulfillment/v1/order?" + q.toString(), {
      headers: { authorization: "Bearer " + token, accept: "application/json" },
    });
    if (!resp.ok) {
      run.errors++; run.notes.push("ebay_getOrders -> " + resp.status);
      return { orders: out, ok: false };
    }
    run.pages++;
    const d = await resp.json();
    for (const o of d.orders || []) {
      const lines = [];
      for (const li of o.lineItems || []) {
        lines.push({
          lineId: String(li.lineItemId || ""),
          sku: String(li.sku || ""),
          /* 出品のタイトル（商品名）。SKUが無い出品の通知に使う。
             購入者の情報（氏名・住所・連絡先）は読まない・持たない。 */
          title: String(li.title || "").slice(0, 120),
          qty: Number(li.quantity || 0),
          amount: Number((li.total && li.total.value) || 0),
          currency: String((li.total && li.total.currency) || "USD"),
          /* ハンドリング期限（この日までに発送する）。無在庫の「要仕入れ」通知で
             残り日数を出すために使う。日付だけで、購入者の情報は読まない。 */
          shipBy: String((li.lineItemFulfillmentInstructions
            && li.lineItemFulfillmentInstructions.shipByDate) || ""),
        });
      }
      out.push({
        orderId: String(o.orderId || ""),
        at: String(o.creationDate || ""),
        status: String(o.orderFulfillmentStatus || o.orderPaymentStatus || ""),
        lines,
      });
    }
    const total = Number(d.total || 0);
    offset += 50;
    if (offset >= total || !(d.orders || []).length) break;
  }
  return { orders: out, ok: true };
}

/* 出品中リスト（Trading GetMyeBaySelling）。
   XMLの解析はWorkersに DOMParser が無いので、Item ブロックを切り出してタグを拾う。

   OutputSelector は**既定で付けない**。
   2026-09-30 の受け入れテストで
   `ActiveList.ItemArray.Item.ItemID` / `.SKU` / `.Title` /
   `.QuantityAvailable` / `.SellingStatus.CurrentPrice` /
   `ActiveList.PaginationResult` / `Ack` / `Errors` の組み合わせが
   「One or more of the output selectors is incorrect.」で Failure になり、
   出品中リストが1件も取れなかった。応答量は増えるが、まず確実に取れる形にする。
   どの指定が通るか分かったら EBAY_SELECTORS に入れれば絞れる（空なら付けない）。
   指定して失敗したときは、一度だけ指定なしで取り直す。 */
const EBAY_SELECTORS = [];
function tradingBody(page, selectors) {
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">'
    + "<ActiveList><Include>true</Include>"
    + "<Pagination><EntriesPerPage>" + EBAY_PAGE + "</EntriesPerPage>"
    + "<PageNumber>" + page + "</PageNumber></Pagination></ActiveList>"
    + (selectors || []).map((x) => "<OutputSelector>" + x + "</OutputSelector>").join("")
    + "</GetMyeBaySellingRequest>";
}
const SELECTOR_ERR = /output selector/i;
const xmlTag = (s, tag) => {
  const m = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">").exec(s);
  return m ? m[1] : "";
};
const xmlAttr = (s, tag, attr) => {
  const m = new RegExp("<" + tag + "[^>]*\\b" + attr + '="([^"]*)"').exec(s);
  return m ? m[1] : "";
};
async function tradingGet(env, run, token, page, selectors) {
  const resp = await net(run, EBAY_API + "/ws/api.dll", {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": token,     // OAuthトークンはこのヘッダーで渡す
      "content-type": "text/xml",
    },
    body: tradingBody(page, selectors),
  });
  const xml = await resp.text();
  const failed = !resp.ok || /<Ack>Failure<\/Ack>/.test(xml);
  return { xml, status: resp.status, failed };
}
async function ebayActive(env, run) {
  const token = await ebayToken(env, run);
  const rows = [];
  let pages = 1, selectors = EBAY_SELECTORS;
  for (let page = 1; page <= Math.min(pages, EBAY_MAX_PAGES); page++) {
    let r = await tradingGet(env, run, token, page, selectors);
    // OutputSelector が原因のときは、指定を外して取り直す
    if (r.failed && selectors.length && SELECTOR_ERR.test(r.xml)) {
      run.notes.push("OutputSelector が通らないので指定なしで取り直す");
      selectors = [];
      r = await tradingGet(env, run, token, page, selectors);
    }
    const xml = r.xml;
    if (r.failed) {
      run.errors++;
      run.notes.push("GetMyeBaySelling -> " + r.status + " "
        + [xmlTag(xml, "ErrorCode"), xmlTag(xml, "ShortMessage"), xmlTag(xml, "LongMessage")]
            .filter(Boolean).join(" / ").slice(0, 300));
      return { rows, ok: false };
    }
    // Ack が Warning でも中身は返る（警告だけ記録して続ける）
    if (/<Ack>Warning<\/Ack>/.test(xml))
      run.notes.push("GetMyeBaySelling 警告 "
        + (xmlTag(xml, "ShortMessage") || "").slice(0, 120));
    run.pages++;
    const active = xmlTag(xml, "ActiveList");
    const pr = xmlTag(active, "PaginationResult");
    if (pr) pages = Number(xmlTag(pr, "TotalNumberOfPages") || 1);
    const re = /<Item>([\s\S]*?)<\/Item>/g;
    let m;
    while ((m = re.exec(active))) {
      const b = m[1];
      const price = xmlTag(b, "CurrentPrice");
      /* QuantityAvailable は GetMyeBaySelling では返らないことがある。
         その場合は 出品数量 − 売れた数量 で出す（0固定になるのを防ぐ）。 */
      const det = xmlTag(b, "ListingDetails");
      const start = xmlTag(det, "StartTime");
      const avail = xmlTag(b, "QuantityAvailable");
      const qty = avail !== ""
        ? Number(avail)
        : Math.max(0, Number(xmlTag(b, "Quantity") || 0)
                      - Number(xmlTag(b, "QuantitySold") || 0));
      rows.push({
        itemId: xmlTag(b, "ItemID"),
        sku: xmlTag(b, "SKU"),
        title: xmlTag(b, "Title"),
        start: start,
        qty: qty,
        price: Number(price || 0),
        currency: xmlAttr(b, "CurrentPrice", "currencyID") || "USD",
      });
    }
  }
  run.notes.push("eBay出品 " + rows.length + "件");
  return { rows, ok: true };
}

/* ---- Discord 通知 ---- */
async function notify(env, run, text) {
  if (!env.DISCORD_WEBHOOK_URL || !text) return false;
  const resp = await net(run, env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: text.slice(0, NOTIFY_MAX) }),
  });
  if (!resp.ok) { run.errors++; run.notes.push("discord -> " + resp.status); return false; }
  return true;
}

/* ---- D1 ---- */
async function stateGet(env, k) {
  const r = await env.DB.prepare("SELECT v FROM sync_state WHERE k=?1").bind(k).first();
  return r ? r.v : "";
}
function stateSet(env, k, v) {
  return env.DB.prepare(
    `INSERT INTO sync_state (k,v,updated_at) VALUES (?1,?2,?3)
     ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`
  ).bind(k, String(v == null ? "" : v), nowIso());
}
async function runBatch(env, run, stmts) {
  if (!stmts.length) return;
  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }
  run.rows += stmts.length;
}
// items の行を作るだけ作っておく（あとで各取り込みが列を埋める）
function itemSeed(env, asin, cond, scope, title) {
  return env.DB.prepare(
    `INSERT INTO items (asin, cond, scope, title, updated_at) VALUES (?1,?2,?3,?4,?5)
     ON CONFLICT(asin,cond) DO UPDATE SET
       scope=CASE WHEN items.scope='unknown' THEN excluded.scope ELSE items.scope END,
       title=COALESCE(NULLIF(items.title,''), excluded.title),
       updated_at=excluded.updated_at`
  ).bind(asin, cond, scope || "unknown", title || "", nowIso());
}

/* ---- イベントの検出と通知 ---- */
const EV_IMMEDIATE = { EBAY_SOLD: 1, EBAY_SOLD_UNMATCHED: 1, OVERSELL_RISK: 1,
                       RESERVED_ONLY: 1, RESTOCK_LOSS: 1 };
const EV_TEXT = {
  FBA_SOLD: (d) => "FBAで売れた：" + d.title + " / eBay残数 " + d.ebay_qty
    + "。フェイズBではここでeBayを更新します",
  /* 無在庫（dropship）の行は、売れた時点で仕入れが必要。先頭に「要仕入れ」を出し、
     Amazonの最安値（送料込み）と、ハンドリング期限までの残り日数を添える。 */
  EBAY_SOLD: (d) => (d.dropship
    ? ("要仕入れ：eBayで売れた（無在庫）：" + d.title
       + " / Amazon最安値 " + (d.low > 0 ? ("¥" + d.low + "（送料込み）") : "未取得")
       + " / ハンドリング期限 " + dueText(d)
       + "。Amazonで注文して発送してください")
    : ("eBayで売れた：" + d.title + " / FBA販売可能 " + d.fba_available
       + "。MCFでの取り寄せが必要です")),
  EBAY_SOLD_UNMATCHED: (d) => "eBayで売れた（対応付けなし・自己発送）："
    + d.title + " / 数量 " + d.qty + " / " + (d.currency === "USD" ? "$" : "")
    + d.amount + (d.currency === "USD" ? "" : " " + d.currency)
    + (d.sku ? (" / SKU " + d.sku) : " / SKUなし")
    + "。注文 " + d.order_id + "。FBAに無い商品なので手元から発送してください",
  OVERSELL_RISK: (d) => "売り越しの恐れ：" + d.title + "（FBA 0 / eBay " + d.ebay_qty + "）",
  QTY_MISMATCH: (d) => "数量の食い違い：" + d.title + "（FBA " + d.fba_available
    + " / eBay " + d.ebay_qty + "）",
  INBOUND_LISTED: (d) => "納品待ちの商品がeBayに出ています：" + d.title,
  RESERVED_ONLY: (d) => "最優先：" + d.title + " はFBAの販売可能が0で予約済み "
    + d.fba_reserved + "点のみ（Amazonで注文済み・出荷待ち）。eBay残数 " + d.ebay_qty,
  TEST: (d) => "通知テスト（" + d.tag + "）。同じ印のテストは二度届きません",
  FBA_REMOVAL: (d) => "返送で手元に戻ります：" + d.title + "（" + d.qty
    + "点）。売上ではありません（長期保管在庫・販売不可在庫の返送）",
  RESTOCK_LOSS: (d) => (d.reason === "no_offer"
    ? ("再調達の仕入先なし：" + d.title + " はAmazonの出品が無くなりました（買い直せません）。"
       + "eBay売値 $" + d.ebay_price + "・数量 " + d.ebay_qty + "。出品を止めるか見直してください")
    : ("再調達で赤字：" + d.title + " はAmazon最安値 ¥" + d.low
       + "（出し直したときの上限 ¥" + d.max + "）。eBay売値 $" + d.ebay_price
       + " では損益分岐を下回ります。値上げか出品の取り下げが必要です")),
  UNMATCHED: (d) => "eBayに出ているのにFBA在庫が無い：新規 " + d.added
    + "件（合計 " + d.total + "件）。一覧の絞り込み state=listed_no_fba で確認してください",
};
/* ハンドリング期限の出し方。残り日数と日付を出す。期限が取れなければそう書く。 */
function dueText(d) {
  if (d.days === null || d.days === undefined || d.days === "") return "不明（期限の情報なし）";
  const n = Number(d.days);
  const md = String(d.ship_by || "").slice(0, 10).replace(/^\d{4}-/, "").replace("-", "/");
  const when = md ? ("（" + md + "）") : "";
  if (n < 0) return "超過 " + (-n) + "日" + when;
  if (n === 0) return "本日まで" + when;
  return "あと" + n + "日" + when;
}
function evStmt(env, type, key, item, detail) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO events (type, asin, cond, sku, dedup_key, detail, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7)`
  ).bind(type, (item && item.asin) || null, (item && item.cond) || null,
         (item && item.ebay_sku) || null, key,
         JSON.stringify(detail || {}), nowIso());
}
const dayKey = () => nowIso().slice(0, 10);
/* ハンドリング期限までの残り日数。期限が取れなければ null。
   当日いっぱいは 0 日（切り上げ）で数える。 */
function daysLeft(iso) {
  const t = Date.parse(String(iso || ""));
  if (isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}

/* 在庫・出品の状態から食い違い系のイベントを作る。
   同じ日に同じ内容は1回だけ（dedup_key に日付を入れる）。 */
function stateEvents(env, rows) {
  const out = [];
  for (const r of rows) {
    if (r.scope !== "ebay") continue;                 // eBay対象外・不明は通知しない
    const q = Number(r.ebay_qty || 0), av = Number(r.fba_available || 0);
    const inb = Number(r.fba_inbound || 0);
    /* 再調達中の行（restocking=1）は、FBAに在庫が無いまま出しているのが正常。
       売り越し・予約済みのみは出さず、仕入値の異変だけを通知する。
       FBAの記録が無い行（過去の出品）も見るので、下の guard より前に置く。 */
    if (isRestocking(r)) {
      if (av > 0 && q > 0 && av < q)
        out.push(evStmt(env, "QTY_MISMATCH",
          "QTY_MISMATCH|" + r.asin + "|" + r.cond + "|" + dayKey(), r,
          { title: r.title || r.ebay_sku || r.asin, ebay_qty: q,
            fba_available: av, fba_inbound: inb, fba_reserved: Number(r.fba_reserved || 0),
            on_hand: Number(r.on_hand || 0) ? 1 : 0, mode: r.mode || "" }));
      const tr = restockTrouble(r);
      if (tr) {
        out.push(evStmt(env, "RESTOCK_LOSS",
          "RESTOCK_LOSS|" + tr + "|" + r.asin + "|" + r.cond + "|" + dayKey(), r,
          { title: r.title || r.ebay_sku || r.asin, reason: tr,
            low: Math.round(restockLowest(r)), max: Math.round(Number(r.restock_max_cost || 0)),
            ebay_price: Number(r.ebay_price || 0).toFixed(2), ebay_qty: q,
            offers: Number(r.amazon_offers || 0) }));
      }
      continue;
    }
    /* 無在庫出品（dropship=1）も、在庫を持たないのが正常。
       売り越し・予約済みのみ・納品待ちは出さず、数量の食い違いだけを見る
       （売れたときの「要仕入れ」が本来の知らせ方）。 */
    if (isDropship(r)) {
      const av2 = Number(r.fba_available || 0);
      if (av2 > 0 && q > 0 && av2 < q)
        out.push(evStmt(env, "QTY_MISMATCH",
          "QTY_MISMATCH|" + r.asin + "|" + r.cond + "|" + dayKey(), r,
          { title: r.title || r.ebay_sku || r.asin, ebay_qty: q,
            fba_available: av2, fba_inbound: inb, fba_reserved: Number(r.fba_reserved || 0),
            on_hand: Number(r.on_hand || 0) ? 1 : 0, mode: r.mode || "" }));
      continue;
    }
    if (r.ebay_qty === null || r.fba_seen_at == null) continue;  // 片側しか無い行は UNMATCHED 側で扱う
    const rv = Number(r.fba_reserved || 0);
    const onHand = !!Number(r.on_hand || 0);
    const d = { title: r.title || r.ebay_sku || r.asin, ebay_qty: q,
                fba_available: av, fba_inbound: inb, fba_reserved: rv,
                on_hand: onHand ? 1 : 0, mode: r.mode || "" };
    const base = "|" + r.asin + "|" + r.cond + "|" + dayKey();
    /* 予約済みのみ（Amazonで注文が入って出荷待ち）が最優先。
       手元在庫があってもAmazon側で在庫が消える話なので、こちらは抑えない。 */
    if (av === 0 && rv > 0 && q >= 1) {
      out.push(evStmt(env, "RESERVED_ONLY", "RESERVED_ONLY" + base, r, d));
      continue;
    }
    // 手元在庫あり（on_hand）は、FBAが0でも売り越しではない
    if (!onHand && av === 0 && q >= 1 && (r.mode === "hold" || r.mode === "end" || !r.mode))
      out.push(evStmt(env, "OVERSELL_RISK", "OVERSELL_RISK" + base, r, d));
    if (av > 0 && q > 0 && av < q)
      out.push(evStmt(env, "QTY_MISMATCH", "QTY_MISMATCH" + base, r, d));
    if (!onHand && av === 0 && inb > 0 && q >= 1)
      out.push(evStmt(env, "INBOUND_LISTED", "INBOUND_LISTED" + base, r, d));
  }
  return out;
}
// 一覧の1行を作るための共通SELECT
const ITEM_COLS = `asin, cond, scope, title, ebay_item_id, ebay_sku, ebay_qty, ebay_price,
  ebay_currency, ebay_seen_at, ebay_start, fba_available, fba_inbound, fba_reserved, fba_seen_at,
  mode, one_off, one_off_known, fba_link, on_hand, restocking, dropship,
  amazon_lowest, amazon_lowest_n, amazon_offers, amazon_offers_json,
  amazon_lowest_at, restock_at, restock_price, restock_max_cost, restock_skip_acc,
  updated_at`;

/* items をキーで引く。D1 は1命令あたりのバインド変数が100個までなので、
   重複キーをまとめたうえで D1_MAX_KEYS 件ずつに分けて引く
   （まとめて引くと「too many SQL variables」で中断する）。 */
async function itemsByKeys(env, keys) {
  const uniq = [], seen = {};
  for (const k of keys || []) {
    if (!k || !k.asin) continue;
    const id = k.asin + "|" + k.cond;
    if (seen[id]) continue;
    seen[id] = 1;
    uniq.push(k);
  }
  const out = [];
  for (let i = 0; i < uniq.length; i += D1_MAX_KEYS) {
    const part = uniq.slice(i, i + D1_MAX_KEYS);
    const where = part.map(() => "(asin=? AND cond=?)").join(" OR ");
    const bind = [];
    for (const k of part) bind.push(k.asin, k.cond);
    const r = await env.DB.prepare(`SELECT ${ITEM_COLS} FROM items WHERE ${where}`)
      .bind(...bind).all();
    for (const x of (r && r.results) || []) out.push(x);
  }
  return out;
}

/* 溜まっているイベントを通知する。即時のものは種類で判断し、
   それ以外は1時間ごとにまとめて出す。UNMATCHED は件数だけ。 */
async function flushEvents(env, run, onlyImmediate) {
  const r = await env.DB.prepare(
    `SELECT id, type, detail FROM events WHERE notified_at IS NULL ORDER BY id LIMIT 200`
  ).all();
  const rows = (r && r.results) || [];
  const pick = rows.filter((x) => !onlyImmediate || EV_IMMEDIATE[x.type]);
  if (!pick.length) return 0;
  /* 「要仕入れ」（無在庫が売れた）は手を動かす必要があるので、通知の先頭に出す。
     それ以外の並びは今までどおり（イベントのid順）。 */
  const made = pick.map((x) => {
    let d = {};
    try { d = JSON.parse(x.detail || "{}"); } catch (e) { d = {}; }
    const f = EV_TEXT[x.type];
    const text = f ? f(d) : x.type;
    return { urgent: x.type === "EBAY_SOLD" && !!d.dropship, text };
  });
  const lines = made.filter((m) => m.urgent).concat(made.filter((m) => !m.urgent))
    .map((m) => "・" + m.text);
  const ok = await notify(env, run, lines.join("\n"));
  if (!ok) return 0;
  const at = nowIso();
  await runBatch(env, run, pick.map((x) =>
    env.DB.prepare("UPDATE events SET notified_at=?1 WHERE id=?2").bind(at, x.id)));
  run.events += pick.length;
  return pick.length;
}

/* ---- 取り込みの本体 ---- */

/* 注文（Amazon AFN と eBay）。15分ごと。
   保存するのは注文ID・SKU・数量・金額・日時・状態だけ。

   getOrderItems は 0.5回/秒しか呼べないため、注文一覧で見つけた注文は
   いったん order_queue に入れ、1回の実行では上限件数（と時間）まで明細を取る。
   取り終えた注文は done_at が入り、二度と取り直さない。
   失敗した注文は done_at が空のまま残り、次回の実行でやり直す。
   eBay の取り込みは明細の追加取得が要らないので、Amazonの明細より先に済ませる
   （明細が長引いても eBay が取り残されないようにする）。 */
async function syncOrders(env, run, days, maxItems) {
  const cap = Math.min(ITEMS_PER_RUN_MAX, Math.max(1, Number(maxItems) || ITEMS_PER_RUN));
  const back = days ? Math.min(days, ORDERS_FIRST_DAYS) * 24 * 60 * 60 * 1000 : 0;
  const nowMs = Date.now();
  const sinceA = back ? new Date(nowMs - back).toISOString()
    : (await stateGet(env, "orders.amazon.since")) || new Date(nowMs - ORDERS_LOOKBACK_MS).toISOString();
  const sinceE = back ? new Date(nowMs - back).toISOString()
    : (await stateGet(env, "orders.ebay.since")) || new Date(nowMs - ORDERS_LOOKBACK_MS).toISOString();

  /* 1) Amazonの注文一覧 → 待ち行列に積む。
     すでに明細を取り終えた注文は done_at を残したまま状態だけ更新する。 */
  const a = await amazonOrders(env, run, sinceA);
  const qs = [];
  for (const o of a.orders) {
    qs.push(env.DB.prepare(
      `INSERT INTO order_queue (order_id, status, ordered_at, sales_channel, kind,
         seller_order_id, tries, updated_at) VALUES (?1,?2,?3,?4,?5,?6,0,?7)
       ON CONFLICT(order_id) DO UPDATE SET status=excluded.status,
         sales_channel=excluded.sales_channel, kind=excluded.kind,
         seller_order_id=excluded.seller_order_id, updated_at=excluded.updated_at`
    ).bind(o.orderId, o.status, o.at, o.channel, o.kind, o.sellerOrderId, nowIso()));
    /* 明細を取り直さずに、注文一覧から分かる項目だけ反映する（数量・金額は変わらない）。
       販売経路を後から足したので、既存の行もこの更新で埋まる。 */
    qs.push(env.DB.prepare(
      `UPDATE orders SET status=?2, sales_channel=?3, kind=?4, seller_order_id=?5
       WHERE channel='amazon' AND order_id=?1`
    ).bind(o.orderId, o.status, o.channel, o.kind, o.sellerOrderId));
  }
  await runBatch(env, run, qs);

  /* 2) eBayの注文 */
  const keys = [], soldE = [], soldU = [];
  const estmts = [];
  const e = await ebayOrders(env, run, sinceE);
  for (const o of e.orders) {
    for (const li of o.lines) {
      const k = parseLabel(li.sku);
      estmts.push(env.DB.prepare(
        `INSERT INTO orders (channel,order_id,line_id,sku,asin,cond,qty,amount,currency,
           ordered_at,status,created_at) VALUES ('ebay',?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
         ON CONFLICT(channel,order_id,line_id) DO UPDATE SET
           qty=excluded.qty, amount=excluded.amount, status=excluded.status`
      ).bind(o.orderId, li.lineId, li.sku, k.asin || null, k.cond || null, li.qty, li.amount,
             li.currency, o.at, o.status, nowIso()));
      if (k.ok) {
        estmts.push(itemSeed(env, k.asin, k.cond, k.scope, ""));
        keys.push({ asin: k.asin, cond: k.cond });
        soldE.push({ asin: k.asin, cond: k.cond, orderId: o.orderId, line: li.lineId,
                     shipBy: li.shipBy || "", dropship: !!k.dropship });
      } else {
        /* SKUが無い出品（Amazonに無いセット品など）や、SKUの形が違って解析できない出品。
           商品を特定できないので items には足さないが、売れたことは必ず知らせる。 */
        soldU.push({ orderId: o.orderId, line: li.lineId, sku: li.sku,
                     title: li.title, qty: li.qty, amount: li.amount,
                     currency: li.currency, at: o.at });
      }
    }
  }
  await runBatch(env, run, estmts);

  /* 3) Amazonの明細を待ち行列から取る。上限件数と時間で打ち切り、残りは次回。 */
  const pend = await env.DB.prepare(
    `SELECT order_id, status, ordered_at, sales_channel, kind, seller_order_id
     FROM order_queue WHERE done_at IS NULL ORDER BY ordered_at LIMIT ?1`
  ).bind(cap).all();
  const queue = (pend && pend.results) || [];
  const t0 = Date.now();
  const soldA = [], removalA = [];
  let got = 0, failed = 0, stopped = false;
  for (const row of queue) {
    if (Date.now() - t0 > ITEMS_DEADLINE_MS) { stopped = true; break; }
    const r = await amazonOrderItems(env, run, row.order_id);
    if (!r.ok) {
      failed++;
      await env.DB.prepare(
        `UPDATE order_queue SET tries=tries+1, updated_at=?2 WHERE order_id=?1`
      ).bind(row.order_id, nowIso()).run();
      continue;
    }
    const stmts = [];
    for (const li of r.lines) {
      const p = parseSku(li.sku);
      const asin = p.ok ? p.asin : li.asin;
      const cond = p.ok ? p.cond : "new";
      stmts.push(env.DB.prepare(
        `INSERT INTO orders (channel,order_id,line_id,sku,asin,cond,qty,amount,currency,
           ordered_at,status,created_at,sales_channel,kind,seller_order_id)
         VALUES ('amazon',?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
         ON CONFLICT(channel,order_id,line_id) DO UPDATE SET
           qty=excluded.qty, amount=excluded.amount, status=excluded.status,
           sales_channel=excluded.sales_channel, kind=excluded.kind,
           seller_order_id=excluded.seller_order_id`
      ).bind(row.order_id, li.lineId, li.sku, asin, cond, li.qty, li.amount, li.currency,
             row.ordered_at, row.status, nowIso(), row.sales_channel || "",
             row.kind || "sale", row.seller_order_id || ""));
      if (asin) {
        stmts.push(itemSeed(env, asin, cond, p.scope, ""));
        keys.push({ asin, cond });
        /* 売上（Amazon.co.jp）と、Amazonが作る返送（Non-Amazon）を分ける。
           返送は売れたわけではないので FBA_SOLD にしない。 */
        const rec = { asin, cond, orderId: row.order_id, sku: li.sku, qty: li.qty };
        if ((row.kind || "sale") === "sale") {
          // キャンセル・販売不可は売れていないので FBA_SOLD にしない
          if (!DEAD_STATUS.test(String(row.status || ""))) soldA.push(rec);
        }
        else if (row.kind === "removal") removalA.push(rec);
        // kind==='mcf'（自分のMCF。"PJ-" で始まる）はフェイズCで扱う
      }
    }
    stmts.push(env.DB.prepare(
      `UPDATE order_queue SET done_at=?2, lines=?3, updated_at=?2 WHERE order_id=?1`
    ).bind(row.order_id, nowIso(), r.lines.length));
    await runBatch(env, run, stmts);
    got++;
  }
  const left = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM order_queue WHERE done_at IS NULL`).first();
  const leftN = Number((left && left.n) || 0);

  /* 4) 売れた行の状態を見てイベントを作る */
  const items = await itemsByKeys(env, keys);
  const map = {};
  for (const it of items) map[it.asin + "|" + it.cond] = it;
  const ev = [];
  for (const s2 of soldA) {
    const it = map[s2.asin + "|" + s2.cond];
    if (!it || it.scope !== "ebay") continue;
    if (Number(it.ebay_qty || 0) >= 1)
      ev.push(evStmt(env, "FBA_SOLD", "FBA_SOLD|" + s2.orderId + "|" + s2.sku, it,
        { title: it.title || s2.sku, ebay_qty: it.ebay_qty, fba_available: it.fba_available }));
  }
  for (const s2 of removalA) {
    const it = map[s2.asin + "|" + s2.cond] || { asin: s2.asin, cond: s2.cond, scope: "unknown" };
    ev.push(evStmt(env, "FBA_REMOVAL", "FBA_REMOVAL|" + s2.orderId + "|" + s2.sku, it,
      { title: it.title || s2.sku, qty: s2.qty, ebay_qty: it.ebay_qty || 0 }));
  }
  for (const s2 of soldE) {
    const it = map[s2.asin + "|" + s2.cond] || { asin: s2.asin, cond: s2.cond, scope: "ebay" };
    /* 無在庫の行は売れた時点で仕入れが必要。Amazonの最安値（送料込み）と
       ハンドリング期限までの残り日数を通知に入れる。
       印は items の dropship か、CustomLabel が M- かのどちらかで立つ。 */
    const drop = !!Number(it.dropship || 0) || !!s2.dropship;
    ev.push(evStmt(env, "EBAY_SOLD", "EBAY_SOLD|" + s2.orderId + "|" + s2.line, it,
      Object.assign({ title: it.title || s2.asin, fba_available: it.fba_available || 0,
        ebay_qty: it.ebay_qty || 0 },
        drop ? { dropship: 1, low: Math.round(Number(it.amazon_lowest || 0)),
                 ship_by: s2.shipBy || "", days: daysLeft(s2.shipBy) } : {})));
  }
  /* 対応付けできない出品も通知する（自己発送）。
     注文IDと明細IDで重複を防ぐので、同じ注文を二度通知しない。
     入れるのは商品名・数量・金額だけ（購入者の情報は入れない）。 */
  for (const s2 of soldU) {
    ev.push(evStmt(env, "EBAY_SOLD_UNMATCHED",
      "EBAY_SOLD_UNMATCHED|" + s2.orderId + "|" + s2.line,
      { ebay_sku: s2.sku || "" },
      { title: s2.title || s2.sku || "（商品名なし）", qty: s2.qty,
        amount: Number(s2.amount || 0).toFixed(2), currency: s2.currency || "USD",
        sku: s2.sku || "", order_id: s2.orderId }));
  }
  await runBatch(env, run, ev);

  /* 5) 差分の基準時刻を進める。明細が残っていても待ち行列で追いかけるので進めてよい。 */
  if (a.ok) await stateSet(env, "orders.amazon.since", new Date(nowMs - 60 * 1000).toISOString()).run();
  if (e.ok) await stateSet(env, "orders.ebay.since", new Date(nowMs - 60 * 1000).toISOString()).run();
  const chN = { sale: 0, removal: 0, mcf: 0 };
  for (const o of a.orders) chN[o.kind] = (chN[o.kind] || 0) + 1;
  run.notes.push("Amazon注文 " + a.orders.length + "件（売上" + chN.sale
    + "・返送" + chN.removal + "・MCF" + chN.mcf + "）/ eBay注文 " + e.orders.length + "件"
    + (soldU.length ? ("（対応付けなし " + soldU.length + "件）") : "")
    + " / 明細 取得" + got + "件"
    + (failed ? ("・失敗" + failed + "件（次回やり直す）") : "")
    + (stopped ? "・時間の上限で打ち切り" : "")
    + (leftN ? ("・残り" + leftN + "件") : ""));
  return { amazon: a.orders.length, ebay: e.orders.length, items_fetched: got,
           items_failed: failed, items_pending: leftN };
}

/* FBA在庫の行をD1へ書く。skus（個体）を更新し、items（商品）は合算で作り直す。
   同じASINの中古（UG/UVG/UM/UA）は eBay側で -U に一本化されるため合算する。 */
async function writeInventory(env, run, rows) {
  const stmts = [], keys = {};
  for (const r of rows) {
    const p = parseSku(r.sku);
    const asin = p.ok ? p.asin : (r.asin || "");
    const cond = p.ok ? p.cond : "new";
    if (!asin) continue;
    const zero = (r.available + r.inbound + r.reserved) === 0;
    stmts.push(env.DB.prepare(
      `INSERT INTO skus (seller_sku, asin, cond, cond_code, prefix, scope, purchased_on, cost,
         ebay_custom_label, title, fba_available, fba_inbound, fba_reserved, fba_seen_at,
         active, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
       ON CONFLICT(seller_sku) DO UPDATE SET
         title=COALESCE(NULLIF(excluded.title,''), skus.title),
         fba_available=excluded.fba_available, fba_inbound=excluded.fba_inbound,
         fba_reserved=excluded.fba_reserved, fba_seen_at=excluded.fba_seen_at,
         active=excluded.active, updated_at=excluded.updated_at`
    ).bind(r.sku, asin, cond, p.condCode || "", p.prefix || "", p.scope, p.purchasedOn || "",
           p.cost, null, r.title, r.available, r.inbound, r.reserved, nowIso(),
           zero ? 0 : 1, nowIso()));
    stmts.push(itemSeed(env, asin, cond, p.scope, r.title));
    keys[asin + "|" + cond] = { asin, cond };
  }
  await runBatch(env, run, stmts);
  /* FBAに在庫（販売可能・入庫中・予約済みのいずれか）が付いた行は、もう手元在庫ではない。
     納品プランを作って入庫中の数が出た時点で印が外れる。 */
  const unflag = Object.values(keys).map((k) => env.DB.prepare(
    `UPDATE items SET on_hand=0, updated_at=?3
     WHERE asin=?1 AND cond=?2 AND on_hand=1 AND ${SQL_IN_STOCK}`
  ).bind(k.asin, k.cond, nowIso()));
  // items の在庫を skus から作り直す
  const recalc = Object.values(keys).map((k) => env.DB.prepare(
    `UPDATE items SET
       fba_available=(SELECT COALESCE(SUM(fba_available),0) FROM skus
                      WHERE skus.asin=items.asin AND skus.cond=items.cond),
       fba_inbound  =(SELECT COALESCE(SUM(fba_inbound),0)  FROM skus
                      WHERE skus.asin=items.asin AND skus.cond=items.cond),
       fba_reserved =(SELECT COALESCE(SUM(fba_reserved),0) FROM skus
                      WHERE skus.asin=items.asin AND skus.cond=items.cond),
       fba_seen_at=?3, updated_at=?3
     WHERE asin=?1 AND cond=?2`
  ).bind(k.asin, k.cond, nowIso()));
  await runBatch(env, run, recalc);
  await runBatch(env, run, unflag);      // 在庫を入れ直したあとに判定する
  return Object.values(keys);
}

// 1時間ごと。startDateTime による差分。入庫中の数量変化は拾えない（日次の名指しで補う）。
async function syncInventoryDiff(env, run) {
  const since = (await stateGet(env, "inventory.since"))
    || new Date(Date.now() - INV_LOOKBACK_MS).toISOString();
  const nowMs = Date.now();
  const r = await fbaInventory(env, run, "since", since, 20);
  const keys = await writeInventory(env, run, r.rows);
  // startDateTime を外して取った回は1ページしか見ていないので基準時刻を進めない
  if (r.ok && !r.fallback)
    await stateSet(env, "inventory.since", new Date(nowMs - 60 * 1000).toISOString()).run();
  run.notes.push("在庫差分 " + r.rows.length + "件");
  return keys;
}

/* 日次。名簿（active=1・eBay対象）のSKUを sellerSkus で名指し確認する。
   出品6,000件のうち在庫のある1,100点だけを読むための仕組み。 */
async function syncRollcall(env, run) {
  const q = await env.DB.prepare(
    `SELECT seller_sku FROM skus WHERE active=1 AND scope='ebay' ORDER BY seller_sku`
  ).all();
  const all = ((q && q.results) || []).map((x) => x.seller_sku);
  const keys = [];
  for (let i = 0; i < all.length && i / ROLLCALL_BATCH < ROLLCALL_MAX_CALLS; i += ROLLCALL_BATCH) {
    const part = all.slice(i, i + ROLLCALL_BATCH);
    const r = await fbaInventory(env, run, "skus", part, 1);
    const k = await writeInventory(env, run, r.rows);
    for (const x of k) keys.push(x);
    if (!r.ok) break;
  }
  run.notes.push("名簿 " + all.length + "件を照会");
  return keys;
}

/* 手動。全件スイープ。nextToken をD1に置いて数ページずつ進める。
   nextToken は1ページ目と同じ絞り込みと対でないと使えないので、
   そのときの startDateTime も一緒に保存して使い回す。 */
async function syncSweep(env, run, days) {
  const token = await stateGet(env, "sweep.token");
  let since = await stateGet(env, "sweep.since");
  if (!token || !since) {
    /* Amazonは18か月より前の startDateTime を受けないので、既定は540日前。
       「この期間に一度も動きがないSKU」は取れない点は割り切る。 */
    const d = Math.min(540, Math.max(1, Number(days) || 540));
    since = isoSec(Date.now() - d * 24 * 60 * 60 * 1000);
    await stateSet(env, "sweep.since", since).run();
    run.notes.push("起点 " + since);
  }
  const r = await fbaInventory(env, run, "since", since, SWEEP_PAGES, token);
  const keys = await writeInventory(env, run, r.rows);
  await stateSet(env, "sweep.token", r.next || "").run();
  await stateSet(env, "sweep.at", nowIso()).run();
  if (r.restarted) run.notes.push("保存していたトークンが無効だったので最初から読み直した");
  run.notes.push(r.next ? "続きあり（もう一度実行する）" : "全件スイープ完了");
  if (!r.next) await stateSet(env, "sweep.since", "").run();   // 次回は新しい起点から
  return { keys, done: !r.next, rows: r.rows.length };
}

/* 1時間ごと。eBayの出品中リスト。ActiveList に無くなった行は数量0にする。 */
async function syncEbayActive(env, run) {
  const runAt = nowIso();
  const r = await ebayActive(env, run);
  const stmts = [], keys = [];
  /* pj_price を通さず出した既存出品は CustomLabel が空か別形式で、
     ASIN＋新品/中古のキーが作れない。一覧・通知の対象にせず、件数だけ出す。 */
  let unparsed = 0;
  for (const it of r.rows) {
    const k = parseLabel(it.sku);
    if (!k.ok) { unparsed++; continue; }
    stmts.push(itemSeed(env, k.asin, k.cond, k.scope, it.title));
    stmts.push(env.DB.prepare(
      `UPDATE items SET ebay_item_id=?3, ebay_sku=?4, ebay_qty=?5, ebay_price=?6,
         ebay_currency=?7, ebay_seen_at=?8, title=COALESCE(NULLIF(title,''),?9),
         ebay_start=COALESCE(NULLIF(?10,''), ebay_start),
         -- CustomLabel が M- の行は無在庫。印は立てるだけで、下ろすのは手動のみ
         dropship=CASE WHEN ?11=1 THEN 1 ELSE dropship END,
         updated_at=?8
       WHERE asin=?1 AND cond=?2`
    ).bind(k.asin, k.cond, it.itemId, it.sku, it.qty, it.price, it.currency, runAt, it.title,
           it.start || "", k.dropship ? 1 : 0));
    keys.push({ asin: k.asin, cond: k.cond });
  }
  await runBatch(env, run, stmts);
  if (unparsed) {
    run.notes.push("CustomLabel解析不可 " + unparsed + "件（pj_priceを通さず出した出品。対象外）");
    await stateSet(env, "ebay.unparsed", String(unparsed)).run();
  } else {
    await stateSet(env, "ebay.unparsed", "0").run();
  }
  // 全ページ読めたときだけ、消えた出品を数量0にする（途中で切れた回では触らない）
  if (r.ok) {
    await env.DB.prepare(
      `UPDATE items SET ebay_qty=0, updated_at=?1
       WHERE ebay_seen_at IS NOT NULL AND ebay_seen_at < ?1 AND ebay_qty IS NOT NULL AND ebay_qty<>0`
    ).bind(runAt).run();
  }
  return keys;
}

/* 日次。Amazon最安値（参考表示用）。eBayに出ている行だけ。 */
async function syncPricing(env, run) {
  const q = await env.DB.prepare(
    /* 再調達中の行を先に見る。この行だけは最安値が上がると赤字になるので、
       古い値のまま放置しない。あとは最安値が古い順。 */
    `SELECT asin, cond FROM items WHERE scope='ebay' AND ebay_qty>0
       ORDER BY restocking DESC, amazon_lowest_at IS NOT NULL,
       amazon_lowest_at LIMIT ?1`
  ).bind(PRICING_BATCH * PRICING_MAX_CALLS).all();
  const keys = (q && q.results) || [];
  if (!keys.length) return 0;
  const low = await amazonLowest(env, run, keys);
  const at = nowIso();
  const stmts = [];
  for (const k of keys) {
    const v = low[k.asin + "|" + k.cond];
    if (!v) continue;
    stmts.push(env.DB.prepare(
      `UPDATE items SET amazon_lowest=?3, amazon_lowest_n=?4, amazon_offers=?5,
         amazon_offers_json=?7, amazon_lowest_at=?6, updated_at=?6
       WHERE asin=?1 AND cond=?2`).bind(k.asin, k.cond, v.low, v.lowN, v.total, at,
         JSON.stringify(v.offers || [])));
  }
  await runBatch(env, run, stmts);
  run.notes.push("最安値 " + stmts.length + "件");
  return stmts.length;
}

/* 日次。未対応付けの件数だけ通知する（中身は一覧で見る）。
   scope が out / unknown の行は数にも入れない。 */
/* 通知するのは「eBayに出ているのにFBA在庫の記録が無い」行だけ。
   FBA在庫はあるがeBay未出品の行は、出していないだけなので件数だけ数える。 */
async function syncUnmatched(env, run) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM items
     WHERE scope='ebay' AND fba_seen_at IS NULL AND on_hand=0`).first();
  const other = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM items
     WHERE scope='ebay' AND ebay_qty IS NULL AND fba_seen_at IS NOT NULL
       AND ${SQL_IN_STOCK}`).first();
  const total = Number((r && r.n) || 0);
  const notListed = Number((other && other.n) || 0);
  const prev = Number((await stateGet(env, "unmatched.total")) || 0);
  const added = Math.max(0, total - prev);
  await stateSet(env, "unmatched.total", String(total)).run();
  if (added > 0) {
    await runBatch(env, run, [evStmt(env, "UNMATCHED", "UNMATCHED|" + dayKey(), null,
      { added, total })]);
  }
  run.notes.push("eBay出品ありFBA在庫なし " + total + "件（新規" + added + "件）"
    + " / FBA在庫ありeBay未出品 " + notListed + "件");
  return { total, added, fba_not_listed: notListed };
}

/* 再調達中の行を全部見て、赤字・仕入先なしを拾う。
   名簿（skus）に無い過去の出品も再調達中になり得るので、
   その回に触ったキーだけでなく、再調達中の行はいつも全部見る。
   D1を1回読むだけで、外への呼び出しは増えない。 */
async function restockWatch(env, run) {
  const q = await env.DB.prepare(
    `SELECT ${ITEM_COLS} FROM items
      WHERE scope='ebay' AND restocking=1 AND ebay_qty>=1`).all();
  const rows = (q && q.results) || [];
  const stmts = stateEvents(env, rows);     // 再調達中の行では RESTOCK_LOSS だけを作る
  await runBatch(env, run, stmts);
  run.notes.push("再調達中 " + rows.length + "件（異変 " + stmts.length + "件）");
  return rows.length;
}

/* ---- 仕事の組み合わせ ---- */
async function jobOrders(env, days, maxItems) {
  const run = newRun("orders");
  let res = {};
  try {
    res = await syncOrders(env, run, days, maxItems);
    run.notes.push("待ち行列の残り " + res.items_pending + "件");
    await flushEvents(env, run, true);      // 即時ぶんだけ（EBAY_SOLD / OVERSELL_RISK）
  } catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
  // 明細の残り件数も返す（0になるまで押せばよいと分かるように）
  return Object.assign(await saveRun(env, run), res);
}
async function jobHourly(env) {
  const run = newRun("inventory");
  try {
    const a = await syncInventoryDiff(env, run);
    const b = await syncEbayActive(env, run);
    const keys = a.concat(b);
    const items = await itemsByKeys(env, keys);
    await runBatch(env, run, stateEvents(env, items));
    await restockWatch(env, run);
    await flushEvents(env, run, false);     // まとめて通知
  } catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
  return saveRun(env, run);
}
async function jobDaily(env) {
  const run = newRun("rollcall");
  try {
    const keys = await syncRollcall(env, run);
    const items = await itemsByKeys(env, keys);
    await runBatch(env, run, stateEvents(env, items));
    await syncPricing(env, run);
    await restockWatch(env, run);           // 新しい最安値で赤字を見る
    await syncUnmatched(env, run);
    await flushEvents(env, run, false);
  } catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
  return saveRun(env, run);
}
async function jobSweep(env, days) {
  const run = newRun("sweep");
  let res = { done: false, rows: 0 };
  try {
    res = await syncSweep(env, run, days);
    // スイープで名簿が増えるので、そのぶんの食い違いも見ておく
    const items = await itemsByKeys(env, res.keys || []);
    await runBatch(env, run, stateEvents(env, items));
  } catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
  const info = await saveRun(env, run);
  // sweep_done が false のあいだは、もう一度同じコマンドを実行する
  return Object.assign(info, { sweep_done: !!res.done, sweep_rows: res.rows || 0 });
}
/* 受け入れテスト用。同じ印（tag）のテストイベントは dedup_key が同じなので
   2回目は届かない（通知の重複防止がそのまま効いていることの確認になる）。
   印を変えれば別の1通が届く。書き込みは自分のD1とDiscordだけ。 */
async function jobTestNotify(env, tag) {
  const run = newRun("notify");
  const t = String(tag || dayKey()).slice(0, 40);
  try {
    await runBatch(env, run, [evStmt(env, "TEST", "TEST|" + t, null, { tag: t })]);
    const n = await flushEvents(env, run, false);
    run.notes.push("通知テスト tag=" + t + " → " + n + "件を送信");
  } catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
  return saveRun(env, run);
}
/* 誤って付いた手元在庫の印を、在庫がある行からまとめて外す。
   名簿を送り直しても直るが、その場で直したいとき用。 */
async function jobOnHandClean(env) {
  const run = newRun("onhand-clean");
  let cleared = 0, left = 0;
  try {
    const before = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM items WHERE on_hand=1 AND ${SQL_IN_STOCK}`).first();
    cleared = Number((before && before.n) || 0);
    await env.DB.prepare(
      `UPDATE items SET on_hand=0, updated_at=?1 WHERE on_hand=1 AND ${SQL_IN_STOCK}`
    ).bind(nowIso()).run();
    const after = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM items WHERE on_hand=1`).first();
    left = Number((after && after.n) || 0);
    run.rows += cleared;
    run.notes.push("在庫がある行の手元在庫を " + cleared + "件外した（残り " + left + "件）");
  } catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
  return Object.assign(await saveRun(env, run), { cleared, on_hand_left: left });
}
async function jobNotify(env) {
  const run = newRun("notify");
  try { await flushEvents(env, run, false); }
  catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
  return saveRun(env, run);
}

/* ---- GET /status ---- */
/* FBA在庫が1点以上あるか（販売可能・入庫中・予約済みのいずれか）。
   在庫0の過去SKUを数から外すために使う。SQLとJSで同じ条件にしてある。 */
const SQL_IN_STOCK =
  "(COALESCE(fba_available,0)+COALESCE(fba_inbound,0)+COALESCE(fba_reserved,0))>0";
function inStock(r) {
  return (Number(r.fba_available || 0) + Number(r.fba_inbound || 0)
          + Number(r.fba_reserved || 0)) > 0;
}

/* 行の状態。未対応付けは2種類あり、意味がまったく違う。
   'listed_no_fba' … eBayに出ているのにFBA在庫の記録が無い（要注意）
   'fba_not_listed' … FBA在庫はあるがeBayに出していない（通常の状態。警告にしない）
   'ok'             … 両方ある */
function stateOf(r) {
  const noFba = (r.fba_seen_at === null || r.fba_seen_at === undefined);
  const noEbay = (r.ebay_qty === null || r.ebay_qty === undefined);
  if (noFba) return "listed_no_fba";               // FBAの記録が無い
  if (noEbay) return inStock(r) ? "fba_not_listed" : "past";  // past は在庫0の過去SKU
  return "ok";
}
/* 警告。強い順に見る。
   予約済みのみ（Amazonで注文が入って出荷待ち）が最優先。
   手元在庫あり（on_hand）の行は、FBAが0でも売り越し・納品待ちの警告を出さない
   （仕入れてすぐeBayに出し、FBA納品はその後になる運用のため）。 */
/* 再調達中：pj_price の再調達CSVで出し直した行（restocking=1）で、まだeBayに出ている。
   この行は「FBAに在庫が無いまま出している」のが正常なので、売り越し系の警告を出さない。
   mode='restock'（出品リストで決める「在庫0のときの動作」）とは別物なので混ぜない。 */
function isRestocking(r) {
  return !!Number(r.restocking || 0) && Number(r.ebay_qty || 0) >= 1;
}
/* 無在庫出品：手元にもFBAにも在庫を持たず、売れてから仕入れる出品。
   この行も「FBAに在庫が無いまま出している」のが正常なので、売り越し系の警告を出さない。
   売れたときに「要仕入れ」を出すのが本来の知らせ方。 */
function isDropship(r) {
  return !!Number(r.dropship || 0) && Number(r.ebay_qty || 0) >= 1;
}
/* 再調達の候補：eBayに出ていて、FBAの販売可能が0（売り越しの恐れ・予約済みのみ）で、
   一点物でない行。一点物かどうかが分からない行（one_off_known=0）も候補に入れる。
   すでに再調達で出し直した行（restocking=1）は候補から外す（切り替え済み）。 */
function isRestock(r) {
  return Number(r.ebay_qty || 0) >= 1
      && r.fba_available !== null && r.fba_available !== undefined
      && Number(r.fba_available) === 0
      && !Number(r.one_off || 0)
      // 手元にある商品は手元から発送できるので、再調達の必要がない
      && !Number(r.on_hand || 0)
      // 無在庫出品は、もともと在庫を持たない出品なので再調達の対象ではない
      && !Number(r.dropship || 0)
      && !isRestocking(r);
}
/* 再調達の仕入値として見る最安値（円）。
   行が `restock_skip_acc=1` を持つときは「可」の出品を外す（pj_price と同じ決まり）。
   「可」しか無い・状態がまったく分からないときは外さない。 */
const ACC_RE = /^acceptable$/i;
const COND_NAME_RE =
  /^(new|mint|verygood|good|acceptable|refurbished|collectible|club|oem|used)$/i;
const condNorm = (c) => String(c || "").toLowerCase().replace(/[^a-z]/g, "");
function restockLowest(r) {
  let list = [];
  try {
    const a = JSON.parse(r.amazon_offers_json || "[]");
    if (Array.isArray(a)) list = a;
  } catch (e) { /* 壊れていれば amazon_lowest を使う */ }
  if (Number(r.restock_skip_acc || 0) && r.cond !== "new" && list.length) {
    const keep = list.filter((o) => !ACC_RE.test(condNorm(o.c)));
    const known = list.filter((o) => COND_NAME_RE.test(condNorm(o.c)));
    if (keep.length && known.length) list = keep;
  }
  if (list.length) return Number(list[0].p || 0) || 0;
  return Number(r.amazon_lowest || 0) || 0;
}
/* 再調達中の行の異変。'loss' は仕入値が上限を超えた（出し直した売値では赤字）、
   'no_offer' は仕入先の出品が消えた（買い直せない）。問題なければ空文字。 */
function restockTrouble(r) {
  if (!isRestocking(r)) return "";
  if (r.amazon_lowest_at == null) return "";        // 最安値をまだ一度も取っていない
  const low = restockLowest(r);
  if (!low || Number(r.amazon_offers || 0) === 0) return "no_offer";
  const max = Number(r.restock_max_cost || 0);
  if (max > 0 && low > max) return "loss";
  return "";
}
function warnOf(r) {
  const w = [];
  if (r.scope !== "ebay") return w;
  const st = stateOf(r);
  if (st === "fba_not_listed" || st === "past") return w;   // 出していないだけ／過去SKU
  const onHand = !!Number(r.on_hand || 0);
  /* 手元在庫の行は、FBAに記録が無いのが正常（納品前にeBayへ出す運用）。
     7〜10日の納品待ちのあいだ警告を出し続けない。 */
  if (st === "listed_no_fba") {
    // 無在庫出品はFBAに記録が無いのが正常
    if (!onHand && !Number(r.dropship || 0)) w.push("FBA在庫なし");
    return w;
  }
  const q = Number(r.ebay_qty || 0), av = Number(r.fba_available || 0);
  const rv = Number(r.fba_reserved || 0), inb = Number(r.fba_inbound || 0);
  /* 再調達中の行は、FBAに在庫が無いまま出しているのが正常。
     売り越し・予約済みのみ・納品待ちは出さず、代わりに値段の異変だけを見る。 */
  /* 無在庫出品は在庫を持たないのが正常。売り越し・予約済みのみ・納品待ちは出さない
     （FBAに在庫が残っているときの数量の食い違いだけは従来どおり出す）。 */
  if (isDropship(r)) {
    if (av > 0 && q > 0 && av < q) w.push("数量の食い違い");
    return w;
  }
  if (isRestocking(r)) {
    const tr = restockTrouble(r);
    if (tr === "loss") w.push("再調達で赤字");
    else if (tr === "no_offer") w.push("再調達の仕入先なし");
    // FBAに在庫が残っていて、それより多くeBayに出している食い違いは従来どおり出す
    if (av > 0 && q > 0 && av < q) w.push("数量の食い違い");
    return w;
  }
  if (av === 0 && rv > 0 && q >= 1) { w.push("予約済みのみ（Amazonで注文済み）"); return w; }
  if (av === 0 && q >= 1) {
    if (onHand) return w;                     // 手元にあるので売り越しではない
    w.push(inb > 0 ? "納品待ちで出品中" : "売り越しの恐れ");
    return w;
  }
  if (av > 0 && q > 0 && av < q) w.push("数量の食い違い");
  return w;
}
async function statusBody(env, url) {
  const p = url.searchParams;
  const scope = p.get("scope") || "ebay";          // 既定は eBay対象だけ
  const limit = Math.min(1000, Math.max(1, Number(p.get("limit") || 500)));
  const where = [], bind = [];
  if (scope !== "all") { where.push("scope=?" + (bind.length + 1)); bind.push(scope); }
  /* 既定では「eBayに出ている」か「FBA在庫が1点以上ある」行だけ。
     在庫0の過去SKU（何千件もある）は ?all=1 のときだけ出す。 */
  if (p.get("all") !== "1") where.push("(ebay_qty IS NOT NULL OR " + SQL_IN_STOCK + ")");
  if (p.get("unmatched") === "1") where.push("(ebay_qty IS NULL OR fba_seen_at IS NULL)");
  if (p.get("state") === "listed_no_fba") where.push("(fba_seen_at IS NULL AND on_hand=0)");
  if (p.get("state") === "fba_not_listed")
    where.push("(ebay_qty IS NULL AND fba_seen_at IS NOT NULL AND " + SQL_IN_STOCK + ")");
  if (p.get("state") === "restocking")
    where.push("(restocking=1 AND ebay_qty>=1)");
  else if (p.get("state") === "dropship")
    where.push("(dropship=1 AND ebay_qty>=1)");
  if (p.get("state") === "restock")
    where.push("(ebay_qty>=1 AND fba_available=0 AND one_off=0 AND on_hand=0 AND dropship=0)");
  if (p.get("state") === "past")
    where.push("(ebay_qty IS NULL AND fba_seen_at IS NOT NULL AND NOT " + SQL_IN_STOCK + ")");
  /* eBayでの販売実績（直近180日）。手元在庫の行を
     「eBayで売れた（FBAに送らない）」と「未販売（FBAに送る候補）」に分けるために使う。 */
  const soldSince = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const sql = `SELECT ${ITEM_COLS},
      (SELECT COALESCE(SUM(qty),0) FROM orders o
        WHERE o.channel='ebay' AND o.asin=items.asin AND o.cond=items.cond
          AND o.ordered_at>=?${bind.length + 1}) AS ebay_sold,
      -- せどりすとSKUの接頭辞（game / hobby / toy …）。既定重量の振り分けに使う
      (SELECT s.prefix FROM skus s
        WHERE s.asin=items.asin AND s.cond=items.cond AND s.prefix<>'' LIMIT 1) AS prefix
    FROM items`
    + (where.length ? " WHERE " + where.join(" AND ") : "")
    + " ORDER BY updated_at DESC LIMIT " + limit;
  bind.push(soldSince);
  const q = await env.DB.prepare(sql).bind(...bind).all();
  let items = ((q && q.results) || []).map((r) =>
    Object.assign({}, r, { state: stateOf(r), restock: isRestock(r) ? 1 : 0,
                           restocking: isRestocking(r) ? 1 : 0,
                           restock_trouble: restockTrouble(r),
                           warnings: warnOf(r) }));
  if (p.get("warn") === "1") items = items.filter((x) => x.warnings.length);
  const st = p.get("state");
  // restock / restocking は state の値ではなく別の条件なので、行に付けた印で絞る
  if (st === "restock") items = items.filter((x) => x.restock);
  else if (st === "restocking") items = items.filter((x) => x.restocking);
  // 無在庫も state の値ではないので、ここで分けて絞る（state 比較に落とすと0件になる）
  else if (st === "dropship") items = items.filter((x) => isDropship(x));
  else if (st) items = items.filter((x) => x.state === st);

  const soldH = Math.min(24 * 14, Math.max(1, Number(p.get("sold") || 24)));
  const since = new Date(Date.now() - soldH * 3600 * 1000).toISOString();
  const sold = await env.DB.prepare(
    `SELECT channel, order_id, sku, asin, cond, qty, amount, currency, ordered_at, status
     FROM orders WHERE ordered_at>=?1 ORDER BY ordered_at DESC LIMIT 200`).bind(since).all();

  /* 数え方（どれも items の行数。items は ASIN＋新品/中古で1行）
       ebay              … eBay対象カテゴリの行すべて（在庫0の過去SKUも含む）
       ebay_in_stock     … そのうちFBA在庫が1点以上ある行
       listed            … eBayに出ている行（数量0の終了分も含む）
       listed_no_fba     … eBayに出ているのにFBAの記録が無い行（要注意）
       fba_not_listed    … FBA在庫が1点以上あってeBayに出していない行（通常）
       past_zero         … FBAの記録はあるが在庫0で、eBayにも出していない行 */
  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM items WHERE scope='ebay') AS ebay,
       (SELECT COUNT(*) FROM items WHERE scope='ebay' AND ${SQL_IN_STOCK}) AS ebay_in_stock,
       (SELECT COUNT(*) FROM items WHERE scope='ebay' AND ebay_qty IS NOT NULL) AS listed,
       (SELECT COUNT(*) FROM items WHERE scope='out') AS out_of_scope,
       (SELECT COUNT(*) FROM items WHERE scope='unknown') AS unknown,
       -- 手元在庫の行は納品前が正常なので数えない
       (SELECT COUNT(*) FROM items WHERE scope='ebay' AND fba_seen_at IS NULL AND on_hand=0)
         AS listed_no_fba,
       (SELECT COUNT(*) FROM items WHERE scope='ebay'
          AND ebay_qty IS NULL AND fba_seen_at IS NOT NULL AND ${SQL_IN_STOCK})
         AS fba_not_listed,
       (SELECT COUNT(*) FROM items WHERE scope='ebay'
          AND ebay_qty IS NULL AND fba_seen_at IS NOT NULL AND NOT ${SQL_IN_STOCK})
         AS past_zero,
       (SELECT COUNT(*) FROM items WHERE scope='ebay' AND on_hand=1) AS on_hand,
       -- 再調達の候補：eBay出品中・FBAの販売可能が0・一点物でない・手元在庫でない
       -- （すでに再調達で出し直した行は切り替え済みなので候補から外す）
       (SELECT COUNT(*) FROM items WHERE scope='ebay' AND ebay_qty>=1
          AND fba_available=0 AND one_off=0 AND on_hand=0
          AND restocking=0 AND dropship=0) AS restock,
       -- 再調達中：再調達CSVで出し直して、まだeBayに出ている行
       (SELECT COUNT(*) FROM items WHERE scope='ebay' AND ebay_qty>=1
          AND restocking=1) AS restocking,
       -- 無在庫：いまeBayに出ている無在庫出品の件数（上限の見張りに使う）
       (SELECT COUNT(*) FROM items WHERE scope='ebay' AND ebay_qty>=1
          AND dropship=1) AS dropship,
       (SELECT COUNT(*) FROM skus WHERE active=1 AND scope='ebay') AS roster,
       (SELECT CAST(COALESCE((SELECT v FROM sync_state WHERE k='ebay.unparsed'),'0') AS INTEGER))
         AS ebay_unparsed`).first();

  const runs = await env.DB.prepare(
    `SELECT kind, started_at, elapsed_ms, subrequests, pages, skus, rows_written, events, errors, note
     FROM sync_runs ORDER BY id DESC LIMIT 6`).all();
  const ev = await env.DB.prepare(
    `SELECT type, asin, cond, sku, detail, created_at, notified_at
     FROM events ORDER BY id DESC LIMIT 30`).all();

  return {
    generated_at: nowIso(),
    counts: counts || {},
    last_runs: (runs && runs.results) || [],
    errors_recent: ((runs && runs.results) || []).some((r) => r.errors > 0),
    items,
    sold_recent: (sold && sold.results) || [],
    events_recent: (ev && ev.results) || [],
  };
}

/* ---- GET /orders/summary ----
   受け入れテストで Seller Central の件数と突き合わせるための内訳。
   注文一覧は LastUpdatedAfter で引いているので、期間内に「更新」があった注文が
   すべて入る。注文日が期間より前のものは in_window に入らない。 */
async function ordersSummary(env, url) {
  const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days") || 7)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const one = async (sql, ...bind) => {
    const r = await env.DB.prepare(sql).bind(...bind).all();
    const o = {};
    for (const x of (r && r.results) || []) o[x.k === null ? "(なし)" : String(x.k)] = x.n;
    return o;
  };
  const total = await env.DB.prepare(
    `SELECT COUNT(DISTINCT order_id) AS n FROM orders WHERE channel='amazon'`).first();
  const win = await env.DB.prepare(
    `SELECT COUNT(DISTINCT order_id) AS n FROM orders
     WHERE channel='amazon' AND ordered_at>=?1`).bind(since).first();
  const older = await env.DB.prepare(
    `SELECT COUNT(DISTINCT order_id) AS n FROM orders
     WHERE channel='amazon' AND (ordered_at<?1 OR ordered_at IS NULL)`).bind(since).first();
  const saleWin = await env.DB.prepare(
    `SELECT COUNT(DISTINCT order_id) AS n FROM orders
     WHERE channel='amazon' AND ordered_at>=?1 AND (kind='sale' OR kind IS NULL)`
  ).bind(since).first();
  // キャンセル・販売不可を除いた数（FBA_SOLD の対象になる注文）
  const saleWinLive = await env.DB.prepare(
    `SELECT COUNT(DISTINCT order_id) AS n FROM orders
     WHERE channel='amazon' AND ordered_at>=?1 AND (kind='sale' OR kind IS NULL)
       AND status NOT IN ('Canceled','Unfulfillable')`).bind(since).first();
  return {
    since, days,
    total_orders: Number((total && total.n) || 0),
    by_purchase_window: {
      in_window: Number((win && win.n) || 0),
      older_but_updated: Number((older && older.n) || 0),
    },
    by_status: await one(
      `SELECT status AS k, COUNT(DISTINCT order_id) AS n FROM orders
       WHERE channel='amazon' GROUP BY status ORDER BY n DESC`),
    by_sales_channel: await one(
      `SELECT sales_channel AS k, COUNT(DISTINCT order_id) AS n FROM orders
       WHERE channel='amazon' GROUP BY sales_channel ORDER BY n DESC`),
    by_kind: await one(
      `SELECT kind AS k, COUNT(DISTINCT order_id) AS n FROM orders
       WHERE channel='amazon' GROUP BY kind ORDER BY n DESC`),
    sale_in_window: Number((saleWin && saleWin.n) || 0),
    sale_in_window_live: Number((saleWinLive && saleWinLive.n) || 0),
    queue_pending: Number(((await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM order_queue WHERE done_at IS NULL`).first()) || {}).n || 0),
    note: "sales_channel が (なし) の行は、販売経路を持たせる前に取り込んだもの。"
        + " /sync {\"kind\":\"orders\",\"days\":7} をもう一度実行すると"
        + "（明細は取り直さずに）埋まる。",
  };
}

/* ---- POST /listings（pj_price からの名簿登録） ---- */
/* 送られてこなかった項目は変えない（null を渡して COALESCE で残す）。
   手元在庫の入/切だけを送る呼び出し（ASIN＋新品/中古のみ）でも、
   モード・一点物・FBA連動を0に戻してしまわないようにするため。 */
function flagOf(x, key) {
  return Object.prototype.hasOwnProperty.call(x, key) ? (x[key] ? 1 : 0) : null;
}
/* 数字の項目。送られてこなければ null（既存の値をそのまま残す）。 */
function numOf(x, key) {
  if (!Object.prototype.hasOwnProperty.call(x, key)) return null;
  const n = Number(x[key]);
  return isFinite(n) && n > 0 ? n : null;
}
async function putListings(env, body) {
  const run = newRun("listings");
  const list = Array.isArray(body && body.items) ? body.items.slice(0, 500) : [];
  const stmts = [];
  let bad = 0;
  for (const x of list) {
    const sku = String(x.sku || "").trim();
    const label = String(x.custom_label || "").trim();
    const p = sku ? parseSku(sku) : null;
    /* キーの決め方は3通り。SKU → CustomLabel → ASIN＋新品/中古 を直接指定。
       3つめは、出品リストに無い（以前に出した）商品の印を付け替えるために使う。 */
    /* CustomLabel から読んだ結果。SKUでキーが決まる行でも、M- の判定にはこちらを使う
       （名簿では せどりすとSKU と CustomLabel の両方が送られてくる）。 */
    const lab = parseLabel(label);
    let k = (p && p.ok) ? { asin: p.asin, cond: p.cond, scope: p.scope } : lab;
    if ((!k || !k.asin) && /^B[0-9A-Z]{9}$/.test(String(x.asin || "").trim())) {
      k = { asin: String(x.asin).trim(),
            cond: (String(x.cond || "") === "used") ? "used" : "new",
            scope: "" };     // scope は既存の値を尊重する（itemSeed が上書きしない）
    }
    if (!k || !k.asin) { bad++; continue; }
    if (sku) {
      stmts.push(env.DB.prepare(
        `INSERT INTO skus (seller_sku, asin, cond, cond_code, prefix, scope, purchased_on, cost,
           ebay_custom_label, title, active, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11)
         ON CONFLICT(seller_sku) DO UPDATE SET
           ebay_custom_label=excluded.ebay_custom_label,
           title=COALESCE(NULLIF(excluded.title,''), skus.title),
           updated_at=excluded.updated_at`
      ).bind(sku, k.asin, k.cond, (p && p.condCode) || "", (p && p.prefix) || "", k.scope,
             (p && p.purchasedOn) || "", (p && p.cost) || null, label,
             String(x.title || ""), nowIso()));
    }
    stmts.push(itemSeed(env, k.asin, k.cond, k.scope || "unknown", String(x.title || "")));
    stmts.push(env.DB.prepare(
      `UPDATE items SET mode=COALESCE(?3, mode),
         one_off=COALESCE(?4, one_off),
         -- 一点物の指定が来たら「人が決めた」印も立てる
         one_off_known=CASE WHEN ?4 IS NULL THEN one_off_known ELSE 1 END,
         fba_link=COALESCE(?5, fba_link),
         /* 無在庫の印。CustomLabel が M- の行は自動で立て、
            それ以外は送られてきた指定（?14）に従う。 */
         dropship=CASE WHEN ?15=1 THEN 1 ELSE COALESCE(?14, dropship) END,
         ebay_item_id=COALESCE(NULLIF(?6,''), ebay_item_id),
         ebay_sku=COALESCE(NULLIF(?7,''), ebay_sku),
         -- 在庫が1点以上ある行は、送られてきても手元在庫にしない
         on_hand=CASE WHEN ${SQL_IN_STOCK} THEN 0 ELSE COALESCE(?9, on_hand) END,
         /* 再調達中の印と、その監視用の数字。印を下ろしたらまとめて消す。
            送られてこなければ（?13 IS NULL）いまの値をそのまま残す。 */
         restocking=COALESCE(?13, restocking),
         restock_at=CASE WHEN ?13=1 THEN ?8 WHEN ?13=0 THEN NULL ELSE restock_at END,
         -- 印を下ろすときだけ消す。それ以外は送られてきた項目だけを書き替える。
         restock_price=CASE WHEN ?13=0 THEN NULL ELSE COALESCE(?10, restock_price) END,
         restock_max_cost=CASE WHEN ?13=0 THEN NULL ELSE COALESCE(?11, restock_max_cost) END,
         restock_skip_acc=CASE WHEN ?13=0 THEN NULL ELSE COALESCE(?12, restock_skip_acc) END,
         updated_at=?8
       WHERE asin=?1 AND cond=?2`
    ).bind(k.asin, k.cond, x.mode ? String(x.mode) : null,
           flagOf(x, "one_off"), flagOf(x, "fba_link"),
           String(x.item_id || ""), label, nowIso(), flagOf(x, "on_hand"),
           numOf(x, "restock_price"), numOf(x, "restock_max_cost"),
           flagOf(x, "restock_skip_acc"), flagOf(x, "restocking"),
           flagOf(x, "dropship"), lab.dropship ? 1 : 0));
  }
  await runBatch(env, run, stmts);
  run.notes.push("名簿 " + (list.length - bad) + "件を登録" + (bad ? ("／" + bad + "件は解析不可") : ""));
  const info = await saveRun(env, run);
  return { accepted: list.length - bad, rejected: bad, run: info };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (origin && origin !== ALLOW_ORIGIN) return json({ error: "forbidden_origin" }, 403, origin);
    if (!authorized(request, env)) return json({ error: "unauthorized" }, 401, origin);
    if (!env.DB) return json({ error: "server_misconfigured", detail: "DB" }, 500, origin);
    if (!env.SYNC_CACHE) return json({ error: "server_misconfigured", detail: "SYNC_CACHE" }, 500, origin);

    try {
      if (request.method === "GET" && url.pathname === "/status")
        return json(await statusBody(env, url), 200, origin);

      if (request.method === "GET" && url.pathname === "/orders/summary")
        return json(await ordersSummary(env, url), 200, origin);

      if (request.method === "GET" && url.pathname === "/runs") {
        const r = await env.DB.prepare(
          `SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?1`
        ).bind(Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)))).all();
        return json({ runs: (r && r.results) || [] }, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/listings") {
        let body; try { body = await request.json(); }
        catch (e) { return json({ error: "bad_request" }, 400, origin); }
        return json(await putListings(env, body), 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/sync") {
        let body = {}; try { body = await request.json(); } catch (e) { body = {}; }
        const kind = String(body.kind || "orders");
        const days = Number(body.days || 0);
        if (kind === "orders")
          return json(await jobOrders(env, days, Number(body.max || 0)), 200, origin);
        if (kind === "inventory") return json(await jobHourly(env), 200, origin);
        if (kind === "rollcall")  return json(await jobDaily(env), 200, origin);
        if (kind === "sweep")
          return json(await jobSweep(env, Number(body.days || 0)), 200, origin);
        if (kind === "notify")    return json(await jobNotify(env), 200, origin);
        if (kind === "onhand-clean") return json(await jobOnHandClean(env), 200, origin);
        if (kind === "test-notify")
          return json(await jobTestNotify(env, body.tag), 200, origin);
        if (kind === "pricing") {
          const run = newRun("pricing");
          try { await syncPricing(env, run); }
          catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
          return json(await saveRun(env, run), 200, origin);
        }
        return json({ error: "bad_kind" }, 400, origin);
      }
    } catch (e) {
      return json({ error: "server_error", detail: e.message }, 500, origin);
    }
    return json({ error: "not_found" }, 404, origin);
  },

  async scheduled(event, env, ctx) {
    const cron = String(event.cron || "");
    if (cron.indexOf("*/15") === 0) { ctx.waitUntil(jobOrders(env, 0)); return; }
    // 毎時。UTC 18時台（JST 3時台）の回で日次処理も回す。
    ctx.waitUntil((async () => {
      await jobHourly(env);
      if (new Date().getUTCHours() === DAILY_UTC_HOUR) await jobDaily(env);
    })());
  },
};

/* 受け入れテスト用に、外部通信を伴わない小さな関数だけ公開する。
   本番の動きには関与しない（fetch / scheduled からは使わない）。 */
export const __test = { assertReadOnly, parseSku, parseLabel, warnOf,
                        isDropship, isRestock, stateEvents, EV_TEXT, daysLeft, dueText };
