-- 「Amazonで調べる」1つのボタンで ①ASIN → ②出品の可否 → ③実売価格 と進める（7.79）
-- デプロイより先に流す。
--   npx wrangler d1 execute pj-sync --remote --file=./migrate-0030-mw-scan.sql
--
-- 段ごとに「最後に調べた時刻」を分ける。1つの checked_at だと、
-- ①で ASIN を引いた行が「さっき調べた行」になって、③の価格の対象から
-- 外れてしまう（一度も値段を取れないまま終わる）。
ALTER TABLE mw_amz ADD COLUMN asin_at  TEXT;   -- ① JAN→ASIN を最後に試した時刻
ALTER TABLE mw_amz ADD COLUMN price_at TEXT;   -- ③ 実売価格を最後に試した時刻
CREATE INDEX IF NOT EXISTS idx_mw_amz_asin_at  ON mw_amz(asin_at);
CREATE INDEX IF NOT EXISTS idx_mw_amz_price_at ON mw_amz(price_at);

-- いまある行の引き継ぎ。
-- ・①は全部「checked_at に試した」とみなす（ASINが見つからなかった行も、
--   err の期限が来れば今までどおり再挑戦になる）
-- ・③は ASIN が入っている行だけ「checked_at に試した」とみなす。
--   ASIN が無い行は値段を試したことが無いので NULL のままにする
UPDATE mw_amz SET asin_at = checked_at WHERE asin_at IS NULL;
UPDATE mw_amz SET price_at = checked_at
 WHERE price_at IS NULL AND COALESCE(asin,'') <> '';
