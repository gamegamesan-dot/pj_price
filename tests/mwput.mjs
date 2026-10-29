/* Worker：Amazon への登録（putListingsItem・7.90）
   フラットファイル（POST_FLAT_FILE_LISTINGS_DATA）は 2025-07-31 に廃止されたので、
   Feeds API ではなく Listings Items API で1件ずつ PUT する。
   ・相乗り出品（商品情報は作らない）＝ requirements: "LISTING_OFFER_ONLY"
   ・ALLOWED でこの1本だけが write:true（唯一の書き込み）。明示しないと通らない
   ・issues をそのまま持ち帰り、行ごとに mw_reg_log に残す
   ・SKU の形・SKU の中の ASIN・売値を送る前に確かめる
   ・管理者だけ */
import { harness, loadWorker, makeEnv, get, asJson } from './lib.mjs';
const T=harness('Worker：Amazonへの登録');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwput');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs', LWA_REFRESH_TOKEN:'rt',
  SP_SELLER_ID:'A1SELLER9999' });

let calls=[], reply={};
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  if(/listings\/2021-08-01\/items/.test(url)){
    calls.push({url:url,method:o.method,body:String(o.body||'')});
    const sku=decodeURIComponent((url.split('/items/')[1]||'').split('?')[0]
      .split('/')[1]||'');
    const v=reply[sku];
    if(typeof v==='number')return new Response(JSON.stringify({errors:[
      {code:'InvalidInput',message:'bad'}]}),{status:v});
    return new Response(JSON.stringify(v||{status:'ACCEPTED',submissionId:'s1',
      issues:[]}),{status:200});
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
const post=async(path,body,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
const SKU='mwgame-20261029-N-B0PUT00001-3476';
const row=(x)=>Object.assign({ sku:SKU, asin:'B0PUT00001', jan:'4902370550467',
  sha:'M200', price:9638, cost_src:3476, title:'テストの商品',
  note:'★国内正規品★' },x||{});

console.log('=== 送る中身（mwPutBody）===');
let b=W.mwPutBody(row());
console.log('   '+JSON.stringify(b).slice(0,260));
ok(b.requirements==='LISTING_OFFER_ONLY',
   '★★★相乗り出品（商品情報は作らない）');
ok(b.productType==='PRODUCT','★★productType は PRODUCT');
ok(b.attributes.merchant_suggested_asin[0].value==='B0PUT00001',
   '★★★ASIN を入れる');
ok(b.attributes.condition_type[0].value==='new_new','★★★新品として送る');
ok(b.attributes.fulfillment_availability[0].fulfillment_channel_code==='AMAZON_JP',
   '★★★FBA（AMAZON_JP）で出す');
ok(b.attributes.purchasable_offer[0].our_price[0].schedule[0].value_with_tax===9638,
   '★★★売値を入れる（税込）');
ok(b.attributes.purchasable_offer[0].currency==='JPY','★円');
ok(b.attributes.condition_note[0].value.indexOf('国内正規品')>=0,
   '★★コンディション説明も送る');
ok(b.attributes.merchant_suggested_asin[0].marketplace_id==='A1VC38T7YXB528',
   '★★amazon.co.jp');
ok(!b.attributes.quantity,'★★★数量は送らない（FBA なので在庫は納品で決まる）');

console.log('\n=== 1件送る ===');
calls=[];
let r=await post('/mw/put',{ rows:[row()] });
console.log('   '+JSON.stringify({sent:r.body.sent,ok_n:r.body.ok_n,ng:r.body.ng}));
ok(r.body.ok===true&&r.body.sent===1&&r.body.ok_n===1,'★★★通る');
const c0=calls[0];
console.log('   '+c0.method+' '+c0.url.replace(/^https:\/\/[^/]+/,''));
ok(c0.method==='PUT','★★★PUT で送る');
ok(c0.url.indexOf('/listings/2021-08-01/items/A1SELLER9999/')>=0,
   '★★★出品者トークンと SKU をパスに入れる');
ok(c0.url.indexOf(encodeURIComponent(SKU))>=0,'★★SKU がパスに入る');
ok(/marketplaceIds=A1VC38T7YXB528/.test(c0.url),'★★amazon.co.jp');
ok(/issueLocale=ja_JP/.test(c0.url),'★★指摘を日本語で受け取る');
let log=await env.DB.prepare('SELECT * FROM mw_reg_log ORDER BY id DESC LIMIT 1').first();
console.log('   '+JSON.stringify({sku:log.sku,ok:log.ok,status:log.status,
  sub:log.sub_id}));
ok(log.ok===1&&log.status==='ACCEPTED','★★★行ごとに mw_reg_log に残す');
ok(log.sub_id==='s1','★★submissionId も残す');
ok(log.asin==='B0PUT00001'&&log.jan==='4902370550467'&&log.price===9638,
   '★★ASIN・JAN・売値も残す');
ok(log.by_role==='admin','★誰が送ったかも残す');
/* 通った行は skus にも入る */
let sk=await env.DB.prepare('SELECT * FROM skus WHERE seller_sku=?1').bind(SKU).first();
console.log('   skus: '+JSON.stringify({src:sk.buy_src,jan:sk.jan,cost:sk.cost_src}));
ok(sk.buy_src==='mw'&&sk.jan==='4902370550467'&&sk.cost_src===3476,
   '★★★通った行は skus にも控える（仕入れ元・JAN・仕入値）');

console.log('\n=== 指摘（issues）を持ち帰る ===');
reply[SKU]={ status:'ACCEPTED', submissionId:'s2', issues:[
  { code:'90220', message:'この商品は出品に承認が必要です', severity:'ERROR',
    attributeNames:['merchant_suggested_asin'] },
  { code:'18155', message:'画像がありません', severity:'WARNING' }] };
r=await post('/mw/put',{ rows:[row()] });
console.log('   '+JSON.stringify(r.body.rows[0]).slice(0,220));
ok(r.body.ok_n===0&&r.body.ng===1,'★★★ERROR の指摘があれば「だめ」にする');
ok(r.body.rows[0].issues.length===2,'★★★指摘をそのまま返す');
ok(/90220/.test(r.body.rows[0].err)&&/承認が必要/.test(r.body.rows[0].err),
   '★★★コードと文を理由にする');
/* WARNING だけなら通ったとみなす */
reply[SKU]={ status:'ACCEPTED', submissionId:'s3', issues:[
  { code:'18155', message:'画像がありません', severity:'WARNING' }] };
r=await post('/mw/put',{ rows:[row()] });
ok(r.body.ok_n===1,'★★★WARNING だけなら通ったとみなす');
/* INVALID は だめ */
reply[SKU]={ status:'INVALID', submissionId:'s4', issues:[] };
r=await post('/mw/put',{ rows:[row()] });
ok(r.body.ok_n===0&&r.body.rows[0].status==='INVALID','★★INVALID は だめ');
/* HTTP で落ちたとき */
reply[SKU]=400;
r=await post('/mw/put',{ rows:[row()] });
console.log('   '+JSON.stringify(r.body.rows[0].err));
ok(/^HTTP 400/.test(r.body.rows[0].err)&&/InvalidInput/.test(r.body.rows[0].err),
   '★★★HTTP の番号と Amazon のコードを残す');
reply[SKU]=null;

console.log('\n=== 送る前に確かめる ===');
calls=[];
r=await post('/mw/put',{ rows:[
  row({ sku:'こわれたSKU' }),
  row({ sku:'mwgame-20261029-N-B0PUT00001-3476', asin:'B0OTHER001' }),
  row({ price:0 })] });
console.log('   '+JSON.stringify(r.body.rows.map((x)=>x.err)));
ok(r.body.sent===0&&r.body.ng===3,'★★★形がおかしい行は送らない');
ok(calls.length===0,'★★★1回も呼ばない');
ok(/SKU の形/.test(r.body.rows[0].err),'★★SKU の形を見る');
ok(/ASIN と合いません/.test(r.body.rows[1].err),
   '★★★SKU の中の ASIN と合わない行は送らない（取り違え防止）');
ok(/売値がありません/.test(r.body.rows[2].err),'★★売値を見る');

console.log('\n=== 出品者トークンが無いとき ===');
const env2=makeEnv({ LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs',
  LWA_REFRESH_TOKEN:'rt' });
calls=[];
let r2=await asJson(await worker.fetch(new Request('https://x/mw/put',
  {method:'POST',headers:{'X-PJ-Key':'k','content-type':'application/json'},
   body:JSON.stringify({ rows:[row()] })}),env2));
console.log('   '+JSON.stringify({sent:r2.body.sent,why:String(r2.body.why||'').slice(0,40)}));
ok(r2.body.sent===0&&/SP_SELLER_ID/.test(String(r2.body.why||'')),
   '★★★トークンが無ければ1回も送らず、入れ方を出す');
ok(calls.length===0,'★★呼ばない');

console.log('\n=== 書き込みは明示しないと通らない（ALLOWED）===');
const src=(await import('node:fs')).default.readFileSync(
  (await import('./lib.mjs')).WORKER,'utf8');
ok(/\{ m: "PUT", write: true,/.test(src),
   '★★★PUT の1本だけが write:true（明示しないと通らない）');
ok(/putListingsItem: 250/.test(src),'★★5回/秒の間隔');
/* 読み取り専用の守りが効いていること */
const run0={ kind:'t', subrequests:0, pages:0, errors:0, notes:[], rows:0 };
let threw='';
try{
  W.assertReadOnly('https://sellingpartnerapi-fe.amazon.com/listings/2021-08-01/'
    +'items/A1SELLER9999/x?marketplaceIds=A1VC38T7YXB528','PUT',{},false);
}catch(e){ threw=String(e.message||''); }
console.log('   '+threw);
ok(/blocked_by_readonly_guard/.test(threw),
   '★★★write を明示しない PUT は守りで止まる');
let threw2='';
try{
  W.assertReadOnly('https://sellingpartnerapi-fe.amazon.com/listings/2021-08-01/'
    +'items/A1SELLER9999/x?marketplaceIds=A1VC38T7YXB528','PUT',{},true);
}catch(e){ threw2=String(e.message||''); }
ok(threw2==='','★★write を明示すれば通る');

console.log('\n=== 記録（画面の「結果」）と上限 ===');
let d=(await asJson(await worker.fetch(get('/mw/put?limit=10'),env))).body;
console.log('   '+JSON.stringify({rows:d.rows.length,sent_ok:d.sent_ok,max:d.max}));
ok(d.ok===true&&d.rows.length>0,'★記録を返す');
ok(d.sent_ok>=2,'★★★通った件数を返す（まとめて送るを出すかの判断）');
ok(d.max===W.MW_PUT_MAX&&W.MW_PUT_MAX===30,'★1回30件まで');
ok(Array.isArray(d.rows[0].issues),'★★指摘は配列で返す');

console.log('\n=== 作業者のキー ===');
r=await post('/mw/put',{ rows:[row()] },'staff-key-123');
ok(r.status===403,'★★★作業者では登録できない（唯一の書き込みなので）');

await T.done();
