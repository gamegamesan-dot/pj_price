-- 国内FBA：出品の可否（Listings Restrictions API・7.76）
-- デプロイより先に流す。
--   npx wrangler d1 execute pj-sync --remote --file=./migrate-0029-mw-restrict.sql
--
-- 「出品できる／許可が要る（申請リンク）／出品できない」の3つに分ける。
-- items は100列ちょうど（D1 の上限）なので別表にする。
CREATE TABLE IF NOT EXISTS mw_restrict (
  asin       TEXT NOT NULL,
  cond       TEXT NOT NULL,          -- 'new_new' など conditionType
  state      TEXT,                   -- 'ok' / 'approval' / 'blocked'
  reasons    TEXT,                   -- 理由（messageをつないだもの）
  link       TEXT,                   -- 申請リンク（approval のとき）
  err        TEXT,
  checked_at TEXT,
  created_at TEXT,
  PRIMARY KEY (asin, cond)
);
CREATE INDEX IF NOT EXISTS idx_mw_rst_at    ON mw_restrict(checked_at);
CREATE INDEX IF NOT EXISTS idx_mw_rst_state ON mw_restrict(state);

-- 取得の記録
CREATE TABLE IF NOT EXISTS mw_rst_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT,
  asked      INTEGER,
  done       INTEGER,
  ok_n       INTEGER,
  approval   INTEGER,
  blocked    INTEGER,
  failed     INTEGER,
  left_n     INTEGER,
  calls      INTEGER,
  note       TEXT,
  created_at TEXT
);

-- 仕入れた SKU ごとの控え（7.77）。skus 表に足す。
-- skus は19列なので D1 の100列には遠い。
ALTER TABLE skus ADD COLUMN buy_src  TEXT;      -- 'mw'（MWから）/ 'other'（店舗仕入れなど）
ALTER TABLE skus ADD COLUMN mw_sha   TEXT;      -- MW の社
ALTER TABLE skus ADD COLUMN jan      TEXT;      -- JAN
ALTER TABLE skus ADD COLUMN cost_src INTEGER;   -- 卸値×1.1＋仕入れ送料（円）
CREATE INDEX IF NOT EXISTS idx_skus_src ON skus(buy_src);
CREATE INDEX IF NOT EXISTS idx_skus_jan ON skus(jan);
