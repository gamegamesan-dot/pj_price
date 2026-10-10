-- 中古の行にも「新品の最安値」を持つ（2026-10-10）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0014-amazon-new-low.sql
--
-- 中古の最安値が新品より高いことがある（例：中古 ¥9,719／新品 ¥6,280）。
-- 新品が安く買えるなら「中古がその値段で売れる」前提は成り立たないので、
-- 値付けの基準は min（中古の最安値, 新品の最安値）にする。
-- 判定も表示も pj_price 側で行うので、Worker は数字だけ持つ。
ALTER TABLE items ADD COLUMN amazon_new_low REAL;     -- 新品の最安値（本体＋送料）
ALTER TABLE items ADD COLUMN amazon_new_n   INTEGER;  -- その値と同じ値段の出品者数
ALTER TABLE items ADD COLUMN amazon_new_at  TEXT;     -- 取った時刻
