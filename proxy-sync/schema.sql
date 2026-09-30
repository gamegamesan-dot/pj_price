-- pj-sync の D1 スキーマ（フェイズA）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./schema.sql
--
-- 突き合わせの主キーは「ASIN＋新品/中古」。せどりすとSKUは個体ごと（仕入日・原価入り）に
-- 変わるため、商品単位の items と個体単位の skus に分ける。
-- 購入者の個人情報（氏名・住所・メール）はどの表にも置かない。

-- 商品単位。eBayの出品1つに対して1行。
CREATE TABLE IF NOT EXISTS items (
  asin             TEXT NOT NULL,
  cond             TEXT NOT NULL,              -- 'new' / 'used'
  scope            TEXT NOT NULL DEFAULT 'unknown',  -- 'ebay' / 'out' / 'unknown'
  title            TEXT,
  ebay_item_id     TEXT,
  ebay_sku         TEXT,                       -- eBayのCustomLabel（E-<ASIN>[-U] など）
  ebay_qty         INTEGER,
  ebay_price       REAL,
  ebay_currency    TEXT,
  ebay_seen_at     TEXT,                       -- eBayから取り込んだ時刻
  fba_available    INTEGER,
  fba_inbound      INTEGER,
  fba_reserved     INTEGER,
  fba_seen_at      TEXT,
  mode             TEXT,                       -- 'hold' / 'restock' / 'end'（pj_priceの在庫0時の動作）
  one_off          INTEGER NOT NULL DEFAULT 0,
  fba_link         INTEGER NOT NULL DEFAULT 0,
  amazon_lowest    REAL,
  amazon_lowest_at TEXT,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (asin, cond)
);
CREATE INDEX IF NOT EXISTS idx_items_scope ON items(scope);
CREATE INDEX IF NOT EXISTS idx_items_sku   ON items(ebay_sku);

-- 個体単位。せどりすとSKU（カテゴリ-仕入日-状態コード-ASIN-仕入原価）。
CREATE TABLE IF NOT EXISTS skus (
  seller_sku        TEXT PRIMARY KEY,          -- Amazonの出品SKU＝せどりすとSKU
  asin              TEXT NOT NULL,
  cond              TEXT NOT NULL,
  cond_code         TEXT,                      -- N / UM / UVG / UG / UA / UKN
  prefix            TEXT,                      -- game / hobby / toy / dvd …
  scope             TEXT NOT NULL DEFAULT 'unknown',
  purchased_on      TEXT,                      -- 仕入日（SKUの2番目）
  cost              INTEGER,                   -- 仕入原価（SKUの5番目）
  ebay_custom_label TEXT,
  title             TEXT,
  fba_available     INTEGER,
  fba_inbound       INTEGER,
  fba_reserved      INTEGER,
  fba_seen_at       TEXT,
  active            INTEGER NOT NULL DEFAULT 1, -- 0 は在庫0の過去SKU（照会対象から外す）
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skus_key    ON skus(asin, cond);
CREATE INDEX IF NOT EXISTS idx_skus_active ON skus(active, scope);

-- 注文。保存するのは注文ID・SKU・数量・金額・日時・状態だけ。
CREATE TABLE IF NOT EXISTS orders (
  channel    TEXT NOT NULL,                    -- 'amazon' / 'ebay'
  order_id   TEXT NOT NULL,
  line_id    TEXT NOT NULL DEFAULT '',
  sku        TEXT,
  asin       TEXT,
  cond       TEXT,
  qty        INTEGER,
  amount     REAL,
  currency   TEXT,
  ordered_at TEXT,
  status     TEXT,
  created_at TEXT NOT NULL,
  -- 販売経路。Amazon.co.jp は売上、Non-Amazon は Amazon が作る返送か自分のMCF。
  sales_channel   TEXT,
  kind            TEXT,    -- 'sale' / 'removal' / 'mcf'（出品者注文IDが PJ- で始まる）
  seller_order_id TEXT,
  PRIMARY KEY (channel, order_id, line_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_at  ON orders(ordered_at);
CREATE INDEX IF NOT EXISTS idx_orders_kind ON orders(kind, ordered_at);
CREATE INDEX IF NOT EXISTS idx_orders_key ON orders(asin, cond);

-- Amazonの注文明細（getOrderItems）の待ち行列。
-- getOrderItems は 0.5回/秒しか呼べないので、1回の実行では上限件数まで取り、
-- 残りは次回に回す。done_at が入っている注文は二度と明細を取り直さない。
CREATE TABLE IF NOT EXISTS order_queue (
  order_id   TEXT PRIMARY KEY,
  status     TEXT,
  ordered_at TEXT,
  sales_channel   TEXT,
  kind            TEXT,
  seller_order_id TEXT,
  lines      INTEGER,
  tries      INTEGER NOT NULL DEFAULT 0,
  done_at    TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_pending ON order_queue(done_at, ordered_at);

-- 検出したイベント。dedup_key が同じものは二重に入らない（通知の重複防止）。
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  asin        TEXT,
  cond        TEXT,
  sku         TEXT,
  dedup_key   TEXT NOT NULL UNIQUE,
  detail      TEXT,                             -- JSON（個人情報は入れない）
  created_at  TEXT NOT NULL,
  notified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_pending ON events(notified_at, created_at);
CREATE INDEX IF NOT EXISTS idx_events_key     ON events(asin, cond, created_at);

-- 各取り込みの最終時刻・カーソル（差分取得用）
CREATE TABLE IF NOT EXISTS sync_state (
  k          TEXT PRIMARY KEY,
  v          TEXT,
  updated_at TEXT NOT NULL
);

-- 実行ログ。CPU時間は Worker の中から測れないため入れない（Cloudflare側のログで見る）。
CREATE TABLE IF NOT EXISTS sync_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,                   -- orders / inventory / rollcall / sweep / pricing / notify
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  elapsed_ms   INTEGER,                         -- 壁時計（I/O待ちを含む）
  subrequests  INTEGER NOT NULL DEFAULT 0,
  pages        INTEGER NOT NULL DEFAULT 0,
  skus         INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  events       INTEGER NOT NULL DEFAULT 0,
  errors       INTEGER NOT NULL DEFAULT 0,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_at ON sync_runs(started_at);
