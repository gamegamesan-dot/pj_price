-- v215：電池・危険物の申告を ASIN ごとに覚える（7.93）
-- デプロイより先に流す。D1 の名前は pj-sync。
--   cd proxy-sync && node d1-exec.mjs migrate-0035-amz-dg.sql
--
CREATE TABLE IF NOT EXISTS amz_dg (
  asin       TEXT PRIMARY KEY,
  batteries  INTEGER,
  dg         TEXT,
  by_role    TEXT,
  at         TEXT,
  created_at TEXT
);
