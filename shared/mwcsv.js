/* MW（マッチングワールド）の在庫CSVの読み方。**この1か所だけ**に置く
   （2026-11-08・【P】）。

   読み込み方
     ブラウザ … <script src="./shared/mwcsv.js"></script>（素のスクリプト）
                 読み込むと globalThis.PJ_MWCSV に入る
     Worker   … import "../shared/mwcsv.js"（wrangler が module.exports を取り込む）
     テスト   … require('../shared/mwcsv.js')

   なぜ共通化したか（【P】）
     いままで CSV の読み込みは画面（index.html）だけが持っていた。
     pj-sync が stocks.csv を自分で取りに行くようになると、
     **同じ読み方**でないと画面と Worker で行数や出荷日数がずれる。
     そこで読み込みと行の作り方をここに出し、両方から呼ぶ。

   決まり
   ・画面の欄（$('…')）も、Worker の設定（env）もここでは読まない。
     入れるのは「CSV の文字列」だけ、出すのは「行の配列と数え上げ」だけ。
   ・差分の書き込み・欠品の判定・3割の歯止めは Worker（mwStockPut）の役目。
     ここでは一切しない。 */
(function () {
  "use strict";

  /* ---- 出荷日の文字 → 営業日数（仕様 3章）----
     即日=0／翌営業日=1／「1~2営業日」=2／「2.3営業日」=3／「3.4営業日」=4／
     「5.6」=6／「7.8」=8／日付・週単位・予約・2週間などは 99（無在庫に使わない）。
     読めなかった文字は null を返し、呼ぶ側が 99 として扱い、一覧に残す。 */
  function norm(t) {
    return String(t || "").trim()
      .replace(/[０-９]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[．｡。]/g, ".").replace(/[～〜]/g, "~").replace(/[－ー―]/g, "-")
      .replace(/[･・､]/g, ",").replace(/　/g, " ").trim();
  }
  function shipDays(t) {
    var z = norm(t);
    /* 空欄は 99（無在庫に使わない）。読めない文字とは分けて数える（仕様3章）。 */
    if (!z) return 99;
    if (/即日|当日出荷|即出荷|12時締め/.test(z)) return 0;
    if (/翌営業日|翌日/.test(z)) return 1;
    /* 「0716 出荷」のような日付だけの書き方は無在庫に使わない。 */
    if (/^\d{3,4}\s*出荷/.test(z)) return 99;
    /* 「2.3営業日」「3~4営業日」「2,3営業日」… 大きい方を採る。
       「ご注文後2〜3営業」のように「日」が落ちている書き方も読む。 */
    var m = /(\d+)\s*[.~,\-]\s*(\d+)\s*営業日?/.exec(z);
    if (m) return Math.max(+m[1], +m[2]);
    m = /(\d+)\s*営業日?/.exec(z);
    if (m) return +m[1];
    /* 日付・週単位・予約・入荷予定・再販は無在庫に使わない。
       **数字＋日を読む前に**ここで弾く（「29日（木）」を29営業日と読まないため）。 */
    if (/週|[月火水木金土日]曜|入荷|予約|発売|再販|中旬|上旬|下旬|月末|ヶ月|か月|箇月/.test(z)
        || /\d+\s*\/\s*\d+/.test(z)
        || /\d+\s*日\s*[（(]/.test(z)
        || /\d+\s*月/.test(z))
      return 99;
    /* 「営業日」が無い「N〜M日」「N日以内」も大きい方を採る */
    m = /(\d+)\s*[.~,\-]\s*(\d+)\s*日/.exec(z);
    if (m) return Math.max(+m[1], +m[2]);
    m = /(\d+)\s*日/.exec(z);
    if (m) return +m[1];
    return null;                                         // 読めない
  }

  /* MW の在庫CSV専用の読み方（6.88）。
     MW の書き出しは「1行＝1件・全部の欄を " で囲む」形だが、備考に**閉じていない
     "** が入る行がある（stocks_3.csv の 3805行目。MW 側の書き出しの壊れ）。
     欄が改行をまたげる普通の読み方（csvParse）だと、その行以降が1つの欄に
     飲み込まれ、12,062行あるのに **3,802行で静かに終わってしまう**。
     そこで MW のCSVだけは **改行を必ず行の区切り**として扱い、
     引用符は1行の中だけで見る。壊れた行の被害がその行だけで止まる。 */
  function splitLine(line) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (q) {
        if (c === '"') {
          if (line.charAt(i + 1) === '"') { cur += '"'; i++; }   // "" は1つの "
          else q = false;
        } else cur += c;
      }
      else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }
  function lines(text) {
    var a = String(text || "").replace(/^﻿/, "").split(/\r\n|\r|\n/);
    while (a.length && a[a.length - 1] === "") a.pop();   // 末尾の空行だけ落とす
    return a;
  }

  /* CSV の文字列 → { rows, ng, dup, bad, unread, empty, lines, data, cols,
                      few, many, blank } または { err }
     bad … 読めなかった出荷日の文字 → 件数（呼ぶ側が画面に出す） */
  function parse(text) {
    var raw = lines(text);
    if (!raw.length) return { err: "空のファイルです" };
    var rows = raw.map(splitLine);
    var head = (rows[0] || []).map(function (x) {
      return String(x || "").replace(/^﻿/, "").trim(); });
    var col = function () {
      for (var i = 0; i < arguments.length; i++) {
        var j = head.indexOf(arguments[i]); if (j >= 0) return j;
      } return -1; };
    var iJ = col("JAN"), iS = col("社"), iK = col("機種"), iN = col("商品名"),
        iL = col("定価"), iR = col("発売日"), iC = col("新・中", "新中"),
        iW = col("卸値"), iQ = col("掲載数"), iB = col("備考"), iD = col("出荷日");
    if (iJ < 0 || iS < 0 || iW < 0)
      return { err: "JAN・社・卸値の列が見つかりません（MW の在庫CSVか確かめてください）" };
    var out = [], bad = {}, seen = {}, ng = 0, dup = 0, empty = 0;
    var cols = head.length, few = 0, many = 0, blank = 0;
    for (var n = 1; n < rows.length; n++) {
      var r = rows[n];
      if (!r || (r.length === 1 && r[0] === "")) { blank++; continue; }   // 空行
      /* 列の数が合わない行を数える。足りない行は飛ばし、
         多い行は**先頭の列数ぶんだけ**を使う（壊れた備考で列が増えた行を救う）。 */
      if (r.length < cols) { few++; continue; }
      if (r.length > cols) { many++; r = r.slice(0, cols); }
      /* 利益計算CSVは ="4595..." の形で入っているので、=" と " を外す */
      var jan = String(r[iJ] || "").replace(/^="?|"?$/g, "").replace(/\D/g, "");
      var sha = String(r[iS] || "").trim();
      if (jan.length !== 13 || !sha) { ng++; continue; }
      var k = jan + "|" + sha;
      var idx = seen[k] || 0; seen[k] = idx + 1;
      if (idx > 0) dup++;
      var txt = String(r[iD] || "");
      var d = shipDays(txt);
      if (!norm(txt)) empty++;                     // 空欄（99 扱い）
      else if (d === null) { bad[txt.trim()] = (bad[txt.trim()] || 0) + 1; d = 99; }
      out.push({ jan: jan, sha: sha, idx: idx,
        kishu: String(r[iK] || "").trim(), name: String(r[iN] || "").trim(),
        list_price: +String(r[iL] || "").replace(/[^0-9]/g, "") || 0,
        release: String(r[iR] || "").trim(), cond: String(r[iC] || "").trim(),
        wholesale: +String(r[iW] || "").replace(/[^0-9]/g, "") || 0,
        stock: +String(r[iQ] || "").replace(/[^0-9]/g, "") || 0,
        note: String(r[iB] || "").trim(), ship_text: txt.trim(), ship_days: d });
    }
    var unread = 0;
    Object.keys(bad).forEach(function (x) { unread += bad[x]; });
    return { rows: out, ng: ng, dup: dup, bad: bad, unread: unread, empty: empty,
             lines: raw.length, data: raw.length - 1, cols: cols,
             few: few, many: many, blank: blank };
  }

  /* ---- Shift_JIS のバイト列を文字にする（【P】）----
     MW の stocks.csv は Shift_JIS。
     workerd（Cloudflare Workers）でも `new TextDecoder('shift_jis')` が使える
     ことを実機で確かめてある（'shift_jis' / 'shift-jis' / 'sjis' /
     'windows-31j' / 'ms932' は通る。**'cp932' は通らない**）。
     万一その名前が使えない版に当たったら、UTF-8 として読んだうえで
     「化けている」ことを呼ぶ側に返す（取り込まずに知らせる）。 */
  var SJIS_LABELS = ["shift_jis", "shift-jis", "sjis", "windows-31j", "ms932"];
  function sjisOk() {
    for (var i = 0; i < SJIS_LABELS.length; i++) {
      try {
        var d = new TextDecoder(SJIS_LABELS[i]);
        if (d && String(d.encoding || "").toLowerCase() === "shift_jis")
          return SJIS_LABELS[i];
      } catch (e) { /* 次の名前を試す */ }
    }
    return "";
  }
  /* 文字化けの目安。Shift_JIS を UTF-8 として読むと U+FFFD（�）が大量に出る。 */
  function garbled(text) {
    var t = String(text || "");
    if (!t) return false;
    var n = (t.match(/�/g) || []).length;
    return n > 0 && n / t.length > 0.01;
  }
  function decode(buf) {
    var label = sjisOk();
    if (label) {
      var t = new TextDecoder(label).decode(buf);
      return { text: t, enc: label, garbled: garbled(t) };
    }
    var u = new TextDecoder("utf-8").decode(buf);
    return { text: u, enc: "utf-8", garbled: garbled(u), no_sjis: true };
  }

  var API = {
    norm: norm, shipDays: shipDays,
    splitLine: splitLine, lines: lines, parse: parse,
    SJIS_LABELS: SJIS_LABELS, sjisOk: sjisOk, garbled: garbled, decode: decode
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof globalThis !== "undefined") globalThis.PJ_MWCSV = API;
})();
