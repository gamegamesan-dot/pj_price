# pj-sync（販売連携フェイズA・見える化）

Amazon（FBA）と eBay の状況を定期的に読み取って D1 に貯め、食い違いや売れた事実を
Discord に通知する Cloudflare Worker。仕様は `../pj_price_追加仕様_販売連携フェイズA.md`。

**フェイズAでは Amazon・eBay へ書き込みを一切しない。** 外向きの通信はすべて `net()` を
通し、読み取り専用の許可表（`worker.js` の `ALLOWED`）に無い URL・メソッド・Trading の
呼び出し名は実行時に例外になる。書き込みAPIを足すにはこの表を変えるしかない。

キー・トークンの値はこのリポジトリに書かない。登録は `wrangler secret put` で行う。

## 1. 用意するもの（順番どおり）

### 1-1. Workers 有料プラン（$5/月）に切り替える

Cloudflare ダッシュボード → Workers & Pages → Plans → Workers Paid。
無料プランだと 1回あたり CPU 10ms・外部リクエスト50件で、`GetMyeBaySelling` の
XML解析と全件スイープが入らない。

### 1-2. SP-API に `Amazon Fulfillment` ロールを追加する

1. Amazon Developer Central → アプリ → 編集 → ロールに **Amazon Fulfillment** を追加
   （FBA Inventory API に必要。フェイズCのMCFでも使う）
2. 承認後、**セラーアカウントでアプリを再認可する**（Seller Central → アプリとサービス →
   アプリを管理 → 認可）。ここで新しい **リフレッシュトークン** が出る
3. 新しいトークンを 1-5 の手順で3か所に入れ替える

### 1-3. eBay のユーザートークン（認可コード方式）

1. developer.ebay.com → Application Keys → Production → User Tokens →
   **Get a Token from eBay via Your Application** で **RuName** を作る
2. ブラウザで同意画面を開く（1行）。`scope` はスペース区切りをURLエンコードする

   ```
   https://auth.ebay.com/oauth2/authorize?client_id=<APP_ID>&response_type=code&redirect_uri=<RuName>&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.fulfillment.readonly%20https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.inventory
   ```

3. 承諾すると戻り先URLに `?code=...` が付く。**5分以内**に次を実行してコードを交換する
   （`<BASIC>` は `APP_ID:CERT_ID` を Base64 にした文字列）

   ```powershell
   $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("APP_ID:CERT_ID"))
   $body  = @{ grant_type='authorization_code'; code='<code>'; redirect_uri='<RuName>' }
   Invoke-RestMethod -Method Post -Uri 'https://api.ebay.com/identity/v1/oauth2/token' `
     -Headers @{ Authorization = "Basic $basic" } -Body $body |
     Select-Object -ExpandProperty refresh_token
   ```

4. 出てきた **refresh_token** を `EBAY_USER_REFRESH_TOKEN` に登録する（1-5）
5. refresh_token の有効期間は **18か月**。切れると `/runs` に
   `EBAY_USER_REFRESH_TOKEN が失効。再同意が必要` と出るので、2からやり直す

### 1-4. D1 と KV を作る

```powershell
cd proxy-sync
npx wrangler d1 create pj-sync            # 出力された database_id を wrangler.toml に書く
npx wrangler kv namespace create SYNC_CACHE  # 出力された id を wrangler.toml に書く
npx wrangler d1 execute pj-sync --remote --file=./schema.sql
```

`schema.sql` はすべて `CREATE ... IF NOT EXISTS` なので、**表を足したときは同じコマンドを
もう一度実行すればよい**（既存のデータは消えない）。`order_queue` を足した回もこれで足りる。

**既存の表に列を足したときは `ALTER TABLE` が必要**で、こちらは何度も実行できない。
その回だけ次を実行する（新しくD1を作る場合は `schema.sql` に同じ列が入っているので不要）。

```powershell
npx wrangler d1 execute pj-sync --remote --file=./migrate-0002-sales-channel.sql
```

### 1-5. シークレットを登録する

```powershell
cd proxy-sync
npx wrangler secret put PJ_ACCESS_KEY            # pj-title と同じ値
npx wrangler secret put LWA_CLIENT_ID            # pj-title と同じ値
npx wrangler secret put LWA_CLIENT_SECRET        # pj-title と同じ値
npx wrangler secret put SPAPI_REFRESH_TOKEN_FE   # 1-2 で取り直した新しい値
npx wrangler secret put EBAY_CLIENT_ID           # pj-title と同じ値
npx wrangler secret put EBAY_CLIENT_SECRET       # pj-title と同じ値
npx wrangler secret put EBAY_USER_REFRESH_TOKEN  # 1-3 で取得
npx wrangler secret put DISCORD_WEBHOOK_URL      # keepa-hunter とは別チャンネル推奨
```

### 1-6. デプロイ

```powershell
cd proxy-sync
npx wrangler deploy
```

`[triggers] crons` に書いた2本（`*/15 * * * *` と `7 * * * *`）が自動で登録される。
登録の確認は Cloudflare ダッシュボード → Workers → pj-sync → Settings → Triggers。

## 2. リフレッシュトークンを取り直したときの入れ替え手順（3か所）

SP-API のロールを追加すると既存のリフレッシュトークンは使えなくなる。
**3か所すべてを入れ替えるまで、どれかが 401 で止まる。**

| 場所 | 入れ替え方 |
|---|---|
| pj-title（Worker） | `cd proxy-title; npx wrangler secret put SPAPI_REFRESH_TOKEN_FE` |
| pj-sync（Worker） | `cd proxy-sync;  npx wrangler secret put SPAPI_REFRESH_TOKEN_FE` |
| keepa-hunter（`.env`） | `.env` の SP-API リフレッシュトークンの行を書き替えて再起動 |

手順：

1. Seller Central で再認可し、新しいリフレッシュトークンを**手元にだけ**控える
2. pj-title に入れる → `POST /titles` を1件叩いて 200 が返ることを確認
   （pj_price の出品CSVタブで行の「再生成」を1件押せばよい）
3. pj-sync に入れる → `POST /sync {"kind":"orders"}` を叩いて `errors: 0` を確認
4. keepa-hunter の `.env` を書き替える。**変数名は既存の行に合わせる**（このリポジトリに
   keepa-hunter は無いので名前は確認して使う）。書き替えたらプロセスを再起動し、
   1回分の取得が通ることをログで確認する
5. 3つとも通ったら、控えた値を手元から消す（KeePass等に保管する場合はそこだけに残す）

古いトークンは再認可の時点で無効になる。**2〜4の間だけ失敗が出るのは正常**。
Workers 側は KV にアクセストークンを最大1時間キャッシュするので、
入れ替え直後は古いトークンで動き続けることがある（待つか、KVの `lwa:fe` を消す）。

```powershell
# アクセストークンのキャッシュを消したいとき
npx wrangler kv key delete --binding SYNC_CACHE "lwa:fe" --remote
```

## 3. エンドポイント

すべて `X-PJ-Key` が必要。CORS は `https://gamegamesan-dot.github.io` のみ。

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/status` | 一覧。`scope=ebay`（既定）/`out`/`unknown`/`all`、`warn=1`、`unmatched=1`、`sold=24`、`limit=500` |
| GET | `/orders/summary?days=7` | 注文の内訳（注文日が期間内か・状態ごと・販売経路ごと・区分ごと） |
| GET | `/runs?limit=20` | 実行ログ（`sync_runs`） |
| POST | `/listings` | pj_price から名簿を登録（SKU・CustomLabel・ItemID・モード・一点物・FBA連動） |
| POST | `/sync` | 手動実行（`kind=test-notify` は通知テスト）。`{"kind":"orders"\|"inventory"\|"rollcall"\|"sweep"\|"pricing"\|"notify","days":7,"max":25}` |

`kind=orders` の `max` は、その回で明細（`getOrderItems`）を取る注文の数（既定25・最大120）。

手動実行の例：

```powershell
$H = @{ 'X-PJ-Key' = '<PJ_ACCESS_KEY>'; 'content-type' = 'application/json' }
$U = 'https://pj-sync.<サブドメイン>.workers.dev'

# 受け入れテスト：過去7日分の注文を読む（明細は1回25件まで。残りは次回以降）
Invoke-RestMethod -Method Post -Uri "$U/sync" -Headers $H -Body '{"kind":"orders","days":7}'

# 明細の残りを続けて取る（note の「残りN件」が0になるまで繰り返す）
Invoke-RestMethod -Method Post -Uri "$U/sync" -Headers $H -Body '{"kind":"orders","max":60}'

# 在庫（差分）＋eBay出品中リスト
Invoke-RestMethod -Method Post -Uri "$U/sync" -Headers $H -Body '{"kind":"inventory"}'

# 名簿の名指し確認＋最安値＋未対応付けの件数
Invoke-RestMethod -Method Post -Uri "$U/sync" -Headers $H -Body '{"kind":"rollcall"}'

# 全件スイープ（続きがあるときは何度か繰り返す）
Invoke-RestMethod -Method Post -Uri "$U/sync" -Headers $H -Body '{"kind":"sweep"}'

# 注文の内訳（Seller Central の件数と突き合わせる）
Invoke-RestMethod -Uri "$U/orders/summary?days=7" -Headers $H | ConvertTo-Json -Depth 3

# 通知テスト（同じ tag の2回目は届かない）
Invoke-RestMethod -Method Post -Uri "$U/sync" -Headers $H -Body '{"kind":"test-notify"}'
Invoke-RestMethod -Method Post -Uri "$U/sync" -Headers $H -Body '{"kind":"test-notify","tag":"2"}'

# 一覧と実行ログ
Invoke-RestMethod -Uri "$U/status?warn=1" -Headers $H | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$U/runs?limit=10" -Headers $H | Format-Table
```

## 4. 定期実行の中身

| いつ | 何をするか |
|---|---|
| 15分ごと | Amazon（AFN）と eBay の注文を差分で取り込む → `EBAY_SOLD` / `OVERSELL_RISK` を即時通知 |
| 毎時07分 | FBA在庫を `startDateTime` で差分取り込み＋eBayの出品中リスト → 食い違いを検出し、まとめて通知 |
| 毎時のうち UTC18時台（JST3時台） | 名簿のSKUを `sellerSkus`（50件/回）で名指し確認＋Amazon最安値＋未対応付けの件数 |
| 手動のみ | 全件スイープ（`nextToken` をD1に保存して数ページずつ進める） |

### eBayの出品中リスト（OutputSelector）

`GetMyeBaySelling` に **`OutputSelector` は既定で付けていない**（`EBAY_SELECTORS = []`）。
2026-09-30 の受け入れテストで
`ActiveList.ItemArray.Item.ItemID` / `.SKU` / `.Title` / `.QuantityAvailable` /
`.SellingStatus.CurrentPrice` / `ActiveList.PaginationResult` / `Ack` / `Errors` の
組み合わせが「One or more of the output selectors is incorrect.」で Failure になり、
出品が1件も取れなかったため。

- 応答は大きくなるので1ページ100件にしている（`EBAY_PAGE`）
- 通る指定が分かったら `EBAY_SELECTORS` に入れれば絞れる。指定して失敗した回は
  **一度だけ指定なしで取り直す**ので、間違った指定で出品が消えることはない
- 数量は `QuantityAvailable` が返らないことがあるので、無ければ
  **出品数量 − 売れた数量**で出す（0固定になるのを防ぐ）
- pj_price を通さず出した出品は CustomLabel が空か別形式で、ASIN＋新品/中古の
  キーが作れない。**一覧にも通知にも出さず、件数だけ**を `note` と
  `/status` の `counts.ebay_unparsed` に出す

### 呼び出し間隔と注文明細の待ち行列

Amazonの上限はAPIごとに違うので、`SP_GAP` で別々に待つ。

| API | 上限（ドキュメント） | あける間隔 |
|---|---|---|
| `getOrders` | 0.0167回/秒（バースト20） | 1.0秒 |
| `getOrderItems` | **0.5回/秒** | **2.1秒** |
| `getInventorySummaries` | 2回/秒（バースト2） | 0.6秒 |
| `getItemOffersBatch` | 0.1回/秒 | 10.5秒（1回の実行で6回＝120件まで） |

`getOrderItems` が遅いので、注文一覧で見つけた注文は `order_queue` に積み、
**1回の実行では既定25件（`max` で最大120件）まで**明細を取る。

- 取り終えた注文は `done_at` が入り、**二度と明細を取り直さない**（状態の変化は
  注文一覧の値で `orders.status` だけ更新する）
- 失敗した注文は `done_at` が空のまま残り、`tries` が増えて**次回の実行でやり直す**
- eBayの取り込みは明細より**先**に行うので、明細が長引いても取り残されない
- 残り件数は `note` と `/sync` の戻り（`items_pending`）に出る

### nextToken の扱い

**続きを読むときも1ページ目と同じ絞り込み（`startDateTime` など）を必ず付ける。**
付けないと 400 `Invalid nextToken for the request, add startDateTime and try again`
になり、2ページ目以降が読めない（2026-09-30 の受け入れテストで判明）。

- 全件スイープは `nextToken` とその**起点の `startDateTime` を対でD1に保存**する
  （`sweep.token` / `sweep.since`）
- 保存していたトークンが古くて無効なときは、**破棄して1ページ目から読み直す**（1回だけ）

**`startDateTime` は入庫中の数量変化を検出しない**（Amazonの仕様）。そのぶんを日次の
名指し確認で補っている。名簿は pj_price から `POST /listings` で送ったSKU（`active=1`）で、
在庫0になったSKUは `active=0` になり照会対象から外れる。

## 4.5 販売経路（売上と返送の区別）

Amazonの注文一覧には、実際の売上以外も入る。`SalesChannel` で分ける。

| `kind` | 条件 | 扱い |
|---|---|---|
| `sale` | `SalesChannel` が `Amazon.co.jp` | 売上。`FBA_SOLD` の対象（ただし `Canceled` / `Unfulfillable` は除く） |
| `removal` | `SalesChannel` が `Non-Amazon` で、出品者注文IDが `PJ-` で始まらない | **Amazonが作る返送**（長期保管在庫の自動返送、販売不可在庫の返送）。売上として扱わず `FBA_REMOVAL` イベントにする |
| `mcf` | `SalesChannel` が `Non-Amazon` で、出品者注文IDが **`PJ-`** で始まる | **自分のMCF注文**。フェイズAでは作らないので通常は0件。フェイズCで自分が作るときは出品者注文IDを `PJ-` で始める |

**フェイズCでMCF注文を作るときは、出品者注文ID（`SellerOrderId`）を必ず `PJ-` で
始めること。** これが自分の取り寄せとAmazonの返送を区別する唯一の手がかり。

## 5. CPU時間の見かた

Workers では計算中に時計が進まないため、**CPU時間は Worker の中から測れない**。
`wrangler.toml` で `[observability] enabled = true` にしてあるので、次で見る。

```powershell
npx wrangler tail --format pretty     # 実行中のログとCPU時間
```

Cloudflare ダッシュボード → Workers → pj-sync → Logs / Metrics でも見られる。
`sync_runs` に残しているのは**自分で数えられるもの**（外部リクエスト回数・ページ数・
件数・エラー数・経過時間）だけ。

## 6. 個人情報について

- Amazon：PIIロールを申請していないので、購入者の氏名・住所はそもそも返ってこない
- eBay：`getOrders` の応答には氏名・住所が含まれるが、`ebayOrders()` が取り出すのは
  注文ID・SKU・数量・金額・日時・状態だけ。生の応答は D1 にも Workers Logs にも出さない
- `orders` 表に氏名・住所・メールの列は無い（`schema.sql` を参照）
