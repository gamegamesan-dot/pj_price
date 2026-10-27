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
  LWA_CLIENT_ID:'a', LWA_CLIENT_SECRET:'b', LWA_REFRESH_TOKEN:'c',
  SP_SELLER_ID:'A1SELLER9999' });
let calls=[], rst={};
globalThis.fetch=async(u)=>{
  const url=String(u); calls.push(url);
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  if(/listings\/2021-08-01\/restrictions/.test(url)){
    const a=new URL(url).searchParams.get('asin');
    const v=rst[a];
    /* Amazon が実際に返す形。sellerId を付けずに呼ぶと 400 でこれが返る。 */
    if(typeof v==='number')return new Response(JSON.stringify({errors:[
      { code:'InvalidInput',
        message:'Invalid request parameters',
        details:'sellerId is required' }]}),{status:v});
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
ok(/^HTTP 503/.test(g3.err||''),'★★失敗の理由を控える（HTTP の番号つき）');

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

console.log('\n=== sellerId（v196 の全件失敗の原因・7.78）===');
ok(calls.filter((u)=>/sellerId=A1SELLER9999/.test(u)).length>0,
   '★★★sellerId を付けて呼ぶ（必須。付けないと全件 HTTP 400）');
ok(calls.filter((u)=>/restrictions/.test(u))
     .every((u)=>/[?&]sellerId=[^&]+/.test(u)),
   '★★★どの呼び出しにも sellerId が入る');
/* 出品者トークンが無いときは **1回も呼ばない** */
const env2=makeEnv({ STAFF_KEY:'s', LWA_CLIENT_ID:'a', LWA_CLIENT_SECRET:'b',
  LWA_REFRESH_TOKEN:'c' });
await env2.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,list_price,release,cond,wholesale,
     stock,note,ship_text,ship_days,row_hash,pick,seen_at,created_at)
   VALUES ('4902370550467','M200',0,'NS','x',5000,'2025/01/01','新品',3000,9,'',
     '即日出荷',0,'h',1,'x','x')`).run();
await env2.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,basis,new_n,amz,checked_at,created_at)
   VALUES ('4902370550467','B00RSTZZ01','x',1000,'カート',2,0,'x','x')`).run();
calls=[];
let r2=await asJson(await worker.fetch(new Request('https://x/mw/restrict',
  {method:'POST',headers:{'X-PJ-Key':'k','content-type':'application/json'},
   body:JSON.stringify({ kishu:'NS', stock_min:5 })}),env2));
console.log('   '+JSON.stringify({stopped:r2.body.stopped,done:r2.body.done,
  why:String(r2.body.why||'').slice(0,60)}));
ok(r2.body.stopped==='no_seller_id','★★★トークンが無ければ止める');
ok(calls.filter((u)=>/restrictions/.test(u)).length===0,
   '★★★トークンが無ければ1回も呼ばない（158件むだ打ちしない）');
ok(/SP_SELLER_ID/.test(r2.body.why)&&/出品者トークン/.test(r2.body.why),
   '★★★入れ方を理由に出す');

console.log('\n=== 失敗の理由を残す（HTTP の番号と Amazon のコード）===');
rst['B00RST0000']={restrictions:[]};
rst['B00RST0001']=400;              // sellerId 不足のときに返る番号
await env.DB.prepare("DELETE FROM mw_restrict").run();
calls=[];
r=await post('/mw/restrict',{ kishu:'NS', stock_min:5 });
let e1=await g('B00RST0001');
console.log('   '+JSON.stringify({err:e1.err,fails:r.body.fails}));
ok(/^HTTP 400/.test(String(e1.err||'')),'★★★HTTP の番号を残す');
ok(/InvalidInput/.test(String(e1.err||'')),'★★★Amazon のエラーコードも残す');
ok(/sellerId/.test(String(e1.err||'')),'★★くわしい内容も残す');
ok((r.body.fails||[]).length>0&&/^HTTP 400/.test(r.body.fails[0].err),
   '★★★画面に出せるよう理由を返す');
let d2=(await asJson(await worker.fetch(
  get('/mw/amz?kishu=NS&stock_min=5&limit=100'),env))).body;
let bad=d2.rows.filter((x)=>x.asin==='B00RST0001')[0];
ok(bad&&/^HTTP 400/.test(String(bad.rst_err||'')),
   '★★★行にも失敗の理由を返す');

console.log('\n=== 全件失敗が続いたら止める ===');
ok(W.MW_RST_FAIL_STOP===5,'★5件続いたら止める');
['B00RST0000','B00RST0001','B00RST0002','B00RST0003'].forEach((a)=>{ rst[a]=400; });
/* 6件以上を対象にする */
const MORE=['4902370550468','4902370550469','4902370550470','4902370550471'];
for(let i=0;i<MORE.length;i++){
  await post('/mw/stock',{ at:'2026-11-04T00:00:00Z', part:1, parts:1,
    rows:[row(MORE[i])] });
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,basis,new_n,amz,checked_at,created_at)
     VALUES (?1,?2,'x',1000,'カート',2,0,'x','x')`)
    .bind(MORE[i],'B00RSTX'+String(i).padStart(3,'0')).run();
  rst['B00RSTX'+String(i).padStart(3,'0')]=400;
}
await env.DB.prepare("DELETE FROM mw_restrict").run();
calls=[];
r=await post('/mw/restrict',{ kishu:'NS', stock_min:5 });
let nc2=calls.filter((u)=>/restrictions/.test(u)).length;
console.log('   '+JSON.stringify({asked:r.body.asked,done:r.body.done,
  failed:r.body.failed,stopped:r.body.stopped,calls:nc2,
  why:String(r.body.why||'').slice(0,50)}));
ok(r.body.asked>=8,'★対象は8件以上ある');
ok(r.body.stopped==='fail','★★★失敗が続いたら止める');
ok(nc2===5,'★★★5回で止める（残りは呼ばない）');
ok(/失敗が5件続いたので止めました/.test(String(r.body.why||'')),
   '★★★止めた理由を返す');
ok(/HTTP 400/.test(String(r.body.why||'')),'★★理由に HTTP の番号を入れる');
ok(r.body.left>0,'★残りの件数も返す');
/* 1件でも通れば数え直す（たまたま1件失敗しただけで止めない） */
rst['B00RST0000']={restrictions:[]};
await env.DB.prepare("DELETE FROM mw_restrict").run();
calls=[];
r=await post('/mw/restrict',{ kishu:'NS', stock_min:5 });
console.log('   '+JSON.stringify({done:r.body.done,ok_n:r.body.ok_n,
  failed:r.body.failed,stopped:r.body.stopped}));
ok(r.body.ok_n===1,'★★通る1件は取れる');
ok(r.body.failed>=5&&r.body.stopped==='fail',
   '★★★通ったあとに続けて5件失敗すれば止める');

console.log('\n=== 呼び出しの間隔 ===');
ok(W.SP_KV_LANES&&!W.SP_KV_LANES.getListingsRestrictions,
   '★速い API なので KV の間隔は使わない');

await T.done();
