-- 8.118（カジの依頼）会員の「紹介者」（紹介のお礼の計算に使う）
--
-- 入れるのは**紹介者の呼び名か紹介コード**（例：NAKANO）だけ。氏名・住所・メールは入れない。
--   ref_code … 紹介者の呼び名・紹介コード（空＝まだ入れていない／'（本人）'＝紹介者なし）
--   ref_at   … 最後に入れた・直した時刻
--
-- 今いる会員は空のまま。会員番号の下4桁が 5347 の会員だけ、カジの指示で
-- 「紹介者なし（本人）」として残す（その下4桁の会員が1人だけのときに限る・空のときだけ）。
ALTER TABLE mem ADD COLUMN ref_code TEXT;
ALTER TABLE mem ADD COLUMN ref_at   TEXT;
UPDATE mem SET ref_code = '（本人）', ref_at = replace(datetime('now'), ' ', 'T') || 'Z'
 WHERE substr(cust, -4) = '5347' AND COALESCE(ref_code, '') = ''
   AND (SELECT COUNT(*) FROM mem WHERE substr(cust, -4) = '5347') = 1;
