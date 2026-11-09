-- 取り込みの知らせの中身を見られるようにし、売り切れの誤報をなくす（7.121・【Q】）
-- cd proxy-sync && node d1-exec.mjs migrate-0047-mw-nt.sql
-- DB: pj-sync
--
-- ① 取り込みの各回から「新しく欠品」「新しく出てきた」「戻った」の一覧を開く。
--    欠品（gone_at）と新しく出てきた（created_at）は今の列で引けるが、
--    「欠品から戻った」は数（mw_runs.back）しか残っていなかったので、
--    戻った日時を行に残す。
ALTER TABLE mw_stock ADD COLUMN back_at TEXT;
CREATE INDEX IF NOT EXISTS idx_mw_back ON mw_stock(back_at);

-- ② 「注文した」の印（日付つき）。
--    MW に注文したあとは CSV から消えても「注文前に売り切れました」ではない。
ALTER TABLE mw_buy ADD COLUMN ordered_at TEXT;
ALTER TABLE mw_buy ADD COLUMN ordered_by TEXT;

-- ③ 在庫CSVを取りに行った記録から、その回の一覧を開けるように、
--    取り込みに使った日時（mw_stock.seen_at と同じ値）を残す。
ALTER TABLE mw_csv_runs ADD COLUMN stock_at TEXT;
