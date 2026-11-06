-- 仕入れ済み（MW の CSV から消えても残す）7.105
-- cd proxy-sync && node d1-exec.mjs migrate-0038-mw-buy-snap.sql
-- DB: pj-sync
--
-- 「仕入れる」の印を付けた時点の中身を mw_buy 側に控える。
-- MW の stocks_3.csv から消えた（売り切れた）商品でも、
-- Amazon に登録できるようにするため。
ALTER TABLE mw_buy ADD COLUMN asin      TEXT;      -- 印を付けた時点の ASIN
ALTER TABLE mw_buy ADD COLUMN name      TEXT;      -- 商品名（Amazon 優先・無ければ MW）
ALTER TABLE mw_buy ADD COLUMN sha       TEXT;      -- 社
ALTER TABLE mw_buy ADD COLUMN kishu     TEXT;      -- 機種
ALTER TABLE mw_buy ADD COLUMN cond      TEXT;      -- 新/中（MW の表記）
ALTER TABLE mw_buy ADD COLUMN wholesale INTEGER;   -- 卸値（税抜）＝仕入れ時の値
ALTER TABLE mw_buy ADD COLUMN pics      INTEGER;   -- 写真の枚数（取り込み済み）
ALTER TABLE mw_buy ADD COLUMN snap_at   TEXT;      -- 控えを作った時刻
ALTER TABLE mw_buy ADD COLUMN reg_state TEXT;      -- '' / 'pj'（pjで登録）/ 'other'（pj以外）
ALTER TABLE mw_buy ADD COLUMN reg_sku   TEXT;      -- 見つかった出品SKU
ALTER TABLE mw_buy ADD COLUMN reg_at    TEXT;      -- 登録済みにした時刻
ALTER TABLE mw_buy ADD COLUMN reg_chk_at TEXT;     -- 最後に Amazon で確かめた時刻
