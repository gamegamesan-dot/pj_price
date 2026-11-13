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
    "Cost per item",         // 仕入原価（6.178・管理画面だけに入る。客には出ない）
    "Collection"             // 読み込みのときだけ足せる唯一の列
  ];
  /* ---- 列名の形（6.176）----
     Shopify は列名を新しい名前に変えたが、**ストアの「商品のエクスポート」が
     返す形は古い名前のまま**のことがある（omakase-ship で確認：Handle /
     Body (HTML) / Variant Price … ）。
     上書き（Overwrite products with matching handles）のときに列名が違うと
     ずれるので、**ストアが書き出す形に合わせる**のを既定にする。

     どちらの名前でも Shopify は読み込める（公式が後方互換を明記）。
     **古い名前でしか／新しい名前でしか入らない項目は無い**
     （下の表のすべてに両方の名前がある）。 */
  var COL_OLD = {
    "URL handle": "Handle",
    "Description": "Body (HTML)",
    "Product category": "Product Category",
    "Published on online store": "Published",
    "Option1 name": "Option1 Name",
    "Option1 value": "Option1 Value",
    "SKU": "Variant SKU",
    "Barcodes": "Variant Barcodes",
    "Price": "Variant Price",
    "Compare-at price": "Variant Compare At Price",
    "Charge tax": "Variant Taxable",
    "Inventory tracker": "Variant Inventory Tracker",
    "Inventory quantity": "Variant Inventory Qty",
    "Continue selling when out of stock": "Variant Inventory Policy",
    "Weight value (grams)": "Variant Grams",
    "Weight unit for display": "Variant Weight Unit",
    "Requires shipping": "Variant Requires Shipping",
    "Fulfillment service": "Variant Fulfillment Service",
    "Gift card": "Gift Card",
    "SEO title": "SEO Title",
    "SEO description": "SEO Description",
    "Product image URL": "Image Src",
    "Image position": "Image Position",
    "Image alt text": "Image Alt Text",
    "Variant image URL": "Variant Image",
    "Packed product length": "Variant Packed Length",
    "Packed product width": "Variant Packed Width",
    "Packed product height": "Variant Packed Height",
    "Packed product dimension unit": "Variant Packed Dimension Unit"
    /* Title / Vendor / Type / Tags / Status / Cost per item / Collection は
       どちらの形でも同じ名前。 */
  };
  /* 'old'（既定）＝ストアの書き出しに合わせる／'new'＝Shopify の今の名前。 */
  function colName(c, style) {
    return (String(style || "old") === "new") ? c : (COL_OLD[c] || c);
  }
  function headers(cols, style) {
    return (cols || []).map(function (c) { return colName(c, style); });
  }
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
  /* 送料の段（Shopify の「重さの段」。6.183／8.17）。
     Shopify は**本数ではなく合計の重さ**で送料が変わるので、
     ゲームソフト1本の重さ（⚙ mwSubGameG・既定100g）から
     「1〜2本 ¥200／3本 ¥300／4本以上 ¥600」を出せる。
     会員用カードの「送料」もここから作る（表はこの1か所だけ）。
     g は「この重さまで」。最後の 0 は「それより上はぜんぶ」。 */
  var SHIP_TIERS = [{ g: 250, yen: 200, name: "クリックポスト" },
                    { g: 350, yen: 300, name: "クリックポスト" },
                    { g: 0, yen: 600, name: "宅配便" }];
  var SHIP_MAX_N = 12;             // 何本ぶんまで見るか
  /* 1本 oneG の商品を n 本買ったときの段。 */
  function tierOf(grams) {
    var g = num(grams);
    for (var i = 0; i < SHIP_TIERS.length; i++) {
      var t = SHIP_TIERS[i];
      if (!t.g || g <= t.g) return t;
    }
    return SHIP_TIERS[SHIP_TIERS.length - 1];
  }
  /* 本数ごとの送料を「1〜2本 ¥200／3本 ¥300／4本以上 ¥600」の形にする。
     opt.free … この本数以上は送料無料（プランごとに変えられる・8.17）
     opt.max  … 何本ぶんまで見るか（既定 12） */
  function shipSteps(oneG, opt) {
    var o = opt || {};
    var g = Math.round(num(oneG));
    if (!(g > 0)) return null;
    var free = Math.round(num(o.free));
    var max = Math.round(num(o.max)) || SHIP_MAX_N;
    var steps = [], cur = null, i, t, yen;
    for (i = 1; i <= max; i++) {
      if (free > 0 && i >= free) { yen = 0; t = { name: "送料無料" }; }
      else { t = tierOf(g * i); yen = t.yen; }
      if (cur && cur.yen === yen) { cur.to = i; continue; }
      cur = { from: i, to: i, yen: yen, name: t.name };
      steps.push(cur);
    }
    /* いちばん上の段は「◯本以上」にする。 */
    if (steps.length) steps[steps.length - 1].to = 0;
    var txt = steps.map(function (x) {
      var n = (x.to === 0) ? (x.from + "本以上")
        : ((x.from === x.to) ? (x.from + "本") : (x.from + "〜" + x.to + "本"));
      return n + " " + (x.yen ? ("¥" + x.yen) : "送料無料");
    }).join("／");
    return { steps: steps, text: txt, name: steps[0].name, oneG: g };
  }

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
  /* ---- 機種の付け足し（6.194・【3】）----
     MW・Amazon の名前には「SW版」「[Switch]」「-Switch」のような
     機種の付け足しが入っている。機種は別の欄（Tags・説明）に出すので、
     商品名からは外す。 */
  var PLAT_NG = [
    /(?:^|[\s　])(?:SW|NS2?|PS[45]|PSV|PSVita|3DS|XB|Switch|スイッチ)版(?=[\s　]|$)/g,
    /[\s　]*[-ー−—]\s*(?:Nintendo\s*Switch\s*2?|Switch|PS[45]|PSVita|3DS|Xbox[^\s　]*)[\s　]*$/i
  ];
  /* ---- 特典の付け足し（6.194・【3】）----
     「【特典】お表裏ジャケット…」「【メーカー特典あり】」
     「(パッケージ版特典(ゲーム内アイテム) 同梱)」のような書き足しは、
     **商品名から外して説明文の「特典：…」に移す**。
     いちばん最初の特典の印より後ろは、ぜんぶ特典の中身として扱う。 */
  var TOKU_RE = /(?:【[^】]*特典[^】]*】|\[[^\]]*特典[^\]]*\]|[（(][^）)]*特典[^）)]*[）)](?:[\s　]*同梱[）)]?)?)/;
  function splitToku(name) {
    var t = s(name);
    var m = TOKU_RE.exec(t);
    if (!m) return { name: t, toku: "" };
    var head = t.slice(0, m.index);
    var mark = m[0].replace(/^[【\[（(]/, "").replace(/[】\]）)]$/, "").trim();
    var rest = t.slice(m.index + m[0].length).trim();
    /* 「【特典】ジャケット」のように中身が後ろに続くときは、そちらが中身。 */
    var toku = rest ? (/^特典/.test(mark) ? rest : (mark + "：" + rest)) : mark;
    return { name: head.trim(), toku: tidy(toku) };
  }
  /* 特典の中身（説明文の「特典：…」に出す）。無ければ空。 */
  function tokuOf(it) {
    var r = it || {};
    if (s(r.toku).trim()) return tidy(r.toku);
    return splitToku(r.name).toku;
  }
  /* 制御文字・改行は CSV を壊す（Shopify が読めない形になる）ので落とす。 */
  function tidy(v) {
    return s(v).replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[　]/g, " ").replace(/\s+/g, " ").trim();
  }
  function titleOf(name, max) {
    var t = splitToku(name).name;
    for (var i = 0; i < NAME_NG.length; i++) t = t.replace(NAME_NG[i], " ");
    for (var j = 0; j < PLAT_NG.length; j++) t = t.replace(PLAT_NG[j], " ");
    t = tidy(t);
    var n = num(max) || 180;
    return t.length > n ? t.slice(0, n).trim() : t;
  }

  /* ---- 説明（Body (HTML) → Description）----
     JAN・機種・Amazon の商品ページへのリンク・上限と返金の文。
     卸値・社・MW在庫・備考・MW の商品番号は入れない。

     6.186（【2】）お客さまに見せる文なので
     ・「仕入れ先の都合で」とは書かない（**仕入れ先のことは出さない**）
     ・機種は記号（NS）ではなく正式な呼び名（Nintendo Switch）で出す
       （呼び名の表は shared/mwfee.js の1か所だけ） */
  var NOTE_JA = "販売数に上限があります。"
    + "在庫の都合で用意できない場合は、全額返金します。";
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
    var kishu = kishuJa(it.kishu);
    if (kishu) h.push("<li>機種：" + esc(kishu) + "</li>");
    h.push('<li><a href="' + esc(amzUrl(jan, it.asin)) + '"'
      + ' target="_blank" rel="noopener">Amazon の商品ページ</a></li>');
    /* 6.194（【3】）商品名から外した特典の中身は、ここに移す。
       「何が付くか」はお客さまに要る話なので、消さずに説明文へ。 */
    var toku = tokuOf(it);
    if (toku) h.push("<li>特典：" + esc(toku) + "</li>");
    h.push("</ul>");
    h.push("<p>" + esc(o.note || NOTE_JA) + "</p>");
    return h.join("");
  }

  /* ---- 重さ（6.173）----
     Shopify は**重さの段**で送料を決めるので、ここがずれると送料がずれる。
     使うのは **Amazon の梱包重量（なければ商品の重量）**。
     `size_g` は mw_amz の列で、Amazon の Catalog の package を優先して
     入っている（取れなければ item の重量・7.112 の size_src が 'pkg'/'item'）。
     そこに ⚙「Shopify に出す重さの足し分」（既定 0g）を足す。

     ⚠ pj の⚙「梱包マージン（ゲーム60g／フィギュア250g）」は
     **eBay の送料計算用**なので、ここには足さない（別の欄）。
     Shopify 自身の「既定の梱包の重さ」も段をずらすので 0g にしてもらう。 */
  /* 手数料の区分（ゲーム／フィギュア／その他）は shared/mwfee.js の1か所だけ。
     画面・pj-sync と同じ見分け方を使う（6.183）。 */
  function feeMod() {
    var g = (typeof globalThis !== "undefined") ? globalThis : root;
    if (g && g.PJ_MWFEE) return g.PJ_MWFEE;
    if (typeof require === "function") {
      try { return require("./mwfee.js"); } catch (e) { /* 無くても止めない */ }
    }
    return null;
  }
  /* 機種の正式な呼び名（6.186・【2】）。表は shared/mwfee.js の1か所だけ。
     mwfee.js を読めないときは記号のまま出す（文が消えないように）。 */
  function kishuJa(v) {
    var F = feeMod();
    if (F && typeof F.kishuJa === "function") return F.kishuJa(v);
    return s(v).trim();
  }
  /* ゲームソフトかどうか（機種で見る）。限定版・通常版の区別は pj に
     データが無いので、**機種がゲームなら一律**として扱う。 */
  function isGame(r) {
    var F = feeMod();
    return !!F && F.genreOf(r || {}) === "ゲーム";
  }
  function weightOf(r, opt) {
    var o = opt || {};
    /* 6.183：**ゲームソフトは一律の重さ**（⚙ mwSubGameG・既定 100g）。
       Shopify の送料は本数ではなく**合計の重さ**で段が変わるので、
       Amazon の梱包重量（1本ごとにばらつく）のままだと本数と段が
       合わなかった。ゲームソフト以外は今までどおり
       「Amazon の梱包重量（なければ商品の重量）＋足し分」。 */
    var gg = Math.round(num(o.gameG));
    if (gg > 0 && isGame(r)) return gg;
    var g = Math.round(num((r || {}).size_g) || num(o.grams) || 0);
    if (g <= 0) return 0;              // 取れていない行は 0（画面が注意を出す）
    /* 足し分は0以上だけ（負の値で軽くはしない）。 */
    var add = Math.round(num(o.addG));
    return g + (add > 0 ? add : 0);
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

  /* ---- 残り数（6.194・【4】）----
     すでに注文がある商品を出し直すときは、CSV の在庫を
     **上限 − 取り込んだ注文の点数**にする（pj の残りと Shopify を合わせる）。
     注文の点数（sold）は pj-sync が返す。無ければ上限のまま。 */
  function maxOf(it) {
    return Math.max(0, Math.round(num((it || {}).max_qty)));
  }
  function leftOf(it) {
    var r = it || {};
    var sold = Math.max(0, Math.round(num(r.sold)));
    return Math.max(0, maxOf(r) - sold);
  }

  /* ---- 出せない行の理由（6.194・【1】【2】）----
     '' を返したら出せる。**黙って外さない**ために、画面がこの文を出す。
     Shopify が読み込めない形（名前が空・値段0・同じ Handle）もここで止める。 */
  function whyNot(it, opt) {
    var r = it || {};
    if (!/^\d{8,14}$/.test(digits(r.jan))) return "JAN がありません";
    if (!titleOf(r.name)) return "商品名がありません";
    if (Math.round(num(r.price)) <= 0) return "販売価格が入っていません";
    if (maxOf(r) <= 0) return "販売数の上限が入っていません";
    return "";
  }
  /* 出す行・外す行に分ける（画面のまとめに使う）。
     同じ JAN が2行あると Shopify は**同じ Handle の別バリアント**として
     読んでしまい、その商品がまるごと入らないことがある（6.194・【2】）。
     ここで1行にまとめ、外したほうを理由つきで返す。 */
  function split(items, opt) {
    var go = [], no = [], seen = {};
    for (var i = 0; i < (items || []).length; i++) {
      var r = items[i] || {};
      var why = whyNot(r, opt);
      if (why) { no.push({ it: r, why: why }); continue; }
      var h = handleOf(r.jan);
      if (seen[h]) {
        no.push({ it: r, why: "同じ JAN が2行あります（" + h + "）" });
        continue;
      }
      seen[h] = 1;
      go.push(r);
    }
    return { go: go, no: no };
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
    /* 6.194（【4】）在庫は **上限 − 取り込んだ注文の点数**。 */
    row["Inventory quantity"] = String(leftOf(r));
    row["Continue selling when out of stock"] = "deny";
    row["Weight value (grams)"] = String(weightOf(r, o));
    row["Weight unit for display"] = "g";
    row["Requires shipping"] = "true";
    row["Fulfillment service"] = "manual";
    row["Gift card"] = "false";
    row["SEO title"] = titleOf(r.name, 70);
    row["SEO description"] = "";
    /* 6.178（【2】）仕入原価（卸値×1.1＋MW送料）。Shopify の Cost per item は
       **管理画面と利益レポートだけ**に出る列で、客には見えない。
       行に cost が入っていなければ空にする（0 を入れて上書きしない）。 */
    row["Cost per item"] = costOf(r);
    row["Collection"] = s(o.collection);
    return row;
  }
  /* 仕入原価。式は shared/subprice.js（画面が cost を入れて渡す）。 */
  function costOf(r) {
    var c = Math.round(num((r || {}).cost));
    return c > 0 ? String(c) : "";
  }
  function rowsOf(items, opt) {
    var go = split(items, opt).go, out = [];
    for (var i = 0; i < go.length; i++) out.push(rowOf(go[i], opt));
    return out;
  }

  /* ===== 8.22（【2】）1点もの（秋葉原などで仕入れた商品）=====
     MW の無在庫（sub-<JAN>）とは**別の商品**として出す。
     ・Handle は one-<連番>／SKU は ONE-<連番>-<YYYYMMDD>
     ・タグは member-list と grade-*（先行のあいだは grade-premium だけ）
     ・**画像は入れない**（カジが Shopify の商品ページで入れる）
     ・仕入原価は Cost per item（管理画面だけ・客には見えない） */
  function oneHandleOf(id) { return "one-" + digits(id); }
  function oneSkuOf(id, d) { return "ONE-" + digits(id) + "-" + ymdOf(d); }
  function isOne(h) { return s(h).toLowerCase().indexOf("one-") === 0; }
  /* 送料の区分。**重さは Shopify の送料の段を当てるためだけ**に使う
     （カジが選んだ区分の名前は、会員のカードにそのまま出す）。 */
  var ONE_SHIP = [
    { key: "small", name: "クリックポスト", g: 200 },
    { key: "letter", name: "レターパックプラス", g: 800 },
    { key: "box", name: "宅配便", g: 2000 }
  ];
  function oneShipOf(key) {
    var k = s(key).trim();
    for (var i = 0; i < ONE_SHIP.length; i++)
      if (ONE_SHIP[i].key === k || ONE_SHIP[i].name === k) return ONE_SHIP[i];
    return null;
  }
  function oneShipName(key) {
    var o = oneShipOf(key);
    return o ? o.name : s(key).trim();
  }
  function oneGramsOf(it) {
    var r = it || {};
    var g = Math.round(num(r.grams));
    if (g > 0) return g;
    var o = oneShipOf(r.ship_kind);
    return o ? o.g : 0;
  }
  function oneLeftOf(it) {
    var r = it || {};
    return Math.max(0, Math.round(num(r.qty)) - Math.max(0, Math.round(num(r.sold))));
  }
  function oneWhyNot(it) {
    var r = it || {};
    if (!titleOf(r.name)) return "商品名がありません";
    if (Math.round(num(r.price)) <= 0) return "販売価格が入っていません";
    if (Math.round(num(r.qty)) <= 0) return "数量が0です";
    if (num(r.off)) return "取り下げています";
    return "";
  }
  /* 説明（1点もの）。状態・メモ・特典は会員に要る話なので出す。
     仕入原価・仕入れ先・MW のことは出さない（§8.2）。 */
  function oneBodyOf(it, opt) {
    var o = opt || {};
    var r = it || {};
    var h = [];
    h.push("<ul>");
    if (s(r.cond).trim()) h.push("<li>状態：" + esc(tidy(r.cond)
      + (s(r.cond_note).trim() ? ("（" + tidy(r.cond_note) + "）") : "")) + "</li>");
    if (digits(r.jan)) h.push("<li>JAN：" + esc(digits(r.jan)) + "</li>");
    var kishu = kishuJa(r.kishu);
    if (kishu) h.push("<li>機種：" + esc(kishu) + "</li>");
    if (/^B[0-9A-Z]{9}$/.test(s(r.asin).toUpperCase()))
      h.push('<li><a href="' + esc(amzUrl(digits(r.jan), r.asin)) + '"'
        + ' target="_blank" rel="noopener">Amazon の商品ページ</a></li>');
    if (s(r.note).trim()) h.push("<li>メモ：" + esc(tidy(r.note)) + "</li>");
    h.push("</ul>");
    h.push("<p>" + esc(o.oneNote || ONE_NOTE_JA) + "</p>");
    return h.join("");
  }
  var ONE_NOTE_JA = "1点ものです。売り切れの場合はご容赦ください。"
    + "用意できない場合は、全額返金します。";
  function oneRowOf(it, opt) {
    var o = opt || {};
    var r = it || {};
    var o1 = o.option1 || OPT1;
    var row = {};
    row["URL handle"] = oneHandleOf(r.id);
    row["Title"] = titleOf(r.name);
    row["Description"] = oneBodyOf(r, o);
    row["Vendor"] = s(o.vendor);
    row["Type"] = s(r.type || o.type);
    /* タグ。grades は「先行のあいだは premium だけ」を入れて渡す。 */
    row["Tags"] = [TAG_MEMBER].concat(gradeTags(r.grades)).join(", ");
    row["Published on online store"] = "true";
    row["Status"] = "active";
    row["Option1 name"] = s(o1.name);
    row["Option1 value"] = s(o1.value);
    row["SKU"] = oneSkuOf(r.id, o.date);
    row["Barcodes"] = digits(r.jan);
    row["Price"] = String(Math.round(num(r.price)));
    row["Charge tax"] = "true";
    row["Inventory tracker"] = "shopify";
    row["Inventory quantity"] = String(oneLeftOf(r));
    row["Continue selling when out of stock"] = "deny";
    row["Weight value (grams)"] = String(oneGramsOf(r));
    row["Weight unit for display"] = "g";
    row["Requires shipping"] = "true";
    row["Fulfillment service"] = "manual";
    row["Gift card"] = "false";
    row["SEO title"] = titleOf(r.name, 70);
    row["SEO description"] = "";
    row["Cost per item"] = costOf(r);
    row["Collection"] = s(o.collection);
    return row;
  }
  function oneSplit(items, opt) {
    var go = [], no = [], seen = {};
    for (var i = 0; i < (items || []).length; i++) {
      var r = items[i] || {};
      var why = oneWhyNot(r);
      if (why) { no.push({ it: r, why: why }); continue; }
      var h = oneHandleOf(r.id);
      if (seen[h]) { no.push({ it: r, why: "同じ番号が2行あります（" + h + "）" });
                     continue; }
      seen[h] = 1;
      go.push(r);
    }
    return { go: go, no: no };
  }
  function oneRowsOf(items, opt) {
    var go = oneSplit(items, opt).go, out = [];
    for (var i = 0; i < go.length; i++) out.push(oneRowOf(go[i], opt));
    return out;
  }
  function oneBuild(items, opt) {
    var o = opt || {};
    var cols = COLS.slice();
    if (!s(o.collection)) cols = cols.filter(function (c) {
      return c !== "Collection";
    });
    return toCsv(cols, oneRowsOf(items, o), o.style);
  }

  /* ---- CSV の文字 ---- */
  function q(v) {
    var t = s(v);
    return /[",\r\n]/.test(t) ? ('"' + t.replace(/"/g, '""') + '"') : t;
  }
  function toCsv(cols, rows, style) {
    var out = [headers(cols, style).map(q).join(",")];
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
    return toCsv(cols, rowsOf(items, o), o.style);
  }

  /* ---- 在庫CSV（ロケーションが2つ以上の店）----
     Handle / Location / Option1 Value が必須。On hand (current) を空に
     しておくと「うっかり上書きを防ぐ検査」が外れるので、新しく置くときの
     Not stocked だけを入れる。 */
  /* 在庫CSV は商品CSV と**別の形**。公式（Exporting and importing inventory
     with a CSV file・2026-11-10 に確認）の表どおり、オプションの列名は
     **`Option 1 Name` / `Option 1 Value`（数字の前後に空き）**。
     商品CSV の `Option1 Name`（空きなし）とは違うので混ぜない。 */
  var INV_COLS = ["Handle", "Title", "Option 1 Name", "Option 1 Value", "SKU",
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
      if (maxOf(r) <= 0) continue;
      rows.push({
        "Handle": handleOf(jan), "Title": titleOf(r.name),
        "Option 1 Name": s(o1.name), "Option 1 Value": s(o1.value),
        "SKU": skuOf(jan, o.date), "Location": loc,
        /* 置いていない場所に新しく置くときは Not stocked（公式の例）。 */
        "On hand (current)": o.first ? "Not stocked" : "",
        /* 6.194（【4】）在庫は上限 − 取り込んだ注文の点数。 */
        "On hand (new)": String(leftOf(r))
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
    isGame: isGame, weightOf: weightOf,
    COLS: COLS, INV_COLS: INV_COLS, OPT1: OPT1, GRADES: GRADES,
    COL_OLD: COL_OLD, colName: colName, headers: headers,
    TAG_MEMBER: TAG_MEMBER, SHIP_SMALL: SHIP_SMALL, SHIP_BOX: SHIP_BOX,
    SHIP_TIERS: SHIP_TIERS, tierOf: tierOf, shipSteps: shipSteps,
    CP: CP, NOTE_JA: NOTE_JA, kishuJa: kishuJa,
    NAME_NG: NAME_NG, PLAT_NG: PLAT_NG, TOKU_RE: TOKU_RE,
    splitToku: splitToku, tokuOf: tokuOf, tidy: tidy,
    handleOf: handleOf, skuOf: skuOf, ymdOf: ymdOf, titleOf: titleOf,
    bodyOf: bodyOf, amzUrl: amzUrl, shipTag: shipTag, gradeTags: gradeTags,
    tagsOf: tagsOf, rowOf: rowOf, rowsOf: rowsOf, toCsv: toCsv, build: build,
    maxOf: maxOf, leftOf: leftOf, whyNot: whyNot, split: split,
    ONE_SHIP: ONE_SHIP, ONE_NOTE_JA: ONE_NOTE_JA,
    oneHandleOf: oneHandleOf, oneSkuOf: oneSkuOf, isOne: isOne,
    oneShipOf: oneShipOf, oneShipName: oneShipName, oneGramsOf: oneGramsOf,
    oneLeftOf: oneLeftOf, oneWhyNot: oneWhyNot, oneBodyOf: oneBodyOf,
    oneRowOf: oneRowOf, oneSplit: oneSplit, oneRowsOf: oneRowsOf,
    oneBuild: oneBuild,
    invCsv: invCsv, splitCsv: splitCsv, transFill: transFill,
    weightOf: weightOf,
    TR_DEF: TR_DEF, TR_OUT: TR_OUT
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof globalThis !== "undefined") globalThis.PJ_SHOPCSV = API;
})();
