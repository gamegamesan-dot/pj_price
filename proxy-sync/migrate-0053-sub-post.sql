-- 8.11（【Y】）会員向け Discord の配信と、Shopify の注文の取り込み
--
-- sub_post  … 送ったカードの記録。**同じ商品を同じチャンネルに二重に送らない**
--              ための控えで、出し直すときは msg_id でそのカードを書き換える。
--              残り数（qty − sold）もここで持つ。
-- sub_order … Shopify の注文。**氏名・住所・メールは入れない**
--              （顧客は Shopify の注文番号だけで追う）。
--              同じ CSV を2回読んでも二重に数えないよう (order_no,sku) で一意。
-- mw_sub.loaded_at … 「Shopify に読み込みました」の印。
--              CSV を書き出しただけでは Shopify に入ったか pj には分からないので、
--              **カジが印を付けた商品だけ**を配信に載せる。
--              そのときの販売価格（mw_sub.price）がカードに出る値になる。

CREATE TABLE IF NOT EXISTS sub_post (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  jan        TEXT NOT NULL,
  ch         TEXT NOT NULL,                  -- Discord のチャンネルID
  plan       TEXT NOT NULL,                  -- monitor / light / standard / premium
  msg_id     TEXT NOT NULL,                  -- 送ったメッセージID（書き換えに使う）
  price      INTEGER,                        -- 送ったときの販売価格（税込）
  qty        INTEGER NOT NULL DEFAULT 0,     -- 出した点数
  sold       INTEGER NOT NULL DEFAULT 0,     -- 売れた点数
  sold_out   INTEGER NOT NULL DEFAULT 0,     -- 1＝完売
  at         TEXT NOT NULL,                  -- 送った日時
  edited_at  TEXT,                           -- 最後に書き換えた日時
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_post_one ON sub_post(jan, ch);
CREATE INDEX IF NOT EXISTS idx_sub_post_at ON sub_post(at);

CREATE TABLE IF NOT EXISTS sub_order (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no   TEXT NOT NULL,                  -- Shopify の注文番号（#1001 など）
  sku        TEXT NOT NULL,                  -- SUB-<JAN>-<YYYYMMDD>
  jan        TEXT NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 0,
  price      INTEGER,                        -- 1点の値段（税込）
  at         TEXT,                           -- 注文日時（CSV の Created at）
  src        TEXT,                           -- 読み込んだファイルの印
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_order_one ON sub_order(order_no, sku);
CREATE INDEX IF NOT EXISTS idx_sub_order_jan ON sub_order(jan, at);

ALTER TABLE mw_sub ADD COLUMN loaded_at TEXT;
