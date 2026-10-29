-- v208：ランキングを「大きい分類」の順位にそろえる（7.91）
-- デプロイより先に流す。
--   node d1-exec.mjs migrate-0033-rank-group.sql
--
-- せどりすと と同じ見え方にする。小分類（classificationRanks）の順位だと
-- 売れ行きが良く見えすぎて仕入れの判断に使えない。
--   例：チョイプラ アモデウス（JAN 4580033110113）
--       小分類 11,481位（ロボットのプラモデル・模型）
--       大分類 948,040位（ホビー）  ← せどりすと はこちら
--
-- rank / rank_cat を**大分類（displayGroupRanks）**にし、
-- 小分類は rank_sub / rank_sub_cat に別に持つ（添える程度）。
ALTER TABLE mw_amz  ADD COLUMN rank_sub     INTEGER;  -- 小分類の順位
ALTER TABLE mw_amz  ADD COLUMN rank_sub_cat TEXT;     -- 小分類の名前
ALTER TABLE jan_map ADD COLUMN rank_sub     INTEGER;
ALTER TABLE jan_map ADD COLUMN rank_sub_cat TEXT;
CREATE INDEX IF NOT EXISTS idx_mw_amz_rank ON mw_amz(rank);

-- いまある行の rank は**小分類**の順位なので、小分類の側へ移しておく。
-- 大分類は引き直しで埋まる（①の段が3日ごとに引き直す・7.91）。
-- 引き直す前に大分類を持っているふりをしないよう、rank / rank_cat は空にする。
UPDATE mw_amz SET rank_sub = rank, rank_sub_cat = rank_cat
 WHERE rank_sub IS NULL AND rank IS NOT NULL;
UPDATE mw_amz SET rank = NULL, rank_cat = ''
 WHERE rank_sub IS NOT NULL;
UPDATE jan_map SET rank_sub = rank, rank_sub_cat = rank_cat
 WHERE rank_sub IS NULL AND rank IS NOT NULL;
UPDATE jan_map SET rank = NULL, rank_cat = ''
 WHERE rank_sub IS NOT NULL;

-- 引き直しの対象にするため、①を試した時刻を古くする（3日より前）。
UPDATE mw_amz SET asin_at = '2020-01-01T00:00:00Z'
 WHERE COALESCE(asin,'') <> '';
