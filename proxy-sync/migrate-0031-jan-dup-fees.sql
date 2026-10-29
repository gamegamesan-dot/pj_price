-- v204：JAN重複の候補・商品ごとの手数料・自動の取り直し（7.84〜7.86）
-- デプロイより先に流す。
--   npx wrangler d1 execute pj-sync --remote --file=./migrate-0031-jan-dup-fees.sql

-- ===== 1) JAN 1つに ASIN が複数ある場合（7.84）=====
-- jan_map は jan が主キーで ASIN を1つしか持てず、mwAsinFind は複数当たっても
-- 最初の1件だけ採って残りを捨てていた（例：JAN 4573102666987 でウルトラマンと
-- スター・ウォーズの2商品）。候補をそのまま控えて、人が選べるようにする。
ALTER TABLE jan_map ADD COLUMN cands     TEXT;      -- 候補（JSON 配列）
ALTER TABLE jan_map ADD COLUMN cand_n    INTEGER;   -- 候補の件数（0=未確認）
ALTER TABLE jan_map ADD COLUMN cand_at   TEXT;      -- 候補を控えた時刻
ALTER TABLE jan_map ADD COLUMN picked_at TEXT;      -- 人が選んだ時刻
ALTER TABLE jan_map ADD COLUMN picked_by TEXT;      -- 'hand'
CREATE INDEX IF NOT EXISTS idx_jan_map_candn  ON jan_map(cand_n);
CREATE INDEX IF NOT EXISTS idx_jan_map_candat ON jan_map(cand_at);

-- ===== 2) 商品ごとの手数料（Product Fees API・7.85）=====
-- 一律の率・一律のFBA手数料だと せどりすと の内訳とずれる。
-- getMyFeesEstimates（FBA）で商品ごとに取り、手数料の消費税も含める。
ALTER TABLE mw_amz ADD COLUMN fee_ref   INTEGER;   -- 販売手数料（税抜）
ALTER TABLE mw_amz ADD COLUMN fee_fba   INTEGER;   -- FBA手数料（配送代行＋在庫管理）
ALTER TABLE mw_amz ADD COLUMN fee_tax   INTEGER;   -- 手数料の消費税
ALTER TABLE mw_amz ADD COLUMN fee_total INTEGER;   -- 合計（Amazon が返す総額）
ALTER TABLE mw_amz ADD COLUMN fee_base  INTEGER;   -- その手数料を出したときの売値
ALTER TABLE mw_amz ADD COLUMN fee_at    TEXT;      -- 最後に取った時刻
ALTER TABLE mw_amz ADD COLUMN fee_err   TEXT;      -- 取れなかった理由
CREATE INDEX IF NOT EXISTS idx_mw_amz_fee_at ON mw_amz(fee_at);

-- ===== 3) 自動の取り直しの記録（7.86）=====
CREATE TABLE IF NOT EXISTS mw_auto_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT,
  kind       TEXT,        -- 'cron' / 'hand'
  price_n    INTEGER,     -- 価格を取った件数
  fee_n      INTEGER,     -- 手数料を取った件数
  rst_n      INTEGER,     -- 可否を調べた件数
  calls      INTEGER,
  left_n     INTEGER,
  note       TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mw_auto_at ON mw_auto_runs(at);
