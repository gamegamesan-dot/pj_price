/* eBay の英題の決まり — 8.108（カジの依頼・2026-11-27）
   画面（index.html の figTitleFrom／gameTitleFrom＝出品文タブ・出品リスト・
   出品済みの「英題の作り直し」）がこの1ファイルを読む。Node の試験もこれを読む。

   背景：表示 約101万回に対して閲覧 3,722回（クリック率 0.3%）。英題が短い
   （例「Banpresto Hazbin Hotel Alastor Figure」37字）。売れている出品は
   「Radio Demon」「Prize Figure」「Japan」「New」などを足して 70〜80字にしている。

   ここに置くもの
     nounOf(ja, o)   … 商品の種類の語（Figure／Prize Figure／Plush／Acrylic Stand …）。
                       **日本語の商品名・ブランド・商品ラインから分かるときだけ**。
     isPrize(ja, o)  … プライズのフィギュアか（プライズ・Banpresto・プライズの商品ライン）
     tidy(s)         … 宣伝の言葉（Free Shipping・L@@K …）・記号の飾りを落とし、
                       全部大文字の語（BANPRESTO・ONE PIECE）を普通の書き方に直す
     promoHits(s)    … 宣伝の言葉が入っていればその語（試験・画面の注意に使う）
     cutWords(s, n)  … n 字に収まるまで**後ろの語から**落とす（単語の途中で切らない）

   守ること（カジの指示）
     ・商品に関係のない言葉や、ほかのブランド名を入れない
     ・「Free Shipping」「L@@K」などの宣伝の言葉、記号の飾り、全部大文字は入れない
     ・「New」は新品のときだけ。中古には入れない
     ・単語の途中で切らない。80字を超えるときは後ろの情報から削る
     ・日本語の商品名から分からない情報（スケール・型番）を作り出さない
       （ここでは足さない。スケール・型番は pj-title が商品名から読んだものだけ） */
(function (root) {
  "use strict";
  var MAX = 80;            // eBay の題名の上限
  var AIM = 70;            // 目安の下限（足せる本当の情報があるときだけ足す）

  /* 宣伝の言葉（eBay の題名に入れない）。商品名の一部になりうる語（Look Up など）は入れない。 */
  var PROMO = [
    /\bfree\s+ship(ping)?\b/gi, /\bfast\s+ship(ping)?\b/gi, /\bship(s|ping)?\s+free\b/gi,
    /\bquick\s+ship(ping)?\b/gi, /\bl@@k\b/gi, /l@@k/gi, /\bwow+\b/gi, /\bhot\s+item\b/gi,
    /\bmust\s+have\b/gi, /\bno\s+reserve\b/gi, /\bbest\s+price\b/gi, /\bcheap(est)?\b/gi,
    /\bsale\b/gi, /\b\d{1,3}\s*%\s*off\b/gi, /\blook\s*!+/gi, /\brare\s*!+/gi,
    /\bbrand\s+new\s+in\s+box\b/gi
  ];
  /* 全部大文字のまま残す語（略号・ローマ数字・社名の決まった書き方）。 */
  var KEEP_CAPS = { SEGA: 1, SNK: 1, NERV: 1, DXF: 1, SPM: 1, SDX: 1, SHF: 1, HG: 1, MG: 1,
    RG: 1, PG: 1, SD: 1, DX: 1, EX: 1, SP: 1, BB: 1, MS: 1, ZZ: 1, GP: 1, UFO: 1, TV: 1,
    NES: 1, SNES: 1, GBA: 1, GB: 1, DS: 1, PSP: 1, PS: 1, PC: 1, CD: 1, DVD: 1, BD: 1, LED: 1,
    RPG: 1, AKB: 1, NHK: 1, MP: 1, HP: 1, KO: 1, OK: 1, JP: 1, USA: 1, UK: 1, EU: 1, AI: 1,
    II: 1, III: 1, IV: 1, VI: 1, VII: 1, VIII: 1, IX: 1, XI: 1, XII: 1, XIII: 1, XIV: 1,
    XV: 1, XVI: 1, XVII: 1, XVIII: 1, XX: 1, MMD: 1, SEED: 1, GGG: 1 };
  function capWord(w) {
    if (KEEP_CAPS[w] === 1) return w;
    return w.charAt(0) + w.slice(1).toLowerCase();
  }
  /* 宣伝の言葉・記号の飾りを落とし、全部大文字の語を直す。
     ・4文字以上の大文字だけの語は「Banpresto」の形に（SEGA などの決まった書き方は残す）
     ・2〜3文字の大文字の語は、**4文字以上の大文字の語と続いて並んでいるときだけ**直す
       （POP UP PARADE → Pop Up Parade・ONE PIECE → One Piece。単独の HG・DXF はそのまま） */
  function tidy(s) {
    var t = String(s == null ? "" : s);
    for (var i = 0; i < PROMO.length; i++) t = t.replace(PROMO[i], " ");
    t = t.replace(/[★☆♪♡♥◆◇■□●○※＊*~～=|#<>{}【】「」『』〈〉《》]+/g, " ")
         .replace(/!+/g, " ").replace(/\?{2,}/g, " ")
         .replace(/\s*-{2,}\s*/g, " ").replace(/\s+([,.:;])/g, "$1");
    var w = t.split(/\s+/).filter(Boolean);
    /* 大文字の語が続く並び（略号を除く）に4文字以上の語が1つでもあれば、並びごと直す */
    var caps = function (x) { return /^[A-Z]{2,}$/.test(x) && KEEP_CAPS[x] !== 1; };
    for (var k = 0; k < w.length;) {
      if (!caps(w[k])) { k++; continue; }
      var e = k, hasLong = false;
      while (e < w.length && caps(w[e])) { if (w[e].length >= 4) hasLong = true; e++; }
      if (hasLong) for (var j = k; j < e; j++) w[j] = capWord(w[j]);
      k = e;
    }
    return w.join(" ").replace(/\s+/g, " ").trim();
  }
  function promoHits(s) {
    var t = String(s || ""), out = [];
    for (var i = 0; i < PROMO.length; i++) {
      var m = t.match(PROMO[i]);
      if (m) for (var j = 0; j < m.length; j++) if (out.indexOf(m[j]) < 0) out.push(m[j]);
    }
    return out;
  }
  /* n 字に収まるまで後ろの語から落とす（単語の途中で切らない）。 */
  function cutWords(s, n) {
    var w = String(s || "").split(/\s+/).filter(Boolean), lim = n || MAX;
    while (w.length > 1 && w.join(" ").length > lim) w.pop();
    var t = w.join(" ");
    return t.length > lim ? "" : t;
  }

  /* プライズの商品ライン（英語の書き方・日本語の書き方）。 */
  var PRIZE_LINE = /q\s?posket|grandista|glitter\s?&\s?glamou?rs|\bdxf\b|figure\s?colosseum|maximatic|king\s?of\s?artist|vibration\s?stars|espresto|luminasta|super\s?premium\s?figure|\bspm\b|\bpm\s?figure|chokonose|noodle\s?stopper|trio-?try-?it|bicute\s?bunnies|desktop\s?cute|coreful|artist\s?master\s?piece|aqua\s?float\s?girls|relax\s?time|break\s?time|combination\s?battle|banpresto\s?chronicle|ichibansho|プライズ|ちょこのせ|ぬーどるストッパー|ヌードルストッパー|コアフル|デスクトップキュート|ルミナスタ|グランディスタ|グリッター&グラマラス|SPMフィギュア|プレミアムフィギュア/i;
  var KUJI = /ichiban\s?kuji|一番くじ|一番賞/i;
  /* プライズのフィギュアか。一番くじ（Ichiban Kuji）はプライズとは書かない。 */
  function isPrize(ja, o) {
    var x = o || {};
    var all = [ja, x.line, x.itemName, x.series, x.variant].join(" ");
    if (KUJI.test(all)) return false;
    if (/^ichibansho$/i.test(String(x.line || "").trim())) return false;
    if (PRIZE_LINE.test(all) && !/ichibansho/i.test(all)) return true;
    return /^banpresto$/i.test(String(x.brand || "").trim());
  }
  /* 日本語の商品名にある「何の商品か」の語 → 英語の種類の語。上から順に見る。 */
  var NOUNS = [
    [/アクリルスタンド|アクスタ/, "Acrylic Stand"],
    [/アクリルキーホルダー|アクキー|アクリルキーチェーン/, "Acrylic Keychain"],
    [/アクリルブロック/, "Acrylic Block"],
    [/ラバーストラップ/, "Rubber Strap"],
    [/ラバーマスコット/, "Rubber Mascot"],
    [/ラバーキーホルダー|ラバーキーチェーン/, "Rubber Keychain"],
    [/缶バッ[ジチ]/, "Can Badge"],
    [/ぬいぐるみ|ヌイグルミ|ぬいぐるみマスコット/, "Plush"],
    [/タペストリー/, "Tapestry"],
    [/クリアファイル/, "Clear File"],
    [/マグカップ/, "Mug"],
    [/トートバッグ/, "Tote Bag"],
    [/クッション/, "Cushion"],
    [/ブランケット/, "Blanket"],
    [/キーホルダー|キーチェーン/, "Keychain"]
  ];
  /* 種類の語。{ noun, why }。
     ・プラモデル（itemType model_kit）・PROPLICA など（prop_replica）は呼び出し側の決まりのまま（''）
     ・日本語の商品名に種類の語があればそれ（ぬいぐるみ → Plush。AI が figure と答えていても）
     ・フィギュアは Figure。プライズと分かるときだけ Prize Figure
     ・それ以外（other）で分からないときは ''（作り出さない） */
  function nounOf(ja, o) {
    var x = o || {}, t = String(ja || "");
    var ty = String(x.itemType || "figure");
    if (ty === "model_kit" || ty === "prop_replica") return { noun: "", why: "" };
    for (var i = 0; i < NOUNS.length; i++)
      if (NOUNS[i][0].test(t)) return { noun: NOUNS[i][1], why: "商品名" };
    if (ty !== "figure") return { noun: "", why: "" };
    if (isPrize(t, x)) return { noun: "Prize Figure", why: "プライズ" };
    return { noun: "Figure", why: "" };
  }

  var API = { MAX: MAX, AIM: AIM, PRIZE_LINE: PRIZE_LINE, NOUNS: NOUNS,
              tidy: tidy, promoHits: promoHits, cutWords: cutWords,
              isPrize: isPrize, nounOf: nounOf };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_TITLEFIT = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
