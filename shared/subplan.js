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
     n<Key>   … 1回の件数　q<Key> … 1商品あたりの数　ch<Key> … チャンネルID */
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
    var p = plan || {}, r = row || {};
    var g = s(r.grades).split(",").map(function (x) { return x.trim(); })
      .filter(Boolean);
    if (g.length && g.indexOf(p.key) < 0) return false;
    if (r.one_off && p.kinds !== "one") return false;
    if (p.kinds === "game" && !isGame) return false;
    return true;
  }
  var API = { PLANS: PLANS, N_MAX: N_MAX, Q_MAX: Q_MAX,
              plan: plan, list: list, active: active, fits: fits,
              keyUp: keyUp };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_SUBPLAN = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
