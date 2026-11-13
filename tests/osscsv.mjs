/* shared/osscsv.js：海外の一般のお客さん向け Shopify の商品CSV（6.193・【1】〜【4】【7】）
   ・Handle は os-<JAN>（会員向けの sub-<JAN> とは別の商品）
   ・SKU は eBay と同じ W-<JAN>
   ・値段は eBay の売値（USD）× 為替 × ⚙%（送料込み）
   ・重さは eBay の送料計算に使っている重さ
   ・在庫は eBay に出す数量と同じ・Inventory policy は deny
   ・画像は MW が許諾した画像だけ（Amazon の画像は使わない）
   ・Tags は export と機種。member-list と grade-* は絶対に付けない
   ・説明は eBay の英文から eBay 固有の文言・リンクを外したもの */
import { harness } from './lib.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const A=require('../shared/osscsv.js');
const S=require('../shared/shopcsv.js');
const T=harness('shared/osscsv.js：海外向け Shopify 商品CSV（6.193）');
const ok=T.ok;

const DESC='<div><h1><!--TITLE-->Super Mario Party Jamboree<!--/TITLE--></h1>'
  +'<h2>Condition</h2><p>Brand new, factory sealed.</p>'
  +'<h2>Shipping</h2><ul>'
  +'<li>Packed in a sturdy box with bubble wrap.</li>'
  +'<li>Delivery speed and carrier options are shown in the Shipping and payments section of this listing.</li>'
  +'</ul>'
  +'<h2>Import duties</h2>'
  +'<p>For orders shipped to the United States, import duties are prepaid by us.</p>'
  +'<p>For all other destinations, any import duties or taxes are the responsibility of the buyer.</p>'
  +'<h2>Returns</h2><p>Returns are accepted under the terms shown in the Shipping and payments section. '
  +'If anything arrives damaged or not as described, message us through eBay first and it will be put right.</p>'
  +'<div><h2>About Play Japan</h2><p>We ship from Tokyo.</p></div></div>';

const IT={ jan:'4902370550467', titleEn:'Super Mario Party Jamboree Nintendo Switch Japan',
  descHtml:DESC, kishu:'NS', usd:49.99, qty:1, grams:210, cost:4200,
  pics:[{url:'https://img.example.jp/a.jpg'},{url:'https://img.example.jp/b.jpg'}] };
const OPT={ fx:160, pct:100, vendor:'Play Japan' };
const DAY=new Date('2026-11-13T09:00:00+09:00');

const cells=(text)=>S.splitCsv(text);
const cell=(text,r,name)=>{
  const rows=cells(text);
  const i=rows[0].indexOf(name);
  return i<0?undefined:rows[r][i];
};

console.log('=== 列の名前（このストアの形＝古い名前）===');
console.log('   '+A.COLS.join(' / '));
ok(A.COLS[0]==='Handle','★★★Handle（古い名前）');
ok(A.COLS.indexOf('Body (HTML)')>=0,'★★★Body (HTML)（古い名前）');
ok(A.COLS.indexOf('Variant Price')>=0,'★★★Variant Price（古い名前）');
ok(A.COLS.indexOf('Variant SKU')>=0,'★★★Variant SKU（古い名前）');
ok(A.COLS.indexOf('Variant Grams')>=0,'★★★Variant Grams（古い名前）');
ok(A.COLS.indexOf('Cost per item')>=0,'★★Cost per item がある');
ok(A.COLS.indexOf('Option1 Name')>=0&&A.COLS.indexOf('Option1 Value')>=0,
   '★★★Option1 Name/Value を必ず出す（入れないとバリアントが消える）');

console.log('=== Handle と SKU ===');
ok(A.handleOf('4902370550467')==='os-4902370550467','★★★Handle は os-<JAN>');
ok(A.skuOf('4902370550467')==='W-4902370550467','★★★SKU は eBay と同じ W-<JAN>');
ok(A.handleOf(' 4902-3705-50467 ')==='os-4902370550467','★JAN の記号は落とす');
ok(A.isOs('os-123')&&!A.isOs('sub-123'),'★os- を見分ける');
ok(A.isSub('sub-123')&&!A.isSub('os-123'),'★sub- を見分ける');
ok(A.handleOf('4902370550467')!==S.handleOf('4902370550467'),
   '★★★会員用（sub-）と別の商品になる');

console.log('=== 1行の中身 ===');
const csv=A.build([IT],{...OPT,date:DAY});
ok(cell(csv,1,'Handle')==='os-4902370550467','★★★Handle');
ok(cell(csv,1,'Title')===IT.titleEn,'★★★Title は eBay の英題');
ok(cell(csv,1,'Variant SKU')==='W-4902370550467','★★★Variant SKU は W-<JAN>');
ok(cell(csv,1,'Variant Grams')==='210','★★★重さは eBay の送料計算の重さ');
ok(cell(csv,1,'Variant Inventory Qty')==='1','★★★在庫は eBay に出す数量と同じ');
ok(cell(csv,1,'Variant Inventory Policy')==='deny','★★★Inventory policy は deny');
ok(cell(csv,1,'Variant Inventory Tracker')==='shopify','★在庫は Shopify が数える');
ok(cell(csv,1,'Cost per item')==='4200','★★★Cost per item は仕入原価');
ok(cell(csv,1,'Published')==='true'&&cell(csv,1,'Status')==='active','★公開で出す');
ok(cell(csv,1,'Vendor')==='Play Japan','★Vendor は⚙の値');
ok(cell(csv,1,'Variant Requires Shipping')==='true','★送るものとして出す');

console.log('=== 値段（eBay の売値 × 為替 × ⚙%）===');
ok(cell(csv,1,'Variant Price')==='7998','★★★49.99 × 160 × 100% ＝ ¥7,998');
ok(A.yenOf(49.99,{fx:160,pct:120})===9598,'★★★⚙ 120% で ¥9,598');
ok(A.yenOf(49.99,{fx:160,pct:80})===6399,'★★80% で ¥6,399');
ok(A.pctOf({})===100&&A.PCT_DEF===100,'★★⚙ の既定は 100%');
ok(A.yenOf(49.99,{fx:0})===0,'★為替が0なら0（出さない行になる）');

console.log('=== Tags（会員の印は絶対に付けない）===');
const tags=cell(csv,1,'Tags');
console.log('   Tags：'+tags);
ok(/(^|,\s*)export(,|$)/.test(tags),'★★★export が付く');
ok(tags.indexOf('Nintendo Switch')>=0,'★★★機種は正式な呼び名（NS→Nintendo Switch）');
ok(tags.indexOf('member-list')<0,'★★★member-list を付けない');
ok(!/grade-/.test(tags),'★★★grade-* を付けない');
const tg2=A.tagsOf({kishu:'NS'},{tags:['member-list','grade-premium','sale']});
ok(tg2.indexOf('member-list')<0&&tg2.join(',').indexOf('grade-')<0,
   '★★★⚙ で足したタグでも会員の印は弾く');
ok(tg2.indexOf('sale')>=0,'★ほかの足したタグは通す');

console.log('=== 説明（eBay 固有の文言・リンクを外す）===');
const body=cell(csv,1,'Body (HTML)');
ok(!/ebay/i.test(body),'★★★eBay の文字が残らない');
ok(body.indexOf('<!--')<0,'★★eBay 側の差し替えの目印（コメント）を外す');
ok(body.indexOf('Shipping and payments')<0,'★★★eBay の画面の案内を外す');
ok(body.indexOf('import duties are prepaid')<0,
   '★★★eBay の関税前払いの文を外す（Shopify では成り立たない）');
ok(body.indexOf('Delivery options and costs are shown at checkout.')>=0,
   '★★配送の文は Shopify 向けに置き換える');
ok(body.indexOf('If anything arrives damaged or not as described, contact us first')>=0,
   '★★返品の文は Shopify 向けに置き換える');
ok(body.indexOf('Brand new, factory sealed.')>=0,'★★★商品の説明は残る');
ok(body.indexOf('responsibility of the buyer')>=0,'★★関税の一般の文は残る');
ok(body.indexOf('We ship from Tokyo.')>=0,'★店の紹介は残る');
const lnk=A.stripEbay('<p>See <a href="https://www.ebay.com/itm/1">our listing</a> here.</p>');
ok(lnk.indexOf('ebay.com')<0,'★★★eBay へのリンクを外す');

console.log('=== 画像（MW が許諾した画像だけ）===');
ok(cell(csv,1,'Image Src')==='https://img.example.jp/a.jpg','★★★1枚目がメイン');
ok(cell(csv,1,'Image Position')==='1','★★1枚目の位置は1');
ok(cells(csv).length-1===2,'★★★2枚目は Handle だけの行で足す');
ok(cell(csv,2,'Handle')==='os-4902370550467'&&cell(csv,2,'Image Src')==='https://img.example.jp/b.jpg'
   &&cell(csv,2,'Image Position')==='2','★★2枚目の行の中身');
ok(cell(csv,2,'Title')===''&&cell(csv,2,'Variant Price')==='',
   '★★画像だけの行はほかの欄を空にする');
ok(!A.picOk('https://m.media-amazon.com/images/I/1.jpg'),
   '★★★Amazon の画像は使わない');
ok(!A.picOk('https://images-na.ssl-images-amazon.com/images/I/2.jpg'),
   '★★★Amazon の画像置き場（別のアドレス）も使わない');
ok(A.picsOf({pics:[{url:'https://m.media-amazon.com/images/I/1.jpg'},
                   {url:'https://img.example.jp/a.jpg'}]}).length===1,
   '★★★Amazon の画像だけ落として MW の画像は残す');
ok(A.picsOf({pics:[{url:'https://img.example.jp/a.jpg'},
                   {url:'https://img.example.jp/a.jpg'}]}).length===1,
   '★同じ画像は1枚にする');

console.log('=== 外す行（まとめに出す理由）===');
const bad=[{...IT,jan:''},{...IT,titleEn:''},{...IT,qty:0},
           {...IT,pics:[{url:'https://m.media-amazon.com/images/I/1.jpg'}]},
           {...IT,descHtml:''},{...IT,member:true}];
const sp=A.split([IT,...bad],OPT);
ok(sp.go.length===1&&sp.no.length===6,'★★★出す1件・外す6件に分ける');
ok(A.whyNot({...IT,jan:''},OPT)==='JAN がありません','★理由：JAN');
ok(A.whyNot({...IT,titleEn:''},OPT)==='英題がありません','★★理由：英題');
ok(A.whyNot({...IT,qty:0},OPT)==='数量が0です','★理由：数量0');
ok(A.whyNot({...IT,pics:[]},OPT)==='MW の画像がありません','★★理由：画像なし');
ok(A.whyNot({...IT,usd:0},OPT).indexOf('値段')>=0,'★理由：値段');
ok(A.whyNot(IT,OPT)==='','★出せる行は理由なし');

console.log('=== 会員用と取り違えない（【4】）===');
ok(A.whyNot({...IT,member:true},OPT)==='会員向けの行です',
   '★★★会員向けの印が付いた行は海外向けに出さない');
ok(A.whyNot({...IT,handle:'sub-4902370550467'},OPT)==='会員向けの行です',
   '★★★sub- の商品は海外向けCSVに混ざらない');
const osCsv=A.build([IT,{...IT,member:true}],OPT);
ok(osCsv.indexOf('sub-')<0,'★★★海外向けCSVに sub- の Handle が出ない');
ok(osCsv.indexOf('member-list')<0&&osCsv.indexOf('grade-')<0,
   '★★★海外向けCSVに会員の印が出ない');
const subCsv=S.build([{jan:'4902370550467',name:'スーパーマリオパーティ',
  kishu:'NS',price:5300,max_qty:3,size_g:110}],{});
ok(subCsv.indexOf('os-')<0,'★★★会員用CSVに os- の商品が混ざらない');
ok(subCsv.indexOf('W-4902370550467')<0,'★★会員用CSVに eBay の SKU が混ざらない');

console.log('=== 在庫・値段を直す CSV（【3】）===');
const upd=A.updCsv([{...IT,qty:0},{...IT,qty:2,usd:59.99}],OPT);
console.log('   列：'+cells(upd)[0].join(' / '));
ok(cells(upd)[0].indexOf('Body (HTML)')<0&&cells(upd)[0].indexOf('Tags')<0,
   '★★★触らない項目は列ごと出さない（説明・タグを空で上書きしない）');
ok(cell(upd,1,'Variant Inventory Qty')==='0','★★★品切れは在庫0');
ok(cell(upd,1,'Status')==='draft','★★★品切れは下書きに落とす');
ok(cell(upd,2,'Variant Inventory Qty')==='2'&&cell(upd,2,'Status')==='active',
   '★★在庫があれば公開のまま');
ok(cell(upd,2,'Variant Price')==='9598','★★★値段も直す（59.99 × 160）');
ok(cell(upd,1,'Handle')==='os-4902370550467'&&cell(upd,1,'Variant SKU')==='W-4902370550467',
   '★★Handle と SKU で突き合わせる');
ok(A.updRowsOf([{...IT,member:true}],OPT).length===0,
   '★★★会員向けの行は在庫・値段の直しにも混ぜない');

console.log('=== ファイル名（【7】日付・通し番号・件数）===');
ok(A.ebayName(DAY,1,100)==='ebay-mw-20261113-01-100.csv','★★★eBay 用の名前');
ok(A.shopName(DAY,1,100)==='shopify-os-20261113-01-100.csv','★★★Shopify 用の名前');
ok(A.shopName(DAY,12,37)==='shopify-os-20261113-12-37.csv','★★通し番号は2桁');
ok(A.updName(DAY,2,8)==='shopify-os-fix-20261113-02-8.csv','★直しの CSV の名前');

console.log('=== CSV の形 ===');
ok(csv.slice(-1)==='\n'&&csv.indexOf('\r')<0,'★UTF-8・LF で出す');
ok(A.toCsv(['a'],[{a:'x,"y"'}]).indexOf('"x,""y"""')>=0,'★カンマと引用符を escape する');

T.done();
