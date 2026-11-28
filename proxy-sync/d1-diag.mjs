#!/usr/bin/env node
/* MW の在庫CSV の取り込みの様子を D1 から**読むだけ**の道具・いますぐ取り込む印（8.103）

   2026-11-26、自動の取り込みが 41時間止まっていた。原因を D1 の記録から
   確かめるため、GitHub Actions（deploy-pj-sync の「MW の取り込みの記録を見る」）
   から動かす。**このリポジトリは公開**なので、出すのは時刻・件数・理由だけ
   （商品名・URL・鍵は出さない）。

   使い方（proxy-sync で）:
     node d1-diag.mjs --mw-csv      # 取り込みの記録を出す（読むだけ）
     node d1-diag.mjs --title-len   # 出品済みの無在庫の題名の長さ（数だけ・8.108）
     node d1-diag.mjs --kick        # 「いますぐ取り込む」の印を置く
                                    # （pj-sync の15分ごとの回が拾って取り込む）
     node d1-diag.mjs … --db pj-sync --local */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { findWrangler } from "./d1-exec.mjs";
import { runJson, parseJsonRows } from "./d1-migrate.mjs";
const MWMATCH = createRequire(import.meta.url)("../shared/mwmatch.js");

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
/* 8.105 商品違いの疑いを、仕入れタブ「刈取」と同じ行（MW の代表の行で Amazon の値段がある行）に
   当てて数える。見立ては画面と同じ shared/mwmatch.js。 */
export const Q_MATCH = "SELECT s.jan AS jan, s.name AS mw_name, s.list_price AS list_price, "
  + "s.wholesale AS wholesale, a.asin AS asin, a.name AS amz_name, a.price AS price, "
  + "(SELECT ms.asin FROM mw_same ms WHERE ms.jan = s.jan) AS same_asin "
  + "FROM mw_stock s JOIN mw_amz a ON a.jan = s.jan "
  + "WHERE s.pick = 1 AND s.gone_at IS NULL AND COALESCE(a.price,0) > 0";
export const Q_X = "SELECT v FROM sync_state WHERE k = 'ui.settings'";
/* 8.108 出品済みの無在庫（W-・ItemID あり）の題名の長さ（**数だけ**）。
   売れた実績（eBay の注文に同じ SKU か同じ商品がある・その出品で売れた数）で分けて数える。
   題名そのものは出さない（公開のログ）。stat＝true のときは、いまの eBay の題名
   （ebay_stat.title・migrate-0075）を使い、無い行は最初に取り込んだ題名（items.title）。 */
export function qTitleLen(stat) {
  const t = stat ? "COALESCE(NULLIF(t.title,''), i.title, '')" : "COALESCE(i.title,'')";
  const sold = stat ? " OR COALESCE(t.sold,0) > 0" : "";
  return "SELECT CASE WHEN length(" + t + ") < 40 THEN 'a' WHEN length(" + t + ") < 60 THEN 'b' "
    + "WHEN length(" + t + ") <= 80 THEN 'c' ELSE 'd' END AS band, "
    + "CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.channel = 'ebay' "
    + "AND (o.sku = i.ebay_sku OR (o.asin = i.asin AND o.cond = i.cond)))" + sold + " THEN 1 ELSE 0 END AS won, "
    + "COUNT(*) AS n, ROUND(AVG(length(" + t + ")),1) AS avg_len "
    + "FROM items i" + (stat ? " LEFT JOIN ebay_stat t ON t.asin = i.asin AND t.cond = i.cond" : "")
    + " WHERE i.ebay_sku LIKE 'W-%' AND COALESCE(i.ebay_item_id,'') <> '' "
    + "GROUP BY band, won ORDER BY band, won";
}
/* 8.112 会員の Shopify のタグの様子（会員番号は**下4桁だけ**・氏名やメールは持っていない）。 */
export const Q_MEM_TAGS = "SELECT substr(cust,-4) AS c4, plan, state, COALESCE(shop_tags,'') AS tags, "
  + "COALESCE(shop_tag_err,'') AS err, COALESCE(shop_tag_at,'') AS at, COALESCE(shop_tag_off,0) AS off "
  + "FROM mem ORDER BY at DESC LIMIT 50";
export const TITLE_BAND = { a: "40字未満", b: "40〜59字", c: "60〜80字", d: "81字以上" };
/* 帯ごとの件数にまとめる。{ a:{all,sold,unsold,avg}, … , total } */
export function titleLenSum(rows) {
  const o = { total: 0 };
  for (const k of Object.keys(TITLE_BAND)) o[k] = { all: 0, sold: 0, unsold: 0 };
  for (const r of rows || []) {
    const b = o[r.band]; if (!b) continue;
    const n = Number(r.n) || 0;
    b.all += n; o.total += n;
    if (Number(r.won) === 1) b.sold += n; else b.unsold += n;
  }
  return o;
}
/* 数える（理由ごと）。examples は入り数違いの例（卸値は入れない）。 */
export function matchCount(rows, x) {
  const o = { rows: 0, bad: 0, name: 0, name_price: 0, qty: 0, same: 0, qtyWords: {}, examples: [] };
  for (const r of rows || []) {
    o.rows++;
    const j = MWMATCH.judge(r, { x: x });
    if (j.same) o.same++;
    if (!j.bad) continue;
    o.bad++;
    const k = MWMATCH.kindOf(j);
    if (o[k] !== undefined) o[k]++;
    if (k === "qty") {
      for (const w of (j.qty_amz.length ? j.qty_amz : j.qty_mw))
        o.qtyWords[w.replace(/^\d+/, "N")] = (o.qtyWords[w.replace(/^\d+/, "N")] || 0) + 1;
      if (o.examples.length < 12)
        o.examples.push({ mw: String(r.mw_name || "").slice(0, 70), amz: String(r.amz_name || "").slice(0, 90),
          list: Number(r.list_price) || 0, price: Number(r.price) || 0, why: MWMATCH.whyText(j) });
    }
  }
  return o;
}
export function kickSql(at) {
  const q = (x) => "'" + String(x).replace(/'/g, "''") + "'";
  return "INSERT INTO sync_state (k,v,updated_at) VALUES ('mwcsv.kick'," + q(at) + ","
    + q(at) + ") ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at";
}

/* 8.116 会員のカードを「いますぐ配る」の印（pj-sync の15分ごとの回が拾う）。 */
export function subKickSql(at) {
  const q = (x) => "'" + String(x).replace(/'/g, "''") + "'";
  return "INSERT INTO sync_state (k,v,updated_at) VALUES ('sub.kick'," + q(at) + ","
    + q(at) + ") ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at";
}
/* 8.116 会員のカードの数（チャンネルは下4桁だけ・商品名・値段は出さない）。 */
export const Q_SUB_CARDS =
  "SELECT substr(ch,-4) AS c4, COUNT(*) AS n FROM sub_post "
  + "WHERE COALESCE(msg_id,'')<>'' AND COALESCE(off_at,'')='' AND jan NOT LIKE 'one-%' "
  + "GROUP BY ch ORDER BY ch";
export const Q_SUB_KICK =
  "SELECT k, v, updated_at FROM sync_state WHERE k IN ('sub.kick','sub.kick.last')";
/* Amazon の値段で、カートが新品の最安値より大きく下のまま残っている行の数（直したら 0）。 */
export const Q_AMZ_CART_LOW =
  "SELECT COUNT(*) AS n FROM mw_amz WHERE basis='カート' AND COALESCE(low,0)>0 "
  + "AND COALESCE(price,0)>0 AND price < low * 0.9";
/* sub.kick.last の中身（数だけ）を1行ずつの文にする。 */
export function subKickText(v) {
  let o = {};
  try { o = JSON.parse(String(v || "{}")) || {}; } catch (e) { return ["（読めませんでした）"]; }
  const n = (x) => Number(x) || 0;
  const out = ["配った時刻 " + clean(o.at, 30)];
  if (o.amz) out.push("Amazon の値段を新品の最安値に直した行 " + n(o.amz.n));
  if (o.box) out.push("Shopify の会員用の商品を直した " + n(o.box.done) + "／対象 " + n(o.box.todo)
    + "（失敗 " + n(o.box.fail) + "・残り " + n(o.box.left) + "）" + (o.box.err ? " 理由 " + clean(o.box.err, 60) : ""));
  if (o.px) out.push("配る前に Amazon の値段を取り直した " + n(o.px.done) + "／対象 " + n(o.px.todo)
    + "（60分以内に取った品 " + n(o.px.fresh) + "・取れなかった " + n(o.px.none) + "・残り " + n(o.px.left) + "）");
  if (o.send) {
    out.push("カード：新しく " + n(o.send.sent) + "・書き換え " + n(o.send.edited) + "・失敗 " + n(o.send.fail)
      + "・残り " + n(o.send.left) + (o.send.why ? " 理由 " + clean(o.send.why, 60) : ""));
    for (const p of (o.send.plans || []))
      out.push("　" + clean(p.key, 12) + "：新しく " + n(p.add) + "・書き換え " + n(p.edit)
        + "・そのまま " + n(p.keep) + "・失敗 " + n(p.fail));
  }
  if (o.index) out.push("今週の一覧：ページ " + n(o.index.pages) + "・新しく " + n(o.index.add) + "・書き換え "
    + n(o.index.edit) + "・同じ " + n(o.index.same) + "・失敗 " + n(o.index.fail)
    + (o.index.why ? " 理由 " + clean(o.index.why, 60) : ""));
  for (const c of (o.chs || [])) out.push("出ているカード " + clean(c.key, 12) + "：" + n(c.cards) + "件");
  for (const c of (o.idx || [])) out.push("今週の一覧 " + clean(c.key, 12) + "：" + n(c.n) + "件（" + n(c.pages) + "ページ）");
  for (const k of ["amz_err", "box_err", "send_err", "index_err", "count_err"])
    if (o[k]) out.push(k + "：" + clean(o[k], 120));
  return out;
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
  if (args.includes("--sub-kick")) {
    const now = new Date().toISOString();
    const r = spawnSync(process.execPath, [how.path, "d1", "execute", db,
      local ? "--local" : "--remote", "--command", subKickSql(now)],
      { encoding: "utf8", windowsHide: true });
    console.log(r.status === 0
      ? ("会員のカードをいますぐ配る印を置きました（" + now + "）。pj-sync の15分ごとの回が拾います。")
      : ("印を置けませんでした（終了コード " + r.status + "）"));
    if (r.status !== 0) process.exit(1);
  }
  if (args.includes("--sub-count")) {
    console.log("\n=== 会員のカード（出ている数・チャンネルは下4桁）===");
    const c = q(Q_SUB_CARDS);
    if (!c.ok) console.log("読めませんでした：" + clean(c.err, 200));
    else if (!c.rows.length) console.log("（なし）");
    else for (const r of c.rows) console.log("…" + clean(r.c4, 4) + "：" + (Number(r.n) || 0) + "件");
    const a2 = q(Q_AMZ_CART_LOW);
    if (a2.ok) console.log("カートが新品の最安値より大きく下のままの行：" + (Number(((a2.rows || [])[0] || {}).n) || 0) + "件");
    const k = q(Q_SUB_KICK);
    console.log("\n=== いますぐ配るの記録（数だけ）===");
    if (!k.ok) console.log("読めませんでした：" + clean(k.err, 200));
    else {
      const wait = (k.rows || []).filter((r) => r.k === "sub.kick")[0];
      if (wait) console.log("印が残っています（まだ拾われていません）：" + clean(wait.v, 30));
      const last = (k.rows || []).filter((r) => r.k === "sub.kick.last")[0];
      if (!last) console.log("（まだ配っていません）");
      else for (const line of subKickText(last.v)) console.log(line);
    }
  }
  if (args.includes("--mw-match")) {
    /* 行が多いので、wrangler の出力を大きめに受ける（既定の 1MB では切れる）。 */
    const big = (sql) => {
      const r = spawnSync(process.execPath, [how.path, "d1", "execute", db,
        local ? "--local" : "--remote", "--json", "--command", sql],
        { encoding: "utf8", windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
      if (r.status !== 0) return { ok: false, rows: [], err: "終了コード " + r.status };
      return Object.assign({ ok: true }, parseJsonRows(String(r.stdout || "")));
    };
    let x = "";
    try { const st = big(Q_X); x = ((JSON.parse(((st.rows || [])[0] || {}).v || "{}").settings) || {}).mwMisX || ""; }
    catch (e) { x = ""; }
    const res = big(Q_MATCH);
    if (!res.ok) { console.log("読めませんでした：" + clean(res.err, 200)); process.exit(1); }
    const c = matchCount(res.rows, x);
    /* 公開のログには**件数だけ**（商品名は出さない）。 */
    console.log("\n=== 商品違いの疑い（shared/mwmatch.js・倍率 " + MWMATCH.xOf(x) + "）===");
    console.log("見た行 " + c.rows + "（MW の代表の行で Amazon の値段がある行）");
    console.log("疑い " + c.bad + "件：名前 " + c.name + "／名前と値段 " + c.name_price
      + "／入り数 " + c.qty + "（「同じ商品」と控えた行 " + c.same + "件は疑わない）");
    console.log("入り数違いに使われた言葉：" + JSON.stringify(c.qtyWords));
    /* 8.105 報告のために、例を1回だけログにも出す（--show-examples のときだけ）。
       卸値・仕入れ先の社名は出さない。読み終わったらその実行のログを消す。 */
    if (args.includes("--show-examples"))
      for (const e of c.examples)
        console.log("例：" + clean(e.mw, 70) + " ／ " + clean(e.amz, 90) + " ／ 定価 " + e.list
          + " ／ 売値 " + e.price + " ／ " + clean(e.why, 80));
    /* 例は社内用の Discord へ（卸値・仕入れ先は入れない）。 */
    const hook = process.env.DISCORD_WEBHOOK_URL || "";
    if (hook && c.examples.length) {
      const lines = ["🔎 **商品違いの疑い（入り数違いで残ったもの）の例** " + c.examples.length + "件"
        + "（全体 " + c.bad + "件：名前 " + c.name + "／名前と値段 " + c.name_price + "／入り数 " + c.qty + "）"];
      for (const e of c.examples)
        lines.push("・MW：" + e.mw + "\n　Amazon：" + e.amz + "\n　定価 ¥" + e.list.toLocaleString("en-US")
          + "／売値 ¥" + e.price.toLocaleString("en-US") + "　" + e.why);
      let body = lines.join("\n");
      if (body.length > 1900) body = body.slice(0, 1900) + "…";
      const r = spawnSync("curl", ["-sS", "-X", "POST", "-H", "Content-Type: application/json",
        "--data-binary", "@-", hook], { input: JSON.stringify({ content: body,
          allowed_mentions: { parse: [] } }), encoding: "utf8" });
      console.log(r.status === 0 ? "例を社内用の Discord に送りました（" + c.examples.length + "件）"
                                 : "例を Discord に送れませんでした");
    } else console.log("例は Discord に送っていません（宛先が無いか、例がありません）");
  }
  if (args.includes("--title-len")) {
    /* 8.108 eBay の題名の長さ（いまの題名の表があればそれ、無ければ最初に取り込んだ題名）。 */
    let res = q(qTitleLen(true)), col = "いまの題名（ebay_stat）";
    if (!res.ok) { col = "最初に取り込んだ題名（items.title）"; res = q(qTitleLen(false)); }
    console.log("\n=== 出品済みの無在庫（W-・ItemID あり）の題名の長さ（" + col + "）===");
    if (!res.ok) console.log("読めませんでした：" + clean(res.err, 200));
    else {
      const c = titleLenSum(res.rows);
      console.log("合計 " + c.total + "件");
      for (const k of Object.keys(TITLE_BAND))
        console.log(TITLE_BAND[k] + "：" + c[k].all + "件（売れた実績あり " + c[k].sold
          + "／なし " + c[k].unsold + "）");
      for (const r of res.rows)
        console.log("平均の長さ " + TITLE_BAND[r.band] + (Number(r.won) ? "・売れた" : "・未売") + " " + r.avg_len);
    }
  }
  if (args.includes("--mem-tags")) {
    const res = q(Q_MEM_TAGS);
    console.log("\n=== 会員の Shopify のタグ（会員番号は下4桁だけ）===");
    if (!res.ok) console.log("読めませんでした：" + clean(res.err, 200));
    else if (!res.rows.length) console.log("（会員がいません）");
    else for (const r of res.rows)
      console.log("…" + clean(r.c4, 4) + " | " + clean(r.plan, 12) + " | " + clean(r.state, 12)
        + " | タグ " + (clean(r.tags, 80) || "（なし）") + " | 確かめた " + (clean(r.at, 25) || "まだ")
        + (Number(r.off) ? " | つなぎを外した" : "") + (r.err ? " | 理由 " + clean(r.err, 120) : ""));
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
