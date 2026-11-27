/* Worker：Shopify の通行証（アクセストークン）を取り直す（8.112・v363）

   カジの報告（2026-11-27）アプリに read_customers・write_customers を足して承認したのに、
   「タグを付け直す」が「Shopify の権限が足りません（read_customers）」のまま。
   pj-sync は鍵を Worker の変数に最長 約24時間持つので、権限を足す前の鍵を使い続けていた。
   ・⚙「Shopify の通行証を取り直す」（POST /shop/token/reset）で D1 に取り直した時刻を置き、
     どの Worker も前の鍵を捨てる
   ・権限が足りないと返ってきたら1回だけ取り直してやり直す（10分に1回まで） */
import fs from 'node:fs';
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：Shopify の通行証を取り直す（8.112）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('shoptoken');
const HOST='pj-test.myshopify.com';
/* Shopify：鍵を渡すたびに番号を変える。scopeNow が「いまアプリに付いている権限」。
   鍵ごとに、そのときの権限を覚える（前に取った鍵は前の権限のまま）。 */
let tokN=0, scopeNow='read_products,write_products', tokScope={}, gql=[], tags={};
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/\/admin\/oauth\/access_token/.test(url)){
    tokN++; const tk='shpat_'+tokN; tokScope[tk]=scopeNow;
    return new Response(JSON.stringify({access_token:tk,scope:scopeNow,expires_in:86399}),{status:200});
  }
  if(/\/admin\/api\/.*graphql/.test(url)){
    const tk=(o.headers||{})['x-shopify-access-token']; const b=JSON.parse(o.body); const v=b.variables||{};
    gql.push({ tk, q:b.query.slice(0,30) });
    if(!/read_customers/.test(tokScope[tk]||''))
      return new Response(JSON.stringify({errors:[{message:'Access denied for customer field. Required access: `read_customers` access scope.'}]}),{status:200});
    const c=String(v.id||'').replace(/\D/g,'');
    if(/tagsAdd/.test(b.query)){ tags[c]=[...new Set((tags[c]||[]).concat(v.tags))]; return new Response(JSON.stringify({data:{tagsAdd:{userErrors:[]}}}),{status:200}); }
    if(/tagsRemove/.test(b.query)){ tags[c]=(tags[c]||[]).filter((t)=>v.tags.indexOf(t)<0); return new Response(JSON.stringify({data:{tagsRemove:{userErrors:[]}}}),{status:200}); }
    return new Response(JSON.stringify({data:{customer:{id:v.id,tags:tags[c]||[]}}}),{status:200});
  }
  return new Response('{}',{status:200});
};
const env0=(x)=>makeEnv(Object.assign({ STAFF_KEY:'staff-key-123', SHOPIFY_CLIENT_ID:'cid', SHOPIFY_CLIENT_SECRET:'csec-SECRET' },x||{}));
const setCfg=(env,o)=>env.DB.prepare(`INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
  ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(), settings:Object.assign({ memOn:true, subShopAdmin:HOST },o||{}) }),
    new Date().toISOString()).run();
const api=async(env,path,body,key)=>{ const h={'X-PJ-Key':key||'k','content-type':'application/json'};
  return await asJson(await worker.fetch(new Request('https://x'+path,body?{method:'POST',headers:h,body:JSON.stringify(body)}:{headers:h}),env,{})); };
const C='7777004371';

console.log('=== ① 権限を足す前の鍵を使い続けていた（今回の不具合）===');
const env=env0(); await setCfg(env);
await env.DB.prepare(`INSERT INTO mem (cust,plan,paid_to,state,mon_from,at,created_at) VALUES (?1,'monitor',?2,'active',?3,?3,?3)`)
  .bind(C,new Date(Date.now()+10*86400000).toISOString(),new Date().toISOString()).run();
W.shopReset(); W.SHOP_MEM.denyAt=Date.now();          // 自動のやり直しを使わずに、前の動きを見る
let r=await api(env,'/mem/tags',{ cust:C });
ok(r.body.ok===false&&/read_customers/.test(r.body.detail),'★権限が無い鍵では「権限が足りません（read_customers）」');
scopeNow='read_products,write_products,read_customers,write_customers';   // アプリに権限を足した
r=await api(env,'/mem/tags',{ cust:C });
ok(r.body.ok===false&&tokN===1,'★★★取り直さないと、権限を足しても前の鍵のまま（今回の不具合）');

console.log('\n=== ② ⚙「Shopify の通行証を取り直す」===');
const st=await api(env,'/shop/token/reset',{},'staff-key-123');
ok(st.status===403,'★★管理者だけ');
const rs=await api(env,'/shop/token/reset',{});
console.log('   '+JSON.stringify(rs.body));
ok(rs.body.ok&&tokN===2,'★★★押すと鍵を捨てて取り直す');
ok(rs.body.scopes.includes('read_customers')&&rs.body.scopes.includes('write_customers')&&rs.body.customers.length===0,
   '★★★新しい鍵の権限の名前を返す（会員のタグに要る権限がそろっている）');
ok(!JSON.stringify(rs.body).includes('shpat_'),'★★★鍵の値は返さない');
const g=await env.DB.prepare(`SELECT v FROM sync_state WHERE k='shop.token.reset'`).first();
ok(!!g&&g.v===rs.body.at,'★★取り直した時刻を D1 に置く（ほかの Worker も前の鍵を捨てる）');
r=await api(env,'/mem/tags',{ cust:C });
ok(r.body.ok===true&&(tags[C]||[]).includes('member-list')&&(tags[C]||[]).includes('grade-monitor'),
   '★★★取り直したあとは「タグを付け直す」が通る（…4371）');

console.log('\n=== ③ ほかの Worker が前の鍵を持っていても捨てる ===');
W.SHOP_MEM.token='shpat_old'; W.SHOP_MEM.gotAt=Date.parse(rs.body.at)-1000; W.SHOP_MEM.exp=Date.now()+3600000;
W.SHOP_MEM.host=HOST; W.SHOP_MEM.genAt=0;   // 1分に1回 D1 を見る
const n0=tokN;
await api(env,'/mem/tags',{ cust:C });
ok(tokN===n0+1&&gql.slice(-1)[0].tk!=='shpat_old','★★★取り直した時刻より前に取った鍵は使わない（D1 の印を見る）');

console.log('\n=== ④ 権限が足りないと返ってきたら1回だけ取り直してやり直す ===');
const env2=env0(); await setCfg(env2);
await env2.DB.prepare(`INSERT INTO mem (cust,plan,paid_to,state,mon_from,at,created_at) VALUES (?1,'monitor',?2,'active',?3,?3,?3)`)
  .bind('7777000001',new Date(Date.now()+10*86400000).toISOString(),new Date().toISOString()).run();
W.shopReset(); W.SHOP_MEM.denyAt=0; scopeNow='read_products';
await W.shopToken(env2,W.newRun('t'),HOST);            // 権限の無い鍵を持っている
scopeNow='read_products,read_customers,write_customers';
const n1=tokN;
r=await api(env2,'/mem/tags',{ cust:'7777000001' });
ok(r.body.ok===true&&tokN===n1+1,'★★★権限が足りないと返ってきたら、自動で1回だけ取り直して通す');
/* 本当に権限が無いときは、何度も取り直さない（10分に1回まで） */
W.shopReset(); scopeNow='read_products'; W.SHOP_MEM.denyAt=0;
const n2=tokN;
await api(env2,'/mem/tags',{ cust:'7777000001' });
await api(env2,'/mem/tags',{ cust:'7777000001' });
ok(tokN-n2===2,'★★本当に権限が無いときは、取り直しは10分に1回まで（'+(tokN-n2)+'回）');

console.log('\n=== ⑤ 固定の鍵・鍵が無い ===');
const e3=env0({ SHOPIFY_ADMIN_TOKEN:'shpat_fixed' }); await setCfg(e3);
const f=await api(e3,'/shop/token/reset',{});
ok(f.body.ok===false&&f.body.error==='fixed'&&/SHOPIFY_ADMIN_TOKEN/.test(f.body.detail),'★★固定の鍵（SHOPIFY_ADMIN_TOKEN）のときは取り直せないと言う');
const e4=makeEnv(); await setCfg(e4);
const nk=await api(e4,'/shop/token/reset',{});
ok(nk.body.ok===false&&nk.body.error==='no_key','★鍵が無いときはそう言う');
const src=fs.readFileSync(new URL('../proxy-sync/worker.js',import.meta.url),'utf8');
ok(!/notes\.push\([^)]*tk\.token|console\.log\([^)]*token/.test(src),'★鍵をログに出さない');
T.done();
