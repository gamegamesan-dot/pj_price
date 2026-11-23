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
  descHtml:DESC, kishu:'NS', usd:49.99, qty:1, grams:210, cost:4200, wholesale:3500,
  pics:[{url:'https://img.example.jp/a.jpg'},{url:'https://img.example.jp/b.jpg'}] };
/* 8.94 値段は卸値（税込）＋目標利益＋決済手数料（eBay と同じ ¥1,000＋30%・3.6%）。 */
const OPT={ fx:160, pct:100, vendor:'Play Japan', profitBase:1000, profitRate:30, pay:3.6 };
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
/* 8.73（カジの報告）既定は**下書き・非公開**。⚙で「公開」にしたときだけ公開。 */
ok(cell(csv,1,'Published')==='false'&&cell(csv,1,'Status')==='draft',
   '★★★既定は下書き・非公開で出す（8.73）');
{
  const live=A.build([IT],{...OPT,status:'active',date:DAY});
  ok(cell(live,1,'Published')==='true'&&cell(live,1,'Status')==='active',
     '★⚙で「公開」にすると公開で出す');
}
/* 8.85（カジの依頼）行にブランドが無ければ空欄（⚙の名前は入れない）。 */
ok(cell(csv,1,'Vendor')==='','★Vendor は行のブランド（無ければ空欄・⚙の値は使わない）');
ok(cell(csv,1,'Variant Requires Shipping')==='true','★送るものとして出す');

console.log('=== 値段（8.94：卸値（税込）＋目標利益＋決済手数料）===');
/* 卸値 3,500 → 税込 3,850。MW 仕入れ送料 176・梱包材 50（8.95・既定）。
   目標利益 1,000＋3,850×30%＝2,155。(3,850＋176＋50＋2,155)÷(1−0.036)
   ＝6,463.6… → 切り上げ ¥6,464。手数料 233。 */
ok(cell(csv,1,'Variant Price')==='6464','★★★(3,850＋176＋50＋2,155)÷0.964 ＝ ¥6,464（国際送料・eBay の手数料は入れない）');
const z=A.pxOf({wholesale:3500},OPT);
ok(z.cost===3850&&z.ship===176&&z.pack===50&&z.profit===2155&&z.fee===233&&z.price===6464&&z.pay===3.6,
   '★★★内訳：卸値（税込）3,850・MW 仕入れ送料 176・梱包材 50・目標利益 2,155・決済手数料 233');
ok(A.SHIP_DEF===176&&A.PACK_DEF===50,'★★MW 仕入れ送料・梱包材の既定は ¥176・¥50（8.95）');
ok(A.pxOf({wholesale:3500},{...OPT,ship:0,pack:0}).price===6230
   &&A.pxOf({wholesale:3500},{...OPT,ship:300,pack:100}).price===Math.ceil((3850+300+100+2155)/0.964),
   '★★★MW 仕入れ送料・梱包材を⚙で変えられる（0 も入れられる）');
ok(A.pxOf({wholesale:3500},{...OPT,fx:999,pct:300}).price===6464,'★★★為替・v341 の割合は使わない');
ok(A.pxOf({wholesale:3500},{profitBase:1000,profitRate:0,pay:0}).price===5076,'★★目標利益と決済手数料を⚙で変えられる');
ok(A.payOf({})===3.6&&A.PAY_DEF===3.6&&A.payOf({pay:''})===3.6&&A.payOf({pay:0})===0,'★★決済手数料の既定は 3.6%（0 も入れられる）');
ok(A.pxOf({},OPT).price===0&&A.pxOf({wholesale:0},OPT).price===0,'★卸値が無ければ0（出さない行になる）');
/* v341 までの式（比べるためだけ）。 */
ok(A.yenOf(49.99,{fx:160,pct:100})===7998&&A.pctOf({})===100,'★v341 までの式は比べるために残す');

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

console.log('=== 説明（Shopify 用を別に組み立てる・8.73）===');
/* v325 までは eBay の出品文から eBay の文を外して載せていたが、
   eBay 向けの文が残ったり段落が消えたりしたので、別に組み立てる。
   eBay の出品文（descHtml）の中身は**持ち込まない**。 */
const body=cell(csv,1,'Body (HTML)');
ok(!/ebay/i.test(body),'★★★eBay の文字が入らない');
ok(body.indexOf('<!--')<0,'★★eBay 側の差し替えの目印（コメント）が入らない');
ok(body.indexOf('Shipping and payments')<0,'★★★eBay の画面の案内が入らない');
ok(body.indexOf('import duties are prepaid')<0,
   '★★★eBay の関税前払いの文が入らない（Shopify では成り立たない）');
ok(body.indexOf('Delivery options and costs are shown at checkout.')>=0,
   '★★配送の文は Shopify 向け');
ok(body.indexOf('If anything arrives damaged or not as described, contact us first')>=0,
   '★★困ったときの文は Shopify 向け');
ok(body.indexOf(IT.titleEn)>=0,'★★★商品名が入る');
ok(body.indexOf('We ship from Tokyo.')<0&&body.indexOf('Brand new, factory sealed.')<0,
   '★★★eBay の出品文の中身は持ち込まない（別に組み立てる）');
ok(!/shopify/i.test(body),'★★Shopify の名前も書かない');

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
/* 8.73：説明は別に組み立てるので、eBay の出品文が無い行も出せる
   （「英語の説明がありません」で外していたのをやめた）。 */
ok(sp.go.length===2&&sp.no.length===5,'★★★出す2件・外す5件に分ける');
ok(A.whyNot({...IT,jan:''},OPT)==='JAN がありません','★理由：JAN');
ok(A.whyNot({...IT,titleEn:''},OPT)==='英題がありません','★★理由：英題');
ok(A.whyNot({...IT,qty:0},OPT)==='数量が0です','★理由：数量0');
ok(A.whyNot({...IT,pics:[]},OPT)==='MW の画像がありません','★★理由：画像なし');
ok(A.whyNot({...IT,wholesale:0},OPT)==='値段が出せません（MW の卸値がありません）','★理由：値段（卸値が無い）');
ok(A.whyNot({...IT,usd:0},OPT)==='','★★eBay の売値が無くても出せる（値段は卸値から）');
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
/* 8.73：在庫があるときは**⚙の状態**。⚙が下書きのあいだは公開にしない。 */
ok(cell(upd,2,'Variant Inventory Qty')==='2'&&cell(upd,2,'Status')==='draft',
   '★★★在庫があっても、⚙が下書きのあいだは公開にしない（8.73）');
{
  const updA=A.updCsv([{...IT,qty:0},{...IT,qty:2,usd:59.99}],{...OPT,status:'active'});
  ok(cell(updA,1,'Status')==='draft'&&cell(updA,2,'Status')==='active',
     '★★⚙が「公開」なら、在庫があれば公開・品切れは下書き');
}
ok(cell(upd,2,'Variant Price')==='6464','★★★値段も直す（卸値から新しい式で）');
ok(cell(upd,1,'Handle')==='os-4902370550467'&&cell(upd,1,'Variant SKU')==='W-4902370550467',
   '★★Handle と SKU で突き合わせる');
ok(A.updRowsOf([{...IT,member:true}],OPT).length===0,
   '★★★会員向けの行は在庫・値段の直しにも混ぜない');

console.log('=== 8.94 値段だけを直す CSV ===');
{
  const px=A.pxCsv([{jan:'4902370550467',price:6230,title:'Super Mario Party Jamboree Nintendo Switch Japan'},
    {jan:'4902370550474',price:0,title:'X'},{jan:'4902370550467',price:9999,title:'Y'},
    {jan:'4902370550481',price:5000,member:true,title:'Z'},{jan:'4902370550498',price:5000}],OPT);
  console.log('   '+px.split('\n').join(' | '));
  ok(cells(px)[0].join()==='Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Price',
     '★★★列は Handle・Title・Option1・SKU・Variant Price だけ（在庫・状態・説明は上書きしない。Title は必須・8.98）');
  ok(cells(px).length===2&&cell(px,1,'Handle')==='os-4902370550467'&&cell(px,1,'Variant Price')==='6230'
     &&cell(px,1,'Title')==='Super Mario Party Jamboree Nintendo Switch Japan'
     &&cell(px,1,'Variant SKU')==='W-4902370550467','★★値段が出せない行・同じ Handle・会員向け・題名が分からない行は入れない');
  ok(A.fixTitleOf({title:'  Shop  Title '})==='Shop Title'&&A.fixTitleOf({titleEn:'From eBay'})==='From eBay'
     &&A.fixTitleOf({})==='','★★Title はいまの Shopify の題名 → 無ければ英題（8.98）');
  ok(A.UPD_COLS[1]==='Title'&&A.VEND_COLS.join()==='Handle,Title,Vendor','★★★在庫の直し・販売元の直しにも Title（8.98）');
  ok(!/3500|3850|wholesale|いろは/.test(px),'★★★卸値・仕入れ先は入れない');
  ok(A.pxName(DAY,1,5)==='shopify-os-price-20261113-01-5.csv','★ファイル名');
}

console.log('=== ファイル名（【7】日付・通し番号・件数）===');
ok(A.ebayName(DAY,1,100)==='ebay-mw-20261113-01-100.csv','★★★eBay 用の名前');
ok(A.shopName(DAY,1,100)==='shopify-os-20261113-01-100.csv','★★★Shopify 用の名前');
ok(A.shopName(DAY,12,37)==='shopify-os-20261113-12-37.csv','★★通し番号は2桁');
ok(A.updName(DAY,2,8)==='shopify-os-fix-20261113-02-8.csv','★直しの CSV の名前');

console.log('=== CSV の形 ===');
ok(csv.slice(-1)==='\n'&&csv.indexOf('\r')<0,'★UTF-8・LF で出す');
ok(A.toCsv(['a'],[{a:'x,"y"'}]).indexOf('"x,""y"""')>=0,'★カンマと引用符を escape する');

T.done();
