-- 8.101（カジの依頼）商品違いの疑い
--
-- MW の JAN が Amazon の違う商品につながっていることがある
-- （例：JAN 4573102666987 の MW「EG ULTRAMAN」が Amazon「スター・ウォーズ マンダロリアン」）。
-- カジが見比べて「同じ商品」と押した JAN を、そのときの ASIN と一緒に控える。
-- その ASIN のあいだは疑わない（ASIN が変わったら見立て直す）。
--
-- 表を足すだけで、今ある行の中身は変えない。

CREATE TABLE IF NOT EXISTS mw_same (
  jan        TEXT PRIMARY KEY,
  asin       TEXT NOT NULL,
  at         TEXT NOT NULL,
  created_at TEXT NOT NULL
);
