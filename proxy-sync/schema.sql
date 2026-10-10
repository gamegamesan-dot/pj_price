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
  ebay_start       TEXT,                       -- 出品開始日時（ListingDetails.StartTime）
  ebay_ship_profile TEXT,                      -- 配送ポリシー名（SellerProfiles）。NULLは未取得
  fba_available    INTEGER,
  fba_inbound      INTEGER,
  fba_reserved     INTEGER,
  /* 予約済みの内訳。NULL は「内訳をまだ取っていない」（合計で判定する）。
     cust  … 顧客注文（本当に売れた。これが1以上のときだけ「予約済みのみ」とする）
     trans … FC間の移管／proc … FCでの受領・処理中（納品した直後はここに入る） */
  fba_res_cust     INTEGER,
  fba_res_trans    INTEGER,
  fba_res_proc     INTEGER,
  fba_seen_at      TEXT,
  mode             TEXT,                       -- 'hold' / 'restock' / 'end'（pj_priceの在庫0時の動作）
  one_off          INTEGER NOT NULL DEFAULT 0,
  -- 一点物かどうかを人が決めたか。0 は「分からない」（出品リストに無い過去の出品）
  one_off_known    INTEGER NOT NULL DEFAULT 0,
  fba_link         INTEGER NOT NULL DEFAULT 0,
  -- 手元在庫あり（仕入れてすぐeBayに出し、FBA納品はその後）。
  -- 立っている行は FBA 0 でも売り越し扱いにしない。pj_price から POST /listings で送る。
  on_hand          INTEGER NOT NULL DEFAULT 0,
  amazon_lowest    REAL,
  amazon_lowest_n  INTEGER,                    -- 最安値と同じ値段の出品者数（1なら注意）
  amazon_offers    INTEGER,                    -- 見えている出品件数
  -- 安い順に最大10件の [{p:値段(本体+送料), c:状態(SubCondition)}]。
  -- 許容差額の中に何人いるか、「可」だけかどうかは pj_price 側で判定する。
  amazon_offers_json TEXT,
  amazon_lowest_at TEXT,
  /* 再調達で出し直した「いまの状態」。pj_price が再調達CSVの書き出しのときに送る。
     mode（在庫0のときの動作）とは別物：mode='restock' は出品リストで決める方針で、
     こちらは「いま、FBA在庫なしのままAmazon最安値基準で出し続けている」行の印。 */
  restocking       INTEGER NOT NULL DEFAULT 0,
  restock_at       TEXT,                       -- 再調達に切り替えた時刻
  restock_price    REAL,                       -- そのときeBayに入れた売値（USD）
  -- その売値で損益分岐に収まる仕入値の上限（円）。Amazonの最安値がこれを超えたら赤字。
  -- 計算式（為替・手数料・重量）は pj_price 側の設定で変わるので、Workerは数字だけ持つ。
  restock_max_cost INTEGER,
  restock_skip_acc INTEGER,                    -- その上限を「可」を除いて出したか（0/1）
  /* 無在庫出品の印。手元にもFBAにも在庫を持たず、売れてから仕入れる出品。
     CustomLabel が M-<ASIN>[-U] の行は取り込みで自動的に立つ。既存の出品は
     pj_price のボタンで手動で立てる。立っている行は売り越し系の警告を出さない。 */
  dropship         INTEGER NOT NULL DEFAULT 0,
  /* カートリッジのみ（cond='cart'）の手元在庫数。FBAに送らず手元から出すので、
     eBayの数量と合っているかをこれで見張る。NULL はまだ送っていない（見張らない）。 */
  hand_qty         INTEGER,
  /* 価格の元データ。出品CSVのリストを空にしても推奨売値・最低売値を出せるように、
     pj_price が書き出し・名簿のときに送る（NULL は未送信＝既定値を使う）。 */
  weight_g         INTEGER,                    -- 実重量（梱包込）
  cost_yen         INTEGER,                    -- 仕入値（手直し後）
  sold_usd         REAL,                       -- 相場（総額$）
  /* eBay優先の印。1 なら「Amazonの方が得」の引き上げ（Amazon同等ライン）を使わない。
     Amazonの最安値が高いだけで売れていない商品や、eBayで実績を作りたい商品に立てる。 */
  ebay_first       INTEGER NOT NULL DEFAULT 0,
  /* 3日ごとの値下げの記録。端末を変えても続きから動くよう D1 に置く。 */
  mark_at          TEXT,                       -- 最後に値下げCSVを書き出した時刻
  mark_stop        INTEGER NOT NULL DEFAULT 0, -- 1 なら値下げしない
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (asin, cond)
);
CREATE INDEX IF NOT EXISTS idx_items_scope ON items(scope);
CREATE INDEX IF NOT EXISTS idx_items_sku   ON items(ebay_sku);
CREATE INDEX IF NOT EXISTS idx_items_dropship ON items(dropship);

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
  -- 予約済みの内訳（items と同じ。NULL は未取得）
  fba_res_cust      INTEGER,
  fba_res_trans     INTEGER,
  fba_res_proc      INTEGER,
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
