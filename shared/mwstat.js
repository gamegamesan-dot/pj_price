/* MW 在庫の動きから出す目安（7.126・【T】）
   画面（index.html）と pj-sync（proxy-sync/worker.js）の**両方**で使うので、
   式はこの1ファイルだけに置く（pricing.js・mwcsv.js と同じ決まり）。

   入れるもの（SQL が返す列の名前そのまま）
     stock        … いまの掲載数（JANごとの合計）
     note         … MW の備考（「在庫処分」の印に使う）
     mv_first     … はじめて記録した日時（ISO）
     mv_last      … 最後に数が動いた日時（ISO）
     mv_down      … 減った合計（全期間。補充は入れない＝売れた数の目安）
     mv_down_n    … 減った回数
     mv_up        … 増えた（補充）合計 ／ mv_up_n … その回数
     mv_gone_n    … 欠品になった回数
     mv_back_n    … 欠品から戻った回数 ／ mv_back_qty … 戻ったときの数の合計
     mv_gone_days … 欠品していた日数の合計
     mv7_down     … 直近7日に減った合計 ／ mv7_n … その回数
   返すもの
     days      … 記録のある日数（はじめて記録した日から今まで）
     per7      … 直近7日の「1日あたりに減った数」（記録が無ければ null）
     perAll    … 全期間の「1日あたりに減った数」（同じく null あり）
     speed     … 目安に使う速さ（直近7日があればそれ、無ければ全期間）
     speedSrc  … 'week'（直近7日）／'all'（全期間）／''（出せない）
     outDays   … 欠品までの見込み日数（いまの数 ÷ speed。speed が0なら null）
     backN     … 欠品から戻った回数
     backAvg   … 戻ったときの数の平均（戻ったことがなければ null）
     goneAvg   … 欠品していた日数の平均（同じく null）
     sale      … 備考に「在庫処分」などがある（true/false）
     noBack    … 在庫処分で、**戻ったことが1度もない**（＝刈り切る候補）
     thin      … 記録が少ない（既定14日未満）→「目安は参考程度」と出す
     label     … 画面と Discord に出す短い文（「1日 1.4点・残り 8日」など） */
(function (root) {
  "use strict";
  /* 「在庫処分」と見なす備考の言葉（⚙ mwSaleNote で変えられる）。 */
  var SALE_WORDS = ["在庫処分", "在庫限り", "終売", "生産終了", "完売",
                    "廃盤", "最終"];
  var THIN_DAYS = 14;               // これより記録が短ければ「参考程度」
  var WEEK = 7;
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function ms(iso) {
    var t = Date.parse(String(iso || ""));
    return isFinite(t) ? t : 0;
  }
  /* 言葉の一覧（設定の文字列でも配列でも受ける）。 */
  function words(v) {
    if (v === undefined || v === null || v === "") return SALE_WORDS.slice();
    var a = Array.isArray(v) ? v : String(v).split(",");
    var out = [];
    for (var i = 0; i < a.length; i++) {
      var s = String(a[i]).trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out.length ? out : SALE_WORDS.slice();
  }
  /* 備考に「在庫処分」などがあるか。 */
  function saleHit(note, list) {
    var n = String(note || ""), w = words(list);
    for (var i = 0; i < w.length; i++) if (n.indexOf(w[i]) >= 0) return w[i];
    return "";
  }
  function round1(n) { return Math.round(num(n) * 10) / 10; }
  function calc(r, opt) {
    var o = opt || {};
    var row = r || {};
    var now = num(o.now) || Date.now();
    var first = ms(row.mv_first);
    var days = first ? Math.max(0, (now - first) / 86400000) : 0;
    var down = Math.max(0, num(row.mv_down));
    var down7 = Math.max(0, num(row.mv7_down));
    /* 1日あたり。全期間は「記録のある日数」で割る（1日未満は1日と見る）。 */
    var perAll = (down > 0 && days > 0) ? (down / Math.max(1, days)) : null;
    /* 直近7日は、記録が7日に届いていなければその日数で割る。 */
    var win = days > 0 ? Math.min(WEEK, Math.max(1, days)) : WEEK;
    var per7 = down7 > 0 ? (down7 / win) : null;
    var speed = (per7 !== null) ? per7 : perAll;
    var speedSrc = (per7 !== null) ? "week" : (perAll !== null ? "all" : "");
    var stock = Math.max(0, num(row.stock));
    var outDays = (speed && speed > 0) ? (stock / speed) : null;
    var backN = Math.max(0, num(row.mv_back_n));
    var backAvg = backN > 0 ? (num(row.mv_back_qty) / backN) : null;
    var goneN = Math.max(0, num(row.mv_gone_n));
    var goneAvg = (goneN > 0 && num(row.mv_gone_days) > 0)
      ? (num(row.mv_gone_days) / goneN) : null;
    var hit = saleHit(row.note, o.saleWords);
    var thinDays = num(o.thinDays) || THIN_DAYS;
    var out = {
      days: Math.round(days),
      per7: per7 === null ? null : round1(per7),
      perAll: perAll === null ? null : round1(perAll),
      speed: speed === null ? null : round1(speed),
      speedSrc: speedSrc,
      outDays: outDays === null ? null : Math.round(outDays),
      downN: Math.max(0, num(row.mv_down_n)),
      down: down,
      upN: Math.max(0, num(row.mv_up_n)),
      up: Math.max(0, num(row.mv_up)),
      goneN: goneN,
      backN: backN,
      backAvg: backAvg === null ? null : round1(backAvg),
      goneAvg: goneAvg === null ? null : round1(goneAvg),
      sale: !!hit, saleWord: hit,
      /* 在庫処分で、戻ったことが1度もない＝「全部刈り取る」候補。
         記録が短いうちは言い切れないので thin のときは false。 */
      noBack: !!hit && backN === 0 && days >= thinDays,
      thin: !first || days < thinDays,
      none: !first };
    out.label = text(out);
    return out;
  }
  /* 画面と Discord に出す短い文。 */
  function text(c) {
    if (!c || c.none) return "記録なし";
    var t = [];
    if (c.speed !== null && c.speed > 0) {
      t.push("1日 " + c.speed + "点"
        + (c.speedSrc === "week" ? "（直近7日）" : "（全期間）"));
      if (c.outDays !== null) t.push("残り " + c.outDays + "日");
    } else t.push("減っていません");
    if (c.backN > 0) {
      t.push("再入荷 " + c.backN + "回"
        + (c.backAvg !== null ? ("・平均 " + c.backAvg + "点") : ""));
    } else if (c.goneN > 0) t.push("再入荷なし");
    if (c.sale) t.push(c.noBack ? "在庫処分（再入荷なし）" : "在庫処分");
    if (c.thin) t.push("記録 " + c.days + "日分・目安は参考程度");
    return t.join("／");
  }
  var API = { calc: calc, text: text, saleHit: saleHit, words: words,
              SALE_WORDS: SALE_WORDS, THIN_DAYS: THIN_DAYS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_MWSTAT = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
