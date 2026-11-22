/* 決まり：会員用の商品は「非公開（Unlisted）」（8.41・カジの依頼・2026-11-15）

   理由（カジ）
     /products.json で会員用の商品名と価格が誰でも取れてしまう。
     1件を手で非公開にしたら、/products.json とサイトマップから消えた。
     商品ページを直接開くこととカートに入れることはそのままできた（実機確認）。
     会員は Discord のカードの「購入する」（/products/sub-JAN）から入るので、
     一覧に出なくても困らない。

   調べたこと（2026-11-15）
     ・Shopify の商品ステータスは active／draft／archived／**unlisted** の4つ
     ・ただし**商品CSV の Status に入れられるのは active／draft／archived だけ**
       （Shopify ヘルプ「CSV ファイルを使用した商品のインポートとエクスポート」）
     ・unlisted を付けられるのは**管理画面**か **Admin API（ProductStatus の
       UNLISTED・2025-10 以降）**

   そこで pj は
     ・会員用の商品CSV（sub-／one-）から **Status の列ごと出さない**
       （active と書くと、上書き取り込みのたびに非公開が解けてしまう）
     ・一般向け（海外向け os-）は**今までどおり active**
     ・非公開を付けるのは Shopify の管理画面（手順書 §13） */
import { harness } from './lib.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const A=require('../shared/shopcsv.js');
const O=require('../shared/osscsv.js');
const T=harness('決まり：会員用の商品は非公開（8.41）');
const ok=T.ok;
const ROOT=path.resolve(new URL('.',import.meta.url).pathname,'..');
const cells=(t)=>A.splitCsv(t);
const head=(t)=>cells(t)[0];
const cell=(t,r,name)=>{
  const rows=cells(t); const i=rows[0].indexOf(name);
  return i<0?undefined:rows[r][i];
};
const IT={ jan:'4902370550467', name:'スーパーマリオパーティ ジャンボリー',
  asin:'B0D1GSZJ8T', kishu:'Switch', price:5300, max_qty:3, size_g:110 };
const ONE={ id:1, name:'秋葉原の1点もの', cond:'新品', price:4800, qty:1,
  ship_kind:'small', grades:'premium' };

console.log('=== ① 会員用の商品CSV に Status の列が無い ===');
{
  const csv=A.build([IT],{});
  console.log('   '+head(csv).join(','));
  ok(A.COLS.indexOf('Status')<0,'★★★出す列に Status が入っていない');
  ok(head(csv).indexOf('Status')<0,
     '★★★書き出した CSV にも Status の欄が無い（古い列名でも）');
  ok(head(A.build([IT],{ cols:'new' })).indexOf('Status')<0,
     '★★新しい列名の形でも出さない');
  ok(cell(csv,1,'Published')==='true',
     '★★★オンラインストアには公開する（非公開＝Unlisted は別のもの）');
}

console.log('=== ② 1点もの（one-）も同じ ===');
{
  const csv=A.oneBuild([ONE],{});
  console.log('   '+head(csv).join(','));
  ok(head(csv).indexOf('Status')<0,'★★★1点ものの CSV にも Status が無い');
  ok(cell(csv,1,'Handle')==='one-1','★ハンドルは one-<連番>');
}

console.log('=== ③ 在庫CSV にもない（毎回出すもの）===');
{
  const inv=A.invCsv([IT],{ location:'本社' });
  ok(A.INV_COLS.indexOf('Status')<0&&head(inv).indexOf('Status')<0,
     '★★★在庫CSV は Status を触らない（非公開のまま数だけ直せる）');
}

console.log('=== ④ 一般向け（海外向け os-）：既定は下書き・⚙で公開（8.73）===');
{
  const csv=O.build([{ jan:'4902370550467',
    titleEn:'Super Mario Party Jamboree', descHtml:'<p>x</p>', kishu:'NS',
    usd:49.99, wholesale:3500, qty:1, grams:210, cost:4200,
    pics:[{ url:'https://img.example.jp/a.jpg' }] }],{ fx:160, pct:100 });
  const h=cells(csv);
  const i=h[0].indexOf('Status');
  console.log('   Status='+(i<0?'（無い）':h[1][i]));
  /* 8.73（カジの依頼・2026-11-19）一般向けも**最初は下書き**で書き出し、
     ⚙「Shopify に出すときの状態」を「公開」にしたときだけ active にする。
     会員向けの「非公開（unlisted）」とは別のもの（一般向けは draft か active）。 */
  ok(i>=0&&h[1][i]==='draft',
     '★★★一般向けの商品は、既定では下書き（draft）で出す');
  const csv2=O.build([{ jan:'4902370550467',
    titleEn:'Super Mario Party Jamboree', descHtml:'<p>x</p>', kishu:'NS',
    usd:49.99, wholesale:3500, qty:1, grams:210, cost:4200,
    pics:[{ url:'https://img.example.jp/a.jpg' }] }],
    { fx:160, pct:100, status:'active' });
  const h2=cells(csv2);
  ok(h2[1][i]==='active','★★★⚙で「公開」にすると active（unlisted にはしない）');
  ok(O.COLS.indexOf('Status')>=0,'★★海外向けは Status の列も今までどおり');
}

console.log('=== ⑤ 手順書に書いてある ===');
{
  const g=fs.readFileSync(
    path.join(ROOT,'pj_price_追加仕様_Shopify会員用の鍵.md'),'utf8');
  ok(/非公開（Unlisted）/.test(g),'★★★手順書に「非公開（Unlisted）」がある');
  ok(/products\.json/.test(g)&&/カードのリンク/.test(g),
     '★★★「/products.json に出ない・カードのリンクからは買える」と書いてある');
  ok(/active／draft／archived/.test(g),
     '★★★CSV の Status に unlisted を入れられないことが書いてある');
  ok(/52/.test(g),'★★いま Shopify にある会員用の商品を直す手順がある');
}

await T.done();
