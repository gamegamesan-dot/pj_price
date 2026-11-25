/* 会員向けの**自動配信**の決まり（8.80・カジの依頼）
   画面（index.html）と pj-sync（proxy-sync/worker.js）の**両方**で使うので、
   決まりはこの1ファイルだけに置く（subplan.js・subprice.js と同じ決まり）。

   読み込み方
     ブラウザ … <script src="./shared/subauto.js"></script>
                 読み込むと globalThis.PJ_SUBAUTO に入る
     pj-sync  … import SUBAUTO from "../shared/subauto.js"
     テスト   … require('../shared/subauto.js')

   ここに置くもの
     ・配信の時刻（⚙ subAutoHours・既定 12時と20時）と、夜中の止め
       （0:00〜8:00 は配信しない）
     ・配信前のチェック（1つでも当たった行は配信しない）と、その言い方
     ・1回の配信件数の上限の当て方（プランを順に1件ずつ）
     ・運営への報告の文（プラン別の件数・止めた件数と理由・売り切れ）
   ここに置かないもの
     ・プランの振り分け（shared/subplan.js）・価格（shared/subprice.js）
     ・Discord・Shopify を呼ぶ所（pj-sync）

   守ること
     ・報告は**運営専用のチャンネル**に出す文。会員向けのカードには使わない
     ・@everyone・@here は文に入れない */
(function (root) {
  "use strict";
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function s(v) { return (v === null || v === undefined) ? "" : String(v); }

  /* ---- 配信の時刻 ----
     夜中（0:00〜8:00）は配信しない。⚙に 0〜7時を入れても使わない。 */
  var HOURS_DEF = [12, 20];
  var NIGHT_FROM = 0, NIGHT_TO = 8;        // 0時から 8時の手前まで
  var HOURS_MAX = 6;                       // 1日に配信する回数の上限
  var MAX_DEF = 20;                        // 1回に新しく出す商品の上限の既定
  var MAX_CAP = 200;
  /* 手残りの下限・利益率の下限の既定（画面の⚙ subCutNet・subCutRate の
     欄に入っている既定と同じ数。一度も保存していない D1 で使う）。 */
  var CUT_NET_DEF = 400;
  var CUT_RATE_DEF = 15;
  function isNight(h) {
    var x = Math.round(num(h));
    return x >= NIGHT_FROM && x < NIGHT_TO;
  }
  /* ⚙の文字（「12,20」「12時 20時」など）→ { hours, night, bad }
       hours … 使う時刻（小さい順・重複なし）
       night … 夜中なので外した時刻
       bad   … 読めなかった言葉
     空（未設定）のときは既定の 12時と20時。 */
  function hoursOf(text) {
    var t = s(text).trim();
    if (!t) return { hours: HOURS_DEF.slice(), night: [], bad: [], dflt: true };
    var hours = [], night = [], bad = [];
    t.split(/[,、\s\n／\/・]+/).forEach(function (w) {
      var x = w.replace(/時.*$/, "").replace(/:.*$/, "").trim();
      if (!x) return;
      if (!/^\d{1,2}$/.test(x) || Number(x) > 23) { bad.push(w); return; }
      var h = Number(x);
      if (isNight(h)) { if (night.indexOf(h) < 0) night.push(h); return; }
      if (hours.indexOf(h) < 0) hours.push(h);
    });
    hours.sort(function (a, b) { return a - b; });
    return { hours: hours.slice(0, HOURS_MAX), night: night, bad: bad,
             dflt: false };
  }
  function hoursText(hours) {
    return (hours || []).map(function (h) { return h + "時"; }).join("・");
  }
  /* いまが配信の回か。jst … { hour, dow（0=日）}
     weekend … 土日も配信するか（⚙ subAutoWeekend・既定オン） */
  function dueOf(hours, jst, weekend) {
    var j = jst || {};
    var h = Math.round(num(j.hour));
    if (isNight(h)) return false;
    if (weekend === false && (num(j.dow) === 0 || num(j.dow) === 6))
      return false;
    return (hours || []).indexOf(h) >= 0;
  }
  /* 同じ回を二度走らせないための印（その日＋時）。 */
  function slotOf(day, hour) {
    var h = Math.round(num(hour));
    return s(day) + "@" + (h < 10 ? "0" : "") + h;
  }
  /* 次の配信の時刻（画面に出す）。{ day, hour } か null。 */
  function nextOf(hours, jst, weekend) {
    var hs = (hours || []).slice().sort(function (a, b) { return a - b; });
    if (!hs.length) return null;
    var j = jst || {};
    var h0 = Math.round(num(j.hour)), d0 = Math.round(num(j.dow));
    for (var add = 0; add < 8; add++) {
      var dow = (d0 + add) % 7;
      if (weekend === false && (dow === 0 || dow === 6)) continue;
      for (var i = 0; i < hs.length; i++) {
        if (add === 0 && hs[i] <= h0) continue;
        return { add: add, hour: hs[i], dow: dow };
      }
    }
    return null;
  }
  function maxOf(v) {
    var n = Math.round(num(v));
    if (!(n > 0)) return MAX_DEF;
    return Math.min(MAX_CAP, n);
  }

  /* ---- 商品名が崩れているか ----
       'short' … 極端に短い（掃除したあと NAME_MIN 字に届かない）
       'ascii' … 英数字と記号だけ（日本語が1字も無い。型番だけの名前など）
     '' なら崩れていない。 */
  var NAME_MIN = 6;
  function nameBad(name) {
    var t = s(name).replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[　]/g, " ").replace(/\s+/g, " ").trim();
    if (t.length < NAME_MIN) return "short";
    /* ひらがな・カタカナ・漢字・全角の英数字が1字も無い。 */
    if (!/[぀-ヿ㐀-鿿０-ｚｦ-ﾟ]/.test(t))
      return "ascii";
    return "";
  }

  /* ---- 配信前のチェック ----
     1つでも当たった行は配信しない。**並びは見る順**（先のものが主な理由）。
       code  … 記号（D1 の控えと画面の絞り込みに使う）
       ja    … 運営に出す言い方
       kind  … 'px' 利益・相場／'data' データが足りない／'rule' 決まりで出さない
     ここに無い理由（Amazon 本体あり など）は shared/subplan.js の whyNot。 */
  var WHY = [
    { code: "no_stock", ja: "MW で在庫切れ", kind: "rule" },
    /* 8.101 MW と Amazon が違う商品につながっている疑い（shared/mwmatch.js）。 */
    { code: "mis", ja: "商品違いの疑い", kind: "rule" },
    { code: "no_px", ja: "相場が取れていない", kind: "data" },
    { code: "loss", ja: "利益がマイナス", kind: "px" },
    { code: "low", ja: "目標利益の下限を下回る", kind: "px" },
    { code: "name", ja: "商品名が崩れている", kind: "data" },
    { code: "poster", ja: "ポスター", kind: "rule" },
    { code: "ng_kind", ja: "出さない種類", kind: "rule" },
    { code: "no_dim", ja: "採寸がない", kind: "data" },
    { code: "no_pic", ja: "写真がない", kind: "data" },
    /* 配信のときに付く理由（Shopify に会員用の商品を作れなかった）。 */
    { code: "shop", ja: "Shopify に商品を作れなかった", kind: "data" }
  ];
  var POSTER = ["ポスター"];
  function whyOf(code) {
    for (var i = 0; i < WHY.length; i++)
      if (WHY[i].code === s(code)) return WHY[i];
    return null;
  }
  function whyJa(code) {
    var w = whyOf(code);
    return w ? w.ja : s(code);
  }
  /* 行のチェック。返りは当たった記号の配列（空なら配信してよい）。
     row … { stock, gone, amz_price, fee_total, price（会員価格）,
             fit（会員向きか）, net（手残り・無ければ null）, gross,
             net_unknown, name, ship_sure, pics_ok, ng_kind, mis }
     opt … { needPic（写真が無い品を止めるか・既定オフ）} */
  function gate(row, opt) {
    var r = row || {}, o = opt || {};
    var out = [];
    if (num(r.gone) || !(num(r.stock) > 0)) out.push("no_stock");
    if (r.mis) out.push("mis");
    /* 相場（Amazon の販売価格と手数料）が取れていない行は、利益が出せない。 */
    var px = (num(r.amz_price) > 0) && (num(r.fee_total) > 0)
      && (num(r.price) > 0);
    /* 手残りを出す設定なのに出せなかった行（net_unknown）も、相場が
       足りない行として扱う（0 円と混ぜない）。 */
    if (!px || r.net_unknown) out.push("no_px");
    else {
      /* 利益は**手残り**（⚙の売り方）で見る。手残りを使わない設定のときは
         粗利（Amazon の実売 − 手数料 − 会員価格）で見る。 */
      var v = (r.net !== null && r.net !== undefined) ? num(r.net)
        : ((r.gross !== null && r.gross !== undefined) ? num(r.gross) : null);
      if (v !== null && v < 0) out.push("loss");
      else if (!r.fit) out.push("low");
    }
    if (nameBad(r.name)) out.push("name");
    var nm = s(r.name);
    var poster = false;
    for (var i = 0; i < POSTER.length; i++)
      if (nm.indexOf(POSTER[i]) >= 0) poster = true;
    if (poster) out.push("poster");
    else if (s(r.ng_kind)) out.push("ng_kind");
    if (!r.ship_sure) out.push("no_dim");
    if (o.needPic && !(num(r.pics_ok) > 0)) out.push("no_pic");
    return out;
  }
  /* 理由の文（「採寸がない／写真がない」）。 */
  function whyText(codes, row) {
    return (codes || []).map(function (c) {
      if (c === "ng_kind" && row && s(row.ng_kind))
        return "出さない種類（" + s(row.ng_kind) + "）";
      if (c === "name" && row)
        return whyJa(c) + (nameBad(row.name) === "short" ? "（短すぎる）"
          : "（英数字だけ）");
      return whyJa(c);
    }).join("／");
  }
  /* 理由ごとの件数（1行に理由が2つあれば、どちらにも数える）。 */
  function tally(list) {
    var t = {};
    (list || []).forEach(function (x) {
      ((x && x.why) || []).forEach(function (c) { t[c] = (t[c] || 0) + 1; });
    });
    return t;
  }
  /* 件数の文を WHY の並びで出す。 */
  function tallyLines(t) {
    var out = [];
    WHY.forEach(function (w) {
      if (t && t[w.code] > 0) out.push("・" + w.ja + "：" + t[w.code] + "件");
    });
    Object.keys(t || {}).forEach(function (k) {
      if (!whyOf(k) && t[k] > 0) out.push("・" + k + "：" + t[k] + "件");
    });
    return out;
  }

  /* ---- 1回の配信件数の上限 ----
     plans … [{ key, items:[{ jan, … }] }]（案。プランの並びのまま）
     max   … 1回に新しく出す**商品**の数（同じ商品が複数のプランに出ても1件）
     プランを順に回って**1件ずつ**取る（どのプランも0件にならないように）。
     返り { plans（上限を当てたあと）, jans（選んだ JAN）, cut（外した件数）} */
  function capPick(plans, max) {
    var lim = maxOf(max);
    var list = (plans || []).map(function (p) {
      return { key: p.key, items: (p.items || []).slice(), keep: [] };
    });
    var seen = {}, n = 0, cut = 0;
    var more = true, i = 0;
    while (more) {
      more = false;
      for (var k = 0; k < list.length; k++) {
        var p = list[k];
        if (i >= p.items.length) continue;
        more = true;
        var x = p.items[i], j = s(x.jan);
        if (seen[j]) { p.keep.push(x); continue; }   // もう数えた商品
        if (n >= lim) { cut++; continue; }
        seen[j] = 1; n++;
        p.keep.push(x);
      }
      i++;
    }
    return { plans: list.map(function (p) {
               return { key: p.key, items: p.keep }; }),
             jans: Object.keys(seen), cut: cut, max: lim };
  }
  /* 同じ商品は**いちばん下のプラン**に寄せる（積み上げ型：そこから上の
     プランにも出る）。order … プランの並び（shared/subplan.js の ORDER）。
     返り [{ jan, plan（いちばん下）, item }] */
  function lowest(plans, order) {
    var ord = order || [];
    var by = {}, keys = [];
    (plans || []).forEach(function (p) {
      (p.items || []).forEach(function (x) {
        var j = s(x.jan);
        var was = by[j];
        if (!was) { by[j] = { jan: j, plan: p.key, item: x }; keys.push(j); return; }
        if (ord.indexOf(p.key) >= 0
            && ord.indexOf(p.key) < ord.indexOf(was.plan)) {
          was.plan = p.key; was.item = x;
        }
      });
    });
    return keys.map(function (j) { return by[j]; });
  }
  /* 上乗せの乱数を**その日のあいだは同じ**にする（「試しに作る」と本番で
     同じ値段になるように）。0 以上 1 未満。 */
  function seedRnd(jan, day) {
    var t = s(day) + "|" + s(jan);
    var h = 0x811c9dc5;
    for (var i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    /* 仕上げに混ぜる。JAN は末尾の数字しか違わないことが多く、そのままだと
       どの商品もほぼ同じ数になって、上乗せがそろってしまう。 */
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16; h >>>= 0;
    return h / 4294967296;
  }

  /* ---- 運営への報告 ----
     res … pj-sync の自動配信の結果
       { dry, slot, plans:[{ name, add, edit }], sent, edited,
         stop_n, tally:{code:n}, stops:[{ jan, name, why:[code] }],
         trim（上限を超えて受付終了にした古い品の数）,
         skip:{ 文:n }（振り分けの決まりで対象外にした件数）,
         sold_out, shop:{ made, fail, zero, back }, errors:[文] }
     返り { head:[行], blocks:[[見出し, 行…]] }（notifyBlocks にそのまま渡す）
     止めた行の一覧は LIST_MAX 行まで（残りは件数だけ）。 */
  var LIST_MAX = 30;
  var NAME_LEN = 28;
  function report(res) {
    var r = res || {};
    var head = [(r.dry ? "🧪 **会員向けの自動配信（試し・投稿していません）**"
                       : "📦 **会員向けの自動配信**")
      + (r.slot ? ("　" + s(r.slot).replace("@", " ") + "時の回") : "")];
    var by = (r.plans || []).filter(function (p) {
      return num(p.add) > 0 || num(p.edit) > 0;
    }).map(function (p) {
      return s(p.name) + " " + num(p.add) + "件"
        + (num(p.edit) > 0 ? ("（書き換え " + num(p.edit) + "件）") : "");
    });
    head.push("・配信した件数：**" + num(r.sent) + "件**"
      + (by.length ? ("（" + by.join("／") + "）") : ""));
    head.push("・止めた件数：**" + num(r.stop_n) + "件**");
    head.push("・売り切れにした件数：**" + num(r.sold_out) + "件**");
    /* 出しておく商品の上限を超えたので、古い順に受付終了にした件数。 */
    if (num(r.trim) > 0)
      head.push("・受付終了にした件数（出しておく上限を超えた古い品）：**"
        + num(r.trim) + "件**");
    var sh = r.shop || {};
    if (num(sh.made) || num(sh.fail) || num(sh.zero) || num(sh.back))
      head.push("・Shopify：作った " + num(sh.made) + "件"
        + (num(sh.fail) ? ("／作れなかった " + num(sh.fail) + "件") : "")
        + (num(sh.zero) ? ("／在庫を0にした " + num(sh.zero) + "件") : "")
        + (num(sh.back) ? ("／在庫を戻した " + num(sh.back) + "件") : ""));
    var blocks = [];
    if ((r.errors || []).length)
      blocks.push(["⚠ **呼び出しの失敗**"].concat((r.errors || []).map(
        function (e) { return "・" + s(e).slice(0, 180); })));
    var tl = tallyLines(r.tally || {});
    if (tl.length) blocks.push(["**止めた理由（件数）**"].concat(tl));
    var sk = Object.keys(r.skip || {}).filter(function (k) {
      return num(r.skip[k]) > 0; });
    if (sk.length)
      blocks.push(["**振り分けの決まりで対象外**"].concat(sk.map(
        function (k) { return "・" + k + "：" + num(r.skip[k]) + "件"; })));
    var st = (r.stops || []);
    if (st.length) {
      var lines = st.slice(0, LIST_MAX).map(function (x) {
        return "・" + s(x.name).slice(0, NAME_LEN) + "（" + s(x.jan) + "）… "
          + whyText(x.why, x);
      });
      /* act_n … 手を打てる行の総数（stops は先頭の何件かだけのことがある）。 */
      var total = Math.max(st.length, Math.round(num(r.act_n)));
      if (total > LIST_MAX)
        lines.push("…ほか " + (total - LIST_MAX) + "件"
          + "（pj の「試しに配信内容を作る」で全件を見られます）");
      blocks.push(["**止めた行（利益は足りているのに止めた行）**"]
        .concat(lines));
    }
    return { head: head, blocks: blocks };
  }

  var API = { HOURS_DEF: HOURS_DEF, NIGHT_FROM: NIGHT_FROM, NIGHT_TO: NIGHT_TO,
              HOURS_MAX: HOURS_MAX, MAX_DEF: MAX_DEF, MAX_CAP: MAX_CAP,
              CUT_NET_DEF: CUT_NET_DEF, CUT_RATE_DEF: CUT_RATE_DEF,
              isNight: isNight, hoursOf: hoursOf, hoursText: hoursText,
              dueOf: dueOf, slotOf: slotOf, nextOf: nextOf, maxOf: maxOf,
              NAME_MIN: NAME_MIN, nameBad: nameBad,
              WHY: WHY, POSTER: POSTER, whyOf: whyOf, whyJa: whyJa,
              gate: gate, whyText: whyText, tally: tally,
              tallyLines: tallyLines, capPick: capPick, lowest: lowest,
              seedRnd: seedRnd, report: report,
              LIST_MAX: LIST_MAX, NAME_LEN: NAME_LEN };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_SUBAUTO = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
