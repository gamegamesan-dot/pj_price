-- 8.87（カジの依頼）1点ものの写真を複数枚にする
--
-- 写真はカジが撮った実物の写真だけ。画面が縮めて（長辺 1600px）、横長は
-- 正方形にしてから pj-img（R2）に上げ、その URL を並べて持つ（10枚まで）。
-- 1枚目がメイン（Discord のカードと Shopify の商品の最初の写真）。
--
-- この migrate で足す列
--   one_item.pics     … 写真の並び（JSON：[{url,key,w,h}]）
--   one_item.pics_put … Shopify に読み込んだとき（または写真の直しCSV を
--                       作ったとき）の並び。あとで写真を変えたかを見るのに使う
--
-- 列を足すだけで、今ある行の中身は変えない（前の写真＝KV の1枚はそのまま。
-- 画面で開いて保存すると、新しい並びに入る）。

ALTER TABLE one_item ADD COLUMN pics TEXT;
ALTER TABLE one_item ADD COLUMN pics_put TEXT;
