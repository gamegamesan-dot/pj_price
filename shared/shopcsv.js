/* Shopify の商品CSV（会員向けサブスク）を作る。**この1か所だけ**に置く
   （2026-11-10・【U の改】）。

   読み込み方
     ブラウザ … <script src="./shared/shopcsv.js"></script>（素のスクリプト）
                 読み込むと globalThis.PJ_SHOPCSV に入る
     テスト   … require('../shared/shopcsv.js')

   列の名前は Shopify の公式（Using CSV files to import and export products・
   2026-11-10 に確認）の**今の名前**にそろえてある。古い名前（Handle /
   Body (HTML) / Variant Price …）も Shopify は後方互換で読むが、
   公式が「今の形に更新したほうがよい」と書いているので今の名前で出す。

   公式の落とし穴（必ず守る）
   ・`Option1 name` と `Option1 value` を入れないと、**既存のバリアントが
     消えて既定バリアントが作り直される**。だから必ず入れる
   ・読み込みで「Overwrite products with matching handles」を使うと、
     **CSV に入れた列が空欄なら空で上書きされる**。触りたくない項目は
     列ごと出さない（ここでは出す列を COLS で決め打ちにしてある）
   ・`Collection` 以外の列は足せない
   ・`Inventory quantity` はロケーションが**1つ**の店だけ。2つ以上の店では
     在庫CSV（Products > Inventory の Import）を使う

   決まり
   ・画面の欄（$('…')）も Worker の設定（env）もここでは読まない。
     入れるのは「品物の配列と設定」だけ、出すのは「CSV の文字列」だけ
   ・**画像は入れない**（MW の画像・Amazon の画像は使わない）
   ・MW の商品番号・卸値・社・MW在庫・備考は**出さない**（会員に見せない） */
(function () {
  "use strict";

  /* ---- 出す列（Shopify の今の名前）---- */
  var COLS = [
    "URL handle",            // 旧 Handle
    "Title",
    "Description",           // 旧 Body (HTML)
    "Vendor",
    "Type",
    "Tags",
    "Published on online store",
    "Status",
    "Option1 name",
    "Option1 value",
    "SKU",                   // 旧 Variant SKU
    "Barcodes",              // 旧 Barcode（単数）とは併用できない
    "Price",                 // 旧 Variant Price
    "Charge tax",            // 旧 Variant Taxable
    "Inventory tracker",
    "Inventory quantity",    // ロケーションが1つの店だけ
    "Continue selling when out of stock",
    "Weight value (grams)",  // 旧 Variant Grams
    "Weight unit for display",
    "Requires shipping",
    "Fulfillment service",
    "Gift card",
    "SEO title",
    "SEO description",
    "Collection"             // 読み込みのときだけ足せる唯一の列
  ];
  /* 1商品＝1バリアントなので、オプションはこの決まった値を入れる。
     ※ 公式の2ページで書き方が食い違っている（商品CSVのページは
       「1つしかオプションが無いなら Default Title」、在庫CSVのページは
       「Option 1 Name は Title、Option 1 Value は Default Title」）。
       Shopify のエクスポートに合わせて Title / Default Title を既定にし、
       設定（opt.option1）で変えられるようにしてある。 */
  var OPT1 = { name: "Title", value: "Default Title" };

  var TAG_MEMBER = "member-list";
  var GRADES = ["monitor", "light", "standard", "premium"];
  /* 送料の区分のタグ。1点で送ったときにどの送り方になるかを表す。
     何本まとめるかで実際の送り方が変わるぶんは、Shopify 側の
     「重さの段」で決める（ここでは決めない）。 */
  var SHIP_SMALL = "ship-small";   // クリックポストに入る（薄い・軽い）
  var SHIP_BOX = "ship-box";       // 入らない（レターパックプラス・宅配便）
  /* クリックポストの決まり（日本郵便・2026-11 時点）：
     長辺 34cm・短辺 25cm・厚さ 3cm 以内、1kg 以内。
     ゲームソフト通常版は 1本 約1.5cm・約110g なので 1〜2本は入る。 */
  var CP = { len: 34, wid: 25, hei: 3, g: 1000 };

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function s(v) { return (v === null || v === undefined) ? "" : String(v); }
  function digits(v) { return s(v).replace(/\D/g, ""); }

  /* ---- Handle と SKU ---- */
  /* 同じ商品を出し直すときは**同じ Handle**で上書きする。 */
  function handleOf(jan) { return "sub-" + digits(jan); }
  /* MW の商品番号は使わない（会員に見せないため）。日付は出した日。 */
  function ymdOf(d) {
    var t = (d instanceof Date) ? d : (d ? new Date(d) : new Date());
    if (isNaN(t.getTime())) t = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return String(t.getFullYear()) + p(t.getMonth() + 1) + p(t.getDate());
  }
  function skuOf(jan, d) { return "SUB-" + digits(jan) + "-" + ymdOf(d); }

  /* ---- 商品名 ----
     MW の名前の癖（【新品】【即納】などの角かっこ、「★」、
     末尾の「 ※…」の但し書き、連続する空白）を外す。
     備考の文は入れない。 */
  var NAME_NG = [
    /[【\[][^】\]]{0,20}[】\]]/g,          // 【新品】[即納] など
    /[★☆◎●■◆▼▲!！]+/g,
    /\s*※[^\n]*$/,                         // 末尾の但し書き
    /\s*\((?:新品|中古|未開封|即日|予約)\)\s*/g
  ];
  function titleOf(name, max) {
    var t = s(name);
    for (var i = 0; i < NAME_NG.length; i++) t = t.replace(NAME_NG[i], " ");
    t = t.replace(/[　]/g, " ").replace(/\s+/g, " ").trim();
    var n = num(max) || 180;
    return t.length > n ? t.slice(0, n).trim() : t;
  }

  /* ---- 説明（Body (HTML) → Description）----
     JAN・機種・Amazon の商品ページへのリンク・上限と返金の文。
     卸値・社・MW在庫・備考・MW の商品番号は入れない。 */
  var NOTE_JA = "販売数に上限があります。"
    + "仕入れ先の都合で用意できない場合は、全額返金します。";
  function amzUrl(jan, asin) {
    return /^B[0-9A-Z]{9}$/.test(s(asin).toUpperCase())
      ? ("https://www.amazon.co.jp/dp/" + s(asin).toUpperCase())
      : ("https://www.amazon.co.jp/s?k=" + encodeURIComponent(digits(jan)));
  }
  function esc(t) {
    return s(t).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function bodyOf(it, opt) {
    var o = opt || {};
    var jan = digits((it || {}).jan);
    var h = [];
    h.push("<ul>");
    h.push("<li>JAN：" + esc(jan) + "</li>");
    if (s(it.kishu)) h.push("<li>機種：" + esc(it.kishu) + "</li>");
    h.push('<li><a href="' + esc(amzUrl(jan, it.asin)) + '"'
      + ' target="_blank" rel="noopener">Amazon の商品ページ</a></li>');
    h.push("</ul>");
    h.push("<p>" + esc(o.note || NOTE_JA) + "</p>");
    return h.join("");
  }

  /* ---- 送料の区分 ----
     採寸（cm・g）があればクリックポストに入るかで見る。
     無ければ Amazon のサイズ区分（size_tier：s/m/l）で代わりに見る。 */
  function shipTag(it, opt) {
    var o = opt || {};
    var r = it || {};
    var cm = [num(r.size_long), num(r.size_wid), num(r.size_hei)]
      .filter(function (x) { return x > 0; }).sort(function (a, b) { return b - a; });
    var g = num(r.size_g) || num(o.grams) || 0;
    if (cm.length >= 3) {
      return (cm[0] <= CP.len && cm[1] <= CP.wid && cm[2] <= CP.hei
              && (!g || g <= CP.g)) ? SHIP_SMALL : SHIP_BOX;
    }
    var t = s(r.size_tier).toLowerCase();
    if (t === "s") return SHIP_SMALL;
    if (t === "m" || t === "l") return SHIP_BOX;
    /* 採寸も区分も無いときは重さで見る（ゲームソフトは 250g 以内）。 */
    if (g) return g <= 250 ? SHIP_SMALL : SHIP_BOX;
    return SHIP_SMALL;
  }
  /* 見せるプランのタグ。'' や未指定のときは**全プラン**に見せる。 */
  function gradeTags(grades) {
    var want = s(grades).split(/[,\s]+/).map(function (x) {
      return x.trim().toLowerCase();
    }).filter(Boolean);
    var use = want.length ? want : GRADES;
    var out = [];
    for (var i = 0; i < GRADES.length; i++)
      if (use.indexOf(GRADES[i]) >= 0) out.push("grade-" + GRADES[i]);
    return out;
  }
  function tagsOf(it, opt) {
    var o = opt || {};
    var t = [TAG_MEMBER];
    t = t.concat(gradeTags((it || {}).grades));
    t.push(shipTag(it, o));
    for (var i = 0; i < (o.tags || []).length; i++) {
      var x = s(o.tags[i]).trim();
      if (x && t.indexOf(x) < 0) t.push(x);
    }
    return t;
  }

  /* ---- 1行 ---- */
  function rowOf(it, opt) {
    var o = opt || {};
    var r = it || {};
    var jan = digits(r.jan);
    var o1 = o.option1 || OPT1;
    var row = {};
    row["URL handle"] = handleOf(jan);
    row["Title"] = titleOf(r.name);
    row["Description"] = bodyOf(r, o);
    row["Vendor"] = s(o.vendor);
    row["Type"] = s(r.type || o.type);
    row["Tags"] = tagsOf(r, o).join(", ");
    /* 販売チャネルはオンラインストアだけ。CSV でほかのチャネルは触れない。 */
    row["Published on online store"] = "true";
    row["Status"] = "active";
    row["Option1 name"] = s(o1.name);
    row["Option1 value"] = s(o1.value);
    row["SKU"] = skuOf(jan, o.date);
    row["Barcodes"] = jan;
    row["Price"] = String(Math.round(num(r.price)));
    row["Charge tax"] = "true";
    row["Inventory tracker"] = "shopify";
    row["Inventory quantity"] = String(Math.max(0, Math.round(num(r.max_qty))));
    row["Continue selling when out of stock"] = "deny";
    row["Weight value (grams)"] = String(Math.max(0,
      Math.round(num(r.size_g) || num(o.grams) || 0)));
    row["Weight unit for display"] = "g";
    row["Requires shipping"] = "true";
    row["Fulfillment service"] = "manual";
    row["Gift card"] = "false";
    row["SEO title"] = titleOf(r.name, 70);
    row["SEO description"] = "";
    row["Collection"] = s(o.collection);
    return row;
  }
  function rowsOf(items, opt) {
    var out = [];
    for (var i = 0; i < (items || []).length; i++) {
      var r = items[i] || {};
      if (!/^\d{8,14}$/.test(digits(r.jan))) continue;
      if (Math.round(num(r.price)) <= 0) continue;
      if (Math.round(num(r.max_qty)) <= 0) continue;
      out.push(rowOf(r, opt));
    }
    return out;
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
    /* 公式どおり UTF-8・LF で保存する（画面側で BOM は付けない）。 */
    return out.join("\n") + "\n";
  }
  function build(items, opt) {
    var o = opt || {};
    var cols = COLS.slice();
    /* Collection を使わないときは列ごと外す（空で上書きしないため）。 */
    if (!s(o.collection)) cols = cols.filter(function (c) {
      return c !== "Collection";
    });
    return toCsv(cols, rowsOf(items, o));
  }

  /* ---- 在庫CSV（ロケーションが2つ以上の店）----
     Handle / Location / Option1 Value が必須。On hand (current) を空に
     しておくと「うっかり上書きを防ぐ検査」が外れるので、新しく置くときの
     Not stocked だけを入れる。 */
  var INV_COLS = ["Handle", "Title", "Option1 Name", "Option1 Value", "SKU",
                  "Location", "On hand (current)", "On hand (new)"];
  function invCsv(items, opt) {
    var o = opt || {};
    var loc = s(o.location);
    var o1 = o.option1 || OPT1;
    var rows = [];
    for (var i = 0; i < (items || []).length; i++) {
      var r = items[i] || {};
      var jan = digits(r.jan);
      if (!/^\d{8,14}$/.test(jan)) continue;
      if (Math.round(num(r.max_qty)) <= 0) continue;
      rows.push({
        "Handle": handleOf(jan), "Title": titleOf(r.name),
        "Option1 Name": s(o1.name), "Option1 Value": s(o1.value),
        "SKU": skuOf(jan, o.date), "Location": loc,
        /* 置いていない場所に新しく置くときは Not stocked（公式の例）。 */
        "On hand (current)": o.first ? "Not stocked" : "",
        "On hand (new)": String(Math.max(0, Math.round(num(r.max_qty))))
      });
    }
    return toCsv(INV_COLS, rows);
  }

  /* ================= 英語（翻訳CSV）=================
     Shopify の翻訳CSVは **設定→言語** の Export / Import で出し入れする
     （Translate & Adapt アプリ自体に CSV は無い・2026-11-10 に確認）。
     行を特定する Identification 列は **Shopify の内部ID**で、JAN も
     Handle も入っていないので、**pj が先に作ることはできない**。
     そこで「Shopify から出した CSV を読み、Default content（日本語）で
     突き合わせて Translated content に英題を入れて返す」形にする。 */
  function splitCsv(text) {
    var rows = [], row = [], cur = "", qd = false;
    var t = s(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (qd) {
        if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else qd = false; }
        else cur += c;
        continue;
      }
      if (c === '"') { qd = true; continue; }
      if (c === ",") { row.push(cur); cur = ""; continue; }
      if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; continue; }
      cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  /* 翻訳CSV の列（Shopify のエクスポートの並び）。名前で引くので順は見ない。 */
  var TR_DEF = "Default content";
  var TR_OUT = "Translated content";
  var TR_FIELD = "Field";
  var TR_TYPE = "Type";
  /* map … { 日本語の商品名: 英語の商品名 }。
     opt.fields … 入れる項目（既定は title だけ）。
     返り：{ text, n（入れた行数）, miss（map にあって使われなかった名前）,
             rows（CSV の行数）, cols（列が見つかったか）} */
  function transFill(text, map, opt) {
    var o = opt || {};
    var rows = splitCsv(text);
    var out = { text: s(text), n: 0, miss: [], rows: 0, cols: false, hit: {} };
    if (!rows.length) return out;
    var head = rows[0].map(function (x) { return s(x).trim(); });
    var iDef = head.indexOf(TR_DEF), iOut = head.indexOf(TR_OUT);
    var iField = head.indexOf(TR_FIELD), iType = head.indexOf(TR_TYPE);
    if (iDef < 0 || iOut < 0) return out;
    out.cols = true;
    var fields = (o.fields && o.fields.length) ? o.fields : ["title"];
    var m = map || {};
    /* 突き合わせは**癖を外した名前**でも効くようにする。
       map の鍵が MW のままの名前（【新品】…★）でも、CSV 側の
       Default content（Shopify に入れた名前）と結びつくように。 */
    var norm = {};
    for (var k0 in m) if (Object.prototype.hasOwnProperty.call(m, k0)) {
      var t0 = titleOf(k0);
      if (t0 && norm[t0] === undefined) norm[t0] = k0;
    }
    for (var r = 1; r < rows.length; r++) {
      var line = rows[r];
      if (!line || line.length < head.length) continue;
      out.rows++;
      if (iField >= 0) {
        var f = s(line[iField]).trim().toLowerCase();
        if (fields.indexOf(f) < 0) continue;
      }
      if (iType >= 0 && o.type && s(line[iType]).trim() !== o.type) continue;
      var ja = s(line[iDef]).trim();
      if (!ja) continue;
      var key = (m[ja] !== undefined) ? ja
        : ((m[titleOf(ja)] !== undefined) ? titleOf(ja)
          : (norm[titleOf(ja)] !== undefined ? norm[titleOf(ja)] : null));
      if (key === null) continue;
      var en = m[key];
      if (!en) continue;
      line[iOut] = s(en);
      out.hit[key] = 1;
      out.n++;
    }
    for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k))
      if (!out.hit[k]) out.miss.push(k);
    out.text = rows.map(function (l) { return l.map(q).join(","); }).join("\n") + "\n";
    return out;
  }

  var API = {
    COLS: COLS, INV_COLS: INV_COLS, OPT1: OPT1, GRADES: GRADES,
    TAG_MEMBER: TAG_MEMBER, SHIP_SMALL: SHIP_SMALL, SHIP_BOX: SHIP_BOX,
    CP: CP, NOTE_JA: NOTE_JA,
    handleOf: handleOf, skuOf: skuOf, ymdOf: ymdOf, titleOf: titleOf,
    bodyOf: bodyOf, amzUrl: amzUrl, shipTag: shipTag, gradeTags: gradeTags,
    tagsOf: tagsOf, rowOf: rowOf, rowsOf: rowsOf, toCsv: toCsv, build: build,
    invCsv: invCsv, splitCsv: splitCsv, transFill: transFill,
    TR_DEF: TR_DEF, TR_OUT: TR_OUT
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof globalThis !== "undefined") globalThis.PJ_SHOPCSV = API;
})();
