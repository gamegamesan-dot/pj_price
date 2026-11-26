/* MW の商品と Amazon の商品が**同じものか**の見立て — 8.101（カジの依頼）
   画面（index.html の仕入れタブ）と pj-sync（会員向けの配信・「どこで買うか」の
   知らせ・MW 無在庫の仕入れ値）の**両方**で使うので、この1ファイルだけに置く
   （pricing.js・mwfee.js・mwsite.js と同じ決まり）。

   起きたこと（2026-11-25）
     MW の JAN 4573102666987 は「EG ULTRAMAN（ULTRAMAN: RISING）」（定価 1,500円）。
     pj はこの JAN を Amazon の B09VGGZCKM「BANDAI SPIRITS スター・ウォーズ
     マンダロリアン」（売値 5,000円）につなぎ、利益 2,423円・「出品できる」と出していた。
     Amazon 側の JAN の登録が違う商品だと、こういうずれが起きる。

   「商品違いの疑い」にするのは次のどれか（当たった理由をぜんぶ返す）。
     ① name  … 商品名に**共通する言葉がほとんどない**（重なり NAME_MIN＝0.3 未満）
                （メーカー名・「プラモデル」のような一般的な言葉は数えない）
     ② price … Amazon の売値が **MW 定価 × 倍率**（⚙ mwMisX・既定 2.5）を超え、
                **かつ名前の一致が弱い**（重なり PRICE_NAME＝0.5 未満）とき**だけ**。
                名前がよく合う商品は、Amazon が高いだけなので疑わない（8.102）。
                MW 定価が LP_MIN（100円）未満は**定価不明**として値段では見ない
     ③ qty   … **入り数違い**：「10個」「BOX」「セット」「×3」「3本」のような入り数が
                片方の名前にだけある（例：クリスタルコット2 ⇔ クリスタルコット2 10個）
   人が見比べて「同じ商品」と押した JAN（その ASIN のときだけ）は疑いを外す。

   8.102（カジの実データ 4,939件で 117件が疑い・見当違いが多かった）
     値段だけの 101件のうち 90件は名前がよく合う同じ商品、11件は MW 定価が 2〜4円
     （欄の値がおかしい）。名前だけの 15件の多くは英字とカタカナの違い
     （ACE COMBAT 8 ⇔ エースコンバット8・PUZZLE & DRAGONS ⇔ パズル&ドラゴンズ）。
     → ②の条件を足し、④の**読みの骨組み**でも比べるようにした。
     ④ 英字とカタカナは、両方を**子音の並び**（読みの骨組み）に直して3文字ずつ比べ、
        言葉の重なりと**高いほう**を名前の一致にする
        （エースコンバット → s k n b t ／ ACE COMBAT → s k n b t）

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
  var PRICE_NAME = 0.5;       // 値段で疑うのは、名前の一致がこれ未満のときだけ（8.102）
  var LP_MIN = 100;           // MW 定価がこれ未満は「定価不明」（欄の値がおかしい・8.102）
  var SK_MIN = 4;             // 読みの骨組みがこれより短い名前は骨組みで比べない

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
  /* ---- 読みの骨組み（8.102）----
     英字とカタカナ（ひらがな）を、**子音の並び**にそろえる。母音・伸ばし・
     小さい「ッ」は捨て、聞こえ方の近い音は1つにまとめる（l→r・v→b・f→h・
     z/j→s・c→k（e/i/y の前は s）・m→n（b/p の前）など）。漢字は読めないので
     **そのまま**入れる（同じ作品名でも、キャラクター名の漢字が違えば一致が下がる）。 */
  var KANA_C = {};
  (function () {
    var rows = [
      ["", "アイウエオァィゥェォヤユヨャュョヲヮ"], ["k", "カキクケコヵヶ"], ["g", "ガギグゲゴ"],
      ["s", "サシスセソザジズゼゾ"], ["t", "タチツテト"], ["d", "ダヂヅデド"],
      ["n", "ナニヌネノン"], ["h", "ハヒフヘホ"], ["b", "バビブベボヴ"], ["p", "パピプペポ"],
      ["n2", "マミムメモ"], ["r", "ラリルレロ"], ["w", "ワヰヱ"]];
    rows.forEach(function (rw) {
      for (var i = 0; i < rw[1].length; i++) KANA_C[rw[1].charAt(i)] = rw[0] === "n2" ? "m" : rw[0];
    });
    /* ヅ・ヂ は「ず・じ」と同じ音。 */
    KANA_C["ヅ"] = "s"; KANA_C["ヂ"] = "s";
  })();
  function kanaSk(run) {
    var out = "";
    for (var i = 0; i < run.length; i++) {
      var c = run.charAt(i);
      var code = c.charCodeAt(0);
      if (code >= 0x3041 && code <= 0x3096) c = String.fromCharCode(code + 0x60);  // ひら → カタ
      var k = KANA_C[c];
      if (k === undefined || k === "") continue;      // 母音・ー・ッ・記号
      /* ン の次が バ・パ・マ行なら m と同じに（英語の m/n の揺れ）。 */
      out += k;
    }
    return out;
  }
  function latinSk(word) {
    var w = word;
    w = w.replace(/ck/g, "k").replace(/ph/g, "f").replace(/gh/g, "")
         .replace(/sh/g, "s").replace(/ch/g, "t").replace(/th/g, "s")
         .replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/q/g, "k")
         .replace(/x/g, "ks").replace(/f/g, "h").replace(/v/g, "b")
         .replace(/[jz]/g, "s");
    /* 母音のあとの r で、次が母音でないもの（gear・master）は聞こえない。 */
    w = w.replace(/([aeiouy])r(?![aeiouy])/g, "$1");
    w = w.replace(/l/g, "r").replace(/m(?=[bp])/g, "n");
    return w.replace(/[aeiouy]/g, "");
  }
  function skeleton(name) {
    var t = norm0(name).replace(/\d+\s*\/\s*\d+/g, " ");
    for (var i = 0; i < STOP.length; i++) {
      var w = STOP[i];
      if (w.re) { w.re.lastIndex = 0; t = t.replace(w.re, "$1 "); }
      else if (t.indexOf(w.str) >= 0) t = t.split(w.str).join(" ");
    }
    var runs = t.match(/[a-z]+|[0-9]+|[\u3041-\u3096\u30a1-\u30fa\u30fc]+|[\u3400-\u9fff]+/g) || [];
    var sk = runs.map(function (r) {
      if (/^[a-z]+$/.test(r)) return latinSk(r);
      if (/^[0-9]+$/.test(r)) return r;
      if (/^[\u3400-\u9fff]+$/.test(r)) return r;
      return kanaSk(r);
    }).join("");
    /* 同じ子音が続くのは1つに（ッ・二重子音・m/n の重なり）。 */
    sk = sk.replace(/m(?=[bp])/g, "n").replace(/(.)\1+/g, "$1");
    return sk;
  }
  function tri(s0) {
    var o = {};
    for (var i = 0; i + 3 <= s0.length; i++) o[s0.slice(i, i + 3)] = 1;
    return o;
  }
  function skOverlap(a, b) {
    var sa = skeleton(a), sb = skeleton(b);
    if (sa.length < SK_MIN || sb.length < SK_MIN) return null;
    var ta = tri(sa), tb = tri(sb);
    var ka = Object.keys(ta), kb = Object.keys(tb);
    var common = ka.filter(function (k) { return tb[k]; }).length;
    var base = Math.min(ka.length, kb.length);
    return base ? common / base : 0;
  }
  /* 2つの名前の重なり。言葉の重なりと読みの骨組みの重なりの**高いほう**。 */
  function overlap(a, b) {
    var ta = tokens(a), tb = tokens(b);
    var ka = Object.keys(ta), kb = Object.keys(tb);
    var common = ka.filter(function (k) { return tb[k]; });
    var base = Math.min(ka.length, kb.length);
    var w = base ? common.length / base : 0;
    var sk = skOverlap(a, b);
    return { score: Math.max(w, sk || 0), word: w, sk: sk, common: common,
             na: ka.length, nb: kb.length,
             judge: ka.length >= NAME_MIN_TOK && kb.length >= NAME_MIN_TOK };
  }
  /* ---- 入り数（8.102）----
     「10個」「3本」「×3」「BOX」「セット」のような入り数の印。1個・×1 は数えない。
     「全10種」（種類の数）や「1/7」（縮尺）・「Vol.2」は入り数ではない。 */
  function qtyOf(name) {
    var t = norm0(name).replace(/\d+\s*\/\s*\d+/g, " ");
    var out = [];
    var m, re = /(\d+)\s*(個入り|個入|個セット|個|本入り|本セット|本|枚入り|枚セット|枚|袋|箱|冊|点セット|点|pcs|pieces|パック|セット|set)/g;
    var rest = t;
    while ((m = re.exec(t))) {
      rest = rest.split(m[0]).join(" ");                    // 数つきの「セット」は下で二重に数えない
      if (/全\s*$/.test(t.slice(0, m.index))) continue;     // 全10種・全3個 は種類の数
      /* 8.104「100枚入り」「8個入り」は**中身の数**（その商品そのもの）。片方の名前に
         だけ書いてあっても同じ商品なので数えない。「Joy-Con 2本付」「特典 3枚付き」の
         ような**付録の数**も数えない。 */
      if (/入/.test(m[2])) continue;
      if (/^\s*(付|付き|付属)/.test(t.slice(m.index + m[0].length))) continue;
      if (Number(m[1]) >= 2) out.push(m[1] + (m[2].replace(/入り?|セット/g, "") || m[2]));
    }
    re = /(?:×|(?:^|[\s(\[【（])x)\s*(\d+)(?!\d)/g;
    while ((m = re.exec(t))) if (Number(m[1]) >= 2) out.push("×" + m[1]);
    if (/(^|[^a-z])box(?![a-z])|ボックス/.test(t)) out.push("BOX");
    /* 8.104「セット」は**1つの言葉として**書いてあるときだけ（「アイテムセット」
       「スターターセット」のように言葉の一部なら商品名なので数えない）。 */
    if (/(^|[\s(（\[【「『/／・,、:：-])(セット|set)(?=$|[\s)）\]】」』,、:：-])/.test(rest)) out.push("セット");
    return out;
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
     返り … { bad, why:['name','price','qty'], score, common, ratio, x, same,
              lp_bad（定価不明）, qty_mw, qty_amz } */
  function judge(row, opt) {
    var r = row || {}, o = opt || {};
    var x = xOf(o.x);
    var res = { bad: false, why: [], score: null, common: [], ratio: 0, x: x,
                same: false, lp_bad: false, qty_mw: [], qty_amz: [] };
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
    /* MW 定価が 100円未満は欄の値がおかしい（定価不明）。値段では見ない。 */
    if (lp > 0 && lp < LP_MIN) res.lp_bad = true;
    if (lp >= LP_MIN && px > 0) {
      res.ratio = Math.round(px / lp * 100) / 100;
      /* 値段は**名前の一致が弱いときだけ**理由に足す（8.102）。 */
      if (px > lp * x && res.score !== null && res.score < PRICE_NAME)
        res.why.push("price");
    }
    /* 入り数が片方の名前にだけある（8.102）。 */
    res.qty_mw = qtyOf(r.mw_name);
    res.qty_amz = qtyOf(r.amz_name);
    if ((res.qty_mw.length > 0) !== (res.qty_amz.length > 0)) res.why.push("qty");
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
      if (w === "qty") return "入り数違いの疑い（Amazon：" + ((z.qty_amz || []).join("・") || "なし")
        + "／MW：" + ((z.qty_mw || []).join("・") || "なし") + "）";
      return w;
    }).join("／");
  }
  /* 理由の分け方（画面の件数）：名前だけ／名前と値段／入り数。 */
  function kindOf(j) {
    var w = (j && j.why) || [];
    if (w.indexOf("qty") >= 0) return "qty";
    if (w.indexOf("price") >= 0) return "name_price";
    if (w.indexOf("name") >= 0) return "name";
    return "";
  }
  var API = { X_DEF: X_DEF, NAME_MIN: NAME_MIN, NAME_MIN_TOK: NAME_MIN_TOK,
              PRICE_NAME: PRICE_NAME, LP_MIN: LP_MIN,
              tokens: tokens, overlap: overlap, judge: judge, xOf: xOf,
              whyText: whyText, skeleton: skeleton, qtyOf: qtyOf, kindOf: kindOf };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_MWMATCH = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
