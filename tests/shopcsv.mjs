/* shared/shopcsv.js：Shopify の商品CSV（7.130／6.170・【U の改】の2・3）
   列の名前は Shopify の公式（2026-11-10 に確認）の**今の名前**。
   ・Handle は sub-<JAN>（出し直しは同じ Handle で上書き）
   ・SKU は SUB-<JAN>-<YYYYMMDD>（MW の商品番号は使わない）
   ・画像は入れない／卸値・社・MW在庫・備考・MW の商品番号は出さない
   ・Option1 name と Option1 value を必ず入れる（入れないとバリアントが消える）
   ・英語は「Shopify から出した翻訳CSV」に英題を書き込む形 */
import { harness } from './lib.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const A=require('../shared/shopcsv.js');
const T=harness('shared/shopcsv.js：Shopify の商品CSV（7.130／6.170）');
const ok=T.ok;

const IT={ jan:'4902370550467',
  name:'【新品】スーパーマリオパーティ ジャンボリー ★ ※早期購入特典は付きません',
  asin:'B0D1GSZJ8T', kishu:'Switch', price:5300, max_qty:3,
  size_g:110, size_tier:'s' };
const DAY=new Date('2026-11-10T09:00:00+09:00');
const cells=(text)=>A.splitCsv(text);
const cell=(text,r,name)=>{
  const rows=cells(text);
  const i=rows[0].indexOf(name);
  return i<0?undefined:rows[r][i];
};

console.log('=== 列の名前（Shopify の今の名前）===');
console.log('   '+A.COLS.join(' / '));
ok(A.COLS[0]==='URL handle','★★★旧 Handle ではなく URL handle');
ok(A.COLS.indexOf('Description')>=0&&A.COLS.indexOf('Body (HTML)')<0,
   '★★★旧 Body (HTML) ではなく Description');
ok(A.COLS.indexOf('Price')>=0&&A.COLS.indexOf('Variant Price')<0,
   '★★★旧 Variant Price ではなく Price');
ok(A.COLS.indexOf('SKU')>=0&&A.COLS.indexOf('Variant SKU')<0,
   '★★★旧 Variant SKU ではなく SKU');
ok(A.COLS.indexOf('Weight value (grams)')>=0
   &&A.COLS.indexOf('Variant Grams')<0,
   '★★★旧 Variant Grams ではなく Weight value (grams)');
ok(A.COLS.indexOf('Charge tax')>=0&&A.COLS.indexOf('Variant Taxable')<0,
   '★★旧 Variant Taxable ではなく Charge tax');
ok(A.COLS.indexOf('Continue selling when out of stock')>=0,
   '★★★在庫切れの扱いは Continue selling when out of stock');
ok(A.COLS.indexOf('Published on online store')>=0
   &&A.COLS.indexOf('Status')>=0,
   '★★★公開は Published on online store と Status の2本');
ok(A.COLS.indexOf('Option1 name')>=0&&A.COLS.indexOf('Option1 value')>=0,
   '★★★Option1 name と value を必ず出す（入れないとバリアントが消える）');
ok(A.COLS.indexOf('Barcodes')>=0&&A.COLS.indexOf('Barcode')<0,
   '★★★旧 Barcode（単数）とは併用できないので Barcodes だけ');
ok(A.COLS.indexOf('Image Src')<0&&A.COLS.indexOf('Product image URL')<0,
   '★★★画像の列は出さない（MW・Amazon の画像は使わない）');

console.log('\n=== 列名の形（6.176）ストアの書き出しに合わせる ===');
/* omakase-ship のエクスポートが返した列名（カジが確認・2026-11-11）。
   上書きのときに列名が違うとずれるので、**既定はこの形**。 */
const EXPORTED=['Handle','Title','Body (HTML)','Vendor','Product Category','Type',
  'Tags','Published','Option1 Name','Option1 Value','Option1 Linked To',
  'Variant SKU','Variant Grams','Variant Inventory Tracker',
  'Variant Inventory Qty','Variant Inventory Policy',
  'Variant Fulfillment Service','Variant Price','Variant Compare At Price',
  'Variant Requires Shipping','Variant Taxable',
  'Variant Barcodes','Image Src','Image Position','Image Alt Text','Gift Card',
  'SEO Title','SEO Description','Variant Image','Variant Weight Unit',
  'Variant Tax Code','Cost per item','Status',
  'Variant Packed Length','Variant Packed Width','Variant Packed Height',
  'Variant Packed Dimension Unit'];
{
  const head=cells(A.build([IT],{}))[0];
  console.log('   '+head.join(','));
  ok(head[0]==='Handle','★★★既定は古い形（Handle）');
  ok(head.indexOf('Body (HTML)')>=0&&head.indexOf('Description')<0,
     '★★★Body (HTML) で出す');
  ok(head.indexOf('Variant Price')>=0&&head.indexOf('Price')<0,
     '★★★Variant Price で出す');
  ok(head.indexOf('Variant SKU')>=0&&head.indexOf('Variant Grams')>=0,
     '★★★Variant SKU・Variant Grams で出す');
  ok(head.indexOf('Variant Inventory Policy')>=0
     &&head.indexOf('Continue selling when out of stock')<0,
     '★★★在庫切れの扱いは Variant Inventory Policy');
  ok(head.indexOf('Published')>=0
     &&head.indexOf('Published on online store')<0,'★★★Published で出す');
  ok(head.indexOf('Variant Barcodes')>=0&&head.indexOf('Barcodes')<0,
     '★★★JAN は Variant Barcodes（ストアの書き出しと同じ）');
  ok(head.indexOf('Variant Taxable')>=0&&head.indexOf('Variant Weight Unit')>=0
     &&head.indexOf('Variant Requires Shipping')>=0
     &&head.indexOf('Variant Fulfillment Service')>=0,
     '★★Variant 系の名前でそろえる');
  /* 出す列がぜんぶストアの書き出しに入っていること（Collection は
     読み込みのときだけの列なので、書き出しには入らない・公式）。 */
  const miss=head.filter((c)=>EXPORTED.indexOf(c)<0);
  console.log('   書き出しに無い列: '+JSON.stringify(miss));
  ok(miss.length===0,
     '★★★出す列はぜんぶストアの書き出しにある（上書きでずれない）');
}
{
  const head=cells(A.build([IT],{ style:'new' }))[0];
  ok(head[0]==='URL handle'&&head.indexOf('Description')>=0
     &&head.indexOf('Price')>=0,'★★★style:new で今の名前にできる');
  ok(A.colName('SKU','new')==='SKU'&&A.colName('SKU','old')==='Variant SKU'
     &&A.colName('SKU')==='Variant SKU','★★colName（既定は古い形）');
  ok(A.colName('Title','old')==='Title'&&A.colName('Status','old')==='Status'
     &&A.colName('Vendor','old')==='Vendor'&&A.colName('Tags','old')==='Tags',
     '★★どちらでも同じ名前の列はそのまま');
  ok(A.colName('Collection','old')==='Collection',
     '★Collection はどちらでも同じ');
}
{
  /* 中身は形を変えても同じ（列名だけが変わる）。 */
  const a=cells(A.build([IT],{}));
  const b=cells(A.build([IT],{ style:'new' }));
  ok(JSON.stringify(a[1])===JSON.stringify(b[1]),
     '★★★中身は同じで、列名だけが変わる');
  ok(a[0].length===b[0].length,'★列の数も同じ');
}
{
  const iv=cells(A.invCsv([IT],{ location:'本社' }));
  ok(iv[0][0]==='Handle'&&iv[0].indexOf('Option 1 Value')>=0,
     '★★在庫CSV は公式の形（Option 1 Value・空きあり）のまま');
}

console.log('\n=== Handle と SKU ===');
ok(A.handleOf('4902370550467')==='sub-4902370550467',
   '★★★Handle は sub-<JAN>');
ok(A.handleOf('4902370550467')===A.handleOf('４９０２３７０５５０４６７')
   ||A.handleOf(' 4902370550467 ')==='sub-4902370550467',
   '★数字以外は落とす');
ok(A.skuOf('4902370550467',DAY)==='SUB-4902370550467-20261110',
   '★★★SKU は SUB-<JAN>-<YYYYMMDD>');
ok(!/M\d|商品番号/.test(A.skuOf('4902370550467',DAY)),
   '★★★MW の商品番号は使わない');

console.log('\n=== 商品名（MW の癖と備考の文を外す）===');
console.log('   '+A.titleOf(IT.name));
ok(A.titleOf(IT.name)==='スーパーマリオパーティ ジャンボリー',
   '★★★【新品】・★・※の但し書きを外す');
ok(A.titleOf('【即納】ゼルダの伝説　知恵のかりもの (新品)')
   ==='ゼルダの伝説 知恵のかりもの','★★全角の空白と（新品）も外す');
ok(A.titleOf('あ'.repeat(300)).length===180,'★長すぎる名前は切る');
ok(A.titleOf('あ'.repeat(300),70).length===70,'★SEO 用は70字で切る');

console.log('\n=== 説明（JAN・機種・Amazon のリンク・返金の文）===');
const body=A.bodyOf(IT,{});
console.log('   '+body);
ok(/JAN：4902370550467/.test(body),'★★★JAN を出す');
ok(/機種：Switch/.test(body),'★★機種を出す');
ok(/amazon\.co\.jp\/dp\/B0D1GSZJ8T/.test(body),
   '★★★Amazon の商品ページへのリンク');
ok(/販売数に上限があります/.test(body)&&/全額返金/.test(body),
   '★★★上限と返金の文を入れる');
ok(!/卸値|いろは|在庫|備考/.test(body),'★★★会員に見せない項目は入れない');
ok(/amazon\.co\.jp\/s\?k=/.test(A.bodyOf({ jan:'4902370550467' },{})),
   '★ASIN が無ければ JAN の検索にする');

console.log('\n=== タグ ===');
let tg=A.tagsOf(IT,{});
console.log('   '+tg.join(' / '));
ok(tg.indexOf('member-list')===0,'★★★member-list を必ず付ける');
ok(tg.indexOf('ship-small')>=0,'★★★送料の区分（ship-small）を付ける');
ok(tg.filter((x)=>/^grade-/.test(x)).length===4,
   '★★★プランの指定が無ければ全プランに見せる');
tg=A.tagsOf(Object.assign({},IT,{ grades:'premium,monitor' }),{});
ok(tg.indexOf('grade-premium')>=0&&tg.indexOf('grade-monitor')>=0
   &&tg.indexOf('grade-light')<0,'★★★選んだプランだけ grade-* を付ける');
ok(A.tagsOf(IT,{ tags:['秋の特集'] }).indexOf('秋の特集')>=0,
   '★★足したいタグも入れられる');

console.log('\n=== 送料の区分（クリックポストに入るか）===');
ok(A.shipTag({ size_long:19, size_wid:13.5, size_hei:1.5, size_g:110 })
   ==='ship-small','★★★ゲームソフト1本はクリックポストに入る');
ok(A.shipTag({ size_long:19, size_wid:13.5, size_hei:4, size_g:110 })
   ==='ship-box','★★★厚さ3cm を超えたら入らない');
ok(A.shipTag({ size_long:40, size_wid:30, size_hei:2, size_g:500 })
   ==='ship-box','★★長辺34cm を超えたら入らない');
ok(A.shipTag({ size_long:19, size_wid:13.5, size_hei:1.5, size_g:1500 })
   ==='ship-box','★★1kg を超えたら入らない');
ok(A.shipTag({ size_tier:'s' })==='ship-small'
   &&A.shipTag({ size_tier:'m' })==='ship-box',
   '★★★採寸が無ければ Amazon のサイズ区分で代わりに見る');
ok(A.shipTag({ size_g:200 })==='ship-small'&&A.shipTag({ size_g:900 })==='ship-box',
   '★★区分も無ければ重さで見る');
ok(A.CP.hei===3&&A.CP.g===1000,'★クリックポストの決まり（厚さ3cm・1kg）');

console.log('\n=== 1行ぶんの中身 ===');
const t1=A.build([IT],{ type:'ゲームソフト', date:DAY });
console.log('   '+cells(t1)[1].slice(0,8).join(' | '));
ok(cell(t1,1,'Handle')==='sub-4902370550467','★★★Handle');
ok(cell(t1,1,'Title')==='スーパーマリオパーティ ジャンボリー','★★★Title');
ok(cell(t1,1,'Variant SKU')==='SUB-4902370550467-20261110','★★★SKU');
ok(cell(t1,1,'Variant Barcodes')==='4902370550467',
   '★★★JAN は Variant Barcodes に入れる');
ok(cell(t1,1,'Variant Price')==='5300','★★★販売価格（税込）');
ok(cell(t1,1,'Variant Inventory Qty')==='3','★★★販売数の上限が在庫数になる');
ok(cell(t1,1,'Variant Inventory Policy')==='deny',
   '★★★売り切れで止める（deny）');
ok(cell(t1,1,'Variant Inventory Tracker')==='shopify',
   '★★★shopify にしないと在庫が入らない');
ok(cell(t1,1,'Variant Taxable')==='true'
   &&cell(t1,1,'Variant Requires Shipping')==='true',
   '★★課税する・発送が要る');
ok(cell(t1,1,'Variant Grams')==='110'
   &&cell(t1,1,'Variant Weight Unit')==='g',
   '★★★重さはグラムで入れる（重さの段の送料に効く）');
ok(cell(t1,1,'Option1 Name')==='Title'
   &&cell(t1,1,'Option1 Value')==='Default Title',
   '★★★Option1 は Title / Default Title');
ok(cell(t1,1,'Published')==='true'
   &&cell(t1,1,'Status')==='active','★★公開・active');
ok(cell(t1,1,'Type')==='ゲームソフト','★★Type は設定から');
ok(cell(t1,1,'Vendor')==='','★★★Vendor は既定で空（保留）');
ok(cell(t1,1,'Gift Card')==='false','★ギフトカードではない');
ok(cell(t1,1,'SEO Title')==='スーパーマリオパーティ ジャンボリー','★SEO Title');
ok(A.build([IT],{ option1:{ name:'Title2', value:'X' } }).indexOf('Title2')>0,
   '★★Option1 の値は設定で変えられる（ストアの実際に合わせる）');

console.log('\n=== 重さ（6.173）Amazon の梱包重量＋⚙の足し分 ===');
ok(A.weightOf({ size_g:110 },{})===110,
   '★★★既定（足し分0g）は Amazon の梱包重量そのまま');
ok(A.weightOf({ size_g:110 },{ addG:40 })===150,
   '★★★⚙「Shopify に出す重さの足し分」を足す');
ok(A.weightOf({ size_g:0 },{ addG:40 })===0,
   '★★★重さが取れていない行は 0 のまま（足し分だけの嘘の重さにしない）');
ok(A.weightOf({},{})===0,'★何も無ければ 0');
ok(A.weightOf({ size_g:110 },{ addG:-50 })===110,
   '★負の足し分は無視する');
ok(cell(A.build([IT],{ addG:40 }),1,'Variant Grams')==='150',
   '★★★CSV にも足した値が出る');
ok(cell(t1,1,'Variant Grams')==='110',
   '★★足し分を入れなければ今までどおり');
/* eBay の梱包マージン（ゲーム60g／フィギュア250g）はここには足さない。
   あれは eBay の送料計算用で、0 にはできない欄なので混ぜない。 */
ok(A.weightOf({ size_g:110, csvPackGame:60 },{})===110,
   '★★★eBay の梱包マージンは足さない（別の欄）');

console.log('\n=== Collection（読み込みのときだけ足せる唯一の列）===');
ok(A.COLS.indexOf('Collection')>=0,'★列として持っている');
ok(cells(t1)[0].indexOf('Collection')<0,
   '★★★使わないときは列ごと外す（空で上書きしないため）');
const t2=A.build([IT],{ collection:'会員リスト' });
ok(cell(t2,1,'Collection')==='会員リスト','★★★入れたら出る');

console.log('\n=== 出さない行 ===');
ok(A.rowsOf([{ jan:'123', price:100, max_qty:1 }]).length===0,
   '★★JAN の形でない行は出さない');
ok(A.rowsOf([{ jan:'4902370550467', price:0, max_qty:1 }]).length===0,
   '★★★販売価格が無い行は出さない');
ok(A.rowsOf([{ jan:'4902370550467', price:100, max_qty:0 }]).length===0,
   '★★★販売数の上限が0の行は出さない');
ok(A.rowsOf([IT,IT]).length===2,'★ちゃんと出る行は出る');

console.log('\n=== CSV の形 ===');
ok(/\n$/.test(t1)&&!/\r/.test(t1),'★★★UTF-8・LF で終わる（公式どおり）');
ok(t1.charCodeAt(0)!==0xFEFF,'★★BOM は付けない');
const t3=A.build([Object.assign({},IT,{ name:'"引用符" と, カンマ' })],{});
ok(cell(t3,1,'Title')==='"引用符" と, カンマ',
   '★★★引用符とカンマを正しく囲む（読み直せる）');
ok(cells(t1).length===2,'★見出し1行＋中身1行');

console.log('\n=== 在庫CSV（ロケーションが2つ以上の店）===');
const iv=A.invCsv([IT],{ location:'本社', first:true, date:DAY });
console.log('   '+cells(iv)[1].join(' | '));
ok(cells(iv)[0][0]==='Handle','★★★必須の Handle が先頭');
ok(A.INV_COLS.indexOf('Location')>=0&&A.INV_COLS.indexOf('Option 1 Value')>=0,
   '★★★Location と Option 1 Value が必須なので入れる');
ok(A.INV_COLS.indexOf('Option1 Value')<0,
   '★★★在庫CSV は「Option 1 Value」（数字の前後に空き）。商品CSV と違う');
ok(cell(iv,1,'Location')==='本社','★★ロケーション名が入る');
ok(cell(iv,1,'On hand (new)')==='3','★★★新しい在庫数が入る');
ok(cell(iv,1,'On hand (current)')==='Not stocked',
   '★★★初めて置くときは Not stocked（公式の例どおり）');
ok(A.invCsv([IT],{ location:'本社', date:DAY }).indexOf('Not stocked')<0,
   '★★2回目は空（うっかり上書きを防ぐ検査を効かせる）');

console.log('\n=== 英語（Shopify から出した翻訳CSVに英題を書き込む）===');
/* Shopify のエクスポートの形（Identification は内部ID で JAN は無い）。 */
const TR='Type,Identification,Field,Locale,Market,Status,'
  +'Default content,Translated content\n'
  +'Product,gid://shopify/Product/111,title,en,,,'
  +'スーパーマリオパーティ ジャンボリー,\n'
  +'Product,gid://shopify/Product/111,body_html,en,,,'
  +'<p>説明</p>,\n'
  +'Product,gid://shopify/Product/222,title,en,,,ゼルダの伝説 知恵のかりもの,\n';
let f=A.transFill(TR,{ 'スーパーマリオパーティ ジャンボリー':
  'Super Mario Party Jamboree (Switch)' });
console.log('   入れた '+f.n+'件／残り '+f.miss.length+'件');
ok(f.cols===true,'★★★Default content と Translated content の列を見つける');
ok(f.n===1,'★★★名前が合う行（title）だけ埋める');
ok(cell(f.text,1,'Translated content')==='Super Mario Party Jamboree (Switch)',
   '★★★訳文の列に入る');
ok(cell(f.text,1,'Default content')==='スーパーマリオパーティ ジャンボリー',
   '★★ほかの列は触らない');
ok(cell(f.text,2,'Translated content')==='',
   '★★★title 以外の行（body_html）は触らない');
ok(f.miss.length===0,'★使えた名前は残りに出さない');
f=A.transFill(TR,{ 'そんな名前の商品':'Nope' });
ok(f.n===0&&f.miss[0]==='そんな名前の商品',
   '★★★合わなかった名前を「残り」で返す（画面に出す）');
f=A.transFill(TR,{ '【新品】スーパーマリオパーティ ジャンボリー ★':'En' });
ok(f.n===1,'★★★MW の癖を外した名前でも突き合わせる');
f=A.transFill('Type,Identification\nProduct,1\n',{ a:'b' });
ok(f.cols===false&&f.n===0,
   '★★★列が無い CSV は何もしない（違うファイルを選んだとき）');
f=A.transFill(TR,{ 'ゼルダの伝説 知恵のかりもの':'The Legend of Zelda' },
  { fields:['title','body_html'] });
ok(f.n===1,'★★入れる項目は選べる');
ok(A.transFill('',{}).n===0,'★空でも落ちない');

console.log('\n=== ゲームソフトは一律の重さ（6.183／【2】）===');
{
  /* Shopify の送料は本数ではなく**合計の重さ**で段が変わるので、
     1本ごとにばらつく Amazon の梱包重量だと本数と段が合わない。 */
  ok(A.isGame({ kishu:'NS' })===true&&A.isGame({ kishu:'NS2' })===true,
     '★★★機種がゲームの行を見分ける');
  ok(A.isGame({ kishu:'FIG' })===false&&A.isGame({ kishu:'' })===false,
     '★★ゲーム以外は当てはまらない');
  ok(A.weightOf({ kishu:'NS', size_g:118 },{ gameG:100 })===100,
     '★★★ゲームソフトは⚙の一律の重さ（118g でも 100g）');
  ok(A.weightOf({ kishu:'NS', size_g:118 },{ gameG:100, addG:50 })===100,
     '★★★ゲームソフトには足し分も足さない');
  ok(A.weightOf({ kishu:'FIG', size_g:400 },{ gameG:100, addG:50 })===450,
     '★★★ゲーム以外は今までどおり（梱包重量＋足し分）');
  ok(A.weightOf({ kishu:'NS', size_g:118 },{ gameG:0, addG:0 })===118,
     '★★★⚙を 0 にすると今までどおり');
  ok(A.weightOf({ kishu:'NS', size_g:0 },{ gameG:100 })===100,
     '★★重さが取れていないゲームソフトも 100g で出せる');
  ok(A.weightOf({ kishu:'FIG', size_g:0 },{ gameG:100 })===0,
     '★ゲーム以外で重さが無ければ 0（画面が注意を出す）');
  const t=A.build([Object.assign({},IT,{ kishu:'NS', size_g:118 })],
    { date:DAY, gameG:100 });
  ok(cell(t,1,'Variant Grams')==='100','★★★CSV にも一律の重さで入る');
  /* 1〜2本 ¥200（0〜250g）・3本 ¥300（251〜350g）・4本〜 ¥600（351g〜）。 */
  ok(100*2<=250&&100*3>250&&100*3<=350&&100*4>350,
     '★★★100g なら 1〜2本／3本／4本以上 が送料の段と合う');
}

console.log('\n=== 仕入原価（Cost per item・6.178／【2】）===');
{
  ok(A.COLS.indexOf('Cost per item')>=0,'★★★Cost per item の列を出す');
  ok(A.colName('Cost per item','old')==='Cost per item'
     &&A.colName('Cost per item','new')==='Cost per item',
     '★★★古い形でも今の名前でも同じ列名（ストアの書き出しに合わせられる）');
  const t=A.build([Object.assign({},IT,{ cost:3476 })],{ date:DAY });
  ok(cell(t,1,'Cost per item')==='3476','★★★仕入原価が入る（卸値×1.1＋MW送料）');
  /* 仕入原価が分からない行は空にする（0 を入れて上書きしない）。 */
  const t2=A.build([IT],{ date:DAY });
  ok(cell(t2,1,'Cost per item')==='','★★★取れていない行は空（0 で上書きしない）');
  /* 客に見える列ではないが、卸値そのものは入れない。 */
  ok(!/wholesale/i.test(t),'★★★卸値そのものは入れない');
}
T.done();
