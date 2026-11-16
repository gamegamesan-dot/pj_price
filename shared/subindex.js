/* 会員チャンネルの「今週の一覧（目次）」（8.46・カジの依頼）
   画面（index.html）と pj-sync（proxy-sync/worker.js）の**両方**で使うので、
   行の形・並び・カテゴリ・分け方はこの1ファイルだけに置く
   （pricing.js・mwcsv.js・shopcsv.js・subplan.js・subcard.js と同じ決まり）。

   カードが増えるとスクロールが大変なので、各プランのチャンネルに
   **いま買える品の一覧**を出す（固定の1通をピン留めして書き換える）。

   ・1品1行：総合の札・商品名（短く）・仕入れ値・見込みの粗利・残り数・
     そのカードへのリンク（メッセージへのジャンプ）
   ・カテゴリ別（ゲーム／フィギュア／グッズ／その他／1点もの）に見出し
   ・並びは **札の良い順 → 粗利の大きい順**
   ・受付終了・完売・残り0・カードが消えた品は**出さない**
   ・Discord の上限（1通 10 embed・6,000字／embed 4,096字）で分ける

   ■ 会員に見せない項目（§8.2）はここでも出さない
     卸値・社名・MW の在庫・MW の画像・備考・MW/pj の URL・仕入原価・
     上乗せの額。**CSV では配らない**（リストの流出を避ける・カジの方針）。 */
(function (root) {
  var SUBPLAN = null, SUBGUIDE = null, MWFEE = null, SUBCARD = null;
  function mod(name, global) {
    if (root && root[global]) return root[global];
    try { return require("./" + name + ".js"); } catch (e) { return null; }
  }
  function plan_() { return (SUBPLAN = SUBPLAN || mod("subplan", "PJ_SUBPLAN")); }
  function guide_() { return (SUBGUIDE = SUBGUIDE || mod("subguide", "PJ_SUBGUIDE")); }
  function fee_() { return (MWFEE = MWFEE || mod("mwfee", "MWFEE")); }
  function card_() { return (SUBCARD = SUBCARD || mod("subcard", "SUBCARD")); }
  function s(v) { return v === undefined || v === null ? "" : String(v); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function yen(n) { return "¥" + Math.round(num(n)).toLocaleString("ja-JP"); }

  /* Discord の上限（1通ぶん）。ここを変えるときは README の表も直す。 */
  var EMBED_MAX = 4096;          // embed の説明
  var MSG_MAX = 5500;            // 1通の合計（6,000字から余白を取る）
  var EMBED_N = 10;              // 1通の embed の数
  var NAME_MAX = 28;             // 商品名の字数（⚙ gdIdxName）

  /* カテゴリ（見出し）。順は⚙ gdIdxCats で変えられる。
     ジャンルは**機種から**決まる（shared/mwfee.js の genreOf。
     ゲーム／フィギュア／その他 の3つ。グッズは「その他」に入る）。
     1点ものは jan が 'one-…' なので別にする。 */
  var CATS = ["ゲーム", "フィギュア", "その他", "1点もの"];
  var ONE_JA = "1点もの";
  var OTHER_JA = "その他";

  /* 札の良い順（◎→○→△→—）。段③の「良さの帯」もこの順を使う。 */
  function markRank(mark) {
    var G = guide_(), M = (G && G.MARKS) || {};
    var o = [M.a, M.b, M.c, M.x];
    for (var i = 0; i < o.length; i++)
      if (o[i] && s(o[i].mark) === s(mark)) return i;
    return o.length;
  }
  function optOf(cfg) {
    var o = cfg || {};
    var n = Math.round(num(o.gdIdxName));
    var cats = s(o.gdIdxCats).split(/[,、\s]+/).map(function (x) {
      return x.trim(); }).filter(Boolean);
    return {
      name: (n >= 8 && n <= 60) ? n : NAME_MAX,
      cats: cats.length ? cats : CATS.slice(),
      /* 仕入れ値と粗利を一覧に出すか（⚙ gdIdxYen・既定は出す）。 */
      yen: !(o.gdIdxYen === false || o.gdIdxYen === 0 || o.gdIdxYen === "0"),
      guild: s(o.guild).replace(/\D/g, "")
    };
  }
  /* 商品名を短くする（会員に出す名前の作り方は subcard.js の1か所）。 */
  function nameOf(row, opt) {
    var C = card_();
    var t = s((C && C.nameJa) ? C.nameJa(s(row.name)) : s(row.name)).trim();
    var max = (opt || {}).name || NAME_MAX;
    if (t.length > max) t = t.slice(0, max - 1) + "…";
    return t;
  }
  function catOf(row) {
    var r = row || {};
    if (/^one-/.test(s(r.jan))) return ONE_JA;
    /* pj-sync は genre を入れてくれる（入っていなければ機種から出す）。 */
    if (s(r.genre)) return s(r.genre);
    var F = fee_();
    var g = s(F && F.genreOf ? F.genreOf(r) : "");
    return g || OTHER_JA;
  }
  /* カードへのジャンプ（https://discord.com/channels/<サーバー>/<部屋>/<番号>）。 */
  function jump(guild, ch, msg) {
    var g = s(guild).replace(/\D/g, ""), c = s(ch).replace(/\D/g, "");
    var m = s(msg).replace(/\D/g, "");
    if (!g || !c || !m) return "";
    return "https://discord.com/channels/" + g + "/" + c + "/" + m;
  }
  /* 一覧に出す品か。受付終了・完売・残り0・カードが消えた品は出さない。 */
  function liveOf(row) {
    var r = row || {};
    if (s(r.off_at)) return false;
    if (num(r.sold_out) > 0) return false;
    if (!s(r.msg_id)) return false;
    return num(r.left) > 0;
  }
  /* 1品1行。 */
  function lineOf(row, opt, ch) {
    var r = row || {}, o = optOf(opt);
    var L = [];
    if (s(r.mark)) L.push(s(r.mark));
    L.push("**" + nameOf(r, o) + "**");
    var t = [];
    if (o.yen) {
      t.push(yen(r.price));
      if (num(r.gross) > 0) t.push("粗利 " + yen(r.gross));
    }
    t.push("残り" + Math.round(num(r.left)));
    var u = jump(o.guild, ch || r.ch, r.msg_id);
    if (u) t.push("[カード](" + u + ")");
    return L.join(" ") + " … " + t.join("／");
  }
  /* カテゴリごとにまとめて並べる（札の良い順 → 粗利の大きい順）。 */
  function groupsOf(rows, opt) {
    var o = optOf(opt);
    var by = {};
    (rows || []).forEach(function (r) {
      if (!liveOf(r)) return;
      var c = catOf(r);
      (by[c] = by[c] || []).push(r);
    });
    var out = [];
    var order = o.cats.concat(CATS);
    var seen = {};
    order.forEach(function (c) {
      if (seen[c] || !by[c]) return;
      seen[c] = 1;
      out.push({ cat: c, rows: sortRows(by[c]) });
    });
    /* ⚙に無いカテゴリは、そのあとに名前の順で足す（落とさない）。 */
    Object.keys(by).sort().forEach(function (c) {
      if (seen[c]) return;
      seen[c] = 1;
      out.push({ cat: c, rows: sortRows(by[c]) });
    });
    return out;
  }
  function sortRows(a) {
    return (a || []).slice().sort(function (x, y) {
      var rx = markRank(x.mark), ry = markRank(y.mark);
      if (rx !== ry) return rx - ry;
      return num(y.gross) - num(x.gross);
    });
  }
  /* Discord の1通ぶんに分ける。
     返り [{ title, embeds:[{ title, description }], n }] */
  function pagesOf(rows, opt, ch) {
    var o = optOf(opt);
    var gs = groupsOf(rows, o);
    var all = [];                       // embed の候補（カテゴリを分けたぶんも）
    gs.forEach(function (g) {
      var lines = g.rows.map(function (r) { return lineOf(r, o, ch); });
      var part = [], len = 0, parts = [];
      lines.forEach(function (t) {
        if (part.length && len + t.length + 1 > EMBED_MAX) {
          parts.push(part); part = []; len = 0;
        }
        part.push(t); len += t.length + 1;
      });
      if (part.length) parts.push(part);
      parts.forEach(function (p, i) {
        all.push({ cat: g.cat, n: g.rows.length, i: i, of: parts.length,
                   lines: p });
      });
    });
    var pages = [], cur = [], len = 0;
    all.forEach(function (e) {
      var body = e.lines.join("\n");
      var head = e.cat + "（" + e.n + "件"
        + (e.of > 1 ? ("・" + (e.i + 1) + "/" + e.of) : "") + "）";
      var size = body.length + head.length;
      if (cur.length && (cur.length >= EMBED_N || len + size > MSG_MAX)) {
        pages.push(cur); cur = []; len = 0;
      }
      cur.push({ title: head, description: body });
      len += size;
    });
    if (cur.length) pages.push(cur);
    var n = 0;
    gs.forEach(function (g) { n += g.rows.length; });
    return pages.map(function (es, i) {
      return { title: "今週の一覧" + (pages.length > 1
                 ? "（" + (i + 1) + "/" + pages.length + "）" : ""),
               embeds: es, n: n, pages: pages.length };
    });
  }
  /* 空になったページ（前より少なくなった分）は**消さずに**こう書き換える。 */
  function emptyPage(i, of) {
    return { title: "今週の一覧（" + (i + 1) + "/" + of + "）",
             embeds: [{ title: "（このページは空です）",
                        description: "いまはこのページに出す品がありません。"
                          + "上のページをご覧ください。" }] };
  }
  /* 週の短い知らせ（B）。その回に新しく出た品だけ・最大◯行＋一覧へのリンク。 */
  function weekText(rows, opt, ch, idxMsg, max) {
    var o = optOf(opt);
    var n = Math.max(1, Math.round(num(max) || 10));
    var live = (rows || []).filter(function (r) {
      return liveOf(r) && r.is_new; });
    var L = [];
    L.push("**今週の新着 " + live.length + "件**");
    sortRows(live).slice(0, n).forEach(function (r) {
      L.push("・" + lineOf(r, o, ch));
    });
    if (live.length > n) L.push("・ほか " + (live.length - n) + "件");
    var u = jump(o.guild, ch, idxMsg);
    if (u) L.push("ぜんぶの一覧 → " + u);
    return L.join("\n").slice(0, 1900);
  }
  /* 文の指紋（同じなら書き換えない。8.19 と同じやり方）。 */
  function hashOf(v) {
    var t = typeof v === "string" ? v : JSON.stringify(v || {});
    var h = 0x811c9dc5;
    for (var i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  var API = { EMBED_MAX: EMBED_MAX, MSG_MAX: MSG_MAX, EMBED_N: EMBED_N,
              NAME_MAX: NAME_MAX, CATS: CATS, ONE_JA: ONE_JA,
              optOf: optOf, nameOf: nameOf, catOf: catOf, jump: jump,
              liveOf: liveOf, lineOf: lineOf, groupsOf: groupsOf,
              sortRows: sortRows, markRank: markRank, pagesOf: pagesOf,
              emptyPage: emptyPage, weekText: weekText, hashOf: hashOf };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_SUBINDEX = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
