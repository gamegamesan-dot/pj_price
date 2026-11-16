-- 8.56（カジの依頼）会員の月額課金と Discord のロール
--
-- mem       … 会員1人ぶん。**残すのは番号と状態だけ**
--              （氏名・住所・メールは入れない。いままでの決まりどおり）
-- mem_order … 数えた注文（同じ注文で二重に期限を延ばさないため）
-- mem_log   … 付けた・外した・延ばした の記録（あとで追えるように）
--
-- プランの変更は Shopify の管理画面で行う（pj からは定期購入を読めない：
-- read_own_subscription_contracts は「自分のアプリが作った契約」だけ）。
-- pj は「支払いの注文が来たら期限を延ばす／期限＋猶予を過ぎたらロールを外す」。

CREATE TABLE IF NOT EXISTS mem (
  cust       TEXT PRIMARY KEY,            -- Shopify の会員番号（数字だけ）
  dc         TEXT,                        -- Discord のユーザー番号
  dc_name    TEXT,                        -- Discord の表示名（⚙で残さない選択も可）
  plan       TEXT,                        -- monitor / light / standard / premium
  paid_to    TEXT,                        -- 支払い済みの期限（ISO）
  state      TEXT,                        -- active / failed / canceled / expired
  roles      TEXT,                        -- pj が付けてあるロールID（カンマ区切り）
  last_order TEXT,                        -- 最後に数えた注文の番号
  mon_from   TEXT,                        -- モニターを始めた日時（3週間を数える元）
  at         TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mem_dc      ON mem(dc);
CREATE INDEX IF NOT EXISTS idx_mem_paid_to ON mem(paid_to);

CREATE TABLE IF NOT EXISTS mem_order (
  order_id   TEXT PRIMARY KEY,            -- Shopify の注文の番号
  cust       TEXT,
  plan       TEXT,
  yen        INTEGER,
  at         TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mem_order_cust ON mem_order(cust);

CREATE TABLE IF NOT EXISTS mem_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT,
  cust       TEXT,
  kind       TEXT,                        -- paid / link / unlink / role_add / role_del / expire / fail
  detail     TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mem_log_at ON mem_log(at);
