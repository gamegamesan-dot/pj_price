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

## 10. 受け入れテスト
- 初回の取り込みで過去7日分を読み込み、注文件数が Seller Central・Seller Hub の表示と一致する。
- テスト用に Discord 通知が届く（同じイベントが二重に届かない）。
- `GET /status` の一覧で、FBA在庫・eBay数量が各管理画面と一致する（抜き取り10件）。
- **Worker のコードに、Amazon・eBay への書き込み系API呼び出しが含まれていない**ことをレビューで確認する。
- D1 に購入者の個人情報が保存されていない。

## 11. 作業の進め方
1. 9章の確認結果を報告して止まる。
2. カジの判断（ロール申請、プラン、トークン取得）を受けて、Worker と D1 を実装する。必要なシークレットと `wrangler` コマンドの一覧を出す。
3. カジがデプロイしたら、10章の受け入れテストを行う。
4. pj_price に「販売連携」タブを追加し、sw.js のバージョンを上げて main に push する。
