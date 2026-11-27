-- 8.110（カジの依頼）会員の Shopify の顧客タグ（member-list・grade-<プラン>）
--
-- 「手でつなぐ」で Discord のロールは付くが、Shopify の顧客にタグが付かず、
-- 会員品のページが「会員専用のページです」になっていた（テーマはタグで見分ける）。
-- pj が付け外しするタグの控え。値は**タグの名前だけ**（氏名・メールは持たない）。
--   shop_tags    … いま Shopify の顧客に付いている pj のタグ（member-list・grade-…）
--   shop_tag_at  … 最後に Shopify と突き合わせた時刻
--   shop_tag_err … 付けられなかった理由（権限が足りない・顧客がいない など）
--   shop_tag_off … つなぎを外したので、タグを付けない（つなぎ直す・支払いで 0 に戻す）
--
-- 列を足すだけで、今ある行の中身は変えない。
ALTER TABLE mem ADD COLUMN shop_tags    TEXT;
ALTER TABLE mem ADD COLUMN shop_tag_at  TEXT;
ALTER TABLE mem ADD COLUMN shop_tag_err TEXT;
ALTER TABLE mem ADD COLUMN shop_tag_off INTEGER NOT NULL DEFAULT 0;
