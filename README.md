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

このアプリはリポジトリ **`pj_price`**（Public）で公開済みです。GitHub Pages は有効です。

- 公開URL: **https://gamegamesan-dot.github.io/pj_price/**
- 設定: **Settings → Pages** で Source = **Deploy from a branch**、Branch = **main / (root)**

ファイルを差し替えて `main` に push すると、1〜2分で公開URLに反映されます（あわせて `sw.js` のバージョンも上げること。下記「更新のしかた」参照）。

Service Worker は HTTPS が必要です。GitHub Pages は HTTPS なのでそのまま動きます。

## ホーム画面に追加

**iPhone (Safari)**
公開URLを Safari で開く → 共有ボタン → 「ホーム画面に追加」

**Android (Chrome)**
公開URLを開く → メニュー → 「アプリをインストール」

## 更新のしかた

`index.html` などを差し替えたら、`sw.js` の2行目
```js
const V = 'pj-pricing-v5';
```
の末尾の番号を `v6`, `v7` … と上げてください。これを変えないと古いキャッシュが残り続けます。
（`pj-pricing` はキャッシュ名の接頭辞で、リポジトリ名 `pj_price` とは別物です。変更不要）

## 料金表の更新

`index.html` 内の定数 `AIR`（国際エアパケット）と `EMS` を直接書き換えます。
内蔵値は **2026-08-07 時点**の日本郵便公表料金です（同社公式で確認済み。例: 国際エアパケット 米国 500g=¥2,040 / 1kg=¥3,090 / 2kg=¥5,190、EMS 米国 500g=¥3,900 / 1kg=¥5,300 / 2kg=¥7,900）。値上げ時は差し替えてください。

- 国際エアパケット: https://www.post.japanpost.jp/service/send/oversea/list/delivery/airpacket.html
- EMS: https://www.post.japanpost.jp/send/oversea/charge/list-ems/all.html

> 同じ日本郵便の料金表を `akiba-ship/rates.js` でも保持しています。値上げ時は両方を更新してください。

## 計算式

```
R = 為替レート（円/USD）

■ 米国関税・通関手数料（米国宛 = zone 4 のときだけ加算。非US は 0）
  出典: 2026-09-05 に Zonos Prepay アプリで実測（制度変更で変わる）
  関税率 d      = 0.1374（zone 4）/ 0（それ以外）   ← 関税12.5% + 通関手数料の変動分1.24%
  固定 fixed_us = ¥562 （zone 4）/ 0（それ以外）    ← 通関手数料の固定分
  米国関税額 = 申告額 × 0.1374 + ¥562   （申告額 = 売値 × R。zone 4 のみ／非US は 0）
    例: 申告額 5,000円 → ¥1,249 ／ 10,000円 → ¥1,936（固定562があるため少額ほど負担が重い）

a = R × (1 − 手数料率 − 為替コスト率)
b = R × d
固定計 = 固定手数料 + fixed_us

利益 = 売値×(a − b) + 請求送料×a − 固定計 − 仕入 − 梱包 − 実送料
売値 = (目標利益 + 固定計 + 仕入 + 梱包 + 実送料 − 請求送料×a) / (a − b)
```

「Best Offer 自動拒否ライン」は目標利益 0 のときの売値です（＝損益分岐価格）。米国宛はこの関税分だけ分岐点が上がり、非US（アジア等）は加算されないぶん下がります。
