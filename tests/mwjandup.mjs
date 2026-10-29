/* Worker：JAN 1つに ASIN が複数あるとき（7.84）
   例：JAN 4573102666987 に「ウルトラマン」と「スター・ウォーズ」の2商品。
   ・候補が2件以上なら**自動で決めない**。jan_map に候補を控えて印を付ける
   ・ASIN は入れない（すでに入っていたら外す）。値段も取らない
   ・人が選んだ ASIN を jan_map（picked_at）と mw_amz に入れる
   ・候補にない ASIN は受けない
   ・決まるまでは呼び直さない（呼んでも決めようがないので、むだ打ちしない）
   ・ASIN はあるが候補をまだ控えていない行は、①の段で少しずつ引き直す */
import { harness, loadWorker, makeEnv, get, asJson } from './lib.mjs';
const T=harness('Worker：JAN重複');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwjandup');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs', LWA_REFRESH_TOKEN:'rt' });

let calls=[], cat={};
globalThis.fetch=async(u)=>{
  const url=String(u); calls.push(url);
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  if(/catalog\/2022-04-01\/items/.test(url)){
    const ids=new URL(url).searchParams.get('identifiers').split(',');
    const items=[];
    ids.forEach((j)=>{ (cat[j]||[]).forEach((x)=>items.push(x)); });
    return new Response(JSON.stringify({items}),{status:200});
  }
  if(/itemOffers/.test(url))
    return new Response(JSON.stringify({responses:[]}),{status:200});
  if(/feesEstimate/.test(url))
    return new Response(JSON.stringify({FeesEstimateResultList:[]}),{status:200});
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
const mk=(jan,asin,name)=>({ asin:asin,
  identifiers:[{ identifiers:[{ identifierType:'EAN', identifier:jan }] }],
  summaries:[{ itemName:name }],
  salesRanks:[{ classificationRanks:[{ title:'おもちゃ', rank:500 }] }] });
const row=(jan,x)=>Object.assign({jan:jan,sha:'M200',idx:0,kishu:'FIG',
  name:jan+'の商品',list_price:5000,release:'2025/01/01',cond:'新品',
  wholesale:3000,stock:9,note:'',ship_text:'即日出荷',ship_days:0},x||{});
const post=async(path,body,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
const stock=async(rows)=>post('/mw/stock',
  {at:'2026-11-06T00:00:00Z',part:1,parts:1,rows:rows});
const jm=async(jan)=>await env.DB.prepare(
  'SELECT * FROM jan_map WHERE jan=?1').bind(jan).first();
const am=async(jan)=>await env.DB.prepare(
  'SELECT * FROM mw_amz WHERE jan=?1').bind(jan).first();

const DUP='4573102666987', ONE='4580416924740';
console.log('=== 候補が2件以上なら自動で決めない ===');
await stock([row(DUP),row(ONE)]);
cat[DUP]=[mk(DUP,'B00ULTRA01','ウルトラマン ソフビ'),
          mk(DUP,'B00STARW01','スター・ウォーズ フィギュア')];
cat[ONE]=[mk(ONE,'B00ONLY001','ふつうの1件だけ')];
let r=await post('/mw/amz',{ kishu:'FIG', stock_min:5 });
console.log('   ①'+JSON.stringify(r.body.asin));
ok(r.body.asin.dup===1,'★★★JAN重複を1件数える');
ok(r.body.asin.ok_n===1,'★★重複でない1件は ASIN が入る');
let d=await jm(DUP);
console.log('   '+JSON.stringify({cand_n:d.cand_n,asin:d.asin,err:d.err}));
ok(d.cand_n===2,'★★★候補の件数を控える');
ok(!d.asin,'★★★重複のときは ASIN を入れない');
ok(/JAN重複/.test(String(d.err||'')),'★★理由を控える');
let cands=JSON.parse(d.cands||'[]');
console.log('   '+JSON.stringify(cands.map((x)=>x.asin)));
ok(cands.length===2&&cands.some((x)=>x.asin==='B00ULTRA01')
   &&cands.some((x)=>x.asin==='B00STARW01'),'★★★候補の ASIN を2件とも控える');
ok(cands.every((x)=>!!x.name),'★★候補の商品名も控える（近い順に並べるため）');
let a=await am(DUP);
ok(!a.asin&&/JAN重複/.test(String(a.err||'')),'★★★mw_amz にも印を残す');
ok(!a.price,'★★値段は取らない');
let one=await jm(ONE);
ok(one.asin==='B00ONLY001'&&one.cand_n===1,'★★1件だけの JAN は今までどおり');

console.log('\n=== 決まるまで呼び直さない（むだ打ちしない）===');
calls=[];
r=await post('/mw/amz',{ kishu:'FIG', stock_min:5 });
console.log('   '+JSON.stringify({asked:r.body.asin.asked,
  cat:calls.filter((u)=>/catalog/.test(u)).length}));
ok(r.body.asin.asked===0,'★★★重複の行は①の対象にしない');
ok(calls.filter((u)=>/catalog/.test(u)).length===0,'★★★Catalog を呼ばない');

console.log('\n=== 人が選ぶ ===');
r=await post('/mw/jan-pick',{ jan:DUP, asin:'B00STARW01' });
console.log('   '+JSON.stringify({ok:r.body.ok,asin:r.body.asin}));
ok(r.body.ok===true,'★★★選べる');
d=await jm(DUP);
ok(d.asin==='B00STARW01'&&!!d.picked_at&&d.picked_by==='hand',
   '★★★jan_map に選んだ ASIN と時刻を控える');
ok(!String(d.err||''),'★理由は消す');
a=await am(DUP);
console.log('   '+JSON.stringify({asin:a.asin,err:a.err,price_at:a.price_at}));
ok(a.asin==='B00STARW01','★★★mw_amz にも入る');
ok(!String(a.err||''),'★★印を消す');
ok(!a.price_at,'★★★値段の時刻を空にする（次の回で取るため）');

console.log('\n=== 候補にない ASIN は受けない ===');
r=await post('/mw/jan-pick',{ jan:DUP, asin:'B00NOCAND1' });
console.log('   '+JSON.stringify({ok:r.body.ok,why:r.body.why}));
ok(r.body.ok!==true&&/候補にない/.test(String(r.body.why||'')),
   '★★★候補にない ASIN は断る');
r=await post('/mw/jan-pick',{ jan:DUP, asin:'こわれたASIN' });
ok(r.body.ok!==true&&/形が違います/.test(String(r.body.why||'')),'★形の検査');
r=await post('/mw/jan-pick',{ jan:'123', asin:'B00STARW01' });
ok(r.body.ok!==true&&/13桁/.test(String(r.body.why||'')),'★JAN の検査');

console.log('\n=== 選んだあとは①が呼ばず、値段の対象になる ===');
calls=[];
r=await post('/mw/amz',{ kishu:'FIG', stock_min:5 });
console.log('   '+JSON.stringify({asin:r.body.asin.asked,price:r.body.price.asked}));
ok(r.body.asin.asked===0,'★★選んだ行は①の対象にしない（ASIN がある）');
ok(r.body.price.asked>=1,'★★★値段の対象になる');

console.log('\n=== ASIN はあるが候補をまだ控えていない行を引き直す ===');
/* v203 までに入った行は cand_at が NULL。少しずつ引き直す。 */
const OLD='4988611224878';
await stock([row(OLD)]);
await env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,checked_at,asin_at,price_at,created_at)
   VALUES (?1,'B00OLD0001','前からある行','x','x','x','x')`).bind(OLD).run();
cat[OLD]=[mk(OLD,'B00OLD0001','前からある行')];
let before=await jm(OLD);
ok(!before,'★控えがまだ無い');
calls=[];
r=await post('/mw/amz',{ kishu:'FIG', stock_min:5 });
console.log('   '+JSON.stringify({asked:r.body.asin.asked,ok_n:r.body.asin.ok_n}));
ok(r.body.asin.asked>=1,'★★★候補を控えていない行は①で引き直す');
let after=await jm(OLD);
ok(after&&after.cand_n===1&&!!after.cand_at,'★★★控えが入る');
/* 2回目は引き直さない */
calls=[];
r=await post('/mw/amz',{ kishu:'FIG', stock_min:5 });
ok(r.body.asin.asked===0,'★★一度控えれば呼び直さない');

console.log('\n=== 重複の一覧（要確認）===');
cat['4902370550467']=[mk('4902370550467','B00DUP0001','重複A'),
                      mk('4902370550467','B00DUP0002','重複B')];
await stock([row('4902370550467')]);
await post('/mw/amz',{ kishu:'FIG', stock_min:5 });
let g=(await asJson(await worker.fetch(get('/mw/jan-dup'),env))).body;
console.log('   '+JSON.stringify({n:g.n,checked:g.checked,rows:g.rows.length}));
ok(g.ok===true&&g.n===1,'★★★まだ選んでいない重複だけを数える');
ok(g.rows[0].jan==='4902370550467'&&g.rows[0].cands.length===2,
   '★★候補つきで返す');
ok(g.checked>=3,'★控えた件数も返す');

console.log('\n=== 作業者のキー ===');
r=await post('/mw/jan-pick',{ jan:DUP, asin:'B00STARW01' },'staff-key-123');
ok(r.status===403,'★★作業者では決められない（仕入れの判断に直結する）');

await T.done();
