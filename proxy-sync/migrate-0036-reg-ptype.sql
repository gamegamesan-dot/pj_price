-- v217：登録の記録に「どの種類で送ったか」を残す（7.95）
-- デプロイより先に流す。D1 の名前は pj-sync。
--   cd proxy-sync && node d1-exec.mjs migrate-0036-reg-ptype.sql
--
ALTER TABLE mw_reg_log ADD COLUMN ptype TEXT;
ALTER TABLE mw_reg_log ADD COLUMN ptype_try TEXT;
