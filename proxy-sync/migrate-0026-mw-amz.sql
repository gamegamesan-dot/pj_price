-- MW の候補を Amazon（国内FBA）で見たときの実売価格と出品の様子（7.66）
-- デプロイより先に流す。
--   npx wrangler d1 execute pj-sync --remote --file=./migrate-0026-mw-amz.sql
--
-- 利益の計算そのものは入れない（手数料率は⚙設定で変わるので画面で計算する）。
-- ここには「取ってきた事実」だけを控える。
CREATE TABLE IF NOT EXISTS mw_amz (
  jan        TEXT PRIMARY KEY,
  asin       TEXT,      -- JAN から引いた ASIN
  name       TEXT,      -- Amazon の商品名
  rank       INTEGER,   -- ランキング（いちばん細かい分類のもの）
  rank_cat   TEXT,      -- その分類の名前
  price      INTEGER,   -- 販売価格（円・送料込み）
  basis      TEXT,      -- 'カート' か '最安'
  low        INTEGER,   -- 新品の最安値（送料込み）
  buybox     INTEGER,   -- カート価格（取れたときだけ）
  new_n      INTEGER,   -- 新品の出品者数
  low_n      INTEGER,   -- 最安値と同じ値段の出品者数
  amz        INTEGER,   -- 1 = Amazon本体の出品あり
  fba_n      INTEGER,   -- FBA の出品者数
  err        TEXT,      -- 取れなかった理由（次は1日後に取り直す）
  checked_at TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mw_amz_at    ON mw_amz(checked_at);
CREATE INDEX IF NOT EXISTS idx_mw_amz_price ON mw_amz(price);
CREATE INDEX IF NOT EXISTS idx_mw_amz_asin  ON mw_amz(asin);

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
