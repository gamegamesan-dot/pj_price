/* MW（マッチングワールド）のサイトの URL — 7.138／6.184
   画面（index.html）と pj-sync（proxy-sync/worker.js）の**両方**で使うので、
   この1ファイルだけに置く（pricing.js・mwcsv.js・mwstat.js・shopcsv.js・
   subprice.js・mwfee.js と同じ決まり）。

   **商品ページの URL は作れない。**
   MW の商品ページは「商品番号」で開くが、pj はその番号を在庫CSVから
   受け取っていない（写真の URL から拾える行はあるが、全部ではない）。
   そこで **JAN の検索結果**を開く（画面の「MW で検索」と同じ URL）。
   1件しか当たらなければ、その商品のページがそのまま並ぶ。

   **会員には見せない。** MW から仕入れていることは会員に伏せているので、
   この URL は**社内用のカード（スタッフ・管理者）だけ**に出す（§8.2）。
   取得先（stocks.csv）の URL は⚙に置く決まり（【P】）なので、ここには
   **人が見に行くページの URL だけ**を置く。 */
(function (root) {
  "use strict";
  var SITE = "https://matchingworld.asia";
  function digits(v) { return String(v === null || v === undefined ? "" : v)
    .replace(/\D/g, ""); }
  /* JAN の検索結果。13桁でなければ空（リンクを出さない）。 */
  function searchUrl(jan) {
    var j = digits(jan);
    if (j.length !== 13) return "";
    return SITE + "/buy/?q=" + encodeURIComponent(j);
  }
  /* iPhone でホーム画面のアプリから Safari 本体を開くときの形（6.131）。
     Discord のカードでは使わない（素の https だけ）。 */
  function safariUrl(jan) {
    var u = searchUrl(jan);
    return u ? ("x-safari-" + u) : "";
  }
  var API = { SITE: SITE, searchUrl: searchUrl, safariUrl: safariUrl };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_MWSITE = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
