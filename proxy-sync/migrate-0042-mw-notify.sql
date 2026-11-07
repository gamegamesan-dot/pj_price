-- 取り込みのたびの知らせで「もう知らせた商品」を控える（7.110）
-- cd proxy-sync && node d1-exec.mjs migrate-0042-mw-notify.sql
-- DB: pj-sync
--
-- MW の在庫CSVを取り込んだとき、在庫切れ（CSV から消えた・在庫0）と
-- 新入荷を1通にまとめて知らせる。在庫0の行は次の取り込みでも在庫0のままなので、
-- 同じ商品を毎回知らせないよう、知らせた JAN をここに控える。
--   kind … 'sold'（在庫切れ）／'new'（新入荷）
CREATE TABLE IF NOT EXISTS mw_notify (
  jan        TEXT NOT NULL,
  kind       TEXT NOT NULL,
  at         TEXT,
  created_at TEXT,
  PRIMARY KEY (jan, kind)
);
CREATE INDEX IF NOT EXISTS idx_mw_notify_at ON mw_notify (at DESC);
