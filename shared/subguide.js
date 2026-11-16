/* 会員カードの「買うかどうかの目安」（8.29・カジの依頼）— v287

   ねらい：**せどりが初めての会員でも、カードだけで決められるようにする。**
   モニターからプレミアムへ進んでもらうための案内で、
   **利益を保証するものではない**（カードにもそう書く）。

   出すもの（この順・1項目1行）
     1 総合の札   ◎ ねらい目／○ ふつう／△ 慎重に ＋ 一言の理由
     2 売れ行き   どれくらい売れているか
     3 値動き     これまでの最安値・平均と、いまの位置
     4 ライバル   出品者の数と Amazon 本体
     5 最低価格   赤字にならない売値（会員価格＋Amazon の手数料から）
     6 出品制限   「出せるかはアカウントごとに違う」の注意

   決まり（カジの依頼）
     ・しきい値は⚙で直せる（ここの D が既定＝たたき台）
     ・出し方を⚙で切り替える
         'word'（既定）… 加工した表現だけ（「よく売れています」）
         'num'          … 数字も出す
       既定を word にしてあるのは、**外から買ったデータをそのまま会員に
       配ってよいかが未確認**のため（規約を確かめるまでは言葉にする）。
     ・**データが古い行（⚙の日数より前）は札を出さず「データ確認中」**
     ・取れていない項目は**その行ごと出さない**（当てずっぽうを書かない）
     ・プランごとに出す項目を⚙で選べる
     ・Keepa のグラフ画像・Amazon の画像は使わない（文字だけ）

   データの出どころ（2026-11-14 時点）
     ・売れ行き … **Amazon のランキング**（pj が持っている）。
       Keepa につなげば「月◯個」も出せるようにしてある（keepa_sales30）
     ・値動き   … **pj が自分で控えている値段の記録**（mw_amz の px_*）。
       記録を始めてからの最安値・平均。Keepa につなげば180日ぶんに変わる
     ・ライバル … 新品の出品者数・Amazon 本体（pj が持っている）
   この1ファイルだけに置く（pj-sync・画面・テストが同じものを読む）。 */
(function (root) {
  "use strict";
  /* しきい値の既定（たたき台）。⚙で直せる。 */
  var D = {
    /* 売れ行き（Keepa の月間販売数が取れているとき） */
    gdSellA: 30,            // これ以上なら「よく売れています」
    gdSellB: 8,             // これ以上なら「ときどき売れています」
    /* 売れ行き（ランキングで見るとき。小さいほどよく売れている） */
    gdRankA: 30000,
    gdRankB: 120000,
    /* ライバル（新品の出品者数） */
    gdRivalA: 5,            // これ以下なら「ライバルが少ない」
    gdRivalB: 15,           // これ以下なら「ふつう」
    /* 利益率（会員の粗利 ÷ 会員価格） */
    gdRateA: 25,
    gdRateB: 12,
    /* データの古さ（日）。これより古ければ札を出さない */
    gdOldDays: 14,
    /* 値動きの「安い／高い」の幅（平均から何%離れたら言うか） */
    gdPxPct: 5
  };
  var MARKS = {
    a: { mark: "◎", name: "ねらい目" },
    b: { mark: "○", name: "ふつう" },
    c: { mark: "△", name: "慎重に" },
    x: { mark: "—", name: "データ確認中" }
  };
  /* カードに出せる項目（⚙でプランごとに選ぶときの名前）。
     8.34（カジの依頼）**「出品できるか」はカードから外した**
     （商品1枚ごとに同じ注意が出て煩わしかった）。同じ注意は
     **#はじめに の共通の文に必ず入る**（pinCommon）。
     ここに無い名前は⚙に書いても無視されるので、⚙でも選べない。 */
  var ITEMS = ["badge", "sell", "px", "rival", "floor", "net"];
  var ITEM_JA = { badge: "総合", sell: "売れ行き", px: "値動き",
                  rival: "ライバル", floor: "赤字にならない売値",
                  /* 8.52（カジの決定）売り方ごとの手残りの**目安**。 */
                  net: "売った場合の手残りの目安" };
  /* プランごとの既定（モニターは短く、プレミアムはぜんぶ）。 */
  var ITEM_DEF = {
    monitor: "badge,sell,net",
    light: "badge,sell,rival,net",
    standard: "badge,sell,px,rival,floor,net",
    premium: "badge,sell,px,rival,floor,net",
    one_pre: "badge,rival,floor,net",
    one_open: "badge,rival,floor,net"
  };
  var LIMIT_JA = "出品できるかは**アカウントごとに違います**。"
    + "買う前にセラーセントラルで確かめてください。";
  var NOTE_JA = "目安です。利益を保証するものではありません";

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function s(v) { return (v === null || v === undefined) ? "" : String(v); }
  function val(o, k) {
    var v = (o || {})[k];
    if (v === undefined || v === null || v === "") return D[k];
    var n = Number(v);
    return (isFinite(n) && n >= 0) ? n : D[k];
  }
  function yen(n) {
    return "¥" + Math.round(num(n)).toLocaleString("en-US");
  }
  /* 8.37（v296・カジの依頼）売り方ごとの「赤字にならない売値」。
     率・送料・梱包材の決まりは shared/sellway.js の1か所だけ。
     読めないときは、その行を出さない（当てずっぽうの額は出さない）。 */
  function sellMod() {
    var g = (typeof globalThis !== "undefined") ? globalThis : root;
    if (g && g.PJ_SELLWAY) return g.PJ_SELLWAY;
    if (typeof require === "function") {
      try { return require("./sellway.js"); } catch (e) { return null; }
    }
    return null;
  }
  /* 出し方（'word'＝言葉だけ／'num'＝数字も）。既定は word。 */
  function modeOf(opt) {
    return (s((opt || {}).gdMode).toLowerCase() === "num") ? "num" : "word";
  }
  /* そのプランに出す項目。 */
  function itemsOf(planKey, opt) {
    var o = opt || {};
    var k = s(planKey);
    var raw = s(o["gdItems" + k.charAt(0).toUpperCase() + k.slice(1)]);
    if (!raw) raw = s(o["gdItems_" + k]);
    if (!raw) raw = s(ITEM_DEF[k] === undefined ? ITEM_DEF.premium
                                                : ITEM_DEF[k]);
    var want = raw.split(/[,\s、，]+/).map(function (x) {
      return x.trim(); }).filter(Boolean);
    var out = [];
    for (var i = 0; i < ITEMS.length; i++)
      if (want.indexOf(ITEMS[i]) >= 0) out.push(ITEMS[i]);
    return out;
  }
  /* データの古さ（日）。取った時刻が読めなければ -1（分からない）。 */
  function ageDays(at, now) {
    var t = Date.parse(s(at));
    if (!isFinite(t)) return -1;
    var n = Date.parse(s(now) || "");
    if (!isFinite(n)) n = Date.now();
    return Math.max(0, (n - t) / 86400000);
  }
  /* ---- 2 売れ行き ---- */
  /* 返り：{ ok, score(0〜2), text, why }
     Keepa の月間販売数があればそれ、無ければランキングで見る。
     どちらも無ければ ok:false（**その行を出さない**）。 */
  function sellOf(r, opt) {
    var o = opt || {}, x = r || {};
    var mode = modeOf(o);
    var n = Math.round(num(x.keepa_sales30));
    if (n > 0) {
      var a = val(o, "gdSellA"), b = val(o, "gdSellB");
      var sc = (n >= a) ? 2 : ((n >= b) ? 1 : 0);
      var w = sc === 2 ? "よく売れています"
        : (sc === 1 ? "ときどき売れています" : "あまり売れていません");
      return { ok: true, score: sc, why: w,
               text: (mode === "num") ? (w + "（月 およそ " + n + "個）") : w };
    }
    var rk = Math.round(num(x.rank));
    if (rk > 0) {
      var ra = val(o, "gdRankA"), rb = val(o, "gdRankB");
      var sc2 = (rk <= ra) ? 2 : ((rk <= rb) ? 1 : 0);
      var w2 = sc2 === 2 ? "よく売れています"
        : (sc2 === 1 ? "ときどき売れています" : "あまり売れていません");
      var cat = s(x.rank_cat).trim();
      return { ok: true, score: sc2, why: w2,
               text: (mode === "num")
                 ? (w2 + "（" + (cat ? (cat + " ") : "")
                    + "ランキング " + rk.toLocaleString("en-US") + "位）")
                 : w2 };
    }
    return { ok: false, score: -1, text: "", why: "" };
  }
  /* ---- 3 値動き ---- */
  /* pj が控えている値段の記録（px_min／px_avg／px_days）か、
     Keepa の180日の統計（keepa_min180／keepa_avg180）。
     いまの値段が平均より安いか高いかを言う。 */
  function pxOf(r, opt) {
    var o = opt || {}, x = r || {};
    var mode = modeOf(o);
    var lo = Math.round(num(x.keepa_min180) || num(x.px_min));
    var av = Math.round(num(x.keepa_avg180) || num(x.px_avg));
    var now = Math.round(num(x.amz_price));
    var days = Math.round(num(x.keepa_min180) ? 180 : num(x.px_days));
    if (!(lo > 0 && av > 0 && now > 0)) return { ok: false, text: "", why: "" };
    var pct = val(o, "gdPxPct");
    var d = ((now - av) / av) * 100;
    var w = (d <= -pct) ? "いまは平均より安いです"
      : ((d >= pct) ? "いまは平均より高いです" : "いまは平均どおりです");
    var span = days > 0 ? ("この " + days + "日" ) : "これまで";
    return { ok: true, score: (d <= -pct) ? 2 : ((d >= pct) ? 0 : 1), why: w,
             text: (mode === "num")
               ? (w + "（" + span + "の最安 " + yen(lo) + "・平均 " + yen(av)
                  + "）")
               : (w + "（" + span + "の記録）") };
  }
  /* ---- 4 ライバル ---- */
  function rivalOf(r, opt) {
    var o = opt || {}, x = r || {};
    var mode = modeOf(o);
    var n = Math.round(num(x.new_n));
    var amz = !!num(x.amz);
    if (!(n > 0) && !amz) return { ok: false, text: "", why: "" };
    var a = val(o, "gdRivalA"), b = val(o, "gdRivalB");
    var sc = !(n > 0) ? 1 : ((n <= a) ? 2 : ((n <= b) ? 1 : 0));
    var w = !(n > 0) ? "出品者の数は分かりません"
      : (sc === 2 ? "ライバルが少ないです"
        : (sc === 1 ? "ライバルはふつうです" : "ライバルが多いです"));
    /* Amazon 本体がいるときは札を下げる（勝ちにくい）。 */
    if (amz) { sc = Math.min(sc, 0); w = "Amazon 本体が売っています"; }
    return { ok: true, score: sc, why: w, amz: amz,
             text: (mode === "num" && n > 0)
               ? (w + "（新品の出品者 " + n + "人"
                  + (amz ? "・Amazon 本体あり" : "") + "）")
               : (w + ((amz && n > 0) ? "（出品者も多めです）" : "")) };
  }
  /* ---- 5 赤字にならない売値（8.37・v296）----
     **売り方ごと**に「この値段以上で売れれば赤字にならない」を出す。
     ゲーム数本だと FBA は倉庫までの送料で利益が消えるので、
     会員の多くは Amazon 自己配送・メルカリ・ヤフオクで売るため。
     ・どの売り方を出すか、率・送料・梱包材は**ぜんぶ⚙**
     ・送料はその商品の**送り方の区分**から引く（opt.shipKey）。
       区分が分からない行は送料を足さず「送料は別」と書く
     ・式と表は shared/sellway.js の1か所だけ（画面・pj-sync が同じものを読む） */
  function floorOf(r, opt) {
    var W = sellMod();
    if (!W || typeof W.linesOf !== "function") return { ok: false, text: "" };
    var g = W.linesOf(r || {}, opt || {});
    if (!g.ok) return { ok: false, text: "" };
    return { ok: true, text: g.text, items: g.items,
             yen: g.items.length ? g.items[0].yen : 0 };
  }
  /* ---- 6 売った場合の手残りの目安（8.52・カジの決定）----
     「赤字にならない売値」と**同じ式・同じ⚙**（shared/sellway.js）から、
     その売り方で売ったときに手元に残る額を出す。
     ・**目安**（「約」を付け、10円単位に丸める）
     ・メルカリ・ヤフオクは Amazon の価格の⚙%で売れたと仮定
     ・手数料・発送の送料・梱包材と、**会員がこちらに払う送料**を引いたあと
     ・出す売り方は⚙ gdNetWays（既定 メルカリ＋Amazon 自己配送）
     ・相場は取りに行かない（規約） */
  function netOf(r, opt) {
    var W = sellMod();
    if (!W || typeof W.netsOf !== "function") return { ok: false, text: "" };
    var o = opt || {};
    var ways = s(o.gdNetWays).trim() || "mercari,amz_self";
    var g = W.netsOf(r || {}, Object.assign({}, o, { gdWays: ways }));
    var items = (g.items || []).filter(function (x) { return x.net > 0; });
    if (!items.length) return { ok: false, text: "" };
    var L = items.map(function (x) {
      var pct = Math.round(x.pct * 100);
      var ja = x.ja + ((pct && pct !== 100)
        ? "（Amazon の" + Math.round(pct / 10) + "割で売れた場合）" : "");
      /* 10円単位に丸めて「約」を付ける（1円単位では出さない）。 */
      return ja + " 約 " + yen(Math.floor(x.net / 10) * 10);
    });
    L.push(g.sure
      ? ("※ 手数料と発送の送料（" + (g.shipName || "") + "）、"
         + "こちらにお支払いの送料を引いたあとの**目安**です")
      : "※ 手数料を引いたあとの**目安**です（**発送の送料は別**）");
    return { ok: true, text: L.join("\n"), items: items };
  }
  /* ---- 1 総合の札 ---- */
  /* 売れ行き・ライバル・利益率の3つで決める。
     Amazon 本体がいる行は ◎ にしない。
     データが古い行・材料が足りない行は「データ確認中」。 */
  function badgeOf(r, opt, now) {
    var o = opt || {}, x = r || {};
    var old = val(o, "gdOldDays");
    var age = ageDays(x.amz_at || x.price_at, now);
    if (age < 0 || (old > 0 && age > old))
      return Object.assign({}, MARKS.x, { ok: false, why: "",
        note: "値段を取り直してから出します", stale: true });
    var sell = sellOf(x, o), rival = rivalOf(x, o);
    var rate = num(x.rate);
    if (!(rate > 0) && num(x.gross) > 0 && num(x.price) > 0)
      rate = (num(x.gross) / num(x.price)) * 100;
    var ra = val(o, "gdRateA"), rb = val(o, "gdRateB");
    var rsc = (rate >= ra) ? 2 : ((rate >= rb) ? 1 : (rate > 0 ? 0 : -1));
    /* 材料が足りないときは**札そのものを出さない**（カジの依頼の
       「取れないときは項目ごと出さない」）。古い行だけ「データ確認中」。 */
    if (!sell.ok || !rival.ok || rsc < 0)
      return { mark: "", name: "", ok: false, why: "",
               note: "", stale: false, thin: true };
    var sc = sell.score + rival.score + rsc;
    var mark = (sc >= 5 && !rival.amz) ? MARKS.a
      : ((sc >= 3) ? MARKS.b : MARKS.c);
    /* 一言の理由。いいところ・わるいところを1つずつ拾う。 */
    var good = [], bad = [];
    (sell.score === 2 ? good : (sell.score === 0 ? bad : [])).push(sell.why);
    (rival.score === 2 ? good : (rival.score === 0 ? bad : [])).push(rival.why);
    if (rsc === 2) good.push("利益率が高めです");
    if (rsc === 0) bad.push("利益率が低めです");
    /* いいところを1つ・わるいところを1つ（あれば両方）。
       Amazon 本体のような**気をつける点は必ず出す**。 */
    var why = (bad.length ? [good[0], bad[0]].filter(Boolean)
                          : good.slice(0, 2)).join("、") || "ふつうです";
    return Object.assign({}, mark, { ok: true, score: sc, why: why,
      note: NOTE_JA, stale: false });
  }
  /* ---- カードに出す行（プランごとに選んだ項目だけ）---- */
  /* 返り：{ badge, lines:[{name,value}], note }
     lines は **1項目1行**。取れていない項目は入れない。 */
  function cardOf(r, opt, planKey, now) {
    var o = opt || {}, x = r || {};
    var want = itemsOf(planKey, o);
    var b = badgeOf(x, o, now);
    var out = { badge: b, lines: [], note: NOTE_JA };
    /* 札を出さない（⚙で外した・材料が足りない）ときは null にする。 */
    if (want.indexOf("badge") < 0 || !s(b.mark)) out.badge = null;
    var add = function (key, t) {
      if (want.indexOf(key) < 0 || !t) return;
      out.lines.push({ name: ITEM_JA[key], value: t });
    };
    /* 古い行は数字を出さない（札も「データ確認中」）。 */
    if (b.stale) return out;
    var sell = sellOf(x, o); if (sell.ok) add("sell", sell.text);
    var px = pxOf(x, o); if (px.ok) add("px", px.text);
    var rv = rivalOf(x, o); if (rv.ok) add("rival", rv.text);
    var fl = floorOf(x, o); if (fl.ok) add("floor", fl.text);
    var nt = netOf(x, o); if (nt.ok) add("net", nt.text);
    /* 8.34 「出品できるか」はカードに出さない（#はじめに に任せる）。 */
    return out;
  }
  /* ===== 8.30（カジの依頼）読み方の固定メッセージ =====
     v287 は**チャンネルごとに同じ説明**を並べていたので、
     ・固定メッセージが長くて読みにくい
     ・直すたびに全チャンネルを貼り直す
     ことになっていた。**共通（#はじめに）1本＋チャンネルごとの短い文**に分ける。

     ・共通 … 札の意味・項目の読み方・目安であること・出品できるかの注意・
       注文の流れ（締めと出荷の曜日は⚙）・送料の考え方
     ・短い文 … そのプランのカードに出る項目・1人あたりの点数・
       「読み方は #はじめに をご覧ください」
     **出していない項目は書かない**（Keepa のように持っていないデータの
     説明も書かない）。仕入れ先の名前は書かない。 */
  var PIN_MAX = 1900;            // Discord の1通（2,000字）の手前で分ける
  var DAYS = ["日", "月", "火", "水", "木", "金", "土"];
  var PLAN_ORDER = ["monitor", "light", "standard", "premium"];
  var PLAN_JA = { monitor: "モニター", light: "ライト",
                  standard: "スタンダード", premium: "プレミアム" };
  /* ⚙の曜日（0〜6 か「月」「月曜」）→「月曜」。読めなければ既定。 */
  function dayJa(v, def) {
    var x = s(v).trim();
    if (!x) return def;
    var n = Number(x);
    if (isFinite(n) && n >= 0 && n <= 6) return DAYS[Math.round(n)] + "曜";
    for (var i = 0; i < DAYS.length; i++)
      if (x.indexOf(DAYS[i]) === 0) return DAYS[i] + "曜";
    return def;
  }
  /* その項目を出す**いちばん下のプラン**（出しているプランが無ければ ""）。
     ⚙の「プランごとに出す項目」から自動で出す。 */
  function planFirst(item, opt) {
    for (var i = 0; i < PLAN_ORDER.length; i++)
      if (itemsOf(PLAN_ORDER[i], opt).indexOf(item) >= 0) return PLAN_ORDER[i];
    return "";
  }
  /* 「（スタンダードプラン以上）」。いちばん下のプランなら付けない。 */
  function planNote(item, opt) {
    var k = planFirst(item, opt);
    if (!k || k === PLAN_ORDER[0]) return "";
    return "（" + PLAN_JA[k] + "プラン以上）";
  }
  /* #はじめに の指し方。⚙にチャンネルID（数字）が入っていれば
     <#ID> でリンクにする。名前なら #名前 のまま。 */
  function pinRef(opt) {
    var v = s((opt || {}).gdPinCh).trim() || "はじめに";
    var d = v.replace(/\D/g, "");
    if (d && d.length >= 5 && d === v.replace(/[^0-9]/g, "") && /^\d+$/.test(v))
      return "<#" + d + ">";
    return "#" + v.replace(/^#/, "");
  }
  /* ---- 共通の文（#はじめに 用・1本）---- */
  /* opt … ⚙／plans … SUBPLAN.list の結果（1人あたりの点数に使う） */
  function pinCommon(opt, plans) {
    var o = opt || {};
    var L = [];
    var has = function (k) { return !!planFirst(k, o); };
    L.push("**はじめに（商品リストの読み方）**");
    L.push("");
    L.push("商品リストのカードには、**買うかどうかを決めるための目安**を"
      + "のせています。");
    L.push("**" + NOTE_JA + "。** 最後はご自身で確かめてからお求めください。");
    if (has("badge")) {
      L.push("");
      L.push("**総合の札**" + planNote("badge", o));
      L.push("・**" + MARKS.a.mark + " " + MARKS.a.name
        + "** … 売れ行き・ライバル・利益率のバランスが良い商品です");
      L.push("・**" + MARKS.b.mark + " " + MARKS.b.name
        + "** … ふつうです。値段と残り数を見て決めてください");
      L.push("・**" + MARKS.c.mark + " " + MARKS.c.name
        + "** … ライバルが多い、売れ行きが遅いなど、気をつける点があります");
      L.push("・**" + MARKS.x.mark + " " + MARKS.x.name
        + "** … 元のデータが古い商品です。札は出しません");
    }
    var it = [];
    if (has("sell")) it.push("・**" + ITEM_JA.sell + "**" + planNote("sell", o)
      + " … どれくらい売れているかの目安です"
      + "（Amazon のランキングから出しています）");
    if (has("px")) it.push("・**" + ITEM_JA.px + "**" + planNote("px", o)
      + " … これまでの最安値と平均、いまがそれより高いか安いかです");
    if (has("rival")) it.push("・**" + ITEM_JA.rival + "**"
      + planNote("rival", o)
      + " … 新品の出品者の数と、Amazon 本体が売っているかです。"
      + "本体が売っているときは札を下げています");
    if (has("net")) {
      it.push("・**" + ITEM_JA.net + "**" + planNote("net", o)
        + " … その売り方で売ったときに手元に残る額の**目安**です"
        + "（手数料・発送の送料・梱包材と、こちらにお支払いの送料を"
        + "引いたあと）。**メルカリ・ヤフオクは Amazon の値段から見た"
        + "仮の売値**で出しています（相場は見ていません）");
    }
    /* 8.37（v296）売り方ごとに出すので、説明も売り方に合わせる。
       文は shared/sellway.js の1か所だけ（⚙で売り方を変えると文も変わる）。 */
    if (has("floor")) {
      var SW = sellMod();
      it.push("・**" + ITEM_JA.floor + "**" + planNote("floor", o)
        + " … " + ((SW && typeof SW.pinJa === "function")
          ? SW.pinJa(o)
          : "この値段以上で売れれば赤字になりません（**送料は別**）"));
    }
    if (it.length) {
      L.push("");
      L.push("**カードの項目**");
      L = L.concat(it);
      L.push("・取れていない項目は、その行ごと出しません"
        + "（当てずっぽうの数字は出しません）");
    }
    /* 出品できるかの注意は**必ず**入れる。 */
    L.push("");
    L.push("**出品できるか**");
    L.push("・" + LIMIT_JA);
    L.push("");
    L.push("**ご注文の流れ**");
    L.push("・購入リンクからストアでお買い求めください"
      + "（カードの**残り**は、ほかの会員が買うと減ります）");
    L.push("・**" + dayJa(o.gdCloseDay, "月曜") + "**がそのリストの締めです。"
      + "**" + dayJa(o.gdShipDay, "火曜") + "**から順に発送します");
    L.push("・売り切れたカードは「**完売しました**」に変わります");
    L.push("");
    L.push("**送料**");
    L.push("・送り方（クリックポスト・レターパックプラス・宅急便コンパクト・"
      + "宅配便）は**商品ごと**に変わります。カードの「送料」に出しています");
    L.push("・**金額はお会計で確定します**（まとめて買うと安くなります）");
    L.push("・大きさが分からない商品は「送料はお会計で表示」と出します");
    return L.join("\n");
  }
  /* ---- チャンネルごとの短い文（2〜3行）---- */
  /* plan … { key, name, n, q }（SUBPLAN.list の1つ） */
  function pinPlan(key, opt, plan) {
    var o = opt || {}, p = plan || {};
    var k = s(key);
    var want = itemsOf(k, o);
    var ja = want.map(function (x) {
      return (x === "badge") ? "総合の札" : ITEM_JA[x]; });
    var L = [];
    L.push("**" + (s(p.name) || PLAN_JA[k] || k) + "の商品リスト**");
    var r2 = [];
    if (ja.length) r2.push("カードには **" + ja.join("・") + "** を出します");
    if (num(p.q) > 0) r2.push("**お一人 " + Math.round(num(p.q)) + "点まで**");
    /* 8.43 モニターは「1回◯件まで」ではなく「毎週 新しく◯件」。
       件数と期限は⚙（shared/subplan.js の MON）から plan.mon で渡す。 */
    var mon = (k === "monitor") ? (p.mon || null) : null;
    if (!mon && num(p.n) > 0) r2.push("1回 " + Math.round(num(p.n)) + "件まで");
    if (r2.length) L.push(r2.join("／") + "。");
    if (mon) {
      L.push("**お試しの3週間**：毎週 **新しく "
        + Math.max(1, Math.round(num(mon.n))) + "件**をお知らせします。"
        + "カードは**出してから "
        + Math.max(1, Math.round(num(mon.days))) + "日**で締め切ります"
        + "（過ぎたカードは「**受付終了**」に変わります）。");
    }
    /* 8.34 「出品できるか」はカードから外したので、ここで指しておく
       （行は増やさない。短い文は2〜3行のまま）。 */
    L.push("読み方と**出品できるかの注意**は " + pinRef(o)
      + " をご覧ください。**" + NOTE_JA + "。**");
    return L.join("\n");
  }
  /* Discord の1通（2,000字）に入るように、行の切れ目で分ける。 */
  function pinSplit(text) {
    var lines = s(text).split("\n");
    var out = [], cur = "";
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (cur && (cur.length + 1 + ln.length) > PIN_MAX) { out.push(cur);
        cur = ln; continue; }
      cur = cur ? (cur + "\n" + ln) : ln;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  }
  /* 文が変わったかを見る指紋（貼り直しが要るかの印・FNV-1a）。 */
  function hashOf(text) {
    var t = s(text), h = 0x811c9dc5;
    for (var i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  /* 札の1行（カードの見出しの下・案・確認の画面で同じ形にする）。 */
  function badgeText(b) {
    var x = b || {};
    if (!x.mark) return "";
    return x.mark + " " + x.name + (x.why ? ("｜" + x.why) : "")
      + (x.note ? ("　※" + x.note) : "");
  }
  var API = { D: D, MARKS: MARKS, ITEMS: ITEMS, ITEM_JA: ITEM_JA,
              ITEM_DEF: ITEM_DEF, LIMIT_JA: LIMIT_JA, NOTE_JA: NOTE_JA,
              modeOf: modeOf, itemsOf: itemsOf, ageDays: ageDays,
              sellOf: sellOf, pxOf: pxOf, rivalOf: rivalOf, floorOf: floorOf,
              netOf: netOf,
              badgeOf: badgeOf, cardOf: cardOf, badgeText: badgeText,
              /* 8.30 固定メッセージ（共通＋チャンネルごと）。 */
              PIN_MAX: PIN_MAX, DAYS: DAYS, PLAN_ORDER: PLAN_ORDER,
              PLAN_JA: PLAN_JA, dayJa: dayJa, planFirst: planFirst,
              planNote: planNote, pinRef: pinRef, pinCommon: pinCommon,
              pinPlan: pinPlan, pinSplit: pinSplit, hashOf: hashOf };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_SUBGUIDE = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
