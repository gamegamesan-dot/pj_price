-- 流したマイグレーションの控え（7.116・【N】）
-- cd proxy-sync && node d1-exec.mjs migrate-0045-migrations.sql
-- DB: pj-sync
--
-- 出先では PowerShell が使えないので、GitHub Actions（スマホの GitHub アプリ）から
-- デプロイと D1 の作業を押せるようにする。そのとき
-- 「どのマイグレーションをもう流したか」を D1 自身に覚えさせておかないと、
-- PC で流したぶんを Actions がもう一度流してしまう。
--   file … マイグレーションのファイル名（これが主キー。二重に入らない）
--   at   … 流した日時（UTC の ISO）
--   src  … 流した場所（'pc' = 手元の PowerShell ／ 'actions' = GitHub Actions）
CREATE TABLE IF NOT EXISTS _migrations (
  file TEXT PRIMARY KEY,
  at   TEXT NOT NULL,
  src  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_migrations_at ON _migrations(at);
