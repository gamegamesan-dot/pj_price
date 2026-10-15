-- 売値の見直しを pj-sync から eBay に直接反映する（2026-10-15）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0018-auto-review.sql
--
-- いままで「売値の見直し」は価格更新CSVを書き出して File Exchange に
-- アップロードしていた。これを Cron（1日1回）で ReviseInventoryStatus に置き換える。
-- 上げる値（rv_want）・最低利益ライン（rv_floor）・相場の判断（rv_kind）・
-- その売値での仕入値の上限（rv_max_cost）は **pj_price が計算して送る**。
-- Worker は値付けの式を持たない（md_step・restock_max_cost と同じ考え方）。
ALTER TABLE items ADD COLUMN rv_want     REAL;     -- 出すべき売値（$）
ALTER TABLE items ADD COLUMN rv_floor    REAL;     -- 最低利益ライン（$・これより下げない）
ALTER TABLE items ADD COLUMN rv_kind     TEXT;     -- 相場の判断 rec/match/none/skip
ALTER TABLE items ADD COLUMN rv_max_cost INTEGER;  -- rv_want で出したときの仕入値の上限（円）
ALTER TABLE items ADD COLUMN rv_at       TEXT;     -- 目標を受け取った時刻
ALTER TABLE items ADD COLUMN rv_done_at  TEXT;     -- 最後に eBay へ反映した時刻
ALTER TABLE items ADD COLUMN rv_fail     INTEGER NOT NULL DEFAULT 0;  -- 連続失敗の回数

-- 自動反映の実行結果（1日1行が基本）。確認モードの回も残す。
CREATE TABLE IF NOT EXISTS rv_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,                   -- 実行時刻（UTC・ISO）
  mode       TEXT NOT NULL,                   -- 'confirm'（予定だけ）/ 'auto' / 'approve'
  picked     INTEGER NOT NULL DEFAULT 0,      -- 対象になった件数（上限を掛ける前）
  changed    INTEGER NOT NULL DEFAULT 0,      -- 売値を上げた件数
  zeroed     INTEGER NOT NULL DEFAULT 0,      -- 見送りで数量0にした件数
  failed     INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  capped     INTEGER NOT NULL DEFAULT 0,      -- 1日の上限で翌日に回した件数
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rv_runs_at ON rv_runs(at);

-- 1行＝1回の変更。変更前後の売値を残すので、あとから何をしたか必ず追える。
CREATE TABLE IF NOT EXISTS rv_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  asin       TEXT NOT NULL,
  cond       TEXT NOT NULL,
  item_id    TEXT,
  kind       TEXT NOT NULL,                   -- 'up'（値上げ）/ 'zero'（見送りで数量0）
  from_price REAL,
  to_price   REAL,
  ok         INTEGER NOT NULL DEFAULT 0,
  why        TEXT                             -- 失敗の理由・上限で丸めた旨など
);
CREATE INDEX IF NOT EXISTS idx_rv_log_at ON rv_log(at);
CREATE INDEX IF NOT EXISTS idx_rv_log_key ON rv_log(asin, cond, at);
