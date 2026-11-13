/* 会員向け Discord：ロールごとのテスト配信（8.9・【W】の1）
   使い方（PowerShell）:
     $env:DISCORD_BOT_TOKEN="（ボットのトークン）"
     $env:DISCORD_GUILD_ID="（サーバーID）"
     $env:PJ_SYNC_URL="https://pj-sync.…workers.dev"   # 無くても動く（見本で出す）
     $env:PJ_SYNC_KEY="（pj-sync のキー）"
     node discord/test-post.mjs --dry-run              # 送る中身だけ見る
     node discord/test-post.mjs                        # 送る
     node discord/test-post.mjs --channel リスト-ライト  # 1か所だけ
     node discord/test-post.mjs --delete               # 送ったテストを消す

   ・設計（送り先と件数）は discord/server.config.json の test に書く
   ・出す項目は §8.2 の「会員用」と同じ。**卸値・社・MW在庫・MWの画像・備考・
     MW の商品番号は出さない**（出せないように、箱に渡す品物からも外してある）
   ・トークンとキーはコード・ファイル・ログに書かない（環境変数から読む）
   ・ボットが書けないチャンネルは --dry-run でも先に見つけて出す（8.8 と同じ）
   ・送ったメッセージの ID は discord/ids.json の test:posts に控え、
     --delete で消せる（ほかの投稿には触らない）
   外部ライブラリは使わない（Node 18 以降の fetch だけ）。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeApi, botState, canWriteCh, permJa, errJa, expandKeys }
  from "./setup-discord.mjs";
/* 販売価格の式（6.178）。画面・pj-sync と同じこのファイルを読む。 */
import SUBPX from "../shared/subprice.js";
/* 8.11（【Y】）会員用のカードの作り方。本番の配信（pj-sync）と**同じ**
   ファイルを読む（形がずれないように）。 */
import SUBCARD from "../shared/subcard.js";
/* 8.15（【返事】）機種の正式な呼び名の表。読み込むと globalThis.PJ_MWFEE に
   入り、subcard.js がそれを使う（pj-sync も同じやり方）。 */
import "../shared/mwfee.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ---- テスト配信の決まり ---- */
export const TEST_MARK = "🧪 テスト配信";
export const TEST_HEAD = TEST_MARK
  + "（本番と同じ形の確認です。**購入はできません**）";
export const TEST_COLOR = 0x8e24aa;      // 本番の色（緑・赤・黄）と変える
export const EMB_MAX = 10;               // 1通に入れられる箱の数
export const EMB_CHARS = 5600;           // 1通の字数（6,000 の手前）
/* 会員用では出してはいけない項目（§8.2 の NT_MEMBER_NG と同じ）。
   うっかり足さないように名前で持つ。テストで両方が同じことも見る。 */
export const MEMBER_NG = ["卸値", "社", "MW在庫", "備考", "画像"];
/* 送料の区分（既定の言い方）。server.config.json の test.ship で変えられる。 */
export const SHIP_JA = {
  s: "小型（クリックポスト相当）",
  m: "レターパックプラス相当",
  l: "宅配便（箱）",
  unknown: "—（まだ採寸していません）",
};

export function yen(n) {
  return "¥" + Math.round(Number(n) || 0).toLocaleString("en-US");
}
/* Amazon の商品ページ（ASIN が分かっていれば dp、無ければ JAN の検索）。 */
export function amzUrl(jan, asin) {
  return /^B[0-9A-Z]{9}$/.test(String(asin || ""))
    ? ("https://www.amazon.co.jp/dp/" + asin)
    : ("https://www.amazon.co.jp/s?k=" + encodeURIComponent(String(jan || "")));
}
/* ---- 送料の区分 ----
   Amazon のサイズ区分（7.108 の size_tier）をそのまま使う。
     s … 25×18×2.0cm・250g 以内 → クリックポストに入る
     m … 45×35×20cm・9kg 以内   → レターパックプラス
     l … それより大きい          → 宅配便
   採寸できていない行は重さで見て、それも無ければ unknown。 */
export function shipTier(r) {
  const t = String((r || {}).size_tier || "").toLowerCase();
  if (t === "s" || t === "m" || t === "l") return t;
  const g = Number((r || {}).size_g) || 0;
  if (!g) return "unknown";
  return g <= 250 ? "s" : (g <= 9000 ? "m" : "l");
}
export function shipJa(r, map) {
  const m = Object.assign({}, SHIP_JA, map || {});
  return m[shipTier(r)] || m.unknown;
}
/* ---- 販売価格（税込）----
   式は shared/subprice.js の1か所だけ（画面・pj-sync と同じもの・6.178）。
   **商品代に利益を載せない。会費が収益。** 掛け率（×1.3）はやめた。
     仕入原価（卸値×1.1＋MW送料）＋ 梱包材 ＋ 上乗せ を、
     カード決済手数料ぶん割り戻した額。10円単位の切り上げはしない。
   上乗せは配信のたびに乱数で決め直すので、同じ商品でも毎回変わる。
   **会員のカードには販売価格だけを出し、仕入原価・上乗せの額は出さない。** */
export function sellPrice(r, opt) {
  const o = (opt && typeof opt === "object") ? opt : {};
  return SUBPX.priceOf(r || {}, o).price;
}
/* 会員から見た見込みの Amazon 粗利
   ＝ Amazon の実売 − Amazon の手数料 − 販売価格（会員が払う額）。
   実売か手数料が取れていない行は null（テストにも出さない）。 */
export function memberGross(r, sell) {
  const p = Number((r || {}).price) || 0;
  const fee = Number((r || {}).fee_total) || 0;
  const s = Number(sell) || 0;
  if (!(p > 0 && fee > 0 && s > 0)) return null;
  return Math.round(p - fee - s);
}
/* ---- 配信に出す品物を選ぶ（刈取の見込みありの上位）----
   返す品物には**卸値・社・備考・MW の商品番号を入れない**。
   箱を作る側がうっかり出せないようにするため（§8.2）。 */
export function pickItems(rows, opt) {
  const o = opt || {};
  const out = [];
  for (const r of rows || []) {
    const jan = String((r || {}).jan || "");
    if (!/^\d{8,14}$/.test(jan)) continue;
    /* 7.129：FBA の見積もりが出せない行は刈取に向かないので出さない。 */
    if (String(r.fee_kind || "") === "fba_ng") continue;
    /* 出品できない行（赤）は出さない。 */
    if (String(r.rst || "") === "blocked") continue;
    if ((Number(r.stock) || 0) <= 0) continue;
    const sell = sellPrice(r, o.px);
    const gross = memberGross(r, sell);
    if (gross === null || gross <= 0) continue;
    out.push({
      jan: jan,
      name: String(r.amz_name || r.mw_name || r.name || jan),
      asin: String(r.asin || ""),
      kishu: String(r.kishu || ""),
      sell: sell, gross: gross,
      stock: Number(r.stock) || 0,
      size_tier: String(r.size_tier || ""),
      size_g: Number(r.size_g) || 0,
    });
  }
  out.sort((a, b) => (b.gross - a.gross) || (a.jan < b.jan ? -1 : 1));
  return out;
}
/* ---- 見本（pj-sync から取れないとき）----
   形の確認だけなので固定。値は本物に似せた作り物。 */
export const SAMPLE = [
  { jan: "4902370550467", name: "スーパーマリオパーティ ジャンボリー（Switch）",
    asin: "B0D1GSZJ8T", kishu: "Switch", sell: 5300, gross: 1180, stock: 6,
    size_tier: "s", size_g: 110 },
  { jan: "4948872415019", name: "ドラゴンボール カードゲーム フュージョンワールド",
    asin: "B0CW1GB9VN", kishu: "TCG", sell: 3800, gross: 940, stock: 4,
    size_tier: "s", size_g: 180 },
  { jan: "4549660927846", name: "フィギュアライズ スタンダード 仮面ライダー",
    asin: "B0CZ6Y8HP2", kishu: "プラモデル", sell: 2600, gross: 720, stock: 9,
    size_tier: "m", size_g: 420 },
  { jan: "4988601009263", name: "ファイナルファンタジーVII リバース（PS5）",
    asin: "B0C6W9MJ2P", kishu: "PS5", sell: 6900, gross: 1540, stock: 3,
    size_tier: "s", size_g: 120 },
  { jan: "4970381800123", name: "Nintendo Switch 有機EL 保護フィルム 2枚組",
    asin: "B09V3HN1YT", kishu: "周辺機器", sell: 1300, gross: 410, stock: 12,
    size_tier: "s", size_g: 60 },
  { jan: "4535506307842", name: "ねんどろいど 初音ミク 2.0",
    asin: "B0BQ3Y6S9F", kishu: "フィギュア", sell: 7400, gross: 1830, stock: 2,
    size_tier: "m", size_g: 520 },
  { jan: "4902370552683", name: "ゼルダの伝説 知恵のかりもの（Switch）",
    asin: "B0D7X5JTNP", kishu: "Switch", sell: 5600, gross: 1270, stock: 5,
    size_tier: "s", size_g: 110 },
  { jan: "4573102636072", name: "ポケモンカードゲーム 強化拡張パック",
    asin: "B0DH2K9SQY", kishu: "TCG", sell: 2100, gross: 630, stock: 8,
    size_tier: "s", size_g: 90 },
];

/* ---- 1商品＝1つの箱（embed）---- */
/* 8.11（【Y】）カードの作り方は shared/subcard.js の1か所だけ。
   ここは「テスト配信」の印と色を足すだけにする（本番と形がずれないように）。
   buyUrl は config の文字（{jan} を差し替える形）でも、ドメインでも受ける。 */
export function testEmbed(it, opt) {
  const o = opt || {};
  const x = it || {};
  const jan = String(x.jan || "");
  const e = SUBCARD.card({
    jan: jan, name: x.name, asin: x.asin, kishu: x.kishu,
    price: x.sell, gross: x.gross,
    qty: Number(x.stock) || 0, left: Number(x.stock) || 0,
    size_tier: x.size_tier, size_g: x.size_g,
  }, { maxQty: o.maxQty, shipJa: o.shipJa, color: Number(o.color) || TEST_COLOR,
       mark: TEST_MARK,
       note: TEST_MARK + "・販売価格と残り数は仮の値です" });
  /* 購入リンクは config の形（{jan} 入り）を優先する。 */
  if (o.buyUrl) {
    for (const f of e.fields || []) {
      if (f.name !== "購入リンク") continue;
      f.value = "[購入する](" + String(o.buyUrl).replace("{jan}", jan) + ")";
    }
  }
  return e;
}
export function embedLen(e) {
  const o = e || {};
  let n = String(o.title || "").length + String(o.description || "").length
    + String(((o.footer || {}).text) || "").length;
  for (const x of (o.fields || []))
    n += String(x.name || "").length + String(x.value || "").length;
  return n;
}
/* 箱を 10個ずつ・5,600字ずつに分けて、送る通に組み立てる。 */
export function splitEmbeds(list, head) {
  const out = [];
  let cur = [], len = 0;
  for (const e of list || []) {
    const n = embedLen(e);
    if (cur.length && (cur.length >= EMB_MAX || len + n > EMB_CHARS)) {
      out.push(cur); cur = []; len = 0;
    }
    cur.push(e); len += n;
  }
  if (cur.length) out.push(cur);
  return out.map((es, i) => ({
    content: i === 0 ? String(head || TEST_HEAD) : "",
    embeds: es,
  }));
}

/* ---- 送り先（server.config.json の test.posts）---- */
export function findChannel(cfg, key) {
  for (const cat of (cfg.categories || []))
    for (const ch of (cat.channels || [])) if (ch.key === key) return ch;
  return null;
}
/* そのチャンネルを見られるロールに当たるプラン（0個以上）。 */
export function plansOfChannel(cfg, ch) {
  const view = expandKeys((ch || {}).view, cfg);
  return (cfg.plans || []).filter((p) => view.indexOf(p.role) >= 0);
}
/* 「お一人 n点まで」の n。当たるプランが**ぜんぶ同じ数**のときだけ出す。
   目玉商品のように全員が見るチャンネルはプランごとに違うので 0（出さない）。
   リスト-スタンダードはスタンダードとモニターの2つだが、どちらも5点なので出す。 */
export function qtyOfChannel(cfg, ch) {
  const hit = plansOfChannel(cfg, ch);
  if (!hit.length) return 0;
  const q = Number(hit[0].max_qty) || 0;
  return hit.every((p) => (Number(p.max_qty) || 0) === q) ? q : 0;
}
/* 送り先と件数の一覧。--channel で1か所だけに絞れる（名前でも key でも）。 */
export function targets(cfg, opt) {
  const o = opt || {};
  const only = String(o.channel || "").trim();
  const out = [];
  for (const t of (((cfg.test || {}).posts) || [])) {
    const ch = findChannel(cfg, t.ch);
    if (!ch) continue;
    if (only && only !== ch.name && only !== ch.key
        && only !== ("#" + ch.name)) continue;
    const hit = plansOfChannel(cfg, ch);
    out.push({ key: ch.key, name: ch.name,
               n: Math.max(1, Number(o.n) || Number(t.n) || 1),
               plan: hit.map((p) => String(p.name)).join("・"),
               maxQty: qtyOfChannel(cfg, ch) });
  }
  return out;
}

/* ---- pj-sync から刈取の行を取る（取れなければ見本）---- */
export async function fetchRows(opt) {
  const o = opt || {};
  const url = String(o.url || "").replace(/\/+$/, "");
  const key = String(o.key || "");
  const fetchFn = o.fetch || globalThis.fetch;
  const want = Math.max(1, Number(o.rows) || 1500);
  if (!url || !key) return { rows: [], why: "pj-sync の URL とキーがありません" };
  const rows = [];
  let offset = 0;
  for (let i = 0; i < 5 && rows.length < want; i++) {
    const u = url + "/mw/amz?priced=1&limit=1500&offset=" + offset;
    let d = null;
    try {
      const res = await fetchFn(u, { headers: { "X-PJ-Key": key } });
      if (!res.ok) return { rows: rows,
        why: "pj-sync が HTTP " + res.status + " を返しました" };
      d = await res.json();
    } catch (e) {
      /* キーは絶対に出さない（本文だけ）。 */
      return { rows: rows, why: "pj-sync に届きません："
        + String((e && e.message) || e).slice(0, 200) };
    }
    const got = ((d && d.rows) || []);
    rows.push.apply(rows, got);
    if (!got.length || !(d && d.more)) break;
    offset += got.length;
  }
  return { rows: rows, why: "" };
}

/* ================= 本体 ================= */
export async function post(opt) {
  const o = opt || {};
  const cfg = o.config;
  const api = o.api;
  const guild = String(o.guild || "");
  const dry = !!o.dryRun;
  const log = o.log || (() => {});
  /* dels … 消したもの／left … 消せずに控えに残すもの */
  const plan = { sends: [], dels: [], left: [], manual: [], fails: [],
                 bot: null, items: 0, src: "", posts: [] };
  if (!cfg) throw new Error("設定（server.config.json）がありません");
  if (!guild) throw new Error("サーバーID（DISCORD_GUILD_ID）がありません");
  const tcfg = cfg.test || {};

  /* ---- ボットの権限と、チャンネルの一覧 ---- */
  const have = await api.roles(guild);
  const bot = await botState(api, guild, have);
  plan.bot = bot;
  const chs = (await api.channels(guild)) || [];
  const byName = {};
  for (const c of chs) byName[String(c.name)] = c;

  /* ---- 消す（--delete）---- */
  if (o.del) {
    for (const r of (o.recorded || [])) {
      const one = { ch: String(r.ch || ""), id: String(r.id || ""),
                    name: String(r.name || "") };
      if (dry) { plan.dels.push(one); continue; }
      try { await api.msgDel(one.ch, one.id); plan.dels.push(one); }
      catch (e) {
        const msg = String((e && e.message) || e);
        /* すでに手で消されていた（10008）ときは控えからも外す。 */
        if (/10008/.test(msg)) { plan.dels.push(one); continue; }
        plan.left.push(one);
        plan.fails.push({ what: "テストの投稿を消す（#" + (one.name || "?")
                            + " の " + one.id + "）", msg: msg });
        log("消せませんでした（" + (one.name || one.id) + "）：" + msg);
      }
    }
    return plan;
  }

  /* ---- 出す品物 ---- */
  const got = await fetchRows({ url: o.syncUrl, key: o.syncKey,
                                fetch: o.fetch, rows: o.rows });
  let items = pickItems(got.rows, { px: tcfg.price });
  if (items.length) {
    plan.src = "pj-sync の実データ（" + got.rows.length + "行から "
      + items.length + "件）";
  } else {
    items = SAMPLE.slice();
    plan.src = "見本（固定）" + (got.why ? "：" + got.why : "");
    log("pj-sync から取れないので見本で出します" + (got.why ? "：" + got.why : ""));
  }
  plan.items = items.length;

  /* ---- 送り先ごとに箱を作る ---- */
  const list = targets(cfg, { channel: o.channel, n: o.n });
  if (!list.length)
    plan.manual.push({ kind: "確認", name: "送り先がありません",
      how: "discord/server.config.json の test.posts を確かめてください"
        + (o.channel ? ("（--channel " + o.channel + " に当たるものがありません）")
                     : "") });
  const need = ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"];
  for (const t of list) {
    const c = byName[t.name];
    if (!c) {
      plan.manual.push({ kind: "ない", name: t.name,
        how: "#" + t.name + " がサーバーにありません。"
          + "先に node discord/setup-discord.mjs を実行してください。" });
      continue;
    }
    /* ボットが書けるか（8.8 と同じ計算）。--dry-run でも先に出す。 */
    const okWrite = bot.unknown || canWriteCh(c.permission_overwrites || [],
      bot.roleIds, bot.perms, guild, ["EMBED_LINKS"]);
    if (!okWrite) {
      plan.manual.push({ kind: "書けない", name: t.name, items: need.slice(),
        how: "#" + t.name + " はボット（" + (bot.topName || "ボットのロール")
          + "）が書けません。チャンネルの権限で "
          + need.map(permJa).join("・") + " を許可するか、"
          + "discord/server.config.json の send に \"bot\" を入れて"
          + "node discord/setup-discord.mjs をもう一度実行してください。" });
      continue;
    }
    const es = items.slice(0, t.n).map((it) => testEmbed(it, {
      maxQty: t.maxQty, shipJa: tcfg.ship, color: tcfg.color,
      buyUrl: tcfg.buyUrl }));
    const msgs = splitEmbeds(es, tcfg.head || TEST_HEAD);
    plan.sends.push({ key: t.key, name: t.name, id: String(c.id),
                      n: es.length, plan: t.plan, maxQty: t.maxQty,
                      msgs: msgs });
  }

  /* ---- 送る ---- */
  for (const s of plan.sends) {
    if (dry) continue;
    for (const m of s.msgs) {
      let made = null;
      try { made = await api.msgAdd(s.id, m); }
      catch (e) {
        const msg = String((e && e.message) || e);
        plan.fails.push({ what: "テスト配信（" + s.name + "）", msg: msg });
        log("送れませんでした（" + s.name + "）：" + msg);
        plan.manual.push({ kind: "投稿", name: s.name,
          how: "#" + s.name + " にテスト配信を送れませんでした。"
            + "チャンネルの権限で " + need.map(permJa).join("・")
            + " を許可して、もう一度実行してください。" });
        break;
      }
      if (made && made.id)
        plan.posts.push({ ch: s.id, id: String(made.id), name: s.name,
                          at: new Date().toISOString() });
    }
  }
  return plan;
}

/* 一覧を文字で（--dry-run でも本実行でも同じ形で出す）。 */
export function planText(plan, dry, verbose) {
  const t = [];
  t.push(dry ? "=== --dry-run（1件も送りません）===" : "=== 送りました ===");
  if (plan.src) { t.push(""); t.push("品物の出どころ：" + plan.src); }
  const show = (title, list, f) => {
    t.push("");
    t.push(title + "：" + (list.length ? list.length + "件" : "なし"));
    for (const x of list) t.push("  " + f(x));
  };
  show("送り先", plan.sends || [], (x) => "#" + x.name + " … " + x.n + "件"
    + (x.plan ? ("（" + x.plan
        + (x.maxQty > 0 ? ("・お一人 " + x.maxQty + "点まで") : "") + "）") : "")
    + "／" + x.msgs.length + "通");
  show("消したテストの投稿", plan.dels || [],
    (x) => "#" + (x.name || x.ch) + " の " + x.id);
  const bot = plan.bot;
  if (bot) {
    t.push("");
    t.push("ボットのロール：" + (bot.unknown
      ? ("読めませんでした（" + bot.why + "）")
      : ((bot.topName || "（ありません）") + "・position=" + bot.top)));
  }
  show("手でやってほしいこと", plan.manual || [],
    (x) => "［" + x.kind + "］" + x.name + "\n      " + x.how);
  show("できなかったこと（止めずに進めました）", plan.fails || [],
    (x) => x.what + "\n      " + String(x.msg || "").replace(/\n/g, "\n    "));
  /* --dry-run では中身（箱の文字）も出す（これが確認の主目的）。 */
  if (dry || verbose) {
    for (const s of (plan.sends || [])) {
      t.push("");
      t.push("---- #" + s.name + " に送る中身 ----");
      for (const m of s.msgs) {
        if (m.content) t.push(m.content);
        for (const e of m.embeds) {
          t.push("  ■ " + e.title);
          t.push("    " + e.url);
          for (const f of e.fields)
            t.push("    " + f.name + "：" + String(f.value).replace(/\n/g, " "));
          t.push("    （" + e.footer.text + "）");
        }
      }
    }
  }
  return t.join("\n");
}

/* ================= ids.json（送った ID の控え）================= */
export const IDS_KEY = "test:posts";
export function readIds(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "ids.json"), "utf8"));
  } catch (e) { return {}; }
}
export function writeIds(dir, ids) {
  fs.writeFileSync(path.join(dir, "ids.json"),
    JSON.stringify(ids, null, 2) + "\n", "utf8");
}

/* ================= コマンドとして動かす ================= */
export async function main(argv, envv) {
  const args = argv || [];
  const env = envv || process.env;
  const dry = args.indexOf("--dry-run") >= 0;
  const del = args.indexOf("--delete") >= 0;
  const argOf = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? String(args[i + 1] || "") : "";
  };
  const token = String(env.DISCORD_BOT_TOKEN || "");
  const guild = String(args.filter((x) => /^\d{5,}$/.test(x))[0]
    || env.DISCORD_GUILD_ID || "");
  if (!token) {
    console.error("DISCORD_BOT_TOKEN がありません。"
      + 'PowerShell で $env:DISCORD_BOT_TOKEN="…" を先に入れてください。');
    return 1;
  }
  if (!guild) {
    console.error("サーバーID がありません。引数か DISCORD_GUILD_ID で渡してください。");
    return 1;
  }
  const cfg = JSON.parse(fs.readFileSync(
    path.join(HERE, "server.config.json"), "utf8"));
  const ids = readIds(HERE);
  const api = makeApi(token);
  const plan = await post({
    config: cfg, api: api, guild: guild, dryRun: dry, del: del,
    channel: argOf("--channel"), n: Number(argOf("--n")) || 0,
    rows: Number(argOf("--rows")) || 0,
    syncUrl: env.PJ_SYNC_URL, syncKey: env.PJ_SYNC_KEY,
    recorded: (ids[IDS_KEY] || []),
    log: (s) => console.log(s),
  });
  console.log(planText(plan, dry));
  if (!dry) {
    if (del) {
      const left = plan.left || [];
      ids[IDS_KEY] = left;
      writeIds(HERE, ids);
      console.log("\n控えを消しました：discord/ids.json の " + IDS_KEY
        + "（残り " + left.length + "件）");
    } else if ((plan.posts || []).length) {
      ids[IDS_KEY] = (ids[IDS_KEY] || []).concat(plan.posts);
      writeIds(HERE, ids);
      console.log("\n送った ID を控えました：discord/ids.json の " + IDS_KEY
        + "（" + ids[IDS_KEY].length + "件）"
        + "　消すときは node discord/test-post.mjs --delete");
    }
  }
  console.log("\n送った回数：" + api.calls.length);
  if ((plan.manual || []).length)
    console.log("※ 手でやってほしいこと：" + plan.manual.length + "件");
  if ((plan.fails || []).length)
    console.log("※ できなかったこと：" + plan.fails.length + "件");
  return 0;
}
if (process.argv[1] && /test-post\.mjs$/.test(process.argv[1])) {
  main(process.argv.slice(2), process.env)
    .then((c) => process.exit(c))
    .catch((e) => { console.error("失敗：" + (e && e.message)); process.exit(1); });
}
