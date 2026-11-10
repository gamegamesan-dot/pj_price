-- 7.129（【V の続き】の4）手数料の「だめ」を切り分けて控える
--
-- カジの切り分け（B00C1W039S・3Dマウスパッド『春』）で、
--   ① いまと同じ（FBA で出す）        … だめ
--   ② 自分で発送（FBA にしない）      … 取れた ¥290
--   ③ FBA の指定を付けない            … 取れた ¥290
--   ④ 値段だけ変える（FBA・1,000円）  … だめ
-- となった。**値段でも市場でも ASIN の形でもなく、その ASIN で
-- 「FBA（Amazon から出す）の見積もりが出せない」**のが原因。
-- だめだった 773件を同じやり方で自動で分類し、分かった行は
-- 毎回取り直さない（30日に1回だけ確かめ直す）ようにする。
--
-- fee_kind … ''／NULL 未分類
--            'fba_ng' FBA の見積もりが出せない（自分で発送なら取れる）
--            'price'  送っている値段が原因（値段を変えれば取れる）
--            'other'  ASIN か市場が原因（どの送り方でもだめ）
-- fee_mfn  … 1＝販売手数料と消費税は「自分で発送」の**実額**。
--            FBA（配送代行・在庫管理）だけ⚙の目安を足して出す。

ALTER TABLE mw_amz ADD COLUMN fee_kind    TEXT;
ALTER TABLE mw_amz ADD COLUMN fee_kind_at TEXT;
ALTER TABLE mw_amz ADD COLUMN fee_mfn     INTEGER;
CREATE INDEX IF NOT EXISTS idx_mw_amz_fee_kind ON mw_amz(fee_kind, fee_kind_at);
