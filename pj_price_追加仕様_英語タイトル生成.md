# pj_price 追加仕様：JANコードから英語タイトルを自動生成（フェイズ2）

## 1. 目的
出品リストタブ（せどりすとCSV取り込み）の各商品について、JANコードからeBay用の英語タイトルを自動生成する。
生成結果は人が確認・編集してから、eBay一括出品CSVに書き出す。

対象はゲームソフトとし、機種は Switch 2 / Switch / PS5 / PS4 / PS3 / PS2 / PS Vita / PSP /
3DS / DS とする（3DS・DS は 2026-09-24 に追加）。
箱説自体に価値のあるレトロゲームは対象外。**対象外の機種の行は /titles を呼ばない**（2026-09-24 決定）。

> **2026-09-24 の決定**
> - タイトルの書式は**既存の `buildGameTitle()` に統一する**。/titles は
>   `english_name` / `status` / `sources` / `candidates` だけを返し、タイトルは作らない。
>   旧4章の `{english_name} {機種表記} Japan Ver.` 書式は廃止。80文字チェックと
>   禁止語チェックだけを残す。
> - 既存の `csvIssues()`（「中古なのに英題にUsedがない」等）は変更しない。
> - 機種の変換表は1つにまとめ、タイトル用の表記と Item Specifics 用の値の両方を
>   そこから引く。
> - 既存の `CSV_PLAT` の不具合（`Switch 2` → `Nintendo Switch`）を
>   `Nintendo Switch 2` に修正する。
> - ゲーム行では既存の `btnParse`（フィギュア向けの自動振り分け＝Claude API）を呼ばない。
> - SP-APIの米国（NA）は「なし」で進める。`SPAPI_REFRESH_TOKEN_NA` があるときだけ
>   米国照会を行う分岐は残す。
> - eBayの `gtin` 検索が0件のときは `q={JAN}` のキーワード検索を行う。
> - `/debug/gtin` は受け入れテスト用。**2026-09-24 の受け入れテスト合格をもって削除済み。**
>
> **2026-09-24 追記（受け入れテスト後）**
> - 3DS・DS を対象機種に追加する。
> - 3DS は本体側がリージョンロックされているため、出品文に
>   「日本の3DS本体でのみ動作する」旨の節を必ず入れる（Japanese version の
>   チェックに関係なく出す）。
> - 緋色の欠片の期待値は Vita 版の正式名に合わせて
>   `Hiiro no Kakera: Omoi Iro no Kioku` とする。

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
- ただし1件あたり最大5回ほど外部APIを呼ぶため、Workers無料プランの
  「1リクエスト50サブリクエスト」に触れる。**pj_price側は既定で10件ずつ送る。**

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
  "sources": ["ebay", "ebay_keyword", "amazon_us", "amazon_jp", "translation"],
  "candidates": ["…eBay/Amazonで見つかった元タイトル（最大5件）"],
  "note": "…判断理由を短く",
  "log": ["…受け入れテスト用。どのAPIを叩いたか"]
} ] }
```

`title` と `length` は返さない。タイトルの組み立てと80文字の収め方は
pj_price 側の `buildGameTitle()` が持つ（書式を2か所に置かない）。
キャッシュから返した行には `"cached": true` が付く。

### 3.4 処理の流れ（1件ごと。並列数は最大4）
1. **JAN検証**：13桁（または8桁）の数字であることと、チェックディジットを確認する。NGなら `invalid_jan` を返す。
2. **キャッシュ確認**：`title:v1:{jan}` を確認する。`force=false` でヒットすれば、`english_name` を再利用してタイトル組み立て（手順6）だけを行う。
3. **eBay Browse API**
   - トークンはClient Credentials方式（`POST https://api.ebay.com/identity/v1/oauth2/token`、scope `https://api.ebay.com/oauth/api_scope`）で取得し、KVに有効期限の少し手前までキャッシュする。
   - 検索は `GET https://api.ebay.com/buy/browse/v1/item_summary/search?gtin={jan}&limit=20` とし、ヘッダーに `X-EBAY-C-MARKETPLACE-ID: EBAY_US` を付ける。
   - 返ってきた `title` を候補として集める。
   - **`gtin` が0件のときは `q={JAN}` でキーワード検索し直す**（日本のゲームは
     米国出品にGTINが入っていないことが多いため）。こちらで拾った場合は
     `sources` に `ebay_keyword` を入れ、`status` は `review` にする。
     どちらも0件なら次へ進む。
4. **Amazon SP-API（Catalog Items API 2022-04-01 `searchCatalogItems`）**
   - LWAでアクセストークンを取得する（SigV4署名は不要）。
   - 米国：`sellingpartnerapi-na.amazon.com`、marketplace `ATVPDKIKX0DER`、`identifiers={jan}&identifiersType=EAN&includedData=summaries`。**`SPAPI_REFRESH_TOKEN_NA` がない場合はスキップ**する。
   - 日本：`sellingpartnerapi-fe.amazon.com`、marketplace `A1VC38T7YXB528`。日本語名・ブランド・機種の補強に使う。
4.5 **候補の事前フィルタ（コード側・2026-09-24 追加）**
   - 商品の特定は `ja_title` と `platform` を正とする。eBay候補は**英語表記の参考にだけ**使う。
   - 入力と違う機種名しか入っていない候補は落とす（PSP / PS Vita / PS4 …）。
   - セット品（`+` / `set` / `bundle` / `x2` / `lot` / `double pack` など）は、
     `ja_title` がセット（セット・まとめ・同梱・2本・＋）でない限り落とす。
   - `ja_title` の全角ローマ数字（Ⅲ 等）は III 等に正規化してから渡す。

5. **英語名の抽出（Claude API）**
   - モデルは `claude-haiku-4-5-20251001` を使う。
   - 入力：日本語名、機種、eBay候補、Amazon US候補、Amazon JPの情報。
   - 出力はJSONのみとする：`{"english_name": "...", "confidence": "high|medium|low", "basis": "ebay|amazon_us|translation", "same_item": true|false}`
   - `same_item` は「候補の少なくとも1件が、与えた日本語名・機種と同じ商品だと
     はっきり言えるか」。言えなければ候補を無視して日本語名から翻訳する。
   - プロンプトで守らせること：
     - 公式の英語タイトルが候補にあればそれを優先する。
     - 候補タイトル中の機種名・Japan・Import・状態語・セラー独自の飾り文句は除去する。
     - 候補がなければ日本語名から翻訳する（その場合 `confidence` は `low`）。
     - 言語対応（English等）については一切書かない。
6. **タイトル組み立て（コード側）**：4章のルールで組み立てる。
7. **statusの判定**（2026-09-24 改訂）
   - `ok`：`confidence` が `high` **かつ** `same_item` が true で、なおかつ
     「**絞り込み後**の候補2件以上が、決めた `english_name` と一致している（gtin検索）」
     または「Amazon US で見つかった」。
     セット品は事前フィルタで落としてあるので、セット同士の一致で `ok` にはならない。
   - `review`：それ以外（翻訳のみ、候補が同じ商品と確認できない、禁止語を除去した、など）。
   - `not_found`：候補も日本語名もない。
   - 80文字の判定は pj_price 側で行う（Worker はタイトルを作らないため）。
8. **キャッシュ保存**：`english_name`・`sources`・`candidates` を90日間保存する（タイトル本体は保存せず、毎回組み立てる）。

## 4. タイトルの扱い（2026-09-24 改訂）

タイトルは**既存の `buildGameTitle()` がそのまま組み立てる**。書式は変更しない。

```
[Used] {機種} {ソフト名} Japan Import
```

- `{ソフト名}` に /titles が返した `english_name` を入れる（出品文タブの「タイトル（ソフト名）」欄）。
- `Used` の有無・`Japan Import` の付け外し・80文字に収める処理は、すべて既存の
  `buildGameTitle()` の動作をそのまま使う。
- 機種表記は機種の変換表（タイトル用の綴り）から引く。

Worker側に残すのは次の2つだけ。

- **禁止語チェック**：`english_name` から `English` / `Multi-language` / `Region Free` /
  `Rare` / `L@@K` / `!` / `*` と、機種名・`Japan Import` / `Ver.` / `Used` / `New Sealed`
  などの定型部分を取り除く。取り除いたときは `status` を `review` にする。
  言語対応は手動でのみ追加する。
- **文字種の正規化**：半角英数字と一般的な記号のみにする。全角英数字は半角へ、
  活字の約物（’ “ ” – …）はASCIIへ置き換え、残った全角文字・絵文字は落とす。
  連続スペースは1つにまとめる。

**80文字チェック**は pj_price 側で行う（既存のタイトル文字数カウンターと
`buildGameTitle()` の切り詰めをそのまま使う）。

## 5. pj_price側（出品リストタブ）※ 2026-09-24 実装済み（sw.js v61）
- 「英語タイトル生成」ボタンを追加する。未生成の行だけを20件ずつ送り、進捗を「12/48」のように表示する。
- 各行に、編集可能な英語タイトル欄・文字数カウンター（80超は赤）・statusバッジ（ok=緑／review=黄／not_found=灰）を表示する。候補元タイトルは折りたたみで見られるようにする。
- 手動で編集した行には「編集済み」フラグを立て、再生成で上書きしない。行ごとの「再生成（force）」ボタンは別に用意する。
- CSV書き出しでは、画面上の（編集後の）タイトルを使う。書き出し形式は数量更新CSVと同じルール（引用符は必要な項目のみ・CRLF・UTF-8 BOMなし）に従う。**この形式は v60 で対応済み。**
- 対象外の機種（DS / 3DS / Wii / Xbox など）の行は送らず、画面に「対象外の機種」と表示する。
- 機種の変換表を1つにまとめ、タイトル用の表記（`Nintendo Switch` / `PS5` …）と
  Item Specifics 用の値（`Sony PlayStation 5` …）の両方をそこから引く。
  既存の `CSV_PLAT` の `Switch 2` → `Nintendo Switch` は `Nintendo Switch 2` に直す。
- ゲーム行では既存の `btnParse`（フィギュア向けの自動振り分け）を呼ばない。
- WorkerのURLと `PJ_ACCESS_KEY` は設定画面で入力し、localStorageに保存する（リポジトリには書かない）。
- sw.jsのキャッシュバージョンを上げる。

## 6. 着手前の確認（Claude Codeが最初に行う）
1. SP-APIアプリで、米国（NA）マーケットプレイスの認可が取れるかを確認する。**取れない場合は米国照会なしで実装を進め**、その旨を報告する。
2. eBay Browse APIの `gtin` 検索で、実在するJAN（カジが在庫から10件提供）について結果が返るかを確認する。

### 確認結果（2026-09-24）
1. **米国（NA）は「なし」で進める**。`SPAPI_REFRESH_TOKEN_NA` が登録されたときだけ
   米国照会が動く分岐は実装済み。
2. `gtin` の当たり方は、キー登録後に `/debug/gtin` で実測した（開発環境から
   api.ebay.com へ出られないため、事前確認はできなかった）。
   **6件とも gtin でヒット**。`gtin` を主、0件時の `q={JAN}` を予備のままとする。
   `/debug/gtin` は役目を終えたので削除した。

## 7. 受け入れテスト
- カジが提供する実在庫のJAN 10件（機種混在）で実行し、JAN・status・title・sourcesを一覧表示する。
- `invalid_jan`（桁数違い・チェックディジット違い）が正しく判定される。
- 2回目の実行ではKVキャッシュが効き、eBay・SP-APIへの呼び出しが発生しない（ログで確認）。
- 全タイトルが80文字以内で、禁止語を含まない。
- 言語対応表記（Multilingual / Multi-Language / English / ENG SUB 等）が
  `english_name` に残らない。
- 次の6件で期待どおりの `english_name` が出る。

| JAN | 和名 | 機種 | 期待する english_name | 備考 |
|---|---|---|---|---|
| 4562252050401 | 雷電Ⅲ×MIKADO MANIAX | Switch | Raiden III x Mikado Maniax | |
| 4571442047619 | サイキック5 エターナル | Switch | Psychic 5 Eternal | |
| 4995857095025 | 緋色の欠片 | PS Vita | Hiiro no Kakera: Omoi Iro no Kioku | 公式英題なし。`review` でよい |
| 4544626010365 | AKIBA'S BEAT | PS4 | Akiba's Beat | |
| 4582350660326 | METAL MAX Xeno | PS4 | Metal Max Xeno | |
| 4997766201382 | Steins;Gate | PSP | Steins;Gate | |

### 受け入れテストの結果（2026-09-24・実データ）

| JAN | status | english_name |
|---|---|---|
| 4562252050401 | review | Raiden III x MIKADO MANIAX（別商品2件除外／候補少） |
| 4571442047619 | ok | Psychic 5 Eternal |
| 4995857095025 | review | Hiiro no Kakera: Omoi Iro no Kioku（別商品1件除外／候補少） |
| 4544626010365 | ok | Akiba's Beat |
| 4582350660326 | ok | Metal Max Xeno |
| 4997766201382 | ok | Steins;Gate（別商品6件除外） |

**合格。** review の規則は現状のままとする。

## 8. スコープ外（今回はやらない）
- 言語対応（English Supported等）の自動判定
- Item Specifics（Platform / Region Code / Genre等）の自動入力 → フェイズ3候補
- フィギュア・アーケードパーツへの対応

## 9. 既存「自動で振り分け」（出品文タブ）の調査結果（2026-09-24）

> ⚠ 旧記述の「リポジトリ内にClaude APIの呼び出しはない」は**誤り**だったため訂正する。

- 仕組み：`#btnParse` が貼り付けテキストを `PARSE_API`
  （`https://pj-price.gamegamesan.workers.dev`）へ POST し、Worker `proxy/worker.js` が
  **Claude API**（`api.anthropic.com/v1/messages`・`claude-haiku-4-5`・max_tokens 300）を
  呼んで `brand/series/chara/variant/line` の5項目JSONを返す。
  ローカルの日本語→英語辞書やルール変換は**ない**。
- 流用したもの：`proxy/worker.js` の構造（オリジン限定CORS・Origin検証・モデルと
  プロンプトのサーバ側固定・入力長上限・JSON抽出の `normalize()`）を `proxy-title/` に流用。
- 流用できる辞書：`CSV_PLAT`（機種の和名・略称 → eBay値）、`CSV_BRAND`、`CSV_PUB`。
  日本語→英語の商品名辞書は存在しない。
- ゲームへの流用は限定的：`applyCat()` が `pasteBlock` をゲーム／アーケードでは
  非表示にしており、返る5項目はフィギュア欄にしか入らないため、
  **自動振り分けの結果はゲームの英題に反映されない**。
  そのうえで、CSVタブから英題が空のゲーム行を開くと `btnParse` が実行され、
  無駄にClaude APIを呼んでいた。ゲーム行では呼ばないよう止める（5章）。
- 既存のフィギュア向けの動作そのものは変えない。

## 10. 作業の進め方
1. 6章の着手前確認と、9章の調査を先に行い、結果を報告する。
2. Workerを実装し、必要なシークレット名とコマンドの一覧を出す（値の登録はカジが行う）。
3. カジがシークレットを登録したら、7章の受け入れテストを実行する。
4. pj_price側のUIを実装し、sw.jsのキャッシュバージョンを上げて、mainにpushする。
