-- 2026-10-01：Amazonの出品明細（値段と状態）
--   npx wrangler d1 execute pj-sync --remote --file=./migrate-0006-offers.sql
-- ALTER TABLE ADD COLUMN は同じ列を2度足せないので、この回だけ実行する。
-- 新しくD1を作る場合は schema.sql に同じ列が入っているので実行不要。
ALTER TABLE items ADD COLUMN amazon_offers_json TEXT;
