-- 2026-09-30：手元在庫フラグ（FBA納品前にeBayへ出した行）
--   npx wrangler d1 execute pj-sync --remote --file=./migrate-0003-on-hand.sql
-- ALTER TABLE ADD COLUMN は同じ列を2度足せないので、この回だけ実行する。
-- 新しくD1を作る場合は schema.sql に同じ列が入っているので実行不要。
ALTER TABLE items ADD COLUMN on_hand INTEGER NOT NULL DEFAULT 0;
