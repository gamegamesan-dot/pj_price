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
   ・説明は **Shopify 用に別に組み立てる**（8.73）。eBay の出品文は持ち込まない
     （eBay 向けの文が混じるため）。eBay への誘導も Shopify の外への誘導も書かない
     （eBay 側にも Shopify への誘導を一切入れない＝今の決まりのまま） */
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
  /* 8.98 Shopify の上書きインポートは **Title が必須**（無いと「商品名の列は必須です」で
     止まる）。いま Shopify に出している題名と同じ値を入れる（変えないため）。
     題名が分からない行は出さない（空の Title で上書きしない）。 */
  var UPD_COLS = [
    "Handle",
    "Title",
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
  function kishuEn(v) {
    var F = feeMod();
    if (F && typeof F.kishuEn === "function") return F.kishuEn(v);
    var k = s(v).trim();
    return /^[A-Za-z0-9][A-Za-z0-9 _+.-]*$/.test(k) ? k : "";
  }

  /* ---- 商品名（英語）----
     eBay の英題をそのまま使う。Shopify の上限（255字）で切る。 */
  function titleOf(it, max) {
    var t = s((it || {}).titleEn).replace(/\s+/g, " ").trim();
    var n = Math.round(num(max)) || 255;
    return t.length > n ? t.slice(0, n).trim() : t;
  }

  /* ---- Shopify 用の説明（8.73・カジの報告）----
     v325 までは **eBay の出品文から eBay の文を外して**載せていたが、
     ・外し方の不具合で、段落がほとんど消えたり eBay 向けの文が残ったりした
     ・そもそも eBay 向けに書いた文（Best Offer・eBay のメッセージ・関税の前払い）
       を Shopify に持ち込むのが筋違い
     なので、**Shopify 用の英語の説明を別に組み立てる**。
     eBay への誘導も、Shopify の外への誘導も書かない。
     入れるのは行が持っている事実だけ（商品名・ブランド・種類・機種・状態）。
     分からない項目は**その行ごと出さない**（推測で埋めない）。 */
  function esc(v) {
    return s(v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  /* 数字だけの長い値は ID の取り違え（会員プランのバリアント番号など）。
     Vendor・Type・タグには出さない。 */
  function word(v) {
    var t = s(v).replace(/\s+/g, " ").trim();
    return /^\d{6,}$/.test(t) ? "" : t;
  }
  var BODY_PHOTO = "The photos are product images of this item, not photographs "
    + "of the individual copy you will receive.";
  var BODY_JP = "This is the Japanese release. Packaging and printed materials "
    + "are in Japanese.";
  var BODY_SHIP = "Ships from Japan with tracking. Delivery options and costs "
    + "are shown at checkout.";
  var BODY_COST = "Delivery options and costs are shown at checkout.";
  var BODY_HELP = "If anything arrives damaged or not as described, contact us "
    + "first and it will be put right.";
  function shopBody(it) {
    var r = it || {};
    var li = [];
    var add = function (k, v) {
      var t = word(v);
      if (t) li.push("<li>" + esc(k) + ": " + esc(t) + "</li>");
    };
    if (s(r.cond).toLowerCase() === "new") li.push("<li>Condition: Brand new</li>");
    /* 8.85 説明の Brand は今までどおり「その行のブランド」。販売元（Vendor）の
       決め方を変えても、説明の文は変えない（画面が brand を別に渡す）。 */
    add("Brand", (r.brand !== undefined) ? r.brand : r.vendor);
    add("Type", r.type);
    add("Platform", r.platform);
    add("Model number", r.mpn);
    var h = "<p><strong>" + esc(titleOf(r)) + "</strong></p>";
    if (li.length) h += "<ul>" + li.join("") + "</ul>";
    /* 無在庫の行は、写真が届く1点を撮ったものではないと書く（8.67 と同じ考え）。 */
    if (r.stockPhoto) h += "<p>" + BODY_PHOTO + "</p>";
    h += "<p>" + BODY_JP + "</p>";
    var notes = r.notes || [];
    for (var i = 0; i < notes.length; i++) {
      var n = s(notes[i]).trim();
      /* eBay・Shopify の名前が入った注意書きは持ち込まない。 */
      if (!n || /\bebay\b|\bshopify\b/i.test(n)) continue;
      h += "<p>" + esc(n) + "</p>";
    }
    /* 8.79 入れ物の文（封筒／段ボール）は eBay の出品文と**同じ文**を出す。
       画面が行ごとに決めて渡す（文そのものは shared/shopcsv.js の PACK_TXT）。 */
    var pk = s(r.packText).trim();
    if (pk && !/\bebay\b|\bshopify\b/i.test(pk))
      h += "<p>Ships from Japan. " + esc(pk) + " " + BODY_COST + "</p>";
    else
      h += "<p>" + BODY_SHIP + "</p>";
    h += "<p>" + BODY_HELP + "</p>";
    return h;
  }
  function bodyOf(it, opt) {
    var o = opt || {};
    var t = shopBody(it);
    var tail = s(o.tail).trim();
    return tail ? (t + tail) : t;
  }
  /* ---- Vendor と Type（8.73）----
     Vendor ＝ その行のブランド。Type ＝ その行の商品の種類。
     **数字だけの値は出さない**
     （⚙の Vendor／Type に会員プランのバリアント番号が入っていて、
       それがそのまま CSV に出ていた）。

     8.85（カジの依頼）**販売元（Vendor）は、eBay 用に入れている Brand
     （ゲームは発売元＝Publisher）**。それも分からない行は**空欄**にする。
     v332 までは、行のブランドが空のとき⚙の Vendor（店の名前）を入れていた。
     ゲームは eBay では Brand ではなく Publisher に入れるので、ゲームの行は
     ほとんどが店の名前になっていた。⚙の代わりの値はもう使わない
     （opt.vendor は読まない）。
       brandWord … 「分からない」を表す eBay の決まり文句は空として扱う
       vendorPick … { game, publisher, brand } から販売元を決める
                    ゲーム：発売元 → ブランド／ほか：ブランド → 発売元 */
  var BRAND_NG = ["does not apply", "doesnotapply", "n/a", "na", "none",
                  "unknown", "unbranded", "not applicable", "-", "—"];
  function brandWord(v) {
    var t = word(v);
    return (BRAND_NG.indexOf(t.toLowerCase()) >= 0) ? "" : t;
  }
  function vendorPick(x) {
    var o = x || {};
    var pub = brandWord(o.publisher), br = brandWord(o.brand);
    return o.game ? (pub || br) : (br || pub);
  }
  function vendorOf(it) {
    return brandWord((it || {}).vendor);
  }
  function typeOf(it, opt) {
    return word((it || {}).type) || word((opt || {}).type);
  }
  /* ---- 出すときの状態（8.73）----
     既定は**下書き・非公開**。⚙で「公開」にしたときだけ active／true。 */
  function liveOf(opt) { return s((opt || {}).status).toLowerCase() === "active"; }

  /* ---- 値段（円）・8.94（カジの依頼・v342）----
     ストアは重さ別のエアメール送料を**チェックアウトで別に**もらっている。
     v341 までの「eBay の売値（送料込み・USD）× 為替 × ◯%」だと、送料が二重に
     かかり、eBay の手数料・広告費の分も上乗せされて高すぎた。
       値段 ＝ （卸値（税込）＋ MW 仕入れ送料 ＋ 梱包材 ＋ 目標利益）
              ÷（1 − Shopify 決済手数料率）
       卸値（税込）＝ MW の卸値 × 1.1（円で直接。為替は使わない）
       MW 仕入れ送料・梱包材 ＝ ⚙（既定 ¥176・¥50。8.95）
       目標利益   ＝ ⚙ 目標利益（円）＋ 卸値（税込）× ⚙ ◯%
       決済手数料 ＝ 値段 × ⚙ 決済手数料率（既定 3.6%）
     国際送料・eBay の手数料・広告費は入れない。1円単位で切り上げる。 */
  var PAY_DEF = 3.6;               // Shopify 決済手数料（%）の既定
  var TAX = 1.1;                   // 卸値は税抜（MW）。税込にする
  var SHIP_DEF = 176;              // 8.95 MW の仕入れ送料（1点・円）の既定
  var PACK_DEF = 50;               // 8.95 梱包材（1点・円）の既定
  /* ⚙ の円の欄（空なら既定・0 は 0）。 */
  function yenCfg(v, d) {
    if (v === undefined || v === null || s(v).trim() === "") return d;
    var n = num(v);
    return (n >= 0) ? Math.round(n) : d;
  }
  function payOf(opt) {
    var v = (opt || {}).pay;
    if (v === undefined || v === null || s(v).trim() === "") return PAY_DEF;
    var p = num(v);
    return (p >= 0 && p < 50) ? p : PAY_DEF;
  }
  function taxCostOf(it) {
    var w = num((it || {}).wholesale);
    return w > 0 ? Math.round(w * TAX) : 0;
  }
  function profitOf(cost, opt) {
    var o = opt || {};
    var v = num(o.profitBase) + num(cost) * (num(o.profitRate) / 100);
    return v > 0 ? Math.round(v) : 0;
  }
  /* 内訳つき。{ wholesale, cost（税込）, ship（MW 仕入れ送料）, pack（梱包材）,
     profit, pay（%）, fee, price } */
  function pxOf(it, opt) {
    var o = opt || {};
    var cost = taxCostOf(it);
    var out = { wholesale: Math.round(num((it || {}).wholesale)), cost: cost,
                ship: yenCfg(o.ship, SHIP_DEF), pack: yenCfg(o.pack, PACK_DEF),
                profit: 0, pay: payOf(o), fee: 0, price: 0 };
    if (!(cost > 0)) return out;
    out.profit = profitOf(cost, o);
    out.price = Math.ceil((cost + out.ship + out.pack + out.profit) / (1 - out.pay / 100));
    out.fee = out.price - cost - out.ship - out.pack - out.profit;
    return out;
  }
  function priceOf(it, opt) { return pxOf(it, opt).price; }

  /* ---- v341 までの式（比べるためだけに残す）----
     eBay の売値（USD・送料込みの総額）× ⚙ の為替 × ⚙ ◯%。 */
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
      var t = word(x);
      if (!t || tagNg(t)) return;
      if (/[^\x20-\x7E]/.test(t)) return;        // 英数字と記号だけ（8.73）
      for (var i = 0; i < out.length; i++) if (out[i].toLowerCase() === t.toLowerCase()) return;
      out.push(t);
    };
    add(TAG_EXPORT);
    /* 8.73 機種は**英語**の呼び名で付ける（「フィギュア」を出さない）。
       英語の呼び名が分からない記号は付けない。日本語が混じるタグも付けない。 */
    add(kishuEn(r.kishu));
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
    if (priceOf(r, opt) <= 0) return "値段が出せません（MW の卸値がありません）";
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
    row["Vendor"] = vendorOf(r, o);
    row["Type"] = typeOf(r, o);
    row["Tags"] = tagsOf(r, o).join(", ");
    row["Published"] = liveOf(o) ? "true" : "false";
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
    row["Status"] = liveOf(o) ? "active" : "draft";
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
    row["Title"] = fixTitleOf(r);
    row["Option1 Name"] = s(o1.name);
    row["Option1 Value"] = s(o1.value);
    row["Variant SKU"] = skuOf(jan);
    row["Variant Inventory Qty"] = String(qty);
    row["Variant Inventory Policy"] = "deny";
    /* 直しの CSV は、**値段がすでに分かっている行**（品切れなど値段を
       変えない行）は price をそのまま使う。値段を出し直す行だけ、
       卸値から計算する（8.94）。 */
    row["Variant Price"] = String(updPxOf(r, o));
    /* 品切れは下書きに落とす（買えない商品を公開のままにしない）。
       8.73：在庫があるときは**⚙の状態**にする。⚙が「下書き」のあいだは
       直しの CSV で勝手に公開されない（公開は⚙を「公開」にしてから）。 */
    row["Status"] = (qty > 0) ? (liveOf(o) ? "active" : "draft") : "draft";
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
      if (!fixTitleOf(r)) continue;                // 8.98 題名が分からない行は出さない
      out.push(updRowOf(r, opt));
    }
    return out;
  }
  function updCsv(items, opt) { return toCsv(UPD_COLS, updRowsOf(items, opt)); }

  /* ---- 8.94 値段だけを直す CSV ----
     もう Shopify に出ている os- の商品の値段を、新しい式に直す。
     Handle・バリアントを見分ける列（Option1・SKU）・Variant Price だけなので、
     ほかの項目（説明・在庫・状態・画像・タグ）は上書きされない。
     会員向け（sub-・one-）は混ぜない。卸値・仕入れ先は入れない。 */
  var PX_COLS = ["Handle", "Title", "Option1 Name", "Option1 Value", "Variant SKU",
                 "Variant Price"];
  /* 8.98 直しCSV の Title。いまの Shopify の題名（title）を最優先、
     無ければ Shopify 用CSV と同じ作り方（titleEn）。どちらも無ければ ''。 */
  function fixTitleOf(r) {
    var x = r || {};
    var t = s(x.title).replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 255) : titleOf(x);
  }
  function pxRowsOf(items, opt) {
    var o = opt || {}, o1 = o.option1 || OPT1;
    var out = [], seen = {};
    for (var i = 0; i < (items || []).length; i++) {
      var r = items[i] || {};
      if (!janOk(r.jan) || memberish(r)) continue;
      var jan = digits(r.jan), h = handleOf(jan);
      var p = Math.round(num(r.price));
      if (seen[h] || !(p > 0) || !fixTitleOf(r)) continue;
      seen[h] = 1;
      out.push({ "Handle": h, "Title": fixTitleOf(r),
                 "Option1 Name": s(o1.name), "Option1 Value": s(o1.value),
                 "Variant SKU": skuOf(jan), "Variant Price": String(p) });
    }
    return out;
  }
  function pxCsv(items, opt) { return toCsv(PX_COLS, pxRowsOf(items, opt)); }
  function pxName(d, seq, n) { return fileName("shopify-os-price", d, seq, n); }

  /* ---- 8.85 販売元（Vendor）だけを直す CSV ----
     もう Shopify に出ている os- の商品のうち、販売元が店の名前に
     なっているものを直す。**Handle・Title（いまの題名のまま）・Vendor だけ**なので（8.98 で Title を足した）、
     ほかの項目（説明・値段・在庫・画像・タグ）は上書きされない。
     会員向け（sub-・one-）は混ぜない。 */
  var VEND_COLS = ["Handle", "Title", "Vendor"];
  function vendRowsOf(items) {
    var out = [], seen = {};
    for (var i = 0; i < (items || []).length; i++) {
      var r = items[i] || {};
      if (!janOk(r.jan) || memberish(r)) continue;
      var h = handleOf(digits(r.jan));
      if (seen[h] || !fixTitleOf(r)) continue;     // 8.98 題名が分からない行は出さない
      seen[h] = 1;
      out.push({ "Handle": h, "Title": fixTitleOf(r), "Vendor": vendorOf(r) });
    }
    return out;
  }
  function vendCsv(items) { return toCsv(VEND_COLS, vendRowsOf(items)); }
  function vendName(d, seq, n) { return fileName("shopify-os-vendor", d, seq, n); }

  var API = {
    COLS: COLS, UPD_COLS: UPD_COLS, OPT1: OPT1,
    HANDLE_PRE: HANDLE_PRE, SUB_PRE: SUB_PRE, ONE_PRE: ONE_PRE,
    SKU_PRE: SKU_PRE, isOne: isOne, memberish: memberish,
    TAG_EXPORT: TAG_EXPORT, TAG_NG: TAG_NG, PCT_DEF: PCT_DEF,
    IMG_MAX: IMG_MAX, IMG_NG: IMG_NG,
    handleOf: handleOf, skuOf: skuOf, isOs: isOs, isSub: isSub, janOk: janOk,
    ymd: ymd, seq2: seq2, fileName: fileName,
    ebayName: ebayName, shopName: shopName, updName: updName,
    kishuJa: kishuJa, kishuEn: kishuEn, titleOf: titleOf,
    bodyOf: bodyOf, shopBody: shopBody, word: word,
    vendorOf: vendorOf, typeOf: typeOf, liveOf: liveOf,
    /* 8.85 販売元の決め方と、販売元だけを直す CSV。 */
    BRAND_NG: BRAND_NG, brandWord: brandWord, vendorPick: vendorPick,
    VEND_COLS: VEND_COLS, vendRowsOf: vendRowsOf, vendCsv: vendCsv,
    vendName: vendName,
    pctOf: pctOf, yenOf: yenOf, priceOf: priceOf, gramsOf: gramsOf,
    /* 8.94 卸値（税込）＋目標利益＋決済手数料。 */
    PAY_DEF: PAY_DEF, SHIP_DEF: SHIP_DEF, PACK_DEF: PACK_DEF, payOf: payOf, taxCostOf: taxCostOf, profitOf: profitOf,
    pxOf: pxOf, PX_COLS: PX_COLS, fixTitleOf: fixTitleOf, pxRowsOf: pxRowsOf, pxCsv: pxCsv, pxName: pxName,
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
