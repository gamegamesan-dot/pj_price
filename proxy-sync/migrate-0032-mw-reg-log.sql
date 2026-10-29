-- v205：Amazon への登録を API で行う（putListingsItem・7.90）
-- デプロイより先に流す。
--   node d1-exec.mjs migrate-0032-mw-reg-log.sql
--   （または npx wrangler d1 execute pj-sync --remote --file=./migrate-0032-mw-reg-log.sql）
--
-- 1件ずつ PUT するので、行ごとの結果をそのまま残す。
-- フラットファイル（POST_FLAT_FILE_LISTINGS_DATA）は 2025-07-31 に廃止されたので、
-- Feeds API ではなく Listings Items API を使う。
CREATE TABLE IF NOT EXISTS mw_reg_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  sku        TEXT NOT NULL,
  asin       TEXT,
  jan        TEXT,
  price      INTEGER,
  cond       TEXT,              -- 'new_new' など
  ok         INTEGER NOT NULL DEFAULT 0,
  status     TEXT,              -- Amazon の status（ACCEPTED / INVALID）
  sub_id     TEXT,              -- submissionId
  issues     TEXT,              -- 指摘（JSON 配列）
  err        TEXT,              -- 送れなかった理由（HTTP とコード）
  by_role    TEXT,              -- 'admin'
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mw_reg_log_at  ON mw_reg_log(at);
CREATE INDEX IF NOT EXISTS idx_mw_reg_log_sku ON mw_reg_log(sku, at);
CREATE INDEX IF NOT EXISTS idx_mw_reg_log_ok  ON mw_reg_log(ok, at);
