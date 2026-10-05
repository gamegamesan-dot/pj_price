-- 予約済み（reservedQuantity）の内訳（2026-10-05）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0009-reserved-detail.sql
--
-- 「予約済み」には3つの内訳がある（getInventorySummaries の inventoryDetails）。
--   pendingCustomerOrderQuantity  … 顧客注文（本当に売れた）
--   pendingTransshipmentQuantity  … FC間の移管
--   fcProcessingQuantity          … FCでの受領・処理中（納品した直後はここに入る）
-- 合計しか持っていなかったため、納品直後の「FC処理中」を売れたと誤判定し、
-- 「予約済みのみ（Amazonで注文済み）」を納品した10件すべてに出していた。
--
-- NULL は「内訳をまだ取っていない」という意味にする（既存の行）。
-- 内訳が取れていない行は、これまでどおり合計で判定する（警告を取りこぼさないため）。
ALTER TABLE skus  ADD COLUMN fba_res_cust  INTEGER;
ALTER TABLE skus  ADD COLUMN fba_res_trans INTEGER;
ALTER TABLE skus  ADD COLUMN fba_res_proc  INTEGER;
ALTER TABLE items ADD COLUMN fba_res_cust  INTEGER;
ALTER TABLE items ADD COLUMN fba_res_trans INTEGER;
ALTER TABLE items ADD COLUMN fba_res_proc  INTEGER;
