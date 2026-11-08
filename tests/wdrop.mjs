/* Worker：MW 無在庫（W-<JAN>）の出品を販売連携に取り込む（7.113）
   【至急】2026-11-08：W-4562475323733（カラ松・ItemID 960161917613）が
   販売連携に入らず、「解析不可の出品 69件」と出ていた。
   ・CustomLabel W-<JAN> を読めるようにする（JAN から作る見かけの ASIN「W＋JAN」）
   ・無在庫（dropship=1）として取り込み、段取り D と売れたときの知らせの対象にする
   ・Amazon に問い合わせる処理は、この見かけの ASIN を外す
   ・読めなかった CustomLabel の**形ごとの件数と例**を /status で返す
   ・ItemID を1件だけ手で結び付ける（POST /ebay/link）
   ・出品済みの W- の行の仕入れ基準（MW／Amazon）と重さを /status で返す */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：MW 無在庫（W-<JAN>）の取り込み（7.113）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('wdrop');
const env=makeEnv();
const now=new Date().toISOString();
const JAN='4562475323733';
const ITEM='960161917613';

/* eBay への通信を差し替える。
   active … GetMyeBaySelling が返す ActiveList の中身
   one    … GetItem（1件）が返す中身（手で結び付けるときに使う） */
let active=[], one={ sku:'W-'+JAN, title:'カラ松', qty:1, price:'37.00',
                     status:'Active' }, oneFail='';
const itemXml=(x)=>'<Item><ItemID>'+x.id+'</ItemID>'
  +(x.sku===null?'':('<SKU>'+x.sku+'</SKU>'))
  +'<Title>'+(x.title||(x.sku+'の商品'))+'</Title><Quantity>1</Quantity>'
  +'<SellingStatus><QuantitySold>0</QuantitySold>'
  +'<CurrentPrice currencyID="USD">'+(x.price||'20.00')+'</CurrentPrice>'
  +'</SellingStatus>'
  +'<ListingDetails><StartTime>'+now+'</StartTime></ListingDetails>'
  +'<QuantityAvailable>1</QuantityAvailable></Item>';
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/ws\/api\.dll/.test(url)){
    const name=(o.headers||{})['X-EBAY-API-CALL-NAME']||'';
    if(name==='GetMyeBaySelling')
      return new Response('<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>'
        +'<PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>'
        +'</PaginationResult><ItemArray>'
        +active.map(itemXml).join('')+'</ItemArray></ActiveList>'
        +'</GetMyeBaySellingResponse>',
        {status:200,headers:{'content-type':'text/xml'}});
    if(name==='GetItem'){
      if(oneFail)
        return new Response('<GetItemResponse><Ack>Failure</Ack><Errors>'
          +'<ErrorCode>17</ErrorCode><ShortMessage>'+oneFail+'</ShortMessage>'
          +'</Errors></GetItemResponse>',
          {status:200,headers:{'content-type':'text/xml'}});
      return new Response('<GetItemResponse><Ack>Success</Ack><Item>'
        +'<ItemID>'+ITEM+'</ItemID>'
        +(one.sku?('<SKU>'+one.sku+'</SKU>'):'')
        +'<Title>'+one.title+'</Title>'
        +'<Quantity>'+one.qty+'</Quantity>'
        +'<SellingStatus><QuantitySold>0</QuantitySold>'
        +'<CurrentPrice currencyID="USD">'+one.price+'</CurrentPrice>'
        +'<ListingStatus>'+one.status+'</ListingStatus>'
        +'</SellingStatus></Item></GetItemResponse>',
        {status:200,headers:{'content-type':'text/xml'}});
    }
    return new Response('<x><Ack>Success</Ack></x>',
      {status:200,headers:{'content-type':'text/xml'}});
  }
  if(/discord/.test(url))return new Response('',{status:204});
  throw new Error('想定外の通信: '+url);
};

console.log('=== CustomLabel W-<JAN> を読む ===');
let k=W.parseLabel('W-'+JAN);
console.log('   '+JSON.stringify(k));
ok(k.ok===true,'★★★W-<JAN> を読めるようにする（これまでは解析不可だった）');
ok(k.asin==='W'+JAN,'★★JAN から作る見かけの ASIN「W＋JAN」をキーにする');
ok(k.cond==='new','★新品として扱う');
ok(k.scope==='ebay','★eBay の出品として扱う');
ok(k.dropship===true,'★★★無在庫（dropship=1）として取り込む');
ok(k.mwJan===JAN,'★元の JAN も返す');
ok(W.mwAsinOfJan(JAN)==='W'+JAN&&W.mwJanOfAsin('W'+JAN)===JAN,
   '★見かけの ASIN と JAN は行き帰りできる');
ok(W.parseLabel('W-456247532373').ok!==true,'★13桁でない W- は読まない');
ok(W.parseLabel('E-B00ABCDEFG').ok===true,'★これまでの E- もそのまま読める');

console.log('\n=== 見かけの ASIN は Amazon に問い合わせない ===');
ok(W.isAsin('B00ABCDEFG')===true&&W.isAsin('W'+JAN)===false,
   '★★本物の ASIN（B＋9文字）だけを「Amazon に問い合わせてよい」とする');
const reqs=W.lowestReqs([{asin:'W'+JAN,cond:'new'},{asin:'B00ABCDEFG',cond:'new'}]);
ok(reqs.length===1&&/B00ABCDEFG/.test(JSON.stringify(reqs)),
   '★★★最安値の問い合わせから見かけの ASIN を外す（Amazon に無いので）');

console.log('\n=== 出品中リストの取り込みで W- が行になる ===');
active=[{id:ITEM,sku:'W-'+JAN,title:'カラ松 ぬいぐるみ',price:'37.00'}];
await W.syncEbayActive(env,W.newRun('ebay'));
let r=await env.DB.prepare(
  `SELECT asin,cond,scope,title,ebay_item_id,ebay_sku,ebay_qty,ebay_price,dropship
     FROM items WHERE asin=?1`).bind('W'+JAN).first();
console.log('   '+JSON.stringify(r));
ok(!!r,'★★★W- の出品が items の行になる（検索で0件だった原因）');
ok(String(r.ebay_item_id)===ITEM,'★★ItemID が入る');
ok(String(r.ebay_sku)==='W-'+JAN,'★CustomLabel をそのまま残す');
ok(Number(r.ebay_qty)===1&&Number(r.ebay_price)===37,'★数量・売値が入る');
ok(Number(r.dropship)===1,'★★★無在庫の印が立つ（段取り D と知らせの対象）');

console.log('\n=== 読めなかった CustomLabel の内訳を出す ===');
active=[{id:ITEM,sku:'W-'+JAN,title:'カラ松'},
        {id:'880000000001',sku:null,title:'ラベルなし'},
        {id:'880000000002',sku:'W-12345',title:'桁が足りない'},
        {id:'880000000003',sku:'E-ABC',title:'ASINの形でない'},
        {id:'880000000004',sku:'mwgame-20261101-1-B00ABCDEFG-1000',title:'Amazon用'},
        {id:'880000000005',sku:'4902370550467',title:'JANだけ'},
        {id:'880000000006',sku:'なにか',title:'その他'}];
await W.syncEbayActive(env,W.newRun('ebay'));
const u=await W.unparsedInfo(env);
console.log('   '+JSON.stringify(u));
ok(u.n===6,'★★読めなかった件数を数える');
ok(u.kinds['CustomLabel が空']===1,'★空のラベルを分ける');
ok(u.kinds['W-（MW 無在庫）だが JAN が13桁でない']===1,
   '★★★W- のうち読めなかったものを分ける（「W- がいくつか」が分かる）');
ok(u.kinds['E-／M- だが ASIN の形でない']===1,'★E-・M- の崩れを分ける');
ok(u.kinds['Amazon 用の SKU（mwgame／mwhobby）']===1,'★Amazon 用の SKU を分ける');
ok(u.kinds['JAN だけ（13桁の数字）']===1,'★JAN だけの出品を分ける');
ok(u.kinds['その他']===1,'★残りは「その他」');
ok((u.samples||[]).length===6&&u.samples.some((x)=>x.item_id==='880000000002'),
   '★★例（CustomLabel・ItemID・題）も返す');
ok(!!u.at_jst,'★いつの取り込みかを返す');
const st0=(await asJson(await worker.fetch(get('/status'),env))).body;
ok(st0.ebay_unparsed&&st0.ebay_unparsed.n===6,
   '★★/status で内訳を返す（画面に出す）');

console.log('\n=== 1件だけ手で結び付ける（POST /ebay/link）===');
await env.DB.prepare('DELETE FROM items').bind().run();
let d=(await asJson(await worker.fetch(
  post('/ebay/link',{item_id:ITEM}),env))).body;
console.log('   '+JSON.stringify({ok:d.ok,asin:d.asin,qty:d.qty,price:d.price}));
ok(d.ok===true,'★★★ItemID だけで結び付けられる');
ok(d.asin==='W'+JAN&&d.cond==='new','★CustomLabel から行を決める');
ok(d.jan===JAN&&Number(d.dropship)===1,'★★無在庫として入る');
ok(Number(d.qty)===1&&Number(d.price)===37,'★いまの数量・売値も入れる');
r=await env.DB.prepare(
  `SELECT ebay_item_id,ebay_sku,dropship FROM items WHERE asin=?1`)
  .bind('W'+JAN).first();
ok(String(r.ebay_item_id)===ITEM,'★★行に ItemID が入る');

console.log('\n=== 手で結び付けるときの歯止め ===');
d=(await asJson(await worker.fetch(post('/ebay/link',{item_id:'abc'}),env))).body;
ok(d.ok===false&&/ItemID/.test(d.why),'★ItemID の形が違えば断る');
d=(await asJson(await worker.fetch(
  post('/ebay/link',{item_id:ITEM,label:'W-4902370550467'}),env))).body;
console.log('   '+JSON.stringify(d.why));
ok(d.ok===false&&/CustomLabel/.test(d.why),
   '★★★eBay の CustomLabel と違う指定は断る（別の出品に結び付けない）');
/* 同じ ItemID をもう一度 → そのまま通る（入れ替えではない）。 */
d=(await asJson(await worker.fetch(post('/ebay/link',{item_id:ITEM}),env))).body;
ok(d.ok===true,'★同じ ItemID のやり直しは通る');
/* 別の ItemID を同じ行に入れようとしたら、force なしでは断る。 */
one={ sku:'W-'+JAN, title:'カラ松', qty:1, price:'40.00', status:'Active' };
await env.DB.prepare(`UPDATE items SET ebay_item_id='111111111' WHERE asin=?1`)
  .bind('W'+JAN).run();
d=(await asJson(await worker.fetch(post('/ebay/link',{item_id:ITEM}),env))).body;
ok(d.ok===false&&d.had==='111111111','★★別の ItemID が入っている行は黙って上書きしない');
d=(await asJson(await worker.fetch(
  post('/ebay/link',{item_id:ITEM,force:true}),env))).body;
ok(d.ok===true&&d.replaced==='111111111','★「上書きする」なら入れ替える');
/* CustomLabel が eBay に無い出品は、入れた値で結び付ける。 */
await env.DB.prepare('DELETE FROM items').bind().run();
one={ sku:'', title:'ラベルなし', qty:1, price:'37.00', status:'Active' };
d=(await asJson(await worker.fetch(post('/ebay/link',{item_id:ITEM}),env))).body;
ok(d.ok===false&&/CustomLabel/.test(d.why),'★ラベルも指定も無ければ断る');
d=(await asJson(await worker.fetch(
  post('/ebay/link',{item_id:ITEM,label:'W-'+JAN}),env))).body;
ok(d.ok===true&&d.asin==='W'+JAN,'★★ラベルが空の出品は入れた値で結び付ける');
oneFail='Invalid item ID.';
d=(await asJson(await worker.fetch(post('/ebay/link',{item_id:'960161917614'}),env))).body;
ok(d.ok===false&&/Invalid item ID/.test(d.why),'★eBay で見られない ItemID は理由を返す');
oneFail='';

console.log('\n=== 名簿（/listings）でも W- を受ける ===');
await env.DB.prepare('DELETE FROM items').bind().run();
d=(await asJson(await worker.fetch(post('/listings',
  {items:[{sku:'',custom_label:'W-'+JAN,item_id:ITEM,title:'カラ松',
           dropship:true,weight_g:0,cost_yen:5000}]}),env))).body;
console.log('   '+JSON.stringify({ok:d.ok,sent:d.sent,bad:d.bad}));
r=await env.DB.prepare(
  `SELECT asin,ebay_item_id,dropship,cost_yen FROM items WHERE asin=?1`)
  .bind('W'+JAN).first();
ok(!!r,'★★★名簿の送信で W- の行が作られる（「名簿…0件」だった原因）');
ok(String(r.ebay_item_id)===ITEM&&Number(r.dropship)===1,
   '★ItemID と無在庫の印が入る');
/* 同じ商品を FBA でも出していると、せどりすとSKU 側のキーに付いてしまっていた。 */
await env.DB.prepare('DELETE FROM items').bind().run();
await worker.fetch(post('/listings',
  {items:[{sku:'hobby-261101-1-B00ABCDEFG-1000',custom_label:'W-'+JAN,
           item_id:ITEM,title:'カラ松'}]}),env);
r=await env.DB.prepare(
  `SELECT ebay_item_id FROM items WHERE asin=?1`).bind('W'+JAN).first();
ok(!!r&&String(r.ebay_item_id)===ITEM,
   '★★★せどりすとSKU が付いていても、W- の行に ItemID を入れる');

console.log('\n=== 出品済みの W- の行の仕入れ基準と重さ（/status の mw）===');
await env.DB.prepare('DELETE FROM items').bind().run();
active=[{id:ITEM,sku:'W-'+JAN,title:'カラ松 ぬいぐるみ',price:'37.00'}];
await W.syncEbayActive(env,W.newRun('ebay'));
await env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,wholesale,stock,row_hash,pick,
     seen_at,created_at) VALUES (?1,'A',0,'b2cchara_figure','カラ松',3000,5,'h',1,?2,?2)`)
  .bind(JAN,now).run();
await env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,low,price_at,size_g,size_src,checked_at)
   VALUES (?1,'B00ABCDEFG',2500,?2,600,'pkg',?2)`).bind(JAN,now).run();
const st=(await asJson(await worker.fetch(get('/status'),env))).body;
const m=(st.mw||{})[JAN];
console.log('   '+JSON.stringify(m));
ok(!!m,'★★★出品済みの W- の行ぶんを JAN をキーに返す');
ok(m.cost_mw===3476,'★MW は 卸値×1.1＋送料（3000×1.1＝3300＋176）');
ok(m.cost_amz===2500&&m.cost_src==='amz'&&m.cost===2500,
   '★★★安いほう（Amazon）を仕入れ基準にする');
ok(/仕入れ基準：Amazon ¥2,500（MW ¥3,476／Amazon ¥2,500）/.test(m.cost_text||''),
   '★★「仕入れ基準：MW ¥○○／Amazon ¥○○」の1行を返す');
ok(m.amz_g===600&&m.amz_g_src==='pkg',
   '★★重さ（Amazon の梱包重量）と出どころを返す');
ok(m.asin==='B00ABCDEFG'&&m.wholesale===3000&&m.sha==='A',
   '★ASIN・卸値・仕入れ元も返す');
ok(m.kishu==='b2cchara_figure','★★機種（ジャンルの既定値と梱包マージンに使う）を返す');
ok(Number(m.gone||0)===0,'★欠品していなければ 0');
/* 仕入れ元の印（pick）が無い JAN でも、卸値のいちばん安い行で出す。 */
await env.DB.prepare(`UPDATE mw_stock SET pick=0 WHERE jan=?1`).bind(JAN).run();
await env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,name,wholesale,stock,row_hash,pick,
     seen_at,created_at) VALUES (?1,'B',0,'カラ松',9000,1,'h2',0,?2,?2)`)
  .bind(JAN,now).run();
const st2=(await asJson(await worker.fetch(get('/status'),env))).body;
ok(((st2.mw||{})[JAN]||{}).cost_mw===3476,
   '★★印が無い JAN は卸値のいちばん安い行で出す（画面が空にならない）');

console.log('\n=== 日次の最安値の取り直しは W- を見ない ===');
const q=await env.DB.prepare(
  `SELECT asin FROM items WHERE scope='ebay' AND ebay_qty>0 AND asin LIKE 'B%'`)
  .bind().all();
ok(((q&&q.results)||[]).length===0,
   '★★W- の行は最安値の取り直しの対象にしない（Amazon に無いので）');

T.done();
