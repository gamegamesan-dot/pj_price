# eBay 値付け計算機 (PWA)

Play Japan / 有限会社オーシャン貿易 の eBay 輸出向け価格計算ツール。
スマホのホーム画面に追加すると、全画面のアプリとして動きます。圏外でも動作します。

## ファイル

| ファイル | 役割 |
|---|---|
| `index.html` | アプリ本体（計算ロジック・日本郵便料金表を内蔵） |
| `manifest.webmanifest` | アプリ名・アイコン・全画面表示の定義 |
| `sw.js` | オフライン動作用（Service Worker） |
| `icon-192.png` / `icon-512.png` | Android・PWA用アイコン |
| `apple-touch-icon.png` | iOS ホーム画面用アイコン |
| `favicon-32.png` | ブラウザタブ用 |

## 公開手順（GitHub Pages）

1. GitHub で新しいリポジトリを作る（例: `pj-pricing`）。Public にする
2. このフォルダの中身をすべてアップロード（フォルダごとではなく、ファイルを直接）
3. リポジトリの **Settings → Pages** を開く
4. Source を **Deploy from a branch**、Branch を **main / (root)** にして Save
5. 1〜2分待つと `https://<ユーザー名>.github.io/pj-pricing/` で開けます

Service Worker は HTTPS が必要です。GitHub Pages は HTTPS なのでそのまま動きます。

## ホーム画面に追加

**iPhone (Safari)**
公開URLを Safari で開く → 共有ボタン → 「ホーム画面に追加」

**Android (Chrome)**
公開URLを開く → メニュー → 「アプリをインストール」

## 更新のしかた

`index.html` などを差し替えたら、`sw.js` の1行目
```js
const V = 'pj-pricing-v1';
```
を `v2`, `v3` … と変更してください。これを変えないと古いキャッシュが残り続けます。

## 料金表の更新

`index.html` 内の定数 `AIR`（国際エアパケット）と `EMS` を直接書き換えます。
2026年7月時点の日本郵便公表料金です。値上げ時は差し替えてください。

- 国際エアパケット: https://www.post.japanpost.jp/service/send/oversea/list/delivery/airpacket.html
- EMS: https://www.post.japanpost.jp/send/oversea/charge/list-ems/all.html

## 計算式

```
a = R × (1 − 手数料率 − 為替コスト率)
b = R × 関税率

利益 = 売値×(a − b) + 請求送料×a − 固定手数料 − 仕入 − 梱包 − 実送料
売値 = (目標利益 + 固定手数料 + 仕入 + 梱包 + 実送料 − 請求送料×a) / (a − b)
```

「Best Offer 自動拒否ライン」は目標利益 0 のときの売値です。
