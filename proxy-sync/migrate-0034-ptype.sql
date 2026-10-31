-- v214：商品の種類ごとの必須項目（7.92）
-- デプロイより先に流す。
--   node d1-exec.mjs migrate-0034-ptype.sql
--
-- 相乗り出品（LISTING_OFFER_ONLY）でも、種類によっては
--   '電池本体、電池が必要な商品' は必須ですが、入力されていません（90220）
--   '危険物規制' は必須ですが、入力されていません（90220）
-- で断られる。種類は ASIN ごとに違うので、
--   ・mw_amz.ptype … その ASIN の本当の種類（Catalog の productTypes）
--   ・amz_ptype    … 種類ごとの必須項目（Product Type Definitions・14日）
-- を控える。
ALTER TABLE mw_amz ADD COLUMN ptype TEXT;
CREATE TABLE IF NOT EXISTS amz_ptype (
  ptype      TEXT PRIMARY KEY,
  req        TEXT,
  props      TEXT,
  err        TEXT,
  at         TEXT,
  created_at TEXT
);
