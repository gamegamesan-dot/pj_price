#!/usr/bin/env node
/* D1 のマイグレーションを「1文ずつ --command」で流す道具（7.87／7.88）

   なぜ要るか：
     `wrangler d1 execute --remote --file=…` は D1 の **import の API** を使う。
     ここだけスコープが足りず「/import failed: Authentication error [code: 10000]」で
     落ちることがある（--command で使う query の API は通るのに）。
     この道具は **--file をまったく使わず**、SQL を1文ずつ --command で流す。

   使い方（proxy-sync で）:
     node d1-exec.mjs migrate-0031-jan-dup-fees.sql            # 流す
     node d1-exec.mjs migrate-0031-jan-dup-fees.sql --dry-run  # 文だけ見る
     node d1-exec.mjs migrate-0031-jan-dup-fees.sql --local    # 手元のDBに流す
     node d1-exec.mjs migrate-0031-jan-dup-fees.sql --debug    # 起動する中身も出す
     node d1-exec.mjs … --db pj-sync --wrangler <wrangler.js のパス>

   ALTER TABLE … ADD COLUMN は2回流せないので、
   「すでに同じ列がある」「すでにある」で落ちた文は **済み** として飛ばす。
   そのため途中で失敗しても、そのまま流し直せる。 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ---- SQL を1文ずつに分ける ----
   ・-- から行末までのコメントを落とす（文字列の中の -- は落とさない）
   ・';' で区切る。'…' の中の ';' は区切りにしない
   ・各文は1行に詰める（起動のときの引用符の事故を避ける） */
export function splitSql(src) {
  const out = [];
  let cur = "", q = false;              // q: 文字列（'…'）の中か
  const s = String(src || "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === "'") {
        if (s[i + 1] === "'") { cur += s[++i]; continue; }   // '' は文字としての '
        q = false;
      }
      continue;
    }
    if (c === "'") { q = true; cur += c; continue; }
    if (c === "-" && s[i + 1] === "-") {            // 行コメント
      while (i < s.length && s[i] !== "\n") i++;
      cur += "\n";
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {            // ブロックコメント
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i++;
      cur += " ";
      continue;
    }
    if (c === ";") { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/* もう当たっている（＝済み）とみなすエラー。 */
export const DONE_RE = /duplicate column name|already exists|already an index/i;

/* ---- wrangler の起動の仕方を決める（7.88）----
   **Windows の落とし穴**：Node は `.cmd` / `.bat` を shell なしでは起動できない
   （CVE-2024-27980 の対策。Node 18.20.2／20.12.2／21.7.3 以降）。
   `spawnSync("npx.cmd", …)` は **EINVAL** になり、status も stdout も null に
   なるので「理由が何も出ない」状態になっていた。

   そこで **wrangler の中身（JS）を node で直に動かす**。.cmd を通らないので
   shell も引用符も要らず、Windows でも Mac でも同じ動きになる。
   見つからないときだけ、最後の手段として shell 経由にする。 */
export function findWrangler(from) {
  const tries = [];
  /* 1) require で解く（proxy-sync か、その上に入れてあれば当たる） */
  try {
    const req = createRequire(path.join(from, "x.js"));
    const pkg = req.resolve("wrangler/package.json");
    const dir = path.dirname(pkg);
    for (const rel of ["bin/wrangler.js", "wrangler-dist/cli.js"]) {
      const p = path.join(dir, rel);
      tries.push(p);
      if (existsSync(p)) return { kind: "node", path: p, tries };
    }
  } catch (e) { /* 入っていなければ次へ */ }
  /* 2) 上の階層の node_modules を順に見る */
  let d = path.resolve(from);
  for (let i = 0; i < 8; i++) {
    const p = path.join(d, "node_modules", "wrangler", "bin", "wrangler.js");
    tries.push(p);
    if (existsSync(p)) return { kind: "node", path: p, tries };
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return { kind: "shell", path: "", tries };
}

/* shell 経由のときは、**引数を自分で囲まないと壊れる**
   （shell:true のとき Node は引数をつないで渡すだけで、囲んではくれない）。
   Windows の cmd は " を2つ重ねて表す。**%…% は囲んでも中身が展開される**ので、
   % が入っている文は断る（winUnsafe）。 */
export function winUnsafe(stmt) {
  return process.platform === "win32" && String(stmt).indexOf("%") >= 0;
}
export function shQuote(v, win) {
  const s = String(v);
  if (win) return '"' + s.replace(/"/g, '""') + '"';
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/* 1文を流す。exec を渡せばそれを使う（テスト用）。 */
export function makeExec(how, db, local, debug) {
  return function exec(stmt) {
    const wargs = ["d1", "execute", db, local ? "--local" : "--remote",
                   "--command", stmt];
    let file, args, opt = { encoding: "utf8", windowsHide: true };
    if (how.kind === "node") {
      file = process.execPath;                 // いま動いている node
      args = [how.path, ...wargs];
    } else {
      /* 最後の手段。.cmd を通すので shell が要る。
         shell:true のときは Node が囲んでくれないので、自分で囲む。 */
      const win = process.platform === "win32";
      file = win ? "npx.cmd" : "npx";
      args = ["--yes", "wrangler", ...wargs].map((x) => shQuote(x, win));
      opt.shell = true;
    }
    if (debug) console.log("    起動: " + file + " " + JSON.stringify(args));
    const r = spawnSync(file, args, opt);
    return { status: r.status, signal: r.signal, error: r.error,
             stdout: r.stdout == null ? "" : String(r.stdout),
             stderr: r.stderr == null ? "" : String(r.stderr),
             file: file, args: args };
  };
}

/* ---- 本体 ---- */
export function runFile(file, opt) {
  const o = opt || {};
  const log = o.log || console.log;
  const stmts = splitSql(readFileSync(path.resolve(file), "utf8"));
  log(path.basename(file) + "：" + stmts.length + "文");
  if (o.dry) {
    stmts.forEach((x, i) => log("  " + (i + 1) + ". " + x));
    return { ok: true, ran: 0, done: 0, dry: true };
  }
  const how = o.how || findWrangler(o.from || process.cwd());
  if (how.kind === "node") log("wrangler: " + how.path + "（node で直に動かす）");
  else log("wrangler: npx 経由（shell）。"
    + "node_modules に wrangler が無いので、こちらを使います。\n"
    + "  うまく動かないときは proxy-sync で `npm i -D wrangler` を1回だけ"
    + "流してください（以降は node で直に動かせます）。");
  const exec = o.exec || makeExec(how, o.db || "pj-sync", !!o.local, !!o.debug);
  let ran = 0, done = 0;
  for (let i = 0; i < stmts.length; i++) {
    const n = (i + 1) + "/" + stmts.length;
    const head = stmts[i].slice(0, 70);
    if (how.kind === "shell" && winUnsafe(stmts[i])) {
      log("  ❌ " + n + " " + head);
      log("    この文には % が入っています。Windows の cmd は囲んでも %…% を"
        + "展開してしまうので、shell 経由では流せません。");
      log("    proxy-sync で `npm i -D wrangler` を1回流してから、"
        + "もう一度この命令を流してください。");
      return { ok: false, ran, done, at: i + 1 };
    }
    const r = exec(stmts[i]);
    const out = (r.stdout || "") + (r.stderr || "");
    if (r.status === 0) { ran++; log("  ✅ " + n + " " + head); continue; }
    if (DONE_RE.test(out)) { done++; log("  ⏭ " + n + " 済み " + head); continue; }
    /* ---- 失敗したら、分かることを全部出す（7.88）---- */
    log("  ❌ " + n + " " + head);
    log("    終了コード: " + (r.status === null || r.status === undefined
      ? "なし" : r.status)
      + (r.signal ? ("／signal " + r.signal) : ""));
    if (r.error) {
      log("    起動そのものに失敗: " + (r.error.code || "")
        + " " + (r.error.message || String(r.error)));
      if (String(r.error.code) === "EINVAL")
        log("    （Windows の Node は .cmd を shell なしで起動できません。"
          + "proxy-sync で `npm i -D wrangler` を1回流すと直ります）");
      if (String(r.error.code) === "ENOENT")
        log("    （" + r.file + " が見つかりません。Node と npm が入っているか"
          + "確かめてください）");
    }
    log("    起動した中身: " + r.file + " " + JSON.stringify(r.args));
    if ((r.stdout || "").trim()) log("    --- stdout ---\n" + r.stdout.trim());
    if ((r.stderr || "").trim()) log("    --- stderr ---\n" + r.stderr.trim());
    if (!(r.stdout || "").trim() && !(r.stderr || "").trim() && !r.error)
      log("    wrangler は何も出力しませんでした。--debug を付けて"
        + "もう一度試してください。");
    log("\nここで止めました。直してから、もう一度同じ命令を流してください"
      + "（済んだ文は飛ばします）。");
    return { ok: false, ran, done, at: i + 1 };
  }
  log("できました：流した " + ran + "文／すでに済み " + done + "文");
  return { ok: true, ran, done };
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("-")
    && args[args.indexOf(a) - 1] !== "--db"
    && args[args.indexOf(a) - 1] !== "--wrangler");
  if (!file) {
    console.error("使い方: node d1-exec.mjs <file.sql> "
      + "[--dry-run] [--local] [--debug] [--db 名前] [--wrangler パス]");
    process.exit(2);
  }
  const at = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ""; };
  const w = at("--wrangler");
  const r = runFile(file, {
    dry: args.includes("--dry-run"), local: args.includes("--local"),
    debug: args.includes("--debug"), db: at("--db") || "pj-sync",
    from: path.dirname(path.resolve(file)),
    how: w ? { kind: "node", path: path.resolve(w), tries: [] } : null,
  });
  if (!r.ok) process.exit(1);
}
if (process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)))
  main();
