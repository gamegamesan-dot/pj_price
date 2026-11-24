-- 8.99（カジの依頼）MW 無在庫が売れたら「どこで買うか」を知らせる
--
-- 知らせた eBay の明細（注文番号・明細番号）を控えて、同じ明細を二度知らせない。
-- 買い手の名前・住所・連絡先は持たない（注文番号と商品だけ）。
--   state … sent（知らせた）／cancel（取り消し）／hand（手元在庫から送る行）
--
-- 表を足すだけで、今ある行の中身は変えない。

CREATE TABLE IF NOT EXISTS buy_note (
  order_id   TEXT NOT NULL,
  line_id    TEXT NOT NULL,
  sku        TEXT,
  jan        TEXT,
  qty        INTEGER,
  usd        REAL,
  pick       TEXT,
  mw_cost    INTEGER,
  amz_cost   INTEGER,
  state      TEXT NOT NULL,
  sent_at    TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (order_id, line_id)
);
CREATE INDEX IF NOT EXISTS idx_buy_note_at ON buy_note(created_at);
