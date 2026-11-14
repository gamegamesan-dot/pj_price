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
  /* カードに出せる項目（⚙でプランごとに選ぶときの名前）。 */
  var ITEMS = ["badge", "sell", "px", "rival", "floor", "limit"];
  var ITEM_JA = { badge: "総合", sell: "売れ行き", px: "値動き",
                  rival: "ライバル", floor: "赤字にならない売値",
                  limit: "出品できるか" };
  /* プランごとの既定（モニターは短く、プレミアムはぜんぶ）。 */
  var ITEM_DEF = {
    monitor: "badge,sell",
    light: "badge,sell,rival",
    standard: "badge,sell,px,rival,floor",
    premium: "badge,sell,px,rival,floor,limit",
    one_pre: "badge,rival,floor,limit",
    one_open: "badge,rival,floor,limit"
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
  /* ---- 5 赤字にならない売値 ----
     会員が買う値段（会員価格）＋ Amazon の手数料を引いても残る売値。
       売値 P のときの手数料 ≒ P × 率 ＋ 固定（FBA）
       P − 手数料 = 会員価格  →  P = (会員価格 + 固定) / (1 − 率)
     率と固定は、**その行で取れている手数料**（Amazon が返した実額）から出す。
     送料（会員のところへ届ける送料）は**別**なので、そう書く。 */
  function floorOf(r, opt) {
    var x = r || {};
    var cost = Math.round(num(x.price));          // 会員が買う値段（税込）
    var p0 = Math.round(num(x.amz_price));        // いまの Amazon の売値
    var fee = Math.round(num(x.fee_total));       // その売値のときの手数料
    if (!(cost > 0 && p0 > 0 && fee > 0)) return { ok: false, text: "" };
    /* 率と固定に分ける。率は「売値に比例するぶん」（販売手数料＋その消費税）、
       固定は残り（FBA の配送代行・在庫管理）。
       率が取れないときは、ぜんぶ比例とみなす（安全側に高めに出る）。 */
    var rate = num(x.fee_rate);
    var fix = 0;
    if (rate > 0 && rate < 1) {
      fix = Math.max(0, fee - p0 * rate);
    } else {
      /* 率が分からない行は、**手数料は安くならない**とみなす
         （そのぶん売値は高めに出る＝安全側）。 */
      rate = 0; fix = fee;
    }
    if (!(rate >= 0 && rate < 0.9)) return { ok: false, text: "" };
    var p = (cost + fix) / (1 - rate);
    if (!isFinite(p) || p <= 0) return { ok: false, text: "" };
    p = Math.ceil(p / 10) * 10;
    return { ok: true, yen: p,
             text: yen(p) + " 以上で売れれば赤字になりません"
               + "（Amazon の手数料を引いたあと・**送料は別**）" };
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
    add("limit", LIMIT_JA);
    return out;
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
              badgeOf: badgeOf, cardOf: cardOf, badgeText: badgeText };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_SUBGUIDE = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
