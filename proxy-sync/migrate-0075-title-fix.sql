-- 8.108（カジの依頼）出品済みの無在庫（W-）の英題を作り直す
--
-- 作り直す出品を選ぶ（閲覧が少なく、まだ1つも売れていない出品から）ために、
-- eBay の出品中リスト（GetMyeBaySelling）と GetItem から取れる値を控える。
-- items はもう 100列（D1 の上限）なので、別の表に持つ。
--   title    … いまの eBay の題名（items.title は最初に取り込んだ題名のまま変えない）
--   sold     … その出品で売れた数（SellingStatus.QuantitySold）
--   watch    … ウォッチしている人の数（WatchCount）
--   views    … 閲覧数（GetItem の HitCount。返らない出品は NULL）
--   views_at … 閲覧数を取った時刻
--
-- 表を足すだけで、今ある行の中身は変えない。
CREATE TABLE IF NOT EXISTS ebay_stat (
  asin       TEXT NOT NULL,
  cond       TEXT NOT NULL,
  item_id    TEXT,
  title      TEXT,
  sold       INTEGER,
  watch      INTEGER,
  views      INTEGER,
  views_at   TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (asin, cond)
);
