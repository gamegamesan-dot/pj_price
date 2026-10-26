-- JAN から ASIN を引くための控え（7.67）
-- デプロイより先に流す。
--   npx wrangler d1 execute pj-sync --remote --file=./migrate-0027-jan-map.sql
--
-- なぜ別の表にするか：
--   items は **すでにちょうど100列**（D1 が1つの結果に返せる上限・7.55）なので、
--   jan の列を足せない。足すと /status と Cron の各ジョブが
--   「too many columns in result set」で落ちる。
--   JAN は1商品に1つなので、別表に出しても引き当ては1対1で済む。
CREATE TABLE IF NOT EXISTS jan_map (
  jan        TEXT PRIMARY KEY,
  asin       TEXT,      -- 見つかった ASIN（見つからなければ NULL）
  name       TEXT,      -- Amazon の商品名
  rank       INTEGER,
  rank_cat   TEXT,
  src        TEXT,      -- どこで分かったか（'catalog' / 'mw' / 'hand'）
  err        TEXT,      -- 見つからなかった理由
  at         TEXT,      -- 最後に調べた時刻
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jan_map_asin ON jan_map(asin);
CREATE INDEX IF NOT EXISTS idx_jan_map_at   ON jan_map(at);
