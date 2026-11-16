-- 8.47（カジの①）順位の記録（売れ行きの推定をぶれさせないため）
--
-- Amazon の順位は1回の値が大きくぶれる（その日の売れ方で上下する）。
-- 推定に使うときは**平均**で見たいので、値段の記録（migrate-0061）と
-- 同じやり方で、mw_amz に**集計の列だけ**を足す（行は増やさない）。
--   rk_min  … いちばん良かった順位（数が小さいほど良い）
--   rk_max  … いちばん悪かった順位
--   rk_sum  … 順位の合計（rk_n で割って平均にする）
--   rk_n    … 記録した回数（1回しかない品は画面に印を出す）
--   rk_from … 記録を始めた日時（「この◯日の記録」と出すのに使う）
--
-- 順位を取るたびに（ASIN・順位を引く回）この5つを書き足す。
-- 流す前の D1 では書かない（列があるかを見てから書く）。
-- 記録はこの migrate を流した日から貯まる（前の順位はさかのぼれない）。

ALTER TABLE mw_amz ADD COLUMN rk_min  INTEGER;
ALTER TABLE mw_amz ADD COLUMN rk_max  INTEGER;
ALTER TABLE mw_amz ADD COLUMN rk_sum  INTEGER;
ALTER TABLE mw_amz ADD COLUMN rk_n    INTEGER;
ALTER TABLE mw_amz ADD COLUMN rk_from TEXT;
