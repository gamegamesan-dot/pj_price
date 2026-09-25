# pj_price 追加仕様：フィギュアの英語タイトル一括生成（フェイズ3）

## 1. 目的
出品CSVタブのフィギュア行について、英語タイトルを一括で生成する。ゲームの一括生成（フェイズ2）と同じように使えることを目指す。

- JANがある行：JANをキーに、eBayの候補とAmazon（日本）の情報を使う。
- **JANがない行：ASINでAmazon（日本）のカタログを検索し、その情報からタイトルを作る。**
- 生成結果は、人が確認・編集してからCSVに書き出す。

## 2. 基本方針（フェイズ2の決定を踏襲）
- 商品の特定は、日本語名（ja_title）とAmazonのカタログ情報を正とする。eBayの候補は、英語表記（キャラクター名・作品名の綴り）の参考にだけ使う。
- AIが返すのは、既存の「自動で振り分け」と同じ5項目（brand / series / chara / variant / line）と判定情報のみ。**タイトルの組み立ては、pj_price側の既存のフィギュア用タイトル組み立て処理で行う**（店全体で書式をそろえるため）。
- 既存の出品文タブ「自動で振り分け」（pj-price Worker の /classify 相当）の動作は変えない。プロンプトと正規化処理は、参考にして流用してよい。

## 3. Worker（pj-title に追加）

### 3.1 エンドポイント
`POST /figure-titles`（認証・CORS・件数上限は /titles と同じ。pj_price側は10件ずつ送る）

リクエスト：
```json
{ "items": [ { "jan": "4983164…", "asin": "B0XXXXXXXX", "ja_title": "…", "condition": "used" } ], "force": false }
```
jan と asin は、どちらか一方があればよい（両方なければ `invalid_id`）。

レスポンス（入力順を保持）：
```json
{ "results": [ {
  "key": "jan:4983164… または asin:B0…",
  "status": "ok | review | not_found | invalid_id",
  "fields": { "brand": "", "series": "", "chara": "", "variant": "", "line": "" },
  "jan_resolved": "ASINから判明したJAN（あれば）",
  "sources": ["ebay", "ebay_keyword", "amazon_jp_jan", "amazon_jp_asin"],
  "candidates": ["…最大5件"],
  "note": "…"
} ] }
```

### 3.2 処理の流れ
1. **ID検証**：JANはフェイズ2と同じくチェックディジットまで確認する。ASINは10桁の英数字であることを確認する。
2. **キャッシュ確認**：`fig:v1:jan:{jan}` または `fig:v1:asin:{asin}` を確認する（90日保存）。
3. **Amazon（日本）のカタログ照会**（SP-API、`A1VC38T7YXB528`、`includedData=summaries,attributes,identifiers`）
   - JANがある場合：`identifiersType=EAN` で照会する。
   - **JANがない場合：`identifiersType=ASIN` で照会する。**
   - 取得するもの：商品名、ブランド／メーカー、シリーズ、商品分類。
   - **ASINで照会したとき、カタログの identifiers にEAN（JAN）が含まれていれば `jan_resolved` として返し、手順4のeBay検索にも使う。**
4. **eBay Browse API**（JANか `jan_resolved` がある場合のみ）
   - `gtin` で検索し、0件なら `q={JAN}` で検索する（フェイズ2と同じ）。
   - 事前フィルタ（コード側）：セット品・まとめ売り（`set`, `lot`, `bundle`, `x2` など）は、ja_title がセットでない限り除外する。明らかに別キャラクターの候補の除外は、AIの判断に任せる。
5. **5項目の抽出（Claude API、`claude-haiku-4-5-20251001`）**
   - 入力：ja_title、Amazon（日本）の情報、eBay候補。
   - 出力（JSONのみ）：`{ "brand": "", "series": "", "chara": "", "variant": "", "line": "", "confidence": "high|medium|low", "same_item": true|false }`
   - プロンプトで守らせること：
     - キャラクター名・作品名は、公式の英語表記があればそれを使う。なければ公式のローマ字表記を使う。**候補にない名前を作らない。**
     - ブランドは正式名に正規化する（例：バンプレスト→Banpresto、BANDAI SPIRITS→Bandai Spirits、グッドスマイルカンパニー→Good Smile Company、メガハウス→MegaHouse、タイトー→Taito、セガ→SEGA、フリュー→FuRyu）。既存の CSV_BRAND があればそれに合わせる。
     - 商品ライン（line）は、ja_title やカタログに明記されている場合だけ入れる（例：一番くじ→Ichiban Kuji、ねんどろいど→Nendoroid、figma、POP UP PARADE、Figuarts ZERO、S.H.Figuarts）。
     - 一番くじの賞（A賞など）やカラー違いなどは variant に入れる（例：`Prize A`、`Special Color Ver.`）。
     - 言語対応・状態・「Japan」・「Authentic」などの飾り文句は入れない。
6. **statusの判定**
   - `ok`：`confidence=high` かつ `same_item=true` で、かつ次のどちらかを満たす場合。
     - eBay候補2件以上で chara と series が一致している。
     - Amazon（日本）のブランドと brand が一致している。
   - `review`：それ以外。**ASINのみでeBay候補がない行は、初期運用では必ず review にする。**
   - `not_found`：Amazonでも見つからず、ja_title からも判断できない場合。
7. **キャッシュ保存**：fields・sources・candidates・jan_resolved を保存する。

### 3.3 サブリクエスト数
1件あたり最大でSP-API 2回、eBay 3回、Claude 1回程度を見込む。10件ずつなら無料プランの上限（50）に収まることを実測で確認し、収まらなければ1回あたりの件数を下げる。

## 4. pj_price側（出品CSVタブ）
- 一括の「英語タイトル生成」ボタンで、ゲーム行とフィギュア行の両方を処理する。ゲームは /titles、フィギュアは /figure-titles に送る。進捗表示は合算する。
- フィギュア行のASINは、行のSKU（例：`…-B0C1ZJPDV4-…`）またはせどりすとCSVのASIN列から取る。JANは、せどりすとCSVにあればそれを使う。
- Workerが `jan_resolved` を返した場合は、行のJANとして保存する（UPC/EAN欄にも使う）。
- 返ってきた5項目を、既存のフィギュア用タイトル組み立て処理に通して英題を作る。あわせて Item Specifics（Brand / Franchise / Character など、既存の対応に合わせる）にも入れる。
- 行の表示：英題欄・文字数（80超は赤、72超は黄）・statusバッジ・候補の折りたたみ・再生成ボタンは、ゲームと同じ。加えて、**5項目を折りたたみで表示し、個別に編集できる**ようにする。編集したら英題を組み直し、「編集済み」扱いにする（一括生成で上書きしない）。
- 行から「出品文を作る」で出品文タブを開いたときは、5項目を出品文タブの各欄に自動で入れる。
- sw.jsのキャッシュバージョンを上げる。

## 5. 着手前の確認（Claude Codeが最初に行い、結果を報告して止まる）
1. 既存のフィギュア用タイトル組み立て処理の関数名と書式、および Used の付け方。
2. せどりすとCSVのフィギュア行で、JAN・ASINがどの列にどの程度入っているか。取り込み済みデータでの内訳（JANあり／ASINのみ）を報告する。
3. 既存の /classify（pj-price Worker）のプロンプトと出力形式。流用する範囲を提案する。
4. CSV_BRAND の内容と、3.2の5で挙げたブランド正規化との差分。

### 5章の確認結果と決定（2026-09-25・実装済み sw.js v65）

1. **フィギュアのタイトルは `figTitleFrom(used, parts)`**。
   `[Used] ブランド 作品名 キャラクター 版 商品ライン Figure` の順。
   80字を超えたら 商品ライン → 版 → ブランド の順に落とす（`Used` は落とさない）。
   **中古は先頭に `Used` を付ける**ことにした（ゲーム・アーケードと揃える）。
   これで `csvIssues()` の「中古なのに英題にUsedがない」と整合し、
   中古フィギュアがCSV書き出しから除外されなくなる。
2. **`CSV_BRAND` を正式な社名の表記に改訂**。`BANPRESTO`→`Banpresto`、
   `KOTOBUKIYA`→`Kotobukiya`。`Bandai Spirits`・`MegaHouse` を追加。
   照合は大文字小文字を区別しない。
3. **商品ラインは `CSV_LINE` に分離**。`S.H.Figuarts`（親ブランド Bandai Spirits）と
   `Nendoroid`（親ブランド Good Smile Company）は Brand ではなく `specs.line` に入れる。
   ブランドが別に見つからないときだけ親ブランドを Brand に使う。
   保存済みの行は読み込み時に移行する。
4. **写真のタップは3択メニュー**（メインにする／削除する／キャンセル）。
   連続ダイアログは廃止。**ItemIDが入っている行では R2 の実体を消さず、行から外すだけ**にし、
   確認文でその旨を伝える。

### 5-2 の内訳（2026-09-25・sedolist_7.csv を取り込んで実測）

| | 件数 |
|---|---|
| フィギュア行（hobby / toy） | **24件** |
| └ JANあり | 18件 |
| └ **JANなし（ASINのみ）** | **6件** |
| └ ASINなし | 0件 |
| ゲーム行 | 2件 |

- ASINは全行にあり、`ASIN` 列と SKU の4番目が一致していた。JANの桁数・
  チェックディジットの不正は0件。
- ブランド・ラインの自動割り当て：Good Smile Company / Nendoroid 10件、
  Bandai Spirits / S.H.Figuarts 2件、Banpresto 2件、**未割り当て12件**。
  未割り当ての主なものは `figma` 3件と `POP UP PARADE` 3件で、いずれも商品ラインなので
  Worker 側の `FIG_LINE` に追加した（figma→Max Factory、POP UP PARADE→Good Smile Company）。

## 6. 受け入れテスト

実行スクリプトは `proxy-title/test-figure.ps1`（PowerShell・UTF-8 BOM付き）。

```
.\test-figure.ps1 -Base "https://pj-title.xxxx.workers.dev" -Key "<PJ_ACCESS_KEY>"
```

対象の10件（`sedolist_7.csv` から選定。JANなし5件・中古2件・プライズ2件を含む）:

| # | JAN | ASIN | 状態 | 商品 | 系統 |
|---|---|---|---|---|---|
| 1 | なし | B0CH8QT1LX | 新品 | Banpresto Umamusume Air Groove | プライズ |
| 2 | なし | B0BZZL3BNS | 新品 | バンプレスト うる星やつら GLITTER&GLAMOURS LUM B | プライズ（variant に B が入るか） |
| 3 | なし | B092VH4SBJ | 新品 | figma 鬼滅の刃 我妻善逸 DXエディション | figma |
| 4 | なし | B01CCIH11S | 新品 | ねんどろいど 刀剣乱舞 蛍丸 | Nendoroid |
| 5 | なし | B0FPX7HNXN | 新品 | ねんどろいど 鬼滅の刃 冨岡義勇 | Nendoroid |
| 6 | 4580590128217 | B09TPBVJ5F | **中古** | ねんどろいど ハイキュー!! 黒尾鉄朗 | Nendoroid（`Haikyu!!` の `!!`） |
| 7 | 4573102687647 | B0FB8F42GQ | 新品 | TAMASHII NATIONS S.H.フィギュアーツ 新サイクロン号 | S.H.Figuarts |
| 8 | 4580416947480 | B0C3D1STPH | 新品 | POP UP PARADE ナデシコ ホシノ・ルリ | POP UP PARADE |
| 9 | 4573102665973 | B0G6LRMPS5 | 新品 | 超合金 CHOGOKIN ROBO 50 | CHOGOKIN |
| 10 | 4580522750165 | B0BHHJW4KR | **中古** | ワンダフルワークス ライザのアトリエ2 クラウディア | 1/7スケール |

一番くじは今回の在庫に該当がないため対象外。

### 確認項目

- カジが提供する実在庫のフィギュア10件（**JANなし3件以上を含む**。プライズ・一番くじ・スケール／ねんどろいど系を混ぜる）で実行し、key・status・5項目・英題・sources・jan_resolved を一覧表示する。
- JANなしの行で、ASINからJANが判明したものは eBay 候補が使われている（sources に ebay が入る）。
- JANもASINもない行は `invalid_id` になり、ほかの行の処理は止まらない。
- 2回目の実行ではKVキャッシュが効き、外部APIの呼び出しが0回になる。
- 全タイトルが80文字以内で、禁止語を含まない。
- ゲーム行とフィギュア行が混在したCSVで、一括ボタン1回で両方処理される。
- 既存の出品文タブ「自動で振り分け」の動作が変わっていない。

## 7. スコープ外
- アーケードパーツ、中古レンズ、イヤホン・ヘッドフォン
- フィギュアの状態（箱ダメージ等）の自動記載
- 米国Amazonでの照会

## 8. 作業の進め方
1. 5章の確認結果を報告して止まる。
2. カジの判断を受けて Worker を実装する（新しいシークレットは不要。デプロイが必要な旨を報告する）。
3. カジがデプロイしたら、6章の受け入れテストを実データで行う（手順と PowerShell のコマンドを提示する）。
4. pj_price側を実装し、sw.jsのバージョンを上げて main に push する。
