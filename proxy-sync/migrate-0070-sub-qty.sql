-- 8.83（カジの依頼）お一人の上限を Shopify の商品にも入れる
--
-- 会員用の商品に、プランごとの上限のタグ（qty-<プラン>-<点数>）を付ける。
-- テーマのスニペット（shopify/snippets/member-qty-guard.liquid）が、
-- 買う人のプランのタグ（grade-◯◯）と突き合わせて数量を抑える。
-- 上限やカードの数が変わったら入れ替えるので、入れた中身を控える。
--
-- この migrate で足す列
--   mw_sub.shop_q … 最後に Shopify に入れた上限のタグ
--                   （例 'light-1,standard-2,premium-5'。空は付けていない）
--
-- 列を足すだけで、今ある行の中身は変えない。

ALTER TABLE mw_sub ADD COLUMN shop_q TEXT;
