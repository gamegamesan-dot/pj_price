-- eBay優先の印（2026-10-10）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0013-ebay-first.sql
--
-- Amazonで売ったほうが利益が大きい商品は、eBayの下限を「Amazon同等ライン」まで
-- 引き上げて安売りしない。ただし
--   ・Amazonの最安値が高いだけで実際には売れていない商品
--   ・eBayで Sold（実績）を作りたい商品
-- は、その引き上げをやめたい。その行に立てる印。
ALTER TABLE items ADD COLUMN ebay_first INTEGER NOT NULL DEFAULT 0;
