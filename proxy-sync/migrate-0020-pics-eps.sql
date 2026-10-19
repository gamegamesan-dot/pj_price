-- 写真を eBay 保管（EPS）に切り替えた出品の印（2026-10-19）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0020-pics-eps.sql
--
-- 「写真を eBay 保管に切り替え」が通った出品に印を付け、二度切り替えないようにする。
-- まだ印が無い出品（pj-img で出したもの）は PictureSource=Vendor のままなので、
-- 画面の絞り込み「写真の切り替えが必要」で一覧できる。
ALTER TABLE items ADD COLUMN pics_eps    INTEGER NOT NULL DEFAULT 0; -- 1=eBay 保管済み
ALTER TABLE items ADD COLUMN pics_eps_at TEXT;                       -- 切り替えた時刻
ALTER TABLE items ADD COLUMN pics_n      INTEGER;                    -- 切り替え後の枚数
