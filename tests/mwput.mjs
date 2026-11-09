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

/* 本物の getItemOffersBatch は 0.1回/秒（10.5秒おき）。
   テストでは待たせない（間隔そのものは tests/mwfee.mjs などで見張っている）。 */
W.SP_GAP.getItemOffersBatch=0;
let calls=[], reply={};
/* 7.115：送る直前に値段を取り直す。ASIN ごとに新品／中古の出品を返す。
   既定は「新品に1人・9,638円」（これまでのテストと同じ売値になる）。 */
let offers={ '*': { New:[{ b:9638, s:0 }], Used:[] } }, offersFail=false;
const offerOf=(asin,cond)=>{
  const o=offers[asin]||offers['*']||{ New:[], Used:[] };
  return (cond==='New'?(o.New||[]):(o.Used||[]));
};
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  /* 値段の取り直し（getItemOffersBatch・7.115）。 */
  if(/batches\/products\/pricing\/v0\/itemOffers/.test(url)){
    if(offersFail)return new Response('{"errors":[{"code":"x"}]}',{status:503});
    const reqs=(JSON.parse(String(o.body||'{}')).requests)||[];
    return new Response(JSON.stringify({ responses:reqs.map((q)=>{
      const asin=(/\/items\/([A-Z0-9]{10})\/offers/.exec(String(q.uri||''))||[])[1]||'';
      const cond=String(q.ItemCondition||'New');
      const list=offerOf(asin,cond);
      return { request:q, status:{statusCode:200},
        body:{ payload:{ ASIN:asin, ItemCondition:cond,
          Summary:{ NumberOfOffers:[{ condition:cond.toLowerCase(),
            OfferCount:list.length }], TotalOfferCount:list.length },
          Offers:list.map((x)=>({ SubCondition:(cond==='New'?'new':'good'),
            ListingPrice:{ Amount:x.b, CurrencyCode:'JPY' },
            Shipping:{ Amount:x.s||0, CurrencyCode:'JPY' } })) } } };
    }) }),{status:200});
  }
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
  /* 送る前の下調べ（7.92）。ASIN の種類と、その種類の必須項目。 */
  if(/catalog\/2022-04-01\/items/.test(url)){
    const ids=new URL(url).searchParams.get('identifiers').split(',');
    return new Response(JSON.stringify({ items:ids.map((a)=>({ asin:a,
      productTypes:[{ productType:'VIDEO_GAMES', marketplaceId:'A1VC38T7YXB528' }],
      summaries:[{ itemName:'テストの商品' }] })) }),{status:200});
  }
  if(/definitions\/2020-09-01\/productTypes/.test(url))
    return new Response(JSON.stringify({ productType:'VIDEO_GAMES',
      schema:{ link:{ resource:'https://d1.cloudfront.net/schema/VIDEO_GAMES.json' } }
    }),{status:200});
  if(/cloudfront\.net\/schema/.test(url))
    return new Response(JSON.stringify({ required:['merchant_suggested_asin',
      'condition_type','batteries_required','supplier_declared_dg_hz_regulation'],
      properties:{ merchant_suggested_asin:{}, condition_type:{},
        fulfillment_availability:{}, purchasable_offer:{}, condition_note:{},
        batteries_required:{}, batteries_included:{},
        supplier_declared_dg_hz_regulation:{} } }),{status:200});
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
/* 7.121（【Q】の2）：この JAN に「仕入れる」の印を付けておく。
   登録が通ったら、その場で mw_buy も「登録済み（pj）」になること。
   v243 まではならず、MW から消えたときに取り込みの知らせが
   「注文前に売り切れました」と**誤って**言っていた（薔薇と椿）。 */
await env.DB.prepare(
  `INSERT INTO mw_buy (jan,qty,by_role,at,created_at,asin)
   VALUES (?1,1,'admin',?2,?2,?3)`)
  .bind('4902370550467','2026-11-01T00:00:00Z','B0PUT00001').run();
let r=await post('/mw/put',{ rows:[row()] });
console.log('   '+JSON.stringify({sent:r.body.sent,ok_n:r.body.ok_n,ng:r.body.ng}));
ok(r.body.ok===true&&r.body.sent===1&&r.body.ok_n===1,'★★★通る');
{
  const b2=await env.DB.prepare(
    `SELECT reg_state, reg_sku, reg_at FROM mw_buy WHERE jan=?1`)
    .bind('4902370550467').first();
  console.log('   mw_buy '+JSON.stringify(b2));
  ok(b2&&b2.reg_state==='pj',
     '★★★通ったら mw_buy も「登録済み（pj）」にする（7.121・誤報の元を断つ）');
  ok(b2&&String(b2.reg_sku||'')===SKU,'★★その SKU を控える');
  ok(b2&&!!b2.reg_at,'★いつ登録したかも控える');
}
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
/* 3つめは「新品も中古も出品が無い」行（7.115）。画面から来た売値は見ない。 */
offers['B0NOOFFER1']={ New:[], Used:[] };
r=await post('/mw/put',{ rows:[
  row({ sku:'こわれたSKU' }),
  row({ sku:'mwgame-20261029-N-B0PUT00001-3476', asin:'B0OTHER001' }),
  row({ sku:'mwgame-20261029-N-B0NOOFFER1-3476', asin:'B0NOOFFER1',
        price:9999 })] });
console.log('   '+JSON.stringify(r.body.rows.map((x)=>x.err)));
ok(r.body.sent===0&&r.body.ng===3,'★★★形がおかしい行は送らない');
ok(calls.length===0,'★★★1回も呼ばない');
ok(/SKU の形/.test(r.body.rows[0].err),'★★SKU の形を見る');
ok(/ASIN と合いません/.test(r.body.rows[1].err),
   '★★★SKU の中の ASIN と合わない行は送らない（取り違え防止）');
ok(/新品も中古も出品がありません/.test(r.body.rows[2].err),
   '★★★新品も中古もいない行は送らない（7.115）');

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

console.log('\n=== 作業者のキー（7.111：登録できる。中身は pj-sync が組み立てる）===');
/* 7.111：作業者の端末からも登録できる。ただし送るのは
   「仕入れる」の印が付いた商品だけで、売値・SKU・仕入原価・申告は
   pj-sync 側で決める（画面から来た値は使わない）。 */
const JAN_S='4902370559001';
env.DB._db.prepare(
  `INSERT INTO mw_buy (jan,qty,by_role,at,created_at,asin,name,sha,kishu,
     cond,wholesale,snap_at)
   VALUES ('`+JAN_S+`',1,'staff','2026-10-29T02:00:00Z','2026-10-29T02:00:00Z',
     'B0STAFF777','作業者の商品','M200','NS','新品',3000,
     '2026-10-29T02:00:00Z')`).run();
env.DB._db.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,checked_at,created_at)
   VALUES ('`+JAN_S+`','B0STAFF777','作業者の商品',9980,
     '2026-11-07T00:00:00Z','2026-11-07T00:00:00Z')`).run();
/* 出品の可否（mw_restrict）。'ok' でなければ送らない。 */
env.DB._db.prepare(
  `INSERT INTO mw_restrict (asin,cond,state,checked_at,created_at)
   VALUES ('B0STAFF777','new_new','ok','2026-11-07T00:00:00Z',
     '2026-11-07T00:00:00Z')`).run();
/* 7.115：売値は送る直前に取り直す。新品に1人・9,980円いることにする。 */
offers['B0STAFF777']={ New:[{ b:9980, s:0 }], Used:[] };
/* 下調べ（check）で、pj-sync が組み立てた中身が返る。 */
r=await post('/mw/put',{ check:1, rows:[{ jan:JAN_S, price:1, sku:'うそのSKU' }] },
  'staff-key-123');
console.log('   '+r.status+' '+JSON.stringify(r.body).slice(0,400));
ok(r.status===200&&r.body.ok===true,'★★★作業者でも 403 にならない（7.111）');
const pl=(r.body.plan||[])[0]||{};
/* 印を付けた日（2026-10-29 JST）と、印を付けた時点の卸値（3000×1.1＋176＝3476）。 */
ok(pl.sku==='mwgame-20261029-N-B0STAFF777-3476',
   '★★★SKU は pj-sync が組み立てる（仕入日＝印の日・仕入原価＝印の時点の卸値）');
ok(pl.asin==='B0STAFF777','★ASIN も控えから入れる');
r=await post('/mw/put',{ rows:[{ jan:JAN_S, price:1, sku:'うそのSKU' }] },
  'staff-key-123');
console.log('   '+JSON.stringify({sent:r.body.sent,ok_n:r.body.ok_n,
  rows:r.body.rows}));
ok(r.body.sent===1&&r.body.ok_n===1,'★★★作業者の端末から登録できる');
const sent=calls[calls.length-1];
ok(/B0STAFF777-3476/.test(sent.url),'★★送った SKU も pj-sync が決めたもの');
ok(/9980/.test(sent.body)&&!/\"amount\":1\b/.test(sent.body),
   '★★★売値は取り直した値段（画面から来た 1円は使わない）');
/* 記録に「誰が」が残る。 */
let lg=(await asJson(await worker.fetch(get('/mw/put?limit=5'),env))).body;
console.log('   記録: '+JSON.stringify(lg.rows[0]&&
  { sku:lg.rows[0].sku, by:lg.rows[0].by_role, day:lg.day }));
ok(lg.rows[0].by_role==='staff','★★★誰が登録したかを残す（作業者）');
ok(!!lg.rows[0].at_jst,'★日本時間の列も返す');
ok(lg.day&&lg.day.max===30&&lg.day.used>=1,
   '★★1日の上限（既定30件）と今日の件数を返す');
/* 二重登録はしない（登録済みの印が付いている行）。 */
env.DB._db.prepare(
  `UPDATE mw_buy SET reg_state='other', reg_sku='mwgame-x' WHERE jan='`+JAN_S+`'`).run();
r=await post('/mw/put',{ rows:[{ jan:JAN_S }] },'staff-key-123');
console.log('   '+JSON.stringify(r.body.rows));
ok(r.body.sent===0&&/登録済み/.test((r.body.rows[0]||{}).err||''),
   '★★★同じ ASIN で登録済みなら送らない（理由を返す）');
/* 1日の上限を超えたら送らない（⚙ mwPutDay）。 */
await asJson(await worker.fetch(new Request('https://x/settings',{method:'POST',
  headers:{'X-PJ-Key':'k','content-type':'application/json'},
  body:JSON.stringify({ at:new Date().toISOString(),
    settings:{ mwPutDay:'1' } })}),env));
env.DB._db.prepare(
  `UPDATE mw_buy SET reg_state='' WHERE jan='`+JAN_S+`'`).run();
r=await post('/mw/put',{ rows:[{ jan:JAN_S }] },'staff-key-123');
console.log('   '+JSON.stringify({why:r.body.why,sent:r.body.sent}));
ok(r.body.sent===0&&/上限/.test(r.body.why||''),
   '★★★1日の上限に達したら送らない（⚙で変えられる）');

await T.done();
