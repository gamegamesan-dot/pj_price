-- 自動の取り直しの記録を見られるようにする（7.122・【R】）
-- cd proxy-sync && node d1-exec.mjs migrate-0048-mw-auto.sql
-- DB: pj-sync
--
-- 毎時37分の自動の回が動いているか分からなかった（記録が
-- 「ぜんぶ通ったとき」しか残らず、落ちた回・オフだった回は1行も残らなかった）。
-- ⚙で「日時・段ごとの件数・かかった時間・止まった理由」を見られるようにする。
--   asin_n    … ASIN・順位を引いた件数（これまで残していなかった）
--   ms        … かかった時間（ミリ秒）
--   stopped   … 止まった理由（time / limit / off など。段ごとに並べる）
--   err       … 例外のとき、その文
--   mode      … そのときの⚙の設定（on / off）
--   per_hour  … そのときの「1時間ぶんの件数」
--   fee_ng    … 手数料が取れなかった件数
--   fee_left  … 手数料の残り（次回に回した分）
--   asin_left … ASIN の残り
ALTER TABLE mw_auto_runs ADD COLUMN asin_n   INTEGER;
ALTER TABLE mw_auto_runs ADD COLUMN ms       INTEGER;
ALTER TABLE mw_auto_runs ADD COLUMN stopped  TEXT;
ALTER TABLE mw_auto_runs ADD COLUMN err      TEXT;
ALTER TABLE mw_auto_runs ADD COLUMN mode     TEXT;
ALTER TABLE mw_auto_runs ADD COLUMN per_hour INTEGER;
ALTER TABLE mw_auto_runs ADD COLUMN fee_ng   INTEGER;
ALTER TABLE mw_auto_runs ADD COLUMN fee_left INTEGER;
ALTER TABLE mw_auto_runs ADD COLUMN asin_left INTEGER;
