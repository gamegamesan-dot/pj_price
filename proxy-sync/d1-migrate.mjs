#!/usr/bin/env node
/* 未適用のマイグレーションだけを番号順に流す道具（7.116／【N】）

   なぜ要るか：
     出先では PowerShell が使えず、`node d1-exec.mjs …` と
     `npx wrangler deploy` が溜まってしまう。GitHub Actions（スマホの
     GitHub アプリ）から押せるようにするには、
     **どのファイルをもう流したか**を D1 自身が覚えている必要がある
     （PC で流したぶんを Actions がもう一度流さないように）。

   覚え方：D1 の `_migrations`（file／at／src）に、流したファイル名を入れる。
     src は 'pc'（手元の PowerShell）か 'actions'（GitHub Actions）。

   使い方（proxy-sync で）:
     node d1-migrate.mjs --dry-run        # 流すものの一覧だけ出す（何も変えない）
     node d1-migrate.mjs                  # 未適用だけを番号順に流す
     node d1-migrate.mjs --src actions    # 記録する「流した場所」
     node d1-migrate.mjs --local          # 手元のDBに流す

   はじめて使うとき（控えが空のとき）：
     すでに当たっているファイルを流し直さない。D1 の**いまの作り**
     （表と列）を読んで、そのファイルが足す表・列がぜんぶ揃っていれば
     「適用済み」として**記録だけ**する。 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { splitSql, DONE_RE, findWrangler, makeExec, winUnsafe } from "./d1-exec.mjs";

/* ---- 流す順 ----
   ファイル名の4桁の番号で並べる。同じ番号なら migrate → backfill の順
   （backfill は同じ番号の migrate が作った列を埋めるもの）。 */
export function fileNo(name) {
  const m = /^(migrate|backfill)-(\d{4})-/.exec(String(name || ""));
  return m ? { kind: m[1], no: Number(m[2]) } : null;
}
export function fileList(dir) {
  let names = [];
  try { names = readdirSync(dir); } catch (e) { names = []; }
  return names
    .filter((x) => /\.sql$/.test(x) && !!fileNo(x))
    .sort((a, b) => {
      const x = fileNo(a), y = fileNo(b);
      if (x.no !== y.no) return x.no - y.no;
      if (x.kind !== y.kind) return (x.kind === "migrate") ? -1 : 1;
      return a < b ? -1 : 1;
    });
}

/* ---- そのファイルが足すもの（表・列・索引）----
   「もう当たっているか」を D1 のいまの作りと見比べるために使う。
   読み取るのは CREATE TABLE / ALTER TABLE … ADD COLUMN / CREATE INDEX だけ。
   UPDATE や INSERT しかないファイル（backfill）は、ここでは何も返さない
   （＝作りからは判定できないので「適用済み」とは決めない）。 */
export function sqlObjects(sql) {
  const out = { tables: [], columns: [], indexes: [], other: 0 };
  for (const stmt of splitSql(sql)) {
    let m = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z0-9_]+)["'`]?/i
      .exec(stmt);
    if (m) { out.tables.push(m[1]); continue; }
    m = /^ALTER\s+TABLE\s+["'`]?([A-Za-z0-9_]+)["'`]?\s+ADD\s+(?:COLUMN\s+)?["'`]?([A-Za-z0-9_]+)["'`]?/i
      .exec(stmt);
    if (m) { out.columns.push({ table: m[1], column: m[2] }); continue; }
    m = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z0-9_]+)["'`]?/i
      .exec(stmt);
    if (m) { out.indexes.push(m[1]); continue; }
    out.other++;
  }
  return out;
}
/* いまの作り（schema）で、そのファイルがもう当たっているか。
   schema は { tables:{名前:1}, columns:{表名:{列名:1}}, indexes:{名前:1} }。
   作りを変えない文（UPDATE だけの backfill）がある、または足すものが
   1つも無いファイルは **false**（勝手に「済み」にしない）。 */
export function appliedAlready(objs, schema) {
  if (!objs || objs.other > 0) return false;
  const n = objs.tables.length + objs.columns.length + objs.indexes.length;
  if (!n) return false;
  const sc = schema || {};
  const tb = sc.tables || {}, co = sc.columns || {}, ix = sc.indexes || {};
  for (const t of objs.tables) if (!tb[t]) return false;
  for (const c of objs.columns) if (!(co[c.table] && co[c.table][c.column])) return false;
  for (const i of objs.indexes) if (!ix[i]) return false;
  return true;
}

/* ---- D1 を読む（JSON で返る）----
   query は 1文を渡すと行の配列を返す関数（本番は wrangler --json）。 */
export const SQL_TABLES = "SELECT name FROM sqlite_master WHERE type='table'";
export const SQL_INDEXES = "SELECT name FROM sqlite_master WHERE type='index'";
export const SQL_COLS = (t) =>
  "SELECT name FROM pragma_table_info('" + String(t).replace(/'/g, "''") + "')";
export const SQL_LEDGER = "SELECT file FROM _migrations";
export const SQL_LEDGER_NEW =
  "CREATE TABLE IF NOT EXISTS _migrations (file TEXT PRIMARY KEY, "
  + "at TEXT NOT NULL, src TEXT NOT NULL)";
export function sqlMark(file, at, src) {
  const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
  return "INSERT OR REPLACE INTO _migrations (file, at, src) VALUES ("
    + q(file) + "," + q(at) + "," + q(src) + ")";
}

export async function readSchema(query) {
  const schema = { tables: {}, columns: {}, indexes: {} };
  for (const r of await query(SQL_TABLES)) schema.tables[String(r.name)] = 1;
  for (const r of await query(SQL_INDEXES)) schema.indexes[String(r.name)] = 1;
  for (const t of Object.keys(schema.tables)) {
    schema.columns[t] = {};
    for (const r of await query(SQL_COLS(t))) schema.columns[t][String(r.name)] = 1;
  }
  return schema;
}

/* ---- 本体 ----
   opt: { dir, dry, local, src, exec, query, log, now }
   返り: { ok, pending:[], ran:[], marked:[], failed:'', at:'', note:'' } */
export async function migrate(opt) {
  const o = opt || {};
  const log = o.log || console.log;
  const dir = o.dir || process.cwd();
  const src = (String(o.src || "pc") === "actions") ? "actions" : "pc";
  const now = o.now || (() => new Date().toISOString());
  const res = { ok: false, pending: [], ran: [], marked: [], failed: "",
                at: "", note: "", src, dry: !!o.dry };
  const files = fileList(dir);
  if (!files.length) {
    res.ok = true; res.note = "マイグレーションのファイルがありません";
    log(res.note);
    return res;
  }
  let exec = o.exec, query = o.query;
  if (!exec || !query) {
    const how = o.how || findWrangler(dir);
    const db = o.db || "pj-sync";
    if (how.kind !== "node") {
      res.failed = "wrangler が見つかりません（proxy-sync で npm ci を流してください）";
      log("❌ " + res.failed);
      return res;
    }
    /* 書き込みは d1-exec と同じ道（1文ずつ --command）。 */
    exec = exec || makeExec(how, db, !!o.local, !!o.debug);
    /* 読み取りは --json を付けて行で受ける（makeExec には無いので別に作る）。 */
    query = query || (async (sql) => {
      const r = runJson(how, db, !!o.local, sql);
      if (!r.ok) throw new Error(r.err);
      return r.rows;
    });
  }
  /* ① 控えの表を用意する（無ければ作る）。 */
  if (!o.dry) {
    const r0 = exec(SQL_LEDGER_NEW);
    if (r0.status !== 0 && !DONE_RE.test((r0.stdout || "") + (r0.stderr || ""))) {
      res.failed = "控えの表（_migrations）を作れませんでした";
      res.note = shortErr(r0);
      log("❌ " + res.failed + "：" + res.note);
      return res;
    }
  }
  /* ② 控えを読む。 */
  let done = {};
  try {
    for (const r of await query(SQL_LEDGER)) done[String(r.file)] = 1;
  } catch (e) {
    /* 表がまだ無い（初回の --dry-run）ときは空として進む。 */
    if (!/no such table/i.test(String((e && e.message) || e))) {
      res.failed = "控え（_migrations）を読めませんでした";
      res.note = String((e && e.message) || e).slice(0, 200);
      log("❌ " + res.failed + "：" + res.note);
      return res;
    }
    done = {};
  }
  const first = !Object.keys(done).length;
  res.pending = files.filter((f) => !done[f]);
  log("マイグレーション " + files.length + "本／控えにあるもの "
    + Object.keys(done).length + "本／未適用 " + res.pending.length + "本"
    + (first ? "（控えが空なので、はじめての実行として扱います）" : ""));
  if (!res.pending.length) {
    res.ok = true; res.note = "流すものはありません";
    log("流すものはありません。");
    return res;
  }
  /* ③ はじめての実行は、D1 のいまの作りを見て
        「もう当たっているファイル」を記録だけする。 */
  let schema = null;
  if (first) {
    try { schema = await readSchema(query); }
    catch (e) {
      log("（いまの作りを読めませんでした：" + String((e && e.message) || e).slice(0, 120)
        + "。ぜんぶ流して確かめます）");
      schema = null;
    }
  }
  const todo = [];
  for (const f of res.pending) {
    let objs = null;
    try { objs = sqlObjects(readFileSync(path.join(dir, f), "utf8")); }
    catch (e) { objs = null; }
    if (schema && appliedAlready(objs, schema)) {
      res.marked.push(f);
      log("  ⏭ " + f + " は**すでに当たっています**（記録だけします）");
      continue;
    }
    todo.push(f);
  }
  if (o.dry) {
    todo.forEach((f) => log("  ▶ " + f + " を流します"));
    res.ok = true;
    res.note = "確かめだけ（dry run）。流す " + todo.length + "本／記録だけ "
      + res.marked.length + "本";
    log(res.note + "。何も変えていません。");
    res.todo = todo;
    return res;
  }
  /* ④ 記録だけのぶんを書く。 */
  for (const f of res.marked) {
    const r = exec(sqlMark(f, now(), src));
    if (r.status !== 0) {
      res.failed = f + " を記録できませんでした";
      res.note = shortErr(r);
      log("❌ " + res.failed + "：" + res.note);
      return res;
    }
  }
  /* ⑤ 残りを番号順に流す。失敗したらそこで止める（デプロイもしない）。 */
  for (const f of todo) {
    log("▶ " + f);
    const stmts = splitSql(readFileSync(path.join(dir, f), "utf8"));
    let ran = 0, skip = 0;
    for (let i = 0; i < stmts.length; i++) {
      const n = (i + 1) + "/" + stmts.length;
      const head = stmts[i].slice(0, 70);
      if (winUnsafe(stmts[i])) {
        res.failed = f + " の " + n + " を流せませんでした";
        res.note = "この文には % が入っています（Windows の cmd では流せません）";
        log("  ❌ " + n + " " + head + "\n    " + res.note);
        res.at = f;
        return res;
      }
      const r = exec(stmts[i]);
      const out = (r.stdout || "") + (r.stderr || "");
      if (r.status === 0) { ran++; log("  ✅ " + n + " " + head); continue; }
      if (DONE_RE.test(out)) { skip++; log("  ⏭ " + n + " 済み " + head); continue; }
      res.failed = f + " の " + n + " で止まりました";
      res.note = shortErr(r);
      log("  ❌ " + n + " " + head + "\n    " + res.note);
      log("ここで止めました。デプロイもしません。");
      res.at = f;
      return res;
    }
    const r = exec(sqlMark(f, now(), src));
    if (r.status !== 0) {
      res.failed = f + " を記録できませんでした（SQL は流れています）";
      res.note = shortErr(r);
      log("  ❌ " + res.note);
      res.at = f;
      return res;
    }
    res.ran.push(f);
    log("  できました：流した " + ran + "文／すでに済み " + skip + "文");
  }
  res.ok = true;
  res.note = "流した " + res.ran.length + "本／記録だけ " + res.marked.length + "本";
  log(res.note);
  return res;
}

/* エラーの短い文。**秘密は出さない**（wrangler はトークンを出力しないが、
   念のため長さを切り、token/secret/key を含む行は落とす）。 */
export function shortErr(r) {
  const raw = [(r && r.stderr) || "", (r && r.stdout) || ""].join("\n");
  const lines = raw.split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !/token|secret|api[_-]?key|authorization|bearer/i.test(x));
  const msg = lines.filter((x) => /error|failed|✘|✖/i.test(x)).slice(0, 3).join(" / ")
    || lines.slice(0, 3).join(" / ");
  const code = (r && (r.status === null || r.status === undefined))
    ? "なし" : String(r && r.status);
  return ("終了コード " + code + (msg ? ("：" + msg) : "")).slice(0, 300);
}

/* wrangler を --json で呼んで行を返す（読み取り）。 */
export function runJson(how, db, local, sql) {
  const args = [how.path, "d1", "execute", db, local ? "--local" : "--remote",
                "--json", "--command", sql];
  const r = spawnSync(process.execPath, args,
    { encoding: "utf8", windowsHide: true });
  const out = (r.stdout == null ? "" : String(r.stdout));
  if (r.status !== 0)
    return { ok: false, rows: [],
             err: shortErr({ status: r.status, stdout: out,
                             stderr: r.stderr == null ? "" : String(r.stderr) }) };
  return Object.assign({ ok: true }, parseJsonRows(out));
}
/* wrangler --json の出力から行を取り出す。
   前後に飾りの行が混ざることがあるので、**最初の [ か { から**読む。 */
export function parseJsonRows(out) {
  const s = String(out || "");
  const i = Math.min(...[s.indexOf("["), s.indexOf("{")].filter((x) => x >= 0));
  if (!isFinite(i)) return { rows: [], err: "JSON が見つかりません" };
  let d = null;
  try { d = JSON.parse(s.slice(i)); } catch (e) {
    return { rows: [], err: "JSON を読めません" };
  }
  const list = Array.isArray(d) ? d : [d];
  const rows = [];
  for (const x of list) {
    const r = (x && x.results) || (x && x.result) || null;
    if (Array.isArray(r)) rows.push(...r);
  }
  return { rows, err: "" };
}

function main() {
  const args = process.argv.slice(2);
  const at = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ""; };
  const here = path.dirname(fileURLToPath(import.meta.url));
  migrate({
    dir: at("--dir") || here,
    dry: args.includes("--dry-run"),
    local: args.includes("--local"),
    debug: args.includes("--debug"),
    db: at("--db") || "pj-sync",
    src: at("--src") || "pc",
  }).then((r) => {
    if (!r.ok) process.exit(1);
  }).catch((e) => {
    console.error("❌ " + String((e && e.message) || e));
    process.exit(1);
  });
}
if (process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)))
  main();
