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
     n<Key>   … 1回の件数　q<Key> … 1商品あたりの数　ch<Key> … チャンネルID
     ship<Key>… カードの「送料」の文（8.17）。空なら重さから出した文を使う
                （モニターは「4本以上 送料無料」など、プランごとに変えられる） */
(function (root) {
  "use strict";
  /* 8.45（段②・カジの依頼）n は **1回に「新しく出す」件数**。
     すでに出してあるカードは数に入れない（値段と残り数の書き換えだけ）。
     たたき台：モニター5／ライト5／スタンダード8／プレミアム10。 */
  var PLANS = [
    { key: "monitor",  name: "モニター",     kinds: "game", n: 5, q: 1,
      /* 8.21（【1】）normal … **通常版だけ**のプラン（限定版・特装版などを外す）。
         8.45 モニターは⚙でクリックポストで送れる品まで広げられる。 */
      normal: true,
      on: true,  note: "通常版のゲーム（⚙でクリックポストの品まで）"
        + "・1回に新しく5件・1商品1点まで" },
    { key: "light",    name: "ライト",       kinds: "game", n: 5, q: 2,
      on: false, note: "ゲームソフト全件（いまは止めています）" },
    { key: "standard", name: "スタンダード", kinds: "all",  n: 8, q: 5,
      on: false, note: "全部（いまは止めています）" },
    { key: "premium",  name: "プレミアム",   kinds: "one",  n: 10, q: 5,
      on: false, note: "全部＋1点もの（先行）（いまは止めています）" }
  ];
  /* ===== 8.21（【1】）通常版かどうか =====
     モニターは「ゲームソフト通常版のみ」なのに、限定版・初回生産の商品が
     案に入っていた（2026-11-14・カジの報告）。
     **言葉の表はここ1か所だけ**。⚙「通常版でない言葉」（subNormalNg）で
     足せる（読点・カンマ・改行・空白で区切る）。

     見分け方
       ① 下の言葉が商品名にあれば「通常版ではない」
       ② 無くて「通常版」と書いてあれば通常版
       ③ 無くて「版」が入っているだけなら **通常版か要確認**（印を出す）
          … 「薔薇と椿 〜お豪華絢爛版〜」のように作品名に「版」が入るものは
            通常版なので、外さずに印だけ出す
     見るのは**掃除したあとの名前**（6.194 の titleOf）。
     【特典】…の中の「限定版特典」「同梱」で外さないため。 */
  var NORMAL_NG = [
    "限定版", "特装版", "初回限定", "初回生産", "完全生産限定", "数量限定",
    "豪華版", "コレクターズ", "コレクター", "同梱", "セット", "BOX",
    "ＢＯＸ", "ボックス", "DXパック", "DX パック", "デラックスエディション",
    "プレミアムエディション", "アニバーサリーエディション", "特別版",
    "ツインパック", "ダブルパック", "トリプルパック"
  ];
  var N_MAX = 200;                 // 1回に送れる件数の上限の上限
  var Q_MAX = 99;                  // 1商品あたりの数の上限
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function s(v) { return (v === null || v === undefined) ? "" : String(v); }
  function keyUp(k) { return s(k).charAt(0).toUpperCase() + s(k).slice(1); }
  /* 商品名の掃除（6.194）は shared/shopcsv.js の1か所だけ。
     読めないときは元の名前で見る（判定が消えないように）。 */
  function shopMod() {
    var g = (typeof globalThis !== "undefined") ? globalThis : root;
    if (g && g.PJ_SHOPCSV) return g.PJ_SHOPCSV;
    if (typeof require === "function") {
      try { return require("./shopcsv.js"); } catch (e) { return null; }
    }
    return null;
  }
  function cleanName(v) {
    var S = shopMod();
    var t = (S && typeof S.titleOf === "function") ? S.titleOf(v, 200) : s(v);
    return t || s(v);
  }
  /* ⚙ で足した言葉を入れた表。 */
  function ngWords(cfg) {
    var add = s((cfg || {}).subNormalNg).split(/[,、\s\n]+/)
      .map(function (x) { return x.trim(); }).filter(Boolean);
    var out = NORMAL_NG.slice();
    for (var i = 0; i < add.length; i++)
      if (out.indexOf(add[i]) < 0) out.push(add[i]);
    return out;
  }
  /* 通常版か。{ ok, hit, maybe } を返す。
     ok=false … 通常版ではない（hit がその言葉）
     maybe=true … 通常版か要確認（名前に「版」が入っているだけ） */
  function normalOf(name, words) {
    var t = cleanName(name);
    var up = t.toUpperCase();
    var list = (words && words.length) ? words : NORMAL_NG;
    for (var i = 0; i < list.length; i++) {
      var w = s(list[i]).trim();
      if (!w) continue;
      if (up.indexOf(w.toUpperCase()) >= 0)
        return { ok: false, hit: w, maybe: false };
    }
    if (t.indexOf("通常版") >= 0) return { ok: true, hit: "", maybe: false };
    return { ok: true, hit: "", maybe: t.indexOf("版") >= 0 };
  }
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
               /* 8.17 カードの「送料」の文（プランごと・空なら既定）。 */
               ship: s(o["subShip" + U]).trim().slice(0, 300),
               /* 8.21（【1】）通常版だけのプランと、⚙で足した言葉。 */
               normal: !!p.normal, ng: ngWords(o),
               ch: s(o["subCh" + U]).replace(/\D/g, "") };
    });
  }
  /* いま配信するプラン（動かす印があり、チャンネルIDが入っているもの）。 */
  function active(cfg) {
    return list(cfg).filter(function (p) { return p.on && p.ch; });
  }
  /* ===== 8.35（カジの依頼）プランは「積み上げ型」=====
     いままでは mw_sub.grades に1つのプランだけを入れていたので、
     ライトに振り分けた商品はモニターにもプレミアムにも出なかった
     （「ほかのプランに振り分けてあります」）。そのため
     ・ライトにはゲームソフトが1件しか残らない
     ・プレミアムでもモニターの商品が見られない
     ということになっていた。

     これからは**下のプランに出す商品は、上のプランにも出す**。
       モニター  < ライト < スタンダード < プレミアム
     ・ライト      … モニターの商品＋ゲームソフト全部（限定版も）
     ・スタンダード … ゲームソフト全部＋ほかの商品
     ・プレミアム  … 全部＋1点ものの先行

     やり方は「**grades にそのプランから上を全部入れる**」だけ
     （fitWhy は今までどおり「自分のキーが grades にあるか」を見る）。
     1人あたりの購入数・1回の件数は**プランごと**のまま（上限は積み上げない）。 */
  var ORDER = ["monitor", "light", "standard", "premium"];
  function rankOf(key) { return ORDER.indexOf(s(key).trim()); }
  /* そのプランから**上を全部**（例 light → light,standard,premium）。 */
  function upFrom(key) {
    var i = rankOf(key);
    return (i < 0) ? [] : ORDER.slice(i);
  }
  /* 画面の「出すプラン」で選んだ値 → grades の文字。
       'monitor'      … モニターから上（monitor,light,standard,premium）
       'only:monitor' … モニターだけ（monitor）
       'all' / ''     … ぜんぶのプラン（grades は空＝どのプランにも出す）
     ここ1か所だけに置く（画面・pj-sync・テストが同じものを読む）。 */
  function gradesOf(choice) {
    var v = s(choice).trim();
    if (!v || v === "all") return "";
    var m = /^only:(.+)$/.exec(v);
    if (m) return (rankOf(m[1]) >= 0) ? m[1].trim() : "";
    return upFrom(v).join(",");
  }
  /* grades（文字）→ **いちばん下のプラン**（画面に「◯◯から上」と出す用）。 */
  function lowestOf(grades) {
    var g = s(grades).split(",").map(function (x) { return x.trim(); })
      .filter(Boolean);
    for (var i = 0; i < ORDER.length; i++)
      if (g.indexOf(ORDER[i]) >= 0) return ORDER[i];
    return "";
  }
  /* その grades が「積み上げ型」になっているか
     （いちばん下のプランから上が全部入っているか）。
     空（ぜんぶのプラン）は積み上げ型として扱う。 */
  function stacked(grades) {
    var g = s(grades).split(",").map(function (x) { return x.trim(); })
      .filter(Boolean);
    if (!g.length) return true;
    var lo = lowestOf(g);
    if (!lo) return true;                 // 知らないプランだけ（触らない）
    var want = upFrom(lo);
    for (var i = 0; i < want.length; i++)
      if (g.indexOf(want[i]) < 0) return false;
    return true;
  }
  /* 画面の「出すプラン」の選択肢（並びと言い方もここ1か所）。 */
  function picks(cfg) {
    var l = list(cfg || {});
    var nameOf = function (k) {
      var h = l.filter(function (p) { return p.key === k; })[0];
      return h ? h.name : k;
    };
    var out = [];
    ORDER.forEach(function (k) {
      var up = upFrom(k);
      out.push({ v: k, label: nameOf(k)
        + ((up.length > 1) ? ("から上（" + up.map(nameOf).join("・") + "）")
                           : "だけ") });
    });
    ORDER.slice(0, ORDER.length - 1).forEach(function (k) {
      out.push({ v: "only:" + k, label: nameOf(k) + "だけ" });
    });
    out.push({ v: "all", label: "ぜんぶのプラン" });
    return out;
  }
  /* その商品をこのプランに出すか。
     ・grades（mw_sub.grades）が入っていれば、その中にプランがあること
     ・kinds が 'game' のプランは**ゲームソフトだけ**
     ・1点もの（one_off）は 'one' のプランだけ */
  function fits(plan, row, isGame) {
    return !fitWhy(plan, row, isGame);
  }
  /* 8.20（【6】）**出さない理由**。'' なら出す。
     プランごとの予定が0件のときに「なぜ0件か」を出すのに使う
     （画面も pj-sync も同じこの文を使う）。 */
  /* 8.35 理由の文に出すプランの名前（表から引く。無ければキーのまま）。 */
  function nameJaOf(plan, key) {
    var l = PLANS.filter(function (p) { return p.key === key; })[0];
    return l ? l.name : key;
  }
  function fitWhy(plan, row, isGame) {
    var p = plan || {}, r = row || {};
    var g = s(r.grades).split(",").map(function (x) { return x.trim(); })
      .filter(Boolean);
    if (g.length && g.indexOf(p.key) < 0) {
      /* 8.35 積み上げ型：下のプランに出す商品は上にも出る。
         ここに来るのは「このプランより上から出す」か「◯◯だけ」の行。 */
      var lo = lowestOf(g);
      if (lo && rankOf(lo) > rankOf(p.key))
        return s(nameJaOf(p, lo)) + "から上に出す商品です";
      return "このプランには出さない商品です（" + g.join("・") + "）";
    }
    if (r.one_off && p.kinds !== "one")
      return "1点ものはこのプランに出しません";
    if (p.kinds === "game" && !isGame)
      return "ゲームソフトだけのプランです";
    /* 8.21（【1】）通常版だけのプラン（モニター）。 */
    if (p.normal) {
      var nm = normalOf(r.name, p.ng);
      if (!nm.ok) return "通常版ではありません（" + nm.hit + "）";
    }
    return "";
  }
  /* そのプランが0件になる理由（まとめて1行にする）。
     rows … 配信できる商品（「読み込みました」の印が付いた行）
     isGameOf … 行がゲームソフトかを返す関数（手数料の区分は mwfee.js） */
  function whyNone(plan, rows, isGameOf) {
    var p = plan || {};
    if (!p.on) return "⚙で「配信する」が入っていません";
    if (!p.ch) return "⚙にチャンネルID が入っていません";
    var list = rows || [];
    if (!list.length)
      return "配信できる商品がありません"
        + "（「会員に出す」の印と「Shopify に読み込みました」の印が要ります）";
    var tally = {}, keys = [];
    for (var i = 0; i < list.length; i++) {
      var w = fitWhy(p, list[i],
        (typeof isGameOf === "function") ? !!isGameOf(list[i]) : false);
      if (!w) continue;
      if (tally[w] === undefined) keys.push(w);
      tally[w] = (tally[w] || 0) + 1;
    }
    if (!keys.length) return "";
    return keys.map(function (k) { return k + " " + tally[k] + "件"; })
      .join("／");
  }
  /* ===== 8.22（【2】）1点もの（秋葉原などで仕入れた商品）=====
     MW の無在庫とは別に、カジが手で登録した1点ものを配信する。
     ・#目玉商品-先行（プレミアム）に**先に**出す
     ・⚙の時間（既定 24時間）のあと #目玉商品（スタンダード以上）に出す
     チャンネルID は ⚙（subChPre／subChHot）。表はここ1か所だけ。 */
  var ONE_PLANS = [
    { key: "one_pre", name: "目玉商品-先行（プレミアム）",
      cfgCh: "subChPre", grade: "premium", pre: true,
      note: "プレミアムだけに先に出す" },
    { key: "one_open", name: "目玉商品（スタンダード以上）",
      cfgCh: "subChHot", grade: "standard", pre: false,
      note: "先行から⚙の時間がたった商品を出す" }
  ];
  var ONE_PRE_HOURS = 24;          // ⚙ subPreHours … 先行だけに出す時間
  var ONE_OPEN_GRADES = "standard,premium";   // ⚙ subOneOpenGrades
  function oneHours(cfg) {
    var v = num((cfg || {}).subPreHours);
    return (v > 0 && v <= 24 * 30) ? v : ONE_PRE_HOURS;
  }
  /* Shopify のタグに入れるグレード。
     先行のあいだは premium だけ、あいたら ⚙ の分（既定 standard・premium）。 */
  function oneGrades(cfg, open) {
    if (!open) return "premium";
    var v = s((cfg || {}).subOneOpenGrades).trim();
    return v || ONE_OPEN_GRADES;
  }
  function oneList(cfg) {
    var o = cfg || {};
    return ONE_PLANS.map(function (p) {
      var ch = s(o[p.cfgCh]).replace(/\D/g, "");
      return { key: p.key, name: p.name, note: p.note, grade: p.grade,
               pre: p.pre, ch: ch, on: !!ch, hours: oneHours(o),
               one: true };
    });
  }
  /* その1点ものをこのプランに出すか。'' なら出す。
     row … { off, loaded_at, qty, sold, pre_at }
     now … いまの時刻（ISO。テストで固定できるように渡す） */
  function oneWhy(plan, row, now) {
    var p = plan || {}, r = row || {};
    if (num(r.off)) return "取り下げています";
    if (!s(r.loaded_at).trim())
      return "Shopify に読み込みました の印がありません";
    if (p.pre) return "";
    /* #目玉商品（スタンダード以上）は、先行から⚙の時間がたってから。 */
    if (!s(r.pre_at).trim()) return "まだ先行に出していません";
    var t0 = Date.parse(s(r.pre_at)), t1 = Date.parse(s(now) || "");
    if (!isFinite(t0)) return "先行に出した時刻が読めません";
    if (!isFinite(t1)) t1 = Date.now();
    var h = (t1 - t0) / 3600000;
    if (h < num(p.hours))
      return "先行のあと " + Math.ceil(num(p.hours) - h) + "時間待ちです";
    return "";
  }
  function oneFits(plan, row, now) { return !oneWhy(plan, row, now); }
  /* そのプランが0件になる理由（8.20 と同じ出し方）。 */
  function oneWhyNone(plan, rows, now) {
    var p = plan || {};
    if (!p.ch) return "⚙にチャンネルID が入っていません";
    var list = rows || [];
    if (!list.length)
      return "1点ものがありません（仕入れタブの「1点ものを登録する」で"
        + "登録し、Shopify 用 CSV を読み込んでから「読み込みました」を"
        + "押してください）";
    var tally = {}, keys = [];
    for (var i = 0; i < list.length; i++) {
      var w = oneWhy(p, list[i], now);
      if (!w) continue;
      if (tally[w] === undefined) keys.push(w);
      tally[w] = (tally[w] || 0) + 1;
    }
    if (!keys.length) return "";
    return keys.map(function (k) { return k + " " + tally[k] + "件"; })
      .join("／");
  }

  /* ===== 8.18 今日の配信の案（振り分けの決まり）=====
     仕入れタブの候補（刈取の一覧）を、プランごとに自動で振り分ける。
     決まりはここ1か所だけ（画面・pj-sync が同じこれを読む）。

     共通の条件
       ・会員向きの判定（粗利の下限、または利益率の下限と最低額）を満たす
         … 判定は shared/subprice.js の fitOf（6.188）
       ・出品できる（Amazon の出品制限が ok）
       ・Amazon 本体ありは除く（⚙ subPickNoAmz・既定オン）
       ・カジが「仕入れる」の印を付けた商品は外す（⚙ subPickSkipBuy・既定オン）
       ・在庫処分・再入荷なしの商品を**優先**（並びの点数を上げる）
     並び順
       会員の粗利 × 売れる速さ の大きい順（売れる速さが出せない行は
       1日 0.3点とみなす＝出さないほどではないが後ろに回る）
     販売数の上限のおすすめ
       MW 在庫から「MW 自身がこれから売る分」（売れる速さ × ⚙日数）を引き、
       その ⚙% と、会員の想定購入数の小さいほう */
  var PICK = {
    noAmz: true,        // ⚙ subPickNoAmz   … Amazon 本体ありを除く
    skipBuy: true,      // ⚙ subPickSkipBuy … 「仕入れる」印を外す
    stockPct: 30,       // ⚙ subStockPct    … MW 在庫の何%まで出すか
    wantQty: 5,         // ⚙ subWantQty     … 会員の想定購入数（1商品あたり）
    qtyDays: 2,         // ⚙ subQtyDays     … MW 自身がこれから売る日数
    saleBoost: 1.5      // 在庫処分・再入荷なしの点数の倍率（優先）
  };
  /* ===== 8.43（カジの依頼1）モニターは「3週間・週1回・毎回新しい5件」=====
     モニターは**お試し**の枠なので、ほかのプランとは選び方を分ける。
       ・1回に**新しく**出すのは monNew 件（前から出している品は数えない）
       ・購入期限は monLimitDays 日。次の回で前の週のカードを
         「受付終了」に**書き換える**（消さない＝履歴に残る）
       ・候補は**通常版のゲーム**で、**速く売れる品**だけ
         速さの下限 ＝ ⚙（monSpeedMin）／空なら **人数 ÷ 日数**
         （5人・2日なら 1日 2.5点以上＝全員ぶんが1〜2日で売れる速さ）
       ・**前の週までにモニターへ出した品は選ばない**
       ・**1週目は速い順**（いちばん速く売れる品を先に届ける）、
         2週目からは候補から**ランダム**
       ・ランダムは「週＋JAN」から決まる数なので、**押し直しても同じ5件**
       ・候補が足りない週は、**下限を一段下げて埋める**（⚙ monShort・
         既定 50%）。下げて入れた品には印（low）を付ける。
         それでも足りなければ**そのまま少なく出す** */
  var MON = {
    monNew: 5,          // ⚙ subMonNew       … 1回に新しく出す件数
    monPeople: 10,      // ⚙ subMonPeople    … モニターの人数（お一人1点）
    monLimitDays: 7,    // ⚙ subMonLimitDays … 購入期限（日）
    /* 8.45（カジの決めたこと2）速さの下限は**⚙の固定値**（人数÷日数は
       使わない）。既定 0.5点/日。値崩れは「お一人1点」と
       「出せる数（MW在庫の⚙%・想定購入数）」で抑える。 */
    monSpeedMin: 0.5,   // ⚙ subMonSpeedMin  … 速さの下限（点/日）
    monShort: 50,       // ⚙ subMonShort     … 足りないとき下限を下げる%
    monFrom: "",        // ⚙ subMonFrom      … モニターの開始日（空なら今まで）
    /* 8.45（カジの決めたこと1）通常版のゲームだけでなく、
       **クリックポストで送れる品**まで候補に入れる。 */
    monWide: true       // ⚙ subMonWide
  };
  function bool(v, dflt) {
    if (v === undefined || v === null || v === "") return dflt;
    return !!(v === true || v === 1 || v === "1" || v === "true");
  }
  function pickOpt(cfg) {
    var o = cfg || {};
    var n = function (k, d, lo, hi) {
      var v = Number(o[k]);
      if (!isFinite(v) || v < lo || v > hi) return d;
      return v;
    };
    return {
      noAmz: bool(o.subPickNoAmz, PICK.noAmz),
      skipBuy: bool(o.subPickSkipBuy, PICK.skipBuy),
      stockPct: n("subStockPct", PICK.stockPct, 0, 100),
      wantQty: Math.round(n("subWantQty", PICK.wantQty, 0, 999)),
      qtyDays: n("subQtyDays", PICK.qtyDays, 0, 60),
      saleBoost: PICK.saleBoost,
      /* 8.43 モニターの決まり（⚙）。 */
      monNew: Math.round(n("subMonNew", MON.monNew, 1, 50)),
      monPeople: Math.round(n("subMonPeople", MON.monPeople, 1, 999)),
      monLimitDays: Math.round(n("subMonLimitDays", MON.monLimitDays, 1, 90)),
      monSpeedMin: n("subMonSpeedMin", MON.monSpeedMin, 0, 999),
      monWide: bool(o.subMonWide, MON.monWide),
      monShort: n("subMonShort", MON.monShort, 0, 90),
      /* 8.44（カジの確認3）モニターの開始日（'YYYY-MM-DD'）。
         入れた日より前に出したカードは「前の週に出した品」に数えず、
         週の数え直しもこの日から始める（空なら今までどおり）。 */
      monFrom: monDay(o.subMonFrom)
    };
  }
  /* 8.45 モニターの速さの下限は **⚙の固定値**（空なら既定 0.5点/日）。
     8.43 では「人数 ÷ 日数」だったが、カジの実データでは 2.5点/日 に
     届く品がほとんど無かったので、固定値を主にした（カジの決めたこと2）。 */
  function monSpeed(opt, lowered) {
    var o = opt || pickOpt(null);
    var v = num(o.monSpeedMin);
    if (!(v > 0)) v = MON.monSpeedMin;
    if (lowered) v = v * (1 - Math.max(0, Math.min(90, num(o.monShort))) / 100);
    return Math.max(0, v);
  }
  /* 8.44 開始日の読み方（'YYYY-MM-DD' だけ。それ以外は空）。 */
  function monDay(v) {
    var t = s(v).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "";
  }
  /* 8.44 開始日の 0時（JST）を時刻にする。読めなければ null。 */
  function monFromMs(from) {
    var d = monDay(from);
    if (!d) return null;
    var t = Date.parse(d + "T00:00:00+09:00");
    return isFinite(t) ? t : null;
  }
  /* 8.43 「週」。JST の日曜はじまりで数える（押し直しても同じ数になる）。
     8.44 開始日（⚙）があれば、**その日から数えた週**（0・1・2…）。 */
  function monWeek(now, from) {
    var t = (now === undefined || now === null) ? Date.now()
      : (typeof now === "number" ? now : Date.parse(String(now)));
    if (!isFinite(t)) t = Date.now();
    var t0 = monFromMs(from);
    if (t0 !== null) return Math.max(0, Math.floor((t - t0) / 604800000));
    return Math.floor((t + 9 * 3600000) / 604800000);
  }
  /* 8.43 「週＋JAN」から決まる数（0〜1）。同じ週なら何度押しても同じ。 */
  function monRand(week, jan) {
    var t = String(week) + "|" + String(jan);
    var h = 0x811c9dc5;
    for (var i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h / 4294967296;
  }
  /* 8.43 モニターに出す品を選ぶ。
       rows … 案の候補（subDraftRows と同じ形）
       sent … **前の週までにモニターへ出した JAN**（配列）
     返り { items, low, short, min, week, first, n }
       low   … 下限を下げて埋めた件数
       short … それでも足りなかった件数
       first … 1週目（モニターに1枚も出していない）か */
  function monPick(rows, plan, opt, sent, now) {
    var o = opt || pickOpt(null), p = plan || plan_("monitor");
    var was = {};
    (sent || []).forEach(function (j) { was[String(j)] = 1; });
    var week = monWeek(now, o.monFrom);
    /* 8.44 開始日があれば「開始日から1週間」が1週目
       （それより前のテスト配信は数えない）。 */
    var first = o.monFrom ? (week === 0) : !(sent || []).length;
    var want = Math.max(1, Math.round(num(o.monNew)));
    var min = monSpeed(o, false), min2 = monSpeed(o, true);
    var ok = [], low = [];
    (rows || []).forEach(function (r) {
      if (was[String(r.jan)]) return;                 // 前の週までに出した
      if (whyNot(r, o)) return;                       // 共通の条件
      if (monKind(r, p, o)) {                         // 8.45 種類（⚙で広げる）
        if (!(num(r.qty) > 0)) return;                // 出せる数が無い
        var sp = num(r.speed);
        if (sp >= min) ok.push(r);
        else if (sp >= min2) low.push(r);
      }
    });
    /* 1週目は速い順。2週目からは「週＋JAN」で決まる順（ランダム）。 */
    var sortBy = function (a) {
      a.sort(function (x, y) {
        if (first) return num(y.speed) - num(x.speed);
        return monRand(week, x.jan) - monRand(week, y.jan);
      });
      return a;
    };
    sortBy(ok); sortBy(low);
    var out = ok.slice(0, want).map(function (r) {
      return Object.assign({}, r, { score: scoreOf(r, o), plan: p.key,
        maybe: !!normalOf(r.name, p.ng).maybe, slow: !(num(r.speed) > 0),
        mon_low: false });
    });
    var lowN = 0;
    if (out.length < want) {
      low.slice(0, want - out.length).forEach(function (r) {
        lowN++;
        out.push(Object.assign({}, r, { score: scoreOf(r, o), plan: p.key,
          maybe: !!normalOf(r.name, p.ng).maybe, slow: !(num(r.speed) > 0),
          mon_low: true }));
      });
    }
    return { items: out, low: lowN, short: Math.max(0, want - out.length),
             min: min, min2: min2, week: week, first: first, n: want,
             okN: ok.length, lowN: low.length };
  }
  /* 8.43（カジの依頼）線引きを決めるための**分布**。
     粗利・売れる速さ・粗利×速さ の 下位25%／中央／上位25% を返す。 */
  function quart(a) {
    var v = (a || []).filter(function (x) { return isFinite(x); })
      .sort(function (x, y) { return x - y; });
    if (!v.length) return { n: 0, q1: 0, med: 0, q3: 0 };
    var at = function (q) {
      var i = Math.min(v.length - 1, Math.max(0,
        Math.round((v.length - 1) * q)));
      return v[i];
    };
    return { n: v.length, q1: at(0.25), med: at(0.5), q3: at(0.75) };
  }
  function statsOf(rows, opt) {
    var o = opt || pickOpt(null);
    var g = [], sp = [], gs = [];
    (rows || []).forEach(function (r) {
      if (whyNot(r, o)) return;
      var gross = num(r.gross), speed = num(r.speed);
      g.push(gross); sp.push(speed); gs.push(gross * speed);
    });
    var mon = monPick(rows, plan_("monitor"), o, [], null);
    return { gross: quart(g), speed: quart(sp), gxs: quart(gs),
             n: g.length, monOk: mon.okN, monLow: mon.lowN,
             monMin: mon.min, monMin2: mon.min2 };
  }
  /* ===== 8.44（カジの確認1・2）売れる速さの内訳 =====
     カジの報告（2026-11-16）「売れる速さ 0／0／0 点/日」。
     **データが取れていない行を 0点と同じに数えていた**ので、分けて出す。
       speed_ok … 速さの元データ（MW の在庫の減り）が取れた行か
                   （shared/mwstat.js の speedSrc が付いた行）
     帯は 0.1未満／0.1〜0.5／0.5〜1／1〜2.5／2.5以上（カジの確認2）。 */
  var SPEED_BANDS = [0.1, 0.5, 1, 2.5];
  function speedBand(sp) {
    for (var i = 0; i < SPEED_BANDS.length; i++)
      if (num(sp) < SPEED_BANDS[i]) return i;
    return SPEED_BANDS.length;
  }
  /* 8.45（カジの確認4・5）速さが出せない行は2つに分ける。
       new    … 記録が1日ぶんも無い（はじめて見た品・取り込み1回目）
       nodown … 記録はあるが**まだ減っていない**（売れていない）
     MW の減りは「前の数がある記録」からしか出ないので、
     取り込み2回目から減りが付き、**減っていない品は何日たっても
     速さが出ない**（8.44 の「データなし」はこの2つが混ざっていた）。 */
  function speedMix(rows, opt) {
    var o = opt || pickOpt(null);
    var out = { n: 0, none: 0, zero: 0, pos: 0, bands: [] };
    for (var i = 0; i <= SPEED_BANDS.length; i++) out.bands.push(0);
    (rows || []).forEach(function (r) {
      if (whyNot(r, o)) return;
      out.n++;
      var sp = num(r.speed);
      /* speed_ok を付けていない古い行は、速さ>0 なら取れていたと見る。 */
      var ok = (r.speed_ok === undefined) ? (sp > 0) : !!r.speed_ok;
      if (ok && sp > 0) { out.pos++; out.bands[speedBand(sp)]++; return; }
      /* speed_why が無い行は、分けられないので「記録が足りない」に数える。 */
      if (s(r.speed_why) === "nodown") out.zero++;
      else out.none++;
    });
    return out;
  }
  /* ===== 8.44（カジの相談4）下限・対象を変えたときの件数 =====
     min  … 速さの下限（点/日）
     wide … true なら「通常版ゲーム」だけでなく
            **クリックポストで送れる品**まで広げる（送り方は shopcsv の1か所）
     ※ 数えるだけ（いまの配信の決まりは変えない）。 */
  function shipMod() {
    if (typeof PJ_SHOPCSV !== "undefined" && PJ_SHOPCSV) return PJ_SHOPCSV;
    if (root && root.PJ_SHOPCSV) return root.PJ_SHOPCSV;
    try { return require("./shopcsv.js"); } catch (e) { return null; }
  }
  function cpJa() {
    var M = shipMod();
    try { return s(M.wayOf("cp").name) || "クリックポスト"; }
    catch (e) { return "クリックポスト"; }
  }
  /* 8.45（カジの決めたこと1）モニターに出せる種類か。
     ・通常版のゲーム（8.21）
     ・⚙ monWide なら **クリックポストで送れる品**も
       （ゲームソフトは広げても通常版だけ・送り方は shopcsv の1か所） */
  /* isGame・ship は、行に入っていないとき（pj-sync）に外から渡す。 */
  function monKind(row, plan, opt, wide, isGame, ship) {
    var r = row || {}, p = plan || plan_("monitor"), o = opt || pickOpt(null);
    var w = (wide === undefined || wide === null) ? !!o.monWide : !!wide;
    var g = (isGame === undefined || isGame === null) ? !!r.is_game : !!isGame;
    var sh = (ship === undefined || ship === null) ? s(r.ship) : s(ship);
    if (fits(p, r, g)) return true;
    if (!w || sh !== cpJa()) return false;
    /* 広げるのは**種類の決まりだけ**（「ゲームソフトだけのプラン」）。
       グレード（積み上げ型）と1点ものの決まりはそのまま見る。
       「通常版だけ」はゲームソフトのときだけ見る
       （フィギュアの「◯◯セット」を限定版と間違えないため）。 */
    var p2 = { key: p.key, name: p.name, kinds: "all", ng: p.ng,
               normal: g ? !!p.normal : false };
    return fits(p2, r, g);
  }
  function monCount(rows, opt, min, wide) {
    var o = opt || pickOpt(null), p = plan_("monitor");
    var n = 0;
    (rows || []).forEach(function (r) {
      if (whyNot(r, o)) return;
      if (!(num(r.qty) > 0)) return;
      if (!monKind(r, p, o, wide)) return;
      if (num(r.speed) < num(min)) return;
      n++;
    });
    return n;
  }
  /* 試算の表（いまの下限＋1.0／0.5／0.3 点/日 × 通常版ゲーム／広げた場合）。 */
  var MON_TRY = [1, 0.5, 0.3, 0.1];
  function monTable(rows, opt) {
    var o = opt || pickOpt(null);
    var mins = [monSpeed(o, false)];
    for (var i = 0; i < MON_TRY.length; i++)
      if (mins.indexOf(MON_TRY[i]) < 0) mins.push(MON_TRY[i]);
    return mins.map(function (m, i) {
      return { min: Math.round(num(m) * 100) / 100, now: i === 0,
               game: monCount(rows, o, m, false),
               wide: monCount(rows, o, m, true) };
    });
  }
  /* 販売数の上限のおすすめ（8.18 の2）。0 なら案に出さない。
     row … { stock, speed }（speed は shared/mwstat.js の「1日あたり」） */
  function qtyOf(row, plan, opt) {
    var r = row || {}, p = plan || {}, o = opt || pickOpt(null);
    var stock = Math.max(0, num(r.stock));
    if (!stock) return 0;
    var speed = Math.max(0, num(r.speed));
    /* MW 自身がこれから売る分を引く（売れる速さ × 日数）。 */
    var left = Math.max(0, stock - speed * num(o.qtyDays));
    var n = Math.floor(left * num(o.stockPct) / 100);
    var q = Math.min(n, Math.max(0, Math.round(num(o.wantQty))));
    /* 1点も出せないときは 0（案に出さない）。 */
    return Math.max(0, Math.round(q));
  }
  /* 並びの点数（大きいほど先）。会員の粗利 × 売れる速さ。 */
  var SPEED_MIN = 0.3;             // 売れる速さが出せない行の見なし
  function scoreOf(row, opt) {
    var r = row || {}, o = opt || pickOpt(null);
    var g = Math.max(0, num(r.gross));
    var sp = num(r.speed);
    if (!(sp > 0)) sp = SPEED_MIN;
    var sc = g * sp;
    /* 在庫処分・再入荷なしは優先（刈り切る候補）。 */
    if (r.no_back) sc *= num(o.saleBoost) || 1;
    return sc;
  }
  /* 共通の条件。通らない理由を返す（通れば ''）。 */
  function whyNot(row, opt) {
    var r = row || {}, o = opt || pickOpt(null);
    if (!r.fit) return "会員向きではありません";
    if (s(r.rst) === "blocked") return "出品できません";
    if (o.noAmz && r.amz) return "Amazon 本体あり";
    if (o.skipBuy && num(r.buy_qty) > 0) return "仕入れる印が付いています";
    if (!(num(r.price) > 0)) return "販売価格が出せません";
    return "";
  }
  /* プランごとの案（件数の上限まで）。
     rows は画面・pj-sync が作った行の配列（下の項目を入れておく）
       jan, name, kishu, stock, speed, gross, price, qty（上限のおすすめ）,
       fit（会員向きか）, rst, amz, buy_qty, no_back, one_off, grades */
  function draft(rows, plans, cfg, monSent, now) {
    var o = pickOpt(cfg);
    var out = [];
    (plans || []).forEach(function (p) {
      /* 8.43 モニターだけは「新しく◯件・速く売れる品・前の週は選ばない」。 */
      if (p.key === "monitor") {
        var mp = monPick(rows, p, o, monSent || [], now);
        out.push({ key: p.key, name: p.name, n: mp.n, on: p.on, ch: p.ch,
                   items: mp.items,
                   over: Math.max(0, (mp.okN + mp.lowN) - mp.items.length),
                   skip: 0, mon: mp });
        return;
      }
      var pick = [], skip = [];
      (rows || []).forEach(function (r) {
        var why = whyNot(r, o);
        if (!why && !fits(p, r, !!r.is_game)) why = (p.kinds === "game")
          ? "ゲームソフト通常版ではありません" : "このプラン向きではありません";
        if (!why && !(num(r.qty) > 0)) why = "出せる数がありません";
        if (why) { skip.push({ jan: r.jan, why: why }); return; }
        /* 8.21（【1】）案に出す印
             maybe … 通常版か要確認（名前に「版」が入っているだけ）
             slow  … 売れる速さが 1日 0点（後ろに回す） */
        var nm = normalOf(r.name, p.ng);
        pick.push(Object.assign({}, r, { score: scoreOf(r, o), plan: p.key,
                                         maybe: !!nm.maybe,
                                         slow: !(num(r.speed) > 0) }));
      });
      /* 速さ 0点の行は**いちばん後ろ**に回す（点数より先に見る）。 */
      pick.sort(function (a, b) {
        if (!!a.slow !== !!b.slow) return a.slow ? 1 : -1;
        return b.score - a.score;
      });
      out.push({ key: p.key, name: p.name, n: p.n, on: p.on, ch: p.ch,
                 items: pick.slice(0, p.n), over: Math.max(0, pick.length - p.n),
                 skip: skip.length });
    });
    return { plans: out, opt: o };
  }
  function plan_(k) { return plan(k); }
  var API = { PLANS: PLANS, N_MAX: N_MAX, Q_MAX: Q_MAX, MON: MON,
              monSpeed: monSpeed, monWeek: monWeek, monRand: monRand,
              monPick: monPick, statsOf: statsOf, quart: quart,
              monDay: monDay, monFromMs: monFromMs,
              SPEED_BANDS: SPEED_BANDS, speedBand: speedBand, monKind: monKind,
              speedMix: speedMix, monCount: monCount,
              MON_TRY: MON_TRY, monTable: monTable, cpJa: cpJa,
              plan: plan, list: list, active: active, fits: fits,
    fitWhy: fitWhy, whyNone: whyNone,
    NORMAL_NG: NORMAL_NG, ngWords: ngWords, normalOf: normalOf,
    cleanName: cleanName,
    ONE_PLANS: ONE_PLANS, ONE_PRE_HOURS: ONE_PRE_HOURS,
    ONE_OPEN_GRADES: ONE_OPEN_GRADES, oneHours: oneHours,
    /* 8.35 積み上げ型（上のプランは下の商品も見られる）。 */
    ORDER: ORDER, rankOf: rankOf, upFrom: upFrom,
    gradesOf: gradesOf, lowestOf: lowestOf, stacked: stacked, picks: picks,
    oneGrades: oneGrades, oneList: oneList, oneWhy: oneWhy,
    oneFits: oneFits, oneWhyNone: oneWhyNone,
              keyUp: keyUp, PICK: PICK, pickOpt: pickOpt, qtyOf: qtyOf,
              scoreOf: scoreOf, whyNot: whyNot, draft: draft,
              SPEED_MIN: SPEED_MIN };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_SUBPLAN = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
