-- 2026-09-30：出品開始日時（出品してからの日数を出すため）
--   npx wrangler d1 execute pj-sync --remote --file=./migrate-0004-ebay-start.sql
-- ALTER TABLE ADD COLUMN は同じ列を2度足せないので、この回だけ実行する。
-- 新しくD1を作る場合は schema.sql に同じ列が入っているので実行不要。
ALTER TABLE items ADD COLUMN ebay_start TEXT;
