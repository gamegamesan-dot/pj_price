-- 2026-09-30：再調達の候補づくり
--   npx wrangler d1 execute pj-sync --remote --file=./migrate-0005-restock.sql
-- ALTER TABLE ADD COLUMN は同じ列を2度足せないので、この回だけ実行する。
-- 新しくD1を作る場合は schema.sql に同じ列が入っているので実行不要。
ALTER TABLE items ADD COLUMN amazon_lowest_n INTEGER;
ALTER TABLE items ADD COLUMN amazon_offers   INTEGER;
ALTER TABLE items ADD COLUMN one_off_known   INTEGER NOT NULL DEFAULT 0;
