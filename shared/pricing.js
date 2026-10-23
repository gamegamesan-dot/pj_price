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
  /* 行ごとの目標（D段）で使う設定。名前は画面の欄・D1 の設定と同じにしてある。 */
  var ROW_DEFAULTS = {
    syncTol: 200,          // 最安グループの許容差（円）
    syncSkipAcc: true,     // 中古の最安値から「可」を除く
    csvLooseAmz: 80,       // 箱なし（-L）はAmazon最安値のこの割合を基準にする（%）
    syncWeight: 400,       // 既定重量（ホビー・g）
    syncWeightGame: 150,   // 既定重量（ゲーム・g）
    csvWeightCart: 50,     // 既定重量（カートリッジのみ・g）
    csvWeightLoose: 200,   // 既定重量（フィギュアのみ・g）
    csvShipLoose: 0,       // 封筒の送料（円。0 なら重量の表を使う）
    syncSoldCut: 0,        // 相場に合わせるとき、相場から下げる額（$）
    csvReviewAbs: 1,       // 見直しのしきい値（$）
    csvReviewPct: 3,       // 見直しのしきい値（%）
    csvReviewZero: false,  // 数量0の出品も見直しの対象にする
    csvMarkStep: 1,        // 1回の値下げ幅の最低（$）
    csvMarkTimes: 10,      // 値下げの回数
    amzFeeRate: 15,        // Amazon販売手数料（%）
    amzFbaFee: 400,        // FBA配送代行手数料（円）
    buySrc: "auto"         // 仕入れ先 auto / amazon / mw（いまは Amazon だけ）
  };
  var NUM_KEYS = ["fx", "fxc", "fee", "intlFee", "adRate", "feeTax", "fixed", "pack",
                  "shipCharge", "usTaxRate", "baseProfit", "linkRate", "saleRate",
                  "syncTol", "csvLooseAmz", "syncWeight", "syncWeightGame",
                  "csvWeightCart", "csvWeightLoose", "csvShipLoose", "syncSoldCut",
                  "csvReviewAbs", "csvReviewPct", "csvMarkStep", "csvMarkTimes",
                  "amzFeeRate", "amzFbaFee"];
  var BOOL_KEYS = ["dutyShip", "taxRefund", "stampDisc",
                   "syncSkipAcc", "csvReviewZero"];
  var MODES = { auto: 1, yen: 1, rate: 1 };
  var BUY_SRCS_OK = { auto: 1, amazon: 1, mw: 1 };   // 仕入れ先の選び方
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
    var D = {}, k2;
    for (k2 in DEFAULTS) D[k2] = DEFAULTS[k2];
    for (k2 in ROW_DEFAULTS) D[k2] = ROW_DEFAULTS[k2];
    NUM_KEYS.forEach(function (k) { s[k] = numOr(src[k], D[k]); });
    BOOL_KEYS.forEach(function (k) { s[k] = boolOf(src[k], D[k]); });
    var m = String(src.targetMode || "");
    s.targetMode = MODES[m] ? m : DEFAULTS.targetMode;
    var bs = String(src.buySrc || "");
    s.buySrc = BUY_SRCS_OK[bs] ? bs : ROW_DEFAULTS.buySrc;
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

  /* ================= 行ごとの目標（D段）=================
     r は D1 の items の行（そのままの形）。
     over は出品リスト（端末にしか無い）の行から来る上書き（{cost,weight}）。
     Worker は over を渡さない。 */
  /* Amazonの出品の状態（SubCondition）。実データは小文字で返る。
     綴りの違い（very_good / VeryGood / verygood）も同じものとして扱う。 */
  var SUBCOND = { "new": 1, mint: 1, verygood: 1, good: 1, acceptable: 1,
                  refurbished: 1, collectible: 1, club: 1, oem: 1, used: 1 };
  function condKey(c) { return String(c || "").toLowerCase().replace(/[^a-z]/g, ""); }
  function condKnown(c) { return !!SUBCOND[condKey(c)]; }
  function isAcceptable(c) { return condKey(c) === "acceptable"; }
  function offersOf(r) {
    try {
      var a = JSON.parse((r && r.amazon_offers_json) || "[]");
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  /* 値付けの基準にする Amazon最安値。
     ・設定「中古の最安値から『可』を除く」がオンなら、中古の基準から「可」を外す
       （「可」しか無い／状態がまったく分からないときは外さない）
     ・中古・カートリッジのみの行は、**新品のほうが安ければ新品**を基準にする
     ・フィギュアのみ（箱なし）は係数（既定80%）で割り引く */
  function basis(S, r) {
    var all = offersOf(r);
    var tol = S.syncTol;
    var list = all, skipped = false;
    if (S.syncSkipAcc && r.cond !== "new" && all.length) {
      var keep = all.filter(function (o) { return !isAcceptable(o.c); });
      var known = all.filter(function (o) { return condKnown(o.c); });
      if (keep.length && known.length) { list = keep; skipped = (keep.length < all.length); }
    }
    var lowAll = Number(r.amazon_lowest) || (all.length ? (Number(all[0].p) || 0) : 0);
    var low = list.length ? (Number(list[0].p) || 0) : lowAll;
    var near = list.filter(function (o) { return (Number(o.p) || 0) <= low + tol; });
    var usedLow = low, nw = Number(r.amazon_new_low) || 0, useNew = false;
    if (r.cond !== "new" && nw > 0 && (!low || nw < low)) {
      useNew = true; low = nw;
      if (!lowAll || nw < lowAll) lowAll = nw;
      near = [];                 // 新品側の明細は持っていない（人数は newN で数える）
      skipped = false;           // 「可を除く」は中古の話
    }
    var looseCut = false;
    if (String(r.cond || "") === "loose" && low > 0) {
      var k = S.csvLooseAmz;
      if (!(k > 0 && k <= 100)) k = ROW_DEFAULTS.csvLooseAmz;
      low = Math.round(low * k / 100); looseCut = true;
    }
    return { low: low, lowAll: lowAll, list: list, near: near, tol: tol,
             skipped: skipped, hasList: all.length > 0,
             useNew: useNew, usedLow: usedLow, newLow: nw,
             newN: Number(r.amazon_new_n || 0), looseCut: looseCut };
  }
  // 最安グループの人数（新品を基準にした行は新品側の人数で数える）
  function nearN(S, r) {
    var b = basis(S, r);
    if (b.useNew) return b.newN;
    if (b.hasList) return b.near.length || 0;
    return Number(r.amazon_lowest_n || 0);
  }
  function defWeight(S, r) {
    var c = String((r && r.cond) || "");
    if (c === "cart") return S.csvWeightCart;     // 箱がないぶん軽い
    if (c === "loose") return S.csvWeightLoose;   // 封筒。既定値は梱包込み
    return (String((r && r.prefix) || "").toLowerCase() === "game")
      ? S.syncWeightGame : S.syncWeight;
  }
  /* 実重量。from … 'list'＝出品リスト／'d1'＝D1に残した実測／'def'＝既定重量 */
  function weightOf(S, r, over) {
    if (over && Number(over.weight) > 0) return { v: Number(over.weight), from: "list" };
    if (Number(r.weight_g) > 0) return { v: Number(r.weight_g), from: "d1" };
    return { v: defWeight(S, r), from: "def" };
  }
  // 封筒で送る行（フィギュアのみ）の送料
  function flatOf(S, r) {
    return (String((r && r.cond) || "") === "loose") ? (S.csvShipLoose || 0) : 0;
  }
  /* 仕入値（円）。list → d1 → せどりすとSKU の順。
     再調達中・無在庫の行は、売れてから Amazon で仕入れ直すので 0（＝Amazon最安値基準）。 */
  function costOf(S, r, over) {
    if (Number(r.restocking || 0) || Number(r.dropship || 0)) return { v: 0, from: "" };
    if (over && Number(over.cost) > 0) return { v: Number(over.cost), from: "list" };
    if (Number(r.cost_yen) > 0) return { v: Number(r.cost_yen), from: "d1" };
    if (Number(r.sku_cost) > 0) return { v: Math.round(Number(r.sku_cost)), from: "sku" };
    return { v: 0, from: "" };
  }
  // Amazon最安値を仕入値とみなした推奨売値
  function recommend(S, r, over) {
    var low = basis(S, r).low || Number(r.amazon_lowest) || 0;
    if (!low) return null;
    var wo = weightOf(S, r, over);
    var p = priceFor(S, low, wo.v, flatOf(S, r));
    return { price: p.price, floor: p.floor, be: p.be, profit: p.profit,
             weight: wo.v, weightFrom: wo.from, weightDefault: (wo.from === "def") };
  }
  // 分かっている仕入値から出した推奨売値
  function recCost(S, r, over) {
    var c = costOf(S, r, over);
    if (!(c.v > 0)) return null;
    var w = weightOf(S, r, over);
    var p = priceFor(S, c.v, w.v, flatOf(S, r));
    if (!(p && p.price > 0)) return null;
    return { price: p.price, floor: p.floor, be: p.be, profit: p.profit,
             cost: c.v, costFrom: c.from, weight: w.v, weightFrom: w.from,
             weightDefault: (w.from === "def") };
  }
  /* 値付けの基準。仕入値が分かればそれ、分からなければ Amazon最安値を仕入値とみなす。 */
  function recOf(S, r, over) { return recCost(S, r, over) || recommend(S, r, over); }
  /* Amazonで売ったときの利益（円）。分からない行は null。 */
  function amzProfit(S, r, over) {
    var low = basis(S, r).low || Number(r.amazon_lowest) || 0;
    if (!(low > 0)) return null;
    var c = costOf(S, r, over);
    if (!(c.v > 0)) return null;
    return Math.round(low * (1 - S.amzFeeRate / 100) - S.amzFbaFee - c.v);
  }
  /* Amazon同等ライン（Amazonで売ったときと同じ利益になる eBay の売値）。
     「eBay優先」の行と、箱なし（Amazonでは売れない）の行では使わない。 */
  function amzLine(S, r, over) {
    if (Number(r.ebay_first || 0)) return null;
    if (String(r.cond || "") === "loose") return null;
    var p = amzProfit(S, r, over);
    if (p === null) return null;
    if (p <= (S.baseProfit || 0)) return null;   // 下限利益以下なら今までどおり
    var v = priceForProfit(S, costOf(S, r, over).v, weightOf(S, r, over).v, p,
                           flatOf(S, r));
    return (v > 0) ? { profit: p, price: v } : null;
  }
  /* 最低売値（下限利益のライン）。from … 'list'/'d1'/'sku'/'amazon' */
  function floorOf(S, r, over) {
    var rc = recCost(S, r, over), o;
    if (rc) o = { v: rc.floor, from: rc.costFrom };
    else {
      var am = recommend(S, r, over);
      o = am ? { v: am.floor, from: "amazon" } : { v: 0, from: "" };
    }
    var a = amzLine(S, r, over);
    if (a && a.price > o.v) { o.v = a.price; o.amz = true; }
    return o;
  }
  /* 相場（総額$）→ 商品代（$）。請求送料を引く。 */
  function soldItem(S, r, over, soldUsd) {
    var v = (soldUsd === undefined || soldUsd === null)
      ? Number(r.sold_usd || 0) : Number(soldUsd || 0);
    if (!(v > 0)) return null;
    var w = weightOf(S, r, over).v;
    var cost = costOf(S, r, over).v || basis(S, r).low || Number(r.amazon_lowest) || 0;
    var m = model(S, { cost: cost, weight: w, flat: 0 });
    var G = m.zoneShipCharge(m.basisZone);
    return (v <= G) ? null : Math.round((v - G) * 100) / 100;
  }
  /* 相場と推奨売値・最低利益ライン・損益分岐を比べた判断。
     rec   相場 ≥ 推奨売値            → 推奨売値で出す
     match 最低利益ライン ≤ 相場      → 相場に合わせる（相場 − 下げる額。損益分岐で止める）
     low   損益分岐 ≤ 相場            → 見送り（利益不足）
     loss  相場 < 損益分岐            → 見送り（赤字）
     none  相場未入力                 → 推奨売値を使う
     nolow Amazon最安値が未取得       → 判断できない */
  function soldVerdict(rec, item, cut) {
    if (!rec) return { kind: "nolow", price: 0, rec: null, sold: null };
    if (item === null || item === undefined)
      return { kind: "none", price: rec.price, rec: rec, sold: null };
    if (item >= rec.price) return { kind: "rec", price: rec.price, rec: rec, sold: item };
    if (item >= rec.floor) {
      var c = Number(cut);
      if (!(c >= 0)) c = 0;
      var p = Math.round((item - c) * 100) / 100, floored = false;
      if (p < rec.be) { p = rec.be; floored = true; }
      return { kind: "match", price: p, rec: rec, sold: item, cut: c, floored: floored };
    }
    if (item >= rec.be) return { kind: "low", price: 0, rec: rec, sold: item };
    return { kind: "loss", price: 0, rec: rec, sold: item };
  }
  /* いまの設定で出すべき売値。見送り（利益不足・赤字）の行は 0。 */
  function wantPrice(S, r, over, soldUsd) {
    var rec = recOf(S, r, over);
    if (!rec) return 0;
    var v = soldVerdict(rec, soldItem(S, r, over, soldUsd), S.syncSoldCut);
    var p = 0;
    if (v.kind === "rec" || v.kind === "match") p = v.price;
    else if (v.kind === "none") p = rec.price;
    if (!(p > 0)) return 0;
    // Amazonで売ったほうが得な行は、その利益に並ぶところまで上げる
    var a = amzLine(S, r, over);
    return (a && a.price > p) ? a.price : p;
  }
  /* ---- 自動処理に渡す目標 ---- */
  // 1回の値下げ幅。下限までを回数で割り、最低幅より小さくならないようにする
  function mdStep(S, start, floor) {
    var st = Number(start) || 0, f = Number(floor) || 0;
    var n = S.csvMarkTimes, min = S.csvMarkStep;
    if (!(st > 0) || !(f > 0) || !(st > f)) return min;
    var v = Math.ceil((st - f) / n * 100) / 100;
    return (v < min) ? min : v;
  }
  /* 売値の見直しの自動反映に渡す目標（rv_*）。 */
  function rvTarget(S, r, over, soldUsd) {
    var rec = recOf(S, r, over);
    var v = soldVerdict(rec, soldItem(S, r, over, soldUsd), S.syncSoldCut);
    var kind = (v.kind === "low" || v.kind === "loss") ? "skip"
      : ((v.kind === "rec" || v.kind === "match" || v.kind === "none") ? v.kind : "");
    var want = (kind === "skip") ? 0 : wantPrice(S, r, over, soldUsd);
    var fl = floorOf(S, r, over);
    var w = weightOf(S, r, over);
    return { rv_kind: kind, rv_want: Math.round((want || 0) * 100) / 100,
             rv_floor: Math.round((fl.v || 0) * 100) / 100,
             rv_max_cost: (want > 0) ? maxCost(S, want, w.v, 0) : 0 };
  }
  /* 自動値下げに渡す設定（md_*）。決められない行は null。 */
  function mdPlan(S, r, over) {
    var now = Number(r.ebay_price) || 0, fl = floorOf(S, r, over).v;
    if (!(now > 0) || !(fl > 0) || !(now > fl)) return null;
    return { md_start: Math.round(now * 100) / 100,
             md_floor: Math.round(fl * 100) / 100,
             md_step: mdStep(S, now, fl), md_n: S.csvMarkTimes };
  }
  /* 再調達（フェイズB）と、再調達中の売値の追従に渡す目標。
     どちらも **Amazon最安値を仕入値とみなした推奨売値**で、保存済みの仕入値は使わない。
     low … { low, at, fresh, has }（鮮度は呼ぶ側が now を渡して決める） */
  var LOW_MS = 24 * 60 * 60 * 1000;      // Amazon最安値・目標の鮮度
  function lowOf(S, r, now) {
    var b = basis(S, r);
    var low = b.low || Number(r.amazon_lowest || 0) || 0;
    var at = String(r.amazon_lowest_at || "");
    var t = Date.parse(at);
    var n = (now === undefined || now === null) ? Date.now() : now;
    return { low: low, at: at, fresh: !!t && (n - t) <= LOW_MS, has: low > 0,
             useNew: b.useNew };
  }
  /* 再調達で出す売値。出せないときは ok:false と理由を返す。 */
  function pbWant(S, r, now) {
    var lo = lowOf(S, r, now);
    if (!lo.has) return { ok: false, why: "Amazon最安値が未取得", low: lo };
    if (!lo.fresh) return { ok: false, why: "Amazon最安値が古い（24時間超）", low: lo };
    var rec = recommend(S, r);        // 仕入値は使わず Amazon最安値基準
    if (!rec) return { ok: false, why: "推奨売値を計算できません", low: lo };
    var cur = Number(r.ebay_price || 0) || 0;
    var price = rec.price, under = false, down = 0;
    if (cur > 0 && price < cur) {
      down = Math.round((1 - price / cur) * 100);
      if (price < rec.floor) { price = rec.floor; under = true;
        down = Math.round((1 - price / cur) * 100); }
    }
    return { ok: true, price: Math.round(price * 100) / 100, floor: rec.floor,
             low: lo, down: down, under: under, rec: rec,
             max_cost: maxCost(S, price, weightOf(S, r).v, 0) };
  }
  /* 再調達中の売値の追従に渡す目標（rk_*）。最安値が取れていない行は null。 */
  function rkWant(S, r) {
    var lo = lowOf(S, r);
    if (!lo.has) return null;
    var rec = recommend(S, r);
    if (!rec) return null;
    return { rk_want: Math.round(rec.price * 100) / 100,
             rk_floor: Math.round((rec.floor || 0) * 100) / 100,
             rk_low: lo.low, rk_n: nearN(S, r),
             rk_max_cost: maxCost(S, rec.price, weightOf(S, r).v, 0) };
  }

  /* ================= 仕入れ先（差し替えられる作り）=================
     「売れたあとに買い直せるか」を1か所で決める。
     いまは Amazon最安値だけ。マッチングワールドを始めるときは
     mw_low / mw_low_at / mw_n / mw_stock を埋める取り込みを1本書き、
     ここの分岐を1つ足すだけで切り替わる（呼ぶ側は変えない）。

     S.buySrc … 'auto'（既定・取れているうちの安いほう）/ 'amazon' / 'mw'
     返り値
       low   … 仕入れ値（円・送料込み）
       at    … その値の取得日時
       fresh … BUY_MS（24時間）以内か
       has   … 値が取れているか
       n     … 同じ値段の出品者数（相当）。1人だけの安値を避ける判定に使う
       stock … 仕入れ先に在庫があるか true / false / null（分からない）
       src   … 'amazon' / 'mw' */
  var BUY_MS = LOW_MS;                   // 仕入れ値の鮮度（Amazon最安値と同じ24時間）
  var BUY_SRCS = { auto: 1, amazon: 1, mw: 1 };
  function buyAmazon(S, r, now) {
    var lo = lowOf(S, r, now);
    /* Amazon は「最安値が出ない＝出品が無い」で在庫なしと見る。
       まだ一度も取っていない行は分からない（null）。 */
    var stock = lo.at ? (lo.has && Number(r.amazon_offers || 0) > 0) : null;
    return { low: lo.low, at: lo.at, fresh: lo.fresh, has: lo.has,
             n: nearN(S, r), stock: stock, src: "amazon" };
  }
  function buyMw(S, r, now) {
    var low = Number(r.mw_low || 0) || 0;
    var at = String(r.mw_low_at || "");
    var t = Date.parse(at);
    var n = (now === undefined || now === null) ? Date.now() : now;
    var st = r.mw_stock;
    return { low: low, at: at, fresh: !!t && (n - t) <= BUY_MS, has: low > 0,
             n: Number(r.mw_n || 0),
             stock: (st === null || st === undefined) ? null : !!Number(st),
             src: "mw" };
  }
  function buySource(S, r, now) {
    var want = BUY_SRCS[String(S.buySrc || "")] ? String(S.buySrc) : "auto";
    var a = buyAmazon(S, r, now), m = buyMw(S, r, now);
    if (want === "amazon") return a;
    if (want === "mw") return m;
    /* auto … 使えるもの（取れていて新しい）のうち安いほう。
       どちらも使えなければ、取れているほう（理由を出すため）。 */
    var aOk = a.has && a.fresh, mOk = m.has && m.fresh;
    if (aOk && mOk) return (m.low < a.low) ? m : a;
    if (aOk) return a;
    if (mOk) return m;
    return a.has ? a : (m.has ? m : a);
  }

  /* ================= 売れた値段での在庫補充（数量を1に戻す）=================
     値下げの途中で売れた行は、その値段が「売れる値段」だと分かったということ。
     数量0になった行を**同じ値段のまま**数量1に戻す（新しく出品し直すのではなく、
     同じ出品の数量を 0→1 にするだけ）。
     返り値 { act:'relist'|'', why, price, hand, buy, max } */
  var SK_FAIL_WARN = 3;                  // 続けてこの回数失敗したら自動処理から外す
  /* 「売れた値段で保つ」対象にしない行。**ここ1か所だけで決める**。
     印を立てる側（Worker の jobOrders）と、在庫補充の判定（下の skRelist）の
     両方がこれを読む。

     ・一点物 … 売れたら在庫が無い。数量0になった時点で値下げも値上げも
       止まっている（mdSkip が先に「一点物」を返す）ので、印に意味がない。
       立てると絞り込み「対応が必要」に並ぶだけになる
     ・無在庫 … いまは対象外（売れてから仕入れる運用で、「要仕入れ」の通知で
       回している）。**マッチングワールドの取引を始めたら、下の dropship の
       1行を消すだけで対象に戻る。ほかに手を入れる場所は無い**

     一点物かどうかが**未確定**（one_off_known=0）の行は印を立てる。
     「一点物か確認してください」と出して、人に決めてもらうため。 */
  function skKeepOff(r) {
    if (Number((r || {}).one_off || 0)) return "一点物";
    if (Number((r || {}).dropship || 0)) return "無在庫（いまは対象外）";
    return "";
  }
  function skRelist(S, r, now) {
    var no = function (why) { return { act: "", why: why }; };
    if (!Number(r.sold_keep || 0)) return no("売れた値段で保つ印がありません");
    if (!String(r.ebay_item_id || "").trim()) return no("出品していません");
    if (Number(r.ebay_qty || 0) > 0) return no("数量があります");
    var price = Math.round((Number(r.sold_price || 0) || 0) * 100) / 100;
    if (!(price > 0)) return no("売れた値段が分かりません");
    /* 一点物・無在庫は skKeepOff が決める（印を立てる側と同じ1か所）。 */
    var off = skKeepOff(r);
    if (off) return no(off);
    if (!Number(r.one_off_known || 0)) return no("一点物か確認してください");
    if (Number(r.restocking || 0)) return no("再調達中（売値の追従が見ます）");
    if (String(r.pb_act || "") === "restock") return no("フェイズBの再調達の予定です");
    if (Number(r.ebay_sale || 0)) return no("eBayのセール中");
    if (Number(r.pb_skip || 0)) return no("今回は動かさない");
    if (Number(r.sk_fail || 0) >= SK_FAIL_WARN) return no("続けて失敗（対応が必要）");
    /* ① FBA在庫・手元在庫があれば、それで補充できる（仕入れ値は見ない）。 */
    var hand = Number(r.fba_available || 0) > 0 || Number(r.on_hand || 0)
      || Number(r.hand_qty || 0) > 0;
    if (hand)
      return { act: "relist", why: "手持ちの在庫で補充できます", price: price,
               hand: true, buy: null, max: 0 };
    /* ② 無ければ仕入れ直す前提。いまの仕入れ値で、売れた値段でも下限利益が残るか。 */
    var b = buySource(S, r, now);
    /* 在庫なしを先に見る。取りに行って最安値が出なかった行（at はあるが low が0）は
       「未取得」ではなく「在庫がありません」。 */
    if (b.stock === false) return no("仕入れ先に在庫がありません");
    if (!b.has) return no("仕入れ値が未取得");
    if (!b.fresh) return no("仕入れ値が古い（24時間超）");
    var max = maxCost(S, price, weightOf(S, r).v, flatOf(S, r));
    if (!(max > 0)) return no("売れた値段では下限利益を確保できません");
    if (b.low > max)
      return no("いまの仕入れ値では下限利益を割ります（仕入 " + Math.round(b.low)
        + "円 ＞ 上限 " + max + "円）");
    return { act: "relist", why: "仕入れ直して補充できます", price: price,
             hand: false, buy: b, max: max };
  }

  var API = {
    VERSION: "3.1.0",
    C: C, DEFAULTS: DEFAULTS, ROW_DEFAULTS: ROW_DEFAULTS,
    settings: settings,
    ceil2: ceil2, round2: round2, feeBreak: feeBreak,
    airRate: airRate, emsRate: emsRate, faceShip: faceShip,
    autoTarget: autoTarget, model: model,
    priceFor: priceFor, priceForProfit: priceForProfit, maxCost: maxCost,
    /* 行ごとの目標（D段） */
    LOW_MS: LOW_MS,
    offersOf: offersOf, condKey: condKey, condKnown: condKnown,
    isAcceptable: isAcceptable,
    basis: basis, nearN: nearN, defWeight: defWeight, weightOf: weightOf,
    flatOf: flatOf, costOf: costOf,
    recommend: recommend, recCost: recCost, recOf: recOf,
    amzProfit: amzProfit, amzLine: amzLine, floorOf: floorOf,
    soldItem: soldItem, soldVerdict: soldVerdict, wantPrice: wantPrice,
    mdStep: mdStep, rvTarget: rvTarget, mdPlan: mdPlan,
    lowOf: lowOf, pbWant: pbWant, rkWant: rkWant,
    /* 仕入れ先と、売れた値段での在庫補充 */
    BUY_MS: BUY_MS, SK_FAIL_WARN: SK_FAIL_WARN,
    buyAmazon: buyAmazon, buyMw: buyMw, buySource: buySource,
    skKeepOff: skKeepOff, skRelist: skRelist
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof globalThis !== "undefined") globalThis.PJ_PRICING = API;
})();
