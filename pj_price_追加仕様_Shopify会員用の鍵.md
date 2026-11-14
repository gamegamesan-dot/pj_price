# 会員用商品の鍵（Shopify のテーマ Liquid・SHOPLOCK なし）

pj_price 8.24 ／ 2026-11-14 ／ ストア：Omakase Ship ／ テーマ：**Rise**

> カジの依頼「SHOPLOCK に頼らずテーマの Liquid で鍵を作りたい。
> プランの区別（grade-◯◯）も効くようにしてほしい。」

## 0. なぜ作り直すか

| 今の困りごと（SHOPLOCK） | この鍵では |
| --- | --- |
| 顧客タグ `member-list` があるかしか見ない。会員ならどのプランの商品でも買える | **商品の `grade-◯◯` と顧客の `grade-◯◯` が合うかまで見る** |
| コレクションのロックは `/products/…` を直接開くと効かない | **商品ページそのもの**で見る（どこから来ても効く） |
| 商品タブに1件ずつ足す手間 | **タグだけ**で決まる（pj の CSV が付ける） |

## 1. 決まり（上から順に見る）

| 順 | 見るところ | どうする |
| --- | --- | --- |
| ① | 商品に `member-list` が**無い** | だれでも見られる（Omakase Ship のサービス・海外向け `os-`） |
| ② | ログインしていない | `/account/login?return_to=<元の商品ページ>` へ |
| ③ | 顧客に `member-staff` がある | **ぜんぶ見られる**（社内の確認用） |
| ④ | 顧客に `member-list` が無い | `/pages/members-only` へ |
| ⑤ | 商品の `grade-◯◯` と顧客の `grade-◯◯` が1つも合わない | `/pages/members-only?why=plan` へ（「このプランではご覧いただけません」） |
| ⑥ | それ以外 | 見られる |

- 商品に `grade-◯◯` が1つも無いときは、**会員ならだれでも**見られる
- 例：商品 `grade-premium` だけ／顧客 `grade-monitor` → **見られない**
- 例：商品 `grade-monitor`＋`grade-standard`／顧客 `grade-standard` → **見られる**

同じ決まりを pj 側にも置いてある（`shared/mgate.js`）。
`tests/mgate.mjs` が**組み合わせの表**と、**pj の CSV のタグが決まりと
合っているか**を機械で当たっている（§7）。

> **Liquid を直したら `shared/mgate.js` と `tests/mgate.mjs` も直すこと。**

## 2. 貼るファイル（3つ）

リポジトリの `shopify/` に入っている。Shopify の
**オンラインストア → テーマ → …（三点）→ コードを編集** で貼る。

| 置き場所 | ファイル | 何をするか |
| --- | --- | --- |
| `snippets/member-gate.liquid` | `shopify/snippets/member-gate.liquid` | 商品ページの鍵。**飛ばす先の URL を出すだけ**（商品の中身は出さない） |
| `snippets/member-can-see.liquid` | `shopify/snippets/member-can-see.liquid` | 一覧・検索・おすすめで「出してよいか」。`yes`／`no` を出すだけ |
| ページ（商品ではない） | `shopify/pages/members-only.html` | `/pages/members-only` の中身 |

スニペットは「**スニペット → 新しいスニペットを追加**」で
`member-gate`／`member-can-see` という名前で作り、中身を貼り付ける
（`.liquid` は自動で付く）。

## 3. Rise への差し込み

> ⚠ 行番号はテーマの版で変わる。**検索する文字**で場所を見つけてください
> （コードを編集の画面で `Ctrl`＋`F`／iPhone なら長押し → 検索）。

### 3-1. `layout/theme.liquid`（2か所）

**（a）`<head>` の中。検索する文字：`{{ content_for_header }}`**

```liquid
  <!-- ここから足す（pj 8.24 会員用の鍵） -->
  {%- capture member_gate -%}{%- render 'member-gate' -%}{%- endcapture -%}
  {%- assign member_gate = member_gate | strip -%}
  {%- if member_gate != blank -%}
    <meta name="robots" content="noindex,nofollow">
    <meta http-equiv="refresh" content="0;url={{ member_gate }}">
    <script>location.replace({{ member_gate | json }});</script>
  {%- endif -%}
  <!-- ここまで足す -->

  {%- if member_gate == blank -%}{{ content_for_header }}{%- endif -%}
```

- もとの行 `{{ content_for_header }}` を、上のように
  **`{%- if member_gate == blank -%}` で囲む**（1行を3つに分ける）
- なぜ囲むか：Shopify が `content_for_header` に出す解析用のデータに
  **商品名と値段が入る**ことがある。カジの決まり5（商品名・価格を
  HTML に出さない）を守るため、見せない人には出さない。
  飛ばすだけのページなので、そこで解析・アプリのスクリプトが動かなくても
  困らない
- `member_gate` は `{%- capture -%}` で受けること
  （`{% render %}` の中で作った変数は外に出てこない）

**（c）`<head>` の中で商品名・値段を出している行も囲む**

Rise は `<head>` の中で、ページごとの `<title>` や SNS 用の
`og:title`・`og:price`（商品名と値段）を出しています。
これも**見せない人には出さない**ように囲みます。

検索する文字：`og:` ／ `{%- render 'meta-tags'` ／ `<title>`
（Rise では `snippets/meta-tags.liquid` か
`snippets/social-meta-tags.liquid` を `{% render %}` している1行）

```liquid
  {%- if member_gate == blank -%}
    <title>…</title>            {%- comment -%} もとからある行 {%- endcomment -%}
    {%- render 'meta-tags' -%}  {%- comment -%} もとからある行 {%- endcomment -%}
  {%- else -%}
    <title>会員向けの商品です</title>
  {%- endif -%}
```

> ここは**テーマの版で名前が違います**。§7 の最後の確かめ方
> （ソースを表示して商品名で探す）で**1つも出ない**ことを見れば確実です。
> 出てしまう行があれば、その行を同じように囲んでください。

**（b）本文。検索する文字：`{{ content_for_layout }}`**

```liquid
    {%- if member_gate == blank -%}
      {{ content_for_layout }}
    {%- else -%}
      <div style="padding:40px 20px;text-align:center">
        <p>会員向けの商品です。</p>
        <p><a href="{{ member_gate }}">こちらへ進む</a></p>
      </div>
    {%- endif -%}
```

これで、見せない人の HTML には**商品名・価格・説明・カートのボタンが
1つも出ません**（JavaScript で隠すのではなく、**出力しない**）。

### 3-2. 一覧（コレクション・検索）

**検索する文字：`{% for product in collection.products %}`**
（Rise では `sections/main-collection-product-grid.liquid`。
見つからないときは `collection.products` や `search.results` で検索し、
商品カードを出している `{% for %}` を探す）

```liquid
{%- for product in collection.products -%}
  {%- comment -%} ここから足す（pj 8.24） {%- endcomment -%}
  {%- capture can_see -%}{%- render 'member-can-see', product: product -%}{%- endcapture -%}
  {%- if can_see | strip == 'yes' -%}
  {%- comment -%} ここまで足す {%- endcomment -%}

    … もとからあるカードを出す行（そのまま） …

  {%- endif -%}   {%- comment -%} これも足す（if を閉じる） {%- endcomment -%}
{%- endfor -%}
```

- 検索の一覧（`sections/main-search.liquid` の `{% for item in search.results %}`）も
  同じように囲む。`product:` に渡すのは `item`
  （`{%- render 'member-can-see', product: item -%}`）
- **おすすめ商品**（`sections/related-products.liquid` などの
  `{% for product in recommendations.products %}`）も同じ

> 会員用コレクション（ハンドル `members`）の一覧は、これで
> **見られない商品が並ばなくなる**（カジの決まり6）。

## 4. `/pages/members-only` を作る

1. **オンラインストア → ページ → ページを追加**
2. タイトル：**会員向けのご案内**
3. 右下の「検索エンジンの表示」でハンドルが `members-only` になっているか確かめる
   （違うときは編集して `members-only` にする）
4. 本文の右上の **`<>`（HTML を表示）** を押して、
   `shopify/pages/members-only.html` の中身を貼る
5. 保存

`?why=plan` が付いているときだけ「**このプランではご覧いただけません**」に
変わる（文の切り替えだけ JavaScript を使っている。商品の中身は
最初から出していない）。

## 5. 検索・おすすめ・サイトマップから隠す（カジの7）

| どこ | どうやって |
| --- | --- |
| ストアの検索・サイトマップ・検索エンジン | 商品のメタフィールド **`seo.hidden` に `1`** |
| テーマの一覧・検索・おすすめ | §3-2 の `member-can-see`（タグで止める） |

**`seo.hidden` の作り方**

1. Shopify の **設定 → カスタムデータ → 商品 → 定義を追加**
2. 名前：`seo.hidden`／名前空間とキー：`seo` ・ `hidden`／種類：**整数**
3. 商品 → **エクスポート**で1件だけ書き出し、
   1行目の列名のうち `seo.hidden` の列を**そのままコピー**
   （`Metafield: seo.hidden [number_integer]` のような形）
4. pj の ⚙「3. 仕入れ」→「**検索から隠す列（seo.hidden）**」に貼る
5. 以後、会員用CSV と1点ものCSV に**その列が `1` で入る**
   （空のあいだは列を出さない＝今までどおり）

> 列名はストアの書き出しに合わせるのがいちばん確かです
> （Shopify の説明と道具で書き方が違うため・2026-11-14 に確認）。
> 「商品の状態を Unlisted にする」方法もありますが、
> **会員用コレクションにも出なくなる**ので使いません。

## 6. 穴になりそうなところ（調べた結果）

### 6-1. `/cart/add` でバリアントIDを直接カートに入れる（塞げません）

- **自前のカスタムアプリの Shopify Functions（カートとチェックアウトの検証）は
  Shopify Plus 専用**です。Basic では使えません
  （Shopify の説明：公開アプリ（App Store）に入っている Functions は
  どのプランでも動くが、**カスタムアプリの Functions は Plus だけ**・
  2026-11-14 に確認）
- つまり Basic では、**チェックアウトの前に「タグが合わないと買えない」を
  自前で作れません**。方法は2つ
  1. **App Store の検証アプリ**を入れる（顧客タグで止められるものを選ぶ。
     BoomGate などが「1つのルールまで無料」と書いています。
     ただし顧客タグで止められるかはアプリごとに違うので、
     入れる前に確かめてください）
  2. **買われたあとに見つけて知らせる**（pj 側に入れました・下）

### 6-2. 代わりにやること：プラン外の購入を知らせる（入れました）

1. Shopify の **Flow**（Basic でも無料で使えます・2026-11-14 に確認）で
   ワークフローを1つ作る
   - きっかけ：**Order created**
   - 条件：顧客のタグ（`grade-monitor` など）
   - 動作：**Add order tags** でそのタグを注文に付ける
   - プランの数だけ（4本）作るか、1本の中で分岐させる
2. いつもの**注文CSV の取り込み**（仕入れタブ）で、pj が
   注文の `Tags` と**商品のプラン**を見比べる
3. 合わないものがあれば、社内用の Discord に

```
⚠️ **プラン外の購入** … 1件
商品のプランと、買った人のプラン（注文のタグ）が合いません。
商品ページの鍵をすり抜けて（カートに直接入れて）買われた可能性があります。
・注文 #1001　SUB-4902370550467-20261114　商品：grade-premium　買った人：grade-monitor
```

- **氏名・住所・メールは読みません**（§8.13 のまま）。
  読むのは注文番号・SKU・プランの印だけ
- 注文のタグに `grade-◯◯` が無いあいだ（Flow を入れる前）は
  「分からない」として**何も言いません**

### 6-3. ほかに商品が見える場所

| 場所 | どうなるか |
| --- | --- |
| **カート**（`/cart`） | 入れてしまえば商品名と値段は見えます。鍵では止められません（6-2 で見つける） |
| **注文確認メール・注文履歴** | 買えたあとなので見えます。これは止められません |
| **Shopify の検索候補（predictive search）** | `seo.hidden` で消えます。消えないときはテーマの検索候補のテンプレートも §3-2 と同じように囲んでください |
| **`/products/<ハンドル>.js` と `.json`** | **塞げません。** Shopify 本体が返す口で、テーマを通りません。商品名・値段・バリアントIDがそのまま読めます（ハンドルを知っている人だけ）。Basic でこれを止める方法はありません |
| **`/collections/members/products.json`** | 同じく Shopify 本体の口です。**コレクションに入れている商品は一覧で読めます**。会員用コレクションを「自動（タグ）」ではなく作らない運用にしても、商品の口（上）は残ります |
| **サイトマップ・Google** | `seo.hidden` で外れます |
| **コレクションの「おすすめ商品」** | §3-2 で止めます |

## 7. 試し方（5通り・必ず複製テーマで）

### 7-1. まず複製する

1. **オンラインストア → テーマ** → 今のテーマの「…」→ **複製**
2. 複製（`Rise のコピー`）のほうで §2〜§4 を入れる
3. 複製の「…」→ **プレビュー**で試す（お客さまには見えません）

### 7-2. 5通り

| # | 誰で | やること | 出てほしいもの |
| --- | --- | --- | --- |
| 1 | **ログインなし** | プレビューのまま、会員用商品の `/products/sub-…` を開く | `/account/login` に飛ぶ。ログインすると**元の商品ページに戻る**（戻らないときは §7-3） |
| 2 | **タグなしの会員** | テスト用の顧客でログイン（タグなし） | `/pages/members-only`（「会員向けの商品です」） |
| 3 | **`member-list`＋`grade-monitor`** | モニター商品を開く → 見られる。プレミアム商品（1点もの）を開く | モニター商品は見られる／プレミアム商品は「**このプランではご覧いただけません**」 |
| 4 | **`member-list`＋`grade-premium`** | 1点ものの `/products/one-…` を開く | 見られる |
| 5 | **`member-staff`** | どれでも開く | ぜんぶ見られる |

- 顧客タグは Shopify の **顧客** → その人 → 右の「タグ」で付け外しします
- ⚠ **タグは小文字で**付けてください（`grade-premium`。`Grade-Premium` だと
  Liquid の見比べに当たりません）。pj が CSV で付ける商品のタグは
  いつも小文字です
- あわせて見ること
  - 会員用コレクション（`/collections/members`）に、**見られない商品が
    並んでいない**こと（#3 と #4 で並びが変わる）
  - ページの**ソースを表示**して（iPhone は難しいので PC で）、
    `Ctrl`＋`F` で**商品名**と**値段の数字**を探し、**1つも出ない**こと。
    出てしまったら、その行を §3-1（c）と同じように
    `{%- if member_gate == blank -%}` で囲む
  - ストアの検索で会員用商品が**出ない**こと（`seo.hidden` を入れたあと）

### 7-3. ログイン後に戻らないとき

`return_to` が効くのは**旧（クラシック）の顧客アカウント**です。
**設定 → 顧客アカウント**が「新しい顧客アカウント」になっていると、
Shopify 側の決まりで元のページには戻れません（公式に未対応・
2026-11-14 に確認）。その場合は #1 の試験は「ログイン画面に飛ぶこと」
だけを見てください（ログイン後はアカウントの画面に出ます）。

## 8. 公開と、SHOPLOCK を外す順

1. 5通りぜんぶ通ったら、複製テーマを **公開**
2. **SHOPLOCK はまだ消さない**（1〜2週間そのまま）。
   両方かかっていても、会員には同じように見えます
3. 1〜2週間ようすを見て、問題が出なければ
   SHOPLOCK の**ロックの設定を外す** → さらに数日見る → アプリを削除
   （アプリを削除すると設定も消えるので、いちばん最後に）

## 9. 元に戻し方

| 戻したいもの | やること |
| --- | --- |
| 公開したあとで戻す | **オンラインストア → テーマ**で、前のテーマ（複製する前のもの）を**公開**に戻す。コードは触らない |
| スニペットだけ消す | `snippets/member-gate.liquid`・`member-can-see.liquid` を削除し、`layout/theme.liquid` の足した行を消す（`{{ content_for_header }}`・`{{ content_for_layout }}` を**囲む前の形**に戻す） |
| 一覧の囲みだけ消す | §3-2 で足した3行（`capture`／`if`／`endif`）を消す |
| pj の seo.hidden をやめる | ⚙「検索から隠す列」を**空**にして、CSV を出し直す（Shopify 側は商品のメタフィールドを消す） |

> テーマを触る前に「…」→ **ZIP をダウンロード**しておくと、
> いつでもそのテーマに戻せます。

## 10. pj 側で入れたもの（8.24）

| ところ | 中身 |
| --- | --- |
| `shared/mgate.js` | 鍵の決まり（Liquid と同じ順）。**この1か所** |
| ⚙「検索から隠す列（seo.hidden）」 | 会員用CSV・1点ものCSV に `seo.hidden = 1` の列を足す（空なら出さない） |
| 注文の取り込み | 注文の `Tags` から買った人のプランを読み、**プラン外の購入**を社内用 Discord に知らせる（氏名・住所・メールは読まない） |
| `tests/mgate.mjs` | 組み合わせの表・CSV のタグ・Liquid の中身を当たる（54件） |

**デプロイ**：pj-sync が要ります（注文の取り込みの直し）。
**D1 の作業**：今回はありません。

## 11. 確かめたこと・確かめられなかったこと

| こと | どうか |
| --- | --- |
| カスタムアプリの Shopify Functions は Plus 専用 | Shopify の説明で確認（2026-11-14） |
| 公開アプリ（App Store）の Functions はどのプランでも動く | 同上 |
| `seo.hidden` に 1 で検索・サイトマップから外れる | Shopify のヘルプ・公式ブログで確認（2026-11-14） |
| `seo.hidden` を**商品CSV で**付けられるか | メタフィールドの列は CSV で入るが、**列名の書き方が資料で違う**。ストアの書き出しの列名を使うのが確実（⚙で入れてもらう形にした） |
| Shopify Flow が Basic で使えるか | 新しい資料では「Basic でも無料」。古い資料には「Basic 不可」とあるので、**入れるときに確かめてください** |
| ログイン後に元のページへ戻る（`return_to`） | 旧（クラシック）顧客アカウントなら効く。**新しい顧客アカウントでは Shopify が未対応** |
| `/products/<ハンドル>.js`・`.json` を止められるか | **止められません**（Shopify 本体の口・テーマを通らない）。鍵は「ページを見せない・一覧に出さない・検索に出さない」までです |
| Liquid が本当に動くか | **この場所から Shopify を触れないので、動かして確かめていません。** §7 の5通りを、必ず複製テーマのプレビューで試してください |

参考にしたところ
- https://shopify.dev/docs/api/functions/latest （Functions とプラン）
- https://shopify.dev/docs/api/functions/reference/cart-checkout-validation （検証の入力に顧客タグの `hasAnyTag` がある）
- https://help.shopify.com/en/manual/promoting-marketing/seo/hide-a-page-from-search-engines （`seo.hidden`）
- https://www.shopify.com/blog/noindex-shopify-page （`seo.hidden` の効き方）
- https://shopify.dev/docs/storefronts/themes/sign-in （ログインと `return_to`）
