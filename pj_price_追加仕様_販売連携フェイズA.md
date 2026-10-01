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

**エンドポイント**：`GET /status`、`GET /runs`、`POST /listings`、`POST /sync`
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

## 11. 作業の進め方
1. 9章の確認結果を報告して止まる。
2. カジの判断（ロール申請、プラン、トークン取得）を受けて、Worker と D1 を実装する。必要なシークレットと `wrangler` コマンドの一覧を出す。
3. カジがデプロイしたら、10章の受け入れテストを行う。
4. pj_price に「販売連携」タブを追加し、sw.js のバージョンを上げて main に push する。
