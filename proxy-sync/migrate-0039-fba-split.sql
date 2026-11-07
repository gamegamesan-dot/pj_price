-- FBA手数料を「配送代行」と「在庫管理」に分けて控える（7.106）
-- cd proxy-sync && node d1-exec.mjs migrate-0039-fba-split.sql
-- DB: pj-sync
--
-- せどりすと の内訳（FBA 289＝配送代行288＋在庫管理1）と並べて見るため。
-- Amazon は FBAFees の IncludedFeeDetailList に内訳を入れてくる。
ALTER TABLE mw_amz ADD COLUMN fee_fba_ship  INTEGER;   -- 配送代行手数料
ALTER TABLE mw_amz ADD COLUMN fee_fba_store INTEGER;   -- 在庫管理手数料
