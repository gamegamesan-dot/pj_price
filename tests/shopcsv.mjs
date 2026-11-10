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
ok(cell(t1,1,'URL handle')==='sub-4902370550467','★★★Handle');
ok(cell(t1,1,'Title')==='スーパーマリオパーティ ジャンボリー','★★★Title');
ok(cell(t1,1,'SKU')==='SUB-4902370550467-20261110','★★★SKU');
ok(cell(t1,1,'Barcodes')==='4902370550467','★★★JAN は Barcodes に入れる');
ok(cell(t1,1,'Price')==='5300','★★★販売価格（税込）');
ok(cell(t1,1,'Inventory quantity')==='3','★★★販売数の上限が在庫数になる');
ok(cell(t1,1,'Continue selling when out of stock')==='deny',
   '★★★売り切れで止める（deny）');
ok(cell(t1,1,'Inventory tracker')==='shopify',
   '★★★shopify にしないと在庫が入らない');
ok(cell(t1,1,'Charge tax')==='true'&&cell(t1,1,'Requires shipping')==='true',
   '★★課税する・発送が要る');
ok(cell(t1,1,'Weight value (grams)')==='110'
   &&cell(t1,1,'Weight unit for display')==='g',
   '★★★重さはグラムで入れる（重さの段の送料に効く）');
ok(cell(t1,1,'Option1 name')==='Title'
   &&cell(t1,1,'Option1 value')==='Default Title',
   '★★★Option1 は Title / Default Title');
ok(cell(t1,1,'Published on online store')==='true'
   &&cell(t1,1,'Status')==='active','★★公開・active');
ok(cell(t1,1,'Type')==='ゲームソフト','★★Type は設定から');
ok(cell(t1,1,'Vendor')==='','★★★Vendor は既定で空（保留）');
ok(cell(t1,1,'Gift card')==='false','★ギフトカードではない');
ok(cell(t1,1,'SEO title')==='スーパーマリオパーティ ジャンボリー','★SEO title');
ok(A.build([IT],{ option1:{ name:'Title2', value:'X' } }).indexOf('Title2')>0,
   '★★Option1 の値は設定で変えられる（ストアの実際に合わせる）');

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
ok(A.INV_COLS.indexOf('Location')>=0&&A.INV_COLS.indexOf('Option1 Value')>=0,
   '★★★Location と Option1 Value が必須なので入れる');
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
T.done();
