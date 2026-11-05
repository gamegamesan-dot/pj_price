/* 0035（7.93）：電池・危険物の申告を ASIN ごとに覚える表。
   wrangler deploy より**先に**当てる。
   npx wrangler d1 execute pj-sync-db --remote --file proxy-sync/migrate-0035-amz-dg.sql */
CREATE TABLE IF NOT EXISTS amz_dg (
  asin       TEXT PRIMARY KEY,
  batteries  INTEGER,
  dg         TEXT,
  by_role    TEXT,
  at         TEXT,
  created_at TEXT
);
