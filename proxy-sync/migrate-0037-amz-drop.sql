-- v226：在庫の根拠がない出品を「Amazon 無在庫」で続ける（7.102）
-- デプロイより先に流す。D1 の名前は pj-sync。
--   cd proxy-sync && node d1-exec.mjs migrate-0037-amz-drop.sql
--
-- items は D1 の上限（1表100列）ちょうどなので列を足せない。別の表に持つ。
CREATE TABLE IF NOT EXISTS amz_drop (
  asin       TEXT NOT NULL,
  cond       TEXT NOT NULL,
  at         TEXT,
  why        TEXT,
  created_at TEXT,
  PRIMARY KEY (asin, cond)
);
