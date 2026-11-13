-- 8.18 今日の配信の案（カジの依頼・2026-11-13）
--
-- sub_draft … 「今日の配信の案」を作ったときの中身を1行ずつ控える。
--   at    … 案を作った日時（ひとまとまりの印。同じ案の行は同じ at）
--   plan  … どのプランに振り分けたか（monitor / light / standard / premium）
--   jan   … 商品／name … そのときの商品名
--   price … そのときの販売価格（税込）／qty … 販売数の上限
--   gross … そのときの会員の粗利の目安／speed … そのときの売れる速さ
--   taken … カジが「この案で出す」で確定したか（1＝出した）
--
-- あとで「どの案から何が売れたか」を見るために、sub_order（注文）と
-- jan と日時で突き合わせる。

CREATE TABLE IF NOT EXISTS sub_draft (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  plan       TEXT NOT NULL,
  jan        TEXT NOT NULL,
  name       TEXT,
  price      INTEGER,
  qty        INTEGER,
  gross      INTEGER,
  speed      REAL,
  taken      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_draft_at ON sub_draft(at);
CREATE INDEX IF NOT EXISTS idx_sub_draft_jan ON sub_draft(jan, at);
