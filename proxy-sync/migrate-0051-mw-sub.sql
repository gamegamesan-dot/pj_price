-- 7.130（【U の改】の1）会員に出す商品の印・販売数の上限・販売価格
--
-- 仕入れタブ（刈取）の行に「会員に出す」の印を付け、販売数の上限と
-- 販売価格（税込）を控える。ここから Shopify の商品CSV を作る。
--
-- on_sale … 1＝会員に出す（0 や行なしは出さない）
-- max_qty … 販売数の上限（Shopify の Inventory quantity になる）
-- price   … 販売価格（税込・円。Shopify の Price になる）
-- grades  … 見せるプラン（'light,standard,premium,monitor'。
--           空＝全プランに見せる。Shopify の grade-* タグになる）
-- put_at  … 最後に Shopify 用 CSV に書き出した日時（SKU の日付に使う）

CREATE TABLE IF NOT EXISTS mw_sub (
  jan        TEXT PRIMARY KEY,
  on_sale    INTEGER NOT NULL DEFAULT 0,
  max_qty    INTEGER,
  price      INTEGER,
  grades     TEXT,
  by_role    TEXT,
  put_at     TEXT,
  at         TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mw_sub_on_sale ON mw_sub(on_sale, at);
