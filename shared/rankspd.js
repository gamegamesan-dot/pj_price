/* Amazon のランキングから「売れ行き」を見積もる（8.47・カジの依頼4）
   画面（index.html）と pj-sync（proxy-sync/worker.js）の**両方**で使うので、
   換算表はこの1ファイルだけに置く（pricing.js・mwfee.js・subplan.js と
   同じ決まり）。

   ■ これは**推定**です
     pj は Keepa の月間販売数を持っていません。ここで出すのは
     「順位から見た**おおよその売れ行き**」で、実測ではありません。
     ・**会員のカードには数字を出しません**（§8.2・言葉だけ）
     ・MW の在庫の減りが取れている品は、**そちらを先に使います**
     ・推定で選んだ品には**印**を付けます

   ■ 単位は「3か月で◯個」
     Keepa の既定が3か月なので、⚙も画面も**3か月の個数**で持つ。
     中では 1日あたり（個 ÷ 90日）に直して、速さの比べ方は今までと同じ。

   ■ たたき台（カジの実感：ゲームは3万位で3か月に2〜3個）
       〜1,000位 270／〜5,000位 30／〜10,000位 11／〜30,000位 2.5／
       〜50,000位 1／それより下・順位なしは**推定しない**
     ジャンルの係数 … ゲーム ×1.0／フィギュア ×0.5／その他 ×0.3
     上限 … 3か月で270個（＝1日3個）

   ■ ⚙（帯ごとの個数・係数・上限・使うかどうか）で直せる。 */
(function (root) {
  var DAYS = 90;                       // 「3か月」は90日とみなす
  var BANDS = [
    { rank: 1000, q3: 270, cfg: "rsB1" },
    { rank: 5000, q3: 30, cfg: "rsB2" },
    { rank: 10000, q3: 11, cfg: "rsB3" },
    { rank: 30000, q3: 2.5, cfg: "rsB4" },
    { rank: 50000, q3: 1, cfg: "rsB5" }
  ];
  /* ジャンルの係数（ジャンルは shared/mwfee.js の genreOf と同じ言い方）。 */
  var GENRE = [
    { ja: "ゲーム", k: 1, cfg: "rsGame" },
    { ja: "フィギュア", k: 0.5, cfg: "rsHobby" },
    { ja: "その他", k: 0.3, cfg: "rsOther" }
  ];
  var CAP = 270;                       // 上限（3か月の個数）
  /* 「売れるまで」の言い方（カードに出すのはこの言葉だけ）。 */
  var FAST = 30, SLOW = 10;            // 3か月の個数（⚙ rsFast / rsSlow）
  var JA_FAST = "早い", JA_MID = "ふつう";
  var JA_SLOW = "ゆっくり（数か月かかることがあります）";

  function s(v) { return v === undefined || v === null ? "" : String(v); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function optOf(cfg) {
    var o = cfg || {};
    var n = function (k, d, lo, hi) {
      var v = Number(o[k]);
      if (o[k] === undefined || o[k] === null || o[k] === "" || !isFinite(v)
          || v < lo || v > hi) return d;
      return v;
    };
    var bands = BANDS.map(function (b) {
      return { rank: b.rank, q3: n(b.cfg, b.q3, 0, 100000) };
    });
    var g = {};
    GENRE.forEach(function (x) { g[x.ja] = n(x.cfg, x.k, 0, 10); });
    return {
      on: !(o.rsOn === false || o.rsOn === 0 || o.rsOn === "0"),
      bands: bands, genre: g,
      cap: n("rsCap", CAP, 1, 100000),
      fast: n("rsFast", FAST, 0, 100000),
      slow: n("rsSlow", SLOW, 0, 100000)
    };
  }
  /* 順位 → 3か月の個数（推定）。推定しないときは null。 */
  function q3Of(rank, genre, cfg) {
    var o = (cfg && cfg.bands) ? cfg : optOf(cfg);
    var r = Math.round(num(rank));
    if (!(r > 0)) return null;                 // 順位が無い品は推定しない
    var hit = null;
    for (var i = 0; i < o.bands.length; i++)
      if (r <= o.bands[i].rank) { hit = o.bands[i]; break; }
    if (!hit) return null;                     // 表の外（下）は推定しない
    var k = o.genre[s(genre)];
    if (k === undefined) k = o.genre["その他"];
    var q = num(hit.q3) * num(k);
    if (!(q > 0)) return null;
    return Math.min(q, num(o.cap));
  }
  /* 3か月の個数 ↔ 1日あたり。 */
  function perDay(q3) { return num(q3) / DAYS; }
  function toQ3(perDayV) { return num(perDayV) * DAYS; }
  /* 1件ぶんの売れ行き。
       row … { speed（MW の減り・1日あたり）, speed_ok, rank, rank_avg,
               rank_n, genre }
     返り { q3, day, src:'mw'|'amz'|'', rank, one（順位が1回ぶんだけか）} */
  function estOf(row, cfg) {
    var r = row || {}, o = optOf(cfg);
    var out = { q3: 0, day: 0, src: "", rank: 0, one: false, est: 0 };
    /* 順位は**平均**で見る（1回の値はぶれるため）。 */
    var rank = num(r.rank_avg) > 0 ? num(r.rank_avg) : num(r.rank);
    out.rank = Math.round(rank);
    out.one = !(num(r.rank_n) >= 2);
    var est = o.on ? q3Of(rank, r.genre, o) : null;
    out.est = est === null ? 0 : est;
    /* MW の在庫の減りが取れていれば**そちらが先**。 */
    var ok = (r.speed_ok === undefined) ? (num(r.speed) > 0) : !!r.speed_ok;
    if (ok && num(r.speed) > 0) {
      out.src = "mw";
      out.day = num(r.speed);
      out.q3 = toQ3(out.day);
      return out;
    }
    if (est !== null) {
      out.src = "amz";
      out.q3 = est;
      out.day = perDay(est);
    }
    return out;
  }
  /* 「売れるまで」の言葉（カードに出すのはこれだけ・数字は出さない）。 */
  function jaOf(q3, cfg) {
    var o = optOf(cfg), q = num(q3);
    if (!(q > 0)) return "";
    if (q >= num(o.fast)) return JA_FAST;
    if (q >= num(o.slow)) return JA_MID;
    return JA_SLOW;
  }
  /* 出どころの言い方（画面だけ。会員には出さない）。 */
  function srcJa(src) {
    if (s(src) === "mw") return "MW の減り";
    if (s(src) === "amz") return "Amazon の推定";
    return "—";
  }
  /* MW の減りと推定の**比べ**（参考）。
     MW は**卸での売れ方**で、Amazon の売れ方とは別物なので、
     これは「合っているか」ではなく「どれくらい違うか」の参考です。
     返り { n, ratio（実測 ÷ 推定 の中央値）, both:[…] } */
  function compare(rows, cfg) {
    var o = optOf(cfg);
    var a = [];
    (rows || []).forEach(function (r) {
      var ok = (r.speed_ok === undefined) ? (num(r.speed) > 0) : !!r.speed_ok;
      if (!ok || !(num(r.speed) > 0)) return;
      var rank = num(r.rank_avg) > 0 ? num(r.rank_avg) : num(r.rank);
      var est = q3Of(rank, r.genre, o);
      if (est === null || !(est > 0)) return;
      a.push({ jan: s(r.jan), mw: toQ3(num(r.speed)), est: est,
               ratio: toQ3(num(r.speed)) / est });
    });
    if (!a.length) return { n: 0, ratio: 0, both: [] };
    var v = a.map(function (x) { return x.ratio; })
      .sort(function (x, y) { return x - y; });
    var m = v.length % 2 ? v[(v.length - 1) / 2]
      : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    return { n: a.length, ratio: Math.round(m * 100) / 100, both: a };
  }
  var API = { DAYS: DAYS, BANDS: BANDS, GENRE: GENRE, CAP: CAP,
              FAST: FAST, SLOW: SLOW,
              JA_FAST: JA_FAST, JA_MID: JA_MID, JA_SLOW: JA_SLOW,
              optOf: optOf, q3Of: q3Of, perDay: perDay, toQ3: toQ3,
              estOf: estOf, jaOf: jaOf, srcJa: srcJa, compare: compare };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_RANKSPD = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
