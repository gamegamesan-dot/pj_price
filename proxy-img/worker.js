/*
 * pj_price 専用 画像ホスティング（Cloudflare Worker + R2）
 * ------------------------------------------------------------
 * 目的: eBay の CSV 一括出品（PicURL）に渡せる公開URLを用意する。
 *       eBay 側が画像を取得しに来るので、配信は認証なしで公開する。
 *
 * 既存の proxy/（商品名パース）とは別 Worker にしてある。用途ごとに分け、
 * 片方の障害や誤設定をもう片方へ波及させない。
 *
 * バインディング:
 *   IMG           … R2 バケット pj-img
 *   UPLOAD_TOKEN  … アップロード用の合言葉（wrangler secret put で登録。ここには書かない）
 *
 * エンドポイント:
 *   POST   /upload   … 画像を1枚保存。Authorization: Bearer <UPLOAD_TOKEN> 必須
 *   GET    /i/<key>  … 公開配信（認証なし）
 *   DELETE /i/<key>  … 削除。トークン必須
 *
 * 悪用対策:
 *   - アップロードと削除はトークン必須。CORS は pj_price の Pages オリジンに限定
 *   - Content-Type は画像3種のみ、サイズ上限あり
 *   - キーはサーバ側で生成（クライアントに任意のパスを切らせない）
 */

const ALLOW_ORIGIN = "https://gamegamesan-dot.github.io"; // pj_price の公開元
const MAX_BYTES = 5 * 1024 * 1024;                        // 1枚 5MB まで
const TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const PUBLIC_CACHE = "public, max-age=31536000, immutable"; // キーは使い回さないので長めで良い

function corsHeaders(origin) {
  // 許可オリジンのみ返す（未知オリジンには ACAO を付けない）
  const h = {
    "Access-Control-Allow-Methods": "POST, DELETE, GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
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

// Authorization: Bearer <token> を定数時間で照合する
function authorized(request, env) {
  if (!env.UPLOAD_TOKEN) return false;
  const h = request.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const a = m[1], b = env.UPLOAD_TOKEN;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// キーはサーバ側で決める: YYYYMMDD/<uuid>.<ext>
function makeKey(ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const day = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  return `${day}/${crypto.randomUUID()}.${ext}`;
}

// /i/<key> の <key> を取り出す。.. や先頭スラッシュは弾く。
function keyFromPath(pathname) {
  const raw = pathname.slice("/i/".length);
  if (!raw) return null;
  let key;
  try { key = decodeURIComponent(raw); } catch (e) { return null; }
  if (key.startsWith("/") || key.includes("..") || key.length > 200) return null;
  if (!/^[0-9]{8}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) return null;
  return key;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(origin) });

    if (!env.IMG) return json({ error: "server_misconfigured" }, 500, origin);

    /* ---- 公開配信。eBay が取りに来るので認証も Origin 制限もしない ---- */
    if (request.method === "GET" && url.pathname.startsWith("/i/")) {
      const key = keyFromPath(url.pathname);
      if (!key) return new Response("not found", { status: 404 });
      const obj = await env.IMG.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      const h = new Headers();
      obj.writeHttpMetadata(h);                       // R2 に保存した content-type をそのまま
      if (!h.get("content-type")) h.set("content-type", "application/octet-stream");
      h.set("cache-control", PUBLIC_CACHE);
      h.set("etag", obj.httpEtag);
      h.set("access-control-allow-origin", "*");      // 画像そのものは誰でも取得できてよい
      return new Response(obj.body, { headers: h });
    }

    // ここから下はブラウザからの呼び出し。Origin が付いていて不一致なら拒否。
    if (origin && origin !== ALLOW_ORIGIN)
      return json({ error: "forbidden_origin" }, 403, origin);

    /* ---- アップロード ---- */
    if (request.method === "POST" && url.pathname === "/upload") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401, origin);

      const ct = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const ext = TYPES[ct];
      if (!ext) return json({ error: "unsupported_type", allowed: Object.keys(TYPES) }, 415, origin);

      const len = Number(request.headers.get("content-length") || 0);
      if (len > MAX_BYTES) return json({ error: "too_large", max: MAX_BYTES }, 413, origin);

      const body = await request.arrayBuffer();
      if (body.byteLength === 0) return json({ error: "empty_body" }, 400, origin);
      if (body.byteLength > MAX_BYTES) return json({ error: "too_large", max: MAX_BYTES }, 413, origin);

      const key = makeKey(ext);
      await env.IMG.put(key, body, {
        httpMetadata: { contentType: ct, cacheControl: PUBLIC_CACHE },
      });
      return json({ url: `${url.origin}/i/${key}`, key }, 200, origin);
    }

    /* ---- 削除 ---- */
    if (request.method === "DELETE" && url.pathname.startsWith("/i/")) {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401, origin);
      const key = keyFromPath(url.pathname);
      if (!key) return json({ error: "bad_key" }, 400, origin);
      await env.IMG.delete(key);
      return json({ ok: true, key }, 200, origin);
    }

    return json({ error: "not_found" }, 404, origin);
  },
};
