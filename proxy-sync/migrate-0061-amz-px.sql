-- 8.29（カジの依頼）会員カードの「値動き」のための値段の記録
--
-- 会員カードに「これまでの最安値・平均と、いまが平均より高いか安いか」を
-- 出したい。pj は Amazon の値段を定期的に取っているが、**最新の1つしか
-- 控えていなかった**ので、過去の値動きが分からなかった。
--
-- 行を増やさずに済むよう、mw_amz に**集計の列だけ**を足す
-- （JAN ごとに1行のまま。3,000件なら3,000行のまま）。
--   px_min  … いちばん安かった値段（送料込み・円）
--   px_max  … いちばん高かった値段
--   px_sum  … 値段の合計（px_n で割って平均にする）
--   px_n    … 記録した回数
--   px_from … 記録を始めた日時（「この◯日の記録」と出すのに使う）
--
-- 値段を取るたびに（mwScanPrice と mwBuyRefresh）この5つを書き足す。
-- 流す前の D1 では書かない（列があるかを見てから書く）。
-- Keepa につないだときは180日ぶんの統計に置き換わる（shared/subguide.js）。

ALTER TABLE mw_amz ADD COLUMN px_min  INTEGER;
ALTER TABLE mw_amz ADD COLUMN px_max  INTEGER;
ALTER TABLE mw_amz ADD COLUMN px_sum  INTEGER;
ALTER TABLE mw_amz ADD COLUMN px_n    INTEGER;
ALTER TABLE mw_amz ADD COLUMN px_from TEXT;
