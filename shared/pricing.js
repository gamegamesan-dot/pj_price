/* pj_price の値付けの式。**この1か所だけ**に置く（2026-10-20・C段）。
   pj_price（index.html）と pj-sync（Cloudflare Worker）の両方から読む。

   読み込み方
     ブラウザ … <script src="./shared/pricing.js"></script>（素のスクリプト）
                 読み込むと globalThis.PJ_PRICING に入る
     Worker   … import "../shared/pricing.js"（wrangler が module.exports を取り込む）
     テスト   … require('../shared/pricing.js')

   決まり
   ・画面の欄（$('fx') など）はここでは読まない。設定は settings() で作った
     「設定オブジェクト」として渡す。1品ごとの値（仕入値・重量・封筒の送料）は
     呼ぶときの引数で渡す。
   ・式を増やすときはここに書く。index.html / worker.js には写さない。 */
(function () {
  "use strict";

  /* ================= 定数（実測値）================= */
  /* 国際エアパケットの料金表（円）。100g刻み・2kgまで。 */
  var AIR = {
    1: [720, 820, 920, 1020, 1120, 1220, 1320, 1420, 1520, 1620, 1720, 1820, 1920, 2020, 2120, 2220, 2320, 2420, 2520, 2620],
    2: [750, 870, 990, 1110, 1230, 1350, 1470, 1590, 1710, 1830, 1950, 2070, 2190, 2310, 2430, 2550, 2670, 2790, 2910, 3030],
    3: [880, 1060, 1240, 1420, 1600, 1780, 1960, 2140, 2320, 2500, 2680, 2860, 3040, 3220, 3400, 3580, 3760, 3940, 4120, 4300],
    4: [1200, 1410, 1620, 1830, 2040, 2250, 2460, 2670, 2880, 3090, 3300, 3510, 3720, 3930, 4140, 4350, 4560, 4770, 4980, 5190],
    5: [920, 1180, 1440, 1700, 1960, 2220, 2480, 2740, 3000, 3260, 3520, 3780, 4040, 4300, 4560, 4820, 5080, 5340, 5600, 5860]
  };
  var EMS_W = [500, 600, 700, 800, 900, 1000, 1250, 1500, 1750, 2000, 2500, 3000, 3500, 4000, 4500, 5000];
  var EMS = {
    1: [1450, 1600, 1750, 1900, 2050, 2200, 2500, 2800, 3100, 3400, 3900, 4400, 4900, 5400, 5900, 6400],
    2: [1900, 2150, 2400, 2650, 2900, 3150, 3500, 3850, 4200, 4550, 5150, 5750, 6350, 6950, 7550, 8150],
    3: [3150, 3400, 3650, 3900, 4150, 4400, 5000, 5550, 6150, 6700, 7750, 8800, 9850, 10900, 11950, 13000],
    4: [3900, 4180, 4460, 4740, 5020, 5300, 5990, 6600, 7290, 7900, 9100, 10300, 11500, 12700, 13900, 15100],
    5: [3600, 3900, 4200, 4500, 4800, 5100, 5850, 6600, 7350, 8100, 9600, 11100, 12600, 14100, 15600, 17100]
  };
  var AIRPACKET_MAX = 2000;        // 国際エアパケットの上限（梱包後）
  /* 仕向地は国際エアパケットの地帯区分。第5地帯とヨーロッパは発送除外。 */
  var ZONES = [1, 2, 3, 4];
  var USA_ZONE = 4;
  var ASIA_ZONE = 2;               // 売値はアジア基準で決める（Zone1 もこれで賄える）
  var SHIP_ZONES = { 3: true, 4: true };   // 請求送料を別建てする地帯
  var ZONE3_TAX = 10;              // 第3地帯の現地税（豪州GST）
  /* 米国関税・通関手数料（zone4 のみ）。2026-09-05 Zonos Prepay で実測。
     関税12.5% ＋ 通関手数料（固定562円 ＋ 申告額の1.24%）
     → us_duty(円) = 申告額(円) × 0.1374 + 562（検算 5,000→1,249 / 10,000→1,936） */
  var US_DUTY_RATE = 0.1374;
  var US_DUTY_FIXED_JPY = 562;
  /* 切手を額面より安く買って支払う場合の原価率（2026-09-11 実勢の12%引き）。
     バイヤーへの請求送料は額面のままで、この割引は自社の原価計算にだけ効く。 */
  var STAMP_DISCOUNT = 0.88;
  var C = {
    AIR: AIR, EMS: EMS, EMS_W: EMS_W, AIRPACKET_MAX: AIRPACKET_MAX,
    ZONES: ZONES, USA_ZONE: USA_ZONE, ASIA_ZONE: ASIA_ZONE,
    SHIP_ZONES: SHIP_ZONES, ZONE3_TAX: ZONE3_TAX,
    US_DUTY_RATE: US_DUTY_RATE, US_DUTY_FIXED_JPY: US_DUTY_FIXED_JPY,
    STAMP_DISCOUNT: STAMP_DISCOUNT,
    STAMP_OFF_PCT: Math.round((1 - STAMP_DISCOUNT) * 100)
  };

  /* ================= 設定 =================
     DEFAULTS は「欄が無い・送られてこない」ときに使う値。
     画面の初期値と同じにしてある（片方だけ直すと金額がずれるので注意）。 */
  var DEFAULTS = {
    fx: 160,            // 為替（1ドル=円）
    fxc: 2,             // 為替の入金コスト（%）
    fee: 13.6,          // eBay 落札手数料（%）
    intlFee: 1.35,      // 国際手数料（%）
    adRate: 5.0,        // 広告料率（%）
    feeTax: 10,         // 手数料合計にかかる日本の消費税（%）
    fixed: 0.40,        // 固定手数料（$）
    pack: 150,          // 梱包資材費（円）
    shipCharge: 15,     // 請求送料（$・別建てする地帯で使う）
    usTaxRate: 8,       // 米国の想定現地税率（%）
    baseProfit: 1000,   // 下限利益（円）
    linkRate: 30,       // 仕入値への連動率（%）
    saleRate: 15,       // 売上比の目標（%）
    targetMode: "auto", // 目標の決め方 auto / yen / rate
    dutyShip: false,    // 関税を請求送料にも掛ける
    taxRefund: false,   // 仕入の消費税を還付とみなす
    stampDisc: false    // 切手割引で支払う
  };
  var NUM_KEYS = ["fx", "fxc", "fee", "intlFee", "adRate", "feeTax", "fixed", "pack",
                  "shipCharge", "usTaxRate", "baseProfit", "linkRate", "saleRate"];
  var BOOL_KEYS = ["dutyShip", "taxRefund", "stampDisc"];
  var MODES = { auto: 1, yen: 1, rate: 1 };
  function numOr(v, d) {
    var n = Number(v);
    return (v === "" || v === null || v === undefined || !isFinite(n)) ? d : n;
  }
  function boolOf(v, d) {
    if (typeof v === "boolean") return v;
    if (v === "true" || v === 1 || v === "1") return true;
    if (v === "false" || v === 0 || v === "0") return false;
    return d;
  }
  /* 画面の欄や D1 の設定（文字で入っている）を、計算に使える形にそろえる。
     足りない項目は DEFAULTS を使う。 */
  function settings(o) {
    var src = o || {}, s = {};
    NUM_KEYS.forEach(function (k) { s[k] = numOr(src[k], DEFAULTS[k]); });
    BOOL_KEYS.forEach(function (k) { s[k] = boolOf(src[k], DEFAULTS[k]); });
    var m = String(src.targetMode || "");
    s.targetMode = MODES[m] ? m : DEFAULTS.targetMode;
    return s;
  }

  /* ================= 小さな道具 ================= */
  // 浮動小数の誤差で 31.34 が 31.35 に切り上がるのを防ぐ（微小桁を先に丸めてから切り上げ）
  function ceil2(v) { return Math.ceil(Math.round(v * 1e6) / 1e4) / 100; }
  function round2(v) { return Math.round(v * 100) / 100; }
  /* eBayは手数料を行ごとにセント単位で課金し、消費税はその小計にかかる。
     明細と1セント単位で合わせたいので、ここでも行ごとに丸めてから合計する。
     手数料ベース＝(商品代＋請求送料)×(1＋現地税率) で、広告料も同じベースにかかる。 */
  function feeBreak(item, ship, tax, ad, fixedUsd, feeRate, intlRate, feeTax) {
    var base = round2((item + ship) * (1 + tax));
    var f1 = round2(base * feeRate), f2 = round2(base * intlRate), f3 = round2(base * ad);
    var sub = round2(f1 + f2 + f3 + fixedUsd), t = round2(sub * feeTax);
    return { base: base, fee: f1, intl: f2, ad: f3, fixed: fixedUsd, sub: sub, tax: t,
             total: round2(sub + t) };
  }
  function airRate(w, z) {
    return (w <= 0 || w > 2000 || !AIR[z]) ? null : AIR[z][Math.ceil(w / 100) - 1];
  }
  function emsRate(w, z) {
    if (!EMS[z]) return null;
    for (var i = 0; i < EMS_W.length; i++) if (w <= EMS_W[i]) return EMS[z][i];
    return null;
  }
  // その重量・仕向地の郵便料金（額面）。2kg超はエアパケット不可なのでEMSを見る
  function faceShip(w, z) {
    var air = airRate(w, z);
    return air !== null ? air : (emsRate(w, z) || 0);
  }

  /* ================= 価格モデル =================
     model(S, item) … S は settings()、item は
       { cost:仕入値(円), weight:梱包後重量(g), flat:封筒の送料(円・0で表を使う),
         target:円式の目標を外から指定する（省略すると cost から出す） }
     返すものは index.html の priceModel() と同じ形。
       price = 推奨売値、floor = 下限利益ちょうどの売値、be = 利益0の売値 */
  function autoTarget(S, cost) {
    return (S.baseProfit || 0) + (Number(cost) || 0) * ((S.linkRate || 0) / 100);
  }
  function model(S, item) {
    var it = item || {};
    var C0 = Number(it.cost) || 0, w = Number(it.weight) || 0, K = S.pack || 0;
    var FLAT = Number(it.flat) || 0;
    var R = S.fx || 1, x = (S.fxc || 0) / 100;
    var fRate = (S.fee || 0) / 100, iRate = (S.intlFee || 0) / 100;
    var adRate = (S.adRate || 0) / 100, fTax = (S.feeTax || 0) / 100;
    var F0 = S.fixed || 0;                        // 固定手数料（ドル）
    var dShip = !!S.dutyShip, refund = !!S.taxRefund;
    var Cc = refund ? C0 / 1.1 : C0;
    var stamp = !!S.stampDisc;
    var Gset = S.shipCharge || 0;                 // 請求送料（別建てする地帯で使う）

    function zoneTax(z) {
      return z === USA_ZONE ? ((S.usTaxRate || 0) / 100) : (z === 3 ? ZONE3_TAX / 100 : 0);
    }
    function zoneShipCharge(z) { return SHIP_ZONES[z] ? Gset : 0; }
    /* 送料（こちらの実費）。flat が入っているあいだは、重量と地帯の表を使わず
       その額（円）で固定する。フィギュアのみ（箱なし）を封筒で送るときに使う。 */
    function zoneCost(z) {
      if (FLAT > 0) return FLAT;
      var fc = faceShip(w, z);
      return stamp ? fc * STAMP_DISCOUNT : fc;
    }
    // 売値Pに対する係数。profit = P*den − rest（円）。
    // netUSD = (P+G)*u − (1+消費税)*固定手数料、入金は netUSD*R*(1−為替入金コスト)。
    function zoneCoef(z) {
      var t = zoneTax(z), u = 1 - (1 + fTax) * (1 + t) * (fRate + iRate + adRate);
      var dr = (z === USA_ZONE) ? US_DUTY_RATE : 0;
      var dFix = (z === USA_ZONE) ? US_DUTY_FIXED_JPY : 0;
      var G = zoneShipCharge(z), net = R * (1 - x);
      return { den: net * u - R * dr,
               rest: (1 + fTax) * F0 * net - G * net * u + (dShip ? G * R * dr : 0)
                     + dFix + Cc + K + zoneCost(z),
               u: u, t: t, G: G, dr: dr, dFix: dFix };
    }
    // 実際の損益は手数料をセント丸めして出す（eBayの明細と1円単位で合わせるため）
    function zoneProfit(P, z) {
      var G = zoneShipCharge(z), t = zoneTax(z);
      var fb = feeBreak(P, G, t, adRate, F0, fRate, iRate, fTax);
      var recv = (P + G - fb.total) * R;          // 正味入金（円）
      var duty = (z === USA_ZONE)
        ? ((P * R + (dShip ? G * R : 0)) * US_DUTY_RATE + US_DUTY_FIXED_JPY) : 0;
      return { fb: fb, recv: recv, fx: recv * x, duty: duty, ship: zoneCost(z),
               profit: recv - recv * x - duty - Cc - K - zoneCost(z) };
    }

    var baseP = S.baseProfit || 0;
    var tgtMode = S.targetMode;
    var Tyen = (it.target === undefined || it.target === null)
      ? autoTarget(S, C0) : Number(it.target) || 0;
    var q = (S.saleRate || 0) / 100;
    // 地帯ごとに必要な売値を出し、いちばん高い地帯を基準にする（＝利益がいちばん薄い地帯）
    var cand = {}, basisZone = ZONES[0], pRec = 0, basis = "", rateUnreachable = false;
    ZONES.forEach(function (z) {
      var c = zoneCoef(z), den = c.den, rest = c.rest;
      var dnRate = den - q * R;
      var pYen = den > 0 ? (Tyen + rest) / den : 0;
      var pRate = dnRate > 0 ? rest / dnRate : 0;
      var pRateFloor = den > 0 ? (baseP + rest) / den : 0;
      var un = !(dnRate > 0), pz, bs;
      if (tgtMode === "yen") { pz = pYen; bs = "採用：円式"; }
      else if (tgtMode === "rate") {
        pz = un ? pRateFloor : Math.max(pRate, pRateFloor);
        bs = "採用：売上比" + (S.saleRate || 0) + "%";
      } else {
        pz = Math.max(pYen, un ? 0 : pRate);
        bs = (!un && pRate > pYen) ? ("採用：売上比" + (S.saleRate || 0) + "%") : "採用：円式";
      }
      cand[z] = { p: pz, basis: bs, coef: c, unreach: un };
      if (pz > pRec) { pRec = pz; basisZone = z; basis = bs; rateUnreachable = un; }
    });
    if (!basis) { basis = cand[basisZone].basis; rateUnreachable = cand[basisZone].unreach; }
    var cB = cand[basisZone].coef;
    return { C0: C0, w: w, K: K, R: R, x: x, fRate: fRate, iRate: iRate, adRate: adRate,
             fTax: fTax, F0: F0, dShip: dShip, refund: refund, C: Cc, stamp: stamp,
             baseP: baseP,
             zoneTax: zoneTax, zoneShipCharge: zoneShipCharge, zoneCost: zoneCost,
             zoneCoef: zoneCoef, zoneProfit: zoneProfit,
             basisZone: basisZone, pRec: pRec, basis: basis,
             rateUnreachable: rateUnreachable,
             denB: cB.den, restB: cB.rest,
             floor: cB.den > 0 ? (baseP + cB.rest) / cB.den : 0 };
  }

  /* price … 推奨売値
     floor … 基準地帯の利益が「下限利益」ちょうどになる売値＝最低利益ライン
             （Best Offer の自動拒否ラインにも使っている）
     be    … 基準地帯の利益が0になる売値＝損益分岐 */
  function priceFor(S, cost, weight, flat) {
    var m = model(S, { cost: cost, weight: weight, flat: flat });
    return { price: ceil2(m.pRec), floor: ceil2(m.floor),
             be: ceil2(m.denB > 0 ? (m.restB / m.denB) : 0), zone: m.basisZone,
             profit: m.zoneProfit(ceil2(m.pRec), m.basisZone).profit };
  }
  /* 目標の利益（円）をちょうど得られる eBay の売値（総額$）。
     地帯ごとに (利益＋rest)/den を出し、いちばん高い地帯（利益がいちばん薄い地帯）に
     合わせる。「Amazonで売ったときと同じ利益になる eBay の売値」を出すのに使う。 */
  function priceForProfit(S, cost, weight, yen, flat) {
    if (!(yen > 0)) return 0;
    var m = model(S, { cost: cost, weight: weight, flat: flat }), best = 0;
    ZONES.forEach(function (z) {
      var c = m.zoneCoef(z);
      if (c.den > 0) best = Math.max(best, (yen + c.rest) / c.den);
    });
    return ceil2(best);
  }
  /* その売値で損益分岐にちょうど届く仕入値（円）。
     ＝「この値段で出すなら、いくらまでで買い直せるか」。再調達の見張りに使う。
     仕入値は目標（円式）にも入るので式を解けない。1円ずつではなく二分探索で詰める
     （index.html の syncMaxCost と同じ手順にしてある）。 */
  function maxCost(S, price, weight, flat) {
    var px = Number(price) || 0;
    if (!px) return 0;
    var be = function (c) { return priceFor(S, c, weight, flat).be; };
    if (be(1) > px) return 0;                 // 1円でも赤字（設定が合っていない）
    var lo = 1, hi = 2;
    while (hi < 5000000 && be(hi) <= px) hi *= 2;
    for (var i = 0; i < 40 && hi - lo > 1; i++) {
      var mid = Math.floor((lo + hi) / 2);
      if (be(mid) <= px) lo = mid; else hi = mid;
    }
    return lo;
  }

  var API = {
    VERSION: "1.0.0",
    C: C, DEFAULTS: DEFAULTS,
    settings: settings,
    ceil2: ceil2, round2: round2, feeBreak: feeBreak,
    airRate: airRate, emsRate: emsRate, faceShip: faceShip,
    autoTarget: autoTarget, model: model,
    priceFor: priceFor, priceForProfit: priceForProfit, maxCost: maxCost
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof globalThis !== "undefined") globalThis.PJ_PRICING = API;
})();
