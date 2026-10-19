-- 再調達中の売値を Amazon最安値に追従させる（2026-10-19）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0022-restock-price.sql
--
-- 再調達中（restocking=1）の行は「売れてから Amazon で買い直す」ので、
-- Amazon最安値が動くと利益がそのまま動く。最安値が上がれば赤字になり、
-- 下がればもっと安く出せる。これまでは「売値の見直しの自動反映」に乗せていたが、
-- そちらは値上げだけ・確認モード・1回20%までの丸めがあり、
-- 「再調達で赤字」の警告が出たまま確認待ちで止まっていた。
--
-- この行だけを別の仕組みで**上げも下げも自動で**追従させる。
-- 目標の売値（rk_want）は pj_price が計算して送る（Worker は値付けの式を持たない）。
ALTER TABLE items ADD COLUMN rk_want     REAL;     -- 目標の売値（$・pj_price が計算）
ALTER TABLE items ADD COLUMN rk_floor    REAL;     -- 最低売値（$）。これより下げない
ALTER TABLE items ADD COLUMN rk_low      REAL;     -- 基準にした Amazon最安値（円）
ALTER TABLE items ADD COLUMN rk_n        INTEGER;  -- 最安グループの人数（2人未満は下げを保留）
ALTER TABLE items ADD COLUMN rk_max_cost INTEGER;  -- その売値での仕入値の上限（円）
ALTER TABLE items ADD COLUMN rk_want_at  TEXT;     -- rk_want を受け取った時刻（24時間で古い）
ALTER TABLE items ADD COLUMN rk_at       TEXT;     -- 予定を立てた時刻
ALTER TABLE items ADD COLUMN rk_done_at  TEXT;     -- 反映した時刻
ALTER TABLE items ADD COLUMN rk_fail     INTEGER NOT NULL DEFAULT 0;  -- 連続失敗

-- 実行のまとめ（画面の「前回の結果」に出す）
CREATE TABLE IF NOT EXISTS rk_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  mode       TEXT NOT NULL,                    -- 'auto' / 'confirm' / 'approve'
  picked     INTEGER NOT NULL DEFAULT 0,
  up         INTEGER NOT NULL DEFAULT 0,       -- 上げた件数
  down       INTEGER NOT NULL DEFAULT 0,       -- 下げた件数
  zeroed     INTEGER NOT NULL DEFAULT 0,       -- Amazonの在庫が消えて数量0にした件数
  failed     INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  held       INTEGER NOT NULL DEFAULT 0,       -- 最安グループ1人で下げを保留した件数
  capped     INTEGER NOT NULL DEFAULT 0,       -- 1日の上限で翌日に回した件数
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rk_runs_at ON rk_runs(at);

-- 1行ごとの記録（前後の売値つき）
CREATE TABLE IF NOT EXISTS rk_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  asin       TEXT NOT NULL,
  cond       TEXT NOT NULL,
  item_id    TEXT,
  kind       TEXT NOT NULL,                    -- 'up' / 'down' / 'zero'
  from_price REAL,
  to_price   REAL,
  low        REAL,                             -- そのときの Amazon最安値（円）
  ok         INTEGER NOT NULL DEFAULT 0,
  why        TEXT
);
CREATE INDEX IF NOT EXISTS idx_rk_log_at ON rk_log(at);
CREATE INDEX IF NOT EXISTS idx_rk_log_key ON rk_log(asin, cond, at);
