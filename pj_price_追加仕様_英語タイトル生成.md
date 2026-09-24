# pj_price 追加仕様：JANコードから英語タイトルを自動生成（フェイズ2）

## 1. 目的
出品リストタブ（せどりすとCSV取り込み）の各商品について、JANコードからeBay用の英語タイトルを自動生成する。
生成結果は人が確認・編集してから、eBay一括出品CSVに書き出す。

対象はゲームソフトとし、機種は Switch 2 / Switch / PS5 / PS4 / PS3 / PS2 / PS Vita / PSP とする。
箱説自体に価値のあるレトロゲームは対象外。

## 2. 全体構成

```
pj_price（GitHub Pages）
   │ POST /titles（JAN・日本語名・機種・状態）
   ▼
Cloudflare Worker「pj-title」（新規。APIキーはすべてここに置く）
   ├─ KVキャッシュ（JAN単位）
   ├─ eBay Browse API（GTIN検索 → 他セラーの英語タイトル候補）
   ├─ Amazon SP-API（Catalog Items → 英語名／日本側メタデータ）
   └─ Claude API（候補から「英語の商品名」だけを抽出）
   ▼
タイトルはWorker内でコードが組み立てる（AIには組み立てさせない）
```

設計方針：
- AIには英語の商品名の特定だけを任せる。機種名・Japan Ver.・状態などの定型部分は、コードで決定的に付ける（ハルシネーション対策）。
- pj_priceは静的サイトのため、APIキーをブラウザ側に置かない。

## 3. Worker「pj-title」

### 3.1 Secrets / バインディング
| 名前 | 内容 |
|---|---|
| `PJ_ACCESS_KEY` | pj_priceから送る共有キー（ヘッダー `X-PJ-Key` で照合） |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | eBay本番アプリのキー |
| `LWA_CLIENT_ID` / `LWA_CLIENT_SECRET` | SP-APIアプリのLWA認証情報 |
| `SPAPI_REFRESH_TOKEN_FE` | 日本（FE）用のリフレッシュトークン（接続確認済み） |
| `SPAPI_REFRESH_TOKEN_NA` | 米国（NA）用。**取得できた場合のみ**設定 |
| `ANTHROPIC_API_KEY` | Claude API |
| KV `TITLE_CACHE` | 生成結果・アクセストークンのキャッシュ |

- 各キーの出どころ：eBayはToolizのときに取得した本番キーセットを使う。SP-APIはkeepa-hunterと同じLWA認証情報と日本のリフレッシュトークンを使う。Claude APIは既存アカウントでWorker専用のキーを新しく発行する。
- **キーの値はコード・リポジトリ・会話に一切書かない。** Claude Codeは `wrangler.toml` とコードでシークレット名を参照するだけにし、値はカジが `wrangler secret put` で登録する。
- Claude Codeは、登録が必要なシークレット名の一覧と `wrangler secret put` コマンドの一覧を出力する。

### 3.2 セキュリティ
- CORSは `https://gamegamesan-dot.github.io` のみ許可する。
- `X-PJ-Key` が一致しない場合は401を返す。
- 1リクエストあたり最大20件とする。超える場合、pj_price側で分割して送る。

### 3.3 エンドポイント
`POST /titles`

リクエスト：
```json
{ "items": [ { "jan": "4902370...", "ja_title": "…", "platform": "Switch", "condition": "used" } ], "force": false }
```

レスポンス（itemsと同じ順）：
```json
{ "results": [ {
  "jan": "…",
  "status": "ok | review | not_found | invalid_jan",
  "english_name": "…",
  "title": "…",
  "length": 62,
  "sources": ["ebay", "amazon_us", "amazon_jp", "translation"],
  "candidates": ["…eBay/Amazonで見つかった元タイトル（最大5件）"],
  "note": "…判断理由を短く"
} ] }
```

### 3.4 処理の流れ（1件ごと。並列数は最大4）
1. **JAN検証**：13桁（または8桁）の数字であることと、チェックディジットを確認する。NGなら `invalid_jan` を返す。
2. **キャッシュ確認**：`title:v1:{jan}` を確認する。`force=false` でヒットすれば、`english_name` を再利用してタイトル組み立て（手順6）だけを行う。
3. **eBay Browse API**
   - トークンはClient Credentials方式（`POST https://api.ebay.com/identity/v1/oauth2/token`、scope `https://api.ebay.com/oauth/api_scope`）で取得し、KVに有効期限の少し手前までキャッシュする。
   - 検索は `GET https://api.ebay.com/buy/browse/v1/item_summary/search?gtin={jan}&limit=20` とし、ヘッダーに `X-EBAY-C-MARKETPLACE-ID: EBAY_US` を付ける。
   - 返ってきた `title` を候補として集める。0件なら次へ進む。
4. **Amazon SP-API（Catalog Items API 2022-04-01 `searchCatalogItems`）**
   - LWAでアクセストークンを取得する（SigV4署名は不要）。
   - 米国：`sellingpartnerapi-na.amazon.com`、marketplace `ATVPDKIKX0DER`、`identifiers={jan}&identifiersType=EAN&includedData=summaries`。**`SPAPI_REFRESH_TOKEN_NA` がない場合はスキップ**する。
   - 日本：`sellingpartnerapi-fe.amazon.com`、marketplace `A1VC38T7YXB528`。日本語名・ブランド・機種の補強に使う。
5. **英語名の抽出（Claude API）**
   - モデルは `claude-haiku-4-5-20251001` を使う。
   - 入力：日本語名、機種、eBay候補、Amazon US候補、Amazon JPの情報。
   - 出力はJSONのみとする：`{"english_name": "...", "confidence": "high|medium|low", "basis": "ebay|amazon_us|translation"}`
   - プロンプトで守らせること：
     - 公式の英語タイトルが候補にあればそれを優先する。
     - 候補タイトル中の機種名・Japan・Import・状態語・セラー独自の飾り文句は除去する。
     - 候補がなければ日本語名から翻訳する（その場合 `confidence` は `low`）。
     - 言語対応（English等）については一切書かない。
6. **タイトル組み立て（コード側）**：4章のルールで組み立てる。
7. **statusの判定**
   - `ok`：eBay候補が2件以上あって一致している、またはAmazon USで見つかった、かつ `confidence` が `high`。
   - `review`：それ以外（翻訳のみ、候補が割れている、80文字を超えて切り詰めた、など）。
   - `not_found`：候補も日本語名もない。
8. **キャッシュ保存**：`english_name`・`sources`・`candidates` を90日間保存する（タイトル本体は保存せず、毎回組み立てる）。

## 4. タイトル組み立てルール
書式：`{english_name} {機種表記} Japan Ver.{状態サフィックス}`

- 機種表記：`Switch 2`→`Nintendo Switch 2`、`Switch`→`Nintendo Switch`、`PS5`、`PS4`、`PS3`、`PS2`、`PS Vita`、`PSP`
- `english_name` の中にすでに機種名が入っている場合は、重複させない。
- 状態サフィックス：`condition=new` のときのみ ` New Sealed`。それ以外は付けない。
- 半角英数字と一般的な記号のみとし、全角文字・絵文字は除去する。連続スペースは1つにまとめる。
- **80文字以内**。超える場合は状態サフィックス → `Ver.` → `english_name` の末尾（単語単位）の順に削り、`status` を `review` にする。
- 禁止：`English` / `Multi-language` / `Region Free` / `Rare` / `L@@K` / `!` / `*` など。言語対応は手動でのみ追加する。

## 5. pj_price側（出品リストタブ）
- 「英語タイトル生成」ボタンを追加する。未生成の行だけを20件ずつ送り、進捗を「12/48」のように表示する。
- 各行に、編集可能な英語タイトル欄・文字数カウンター（80超は赤）・statusバッジ（ok=緑／review=黄／not_found=灰）を表示する。候補元タイトルは折りたたみで見られるようにする。
- 手動で編集した行には「編集済み」フラグを立て、再生成で上書きしない。行ごとの「再生成（force）」ボタンは別に用意する。
- CSV書き出しでは、画面上の（編集後の）タイトルを使う。書き出し形式は数量更新CSVと同じルール（引用符は必要な項目のみ・CRLF・UTF-8 BOMなし）に従う。
- WorkerのURLと `PJ_ACCESS_KEY` は設定画面で入力し、localStorageに保存する（リポジトリには書かない）。
- sw.jsのキャッシュバージョンを上げる。

## 6. 着手前の確認（Claude Codeが最初に行う）
1. SP-APIアプリで、米国（NA）マーケットプレイスの認可が取れるかを確認する。**取れない場合は米国照会なしで実装を進め**、その旨を報告する。
2. eBay Browse APIの `gtin` 検索で、実在するJAN（カジが在庫から10件提供）について結果が返るかを確認する。

## 7. 受け入れテスト
- カジが提供する実在庫のJAN 10件（機種混在）で実行し、JAN・status・title・sourcesを一覧表示する。
- `invalid_jan`（桁数違い・チェックディジット違い）が正しく判定される。
- 2回目の実行ではKVキャッシュが効き、eBay・SP-APIへの呼び出しが発生しない（ログで確認）。
- 全タイトルが80文字以内で、禁止語を含まない。

## 8. スコープ外（今回はやらない）
- 言語対応（English Supported等）の自動判定
- Item Specifics（Platform / Region Code / Genre等）の自動入力 → フェイズ3候補
- フィギュア・アーケードパーツへの対応

## 9. 既存「自動で振り分け」（出品文タブ）の確認
- 出品文タブの「自動で振り分け」が、どういう仕組みで英語化しているか（辞書／ルール／外部API）を調べて報告する。なお、リポジトリ内にClaude APIの呼び出しはない。
- 英語名の抽出（/titles）に流用できる辞書やルールがあれば活用する。
- 既存機能の動作は変えない。

## 10. 作業の進め方
1. 6章の着手前確認と、9章の調査を先に行い、結果を報告する。
2. Workerを実装し、必要なシークレット名とコマンドの一覧を出す（値の登録はカジが行う）。
3. カジがシークレットを登録したら、7章の受け入れテストを実行する。
4. pj_price側のUIを実装し、sw.jsのキャッシュバージョンを上げて、mainにpushする。
