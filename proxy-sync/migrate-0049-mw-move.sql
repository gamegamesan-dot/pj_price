-- 7.126（【T】）MW の在庫の動きを記録して、売れる速さと再入荷の目安を出す
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
  kind       TEXT NOT NULL,                   -- new/down/up/gone/back
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
  created_at TEXT NOT NULL,
  PRIMARY KEY (jan, sha)
);
CREATE INDEX IF NOT EXISTS idx_mw_stat_jan ON mw_stat(jan);
CREATE INDEX IF NOT EXISTS idx_mw_stat_last ON mw_stat(last_at);
