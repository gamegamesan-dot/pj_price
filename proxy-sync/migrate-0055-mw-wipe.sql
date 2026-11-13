-- 7.141（【2】）「一度に消えた」の記録
--
-- mw_stat.wipe_n   … 一度に消えた回数
-- mw_stat.wipe_qty … そのとき消えた数の合計
--
-- 「一度に消えた」＝ 1回の確認で大量に減って0になった、または
-- MW の CSV から行がなくなった回。買い占め・取り下げ・CSV の抜けのどれかで、
-- **売れたとは数えない**（down_qty に入れない）ので、売れる速さ・
-- 欠品までの見込みには入らない。
--
-- v268 までは、CSV から行が消えた回の掲載数をまるごと「減った＝売れた」として
-- down_qty に足していた。そのため 415点が消えた商品が
-- 「売れる速さ 64.3点/日（直近7日）」と出ていた（彩京 SHOOTING LIBRARY Vol.1・
-- JAN 4571442047206）。

ALTER TABLE mw_stat ADD COLUMN wipe_n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mw_stat ADD COLUMN wipe_qty INTEGER NOT NULL DEFAULT 0;
