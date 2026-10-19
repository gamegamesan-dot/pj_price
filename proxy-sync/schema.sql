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
  /* ベストオファーの設定。値段を下げるときは自動拒否額も一緒に下げないと
     「Auto decline amount cannot be greater than or equal to the Buy It Now price」
     （22003）で失敗する。NULL は未取得（列を出さない＝勝手にオンにしない）。 */
  ebay_bo          INTEGER,
  ebay_bo_accept   REAL,
  ebay_bo_decline  REAL,
  /* アップロード結果が Failure だった理由（写真が小さい・ベストオファー金額など）。
     直って次の Revise が通ったら消す。 */
  revise_err       TEXT,
  revise_err_at    TEXT,
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
  /* 中古（used / cart）の行だけに入る「新品の最安値」。
     新品のほうが安いときは、そちらを値付けの基準にする（中古がその値段で
     売れる前提が成り立たないため）。判定と表示は pj_price 側。 */
  amazon_new_low   REAL,
  amazon_new_n     INTEGER,
  amazon_new_at    TEXT,
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
  /* 3日ごとの値下げの記録。端末を変えても続きから動くよう D1 に置く。
     自動値下げ（Cron が eBay を直接変える）でも同じ列を進める
     （CSVと二重に下げないため）。 */
  mark_at          TEXT,                       -- 最後に値下げした時刻（CSV・自動とも）
  mark_stop        INTEGER NOT NULL DEFAULT 0, -- 1 なら値下げしない
  /* 自動値下げの値下げ幅。出品時（または自動値下げを初めて有効にした時点の売値）で
     決めて保存し、途中で変えない。式は pj_price 側の設定で変わるので数字だけ持つ。 */
  md_step          REAL,                       -- 1回の値下げ幅（$・最低1）
  md_start         REAL,                       -- 幅を決めたときの開始価格（$）
  md_floor         REAL,                       -- 幅を決めたときの最低売値（$）
  md_n             INTEGER,                    -- 幅を決めたときの回数（既定10）
  md_done          INTEGER NOT NULL DEFAULT 0, -- 自動で下げた回数
  /* eBayのセール（Promotional Sale／Markdown Manager）が設定されている出品。
     1 なら自動値上げ・自動値下げの対象から外す。セールが終われば次の取り込みで 0 に戻る。
     ebay_price（CurrentPrice）は**セール後の値段**なので、利益はそのまま計算してよい。 */
  ebay_sale        INTEGER,
  ebay_sale_orig   REAL,                      -- セール前の値段（$・migrate-0019）
  ebay_sale_end    TEXT,                      -- セールが終わる時刻（ISO・migrate-0019）
  /* 写真を eBay 保管（EPS）に切り替えた印（migrate-0020）。
     1 なら切り替え済みで、二度切り替えない。まだ 0 の出品は Vendor のまま。 */
  pics_eps         INTEGER NOT NULL DEFAULT 0,
  pics_eps_at      TEXT,                      -- 切り替えた時刻
  pics_n           INTEGER,                   -- 切り替え後の写真の枚数
  /* フェイズB（migrate-0021）。FBAで売れたら数量0にし、再調達の行は予定に載せる。
     pb_want（再調達の売値）は pj_price が計算して送る。 */
  pb_act           TEXT,                      -- 'zero' / 'restock' / 'unknown'
  pb_why           TEXT,
  pb_at            TEXT,
  pb_done_at       TEXT,
  pb_fail          INTEGER NOT NULL DEFAULT 0,
  pb_skip          INTEGER NOT NULL DEFAULT 0,
  pb_want          REAL,
  pb_max_cost      INTEGER,
  pb_want_at       TEXT,
  /* メルカリ・ヤフオクの検索語（手で直したもの）。空は「自動で作る」。
     出品CSVタブと販売連携タブで共通に使う。 */
  search_kw        TEXT,
  /* 売値の見直しの自動反映（migrate-0018）。pj_price が計算して送る数字。
     rv_want より上げることはなく、rv_floor より下げることもない。 */
  rv_want          REAL,                      -- 出すべき売値（$）
  rv_floor         REAL,                      -- 最低利益ライン（$）
  rv_kind          TEXT,                      -- 相場の判断 rec/match/none/skip
  rv_max_cost      INTEGER,                   -- その売値での仕入値の上限（円）
  rv_at            TEXT,                      -- 目標を受け取った時刻
  rv_done_at       TEXT,                      -- 最後に eBay へ反映した時刻
  rv_fail          INTEGER NOT NULL DEFAULT 0,-- 連続失敗の回数（3でお知らせ）
  /* 再調達中の売値の追従（migrate-0022）。restocking=1 の行だけ、
     Amazon最安値の動きに合わせて上げも下げも自動で反映する。
     rk_want（目標の売値）は pj_price が計算して送る。 */
  rk_want          REAL,                      -- 目標の売値（$）
  rk_floor         REAL,                      -- 最低売値（$）。これより下げない
  rk_low           REAL,                      -- 基準にした Amazon最安値（円）
  rk_n             INTEGER,                   -- 最安グループの人数（2人未満は下げを保留）
  rk_max_cost      INTEGER,                   -- その売値での仕入値の上限（円）
  rk_want_at       TEXT,                      -- 目標を受け取った時刻（24時間で古い）
  rk_at            TEXT,                      -- 予定を立てた時刻
  rk_done_at       TEXT,                      -- 反映した時刻
  rk_fail          INTEGER NOT NULL DEFAULT 0,-- 連続失敗の回数
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

-- 自動値下げの実行結果（1日1行が基本）。
CREATE TABLE IF NOT EXISTS md_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  mode       TEXT NOT NULL,                    -- 'plan' / 'on'
  picked     INTEGER NOT NULL DEFAULT 0,
  changed    INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  capped     INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_md_runs_at ON md_runs(at);

-- 売値の見直しの自動反映（1日1行が基本）。確認モードの回も残す。
CREATE TABLE IF NOT EXISTS rv_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  mode       TEXT NOT NULL,                    -- 'confirm' / 'auto' / 'approve'
  picked     INTEGER NOT NULL DEFAULT 0,
  changed    INTEGER NOT NULL DEFAULT 0,
  zeroed     INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  capped     INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rv_runs_at ON rv_runs(at);

-- 1行＝1回の変更（変更前後の売値つき）。
CREATE TABLE IF NOT EXISTS rv_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  asin       TEXT NOT NULL,
  cond       TEXT NOT NULL,
  item_id    TEXT,
  kind       TEXT NOT NULL,                    -- 'up' / 'zero'
  from_price REAL,
  to_price   REAL,
  ok         INTEGER NOT NULL DEFAULT 0,
  why        TEXT
);
CREATE INDEX IF NOT EXISTS idx_rv_log_at ON rv_log(at);
CREATE INDEX IF NOT EXISTS idx_rv_log_key ON rv_log(asin, cond, at);

/* フェイズBの実行の記録（migrate-0021）。 */
CREATE TABLE IF NOT EXISTS pb_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  mode       TEXT NOT NULL,
  picked     INTEGER NOT NULL DEFAULT 0,
  zeroed     INTEGER NOT NULL DEFAULT 0,
  restocked  INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  capped     INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pb_runs_at ON pb_runs(at);
CREATE TABLE IF NOT EXISTS pb_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  asin       TEXT NOT NULL,
  cond       TEXT NOT NULL,
  item_id    TEXT,
  kind       TEXT NOT NULL,
  from_qty   INTEGER,
  to_qty     INTEGER,
  from_price REAL,
  to_price   REAL,
  ok         INTEGER NOT NULL DEFAULT 0,
  why        TEXT
);
CREATE INDEX IF NOT EXISTS idx_pb_log_at ON pb_log(at);
CREATE INDEX IF NOT EXISTS idx_pb_log_key ON pb_log(asin, cond, at);

/* 再調達中の売値の追従の記録（migrate-0022）。 */
CREATE TABLE IF NOT EXISTS rk_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  mode       TEXT NOT NULL,
  picked     INTEGER NOT NULL DEFAULT 0,
  up         INTEGER NOT NULL DEFAULT 0,
  down       INTEGER NOT NULL DEFAULT 0,
  zeroed     INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  held       INTEGER NOT NULL DEFAULT 0,
  capped     INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rk_runs_at ON rk_runs(at);
CREATE TABLE IF NOT EXISTS rk_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  asin       TEXT NOT NULL,
  cond       TEXT NOT NULL,
  item_id    TEXT,
  kind       TEXT NOT NULL,
  from_price REAL,
  to_price   REAL,
  low        REAL,
  ok         INTEGER NOT NULL DEFAULT 0,
  why        TEXT
);
CREATE INDEX IF NOT EXISTS idx_rk_log_at ON rk_log(at);
CREATE INDEX IF NOT EXISTS idx_rk_log_key ON rk_log(asin, cond, at);
