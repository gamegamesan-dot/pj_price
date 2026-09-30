-- 2026-09-30：注文に販売経路（SalesChannel）を持たせる
--   npx wrangler d1 execute pj-sync --remote --file=./migrate-0002-sales-channel.sql
-- ALTER TABLE ADD COLUMN は同じ列を2度足せないので、この回だけ実行する。
-- 新しくD1を作る場合は schema.sql に同じ列が入っているので実行不要。
ALTER TABLE orders      ADD COLUMN sales_channel   TEXT;
ALTER TABLE orders      ADD COLUMN kind            TEXT;
ALTER TABLE orders      ADD COLUMN seller_order_id TEXT;
ALTER TABLE order_queue ADD COLUMN sales_channel   TEXT;
ALTER TABLE order_queue ADD COLUMN kind            TEXT;
ALTER TABLE order_queue ADD COLUMN seller_order_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_kind ON orders(kind, ordered_at);
