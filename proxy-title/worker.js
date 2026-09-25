/*
 * pj_price 専用 英語タイトル補助（Cloudflare Worker）
 * ------------------------------------------------------------
 * 目的: JANコードから、eBay向けの「英語の商品名（english_name）」だけを特定する。
 *       タイトルの組み立ては pj_price 側の buildGameTitle() が行う。
 *       この Worker はタイトル文字列を作らない（書式を2か所に持たない）。
 *
 * 既存の proxy/（商品名パース）・proxy-img/（画像）とは別 Worker にしてある。
 * 用途ごとに分け、片方の障害や誤設定をもう片方へ波及させない。
 *
 * Secrets / バインディング（値はリポジトリに書かない。wrangler secret put で登録）:
 *   PJ_ACCESS_KEY           … pj_price から送る共有キー（ヘッダー X-PJ-Key）
 *   EBAY_CLIENT_ID / EBAY_CLIENT_SECRET
 *   LWA_CLIENT_ID / LWA_CLIENT_SECRET
 *   SPAPI_REFRESH_TOKEN_FE  … 日本（FE）
 *   SPAPI_REFRESH_TOKEN_NA  … 米国（NA）。未登録なら米国照会はスキップする
 *   ANTHROPIC_API_KEY
 *   KV TITLE_CACHE          … 生成結果・アクセストークンのキャッシュ
 *
 * エンドポイント:
 *   POST /titles         … ゲーム。english_name だけを返す。最大20件
 *   POST /figure-titles  … フィギュア。5項目（brand/series/chara/variant/line）を返す
 *
 * 悪用対策:
 *   - CORS は pj_price の Pages オリジンに限定し、X-PJ-Key が一致しなければ401
 *   - モデル / system プロンプト / max_tokens をサーバ側で固定（汎用プロキシにしない）
 *   - 1リクエスト20件・同時4並列・入力長上限でコストの上限を抑える
 */

const ALLOW_ORIGIN = "https://gamegamesan-dot.github.io"; // pj_price の公開元
const MODEL = "claude-haiku-4-5-20251001";
const MAX_ITEMS = 20;        // 1リクエストあたり（仕様3.2）
const CONCURRENCY = 4;       // 1件ずつの処理の並列数（仕様3.4）
const MAX_TOKENS = 200;      // english_name のJSONに十分
const MAX_JA = 200;          // 日本語名の長さ上限（文字）
const MAX_CANDIDATES = 5;    // 画面に返す候補の数
const EBAY_LIMIT = 20;       // Browse API の取得件数
const CACHE_TTL = 90 * 24 * 60 * 60;   // 生成結果は90日（仕様3.8）

const MP_NA = "ATVPDKIKX0DER";   // amazon.com
const MP_FE = "A1VC38T7YXB528";  // amazon.co.jp

/* 機種名。タイトル組み立ては pj_price 側だが、候補から機種名を取り除くために使う。
   pj_price 側の PLATFORMS（機種の変換表）と同じ綴りを並べておく。 */
const PLATFORM_WORDS = [
  "Nintendo Switch 2", "Switch 2", "Nintendo Switch", "Switch",
  "PlayStation 5", "PlayStation5", "PS5",
  "PlayStation 4", "PlayStation4", "PS4",
  "PlayStation 3", "PlayStation3", "PS3",
  "PlayStation 2", "PlayStation2", "PS2",
  "PlayStation Vita", "PS Vita", "PSVita", "Vita",
  "PlayStation Portable", "PSP",
  "Nintendo 3DS", "3DS", "Nintendo DS", "DS",
  "Xbox One", "XboxOne",
];

/* 候補タイトルから機種を読み取るための表。上から順に見るので、
   Switch 2 → Switch、PS Vita → PS のように長い綴りを先に並べる。
   pj_price から届く platform の綴りも同じ関数で正規化する。 */
const PLATFORM_KEYS = [
  ["switch2", /\b(nintendo\s+)?switch\s*2\b|スイッチ\s*2|ニンテンドー\s*スイッチ\s*2/i],
  ["switch",  /\b(nintendo\s+)?switch\b|ニンテンドー\s*スイッチ|スイッチ/i],
  ["psvita",  /\b(playstation\s*vita|ps\s*vita|psvita|vita)\b|プレイステーション\s*[・]?\s*ヴィータ|プレステ\s*ヴィータ/i],
  ["psp",     /\b(playstation\s*portable|psp)\b|プレイステーション\s*[・]?\s*ポータブル/i],
  ["ps5",     /\b(playstation\s*5|ps\s*5|ps5)\b|プレイステーション\s*5/i],
  ["ps4",     /\b(playstation\s*4|ps\s*4|ps4)\b|プレイステーション\s*4/i],
  ["ps3",     /\b(playstation\s*3|ps\s*3|ps3)\b|プレイステーション\s*3/i],
  ["ps2",     /\b(playstation\s*2|ps\s*2|ps2)\b|プレイステーション\s*2/i],
  ["3ds",     /\b(nintendo\s*)?3ds\b|ニンテンドー\s*3ds/i],
  ["ds",      /\b(nintendo\s*)?ds\b|ニンテンドー\s*ds/i],
  ["xboxone", /\bxbox\s*one\b|エックスボックス\s*ワン/i],
];
// 対象外の機種も、候補が別物だと見抜くために読めるようにしておく
const OTHER_PLATFORM_KEYS = [
  ["wiiu",   /\bwii\s*u\b/i],
  ["wii",    /\bwii\b|ウィー/i],
  ["xbox360",/\bxbox\s*360\b/i],
  ["xbox",   /\bxbox\b|エックスボックス/i],
  ["gba",    /\bgame\s*boy\s*advance\b|\bgba\b/i],
  ["ps1",    /\b(playstation\s*1|ps\s*one|psone|ps1)\b/i],
];
const ALL_PLATFORM_KEYS = PLATFORM_KEYS.concat(OTHER_PLATFORM_KEYS);

// 文字列に出てくる機種をすべて返す（見つからなければ空配列）
function platformsIn(text) {
  const t = String(text || "");
  const found = [];
  for (const [key, re] of ALL_PLATFORM_KEYS) {
    if (re.test(t)) {
      // switch2 が当たったら switch は数えない（同じ綴りを二重に数えないため）
      if (key === "switch" && found.includes("switch2")) continue;
      if (key === "ds" && found.includes("3ds")) continue;
      if (key === "wii" && found.includes("wiiu")) continue;
      if (key === "xbox" && (found.includes("xboxone") || found.includes("xbox360"))) continue;
      if (key === "xbox360" && found.includes("xboxone")) continue;
      found.push(key);
    }
  }
  return found;
}
// pj_price から届く platform を1つのキーにする
function platformKey(text) {
  const f = platformsIn(text);
  return f.length ? f[0] : "";
}

/* セット・まとめ売りの見分け。ja_title がセットでない限り、
   セット品の候補は別商品として落とす。 */
const SET_EN = /(\+|\bset\s+of\b|\bsets?\b|\bbundle[ds]?\b|\bx\s?[2-9]\b|\b[2-9]\s*(games?|titles?|pack)\b|\blot\s*(of)?\b|\bcombo\b|\bdouble\s*pack\b)/i;
const SET_JA = /(セット|まとめ|同梱|[2-9２-９]\s*本|＋|\+)/;

/* 全角ローマ数字を半角のローマ字に直す（Ⅲ → III）。
   せどりすとの和名に混ざるため、AIへ渡す前に正規化する。 */
const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
function normRoman(s) {
  return String(s || "")
    .replace(/[\u2160-\u216B]/g, (c) => ROMAN[c.charCodeAt(0) - 0x2160])
    .replace(/[\u2170-\u217B]/g, (c) => ROMAN[c.charCodeAt(0) - 0x2170]);
}

/* 禁止語（仕様4章）。english_name に混ざっていたら取り除き、status は review にする。
   言語対応の表記は手動でのみ追加する方針なので、ここでは必ず落とす。 */
const BANNED = [
  /\bEnglish(\s+(Supported|Subtitle|Subtitles|Version|Language|Text))?\b/gi,
  /\bMulti[-\s_]?lingual\b/gi,
  /\bMulti[-\s_]?language[ds]?\b/gi,
  /\bMulti[-\s_]?lang\b/gi,
  /\bEng\s*(Sub|Subs|Supported)\b/gi,
  /\bRegion[-\s]?Free\b/gi,
  /\bRare\b/gi,
  /L@@K/gi,
  /\bNew\s+Sealed\b/gi,
  /\bJapan(ese)?\s+(Import|Version|Ver\.?)/gi,   // 「Ver.」の点まで消す
  /\bImport\b/gi,
  /\bUsed\b/gi,
  /* セラーの飾りの「!!!」「*」だけ落とす。単語にくっついた「!」は作品名の
     一部のことがあるので残す（Haikyu!! を Haikyu にしない）。
     「*」は作品名に使われないので、単語にくっついていても末尾なら落とす。 */
  /(^|\s)[!*]+(?=\s|$)/g,
  /\*+$/g,
];

function corsHeaders(origin) {
  // 許可オリジンのみ返す（未知オリジンには ACAO を付けない）
  const h = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

// X-PJ-Key を定数時間で照合する
function authorized(request, env) {
  if (!env.PJ_ACCESS_KEY) return false;
  const a = request.headers.get("X-PJ-Key") || "";
  const b = env.PJ_ACCESS_KEY;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---- JAN（EAN-13 / EAN-8）の検証（仕様3.4-1） ---- */
function validJan(jan) {
  const s = String(jan || "").trim();
  if (!/^\d{13}$/.test(s) && !/^\d{8}$/.test(s)) return false;
  // チェックディジット: 右から2桁目以降に 3,1,3,1… を掛けた和の10の補数
  let sum = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const d = s.charCodeAt(s.length - 2 - i) - 48;
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10 === s.charCodeAt(s.length - 1) - 48;
}

/* ---- 文字の正規化（仕様4章の「半角英数字と一般的な記号のみ」） ---- */
function cleanName(s) {
  let t = String(s || "");
  // 全角英数字・全角スペースを半角へ寄せてから、残った全角・絵文字を落とす
  t = t.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  t = t.replace(/　/g, " ");
  // 活字の約物はASCIIへ置き換える（落とすと AKIBA'S が AKIBA S になる）
  t = t.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
       .replace(/[‐-―−]/g, "-").replace(/…/g, "...");
  // 残った全角・絵文字を落とす
  t = t.replace(/[^\x20-\x7E]/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

// 禁止語と機種名を取り除く。取り除いたものがあれば true を返す（status を review にする）
function stripExtras(name, opt) {
  let t = String(name || ""), hit = false;
  for (const re of BANNED) {
    if (re.test(t)) { hit = true; t = t.replace(re, " "); }
    re.lastIndex = 0;
  }
  // 機種名の除去はゲームだけ。フィギュアの名前から DS や GB を削ると壊れる。
  if (opt && opt.keepPlatform === true) {
    t = t.replace(/\s+/g, " ").replace(/^[\s\-–—:|/,]+|[\s\-–—:|/,]+$/g, "").trim();
    return { name: t, stripped: hit };
  }
  for (const w of PLATFORM_WORDS) {
    const re = new RegExp("(^|[\\s\\[\\(\\-])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[\\s\\]\\)\\-])", "gi");
    if (re.test(t)) { hit = true; t = t.replace(re, " "); }
  }
  // 記号だけが残った端を整える
  t = t.replace(/\s+/g, " ").replace(/^[\s\-–—:|/,]+|[\s\-–—:|/,]+$/g, "").trim();
  return { name: t, stripped: hit };
}

/* 候補の事前フィルタ（コード側）。
   商品の特定は ja_title と platform を正とし、eBay候補は英語表記の参考にだけ使う。
   gtin検索でも別商品が混ざるため、明らかに違うものはAIへ渡す前に落とす。 */
function filterCandidates(titles, item) {
  const want = platformKey(item.platform);
  const jaSet = SET_JA.test(String(item.ja_title || ""));
  const kept = [], dropped = [];
  for (const t of titles) {
    const found = platformsIn(t);
    // 入力と違う機種しか書かれていない候補は別商品
    if (want && found.length && !found.includes(want)) {
      dropped.push([t, "機種違い(" + found.join("/") + ")"]);
      continue;
    }
    // セット・まとめ売りは、元がセットでない限り別商品
    if (!jaSet && SET_EN.test(t)) {
      dropped.push([t, "セット品"]);
      continue;
    }
    kept.push(t);
  }
  return { kept, dropped };
}

/* english_name と同じ中身の候補がいくつあるか。
   記号と大小文字を落として突き合わせる（「2件以上が一致」の判定に使う）。 */
function looseKey(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function agreeCount(name, titles) {
  const k = looseKey(name);
  if (k.length < 4) return 0;
  return titles.filter((t) => looseKey(t).includes(k)).length;
}

/* ---- eBay Browse API ---- */
async function ebayToken(env) {
  const cached = await env.TITLE_CACHE.get("ebay:token");
  if (cached) return cached;
  const basic = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const resp = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!resp.ok) throw new Error("ebay_token_" + resp.status);
  const d = await resp.json();
  // 期限の少し手前まで保存する（仕様3.4-3）
  const ttl = Math.max(60, (d.expires_in || 7200) - 300);
  await env.TITLE_CACHE.put("ebay:token", d.access_token, { expirationTtl: ttl });
  return d.access_token;
}

async function ebaySearch(env, params, log) {
  const token = await ebayToken(env);
  const url = "https://api.ebay.com/buy/browse/v1/item_summary/search?" + params;
  const resp = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });
  log.push(`ebay ${params.split("&")[0]} -> ${resp.status}`);
  if (!resp.ok) return [];
  const d = await resp.json();
  return (d.itemSummaries || []).map((x) => x.title).filter(Boolean);
}

// gtin検索が0件なら、JANをそのままキーワード検索する（決定事項）
async function ebayCandidates(env, jan, log) {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) return { titles: [], via: "" };
  try {
    let titles = await ebaySearch(env, `gtin=${encodeURIComponent(jan)}&limit=${EBAY_LIMIT}`, log);
    if (titles.length) return { titles, via: "gtin" };
    titles = await ebaySearch(env, `q=${encodeURIComponent(jan)}&limit=${EBAY_LIMIT}`, log);
    return { titles, via: titles.length ? "q" : "" };
  } catch (e) {
    log.push("ebay_error " + e.message);
    return { titles: [], via: "" };
  }
}

/* ---- Amazon SP-API（Catalog Items 2022-04-01） ---- */
async function lwaToken(env, refresh, cacheKey) {
  const cached = await env.TITLE_CACHE.get(cacheKey);
  if (cached) return cached;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: env.LWA_CLIENT_ID,
    client_secret: env.LWA_CLIENT_SECRET,
  });
  const resp = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error("lwa_" + resp.status);
  const d = await resp.json();
  const ttl = Math.max(60, (d.expires_in || 3600) - 300);
  await env.TITLE_CACHE.put(cacheKey, d.access_token, { expirationTtl: ttl });
  return d.access_token;
}

// SigV4 署名は不要（LWAのアクセストークンのみ）
/* Catalog Items の中から機種を読み取る。
   属性 → 商品名 → ブラウズ分類の順に見て、最初に当たったキーを返す。 */
function spPlatformKey(it) {
  const texts = [];
  const at = it.attributes || {};
  ["platform", "hardware_platform", "video_game_platform", "compatible_devices"].forEach((k) => {
    (at[k] || []).forEach((x) => { if (x && typeof x.value === "string") texts.push(x.value); });
  });
  (it.summaries || []).forEach((sm) => {
    if (sm.browseClassification && sm.browseClassification.displayName)
      texts.push(sm.browseClassification.displayName);
    if (sm.itemName) texts.push(sm.itemName);
  });
  for (const t of texts) {
    const f = platformsIn(t);
    if (f.length) return f[0];
  }
  return "";
}
// ASIN が分かっていればそちらで引く（JANが商品と結びついていないことがあるため）
async function spCatalog(env, region, jan, log, asin) {
  const na = region === "na";
  const refresh = na ? env.SPAPI_REFRESH_TOKEN_NA : env.SPAPI_REFRESH_TOKEN_FE;
  // 米国は SPAPI_REFRESH_TOKEN_NA が登録されているときだけ動く（仕様3.4-4）
  if (!refresh || !env.LWA_CLIENT_ID || !env.LWA_CLIENT_SECRET) return null;
  const id = String(asin || "").trim() || jan;
  const idType = String(asin || "").trim() ? "ASIN" : "EAN";
  try {
    const token = await lwaToken(env, refresh, `lwa:${region}`);
    const host = na ? "sellingpartnerapi-na.amazon.com" : "sellingpartnerapi-fe.amazon.com";
    const mp = na ? MP_NA : MP_FE;
    const url = `https://${host}/catalog/2022-04-01/items?identifiers=${encodeURIComponent(id)}`
      + `&identifiersType=${idType}&marketplaceIds=${mp}&includedData=summaries,attributes`;
    const resp = await fetch(url, { headers: { "x-amz-access-token": token } });
    log.push(`spapi_${region} ${idType}=${id} -> ${resp.status}`);
    if (!resp.ok) return null;
    const d = await resp.json();
    const it = (d.items || [])[0];
    if (!it) return null;
    const sm = (it.summaries || [])[0] || {};
    return { title: sm.itemName || "", brand: sm.brand || "", model: sm.modelNumber || "",
             platformKey: spPlatformKey(it) };
  } catch (e) {
    log.push(`spapi_${region}_error ` + e.message);
    return null;
  }
}

/* ---- Claude API（英語名の抽出だけを任せる。組み立てはさせない） ---- */
const SYSTEM = [
  "You identify the official English product name of a Japanese video game.",
  "",
  "The Japanese name and the platform given below ARE the product. Candidate",
  "titles come from other sellers and may be a DIFFERENT product, a different",
  "platform, a bundle, or an accessory. Use them only as a reference for how",
  "the English name is spelled -- never to decide which product this is.",
  "",
  "Output ONLY a JSON object with exactly these keys:",
  '  "english_name", "confidence", "basis", "same_item"',
  '  confidence: "high" | "medium" | "low"',
  '  basis: "ebay" | "amazon_us" | "translation"',
  '  same_item: true only if at least one candidate is clearly the SAME game',
  "             for the SAME platform as the Japanese name given.",
  "",
  "Rules:",
  "- english_name is the GAME NAME ONLY.",
  "- Prefer the official English release title when it appears in the candidates",
  "  AND that candidate is the same product. If the candidates are a different",
  '  game, ignore them, translate the Japanese name, and set same_item to false.',
  "- Never merge two products into one name. If a candidate is a set or bundle,",
  "  do not copy the set wording.",
  "- Remove from it: console/platform names, region or import wording (Japan,",
  "  Japanese, Import, Ver., Version), condition wording (New, Sealed, Used,",
  "  CIB, Complete), seller decoration (Rare, L@@K, Fast Shipping, Free Ship,",
  "  exclamation marks) and shop names.",
  "- Never mention language support (English, Multi-language, Region Free).",
  "- If no candidate is usable, translate/romanize the Japanese name into the",
  '  form collectors search for, and set confidence to "low" and basis to',
  '  "translation".',
  "- Use only ASCII letters, digits and ordinary punctuation.",
  "- Do NOT output any text, code fences, or comments outside the JSON object.",
].join("\n");

async function askClaude(env, item, ebayTitles, us, jp, log) {
  const lines = [
    `Japanese name: ${item.ja_title || "(none)"}`,
    `Platform: ${item.platform || "(unknown)"}`,
    `eBay candidate titles:\n${ebayTitles.length ? ebayTitles.map((t) => "- " + t).join("\n") : "- (none)"}`,
    `Amazon US name: ${us && us.title ? us.title : "(none)"}`,
    `Amazon JP name: ${jp && jp.title ? jp.title : "(none)"}`,
  ].join("\n\n");
  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        messages: [{ role: "user", content: lines }],
      }),
    });
  } catch (e) {
    log.push("claude_unreachable");
    return null;
  }
  log.push("claude -> " + resp.status);
  if (!resp.ok) return null;
  let data;
  try { data = await resp.json(); } catch (e) { return null; }
  if (data && data.stop_reason === "refusal") return null;
  let out = "";
  for (const blk of (data.content || []))
    if (blk.type === "text" && blk.text) { out = blk.text; break; }
  let obj = null;
  try { obj = JSON.parse(out); } catch (e) {
    const m = out && out.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (e2) {} }
  }
  if (!obj || typeof obj.english_name !== "string") return null;
  return {
    english_name: obj.english_name,
    confidence: ["high", "medium", "low"].includes(obj.confidence) ? obj.confidence : "low",
    basis: ["ebay", "amazon_us", "translation"].includes(obj.basis) ? obj.basis : "translation",
    same_item: obj.same_item === true,
  };
}

/* =================== フィギュア（POST /figure-titles） ===================
   返すのは5項目（brand/series/chara/variant/line）だけ。タイトルの組み立ては
   pj_price 側の figTitleFrom() が行う（書式を2か所に持たない）。 */

// ASIN。10桁の英数字（B0… のほか ISBN-10 もある）
function validAsin(a) { return /^[A-Z0-9]{10}$/i.test(String(a || "").trim()); }

/* ブランドの正規化。pj_price の CSV_BRAND と同じ表記に揃える。
   大文字小文字は区別しない。 */
const FIG_BRAND = [
  ["バンプレスト", "Banpresto"], ["banpresto", "Banpresto"],
  ["バンダイスピリッツ", "Bandai Spirits"], ["bandai spirits", "Bandai Spirits"],
  ["グッドスマイル", "Good Smile Company"], ["good smile", "Good Smile Company"],
  ["コトブキヤ", "Kotobukiya"], ["kotobukiya", "Kotobukiya"],
  /* 魂ネイションズ（TAMASHII NATIONS）はバンダイスピリッツの事業ブランドなので、
     eBayのBrandとしては Bandai Spirits に寄せる（S.H.Figuarts・超合金も同じ）。 */
  ["魂ネイションズ", "Bandai Spirits"], ["tamashii nations", "Bandai Spirits"],
  ["オランジュ・ルージュ", "Orange Rouge"], ["orange rouge", "Orange Rouge"],
  ["マックスファクトリー", "Max Factory"], ["max factory", "Max Factory"],
  ["メガハウス", "MegaHouse"], ["megahouse", "MegaHouse"],
  ["メディコム", "MEDICOM"], ["medicom", "MEDICOM"],
  ["バンダイ", "Bandai"], ["bandai", "Bandai"],
  ["フリュー", "FuRyu"], ["furyu", "FuRyu"],
  ["セガ", "SEGA"], ["sega", "SEGA"],
  ["タイトー", "Taito"], ["taito", "Taito"],
  ["ウェーブ", "Wave"], ["wave", "Wave"],
  ["ワンダフルワークス", "Wonderful Works"], ["wonderful works", "Wonderful Works"],
];
/* 商品ライン。見つかれば line に入れ、ブランドが空なら親ブランドで補う。
   pj_price の CSV_LINE と揃える。 */
const FIG_LINE = [
  ["s.h.フィギュアーツ", "S.H.Figuarts", "Bandai Spirits"],
  ["s.h.figuarts", "S.H.Figuarts", "Bandai Spirits"],
  ["figuarts zero", "Figuarts ZERO", "Bandai Spirits"],
  ["ねんどろいど", "Nendoroid", "Good Smile Company"],
  ["nendoroid", "Nendoroid", "Good Smile Company"],
  ["figma", "figma", "Max Factory"],
  ["pop up parade", "POP UP PARADE", "Good Smile Company"],
  ["一番くじ", "Ichiban Kuji", "Banpresto"],
  ["ichiban kuji", "Ichiban Kuji", "Banpresto"],
  ["proplica", "PROPLICA", "Bandai Spirits"],
  ["超合金", "CHOGOKIN", "Bandai Spirits"],
  ["chogokin", "CHOGOKIN", "Bandai Spirits"],
];
function figBrand(t) {
  const s = String(t || "").toLowerCase();
  for (const [k, v] of FIG_BRAND) if (s.indexOf(k.toLowerCase()) >= 0) return v;
  return "";
}
/* 作品名などに付く飾りのハイフンを外す。
   「Touken Ranbu -ONLINE-」→「Touken Ranbu Online」。
   外した先が全部大文字なら頭だけ大文字に直す（ONLINE → Online）。
   語の途中のハイフン（Yu-Gi-Oh の類）は触らない。 */
function titleish(w) {
  const t = String(w || "").trim();
  // 4文字以上の全部大文字だけ直す。DX や ABS のような略語は残す
  if (/^[A-Z]{4,}$/.test(t)) return t.charAt(0) + t.slice(1).toLowerCase();
  return t;
}
function fixDecorHyphen(t) {
  let s = String(t || "");
  s = s.replace(/(^|\s)-\s*([^\s-][^-]*?)\s*-(?=\s|$)/g, (m, a, w) => a + titleish(w));
  s = s.replace(/(^|\s)-\s*([^\s-][^-]*?)(?=\s|$)/g, (m, a, w) => a + titleish(w));
  s = s.replace(/(\S)\s*-(?=\s|$)/g, "$1");
  return s.replace(/\s+/g, " ").trim();
}

/* ja_title からスケールを拾う。1/7スケール → 1/7 Scale。
   ノンスケールは空にする（タイトルに出さない）。 */
function scaleFrom(t) {
  const s = String(t || "");
  if (/ノンスケール|non[-\s]?scale/i.test(s)) return "";
  const m = s.match(/(\d{1,2})\s*[\/／]\s*(\d{1,2})\s*(?:スケール|scale)/i);
  return m ? `${m[1]}/${m[2]} Scale` : "";
}

// 商品ラインを拾う。見つかれば {line, brand}（brand は親ブランド）を返す。
function figLine(t) {
  const s = String(t || "").toLowerCase();
  for (const [k, v, b] of FIG_LINE) if (s.indexOf(k) >= 0) return { line: v, brand: b };
  return null;
}

/* セット品だけ落とす。別キャラクターの見分けはAIに任せる（仕様3.2-4）。 */
function figFilterCandidates(titles, jaTitle) {
  const jaSet = SET_JA.test(String(jaTitle || ""));
  const kept = [], dropped = [];
  for (const t of titles) {
    if (!jaSet && SET_EN.test(t)) { dropped.push([t, "セット品"]); continue; }
    kept.push(t);
  }
  return { kept, dropped };
}

// Catalog Items から EAN/UPC を拾う（ASINで引いたときにJANを判明させる）
function spEanFrom(it) {
  for (const g of (it.identifiers || []))
    for (const x of (g.identifiers || [])) {
      const ty = String(x.identifierType || "").toUpperCase();
      const v = String(x.identifier || "").trim();
      if ((ty === "EAN" || ty === "GTIN" || ty === "JAN") && validJan(v)) return v;
      if (ty === "UPC" && validJan("0" + v)) return "0" + v;
    }
  return "";
}
function spBrandFrom(it) {
  const at = it.attributes || {}, sm = (it.summaries || [])[0] || {};
  const first = (k) => (at[k] && at[k][0] && at[k][0].value) || "";
  return String(sm.brand || first("brand") || sm.manufacturer || first("manufacturer") || "").trim();
}

const FIG_SYSTEM = [
  "You extract eBay US Item Specifics for a Japanese collectible figure.",
  "",
  "The Japanese product name and the Amazon Japan catalog data ARE the product.",
  "eBay candidate titles come from other sellers and may be a DIFFERENT figure.",
  "Use them only as a reference for how names are spelled in English -- never to",
  "decide which product this is.",
  "",
  "Output ONLY a JSON object with exactly these keys:",
  '  "brand","series","series_short","chara","variant","line","confidence","same_item"',
  '  confidence: "high" | "medium" | "low"',
  '  same_item: true only if at least one candidate is clearly the SAME figure.',
  "",
  "Rules:",
  "- Fill a field only when it is present or unambiguously identifiable.",
  '  If it cannot be determined, use "" (empty string). Never guess.',
  "- chara is the character name, series is the work/franchise title. Use the",
  "  official English name when one exists; otherwise the official romanization.",
  "  NEVER invent a name that is not in the Japanese name or the candidates.",
  "- series_short is the shortest form of series that collectors still recognise.",
  '  It is used when the title runs too long (series "Atelier Ryza 2: Lost',
  '  Legends & the Secret Fairy" -> series_short "Atelier Ryza 2"). If series is',
  "  already short, repeat it in series_short.",
  "- Write names in normal title case. Do not copy ALL-CAPS wording or decorative",
  '  hyphens from the source ("Touken Ranbu -ONLINE-" -> "Touken Ranbu Online").',
  "- Do not put the scale (1/7 etc.) in any field; it is added separately.",
  "- brand is the manufacturer, normalized to its official spelling",
  "  (Banpresto, Bandai Spirits, Good Smile Company, Max Factory, Kotobukiya,",
  "  MegaHouse, Taito, SEGA, FuRyu, Tamashii Nations).",
  "- line is the product line, ONLY when stated in the name or the catalog",
  "  (Ichiban Kuji, Nendoroid, figma, POP UP PARADE, Figuarts ZERO, S.H.Figuarts).",
  "- variant is the version, pose, colour or prize letter",
  '  (e.g. "Prize A", "Special Color Ver."). Drop a trailing "ver.".',
  "- Never include language support, condition words, Japan, Import, Authentic,",
  "  shipping wording or seller decoration.",
  "- Use only ASCII letters, digits and ordinary punctuation.",
  "- Do NOT output any text, code fences, or comments outside the JSON object.",
].join("\n");

const FIG_FIELDS = ["brand", "series", "series_short", "chara", "variant", "line", "scale"];

async function figAskClaude(env, jaTitle, jp, titles, log) {
  const lines = [
    `Japanese name: ${jaTitle || "(none)"}`,
    `Amazon Japan name: ${jp && jp.title ? jp.title : "(none)"}`,
    `Amazon Japan brand: ${jp && jp.brand ? jp.brand : "(none)"}`,
    `eBay candidate titles:\n${titles.length ? titles.map((t) => "- " + t).join("\n") : "- (none)"}`,
  ].join("\n\n");
  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL, max_tokens: 300, system: FIG_SYSTEM,
        messages: [{ role: "user", content: lines }],
      }),
    });
  } catch (e) { log.push("claude_unreachable"); return null; }
  log.push("claude -> " + resp.status);
  if (!resp.ok) return null;
  let data;
  try { data = await resp.json(); } catch (e) { return null; }
  if (data && data.stop_reason === "refusal") return null;
  let out = "";
  for (const blk of (data.content || []))
    if (blk.type === "text" && blk.text) { out = blk.text; break; }
  let obj = null;
  try { obj = JSON.parse(out); } catch (e) {
    const m = out && out.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (e2) {} }
  }
  if (!obj) return null;
  const fields = {};
  for (const k of FIG_FIELDS) {
    const raw = typeof obj[k] === "string" ? obj[k] : "";
    fields[k] = fixDecorHyphen(stripExtras(cleanName(raw), { keepPlatform: true }).name);
  }
  // series_short が空なら series をそのまま使う
  if (!fields.series_short) fields.series_short = fields.series;
  return {
    fields,
    confidence: ["high", "medium", "low"].includes(obj.confidence) ? obj.confidence : "low",
    same_item: obj.same_item === true,
  };
}

async function handleFigure(env, item, force) {
  const log = [];
  const jan = String(item.jan || "").trim();
  const asin = String(item.asin || "").trim().toUpperCase();
  const hasJan = validJan(jan), hasAsin = validAsin(asin);
  const key = hasJan ? ("jan:" + jan) : (hasAsin ? ("asin:" + asin) : "");
  if (!key)
    return { key: "", status: "invalid_id", fields: emptyFields(), jan_resolved: "",
             sources: [], candidates: [], note: "JANもASINも正しくありません" };

  const ck = "fig:v1:" + key;
  if (!force) {
    const hit = await env.TITLE_CACHE.get(ck, "json");
    if (hit && hit.fields)
      return { key, status: hit.status || "review", fields: hit.fields,
               jan_resolved: hit.jan_resolved || "", sources: hit.sources || [],
               candidates: hit.candidates || [], note: "キャッシュ", cached: true };
  }

  // Amazon（日本）。JANがあればEAN、なければASINで引く
  const jp = await spCatalogFig(env, hasJan ? jan : asin, hasJan ? "EAN" : "ASIN", log);
  const janResolved = (!hasJan && jp && jp.ean) ? jp.ean : "";
  const gtin = hasJan ? jan : janResolved;

  // eBay はJAN（判明したものを含む）があるときだけ
  let eb = { titles: [], via: "" };
  if (gtin) eb = await ebayCandidates(env, gtin, log);
  const jaTitle = normRoman(String(item.ja_title || "")).slice(0, MAX_JA);
  const flt = figFilterCandidates(eb.titles, jaTitle);
  if (flt.dropped.length)
    log.push("除外 " + flt.dropped.map((d) => `${d[1]}: ${d[0]}`).join(" / "));
  const candidates = flt.kept.slice(0, MAX_CANDIDATES);

  if (!jp && !flt.kept.length && !jaTitle.trim())
    return { key, status: "not_found", fields: emptyFields(), jan_resolved: janResolved,
             sources: [], candidates: [], note: "Amazonでも見つからず、日本語名もありません", log };

  const ai = await figAskClaude(env, jaTitle, jp, flt.kept, log);
  if (!ai)
    return { key, status: "review", fields: emptyFields(), jan_resolved: janResolved,
             sources: [], candidates, note: "5項目を判定できませんでした", log };

  // ブランドと商品ラインはコード側の表でも正規化する（AIの揺れを吸収）
  const f = ai.fields;
  // スケールは和名から機械的に拾う（AIの推測に任せない）
  f.scale = scaleFrom(jaTitle) || scaleFrom((jp && jp.title) || "");
  const src = [jaTitle, (jp && jp.title) || "", f.line, f.brand].join(" ");
  const ln = figLine(src);
  if (ln) { if (!f.line) f.line = ln.line; if (!f.brand) f.brand = ln.brand; }
  const nb = figBrand(f.brand) || figBrand(src);
  if (nb) f.brand = nb;

  const sources = [];
  if (flt.kept.length) sources.push(eb.via === "q" ? "ebay_keyword" : "ebay");
  if (jp) sources.push(hasJan ? "amazon_jp_jan" : "amazon_jp_asin");

  /* status（仕様3.2-6）
     ok は confidence=high かつ same_item=true で、さらに
     ・絞り込み後の候補2件以上が chara と series の両方を含む
     ・または Amazon（日本）のブランドと brand が一致
     のどちらかを満たすとき。ASINのみで候補がない行は必ず review。 */
  const notes = [];
  if (flt.dropped.length) notes.push(`セット品の候補を${flt.dropped.length}件除外`);
  if (eb.via === "q") notes.push("gtin検索が0件のためキーワード検索の結果");
  if (janResolved) notes.push("ASINからJAN（" + janResolved + "）が判明");
  const agree = eb.via === "gtin" && f.chara && f.series
    && flt.kept.filter((t) => looseKey(t).includes(looseKey(f.chara))
                           && looseKey(t).includes(looseKey(f.series))).length >= 2;
  const brandHit = !!(jp && jp.brand && f.brand
    && figBrand(jp.brand).toLowerCase() === f.brand.toLowerCase());
  let status = "review";
  if (ai.confidence === "high" && ai.same_item && (agree || brandHit)) status = "ok";
  else if (!ai.same_item && flt.kept.length) notes.push("候補が同じ商品と確認できない");
  else if (!flt.kept.length) notes.push("eBay候補がありません");
  else notes.push("候補が少ないか確信度が中以下");
  // 初期運用の安全側：ASINのみでeBay候補がない行は必ず人の目で確かめる
  if (status === "ok" && (!gtin || !flt.kept.length)) {
    status = "review";
    notes.push(gtin ? "eBay候補がないので要確認" : "JANが分からずeBayで照合できていない");
  }
  if (!f.chara && !f.series) { status = "review"; notes.push("キャラクター名も作品名も取れていません"); }

  const result = { key, status, fields: f, jan_resolved: janResolved,
                   sources, candidates, note: notes.join("／") || "候補と一致", log };
  await env.TITLE_CACHE.put(ck,
    JSON.stringify({ fields: f, sources, candidates, status, jan_resolved: janResolved }),
    { expirationTtl: CACHE_TTL });
  return result;
}
function emptyFields() {
  const o = {}; for (const k of FIG_FIELDS) o[k] = ""; return o;
}
// フィギュア用のカタログ照会。JANが分かるように identifiers も取る
async function spCatalogFig(env, id, idType, log) {
  if (!env.SPAPI_REFRESH_TOKEN_FE || !env.LWA_CLIENT_ID || !env.LWA_CLIENT_SECRET) return null;
  try {
    const token = await lwaToken(env, env.SPAPI_REFRESH_TOKEN_FE, "lwa:fe");
    const url = "https://sellingpartnerapi-fe.amazon.com/catalog/2022-04-01/items"
      + `?identifiers=${encodeURIComponent(id)}&identifiersType=${idType}`
      + `&marketplaceIds=${MP_FE}&includedData=summaries,attributes,identifiers`;
    const resp = await fetch(url, { headers: { "x-amz-access-token": token } });
    log.push(`spapi_fe ${idType}=${id} -> ${resp.status}`);
    if (!resp.ok) return null;
    const d = await resp.json();
    const it = (d.items || [])[0];
    if (!it) return null;
    const sm = (it.summaries || [])[0] || {};
    return { title: sm.itemName || "", brand: spBrandFrom(it), ean: spEanFrom(it) };
  } catch (e) {
    log.push("spapi_fe_error " + e.message);
    return null;
  }
}

/* ---- 1件の処理（仕様3.4） ---- */
async function handleItem(env, item, force) {
  const log = [];
  const jan = String(item.jan || "").trim();
  if (!validJan(jan))
    return { jan, status: "invalid_jan", english_name: "", sources: [], candidates: [],
             note: "JANの桁数かチェックディジットが正しくありません" };

  const key = `title:v1:${jan}`;
  if (!force) {
    const hit = await env.TITLE_CACHE.get(key, "json");
    if (hit && hit.english_name)
      return { jan, status: hit.status || "ok", english_name: hit.english_name,
               sources: hit.sources || [], candidates: hit.candidates || [],
               platform_key: hit.platform_key || "", note: "キャッシュ", cached: true };
  }

  const eb = await ebayCandidates(env, jan, log);
  const [us, jp] = await Promise.all([
    spCatalog(env, "na", jan, log, item.asin),
    spCatalog(env, "fe", jan, log, item.asin),
  ]);

  /* 機種が分からない行は、Amazon（日本）から拾った機種で補う。
     キーだけ返し、表記の正規化は pj_price 側の PLATFORMS 表に任せる。 */
  let platKey = platformKey(item.platform);
  let platFilled = "";
  if (!platKey) {
    platKey = (jp && jp.platformKey) || (us && us.platformKey) || "";
    if (platKey) { platFilled = jp && jp.platformKey ? "amazon_jp" : "amazon_us"; }
  }
  const platItem = { ...item, platform: platKey || item.platform };

  // 全角ローマ数字を直してから渡す（雷電Ⅲ → 雷電III）
  const jaTitle = normRoman(String(item.ja_title || "")).slice(0, MAX_JA);
  // 機種違い・セット品はAIへ渡す前に落とす
  const flt = filterCandidates(eb.titles, { ...platItem, ja_title: jaTitle });
  const candidates = flt.kept.slice(0, MAX_CANDIDATES);
  if (flt.dropped.length)
    log.push("除外 " + flt.dropped.map((d) => `${d[1]}: ${d[0]}`).join(" / "));
  if (!eb.titles.length && !us && !jp && !jaTitle.trim())
    return { jan, status: "not_found", english_name: "", sources: [], candidates: [],
             platform_key: platKey, note: "候補も日本語名もありません", log };

  const ai = await askClaude(env, { ...platItem, ja_title: jaTitle }, flt.kept, us, jp, log);
  if (!ai)
    return { jan, status: "review", english_name: "", sources: [], candidates,
             platform_key: platKey, note: "英語名を判定できませんでした", log };

  const st = stripExtras(cleanName(ai.english_name));
  const english_name = st.name;
  if (!english_name)
    return { jan, status: "review", english_name: "", sources: [], candidates,
             platform_key: platKey, note: "英語名が空になりました", log };

  const sources = [];
  if (flt.kept.length) sources.push(eb.via === "q" ? "ebay_keyword" : "ebay");
  if (us && us.title) sources.push("amazon_us");
  if (jp && jp.title) sources.push("amazon_jp");
  if (!sources.length || ai.basis === "translation") sources.push("translation");

  /* status（仕様3.7）。タイトル長の判定は pj_price 側（buildGameTitle）で行う。
     ok にするのは、AIが「日本語名と同じ商品」と判断し確信度が high で、かつ
     ・絞り込み後の候補2件以上が同じ英語名で一致している（gtin検索）
     ・または Amazon US で見つかっている
     のいずれかを満たすときだけ。セット品は上で落としてあるので、
     セット同士の一致で ok になることはない。 */
  const agree = eb.via === "gtin" && agreeCount(english_name, flt.kept) >= 2;
  const notes = [];
  if (st.stripped) notes.push("候補から機種名・禁止語を除去");
  if (flt.dropped.length) notes.push(`別商品の候補を${flt.dropped.length}件除外`);
  if (eb.via === "q") notes.push("gtin検索が0件のためキーワード検索の結果");
  let status = "review";
  if (ai.confidence === "high" && ai.same_item && (agree || (us && us.title))) status = "ok";
  // 機種を補完した行は人の目で確かめてもらう
  if (platFilled) { notes.push("機種をAmazon（" + (platFilled === "amazon_jp" ? "日本" : "米国") + "）から補完"); }
  else if (!ai.same_item && flt.kept.length) notes.push("候補が同じ商品と確認できない");
  else if (ai.basis === "translation") notes.push("候補がなく翻訳で生成");
  else notes.push("候補が少ないか確信度が中以下");
  if (status === "ok" && (st.stripped || platFilled)) status = "review";

  const result = { jan, status, english_name, sources, candidates, platform_key: platKey,
                   note: notes.join("／") || "候補と一致", log };
  // タイトル本体は保存しない（仕様3.8）
  await env.TITLE_CACHE.put(key,
    JSON.stringify({ english_name, sources, candidates, status, platform_key: platKey }),
    { expirationTtl: CACHE_TTL });
  return result;
}

// 同時実行数を CONCURRENCY までに抑えて、順序は入力どおりに保つ
async function runPool(items, worker) {
  const out = new Array(items.length);
  let next = 0;
  async function lane() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await worker(items[i]); }
      catch (e) { out[i] = { jan: String(items[i] && items[i].jan || ""),
                             key: String(items[i] && items[i].jan || items[i] && items[i].asin || ""),
                             status: "review", english_name: "", fields: emptyFields(),
                             sources: [], candidates: [],
                             note: "処理中にエラー: " + e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, lane));
  return out;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(origin) });

    // ブラウザからの呼び出しは Origin を伴う。付いていて不一致なら拒否。
    if (origin && origin !== ALLOW_ORIGIN)
      return json({ error: "forbidden_origin" }, 403, origin);
    if (!authorized(request, env))
      return json({ error: "unauthorized" }, 401, origin);
    if (!env.TITLE_CACHE)
      return json({ error: "server_misconfigured", detail: "TITLE_CACHE" }, 500, origin);

    const isFig = (url.pathname === "/figure-titles");
    if (request.method !== "POST" || (url.pathname !== "/titles" && !isFig))
      return json({ error: "not_found" }, 404, origin);
    if (!env.ANTHROPIC_API_KEY)
      return json({ error: "server_misconfigured", detail: "ANTHROPIC_API_KEY" }, 500, origin);

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: "bad_request" }, 400, origin); }
    const items = Array.isArray(body && body.items) ? body.items : null;
    if (!items || !items.length) return json({ error: "no_items" }, 400, origin);
    if (items.length > MAX_ITEMS)
      return json({ error: "too_many_items", max: MAX_ITEMS }, 400, origin);

    const force = !!(body && body.force);
    const results = await runPool(items, (it) =>
      isFig ? handleFigure(env, it, force) : handleItem(env, it, force));
    return json({ results }, 200, origin);
  },
};
