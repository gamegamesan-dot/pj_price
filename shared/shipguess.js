/* 採寸が無い品の「送り方と重さの目安」（8.49・カジの依頼）
   画面（index.html）と pj-sync（proxy-sync/worker.js）の**両方**で使うので、
   種類の表はこの1ファイルだけに置く（shopcsv.js・rankspd.js と同じ決まり）。

   ■ なぜ
     Amazon に採寸が無い品は送り方が決められず、会員に出せていなかった
     （グッズはほとんどが採寸なし）。**商品名の言葉**から種類を見分けて、
     **送り方と重さの既定**を当てる。

   ■ 決まり
     ・当てた値は「**目安**」。はっきり決まったことにはしない（sure は付かない）
     ・**迷う種類は大きめの区分**に寄せる（送料が足りないほうが痛いため）
     ・**重さは必ず入れる**（Shopify は重さの段で送料を決める）
     ・「**分からない**」に当てた品は**案に印**を出す（カジが見てから出す）
     ・⚙「**出さない種類（言葉）**」に当たった品は**案にも配信にも入れない**
       （既定：ポスター。レターパックでは送れないため・カジの判断）

   ■ カジの直し（2026-11-16）
     ・ポスターは扱わない → 出さない種類に入れる
     ・タペストリーは B2 など大きいものがあり、丸めても 50cm を超えるので
       クリックポスト（長さ34cmまで）では送れない → 既定は宅配便（80サイズ）。
       「スリム」「ミニ」が入るものだけクリックポスト（200g） */
(function (root) {
  function s(v) { return v === undefined || v === null ? "" : String(v); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function shipMod() {
    if (root && root.PJ_SHOPCSV) return root.PJ_SHOPCSV;
    try { return require("./shopcsv.js"); } catch (e) { return null; }
  }
  /* 送り方の名前（shared/shopcsv.js の表から引く）。 */
  function wayJa(key) {
    var M = shipMod();
    try { return s(M.wayOf(key).name); } catch (e) { return ""; }
  }
  /* 種類の表（たたき台・⚙で足せる）。
       ja    … 種類の名前（画面に出す）
       words … 商品名に入っていたらその種類と見る言葉
       way   … 送り方（shared/shopcsv.js の key）
       g     … 重さの既定（g）
     **上から順に見て、最初に当たった種類**にする（細かいものを先に置く）。 */
  /* 8.51（カジの直し5）**大物 → BOX・セット・個入り → 小物**の順に見る。
     「缶バッジ 5個セット」のようなまとめ買いは、小物の50gでは足りないので
     BOX の既定（宅急便コンパクト 400g）に寄せる。
     「ねんどろいど BOX」のような大物は、先にフィギュアで当たる。 */
  var KINDS = [
    /* ---- 大物（先に見る） ---- */
    { ja: "フィギュア", way: "box60", g: 900,
      words: ["フィギュア", "スケール", "ねんどろいど", "プライズ",
              "figma", "ＦＩＧＵＲＥ"] },
    { ja: "ぬいぐるみ", way: "compact", g: 400,
      words: ["ぬいぐるみ", "マスコット", "プラッシュ"] },
    /* カジの直し：タペストリーは大きいものがあるので宅配便（80）。
       「スリム」「ミニ」だけクリックポスト（下の slim で見る）。 */
    { ja: "タペストリー", way: "box80", g: 700,
      words: ["タペストリー", "タペ"],
      slim: { words: ["スリム", "ミニ"], way: "cp", g: 200 } },
    /* ---- まとめ買い（小物より先に見る・カジの直し5） ---- */
    { ja: "BOX・セット", way: "compact", g: 400,
      words: ["BOX", "ＢＯＸ", "ボックス", "セット", "コンプリート",
              "全種", "アソート", "個入り", "個入", "個セット", "個パック",
              "まとめ"] },
    /* ---- 小物 ---- */
    { ja: "缶バッジ", way: "cp", g: 50,
      words: ["缶バッジ", "缶バッヂ", "缶バッチ", "カンバッジ", "カンバッヂ",
              "カンバッチ"] },
    { ja: "アクリルスタンド", way: "cp", g: 120,
      words: ["アクリルスタンド", "アクスタ", "アクリルキーホルダー",
              "アクキー", "アクリルチャーム"] },
    { ja: "クリアファイル", way: "cp", g: 60,
      words: ["クリアファイル", "クリアーファイル"] },
    { ja: "キーホルダー", way: "cp", g: 60,
      words: ["キーホルダー", "ラバーストラップ", "ラバスト", "ストラップ",
              "缶ミラー"] },
    { ja: "色紙・ブロマイド", way: "cp", g: 80,
      words: ["色紙", "ブロマイド", "トレーディングカード", "トレカ",
              "ポストカード"] }
  ];
  /* 分からない品の既定（**大きめ**に寄せる・⚙で変えられる）。 */
  var UNKNOWN = { ja: "分からない", way: "box60", g: 800 };
  /* ⚙「出さない種類（言葉）」の既定。 */
  var NG = ["ポスター"];

  function words(v) {
    return s(v).split(/[,、\n\r、　 ]+/).map(function (x) {
      return x.trim(); }).filter(Boolean);
  }
  /* ⚙の表（1行 `言葉=送り方,重さ`）。送り方は key でも名前でも受ける。 */
  function rows(v) {
    var out = [];
    s(v).split(/[\n\r]+/).forEach(function (line) {
      var t = line.trim();
      if (!t || t.charAt(0) === "#") return;
      var i = t.indexOf("=");
      if (i < 0) return;
      var w = t.slice(0, i).trim();
      var a = t.slice(i + 1).split(",");
      if (!w || !a.length) return;
      var M = shipMod(), key = "";
      try { key = s(M.wayOf(a[0].trim()).key); } catch (e) { key = ""; }
      if (!key) return;
      out.push({ ja: w, words: [w], way: key, g: Math.round(num(a[1])) });
    });
    return out;
  }
  function optOf(cfg) {
    var o = cfg || {};
    var ng = words(o.sgNg === undefined ? NG.join(",") : o.sgNg);
    var add = rows(o.sgTable);
    var M = shipMod(), uw = "";
    try { uw = s(M.wayOf(s(o.sgUnknownWay) || UNKNOWN.way).key); }
    catch (e) { uw = UNKNOWN.way; }
    return {
      ng: ng,
      /* ⚙で足した行を**先に**見る（上書きできるように）。 */
      kinds: add.concat(KINDS),
      unknown: { ja: UNKNOWN.ja, way: uw || UNKNOWN.way,
                 g: Math.round(num(o.sgUnknownG) || UNKNOWN.g) },
      on: !(o.sgOn === false || o.sgOn === 0 || o.sgOn === "0")
    };
  }
  /* 名前に当たった「出さない種類」の言葉（無ければ ''）。 */
  function ngOf(name, cfg) {
    var o = (cfg && cfg.ng) ? cfg : optOf(cfg);
    var t = s(name);
    for (var i = 0; i < o.ng.length; i++)
      if (o.ng[i] && t.indexOf(o.ng[i]) >= 0) return o.ng[i];
    return "";
  }
  /* 名前から種類を見分ける（当たらなければ null）。 */
  function kindOf(name, cfg) {
    var o = (cfg && cfg.kinds) ? cfg : optOf(cfg);
    var t = s(name);
    for (var i = 0; i < o.kinds.length; i++) {
      var k = o.kinds[i];
      for (var j = 0; j < (k.words || []).length; j++) {
        var w = k.words[j];
        if (!w || t.indexOf(w) < 0) continue;
        /* タペストリーの「スリム」「ミニ」だけ別の既定にする。 */
        if (k.slim) {
          for (var m = 0; m < k.slim.words.length; m++)
            if (t.indexOf(k.slim.words[m]) >= 0)
              return { ja: k.ja + "（" + k.slim.words[m] + "）",
                       way: k.slim.way, g: k.slim.g, hit: w,
                       slim: k.slim.words[m] };
        }
        return { ja: k.ja, way: k.way, g: k.g, hit: w };
      }
    }
    return null;
  }
  /* 1件ぶんの目安。
       row … { name, ... }（採寸があるかは呼ぶ側が見る）
     返り { kind, way, way_ja, g, unknown, hit, ng } */
  function guessOf(row, cfg) {
    var o = optOf(cfg), r = row || {};
    var ng = ngOf(r.name, o);
    if (ng) return { kind: "", way: "", way_ja: "", g: 0, unknown: false,
                     hit: "", ng: ng };
    var k = o.on ? kindOf(r.name, o) : null;
    if (k) return { kind: k.ja, way: k.way, way_ja: wayJa(k.way), g: k.g,
                    unknown: false, hit: k.hit, ng: "" };
    return { kind: o.unknown.ja, way: o.unknown.way,
             way_ja: wayJa(o.unknown.way), g: o.unknown.g,
             unknown: true, hit: "", ng: "" };
  }
  /* 採寸が取れていない理由（内訳に使う）。
       'none'  … まだ Amazon を調べていない
       'part'  … 3辺のうち1〜2辺だけある
       'g'     … 重さだけある
       'all'   … 採寸が丸ごと無い
       ''      … 採寸がある（内訳に入れない） */
  function dimWhy(row) {
    var r = row || {};
    var n = [r.size_long, r.size_wid, r.size_hei].map(num)
      .filter(function (x) { return x > 0; }).length;
    if (n >= 3) return "";
    if (!s(r.asin) && !s(r.checked_at) && !s(r.amz_at)) return "none";
    /* 8.51（カジの直し2）**長辺だけ**の行は、migrate-0060（短辺・厚さ）より
       前に取った行か、Amazon が1辺しか返していない行。取り直せば埋まるので
       「2辺ある」と分けて数える。 */
    if (n === 1) return "long";
    if (n === 2) return "part";
    if (num(r.size_g) > 0) return "g";
    return "all";
  }
  var WHY_JA = { none: "まだ Amazon を調べていない",
                 long: "長辺だけある（取り直しで埋まります）",
                 part: "2辺だけある",
                 g: "重さだけある", all: "採寸が丸ごと無い",
                 /* 8.52（カジの確認）採寸はそろっているのに送り方が
                    決まらない行。**理由の合計が件数と合うように**数える。 */
                 nodec: "採寸はあるが送り方が決まらない" };
  /* 内訳に出す順（ここに無い理由も、あとに足して必ず数に入れる）。 */
  var WHY_ORDER = ["none", "long", "part", "g", "all", "nodec"];
  /* 一覧ぶんの内訳（画面のまとめに出す）。 */
  function sumOf(list, cfg) {
    var o = optOf(cfg);
    var out = { n: 0, why: { none: 0, long: 0, part: 0, g: 0, all: 0,
                             nodec: 0 },
                kinds: {}, ways: {}, unknown: 0, ng: 0, ngWords: {} };
    (list || []).forEach(function (r) {
      var ng = ngOf(r.name, o);
      if (ng) {
        out.ng++;
        out.ngWords[ng] = (out.ngWords[ng] || 0) + 1;
        return;
      }
      var w = dimWhy(r);
      if (!w) return;                    // 採寸がある品は数えない
      out.n++;
      out.why[w] = (out.why[w] || 0) + 1;
      var g = guessOf(r, o);
      out.kinds[g.kind] = (out.kinds[g.kind] || 0) + 1;
      var ja = g.way_ja || g.way;
      out.ways[ja] = (out.ways[ja] || 0) + 1;
      if (g.unknown) out.unknown++;
    });
    return out;
  }
  /* 画面の「案の行」は、もう決め終わった値を持っている
     （ng_kind・dim_why・guess_kind・guess_way・guess_g・guess_unknown）。
     その行から内訳を作る（元のデータを持っていないので数え直さない）。 */
  function sumPicked(rows) {
    var out = { n: 0, why: { none: 0, long: 0, part: 0, g: 0, all: 0,
                             nodec: 0 },
                kinds: {}, ways: {}, unknown: 0, ng: 0, ngWords: {} };
    (rows || []).forEach(function (r) {
      var ng = s(r.ng_kind);
      if (ng) {
        out.ng++;
        out.ngWords[ng] = (out.ngWords[ng] || 0) + 1;
        return;
      }
      var w = s(r.dim_why);
      if (!w) return;                    // 採寸がある品は数えない
      out.n++;
      out.why[w] = (out.why[w] || 0) + 1;
      var k = s(r.guess_kind);
      if (k) out.kinds[k] = (out.kinds[k] || 0) + 1;
      var ja = s(r.guess_way);
      if (ja) out.ways[ja] = (out.ways[ja] || 0) + 1;
      if (r.guess_unknown) out.unknown++;
    });
    return out;
  }
  var API = { KINDS: KINDS, UNKNOWN: UNKNOWN, NG: NG, WHY_JA: WHY_JA,
              WHY_ORDER: WHY_ORDER,
              sumPicked: sumPicked,
              optOf: optOf, words: words, rows: rows, wayJa: wayJa,
              ngOf: ngOf, kindOf: kindOf, guessOf: guessOf,
              dimWhy: dimWhy, sumOf: sumOf };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_SHIPGUESS = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
