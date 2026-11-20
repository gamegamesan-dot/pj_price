/* 「赤字にならない売値」を売り方ごとに出す（8.37・v296・カジの依頼）

   理由（カジ・2026-11-15）
     ゲーム数本だと FBA は**倉庫までの送料**で利益が消えるので、会員の
     多くは **Amazon 自己配送・メルカリ・ヤフオク**で売る。
     v287 の「赤字にならない売値」は **Amazon の手数料だけ**で、送料は
     別になっていたので、会員が「いくらで売れば赤字にならないか」を
     そのまま使えなかった。

   売り方ごとに引かれるもの（カジの依頼）
     amz_self … 販売手数料（カテゴリー別・率）＋ 1点ごとの成約料
                 ＋ 送料 ＋ 梱包材
     amz_fba  … 販売手数料（率）＋ FBA 配送代行手数料（固定）
                 ＋ 倉庫までの送料（1点あたり）
     mercari  … 販売手数料（率・既定 10%）＋ 送料
     yahoo    … 落札システム利用料（率・既定 10%）＋ 送料

   式（売値 P のとき、手元に残る額が仕入れ価格以上になる P）
     P − (P×率 ＋ 固定) ≧ 仕入れ価格
       → P ＝ (仕入れ価格 ＋ 固定) ÷ (1 − 率)      ※10円単位で切り上げ

   決まり
     ・**率も金額もぜんぶ⚙**（ここの D は既定＝たたき台）。
       コードに数字を書かない（カジの依頼2）。
     ・Amazon の率は、その行で**実際に取れている手数料**（fee_rate）を使う
       （カテゴリー別の販売手数料＋その消費税）。取れていない行は
       Amazon の売り方を**出さない**（当てずっぽうの額は出さない）。
     ・送料は、その商品の**送り方の区分**（shared/shopcsv.js が決める）から
       ⚙の金額を引く。区分が分からない行は送料を足さず「送料は別」と書く。
     ・**メルカリ・ヤフオクの相場は取りに行かない**（規約で機械的な読み取りが
       禁止されているため）。率と送料だけで出す（カジの依頼4）。
   この1ファイルだけに置く（pj-sync・画面・テストが同じものを読む）。 */
(function (root) {
  "use strict";
  /* 売り方。key は⚙（gdWays）で書く名前。 */
  var WAYS = [
    { key: "amz_self", ja: "Amazon 自己配送", amz: 1 },
    { key: "amz_fba", ja: "Amazon FBA", amz: 1 },
    { key: "mercari", ja: "メルカリ", amz: 0 },
    { key: "yahoo", ja: "ヤフオク", amz: 0 }
  ];
  /* ⚙の既定（たたき台）。金額はぜんぶ⚙で直せる。 */
  var D = {
    gdWays: "amz_self,mercari,yahoo",   // 既定で出す売り方
    gdFeeMercari: 10,                   // メルカリ 販売手数料（%）
    gdFeeYahoo: 10,                     // ヤフオク 落札システム利用料（%）
    gdAmzClose: 0,                      // Amazon 1点ごとの成約料（円）
    gdPack: 20,                         // 梱包材（円・自己配送）
    gdFbaIn: 50,                        // FBA 倉庫までの送料（1点あたり・円）
    /* 送り方の区分ごとの送料（円）。区分は shared/shopcsv.js の SHIP_WAYS。
       ネコポスのように同じ大きさの送り方を使うときは、
       クリックポストの欄にその金額を入れる。 */
    gdShipCp: 185,                      // クリックポスト（薄物）
    gdShipLetter: 600,                  // レターパックプラス
    gdShipCompact: 520,                 // 宅急便コンパクト（専用箱込み）
    gdShipBox60: 800,                   // 宅配便（60サイズ）
    gdShipBox80: 1000,                  // 宅配便（80サイズ）
    gdShipBox: 1200,                    // 宅配便（100サイズ以上）
    /* 8.50（カジの依頼）メルカリ・ヤフオクの売値は **Amazon の価格の◯%**
       と仮定する（相場は取りに行かない・カジの数字は90%）。 */
    gdPctMercari: 90,                   // メルカリの売値（Amazon の%）
    gdPctYahoo: 90                      // ヤフオクの売値（Amazon の%）
  };
  /* 区分キー → ⚙の名前。 */
  var SHIP_KEY = { cp: "gdShipCp", letter: "gdShipLetter",
                   compact: "gdShipCompact", box60: "gdShipBox60",
                   box80: "gdShipBox80", box: "gdShipBox" };

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function s(v) { return (v === null || v === undefined) ? "" : String(v); }
  /* 金額の書き方は subguide.js・subcard.js と同じ（¥1,234）。 */
  function yen(v) { return "¥" + Math.round(num(v)).toLocaleString("en-US"); }
  /* ⚙の値。空・読めないときは既定。 */
  function val(o, k) {
    var v = (o || {})[k];
    if (v === undefined || v === null || v === "") return D[k];
    var n = Number(v);
    return isFinite(n) ? n : D[k];
  }
  /* 率（%で入っていても 0〜1 で入っていても受ける）。 */
  function pct(o, k) {
    var v = val(o, k);
    if (v > 1) v = v / 100;
    return Math.max(0, Math.min(0.9, num(v)));
  }
  function wayOf(key) {
    var k = s(key).trim();
    for (var i = 0; i < WAYS.length; i++)
      if (WAYS[i].key === k || WAYS[i].ja === k) return WAYS[i];
    return null;
  }
  /* ⚙で選んだ売り方（カンマ区切り）。空なら既定。 */
  function listOf(opt) {
    var t = s((opt || {}).gdWays).trim() || D.gdWays;
    var a = t.split(/[,\s、，／\/]+/), out = [], i, w;
    for (i = 0; i < a.length; i++) {
      w = wayOf(a[i]);
      if (w && out.indexOf(w) < 0) out.push(w);
    }
    return out.length ? out : listOf({ gdWays: D.gdWays });
  }
  /* その商品の送料（円）。区分が分からない行は 0（＝送料は別と書く）。 */
  function shipOf(wayKey, opt) {
    var k = SHIP_KEY[s(wayKey).trim()];
    if (!k) return 0;
    return Math.max(0, Math.round(val(opt, k)));
  }
  /* 8.81 箱ものの送り方ごとの実額（円）。会員便の段に足す箱ものの段
     （shared/shopcsv.js の tiersBox）に渡す。⚙は gdShip* の1か所のまま。 */
  function boxCosts(opt) {
    var out = {};
    for (var k in SHIP_KEY)
      if (Object.prototype.hasOwnProperty.call(SHIP_KEY, k) && k !== "cp")
        out[k] = shipOf(k, opt);
    return out;
  }
  /* 8.57（カジの依頼）**会員から受け取る送料が、実際の送料より安いか**。
       wayKey … 送り方の区分（shared/shopcsv.js の shipWay().key）
       got    … 会員から受け取る額（会員便の段の1点ぶん・shipSteps の yen1）
     実額は⚙（gdShipCp など）の1か所から取る。
     どちらかが分からないときは **short:false**（当てずっぽうで外さない）。
     返り { short, cost, got, gap, ja } */
  function shortOf(wayKey, got, opt) {
    var k = s(wayKey).trim();
    var cost = shipOf(k, opt);
    var g = Math.max(0, Math.round(num(got)));
    var out = { short: false, cost: cost, got: g, gap: 0, ja: "" };
    if (!(cost > 0) || !(g > 0)) return out;
    if (cost <= g) return out;
    out.short = true;
    out.gap = cost - g;
    /* 送り方の名前は呼ぶ側から渡す（名前の表は shared/shopcsv.js の1か所）。 */
    var nm = s((opt || {}).shipName).trim();
    out.ja = "会員から " + yen(g) + "／実際 " + yen(cost)
      + (nm ? ("・" + nm) : "") + "・不足 " + yen(out.gap);
    return out;
  }
  /* 10円単位で切り上げ。 */
  function up10(v) { return Math.ceil(num(v) / 10) * 10; }
  /* 1つの売り方の「赤字にならない売値」。
       r   … { price, fee_rate, fee_fba, fee_total, amz_price }
       ship… その商品の送料（円・分からなければ 0）
     出せないときは { ok:false }（当てずっぽうの額は出さない）。 */
  function floorOf(wayKey, r, opt, ship) {
    var w = wayOf(wayKey);
    if (!w) return { ok: false };
    var x = r || {}, o = opt || {};
    /* 8.52（カジの確認）会員が**こちらに払う送料**も仕入れ値に入れる
       （入れるかは⚙。既定は入れる）。会員から見た「出ていくお金」は
       商品代金＋送料なので、こうしないと手残りが多めに出る。 */
    var cost = Math.round(num(x.price)) + Math.max(0, Math.round(
      num(x.buy_ship)));
    if (!(cost > 0)) return { ok: false };
    var sh = Math.max(0, Math.round(num(ship)));
    var rate = 0, fix = 0, parts = [];
    if (w.amz) {
      rate = num(x.fee_rate);
      /* Amazon の率が取れていない行は出さない（カジの依頼・
         「取れていない項目は出さない」）。 */
      if (!(rate > 0 && rate < 0.9)) return { ok: false };
      parts.push("販売手数料");
      if (w.key === "amz_self") {
        var close = Math.max(0, Math.round(val(o, "gdAmzClose")));
        var pack = Math.max(0, Math.round(val(o, "gdPack")));
        fix = close + sh + pack;
        if (close > 0) parts.push("成約料 " + yen(close));
        if (sh > 0) parts.push("送料 " + yen(sh));
        if (pack > 0) parts.push("梱包材 " + yen(pack));
      } else {
        /* FBA の配送代行手数料。実額（fee_fba）が無いときは、
           手数料の合計から率のぶんを引いた残りを固定とみなす。 */
        var fba = Math.round(num(x.fee_fba));
        if (!(fba > 0)) {
          var tot = Math.round(num(x.fee_total));
          var p0 = Math.round(num(x.amz_price));
          fba = (tot > 0 && p0 > 0) ? Math.max(0, Math.round(tot - p0 * rate))
                                    : 0;
        }
        if (!(fba > 0)) return { ok: false };
        var into = Math.max(0, Math.round(val(o, "gdFbaIn")));
        fix = fba + into;
        parts.push("FBA 配送代行 " + yen(fba));
        if (into > 0) parts.push("倉庫までの送料 " + yen(into));
      }
    } else {
      rate = (w.key === "mercari") ? pct(o, "gdFeeMercari")
                                   : pct(o, "gdFeeYahoo");
      if (!(rate >= 0 && rate < 0.9)) return { ok: false };
      fix = sh;
      parts.push((w.key === "mercari") ? "販売手数料" : "落札システム利用料");
      if (sh > 0) parts.push("送料 " + yen(sh));
    }
    var p = (cost + fix) / (1 - rate);
    if (!isFinite(p) || p <= 0) return { ok: false };
    return { ok: true, key: w.key, ja: w.ja, yen: up10(p),
             rate: rate, fix: fix, ship: sh, parts: parts };
  }
  /* 8.50 その売り方の「売値の見かた」（Amazon の価格の何%か）。
     Amazon の売り方は Amazon の価格そのまま（100%）。 */
  function sellPct(wayKey, opt) {
    var w = wayOf(wayKey);
    if (!w) return 0;
    if (w.amz) return 1;
    var v = val(opt, (w.key === "mercari") ? "gdPctMercari" : "gdPctYahoo");
    if (v > 1) v = v / 100;
    return Math.max(0, Math.min(2, num(v)));
  }
  /* 8.50（カジの依頼）その売り方で売ったときの**手残り**。
       手残り ＝ 売値 ×(1 − 率) − 固定（送料・梱包材・FBA など）− 仕入れ値
     ・売値は Amazon の価格（メルカリ・ヤフオクは ⚙の% を掛ける）
     ・仕入れ値は **会員が払う額**（r.price）
     ・送り方の区分が分からない行は**送料を引かない**（unsure:true）。
       足切りではこの行を外さない（カジの指示）
     出せないときは { ok:false }（当てずっぽうの額は出さない）。 */
  function netOf(wayKey, r, opt, ship) {
    var f = floorOf(wayKey, r, opt, ship);
    if (!f.ok) return { ok: false };
    var x = r || {};
    var amz = Math.round(num(x.amz_price));
    if (!(amz > 0)) return { ok: false };
    var pc = sellPct(wayKey, opt);
    var sell = Math.round(amz * pc);
    /* 8.52 仕入れ値は**会員が払う額＋こちらに払う送料**（⚙で入れる）。 */
    var cost = Math.round(num(x.price)) + Math.max(0, Math.round(
      num(x.buy_ship)));
    var net = Math.round(sell * (1 - f.rate) - f.fix - cost);
    return { ok: true, key: f.key, ja: f.ja, net: net, sell: sell,
             pct: pc, rate: f.rate, fix: f.fix, ship: f.ship,
             unsure: !(num(ship) > 0), floor: f.yen };
  }
  /* 売り方ぜんぶの手残り（⚙で選んだ売り方だけ・出せないものは入れない）。
       opt.shipKey / shipName / shipSure … linesOf と同じ */
  function netsOf(r, opt) {
    var o = opt || {};
    var sure = !!o.shipSure;
    var ship = sure ? shipOf(o.shipKey, o) : 0;
    var out = [];
    listOf(o).forEach(function (w) {
      var n = netOf(w.key, r, o, ship);
      if (n.ok) out.push(n);
    });
    return { items: out, ship: ship, sure: sure,
             shipName: s(o.shipName) };
  }
  /* 1つの売り方の手残り（⚙で選んでいない売り方でも出す・試算に使う）。 */
  function netWay(wayKey, r, opt) {
    var o = opt || {};
    var ship = o.shipSure ? shipOf(o.shipKey, o) : 0;
    return netOf(wayKey, r, o, ship);
  }
  /* カードに出す行（売り方ごと・1行ずつ）。
       opt.shipKey  … 送り方の区分（shared/shopcsv.js の shipWay().key）
       opt.shipName … その区分の名前（文に出す）
       opt.shipSure … 区分を名乗ってよいか（false なら送料を足さない）
     返り { ok, text, items:[{key,ja,yen}], ship, shipName } */
  function linesOf(r, opt) {
    var o = opt || {};
    var sure = !!o.shipSure;
    var ship = sure ? shipOf(o.shipKey, o) : 0;
    var list = listOf(o), out = [], i, f;
    for (i = 0; i < list.length; i++) {
      f = floorOf(list[i].key, r, o, ship);
      if (f.ok) out.push(f);
    }
    if (!out.length) return { ok: false, text: "", items: [] };
    var L = out.map(function (x) {
      return x.ja + " **" + yen(x.yen) + "** 以上";
    });
    /* 何を引いたあとの値段かを最後に1行。 */
    var pack = Math.max(0, Math.round(val(o, "gdPack")));
    var hasSelf = false;
    for (i = 0; i < out.length; i++)
      if (out[i].key === "amz_self") hasSelf = true;
    var note = ship > 0
      ? ("（手数料と送料 " + yen(ship)
         + (s(o.shipName) ? ("（" + s(o.shipName) + "）") : " ") + "を引いたあと"
         + ((hasSelf && pack > 0) ? ("。自己配送は梱包材 " + yen(pack)
             + " も見ています") : "") + "）")
      : "（手数料を引いたあと・**送料は別**）";
    L.push(note);
    return { ok: true, text: L.join("\n"), items: out,
             ship: ship, shipName: s(o.shipName) };
  }
  /* 固定メッセージ（#はじめに）に書く説明。 */
  function pinJa(opt) {
    var o = opt || {};
    var ja = listOf(o).map(function (x) { return x.ja; }).join("・");
    return "売り方ごとに「この値段以上で売れれば赤字になりません」を"
      + "出しています（" + ja + "）。"
      + "**それぞれの手数料と送料**を引いたあとの値段です"
      + "（送り方が分からない商品は送料を入れていません）。"
      + "メルカリ・ヤフオクの相場は見ていません";
  }
  var API = { shortOf: shortOf, boxCosts: boxCosts, WAYS: WAYS, D: D, SHIP_KEY: SHIP_KEY, wayOf: wayOf,
              listOf: listOf, shipOf: shipOf, floorOf: floorOf,
              linesOf: linesOf, pinJa: pinJa, val: val, pct: pct,
              /* 8.50 売り方ごとの手残り（足切りと試算に使う）。 */
              sellPct: sellPct, netOf: netOf, netsOf: netsOf,
              netWay: netWay };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_SELLWAY = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
