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
     node d1-migrate.mjs --baseline 0039  # 0039 までは済みとして記録だけする
     node d1-migrate.mjs --allow-data     # UPDATE が入るファイルも流す

   まだ控えに無いファイルは、1本ずつ**いまの D1 に当たっているか**を確かめる。
   確かめ方は**空振りの SELECT**（7.117）。`sqlite_master` と
   `pragma_table_info` は Cloudflare の API に断られるので使わない。
     ・済み      … 足す表・列がぜんぶある → **記録だけ**して流さない
     ・未適用    … 足りないものがある → 流す（足りないものを名前で出す）
     ・要確認    … UPDATE などデータを動かす文が入っている → **流さずに止める**
                    （中身を見てから `--allow-data`、
                      もう流してあるなら `--baseline 0039` で済みにする）
     ・判定不能  … 確かめられなかった → **何も流さずに止める** */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
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
/* ---- もう当たっているか（7.117）----
   **`sqlite_master` と `pragma_table_info` は使えない。**
   2026-11-08 の実行（runs/42489949958）で、`SELECT name FROM sqlite_master …` が
   Cloudflare の API に断られ（「A request to the Cloudflare API … 」）、
   作りが読めずに**45本ぜんぶ「流す」**になった。
   D1 の query の API は**ふだんの SELECT**なら通るので、
   「その表・その列があるか」を**空振りの SELECT**で確かめる。

     表があるか   … SELECT 1 FROM "t" LIMIT 0
     列があるか   … SELECT "t"."c1","t"."c2" FROM "t" LIMIT 0

   ★★★ 列は**必ず「表.列」で書く**（7.123）★★★
   `SELECT "c1" FROM "t" LIMIT 0` だと **列が無くてもエラーにならない**。
   SQLite には「二重引用符の中が列として見つからなければ**文字列**として扱う」
   という古い仕様（DQS）があり、D1 ではこれが**有効**なので
   `SELECT "asin_n" FROM "mw_auto_runs"` は文字列 'asin_n' を返して成功する。
   そのため **列だけを足すファイル（ALTER ADD COLUMN だけのファイル）は
   ぜんぶ「済み」と誤判定**され、記録だけされて**流れていなかった**
   （2026-11-09・migrate-0047／0048）。
   「表.列」と書けば DQS は効かず、無い列は "no such column: t.c1" で落ちる。
   実機で確かめた（wrangler d1 execute --json）：
     SELECT "nope" FROM "t" LIMIT 0        → 終了コード0・success（通ってしまう）
     SELECT "t"."nope" FROM "t" LIMIT 0    → 終了コード1・no such column: t.nope
   なお **node:sqlite は DQS が切ってある**ので、テストだけ正しく落ちていた
   （tests/lib.mjs で本物と同じにした）。

   ぜんぶ揃っていれば1回で通る（ふつうはこれ）。通らなかったときだけ、
   どれが無いのかを1列ずつ確かめる（足りないものを名前で出すため）。
   索引は SELECT では確かめられないので判定に使わない
   （どのファイルも CREATE INDEX IF NOT EXISTS なので、流し直しても害がない）。 */
export function probeTableSql(t) {
  return 'SELECT 1 FROM "' + String(t).replace(/"/g, '""') + '" LIMIT 0';
}
export function probeColsSql(t, cols) {
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  /* 7.123：**必ず「表.列」**。素の "列" だと DQS で文字列になり落ちない。 */
  return "SELECT " + cols.map((c) => q(t) + "." + q(c)).join(",")
    + " FROM " + q(t) + " LIMIT 0";
}
/* エラーの文から「何が無いのか」を読む。 */
export function missKind(err) {
  const s = String(err || "");
  if (/no such table/i.test(s)) return "table";
  if (/no such column|has no column named/i.test(s)) return "column";
  return "";
}
/* 1つのファイルの判定。
   probe(sql) は { ok, err } を返す関数（本物は wrangler・テストは作りもの）。
   返り: { state:'done'|'todo'|'data'|'unknown', miss:[], why } */
export async function judgeFile(objs, probe, memo) {
  const mem = memo || {};
  const o = objs || { tables: [], columns: [], indexes: [], other: 0 };
  const miss = [];
  /* ① データを動かす文（UPDATE・INSERT など）が入っているファイルは、
        作りからは「済み」と決められない。人に見てもらう。 */
  if (o.other > 0)
    return { state: "data", miss: [],
             why: "UPDATE などデータを動かす文が " + o.other + "つあるので要確認" };
  if (!o.tables.length && !o.columns.length)
    return { state: "data", miss: [],
             why: "表も列も足さないファイルなので要確認" };
  const ask = async (sql) => {
    if (mem[sql] === undefined) mem[sql] = await probe(sql);
    return mem[sql];
  };
  /* ② 作る表があるか。 */
  for (const t of o.tables) {
    const r = await ask(probeTableSql(t));
    if (r.ok) continue;
    const k = missKind(r.err);
    if (k === "table") { miss.push("表 " + t); continue; }
    return { state: "unknown", miss: [],
             why: "表 " + t + " を確かめられません：" + String(r.err || "").slice(0, 200) };
  }
  /* ③ 足す列があるか。表ごとにまとめて1回で聞く。 */
  const by = {};
  for (const c of o.columns) (by[c.table] = by[c.table] || []).push(c.column);
  for (const t of Object.keys(by)) {
    if (miss.indexOf("表 " + t) >= 0) {
      by[t].forEach((c) => miss.push(t + "." + c));
      continue;
    }
    const r = await ask(probeColsSql(t, by[t]));
    if (r.ok) continue;
    const k = missKind(r.err);
    if (!k)
      return { state: "unknown", miss: [],
               why: t + " の列を確かめられません：" + String(r.err || "").slice(0, 200) };
    if (k === "table") { miss.push("表 " + t); continue; }
    /* どの列が無いのかを1列ずつ確かめる。 */
    for (const c of by[t]) {
      const r2 = await ask(probeColsSql(t, [c]));
      if (!r2.ok) miss.push(t + "." + c);
    }
  }
  if (miss.length)
    return { state: "todo", miss, why: "足りないもの：" + miss.join("・") };
  return { state: "done", miss: [], why: "表・列が揃っている" };
}

/* ---- D1 を読む（JSON で返る）----
   query は 1文を渡すと行の配列を返す関数（本番は wrangler --json）。 */
export const SQL_LEDGER = "SELECT file FROM _migrations";
export const SQL_LEDGER_NEW =
  "CREATE TABLE IF NOT EXISTS _migrations (file TEXT PRIMARY KEY, "
  + "at TEXT NOT NULL, src TEXT NOT NULL)";
export function sqlMark(file, at, src) {
  const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
  return "INSERT OR REPLACE INTO _migrations (file, at, src) VALUES ("
    + q(file) + "," + q(at) + "," + q(src) + ")";
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
                at: "", note: "", src, dry: !!o.dry,
                /* 7.117：ファイルごとの判定（済み／未適用＋足りないもの／要確認）。 */
                judge: [], todo: [], data: [], unknown: [],
                /* 7.123：控えでは「済み」なのに作りが足りず、未適用に戻した分。 */
                relist: [], rerun: [] };
  const files = fileList(dir);
  if (!files.length) {
    res.ok = true; res.note = "マイグレーションのファイルがありません";
    log(res.note);
    return res;
  }
  let exec = o.exec, query = o.query, probe = o.probe;
  if (!exec || !query || !probe) {
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
    /* 7.117：表・列があるかを空振りの SELECT で確かめる。
       エラーの文がそのまま要るので、throw せず { ok, err } で返す。 */
    probe = probe || (async (sql) => {
      const r = runJson(how, db, !!o.local, sql);
      return { ok: !!r.ok, err: r.ok ? "" : r.err };
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
  const memo = {};
  const objsOf = (f) => {
    try { return sqlObjects(readFileSync(path.join(dir, f), "utf8")); }
    catch (e) { return null; }
  };
  /* ★ 7.123：控え（_migrations）に「済み」と書いてあっても、**いまの D1 に
       作りが足りないファイル**を見つけて「未適用」に戻す（verify。既定オン）。
     二重引用符の落とし穴（probeColsSql のコメント）で、**列だけを足す
     ファイルがぜんぶ「済み」と誤判定**され、記録だけされて流れていなかった。
     控えは「流したつもり」の記録にすぎないので、**本当の作りを正とする**。
     ・データを動かすファイル（UPDATE 入り）は触らない（二重に流さない）
     ・判定できなかったファイルも触らない（控えのままにする）
     --no-verify で止められる（急ぎのときだけ）。 */
  const relist = {};
  if (o.verify !== false) {
    for (const f of files) {
      if (!done[f]) continue;
      const objs = objsOf(f);
      if (!objs || objs.other > 0) continue;
      if (!objs.tables.length && !objs.columns.length) continue;
      const g = await judgeFile(objs, probe, memo);
      if (g.state !== "todo") continue;
      relist[f] = g.why;
      res.relist.push(f);
    }
    if (res.relist.length) {
      log("⚠ 控えでは「済み」なのに、D1 に作りが足りないファイルが "
        + res.relist.length + "本あります（未適用に戻します）");
      for (const f of res.relist) log("  ↩ " + f + "　" + relist[f]);
    }
  }
  /* 7.123：入力「このファイルを流し直す」（名前でも番号でも受ける）。 */
  const again = {};
  for (const x of String(o.rerun || "").split(/[,\s]+/).filter(Boolean)) {
    /* 名前そのまま（migrate-0048-mw-auto.sql）／番号（0048 でも 48 でも）／
       名前の一部（mw-auto）のどれでも指せる。 */
    const no = baseNo(x);
    const hit = files.filter((f) => f === x
      || (no > 0 && ((fileNo(f) || {}).no === no))
      || (no === 0 && f.indexOf(x) >= 0));
    if (!hit.length) {
      res.failed = "流し直すファイルが見つかりません：" + x;
      log("❌ " + res.failed);
      return res;
    }
    for (const f of hit) { again[f] = 1; res.rerun.push(f); }
  }
  if (res.rerun.length)
    log("↻ 流し直す指定：" + res.rerun.join("・"));
  res.pending = files.filter((f) => !done[f] || relist[f] || again[f]);
  log("マイグレーション " + files.length + "本／控えにあるもの "
    + Object.keys(done).length + "本／未適用 " + res.pending.length + "本"
    + (res.relist.length ? ("（うち 作りが足りないので戻した " + res.relist.length
        + "本）") : "")
    + (res.rerun.length ? ("（うち 流し直す指定 " + res.rerun.length + "本）") : ""));
  if (!res.pending.length) {
    res.ok = true; res.note = "流すものはありません";
    log("流すものはありません。");
    return res;
  }
  /* ③ 1本ずつ、いまの D1 に当たっているかを確かめる（7.117）。
        「この番号までは済み」（baselineTo）が指定されていれば、
        その番号以下は確かめずに**記録だけ**する。 */
  const base = baseNo(o.baselineTo);
  if (base) log("「" + String(base).padStart(4, "0")
    + " までは済み」として記録だけします（baseline）。");
  const todo = [], data = [], unknown = [];
  for (const f of res.pending) {
    const no = (fileNo(f) || {}).no || 0;
    const objs = objsOf(f);
    /* 7.123：流し直す指定のファイルは、判定を飛ばして必ず流す
       （すでに当たっている文は「済み」として読み飛ばされる）。 */
    if (again[f]) {
      todo.push(f);
      res.judge.push({ file: f, state: "rerun", why: "流し直す指定" });
      log("  ↻ " + f + "　流し直す指定 → 流す");
      continue;
    }
    if (base && no <= base) {
      res.marked.push(f);
      res.judge.push({ file: f, state: "base", why: "番号 "
        + String(base).padStart(4, "0") + " 以下なので済みとして記録だけ" });
      log("  ⏭ " + f + "　済み（baseline）");
      continue;
    }
    const g = await judgeFile(objs, probe, memo);
    res.judge.push({ file: f, state: g.state, why: g.why, miss: g.miss });
    if (g.state === "done") {
      res.marked.push(f);
      log("  ⏭ " + f + "　済み（" + g.why + "）→ 記録だけ");
      continue;
    }
    if (g.state === "data") {
      data.push(f);
      /* 人が中身を見たうえで allowData を付けたときは、番号順のまま流す。 */
      if (o.allowData) todo.push(f);
      log("  " + (o.allowData ? "▶" : "❔") + " " + f + "　要確認（" + g.why + "）"
        + (o.allowData ? " → 流す（データを動かすファイルも流す）" : ""));
      continue;
    }
    if (g.state === "unknown") {
      unknown.push(f);
      log("  ⚠ " + f + "　判定できません（" + g.why + "）");
      continue;
    }
    todo.push(f);
    log("  ▶ " + f + "　未適用（" + g.why + "）→ 流す");
  }
  res.data = data; res.unknown = unknown; res.todo = todo;
  /* ④ 判定できなかったファイルがあるときは、何も流さずに止める
        （「流れていないのに流れたつもり」を作らない）。 */
  if (unknown.length) {
    res.failed = "D1 の作りを確かめられないファイルが " + unknown.length + "本あります";
    res.note = unknown.join("・") + "。上の理由を見てください";
    log("❌ " + res.failed + "。何も流していません。");
    return res;
  }
  /* ⑤ UPDATE などが入っているファイルは、人が見るまで流さない（7.117）。
        見たうえで流すときは allowData（入力「データを動かすファイルも流す」）。 */
  if (data.length && !o.allowData) {
    res.failed = "データを動かす文が入っているファイルが " + data.length + "本あります";
    res.note = data.join("・")
      + "。中身を見て、流してよければ「データを動かすファイルも流す」を"
      + "オンにして、もう一度実行してください"
      + "（すでに流してあるなら baseline で済みにしてください）";
    log("❌ " + res.failed);
    log("   " + res.note);
    log("   何も流していません（記録もしていません）。");
    return res;
  }
  if (o.dry) {
    res.ok = true;
    res.note = "確かめだけ（dry run）。流す " + todo.length + "本／記録だけ "
      + res.marked.length + "本／要確認 " + data.length + "本";
    log(res.note + "。何も変えていません。");
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
  res.note = "流した " + res.ran.length + "本／記録だけ " + res.marked.length + "本"
    + (res.data.length ? ("／要確認 " + res.data.length + "本") : "");
  log(res.note);
  return res;
}
/* ---- 知らせに出す短い文（7.117）----
   実行の記録には1本ずつ出すが、Discord にはこれを送る
   （「流す」「要確認」「判定できない」だけを並べる。済みは件数だけ）。 */
export const SUMMARY_MAX = 30;
export function summaryText(res) {
  const r = res || {};
  const t = [];
  t.push("マイグレーション " + (r.pending || []).length + "本が未適用"
    + "（" + (r.dry ? "確かめだけ" : "実行") + "）");
  const n = (r.judge || []).filter((x) => x.state === "base").length;
  t.push("済みとして記録だけ " + (r.marked || []).length + "本"
    + (n ? ("（うち baseline " + n + "本）") : ""));
  const show = (label, list, mark) => {
    if (!list || !list.length) return;
    t.push(label + " " + list.length + "本");
    const by = {};
    for (const x of (r.judge || [])) by[x.file] = x;
    for (const f of list.slice(0, SUMMARY_MAX))
      t.push(mark + " " + f + "　" + String((by[f] || {}).why || "").slice(0, 160));
    if (list.length > SUMMARY_MAX)
      t.push("　ほか " + (list.length - SUMMARY_MAX) + "本");
  };
  /* 7.123：控えでは「済み」なのに作りが足りず、未適用に戻した分。
     「流したつもりで流れていなかった」ことが Discord だけで分かるように、
     件数とファイル名を**いちばん目につくところ**に出す。 */
  if ((r.relist || []).length) {
    t.push("↩ 控えでは済みだが作りが足りない " + r.relist.length
      + "本（未適用に戻した）");
    for (const f of r.relist.slice(0, SUMMARY_MAX)) t.push("　" + f);
    if (r.relist.length > SUMMARY_MAX)
      t.push("　ほか " + (r.relist.length - SUMMARY_MAX) + "本");
  }
  if ((r.rerun || []).length)
    t.push("↻ 流し直す指定 " + r.rerun.length + "本：" + r.rerun.join("・"));
  show("流す", r.dry ? (r.todo || []) : (r.ran || []), "▶");
  show("要確認（データを動かす文が入っている）", r.data || [], "❔");
  show("判定できない", r.unknown || [], "⚠");
  if (r.failed) t.push("🔴 " + r.failed);
  if (r.note) t.push(r.note);
  return t.join("\n");
}
/* 「この番号までは済み」の指定を読む（'0039' / '39' / 'migrate-0039-….sql'）。 */
export function baseNo(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return 0;
  const f = fileNo(s);
  if (f) return f.no;
  const m = /^(\d{1,4})$/.exec(s);
  return m ? Number(m[1]) : 0;
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
  const sumTo = at("--summary");
  migrate({
    dir: at("--dir") || here,
    dry: args.includes("--dry-run"),
    local: args.includes("--local"),
    debug: args.includes("--debug"),
    db: at("--db") || "pj-sync",
    src: at("--src") || "pc",
    /* 7.117：この番号までは済みとして記録だけする（0039 / migrate-0039-….sql）。 */
    baselineTo: at("--baseline"),
    /* 7.117：UPDATE などデータを動かすファイルも流す（既定は止める）。 */
    allowData: args.includes("--allow-data"),
    /* 7.123：控えで「済み」のファイルも作りを確かめ、足りなければ
       未適用に戻す（既定オン。--no-verify で止める）。 */
    verify: !args.includes("--no-verify"),
    /* 7.123：このファイルを流し直す（名前／番号／名前の一部）。 */
    rerun: at("--rerun"),
  }).then((r) => {
    /* --summary <file> で、知らせに出す短い文を書き出す（GitHub Actions 用）。 */
    if (sumTo) {
      try { writeFileSync(sumTo, summaryText(r) + "\n", "utf8"); }
      catch (e) { console.log("（" + sumTo + " に書けませんでした）"); }
    }
    if (!r.ok) process.exit(1);
  }).catch((e) => {
    console.error("❌ " + String((e && e.message) || e));
    process.exit(1);
  });
}
if (process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)))
  main();
