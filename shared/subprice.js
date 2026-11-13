/* 会員に出す商品の販売価格（6.178／7.135・【2】）
   画面（index.html）・pj-sync（proxy-sync/worker.js）・Discord の配信
   （discord/test-post.mjs）の**すべて**で使うので、式はこの1ファイルだけに置く
   （pricing.js・mwcsv.js・mwstat.js・shopcsv.js と同じ決まり）。

   方針（カジ・2026-11-11）
     **商品代に利益を載せない。会費が収益。**
     だから掛け率（×1.3）はやめて、「出ていくお金をちょうど回収する値段」にする。

   販売価格（税込）
     仕入原価 ＝ round(卸値（税抜）×1.1) ＋ 会員価格に含める MW 送料
                 （6.187／【1】・⚙ mwSubShip・**既定 ¥0**。会員のぶんは
                 カジの仕入れとまとめて MW に発注し、5万円以上で送料無料に
                 なることが多いので、1点あたりはほぼ 0。
                 仕入れタブの「カジの利益」は今までどおり ⚙ mwShipFee を引く）
     梱包材   ＝ ⚙（既定 ¥30）
     上乗せ   ＝ ⚙ の範囲（既定 ¥10〜150）の**乱数**。
                 配信（出し直し）のたびに決め直すので、同じ商品でも毎回変わる
     手数料   ＝ カード決済手数料（⚙・既定 3.55%）。**販売価格にかかる**ので、
                 ちょうど回収できるように割り戻す
       販売価格 ＝ round((仕入原価 ＋ 梱包材 ＋ 上乗せ) ÷ (1 − 手数料の率))

   決めごと
     ・**10円単位・100円単位の切り上げはしない**（端数を残す）。
       きれいな値段にすると、そこから卸値を逆算されやすいため。
     ・卸値そのもの・卸値×1.1 と**同じ額にならない**ようにする
       （MW の卸値を推測されないため）。当たったら1円ずつずらす。
     ・会員向きかどうか（6.188／【2】）
         会員の粗利の目安 ＝ Amazon の実売 − Amazon の手数料 − 販売価格
         会員の利益率     ＝ 会員の粗利の目安 ÷ 販売価格
       **粗利が ⚙の下限（既定 ¥800）以上**、または
       **利益率が ⚙の下限（既定 30%）以上 かつ 粗利が ⚙の最低額（既定 ¥300）以上**
       なら会員向き。どちらも満たさないときだけ「会員向きではありません」。
       （安い商品でも利益率がよければ出せるようにするため） */
(function (root) {
  "use strict";
  var TAX = 1.1;                 // 卸値は税抜
  var CARD_FEE = 0.0355;         // カード決済手数料（⚙ mwSubCardFee）
  var PACK_YEN = 30;             // 梱包材（⚙ mwSubPack）
  var ADD_MIN = 10;              // 上乗せの下（⚙ mwSubAddMin）
  var ADD_MAX = 150;             // 上乗せの上（⚙ mwSubAddMax）
  var GROSS_MIN = 800;           // 会員の粗利の下限（⚙ mwSubGrossMin）
  var RATE_MIN = 0.3;            // 会員の利益率の下限（⚙ mwSubRateMin・30%）
  var GROSS_FLOOR = 300;         // 利益率で通すときの粗利の最低額
                                 // （⚙ mwSubGrossFloor）
  var SHIP_YEN = 0;              // 会員価格に含める MW 送料（⚙ mwSubShip）
  var FEE_MAX = 0.2;             // 手数料の率の上限（入力ミスの歯止め）
  var ADD_CAP = 10000;           // 上乗せの上限（同じ）

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function yen(v) { return Math.round(num(v)); }
  /* 送られてこなかった（undefined・null・空）ときは既定を使う。 */
  function opt(o, k, dflt) {
    var v = (o || {})[k];
    if (v === undefined || v === null || v === "") return dflt;
    var n = Number(v);
    return isFinite(n) ? n : dflt;
  }
  /* 仕入原価（円・税込＋1点あたりの仕入れ送料）。画面の mwCost と同じ式。
     行に cost が入っていればそれを使う（pj-sync は**卸値そのものを返さず**
     仕入原価だけを返す。会員に出す口から卸値が漏れないようにするため）。 */
  function costOf(r, o) {
    var c = num((r || {}).cost);
    if (c > 0) return Math.round(c);
    var w = num((r || {}).wholesale);
    if (!(w > 0)) return 0;
    return Math.round(w * TAX) + shipOf(o);
  }
  /* 会員価格に含める MW の1点あたりの送料（⚙ mwSubShip・既定 ¥0）。 */
  function shipOf(o) {
    return Math.max(0, yen(opt(o, "ship", SHIP_YEN)));
  }
  /* 卸値（避ける額を出すためだけに使う）。卸値が無ければ仕入原価から戻す。 */
  function whOf(r, o) {
    var w = num((r || {}).wholesale);
    if (w > 0) return w;
    var c = num((r || {}).cost);
    if (!(c > 0)) return 0;
    var v = (c - shipOf(o)) / TAX;
    return v > 0 ? v : 0;
  }
  /* カード決済手数料の率（0〜0.2）。⚙ は「3.55」でも「0.0355」でも受ける。 */
  function feeRate(o) {
    var v = opt(o, "cardFee", CARD_FEE);
    if (v > 1) v = v / 100;                 // 「3.55」と入れられても通す
    return Math.max(0, Math.min(FEE_MAX, v));
  }
  function packOf(o) {
    return Math.max(0, yen(opt(o, "pack", PACK_YEN)));
  }
  /* 上乗せの範囲（lo ≤ hi）。 */
  function addRange(o) {
    var lo = Math.max(0, Math.min(ADD_CAP, yen(opt(o, "addMin", ADD_MIN))));
    var hi = Math.max(lo, Math.min(ADD_CAP, yen(opt(o, "addMax", ADD_MAX))));
    return { lo: lo, hi: hi };
  }
  /* 上乗せ（1円単位の乱数）。テストは rnd を渡して決める。 */
  function addOf(o) {
    var g = addRange(o);
    var f = ((o || {}).rnd);
    var x = (typeof f === "function") ? Number(f()) : Math.random();
    if (!isFinite(x) || x < 0) x = 0;
    if (x >= 1) x = 0.999999;
    return g.lo + Math.floor(x * (g.hi - g.lo + 1));
  }
  /* 卸値そのもの・卸値×1.1 と同じ額を避ける（1円ずつずらす）。 */
  function avoidOf(px, r, o) {
    var w = yen(whOf(r, o));
    if (!(w > 0)) return px;
    var bad = [w, Math.round(w * TAX)];
    var p = yen(px);
    for (var i = 0; i < 4 && bad.indexOf(p) >= 0; i++) p += 1;
    return p;
  }
  /* 販売価格（税込）と、その内訳。卸値が無ければ 0。 */
  function priceOf(r, o) {
    var cost = costOf(r, o);
    if (!(cost > 0)) return { price: 0, cost: 0, pack: 0, add: 0, fee: 0,
                              rate: feeRate(o) };
    var pack = packOf(o);
    var add = addOf(o);
    var rate = feeRate(o);
    var base = cost + pack + add;
    var px = avoidOf(Math.round(base / (1 - rate)), r, o);
    return { price: px, cost: cost, pack: pack, add: add,
             fee: px - base, rate: rate };
  }
  /* その販売価格が「おすすめ値のまま」か（＝人が決め直していないか）。
     上乗せの範囲ぶんの幅があるので、その帯の中なら おすすめ値のままと見る。
     帯の外なら人が決めた値なので、配信のときも**そのまま使う**。 */
  function inBand(px, r, o) {
    var cost = costOf(r, o);
    if (!(cost > 0) || !(num(px) > 0)) return false;
    var pack = packOf(o), rate = feeRate(o), g = addRange(o);
    var lo = Math.round((cost + pack + g.lo) / (1 - rate));
    var hi = Math.round((cost + pack + g.hi) / (1 - rate)) + 4;  // avoidOf のずれ
    var p = yen(px);
    return p >= lo && p <= hi;
  }
  /* 会員から見た粗利の目安＝Amazon の実売 − Amazon の手数料 − 販売価格。
     実売か手数料が取れていない行は null（当てずっぽうの額は出さない）。 */
  function grossOf(amzPrice, fee, px) {
    var p = num(amzPrice), f = num(fee), s = num(px);
    if (!(p > 0 && f > 0 && s > 0)) return null;
    return Math.round(p - f - s);
  }
  /* 会員の利益率（粗利 ÷ 販売価格）。出せないときは null。 */
  function rateOf(gross, px) {
    var g = Number(gross), s = num(px);
    if (!isFinite(g) || gross === null || !(s > 0)) return null;
    return g / s;
  }
  /* 利益率の下限（0〜1）。⚙ は「30」でも「0.3」でも受ける。 */
  function rateMin(o) {
    var v = opt(o, "rateMin", RATE_MIN);
    if (v > 1) v = v / 100;
    return Math.max(0, Math.min(1, v));
  }
  /* 会員向きかどうか（6.188・【2】）。
     ・粗利が ⚙の下限以上                                  → 会員向き
     ・利益率が ⚙の下限以上 かつ 粗利が ⚙の最低額以上      → 会員向き
     どちらも満たさないときだけ「会員向きではありません」。 */
  function fitOf(amzPrice, fee, px, o) {
    var min = Math.max(0, yen(opt(o, "grossMin", GROSS_MIN)));
    var rmin = rateMin(o);
    var floor = Math.max(0, yen(opt(o, "grossFloor", GROSS_FLOOR)));
    var g = grossOf(amzPrice, fee, px);
    if (g === null)
      return { ok: false, gross: null, rate: null, pct: null, min: min,
               rateMin: rmin, floor: floor, by: "", why: "no_fee" };
    var rate = rateOf(g, px);
    var byGross = (g >= min);
    var byRate = (rate !== null && rate >= rmin && g >= floor);
    return { ok: byGross || byRate, gross: g, rate: rate,
             /* 画面に出す「利益率 ◯%」（1の位まで）。 */
             pct: (rate === null) ? null : Math.round(rate * 100),
             min: min, rateMin: rmin, floor: floor,
             by: byGross ? "gross" : (byRate ? "rate" : ""),
             why: (byGross || byRate) ? "" : "low_gross" };
  }
  /* 内訳の文（画面の注意書き用。**会員には出さない**）。 */
  function text(p) {
    var x = p || {};
    if (!(num(x.price) > 0)) return "卸値が分からないので出せません";
    return "仕入原価 ¥" + yen(x.cost) + "＋梱包材 ¥" + yen(x.pack)
      + "＋上乗せ ¥" + yen(x.add) + "＋決済手数料 ¥" + yen(x.fee)
      + "（" + (Math.round(num(x.rate) * 10000) / 100) + "%）";
  }
  var API = { costOf: costOf, whOf: whOf, feeRate: feeRate, packOf: packOf,
              shipOf: shipOf, addRange: addRange, addOf: addOf,
              avoidOf: avoidOf, priceOf: priceOf, inBand: inBand,
              grossOf: grossOf, rateOf: rateOf, rateMin: rateMin,
              fitOf: fitOf, text: text,
              TAX: TAX, CARD_FEE: CARD_FEE, PACK_YEN: PACK_YEN,
              ADD_MIN: ADD_MIN, ADD_MAX: ADD_MAX, GROSS_MIN: GROSS_MIN,
              RATE_MIN: RATE_MIN, GROSS_FLOOR: GROSS_FLOOR,
              SHIP_YEN: SHIP_YEN };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_SUBPRICE = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
