/* Worker：国内FBA の出品の可否（7.76）
   ・getListingsRestrictions で「出品できる／許可が要る／出品できない」に分ける
   ・必要なロールは Product Listing（searchCatalogItems と同じ＝いまの認可で使える）
   ・5回/秒・1回で ASIN 1件。1回の件数と時間で止まり、残りを返す
   ・「出品できる」は30日、「許可が要る／出品できない」は7日で調べ直す */
import { harness, loadWorker, makeEnv, get, asJson } from './lib.mjs';
const T=harness('Worker：出品の可否');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwrst');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  LWA_CLIENT_ID:'a', LWA_CLIENT_SECRET:'b', LWA_REFRESH_TOKEN:'c' });
let calls=[], rst={};
globalThis.fetch=async(u)=>{
  const url=String(u); calls.push(url);
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  if(/listings\/2021-08-01\/restrictions/.test(url)){
    const a=new URL(url).searchParams.get('asin');
    const v=rst[a];
    if(typeof v==='number')return new Response('ng',{status:v});
    return new Response(JSON.stringify(v||{restrictions:[]}),{status:200});
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
const post=async(path,body,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
const row=(jan,x)=>Object.assign({jan:jan,sha:'M200',idx:0,kishu:'NS',
  name:jan+'の商品',list_price:5000,release:'2025/01/01',cond:'新品',
  wholesale:3000,stock:9,note:'',ship_text:'即日出荷',ship_days:0},x||{});

console.log('=== 3つに分ける（mwRstPick）===');
ok(W.mwRstPick({restrictions:[]}).state==='ok','★★空なら出品できる');
ok(W.mwRstPick({}).state==='ok','★返りが無くても出品できる扱い');
let ap=W.mwRstPick({restrictions:[{marketplaceId:'A1VC38T7YXB528',
  conditionType:'new_new', reasons:[{ reasonCode:'APPROVAL_REQUIRED',
    message:'この商品を出品するには承認が必要です',
    links:[{ resource:'https://sellercentral.amazon.co.jp/hz/approvalrequest?asin=X',
             verb:'GET', title:'出品許可を申請' }] }]}]});
console.log('   '+JSON.stringify(ap));
ok(ap.state==='approval','★★★APPROVAL_REQUIRED は「許可が要る」');
ok(/approvalrequest/.test(ap.link),'★★★申請リンクを取り出す');
ok(/承認が必要/.test(ap.reasons),'★理由も残す');
let bl=W.mwRstPick({restrictions:[{reasons:[{ reasonCode:'NOT_ELIGIBLE',
  message:'この商品は出品できません' }]}]});
ok(bl.state==='blocked'&&!bl.link,'★★★リンクが無ければ「出品できない」');
/* リンクはあるが reasonCode が違うときも、申請できるので approval にする */
let lk=W.mwRstPick({restrictions:[{reasons:[{ reasonCode:'OTHER',
  message:'制限あり', links:[{ resource:'https://x/apply' }] }]}]});
ok(lk.state==='approval','★★リンクがあれば「許可が要る」にする');

console.log('\n=== 在庫と ASIN を入れる ===');
const JANS=['4902370550467','4580416924740','4988611224878','4970381909444'];
let r=await post('/mw/stock',{ at:'2026-11-03T00:00:00Z', part:1, parts:1,
  rows:JANS.map((j)=>row(j)) });
ok(r.body.added===4,'★4件');
for(let i=0;i<JANS.length;i++){
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,basis,new_n,amz,checked_at,created_at)
     VALUES (?1,?2,'x',1000,'カート',2,0,'x','x')`)
    .bind(JANS[i],'B00RST0'+String(i).padStart(3,'0')).run();
}

console.log('\n=== 調べる ===');
rst['B00RST0000']={restrictions:[]};                       // 出品できる
rst['B00RST0001']={restrictions:[{reasons:[{reasonCode:'APPROVAL_REQUIRED',
  message:'承認が必要',
  links:[{resource:'https://sellercentral.amazon.co.jp/apply/1'}]}]}]};
rst['B00RST0002']={restrictions:[{reasons:[{reasonCode:'NOT_ELIGIBLE',
  message:'出品できません'}]}]};
rst['B00RST0003']=503;                                     // 一時的な失敗
calls=[];
r=await post('/mw/restrict',{ kishu:'NS', ship_max:4, stock_min:5 });
console.log('   '+JSON.stringify({asked:r.body.asked,done:r.body.done,
  ok_n:r.body.ok_n,approval:r.body.approval,blocked:r.body.blocked,
  failed:r.body.failed,calls:r.body.calls}));
ok(r.body.ok===true,'★★通る');
ok(r.body.asked===4,'★ASIN がある4件');
ok(r.body.ok_n===1&&r.body.approval===1&&r.body.blocked===1,
   '★★★3つに分かれる');
ok(r.body.failed===1,'★失敗も数える');
const nc=calls.filter((u)=>/restrictions/.test(u)).length;
console.log('   呼び出し: '+nc+'回');
ok(nc===4,'★★1件につき1回（まとめて送れない API）');
ok(calls.filter((u)=>/conditionType=new_new/.test(u)).length===4,
   '★★新品として調べる');
ok(calls.filter((u)=>/marketplaceIds=A1VC38T7YXB528/.test(u)).length===4,
   '★★amazon.co.jp のみ');
let g=async(a)=>await env.DB.prepare(
  'SELECT * FROM mw_restrict WHERE asin=?1').bind(a).first();
let g1=await g('B00RST0001');
console.log('   '+JSON.stringify({state:g1.state,link:g1.link}));
ok(g1.state==='approval'&&/apply\/1/.test(g1.link),'★★★申請リンクを控える');
let g2=await g('B00RST0002');
ok(g2.state==='blocked','★★出品できないを控える');
let g3=await g('B00RST0003');
ok(/restrictions_503/.test(g3.err||''),'★★失敗の理由を控える');

console.log('\n=== 調べ直す間隔（出品できる30日・それ以外7日）===');
ok(W.MW_RST_TTL_D===30&&W.MW_RST_BAD_TTL_D===7,'★★30日と7日');
r=await post('/mw/restrict',{ kishu:'NS', stock_min:5 });
console.log('   '+JSON.stringify({asked:r.body.asked}));
ok(r.body.asked===1,'★★★取れた3件は対象外（失敗の1件だけ残る）');
/* 「許可が要る」を8日前にすると調べ直す */
await env.DB.prepare("UPDATE mw_restrict SET checked_at=?1 WHERE asin='B00RST0001'")
  .bind(new Date(Date.now()-8*86400000).toISOString()).run();
r=await post('/mw/restrict',{ kishu:'NS', stock_min:5 });
ok(r.body.asked>=2,'★★★「許可が要る」は7日で調べ直す');
/* 「出品できる」は8日では調べ直さない */
await env.DB.prepare("UPDATE mw_restrict SET checked_at=?1 WHERE asin='B00RST0000'")
  .bind(new Date(Date.now()-8*86400000).toISOString()).run();
let before=r.body.asked;
r=await post('/mw/restrict',{ kishu:'NS', stock_min:5 });
let has0=(r.body.rows||[]).some((x)=>x.asin==='B00RST0000');
ok(has0===false,'★★★「出品できる」は8日では調べ直さない（30日）');
await env.DB.prepare("UPDATE mw_restrict SET checked_at=?1 WHERE asin='B00RST0000'")
  .bind(new Date(Date.now()-31*86400000).toISOString()).run();
r=await post('/mw/restrict',{ kishu:'NS', stock_min:5 });
ok((r.body.rows||[]).some((x)=>x.asin==='B00RST0000'),
   '★★★31日たてば調べ直す');
/* 失敗した1件（503 で止まる）を先に当てると残りが永久に進まない。
   失敗した行はいちばん後ろに回す。 */
await env.DB.prepare("UPDATE mw_restrict SET checked_at=?1 WHERE asin='B00RST0000'")
  .bind(new Date(Date.now()-31*86400000).toISOString()).run();
calls=[];
r=await post('/mw/restrict',{ kishu:'NS', stock_min:5 });
let seq=calls.filter((u)=>/restrictions/.test(u))
  .map((u)=>new URL(u).searchParams.get('asin'));
console.log('   順番: '+seq.join(','));
ok(seq[0]==='B00RST0000','★★★失敗した行はいちばん後ろ（1件の不調で止まらない）');
ok(seq.indexOf('B00RST0003')===seq.length-1,'★★失敗した行が最後に来る');

console.log('\n=== 1回の件数の上限 ===');
r=await post('/mw/restrict',{ kishu:'NS', stock_min:5, limit:1 });
ok(r.body.done<=1,'★★上限で止まる');
ok(W.MW_RST_MAX===400,'★1回の上限は400件');

console.log('\n=== 候補一覧に可否が付く ===');
let d=(await asJson(await worker.fetch(
  get('/mw/amz?kishu=NS&stock_min=5&limit=100'),env))).body;
let one=d.rows.filter((x)=>x.asin==='B00RST0001')[0];
console.log('   '+JSON.stringify({rst:one&&one.rst,link:one&&one.rst_link}));
ok(one&&one.rst==='approval','★★★行に可否が入る');
ok(one&&/apply\/1/.test(one.rst_link),'★★★申請リンクも返る');
ok(one&&!!one.rst_at,'★いつ調べたかも返る');
let okRow=d.rows.filter((x)=>x.asin==='B00RST0000')[0];
ok(okRow&&okRow.rst==='ok','★★出品できる行');

console.log('\n=== 作業者のキー ===');
r=await post('/mw/restrict',{ kishu:'NS' },'staff-key-123');
ok(r.status===403,'★★作業者では調べられない');

console.log('\n=== 呼び出しの間隔 ===');
ok(W.SP_KV_LANES&&!W.SP_KV_LANES.getListingsRestrictions,
   '★速い API なので KV の間隔は使わない');

await T.done();
