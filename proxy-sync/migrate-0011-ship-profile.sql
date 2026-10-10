-- eBayの出品の配送ポリシー名（2026-10-10）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0011-ship-profile.sql
--
-- 「納品待ちで出品中」を警告にするか情報にするかを、推測ではなく
-- eBayから取ったポリシー名で決めるために足す。
-- v124 までは mode='restock' / dropship / restocking から推測していたが、
-- 「出品はすべて W2000、即発送の印の行だけ W1000」に運用が変わると合わなくなる。
--
-- NULL は「まだ取れていない」。取れるまでは今までどおり推測で判定する。
ALTER TABLE items ADD COLUMN ebay_ship_profile TEXT;
