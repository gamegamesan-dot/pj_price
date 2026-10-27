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
 *   PJ_ACCESS_KEY            … pj_price から送る共有キー（ヘッダー X-PJ-Key・管理者）
 *   STAFF_KEY                … 作業者用のキー（読み取りと名簿の送信だけ。7.40）
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

/* 値付けの式。pj_price（index.html）と**同じファイル**を読む（C段・2026-10-20）。
   式はあちらだけにあり、ここでは PRICING 越しに呼ぶ。
   wrangler（esbuild）が module.exports を取り込むので、import でそのまま使える。 */
import PRICING from "../shared/pricing.js";

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
  getListingsRestrictions: 250,      // 5回/秒（7.76）。余裕をみて4回/秒
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
/* 3時間ごとに取り直す行の上限（7.49）。再調達中とフェイズBの対象だけを見る。
   1行につき最大2件（その行の状態＋新品）要求するので、40行＝最大80件＝4回。
   0.1回/秒なので1回の実行で約42秒かかる。 */
const PRICING_HOT_MAX = 40;
const PRICING_HOT_KEY = "pricing.hot";       // 前回の結果（sync_state）
const PRICING_HOT_WARN_MS = 24 * 60 * 60 * 1000;  // 取り切れない知らせの間隔
/* GetMyeBaySelling の1ページ件数。OutputSelector を外して全項目を受けるので、
   1回の応答が大きくなりすぎないよう200→100にしてある（解析のCPUも半分になる）。 */
const EBAY_PAGE = 100;
const EBAY_MAX_PAGES = 30;
const DAILY_UTC_HOUR = 18;         // JST 3時台に日次処理を回す
const ITEMS_PER_RUN = 25;          // 1回の実行で明細を取る注文の数（2.1秒×25＝約53秒）
const ITEMS_PER_RUN_MAX = 120;     // 手動実行で増やせる上限
const ITEMS_DEADLINE_MS = 240000;  // 明細取得に使う時間の上限（これを越えたら次回へ回す）
const D1_MAX_BINDS = 100;          // D1 が1つの文に受け取れる値の数（これを超えると
                                   // too many SQL variables で落ちる）
const D1_MAX_KEYS = 40;            // 1件2変数（asin,cond）のときの件数（40件＝80個）
/* 1件が何個の値を使うかで、1文に入れられる件数を決める（7.61）。
   件数で決め打ちすると、1件3変数の引き当てで上限を越える。 */
function d1Step(perRow) {
  const n = Math.max(1, perRow | 0);
  return Math.max(1, Math.floor((D1_MAX_BINDS - 4) / n));   // 4個は余裕
}
const NOTIFY_MAX = 1800;           // Discord の1通の文字数上限に対する余裕

/* pj_price の CSV_PREFIX と同じ表。eBayに出すカテゴリだけ 'ebay'。
   mwgame / mwhobby は MW から仕入れた分（7.77）。せどりすとの SKU の形は
   変えずに、接頭辞だけで仕入れ元が分かるようにしたもの。
   マカドは SKU を文字として見るだけなので、接頭辞が増えても困らない。 */
const PREFIX_SCOPE = {
  game: "ebay", hobby: "ebay", toy: "ebay",
  mwgame: "ebay", mwhobby: "ebay",
  dvd: "out", cd: "out", book: "out", software: "out", pc: "out",
  electronics: "out", kitchen: "out", diy: "out", musicInst: "out",
};
/* 接頭辞 → 品の区分。ゲームか、フィギュアなどか。
   接頭辞を増やすたびに各所の `prefix==='game'` を直さないよう、ここに集める。 */
const PREFIX_CAT = {
  game: "game", mwgame: "game",
  hobby: "fig", toy: "fig", mwhobby: "fig",
};
function skuCatOf(prefix) { return PREFIX_CAT[String(prefix || "")] || ""; }
/* 仕入れ元。MW から仕入れた分と、それ以外（店舗仕入れなど）を分ける（7.77）。 */
const PREFIX_SRC = { mwgame: "mw", mwhobby: "mw" };
function skuSrcOf(prefix) { return PREFIX_SRC[String(prefix || "")] || "other"; }
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

/* ---- 外向き通信の許可表 ----
   ここに無い通信は net() が例外にする。書き込み系APIを足すには、この表を
   変えるしかない形にしてある（フェイズBでの変更が目に見えるように）。

   2026-10-11（自動値下げ）から、**書き込みは1つだけ**許す：
   Trading API の ReviseFixedPriceItem（売値とベストオファーの自動拒否額）。
   write:true の行は、呼ぶ側が net(run, url, {write:true, ...}) と明示したときだけ
   通る。ふだんの取り込みから間違って書き込むことはできない。 */
const EBAY_READ_CALLS = ["GetMyeBaySelling", "GetItem"];
/* 書き込みはこの2つだけ。
   ReviseFixedPriceItem   … 自動値下げ（売値とベストオファーの自動拒否額）
   ReviseInventoryStatus  … 売値の見直しの自動反映（売値／数量0。4件ずつ送れる）
   どちらも net(..., {write:true}) を付けた呼び出しだけが通る。 */
const EBAY_WRITE_CALLS = ["ReviseFixedPriceItem", "ReviseInventoryStatus"];
const ALLOWED = [
  { m: "POST", re: /^https:\/\/api\.amazon\.com\/auth\/o2\/token$/ },
  { m: "GET",  re: /^https:\/\/sellingpartnerapi-fe\.amazon\.com\/orders\/v0\/orders(\/|\?)/ },
  { m: "GET",  re: /^https:\/\/sellingpartnerapi-fe\.amazon\.com\/fba\/inventory\/v1\/summaries\?/ },
  /* JAN から ASIN とランキングを引く（7.66）。読み取りだけ。 */
  { m: "GET",  re: /^https:\/\/sellingpartnerapi-fe\.amazon\.com\/catalog\/2022-04-01\/items\?/ },
  /* 出品の可否（7.76）。読み取りだけ。Product Listing ロールで使える。 */
  { m: "GET",  re: /^https:\/\/sellingpartnerapi-fe\.amazon\.com\/listings\/2021-08-01\/restrictions\?/ },
  // 価格の照会。読み取りだがPOSTしか用意されていないAPI。
  { m: "POST", re: /^https:\/\/sellingpartnerapi-fe\.amazon\.com\/batches\/products\/pricing\/v0\/itemOffers$/ },
  { m: "POST", re: /^https:\/\/api\.ebay\.com\/identity\/v1\/oauth2\/token$/ },
  { m: "GET",  re: /^https:\/\/api\.ebay\.com\/sell\/fulfillment\/v1\/order\?/ },
  // eBayカタログの照会（JANから候補を探す）。どちらも読み取り。
  { m: "GET",  re: /^https:\/\/api\.ebay\.com\/commerce\/catalog\/v1_beta\/product_summary\/search\?/ },
  { m: "GET",  re: /^https:\/\/api\.ebay\.com\/commerce\/catalog\/v1_beta\/product\// },
  // カタログのスコープが無いときの代わり。出品の検索からePIDだけを拾う。
  { m: "GET",  re: /^https:\/\/api\.ebay\.com\/buy\/browse\/v1\/item_summary\/search\?/ },
  // Trading API。X-EBAY-API-CALL-NAME が読み取り呼び出しのときだけ通す。
  { m: "POST", re: /^https:\/\/api\.ebay\.com\/ws\/api\.dll$/, calls: EBAY_READ_CALLS },
  /* 自動値下げ（売値とベストオファーの自動拒否額）。唯一の書き込み。
     net(..., {write:true}) を付けた呼び出しだけが通る。 */
  { m: "POST", re: /^https:\/\/api\.ebay\.com\/ws\/api\.dll$/, calls: EBAY_WRITE_CALLS,
    write: true },
  /* 写真を eBay（EPS）に預ける Media API（7.41）。
     create_image_from_url は eBay 側に画像を作るので **書き込み**（write:true）。
     getImage（URLと期限の取り出し）は読み取り。
     UploadSiteHostedPictures（Trading）は 2026-09-30 に廃止されたので使わない。 */
  { m: "POST", re: /^https:\/\/apim\.ebay\.com\/commerce\/media\/v1_beta\/image\/create_image_from_url$/,
    write: true },
  { m: "GET",  re: /^https:\/\/apim\.ebay\.com\/commerce\/media\/v1_beta\/image\// },
  /* 調べるための読み取り（7.41）。pj-img（R2）の写真をそのまま見る。
     どのホストかは設定で変わるので、https の workers.dev / 自前ドメインだけ許す。 */
  { m: "GET",  re: /^https:\/\/[A-Za-z0-9.-]+\/i\/\d{8}\/[0-9a-f-]{36}\.(jpg|png|webp)$/ },
  /* 預け直し（7.42）。eBay 自身が持っている写真（EPS）を元画像として
     Media API に渡すので、i.ebayimg.com も読み取りで見られるようにする。 */
  { m: "GET",  re: /^https:\/\/i\.ebayimg\.com\// },
  /* 為替レート（7.50）。pj_price と同じ2つの公開APIを、読み取りで見る。
     どちらも鍵が要らず、1ドル=円だけを返す。 */
  { m: "GET",  re: /^https:\/\/open\.er-api\.com\/v6\/latest\/USD$/ },
  { m: "GET",  re: /^https:\/\/api\.frankfurter\.app\/latest\?from=USD&to=JPY$/ },
  { m: "POST", re: /^https:\/\/discord(app)?\.com\/api\/webhooks\// },
  /* MW（マッチングワールド）の商品画像（6.1）。**読み取りの1本だけ**。
     画像URLはログインなしで見られる。会員サイト（/buy/?q=）は見に行かない。
     MW が利用を許諾した画像だけを使い、Amazon の画像は使わない。 */
  { m: "GET",  re: /^https:\/\/matchingworld\.asia\/products\/\d+\/\d+\/\d+\.jpg$/ },
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
/* ---- キーの役割（7.40）----
   admin … PJ_ACCESS_KEY（いままでのキー）。すべて使える。
   staff … STAFF_KEY（作業者用）。英題生成・写真・取り込み（読み取り）・
           名簿の送信だけ。**値段を動かす操作は 403**。
   ''    … どちらとも一致しない（401）。
   キーは定数時間で照合する（pj-title と同じ方式）。 */
function eqKey(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (!x || !y || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
function keyRole(request, env) {
  const a = request.headers.get("X-PJ-Key") || "";
  if (eqKey(a, env.PJ_ACCESS_KEY)) return "admin";
  if (eqKey(a, env.STAFF_KEY)) return "staff";
  return "";
}
function authorized(request, env) { return keyRole(request, env) !== ""; }
/* 作業者用キーでは送れない項目（値段を動かす設定）。
   名簿（SKU・ItemID・手元在庫・実重量・仕入値・相場）は送れる。 */
const STAFF_DENY = ["md_step", "md_floor", "md_n", "md_start",
                    "rv_want", "rv_floor", "rv_kind", "rv_max_cost",
                    // フェイズB（7.47）。再調達の売値と「今回は動かさない」も管理者だけ
                    "pb_want", "pb_max_cost", "pb_skip",
                    // 再調達中の売値の追従（7.48）
                    "rk_want", "rk_floor", "rk_low", "rk_n", "rk_max_cost",
                    // 売れた値段で保つ印（7.53）。値下げの再開は値段を動かす操作
                    "sold_keep"];
function staffDenyFields(body) {
  const list = Array.isArray(body && body.items) ? body.items : [];
  const hit = {};
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    for (const k of STAFF_DENY)
      if (Object.prototype.hasOwnProperty.call(x, k) && x[k] !== null
          && x[k] !== undefined) hit[k] = 1;
  }
  return Object.keys(hit);
}
function forbidStaff(detail, fields, origin) {
  return json({ error: "forbidden_for_staff", detail: detail,
                fields: fields || [] }, 403, origin);
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
function assertReadOnly(url, method, headers, allowWrite) {
  const m = String(method || "GET").toUpperCase();
  for (const a of ALLOWED) {
    if (a.m !== m || !a.re.test(url)) continue;
    // 書き込みの行は、呼ぶ側が write:true と明示したときだけ通す
    if (a.write && !allowWrite) continue;
    if (a.calls) {
      const call = (headers && (headers["X-EBAY-API-CALL-NAME"] || headers["x-ebay-api-call-name"])) || "";
      if (a.calls.indexOf(call) < 0) continue;
    }
    return;
  }
  throw new Error("blocked_by_readonly_guard " + m + " " + url.split("?")[0]);
}
async function net(run, url, init) {
  const opt = init || {};
  assertReadOnly(url, opt.method || "GET", opt.headers, !!opt.write);
  run.subrequests++;
  /* fetcher を渡したときは、その Worker（サービスバインディング）に投げる。
     同じアカウントの workers.dev へ普通の fetch をすると Cloudflare が
     「error code: 1042」で止めるため、pj-img を見るときだけこちらを使う（7.42）。 */
  if (opt.fetcher) {
    const o = Object.assign({}, opt);
    delete o.fetcher; delete o.write;
    return opt.fetcher.fetch(url, o);
  }
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
/* eBayのCustomLabel から ASIN＋状態を取り出す。
   E-<ASIN> / E-<ASIN>-U / E-<ASIN>-C（FBA連動・無在庫でない）、
   M-<ASIN> / M-<ASIN>-U / M-<ASIN>-C（無在庫）、
   せどりすとSKUそのまま（一点物）のいずれにも対応する。
   M- は E- と同じく照合し、あわせて無在庫の印を立てる。
   -C は「カートリッジのみ」（箱・説明書なし）、-L は「フィギュアのみ」（箱なし）。
   どちらも箱付き中古（-U）とは別物で、items の主キーは (asin, cond) なので
   cond='cart' / 'loose' として別の行になる。どちらも手元から発送する。 */
function parseLabel(label) {
  const s = String(label || "").trim();
  let m = /^([EM])-(B[0-9A-Z]{9})(-U|-C|-L)?$/i.exec(s);
  if (m) {
    const drop = m[1].toUpperCase() === "M";
    const suf = String(m[3] || "").toUpperCase();
    const cond = suf === "-C" ? "cart"
               : suf === "-L" ? "loose"
               : (suf === "-U" ? "used" : "new");
    return { ok: true, asin: m[2].toUpperCase(), cond,
             scope: "ebay", from: drop ? "dropship" : "stable", dropship: drop,
             cart: cond === "cart" || cond === "loose" };
  }
  const p = parseSku(s);
  if (p.ok) return { ok: true, asin: p.asin, cond: p.cond, scope: p.scope, from: "sedori" };
  return { ok: false, asin: "", cond: "", scope: "unknown", from: "" };
}

/* ---- eBayカタログ（JANから候補を探す）----
   Catalog API は Limited Release で、スコープ
   `.../oauth/api_scope/commerce.catalog.readonly` の付与が必要。
   いまのユーザートークンの同意範囲は sell.fulfillment.readonly と sell.inventory だけ
   なので、このスコープは入っていない（README「1-3」参照）。
   そこで、
     1) client_credentials のアプリトークンでカタログを引く（付与されていれば通る）
     2) 取れないときは Browse API（基本スコープ）でJAN検索し、ePIDだけ拾う
   の2段で動かす。Browse の画像は「出品者の写真」なので、カタログ画像としては使わない。 */
const EBAY_CAT_SCOPE = "https://api.ebay.com/oauth/api_scope/commerce.catalog.readonly";
const EBAY_BASE_SCOPE = "https://api.ebay.com/oauth/api_scope";
async function ebayAppToken(env, run, scope) {
  const key = "ebay:app:" + scope;
  const cached = await env.SYNC_CACHE.get(key);
  if (cached) return { ok: true, token: cached };
  const basic = btoa(env.EBAY_CLIENT_ID + ":" + env.EBAY_CLIENT_SECRET);
  const resp = await net(run, EBAY_API + "/identity/v1/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded",
               "authorization": "Basic " + basic },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString(),
  });
  const text = await resp.text();
  if (!resp.ok) return { ok: false, status: resp.status, err: text.slice(0, 300) };
  const d = JSON.parse(text);
  const ttl = Math.max(60, (d.expires_in || 7200) - 300);
  await env.SYNC_CACHE.put(key, d.access_token, { expirationTtl: ttl });
  return { ok: true, token: d.access_token };
}
/* 日本のJAN（EAN-13）は 45 か 49 で始まる。どちらも日本の国コードなので
   両方を日本版として扱う（カジの指示は「49」だが、45 も日本のJANなので含める）。 */
const JP_GTIN = /^(45|49)/;
const gtinJp = (list) => (list || []).some((g) => JP_GTIN.test(String(g).replace(/\D/g, "")));
function catFromCatalog(d) {
  const out = [];
  for (const x of (d && d.productSummaries) || []) {
    const gt = (x.gtins || []).map((g) => String(g).replace(/\D/g, "")).filter(Boolean);
    out.push({
      epid: String(x.epid || ""),
      title: String(x.title || "").slice(0, 200),
      image: String((x.image && x.image.imageUrl) || ""),
      brand: String(x.brand || ""),
      mpn: ((x.mpns || [])[0] || "") + "",
      gtins: gt.slice(0, 5),
      jp: gtinJp(gt),
      from: "catalog",
    });
  }
  return out;
}
function catFromBrowse(d) {
  const out = [], seen = {};
  for (const x of (d && d.itemSummaries) || []) {
    const epid = String(x.epid || "");
    if (!epid || seen[epid]) continue;
    seen[epid] = 1;
    out.push({
      epid,
      title: String(x.title || "").slice(0, 200),
      // Browse の画像は出品者の写真。カタログ画像ではないので、その印を付ける
      image: String((x.image && x.image.imageUrl) || ""),
      brand: String((x.brand) || ""),
      mpn: "",
      gtins: [],
      jp: null,                 // JANが返らないので日本版か分からない
      from: "browse",
    });
  }
  return out;
}
async function ebayCatalogSearch(env, run, gtin) {
  const g = String(gtin || "").replace(/\D/g, "");
  if (g.length < 8) return { ok: false, err: "bad_gtin", list: [], from: "" };
  const a = await ebayAppToken(env, run, EBAY_CAT_SCOPE);
  if (a.ok) {
    const q = new URLSearchParams({ gtin: g, limit: "10" });
    const r = await net(run, EBAY_API + "/commerce/catalog/v1_beta/product_summary/search?"
      + q.toString(), { headers: { authorization: "Bearer " + a.token,
        accept: "application/json", "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" } });
    const t = await r.text();
    if (r.ok) {
      run.pages++;
      let d = {}; try { d = JSON.parse(t); } catch (e) { d = {}; }
      return { ok: true, from: "catalog", list: catFromCatalog(d) };
    }
    run.notes.push("catalog -> " + r.status);
    var catErr = { status: r.status, body: t.slice(0, 300) };
  }
  /* カタログが使えないときの代わり。ePIDだけ拾って、画像とJANは出さない。 */
  const b = await ebayAppToken(env, run, EBAY_BASE_SCOPE);
  if (!b.ok) return { ok: false, err: "token", list: [], from: "",
                      detail: { catalog: catErr || a, browse: b } };
  const q2 = new URLSearchParams({ gtin: g, limit: "10" });
  const r2 = await net(run, EBAY_API + "/buy/browse/v1/item_summary/search?" + q2.toString(),
    { headers: { authorization: "Bearer " + b.token, accept: "application/json",
                 "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" } });
  const t2 = await r2.text();
  if (!r2.ok) {
    run.errors++; run.notes.push("browse -> " + r2.status);
    return { ok: false, err: "browse_" + r2.status, list: [], from: "",
             detail: { catalog: catErr || a, browse: { status: r2.status, body: t2.slice(0, 300) } } };
  }
  run.pages++;
  let d2 = {}; try { d2 = JSON.parse(t2); } catch (e) { d2 = {}; }
  return { ok: true, from: "browse", list: catFromBrowse(d2),
           note: "カタログのスコープが無いので、出品の検索からePIDだけ拾いました"
                 + "（画像はカタログ画像ではありません）",
           detail: { catalog: catErr || a } };
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
    await spSlotKv(env, o.label);        // 実行をまたいだ間隔（7.70）
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
// null / undefined はそのまま（未取得）。数字はそのまま数字で返す
const numOrNull = (v) => (v === null || v === undefined) ? null : Number(v);
function invRow(s) {
  const d = s.inventoryDetails || {};
  /* 予約済みの内訳。合計だけだと、納品した直後の「FC処理中」を
     売れた（顧客注文）と取り違える。details=true で3つとも取れる。
     応答に内訳が入っていないときは null（未取得）にする。0 で埋めると
     「予約済みはあるが顧客注文は0」＝受領処理中と誤って判断し、
     本当に売れた行の警告を落としてしまう。 */
  const rq = d.reservedQuantity || {};
  const has = (k) => rq[k] !== null && rq[k] !== undefined;
  const rKnown = has("pendingCustomerOrderQuantity") || has("pendingTransshipmentQuantity")
              || has("fcProcessingQuantity");
  return {
    sku: String(s.sellerSku || ""),
    asin: String(s.asin || ""),
    title: String(s.productName || ""),
    available: Number(d.fulfillableQuantity || 0),
    inbound: Number(d.inboundWorkingQuantity || 0) + Number(d.inboundShippedQuantity || 0)
             + Number(d.inboundReceivingQuantity || 0),
    reserved: Number(rq.totalReservedQuantity || 0),
    // 顧客注文（本当に売れた）／FC間の移管／FCでの受領・処理中。null は未取得
    resCust: rKnown ? Number(rq.pendingCustomerOrderQuantity || 0) : null,
    resTrans: rKnown ? Number(rq.pendingTransshipmentQuantity || 0) : null,
    resProc: rKnown ? Number(rq.fcProcessingQuantity || 0) : null,
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
/* 取り寄せる組み合わせを作る。中古（used / cart）の行は、新品の最安値も一緒に取る
   （新品のほうが安ければ、そちらを値付けの基準にするため）。
   要求は行ごとに「その行の状態 → 新品」の順に並べ、上限で切れても
   片方だけが落ち続けないようにする。 */
function lowestReqs(keys) {
  const out = [], seen = {};
  for (const k of keys) {
    const own = (k.cond === "new") ? "new" : "used";
    [own, (own === "used") ? "new" : null].forEach((c) => {
      if (!c) return;
      const id = k.asin + "|" + c;
      if (seen[id]) return;
      seen[id] = 1;
      out.push({ asin: k.asin, cond: c });
    });
  }
  return out;
}
// 行（cart を含む）から、取り寄せの答えを引くときのキー
function lowestKey(k) { return k.asin + "|" + ((k.cond === "new") ? "new" : "used"); }
/* ---- 出品の様子を読む（7.66。10/7 の利益計算ファイルと同じ列を出すため）----
   Amazon本体の出品があるか・FBA の出品者数・カート価格・状態ごとの出品者数。
   綴りが大文字小文字どちらで返るか実データで確定できていないので、
   どちらでも読めるようにしている（SubCondition と同じ事情）。 */
const AMZ_SELF_ID = "AN1VRQENFRJN5";          // amazon.co.jp（Amazon本体）
function pick(o, ...names) {
  if (!o || typeof o !== "object") return undefined;
  for (const n of names) {
    if (o[n] !== undefined) return o[n];
    const k = Object.keys(o).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k) return o[k];
  }
  return undefined;
}
function amzSelf(p) {
  for (const o of (p && p.Offers) || []) {
    if (String(pick(o, "SellerId") || "") === AMZ_SELF_ID) return 1;
  }
  return 0;
}
function fbaN(p) {
  let n = 0;
  for (const o of (p && p.Offers) || []) {
    if (pick(o, "IsFulfilledByAmazon") === true) n++;
  }
  return n;
}
function buyBox(p) {
  const list = pick((p && p.Summary) || {}, "BuyBoxPrices") || [];
  for (const b of list) {
    const v = Number((pick(b, "LandedPrice") || {}).Amount
      || (pick(b, "ListingPrice") || {}).Amount || 0);
    if (v > 0) return Math.round(v);
  }
  return 0;
}
/* 状態ごとの出品者数（Summary.NumberOfOffers）。取れなければ 0。 */
function offerN(p, cond) {
  const list = pick((p && p.Summary) || {}, "NumberOfOffers") || [];
  let n = 0;
  for (const x of list) {
    const c = String(pick(x, "condition") || "");
    if (c.toLowerCase() === String(cond).toLowerCase())
      n = Math.max(n, Number(pick(x, "OfferCount") || 0));
  }
  return n;
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
                                 offers: offers.slice(0, 10),
                                 amz: amzSelf(p), fba: fbaN(p),
                                 buy: buyBox(p), newN: offerN(p, "New") };
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
      /* 配送ポリシー名（ビジネスポリシーを使っている出品だけ入る）。
         「納品待ちで出品中」を警告にするか情報にするかの判定に使う。
         返らない出品もあるので、空のときは今までどおり推測で判定する。 */
      const prof = xmlTag(xmlTag(b, "SellerProfiles"), "SellerShippingProfile");
      /* ベストオファーの設定。値段を下げるときは自動拒否額も一緒に下げる必要がある。
         返らない出品もあるので、取れた分だけ持ち帰る（空は「分からない」）。 */
      const bod = xmlTag(b, "BestOfferDetails");
      const boOn = xmlTag(bod, "BestOfferEnabled");
      const boAcc = xmlTag(det, "BestOfferAutoAcceptPrice")
                 || xmlTag(b, "BestOfferAutoAcceptPrice");
      const boDec = xmlTag(det, "MinimumBestOfferPrice")
                 || xmlTag(b, "MinimumBestOfferPrice");
      /* eBayのセール（Promotional Sale／Markdown Manager）。6.59。
         SellingStatus.PromotionalSaleDetails に **セール前の値段（OriginalPrice）**と
         終わる時刻（EndTime）が入る。CurrentPrice のほうは**セール後の値段**なので、
         利益と赤字の判定は今までどおり ebay_price で計算してよい。
         STP/MAP の DiscountPriceInfo が付く出品もセール扱いにする。
         セールが終わったら 0 に戻す（次の取り込みで自動的に対象へ戻すため）。 */
      const ps = xmlTag(xmlTag(b, "SellingStatus"), "PromotionalSaleDetails");
      const disc = xmlTag(b, "DiscountPriceInfo");
      const psOrig = Number(xmlTag(ps, "OriginalPrice") || 0) || 0;
      rows.push({
        itemId: xmlTag(b, "ItemID"),
        sku: xmlTag(b, "SKU"),
        title: xmlTag(b, "Title"),
        start: start,
        qty: qty,
        price: Number(price || 0),
        currency: xmlAttr(b, "CurrentPrice", "currencyID") || "USD",
        shipProfile: xmlTag(prof, "ShippingProfileName"),
        bo: boOn === "" ? null : (/^(true|1)$/i.test(boOn) ? 1 : 0),
        boAccept: boAcc === "" ? null : (Number(boAcc) || 0),
        boDecline: boDec === "" ? null : (Number(boDec) || 0),
        sale: (ps !== "" || disc !== "") ? 1 : 0,
        saleOrig: psOrig > 0 ? psOrig : null,
        saleEnd: xmlTag(ps, "EndTime") || "",
      });
    }
  }
  run.notes.push("eBay出品 " + rows.length + "件");
  return { rows, ok: true };
}

/* ---- Discord 通知 ---- */
async function notify(env, run, text) {
  if (!env.DISCORD_WEBHOOK_URL || !text) return false;
  /* 時刻は日本時間で出す（7.58）。D1 に入れるのは今までどおり UTC。 */
  const body = (String(text) + "\n（" + jstText(nowIso()) + " 日本時間）")
    .slice(0, NOTIFY_MAX);
  const resp = await net(run, env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: body }),
  });
  if (!resp.ok) { run.errors++; run.notes.push("discord -> " + resp.status); return false; }
  return true;
}

/* ---- 為替レート（1ドル=円・7.50）----
   これまで為替は pj_price（ブラウザ）だけが取っていたので、Worker が自分で
   値付けするには使えなかった。同じ2つの公開APIから Worker も取り、KV に控える。

   使う順番:
     1. KV の控えが新しい（FX_TTL_MS 以内）ならそれ
     2. APIから取り直して KV に入れる（取れたほうを採る）
     3. 取れなければ KV の古い控え（無いよりましなので使う）
     4. それも無ければ ⚙設定の fx（端末が送った値）
     5. それも無ければ FX_DEFAULT
   「Worker が取った値を正とする」決まりなので、2 が成功したらそれを使う。 */
const FX_KEY = "fx.usdjpy";
const FX_MIN = 50, FX_MAX = 500;        // 明らかにおかしい応答を弾く（pj_price と同じ）
const FX_DEFAULT = 160;
/* 控えの寿命。値付けに直接入る数字なので1日は粗い。6時間ごとに取り直す
   （毎時の Cron なので外部への問い合わせは1日4回まで）。 */
const FX_TTL_MS = 6 * 60 * 60 * 1000;
const FX_SRCS = [
  { url: "https://open.er-api.com/v6/latest/USD",
    pick: (d) => ({ rate: d && d.rates && d.rates.JPY,
      at: (d && d.time_last_update_unix)
        ? new Date(d.time_last_update_unix * 1000).toISOString() : nowIso() }) },
  { url: "https://api.frankfurter.app/latest?from=USD&to=JPY",
    pick: (d) => ({ rate: d && d.rates && d.rates.JPY,
      at: (d && d.date) ? (d.date + "T00:00:00.000Z") : nowIso() }) },
];
function fxOk(v) {
  const n = Number(v);
  return isFinite(n) && n >= FX_MIN && n <= FX_MAX;
}
async function fxCached(env) {
  try {
    const t = await env.SYNC_CACHE.get(FX_KEY);
    const o = t ? JSON.parse(t) : null;
    return (o && fxOk(o.rate)) ? o : null;
  } catch (e) { return null; }
}
async function fxGet(env, run, force) {
  const old = await fxCached(env);
  if (!force && old) {
    const age = Date.now() - Date.parse(String(old.got_at || old.at || ""));
    if (isFinite(age) && age >= 0 && age < FX_TTL_MS)
      return { rate: Number(old.rate), at: old.at, src: old.src, from: "cache" };
  }
  for (const sv of FX_SRCS) {
    let d = null;
    try {
      const resp = await net(run, sv.url, { method: "GET" });
      if (!resp.ok) { run.notes.push("fx " + sv.url + " -> " + resp.status); continue; }
      d = await resp.json();
    } catch (e) { run.notes.push("fx_error " + e.message); continue; }
    let g = null;
    try { g = sv.pick(d); } catch (e) { g = null; }
    if (!g || !fxOk(g.rate)) continue;
    const rate = Math.round(Number(g.rate) * 100) / 100;
    const o = { rate: rate, at: g.at, src: sv.url, got_at: nowIso() };
    try { await env.SYNC_CACHE.put(FX_KEY, JSON.stringify(o)); } catch (e) { /* 控えに失敗しても使う */ }
    return { rate: rate, at: o.at, src: o.src, from: "api" };
  }
  // 取れなかったとき。古い控え → ⚙設定 → 既定値
  if (old) return { rate: Number(old.rate), at: old.at, src: old.src, from: "stale" };
  try {
    const st = (await settingsGet(env)).settings || {};
    if (fxOk(st.fx))
      return { rate: Math.round(Number(st.fx) * 100) / 100, at: "", src: "ui.settings",
               from: "settings" };
  } catch (e) { /* 設定が読めなくても既定値で続ける */ }
  return { rate: FX_DEFAULT, at: "", src: "", from: "default" };
}

/* ---- 値付けの設定（7.51）----
   pj_price が /settings に送った値（6.73）と、Worker が自分で取った為替（7.50）から
   shared/pricing.js に渡す「設定オブジェクト」を作る。
   広告料率は**「自動処理の広告料率」（autoAdRate・既定6%）**を使う。
   eBayタブの adRate はその場の計算用なので送られてこない（6.74）。 */
async function pricingSettings(env, run) {
  let st = {};
  try { st = (await settingsGet(env)).settings || {}; } catch (e) { st = {}; }
  let fx = null;
  try { fx = await fxGet(env, run || newRun("fx"), false); } catch (e) { fx = null; }
  const S = PRICING.settings({
    fx: (fx && fx.rate) || st.fx,
    fxc: st.fxc, fee: st.fee, intlFee: st.intlFee,
    adRate: (st.autoAdRate === undefined || st.autoAdRate === null || st.autoAdRate === "")
      ? AUTO_AD_DEFAULT : st.autoAdRate,
    feeTax: st.feeTax, fixed: st.fixed, pack: st.pack, shipCharge: st.shipCharge,
    usTaxRate: st.usTaxRate, baseProfit: st.baseProfit, linkRate: st.linkRate,
    saleRate: st.saleRate, targetMode: st.targetMode,
    dutyShip: st.dutyShip, taxRefund: st.taxRefund, stampDisc: st.stampDisc,
  });
  return { S: S, st: st, fx: fx };
}
const AUTO_AD_DEFAULT = 6;         // 自動処理の広告料率の既定（画面と同じ）

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
/* ---- 画面の設定を端末をまたいで同じにする（GET/POST /settings）----
   pj_price の「詳細設定（目標の決め方）」を JSON ひとつとして sync_state に置く。
   どちらが新しいか決められるよう、変更した時刻（at）を一緒に持ち、
   **古い時刻の書き込みは退ける**（別の端末であとから変えた値を守るため）。
   退けたときは、いま入っている設定を返して端末側に合わせてもらう。 */
const SETTINGS_KEY = "ui.settings";
const SETTINGS_MAX = 8000;              // 設定だけなので十分な上限（文字数）
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;
async function settingsGet(env) {
  const s = await stateGet(env, SETTINGS_KEY);
  if (!s) return { ok: true, at: "", settings: {} };
  try {
    const o = JSON.parse(s);
    return { ok: true, at: String(o.at || ""), settings: o.settings || {} };
  } catch (e) { return { ok: true, at: "", settings: {} }; }
}
async function settingsPut(env, body) {
  const at = String((body && body.at) || "");
  const st = body && body.settings;
  if (!ISO_RE.test(at) || !st || typeof st !== "object" || Array.isArray(st))
    return { ok: false, error: "bad_request" };
  const txt = JSON.stringify({ at, settings: st });
  if (txt.length > SETTINGS_MAX) return { ok: false, error: "too_large" };
  const cur = await settingsGet(env);
  // いま入っている設定のほうが新しければ書かない（同じ時刻なら新しい書き込みを採る）
  if (cur.at && cur.at > at)
    return { ok: true, stored: false, at: cur.at, settings: cur.settings };
  await stateSet(env, SETTINGS_KEY, txt).run();
  return { ok: true, stored: true, at, settings: st };
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
    + d.fba_reserved + "点のみ（うち顧客注文 "
    + ((d.res_cust === null || d.res_cust === undefined) ? "不明" : (d.res_cust + "点"))
    + "・出荷待ち）。eBay残数 " + d.ebay_qty,
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
    /* カートリッジのみは手元から発送する。FBAの在庫で売り越しの通知を出さない。 */
    if (isCart(r)) continue;
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
    const rb = resBreak(r);
    const d = { title: r.title || r.ebay_sku || r.asin, ebay_qty: q,
                fba_available: av, fba_inbound: inb, fba_reserved: rv,
                // 予約済みの内訳（内訳をまだ取っていない行は null）
                res_cust: rb.cust, res_trans: rb.trans, res_proc: rb.proc,
                res_known: rb.known ? 1 : 0,
                on_hand: onHand ? 1 : 0, mode: r.mode || "" };
    const base = "|" + r.asin + "|" + r.cond + "|" + dayKey();
    /* 予約済みのみ（Amazonで注文が入って出荷待ち）が最優先。
       手元在庫があってもAmazon側で在庫が消える話なので、こちらは抑えない。
       ただし通知するのは顧客注文のぶんがあるときだけ。FC移管・FC処理中だけなら
       納品した直後の正常な状態なので、通知しない（通常扱い）。
       内訳が分からない行も通知しない（内訳が取れるまで待つ）。 */
    if (av === 0 && rv > 0 && q >= 1) {
      if (resSold(r)) out.push(evStmt(env, "RESERVED_ONLY", "RESERVED_ONLY" + base, r, d));
      continue;
    }
    // 手元在庫あり（on_hand）は、FBAが0でも売り越しではない
    if (!onHand && av === 0 && q >= 1 && (r.mode === "hold" || r.mode === "end" || !r.mode))
      out.push(evStmt(env, "OVERSELL_RISK", "OVERSELL_RISK" + base, r, d));
    if (av > 0 && q > 0 && av < q)
      out.push(evStmt(env, "QTY_MISMATCH", "QTY_MISMATCH" + base, r, d));
    /* 納品待ちで出品中。配送ポリシーが再調達用（W2000）の行は運用どおりなので
       通知しない（画面でも情報として出すだけ。2026-10-10）。 */
    if (!onHand && av === 0 && inb > 0 && q >= 1 && !isShipRestock(r))
      out.push(evStmt(env, "INBOUND_LISTED", "INBOUND_LISTED" + base, r, d));
  }
  return out;
}
// 一覧の1行を作るための共通SELECT
/* ================= SELECT で読む列（7.55）=================
   D1 は1つの結果に **100列**までしか返せない。超えると
   「too many columns in result set: SQLITE_ERROR」で問い合わせ全体が失敗する。
   items は migrate-0023 で100列になったので、全列を並べた SELECT は
   （副問い合わせを足した時点で）必ずこの上限を超える。
   実際に v176 では /status と Cron のジョブがまとめて落ちた。

   そこで **読む列だけ**を並べる。2つに分けてある。

     ITEM_COLS   … 自動処理（Cron のジョブ）と値付けの式が読む列
     STATUS_COLS … /status が画面に返す列（画面と値付けの式が読む列）

   列を足すときは、読む側（shared/pricing.js・index.html・このファイル）で
   使う名前と同じにすること。**書くだけの列は入れない**
   （SQL の SET や WHERE は SELECT の列数に関係しない）。
   tests/d1cols.mjs が「列数が上限より十分少ないこと」と
   「読む列が落ちていないこと」の両方を見張る。 */
const D1_MAX_COLS = 100;        // D1 が1つの結果に返せる列数
const D1_COLS_WARN = 90;        // ここを超えたらテストが落ちる（余裕を残すため）

/* せどりすとSKU から引く2つ。items の列ではないが**値付けに使う**ので
   どちらのリストにも足して、どの処理からも同じ値が見えるようにする（7.52）。
   prefix（game / hobby …）は既定重量の振り分け、
   sku_cost は D1 に仕入値が無い行の値付けの基準。 */
const SKU_COLS = `
  (SELECT s.prefix FROM skus s
    WHERE s.asin=items.asin AND s.cond=items.cond AND s.prefix<>'' LIMIT 1) AS prefix,
  /* 同じASIN・同じ区分に複数の個体があるときは**いちばん高い仕入値**
     （安いほうで出すと赤字になりうるため）。箱なし（cart / loose）の出品は、
     個体のSKUが中古なのでそちらも見る。 */
  (SELECT MAX(s3.cost) FROM skus s3
    WHERE s3.asin=items.asin AND s3.cost>0
      AND (s3.cond=items.cond
           OR (items.cond IN ('cart','loose') AND s3.cond='used'))) AS sku_cost`;

/* 自動処理（jobOrders・jobHourly・jobMarkdown・jobReview・jobPhaseB・
   jobRkPrice・jobSoldKeep・selfTargets）と shared/pricing.js が読む列。 */
const ITEM_COLS = `
  asin, cond, scope, title, ebay_item_id, ebay_sku, ebay_qty, ebay_price,
  ebay_ship_profile, ebay_bo, ebay_bo_accept, revise_err, revise_err_at, fba_available,
  fba_inbound, fba_reserved, fba_res_cust, fba_res_trans, fba_res_proc,
  fba_seen_at, mode, one_off, one_off_known, fba_link, on_hand, amazon_lowest,
  amazon_lowest_n, amazon_offers, amazon_offers_json, amazon_lowest_at,
  amazon_new_low, amazon_new_n, restocking, restock_price, restock_max_cost,
  restock_skip_acc, dropship, hand_qty, weight_g, cost_yen, sold_usd,
  ebay_first, mark_at, mark_stop, md_step, md_start, md_floor, md_n, md_done,
  ebay_sale, pics_eps, pb_act, pb_at, pb_fail, pb_skip, pb_want, pb_max_cost,
  pb_want_at, search_kw, rv_want, rv_floor, rv_kind, rv_max_cost, rv_at,
  rk_want, rk_floor, rk_low, rk_n, rk_max_cost, rk_want_at, sold_keep,
  sold_price, sk_act, sk_why, sk_fail, mw_low, mw_low_at, mw_n, mw_stock,
  updated_at,` + SKU_COLS;

/* /status が画面に返す列。画面（index.html）と shared/pricing.js が読む列だけ。
   自動処理だけが読む列（fba_link・pb_at・pb_want・pb_max_cost・pb_want_at・
   rv_at・updated_at）は返さない。
   ebay_bo_decline は画面の JS では読んでいないが、ベストオファーの設定を
   そろえて返す決まりなので入れてある（tests/pricesrc.mjs が固定している）。
   pics_eps_at は「写真が抜けています」の判定で、枚数をいつ確かめたかを出すのに使う。 */
const STATUS_COLS = `
  asin, cond, scope, title, ebay_item_id, ebay_sku, ebay_qty, ebay_price,
  ebay_start, ebay_ship_profile, ebay_bo, ebay_bo_accept, ebay_bo_decline, revise_err,
  revise_err_at, fba_available, fba_inbound, fba_reserved, fba_res_cust,
  fba_res_trans, fba_res_proc, fba_seen_at, mode, one_off, one_off_known,
  on_hand, amazon_lowest, amazon_lowest_n, amazon_offers, amazon_offers_json,
  amazon_lowest_at, amazon_new_low, amazon_new_n, restocking, restock_at,
  restock_price, restock_max_cost, restock_skip_acc, dropship, hand_qty,
  weight_g, cost_yen, sold_usd, ebay_first, mark_at, mark_stop, md_step,
  md_start, md_floor, md_n, md_done, ebay_sale, ebay_sale_orig, ebay_sale_end,
  pics_eps, pics_eps_at, pics_n, pb_act, pb_fail, pb_skip, search_kw, rv_want, rv_floor,
  rv_kind, rv_max_cost, rv_fail, rk_want, rk_floor, rk_low, rk_n, rk_max_cost,
  rk_want_at, rk_fail, sold_keep, sold_price, sold_kept_at, sk_act, sk_why,
  sk_fail, mw_low, mw_low_at, mw_n, mw_stock,` + SKU_COLS;

/* items をキーで引く。D1 は1命令あたりのバインド変数が100個までなので、
   重複キーをまとめたうえで d1Step() 件ずつに分けて引く
   （まとめて引くと「too many SQL variables」で中断する）。
   1件 (asin,cond) で2個使うので d1Step(2)。 */
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
  const step = d1Step(2);
  for (let i = 0; i < uniq.length; i += step) {
    const part = uniq.slice(i, i + step);
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
                     qty: Number(li.qty || 0), at: o.at || "",
                     /* CustomLabel。W-<JAN> なら MW の無在庫（7.72）。 */
                     sku: li.sku || "",
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
  /* カートリッジのみの手元在庫を減らすのは「初めて見た明細」だけ。
     eBayの注文は lastmodifieddate で引くので、状態が変わると同じ注文が何度も返る。
     orders に既にある (order_id, line_id) は数えない。 */
  /* いまは「カートリッジのみの手元在庫を減らす」と「売れた値段で保つ印を立てる」
     （7.53）の2つで使うので、**全部の行**について初めて見た明細かを調べる。 */
  const fresh = {};
  {
    const pairs = soldE.map((x) => ({ o: x.orderId, l: x.line }));
    const known = {};
    const stepO = d1Step(2);                 // (order_id,line_id) で1件2個
    for (let i = 0; i < pairs.length; i += stepO) {
      const part = pairs.slice(i, i + stepO);
      const where = part.map(() => "(order_id=? AND line_id=?)").join(" OR ");
      const bind = [];
      for (const q of part) bind.push(q.o, q.l);
      const got = await env.DB.prepare(
        `SELECT order_id, line_id FROM orders WHERE channel='ebay' AND (${where})`
      ).bind(...bind).all();
      for (const x of (got && got.results) || []) known[x.order_id + "|" + x.line_id] = 1;
    }
    for (const x of soldE)
      fresh[x.orderId + "|" + x.line] = !known[x.orderId + "|" + x.line];
  }
  /* 売れた値段で保つ（7.53）。初めて見た明細の行だけ、**そのときの出品価格**を
     控えて印を立てる。落札額（orders.amount）はベストオファーで値引きされた額
     なので使わない（それを保つと値段が下がり続ける）。
     在庫補充の予定（sk_act）と連続失敗（sk_fail）は、売れ直したので作り直す。

     一点物・無在庫には立てない（7.54）。立てるかどうかは skStampOff ＝
     shared/pricing.js の skKeepOff に1か所だけ。 */
  {
    const freshE = soldE.filter((x) => fresh[x.orderId + "|" + x.line]);
    const flg = {};
    const stepF = d1Step(2);                 // (asin,cond) で1件2個
    for (let i = 0; i < freshE.length; i += stepF) {
      const part = freshE.slice(i, i + stepF);
      const where = part.map(() => "(asin=? AND cond=?)").join(" OR ");
      const bind = [];
      for (const q of part) bind.push(q.asin, q.cond);
      const got = await env.DB.prepare(
        `SELECT asin, cond, one_off, one_off_known, dropship FROM items
          WHERE ${where}`).bind(...bind).all();
      for (const r of (got && got.results) || []) flg[r.asin + "|" + r.cond] = r;
    }
    for (const x of freshE) {
      const off = skStampOff(flg[x.asin + "|" + x.cond], x);
      if (off) { run.notes.push("sk_skip " + x.asin + "|" + x.cond + " " + off); continue; }
      estmts.push(env.DB.prepare(
        `UPDATE items SET sold_keep=1,
           sold_price=CASE WHEN COALESCE(ebay_price,0)>0 THEN ebay_price ELSE sold_price END,
           sold_kept_at=?3, sk_act=NULL, sk_why=NULL, sk_fail=0, updated_at=?4
         WHERE asin=?1 AND cond=?2`).bind(x.asin, x.cond, x.at || nowIso(), nowIso()));
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
  /* 売れた行に MW の無在庫（W-<JAN>）があれば、注文の材料を出す（7.72）。
     商品名・JAN・社・卸値・出荷日・注文の期限。 */
  try {
    const mwSold = soldE.filter((x) => mwJanOfSku(x.sku));
    if (mwSold.length) {
      const n = await mwOrderNotify(env, run, mwSold.map((x) => ({
        sku: x.sku, qty: x.qty, orderedAt: x.at,
        hand: daysLeft(x.shipBy) || MW_HAND_DEFAULT })));
      if (n) run.notes.push("MWに注文が必要な行 " + n + "件を知らせました");
    }
  } catch (e) { run.notes.push("mw-order: " + String((e && e.message) || e)); }
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
  /* カートリッジのみ（-C）は手元から発送するので、売れたら手元在庫を減らす。
     eBayの数量もその場で同じだけ減らす（1時間ごとの出品の取り込みを待つあいだ
     「数量と手元在庫が合いません」が出続けないようにする。次の取り込みで
     eBay側の本当の数量に上書きされる）。
     手元の数をまだ送っていない行（NULL）は触らない。 */
  const cartDown = [];
  for (const s2 of soldE) {
    if (!isCart(s2)) continue;
    const n = Number(s2.qty || 0);
    if (!(n > 0) || !fresh[s2.orderId + "|" + s2.line]) continue;
    cartDown.push(env.DB.prepare(
      `UPDATE items SET hand_qty=MAX(0, COALESCE(hand_qty,0)-?3),
         ebay_qty=CASE WHEN ebay_qty IS NULL THEN ebay_qty ELSE MAX(0, ebay_qty-?3) END,
         updated_at=?4
       WHERE asin=?1 AND cond=?2 AND hand_qty IS NOT NULL`
    ).bind(s2.asin, s2.cond, n, nowIso()));
  }
  if (cartDown.length) {
    await runBatch(env, run, cartDown);
    run.notes.push("カートリッジのみの手元在庫を減らした " + cartDown.length + "件");
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
      /* buy_src は SKU の接頭辞から決まる（mwgame/mwhobby は MW）。
         jan・社・cost_src は登録したときにしか分からないので、ここでは触らない。 */
      `INSERT INTO skus (seller_sku, asin, cond, cond_code, prefix, scope, purchased_on, cost,
         ebay_custom_label, title, fba_available, fba_inbound, fba_reserved,
         fba_res_cust, fba_res_trans, fba_res_proc, fba_seen_at,
         active, updated_at, buy_src)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)
       ON CONFLICT(seller_sku) DO UPDATE SET
         title=COALESCE(NULLIF(excluded.title,''), skus.title),
         buy_src=excluded.buy_src,
         fba_available=excluded.fba_available, fba_inbound=excluded.fba_inbound,
         fba_reserved=excluded.fba_reserved,
         fba_res_cust=excluded.fba_res_cust, fba_res_trans=excluded.fba_res_trans,
         fba_res_proc=excluded.fba_res_proc, fba_seen_at=excluded.fba_seen_at,
         active=excluded.active, updated_at=excluded.updated_at`
    ).bind(r.sku, asin, cond, p.condCode || "", p.prefix || "", p.scope, p.purchasedOn || "",
           p.cost, null, r.title, r.available, r.inbound, r.reserved,
           numOrNull(r.resCust), numOrNull(r.resTrans), numOrNull(r.resProc), nowIso(),
           zero ? 0 : 1, nowIso(), skuSrcOf(p.prefix)));
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
       /* 予約済みの内訳も合算する。予約済みを持つ個体のうち内訳が取れていないものが
          1件でもあれば NULL（内訳不明）にする。足りない分を0として足すと、
          本当に売れた行の警告を落としてしまうため。
          予約済みが0の個体は内訳も0なので、その NULL では不明にしない
          （在庫0のまま更新されない古いSKUが1件あると、商品ごと永久に
          「内訳不明」になってしまう。2026-10-07）。 */
       fba_res_cust =(SELECT CASE
          /* 予約済みを持つ個体が無ければ内訳も0。古いSKUの NULL で
             「内訳不明」にしてしまわないよう、予約済みが0の個体は見ない。 */
          WHEN SUM(CASE WHEN COALESCE(fba_reserved,0)>0 THEN 1 ELSE 0 END)=0 THEN 0
          WHEN SUM(CASE WHEN COALESCE(fba_reserved,0)>0 AND fba_res_cust IS NULL
                        THEN 1 ELSE 0 END)>0 THEN NULL
          ELSE SUM(CASE WHEN COALESCE(fba_reserved,0)>0
                        THEN COALESCE(fba_res_cust,0) ELSE 0 END) END
                      FROM skus WHERE skus.asin=items.asin AND skus.cond=items.cond),
       fba_res_trans=(SELECT CASE
          /* 予約済みを持つ個体が無ければ内訳も0。古いSKUの NULL で
             「内訳不明」にしてしまわないよう、予約済みが0の個体は見ない。 */
          WHEN SUM(CASE WHEN COALESCE(fba_reserved,0)>0 THEN 1 ELSE 0 END)=0 THEN 0
          WHEN SUM(CASE WHEN COALESCE(fba_reserved,0)>0 AND fba_res_trans IS NULL
                        THEN 1 ELSE 0 END)>0 THEN NULL
          ELSE SUM(CASE WHEN COALESCE(fba_reserved,0)>0
                        THEN COALESCE(fba_res_trans,0) ELSE 0 END) END
                      FROM skus WHERE skus.asin=items.asin AND skus.cond=items.cond),
       fba_res_proc =(SELECT CASE
          /* 予約済みを持つ個体が無ければ内訳も0。古いSKUの NULL で
             「内訳不明」にしてしまわないよう、予約済みが0の個体は見ない。 */
          WHEN SUM(CASE WHEN COALESCE(fba_reserved,0)>0 THEN 1 ELSE 0 END)=0 THEN 0
          WHEN SUM(CASE WHEN COALESCE(fba_reserved,0)>0 AND fba_res_proc IS NULL
                        THEN 1 ELSE 0 END)>0 THEN NULL
          ELSE SUM(CASE WHEN COALESCE(fba_reserved,0)>0
                        THEN COALESCE(fba_res_proc,0) ELSE 0 END) END
                      FROM skus WHERE skus.asin=items.asin AND skus.cond=items.cond),
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
         -- 配送ポリシー名。返らなかった回で消さないよう、空のときは前の値を残す
         ebay_ship_profile=COALESCE(NULLIF(?12,''), ebay_ship_profile),
         /* ベストオファーの設定。返らなかった回で消さないよう、
            NULL（未取得）のときは前の値を残す。 */
         ebay_bo=COALESCE(?13, ebay_bo),
         ebay_bo_accept=COALESCE(?14, ebay_bo_accept),
         ebay_bo_decline=COALESCE(?15, ebay_bo_decline),
         /* eBayのセールの有無。**そのまま入れ替える**（6.59）。
            セールが終わった回に 0 へ戻すことで、値上げ・値下げの対象に自動で戻る。
            セール前の値段と終わる時刻は、取れたときだけ入れ替える。 */
         ebay_sale=?16,
         ebay_sale_orig=CASE WHEN ?16=1 THEN COALESCE(?17, ebay_sale_orig) ELSE NULL END,
         ebay_sale_end=CASE WHEN ?16=1 THEN COALESCE(NULLIF(?18,''), ebay_sale_end)
                            ELSE NULL END,
         updated_at=?8
       WHERE asin=?1 AND cond=?2`
    ).bind(k.asin, k.cond, it.itemId, it.sku, it.qty, it.price, it.currency, runAt, it.title,
           it.start || "", k.dropship ? 1 : 0, it.shipProfile || "",
           (it.bo === null || it.bo === undefined) ? null : it.bo,
           (it.boAccept === null || it.boAccept === undefined) ? null : it.boAccept,
           (it.boDecline === null || it.boDecline === undefined) ? null : it.boDecline,
           (it.sale === null || it.sale === undefined) ? 0 : it.sale,
           (it.saleOrig === null || it.saleOrig === undefined) ? null : it.saleOrig,
           it.saleEnd || ""));
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
    /* 1行につき最大2回（その行の状態＋新品）要求するので、行数は上限の半分にする。 */
  ).bind(Math.ceil(PRICING_BATCH * PRICING_MAX_CALLS / 2)).all();
  const keys = (q && q.results) || [];
  if (!keys.length) return 0;
  const low = await amazonLowest(env, run, lowestReqs(keys));
  const at = nowIso();
  const stmts = [];
  for (const k of keys) {
    /* cart（カートリッジのみ）の行は、Amazon では中古として引く。
       これまでは 'B…|cart' で探していて、いつも空振りしていた。 */
    const v = low[lowestKey(k)];
    if (v) stmts.push(env.DB.prepare(
      `UPDATE items SET amazon_lowest=?3, amazon_lowest_n=?4, amazon_offers=?5,
         amazon_offers_json=?7, amazon_lowest_at=?6, updated_at=?6
       WHERE asin=?1 AND cond=?2`).bind(k.asin, k.cond, v.low, v.lowN, v.total, at,
         JSON.stringify(v.offers || [])));
    // 中古の行には「新品の最安値」も入れる（新品のほうが安ければ値付けの基準になる）
    if (k.cond !== "new") {
      const vn = low[k.asin + "|new"];
      if (vn) stmts.push(env.DB.prepare(
        `UPDATE items SET amazon_new_low=?3, amazon_new_n=?4, amazon_new_at=?5,
           updated_at=?5 WHERE asin=?1 AND cond=?2`)
        .bind(k.asin, k.cond, vn.low, vn.lowN, at));
    }
  }
  await runBatch(env, run, stmts);
  run.notes.push("最安値 " + stmts.length + "件");
  return stmts.length;
}

/* ---- 3時間ごとの最安値（7.49）----
   再調達中の行とフェイズBの対象行は、Amazon最安値が動くと利益がそのまま動く。
   日次（syncPricing）は1回60行なので、出品が1,500行あると一周に25日かかり、
   「最安値が24時間より古い」で自動の反映（7.48）やフェイズBの再調達（7.47）が
   動かなかった。この2種類だけを3時間ごとに取り直す。
   上限（PRICING_HOT_MAX）を超えた回は、取り切れなかった件数を
   画面（/status の hot_pricing）と Discord に出す。 */
function pricingHotWhere() {
  /* 再調達中、またはフェイズBが見る行（FBAの販売可能が0・出品中・
     手元在庫／無在庫／一点物でない）。pbTarget の細かい条件（予約済みの内訳・
     入庫中・セール中）まではここで見ない（少し広めに取るだけなので害がない）。 */
  return `scope='ebay' AND COALESCE(ebay_item_id,'')<>'' AND ebay_qty>0
            AND (restocking=1
                 OR (COALESCE(fba_available,-1)=0
                     AND COALESCE(on_hand,0)=0
                     AND COALESCE(dropship,0)=0
                     AND COALESCE(one_off,0)=0))`;
}
async function syncPricingHot(env, run) {
  const res = { picked: 0, rows: 0, left: 0, max: PRICING_HOT_MAX, wrote: 0 };
  /* 全体の件数を先に数える（上限で取り切れなかった件数を出すため）。 */
  try {
    const c = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM items WHERE ${pricingHotWhere()}`).first();
    res.picked = Number((c && c.n) || 0);
  } catch (e) { run.notes.push("3時間ごとの最安値：件数が数えられません " + e.message); }
  if (!res.picked) return res;
  const q = await env.DB.prepare(
    /* 最安値が古い行（まだ一度も取っていない行を含む）から順に取る。 */
    `SELECT asin, cond FROM items WHERE ${pricingHotWhere()}
       ORDER BY amazon_lowest_at IS NOT NULL, amazon_lowest_at
       LIMIT ?1`).bind(PRICING_HOT_MAX).all();
  const keys = (q && q.results) || [];
  res.rows = keys.length;
  res.left = Math.max(0, res.picked - res.rows);
  if (!keys.length) return res;
  const low = await amazonLowest(env, run, lowestReqs(keys));
  const at = nowIso();
  const stmts = [];
  for (const k of keys) {
    const v = low[lowestKey(k)];
    if (v) stmts.push(env.DB.prepare(
      `UPDATE items SET amazon_lowest=?3, amazon_lowest_n=?4, amazon_offers=?5,
         amazon_offers_json=?7, amazon_lowest_at=?6, updated_at=?6
       WHERE asin=?1 AND cond=?2`).bind(k.asin, k.cond, v.low, v.lowN, v.total, at,
         JSON.stringify(v.offers || [])));
    // 中古の行には「新品の最安値」も入れる（新品のほうが安ければ値付けの基準になる）
    if (k.cond !== "new") {
      const vn = low[k.asin + "|new"];
      if (vn) stmts.push(env.DB.prepare(
        `UPDATE items SET amazon_new_low=?3, amazon_new_n=?4, amazon_new_at=?5,
           updated_at=?5 WHERE asin=?1 AND cond=?2`)
        .bind(k.asin, k.cond, vn.low, vn.lowN, at));
    }
  }
  await runBatch(env, run, stmts);
  res.wrote = stmts.length;
  run.notes.push("3時間ごとの最安値：対象 " + res.picked + "件のうち " + res.rows
    + "件を取り直し（書き込み " + res.wrote + "件）"
    + (res.left ? ("／上限 " + PRICING_HOT_MAX + "件で取り切れなかった " + res.left + "件は次回")
                : ""));
  /* 結果を残す（画面の帯と、次回の知らせの間隔に使う）。 */
  let prev = null;
  try { const t = await stateGet(env, PRICING_HOT_KEY); prev = t ? JSON.parse(t) : null; }
  catch (e) { prev = null; }
  const warnAt = (res.left && (!prev || !prev.warn_at
                   || (Date.now() - Date.parse(prev.warn_at) > PRICING_HOT_WARN_MS)))
    ? at : ((prev && prev.warn_at) || "");
  try {
    await stateSet(env, PRICING_HOT_KEY, JSON.stringify({
      at: at, picked: res.picked, rows: res.rows, left: res.left,
      max: PRICING_HOT_MAX, wrote: res.wrote, warn_at: warnAt })).run();
  } catch (e) { /* 控えの失敗で本処理を落とさない */ }
  // 取り切れなかったときだけ知らせる（同じ知らせは24時間に1回まで）
  if (res.left && warnAt === at)
    await notify(env, run, "⏱️ Amazon最安値（3時間ごと）：対象 " + res.picked
      + "件のうち " + res.rows + "件しか取り直せませんでした（上限 " + PRICING_HOT_MAX
      + "件）。\n取り切れなかった " + res.left
      + "件は次の回に回ります。対象が増えているので、上限を上げてください"
      + "（再調達中とフェイズBの対象の合計）。");
  return res;
}
async function pricingHotLast(env) {
  try {
    const t = await stateGet(env, PRICING_HOT_KEY);
    return t ? JSON.parse(t) : null;
  } catch (e) { return null; }
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

/* ================= 自動値下げ（3日ごとの値下げを eBay に直接反映）=================
   いままでは値下げCSVを書き出して File Exchange にアップロードしていた。
   それを Cron（1日1回）で ReviseFixedPriceItem に置き換える。
   ReviseInventoryStatus はベストオファーを変えられないので使えない
   （売値だけ下げると自動拒否額が売値以上になり 22003 で弾かれる）。

   安全のための決まり：
   ・⚙設定の「自動値下げ」が 'on' のときだけ eBay を変える。
     'plan'（予定だけ表示）では**1回も**書き込みを呼ばない。
   ・1日に変える件数の上限（既定200件）を超えたぶんは次の日に回す。
   ・値下げ幅（md_step）と最低売値（md_floor）は pj_price が決めて D1 に入れる。
     入っていない行は触らない（Worker 側で値付けの式を持たない）。
   ・失敗した行は売値も回数も進めない。理由を revise_err に残して
     「対応が必要」に出す。 */
const MD_MODES = { off: 1, plan: 1, on: 1 };
const MD_MAX_DEFAULT = 200;        // 1日に変える件数の上限
const MD_DAYS_DEFAULT = 3;         // 値下げの間隔（日）
const MD_PICK_LIMIT = 2000;        // 1回に見る行数
const MD_PLAN_SHOW = 50;           // 予定の一覧に入れる件数
/* 権限が足りないときのエラー。トークンの取り直しが必要なので、
   そこで打ち切って通知する（同じ失敗を200件くり返さない）。 */
/* ================= eBay の書き込みエラーの扱い（7.58）=================
   22003 … ベストオファーの**自動拒否額が新しい売値以上**。売値だけ下げると弾かれる。
            GetMyeBaySelling は BestOfferDetails を返さないことがあり、そのとき
            ebay_bo が 0/NULL のままなので、mdBo が自動拒否額を一緒に送れていなかった
            （2026-10-22 の自動値下げで10件失敗した原因）。
   21919137 … 写真が長辺500px未満。写真を入れ替えるまで何度やっても同じなので、
            自動値下げの対象から外す（mdSkip）。
   一時的 … System error など。人が直すものではないので、
            3回で自動処理から外す「失敗の回数」には数えない。 */
const PIC_OK_MIN = 500;            // 出品に使える写真の長辺（px）
const BO_ERR = /\b22003\b|auto\s*decline\s*amount/i;
const PIC_ERR = /\b21919137\b|500\s*pixels|longest side/i;
const TEMP_ERR = /\b(10007|10001|21916750|21917053)\b|system error|internal error|please try again|temporarily unavailable/i;
/* 失敗の理由を短い見出しにまとめる。why は「コード / 短い文 / 長い文」の形。 */
function whyKey(w) {
  const t = String(w || "").trim();
  if (!t) return "理由不明";
  const a = t.split(" / ");
  const code = /^[0-9]{3,9}$/.test(String(a[0] || "").trim()) ? a[0].trim() : "";
  const short = String((code ? a[1] : a[0]) || "").trim() || t;
  return (code ? ("コード " + code + "：") : "") + short.replace(/\s+/g, " ").slice(0, 40);
}
/* 上位 n件（既定3件）を「理由 n件」の形で並べる。Discord の通知に出す。 */
function whyTop(list, n) {
  const m = {};
  for (const w of (list || [])) { const k = whyKey(w); m[k] = (m[k] || 0) + 1; }
  const ks = Object.keys(m).sort((a, b) => (m[b] - m[a]) || (a < b ? -1 : 1));
  return ks.slice(0, n || 3).map((k) => k + " " + m[k] + "件");
}
/* 失敗の理由の行（Discord 用）。1件も無ければ空。 */
function whyLine(list, n) {
  const a = whyTop(list, n);
  if (!a.length) return "";
  const rest = (list || []).length;
  return "失敗の理由：" + a.join("／")
    + ((a.length < Object.keys((list || []).reduce((o, w) => {
        o[whyKey(w)] = 1; return o; }, {})).length)
       ? ("　ほかにも理由があります（計 " + rest + "件）") : "");
}
/* ================= 画面と通知に出す時刻は日本時間（7.58）=================
   D1 に入れるのは今までどおり UTC（…Z）。**出すときだけ** JST に直す。
   これまで UTC のまま出していたので、「前回 2026-10-21 18:15」が
   実際には 10/22 03:15（JST）という食い違いが起きていた。 */
const JST_MS = 9 * 60 * 60 * 1000;
function jstText(v) {
  const s0 = String(v || "").trim();
  if (!s0) return "";
  /* 時間帯が付いていなければ UTC とみなす（D1 に入っているのは UTC）。 */
  const iso = (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s0)
               && !/(Z|[+-]\d{2}:?\d{2})$/.test(s0))
    ? (s0.replace(" ", "T") + "Z") : s0;
  const t = Date.parse(iso);
  if (!isFinite(t)) return s0.slice(0, 16).replace("T", " ");
  const d = new Date(t + JST_MS);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate())
    + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes());
}
const MD_SCOPE_ERR = /scope|insufficient permission|not authorized|21916884|931|932|1.32/i;
/* eBayのセール中は値段を変えられない（6.59）。これは失敗ではないので数えず、
   「セール中」の印を立てて、値上げ・自動値下げの対象から一時的に外す。
   セールが終われば次の取り込み（ActiveList）で印が消え、自動で対象に戻る。 */
const SALE_ERR = /21919248|promotional sale|markdown/i;

async function mdSettings(env) {
  let st = {};
  try { st = (await settingsGet(env)).settings || {}; } catch (e) { st = {}; }
  const num = (k, d, lo, hi) => {
    const n = Number(st[k]);
    return (isFinite(n) && n >= lo && n <= hi) ? n : d;
  };
  const mode = String(st.autoMdMode || "off");
  return {
    mode: MD_MODES[mode] ? mode : "off",
    max: Math.round(num("autoMdMax", MD_MAX_DEFAULT, 1, 2000)),
    days: num("csvMarkDays", MD_DAYS_DEFAULT, 1, 365),
  };
}
/* 値下げの対象にしない理由。空なら対象。pj_price の syncMarkSkip と同じ並びで、
   Worker から見える条件だけを見る（売値・最低売値は D1 の値）。 */
function mdSkip(r, st, cutoff) {
  if (!String(r.ebay_item_id || "").trim()) return "出品していません";
  if (Number(r.one_off || 0)) return "一点物";
  if (Number(r.mark_stop || 0)) return "値下げしない";
  if (isDropship(r)) return "無在庫";
  if (Number(r.restocking || 0)) return "再調達中";
  if (Number(r.ebay_sale || 0)) return "eBayのセール中";
  if (Number(r.ebay_qty || 0) <= 0) return "数量0";
  /* 売れたら、その値段が「売れる値段」だと分かったということなので下げない（7.53）。
     sold_keep は eBay で売れたときに立てる。
     下の mark/sold の比べ方は、印を立てる前（v175以前）に売れた行のための保険。
     こちらだけだと **一度も値下げしていない行（mark_at が空）が止まらなかった**。 */
  if (Number(r.sold_keep || 0)) return "売れた値段で保っています";
  /* 写真が長辺500px未満で弾かれた行（21919137）は、写真を入れ替えるまで
     何度やっても同じなので対象から外す（7.58）。
     写真を切り替えると revise_err が消えるので、そこで自動的に戻る。 */
  if (PIC_ERR.test(String(r.revise_err || ""))) return "写真が小さい（要撮り直し）";
  const mark = String(r.mark_at || "");
  const sold = String(r.ebay_sold_at || "");
  if (mark && sold && sold > mark) return "売れたので値下げ停止";
  if (!(Number(r.md_step || 0) > 0) || !(Number(r.md_floor || 0) > 0))
    return "値下げ幅が未設定";
  const now = Number(r.ebay_price || 0);
  if (!(now > 0)) return "売値が分かりません";
  if (now <= Number(r.md_floor || 0)) return "最低売値に着いています";
  if (mark && mark > cutoff) return "間隔が空いていません";
  return "";
}
/* 次に出す売値。最低売値で止める。下げられないときは null。 */
function mdNext(r) {
  const now = Number(r.ebay_price || 0);
  const fl = Math.round(Number(r.md_floor || 0) * 100) / 100;
  const step = Number(r.md_step || 0);
  if (!(now > 0) || !(fl > 0) || !(step > 0)) return null;
  let v = Math.round((now - step) * 100) / 100;
  if (v < fl) v = fl;
  return (v < now) ? v : null;
}
/* ベストオファーの金額。pj_price の syncBoCells と同じ式にしてある。
   自動拒否額（min）は必ず新しい売値より下（22003 を避ける）。
   自動承諾額（acc）は、いまの値が新しい売値以上になる行だけ下げる。 */
function mdBo(r, next) {
  if (!Number(r.ebay_bo || 0)) return { min: 0, acc: 0 };
  const cap = Math.round((next - 0.01) * 100) / 100;
  const fl = Math.round(Number(r.md_floor || 0) * 100) / 100;
  const min = (fl > 0 && fl < cap) ? fl : cap;
  const acc0 = Number(r.ebay_bo_accept || 0);
  return { min: min > 0 ? min : 0, acc: (acc0 > 0 && acc0 >= next) ? cap : 0 };
}
/* ReviseFixedPriceItem の本文。売値とベストオファーの金額を一度に変える。 */
function reviseBody(itemId, price, bo, qty) {
  const money = (tag, v) =>
    "<" + tag + ' currencyID="USD">' + Number(v).toFixed(2) + "</" + tag + ">";
  const det = [];
  if (bo && bo.min > 0) det.push(money("MinimumBestOfferPrice", bo.min));
  if (bo && bo.acc > 0) det.push(money("BestOfferAutoAcceptPrice", bo.acc));
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">'
    + "<Item><ItemID>" + esc(itemId) + "</ItemID>"
    + money("StartPrice", price)
    /* 数量は**フェイズBの再調達のときだけ**送る（7.47）。
       ほかの処理では数量を増やさない。 */
    + ((qty === null || qty === undefined) ? ""
       : ("<Quantity>" + Math.max(0, Math.round(qty)) + "</Quantity>"))
    + (det.length ? ("<ListingDetails>" + det.join("") + "</ListingDetails>") : "")
    + "</Item></ReviseFixedPriceItemRequest>";
}
/* eBay に売値を書き込む（唯一の書き込み。write:true を付けた呼び出しだけ通る）。 */
async function ebayRevise(env, run, token, itemId, price, bo, qty) {
  const resp = await net(run, EBAY_API + "/ws/api.dll", {
    method: "POST",
    write: true,
    headers: {
      "X-EBAY-API-CALL-NAME": "ReviseFixedPriceItem",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": token,
      "content-type": "text/xml",
    },
    body: reviseBody(itemId, price, bo, qty),
  });
  const xml = await resp.text();
  const ack = xmlTag(xml, "Ack");
  const why = [xmlTag(xml, "ErrorCode"), xmlTag(xml, "ShortMessage"),
               xmlTag(xml, "LongMessage")].filter(Boolean).join(" / ").slice(0, 200);
  const ok = resp.ok && /^(Success|Warning)$/i.test(ack);
  return { ok, status: resp.status, ack: ack || ("HTTP" + resp.status),
           why: ok ? "" : (why || ("HTTP " + resp.status)) };
}
/* 1日1回の自動値下げ。mode が 'plan' のときは eBay を呼ばず予定だけ返す。 */
async function jobMarkdown(env) {
  const run = newRun("markdown");
  const res = { mode: "off", picked: 0, changed: 0, failed: 0, skipped: 0,
                capped: 0, sale: 0, pic: 0, bofix: 0, plan: [], fails: [] };
  try {
    const st = await mdSettings(env);
    res.mode = st.mode;
    if (st.mode === "off") {
      run.notes.push("自動値下げはオフ（設定「自動値下げ」を 予定だけ表示 / オン にする）");
      return Object.assign(await saveRun(env, run), res);
    }
    const cutoff = new Date(Date.now() - st.days * 24 * 60 * 60 * 1000).toISOString();
    const q = await env.DB.prepare(
      `SELECT ${ITEM_COLS},
         (SELECT MAX(o.ordered_at) FROM orders o
           WHERE o.channel='ebay' AND o.asin=items.asin AND o.cond=items.cond)
           AS ebay_sold_at
       FROM items
       WHERE scope='ebay' AND COALESCE(ebay_item_id,'')<>''
       ORDER BY COALESCE(mark_at,'') ASC LIMIT ${MD_PICK_LIMIT}`).all();
    /* 目標（値下げ幅・下限）を自分で計算して埋める（7.52）。
       pj_price が30分以内に送った値はそのまま使う。 */
    const self0 = await selfFill(env, run, (q && q.results) || []);
    const rows = self0.rows;
    const due = [];
    for (const r of rows) {
      const why0 = mdSkip(r, st, cutoff);
      if (why0) {
        res.skipped++;
        if (why0 === "写真が小さい（要撮り直し）") res.pic++;
        continue;
      }
      const next = mdNext(r);
      if (next === null) { res.skipped++; continue; }
      due.push({ r, next, bo: mdBo(r, next) });
    }
    res.picked = due.length;
    const list = due.slice(0, st.max);
    res.capped = due.length - list.length;
    res.plan = list.slice(0, MD_PLAN_SHOW).map((x) => ({
      asin: x.r.asin, cond: x.r.cond, item_id: x.r.ebay_item_id,
      from: Number(x.r.ebay_price || 0), to: x.next,
      floor: Number(x.r.md_floor || 0), step: Number(x.r.md_step || 0),
      bo: x.bo.min, done: Number(x.r.md_done || 0),
    }));
    if (st.mode === "plan") {
      run.notes.push("予定だけ表示：" + res.picked + "件が値下げの時期"
        + (res.capped ? ("（上限 " + st.max + "件を超えた " + res.capped + "件は翌日）") : "")
        + "／とばした " + res.skipped + "件。eBay は変えていません");
      await mdLog(env, run, st, res);
      return Object.assign(await saveRun(env, run), res);
    }
    if (!list.length) {
      run.notes.push("値下げの時期の出品はありません（とばした " + res.skipped + "件）");
      await mdLog(env, run, st, res);
      return Object.assign(await saveRun(env, run), res);
    }
    const token = await ebayToken(env, run);
    const at = nowIso();
    const stmts = [];
    let scopeErr = "";
    for (const x of list) {
      const r = x.r;
      /* 22003 が返ったら、本当のベストオファー設定を取り直して1回だけやり直す（7.58）。 */
      const fx = await reviseFix(env, run, token, r, x.next, x.bo, null, r.md_floor);
      const v = fx.v;
      if (fx.stmt) stmts.push(fx.stmt);
      if (fx.fixed) res.bofix = (res.bofix || 0) + 1;
      if (v.ok) {
        res.changed++;
        stmts.push(env.DB.prepare(
          `UPDATE items SET ebay_price=?3, mark_at=?4, md_done=COALESCE(md_done,0)+1,
             ebay_bo_decline=CASE WHEN ?5>0 THEN ?5 ELSE ebay_bo_decline END,
             revise_err=NULL, revise_err_at=NULL, updated_at=?4
           WHERE asin=?1 AND cond=?2`
        ).bind(r.asin, r.cond, x.next, at, x.bo.min));
      } else if (SALE_ERR.test(v.why)) {
        /* セール中の出品。失敗には数えず、印を立てて次回からとばす（6.59）。 */
        res.sale++;
        stmts.push(env.DB.prepare(
          `UPDATE items SET ebay_sale=1, revise_err=NULL, revise_err_at=NULL,
             updated_at=?3 WHERE asin=?1 AND cond=?2`
        ).bind(r.asin, r.cond, at));
      } else {
        res.failed++;
        run.errors++;
        res.fails.push(v.why);                 // 理由の内訳（Discord に出す・7.58）
        stmts.push(env.DB.prepare(
          `UPDATE items SET revise_err=?3, revise_err_at=?4, updated_at=?4
           WHERE asin=?1 AND cond=?2`
        ).bind(r.asin, r.cond, ("自動値下げ " + v.why).slice(0, 300), at));
        if (MD_SCOPE_ERR.test(v.why)) { scopeErr = v.why; break; }
      }
    }
    await runBatch(env, run, stmts);
    run.notes.push("自動値下げ：下げた " + res.changed + "件／失敗 " + res.failed
      + "件／とばした " + res.skipped + "件"
      + (res.sale ? ("／セール中で外した " + res.sale + "件") : "")
      + (res.capped ? ("／上限で翌日に回した " + res.capped + "件") : ""));
    if (scopeErr)
      run.notes.push("権限が足りません（eBayのユーザートークンを sell.inventory の"
        + "スコープで取り直してください）：" + scopeErr);
    await mdLog(env, run, st, res, scopeErr);
    await notify(env, run, mdNotifyText(res, st, scopeErr));
  } catch (e) {
    run.errors++;
    run.notes.push("例外 " + e.message);
  }
  return Object.assign(await saveRun(env, run), res);
}
/* 実行結果を md_runs に残す（1日1行が基本）。 */
async function mdLog(env, run, st, res, scopeErr) {
  try {
    await env.DB.prepare(
      `INSERT INTO md_runs (at, mode, picked, changed, failed, skipped, capped, note,
         created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?1)`
    ).bind(nowIso(), res.mode, res.picked, res.changed, res.failed, res.skipped,
           res.capped,
           ((scopeErr ? ("権限不足 " + scopeErr + " / ") : "")
            + "上限 " + st.max + "件・間隔 " + st.days + "日").slice(0, 500)).run();
  } catch (e) { /* ログの失敗で本処理を落とさない */ }
}
function mdNotifyText(res, st, scopeErr) {
  if (!res.changed && !res.failed && !res.sale) return "";
  const t = ["🏷️ 自動値下げ（" + st.days + "日ごと）",
    "下げた " + res.changed + "件／失敗 " + res.failed + "件／とばした " + res.skipped + "件"
    + (res.sale ? ("／セール中 " + res.sale + "件") : "")];
  if (res.bofix)
    t.push("ベストオファーの自動拒否額を直してやり直した " + res.bofix + "件（22003）");
  if (res.pic)
    t.push("写真が小さくて対象外 " + res.pic + "件"
      + "（絞り込み「写真が小さい（要撮り直し）」で撮り直してください）");
  const wl = whyLine(res.fails);
  if (wl) t.push(wl);
  if (res.capped) t.push("上限 " + st.max + "件を超えた " + res.capped + "件は翌日に回しました");
  if (scopeErr) t.push("⚠️ 権限が足りません。eBayのユーザートークンを取り直してください");
  res.plan.slice(0, 10).forEach((x) => {
    t.push("・" + x.asin + "（" + x.cond + "） $" + x.from.toFixed(2)
      + " → $" + x.to.toFixed(2) + "（下限 $" + x.floor.toFixed(2) + "）");
  });
  return t.join("\n");
}
/* 直近の実行結果（pj_price の画面に出す）。 */
async function mdLast(env) {
  try {
    const r = await env.DB.prepare(
      `SELECT at, mode, picked, changed, failed, skipped, capped, note
         FROM md_runs ORDER BY id DESC LIMIT 1`).first();
    return r || null;
  } catch (e) { return null; }
}

/* ================= 売値の見直しの自動反映（7.39）=================
   いままで「売値の見直し」は価格更新CSVを書き出して File Exchange に
   アップロードしていた。それを Cron（1日1回）で ReviseInventoryStatus に置き換える。

   何を変えるか（決めるのは pj_price、変えるのは Worker）:
   ・rv_want  … 出すべき売値（$）。相場（Sold）が入っていればその判断を優先した値。
   ・rv_floor … 最低利益ライン（$）。これより下げることはしない。
   ・rv_kind  … 相場の判断（rec／match／none／skip）。skip＝見送り。
   ・rv_max_cost … rv_want で出したときの仕入値の上限（円）。再調達の監視に使う。
   Worker は値付けの式を持たない（md_step・restock_max_cost と同じ考え方）。

   安全のための決まり:
   ・上げるだけ。**値下げは自動値下げ（jobMarkdown）に任せる**。
   ・'confirm'（確認モード）では eBay を1回も呼ばず、予定を残して Discord に出す。
     販売連携タブの「まとめて実行」（POST /sync {kind:'review',approve:true}）で実行。
   ・1日に変える件数の上限（既定50件）と、1回の変更幅の上限（既定30%）。
   ・見送り（rv_kind='skip'）の行は数量0にする。出品そのものは終わらせない
     （eBayの「在庫切れオプション」を有効にしておく必要がある）。
   ・「値下げしない」「一点物」の行も**値上げはする**（赤字を避けるため）。
   ・自動値下げの途中（md_done≧1）の行は上げない。綱引きになるため。
     ただし赤字（いまの売値が最低利益ラインより下）の行だけは例外で上げる。
   ・失敗した行は次の回に再試行し、3回続けて失敗したら「対応が必要」に出す。 */
const RV_MODES = { off: 1, confirm: 1, auto: 1 };
const RV_MAX_DEFAULT = 50;         // 1日に変える件数の上限
const RV_PCT_DEFAULT = 30;         // 1回の変更幅の上限（%）
const RV_BATCH = 4;                // ReviseInventoryStatus は1回4件まで
const RV_PICK_LIMIT = 2000;        // 1回に見る行数
const RV_PLAN_SHOW = 50;           // 予定の一覧に入れる件数
const RV_FAIL_WARN = 3;            // これだけ続けて失敗したらお知らせにする
const RV_PLAN_KEY = "rv.plan";     // 確認モードの予定（sync_state）
const RV_DAY_MS = 24 * 60 * 60 * 1000;
/* 権限が足りないときのエラー。トークンの取り直しが必要なので、
   そこで打ち切って通知する（同じ失敗をくり返さない）。 */
const RV_SCOPE_ERR = MD_SCOPE_ERR;

async function rvSettings(env) {
  let st = {};
  try { st = (await settingsGet(env)).settings || {}; } catch (e) { st = {}; }
  const num = (k, d, lo, hi) => {
    const n = Number(st[k]);
    return (isFinite(n) && n >= lo && n <= hi) ? n : d;
  };
  const mode = String(st.autoRvMode || "off");
  return {
    mode: RV_MODES[mode] ? mode : "off",
    max: Math.round(num("autoRvMax", RV_MAX_DEFAULT, 1, 2000)),
    pct: num("autoRvPct", RV_PCT_DEFAULT, 1, 100),
    // 見直しのしきい値（金額・割合）は出品CSVタブの設定をそのまま使う
    abs: num("csvReviewAbs", 1, 0, 1000),
    th: num("csvReviewPct", 3, 0, 100),
  };
}
// 赤字（いまの売値が最低利益ラインより下）
function rvLoss(r) {
  const fl = Number(r.rv_floor || 0), now = Number(r.ebay_price || 0);
  return fl > 0 && now > 0 && now < fl - 0.001;
}
/* 対象にしない理由。空なら対象。 */
function rvSkip(r, st) {
  if (!String(r.ebay_item_id || "").trim()) return "出品していません";
  if (Number(r.ebay_sale || 0)) return "eBayのセール中";
  /* 売れた値段で保っている行は**値上げもしない**（7.53）。
     これまでは値下げだけ止めていたので、Amazon最安値が上がると
     売れた値段より上に引き上げられていた。 */
  if (Number(r.sold_keep || 0)) return "売れた値段で保っています";
  /* 再調達中の行は「再調達中の売値の追従」（7.48）が上げも下げも見る。
     こちらで触ると同じ行を2つの仕組みが動かすことになるので外す。 */
  if (isRestocking(r)) return "再調達中（売値の追従が見ます）";
  const qty = Number(r.ebay_qty || 0);
  // 見送り（相場が最低売値に届かない行）。数量0にするだけ
  if (String(r.rv_kind || "") === "skip") return qty > 0 ? "" : "すでに数量0";
  if (qty <= 0) return "数量0";
  const want = Number(r.rv_want || 0);
  if (!(want > 0)) return "目標の売値が未設定";
  const now = Number(r.ebay_price || 0);
  if (!(now > 0)) return "売値が分かりません";
  // 下げる話は自動値下げに任せる（ここでは上げるだけ）
  if (want <= now + 0.001) return "上げる必要がありません";
  if (rvLoss(r)) return "";            // 赤字の行はしきい値も値下げ中も見ない
  const diff = want - now;
  if (diff < st.abs || (diff / now * 100) < st.th) return "差が小さい";
  if (Number(r.md_done || 0) > 0) return "自動値下げの途中";
  return "";
}
/* この行に何をするか。null なら何もしない。
   kind … 'up'（売値を上げる）/ 'zero'（見送りで数量0にする） */
function rvAct(r, st) {
  if (rvSkip(r, st)) return null;
  const now = Math.round(Number(r.ebay_price || 0) * 100) / 100;
  if (String(r.rv_kind || "") === "zero" || String(r.rv_kind || "") === "skip")
    return { kind: "zero", from: now, to: 0, want: 0, capped: false, loss: false };
  const want = Math.round(Number(r.rv_want || 0) * 100) / 100;
  // 1回の変更幅の上限。超えるぶんは次の回に回す（いきなり大きく動かさない）
  const cap = Math.round(now * (1 + st.pct / 100) * 100) / 100;
  const to = (want > cap) ? cap : want;
  if (!(to > now)) return null;
  return { kind: "up", from: now, to: to, want: want, capped: want > cap,
           loss: rvLoss(r), floor: Number(r.rv_floor || 0) };
}
/* ReviseInventoryStatus の本文。1回に4件まで入れられる。
   売値だけ・数量だけを変えられるAPIなので、ベストオファーの金額は触らない
   （上げる方向なので自動拒否額が売値以上になることはない）。 */
function invBody(list) {
  const money = (tag, v) =>
    "<" + tag + ' currencyID="USD">' + Number(v).toFixed(2) + "</" + tag + ">";
  /* kind='zero'      … 数量0（売り越しを止める）
     kind='restock'   … 売値と数量を1回で変える（フェイズBの再調達・7.47）
     kind='relist'    … **数量だけ**1に戻す（在庫補充・7.53。売値は送らない）
     それ以外         … 売値だけ（売値の自動反映） */
  const one = (x) => {
    if (x.kind === "zero") return "<Quantity>0</Quantity>";
    if (x.kind === "restock")
      return money("StartPrice", x.to) + "<Quantity>" + Math.max(0, Math.round(x.qty || 1))
        + "</Quantity>";
    if (x.kind === "relist")
      return "<Quantity>" + Math.max(1, Math.round(x.qty || 1)) + "</Quantity>";
    return money("StartPrice", x.to);
  };
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">'
    + list.map((x) => "<InventoryStatus><ItemID>" + esc(x.item_id) + "</ItemID>"
        + one(x) + "</InventoryStatus>").join("")
    + "</ReviseInventoryStatusRequest>";
}
/* 4件ぶんをまとめて eBay に書き込む（唯一の書き込みの2つめ）。
   どの行が通ったかは、応答に返ってくる InventoryStatus の ItemID で見る。 */
async function ebayReviseInv(env, run, token, list) {
  const resp = await net(run, EBAY_API + "/ws/api.dll", {
    method: "POST",
    write: true,
    headers: {
      "X-EBAY-API-CALL-NAME": "ReviseInventoryStatus",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": token,
      "content-type": "text/xml",
    },
    body: invBody(list),
  });
  const xml = await resp.text();
  const ack = xmlTag(xml, "Ack");
  const why = [xmlTag(xml, "ErrorCode"), xmlTag(xml, "ShortMessage"),
               xmlTag(xml, "LongMessage")].filter(Boolean).join(" / ").slice(0, 200);
  /* 失敗の理由を**行ごと**に取り出す（6.59）。1回に4件送るので、
     どの出品のエラーかが分からないと「セール中」の行を取り違える。
     Errors の ErrorParameters に ItemID が入っていればその行の理由にする。 */
  const errs = [];
  const reErr = /<Errors>([\s\S]*?)<\/Errors>/g;
  let mE;
  while ((mE = reErr.exec(xml))) {
    const eb = mE[1];
    const ids = [];
    const reP = /<ErrorParameters[^>]*>([\s\S]*?)<\/ErrorParameters>/g;
    let mP;
    while ((mP = reP.exec(eb))) {
      const v = xmlTag(mP[1], "Value");
      if (/^[0-9]{9,15}$/.test(v)) ids.push(v);
    }
    errs.push({
      code: xmlTag(eb, "ErrorCode"),
      why: [xmlTag(eb, "ErrorCode"), xmlTag(eb, "ShortMessage"),
            xmlTag(eb, "LongMessage")].filter(Boolean).join(" / ").slice(0, 200),
      ids: ids,
    });
  }
  const done = {};
  const re = /<InventoryStatus>([\s\S]*?)<\/InventoryStatus>/g;
  let m;
  while ((m = re.exec(xml))) {
    const id = xmlTag(m[1], "ItemID");
    if (id) done[id] = true;
  }
  /* eBay は、送った行がすべて通ったときだけ Ack=Success を返す。
     Warning / Failure のときは「変えられた行の InventoryStatus」だけが返るので、
     その ItemID に無い行は失敗とみなす（1件だけ失敗した回も取りこぼさない）。 */
  const okAll = resp.ok && /^Success$/i.test(ack);
  return {
    ok: (id) => okAll || !!done[id],
    status: resp.status, ack: ack || ("HTTP" + resp.status),
    why: okAll ? "" : (why || ("HTTP " + resp.status)),
    /* その出品あてのエラー。ItemID で引けないときは null（呼ぶ側で全体の理由を使う）。 */
    errFor: (id) => errs.find((e) => e.ids.indexOf(String(id)) >= 0) || null,
    errs: errs,
  };
}
/* 直近24時間に変えた件数（1日の上限に使う）。
   確認モードの承認とCronの回をまたいでも、合計で上限を超えないようにする。 */
async function rvUsedToday(env) {
  try {
    const r = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM rv_log WHERE ok=1 AND at>=?1")
      .bind(new Date(Date.now() - RV_DAY_MS).toISOString()).first();
    return Number((r && r.n) || 0);
  } catch (e) { return 0; }
}
async function rvPlanGet(env) {
  try {
    const s = await stateGet(env, RV_PLAN_KEY);
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}
async function rvPlanSet(env, o) {
  try { await stateSet(env, RV_PLAN_KEY, JSON.stringify(o)).run(); } catch (e) { /* 予定の保存で本処理を落とさない */ }
}
/* 連続で失敗している行（3回以上）。お知らせに件数を出す。 */
async function rvFailN(env) {
  try {
    const r = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM items WHERE COALESCE(rv_fail,0)>=?1")
      .bind(RV_FAIL_WARN).first();
    return Number((r && r.n) || 0);
  } catch (e) { return 0; }
}
/* 1日1回の自動反映。approve＝true のときは確認モードでも実行する（承認）。 */
async function jobReview(env, opt) {
  const approve = !!(opt && opt.approve);
  const run = newRun("review");
  const res = { mode: "off", picked: 0, changed: 0, zeroed: 0, failed: 0, skipped: 0,
                capped: 0, sale: 0, used: 0, max: RV_MAX_DEFAULT, fail3: 0,
                bofix: 0, temp: 0, plan: [], fails: [] };
  try {
    const st = await rvSettings(env);
    res.mode = approve ? "approve" : st.mode;
    res.max = st.max;
    if (st.mode === "off" && !approve) {
      run.notes.push("自動反映はオフ（設定「売値の自動反映」を 確認モード / 自動実行 にする）");
      return Object.assign(await saveRun(env, run), res);
    }
    /* 目標が入っていない行も見る（Worker が自分で計算するため・7.52）。 */
    const q = await env.DB.prepare(
      `SELECT ${ITEM_COLS} FROM items
        WHERE scope='ebay' AND COALESCE(ebay_item_id,'')<>''
        ORDER BY COALESCE(rv_at,'') ASC LIMIT ${RV_PICK_LIMIT}`).all();
    const selfR = await selfFill(env, run, (q && q.results) || []);
    const rows = selfR.rows;
    const due = [];
    for (const r of rows) {
      const a = rvAct(r, st);
      if (!a) { res.skipped++; continue; }
      due.push(Object.assign({ r: r, asin: r.asin, cond: r.cond,
        item_id: String(r.ebay_item_id || ""),
        name: r.title || r.ebay_sku || r.asin }, a));
    }
    res.picked = due.length;
    res.used = await rvUsedToday(env);
    const left = Math.max(0, st.max - res.used);
    const list = due.slice(0, left);
    res.capped = due.length - list.length;
    res.plan = list.slice(0, RV_PLAN_SHOW).map((x) => ({
      asin: x.asin, cond: x.cond, item_id: x.item_id, name: x.name,
      kind: x.kind, from: x.from, to: x.to, want: x.want,
      capped: x.capped, loss: x.loss,
    }));
    res.fail3 = await rvFailN(env);
    // 確認モードは eBay を呼ばない。予定を残して Discord に出すだけ
    if (!approve && st.mode === "confirm") {
      await rvPlanSet(env, { at: nowIso(), mode: st.mode, n: due.length,
        capped: res.capped, used: res.used, max: st.max, rows: res.plan });
      run.notes.push("確認モード：" + res.picked + "件が変更の候補"
        + (res.capped ? ("（1日の上限 " + st.max + "件を超えた " + res.capped + "件は翌日）") : "")
        + "／とばした " + res.skipped + "件。eBay は変えていません");
      await rvLogRun(env, run, st, res);
      await notify(env, run, rvNotifyText(res, st, ""));
      return Object.assign(await saveRun(env, run), res);
    }
    if (!list.length) {
      run.notes.push("変える出品はありません（とばした " + res.skipped + "件"
        + (res.capped ? ("／上限で翌日に回した " + res.capped + "件") : "") + "）");
      await rvPlanSet(env, { at: nowIso(), mode: res.mode, n: 0, rows: [],
        used: res.used, max: st.max });
      await rvLogRun(env, run, st, res);
      return Object.assign(await saveRun(env, run), res);
    }
    const token = await ebayToken(env, run);
    const at = nowIso();
    const stmts = [];
    let scopeErr = "";
    for (let i = 0; i < list.length; i += RV_BATCH) {
      const part = list.slice(i, i + RV_BATCH);
      const v = await ebayReviseInv(env, run, token, part);
      for (const x of part) {
        const good = v.ok(x.item_id);
        if (good) {
          if (x.kind === "zero") {
            res.zeroed++;
            stmts.push(env.DB.prepare(
              `UPDATE items SET ebay_qty=0, rv_fail=0, rv_done_at=?3,
                 revise_err=NULL, revise_err_at=NULL, updated_at=?3
               WHERE asin=?1 AND cond=?2`).bind(x.asin, x.cond, at));
          } else {
            res.changed++;
            /* 再調達中の行は「出し直した売値」も新しい売値にそろえる。
               「仕入値の上限」は目標どおりに上げられた回だけ入れ替える
               （上限で丸めた回は、その売値に対する上限が分からないため
               前の値＝安全側のまま残す）。 */
            stmts.push(env.DB.prepare(
              `UPDATE items SET ebay_price=?3, rv_fail=0, rv_done_at=?4,
                 restock_price=CASE WHEN restocking=1 THEN ?3 ELSE restock_price END,
                 restock_max_cost=CASE WHEN restocking=1 AND ?5=1
                   THEN COALESCE(?6, restock_max_cost) ELSE restock_max_cost END,
                 revise_err=NULL, revise_err_at=NULL, updated_at=?4
               WHERE asin=?1 AND cond=?2`)
              .bind(x.asin, x.cond, x.to, at, x.capped ? 0 : 1,
                    numOf(x.r, "rv_max_cost")));
          }
          stmts.push(rvLogRow(env, at, x, 1,
            x.capped ? ("上限 " + st.pct + "% で丸めた（目標 $" + x.want.toFixed(2) + "）")
                     : (x.loss ? "赤字の行" : "")));
        } else {
          /* その行あてのエラー。ItemID で引けないときは、
             この回で失敗したのが1件だけなら全体の理由をその行の理由として使う。 */
          const bad = part.filter((y) => !v.ok(y.item_id));
          const one = v.errFor(x.item_id)
                   || ((bad.length === 1) ? { code: "", why: v.why } : null);
          const reason = (one && one.why) || v.why;
          if (one && SALE_ERR.test(one.why || one.code || "")) {
            /* セール中の出品。失敗には数えず、印を立てて対象から外す（6.59）。
               連続失敗の回数も増やさない（人が直すものではないため）。 */
            res.sale++;
            stmts.push(env.DB.prepare(
              `UPDATE items SET ebay_sale=1, rv_fail=0, revise_err=NULL,
                 revise_err_at=NULL, updated_at=?3
               WHERE asin=?1 AND cond=?2`).bind(x.asin, x.cond, at));
            stmts.push(rvLogRow(env, at, x, 0, "セール中のため変えません（21919248）"));
            continue;
          }
          /* 22003（自動拒否額が売値以上）は、本当の設定を取り直して1回だけ
             やり直す（7.58）。ReviseInventoryStatus はベストオファーを送れないので、
             ここで ReviseFixedPriceItem に切り替える。 */
          if (x.kind !== "zero" && BO_ERR.test(String(reason || ""))) {
            const fx = await boRetry(env, run, token, x.r, x.to, null,
                                     numOf(x.r, "rv_floor"), reason);
            if (fx.stmt) stmts.push(fx.stmt);
            if (fx.fixed) {
              res.bofix++; res.changed++;
              stmts.push(env.DB.prepare(
                `UPDATE items SET ebay_price=?3, rv_fail=0, rv_done_at=?4,
                   revise_err=NULL, revise_err_at=NULL, updated_at=?4
                 WHERE asin=?1 AND cond=?2`).bind(x.asin, x.cond, x.to, at));
              stmts.push(rvLogRow(env, at, x, 1, "自動拒否額を直してやり直した（22003）"));
              continue;
            }
          }
          res.failed++;
          run.errors++;
          res.fails.push(reason);              // 理由の内訳（7.58）
          /* System error などの一時的なエラーは、3回で自動処理から外す
             「連続失敗の回数」には数えない（人が直すものではない・7.58）。 */
          const tmp = TEMP_ERR.test(String(reason || ""));
          if (tmp) res.temp++;
          stmts.push(env.DB.prepare(
            `UPDATE items SET rv_fail=CASE WHEN ?5=1 THEN COALESCE(rv_fail,0)
                                           ELSE COALESCE(rv_fail,0)+1 END,
               revise_err=?3, revise_err_at=?4, updated_at=?4
             WHERE asin=?1 AND cond=?2`)
            .bind(x.asin, x.cond, ("売値の自動反映 " + reason).slice(0, 300), at,
                  tmp ? 1 : 0));
          stmts.push(rvLogRow(env, at, x, 0, reason));
          if (RV_SCOPE_ERR.test(reason)) { scopeErr = reason; break; }
        }
      }
      if (scopeErr) break;
    }
    await runBatch(env, run, stmts);
    res.fail3 = await rvFailN(env);
    await rvPlanSet(env, { at: nowIso(), mode: res.mode, n: 0, rows: [],
      used: res.used + res.changed + res.zeroed, max: st.max,
      ran: { changed: res.changed, zeroed: res.zeroed, failed: res.failed } });
    run.notes.push("売値の自動反映：上げた " + res.changed + "件／数量0 " + res.zeroed
      + "件／失敗 " + res.failed + "件／とばした " + res.skipped + "件"
      + (res.sale ? ("／セール中で外した " + res.sale + "件") : "")
      + (res.capped ? ("／上限で翌日に回した " + res.capped + "件") : ""));
    if (scopeErr)
      run.notes.push("権限が足りません（eBayのユーザートークンを sell.inventory の"
        + "スコープで取り直してください）：" + scopeErr);
    await rvLogRun(env, run, st, res, scopeErr);
    await notify(env, run, rvNotifyText(res, st, scopeErr));
  } catch (e) {
    run.errors++;
    run.notes.push("例外 " + e.message);
  }
  return Object.assign(await saveRun(env, run), res);
}
/* 1行ぶんの記録（変更前後の売値つき）。 */
function rvLogRow(env, at, x, ok, why) {
  return env.DB.prepare(
    `INSERT INTO rv_log (at, asin, cond, item_id, kind, from_price, to_price, ok, why)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
  ).bind(at, x.asin, x.cond, x.item_id, x.kind, x.from,
         (x.kind === "zero") ? null : x.to, ok ? 1 : 0, String(why || "").slice(0, 300));
}
/* 実行結果を rv_runs に残す（確認モードの回も残す）。 */
async function rvLogRun(env, run, st, res, scopeErr) {
  try {
    await env.DB.prepare(
      `INSERT INTO rv_runs (at, mode, picked, changed, zeroed, failed, skipped, capped,
         note, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?1)`
    ).bind(nowIso(), res.mode, res.picked, res.changed, res.zeroed, res.failed,
           res.skipped, res.capped,
           ((scopeErr ? ("権限不足 " + scopeErr + " / ") : "")
            + "上限 " + st.max + "件・変更幅 " + st.pct + "%・しきい値 $" + st.abs
            + "かつ" + st.th + "%").slice(0, 500)).run();
  } catch (e) { /* ログの失敗で本処理を落とさない */ }
}
function rvNotifyText(res, st, scopeErr) {
  const confirm = (res.mode === "confirm");
  if (confirm && !res.picked) return "";
  if (!confirm && !res.changed && !res.zeroed && !res.failed) return "";
  const t = [];
  if (confirm) {
    t.push("🔎 売値の見直し（確認モード）：変更の予定 " + res.picked + "件");
    t.push("販売連携タブの「まとめて実行」を押すと反映します（eBay はまだ変えていません）");
  } else {
    t.push("🔁 売値の自動反映"
      + (res.mode === "approve" ? "（まとめて実行）" : "（自動実行）"));
    t.push("上げた " + res.changed + "件／見送りで数量0 " + res.zeroed
      + "件／失敗 " + res.failed + "件／とばした " + res.skipped + "件"
      + (res.sale ? ("／セール中 " + res.sale + "件") : ""));
  }
  if (res.bofix)
    t.push("ベストオファーの自動拒否額を直してやり直した " + res.bofix + "件（22003）");
  const wl = whyLine(res.fails);
  if (wl) t.push(wl);
  if (res.temp)
    t.push("一時的なエラー " + res.temp + "件は次回やり直します（失敗の回数に数えません）");
  if (res.capped)
    t.push("1日の上限 " + st.max + "件を超えた " + res.capped + "件は翌日に回しました");
  if (res.fail3)
    t.push("⚠️ " + res.fail3 + "件は " + RV_FAIL_WARN + "回以上続けて失敗しています（対応が必要）");
  if (scopeErr) t.push("⚠️ 権限が足りません。eBayのユーザートークンを取り直してください");
  res.plan.slice(0, 10).forEach((x) => {
    t.push("・" + x.name + "（" + x.asin + "）"
      + ((x.kind === "zero")
        ? "：見送り → 数量0"
        : ("：$" + x.from.toFixed(2) + " → $" + x.to.toFixed(2)
           + (x.capped ? ("（上限 " + st.pct + "% で丸め・目標 $" + x.want.toFixed(2) + "）") : "")
           + (x.loss ? "（赤字の解消）" : ""))));
  });
  return t.join("\n");
}
/* 直近の実行結果（pj_price の画面に出す）。 */
async function rvLast(env) {
  try {
    const r = await env.DB.prepare(
      `SELECT at, mode, picked, changed, zeroed, failed, skipped, capped, note
         FROM rv_runs ORDER BY id DESC LIMIT 1`).first();
    return r || null;
  } catch (e) { return null; }
}

/* ================= 再調達中の売値を Amazon最安値に追従させる（7.48）=================
   再調達中（restocking=1）の行は「売れてから Amazon で買い直す」ので、
   Amazon最安値が動くと利益がそのまま動く。最安値が上がれば赤字になり、
   下がればもっと安く出せる。これまでは「売値の見直しの自動反映」に乗せていたが、
   そちらは **値上げだけ・確認モード・1回20%までの丸め** があるため、
   「再調達で赤字」の警告が出たまま確認待ちで止まっていた。

   この行だけを別の仕組みにして、**上げも下げも承認なしで**追従させる。
   ・目標の売値（rk_want）は pj_price が計算して送る（Worker は値付けの式を持たない）。
     必ず **Amazon最安値（送料込み・中古は可を除く）を仕入値とみなした推奨売値**で、
     保存済みの仕入値は使わない。
   ・上げ：赤字を解消する値段まで**一度で**上げる（1回の変更幅の丸めはしない）。
   ・下げ：最安値が下がったら下げてよいが、最低売値（rk_floor）より下げない。
   ・差が小さいとき（$1未満 **かつ** 3%未満）は更新しない。
   ・歯止め：最安値が24時間より古い／取れていないときは更新しない。
     最安グループが2人未満のときは**上げだけ**反映し、下げは保留する。
     Amazonの在庫が消えた（最安値が出ない）ときは eBay の数量を0にして知らせる。
   ・eBayのセール中・一点物・無在庫は対象外。1日30件まで。
   ・実行は ReviseInventoryStatus。ベストオファーのある出品だけ
     ReviseFixedPriceItem で自動拒否額も一緒に直す（22003 を避ける）。 */
const RK_MODES = { auto: 1, confirm: 1 };
const RK_MAX = 30;                   // 1日に変える上限
const RK_BATCH = RV_BATCH;           // ReviseInventoryStatus は1回4件まで
const RK_PICK_LIMIT = 400;           // 1回に見る行数
const RK_PLAN_SHOW = 50;             // 予定の一覧に入れる件数
const RK_ABS = 1;                    // これ未満の差は無視（$）
const RK_PCT = 3;                    // これ未満の差は無視（%）
const RK_LOW_MS = 24 * 60 * 60 * 1000;   // Amazon最安値の鮮度
const RK_WANT_MS = 24 * 60 * 60 * 1000;  // 目標の鮮度
const RK_MIN_OFFERS = 2;             // 最安グループがこれ未満なら下げを保留
const RK_FAIL_WARN = 3;
const RK_PLAN_KEY = "rk.plan";
const RK_DAY_MS = 24 * 60 * 60 * 1000;

async function rkSettings(env) {
  let st = {};
  try { st = (await settingsGet(env)).settings || {}; } catch (e) { st = {}; }
  const mode = String(st.autoRkMode || "auto");
  return { mode: RK_MODES[mode] ? mode : "auto" };
}
/* ベストオファーの金額。自動拒否額（min）は必ず新しい売値より下にする。
   自動承諾額（acc）は、いまの値が新しい売値以上になる行だけ下げる（mdBo と同じ式）。 */
function rkBo(r, next) {
  if (!Number(r.ebay_bo || 0)) return { min: 0, acc: 0 };
  const cap = Math.round((next - 0.01) * 100) / 100;
  const fl = Math.round(Number(r.rk_floor || 0) * 100) / 100;
  const min = (fl > 0 && fl < cap) ? fl : cap;
  const acc0 = Number(r.ebay_bo_accept || 0);
  return { min: min > 0 ? min : 0, acc: (acc0 > 0 && acc0 >= next) ? cap : 0 };
}
/* この行に何をするか。
   { kind:'up'|'down'|'zero', from, to, want, under, held, why } か
   { kind:'', why:理由 }（とばす）を返す。held は「下げを保留した」。 */
function rkTarget(r) {
  const no = (why) => ({ kind: "", why: why });
  if (!isRestocking(r)) return no("再調達中ではありません");
  if (!String(r.ebay_item_id || "").trim()) return no("出品していません");
  if (Number(r.ebay_sale || 0)) return no("eBayのセール中");
  if (Number(r.one_off || 0)) return no("一点物");
  if (Number(r.dropship || 0)) return no("無在庫");
  const now = Math.round(Number(r.ebay_price || 0) * 100) / 100;
  if (!(now > 0)) return no("売値が分かりません");
  /* Amazon最安値の鮮度。一度も取っていない行は触らない。 */
  const at = Date.parse(String(r.amazon_lowest_at || ""));
  if (!at) return no("Amazon最安値が未取得");
  if (Date.now() - at > RK_LOW_MS) return no("Amazon最安値が古い（24時間超）");
  /* 新しく見にいけたのに最安値が出ない＝Amazon側の在庫が消えた。
     買い直せないので eBay の数量を0にして知らせる（数量0の行はもう済み）。 */
  const low = restockLowest(r);
  if (!low || Number(r.amazon_offers || 0) === 0) {
    if (Number(r.ebay_qty || 0) <= 0) return no("すでに数量0（Amazonの在庫なし）");
    return { kind: "zero", from: now, to: 0, want: 0, under: false, held: false,
             why: "Amazonの在庫がなくなりました（買い直せません）" };
  }
  if (Number(r.ebay_qty || 0) <= 0) return no("数量0");
  const want = Math.round(Number(r.rk_want || 0) * 100) / 100;
  if (!(want > 0)) return no("目標の売値が未設定");
  const wat = Date.parse(String(r.rk_want_at || ""));
  if (!wat || Date.now() - wat > RK_WANT_MS) return no("目標の売値が古い（24時間超）");
  const fl = Math.round(Number(r.rk_floor || 0) * 100) / 100;
  let to = want, under = false;
  const down = want < now - 0.001;
  if (down) {
    /* 最安グループが1人だけのときは、一時的な安値に引っぱられないように下げを保留。
       上げる方向は保留しない（赤字を放置しないほうが大事）。 */
    const n = Number(r.rk_n || 0);
    if (n < RK_MIN_OFFERS)
      return { kind: "", why: "最安グループが" + n + "人なので下げを保留",
               held: true, from: now, want: want };
    if (fl > 0 && to < fl) { to = fl; under = true; }
  }
  const diff = Math.abs(to - now);
  // $1未満 かつ 3%未満のときだけ「差が小さい」として見送る
  if (diff < RK_ABS && (diff / now * 100) < RK_PCT) return no("差が小さい");
  if (!(Math.abs(to - now) > 0.001)) return no("差がありません");
  return { kind: (to > now) ? "up" : "down", from: now, to: to, want: want,
           under: under, held: false, why: (to > now) ? "最安値が上がりました"
                                                      : "最安値が下がりました" };
}
/* 直近24時間に変えた件数（1日の上限に使う）。 */
async function rkUsedToday(env) {
  try {
    const r = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM rk_log WHERE ok=1 AND at>=?1")
      .bind(new Date(Date.now() - RK_DAY_MS).toISOString()).first();
    return Number((r && r.n) || 0);
  } catch (e) { return 0; }
}
async function rkPlanGet(env) {
  try {
    const s = await stateGet(env, RK_PLAN_KEY);
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}
async function rkPlanSet(env, o) {
  try { await stateSet(env, RK_PLAN_KEY, JSON.stringify(o)).run(); } catch (e) { /* 予定の保存で本処理を落とさない */ }
}
async function rkLast(env) {
  try {
    const r = await env.DB.prepare(
      `SELECT at, mode, picked, up, down, zeroed, failed, skipped, held, capped
         FROM rk_runs ORDER BY id DESC LIMIT 1`).first();
    return r || null;
  } catch (e) { return null; }
}
function rkLogRow(env, at, x, ok, why) {
  return env.DB.prepare(
    `INSERT INTO rk_log (at, asin, cond, item_id, kind, from_price, to_price, low, ok, why)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`
  ).bind(at, x.asin, x.cond, x.item_id, x.kind, x.from,
         (x.kind === "zero") ? null : x.to, numOf(x.r, "rk_low"),
         ok ? 1 : 0, String(why || "").slice(0, 300));
}
async function rkLogRun(env, run, res, scopeErr) {
  try {
    await env.DB.prepare(
      `INSERT INTO rk_runs (at, mode, picked, up, down, zeroed, failed, skipped,
         held, capped, note, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?1)`
    ).bind(nowIso(), res.mode, res.picked, res.up, res.down, res.zeroed, res.failed,
           res.skipped, res.held, res.capped,
           ((scopeErr ? ("権限不足 " + scopeErr + " / ") : "")
            + "1日 " + RK_MAX + "件・しきい値 $" + RK_ABS + "かつ" + RK_PCT
            + "%・最安グループ " + RK_MIN_OFFERS + "人未満は下げ保留").slice(0, 500)).run();
  } catch (e) { run.notes.push("rk_runs に残せません：" + e.message); }
}
function rkNotifyText(res, scopeErr) {
  const plan = (res.mode === "confirm");
  if (plan && !res.picked) return "";
  if (!plan && !res.up && !res.down && !res.zeroed && !res.failed) return "";
  const t = [];
  if (plan) {
    t.push("🔁 再調達中の売値（確認してから）：変更の予定 " + res.picked + "件");
    t.push("販売連携タブの「再調達中の売値をまとめて実行」を押すと反映します"
      + "（eBay はまだ変えていません）");
  } else {
    t.push("🔁 再調達中の売値を Amazon最安値に合わせました"
      + (res.mode === "approve" ? "（まとめて実行）" : "（自動）"));
    t.push("上げた " + res.up + "件／下げた " + res.down + "件／数量0 " + res.zeroed
      + "件／失敗 " + res.failed + "件／とばした " + res.skipped + "件");
  }
  if (res.bofix)
    t.push("ベストオファーの自動拒否額を直してやり直した " + res.bofix + "件（22003）");
  const wl = whyLine(res.fails);
  if (wl) t.push(wl);
  if (res.temp)
    t.push("一時的なエラー " + res.temp + "件は次回やり直します（失敗の回数に数えません）");
  if (res.held)
    t.push("最安グループが " + RK_MIN_OFFERS + "人未満の " + res.held
      + "件は、下げを保留しました（1人だけの安値に引っぱられないため）");
  if (res.capped)
    t.push("1日の上限 " + RK_MAX + "件を超えた " + res.capped + "件は翌日に回しました");
  if (res.zeroed)
    t.push("⚠️ Amazonの在庫が消えた " + res.zeroed + "件は eBay の数量を0にしました"
      + "（買い直せません。出品の扱いを決めてください）");
  if (res.fail3)
    t.push("⚠️ " + res.fail3 + "件は " + RK_FAIL_WARN + "回以上続けて失敗しています");
  if (scopeErr) t.push("⚠️ 権限が足りません。eBayのユーザートークンを取り直してください");
  res.plan.slice(0, 10).forEach((x) => {
    t.push("・" + x.name + "（" + x.asin + "）"
      + ((x.kind === "zero")
        ? "：Amazonの在庫なし → 数量0"
        : ("：$" + x.from.toFixed(2) + " → $" + x.to.toFixed(2)
           + (x.low ? ("（Amazon最安値 ¥" + Math.round(x.low).toLocaleString("ja-JP") + "）") : "")
           + (x.under ? "（最低売値で止めました）" : ""))));
  });
  return t.join("\n");
}
/* 連続で失敗している行の件数。 */
async function rkFailN(env) {
  try {
    const r = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM items WHERE COALESCE(rk_fail,0)>=?1")
      .bind(RK_FAIL_WARN).first();
    return Number((r && r.n) || 0);
  } catch (e) { return 0; }
}
/* 予定の一覧（画面に出す。確認モードでなくても、次に何が起きるかが見える）。 */
async function rkPlanRows(env, run) {
  const q = await env.DB.prepare(
    `SELECT ${ITEM_COLS} FROM items
      WHERE scope='ebay' AND restocking=1 AND COALESCE(ebay_item_id,'')<>''
      ORDER BY COALESCE(rk_at,'') ASC LIMIT ${RK_PICK_LIMIT}`).all();
  /* 目標（rk_want など）を自分で計算して埋める（7.52）。 */
  const self0 = await selfFill(env, run || newRun("rk"), (q && q.results) || []);
  const rows = self0.rows;
  const due = [], hold = [];
  let skipped = 0;
  for (const r of rows) {
    const a = rkTarget(r);
    if (!a.kind) {
      if (a.held) hold.push({ r: r, asin: r.asin, cond: r.cond, why: a.why });
      else skipped++;
      continue;
    }
    due.push(Object.assign({ r: r, asin: r.asin, cond: r.cond,
      item_id: String(r.ebay_item_id || ""),
      name: r.title || r.ebay_sku || r.asin,
      low: Number(r.rk_low || 0) }, a));
  }
  return { due: due, hold: hold, skipped: skipped, total: rows.length };
}
/* 再調達中の売値の追従。approve＝true のときは「確認してから」でも実行する。 */
async function jobRkPrice(env, opt) {
  const approve = !!(opt && opt.approve);
  const run = newRun("restockprice");
  const res = { mode: "auto", picked: 0, up: 0, down: 0, zeroed: 0, failed: 0,
                skipped: 0, held: 0, capped: 0, used: 0, max: RK_MAX, fail3: 0,
                bofix: 0, temp: 0, plan: [], fails: [] };
  try {
    const st = await rkSettings(env);
    res.mode = approve ? "approve" : st.mode;
    const pick = await rkPlanRows(env, run);
    res.picked = pick.due.length;
    res.held = pick.hold.length;
    res.skipped = pick.skipped;
    res.used = await rkUsedToday(env);
    const left = Math.max(0, RK_MAX - res.used);
    const list = pick.due.slice(0, left);
    res.capped = pick.due.length - list.length;
    res.plan = list.slice(0, RK_PLAN_SHOW).map((x) => ({
      asin: x.asin, cond: x.cond, item_id: x.item_id, name: x.name,
      kind: x.kind, from: x.from, to: x.to, want: x.want, low: x.low,
      under: x.under, why: x.why,
    }));
    res.fail3 = await rkFailN(env);
    const planRow = {
      at: nowIso(), mode: res.mode, n: pick.due.length, capped: res.capped,
      held: res.held, skipped: res.skipped, used: res.used, max: RK_MAX,
      hold: pick.hold.slice(0, RK_PLAN_SHOW).map((x) => ({
        asin: x.asin, cond: x.cond, name: x.r.title || x.asin, why: x.why })),
      rows: res.plan,
    };
    // 「確認してから」のときは eBay を1回も呼ばない（予定を残して知らせるだけ）
    if (!approve && st.mode === "confirm") {
      await rkPlanSet(env, planRow);
      run.notes.push("確認してから：" + res.picked + "件が変更の候補"
        + (res.held ? ("／下げを保留 " + res.held + "件") : "")
        + "／とばした " + res.skipped + "件。eBay は変えていません");
      await rkLogRun(env, run, res, "");
      await notify(env, run, rkNotifyText(res, ""));
      return Object.assign(await saveRun(env, run), res);
    }
    if (!list.length) {
      run.notes.push("変える出品はありません（とばした " + res.skipped + "件"
        + (res.held ? ("／下げを保留 " + res.held + "件") : "")
        + (res.capped ? ("／上限で翌日に回した " + res.capped + "件") : "") + "）");
      await rkPlanSet(env, Object.assign({}, planRow, { n: 0, rows: [] }));
      await rkLogRun(env, run, res, "");
      return Object.assign(await saveRun(env, run), res);
    }
    const token = await ebayToken(env, run);
    const at = nowIso();
    const stmts = [];
    let scopeErr = "";
    /* ベストオファーのある出品は1件ずつ ReviseFixedPriceItem（自動拒否額も直す）。
       それ以外はまとめて ReviseInventoryStatus（売値だけ・数量0だけ）。 */
    const okRow = (x) => {
      if (x.kind === "zero") {
        res.zeroed++;
        stmts.push(env.DB.prepare(
          `UPDATE items SET ebay_qty=0, rk_fail=0, rk_done_at=?3, rk_at=?3,
             revise_err=NULL, revise_err_at=NULL, updated_at=?3
           WHERE asin=?1 AND cond=?2`).bind(x.asin, x.cond, at));
      } else {
        if (x.kind === "up") res.up++; else res.down++;
        /* 再調達中の行なので、出し直した売値（restock_price）と
           仕入値の上限（restock_max_cost）もそろえる。
           上限をそろえないと「再調達で赤字」の警告が消えない。 */
        stmts.push(env.DB.prepare(
          `UPDATE items SET ebay_price=?3, rk_fail=0, rk_done_at=?4, rk_at=?4,
             restock_price=?3,
             restock_max_cost=COALESCE(?5, restock_max_cost),
             revise_err=NULL, revise_err_at=NULL, updated_at=?4
           WHERE asin=?1 AND cond=?2`)
          .bind(x.asin, x.cond, x.to, at, numOf(x.r, "rk_max_cost")));
      }
      stmts.push(rkLogRow(env, at, x, 1,
        x.why + (x.under ? "／最低売値で止めた" : "")));
    };
    const badRow = (x, reason) => {
      if (SALE_ERR.test(reason || "")) {
        /* セール中の出品。失敗には数えず、印を立てて対象から外す（6.59 と同じ）。 */
        stmts.push(env.DB.prepare(
          `UPDATE items SET ebay_sale=1, rk_fail=0, rk_at=?3, updated_at=?3
           WHERE asin=?1 AND cond=?2`).bind(x.asin, x.cond, at));
        stmts.push(rkLogRow(env, at, x, 0, "セール中のため変えません（21919248）"));
        return;
      }
      res.failed++;
      run.errors++;
      res.fails.push(reason);                  // 理由の内訳（7.58）
      /* 一時的なエラーは連続失敗の回数に数えない（7.58）。 */
      const tmp = TEMP_ERR.test(String(reason || ""));
      if (tmp) res.temp++;
      stmts.push(env.DB.prepare(
        `UPDATE items SET rk_fail=CASE WHEN ?5=1 THEN COALESCE(rk_fail,0)
                                       ELSE COALESCE(rk_fail,0)+1 END,
           revise_err=?3, revise_err_at=?4, rk_at=?4, updated_at=?4
         WHERE asin=?1 AND cond=?2`)
        .bind(x.asin, x.cond, ("再調達中の売値 " + reason).slice(0, 300), at,
              tmp ? 1 : 0));
      stmts.push(rkLogRow(env, at, x, 0, reason));
      if (RV_SCOPE_ERR.test(reason)) scopeErr = reason;
    };
    /* 22003 が返ったら本当のベストオファー設定を取り直して1回だけやり直す（7.58）。
       直ったら成功として数える。 */
    const boBad = async (x, reason) => {
      if (x.kind !== "zero" && BO_ERR.test(String(reason || ""))) {
        const fx = await boRetry(env, run, token, x.r, x.to, null,
                                 numOf(x.r, "rk_floor"), reason);
        if (fx.stmt) stmts.push(fx.stmt);
        if (fx.fixed) {
          res.bofix++;
          okRow(x);
          stmts.push(rkLogRow(env, at, x, 1, "自動拒否額を直してやり直した（22003）"));
          return;
        }
      }
      badRow(x, reason);
    };
    const bo = list.filter((x) => x.kind !== "zero" && Number(x.r.ebay_bo || 0));
    const rest = list.filter((x) => !(x.kind !== "zero" && Number(x.r.ebay_bo || 0)));
    for (const x of bo) {
      const fx = await reviseFix(env, run, token, x.r, x.to, rkBo(x.r, x.to), null,
                                 numOf(x.r, "rk_floor"));
      if (fx.stmt) stmts.push(fx.stmt);
      if (fx.fixed) res.bofix++;
      if (fx.v.ok) okRow(x); else badRow(x, fx.v.why);
      if (scopeErr) break;
    }
    if (!scopeErr)
      for (let i = 0; i < rest.length; i += RK_BATCH) {
        const part = rest.slice(i, i + RK_BATCH);
        const v = await ebayReviseInv(env, run, token, part);
        for (const x of part) {
          if (v.ok(x.item_id)) { okRow(x); continue; }
          const bad = part.filter((y) => !v.ok(y.item_id));
          const one = v.errFor(x.item_id)
                   || ((bad.length === 1) ? { code: "", why: v.why } : null);
          await boBad(x, (one && one.why) || v.why);
          if (scopeErr) break;
        }
        if (scopeErr) break;
      }
    await runBatch(env, run, stmts);
    res.fail3 = await rkFailN(env);
    await rkPlanSet(env, Object.assign({}, planRow, { n: 0, rows: [],
      used: res.used + res.up + res.down + res.zeroed,
      ran: { up: res.up, down: res.down, zeroed: res.zeroed, failed: res.failed } }));
    run.notes.push("再調達中の売値：上げた " + res.up + "件／下げた " + res.down
      + "件／数量0 " + res.zeroed + "件／失敗 " + res.failed + "件／とばした "
      + res.skipped + "件"
      + (res.held ? ("／下げを保留 " + res.held + "件") : "")
      + (res.capped ? ("／上限で翌日に回した " + res.capped + "件") : ""));
    if (scopeErr)
      run.notes.push("権限が足りません（eBayのユーザートークンを sell.inventory の"
        + "スコープで取り直してください）：" + scopeErr);
    await rkLogRun(env, run, res, scopeErr);
    await notify(env, run, rkNotifyText(res, scopeErr));
  } catch (e) {
    run.errors++;
    run.notes.push("例外 " + e.message);
  }
  return Object.assign(await saveRun(env, run), res);
}

/* ================= 目標を Worker が自分で計算する（7.52）=================
   これまで、自動の処理が使う目標（rk_want・pb_want・rv_want・md_*）は
   **pj_price が計算して D1 に送った値**だけだった。式が index.html の中にしか
   無かったためで、1日1回アプリを開いて「状況を取り込む」を押す必要があった。

   C段（7.51）で式を shared/pricing.js に出したので、Worker も
   **D1 にある仕入値・重量・Amazon最安値と ⚙設定の値から自分で計算**できる。

   どちらを使うか
   ・pj_price が送った目標が **WANT_FRESH_MS（30分）以内**なら、そちらを使う
     （画面で押した直後の操作が Worker に上書きされないようにする）
   ・それ以外は Worker が自分で計算した値を使う
   計算した値は D1 にも書き戻す（画面と帯に同じ数字が出るように）。
   出品リスト（端末にしか無い仕入値・重量）は Worker からは見えないので、
   D1 の値（cost_yen / weight_g / sku_cost）と既定重量だけで計算する。 */
const WANT_FRESH_MS = 30 * 60 * 1000;
const SELF_WRITE_MAX = 300;          // 1回に書き戻す行数の上限

function wantFresh(at, now) {
  const t = Date.parse(String(at || ""));
  if (!t) return false;
  const d = now - t;
  return d >= -WANT_FRESH_MS && d <= WANT_FRESH_MS;
}
/* 行に目標を埋めた**写し**を返す（元の行は変えない）。
   fresh が true の項目は pj_price の値をそのまま残す。
   diff には、D1 に書き戻すべき項目だけを入れる。 */
function selfTargets(S, r, now) {
  const out = Object.assign({}, r);
  const diff = {};
  const n = (now === undefined || now === null) ? Date.now() : now;
  const set = (k, v) => {
    if (v === null || v === undefined) return;
    const was = (r[k] === null || r[k] === undefined) ? null : Number(r[k]);
    out[k] = v;
    if (typeof v === "number") {
      if (was === null || Math.abs(was - v) >= 0.01) diff[k] = v;
    } else if (String(r[k] || "") !== String(v)) diff[k] = v;
  };
  /* 再調達中の売値の追従（rk_*）。 */
  if (!wantFresh(r.rk_want_at, n)) {
    const rk = PRICING.rkWant(S, r);
    if (rk) {
      set("rk_want", rk.rk_want); set("rk_floor", rk.rk_floor);
      set("rk_low", rk.rk_low); set("rk_n", rk.rk_n);
      set("rk_max_cost", rk.rk_max_cost);
      // 自分で計算した目標は「いま受け取った」ものとして扱う
      out.rk_want_at = nowIso();
    }
  }
  /* フェイズBの再調達（pb_*）。 */
  if (!wantFresh(r.pb_want_at, n)) {
    const pb = PRICING.pbWant(S, r, n);
    if (pb.ok) {
      set("pb_want", pb.price); set("pb_max_cost", pb.max_cost);
      out.pb_want_at = nowIso();
    }
  }
  /* 売値の見直しの自動反映（rv_*）。 */
  if (!wantFresh(r.rv_at, n)) {
    const rv = PRICING.rvTarget(S, r);
    if (rv && rv.rv_kind) {
      set("rv_kind", rv.rv_kind); set("rv_want", rv.rv_want);
      set("rv_floor", rv.rv_floor); set("rv_max_cost", rv.rv_max_cost);
      out.rv_at = nowIso();
    }
  }
  /* 自動値下げ（md_*）。md_start は進んでいる回数（md_done）を0に戻してしまうので、
     **すでに入っている行では書き換えない**（値下げの途中を巻き戻さないため）。 */
  const md = PRICING.mdPlan(S, r);
  if (md) {
    set("md_floor", md.md_floor); set("md_step", md.md_step); set("md_n", md.md_n);
    if (!(Number(r.md_start) > 0)) set("md_start", md.md_start);
  }
  return { r: out, diff: diff };
}
/* 行をまとめて埋める。書き戻しは呼ぶ側の run でまとめて流す。 */
async function selfFill(env, run, rows, now) {
  const ps = await pricingSettings(env, run);
  const out = [], stmts = [];
  const at = nowIso();
  for (const r of rows) {
    const t = selfTargets(ps.S, r, now);
    out.push(t.r);
    const ks = Object.keys(t.diff);
    if (!ks.length || stmts.length >= SELF_WRITE_MAX) continue;
    /* 変わった項目だけを書く。鮮度の時刻も一緒に入れる。 */
    const sets = ks.map((k, i) => k + "=?" + (i + 4));
    if (ks.some((k) => k.indexOf("rk_") === 0)) sets.push("rk_want_at=?3");
    if (ks.some((k) => k.indexOf("pb_") === 0)) sets.push("pb_want_at=?3");
    if (ks.some((k) => k.indexOf("rv_") === 0)) sets.push("rv_at=?3");
    stmts.push(env.DB.prepare(
      `UPDATE items SET ${sets.join(", ")}, updated_at=?3 WHERE asin=?1 AND cond=?2`)
      .bind(r.asin, r.cond, at, ...ks.map((k) => t.diff[k])));
  }
  if (stmts.length) await runBatch(env, run, stmts);
  run.notes.push("目標を自分で計算：" + rows.length + "行／書き戻し " + stmts.length + "行"
    + "（広告料率 " + ps.S.adRate + "%・為替 " + ps.S.fx + "円）");
  return { rows: out, wrote: stmts.length, S: ps.S, fx: ps.fx };
}

/* 「売れた値段で保つ」印を立てるか（7.54）。判定は shared/pricing.js の
   skKeepOff に1か所だけ置いてある（在庫補充の判定 skRelist と同じものを読む）。
   無在庫は SKU のラベルからも分かるので、items にまだ行が無い初回の販売でも
   拾えるように、D1 の値と重ねて渡す（ここは値を集めるだけで、
   「何を外すか」は決めていない）。 */
function skStampOff(row, line) {
  const r = row || {};
  return PRICING.skKeepOff({
    one_off: r.one_off, one_off_known: r.one_off_known,
    dropship: Number(r.dropship || 0) || ((line && line.dropship) ? 1 : 0) });
}

/* ================= 売れた値段で在庫補充する（7.53／7.56）=================
   自動値下げで下げている途中に売れた行は、**その値段が「売れる値段」だと
   分かった**ということ。だから
   ・それ以上下げない（mdSkip）／値上げもしない（rvSkip）
   ・売れて数量0になった行は、**同じ値段のまま数量1に戻す**
   を行う。判定（条件）は shared/pricing.js の skRelist に1か所だけ置いてある
   （画面と同じ決まりで動かすため）。

   歯止めはフェイズBの再調達（7.47）と同じ:
   ・1日 SK_MAX 件まで（再調達とは**別枠**）
   ・対象は sk_act='relist' かつ数量0の行だけ（二重実行の防止）
   ・書き込みの前に GetItem で数量0を確かめ、違えば次回に回す
   ・書き込みの後に GetItem で Active を確かめる（出品が終了していないか）
   ・続けて3回失敗した行は自動処理から外す
   ・数量を増やすのは、この在庫補充と再調達のときだけ */
const SK_MODES = { confirm: 1, auto: 1 };
const SK_MAX = 30;                       // 1日に在庫補充する上限（再調達とは別枠）
const SK_BATCH = RV_BATCH;               // ReviseInventoryStatus は1回4件まで
const SK_PICK_LIMIT = 400;               // 判定で見る行数
const SK_PLAN_SHOW = 20;                 // 画面・通知に出す予定の件数
const SK_FAIL_WARN = 3;
const SK_PLAN_KEY = "sk.plan";

async function skSettings(env) {
  let st = {};
  try { st = (await settingsGet(env)).settings || {}; } catch (e) { st = {}; }
  const mode = String(st.autoSkMode || "confirm");
  return { mode: SK_MODES[mode] ? mode : "confirm" };
}
async function skUsedToday(env) {
  try {
    const r = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sk_log WHERE kind='relist' AND ok=1 AND at>=?1`)
      .bind(dayKey() + "T00:00:00Z").first();
    return Number((r && r.n) || 0);
  } catch (e) { return 0; }
}
async function skPlanGet(env) {
  try {
    const t = await stateGet(env, SK_PLAN_KEY);
    return t ? JSON.parse(t) : null;
  } catch (e) { return null; }
}
async function skPlanSet(env, o) {
  try { await stateSet(env, SK_PLAN_KEY, JSON.stringify(o)).run(); } catch (e) { /* 予定の保存で本処理を落とさない */ }
}
async function skLast(env) {
  try {
    const r = await env.DB.prepare(
      `SELECT at, mode, picked, relisted, failed, skipped, capped, ended
         FROM sk_runs ORDER BY id DESC LIMIT 1`).first();
    return r || null;
  } catch (e) { return null; }
}
function skLogRow(env, at, r, a, ok, why) {
  return env.DB.prepare(
    `INSERT INTO sk_log (at, asin, cond, item_id, kind, price, buy_low, buy_src, ok, why)
     VALUES (?1,?2,?3,?4,'relist',?5,?6,?7,?8,?9)`
  ).bind(at, r.asin, r.cond, String(r.ebay_item_id || ""),
         (a && a.price) || null,
         (a && a.buy && a.buy.low) || null,
         (a && a.hand) ? "hand" : ((a && a.buy && a.buy.src) || ""),
         ok ? 1 : 0, String(why || "").slice(0, 300));
}
async function skLogRun(env, run, res, scopeErr) {
  try {
    await env.DB.prepare(
      `INSERT INTO sk_runs (at, mode, picked, relisted, failed, skipped, capped, ended,
         note, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?1)`
    ).bind(nowIso(), res.mode, res.picked, res.relisted, res.failed, res.skipped,
           res.capped, res.ended,
           ((scopeErr ? ("権限不足 " + scopeErr + " / ") : "")
            + "1日 " + SK_MAX + "件（再調達とは別枠）").slice(0, 500)).run();
  } catch (e) { run.notes.push("sk_runs に残せません：" + e.message); }
}
async function skFailN(env) {
  try {
    const r = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM items WHERE COALESCE(sk_fail,0)>=?1`)
      .bind(SK_FAIL_WARN).first();
    return Number((r && r.n) || 0);
  } catch (e) { return 0; }
}
function skNotifyText(res) {
  const plan = (res.mode === "confirm");
  if (plan && !res.picked) return "";
  if (!plan && !res.relisted && !res.failed) return "";
  const t = [];
  if (plan) {
    t.push("🔁 在庫補充（数量を1に戻す・確認してから）：予定 " + res.picked + "件");
    t.push("販売連携タブの「在庫補充（数量を1に戻す）」を押すと実行します"
      + "（eBay はまだ変えていません）");
  } else {
    t.push("🔁 在庫補充しました（売れた値段のまま数量を1に戻した）"
      + (res.mode === "approve" ? "（まとめて実行）" : "（自動）"));
    t.push("補充 " + res.relisted + "件／失敗 " + res.failed + "件／とばした "
      + res.skipped + "件");
  }
  const wl = whyLine(res.fails);
  if (wl) t.push(wl);
  if (res.temp)
    t.push("一時的なエラー " + res.temp + "件は次回やり直します（失敗の回数に数えません）");
  if (res.capped)
    t.push("1日の上限 " + SK_MAX + "件を超えた " + res.capped + "件は翌日に回しました");
  if (res.ended)
    t.push("⚠️ " + res.ended + "件は出品が終了していました"
      + "（Out-of-stock control を確認してください）");
  if (res.fail3)
    t.push("⚠️ " + res.fail3 + "件は " + SK_FAIL_WARN + "回以上続けて失敗しています");
  res.plan.slice(0, 10).forEach((x) => {
    t.push("・" + x.name + "（" + x.asin + "）：$" + Number(x.price).toFixed(2)
      + " で数量1に戻す"
      + (x.hand ? "（手持ちの在庫）"
                : (x.buy_low ? ("（仕入 " + Math.round(x.buy_low) + "円・上限 "
                                + x.max + "円）") : "")));
  });
  return t.join("\n");
}
/* 予定を立てる。できない行は理由を sk_why に残して「対応が必要」に出す。 */
async function skPlanRows(env, run) {
  const ps = await pricingSettings(env, run);
  const q = await env.DB.prepare(
    `SELECT ${ITEM_COLS} FROM items
      WHERE sold_keep=1 AND COALESCE(ebay_qty,0)=0 AND COALESCE(ebay_item_id,'')<>''
      ORDER BY COALESCE(sk_at,'') ASC LIMIT ${SK_PICK_LIMIT}`).all();
  const rows = (q && q.results) || [];
  const at = nowIso();
  const due = [], stmts = [];
  let skipped = 0;
  for (const r of rows) {
    const a = PRICING.skRelist(ps.S, r);
    if (a.act !== "relist") {
      skipped++;
      /* 理由が変わったときだけ書く（毎回同じ値を書かない）。 */
      if (String(r.sk_why || "") !== a.why || String(r.sk_act || "") === "relist")
        stmts.push(env.DB.prepare(
          `UPDATE items SET sk_act=NULL, sk_why=?3, sk_at=?4, updated_at=?4
           WHERE asin=?1 AND cond=?2`).bind(r.asin, r.cond, a.why, at));
      continue;
    }
    due.push(Object.assign({ r: r, asin: r.asin, cond: r.cond,
      item_id: String(r.ebay_item_id || ""),
      name: r.title || r.ebay_sku || r.asin }, a));
    if (String(r.sk_act || "") !== "relist" || String(r.sk_why || "") !== a.why)
      stmts.push(env.DB.prepare(
        `UPDATE items SET sk_act='relist', sk_why=?3, sk_at=?4, updated_at=?4
         WHERE asin=?1 AND cond=?2`).bind(r.asin, r.cond, a.why, at));
  }
  if (stmts.length) await runBatch(env, run, stmts);
  return { due: due, skipped: skipped, total: rows.length, S: ps.S };
}
/* 在庫補充（数量を1に戻す）。approve＝true のときは「確認してから」でも実行する。 */
async function jobSoldKeep(env, opt) {
  const approve = !!(opt && opt.approve);
  const run = newRun("soldkeep");
  const res = { temp: 0, fails: [],
                mode: "confirm", picked: 0, relisted: 0, failed: 0, skipped: 0,
                capped: 0, ended: 0, used: 0, max: SK_MAX, fail3: 0, plan: [] };
  try {
    const st = await skSettings(env);
    res.mode = approve ? "approve" : st.mode;
    const pick = await skPlanRows(env, run);
    res.picked = pick.due.length;
    res.skipped = pick.skipped;
    res.used = await skUsedToday(env);
    const left = Math.max(0, SK_MAX - res.used);
    const list = pick.due.slice(0, left);
    res.capped = pick.due.length - list.length;
    res.plan = list.slice(0, SK_PLAN_SHOW).map((x) => ({
      asin: x.asin, cond: x.cond, item_id: x.item_id, name: x.name,
      price: x.price, hand: !!x.hand, max: x.max || 0,
      buy_low: (x.buy && x.buy.low) || 0, buy_src: x.hand ? "hand"
        : ((x.buy && x.buy.src) || ""), why: x.why }));
    res.fail3 = await skFailN(env);
    const planRow = { at: nowIso(), mode: res.mode, n: pick.due.length,
      capped: res.capped, skipped: res.skipped, used: res.used, max: SK_MAX,
      rows: res.plan };
    // 「確認してから」のときは eBay を1回も呼ばない
    if (!approve && st.mode === "confirm") {
      await skPlanSet(env, planRow);
      run.notes.push("確認してから：" + res.picked + "件が在庫補充の候補／とばした "
        + res.skipped + "件。eBay は変えていません");
      await skLogRun(env, run, res, "");
      await notify(env, run, skNotifyText(res));
      return Object.assign(await saveRun(env, run), res);
    }
    if (!list.length) {
      run.notes.push("在庫を補充する出品はありません（とばした " + res.skipped + "件"
        + (res.capped ? ("／上限で翌日に回した " + res.capped + "件") : "") + "）");
      await skPlanSet(env, Object.assign({}, planRow, { n: 0, rows: [] }));
      await skLogRun(env, run, res, "");
      return Object.assign(await saveRun(env, run), res);
    }
    const token = await ebayToken(env, run);
    const at = nowIso();
    const stmts = [];
    let scopeErr = "";
    for (const x of list) {
      /* ① 書き込みの前に、本当に数量0かを確かめる（二重に戻さない）。 */
      const cur = await pbGetItem(env, run, token, x.item_id);
      if (!cur.ok || Number(cur.qty || 0) !== 0) {
        stmts.push(env.DB.prepare(
          `UPDATE items SET sk_why=?3, sk_at=?4, updated_at=?4
           WHERE asin=?1 AND cond=?2`)
          .bind(x.asin, x.cond,
            cur.ok ? "eBay の数量が0ではありません（次回に判定し直します）"
                   : ("いまの出品を確かめられません：" + cur.why), at));
        continue;
      }
      /* ② 数量だけ1に戻す（売値は送らない＝売れた値段のまま）。
         ベストオファーのある出品も、売値を変えないので金額の整合は崩れない。 */
      const v = await ebayReviseInv(env, run, token,
        [{ item_id: x.item_id, kind: "relist", qty: 1 }]);
      const ok = v.ok(x.item_id);
      if (!ok) {
        const one = v.errFor(x.item_id);
        const why = (one && one.why) || v.why;
        if (SALE_ERR.test(why || "")) {
          /* セール中の出品。失敗には数えず、印を立てて対象から外す（6.59 と同じ）。 */
          stmts.push(env.DB.prepare(
            `UPDATE items SET ebay_sale=1, sk_fail=0, sk_act=NULL,
               sk_why='eBayのセール中のため在庫を補充しません', sk_at=?3, updated_at=?3
             WHERE asin=?1 AND cond=?2`).bind(x.asin, x.cond, at));
          stmts.push(skLogRow(env, at, x.r, x, 0, "セール中（21919248）"));
          continue;
        }
        res.failed++; run.errors++;
        res.fails.push(why);                   // 理由の内訳（7.58）
        /* 一時的なエラーは連続失敗の回数に数えない（7.58）。 */
        const tmp = TEMP_ERR.test(String(why || ""));
        if (tmp) res.temp++;
        stmts.push(env.DB.prepare(
          `UPDATE items SET sk_fail=CASE WHEN ?6=1 THEN COALESCE(sk_fail,0)
                                         ELSE COALESCE(sk_fail,0)+1 END,
             sk_why=?3, sk_at=?4,
             revise_err=?5, revise_err_at=?4, updated_at=?4
           WHERE asin=?1 AND cond=?2`)
          .bind(x.asin, x.cond, ("在庫を補充できません：" + why).slice(0, 300), at,
                ("在庫補充（数量を1に戻す） " + why).slice(0, 300), tmp ? 1 : 0));
        stmts.push(skLogRow(env, at, x.r, x, 0, why));
        if (RV_SCOPE_ERR.test(why)) { scopeErr = why; break; }
        continue;
      }
      /* ③ 書き込みの後に、出品が Active のままかを確かめる。 */
      res.relisted++;
      const after = await pbGetItem(env, run, token, x.item_id);
      let note = "";
      if (after.ok && !/^Active$/i.test(String(after.status || ""))) {
        res.ended++;
        note = "出品が終了していました（Out-of-stock control を確認してください）";
      }
      stmts.push(env.DB.prepare(
        `UPDATE items SET ebay_qty=1, sk_act=NULL, sk_why=?3, sk_done_at=?4,
           sk_fail=0, revise_err=NULL, revise_err_at=NULL, updated_at=?4
         WHERE asin=?1 AND cond=?2`)
        .bind(x.asin, x.cond, note || ("売れた値段 $" + x.price.toFixed(2)
          + " のまま数量を1に戻しました"), at));
      stmts.push(skLogRow(env, at, x.r, x, 1, note || x.why));
    }
    await runBatch(env, run, stmts);
    res.fail3 = await skFailN(env);
    await skPlanSet(env, Object.assign({}, planRow, { n: 0, rows: [],
      used: res.used + res.relisted,
      ran: { relisted: res.relisted, failed: res.failed, ended: res.ended } }));
    run.notes.push("在庫補充：" + res.relisted + "件／失敗 " + res.failed
      + "件／とばした " + res.skipped + "件"
      + (res.ended ? ("／出品が終了していた " + res.ended + "件") : "")
      + (res.capped ? ("／上限で翌日に回した " + res.capped + "件") : ""));
    if (scopeErr)
      run.notes.push("権限が足りません（eBayのユーザートークンを取り直してください）："
        + scopeErr);
    await skLogRun(env, run, res, scopeErr);
    await notify(env, run, skNotifyText(res));
  } catch (e) {
    run.errors++;
    run.notes.push("例外 " + e.message);
  }
  return Object.assign(await saveRun(env, run), res);
}

/* ================= フェイズB：FBAで売れたら eBay を直す（7.47）=================
   FBAで売れて販売可能が0になった出品が、eBayで数量1のまま残ると売り越しになる。
   **まず全部を数量0にして**売り越しを止め、「在庫0時の動作」が再調達の行だけ
   そのあと「売値を変えて数量を1に戻す」。承認待ちのあいだ古い売値で売れないようにする。

   ・数量を増やすのは、この再調達の実行と「在庫補充（数量を1に戻す）」（7.53）のときだけ
     （ほかの処理では増やさない）
   ・再調達の売値（pb_want）は pj_price が計算して送る（Worker は値付けの式を持たない）
   ・書き込みの前に GetItem で今の数量・売値を確かめ、判定時と違えば実行しない
   ・数量0の直後にも GetItem で ListingStatus を見て、Active のままかを確かめる
     （Out-of-stock control が効いていないと出品が終了してしまうため） */
const PB_MODES = { off: 1, plan: 1, on: 1 };
const PB_RESTOCK_MODES = { confirm: 1, auto: 1 };
const PB_ZERO_MAX = 20;                      // 1回に数量0にする上限
const PB_RESTOCK_MAX = 30;                   // 1日に再調達する上限
const PB_FAIL_WARN = 3;                      // 続けて失敗したら自動処理から外す
const PB_WANT_MS = 24 * 60 * 60 * 1000;      // 再調達の売値の鮮度／内訳不明の猶予
const PB_PICK_LIMIT = 400;                   // 判定で見る行数
const PB_BATCH = 4;                          // ReviseInventoryStatus は4件ずつ
const PB_OK_NOTIFY_MS = 55 * 60 * 1000;      // 成功の通知は1時間に1回まで
const PB_PLAN_SHOW = 20;                     // 画面・通知に出す予定の件数

async function pbSettings(env) {
  let st = {};
  try { st = (await settingsGet(env)).settings || {}; } catch (e) { st = {}; }
  const mode = String(st.pbMode || "plan");
  const rs = String(st.pbRestock || "confirm");
  return { mode: PB_MODES[mode] ? mode : "plan",
           restock: PB_RESTOCK_MODES[rs] ? rs : "confirm" };
}
/* 対象にするか（2章）。
   act='zero'    … 数量0にするだけ（寝かせる／終了／一点物／未設定）
   act='restock' … 数量0にしたうえで再調達の予定に載せる
   act='unknown' … 予約済みの内訳が分からない（24時間たったら知らせる）
   act=''        … 対象外（why に理由） */
function pbTarget(r) {
  const no = (why) => ({ act: "", why: why });
  if (!String(r.ebay_item_id || "").trim()) return no("出品していません");
  if (Number(r.ebay_qty || 0) < 1) return no("すでに数量0");
  if (Number(r.pb_skip || 0)) return no("今回は動かさない");
  if (Number(r.pb_fail || 0) >= PB_FAIL_WARN) return no("続けて失敗（対応が必要）");
  if (Number(r.on_hand || 0)) return no("手元在庫あり");
  if (isCart(r)) return no("手元から発送（-C／-L）");
  if (isDropship(r)) return no("無在庫");
  if (isRestocking(r)) return no("再調達中");
  if (Number(r.ebay_sale || 0)) return no("eBayのセール中");
  if (r.fba_seen_at == null) return no("FBAの記録がありません");
  if (Number(r.fba_available || 0) > 0) return no("FBA在庫あり");
  if (Number(r.fba_inbound || 0) > 0) return no("納品待ち");
  const rv = Number(r.fba_reserved || 0);
  if (rv > 0) {
    if (isFcProcessing(r)) return no("FBA受領処理中・FC移管中");
    if (!resSold(r)) return { act: "unknown", why: "予約済み（内訳不明）" };
  }
  /* ここまで来たら「FBAで売れた」。まず数量0にする。 */
  const wantRestock = String(r.mode || "") === "restock";
  const oneOff = !!Number(r.one_off || 0);
  const known = !!Number(r.one_off_known || 0);
  if (wantRestock && !oneOff && known)
    return { act: "restock", why: "再調達の予定" };
  if (wantRestock && (oneOff || !known))
    return { act: "zero", why: oneOff ? "一点物なので寝かせる"
                                      : "一点物かどうかが未確定なので寝かせる" };
  return { act: "zero", why: (String(r.mode || "") === "end") ? "終了の指定（数量0）"
                                                             : "寝かせる" };
}
/* 再調達を実行できるか。できないときは理由を返す（数量0のまま）。 */
function pbRestockWhy(r) {
  const want = Number(r.pb_want || 0);
  if (!(want > 0)) return "目標の売値が届いていません（pj_price で取り込み直してください）";
  const t = Date.parse(String(r.pb_want_at || ""));
  if (!t || (Date.now() - t) > PB_WANT_MS) return "目標の売値が古いです（24時間以上前）";
  if (Number(r.amazon_offers || 0) < 2) return "最安グループが2人未満";
  if (restockLowest(r) <= 0) return "Amazonに出品がありません";
  const max = Number(r.pb_max_cost || r.restock_max_cost || 0);
  if (max > 0 && restockLowest(r) > max) return "いまの最安値では下限利益を割ります";
  return "";
}
/* 軽い GetItem（数量・売値・出品の状態だけ）。書き込みの前後の確かめに使う。 */
async function pbGetItem(env, run, token, itemId) {
  const body = '<?xml version="1.0" encoding="utf-8"?>'
    + '<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">'
    + "<ItemID>" + esc(itemId) + "</ItemID>"
    + "<DetailLevel>ReturnAll</DetailLevel>"
    + "<IncludeItemSpecifics>false</IncludeItemSpecifics>"
    + "</GetItemRequest>";
  const resp = await net(run, EBAY_API + "/ws/api.dll", {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "GetItem",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": token,
      "content-type": "text/xml",
    },
    body: body,
  });
  const xml = await resp.text();
  const ack = xmlTag(xml, "Ack");
  if (!resp.ok || /^Failure$/i.test(ack)) {
    return { ok: false,
      why: [xmlTag(xml, "ErrorCode"), xmlTag(xml, "ShortMessage")]
             .filter(Boolean).join(" / ").slice(0, 200) || ("HTTP " + resp.status) };
  }
  const ss = xmlTag(xml, "SellingStatus");
  const qty = Number(xmlTag(xml, "Quantity") || 0);
  const sold = Number(xmlTag(ss, "QuantitySold") || 0);
  return { ok: true,
           status: xmlTag(ss, "ListingStatus"),
           qty: Math.max(0, qty - sold),
           price: Number(xmlTag(ss, "CurrentPrice") || 0) };
}
/* 1行ぶんの記録。 */
function pbLogRow(env, at, r, kind, ok, why, o) {
  return env.DB.prepare(
    `INSERT INTO pb_log (at, asin, cond, item_id, kind, from_qty, to_qty,
       from_price, to_price, ok, why) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`
  ).bind(at, r.asin, r.cond, String(r.ebay_item_id || ""), kind,
         (o && o.fromQty !== undefined) ? o.fromQty : null,
         (o && o.toQty !== undefined) ? o.toQty : null,
         (o && o.fromPrice !== undefined) ? o.fromPrice : null,
         (o && o.toPrice !== undefined) ? o.toPrice : null,
         ok ? 1 : 0, String(why || "").slice(0, 300));
}
async function pbLogRun(env, run, st, res) {
  try {
    await env.DB.prepare(
      `INSERT INTO pb_runs (at, mode, picked, zeroed, restocked, failed, skipped,
         capped, note, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?1)`
    ).bind(nowIso(), res.mode, res.picked, res.zeroed, res.restocked, res.failed,
           res.skipped, res.capped,
           ("再調達の実行方法 " + st.restock + "／数量0は1回 " + PB_ZERO_MAX
            + "件・再調達は1日 " + PB_RESTOCK_MAX + "件").slice(0, 500)).run();
  } catch (e) { run.notes.push("pb_runs に残せません：" + e.message); }
}
/* 直近の結果（画面に出す）。 */
async function pbLast(env) {
  try {
    const r = await env.DB.prepare(
      `SELECT at, mode, picked, zeroed, restocked, failed, skipped, capped
         FROM pb_runs ORDER BY at DESC LIMIT 1`).first();
    return r || null;
  } catch (e) { return null; }
}
/* 今日すでに再調達した件数（1日の上限に使う）。 */
async function pbUsedToday(env) {
  try {
    const r = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM pb_log
        WHERE kind='restock' AND ok=1 AND at>=?1`).bind(dayKey() + "T00:00:00Z").first();
    return Number((r && r.n) || 0);
  } catch (e) { return 0; }
}
/* 予定の一覧（画面に出す）。数量0と再調達を分けて返す。 */
async function pbPlan(env) {
  try {
    const q = await env.DB.prepare(
      `SELECT asin, cond, title, ebay_item_id, ebay_qty, ebay_price, pb_act, pb_why,
              pb_at, pb_want, pb_fail
         FROM items WHERE COALESCE(pb_act,'')<>'' ORDER BY COALESCE(pb_at,'') DESC
         LIMIT ${PB_PLAN_SHOW * 3}`).all();
    const rows = (q && q.results) || [];
    return {
      zero: rows.filter((x) => x.pb_act === "zero").length,
      restock: rows.filter((x) => x.pb_act === "restock").length,
      unknown: rows.filter((x) => x.pb_act === "unknown").length,
      rows: rows.slice(0, PB_PLAN_SHOW),
    };
  } catch (e) { return null; }
}
function pbNotifyText(res, st) {
  const t = [];
  if (res.mode === "plan") {
    if (!res.picked && !res.unknown_old) return "";
    t.push("📦 FBAで売れた（予定だけ表示）：数量0にする予定 " + res.zero_plan
      + "件／再調達の予定 " + res.restock_plan + "件");
    t.push("eBay はまだ変えていません。⚙設定の「FBAで売れたときの動作」をオンにすると実行します");
  } else {
    if (!res.zeroed && !res.restocked && !res.failed && !res.unknown_old) return "";
    t.push("📦 FBAで売れた：数量0 " + res.zeroed + "件／再調達 " + res.restocked
      + "件／失敗 " + res.failed + "件"
      + (res.capped ? ("／上限で次回に回した " + res.capped + "件") : ""));
  }
  if (res.bofix)
    t.push("ベストオファーの自動拒否額を直してやり直した " + res.bofix + "件（22003）");
  const wl = whyLine(res.fails);
  if (wl) t.push(wl);
  if (res.temp)
    t.push("一時的なエラー " + res.temp + "件は次回やり直します（失敗の回数に数えません）");
  if (res.ended) t.push("⚠️ " + res.ended + "件は出品が終了しました（Out-of-stock control を確認してください）");
  if (res.unknown_old)
    t.push("⚠️ " + res.unknown_old + "件は予約済みの内訳が24時間以上分かりません（対応が必要）");
  res.plan.slice(0, 10).forEach((x) => {
    t.push("・" + x.title + "：" + x.text);
  });
  return t.join("\n");
}
/* 成功の通知は1時間に1回まで（失敗はそのつど）。 */
async function pbNotify(env, run, res, st, text) {
  if (!text) return;
  if (res.failed || res.unknown_old) { await notify(env, run, text); return; }
  try {
    const last = await stateGet(env, "pb.okat");
    const t = Date.parse(String(last || ""));
    if (t && (Date.now() - t) < PB_OK_NOTIFY_MS) return;
    await notify(env, run, text);
    await stateSet(env, "pb.okat", nowIso()).run();
  } catch (e) { await notify(env, run, text); }
}
/* フェイズBの本体。opt.approve で「再調達をまとめて実行」。 */
async function jobPhaseB(env, opt) {
  const approve = !!(opt && opt.approve);
  const run = newRun("phaseb");
  const res = { bofix: 0, temp: 0, fails: [],
                mode: "off", restock_mode: "confirm", picked: 0, zero_plan: 0,
                restock_plan: 0, zeroed: 0, restocked: 0, failed: 0, skipped: 0,
                capped: 0, unknown: 0, unknown_old: 0, ended: 0, used: 0,
                plan: [] };
  try {
    const st = await pbSettings(env);
    res.mode = st.mode;
    res.restock_mode = st.restock;
    if (st.mode === "off") {
      run.notes.push("フェイズBはオフ（⚙設定「FBAで売れたときの動作」）");
      return Object.assign(await saveRun(env, run), res);
    }
    const at = nowIso();
    const q = await env.DB.prepare(
      `SELECT ${ITEM_COLS} FROM items
        WHERE scope='ebay' AND COALESCE(ebay_item_id,'')<>'' AND COALESCE(ebay_qty,0)>=1
        ORDER BY COALESCE(pb_at,'') ASC LIMIT ${PB_PICK_LIMIT}`).all();
    /* 再調達の売値（pb_want）を自分で計算して埋める（7.52）。
       pj_price が30分以内に送った値はそのまま使う。 */
    const selfP = await selfFill(env, run, (q && q.results) || []);
    const rows = selfP.rows;
    const due = [], stmts = [];
    for (const r of rows) {
      const t = pbTarget(r);
      if (t.act === "unknown") {
        res.unknown++;
        /* 内訳が分からない行。いつから分からないかを残し、24時間たったら知らせる。 */
        const since = Date.parse(String(r.pb_at || "")) || 0;
        if (r.pb_act !== "unknown" || !since)
          stmts.push(env.DB.prepare(
            `UPDATE items SET pb_act='unknown', pb_why=?3, pb_at=?4, updated_at=?4
              WHERE asin=?1 AND cond=?2`).bind(r.asin, r.cond, t.why, at));
        else if ((Date.now() - since) > PB_WANT_MS) {
          res.unknown_old++;
          res.plan.push({ title: r.title || r.asin,
            text: "予約済みの内訳が24時間以上分かりません（対応が必要）" });
        }
        continue;
      }
      if (!t.act) {
        res.skipped++;
        /* 対象でなくなった行の予定は消す（内訳が分かった・在庫が戻ったなど）。 */
        if (String(r.pb_act || "") && r.pb_act !== "restock")
          stmts.push(env.DB.prepare(
            `UPDATE items SET pb_act=NULL, pb_why=?3, updated_at=?4
              WHERE asin=?1 AND cond=?2`).bind(r.asin, r.cond, t.why, at));
        continue;
      }
      due.push({ r, act: t.act, why: t.why });
    }
    res.picked = due.length;
    const list = due.slice(0, PB_ZERO_MAX);
    res.capped = due.length - list.length;
    res.zero_plan = list.filter((x) => x.act === "zero").length;
    res.restock_plan = list.filter((x) => x.act === "restock").length;
    /* 予定を残す（画面と通知に出す）。 */
    for (const x of list) {
      stmts.push(env.DB.prepare(
        `UPDATE items SET pb_act=?3, pb_why=?4, pb_at=?5, updated_at=?5
          WHERE asin=?1 AND cond=?2`).bind(x.r.asin, x.r.cond, x.act, x.why, at));
      if (res.plan.length < PB_PLAN_SHOW)
        res.plan.push({ title: x.r.title || x.r.asin,
          text: (x.act === "restock")
            ? ("数量0にして再調達の予定（" + x.why + "）")
            : ("数量を0にします（" + x.why + "）") });
    }
    await runBatch(env, run, stmts);
    if (st.mode === "plan") {
      run.notes.push("フェイズB（予定だけ表示）：数量0の予定 " + res.zero_plan
        + "件／再調達の予定 " + res.restock_plan + "件／とばした " + res.skipped + "件"
        + (res.capped ? ("／上限で次回に回した " + res.capped + "件") : ""));
      await pbLogRun(env, run, st, res);
      await pbNotify(env, run, res, st, pbNotifyText(res, st));
      return Object.assign(await saveRun(env, run), res);
    }
    /* ---- ここから実行（数量0）---- */
    const token = await ebayToken(env, run);
    const go = [], done = [];
    for (const x of list) {
      const cur = await pbGetItem(env, run, token, x.r.ebay_item_id);
      if (!cur.ok) {
        res.failed++; run.errors++;
        done.push(pbFailStmt(env, x.r, at, "いまの出品を確かめられません：" + cur.why));
        continue;
      }
      /* 判定したときと数量・売値が違う行は触らない（二重処理と上書きを防ぐ）。 */
      if (cur.qty !== Number(x.r.ebay_qty || 0)
          || Math.abs(cur.price - Number(x.r.ebay_price || 0)) > 0.005) {
        res.skipped++;
        done.push(env.DB.prepare(
          `UPDATE items SET pb_why='eBay の数量か売値が変わっています（次回に判定し直します）',
             updated_at=?3 WHERE asin=?1 AND cond=?2`).bind(x.r.asin, x.r.cond, at));
        continue;
      }
      go.push(Object.assign({}, x, { item_id: String(x.r.ebay_item_id), kind: "zero" }));
    }
    for (let i = 0; i < go.length; i += PB_BATCH) {
      const part = go.slice(i, i + PB_BATCH);
      const v = await ebayReviseInv(env, run, token, part);
      for (const x of part) {
        if (!v.ok(x.item_id)) {
          const e = v.errFor(x.item_id);
          const why = (e && e.why) || v.why;
          res.failed++; run.errors++;
          done.push(pbFailStmt(env, x.r, at, "数量0にできません：" + why));
          done.push(pbLogRow(env, at, x.r, "zero", 0, why,
            { fromQty: Number(x.r.ebay_qty || 0), toQty: 0 }));
          continue;
        }
        res.zeroed++;
        /* 数量0の直後に、出品が残っているか（Out-of-stock control）を確かめる。 */
        const after = await pbGetItem(env, run, token, x.item_id);
        let note = "";
        if (after.ok && !/^Active$/i.test(String(after.status || ""))) {
          res.ended++;
          note = "出品が終了しました（Out-of-stock control を確認してください）";
          res.plan.push({ title: x.r.title || x.r.asin, text: note });
        }
        done.push(env.DB.prepare(
          `UPDATE items SET ebay_qty=0, pb_act=?3, pb_why=?4, pb_done_at=?5, pb_fail=0,
             updated_at=?5 WHERE asin=?1 AND cond=?2`)
          .bind(x.r.asin, x.r.cond, (x.act === "restock") ? "restock" : null,
                note || x.why, at));
        done.push(pbLogRow(env, at, x.r, "zero", 1, note || x.why,
          { fromQty: Number(x.r.ebay_qty || 0), toQty: 0 }));
      }
    }
    await runBatch(env, run, done);
    /* ---- 再調達（承認か自動のときだけ）---- */
    if (st.restock === "auto" || approve) {
      res.used = await pbUsedToday(env);
      const left = Math.max(0, PB_RESTOCK_MAX - res.used);
      if (left > 0) {
        const q2 = await env.DB.prepare(
          `SELECT ${ITEM_COLS} FROM items
            WHERE pb_act='restock' AND COALESCE(ebay_qty,0)=0
              AND COALESCE(pb_skip,0)=0 AND COALESCE(pb_fail,0)<${PB_FAIL_WARN}
            ORDER BY COALESCE(pb_at,'') ASC LIMIT ${left}`).all();
        const rs = (q2 && q2.results) || [];
        const st2 = [];
        for (const r of rs) {
          const why = pbRestockWhy(r);
          if (why) {
            st2.push(env.DB.prepare(
              `UPDATE items SET pb_why=?3, updated_at=?4 WHERE asin=?1 AND cond=?2`)
              .bind(r.asin, r.cond, "再調達しません：" + why, at));
            res.plan.push({ title: r.title || r.asin,
              text: "再調達しません（" + why + "）→ 数量0のままです" });
            continue;
          }
          const want = Math.round(Number(r.pb_want || 0) * 100) / 100;
          const cur = await pbGetItem(env, run, token, r.ebay_item_id);
          if (!cur.ok || cur.qty !== 0) {
            res.skipped++;
            st2.push(env.DB.prepare(
              `UPDATE items SET pb_why=?3, updated_at=?4 WHERE asin=?1 AND cond=?2`)
              .bind(r.asin, r.cond,
                cur.ok ? "eBay の数量が0ではありません（次回に判定し直します）"
                       : ("いまの出品を確かめられません：" + cur.why), at));
            continue;
          }
          /* 自動拒否額を使っている出品は ReviseFixedPriceItem（価格＋数量＋ベストオファー）。
             それ以外は ReviseInventoryStatus で価格と数量を1回で送る。 */
          let ok = false, bad = "";
          if (Number(r.ebay_bo || 0)) {
            const fx = await reviseFix(env, run, token, r, want, mdBo(r, want), 1,
                                       numOf(r, "md_floor"));
            if (fx.stmt) st2.push(fx.stmt);
            if (fx.fixed) res.bofix++;
            ok = fx.v.ok; bad = fx.v.why;
          } else {
            const v2 = await ebayReviseInv(env, run, token,
              [{ item_id: String(r.ebay_item_id), kind: "restock", to: want, qty: 1 }]);
            ok = v2.ok(String(r.ebay_item_id));
            bad = ok ? "" : ((v2.errFor(String(r.ebay_item_id)) || {}).why || v2.why);
            /* ReviseInventoryStatus はベストオファーを送れない。22003 が返ったら
               本当の設定を取り直して ReviseFixedPriceItem でやり直す（7.58）。 */
            if (!ok && BO_ERR.test(String(bad || ""))) {
              const fx = await boRetry(env, run, token, r, want, 1,
                                       numOf(r, "md_floor"), bad);
              if (fx.stmt) st2.push(fx.stmt);
              if (fx.fixed) { res.bofix++; ok = true; bad = ""; }
            }
          }
          if (!ok) {
            res.failed++; run.errors++;
            res.fails.push(bad);               // 理由の内訳（7.58）
            if (TEMP_ERR.test(String(bad || ""))) res.temp++;
            st2.push(pbFailStmt(env, r, at, "再調達にできません：" + bad));
            st2.push(pbLogRow(env, at, r, "restock", 0, bad,
              { fromQty: 0, toQty: 1, fromPrice: Number(r.ebay_price || 0), toPrice: want }));
            continue;
          }
          res.restocked++;
          st2.push(env.DB.prepare(
            `UPDATE items SET ebay_qty=1, ebay_price=?3, restocking=1, restock_at=?4,
               restock_price=?3, restock_max_cost=COALESCE(?5, restock_max_cost),
               pb_act=NULL, pb_why='再調達にしました', pb_done_at=?4, pb_fail=0,
               updated_at=?4 WHERE asin=?1 AND cond=?2`)
            .bind(r.asin, r.cond, want, at, numOf(r, "pb_max_cost")));
          st2.push(pbLogRow(env, at, r, "restock", 1, "",
            { fromQty: 0, toQty: 1, fromPrice: Number(r.ebay_price || 0), toPrice: want }));
          res.plan.push({ title: r.title || r.asin,
            text: "再調達にしました（$" + Number(r.ebay_price || 0).toFixed(2)
              + " → $" + want.toFixed(2) + "・数量1）" });
        }
        await runBatch(env, run, st2);
      }
    }
    run.notes.push("フェイズB：数量0 " + res.zeroed + "件／再調達 " + res.restocked
      + "件／失敗 " + res.failed + "件／とばした " + res.skipped + "件"
      + (res.capped ? ("／上限で次回に回した " + res.capped + "件") : "")
      + (res.ended ? ("／出品が終了した " + res.ended + "件") : ""));
    await pbLogRun(env, run, st, res);
    await pbNotify(env, run, res, st, pbNotifyText(res, st));
  } catch (e) {
    run.errors++;
    run.notes.push("例外 " + e.message);
  }
  return Object.assign(await saveRun(env, run), res);
}
/* 失敗を残す（3回続けたら自動処理から外す）。 */
function pbFailStmt(env, r, at, why) {
  /* System error などの一時的なエラーは、3回で自動処理から外す
     「連続失敗の回数」には数えない（人が直すものではない・7.58）。 */
  const tmp = TEMP_ERR.test(String(why || "")) ? 1 : 0;
  return env.DB.prepare(
    `UPDATE items SET pb_fail=CASE WHEN ?5=1 THEN COALESCE(pb_fail,0)
                                   ELSE COALESCE(pb_fail,0)+1 END,
       pb_why=?3, revise_err=?3,
       revise_err_at=?4, updated_at=?4 WHERE asin=?1 AND cond=?2`)
    .bind(r.asin, r.cond, String(why || "").slice(0, 300), at, tmp);
}

/* ================= 写真の預け先（7.41 / 7.42・管理者だけ）=================
   「アプリで価格を直すとメイン画像だけエラーになる」への対応。

   GET  /ebay/item?id=<ItemID>   … GetItem の PictureDetails を見る（読み取り）
   POST /eps/test {url}          … 写真1枚を eBay に預けてみる（Media API）
   POST /ebay/pics/switch {…}    … 出品の写真を eBay 保管（EPS）だけにする

   調べて分かったこと（7.42）：
   ・GetItem では 3枚とも i.ebayimg.com になっているのに PictureSource=Vendor で、
     ExternalPictureURL に **1枚目（ギャラリー画像）の自前URLだけ**が残っていた。
     これが「メインだけ Revise で失敗する」理由。公式リファレンスどおりの状態。
   ・ExternalPictureURL は DeletedField では消せない（出品時に入れた項目は消せない）。
     **写真一式を EPS の URL で入れ替える**しか道がない。
   ・UploadSiteHostedPictures（Trading）は 2026-09-30 廃止。預け先は
     **Media API の createImageFromUrl**（REST・Bearer・期限30日）。 */
const MEDIA_API = "https://apim.ebay.com/commerce/media/v1_beta";
/* まとめて切り替えるときの1回の上限（7.46 で 10件にした）。
   1件で 写真の枚数×2＋3 回ほど外部を呼ぶので、1リクエストが長くなりすぎない範囲。
   画面側はこの数ずつに小分けして送る。 */
const PICS_MAX = 10;
/* 画像の縦横をバイト列から読む（JPEG の SOF と PNG の IHDR だけ見る）。
   R2 の写真が eBay の下限（長辺500px）を満たしているかをここで確かめる。 */
function imageSize(buf) {
  const b = new Uint8Array(buf);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(buf);
    return { type: "png", w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      // SOF0〜SOF15（DHT/DAC/RST は除く）に縦横が入っている
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { type: "jpeg", h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      if (len <= 0) break;
      i += 2 + len;
    }
    return { type: "jpeg", w: 0, h: 0 };
  }
  return { type: "unknown", w: 0, h: 0 };
}
/* 写真をそのまま取ってみる（状態・形式・縦横）。
   pj-img（R2）の写真は **サービスバインディング（IMG_SVC）** で見る。
   同じアカウントの workers.dev へ普通の fetch をすると Cloudflare が
   「error code: 1042」を返して 404 に見えるため（7.42 で判明）。 */
async function probeUrl(run, url, env) {
  const t0 = Date.now();
  const svc = (env && env.IMG_SVC && /\/i\/\d{8}\//.test(url)) ? env.IMG_SVC : null;
  const resp = await net(run, url, { method: "GET", redirect: "manual", fetcher: svc });
  const h = {};
  ["content-type", "content-length", "cache-control", "etag", "location",
   "cf-cache-status", "access-control-allow-origin"].forEach((k) => {
    const v = resp.headers.get(k); if (v) h[k] = v;
  });
  let size = { type: "", w: 0, h: 0 }, bytes = 0;
  if (resp.ok) {
    const buf = await resp.arrayBuffer();
    bytes = buf.byteLength;
    size = imageSize(buf);
  }
  return { url: url, status: resp.status, redirected: !!h.location,
           via: svc ? "service_binding" : "fetch",
           headers: h, bytes: bytes, width: size.w, height: size.h,
           kind: size.type, long: Math.max(size.w, size.h),
           ok_for_ebay: Math.max(size.w, size.h) >= 500, ms: Date.now() - t0 };
}
/* GetItem（読み取り）。PictureDetails を1枚目とそれ以降が比べられる形にする。
   切り替えの前後で2回呼ぶので、run を使い回せるように分けてある。 */
async function getItemPics(env, run, token, itemId) {
  const out = { ok: false, item_id: itemId };
  const body = '<?xml version="1.0" encoding="utf-8"?>'
    + '<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">'
    + "<ItemID>" + esc(itemId) + "</ItemID>"
    + "<DetailLevel>ReturnAll</DetailLevel>"
    + "<IncludeItemSpecifics>false</IncludeItemSpecifics>"
    + "</GetItemRequest>";
  const resp = await net(run, EBAY_API + "/ws/api.dll", {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "GetItem",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": token,
      "content-type": "text/xml",
    },
    body: body,
  });
  const xml = await resp.text();
  const ack = xmlTag(xml, "Ack");
  out.ack = ack || ("HTTP" + resp.status);
  if (!resp.ok || /^Failure$/i.test(ack)) {
    out.error = [xmlTag(xml, "ErrorCode"), xmlTag(xml, "ShortMessage"),
                 xmlTag(xml, "LongMessage")].filter(Boolean).join(" / ").slice(0, 300);
    return out;
  }
  const pd = xmlTag(xml, "PictureDetails");
  const all = (tag, src) => {
    const re = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "g");
    const a = []; let m;
    while ((m = re.exec(src || ""))) a.push(m[1]);
    return a;
  };
  out.ok = true;
  out.title = xmlTag(xml, "Title").slice(0, 120);
  const ss0 = xmlTag(xml, "SellingStatus");
  out.listing_status = xmlTag(ss0, "ListingStatus");
  /* 数量・売値も返す（7.47。数量0にしたあと、出品が残っているかを確かめる）。 */
  const qty0 = Number(xmlTag(xml, "Quantity") || 0);
  const sold0 = Number(xmlTag(ss0, "QuantitySold") || 0);
  out.quantity = qty0;
  out.quantity_sold = sold0;
  out.qty_available = Math.max(0, qty0 - sold0);
  out.price = Number(xmlTag(ss0, "CurrentPrice") || 0);
  out.currency = xmlAttr(ss0, "CurrentPrice", "currencyID") || "USD";
  out.active = /^Active$/i.test(String(out.listing_status || ""));
  out.pictures = {
    photo_display: xmlTag(pd, "PhotoDisplay"),
    picture_source: xmlTag(pd, "PictureSource"),
    gallery_url: xmlTag(pd, "GalleryURL"),
    picture_url: all("PictureURL", pd),
    external_picture_url: all("ExternalPictureURL", pd),
  };
  const pics = out.pictures;
  pics.n = pics.picture_url.length;
  /* 1枚目（メイン＝ギャラリー画像）とそれ以降を、そのまま並べて見えるようにする。 */
  pics.main = pics.picture_url[0] || "";
  pics.rest = pics.picture_url.slice(1);
  pics.main_is_eps = /(^|\.)ebayimg\.com\//.test(pics.main);
  pics.rest_all_eps = pics.rest.length > 0
    && pics.rest.every((u) => /(^|\.)ebayimg\.com\//.test(u));
  /* 自前ホストの紐づけが残っているか。これが残っている間は
     アプリの Revise でメイン画像を取り直そうとして失敗する。 */
  pics.ext_n = pics.external_picture_url.length;
  pics.all_eps = pics.n > 0 && pics.picture_url.every((u) => /(^|\.)ebayimg\.com\//.test(u));
  pics.eps_only = pics.all_eps && pics.ext_n === 0;
  pics.source_eps = /^EPS$/i.test(pics.picture_source || "");
  /* 写真の大きさ（7.59）。eBay 保管（i.ebayimg.com）の URL は /s/ に
     「幅X高さ」が base64 で入っているので、GetItem だけで大きさが分かる。
     長辺500px未満は出品に使えない（21919137）。 */
  pics.sizes = pics.picture_url.map((u) => {
    const z = epsSize(u);
    const long = Math.max(Number(z.w || 0), Number(z.h || 0));
    return { url: u, w: Number(z.w || 0), h: Number(z.h || 0), long: long,
             ok: long >= PIC_OK_MIN, known: long > 0 };
  });
  pics.small_n = pics.sizes.filter((z) => z.known && !z.ok).length;
  pics.unknown_n = pics.sizes.filter((z) => !z.known).length;
  pics.min_long = pics.sizes.filter((z) => z.known).length
    ? Math.min(...pics.sizes.filter((z) => z.known).map((z) => z.long)) : 0;
  /* 「ぜんぶ500px以上」と言えるのは、**全部の大きさが分かって**いて
     どれも足りているときだけ（分からない写真が1枚でもあれば言わない）。 */
  pics.all_big = pics.n > 0 && pics.small_n === 0 && pics.unknown_n === 0;
  pics.raw = String(pd || "").slice(0, 1500);
  /* ベストオファーの設定（7.58）。22003 を直すのに使う。
     GetMyeBaySelling は BestOfferDetails を返さないことがあるので、
     **本当の設定はここでしか分からない**。 */
  const bod = xmlTag(xml, "BestOfferDetails");
  const ld = xmlTag(xml, "ListingDetails");
  const onTxt = xmlTag(bod, "BestOfferEnabled");
  out.bo = {
    on: onTxt === "" ? null : (/^(true|1)$/i.test(onTxt) ? 1 : 0),
    min: Number(xmlTag(ld, "MinimumBestOfferPrice")
                || xmlTag(xml, "MinimumBestOfferPrice") || 0) || 0,
    acc: Number(xmlTag(ld, "BestOfferAutoAcceptPrice")
                || xmlTag(xml, "BestOfferAutoAcceptPrice") || 0) || 0,
    count: Number(xmlTag(bod, "BestOfferCount") || 0) || 0,
  };
  return out;
}
/* 写真が原因のエラー（21919137）の記録を消す文（7.59）。
   写真を差し替えて**全部500px以上**になったら、この記録を残しておく理由がない。
   残っていると「写真が小さい（要撮り直し）」の一覧に出続け、
   自動値下げの対象からも外れたままになる（mdSkip）。 */
function picErrClear(env, itemId, at) {
  return env.DB.prepare(
    `UPDATE items SET
       revise_err=CASE WHEN revise_err LIKE '%21919137%' THEN NULL ELSE revise_err END,
       revise_err_at=CASE WHEN revise_err LIKE '%21919137%' THEN NULL
                          ELSE revise_err_at END,
       updated_at=?2
     WHERE ebay_item_id=?1 AND revise_err LIKE '%21919137%'`)
    .bind(String(itemId), at);
}
/* ================= マッチングワールド（MW）の在庫（7.60・段取りA）=========
   MW の在庫CSV（約12,200行・Shift_JIS）を画面が読んで、ここへ送ってくる。
   ・主キーは連番。差分の突き合わせは **(jan, sha, idx)**
     （同じ (jan,社) の行が約169組あるため。idx は CSV に現れた順）
   ・**変わった行だけ** UPSERT する（row_hash を比べる）。全件書き込みは初回だけ
   ・欠品は「今回の取り込みに現れなかった行」で判定する。ただし行数が
     30%以上減っていたら、CSV の取得ミスとみなして欠品にせず警告だけ出す
   ・JAN ごとに使う仕入れ元を1つ選ぶ（出荷が4営業日以内 → 卸値が安い →
     在庫が多い → 出荷が早い）。窓関数で2文だけなので行数に関係なく速い

   items の mw_low ほかへの書き戻しは**まだしない**。D1 に JAN の列が無く、
   JAN→ASIN の対応が付くのは行を出品リストに入れたとき（段取り C・D）だから。 */
const MW_CHUNK = 400;                  // 画面が1回に送ってくる行数の上限
const MW_SHIP_OK = 4;                  // 無在庫に使える出荷の営業日数
const MW_DROP_WARN = 0.30;             // 行数がこれ以上減ったら取得ミスとみなす
const MW_LIST_MAX = 500;               // 候補一覧で返す行数の上限
const MW_STOCK_MIN = 5;                // MW在庫の下限の既定（7.74）
/* ---- eBay の相場（4章の6・7.62）---- */
const MW_MKT_MAX = 120;                // 1回に調べる JAN の数（＝Browse の呼び出し回数）
                                       // 60秒の上限でだいたいこの数まで進む
const MW_MKT_HARD = 400;               // 画面から増やせる上限
const MW_MKT_TTL_D = 7;                // 取れた相場を取り直さない日数
const MW_MKT_ERR_TTL_H = 24;           // 取れなかったものを取り直すまでの時間
const MW_MKT_GAP_MS = 120;             // 呼び出しの間隔（eBay に続けて当てない）
const MW_MKT_DEADLINE_MS = 60000;      // 1回の実行で使う時間の上限
const MW_MKT_PAGE = 50;                // 1回の検索で見る出品の数
const MW_OVER = 1.15;                  // 推奨売値が最安値のこの倍までなら「出品候補」
/* ---- MW の商品画像（6.1 の①・7.63）---- */
const MW_IMG_MAX = 12;                 // 1商品に貼れる枚数（1枚目がメイン）
const MW_IMG_MIN_LONG = 500;           // eBay が要る長辺。これ未満は使えない
const MW_IMG_BYTES = 5 * 1024 * 1024;  // pj-img の1枚の上限と同じ
const MW_IMG_HOST = "https://matchingworld.asia";
/* MW の商品IDから画像URLを作る（仕様6.1）。
   products/{IDの下4桁を0にした値}/{下2桁を0にした値}/{ID}.jpg */
function mwImgUrl(id) {
  const n = Math.floor(Number(id) || 0);
  if (!(n > 0)) return "";
  return MW_IMG_HOST + "/products/" + (Math.floor(n / 10000) * 10000)
    + "/" + (Math.floor(n / 100) * 100) + "/" + n + ".jpg";
}
/* 貼られた文字から MW の商品IDを読む。商品IDそのものか、画像URLのどちらでもよい。 */
function mwImgId(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  const m = /^https:\/\/matchingworld\.asia\/products\/\d+\/\d+\/(\d+)\.jpg$/.exec(t);
  if (m) return Number(m[1]);
  if (/^\d{1,12}$/.test(t)) return Number(t);
  return 0;
}
function mwNum(v) {
  const n = Number(String(v == null ? "" : v).replace(/[^0-9.-]/g, ""));
  return isFinite(n) ? Math.round(n) : 0;
}
/* 1行の中身のハッシュ。変わったかどうかだけ見たいので短くてよい。 */
function mwHash(r) {
  const t = [r.kishu, r.name, r.list_price, r.release, r.cond, r.wholesale,
             r.stock, r.note, r.ship_text, r.ship_days].join("\u0001");
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(36) + "." + t.length.toString(36);
}
/* 画面から来た1行を整える。jan は13桁の数字だけを通す。 */
function mwRow(x) {
  const jan = String((x && x.jan) || "").replace(/\D/g, "");
  if (jan.length !== 13) return null;
  const r = {
    jan: jan,
    sha: String((x && x.sha) || "").slice(0, 20),
    idx: Math.max(0, Math.min(99, mwNum(x && x.idx))),
    kishu: String((x && x.kishu) || "").slice(0, 40),
    name: String((x && x.name) || "").slice(0, 200),
    list_price: mwNum(x && x.list_price),
    release: String((x && x.release) || "").slice(0, 20),
    cond: String((x && x.cond) || "").slice(0, 10),
    wholesale: mwNum(x && x.wholesale),
    stock: mwNum(x && x.stock),
    note: String((x && x.note) || "").slice(0, 200),
    ship_text: String((x && x.ship_text) || "").slice(0, 80),
    ship_days: Math.max(0, Math.min(99, mwNum(x && x.ship_days))),
  };
  if (!r.sha) return null;
  r.row_hash = mwHash(r);
  return r;
}
/* 取り込み。body = { at, part, parts, rows:[…], rows_in, unreadable }
   part/parts は分けて送るときの通し番号（1/31 … 31/31）。
   最後の便（part>=parts）で欠品の判定と代表選びをする。 */
async function mwStockPut(env, body) {
  const run = newRun("mw-stock");
  const res = { ok: false, part: 1, parts: 1, taken: 0, added: 0, changed: 0,
                same: 0, skipped: 0, gone: 0, back: 0, picked: 0, seen: 0,
                zeroed: 0, warn: "", at: "" };
  try {
    const at = String((body && body.at) || "").trim() || nowIso();
    res.at = at;
    res.part = Math.max(1, mwNum(body && body.part) || 1);
    res.parts = Math.max(1, mwNum(body && body.parts) || 1);
    const list = Array.isArray(body && body.rows) ? body.rows : [];
    if (list.length > MW_CHUNK) {
      res.error = "too_many";
      res.warn = "1回に送れるのは " + MW_CHUNK + "行までです";
      return Object.assign(await saveRun(env, run), res);
    }
    const rows = [];
    for (const x of list) {
      const r = mwRow(x);
      if (r) rows.push(r); else res.skipped++;
    }
    res.taken = rows.length;
    /* いまの row_hash を引いて、変わった行だけ書く。 */
    const have = {};
    const step = d1Step(3);                 // (jan,sha,idx) で1件3個 → 32件ずつ
    for (let i = 0; i < rows.length; i += step) {
      const part = rows.slice(i, i + step);
      const where = part.map(() => "(jan=? AND sha=? AND idx=?)").join(" OR ");
      const bind = [];
      for (const r of part) bind.push(r.jan, r.sha, r.idx);
      const got = await env.DB.prepare(
        `SELECT jan, sha, idx, row_hash, gone_at FROM mw_stock WHERE ${where}`)
        .bind(...bind).all();
      for (const y of (got && got.results) || [])
        have[y.jan + "|" + y.sha + "|" + y.idx] = y;
    }
    const stmts = [];
    for (const r of rows) {
      const old = have[r.jan + "|" + r.sha + "|" + r.idx];
      if (old && old.row_hash === r.row_hash && !old.gone_at) {
        /* 中身が同じなら seen_at だけ新しくする（差分書き込み）。 */
        res.same++;
        stmts.push(env.DB.prepare(
          `UPDATE mw_stock SET seen_at=?4 WHERE jan=?1 AND sha=?2 AND idx=?3`)
          .bind(r.jan, r.sha, r.idx, at));
        continue;
      }
      if (old) { res.changed++; if (old.gone_at) res.back++; } else res.added++;
      stmts.push(env.DB.prepare(
        `INSERT INTO mw_stock (jan,sha,idx,kishu,name,list_price,release,cond,
           wholesale,stock,note,ship_text,ship_days,row_hash,seen_at,gone_at,
           created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,NULL,?15)
         ON CONFLICT(jan,sha,idx) DO UPDATE SET
           kishu=excluded.kishu, name=excluded.name,
           list_price=excluded.list_price, release=excluded.release,
           cond=excluded.cond, wholesale=excluded.wholesale,
           stock=excluded.stock, note=excluded.note,
           ship_text=excluded.ship_text, ship_days=excluded.ship_days,
           row_hash=excluded.row_hash, seen_at=excluded.seen_at, gone_at=NULL`)
        .bind(r.jan, r.sha, r.idx, r.kishu, r.name, r.list_price, r.release,
              r.cond, r.wholesale, r.stock, r.note, r.ship_text, r.ship_days,
              r.row_hash, at));
    }
    await runBatch(env, run, stmts);
    /* 最後の便。欠品の判定と、JANごとの代表選び。 */
    if (res.part >= res.parts) {
      const a = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM mw_stock WHERE seen_at=?1`).bind(at).first();
      const b = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM mw_stock WHERE gone_at IS NULL`).first();
      const seen = Number((a && a.n) || 0);      // 今回の取り込みに現れた行
      const live = Number((b && b.n) || 0);      // いま生きている行（今回ぶんを含む）
      res.seen = seen;
      const missing = Math.max(0, live - seen);
      if (live > 0 && seen > 0 && (missing / live) >= MW_DROP_WARN) {
        res.warn = "今回の取り込みは " + seen + "行で、生きている " + live
          + "行より " + Math.round(missing / live * 100)
          + "% 少ないため、欠品にしていません（CSV の取得ミスの可能性）。"
          + "もう一度取り込んでください";
        run.notes.push(res.warn);
      } else if (missing > 0) {
        const g = await env.DB.prepare(
          `UPDATE mw_stock SET gone_at=?1 WHERE gone_at IS NULL AND seen_at<>?1`)
          .bind(at).run();
        res.gone = Number((g && g.meta && g.meta.changes) || 0);
      }
      /* JANごとに1つ選ぶ（窓関数。行数に関係なく2文で済む）。 */
      await env.DB.prepare(`UPDATE mw_stock SET pick=0 WHERE pick=1`).run();
      const pk = await env.DB.prepare(
        `UPDATE mw_stock SET pick=1 WHERE id IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (PARTITION BY jan ORDER BY
               CASE WHEN COALESCE(ship_days,99)<=${MW_SHIP_OK} THEN 0 ELSE 1 END,
               COALESCE(wholesale,999999999) ASC,
               COALESCE(stock,0) DESC,
               COALESCE(ship_days,99) ASC,
               id ASC) AS rn
             FROM mw_stock WHERE gone_at IS NULL
           ) WHERE rn=1)`).run();
      res.picked = Number((pk && pk.meta && pk.meta.changes) || 0);
      /* ---- 欠品した出品の数量を**すぐ0にする**（7.73）----
         数量を減らす方向なので確認を待たない（売り越しが一番まずい）。
         値上げと数量1に戻すのは今までどおり（毎時は予定・日次で実行）。 */
      try {
        /* 何か動いたときだけ走らせる（欠品が出た・在庫数が変わった）。
           3割の歯止めが効いたときは何も消していないので走らせない。 */
        if (!res.warn && (res.gone > 0 || res.changed > 0)) {
          const z = await jobMwDrop(env, { approve: true, only: "zero" });
          res.zeroed = Number((z && z.zero) || 0);
          if (res.zeroed)
            run.notes.push("欠品した出品 " + res.zeroed + "件の数量を0にしました");
        }
      } catch (e) { run.notes.push("mw-zero: " + String((e && e.message) || e)); }
      await env.DB.prepare(
        `INSERT INTO mw_runs (at,rows_in,added,changed,same,gone,back,picked,
           unreadable,warn,note,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?1)`)
        .bind(at, mwNum(body && body.rows_in), res.added, res.changed, res.same,
              res.gone, res.back, res.picked, mwNum(body && body.unreadable),
              res.warn || null,
              ("現れた " + seen + "行／生きている " + live + "行").slice(0, 300))
        .run();
      run.notes.push("MW在庫：現れた " + seen + "行／足した " + res.added
        + "／変わった " + res.changed + "／同じ " + res.same
        + "／欠品 " + res.gone + "／戻った " + res.back
        + "／代表 " + res.picked);
    }
    res.ok = true;
  } catch (e) {
    run.errors++;
    run.notes.push("例外 " + e.message);
    res.error = e.message;
  }
  return Object.assign(await saveRun(env, run), res);
}
/* 候補一覧（段取りA）。4章の1〜4で絞った**代表の行**だけ返す。
   5章の利益計算（卸値×1.1＋送料）は画面が shared/pricing.js で行う。 */
/* ===== MW の候補を Amazon（国内FBA）で見る（7.66）=====
   目的：MW の卸値で仕入れて **国内の Amazon FBA** で売ったときに利益が出るかを、
   定価の見積りではなく **実売価格**で確かめる。テスト仕入れの絞り込みに使う。

   ① JAN → ASIN とランキング … Catalog Items（1回20件・5回/秒）
   ② ASIN → 新品の実売価格と出品の様子 … getItemOffersBatch（1回20件・**0.1回/秒**）
   ②が 10秒に1回なので、ここが1回の件数を決める。

   利益の計算はここでは行わない（手数料率は⚙設定で変わるため画面で計算する）。
   控えるのは「取ってきた事実」だけ。 */
const MW_AMZ_MAX = PRICING_BATCH * PRICING_MAX_CALLS;   // 1回に調べる件数（120）
const MW_AMZ_TTL_D = 3;                 // 取れた値段を取り直さない日数
const MW_AMZ_ERR_TTL_H = 24;            // 取れなかったものを取り直すまでの時間
const MW_AMZ_CAT_BATCH = 20;            // Catalog Items の1回の件数
const MW_AMZ_RETRY_MAX = 120;           // 引けなかった JAN を1件ずつ引き直す上限
/* getItemOffersBatch は 0.1回/秒。Cron（scheduled）と画面からの実行は
   **別の isolate で動くことがあり、spLanes（モジュール変数）は共有されない**。
   そこで最後に呼んだ時刻を KV にも置き、呼び出しの間隔を越えないようにする（7.70）。 */
const SP_KV_LANES = { getItemOffersBatch: 1 };
async function spSlotKv(env, label) {
  if (!SP_KV_LANES[label] || !env || !env.SYNC_CACHE) return;
  const gap = SP_GAP[label] || SP_GAP_DEFAULT;
  const key = "sp:last:" + label;
  try {
    const last = Number(await env.SYNC_CACHE.get(key)) || 0;
    const wait = last + gap - Date.now();
    if (wait > 0 && wait < gap * 2) await sleep(wait);
    await env.SYNC_CACHE.put(key, String(Date.now()),
      { expirationTtl: Math.max(60, Math.ceil(gap / 1000) * 3) });
  } catch (e) { /* KV が使えないときは今までどおり（spLanes だけ） */ }
}
/* JAN から ASIN・商品名・ランキングを引く。20件ずつ。 */
async function mwAsinFind(env, run, jans) {
  const out = {};
  let calls = 0;
  for (let i = 0; i < jans.length; i += MW_AMZ_CAT_BATCH) {
    const part = jans.slice(i, i + MW_AMZ_CAT_BATCH);
    const q = new URLSearchParams({
      identifiers: part.join(","), identifiersType: "EAN",
      marketplaceIds: MP_FE,
      includedData: "summaries,salesRanks,identifiers",
    });
    const r = await spCall(env, run, "/catalog/2022-04-01/items?" + q.toString(),
                           { label: "searchCatalogItems" });
    calls++;
    if (!r.ok) { run.notes.push("ASIN引き -> " + r.status); continue; }
    for (const it of (r.data && r.data.items) || []) {
      const asin = String(it.asin || "");
      if (!asin) continue;
      /* どの JAN で当たったかは identifiers から読む（要求した順とは限らない）。 */
      const jset = [];
      for (const g of (it.identifiers || [])) {
        for (const x of (g.identifiers || [])) {
          if (/^(EAN|UPC|JAN|GTIN)$/i.test(String(x.identifierType || "")))
            jset.push(String(x.identifier || "").replace(/\D/g, ""));
        }
      }
      const sum = (it.summaries || [])[0] || {};
      /* ランキングは「いちばん細かい分類」を採る（表示順＝大分類から細かい順）。 */
      let rank = 0, rankCat = "";
      const sr = (it.salesRanks || [])[0] || {};
      for (const g of (sr.classificationRanks || [])) {
        if (Number(g.rank) > 0) { rank = Number(g.rank); rankCat = String(g.title || ""); }
      }
      if (!rank) {
        for (const g of (sr.displayGroupRanks || [])) {
          if (Number(g.rank) > 0 && !rank) {
            rank = Number(g.rank); rankCat = String(g.title || "");
          }
        }
      }
      const rec = { asin, name: String(sum.itemName || "").slice(0, 300),
                    rank, rank_cat: rankCat.slice(0, 60) };
      for (const j of jset) if (part.indexOf(j) >= 0 && !out[j]) out[j] = rec;
      /* identifiers が返らないときは、要求が1件なら取り違えようがない。 */
      if (!jset.length && part.length === 1 && !out[part[0]]) out[part[0]] = rec;
    }
    /* 20件まとめて引くと、Amazon が商品を返しても **その商品の識別子に
       要求した JAN が入っていない**ことがあり、どの JAN の答えか決められない。
       その場合はここで落ちてしまうので、下で1件ずつ引き直す（7.69）。 */
  }
  /* 引けなかった JAN を1件ずつ引き直す。1件なら取り違えようがないので、
     識別子が合わなくても「その JAN の答え」として採れる。
     Catalog は5回/秒なので、この引き直しは速い。 */
  const miss = jans.filter((j) => !out[j]);
  const why = {};
  for (const j of miss.slice(0, MW_AMZ_RETRY_MAX)) {
    const q = new URLSearchParams({
      identifiers: j, identifiersType: "EAN", marketplaceIds: MP_FE,
      includedData: "summaries,salesRanks,identifiers",
    });
    const r = await spCall(env, run, "/catalog/2022-04-01/items?" + q.toString(),
                           { label: "searchCatalogItems" });
    calls++;
    if (!r.ok) { why[j] = "Amazonに問い合わせできませんでした（" + r.status + "）"; continue; }
    const items = (r.data && r.data.items) || [];
    if (!items.length) { why[j] = "Amazonのカタログにこの JAN がありません"; continue; }
    const it = items[0];
    const asin = String(it.asin || "");
    if (!asin) { why[j] = "ASIN が返りませんでした"; continue; }
    const sum = (it.summaries || [])[0] || {};
    let rank = 0, rankCat = "";
    const sr = (it.salesRanks || [])[0] || {};
    for (const g of (sr.classificationRanks || []))
      if (Number(g.rank) > 0) { rank = Number(g.rank); rankCat = String(g.title || ""); }
    if (!rank) for (const g of (sr.displayGroupRanks || []))
      if (Number(g.rank) > 0 && !rank) { rank = Number(g.rank); rankCat = String(g.title || ""); }
    out[j] = { asin, name: String(sum.itemName || "").slice(0, 300),
               rank, rank_cat: rankCat.slice(0, 60), retried: 1 };
  }
  for (const j of miss.slice(MW_AMZ_RETRY_MAX))
    why[j] = "引き直しの上限に達しました（次回に回します）";
  /* 引けた分・引けなかった分を jan_map に控える（7.67）。
     次からは API を呼ばずに済む。 */
  await janMapPut(env, jans.map((j) => Object.assign({ jan: j },
    out[j] || { asin: "", err: why[j] || "ASINが見つかりません" })), "catalog");
  return { map: out, calls, retried: miss.length, why };
}
/* ---- JAN → ASIN の控え（7.67）----
   items は**すでにちょうど100列**（D1 の上限・7.55）なので jan の列を足せない。
   そのため別表 jan_map に持つ。 */
const JAN_MISS_TTL_D = 7;            // 見つからなかった JAN を調べ直すまでの日数
function janOk(v) { return /^\d{13}$/.test(String(v || "").replace(/\D/g, "")); }
async function janMapPut(env, list, src) {
  const stmts = [];
  const at = nowIso();
  for (const r of (list || [])) {
    const jan = String((r && r.jan) || "").replace(/\D/g, "");
    if (!janOk(jan)) continue;
    stmts.push(env.DB.prepare(
      `INSERT INTO jan_map (jan,asin,name,rank,rank_cat,src,err,at,created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)
       ON CONFLICT(jan) DO UPDATE SET asin=excluded.asin,
         name=COALESCE(NULLIF(excluded.name,''), jan_map.name),
         rank=COALESCE(excluded.rank, jan_map.rank),
         rank_cat=COALESCE(NULLIF(excluded.rank_cat,''), jan_map.rank_cat),
         src=excluded.src, err=excluded.err, at=excluded.at`)
      .bind(jan, String(r.asin || "") || null, String(r.name || ""),
            Number(r.rank) || null, String(r.rank_cat || ""),
            String(src || "catalog"), String(r.err || ""), at));
  }
  if (stmts.length) {
    for (let i = 0; i < stmts.length; i += 50)
      await env.DB.batch(stmts.slice(i, i + 50));
  }
}
/* ---- GET /find?jan=… ----
   JAN から ASIN を返す。控えにあれば **API を呼ばない**。
   見つからなかった控えは JAN_MISS_TTL_D 日たったら調べ直す。
   jans=… でカンマ区切りで複数（最大20件）。 */
async function janFind(env, url) {
  const run = newRun("jan-find");
  const res = { ok: false, rows: [], asked: 0, cached: 0, looked: 0, calls: 0 };
  try {
    const p = url.searchParams;
    const raw = String(p.get("jans") || p.get("jan") || "").split(",");
    const jans = [];
    for (const x of raw) {
      const j = String(x).replace(/\D/g, "");
      if (janOk(j) && jans.indexOf(j) < 0) jans.push(j);
    }
    if (!jans.length) { res.error = "bad_jan"; return Object.assign(await saveRun(env, run), res); }
    const ask = jans.slice(0, 20);
    res.asked = ask.length;
    /* ① 控えを引く（jan_map と、MW で分かっている分）。 */
    const have = {};
    const q = await env.DB.prepare(
      `SELECT jan, asin, name, rank, rank_cat, src, err, at FROM jan_map
        WHERE jan IN (${ask.map(() => "?").join(",")})`).bind(...ask).all();
    for (const r of (q && q.results) || []) have[r.jan] = r;
    const q2 = await env.DB.prepare(
      `SELECT jan, asin, name, rank, rank_cat FROM mw_amz
        WHERE COALESCE(asin,'')<>'' AND jan IN (${ask.map(() => "?").join(",")})`)
      .bind(...ask).all();
    for (const r of (q2 && q2.results) || []) {
      if (!have[r.jan] || !have[r.jan].asin)
        have[r.jan] = Object.assign({}, r, { src: "mw", err: "", at: "" });
    }
    /* ② 足りない分だけ Catalog を呼ぶ（見つからない控えは期限つきで使い回す）。 */
    const miss = new Date(Date.now() - JAN_MISS_TTL_D * 86400000).toISOString();
    const todo = ask.filter((j) => {
      const h = have[j];
      if (h && h.asin) return false;                 // 分かっている
      if (h && !h.asin && String(h.at || "") > miss) return false;  // 最近調べて無かった
      return true;
    });
    res.cached = ask.length - todo.length;
    if (todo.length) {
      const f = await mwAsinFind(env, run, todo);
      res.looked = todo.length;
      res.calls = f.calls;
      for (const j of todo) {
        const g = f.map[j];
        have[j] = g ? Object.assign({ jan: j, src: "catalog", err: "" }, g)
                    : { jan: j, asin: "", src: "catalog",
                        err: "ASINが見つかりません" };
      }
    }
    res.rows = ask.map((j) => {
      const h = have[j] || {};
      return { jan: j, asin: String(h.asin || ""), name: String(h.name || ""),
               rank: Number(h.rank) || 0, rank_cat: String(h.rank_cat || ""),
               src: String(h.src || ""), err: String(h.err || "") };
    });
    res.ok = true;
  } catch (e) {
    run.errors++; run.notes.push("jan-find: " + String((e && e.message) || e));
    res.error = String((e && e.message) || e);
  }
  return Object.assign(await saveRun(env, run), res);
}
/* ===== 「Amazonで調べる」1つのボタン（7.79）=====
   1回押すと、この順に進む。
     ① JAN → ASIN（ASIN がまだ無い行だけ）
     ② 出品の可否（まだ・期限切れの行。7.76）
     ③ 実売価格（**赤＝出品できない行は飛ばす**。呼び出しを減らすため）
   60秒で切られるので、各段で残りを返し「もう一度押すと続きます」にする。
   ③で飛ばした赤の行は、あとで緑に変わっていれば次に押したときに価格を取る
   （可否が先に進むので、同じ押しの中で緑になった行もその場で価格を取る）。

   段ごとに「最後に試した時刻」を分けてある（mw_amz.asin_at / price_at）。
   1つの checked_at だと、①で ASIN を引いた行が「さっき調べた行」になって
   ③の対象から外れ、値段が一度も取れない。 */
const MW_SCAN_BUDGET_MS = 55000;   // Worker の60秒の手前で切る

/* ① JAN → ASIN。ASIN が入っている行は引き直さない（ASIN は変わらない）。
   引けなかった行は MW_AMZ_ERR_TTL_H（24時間）たてば再挑戦する。 */
async function mwScanAsin(env, run, o, dl) {
  const st = { asked: 0, done: 0, ok_n: 0, ng: 0, calls: 0, left: 0, stopped: "" };
  const limit = Math.max(1, Math.min(MW_AMZ_MAX, mwNum(o.limit) || MW_AMZ_MAX));
  const q = mwWhere(o);
  const errOld = new Date(Date.now() - MW_AMZ_ERR_TTL_H * 3600000).toISOString();
  const pick = await env.DB.prepare(
    `SELECT s.jan AS jan FROM mw_stock s LEFT JOIN mw_amz a ON a.jan = s.jan
      WHERE ${q.w}
        AND COALESCE(a.asin,'') = ''
        AND (a.asin_at IS NULL OR a.asin_at < ?)
      ORDER BY COALESCE(a.asin_at,'') ASC, s.jan ASC`)
    .bind(...q.bind, errOld).all();
  const all = ((pick && pick.results) || []).map((x) => String(x.jan));
  st.asked = all.length;
  if (!all.length) return st;
  if (Date.now() > dl) { st.stopped = "time"; st.left = st.asked; return st; }
  const todo = all.slice(0, limit);
  const found = await mwAsinFind(env, run, todo);
  st.calls = found.calls;
  const at = nowIso();
  const stmts = [];
  for (const j of todo) {
    const f = found.map[j];
    st.done++;
    if (!f || !f.asin) {
      st.ng++;
      stmts.push(env.DB.prepare(
        `INSERT INTO mw_amz (jan,err,checked_at,asin_at,created_at)
           VALUES (?1,?2,?3,?3,?3)
         ON CONFLICT(jan) DO UPDATE SET err=excluded.err, asin=NULL,
           checked_at=excluded.checked_at, asin_at=excluded.asin_at`)
        .bind(j, (found.why && found.why[j]) || "ASINが見つかりません", at));
      continue;
    }
    st.ok_n++;
    /* 値段の列には触らない（③が入れる）。 */
    stmts.push(env.DB.prepare(
      `INSERT INTO mw_amz (jan,asin,name,rank,rank_cat,err,checked_at,asin_at,created_at)
         VALUES (?1,?2,?3,?4,?5,'',?6,?6,?6)
       ON CONFLICT(jan) DO UPDATE SET asin=excluded.asin,
         name=COALESCE(NULLIF(excluded.name,''), mw_amz.name),
         rank=COALESCE(excluded.rank, mw_amz.rank),
         rank_cat=COALESCE(NULLIF(excluded.rank_cat,''), mw_amz.rank_cat),
         err='', checked_at=excluded.checked_at, asin_at=excluded.asin_at`)
      .bind(j, f.asin, f.name || "", f.rank || null, f.rank_cat || "", at));
  }
  await runBatch(env, run, stmts);
  st.left = Math.max(0, st.asked - st.done);
  if (st.left) st.stopped = "limit";
  return st;
}

/* ③ 実売価格。ASIN がある行のうち、**赤（出品できない）を外して**古い順に取る。
   getItemOffersBatch は 0.1回/秒なので1回20件で10.5秒かかる。
   ①②で使った時間を差し引いた残りで、入るだけ取る。 */
async function mwScanPrice(env, run, o, dl) {
  const st = { asked: 0, done: 0, priced: 0, none: 0, skipped_red: 0, calls: 0,
               left: 0, stopped: "" };
  const limit = Math.max(1, Math.min(MW_AMZ_MAX, mwNum(o.limit) || MW_AMZ_MAX));
  const q = mwWhere(o);
  /* cond は mw_stock にも mw_restrict にもあるので、修飾しないと落ちる。 */
  const w = q.w.replace(/\b(gone_at|pick|kishu|cond|ship_days|stock|note)\b/g, "s.$1");
  const okOld = new Date(Date.now() - MW_AMZ_TTL_D * 86400000).toISOString();
  /* ⚠ 番号付きの ?N は使わない（7.76 の穴）。素の `?` だけ、文に出てくる順。 */
  const sql = (redOnly) =>
    `SELECT a.jan AS jan, a.asin AS asin
       FROM mw_stock s
       JOIN mw_amz a ON a.jan = s.jan AND COALESCE(a.asin,'') <> ''
       LEFT JOIN mw_restrict r ON r.asin = a.asin AND r.cond = '${MW_RST_COND}'
      WHERE ${w}
        AND COALESCE(r.state,'') ${redOnly ? "=" : "<>"} 'blocked'
        AND (a.price_at IS NULL OR a.price_at < ?)
      GROUP BY a.jan
      ORDER BY COALESCE(MAX(a.price_at),'') ASC, a.jan ASC`;
  const pick = await env.DB.prepare(sql(false)).bind(...q.bind, okOld).all();
  const all = ((pick && pick.results) || []).map(
    (x) => ({ jan: String(x.jan), asin: String(x.asin) }));
  st.asked = all.length;
  /* 飛ばした赤の件数（画面に出す）。 */
  const red = await env.DB.prepare(sql(true)).bind(...q.bind, okOld).all();
  st.skipped_red = ((red && red.results) || []).length;
  if (!all.length) return st;
  const todo = all.slice(0, limit);
  const at = nowIso();
  const stmts = [];
  const low = {};
  for (let i = 0; i < todo.length; i += PRICING_BATCH) {
    /* 1回（20件）ぶんの時間が残っていなければ、そこで止める。 */
    if (Date.now() > dl) { st.stopped = "time"; break; }
    const part = todo.slice(i, i + PRICING_BATCH);
    const g = await amazonLowest(env, run,
      part.map((x) => ({ asin: x.asin, cond: "new" })));
    st.calls++;
    Object.assign(low, g);
    for (const x of part) {
      const z = low[x.asin + "|new"] || null;
      st.done++;
      if (!z) st.none++; else st.priced++;
      const buy = z ? Number(z.buy || 0) : 0;
      const lw = z ? Number(z.low || 0) : 0;
      const price = buy > 0 ? buy : lw;
      const basis = buy > 0 ? "カート" : (lw > 0 ? "最安" : "");
      stmts.push(env.DB.prepare(
        `UPDATE mw_amz SET price=?2, basis=?3, low=?4, buybox=?5, new_n=?6,
           low_n=?7, amz=?8, fba_n=?9, err=?10, checked_at=?11, price_at=?11
         WHERE jan=?1`)
        .bind(x.jan, price || null, basis, lw || null, buy || null,
              z ? (z.newN || z.total || 0) : 0, z ? (z.lowN || 0) : 0,
              z ? (z.amz || 0) : 0, z ? (z.fba || 0) : 0,
              z ? "" : "Amazon に新品の出品がありません", at));
    }
  }
  await runBatch(env, run, stmts);
  st.left = Math.max(0, st.asked - st.done);
  if (st.left && !st.stopped) st.stopped = "limit";
  return st;
}

/* ---- POST /mw/amz ----「Amazonで調べる」。①②③を順に進める。 */
async function mwScanRun(env, body) {
  const run = newRun("mw-amz");
  const res = { ok: false, asin: null, rst: null, price: null, left: 0,
                stopped: "", budget_ms: MW_SCAN_BUDGET_MS };
  try {
    const o = body || {};
    const dl = Date.now() + MW_SCAN_BUDGET_MS;
    /* ① JAN → ASIN */
    res.asin = await mwScanAsin(env, run, o, dl);
    /* ② 出品の可否（7.76）。ここで緑になった行は、すぐ下の③で値段を取る。 */
    res.rst = await mwRestrictRun(env, o, { run: run, deadline: dl });
    /* ③ 実売価格（赤は飛ばす） */
    res.price = await mwScanPrice(env, run, o, dl);
    res.left = (res.asin.left || 0) + (res.rst.left || 0) + (res.price.left || 0);
    res.stopped = [res.asin.stopped, res.rst.stopped, res.price.stopped]
      .filter(Boolean).join(",");
    await env.DB.prepare(
      `INSERT INTO mw_amz_runs (at,asked,done,asin_ok,asin_ng,priced,none,failed,
         left_n,calls_cat,calls_prc,note,created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?1)`)
      .bind(nowIso(), res.asin.asked + res.rst.asked + res.price.asked,
            res.asin.done + res.rst.done + res.price.done,
            res.asin.ok_n, res.asin.ng, res.price.priced, res.price.none,
            res.rst.failed || 0, res.left, res.asin.calls, res.price.calls,
            ("ASIN " + res.asin.done + "／可否 " + (res.rst.done || 0)
             + "／価格 " + res.price.done + "／赤を飛ばした "
             + res.price.skipped_red + "／止まった理由 "
             + (res.stopped || "すべて")).slice(0, 300)).run();
    run.notes.push("Amazonで調べる：ASIN引き " + res.asin.done
      + "（取れた " + res.asin.ok_n + "）／可否 " + (res.rst.done || 0)
      + "（緑 " + (res.rst.ok_n || 0) + "・黄 " + (res.rst.approval || 0)
      + "・赤 " + (res.rst.blocked || 0) + "・失敗 " + (res.rst.failed || 0)
      + "）／価格 " + res.price.done + "（取れた " + res.price.priced
      + "・赤を飛ばした " + res.price.skipped_red + "）／残り " + res.left);
    res.ok = true;
  } catch (e) {
    run.errors++; run.notes.push("mw-amz: " + String((e && e.message) || e));
    res.error = String((e && e.message) || e);
  }
  return Object.assign(await saveRun(env, run), res);
}
/* ===== 段取り D：MW の無在庫を守る（7.72）=====
   MW の在庫CSVを取り込んだあと、eBay に出している MW の出品を見直す。

   eBay の出品と MW の商品は **CustomLabel `W-<JAN>`** で結ぶ
   （items に JAN の列は無く、足せない＝100列。7.67 と同じ事情）。

   | MW の状態 | eBay への操作 |
   | 欠品（CSV から消えた・pick が無い） | **数量を0**にする |
   | 卸値が上がって下限利益を割る | 売値を**目標利益の売値まで上げる**。
   |                               | 上げると相場の115%を超えるなら**数量0** |
   | 卸値が下がった | 何もしない（自動値下げに任せる） |
   | 欠品から戻り、利益も出る | **数量を1**に戻す |

   安全のための決まり（フェイズB・在庫補充と同じ考え方）:
   ・1回の件数に上限。'confirm' では eBay を呼ばず予定だけ残す
   ・値下げはしない（自動値下げに任せる）
   ・失敗した行は次の回に再試行する */
const MW_D_MAX = 60;               // 1回に変える件数の上限
const MW_D_PICK = 2000;            // 1回に見る行数
const MW_D_OVER = 1.15;            // 相場のこの倍を超えたら数量0
function mwJanOfSku(sku) {
  const m = /^W-(\d{13})$/.exec(String(sku || "").trim());
  return m ? m[1] : "";
}
/* 1行ぶんの判定。値付けの式は shared/pricing.js のものだけを使う。 */
function mwDropPlan(S, r, mw, mk, over) {
  const o = { act: "", why: "", to: 0, qty: 0 };
  const qty = Number(r.ebay_qty) || 0;
  const now = Number(r.ebay_price) || 0;
  /* MW から消えた（欠品）。 */
  if (!mw || mw.gone_at) {
    if (qty > 0) { o.act = "zero"; o.why = "MWで欠品"; }
    return o;
  }
  const stock = Number(mw.stock) || 0;
  if (stock <= 0) {
    if (qty > 0) { o.act = "zero"; o.why = "MWの在庫が0"; }
    return o;
  }
  /* いまの卸値から、目標利益の売値と下限利益の売値を出す。 */
  const cost = Math.round((Number(mw.wholesale) || 0) * 1.1) + (Number(S.mwShipFee) || 0);
  if (!(cost > 0)) return o;
  const w = Number(r.weight_g) || (skuCatOf(r.prefix) === "game" ? 150 : 400);
  const p = PRICING.priceFor(S, cost, w, 0);
  const ship = PRICING.model(S, { cost: cost, weight: w, flat: 0 });
  const g = ship.zoneShipCharge(ship.basisZone);
  /* 相場の上限（総額）。超える売値では出さない。 */
  const low = (mk && Number(mk.low) > 0) ? Number(mk.low)
            : ((mk && Number(mk.low_any) > 0) ? Number(mk.low_any) : 0);
  const cap = low > 0 ? (low * (over || MW_D_OVER) - g) : 0;
  /* 欠品から戻った（数量0で、MW に在庫があり、利益も出る）。 */
  if (qty <= 0) {
    if (now >= p.floor && (!cap || now <= cap)) {
      o.act = "relist"; o.qty = 1;
      o.why = "MWに在庫が戻った（在庫 " + stock + "点）";
      return o;
    }
    /* いまの売値では下限を割るので、売値を直してから戻す。 */
    if (!cap || p.price <= cap) {
      o.act = "restock"; o.to = p.price; o.qty = 1;
      o.why = "MWに在庫が戻ったので売値を直して数量1";
      return o;
    }
    o.why = "戻せません（目標利益の売値が相場の"
      + Math.round((over || MW_D_OVER) * 100) + "%を超える）";
    return o;
  }
  /* 出ている売値が下限利益を割っている（卸値が上がった）。 */
  if (now > 0 && now < p.floor) {
    if (cap && p.price > cap) {
      o.act = "zero";
      o.why = "卸値が上がり、相場の" + Math.round((over || MW_D_OVER) * 100)
        + "%以内では利益が出ない";
      return o;
    }
    o.act = "up"; o.to = p.price;
    o.why = "卸値が上がったので売値を上げる（下限 $" + p.floor.toFixed(2) + "）";
    return o;
  }
  return o;    // 卸値が下がった・問題なし → 何もしない
}
async function jobMwDrop(env, opt) {
  const run = newRun("mw-drop");
  const res = { ok: false, picked: 0, zero: 0, up: 0, relist: 0, restock: 0,
                skipped: 0, failed: 0, mode: "", rows: [], plan: [] };
  try {
    const o = opt || {};
    const ps = await pricingSettings(env, run);
    const S = ps.S;
    S.mwShipFee = (o.ship_fee === undefined) ? (Number(ps.st.mwShipFee) || 176)
                                             : Number(o.ship_fee);
    const over = Number(o.over) || MW_D_OVER;
    const limit = Math.max(1, Math.min(MW_D_MAX, mwNum(o.limit) || MW_D_MAX));
    const mode = (o.approve || o.mode === "auto") ? "auto" : "confirm";
    res.mode = mode;
    /* only:'zero' … **数量を0にする行だけ**を扱う（7.73）。
       数量を減らす方向なので確認を待たずに実行してよい。
       値上げと数量1に戻すのは今までどおり（毎時は予定・日次で実行）。 */
    const only = String(o.only || "");
    res.only = only;
    /* W- の SKU を持つ出品だけ。 */
    const q = await env.DB.prepare(
      `SELECT asin, cond, title, ebay_item_id, ebay_sku, ebay_qty, ebay_price,
              weight_g, prefix_x AS prefix
         FROM (SELECT i.asin AS asin, i.cond AS cond, i.title AS title,
                      i.ebay_item_id AS ebay_item_id, i.ebay_sku AS ebay_sku,
                      i.ebay_qty AS ebay_qty, i.ebay_price AS ebay_price,
                      i.weight_g AS weight_g,
                      (SELECT s.prefix FROM skus s
                        WHERE s.asin=i.asin AND s.cond=i.cond LIMIT 1) AS prefix_x
                 FROM items i
                WHERE COALESCE(i.ebay_item_id,'')<>''
                  AND i.ebay_sku LIKE 'W-%')
        LIMIT ${MW_D_PICK}`).all();
    const rows = (q && q.results) || [];
    res.picked = rows.length;
    if (!rows.length) {
      res.ok = true;
      return Object.assign(await saveRun(env, run), res);
    }
    /* MW の在庫と相場をまとめて引く。 */
    const jans = [];
    for (const r of rows) {
      const j = mwJanOfSku(r.ebay_sku);
      if (j && jans.indexOf(j) < 0) jans.push(j);
    }
    const mwBy = {}, mkBy = {};
    const step = d1Step(1);
    for (let i = 0; i < jans.length; i += step) {
      const part = jans.slice(i, i + step);
      const marks = part.map(() => "?").join(",");
      const a = await env.DB.prepare(
        `SELECT jan, sha, name, wholesale, stock, ship_days, gone_at
           FROM mw_stock WHERE pick=1 AND jan IN (${marks})`).bind(...part).all();
      for (const x of (a && a.results) || []) mwBy[x.jan] = x;
      const b = await env.DB.prepare(
        `SELECT jan, low, low_any, n FROM mw_market WHERE jan IN (${marks})`)
        .bind(...part).all();
      for (const x of (b && b.results) || []) mkBy[x.jan] = x;
    }
    /* 判定。 */
    const todo = [];
    for (const r of rows) {
      const j = mwJanOfSku(r.ebay_sku);
      if (!j) { res.skipped++; continue; }
      const pl = mwDropPlan(S, r, mwBy[j], mkBy[j], over);
      if (!pl.act) { if (pl.why) res.plan.push({ jan: j, why: pl.why }); continue; }
      if (only === "zero" && pl.act !== "zero") continue;   // 7.73
      todo.push({ jan: j, item_id: String(r.ebay_item_id), act: pl.act,
                  kind: (pl.act === "up") ? "price" : pl.act,
                  to: pl.to, qty: pl.qty, why: pl.why,
                  title: String(r.title || r.ebay_sku || ""),
                  asin: r.asin, cond: r.cond,
                  sha: (mwBy[j] && mwBy[j].sha) || "" });
      if (todo.length >= limit) break;
    }
    res.rows = todo.map((x) => ({ jan: x.jan, act: x.act, to: x.to, qty: x.qty,
                                  why: x.why, title: x.title.slice(0, 60) }));
    if (mode !== "auto" || !todo.length) {
      /* 確認モードでは eBay を1回も呼ばない。 */
      for (const x of todo) {
        if (x.act === "zero") res.zero++;
        else if (x.act === "up") res.up++;
        else if (x.act === "relist") res.relist++;
        else res.restock++;
      }
      res.ok = true;
      run.notes.push("MW無在庫（確認）：数量0 " + res.zero + "／値上げ " + res.up
        + "／数量1 " + (res.relist + res.restock) + "件");
      await mwDropNotify(env, run, res, false);
      return Object.assign(await saveRun(env, run), res);
    }
    /* 実行。ReviseInventoryStatus は1回4件まで。 */
    const token = await ebayToken(env, run);
    const stmts = [];
    for (let i = 0; i < todo.length; i += RV_BATCH) {
      const part = todo.slice(i, i + RV_BATCH);
      const send = part.map((x) => ({
        item_id: x.item_id,
        kind: (x.act === "zero") ? "zero"
            : (x.act === "relist") ? "relist"
            : (x.act === "restock") ? "restock" : "price",
        to: x.to, qty: x.qty }));
      const r2 = await ebayReviseInv(env, run, token, send);
      for (const x of part) {
        const bad = (r2 && r2.err && r2.err[x.item_id]) || (r2 && !r2.ok ? r2.why : "");
        if (bad) {
          res.failed++;
          stmts.push(env.DB.prepare(
            `UPDATE items SET revise_err=?3, revise_err_at=?4
              WHERE asin=?1 AND cond=?2`)
            .bind(x.asin, x.cond, String(bad).slice(0, 200), nowIso()));
          continue;
        }
        if (x.act === "zero") res.zero++;
        else if (x.act === "up") res.up++;
        else if (x.act === "relist") res.relist++;
        else res.restock++;
        /* 控え。数量と売値を D1 にも合わせておく。 */
        const sets = [];
        const bind = [x.asin, x.cond, nowIso()];
        if (x.act === "zero") sets.push("ebay_qty=0");
        else if (x.act === "relist") sets.push("ebay_qty=1");
        else if (x.act === "restock") {
          sets.push("ebay_qty=1");
          sets.push("ebay_price=?" + (bind.length + 1)); bind.push(x.to);
        } else {
          sets.push("ebay_price=?" + (bind.length + 1)); bind.push(x.to);
        }
        sets.push("revise_err=NULL", "revise_err_at=NULL");
        stmts.push(env.DB.prepare(
          `UPDATE items SET ${sets.join(", ")}, updated_at=?3
            WHERE asin=?1 AND cond=?2`).bind(...bind));
      }
    }
    await runBatch(env, run, stmts);
    res.ok = true;
    run.notes.push("MW無在庫：数量0 " + res.zero + "／値上げ " + res.up
      + "／数量1 " + (res.relist + res.restock) + "／失敗 " + res.failed + "件");
    await mwDropNotify(env, run, res, true);
  } catch (e) {
    run.errors++; run.notes.push("mw-drop: " + String((e && e.message) || e));
    res.error = String((e && e.message) || e);
  }
  return Object.assign(await saveRun(env, run), res);
}
async function mwDropNotify(env, run, res, done) {
  const n = res.zero + res.up + res.relist + res.restock;
  if (!n && !res.failed) return;
  const t = [];
  t.push(res.only === "zero"
    ? "🛑 MWで欠品した出品の数量を0にしました（取り込みのたびに自動）"
    : (done ? "🏷 MW無在庫の見直し"
            : "🏷 MW無在庫の見直し（確認。まだ変えていません）"));
  if (res.zero) t.push("・数量を0にした（MWで欠品・赤字）… " + res.zero + "件");
  if (res.up) t.push("・売値を上げた（卸値が上がった）… " + res.up + "件");
  if (res.relist + res.restock)
    t.push("・数量を1に戻した（MWに在庫が戻った）… " + (res.relist + res.restock) + "件");
  if (res.failed) t.push("・失敗 … " + res.failed + "件（次の回にやり直します）");
  for (const x of res.rows.slice(0, 10))
    t.push("  JAN " + x.jan + " " + x.title + " … " + x.why);
  await notify(env, run, t.join("\n"));
}

/* ===== MW の在庫CSVの取り込みが古いときの催促（7.75）=====
   欠品は **CSV を取り込まないと分からない**。取り込みが止まると
   売り越しに気づけないので、24時間を過ぎたら知らせる。
   Discord は1日1回まで（毎時の実行で鳴り続けないように）。 */
const MW_STALE_H = 24;             // これを過ぎたら催促する
const MW_STALE_KEY = "mw.stale.notified";
async function mwStaleCheck(env, run) {
  const r = await env.DB.prepare(
    `SELECT at FROM mw_runs ORDER BY id DESC LIMIT 1`).first();
  const alive = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mw_stock WHERE gone_at IS NULL`).first();
  /* そもそも MW を使っていない（在庫が入っていない）なら何も言わない。 */
  if (!Number((alive && alive.n) || 0)) return { stale: false, hours: 0 };
  const at = (r && r.at) || "";
  const ms = at ? (Date.now() - new Date(at).getTime()) : Infinity;
  const hours = isFinite(ms) ? Math.floor(ms / 3600000) : 0;
  const stale = ms >= MW_STALE_H * 3600000;
  if (!stale) {
    if (await stateGet(env, MW_STALE_KEY)) await stateSet(env, MW_STALE_KEY, "").run();
    return { stale: false, hours, at };
  }
  /* 1日1回まで。 */
  const last = await stateGet(env, MW_STALE_KEY);
  const lastMs = last ? (Date.now() - new Date(last).getTime()) : Infinity;
  if (lastMs >= 24 * 3600000) {
    await notify(env, run,
      "⏰ **MW の在庫CSVを取り込んでください**\n"
      + (at ? ("最後の取り込みは " + jstText(at) + "（" + hours + "時間前）です。")
            : "まだ一度も取り込んでいません。")
      + "\n取り込まないと **MW の欠品が分からず、売り越し**になります。"
      + "\n出品CSVタブの「MWの在庫CSVを取り込む」から入れてください。");
    await stateSet(env, MW_STALE_KEY, nowIso()).run();
  }
  return { stale: true, hours, at };
}

/* ===== 売れたら「MW に注文してください」（7.72）=====
   W- の SKU の注文が入ったら、MW に注文する材料を Discord に出す。
   商品名・JAN・社・卸値・出荷日・注文の期限（ハンドリングから逆算）。 */
async function mwOrderNotify(env, run, sold) {
  const list = [];
  for (const x of (sold || [])) {
    const jan = mwJanOfSku(x.sku);
    if (jan) list.push({ jan, sku: x.sku, qty: Number(x.qty) || 1,
                         at: x.orderedAt || "" });
  }
  if (!list.length) return 0;
  const jans = list.map((x) => x.jan);
  const by = {};
  const step = d1Step(1);
  for (let i = 0; i < jans.length; i += step) {
    const part = jans.slice(i, i + step);
    const q = await env.DB.prepare(
      `SELECT jan, sha, name, wholesale, stock, ship_text, ship_days, gone_at
         FROM mw_stock WHERE pick=1 AND jan IN (${part.map(() => "?").join(",")})`)
      .bind(...part).all();
    for (const r of (q && q.results) || []) by[r.jan] = r;
  }
  const t = ["🛒 **MW に注文してください**"];
  for (const x of list) {
    const m = by[x.jan];
    if (!m) {
      t.push("・JAN " + x.jan + "（MW の在庫に見つかりません。欠品の可能性）");
      continue;
    }
    /* 注文の期限：eBay のハンドリング日数から、MW の出荷日数＋配達1〜2日を引く。
       ここでは「売れた日＋（ハンドリング − 出荷日数 − 2）」を目安に出す。 */
    const hand = Number(x.hand) || MW_HAND_DEFAULT;
    const days = Math.max(0, hand - (Number(m.ship_days) || 0) - 2);
    const base = x.at ? new Date(x.at) : new Date();
    const due = new Date(base.getTime() + days * 86400000);
    t.push("・" + String(m.name || "").slice(0, 50)
      + "\n　JAN " + x.jan + "　社 **" + String(m.sha || "") + "**"
      + "　卸値 ¥" + (Number(m.wholesale) || 0).toLocaleString("ja-JP") + "（税抜）"
      + "　数量 " + x.qty
      + "\n　MW出荷 " + (Number(m.ship_days) || 0) + "営業日"
      + (m.ship_text ? "（" + String(m.ship_text).slice(0, 24) + "）" : "")
      + "　MW在庫 " + (Number(m.stock) || 0) + "点"
      + "\n　**注文の期限 " + jstDate10(due.toISOString()) + "**"
      + (m.gone_at ? "　⚠ MW で欠品しています" : ""));
  }
  t.push("注文したら2週間の取り置きになります。出荷時に銀行振込で決済してください。");
  await notify(env, run, t.join("\n"));
  return list.length;
}
const MW_HAND_DEFAULT = 10;        // MW用ポリシーのハンドリング日数の既定
/* 日本時間の日付（YYYY-MM-DD）。jstText は時刻まで出すので、期限用に日付だけ。 */
function jstDate10(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

/* ===== 国内FBA：出品の可否（7.76）=====
   getListingsRestrictions（Listings Restrictions API）で、ASIN ごとに
   「出品できる／許可が要る（申請リンク）／出品できない」を調べる。

   ・必要なロールは **Product Listing**。searchCatalogItems（7.66）と同じなので、
     いま動いている認可のままで使える（ロールを足すとトークンを3か所
     入れ替えることになるので、増やさないのが大事）
   ・上限は **5回/秒**（アカウント×アプリ）・バースト10。1回で ASIN 1件
   ・取れた答えは控えて、ふだんは **30日**たつまで調べ直さない。
     ただし「許可が要る」「出品できない」は **7日**（許可が下りたら早く気づく） */
const MW_RST_GAP_MS = 250;         // 5回/秒の上限に余裕をみて4回/秒
const MW_RST_MAX = 400;            // 1回に調べる件数の上限
const MW_RST_DEADLINE_MS = 60000;  // 1回の実行で使う時間の上限
/* 失敗が続いたら止める件数（全件失敗で無駄に呼び続けないため・7.78）。 */
const MW_RST_FAIL_STOP = 5;
const MW_RST_TTL_D = 30;           // 「出品できる」を調べ直さない日数
const MW_RST_BAD_TTL_D = 7;        // 「許可が要る」「出品できない」を調べ直す日数
const MW_RST_COND = "new_new";     // 新品（MW は新品だけ）
/* 返りを3つに分ける。申請リンクがあれば「許可が要る」。 */
function mwRstPick(d) {
  const list = (d && d.restrictions) || [];
  if (!list.length) return { state: "ok", reasons: "", link: "" };
  const why = [], links = [];
  let approval = false;
  for (const r of list) {
    for (const x of (r.reasons || [])) {
      const msg = String(x.message || "").trim();
      if (msg) why.push(msg);
      const code = String(x.reasonCode || "");
      if (code === "APPROVAL_REQUIRED") approval = true;
      for (const l of (x.links || [])) {
        const u = String(l.resource || "").trim();
        if (u) links.push(u);
      }
    }
  }
  /* 申請リンクがあるなら、文面に関わらず「許可が要る」。
     リンクが無く理由だけのときは「出品できない」。 */
  const link = links[0] || "";
  return { state: (approval || link) ? "approval" : "blocked",
           reasons: why.join(" / ").slice(0, 300), link: link.slice(0, 500) };
}
/* 出品者トークン（Seller Central の「出品者トークン」）。
   getListingsRestrictions は **sellerId が必須**。入れずに呼ぶと全件 HTTP 400
   になる（v196 で 158件すべて失敗した原因）。
   自動で引ける API が無いので ⚙ ではなく Worker の値として持つ：
     npx wrangler secret put SP_SELLER_ID */
function spSellerId(env) { return String((env && env.SP_SELLER_ID) || "").trim(); }
async function mwRstOne(env, run, asin) {
  const q = new URLSearchParams({ asin: String(asin), sellerId: spSellerId(env),
                                  marketplaceIds: MP_FE,
                                  conditionType: MW_RST_COND });
  const r = await spCall(env, run, "/listings/2021-08-01/restrictions?" + q.toString(),
                         { label: "getListingsRestrictions" });
  /* 失敗の理由は HTTP の番号と Amazon のエラーコードを残す。
     「restrictions_400」だけでは次に同じことが起きたとき切り分けられない。 */
  if (!r.ok)
    return { ok: false, status: r.status,
             err: ("HTTP " + r.status + " " + String(r.err || "")).trim().slice(0, 300) };
  return Object.assign({ ok: true }, mwRstPick(r.data));
}
/* ---- POST /mw/restrict ----
   候補（代表・絞り込みに当てはまる行）のうち ASIN が分かっていて、
   まだ調べていない／古いものを古い順に調べる。 */
async function mwRestrictRun(env, body, opt) {
  /* opt.run を渡すと「段」として動く（自分の記録を作らず、呼んだ側の記録に足す）。
     opt.deadline を渡すと、その時刻で切る（7.79 の60秒の割り振り）。 */
  const o2 = opt || {};
  const run = o2.run || newRun("mw-restrict");
  const res = { ok: false, asked: 0, done: 0, ok_n: 0, approval: 0, blocked: 0,
                failed: 0, left: 0, limit: 0, calls: 0, stopped: "", rows: [],
                fails: [], why: "" };
  /* 段として呼ばれたときは記録を閉じない（呼んだ側が閉じる）。 */
  const fin = async () => (o2.run ? res : Object.assign(await saveRun(env, run), res));
  try {
    const o = body || {};
    const limit = Math.max(1, Math.min(MW_RST_MAX, mwNum(o.limit) || MW_RST_MAX));
    res.limit = limit;
    /* 出品者トークンが無ければ **1回も呼ばない**（全件 HTTP 400 になるだけ）。 */
    if (!spSellerId(env)) {
      res.stopped = "no_seller_id";
      res.why = "出品者トークン（SP_SELLER_ID）が入っていません。"
        + "pj-sync に npx wrangler secret put SP_SELLER_ID で入れてください"
        + "（Seller Central → 設定 → 出品用アカウント情報 → 出品者トークン）。";
      run.notes.push("出品の可否：" + res.why);
      res.ok = true;
      return await fin();
    }
    const q = mwWhere(o);
    /* mw_stock の列だと決めておく。cond は mw_restrict にもあるので、
       修飾しないと「あいまいな列名」で落ちる（mwAmzList と同じ処理）。 */
    const w = q.w.replace(/\b(gone_at|pick|kishu|cond|ship_days|stock|note)\b/g, "s.$1");
    const okOld = new Date(Date.now() - MW_RST_TTL_D * 86400000).toISOString();
    const badOld = new Date(Date.now() - MW_RST_BAD_TTL_D * 86400000).toISOString();
    /* ⚠ ここは **番号付きの ?N を使わない**。
       mwWhere() が出す WHERE には素の `?` が入っている。SQLite は素の `?` に
       「それまでに出た最大の番号＋1」を割り当てるので、文の**前**に ?2 を書くと
       素の `?` が ?3 になり、値が1つずれて何も当たらなくなる（実際に起きた）。
       素の `?` だけにして、**文に出てくる順**で渡す。 */
    const pick = await env.DB.prepare(
      `SELECT a.asin AS asin, r.checked_at AS checked_at
         FROM mw_stock s
         JOIN mw_amz a ON a.jan = s.jan AND COALESCE(a.asin,'')<>''
         LEFT JOIN mw_restrict r ON r.asin = a.asin AND r.cond = ?
        WHERE ${w}
          AND (r.checked_at IS NULL
               OR (r.state='ok' AND r.checked_at < ?)
               OR (COALESCE(r.state,'')<>'ok' AND r.checked_at < ?))
        GROUP BY a.asin
        ORDER BY (CASE WHEN COALESCE(MAX(r.err),'')<>'' THEN 1 ELSE 0 END) ASC,
                 COALESCE(MAX(r.checked_at),'') ASC, a.asin ASC`)
      .bind(MW_RST_COND, ...q.bind, okOld, badOld).all();
    const all = ((pick && pick.results) || []).map((x) => String(x.asin));
    res.asked = all.length;
    const dl = o2.deadline || (Date.now() + MW_RST_DEADLINE_MS);
    const stmts = [];
    let runFail = 0;                    // 続けて失敗した回数
    for (const asin of all) {
      if (res.done >= limit) { res.stopped = "limit"; break; }
      if (Date.now() > dl) { res.stopped = "time"; break; }
      if (res.done) await sleep(MW_RST_GAP_MS);
      const g = await mwRstOne(env, run, asin);
      res.done++; res.calls++;
      const at = nowIso();
      if (!g.ok) {
        res.failed++;
        runFail++;
        if (res.fails.length < 3) res.fails.push({ asin: asin, err: g.err });
        stmts.push(env.DB.prepare(
          /* 失敗したときは checked_at を**動かさない**（新しい行は NULL のまま）。
             ここを今の時刻で埋めると、state が NULL のため下の3つの条件
             すべてに当たらず、その行が二度と調べ直されなくなる。
             失敗した行は上の ORDER BY で**最後**に回す。先頭に置くと、
             503 で止まる1件が毎回いちばん先に当たり、残りが永久に進まない。 */
          `INSERT INTO mw_restrict (asin,cond,state,reasons,link,err,checked_at,created_at)
             VALUES (?1,?2,NULL,'','',?3,NULL,?4)
           ON CONFLICT(asin,cond) DO UPDATE SET err=excluded.err`)
          .bind(asin, MW_RST_COND, String(g.err), at));
        if (/^HTTP (429|500|503)\b/.test(String(g.err))) { res.stopped = "amazon"; break; }
        /* 続けて失敗するなら、残りを呼んでも同じなので止める（7.78）。 */
        if (runFail >= MW_RST_FAIL_STOP) {
          res.stopped = "fail";
          res.why = "失敗が" + runFail + "件続いたので止めました（" + String(g.err) + "）";
          break;
        }
        continue;
      }
      runFail = 0;                      // 1件でも通れば数え直す
      if (g.state === "ok") res.ok_n++;
      else if (g.state === "approval") res.approval++;
      else res.blocked++;
      res.rows.push({ asin, state: g.state, reasons: g.reasons.slice(0, 80),
                      link: g.link });
      stmts.push(env.DB.prepare(
        `INSERT INTO mw_restrict (asin,cond,state,reasons,link,err,checked_at,created_at)
           VALUES (?1,?2,?3,?4,?5,'',?6,?6)
         ON CONFLICT(asin,cond) DO UPDATE SET state=excluded.state,
           reasons=excluded.reasons, link=excluded.link, err='',
           checked_at=excluded.checked_at`)
        .bind(asin, MW_RST_COND, g.state, g.reasons, g.link, at));
    }
    await runBatch(env, run, stmts);
    res.left = Math.max(0, res.asked - res.done);
    if (!o2.run) await env.DB.prepare(
      `INSERT INTO mw_rst_runs (at,asked,done,ok_n,approval,blocked,failed,
         left_n,calls,note,created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?1)`)
      .bind(nowIso(), res.asked, res.done, res.ok_n, res.approval, res.blocked,
            res.failed, res.left, res.calls,
            ("止まった理由 " + (res.stopped || "すべて")).slice(0, 300)).run();
    run.notes.push("出品の可否：出せる " + res.ok_n + "／許可が要る " + res.approval
      + "／出せない " + res.blocked + "／失敗 " + res.failed + "／残り " + res.left
      + (res.why ? ("　" + res.why) : "")
      + (res.fails.length ? ("　理由 " + res.fails[0].err) : ""));
    res.ok = true;
  } catch (e) {
    run.errors++; run.notes.push("mw-restrict: " + String((e && e.message) || e));
    res.error = String((e && e.message) || e);
  }
  return await fin();
}

/* ===== 仕入れの印（7.68）=====
   端末をまたいで同じ印が見えるよう D1 に置く。
   **作業者（STAFF_KEY）でも付けられる**（仕入れの候補を選ぶ仕事なので）。
   お金を動かす操作ではなく、印と数量だけ。 */
const MW_BUY_MAX_QTY = 99;
async function mwBuyPut(env, body, role) {
  const run = newRun("mw-buy");
  const res = { ok: false, n: 0, rows: [] };
  try {
    const o = body || {};
    const list = Array.isArray(o.items) ? o.items
      : [{ jan: o.jan, qty: o.qty }];
    const stmts = [];
    const at = nowIso();
    for (const x of list.slice(0, 200)) {
      const jan = String((x && x.jan) || "").replace(/\D/g, "");
      if (!janOk(jan)) continue;
      const qty = Math.max(0, Math.min(MW_BUY_MAX_QTY, mwNum(x && x.qty)));
      if (qty <= 0) {
        stmts.push(env.DB.prepare(`DELETE FROM mw_buy WHERE jan=?1`).bind(jan));
      } else {
        stmts.push(env.DB.prepare(
          `INSERT INTO mw_buy (jan,qty,by_role,note,at,created_at)
             VALUES (?1,?2,?3,?4,?5,?5)
           ON CONFLICT(jan) DO UPDATE SET qty=excluded.qty,
             by_role=excluded.by_role, note=excluded.note, at=excluded.at`)
          .bind(jan, qty, String(role || ""), String((x && x.note) || "").slice(0, 200), at));
      }
      res.n++;
      res.rows.push({ jan, qty });
    }
    await runBatch(env, run, stmts);
    res.ok = true;
    run.notes.push("MW仕入れの印：" + res.n + "件");
  } catch (e) {
    run.errors++; run.notes.push("mw-buy: " + String((e && e.message) || e));
    res.error = String((e && e.message) || e);
  }
  return Object.assign(await saveRun(env, run), res);
}
/* GET /mw/buy … 印が付いている行を、MW と Amazon の中身つきで返す（注文用）。 */
async function mwBuyList(env, url) {
  const q = await env.DB.prepare(
    `SELECT b.jan AS jan, b.qty AS qty, b.by_role AS by_role, b.at AS at,
            s.sha AS sha, s.kishu AS kishu, s.name AS mw_name,
            s.list_price AS list_price, s.wholesale AS wholesale,
            s.stock AS stock, s.note AS note, s.ship_text AS ship_text,
            s.ship_days AS ship_days, s.cond AS cond, s.gone_at AS gone_at,
            a.asin AS asin, a.name AS amz_name, a.price AS price,
            a.basis AS basis, a.rank AS rank, a.rank_cat AS rank_cat,
            a.new_n AS new_n, a.amz AS amz,
            r.state AS rst, r.reasons AS rst_why, r.link AS rst_link,
            r.checked_at AS rst_at, r.err AS rst_err
       FROM mw_buy b
       LEFT JOIN mw_stock s ON s.jan = b.jan AND s.pick = 1
       LEFT JOIN mw_amz   a ON a.jan = b.jan
       LEFT JOIN mw_restrict r ON r.asin = a.asin AND r.cond = 'new_new'
      ORDER BY b.at DESC`).all();
  const rows = (q && q.results) || [];
  /* 卸値（税込）の合計。送料無料（5万円）までの残りは画面で出す。 */
  let yen = 0, n = 0;
  for (const r of rows) {
    const w = Number(r.wholesale) || 0;
    n += Number(r.qty) || 0;
    yen += Math.round(w * 1.1) * (Number(r.qty) || 0);
  }
  return { ok: true, rows, n: rows.length, qty: n, yen,
           gone: rows.filter((r) => r.gone_at).length };
}

/* ===== Amazon に登録した SKU を控える（7.77）=====
   アップロード用ファイルを作ったときに、画面から送る。
   ・仕入れ元（buy_src）… MW から仕入れた分は 'mw'。接頭辞からも分かるが、
     あとの利益計算で素早く分けられるよう列にも持つ。
   ・社（mw_sha）・JAN（jan）・仕入値（cost_src＝卸値×1.1＋1点あたりの仕入送料）
     は、登録したときにしか分からないのでここで控える。
   ・items には触らない（eBay の出品とは別の話）。 */
const MW_REG_MAX = 500;
async function mwRegSave(env, body) {
  const run = newRun("mw-reg");
  const res = { ok: false, saved: 0, skipped: 0, rows: [] };
  try {
    const list = Array.isArray(body && body.rows) ? body.rows.slice(0, MW_REG_MAX) : [];
    const stmts = [];
    const at = nowIso();
    for (const x of list) {
      const sku = String((x && x.sku) || "").trim();
      const p = parseSku(sku);
      if (!p.ok) { res.skipped++; res.rows.push({ sku, why: "SKU の形が違います" }); continue; }
      const jan = String((x && x.jan) || "").trim();
      const sha = String((x && x.sha) || "").trim();
      /* 仕入値は画面で出した額をそのまま控える（卸値×1.1＋仕入送料）。
         ⚙の送料が変わっても、仕入れたときの額を残したいので再計算しない。 */
      const costSrc = Number((x && x.cost_src) || 0) || null;
      stmts.push(env.DB.prepare(
        `INSERT INTO skus (seller_sku, asin, cond, cond_code, prefix, scope,
           purchased_on, cost, title, active, updated_at,
           buy_src, jan, mw_sha, cost_src)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10,?11,?12,?13,?14)
         ON CONFLICT(seller_sku) DO UPDATE SET
           title=COALESCE(NULLIF(excluded.title,''), skus.title),
           buy_src=excluded.buy_src,
           jan=COALESCE(NULLIF(excluded.jan,''), skus.jan),
           mw_sha=COALESCE(NULLIF(excluded.mw_sha,''), skus.mw_sha),
           cost_src=COALESCE(excluded.cost_src, skus.cost_src),
           updated_at=excluded.updated_at`)
        .bind(sku, p.asin, p.cond, p.condCode, p.prefix, p.scope,
              p.purchasedOn, p.cost, String((x && x.title) || "").slice(0, 300), at,
              skuSrcOf(p.prefix), jan, sha, costSrc));
      res.saved++;
      res.rows.push({ sku, asin: p.asin, jan, src: skuSrcOf(p.prefix) });
    }
    await runBatch(env, run, stmts);
    run.notes.push("Amazon登録の控え：" + res.saved + "件（形が違う " + res.skipped + "件）");
    res.ok = true;
  } catch (e) {
    run.errors++; run.notes.push("mw-reg: " + String((e && e.message) || e));
    res.error = String((e && e.message) || e);
  }
  return Object.assign(await saveRun(env, run), res);
}

/* ---- GET /mw/amz ----
   候補＋MW の中身＋Amazon の事実をまとめて返す。利益は画面で計算する。 */
async function mwAmzList(env, url) {
  const p = url.searchParams;
  const q0 = mwWhere({ kishu: p.get("kishu"), new_only: p.get("new_only"),
                       ship_max: p.get("ship_max"), stock_min: p.get("stock_min"),
                       note_ng: p.get("note_ng"), note_all: p.get("note_all") });
  const limit = Math.max(1, Math.min(3000, mwNum(p.get("limit")) || 2000));
  const w = q0.w.replace(/\b(gone_at|pick|kishu|cond|ship_days|stock|note)\b/g, "s.$1");
  const only = p.get("priced") === "1" ? " AND COALESCE(a.price,0)>0" : "";
  const q = await env.DB.prepare(
    `SELECT s.jan AS jan, s.sha AS sha, s.kishu AS kishu, s.name AS mw_name,
            s.list_price AS list_price, s.cond AS cond, s.wholesale AS wholesale,
            s.stock AS stock, s.note AS note, s.ship_text AS ship_text,
            s.ship_days AS ship_days,
            a.asin AS asin, a.name AS amz_name, a.rank AS rank,
            a.rank_cat AS rank_cat, a.price AS price, a.basis AS basis,
            a.low AS low, a.buybox AS buybox, a.new_n AS new_n, a.low_n AS low_n,
            a.amz AS amz, a.fba_n AS fba_n, a.err AS amz_err,
            a.checked_at AS amz_at,
            COALESCE(b.qty,0) AS buy_qty,
            r.state AS rst, r.reasons AS rst_why, r.link AS rst_link,
            r.checked_at AS rst_at, r.err AS rst_err
       FROM mw_stock s LEFT JOIN mw_amz a ON a.jan = s.jan
            LEFT JOIN mw_buy b ON b.jan = s.jan
            LEFT JOIN mw_restrict r ON r.asin = a.asin AND r.cond = 'new_new'
      WHERE ${w}${only}
      ORDER BY COALESCE(a.price,0) DESC LIMIT ${limit}`).bind(...q0.bind).all();
  const n = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mw_stock s WHERE ${w}`).bind(...q0.bind).first();
  const seen = await env.DB.prepare(
    `SELECT COUNT(a.jan) AS n,
            SUM(CASE WHEN COALESCE(a.price,0)>0 THEN 1 ELSE 0 END) AS priced
       FROM mw_stock s JOIN mw_amz a ON a.jan = s.jan WHERE ${w}`)
    .bind(...q0.bind).first();
  const last = await env.DB.prepare(
    `SELECT at,asked,done,asin_ok,asin_ng,priced,none,left_n,calls_cat,calls_prc
       FROM mw_amz_runs ORDER BY id DESC LIMIT 1`).first();
  return { ok: true, n: Number((n && n.n) || 0), rows: (q && q.results) || [],
           seen: Number((seen && seen.n) || 0),
           priced: Number((seen && seen.priced) || 0),
           left: Math.max(0, Number((n && n.n) || 0) - Number((seen && seen.n) || 0)),
           per_run: MW_AMZ_MAX, ttl_days: MW_AMZ_TTL_D,
           last: last ? Object.assign({}, last, { at_jst: jstText(last.at) }) : null,
           limit };
}

/* ---- 候補の絞り込み（4章の1〜4）。一覧と相場の取得で同じ条件を使う ----
   返す w には **素の `?`** が入る（機種の IN）。番号付きの ?N と混ぜると
   SQLite の番号割り当てがずれるので、呼ぶ側は素の `?` だけで組むか、
   WHERE より**後ろ**に ?N を置くこと（7.76 で踏んだ）。 */
function mwWhere(opt) {
  const o = opt || {};
  const kishu = (Array.isArray(o.kishu) ? o.kishu : String(o.kishu || "").split(","))
    .map((x) => String(x).trim()).filter(Boolean).slice(0, d1Step(1));
  const newOnly = o.new_only !== 0 && o.new_only !== "0" && o.new_only !== false;
  const shipMax = Math.max(0, Math.min(99, mwNum(o.ship_max) || MW_SHIP_OK));
  /* MW在庫の下限（既定5点）。手で取り込む間に売り切れるのを防ぐため、
     1〜2点の商品は無在庫にしない（7.74）。 */
  const stockMin = Math.max(1, mwNum(o.stock_min) || MW_STOCK_MIN);
  const where = ["gone_at IS NULL", "pick=1"];
  const bind = [];
  if (kishu.length) {
    where.push("kishu IN (" + kishu.map(() => "?").join(",") + ")");
    for (const k of kishu) bind.push(k);
  }
  if (newOnly) where.push("cond='新品'");
  where.push("COALESCE(ship_days,99)<=" + shipMax);
  where.push("COALESCE(stock,0)>=" + stockMin);
  /* 備考に注意する言葉（ダメージ・引き上げ など）が入っている行を外す（7.64）。
     言葉の一覧は画面の⚙設定から来る。note_all=1 のときは外さない。
     言葉に % や _ が入っても文字として扱えるよう ESCAPE を付ける。 */
  const ngWords = (Array.isArray(o.note_ng) ? o.note_ng
      : String(o.note_ng || "").split(","))
    .map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
  const noteAll = o.note_all === 1 || o.note_all === "1" || o.note_all === true;
  if (!noteAll && ngWords.length) {
    for (const g of ngWords) {
      where.push("COALESCE(note,'') NOT LIKE ? ESCAPE '\\'");
      bind.push("%" + g.replace(/[\\%_]/g, "\\$&") + "%");
    }
  }
  return { w: where.join(" AND "), bind, kishu, newOnly, shipMax, stockMin,
           ngWords, noteAll };
}

/* ---- eBay の相場を1件引く（4章の6・7.62）----
   JAN（GTIN）で Browse API を検索し、**即決の出品**の最安値を送料込みで出す。
   ・新品の最安値（low）と、状態を問わない最安値（low_any）を1回の検索で両方出す
   ・送料が分からない出品は本体だけで数える（印に no_ship=1 を立てる）。
     総額を低めに見るので、115%の判定は厳しい側に出る
   ・競売（オークション）は値段が動くので入れない */
function mwMktPick(d) {
  const out = { n: 0, n_new: 0, low: null, low_item: null, low_ship: null,
                low_any: null, cur: "", title: "", item_id: "", item_url: "",
                no_ship: 0 };
  const list = (d && d.itemSummaries) || [];
  out.n = Number((d && d.total) || list.length) || 0;
  for (const x of list) {
    const p = Number(((x.price) || {}).value);
    if (!isFinite(p) || p <= 0) continue;
    const so = (x.shippingOptions || [])[0];
    const sc = so && so.shippingCost ? Number(so.shippingCost.value) : NaN;
    const ship = isFinite(sc) ? sc : 0;
    if (!isFinite(sc)) out.no_ship = 1;
    const tot = Math.round((p + ship) * 100) / 100;
    if (out.low_any === null || tot < out.low_any) out.low_any = tot;
    const isNew = String(x.condition || "") === "New"
      || String(x.conditionId || "") === "1000";
    if (!isNew) continue;
    out.n_new++;
    if (out.low === null || tot < out.low) {
      out.low = tot; out.low_item = p; out.low_ship = ship;
      out.cur = String(((x.price) || {}).currency || "");
      out.title = String(x.title || "").slice(0, 200);
      out.item_id = String(x.itemId || "");
      out.item_url = String(x.itemWebUrl || "").slice(0, 300);
    }
  }
  return out;
}
async function mwMktOne(env, run, jan) {
  const g = String(jan || "").replace(/\D/g, "");
  if (g.length !== 13) return { ok: false, err: "bad_gtin" };
  const a = await ebayAppToken(env, run, EBAY_BASE_SCOPE);
  if (!a.ok) return { ok: false, err: "token_" + (a.status || "") };
  const q = new URLSearchParams({ gtin: g, limit: String(MW_MKT_PAGE),
    sort: "price", filter: "buyingOptions:{FIXED_PRICE}" });
  const r = await net(run, EBAY_API + "/buy/browse/v1/item_summary/search?" + q.toString(),
    { headers: { authorization: "Bearer " + a.token, accept: "application/json",
                 "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" } });
  const t = await r.text();
  if (!r.ok) {
    run.errors++;
    return { ok: false, err: "browse_" + r.status, body: t.slice(0, 200) };
  }
  run.pages++;
  let d = {}; try { d = JSON.parse(t); } catch (e) { d = {}; }
  return Object.assign({ ok: true }, mwMktPick(d));
}
/* ---- POST /mw/market ----
   候補のうち、相場をまだ見ていない／7日より古いものを古い順に引く。
   1回の上限と時間の上限で必ず止まり、残りは left で返す（押すたびに進む）。 */
async function mwMarketRun(env, body) {
  const run = newRun("mw-market");
  const res = { ok: false, asked: 0, done: 0, hit: 0, none: 0, failed: 0,
                left: 0, limit: 0, calls: 0, stopped: "", rows: [] };
  try {
    const o = body || {};
    const limit = Math.max(1, Math.min(MW_MKT_HARD, mwNum(o.limit) || MW_MKT_MAX));
    res.limit = limit;
    const q = mwWhere(o);
    const okOld = new Date(Date.now() - MW_MKT_TTL_D * 86400000).toISOString();
    const errOld = new Date(Date.now() - MW_MKT_ERR_TTL_H * 3600000).toISOString();
    /* 代表の JAN のうち、控えが無い／古いものだけ。古い順（NULL が先）。 */
    const pick = await env.DB.prepare(
      `SELECT s.jan AS jan, m.checked_at AS checked_at
         FROM mw_stock s LEFT JOIN mw_market m ON m.jan = s.jan
        WHERE ${q.w}
          AND (m.checked_at IS NULL
               OR (COALESCE(m.err,'')='' AND m.checked_at < ?${q.bind.length + 1})
               OR (COALESCE(m.err,'')<>'' AND m.checked_at < ?${q.bind.length + 2}))
        ORDER BY COALESCE(m.checked_at,'') ASC, s.jan ASC`)
      .bind(...q.bind, okOld, errOld).all();
    const all = (pick && pick.results) || [];
    res.asked = all.length;
    const t0 = Date.now();
    const stmts = [];
    for (const row of all) {
      if (res.done >= limit) { res.stopped = "limit"; break; }
      if (Date.now() - t0 > MW_MKT_DEADLINE_MS) { res.stopped = "time"; break; }
      if (res.done) await sleep(MW_MKT_GAP_MS);
      const g = await mwMktOne(env, run, row.jan);
      res.done++; res.calls++;
      const at = nowIso();
      if (!g.ok) {
        res.failed++;
        stmts.push(env.DB.prepare(
          `INSERT INTO mw_market (jan,err,checked_at,created_at)
             VALUES (?1,?2,?3,?3)
           ON CONFLICT(jan) DO UPDATE SET err=excluded.err,
             checked_at=excluded.checked_at`).bind(row.jan, String(g.err), at));
        if (/^browse_(429|500|503)/.test(String(g.err))) { res.stopped = "ebay"; break; }
        continue;
      }
      if (g.n > 0) res.hit++; else res.none++;
      res.rows.push({ jan: row.jan, n: g.n, n_new: g.n_new, low: g.low,
                      low_any: g.low_any, title: g.title });
      stmts.push(env.DB.prepare(
        `INSERT INTO mw_market (jan,n,n_new,low,low_item,low_ship,low_any,cur,
           title,item_id,item_url,no_ship,err,checked_at,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'',?13,?13)
         ON CONFLICT(jan) DO UPDATE SET n=excluded.n, n_new=excluded.n_new,
           low=excluded.low, low_item=excluded.low_item, low_ship=excluded.low_ship,
           low_any=excluded.low_any, cur=excluded.cur, title=excluded.title,
           item_id=excluded.item_id, item_url=excluded.item_url,
           no_ship=excluded.no_ship, err='', checked_at=excluded.checked_at`)
        .bind(row.jan, g.n, g.n_new, g.low, g.low_item, g.low_ship, g.low_any,
              g.cur, g.title, g.item_id, g.item_url, g.no_ship, at));
    }
    await runBatch(env, run, stmts);
    res.left = Math.max(0, res.asked - res.done);
    await env.DB.prepare(
      `INSERT INTO mw_mkt_runs (at,asked,done,hit,none,failed,left_n,note,created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?1)`)
      .bind(nowIso(), res.asked, res.done, res.hit, res.none, res.failed, res.left,
            ("止まった理由 " + (res.stopped || "すべて")).slice(0, 300)).run();
    run.notes.push("MW相場：調べた " + res.done + "件／相場あり " + res.hit
      + "／相場なし " + res.none + "／失敗 " + res.failed + "／残り " + res.left);
    res.ok = true;
  } catch (e) {
    run.errors++; run.notes.push("mw-market: " + String((e && e.message) || e));
    res.error = String((e && e.message) || e);
  }
  return Object.assign(await saveRun(env, run), res);
}

async function mwList(env, url) {
  const p = url.searchParams;
  const q0 = mwWhere({ kishu: p.get("kishu"), new_only: p.get("new_only"),
                       ship_max: p.get("ship_max"), stock_min: p.get("stock_min"),
                       note_ng: p.get("note_ng"), note_all: p.get("note_all") });
  const limit = Math.max(1, Math.min(MW_LIST_MAX, mwNum(p.get("limit")) || 200));
  const w = q0.w.replace(/\b(gone_at|pick|kishu|cond|ship_days|stock|note)\b/g, "s.$1");
  const bind = q0.bind;
  /* 相場（7.62）を一緒に返す。まだ調べていない JAN は null で返る。 */
  const q = await env.DB.prepare(
    `SELECT s.jan AS jan, s.sha AS sha, s.idx AS idx, s.kishu AS kishu,
            s.name AS name, s.list_price AS list_price, s.release AS release,
            s.cond AS cond, s.wholesale AS wholesale, s.stock AS stock,
            s.note AS note, s.ship_text AS ship_text, s.ship_days AS ship_days,
            s.seen_at AS seen_at,
            m.n AS mkt_n, m.n_new AS mkt_n_new, m.low AS mkt_low,
            m.low_any AS mkt_low_any, m.low_ship AS mkt_ship, m.cur AS mkt_cur,
            m.item_url AS mkt_url, m.no_ship AS mkt_no_ship,
            m.err AS mkt_err, m.checked_at AS mkt_at,
            (SELECT COUNT(*) FROM mw_img g WHERE g.jan=s.jan AND g.ok=1) AS pics_ok
       FROM mw_stock s LEFT JOIN mw_market m ON m.jan = s.jan
      WHERE ${w}
      ORDER BY COALESCE(s.wholesale,0) ASC LIMIT ${limit}`).bind(...bind).all();
  const n = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mw_stock s WHERE ${w}`).bind(...bind).first();
  /* 相場の進み具合（調べ終わった件数・残り）。 */
  const mk = await env.DB.prepare(
    `SELECT COUNT(m.jan) AS seen,
            SUM(CASE WHEN COALESCE(m.err,'')='' AND COALESCE(m.n,0)>0 THEN 1 ELSE 0 END) AS hit,
            SUM(CASE WHEN COALESCE(m.err,'')='' AND COALESCE(m.n,0)=0 THEN 1 ELSE 0 END) AS none
       FROM mw_stock s JOIN mw_market m ON m.jan = s.jan
      WHERE ${w}`).bind(...bind).first();
  const all = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mw_stock WHERE gone_at IS NULL`).first();
  const pick = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mw_stock WHERE gone_at IS NULL AND pick=1`).first();
  const last = await env.DB.prepare(
    `SELECT at,rows_in,added,changed,same,gone,back,picked,unreadable,warn
       FROM mw_runs ORDER BY id DESC LIMIT 1`).first();
  return { ok: true, n: Number((n && n.n) || 0), rows: (q && q.results) || [],
           stale_h: MW_STALE_H,
           mkt: { seen: Number((mk && mk.seen) || 0), hit: Number((mk && mk.hit) || 0),
                  none: Number((mk && mk.none) || 0),
                  left: Math.max(0, Number((n && n.n) || 0) - Number((mk && mk.seen) || 0)),
                  over: MW_OVER, ttl_days: MW_MKT_TTL_D, per_run: MW_MKT_MAX },
           alive: Number((all && all.n) || 0),
           picked: Number((pick && pick.n) || 0),
           last: last ? Object.assign({}, last, { at_jst: jstText(last.at) }) : null,
           limit: limit };
}
/* ===== MW の商品画像（6.1 の①・7.63）=====
   貼られた「MW の商品ID」または「画像URL」から画像を取り、**大きさだけ測る**。
   取った画像は画面に返して、画面が今までの口（pj-img の POST /upload）で
   R2 に控える。こうすると pj-sync に新しい合言葉を置かずに済む。
   ・使うのは MW の画像だけ。Amazon の画像は使わない
   ・会員サイト（/buy/?q=）は見に行かない。ALLOWED も products/….jpg の1本だけ
   ・長辺が500px未満の画像は eBay が受け取らないので「使えません」として返す */
/* バイト列を base64 にする（画面が pj-img に上げるため）。
   Workers の btoa は文字列しか受け取れないので、8KBずつ文字にしてから渡す。 */
function toB64(buf) {
  const b = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < b.length; i += 8192)
    bin += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return btoa(bin);
}
async function mwImgOne(env, run, jan, pos, text, want) {
  const r = { jan: jan, pos: pos, mw_id: "", src: "", w: 0, h: 0, long: 0,
              bytes: 0, ct: "", ok: false, err: "" };
  const id = mwImgId(text);
  if (!id) { r.err = "商品IDか画像URLの形ではありません"; return r; }
  r.mw_id = String(id);
  r.src = mwImgUrl(id);
  if (!r.src) { r.err = "画像URLを作れませんでした"; return r; }
  let resp;
  try {
    resp = await net(run, r.src, { method: "GET", redirect: "manual" });
  } catch (e) {
    run.errors++; r.err = "取りに行けませんでした: " + String((e && e.message) || e);
    return r;
  }
  if (!resp.ok) {
    r.err = (resp.status === 404) ? "その商品IDの画像がありません（404）"
                                  : ("取れませんでした（" + resp.status + "）");
    return r;
  }
  const ct = String(resp.headers.get("content-type") || "").split(";")[0].trim();
  r.ct = ct || "image/jpeg";
  const buf = await resp.arrayBuffer();
  r.bytes = buf.byteLength;
  if (!r.bytes) { r.err = "中身が空でした"; return r; }
  if (r.bytes > MW_IMG_BYTES) { r.err = "大きすぎます（5MBまで）"; return r; }
  const sz = imageSize(buf);
  r.w = Number(sz.w) || 0; r.h = Number(sz.h) || 0;
  r.long = Math.max(r.w, r.h);
  if (!r.long) { r.err = "画像の大きさが読めませんでした"; return r; }
  if (r.long < MW_IMG_MIN_LONG) {
    r.err = "長辺 " + r.long + "px（" + MW_IMG_MIN_LONG + "px未満なので使えません）";
    return r;
  }
  r.ok = true;
  if (want) r.b64 = toB64(buf);          // 画面が pj-img に上げるための中身
  return r;
}
/* POST /mw/img
   {jan, ids:["10921742", "https://…/10921743.jpg", …], probe:true}
     → 大きさだけ測る（probe のときは中身を返さない）
   {jan, saved:[{pos, url}, …]}
     → 画面が pj-img に上げ終わった公開URLを控える（二度は取りに行かない） */
async function mwImgRun(env, body) {
  const run = newRun("mw-img");
  const res = { ok: false, jan: "", n: 0, good: 0, bad: 0, rows: [],
                min_long: MW_IMG_MIN_LONG, max: MW_IMG_MAX };
  try {
    const o = body || {};
    const jan = String(o.jan || "").replace(/\D/g, "");
    res.jan = jan;
    if (jan.length !== 13) {
      res.error = "bad_jan";
      return Object.assign(await saveRun(env, run), res);
    }
    /* 上げ終わった公開URLを控える（取りに行かない）。 */
    if (Array.isArray(o.saved)) {
      const stmts = [];
      for (const x of o.saved.slice(0, MW_IMG_MAX)) {
        const pos = Math.max(0, Math.min(MW_IMG_MAX - 1, mwNum(x && x.pos)));
        const u = String((x && x.url) || "").trim().slice(0, 300);
        if (!/^https:\/\/[A-Za-z0-9.-]+\/i\/\d{8}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(u))
          continue;
        stmts.push(env.DB.prepare(
          `UPDATE mw_img SET url=?3, at=?4 WHERE jan=?1 AND pos=?2`)
          .bind(jan, pos, u, nowIso()));
        res.n++;
      }
      await runBatch(env, run, stmts);
      res.ok = true;
      run.notes.push("MW画像：公開URLを " + res.n + "枚控えました（" + jan + "）");
      return Object.assign(await saveRun(env, run), res);
    }
    /* 貼られた文字から画像を取って測る。1枚目がメイン（pos=0）。 */
    const ids = (Array.isArray(o.ids) ? o.ids : String(o.ids || "").split(/[\r\n,]+/))
      .map((x) => String(x || "").trim()).filter(Boolean).slice(0, MW_IMG_MAX);
    if (!ids.length) {
      res.error = "no_ids";
      return Object.assign(await saveRun(env, run), res);
    }
    const probe = !!o.probe;
    const stmts = [];
    for (let i = 0; i < ids.length; i++) {
      if (i) await sleep(150);                 // MW に続けて当てない
      const r = await mwImgOne(env, run, jan, i, ids[i], !probe);
      if (r.ok) res.good++; else res.bad++;
      res.rows.push(r);
      stmts.push(env.DB.prepare(
        `INSERT INTO mw_img (jan,pos,mw_id,src,url,w,h,long_px,bytes,ct,ok,err,
           at,created_at)
         VALUES (?1,?2,?3,?4,NULL,?5,?6,?7,?8,?9,?10,?11,?12,?12)
         ON CONFLICT(jan,pos) DO UPDATE SET mw_id=excluded.mw_id,
           src=excluded.src, w=excluded.w, h=excluded.h, long_px=excluded.long_px,
           bytes=excluded.bytes, ct=excluded.ct, ok=excluded.ok,
           err=excluded.err, at=excluded.at`)
        .bind(jan, i, r.mw_id, r.src, r.w, r.h, r.long, r.bytes, r.ct,
              r.ok ? 1 : 0, r.err || "", nowIso()));
    }
    await runBatch(env, run, stmts);
    res.n = res.rows.length;
    res.ok = true;
    run.notes.push("MW画像：" + jan + " の " + res.n + "枚を測りました（使える "
      + res.good + "／使えない " + res.bad + "）");
  } catch (e) {
    run.errors++; run.notes.push("mw-img: " + String((e && e.message) || e));
    res.error = String((e && e.message) || e);
  }
  return Object.assign(await saveRun(env, run), res);
}
/* GET /mw/img?jan=… 控えてある画像（貼り直さなくて済むように返す） */
async function mwImgGet(env, url) {
  const jan = String(url.searchParams.get("jan") || "").replace(/\D/g, "");
  if (jan.length !== 13) return { ok: false, error: "bad_jan", rows: [] };
  const q = await env.DB.prepare(
    `SELECT jan,pos,mw_id,src,url,w,h,long_px,bytes,ct,ok,err,at
       FROM mw_img WHERE jan=?1 ORDER BY pos ASC`).bind(jan).all();
  return { ok: true, jan: jan, rows: (q && q.results) || [],
           min_long: MW_IMG_MIN_LONG, max: MW_IMG_MAX };
}

/* ===== 写真が小さい行をまとめて確かめ直す（7.59）=====
   eBayアプリで写真を差し替えても、こちらは気づけない（GetItem を呼ばないと
   大きさが分からない）。写真が原因で弾かれた記録が残っている行を順に GetItem で
   確かめ、**全部500px以上になっていれば記録を消す**。
   まだ小さい行は、いまの大きさを添えて返す（撮り直す対象が分かる）。
   POST /sync {kind:"picscheck"} から呼ぶ。 */
const PICS_CHECK_MAX = 60;         // 1回に確かめる件数（GetItem は1件1回）
async function jobPicsCheck(env, opt) {
  const run = newRun("pics-check");
  const limit = Math.min(PICS_CHECK_MAX,
    Math.max(1, Number((opt && opt.limit) || PICS_CHECK_MAX)));
  const res = { picked: 0, checked: 0, cleared: 0, small: 0, unknown: 0,
                failed: 0, left: 0, rows: [] };
  try {
    const q = await env.DB.prepare(
      `SELECT asin, cond, title, ebay_item_id, ebay_qty, pics_n,
              substr(revise_err,1,120) AS revise_err, revise_err_at
         FROM items
        WHERE COALESCE(ebay_item_id,'')<>'' AND revise_err LIKE '%21919137%'
        ORDER BY COALESCE(revise_err_at,'') ASC`).all();
    const all = (q && q.results) || [];
    res.picked = all.length;
    const rows = all.slice(0, limit);
    res.left = Math.max(0, all.length - rows.length);
    if (!rows.length) {
      run.notes.push("写真が小さい記録の残っている行はありません");
      return Object.assign(await saveRun(env, run), res);
    }
    const token = await ebayToken(env, run);
    const at = nowIso();
    const stmts = [];
    for (const r of rows) {
      const g = await getItemPics(env, run, token, r.ebay_item_id);
      if (!g.ok || !g.pictures) {
        res.failed++;
        res.rows.push({ asin: r.asin, cond: r.cond, item_id: r.ebay_item_id,
          name: r.title || r.asin, state: "確かめられません",
          why: (g.error || g.ack || "").slice(0, 80) });
        continue;
      }
      res.checked++;
      const p = g.pictures;
      const row = { asin: r.asin, cond: r.cond, item_id: r.ebay_item_id,
        name: r.title || r.asin, n: p.n, min_long: p.min_long,
        small_n: p.small_n, unknown_n: p.unknown_n,
        eps_only: p.eps_only ? 1 : 0,
        sizes: p.sizes.map((z) => z.w + "x" + z.h).slice(0, 12),
        err_at: jstText(r.revise_err_at) };
      if (p.all_big) {
        res.cleared++;
        row.state = "直っています（記録を消しました）";
        stmts.push(picErrClear(env, r.ebay_item_id, at));
        /* 写真の枚数も新しくしておく（画面の「写真が抜けています」に使う）。 */
        stmts.push(env.DB.prepare(
          `UPDATE items SET pics_n=?2, updated_at=?3 WHERE ebay_item_id=?1`)
          .bind(String(r.ebay_item_id), p.n, at));
      } else if (p.unknown_n) {
        res.unknown++;
        row.state = "大きさが分かりません（自前ホストの写真）";
      } else {
        res.small++;
        row.state = "まだ小さい（撮り直しが必要）";
      }
      res.rows.push(row);
    }
    if (stmts.length) await runBatch(env, run, stmts);
    run.notes.push("写真の確かめ直し：確かめた " + res.checked + "件／直っていた "
      + res.cleared + "件／まだ小さい " + res.small + "件"
      + (res.unknown ? ("／大きさ不明 " + res.unknown + "件") : "")
      + (res.failed ? ("／取れなかった " + res.failed + "件") : "")
      + (res.left ? ("／残り " + res.left + "件（もう一度呼んでください）") : ""));
    await notify(env, run, picsCheckText(res));
  } catch (e) {
    run.errors++;
    run.notes.push("例外 " + e.message);
  }
  return Object.assign(await saveRun(env, run), res);
}
function picsCheckText(res) {
  if (!res.checked && !res.failed) return "";
  const t = ["🖼 写真の大きさを確かめ直しました（" + PIC_OK_MIN + "px以上かどうか）",
    "確かめた " + res.checked + "件／直っていた " + res.cleared
    + "件（記録を消しました）／まだ小さい " + res.small + "件"
    + (res.unknown ? ("／大きさ不明 " + res.unknown + "件") : "")];
  if (res.left) t.push("残り " + res.left + "件はもう一度呼んでください");
  res.rows.filter((x) => x.state === "まだ小さい（撮り直しが必要）")
    .slice(0, 10).forEach((x) => {
      t.push("・" + String(x.name).slice(0, 36) + "（" + x.item_id + "）"
        + " 長辺 " + x.min_long + "px・" + x.small_n + "枚");
    });
  return t.join("\n");
}
/* ===== 22003（自動拒否額が新しい売値以上）を直す（7.58）=====
   新しい売値より**必ず下**になる自動拒否額と自動承諾額を作る。
   ・自動拒否額 … 最低売値（あれば）。売値以上になるなら「売値 − $0.01」
   ・自動承諾額 … いまの設定が売値以上のときだけ「売値 − $0.01」に直す
     （売値より下なら触らない。人が決めた値を勝手に動かさない） */
function boBelow(price, floor, got) {
  const cap = Math.round((Number(price) - 0.01) * 100) / 100;
  if (!(cap > 0)) return { min: 0, acc: 0 };
  const fl = Math.round((Number(floor) || 0) * 100) / 100;
  const min = (fl > 0 && fl < cap) ? fl : cap;
  const acc0 = Number((got && got.acc) || 0);
  return { min: min > 0 ? min : 0, acc: (acc0 > 0 && acc0 >= Number(price)) ? cap : 0 };
}
/* ベストオファーの設定を D1 に控える文（次回は1回で通るように）。 */
function boSave(env, r, got, at) {
  return env.DB.prepare(
    `UPDATE items SET ebay_bo=?3, ebay_bo_accept=?4, ebay_bo_decline=?5,
       updated_at=?6 WHERE asin=?1 AND cond=?2`)
    .bind(r.asin, r.cond,
          (got && got.on === null) ? null : Number((got && got.on) || 0),
          Number((got && got.acc) || 0) || null,
          Number((got && got.min) || 0) || null, at);
}
/* 売値を変える Revise。22003 が返ったら GetItem で本当の設定を取り直し、
   自動拒否額（と必要なら自動承諾額）を売値より下に直して**1回だけ**やり直す。
   自動値下げ・売値の自動反映・再調達中の売値・フェイズBの再調達で共通に使う。
   返り値 { v, bo, fixed, got, stmt }（stmt は D1 に控える文。無ければ null） */
async function boRetry(env, run, token, r, price, qty, floor, why0) {
  const none = { v: { ok: false, why: why0 || "" }, bo: null, fixed: false,
                 got: null, stmt: null };
  const g = await getItemPics(env, run, token, r.ebay_item_id);
  if (!g.ok || !g.bo) {
    run.notes.push("22003 の直しに失敗（GetItem が取れません） " + r.ebay_item_id);
    return none;
  }
  const stmt = boSave(env, r, g.bo, nowIso());
  const bo2 = boBelow(price, floor, g.bo);
  if (!(bo2.min > 0)) {
    run.notes.push("22003：自動拒否額を売値より下にできません " + r.ebay_item_id);
    return Object.assign({}, none, { got: g.bo, stmt: stmt });
  }
  run.notes.push("22003 を直してやり直し " + r.ebay_item_id
    + "：自動拒否 " + (g.bo.min || 0) + " → " + bo2.min
    + (bo2.acc ? ("／自動承諾 " + (g.bo.acc || 0) + " → " + bo2.acc) : ""));
  const v = await ebayRevise(env, run, token, r.ebay_item_id, price, bo2, qty);
  return { v: v, bo: bo2, fixed: v.ok, got: g.bo, stmt: stmt };
}
async function reviseFix(env, run, token, r, price, bo, qty, floor) {
  const v = await ebayRevise(env, run, token, r.ebay_item_id, price, bo, qty);
  if (v.ok || !BO_ERR.test(String(v.why || "")))
    return { v: v, bo: bo, fixed: false, got: null, stmt: null };
  return await boRetry(env, run, token, r, price, qty, floor, v.why);
}
async function jobGetItem(env, itemId) {
  const run = newRun("getitem");
  let out = { ok: false, item_id: itemId };
  try {
    const token = await ebayToken(env, run);
    out = Object.assign(out, await getItemPics(env, run, token, itemId));
    /* 見に行ったついでに、いまの写真の枚数を控える（7.57）。
       画面は「eBay の枚数 < 出品リストの枚数」で「写真が抜けています」を出すので、
       ここが新しいほど見つけやすくなる。eBay 保管だけになっていれば印も付ける。 */
    if (out.ok) {
      try {
        await env.DB.prepare(
          `UPDATE items SET pics_n=?2, pics_eps=CASE WHEN ?3=1 THEN 1 ELSE pics_eps END,
             pics_eps_at=CASE WHEN ?3=1 THEN ?4 ELSE pics_eps_at END, updated_at=?4
           WHERE ebay_item_id=?1`)
          .bind(String(itemId), Number(out.pictures.n || 0),
                out.pictures.eps_only ? 1 : 0, nowIso()).run();
      } catch (e) { run.notes.push("写真の枚数を控えられません：" + e.message); }
    }
    /* ベストオファーの設定も控える（7.58）。GetMyeBaySelling は
       BestOfferDetails を返さないことがあり、そこが 22003 の原因だった。 */
    if (out.ok && out.bo) {
      try {
        await env.DB.prepare(
          `UPDATE items SET ebay_bo=?2, ebay_bo_accept=?3, ebay_bo_decline=?4,
             updated_at=?5 WHERE ebay_item_id=?1`)
          .bind(String(itemId),
                out.bo.on === null ? null : Number(out.bo.on || 0),
                Number(out.bo.acc || 0) || null,
                Number(out.bo.min || 0) || null, nowIso()).run();
      } catch (e) { run.notes.push("ベストオファーを控えられません：" + e.message); }
      run.notes.push("GetItem " + itemId + "：ベストオファー "
        + (out.bo.on === null ? "不明" : (out.bo.on ? "オン" : "オフ"))
        + "／自動拒否 " + (out.bo.min || 0) + "／自動承諾 " + (out.bo.acc || 0));
    }
    /* 写真が差し替わって全部500px以上になっていたら、写真のエラーを消す（7.59）。
       eBayアプリで差し替えたときは、こちらで確かめるまで記録が残っていた。 */
    if (out.ok && out.pictures && out.pictures.all_big) {
      try {
        const q = await picErrClear(env, itemId, nowIso()).run();
        const n = Number((q && q.meta && q.meta.changes) || 0);
        out.pic_err_cleared = n;
        if (n) run.notes.push("写真が全部 " + PIC_OK_MIN + "px以上になったので、"
          + "写真が小さいの記録を消しました " + itemId);
      } catch (e) { run.notes.push("写真の記録を消せません：" + e.message); }
    }
    if (out.ok && out.pictures)
      run.notes.push("GetItem " + itemId + "：写真の長辺 最小 "
        + out.pictures.min_long + "px／500px未満 " + out.pictures.small_n + "枚"
        + (out.pictures.unknown_n ? ("／大きさ不明 " + out.pictures.unknown_n + "枚") : ""));
    if (out.ok) run.notes.push("GetItem " + itemId + "：写真 " + out.pictures.n + "枚"
      + (out.pictures.eps_only ? "（eBay 保管だけ）"
         : ("／自前ホストの紐づけ " + out.pictures.ext_n + "件")));
    else run.notes.push("GetItem " + itemId + " に失敗：" + (out.error || out.ack));
  } catch (e) {
    out.error = e.message;
    run.errors++;
  }
  return Object.assign(await saveRun(env, run), out);
}
/* eBay の写真を元画像にするときは、**いちばん大きい版（$_57.JPG）**に直してから渡す（7.45）。
   $_1.JPG のままだと Media API が小さい版（400×300）を取り込んでしまい、
   出品に使うときに 21919137（長辺500px未満）で弾かれる。 */
function epsMaxUrl(u) {
  const s = String(u || "");
  if (!/^https:\/\/i\.ebayimg\.com\//.test(s)) return s;
  return s.replace(/\/\$_\d+\.(jpe?g|png|webp)(\?|$)/i,
                   (m0, ext, tail) => "/$_57." + ext + tail);
}
/* i.ebayimg.com の URL から大きさを読む（/s/<base64> が「幅X高さ」）。
   例 MTYwMFgxMjAw → 1600X1200、NDAwWDMwMA== → 400X300。 */
function epsSize(u) {
  /* /s/ と次の / の間だけを見る（base64 に / が入ることがあるので [^/]+ は使わず、
     区切りで切り出してから中身を確かめる）。 */
  const m = /\/s\/([^/]+)\//.exec(String(u || ""));
  if (!m) return { w: 0, h: 0 };
  let t = "";
  try { t = atob(m[1].replace(/-/g, "+").replace(/_/g, "/")); } catch (e) { return { w: 0, h: 0 }; }
  const d = /^(\d+)X(\d+)$/i.exec(String(t).trim());
  return d ? { w: Number(d[1]), h: Number(d[2]) } : { w: 0, h: 0 };
}
/* 写真1枚を eBay（EPS）に預ける（Media API の createImageFromUrl）。
   元画像は pj-img（R2）の URL でも、eBay 自身の i.ebayimg.com でもよい。
   ・201 → Location の image_id → getImage で i.ebayimg.com の URL と期限
   ・401/403 のときは、足りないスコープが分かるように本文をそのまま返す */
async function epsFromUrl(env, run, token, url) {
  const src = epsMaxUrl(url);
  const out = { ok: false, source: src, source_in: url,
                eps_url: "", image_id: "", expiration: "",
                w: 0, h: 0, long: 0, ok_for_ebay: false };
  const cr = await net(run, MEDIA_API + "/image/create_image_from_url", {
    method: "POST",
    write: true,
    headers: {
      "authorization": "Bearer " + token,
      "content-type": "application/json",
      "accept": "application/json",
    },
    body: JSON.stringify({ imageUrl: src }),
  });
  const crText = await cr.text();
  out.create = { status: cr.status,
                 location: cr.headers.get("location") || "",
                 body: crText.slice(0, 600) };
  out.status = cr.status;
  if (cr.status === 403 || cr.status === 401) {
    out.error = "eBay が " + cr.status + " を返しました（スコープ不足の可能性）";
    return out;
  }
  if (!(cr.status === 201 || cr.status === 200)) {
    out.error = "createImageFromUrl が " + cr.status;
    return out;
  }
  const id = String(out.create.location || "").split("/").pop();
  out.image_id = id;
  if (!id) { out.error = "image_id が返ってきません"; return out; }
  const g = await net(run, MEDIA_API + "/image/" + encodeURIComponent(id), {
    headers: { "authorization": "Bearer " + token, "accept": "application/json" },
  });
  const gText = await g.text();
  out.get = { status: g.status, body: gText.slice(0, 600) };
  let info = null;
  try { info = JSON.parse(gText); } catch (e) { info = null; }
  if (info) {
    out.eps_url = info.imageUrl || "";
    out.max_dimension_url = info.maxDimensionImageUrl || "";
    out.expiration = info.expirationDate || "";
    /* 預かった写真の大きさ（URL から読む）。長辺500px未満だと
       出品に使えない（21919137）ので、呼ぶ側で止める（7.45）。 */
    const sz = epsSize(out.eps_url);
    out.w = sz.w; out.h = sz.h;
    out.long = Math.max(sz.w, sz.h);
    out.ok_for_ebay = !(out.long > 0 && out.long < 500);
    out.ok = !!out.eps_url;
  }
  if (!out.ok && !out.error) out.error = "getImage が " + g.status;
  return out;
}
/* 写真1枚の試し打ち（7.41）。R2 の写真をそのまま見てから預ける。 */
async function jobEpsTest(env, url) {
  const run = newRun("eps-test");
  const out = { ok: false, source: url };
  try {
    out.probe = await probeUrl(run, url, env);
    const token = await ebayToken(env, run);
    const r = await epsFromUrl(env, run, token, url);
    out.create = r.create;
    out.image_id = r.image_id;
    out.get = r.get;
    out.eps_url = r.eps_url;
    out.max_dimension_url = r.max_dimension_url || "";
    out.expiration = r.expiration;
    out.ok = r.ok;
    if (r.error) out.error = r.error;
    run.notes.push("EPS 試し打ち：" + (out.ok ? out.eps_url : ("失敗 " + (out.error || ""))));
  } catch (e) {
    out.error = e.message;
    run.errors++;
  }
  return Object.assign(await saveRun(env, run), out);
}
/* ReviseFixedPriceItem の本文。**送るのは PictureDetails だけ**。
   価格・数量・タイトルなどは1つも入れない（間違って出品を書き換えないため）。 */
/* 写真の元にできる URL（pj-img（R2）か eBay 自身の写真）。1か所で決める。 */
function picsUrlOk(u) {
  const s0 = String(u || "").trim();
  return /^https:\/\/[A-Za-z0-9.-]+\/i\/\d{8}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(s0)
    || /^https:\/\/i\.ebayimg\.com\/[A-Za-z0-9/._$?=&-]+$/.test(s0);
}
/* Discord に出す文（7.57）。出品した直後（fresh）は「出品しました」の形にする。
   **切り替えが済むまで eBayアプリで編集しないでください**を必ず入れる
   （編集するとメイン画像が抜ける。2026-10-22 に再発）。 */
function picsNotifyText(items, fresh) {
  const list = items || [];
  if (!list.length) return "";
  const ok = list.filter((x) => x.done);
  const ng = list.filter((x) => !x.done);
  const t = [];
  t.push((fresh ? "🆕 出品しました（" : "🖼 写真の切り替え（")
    + list.length + "件）：写真を eBay 保管に切り替えました " + ok.length + "件"
    + (ng.length ? ("／できなかった " + ng.length + "件") : ""));
  for (const x of ok.slice(0, PICS_MAX))
    t.push("✅ " + (x.title ? String(x.title).slice(0, 40) : x.item_id)
      + "（" + x.item_id + "・写真 " + Number(x.n_after || 0) + "枚）"
      + (Number(x.missing || 0)
         ? ("　⚠ 写真が抜けていたので " + Number(x.restore || 0) + "枚に戻しました") : ""));
  for (const x of ng.slice(0, PICS_MAX))
    t.push("⚠️ " + (x.title ? String(x.title).slice(0, 40) : x.item_id)
      + "（" + x.item_id + "）：" + String(x.error || "切り替えられませんでした").slice(0, 120));
  if (ng.length)
    t.push("できなかった分は**まだ切り替え待ち**です。"
      + "販売連携タブの「写真を eBay 保管に切り替え」でやり直してください");
  t.push("⚠️ 切り替えが済むまで **eBayアプリで編集しないでください**"
    + "（自前ホストの写真のまま保存すると、メイン画像が抜けます）");
  return t.join("\n");
}
function picsBody(itemId, urls) {
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">'
    + "<Item><ItemID>" + esc(itemId) + "</ItemID>"
    + "<PictureDetails>"
    + urls.map((u) => "<PictureURL>" + esc(u) + "</PictureURL>").join("")
    + "</PictureDetails>"
    + "</Item></ReviseFixedPriceItemRequest>";
}
/* 写真だけを書き換える（write:true を付けた呼び出しだけ通る）。 */
async function ebayRevisePics(env, run, token, itemId, urls) {
  const resp = await net(run, EBAY_API + "/ws/api.dll", {
    method: "POST",
    write: true,
    headers: {
      "X-EBAY-API-CALL-NAME": "ReviseFixedPriceItem",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": token,
      "content-type": "text/xml",
    },
    body: picsBody(itemId, urls),
  });
  const xml = await resp.text();
  const ack = xmlTag(xml, "Ack");
  const why = [xmlTag(xml, "ErrorCode"), xmlTag(xml, "ShortMessage"),
               xmlTag(xml, "LongMessage")].filter(Boolean).join(" / ").slice(0, 200);
  const ok = resp.ok && /^(Success|Warning)$/i.test(ack);
  return { ok, status: resp.status, ack: ack || ("HTTP" + resp.status),
           why: ok ? "" : (why || ("HTTP " + resp.status)) };
}
/* 1回ぶんの切り替え（7.44 で **預け直し（fresh）だけ**にした）。
   写真を1枚ずつ Media API に預け直し、その URL で PictureDetails を入れ替える。

   「預け直さない（reuse）」はやめた。880025406600 で試したところ、
   いまの i.ebayimg.com の URL をそのまま送り返すと **1枚目だけ落ちて2枚になり**、
   出品は自前ホスト扱いのままだった（アプリで足すと Error 20004）。
   自前ホストの写真の EPS コピーは、入力の PictureURL としては使えないとみられる。

   srcUrls を渡すと、その URL を元画像にして（順番そのまま）作り直す。
   落ちた写真を元の R2 の URL から戻すときに使う。 */
async function picSwitchOnce(env, run, token, itemId, srcUrls) {
  const fix = !!(srcUrls && srcUrls.length);
  const t = { mode: "fresh", done: false, sent: [], fixed_urls: fix };
  const before = await getItemPics(env, run, token, itemId);
  t.before = before.pictures || null;
  t.title = before.title || "";
  if (!before.ok) { t.error = before.error || ("GetItem が " + before.ack); return t; }
  const src = fix ? srcUrls.slice() : before.pictures.picture_url.slice();
  if (!src.length) { t.error = "この出品には写真がありません"; return t; }
  /* 手元の写真のほうが多い＝eBay から写真が抜けている（7.46）。
     自前ホストの出品をアプリで保存すると、表示されていない写真が落ちることがある。 */
  if (fix && src.length > before.pictures.n) {
    t.missing = before.pictures.n;
    t.restore = src.length;
  }
  /* もう eBay 保管だけなら触らない。ただし写真を指定されたとき（戻す作業）は行う。 */
  if (!fix && before.pictures.eps_only) {
    t.done = true; t.skipped = true; t.after = before.pictures;
    t.note = "すでに eBay 保管だけになっています";
    return t;
  }
  t.eps = [];
  for (const u of src) {
    const r = await epsFromUrl(env, run, token, u);
    t.eps.push({ source: r.source, source_in: u, ok: r.ok, eps_url: r.eps_url,
                 image_id: r.image_id, status: r.status, expiration: r.expiration,
                 w: r.w, h: r.h, long: r.long, ok_for_ebay: r.ok_for_ebay,
                 error: r.error || "" });
    if (!r.ok) { t.error = "写真を預け直せませんでした：" + (r.error || r.status); return t; }
    /* 預かった写真が小さくなっていたら、出品に使えない（21919137）。
       Revise は送らずにここで止める（7.45）。 */
    if (!r.ok_for_ebay) {
      t.error = "写真が小さくなりました（" + r.w + "×" + r.h + "・長辺500px未満）。"
        + "元の写真（pj-img）のURLを指定してやり直してください";
      return t;
    }
    t.sent.push(r.eps_url);
  }
  t.expiration = t.eps.length ? t.eps[0].expiration : "";
  t.revise = await ebayRevisePics(env, run, token, itemId, t.sent);
  if (!t.revise.ok) {
    t.error = "ReviseFixedPriceItem が失敗：" + t.revise.why;
    return t;
  }
  /* ここから先は eBay に送ってある（出品が変わっている）。
     画面が「送っていません」と出さないための印（6.65）。 */
  t.changed = true;
  const after = await getItemPics(env, run, token, itemId);
  t.after = after.pictures || null;
  if (!after.ok) { t.error = "切り替えたあとの GetItem に失敗：" + (after.error || after.ack); return t; }
  t.n_sent = t.sent.length;
  t.n_before = before.pictures.n;
  t.n_after = after.pictures.n;
  /* 送った枚数より減っていたら、eBay が写真を落としている。
     そのまま「できました」と言わずに止める（7.44）。 */
  if (t.n_after < t.n_sent || t.n_after < t.n_before) {
    t.error = "写真が減りました（前 " + t.n_before + "枚・送った " + t.n_sent
      + "枚 → 後 " + t.n_after + "枚）。eBayアプリで写真を確かめてください";
    return t;
  }
  t.done = !!after.pictures.eps_only;
  return t;
}
/* 出品の写真を eBay 保管（EPS）だけにする（7.42／7.44）。
   方式は預け直し（fresh）だけ。urls を渡すと、その写真で入れ替える。 */
async function jobPicSwitch(env, itemId, urls) {
  const run = newRun("pics-switch");
  const out = { ok: false, item_id: itemId, mode: "fresh", done: false,
                fixed_by: "", tries: [] };
  try {
    const token = await ebayToken(env, run);
    const t = await picSwitchOnce(env, run, token, itemId, urls);
    out.tries.push(t);
    out.title = t.title || "";
    if (t.error) out.error = t.error;
    else if (t.done) { out.done = true; out.fixed_by = t.skipped ? "already" : "fresh"; }
    out.before = t.before || null;
    out.after = t.after || null;
    out.n_before = t.n_before;
    out.n_after = t.n_after;
    out.expiration = t.expiration || "";
    out.missing = t.missing || 0;
    out.restore = t.restore || 0;
    out.changed = !!t.changed;
    out.ok = out.done;
    /* 通った出品には「eBay 保管済み」の印を付け、二度切り替えないようにする（7.46）。 */
    if (out.done) {
      const n = (t.after && t.after.n) || 0;
      await env.DB.prepare(
        `UPDATE items SET pics_eps=1, pics_eps_at=?2, pics_n=?3, updated_at=?2
         WHERE ebay_item_id=?1`).bind(String(itemId), nowIso(), n).run();
      out.pics_eps = 1;
    }
    /* 写真が**全部500px以上**なら、写真が小さくて弾かれた記録を消す（7.59）。
       切り替えが要らなかった行（すでに eBay 保管だけ）でも消す。
       eBayアプリで大きい写真に差し替えたあと、確かめた時点で戻せるようにするため。 */
    const after2 = (t.after && t.after.all_big) ? t.after
                 : ((t.before && t.before.all_big) ? t.before : null);
    out.pics_min_long = (t.after && t.after.min_long)
                     || (t.before && t.before.min_long) || 0;
    out.pics_small_n = (t.after ? t.after.small_n
                       : (t.before ? t.before.small_n : 0)) || 0;
    if (after2) {
      try {
        const q = await picErrClear(env, String(itemId), nowIso()).run();
        out.pic_err_cleared = Number((q && q.meta && q.meta.changes) || 0);
        if (out.pic_err_cleared)
          run.notes.push("写真が全部 " + PIC_OK_MIN + "px以上になったので、"
            + "写真が小さいの記録を消しました " + itemId);
      } catch (e) { run.notes.push("写真の記録を消せません：" + e.message); }
    }
    if (!out.done && !out.error)
      out.error = "切り替えても自前ホストの紐づけが消えませんでした";
    run.notes.push("写真の切り替え " + itemId + "："
      + (out.done ? ("できました（" + out.fixed_by + "）") : ("できません：" + out.error)));
  } catch (e) {
    out.error = e.message;
    run.errors++;
  }
  return Object.assign(await saveRun(env, run), out);
}

/* ---- GET /status ---- */
/* FBA在庫が1点以上あるか（販売可能・入庫中・予約済みのいずれか）。
   在庫0の過去SKUを数から外すために使う。SQLとJSで同じ条件にしてある。 */
const SQL_IN_STOCK =
  "(COALESCE(fba_available,0)+COALESCE(fba_inbound,0)+COALESCE(fba_reserved,0))>0";
/* 予約済みはあるが「売れた」と言えない行（SQL版・JSの resHold と同じ条件）。
   FC移管・FC処理中だけの行（顧客注文が0）と、内訳をまだ取っていない行
   （fba_res_cust が NULL）の両方。どちらも再調達の候補にしない。 */
const SQL_RES_HOLD =
  "(COALESCE(fba_reserved,0)>0 AND COALESCE(fba_res_cust,0)=0)";
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
/* 予約済みの内訳。
   「予約済み」には 顧客注文・FC移管・FC処理中 が混ざっている。
   納品した直後は fcProcessingQuantity（FCでの受領・処理中）に入るので、
   合計だけで判定すると「売れた」と取り違える（2026-10-05の誤通知）。
   known=false は内訳が分からない行（次のrollcallまで、または内訳の合計が
   予約済みに届かない行）。そのときは「売れた」とも「売れていない」とも決めず、
   「予約済み（内訳不明）」として内訳が取れるまで待つ（2026-10-07）。 */
function resBreak(r) {
  const nn = (v) => !(v === null || v === undefined);
  const c = r.fba_res_cust, t = r.fba_res_trans, p2 = r.fba_res_proc;
  const total = Number(r.fba_reserved || 0);
  /* 内訳をまったく持っていない行。顧客注文を 0 とも 合計 とも決めつけない
     （合計に寄せると納品直後のFC処理中を売れたと取り違え、0に寄せると本当の
     注文を落とす）。cust=null の「内訳不明」として、内訳が取れるまで待つ。 */
  if (!nn(c) && !nn(t) && !nn(p2))
    return { known: false, cust: null, trans: null, proc: null, total, rest: total };
  const cu = Number(c || 0), tr = Number(t || 0), pr = Number(p2 || 0);
  const rest = total - (cu + tr + pr);
  /* 内訳の合計が予約済みに届かないときは、説明のつかない残りがある。
     分かっている顧客注文はそのまま使い、残りがあるぶんは内訳不明として扱う。 */
  if (rest > 0) return { known: false, cust: cu, trans: tr, proc: pr, total, rest };
  return { known: true, cust: cu, trans: tr, proc: pr, total, rest: 0 };
}
/* 顧客注文のぶんの予約済み（本当に売れた数）。内訳が分からない行は null。 */
const resCust = (r) => resBreak(r).cust;
/* 本当に売れた行（顧客注文が1点以上ある）。内訳不明の行はここに入れない。 */
function resSold(r) { return Number(resBreak(r).cust || 0) >= 1; }
/* 予約済みはあるが内訳が分からない行。売れたとみなさず、内訳が取れるまで待つ。 */
function resUnknown(r) {
  const b = resBreak(r);
  return b.total > 0 && !b.known && !resSold(r);
}
/* FBAの受領処理中・FC移管だけの行。納品した直後の正常な状態なので、警告も通知もしない。 */
function isFcProcessing(r) {
  const b = resBreak(r);
  return b.known && b.total > 0 && b.cust === 0;
}
/* 予約済みはあるが「売れた」と言えない行（FC移管・FC処理中だけ／内訳不明）。
   再調達の候補にしない。納品直後の二重仕入れを防ぎ、内訳が取れるまで待つ。 */
function resHold(r) { return Number(r.fba_reserved || 0) > 0 && !resSold(r); }
/* 予約済みの行に出す言葉。内訳で分ける。空文字は通常扱い（警告しない）。 */
function resWarn(r) {
  if (resSold(r)) return "予約済みのみ（Amazonで注文済み）";
  if (resUnknown(r)) return "予約済み（内訳不明）";
  return "";
}
/* 箱なしで手元から発送する行（CustomLabel が -C のカートリッジのみ、
   -L のフィギュアのみ）。FBAには送らず手元から発送するので、
   FBAの在庫が無いのが正常。代わりに「eBayの数量＝手元にある数」かどうかを見張る。 */
function isCart(r) {
  const c = String(r.cond || "");
  return c === "cart" || c === "loose";
}
/* 手元の数とeBayの数量が合っているか。手元の数をまだ送っていない行は見ない。 */
function cartMismatch(r) {
  if (!isCart(r)) return false;
  const h = r.hand_qty;
  if (h === null || h === undefined) return false;
  return Number(r.ebay_qty || 0) !== Number(h);
}
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
      /* カートリッジのみは、Amazonの最安値が箱付きの値段なので基準にならない。
         既定で候補から外す（買い直すなら箱付きとは別の判断が要る）。 */
      && !isCart(r)
      /* 予約済みがあって顧客注文が無い行は候補にしない。
         FC移管・FC処理中だけなら納品した在庫がこれから販売可能になるので
         買い直す必要がなく（納品直後の二重仕入れを防ぐ）、
         内訳不明の行は内訳が取れるまで判断を待つ。 */
      && !resHold(r)
      /* 入庫中（納品した在庫がFCへ向かっている）行も候補にしない。
         売れたから0になったのではなく、これから販売可能になる。
         候補にするのは Amazon で実際に売れた行だけ（2026-10-09）。 */
      && Number(r.fba_inbound || 0) === 0
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
  let low = list.length ? (Number(list[0].p || 0) || 0)
                        : (Number(r.amazon_lowest || 0) || 0);
  /* 新品のほうが安ければ、そちらで買い直す前提にする（pj_price と同じ決まり）。 */
  const nw = Number(r.amazon_new_low || 0) || 0;
  if (r.cond !== "new" && nw > 0 && (!low || nw < low)) low = nw;
  return low;
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
/* 配送ポリシーの名前。pj_price の設定（出品用・再調達用）を D1 の ui.settings から
   読み、どちらに当たるかを見る。設定が無いときは「2000 を含むなら再調達用」で見る
   （運用上の名前が W1000 / W2000 のため）。 */
let SHIP_NAMES = null;            // { fast:'W1000', restock:'W2000' }
async function shipNamesLoad(env) {
  try {
    const s = await stateGet(env, SETTINGS_KEY);
    const o = s ? JSON.parse(s) : null;
    const st = (o && o.settings) || {};
    SHIP_NAMES = { fast: String(st.csvShipProfile || "").trim(),
                   restock: String(st.csvShipProfileRe || "").trim() };
  } catch (e) { SHIP_NAMES = { fast: "", restock: "" }; }
  return SHIP_NAMES;
}
const shipNorm = (v) => String(v || "").trim().toLowerCase();
/* 取れたポリシー名が再調達用か。
   'yes' / 'no' / '' （名前が無い・どちらとも言えない） */
function shipKindOf(name) {
  const v = shipNorm(name);
  if (!v) return "";
  const n = SHIP_NAMES || { fast: "", restock: "" };
  if (n.restock && v === shipNorm(n.restock)) return "yes";
  if (n.fast && v === shipNorm(n.fast)) return "no";
  if (/2000/.test(v)) return "yes";
  if (/1000/.test(v)) return "no";
  return "";
}
/* 配送ポリシーが再調達用（W2000）で出している行か。
   **eBayから取ったポリシー名があればそれで決める**（2026-10-10）。
   取れていない行だけ、これまでどおり pj_price の書き出しの決まりから推測する
   （「在庫0のときの動作＝再調達」の行と無在庫の行が再調達用）。 */
function isShipRestock(r) {
  const k = shipKindOf(r.ebay_ship_profile);
  if (k) return k === "yes";
  return String(r.mode || "") === "restock" || !!Number(r.dropship || 0)
      || !!Number(r.restocking || 0);
}
/* 行の判定。w＝対応が必要（警告）、n＝情報（対応は要らないが見えていてほしい）。
   warnOf / noteOf はここから取り出すだけにして、判定を1か所にまとめてある。 */
function judgeRow(r) {
  const w = [], n = [];
  const out = () => ({ w, n });
  if (r.scope !== "ebay") return out();
  const st = stateOf(r);
  if (st === "fba_not_listed" || st === "past") return out();   // 出していないだけ／過去SKU
  const onHand = !!Number(r.on_hand || 0);
  /* 手元在庫の行は、FBAに記録が無いのが正常（納品前にeBayへ出す運用）。
     7〜10日の納品待ちのあいだ警告を出し続けない。 */
  if (st === "listed_no_fba") {
    /* 無在庫出品とカートリッジのみは、FBAに記録が無いのが正常。
       カートリッジのみは代わりに「数量と手元の数」が合っているかを見る。 */
    if (isCart(r)) {
      if (cartMismatch(r)) w.push("数量と手元在庫が合いません");
      return out();
    }
    if (!onHand && !Number(r.dropship || 0)) w.push("FBA在庫なし");
    return out();
  }
  const q = Number(r.ebay_qty || 0), av = Number(r.fba_available || 0);
  const rv = Number(r.fba_reserved || 0), inb = Number(r.fba_inbound || 0);
  /* 再調達中の行は、FBAに在庫が無いまま出しているのが正常。
     売り越し・予約済みのみ・納品待ちは出さず、代わりに値段の異変だけを見る。 */
  /* カートリッジのみは手元から発送するので、FBAの在庫で売り越しを見ない。
     手元の数とeBayの数量が合わないときだけ知らせる。 */
  if (isCart(r)) {
    if (cartMismatch(r)) w.push("数量と手元在庫が合いません");
    return out();
  }
  /* 無在庫出品は在庫を持たないのが正常。売り越し・予約済みのみ・納品待ちは出さない
     （FBAに在庫が残っているときの数量の食い違いだけは従来どおり出す）。 */
  if (isDropship(r)) {
    if (av > 0 && q > 0 && av < q) w.push("数量の食い違い");
    return out();
  }
  if (isRestocking(r)) {
    const tr = restockTrouble(r);
    if (tr === "loss") w.push("再調達で赤字");
    else if (tr === "no_offer") w.push("再調達の仕入先なし");
    // FBAに在庫が残っていて、それより多くeBayに出している食い違いは従来どおり出す
    if (av > 0 && q > 0 && av < q) w.push("数量の食い違い");
    return out();
  }
  /* 予約済みのみ。内訳で分ける。
     顧客注文（pendingCustomerOrderQuantity）が1以上 … 「Amazonで注文済み」
     FC移管・FC処理中だけ … 納品直後の正常な状態なので警告しない
     内訳が分からない … 「予約済み（内訳不明）」。売れたとはみなさない。 */
  if (av === 0 && rv > 0 && q >= 1) {
    const rw = resWarn(r);
    if (rw) w.push(rw);             // 注文済み／内訳不明。FC移管・FC処理中だけなら空
    /* FC移管・FC処理中だけの行はここでは何も足さない。
       画面にはすでに「FBA受領処理中」の印（fc_processing）が出ている。 */
    return out();
  }
  if (av === 0 && q >= 1) {
    if (onHand) return out();                 // 手元にあるので売り越しではない
    /* 納品待ちで出品中。配送ポリシーが再調達用（W2000）の行は、
       FBAに在庫が無いまま出しているのが運用どおりなので情報にする。
       それ以外（手元発送のポリシー）は、届くまで売り越しになるので警告のまま。 */
    if (inb > 0) {
      if (isShipRestock(r)) n.push("納品待ちで出品中（再調達ポリシー）");
      else w.push("納品待ちで出品中");
      return out();
    }
    w.push("売り越しの恐れ");
    return out();
  }
  if (av > 0 && q > 0 && av < q) w.push("数量の食い違い");
  return out();
}
function warnOf(r) { return judgeRow(r).w; }
function noteOf(r) { return judgeRow(r).n; }
async function statusBody(env, url) {
  const p = url.searchParams;
  const scope = p.get("scope") || "ebay";          // 既定は eBay対象だけ
  /* 一覧の上限。1000件ちょうどで切れていたので上げた（2026-10-10）。
     返した件数と全体の件数（rows_total）を比べれば、切れているか分かる。 */
  const limit = Math.min(5000, Math.max(1, Number(p.get("limit") || 500)));
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
    where.push("(ebay_qty>=1 AND fba_available=0 AND one_off=0 AND on_hand=0 AND dropship=0"
      + " AND cond NOT IN ('cart','loose') AND COALESCE(fba_inbound,0)=0"
      + " AND NOT " + SQL_RES_HOLD + ")");
  if (p.get("state") === "past")
    where.push("(ebay_qty IS NULL AND fba_seen_at IS NOT NULL AND NOT " + SQL_IN_STOCK + ")");
  /* eBayでの販売実績（直近180日）。手元在庫の行を
     「eBayで売れた（FBAに送らない）」と「未販売（FBAに送る候補）」に分けるために使う。 */
  const soldSince = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  /* 画面が読む列だけ（STATUS_COLS・7.55）。全列を並べると D1 の100列を超えて
     「too many columns in result set」で /status ごと落ちる。 */
  const sql = `SELECT ${STATUS_COLS},
      (SELECT COALESCE(SUM(qty),0) FROM orders o
        WHERE o.channel='ebay' AND o.asin=items.asin AND o.cond=items.cond
          AND o.ordered_at>=?${bind.length + 1}) AS ebay_sold,
      -- 最後に eBay で売れた日時。pj_price の「値下げ中の行が売れたら止める」に使う
      (SELECT MAX(o2.ordered_at) FROM orders o2
        WHERE o2.channel='ebay' AND o2.asin=items.asin AND o2.cond=items.cond)
        AS ebay_sold_at
    FROM items`
    + (where.length ? " WHERE " + where.join(" AND ") : "")
    + " ORDER BY updated_at DESC LIMIT " + limit;
  bind.push(soldSince);
  const q = await env.DB.prepare(sql).bind(...bind).all();
  let items = ((q && q.results) || []).map((r) =>
    Object.assign({}, r, { state: stateOf(r), restock: isRestock(r) ? 1 : 0,
                           restocking: isRestocking(r) ? 1 : 0,
                           restock_trouble: restockTrouble(r),
                           // FBAの受領処理中・FC移管（予約済みだが顧客注文ではない）
                           fc_processing: isFcProcessing(r) ? 1 : 0,
                           // 予約済みの内訳が分からない行（判断を待つ）
                           res_unknown: resUnknown(r) ? 1 : 0,
                           // 予約済みだが売れたとは言えない行（再調達の候補にしない）
                           res_hold: resHold(r) ? 1 : 0,
                           // カートリッジのみ（手元から発送する行）
                           cart: isCart(r) ? 1 : 0,
                           cart_mismatch: cartMismatch(r) ? 1 : 0,
                           // 配送ポリシーが再調達用（W2000）か
                           ship_restock: isShipRestock(r) ? 1 : 0,
                           // eBayから取ったポリシー名で判定できたか（推測ではないか）
                           ship_known: shipKindOf(r.ebay_ship_profile) ? 1 : 0,
                           warnings: warnOf(r),
                           // 情報（対応は要らないが見えていてほしいもの）
                           notes: noteOf(r) }));
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
          AND restocking=0 AND dropship=0 AND cond NOT IN ('cart','loose')
          AND COALESCE(fba_inbound,0)=0
          AND NOT ${SQL_RES_HOLD}) AS restock,
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

  /* いまの絞り込みに当てはまる行の総数。返した件数と比べれば、
     上限で切れているかどうかが分かる（1000件ちょうどで切れていた。2026-10-10）。 */
  let rowsTotal = items.length;
  try {
    const cw = where.length ? (" WHERE " + where.join(" AND ")) : "";
    const ct = await env.DB.prepare("SELECT COUNT(*) AS n FROM items" + cw)
      .bind(...bind.slice(0, bind.length - 1)).first();
    rowsTotal = Number((ct && ct.n) || items.length);
  } catch (e) { /* 数えられなくても一覧は返す */ }
  return {
    generated_at: nowIso(),
    limit: limit,
    rows_returned: items.length,
    rows_total: rowsTotal,
    truncated: items.length >= limit && rowsTotal > items.length,
    counts: counts || {},
    last_runs: (runs && runs.results) || [],
    errors_recent: ((runs && runs.results) || []).some((r) => r.errors > 0),
    // 自動値下げの直近の実行結果（画面に「前回：下げた○件」と出す）
    md_last: await mdLast(env),
    /* 売値の見直しの自動反映。確認モードの「変更予定の一覧」と直近の実行結果を
       画面に出す（承認ボタンはこの予定を見て押す）。 */
    pb_plan: await pbPlan(env),
    pb_last: await pbLast(env),
    rv_plan: await rvPlanGet(env),
    rv_last: await rvLast(env),
    /* 再調達中の売値の追従（7.48）。予定と前回の結果を画面の帯に出す。 */
    rk_plan: await rkPlanGet(env),
    rk_last: await rkLast(env),
    /* 3時間ごとの最安値（7.49）。取り切れなかった件数を画面に出す。 */
    hot_pricing: await pricingHotLast(env),
    /* 在庫補充（数量を1に戻す）（7.53）。予定と前回の結果を画面の帯に出す。 */
    sk_plan: await skPlanGet(env),
    sk_last: await skLast(env),
    /* Worker が使っている為替（7.50）。画面の⚙設定に出して見比べられるようにする。
       ここでは控えだけを見る（/status で外に問い合わせない）。 */
    fx: await fxCached(env),
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
/* numOf と同じだが **0 を「消す」として受け取る**。相場の取り消しに使う
   （NULL は「送られてこなかった」なので、いまの値をそのまま残す）。 */
function numZero(x, key) {
  if (!Object.prototype.hasOwnProperty.call(x, key)) return null;
  const n = Number(x[key]);
  if (!isFinite(n) || n < 0) return null;
  return n;
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
    /* 個体（skus）のキーは せどりすとSKU のまま。
       出品（items）のキーは、-C／-L のときだけ CustomLabel を優先する。
       「可」の個体の せどりすとSKU は中古（used）だが、出品は
       カートリッジのみ（cart）の別物なので、SKUに合わせると箱付き中古の行に
       ItemID が付いてしまう。 */
    const kSku = (p && p.ok) ? { asin: p.asin, cond: p.cond, scope: p.scope } : null;
    let k = (lab.ok && lab.cart) ? lab : (kSku || lab);   // lab.cart は -C と -L
    if ((!k || !k.asin) && /^B[0-9A-Z]{9}$/.test(String(x.asin || "").trim())) {
      const c0 = String(x.cond || "");
      k = { asin: String(x.asin).trim(),
            cond: (c0 === "used" || c0 === "cart" || c0 === "loose") ? c0 : "new",
            scope: "" };     // scope は既存の値を尊重する（itemSeed が上書きしない）
    }
    if (!k || !k.asin) { bad++; continue; }
    if (sku) {
      stmts.push(env.DB.prepare(
        `INSERT INTO skus (seller_sku, asin, cond, cond_code, prefix, scope, purchased_on, cost,
           ebay_custom_label, title, active, updated_at, buy_src)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?12)
         ON CONFLICT(seller_sku) DO UPDATE SET
           ebay_custom_label=excluded.ebay_custom_label,
           title=COALESCE(NULLIF(excluded.title,''), skus.title),
           buy_src=excluded.buy_src,
           updated_at=excluded.updated_at`
      ).bind(sku, (kSku || k).asin, (kSku || k).cond, (p && p.condCode) || "",
             (p && p.prefix) || "", (kSku || k).scope,
             (p && p.purchasedOn) || "", (p && p.cost) || null, label,
             String(x.title || ""), nowIso(), skuSrcOf(p && p.prefix)));
    }
    stmts.push(itemSeed(env, k.asin, k.cond, k.scope || "unknown", String(x.title || "")));
    stmts.push(env.DB.prepare(
      /* 在庫0時の動作。空文字（''）を送ると「未設定」に戻す
         （行ボタンの押し間違いを戻す＝6.69 で使う）。 */
      `UPDATE items SET mode=CASE WHEN ?3='' THEN NULL ELSE COALESCE(?3, mode) END,
         one_off=COALESCE(?4, one_off),
         -- 一点物の指定が来たら「人が決めた」印も立てる
         one_off_known=CASE WHEN ?4 IS NULL THEN one_off_known ELSE 1 END,
         fba_link=COALESCE(?5, fba_link),
         /* 無在庫の印。CustomLabel が M- の行は自動で立て、
            それ以外は送られてきた指定（?14）に従う。 */
         dropship=CASE WHEN ?15=1 THEN 1 ELSE COALESCE(?14, dropship) END,
         -- カートリッジのみの手元在庫数。送られてこなければそのまま残す
         hand_qty=COALESCE(?16, hand_qty),
         /* 価格の元データ。送られてきた項目だけ書き替える（NULLはそのまま）。
            これがあると、出品リストを空にしても推奨売値・最低売値を出せる。 */
         weight_g=COALESCE(?17, weight_g),
         cost_yen=COALESCE(?18, cost_yen),
         -- 相場は 0 で取り消せる（NULLI は「送られてこなかった」）
         sold_usd=COALESCE(?19, sold_usd),
         /* 3日ごとの値下げの記録。空文字（''）を送ると消す
            （アップロードが Failure だったときに、進めた記録を戻すため）。 */
         /* 売れた値段で保つ印を 0 にした（値下げの再開・7.53）ときも消す。 */
         mark_at=CASE WHEN ?41=0 THEN NULL
                      WHEN ?20='' THEN NULL ELSE COALESCE(?20, mark_at) END,
         mark_stop=COALESCE(?21, mark_stop),
         -- eBay優先の印（Amazon同等ラインでの引き上げをやめる行）
         ebay_first=COALESCE(?22, ebay_first),
         /* 自動値下げの値下げ幅。出品時と「自動値下げを有効にした時点」に送る。
            いちど入ったら、送られてこないかぎりそのまま（途中で変えない）。
            md_start が新しい値で来たら、回数（md_done）を0に戻す
            （在庫補充・値上げのあとは下げ直しを最初からやる）。 */
         md_step=COALESCE(?24, md_step),
         md_floor=COALESCE(?25, md_floor),
         md_n=COALESCE(?26, md_n),
         md_done=CASE WHEN ?41=0 THEN 0
                      WHEN ?27 IS NOT NULL AND (md_start IS NULL OR md_start<>?27)
                      THEN 0 ELSE md_done END,
         md_start=COALESCE(?27, md_start),
         /* 相場を調べるときの検索語（手で直したもの）。空文字（''）で消す。 */
         search_kw=CASE WHEN ?28='' THEN NULL ELSE COALESCE(?28, search_kw) END,
         /* 売値の見直しの自動反映に使う目標（migrate-0018）。
            pj_price が計算して送る。rv_kind は空文字（''）で消せる。
            目標の売値が変わったら、連続失敗の回数は0に戻す（新しい挑戦なので）。 */
         rv_fail=CASE WHEN ?29 IS NOT NULL AND (rv_want IS NULL OR rv_want<>?29)
                      THEN 0 ELSE rv_fail END,
         rv_want=COALESCE(?29, rv_want),
         rv_floor=COALESCE(?30, rv_floor),
         rv_max_cost=COALESCE(?31, rv_max_cost),
         rv_kind=CASE WHEN ?32='' THEN NULL ELSE COALESCE(?32, rv_kind) END,
         rv_at=CASE WHEN ?29 IS NULL AND ?32 IS NULL THEN rv_at ELSE ?8 END,
         /* フェイズBの再調達の売値（migrate-0021）。pj_price が計算して送る。
            新しい値が来たら受け取った時刻も入れ替える（24時間で古いとみなす）。
            pb_skip（今回は動かさない）は 0/1 で送る。 */
         pb_want=COALESCE(?33, pb_want),
         pb_max_cost=COALESCE(?34, pb_max_cost),
         pb_want_at=CASE WHEN ?33 IS NULL THEN pb_want_at ELSE ?8 END,
         pb_skip=COALESCE(?35, pb_skip),
         /* 再調達中の売値の追従（migrate-0022）。pj_price が計算して送る。
            新しい目標が来たら受け取った時刻も入れ替える（24時間で古いとみなす）。
            目標が変わったら連続失敗の回数は0に戻す（新しい挑戦なので）。 */
         rk_fail=CASE WHEN ?36 IS NOT NULL AND (rk_want IS NULL OR rk_want<>?36)
                      THEN 0 ELSE rk_fail END,
         rk_want=COALESCE(?36, rk_want),
         rk_floor=COALESCE(?37, rk_floor),
         rk_low=COALESCE(?38, rk_low),
         rk_n=COALESCE(?39, rk_n),
         rk_max_cost=COALESCE(?40, rk_max_cost),
         rk_want_at=CASE WHEN ?36 IS NULL THEN rk_want_at ELSE ?8 END,
         /* 「今回は動かさない」を外したら、続けて失敗した回数も0に戻す。 */
         pb_fail=CASE WHEN ?35=0 THEN 0 ELSE pb_fail END,
         /* 売れた値段で保つ印（7.53）。0 を送ると「値下げを再開」になるので、
            最後に値下げした日（mark_at）と進めた回数（md_done）も消す
            ＝売れた値段から、同じ幅で数え直す。 */
         sold_keep=COALESCE(?41, sold_keep),
         sk_act=CASE WHEN ?41=0 THEN NULL ELSE sk_act END,
         sk_why=CASE WHEN ?41=0 THEN NULL ELSE sk_why END,
         sk_fail=CASE WHEN ?41=0 THEN 0 ELSE sk_fail END,
         /* アップロード結果の失敗の理由。空文字（''）で消す（直ったとき）。 */
         revise_err=CASE WHEN ?23='' THEN NULL ELSE COALESCE(?23, revise_err) END,
         revise_err_at=CASE WHEN ?23='' THEN NULL
                            WHEN ?23 IS NULL THEN revise_err_at ELSE ?8 END,
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
    ).bind(k.asin, k.cond,
           (x.mode === "") ? "" : (x.mode ? String(x.mode) : null),
           flagOf(x, "one_off"), flagOf(x, "fba_link"),
           String(x.item_id || ""), label, nowIso(), flagOf(x, "on_hand"),
           numOf(x, "restock_price"), numOf(x, "restock_max_cost"),
           flagOf(x, "restock_skip_acc"), flagOf(x, "restocking"),
           flagOf(x, "dropship"), lab.dropship ? 1 : 0,
           (x.hand_qty === null || x.hand_qty === undefined) ? null
             : Math.max(0, Math.round(Number(x.hand_qty) || 0)),
           numOf(x, "weight_g"), numOf(x, "cost_yen"), numZero(x, "sold_usd"),
           (x.mark_at === "") ? "" : (x.mark_at ? String(x.mark_at) : null),
           flagOf(x, "mark_stop"), flagOf(x, "ebay_first"),
           (x.revise_err === undefined || x.revise_err === null)
             ? null : String(x.revise_err),
           numOf(x, "md_step"), numOf(x, "md_floor"), numOf(x, "md_n"),
           numOf(x, "md_start"),
           (x.search_kw === undefined || x.search_kw === null)
             ? null : String(x.search_kw).slice(0, 200),
           numOf(x, "rv_want"), numOf(x, "rv_floor"), numOf(x, "rv_max_cost"),
           (x.rv_kind === undefined || x.rv_kind === null)
             ? null : String(x.rv_kind).slice(0, 20),
           numOf(x, "pb_want"), numOf(x, "pb_max_cost"), flagOf(x, "pb_skip"),
           numOf(x, "rk_want"), numOf(x, "rk_floor"), numOf(x, "rk_low"),
           (x.rk_n === null || x.rk_n === undefined) ? null
             : Math.max(0, Math.round(Number(x.rk_n) || 0)),
           numOf(x, "rk_max_cost"), flagOf(x, "sold_keep")));
  }
  await runBatch(env, run, stmts);
  run.notes.push("名簿 " + (list.length - bad) + "件を登録" + (bad ? ("／" + bad + "件は解析不可") : ""));
  const info = await saveRun(env, run);
  return { accepted: list.length - bad, rejected: bad, run: info };
}

/* 選んだASINの最安値をその場で取り寄せる（出品CSVタブの「無在庫（新品）」用）。
   日次の pricing と同じ amazonLowest を使う（式も上限も1か所）。
   取れた値は items にも残すので、次からは一覧にも出る。 */
async function getLowestNow(env, body) {
  const run = newRun("lowest");
  const list = Array.isArray(body && body.items) ? body.items.slice(0, PRICING_BATCH * PRICING_MAX_CALLS) : [];
  const keys = [], seen = {};
  for (const x of list) {
    const asin = String((x && x.asin) || "").trim().toUpperCase();
    if (!/^B[0-9A-Z]{9}$/.test(asin)) continue;
    const cond = (String((x && x.cond) || "new") === "used") ? "used" : "new";
    const id = asin + "|" + cond;
    if (seen[id]) continue;
    seen[id] = 1;
    keys.push({ asin, cond });
  }
  if (!keys.length) {
    run.notes.push("対象なし");
    return Object.assign({ lowest: {} }, await saveRun(env, run));
  }
  const low = await amazonLowest(env, run, lowestReqs(keys));
  const at = nowIso();
  const stmts = [];
  for (const k of keys) {
    const v = low[lowestKey(k)];
    /* 取れた値は items にも残す。scope は既存の値を尊重する
       （itemSeed は unknown のときだけ入れる）。 */
    stmts.push(itemSeed(env, k.asin, k.cond, "ebay", ""));
    if (v) stmts.push(env.DB.prepare(
      `UPDATE items SET amazon_lowest=?3, amazon_lowest_n=?4, amazon_offers=?5,
         amazon_offers_json=?7, amazon_lowest_at=?6, updated_at=?6
       WHERE asin=?1 AND cond=?2`).bind(k.asin, k.cond, v.low, v.lowN, v.total, at,
         JSON.stringify(v.offers || [])));
    // 中古の行には新品の最安値も入れる（新品のほうが安ければ値付けの基準になる）
    if (k.cond !== "new") {
      const vn = low[k.asin + "|new"];
      if (vn) stmts.push(env.DB.prepare(
        `UPDATE items SET amazon_new_low=?3, amazon_new_n=?4, amazon_new_at=?5,
           updated_at=?5 WHERE asin=?1 AND cond=?2`)
        .bind(k.asin, k.cond, vn.low, vn.lowN, at));
    }
  }
  await runBatch(env, run, stmts);
  run.notes.push("最安値 " + Object.keys(low).length + "件／要求 " + keys.length + "件");
  return Object.assign({ lowest: low, at }, await saveRun(env, run));
}
/* カートリッジのみの「+1するCSV」を書き出す直前に、eBayの<b>いまの</b>数量を取り直す。
   File Exchange の Revise の数量は上書きなので、古い値＋1で出すと売り越しになる。
   出品の取り込み（ActiveList）と同じ読み取りをその場で1回行い、
   要求されたItemIDの数量だけを返す。取れなければ ok:false を返して書き出しを止めさせる。 */
async function cartQtyNow(env, body) {
  const run = newRun("cart-qty");
  const ids = [];
  const seen = {};
  for (const x of (Array.isArray(body && body.item_ids) ? body.item_ids : []).slice(0, 200)) {
    const id = String(x || "").replace(/\D/g, "");
    if (!id || seen[id]) continue;
    seen[id] = 1;
    ids.push(id);
  }
  if (!ids.length) {
    run.notes.push("ItemIDが無い");
    return Object.assign({ ok: false, err: "no_item_ids", qty: {}, missing: [] },
                         await saveRun(env, run));
  }
  const r = await ebayActive(env, run);
  if (!r.ok) {
    return Object.assign({ ok: false, err: "ebay_active", qty: {}, missing: ids },
                         await saveRun(env, run));
  }
  const map = {};
  for (const x of r.rows) if (x.itemId) map[String(x.itemId)] = x;
  const at = nowIso();
  const qty = {}, missing = [], stmts = [];
  for (const id of ids) {
    const x = map[id];
    if (!x) { missing.push(id); continue; }
    qty[id] = { qty: Number(x.qty || 0), price: Number(x.price || 0), sku: x.sku || "" };
    /* 取り直した数量はD1にも入れておく（一覧の表示も合うように）。
       キーは CustomLabel から引く（ItemIDでは引けない行があるため）。 */
    const k = parseLabel(x.sku);
    if (k.ok) stmts.push(env.DB.prepare(
      `UPDATE items SET ebay_qty=?3, ebay_price=?4, ebay_item_id=?5, ebay_seen_at=?6,
         updated_at=?6 WHERE asin=?1 AND cond=?2`
    ).bind(k.asin, k.cond, Number(x.qty || 0), Number(x.price || 0), id, at));
  }
  await runBatch(env, run, stmts);
  run.notes.push("数量を取り直した " + Object.keys(qty).length + "件"
    + (missing.length ? ("／出品が見つからない " + missing.length + "件") : ""));
  return Object.assign({ ok: missing.length === 0, qty, missing, at },
                       await saveRun(env, run));
}

/* JANでカタログを引く。1回の要求で複数のJANをまとめて渡せる（1件ずつ順に引く）。 */
const CATALOG_MAX = 20;
async function getCatalog(env, body) {
  const run = newRun("catalog");
  const raw = Array.isArray(body && body.gtins) ? body.gtins : [];
  const list = [], seen = {};
  for (const g of raw.slice(0, CATALOG_MAX * 2)) {
    const n = String(g || "").replace(/\D/g, "");
    if (n.length < 8 || seen[n]) continue;
    seen[n] = 1;
    list.push(n);
    if (list.length >= CATALOG_MAX) break;
  }
  const out = {};
  let from = "", note = "", detail = null;
  for (const g of list) {
    const r = await ebayCatalogSearch(env, run, g);
    out[g] = { ok: !!r.ok, from: r.from || "", list: r.list || [], err: r.err || "" };
    if (r.from) from = r.from;
    if (r.note) note = r.note;
    if (r.detail) detail = r.detail;
  }
  run.notes.push("カタログ照合 " + list.length + "件" + (from ? ("／" + from) : ""));
  /* 実行の記録（saveRun）にも note があるので、こちらは別の名前で返す。 */
  return Object.assign({ gtins: out, from, fallback_note: note, detail },
                       await saveRun(env, run));
}
/* カタログのスコープが今のトークンで足りるかを確かめる。
   足りないときは eBay が返した理由をそのまま出す（再認可の判断に使う）。 */
async function catalogCheck(env) {
  const run = newRun("catalog-check");
  const a = await ebayAppToken(env, run, EBAY_CAT_SCOPE);
  const res = { scope: EBAY_CAT_SCOPE, app_token: a.ok };
  if (!a.ok) {
    res.app_token_error = { status: a.status, body: a.err };
    res.verdict = "カタログのスコープが使えません。eBayに Catalog API の利用申請をして、"
      + "承認後に再認可してください（README「カタログの照合」参照）";
  } else {
    const q = new URLSearchParams({ gtin: "4902370548501", limit: "1" });
    const r = await net(run, EBAY_API + "/commerce/catalog/v1_beta/product_summary/search?"
      + q.toString(), { headers: { authorization: "Bearer " + a.token,
        accept: "application/json", "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" } });
    const t = await r.text();
    res.search_status = r.status;
    res.search_ok = r.ok;
    if (!r.ok) res.search_error = t.slice(0, 400);
    res.verdict = r.ok ? "カタログの照合が使えます" :
      "トークンは取れましたが照会が通りません。利用申請が承認されているか確認してください";
  }
  const b = await ebayAppToken(env, run, EBAY_BASE_SCOPE);
  res.browse_fallback = b.ok;
  if (!b.ok) res.browse_error = { status: b.status, body: b.err };
  return Object.assign(res, await saveRun(env, run));
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (origin && origin !== ALLOW_ORIGIN) return json({ error: "forbidden_origin" }, 403, origin);
    const role = keyRole(request, env);
    if (!role) return json({ error: "unauthorized" }, 401, origin);
    /* 作業者用キー（STAFF_KEY）でできないこと（7.40）。
       ・設定の送信（POST /settings）… 自動値下げ・自動反映の設定が入る
       ・手動実行（POST /sync）… 「まとめて実行」もこれ
       /listings の中の価格の設定（md_* / rv_*）は、その route で弾く。 */
    /* MW の在庫の取り込み（7.60）は管理者だけ。無在庫の仕入れ値が入るため。 */
    if (role !== "admin" && request.method === "POST"
        && (url.pathname === "/mw/stock" || url.pathname === "/mw/market"
            || url.pathname === "/mw/img" || url.pathname === "/mw/amz"
            || url.pathname === "/mw/restrict" || url.pathname === "/mw/reg"))
      return forbidStaff("MW の取り込み・相場・画像は管理者用のキーが必要です", [], origin);
    if (role !== "admin" && request.method === "POST"
        && (url.pathname === "/settings" || url.pathname === "/sync"))
      return forbidStaff("価格の設定と実行は管理者用のキーが必要です"
        + "（作業者用キーでできるのは 取り込み・名簿の送信・英題生成・写真です）",
        [], origin);
    /* 写真の窓口（7.41・7.42）は管理者だけ。
       GetItem は出品の中身がそのまま返り、預け直しは eBay 側に画像を作り、
       切り替えは出品の写真を書き換える。 */
    if (role !== "admin"
        && (url.pathname === "/ebay/item" || url.pathname === "/eps/test"
            || url.pathname === "/ebay/pics/switch"))
      return forbidStaff("写真の窓口は管理者用のキーが必要です", [], origin);
    if (!env.DB) return json({ error: "server_misconfigured", detail: "DB" }, 500, origin);
    if (!env.SYNC_CACHE) return json({ error: "server_misconfigured", detail: "SYNC_CACHE" }, 500, origin);
    // 配送ポリシーの名前（pj_price の設定）。判定の前に一度だけ読む
    await shipNamesLoad(env);

    try {
      /* どちらのキーで来ているか（pj_price が画面の出し分けに使う）。
         秘密は返さない。 */
      if (request.method === "GET" && url.pathname === "/whoami")
        return json({ ok: true, role: role, staff_key_set: !!env.STAFF_KEY }, 200, origin);

      /* 調べるための窓口（7.41・管理者だけ）。出品の中身は変えない。 */
      if (request.method === "GET" && url.pathname === "/ebay/item") {
        const id = String(url.searchParams.get("id") || "").replace(/[^0-9]/g, "");
        if (!/^[0-9]{9,15}$/.test(id))
          return json({ error: "bad_item_id" }, 400, origin);
        return json(await jobGetItem(env, id), 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/eps/test") {
        let body; try { body = await request.json(); }
        catch (e) { return json({ error: "bad_request" }, 400, origin); }
        const u = String((body && body.url) || "").trim();
        /* 元画像は pj-img（R2）の写真か、eBay 自身の写真（i.ebayimg.com）だけ。
           後者は「預け直し」が使えるかを確かめるために許してある（7.42）。 */
        const okPj = /^https:\/\/[A-Za-z0-9.-]+\/i\/\d{8}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(u);
        const okEbay = /^https:\/\/i\.ebayimg\.com\/[A-Za-z0-9/._$?=&-]+$/.test(u);
        if (!(okPj || okEbay))
          return json({ error: "bad_url",
            detail: "pj-img の写真のURL（https://…/i/YYYYMMDD/<uuid>.jpg）か、"
              + "eBay の写真のURL（https://i.ebayimg.com/…）を入れてください" },
            400, origin);
        return json(await jobEpsTest(env, u), 200, origin);
      }
      /* 出品の写真を eBay 保管（EPS）だけにする（7.42／7.44）。
         item_id（1件お試し）か item_ids（まとめて・上限 PICS_MAX 件）。
         2件以上は confirm:true が無いと動かさない（押し間違い防止）。
         方式は預け直し（fresh）だけ。urls を渡すと、その写真（順番そのまま）で
         入れ替える（落ちた写真を元の URL から戻すときに使う）。 */
      if (request.method === "POST" && url.pathname === "/ebay/pics/switch") {
        let body; try { body = await request.json(); }
        catch (e) { return json({ error: "bad_request" }, 400, origin); }
        const digits = (v) => String(v == null ? "" : v).replace(/[^0-9]/g, "");
        const raw = Array.isArray(body && body.item_ids)
          ? body.item_ids : [(body && body.item_id)];
        const ids = [];
        for (const v of raw) {
          const d = digits(v);
          if (/^[0-9]{9,15}$/.test(d) && ids.indexOf(d) < 0) ids.push(d);
        }
        /* items:[{item_id,urls}] … **行ごとに違う写真**を1回で送る形（7.57）。
           出品CSVの「アップロード結果を取り込む」から、出したばかりの出品を
           まとめて切り替えるのに使う（1件ずつ投げると Discord も1件ずつになる）。 */
        const batch = [];
        if (Array.isArray(body && body.items) && body.items.length) {
          if (body.items.length > PICS_MAX)
            return json({ error: "too_many", max: PICS_MAX,
              detail: "1回に送れるのは " + PICS_MAX + "件までです" }, 400, origin);
          if (body.items.length > 1 && body.confirm !== true)
            return json({ error: "need_confirm",
              detail: "2件以上は confirm:true を付けてください" }, 400, origin);
          for (const it of body.items) {
            const d = digits(it && it.item_id);
            if (!/^[0-9]{9,15}$/.test(d)) return json({ error: "bad_item_id" }, 400, origin);
            const us = [];
            for (const v of ((it && it.urls) || [])) {
              const u = String(v || "").trim();
              if (!picsUrlOk(u))
                return json({ error: "bad_url",
                  detail: "写真のURLが違います：" + u.slice(0, 120) }, 400, origin);
              us.push(u);
            }
            if (us.length > 24)
              return json({ error: "too_many_pics", detail: "写真は24枚までです" }, 400, origin);
            if (!batch.some((x) => x.id === d))
              batch.push({ id: d, urls: us.length ? us : null });
          }
        }
        if (!ids.length && !batch.length) return json({ error: "bad_item_id" }, 400, origin);
        if (!batch.length) {
          if (ids.length > PICS_MAX)
            return json({ error: "too_many", max: PICS_MAX,
              detail: "1回に送れるのは " + PICS_MAX + "件までです" }, 400, origin);
          if (ids.length > 1 && body.confirm !== true)
            return json({ error: "need_confirm",
              detail: "2件以上は confirm:true を付けてください" }, 400, origin);
        }
        /* 写真を指定して入れ替えるとき（落ちた写真を戻す）。
           pj-img（R2）か eBay の写真のURLだけ。並べた順がそのまま写真の順になる。 */
        let urls = null;
        if (Array.isArray(body && body.urls) && body.urls.length) {
          if (ids.length > 1)
            return json({ error: "urls_one_item",
              detail: "写真を指定できるのは1件のときだけです" }, 400, origin);
          urls = [];
          for (const v of body.urls) {
            const u = String(v || "").trim();
            if (!picsUrlOk(u))
              return json({ error: "bad_url",
                detail: "写真のURLが違います：" + u.slice(0, 120) }, 400, origin);
            urls.push(u);
          }
          if (urls.length > 24)
            return json({ error: "too_many_pics", detail: "写真は24枚までです" }, 400, origin);
        }
        const items = [];
        if (batch.length)
          for (const b of batch) items.push(await jobPicSwitch(env, b.id, b.urls));
        else
          for (const id of ids) items.push(await jobPicSwitch(env, id, urls));
        /* 出品した直後の切り替えは Discord にも出す（7.57）。
           済むまでは eBayアプリで編集してはいけないので、その注意を必ず添える。 */
        if (body.notify === true) {
          const run2 = newRun("pics-notify");
          await notify(env, run2, picsNotifyText(items, body.fresh === true));
        }
        return json({ ok: items.every((x) => x.ok), n: items.length, mode: "fresh",
                      done: items.filter((x) => x.done).length,
                      items: items }, 200, origin);
      }

      if (request.method === "GET" && url.pathname === "/status")
        return json(await statusBody(env, url), 200, origin);

      /* Worker が使う為替（7.50）。?force=1 で取り直す。
         値付けに直接入る数字なので、画面から確かめられるようにしておく。 */
      if (request.method === "GET" && url.pathname === "/fx") {
        const run = newRun("fx");
        const force = url.searchParams.get("force") === "1";
        let fx = null;
        try { fx = await fxGet(env, run, force); }
        catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
        return json(Object.assign({ ok: !!fx, ttl_ms: FX_TTL_MS,
          min: FX_MIN, max: FX_MAX, note: run.notes.join(" / ") }, fx || {}),
          200, origin);
      }
      /* 値付けの式が Worker 側でも同じ金額を出すかを確かめる窓口（7.51）。
         ?cost=&weight=&flat= で直接計算する。出品の中身は変えない。 */
      if (request.method === "GET" && url.pathname === "/pricing") {
        const run = newRun("pricing");
        const ps = await pricingSettings(env, run);
        const num = (k, d) => {
          const n = Number(url.searchParams.get(k));
          return isFinite(n) ? n : d;
        };
        const cost = num("cost", 0), weight = num("weight", 0), flat = num("flat", 0);
        return json({ ok: true, version: PRICING.VERSION,
          settings: ps.S, fx: ps.fx,
          auto_ad_rate: ps.S.adRate,        // %（自動処理の広告料率）
          price: PRICING.priceFor(ps.S, cost, weight, flat),
          target: PRICING.autoTarget(ps.S, cost),
          max_cost: PRICING.maxCost(ps.S, num("price", 0), weight, flat),
          in: { cost: cost, weight: weight, flat: flat } }, 200, origin);
      }
      if (request.method === "GET" && url.pathname === "/settings")
        return json(await settingsGet(env), 200, origin);
      if (request.method === "POST" && url.pathname === "/settings") {
        let body; try { body = await request.json(); }
        catch (e) { return json({ ok: false, error: "bad_request" }, 400, origin); }
        const r = await settingsPut(env, body);
        return json(r, r.ok ? 200 : 400, origin);
      }

      if (request.method === "GET" && url.pathname === "/orders/summary")
        return json(await ordersSummary(env, url), 200, origin);

      if (request.method === "GET" && url.pathname === "/runs") {
        const r = await env.DB.prepare(
          `SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?1`
        ).bind(Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)))).all();
        /* 読むのは人なので日本時間の列を添える（7.58）。
           started_at / finished_at は保存している UTC のまま返す。 */
        const runs = ((r && r.results) || []).map((x) => Object.assign({}, x, {
          started_jst: jstText(x.started_at),
          finished_jst: jstText(x.finished_at) }));
        return json({ runs: runs, tz: "Asia/Tokyo（*_jst）" }, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/lowest") {
        let body; try { body = await request.json(); }
        catch (e) { return json({ error: "bad_request" }, 400, origin); }
        return json(await getLowestNow(env, body), 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/cart-qty") {
        let body; try { body = await request.json(); }
        catch (e) { return json({ error: "bad_request" }, 400, origin); }
        return json(await cartQtyNow(env, body), 200, origin);
      }
      /* MW の在庫CSV（7.60・段取りA）。画面が Shift_JIS を読んで送ってくる。 */
      if (request.method === "POST" && url.pathname === "/mw/stock") {
        let body; try { body = await request.json(); }
        catch (e) { return json({ error: "bad_request" }, 400, origin); }
        return json(await mwStockPut(env, body), 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/mw/reg") {
        const b = await request.json().catch(() => ({}));
        return json(await mwRegSave(env, b), 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/mw/restrict") {
        const b = await request.json().catch(() => ({}));
        const pr = mwRestrictRun(env, b);
        if (ctx && ctx.waitUntil) ctx.waitUntil(pr);
        return json(await pr, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/mw/amz") {
        const b = await request.json().catch(() => ({}));
        /* 1回に1分前後かかる。画面を閉じても最後まで進むよう waitUntil でも
           抱える（抱えないと、客が切れた時点で止まることがある。7.70）。 */
        const pr = mwScanRun(env, b);
        if (ctx && ctx.waitUntil) ctx.waitUntil(pr);
        return json(await pr, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/mw/buy") {
        const b = await request.json().catch(() => ({}));
        return json(await mwBuyPut(env, b, role), 200, origin);
      }
      if (request.method === "GET" && url.pathname === "/mw/buy")
        return json(await mwBuyList(env, url), 200, origin);
      if (request.method === "GET" && url.pathname === "/find")
        return json(await janFind(env, url), 200, origin);
      if (request.method === "GET" && url.pathname === "/mw/amz")
        return json(await mwAmzList(env, url), 200, origin);
      if (request.method === "POST" && url.pathname === "/mw/market") {
        const b = await request.json().catch(() => ({}));
        const pr = mwMarketRun(env, b);
        if (ctx && ctx.waitUntil) ctx.waitUntil(pr);
        return json(await pr, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/mw/img") {
        const b = await request.json().catch(() => ({}));
        return json(await mwImgRun(env, b), 200, origin);
      }
      if (request.method === "GET" && url.pathname === "/mw/img")
        return json(await mwImgGet(env, url), 200, origin);
      if (request.method === "GET" && url.pathname === "/mw/list")
        return json(await mwList(env, url), 200, origin);
      if (request.method === "POST" && url.pathname === "/catalog") {
        let body; try { body = await request.json(); }
        catch (e) { return json({ error: "bad_request" }, 400, origin); }
        return json(await getCatalog(env, body), 200, origin);
      }
      if (request.method === "GET" && url.pathname === "/catalog/check")
        return json(await catalogCheck(env), 200, origin);
      if (request.method === "POST" && url.pathname === "/listings") {
        let body; try { body = await request.json(); }
        catch (e) { return json({ error: "bad_request" }, 400, origin); }
        /* 名簿は作業者も送れる。値段を動かす設定（自動値下げの幅・見直しの目標）が
           混ざっていたら、その回ぜんぶを断る（一部だけ書くと分かりにくいため）。 */
        if (role !== "admin") {
          const bad = staffDenyFields(body);
          if (bad.length)
            return forbidStaff("価格の設定（自動値下げ・見直しの目標）は"
              + "管理者用のキーが必要です", bad, origin);
        }
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
        // 自動値下げ。設定が 'plan' のときは eBay を変えず予定だけ返す
        if (kind === "markdown")  return json(await jobMarkdown(env), 200, origin);
        /* 売値の見直しの自動反映。確認モードでは予定だけ返す。
           approve:true は販売連携タブの「まとめて実行」＝承認して今すぐ実行。 */
        if (kind === "review")
          return json(await jobReview(env, { approve: body.approve === true }), 200, origin);
        /* フェイズB（FBAで売れたら数量0・再調達）。7.47。
           approve:true は販売連携タブの「再調達をまとめて実行」。 */
        if (kind === "phaseb")
          return json(await jobPhaseB(env, { approve: body.approve === true }), 200, origin);
        /* 写真の大きさを確かめ直す（7.59）。写真が小さくて弾かれた記録が
           残っている行を GetItem で確かめ、直っていれば記録を消す。 */
        if (kind === "picscheck")
          return json(await jobPicsCheck(env, { limit: body.limit }), 200, origin);
        /* 段取り D：MW の無在庫を守る（7.72）。既定は「確認してから」。
           approve:true で実際に eBay の数量・売値を変える。 */
        if (kind === "mwdrop")
          return json(await jobMwDrop(env, { approve: body.approve === true,
            limit: body.limit, over: body.over,
            /* only:"zero" は数量0だけ（7.73）。 */
            only: body.only }), 200, origin);
        /* 在庫補充（数量を1に戻す）（7.53）。既定は「確認してから」。
           approve:true は販売連携タブの「在庫補充（数量を1に戻す）」。 */
        if (kind === "soldkeep")
          return json(await jobSoldKeep(env, { approve: body.approve === true }),
            200, origin);
        /* 再調達中の売値の追従（7.48）。既定は自動なので、ふだんは Cron が回す。
           approve:true は「確認してから」のときの手動実行。 */
        if (kind === "restockprice")
          return json(await jobRkPrice(env, { approve: body.approve === true }), 200, origin);
        if (kind === "test-notify")
          return json(await jobTestNotify(env, body.tag), 200, origin);
        if (kind === "pricing") {
          const run = newRun("pricing");
          try { await syncPricing(env, run); }
          catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
          return json(await saveRun(env, run), 200, origin);
        }
        /* 3時間ごとの最安値を手で回す（7.49）。ふだんは Cron が回す。 */
        if (kind === "pricing-hot") {
          const run = newRun("pricing");
          let hot = null;
          try { hot = await syncPricingHot(env, run); }
          catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
          return json(Object.assign(await saveRun(env, run), { hot: hot }), 200, origin);
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
    ctx.waitUntil(shipNamesLoad(env));      // 配送ポリシーの名前を読んでおく
    /* 15分ごと：注文の取り込み → フェイズB（FBAで売れた行の数量0）。 */
    if (cron.indexOf("*/15") === 0) {
      ctx.waitUntil((async () => {
        await jobOrders(env, 0);
        await jobPhaseB(env, {});
        /* 在庫補充（数量を1に戻す）（7.53）。注文を取り込んだ直後に判定するので、
           売れてすぐ（15分以内）に数量が戻る。
           「確認してから」のときは予定を立てるだけ。 */
        await jobSoldKeep(env, {});
      })());
      return;
    }
    // 毎時。UTC 18時台（JST 3時台）の回で日次処理も回す。
    ctx.waitUntil((async () => {
      await jobHourly(env);
      /* 3時間ごとに、再調達中とフェイズBの対象の最安値を取り直す（7.49）。
         このあとのフェイズBと売値の追従が、新しい最安値で判断できる。 */
      if (new Date().getUTCHours() % 3 === 0) {
        const run = newRun("pricing");
        try { await syncPricingHot(env, run); }
        catch (e) { run.errors++; run.notes.push("例外 " + e.message); }
        await saveRun(env, run);
      }
      /* 在庫の取り込みのあとにも判定する（7.47）。 */
      await jobPhaseB(env, {});
      await jobSoldKeep(env, {});        // 在庫補充（数量を1に戻す）（7.53）
      /* 段取り D：MW の無在庫を守る（7.72）。
         欠品で売り越すのが一番まずいので、毎時「確認」まで走らせる
         （実際に変えるのは日次、または画面のボタン）。 */
      await jobMwDrop(env, {});
      /* 取り込みが24時間止まっていたら催促する（7.75）。 */
      try { await mwStaleCheck(env, newRun("mw-stale")); }
      catch (e) { /* 催促が失敗しても本体は止めない */ }
      if (new Date().getUTCHours() === DAILY_UTC_HOUR) {
        await jobDaily(env);
        /* 自動値下げは最後に回す。直前の取り込みで売値・数量・売れた日時が
           新しくなっているので、その値で判断できる。 */
        await jobMarkdown(env);
        /* 売値の見直しの自動反映（上げるだけ）。値下げのあとに回すので、
           下げた直後の売値を見て判断する（赤字の行だけ上げ直す）。 */
        await jobReview(env);
        /* 再調達中の売値を Amazon最安値に合わせる（7.48）。
           jobDaily で最安値を取り直したあとなので、新しい値で判断できる。 */
        await jobRkPrice(env, {});
        /* 段取り D を**実行**する（7.72）。欠品の数量0・卸値上がりの値上げ・
           戻った行の数量1を、ここで実際に eBay へ書き込む。 */
        await jobMwDrop(env, { approve: true });
      }
    })());
  },
};

/* 受け入れテスト用に、外部通信を伴わない小さな関数だけ公開する。
   本番の動きには関与しない（fetch / scheduled からは使わない）。 */
export const __test = { assertReadOnly, keyRole, eqKey, staffDenyFields,
                        rkTarget, rkBo, pricingHotWhere, PRICING_HOT_MAX,
                        fxGet, fxCached, fxOk, FX_TTL_MS, FX_DEFAULT,
                        PRICING, pricingSettings, AUTO_AD_DEFAULT,
                        skSettings, skPlanRows, jobSoldKeep, SK_MAX, SK_FAIL_WARN,
                        skStampOff,
                        selfTargets, selfFill, wantFresh, WANT_FRESH_MS,
                        SELF_WRITE_MAX, ITEM_COLS, STATUS_COLS, SKU_COLS,
                        D1_MAX_COLS, D1_COLS_WARN,
                        imageSize, jobGetItem, jobEpsTest,
                        newRun, syncEbayActive, SALE_ERR,
                        picsBody, jobPicSwitch, getItemPics, epsFromUrl, PICS_MAX,
                        picsUrlOk, picsNotifyText,
                        BO_ERR, PIC_ERR, TEMP_ERR, whyKey, whyTop, whyLine,
                        jobPicsCheck, picErrClear, PIC_OK_MIN, PICS_CHECK_MAX,
                        mwStockPut, mwList, mwRow, mwHash, d1Step, D1_MAX_BINDS,
                        janFind, janMapPut, janOk, JAN_MISS_TTL_D,
                        mwBuyPut, mwBuyList, MW_BUY_MAX_QTY, MW_AMZ_RETRY_MAX,
                        mwRestrictRun, mwScanRun, mwScanAsin, mwScanPrice,
  MW_SCAN_BUDGET_MS, mwRstPick, mwRegSave, MW_REG_MAX, MW_RST_FAIL_STOP, spSellerId,
  skuCatOf, skuSrcOf, PREFIX_CAT, MW_RST_MAX, MW_RST_TTL_D,
                        MW_RST_BAD_TTL_D, MW_RST_COND,
                        jobMwDrop, mwDropPlan, mwJanOfSku, mwOrderNotify,
                        mwStaleCheck, MW_STALE_H, MW_STOCK_MIN,
                        MW_D_MAX, MW_D_OVER,
                        spSlotKv, SP_KV_LANES,
                        mwAmzList, mwAsinFind, amazonLowest,
                        amzSelf, fbaN, buyBox,
                        offerN, MW_AMZ_MAX, MW_AMZ_TTL_D, AMZ_SELF_ID,
                        mwMarketRun, mwMktPick, mwImgRun, mwImgGet, mwImgUrl,
                        mwImgId, mwWhere, toB64, MW_OVER, MW_MKT_MAX,
                        MW_MKT_TTL_D, MW_IMG_MAX, MW_IMG_MIN_LONG, MW_CHUNK,
                        MW_SHIP_OK, MW_DROP_WARN,
                        jstText, boBelow, boRetry, reviseFix,
                        epsMaxUrl, epsSize,
                        parseSku, parseLabel, warnOf, noteOf, judgeRow,
                        isShipRestock, shipKindOf, shipNamesLoad,
                        isDropship, isRestock, stateEvents, EV_TEXT, daysLeft, dueText,
                        resBreak, resCust, resSold, resUnknown, resHold, resWarn, isFcProcessing,
                        invRow, writeInventory,
                        gtinJp, catFromCatalog, catFromBrowse, isCart, cartMismatch,
                        lowestReqs, lowestKey, restockLowest, restockTrouble,
                        settingsGet, settingsPut,
                        mdSettings, mdSkip, mdNext, mdBo, reviseBody, jobMarkdown, mdLast,
                        rvSettings, rvSkip, rvAct, rvLoss, invBody, jobReview, rvLast,
                        pbSettings, pbTarget, pbRestockWhy, jobPhaseB, pbPlan, pbLast,
                        PB_ZERO_MAX, PB_RESTOCK_MAX,
                        rvPlanGet, rvUsedToday };
