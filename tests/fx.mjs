/* Worker：為替レート（7.50）
   ・pj_price と同じ2つの公開APIから Worker 自身が取る（許可表は読み取りだけ）
   ・取れた値は KV に控え、6時間のうちは取り直さない（?force=1 で取り直す）
   ・1つめが落ちたら2つめを使う
   ・範囲外（50〜500円の外）の応答は捨てる
   ・どちらも取れなければ 古い控え → ⚙設定の fx → 既定160 の順
   ・GET /fx が返す／GET /status にも控えを出す（/status は外へ問い合わせない） */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：為替レート');
const ok=T.ok;
const { worker, T:W }=await loadWorker('fx');
const env=makeEnv();

let hits=[], erApi=null, frank=null;
globalThis.fetch=async(u)=>{
  const url=String(u);
  hits.push(url);
  if(/open\.er-api\.com/.test(url)){
    if(erApi===null)return new Response('ng',{status:500});
    return new Response(JSON.stringify(erApi),
      {status:200,headers:{'content-type':'application/json'}});
  }
  if(/api\.frankfurter\.app/.test(url)){
    if(frank===null)return new Response('ng',{status:500});
    return new Response(JSON.stringify(frank),
      {status:200,headers:{'content-type':'application/json'}});
  }
  throw new Error('想定外の通信: '+url);
};
const fx=async(q)=>(await asJson(await worker.fetch(get('/fx'+(q||'')),env))).body;
const clear=async()=>{ env.SYNC_CACHE._m.delete('fx.usdjpy'); };

console.log('=== 書き込みの見張り（増えたのは読み取りだけ）===');
const guard=(m,u)=>{ try{ W.assertReadOnly(u,m,{},false); return 'ok'; }
                     catch(e){ return e.message.split(' ')[0]; } };
console.log('   GET  open.er-api.com : '+guard('GET','https://open.er-api.com/v6/latest/USD'));
console.log('   POST open.er-api.com : '+guard('POST','https://open.er-api.com/v6/latest/USD'));
ok(guard('GET','https://open.er-api.com/v6/latest/USD')==='ok','★1つめは読み取りで通る');
ok(guard('GET','https://api.frankfurter.app/latest?from=USD&to=JPY')==='ok',
   '★2つめも通る');
ok(guard('POST','https://open.er-api.com/v6/latest/USD')==='blocked_by_readonly_guard',
   '★★POST は通さない');
ok(guard('GET','https://open.er-api.com/v6/latest/EUR')==='blocked_by_readonly_guard',
   '★★ほかの通貨・ほかのパスは通さない');

console.log('\n=== 1つめから取る ===');
await clear(); hits=[];
erApi={ result:'success', time_last_update_unix:1760000000, rates:{ JPY:157.23 } };
frank={ amount:1, base:'USD', date:'2026-10-19', rates:{ JPY:999 } };
let r=await fx();
console.log('   '+JSON.stringify(r));
ok(r.rate===157.23&&r.from==='api','★★1つめの値を使う');
ok(/open\.er-api/.test(r.src),'★どこから取ったかを返す');
ok(hits.length===1,'★★2つめは呼ばない');
ok(/^2025-10-09/.test(String(r.at)),'★相手が返した時刻を持つ');

console.log('\n=== 控えを使う（6時間）===');
hits=[];
r=await fx();
console.log('   '+JSON.stringify(r));
ok(r.rate===157.23&&r.from==='cache','★★控えから返す');
ok(hits.length===0,'★★外へ問い合わせない');
// force を付けると取り直す
hits=[]; erApi.rates.JPY=158.10;
r=await fx('?force=1');
ok(r.rate===158.10&&r.from==='api'&&hits.length===1,'★★?force=1 で取り直す');

console.log('\n=== 控えが古ければ取り直す ===');
await env.SYNC_CACHE.put('fx.usdjpy',JSON.stringify({ rate:150, at:'2026-10-18T00:00:00Z',
  src:'x', got_at:new Date(Date.now()-W.FX_TTL_MS-60000).toISOString() }));
hits=[]; erApi.rates.JPY=159.44;
r=await fx();
console.log('   '+JSON.stringify(r));
ok(r.rate===159.44&&r.from==='api'&&hits.length===1,'★★6時間を過ぎたら取り直す');
ok(W.FX_TTL_MS===6*60*60*1000,'★控えの寿命は6時間');

console.log('\n=== 1つめが落ちたら2つめ ===');
await clear(); hits=[];
erApi=null;
frank={ amount:1, base:'USD', date:'2026-10-19', rates:{ JPY:161.05 } };
r=await fx();
console.log('   '+JSON.stringify(r)+' / 呼んだ先 '+hits.length+'件');
ok(r.rate===161.05&&r.from==='api','★★2つめの値を使う');
ok(/frankfurter/.test(r.src)&&hits.length===2,'★両方を順に呼ぶ');
ok(String(r.at).indexOf('2026-10-19')===0,'★日付を時刻に直して持つ');

console.log('\n=== おかしい応答は捨てる ===');
await clear(); hits=[];
erApi={ result:'success', rates:{ JPY:3 } };          // 範囲外（50円未満）
frank={ rates:{ JPY:162.00 } };
r=await fx();
console.log('   '+JSON.stringify(r));
ok(r.rate===162.00&&/frankfurter/.test(r.src),'★★範囲外（50〜500円の外）は捨てる');
await clear();
erApi={ result:'success', rates:{} };                 // 値が無い
frank={ rates:{ JPY:163.00 } };
r=await fx();
ok(r.rate===163.00,'★★値が無い応答も捨てる');
ok(W.fxOk(49)===false&&W.fxOk(501)===false&&W.fxOk(160)===true,'★範囲の判定');

console.log('\n=== どちらも取れないとき ===');
// ① 古い控えがあればそれを使う
await env.SYNC_CACHE.put('fx.usdjpy',JSON.stringify({ rate:155.5,
  at:'2026-10-17T00:00:00Z', src:'old',
  got_at:new Date(Date.now()-3*24*60*60*1000).toISOString() }));
erApi=null; frank=null; hits=[];
r=await fx();
console.log('   古い控え: '+JSON.stringify(r));
ok(r.rate===155.5&&r.from==='stale','★★古い控えでも使う（無いよりまし）');
// ② 控えが無ければ ⚙設定の fx
await clear();
await worker.fetch(post('/settings',{at:new Date().toISOString(),
  settings:{ fx:'152.75', targetMode:'auto', baseProfit:'1000', linkRate:'30',
             saleRate:'15', usTaxRate:'8' }}),env);
r=await fx();
console.log('   設定の値: '+JSON.stringify(r));
ok(r.rate===152.75&&r.from==='settings','★★⚙設定の fx を使う');
ok(r.src==='ui.settings','★どこから採ったかを返す');
// ③ それも無ければ既定値
await clear();
await worker.fetch(post('/settings',{at:new Date(Date.now()+60000).toISOString(),
  settings:{ targetMode:'auto', baseProfit:'1000', linkRate:'30',
             saleRate:'15', usTaxRate:'8' }}),env);
r=await fx();
console.log('   既定値: '+JSON.stringify(r));
ok(r.rate===W.FX_DEFAULT&&r.from==='default','★★それも無ければ既定160');

console.log('\n=== /status は外へ問い合わせない ===');
await clear();
erApi={ result:'success', rates:{ JPY:164.00 } }; frank=null;
await fx();                                  // 控えを作る
hits=[];
let st=await asJson(await worker.fetch(get('/status?limit=5'),env));
console.log('   '+JSON.stringify(st.body.fx)+' / 呼んだ先 '+hits.length+'件');
ok(st.body.fx&&st.body.fx.rate===164.00,'★★/status に控えを出す');
ok(hits.length===0,'★★/status では取りに行かない（取り込みを遅くしない）');
await clear();
st=await asJson(await worker.fetch(get('/status?limit=5'),env));
ok(st.body.fx===null,'★控えが無ければ null');

console.log('\n=== /fx は作業者のキーでも読める（読み取りだけ）===');
await clear();
erApi={ result:'success', rates:{ JPY:165.00 } };
const env2=makeEnv({ STAFF_KEY:'staff-key-123' });
const staff=await asJson(await worker.fetch(new Request('https://x/fx',
  {headers:{'X-PJ-Key':'staff-key-123'}}),env2));
console.log('   '+JSON.stringify(staff.body));
ok(staff.status===200&&staff.body.rate===165.00,'★★作業者でも見られる');
const no=await worker.fetch(new Request('https://x/fx',
  {headers:{'X-PJ-Key':'bad'}}),env2);
ok(no.status===401,'★キーが違えば401');

await T.done();
