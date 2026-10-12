-- 相場を調べるときの検索語を行ごとに保存する（2026-10-12）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0017-search-kw.sql
--
-- メルカリ・ヤフオクの検索語は「商品ライン＋キャラクター名」だけに短くして自動で作るが、
-- 短すぎる・長すぎるときは手で直す。直した値をここに残して、出品CSVタブと
-- 販売連携タブの両方で、どの端末からでも同じ検索語を使う。
-- 空文字（''）を送ると消す（自動で作り直す）。
ALTER TABLE items ADD COLUMN search_kw TEXT;
