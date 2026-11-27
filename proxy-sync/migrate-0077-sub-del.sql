-- 8.111（カジの依頼）会員向け Discord の買えなくなったカードを消す
--
-- 受付終了に書き換えるだけでチャンネルに残り続け、新しいモニターが古いカードを押して
-- 「買えない」「会員専用のページ」になっていた。買えなくなったカード（購入期限を過ぎた・
-- 売り切れ・在庫が無い・そのプランから外した）は**メッセージを消す**。
-- 消したカードの記録をここに残す（sub_post の行は消さない＝配信の控え・
-- 「前の週までに出した品」の判定はこれまでどおり数えられる）。
-- 値は JAN・チャンネル・メッセージの番号・日時・理由だけ（商品名・値段は持たない）。
CREATE TABLE IF NOT EXISTS sub_del (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  jan        TEXT NOT NULL,
  ch         TEXT NOT NULL,                 -- Discord のチャンネルID
  plan       TEXT,                          -- monitor / light / standard / premium
  msg_id     TEXT,                          -- 消したメッセージの番号
  sent_at    TEXT,                          -- カードを送った日時（sub_post.at）
  del_at     TEXT NOT NULL,                 -- 消した日時
  why        TEXT NOT NULL,                 -- expired / sold_out / gone / off_plan / closed / test
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_del_at  ON sub_del(del_at);
CREATE INDEX IF NOT EXISTS idx_sub_del_jan ON sub_del(jan, ch);
