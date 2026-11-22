# 会員用商品の鍵（Shopify のテーマ Liquid・SHOPLOCK なし）

pj_price 8.24 ／ 2026-11-14 ／ ストア：Omakase Ship ／ テーマ：**Rise**

> カジの依頼「SHOPLOCK に頼らずテーマの Liquid で鍵を作りたい。
> プランの区別（grade-◯◯）も効くようにしてほしい。」

> **この .md の中の Liquid について**
> GitHub Pages（Jekyll）は `.md` の中の Liquid のしるし（波かっこと
> パーセント）を**自分の Liquid として読んでしまう**ので、Shopify の
> Liquid をそのまま書くと公開のビルドが失敗します
> （2026-11-14・pages build and deployment #313 `Unknown tag 'render'`）。
> 直し：リポジトリ直下の **`.nojekyll`** で Jekyll を止め、さらに
> この中の Liquid は **raw タグ**（`raw` 〜 `endraw`）で囲んであります
> （`.nojekyll` が外れても壊れないように）。
> **Liquid を書き足すときは、必ず raw タグの中に書いてください。**
> `tests/pages.mjs` が機械で見張っています。

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
<!-- GitHub Pages（Jekyll）が Shopify の Liquid を自分のものとして読まないように囲む。直下の .nojekyll で Jekyll は止めてあるが、それが外れても壊れないように二重にしておく。 -->
{% raw %}

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

### 3-2. 一覧・検索・おすすめから外す（8.26）

一覧は **`card-product` を出す行を囲む**のがいちばん確かです
（`{% for %}` の形はセクションによって違いますが、カードを出す行は同じ）。

**探し方：コードエディタの検索で `card-product` と打つ**。
出てきたファイルの**ぜんぶ**を直します。Rise では次の3つです
（ほかに出てきたら、それも同じように直す）。

| ファイル | どこの一覧か |
| --- | --- |
| `sections/main-collection-product-grid.liquid` | コレクションの一覧（会員用コレクションもここ） |
| `sections/main-search.liquid` | ストアの検索の結果 |
| `sections/related-products.liquid` | おすすめ商品 |

#### 差し込む形（3つとも同じ）

もとの `card-product` を出している行を、**上下 2行**で囲むだけです。

```liquid
      {%- comment -%} ここから足す（pj 8.26 会員用の鍵） {%- endcomment -%}
      {%- capture can_see -%}
        {%- render 'member-can-see', product: card_product -%}
      {%- endcapture -%}
      {%- if can_see | strip == 'yes' -%}

        {%- render 'card-product', card_product: card_product, … -%}
        {%- comment -%} ↑ もとからある行。1文字も変えない {%- endcomment -%}

      {%- endif -%}
      {%- comment -%} ここまで足す {%- endcomment -%}
```

#### 渡す商品の名前（ここだけ気をつける）

`member-can-see` に渡すのは、**もとの行に書いてある商品の変数と同じもの**です。
`render 'card-product'` の行の `card_product:` の**右側**をそのまま使います。

| もとの行（例） | 渡すもの |
| --- | --- |
| `{%- render 'card-product', card_product: card_product, … -%}` | `product: card_product` |
| `{%- render 'card-product', card_product: product, … -%}` | `product: product` |
| `{%- render 'card-product', card_product: item, … -%}` | `product: item` |
| `{%- render 'card-product', card_product: recommendation, … -%}` | `product: recommendation` |

> 間違えると**何も出なくなる**（`member-can-see` が商品を受け取れず
> `yes` を返すだけ）か、**ぜんぶ出る**ので、入れたあとに
> 会員用コレクションを見て確かめてください（§7）。

#### `{% for %}` の中にあるか確かめる

囲む行は**くり返しの中**（`{% for %}` 〜 `{% endfor %}` の間）にあります。
`{% for %}` の外にある `card-product`（下書きや1件だけの表示）は囲みません。
`{% paginate %}` の中でも同じです。

#### 既知の制限（カジの指摘どおり）

| こと | どうなるか |
| --- | --- |
| **件数** | 「◯◯件」の数は Shopify が数えた**ぜんぶの数**です。外した分が引かれません（例：10件と出るのに8件しか並ばない） |
| **ページ送り** | 1ページの件数（例 24件）も**外す前**で数えます。外した分だけページが短くなり、空のページが出ることもあります |
| **絞り込み（フィルター）の件数** | 同じく外す前の数です |

これは Liquid で**出す側を止めている**ための限界です（Shopify が先に
「何件」を決めてから、テーマが並べるため）。直すには、会員用の商品を
**会員向けのコレクションにだけ入れて、ふつうの一覧には入れない**運用に
するのが確実です（`seo.hidden` を入れておけば検索にも出ません）。

> 会員用コレクション（ハンドル `members`）の一覧は、これで
> **見られない商品が並ばなくなります**（カジの決まり6）。
> 件数の数字だけは合いません（上の表）。

{% endraw %}

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
| **一覧・検索・おすすめ・サイトマップ・`/products.json`** | 商品の状態を**非公開（Unlisted）**にする（**§13**・いちばん効く） |
| ストアの検索・サイトマップ・検索エンジン | 商品のメタフィールド **`seo.hidden` に `1`** |
| テーマの一覧・検索・おすすめ | §3-2 の `member-can-see`（タグで止める） |

> **非公開（Unlisted）を入れたら、上の3つは重ねがけ**になります。
> `seo.hidden` と `member-can-see` はそのまま残してください
> （**非公開にし忘れた商品の受け皿**になります）。

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
| **`/products/<ハンドル>.js` と `.json`** | **ハンドルを知っている人には読めます**（Shopify 本体が返す口で、テーマを通りません）。ただし**一覧の `/products.json` からは消えます**（§13 の非公開）ので、**ハンドルを集められなくなります**。Basic でこの口そのものを止める方法はありません |
| **`/collections/members/products.json`** | 同じく Shopify 本体の口ですが、**非公開（Unlisted）にすると出なくなります**（§13）。非公開にしていない商品は、コレクションに入れていれば読めます |
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

> **確かめた結果（2026-11-14・カジ）**
> 複製テーマ「Rise のコピー」（id 168765456547）に v283 のスニペットを入れて
> 保存（未公開）。**5通りすべて期待どおり**。見られない人のページのソースに
> 商品名・値段は無し。会員用でない商品はふつうに表示。
> 戻り先（`return_to`）だけ直した（§7-3・v284）。

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
    {% raw %}`{%- if member_gate == blank -%}`{% endraw %} で囲む
  - ストアの検索で会員用商品が**出ない**こと（`seo.hidden` を入れたあと）

### 7-3. ログインの行き先（8.26・新しい顧客アカウント）

このストアは **新しい顧客アカウント**（設定 → 顧客アカウント）です。
テーマの決まりのログイン URL は

```
/customer_authentication/redirect?locale=ja&region_country=JP
```

のように**最初から `?` が付いて**返ってきます。
v283 はそこに `?return_to=` をそのままつないでいたので
`…region_country=JP?return_to=/products/…` になり、
ログインしても「注文」の画面に着地していました（カジの確認・2026-11-14）。

**v284 で直したこと**：URL に `?` が入っていれば **`&` でつなぐ**。

**それでも戻りませんでした**（カジの実機確認・2026-11-15）。
`…/customer_authentication/redirect` に `return_to` を付けても、
ログインのあと**注文管理のページに着地**します。

**いまの形（8.40）**：Shopify の説明
（`shopify.dev/docs/storefronts/themes/sign-in`）のとおり、
`routes` では **`/customer_authentication/login`** に送ります。

```
/customer_authentication/login?return_to=%2Fproducts%2Fsub-…
```

#### ⚠ 新しい顧客アカウントの注意

**ログインしても、お客さまがストアへ戻ってくるまで、ストア側は
「ログインしていない人」のままです。**
新しい顧客アカウントのログインは Shopify 側の別の画面
（`shopify.com/…/account`）で行われるため、

- ログインの直後に商品ページへ戻れないと、**また鍵に当たって
  ログインへ飛ばされる**ことがあります（行き止まりに見える）
- `customer` が入るのは、ストアのページに戻ってきてからです

そのため、**戻り先（`return_to`）が効くかどうかが要**になります。

#### 2つの行き先を比べる（カジが複製テーマで試す）

スニペット `snippets/member-gate.liquid` のはじめのほうに、
切り替える1行があります。

| 試す順 | 直すところ | 行き先 |
| --- | --- | --- |
| ① 既定 | `member_login_mode = 'routes'`（そのまま） | **`/customer_authentication/login?return_to=…`**（8.40・ログイン後に商品ページへ戻る） |
| ② 試す | `member_login_mode = 'classic'` に書き替える | `/account/login?return_to=…`（旧のログイン画面） |
| ③ 安全策 | `member_login_mode = 'page'` に書き替える | ログインに飛ばさず `/pages/members-only`（ページの中の「ログイン」を押してもらう） |

**比べ方**（①で戻らなかったら②を試す）

1. ログアウトしてから、会員用商品の `/products/sub-…` を開く
2. ログイン画面に飛ぶ → ログインする
3. **元の商品ページに戻るか**を見る
   - 戻った → その行き先でよい
   - 戻らない（注文やアカウントの画面に着地する）→ もう一方を試す
4. どちらでも戻らないときは **③（`'page'`）**にしてください。
   ログインに飛ばさず「会員向けのご案内」のページに出します。
   お客さまは「**ご案内 → ログイン**」の2手になりますが、
   **「ログインしたのにまた鍵に当たる」行き止まりが起きません**
   （新しい顧客アカウントでは、ログインしてもストアに戻るまで
   ストア側は「ログインしていない人」のままなので・上の注意）

> ②（`/account/login`）は、新しい顧客アカウントのストアでも
> Shopify が新しいログイン画面へ振り直すことがあります。
> そのときに `return_to` が残るかはストアの設定で変わるので、
> **複製テーマで実際に見るのがいちばん確実**です。

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
| スニペットだけ消す | `snippets/member-gate.liquid`・`member-can-see.liquid` を削除し、`layout/theme.liquid` の足した行を消す（{% raw %}`{{ content_for_header }}`・`{{ content_for_layout }}`{% endraw %} を**囲む前の形**に戻す） |
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
| ログイン後に元のページへ戻る（`return_to`） | **このストアは新しい顧客アカウント**。`?` があれば `&` でつなぐようにし（v284）、さらに `routes` の行き先を **`/customer_authentication/login`** に変えた（8.40）。`…/redirect` では**ログイン後に注文管理のページに着地**した（カジの実機確認・2026-11-15） |
| 新しい顧客アカウントのログイン中の扱い | **ログインしても、ストアへ戻ってくるまでストア側は「ログインしていない人」のまま**（§7-3） |
| `/products/<ハンドル>.js`・`.json` を止められるか | **止められません**（Shopify 本体の口・テーマを通らない）。鍵は「ページを見せない・一覧に出さない・検索に出さない」までです |
| Liquid が本当に動くか | **この場所から Shopify を触れないので、動かして確かめていません。** §7 の5通りを、必ず複製テーマのプレビューで試してください |

参考にしたところ
- https://shopify.dev/docs/api/functions/latest （Functions とプラン）
- https://shopify.dev/docs/api/functions/reference/cart-checkout-validation （検証の入力に顧客タグの `hasAnyTag` がある）
- https://help.shopify.com/en/manual/promoting-marketing/seo/hide-a-page-from-search-engines （`seo.hidden`）
- https://www.shopify.com/blog/noindex-shopify-page （`seo.hidden` の効き方）
- https://shopify.dev/docs/storefronts/themes/sign-in （ログインと `return_to`）

## 12. 複製テーマ「Rise のコピー」に貼る手順（v284・作業の順）

対象：複製テーマ **「Rise のコピー」（id 168765456547）**／**公開しません**。
すでに入れてあるもの（カジ・2026-11-14）：
`snippets/member-gate.liquid`・`member-can-see.liquid`（**v283 の版**）、
`layout/theme.liquid` の3か所（`head` の判定・`content_for_header`・`content_for_layout`）。

> **v284 で変わったのは `member-gate.liquid` の1ファイルだけ**です
> （戻り先の `?`／`&`）。`member-can-see.liquid` は v283 のままで直しは
> ありません。あとは**まだテーマに入れていない差し込み**（一覧・検索・
> おすすめ）を足します。

### 手順 0. 触る前に（1分）

1. **オンラインストア → テーマ** → 「Rise のコピー」の「…」→
   **ZIP をダウンロード**（いつでもこの状態に戻せます）
2. 直すのは**複製のほう**だけ。公開中のテーマは触りません
3. 「…」→ **コードを編集**を開く

### 手順 1. `snippets/member-gate.liquid` を貼り替える（8.40 の版）

左の一覧から `snippets/member-gate.liquid` を開き、**中身をぜんぶ消して**
下を貼り、**保存**します。

> **見分け方**：ファイルの中を `customer_authentication/login` で探して、
> **`assign lurl = '/customer_authentication/login'` の行があれば最新**です。
> `assign lurl = routes.account_login_url` のままなら**古い版**なので
> 貼り替えてください（その版はログイン後に**注文管理のページ**に着地します）。

<!-- Liquid は raw の中に置く（GitHub Pages が自分のものとして読まないように） -->
{% raw %}

```liquid
{%- comment -%}
  会員用商品の鍵（pj_price 8.24／8.26／8.40）
  Shopify ストア：Omakase Ship ／ テーマ：Rise

  これは「商品ページを見せてよいか」を決めるだけの部品です。
  **飛ばす先の URL を出すだけ**で、商品の中身は何も出しません。

  使い方（layout/theme.liquid）
    {%- capture member_gate -%}{%- render 'member-gate' -%}{%- endcapture -%}
    {%- assign member_gate = member_gate | strip -%}
    … member_gate が空なら見せてよい。空でなければその URL へ飛ばす。

  決まり（上から順に見る。pj の shared/mgate.js と同じ順）
    ① 商品に member-list が無い → だれでも見られる
    ② ログインしていない       → ログインへ（戻り先つき）
    ③ 顧客に member-staff      → ぜんぶ見られる（社内の確認用）
    ④ 顧客に member-list が無い → /pages/members-only
    ⑤ 商品の grade-◯◯ と顧客の grade-◯◯ が1つも合わない
       → /pages/members-only?why=plan
       商品に grade-◯◯ が1つも無いときは、会員ならだれでも見られる

  ▼ ログインの行き先（8.26・8.40・カジの実機確認）
    このストアは**新しい顧客アカウント**です。
    ① routes.account_login_url は
         /customer_authentication/redirect?locale=ja&region_country=JP
       のように**最初から ? が付いて**返るので、'?return_to=' をつなぐと
       …region_country=JP?return_to=/products/… になって戻れませんでした。
       → **? があれば & でつなぐ**ようにしました（8.26）。
    ② それでも、…/redirect に return_to を付けると**ログイン後に
       注文管理のページに着地**して、商品ページに戻りませんでした
       （カジの実機確認・8.40）。
       Shopify の説明（shopify.dev/docs/storefronts/themes/sign-in）では
         /customer_authentication/login?return_to=<相対URLを url_encode>
       が案内されているので、routes では**その URL を使います**。

    それでも戻らないときは、下の member_login_mode を 'classic'（旧の
    /account/login?return_to=…）や 'page'（ログインに飛ばさず案内の
    ページに出す）に変えて試せます（手順書 §7-3 参照）。
{%- endcomment -%}
{%- liquid
  # ログインしていない人の行き先。ここの1行だけで切り替えられる。
  # 'routes'  … /customer_authentication/login?return_to=…（既定・8.40）
  #             新しい顧客アカウントの、戻り先が効くログイン URL
  # 'classic' … /account/login?return_to=… に送る（旧のログイン画面）
  # 'page'    … ログインに飛ばさず /pages/members-only に案内する
  #             （新しい顧客アカウントで「ログインしたのにまた鍵に当たる」
  #               ようになるときは、これがいちばん安全）
  assign member_login_mode = 'routes'

  assign gate = ''
  assign p = product
  if p != blank and p.tags contains 'member-list'
    if customer == blank
      if member_login_mode == 'page'
        assign gate = '/pages/members-only?why=login'
      else
        assign back = p.url | default: request.path | url_encode
        if member_login_mode == 'classic'
          assign lurl = '/account/login'
        else
          # 8.40 routes.account_login_url（…/redirect?…）だと、ログイン後に
          # 注文管理のページに着地して戻らなかった（カジの実機確認）。
          # Shopify の説明どおり …/customer_authentication/login を使う。
          assign lurl = '/customer_authentication/login'
        endif
        # すでに ? が付いている URL（新しい顧客アカウント）は & でつなぐ。
        assign sep = '?'
        if lurl contains '?'
          assign sep = '&'
        endif
        assign gate = lurl | append: sep | append: 'return_to=' | append: back
      endif
    elsif customer.tags contains 'member-staff'
      assign gate = ''
    elsif customer.tags contains 'member-list'
      assign need = false
      assign hit = false
      for t in p.tags
        assign head = t | slice: 0, 6
        if head == 'grade-'
          assign need = true
          if customer.tags contains t
            assign hit = true
          endif
        endif
      endfor
      if need and hit == false
        assign gate = '/pages/members-only?why=plan'
      endif
    else
      assign gate = '/pages/members-only'
    endif
  endif
-%}{{ gate }}
```

{% endraw %}

### 手順 2. `snippets/member-can-see.liquid` は**そのまま**

v284 で直していません。開いて、**最後の行が `{% raw %}{{ ok }}{% endraw %}`**
になっていれば入っています（何もしなくてよい）。

### 手順 3. `layout/theme.liquid`（4か所目・まだなら）

すでに3か所（`head` の判定・`content_for_header`・`content_for_layout`）は
入っています。**4か所目**として、`<head>` の中で**商品名と値段を出している行**
（`<title>` と `og:` のところ）も囲みます。
囲まなくても商品ページは見せませんが、**ページのソースに商品名が残る**ので、
カジの決まり5（商品名・価格を HTML に出さない）のために囲みます。

検索する文字：`og:` ／ `meta-tags` ／ `<title>`

{% raw %}

```liquid
  {%- if member_gate == blank -%}
    {%- comment -%} ↓ もとからある行（テーマの版で名前が違います） {%- endcomment -%}
    <title>{{ page_title }}</title>
    {%- render 'meta-tags' -%}
  {%- else -%}
    <title>会員向けの商品です</title>
  {%- endif -%}
```

{% endraw %}

> **入れたかどうかは §12 手順 6 の「ソースに商品名が出ない」で分かります。**
> 出なければ、この手順は飛ばして構いません。

### 手順 4. 一覧・検索・おすすめから外す（**今回の本体**）

コードエディタの検索で **`card-product`** と打ち、出てきたファイルを
**ぜんぶ**直します。Rise では次の3つです。

| # | ファイル | どこの一覧か |
| --- | --- | --- |
| 4-1 | `sections/main-collection-product-grid.liquid` | コレクションの一覧（`/collections/all`・会員用コレクション） |
| 4-2 | `sections/main-search.liquid` | 検索の結果 |
| 4-3 | `sections/related-products.liquid` | 商品ページの下の「関連商品」 |

**どこに入れるか**：`card-product` を**出している行**（`render 'card-product'`
と書いてある1行）を見つけて、その**すぐ上に4行**・**すぐ下に2行**を足します。
行番号ではなく、この「もとからある行」を目印にしてください。

{% raw %}

```liquid
      {%- comment -%} ここから足す（pj 8.26 会員用の鍵） {%- endcomment -%}
      {%- capture can_see -%}
        {%- render 'member-can-see', product: card_product -%}
      {%- endcapture -%}
      {%- if can_see | strip == 'yes' -%}

        {%- render 'card-product', card_product: card_product, … -%}
        {%- comment -%} ↑ もとからある行。1文字も変えない {%- endcomment -%}

      {%- endif -%}
      {%- comment -%} ここまで足す {%- endcomment -%}
```

{% endraw %}

**`product:` の右に書くもの**は、**もとの行の `card_product:` の右側と同じ**です。

| もとの行がこうなら | `member-can-see` に渡すのは |
| --- | --- |
| `card_product: card_product` | `product: card_product` |
| `card_product: product` | `product: product` |
| `card_product: item` | `product: item` |
| `card_product: recommendation` | `product: recommendation` |

- 囲む行は必ず**くり返しの中**（`for` 〜 `endfor` の間）にあります。
  外にある `card-product` は囲みません
- 1ファイル直すごとに**保存**し、手順 6 の確かめを1つずつ進めると安心です

**4-4. 検索の候補（打っている途中に出る小さな一覧）**

検索で `predictive-search` と打ちます。出たファイルの中に
`card-product` か、商品名を出している `for` のくり返しがあれば、
同じように囲みます（Rise の版によって無いこともあります）。
**`seo.hidden` に 1 を入れてあれば、候補にも出ません**ので、
手順 6 の検索の確かめで出なければ、ここは触らなくて構いません。

### 手順 5. ページの確認

`/pages/members-only`（タイトル「会員向けのご案内」）があるか見ます。
無ければ §4 のとおり作ります。

### 手順 6. 確かめる（複製テーマの**プレビュー**で）

テーマの「…」→ **プレビュー**。お客さまには見えません。

**（A）5通り（§7-2）**

| # | 誰で | 開くもの | 出てほしいもの |
| --- | --- | --- | --- |
| 1 | ログインなし | 会員用商品 `/products/sub-…` | ログイン画面へ飛ぶ |
| 2 | タグなしの顧客 | 同じ商品 | 「会員向けの商品です」（`/pages/members-only`） |
| 3 | `member-list`＋`grade-monitor` | モニター商品／プレミアム商品 | モニターは見られる／プレミアムは「このプランではご覧いただけません」 |
| 4 | `member-list`＋`grade-premium` | 1点もの `/products/one-…` | 見られる |
| 5 | `member-staff` | どれでも | ぜんぶ見られる |

**（B）一覧に出ないこと（今回足したぶん）**

| 見るところ | ログインなし／タグなしのとき | `grade-monitor` のとき |
| --- | --- | --- |
| `/collections/all` | 会員用商品（`sub-…`・`one-…`）が**1つも並ばない** | モニターの商品だけ並ぶ（プレミアムの1点ものは並ばない） |
| 検索「**FINAL FANTASY**」 | 会員用商品が**出ない**（候補の小窓にも出ない） | 同上 |
| 商品ページの下の「**関連商品**」 | 会員用商品が**出ない** | 同上 |
| 会員用コレクション `/collections/members` | 何も並ばない | モニターの商品だけ並ぶ |

> 件数の数字（「◯◯件」）とページ送りは**外す前の数**のままです（§3-2 の
> 既知の制限）。並びに出ていなければ合格です。

**（C）ログインしたあと元の商品ページに戻ること**

1. ログアウトしてから `/products/sub-…`（会員用商品）を開く
2. ログイン画面に飛ぶ → ログインする
3. **元の商品ページに戻る**か見る
   （既定の `routes` は **`/customer_authentication/login?return_to=…`**
   に送ります。8.40 でここを直しました）
   - 戻った → そのまま（`member_login_mode = 'routes'`）
   - 戻らない → `'classic'` に書き替えて同じ手順
   - どちらも戻らない → **`'page'`** にする（ログインに飛ばさず
     「会員向けのご案内」に出す。2手になりますが行き止まりになりません）

> **飛び先の URL を見れば分かります。** ログイン画面に飛んだときの
> アドレスが `…/customer_authentication/login?return_to=%2Fproducts%2F…`
> になっていれば、この直しが入っています。
> `…/customer_authentication/redirect?…` のままなら、手順 1 の貼り替えが
> できていません（その版は**注文管理のページに着地**します）。

**（D）ソースに商品名・値段が出ないこと**（PC で）

見られない人で会員用商品を開き、**ページのソースを表示**して
`Ctrl`＋`F` で**商品名**と**値段の数字**を探す → **1つも出ない**こと。
出たら、その行を手順 3 と同じように囲みます。

### 手順 7. 公開の前に確かめること（公開はカジが決めます）

| # | 確かめること | なぜ |
| --- | --- | --- |
| 1 | 手順 6 の（A）〜（D）が**ぜんぶ通っている** | 公開するとお客さまに見えます |
| 2 | **SHOPLOCK のアプリ埋め込みが、複製テーマにも入っている**（テーマ → カスタマイズ → 左下の**アプリ埋め込み**） | 公開した瞬間に SHOPLOCK が外れると、鍵が二重になっていない状態で表に出ます。§8 のとおり **SHOPLOCK は公開後 1〜2週間そのまま**にします |
| 3 | **「関連商品」の欄の出し入れが、公開中のテーマと同じ**（公開中は **11/15 に非表示**にしてあります） | 公開した瞬間に見え方が変わらないように。手順 4-3 を入れたので会員用商品は出ませんが、**出す／出さないはカジが決める**ことなので、まずは**公開中と同じ「非表示」**にそろえます |
| 4 | 複製テーマの **ZIP を保存**してある（手順 0） | 戻すときのため |
| 5 | 公開中のテーマの **ZIP も保存**してある | 公開を戻すのは「前のテーマを公開」で足りますが、保険です |
| 6 | `seo.hidden` の列を pj の⚙に入れてあるか（§5） | 検索エンジン・サイトマップから外すのは**テーマではなくメタフィールド**です |

ここまで通ったら、**公開するかどうかはカジが決めてください**。
公開後の順番（SHOPLOCK を外すまで）は §8 に書いてあります。

## 13. 会員用の商品は「非公開（Unlisted）」にする（8.41・カジの依頼）

> **会員用の商品（Handle が `sub-` と `one-`）は、Shopify の状態を
> 「非公開（Unlisted）」にします。一覧・検索・おすすめ・サイトマップ・
> `/products.json` には出ません。Discord のカードのリンク
> （`/products/sub-<JAN>`）からは今までどおり開けて、買えます。**

### 13-1. なぜ

`/products.json` で**会員用の商品名と値段が誰でも取れて**いました
（Shopify 本体が返す口なので、テーマの鍵（§3）を通りません）。
カジが1件を手で非公開にして試したところ（2026-11-15・実機）

| 見たところ | 非公開にすると |
| --- | --- |
| `/products.json` | **消えた** |
| サイトマップ | **消えた** |
| 商品ページを直接開く（`/products/sub-…`） | **そのまま開ける** |
| カートに入れる | **そのまま入る** |

会員は Discord のカードの「購入する」から入るので、一覧に出なくても困りません。

### 13-2. 調べたこと（2026-11-15）

| こと | どうか |
| --- | --- |
| Shopify の商品の状態 | **active／draft／archived／unlisted（非公開）の4つ** |
| 非公開が隠すもの | 検索エンジン・Shopify カタログ・**ストアのサイトマップ**・**コレクションのページ**・**ストア内の検索（検索候補も）**・**おすすめ商品**。`noindex,nofollow` も付く |
| 非公開でも残るもの | **商品ページそのもの（直接のリンク）**と、**カートに入れること** |
| **商品CSV の `Status` 列** | 入れられるのは **`active` ／ `draft` ／ `archived` の3つだけ**。**`unlisted` は入れられません**（入れると「無効なステータス」でその行が落ちます） |
| 非公開を付けられるところ | **管理画面でまとめて**（商品の一覧で選んで「**商品の掲載を解除**」。13-4 でカジが 52件を一括でできました）／**商品ページの状態のドロップダウン**（1件ずつ）／**Admin API**（`productUpdate` の `status: UNLISTED`・API は **2025-10 以降**） |
| Liquid から見えるか | 非公開の商品は、**ハンドル・ID・メタフィールドで名指ししたときだけ** Liquid と Storefront API に返ります（＝**くり返し（一覧）には出てきません**） |

> 出どころ：[商品のステータス](https://help.shopify.com/en/manual/products/product-status)／
> [CSV での商品のインポートとエクスポート](https://help.shopify.com/en/manual/products/import-export/using-csv)／
> [ProductStatus（Admin GraphQL）](https://shopify.dev/docs/api/admin-graphql/latest/enums/ProductStatus)。
> `/products.json` については Shopify の説明に書かれていないので、
> **カジの実機確認**によります。

### 13-3. pj で直したこと（8.41）

**会員用の商品CSV（`sub-` と `one-`）から `Status` の列ごと出さなくしました。**

- CSV に `unlisted` は入れられず、`active` と書くと
  **上書き取り込みのたびに非公開が解けて**しまうためです
- **一般向け（海外向け `os-`）は今までどおり `active`** です（カジの依頼）
- **在庫CSV**（数だけ直すほう）はもともと `Status` を触りません。
  **非公開のまま在庫と値段を更新できます**
- `Published on online store`（オンラインストアに公開）は **`true` のまま**です
  （非公開は「状態」で、公開の有無とは別のものです）

> ⚠ **1件で確かめてください。** `Status` の列が**無い**ときに、Shopify が
> 既存の商品の状態を**そのままにする**のか、**`active` に戻す**のかは、
> Shopify の説明では読み取れませんでした
> （「列が無いときは active として取り込まれます」という1文があります）。
> **非公開にした商品を1件だけ入れた CSV を上書き取り込み**して、
> **非公開のままか**を見てください。戻ってしまうときは、CSV での上書きを
> やめて 13-5 の別の手にします。

### 13-4. まとめて非公開にする（**カジが 52件で実施・2026-11-15 19:35**）

**CSV ではできません**（13-2）。管理画面でまとめてできます。

1. **商品** → **タグ**で `member-list` を選んで絞り込む
2. 見出しの**チェックボックスで全選択** → 出てくる「**すべての結果を選択**」も押す
3. 「**…**（その他の操作）」→ 「**商品の掲載を解除**」
4. 確認の画面で「**商品を未掲載にする**」
   （画面の URL は `/products/change-status/unlisted`。
   そのあと商品のステータス欄は「**非公開**」と出ます）

- **すでに非公開の商品が混ざっていても、そのまま全選択して大丈夫**です
- 1件ずつ付けるときは、商品を開いて**ステータス → 非公開 → 保存**です

### 13-5. これから増える商品（CSV で作った新しい会員用の商品）

CSV で作った直後の商品は **`active`（公開）**です。
**「Shopify に読み込みました」を押す前に、非公開にしてください。**

| やり方 | いつ使うか |
| --- | --- |
| **管理画面でまとめて非公開にする**（13-4 と同じ。タグで絞って全選択 →「商品の掲載を解除」） | **いまはこれ**。すでに非公開の商品が混ざっていても構わないので、**毎回タグで全部を選んで押すだけ**です |
| **Admin API（`productUpdate` に `status: UNLISTED`）** | 件数が増えて手でやるのが大変になったら。pj-sync に **Shopify の管理 API のトークン**を入れる作業が要ります（いまは入れていません）。**やるかどうかはカジが決めてください** |
| **Matrixify などの取り込みアプリ** | アプリの取り込み形式には `Unlisted` があります（有料の段に入ることがあります） |

> **Shopify Flow**（タグが付いたら状態を変える）でできるかは**未確認**です。
> Flow の動作に「商品の状態を変える」があり、そこに**非公開**が選べれば、
> `member-list` のタグが付いた商品を自動で非公開にできます。
> 入れるときに画面で確かめてください。

### 13-6. 確かめ方

> **確かめた結果（カジ・2026-11-15 19:35・本番テーマ）**
> `/products.json` は**一般の2件だけ**／`/collections/all` も**2件**／
> ストア内の検索は**0件**（反映まで数十秒）／サイトマップに `sub-` は**出ない**／
> カードのリンク `/products/sub-…` は**開ける**／**カートに入れられる**。

| 見るところ | 期待 |
| --- | --- |
| `https://<ストア>/products.json` をブラウザで開く | 会員用（`sub-`・`one-`）の商品が**1つも出ない** |
| `/collections/all`・ストアの検索 | 出ない |
| **Discord のカードの「購入する」**（`/products/sub-<JAN>`） | **開ける**（会員なら中身が見える） |
| その商品を**カートに入れる** | **入る**（買える） |
| 会員用コレクション `/collections/members` | **空になります**（非公開の商品は一覧に出ないため）。カジが中身を見るときは**管理画面**で見てください |
| 在庫CSV で数を更新 → もう一度見る | **非公開のまま**（在庫CSV は状態を触りません） |

### 13-7. 気をつけること

- **非公開にしても、ハンドルを知っている人は `/products/sub-<JAN>.json` を
  読めます。** 鍵（§3）は商品**ページ**を見せませんが、この口は Shopify 本体が
  返すのでテーマを通りません。**一覧の `/products.json` から消えるので、
  ハンドルを集められなくなる**のが今回の効きめです
- **会員用コレクションの一覧が空になります**（上）。
  会員は Discord のカードから入るので運用は変わりません
- `seo.hidden` と §3-2 の `member-can-see` は**そのまま残して**ください
  （非公開にし忘れた商品の受け皿）

## 14. お一人の上限（「お一人◯点まで」）をテーマで抑える（8.83・カジの依頼）

対象：Omakase Ship（テーマ Rise）。**まず複製テーマで試し、公開はカジが決めます。**

### 14-1. 何をするか

Discord のカードに出している「お一人◯点まで」を、Shopify の**商品ページ**と
**カート**でも効かせます。

| だれが | 何をするか |
| --- | --- |
| pj（pj-sync） | 会員用の商品に、プランごとの上限の**タグ**を付ける（例 `qty-light-1`・`qty-standard-2`・`qty-premium-5`）。数は、そのプランのチャンネルに**出ているカードに書いてある数** |
| テーマ（貼るスニペット） | 買う人のプランのタグ（`grade-◯◯`）と突き合わせて、**数量の欄とカートを上限までに抑える** |
| pj（pj-sync） | それでも上限を超えた注文が入ったら、**運営のチャンネルに知らせる**（すり抜けへの備え） |

**かからない商品**：`member-list` のタグが無い商品には何もしません。
海外向けの商品（`os-`）と Omakase Ship のサービス商品は今までどおりです。

### 14-2. 上限の決まり（上から順に見る）

pj の `shared/mgate.js`（`qtyOf`）と `snippets/member-qty.liquid` に**同じ順**で
書いてあります（`tests/qtylim.mjs` で突き合わせ）。

| 順 | 条件 | 上限 |
| --- | --- | --- |
| ① | 商品に `member-list` が無い（海外向け・サービス商品） | **なし** |
| ② | 商品に `qty-◯◯-数` のタグが無い | **なし** |
| ③ | 顧客に `member-staff`（社内の確認用） | **なし** |
| ④ | 顧客の `grade-◯◯` と合う `qty-◯◯` がある | **合うものの、いちばん大きい数** |
| ⑤ | 1つも合わない（下の表） | **商品の `qty-◯◯` の、いちばん小さい数** |

**プランのタグが無い人・ログインしていない人の動き**

| 人 | 会員用の商品を開いたとき | カートに直接入れたとき（すり抜け） |
| --- | --- | --- |
| ログインしていない人 | 鍵（§1 の②）で**ログインの画面へ**。商品ページは出ないので買えない | ⑤ いちばん小さい上限で数量を抑える。注文が入れば運営に知らせる |
| ログイン済み・会員でない人（`member-list` なし） | 鍵（④）で `/pages/members-only` へ | 同上 |
| 会員だが `grade-◯◯` が付いていない人 | 鍵（⑤）で `/pages/members-only?why=plan` へ（会員用の商品にはどれも `grade-◯◯` が付いているため） | 同上（知らせには「プランのタグなし」と出る） |
| プランが合わない人（例：スタンダードからの商品にライト会員） | 鍵（⑤）で `/pages/members-only?why=plan` へ | 同上 |
| プランを2つ持つ人 | 見られる | ④ 大きいほうの数 |
| 社内（`member-staff`） | 見られる | 上限なし（知らせも出さない） |

商品ページを開けるのは「プランが合う会員」だけなので、ふつうの会員には
④ の数（自分のプランの上限）が効きます。⑤ は、鍵をすり抜けてカートに
入れられたときの受け皿です。

### 14-3. 貼る手順（複製テーマで）

貼るのは **スニペット2つ**と、**`layout/theme.liquid` の1行**です。
この1行で、**商品ページ**と**カート**（カートのページ・横から出るカート）の
両方に効きます（商品ページ用・カート用に分けて貼る必要はありません）。

**手順 0.** オンラインストア → テーマ → 複製テーマの「…」→ **ZIP をダウンロード**
（戻せるように）→「…」→ **コードを編集**

**手順 1.** 左の一覧の **スニペット** →「新しいスニペットを追加」→ 名前
`member-qty` → 中身をぜんぶ消して下を貼り、**保存**

{% raw %}
```liquid
{%- comment -%}
  会員用商品の「お一人◯点まで」（pj_price 8.83）
  Shopify ストア：Omakase Ship ／ テーマ：Rise

  これは「この人は、この商品を何点まで買えるか」を**数字で出すだけ**の
  部品です（0 は上限なし）。数量を抑える動きは member-qty-guard.liquid が
  します。貼るだけで、ここを直接どこかに差し込む必要はありません。

  使い方（member-qty-guard.liquid の中で使っています）
    {%- capture q -%}{%- render 'member-qty', product: product -%}{%- endcapture -%}
    {%- assign q = q | strip | plus: 0 -%}

  決まり（上から順に見る。pj の shared/mgate.js の qtyOf と同じ順）
    ① 商品に member-list が無い → 0（上限なし）
       海外向けの商品（os-）や Omakase Ship のサービス商品はここ。触りません
    ② 商品に qty-◯◯-数 のタグが1つも無い → 0（上限なし）
       タグは pj が付けます（例 qty-light-1／qty-standard-2／qty-premium-5）
    ③ 顧客に member-staff → 0（社内の確認用）
    ④ 顧客の grade-◯◯ と合う qty-◯◯ のうち、いちばん大きい数
    ⑤ 1つも合わない（ログインしていない・プランのタグが無い・
       プランが合わない）→ 商品の qty-◯◯ のうち、いちばん小さい数
       （本当は鍵で商品ページに入れない人です。カートに直接入れられた
         ときのために、いちばんきびしい数にしておきます）
{%- endcomment -%}
{%- liquid
  assign qmax = 0
  assign qmin = 0
  assign p = product
  if p != blank and p.tags contains 'member-list'
    for t in p.tags
      assign head = t | slice: 0, 4
      if head == 'qty-'
        assign parts = t | split: '-'
        if parts.size == 3
          assign n = parts[2] | plus: 0
          if n > 0
            if qmin == 0 or n < qmin
              assign qmin = n
            endif
            assign g = 'grade-' | append: parts[1]
            if customer != blank and customer.tags contains g
              if n > qmax
                assign qmax = n
              endif
            endif
          endif
        endif
      endif
    endfor
    if qmax == 0
      assign qmax = qmin
    endif
    if customer != blank and customer.tags contains 'member-staff'
      assign qmax = 0
    endif
  endif
-%}{{ qmax }}
```
{% endraw %}

**手順 2.** 同じように、名前 `member-qty-guard` のスニペットを作り、下を貼って**保存**

{% raw %}
```liquid
{%- comment -%}
  会員用商品の数量を「お一人◯点まで」に抑える（pj_price 8.83）
  Shopify ストア：Omakase Ship ／ テーマ：Rise

  使い方（layout/theme.liquid の </body> のすぐ上に1行）
    {%- render 'member-qty-guard' -%}
  この1か所で、**商品ページ**と**カート**（カートのページ・横から出る
  カート）の両方に効きます。

  すること
    ・商品ページ：数量の欄を上限までにする（カートに入っている数も数える）。
      上限を超える「カートに入れる」は止めて、理由を出す
    ・カート：上限を超えていたら、数量を上限まで減らして知らせる。
      超えたまま「ご購入手続きへ」は押せない
  しないこと
    ・会員用でない商品（member-list のタグが無い商品）には何もしない
      （海外向けの os-・Omakase Ship のサービス商品はそのまま）
    ・顧客の名前・メールなどは読まない（見るのはタグだけ）

  数の決まりは member-qty.liquid（pj の shared/mgate.js の qtyOf と同じ）。
  これは**画面の上での上限**です。カートの URL を直接組まれると
  すり抜けられます（そのときは pj-sync が注文を見て運営に知らせます）。
{%- endcomment -%}
{%- liquid
  assign pj_q_page = 0
  if template.name == 'product' and product != blank
    capture pj_q_cap
      render 'member-qty', product: product
    endcapture
    assign pj_q_page = pj_q_cap | strip | plus: 0
  endif
-%}
<script type="application/json" id="pj-qty-data">
{"product":{%- if pj_q_page > 0 -%}{"id":{{ product.id | json }},"max":{{ pj_q_page }}}{%- else -%}null{%- endif -%},
"cart":[
{%- for item in cart.items -%}
  {%- capture pj_q_cap -%}{%- render 'member-qty', product: item.product -%}{%- endcapture -%}
  {%- assign pj_q_n = pj_q_cap | strip | plus: 0 -%}
  {"key":{{ item.key | json }},"pid":{{ item.product_id | json }},"qty":{{ item.quantity | json }},"max":{{ pj_q_n }}}{%- unless forloop.last -%},{%- endunless -%}
{%- endfor -%}
]}
</script>
<script>
/* pj-qty-guard:start */
(function () {
  var el = document.getElementById('pj-qty-data');
  if (!el || !window.fetch) return;
  var D;
  try { D = JSON.parse(el.textContent || '{}'); } catch (e) { return; }
  var P = (D.product && D.product.max > 0) ? D.product : null;
  var MAX = {};                       /* 商品ID → 上限（会員用の商品だけ） */
  var any = false;
  if (P) { MAX[P.id] = P.max; any = true; }
  (D.cart || []).forEach(function (x) {
    if (x.max > 0) { MAX[x.pid] = x.max; any = true; }
  });
  if (!any) return;                   /* 会員用の商品が無いページでは何もしない */

  var ROOT = (window.Shopify && window.Shopify.routes
    && window.Shopify.routes.root) || '/';
  var KEY = 'pj-qty-fixed';
  var fetch0 = window.fetch.bind(window);
  var T_FIXED = 'カートの数量を、お一人の上限に合わせて直しました。';
  var T_OVER = 'お一人の上限を超えている商品があります。カートの数量を減らしてください。';
  function tItem(n, inCart) {
    return 'この商品はお一人 ' + n + '点までです。'
      + (inCart > 0 ? '（カートに ' + inCart + '点 入っています）' : '');
  }
  function say(text, bad) {
    var b = document.getElementById('pj-qty-msg');
    if (!b) {
      b = document.createElement('div');
      b.id = 'pj-qty-msg';
      b.setAttribute('role', 'alert');
      b.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);'
        + 'z-index:2147483000;max-width:92%;padding:10px 14px;border-radius:8px;'
        + 'font-size:14px;line-height:1.5;box-shadow:0 2px 10px rgba(0,0,0,.25);'
        + 'color:#fff;text-align:center';
      (document.body || document.documentElement).appendChild(b);
    }
    b.style.background = bad ? '#b3261e' : '#1b5e20';
    b.textContent = text;
    clearTimeout(say.t);
    say.t = setTimeout(function () {
      if (b.parentNode) b.parentNode.removeChild(b); }, 8000);
  }
  /* カートの行を、商品ごとに足す（会員用の商品だけ）。 */
  function sums(items) {
    var by = {};
    (items || []).forEach(function (x) {
      var pid = (x.pid !== undefined) ? x.pid : x.product_id;
      if (!MAX[pid]) return;
      var q = Number((x.qty !== undefined) ? x.qty : x.quantity) || 0;
      var o = by[pid] || (by[pid] = { sum: 0, lines: [] });
      o.sum += q;
      o.lines.push({ key: x.key, qty: q });
    });
    return by;
  }
  var NOW = sums(D.cart);
  /* 上限を超えているぶんを、後ろの行から減らす。 */
  function overList(by) {
    var fix = [];
    Object.keys(by).forEach(function (pid) {
      var over = by[pid].sum - MAX[pid];
      for (var i = by[pid].lines.length - 1; i >= 0 && over > 0; i--) {
        var l = by[pid].lines[i], cut = Math.min(l.qty, over);
        fix.push({ id: l.key, quantity: l.qty - cut });
        over -= cut;
      }
    });
    return fix;
  }
  function fixedAt() {
    try { return Number(window.sessionStorage.getItem(KEY)) || 0; }
    catch (e) { return 0; }
  }
  var fixing = false;
  function fixCart(by) {
    var fix = overList(by);
    if (!fix.length) return false;
    /* 直したばかりなのにまだ超えている：くり返さず、知らせるだけにする。 */
    if (Date.now() - fixedAt() < 15000) { say(T_OVER, true); return true; }
    if (fixing) return true;
    fixing = true;
    var i = 0;
    (function next() {
      if (i >= fix.length) {
        try { window.sessionStorage.setItem(KEY, String(Date.now())); } catch (e) {}
        window.location.reload();
        return;
      }
      var f = fix[i++];
      fetch0(ROOT + 'cart/change.js', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(f) }).then(next, next);
    })();
    return true;
  }
  function refresh() {
    return fetch0(ROOT + 'cart.js', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (c) { NOW = sums((c || {}).items); paint(); fixCart(NOW); })
      ['catch'](function () {});
  }
  /* テーマがカートを書き換えたら（追加・数量の変更）、数え直す。 */
  window.fetch = function (u) {
    var p = fetch0.apply(null, arguments);
    try {
      var url = String((u && u.url) || u || '');
      if (/\/cart\/(add|change|update|clear)/.test(url))
        p.then(function () { setTimeout(refresh, 300); }, function () {});
    } catch (e) {}
    return p;
  };

  /* ---- 商品ページ ---- */
  function inCart() { return P ? ((NOW[P.id] || { sum: 0 }).sum) : 0; }
  function remain() { return P ? Math.max(0, P.max - inCart()) : 0; }
  function isAdd(f) {
    return !!(f && f.getAttribute && /\/cart\/add/.test(f.getAttribute('action') || ''));
  }
  /* このページの商品のフォームか（おすすめ商品などの別の商品は触らない）。 */
  function mine(f) {
    var h = f.querySelector ? f.querySelector('input[name="product-id"]') : null;
    return !h || String(h.value) === String(P.id);
  }
  function paint() {
    if (!P) return;
    var r = remain(), cap = Math.max(1, r), first = null;
    var ins = document.querySelectorAll('input[name="quantity"]');
    for (var i = 0; i < ins.length; i++) {
      var f = ins[i].form;
      if (f && (!isAdd(f) || !mine(f))) continue;
      ins[i].setAttribute('max', String(cap));
      if (Number(ins[i].value) > cap) ins[i].value = String(cap);
    }
    var fs = document.querySelectorAll('form[action*="/cart/add"]');
    for (var j = 0; j < fs.length && !first; j++) if (mine(fs[j])) first = fs[j];
    if (!first) return;
    var note = document.getElementById('pj-qty-note');
    if (!note) {
      note = document.createElement('p');
      note.id = 'pj-qty-note';
      note.style.cssText = 'margin:8px 0 0;font-size:13px';
      first.parentNode.insertBefore(note, first.nextSibling);
    }
    var n = inCart();
    note.textContent = 'お一人 ' + P.max + '点まで'
      + (n > 0 ? ('（カートに ' + n + '点 入っています・'
          + (r > 0 ? ('あと ' + r + '点') : 'これ以上は入れられません') + '）') : '');
  }
  document.addEventListener('submit', function (ev) {
    if (!P) return;
    var f = ev.target;
    if (!isAdd(f) || !mine(f)) return;
    var q = 1;
    try { q = parseInt(new FormData(f).get('quantity'), 10) || 1; } catch (e) {}
    if (q > remain()) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      say(tItem(P.max, inCart()), true);
      return;
    }
    (NOW[P.id] || (NOW[P.id] = { sum: 0, lines: [] })).sum += q;
    paint();
    setTimeout(refresh, 1500);
  }, true);
  ['input', 'change'].forEach(function (name) {
    document.addEventListener(name, function (ev) {
      var t = ev.target;
      if (P && t && t.name === 'quantity') paint();
    }, true);
  });

  /* ---- カート ---- */
  /* カートのページの数量の欄（updates[]）は、カートの行と同じ並び。
     まだ送っていない数量も見て、超えていたら上限に戻す。 */
  function typedOver() {
    var ins = document.querySelectorAll('input[name="updates[]"]');
    var cart = D.cart || [];
    if (!ins.length || ins.length !== cart.length) return false;
    var by = {}, hit = false, i;
    for (i = 0; i < cart.length; i++) {
      if (!MAX[cart[i].pid]) continue;
      by[cart[i].pid] = (by[cart[i].pid] || 0) + (Number(ins[i].value) || 0);
    }
    for (i = cart.length - 1; i >= 0; i--) {
      var pid = cart[i].pid;
      if (!MAX[pid] || !(by[pid] > MAX[pid])) continue;
      var cut = Math.min(Number(ins[i].value) || 0, by[pid] - MAX[pid]);
      ins[i].value = String((Number(ins[i].value) || 0) - cut);
      by[pid] -= cut;
      hit = true;
    }
    return hit;
  }
  document.addEventListener('click', function (ev) {
    var t = (ev.target && ev.target.closest)
      ? ev.target.closest('[name="checkout"], a[href*="/checkout"]') : null;
    if (!t) return;
    var over = overList(NOW).length > 0;
    var typed = typedOver();
    if (!over && !typed) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (over) fixCart(NOW); else say(T_OVER, true);
  }, true);

  /* ---- 開いたとき ---- */
  function start() {
    paint();
    if (!fixCart(NOW) && Date.now() - fixedAt() < 15000) say(T_FIXED, false);
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start);
  else start();
})();
/* pj-qty-guard:end */
</script>
```
{% endraw %}

**手順 3.** `layout/theme.liquid` を開き、**`</body>` を検索**して、
その**すぐ上**に次の1行を足して**保存**

{% raw %}
```liquid
  {%- render 'member-qty-guard' -%}
```
{% endraw %}

> `</body>` はファイルのいちばん下の近くに1つだけあります。
> §3-1 で足した鍵の行（`member-gate`）はそのままにしてください。

**手順 4.（pj の側）**

1. pj-sync をデプロイ（Actions「deploy-pj-sync」：`dry_run` オフ・
   `run_migrations` オン・`deploy` オン）。D1 に `migrate-0070-sub-qty.sql` が入る
2. pj を開き直し（v332）、⚙「会員向けの配信」→
   **「お一人の上限を Shopify の商品にも入れる」をオン**
3. その下の **「確かめる（何も変えない）」** → 「お一人の上限のタグ：付けます
   直す必要がある ◯件」を見る
4. **「いまある会員用の商品を直す」** → もうある会員用の商品にタグが付く
   （これから作る商品には、自動配信が作るときに付けます）

### 14-4. 確かめ方（複製テーマのプレビューで）

| やること | 期待 |
| --- | --- |
| ライト会員（`grade-light`）で会員用の商品を開く | 「お一人 1点まで」と出て、数量の欄が 1 より増えない |
| そのままカートに入れ、もう一度「カートに入れる」 | 止まって「この商品はお一人 1点までです。（カートに 1点 入っています）」と出る |
| スタンダード会員で同じ商品 | 2点まで入る。3点目は止まる |
| カートの数量を上限より多くする（横から出るカートの「＋」・カートのページ） | 上限まで戻り、「カートの数量を、お一人の上限に合わせて直しました。」と出る |
| 海外向けの商品（`os-`）・サービス商品 | **今までどおり**（数量の欄もカートも変わらない） |
| 社内のアカウント（`member-staff`） | 上限なし |
| Shopify 管理画面で会員用の商品を開く | タグに `qty-light-1` などが付いている |

### 14-5. これで止められないこと（すり抜け）と備え

これは**画面の上での上限**です。Shopify 本体のお会計は止めません
（お会計で止める仕組みは、カスタムアプリでは Plus が要ります・§6-1）。

| 抜け道 | 備え |
| --- | --- |
| カートの URL を直接組む（`/cart/バリアントID:数量`） | **注文が入ったら運営のチャンネルに知らせる**（下） |
| 注文を何回かに分けて買う | 止められません・知らせも出ません（pj は顧客を追わず、**1つの注文の中の数量**だけを見るため） |
| 「今すぐ購入」などの速いお会計のボタン | 数量の欄の上限は効きます。カートに入っている分とは合算されません（別の注文になるため） |

**上限を超えた注文の知らせ**（pj-sync・⚙のオン／オフに関係なく動きます）

- 知らせる先：運営専用の宛先（`DISCORD_OPS_WEBHOOK_URL`）。無ければ今までの社内用の宛先
- 出すもの：**注文番号・会員のプラン・商品（名前と JAN）・数量・上限**だけ
- **氏名・住所・メール・電話は読みません・保存しません・出しません**
  （同じ注文を二度知らせないために、知らせた**注文番号と JAN** だけを 200件まで控えます）
- いつ：Shopify の webhook（`orders/create`・`orders/paid`）が pj-sync の
  `/mem/hook` に届いたとき（その場で）。webhook を登録していないあいだは、
  **注文CSV を取り込んだとき**
- 買った人のプラン：webhook では注文に付いてくる顧客のタグから。注文CSV では
  注文のタグ（Flow が写した `grade-◯◯`・§6-2）から。CSV にタグが無い注文は
  「分かりません」として、**どのプランでも超える数量**のときだけ知らせます
- 対応（返金・連絡）はカジが手でします。pj は注文を止めたり直したりしません

知らせの例：

```
⚠️ 上限を超えた数量の注文 … 1件
・注文 #2001　プラン：ライト　商品：◯◯◯（4902370551000）　数量 3点／上限 1点
```

### 14-6. 元に戻し方

| 戻したいもの | やること |
| --- | --- |
| テーマの上限をやめる | `layout/theme.liquid` の `render 'member-qty-guard'` の1行を消す（スニペット2つは残っていても動きません） |
| 商品のタグを外す | ⚙「お一人の上限を Shopify の商品にも入れる」を**オフ** →「確かめる（何も変えない）」で「直す必要がある ◯件」を見る →「いまある会員用の商品を直す」（付けたタグを外します） |

### 14-7. 確かめたこと・確かめられなかったこと

| こと | どうか |
| --- | --- |
| スニペットの判定が pj の決まり（`shared/mgate.js`）と同じ結果になる | 本物の Liquid エンジン（liquidjs）で 63通りを突き合わせて一致（2026-11-20） |
| スクリプトの動き（数量の欄・カートの直し・くり返さない・会員用でない商品は触らない） | 作り物の店のページで確認（`tests/qtylimui.js`） |
| Rise の実物の商品ページ・横から出るカートで思ったとおりに動くか | **この環境では確かめられません**（複製テーマのプレビューで §14-4 を見てください） |
| webhook の注文に顧客のタグが付いてくるか | Shopify の注文の webhook には顧客の欄（タグを含む）が入る仕様ですが、**実物では未確認**。タグの欄が付いてこない注文は「分かりません」として、**どのプランでも超える数量**のときだけ知らせます（まちがった知らせを出さないため） |

## 15. 会員用（sub-）・1点もの（one-）を CSV で取り込むときの Status（8.88・v337）

§13 では「CSV は Status の欄を出さない（上書きで非公開が解けないように）」に
していたが、**Status の列が無いと、新しい商品は active（公開）で入る**
（Shopify の説明：「If the column isn't present, then the product status is
automatically uploaded as active」）。そのため、新しく取り込んだ会員用の商品が
ストアの一覧・検索・海外向けカタログに出てしまった。

CSV の Status に入れられるのは **active／draft／archived の3つだけ**で、
unlisted（非公開）は入れられない。そこで（カジの決定・2026-11-22）：

| 商品 | CSV の Status |
| --- | --- |
| まだ Shopify に入れていない sub-・one- | **draft**（下書き。取り込んだ直後から、どこにも出ない） |
| もう読み込んだ sub-・one-（「Shopify に読み込みました」の印あり） | **列を出さない**（別のファイル。いまの非公開のまま） |
| 海外向けの os- | 今までどおり（⚙「Shopify に出すときの状態」。公開なら active） |

取り込んだら、pj の **「非公開（Unlisted）にそろえる」**（会員用・1点もの
それぞれにあります）を押します。pj-sync が Shopify の管理 API で

- active・draft の sub-・one- を **非公開（Unlisted）** にする
- オンラインストアに公開する（非公開でもリンクで開くために要る）
- 海外向けの商品リスト（⚙ の名前・既定 Overseas products）から外す
- アーカイブの商品・Shopify に無い商品・os- の商品は触らない

1回目は確かめるだけ（件数を出す）で、確認のあとに直します。
**取り込んだあと、Shopify でステータスが「非公開」になっているか確かめてください**
（商品 → タグ `member-list` で絞り込み、ステータスの列）。
Shopify の管理 API の鍵（8.80 で登録したもの）が要ります。
