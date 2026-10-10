-- 価格の元データと値下げの記録（2026-10-10）
-- 適用:  npx wrangler d1 execute pj-sync --remote --file=./migrate-0012-price-source.sql
--
-- 出品CSVのリストを空にしても価格調整ができるよう、推奨売値・最低売値の計算に要る値を
-- pj-sync 側にも残す。pj_price が書き出し・名簿のときに送る。
--   weight_g  … 実重量（梱包込。出品リストの行の値）。NULL なら既定重量を使う
--   cost_yen  … 仕入値（手直し後）。NULL なら Amazon の最安値を仕入値とみなす
--   sold_usd  … 相場（総額$）。NULL なら相場なし
-- 3日ごとの値下げの記録も D1 に置く（端末を変えても続きから動く）。
--   mark_at   … 最後に値下げCSVを書き出した時刻
--   mark_stop … 1 なら値下げしない（行ごとの印）
ALTER TABLE items ADD COLUMN weight_g  INTEGER;
ALTER TABLE items ADD COLUMN cost_yen  INTEGER;
ALTER TABLE items ADD COLUMN sold_usd  REAL;
ALTER TABLE items ADD COLUMN mark_at   TEXT;
ALTER TABLE items ADD COLUMN mark_stop INTEGER NOT NULL DEFAULT 0;
