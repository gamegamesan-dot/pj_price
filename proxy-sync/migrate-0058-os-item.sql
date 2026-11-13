-- 6.193／7.143 海外の一般のお客さん向け Shopify（os-）の商品（カジの依頼・2026-11-13）
--
-- os_item … eBay 用の出品CSVと一緒に Shopify 用の商品CSVを書き出した商品を控える。
--   jan        … 商品（1商品＝1行）
--   handle     … Shopify の Handle（os-<JAN>）／sku … W-<JAN>（eBay と同じ）
--   name       … そのときの商品名（知らせに出すだけ）
--   usd/fx/pct … 書き出したときの eBay の売値（USD）・為替・⚙の割合
--   price/qty  … 書き出した Shopify の値段（円）と数量
--   wholesale  … そのときの MW の卸値（値段が変わったかを見る元）
--   stock      … そのときの MW 在庫
--   at         … 書き出した日時
--   fix_at     … 直しが要るようになった日時（空＝要らない）
--   fix_why    … gone（品切れ）／price（値段が変わった）／両方
--   fix_qty    … 直したあとの数量／fix_price … 直したあとの値段（円）
--   done_at    … Shopify に読み込んだ日時
--
-- 会員向け（sub-）とは別の商品なので、ここには**会員向けの行を入れない**。

CREATE TABLE IF NOT EXISTS os_item (
  jan        TEXT PRIMARY KEY,
  handle     TEXT NOT NULL,
  sku        TEXT NOT NULL,
  name       TEXT,
  usd        REAL,
  fx         REAL,
  pct        INTEGER,
  price      INTEGER,
  qty        INTEGER,
  wholesale  INTEGER,
  stock      INTEGER,
  at         TEXT,
  fix_at     TEXT,
  fix_why    TEXT,
  fix_qty    INTEGER,
  fix_price  INTEGER,
  done_at    TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_os_item_fix ON os_item(fix_at);
CREATE INDEX IF NOT EXISTS idx_os_item_at ON os_item(at);
