# pj_price 追加仕様：Amazon FBA × eBay 販売連携 フェイズA（見える化）

## 1. 目的と位置づけ
せどりすとで取り込んだ商品はFBAに納品し、eBayと併売する。その自動化（フェイズB〜D）の土台として、まず**状況を定期的に取り込んで「見える化」し、通知する**。

**フェイズAでは、Amazon・eBayのどちらにも書き込み操作を一切しない**（価格・数量の変更、注文作成などはしない）。読み取りと通知だけを行う。

後続フェイズの予定（参考。今回は実装しない）：
- B：FBAで売れたら、eBayの数量と価格（Amazon最安値基準）を自動更新する
- C：eBayで売れたら、MCFで自分宛てに取り寄せる注文を半自動で作る
- D：条件を絞った無在庫の継続出品（上限とキャンセル率の監視つき）

## 2. 全体構成
```
Cloudflare Worker「pj-sync」（新規。proxy-sync/）
  ├─ Cron（定期実行）
  │    ├─ 15分ごと：Amazonの注文・eBayの注文を取り込む
  │    └─ 1時間ごと：FBA在庫・eBayの出品中リストを取り込む
  ├─ D1（SQLite）：対応表・在庫スナップショット・イベント
  ├─ Discord通知（Webhook）
  └─ GET /status：pj_price の新タブから読む（読み取り専用）
```
- 既存の pj-title とは別のWorkerにする（障害や上限の影響を分けるため）。
- 定期実行の処理量が多いため、**Workers有料プラン（月$5）が必要になる可能性が高い**。無料プランのCPU時間（1回10ms）で収まるかを実測し、収まらなければ有料プランへの切り替えを前提にする（着手前の確認で報告）。

## 3. 取り込むデータ

### 3.1 Amazon（SP-API、日本 `A1VC38T7YXB528`、FE）
| データ | API | 頻度 |
|---|---|---|
| FBA在庫（販売可能・入庫中・予約済み） | FBA Inventory `getInventorySummaries`（details=true） | 1時間 |
| FBAの注文（AFN） | Orders `getOrders`（LastUpdatedAfter、FulfillmentChannels=AFN）＋`getOrderItems` | 15分 |
| Amazon最安値（参考表示用） | Product Pricing `getItemOffersBatch` | 1日1回、またはFBA売上イベント発生時にその商品だけ |

- 購入者の個人情報は取得しない（PII用の権限は申請しない）。
- 呼び出し上限（QuotaExceeded）対策は pj-title と同じ方式（間隔を空ける・指数バックオフ・最大3回）。

### 3.2 eBay
| データ | API | 頻度 |
|---|---|---|
| 注文 | Sell Fulfillment API `getOrders`（lastmodifieddate で絞る） | 15分 |
| 出品中リスト（ItemID・SKU・数量・価格） | Trading API `GetMyeBaySelling`（ActiveList、OAuthユーザートークン） | 1時間 |

- **ユーザートークン（認可コード方式）が必要**。スコープは読み取りのみ（`sell.fulfillment.readonly` ほか、`GetMyeBaySelling` に必要な最小限）。リフレッシュトークンをシークレット `EBAY_USER_REFRESH_TOKEN` に保存する。取得手順（RuNameの作成、同意画面、トークンの取り出し）は Claude Code がカジ向けに手順書として出す。
- **購入者の住所・氏名はD1に保存しない**。保存するのは注文ID・SKU・数量・金額・日時・状態のみ。

### 3.3 pj_price からの情報
- SKUごとの「在庫0時の動作（寝かせる／再調達／終了）」「一点物」「FBA連動」フラグを、pj_price から `POST /listings` で送る（アップロード結果ファイルの取り込み時と、行の設定を変えたとき）。
- 出品の実体（ItemID・数量・価格）は eBay から取り込んだ値を正とする。

## 4. 対応付け（SKUの突き合わせ）
- **SKU（CustomLabel＝せどりすとのSKU）で Amazon と eBay を結ぶ**。
- SKUで結べない場合は、ASIN（SKUの4番目の区切り）で補助的に結び、`matched_by='asin'` として表示する。
- どちらか片方にしかないSKUは「未対応付け」として一覧に出す（FBA未納品、eBay未出品などの把握用）。

## 5. D1 のテーブル（案）
- `items`：sku, asin, jan, title, ebay_item_id, ebay_qty, ebay_price, fba_available, fba_inbound, fba_reserved, mode（寝かせる/再調達/終了）, one_off, fba_link, amazon_lowest, amazon_lowest_at, updated_at
- `orders`：channel（amazon/ebay）, order_id, sku, qty, amount, currency, ordered_at, status
- `events`：id, type, sku, detail(JSON), created_at, notified_at
- `sync_state`：各取り込みの最終時刻（差分取得用）

## 6. 検出するイベント（通知のみ。操作はしない）
| type | 条件 | 通知文の例 |
|---|---|---|
| `FBA_SOLD` | FBAの注文が入ったSKUが、eBayで出品中（数量1以上） | 「FBAで売れた：{title} / eBay残数 {n}。フェイズBではここでeBayを更新します」 |
| `EBAY_SOLD` | eBayの注文が入った | 「eBayで売れた：{title} / FBA販売可能 {n}。MCFでの取り寄せが必要です」 |
| `OVERSELL_RISK` | FBA販売可能が0で、eBay数量が1以上、かつ mode が 寝かせる／終了 | 「売り越しの恐れ：{title}（FBA 0 / eBay {n}）」 |
| `QTY_MISMATCH` | FBA販売可能 < eBay数量（0を除く） | 「数量の食い違い：{title}（FBA {a} / eBay {b}）」 |
| `INBOUND_LISTED` | FBA入庫中のみで販売可能0なのにeBayで出品中 | 「納品待ちの商品がeBayに出ています：{title}」 |
| `UNMATCHED` | 対応付けできないSKUが新たに出た | 1日1回まとめて通知 |

- 同じイベントは重複して通知しない（`events` の notified_at で管理）。
- 通知先は Discord Webhook（シークレット `DISCORD_WEBHOOK_URL`）。`EBAY_SOLD` と `OVERSELL_RISK` は即時、それ以外は1時間ごとにまとめる。

## 7. pj_price 側：新タブ「販売連携」
- `GET /status`（X-PJ-Key 認証、CORSは github.io のみ）から読み、一覧を表示する。
- 表示：SKU・商品名・FBA（販売可能／入庫中）・eBay（数量／価格／ItemID）・Amazon最安値（取得日時つき）・モード・最新イベント・警告バッジ。
- 絞り込み：警告ありのみ／未対応付けのみ／直近24時間に売れたもの。
- 最終取り込み時刻と、取り込みエラーの有無を上部に表示する。
- **このタブにも書き込み操作のボタンは置かない**（フェイズBで追加する）。

## 8. シークレット
| 名前 | 内容 |
|---|---|
| `PJ_ACCESS_KEY` | pj-title と同じ値でよい（pj_price の設定を共用するため） |
| `LWA_CLIENT_ID` / `LWA_CLIENT_SECRET` / `SPAPI_REFRESH_TOKEN_FE` | pj-title と同じ値 |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | pj-title と同じ値 |
| `EBAY_USER_REFRESH_TOKEN` | 新規（3.2の手順で取得） |
| `DISCORD_WEBHOOK_URL` | 新規（keepa-hunter と別チャンネル推奨） |

値はコード・リポジトリ・会話に書かない。登録はカジが `wrangler secret put` で行う。

## 9. 着手前の確認（Claude Code が最初に行い、報告して止まる）
1. SP-API の各API（FBA Inventory／Orders／Product Pricing）に必要なロールと、既存アプリ（Pricing／Inventory and Order Tracking／Product Listing）で足りるか。足りなければ、追加申請が必要なロール名を報告する。
2. eBay ユーザートークンの取得手順と、必要な最小スコープ。
3. SKU の突き合わせ方式が実データで成り立つか（せどりすとのSKUが Amazon の出品SKUと eBay の CustomLabel の両方に入っているか）。カジから取り込み済みのCSVを受け取って確認する。
4. 無料プランで Cron の処理が収まる見込みか。

### 9章の確認結果（2026-09-29）

#### 1. SP-API のロール

| API | 必要なロール | 既存アプリで足りるか |
|---|---|---|
| Orders `getOrders` / `getOrderItems` | Inventory and Order Tracking | ✅ |
| Product Pricing `getItemOffersBatch` | Pricing | ✅ |
| FBA Inventory `getInventorySummaries` | **Amazon Fulfillment** | ❌ **追加申請が必要** |

- ロールを追加するとセラー側の再認可が必要で、**`SPAPI_REFRESH_TOKEN_FE` を取り直す**ことになる（pj-title 側も入れ直す）。
- PIIロール（Direct-to-Consumer Shipping 等）は申請しない。申請しなければ Amazon は
  `BuyerInfo` / `ShippingAddress` を返さないので、3.1の方針は自動的に守られる。
- `getItemOffersBatch` は Product Pricing v0。新しい 2022-05-01（`getCompetitiveSummary` 等）へ
  寄せる流れがあるため、実装時に v0 が使えるか確認する。ロールはどちらも Pricing。

#### 2. eBay ユーザートークン

手順（認可コード方式）：RuName を作る → `https://auth.ebay.com/oauth2/authorize?client_id=…&response_type=code&redirect_uri=<RuName>&scope=…` で同意 → 戻り先URLの `code` を取る（有効5分程度）→ `POST https://api.ebay.com/identity/v1/oauth2/token`（Basic認証、`grant_type=authorization_code`）で refresh_token を得る → `wrangler secret put EBAY_USER_REFRESH_TOKEN`。

| 用途 | スコープ |
|---|---|
| Sell Fulfillment `getOrders` | `sell.fulfillment.readonly` |
| Trading `GetMyeBaySelling` | `sell.inventory`（**読み書き兼用。読み取り専用スコープでは通らない**） |

- refresh_token の有効期間は18か月、access_token は2時間。失効時に通知を出す。
- 「書き込みをしない」保証はスコープではなくコード（10章のレビュー項目）で担保することになる。
- **代替案**：出品中リストを Trading ではなく Shopping API `GetMultipleItems`
  （JSON・20件/回・ユーザートークン不要）で取れば、書き込み権限のトークンを持たずに済む。
  ただし pj_price が ItemID を知らない出品（eBayへ直接出したもの）は見えない。

#### 3. SKU の突き合わせ

Amazon の出品SKU は Seller Central で確認済み（`hobby-20260925-UG-B09TPBVJ5F-2000` /
`dvd-20260925-UVG-B07HZHMDBH-3500`）。せどりすとのSKUと同じ形式。

**⚠ 4章の「CustomLabel＝せどりすとのSKU」は成り立たない。** `csvCustomLabel()` は
CSV一括出品仕様 6.5.2 の決定どおり、`出品種別` が FBA の行を `E-<ASIN>`（中古は `-U`）に
置き換えている。せどりすとSKU（仕入日・原価入り）は個体ごとに変わるため。

sedolist_7.csv（26件・2026-09-25）での実測：

```
SKU形式「接頭辞-仕入日-状態-ASIN-原価」に合致  26/26
SKUの4番目とASIN列が一致                      26/26
状態コードが既知（N/UM/UVG/UG/UA/UKN）         26/26
SKU最大長 34字（CustomLabel上限50字に収まる）
接頭辞     hobby 22 / toy 2 / game 2 → すべて eBay対象
出品種別   26/26 が FBA → CustomLabel は全件 E-<ASIN> 形式
CustomLabelの衝突なし／同一ASINの重複なし／JAN空 6件
```

`基準出品種別` は 自己出品 5件だが、pj_price が読むのは **`出品種別`** 列で、そちらは全件FBA。

**決定：突き合わせの主キーは「ASIN＋新品/中古」**、SKU完全一致を補助キーにする。
D1は `items`（商品単位＝`(asin, condition)`）と `skus`（個体単位＝せどりすとSKU・仕入日・
原価・CustomLabel）に分ける。中古グレード（UG/UVG/UM/UA）は eBay 側では `-U` に
一本化されるため、**同じASINの中古はFBA在庫数を合算**して突き合わせる。

#### 4. 無料プランで収まるか

| 制限 | 無料 | 有料（$5/月） |
|---|---|---|
| CPU時間／回 | 10ms | 30秒（Cron） |
| 外部リクエスト／回 | **50** | 1000 |
| リクエスト／日 | 100,000 | 従量 |

- 回数は問題ない（15分×96＋1時間×24＝1日120回）。D1の書き込みも無料枠内。
- 厳しいのは `GetMyeBaySelling` のXML解析（Workers に `DOMParser` が無い）。
  `OutputSelector` で ItemID / SKU / QuantityAvailable / CurrentPrice に絞って軽くする。
- 全件スイープ（6,000SKU＝約120ページ）は無料の50リクエスト制限に当たる。
- **有料プラン（$5/月）を前提にするのが安全。** 実測して足りれば落とす。

### 追加の決定（2026-09-29）

#### A. eBay対象外カテゴリを分ける

`items` に `scope` 列を持たせる。判定は pj_price の `CSV_PREFIX` と同じ表。

| scope | 接頭辞 | 扱い |
|---|---|---|
| `ebay` | `game` `hobby` `toy` | 通常どおり。UNMATCHED の判定対象 |
| `out` | `dvd` `cd` `book` `software` `pc` `electronics` `kitchen` `diy` `musicInst` | **eBay対象外**。UNMATCHED に含めない。一覧は既定で非表示 |
| `unknown` | 上記以外／SKUの形が違う | 通知しない。一覧は既定で非表示だが、件数を上部に出す（新しい接頭辞に気づけるように） |

#### B. FBA在庫は差分取り込みを基本にする

`getInventorySummaries` には **`startDateTime`（ISO8601、18か月以内）** があり、
指定時刻以降に変化したサマリだけを返す。

**⚠ 制限：`inboundWorkingQuantity` / `inboundShippedQuantity` / `inboundReceivingQuantity`
（入庫中の数量）の変化は `startDateTime` では検出されない**（公式ドキュメント明記）。
差分だけでは `INBOUND_LISTED` を取りこぼすため、3層にする。

| 頻度 | 方法 | 呼び出し回数の見込み |
|---|---|---|
| 1時間 | `startDateTime` ＝ 前回同期時刻 の差分 | 変化なしで1回 |
| 1日1回 | **`sellerSkus`（最大50SKU/回）で、こちらが持っている名簿のSKUだけ名指し** | 1,100点で22回 |
| 手動 | 全件スイープ（`nextToken` のページ送り・50件/ページ） | 6,000SKUで約120回 |

- 名簿は pj_price の書き出しログのせどりすとSKU（3.3の `POST /listings`）を正とする。
  **在庫0の過去SKUは名簿に無いので照会しない**（出品数6,000件に対し実在庫1,100点）。
- 全件スイープは初回構築と手動実行のみ。無料プランでも回せるよう `nextToken` をD1に
  保存して1回のCronで数ページずつ進める（カーソル方式）。
- `getInventorySummaries` の上限はドキュメント上 2 req/s・バースト2。22回で約11秒。

#### C. 実行ログ（CPU時間の扱いを訂正）

**⚠ Workers では計算中に時計が進まないため（`Date.now()` / `performance.now()` は
I/Oを挟むまで同じ値。タイミング攻撃対策）、CPU時間を Worker の中から測ることはできない。**

- `wrangler.toml` に `[observability] enabled = true` を入れ、**Cloudflare が記録する
  invocation ごとのCPU時間**（Workers Logs / `wrangler tail` / ダッシュボード）を見る。
- D1に `sync_runs` を作り、自分で数えられるものを残す：開始時刻・種別（15分/1時間/日次）・
  外部リクエスト回数・ページ数・読んだSKU数・書いた行数・エラー件数・経過時間（壁時計）。
- CPU時間は `sync_runs` には入れない（測れない値を記録しないため）。

#### D. UNMATCHED は件数だけ通知

`未対応付け: 新規 3件（合計 12件）。一覧で確認してください` のように件数のみ。
中身は `GET /status` の一覧（絞り込み「未対応付けのみ」）で見る。
`scope` が `out` / `unknown` の行は件数にも含めない。

### 判断の結果（2026-09-29・カジ）

1. SP-API に **`Amazon Fulfillment` ロールを追加申請する**（フェイズCのMCFでも必要）。
   リフレッシュトークンの取り直し後、**pj-title・pj-sync・keepa-hunter（`.env`）の3か所**を
   入れ替える（手順は `proxy-sync/README.md` 2章）。
2. eBay は **`sell.inventory` を許可し、`GetMyeBaySelling` で進める**。Shopping API 案は
   採らない（フェイズBで書き込みが必要／pj_price を通さず出した既存出品も見たい／
   Shopping API は縮小方向）。フェイズAで書き込みをしないことは**コードで担保**する
   （`worker.js` の `ALLOWED` を通らない通信は実行時に例外）。
3. Workers は **有料プラン（$5/月）** で進める。
4. 主キーは **「ASIN＋新品/中古」**、D1 は **items ＋ skus** の2テーブル。
5. eBay の注文は **注文ID・SKU・数量・金額・日時・状態だけ**保存する。生の応答は D1 にも
   Workers Logs にも残さない。

### 実装（2026-09-29・`proxy-sync/`）

| ファイル | 中身 |
|---|---|
| `proxy-sync/worker.js` | pj-sync 本体（約1,100行） |
| `proxy-sync/schema.sql` | D1のスキーマ（items / skus / orders / events / sync_state / sync_runs） |
| `proxy-sync/wrangler.toml` | name=pj-sync、cron 2本、D1・KVのバインド、`[observability] enabled = true` |
| `proxy-sync/README.md` | 手順（有料プラン・ロール追加・eBayトークン取得・D1作成・シークレット・デプロイ・トークン入れ替え3か所・手動実行・CPU時間の見かた） |

**読み取り専用の担保**：外向きの通信はすべて `net()` を通り、許可表 `ALLOWED`
（URL・メソッド・Trading の呼び出し名）に無ければ例外になる。
許可しているのは LWAトークン取得、Amazon の `getOrders`/`getOrderItems`/
`getInventorySummaries`（GET）、`getItemOffersBatch`（読み取りだがPOSTしか無い）、
eBay のトークン取得と `getOrders`（GET）、Trading の `GetMyeBaySelling` のみ、
そして Discord Webhook。書き込みAPIを足すにはこの表を変えるしかない。

**エンドポイント**：`GET /status`、`GET /runs`、`POST /listings`、`POST /sync`、`GET`/`POST /settings`（7.24）
（kind: orders / inventory / rollcall / sweep / pricing / notify）。

**定期実行**：15分ごと＝注文（即時通知は `EBAY_SOLD` と `OVERSELL_RISK`）、
毎時07分＝在庫差分＋eBay出品中リスト（まとめて通知）、
毎時のうちUTC18時台＝名簿の名指し確認＋最安値＋未対応付けの件数。全件スイープは手動。

**検証（実APIには未接続。`node:sqlite` をD1に見立てたテストとモックで確認）**

```
認証・CORS        キー不一致401 / 別オリジン403 / 未知パス404
読み取り専用ガード Listings PUT・PATCH、MCF注文作成、eBay出品公開・在庫更新、
                  Trading の Revise系、呼び出し名なし、未知の宛先 … すべて遮断
                  許可しているGET/POSTは通る（15ケース）
名簿登録          3件登録・1件解析不可、dvd- は scope=out
在庫              UG1＋UVG2 を合算して used=3、E-<ASIN>-U と結びつく、
                  在庫0の過去SKUは active=0
イベント          売り越しの恐れ／納品待ちで出品中／数量の食い違い／FBA_SOLD／EBAY_SOLD
                  を検出。EBAY_SOLDは即時、他はまとめて通知。二重通知なし
個人情報          orders表に氏名・住所・購入者IDの列も値も無い
最安値            本体9000＋送料500 → 9500 を採用
/status           既定で out / unknown を出さない、warn=1 で警告のみ、CPU時間は記録しない
実データ          sedolist_7.csv 26件すべてが
                  SKU → キー → CustomLabel → キー で往復できる（ASIN一致26/26）
```

### 初回実行で出た不具合の修正（2026-09-30）

`POST /sync {"kind":"orders","days":7}` の1回目：elapsed 130秒・subrequests 153・
rows_written 188・errors 3・最後に `D1_ERROR: too many SQL variables` で中断。

#### 1. `getOrderItems` の 429 連発 → APIごとの間隔と待ち行列

間隔を全APIで共通（350ms）にしていたのが原因。Amazonの上限はAPIごとに違う。

| API | 上限（ドキュメント） | あける間隔 |
|---|---|---|
| `getOrders` | 0.0167回/秒（バースト20） | 1.0秒 |
| `getOrderItems` | **0.5回/秒** | **2.1秒** |
| `getInventorySummaries` | 2回/秒（バースト2） | 0.6秒 |
| `getItemOffersBatch` | 0.1回/秒 | 10.5秒（1回の実行で6回＝120件まで） |

待ち行列を持たせて、取り直しをしない形にした（表 `order_queue`）。

- 注文一覧で見つけた注文は `order_queue` に積み、**1回の実行では既定25件**
  （`/sync` の `max` で最大120件）まで明細を取る。時間の上限（240秒）でも打ち切る。
- 取り終えた注文は `done_at` が入り、**二度と明細を取り直さない**。
  状態の変化は注文一覧の値で `orders.status` だけ更新する（呼び出しを増やさない）。
- 失敗した注文は `done_at` が空のまま `tries` が増え、**次回の実行でやり直す**。
- 残り件数は `note` と `/sync` の戻り（`items_pending`）に出る。0になるまで押せばよい。
- **eBayの取り込みをAmazonの明細より先に行う**ようにした（明細が長引いても
  eBayが取り残されないようにする）。

#### 2. `too many SQL variables` → まとめ引きを分割

`itemsByKeys()` が `(asin=? AND cond=?) OR …` を件数ぶん並べていたため、
D1の**1命令あたりのバインド変数上限（100個）**を超えていた（60キーで120個）。
重複キーをまとめたうえで **40キー（80個）ずつ**に分けて引くようにした。

#### 検証（`node:sqlite` をD1に見立て、上限100個も再現して）

```
注文60件・明細の上限25件/回・最初の2回だけ429を返す条件で
  1回目 errors=0 / 間隔 2102,2100,2103,2101,2103 ms / eBay注文まで到達
        待ち行列 取得済み25・残り35 / 呼び出し27回（成功25＋429リトライ2）
  2回目 25件だけ呼ぶ（1回目の25件は再取得しない）
  3回目 残り10件で完了 → items_pending 0
  4回目 新しい注文が無ければ getOrderItems を1回も呼ばない
60キーを一度に引く場面（在庫差分60件）
  修正前（HEAD）… errors=1「too many SQL variables at offset 1629」で中断
  修正後        … errors=0・items 60行
既存のテストも再実行：読み取り専用ガード16ケース、在庫の合算、イベントと二重通知の防止、
個人情報の非保存、最安値、/status の絞り込み … すべて通過
```

**D1の表を1つ足した（`order_queue`）**ので、`schema.sql` を再適用する
（すべて `CREATE ... IF NOT EXISTS` なので既存データは消えない）。
**Worker の再デプロイが必要。**

### 受け入れテスト1回目：注文件数の食い違い（2026-09-30）

Seller Central の FBA「すべての注文」は過去7日（注文日基準）で **71件**、
pj-sync は Amazon **93件**。原因は2つで、どちらも仕様の作りの問題だった。

#### 販売経路（SalesChannel）を見ていなかった

Amazonの注文一覧には、実際の売上以外も入る。画面で「販売経路：Non-Amazon」に
なっていた注文は、他販路の販売ではなく **Amazonが作る返送**
（長期保管在庫の自動返送、販売不可在庫の返送）だった。

`orders` と `order_queue` に `sales_channel` / `kind` / `seller_order_id` を持たせ、
次のように分ける。

| `kind` | 条件 | 扱い |
|---|---|---|
| `sale` | `SalesChannel` が `Amazon.co.jp` | 売上。`FBA_SOLD` の対象。ただし `Canceled` / `Unfulfillable` は売れていないので対象外にする |
| `removal` | `Non-Amazon` かつ出品者注文IDが `PJ-` で始まらない | 返送。売上として扱わず **`FBA_REMOVAL`**（返送で手元に戻る在庫）にする |
| `mcf` | `Non-Amazon` かつ出品者注文IDが **`PJ-`** で始まる | 自分のMCF注文。フェイズAでは作らないので通常0件。イベントも作らない |

**フェイズCでMCF注文を作るときは、出品者注文ID（`SellerOrderId`）を `PJ-` で始める。**
これが自分の取り寄せとAmazonの返送を区別する唯一の手がかりになる。今のうちに
区別の仕組みだけ入れておく。

`FBA_REMOVAL` の通知文：
`返送で手元に戻ります：{title}（{qty}点）。売上ではありません（長期保管在庫・販売不可在庫の返送）`

#### 期間の基準が違う

注文一覧は `LastUpdatedAfter` で引いているので、**注文日が7日より前でも期間内に
更新があった注文は入る**。画面の「過去7日間」は注文日基準なので、その分が増える。
これは差分取得の仕組み上そうなるのが正しく、件数の突き合わせは
**注文日で絞った数**（`sale_in_window`）で行う。

#### 内訳を見るための読み取り専用エンドポイント

`GET /orders/summary?days=7` を追加した。返すもの：

- `total_orders` … 取り込み済みのAmazon注文（`order_id` の重複を除く）
- `by_purchase_window.in_window` / `.older_but_updated` … 注文日が期間内か、期間より前か
- `by_status` … Shipped / Pending / Canceled などの件数
- `by_sales_channel` … `Amazon.co.jp` / `Non-Amazon` の件数
- `by_kind` … `sale` / `removal` / `mcf` の件数
- `sale_in_window` … **Seller Central の71件と突き合わせる数**
- `sale_in_window_live` … そこから Canceled / Unfulfillable を除いた数
- `queue_pending` … 明細の残り

販売経路を持たせる前に取り込んだ行は `sales_channel` が空になる。
`/sync {"kind":"orders","days":7}` をもう一度実行すれば、**明細を取り直さずに**
注文一覧の値だけで埋まる（`getOrderItems` は呼ばれない）。

#### せどりすと形式でない古いSKU

`20210120-75010-1267` のようなSKUは `parseSku()` が解析できず **`scope='unknown'`**
になる。`skus` にも `items`（ASINで行は作る）にも `unknown` で入り、
UNMATCHED の通知にも件数にも含めず、一覧では既定で非表示。
`parseLabel()` でも解析されないので、eBay側と誤って結びつくことはない。

#### 検証（`node:sqlite` をD1に見立てて）

```
販売経路   Amazon.co.jp → sale / Non-Amazon → removal / Non-Amazon＋PJ- → mcf ✅
イベント   売上のみ FBA_SOLD、返送は FBA_REMOVAL、MCFはイベントを作らない ✅
           Canceled の注文は FBA_SOLD にしない（sale_in_window 2件のうち live は1件）✅
古いSKU    20210120-75010-1267 は skus・items ともに scope=unknown、
           CustomLabel としても解析不可 ✅
内訳       注文日が期間内4件・期間外だが更新あり1件、状態別・販売経路別・区分別に集計 ✅
既存のテスト（ガード16ケース、待ち行列、D1のバインド変数上限、在庫の合算、
二重通知の防止、個人情報の非保存）も全て通過 ✅
```

**D1の既存の表に列を足したので `migrate-0002-sales-channel.sql` の適用が必要。
Worker の再デプロイも必要。**

### 受け入れテスト：注文件数 → 合格（2026-09-30）

| | Seller Central | pj-sync | |
|---|---|---|---|
| Amazon.co.jp の注文 | 68件 | `in_window` 76件 − Canceled 8件 = **68件** | ✅ 一致 |
| 取り消し済み | 9件 | 9件 | ✅ 一致 |
| Non-Amazon | 3件 | **0件（取れていない）** | 下記の「後で対応」 |
| eBayの注文 | 6件 | 6件 | ✅ 一致 |

### 後で対応：返送とMCFは Fulfillment Outbound API で読む

Seller Central の Non-Amazon 3件は「返送/所有権の放棄」（注文元：有効な出品情報が
ない在庫の自動返送/廃棄システム、配送先は自宅）だった。
**Orders API（`marketplaceIds` 指定）ではこれらは返ってこない**
（実測：`by_sales_channel` は `Amazon.co.jp` のみ）。

- 返送（長期保管在庫の自動返送・販売不可在庫の返送・所有権の放棄）と、
  フェイズCで自分が作るMCF注文は、**Fulfillment Outbound API**
  （`listAllFulfillmentOrders` ほか）で読む必要がある。
- これには **`Amazon Fulfillment` ロールの承認**が要る。承認後に対応する。
- **`FBA_REMOVAL` イベントは、その時点で Fulfillment Outbound API から作る形に見直す。**
  いま入っている「Orders API の `SalesChannel` が Non-Amazon なら removal」という
  判定は、取れないので発火しない。誤検知の防止として残しておく。
- 自分のMCF注文を `PJ-` で始める方針（`kind='mcf'`）はそのまま使う。
  Fulfillment Outbound API では `sellerFulfillmentOrderId` がこの値になる。
- 読み取り専用の許可表（`ALLOWED`）には、そのとき
  `GET /fba/outbound/2020-07-01/fulfillmentOrders` を足す（`POST` は足さない）。

### 受け入れテスト用の通知（2026-09-30 追加）

`POST /sync {"kind":"test-notify"}`（任意で `"tag":"2"`）。
テストイベントを1件入れて通知する。**同じ印（`tag`、既定は当日の日付）の2回目は
届かない**ので、通知の重複防止が効いていることをそのまま確かめられる。
印を変えれば別の1通が届く。書き込みは自分のD1とDiscordだけ。

`Amazon Fulfillment` ロールの承認待ちのあいだは `getInventorySummaries` が 403 になるが、
**eBay側の取り込みは同じ実行内で進む**（実測：403 が `note` に残り、
`items` には ItemID・数量・売値が入る。FBA列は空のままで、一覧では「未対応付け」と出る）。

### 受け入れテスト：通知 → 合格 / 在庫と出品中リストの不具合（2026-09-30）

**A. Discord通知：合格。** `test-notify` を 印そのまま→印そのまま→印を変える の順で
実行し、`events` が 1 → 0 → 1。同じイベントが二重に届かないことを確認した。

**B. `/sync {"kind":"inventory"}` で errors=2。** 2件とも修正した。

#### B-1. `GetMyeBaySelling` の OutputSelector が誤りで出品が1件も取れていなかった

`One or more of the output selectors is incorrect.`（ErrorCode 37）で Failure。
**`OutputSelector` は既定で付けない**ことにした（`EBAY_SELECTORS = []`）。
応答が大きくなるので1ページ200→100件にした。通る指定が分かったら
`EBAY_SELECTORS` に入れれば絞れる。指定して失敗した回は**一度だけ指定なしで
取り直す**ので、間違った指定で出品が消えることはない。

あわせて**数量の取り方も直した**。`QuantityAvailable` は `GetMyeBaySelling` では
返らないことがあり、そのままだと**全出品の数量が0**になってしまう
（`OVERSELL_RISK` も `QTY_MISMATCH` も出なくなる）。無い場合は
**出品数量 − 売れた数量**で出す。

#### B-2. `getInventorySummaries` が 400（403ではない）

ロール不足なら403なので引数の誤りと判断した。次のようにした。

- **エラー本文を `note` に出す**（`errors[].code` / `message` / `details`）。
  原因が分からないと直せないため。購入者情報は含まれない。
- `startDateTime` を **ミリ秒なしのISO8601**（`2026-09-30T01:23:45Z`）にした。
- リスト引数（`sellerSkus`）を**カンマ区切り**にした。同じ名前を繰り返す形
  （`sellerSkus=a&sellerSkus=b`）は400になるため。日次の名指し確認で効く。
- **400のときは `startDateTime` を外して1ページだけ試す**。通れば
  `→ 通った（原因は startDateTime）` と `note` に出る。この回は1ページしか
  見ていないので**差分の基準時刻を進めない**（取りこぼし防止）。

これで次の実行の `note` に本当の原因が出る。ロール承認前でも、403なら403と
本文が残る。

#### 検証（修正前後を並べて）

```
修正前 errors=2 / note: getInventorySummaries -> 400 / GetMyeBaySelling -> 200 Input data is invalid.
       items 0件（出品が1件も入らない）
修正後 note: getInventorySummaries -> 400 InvalidInput: startDateTime is not a valid ISO 8601 date
             / startDateTime を外して再試行 / → 通った（原因は startDateTime）
             / 在庫差分 1件 / eBay出品 2件
       items 2件・ItemID・売値が入る／数量＝出品3−売れた1＝2 ✅
       400の本文がnoteに出る ✅ 切り分けが動く ✅ 原因を名指しする ✅
       切り分けの回は基準時刻を進めない ✅ 400解消後は errors=0 で基準時刻も進む ✅
既存のテスト（ガード16ケース・待ち行列・D1のバインド変数上限・販売経路・
通知の重複防止・個人情報の非保存）も全て通過 ✅
```

### 受け入れテスト：出品中リストは取得成功、在庫のページ送りを修正（2026-09-30）

`/sync {"kind":"inventory"}` で **eBay出品32件を取り込み**、`/status` に10件表示
（`E-<ASIN>` 形式）。OutputSelector を外した修正は効いた。残った errors=1 を修正した。

#### FBA在庫に `Amazon Fulfillment` ロールは要らなかった

`getInventorySummaries` の**1ページ目は通っている**（在庫差分2件）。
ロールが足りないなら 403 `Unauthorized` になるので、**現在の権限
（Pricing / Inventory and Order Tracking / Product Listing）で
FBA Inventory API は読める**と判断する。

- したがって在庫の取り込みは**ロール承認を待たずに進められる**。
- ただし **返送（Fulfillment Outbound）とフェイズCのMCFには `Amazon Fulfillment`
  ロールが必要**。Non-Amazon 3件が Orders API で取れなかった件はこちらなので、
  申請はそのまま進める価値がある。
- 万一 403 に変わった場合は `note` に本文が残るので、そこで判断できる。

#### `nextToken` は1ページ目と同じ絞り込みと対で使う

400 `Invalid nextToken for the request, add startDateTime and try again`。
**続きを読むときも1ページ目と同じ絞り込み（`startDateTime` など）を付ける**
必要があった。1ページ目の引数を作っておき、以降は `nextToken` だけ差し替える形にした。

- 全件スイープは `nextToken` と**起点の `startDateTime` を対でD1に保存**する
  （`sweep.token` / `sweep.since`）。完走したら起点も消して次回は新しい起点にする。
- 保存していたトークンが古くて無効なら、**破棄して1ページ目から読み直す**（1回だけ）。

#### CustomLabel が解析できない既存出品は件数だけ

CustomLabel が空欄のものと `260918-2023-7000` のような別形式が計17件
（pj_price を通さず出した出品）。ASIN＋新品/中古のキーが作れないので
**`items` に入れず、一覧にも通知にも出さない**。
`note` には1件ずつ並べず **「CustomLabel解析不可 n件」**とだけ出し、
`/status` の `counts.ebay_unparsed` でも見られるようにした。

#### 検証（修正前後を並べて）

```
在庫が2ページある条件
  修正前 errors=1 / 呼び出し [tok:なし+startDateTime, tok:P2+startDateTimeなし]
         → 2ページ目が400。skus 1件しか入らない
         note に解析不可のSKUが1件ずつ並ぶ
  修正後 errors=0 / 呼び出し [tok:なし+startDateTime, tok:P2+startDateTimeあり]
         → skus 2件。note は「CustomLabel解析不可 3件（…対象外）」だけ
保存していた古いトークン（STALE）
  400を1回記録 → 「nextToken が無効なので1ページ目から読み直す」→ 最初から読み直して完走 ✅
rollcall（名簿の名指し確認）
  errors=0。sellerSkus はカンマ区切りで1回に渡す ✅
/status
  counts.ebay_unparsed = 3、一覧は解析できた行だけ ✅
既存のテスト（ガード16ケース・注文明細の待ち行列・D1バインド上限・販売経路・
通知の重複防止・個人情報の非保存）も全て通過 ✅
```

### 名簿（roster）と未対応付けの見直し（2026-09-30）

`/sync inventory` errors=0・在庫差分12件・eBay出品32件・解析不可17件、
`rollcall` errors=0・名簿10件、`counts` は ebay 86 / out 22 / unmatched 86 /
roster 10 / ebay_unparsed 17。**上位10件がすべてFBA列が空**だった。

#### 名簿が10件しかない理由（にわとりと卵）

`skus` 表が名簿で、入るきっかけは
**①FBA在庫の取り込みで見えたSKU ②`POST /listings`** の2つだけ。
差分（`startDateTime`）は**動きのあったSKUしか返さない**ので12件、うち在庫が
あるものが10件。日次の名指し確認（`rollcall`）は**名簿のSKUしか照会しない**ため、
名簿が小さいままでは在庫が埋まらない。

→ **導入時に一度だけ全件スイープを回して名簿を作る。**
`POST /sync {"kind":"sweep"}` を `sweep_done` が `true` になるまで繰り返す
（`nextToken` と起点をD1に保存して数ページずつ進む）。以後は差分と日次の
名指し確認だけで追いつく。

pj_price の「販売連携」タブができたら `POST /listings` で出品側からも名簿が
埋まる（11章の4）。それまではスイープと差分だけで運用できる。

スイープの戻りに `sweep_done` と `sweep_rows` を足し、繰り返しの判断ができるようにした。
起点は既定540日前（Amazonが18か月より前の `startDateTime` を受けないため。
`{"kind":"sweep","days":N}` で変えられる）。**この期間に一度も動きがないSKUは
取れない**点は割り切る。

#### 未対応付けを2種類に分ける

| `state` | 意味 | 扱い |
|---|---|---|
| `listed_no_fba` | **eBayに出ているのにFBA在庫の記録が無い** | 警告「FBA在庫なし」。`UNMATCHED` 通知の対象（件数だけ） |
| `fba_not_listed` | FBA在庫はあるがeBayに出していない | **通常の状態。警告にしない。**件数だけ出す |
| `ok` | 両方ある | 売り越し・数量の食い違いを見る |

- `/status` の各行に `state` を付け、`?state=listed_no_fba` で絞り込める
- `counts` に `listed_no_fba` / `fba_not_listed` を足した（`unmatched` は合計として残す）
- `UNMATCHED` の通知文を
  「eBayに出ているのにFBA在庫が無い：新規 n件（合計 m件）」に変えた。
  **`fba_not_listed` は件数にも通知にも含めない**

#### 検証（FBA在庫130SKU・うち5件がeBayにも出ている条件）

```
差分だけの状態      名簿1件・listed_no_fba 5件（いまの状況と同じ形）
全件スイープ        3ページを1回で読み切り sweep_done=true / skus 130件
                    名簿 111件（130 − 在庫0の19件）
eBay出品との結合    FBAにもある5件が結びつく（state=ok、FBA数量が入る）
                    在庫0の1件は「売り越しの恐れ」になる
未対応付けの2分割   listed_no_fba 2件（警告あり）/ fba_not_listed 125件（警告なし）
                    warn=1 に fba_not_listed は出ない / state で絞り込める
通知                「eBayに出ているのにFBA在庫が無い：新規 2件（合計 2件）」
                    fba_not_listed の125件は含まない
既存のテスト（ガード16ケース・注文の待ち行列・nextToken・D1バインド上限・
販売経路・通知の重複防止・個人情報の非保存）も全て通過
```

### 件数の数え方と手元在庫（2026-09-30）

全件スイープ完了（7回・errors=0）。名簿696件、`/status` の10件がFBA在庫と結びついた。
`counts` は ebay 3841 / out 2146 / unknown 122 / listed_no_fba 1 /
fba_not_listed 3826 / roster 696 / ebay_unparsed 17。

#### 何を数えていたか（`fba_not_listed` 3,826件の正体）

`items` は **ASIN＋新品/中古で1行**。全件スイープで**過去に一度でもFBAに入れた
すべてのSKU**が入るので、`ebay` 3,841件は**在庫0の過去SKUを含む数**だった。
`fba_not_listed` も同じで、在庫0の過去SKUを数えていた。

**在庫が1点以上（販売可能・入庫中・予約済みのどれかが1以上）の行だけを数える**
ようにし、状態を4つに分けた。

| `state` | 意味 | 扱い |
|---|---|---|
| `listed_no_fba` | eBayに出ているのにFBAの記録が無い | 警告。`UNMATCHED` 通知の対象 |
| `ok` | 両方ある | 予約済みのみ／売り越し／納品待ち／数量の食い違い |
| `fba_not_listed` | **在庫1点以上**でeBay未出品 | 通常。警告にしない。件数だけ |
| `past` | FBAの記録はあるが在庫0・eBay未出品 | 一覧の既定では出さない。件数だけ（`past_zero`） |

`counts` は次の意味にした。`ebay_in_stock` が**いまの持ち物に近い数**（1,000点弱の
想定に合うはず）。`roster` は個体単位（`skus`）なので `items` より多いことがある。

| キー | 数えているもの |
|---|---|
| `ebay` | eBay対象カテゴリの行すべて（在庫0の過去SKUも含む） |
| `ebay_in_stock` | そのうち在庫が1点以上ある行 |
| `listed` | eBayに出ている行（数量0の終了分も含む） |
| `listed_no_fba` / `fba_not_listed` / `past_zero` | 上の表のとおり |
| `on_hand` | 手元在庫ありの印が付いている行 |
| `roster` | 名簿（在庫があってeBay対象のSKU数・個体単位） |

一覧は既定で**「eBayに出ている」か「在庫が1点以上ある」行だけ**を返す
（`?all=1` で過去SKUも出す。`?state=past` で過去SKUだけ）。

#### 手元在庫（on_hand）と「予約済みのみ」

仕入れてすぐeBayに出し、FBA納品はその後になるため、FBA 0 の行に
「売り越しの恐れ」が出てしまう。**行に手元在庫の印を持たせて抑える。**

- `items.on_hand`（0/1）を追加。**`POST /listings` の `on_hand: true` で送る。**
- 印が立っている行は **FBA 0 でも「売り越しの恐れ」「納品待ちで出品中」を出さない**
  （警告もイベントも作らない）。印を外せば元に戻る。
- pj_price 側は、出品CSVタブの行に「手元在庫あり」を持たせて送る形にする
  （11章の4で実装）。せどりすと取り込み時は**FBA納品前なので既定でオン**にし、
  FBA在庫が確認できた行は自動で下げる運用を想定する。
- **`RESERVED_ONLY`（FBA販売可能0・予約済み1以上・eBay出品中）は最優先の警告**にし、
  即時通知する。Amazon側で注文が入って出荷待ちの状態で、eBayで売れると二重に
  売ることになる。手元在庫があってもAmazon側の在庫は消えるので**こちらは抑えない**。

#### 検証

```
FBA在庫4件（販売可能あり／在庫0／予約済みのみ／入庫中のみ）＋eBay出品5件
  ebay 5 / ebay_in_stock 3 / listed 5 / listed_no_fba 1 / past_zero 0 ✅
  在庫0でeBay未出品の行を足すと past_zero 1 になり、既定の一覧には出ない ✅
                                  ?all=1 で出る／?state=past で絞れる ✅
  予約済みのみ → 警告の先頭が「予約済みのみ（Amazonで注文済み）」＋即時通知 ✅
  on_hand を立てると「売り越しの恐れ」「納品待ちで出品中」が消える ✅
    イベント（OVERSELL_RISK / INBOUND_LISTED）も作られない ✅
    外すと警告とイベントが戻る ✅  counts.on_hand で件数が見える ✅
130SKUのスイープ再テスト：fba_not_listed 107件・past_zero 18件に分かれる ✅
既存のテスト（ガード16ケース・注文の待ち行列・nextToken・D1バインド上限・
販売経路・通知の重複防止・個人情報の非保存）も全て通過 ✅
```

**D1に列を1つ足したので `migrate-0003-on-hand.sql` の適用が必要。再デプロイも必要。**

## 10. 受け入れテスト
- 初回の取り込みで過去7日分を読み込み、注文件数が Seller Central・Seller Hub の表示と一致する。
- テスト用に Discord 通知が届く（同じイベントが二重に届かない）。
- `GET /status` の一覧で、FBA在庫・eBay数量が各管理画面と一致する（抜き取り10件）。
- **Worker のコードに、Amazon・eBay への書き込み系API呼び出しが含まれていない**ことをレビューで確認する。
- D1 に購入者の個人情報が保存されていない。

## 7.5 pj_price「販売連携」タブ（2026-09-30・sw.js v80）

10章の受け入れテストは全て合格（FBA在庫の抜き取り4件も一致）。
`counts` は ebay_in_stock 691 / listed 15 / listed_no_fba 1 / fba_not_listed 682 /
past_zero 3144 / on_hand 0。これを受けてタブを作った。

### 画面

| ところ | 中身 |
|---|---|
| 見出し | FBA在庫（1点以上）の件数と、eBay出品・FBA在庫なし・在庫ありeBay未出品・手元在庫・過去SKU・解析不可の件数 |
| 「状況を取り込む」 | `GET /status?limit=1000`。最終実行の時刻と種類、直近のエラー有無も出す |
| 「出品リストの名簿を送る」 | `POST /listings`（200件ずつ）。SKU・CustomLabel・ItemID・モード・一点物・FBA連動・**手元在庫** |
| 「再調達で出し直すCSVを書き出す」 | 選んだ行の Revise ファイル |
| 絞り込み | 警告あり／eBay出品ありか在庫あり（既定）／eBayに出ている／FBA在庫なし／在庫ありeBay未出品／手元在庫あり |
| 行 | 商品名・警告バッジ・CustomLabel・ItemID・ASIN・新品中古／FBA（販売可能・入庫・予約）・eBay（数量・売値）／**Amazon最安値（円・取得日時）**／**推奨売値・最低売値・利益・使った重量** |

- このタブでも計算機の「商品」欄は隠す（行ごとの値で計算するため）
- 取り込んだ内容は localStorage に持つので、開き直しても前回の状態が出る
- **書き込み操作のボタンは置かない**（`POST /listings` は pj-sync へ名簿を送るだけ。
  Amazon・eBayへは書き込まない）

### 推奨売値（フェイズBの手作業版）

**Amazon最安値（送料込み・円）を仕入値とみなして、計算機と同じ `csvPriceFor()` で出す。**
値付けの式を2か所に持たない。

重量は出品リストの同じ商品（ItemID一致 → CustomLabel一致）から取り、無ければ
設定「推奨売値の既定重量」（初期値400g）を使い、表に「既定」と出す。
名簿を送ったあとは出品リストと結びつくので、送信後に推奨売値を出し直して
**表示と書き出しの売値が必ず一致する**ようにしている。

### 手元在庫の印の付け方

「名簿を送るとき、FBA在庫が未確認の行に『手元在庫あり』を付ける」（既定オン）。
取り込み済みの `/status` で `fba_seen_at` がある行には**付けない**ので、
FBA在庫が確認できた行は自動で印が下がる。

### 再調達で出し直すCSV

`ebay_restock_itemid_YYMMDD.csv`。列は7つ。

```
*Action(SiteID=US|Country=JP|Currency=USD|Version=1193|CC=UTF-8),ItemID,*Quantity,
*StartPrice,ShippingProfileName,ReturnProfileName,PaymentProfileName
Revise,110111,1,193.31,W2000,Returns 30d Buyer Paid,Managed Payments Immediate
```

- 特定キーは **ItemID のみ**（ItemIDが無い行は選べない）
- 数量はいまのeBay数量（0なら1）、売値は**推奨売値**
- 配送ポリシーは出品CSVタブの設定「再調達用ポリシー名」（既定 `W2000`）

**File Exchange の Revise で配送ポリシー名を変えられる（2026-10-01 実機で確定）。**
1件（Raiden III）をアップロードし、配送ポリシー W2000・数量1・推奨売値に
正しく変更された。3列（`ShippingProfileName` / `ReturnProfileName` /
`PaymentProfileName`）を揃えて送る形で問題ない。

### 検証（実ブラウザ・pj-sync はモック）

```
タブ5本になり、販売連携タブで「商品」欄が隠れる ✅
取り込み 4件・見出し691・件数の内訳が出る ✅
行の表示  予約済みのみ／売り越しの恐れ／FBA在庫なし／手元在庫のバッジ ✅
          Amazon最安値 ¥12,800（2026-09-30 18:06）✅
          推奨売値 $189.00（計算機の csvPriceFor と同値）・最低・利益・重量400g既定 ✅
          最安値が無い行は「推奨売値 —」 ✅
絞り込み  warn 3 / listed 3 / listed_no_fba 1 / fba_not_listed 1 / on_hand 1 / all 4 ✅
名簿送信  2件。FBA在庫が確認できている行は on_hand=false、未確認の行は true ✅
          モード・FBA連動も送る ✅ 送信後に推奨売値を出し直す（重量550gで $193.31）✅
再調達CSV 選択なしなら案内のみ／2件選択で7列・CRLF・BOMなし・W2000 ✅
再読み込み localStorage から一覧が戻る ✅  pageerror なし ✅
回帰13本（v12・v13・revtest・condtest2・v58・step5・step6・pricecsv・v76・v78・
redo・cat・tafit）すべて ❌なし ✅
```

## 7.6 手元在庫の扱いとFBA納品の候補（2026-09-30・sw.js v81）

### 運用の前提

せどりすとで仕入れた商品は、**FBAに送る前にまずeBayに出す（手元在庫）**。
FBA納品までの7〜10日のあいだにeBayで売れたものは手元から発送し、
**売れ残ったものだけFBAへ送る**。だから「名簿送信時は手元在庫の印を既定でオン」が正しい。

### 不具合：FBA納品済みの行にも印が付いた

`syncPush` が「FBA在庫を確認済みか」を **CustomLabel** で突き合わせていた。
FBAにあってeBay未出品の行は `ebay_sku` が空なので一致せず、
**すでに納品済みの行（販売可能1・予約済み1など）にまで印が付いた。**

**突き合わせを ASIN＋新品/中古 に変えた**（pj_price 側の判定は
`asin` と `condId===1000 ? 'new' : 'used'`。`csvCustomLabel` の `-U` の付け方と同じ）。
ItemIDやCustomLabelには頼らない。

### 印が外れる条件（Worker側でも守る）

**FBAに在庫（販売可能・入庫中・予約済みのいずれか）が1点でも付いたら自動で外れる。**
納品プランを作って入庫中の数が出た時点で外れる。3か所で守る。

1. 在庫の取り込み（差分・名指し・スイープ）のたびに、在庫が付いた行の印を外す
2. `POST /listings` で `on_hand: true` が来ても、在庫がある行には付けない
3. `POST /sync {"kind":"onhand-clean"}` … 在庫がある行の印をまとめて外す
   （pj_price の「手元在庫の印を付け直す」ボタンから呼ぶ。戻りは `cleared` / `on_hand_left`）

**いま誤って付いている印の消し方**：名簿を送り直せば正しく外れる（1と2が効く）。
すぐ直したいときは「手元在庫の印を付け直す」ボタン（3）。

あわせて、**手元在庫の行は `listed_no_fba`（FBA在庫なし）の警告と件数から外した**。
納品前にFBAの記録が無いのは正常で、7〜10日のあいだ警告が出続けるのを防ぐ。

### FBA納品の候補

`/status` の各行に **`ebay_start`（出品開始日時）と `ebay_sold`（直近180日のeBay販売点数）**
を足した。`ebay_start` は `GetMyeBaySelling` の `ListingDetails.StartTime`
（`OutputSelector` を外したので取れるようになった）。

販売連携タブの絞り込みに2つ追加した。

| 絞り込み | 条件 | 意味 |
|---|---|---|
| FBA納品の候補（手元在庫・eBay未販売） | `on_hand=1` かつ `ebay_sold=0` | **FBAに送る候補** |
| eBayで売れた（FBAに送らない） | `on_hand=1` かつ `ebay_sold>0` | 手元から発送済み |

行にはバッジ（「FBA納品の候補」／「eBayで売れた・FBAに送らない」）と、
**出品してからの日数**（`出品 9日目`）、eBayの販売点数を出す。
見出しの件数にも「手元在庫 n件（FBA納品の候補 m件）」と出す。

### 検証

```
Worker側
  FBA未納品の3件に印が付く → FBAに納品（販売可能1・予約1／入庫中2）→ 印が自動で外れる ✅
  まだ在庫が無い行の印は残る ✅
  名簿で on_hand:true を送っても在庫がある行には付かない ✅
  onhand-clean … 在庫がある2件を外し、在庫が無い1件は残す ✅
  出品開始日が入り、出品9日目と数えられる ✅  eBayで売れた行は ebay_sold=1 ✅
  手元在庫の行は「FBA在庫なし」の警告にも件数にもしない／印を外すと戻る ✅
  入庫中が出ている行は手元在庫にできない（納品待ちの警告が出る）✅
pj_price側（実ブラウザ・pj-syncはモック）
  ★eBay未出品でもFBA在庫がある行には印を付けない（今回の不具合）✅
  FBA在庫（予約1）がある行にも付けない ✅
  FBA納品の候補＝未販売の1件だけ／eBayで売れた＝1件 ✅
  出品してからの日数・eBay販売点数・バッジ・見出しの候補数 ✅
  「手元在庫の印を付け直す」→ onhand-clean を送り結果を表示 ✅
  回帰（synctab・v78・cat・v76・redo ほか）すべて ❌なし・pageerror なし ✅
```

**D1に列を1つ足したので `migrate-0004-ebay-start.sql` の適用が必要。
Worker の再デプロイも必要。**

## 7.7 行ごとの手元在庫ボタン（2026-09-30・sw.js v82）

販売連携タブの各行に **「手元在庫 オン／オフ」ボタン**を置いた。

- 押すと `POST /listings` に **ASIN＋新品/中古 と `on_hand` だけ**を送る。
  **出品リスト（出品CSVタブ）に無い、以前に出した商品でも印を付けられる。**
- **FBAに在庫（販売可能・入庫中・予約済みのいずれか）がある行は押せない。**
  ボタンは「手元在庫：付けられません（FBA在庫あり）」と理由つきで無効にする。
  Worker側でも受け付けても印は付かない（二重に守る）。
- 押したあとは手元の一覧と localStorage を更新し、バッジ（手元在庫／FBA納品の候補）と
  ボタンの表示をその場で切り替える。

### `POST /listings` のキーを3通りにした

1. `sku`（せどりすとSKU）
2. `custom_label`（`E-<ASIN>[-U]` またはせどりすとSKU）
3. **`asin` ＋ `cond`** … 出品リストに無い商品用。`skus`（個体）は作らず `items` だけ更新

**送らなかった項目は変えない**ようにした（`mode` / `one_off` / `fba_link` / `on_hand` を
`COALESCE` で残す）。これが無いと、手元在庫の入/切だけを送ったときに
モードや一点物・FBA連動の印が0に戻ってしまう。

### 検証

```
Worker
  ASIN＋新品/中古だけで印が付く ✅
  ★モード・一点物・FBA連動・ItemID・商品名を壊さない ✅
  同じキーでオフに戻る ✅／新品と中古は別行 ✅
  FBA在庫（予約2点）がある行は受け付けても印が付かない・ほかも壊さない ✅
  出品リストに無い商品は items の行を作って印を付ける／skus は作らない ✅
  ASINの形が違うキー（X / 未指定 / 9文字）は受け付けない ✅
pj_price（実ブラウザ・pj-syncはモック）
  FBA在庫がある3行は理由つきで押せない／在庫が無い2行は押せる ✅
  送信内容は ASIN＋cond＋on_hand＋商品名だけ（SKU・CustomLabel・mode等を送らない）✅
  押すとボタンとバッジがその場で切り替わる ✅／もう一度押すとオフ ✅
  再読み込みしても状態が残る ✅  pageerror なし ✅
回帰（guard/sync/chan/notif/token/sweep/onhand/onhand2/onhand3/sync3、
synctab/v78/cat/v76/redo/v13）すべて ❌なし ✅
```

**Worker の再デプロイが必要（D1の変更はなし）。**

## 7.8 再調達の候補とAmazon最安値の条件（2026-09-30・sw.js v83）

FBAで売れた商品（一点物以外）を、Amazon最安値基準でeBayに出し続ける運用のための画面。

### 再調達の候補

**eBayに出ている（`ebay_qty>=1`）・FBAの販売可能が0（売り越しの恐れ・予約済みのみ）・
一点物でない**行。絞り込み「再調達の候補」と `counts.restock`、行のバッジで見られる。

- **一点物かどうかが分からない行も候補に入れ、「一点物不明」と出す。**
  `items.one_off_known`（0/1）を足し、`POST /listings` で `one_off` を送ったときだけ
  1 にする。出品リストに無い過去の出品は 0 のまま＝分からない。
- `/status` の各行に `restock`（0/1）を付けた（`?state=restock` で絞り込み）。

### Amazon最安値の条件 — 取り違えの穴があった

要求には `ItemCondition` を付けていたが、**結果の振り分けを応答の条件から推測し、
入っていないときは新品扱いにしていた**。これでは中古の値段を新品の行に入れてしまう。

- 振り分けは**返ってきた要求（`res.request`）を正**にした。ASINも要求のURIから読む。
- 条件が分からない結果は**捨てる**（`note` に「条件が分からない結果 n件は使わなかった」）。
- 出品ごとに状態が分かるとき（`SubCondition`）は、要求と違う条件の出品を混ぜない。

### 最安値の出品者数

| 列 | 中身 |
|---|---|
| `amazon_lowest` | 最安値（本体＋送料・円） |
| `amazon_lowest_n` | 最安値と同じ値段の出品者数 |
| `amazon_offers` | 見えている出品件数 |

行に「最安値の出品者 1人（全2件）」と出し、**1人だけなら赤字で「1人だけ注意」**。
その出品者が売り切れると相場が変わるため。

### 一点物ボタン

手元在庫と同じ形で、行ごとに「一点物 オン／オフ／不明」を切り替える。
送るのは **ASIN＋新品/中古 と `one_off` だけ**（出品リストに無い商品でも付けられる）。
オンにすると再調達の候補から外れる。

### 検証

```
Worker（同じASINで新品と中古の出品を作って）
  新品の行＝新品の最安 12800（12500+送料300）／中古の行＝中古の最安 8000 ✅
  新品：最安1人・全2件／中古：最安2人・全5件 ✅
  条件が分からない結果は値段を書き込まず、noteに件数を残す ✅
  一点物オン→one_off_known も1／オフに戻しても known は残る ✅
  手元在庫だけ送った行の one_off_known は触らない ✅  最安値も壊れない ✅
  counts.restock＝2／?state=restock で絞れる／一点物にすると外れる ✅
pj_price（実ブラウザ・pj-syncはモック）
  絞り込み「再調達の候補」2件・バッジ・「一点物不明」の出し分け ✅
  見出しに「再調達の候補 2件」✅
  「Amazon最安値（新品） ¥12,800　最安値の出品者 1人（全2件）・1人だけ注意」（赤字）✅
  中古の行は「（中古）」「3人（全7件）」注意なし ✅
  一点物ボタン：不明／オフの出し分け、ASIN＋cond＋one_off だけ送る、
  オンにすると候補から外れてバッジが出る ✅
回帰（guard/sync/chan/notif/token/sweep/onhand/onhand2/onhand3/lowest/sync3、
synctab/v78/cat/v76/redo）すべて ❌なし・pageerror なし ✅
```

**D1に列を3つ足したので `migrate-0005-restock.sql` の適用が必要。
Worker の再デプロイも必要。**

## 7.9 再調達CSVの確定と、値付け表示の整備（2026-10-01・sw.js v84）

### File Exchange の Revise でビジネスポリシーを変更できる（確定）

実機で1件（Raiden III）をアップロードし、**配送ポリシー W2000・数量1・推奨売値に
正しく変更された**ことを確認した。7.5節の「未検証」は解消。

- `ShippingProfileName` / `ReturnProfileName` / `PaymentProfileName` を Revise に
  入れれば**ポリシー名が差し替わる**。3つ揃えて送る形で問題ない。
- `*Action` / `ItemID` / `*Quantity` / `*StartPrice` ＋ ポリシー3列の**7列**で足りる。

### 推奨売値の既定重量をカテゴリで分ける

出品リストに同じ商品が無い行（以前に出した出品）の既定重量を、
**せどりすとSKUの接頭辞**で振り分ける。`/status` の各行に `prefix` を足した
（`skus` から引く）。

| 接頭辞 | 設定 | 初期値 |
|---|---|---|
| `game` | 既定重量（ゲーム） | 150g |
| `hobby` / `toy` / 不明 | 既定重量（ホビー・おもちゃ） | 400g |

接頭辞が分からない行は重いほう（ホビー側）を使う＝安全側。
出品リストに同じ商品があれば、そちらの実重量を優先する（従来どおり）。

### 「最低 $43.45」は何だったか → 名前を変えた

`csvPriceFor()` が返していた `floor` は **`priceModel()` の `floor`** で、
**基準地帯の利益が「下限利益」（設定・既定1,000円）ちょうどになる売値**。
eBayタブの「最低売値 / Best Offer 自動拒否ライン」と同じ値で、
**損益分岐点（利益0）ではない**。

表示を次のように変えた。損益分岐（利益0の売値）も新たに計算して併記する。

```
推奨売値 $193.31（利益 ¥4,840）　最低利益ライン $153.98（利益 ¥1,000）
損益分岐 $143.74　重量 550g
```

必ず 損益分岐 < 最低利益ライン ≦ 推奨売値 になる（実測で確認）。

### 最安値の出品者数は「許容差額」で数える

Worker は**出品の値段と状態をそのまま持つ**（`amazon_offers_json`：安い順に最大10件の
`[{p:本体＋送料, c:SubCondition}]`）。**許容差額の判定は pj_price 側**で行う
（しきい値が設定で変わるものを Worker に焼き付けない）。

- 設定「最安値の許容差額」（既定 **200円**）。「最安値＋この額」までを最安グループとする
- **この範囲に1人しかいないときだけ「1人だけ注意」**（赤字）を出す
- 表示例：`最安グループ 2人（＋¥200以内・全7件）`
- 出品明細を持っていない古い行は、従来の「最安値の出品者 n人（全m件）」に戻る

### 中古のコンディション

中古の行は、最安グループの状態を安い順に並べて出す
（`VeryGood`→非常に良い、`Good`→良い、`Acceptable`→可、`Mint`→新品同様 …）。
**最安グループが「可」だけのときは「最安は「可」だけ注意」**（赤字）を出す。
状態が1件も分からないときは何も出さない。新品の行には状態を出さない。

### 検証

```
Worker
  出品明細を安い順に保存（8000/Acceptable, 8000/Good, 9000/VeryGood）✅
  新品は 12800/New ✅  値段は本体＋送料の整数 ✅
  /status に prefix（skus の接頭辞）が出る ✅
pj_price（実ブラウザ・pj-syncはモック）
  既定重量 game 150g / hobby 400g / 接頭辞不明は400g、設定変更も反映 ✅
  出品リストに同じ商品があれば実重量（550g）を使う ✅
  「推奨売値 $193.31（利益 ¥4,840）／最低利益ライン $153.98（利益 ¥1,000）／
   損益分岐 $143.74」。損益分岐<最低利益ライン≦推奨売値 ✅
  最安グループ：8051と8200（差149円）で2人・注意なし／許容100円で1人・注意あり／
  許容1500円で3人 ✅
  中古の状態「可」だけ→注意あり／「良い・非常に良い」→注意なし ✅
  新品の行に状態は出さない ✅  明細が無い行は従来表示に戻る ✅
回帰（guard/sync/chan/notif/token/sweep/onhand/onhand2/onhand3/lowest/sync3、
synctab/v78/cat/v76/redo/v13/pricecsv）すべて ❌なし・pageerror なし ✅
```

**D1に列を1つ足したので `migrate-0006-offers.sql` の適用が必要。
Worker の再デプロイも必要。**

## 7.10 出品の状態が取れない件と、手元在庫の除外（2026-10-01・sw.js v85）

### 1. 中古の状態（非常に良い／良い／可）が表示されない

`amazon_offers_json` の `c` が空だった。値段は入っているので
`Offers[]` は読めていて、**出品1件ごとの状態のキー名が想定と違う**と判断した。
実データの応答をこちらから見られないため、次の2つで対応した。

**(a) キー名を決め打ちにしない。** `SubCondition` / `subCondition` /
`sub_condition` / `Condition` のどれでも拾い、キー名が想定外でも
**値が状態の語**（`VeryGood` / `Good` / `Acceptable` / `Mint` …）なら拾う。
`ConditionNotes`（自由記述）は拾わない。
1件も取れなかった商品があると `note` に件数を出す。

**(b) 確認用の読み取り専用エンドポイントを足した。**
`GET /debug/offers?asin=B075LC617B&cond=used` が返すのは
**応答のキー名・状態らしいキーと値・値段**だけ（出品者IDや自由記述は返さない）。
これで本当のキー名が分かる。**分かったら消す**（`/debug/gtin`・`/debug/catalog`
と同じ扱い）。

D1に入っている中身を直接見るには：

```powershell
npx wrangler d1 execute pj-sync --remote --command `
  "SELECT cond, amazon_lowest, amazon_lowest_n, amazon_offers, amazon_offers_json
     FROM items WHERE asin='B075LC617B'"
```

### 2. 手元在庫の行は再調達の候補から外す

手元にある商品は手元から発送できるので再調達の必要がない。
**`on_hand=1` の行を再調達の候補から外した**（Worker の `isRestock` と
`counts.restock`・`?state=restock`、pj_price の `syncIsRestock` の4か所）。

### 検証

```
Worker
  状態のキー名が SubCondition / subCondition / sub_condition / Condition /
  想定外のキー名（値が状態の語）のどれでも、3件すべて拾える ✅
  状態がまったく返らないときは note に警告を出す ✅
  /debug/offers … キー名の一覧・拾えた値・値段を返し、
  出品者ID（SellerId）と自由記述（ConditionNotes）は返さない ✅ おかしなASINは弾く ✅
  手元在庫の行は counts.restock・?state=restock・行の restock から外れる ✅
pj_price（実ブラウザ）
  手元在庫をオンにすると再調達の候補から外れ、見出しの件数も減る ✅
回帰すべて ❌なし・pageerror なし ✅
```

**Worker の再デプロイが必要（D1の変更はなし）。**

## 7.11 状態の対応表の確定と「可」の除外（2026-10-01・sw.js v86）

### 1. 原因は pj_price 側だった

`/debug/offers` の結果（B075LC617B・中古）で、各出品に `SubCondition` が
**あり**、値は**小文字の `"acceptable"`** だった。D1 の `amazon_offers_json` も
正しく入っていることを `wrangler d1 execute` で確認した（カジが確認）。

```json
[{"p":3340,"c":"acceptable"},{"p":3340,"c":"acceptable"},{"p":3784,"c":"acceptable"},
 {"p":3800,"c":"acceptable"},{"p":4140,"c":"good"},{"p":4170,"c":"good"},
 {"p":4300,"c":"acceptable"},{"p":4307,"c":"very_good"}]
```

つまり Worker 側は問題なく、**保存されている値は小文字・アンダースコア区切り**だった。

表示されなかったのは pj_price 側で、状態を日本語に直す対応表が
**大文字始まりのキー**（`Acceptable` / `VeryGood` …）だったため、
小文字の値で引くと空になり、「状態 …」も「最安は『可』だけ注意」も出なかった。

前回（v85・7.10）入れたキー名を決め打ちしない読み取りは、原因ではなく
**保険として残す**（キー名が変わっても拾えるようにするため）。

### 2. 対応表の確定（大文字小文字・区切り文字を区別しない）

照合は**英字だけを残した小文字**で行う（`String(c).toLowerCase().replace(/[^a-z]/g,'')`）。
`acceptable` / `Acceptable` / `ACCEPTABLE`、`very_good` / `VeryGood` /
`VERY_GOOD` / `verygood` はすべて同じものとして扱う。

| 値（照合後） | 表示 |
|---|---|
| `new` | 新品 |
| `mint` | ほぼ新品 |
| `verygood` | 非常に良い |
| `good` | 良い |
| `acceptable` | 可 |
| `refurbished` | 再生品 |
| `collectible` | コレクター |
| `club` | クラブ |
| `oem` | OEM |
| `used` | 中古 |

表に無い値・空の値は**無理に当てはめず空**にする（「状態 …」を出さない）。
Worker 側は**変換せず返ってきた値のまま**保存する（元の値が分かるようにする）。

### 3. 中古の最安値から「可」を除く設定（既定：除く）

設定「**中古の最安値から「可」を除く**」（既定オン）。オンのとき、中古の行では
`acceptable` の出品を基準から外し、

- 見出しを「**可を除く最安値 ¥x（状態・全体の最安 ¥y）**」にする
  （上の実データなら「可を除く最安値 ¥4,140（良い・全体の最安 ¥3,340）」）
- **最安グループの人数も、除いた後の最安値＋許容差額で数える**
- **推奨売値の仕入値も、除いた後の最安値**にする

**除かない場合**：
- 新品の行（`cond='new'`）
- 「可」しか出品が無い行（除くと基準が無くなる）
- 状態がまったく分からない行（`c` が空ばかりで、表に当たる値が1件も無い）

これらは従来どおり「Amazon最安値（新品／中古） ¥x」と出す。

設定は他の設定と同じく localStorage に保存し、切り替えるとその場で再描画する。

### 4. `/debug/offers` の削除

原因が分かったので削除した（`/debug/gtin`・`/debug/catalog` と同じ扱い）。
`note` の警告（「最安値：出品の状態が取れない商品 n件」）は残す。

### 5. 確認したこと

```
Worker（node:sqlite の D1 代替＋fetch 差し替え）
  小文字・アンダースコアの値（good / very_good / acceptable）をそのまま保存する ✅
  キー名が SubCondition / subCondition / sub_condition / Condition /
  想定外（値が状態の語）のどれでも拾える ✅
  状態が1件も返らないときは note に件数を出す ✅
  /debug/offers は無い（grep で0件）✅
pj_price（実ブラウザ）
  既定で「可を除く」がオン ✅
  acceptable / VERY_GOOD / good / Mint が 可／非常に良い／良い／ほぼ新品 になる ✅
  「可を除く最安値 ¥4,900（非常に良い・全体の最安 ¥4,800）」と出る ✅
  最安グループの人数も除いた条件で数える（4,900・5,000 → 2人）✅
  推奨売値の仕入値も ¥4,900 になる（計算機の csvPriceFor と一致）✅
  上の実データ（B075LC617B の8件）をそのまま入れると
  「可を除く最安値 ¥4,140（良い・全体の最安 ¥3,340）」・最安グループ3人
  （4,140・4,170・4,307）・状態 良い・非常に良い ✅
  設定をオフにすると ¥3,340・状態 可・「最安は『可』だけ注意」 ✅
  「可」しか無い行・状態が分からない行・新品の行は除かない ✅
  設定をオフにすると全体の最安（¥4,800・3人・状態 可）に戻る ✅
  設定は再読み込みしても残る ✅
回帰すべて ❌なし・pageerror なし ✅
```

**Worker の再デプロイが必要（D1の変更はなし）。**

### 6. D1 に保存済みの値を確かめるコマンド

表示が直らないときは、その行が**最後に値付けされたのがいつか**で見分ける。
`amazon_offers_json` の `c` が空のままの行は、キー名を決め打ちしない読み取り
（v85・7.10）を入れる前に値付けされた古いデータで、**次の値付けで埋まる**。

```powershell
npx wrangler d1 execute pj-sync --remote --command "SELECT asin,cond,amazon_lowest,amazon_lowest_at,amazon_offers_json FROM items WHERE asin='B075LC617B'"
```

## 7.12 再調達中の行の扱いと「再調達で赤字」の見張り（2026-10-01・sw.js v87）

### 1. 再調達CSVを書き出した行に「再調達中」の印を付ける

これまでは CSV を書き出しても pj-sync 側は何も知らなかったため、
切り替え済みの行（例：Raiden III・B0BJKHGFGR）に
「売り越しの恐れ」と「再調達の候補」が出続けていた。

書き出しと同時に `POST /listings` を送る（キーは**ASIN＋新品/中古**）。

```json
{"items":[{"asin":"B0BJKHGFGR","cond":"used","restocking":true,
           "restock_price":69.42,"restock_max_cost":6382,"restock_skip_acc":1}]}
```

> **`mode=restock` は使わない（依頼からの変更点）。**
> `items.mode`（`'hold'`/`'restock'`/`'end'`）は出品リストで決める
> 「FBA在庫が0になったときの動作」という**方針**の列で、以前から入っている。
> これを「いま再調達中」という**状態**に流用すると、
> 出品リストで方針を `restock`（＝売れたら再出品する）にしている行すべてが
> 再調達中になり、売り越しの警告が消えてしまう
> （実際に回帰テストで3本が落ちて分かった）。
> そのため `restocking`（0/1）という別の列を足した。`mode` には触らない。

| 項目 | 中身 |
|---|---|
| `restock_price` | CSVに書いた売値（推奨売値・USD） |
| `restock_max_cost` | **その売値で損益分岐に収まる仕入値の上限（円）** |
| `restock_skip_acc` | その上限を「可」を除いた最安値で出したか（0/1） |

`restock_max_cost` は pj_price が**計算式を逆算**して出す（二分法）。
為替・手数料・重量は設定で変わるので、**Worker には数字だけ**を渡す
（Workerに計算式を焼き付けない方針のまま）。
`restocking:false` を送ると、この3つと `restock_at` はまとめて消える。

**すでに手でeBay側を直してしまった行**のために、行に「再調達中にする」ボタンも付けた。
いまのeBay売値を基準に上限を出して印を付ける（eBay側は何も変えない）。

### 2. 再調達中の行の見え方

| | 再調達の候補 | 再調達中 |
|---|---|---|
| 条件 | eBay出品中・FBA販売可能0・一点物でない | `restocking=1` かつ eBay出品中 |
| バッジ | 再調達の候補（橙） | **再調達中**（緑） |
| 売り越しの恐れ・予約済みのみ・納品待ち | 出す | **出さない** |
| 数量の食い違い（FBA在庫＜eBay数量） | 出す | **出す**（在庫が残っている話なので従来どおり） |
| 絞り込み | `?state=restock` / 一覧の「再調達の候補」 | `?state=restocking` / 一覧の「再調達中」 |
| 件数 | `counts.restock`（切り替え済みは外す） | `counts.restocking` |

行には「再調達中：出し直した売値 $x　仕入値の上限 ¥y」も出す。

### 3. 「再調達で赤字」と「再調達の仕入先なし」

| `restock_trouble` | 条件 | 警告 | 通知 |
|---|---|---|---|
| `loss` | 最安値（`restock_skip_acc=1` なら「可」を除く）が `restock_max_cost` を超えた | 再調達で赤字 | `RESTOCK_LOSS` |
| `no_offer` | Amazonの出品が無くなった（`amazon_offers=0`・最安値なし） | 再調達の仕入先なし | `RESTOCK_LOSS` |

最安値を一度も取っていない行では判定しない。`RESTOCK_LOSS` は即時通知で、
同じ日・同じ理由は1回だけ。pj_price 側も同じ判定をその場で行い（設定を変えると
すぐ表示が変わる）、Worker 側は上限と最安値を比べるだけで通知できる。

見張りは `restockWatch()` が毎時・日次に**再調達中の行を全部**読む。
名簿（`skus`）に無い過去の出品も再調達中になり得るので、
その回に触ったキーだけでは足りない。D1を1回読むだけで呼び出しは増えない。
値付け（`syncPricing`）は**再調達中の行を先に**見る。

### 4. 再調達中の解除

行の「再調達中 解除」ボタン（`restocking:false` を送る）。
数量を0にした・通常の出品に戻したときに押す。Worker 側で監視用の数字も消え、
警告は従来どおりに戻る。

### 5. 確認したこと

```
Worker（node:sqlite の D1 代替＋fetch 差し替え）
  restocking:true で売値・上限・可を除いた印・時刻が入り、ほかの項目を壊さない ✅
  出品リストの mode（在庫0のときの動作）には触らない ✅
  mode='restock' だけの行は再調達中にならない ✅
  再調達中の行は売り越しの恐れ・予約済みのみを出さず、候補からも外れる ✅
  counts.restock / counts.restocking が入れ替わる ✅ ?state=restocking で絞れる ✅
  最安値が上限を超えたら「再調達で赤字」、出品が消えたら「再調達の仕入先なし」 ✅
  restock_skip_acc の0/1で判定が変わる（4,140 と 3,340）✅
  最安値未取得の行では警告を出さない ✅
  RESTOCK_LOSS が即時通知で届き、文面に最安値と上限が入る ✅ 同じ日は1回だけ ✅
  解除で監視用の数字がまとめて消え、警告が元に戻る ✅
  数量の食い違いは再調達中でも出る（回帰で確認）✅
pj_price（実ブラウザ）
  再調達中のバッジ・出し直した売値・仕入値の上限を出す ✅
  赤字・仕入先なしの赤い警告を出す ✅ 件数に「再調達中 n件」 ✅
  CSVを書き出すと mode=restock と上限を送り、その場で警告が消える ✅
  上限は「損益分岐が売値に収まる最大の仕入値」になっている ✅
  「再調達中にする」「再調達中 解除」ボタン ✅ 再読み込みでも残る ✅
回帰すべて ❌なし・pageerror なし ✅
```

**Worker の再デプロイが必要。あわせて D1 のマイグレーションが必要：**

```powershell
npx wrangler d1 execute pj-sync --remote --file=./migrate-0007-restocking.sql
npx wrangler deploy
```

## 7.13 eBayの注文はすべて通知する（2026-10-01）

### 1. 起きたこと

SKUを設定していない出品（Amazonに無いセット品）が1件売れたが、通知が来なかった。
eBayの明細は `parseLabel(sku)` で対応付けできたものだけを `EBAY_SOLD` にしていたため、
**SKUが無い／形が違う明細は通知の対象外**だった（`orders` 表には入っていた）。

### 2. 直したこと

対応付けできるかどうかに関係なく、eBayの明細はすべて通知する。

| | 対応付けできた明細 | 対応付けできない明細 |
|---|---|---|
| イベント | `EBAY_SOLD`（従来どおり） | **`EBAY_SOLD_UNMATCHED`**（新規） |
| 文面 | eBayで売れた：商品名 / FBA販売可能 n。MCFでの取り寄せが必要です | **eBayで売れた（対応付けなし・自己発送）：商品名 / 数量 n / $x / SKU…。注文 …。FBAに無い商品なので手元から発送してください** |
| `items` への登録 | する | しない（商品を特定できない） |

どちらも即時通知。`dedup_key` は `<種類>|<注文ID>|<明細ID>` なので、
差分取得で同じ注文が何度返ってきても**通知は1回だけ**
（`INSERT OR IGNORE` + `notified_at`）。

商品名は `lineItems[].title`（出品のタイトル）を使う。**購入者の情報ではない。**
`events.detail` にだけ持ち、`orders` 表に列は足していないので **D1の変更はなし**。

### 3. 個人情報

`ebayOrders()` が応答から取り出すのは
注文ID・明細ID・SKU・商品名・数量・金額・通貨・日時・状態だけ。
`buyer`（氏名・住所・メール・ユーザー名）は読まない・持たない・通知しない。
テストでは、応答にわざと氏名・住所・メールを入れて、
**通知文とD1のどちらにも現れない**ことを確かめている。

### 4. 確認したこと

```
Worker（node:sqlite の D1 代替＋fetch 差し替え。eBay注文3件：対応付け1・SKUなし1・解析不可1）
  3件すべてイベントになる ✅ 対応付けできた1件は EBAY_SOLD ✅
  対応付けできない2件は EBAY_SOLD_UNMATCHED ✅
  通知に商品名・数量・金額・SKU（なければ「SKUなし」）・注文IDが出る ✅
  購入者の氏名・住所・メール・ユーザー名は通知にもD1にも入らない ✅
  2回目の取り込みではイベントが増えず、通知も飛ばない ✅
  新しい注文だけが通知される ✅
  対応付けできない明細も orders には残る（asin は空）✅
  orders に title 列は足していない（D1の変更なし）✅
回帰すべて ❌なし ✅
```

**Worker の再デプロイが必要（D1の変更はなし。pj_price は変更なし）。**

## 7.14 不具合：CSVを書き出すと設定のキーが消える（2026-10-01・sw.js v88）

### 1. 報告された症状（iPhoneのホーム画面アイコン）

1. 設定に「pj-sync のキー」「英語タイトル生成のキー」「アップロードトークン」を入れる
2. 販売連携タブで行を選び「再調達で出し直すCSVを書き出す」を押す
3. CSVは出るが「再調達中」の登録が **Load failed**、同時に**3つのキーが設定から消える**
   （入れ直しても、書き出すたびに消える）

### 2. 原因

**(a) キーが消えるのは、空になった欄をそのまま保存していたため。**
3つのキーはどれも `type="password"` で、`csvSaveCfg()` は
欄の値をそのまま localStorage（`pj:csvcfg:v1`）に書いていた。
iPhoneのホーム画面アプリでCSVを書き出すと、ダウンロードのためにいったん画面を離れる。
戻ったときにブラウザ側が password の欄を空にすることがあり、
そのあと何かの保存が走ると**3つまとめて空で上書き**される。
`csvLoad()` は空の値を欄に入れない作りなので、以後は復活しない。

直す前の `index.html` で、欄を空にして `input` を起こすと
保存が `{"syncKey":"","csvTitleKey":"","csvImgToken":""}` になることを再現で確認した。

**(b) Load failed は、CSVの書き出しで通信が切られていたため。**
`$('syncRestock').onclick` は **CSVを書き出してから** `syncRestockMark()` の
`POST /listings` を投げていた。ダウンロードで画面を離れるため、
送信中の `fetch` が切られて Safari の `TypeError: Load failed` になる。
（キーが空のまま送れば 401 になるが、その場合のメッセージは `HTTP 401` なので、
今回の Load failed は通信が切られたほうが原因。）

### 3. 直したこと

**キーの欄の保護（`CSV_CFG_SECRET = syncKey / csvTitleKey / csvImgToken`）**

- 保存時：欄が空なら、**保存済みのキーを消さずに残す**
- 消すのは、**その欄を自分で触って空にしたときだけ**
  （`event.isTrusted` かつその欄が `document.activeElement`）
- 画面に戻ったとき（`visibilitychange` / `pageshow` / `focus`）：
  欄が空なら**保存済みのキーを入れ直す**
- 保存は丸ごと置き換えずに、**保存済みの内容へ上書き**する形にした
  （何かの理由で欄が読めなくても、ほかの設定を落とさない）
- 送信の直前に `syncKeyReady()` を通し、空のままなら**送らずにその場で知らせる**
  （画像アップロードと英題生成のキーも同じ守りを通す）

**書き出しの順番を入れ替えた**

```
（旧）CSVを書き出す → POST /listings   … 通信が切られて Load failed
（新）POST /listings → CSVを書き出す   … 登録が終わってから画面を離れる
```

登録が失敗しても**CSVは必ず書き出す**（失敗の理由は画面に出す）。
念のため `keepalive:true` も付けた。

### 4. 確認したこと

```
直す前（git show HEAD:index.html）と直したあとを、同じ手順で比べた（実ブラウザ）
  直す前：欄が空にされると3つのキーが空で上書きされる（報告どおり再現）✅
  直したあと：空では上書きされない ✅ ほかの保存が走っても消えない ✅
  画面に戻ると、空になっていた欄に保存済みのキーが入る ✅（トークンも）
  自分で空にしたときは、保存も空になる ✅
  書き出しの順番が post → download になった ✅ 空でないキーで送る ✅
  Load failed でもCSVは書き出され、理由が出る ✅
  キーが空のままなら送らずに知らせ、CSVは書き出す ✅
回帰（ブラウザ）すべて ❌なし・pageerror なし ✅
```

**pj_price だけの修正（Worker・D1 の変更はなし）。sw.js を v88 に上げた。**

## 7.15 一覧の絞り込みを作業の流れで整理（2026-10-01・sw.js v89）

絞り込みが10項目あり、似た項目が混ざっていた。**作業の流れの順に6つ**へ整理し、
それぞれに**件数**を出す（例「対応が必要（警告あり）（3）」）。

| 順 | 値 | 表示 | 中身 |
|---|---|---|---|
| 1 | `all` | すべて（既定） | 取り込んだ行すべて（eBay出品ありかFBA在庫あり） |
| 2 | `warn` | 対応が必要（警告あり） | `warnings` がある行 |
| 3 | `restock` | 再調達の候補 | eBay出品中・FBA販売可能0・一点物でない・再調達中でない |
| 4 | `restocking` | 再調達中 | 再調達CSVで出し直した行（`restocking=1`） |
| 5 | `on_hand` | FBA納品の判断 | 手元在庫の行。**送る候補と送らない行を一緒に出し**、バッジ（「FBA納品の候補」／「eBayで売れた・FBAに送らない」）で見分ける |
| 6 | `fba_not_listed` | eBay出品の候補 | FBA在庫あり・eBay未出品 |

**消した項目**：「eBayに出ている行」「eBay出品あり・FBA在庫なし」「手元在庫ありの行」
（最後のものは5に統合）。`to_fba` / `sold_on_ebay` の2項目も5に統合した。

実装は `SYNC_FILTERS`（値・表示・判定関数の配列）1か所にまとめ、
`syncFilterOpts()` が `syncRender()` のたびに選択肢を件数つきで作り直す
（選んでいる項目は保つ）。`syncMatch()` はこの配列を引くだけになった。

### 確認したこと

```
pj_price（実ブラウザ）
  選択肢は6つ・作業の流れの順・どれにも件数が付く ✅ 既定は「すべて」✅
  消した3項目は出ない ✅
  6つすべてで、選択肢の件数と実際の表示件数が一致する ✅
  FBA納品の判断：手元在庫の2件を一緒に出し、バッジで送る/送らないを見分けられる ✅
回帰すべて ❌なし・pageerror なし ✅
```

**pj_price だけの修正（Worker・D1 の変更はなし）。sw.js を v89 に上げた。**

## 7.16 タブの位置をそろえ、バージョンを表示（2026-10-01・sw.js v90）

### 1. 並びを変えた

```
（旧）ヘッダー → 商品（計算機） → タブ → 各タブの中身
（新）ヘッダー → タブ（固定） → 商品（計算機） → 各タブの中身
```

- タブ（eBay／出品文／Shopee／出品CSV／販売連携）は**どのタブでもヘッダーのすぐ下**。
  `.tabbar` を `position:sticky; top:0`（`z-index:30`）にしたので、
  **スクロールしても画面上部に残る**。
- 計算機の「商品」欄（仕入値・製品ライン・重量・梱包資材・広告料率・内訳の表示先）は
  タブの下へ移した。**eBay・出品文・Shopee では表示**、
  **出品CSV・販売連携では非表示**（`switchTab()` の従来の処理のまま）。
- DOM を動かしただけで、欄のidも計算の流れも変えていないので、
  **入力と各タブの計算結果の連動はそのまま**。

### 2. バージョン表示

画面の一番下（フッター）に「バージョン v90」と小さく出す。
値は **sw.js の `const V = 'pj-pricing-vNN'` と同じ**で、更新のたびに自動で変わる。
取り方は3段構え。

| 順 | 取り方 | 意味 |
|---|---|---|
| 1 | 動いているSWに `postMessage({ask:'version'})` で聞く | **いま動いている版**（SW自身が答えるのでずれない） |
| 2 | `caches.keys()` の `pj-pricing-vNN` の最大値 | SWがまだ応答しないとき |
| 3 | `./sw.js` を読んで `pj-pricing-vNN` を拾う | 初回（SW登録前）・キャッシュが無いとき |

`controllerchange` でも読み直すので、更新直後も追いつく。

### 3. 確認したこと

```
pj_price（実ブラウザ）
  並びが ヘッダー → タブ → 商品 → 各タブの中身 ✅
  5つのタブすべてでタブ帯の位置が同じ ✅
  商品欄は eBay・出品文・Shopee で表示、出品CSV・販売連携で非表示 ✅
  600px スクロールしてもタブ帯が top:0 に残り、本文が重ならず押せる ✅
  スクロールした状態からタブを切り替えられる ✅
  商品欄の入力で計算結果が変わる（連動は保たれている）✅ Shopeeタブも同じ ✅
  バージョン表示（http で確認）：sw.js と同じ v90・「バージョン vNN」の形 ✅
  2回目の読み込みでは動いているSW自身が v90 と答える ✅
回帰すべて ❌なし・pageerror なし ✅
```

**pj_price と sw.js だけの修正（Worker・D1 の変更はなし）。sw.js を v90 に上げた。**

## 7.17 eBayの売れた相場（Sold）で再調達を判断（2026-10-02・sw.js v91）

### 1. 行ごとの「相場（総額$）」

販売連携タブの各行（ItemIDがある行）に相場の入力欄を付けた。
**定義と換算は出品CSVタブの「相場（総額$）」と同じ**。

- 総額＝購入者が支払った額（商品代＋請求送料）
- **商品代＝総額 − 請求送料（基準地帯）**。`csvSoldProfit()` と同じ式で、
  `csvWithItem()` → `priceModel()` → `zoneShipCharge(basisZone)` を使う
  （計算式を2か所に持たない）
- 請求送料以下の値は誤入力として「※請求送料以下です」と出す

入力値と入力日時は **ASIN＋新品/中古** のキーで `localStorage`（`pj:syncsold:v1`）に保存。
表示は「相場 $28.50（10/03入力）　商品代 $13.50」。
**30日**（`SYNC_SOLD_OLD`）を過ぎた相場には「相場が古い」バッジを出す。

### 2. 判断（バッジ）

| 条件 | 判断 | 色 | 売値 |
|---|---|---|---|
| 相場 ≥ 推奨売値 | 推奨売値で出す | 緑 | 推奨売値 |
| 最低利益ライン ≤ 相場 < 推奨売値 | 相場に合わせる | 黄 | 相場 − 設定「相場から下げる額」（既定 $0） |
| 損益分岐 ≤ 相場 < 最低利益ライン | 見送り（利益不足） | 赤 | — |
| 相場 < 損益分岐 | 見送り（赤字） | 赤 | — |
| 相場が未入力 | 相場未確認 | 灰 | 推奨売値（従来どおり） |

比べるのはどれも**商品代**（推奨売値・最低利益ライン・損益分岐はいずれも商品代で、
請求送料は配送ポリシー側）。
「相場に合わせる」で下げた結果が損益分岐を下回るときは、**損益分岐で止める**
（赤字で出さないため。止めたときは画面にそう出す）。

### 3. 再調達CSVの書き出し

- 売値は上の判断の売値を使う（確認ダイアログと結果に「推奨 n件／相場 n件／
  相場未確認 n件」を出す）
- 見送りの行を選んでいたら
  「見送りの行が n件あります。除外して書き出しますか？」（**既定で除外**）。
  OKで除外して書き出し、キャンセルでやめる。全部見送りなら書き出さずに知らせる
- 除外した行は、そのあと
  「数量0にするCSVとして別ファイルで書き出しますか？」と聞く（任意）。
  `Revise / ItemID / *Quantity=0` の3列だけのファイル
- `restock_max_cost` は**実際に書き出した売値**から逆算する（従来どおり）

### 4. 再調達中の行

相場は再調達中の行でも入力・更新できる。判断が見送りになったら
赤字で「再調達中ですが相場が見送りです。出品の取り下げか値上げを検討してください。」
と出し、絞り込み「**対応が必要**」にも入る（`syncSoldAlert()`）。
相場は pj-sync へは送らない（pj_price 側だけで持つ値なので **Workerの変更はなし**）。

### 5. 一覧の作り直しを1行だけにした

相場を入れたあと一覧全体を作り直すと、**次に触ろうとした欄が作り直しで消えて
入力が入らない**（テストで再現）。行のHTMLを `syncRowHtml()` に切り出し、
相場を入れ替えたときは `syncRowReplace()` で**その行だけ**作り直す。

### 6. 確認したこと

```
pj_price（実ブラウザ）
  相場の入力欄が各行に出る ✅ 未入力は「相場未確認」で推奨売値を使う ✅
  商品代＝総額 − 請求送料（出品CSVタブと同じ換算。$100 → $85、送料$15）✅
  4つの判断が境界どおりに出る（推奨$69.42／最低$56.70／損益分岐$46.46）✅
  「推奨売値で出す」の売値＝推奨売値 ✅「相場に合わせる」＝相場の商品代 ✅
  入力日が出る ✅ 30日を過ぎたら「相場が古い」✅ 再読み込みで値と判断が残る ✅
  「相場から下げる額」$3 で $63.06 → $60.06 ✅
  再調達中でも相場を入れられ、見送りで警告が出て「対応が必要」に入る ✅
  書き出し：見送り3件を除外し、3件だけ登録・CSVの売値が判断どおり ✅
  仕入値の上限は書き出した売値から計算（¥5,761 → 損益分岐 $63.06）✅
  数量0のCSVを別ファイルで書き出す ✅ 全部見送りなら書き出さない ✅
回帰すべて ❌なし・pageerror なし ✅
```

**pj_price と sw.js だけの修正（Worker・D1 の変更はなし）。sw.js を v91 に上げた。**

## 7.18 不具合：更新したのに古い画面のまま（2026-10-05・sw.js v103）

### 症状

v102 に更新したのに、iPhone のホーム画面アプリで出品CSVタブの並び順が古いまま
（「せどりすとCSVを取り込む」「アップロード結果を取り込む」が一覧の下）だった。
**フッターには「バージョン v102」と出ていた。**

### 原因

**バージョン表示が、画面に出ている HTML の版ではなく Service Worker の版を出していた。**
7.16 の3段構えは、どれも SW 側しか見ていない。

| 順 | 取り方 | 実際に分かるもの |
|---|---|---|
| 1 | 動いているSWに `postMessage({ask:'version'})` | **SWの版** |
| 2 | `caches.keys()` の最大値 | **SWが作ったキャッシュの版** |
| 3 | `./sw.js` を `cache:'no-store'` で読む | **サーバーにある sw.js の版** |

ホーム画面アプリは**アイコンを押しても前に開いた画面がそのまま出る**（読み込み直さない）。
その裏で新しい SW が入り、`skipWaiting()` → `clients.claim()` で**引き継ぐ**が、
`clients.claim()` は SW を差し替えるだけで**画面の HTML は古いまま残る**。
その結果「SW は v102・HTML は v101」になり、表示は v102 と出て、
**更新できていないことに気づけなかった**。

もう一つ、`install` の `cache.addAll(ASSETS)` はブラウザのHTTPキャッシュを通るので、
Pages が付ける短い `max-age` のあいだは**古い index.html が新しいキャッシュに入る**。
圏外・通信が不安定なときに、その古い HTML が「v102」として出てしまう。

### 直し方

**1. 表示は HTML 自身の版にする**

`index.html` に `var APP_V='v103'`（**sw.js の `const V` と必ず同じ値**）を持たせ、
フッターは常に `APP_V` を出す。SW 側の版が違うときだけ
「バージョン v103（新しい版 v104 があります）」と添える。
これで**表示が嘘をつかない**。

**2. 古いままなら追いつかせる**

| 場面 | 動き |
|---|---|
| 開いた直後（まだ触っていない） | その場で**1回だけ**読み込み直す（`sessionStorage` に印を付けて繰り返さない） |
| 使っている途中 | 画面の下に固定の帯「新しい版 v104 があります（いまは v103）／更新する／あとで」 |

読み込み直す前に `fetch('./index.html',{cache:'reload'})` を1回入れて、
HTTPキャッシュに残った古い HTML を取り直す。
**使っている途中で勝手に読み込み直さない**（入力中の値が消えるため）。
触ったか どうかは最初の `pointerdown`／`keydown`、または8秒の経過で判断する。

**3. 戻ってきたときに確かめる**

ホーム画面アプリ向けに、`visibilitychange` で画面に戻ったとき（60秒に1回まで）
`./sw.js` の版を見に行き、違えば上の帯を出す。

**4. sw.js 側（3か所）**

- `install`：`ASSETS.map(u => new Request(u,{cache:'reload'}))` で先読みする
  → **古い index.html を新しいキャッシュに入れない**
- `activate`：`clients.claim()` のあと `clients.matchAll({type:'window'})` に
  `postMessage({version})` を送る → **開いたままの画面に知らせる**
- `fetch`：画面そのもの（`mode==='navigate'` / `destination==='document'`）は
  `new Request(url,{cache:'reload'})` で取る → **HTTPキャッシュ経由の古い HTML を返さない**

### 確認したこと

```
pj_price（ローカルHTTPサーバー・Pages と同じ max-age=600 を付けて配信）
  index.html の APP_V と sw.js の版が同じ ✅
  ふつうの状態：フッターは「バージョン v103」だけ・更新の帯は出ない ✅
    SWに聞いても v103 ✅
  先読みの index.html が no-cache で取り直されている（古いHTMLを入れない）✅
  SWだけ新しい状態（sw.js を v104 にして再現）
    開いた直後に自分で1回読み込み直す ✅
    フッターは「バージョン v103（新しい版 v104 があります）」＝自分の版を出す ✅
    SWの版を自分の版として出さない（以前の不具合）✅
    追いつかないときは画面下に固定の帯・両方の版・更新する／あとで ✅
    「あとで」で閉じられる ✅ 同じ版で何度も読み込み直さない ✅
  使っている途中（為替レートを入力したあと）
    勝手に読み込み直さない ✅ 入力は残る ✅ 代わりに帯で知らせる ✅
回帰すべて ❌なし・pageerror なし ✅（36本）
```

**並び順（6.15）そのものは v102 で正しく入っていた。古い HTML のまま動いていたのが原因。**
**pj_price と sw.js だけの修正（Worker・D1 の変更はなし）。sw.js を v103 に上げた。**

## 7.19 無在庫出品を見分ける（2026-10-05・sw.js v104・D1 migrate-0008）

手元にもFBAにも在庫を持たず、**売れてから仕入れる出品**を見分けられるようにした。

### 1. CustomLabel の決まり

| 出品のしかた | CustomLabel | 突き合わせ |
|---|---|---|
| FBA連動 | `E-<ASIN>` / `E-<ASIN>-U` | ASIN＋新品/中古 |
| **無在庫** | **`M-<ASIN>` / `M-<ASIN>-U`** | **ASIN＋新品/中古（E- と同じ）** |
| 一点物 | せどりすとSKUそのまま | SKUから解析 |

`parseLabel()` の正規表現を `^([EM])-(B[0-9A-Z]{9})(-U)?$` にして、**M- を E- と同じ扱い**で
照合する（大文字小文字は問わない）。あわせて `dropship: true` を返し、
取り込み（ActiveList）と名簿の登録で**無在庫の印を自動で立てる**。
印を下ろすのは手動だけ（`dropship=CASE WHEN ?=1 THEN 1 ELSE dropship END`）。

**既存の出品（`E-` やせどりすとSKU）は CustomLabel を変えない。**
行のボタンで手動で印を付ける運用にする（出し直す必要がない）。

### 2. D1（migrate-0008-dropship.sql）

```sql
ALTER TABLE items ADD COLUMN dropship INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_items_dropship ON items(dropship);
```

**順番は「D1 を先 → deploy を後」。** 先に deploy すると、新しいコードが
まだ無い `dropship` 列を読もうとして `no such column` で落ち、
その回の取り込みと通知がまるごと失敗する。

```powershell
cd proxy-sync
npx wrangler d1 execute pj-sync --remote --file=./migrate-0008-dropship.sql   # 先
npx wrangler deploy                                                          # 後
```

### 3. 販売連携タブ

- 行に**「無在庫 オン／オフ」ボタン**（一点物と同じ形）。押すと `POST /listings` で
  ASIN＋新品/中古と `dropship` だけを送る（ほかの印は Worker 側でそのまま残る）。
  オンにする前に、何が変わるかを確認ダイアログで出す。
- 行に**「無在庫」バッジ**。CustomLabel が `M-` の行は取り込みで自動オンになる。
- 絞り込みに**「無在庫（n）」**を追加（`state=dropship`）。
  件数は**いまeBayに出ている分だけ**を数える（`dropship=1 AND ebay_qty>=1`）。
  名簿に登録しただけでまだ出していない行は、印は持つが数えない。
- 設定に**「無在庫の上限」**（既定20件・0 で上限なし）。超えると概要の下に赤い警告を出す。
- **「名簿を送る」で、無在庫の行には手元在庫の印を付けない。**
  出品リスト側の指定と、D1 側に既に付いている印の**どちらでも**無在庫とみなす。

**売り越し系の警告と通知を止めた（判断して入れた変更）。**
無在庫の行はFBAに在庫が無いのが正常なので、`warnOf()`／`stateEvents()` で
`OVERSELL_RISK`・`RESERVED_ONLY`・`INBOUND_LISTED`・`FBA在庫なし` を出さない
（再調達中の行と同じ扱い）。FBAに在庫が残っているときの `QTY_MISMATCH` だけは従来どおり出す。
出さないと、無在庫の行が売り越しとして毎日通知され続けてしまう。
同じ理由で、**無在庫の行は「再調達の候補」から外した**（もともと在庫を持たない出品で、
買い直すという前提が成り立たない）。pj_price 側の `syncIsRestock()` と
Worker 側の SQL・件数の両方をそろえてある。

### 4. 通知（要仕入れ）

無在庫の商品が eBay で売れたら、Discord 通知の**先頭**に出す。

```
・要仕入れ：eBayで売れた（無在庫）：<商品名> / Amazon最安値 ¥4140（送料込み）
  / ハンドリング期限 あと4日（10/09）。Amazonで注文して発送してください
```

- **先頭**：`flushEvents()` で「要仕入れ」の行を先に並べる（ほかの行は今までどおりの順）
- **Amazon最安値**：`items.amazon_lowest`（本体＋送料の込み値）。取れていなければ「未取得」
- **ハンドリング期限**：eBayの注文明細の `lineItemFulfillmentInstructions.shipByDate`。
  「あとN日（M/D）」「本日まで」「超過N日」、取れなければ「不明（期限の情報なし）」
- 入れるのは商品名・金額・日付だけ。**購入者の氏名・住所・メールは読まない・入れない**

### 5. 出品CSVタブ

- 行に**「無在庫：オン／オフ」ボタン**（オンの行は色を付ける）。出品リストに保存する。
- オンの行は `csvCustomLabel()` が **`M-<ASIN>`（中古 `M-<ASIN>-U`）** を書き出す
  （`E-` より先に見る）。
- オンの行の配送ポリシーは **W2000**（設定「再調達用ポリシー名」）。
  売れてから仕入れるのでハンドリングタイムの長いほうを使う。在庫0時の動作が
  「再調達」の行と同じ扱い。

### 6. 確認したこと

```
Worker（node:sqlite の D1 + fetch をモック）
  M- の突き合わせ：M-<ASIN>／M-<ASIN>-U／小文字 すべて ASIN＋新品/中古 ✅
    E-・せどりすとSKU は従来どおり ✅ M- も scope=ebay ✅ ASINの形でなければ照合しない ✅
  無在庫の件数が出る ✅ 再調達の候補から外れる ✅ 絞り込み state=dropship ✅
  売り越しの警告を出さない（M-の行・手動の行とも）✅ ふつうの行は従来どおり警告 ✅
  OVERSELL_RISK を作らない ✅ ふつうの行には従来どおり作る ✅
  ボタンでオン・オフできる ✅ CustomLabel が M- の行は名簿の登録で自動オン ✅
  まだeBayに出していない行は印だけ持ち、件数には入らない ✅
  通知：先頭が「要仕入れ」✅ 最安値（送料込み）✅ 残り日数（あと/本日まで/超過/不明）✅
    ほかのイベントも消えない ✅ 個人情報は入っていない ✅
    Amazon・eBayへは1件も送っていない（通知だけ）✅
pj_price（実ブラウザ）
  出品CSVタブ：どの行にもボタン・既定オフ・押すとオン・色が付く ✅
    読み込み直しても残る ✅ CustomLabel が M-<ASIN>／中古は -U ✅ 配送ポリシー W2000 ✅
    ふつうの行は E-<ASIN>／W1000 のまま ✅
  販売連携タブ：概要に無在庫の件数 ✅ バッジ ✅ ボタンが印どおり ✅
    絞り込み「無在庫（3）」と3件表示 ✅ 再調達の候補の件数から外れる ✅
    上限を超えたら警告・0 なら上限なし ✅
    ボタンで ASIN＋新品/中古と印だけを送る ✅
    名簿：無在庫の行は手元在庫の印なし・CustomLabel も M- ✅
    ふつうの行は従来どおり手元在庫の印が付く ✅ D1側の印も尊重する ✅
回帰すべて ❌なし・pageerror なし ✅（ブラウザ37本＋Worker 11本）
```

**Worker と D1 の変更あり。D1（migrate-0008）を先、deploy を後。sw.js を v104 に上げた。**

## 7.20 不具合：納品直後に「予約済みのみ」が全件に出た（2026-10-05・sw.js v105・D1 migrate-0009）

### 症状

FBAに納品した直後、**納品した10件すべて**に
「予約済みのみ（Amazonで注文済み）」の警告と通知が出た。実際には1件も売れていない。

### 原因

`reservedQuantity` の**合計だけ**を見て「予約済み＝売れた」と判定していた。
予約済みには3つの内訳があり、**納品した直後は「FC処理中」に入る**。

| `inventoryDetails.reservedQuantity` の項目 | 意味 | 売れたか |
|---|---|---|
| `pendingCustomerOrderQuantity` | 顧客注文（出荷待ち） | **売れた** |
| `pendingTransshipmentQuantity` | FC間の移管 | 売れていない |
| `fcProcessingQuantity` | FCでの受領・処理中（**納品直後**） | 売れていない |

`invRow()` は `totalReservedQuantity` だけを読んでいたため、
納品して受領処理に入った在庫を「Amazonで注文済み」と取り違えていた。

### 直し方

**1. 内訳を取って持つ（`details=true` は元から付いていたので取得条件は満たしていた）**

`invRow()` が3つとも読み、`skus` に個体ごと、`items` に商品単位の合算で持つ
（migrate-0009 で両方の表に `fba_res_cust` / `fba_res_trans` / `fba_res_proc` を追加）。

**2. 顧客注文が1以上のときだけ警告・通知する**

```
販売可能 0 ／ 予約済み 1以上 ／ eBay残数 1以上 のとき
  顧客注文 ≥ 1  → 「予約済みのみ（Amazonで注文済み）」＋ RESERVED_ONLY 通知
  顧客注文 = 0  → 「FBA受領処理中」。通常扱いで、警告も通知もしない
```

通知の文言にも内訳を出す：
`予約済み 3点のみ（うち顧客注文 1点・出荷待ち）`

**3. 内訳が分からないときは、これまでどおり合計で判定する（取りこぼさないため）**

列は NULL 許容にして、**NULL＝未取得**の意味にした。未取得として扱うのは3つの場合。

| 場面 | 扱い |
|---|---|
| 既存の行（次の rollcall まで内訳が入らない） | 合計で判定 |
| 応答に内訳の項目が入っていない（合計だけ返る） | 合計で判定 |
| 内訳の合計が予約済みに届かない（説明のつかない残りがある） | 合計で判定 |

**ここを 0 で埋めると「予約済みはあるが顧客注文は0」＝受領処理中と誤判断し、
本当に売れた行の警告を落としてしまう**（実装中に回帰 `onhand.mjs` がこれを捉えた）。
`items` の合算も、内訳が取れていない個体が1件でもあれば NULL のままにする
（足りない分を0として足さない）。
一覧には「予約 1（内訳は次の取り込みから）」と出す。

**4. 一覧の表示**

```
FBA 販売可能 0／入庫 0／予約 1（注文 0／移管 0／処理中 1）
```

あわせて**「FBA受領処理中」のバッジ**を出す（警告ではないことを示す）。

**5. 再調達の候補からも外した（判断して入れた変更）**

FC処理中・FC移管だけの行は、納品した在庫がこれから販売可能になる。
買い直す必要がないので候補にしない（**納品直後の二重仕入れを防ぐ**）。
`isRestock()`・絞り込みのSQL・件数のSQL、pj_price 側の `syncIsRestock()` を
すべてそろえてある。

### 適用の順番（D1 を先 → deploy を後）

```powershell
cd proxy-sync
npx wrangler d1 execute pj-sync --remote --file=./migrate-0009-reserved-detail.sql   # 先
npx wrangler deploy                                                                # 後
```

先に deploy すると、まだ無い `fba_res_cust` 列を読もうとして `no such column` で落ちる。
**内訳は次の rollcall で入る。** それまでは合計で判定するので、
納品直後の誤った警告は rollcall を1回回すまで残る。

### 確認したこと

```
Worker（node:sqlite の D1 + fetch をモック）
  SP-APIの応答から内訳を読む：FC処理中だけ／顧客注文＋移管／内訳なしの応答 ✅
  不具合の再現（納品直後の10件）：警告は3件だけ・10件すべて警告なし＋受領処理中の印 ✅
    顧客注文が1以上の行だけ「予約済みのみ」✅ FC移管だけの行も通常扱い ✅
    注文と処理中が混ざった行は警告する ✅
    内訳をまだ取っていない行は合計で判定（取りこぼさない）✅
  再調達の候補：件数も絞り込みも納品直後の行を外す ✅
  通知：RESERVED_ONLY は3件だけ・10件は本文に出ない ✅
    「うち顧客注文 n点」／内訳が無い行は「不明」✅ ほかの警告も増えない ✅
  本物の writeInventory：個体ごとに内訳が入り、商品単位で合算される ✅
  getInventorySummaries は details=true のまま ✅
pj_price（実ブラウザ）
  一覧：予約 n（注文 n／移管 n／処理中 n）✅ 内訳なしは「次の取り込みから」✅
    予約0の行は内訳を出さない ✅
  「FBA受領処理中」のバッジ：納品直後とFC移管だけの行に出て、売れた行・内訳なしの行
    ・予約なしの行には出ない ✅ その行に「予約済みのみ」の警告は出ない ✅
  再調達の候補の件数が2件になり、納品直後・FC移管の行は出ない ✅
回帰すべて ❌なし・pageerror なし ✅（ブラウザ38本＋Worker 22本）
```

**Worker と D1 の変更あり。D1（migrate-0009）を先、deploy を後。sw.js を v105 に上げた。**

## 7.21 選んだ行をまとめて無在庫オン／オフにする（2026-10-05・sw.js v106）

1件ずつ押していくのが手間なので、**チェックを付けた行をまとめて**切り替える
ボタンを両方のタブに置いた（出品リストの件数・ボタン類のところ）。

```
［無在庫オン（n件）］［無在庫オフ（n件）］
```

ボタンの件数は**実際に変わる行の数**（すでにその状態の行は数えない）。
選んでいないときは押せない（薄く表示）。

### 販売連携タブ

- 対象は一覧のチェック（`data-spick`）で選んだ行。
- 実行前に **「n件を無在庫オンにします」** と件数で確認する。あわせて
  何が変わるか（警告を出さない／売れたら「要仕入れ」／手元在庫の印を付けない）、
  **実行後の無在庫の件数と上限**を出す（上限を超えるときは「※上限を超えます」）。
- すでにその状態の行は**送らない**（「すでに無在庫オンの n件は送りません」）。
  全部同じ状態なら、そう知らせて何も送らない。
- 送るのは **ASIN＋新品/中古と `dropship` だけ**（200件ずつ）。
  CustomLabel は変えないので、eBay側の出品はそのまま。
- 送れた行はその場で表示も合わせる（次の「状況を取り込む」を待たない）。

### 出品CSVタブ

- 対象は一覧のチェック（`data-cpick`）で選んだ行。保存は出品リストに持つ。
- **ItemID のある行（出品済み）は対象外**。
  CustomLabel を `M-` に変えても、すでに出ている出品は変わらないため。
  選んでいるあいだ **「出品済みのn件は販売連携タブで設定してください。」** と出し、
  確認ダイアログにも「出品済みのn件は対象外です」と入れる。
  選んだ行が全部出品済みなら押せない。
- オンの確認では、`M-<ASIN>` で書き出すことと配送ポリシー（W2000）も出す。

### 確認したこと

```
pj_price（実ブラウザ）
  出品CSVタブ（4件・うち2件は出品済み）
    ボタンがあり、選んでいないときは押せない ✅
    4件すべて選ぶと、ボタンの件数は出品済みを除いた2件 ✅
    「出品済みの2件は販売連携タブで設定してください」と出る ✅
    確認が「2件を無在庫オンにします」＋対象外の件数＋M-/W2000 の説明 ✅
    未出品の2件だけオンになり、出品済みの2件は変わらない ✅
    オンにした行は M-<ASIN>／W2000 で書き出す。出品済みの行は E-／W1000 のまま ✅
    オフも件数で確認し、2件が戻る ✅ 各行のボタンの表示も合う ✅
    出品済みだけを選んだときは押せず、案内を出す ✅ 選択を外すと案内も消える ✅
  販売連携タブ（4件・うち1件はすでに無在庫）
    ボタンがあり、選んでいないときは押せない ✅
    3件選ぶと オン（2件）／オフ（1件）＝実際に変わる数 ✅
    確認が「2件を無在庫オンにします」＋送らない1件＋実行後3件/上限20件 ✅
    送るのは印だけ2件分で、すでにオンの行は送らない。ほかの印は送らない ✅
    結果を件数で知らせ、送らなかった分も出す ✅
    その場でバッジと概要の件数が合う（取り込みを待たない）✅
    オフも3件で確認し、3件すべてオフで送る ✅ 概要も0件になる ✅
    全部同じ状態なら、そう知らせて何も送らない（送信0件）✅
回帰すべて ❌なし・pageerror なし ✅
```

**pj_price だけの修正（Worker・D1 の変更はなし）。sw.js を v106 に上げた。**

## 7.22 不具合：SWが古いときに「新しい版」と出る／ラベルが縦に並ぶ（2026-10-05・sw.js v110）

### 1. 「新しい版 v107 があります（いまは v109）」と出た

7.18 の判定が **版が違うだけで「新しい」としていた**（`sw!==APP_V`）。
画面のHTMLはネットワーク優先で先に新しくなるので、
**HTMLが新しく・SWが古い**状態はふつうに起きる。そこで逆の文が出ていた。

| SW の版 | どうするか |
|---|---|
| **APP_V より新しい** | 読み込み直す（開いた直後）か、更新の帯を出す（従来どおり） |
| **APP_V より古い** | **帯は出さない。** 裏で `registration.update()` を呼んで新しいSWに入れ替える |
| 同じ | 何もしない |

比べ方は**番号**（`appVerNum('v109') → 109`、`appVerNewer()`）。
`v` + 数字として読めない値は「新しい」としない。
古いSWのまま帯も読み込み直しも出さないので、ホーム画面アプリで作業が止まらない。
入れ替わると `controllerchange` が飛んで表示も追いつく。

### 2. 公開中の sw.js の版

`sw.js` の `const V` は **v109**（`13f6922` で push 済み）、`index.html` の `APP_V` も v109 で
**一致していた**。カジの端末で v107 と出ていたのは、
**端末に入っているSWがまだ古かった**ため（公開ファイルは新しい）。
これが 1 の `registration.update()` で解消する。
番号の一致は回帰 `ver.js` が毎回見ている。

### 3. eBayタブ「内訳の表示先」のラベルが1文字ずつ縦に並ぶ

`.row` は `label{flex:1}` ＋ `select{flex:0 0 auto}` で、
**`#zone` の選択肢がいちばん長い**（第3地帯（オセアニア・カナダ・メキシコ・中近東））ため
選択欄が縮まず、ラベルが幅0近くまで潰されていた。

- `#zone` の行を **`.rowv`**（ラベルを上・選択欄は全幅）にした
- あわせて `.row` 全体に **`flex-wrap:wrap`** と `label{min-width:5.5em}` を入れ、
  入らないときは**ラベルを潰さずに入力欄を次の行へ折り返す**
  （ほかの欄で同じことが起きないように。横スクロールも出さない）

### 4. 確認したこと

```
pj_price（実ブラウザ）
  SWが古いとき（HTML v110 + SW v108）
    フッターは自分の版だけ・「新しい版 v108 があります」と出さない ✅
    更新の帯を出さない ✅ 勝手に読み込み直さない ✅
    裏で registration.update() を呼ぶ ✅
  版の比べ方：番号の大小・読めない値は「新しい」としない ✅
  SWが新しいときの動き（7.18 の分）は変わらず ✅
  幅 390 / 375 / 320px すべてで
    1文字ずつ縦に並ぶラベルが無い ✅
    「内訳の表示先」はラベルが1行・選択欄は全幅・ラベルは上 ✅
    いちばん長い選択肢も収まる ✅ 横スクロールが出ない ✅
    地帯を変えると内訳が変わる（切り替えが効いている）✅
回帰すべて ❌なし・pageerror なし ✅
```

**pj_price だけの修正（Worker・D1 の変更はなし）。sw.js を v110 に上げた。**

## 7.23 不具合：移管中・処理中だけの行が「Amazonで注文済み」になる（2026-10-07・sw.js v117）

### 症状

7.20 で内訳を見るようにしたのに、予約済みが「移管中」「処理中」だけの行も
**「予約済みのみ（Amazonで注文済み）」**と表示され、**「再調達の候補」にも入っていた**。

### 原因

内訳が分からない行の扱いが「合計を顧客注文として数える」だったため。

```js
// v105〜v116 の resBreak
if (!known) return { known: false, cust: total, ... };   // ← 合計を顧客注文に寄せていた
```

これで `resCust(r) >= 1` が成り立ってしまい、「注文済み」の警告・通知・再調達の候補が
そのまま出ていた。内訳が分からなくなる道が2つある。

1. **内訳が1つも入っていない行**（移行前からある行、合計だけ返った応答）
2. **items の合算**。`skus`（個体）のうち内訳が NULL のものが1件でもあれば
   商品単位でも NULL にしていた。在庫0になった古いSKUは `active=0` になり
   **rollcall の名指しから外れる**ので、内訳が永久に入らない。
   その1件のせいで、商品がずっと「内訳不明」＝「注文済み」のままになっていた。

### 直したこと

**内訳で3つに分ける。**

| 内訳 | 表示 | 再調達の候補 | 通知 |
|---|---|---|---|
| 注文保留（pendingCustomerOrder）が1以上 | 「予約済みのみ（Amazonで注文済み）」赤 | 入れる | 出す |
| 移管中・処理中だけ（注文保留 0） | 「FBA受領処理中」／「FC移管中」青 | **外す** | 出さない |
| 内訳が分からない | 「予約済み（内訳不明）」灰 | **外す**（内訳が取れるまで待つ） | 出さない |

- `resBreak` は内訳が分からない行の `cust` を **`null`** にした（合計にも0にも寄せない）。
  内訳の合計が予約済みに届かない行は、分かっている注文保留はそのまま使い、
  残りがあるぶんを「不明」として扱う（注文保留が1以上なら売れたとみなす）。
- 判定を分けた。`resSold()`（注文保留あり）・`resUnknown()`（内訳不明）・
  `isFcProcessing()`（移管中・処理中だけ）・`resHold()`（予約済みだが売れたとは言えない）。
- **再調達の候補は `resHold()` で外す**。移管中・処理中だけの行と内訳不明の行の両方。
  SQL 側（`state=restock`）も `SQL_RES_HOLD` に合わせた。
  pj_price 側の `syncIsRestock()` も同じ決まりにしたので、
  古い Worker が候補として送ってきても画面には出ない。
- **items の合算で、予約済みが0の個体の NULL を見ない**ようにした。
  予約済みが0なら内訳も0なので、在庫0の古いSKUのせいで商品が永久に
  「内訳不明」になることがなくなる。
- 一覧の内訳表示を「予約 2（注文保留 1／移管中 0／処理中 1）」に、
  足りないぶんは「／不明 n」に、内訳が無い行は
  「予約 1（内訳不明・次の取り込みを待ちます）」にした。
- 内訳不明の印は赤ではなく灰色（いま対応することではないため）。
- Discord の「最優先」通知は注文保留があるときだけ。内訳不明の行は通知しない。

### 確認したこと

```
Worker（Node＋node:sqlite・resv.mjs 41項目）
  内訳ごとの言葉：注文保留あり→「予約済みのみ（Amazonで注文済み）」
    移管中だけ・処理中だけ→何も言わない　内訳なし→「予約済み（内訳不明）」✅
  内訳の合計が足りない行：残りを不明にする・売れたとみなさない ✅
    注文保留が1以上なら残りが不明でも売れたとみなす ✅
  納品直後の10件：警告なし・FBA受領処理中の印・候補に入らない ✅
  再調達の候補は注文保留がある2件だけ（移管中・内訳不明は入らない）✅
    /status?state=restock の絞り込みでも出ない ✅ 行の印（restock=0）でも外れる ✅
  通知（RESERVED_ONLY）も2件だけ・内訳不明は通知しない ✅
  合算：予約済みを持つ個体に未取得が混ざれば商品単位でも NULL ✅
    在庫0の古いSKU（NULL）があっても内訳不明にしない＝受領処理中と判定できる ✅
  details=true のまま ✅
pj_price（実ブラウザ・resvui.js 23項目）
  内訳の表示：「予約 1（注文保留 0／移管中 0／処理中 1）」✅
    足りない行「予約 3（注文保留 0／移管中 1／処理中 0／不明 2）」✅
    内訳なし「予約 1（内訳不明・次の取り込みを待ちます）」✅ 予約0は内訳なし ✅
  印：処理中だけ→FBA受領処理中／移管中だけ→FC移管中（分かれる）✅
    売れた行だけ「予約済みのみ（Amazonで注文済み）」赤 ✅
    内訳不明は灰色の「予約済み（内訳不明）」✅
  再調達の候補は売れた行の1件だけ ✅ 行の印にも出ない ✅
回帰すべて ❌なし・pageerror なし ✅
  （restock.mjs・onhand.mjs・synctab.js の下ごしらえに内訳を足した。
    内訳が無い行は「内訳不明」になり、候補にも警告にも入らないため）
```

**Worker（proxy-sync）と pj_price の両方を直した。sw.js を v117 に上げた。**
**D1 のマイグレーションは不要（列は migrate-0009 のまま）。Worker のデプロイが必要。**

## 7.24 詳細設定（目標の決め方）を保存する（2026-10-08・sw.js v118）

### 症状

eBayタブの「詳細設定（目標の決め方）」が、計算機を閉じるたびに既定値
（下限利益 1000円・仕入への連動率 30%）に戻っていた。

### 原因

**わざと保存していなかった。**
「人が決めるのは相場の入力だけにしたい」という当初の考えで、
`save()` の対象（`FIELDS`）にこの5つを入れていなかった。

```js
// v117 までのコメント
// 詳細設定と相場入力は触るたびに引き直す。どれも localStorage には保存しない。
```

v116 で「売値の見直し」を入れたことで、この5つは1品ごとの判断ではなく
**店の決まり**になった。既定値に戻ると推奨売値が変わり、
意図しない行が価格更新CSVの対象になってしまう（仕入3000円・200g の例で
$60.79 → $52.27。差 $8.52・14% で、しきい値 $1・3% を超える）。

### 直したこと

**保存する5項目**（`ADV_FIELDS`）：目標の決め方・下限利益・仕入への連動率・
売上比下限・米国の想定税率。同じ欄にはこの5つしかない。

- **端末に保存**。eBayタブの設定と同じ入れ物（`localStorage` の `pj:pricing:v1`）に入れ、
  変えた時刻（`advAt`）も一緒に持つ。開き直すと変更後の値で始まる。
- **pj-sync（D1）にも保存**。新しく `GET /settings`・`POST /settings` を足した。
  中身は設定のJSONひとつと変更時刻で、`sync_state` の `ui.settings` に入る
  （**D1 のマイグレーションは不要**。既存のテーブルを使う）。
- **新しく変えたほうを使う。**

  | 状況 | すること |
  |---|---|
  | D1 の時刻が端末より新しい | D1 の値に合わせ、端末にも保存する（「ほかの端末で変えた設定に合わせました」） |
  | 端末の時刻が D1 より新しい | D1 に送る（「pj-sync にも保存しました」） |
  | 送ったら退けられた（D1 がもっと新しい） | 返ってきた設定に合わせる（別の端末の新しい値を上書きしない） |
  | pj-sync のURL・キーが無い／届かない | 端末の値でそのまま動く（「この端末だけに保存しました」） |

  Worker 側は**古い時刻の書き込みを退ける**（`stored:false`）。
  開いたままだった端末が、あとから変えた設定を上書きしないようにするため。
  退けたときは、いま入っている設定を返して端末側に合わせてもらう。
- 送るのは最後の入力から 0.8 秒後（打つたびには送らない）。
- **「初期値に戻す」もひとつの変更として保存する**。押したあとに開き直しても既定値で始まる。
- 選択肢に無い値（古い版の設定）は捨てて既定のままにする。
- 読めない保存値（壊れたJSON）は空として扱い、画面を止めない。

1品ごとの値（仕入値・重量・請求送料・広告料率）は**これまでどおり保存しない**。

### 確認したこと

```
pj_price（実ブラウザ・advcfg.js 29項目）
  はじめは既定値（下限利益1000円・連動率30%）✅
  5項目を変える → localStorage に入る・変えた時刻も控える ✅
    開き直しても変更後の値で始まる ✅「既定値から変更中」も出る ✅
  保存した設定で計算される：円式の目標＝下限利益＋仕入×連動率 ✅
    「売値の見直し」も保存値で判定（$45.00 → $60.79・設定の変更）✅
    既定値に戻ると推奨売値が $52.27 に変わる（だから保存が要る）✅
  初期値に戻す → 既定値になり、開き直しても既定値 ✅
  pj-sync：D1 が新しければその値に合わせ、時刻も引き継ぎ、端末にも保存 ✅
    端末が新しければ1回だけ送る（打つたびには送らない）✅
    送って退けられたら D1 の新しい設定に合わせる ✅
    届かない／URL・キーが無いときも端末の値で動く ✅
Worker（Node＋node:sqlite・setting.mjs 22項目）
  まだ何も無いときは空で返る ✅ 保存して別の端末から読める ✅ D1 に入る ✅
  新しい時刻は上書き・古い時刻は退けていま入っている設定を返す ✅
    同じ時刻なら新しい書き込みを採る ✅ 古い値で上書きされない ✅
  初期値に戻した状態もそのまま返る ✅
  時刻なし・形違い・設定なし・文字列・配列・大きすぎる・壊れたJSON → 400 ✅
    断ったあとも中身は壊れない ✅ キーなしは401 ✅
  読めない保存値は空として返し、そのあと保存し直せる ✅
回帰（regress.js 12項目）
  5つのタブを開いても例外なし ✅
  1品ごとの値（仕入値・重量・請求送料・広告料率）は今も保存しない ✅
    開き直すとHTMLの既定値に戻る ✅ 詳細設定だけ残る ✅
  推奨売値の利益＝円式の目標（設定を変えても追いつく）✅
    同じ設定なら開き直しても同じ推奨売値 ✅
  出品CSVタブの設定と混ざらない ✅ sw.js と APP_V が同じ番号 ✅
```

**Worker（proxy-sync）と pj_price の両方を直した。sw.js を v118 に上げた。**
**D1 のマイグレーションは不要（`sync_state` を使う）。Worker のデプロイが必要。**

## 7.25 入庫中の行の扱い（2026-10-09・sw.js v124）

「対応が必要（警告あり）」が148件あり、ほとんどが「納品待ちで出品中」だった。
原因は2つ別にある。

### (1) 入庫中の行が「再調達の候補」に入っていた

`isRestock()` は「eBayに出ていて FBA の**販売可能が0**」を候補の条件にしていた。
販売可能が0になる理由には **売れた**ほかに **納品した在庫がまだ入庫中**があり、
後者は買い直す必要がない（これから販売可能になる）。

- `isRestock()` に **`fba_inbound === 0`** を足した。
  SQL（`state=restock`）と件数（`counts.restock`）、pj_price 側の
  `syncIsRestock()` も同じ条件にそろえた。
- 候補になるのは、Amazon で実際に売れた行だけになった
  （販売可能0・入庫0・予約済みは顧客注文があるぶんだけ）。

### (2) 「納品待ちで出品中」を配送ポリシーで分ける

FBA に在庫が無いまま eBay に出しているのが**運用どおり**の行がある。
配送ポリシーが再調達用（W2000）の行がそれで、毎回警告に出る必要はない。

- **W2000 の行 → 情報（灰色）**。「納品待ちで出品中（再調達ポリシー）」として出し、
  「対応が必要」には数えない。
- **W2000 以外（手元発送のポリシー）→ 警告のまま**。届くまで売り越しになるので、
  行に「配送ポリシーを W2000（再調達用）に変えるか、受領まで eBay の数量を0に
  してください。」と直し方を出す。

配送ポリシーは eBay から取っていないので、**pj_price が書き出すときと同じ決まりで
推測する**（`isShipRestock()`）。`csvShipProfileFor()` が W2000 を使うのは
「在庫0のときの動作＝再調達」の行と無在庫の行なので、Worker 側も
`mode='restock'` ／ `dropship=1` ／ `restocking=1` を W2000 とみなす。

> 実際のポリシー名を eBay から取るには `GetMyeBaySelling` の項目追加と D1 の列が要る。
> 運用の決まりと一致しているあいだは推測で足りるので、いまは入れていない。

### 判定を1か所にまとめた

警告（対応が必要）と情報（対応は要らない）を同じ関数で出すため、
`warnOf()` の中身を **`judgeRow()`**（`{w:[], n:[]}` を返す）にした。
`warnOf()` は `.w`、新しい `noteOf()` は `.n` を返すだけ。
`/status` の行に **`notes`**（情報）と **`ship_restock`**（W2000 とみなした印）を足した。

### 理由ごとの件数

一覧の絞り込みの下に、**警告の理由ごとの件数**を多い順で出す。
情報も分けて数える。

```
対応が必要 4件　納品待ちで出品中 1件／売り越しの恐れ 1件／…
情報 1件　納品待ちで出品中（再調達ポリシー） 1件
```

### 確認したこと

```
Worker（Node＋node:sqlite・inbound.mjs 24項目）
  W2000 とみなす行：mode=restock・無在庫・再調達中 ✅ hold/end は違う ✅
  入庫1・入庫2の行（B0009NUP58・B003M2WQXW）は候補に入らない ✅
    入庫も予約も0の行・注文が入っている行は候補に入る ✅
    件数も絞り込みも同じ条件 ✅
  W2000 の納品待ちは警告にせず情報にする ✅ ship_restock の印 ✅
  W1000 の納品待ちは警告に残す ✅ 情報の印は付けない ✅
  無在庫・再調達中の行はこれまでどおり警告を出さない ✅
  入庫が無い行の判定は変えていない（売り越しの恐れ・手元在庫・数量の食い違い）✅
  judgeRow が w と n に分けて返す ✅ warnOf / noteOf はそれぞれを返す ✅
pj_price（実ブラウザ・inboundui.js 16項目）
  候補は2件（入庫中の2件は入らない）✅ 絞り込みでも出ない ✅
    画面側の判定（syncIsRestock）でも入庫中は候補にしない ✅
  W2000 の行は灰色の情報・直し方は出さない ✅
  W1000 の行は警告のまま・直し方を案内する ✅
  「対応が必要」は5件中4件（W2000 の納品待ちは数えない）✅ 絞り込みでも出ない ✅
  理由ごとの件数を多い順に出す ✅ 情報も分けて数える ✅
回帰：tests/ の19本・485項目すべて ❌なし・pageerror なし ✅
```

**Worker（proxy-sync）と pj_price の両方を直した。sw.js を v124 に上げた。**
**Worker のデプロイが必要**（判定が Worker 側にあるため）。
**D1 のマイグレーションは不要。**

## 7.26 配送ポリシーを eBay から取る（2026-10-10・sw.js v125・D1 migrate-0011）

### なぜ

7.25 では「納品待ちで出品中」を警告にするか情報にするかを、
`mode='restock'` ／ 無在庫 ／ 再調達中 から**推測**していた。
6.30 で「出品はすべて W2000、即発送の印の行だけ W1000」に変わるので、
この推測は合わなくなる。

### 取り込み

`GetMyeBaySelling` の `Item/SellerProfiles/SellerShippingProfile/ShippingProfileName`
を読み、`items.ebay_ship_profile` に保存する（**migrate-0011**）。

- 返らない出品もあるので、**空のときは前の値を残す**
  （`COALESCE(NULLIF(?,''), ebay_ship_profile)`）。
- ポリシーを使っていない出品では空のまま。その行はこれまでどおり推測で判定する。

### 判定

`isShipRestock(r)` は、**取れたポリシー名があればそれで決める**。
無い行だけ、これまでの推測に落とす。

名前がどちらかを決めるのに、**pj_price の設定（出品用・再調達用のポリシー名）**を使う。
設定は 7.24 の `/settings` で D1（`ui.settings`）に入っているので、Worker はそれを読む
（`shipNamesLoad()`。入口で1回）。設定が無いときは名前に `2000` / `1000` を含むかで見る。

- `/status` の行に **`ebay_ship_profile`**（名前）と **`ship_known`**（名前で判定したか）
  を足した。pj_price はこの名前と行の印を見比べ、食い違う行に
  「ポリシーが印と違います」を出す。
- **Discord の「納品待ちの商品がeBayに出ています」も同じ決まり**にした
  （W2000 の行は通知しない）。

### 確認したこと

```
Worker（Node＋node:sqlite・shipprof.mjs 22項目）
  pj_price の設定から名前を読む（W2000 / w2000 / 前後の空白 / W1000 / 知らない名前）✅
  名前が取れていればそれで決める（mode が hold でも W2000 なら再調達用）✅
    名前が W1000 なら mode が restock でも即発送とみなす ✅
    名前が無い行はこれまでどおり推測 ✅
  納品待ちの分け方が名前で決まる（W2000→情報／W1000→警告）✅ ship_known の印 ✅
  一覧にポリシー名を返す ✅
  設定が無くても W1000 / W2000 は読める ✅ pj_price で付けた別の名前でも読める ✅
  通知も同じ決まり（W2000 の行は「納品待ち」を通知しない）✅
  最後に売れた日時（ebay_sold_at）を返す ✅
pj_price（実ブラウザ・markdown.js 40項目・inboundui.js 21項目）
  → 出品CSV側の確認は 6.30 を参照
回帰：tests/ の21本・553項目すべて ❌なし・pageerror なし ✅
```

**D1 を先 → deploy を後。**
```
cd proxy-sync
npx wrangler d1 execute pj-sync --remote --file=./migrate-0011-ship-profile.sql
npx wrangler deploy
```
ポリシー名は次の取り込み（1時間ごと、または「状況を取り込む」）から入る。
入るまでは、これまでどおり推測で判定する。

## 7.27 価格の操作を販売連携の出品データで行う（2026-10-10・sw.js v126・D1 migrate-0012）

### なぜ

売値の見直し・最低売値・3日ごとの値下げが**出品リストの行**で動いていたため、
出品リストを空にすると値付けが止まっていた。
eBay に出ている出品（ItemID）は pj-sync 側にあるので、価格の操作もそちらに移す。

### 価格の元データを D1 に残す（migrate-0012）

`items` に5列足した。pj_price が**CSVを書き出したとき**と**名簿を送ったとき**に送る。

| 列 | 中身 |
|---|---|
| `weight_g` | 実重量（梱包込） |
| `cost_yen` | 仕入値（手直し後） |
| `sold_usd` | 相場（総額$） |
| `mark_at` | 最後に値下げCSVを書き出した時刻 |
| `mark_stop` | 1 なら値下げしない |

`putListings` は `COALESCE` で**送られてきた項目だけ**書き替える。
別の用事（手元在庫の数など）で送っても、価格の元データは消えない。

計算式（為替・手数料・重量・下限利益）は pj_price 側にあるので、**Worker は数字だけ持つ**。
売値を決めるのは pj_price（`csvPriceFor`）のまま。

### 一覧がちょうど1000件で切れていた

- 原因は**2か所の上限**。pj_price が `/status?limit=1000` で読み、Worker 側も
  `Math.min(1000, …)` で止めていた。**どちらも 1000 だったので、ちょうど1000件**になる。
- Worker の上限を **5000件**に上げた。`/status` の返しに次を足した。

```
limit          … そのとき使った上限
rows_returned  … 返した件数
rows_total     … いまの絞り込みに当てはまる行の総数（COUNT で数える）
truncated      … 上限で切れたか（rows_returned >= limit かつ rows_total > rows_returned）
```

- pj_price 側は設定「取り込みの上限」（既定3000件）で読み、`truncated` のときは
  一覧の上に警告を出す。切れていると件数・警告・価格の操作が一部の行だけになるため。

### 販売連携タブでの値付け

値は「**出品リストの同じ行 → D1 に残した値 → 既定値**」の順に使う
（`syncWeightOf` / `syncCostOf`）。仕入値がどこにも無い行は、これまでどおり
Amazon最安値を仕入値とみなす（`syncRecommend`）。

- 一覧に「重量 520g（実測）」「150g（既定）」と出どころを出す。
- 「売値の見直し（価格更新CSV）」「選んだ行を最低売値まで下げる」
  「値下げの時期です（n件）」を販売連携タブに置いた。
  しきい値・間隔・下げ幅は出品CSVタブの設定をそのまま読む（設定は1か所）。
- 行の「値下げしない オン／オフ」は `mark_stop` を送る。
  値下げCSVを書き出したら `mark_at` を送る（端末を変えても続きから動く）。
- 相場（総額$）は、その端末の入力が無ければ `sold_usd` を使い、入力したら D1 にも送る。
  欄を空にしたときは **0 を送って取り消す**（`numZero`。NULL は「送られてこなかった」）。

出品CSVタブの同じボタンは、販売連携タブへ移って同じ処理を呼ぶだけにした
（書き出しを2か所に持たない。詳しくは CSV一括出品の 6.31）。

### 確認したこと

```
Worker（Node＋node:sqlite・pricesrc.mjs 13項目）
  名簿・書き出しで送った実重量・仕入値・相場を保存する ✅ 一点物の印も立つ ✅
  送られてこなかった項目は消さない（別の用事で送っても残る）✅
  値下げの記録（mark_at / mark_stop）を保存する ✅ 印は下ろせる ✅
  相場は 0 を送ると取り消せる（実重量・仕入値はそのまま）✅
  /status が価格の元データと値下げの記録を返す ✅
  上限どおりの件数・全体の件数・切れた印（truncated）を返す ✅
  上限は5000件まで（1000件で切れていたのを上げた）✅
pj_price（実ブラウザ・pricesrc.js 31項目）
  書き出し・名簿で送る中身（weight_g / cost_yen / sold_usd / one_off）✅
  出品リストを空にしても見直し・値下げの対象・次の売値・最低売値が同じ ✅
  出どころが「出品リスト」→「保存済み（D1）」に変わる ✅
  実重量は D1 の実測を使い、無い行だけ既定重量（150g・既定）✅
  出品リストが空でも 価格更新CSV・値下げCSV・最低売値CSV が書き出せる ✅
  「値下げしない」の印は D1 に置く ✅ 相場も D1 の値を使う（「保存済み」）✅
  取り込みが上限で切れたら警告を出す ✅ 上限は5000件まで・空のときは3000件 ✅
回帰：tests/ の23本・628項目すべて ❌なし・pageerror なし ✅
```

**D1 を先 → deploy を後。**
```
cd proxy-sync
npx wrangler d1 execute pj-sync --remote --file=./migrate-0012-price-source.sql
npx wrangler deploy
```
deploy のあと、pj_price で**CSVを1回書き出す**か**「出品リストの名簿を送る」**を押すと、
実重量・仕入値・相場が D1 に入る。入るまでは、これまでどおり出品リストの行の値を使う。

## 7.28 せどりすとSKU の仕入値を /status で返す（2026-10-10・sw.js v127）

### なぜ

7.27 のあと、出品リストを空にして値下げを出すと 132件が
「仕入値が分からないので Amazon最安値から」になった。
`cost_yen` は 7.27 以降に書き出した行にしか入らないため。

`skus` には**せどりすとSKU の末尾の仕入値**（`cost`）が個体ごとに入っている。
ASIN＋状態区分で引けるので、これを Amazon最安値より先に使う。

### /status に足したもの

```sql
(SELECT MAX(s3.cost) FROM skus s3
  WHERE s3.asin=items.asin AND s3.cost>0
    AND (s3.cond=items.cond OR (items.cond='cart' AND s3.cond='used'))) AS sku_cost
```

- `MAX` … 同じ ASIN・同じ区分に個体が複数あるときは**いちばん高い仕入値**
  （安いほうで出すと赤字になりうる）。
- `cart` … カートリッジのみの出品は、個体のSKUが中古（`used`）なのでそちらも見る
  （箱付き中古の仕入値のほうが高く出るので安全側）。
- 新品の出品に中古の個体の仕入値は使わない（区分が合うものだけ）。
- 在庫0の過去SKU（`active=0`）も見る。出品が残っているなら仕入れた値は変わらないため。

**再調達中・無在庫の行は、この順に関係なく必ず Amazon最安値を仕入値とみなす。**
売れてから仕入れ直す行なので、もとの仕入値で下限を出すと赤字になりうる。

pj_price 側は「出品リスト → `cost_yen` → `sku_cost` → Amazon最安値」の順に使い、
**SKU から読めた仕入値は書き出しのときに `cost_yen` に保存する**（次からは「保存済み」）。
確認の文には「せどりすとSKUの仕入値 n件／Amazon最安値で代用 n件」と分けて出す。

### 確認したこと

```
Worker（Node＋node:sqlite・pricesrc.mjs 19項目）
  SKU の末尾の数字を仕入値として返す（4030）✅ cost_yen とは別に返す ✅
  同じASINに複数あるときはいちばん高い仕入値（1200/3500/2000 → 3500）✅
  新品の出品に中古の個体の仕入値は使わない ✅
  カートリッジのみは中古の個体の仕入値を使う（安全側）✅
pj_price（実ブラウザ・pricesrc.js 43項目）
  SKU の仕入値（4,030円）で推奨売値・最低売値を出す ✅ 一覧に出どころを出す ✅
  SKU からも取れない行だけ Amazon最安値で代用する ✅
  件数を分けて出す（せどりすとSKU 2件／Amazon最安値で代用 1件）✅
  読めた仕入値は D1 に残し、次からは「保存済み」になる ✅
  再調達中・無在庫はもとの仕入値を使わず、いまのAmazon最安値から下限を出す ✅
回帰：tests/ の23本・645項目すべて ❌なし・pageerror なし ✅
```

**D1 の変更は無い（`skus` の仕入値はもとから入っている）。deploy だけでよい。**
```
cd proxy-sync
npx wrangler deploy
```

## 7.29 販売連携タブの整理（2026-10-10・sw.js v128）

機能は消さず、出している場所と数を減らした。画面の上に使い方を書いてある
（毎日：状況を取り込む → 対応が必要を確認 → 発送／3日ごと：値下げ／
ときどき：再調達の候補・FBA納品の判断・売値の見直し）。

### 一番上は「状況を取り込む」と「今日やること」

```
対応が必要 110 ／ 値下げの時期 367 ／ 再調達の候補 24 ／ FBA納品の判断 3
```

4つを並べ、押すとその絞り込みになって一覧へ動く。**0件の項目は薄く**出す
（押せば中身は見られる）。件数は一覧の絞り込みと同じ数え方（`SYNC_FILTERS`）なので、
ずれることはない。

### そのほかの整理

- 「eBayに出ている○件／過去SKU○件／解析不可○件…」は **「詳しい数字」**に畳んだ。
- **価格の操作**（売値の見直し・最低売値・3日ごとの値下げ）を**1つの畳める欄**にまとめた。
  値下げの時期が来ていれば**自動で開き**、見出しに「価格の操作　値下げの時期 3件」と出す。
- **「出品リストの名簿を送る」は、アップロード結果を取り込んだときに自動で送る**ように
  した（ItemID が入った直後に送るので、押し忘れがなくなる）。ボタンは「その他」に残した。
- 「手元在庫の印を付け直す」「無在庫オン／オフ」も**「その他」**へ。
- **再調達で出し直すCSV**は、絞り込みが「再調達の候補」のときだけ出す。
- 一覧で行を選んだときだけ、**画面の下に操作バー**を出す。
  最低売値まで下げる／再調達CSV（再調達の候補のときだけ）／無在庫／値下げしない／選択解除。
  「無在庫」「値下げしない」は選んだ行の状態を見て、オン・オフの言葉が変わる。
- 設定（pj-sync のURL・キー・既定重量・上限など）は**⚙設定**へ移した。
  タブにはいまの値を1行だけ出す。

### テスト

`tests/synctidy.js`（27項目）。今日やることの件数と絞り込みの一致／0件の薄さ／
詳しい数字の畳み／その他の中身／価格の欄の自動開き／操作バーの出し入れと中身／
再調達CSVの出し分け／結果ファイル取り込みで名簿を自動送信／使わないタブを隠す。

**pj_price だけを直した。Worker・D1 の変更は無い。**

## 7.30 Amazonの方が得な商品を eBay で安売りしない（2026-10-10・sw.js v129・D1 migrate-0013）

### なぜ

7.27 で最低売値を**仕入値基準**にしたので、安く仕入れた商品ほど eBay の売値が下がる。
その結果、**Amazonで売ったほうが利益の大きい商品まで値下げの対象**になっていた。

> 例：お姉チャンバラ vorteX（Xbox 360）E-B000VO8NZ4
> 仕入値 ¥1,680／Amazon最安値（新品）¥5,100 → Amazon利益 約¥2,255 なのに、
> eBay は $27.60 → 下限 $24.87（利益¥500）まで値下げする予定だった。

### Amazon同等ライン

行ごとに「**Amazonで売ったときと同じ利益になる eBay の売値**」を出し、下限に足す。

```
Amazon手取り   = Amazon最安値 ×（1 − 販売手数料率）− FBA配送代行手数料
Amazon利益     = Amazon手取り − 仕入値（仕入値の優先順は 7.27・7.28 のまま）
Amazon同等ライン = その利益になる eBay 売値（csvPriceForProfit で逆算）
```

- 逆算は**既存の利益計算そのもの**を使う（`priceModel` の地帯別係数で
  `(利益＋rest)/den`。いちばん利益の薄い地帯に合わせる）。式を2か所に持たない。
- Amazon最安値は、これまでと同じ `syncBasis`（中古で「可」を除く設定を尊重）。
- **使わない行**：Amazon最安値が取れない／仕入値が分からない／
  **Amazon利益が下限利益（設定・例 ¥500）以下**／行の「eBay優先」がオン／
  再調達中・無在庫（売れてから仕入れる行なので手元の在庫が無い）。

### 下限を引き上げる

```
最低売値 = max（仕入値基準の最低売値, Amazon同等ライン）
出すべき売値（推奨売値）= max（仕入値基準の売値・相場の判定, Amazon同等ライン）
```

これが次のすべてに効く。

- **売値の見直し（価格更新CSV）**… 差があれば**上げる**提案になる。
- **3日ごとの $1 値下げ**… Amazon同等ラインで止まる。着いている行は
  「Amazonの方が得（これ以上は下げません）」と出して対象から外す。
- **選んだ行を最低売値まで下げる**… 下げ先が Amazon同等ラインになる。

### 表示

- 効いている行に **「Amazonの方が得」**のバッジ。行の中に
  「Amazon利益 ¥2,255（最安値 ¥5,100 − 手数料15% − FBA ¥400 − 仕入値 ¥1,680）　
  **eBayで同じ利益 $44.36**」と出す。
- **FBA在庫または入庫中があり**、eBayの売値が Amazon同等ラインより下の行は
  **「対応が必要」**に入れ、「同じ在庫を Amazon でも販売中です。eBay を $44.36 以上に
  するか、eBay を数量0にしてください。」と出す（理由ごとの件数にも「Amazonでも販売中」）。
- 行の **「eBay優先」**ボタン（D1 の `ebay_first`。**migrate-0013**）。
  オンにした行は Amazon同等ラインを使わない。
  Amazonの最安値が高いだけで売れていない商品や、eBayで実績を作りたい商品に使う。
- バッジもボタンも、いまの「一点物／無在庫／値下げしない」と同じ並びに置いた（行は増やさない）。

### 設定

⚙設定の「価格の見直しと値下げ」に **Amazon販売手数料（既定15%）**と
**FBA配送代行手数料（既定¥400）**を置いた。`/settings` で D1 にも同期するので、
どの端末でも同じ値で動く（`ADV_AMZ`）。

### 確認したこと

```
pj_price（実ブラウザ・amzline.js 34項目）
  依頼の例：Amazon利益 ¥2,255（5100×0.85−400−1680）✅
    Amazon同等ライン $44.36 … 仕入値基準の下限 $26.39／推奨売値 $31.55 より高い ✅
    最低売値・出すべき売値がそこまで上がる ✅ 値下げの対象から外れる ✅
    見直しは「$27.60 → $44.36」の値上げを出す ✅ CSVの列と形式は変わらない ✅
  FBA在庫があって eBay が安い行は「対応が必要」＋直し方を出す ✅
    在庫が無ければ注意は出さない（下限は効いたまま）✅
  Amazon利益が下限利益以下の行（仕入値3,900）は今までどおり ✅
  Amazon最安値が取れない行も今までどおり ✅
  eBay優先をオンにすると、下限・推奨売値・値下げの対象が元に戻る ✅
  手数料は⚙設定で変えられ、D1 にも送る ✅
Worker（Node＋node:sqlite・pricesrc.mjs 22項目）
  ebay_first を保存する・下ろせる・一覧に返す ✅
回帰：tests/ の25本・710項目すべて ❌なし・pageerror なし ✅
```

**D1 を先 → deploy を後。**
```
cd proxy-sync
npx wrangler d1 execute pj-sync --remote --file=./migrate-0013-ebay-first.sql
npx wrangler deploy
```

## 7.31 一覧のページ分け（2026-10-10・sw.js v130）

販売連携タブの一覧も **25／50／100件ずつ**（初期値25件）に分けた。
決まりは出品CSVタブと同じなので、**6.35** に1か所でまとめて書いた。

販売連携タブで特に効くところ。

- 出品1,734件でも、一覧の作り直しは **170ms → 35ms**（1ページぶんだけ描くため）。
- 「今日やること」の各ボタンで絞ったときも**1ページ目から**出す。
- 下の操作バーの「選択 ○件」は**全ページの合計**で、
  他のページにも選択があるときは「（他のページ 25件を含む）」と出す。
  最低売値まで下げる・無在庫・値下げしない・再調達CSV は**全ページの選択行**に効く。
- 絞り込みを変えたときは、新しい絞り込みで**見えなくなった行の選択を外す**。
- 件数（対応が必要・値下げの時期・再調達の候補・FBA納品の判断・絞り込みの選択肢）は
  これまでどおり**全件**で数える。

**pj_price だけを直した。Worker・D1 の変更は無い。**

## 7.32 操作バーに「見直し価格にする」／最低売値の表示を直した（2026-10-10・sw.js v131）

### 見直し価格にする

選んだ行の操作バーに **「見直し価格にする」**を足した。
選んだ行を**「売値の見直し」の価格（上げも下げも）**に変える価格更新CSVを出す。

- ⚙設定の「見直しが要る行だけ」に**関係なく、選んだ行すべて**が対象
  （`syncRevRun(true)`。確認にも「選んだ行すべて（上げも下げも）」と出す）。
- 価格は `syncWantPrice`（相場の判定と **Amazon同等ライン**を含む）。
- 「売値の見直し（価格更新CSV）」のボタンはそのまま（絞り込みの設定に従う）。

### 最低売値の表示と、下げ先

**一覧の「最低売値」が仕入値基準のままだった**ので、Amazonの方が得な行では
押したときの値と食い違って見えた（例：表示 $26.11／実際は $41.70 で止まる）。

- 一覧には**操作で使う値**（`syncFloorOf`）を出す。上がっているときだけ
  **「（Amazonの方が得。仕入値基準では $26.11）」**と添える。
- 「最低売値まで下げる」で、いまの売値が Amazon同等ラインより安い行は
  **「Amazonの方が得（$41.70 未満では出しません）」**と理由を出して外す。
- 下げられる行の確認に **「うち n件は Amazon同等ラインで止めます」**と出す。
  下げ先は Amazon同等ライン（仕入値基準の最低売値ではない）。

### 確認したこと

```
pj_price（実ブラウザ・amzline.js 41項目）
  操作バーに「見直し価格にする」がある ✅
  選んだ行すべてが対象（見直しが要る行だけの設定に関係なく）✅
  選んだ行を見直し価格（Amazon同等ライン）にする CSV が出る ✅
  一覧の「最低売値」も Amazon同等ライン（仕入値基準は添えるだけ）✅
  Amazonの方が得な行は、そのラインより下げない（理由つきで外す）✅
  ラインより上にいる行は、ラインまで下げる ✅
回帰：tests/ の26本・752項目すべて ❌なし・pageerror なし ✅
```

**pj_price だけを直した。Worker・D1 の変更は無い。**

## 7.33 中古の基準価格は、新品のほうが安ければ新品を使う（2026-10-10・sw.js v132・D1 migrate-0014）

### なぜ

中古の最安値が新品より高いことがある。

> 例：ねんどろいど 錦木千束 E-B0BF56J4GD-U
> 中古最安 ¥9,719／新品最安 ¥6,280（送料無料）
> 中古基準では 推奨売値 $121.77・Amazon利益 ¥3,361・eBayで同じ利益 $83.51 と出ていたが、
> 新品が ¥6,280 で買える以上、中古が ¥9,719 で売れる前提は成り立たない。

### Amazon基準価格

中古（`-U`）・カートリッジのみ（`-C`）の行は

```
Amazon基準価格 = min（Amazon最安値（中古）, Amazon最安値（新品））
```

- どちらも**送料込みの総額**（`landed`）で比べる。
- **新品の最安値が取れていない行は、これまでどおり中古の最安値**を使う。
- **新品の行は変えない**（新品の最安値をそのまま使う）。

判定は `syncBasis()` の1か所に入れたので、**そこから出る値がすべて置き換わる**。

| 使う場所 | 変わり方 |
|---|---|
| 推奨売値・最低利益ライン・損益分岐 | 基準価格から計算（例 $121.77 → $98.62） |
| Amazon利益・Amazon同等ライン（7.30） | 例 ¥3,361 → **¥438**。下限利益以下なのでラインは使わない |
| 再調達中・無在庫の仕入値 | 新品のほうが安ければ新品で買い直す前提（Worker の `restockLowest` も同じ） |
| 最安グループ・1人だけ注意 | 新品を基準にした行は**新品側の人数**（`amazon_new_n`）で判定する |

### Worker（migrate-0014）

`items` に **`amazon_new_low` / `amazon_new_n` / `amazon_new_at`** を足し、
**中古の行でも新品の最安値を取る**ようにした。

- `lowestReqs()` … 行ごとに「その行の状態 → 新品」の順で要求を作る（重複は1回）。
  上限で切れても片方だけが落ち続けないよう、行ごとに並べる。
  1行につき最大2回の要求になるので、日次の `syncPricing` が1回に見る行数は半分にした。
- `/lowest`（その場の取り寄せ）も同じ組み立てにした。
- **不具合の修正**：カートリッジのみ（`cond='cart'`）の行は `'<ASIN>|cart'` で
  答えを探していて、いつも空振りしていた（Amazon では中古として引く）。`lowestKey()` で直した。

### 表示

- 新品を使った行は **「Amazon基準 ¥6,280（新品の方が安い・中古 ¥9,719）」**。
- Amazon利益は**下限利益以下でも数字は出す**が、
  **「Amazonの方が得」バッジと「Amazon でも販売中です…」の赤い注意は出さない**
  （「下限利益 ¥650 以下なので、eBay の下限には使いません」と添える）。

### 確認したこと

```
pj_price（実ブラウザ・amzline.js 54項目）
  基準価格は min（中古 ¥9,719, 新品 ¥6,280）＝ ¥6,280 ✅
  Amazon利益 ¥438（6280×0.85 − 400 − 4500）✅ 同等ラインは使わない ✅
  バッジと赤い注意を出さない ✅ 最低売値は仕入値基準に戻る ✅
  推奨売値・最低利益ライン・損益分岐も新品基準（中古基準より安い）✅
  「Amazon基準 ¥6,280（新品の方が安い・中古 ¥9,719）」と出す ✅
  最安グループも新品側の人数で判定 ✅
  中古のほうが安い行／新品が取れない行／新品の行は今までどおり ✅
  書き出すCSVの列と形式は変わらない ✅
Worker（Node＋node:sqlite・pricesrc.mjs 30項目）
  中古・カートリッジの行は「その状態＋新品」の2回ぶん要求する ✅ 行ごとに並べる ✅
  カートリッジのみは中古として引く（空振りの修正）✅
  再調達の仕入値も「新品のほうが安ければ新品」✅
  /status が新品の最安値を返す ✅
回帰：tests/ の26本・773項目すべて ❌なし・pageerror なし ✅
```

**D1 を先 → deploy を後。**
```
cd proxy-sync
npx wrangler d1 execute pj-sync --remote --file=./migrate-0014-amazon-new-low.sql
npx wrangler deploy
```
新品の最安値は**次の取り込み（日次の最安値、または「新品最安値を取る」）から**入る。
入るまでは、これまでどおり中古の最安値を基準にする。

## 7.34 値下げ・価格更新CSVのエラー対策（2026-10-10・sw.js v133・D1 migrate-0015）

3日ごとの値下げCSV（344件）のアップロードで15件が失敗した。

| エラー | 件数 | 中身 |
|---|---|---|
| 22003 | 9件 | Auto decline amount cannot be greater than or equal to the Buy It Now price |
| 21919137 | 6件 | 写真の長辺が500px未満（価格だけの Revise でも写真が再チェックされる） |
| 23015（警告） | 全件 | ベストオファー時は即時支払い不可。無視してよい |

### 1. ベストオファーの金額を値段と一緒に出す

値段を変えるCSV（3日ごとの値下げ・最低売値まで下げる・売値の見直し・見直し価格にする）
のすべてで、`*StartPrice` と一緒に次の2列を出す。

```
MinimumBestOfferPrice      … 自動拒否額
BestOfferAutoAcceptPrice   … 自動承諾額
```

- **自動拒否額**＝その行の最低売値（Amazon同等ラインが効く行はその値）。
  新しい売値以上になるときは **「新しい売値 − $0.01」**。
- **自動承諾額**は、いまの値が新しい売値以上のときだけ「新しい売値 − $0.01」に下げる。
  **File Exchange では空欄は「変えない」なので、空にしても解除にはならない**
  （依頼では「空にして解除」だったが、解除はできないので下げる形にした。
  完全に外すときは eBay の画面で消す）。
- **ベストオファーを使っていない出品は空欄のまま**。列が空なら eBay は何も変えないので、
  勝手にオンになることはない。1件もベストオファーが無いときは列自体を出さない。
- 列名が違うと言われたときのために、⚙設定に
  **「値段を変えるCSVに、ベストオファーの金額も一緒に出す」**（既定オン）を置いた。
  外せばこれまでの3列に戻る。
- いまの設定は **eBayの取り込みから D1 に保存する**（migrate-0015）。
  `BestOfferDetails/BestOfferEnabled`・`ListingDetails/BestOfferAutoAcceptPrice`・
  `ListingDetails/MinimumBestOfferPrice`。返らない回で消さないよう、空のときは前の値を残す。

### 2. アップロード結果で失敗を拾う

「アップロード結果を取り込む」が、**値段を変える Revise の結果**（CustomLabel が無く
ItemID だけの行）も読めるようにした。

- **Failure の行は、書き出す前の状態に戻す。** いまのところ戻すのは
  「最後に値下げした日（`mark_at`）」で、値下げの回数は進まない。
  売値は eBay 側が変わっていないので、次の取り込みでそのまま戻る。
  そのために、書き出した内容を端末に控える（`pj:syncsent:v1`・30日で捨てる）。
- 失敗の理由を行に出す（**「写真が500px未満：差し替えが必要」**
  **「ベストオファー金額（自動拒否額が売値以上）」** ほか）。D1 に `revise_err` として
  残すので、次の取り込みでも消えない。**次のアップロードが通れば消える。**
- **写真が原因の行は「対応が必要」**に入れる（理由ごとの件数にも「写真が500px未満」）。

### 3. 写真の大きさの事前チェック

写真を上げるときに**縮小後の幅・高さを控える**ようにした（`csvShrink`）。
長辺が500px未満の写真がある行は、書き出し前の確認と行の注意に
**「写真が小さい（長辺500px未満）n枚：差し替えてください」**と出す。
大きさが分からない古い写真は数えない（分かるものだけ知らせる）。

**D1 を先 → deploy を後。**
```
cd proxy-sync
npx wrangler d1 execute pj-sync --remote --file=./migrate-0015-best-offer.sql
npx wrangler deploy
```

## 7.35 選択バーで印をまとめて切り替える／小さな差では注意を出さない（2026-10-10・sw.js v134）

### 印を付ける ▾

選んだ行の操作バーを **4つ**（見直し価格にする／最低売値まで下げる／**印を付ける ▾**／
選択解除）にして、iPhone で1行に収まるようにした。
「印を付ける ▾」を開くと、選んだ行すべての印を一度に切り替えられる。

```
eBay優先 オン／オフ　一点物 オン／オフ　値下げしない オン／オフ　無在庫 オン／オフ
```

- 実行前に **「25件を eBay優先 オンにします」**と件数を出して確認する。
- **ページをまたいだ選択にもすべて反映**し（「他のページの 25件を含みます」）、
  D1 に保存する（`/listings` に200件ずつ）。
- すでにその状態の行は送らない。**付けられない印はとばし**、
  「○件は付けられないためとばしました」と出す
  （いまのところ「在庫がある行に無在庫の印」が対象）。
- 一点物をオンにすると「人が決めた」印（`one_off_known`）も一緒に立つ（行ボタンと同じ）。
- 再調達CSVもこの欄に入れた（絞り込みが「再調達の候補」のときだけ出る）。

### 「Amazonでも販売中」は差が小さければ出さない

いまの売値と Amazon同等ラインの差が **$1 未満、または 3% 未満**なら、
赤い注意と「対応が必要」には入れない（**売値の見直しと同じしきい値**を使う）。

> 例：ザ・クルー E-B014UKMZVW 売値 $25.31／同等ライン $25.56（差 $0.25・1.0%）→ 入らない

**バッジ「Amazonの方が得」と、値下げの下限（Amazon同等ライン）はそのまま。**

### 確認したこと

```
pj_price（実ブラウザ・boerr.js 25項目／barflags.js 19項目）
  これまでの3列はそのまま＋自動拒否額・自動承諾額の列を足す ✅
  自動拒否額は最低売値（売値以上になるときは 売値 − $0.01）✅ 必ず売値より下 ✅
  ベストオファーを使っていない出品は空のまま ✅ 設定で列を止められる ✅
  結果ファイルの Failure は値下げの記録を戻す ✅ 成功した行はそのまま ✅
  理由を行に出す ✅「対応が必要」と件数に出る ✅ 次が通れば消える ✅
  長辺500px未満の写真を数えて、書き出し前の確認に出す ✅
  バーは4つ ✅ 印の欄に8つのオン／オフ ✅ 件数を出して確認 ✅
  25件すべてに反映 ✅ ページをまたいだ50件にも反映 ✅ 付けられない行はとばす ✅
  差 $0.25 は対応が必要に入れない（バッジと下限はそのまま）✅ 差 $2.50 は出す ✅
Worker（Node＋node:sqlite・pricesrc.mjs 34項目）
  mark_at は空文字で消せる ✅ 失敗の理由と時刻を残す ✅ 次が通れば消える ✅
  ベストオファーの設定を一覧に返す ✅
回帰：tests/ の28本・821項目すべて ❌なし・pageerror なし ✅
```

**7.35 は pj_price だけの変更（Worker・D1 の変更は無い）。**

## 7.36 フィギュアのみ（箱なし・-L）を Worker でも扱う（2026-10-11・sw.js v135）

せどりすとで「可」として取り込んだフィギュアを、箱を外して本体だけで出す
（出品CSVタブ側は **6.38**）。カートリッジのみ（`-C`）と同じ「箱なしで出す行」として
扱うので、Worker は `-L` を読めるようにするだけでよい。

### Worker（`proxy-sync/worker.js`）

- `parseLabel` が `E-<ASIN>-L` / `M-<ASIN>-L` を読み、`cond='loose'`・`cart=true` を返す。
- `isCart(r)` は `cond` が `'cart'` と `'loose'` の両方で true
  （箱なしで手元から発送する行。FBAの在庫が無いのが正常）。
  これで次がまとめて `-L` にも効く。
  - 一点物の見張り・在庫の突き合わせから外す（代わりに `hand_qty` と数量を見る）
  - **再調達の候補にしない**（`cond NOT IN ('cart','loose')`。通知も同じ）
  - 売れたときの手元在庫の引き算（`hand_qty`）に入れる
- せどりすとSKU の仕入値（7.32）は、`-L` の行でも**箱付き中古（`-U`）の SKU** から引く
  （`items.cond IN ('cart','loose') AND s3.cond='used'`）。
- Amazon の最安値は中古を見る（`lowestKey` は `asin|used`。新品も一緒に取るので、
  新品のほうが安ければ 7.33 の基準が効く）。
- `/listings` は `cond` が `'used' / 'cart' / 'loose'` のときだけその値を入れる
  （それ以外は `'new'`）。

### pj_price（販売連携タブ）

- 既定重量は `csvWeightLoose`（200g）、送料は `csvShipLoose`（封筒1通ぶん固定）。
- Amazon基準価格は**中古最安値 × `csvLooseAmz`（初期80%）**。
- **Amazon同等ライン（7.30）は `cond='loose'` では使わない**
  （Amazonでは箱付きで売るので、箱なしの売値と比べる意味がない）。

### 確認したこと

```
出品CSVタブ（実ブラウザ・loose.js 37項目）
  「可」のフィギュア → E-<ASIN>-L・cond loose・Used(3000)・一点物オフ ✅
  英題の末尾に Loose No Box（80文字以内）✅ ConditionDescription に箱なし ✅
  出品文の3文（箱なし・封筒発送・付属品は写真のとおり）✅
  「可」のゲームは今までどおり E-<ASIN>-C（Acceptable 6000）✅
  「可」以外のフィギュアは E-<ASIN>-U ✅
  箱付きに切り替えると E-<ASIN>-U・英題の Loose No Box も消える・重量も戻る ✅
  既定重量 200g（梱包マージンを足さない）✅ 封筒の送料で推奨売値が下がる ✅
  封筒用の配送ポリシー ✅ 箱付きの行は送料表・いつものポリシーのまま ✅
  同じASINの -L が出品中 → 新規出品ではなく「既存の出品に+1」✅
  重複の恐れには出さない ✅ +1するCSVのボタンが出る ✅
  ストック写真（カタログ画像）の出品には回さない ✅
  CSVの1行目と列は今までどおり・箱なしの行があるときだけ末尾に
  ConditionDescription を足す ✅
  販売連携：Amazon基準 ¥9,719 → ¥7,775（×80%）✅ 箱付きは ¥9,719 のまま ✅
  同等ラインを使わない（最低売値も押し上げない）✅ 箱付きでは今までどおり出る ✅
Worker（Node＋node:sqlite・loosew.mjs 32項目）
  parseLabel が -L を loose として読む（M-・小文字も）✅ isCart が両方で true ✅
  lowestKey は asin|used・中古と新品の両方を取る ✅
  /listings で -L と -U が別の行になる（PK は asin＋cond）✅
  ItemID・手元在庫・実重量・仕入値が -L の行に入る ✅
  -L は再調達の候補に入らない・箱付き中古は今までどおり入る ✅
回帰：tests/ の30本・890項目すべて ❌なし・pageerror なし ✅
```

**7.36 は Worker のデプロイが必要（`-L` の解析のため）。D1 のマイグレーションは不要
（`cond` は TEXT なので `'loose'` をそのまま入れられる）。**

## 7.37 自動値下げ：pj-sync から eBay に直接反映（2026-10-11・sw.js v136・D1 migrate-0016）

3日ごとの値下げCSVを File Exchange にアップロードする手間をなくす。
pj-sync の Cron が1日1回、売値とベストオファーの自動拒否額を eBay で直接変える。
出品時の開始価格と値下げ幅は出品CSVタブ側（**6.39**）。

eBay 純正の自動値下げ（Markdown Manager）は出品画面で1件ずつしか設定できず、
CSV／API で設定する公式の方法が見つからないため、pj-sync 側で行う。

### 1. 書き込みは1つだけ

フェイズAの Worker は「外に出る通信はすべて `net()` を通し、読み取り専用の許可表に
無いものは例外にする」つくりだった。そこに**書き込みを1行だけ**足した。

```js
const EBAY_WRITE_CALLS = ["ReviseFixedPriceItem"];
{ m:"POST", re:/…\/ws\/api\.dll$/, calls: EBAY_WRITE_CALLS, write:true }
```

- `write:true` の行は、**呼ぶ側が `net(run, url, {write:true, …})` と明示したときだけ**通る。
  ふだんの取り込みから間違って書き込むことはできない。
- `ReviseFixedPriceItem` 以外の書き込み（`AddFixedPriceItem` や `EndItem` など）は通らない。
- `ReviseInventoryStatus` は**ベストオファーを変えられない**ので使わない
  （売値だけ下げると自動拒否額が売値以上になり 22003 で弾かれる）。

### 2. 選ぶ行（pj-sync 側）

`scope='ebay'` で ItemID がある行を、`mark_at` の古い順に見て、次をとばす。

| とばす理由 | 条件 |
| --- | --- |
| 値下げしない | `mark_stop=1` |
| 一点物 | `one_off=1` |
| 無在庫 | `dropship=1`（数量1以上） |
| 再調達中 | `restocking=1` |
| **eBayのセール中** | `ebay_sale=1`（取り込みで `DiscountPriceInfo` が付いた出品） |
| 数量0 | `ebay_qty<=0` |
| 売れたので値下げ停止 | 直近の値下げより後に eBay で売れた |
| **値下げ幅が未設定** | `md_step` / `md_floor` が無い（pj_price から送るまで触らない） |
| 最低売値に着いています | `ebay_price <= md_floor` |
| 間隔が空いていません | `mark_at` が間隔（既定3日）より新しい |

- **値上げは自動ではしない**（今までどおり「見直し価格にする」で手動）。
- 最低売値は pj_price が決めた値（`md_floor`）。Amazon同等ラインが効く行はその値、
  eBay優先の行は仕入値基準。式は pj_price 側の設定で変わるので、Worker は数字だけ持つ。

### 3. 変える値

```
新しい売値     ＝ max(いまの売値 − md_step, md_floor)        （$0.01 単位）
自動拒否額     ＝ md_floor（新しい売値以上になるときは 新しい売値 − $0.01）
自動承諾額     ＝ いまの値が新しい売値以上の行だけ 新しい売値 − $0.01
```

ベストオファーを使っていない出品（`ebay_bo` が 1 でない）には金額を送らない
（勝手にオンにしない）。式は値下げCSVの `syncBoCells` と同じ。

- 成功：`ebay_price` / `mark_at` / `md_done+1` / `ebay_bo_decline` を更新し、
  前回の失敗（`revise_err`）を消す。
- **失敗：売値も回数も進めない**。理由を `revise_err` に残して「対応が必要」に出す
  （次の日にもう一度試す）。権限不足のエラーのときは、そこで打ち切って通知する。

### 4. 安全装置

| ⚙設定 | id | 初期値 |
| --- | --- | --- |
| 自動値下げ（オフ／予定だけ表示／オン） | `autoMdMode` | **オフ** |
| 1日に変える上限 | `autoMdMax` | 200 件 |
| 値下げの間隔 | `csvMarkDays` | 3 日 |
| 値下げの回数 | `csvMarkTimes` | 10 回 |
| 1回の下げ幅（最低） | `csvMarkStep` | $1 |

- **「予定だけ表示」では eBay を1回も呼ばない**。販売連携タブに
  `次の自動値下げ予定：3件` と `・商品名：$77.50 → $75.00（下限 $60.00・あと7回）`
  の一覧を出す。
- 上限を超えたぶんは翌日に回す（`capped`）。
- 実行結果は D1 の `md_runs`（下げた／失敗／とばした／翌日に回した）に残し、
  1日1回 Discord にまとめて通知する。直近の1行は `GET /status` の `md_last` で返し、
  画面に「前回：下げた 2件／失敗 1件／とばした 7件」と出す。
- **値下げCSV（これまでの方法）は予備として残す**。オンのときはボタンが
  「値下げCSVを書き出す（予備）」になり、押すと「二重に下がることがあります」の
  確認が先に出る。
- 自動値下げは**日次処理の最後**に回す（直前の取り込みで売値・数量・売れた日時が
  新しくなっているので、その値で判断できる）。
  手で動かすときは `POST /sync {"kind":"markdown"}`。

### 5. eBay のユーザートークンを取り直す（必要）

`ReviseFixedPriceItem` は**書き込み**なので、いまの読み取り専用のトークンでは
`Insufficient permissions` で失敗する。次の手順で `EBAY_USER_REFRESH_TOKEN` を
取り直す（スコープに `sell.inventory` を足す）。

1. eBay Developer Portal → Application Keys → **Production** の User Tokens →
   「Get a Token from eBay via Your Application」
2. OAuth のスコープに、いまのものに加えて
   `https://api.ebay.com/oauth/api_scope/sell.inventory` を入れる
   （Trading API の Revise 系はこのスコープで通る）
3. 自分の eBay アカウントで同意し、**refresh token**（18か月有効）を控える
4. `cd proxy-sync && npx wrangler secret put EBAY_USER_REFRESH_TOKEN` で入れ替える
5. `npx wrangler deploy` のあと、⚙設定の「自動値下げ」を**「予定だけ表示」**にして
   1日様子を見る（予定の件数と金額を確認）。よければ「オン」にする

### 確認したこと

```
Worker（Node＋node:sqlite・automd.mjs 47項目）
  write を付けない呼び出しは書き込めない ✅ ReviseFixedPriceItem だけ通る ✅
  AddFixedPriceItem は通らない ✅ 読み取りは今までどおり ✅
  開始$85・最低$60・10回 → 幅$2.50 ✅ $85 → $82.50 → …… → $60 で止まる ✅
  10回で下限に着く ✅ 着いた行はもう呼ばない ✅ 幅$1未満の行は$1 ✅
  自動拒否額は必ず新しい売値より下 ✅ 自動承諾額は売値以上の行だけ下げる ✅
  「予定だけ表示」では eBayへの呼び出しが0回・D1も変えない ✅
  値下げしない／一点物／セール中／数量0／無在庫／最低売値／幅未設定をとばす ✅
  間隔が空いていなければ下げない ✅
  失敗した行は売値・回数・値下げした時刻がそのまま＋理由を残す ✅
  1日の上限で翌日に回す ✅ md_runs と /status の md_last に結果が入る ✅
  オフなら1回も呼ばない ✅ POST /listings で幅を受け取る ✅
  開始価格が変わったら回数を0に戻す ✅
pj_price（実ブラウザ・automd.js 32項目）
  Amazon最安値が高い行は Amazon基準の開始価格 ✅ 取れていない行は仕入値基準 ✅
  無在庫は仕入値基準 ✅ 開始価格は最低売値より下にならない ✅
  「仕入値基準」を選べば今までの動き ✅
  幅＝（開始−最低）÷10・最低$1・$0.01単位 ✅ D1 に送る4項目がそろう ✅
  *StartPrice が開始価格・自動拒否額はその下 ✅
  オフでは帯を出さない ✅ 予定だけ表示で件数と一覧・前回の結果 ✅
  幅が未設定の行に「設定を送る」✅ 送ると md_* が入り表示も合う ✅
  オンでは値下げCSVが「予備」になり、押すと二重の確認 ✅
  行に「自動値下げ中」とその行の幅 ✅
回帰：tests/ の32本・971項目すべて ❌なし・pageerror なし ✅
```

**7.37 は Worker のデプロイと D1 の migrate-0016、eBay トークンの取り直しが必要。**

## 7.38 自動値下げの予定を一覧で確認する（2026-10-11・sw.js v137）

**7.37** で自動値下げを入れたが、「どの出品が、いつ、いくらに下がるのか」が
帯の件数だけでは分からなかった。一覧で日付ごとに追えるようにする。

### 1. 絞り込み「自動値下げの予定」

- 販売連携タブの絞り込みに **`自動値下げの予定（○件）`** を足した。
  対象は pj-sync が拾う行と同じ条件（`syncMdTarget`）＝
  **値下げ幅（`md_step`）と下限（`md_floor`）が入っていて、とばす理由が無い行**。
- この絞り込みのときだけ、**次の自動値下げ日が近い順**（今日の行が先）に並べ替える。
  pj-sync も `mark_at` の古い順に選ぶので、画面と同じ順で下がる。
- ⚙設定が「オフ」でも絞り込みは残す（どの行が対象になるかを先に見られる）。

### 2. 行の案内

```
[次の自動値下げ] 10/15　$47.65 → $46.65（あと3回・下限 $44.66）
```

- 日付は「今日」または `M/D`（前回の値下げ＋間隔。間隔が過ぎている行は「今日」）。
- 「予定だけ表示」のときは `※予定だけ（eBayは変えません）`、
  「オフ」のときは `※自動値下げはオフです` を添える。
- 出品CSVタブの行にも同じ案内を出す（販売連携の取り込みにある行だけ）。

### 3. 件数の内訳

```
自動値下げ：オン　次の自動値下げ予定：12件（今日 3件／3日以内 8件）　一覧で見る
```

- 「3日以内」は**今日を含む**（その日の23:59:59までで数える）。
- 「一覧で見る」を押すと絞り込みが「自動値下げの予定」に変わる。
- 今日の件数が1日の上限を超えるときは「上限 ○件を超えるぶんは翌日に回ります」。

### 4. 値下げCSV（これまでの方法）との住み分け

- 自動値下げが**オン／予定だけ表示**のときは、ボタンと件数を
  **`自動値下げ中：CSVで下げると二重になります（○件）`** にする。
- **件数は自動値下げの対象外の行だけ**（値下げ幅が未設定の行など）を数える。
  対象の行はCSVから外してあるので、押しても二重には下がらない。
  押す前にそのことを確認で出す。
- 「価格の操作」の見出しと⚙設定の件数は、これまでどおり**値下げの時期の全体**で出す。

### 5. eBayのセール中の行

**7.37** で pj-sync がとばしていた「eBayのセール中」（`ebay_sale=1`）を、
画面側の `syncMarkSkip` にも足した。値下げCSVでもその行は出さない
（セール価格と二重に下がるのを防ぐ）。

### 確認したこと

```
pj_price（実ブラウザ・automd.js 56項目）
  絞り込みに「自動値下げの予定（3）」✅ 幅が未設定・値下げしない・セール中は対象外 ✅
  今日 1件／3日以内 3件（3日以内は今日を含む）✅
  予定も一覧も「今日 → 明日 → 3日後」の順 ✅
  行に「次の自動値下げ 10/12 $47.65 → $46.65（あと3回・下限 $44.66）」✅
  「次の自動値下げ予定：3件（今日 1件／3日以内 3件）」＋「一覧で見る」✅
  値下げの時期2件のうち、CSVの対象は自動値下げの対象外の1件だけ ✅
  ボタンと案内に「自動値下げ中：CSVで下げると二重になります（1件）」✅
  「予定だけ表示」では「eBay はまだ変わっていません」を添える ✅
  オフなら今までどおり2件・帯は出さない・絞り込みは残る ✅
回帰：tests/ の32本・995項目すべて ❌なし・pageerror なし ✅
```

**7.38 は pj_price だけの変更（Worker・D1 の変更は無い）。**

## 7.39 売値の見直し：pj-sync から eBay に直接反映（2026-10-15・sw.js v146・D1 migrate-0018）

**7.37** の自動値下げと対になる仕組み。「売値の見直し」の対象のうち **値上げだけ** を
Cron（1日1回）で eBay に反映する。画面側の決まりは **6.47**。

### 1. 使う API（許可表に増えたのは1つだけ）

```
ALLOWED の EBAY_WRITE_CALLS = ["ReviseFixedPriceItem", "ReviseInventoryStatus"]
```

- **ReviseInventoryStatus**：売値（StartPrice）と数量（Quantity）だけを変えられる。
  **1回の呼び出しで4件**まで送れるので、件数が多くても呼び出し回数が1/4になる。
  ベストオファーの金額は変えられないが、上げる方向なので自動拒否額が売値以上に
  なることはなく、22003 の心配は無い（下げるときは従来どおり ReviseFixedPriceItem）。
- どちらも `net(..., {write:true})` を付けた呼び出しだけが通る。
  出品・終了・削除のAPIは通らない（見送りは**数量0**にするだけ）。
- 行ごとの成否は、応答に返る `InventoryStatus` の ItemID で見る。
  eBay は全件通ったときだけ `Ack=Success` を返すので、
  Warning / Failure のときは **返ってきた ItemID に無い行を失敗**として扱う。

### 2. 対象の決め方（`rvSkip` / `rvAct`）

```
とばす： ItemIDなし／eBayのセール中／数量0／目標が未設定／売値が不明
         ／推奨売値のほうが低い（下げは自動値下げに任せる）
         ／差がしきい値（$1 かつ 3%）より小さい／自動値下げの途中（md_done≧1）
例外　： 赤字（ebay_price < rv_floor）の行は、しきい値も値下げ中も見ずに上げる
見送り： rv_kind='skip' の行は数量0にする（数量0の行はとばす）
丸め　： 新しい売値 = min(rv_want, いまの売値 × (1 + 変更幅の上限))
```

### 3. モードと安全策（設定は `/settings` 経由で pj_price から）

| 設定 | 既定 | 動き |
| --- | --- | --- |
| `autoRvMode` | `confirm` | `off` … 何もしない／`confirm` … 予定を `sync_state.rv.plan` に残して Discord に出すだけ（**eBay を1回も呼ばない**）／`auto` … そのまま反映 |
| `autoRvMax` | 50 | 直近24時間に変えた件数（`rv_log` の `ok=1`）と合わせて上限を超えない。超えたぶんは翌日 |
| `autoRvPct` | 30 | 1回の変更幅の上限（%） |
| `csvReviewAbs` / `csvReviewPct` | $1 / 3% | 見直しのしきい値 |

- `POST /sync {kind:'review'}` … 設定どおり（確認モードなら予定だけ）。
- `POST /sync {kind:'review', approve:true}` … 販売連携タブの「まとめて実行」。
  確認モードでも、オフでも、**押したときは実行**する（人が承認したので）。
- Cron は毎日 UTC 18時台（JST 3時台）、`jobMarkdown` の**あと**に回す
  （下げた直後の売値を見て、赤字になった行だけ上げ直せる）。

### 4. 記録と通知

| 表 | 中身 |
| --- | --- |
| `rv_runs` | 1回＝1行。mode（confirm/auto/approve）・picked・changed・zeroed・failed・skipped・capped・note |
| `rv_log` | 1行＝1回の変更。**変更前後の売値**・kind（up/zero）・ok・理由 |
| `items.rv_fail` | 連続失敗の回数。3回以上は pj_price が「対応が必要」に出す |
| `items.rv_done_at` | 最後に反映した時刻 |

- Discord には1回の実行につき1通：確認モードは「変更の予定 n件＋承認の押し方」、
  実行したときは「上げた○件／数量0○件／失敗○件」と変更前後の売値（先頭10件）。
- 失敗した行は売値を進めず、理由を `revise_err` に残して**次の回に再試行**する。
  権限不足（スコープ違い）のエラーは、同じ失敗をくり返さないようその回で打ち切る。

### 5. 再調達中の行

反映した行が `restocking=1` なら、**出し直した売値**（`restock_price`）も新しい売値に
そろえる。**仕入値の上限**（`restock_max_cost`）は、目標どおり上げられた回だけ
`rv_max_cost` に入れ替える（変更幅の上限で丸めた回は、その売値に対する上限が
分からないので**前の値＝安全側**のまま残す）。

### 6. 受け入れの手順

1. `npx wrangler d1 execute pj-sync --remote --file=./migrate-0018-auto-review.sql`
2. `npx wrangler deploy`（`ALLOWED` に ReviseInventoryStatus が入るのはこのデプロイから）
3. pj_price の⚙設定で「売値の自動反映」を**確認モード**にし、
   販売連携タブで「見直しの目標を送る」→ 翌朝の Discord とタブの予定を見る。
4. 予定が妥当なら「まとめて実行」。問題がなければ「自動実行」に切り替える。
5. eBay の**在庫切れオプション**（Out of Stock）をオンにしておく
   （見送りの行を数量0にしたときに出品が終了しないようにするため）。

テストは `tests/autorv.mjs`（70項目）と `tests/autorv.js`（44項目）。
**Worker のデプロイと D1 の migrate-0018 が必要。**

## 7.40 作業者用のキー（STAFF_KEY・2026-10-16・sw.js v151）

知人と pj_price を共有するため、Worker のキーを**管理者用と作業者用の2本**にする。
作業者は出品の作業（英題・写真・取り込み・名簿）ができ、**値段は動かせない**。

### 1. キーと役割

| キー | 置き場所 | 役割 |
| --- | --- | --- |
| `PJ_ACCESS_KEY` | pj-title / pj-sync（`X-PJ-Key`） | `admin`。今までどおりすべて |
| `UPLOAD_TOKEN` | pj-img（`Authorization: Bearer`） | `admin`。今までどおり |
| **`STAFF_KEY`** | 3つの Worker すべて（同じ値） | `staff`。下の表のとおり |

- 3つの Worker に同じ `keyRole()`／`tokenRole()` を置き、**定数時間**でキーを照合する
  （`eqKey`：長さが違えば即 false、空は通さない）。
- `STAFF_KEY` を登録していなければ、これまでとまったく同じ動き（作業者キーは 401）。
- `PJ_ACCESS_KEY` と同じ値を `STAFF_KEY` に入れた場合は admin が優先される。

### 2. 作業者（staff）でできること・できないこと

| 操作 | admin | staff |
| --- | --- | --- |
| 英題の生成（pj-title `/titles` `/figure-titles`） | ○ | ○ |
| 写真（pj-img `/upload` `/list` `DELETE /i/...`） | ○ | ○ |
| 取り込み（`GET /status` `/runs` `/settings` `/orders/summary` `/catalog/check`） | ○ | ○ |
| 照会（`POST /lowest` `/cart-qty` `/catalog`） | ○ | ○ |
| 名簿の送信（`POST /listings`） | ○ | ○ |
| 設定の送信（`POST /settings`） | ○ | **403** |
| 手動実行・まとめて実行（`POST /sync`。`approve` も） | ○ | **403** |
| `/listings` に価格の設定（`md_step` `md_start` `md_floor` `md_n` `rv_want` `rv_floor` `rv_kind` `rv_max_cost`）が入っている回 | ○ | **403** |
| どちらのキーか（`GET /whoami`） | ○ | ○ |

```json
403 { "error":"forbidden_for_staff",
      "detail":"価格の設定（自動値下げ・見直しの目標）は管理者用のキーが必要です",
      "fields":["rv_want","rv_floor","rv_kind","rv_max_cost"] }
```

- 名簿と価格の設定は**同じ `/listings`** を使うので、**価格の項目が1件でも混ざって
  いたらその回ぜんぶを断る**（一部だけ書くと、どこまで入ったか分からなくなる）。
  名簿が送る項目（SKU・ItemID・手元在庫の印・実重量・仕入値・相場・値下げの記録）は
  そのまま通る。
- `GET /whoami` は `{ok:true, role:'admin'|'staff', staff_key_set:true}` を返す。
  **キーそのものは返さない**。

### 3. pj_price 側（6.52）

- 起動時と、キーの欄を変えたときに `/whoami` を聞いて役割を控える（`pj:role:v1`）。
- 作業者のときは `<body class="staff">` を付け、CSS で価格の欄とボタンを隠す。
- 聞けないとき（オフライン・キー未入力）は今までどおり admin として出す。
  **最後の砦は Worker（403）** なので、押しても価格は動かない。

### 4. 受け入れの手順

1. `cd proxy-sync && npx wrangler secret put STAFF_KEY`（pj-title・pj-img でも同じ値を登録）
2. 3つとも `npx wrangler deploy`
3. 管理者のキーで今までどおり動くことを確認（取り込み・設定の送信・まとめて実行）
4. 作業者のキーで：取り込み・名簿の送信・英題・写真ができ、
   設定の送信と「まとめて実行」が 403 になることを確認
5. 作業者の端末では⚙設定に価格の欄が出ないことを確認（画面にも案内が出る）

テストは `tests/staff.mjs`（40項目・3つの Worker をまとめて見る）。
**3つの Worker すべてデプロイが必要（D1 の変更は無い）。**

## 7.41 写真を eBay 保管（EPS）にする：調べるための窓口（2026-10-17・sw.js v154）

eBay アプリで価格を直すと**メイン画像だけ**エラーになる。pj-img（R2）の写真が
Self Hosted 扱いで、Revise のたびにギャラリー画像を取りに来るのが原因と見ている。
**この版では調べるための窓口だけ**を足す（出品の中身は変えない）。

### 1. 分かったこと（着手前の調査）

- **`UploadSiteHostedPictures`（Trading）は 2026-09-30 に廃止**された。
  eBay の案内する移行先は **Media API の `createImageFromUrl`**。
  → 預け先をこちらに変える（許可表にも Trading の写真APIは入れない）。
- Media API：`POST https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_url`
  （HTTPS のURLのみ・成功は **201**・`Location` に `.../image/{image_id}`）。
  `GET .../image/{image_id}` が **`imageUrl`（i.ebayimg.com）と `expirationDate`** を返す。
  **出品に使われない画像は期限で消える**（期限切れの取得は 404）。
- Trading API は OAuth の**スコープを使わない**建て付け（ユーザートークンを
  `X-EBAY-API-IAF-TOKEN` で渡す）。Media API（REST）は `Authorization: Bearer`。
  必要スコープは公式に確認できなかったので、**試し打ちの 403 で判断する**。

### 2. 足した窓口（どちらも管理者キーだけ）

| | 中身 |
| --- | --- |
| `GET /ebay/item?id=<ItemID>` | GetItem（読み取り）。`PhotoDisplay`・`PictureSource`・`GalleryURL`・`PictureURL`（全枚数）・`ExternalPictureURL` を返し、**1枚目（メイン）とそれ以降を分けて**出す。`main_is_eps` / `rest_all_eps` で「メインだけ自前」かどうかが一目で分かる。元のXMLも1,500字まで付ける |
| `POST /eps/test {url}` | ① R2 の写真をそのまま取って **状態・Content-Type・リダイレクトの有無・バイト数・縦横（長辺500px以上か）** を返す ② `createImageFromUrl` で預けて `image_id` → `getImage` で **i.ebayimg.com のURLと期限** を返す ③ **403 のときは eBay の本文をそのまま返す**（足りないスコープが分かる） |

- 許可表（`ALLOWED`）に足したのは3つだけ：`GetItem`（Trading の読み取り）、
  Media API の `create_image_from_url`（**書き込み**・`write:true` 必須）、
  `getImage`（読み取り）。加えて pj-img の写真URL（`https://…/i/YYYYMMDD/<uuid>.jpg`）を
  読み取りで取れるようにした。
- **出品を変える呼び出しは1回もしない**（テストで固定）。

### 3. 次（結果を見てから）

`POST /eps` 本体・CSV 書き出し前の EPS 化・販売連携の「写真を eBay 保管に切り替え」は、
**GetItem と試し打ちの結果を見てから**作る。確かめる点：
i.ebayimg.com のURLが **File Exchange の `PicURL`** と
**`ReviseFixedPriceItem` の `PictureURL`** の両方でそのまま使えるか／
期限（`expirationDate`）が何日か（CSVを書き出してから出品するまでの猶予として画面に出す）。

テストは `tests/epsdiag.mjs`（36項目）。回帰は47本・1,559項目すべて通った。
**pj-sync のデプロイが必要（D1 の変更は無い）。**

## 7.42 写真を eBay 保管（EPS）に切り替える（2026-10-18・sw.js v155）

7.41 の調べもので分かったこと（ItemID 880025406600 の実測）。

| | 実測 |
| --- | --- |
| `PictureURL` | 3枚とも `i.ebayimg.com`（URL の `MTYwMFgxMjAw` は `1600X1200`。**メインも含め3枚とも取り込めている**） |
| `PictureSource` | `Vendor`（eBay の台帳では「自前ホストの出品」のまま） |
| `ExternalPictureURL` | **メイン画像の R2 URL だけ1件** |

公式リファレンスどおりの状態で、自前ホスト出品では**ギャラリー画像（1枚目）の元の外部URLだけ**が
`ExternalPictureURL` に残り、残りは EPS の URL として `PictureURL` に入る。
つまり **1枚目だけ R2 に紐づいたまま**で、アプリの Revise がそこを取り直して失敗していた。
R2 側に非対称は無い（3枚とも同じ加工・同じパス・eBay は3枚とも 1600×1200 で取得済み）。

### 1. 直し方

`ExternalPictureURL` は `DeletedField` では消せない（出品時に入れた任意項目は revise で
削除できない）。**写真一式を EPS の URL で入れ替える**しか道がないので、
`POST /ebay/pics/switch`（管理者だけ）を足した。

| 方式 | 中身 |
| --- | --- |
| `reuse`（預け直さない） | いまの `i.ebayimg.com` の URL をそのまま送り直す。呼び出し3回で済む |
| `fresh`（預け直す） | 1枚ずつ Media API（`createImageFromUrl`）で作り直してから送る。**URL が変わるので eBay が必ず変更と認識する**。元画像は eBay に今ある写真なので、R2 の記録が無くても預け直せる |
| `auto`（既定） | `reuse` を試して、紐づけが消えなければ `fresh` に落とす。どちらで直ったかは `fixed_by` に入れて返す |

- `reuse` が空振りしうるのは、eBay が「同じ写真・同じ並び」を変更と認識しないため（KB 5091 の注意）。
  並びは変えない（1枚目＝メイン画像を入れ替えないため）。
- **送るのは `PictureDetails` だけ。** 価格・数量・タイトル・`PictureSource`・`ExternalPictureURL` は
  1つも送らない（テストで固定）。
- 自前ホストの写真が残っている出品は `reuse` では送らない（混在は `Error 20004` になる）。
- 前後で `GetItem` を1回ずつ呼び、`before` / `after`（枚数・紐づけの件数・`PictureSource`）を返す。
- 1回に送れるのは **5件**（`PICS_MAX`）。2件以上は `confirm:true` が必要。
  画面は5件ずつに小分けして送る。
- R2（pj-img）の写真は**消さない**（差し替えや再出品に使う）。

### 2. probe を直した（Cloudflare の 1042）

7.41 の `POST /eps/test` が R2 を 404 と報告したのは、**同じアカウントの workers.dev へ
Worker から fetch するとCloudflare が止める**ため（本文は `error code: 1042`＝17バイト）。
`[[services]] IMG_SVC → pj-img` のサービスバインディングを足し、pj-img の写真は
そちら経由で見るようにした（pj-img の配信コードをそのまま通るので、eBay が受け取るものと同じ）。
`/eps/test` は元画像に `i.ebayimg.com` も使えるようにした（`fresh` 方式の下調べ用）。

### 3. 分かっている制約

- Media API の画像は**30日で期限切れ**（実測：10/17 発行 → `2026-11-16T23:51:55Z`）。
  出品に使われている画像は消えないので、`fresh` で入れ替えた写真は期限で消えない。
- 新規出品（File Exchange の `PicURL`）に EPS の URL を入れてよいかは**公式の明記が無い**。
  PicURL は外部URLとして取り込んで再コピーする仕組みなので、1件で試して `GetItem` で
  確かめてから決める（A案）。空振りなら、CSV は今のまま R2 の URL で出し、
  出品後に上の切り替えを1回かける（B案）。

テストは `tests/picswitch.mjs`（36項目）と `tests/picswitch.js`（30項目）。
**pj-sync のデプロイが必要（`[[services]]` を足したので設定の変更も入る）。D1 の変更は無い。**

## 7.43 eBayのセール中の出品（2026-10-18・sw.js v159）

セール（Promotional Sale／Markdown Manager）中の出品は **eBay が値段の変更を拒む**
（エラー **21919248**）。これを「失敗」と数えると、人が直しようのない行が
「3回続けて失敗」に積み上がってしまう。

### 1. 失敗に数えない（4）

- `ReviseInventoryStatus` の応答から**行ごとのエラー**を取り出せるようにした。
  `Errors` の `ErrorParameters` に入っている ItemID でその行に結び付ける
  （4件まとめて送るので、取り違えると別の行をセール扱いにしてしまう）。
  ItemID で引けないときは、その回で失敗したのが1件だけなら全体の理由をその行の理由に使う。
- 21919248 の行は **`res.sale` に数え、`failed` には足さない**。
  `ebay_sale=1` を立て、`rv_fail` は増やさず、`revise_err` も残さない。
  `rv_log` には「セール中のため変えません（21919248）」と記録する。
- 自動値下げ（`ReviseFixedPriceItem`・1件ずつ）も同じ。値下げの回数も値段も進めない。
- 印が立っている間は `rvSkip` / `mdSkip` が「eBayのセール中」でとばすので、eBay に送らない（6）。

### 2. セールの中身を取る（5）

`GetMyeBaySelling` の `SellingStatus.PromotionalSaleDetails` から
**`OriginalPrice`（セール前の値段）** と **`EndTime`（終わる時刻）** を取り、
`ebay_sale_orig` / `ebay_sale_end` に残す（**migrate-0019**）。
STP/MAP の `DiscountPriceInfo` が付く出品もセール扱いにする。

- **いまの売値（`CurrentPrice`＝`ebay_price`）はセール後の値段**なので、
  利益と赤字の判定は今までどおり `ebay_price` で計算すればよい（直す必要は無かった）。
- `PromotionalSaleDetails` は返らないことがある（eBay 側の仕様変更の報告もある）。
  取れなかった行は画面に「セール前の値段は取れていません」と出す。
  値引き率は `1 − いまの値段 ÷ セール前の値段` で出すので、取れた行だけ出る。

### 3. セールが終わったら自動で戻す（4）

`ebay_sale` は `COALESCE` をやめ、ActiveList の取り込みで **そのまま入れ替える**。
セールが終わった回に 0 に戻り、値上げ・自動値下げの対象へ自動で戻る
（`ebay_sale_orig` / `ebay_sale_end` も一緒に消す）。
取り違えて印が立った行も、次の取り込み（毎時）で元に戻る。

テストは `tests/sale.mjs`（22項目）と `tests/saleui.js`（17項目）。
**pj-sync のデプロイと D1 のマイグレーション（migrate-0019-ebay-sale.sql）が必要。**

## 7.44 写真の切り替えは「預け直し」だけにする（2026-10-18・sw.js v160）

880025406600 で「預け直さない（reuse）」方式を試した結果、**写真が1枚落ちた**。

- 切り替え後、eBayアプリの編集画面から**メイン（1枚目）が消えていた**。
- 価格だけ変えて保存はできたが、落ちたメインをアプリで足すと
  `A mixture of Self Hosted and EPS pictures are not allowed.`（**Error 20004**）。
  → 出品は**自前ホスト扱いのまま**で、メインだけ落ちた状態。

**あとで分かったこと（7.45）**：出品は**何も変わっていなかった**（3枚・`PictureSource=Vendor`）。
同じ URL・同じ並びを送り返したので eBay が「変更なし」と見なし、KB 5091 の注意どおり
**空振り**しただけだった。アプリの編集画面でメインが見えなかったのは**表示だけの問題**。
それでも reuse は「変わらないのに done と判定しうる」ので、やめたままにする。

### 直したこと

1. **reuse 方式を削除**。`picSwitchOnce()` は**預け直し（fresh）だけ**になった。
   `mode` は受け取っても無視する（常に fresh）。
2. **枚数の見張り**。切り替えの後に `GetItem` で数え、
   **送った枚数より減っていたら「写真が減りました（前 3枚・送った 3枚 → 後 2枚）」**と返して
   `done:false` で止める（「できました」とは言わない）。
3. **写真を指定して入れ替えられるようにした**。`POST /ebay/pics/switch` に
   `urls:[…]`（pj-img か i.ebayimg.com のURL・最大24枚・**並べた順がそのまま写真の順**）。
   落ちたメインを元の R2 の URL から戻すときに使う。1件のときだけ指定できる。
   写真を指定したときは「すでに eBay 保管だけ」でも処理する（戻す作業のため）。
4. 自前ホストの写真が混ざった出品も、fresh なら**そのまま預け直して**切り替えられる
   （送るのは EPS の URL だけなので 20004 にならない）。

テストは `tests/picswitch.mjs`（38項目）と `tests/picswitch.js`（36項目）。
**pj-sync のデプロイが必要（D1 の変更は無い）。**

## 7.45 預け直しは「いちばん大きい版」から（2026-10-19・sw.js v161）

fresh で 880025406600 を試したところ、`ReviseFixedPriceItem` が **21919137（長辺500px未満）**
で失敗した（出品は変わらず3枚・Vendor のまま）。

**原因**：eBay の写真を元画像にするとき、URL の末尾が `$_1.JPG` のままだった。
`$_1` は**小さい版**で、Media API はその 400×300（URL の `NDAwWDMwMA==` ＝ `400X300`）を
取り込んでいた。1枚目（R2 から作ったもの）は 1600×1200 で問題なし。

### 直したこと

1. **`epsMaxUrl()`**：元画像が `i.ebayimg.com` のときは、末尾の `$_<数字>.JPG` を
   **`$_57.JPG`（最大サイズ）**に置き換えてから `createImageFromUrl` に渡す。
   pj-img（R2）の URL はそのまま渡す。
2. **`epsSize()`**：Media API が返した URL の `/s/<base64>`（＝`幅X高さ`）を読み、
   **長辺500px未満なら Revise を送らずに止める**
   （「写真が小さくなりました（400×300・長辺500px未満）。元の写真（pj-img）のURLを
   指定してやり直してください」）。預かった写真の大きさは結果にも出す。
3. **元の写真を優先**：pj_price は、その ItemID の行が出品リストに残っていれば
   **pj-img の写真の URL を `urls` で指定**して送る（6.61）。残っていない行だけ
   eBay の写真（`$_57`）から作り直す。

テストは `tests/picswitch.mjs`（47項目）と `tests/picswitch.js`（39項目）。
**pj-sync のデプロイが必要（D1 の変更は無い）。**

## 7.46 写真を eBay 保管にまとめて切り替える（2026-10-19・sw.js v162）

880025406600 で検証が通った。**fresh（$_57 から作り直し）で切り替え成功**し、
3枚とも 1600×1200・`PictureSource=EPS`・`ExternalPictureURL` なし・枚数 3→3。
切り替え後は eBayアプリで**価格の変更・写真の削除・追加・メインの入れ替え**が
すべてエラーなく保存できた（20004 も 21919137 も出ない）。

### 検証で分かったこと（大事）

1. **自前ホストの出品をアプリで保存すると、写真が消えることがある。**
   この出品は元々4枚で、切り替え前にアプリで価格を変えて保存したときに、
   **アプリに表示されていなかった Self Hosted の写真が1枚抜けたまま**保存され3枚になっていた。
2. **`ExternalPictureURL` ＝ 元のメイン とは限らない。**
   残っていた R2 の写真は箱の正面（メイン）ではなく側面だった。
   これを1枚目に足したため側面が2枚重なり、手で直すことになった。
   → **切り替えの元は `ExternalPictureURL` ではなく、pj_price の行が持つ写真
   （`r.pics`・並び順どおり・1枚目がメイン）を使う。**
3. Media API は、元が `i.ebayimg.com` のとき `$_57` にしないと 400×300 になる（7.45 で対応済み）。

### まとめての切り替え（この版）

- **切り替え済みの印**：通った出品に `pics_eps=1` / `pics_eps_at` / `pics_n`（切り替え後の枚数）を
  残す（**migrate-0020**）。印がある行は二度切り替えない。
  失敗した回は印を付けない。
- **一覧**：pj-img で出した出品は切り替えるまで `PictureSource=Vendor` のままなので、
  **出品中（数量1以上）で印が無い行**を「写真の切り替えが必要」として数え、
  画面の絞り込みに出す（GetItem を全行に打たずに済ませる。
  すでに EPS だけの行は、切り替えを押したときに「もともと」と返して印だけ付く）。
- **写真が抜けている出品**：`urls`（手元の写真）の枚数が eBay の今の枚数より多いときは
  `missing`（eBay の枚数）と `restore`（戻す枚数）を返し、画面に
  「写真が抜けていました（eBay 3枚／元 4枚）→ 4枚に戻しました」と出す。
- **手元に写真が無い出品**は、今の eBay の写真を `$_57` から作り直すだけ（**写真は足さない**）。
- 1回の上限は **10件**（`PICS_MAX`）。確認画面つき・管理者のみ。
  1件ごとに前後の枚数を比べ、減ったら止める仕組み（7.44）はそのまま。

### Media API の画像の期限（調べた結果）

- **出品に使われていない画像は約30日で消える**（eBay 2025年Q2のニュースレター：
  「30日以上どの出品にも使われていない EPS の URL は消される」）。
- **出品に使われた画像は、その出品が続くかぎり残る**。旧 Trading API のKBには
  「商品に紐づいた写真は、ほかの写真と同じ期間（出品終了日＋90日）保たれる」とある。
  Media API の新しい文書にはこの明記が無いので、**出品終了から90日以降は消える前提**で扱う。
- 対策：**R2（pj-img）の写真は消さない**（今までどおり）。再出品や差し替えのときは
  R2 から作り直す。説明文の中だけで使った写真は対象外になる点も変わらない。

テストは `tests/picswitch.mjs`（52項目）と `tests/picswitch.js`（42項目）。
**pj-sync のデプロイと D1 のマイグレーション（migrate-0020-pics-eps.sql）が必要。**

## 7.47 フェイズB：FBAで売れたら eBay を直す（2026-10-19・sw.js v166）

詳しい決まりは「販売連携フェイズB」の仕様書。ここには**実装したもの**を残す。

### 1. いつ・何を見るか（2章＋9章の確認で足したもの）

15分ごとの注文取り込みと、毎時の在庫取り込みのあとに `jobPhaseB()` が動く。
対象は `pbTarget()` が決める：出品中（数量1以上）・FBA販売可能0・入庫中0・手元在庫なし。
**次は対象外**：手元から発送する行（`-C`／`-L`）、無在庫、**再調達中**、
**eBayのセール中**（値段も数量も変えられない）、「今回は動かさない」、
**3回続けて失敗した行**、FBAの記録がまだ無い行。
予約済みは**顧客注文があるときだけ**「売れた」とみなし、FC移管・受領処理中だけなら対象外。
**内訳不明は動かさず**、いつから不明かを `pb_at` に残して**24時間たったら知らせる**。

### 2. まず全部「数量0」（承認待ちで古い売値のまま売れないように）

在庫0時の動作（`mode`）にかかわらず、**まず数量を0にする**。
`mode='restock'` かつ一点物でない行（`one_off_known=1`）だけ、数量0にしたうえで
`pb_act='restock'`（再調達の予定）を残す。**未設定・一点物・一点物が未確定は「寝かせる」**。

- 書き込みの**前**に `GetItem` で今の数量と売値を確かめ、判定時と違えば実行しない。
- 数量0の**直後**にも `GetItem` で `ListingStatus` を見る。`Active` でなければ
  「出品が終了しました（Out-of-stock control を確認してください）」と知らせる。
- `ReviseInventoryStatus` に `Quantity=0` を4件ずつ。**1回20件**まで。

### 3. 再調達（確認モード／自動）

承認（`POST /sync {kind:'phaseb',approve:true}`）か自動のとき、
**「売値を `pb_want` に変える＋数量を1に戻す」を1回の書き込み**で行う。
`pb_want` は **pj_price が計算して送る**（Worker は値付けの式を持たない）。

- 自動拒否額を使う出品（`ebay_bo=1`）は `ReviseFixedPriceItem`（売値＋数量＋ベストオファー）。
  それ以外は `ReviseInventoryStatus`（`StartPrice` と `Quantity` を1回で）。
- できないときは**数量0のまま**理由を残す：目標が届いていない／**24時間より古い**／
  最安グループが2人未満／Amazonに出品がない／下限利益を割る。
- 成功したら `restocking=1`・`restock_price`・`restock_max_cost` を入れ、予定を消す。
- **1日30件**まで（`pb_log` の当日の成功数で数える）。
- **数量を増やすのはこの再調達のときだけ。** ほかの処理では増やさない（テストで固定）。

### 4. 記録・通知・設定

- `pb_runs`（実行のまとめ）と `pb_log`（1行ごとの前後）に残す（**migrate-0021**）。
- 通知は**失敗と内訳不明は毎回、成功は1時間に1回まで**（`state` の `pb.okat`）。
- 設定は `pbMode`（off／**plan**／on）と `pbRestock`（**confirm**／auto）。既定は
  「予定だけ表示」「確認モード」。設定の保存先は既存の設定JSONなのでマイグレーション不要。
- 許可表（ALLOWED）の**追加は無い**。`ReviseInventoryStatus`・`ReviseFixedPriceItem` は
  書き込みとして、`GetItem` は読み取りとして登録済み。
- `GET /ebay/item` が**数量・売値・ListingStatus**も返すようにした（確認用）。
- `/listings` で `pb_want` / `pb_max_cost` / `pb_skip` を受け取る（**作業者キーでは送れない**）。

テストは `tests/phaseb.mjs`（54項目）と `tests/phasebui.js`（29項目）。
**pj-sync のデプロイと D1 のマイグレーション（migrate-0021-phase-b.sql）が必要。**

## 7.48 再調達中の売値を Amazon最安値に追従させる（2026-10-19・sw.js v170）

画面側の決まりは「CSV一括出品」6.70。ここには**Worker に実装したもの**を残す。

### なぜ別の仕組みにしたか

再調達中（`restocking=1`）の行は「売れてから Amazon で買い直す」ので、
**Amazon最安値が上がった瞬間に赤字が確定する**。これまでは
`jobReview`（売値の見直しの自動反映・7.39）に乗せていたが、そちらは
**値上げだけ・既定が確認モード・1回30%までの丸め**という歯止めを持っているため、
「再調達で赤字」の警告が出たまま**確認待ちで止まって**いた。
下がったときに追従する仕組みも無かった。

そこで `rvSkip()` に
`if (isRestocking(r)) return "再調達中（売値の追従が見ます）"` を足して
**`jobReview` の対象から外し**、この行だけを `jobRkPrice` が見るようにした
（同じ行を2つの仕組みが動かさないため）。

### 設定（`ui.settings` の `autoRkMode`）

| 値 | 動き |
| --- | --- |
| `auto`（既定） | Cron が**承認なしで**反映する |
| `confirm` | 予定を残して Discord に出すだけ。`POST /sync {kind:'restockprice',approve:true}` で実行 |

### `rkTarget(r)` — 何をするか

返すのは `{ kind, from, to, want, under, held, why }`。`kind` は
`'up'`／`'down'`／`'zero'`／`''`（とばす）。

対象外にする順（空の `kind` と理由を返す）:
再調達中でない → 出品していない → **eBayのセール中** → **一点物** → **無在庫** →
売値が分からない → **Amazon最安値が未取得** → **24時間より古い**。

そのあと:

1. 新しく見にいけたのに最安値が出ない（`restockLowest(r)` が 0、または
   `amazon_offers=0`）＝**Amazonの在庫が消えた**。買い直せないので
   `kind='zero'`（eBay の数量を0にする）。すでに数量0なら何もしない。
2. 数量0の行はとばす。`rk_want` が無い／`rk_want_at` が24時間より古い行もとばす。
3. `to = rk_want`。**下げる方向**のときだけ:
   - **最安グループ（`rk_n`）が2人未満**なら `held=true` で**下げを保留**
     （上げる方向は保留しない）。
   - `rk_floor` より下なら `to = rk_floor`、`under=true`。
4. 差が **$1未満 かつ 3%未満**ならとばす（`RK_ABS=1` / `RK_PCT=3`）。
   **1回の変更幅の丸めはしない**（赤字は一度で解消する）。

### `jobRkPrice(env, {approve})`

- 対象は `scope='ebay' AND restocking=1 AND ebay_item_id<>''` を
  `rk_at` の古い順に `RK_PICK_LIMIT=400` 件まで。
- **1日 `RK_MAX=30` 件**（`rk_log` の直近24時間の成功数で数える）。
  超えた分は `capped` として翌日に回す。
- 実行：**ベストオファーのある出品**（`ebay_bo=1`）は1件ずつ
  `ReviseFixedPriceItem`（`rkBo()` で `MinimumBestOfferPrice` を
  **最低売値、無ければ売値の1セント下**に。自動承諾額は新しい売値以上の行だけ下げる。
  **数量は送らない**）。それ以外は `ReviseInventoryStatus` を
  `RK_BATCH=4` 件ずつ（売値だけ／数量0だけ）。
- 通った行：`ebay_price` と **`restock_price`・`restock_max_cost` もそろえる**
  （そろえないと `restockTrouble()` の「再調達で赤字」が消えない）。
  `rk_fail=0`、`rk_done_at`、`revise_err` を消す。
- 失敗した行：`rk_fail+1`、`revise_err='再調達中の売値 …'`。
  **セール中のエラー（21919248）は失敗に数えず** `ebay_sale=1` を立てて外す（6.59 と同じ）。
  権限不足（`RV_SCOPE_ERR`）はその場で打ち切って知らせる。
- 記録：`rk_runs`（まとめ）と `rk_log`（1行ごと・前後の売値とそのときの最安値）。
  予定は `sync_state` の `rk.plan`。`GET /status` が `rk_plan` と `rk_last` を返す。
- 通知：Discord に「上げた n件／下げた n件／数量0 n件／失敗 n件」と、
  保留・上限・在庫消滅・連続失敗の件数、先頭10件の明細。

### Cron

日次（`DAILY_UTC_HOUR`）の `jobDaily`（最安値の取り直し）→ `jobMarkdown` →
`jobReview` のあとに `jobRkPrice` を回す。**最安値を取り直した直後の値**で判断する。
目標（`rk_want`）は pj_price が送るので、**1日1回はアプリで「状況を取り込む」を押す**
必要がある（24時間を超えた目標は使わない）。

### `POST /listings` で受け取る項目

`rk_want`／`rk_floor`／`rk_low`／`rk_n`／`rk_max_cost`。
受け取ると `rk_want_at` に時刻を入れ、`rk_want` が変わった行は `rk_fail` を0に戻す。
**`STAFF_DENY` に入れたので作業者用のキーでは送れない**（403・D1 には1件も書かない）。

テストは `tests/rkprice.mjs`（63項目）。
**D1（`migrate-0022-restock-price.sql`）とデプロイが必要。**

## 7.49 Amazon最安値を3時間ごとに取り直す（2026-10-19・sw.js v172）

### これまで（調べたこと）

| | 値 |
| --- | --- |
| 呼ぶ場所 | `syncPricing()` ← `jobDaily()` のみ |
| 頻度 | **1日1回**（cron `7 * * * *` のうち UTC 18:07＝JST 3:07 の回だけ） |
| 1回の行数 | **60行**（`PRICING_BATCH 20 × PRICING_MAX_CALLS 6 ÷ 2`） |
| 対象 | `scope='ebay' AND ebay_qty>0` |
| 並び | `restocking DESC` → 未取得 → `amazon_lowest_at` の古い順 |
| 要求 | 1行につき最大2件（その行の状態＋新品）＝最大120件 |
| 呼び出し | `getItemOffersBatch` を 20件×最大6回、10.5秒間隔 ＝ 約63秒 |

ほかに `POST /lowest`（出品CSVタブの手動取得・1回120行・**D1 には書かない**）と
`POST /sync {kind:'pricing'}`（手動実行）がある。

**問題**：出品が約1,500行あると**一周に約25日**かかる。いっぽう
再調達中の売値の追従（7.48）とフェイズBの再調達（7.47）は
**Amazon最安値が24時間以内**でないと動かない。
再調達中の行は `restocking DESC` で毎日先に取るので通るが、
**フェイズBの対象行（`fba_available=0`）は優先されず順番待ち**なので、
「Amazon最安値が未取得・古い」で予定に載らないことがほとんどだった。

### 直したこと

**再調達中の行とフェイズBの対象行だけ**を、`syncPricingHot()` で
**3時間ごと**に取り直す。ほかの行の頻度は変えない（日次のまま）。

```
scope='ebay' AND ebay_item_id<>'' AND ebay_qty>0
  AND (restocking=1
       OR (fba_available=0 AND on_hand=0 AND dropship=0 AND one_off=0))
```

- `fba_available` が **NULL（FBA未確認）の行は入れない**（`COALESCE(...,-1)=0`）。
- `pbTarget()` の細かい条件（予約済みの内訳・入庫中・セール中）までは見ない。
  少し広めに取るだけなので害がない。
- 並びは `amazon_lowest_at` の古い順（**まだ一度も取っていない行が最初**）。
- 1回 **`PRICING_HOT_MAX = 40` 行**まで。1行につき最大2件なので最大80件＝4回＝約42秒。

### Cron

毎時の cron の中で `getUTCHours() % 3 === 0`（UTC 0/3/6/9/12/15/18/21 時）のとき、
**`jobHourly` のあと・`jobPhaseB` の前**に回す。こうすると、
同じ実行の中でフェイズBと売値の追従が**取り直した直後の最安値**で判断できる。

UTC 18時台は日次（`jobDaily` → `syncPricing` 約63秒）と重なるので、
その回だけ約105秒になる。CPU 時間ではなく待ち時間（`sleep`）なので、
いまの63秒の回が動いている以上は収まる見込み。

### SP-API の上限

`getItemOffersBatch` は **0.1リクエスト/秒・バースト1**（口座×アプリ単位）。
1リクエストに20件まで入るので、理論上の1日の上限は **8,640回＝172,800件**。

| | 1日の呼び出し回数 | 上限に対する割合 |
| --- | --- | --- |
| これまで | 6回 | 0.07% |
| これから（8回 × 最大4回 ＋ 日次6回） | **最大38回** | **0.44%** |

`spSlot()` が `getItemOffersBatch` のレーンで10.5秒の間隔を守るので、
日次と重なる回も間隔は崩れない。

### 取り切れなかった件数

対象が `PRICING_HOT_MAX` を超えた回は、**取り切れなかった件数**を出す
（上限を上げる判断に使う）。

- `sync_state` の `pricing.hot` に
  `{at, picked（対象の総数）, rows（取り直した数）, left（残り）, max, wrote, warn_at}` を残す。
- `GET /status` が **`hot_pricing`** として返す。画面（6.72）が警告に出す。
- **Discord にも出す**。同じ知らせは `PRICING_HOT_WARN_MS = 24時間` に1回まで
  （3時間ごとに同じ知らせが流れないように）。画面の警告はいつでも出る。
- `POST /sync {kind:'pricing-hot'}` で手動実行できる（結果の `hot` に同じ内訳が入る）。

テストは `tests/pricinghot.mjs`（32項目）。
**pj-sync のデプロイが必要。D1 の変更は無い。**

## 7.50 Worker が為替レートを自分で取る（2026-10-19・sw.js v173）

### なぜ

値付けの式は為替（1ドル=円）を使うが、**これまで為替を取っていたのは
pj_price（ブラウザ）だけ**だった。Worker が自分で目標を計算する（7.51 で入れる）には
Worker 側にも為替が必要になる。
⚙設定に保存した値を使う手もあるが、それでは「アプリを開かないと古くなる」ので、
**Worker も同じ2つの公開APIから自分で取る**ようにした。

### 取り方

`fxGet(env, run, force)`。使う順番は次のとおり。

1. **KV の控えが新しい**（`FX_TTL_MS = 6時間` 以内）ならそれ（`from:'cache'`）
2. **APIから取り直す**（`from:'api'`）。取れたら KV に入れる
   - `https://open.er-api.com/v6/latest/USD` → `rates.JPY`
   - 落ちたら `https://api.frankfurter.app/latest?from=USD&to=JPY`
   - どちらも鍵が要らない。**許可表には読み取り（GET）だけ**を足した。
     パスと通貨まで固定してあるので、ほかのURLは通らない
3. 取れなければ **KV の古い控え**（`from:'stale'`。無いよりましなので使う）
4. それも無ければ **⚙設定の `fx`**（端末が送った値・`from:'settings'`）
5. それも無ければ **`FX_DEFAULT = 160`**（`from:'default'`）

**「Worker が取った値を正とする」**決まりなので、2 が成功すればそれを使う。
`50〜500円`（`FX_MIN`／`FX_MAX`。pj_price と同じ）の外の応答は捨てる。

控えの寿命を6時間にしたのは、為替が売値に直接入る数字で1日据え置きでは粗いため。
毎時の Cron から呼んでも**外への問い合わせは1日4回まで**になる。

### 窓口

- **`GET /fx`** … いま使う為替を返す（`rate` / `at` / `src` / `from` / `ttl_ms`）。
  `?force=1` で控えを無視して取り直す。**読み取りだけなので作業者のキーでも見られる**。
- **`GET /status`** … `fx` に **KV の控えをそのまま**出す。
  ここでは**外へ問い合わせない**（取り込みを遅くしないため）。控えが無ければ `null`。

画面（6.73）は⚙設定に「pj-sync が使う為替：1ドル=157.23円（自動取得）」を出し、
端末の値と1%以上ちがうときは注意を出す。

テストは `tests/fx.mjs`（28項目）。
**pj-sync のデプロイが必要。D1 の変更は無い。**

## 7.51 Worker も shared/pricing.js の式を使う（2026-10-20・sw.js v174）

画面側の決まりは「CSV一括出品」6.75／6.74。ここには**Worker に入れたもの**を残す。

### 読み込み

```js
import PRICING from "../shared/pricing.js";
```

`shared/pricing.js` は末尾で `module.exports` と `globalThis.PJ_PRICING` の
両方に入れているので、wrangler（esbuild）が CommonJS として取り込める。
**この repo にビルド工程が無い**ので、素の `<script src>` でも `import` でも
読める形にしてある。

> デプロイで `../shared/pricing.js` が解決できなければ、ファイルを
> `proxy-sync/pricing.js` に移し、index.html 側の `<script src>` も
> そちらに向ける（式が1か所であることは変わらない）。

### `pricingSettings(env, run)`

`/settings`（`ui.settings`）に pj_price が送った値（6.73）と、
Worker が自分で取った為替（7.50）から、`PRICING.settings()` に渡す
「設定オブジェクト」を作る。

- **為替は Worker が取った値を正とする**（設定の `fx` は使わない。
  `fxGet()` が取れなかったときだけ、その中で設定値まで落ちる）。
- **広告料率は `autoAdRate`（自動処理の広告料率・既定 `AUTO_AD_DEFAULT = 6`）**。
  eBayタブの `adRate` は送られてこないし、来ても使わない（6.74）。
- 足りない項目は `PRICING.DEFAULTS`。

### `GET /pricing`（確かめるための窓口）

`?cost=&weight=&flat=&price=` で、その場で計算して返す。出品の中身は変えない。

```json
{ "ok": true, "version": "1.0.0",
  "settings": { … }, "fx": { "rate": 160, "from": "api" },
  "auto_ad_rate": 6,
  "price": { "price": 73.27, "floor": 60.81, "be": 50.37, "zone": 4, "profit": 2194.08 },
  "target": 2194, "max_cost": 4903 }
```

**読み取りだけなので作業者のキーでも見られる。**
画面の金額と見比べて、両方が同じ式で動いていることを確かめるのに使う。

### この段ではまだ目標を計算しない

C段は「式が両方から読めるようになる」ところまで。
`rkTarget` / `pbTarget` / `rvAct` / `jobMarkdown` が目標を自分で計算するのは **D段**。
いまはまだ pj_price が送った `rk_want` / `pb_want` / `rv_want` / `md_*` を使う。

テストは `tests/pricing.mjs`（21項目）。
**pj-sync のデプロイが必要。D1 の変更は無い。**

## 7.52 Worker が目標を自分で計算する（2026-10-20・sw.js v175）

**D段**。これで「状況を取り込む」を押さなくても自動の処理が動く。

### これまで

自動の処理が使う目標（`rk_want` / `pb_want` / `rv_want` / `md_*`）は
**pj_price が計算して D1 に送った値だけ**だった。式が index.html の中にしか
無かったためで、**1日1回アプリを開いて「状況を取り込む」を押す必要があった**。
押さないと目標が24時間を過ぎ、「目標の売値が古い」で自動の処理が止まっていた。

### `selfTargets(S, r, now)` と `selfFill(env, run, rows)`

C段（7.51）と 6.76 で式を `shared/pricing.js` に出したので、Worker も
**D1 にある仕入値・重量・Amazon最安値と ⚙設定の値から自分で計算**できる。

| どちらを使うか | |
| --- | --- |
| pj_price が送った目標が **`WANT_FRESH_MS`＝30分以内** | **そちら**（画面で押した直後の操作を上書きしない） |
| それ以外（古い・入っていない） | **Worker が自分で計算した値** |

鮮度は項目ごとに見る（`rk_want_at` / `pb_want_at` / `rv_at`）。
自分で計算した行は、その時刻を「いま受け取った」ものとして入れ直す。

- 計算した値は **D1 に書き戻す**（画面の帯と `/status` に同じ数字が出るように）。
  変わった項目だけを書き、**1回 `SELF_WRITE_MAX`＝300行**まで（残りは次の回）。
- **`md_start` は、すでに入っている行では書き換えない。**
  書き換えると Worker 側の `md_done`（何回下げたか）が0に戻り、
  値下げの途中が巻き戻ってしまう（`/listings` の決まりと同じ）。
  下限（`md_floor`）と幅（`md_step`）は新しい設定で直す。
- 計算できない行（Amazon最安値が無い・売値が分からない）には**何も入れない**。

### 入れた場所

| 処理 | 行を引いたあと |
| --- | --- |
| `jobMarkdown`（自動値下げ） | `selfFill` で `md_*` を埋めてから `mdSkip` / `mdNext` |
| `jobReview`（売値の自動反映） | 目標が無い行も引くようにし、`selfFill` で `rv_*` を埋める |
| `rkPlanRows`（再調達中の売値の追従） | `selfFill` で `rk_*` を埋める |
| `jobPhaseB`（フェイズBの再調達） | `selfFill` で `pb_want` を埋める |

`jobReview` の抽出条件から `AND (COALESCE(rv_want,0)>0 OR rv_kind='skip')` を外した
（目標が入っていない行も Worker が計算するため）。

### `ITEM_COLS` に2列足した（不具合）

`prefix`（せどりすとSKU の接頭辞）と `sku_cost` は **`items` の列ではなく
`skus` から副問い合わせで引くもの**で、これまで `statusBody`（`/status`）だけが
引いていた。各処理が使う `ITEM_COLS` には入っていなかったので、
**Worker が自分で計算すると既定重量の振り分けを間違える**（接頭辞が分からず
ゲーム150g ではなくホビー400g になる）。仕入値の第3の出どころ（`sku_cost`）も
見えていなかった。両方を `ITEM_COLS` に入れ、`statusBody` 側の重複を消した。

### Cron 1回あたりの重さ（実測）

| | 値 |
| --- | --- |
| 1行あたりの計算 | **CPU 約0.31ms** |
| 400行 | **CPU 約124ms／実時間 約69ms** |
| Cloudflare Cron の CPU 上限 | 30秒（既定） |

いちばん重い回（毎時・UTC 18時台）でも、目標の計算は
`jobMarkdown`（2,000行まで）＋`jobReview`（2,000行まで）＋
`rkPlanRows`（400行）＋`jobPhaseB`（400行）で、**合計 約4,800行＝CPU 約1.5秒**。
上限30秒に対して**5%**。実時間はほとんどが SP-API / eBay の待ちで、
目標の計算そのものは誤差の範囲。

### これで何が変わるか

- **アプリを開かなくても**、自動値下げ・売値の自動反映・再調達中の売値の追従・
  フェイズBの再調達が、その時点の Amazon最安値と ⚙設定で動く。
- アプリで押した操作（目標を送る・印を変える）は**30分間優先**される。
- ⚙設定を変えたら、次の Cron から新しい値で計算される
  （設定は 6.73 で D1 に送っているため）。

テストは `tests/selftarget.mjs`（30項目）。
**pj-sync のデプロイが必要。D1 の変更は無い。**

## 11. 作業の進め方
1. 9章の確認結果を報告して止まる。
2. カジの判断（ロール申請、プラン、トークン取得）を受けて、Worker と D1 を実装する。必要なシークレットと `wrangler` コマンドの一覧を出す。
3. カジがデプロイしたら、10章の受け入れテストを行う。
4. pj_price に「販売連携」タブを追加し、sw.js のバージョンを上げて main に push する。

## 7.53 売れた値段で保ち、同じ値段で再出品する（2026-10-22・sw.js v176）

自動値下げの途中で売れた行は、**その値段が「売れる値段」だと分かった**ということ。
その値段で止め、数量0になった行は条件を満たすときだけ **同じ値段のまま数量1に戻す**。

画面側は 6.77。判定の式は `shared/pricing.js` の `skRelist()` に1か所だけ置いた
（画面と Worker が同じ式を読む。6.75 と同じ作り）。

### D1（`migrate-0023-sold-keep.sql`）

| 列 | 中身 |
| --- | --- |
| `sold_keep` | 売れた値段で保つ印（0/1） |
| `sold_price` | **保つのは出品価格**（落札額ではない）。売れた時点の `ebay_price` |
| `sold_kept_at` | 売れた日時（注文の日時） |
| `sk_act` / `sk_why` / `sk_at` | 再出品の予定（`relist` / 空）・理由・立てた日時 |
| `sk_done_at` | 実際に数量を戻した日時 |
| `sk_fail` | 続けて失敗した回数（3回で自動処理から外す） |
| `mw_low` / `mw_low_at` / `mw_n` / `mw_stock` | マッチングワールドの仕入れ値（いまは空。6.77 の `buySource` 用） |

テーブルは2つ足した。

- `sk_runs` … 1回ぶんの実行（`mode` `picked` `relisted` `failed` `skipped` `capped` `ended`）
- `sk_log` … 行ごとの記録（`asin` `cond` `item_id` `kind` `price` `buy_low` `buy_src` `ok` `why`）
  1日の上限は `sk_log` の `ok=1` の件数で数える。

### 印を立てるのは `jobOrders`

eBay の注文を取り込むところ（`jobOrders`）で、**初めて見た明細だけ**印を立てる。

```sql
UPDATE items SET sold_keep=1,
  sold_price=CASE WHEN COALESCE(ebay_price,0)>0 THEN ebay_price ELSE sold_price END,
  sold_kept_at=?3, sk_act=NULL, sk_why=NULL, sk_fail=0, updated_at=?4
WHERE asin=?1 AND cond=?2
```

`sold_price` は**そのときの出品価格**。注文の落札額ではない（送料や Best Offer で
下がった額を「売れる値段」とは呼べないため）。
2回目以降の取り込みで同じ明細を見ても上書きしない（`fresh` の判定は
これまでカート在庫を減らすときに使っていたものを、売れた行すべてに広げた）。

### 止まるところ（6.77 の穴①②）

| 関数 | 足した1行 |
| --- | --- |
| `mdSkip`（自動値下げ） | `if (Number(r.sold_keep)) return "売れた値段で保っています";` |
| `rvSkip`（売値の自動反映） | 同じ。**値上げも止まる** |

`mdSkip` に元からあった `mark_at` と `ebay_sold_at` の比べ方は、
v175 以前に売れた行のための保険として残してある
（`mark_at` が空の行は比べられず、**一度も値下げしていない行が止まらなかった**）。

### 再出品の判定（`shared/pricing.js` の `skRelist`）

上から順に見て、ひとつでも引っかかれば出さない（理由を `sk_why` に残す）。

| 見るもの | 出さない理由 |
| --- | --- |
| `sold_keep` / `ebay_item_id` / `ebay_qty>0` / `sold_price>0` | 印なし・未出品・数量あり・値段が分からない |
| `one_off` / `one_off_known` | 一点物・一点物かどうかが未確定 |
| `dropship` | 無在庫（いまは対象外） |
| `restocking` / `pb_act='restock'` | 再調達中（売値の追従が見る）・フェイズBの再調達の予定 |
| `ebay_sale` / `pb_skip` | eBayのセール中・今回は動かさない |
| `sk_fail>=3` | 続けて失敗（対応が必要） |

ここまで通ったら在庫を見る。

1. **`fba_available>0` / `on_hand` / `hand_qty>0` のどれかがあれば、仕入れ値は見ない**
   （手持ちで出せる）。
2. 無ければ仕入れ直す前提。`buySource()` の仕入れ値で、
   **売れた値段でも下限利益が残るか**を `maxCost()` で見る。
   - 在庫なし（取りに行って最安値が出なかった）→ 出さない
   - 未取得・24時間より古い → 出さない
   - `buy.low > maxCost` → 出さない（「仕入 90,000円 ＞ 上限 4,572円」）

### 実行（`jobSoldKeep`）

| 決めごと | 値 |
| --- | --- |
| `autoSkMode` | `confirm`（既定・予定だけ）／`auto`（承認なしで実行） |
| 1日の上限 `SK_MAX` | **30件**。再調達（フェイズB）とは**別枠**で、それぞれ30件 |
| 1回に送る数 `SK_BATCH` | `RV_BATCH` と同じ |
| 続けて失敗 `SK_FAIL_WARN` | 3回で自動処理から外す |

流れはフェイズBと同じ。

1. 候補を拾い（`SK_PICK_LIMIT=400`）、`skRelist` で判定して `sk_act` / `sk_why` を残す。
2. `confirm` のときは **ここで止める**（eBay は呼ばない）。予定は KV（`sk.plan`）に置き、
   `/status.sk_plan` で画面に出す。画面の「まとめて再出品」が
   `POST /sync {kind:'soldkeep',approve:true}` を送ってきたら実行する。
3. **書き込み前に `GetItem`**。数量が0でなければ戻さない（二重実行の防止）。
4. `ReviseInventoryStatus` に **`<Quantity>1</Quantity>` だけ**送る。
   **売値は送らない**（売れた値段のまま）。
5. **書き込み後に `GetItem`**。出品が終了していたら `ended` として通知する。
6. 成功 → `ebay_qty=1`・`sk_act` を消す・`sk_done_at`・`sk_fail=0`。
   失敗 → `sk_fail` を1つ増やし、理由を `sk_why` に残す。
   **セール中のエラー（`SALE_ERR`）は失敗に数えず**、`ebay_sale=1` を立てて対象から外す。

Cron は `*/15`（`jobOrders` → `jobPhaseB` のあと）と毎時に回す。

### 値下げを再開する（`POST /listings {sold_keep:false}`）

印を外すと同時に、**`mark_at` を空に・`md_done` を0に戻す**。

```sql
mark_at=CASE WHEN ?41=0 THEN NULL ... END,
md_done=CASE WHEN ?41=0 THEN 0 ... END,
```

つまり **売れた値段から、同じ幅で下げ直す**（それまでの回数は数え直し）。
`sk_act` / `sk_why` / `sk_fail` も消す。
`sold_keep` は `STAFF_DENY` に入れたので、作業者のキーでは 403。

### 仕入れ先（マッチングワールド）

`buySource()` が `stock`（仕入れ先に在庫があるか `true`/`false`/`null`）を持つ。
`mw_low` / `mw_low_at` / `mw_n` / `mw_stock` を埋める取り込みを1本書けば、
`'auto'` が取れているうちの安いほうを選ぶ。詳しくは 6.77。

### あとから印を付ける（一度だけ・`backfill-0023-sold-keep.sql`）

印を立てるのは `jobOrders` が「**初めて見た明細**」だけなので、v176 を入れる前に
売れた行には遡って付かない。直近30日ぶんを埋めるスクリプトを置いた。

保つ値段は **`items.ebay_price`（いまの出品価格）**。注文の落札額は使わない。
数量0の行は `mdSkip` も `rvSkip` も「数量0」で返して触らないので、
`ebay_price` は**売れた時点の出品価格のまま**残っている。

次の行は外す（印を立てても再出品できず、絞り込み「対応が必要」を埋めるだけになる）。

- 一点物（`one_off=1`）・一点物かどうかが未確定（`one_off_known=0`）
- 無在庫（`dropship=1`）・再調達中（`restocking=1`）
- すでに印が立っている行・出品していない行・売値が分からない行

テストは `tests/soldkeep.mjs`（58件）と `tests/soldkeepui.js`（画面71件）。

## 7.54 一点物・無在庫には印を立てない（2026-10-22・sw.js v177）

7.53 で `jobOrders` が**売れた明細すべて**に `sold_keep` を立てていた。
そのため一点物が売れるたびに、絞り込み「対応が必要」に
「売れた値段で保っています／再出品できません：一点物」として並んでいた。

一点物は数量0になった時点で値下げも値上げも止まっている（`mdSkip` が先に
「一点物」を返す）ので、**印そのものに意味がない**。根元で立てないようにした。

### 判定は1か所（`shared/pricing.js` の `skKeepOff`）

```js
function skKeepOff(r) {
  if (Number(r.one_off || 0)) return "一点物";
  if (Number(r.dropship || 0)) return "無在庫（いまは対象外）";
  return "";
}
```

印を立てる側（`jobOrders` → `skStampOff`）と、再出品の判定（`skRelist`）が
**同じこれを読む**。`skRelist` にあった `one_off` / `dropship` の2行は
`skKeepOff` に寄せた。

**マッチングワールドの取引を始めたら、`skKeepOff` の `dropship` の1行を消すだけで
無在庫が対象に戻る。ほかに手を入れる場所は無い。**

### 一点物かどうかが未確定の行は立てる

`one_off_known=0` の行は**今までどおり印を立てる**。
再出品の理由を「一点物かどうかが未確定」から
**「一点物か確認してください」**に変えて、人に決めてもらう形にした。
この行は絞り込み「対応が必要」に出る（出てほしい行なので）。

### `skStampOff`（Worker 側）

```js
function skStampOff(row, line) {
  const r = row || {};
  return PRICING.skKeepOff({
    one_off: r.one_off, one_off_known: r.one_off_known,
    dropship: Number(r.dropship || 0) || ((line && line.dropship) ? 1 : 0) });
}
```

無在庫は SKU のラベルからも分かるので、`items` にまだ行が無い**初回の販売**でも
拾えるように D1 の値と重ねて渡す。ここは値を集めるだけで、
「何を外すか」は決めていない（決めているのは `skKeepOff` だけ）。

`jobOrders` は印を立てる前に、初めて見た明細の行の
`one_off` / `one_off_known` / `dropship` を40件ずつ引いて `skStampOff` に渡す。
外した行は `run.notes` に `sk_skip <asin>|<cond> <理由>` として残す。

### すでに立ってしまった印

v176 を動かしていた間に一点物・無在庫の行に印が立っていれば、
一度だけ外す（`sk_done_at IS NULL` の行だけ。すでに再出品した行は eBay の数量が
戻っているので印も残す）。

```sql
UPDATE items SET sold_keep=0, sold_price=NULL, sold_kept_at=NULL,
  sk_act=NULL, sk_why=NULL, sk_fail=0
WHERE sold_keep=1 AND sk_done_at IS NULL
  AND (COALESCE(one_off,0)=1 OR COALESCE(dropship,0)=1);
```

テストは `tests/soldkeep.mjs`（67件）と `tests/soldkeepui.js`（画面72件）。

## 7.55 SELECT は読む列だけにする（D1 の100列・2026-10-22・sw.js v178）

v176 のデプロイ後、「状況を取り込む」が次のエラーで失敗した。

```
HTTP 500 server_error
D1_ERROR: too many columns in result set: SQLITE_ERROR
```

### 原因

D1 は**1つの結果に100列まで**しか返せない。

| | 列数 |
| --- | --- |
| `items` の実列 | **100列**（`migrate-0023` で88→100） |
| `ITEM_COLS` の結果列 | **102列**（全列＋`prefix`・`sku_cost` の副問い合わせ2つ） |
| `GET /status` | **104列**（上に `ebay_sold`・`ebay_sold_at` を足していた） |

`ITEM_COLS` は「items の全列を並べる」形だったので、
**`migrate-0023` で12列足した時点で上限を超えた**。
`ITEM_COLS` を使う問い合わせは**すべて**失敗していた。

| 失敗していた場所 | 列数 | いつ動く |
| --- | --- | --- |
| `GET /status`（状況を取り込む） | 104 | 画面から |
| `itemsByKeys` → `jobOrders` の状態イベント・`jobHourly` | 102 | `*/15`・毎時 |
| `restockWatch`（再調達の見張り） | 102 | 毎時 |
| `jobMarkdown`（自動値下げ） | 103 | 日次 |
| `jobReview`（売値の自動反映） | 102 | 日次 |
| `rkPlanRows` → `jobRkPrice`（再調達中の売値） | 102 | 日次 |
| `skPlanRows` → `jobSoldKeep`（売れた値段で再出品） | 102 | `*/15`・毎時 |
| `jobPhaseB`（数量0・再調達／再調達の確認） | 102 | `*/15`・毎時 |

落ちていなかったのは、列を絞って引いている処理だけ
（`syncPricingHot` と `syncPricing` は `SELECT asin, cond`、
`/status` の件数は `COUNT(*)` の14列、注文の取り込み自体は `orders` の列）。
つまり **eBay/FBA の取り込みと最安値の取得は動いていたが、
そこから先の「判断して eBay を変える処理」が全部止まっていた**。

### 直し方

`SELECT` は**読む列だけ**にして、2つに分けた。

| | 列数 | 中身 |
| --- | --- | --- |
| `ITEM_COLS` | 81 | 自動処理（Cron のジョブ）と `shared/pricing.js` が読む列 |
| `STATUS_COLS` | 84 | `/status` が画面に返す列（画面と `shared/pricing.js` が読む列） |

`prefix` と `sku_cost` の副問い合わせは `SKU_COLS` にまとめて両方に足す。

- `/status` は `STATUS_COLS` を使う（＋`ebay_sold`・`ebay_sold_at` で **86列**）。
  自動処理だけが読む列（`fba_link` `pb_at` `pb_want` `pb_max_cost` `pb_want_at`
  `rv_at` `updated_at`）は画面に返さない。
- `jobMarkdown` は `ITEM_COLS`＋`ebay_sold_at` で **82列**。
- **書くだけの列は並べない**（SQL の `SET` や `WHERE` は結果の列数に関係しない）。
  外したのは11列：`ebay_currency` `ebay_seen_at` `amazon_new_at`
  `pics_eps_at` `pb_why` `pb_done_at` `rv_done_at` `rk_at` `rk_done_at` `sk_at`
  `sk_done_at`。
- `ebay_bo_decline` は画面の JS では読んでいないが、ベストオファーの設定を
  そろえて返す決まりなので `STATUS_COLS` に残した
  （`tests/pricesrc.mjs` が固定している。自動処理は読まないので `ITEM_COLS` には無い）。

### テスト（`tests/d1cols.mjs`）

列が増えても上限に当たらないよう、2つを固定した。

1. **列数が上限より十分少ないこと。** `D1_COLS_WARN = 90`（上限100に10列の余裕）。
   実際に使う形（`ITEM_COLS` / `＋ebay_sold_at` / `/status`）を
   `schema.sql` を読み込んだ SQLite で組み立てて数える。
   さらに `worker.js` の `SELECT` を**全部**（35本）当てはめて数え、
   90列を超えるものが1本も無いことを見る。
2. **読む列が落ちていないこと。** `shared/pricing.js`・`index.html`・`worker.js` が
   行から読む列名（`r.col` / `x["col"]`）を数え上げ、それぞれのリストに
   入っていることを確かめる。外した12列がどこからも読まれていないことも見る。

列を足すと①で落ち、読む列を消すと②で落ちる。

## 7.56 Discord と /runs の文言も「在庫補充」にそろえる（2026-10-23・sw.js v179）

6.78 の言い換えに合わせて、Worker が出す文言もそろえた。
**動きは何も変えていない**（`kind:'soldkeep'`・`kind:'relist'`・`sk_*` の
列名はそのまま）。

| 出どころ | 前 | いま |
| --- | --- | --- |
| Discord（確認してから） | 🔁 売れた値段で再出品（確認してから）：予定 n件 | 🔁 在庫補充（数量を1に戻す・確認してから）：予定 n件 |
| Discord（押し方の案内） | 販売連携タブの「売れた値段でまとめて再出品」を押すと実行します | 販売連携タブの「在庫補充（数量を1に戻す）」を押すと実行します |
| Discord（実行後） | 🔁 売れた値段で再出品しました | 🔁 在庫補充しました（売れた値段のまま数量を1に戻した） |
| Discord（件数） | 再出品 n件／失敗 n件／とばした n件 | 補充 n件／失敗 n件／とばした n件 |
| `sk_why`（成功） | 売れた値段 $52.16 で再出品しました | 売れた値段 $52.16 のまま数量を1に戻しました |
| `sk_why`（失敗） | 再出品できません：… | 在庫を補充できません：… |
| `sk_why`（セール中） | eBayのセール中のため再出品しません | eBayのセール中のため在庫を補充しません |
| `revise_err` | 売れた値段での再出品 … | 在庫補充（数量を1に戻す） … |
| `/runs` の記録 | 売れた値段で再出品：n件／… | 在庫補充：n件／… |
| `/runs`（確認してから） | n件が再出品の候補 | n件が在庫補充の候補 |
| `/runs`（0件） | 再出品する出品はありません | 在庫を補充する出品はありません |

`shared/pricing.js` の `skRelist` が返す理由も変えた
（「手持ちの在庫で出せます」→「手持ちの在庫で補充できます」、
「仕入れ直して出せます」→「仕入れ直して補充できます」）。
この文字列は画面の行と `sk_why` の両方に出るので、1か所変えれば両方そろう。

## 7.57 行ごとの写真を1回で受け取り、Discord に注意を出す（2026-10-23・sw.js v180）

6.79 の画面側に合わせた Worker の変更。

### `POST /ebay/pics/switch` に `items` を足した

```json
{ "items": [ { "item_id": "880000000001", "urls": ["https://pj-img…/a.jpg"] },
             { "item_id": "880000000002", "urls": ["https://pj-img…/b.jpg"] } ],
  "confirm": true, "notify": true, "fresh": true }
```

これまでは `item_ids`（複数）と `urls`（1件のときだけ）だったので、
**行ごとに違う写真**を渡すには1件ずつ投げるしかなかった。
出品した直後はまとめて切り替えたいので `items` を足した。

- 上限は `PICS_MAX`（10件）。2件以上は `confirm:true`
- `urls` を省いた行は、いまの eBay の写真を作り直すだけ
- `item_ids` と `urls` の形は今までどおり動く（`items` があればそちらを使う）
- 使える写真のURLの決まりは `picsUrlOk()` に1か所だけ置いた

### `notify:true` で Discord に出す（`picsNotifyText`）

```
🆕 出品しました（2件）：写真を eBay 保管に切り替えました 1件／できなかった 1件
✅ サクラ大戦（通常版）（880000000001・写真 3枚）
⚠️ ドラゴンクエスト（880000000002）：写真が減りました（前 3枚・送った 3枚 → 後 2枚）
できなかった分は**まだ切り替え待ち**です。販売連携タブの「写真を eBay 保管に切り替え」でやり直してください
⚠️ 切り替えが済むまで **eBayアプリで編集しないでください**（自前ホストの写真のまま保存すると、メイン画像が抜けます）
```

- **最後の注意は必ず付ける**（成功しても失敗しても）
- `fresh:true` のときは「🆕 出品しました」、そうでなければ「🖼 写真の切り替え」
- 写真が抜けていて戻した行は「⚠ 写真が抜けていたので n枚に戻しました」を添える
- 1回の呼び出しで**1通だけ**（`items` でまとめて送るのはこのため）

### `GET /ebay/item` でも写真の枚数を控える

`jobGetItem` が、見に行ったついでに `pics_n` を D1 に書く。
eBay 保管だけになっていれば `pics_eps` と `pics_eps_at` も付ける。

画面は「eBay の枚数 < 出品リストの枚数」で「写真が抜けています」を出すので（6.79）、
`pics_n` が新しいほど見つけやすくなる。
`pics_eps_at` を `STATUS_COLS` に足して、いつ確かめた枚数かを画面に出せるようにした
（`/status` は 86→87列。上限100・警告線90に収まっている）。

テストは `tests/picswitch.mjs`（77件）と `tests/picsnow.js`（画面34件）。

## 7.58 22003 を直してやり直す・失敗の理由を通知に出す・時刻を日本時間に（2026-10-23・sw.js v183）

### ① なぜ 22003 で10件失敗したのか

10/22（JST）の自動値下げの失敗16件の内訳は
**22003 が10件・21919137 が5件・10007 が1件**。

22003 は「**自動拒否額（MinimumBestOfferPrice）が新しい売値以上**」。
`mdBo()` は自動拒否額を一緒に送る作りになっていたが、送る条件が
`Number(r.ebay_bo || 0)` だった。

```js
function mdBo(r, next) {
  if (!Number(r.ebay_bo || 0)) return { min: 0, acc: 0 };   // ← ここで諦めていた
```

`ebay_bo` を埋めているのは `GetMyeBaySelling`（出品の一覧）で、
`BestOfferDetails/BestOfferEnabled` を読んでいる。
**ところがこのAPIは BestOfferDetails を返さないことがある**。
返ってこないと `bo: null` → `COALESCE(?13, ebay_bo)` で**前の値（0 や NULL）のまま**。

その結果、

1. eBay 側では**ベストオファーが有効**で、自動拒否額が前の売値に合わせて入っている
2. D1 の `ebay_bo` は 0 なので `mdBo` は `{min:0, acc:0}` を返す
3. `ReviseFixedPriceItem` に `ListingDetails` を付けず、**売値だけ**下げる
4. eBay は「自動拒否額（古い・高い）≧ 新しい売値」で 22003 を返す

**本当のベストオファー設定は `GetItem` でしか分からない**。

### ② 22003 が返ったら、その場で直して1回だけやり直す

`boRetry()` / `reviseFix()` を追加した。

1. `GetItem` で本当の設定を取る（`BestOfferDetails` と `ListingDetails`）
2. `boBelow(price, floor, got)` で**新しい売値より必ず下**の額を作る
   - 自動拒否額 … 最低売値（あれば）。売値以上になるなら「売値 − $0.01」
   - 自動承諾額 … **いまの設定が売値以上のときだけ**「売値 − $0.01」に直す
     （売値より下なら触らない。人が決めた値を勝手に動かさない）
3. `ReviseFixedPriceItem` で**1回だけ**やり直す
4. 取れた設定（`ebay_bo` / `ebay_bo_accept` / `ebay_bo_decline`）を **D1 に控える**
   → 次回は最初の1回で通る（`GetItem` を呼ばない）

直せなかったとき（売値が小さすぎて下に置けないなど）は、
今までどおり失敗として理由を残す。

### ③ 共通にした（4つの処理）

| 処理 | 1回目 | 22003 のとき |
| --- | --- | --- |
| 自動値下げ | `ReviseFixedPriceItem` | `reviseFix` が中でやり直す |
| 売値の自動反映 | `ReviseInventoryStatus`（まとめて） | 行ごとに `boRetry` で `ReviseFixedPriceItem` に切り替え |
| 再調達中の売値 | 両方（`ebay_bo` で分岐） | `reviseFix` と `boRetry` |
| フェイズBの再調達 | 両方（`ebay_bo` で分岐） | `reviseFix` と `boRetry` |

`ReviseInventoryStatus` は**ベストオファーを送れない**ので、そちらで 22003 が出た行は
`ReviseFixedPriceItem` に切り替えてやり直す。
直った行は成功として数え、Discord に「自動拒否額を直してやり直した n件」を出す。

### ④ 写真が小さい行は値下げの対象から外す

`mdSkip` に1行足した。写真を入れ替えるまで何度やっても同じ失敗になるため。

```js
if (PIC_ERR.test(String(r.revise_err || ""))) return "写真が小さい（要撮り直し）";
```

写真を切り替えると（`jobPicSwitch` が成功すると）`revise_err` の写真のエラーは消えるので、
**自動的に対象へ戻る**。画面では絞り込み「写真が小さい（要撮り直し）」に出る（6.82）。

### ⑤ 一時的なエラーは失敗の回数に数えない

`TEMP_ERR`（`10007` System error など）は、人が直すものではないので
**3回で自動処理から外す「連続失敗の回数」には数えない**
（`rv_fail` / `rk_fail` / `pb_fail` / `sk_fail` を増やさない）。
その日の「失敗 n件」には今までどおり数え、Discord に
「一時的なエラー n件は次回やり直します」と出す。

### ⑥ Discord に失敗の理由の上位3つを出す

`whyKey()` でコードごとにまとめ、`whyTop()` が多い順に3つ返す。

```
🏷️ 自動値下げ（3日ごと）
下げた 134件／失敗 16件／とばした 52件
ベストオファーの自動拒否額を直してやり直した 10件（22003）
写真が小さくて対象外 5件（絞り込み「写真が小さい（要撮り直し）」で撮り直してください）
失敗の理由：コード 22003：Auto decline amount cannot be … 10件／コード 21919137：… 5件／コード 10007：System error 1件
（2026-10-23 22:30 日本時間）
```

自動値下げ・売値の自動反映・再調達中の売値・フェイズB・在庫補充の**すべて**に入れた。

### ⑦ 時刻を日本時間にそろえる

- **Discord** … どの通知も末尾に「（2026-10-23 22:30 日本時間）」を付ける（`notify` で1か所）
- **`/runs`** … `started_jst` / `finished_jst` を足す。
  `started_at` / `finished_at` は**保存している UTC のまま**返す（機械が読む値は変えない）
- **`GET /ebay/item`** … ベストオファーの設定（`bo.on` / `bo.min` / `bo.acc`）を返し、
  D1 にも控える。22003 の調べ物に使える

D1 に入れる時刻は今までどおり UTC（`nowIso()`）。**出すときだけ**日本時間に直す。

テストは `tests/boretry.mjs`（38件）と `tests/syncbox.js`（画面51件）。

## 7.59 写真の大きさを確かめて「写真が小さい」の記録を消す（2026-10-23・sw.js v184）

178566364009（Unicorn Overlord）を eBayアプリで 1600×1200 に差し替え、
`GetItem` でも EPS・1枚・1600×1200 になったのに、行には
「写真が500px未満：差し替えが必要」が残り、絞り込みからも外れなかった。

### 原因

写真が原因で弾かれた記録（`revise_err` の 21919137）を消すきっかけが
**「切り替えが成功したとき」だけ**だった（7.58）。
すでに eBay 保管だけになっている出品は切り替える必要がないので
`skipped` で通り抜け、記録が残ったままになる。
そもそも**写真の大きさを見ていなかった**。

### 写真の大きさは GetItem だけで分かる

eBay 保管（`i.ebayimg.com`）の URL は `/s/` に「幅X高さ」が base64 で入っている。
`epsSize()`（7.45 で作ったもの）で読める。

`getItemPics` が返す `pictures` に足した。

| 項目 | 中身 |
| --- | --- |
| `sizes` | 1枚ごとの `{url, w, h, long, ok, known}` |
| `min_long` | 分かっている写真の**長辺の最小** |
| `small_n` | 長辺が `PIC_OK_MIN`（500px）未満の枚数 |
| `unknown_n` | 大きさが分からない枚数（自前ホストの写真） |
| `all_big` | `n>0` かつ `small_n===0` かつ `unknown_n===0` |

**`all_big` は「全部の大きさが分かっていて、どれも足りている」ときだけ true**。
1枚でも分からない写真があれば true にしない（分からないものを「大丈夫」とは言わない）。

### 消すきっかけを3つにした（`picErrClear`）

| きっかけ | いつ |
| --- | --- |
| `GET /ebay/item` | 1件調べたとき |
| `POST /ebay/pics/switch` | 1件お試し・まとめて切り替え（**切り替えが要らなかった行も**） |
| `POST /sync {kind:"picscheck"}` | まとめて確かめ直す（下） |

どれも `all_big` のときだけ消す。写真以外の失敗（22003 など）は消さない。
消すと「写真が小さい（要撮り直し）」の一覧から外れ、
`mdSkip` の対象外からも外れる（＝自動値下げに戻る）。

画面には切り替えの結果に
「写真の長辺 最小 1600px（500px未満 0枚）」と
「✅ 写真が全部500px以上になったので、「写真が小さい」の記録を消しました」を出す。
その場で端末の控えからも消すので、取り込み直さずに一覧から外れる。

### まとめて確かめ直す（`POST /sync {kind:"picscheck"}`）

写真の記録が残っている行を順に `GetItem` で確かめる。

- 1回 `PICS_CHECK_MAX`（60件）まで。`limit` で減らせる。残りは `left` で返す
- 直っていれば**記録を消し**、`pics_n` も新しくする
- まだ小さい行は、いまの大きさを添えて返す（撮り直す対象が分かる）
- 返す行ごとの中身：`asin` `cond` `item_id` `name` `n` `min_long` `small_n`
  `unknown_n` `eps_only` `sizes`（`1600x1200` の並び）`err_at`（日本時間）`state`
- `state` は「直っています（記録を消しました）」「まだ小さい（撮り直しが必要）」
  「大きさが分かりません（自前ホストの写真）」「確かめられません」
- Discord にも結果と、まだ小さい行の大きさを出す

テストは `tests/picswitch.mjs`（77→97件）。

## 7.60 MW の在庫を `mw_stock` に置く・JANごとに1つ選ぶ（段取り A・2026-10-25・sw.js v186）

6.85 の受け口。MW の在庫CSVを `mw_stock` に**差分で**書き、JAN ごとに仕入れ先を1つ選ぶ。

### `mw_stock`（`migrate-0024-mw-stock.sql`）

主キーは**連番**（`id`）。同じ JAN が複数の社から出るので、
`UNIQUE(jan,sha,idx)` で行を見分ける（`idx` は同じ `(jan,社)` の出てきた順）。

| 列 | 中身 |
| --- | --- |
| `jan` `sha` `idx` | JAN（13桁）・社・同じ `(jan,社)` の何番目か |
| `kishu` `name` `list_price` `release` `cond` `wholesale` `stock` `note` | CSV の中身 |
| `ship_text` `ship_days` | 出荷日の原文と、営業日数（6.85 の規則。読めなければ 99） |
| `row_hash` | 上の中身の FNV-1a。**変わっていない行を書き直さない**ため |
| `pick` | JAN ごとに選ばれた1行だけ 1 |
| `seen_at` `gone_at` | 最後に CSV にあった時刻／CSV から消えた時刻（UTC） |

索引は `idx_mw_key(jan,sha,idx)` `idx_mw_jan` `idx_mw_seen` `idx_mw_pick` `idx_mw_kishu`。
取り込みの記録は `mw_runs`（`rows_in` `added` `changed` `same` `gone` `back` `picked` `unreadable` `warn`）。

### `POST /mw/stock`（`mwStockPut`）

画面が 400行ずつ送る。`{at, part, parts, rows, rows_in, unreadable}`。
`at` は1回の取り込みで同じ値を使う（分けて送っても1回として扱う）。

1. 送られた行の `row_hash` を **32件ずつ**引き当てる（7.61。D1 は1文に100個まで値を渡せる）
2. 中身が同じで欠品でもない行は `seen_at` だけ更新（`same`）
3. 違う行だけ `ON CONFLICT(jan,sha,idx)` で入れ替え（`added`／`changed`／`back`）
4. **最後の便（`part===parts`）のときだけ**、仕上げをする

`stocks_3.csv` の2週半ぶんで測ったところ、動くのは全体の約1割だった。

### 仕上げ（最後の便）

**欠品**：`gone_at IS NULL AND seen_at<>?at` の行に `gone_at` を入れる。
ただし 欠品 ÷ 生きている行 が **3割（`MW_DROP_WARN`）以上**なら、
CSV が途中までだった可能性があるので**何も消さず注意だけ出す**（`warn`）。

**JANごとの代表選び**：2文で済ませる（行数によらず同じ手間）。

```sql
UPDATE mw_stock SET pick=0 WHERE pick=1;
UPDATE mw_stock SET pick=1 WHERE id IN (
  SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY jan ORDER BY
    CASE WHEN COALESCE(ship_days,99)<=4 THEN 0 ELSE 1 END,  -- 早く出るものが先
    COALESCE(wholesale,999999999) ASC,                      -- 次に安いもの
    COALESCE(stock,0) DESC,                                 -- 次に在庫が多いもの
    COALESCE(ship_days,99) ASC, id ASC) AS rn
    FROM mw_stock WHERE gone_at IS NULL) WHERE rn=1);
```

### `GET /mw/list`（`mwList`）

`gone_at IS NULL AND pick=1` に、`kishu`（最大40個）・`new_only`・
`ship_max`・`stock_min` を足して返す。
返すのは `n`（件数）・`rows`（最大 `MW_LIST_MAX`=500）・
`alive`（生きている行）・`picked`（代表の数）・`last`（直前の取り込み。`at_jst` 付き）。

`POST /mw/stock` は `forbidStaff` で**作業者のキーでは断る**（取り込みは本人だけ）。

テストは `tests/mwstock.mjs`（40→63件）。


## 7.61 1文のバインド変数を「1件あたりの個数」で割る（2026-10-25・sw.js v187）

v186 の MW の在庫CSVの取り込みが**1便目から**落ちた。

```
D1_ERROR: too many SQL variables at offset 1098: SQLITE_ERROR（kind: mw-stock）
```

### 原因

UPSERT ではない。**その手前の引き当ての SELECT** だった。

`D1_MAX_KEYS = 40` は、もともと `items` を `(asin, cond)` で引くための値で、
**1件2個 × 40件 = 80個**に収まるように決めてあった。
MW の引き当ては `(jan, sha, idx)` の**1件3個**なので、
同じ 40 を使うと **120個**になり、D1 の上限（1文100個）を越えた。

```sql
SELECT jan, sha, idx, row_hash, gone_at FROM mw_stock
 WHERE (jan=? AND sha=? AND idx=?) OR (jan=? AND sha=? AND idx=?) OR …  -- ×40
```

`offset 1098` は 34個目の `OR` のあたり。33件＝99個までは通り、そこで越える。
UPSERT は**もともと1行1文**（15個）なので、こちらは問題なかった。

テストが見逃したのは、1便に **34行以上**を入れた検査が無かったため
（`tests/lib.mjs` は101個で落ちるように作ってあったが、そこまで積まなかった）。

### 直し

件数で決め打ちせず、**1件あたりの個数で割る**。

```js
const D1_MAX_BINDS = 100;          // D1 が1文に受け取れる値の数
function d1Step(perRow) {
  const n = Math.max(1, perRow | 0);
  return Math.max(1, Math.floor((D1_MAX_BINDS - 4) / n));   // 4個は余裕
}
```

| 1件あたり | 1文に入れる件数 | 使う個数 |
| --- | --- | --- |
| 1個 | 96件 | 96 |
| 2個 | 48件 | 96 |
| 3個 | 32件 | 96 |
| 15個 | 6件 | 90 |

直した場所（行数で変数が増える全部）：

| 場所 | 1件あたり | 前 | いま |
| --- | --- | --- | --- |
| `mwStockPut` の引き当て | 3個 `(jan,sha,idx)` | 40件＝**120個**（落ちた） | `d1Step(3)`＝32件＝96個 |
| `itemsByKeys` | 2個 `(asin,cond)` | 40件＝80個 | `d1Step(2)`＝48件＝96個 |
| 初めて見た明細 | 2個 `(order_id,line_id)` | 40件＝80個 | `d1Step(2)` |
| 売れた値段で保つ印 | 2個 `(asin,cond)` | 40件＝80個 | `d1Step(2)` |
| `mwList` の機種 | 1個 | 40個 | `d1Step(1)`＝96個 |

ほかの新しい処理は変数が行数で増えない：
**代表選び**は窓関数で変数0個、**欠品**は1個、`mw_runs` は11個、
UPSERT は1行15個。`items` への反映は**段取り A では行っていない**
（出品は段取り D）。

### 送り直しても壊れないこと

突き合わせが `(jan, sha, idx)` の UPSERT なので、同じ行を送り直しても
二重にならず `seen_at` が新しくなるだけ。
欠品の判定と代表選びは**最後の便（`part===parts`）だけ**なので、
途中で落ちた取り込みは「同じ `at` で最初から送り直す」で元に戻る。
取り込みの時刻（`at`）が変わっても、全便を送り直せば全行の `seen_at` が
そろうので欠品にならない（一部の便だけ別の `at` で送った場合は
3割の歯止めが効く）。

テストは `tests/mwstock.mjs`（40→63件）。
`d1Step` が 1〜20個のどれでも100個を越えないこと、
テストの D1 でも101個で「too many SQL variables」になること、
**400行（1便の上限ちょうど）が通ること**、
400行＋400行＋100行を送り直しても900行すべて生き残ることを見張る。

## 7.62 eBay の相場を JAN で引いて控える（4章の6・2026-10-25・sw.js v188）

候補の JAN（GTIN）で eBay を検索し、**即決の出品の最安値（送料込み）**を `mw_market` に控える。

### `POST /mw/market`（管理者だけ）

対象は「候補の代表（`pick=1`）のうち、控えが無い／古いもの」を**古い順**に。
一覧と同じ絞り込み（機種・新品・出荷・在庫）を body で受けるので、
**画面に出ている候補だけ**を調べる。

| 決まり | 値 |
| --- | --- |
| 1回に調べる件数 | `MW_MKT_MAX` **120**（画面から最大 `MW_MKT_HARD` 400 まで） |
| 時間の上限 | `MW_MKT_DEADLINE_MS` **60秒** |
| 呼び出しの間隔 | `MW_MKT_GAP_MS` **120ms** |
| 取り直さない期間 | `MW_MKT_TTL_D` **7日**（失敗したものは `MW_MKT_ERR_TTL_H` **24時間**） |
| 1件の呼び出し回数 | **1回**（`item_summary/search?gtin=…`） |

件数・時間のどちらかで必ず止まり、`left` に残りを返す（押すたびに進む）。
eBay が 429／500／503 を返したらその回で止める（`stopped:"ebay"`）。

### 使う API（ALLOWED は増やしていない）

既にある Browse の1本をそのまま使う。
`GET https://api.ebay.com/buy/browse/v1/item_summary/search?` ＋
`gtin` / `limit=50` / `sort=price` / `filter=buyingOptions:{FIXED_PRICE}`。
アプリトークン（`client_credentials`・基本スコープ）は KV に控えてあるので、
トークンの取得は2時間に1回だけ。

### 最安値の出し方（`mwMktPick`）

- **総額 = 本体 ＋ 送料**。`shippingOptions[0].shippingCost` を足す
- 送料が分からない出品は**本体だけ**で数え、`no_ship=1` を立てる
  （総額を低めに見るので、115%の判定は厳しい側に出る）
- **新品の最安値**（`low`）と**状態を問わない最安値**（`low_any`）を**1回の検索で両方**出す
- **競売は入れない**（値段が動くので `buyingOptions:{FIXED_PRICE}` で絞る）
- `n`（即決の出品数）が 0 なら「相場なし」

控えるのは `n` `n_new` `low` `low_item` `low_ship` `low_any` `cur` `title`
`item_id` `item_url` `no_ship` `err` `checked_at`。
取り直せたら `err` は消す。取得の記録は `mw_mkt_runs`。

`GET /mw/list` は `mw_market` を左結合して行に相場を付け、
`mkt`（調べ終わった件数・残り・115%の線・7日・1回の件数）も返す。

### 呼び出し回数の見込み（候補1,761件）

| | 回数 |
| --- | --- |
| 1回のボタン | **最大120回**（時間の上限で止まることもある） |
| 全部を1周 | **1,761回**＝15回ほど押す |
| 毎週の取り直し | 1,761回／週 ＝ **1日あたり約252回** |

Browse の既定の上限（1日5,000回）に対して十分収まる。
1リクエストあたりの外部呼び出しは最大400回で、Workers の上限（1,000）内。

テストは `tests/mwmkt.mjs`（51件）。

## 7.63 MW の商品画像を取って長辺を測る（6.1 の①・2026-10-25・sw.js v188）

### `POST /mw/img`（管理者だけ）

```
{jan, ids:["10921742", "https://…/10921743.jpg", …], probe:true}
  → MW から取って長辺を測る（probe のときは中身を返さない）
{jan, saved:[{pos, url}, …]}
  → 画面が pj-img に上げ終わった公開URLを控える
```

- 1商品 **12枚まで**（`MW_IMG_MAX`）。`pos=0` がメイン
- 長辺 **500px 以上**（`MW_IMG_MIN_LONG`）でなければ `ok=0`。理由を文で返す
- 大きさは既にある `imageSize()`（JPEG の SOF・PNG の IHDR）で読む
- 1枚ごとに 150ms 空ける。5MB を超える画像は断る
- 使える画像は `b64` で返す。画面が**今までの口**（pj-img の `POST /upload`）で R2 に控える
  → pj-sync に pj-img の合言葉を置かずに済む
- `saved` で受け取るURLは **pj-img の形**（`/i/YYYYMMDD/<uuid>.<ext>`）だけ通す

`GET /mw/img?jan=…` は控えてある分を返す（貼り直さなくて済む）。

### 許可表（ALLOWED）に足した1本だけ

```js
{ m: "GET", re: /^https:\/\/matchingworld\.asia\/products\/\d+\/\d+\/\d+\.jpg$/ },
```

- **読み取りの1本だけ。** 会員サイト（`/buy/?q=`）は許可表に無いので呼べない
- `mwImgId()` は会員サイトのURLや他のホストを**受け取らない**
- **Amazon（SP-API など）の画像は使わない**

`mw_img` に `jan` `pos` `mw_id` `src` `url` `w` `h` `long_px` `bytes` `ct`
`ok` `err` `at` を控える（主キー `(jan, pos)`）。

### 出品はしていない

この節は**画像の控えまで**。CSV の書き出し（出品）は作っていない。

テストは `tests/mwmkt.mjs`（51件）。

## 7.64 備考の言葉で候補から外す（2026-10-25・sw.js v189）

6.89 の受け口。`mwWhere()` に備考の絞り込みを足した。
一覧（`GET /mw/list`）と相場の取得（`POST /mw/market`）が**同じ条件**を使うので、
件数がずれず、注意の行に eBay の呼び出しを使わない。

```js
if (!noteAll && ngWords.length) {
  for (const g of ngWords) {
    where.push("COALESCE(note,'') NOT LIKE ? ESCAPE '\\'");
    bind.push("%" + g.replace(/[\\%_]/g, "\\$&") + "%");
  }
}
```

- 言葉は `note_ng`（カンマ区切り・最大40語）、`note_all=1` で外さない
- `%` と `_` を**文字として**扱うため `ESCAPE` を付ける
  （「100%_新品」のような備考を誤って外さない）
- 言葉1つにつきバインド変数1つ。40語でも `d1Step` の範囲内

`mwList` は左結合した問い合わせなので `note` にも `s.` を付ける。

テストは `tests/mwmkt.mjs`（51→63件）。

## 7.65 `__test` の重複キーを1つにする（2026-10-25・sw.js v189）

`wrangler deploy` が警告を出していた。

```
Duplicate key "mdBo" in object literal
```

`__test` の書き出しに `mdBo` が2か所（写真・ベストオファーの並びと、
自動値下げの並び）に入っていた。自動値下げの並びのほうを残して1つにした。
ふるまいは変わらない（同じ関数を2回書き出していただけ）。

テストに `__test` の重複キーが無いことの検査は入れていない（`node --check` は
重複を通すため）。`npx wrangler deploy` の警告が消えたことで確かめる。

## 7.66 MW の候補を Amazon（国内FBA）で見る（2026-10-26・sw.js v190）

6.91 の受け口。候補の JAN から ASIN を引き、**新品の実売価格**と
**出品の様子**を `mw_amz` に控える。**利益の計算はここでは行わない**
（手数料率が⚙設定で変わるので画面で計算する。式を2か所に持たない）。

### 2段で取る

| | API | 1回の件数 | 速さ |
| --- | --- | --- | --- |
| ① JAN → ASIN・ランキング | Catalog Items（`/catalog/2022-04-01/items`） | **20件** | 5回/秒 |
| ② ASIN → 実売価格・出品の様子 | `getItemOffersBatch`（既にある） | **20件** | **0.1回/秒** |

**②が10秒に1回**なので、ここが1回の件数を決める。
`MW_AMZ_MAX = PRICING_BATCH × PRICING_MAX_CALLS = 120件`。
①は `identifiersType=EAN` で JAN をそのまま渡す（商品名での検索はしない）。

ALLOWED に足したのは Catalog Items の**読み取り1本**だけ。

```js
{ m: "GET", re: /^https:\/\/sellingpartnerapi-fe\.amazon\.com\/catalog\/2022-04-01\/items\?/ },
```

### ランキングは「いちばん細かい分類」を採る

`salesRanks[].classificationRanks[]` は大分類から細かい順に並ぶので、
最後に見つかったものを採る（例：「ゲーム 6,490位」より
「Nintendo Switch ソフト 649位」）。無ければ `displayGroupRanks` を使う。

### 出品の様子（10/7 の利益計算ファイルと同じ列を出すため）

`amazonLowest()` の返りに4つ足した（**1か所で持つ**。既存の呼び出しにも効く）。

| 足したもの | 中身 |
| --- | --- |
| `amz` | **Amazon本体**（`AN1VRQENFRJN5`）の出品があれば 1 |
| `fba` | FBA の出品者数（`IsFulfilledByAmazon`） |
| `buy` | **カート価格**（`Summary.BuyBoxPrices`・送料込み） |
| `newN` | 新品の出品者数（`Summary.NumberOfOffers`） |

綴りが大文字小文字どちらで返るか実データで確定できていないので、
`pick()` でどちらでも読めるようにしている（`SubCondition` と同じ事情）。

**販売価格はカートがあればカート、無ければ最安**（送料込み）。
どちらを使ったかを `basis`（`カート` / `最安`）に控える（10/7 のファイルの「価格の基準」）。

### `mw_amz`（`migrate-0026-mw-amz.sql`）

`jan`（主キー）・`asin`・`name`・`rank`・`rank_cat`・`price`・`basis`・`low`・
`buybox`・`new_n`・`low_n`・`amz`・`fba_n`・`err`・`checked_at`。
取得の記録は `mw_amz_runs`。

- 取れた値段は **3日**（`MW_AMZ_TTL_D`）取り直さない
- ASIN が引けなかった／出品が無かった行は **24時間**後に取り直す
- `POST /mw/amz` は管理者だけ（`forbidStaff`）。`GET /mw/amz` は読める
- `GET /mw/amz?priced=1` で値段が取れた行だけに絞れる

### 呼び出し回数の見込み（候補1,752件）

| | 回数 |
| --- | --- |
| 1回のボタン | ASIN引き **6回**＋値段 **6回**（120件） |
| 全部を1周 | ASIN引き 88回＋値段 **88回** ＝ ボタン **15回**ほど |
| 1回にかかる時間 | 値段が10秒に1回なので **約1分** |

`getItemOffersBatch` は0.1回/秒・バースト1なので、1周に実時間で15分ほどかかる。

テストは `tests/mwamz.mjs`（52件）。

## 7.67 JAN から ASIN を引く（`jan_map`・2026-10-26・sw.js v191）

6.92 の受け口。**`items` に JAN の列は無く、足せない。**

### なぜ別表にするか（調査の結果）

`items` は **ちょうど100列**で、これは D1 が1つの結果に返せる上限（7.55）。
列を1つ足すと `/status` と Cron の各ジョブが
`too many columns in result set` で落ちる（v176 で実際に起きた）。
JAN は1商品に1つなので、別表に出しても引き当ては1対1で済む。

```sql
CREATE TABLE jan_map (
  jan TEXT PRIMARY KEY, asin TEXT, name TEXT, rank INTEGER, rank_cat TEXT,
  src TEXT,            -- 'catalog' / 'mw' / 'hand'
  err TEXT, at TEXT, created_at TEXT
);
```

### `GET /find?jan=…`（`jans=` でカンマ区切り・最大20件）

1. **`jan_map` を引く**
2. **`mw_amz` も引く**（MW の取り込みで分かっている分。`src='mw'`）
3. それでも足りない分だけ **Catalog Items（`identifiersType=EAN`）** を呼ぶ
4. 引けた分・引けなかった分の**両方**を `jan_map` に控える

見つからなかった控えは `JAN_MISS_TTL_D`（**7日**）たったら調べ直す。
見つかった対応は**期限なし**（JAN と ASIN の対応は変わらない）。

`mwAsinFind()`（7.66）も `jan_map` に控えるようにしたので、
MW の Amazon 価格取得を回すほど検索も速くなる（API を呼ばずに済む）。

読み取りだけなので**作業者のキーでも引ける**。

テストは `tests/janfind.mjs`（32件）。
`items` がちょうど100列で JAN の列が無いことも、テストで固定している。

## 7.68 仕入れの印を D1 に置く（2026-10-26・sw.js v192）

6.93 の受け口。端末をまたいで同じ印が見えるようにする。

```sql
CREATE TABLE mw_buy (
  jan TEXT PRIMARY KEY, qty INTEGER NOT NULL DEFAULT 1,
  by_role TEXT,            -- 'admin' / 'staff'（誰が付けたか）
  note TEXT, at TEXT, created_at TEXT
);
```

| 窓口 | 権限 | すること |
| --- | --- | --- |
| `POST /mw/buy` | **管理者・作業者とも可** | `{jan, qty}` か `{items:[…]}`（200件まで） |
| `GET /mw/buy` | 管理者・作業者とも可 | 印の付いた行を MW と Amazon の中身つきで返す |

- `qty` は 0〜`MW_BUY_MAX_QTY`（99）。**0 を送ると印が消える**
- 13桁でない JAN は入らない
- `GET` は `mw_stock`（`pick=1`）と `mw_amz` を左結合して、
  社・卸値・MW在庫・出荷日・ASIN・Amazon販売価格まで返す（注文用）
- 卸値（税込）の合計 `yen` と、**印を付けたあとに欠品した行の数 `gone`** も返す
- `GET /mw/amz` の各行に `buy_qty` を足した（一覧を開いた時点で印が入る）

### 作業者（STAFF_KEY）にできること（項目5の答え）

| | 作業者 |
| --- | --- |
| 候補一覧を見る（`GET /mw/amz`） | **できる** |
| 仕入れの印を付ける（`POST /mw/buy`） | **できる** |
| **Amazonの実売価格を取る（`POST /mw/amz`）** | **できない（管理者だけ）** |

理由は 7.70 のとおり、**Cron と Amazon の呼び出し上限を分け合っている**ため。

テストは `tests/mwbuy.mjs`（24件）。

## 7.69 JAN→ASIN が引けない原因と直し（2026-10-26・sw.js v192）

120件中59件しか引けなかった件。原因は**2つ**あった。

### ① 20件まとめて引くと、識別子が合わない商品を捨てていた（コードの不具合）

`searchCatalogItems` は「どの要求に対する答えか」を返さない。
そこで**返ってきた商品の識別子に要求した JAN が入っているか**で突き合わせていた。
ところが Amazon が商品を返しても、その商品の `identifiers` に
その JAN が載っていないことがある（UPC しか載っていない、など）。
20件まとめて投げていたので「どの JAN の答えか」決められず、**捨てていた**。

**直し**：まとめて引いたあと、**引けなかった JAN を1件ずつ引き直す**。
1件なら取り違えようがないので、識別子が合わなくてもその JAN の答えとして採れる。
Catalog は5回/秒なので、61件の引き直しでも十数秒で済む。
引き直しの上限は `MW_AMZ_RETRY_MAX`（120件）。

引けなかった理由も分けて控えるようにした（`jan_map.err`）。

| 理由 | 意味 |
| --- | --- |
| `Amazonのカタログにこの JAN がありません` | 1件で引いても商品が無い（＝本当に無い） |
| `Amazonに問い合わせできませんでした（…）` | API のエラー |
| `引き直しの上限に達しました（次回に回します）` | 次回に回る |

### ② 調べる順が JAN の昇順なので、最初の120件が偏っていた（仕様どおりの挙動）

`ORDER BY COALESCE(a.checked_at,'') ASC, s.jan ASC` なので、
初回は**JAN の小さい順**になる。実データで確かめると、最初の120件は
`451x`〜`452x`（小規模流通のタイトル）に偏っていた。

| 先頭4桁 | 件数 |
| --- | --- |
| 4528 | 39 |
| 4545 | 19 |
| 4527 | 16 |
| 4535 | 16 |
| 4510 | 14 |

中身の例：

```
4510417032793  NS  泡沫のユークロニア ‐trail‐ 通常版
4510417032847  NS  エトランジュ オーヴァーロード 通常版［Switch版］
4510417032861  NS  Le Mirage Mystique 通常版
4510772250092  NS  ダブルドラゴン リヴァイヴ［Switch版］
4523052030826  NS2H  SanDisk microSD Express Card 512GB（ゲームではない）
```

任天堂（`4902370`）・スクエニ（`4988601`）・バンダイ（`4573`）といった
**大手のタイトルは JAN が大きいので、まだ順番が来ていなかった**。
「日本のゲームの JAN にしては少ない」のは、**小規模流通のタイトルが
先に並んでいたから**で、引き当て自体の精度の問題ではない（①を除けば）。

## 7.70 Cron と Amazon の呼び出し上限を分け合う（2026-10-26・sw.js v192）

### 確認の結果

| | |
| --- | --- |
| `getItemOffersBatch` の間隔 | `SP_GAP` で **10,500ms**（＝0.1回/秒。Amazon の上限と同じ） |
| 間隔を守る仕組み | `spSlot()`（`spLanes` はモジュール変数） |
| Cron で同じ窓口を使う処理 | `jobDaily` の最安値取得・`syncPricingHot`（3時間ごと）・`jobReview` |
| **同じ isolate なら** | `spLanes` を共有するので守られる |
| **別の isolate／同時に走ったら** | **共有されない**。合わせて 0.2回/秒になり 429 が出る |

429 のときは `isQuota` が拾って `SP_BACKOFF`（700/1500/3000ms）で3回まで
やり直すが、**使い切ると Cron 側の行が取れずに終わる**。
つまり**上限は分け合っている**（Amazon の口座単位）。

### 直し

最後に呼んだ時刻を **KV にも置いて、実行をまたいで間隔を守る**。

```js
const SP_KV_LANES = { getItemOffersBatch: 1 };   // 遅い窓口だけ対象
async function spSlotKv(env, label) { … }        // spCall の中で spSlot の次に呼ぶ
```

Catalog（5回/秒）は速いので対象にしていない。

### それでも実売価格の取得は管理者だけにする

KV の間隔で 429 は減るが、**Cron の処理が待たされる**ことは変わらない
（1回の手動実行で最大120回＝約21分、呼び出しを占める）。
作業者が押すと日次の自動値下げが遅れる可能性があるので、
**`POST /mw/amz` は管理者だけ**のままにする（一覧と仕入れの印は作業者も可）。

## 7.71 画面を閉じても最後まで進める（2026-10-26・sw.js v192）

### 確認の結果

`export default { async fetch(request, env) }` に **`ctx` を受け取っていなかった**
ので、`ctx.waitUntil()` が使えなかった。
Cloudflare は客（ブラウザ）が切れると実行を打ち切ることがあるため、
**1回押したあとアプリを閉じると、その回が途中で止まる可能性があった**。

### 直し

`async fetch(request, env, ctx)` にして、長くかかる MW の処理を
`ctx.waitUntil()` にも渡した（応答は今までどおり `await` で返す）。

| 窓口 | かかる時間 | `waitUntil` |
| --- | --- | --- |
| `POST /mw/amz` | 約1分（120件） | **入れた** |
| `POST /mw/market` | 約1分（120件） | **入れた** |
| `POST /mw/stock` | 1便ずつ短い | 入れていない（画面が次の便を送るため） |

これで、押したあとアプリを閉じても**その回の120件は最後まで D1 に入る**。
ただし**次の回は自動では始まらない**（押した分だけ進む）。
