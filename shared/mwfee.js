/* Amazon の手数料の「目安」（仮の手数料）— 7.137／6.181
   画面（index.html）と pj-sync（proxy-sync/worker.js）の**両方**で使うので、
   式はこの1ファイルだけに置く（pricing.js・mwcsv.js・mwstat.js・shopcsv.js・
   subprice.js と同じ決まり）。

   Amazon（SP-API）から**実額**が取れている行は、この式を使わない
   （実額のほうが正しい）。ここで出すのは
     ・値段は取れているが手数料が取れていない行
     ・FBA の見積もりが出せない行（fee_kind='fba_ng'）
   のための**目安**で、画面にも知らせにも「手数料の目安」と書く。

   手数料の目安 ＝ 販売手数料（値段 × 率）＋ FBA（配送代行＋在庫管理）
                  ＋ 手数料の消費税（販売手数料の10%）
     率     … ゲーム 15%／フィギュア 10%／その他 15%（⚙で変えられる）
     FBA    … サイズ区分ごとの目安（⚙）。寸法から区分が出ていればそれを使い、
              出ていなければ⚙の既定の区分（ゲーム＝小型・フィギュア＝標準）
     消費税 … せどりすと と同じく販売手数料の10%を足す（6.145） */
(function (root) {
  "use strict";
  var TAX_PCT = 10;                       // 手数料の消費税
  var SIZE = { s: "小型", m: "標準", l: "大型" };
  /* 機種の記号 → 手数料の区分。MW の CSV の「機種」をそのまま見る。 */
  var GAME = { NS: 1, NS2: 1, NS2H: 1, P5: 1, P4: 1, "3DS": 1, PS5: 1, PS4: 1,
               SW: 1, PP: 1, PV: 1, XB: 1, XBX: 1, WIN: 1, PCC: 1, "68": 1 };
  var HOBBY = { b2cchara_figure: 1, figure: 1, FIG: 1, GF: 1, plasticmodel: 1 };
  /* 既定（⚙が空のときの値）。画面の入力欄の初期値と同じにしておく。 */
  var D = { feeGame: 15, feeHobby: 10, feeOther: 15,
            shipS: 288, storeS: 1, shipM: 425, storeM: 16,
            shipL: 675, storeL: 93,
            fbaGame: 530, fbaHobby: 580, fbaOther: 400,
            sizeGame: "s", sizeHobby: "m" };

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  /* 0 を入れたときに既定へ戻らないよう、数かどうかで見る。 */
  function val(o, k) {
    var v = (o || {})[k];
    if (v === undefined || v === null || v === "") return D[k];
    var n = Number(v);
    return (isFinite(n) && n >= 0) ? n : D[k];
  }
  function str(o, k) {
    var v = (o || {})[k];
    return (v === undefined || v === null || v === "") ? D[k] : String(v);
  }
  /* その行の区分（手数料の率に使う）。 */
  function genreOf(r) {
    var k = String((r || {}).kishu || "");
    if (GAME[k]) return "ゲーム";
    if (HOBBY[k]) return "フィギュア";
    return "その他";
  }
  /* FBA のサイズ区分。寸法から出ていればそれ、無ければ⚙の既定。 */
  function sizeOf(r, o) {
    var t = String((r || {}).size_tier || "");
    if (SIZE[t]) return t;
    var g = genreOf(r);
    var v = (g === "ゲーム") ? str(o, "sizeGame")
      : ((g === "フィギュア") ? str(o, "sizeHobby") : "m");
    return SIZE[v] ? v : "m";
  }
  function sizeFrom(r) {
    return SIZE[String((r || {}).size_tier || "")] ? "寸法から" : "既定";
  }
  /* FBA（配送代行＋在庫管理）の目安。 */
  function fbaGuess(r, o) {
    var k = sizeOf(r, o);
    var pick = { s: ["shipS", "storeS"], m: ["shipM", "storeM"],
                 l: ["shipL", "storeL"] }[k];
    var ship = val(o, pick[0]), store = val(o, pick[1]);
    /* 古い設定（FBA手数料（ゲーム）／（ホビー））しか入っていない端末では、
       そちらを配送代行として使う（いきなり数字が変わらないように）。 */
    if (!ship && !store) {
      var g = genreOf(r);
      ship = (g === "ゲーム") ? val(o, "fbaGame")
        : ((g === "フィギュア") ? val(o, "fbaHobby") : val(o, "fbaOther"));
    }
    return { size: k, sizeName: SIZE[k], from: sizeFrom(r),
             ship: ship, store: store, fba: ship + store };
  }
  /* 販売手数料の率（%）。 */
  function rateOf(r, o) {
    var g = genreOf(r);
    if (g === "ゲーム") return val(o, "feeGame");
    if (g === "フィギュア") return val(o, "feeHobby");
    return val(o, "feeOther");
  }
  /* 手数料の目安（値段が要る）。値段が無ければ null。 */
  function guess(r, o) {
    var price = Math.round(num((r || {}).price));
    var fb = fbaGuess(r, o);
    var rate = rateOf(r, o);
    if (!(price > 0)) return null;
    var ref = Math.round(price * rate / 100);
    var tax = Math.round(ref * TAX_PCT / 100);
    return { ref: ref, fba: fb.fba, fbaShip: fb.ship, fbaStore: fb.store,
             tax: tax, fee: ref + fb.fba + tax, real: false,
             rate: rate, base: price, genre: genreOf(r),
             size: fb.size, sizeName: fb.sizeName, sizeFrom: fb.from };
  }
  var API = { guess: guess, fbaGuess: fbaGuess, rateOf: rateOf,
              genreOf: genreOf, sizeOf: sizeOf, sizeFrom: sizeFrom,
              TAX_PCT: TAX_PCT, SIZE: SIZE, GAME: GAME, HOBBY: HOBBY, D: D };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_MWFEE = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
