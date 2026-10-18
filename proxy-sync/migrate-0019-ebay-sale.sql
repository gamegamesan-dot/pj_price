-- eBayのセール（Promotional Sale／Markdown Manager）の中身を残す（2026-10-18）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0019-ebay-sale.sql
--
-- セール中の出品は値段を変えられない（eBay のエラー 21919248）。
-- その行を「失敗」と数えずに外せるよう ebay_sale は前からあるが、
-- セール前の値段と終わる時刻が分からないと、画面で「いくら引かれているか」が出せない。
-- GetMyeBaySelling の SellingStatus.PromotionalSaleDetails から
-- OriginalPrice（セール前の値段）と EndTime（終わる時刻）を取って残す。
-- いまの売値（ebay_price＝CurrentPrice）は**セール後の値段**なので、
-- 利益と赤字の判定は今までどおり ebay_price で計算すればよい。
ALTER TABLE items ADD COLUMN ebay_sale_orig REAL;  -- セール前の値段（$）
ALTER TABLE items ADD COLUMN ebay_sale_end  TEXT;  -- セールが終わる時刻（ISO）
