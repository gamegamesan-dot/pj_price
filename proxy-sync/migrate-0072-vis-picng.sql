-- 8.89・8.90（カジの依頼）
--
-- 8.89 Shopify で「非公開（Unlisted）」と「海外向けカタログに無い」を
--      管理 API で確かめた結果を、品ごとに控える。確かめた品だけを新しく配る。
--   mw_sub.shop_vis / shop_vis_at
--   one_item.shop_vis / shop_vis_at
--
-- 8.90 「JAN:番号」で写真を取り込んで、使える写真が1枚も無かった JAN を
--      7日間覚える（出品候補の先頭に来ないようにする）。
--   mw_pic_ng
--
-- 列と表を足すだけで、今ある行の中身は変えない。

ALTER TABLE mw_sub ADD COLUMN shop_vis TEXT;
ALTER TABLE mw_sub ADD COLUMN shop_vis_at TEXT;
ALTER TABLE one_item ADD COLUMN shop_vis TEXT;
ALTER TABLE one_item ADD COLUMN shop_vis_at TEXT;

CREATE TABLE IF NOT EXISTS mw_pic_ng (
  jan        TEXT PRIMARY KEY,
  why        TEXT NOT NULL,
  long_px    INTEGER,
  n          INTEGER,
  at         TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mw_pic_ng_at ON mw_pic_ng(at);
