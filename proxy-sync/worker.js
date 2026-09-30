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
const EBAY_PAGE = 200;             // GetMyeBaySelling の1ページ件数
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
   E-<ASIN> / E-<ASIN>-U（FBA連動）と、せどりすとSKUそのまま（一点物）の両方に対応する。 */
function parseLabel(label) {
  const s = String(label || "").trim();
  let m = /^E-(B[0-9A-Z]{9})(-U)?$/i.exec(s);
  if (m) return { ok: true, asin: m[1].toUpperCase(), cond: m[2] ? "used" : "new",
                  scope: "ebay", from: "stable" };
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
      return { ok: false, status: 0, data: null, quota: false };
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
    run.errors++;
    run.notes.push(o.label + " -> " + resp.status);
    return { ok: false, status: resp.status, data: null, quota: isQuota(resp.status, text) };
  }
  return { ok: false, status: 429, data: null, quota: true };
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
      out.push({
        orderId: String(o.AmazonOrderId || ""),
        status: String(o.OrderStatus || ""),
        at: String(o.PurchaseDate || ""),
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
function invQuery(mode, arg) {
  const q = new URLSearchParams({
    details: "true", granularityType: "Marketplace", granularityId: MP_FE, marketplaceIds: MP_FE,
  });
  if (mode === "since") q.set("startDateTime", arg);
  else if (mode === "skus") for (const s of arg) q.append("sellerSkus", s);
  else if (mode === "token" && arg) q.set("nextToken", arg);
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
async function fbaInventory(env, run, mode, arg, maxPages) {
  const rows = [];
  let token = mode === "token" ? arg : "";
  let first = true;
  for (let page = 0; page < (maxPages || 1); page++) {
    const q = (first && mode !== "token") ? invQuery(mode, arg) : invQuery("token", token);
    first = false;
    const r = await spCall(env, run, "/fba/inventory/v1/summaries?" + q.toString(),
                           { label: "getInventorySummaries" });
    if (!r.ok) return { rows, next: token, ok: false };
    run.pages++;
    const p = (r.data && r.data.payload) || {};
    for (const s of p.inventorySummaries || []) rows.push(invRow(s));
    token = (r.data && r.data.pagination && r.data.pagination.nextToken) || "";
    if (!token) break;
  }
  run.skus += rows.length;
  return { rows, next: token, ok: true };
}

/* Amazon最安値（参考表示用）。読み取りだがPOSTしか無いAPI。 */
async function amazonLowest(env, run, keys) {
  const out = {};
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
      const b = res.body || {};
      const p = b.payload || {};
      const asin = String(p.ASIN || (p.Identifier && p.Identifier.ASIN) || "");
      const cond = /used/i.test(String(p.ItemCondition || (p.Identifier && p.Identifier.ItemCondition) || ""))
        ? "used" : "new";
      let low = null;
      for (const o of p.Offers || []) {
        const v = Number((o.ListingPrice && o.ListingPrice.Amount) || 0)
                + Number((o.Shipping && o.Shipping.Amount) || 0);
        if (v > 0 && (low === null || v < low)) low = v;
      }
      if (asin && low !== null) out[asin + "|" + cond] = low;
    }
  }
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
          qty: Number(li.quantity || 0),
          amount: Number((li.total && li.total.value) || 0),
          currency: String((li.total && li.total.currency) || "USD"),
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
   OutputSelector で必要な項目だけに絞る。XMLの解析はWorkersに DOMParser が無いので
   Item ブロックを切り出してタグを拾う（CPUを使う処理なので項目を最小にしてある）。 */
function tradingBody(page) {
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">'
    + "<ActiveList><Include>true</Include>"
    + "<Pagination><EntriesPerPage>" + EBAY_PAGE + "</EntriesPerPage>"
    + "<PageNumber>" + page + "</PageNumber></Pagination></ActiveList>"
    + "<OutputSelector>ActiveList.ItemArray.Item.ItemID</OutputSelector>"
    + "<OutputSelector>ActiveList.ItemArray.Item.SKU</OutputSelector>"
    + "<OutputSelector>ActiveList.ItemArray.Item.Title</OutputSelector>"
    + "<OutputSelector>ActiveList.ItemArray.Item.QuantityAvailable</OutputSelector>"
    + "<OutputSelector>ActiveList.ItemArray.Item.SellingStatus.CurrentPrice</OutputSelector>"
    + "<OutputSelector>ActiveList.PaginationResult</OutputSelector>"
    + "<OutputSelector>Ack</OutputSelector><OutputSelector>Errors</OutputSelector>"
    + "</GetMyeBaySellingRequest>";
}
const xmlTag = (s, tag) => {
  const m = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">").exec(s);
  return m ? m[1] : "";
};
const xmlAttr = (s, tag, attr) => {
  const m = new RegExp("<" + tag + "[^>]*\\b" + attr + '="([^"]*)"').exec(s);
  return m ? m[1] : "";
};
async function ebayActive(env, run) {
  const token = await ebayToken(env, run);
  const rows = [];
  let pages = 1;
  for (let page = 1; page <= Math.min(pages, EBAY_MAX_PAGES); page++) {
    const resp = await net(run, EBAY_API + "/ws/api.dll", {
      method: "POST",
      headers: {
        "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-IAF-TOKEN": token,     // OAuthトークンはこのヘッダーで渡す
        "content-type": "text/xml",
      },
      body: tradingBody(page),
    });
    const xml = await resp.text();
    if (!resp.ok || /<Ack>Failure<\/Ack>/.test(xml)) {
      run.errors++;
      run.notes.push("GetMyeBaySelling -> " + resp.status + " "
        + (xmlTag(xml, "ShortMessage") || "").slice(0, 120));
      return { rows, ok: false };
    }
    run.pages++;
    const active = xmlTag(xml, "ActiveList");
    const pr = xmlTag(active, "PaginationResult");
    if (pr) pages = Number(xmlTag(pr, "TotalNumberOfPages") || 1);
    const re = /<Item>([\s\S]*?)<\/Item>/g;
    let m;
    while ((m = re.exec(active))) {
      const b = m[1];
      const price = xmlTag(b, "CurrentPrice");
      rows.push({
        itemId: xmlTag(b, "ItemID"),
        sku: xmlTag(b, "SKU"),
        title: xmlTag(b, "Title"),
        qty: Number(xmlTag(b, "QuantityAvailable") || 0),
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
const EV_IMMEDIATE = { EBAY_SOLD: 1, OVERSELL_RISK: 1 };
const EV_TEXT = {
  FBA_SOLD: (d) => "FBAで売れた：" + d.title + " / eBay残数 " + d.ebay_qty
    + "。フェイズBではここでeBayを更新します",
  EBAY_SOLD: (d) => "eBayで売れた：" + d.title + " / FBA販売可能 " + d.fba_available
    + "。MCFでの取り寄せが必要です",
  OVERSELL_RISK: (d) => "売り越しの恐れ：" + d.title + "（FBA 0 / eBay " + d.ebay_qty + "）",
  QTY_MISMATCH: (d) => "数量の食い違い：" + d.title + "（FBA " + d.fba_available
    + " / eBay " + d.ebay_qty + "）",
  INBOUND_LISTED: (d) => "納品待ちの商品がeBayに出ています：" + d.title,
  UNMATCHED: (d) => "未対応付け：新規 " + d.added + "件（合計 " + d.total
    + "件）。一覧で確認してください",
};
function evStmt(env, type, key, item, detail) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO events (type, asin, cond, sku, dedup_key, detail, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7)`
  ).bind(type, (item && item.asin) || null, (item && item.cond) || null,
         (item && item.ebay_sku) || null, key,
         JSON.stringify(detail || {}), nowIso());
}
const dayKey = () => nowIso().slice(0, 10);

/* 在庫・出品の状態から食い違い系のイベントを作る。
   同じ日に同じ内容は1回だけ（dedup_key に日付を入れる）。 */
function stateEvents(env, rows) {
  const out = [];
  for (const r of rows) {
    if (r.scope !== "ebay") continue;                 // eBay対象外・不明は通知しない
    const q = Number(r.ebay_qty || 0), av = Number(r.fba_available || 0);
    const inb = Number(r.fba_inbound || 0);
    if (r.ebay_qty === null || r.fba_seen_at == null) continue;  // 片側しか無い行は UNMATCHED 側で扱う
    const d = { title: r.title || r.ebay_sku || r.asin, ebay_qty: q,
                fba_available: av, fba_inbound: inb, mode: r.mode || "" };
    const base = "|" + r.asin + "|" + r.cond + "|" + dayKey();
    if (av === 0 && q >= 1 && (r.mode === "hold" || r.mode === "end" || !r.mode))
      out.push(evStmt(env, "OVERSELL_RISK", "OVERSELL_RISK" + base, r, d));
    if (av > 0 && q > 0 && av < q)
      out.push(evStmt(env, "QTY_MISMATCH", "QTY_MISMATCH" + base, r, d));
    if (av === 0 && inb > 0 && q >= 1)
      out.push(evStmt(env, "INBOUND_LISTED", "INBOUND_LISTED" + base, r, d));
  }
  return out;
}
// 一覧の1行を作るための共通SELECT
const ITEM_COLS = `asin, cond, scope, title, ebay_item_id, ebay_sku, ebay_qty, ebay_price,
  ebay_currency, ebay_seen_at, fba_available, fba_inbound, fba_reserved, fba_seen_at,
  mode, one_off, fba_link, amazon_lowest, amazon_lowest_at, updated_at`;

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
  const lines = [];
  for (const x of pick) {
    let d = {};
    try { d = JSON.parse(x.detail || "{}"); } catch (e) { d = {}; }
    const f = EV_TEXT[x.type];
    lines.push("・" + (f ? f(d) : x.type));
  }
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
      `INSERT INTO order_queue (order_id, status, ordered_at, tries, updated_at)
       VALUES (?1,?2,?3,0,?4)
       ON CONFLICT(order_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`
    ).bind(o.orderId, o.status, o.at, nowIso()));
    // 明細を取り直さずに状態だけ反映する（数量・金額は変わらない）
    qs.push(env.DB.prepare(
      `UPDATE orders SET status=?2 WHERE channel='amazon' AND order_id=?1`
    ).bind(o.orderId, o.status));
  }
  await runBatch(env, run, qs);

  /* 2) eBayの注文 */
  const keys = [], soldE = [];
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
        soldE.push({ asin: k.asin, cond: k.cond, orderId: o.orderId, line: li.lineId });
      }
    }
  }
  await runBatch(env, run, estmts);

  /* 3) Amazonの明細を待ち行列から取る。上限件数と時間で打ち切り、残りは次回。 */
  const pend = await env.DB.prepare(
    `SELECT order_id, status, ordered_at FROM order_queue
     WHERE done_at IS NULL ORDER BY ordered_at LIMIT ?1`
  ).bind(cap).all();
  const queue = (pend && pend.results) || [];
  const t0 = Date.now();
  const soldA = [];
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
           ordered_at,status,created_at) VALUES ('amazon',?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
         ON CONFLICT(channel,order_id,line_id) DO UPDATE SET
           qty=excluded.qty, amount=excluded.amount, status=excluded.status`
      ).bind(row.order_id, li.lineId, li.sku, asin, cond, li.qty, li.amount, li.currency,
             row.ordered_at, row.status, nowIso()));
      if (asin) {
        stmts.push(itemSeed(env, asin, cond, p.scope, ""));
        keys.push({ asin, cond });
        soldA.push({ asin, cond, orderId: row.order_id, sku: li.sku });
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
  for (const s2 of soldE) {
    const it = map[s2.asin + "|" + s2.cond] || { asin: s2.asin, cond: s2.cond, scope: "ebay" };
    ev.push(evStmt(env, "EBAY_SOLD", "EBAY_SOLD|" + s2.orderId + "|" + s2.line, it,
      { title: it.title || s2.asin, fba_available: it.fba_available || 0,
        ebay_qty: it.ebay_qty || 0 }));
  }
  await runBatch(env, run, ev);

  /* 5) 差分の基準時刻を進める。明細が残っていても待ち行列で追いかけるので進めてよい。 */
  if (a.ok) await stateSet(env, "orders.amazon.since", new Date(nowMs - 60 * 1000).toISOString()).run();
  if (e.ok) await stateSet(env, "orders.ebay.since", new Date(nowMs - 60 * 1000).toISOString()).run();
  run.notes.push("Amazon注文 " + a.orders.length + "件 / eBay注文 " + e.orders.length + "件"
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
  return Object.values(keys);
}

// 1時間ごと。startDateTime による差分。入庫中の数量変化は拾えない（日次の名指しで補う）。
async function syncInventoryDiff(env, run) {
  const since = (await stateGet(env, "inventory.since"))
    || new Date(Date.now() - INV_LOOKBACK_MS).toISOString();
  const nowMs = Date.now();
  const r = await fbaInventory(env, run, "since", since, 20);
  const keys = await writeInventory(env, run, r.rows);
  if (r.ok) await stateSet(env, "inventory.since", new Date(nowMs - 60 * 1000).toISOString()).run();
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

/* 手動。全件スイープ。nextToken をD1に置いて数ページずつ進める。 */
async function syncSweep(env, run) {
  const token = await stateGet(env, "sweep.token");
  const r = token
    ? await fbaInventory(env, run, "token", token, SWEEP_PAGES)
    : await fbaInventory(env, run, "since", new Date(Date.now() - 540 * 24 * 60 * 60 * 1000).toISOString(), SWEEP_PAGES);
  const keys = await writeInventory(env, run, r.rows);
  await stateSet(env, "sweep.token", r.next || "").run();
  await stateSet(env, "sweep.at", nowIso()).run();
  run.notes.push(r.next ? "続きあり（次回に継続）" : "全件スイープ完了");
  return keys;
}

/* 1時間ごと。eBayの出品中リスト。ActiveList に無くなった行は数量0にする。 */
async function syncEbayActive(env, run) {
  const runAt = nowIso();
  const r = await ebayActive(env, run);
  const stmts = [], keys = [];
  for (const it of r.rows) {
    const k = parseLabel(it.sku);
    if (!k.ok) { run.notes.push("CustomLabel解析不可 " + it.sku); continue; }
    stmts.push(itemSeed(env, k.asin, k.cond, k.scope, it.title));
    stmts.push(env.DB.prepare(
      `UPDATE items SET ebay_item_id=?3, ebay_sku=?4, ebay_qty=?5, ebay_price=?6,
         ebay_currency=?7, ebay_seen_at=?8, title=COALESCE(NULLIF(title,''),?9), updated_at=?8
       WHERE asin=?1 AND cond=?2`
    ).bind(k.asin, k.cond, it.itemId, it.sku, it.qty, it.price, it.currency, runAt, it.title));
    keys.push({ asin: k.asin, cond: k.cond });
  }
  await runBatch(env, run, stmts);
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
    `SELECT asin, cond FROM items WHERE scope='ebay' AND ebay_qty>0 ORDER BY amazon_lowest_at IS NOT NULL,
       amazon_lowest_at LIMIT ?1`
  ).bind(PRICING_BATCH * PRICING_MAX_CALLS).all();
  const keys = (q && q.results) || [];
  if (!keys.length) return 0;
  const low = await amazonLowest(env, run, keys);
  const at = nowIso();
  const stmts = [];
  for (const k of keys) {
    const v = low[k.asin + "|" + k.cond];
    if (v === undefined) continue;
    stmts.push(env.DB.prepare(
      `UPDATE items SET amazon_lowest=?3, amazon_lowest_at=?4, updated_at=?4
       WHERE asin=?1 AND cond=?2`).bind(k.asin, k.cond, v, at));
  }
  await runBatch(env, run, stmts);
  run.notes.push("最安値 " + stmts.length + "件");
  return stmts.length;
}

/* 日次。未対応付けの件数だけ通知する（中身は一覧で見る）。
   scope が out / unknown の行は数にも入れない。 */
async function syncUnmatched(env, run) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM items
     WHERE scope='ebay' AND (ebay_qty IS NULL OR fba_seen_at IS NULL)`
  ).first();
  const total = Number((r && r.n) || 0);
  const prev = Number((await stateGet(env, "unmatched.total")) || 0);
  const added = Math.max(0, total - prev);
  await stateSet(env, "unmatched.total", String(total)).run();
  if (added > 0) {
    await runBatch(env, run, [evStmt(env, "UNMATCHED", "UNMATCHED|" + dayKey(), null,
      { added, total })]);
  }
  run.notes.push("未対応付け 合計" + total + "件（新規" + added + "件）");
  return { total, added };
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
    await syncUnmatched(env, run);
    await flushEvents(env, run, false);
  } catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
  return saveRun(env, run);
}
async function jobSweep(env) {
  const run = newRun("sweep");
  try { await syncSweep(env, run); }
  catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
  return saveRun(env, run);
}
async function jobNotify(env) {
  const run = newRun("notify");
  try { await flushEvents(env, run, false); }
  catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
  return saveRun(env, run);
}

/* ---- GET /status ---- */
function warnOf(r) {
  const w = [];
  const q = r.ebay_qty, av = r.fba_available;
  if (r.scope === "ebay") {
    if (q === null || r.fba_seen_at === null) w.push("未対応付け");
    else {
      if (av === 0 && q >= 1) w.push(Number(r.fba_inbound || 0) > 0 ? "納品待ちで出品中" : "売り越しの恐れ");
      else if (av > 0 && q > 0 && av < q) w.push("数量の食い違い");
    }
  }
  return w;
}
async function statusBody(env, url) {
  const p = url.searchParams;
  const scope = p.get("scope") || "ebay";          // 既定は eBay対象だけ
  const limit = Math.min(1000, Math.max(1, Number(p.get("limit") || 500)));
  const where = [], bind = [];
  if (scope !== "all") { where.push("scope=?" + (bind.length + 1)); bind.push(scope); }
  if (p.get("unmatched") === "1") where.push("(ebay_qty IS NULL OR fba_seen_at IS NULL)");
  const sql = `SELECT ${ITEM_COLS} FROM items`
    + (where.length ? " WHERE " + where.join(" AND ") : "")
    + " ORDER BY updated_at DESC LIMIT " + limit;
  const q = await env.DB.prepare(sql).bind(...bind).all();
  let items = ((q && q.results) || []).map((r) => Object.assign({}, r, { warnings: warnOf(r) }));
  if (p.get("warn") === "1") items = items.filter((x) => x.warnings.length);

  const soldH = Math.min(24 * 14, Math.max(1, Number(p.get("sold") || 24)));
  const since = new Date(Date.now() - soldH * 3600 * 1000).toISOString();
  const sold = await env.DB.prepare(
    `SELECT channel, order_id, sku, asin, cond, qty, amount, currency, ordered_at, status
     FROM orders WHERE ordered_at>=?1 ORDER BY ordered_at DESC LIMIT 200`).bind(since).all();

  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM items WHERE scope='ebay') AS ebay,
       (SELECT COUNT(*) FROM items WHERE scope='out') AS out_of_scope,
       (SELECT COUNT(*) FROM items WHERE scope='unknown') AS unknown,
       (SELECT COUNT(*) FROM items WHERE scope='ebay'
          AND (ebay_qty IS NULL OR fba_seen_at IS NULL)) AS unmatched,
       (SELECT COUNT(*) FROM skus WHERE active=1 AND scope='ebay') AS roster`).first();

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

/* ---- POST /listings（pj_price からの名簿登録） ---- */
async function putListings(env, body) {
  const run = newRun("listings");
  const list = Array.isArray(body && body.items) ? body.items.slice(0, 500) : [];
  const stmts = [];
  let bad = 0;
  for (const x of list) {
    const sku = String(x.sku || "").trim();
    const label = String(x.custom_label || "").trim();
    const p = sku ? parseSku(sku) : null;
    const k = (p && p.ok) ? { asin: p.asin, cond: p.cond, scope: p.scope } : parseLabel(label);
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
    stmts.push(itemSeed(env, k.asin, k.cond, k.scope, String(x.title || "")));
    stmts.push(env.DB.prepare(
      `UPDATE items SET mode=COALESCE(?3, mode), one_off=?4, fba_link=?5,
         ebay_item_id=COALESCE(NULLIF(?6,''), ebay_item_id),
         ebay_sku=COALESCE(NULLIF(?7,''), ebay_sku), updated_at=?8
       WHERE asin=?1 AND cond=?2`
    ).bind(k.asin, k.cond, x.mode ? String(x.mode) : null, x.one_off ? 1 : 0, x.fba_link ? 1 : 0,
           String(x.item_id || ""), label, nowIso()));
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
        if (kind === "sweep")     return json(await jobSweep(env), 200, origin);
        if (kind === "notify")    return json(await jobNotify(env), 200, origin);
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
export const __test = { assertReadOnly, parseSku, parseLabel, warnOf };
