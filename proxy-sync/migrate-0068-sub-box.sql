-- 8.81（カジの依頼）会員便の送料を実額に合わせる（箱ものの「送料用の重さ」）
--
-- 会員便（Shopify：マーケット → 日本 → 配送）は重さの段で送料が決まる。
-- 宅配便・レターパックプラスで送る箱ものは、実際の重さのままだと
-- クリックポストの段に入って送料が足りなかった。箱ものだけ、送り方ごとに
-- 決めた「送料用の重さ」を Shopify に入れて、実額の段に乗せる。
--
-- この migrate で足す列（どちらも Shopify に入れた中身の控え）
--   mw_sub.shop_g  … 最後に Shopify に入れた重さ（g）。**実際の重さではない**
--                    （実際の重さは mw_amz.size_g のまま・書き換えない）
--   mw_sub.shop_ov … 1＝海外向けの商品リストから外した
--
-- 列を足すだけで、今ある行の中身は変えない。

ALTER TABLE mw_sub ADD COLUMN shop_g INTEGER;
ALTER TABLE mw_sub ADD COLUMN shop_ov INTEGER;
