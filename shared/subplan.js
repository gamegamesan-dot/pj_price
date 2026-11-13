/* 会員向け Discord のプランの表（8.11・【Y】）
   画面（index.html）・pj-sync（proxy-sync/worker.js）・
   Discord の道具（discord/*.mjs）の**すべて**で使うので、
   表はこの1ファイルだけに置く（pricing.js・mwcsv.js・mwstat.js・shopcsv.js・
   subprice.js・mwfee.js・mwsite.js と同じ決まり）。

   いまはモニターだけ動かす。ライト・スタンダード・プレミアムは
   **設定だけ持って止めておく**（on を false にしてある）。

     key      … プランの記号（Discord のロール名と同じ）
     name     … 画面に出す名前
     ch       … 送り先のチャンネル（⚙ の subCh<Key> に Discord の ID を入れる）
     kinds    … 配信する商品の種類（'game' ＝ ゲームソフト通常版だけ／
                 'all' ＝ 全部／'one' ＝ 1点ものも先行で出す）
     n        … 1回に送る件数の上限
     q        … 1商品あたり買える数
     on       … いま動かすか（モニターだけ true）

   ⚙ で変えられるもの（Worker の subSettings が渡す）
     on<Key>  … そのプランを動かすか
     n<Key>   … 1回の件数　q<Key> … 1商品あたりの数　ch<Key> … チャンネルID
     ship<Key>… カードの「送料」の文（8.17）。空なら重さから出した文を使う
                （モニターは「4本以上 送料無料」など、プランごとに変えられる） */
(function (root) {
  "use strict";
  var PLANS = [
    { key: "monitor",  name: "モニター",     kinds: "game", n: 10, q: 1,
      on: true,  note: "ゲームソフト通常版のみ・1回10件まで・1商品1点まで" },
    { key: "light",    name: "ライト",       kinds: "game", n: 20, q: 2,
      on: false, note: "ゲームソフト全件（いまは止めています）" },
    { key: "standard", name: "スタンダード", kinds: "all",  n: 50, q: 5,
      on: false, note: "全部（いまは止めています）" },
    { key: "premium",  name: "プレミアム",   kinds: "one",  n: 100, q: 5,
      on: false, note: "全部＋1点もの（先行）（いまは止めています）" }
  ];
  var N_MAX = 200;                 // 1回に送れる件数の上限の上限
  var Q_MAX = 99;                  // 1商品あたりの数の上限
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function s(v) { return (v === null || v === undefined) ? "" : String(v); }
  function keyUp(k) { return s(k).charAt(0).toUpperCase() + s(k).slice(1); }
  function plan(key) {
    for (var i = 0; i < PLANS.length; i++)
      if (PLANS[i].key === s(key)) return PLANS[i];
    return null;
  }
  /* ⚙（settings）を当てたプランの表。cfg は画面の⚙の値をそのまま渡す。 */
  function list(cfg) {
    var o = cfg || {};
    return PLANS.map(function (p) {
      var U = keyUp(p.key);
      var on = o["subOn" + U];
      var n = num(o["subN" + U]);
      var q = num(o["subQ" + U]);
      return { key: p.key, name: p.name, kinds: p.kinds, note: p.note,
               on: (on === undefined || on === null || on === "")
                 ? p.on : !!(on === true || on === 1 || on === "1"),
               n: (n > 0) ? Math.min(N_MAX, Math.round(n)) : p.n,
               q: (q > 0) ? Math.min(Q_MAX, Math.round(q)) : p.q,
               /* 8.17 カードの「送料」の文（プランごと・空なら既定）。 */
               ship: s(o["subShip" + U]).trim().slice(0, 300),
               ch: s(o["subCh" + U]).replace(/\D/g, "") };
    });
  }
  /* いま配信するプラン（動かす印があり、チャンネルIDが入っているもの）。 */
  function active(cfg) {
    return list(cfg).filter(function (p) { return p.on && p.ch; });
  }
  /* その商品をこのプランに出すか。
     ・grades（mw_sub.grades）が入っていれば、その中にプランがあること
     ・kinds が 'game' のプランは**ゲームソフトだけ**
     ・1点もの（one_off）は 'one' のプランだけ */
  function fits(plan, row, isGame) {
    return !fitWhy(plan, row, isGame);
  }
  /* 8.20（【6】）**出さない理由**。'' なら出す。
     プランごとの予定が0件のときに「なぜ0件か」を出すのに使う
     （画面も pj-sync も同じこの文を使う）。 */
  function fitWhy(plan, row, isGame) {
    var p = plan || {}, r = row || {};
    var g = s(r.grades).split(",").map(function (x) { return x.trim(); })
      .filter(Boolean);
    if (g.length && g.indexOf(p.key) < 0)
      return "ほかのプランに振り分けてあります（" + g.join("・") + "）";
    if (r.one_off && p.kinds !== "one")
      return "1点ものはこのプランに出しません";
    if (p.kinds === "game" && !isGame)
      return "ゲームソフトだけのプランです";
    return "";
  }
  /* そのプランが0件になる理由（まとめて1行にする）。
     rows … 配信できる商品（「読み込みました」の印が付いた行）
     isGameOf … 行がゲームソフトかを返す関数（手数料の区分は mwfee.js） */
  function whyNone(plan, rows, isGameOf) {
    var p = plan || {};
    if (!p.on) return "⚙で「配信する」が入っていません";
    if (!p.ch) return "⚙にチャンネルID が入っていません";
    var list = rows || [];
    if (!list.length)
      return "配信できる商品がありません"
        + "（「会員に出す」の印と「Shopify に読み込みました」の印が要ります）";
    var tally = {}, keys = [];
    for (var i = 0; i < list.length; i++) {
      var w = fitWhy(p, list[i],
        (typeof isGameOf === "function") ? !!isGameOf(list[i]) : false);
      if (!w) continue;
      if (tally[w] === undefined) keys.push(w);
      tally[w] = (tally[w] || 0) + 1;
    }
    if (!keys.length) return "";
    return keys.map(function (k) { return k + " " + tally[k] + "件"; })
      .join("／");
  }
  /* ===== 8.18 今日の配信の案（振り分けの決まり）=====
     仕入れタブの候補（刈取の一覧）を、プランごとに自動で振り分ける。
     決まりはここ1か所だけ（画面・pj-sync が同じこれを読む）。

     共通の条件
       ・会員向きの判定（粗利の下限、または利益率の下限と最低額）を満たす
         … 判定は shared/subprice.js の fitOf（6.188）
       ・出品できる（Amazon の出品制限が ok）
       ・Amazon 本体ありは除く（⚙ subPickNoAmz・既定オン）
       ・カジが「仕入れる」の印を付けた商品は外す（⚙ subPickSkipBuy・既定オン）
       ・在庫処分・再入荷なしの商品を**優先**（並びの点数を上げる）
     並び順
       会員の粗利 × 売れる速さ の大きい順（売れる速さが出せない行は
       1日 0.3点とみなす＝出さないほどではないが後ろに回る）
     販売数の上限のおすすめ
       MW 在庫から「MW 自身がこれから売る分」（売れる速さ × ⚙日数）を引き、
       その ⚙% と、会員の想定購入数の小さいほう */
  var PICK = {
    noAmz: true,        // ⚙ subPickNoAmz   … Amazon 本体ありを除く
    skipBuy: true,      // ⚙ subPickSkipBuy … 「仕入れる」印を外す
    stockPct: 30,       // ⚙ subStockPct    … MW 在庫の何%まで出すか
    wantQty: 5,         // ⚙ subWantQty     … 会員の想定購入数（1商品あたり）
    qtyDays: 2,         // ⚙ subQtyDays     … MW 自身がこれから売る日数
    saleBoost: 1.5      // 在庫処分・再入荷なしの点数の倍率（優先）
  };
  function bool(v, dflt) {
    if (v === undefined || v === null || v === "") return dflt;
    return !!(v === true || v === 1 || v === "1" || v === "true");
  }
  function pickOpt(cfg) {
    var o = cfg || {};
    var n = function (k, d, lo, hi) {
      var v = Number(o[k]);
      if (!isFinite(v) || v < lo || v > hi) return d;
      return v;
    };
    return {
      noAmz: bool(o.subPickNoAmz, PICK.noAmz),
      skipBuy: bool(o.subPickSkipBuy, PICK.skipBuy),
      stockPct: n("subStockPct", PICK.stockPct, 0, 100),
      wantQty: Math.round(n("subWantQty", PICK.wantQty, 0, 999)),
      qtyDays: n("subQtyDays", PICK.qtyDays, 0, 60),
      saleBoost: PICK.saleBoost
    };
  }
  /* 販売数の上限のおすすめ（8.18 の2）。0 なら案に出さない。
     row … { stock, speed }（speed は shared/mwstat.js の「1日あたり」） */
  function qtyOf(row, plan, opt) {
    var r = row || {}, p = plan || {}, o = opt || pickOpt(null);
    var stock = Math.max(0, num(r.stock));
    if (!stock) return 0;
    var speed = Math.max(0, num(r.speed));
    /* MW 自身がこれから売る分を引く（売れる速さ × 日数）。 */
    var left = Math.max(0, stock - speed * num(o.qtyDays));
    var n = Math.floor(left * num(o.stockPct) / 100);
    var q = Math.min(n, Math.max(0, Math.round(num(o.wantQty))));
    /* 1点も出せないときは 0（案に出さない）。 */
    return Math.max(0, Math.round(q));
  }
  /* 並びの点数（大きいほど先）。会員の粗利 × 売れる速さ。 */
  var SPEED_MIN = 0.3;             // 売れる速さが出せない行の見なし
  function scoreOf(row, opt) {
    var r = row || {}, o = opt || pickOpt(null);
    var g = Math.max(0, num(r.gross));
    var sp = num(r.speed);
    if (!(sp > 0)) sp = SPEED_MIN;
    var sc = g * sp;
    /* 在庫処分・再入荷なしは優先（刈り切る候補）。 */
    if (r.no_back) sc *= num(o.saleBoost) || 1;
    return sc;
  }
  /* 共通の条件。通らない理由を返す（通れば ''）。 */
  function whyNot(row, opt) {
    var r = row || {}, o = opt || pickOpt(null);
    if (!r.fit) return "会員向きではありません";
    if (s(r.rst) === "blocked") return "出品できません";
    if (o.noAmz && r.amz) return "Amazon 本体あり";
    if (o.skipBuy && num(r.buy_qty) > 0) return "仕入れる印が付いています";
    if (!(num(r.price) > 0)) return "販売価格が出せません";
    return "";
  }
  /* プランごとの案（件数の上限まで）。
     rows は画面・pj-sync が作った行の配列（下の項目を入れておく）
       jan, name, kishu, stock, speed, gross, price, qty（上限のおすすめ）,
       fit（会員向きか）, rst, amz, buy_qty, no_back, one_off, grades */
  function draft(rows, plans, cfg) {
    var o = pickOpt(cfg);
    var out = [];
    (plans || []).forEach(function (p) {
      var pick = [], skip = [];
      (rows || []).forEach(function (r) {
        var why = whyNot(r, o);
        if (!why && !fits(p, r, !!r.is_game)) why = (p.kinds === "game")
          ? "ゲームソフト通常版ではありません" : "このプラン向きではありません";
        if (!why && !(num(r.qty) > 0)) why = "出せる数がありません";
        if (why) { skip.push({ jan: r.jan, why: why }); return; }
        pick.push(Object.assign({}, r, { score: scoreOf(r, o), plan: p.key }));
      });
      pick.sort(function (a, b) { return b.score - a.score; });
      out.push({ key: p.key, name: p.name, n: p.n, on: p.on, ch: p.ch,
                 items: pick.slice(0, p.n), over: Math.max(0, pick.length - p.n),
                 skip: skip.length });
    });
    return { plans: out, opt: o };
  }
  var API = { PLANS: PLANS, N_MAX: N_MAX, Q_MAX: Q_MAX,
              plan: plan, list: list, active: active, fits: fits,
    fitWhy: fitWhy, whyNone: whyNone,
              keyUp: keyUp, PICK: PICK, pickOpt: pickOpt, qtyOf: qtyOf,
              scoreOf: scoreOf, whyNot: whyNot, draft: draft,
              SPEED_MIN: SPEED_MIN };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_SUBPLAN = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
