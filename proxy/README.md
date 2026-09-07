# pj-price — 商品名パースプロキシ（pj_price 専用）

pj_price（eBay 値付け計算機）の「商品名を貼り付け → 5項目に自動振り分け」機能専用の
Cloudflare Worker です。貼り付けた商品名を Anthropic API に投げ、
`brand / series / chara / variant / line` の5項目（英語）に分解して返します。

**このWorkerは pj_price 専用です。** 将来 eBay CSV出品 や keepa-hunter でも
Anthropic / eBay の鍵が必要になりますが、**用途が違うので Worker は分けてください**。
1本に集約すると、片方の不具合・レート制限・鍵ローテーションが全用途に波及します。

## なぜプロキシが要るか

pj_price は公開リポジトリで GitHub Pages に静的配信しています。
APIキーを `index.html` に書くと公開されてしまうため、鍵は Worker の
暗号化Secret に置き、ブラウザは鍵を持たずにこの Worker を呼びます。
Worker 側でモデル・プロンプト・`max_tokens` を固定しているので、
汎用的な Claude プロキシとしては使えません。

## エンドポイント

- 公開URL: **https://pj-price.gamegamesan.workers.dev**
  （Cloudflare 上のプロジェクト名は `pj-price`。`wrangler.toml` の `name` と一致）
- `POST /`  Body: `{ "text": "<貼り付けた商品名>" }`（最大2KB）
- 応答: `{ "brand","series","chara","variant","line" }`（英語・不明は空文字）
- CORS は pj_price の Pages オリジン `https://gamegamesan-dot.github.io` に限定。

## デプロイ手順

```bash
npm install -g wrangler        # 未導入なら
cd proxy
wrangler login                 # Cloudflare アカウントにログイン
wrangler secret put ANTHROPIC_API_KEY   # 鍵を貼り付け（この値はどこにも保存しない）
wrangler deploy
```

デプロイ後に表示される URL を、`index.html` 冒頭の `PARSE_API` 定数に
設定してください（末尾に `/` 不要）。**設定済み**です。

```js
var PARSE_API = 'https://pj-price.gamegamesan.workers.dev';
```

`PARSE_API` が空のあいだは、pj_price 側は「自動で振り分け」ボタンを無効化し、
**手入力での出品は通常どおり可能**です（自動振り分けはあくまで補助）。

## レート制限（濫用対策）

使用者は1人のため、まずは Cloudflare ダッシュボードの
**Security → WAF → Rate limiting rules** で Worker のルート宛てに
IP単位のルール（例: 60 requests / minute）を1つ入れて運用します。
KV / Durable Object での自前カウンタは、実際に濫用が起きてから検討すれば十分です。

## 鍵の更新・失効

```bash
wrangler secret put ANTHROPIC_API_KEY   # 上書き（ローテーション）
wrangler secret delete ANTHROPIC_API_KEY
```

Secret は Cloudflare 側にのみ保存され、このリポジトリには含まれません。
