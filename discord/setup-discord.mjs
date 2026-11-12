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
   ・**ボットが持っていない権限は付けない**（Discord は断る）。
     付けられなかった権限は「手でやってほしいこと」に出す（8.7）
   ・**ボットのロールより上には並べ替えない**。上に置くロール（管理者）は
     「手でこの順に並べてください」と案内する（8.7）
   ・**途中で止めない**。ロールでつまずいても、チャンネルの作成と
     案内文の投稿まで進む（8.7）
   ・--dry-run でも、これらの問題を**先に**見つけて出す（8.7）
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
  /* 8.14（【Y】の5）**ピン留めは専用の権限になった**。
     「メッセージの管理」（MANAGE_MESSAGES）だけでは留められず、
     ピン留めが 403 で落ちていた。
     値は Discord の権限表の PIN_MESSAGES（1 << 51）。
     もし将来ここが変わったら、症状は「ピン留めだけ 403」になる。 */
  PIN_MESSAGES: 1n << 51n,
};
/* ピン留めに要る権限（8.14）。**両方**を見る。
   どちらか片方しか要らない Discord でも、両方あれば必ず留められる。 */
export const PIN_PERMS = ["MANAGE_MESSAGES", "PIN_MESSAGES"];
/* ボットの招待に必要な権限（README の招待URLに入れる）。
   メッセージを読む権限（特権インテント）は要らない。 */
export const INVITE_PERMS = [
  "MANAGE_CHANNELS", "MANAGE_ROLES", "SEND_MESSAGES", "MANAGE_MESSAGES",
  /* 8.14（【Y】の5）ピン留めの権限。招待URLにも入れる
     （入れないと、あとから手で付けることになる）。 */
  "PIN_MESSAGES",
  "VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "EMBED_LINKS", "ATTACH_FILES",
  /* 読むだけのチャンネルを作るのに要る（8.7）。
     ボットが持っていない権限は overwrites にも書けないため。 */
  "ADD_REACTIONS", "CREATE_PUBLIC_THREADS", "SEND_MESSAGES_IN_THREADS",
];
export function permBits(names) {
  let v = 0n;
  for (const n of names || []) {
    if (PERM[n] === undefined) throw new Error("知らない権限：" + n);
    v |= PERM[n];
  }
  return v;
}
/* 権限のビット → 定数名の一覧（手で付けてもらうときに出す）。 */
export function permNames(bits) {
  const v = BigInt(bits || 0);
  const out = [];
  for (const k of Object.keys(PERM)) if ((v & PERM[k]) === PERM[k]) out.push(k);
  return out;
}
/* 権限の日本語名（Discord の画面の言い方にそろえる）。 */
export const PERM_JA = {
  ADMINISTRATOR: "管理者", MANAGE_CHANNELS: "チャンネルの管理",
  ADD_REACTIONS: "リアクションの追加", VIEW_CHANNEL: "チャンネルを見る",
  SEND_MESSAGES: "メッセージを送信", MANAGE_MESSAGES: "メッセージの管理",
  EMBED_LINKS: "埋め込みリンク", ATTACH_FILES: "ファイルを添付",
  READ_MESSAGE_HISTORY: "メッセージ履歴を読む", MANAGE_ROLES: "ロールの管理",
  CREATE_PUBLIC_THREADS: "公開スレッドの作成",
  SEND_MESSAGES_IN_THREADS: "スレッドでメッセージを送信",
  PIN_MESSAGES: "メッセージをピン留め",
};
export function permJa(n) {
  return (PERM_JA[n] || n) + "（" + n + "）";
}
/* ---- Discord の決まり（8.7）----
   ① ボットは**自分が持っていない権限**をロールやチャンネルに付けられない
      （付けようとすると 50013 Missing Permissions で断られる）
   ② ボットは**自分のロールより上のロール**を直せない・動かせない
   そこで、付けられない権限は落として作り、落ちたものは
   「手で付けてください」として一覧に出す。
   botBits が undefined のときは絞らない（ボットの権限が読めなかったとき）。 */
export function maskPerms(names, botBits) {
  const want = names || [];
  for (const n of want) if (PERM[n] === undefined)
    throw new Error("知らない権限：" + n);
  if (botBits === undefined || botBits === null)
    return { bits: permBits(want), dropped: [] };
  const bot = BigInt(botBits);
  if ((bot & PERM.ADMINISTRATOR) === PERM.ADMINISTRATOR)
    return { bits: permBits(want), dropped: [] };
  const keep = [], dropped = [];
  for (const n of want) {
    if ((bot & PERM[n]) === PERM[n]) keep.push(n); else dropped.push(n);
  }
  return { bits: permBits(keep), dropped };
}
/* 失敗の文を日本語で（原因と直し方つき）。トークンは絶対に出さない。 */
export function errJa(method, pathname, status, text) {
  let code = 0, msg = "";
  try {
    const j = JSON.parse(String(text || ""));
    code = Number(j.code || 0); msg = String(j.message || "");
  } catch (e) { msg = ""; }
  const head = method + " " + pathname + " → HTTP " + status
    + (code ? "（" + code + " " + msg + "）" : (msg ? "（" + msg + "）" : ""));
  const tip = [];
  if (code === 50001) {
    tip.push("原因：そのチャンネルをボットが見られません。");
    tip.push("直し方：チャンネルの権限で、ボットのロールに"
      + "「チャンネルを見る」を付けてください。");
  } else if (code === 50013 || status === 403) {
    tip.push("原因：ボットの権限が足りないか、"
      + "相手のロールがボットのロールより上にあります。");
    tip.push("Discord の決まり：①自分が持っていない権限は付けられない"
      + " ②自分のロールより上のロールは直せない・動かせない。");
    tip.push("直し方：サーバー設定→ロールで、ボットのロール（連携のロール）を"
      + "いちばん上に動かしてください。"
      + "足りない権限は下の「手でやってほしいこと」に出します。"
      + "管理者（ADMINISTRATOR）はボットには付けません（人が手で付けます）。");
  } else if (code === 10011) {
    tip.push("原因：ロールが見つかりません（手で消された可能性）。");
    tip.push("直し方：discord/ids.json を消して、もう一度実行してください。");
  } else if (code === 50035) {
    tip.push("原因：送った内容の形が違います（設定 JSON の書き方）。");
    tip.push("直し方：discord/server.config.json を見直してください。");
  } else if (status === 401) {
    tip.push("原因：トークンが違う・期限切れです。");
    tip.push("直し方：Developer Portal で Reset Token し、"
      + "$env:DISCORD_BOT_TOKEN に入れ直してください。");
  } else if (status === 404) {
    tip.push("原因：サーバーID が違う、"
      + "またはボットがそのサーバーに居ません。");
    tip.push("直し方：README の招待 URL でボットを入れ、"
      + "$env:DISCORD_GUILD_ID を確かめてください。");
  }
  return head + (tip.length ? "\n  " + tip.join("\n  ") : "");
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
/* 配信ボットが書けるチャンネルでは、ピン留めと貼り直しもできるように（8.8）。
   8.14：ピン留めは専用の権限（PIN_MESSAGES）になったので、それも足す。 */
const BOTX = ["MANAGE_MESSAGES", "PIN_MESSAGES"];
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
   ids … { roleKey: roleId } と { "@everyone": guildId }。
   botBits … ボットが持っている権限（8.7。渡すと、持っていない権限は書かない）
   drop … 書けなかった権限の名前をためる配列（省略可） */
export function overwritesFor(ch, cfg, ids, botBits, drop) {
  const view = expandKeys(ch.view, cfg);
  const send = expandKeys(ch.send, cfg);
  const rows = [];
  const put = (id, allow, deny) => {
    if (!id) return;
    /* ボットが持っていない権限は allow にも deny にも書けない（50013）。 */
    const a = maskPerms(allow, botBits), d = maskPerms(deny, botBits);
    if (drop) for (const n of a.dropped.concat(d.dropped))
      if (drop.indexOf(n) < 0) drop.push(n);
    rows.push({ id: String(id), type: 0,
                allow: a.bits.toString(), deny: d.bits.toString() });
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
    if (canWrite && key === (cfg.selfRole || "bot"))
      allow.push.apply(allow, BOTX);
    if (canWrite && ch.threads) allow.push.apply(allow, THREAD);
    const deny = canWrite ? [] : WRITE.concat(THREAD);
    put(id, allow, deny);
  }
  return rows;
}
/* ---- そのチャンネルでボットに何ができるか（8.8）----
   Discord の計算と同じ順で出す：
     サーバー全体の権限 → @everyone の overwrite → 自分のロールの overwrite
   rows … permission_overwrites、roleIds … ボットのロール（これから付けるぶんも）
   base … ボットのサーバー全体の権限、guild … @everyone の id（サーバーID） */
export function chanPerms(rows, roleIds, base, guild) {
  let v = BigInt(base || 0);
  if ((v & PERM.ADMINISTRATOR) === PERM.ADMINISTRATOR) return v;
  const mine = (roleIds || []).map(String);
  const ev = (rows || []).filter((x) => String(x.id) === String(guild))[0];
  if (ev) { v &= ~BigInt(ev.deny || "0"); v |= BigInt(ev.allow || "0"); }
  let allow = 0n, deny = 0n;
  for (const x of rows || []) {
    if (String(x.id) === String(guild)) continue;
    if (mine.indexOf(String(x.id)) < 0) continue;
    allow |= BigInt(x.allow || "0"); deny |= BigInt(x.deny || "0");
  }
  v &= ~deny; v |= allow;
  return v;
}
/* 書けるか（見られて・送れる）。need に権限名を足すと、それも要る。 */
export function canWriteCh(rows, roleIds, base, guild, need) {
  const v = chanPerms(rows, roleIds, base, guild);
  if ((v & PERM.ADMINISTRATOR) === PERM.ADMINISTRATOR) return true;
  const want = ["VIEW_CHANNEL", "SEND_MESSAGES"].concat(need || []);
  for (const n of want) if ((v & PERM[n]) !== PERM[n]) return false;
  return true;
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
        /* トークンは**絶対に出さない**（本文だけ出す）。
           原因と直し方を日本語で付ける（8.7）。 */
        throw new Error(errJa(method, pathname, res.status,
          String(text || "").slice(0, 400)));
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
    /* 8.9：テスト配信の投稿を消す（--delete）。 */
    msgDel: (ch, id) => call("DELETE", "/channels/" + ch + "/messages/" + id),
    pins: (id) => call("GET", "/channels/" + id + "/pins"),
    pinAdd: (ch, id) => call("PUT", "/channels/" + ch + "/pins/" + id),
    me: () => call("GET", "/users/@me"),
    /* ボット自身のロール（特権インテントは要らない）。 */
    member: (g, uid) => call("GET", "/guilds/" + g + "/members/" + uid),
    /* ボット自身（や人）にロールを付ける（8.8）。 */
    memberRoleAdd: (g, uid, rid) =>
      call("PUT", "/guilds/" + g + "/members/" + uid + "/roles/" + rid),
  };
}

/* ---- ボット自身の権限と位置（8.7）----
   perms   … ボットが持っている権限（@everyone ＋ 自分のロールぜんぶ）
   top     … ボットのロールのいちばん上の position（数字が大きいほど上）
   unknown … 読めなかった（このときは権限を絞らずに進む） */
export async function botState(api, guild, have) {
  const st = { id: "", perms: 0n, admin: false, top: 0, topName: "",
               roleIds: [], unknown: false, why: "" };
  try {
    const me = await api.me();
    st.id = String((me && me.id) || "");
    if (!st.id) throw new Error("ボットの ID が取れません");
    const mem = await api.member(guild, st.id);
    const mine = (((mem && mem.roles) || [])).map(String);
    st.roleIds = mine.slice();
    let bits = 0n, top = -1, topName = "";
    for (const r of have || []) {
      const every = String(r.id) === String(guild)
        || String(r.name) === "@everyone";
      if (!every && mine.indexOf(String(r.id)) < 0) continue;
      bits |= BigInt(String(r.permissions || "0"));
      if (!every && Number(r.position || 0) > top) {
        top = Number(r.position || 0); topName = String(r.name || "");
      }
    }
    st.perms = bits;
    st.admin = (bits & PERM.ADMINISTRATOR) === PERM.ADMINISTRATOR;
    st.top = top < 0 ? 0 : top;
    st.topName = topName;
    if (top < 0) st.why = "ボットにロールが付いていません";
  } catch (e) {
    st.unknown = true;
    st.why = String((e && e.message) || e);
  }
  return st;
}

/* ロール一覧の中で、ボットのロールのいちばん上（position）を探す。 */
export function botTopOf(roles, roleIds) {
  let top = -1, name = "";
  for (const r of roles || []) {
    if ((roleIds || []).indexOf(String(r.id)) < 0) continue;
    if (Number(r.position || 0) > top) {
      top = Number(r.position || 0); name = String(r.name || "");
    }
  }
  return { top: top < 0 ? 0 : top, name };
}

/* ================= 本体 ================= */
export async function setup(opt) {
  const o = opt || {};
  const cfg = o.config;
  const api = o.api;
  const guild = String(o.guild || "");
  const dry = !!o.dryRun;
  const log = o.log || (() => {});
  /* manual … 手でやってほしいこと（8.7）／fails … 失敗したが止めなかったこと */
  const plan = { roles: [], channels: [], posts: [], extra: [],
                 manual: [], fails: [], bot: null, ids: {} };
  if (!cfg) throw new Error("設定（server.config.json）がありません");
  if (!guild) throw new Error("サーバーID（DISCORD_GUILD_ID）がありません");

  /* ---- ロール ---- */
  const have = await api.roles(guild);
  const byName = {};
  for (const r of have || []) byName[String(r.name)] = r;
  const ids = { "@everyone": guild };
  /* ボット自身の権限と位置を先に調べる（8.7）。
     --dry-run でも調べるので、問題は実行前に分かる。 */
  const bot = await botState(api, guild, have);
  plan.bot = bot;
  const botBits = bot.unknown ? undefined : bot.perms;
  const bb = bot.unknown ? null : BigInt(bot.perms);
  if (bot.unknown) {
    plan.manual.push({ kind: "確認", name: "ボットの権限が読めません",
      how: "原因：" + bot.why
        + "／このまま進めますが、途中で 50013（権限不足）で"
        + "止まるかもしれません。" });
    log("ボットの権限が読めませんでした：" + bot.why);
  } else {
    log("ボット：ロール「" + (bot.topName || "（ロールなし）")
      + "」position=" + bot.top + "（数字が大きいほど上）／持っている権限 "
      + (bot.admin ? "管理者（ぜんぶ）"
                   : permNames(bot.perms).length + "個"));
    if (!bot.topName)
      plan.manual.push({ kind: "確認", name: "ボットにロールがありません",
        how: "README の招待 URL でボットを入れ直してください"
          + "（連携のロールが作られます）。" });
  }

  /* 設定の並び（上から強い）を Discord の position に直す。
     @everyone が 0 なので、いちばん弱いロールが 1。 */
  const wanted = cfg.roles || [];
  const aboveBot = [];   /* ボットより上に手で置くロール（管理者など） */
  for (let i = 0; i < wanted.length; i++) {
    const w = wanted[i];
    /* ボットが持っていない権限は**付けずに**作る（8.7）。 */
    const m = maskPerms(w.permissions, botBits);
    const base = { name: w.name, color: colorNum(w.color),
                   hoist: !!w.hoist, mentionable: !!w.mentionable };
    const old = byName[w.name];
    /* **すでに手で付いている**権限は、もう頼まない。 */
    const has0 = old ? BigInt(String(old.permissions || "0")) : 0n;
    const need = m.dropped.filter((n) => (has0 & PERM[n]) !== PERM[n]);
    if (need.length)
      plan.manual.push({ kind: "権限", name: w.name, items: need.slice(),
        how: "サーバー設定→ロール→「" + w.name + "」で "
          + need.map(permJa).join("・")
          + " を手で付けてください（ボットが持っていない権限は"
          + "ボットからは付けられません）。" });
    /* 管理者はボットに持たせないので、並びも手で上に置いてもらう。 */
    if (m.dropped.indexOf("ADMINISTRATOR") >= 0) aboveBot.push(w.name);
    if (!old) {
      plan.roles.push({ act: "add", name: w.name,
        why: "ありません" + (m.dropped.length
          ? "・権限" + m.dropped.length + "個は手で" : "") });
      if (!dry) {
        try {
          const made = await api.roleAdd(guild,
            Object.assign({}, base, { permissions: m.bits.toString() }));
          ids[w.key] = String((made && made.id) || "");
        } catch (e) {
          /* 止めない。できなかったことだけ残して次へ進む。 */
          ids[w.key] = "";
          const msg = String((e && e.message) || e);
          plan.fails.push({ what: "ロールを作る（" + w.name + "）", msg });
          log("ロールを作れませんでした（" + w.name + "）：" + msg);
          plan.manual.push({ kind: "作る", name: w.name,
            how: "サーバー設定→ロールで「" + w.name + "」を手で作ってください。" });
        }
      } else ids[w.key] = "(新:" + w.key + ")";
      continue;
    }
    ids[w.key] = String(old.id);
    /* ボットが触れない権限は、今の値をそのまま残す（勝手に外さない）。 */
    const oldBits = BigInt(String(old.permissions || "0"));
    const keepBits = (bb === null || bot.admin) ? 0n : (oldBits & ~bb);
    const effBits = m.bits | keepBits;
    const diff = [];
    if (oldBits !== effBits) diff.push("権限");
    if (Number(old.color || 0) !== base.color) diff.push("色");
    if (!!old.hoist !== base.hoist) diff.push("別に表示");
    if (!!old.mentionable !== base.mentionable) diff.push("メンション");
    /* ボットのロールより上のロールは直せない（8.7 ②）。 */
    const higher = !bot.unknown && !bot.admin
      && Number(old.position || 0) >= bot.top;
    if (diff.length && higher) {
      plan.manual.push({ kind: "直す", name: w.name,
        how: "「" + w.name + "」はボットのロール「" + (bot.topName || "？")
          + "」より上にあるので、ボットからは直せません（" + diff.join("・")
          + "）。サーバー設定→ロールで手で直すか、"
          + "ボットのロールをいちばん上に動かしてください。" });
      continue;
    }
    if (diff.length) {
      plan.roles.push({ act: "fix", name: w.name, why: diff.join("・") });
      if (!dry) {
        try {
          await api.roleEdit(guild, old.id,
            Object.assign({}, base, { permissions: effBits.toString() }));
        } catch (e) {
          const msg = String((e && e.message) || e);
          plan.fails.push({ what: "ロールを直す（" + w.name + "）", msg });
          log("ロールを直せませんでした（" + w.name + "）：" + msg);
          plan.manual.push({ kind: "直す", name: w.name,
            how: "サーバー設定→ロールで「" + w.name + "」の "
              + diff.join("・") + " を手で直してください。" });
        }
      }
    }
  }

  /* ---- 並び順（上から強い）----
     ボットは**自分のロールより上には並べ替えられない**（8.7 ②）。
     上に置くべきロール（管理者）は手でお願いし、残りだけを並べる。
     **すでにその順なら送らない**（もう一度実行したときに「変更なし」に）。 */
  const rank = [];   /* 弱い順（下から） */
  for (let i = wanted.length - 1; i >= 0; i--) {
    const w = wanted[i];
    const id = ids[w.key];
    if (!id) continue;
    if (aboveBot.indexOf(w.name) >= 0) continue;
    rank.push({ key: w.key, name: w.name, id: String(id) });
  }
  /* ロールを作ると、Discord は**いちばん下（position=1）に入れて**
     ほかを1つずつ上に押し上げる。そのため並べ替えの判断は
     「作ったあと」の position で行う（取り直せないときは足し算で見積もる）。 */
  let nowRoles = have || [];
  let botTop = bot.top;
  let botTopName = bot.topName;
  const newCount = plan.roles.filter((x) => x.act === "add").length;
  if (!dry && newCount) {
    try {
      const again = await api.roles(guild);
      if (again && again.length) {
        nowRoles = again;
        const t = botTopOf(again, bot.roleIds);
        if (t.top) { botTop = t.top; botTopName = t.name || botTopName; }
      }
    } catch (e) { botTop = bot.top + newCount; }
  } else if (newCount) botTop = bot.top + newCount;
  const chain = wanted.map((x) => x.name).join(" ＞ ");
  for (const n of aboveBot) {
    /* **すでにボットより上にある**なら、もう頼まない。 */
    const w = wanted.filter((x) => x.name === n)[0] || {};
    const id = String(ids[w.key] || "");
    const cur = (nowRoles || []).filter((r) => String(r.id) === id)[0];
    if (cur && botTop && Number(cur.position || 0) > botTop) continue;
    plan.manual.push({ kind: "並び", name: n,
      how: "サーバー設定→ロールで「" + n + "」を、ボットのロール「"
        + (botTopName || "（連携のロール）") + "」より**上**に手で動かして"
        + "ください（上から " + chain + " の順）。"
        + "ボットは自分より上には並べ替えられません。" });
  }
  /* position は 1 から。ボットの position 未満に収まらないと動かせない。 */
  const order = [];
  for (let i = 0; i < rank.length; i++)
    order.push({ id: rank[i].id, position: i + 1 });
  const fit = (bot.unknown || bot.admin || !bot.topName)
    || rank.length < botTop;
  if (!fit && rank.length)
    plan.manual.push({ kind: "並び", name: "並び順",
      how: "ボットのロール「" + (botTopName || "？") + "」が下のほうにある"
        + "ため（position=" + botTop + "）、" + rank.length
        + "個のロールを並べ替えられません。サーバー設定→ロールで"
        + "ボットのロールをいちばん上に動かして、もう一度実行してください。" });
  const posNow = {};
  for (const r of nowRoles || []) posNow[String(r.id)] = Number(r.position || 0);
  let okOrder = true;
  for (let i = 1; i < order.length; i++) {
    const a = posNow[order[i].id], b = posNow[order[i - 1].id];
    if (a === undefined || b === undefined || !(a > b)) { okOrder = false; break; }
  }
  if (order.length && !okOrder) {
    plan.roles.push({ act: "order", name: "並び順",
      why: rank.map((x) => x.name).reverse().join(" ＞ ")
        + (aboveBot.length ? "（" + aboveBot.join("・") + " は手で）" : "") });
    if (!dry && fit) {
      let done = true;
      try { await api.roleOrder(guild, order); }
      catch (e) {
        done = false;
        const msg = String((e && e.message) || e);
        plan.fails.push({ what: "並べ替え（まとめて）", msg });
        log("並べ替えをまとめて送れませんでした。1つずつ試します：" + msg);
      }
      if (!done) {
        /* 1つずつ（弱いほうから）。できたものだけ並び、
           できなかったものは「手で」に回す。**ここで止めない**。 */
        const bad = [];
        for (const row of order) {
          try { await api.roleOrder(guild, [row]); }
          catch (e2) {
            const nm = (rank.filter((x) => x.id === row.id)[0] || {}).name
              || String(row.id);
            bad.push(nm);
            plan.fails.push({ what: "並べ替え（" + nm + "）",
                              msg: String((e2 && e2.message) || e2) });
          }
        }
        if (bad.length)
          plan.manual.push({ kind: "並び", name: bad.join("・"),
            how: "このロールはボットから動かせませんでした。"
              + "サーバー設定→ロールで、上から " + chain
              + " の順に手で並べてください"
              + "（ボットのロールより上のロールは動かせません）。" });
      }
    }
  }

  /* ---- ボット自身に「配信ボット」のロールを付ける（8.8）----
     案内やリストのチャンネルは「配信ボット」が書ける設定なので、
     ボット自身にこのロールが付いていないと投稿できない。
     連携のロール（刈り取り配信）より下なので、ボットから付けられる。 */
  const botRoles = (bot.roleIds || []).map(String);
  const selfKey = cfg.selfRole || "bot";
  const selfId = String(ids[selfKey] || "");
  const selfName = ((cfg.roles || []).filter((x) => x.key === selfKey)[0]
    || {}).name || selfKey;
  if (selfId && botRoles.indexOf(selfId) < 0) {
    if (bot.unknown || !bot.id) {
      plan.manual.push({ kind: "ロール付け", name: selfName,
        how: "ボット自身に「" + selfName + "」のロールを手で付けてください"
          + "（サーバー設定→メンバー、またはメンバー一覧で右クリック→ロール）。"
          + "これが無いと案内やリストのチャンネルに投稿できません。" });
    } else {
      plan.roles.push({ act: "grant", name: selfName,
                        why: "ボット自身に付ける" });
      if (!dry) {
        try {
          await api.memberRoleAdd(guild, bot.id, selfId);
          botRoles.push(selfId);
        } catch (e) {
          const msg = String((e && e.message) || e);
          plan.fails.push({ what: "ボットに「" + selfName + "」を付ける", msg });
          log("ボットにロールを付けられませんでした：" + msg);
          plan.manual.push({ kind: "ロール付け", name: selfName,
            how: "ボット自身に「" + selfName + "」のロールを手で付けてください"
              + "（メンバー一覧でボットを選び、ロールを足す）。"
              + "これが無いと案内やリストのチャンネルに投稿できません。" });
        }
      } else botRoles.push(selfId);
    }
  }

  /* ---- カテゴリとチャンネル ---- */
  const chs = (await api.channels(guild)) || [];
  const catByName = {}, chByName = {};
  for (const c of chs) {
    if (Number(c.type) === 4) catByName[String(c.name)] = c;
    else chByName[String(c.name)] = c;
  }
  const used = {};
  const ovDrop = [];   /* チャンネルの権限に書けなかった権限（8.7） */
  const noWrite = [], noPin = [];   /* ボットが書けない・ピン留めできない（8.8） */
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
        try {
          const made = await api.chAdd(guild,
            { name: cat.name, type: 4, position: pos++ });
          catId = String((made && made.id) || "");
        } catch (e) {
          catId = "";
          const msg = String((e && e.message) || e);
          plan.fails.push({ what: "カテゴリを作る（" + cat.name + "）", msg });
          log("カテゴリを作れませんでした（" + cat.name + "）：" + msg);
        }
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
                     permission_overwrites:
                       overwritesFor(ch, cfg, ids, botBits, ovDrop) };
      /* ボットが書くはずのチャンネルで、本当に書けるか先に確かめる（8.8）。
         --dry-run でも同じように調べるので、実行する前に分かる。 */
      const wantsBot = expandKeys(ch.send, cfg).indexOf(selfKey) >= 0
        || !!ch.post;
      if (wantsBot && !bot.unknown) {
        const rows = want.permission_overwrites;
        if (!canWriteCh(rows, botRoles, bot.perms, guild)) noWrite.push(ch.name);
        else if (ch.pin && !canWriteCh(rows, botRoles, bot.perms, guild,
                                       PIN_PERMS)) noPin.push(ch.name);
      }
      const cur = chByName[ch.name];
      if (!cur) {
        plan.channels.push({ act: "add", name: ch.name, kind: "チャンネル",
                             cat: cat.name });
        if (!dry) {
          try {
            const made = await api.chAdd(guild, want);
            plan.ids["ch:" + ch.key] = String((made && made.id) || "");
            if (ch.post) plan.posts.push({ key: ch.key, name: ch.name,
              id: String((made && made.id) || ""), pin: !!ch.pin });
          } catch (e) {
            const msg = String((e && e.message) || e);
            plan.fails.push({ what: "チャンネルを作る（" + ch.name + "）", msg });
            log("チャンネルを作れませんでした（" + ch.name + "）：" + msg);
            plan.manual.push({ kind: "作る", name: ch.name,
              how: "「" + cat.name + "」の中に #" + ch.name
                + " を手で作ってください。" });
          }
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
        if (!dry) {
          try { await api.chEdit(cur.id, want); }
          catch (e) {
            const msg = String((e && e.message) || e);
            plan.fails.push({ what: "チャンネルを直す（" + ch.name + "）", msg });
            log("チャンネルを直せませんでした（" + ch.name + "）：" + msg);
            plan.manual.push({ kind: "直す", name: ch.name,
              how: "#" + ch.name + " の " + diff.join("・")
                + " を手で直してください。" });
          }
        }
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
  /* ボットが書けないチャンネル（8.8）。 */
  if (noWrite.length)
    plan.manual.push({ kind: "書けない", name: noWrite.join("・"),
      items: noWrite.slice(),
      how: "このチャンネルはボット（" + (bot.topName || "ボットのロール")
        + "・" + selfName + "）が書き込めません。"
        + "原因：チャンネルの権限で @everyone の「メッセージを送信」が止められ、"
        + "ボットのロールに許可が無いためです（投稿すると 403 / 50013）。"
        + "直し方：チャンネルの権限で「" + selfName
        + "」に「チャンネルを見る」「メッセージを送信」を許可してください"
        + "（discord/server.config.json の send に \"bot\" を足して"
        + "もう一度実行すると自動で直ります）。" });
  if (noPin.length)
    plan.manual.push({ kind: "ピン留め", name: noPin.join("・"),
      items: noPin.slice(),
      how: "このチャンネルはボットがピン留めできません"
        + "（「メッセージの管理」が要ります）。チャンネルの権限で「"
        + selfName + "」に「メッセージの管理」を許可してください。" });

  /* チャンネルの権限に書けなかった権限（ボットが持っていないもの）。 */
  if (ovDrop.length)
    plan.manual.push({ kind: "権限", name: "ボット自身", items: ovDrop.slice(),
      how: "チャンネルの見せ分けに " + ovDrop.map(permJa).join("・")
        + " が要りますが、ボットが持っていないので設定できませんでした"
        + "（読むだけのチャンネルでリアクションやスレッドを止められません）。"
        + "README の招待 URL でボットを入れ直すか、サーバー設定→ロールで"
        + "ボットのロールに付けて、もう一度実行してください。" });

  /* ---- 案内文を投稿してピン留め ----
     並び替えや権限で失敗していても**ここまで必ず進む**（8.7）。 */
  for (const p of plan.posts) {
    const ch = findChannel(cfg, p.key);
    const body = { content: (ch.post || []).join("\n").slice(0, 1900) };
    if (dry || !p.id || p.id === "(新)") continue;
    let made = null;
    try { made = await api.msgAdd(p.id, body); }
    catch (e) {
      const msg = String((e && e.message) || e);
      plan.fails.push({ what: "案内文を投稿（" + p.name + "）", msg });
      log("案内文を投稿できませんでした（" + p.name + "）：" + msg);
      /* 「手でやってほしいこと」にも必ず出す（8.8）。 */
      plan.manual.push({ kind: "投稿", name: p.name,
        how: "#" + p.name + " に案内文を投稿できませんでした"
          + "（ボットが書けない設定です）。チャンネルの権限で「" + selfName
          + "」に「チャンネルを見る」「メッセージを送信」"
          + (p.pin ? "「メッセージの管理」と「メッセージをピン留め」" : "")
          + "を許可して、もう一度実行してください。"
          + "急ぐときは server.config.json の post の文を手で貼っても構いません。" });
      continue;
    }
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
  show("ロール", plan.roles, (x) => ({ add: "作る", fix: "直す",
    order: "並べる", grant: "付ける" })[x.act]
    + " " + x.name + (x.why ? "（" + x.why + "）" : ""));
  show("チャンネル", plan.channels, (x) => (x.act === "add" ? "作る" : "直す")
    + " " + x.kind + " " + x.name + (x.cat ? "（" + x.cat + "）" : "")
    + (x.why ? "（" + x.why + "）" : ""));
  show("案内文の投稿", plan.posts, (x) => x.name + (x.pin ? "（ピン留め）" : ""));
  show("設定にないもの（消していません）", plan.extra,
    (x) => x.kind + " " + x.name);
  /* ボットの権限と位置（8.7）。--dry-run でも出す。 */
  const bot = plan.bot;
  if (bot) {
    t.push("");
    t.push("ボットの権限：" + (bot.unknown ? "読めませんでした（" + bot.why + "）"
      : (bot.admin ? "管理者（ぜんぶ）"
        : permNames(bot.perms).map(permJa).join("・") || "なし")));
    if (!bot.unknown)
      t.push("ボットのロール：" + (bot.topName || "（ありません）")
        + "（position=" + bot.top + "・数字が大きいほど上）");
  }
  /* 手でやってほしいこと（原因と直し方つき）。 */
  show("手でやってほしいこと", plan.manual || [],
    (x) => "［" + x.kind + "］" + x.name + "\n      " + x.how);
  /* 失敗したが、止めずに進めたこと。 */
  show("できなかったこと（止めずに進めました）", plan.fails || [],
    (x) => x.what + "\n      " + String(x.msg || "").replace(/\n/g, "\n    "));
  if ((plan.manual || []).length)
    t.push("\n※ 上の「手でやってほしいこと」を済ませてから、"
      + "もう一度このコマンドを実行してください（二重に作りません）。");
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
  /* 手でやってほしいことが残っていても**失敗（1）にはしない**
     （チャンネルと案内文まで進んでいるので）。 */
  if ((plan.manual || []).length)
    console.log("※ 手でやってほしいこと：" + plan.manual.length + "件");
  if ((plan.fails || []).length)
    console.log("※ できなかったこと：" + plan.fails.length + "件"
      + "（上の原因と直し方を見てください）");
  return 0;
}
/* 直に実行されたときだけ動かす（テストから読み込んでも動かない）。 */
if (process.argv[1] && /setup-discord\.mjs$/.test(process.argv[1])) {
  main(process.argv.slice(2), process.env)
    .then((c) => process.exit(c))
    .catch((e) => { console.error("失敗：" + (e && e.message)); process.exit(1); });
}
