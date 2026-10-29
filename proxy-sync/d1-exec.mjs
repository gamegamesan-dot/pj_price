#!/usr/bin/env node
/* D1 のマイグレーションを「1文ずつ --command」で流す道具（7.87）

   なぜ要るか：
     `wrangler d1 execute --remote --file=…` は D1 の **import の API** を使う。
     ここだけスコープが足りず、「/import failed: Authentication error [code: 10000]」で
     落ちることがある（--command で使う query の API は通るのに）。
     この道具は **--file をまったく使わず**、SQL を1文ずつ --command で流す。

   使い方（proxy-sync で）:
     node d1-exec.mjs migrate-0031-jan-dup-fees.sql            # 流す
     node d1-exec.mjs migrate-0031-jan-dup-fees.sql --dry-run  # 文だけ見る
     node d1-exec.mjs migrate-0031-jan-dup-fees.sql --local    # 手元のDBに流す
     node d1-exec.mjs migrate-0031-jan-dup-fees.sql --db pj-sync

   ALTER TABLE … ADD COLUMN は2回流せないので、
   「すでに同じ列がある」「すでにある」で落ちた文は **済み** として飛ばす。
   そのため途中で失敗しても、そのまま流し直せる。 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* SQL を1文ずつに分ける。
   ・-- から行末までのコメントを落とす（文字列の中の -- は落とさない）
   ・';' で区切る。'…' の中の ';' は区切りにしない
   ・各文は1行に詰める（Windows の npx.cmd に渡すときの引用符の事故を避ける） */
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
    /* 行コメント */
    if (c === "-" && s[i + 1] === "-") {
      while (i < s.length && s[i] !== "\n") i++;
      cur += "\n";
      continue;
    }
    /* ブロックコメント */
    if (c === "/" && s[i + 1] === "*") {
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

/* もう当たっている（＝済み）とみなすエラー。
   ALTER TABLE … ADD COLUMN は2回流せないので、これで流し直せるようにする。 */
export const DONE_RE = /duplicate column name|already exists|already an index/i;

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("-"));
  const dry = args.includes("--dry-run");
  const local = args.includes("--local");
  const dbIx = args.indexOf("--db");
  const db = dbIx >= 0 ? args[dbIx + 1] : "pj-sync";
  if (!file) {
    console.error("使い方: node d1-exec.mjs <file.sql> [--dry-run] [--local] [--db 名前]");
    process.exit(2);
  }
  const stmts = splitSql(readFileSync(path.resolve(file), "utf8"));
  console.log(path.basename(file) + "：" + stmts.length + "文");
  if (dry) {
    stmts.forEach((x, i) => console.log("  " + (i + 1) + ". " + x));
    return;
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  /* 聞かれたら「はい」にする印。wrangler の版によっては無いので、
     弾かれたら自動で外して続ける（毎回つけ直さない）。 */
  let useYes = true;
  const call = (stmt) => {
    const a = ["wrangler", "d1", "execute", db, local ? "--local" : "--remote"];
    if (useYes) a.push("--yes");
    a.push("--command", stmt);
    /* 引数は配列で渡す（shell を通さないので、引用符の心配がない）。 */
    const r = spawnSync(npx, a, { encoding: "utf8" });
    return { status: r.status, out: String((r.stdout || "") + (r.stderr || "")) };
  };
  let ok = 0, done = 0;
  for (let i = 0; i < stmts.length; i++) {
    const n = (i + 1) + "/" + stmts.length;
    const head = stmts[i].slice(0, 70);
    let r = call(stmts[i]);
    if (r.status !== 0 && useYes && /Unknown argument|Unrecognized|yes/i.test(r.out)
        && /argument|option/i.test(r.out)) {
      useYes = false;                       // この版に --yes は無い
      r = call(stmts[i]);
    }
    const out = r.out;
    if (r.status === 0) { ok++; console.log("  ✅ " + n + " " + head); continue; }
    if (DONE_RE.test(out)) { done++; console.log("  ⏭ " + n + " 済み " + head); continue; }
    console.log("  ❌ " + n + " " + head);
    console.log(out.trim().split("\n").slice(-12).join("\n"));
    console.log("\nここで止めました。直してから、もう一度同じ命令を流してください"
      + "（済んだ文は飛ばします）。");
    process.exit(1);
  }
  console.log("できました：流した " + ok + "文／すでに済み " + done + "文");
}
/* 直に動かしたときだけ CLI として働く（テストから読むときは関数だけ使う）。 */
if (process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)))
  main();
