/* 海外の一般のお客さん向け Shopify の商品CSV（os-）を作る。**この1か所だけ**
   （6.193・2026-11-13・【1】MW 無在庫の eBay 出品と同時に書き出す）。

   読み込み方
     ブラウザ … <script src="./shared/osscsv.js"></script>（素のスクリプト）
                 読み込むと globalThis.PJ_OSSCSV に入る
     テスト   … require('../shared/osscsv.js')

   会員向け（shared/shopcsv.js・sub-）とは**別の商品**として出す。
   ・Handle は os-<JAN>（会員は sub-<JAN>）
   ・会員の印（member-list・grade-*）は**絶対に付けない**
   ・会員向けの印が付いた行は、ここでは**行ごと外す**（取り違え防止・【4】）

   列の名前は**このストアが書き出す古い形**（Handle / Body (HTML) /
   Variant Price …）にそろえる。上書き（Overwrite products with matching
   handles）で列名が違うとずれるため。

   決まり
   ・画面の欄（$('…')）も Worker の設定（env）もここでは読まない。
     入れるのは「品物の配列と設定」だけ、出すのは「CSV の文字列」だけ
   ・画像は **MW が利用を許諾した画像だけ**。Amazon の画像は使わない
     （念のため Amazon の画像置き場のアドレスは行ごと弾く）
   ・MW の商品番号・卸値・社・MW在庫・備考・仕入先は**出さない**
   ・eBay の出品文から **eBay 固有の文言・eBay へのリンク**を外して載せる
     （eBay 側には Shopify への誘導を一切入れない＝今の決まりのまま） */
(function () {
  "use strict";
  var root = (typeof globalThis !== "undefined") ? globalThis : this;

  /* ---- 出す列（このストアの形＝古い名前）---- */
  var COLS = [
    "Handle",
    "Title",
    "Body (HTML)",
    "Vendor",
    "Type",
    "Tags",
    "Published",
    "Option1 Name",
    "Option1 Value",
    "Variant SKU",
    "Variant Grams",
    "Variant Weight Unit",
    "Variant Inventory Tracker",
    "Variant Inventory Qty",
    "Variant Inventory Policy",
    "Variant Fulfillment Service",
    "Variant Price",
    "Variant Requires Shipping",
    "Variant Taxable",
    "Image Src",
    "Image Position",
    "Status",
    "Cost per item"
  ];
  /* 在庫・値段を直すだけの CSV（【3】）。触らない項目は**列ごと出さない**
     （上書きで空にしないため）。 */
  var UPD_COLS = [
    "Handle",
    "Option1 Name",
    "Option1 Value",
    "Variant SKU",
    "Variant Inventory Qty",
    "Variant Inventory Policy",
    "Variant Price",
    "Status"
  ];

  var HANDLE_PRE = "os-";          // 海外向け
  var SUB_PRE = "sub-";            // 会員向け（shared/shopcsv.js）。混ぜない
  var ONE_PRE = "one-";            // 会員向けの1点もの（8.22）。混ぜない
  var SKU_PRE = "W-";              // eBay の CustomLabel と同じ
  var TAG_EXPORT = "export";
  /* 会員向けの印。ここでは**絶対に付けない**（【4】）。 */
  var TAG_NG = [/^member-list$/i, /^grade-/i];
  var OPT1 = { name: "Title", value: "Default Title" };
  var PCT_DEF = 100;               // ⚙「海外向け価格 ＝ eBay の売値 × ◯%」
  var IMG_MAX = 10;                // 1商品に載せる画像の上限
  /* Amazon の画像置き場。MW が許諾した画像だけを使うので、ここは弾く。 */
  var IMG_NG = [/(^|\.)media-amazon\.com$/i, /(^|\.)images-amazon\.com$/i,
                /(^|\.)ssl-images-amazon\.com$/i, /(^|\.)amazon\.[a-z.]+$/i];

  /* ---- 小道具 ---- */
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function s(v) { return (v === null || v === undefined) ? "" : String(v); }
  function digits(v) { return s(v).replace(/\D/g, ""); }
  function janOk(v) { return /^\d{8,14}$/.test(digits(v)); }

  function handleOf(jan) { return HANDLE_PRE + digits(jan); }
  function skuOf(jan) { return SKU_PRE + digits(jan); }
  function isOs(h) { return s(h).toLowerCase().indexOf(HANDLE_PRE) === 0; }
  function isSub(h) { return s(h).toLowerCase().indexOf(SUB_PRE) === 0; }
  /* 8.22：1点もの（one-）も会員向け。海外向けには混ぜない。 */
  function isOne(h) { return s(h).toLowerCase().indexOf(ONE_PRE) === 0; }
  function memberish(r) {
    var x = r || {};
    return !!(x.member || x.one || isSub(x.handle) || isOne(x.handle));
  }

  /* ---- 日付とファイル名（【7】）----
     1回の書き出しで eBay 用と Shopify 用の2つを出す。名前に
     日付・通し番号・件数を入れる（例 ebay-mw-20261113-01-100.csv）。 */
  function ymd(d) {
    var t = (d instanceof Date) ? d : (d ? new Date(d) : new Date());
    if (isNaN(t.getTime())) t = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return String(t.getFullYear()) + p(t.getMonth() + 1) + p(t.getDate());
  }
  function seq2(n) {
    var i = Math.max(1, Math.round(num(n)) || 1);
    return (i < 10 ? "0" : "") + i;
  }
  function fileName(pre, d, seq, n) {
    return s(pre) + "-" + ymd(d) + "-" + seq2(seq) + "-"
      + Math.max(0, Math.round(num(n))) + ".csv";
  }
  function ebayName(d, seq, n) { return fileName("ebay-mw", d, seq, n); }
  function shopName(d, seq, n) { return fileName("shopify-os", d, seq, n); }
  function updName(d, seq, n) { return fileName("shopify-os-fix", d, seq, n); }

  /* ---- 機種の正式な呼び名 ----
     表は shared/mwfee.js の1か所だけ（6.186）。読めないときは記号のまま。 */
  function feeMod() {
    var g = (typeof globalThis !== "undefined") ? globalThis : root;
    if (g && g.PJ_MWFEE) return g.PJ_MWFEE;
    if (typeof require === "function") {
      try { return require("./mwfee.js"); } catch (e) { /* 無くても止めない */ }
    }
    return null;
  }
  function kishuJa(v) {
    var F = feeMod();
    if (F && typeof F.kishuJa === "function") return F.kishuJa(v);
    return s(v).trim();
  }

  /* ---- 商品名（英語）----
     eBay の英題をそのまま使う。Shopify の上限（255字）で切る。 */
  function titleOf(it, max) {
    var t = s((it || {}).titleEn).replace(/\s+/g, " ").trim();
    var n = Math.round(num(max)) || 255;
    return t.length > n ? t.slice(0, n).trim() : t;
  }

  /* ---- 説明（Body (HTML)）----
     eBay の出品文から、**eBay 固有の文言と eBay へのリンク**を外す。
     ・「Shipping and payments section」「this listing」は eBay の画面の話
     ・「message us through eBay」は eBay のメッセージ機能の話
     ・「import duties are prepaid」は eBay の輸入関税前払いの話
       （Shopify では成り立たないので丸ごと外す）
     文を消すだけだと見出しだけが残るので、置き換えられる文は置き換える。 */
  var BODY_REPL = [
    [/Delivery speed and carrier options are shown in the Shipping and payments section of this listing\./gi,
      "Delivery options and costs are shown at checkout."],
    [/Returns are accepted under the terms shown in the Shipping and payments section\.\s*If anything arrives damaged or not as described, message us through eBay first and it will be put right\./gi,
      "If anything arrives damaged or not as described, contact us first and it will be put right."]
  ];
  /* これが入っている <p>・<li> は丸ごと外す。 */
  var BODY_CUT = [/\bebay\b/i, /shipping and payments/i, /\bthis listing\b/i,
                  /best offer/i, /watch list/i, /import duties are prepaid/i];
  function cutIt(html) {
    var t = s(html);
    for (var i = 0; i < BODY_CUT.length; i++) if (BODY_CUT[i].test(t)) return true;
    return false;
  }
  function stripEbay(html) {
    var t = s(html);
    /* eBay へのリンクは外す（中の文字は残す）。 */
    t = t.replace(/<a\b[^>]*href\s*=\s*["'][^"']*ebay\.[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, "$1");
    /* 置き換えられる文は置き換える。 */
    for (var i = 0; i < BODY_REPL.length; i++) t = t.replace(BODY_REPL[i][0], BODY_REPL[i][1]);
    /* 残った eBay 固有の文は、その <li>・<p> ごと外す。 */
    t = t.replace(/<li\b[^>]*>[\s\S]*?<\/li>/gi, function (m) { return cutIt(m) ? "" : m; });
    t = t.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, function (m) { return cutIt(m) ? "" : m; });
    /* 中身が空になった箇条書きと、見出しだけになった段を外す。 */
    t = t.replace(/<ul\b[^>]*>\s*<\/ul>/gi, "");
    t = t.replace(/<h2\b[^>]*>[\s\S]*?<\/h2>(?=\s*(?:<h2|<div|<\/div|$))/gi, "");
    /* HTML のコメント（<!--TITLE--> など・eBay 側の差し替えの目印）は外す。 */
    t = t.replace(/<!--[\s\S]*?-->/g, "");
    return t.trim();
  }
  function bodyOf(it, opt) {
    var o = opt || {};
    var t = stripEbay((it || {}).descHtml);
    var tail = s(o.tail).trim();
    return tail ? (t + tail) : t;
  }

  /* ---- 値段（円）----
     eBay の売値（USD・送料込みの総額）を ⚙ の為替で円に直し、
     ⚙「海外向け価格 ＝ eBay の売値 × ◯%」（既定 100%）を掛ける。
     Shopify 側も**送料込みの値段**にする（送料無料の配送オプションを使う）。 */
  function pctOf(opt) {
    var p = num((opt || {}).pct);
    return (p > 0) ? p : PCT_DEF;
  }
  function yenOf(usd, opt) {
    var o = opt || {};
    var fx = num(o.fx);
    var v = num(usd) * fx * (pctOf(o) / 100);
    return (v > 0) ? Math.round(v) : 0;
  }
  function priceOf(it, opt) { return yenOf((it || {}).usd, opt); }

  /* ---- 重さ ----
     eBay の送料計算に使っている重さ（梱包マージン込み）をそのまま使う。 */
  function gramsOf(it) {
    var g = Math.round(num((it || {}).grams));
    return g > 0 ? g : 0;
  }
  function qtyOf(it) { return Math.max(0, Math.round(num((it || {}).qty))); }
  function costOf(it) {
    var c = Math.round(num((it || {}).cost));
    return c > 0 ? String(c) : "";
  }

  /* ---- 画像 ----
     MW が利用を許諾した画像だけ（eBay の出品に使っているものと同じ）。
     Amazon の画像置き場は弾く。 */
  function hostOf(u) {
    var m = /^https?:\/\/([^/?#]+)/i.exec(s(u).trim());
    return m ? m[1].replace(/:\d+$/, "").toLowerCase() : "";
  }
  function picOk(u) {
    var h = hostOf(u);
    if (!h) return false;
    for (var i = 0; i < IMG_NG.length; i++) if (IMG_NG[i].test(h)) return false;
    return true;
  }
  function picsOf(it, opt) {
    var o = opt || {};
    var max = Math.round(num(o.imgMax)) || IMG_MAX;
    var out = [], seen = {};
    var a = ((it || {}).pics) || [];
    for (var i = 0; i < a.length && out.length < max; i++) {
      var u = s((a[i] && a[i].url !== undefined) ? a[i].url : a[i]).trim();
      if (!picOk(u) || seen[u]) continue;
      seen[u] = 1; out.push(u);
    }
    return out;
  }

  /* ---- Tags ----
     export と機種。会員の印（member-list・grade-*）は絶対に付けない。 */
  function tagNg(t) {
    for (var i = 0; i < TAG_NG.length; i++) if (TAG_NG[i].test(s(t).trim())) return true;
    return false;
  }
  function tagsOf(it, opt) {
    var o = opt || {};
    var r = it || {};
    var out = [], add = function (x) {
      var t = s(x).trim();
      if (!t || tagNg(t)) return;
      for (var i = 0; i < out.length; i++) if (out[i].toLowerCase() === t.toLowerCase()) return;
      out.push(t);
    };
    add(TAG_EXPORT);
    add(kishuJa(r.kishu));
    var more = o.tags || [];
    for (var i = 0; i < more.length; i++) add(more[i]);
    return out;
  }

  /* ---- 外す行の理由（【7】のまとめに出す）----
     '' を返したら出せる。 */
  function whyNot(it, opt) {
    var r = it || {};
    if (!janOk(r.jan)) return "JAN がありません";
    /* 会員向けの行は海外向けに混ぜない（【4】）。 */
    if (memberish(r)) return "会員向けの行です";
    if (!titleOf(r)) return "英題がありません";
    if (!s(r.descHtml).trim()) return "英語の説明がありません";
    if (priceOf(r, opt) <= 0) return "値段が出せません（eBay の売値か為替が0）";
    if (qtyOf(r) <= 0) return "数量が0です";
    if (!picsOf(r, opt).length) return "MW の画像がありません";
    return "";
  }

  /* ---- 1行 ---- */
  function rowOf(it, opt) {
    var o = opt || {};
    var r = it || {};
    var jan = digits(r.jan);
    var o1 = o.option1 || OPT1;
    var pics = picsOf(r, o);
    var row = {};
    row["Handle"] = handleOf(jan);
    row["Title"] = titleOf(r);
    row["Body (HTML)"] = bodyOf(r, o);
    row["Vendor"] = s(o.vendor);
    row["Type"] = s(r.type || o.type);
    row["Tags"] = tagsOf(r, o).join(", ");
    row["Published"] = "true";
    row["Option1 Name"] = s(o1.name);
    row["Option1 Value"] = s(o1.value);
    row["Variant SKU"] = skuOf(jan);
    row["Variant Grams"] = String(gramsOf(r));
    row["Variant Weight Unit"] = "g";
    row["Variant Inventory Tracker"] = "shopify";
    row["Variant Inventory Qty"] = String(qtyOf(r));
    row["Variant Inventory Policy"] = "deny";
    row["Variant Fulfillment Service"] = "manual";
    row["Variant Price"] = String(priceOf(r, o));
    row["Variant Requires Shipping"] = "true";
    row["Variant Taxable"] = (o.taxable === false) ? "false" : "true";
    row["Image Src"] = pics[0] || "";
    row["Image Position"] = pics.length ? "1" : "";
    row["Status"] = "active";
    /* 仕入原価。Shopify の Cost per item は管理画面だけに出る（客には見えない）。 */
    row["Cost per item"] = costOf(r);
    return row;
  }
  /* 2枚目からの画像は、Handle だけの行を足して並べる（Shopify の決まり）。 */
  function picRows(it, opt) {
    var pics = picsOf(it, opt), out = [];
    for (var i = 1; i < pics.length; i++)
      out.push({ "Handle": handleOf((it || {}).jan),
                 "Image Src": pics[i], "Image Position": String(i + 1) });
    return out;
  }
  function rowsOf(items, opt) {
    var out = [];
    for (var i = 0; i < (items || []).length; i++) {
      var r = items[i] || {};
      if (whyNot(r, opt)) continue;
      out.push(rowOf(r, opt));
      var pr = picRows(r, opt);
      for (var j = 0; j < pr.length; j++) out.push(pr[j]);
    }
    return out;
  }
  /* 出す行・外す行を分ける（画面のまとめに使う）。 */
  function split(items, opt) {
    var go = [], no = [];
    for (var i = 0; i < (items || []).length; i++) {
      var r = items[i] || {};
      var why = whyNot(r, opt);
      if (why) no.push({ it: r, why: why }); else go.push(r);
    }
    return { go: go, no: no };
  }

  /* ---- CSV の文字 ---- */
  function q(v) {
    var t = s(v);
    return /[",\r\n]/.test(t) ? ('"' + t.replace(/"/g, '""') + '"') : t;
  }
  function toCsv(cols, rows) {
    var out = [cols.map(q).join(",")];
    for (var i = 0; i < (rows || []).length; i++) {
      var r = rows[i] || {};
      var line = [];
      for (var j = 0; j < cols.length; j++) line.push(q(r[cols[j]]));
      out.push(line.join(","));
    }
    /* UTF-8・LF で保存する（画面側で BOM は付けない）。 */
    return out.join("\n") + "\n";
  }
  function build(items, opt) { return toCsv(COLS, rowsOf(items, opt)); }

  /* ---- 在庫・値段を直す CSV（【3】）----
     MW で品切れ・値段が変わったときに、eBay と同じ間合いで作る。
     触らない項目は列ごと出さないので、説明・画像・タグは上書きされない。 */
  function updRowOf(it, opt) {
    var o = opt || {};
    var r = it || {};
    var jan = digits(r.jan);
    var o1 = o.option1 || OPT1;
    var qty = qtyOf(r);
    var row = {};
    row["Handle"] = handleOf(jan);
    row["Option1 Name"] = s(o1.name);
    row["Option1 Value"] = s(o1.value);
    row["Variant SKU"] = skuOf(jan);
    row["Variant Inventory Qty"] = String(qty);
    row["Variant Inventory Policy"] = "deny";
    /* 直しの CSV は、**値段がすでに分かっている行**（品切れなど値段を
       変えない行）は price をそのまま使う。eBay の売値（usd）から
       出し直す行だけ、⚙の為替と割合で計算する。 */
    row["Variant Price"] = String(updPxOf(r, o));
    /* 品切れは下書きに落とす（買えない商品を公開のままにしない）。 */
    row["Status"] = (qty > 0) ? "active" : "draft";
    return row;
  }
  function updPxOf(it, opt) {
    const p = Math.round(num((it || {}).price));
    return (p > 0) ? p : priceOf(it, opt);
  }
  function updRowsOf(items, opt) {
    var out = [];
    for (var i = 0; i < (items || []).length; i++) {
      var r = items[i] || {};
      if (!janOk(r.jan)) continue;
      if (memberish(r)) continue;                  // 会員向けは混ぜない（【4】）
      out.push(updRowOf(r, opt));
    }
    return out;
  }
  function updCsv(items, opt) { return toCsv(UPD_COLS, updRowsOf(items, opt)); }

  var API = {
    COLS: COLS, UPD_COLS: UPD_COLS, OPT1: OPT1,
    HANDLE_PRE: HANDLE_PRE, SUB_PRE: SUB_PRE, ONE_PRE: ONE_PRE,
    SKU_PRE: SKU_PRE, isOne: isOne, memberish: memberish,
    TAG_EXPORT: TAG_EXPORT, TAG_NG: TAG_NG, PCT_DEF: PCT_DEF,
    IMG_MAX: IMG_MAX, IMG_NG: IMG_NG,
    handleOf: handleOf, skuOf: skuOf, isOs: isOs, isSub: isSub, janOk: janOk,
    ymd: ymd, seq2: seq2, fileName: fileName,
    ebayName: ebayName, shopName: shopName, updName: updName,
    kishuJa: kishuJa, titleOf: titleOf, stripEbay: stripEbay, bodyOf: bodyOf,
    pctOf: pctOf, yenOf: yenOf, priceOf: priceOf, gramsOf: gramsOf,
    qtyOf: qtyOf, costOf: costOf, picOk: picOk, picsOf: picsOf,
    tagNg: tagNg, tagsOf: tagsOf, whyNot: whyNot,
    rowOf: rowOf, picRows: picRows, rowsOf: rowsOf, split: split,
    toCsv: toCsv, build: build,
    updRowOf: updRowOf, updRowsOf: updRowsOf, updCsv: updCsv,
    updPxOf: updPxOf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof globalThis !== "undefined") globalThis.PJ_OSSCSV = API;
})();
