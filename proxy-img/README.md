# pj-img — pj_price 用の画像ホスティング（Cloudflare Worker + R2）

eBay の CSV 一括出品では `PicURL` に公開URLを並べる。eBay 側が画像を取りに来るため、
配信は認証なしで公開する必要がある。この Worker はその置き場。

商品名パース用の `proxy/`（Worker 名 `pj-price`）とは**別の Worker**。
用途ごとに分けてあるので、片方を作り直してももう片方に影響しない。

| | |
|---|---|
| Worker 名 | `pj-img` |
| R2 バケット | `pj-img`（バインディング名 `IMG`） |
| シークレット | `UPLOAD_TOKEN` |
| 許可オリジン | `https://gamegamesan-dot.github.io` |

## エンドポイント

| メソッド | パス | 認証 | 内容 |
|---|---|---|---|
| `POST` | `/upload` | `Authorization: Bearer <UPLOAD_TOKEN>` | 画像を1枚保存。本文は画像バイナリそのもの |
| `GET` | `/i/<key>` | なし（公開） | 配信。`Content-Type` は R2 のメタデータ、`Cache-Control` は1年 |
| `DELETE` | `/i/<key>` | 同上 | 削除 |

- 受け付ける `Content-Type` は `image/jpeg` / `image/png` / `image/webp` のみ
- 1枚 5MB まで
- キーはサーバ側で生成する（`YYYYMMDD/<uuid>.jpg`）。クライアントに任意のパスは切らせない
- `POST /upload` の応答は `{ "url": "https://pj-img.<subdomain>.workers.dev/i/20260925/....jpg", "key": "20260925/....jpg" }`

## 手順

### 1. R2 バケットを作る

```sh
npx wrangler r2 bucket create pj-img
```

Cloudflare ダッシュボードの R2 から作っても同じ。名前は `pj-img`。
**パブリックアクセス（r2.dev の公開URL）は有効にしなくてよい。** 配信はこの Worker が行う。

### 2. アップロードトークンを登録する

長いランダム文字列を用意する。

```sh
openssl rand -base64 32
```

登録する。リポジトリにも `wrangler.toml` にも書かない。

```sh
cd proxy-img
npx wrangler secret put UPLOAD_TOKEN
# プロンプトに上で作った文字列を貼る
```

### 3. デプロイ

```sh
cd proxy-img
npx wrangler deploy
```

`https://pj-img.<あなたのサブドメイン>.workers.dev` が払い出される。

### 4. pj_price 側に設定する

出品CSVタブ →「CSVの設定」に入れる。

- **画像サーバーURL**: 上のURL（末尾のスラッシュは不要）
- **アップロードトークン**: 手順2の文字列

どちらも端末の localStorage（`pj:csvcfg:v1`）に保存される。
**トークンは端末に平文で残る。** 共有端末では使わないこと。漏れたと思ったら手順2をやり直して
`wrangler deploy` すれば、古いトークンは即座に無効になる。

## 動作確認

```sh
TOKEN='<UPLOAD_TOKEN>'
BASE='https://pj-img.<subdomain>.workers.dev'

# アップロード
curl -sS -X POST "$BASE/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/jpeg" \
  --data-binary @test.jpg

# → {"url":"https://.../i/20260925/xxxx.jpg","key":"20260925/xxxx.jpg"}

# 配信（認証なしで見えること）
curl -sSI "$BASE/i/20260925/xxxx.jpg" | head -5

# トークンが違えば拒否されること
curl -sS -X POST "$BASE/upload" -H "Authorization: Bearer wrong" \
  -H "Content-Type: image/jpeg" --data-binary @test.jpg
# → {"error":"unauthorized"}

# 削除
curl -sS -X DELETE "$BASE/i/20260925/xxxx.jpg" -H "Authorization: Bearer $TOKEN"
```

## 運用上の注意

- **中古品はストック写真を使えない**（eBay の画像ポリシー）。中古の行は実物を撮る
- eBay は1出品あたり画像24枚まで。pj_price 側は12枚で止めている
- 削除しても eBay 側の出品が参照していれば画像が消える。出品を取り下げてから消すこと
- R2 の無料枠は保存10GB/月・Class A 100万回/月・Class B 1000万回/月。
  長辺1600pxのJPEGなら1枚300KB前後なので、月1,000枚でも0.3GB程度
- 料金とレート制限は Cloudflare ダッシュボードで確認する。必要なら Rate Limiting ルールを足す
