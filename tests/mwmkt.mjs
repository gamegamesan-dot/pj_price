/* Worker：MW の eBay 相場（7.62）と MW の商品画像（7.63）
   ・候補の代表を JAN で Browse 検索し、即決の最安値を**送料込み**で控える
   ・新品の最安値（low）と状態を問わない最安値（low_any）を1回の検索で両方出す
   ・7日に1回まで。失敗したものは1日後に取り直す
   ・1回の件数と時間で必ず止まり、残りを left で返す
   ・画像は MW の products/….jpg だけを読み、長辺500px未満は使えないとする
   ・会員サイト（/buy/?q=）には行かない。Amazon の画像も使わない */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：MW の相場と画像');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwmkt');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  EBAY_CLIENT_ID:'cid', EBAY_CLIENT_SECRET:'sec' });

/* ---- 外に出る通信を全部差し替える ---- */
let calls=[], browse={}, imgs={};
const TOKEN={ access_token:'tok', expires_in:7200 };
globalThis.fetch=async(u,i)=>{
  const url=String(u); calls.push(url);
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify(TOKEN),{status:200});
  if(/item_summary\/search/.test(url)){
    const g=new URL(url).searchParams.get('gtin');
    const b=browse[g];
    if(b===undefined)return new Response(JSON.stringify({total:0,itemSummaries:[]}),{status:200});
    if(typeof b==='number')return new Response('ng',{status:b});
    return new Response(JSON.stringify(b),{status:200});
  }
  if(/matchingworld\.asia/.test(url)){
    const v=imgs[url];
    if(v===undefined)return new Response('nf',{status:404});
    if(typeof v==='number')return new Response('ng',{status:v});
    return new Response(v.body,{status:200,headers:{'content-type':v.ct||'image/jpeg'}});
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
/* JPEG の形だけ作る（SOF0 に縦横を入れる。worker の imageSize が読む形） */
function jpeg(w,h,pad){
  const head=[0xff,0xd8,0xff,0xc0,0x00,0x11,0x08,(h>>8)&255,h&255,(w>>8)&255,w&255,
    0x03,0x01,0x11,0x00,0x02,0x11,0x01,0x03,0x11,0x01];
  const a=new Uint8Array(head.length+(pad||0));
  a.set(head,0); for(let i=head.length;i<a.length;i++)a[i]=0x5a;
  return a;
}
const put=async(path,body,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
const row=(jan,sha,x)=>Object.assign({jan:jan,sha:sha,idx:0,kishu:'NS',
  name:jan+'の商品',list_price:5000,release:'2025/01/01',cond:'新品',
  wholesale:3000,stock:5,note:'',ship_text:'即日出荷',ship_days:0},x||{});
const CAND=['4902370550467','4580416924740','4988611224878','4970381909444'];

console.log('=== 画像URLの組み立て（仕様6.1）===');
console.log('   10921742 → '+W.mwImgUrl(10921742));
ok(W.mwImgUrl(10921742)==='https://matchingworld.asia/products/10920000/10921700/10921742.jpg',
   '★★仕様書の実例と同じURLになる');
ok(W.mwImgUrl(0)===''&&W.mwImgUrl('abc')==='','★おかしな値ではURLを作らない');
ok(W.mwImgId('10921742')===10921742,'★商品IDをそのまま読む');
ok(W.mwImgId('https://matchingworld.asia/products/10920000/10921700/10921742.jpg')===10921742,
   '★★画像URLからも商品IDを読み戻す');
ok(W.mwImgId('https://matchingworld.asia/buy/?q=4970381909444')===0,
   '★★会員サイトのURLは受け取らない（ログインの口は使わない）');
ok(W.mwImgId('https://example.com/products/1/2/3.jpg')===0,'★★他のホストは受け取らない');

console.log('\n=== 在庫を入れておく ===');
let r=await put('/mw/stock',{ at:'2026-10-26T00:00:00Z', part:1, parts:1,
  rows:CAND.map((j)=>row(j,'M200',{wholesale:3000+CAND.indexOf(j)*100})) });
ok(r.body.ok===true&&r.body.added===4,'★候補4件（代表4件）');

console.log('\n=== 相場を引く（送料込みの最安値）===');
/* 新品 $30+$5=35、新品 $33 送料無料、中古 $20 送料無料 →
   新品の最安値は 33、状態を問わない最安値は 20 */
browse['4902370550467']={ total:3, itemSummaries:[
  { itemId:'v1|1|0', title:'Bayonetta 3 JP', condition:'Used',
    price:{value:'20.00',currency:'USD'},
    shippingOptions:[{shippingCost:{value:'0.00',currency:'USD'}}] },
  { itemId:'v1|2|0', title:'Bayonetta 3 NEW', condition:'New',
    price:{value:'30.00',currency:'USD'},
    shippingOptions:[{shippingCost:{value:'5.00',currency:'USD'}}] },
  { itemId:'v1|3|0', title:'Bayonetta 3 NEW free ship', conditionId:'1000',
    price:{value:'33.00',currency:'USD'},
    shippingOptions:[{shippingCost:{value:'0.00',currency:'USD'}}] }]};
/* 送料が分からない出品。本体だけで数え、印を立てる */
browse['4580416924740']={ total:1, itemSummaries:[
  { itemId:'v1|9|0', title:'Grisaia figure', condition:'New',
    price:{value:'120.00',currency:'USD'} }]};
/* 競売しかない＝即決の絞り込みで 0件（eBay 側が返す total が 0） */
browse['4988611224878']={ total:0, itemSummaries:[] };
browse['4970381909444']=503;                       // eBay が一時的に落ちている

calls=[];
r=await put('/mw/market',{ limit:3, kishu:'NS', ship_max:4, stock_min:2 });
console.log('   '+JSON.stringify({asked:r.body.asked,done:r.body.done,hit:r.body.hit,
  none:r.body.none,failed:r.body.failed,left:r.body.left,stopped:r.body.stopped}));
ok(r.body.ok===true,'★★相場の取得が通る');
ok(r.body.asked===4,'★★調べる対象は候補4件');
ok(r.body.done===3&&r.body.limit===3,'★★1回の上限（3件）で止まる');
ok(r.body.left===1,'★★残りを left で返す（押すたびに進む）');
const nSearch=calls.filter((u)=>/item_summary/.test(u)).length;
console.log('   Browse の呼び出し: '+nSearch+'回');
ok(nSearch===3,'★★呼び出しは1件につき1回だけ');
ok(calls.filter((u)=>/buy\/\?q=/.test(u)).length===0,
   '★★会員サイトは呼ばない');

let m=async(jan)=>(await env.DB.prepare(
  'SELECT * FROM mw_market WHERE jan=?1').bind(jan).first());
let a=await m('4902370550467');
console.log('   '+JSON.stringify({n:a.n,n_new:a.n_new,low:a.low,item:a.low_item,
  ship:a.low_ship,low_any:a.low_any,no_ship:a.no_ship}));
ok(a.n===3&&a.n_new===2,'★★件数と新品の件数');
ok(a.low===33&&a.low_item===33&&a.low_ship===0,
   '★★新品の最安値は送料込みで比べる（$30+$5 より $33 送料無料が安い）');
ok(a.low_any===20,'★★状態を問わない最安値も控える（中古 $20）');
ok(a.no_ship===0,'★送料が分かる出品だけなら印は立たない');
ok(/NEW free ship/.test(a.title)&&a.item_id==='v1|3|0',
   '★その最安値の出品を控える');

let b=await m('4580416924740');
ok(b.low===120&&b.no_ship===1,
   '★★送料が分からない出品は本体だけで数え、印を立てる（総額を低めに見る）');

console.log('\n=== 7日たつまで取り直さない ===');
calls=[];
r=await put('/mw/market',{ limit:10, kishu:'NS' });
console.log('   '+JSON.stringify({asked:r.body.asked,done:r.body.done}));
ok(W.MW_MKT_TTL_D===7,'★取り直さない日数は7日');
ok(r.body.asked===1&&r.body.done===1,
   '★★さっき取れた3件は対象外。残っていた1件だけを引く');
let c=await m('4988611224878');
ok(c&&c.n===0&&c.low===null,'★★eBay に即決の出品が無ければ「相場なし」');
await env.DB.prepare(
  "UPDATE mw_market SET checked_at=?1 WHERE jan='4902370550467'")
  .bind(new Date(Date.now()-8*86400000).toISOString()).run();
r=await put('/mw/market',{ limit:10, kishu:'NS' });
ok(r.body.asked>=1&&r.body.done>=1,'★★8日前のものは取り直す');

console.log('\n=== 失敗したものは1日後に取り直す ===');
let e=await m('4970381909444');
console.log('   err: '+e.err);
ok(/^browse_503/.test(e.err||''),'★★失敗の理由を控える');
browse['4970381909444']={ total:1, itemSummaries:[
  { itemId:'v1|7|0', title:'Chiikawa seal', condition:'New',
    price:{value:'9.00',currency:'USD'},
    shippingOptions:[{shippingCost:{value:'3.50',currency:'USD'}}] }]};
await env.DB.prepare(
  "UPDATE mw_market SET checked_at=?1 WHERE jan='4970381909444'")
  .bind(new Date(Date.now()-26*3600000).toISOString()).run();
r=await put('/mw/market',{ limit:10, kishu:'NS' });
e=await m('4970381909444');
ok(e.low===12.5&&(e.err||'')==='','★★取り直せたら理由を消す（$9+$3.5）');

console.log('\n=== 候補一覧に相場が付く ===');
let d=(await asJson(await worker.fetch(
  get('/mw/list?kishu=NS&ship_max=4&stock_min=2&limit=100'),env))).body;
console.log('   '+JSON.stringify(d.mkt));
ok(d.n===4,'★候補4件');
let one=d.rows.filter((x)=>x.jan==='4902370550467')[0];
ok(one&&one.mkt_low===33&&one.mkt_n===3,'★★行に最安値と件数が付く');
ok(one&&!!one.mkt_at,'★いつ調べたかも返す');
ok(d.mkt.over===1.15,'★★115%の線を画面に渡す');
ok(d.mkt.seen===4&&d.mkt.left===0,'★★調べ終わった件数と残りを返す');
ok(d.rows.filter((x)=>x.jan==='4988611224878')[0].mkt_n===0,
   '★★相場なしの行は件数0で返る（画面が別に出す）');

console.log('\n=== MW の画像を測る ===');
const U=(id)=>W.mwImgUrl(id);
imgs[U(10921742)]={ body:jpeg(1600,1200,400) };     // 使える
imgs[U(10921743)]={ body:jpeg(400,300,100) };       // 小さすぎる
imgs[U(10921744)]={ body:jpeg(600,900,200) };       // 縦長でも長辺900
calls=[];
r=await put('/mw/img',{ jan:'4902370550467',
  ids:['10921742','https://matchingworld.asia/products/10920000/10921700/10921743.jpg',
       '10921744','10921799'] });
console.log('   '+JSON.stringify(r.body.rows.map((x)=>
  x.pos+':'+(x.ok?'○':'×')+' '+x.w+'x'+x.h+' '+(x.err||''))));
ok(r.body.ok===true&&r.body.n===4,'★★4枚ぶんを測る');
ok(r.body.good===2&&r.body.bad===2,'★★使える2枚・使えない2枚');
ok(r.body.rows[0].long===1600&&r.body.rows[0].ok===true,'★★長辺1600pxは使える');
ok(r.body.rows[1].ok===false&&/500px未満/.test(r.body.rows[1].err),
   '★★長辺500px未満は「使えません」とはっきり返す');
ok(r.body.rows[2].long===900&&r.body.rows[2].ok===true,'★★縦長でも長辺で見る');
ok(r.body.rows[3].ok===false&&/404/.test(r.body.rows[3].err),
   '★★その商品IDの画像が無ければ 404 と返す');
ok(r.body.rows[0].pos===0,'★★1枚目がメイン（pos=0）');
ok(!!r.body.rows[0].b64,'★★使える画像は中身も返す（画面が pj-img に上げる）');
ok(r.body.min_long===500&&r.body.max===12,'★下限と枚数の上限を返す');
ok(calls.every((u)=>/^https:\/\/matchingworld\.asia\/products\/\d+\/\d+\/\d+\.jpg$/.test(u)),
   '★★取りに行くのは products/….jpg だけ');

console.log('\n=== 測るだけ（probe）===');
r=await put('/mw/img',{ jan:'4902370550467', ids:['10921742'], probe:true });
ok(r.body.rows[0].ok===true&&r.body.rows[0].long===1600,'★大きさは返る');
ok(!r.body.rows[0].b64,'★★probe のときは中身を返さない（大きさだけ調べる）');

console.log('\n=== 13枚目以降は受け取らない ===');
r=await put('/mw/img',{ jan:'4902370550467',
  ids:new Array(20).fill('10921742') });
ok(r.body.n===12,'★★最大12枚（仕様の上限）');

console.log('\n=== 上げ終わった公開URLを控える ===');
r=await put('/mw/img',{ jan:'4902370550467', saved:[
  { pos:0, url:'https://pj-img.x.workers.dev/i/20261026/'
      +'1b4e28ba-2fa1-11d2-883f-0016d3cca427.jpg' },
  { pos:1, url:'http://evil.example.com/x.jpg' }] });
ok(r.body.ok===true&&r.body.n===1,'★★pj-img の形のURLだけ控える');
let g=(await asJson(await worker.fetch(
  get('/mw/img?jan=4902370550467'),env))).body;
ok(g.ok===true&&g.rows[0].url&&/\/i\/20261026\//.test(g.rows[0].url),
   '★★控えた公開URLを返す（二度は取りに行かない）');
ok(g.rows.length===12,'★控えは12枚ぶん');
ok(d.rows.filter((x)=>x.jan==='4902370550467')[0].pics_ok!==undefined,
   '★一覧に使える写真の枚数が付く');

console.log('\n=== 作業者のキー ===');
r=await put('/mw/market',{ limit:1 },'staff-key-123');
ok(r.status===403&&r.body.error==='forbidden_for_staff','★★相場は作業者では引けない');
r=await put('/mw/img',{ jan:'4902370550467', ids:['10921742'] },'staff-key-123');
ok(r.status===403,'★★画像の取り込みも作業者では使えない');

console.log('\n=== base64 ===');
let bytes=new Uint8Array(300); for(let i=0;i<300;i++)bytes[i]=(i*31+7)&255;
ok(W.toB64(bytes.buffer)===Buffer.from(bytes).toString('base64'),
   '★★base64 が Node と一致する');

await T.done();
