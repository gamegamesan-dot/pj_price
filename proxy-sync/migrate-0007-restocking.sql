-- 2026-10-01：再調達中（mode='restock'）の行の監視用
--   npx wrangler d1 execute pj-sync --remote --file=./migrate-0007-restocking.sql
-- ALTER TABLE ADD COLUMN は同じ列を2度足せないので、この回だけ実行する。
-- 新しくD1を作る場合は schema.sql に同じ列が入っているので実行不要。
-- restocking … 再調達で出し直した「いまの状態」。
-- mode（'hold'/'restock'/'end'）は出品リストで決める「在庫0のときの動作」で、別物。
ALTER TABLE items ADD COLUMN restocking INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN restock_at TEXT;
ALTER TABLE items ADD COLUMN restock_price REAL;
ALTER TABLE items ADD COLUMN restock_max_cost INTEGER;
ALTER TABLE items ADD COLUMN restock_skip_acc INTEGER;
