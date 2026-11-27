-- 8.113（カジの依頼）会員に配信する商品（sub-）を、海外向けの Omakase Ship の商品（os-）としても並べる
--
-- 刈取の行の「海外向けにも出す」の印。JAN と入／切と時刻だけ（値段・卸値は持たない）。
-- 値段はいまの MW の os- と同じ決め方（8.94）、在庫は「MW の在庫 −（上限 − 会員がもう買った数）」。
-- 会員向けのカードを送ってから⚙の日数（既定7日）たってから書き出す（画面が決める）。
CREATE TABLE IF NOT EXISTS os_pick (
  jan        TEXT PRIMARY KEY,
  on_        INTEGER NOT NULL DEFAULT 0,   -- 1＝海外向けにも出す
  at         TEXT,                         -- 印を変えた時刻
  created_at TEXT NOT NULL
);
