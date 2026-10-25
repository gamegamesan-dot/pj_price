-- マッチングワールド（MW）の在庫CSVを置く（2026-10-25・段取りA）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0024-mw-stock.sql
--
-- 主キーは**連番**。(jan, sha) は索引にする。
-- 同じ (jan, 社) の行が約169組あるため、(jan, sha) を主キーにすると行が消える
-- （同じ商品を倉庫違い・ロット違いで2行に分けているように見える）。
-- 差分の突き合わせには **(jan, sha, idx)** を使う。idx は同じ (jan, sha) が
-- CSV に現れた順（0,1,2…）。これで行を取り違えずに UPSERT できる。
CREATE TABLE IF NOT EXISTS mw_stock (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  jan        TEXT NOT NULL,
  sha        TEXT NOT NULL,                    -- 社（仕入れ元）
  idx        INTEGER NOT NULL DEFAULT 0,       -- 同じ (jan,社) の何番目か
  kishu      TEXT,                             -- 機種（NS / P5 / b2cchara_figure …）
  name       TEXT,
  list_price INTEGER,                          -- 定価
  release    TEXT,                             -- 発売日
  cond       TEXT,                             -- 新・中（新品 / 新古 / 中古）
  wholesale  INTEGER,                          -- 卸値（**税抜**）
  stock      INTEGER,                          -- 掲載数
  note       TEXT,                             -- 備考
  ship_text  TEXT,                             -- 出荷日（そのままの文字）
  ship_days  INTEGER,                          -- 営業日数（読めないものは 99）
  row_hash   TEXT NOT NULL,                    -- 中身のハッシュ（差分の判定）
  pick       INTEGER NOT NULL DEFAULT 0,       -- JANごとに選んだ仕入れ元か
  seen_at    TEXT NOT NULL,                    -- 最後に CSV にあった時刻
  gone_at    TEXT,                             -- 欠品（CSV から消えた）時刻
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mw_key  ON mw_stock(jan, sha, idx);
CREATE INDEX IF NOT EXISTS idx_mw_jan        ON mw_stock(jan);
CREATE INDEX IF NOT EXISTS idx_mw_seen       ON mw_stock(seen_at);
CREATE INDEX IF NOT EXISTS idx_mw_pick       ON mw_stock(pick, gone_at);
CREATE INDEX IF NOT EXISTS idx_mw_kishu      ON mw_stock(kishu, cond, ship_days, stock);

-- 取り込み1回ぶんの記録（画面の「前回の取り込み」に出す）
CREATE TABLE IF NOT EXISTS mw_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  rows_in    INTEGER NOT NULL DEFAULT 0,       -- CSV の行数
  added      INTEGER NOT NULL DEFAULT 0,
  changed    INTEGER NOT NULL DEFAULT 0,
  same       INTEGER NOT NULL DEFAULT 0,
  gone       INTEGER NOT NULL DEFAULT 0,       -- 欠品にした行
  back       INTEGER NOT NULL DEFAULT 0,       -- 欠品から戻った行
  picked     INTEGER NOT NULL DEFAULT 0,       -- JANごとに選んだ行
  unreadable INTEGER NOT NULL DEFAULT 0,       -- 出荷日が読めなかった行
  warn       TEXT,                             -- 行数が減りすぎたときの警告
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mw_runs_at ON mw_runs(at);
