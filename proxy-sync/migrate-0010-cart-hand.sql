-- カートリッジのみ（-C）の手元在庫数（2026-10-05）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0010-cart-hand.sql
--
-- カートリッジのみの出品は FBA に送らず手元から発送する。eBayの数量と手元にある数が
-- 合っているかを見張るために、手元の数を持つ。pj_price が「+1するCSV」を書き出すときに送る。
-- NULL は「手元の数をまだ送っていない」という意味にする（そのときは見張らない）。
ALTER TABLE items ADD COLUMN hand_qty INTEGER;
