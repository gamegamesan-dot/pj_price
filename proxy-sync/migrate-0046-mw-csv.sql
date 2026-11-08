-- MW の在庫CSVを pj-sync が自分で取り込む（7.120・【P】）
-- cd proxy-sync && node d1-exec.mjs migrate-0046-mw-csv.sql
-- DB: pj-sync
--
-- いままで在庫CSVは「人が MW から落として画面に読ませる」しかなかった。
-- 取り込まないと欠品が分からず売り越しになるので、pj-sync が1時間ごとに
-- 「変わったか」を見て、変わったときだけ取り込む。
--
-- mw_csv_runs … 取りに行った1回ぶんの記録（⚙の「最近の取得」に10件ずつ出す）
--   src          … 'auto'（Cron）／'hand'（⚙のボタン）
--   http         … HEAD または GET の応答（200・304・404 など）
--   changed      … 前回と変わっていたか
--   took         … 本体を取ったか（変わっていなければ取らない）
--   bytes        … 取った大きさ
--   rows_in      … 読めた行数
--   added / changed_rows / gone … 足した・変わった・今回新しく欠品にした行
--   elapsed_ms   … かかった時間
--   ok           … 取り込めたか
--   why          … 取り込まなかった・失敗した理由
CREATE TABLE IF NOT EXISTS mw_csv_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  src          TEXT NOT NULL DEFAULT 'auto',
  http         INTEGER NOT NULL DEFAULT 0,
  changed      INTEGER NOT NULL DEFAULT 0,
  took         INTEGER NOT NULL DEFAULT 0,
  bytes        INTEGER NOT NULL DEFAULT 0,
  rows_in      INTEGER NOT NULL DEFAULT 0,
  added        INTEGER NOT NULL DEFAULT 0,
  changed_rows INTEGER NOT NULL DEFAULT 0,
  gone         INTEGER NOT NULL DEFAULT 0,
  elapsed_ms   INTEGER NOT NULL DEFAULT 0,
  ok           INTEGER NOT NULL DEFAULT 0,
  why          TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mw_csv_runs_at ON mw_csv_runs(at);

-- 取り込み1回ぶんの記録に「自動か手動か」を足す
-- （画面の「前回の取り込み」に出す）。
ALTER TABLE mw_runs ADD COLUMN src TEXT NOT NULL DEFAULT 'hand';
