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
  /* 売れた値段で保ち、同じ値段で再出品する（migrate-0023）。
     値下げの途中で売れたら、その値段が「売れる値段」だと分かったということ
     なので、それ以上下げない（値上げもしない）。 */
  sold_keep        INTEGER NOT NULL DEFAULT 0,-- 売れた値段で保つ
  sold_price       REAL,                      -- 売れた時点の出品価格（$）
  sold_kept_at     TEXT,                      -- 売れた日時（eBayの注文）
  sk_act           TEXT,                      -- 再出品の予定 'relist'
  sk_why           TEXT,                      -- できない理由
  sk_at            TEXT,                      -- 判定した時刻
  sk_done_at       TEXT,                      -- 再出品した時刻
  sk_fail          INTEGER NOT NULL DEFAULT 0,-- 連続失敗の回数
  /* 仕入れ先（将来のマッチングワールド）。buySource() が見る形だけ用意してある。 */
  mw_low           REAL,                      -- 仕入れ値（円・送料込み）
  mw_low_at        TEXT,                      -- その取得日時
  mw_n             INTEGER,                   -- 同じ値段の出品者数（相当）
  mw_stock         INTEGER,                   -- 在庫 1=あり／0=なし／NULL=不明
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
                                               -- mwgame / mwhobby は MW 仕入れ（7.77）
  buy_src           TEXT,                      -- 'mw'（MWから）/ 'other'（店舗仕入れなど）
  mw_sha            TEXT,                      -- MW の社
  jan               TEXT,
  cost_src          INTEGER,                   -- 卸値×1.1＋仕入れ送料（円）
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

/* 売れた値段での再出品の記録（migrate-0023）。 */
CREATE TABLE IF NOT EXISTS sk_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  mode       TEXT NOT NULL,
  picked     INTEGER NOT NULL DEFAULT 0,
  relisted   INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  capped     INTEGER NOT NULL DEFAULT 0,
  ended      INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sk_runs_at ON sk_runs(at);
CREATE TABLE IF NOT EXISTS sk_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  asin       TEXT NOT NULL,
  cond       TEXT NOT NULL,
  item_id    TEXT,
  kind       TEXT NOT NULL,
  price      REAL,
  buy_low    REAL,
  buy_src    TEXT,
  ok         INTEGER NOT NULL DEFAULT 0,
  why        TEXT
);
CREATE INDEX IF NOT EXISTS idx_sk_log_at ON sk_log(at);
CREATE INDEX IF NOT EXISTS idx_sk_log_key ON sk_log(asin, cond, at);

-- ===== マッチングワールド（MW）の在庫（migrate-0024）=====
-- マッチングワールド（MW）の在庫CSVを置く（2026-10-25・段取りA）
--
-- 主キーは**連番**。(jan, sha) は索引にする。
-- 同じ (jan, 社) の行が約169組あるため、(jan, sha) を主キーにすると行が消える
-- （同じ商品を倉庫違い・ロット違いで2行に分けているように見える）。
-- 差分の突き合わせには **(jan, sha, idx)** を使う。idx は同じ (jan, sha) が
-- CSV に現れた順（0,1,2…）。これで行を取り違えずに UPSERT できる。
/* ===== 流したマイグレーションの控え（7.116）=====
   GitHub Actions（スマホ）と手元の PowerShell のどちらで流しても
   二重にならないように、流したファイル名を D1 自身に覚えさせる。
     src … 'pc'（手元）／'actions'（GitHub Actions） */
CREATE TABLE IF NOT EXISTS _migrations (
  file TEXT PRIMARY KEY,
  at   TEXT NOT NULL,
  src  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_migrations_at ON _migrations(at);

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
  back_at    TEXT,                             -- 欠品から戻った時刻（7.121）
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mw_key  ON mw_stock(jan, sha, idx);
CREATE INDEX IF NOT EXISTS idx_mw_jan        ON mw_stock(jan);
CREATE INDEX IF NOT EXISTS idx_mw_seen       ON mw_stock(seen_at);
CREATE INDEX IF NOT EXISTS idx_mw_pick       ON mw_stock(pick, gone_at);
CREATE INDEX IF NOT EXISTS idx_mw_kishu      ON mw_stock(kishu, cond, ship_days, stock);
CREATE INDEX IF NOT EXISTS idx_mw_back       ON mw_stock(back_at);

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
  src        TEXT NOT NULL DEFAULT 'hand',    -- 'auto'（pj-sync）／'hand'（画面）
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mw_runs_at ON mw_runs(at);

-- 在庫CSVを取りに行った1回ぶんの記録（7.120・【P】）
-- 「変わったか」だけを見た回も残すので、mw_runs とは別に持つ。
CREATE TABLE IF NOT EXISTS mw_csv_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  src          TEXT NOT NULL DEFAULT 'auto',  -- 'auto'（Cron）／'hand'（⚙のボタン）
  http         INTEGER NOT NULL DEFAULT 0,    -- HEAD/GET の応答
  changed      INTEGER NOT NULL DEFAULT 0,    -- 前回と変わっていたか
  took         INTEGER NOT NULL DEFAULT 0,    -- 本体を取ったか
  bytes        INTEGER NOT NULL DEFAULT 0,
  rows_in      INTEGER NOT NULL DEFAULT 0,
  added        INTEGER NOT NULL DEFAULT 0,
  changed_rows INTEGER NOT NULL DEFAULT 0,
  gone         INTEGER NOT NULL DEFAULT 0,
  elapsed_ms   INTEGER NOT NULL DEFAULT 0,
  ok           INTEGER NOT NULL DEFAULT 0,
  why          TEXT,
  stock_at     TEXT,                           -- 取り込みに使った日時（7.121）
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mw_csv_runs_at ON mw_csv_runs(at);

/* ===== MW 無在庫：eBay の相場と MW の画像（7.62・7.63）===== */
-- eBay の相場。JAN（GTIN）で Browse API を引いた結果を控える。
-- 7日に1回までしか取り直さないので、checked_at で古さを見る。
/* ===== MW 在庫の動きの記録と目安（7.126・【T】）===== */
-- 掲載数が**変わった回だけ**を残す（90日）。合計は mw_stat に積む。
--
-- mw_move … 掲載数が**変わった回だけ**を残す（変わらない回は書かない）。
--            90日より古い行は日次で捨てる（合計は mw_stat に残る）。
-- mw_stat … (JAN, 社) ごとの**全期間の合計**。取り込みのたびに足していくので、
--            mw_move を捨てても「売れる速さ（全期間）」が出せる。
--
-- 容量の見積もり（12,000行・1日8回の取り込み）
--   ・1回に数が動く行は 200〜600 行ほど（同じ回の「変わらない行」は書かない）
--   ・1日 2,000〜5,000 行 → 90日で 18万〜45万行。1行 60バイトほどなので 11〜27MB
--   ・mw_stat は (JAN,社) ごとに1行だけ（2万行ほど・2MB ほど）
--   ・書き込みは1行の変化につき 2文（mw_move＋mw_stat）。1便（400行）の中で
--     数が動くのは一部なので、D1 の「1回の実行で 1,000問い合わせまで」に収まる

CREATE TABLE IF NOT EXISTS mw_move (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,                   -- 取り込みの日時
  jan        TEXT NOT NULL,
  sha        TEXT NOT NULL,                   -- 社（仕入れ元）
  idx        INTEGER NOT NULL DEFAULT 0,      -- 同じ (JAN,社) の何番目か
  prev       INTEGER,                         -- 前の数（新しく出た・戻ったは NULL）
  cur        INTEGER,                         -- 今の数（欠品は NULL）
  d          INTEGER NOT NULL DEFAULT 0,      -- 今の数 − 前の数（減ったら負）
  kind       TEXT NOT NULL,                   -- new/down/up/gone/back/
                                              -- wipe（一度に消えた・7.141）/
                                              -- csvback（CSV の抜けから戻った）
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mw_move_at   ON mw_move(at);
CREATE INDEX IF NOT EXISTS idx_mw_move_jan  ON mw_move(jan, at);
CREATE INDEX IF NOT EXISTS idx_mw_move_kind ON mw_move(kind, at);

CREATE TABLE IF NOT EXISTS mw_stat (
  jan        TEXT NOT NULL,
  sha        TEXT NOT NULL,
  first_at   TEXT,                            -- はじめて記録した日時
  last_at    TEXT,                            -- 最後に数が動いた日時
  down_n     INTEGER NOT NULL DEFAULT 0,      -- 減った回数
  down_qty   INTEGER NOT NULL DEFAULT 0,      -- 減った合計（売れた数の目安）
  up_n       INTEGER NOT NULL DEFAULT 0,      -- 増えた（補充）回数
  up_qty     INTEGER NOT NULL DEFAULT 0,      -- 増えた合計
  gone_n     INTEGER NOT NULL DEFAULT 0,      -- 欠品になった回数
  back_n     INTEGER NOT NULL DEFAULT 0,      -- 欠品から戻った回数
  back_qty   INTEGER NOT NULL DEFAULT 0,      -- 戻ったときの数の合計
  gone_days  REAL NOT NULL DEFAULT 0,         -- 欠品していた日数の合計
  base_qty   INTEGER,                         -- 基準の数（はじめて記録したとき・7.134）
  wipe_n     INTEGER NOT NULL DEFAULT 0,      -- 一度に消えた回数（7.141）
  wipe_qty   INTEGER NOT NULL DEFAULT 0,      -- そのとき消えた数の合計
  created_at TEXT NOT NULL,
  PRIMARY KEY (jan, sha)
);
CREATE INDEX IF NOT EXISTS idx_mw_stat_jan ON mw_stat(jan);
CREATE INDEX IF NOT EXISTS idx_mw_stat_last ON mw_stat(last_at);

CREATE TABLE IF NOT EXISTS mw_market (
  jan         TEXT PRIMARY KEY,
  n           INTEGER,   -- 見つかった出品数（即決のみ）
  n_new       INTEGER,   -- そのうち新品
  low         REAL,      -- 新品の最安値（送料込み・総額ドル）
  low_item    REAL,      -- その本体価格
  low_ship    REAL,      -- その送料（0 は送料無料）
  low_any     REAL,      -- 状態を問わない最安値（送料込み）。新品が無いとき使う
  cur         TEXT,      -- 通貨（USD 以外は参考値）
  title       TEXT,
  item_id     TEXT,
  item_url    TEXT,
  no_ship     INTEGER,   -- 送料が分からない出品が混じっていたら 1
  err         TEXT,      -- 取れなかった理由（次は1日後に取り直す）
  checked_at  TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_mw_mkt_at  ON mw_market(checked_at);
CREATE INDEX IF NOT EXISTS idx_mw_mkt_low ON mw_market(low);

-- MW の商品画像。JAN ごとに最大12枚。pos=0 がメイン。
-- 一度取れた JAN→商品ID→画像URL は控えて、二度は取りに行かない（仕様6.1）。
CREATE TABLE IF NOT EXISTS mw_img (
  jan        TEXT NOT NULL,
  pos        INTEGER NOT NULL,   -- 0 がメイン
  mw_id      TEXT,               -- MW の商品ID
  src        TEXT,               -- MW の画像URL
  url        TEXT,               -- pj-img（R2）に控えた公開URL
  w          INTEGER,
  h          INTEGER,
  long_px    INTEGER,            -- 長辺。500未満は使えない
  bytes      INTEGER,
  ct         TEXT,
  ok         INTEGER,            -- 1 = 使える（長辺500px以上）
  err        TEXT,
  at         TEXT,
  created_at TEXT,
  PRIMARY KEY (jan, pos)
);
CREATE INDEX IF NOT EXISTS idx_mw_img_jan ON mw_img(jan);
CREATE INDEX IF NOT EXISTS idx_mw_img_ok  ON mw_img(ok);

-- 相場の取得の記録
CREATE TABLE IF NOT EXISTS mw_mkt_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT,
  asked      INTEGER,   -- 調べる対象だった件数
  done       INTEGER,   -- 実際に引いた件数（API の呼び出し回数）
  hit        INTEGER,   -- 相場が見つかった件数
  none       INTEGER,   -- eBay に出品が無かった件数
  failed     INTEGER,
  left_n     INTEGER,   -- まだ残っている件数
  note       TEXT,
  created_at TEXT
);

/* ===== MW の候補を Amazon で見たとき（7.66）===== */
CREATE TABLE IF NOT EXISTS mw_amz (
  jan        TEXT PRIMARY KEY,
  asin       TEXT,      -- JAN から引いた ASIN
  name       TEXT,      -- Amazon の商品名
  /* ランキングは**大きい分類**（displayGroupRanks。ホビー・ゲームなど）。
     せどりすと と同じ見え方にする（7.91）。小分類は rank_sub に別に持つ。 */
  rank       INTEGER,   -- 大分類の順位
  rank_cat   TEXT,      -- 大分類の名前（例：ホビー）
  rank_sub     INTEGER, -- 小分類の順位（添える程度）
  rank_sub_cat TEXT,    -- 小分類の名前
  /* Amazon の商品の種類（productTypes の先頭・7.92）。
     相乗り出品のときに「この種類で必須の項目」を引くのに使う。 */
  ptype      TEXT,
  price      INTEGER,   -- 販売価格（円・送料込み）
  basis      TEXT,      -- 'カート' か '最安'
  low        INTEGER,   -- 新品の最安値（送料込み）
  /* 中古の最安値（7.115）。新品の出品者が0人のときに、
     これ×⚙の掛け率（既定120%）を売値にする。 */
  used_low   INTEGER,   -- 中古の最安値（送料込み）
  used_n     INTEGER,   -- 中古の出品者数
  used_at    TEXT,      -- 中古の最安値を取った時刻
  buybox     INTEGER,   -- カート価格（取れたときだけ）
  new_n      INTEGER,   -- 新品の出品者数
  low_n      INTEGER,   -- 最安値と同じ値段の出品者数
  amz        INTEGER,   -- 1 = Amazon本体の出品あり
  fba_n      INTEGER,   -- FBA の出品者数
  err        TEXT,      -- 取れなかった理由（次は1日後に取り直す）
  checked_at TEXT,
  /* 段ごとの時刻（7.79）。1つの checked_at だと、①で ASIN を引いた行が
     「さっき調べた行」になって③の価格の対象から外れてしまう。 */
  asin_at    TEXT,      -- ① JAN→ASIN を最後に試した時刻
  price_at   TEXT,      -- ③ 実売価格を最後に試した時刻
  /* 商品ごとの手数料（Product Fees API・7.85）。一律の率とは別に持つ。 */
  fee_ref    INTEGER,   -- 販売手数料（税抜）
  fee_fba    INTEGER,   -- FBA手数料（配送代行＋在庫管理）
  /* その内訳（7.106・migrate-0039）。せどりすと と並べて見るため。 */
  fee_fba_ship  INTEGER,   -- 配送代行手数料
  fee_fba_store INTEGER,   -- 在庫管理手数料
  /* サイズ区分（7.108・migrate-0040）。Catalog の dimensions から出す。
     SP-API の手数料には在庫管理手数料が入らないので、⚙の目安を選ぶのに使う。 */
  size_tier TEXT,          -- 's'(小型) / 'm'(標準) / 'l'(大型)
  size_cm3  INTEGER,       -- 体積（cm3）
  size_long REAL,          -- 長辺（cm）
  size_g    INTEGER,       -- 重さ（g）
  /* その重さがどこから来たか（7.112・migrate-0043）。
     'pkg'＝梱包重量（package weight）／'item'＝商品の重量。
     MW 無在庫（W-）の送料の計算に使うので、画面にも出す。 */
  size_src  TEXT,
  /* 7.129（【V の続き】の4）手数料の「だめ」の切り分け。
     fee_kind … ''／NULL 未分類／'fba_ng' FBA の見積もりが出せない／
                'price' 送っている値段が原因／'other' ASIN か市場が原因
     fee_mfn  … 1＝販売手数料と消費税は「自分で発送」の実額（FBA だけ目安） */
  fee_kind    TEXT,
  fee_kind_at TEXT,
  fee_mfn     INTEGER,
  fee_tax    INTEGER,   -- 手数料の消費税
  fee_total  INTEGER,   -- 合計（Amazon が返す総額）
  fee_base   INTEGER,   -- その手数料を出したときの売値
  fee_at     TEXT,
  fee_err    TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mw_amz_fee_at ON mw_amz(fee_at);
CREATE INDEX IF NOT EXISTS idx_mw_amz_rank  ON mw_amz(rank);
CREATE INDEX IF NOT EXISTS idx_mw_amz_at    ON mw_amz(checked_at);
CREATE INDEX IF NOT EXISTS idx_mw_amz_price ON mw_amz(price);
CREATE INDEX IF NOT EXISTS idx_mw_amz_asin  ON mw_amz(asin);
CREATE INDEX IF NOT EXISTS idx_mw_amz_asin_at  ON mw_amz(asin_at);
CREATE INDEX IF NOT EXISTS idx_mw_amz_price_at ON mw_amz(price_at);

CREATE INDEX IF NOT EXISTS idx_mw_amz_fee_kind ON mw_amz(fee_kind, fee_kind_at);

CREATE TABLE IF NOT EXISTS mw_amz_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT,
  asked      INTEGER,   -- 調べる対象だった件数
  done       INTEGER,   -- 実際に調べた件数
  asin_ok    INTEGER,   -- ASIN が引けた件数
  asin_ng    INTEGER,   -- JAN から ASIN が引けなかった件数
  priced     INTEGER,   -- 値段が取れた件数
  none       INTEGER,   -- Amazon に新品の出品が無かった件数
  failed     INTEGER,
  left_n     INTEGER,
  calls_cat  INTEGER,   -- Catalog Items の呼び出し回数
  calls_prc  INTEGER,   -- getItemOffersBatch の呼び出し回数
  note       TEXT,
  created_at TEXT
);

/* ===== Amazon への登録の記録（putListingsItem・7.90）===== */
CREATE TABLE IF NOT EXISTS mw_reg_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  sku        TEXT NOT NULL,
  asin       TEXT,
  jan        TEXT,
  price      INTEGER,
  cond       TEXT,
  ok         INTEGER NOT NULL DEFAULT 0,
  status     TEXT,              -- Amazon の status（ACCEPTED / INVALID）
  sub_id     TEXT,              -- submissionId
  issues     TEXT,              -- 指摘（JSON 配列）
  err        TEXT,
  by_role    TEXT,
  ptype      TEXT,              -- 送った productType（7.95。PRODUCT のことも）
  ptype_try  TEXT,              -- 試した順（"ABIS_VIDEO_GAMES > PRODUCT"）
  /* 7.115：新規登録（'put'）と売値だけ直した（'price'）の見分け＋値段の根拠。 */
  kind       TEXT,              -- 'put' / 'price'
  price_src  TEXT,              -- 'new' / 'used' / 'hand'
  price_why  TEXT,              -- 「新品の出品者なし：中古の最安値 … × 120% ＝ …」
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mw_reg_log_at  ON mw_reg_log(at);
CREATE INDEX IF NOT EXISTS idx_mw_reg_log_sku ON mw_reg_log(sku, at);
CREATE INDEX IF NOT EXISTS idx_mw_reg_log_ok  ON mw_reg_log(ok, at);

/* ===== MW の自動の取り直しの記録（7.86）===== */
CREATE TABLE IF NOT EXISTS mw_auto_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT,
  kind       TEXT,        -- 'cron' / 'hand'
  price_n    INTEGER,
  fee_n      INTEGER,
  rst_n      INTEGER,
  calls      INTEGER,
  left_n     INTEGER,
  note       TEXT,
  /* 7.122（【R】）。動いたか・どこで止まったかが分かるように残す。 */
  asin_n     INTEGER,     -- ASIN・順位を引いた件数
  ms         INTEGER,     -- かかった時間（ミリ秒）
  stopped    TEXT,        -- 止まった理由（段ごと）
  err        TEXT,        -- 例外のときの文
  mode       TEXT,        -- そのときの⚙の設定（on / off）
  per_hour   INTEGER,     -- そのときの「1時間ぶんの件数」
  fee_ng     INTEGER,     -- 手数料が取れなかった件数
  fee_left   INTEGER,     -- 手数料の残り（次回に回した分）
  asin_left  INTEGER,     -- ASIN の残り
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mw_auto_at ON mw_auto_runs(at);

/* ===== JAN から ASIN を引く控え（7.67）===== */
CREATE TABLE IF NOT EXISTS jan_map (
  jan        TEXT PRIMARY KEY,
  asin       TEXT,      -- 見つかった ASIN（見つからなければ NULL）
  name       TEXT,      -- Amazon の商品名
  rank         INTEGER,   -- 大分類の順位（7.91）
  rank_cat     TEXT,
  rank_sub     INTEGER,   -- 小分類の順位
  rank_sub_cat TEXT,
  src        TEXT,      -- どこで分かったか（'catalog' / 'mw' / 'hand'）
  err        TEXT,      -- 見つからなかった理由
  at         TEXT,      -- 最後に調べた時刻
  /* JAN 1つに ASIN が複数あるとき（7.84）。自動で決めず、人が選ぶ。 */
  cands      TEXT,      -- 候補（JSON 配列）
  cand_n     INTEGER,   -- 候補の件数（0=未確認）
  cand_at    TEXT,      -- 候補を控えた時刻
  picked_at  TEXT,      -- 人が選んだ時刻
  picked_by  TEXT,      -- 'hand'
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jan_map_asin ON jan_map(asin);
CREATE INDEX IF NOT EXISTS idx_jan_map_at   ON jan_map(at);
CREATE INDEX IF NOT EXISTS idx_jan_map_candn  ON jan_map(cand_n);
CREATE INDEX IF NOT EXISTS idx_jan_map_candat ON jan_map(cand_at);

/* ===== MW の仕入れの印（7.68）===== */
CREATE TABLE IF NOT EXISTS mw_buy (
  jan        TEXT PRIMARY KEY,
  qty        INTEGER NOT NULL DEFAULT 1,   -- 仕入れる数量（0 で印を外す）
  by_role    TEXT,                         -- 'admin' / 'staff'（誰が付けたか）
  note       TEXT,
  at         TEXT,
  created_at TEXT,
  /* 印を付けた時点の控え（7.105・migrate-0038）。
     MW の stocks_3.csv から消えた（売り切れた）商品でも
     Amazon に登録できるようにするため、ここに残す。 */
  asin       TEXT,
  name       TEXT,
  sha        TEXT,
  kishu      TEXT,
  cond       TEXT,
  wholesale  INTEGER,
  pics       INTEGER,
  snap_at    TEXT,
  /* 登録の状態。'' 未登録 / 'pj' pj で登録 / 'other' pj 以外（せどりすと等）。 */
  reg_state  TEXT,
  reg_sku    TEXT,
  reg_at     TEXT,
  reg_chk_at TEXT,
  /* 「注文した」の印（7.121・【Q】）。MW に注文したあとは、CSV から消えても
     「注文前に売り切れました」ではないので、知らせの対象から外す。 */
  ordered_at TEXT,
  ordered_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_mw_buy_at ON mw_buy(at);

/* 7.130（【U の改】の1）会員に出す商品（Shopify の商品CSVの元）。
   on_sale＝1 の行だけを CSV に出す。grades が空なら全プランに見せる。 */
CREATE TABLE IF NOT EXISTS mw_sub (
  jan        TEXT PRIMARY KEY,
  on_sale    INTEGER NOT NULL DEFAULT 0,
  max_qty    INTEGER,                      -- 販売数の上限
  price      INTEGER,                      -- 販売価格（税込・円）
  grades     TEXT,                         -- 見せるプラン（空＝ぜんぶ）
  by_role    TEXT,
  put_at     TEXT,                         -- 最後に CSV に出した日時
  loaded_at  TEXT,                         -- Shopify に読み込んだ印（8.11）
  px_hand    INTEGER NOT NULL DEFAULT 0,   -- 1＝価格を手で直した（7.139）
  at         TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mw_sub_on_sale ON mw_sub(on_sale, at);

/* ===== 8.11（【Y】）会員向け Discord の配信と Shopify の注文 ===== */
/* 送ったカード。同じ商品を同じチャンネルに二重に送らないための控えで、
   出し直すときは msg_id でそのカードを書き換える。 */
CREATE TABLE IF NOT EXISTS sub_post (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  jan        TEXT NOT NULL,
  ch         TEXT NOT NULL,                  -- Discord のチャンネルID
  plan       TEXT NOT NULL,                  -- monitor / light / standard / premium
  msg_id     TEXT NOT NULL,
  price      INTEGER,                        -- 送ったときの販売価格（税込）
  qty        INTEGER NOT NULL DEFAULT 0,     -- 出した点数
  sold       INTEGER NOT NULL DEFAULT 0,     -- 売れた点数
  sold_out   INTEGER NOT NULL DEFAULT 0,
  at         TEXT NOT NULL,
  edited_at  TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_post_one ON sub_post(jan, ch);
CREATE INDEX IF NOT EXISTS idx_sub_post_at ON sub_post(at);

/* Shopify の注文。**氏名・住所・メールは入れない**
   （顧客は Shopify の注文番号だけで追う）。 */
CREATE TABLE IF NOT EXISTS sub_order (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no   TEXT NOT NULL,                  -- Shopify の注文番号
  sku        TEXT NOT NULL,                  -- SUB-<JAN>-<YYYYMMDD>
  jan        TEXT NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 0,
  price      INTEGER,
  at         TEXT,
  src        TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_order_one ON sub_order(order_no, sku);
CREATE INDEX IF NOT EXISTS idx_sub_order_jan ON sub_order(jan, at);

/* ===== 国内FBA：出品の可否（7.76）===== */
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
CREATE INDEX IF NOT EXISTS idx_skus_src ON skus(buy_src);
CREATE INDEX IF NOT EXISTS idx_skus_jan ON skus(jan);

/* ===== 商品の種類ごとの必須項目（7.92）=====
   相乗り出品（LISTING_OFFER_ONLY）でも、種類によっては電池・危険物の申告が
   必須になる。Product Type Definitions API（getDefinitionsProductType）の
   結果を**種類ごとに**控える（14日）。
   ・req   … その種類で必須の項目名（項目表の required）
   ・props … その種類にある項目名（ここに無い名前を送ると弾かれる）
   ・err   … 引けなかった理由（引けた日時も at に残す） */
CREATE TABLE IF NOT EXISTS amz_ptype (
  ptype      TEXT PRIMARY KEY,
  req        TEXT,
  props      TEXT,
  err        TEXT,
  at         TEXT,
  created_at TEXT
);

/* ===== 電池・危険物の申告を ASIN ごとに覚える（7.93）=====
   確認の画面で人が選んだ申告を控えて、次に同じ ASIN を登録するときは
   自動で当てる（画面には「前回の選択を使用」と出し、選び直せる）。
   ・batteries … 電池が必要か（1/0）
   ・dg        … 危険物の区分（not_applicable など）
   ・by_role   … 選んだ端末の役（admin / staff） */
CREATE TABLE IF NOT EXISTS amz_dg (
  asin       TEXT PRIMARY KEY,
  batteries  INTEGER,
  dg         TEXT,
  by_role    TEXT,
  at         TEXT,
  created_at TEXT
);

/* ===== 在庫の根拠がない出品を Amazon 無在庫で続ける（7.102）=====
   手元にも FBA にも無いのに eBay に出ている行を、Amazon の最安値を
   仕入れ先とみなして出し続ける。
   **items は D1 の上限（1表100列）ちょうどなので列を足せない**ため、
   別の表に持つ（/status も ITEM_COLS もここから引いて amz_drop を作る）。
   ・at  … 切り替えた時刻
   ・why … 切り替えた理由 */
CREATE TABLE IF NOT EXISTS amz_drop (
  asin       TEXT NOT NULL,
  cond       TEXT NOT NULL,
  at         TEXT,
  why        TEXT,
  created_at TEXT,
  PRIMARY KEY (asin, cond)
);

/* ===== ⚙の設定を書き込んだ履歴（7.109）=====
   /settings は「送られてきた項目だけ」を上書きする（マージ）。
   消えたときに追えるように、いつ・どの端末（役割）・どの項目を
   何から何に変えたかを残す。⚙から「直前の値に戻す」のに使う。 */
CREATE TABLE IF NOT EXISTS settings_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT,
  role        TEXT,
  keys_n      INTEGER,
  keys        TEXT,
  before_json TEXT,
  after_json  TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_settings_log_at ON settings_log (at DESC);

/* ===== 取り込みのたびの知らせ：もう知らせた商品（7.110）=====
   在庫0の行は次の取り込みでも在庫0のままなので、同じ商品を毎回
   知らせないよう、知らせた JAN を控える。
   kind … 'sold'（在庫切れ）／'new'（新入荷） */
CREATE TABLE IF NOT EXISTS mw_notify (
  jan        TEXT NOT NULL,
  kind       TEXT NOT NULL,
  at         TEXT,
  created_at TEXT,
  PRIMARY KEY (jan, kind)
);
CREATE INDEX IF NOT EXISTS idx_mw_notify_at ON mw_notify (at DESC);
