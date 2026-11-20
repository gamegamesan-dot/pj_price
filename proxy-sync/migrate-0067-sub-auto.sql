-- 8.80（カジの依頼）会員向けの商品リスト配信（Discord）を自動にする
--
-- v328 まで、会員向けの配信で自動だったのは「印の付いた品を平日の朝に送る」
-- 所だけで、候補を選ぶ・印を付ける・Shopify に会員用の商品を作る の3つは
-- PC の画面で人がやっていた。pj-sync が定時に自分でやるようにする。
--
-- この migrate で足すもの
--   mw_sub.auto_at      … 自動配信が選んで印を付けた日時（空＝カジが付けた印）
--   mw_sub.shop_pid     … Shopify の商品（管理 API の ID）
--   mw_sub.shop_iid     … Shopify の在庫の品目（在庫を 0 にするのに使う）
--   mw_sub.shop_at      … 管理 API ではじめて作った日時（SKU の日付に使う）
--   mw_sub.shop_err     … 最後に作れなかった理由（作れたら空に戻す）
--   mw_sub.shop_zero_at … MW の在庫切れで Shopify の在庫を 0 にした日時
--   sub_stop            … 配信前のチェックで止めた行の控え（理由つき）
--
-- どれも列と表を足すだけで、今ある行の中身は変えない。

ALTER TABLE mw_sub ADD COLUMN auto_at TEXT;
ALTER TABLE mw_sub ADD COLUMN shop_pid TEXT;
ALTER TABLE mw_sub ADD COLUMN shop_iid TEXT;
ALTER TABLE mw_sub ADD COLUMN shop_at TEXT;
ALTER TABLE mw_sub ADD COLUMN shop_err TEXT;
ALTER TABLE mw_sub ADD COLUMN shop_zero_at TEXT;

CREATE TABLE IF NOT EXISTS sub_stop (
  jan        TEXT PRIMARY KEY,
  why        TEXT,
  name       TEXT,
  at         TEXT,
  first_at   TEXT,
  off_at     TEXT,
  n          INTEGER,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sub_stop_at ON sub_stop(at);
