-- 無在庫出品の印（2026-10-05）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0008-dropship.sql
--
-- ALTER TABLE ADD COLUMN は何度でも実行できる命令ではないので、
-- 既に適用済みのときは "duplicate column name: dropship" が出る（そのときは何もしない）。
--
-- 無在庫出品＝手元にもFBAにも在庫を持たず、売れてから仕入れる出品。
-- CustomLabel が M-<ASIN>（中古 M-<ASIN>-U）の行は取り込みで自動的に 1 になる。
-- 既存の出品（E- やせどりすとSKU）は CustomLabel を変えずに、pj_price のボタンで印を付ける。
-- 印が立っている行は、FBAに在庫が無いまま出しているのが正常なので
-- 売り越し系の警告・通知を出さない（代わりに売れたときへ「要仕入れ」を出す）。
ALTER TABLE items ADD COLUMN dropship INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_items_dropship ON items(dropship);
