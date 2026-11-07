-- サイズ区分（在庫管理手数料の目安に使う）7.108
-- cd proxy-sync && node d1-exec.mjs migrate-0040-size-tier.sql
-- DB: pj-sync
--
-- SP-API の手数料（getMyFeesEstimates）には在庫管理手数料（保管料）が
-- 入っていないので、画面で⚙の目安を足す。その目安を選ぶために、
-- Catalog の dimensions から寸法・重さとサイズ区分を控える。
ALTER TABLE mw_amz ADD COLUMN size_tier TEXT;      -- 's'(小型) / 'm'(標準) / 'l'(大型)
ALTER TABLE mw_amz ADD COLUMN size_cm3  INTEGER;   -- 体積（cm3）
ALTER TABLE mw_amz ADD COLUMN size_long REAL;      -- 長辺（cm）
ALTER TABLE mw_amz ADD COLUMN size_g    INTEGER;   -- 重さ（g）
