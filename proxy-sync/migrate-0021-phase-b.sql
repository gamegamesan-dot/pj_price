-- フェイズB：FBAで売れたら eBay を自動で直す（2026-10-19）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0021-phase-b.sql
--
-- FBAで売れて販売可能が0になった出品を、まず数量0にして売り越しを止める。
-- 「在庫0時の動作」が再調達の行は、数量0にしたうえで再調達の予定に載せ、
-- 承認（または自動）のときに「売値を pb_want に変える＋数量を1に戻す」を1回で行う。
-- pb_want（再調達の売値）は pj_price が計算して送る（Worker は値付けの式を持たない）。
ALTER TABLE items ADD COLUMN pb_act      TEXT;    -- 予定 'zero'/'restock'/'unknown'
ALTER TABLE items ADD COLUMN pb_why      TEXT;    -- 予定・見送りの理由
ALTER TABLE items ADD COLUMN pb_at       TEXT;    -- 予定を立てた時刻（内訳不明もここ）
ALTER TABLE items ADD COLUMN pb_done_at  TEXT;    -- 数量0／再調達を実行した時刻
ALTER TABLE items ADD COLUMN pb_fail     INTEGER NOT NULL DEFAULT 0;  -- 連続失敗
ALTER TABLE items ADD COLUMN pb_skip     INTEGER NOT NULL DEFAULT 0;  -- 今回は動かさない
ALTER TABLE items ADD COLUMN pb_want     REAL;    -- 再調達の売値（$・pj_price が計算）
ALTER TABLE items ADD COLUMN pb_max_cost INTEGER; -- その売値での仕入値の上限（円）
ALTER TABLE items ADD COLUMN pb_want_at  TEXT;    -- pb_want を受け取った時刻（24時間で古い）

-- 実行のまとめ（画面の「前回の結果」に出す）
CREATE TABLE IF NOT EXISTS pb_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  mode       TEXT NOT NULL,                    -- 'plan' / 'on'
  picked     INTEGER NOT NULL DEFAULT 0,
  zeroed     INTEGER NOT NULL DEFAULT 0,
  restocked  INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  capped     INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pb_runs_at ON pb_runs(at);

-- 1行ごとの記録（何をしたか・前後の数量と売値）
CREATE TABLE IF NOT EXISTS pb_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  asin       TEXT NOT NULL,
  cond       TEXT NOT NULL,
  item_id    TEXT,
  kind       TEXT NOT NULL,                    -- 'zero' / 'restock'
  from_qty   INTEGER,
  to_qty     INTEGER,
  from_price REAL,
  to_price   REAL,
  ok         INTEGER NOT NULL DEFAULT 0,
  why        TEXT
);
CREATE INDEX IF NOT EXISTS idx_pb_log_at ON pb_log(at);
CREATE INDEX IF NOT EXISTS idx_pb_log_key ON pb_log(asin, cond, at);
