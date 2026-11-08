/* 会員向け Discord サーバーの自動構築（8.1）
   使い方（PowerShell）:
     $env:DISCORD_BOT_TOKEN="（ボットのトークン）"
     $env:DISCORD_GUILD_ID="（サーバーID）"
     node discord/setup-discord.mjs --dry-run     # 何をするかだけ見る
     node discord/setup-discord.mjs               # 実行
   ・設計は discord/server.config.json だけに書く（このファイルは読むだけ）
   ・**何度実行しても二重に作らない**（名前で照合し、あれば直すだけ）
   ・**既存のチャンネル・ロール・書き込みは消さない**
     （設定に無いものは「設定にないもの」として一覧に出すだけ）
   ・トークンはコード・ファイル・ログに書かない（環境変数から読む）
   ・作った ID は discord/ids.json に保存する（.gitignore に入れてある）
   外部ライブラリは使わない（Node 18 以降の fetch だけ）。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = "https://discord.com/api/v10";

/* ---- 権限のビット（Discord の Permissions）----
   使うものだけ。名前は Discord の定数名にそろえる。 */
export const PERM = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MANAGE_ROLES: 1n << 28n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
};
/* ボットの招待に必要な権限（README の招待URLに入れる）。
   メッセージを読む権限（特権インテント）は要らない。 */
export const INVITE_PERMS = [
  "MANAGE_CHANNELS", "MANAGE_ROLES", "SEND_MESSAGES", "MANAGE_MESSAGES",
  "VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "EMBED_LINKS", "ATTACH_FILES",
];
export function permBits(names) {
  let v = 0n;
  for (const n of names || []) {
    if (PERM[n] === undefined) throw new Error("知らない権限：" + n);
    v |= PERM[n];
  }
  return v;
}
export function inviteUrl(appId) {
  return "https://discord.com/api/oauth2/authorize?client_id=" + String(appId)
    + "&scope=bot&permissions=" + permBits(INVITE_PERMS).toString();
}
/* 色（#rrggbb → 数値）。 */
export function colorNum(s) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(s || ""));
  return m ? parseInt(m[1], 16) : 0;
}

/* ================= 権限の組み立て =================
   view … 見られるロール（'@everyone' は全員・'@members' は会員のロールぜんぶ）
   send … 書き込めるロール。view にいて send にいないロールは
           書き込み・リアクション・スレッドを止める（読むだけ）。
   管理者とスタッフは、どのチャンネルも必ず見られる。 */
const READ = ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"];
const WRITE = ["SEND_MESSAGES", "ADD_REACTIONS"];
const THREAD = ["CREATE_PUBLIC_THREADS", "SEND_MESSAGES_IN_THREADS"];
export function expandKeys(keys, cfg) {
  const out = [];
  for (const k of keys || []) {
    if (k === "@members") {
      for (const m of cfg.memberRoles || []) if (out.indexOf(m) < 0) out.push(m);
    } else if (out.indexOf(k) < 0) out.push(k);
  }
  return out;
}
/* 1チャンネルぶんの overwrites を作る。
   ids … { roleKey: roleId } と { "@everyone": guildId }。 */
export function overwritesFor(ch, cfg, ids) {
  const view = expandKeys(ch.view, cfg);
  const send = expandKeys(ch.send, cfg);
  const rows = [];
  const put = (id, allow, deny) => {
    if (!id) return;
    rows.push({ id: String(id), type: 0,
                allow: permBits(allow).toString(), deny: permBits(deny).toString() });
  };
  /* @everyone。view に無ければ**見られない**ようにする。 */
  const everyoneSees = view.indexOf("@everyone") >= 0;
  if (everyoneSees) {
    const canWrite = send.indexOf("@everyone") >= 0;
    put(ids["@everyone"], READ, canWrite ? [] : WRITE.concat(THREAD));
  } else {
    put(ids["@everyone"], [], ["VIEW_CHANNEL"]);
  }
  /* 管理者・スタッフは必ず見られる（管理者はそもそも全権限）。 */
  const always = ["admin", "staff"];
  const seen = {};
  for (const key of view.concat(always).concat(send)) {
    if (key === "@everyone" || seen[key]) continue;
    seen[key] = 1;
    const id = ids[key];
    if (!id) continue;
    const canWrite = send.indexOf(key) >= 0 || key === "admin"
      || (key === "staff" && send.indexOf("staff") >= 0);
    const allow = READ.concat(canWrite ? WRITE : []);
    if (canWrite && ch.threads) allow.push.apply(allow, THREAD);
    const deny = canWrite ? [] : WRITE.concat(THREAD);
    put(id, allow, deny);
  }
  return rows;
}
/* 2つの overwrites が同じか（並び順は見ない）。 */
export function sameOverwrites(a, b) {
  const key = (l) => (l || []).map((x) => [String(x.id), String(x.allow || "0"),
    String(x.deny || "0")].join(":")).sort().join("|");
  return key(a) === key(b);
}

/* ================= Discord の窓口 ================= */
export function makeApi(token, opt) {
  const o = opt || {};
  const fetchFn = o.fetch || globalThis.fetch;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const calls = [];
  async function call(method, pathname, body) {
    calls.push({ method, path: pathname });
    for (let i = 0; i < 5; i++) {
      const res = await fetchFn(API + pathname, {
        method,
        headers: Object.assign({ "authorization": "Bot " + token,
          "content-type": "application/json",
          "user-agent": "pj-price-discord-setup (+https://github.com/gamegamesan-dot/pj_price)" }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      /* 混み合っているとき（429）は、言われた秒数だけ待ってやり直す。 */
      if (res.status === 429) {
        let wait = 1;
        try { wait = Number((await res.json()).retry_after) || 1; } catch (e) { wait = 1; }
        await sleep(Math.min(10, wait) * 1000);
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        /* トークンは**絶対に出さない**（本文だけ出す）。 */
        throw new Error(method + " " + pathname + " → HTTP " + res.status + " "
          + String(text || "").slice(0, 300));
      }
      if (!text) return null;
      try { return JSON.parse(text); } catch (e) { return null; }
    }
    throw new Error(method + " " + pathname + " → 混み合っていて送れませんでした");
  }
  return {
    calls,
    roles: (g) => call("GET", "/guilds/" + g + "/roles"),
    roleAdd: (g, b) => call("POST", "/guilds/" + g + "/roles", b),
    roleEdit: (g, id, b) => call("PATCH", "/guilds/" + g + "/roles/" + id, b),
    roleOrder: (g, b) => call("PATCH", "/guilds/" + g + "/roles", b),
    channels: (g) => call("GET", "/guilds/" + g + "/channels"),
    chAdd: (g, b) => call("POST", "/guilds/" + g + "/channels", b),
    chEdit: (id, b) => call("PATCH", "/channels/" + id, b),
    msgs: (id, n) => call("GET", "/channels/" + id + "/messages?limit=" + (n || 20)),
    msgAdd: (id, b) => call("POST", "/channels/" + id + "/messages", b),
    pins: (id) => call("GET", "/channels/" + id + "/pins"),
    pinAdd: (ch, id) => call("PUT", "/channels/" + ch + "/pins/" + id),
    me: () => call("GET", "/users/@me"),
  };
}

/* ================= 本体 ================= */
export async function setup(opt) {
  const o = opt || {};
  const cfg = o.config;
  const api = o.api;
  const guild = String(o.guild || "");
  const dry = !!o.dryRun;
  const log = o.log || (() => {});
  const plan = { roles: [], channels: [], posts: [], extra: [], ids: {} };
  if (!cfg) throw new Error("設定（server.config.json）がありません");
  if (!guild) throw new Error("サーバーID（DISCORD_GUILD_ID）がありません");

  /* ---- ロール ---- */
  const have = await api.roles(guild);
  const byName = {};
  for (const r of have || []) byName[String(r.name)] = r;
  const ids = { "@everyone": guild };
  /* 設定の並び（上から強い）を Discord の position に直す。
     @everyone が 0 なので、いちばん弱いロールが 1。 */
  const wanted = cfg.roles || [];
  for (let i = 0; i < wanted.length; i++) {
    const w = wanted[i];
    const want = { name: w.name, color: colorNum(w.color),
                   hoist: !!w.hoist, mentionable: !!w.mentionable,
                   permissions: permBits(w.permissions).toString() };
    const old = byName[w.name];
    if (!old) {
      plan.roles.push({ act: "add", name: w.name, why: "ありません" });
      if (!dry) {
        const made = await api.roleAdd(guild, want);
        ids[w.key] = String((made && made.id) || "");
      } else ids[w.key] = "(新)";
      continue;
    }
    ids[w.key] = String(old.id);
    const diff = [];
    if (String(old.permissions || "0") !== want.permissions) diff.push("権限");
    if (Number(old.color || 0) !== want.color) diff.push("色");
    if (!!old.hoist !== want.hoist) diff.push("別に表示");
    if (!!old.mentionable !== want.mentionable) diff.push("メンション");
    if (diff.length) {
      plan.roles.push({ act: "fix", name: w.name, why: diff.join("・") });
      if (!dry) await api.roleEdit(guild, old.id, want);
    }
  }
  /* 並び順（上から強い）。@everyone と、設定に無いロールは触らない。
     **すでにその順なら送らない**（もう一度実行したときに「変更なし」になるように）。 */
  const order = [];
  for (let i = 0; i < wanted.length; i++) {
    const id = ids[wanted[i].key];
    if (id && id !== "(新)") order.push({ id: String(id),
      position: wanted.length - i });
  }
  const posNow = {};
  for (const r of have || []) posNow[String(r.id)] = Number(r.position || 0);
  let okOrder = order.length > 0;
  for (let i = 1; i < order.length; i++) {
    const a = posNow[order[i - 1].id], b = posNow[order[i].id];
    if (a === undefined || b === undefined || !(a > b)) { okOrder = false; break; }
  }
  if (order.length && !okOrder) {
    plan.roles.push({ act: "order", name: "並び順",
      why: wanted.map((x) => x.name).join(" > ") });
    if (!dry) await api.roleOrder(guild, order);
  }

  /* ---- カテゴリとチャンネル ---- */
  const chs = (await api.channels(guild)) || [];
  const catByName = {}, chByName = {};
  for (const c of chs) {
    if (Number(c.type) === 4) catByName[String(c.name)] = c;
    else chByName[String(c.name)] = c;
  }
  const used = {};
  let pos = 0;
  for (const cat of cfg.categories || []) {
    used[cat.name] = 1;
    let catId = "";
    /* カテゴリ自体は誰でも見えるままにする（中のチャンネルで見せ分けるので、
       見えるチャンネルが1本も無いカテゴリは左のメニューに出ない）。 */
    const old = catByName[cat.name];
    if (!old) {
      plan.channels.push({ act: "add", name: cat.name, kind: "カテゴリ" });
      if (!dry) {
        const made = await api.chAdd(guild,
          { name: cat.name, type: 4, position: pos++ });
        catId = String((made && made.id) || "");
      } else catId = "(新)";
    } else {
      catId = String(old.id);
      pos++;
    }
    plan.ids["cat:" + cat.key] = catId;
    for (const ch of cat.channels || []) {
      used[ch.name] = 1;
      const want = { name: ch.name, type: 0, parent_id: catId || undefined,
                     topic: ch.topic || "",
                     permission_overwrites: overwritesFor(ch, cfg, ids) };
      const cur = chByName[ch.name];
      if (!cur) {
        plan.channels.push({ act: "add", name: ch.name, kind: "チャンネル",
                             cat: cat.name });
        if (!dry) {
          const made = await api.chAdd(guild, want);
          plan.ids["ch:" + ch.key] = String((made && made.id) || "");
          if (ch.post) plan.posts.push({ key: ch.key, name: ch.name,
            id: String((made && made.id) || ""), pin: !!ch.pin });
        } else {
          plan.ids["ch:" + ch.key] = "(新)";
          if (ch.post) plan.posts.push({ key: ch.key, name: ch.name, id: "(新)",
            pin: !!ch.pin });
        }
        continue;
      }
      plan.ids["ch:" + ch.key] = String(cur.id);
      const diff = [];
      if (String(cur.parent_id || "") !== String(catId || "")) diff.push("カテゴリ");
      if (String(cur.topic || "") !== String(ch.topic || "")) diff.push("説明");
      if (!sameOverwrites(cur.permission_overwrites, want.permission_overwrites))
        diff.push("権限");
      if (diff.length) {
        plan.channels.push({ act: "fix", name: ch.name, kind: "チャンネル",
                             why: diff.join("・") });
        if (!dry) await api.chEdit(cur.id, want);
      }
      /* 案内文は**空のチャンネルにだけ**入れる（書き込みは消さない・増やさない）。 */
      if (ch.post) {
        let msgs = [];
        try { msgs = (await api.msgs(cur.id, 5)) || []; } catch (e) { msgs = []; }
        if (!msgs.length) {
          plan.posts.push({ key: ch.key, name: ch.name, id: String(cur.id),
                            pin: !!ch.pin });
        }
      }
    }
  }
  /* ---- 案内文を投稿してピン留め ---- */
  for (const p of plan.posts) {
    const ch = findChannel(cfg, p.key);
    const body = { content: (ch.post || []).join("\n").slice(0, 1900) };
    if (dry || !p.id || p.id === "(新)") continue;
    const made = await api.msgAdd(p.id, body);
    if (p.pin && made && made.id) {
      try { await api.pinAdd(p.id, made.id); } catch (e) {
        log("ピン留めできませんでした（" + p.name + "）：" + e.message);
      }
    }
  }
  /* ---- 設定に無いもの（消さずに知らせるだけ）---- */
  for (const c of chs) {
    if (!used[String(c.name)])
      plan.extra.push({ name: String(c.name),
        kind: Number(c.type) === 4 ? "カテゴリ" : "チャンネル" });
  }
  for (const r of have || []) {
    const name = String(r.name);
    if (name === "@everyone") continue;
    if (!(cfg.roles || []).some((x) => x.name === name))
      plan.extra.push({ name, kind: "ロール" });
  }
  plan.ids = Object.assign({ guild: guild }, plan.ids);
  for (const w of cfg.roles || []) plan.ids["role:" + w.key] = ids[w.key] || "";
  return plan;
}
export function findChannel(cfg, key) {
  for (const cat of cfg.categories || [])
    for (const ch of cat.channels || []) if (ch.key === key) return ch;
  return {};
}
/* 一覧を文字で（--dry-run でも本実行でも同じ形で出す）。 */
export function planText(plan, dry) {
  const t = [];
  t.push(dry ? "=== --dry-run（何も変えません）===" : "=== 実行しました ===");
  const show = (title, list, f) => {
    t.push("");
    t.push(title + "：" + (list.length ? list.length + "件" : "なし"));
    for (const x of list) t.push("  " + f(x));
  };
  show("ロール", plan.roles, (x) => ({ add: "作る", fix: "直す", order: "並べる" })[x.act]
    + " " + x.name + (x.why ? "（" + x.why + "）" : ""));
  show("チャンネル", plan.channels, (x) => (x.act === "add" ? "作る" : "直す")
    + " " + x.kind + " " + x.name + (x.cat ? "（" + x.cat + "）" : "")
    + (x.why ? "（" + x.why + "）" : ""));
  show("案内文の投稿", plan.posts, (x) => x.name + (x.pin ? "（ピン留め）" : ""));
  show("設定にないもの（消していません）", plan.extra,
    (x) => x.kind + " " + x.name);
  return t.join("\n");
}

/* ================= コマンドとして動かす ================= */
export async function main(argv, envv) {
  const args = argv || [];
  const env = envv || process.env;
  const dry = args.indexOf("--dry-run") >= 0;
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
  const cfg = JSON.parse(fs.readFileSync(path.join(HERE, "server.config.json"), "utf8"));
  const api = makeApi(token);
  const plan = await setup({ config: cfg, api, guild, dryRun: dry,
                             log: (s) => console.log(s) });
  console.log(planText(plan, dry));
  if (!dry) {
    const out = path.join(HERE, "ids.json");
    fs.writeFileSync(out, JSON.stringify(plan.ids, null, 2) + "\n", "utf8");
    console.log("\nID を書きました：discord/ids.json（.gitignore に入れてあります）");
  }
  console.log("\n送った回数：" + api.calls.length);
  return 0;
}
/* 直に実行されたときだけ動かす（テストから読み込んでも動かない）。 */
if (process.argv[1] && /setup-discord\.mjs$/.test(process.argv[1])) {
  main(process.argv.slice(2), process.env)
    .then((c) => process.exit(c))
    .catch((e) => { console.error("失敗：" + (e && e.message)); process.exit(1); });
}
