/* 会員向け Discord の商品カード（8.11・【Y】）
   pj-sync（配信）と discord/test-post.mjs（形の確認）の**両方**で使うので、
   作り方はこの1ファイルだけに置く（pricing.js・subprice.js などと同じ決まり）。

   出すもの
     商品名（Amazon の商品ページへのリンク）／JAN／販売価格（税込）／
     会員の粗利の目安／残り数／送料の区分／購入リンク
   **出さないもの**（§8.2）
     卸値・社・MW在庫・MW の画像・備考・MW の商品番号・
     MW や pj の URL・仕入原価・上乗せの額

   販売価格は **Shopify に入っている値**（mw_sub.price）をそのまま出す。
   上乗せ（¥10〜150 の乱数）は「Shopify 用 CSV を書き出したとき」に決めて
   pj に控えてあるので、配信のときに引き直さない（6.178／8.11）。

   機種は **正式な呼び名**（NS → Nintendo Switch）で出す（8.15・【返事】）。
   呼び名の表は `shared/mwfee.js` の1か所だけ（Shopify の説明文と同じもの）。
   呼び名が分からない記号（NS2H・PP・GF・68）は記号のまま出す。 */
(function (root) {
  "use strict";
  var EMB_MAX = 10;                // 1通に入れられる箱の数
  var EMB_CHARS = 5600;            // 1通の字数（6,000 の手前）
  var COLOR = 0x1f8a3d;            // 会員用のカードの色（緑）
  var SOLD_COLOR = 0x8a8a8a;       // 完売の色（灰）
  /* 会員用では出してはいけない項目（§8.2 の NT_MEMBER_NG と同じ）。
     うっかり足さないように名前で持つ。テストで見張る。 */
  var MEMBER_NG = ["卸値", "社", "MW在庫", "備考", "画像"];
  /* 送料の区分（既定の言い方）。⚙ や config で変えられる。 */
  var SHIP_JA = {
    s: "小型（クリックポスト相当）",
    m: "レターパックプラス相当",
    l: "宅配便（箱）",
    unknown: "—（まだ採寸していません）"
  };
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function s(v) { return (v === null || v === undefined) ? "" : String(v); }
  /* 機種の正式な呼び名（8.15）。表は shared/mwfee.js の1か所だけ。
     読めないときは記号のまま出す（欄が消えないように）。
     ブラウザ … index.html が <script src> で読む（globalThis.PJ_MWFEE）
     pj-sync  … worker.js が import している（同じく globalThis に入る）
     Node     … require で読む */
  function kishuJa(v) {
    var g = (typeof globalThis !== "undefined") ? globalThis : root;
    var F = (g && g.PJ_MWFEE) ? g.PJ_MWFEE : null;
    if (!F && typeof require === "function") {
      try { F = require("./mwfee.js"); } catch (e) { F = null; }
    }
    if (F && typeof F.kishuJa === "function") return F.kishuJa(v);
    return s(v).trim();
  }
  function yen(n) {
    return "¥" + Math.round(num(n)).toLocaleString("en-US");
  }
  /* Amazon の商品ページ（ASIN が分かれば dp、無ければ JAN の検索）。 */
  function amzUrl(jan, asin) {
    return /^B[0-9A-Z]{9}$/.test(s(asin))
      ? ("https://www.amazon.co.jp/dp/" + asin)
      : ("https://www.amazon.co.jp/s?k=" + encodeURIComponent(s(jan)));
  }
  /* 送料の区分。Amazon のサイズ区分（size_tier）をそのまま使い、
     無ければ重さで見る。 */
  function shipTier(r) {
    var t = s((r || {}).size_tier).toLowerCase();
    if (t === "s" || t === "m" || t === "l") return t;
    var g = num((r || {}).size_g);
    if (!g) return "unknown";
    return g <= 250 ? "s" : (g <= 9000 ? "m" : "l");
  }
  function shipJa(r, map) {
    var m = {}, k;
    for (k in SHIP_JA) if (SHIP_JA.hasOwnProperty(k)) m[k] = SHIP_JA[k];
    for (k in (map || {})) if ((map || {}).hasOwnProperty(k)) m[k] = map[k];
    return m[shipTier(r)] || m.unknown;
  }
  /* 購入リンク（Shopify の商品ページ）。ドメインが無ければ空。 */
  function buyUrl(domain, jan) {
    var d = s(domain).trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    var j = s(jan).replace(/\D/g, "");
    if (!d || j.length < 8) return "";
    return "https://" + d + "/products/sub-" + j;
  }
  /* 残りの文。0 なら「完売」。 */
  function leftText(left, qty, maxQty) {
    var n = Math.max(0, Math.round(num(left)));
    if (!n) return "**完売しました**";
    return (num(maxQty) > 0 ? ("お一人 " + Math.round(num(maxQty)) + "点まで／") : "")
      + "残り " + n + "点";
  }
  /* 1商品ぶんの箱。
     it … { jan, name, asin, price, gross, left, qty, size_tier, size_g }
     o  … { domain, maxQty, shipJa, head, color, mark, note } */
  function card(it, o) {
    var x = it || {}, opt = o || {};
    var jan = s(x.jan);
    /* left（残り）が無ければ qty をそのまま残りとする（配信したて）。 */
    var left = Math.max(0, Math.round(
      (x.left === undefined || x.left === null) ? num(x.qty) : num(x.left)));
    var f = [];
    /* JAN は**コードの書式で1行に単独**（長押しでコピーできる形・§8.2）。 */
    f.push({ name: "JAN", value: "```\n" + jan + "\n```", inline: false });
    /* 8.15（【返事】）記号ではなく正式な呼び名で出す（会員が読むので）。 */
    var kishu = kishuJa(x.kishu);
    if (kishu) f.push({ name: "機種", value: kishu.slice(0, 60),
                        inline: true });
    f.push({ name: "販売価格（税込）", value: yen(x.price), inline: true });
    if (x.gross !== null && x.gross !== undefined)
      f.push({ name: "見込みの Amazon 粗利", value: yen(x.gross), inline: true });
    f.push({ name: "購入できる数",
             value: leftText(left, x.qty, opt.maxQty), inline: true });
    f.push({ name: "送料の区分", value: shipJa(x, opt.shipJa), inline: true });
    var u = buyUrl(opt.domain, jan);
    f.push({ name: "購入リンク",
             value: left
               ? (u ? ("[購入する](" + u + ")")
                    : "**準備中**（本番はここに購入リンクが入ります）")
               : "**完売しました**（次の配信をお待ちください）",
             inline: false });
    var mark = s(opt.mark);
    return {
      title: ((mark ? (mark + "｜") : "") + s(x.name || jan)).slice(0, 200),
      url: amzUrl(jan, x.asin),
      color: left ? (num(opt.color) || COLOR) : SOLD_COLOR,
      fields: f.slice(0, 25),
      footer: opt.note ? { text: s(opt.note).slice(0, 2048) } : undefined
    };
  }
  function cardLen(e) {
    var o = e || {}, n = s(o.title).length + s(o.description).length
      + s((o.footer || {}).text).length;
    for (var i = 0; i < (o.fields || []).length; i++)
      n += s(o.fields[i].name).length + s(o.fields[i].value).length;
    return n;
  }
  /* 箱を 10個ずつ・5,600字ずつに分けて、送る通に組み立てる。 */
  function split(list, head) {
    var out = [], cur = [], len = 0;
    for (var i = 0; i < (list || []).length; i++) {
      var n = cardLen(list[i]);
      if (cur.length && (cur.length >= EMB_MAX || len + n > EMB_CHARS)) {
        out.push(cur); cur = []; len = 0;
      }
      cur.push(list[i]); len += n;
    }
    if (cur.length) out.push(cur);
    return out.map(function (es, i) {
      return { content: i === 0 ? s(head) : "", embeds: es };
    });
  }
  var API = { card: card, cardLen: cardLen, split: split, kishuJa: kishuJa,
              buyUrl: buyUrl, amzUrl: amzUrl, shipTier: shipTier,
              shipJa: shipJa, leftText: leftText, yen: yen,
              EMB_MAX: EMB_MAX, EMB_CHARS: EMB_CHARS, COLOR: COLOR,
              SOLD_COLOR: SOLD_COLOR, MEMBER_NG: MEMBER_NG, SHIP_JA: SHIP_JA };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_SUBCARD = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
