/* Amazon刈取の利益の式（7.128・6.168・【V の続き】）
   画面（index.html）と pj-sync（proxy-sync/worker.js）の**両方**で使う。
   式はこの1ファイルだけに置く（pricing.js・mwcsv.js・mwstat.js と同じ決まり）。

   なぜ共通にしたか
     一覧の絞り込み（黒字のみ・利益率）と並べ替え（粗利・利益率）を
     pj-sync の側でやるようになったので、**画面と同じ数字**でないと
     「画面では黒字なのにサーバーが外す」という食い違いが起きる。

   使い方
     const S = MWAMZ.fromSettings(st);   // pj-sync（/settings の控え）
     const S = MWAMZ.fromUi(getById);    // 画面（⚙の入力）
     const c = MWAMZ.calc(row, S);       // c.profit / c.net / c.margin / c.genre

   S に入るもの（ぜんぶ⚙の設定。既定値はこのファイルの DEF）
     ship       … MW の仕入れ送料（1点あたり・円）
     profitMode … 'mw'（MW送料込み）／'sedori'（せどりすと方式）
     netMode    … 'sedori'（×0.9）／'exact'（×10/11）
     feeGame / feeHobby / feeOther … 販売手数料の率（%）
     fbaShipS/StoreS … 小型の配送代行／在庫管理（標準＝M・大型＝L も同じ）
     fbaGame / fbaHobby / fbaOther … 古い設定（配送代行だけ）の受け皿
     sizeGame / sizeHobby … サイズ区分が取れていないときの既定（s/m/l） */
(function (root) {
  "use strict";
  /* 機種（kishu）→ ジャンル。手数料の率と FBA の既定サイズを決める。 */
  var GAME = { NS: 1, NS2: 1, NS2H: 1, P5: 1, P4: 1, "3DS": 1, PS5: 1, PS4: 1,
               SW: 1, PP: 1, PV: 1, XB: 1, XBX: 1, WIN: 1, PCC: 1, "68": 1 };
  var HOBBY = { b2cchara_figure: 1, figure: 1, FIG: 1, GF: 1, plasticmodel: 1 };
  var FBA_SIZE = { s: "小型", m: "標準", l: "大型" };
  var FEE_TAX_PCT = 10;            // 手数料の消費税（せどりすと と同じ）
  var DEF = { ship: 176, profitMode: "mw", netMode: "sedori",
              feeGame: 15, feeHobby: 10, feeOther: 15,
              fbaShipS: 288, fbaStoreS: 1, fbaShipM: 425, fbaStoreM: 16,
              fbaShipL: 675, fbaStoreL: 93,
              fbaGame: 530, fbaHobby: 580, fbaOther: 400,
              sizeGame: "s", sizeHobby: "m" };
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  /* 0 を入れたときに既定へ戻らないよう、数かどうかで見る（画面の mwNum0 と同じ）。 */
  function num0(v, def) {
    var x = Number(v);
    return (isFinite(x) && x >= 0) ? x : def;
  }
  function genre(r) {
    var k = String((r || {}).kishu || "");
    if (GAME[k]) return "ゲーム";
    if (HOBBY[k]) return "フィギュア";
    return "その他";
  }
  /* 設定（S）を作る。get(id) は値を返す関数（画面は入力の value）。 */
  function fromUi(get) {
    var g = function (id) { return get(id); };
    return {
      ship: num0(g("mwShipFee"), DEF.ship),
      profitMode: (String(g("mwProfitMode") || "") === "sedori")
        ? "sedori" : "mw",
      netMode: (String(g("mwNetMode") || "") === "exact") ? "exact" : "sedori",
      feeGame: num0(g("mwAmzFeeGame"), DEF.feeGame),
      feeHobby: num0(g("mwAmzFeeHobby"), DEF.feeHobby),
      feeOther: num0(g("amzFeeRate"), DEF.feeOther),
      fbaShipS: num0(g("mwFbaShipS"), DEF.fbaShipS),
      fbaStoreS: num0(g("mwFbaStoreS"), DEF.fbaStoreS),
      fbaShipM: num0(g("mwFbaShipM"), DEF.fbaShipM),
      fbaStoreM: num0(g("mwFbaStoreM"), DEF.fbaStoreM),
      fbaShipL: num0(g("mwFbaShipL"), DEF.fbaShipL),
      fbaStoreL: num0(g("mwFbaStoreL"), DEF.fbaStoreL),
      fbaGame: num0(g("mwAmzFbaGame"), DEF.fbaGame),
      fbaHobby: num0(g("mwAmzFbaHobby"), DEF.fbaHobby),
      fbaOther: num0(g("amzFbaFee"), DEF.fbaOther),
      sizeGame: FBA_SIZE[String(g("mwFbaSizeGame") || "")]
        ? String(g("mwFbaSizeGame")) : DEF.sizeGame,
      sizeHobby: FBA_SIZE[String(g("mwFbaSizeHobby") || "")]
        ? String(g("mwFbaSizeHobby")) : DEF.sizeHobby,
    };
  }
  /* pj-sync は /settings の控え（文字の入った object）から作る。 */
  function fromSettings(st) {
    var s = st || {};
    return fromUi(function (id) { return s[id]; });
  }
  /* サイズ区分。寸法から決まった区分（size_tier）があればそれ。 */
  function sizeOf(r, S) {
    var t = String((r || {}).size_tier || "");
    if (FBA_SIZE[t]) return t;
    var g = genre(r);
    var v = (g === "ゲーム") ? S.sizeGame
      : ((g === "フィギュア") ? S.sizeHobby : "m");
    return FBA_SIZE[v] ? v : "m";
  }
  function sizeFrom(r) {
    return FBA_SIZE[String((r || {}).size_tier || "")] ? "寸法から" : "既定";
  }
  /* FBA手数料の目安（配送代行＋在庫管理）。 */
  function fbaGuess(r, S) {
    var k = sizeOf(r, S);
    var ship = (k === "s") ? S.fbaShipS : ((k === "l") ? S.fbaShipL : S.fbaShipM);
    var store = (k === "s") ? S.fbaStoreS
      : ((k === "l") ? S.fbaStoreL : S.fbaStoreM);
    /* 古い設定（FBA手数料（ゲーム）／（ホビー））しか入っていないときは、
       そちらを配送代行として使う（いきなり数字が変わらないように）。 */
    if (!ship && !store) {
      var g = genre(r);
      ship = (g === "ゲーム") ? S.fbaGame
        : ((g === "フィギュア") ? S.fbaHobby : S.fbaOther);
    }
    return { size: k, sizeName: FBA_SIZE[k], from: sizeFrom(r),
             ship: ship, store: store, fba: ship + store };
  }
  /* 仮の手数料（実額が無い行）。 */
  function feeGuess(r, S) {
    var g = genre(r), fb = fbaGuess(r, S);
    var rate = (g === "ゲーム") ? S.feeGame
      : ((g === "フィギュア") ? S.feeHobby : S.feeOther);
    return { rate: rate, fba: fb.fba, fb: fb };
  }
  /* その行の手数料。実額（fee_total>0）があればそれ、無ければ仮の値。 */
  function feeOf(r, S) {
    var row = r || {};
    var real = n(row.fee_total) > 0;
    if (real) {
      var ref = n(row.fee_ref), fba = n(row.fee_fba), tax = n(row.fee_tax);
      var tot = n(row.fee_total);
      /* 合計が明細より大きいときは、差を消費税に寄せる。 */
      if (tot > ref + fba + tax) tax = tot - ref - fba;
      var sh = n(row.fee_fba_ship), st2 = n(row.fee_fba_store);
      if (fba && sh + st2 !== fba) { st2 = st2 || 0; sh = fba - st2; }
      /* SP-API の FBA手数料には**在庫管理手数料が入っていない**ので足す。 */
      var fb0 = fbaGuess(row, S), storeGuess = 0;
      if (!st2 && fb0.store > 0) { st2 = fb0.store; storeGuess = 1; fba = sh + st2; }
      var taxGuess = 0;
      if (!tax && ref) { tax = Math.round(ref * FEE_TAX_PCT / 100); taxGuess = 1; }
      return { ref: ref, fba: fba, fbaShip: sh, fbaStore: st2, tax: tax,
               fee: ref + fba + tax, real: true,
               storeGuess: storeGuess, taxGuess: taxGuess,
               size: fb0.size, sizeName: fb0.sizeName, sizeFrom: fb0.from,
               rate: (ref && n(row.fee_base))
                 ? Math.round(ref / n(row.fee_base) * 1000) / 10 : null,
               base: n(row.fee_base), at: row.fee_at || "" };
    }
    var f = feeGuess(row, S), price = n(row.price);
    var ref2 = Math.round(price * f.rate / 100);
    /* 仮の値でも手数料の消費税10%を足す（せどりすと と同じ）。 */
    var tax2 = Math.round(ref2 * FEE_TAX_PCT / 100);
    return { ref: ref2, fba: f.fba, fbaShip: f.fb.ship, fbaStore: f.fb.store,
             tax: tax2, fee: ref2 + f.fba + tax2, real: false,
             storeGuess: 0, taxGuess: 0,
             size: f.fb.size, sizeName: f.fb.sizeName, sizeFrom: f.fb.from,
             rate: f.rate, base: price, at: "" };
  }
  /* 仕入原価。MW送料込み（実際に出ていくお金）と せどりすと方式（卸値×1.1）。 */
  function cost(r, S) {
    var w = n((r || {}).wholesale);
    return (w > 0) ? (Math.round(w * 1.1) + num0(S.ship, DEF.ship)) : 0;
  }
  function costSedo(r) {
    var w = n((r || {}).wholesale);
    return (w > 0) ? Math.round(w * 1.1) : 0;
  }
  /* 税抜の粗利。せどりすと は粗利の10%を納付消費税として引く。 */
  function net(profit, S) {
    var p = Math.round(n(profit));
    if (p <= 0) return p;            // 赤字のときは引かない
    return (S && S.netMode === "exact") ? Math.round(p * 10 / 11)
                                        : Math.round(p * 0.9);
  }
  /* 1行ぶんの利益。値段か卸値が無い行は null（一覧では計算できない行）。 */
  function calc(r, S0) {
    var S = S0 || fromSettings({});
    var row = r || {};
    var price = n(row.price);
    if (!(price > 0)) return null;
    var c = cost(row, S);
    if (!(c > 0)) return null;
    var z = feeOf(row, S);
    var cs = costSedo(row);
    var profitMw = Math.round(price - z.fee - c);
    var profitSedo = Math.round(price - z.fee - cs);
    var mode = (S.profitMode === "sedori") ? "sedori" : "mw";
    var profit = (mode === "sedori") ? profitSedo : profitMw;
    return { price: price, cost: c, costSedo: cs, ship: num0(S.ship, DEF.ship),
             fee: z.fee, rate: z.rate, fba: z.fba,
             fbaShip: n(z.fbaShip), fbaStore: n(z.fbaStore),
             feeRef: z.ref, feeTax: z.tax, feeReal: z.real, feeAt: z.at,
             feeSize: z.sizeName || "", feeSizeFrom: z.sizeFrom || "",
             feeStoreGuess: !!z.storeGuess, feeTaxGuess: !!z.taxGuess,
             /* 使うほう（並べ替え・絞り込み） */
             profit: profit, net: net(profit, S),
             margin: Math.round(profit / price * 1000) / 10,
             /* 両方（表示用） */
             profitSedo: profitSedo, netSedo: net(profitSedo, S),
             marginSedo: Math.round(profitSedo / price * 1000) / 10,
             profitMw: profitMw, netMw: net(profitMw, S),
             marginMw: Math.round(profitMw / price * 1000) / 10,
             profitMode: mode, netMode: (S.netMode === "exact")
               ? "exact" : "sedori",
             genre: genre(row) };
  }
  /* ---- 一覧の絞り込みに使う見分け（画面と pj-sync で同じ答えを出す）---- */
  /* ランキング（大分類の順位）。 */
  function rankOf(r) { return n((r || {}).rank); }
  /* その行の大分類に入れた上限（⚙「ランキングの基準」）。 */
  function rankCapOf(r, caps) {
    var c = caps || {};
    var v = n(c[String((r || {}).rank_cat || "")]);
    return v > 0 ? v : 0;
  }
  function rankCapAny(caps) {
    var c = caps || {};
    for (var k in c) if (n(c[k]) > 0) return true;
    return false;
  }
  /* JAN重複（候補が2件以上で、まだ選んでいない）。 */
  function janDup(r) {
    return n((r || {}).cand_n) >= 2 && !String((r || {}).jan_picked_at || "");
  }
  /* ---- 検索（6.115・6.125）----
     全角と半角をそろえてから、**ぜんぶの語が入っているか**で見る。 */
  function norm(v) {
    var t = String(v === null || v === undefined ? "" : v);
    try { if (t.normalize) t = t.normalize("NFKC"); } catch (e) {}
    t = t.replace(/[！-～]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    t = t.replace(/\u3000/g, " ");
    t = t.replace(/[‐‑‒–—―ー−]/g, "-");
    return t.toLowerCase().trim();
  }
  function terms(q) {
    return norm(q).split(/\s+/).filter(Boolean).slice(0, 8);
  }
  function hit(hay, ts) {
    if (!ts || !ts.length) return true;
    var h = norm(hay);
    for (var i = 0; i < ts.length; i++) if (h.indexOf(ts[i]) < 0) return false;
    return true;
  }
  function hayAmz(r) {
    var row = r || {};
    return [row.mw_name, row.amz_name, row.jan, row.asin, row.sha, row.kishu]
      .filter(Boolean).join(" ");
  }
  function matchAmz(r, ts) {
    if (!ts || !ts.length) return true;
    if (hit(hayAmz(r), ts)) return true;
    /* SKU をそのまま打ったとき（E-…-C など）は、中の ASIN でも当てる。 */
    var a = String((r || {}).asin || "").toUpperCase();
    if (a && ts.length === 1) {
      var m = /B[0-9A-Z]{9}/.exec(String(ts[0]).toUpperCase());
      if (m && m[0] === a) return true;
    }
    return false;
  }
  /* ---- 1行を残すか（画面の mwAmzKeep と**同じ順・同じ判定**）----
     f … { genre, win, multi, noAmz, rstOk, dup, minM, caps, capAny, noRank }
     c … calc(r,S) の結果（null は計算できない行）
     返りは { keep, rankHid }（rankHid はランキングの基準で隠した行） */
  function keep(r, c, f) {
    var row = r || {}, o = f || {};
    if (o.dup) return { keep: janDup(row), rankHid: false };
    if (!c) return { keep: janDup(row), rankHid: false };
    if (o.genre && (genre(row) || "その他") !== o.genre)
      return { keep: false, rankHid: false };
    if (o.win && c.profit <= 0) return { keep: false, rankHid: false };
    if (o.multi && n(row.new_n) < 2) return { keep: false, rankHid: false };
    if (o.noAmz && n(row.amz)) return { keep: false, rankHid: false };
    if (o.rstOk && String(row.rst || "") !== "ok")
      return { keep: false, rankHid: false };
    var rk = rankOf(row), cap = rankCapOf(row, o.caps);
    if (rk > 0) {
      if (cap && rk > cap) return { keep: false, rankHid: true };
    } else if (o.capAny && !o.noRank) {
      return { keep: false, rankHid: true };
    }
    if (o.minM && c.margin < o.minM) return { keep: false, rankHid: false };
    return { keep: true, rankHid: false };
  }
  var API = { GAME: GAME, HOBBY: HOBBY, FBA_SIZE: FBA_SIZE,
              FEE_TAX_PCT: FEE_TAX_PCT, DEF: DEF,
              num0: num0, genre: genre, fromUi: fromUi,
              fromSettings: fromSettings, sizeOf: sizeOf, sizeFrom: sizeFrom,
              fbaGuess: fbaGuess, feeGuess: feeGuess, feeOf: feeOf,
              cost: cost, costSedo: costSedo, net: net, calc: calc,
              rankOf: rankOf, rankCapOf: rankCapOf, rankCapAny: rankCapAny,
              janDup: janDup, norm: norm, terms: terms, hit: hit,
              hayAmz: hayAmz, matchAmz: matchAmz, keep: keep };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_MWAMZ = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
