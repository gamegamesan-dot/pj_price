/*
 * pj_price 専用 商品名パースプロキシ（Cloudflare Worker）
 * ------------------------------------------------------------
 * 目的: 公開リポジトリ/GitHub Pages に Anthropic APIキーを置かずに、
 *       貼り付けた商品名を 5項目(brand/series/chara/variant/line)へ分解する。
 * 鍵は Cloudflare の Secret(env.ANTHROPIC_API_KEY) に置く（このファイルには書かない）。
 *
 * このWorkerは pj_price 専用。eBay CSV出品 / keepa-hunter など他用途では
 * 用途ごとに別Workerを立てること（1本に集約しない。片方の障害を波及させない）。
 *
 * 設計上の悪用対策:
 *   - モデル/systemプロンプト/max_tokens をサーバ側で固定（汎用プロキシにしない）
 *   - CORSを pj_price のPagesオリジンに限定、Originが不一致なら拒否
 *   - 入力サイズ上限・max_tokens小・haiku固定でコスト上限を抑制
 *   - レート制限は Cloudflare ダッシュボードの Rate Limiting ルールで運用
 */

const ALLOW_ORIGIN = "https://gamegamesan-dot.github.io"; // pj_price の公開元
const MODEL = "claude-haiku-4-5";
const MAX_INPUT = 2048;      // 貼り付けテキストの上限（バイト目安）
const MAX_TOKENS = 300;      // 5項目のJSONに十分

const SYSTEM = [
  "You extract eBay US Item Specifics from a pasted product name for Japanese",
  "anime figures and collectibles. The input may be Japanese, an eBay English",
  "title, or labeled text like 'Brand: ... / Character: ...'.",
  "",
  "Output ONLY a JSON object with exactly these keys:",
  '  "brand","series","chara","variant","line"',
  "All values must be English suitable for eBay Item Specifics (US).",
  "",
  "Rules:",
  "- Fill a field only when it is present or unambiguously identifiable.",
  '  If it cannot be determined, use "" (empty string). Never guess.',
  "- Translate/romanize Japanese to the English form collectors search for",
  "  (e.g. 機動戦士ガンダムSEED FREEDOM -> Gundam SEED Freedom;",
  "  ラクス・クライン -> Lacus Clyne; パイロットスーツ -> Pilot Suit).",
  "- brand = manufacturer/label (Banpresto, Good Smile Company, SEGA, ...).",
  "  Note: 一番くじ / Ichiban Kuji is a Banpresto (Bandai Spirits) lottery",
  '  brand -> brand "Banpresto".',
  "- series = franchise/work title. chara = character name.",
  "- variant = version/edition/pose; drop a trailing 'ver.'.",
  "- line = product line/label (e.g. Glitter & Glamours).",
  "- Do NOT output any text, code fences, or comments outside the JSON object.",
  "",
  "Examples:",
  "Input: 一番くじ 機動戦士ガンダムSEED FREEDOM",
  "Glitter & Glamours ラクス・クライン パイロットスーツver.",
  'Output: {"brand":"Banpresto","series":"Gundam SEED Freedom","chara":"Lacus Clyne","variant":"Pilot Suit","line":"Glitter & Glamours"}',
  "",
  "Input: Banpresto Gundam SEED Freedom Glitter Glamours Lacus Clyne Figure",
  'Output: {"brand":"Banpresto","series":"Gundam SEED Freedom","chara":"Lacus Clyne","variant":"","line":"Glitter & Glamours"}',
  "",
  "Input: Brand: Banpresto",
  "Character: Lacus Clyne",
  "Franchise: Gundam SEED Freedom",
  'Output: {"brand":"Banpresto","series":"Gundam SEED Freedom","chara":"Lacus Clyne","variant":"","line":""}',
].join("\n");

const FIELDS = ["brand", "series", "chara", "variant", "line"];

function corsHeaders(origin) {
  // 許可オリジンのみ返す（未知オリジンには ACAO を付けない）
  const h = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
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

// モデル出力から最初のJSONオブジェクトを取り出し、5項目の文字列に正規化
function normalize(raw) {
  let obj = null;
  try { obj = JSON.parse(raw); } catch (e) {
    const m = raw && raw.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (e2) {} }
  }
  const out = {};
  for (const k of FIELDS) {
    const v = obj && typeof obj[k] === "string" ? obj[k].trim() : "";
    out[k] = v;
  }
  return out;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(origin) });

    if (request.method !== "POST")
      return json({ error: "method_not_allowed" }, 405, origin);

    // ブラウザからの呼び出しは Origin を伴う。付いていて不一致なら拒否。
    if (origin && origin !== ALLOW_ORIGIN)
      return json({ error: "forbidden_origin" }, 403, origin);

    if (!env.ANTHROPIC_API_KEY)
      return json({ error: "server_misconfigured" }, 500, origin);

    let text = "";
    try {
      const body = await request.json();
      text = (body && typeof body.text === "string" ? body.text : "").slice(0, MAX_INPUT);
    } catch (e) {
      return json({ error: "bad_request" }, 400, origin);
    }
    if (!text.trim()) return json({ error: "empty_text" }, 400, origin);

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
          messages: [{ role: "user", content: text }],
        }),
      });
    } catch (e) {
      return json({ error: "upstream_unreachable" }, 502, origin);
    }

    if (!resp.ok)
      return json({ error: "upstream_error", status: resp.status }, 502, origin);

    let data;
    try { data = await resp.json(); } catch (e) {
      return json({ error: "upstream_bad_json" }, 502, origin);
    }
    if (data && data.stop_reason === "refusal")
      return json(normalize(""), 200, origin); // 拒否時は全空（手入力に委ねる）

    let out = "";
    for (const blk of (data.content || []))
      if (blk.type === "text" && blk.text) { out = blk.text; break; }

    return json(normalize(out), 200, origin);
  },
};
