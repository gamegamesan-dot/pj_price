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

```
/customer_authentication/redirect?locale=ja&region_country=JP&return_to=%2Fproducts%2Fsub-…
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
| ① 既定 | `member_login_mode = 'routes'`（そのまま） | テーマの決まりの URL（`/customer_authentication/redirect?…&return_to=…`） |
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
| ログイン後に元のページへ戻る（`return_to`） | **このストアは新しい顧客アカウント**。ログイン URL に最初から `?` が付くので **`&` でつなぐ**ようにした（v284）。実際に戻るかは §7-3 の手順でカジが複製テーマで確かめる |
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

### 手順 1. `snippets/member-gate.liquid` を貼り替える（v284）

左の一覧から `snippets/member-gate.liquid` を開き、**中身をぜんぶ消して**
下を貼り、**保存**します。

> 見分け方：いまの中身の2行目が `会員用商品の鍵（pj_price 8.24）` だけなら
> **v283**です（v284 は `8.24／8.26`）。

<!-- Liquid は raw の中に置く（GitHub Pages が自分のものとして読まないように） -->
{% raw %}

```liquid
{%- comment -%}
  会員用商品の鍵（pj_price 8.24／8.26）
  Shopify ストア：Omakase Ship ／ テーマ：Rise

  これは「商品ページを見せてよいか」を決めるだけの部品です。
  **飛ばす先の URL を出すだけ**で、商品の中身は何も出しません。

  決まり（上から順に見る。pj の shared/mgate.js と同じ順）
    ① 商品に member-list が無い → だれでも見られる
    ② ログインしていない       → ログインへ（戻り先つき）
    ③ 顧客に member-staff      → ぜんぶ見られる（社内の確認用）
    ④ 顧客に member-list が無い → /pages/members-only
    ⑤ 商品の grade-◯◯ と顧客の grade-◯◯ が1つも合わない
       → /pages/members-only?why=plan
       商品に grade-◯◯ が1つも無いときは、会員ならだれでも見られる

  ▼ ログインの行き先（8.26）
    このストアは新しい顧客アカウントなので、routes.account_login_url が
      /customer_authentication/redirect?locale=ja&region_country=JP
    のように**最初から ? が付いて**返ってきます。
    そこに '?return_to=' をつなぐと戻れないので、
    **? があれば & でつなぐ**ようにしました。
{%- endcomment -%}
{%- liquid
  # ログインしていない人の行き先。ここの1行だけで切り替えられる。
  # 'routes'  … テーマの決まりのログイン URL（既定）
  # 'classic' … /account/login?return_to=… に送る（旧のログイン画面）
  # 'page'    … ログインに飛ばさず /pages/members-only に案内する
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
          assign lurl = routes.account_login_url | default: '/account/login'
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
   - 戻った → そのまま（`member_login_mode = 'routes'`）
   - 戻らない → `'classic'` に書き替えて同じ手順
   - どちらも戻らない → **`'page'`** にする（ログインに飛ばさず
     「会員向けのご案内」に出す。2手になりますが行き止まりになりません）

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
