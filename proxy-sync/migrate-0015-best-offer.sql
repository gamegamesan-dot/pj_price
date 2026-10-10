-- ベストオファーの金額と、Revise の失敗の記録（2026-10-10）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0015-best-offer.sql
--
-- 値下げCSVで「Auto decline amount cannot be greater than or equal to the Buy It Now
-- price」（22003）で失敗する行があった。値段を下げるときは、ベストオファーの
-- 自動拒否額・自動承諾額も一緒に下げる必要がある。
-- そのために、いまの設定を eBay の取り込みで持っておく。
ALTER TABLE items ADD COLUMN ebay_bo         INTEGER;  -- 1=ベストオファーあり／NULLは未取得
ALTER TABLE items ADD COLUMN ebay_bo_accept  REAL;     -- 自動承諾額（BestOfferAutoAcceptPrice）
ALTER TABLE items ADD COLUMN ebay_bo_decline REAL;     -- 自動拒否額（MinimumBestOfferPrice）
-- アップロード結果で Failure だった理由（写真が小さい・ベストオファー金額など）。
-- 直って次の Revise が通ったら消す。
ALTER TABLE items ADD COLUMN revise_err    TEXT;
ALTER TABLE items ADD COLUMN revise_err_at TEXT;
