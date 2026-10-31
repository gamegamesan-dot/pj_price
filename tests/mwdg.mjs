/* Worker：電池と危険物の申告・種類ごとの必須項目（7.92）
   v213 の「1件だけ送る」が断られた。
     INVALID 90220: '電池本体、電池が必要な商品' は必須ですが、入力されていません。
             90220: '危険物規制' は必須ですが、入力されていません。
   ・ASIN の**本当の種類**を Catalog（productTypes）で引く（mw_amz.ptype に控える）
   ・その種類の**必須項目**を Product Type Definitions（LISTING_OFFER_ONLY）で引く
     （項目表の URL も読む。amz_ptype に控えて、同じ種類は二度聞かない）
   ・フィギュア・プラモデル・ゲームソフトは「電池なし・該当しない」で自動送信
   ・それ以外の種類、または商品名に LED・電池・発光などがある行は人が選ぶまで送らない
   ・ほかの必須項目が足りないときは、何を足せばよいかの案内を返す
   ・同じ SKU で送り直せる（べき等） */
import { harness, loadWorker, makeEnv, asJson } from './lib.mjs';
const T=harness('Worker：電池・危険物の申告');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwdg');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs', LWA_REFRESH_TOKEN:'rt',
  SP_SELLER_ID:'A1SELLER9999' });

let calls=[], ptype={}, defs={}, schema={}, put={};
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  calls.push({url:url,method:o.method||'GET',body:String(o.body||'')});
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  if(/catalog\/2022-04-01\/items/.test(url)){
    const ids=new URL(url).searchParams.get('identifiers').split(',');
    return new Response(JSON.stringify({ items:ids.map((a)=>({ asin:a,
      productTypes:[{ productType:(ptype[a]||'TOYS_AND_GAMES') }],
      summaries:[{ itemName:'カタログの名前' }] })) }),{status:200});
  }
  if(/definitions\/2020-09-01\/productTypes/.test(url)){
    const pt=decodeURIComponent((url.split('/productTypes/')[1]||'').split('?')[0]);
    const v=defs[pt];
    if(typeof v==='number')
      return new Response(JSON.stringify({errors:[{code:'x',message:'だめ'}]}),{status:v});
    return new Response(JSON.stringify({ productType:pt,
      schema:{ link:{ resource:'https://d1.cloudfront.net/schema/'+pt+'.json' } }
    }),{status:200});
  }
  if(/cloudfront\.net\/schema/.test(url)){
    const pt=(url.split('/schema/')[1]||'').replace('.json','');
    return new Response(JSON.stringify(schema[pt]||schema['*']),{status:200});
  }
  if(/listings\/2021-08-01\/items/.test(url)){
    const sku=decodeURIComponent((url.split('/items/')[1]||'').split('?')[0]
      .split('/')[1]||'');
    const v=put[sku];
    if(v)return new Response(JSON.stringify(v),{status:200});
    return new Response(JSON.stringify({status:'ACCEPTED',submissionId:'s1',
      issues:[]}),{status:200});
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
schema['*']={ required:['merchant_suggested_asin','condition_type',
    'batteries_required','supplier_declared_dg_hz_regulation'],
  properties:{ merchant_suggested_asin:{}, condition_type:{},
    fulfillment_availability:{}, purchasable_offer:{}, condition_note:{},
    batteries_required:{}, batteries_included:{},
    supplier_declared_dg_hz_regulation:{} } };
const post=async(path,body,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
/* 怪物事変 日下夏羽（実際に断られた行）。 */
const FIG={ sku:'mwhobby-20261031-N-B091VLKFVC-11713', asin:'B091VLKFVC',
  jan:'4580590170018', sha:'MC02', price:19800, cost_src:11713,
  title:'怪物事変 日下夏羽 1/8 フィギュア', name:'怪物事変 日下夏羽 1/8 フィギュア' };
const GAME={ sku:'mwgame-20261031-N-B0GAME0001-3476', asin:'B0GAME0001',
  jan:'4902370550467', sha:'M200', price:9638, cost_src:3476,
  title:'ゲームソフト', name:'Switch のソフト' };
const LED={ sku:'mwhobby-20261031-N-B0LED00001-5000', asin:'B0LED00001',
  jan:'4580590170019', sha:'MC02', price:12800, cost_src:5000,
  title:'LED で光るフィギュア', name:'LED で光るフィギュア' };
const ETC={ sku:'mwhobby-20261031-N-B0ETC00001-5000', asin:'B0ETC00001',
  jan:'4580590170020', sha:'MC02', price:7800, cost_src:5000,
  title:'よく分からない商品', name:'よく分からない商品' };
ptype['B091VLKFVC']='TOY_FIGURE';
ptype['B0GAME0001']='VIDEO_GAMES';
ptype['B0LED00001']='TOY_FIGURE';
ptype['B0ETC00001']='HOME_FURNITURE_AND_DECOR';

console.log('=== 申告をどうするか（mwDgPlan）===');
let g=W.mwDgPlan(FIG,'TOY_FIGURE');
console.log('   フィギュア: '+JSON.stringify(g));
ok(g.auto===true&&g.batteries===false&&g.dg==='not_applicable',
   '★★★フィギュアは「電池なし・該当しない」で自動');
g=W.mwDgPlan(GAME,'VIDEO_GAMES');
ok(g.auto===true&&g.batteries===false,'★★★ゲームソフトも自動');
g=W.mwDgPlan(LED,'TOY_FIGURE');
console.log('   LED: '+JSON.stringify(g.why));
ok(g.auto===false&&/電池|発光/.test(g.why),
   '★★★商品名に LED があれば自動で付けない（人が選ぶ）');
['電池2本使用','発光ギミック','電動フィギュア','充電式','バッテリー内蔵']
  .forEach(function(t){
    ok(W.mwDgPlan({ sku:FIG.sku, name:'なにか'+t },'TOY_FIGURE').auto===false,
       '★「'+t+'」も人が選ぶ');
  });
g=W.mwDgPlan(ETC,'HOME_FURNITURE_AND_DECOR');
console.log('   ほかの種類: '+JSON.stringify(g.why));
ok(g.auto===false&&/種類/.test(g.why),'★★★安心な種類でなければ人が選ぶ');
g=W.mwDgPlan(FIG,'');
ok(g.auto===false&&/種類が分かりません/.test(g.why),
   '★★種類が分からないときも人が選ぶ');
console.log('   分類: '+JSON.stringify([W.mwDgSafeCat(FIG),W.mwDgSafeCat(GAME),
  W.mwDgSafeCat({kishu:'plasticmodel'}),W.mwDgSafeCat({kishu:'seal'})]));
ok(W.mwDgSafeCat(FIG)==='フィギュア・プラモデル','★SKU の接頭辞から分類が分かる');
ok(W.mwDgSafeCat({kishu:'plasticmodel'})==='フィギュア・プラモデル','★プラモデル');
ok(W.mwDgSafeCat({kishu:'seal'})==='','★シールなどは分類に入れない');

console.log('\n=== 種類と必須項目を引く ===');
await env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,checked_at,created_at)
   VALUES ('4580590170018','B091VLKFVC','怪物事変','x','x')`).run();
calls=[];
let r=await post('/mw/put',{ check:1, rows:[FIG] });
console.log('   '+JSON.stringify(r.body.plan));
let pl=r.body.plan[0];
ok(pl.ptype==='TOY_FIGURE','★★★ASIN の本当の種類を Catalog から引く');
ok(pl.auto===true&&pl.batteries===false&&pl.dg==='not_applicable',
   '★★★付ける申告まで決める');
ok(pl.need_batt===true&&pl.need_dg===true,
   '★★★その種類で電池・危険物が必須だと分かる（項目表の required）');
ok(calls.some((c)=>/definitions\/2020-09-01\/productTypes\/TOY_FIGURE/.test(c.url)
   &&/requirements=LISTING_OFFER_ONLY/.test(c.url)),
   '★★★getDefinitionsProductType を LISTING_OFFER_ONLY で呼ぶ');
ok(calls.some((c)=>/cloudfront\.net\/schema/.test(c.url)),
   '★★項目表（スキーマ）も読む');
ok(!calls.some((c)=>/listings\/2021-08-01\/items/.test(c.url)),
   '★★★check のときは送らない（下調べだけ）');
const amz=await env.DB.prepare(
  `SELECT ptype FROM mw_amz WHERE asin='B091VLKFVC'`).first();
ok(String(amz.ptype)==='TOY_FIGURE','★★種類を mw_amz に控える');
const def=await env.DB.prepare(
  `SELECT * FROM amz_ptype WHERE ptype='TOY_FIGURE'`).first();
console.log('   控え: '+JSON.stringify({req:def.req,at:!!def.at}));
ok(/batteries_required/.test(String(def.req)),'★★★必須項目を amz_ptype に控える');
ok(/supplier_declared_dg_hz_regulation/.test(String(def.props)),
   '★★その種類にある項目名も控える（無い名前を送らないため）');
calls=[];
r=await post('/mw/put',{ check:1, rows:[FIG] });
ok(!calls.some((c)=>/definitions/.test(c.url)),
   '★★★2回目は聞かない（種類ごとに控える）');
ok(!calls.some((c)=>/catalog/.test(c.url)),'★★ASIN の種類も控えから読む');

console.log('\n=== 送る（申告が入る）===');
calls=[]; 
r=await post('/mw/put',{ rows:[FIG] });
console.log('   '+JSON.stringify({sent:r.body.sent,ok_n:r.body.ok_n}));
ok(r.body.sent===1&&r.body.ok_n===1,'★★★フィギュアはそのまま送れる');
const body=JSON.parse((calls.filter((c)=>/listings\/2021-08-01/.test(c.url))[0]||{}).body||'{}');
console.log('   '+JSON.stringify(body).slice(0,400));
ok(body.productType==='TOY_FIGURE',
   '★★★productType は Catalog の本当の種類を送る（PRODUCT ではない）');
ok(body.requirements==='LISTING_OFFER_ONLY','★相乗り出品のまま');
ok(body.attributes.batteries_required[0].value===false,
   '★★★batteries_required=false を付ける');
ok(body.attributes.batteries_included[0].value===false,
   '★★batteries_included=false も付ける（電池本体）');
ok(body.attributes.supplier_declared_dg_hz_regulation[0].value==='not_applicable',
   '★★★supplier_declared_dg_hz_regulation=not_applicable を付ける');
ok(r.body.rows[0].dg&&r.body.rows[0].dg.batteries===false,
   '★行ごとに付けた申告を返す（画面に出す）');

console.log('\n=== 項目表に無い名前は送らない ===');
schema['VIDEO_GAMES']={ required:['merchant_suggested_asin'],
  properties:{ merchant_suggested_asin:{}, condition_type:{},
    fulfillment_availability:{}, purchasable_offer:{}, condition_note:{} } };
calls=[];
r=await post('/mw/put',{ rows:[GAME] });
const b2=JSON.parse((calls.filter((c)=>/listings\/2021-08-01/.test(c.url))[0]||{}).body||'{}');
console.log('   '+Object.keys(b2.attributes||{}).join(','));
ok(!('batteries_required' in b2.attributes),
   '★★★その種類に無い項目は送らない（送ると弾かれる）');
ok(r.body.ok_n===1,'★それでも通る');

console.log('\n=== 人が選ぶまで送らない ===');
calls=[];
r=await post('/mw/put',{ rows:[LED,ETC] });
console.log('   '+JSON.stringify(r.body.rows.map((x)=>x.err)));
ok(r.body.sent===0&&r.body.ng===2,'★★★LED とほかの種類は送らない');
ok(!calls.some((c)=>/listings\/2021-08-01/.test(c.url)),
   '★★★putListingsItem を呼ばない（選ぶまで）');
ok(r.body.rows.every((x)=>/申告が決まっていません/.test(String(x.err))),
   '★★理由を返す');
ok(r.body.rows.every((x)=>/確認の画面で選んで/.test(String(x.hint||''))),
   '★★どうすればよいかも返す');

console.log('\n=== 人が選んだら送る ===');
calls=[];
const dg={};
dg[LED.sku]={ batteries:true, dg:'not_applicable' };
r=await post('/mw/put',{ rows:[LED], dg:dg });
const b3=JSON.parse((calls.filter((c)=>/listings\/2021-08-01/.test(c.url))[0]||{}).body||'{}');
console.log('   '+JSON.stringify(b3.attributes.batteries_required));
ok(r.body.sent===1&&r.body.ok_n===1,'★★★選んだら送れる');
ok(b3.attributes.batteries_required[0].value===true,
   '★★★選んだとおり（電池あり）で送る');
ok(b3.attributes.supplier_declared_dg_hz_regulation[0].value==='not_applicable',
   '★★危険物の申告も付く');
ok(r.body.rows[0].dg&&r.body.rows[0].dg.hand===true,'★人が選んだ行だと分かる');

console.log('\n=== ほかの必須項目が足りないとき ===');
put[ETC.sku]={ status:'INVALID', submissionId:'s9', issues:[
  { code:'90220', severity:'ERROR', attributeNames:['country_of_origin'],
    message:"'原産国' は必須ですが、入力されていません。" }] };
const dg2={}; dg2[ETC.sku]={ batteries:false, dg:'not_applicable' };
r=await post('/mw/put',{ rows:[ETC], dg:dg2 });
const row=r.body.rows[0];
console.log('   '+JSON.stringify({err:row.err,hint:row.hint,missing:row.missing}));
ok(row.ok===false&&/90220/.test(String(row.err)),'★エラーの文をそのまま返す');
ok(/country_of_origin/.test(String((row.missing||[]).join(','))),
   '★★★足りない項目の名前を返す');
ok(/必須の項目が足りません/.test(String(row.hint))
   &&/セラーセントラル/.test(String(row.hint)),
   '★★★何をすればよいかの案内を付ける');
let h=W.mwPutHint([{ code:'90220', attrs:['batteries_required'],
  message:"'電池本体、電池が必要な商品' は必須ですが、入力されていません。" }]);
console.log('   '+JSON.stringify(h));
ok(/電池の申告/.test(h.hint),'★★電池のときは電池の案内');
h=W.mwPutHint([{ code:'90220', attrs:['supplier_declared_dg_hz_regulation'],
  message:"'危険物規制' は必須ですが、入力されていません。" }]);
ok(/危険物の申告/.test(h.hint),'★★危険物のときは危険物の案内');

console.log('\n=== 直してから同じ SKU で送り直せる（べき等）===');
delete put[ETC.sku];
calls=[];
r=await post('/mw/put',{ rows:[ETC], dg:dg2 });
const paths=calls.filter((c)=>/listings\/2021-08-01/.test(c.url))
  .map((c)=>({ m:c.method, p:c.url.split('?')[0].split('/items/')[1] }));
console.log('   '+JSON.stringify(paths));
ok(r.body.ok_n===1,'★★★直したら同じ SKU で通る');
ok(paths.length===1&&paths[0].m==='PUT'
   &&paths[0].p==='A1SELLER9999/'+encodeURIComponent(ETC.sku),
   '★★★同じ SKU のパスに PUT する（べき等。二重にならない）');
const log=await env.DB.prepare(
  `SELECT ok FROM mw_reg_log WHERE sku=?1 ORDER BY id`).bind(ETC.sku).all();
console.log('   記録: '+JSON.stringify((log.results||[]).map((x)=>x.ok)));
ok((log.results||[]).length===2&&(log.results||[]).map((x)=>x.ok).join()==='0,1',
   '★★記録は2回ぶん残る（だめ → 通った）');

console.log('\n=== 必須項目を引けなかったとき ===');
defs['TOY_FIGURE2']=503;
ptype['B0NODEF001']='TOY_FIGURE2';
const ND={ sku:'mwhobby-20261031-N-B0NODEF001-5000', asin:'B0NODEF001',
  jan:'4580590170021', sha:'MC02', price:7800, cost_src:5000,
  title:'ふつうのフィギュア', name:'ふつうのフィギュア' };
r=await post('/mw/put',{ check:1, rows:[ND] });
pl=r.body.plan[0];
console.log('   '+JSON.stringify({err:pl.def_err,auto:pl.auto}));
ok(/HTTP 503/.test(String(pl.def_err)),'★★引けなかった理由を返す（画面に出す）');
ok(pl.auto===false,'★★★引けない種類（表に無い）は人が選ぶ');
await T.done();
