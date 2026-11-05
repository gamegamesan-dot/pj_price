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

let calls=[], ptype={}, defs={}, schema={}, put={}, link={};
/* 実物の置き場（v214 は CloudFront だと思って許していたので止められていた）。
     https://selling-partner-definitions-prod-….s3[.region].amazonaws.com/… */
const SCHEMA_HOST='https://selling-partner-definitions-prod-iad.s3.amazonaws.com';
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
  if(/definitions\/2020-09-01\/productTypes\?/.test(url)){
    /* 商品名を渡したときは「その商品に近い種類」を返す（7.95）。 */
    if(/itemName=/.test(url))
      return new Response(JSON.stringify({ productTypes:[
        { name:'ABIS_VIDEO_GAMES' },{ name:'VIDEO_GAMES' },
        { name:'VIDEO_GAME_ACCESSORIES' }] }),{status:200});
    return new Response(JSON.stringify({ productTypes:[
      { name:'FIGURINE' },{ name:'ABIS_VIDEO_GAMES' },{ name:'TOY_FIGURE' },
      { name:'HOME_FURNITURE_AND_DECOR' },{ name:'ABIS_DRUGSTORE' }] }),
      {status:200});
  }
  if(/definitions\/2020-09-01\/productTypes/.test(url)){
    const pt=decodeURIComponent((url.split('/productTypes/')[1]||'').split('?')[0]);
    const v=defs[pt];
    if(typeof v==='number')
      return new Response(JSON.stringify({errors:[{code:'x',message:'だめ'}]}),{status:v});
    return new Response(JSON.stringify({ productType:pt,
      schema:{ link:{ resource:(link[pt]||SCHEMA_HOST)+'/schema/'+pt+'.json'
        +'?X-Amz-Expires=604800' } }
    }),{status:200});
  }
  if(/\/schema\//.test(url)&&/amazonaws\.com|cloudfront/.test(url)){
    const pt=(url.split('/schema/')[1]||'').replace('.json','').split('?')[0];
    return new Response(JSON.stringify(schema[pt]||schema['*']),{status:200});
  }
  if(/listings\/2021-08-01\/items/.test(url)){
    const sku=decodeURIComponent((url.split('/items/')[1]||'').split('?')[0]
      .split('/')[1]||'');
    let v=put[sku];
    if(Array.isArray(v))v=v.length?v.shift():null;
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
/* 実際に返ってきた名前（2026-11-01 の報告）。想定の名前ではない。 */
ptype['B091VLKFVC']='FIGURINE';
ptype['B0GAME0001']='ABIS_VIDEO_GAMES';
ptype['B0LED00001']='FIGURINE';
ptype['B0ETC00001']='HOME_FURNITURE_AND_DECOR';

console.log('=== 申告をどうするか（mwDgPlan）===');
let g=W.mwDgPlan(FIG,'FIGURINE');
console.log('   フィギュア: '+JSON.stringify(g));
ok(g.auto===true&&g.batteries===false&&g.dg==='not_applicable',
   '★★★フィギュアは「電池なし・該当しない」で自動');
g=W.mwDgPlan(GAME,'ABIS_VIDEO_GAMES');
ok(g.auto===true&&g.batteries===false,'★★★ゲームソフトも自動');
g=W.mwDgPlan(LED,'FIGURINE');
console.log('   LED: '+JSON.stringify(g.why));
ok(g.auto===false&&/電池|発光/.test(g.why),
   '★★★商品名に LED があれば自動で付けない（人が選ぶ）');
['電池2本使用','発光ギミック','電動フィギュア','充電式','バッテリー内蔵']
  .forEach(function(t){
    ok(W.mwDgPlan({ sku:FIG.sku, name:'なにか'+t },'FIGURINE').auto===false,
       '★「'+t+'」も人が選ぶ');
  });
g=W.mwDgPlan(ETC,'HOME_FURNITURE_AND_DECOR');
console.log('   ほかの種類: '+JSON.stringify(g.why));
ok(g.auto===false&&/種類/.test(g.why),'★★★安心な種類でなければ人が選ぶ');
g=W.mwDgPlan(FIG,'');
console.log('   種類なし（mwhobby）: '+JSON.stringify(g.why));
ok(g.auto===true&&/フィギュア/.test(g.why),
   '★★★種類が分からなくても、SKU が mwhobby- なら自動（7.93）');
g=W.mwDgPlan({ sku:'mwetc-20261031-N-B0ETC00001-100', name:'よく分からない商品' },'');
ok(g.auto===false&&/種類が分かりません/.test(g.why),
   '★★種類も機種も分からないときは人が選ぶ');
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
ok(pl.ptype==='FIGURINE','★★★ASIN の本当の種類を Catalog から引く');
ok(pl.auto===true&&pl.batteries===false&&pl.dg==='not_applicable',
   '★★★付ける申告まで決める');
ok(pl.need_batt===true&&pl.need_dg===true,
   '★★★その種類で電池・危険物が必須だと分かる（項目表の required）');
ok(calls.some((c)=>/definitions\/2020-09-01\/productTypes\/FIGURINE/.test(c.url)
   &&/requirements=LISTING_OFFER_ONLY/.test(c.url)),
   '★★★getDefinitionsProductType を LISTING_OFFER_ONLY で呼ぶ');
ok(calls.some((c)=>c.url.indexOf(SCHEMA_HOST)===0),
   '★★★項目表（スキーマ）も読む（実物の置き場 selling-partner-definitions-prod…）');
ok(!calls.some((c)=>/listings\/2021-08-01\/items/.test(c.url)),
   '★★★check のときは送らない（下調べだけ）');
const amz=await env.DB.prepare(
  `SELECT ptype FROM mw_amz WHERE asin='B091VLKFVC'`).first();
ok(String(amz.ptype)==='FIGURINE','★★種類を mw_amz に控える');
const def=await env.DB.prepare(
  `SELECT * FROM amz_ptype WHERE ptype='FIGURINE'`).first();
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
ok(body.productType==='FIGURINE',
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
/* そのまま送る種類（ABIS_ でない種類）で確かめる。
   ABIS_ は PRODUCT で送るので、見るのは PRODUCT の項目表になる（7.95）。 */
schema['COLLECTIBLE_FIGURINE']={ required:['merchant_suggested_asin'],
  properties:{ merchant_suggested_asin:{}, condition_type:{},
    fulfillment_availability:{}, purchasable_offer:{}, condition_note:{} } };
ptype['B0FIG00002']='COLLECTIBLE_FIGURINE';
const FIG2={ sku:'mwhobby-20261031-N-B0FIG00002-5000', asin:'B0FIG00002',
  jan:'4580590170022', sha:'MC02', price:9800, cost_src:5000,
  title:'ふつうのフィギュア2', name:'ふつうのフィギュア2' };
calls=[];
r=await post('/mw/put',{ rows:[FIG2] });
const b2=JSON.parse((calls.filter((c)=>/listings\/2021-08-01/.test(c.url))[0]||{}).body||'{}');
console.log('   '+b2.productType+' / '+Object.keys(b2.attributes||{}).join(','));
ok(b2.productType==='COLLECTIBLE_FIGURINE','★★ABIS_ でない種類はそのまま送る');
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
defs['NO_SUCH_TYPE']=404;
ptype['B0NODEF001']='NO_SUCH_TYPE';
const ND={ sku:'mwhobby-20261031-N-B0NODEF001-5000', asin:'B0NODEF001',
  jan:'4580590170021', sha:'MC02', price:7800, cost_src:5000,
  title:'ふつうのフィギュア', name:'ふつうのフィギュア' };
calls=[];
r=await post('/mw/put',{ check:1, rows:[ND] });
pl=r.body.plan[0];
console.log('   '+JSON.stringify({pt:pl.ptype,send:pl.ptype_send,
  err:pl.def_err,auto:pl.auto}));
ok(calls.some((c)=>/productTypes\/NO_SUCH_TYPE/.test(c.url)),
   '★★引けるかどうかは一度確かめる');
ok(pl.ptype_send==='PRODUCT',
   '★★★項目表が引けない（404・無効）種類は PRODUCT で送る（7.95）');
ok(!pl.def_err,'★★PRODUCT の項目表は読めているので、必須は分かる');
ok(pl.auto===true&&/フィギュア/.test(String(pl.why)),
   '★★★項目表が引けなくても、MW の機種・SKU の接頭辞で分かれば自動（7.93）');


/* ========== ここから v215（7.93）==========
   v214 の実地で分かったこと：
   ・返ってきた種類は FIGURINE・ABIS_VIDEO_GAMES（想定の名前ではなかった）
   ・項目表の置き場は CloudFront ではなく selling-partner-definitions-prod…
     （v214 は許していなかったので blocked_by_readonly_guard で止まっていた） */
console.log('\n=== 実際に返ってきた種類の名前（v215）===');
['FIGURINE','ABIS_VIDEO_GAMES'].forEach(function(t){
  const g2=W.mwDgPlan({ sku:'mwx-20261031-N-B091VLKFVC-100', name:'ふつうの商品' },t);
  console.log('   '+t+': '+JSON.stringify(g2.auto));
  ok(g2.auto===true&&g2.batteries===false&&g2.dg==='not_applicable',
     '★★★'+t+' は自動で「電池なし・危険物に該当しない」');
});
/* 名前の形でも拾う（Amazon が種類の名前を増やしても追いかけられるように）。 */
[['TOY_FIGURE',1],['COLLECTIBLE_FIGURINE',1],['MODEL_KIT',1],['VIDEO_GAMES',1],
 ['TOYS_AND_GAMES',1],['ABIS_TOY',1],['PLASTIC_MODEL_KIT',1],['TRADING_CARD',1],
 ['VIDEO_GAME_ACCESSORIES',0],['TOY_VEHICLE',0],['HOME_FURNITURE_AND_DECOR',0],
 ['ABIS_DRUGSTORE',0],['CELLULAR_PHONE',0],['POWER_BANK',0]].forEach(function(x){
  ok(W.mwDgSafePt(x[0],{})===!!x[1],
     '★'+x[0]+' は自動'+(x[1]?'でよい':'にしない'));
});
ok(W.mwDgNoPt('TOY_VEHICLE',{})===true,
   '★★「自動にしない」とはっきり決めた種類は、接頭辞がフィギュアでも人が選ぶ');
ok(W.mwDgPlan({ sku:'mwhobby-20261031-N-B091VLKFVC-100', name:'ラジコン' },
   'TOY_VEHICLE').auto===false,'★★★そのとおり人が選ぶ');

console.log('\n=== ⚙の表で足し引きできる（6.128）===');
ok(W.mwDgSafePt('ABIS_DRUGSTORE',{ ABIS_DRUGSTORE:1 })===true,
   '★★★⚙で印を付けた種類は自動になる');
ok(W.mwDgSafePt('FIGURINE',{ FIGURINE:0 })===false,
   '★★★⚙で印を外した種類は人が選ぶ');
const SET={ at:new Date().toISOString(), settings:{ mwDgTypes:{ ABIS_DRUGSTORE:1 } } };
let rs=await post('/settings',SET);
ok(rs.body.ok===true,'★⚙の設定を保存できる');
const ov=await W.mwDgOver(env);
console.log('   足し引き: '+JSON.stringify(ov));
ok(ov.ABIS_DRUGSTORE===1,'★★設定から足し引きを読む');
ok(W.mwDgPlan({ sku:'mwx-20261031-N-B0NODEF001-100', name:'なにか' },
   'ABIS_DRUGSTORE',ov).auto===true,'★★★⚙で足した種類は自動で送れる');
/* 文字でも受ける（画面は hidden に JSON の文字で持っている）。 */
rs=await post('/settings',{ at:new Date(Date.now()+1000).toISOString(),
  settings:{ mwDgTypes:'{"ABIS_DRUGSTORE":1}' } });
ok((await W.mwDgOver(env)).ABIS_DRUGSTORE===1,'★★文字の JSON でも読める');

console.log('\n=== 申告を覚える（ASIN ごと・7.93）===');
await env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,checked_at,created_at)
   VALUES ('4580590170019','B0LED00001','LED フィギュア','x','x')`).run();
const dgL={}; dgL[LED.sku]={ batteries:true, dg:'not_applicable' };
let r2=await post('/mw/put',{ rows:[LED], dg:dgL });
ok(r2.body.ok_n===1,'★選んで送れる');
const mem=await env.DB.prepare(
  `SELECT * FROM amz_dg WHERE asin='B0LED00001'`).first();
console.log('   控え: '+JSON.stringify(mem));
ok(mem&&Number(mem.batteries)===1&&String(mem.dg)==='not_applicable',
   '★★★人が選んだ申告を ASIN ごとに控える');
r2=await post('/mw/put',{ check:1, rows:[LED] });
let pl2=r2.body.plan[0];
console.log('   次回: '+JSON.stringify(pl2));
ok(pl2.auto===true&&pl2.prev===true&&pl2.batteries===true,
   '★★★次に同じ ASIN を登録するときは自動で当てる（選び直さなくてよい）');
ok(/前回の選択を使用/.test(String(pl2.why)),
   '★★★画面に出す文に「前回の選択を使用」と入る');
/* 選び直せる（送った選択で控えを書き換える）。 */
const dgL2={}; dgL2[LED.sku]={ batteries:false, dg:'not_applicable' };
r2=await post('/mw/put',{ rows:[LED], dg:dgL2 });
const mem2=await env.DB.prepare(
  `SELECT batteries FROM amz_dg WHERE asin='B0LED00001'`).first();
ok(r2.body.ok_n===1&&Number(mem2.batteries)===0,
   '★★★選び直したら控えも書き換わる');
/* 自動で決まる行は覚えない（表の判定だけで足りるので）。 */
const noMem=await env.DB.prepare(
  `SELECT COUNT(*) AS n FROM amz_dg WHERE asin='B091VLKFVC'`).first();
ok(Number(noMem.n)===0,'★自動で決まる行は控えない');

console.log('\n=== 項目表の置き場（ALLOWED・7.93）===');
const G=(u,m)=>{ try{ W.assertReadOnly(u,m||'GET',{},false); return ''; }
                 catch(e){ return String(e&&e.message||e); } };
ok(G(SCHEMA_HOST+'/schema/FIGURINE.json?X-Amz-Expires=604800')==='',
   '★★★実物の置き場は GET で読める（v214 はここで止まっていた）');
ok(G('https://selling-partner-definitions-prod-fe.s3.us-west-2.amazonaws.com/x/y.json')==='',
   '★★地域の入った名前でも読める');
ok(G('https://s3.ap-northeast-1.amazonaws.com/selling-partner-definitions-prod/x.json')==='',
   '★★パスにバケット名が入る形でも読める');
ok(/blocked_by_readonly_guard/.test(G(SCHEMA_HOST+'/schema/x.json','PUT')),
   '★★★GET だけ（PUT は止める）');
ok(/blocked_by_readonly_guard/.test(G('https://d1.cloudfront.net/schema/x.json')),
   '★★★ほかのホスト（CloudFront）は許さない');
ok(/blocked_by_readonly_guard/.test(
   G('https://my-bucket.s3.amazonaws.com/x.json')),
   '★★★ほかの S3 のバケットも許さない');
ok(G('https://sellingpartnerapi-fe.amazon.com/definitions/2020-09-01/productTypes'
   +'?marketplaceIds=A1VC38T7YXB528')==='','★★種類の一覧も GET で読める');

console.log('\n=== 読めなかった控えは長く持たない ===');
ok(W.MW_PT_ERR_MIN<=60,'★しくじりの控えは1時間以内で引き直す');
await env.DB.prepare(
  `INSERT INTO amz_ptype (ptype,req,props,err,at,created_at)
     VALUES ('FIGURINE2','[]','[]','項目表を読めません：むかしのエラー',?1,?1)`)
  .bind(new Date(Date.now()-3600000).toISOString()).run();
calls=[];
let d2=await W.mwPtypeDef(env,{ notes:[], id:'t', kind:'t' },'FIGURINE2');
console.log('   '+JSON.stringify({err:d2.err,req:d2.req.length}));
ok(calls.some((c)=>/productTypes\/FIGURINE2/.test(c.url)),
   '★★★許可を直したあと、古いエラーの控えは引き直す');
ok(!d2.err&&d2.req.length>0,'★★引き直せたら必須項目が入る');

console.log('\n=== 種類の一覧（GET /mw/ptypes・6.128）===');
const get=async(path,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  { headers:{'X-PJ-Key':key||'k'} }),env));
let rp=await get('/mw/ptypes?all=1');
console.log('   '+JSON.stringify({seen:rp.body.seen,all:rp.body.all.slice(0,3)}));
ok(rp.body.ok===true,'★一覧を返す');
ok(rp.body.seen.some((x)=>x.ptype==='FIGURINE'&&x.n>0),
   '★★★これまでに出てきた種類を件数つきで返す');
ok(rp.body.seen.filter((x)=>x.ptype==='FIGURINE')[0].safe===1,
   '★★いま自動でよいかも返す（⚙の印の付け外しに使う）');
ok(rp.body.seen.filter((x)=>x.ptype==='FIGURINE')[0].need_batt===true,
   '★★その種類で電池が必須だったかも返す');
ok(rp.body.all.indexOf('FIGURINE')>=0&&rp.body.all.length>2,
   '★★★Amazon の種類の一覧（searchDefinitionsProductTypes）も返す');
ok(rp.body.over&&rp.body.over.ABIS_DRUGSTORE===1,'★⚙の足し引きも返す');
calls=[];
rp=await get('/mw/ptypes?all=1');
ok(!calls.some((c)=>/productTypes\?/.test(c.url)),'★★一覧は控えから出す（14日）');
/* 作業者用のキーでも見られる（変更は /settings 側で管理者だけ）。 */
rp=await get('/mw/ptypes','staff-key-123');
ok(rp.body.ok===true,'★★作業者用の端末でも表を見られる');
rs=await post('/settings',{ at:new Date(Date.now()+2000).toISOString(),
  settings:{ mwDgTypes:{ FIGURINE:0 } } },'staff-key-123');
console.log('   作業者の保存: '+JSON.stringify(rs.status));
ok(rs.status===403,'★★★作業者用のキーでは表を変えられない（管理者だけ）');
/* ========== ここから v217（7.95）==========
   v215 の実地で、東方少女綺想譚（mwgame-20261105-N-B0H8D9NY89-7843）が
     4000003: 指定したAmazonの商品タイプが無効であるか、サポートされていません。
   と断られた（種類 ABIS_VIDEO_GAMES・申告は付いていた）。
   Catalog の種類は「その商品が何か」の名前で、**出品に使える種類とは別**のことがある。 */
console.log('\n=== 送る種類の決め方（mwPutType）===');
ok(W.mwPutType('ABIS_VIDEO_GAMES',{ err:'',props:[] })==='PRODUCT',
   '★★★ABIS_ で始まる種類は PRODUCT で送る');
ok(W.mwPutType('ABIS_DRUGSTORE',{})==='PRODUCT','★ABIS_ はどれも PRODUCT');
ok(W.mwPutType('FIGURINE',{ err:'',props:['x'] })==='FIGURINE',
   '★★★通った種類（FIGURINE）はそのまま送る');
ok(W.mwPutType('FIGURINE',{ err:'HTTP 404 ' })==='PRODUCT',
   '★★★項目表が引けない（404・無効）種類は PRODUCT で送る');
ok(W.mwPutType('',null)==='PRODUCT','★★種類が分からなければ PRODUCT');
ok(W.mwPutTypeBad([{ code:'4000003', message:'指定したAmazonの商品タイプが無効' }])===true,
   '★★★4000003 は「種類が違う」と分かる');
ok(W.mwPutTypeBad([{ code:'90220', message:"'原産国' は必須です" }])===false,
   '★★ほかのエラーは種類のせいにしない');

console.log('\n=== ABIS_ の商品を送る（東方少女綺想譚）===');
const SW={ sku:'mwgame-20261105-N-B0H8D9NY89-7843', asin:'B0H8D9NY89',
  jan:'4580589360090', sha:'M200', price:11800, cost_src:7843,
  title:'東方少女綺想譚 Nintendo Switch版', name:'東方少女綺想譚 Nintendo Switch版' };
ptype['B0H8D9NY89']='ABIS_VIDEO_GAMES';
await env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,checked_at,created_at)
   VALUES ('4580589360090','B0H8D9NY89','東方少女綺想譚','x','x')`).run();
calls=[];
r=await post('/mw/put',{ check:1, rows:[SW] });
pl=r.body.plan[0];
console.log('   '+JSON.stringify({ptype:pl.ptype,send:pl.ptype_send,auto:pl.auto}));
ok(pl.ptype==='ABIS_VIDEO_GAMES','★Catalog の種類はそのまま持つ（画面に出す）');
ok(pl.ptype_send==='PRODUCT','★★★送る種類は PRODUCT に置き換える');
ok(pl.auto===true&&pl.batteries===false,'★★申告は付けたまま');
calls=[];
r=await post('/mw/put',{ rows:[SW] });
let b4=JSON.parse((calls.filter((c)=>/listings\/2021-08-01/.test(c.url))[0]||{}).body||'{}');
console.log('   '+JSON.stringify({pt:b4.productType,
  batt:b4.attributes.batteries_required,dg:!!b4.attributes.supplier_declared_dg_hz_regulation}));
ok(r.body.ok_n===1,'★★★通る');
ok(b4.productType==='PRODUCT','★★★productType は PRODUCT で送る');
ok(b4.attributes.batteries_required[0].value===false
   &&b4.attributes.batteries_included[0].value===false,
   '★★★電池の申告は付けたまま（付けないと 90220 で断られる）');
ok(b4.attributes.supplier_declared_dg_hz_regulation[0].value==='not_applicable',
   '★★★危険物の申告も付けたまま');
let lg=await env.DB.prepare(
  `SELECT ptype,ptype_try FROM mw_reg_log WHERE sku=?1 ORDER BY id DESC`)
  .bind(SW.sku).first();
console.log('   記録: '+JSON.stringify(lg));
ok(String(lg.ptype)==='PRODUCT','★★★どの種類で送ったかを mw_reg_log に残す');

console.log('\n=== それでも断られたら、種類を探して送り直す ===');
/* 1回目（PRODUCT）は 4000003、2回目は通る、という場面にする。 */
put[SW.sku]=[{ status:'INVALID', submissionId:'s7', issues:[
  { code:'4000003', severity:'ERROR', attributeNames:[],
    message:'指定したAmazonの商品タイプが無効であるか、サポートされていません。' }]}];
calls=[];
r=await post('/mw/put',{ rows:[SW] });
const puts=calls.filter((c)=>/listings\/2021-08-01/.test(c.url));
const pts=puts.map((c)=>JSON.parse(c.body||'{}').productType);
console.log('   送った順: '+JSON.stringify(pts)+' / '+JSON.stringify(r.body.rows[0]&&
  {ok:r.body.rows[0].ok,used:r.body.rows[0].ptype_used,try:r.body.rows[0].ptype_try}));
ok(pts.length===2&&pts[0]==='PRODUCT','★★★1回目は PRODUCT で送る');
ok(calls.some((c)=>/productTypes\?.*itemName=/.test(c.url)),
   '★★★商品名で出品用の種類を探す（searchDefinitionsProductTypes）');
ok(pts[1]==='VIDEO_GAMES',
   '★★★見つかった種類（VIDEO_GAMES）で同じ SKU に送り直す（ABIS_ は選ばない）');
ok(r.body.ok_n===1&&r.body.alt===1,'★★★2回目で通る');
ok(r.body.rows[0].ptype_used==='VIDEO_GAMES'
   &&r.body.rows[0].ptype_try==='PRODUCT > VIDEO_GAMES',
   '★★★どちらで通ったかを返す');
ok(/4000003/.test(String(r.body.rows[0].first_err||'')),
   '★★1回目に断られた理由も返す');
lg=await env.DB.prepare(
  `SELECT ptype,ptype_try,ok FROM mw_reg_log WHERE sku=?1 ORDER BY id DESC`)
  .bind(SW.sku).first();
console.log('   記録: '+JSON.stringify(lg));
ok(String(lg.ptype)==='VIDEO_GAMES'&&String(lg.ptype_try)==='PRODUCT > VIDEO_GAMES'
   &&Number(lg.ok)===1,'★★★どちらで通ったかを mw_reg_log に残す');
const pathsAll=puts.map((c)=>c.url.split('?')[0].split('/items/')[1]);
ok(pathsAll.length===2&&pathsAll[0]===pathsAll[1]
   &&puts.every((c)=>c.method==='PUT'),
   '★★★送り直しも同じ SKU の PUT（べき等。二重に作らない）');

console.log('\n=== 種類が見つからなければ、1回で止める ===');
put[SW.sku]=[{ status:'INVALID', submissionId:'s8', issues:[
  { code:'4000003', severity:'ERROR', attributeNames:[],
    message:'指定したAmazonの商品タイプが無効であるか、サポートされていません。' }]},
  { status:'INVALID', submissionId:'s9', issues:[
  { code:'4000003', severity:'ERROR', attributeNames:[],
    message:'指定したAmazonの商品タイプが無効であるか、サポートされていません。' }]}];
calls=[];
r=await post('/mw/put',{ rows:[Object.assign({},SW,{ title:'', name:'' })] });
console.log('   '+JSON.stringify({sent:r.body.sent,ok:r.body.ok_n,
  try:r.body.rows[0].ptype_try}));
ok(calls.filter((c)=>/listings\/2021-08-01/.test(c.url)).length===1,
   '★★★商品名が無ければ探さない（送り直さない）');
ok(r.body.ng===1&&/4000003/.test(String(r.body.rows[0].err)),
   '★★断られた理由を返す');

console.log('\n=== 直してから同じ SKU で送り直せる ===');
delete put[SW.sku];
calls=[];
r=await post('/mw/put',{ rows:[SW] });
console.log('   '+JSON.stringify({ok:r.body.ok_n,used:r.body.rows[0].ptype_used}));
ok(r.body.ok_n===1,'★★★同じ SKU で送り直すと通る');
const hist=await env.DB.prepare(
  `SELECT ok,ptype FROM mw_reg_log WHERE sku=?1 ORDER BY id`).bind(SW.sku).all();
console.log('   記録: '+JSON.stringify((hist.results||[])
  .map((x)=>x.ok+':'+x.ptype)));
ok((hist.results||[]).length>=4,'★★記録は送った回数ぶん残る');
await T.done();
