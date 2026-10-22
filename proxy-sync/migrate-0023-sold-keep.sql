-- 売れた値段で保ち、同じ値段で再出品する（2026-10-22）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0023-sold-keep.sql
--
-- 自動値下げで下げている途中に売れた行は、その値段が「売れる値段」だと分かった
-- ということなので、それ以上下げない（いままでも止めていたが、一度も値下げして
-- いない行は止まらず、売値の自動反映では**値上げ**が起きていた）。
-- そのうえで、売れて数量0になった行を**同じ値段のまま数量1に戻す**。
ALTER TABLE items ADD COLUMN sold_keep    INTEGER NOT NULL DEFAULT 0;  -- 売れた値段で保つ
ALTER TABLE items ADD COLUMN sold_price   REAL;     -- 売れた時点の**出品価格**（$）
ALTER TABLE items ADD COLUMN sold_kept_at TEXT;     -- 売れた日時（eBayの注文）
ALTER TABLE items ADD COLUMN sk_act       TEXT;     -- 再出品の予定 'relist' / NULL
ALTER TABLE items ADD COLUMN sk_why       TEXT;     -- できない理由（対応が必要に出す）
ALTER TABLE items ADD COLUMN sk_at        TEXT;     -- 判定した時刻
ALTER TABLE items ADD COLUMN sk_done_at   TEXT;     -- 再出品した時刻
ALTER TABLE items ADD COLUMN sk_fail      INTEGER NOT NULL DEFAULT 0;  -- 連続失敗

-- 仕入れ先（将来のマッチングワールド）。いまは使わないが、buySource() が
-- 見る形だけ先に用意しておく。取り込みを1本足せば切り替わる。
ALTER TABLE items ADD COLUMN mw_low       REAL;     -- 仕入れ値（円・送料込み）
ALTER TABLE items ADD COLUMN mw_low_at    TEXT;     -- その取得日時（24時間で古い）
ALTER TABLE items ADD COLUMN mw_n         INTEGER;  -- 同じ値段の出品者数（相当）
ALTER TABLE items ADD COLUMN mw_stock     INTEGER;  -- 在庫 1=あり／0=なし／NULL=不明

-- 実行のまとめ（画面の「前回の結果」に出す）
CREATE TABLE IF NOT EXISTS sk_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  mode       TEXT NOT NULL,                    -- 'confirm' / 'auto' / 'approve'
  picked     INTEGER NOT NULL DEFAULT 0,
  relisted   INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  capped     INTEGER NOT NULL DEFAULT 0,
  ended      INTEGER NOT NULL DEFAULT 0,       -- 出品が終了していた件数
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sk_runs_at ON sk_runs(at);

-- 1行ごとの記録（売れた値段と、そのときの仕入れ値）
CREATE TABLE IF NOT EXISTS sk_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  asin       TEXT NOT NULL,
  cond       TEXT NOT NULL,
  item_id    TEXT,
  kind       TEXT NOT NULL,                    -- 'relist'
  price      REAL,                             -- 保った売値（$）
  buy_low    REAL,                             -- そのときの仕入れ値（円）
  buy_src    TEXT,                             -- 'amazon' / 'mw' / 'hand'
  ok         INTEGER NOT NULL DEFAULT 0,
  why        TEXT
);
CREATE INDEX IF NOT EXISTS idx_sk_log_at ON sk_log(at);
CREATE INDEX IF NOT EXISTS idx_sk_log_key ON sk_log(asin, cond, at);
