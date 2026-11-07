-- ⚙の設定を書き込んだ履歴（7.109）
-- cd proxy-sync && node d1-exec.mjs migrate-0041-settings-log.sql
-- DB: pj-sync
--
-- v234 までは /settings が「送られてきた設定で丸ごと置き換え」だったため、
-- 画面側が空の欄も送ると、ランキングの上限・自動申告の種類・自動の取り直しが
-- 0／空／オフで上書きされて消えていた。
-- マージ方式に変えたうえで、「いつ・どの端末（役割）・どの項目を・何から何に」
-- を残し、⚙から見て「直前の値に戻す」ができるようにする。
CREATE TABLE IF NOT EXISTS settings_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT,      -- 書き込んだ時刻（ISO）
  role        TEXT,      -- 'admin' / 'staff'（どの端末から）
  keys_n      INTEGER,   -- 変わった項目の数
  keys        TEXT,      -- 変わった項目名（カンマ区切り）
  before_json TEXT,      -- 変わる前の値（無かった項目は null）
  after_json  TEXT,      -- 変わった後の値
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_settings_log_at ON settings_log (at DESC);
