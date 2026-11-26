#!/usr/bin/env node
/* MW の在庫CSV の取り込みの様子を D1 から**読むだけ**の道具・いますぐ取り込む印（8.103）

   2026-11-26、自動の取り込みが 41時間止まっていた。原因を D1 の記録から
   確かめるため、GitHub Actions（deploy-pj-sync の「MW の取り込みの記録を見る」）
   から動かす。**このリポジトリは公開**なので、出すのは時刻・件数・理由だけ
   （商品名・URL・鍵は出さない）。

   使い方（proxy-sync で）:
     node d1-diag.mjs --mw-csv      # 取り込みの記録を出す（読むだけ）
     node d1-diag.mjs --kick        # 「いますぐ取り込む」の印を置く
                                    # （pj-sync の15分ごとの回が拾って取り込む）
     node d1-diag.mjs … --db pj-sync --local */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { findWrangler } from "./d1-exec.mjs";
import { runJson } from "./d1-migrate.mjs";

/* 出してよい形に整える（URL・長すぎる文を落とす）。 */
export function clean(v, n) {
  return String(v == null ? "" : v)
    .replace(/https?:\/\/\S+/g, "（URL）")
    .replace(/[\r\n]+/g, " ")
    .slice(0, n || 160);
}
export const Q_RUNS = "SELECT at, src, http, changed, took, bytes, rows_in, added, "
  + "changed_rows, gone, elapsed_ms, ok, why FROM mw_csv_runs ORDER BY id DESC LIMIT 30";
export const Q_STATE = "SELECT k, v, updated_at FROM sync_state WHERE k LIKE 'mwcsv.%' "
  + "OR k IN ('mw.stale.notified') ORDER BY k";
export const Q_IMPORTS = "SELECT at, rows_in, added, changed, gone, back, picked, warn, src "
  + "FROM mw_runs ORDER BY id DESC LIMIT 8";
export const Q_JOBS = "SELECT kind, started_at, elapsed_ms, errors, note FROM sync_runs "
  + "WHERE kind IN ('mw-csv','mw-stock','mw-drop','mw-stale') "
  + "ORDER BY id DESC LIMIT 40";
/* 欠品なのに eBay で在庫ありのまま残っている無在庫の出品（数だけ）。 */
export const Q_LEFT = "SELECT COUNT(*) AS n FROM items i "
  + "WHERE i.ebay_sku LIKE 'W-%' AND COALESCE(i.ebay_item_id,'') <> '' "
  + "AND COALESCE(i.ebay_qty,0) > 0 AND NOT EXISTS (SELECT 1 FROM mw_stock s "
  + "WHERE s.jan = substr(i.ebay_sku,3) AND s.gone_at IS NULL AND COALESCE(s.stock,0) > 0)";
export function kickSql(at) {
  const q = (x) => "'" + String(x).replace(/'/g, "''") + "'";
  return "INSERT INTO sync_state (k,v,updated_at) VALUES ('mwcsv.kick'," + q(at) + ","
    + q(at) + ") ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at";
}

function main() {
  const args = process.argv.slice(2);
  const at = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ""; };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const db = at("--db") || "pj-sync";
  const local = args.includes("--local");
  const how = findWrangler(here);
  if (how.kind !== "node") { console.log("wrangler が見つかりません"); process.exit(1); }
  const q = (sql) => runJson(how, db, local, sql);
  if (args.includes("--kick")) {
    const now = new Date().toISOString();
    const r = spawnSync(process.execPath, [how.path, "d1", "execute", db,
      local ? "--local" : "--remote", "--command", kickSql(now)],
      { encoding: "utf8", windowsHide: true });
    console.log(r.status === 0
      ? ("いますぐ取り込む印を置きました（" + now + "）。pj-sync の15分ごとの回が拾います。")
      : ("印を置けませんでした（終了コード " + r.status + "）"));
    if (r.status !== 0) process.exit(1);
  }
  if (!args.includes("--mw-csv")) return;
  const show = (title, res, cols) => {
    console.log("\n=== " + title + " ===");
    if (!res.ok) { console.log("読めませんでした：" + clean(res.err, 200)); return; }
    for (const r of res.rows)
      console.log(cols.map((c) => c + "=" + clean(r[c], c === "note" ? 300 : 160)).join(" | "));
    if (!res.rows.length) console.log("（なし）");
  };
  show("自動取り込みの記録（mw_csv_runs・新しい順）", q(Q_RUNS),
    ["at", "src", "http", "changed", "took", "bytes", "rows_in", "added", "gone",
     "elapsed_ms", "ok", "why"]);
  show("取り込みの控え（sync_state）", q(Q_STATE), ["k", "v", "updated_at"]);
  show("取り込めた回（mw_runs）", q(Q_IMPORTS),
    ["at", "src", "rows_in", "added", "changed", "gone", "back", "picked", "warn"]);
  show("実行の記録（sync_runs）", q(Q_JOBS), ["kind", "started_at", "elapsed_ms", "errors", "note"]);
  show("欠品なのに eBay で在庫ありの無在庫の出品（件数）", q(Q_LEFT), ["n"]);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
