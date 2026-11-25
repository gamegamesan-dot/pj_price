/* MW の商品と Amazon の商品が**同じものか**の見立て — 8.101（カジの依頼）
   画面（index.html の仕入れタブ）と pj-sync（会員向けの配信・「どこで買うか」の
   知らせ・MW 無在庫の仕入れ値）の**両方**で使うので、この1ファイルだけに置く
   （pricing.js・mwfee.js・mwsite.js と同じ決まり）。

   起きたこと（2026-11-25）
     MW の JAN 4573102666987 は「EG ULTRAMAN（ULTRAMAN: RISING）」（定価 1,500円）。
     pj はこの JAN を Amazon の B09VGGZCKM「BANDAI SPIRITS スター・ウォーズ
     マンダロリアン」（売値 5,000円）につなぎ、利益 2,423円・「出品できる」と出していた。
     Amazon 側の JAN の登録が違う商品だと、こういうずれが起きる。

   「商品違いの疑い」にするのは次のどちらか（どちらも当たれば両方の理由を返す）。
     ① name  … 商品名に**共通する言葉がほとんどない**
                （メーカー名・「プラモデル」のような一般的な言葉は数えない）
     ② price … Amazon の売値が **MW 定価 × 倍率**（⚙ mwMisX・既定 2.5）を超える
   人が見比べて「同じ商品」と押した JAN（その ASIN のときだけ）は疑いを外す。

   言葉の数え方
     ・全角半角・大文字小文字をそろえる（NFKC・小文字）
     ・メーカー名と一般的な言葉（STOP）を先に取り除く
     ・英数字は**語**（2文字以上）、カタカナ・ひらがな・漢字は**2文字ずつ**
       （日本語は区切りが無いので「ウルトラマン」→ ウル・ルト・トラ・ラマ・マン）
     ・重なり＝共通の数 ÷ 少ないほうの数。NAME_MIN（0.3）未満なら「ほとんどない」
     ・どちらかの言葉が NAME_MIN_TOK 個より少ないときは判断しない（名前では疑わない） */
(function (root) {
  "use strict";
  var X_DEF = 2.5;            // Amazon の売値が MW 定価のこの倍を超えたら疑う
  var NAME_MIN = 0.3;         // 共通の言葉の割合がこれ未満なら「ほとんどない」
  var NAME_MIN_TOK = 2;       // 言葉がこれより少ない名前では判断しない

  /* メーカー名・ブランド名（作品名ではないもの）。長いものから取り除く。 */
  var MAKERS = [
    "bandai spirits", "バンダイスピリッツ", "バンダイ スピリッツ", "bandai namco",
    "バンダイナムコ", "bandai", "バンダイ", "spirits", "スピリッツ", "namco", "ナムコ",
    "takara tomy", "タカラトミーアーツ", "タカラトミー", "takaratomy", "tomy", "トミー",
    "good smile company", "グッドスマイルカンパニー", "グッドスマイル", "good smile",
    "グッスマ", "max factory", "マックスファクトリー", "kotobukiya", "コトブキヤ",
    "寿屋", "megahouse", "メガハウス", "furyu", "フリュー", "sega", "セガ",
    "taito", "タイトー", "nintendo", "任天堂", "sony", "ソニー", "square enix",
    "スクウェア・エニックス", "スクウェアエニックス", "capcom", "カプコン",
    "konami", "コナミ", "ensky", "エンスカイ", "movic", "ムービック",
    "aniplex", "アニプレックス", "hobby japan", "ホビージャパン", "alter", "アルター",
    "kaiyodo", "海洋堂", "hasegawa", "ハセガワ", "tamiya", "タミヤ",
    "aoshima", "アオシマ", "bushiroad", "ブシロード", "banpresto", "バンプレスト",
    "union creative", "ユニオンクリエイティブ", "plex", "プレックス",
    "medicos", "メディコス", "kadokawa", "カドカワ", "角川", "pmoa", "ピーエムオフィスエー",
    "freeing", "フリーイング", "aquamarine", "アクアマリン", "orange rouge", "オランジュ・ルージュ",
    "sentinel", "千値練", "threezero", "スリーゼロ", "hot toys", "ホットトイズ",
    "mattel", "マテル", "hasbro", "ハズブロ", "lego", "レゴ", "epoch", "エポック",
    "ポケモン センター", "株式会社"
  ];
  /* 一般的な言葉（どの商品にも付く・種類を表すだけのもの）。 */
  var GENERIC = [
    "プラモデル", "プラキット", "プラスチックモデル", "フィギュア", "figure",
    "色分け済み", "色分け済", "塗装済み", "塗装済", "完成品", "ノンスケール",
    "スケール", "組み立て式", "組立式", "組み立て", "組立", "キット", "kit",
    "対象年齢", "才以上", "歳以上", "個入り", "個入", "入り", "パック", "box",
    "ボックス", "セット", "set", "限定", "特典", "付き", "付", "新品", "未開封",
    "国内正規品", "正規品", "日本", "国内", "通常版", "初回版", "初回", "特装版",
    "限定版", "版", "edition", "ver", "version", "vol", "nintendo switch",
    "switch", "スイッチ", "playstation", "プレイステーション", "ps5", "ps4",
    "xbox", "ソフト", "ゲーム", "game", "トレーディング", "トレカ", "カード",
    "アクリルスタンド", "アクリル", "スタンド", "キーホルダー", "缶バッジ",
    "ぬいぐるみ", "マスコット", "ブラインド", "ガシャポン", "食玩", "おもちゃ",
    "玩具", "ホビー", "グッズ", "コレクション", "シリーズ", "series", "全", "種",
    "プライズ", "商品", "公式", "オフィシャル", "official", "the", "and", "of"
  ];
  /* 取り除く言葉は先に作っておく（一覧の数千行で何度も呼ぶため）。
     英語は語の区切りで取る（"alter" で "alternate" を削らない）。 */
  var STOP = MAKERS.concat(GENERIC).map(function (w) { return norm0(w); })
    .filter(function (w) { return !!w; })
    .sort(function (a, b) { return b.length - a.length; })
    .map(function (w) {
      return /^[a-z0-9 ]+$/.test(w)
        ? { re: new RegExp("(^|[^a-z0-9])" + w.replace(/ /g, "\\s+")
            + "(?=$|[^a-z0-9])", "g") }
        : { str: w };
    });

  function s(v) { return (v === null || v === undefined) ? "" : String(v); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function norm0(t) {
    var x = s(t);
    try { x = x.normalize("NFKC"); } catch (e) { /* 古い端末ではそのまま */ }
    return x.toLowerCase();
  }
  /* 名前 → 言葉の集まり（{言葉:1}）。 */
  function tokens(name) {
    var t = norm0(name);
    /* 型番の縮尺（1/144 など）はどの模型にも付くので数えない。 */
    t = t.replace(/\d+\s*\/\s*\d+/g, " ");
    for (var i = 0; i < STOP.length; i++) {
      var w = STOP[i];
      if (w.re) { w.re.lastIndex = 0; t = t.replace(w.re, "$1 "); }
      else if (t.indexOf(w.str) >= 0) t = t.split(w.str).join(" ");
    }
    var out = {};
    /* 英数字・かな・漢字以外は区切り。カタカナの中黒（・）も区切り。 */
    var parts = t.split(/[^0-9a-z぀-ゟ゠-ヿ㐀-鿿ｦ-ﾟ]+/);
    parts.forEach(function (p) {
      if (!p) return;
      /* 文字の種類が変わるところで分ける（英数字／かな／漢字）。 */
      var runs = p.match(/[0-9a-z]+|[぀-ゟ゠-ヿｦ-ﾟ]+|[㐀-鿿]+/g) || [];
      runs.forEach(function (r) {
        if (/^[0-9a-z]+$/.test(r)) {
          if (r.length >= 2 && !/^\d{1,2}$/.test(r)) out[r] = 1;
          return;
        }
        if (r === "ー" || r.length < 2) return;
        for (var k = 0; k + 2 <= r.length; k++) {
          var bg = r.slice(k, k + 2);
          if (bg.indexOf("ー") === 0) continue;   // 「ーズ」のような伸ばし始まりは数えない
          out[bg] = 1;
        }
      });
    });
    return out;
  }
  /* 2つの名前の重なり。 */
  function overlap(a, b) {
    var ta = tokens(a), tb = tokens(b);
    var ka = Object.keys(ta), kb = Object.keys(tb);
    var common = ka.filter(function (k) { return tb[k]; });
    var base = Math.min(ka.length, kb.length);
    return { score: base ? common.length / base : 0, common: common,
             na: ka.length, nb: kb.length,
             judge: ka.length >= NAME_MIN_TOK && kb.length >= NAME_MIN_TOK };
  }
  /* 倍率（⚙ mwMisX）。空・おかしな値は既定。 */
  function xOf(v) {
    var n = Number(v);
    return (v === "" || v === null || v === undefined || !isFinite(n) || n <= 1)
      ? X_DEF : n;
  }
  /* 1行の見立て。
     row … { mw_name, amz_name, list_price, price（Amazon の売値）, asin, same_asin }
     opt … { x（倍率） }
     返り … { bad, why:['name','price'], score, common, ratio, x, same } */
  function judge(row, opt) {
    var r = row || {}, o = opt || {};
    var x = xOf(o.x);
    var res = { bad: false, why: [], score: null, common: [], ratio: 0, x: x,
                same: false };
    var asin = s(r.asin);
    if (!asin) return res;                    // Amazon につながっていない
    if (s(r.same_asin) && s(r.same_asin) === asin) { res.same = true; return res; }
    var ov = overlap(r.mw_name, r.amz_name);
    if (ov.judge) {
      res.score = Math.round(ov.score * 100) / 100;
      res.common = ov.common.slice(0, 8);
      if (ov.score < NAME_MIN) res.why.push("name");
    }
    var lp = num(r.list_price), px = num(r.price);
    if (lp > 0 && px > 0) {
      res.ratio = Math.round(px / lp * 100) / 100;
      if (px > lp * x) res.why.push("price");
    }
    res.bad = res.why.length > 0;
    return res;
  }
  /* 理由の文（「名前に共通の言葉がほとんどない／定価の 3.3倍」）。 */
  function whyText(j) {
    var z = j || {};
    return (z.why || []).map(function (w) {
      if (w === "name") return "商品名に共通する言葉がほとんどありません";
      if (w === "price") return "Amazon の売値が MW 定価の " + z.ratio + "倍（"
        + z.x + "倍を超えています）";
      return w;
    }).join("／");
  }
  var API = { X_DEF: X_DEF, NAME_MIN: NAME_MIN, NAME_MIN_TOK: NAME_MIN_TOK,
              tokens: tokens, overlap: overlap, judge: judge, xOf: xOf,
              whyText: whyText };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_MWMATCH = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
