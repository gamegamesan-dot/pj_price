-- 3日ごとの値下げを pj-sync から eBay に直接反映する（2026-10-11）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0016-auto-markdown.sql
--
-- いままでは値下げCSVを書き出して File Exchange にアップロードしていた。
-- これを Cron（1日1回）で ReviseFixedPriceItem に置き換える。
-- 値下げ幅は「出品時（または自動値下げを初めて有効にした時点の売値）」で決めて
-- 保存し、途中で変えない。式は pj_price 側の設定（為替・手数料・重量）で変わるので、
-- Worker は決まった数字だけを持つ（restock_max_cost と同じ考え方）。
ALTER TABLE items ADD COLUMN md_step  REAL;     -- 1回の値下げ幅（$・最低1）
ALTER TABLE items ADD COLUMN md_start REAL;     -- 幅を決めたときの開始価格（$）
ALTER TABLE items ADD COLUMN md_floor REAL;     -- 幅を決めたときの最低売値（$）
ALTER TABLE items ADD COLUMN md_n     INTEGER;  -- 幅を決めたときの回数（既定10）
ALTER TABLE items ADD COLUMN md_done  INTEGER NOT NULL DEFAULT 0;  -- 自動で下げた回数
-- eBayのセール（Markdown Manager／Promotional sale）が設定されている出品。
-- 1 なら自動値下げをとばす（セール価格と二重に下がるのを防ぐ）。NULL は未取得。
ALTER TABLE items ADD COLUMN ebay_sale INTEGER;

-- 自動値下げの実行結果（1日1行が基本）。Discord の通知とこの表を見れば動きが追える。
CREATE TABLE IF NOT EXISTS md_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,        -- 実行時刻（UTC・ISO）
  mode       TEXT NOT NULL,        -- 'plan'（予定だけ表示）/ 'on'（eBayを変える）
  picked     INTEGER NOT NULL DEFAULT 0,   -- 対象になった件数（上限を掛ける前）
  changed    INTEGER NOT NULL DEFAULT 0,   -- 実際に下げた件数
  failed     INTEGER NOT NULL DEFAULT 0,   -- 失敗した件数
  skipped    INTEGER NOT NULL DEFAULT 0,   -- とばした件数
  capped     INTEGER NOT NULL DEFAULT 0,   -- 1日の上限で持ち越した件数
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_md_runs_at ON md_runs(at);
