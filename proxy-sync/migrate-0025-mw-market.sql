-- MW 無在庫：eBay の相場（4章の6）と、MW の商品画像（6.1 の①）
-- 7.62・7.63。デプロイより先に流す。
--   npx wrangler d1 execute pj-sync --remote --file=./migrate-0025-mw-market.sql

-- eBay の相場。JAN（GTIN）で Browse API を引いた結果を控える。
-- 7日に1回までしか取り直さないので、checked_at で古さを見る。
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
