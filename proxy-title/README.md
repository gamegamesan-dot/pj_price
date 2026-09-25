# pj-title（英語タイトル補助 Worker）

JANコードから **英語の商品名（english_name）だけ** を特定して返す Worker。
タイトルの組み立ては pj_price 側の `buildGameTitle()` が行うため、この Worker は
タイトル文字列を作らない（書式を2か所に持たない）。

対象はゲームソフト。機種は Switch 2 / Switch / PS5 / PS4 / PS3 / PS2 / PS Vita / PSP / 3DS / DS。
対象外の機種の行は pj_price 側で送信しない。

## 1. KV を作る

```
cd proxy-title
npx wrangler kv namespace create TITLE_CACHE
```

出力された `id` を `wrangler.toml` の `[[kv_namespaces]] id` に貼る。

## 2. シークレットを登録する

**値はリポジトリにも会話にも書かない。** 下のコマンドを実行し、プロンプトに値を貼る。

| 名前 | 内容 | 必須 |
|---|---|---|
| `PJ_ACCESS_KEY` | pj_price から送る共有キー（ヘッダー `X-PJ-Key`）。十分に長いランダム文字列 | 必須 |
| `EBAY_CLIENT_ID` | eBay本番アプリの App ID | 必須 |
| `EBAY_CLIENT_SECRET` | eBay本番アプリの Cert ID | 必須 |
| `ANTHROPIC_API_KEY` | Claude API（この Worker 専用に新規発行する） | 必須 |
| `LWA_CLIENT_ID` | SP-APIアプリの LWA Client ID | 任意 |
| `LWA_CLIENT_SECRET` | SP-APIアプリの LWA Client Secret | 任意 |
| `SPAPI_REFRESH_TOKEN_FE` | 日本（FE）のリフレッシュトークン | 任意 |
| `SPAPI_REFRESH_TOKEN_NA` | 米国（NA）のリフレッシュトークン。**未登録なら米国照会はスキップ** | 任意 |

```
cd proxy-title
npx wrangler secret put PJ_ACCESS_KEY
npx wrangler secret put EBAY_CLIENT_ID
npx wrangler secret put EBAY_CLIENT_SECRET
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put LWA_CLIENT_ID
npx wrangler secret put LWA_CLIENT_SECRET
npx wrangler secret put SPAPI_REFRESH_TOKEN_FE
npx wrangler secret put SPAPI_REFRESH_TOKEN_NA
```

任意のものは未登録でも動く。その系統の照会をまるごとスキップし、
`sources` にその出どころが入らないだけ。

登録済みの一覧は `npx wrangler secret list` で確認できる（値は表示されない）。

## 3. デプロイ

```
cd proxy-title
npx wrangler deploy
```

公開URL（`https://pj-title.<サブドメイン>.workers.dev`）を、pj_price の
出品CSVタブの設定欄に入力する。`PJ_ACCESS_KEY` と同じ値も同じ画面に入力する
（localStorage に保存され、リポジトリには入らない）。

## 4. エンドポイント

### `POST /titles`

ヘッダー `X-PJ-Key: <PJ_ACCESS_KEY>` 必須。1リクエスト最大20件。

```json
{ "items": [ { "jan": "4562252050401", "ja_title": "雷電III×MIKADO MANIAX -Switch",
               "platform": "Nintendo Switch", "condition": "new" } ], "force": false }
```

レスポンスは `items` と同じ順。

```json
{ "results": [ {
  "jan": "4562252050401",
  "status": "ok",
  "english_name": "Raiden III x MIKADO MANIAX",
  "sources": ["ebay", "amazon_jp"],
  "candidates": ["…見つかった元タイトル（最大5件）"],
  "note": "候補と一致"
} ] }
```

- `status`
  - `ok` … gtin検索で候補が2件以上あって確信度が high、または Amazon US で見つかって確信度が high
  - `review` … それ以外（翻訳のみ／候補が少ない／禁止語を除去した、など）
  - `not_found` … 候補も日本語名もない
  - `invalid_jan` … 桁数かチェックディジットが不正
- `title` と `length` は**返さない**。タイトルは pj_price の `buildGameTitle()` が組み立て、
  80文字の収め方もそちらが持つ。
- `english_name` からは機種名・状態語・`Japan Import` / `Ver.` などの定型部分、
  および禁止語（English / ENG SUB / Multilingual / Multi-Language / Region Free /
  Rare / L@@K / `!` / `*`）を取り除いてある。
- 商品の特定は `ja_title` と `platform` が正。eBay候補は英語表記の参考にしか使わない。
  AIへ渡す前に、**入力と違う機種の候補**と、**セット品の候補**（`ja_title` が
  セットでない限り）をコード側で落とす。落とした内訳は `log` に残る。
- `ja_title` の全角ローマ数字（Ⅲ）は III に直してから渡す。
- キャッシュは JAN 単位で90日。`force: true` で作り直す。

### `POST /figure-titles`

フィギュア用。ヘッダー `X-PJ-Key` 必須。1リクエスト最大20件。
返すのは5項目だけで、**タイトルは組み立てない**（pj_price の `figTitleFrom()` が行う）。

```json
{ "items": [ { "jan": "4580590128217", "asin": "B09TPBVJ5F",
               "ja_title": "ねんどろいど ハイキュー!! 黒尾鉄朗", "condition": "new" } ], "force": false }
```

`jan` と `asin` はどちらか一方あればよい（両方なければ `invalid_id`）。

```json
{ "results": [ {
  "key": "jan:4580590128217",
  "status": "ok | review | not_found | invalid_id",
  "fields": { "brand": "Good Smile Company", "series": "Haikyu!!",
              "chara": "Tetsuro Kuroo", "variant": "Second Uniform", "line": "Nendoroid" },
  "jan_resolved": "ASINから判明したJAN（あれば）",
  "sources": ["ebay", "amazon_jp_jan"],
  "candidates": ["…最大5件"],
  "note": "…"
} ] }
```

- JANがあれば `identifiersType=EAN`、無ければ `ASIN` で Amazon（日本）を引く。
  ASINで引いたとき、カタログの identifiers に EAN があれば `jan_resolved` として返し、
  eBay検索にも使う。
- eBay候補はセット品（`set` / `bundle` / `x2` など）を、`ja_title` がセットでない限り落とす。
  別キャラクターの見分けはAIに任せる。
- `ok` は `confidence=high` かつ `same_item=true` で、さらに「候補2件以上が chara と
  series の両方を含む」か「Amazonのブランドと brand が一致」のどちらかを満たすとき。
  **JANが分からずeBayで照合できていない行は必ず `review`。**
- ブランドと商品ラインは Worker 側の表でも正規化する（pj_price の `CSV_BRAND` /
  `CSV_LINE` と同じ表記）。
- キャッシュは `fig:v1:jan:…` / `fig:v1:asin:…` で90日。

## 5. 安全側の設計

- CORS は `https://gamegamesan-dot.github.io` のみ。`X-PJ-Key` 不一致は 401。
- モデル・system プロンプト・`max_tokens` はサーバ側で固定（汎用プロキシにしない）。
- 1リクエスト20件・同時4並列・日本語名200文字までで、コストの上限を抑える。
- レート制限は Cloudflare ダッシュボードの Rate Limiting ルールで運用する。

### サブリクエスト数に注意

1件あたり最大5回ほど外に出る（eBayトークン＋検索1〜2回、LWAトークン、SP-API 1〜2回、
Claude 1回）。トークンはKVに載るので2件目以降は減るが、**20件だと80〜100回**になる。
Workers の無料プランは**1リクエストあたり50サブリクエスト**までなので、
pj_price 側は既定で**10件ずつ**送る。有料プラン（1,000まで）なら20件でも足りる。

`/figure-titles` は10件で**実測35回**。すべてJANなし＋キーワード検索まで行く
最悪ケースでも48回で、上限50にかなり近い。件数を増やすなら有料プランが要る。
