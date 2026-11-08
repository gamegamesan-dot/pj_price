-- 登録の直前に値段を取り直す（7.115・【O】）
-- cd proxy-sync && node d1-exec.mjs migrate-0044-reg-price.sql
-- DB: pj-sync
--
-- 2026-11-08：薔薇と椿（JAN 4570101051127）を届く前に Amazon に登録したら、
-- 売値が ¥5,800（古い控え）になった。実際は新品の出品者0人で、
-- 中古の最安値 ¥7,168＋送料 ¥265＝¥7,433。
-- 送る直前に新品と中古の両方を取り直し、新品が0人なら
-- 中古の最安値×⚙の掛け率（既定1.2倍）で出す。
--
-- mw_amz … 中古の最安値と、それを取った日時（一覧に出す）
ALTER TABLE mw_amz ADD COLUMN used_low INTEGER;
ALTER TABLE mw_amz ADD COLUMN used_n   INTEGER;
ALTER TABLE mw_amz ADD COLUMN used_at  TEXT;
-- mw_reg_log … 新規登録（put）と売値直し（price）を見分ける＋値段の根拠
ALTER TABLE mw_reg_log ADD COLUMN kind      TEXT;
ALTER TABLE mw_reg_log ADD COLUMN price_src TEXT;
ALTER TABLE mw_reg_log ADD COLUMN price_why TEXT;
