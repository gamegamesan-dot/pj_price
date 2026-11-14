-- 8.27（カジの依頼）会員カードの送料を商品ごとに正しく出す
--
-- 起きていたこと
--   #リスト-プレミアム のカードで、フィギュア（S.H.Figuarts など）にも
--   「クリックポスト（1本 ¥200／2本以上 ¥600）」と出ていた。
--   クリックポストは 34×25cm・厚さ3cm・1kg までなので、箱は送れない。
--   原因は、送料の**名前まで「重さの段」から取っていた**こと。
--
-- この migrate で足す列
--   mw_sub.ship_way … 送り方の手の上書き（空＝自動）。
--                     'cp'（クリックポスト）/'letter'（レターパックプラス）/
--                     'compact'（宅急便コンパクト）/'box60'/'box80'/'box'
--                     表は shared/shopcsv.js の SHIP_WAYS の1か所だけ。
--   mw_amz.size_wid … 採寸の短辺（cm）
--   mw_amz.size_hei … 採寸の厚さ（cm）
--     これまで長辺（size_long）と容積（size_cm3）だけ控えていたので、
--     「厚さ3cm 以内か」を決められなかった。Amazon（Catalog）からは
--     3辺とも返ってくるので、ここに控える。既にある行は「Amazonで調べる」の
--     引き直し（3日ごと）で順に埋まる。

ALTER TABLE mw_sub ADD COLUMN ship_way TEXT;
ALTER TABLE mw_amz ADD COLUMN size_wid REAL;
ALTER TABLE mw_amz ADD COLUMN size_hei REAL;
