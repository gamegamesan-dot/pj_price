-- 8.22 1点もの（秋葉原などで仕入れた商品）の登録と配信（カジの依頼・2026-11-14）
--
-- one_item … 1点ものの登録。MW の無在庫（mw_sub）とは別の表。
--   id         … 連番。Shopify の Handle は one-<id>、SKU は ONE-<id>-<日付>
--   name       … 商品名（カジが入れる）
--   jan / asin … どちらも無くてよい。あれば Amazon の値段と手数料を自動で出す
--   cond       … 新品／中古／cond_note … 状態のメモ（会員のカードに出す）
--   cost       … 仕入原価（会員には出さない）／price … 販売価格（税込）
--   qty        … 数量（既定 1）／sold … 取り込んだ注文の点数
--   ship_kind  … 送料の区分（カードの「送料」に出す文）
--   note       … メモ（会員のカードに出す）
--   pic_key    … 写真の置き場（KV のキー）。写真そのものは KV に置く
--   amz_*      … Amazon の販売価格・手数料・取った日時／gross … 見込みの粗利
--   pre_at     … #目玉商品-先行（プレミアム）に出した時刻
--   open_at    … #目玉商品（スタンダード以上）に出した時刻
--   loaded_at  … Shopify に読み込んだ印（これが付いた商品だけ配信に載る）
--   put_at     … Shopify 用 CSV に出した印
--   off        … 取り下げ（1＝配信しない）
--
-- 写真は**カジが撮った写真だけ**（Amazon・MW の画像は使わない）。
-- 送ったカードの控えは sub_post を使う（jan に 'one-<id>' を入れる）。

CREATE TABLE IF NOT EXISTS one_item (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  handle     TEXT NOT NULL,
  name       TEXT NOT NULL,
  jan        TEXT,
  asin       TEXT,
  cond       TEXT,
  cond_note  TEXT,
  cost       INTEGER,
  price      INTEGER,
  qty        INTEGER NOT NULL DEFAULT 1,
  sold       INTEGER NOT NULL DEFAULT 0,
  ship_kind  TEXT,
  note       TEXT,
  pic_key    TEXT,
  pic_name   TEXT,
  pic_type   TEXT,
  amz_price  INTEGER,
  amz_fee    INTEGER,
  amz_basis  TEXT,
  amz_at     TEXT,
  gross      INTEGER,
  pre_at     TEXT,
  open_at    TEXT,
  loaded_at  TEXT,
  put_at     TEXT,
  off        INTEGER NOT NULL DEFAULT 0,
  at         TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_one_item_at ON one_item(at DESC);
CREATE INDEX IF NOT EXISTS idx_one_item_live ON one_item(off, loaded_at);
CREATE INDEX IF NOT EXISTS idx_one_item_jan ON one_item(jan);
