-- 直近30日に eBay で売れて数量0になっている行に、あとから「売れた値段で保つ」印を付ける
-- （2026-10-22・一度だけ流す。migrate-0023-sold-keep.sql のあとで）
--
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./backfill-0023-sold-keep.sql
--
-- 印を立てるのは jobOrders で「初めて見た明細」だけなので、v176 を入れる前に
-- 売れた行には遡って付かない。そこを埋める。
--
-- 保つ値段は **items.ebay_price（いまの出品価格）**。注文の落札額は使わない
-- （送料や Best Offer で下がった額は「売れる値段」ではないため）。
-- 数量0の行は自動値下げ（mdSkip が「数量0」で返す）も売値の自動反映（rvSkip も同じ）も
-- 触らないので、ebay_price は**売れた時点の出品価格のまま**残っている。
--
-- 外す行（印を立てても再出品できず、絞り込み「対応が必要」を埋めるだけになる）
--   ・一点物（one_off=1）／一点物かどうかが未確定（one_off_known=0）
--   ・無在庫（dropship=1。いまは対象外）
--   ・再調達中（restocking=1。売値の追従が見る）
--   ・すでに印が立っている行・出品していない行・売値が分からない行

UPDATE items SET
  sold_keep    = 1,
  sold_price   = ebay_price,
  sold_kept_at = (SELECT MAX(o.ordered_at) FROM orders o
                   WHERE o.channel='ebay' AND o.asin=items.asin AND o.cond=items.cond),
  sk_act       = NULL,
  sk_why       = NULL,
  sk_fail      = 0,
  updated_at   = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE scope='ebay'
  AND COALESCE(ebay_item_id,'')<>''
  AND COALESCE(ebay_qty,0)=0
  AND COALESCE(ebay_price,0)>0
  AND COALESCE(sold_keep,0)=0
  AND COALESCE(one_off,0)=0
  AND COALESCE(one_off_known,0)=1
  AND COALESCE(dropship,0)=0
  AND COALESCE(restocking,0)=0
  AND (SELECT MAX(o.ordered_at) FROM orders o
        WHERE o.channel='ebay' AND o.asin=items.asin AND o.cond=items.cond)
      >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days');
