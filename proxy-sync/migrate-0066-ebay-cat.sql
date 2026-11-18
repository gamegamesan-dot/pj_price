-- 8.65（カジの依頼）eBay の出品カテゴリを⚙から足す
--
-- カテゴリの一覧を**コードに書かずデータで持つ**。PC とスマホで同じものが
-- 見えるように、置き場所は D1。いまの3つは初期データとして入れる。
--
-- code    … eBay のカテゴリ番号（末端のカテゴリ）
-- name    … eBay が返す英語の名前
-- ja      … 画面に出す名前（日本語・空なら name）
-- path    … カテゴリの道筋（Collectibles > … > 末端）
-- need    … 必須の Item specifics（カンマ区切り・getItemAspectsForCategory）
-- aspects … 取った中身ぜんぶ（JSON・選べる値も入る）
-- tpl     … 列ヘッダのひな形（139973／261055／261068。空なら aspects から作る）
-- at      … 最後に eBay から取り直した時刻

CREATE TABLE IF NOT EXISTS ebay_cat (
  code       TEXT PRIMARY KEY,
  name       TEXT,
  ja         TEXT,
  path       TEXT,
  need       TEXT,
  aspects    TEXT,
  tpl        TEXT,
  at         TEXT,
  created_at TEXT
);

-- いまの3つ（コードに書いてあったもの）。ひな形は自分自身。
INSERT INTO ebay_cat (code,name,ja,path,need,aspects,tpl,at,created_at)
  VALUES ('139973','Video Games','ゲーム',
          'Video Games & Consoles > Video Games','Game Name,Platform','',
          '139973','','seed')
  ON CONFLICT(code) DO NOTHING;
INSERT INTO ebay_cat (code,name,ja,path,need,aspects,tpl,at,created_at)
  VALUES ('261055','Action Figures & Accessories','フィギュア（非可動）',
          'Toys & Hobbies > Action Figures & Accessories','Type','',
          '261055','','seed')
  ON CONFLICT(code) DO NOTHING;
INSERT INTO ebay_cat (code,name,ja,path,need,aspects,tpl,at,created_at)
  VALUES ('261068','Action Figures','フィギュア（可動）',
          'Toys & Hobbies > Action Figures & Accessories > Action Figures',
          'Type','','261068','','seed')
  ON CONFLICT(code) DO NOTHING;
