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
      /* 8.21（【1】）normal … **通常版だけ**のプラン（限定版・特装版などを外す）。 */
      normal: true,
      on: true,  note: "ゲームソフト通常版のみ・1回10件まで・1商品1点まで" },
    { key: "light",    name: "ライト",       kinds: "game", n: 20, q: 2,
      on: false, note: "ゲームソフト全件（いまは止めています）" },
    { key: "standard", name: "スタンダード", kinds: "all",  n: 50, q: 5,
      on: false, note: "全部（いまは止めています）" },
    { key: "premium",  name: "プレミアム",   kinds: "one",  n: 100, q: 5,
      on: false, note: "全部＋1点もの（先行）（いまは止めています）" }
  ];
  /* ===== 8.21（【1】）通常版かどうか =====
     モニターは「ゲームソフト通常版のみ」なのに、限定版・初回生産の商品が
     案に入っていた（2026-11-14・カジの報告）。
     **言葉の表はここ1か所だけ**。⚙「通常版でない言葉」（subNormalNg）で
     足せる（読点・カンマ・改行・空白で区切る）。

     見分け方
       ① 下の言葉が商品名にあれば「通常版ではない」
       ② 無くて「通常版」と書いてあれば通常版
       ③ 無くて「版」が入っているだけなら **通常版か要確認**（印を出す）
          … 「薔薇と椿 〜お豪華絢爛版〜」のように作品名に「版」が入るものは
            通常版なので、外さずに印だけ出す
     見るのは**掃除したあとの名前**（6.194 の titleOf）。
     【特典】…の中の「限定版特典」「同梱」で外さないため。 */
  var NORMAL_NG = [
    "限定版", "特装版", "初回限定", "初回生産", "完全生産限定", "数量限定",
    "豪華版", "コレクターズ", "コレクター", "同梱", "セット", "BOX",
    "ＢＯＸ", "ボックス", "DXパック", "DX パック", "デラックスエディション",
    "プレミアムエディション", "アニバーサリーエディション", "特別版",
    "ツインパック", "ダブルパック", "トリプルパック"
  ];
  var N_MAX = 200;                 // 1回に送れる件数の上限の上限
  var Q_MAX = 99;                  // 1商品あたりの数の上限
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function s(v) { return (v === null || v === undefined) ? "" : String(v); }
  function keyUp(k) { return s(k).charAt(0).toUpperCase() + s(k).slice(1); }
  /* 商品名の掃除（6.194）は shared/shopcsv.js の1か所だけ。
     読めないときは元の名前で見る（判定が消えないように）。 */
  function shopMod() {
    var g = (typeof globalThis !== "undefined") ? globalThis : root;
    if (g && g.PJ_SHOPCSV) return g.PJ_SHOPCSV;
    if (typeof require === "function") {
      try { return require("./shopcsv.js"); } catch (e) { return null; }
    }
    return null;
  }
  function cleanName(v) {
    var S = shopMod();
    var t = (S && typeof S.titleOf === "function") ? S.titleOf(v, 200) : s(v);
    return t || s(v);
  }
  /* ⚙ で足した言葉を入れた表。 */
  function ngWords(cfg) {
    var add = s((cfg || {}).subNormalNg).split(/[,、\s\n]+/)
      .map(function (x) { return x.trim(); }).filter(Boolean);
    var out = NORMAL_NG.slice();
    for (var i = 0; i < add.length; i++)
      if (out.indexOf(add[i]) < 0) out.push(add[i]);
    return out;
  }
  /* 通常版か。{ ok, hit, maybe } を返す。
     ok=false … 通常版ではない（hit がその言葉）
     maybe=true … 通常版か要確認（名前に「版」が入っているだけ） */
  function normalOf(name, words) {
    var t = cleanName(name);
    var up = t.toUpperCase();
    var list = (words && words.length) ? words : NORMAL_NG;
    for (var i = 0; i < list.length; i++) {
      var w = s(list[i]).trim();
      if (!w) continue;
      if (up.indexOf(w.toUpperCase()) >= 0)
        return { ok: false, hit: w, maybe: false };
    }
    if (t.indexOf("通常版") >= 0) return { ok: true, hit: "", maybe: false };
    return { ok: true, hit: "", maybe: t.indexOf("版") >= 0 };
  }
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
               /* 8.21（【1】）通常版だけのプランと、⚙で足した言葉。 */
               normal: !!p.normal, ng: ngWords(o),
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
    /* 8.21（【1】）通常版だけのプラン（モニター）。 */
    if (p.normal) {
      var nm = normalOf(r.name, p.ng);
      if (!nm.ok) return "通常版ではありません（" + nm.hit + "）";
    }
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
  /* ===== 8.22（【2】）1点もの（秋葉原などで仕入れた商品）=====
     MW の無在庫とは別に、カジが手で登録した1点ものを配信する。
     ・#目玉商品-先行（プレミアム）に**先に**出す
     ・⚙の時間（既定 24時間）のあと #目玉商品（スタンダード以上）に出す
     チャンネルID は ⚙（subChPre／subChHot）。表はここ1か所だけ。 */
  var ONE_PLANS = [
    { key: "one_pre", name: "目玉商品-先行（プレミアム）",
      cfgCh: "subChPre", grade: "premium", pre: true,
      note: "プレミアムだけに先に出す" },
    { key: "one_open", name: "目玉商品（スタンダード以上）",
      cfgCh: "subChHot", grade: "standard", pre: false,
      note: "先行から⚙の時間がたった商品を出す" }
  ];
  var ONE_PRE_HOURS = 24;          // ⚙ subPreHours … 先行だけに出す時間
  var ONE_OPEN_GRADES = "standard,premium";   // ⚙ subOneOpenGrades
  function oneHours(cfg) {
    var v = num((cfg || {}).subPreHours);
    return (v > 0 && v <= 24 * 30) ? v : ONE_PRE_HOURS;
  }
  /* Shopify のタグに入れるグレード。
     先行のあいだは premium だけ、あいたら ⚙ の分（既定 standard・premium）。 */
  function oneGrades(cfg, open) {
    if (!open) return "premium";
    var v = s((cfg || {}).subOneOpenGrades).trim();
    return v || ONE_OPEN_GRADES;
  }
  function oneList(cfg) {
    var o = cfg || {};
    return ONE_PLANS.map(function (p) {
      var ch = s(o[p.cfgCh]).replace(/\D/g, "");
      return { key: p.key, name: p.name, note: p.note, grade: p.grade,
               pre: p.pre, ch: ch, on: !!ch, hours: oneHours(o),
               one: true };
    });
  }
  /* その1点ものをこのプランに出すか。'' なら出す。
     row … { off, loaded_at, qty, sold, pre_at }
     now … いまの時刻（ISO。テストで固定できるように渡す） */
  function oneWhy(plan, row, now) {
    var p = plan || {}, r = row || {};
    if (num(r.off)) return "取り下げています";
    if (!s(r.loaded_at).trim())
      return "Shopify に読み込みました の印がありません";
    if (p.pre) return "";
    /* #目玉商品（スタンダード以上）は、先行から⚙の時間がたってから。 */
    if (!s(r.pre_at).trim()) return "まだ先行に出していません";
    var t0 = Date.parse(s(r.pre_at)), t1 = Date.parse(s(now) || "");
    if (!isFinite(t0)) return "先行に出した時刻が読めません";
    if (!isFinite(t1)) t1 = Date.now();
    var h = (t1 - t0) / 3600000;
    if (h < num(p.hours))
      return "先行のあと " + Math.ceil(num(p.hours) - h) + "時間待ちです";
    return "";
  }
  function oneFits(plan, row, now) { return !oneWhy(plan, row, now); }
  /* そのプランが0件になる理由（8.20 と同じ出し方）。 */
  function oneWhyNone(plan, rows, now) {
    var p = plan || {};
    if (!p.ch) return "⚙にチャンネルID が入っていません";
    var list = rows || [];
    if (!list.length)
      return "1点ものがありません（仕入れタブの「1点ものを登録する」で"
        + "登録し、Shopify 用 CSV を読み込んでから「読み込みました」を"
        + "押してください）";
    var tally = {}, keys = [];
    for (var i = 0; i < list.length; i++) {
      var w = oneWhy(p, list[i], now);
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
        /* 8.21（【1】）案に出す印
             maybe … 通常版か要確認（名前に「版」が入っているだけ）
             slow  … 売れる速さが 1日 0点（後ろに回す） */
        var nm = normalOf(r.name, p.ng);
        pick.push(Object.assign({}, r, { score: scoreOf(r, o), plan: p.key,
                                         maybe: !!nm.maybe,
                                         slow: !(num(r.speed) > 0) }));
      });
      /* 速さ 0点の行は**いちばん後ろ**に回す（点数より先に見る）。 */
      pick.sort(function (a, b) {
        if (!!a.slow !== !!b.slow) return a.slow ? 1 : -1;
        return b.score - a.score;
      });
      out.push({ key: p.key, name: p.name, n: p.n, on: p.on, ch: p.ch,
                 items: pick.slice(0, p.n), over: Math.max(0, pick.length - p.n),
                 skip: skip.length });
    });
    return { plans: out, opt: o };
  }
  var API = { PLANS: PLANS, N_MAX: N_MAX, Q_MAX: Q_MAX,
              plan: plan, list: list, active: active, fits: fits,
    fitWhy: fitWhy, whyNone: whyNone,
    NORMAL_NG: NORMAL_NG, ngWords: ngWords, normalOf: normalOf,
    cleanName: cleanName,
    ONE_PLANS: ONE_PLANS, ONE_PRE_HOURS: ONE_PRE_HOURS,
    ONE_OPEN_GRADES: ONE_OPEN_GRADES, oneHours: oneHours,
    oneGrades: oneGrades, oneList: oneList, oneWhy: oneWhy,
    oneFits: oneFits, oneWhyNone: oneWhyNone,
              keyUp: keyUp, PICK: PICK, pickOpt: pickOpt, qtyOf: qtyOf,
              scoreOf: scoreOf, whyNot: whyNot, draft: draft,
              SPEED_MIN: SPEED_MIN };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_SUBPLAN = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
