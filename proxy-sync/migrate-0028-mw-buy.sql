-- MW の仕入れの印（7.68）。端末をまたいで同じ印が見えるように D1 に置く。
-- デプロイより先に流す。
--   npx wrangler d1 execute pj-sync --remote --file=./migrate-0028-mw-buy.sql
CREATE TABLE IF NOT EXISTS mw_buy (
  jan        TEXT PRIMARY KEY,
  qty        INTEGER NOT NULL DEFAULT 1,   -- 仕入れる数量（0 で印を外す）
  by_role    TEXT,                         -- 'admin' / 'staff'（誰が付けたか）
  note       TEXT,
  at         TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mw_buy_at ON mw_buy(at);
