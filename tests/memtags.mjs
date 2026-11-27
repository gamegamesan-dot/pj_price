/* Worker：会員の Shopify の顧客タグ（8.110・v361）

   カジの報告（2026-11-27）モニター1人目を⚙「手でつなぐ」でモニター登録した。Discord のロールは
   付いたが、Shopify の顧客にタグが無く、会員品のページが「会員専用のページです」になった。
   管理画面で member-list と grade-monitor を手で付けたら見えた。
   ・手でつなぐ → member-list と grade-<プラン> を付ける（tagsAdd）
   ・プランを変えたら古い grade- を外して新しいものを付ける
   ・期限切れ・解約・つなぎを外したら member-list と grade- を外す（毎時の見回りと同じ）
   ・支払いの注文（有料プラン）で会員になったときも付ける
   ・一覧に「Shopify のタグ：あり／なし」・「タグを付け直す」
   ・権限が足りないときはそう出す（read_customers・write_customers） */
import fs from 'node:fs';
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：会員の Shopify の顧客タグ（8.110）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('memtags');
const GUILD='555000555', RL='9001', RS='9002', RP='9003', RM='9000';
const VL='15523683434661', VS='15523683434662', VP='15523683434663';
const SECRET='shpss-test-secret';
const HOST='pj-test.myshopify.com';
const env0=(x)=>makeEnv(Object.assign({ DISCORD_BOT_TOKEN:'bot-token-xyz', SHOPIFY_WEBHOOK_SECRET:SECRET,
  SHOPIFY_CLIENT_ID:'cid', SHOPIFY_CLIENT_SECRET:'csec-SECRET' },x||{}));
/* Shopify：顧客のタグを覚えておく（tagsAdd／tagsRemove をまねる）。 */
let shopTags={}, shopCalls=[], shopDeny='', dcRoles={};
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{}, m=String(o.method||'GET');
  if(/discord\.com\/api/.test(url)){
    const g=/\/guilds\/(\d+)\/members\/(\d+)(?:\/roles\/(\d+))?$/.exec(url);
    if(g){ const who=g[2], role=g[3]||'';
      if(dcRoles[who]===undefined)return new Response(JSON.stringify({code:10007}),{status:404});
      if(m==='GET')return new Response(JSON.stringify({user:{id:who},roles:dcRoles[who]}),{status:200});
      if(m==='PUT'){ if(dcRoles[who].indexOf(role)<0)dcRoles[who].push(role); return new Response(null,{status:204}); }
      if(m==='DELETE'){ dcRoles[who]=dcRoles[who].filter((x)=>x!==role); return new Response(null,{status:204}); } }
    return new Response('{}',{status:200});
  }
  if(/myshopify\.com\/admin\/oauth\/access_token/.test(url))
    return new Response(JSON.stringify({access_token:'shpat_x',scope:'read_customers,write_customers',expires_in:86399}),{status:200});
  if(/myshopify\.com\/admin\/api\/.*graphql/.test(url)){
    const b=JSON.parse(o.body), v=b.variables||{};
    const cust=String(v.id||'').replace(/\D/g,'');
    shopCalls.push({ q:/tagsAdd/.test(b.query)?'add':(/tagsRemove/.test(b.query)?'del':'get'), cust, tags:v.tags||[] });
    if(shopDeny)return new Response(JSON.stringify({ errors:[{ message:shopDeny }] }),{status:200});
    if(/tagsAdd/.test(b.query)){ shopTags[cust]=[...new Set((shopTags[cust]||[]).concat(v.tags))];
      return new Response(JSON.stringify({data:{tagsAdd:{userErrors:[]}}}),{status:200}); }
    if(/tagsRemove/.test(b.query)){ shopTags[cust]=(shopTags[cust]||[]).filter((t)=>v.tags.indexOf(t)<0);
      return new Response(JSON.stringify({data:{tagsRemove:{userErrors:[]}}}),{status:200}); }
    if(/customer\(id/.test(b.query))
      return new Response(JSON.stringify({data:{customer:shopTags[cust]===undefined?null:{id:v.id,tags:shopTags[cust]}}}),{status:200});
  }
  return new Response('{}',{status:200});
};
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ memOn:true, memGuild:GUILD, memRoleMonitor:RM, memRoleLight:RL,
      memRoleStandard:RS, memRolePremium:RP, memVarLight:VL, memVarStandard:VS, memVarPremium:VP,
      subShopAdmin:HOST },o||{}) }), new Date().toISOString()).run();
const api=async(env,path,body)=>(await asJson(await worker.fetch(body?post(path,body):get(path),env,{}))).body;
const hmac=async(raw)=>{
  const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const mac=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(raw));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
};
const hook=async(env,body)=>{ const raw=JSON.stringify(body);
  return await asJson(await worker.fetch(new Request('https://x/mem/hook',{method:'POST',
    headers:{'content-type':'application/json','X-Shopify-Topic':'orders/paid','X-Shopify-Hmac-Sha256':await hmac(raw)},body:raw}),env,{})); };
const row=async(env,c)=>await env.DB.prepare(`SELECT * FROM mem WHERE cust=?1`).bind(c).first();
const C1='8800000001', C2='8800000002', C3='8800000003';

console.log('=== ① 手でつなぐ（モニター）でタグを付ける ===');
let env=env0(); await setCfg(env);
shopTags[C1]=['Login with Shop','Shop']; dcRoles['111']=[];
let r=await api(env,'/mem/link',{ cust:C1, dc:'111', plan:'monitor' });
console.log('   '+JSON.stringify(shopTags[C1])+' '+JSON.stringify(((r.sync||{}).rows||[])[0]?.tags||{}));
ok(shopTags[C1].includes('member-list')&&shopTags[C1].includes('grade-monitor'),
   '★★★手でつなぐと Shopify の顧客に member-list と grade-monitor を付ける（今回の不具合）');
ok(shopTags[C1].includes('Login with Shop')&&shopTags[C1].includes('Shop'),'★★ほかのタグは触らない');
ok(dcRoles['111'].includes(RM),'★Discord のロールも今までどおり付く');
let x=await row(env,C1);
ok(x.shop_tags==='grade-monitor,member-list'&&!!x.shop_tag_at&&!x.shop_tag_err,'★★付けたタグを控える');
ok(shopCalls.filter((c)=>c.cust===C1&&c.q==='add').length===1,'★tagsAdd で付ける');

console.log('\n=== ② プランを変えたら古い grade- を外す ===');
r=await api(env,'/mem/link',{ cust:C1, dc:'111', plan:'standard' });
await env.DB.prepare(`UPDATE mem SET paid_to=? WHERE cust=?`).bind(new Date(Date.now()+20*86400000).toISOString(),C1).run();
await api(env,'/mem/sync',{ cust:C1 });
console.log('   '+JSON.stringify(shopTags[C1]));
ok(shopTags[C1].includes('grade-standard')&&!shopTags[C1].includes('grade-monitor')&&shopTags[C1].includes('member-list'),
   '★★★プランを変えたら grade-monitor を外して grade-standard を付ける');

console.log('\n=== ③ 解約・期限切れ・つなぎを外したら外す ===');
await api(env,'/mem/state',{ cust:C1, state:'canceled' });
ok(!shopTags[C1].includes('member-list')&&!shopTags[C1].some((t)=>/^grade-/.test(t))&&shopTags[C1].includes('Shop'),
   '★★★解約にしたら member-list と grade- を外す（ほかのタグは残す）');
/* 期限切れ（毎時の見回り） */
shopTags[C2]=[]; dcRoles['222']=[];
await api(env,'/mem/link',{ cust:C2, dc:'222', plan:'light' });
await env.DB.prepare(`UPDATE mem SET paid_to=? WHERE cust=?`).bind(new Date(Date.now()+5*86400000).toISOString(),C2).run();
await api(env,'/mem/sync',{ cust:C2 });
ok(shopTags[C2].includes('grade-light')&&shopTags[C2].includes('member-list'),'★ライトの会員に grade-light');
await env.DB.prepare(`UPDATE mem SET paid_to=? WHERE cust=?`).bind(new Date(Date.now()-10*86400000).toISOString(),C2).run();
const calls0=shopCalls.length;
let job=await W.jobMemSync(env,{});
ok(!shopTags[C2].includes('member-list')&&!shopTags[C2].includes('grade-light'),
   '★★★期限＋猶予を過ぎたら毎時の見回りで外す（Discord のロールと同じとき）');
ok(!dcRoles['222'].includes(RL),'★ロールも外れる');
/* 控えが合っていて24時間以内なら、見回りで Shopify に聞き直さない */
const calls1=shopCalls.length;
await W.jobMemSync(env,{});
ok(shopCalls.length===calls1,'★★控えが合っていれば毎時の見回りで Shopify を呼ばない（24時間に1回だけ確かめる）');
/* つなぎを外す */
shopTags[C3]=[]; dcRoles['333']=[];
await api(env,'/mem/link',{ cust:C3, dc:'333', plan:'monitor' });
ok(shopTags[C3].includes('grade-monitor'),'★モニターに grade-monitor');
await api(env,'/mem/unlink',{ cust:C3 });
x=await row(env,C3);
ok(!shopTags[C3].includes('member-list')&&!shopTags[C3].includes('grade-monitor')&&x.shop_tag_off===1,
   '★★★つなぎを外したら member-list と grade- を外す');
await W.jobMemSync(env,{});
ok(!shopTags[C3].includes('member-list'),'★★つなぎを外した会員には、毎時の見回りでも付け直さない');
/* つなぎを外すと状態は「解約」になる（今までどおり）。つなぎ直して「有効に戻す」でまた付く */
await api(env,'/mem/link',{ cust:C3, dc:'333', plan:'monitor' });
ok((await row(env,C3)).shop_tag_off===0,'★つなぎ直したら「付けない」の印を戻す');
await api(env,'/mem/state',{ cust:C3, state:'active' });
ok(shopTags[C3].includes('member-list')&&shopTags[C3].includes('grade-monitor'),'★★つなぎ直して「有効に戻す」でまた付く（ロールと同じ）');

console.log('\n=== ④ 支払いの注文（有料プラン）で会員になったとき ===');
const C4='8800000004'; shopTags[C4]=['Shop'];
const h=await hook(env,{ id:'7001', created_at:new Date().toISOString(), customer:{ id:C4 },
  line_items:[{ variant_id:VP, price:'9800', quantity:1, selling_plan_id:'991' }] });
console.log('   '+JSON.stringify(shopTags[C4]));
ok(h.status===200&&shopTags[C4].includes('member-list')&&shopTags[C4].includes('grade-premium'),
   '★★★支払いの注文で会員になったら（Discord とつないでいなくても）タグを付ける');

console.log('\n=== ⑤ 一覧の「Shopify のタグ」と付け直す ===');
let l=await api(env,'/mem');
const l1=l.rows.find((z)=>z.cust===C3), l4=l.rows.find((z)=>z.cust===C4);
ok(l.shop===true&&l.tag_cols===true,'★一覧に「タグを付けられるか」を出す');
ok(l4.tag_ok===true&&l4.shop_tags==='grade-premium,member-list','★★★合っている会員は「あり」');
/* Shopify の画面で手で外された（ずれ） */
shopTags[C4]=['Shop'];
const fx=await api(env,'/mem/tags',{ cust:C4 });
ok(fx.ok&&shopTags[C4].includes('member-list')&&shopTags[C4].includes('grade-premium'),'★★★「タグを付け直す」でずれを直す（Shopify に聞き直す）');
/* 控えと付けるべきタグがずれている行は tag_ok=false */
await env.DB.prepare(`UPDATE mem SET shop_tags='' WHERE cust=?`).bind(C4).run();
l=await api(env,'/mem');
ok(l.rows.find((z)=>z.cust===C4).tag_ok===false,'★★ずれている会員は「なし／ずれ」になる');
ok(!JSON.stringify(l).match(/@|email|address/i),'★氏名・メールは持たない');

console.log('\n=== ⑥ 権限が足りない・顧客がいない・宛先が無い ===');
shopDeny='Access denied for customer field. Required access: `read_customers` access scope.';
const dn=await api(env,'/mem/tags',{ cust:C4 });
console.log('   '+dn.detail);
ok(!dn.ok&&/権限が足りません/.test(dn.detail)&&/read_customers/.test(dn.detail),'★★★権限が足りないときは足りない権限の名前を出す');
ok(/権限が足りません/.test((await row(env,C4)).shop_tag_err),'★理由を控える（一覧に出す）');
shopDeny='This app is not approved to access the Customer object. See protected customer data.';
const dn2=await api(env,'/mem/tags',{ cust:C4 });
ok(/保護された顧客データ/.test(dn2.detail),'★★「保護された顧客データ」の許可が無いときはそう出す');
shopDeny='';
const C5='8800000005';
await api(env,'/mem/link',{ cust:C5, plan:'monitor' });
const nf=await api(env,'/mem/tags',{ cust:C5 });
ok(!nf.ok&&/顧客がいません/.test(nf.detail),'★Shopify に顧客がいなければそう出す');
const env2=env0(); await setCfg(env2,{ subShopAdmin:'' });
shopTags['8800000006']=[];
await api(env2,'/mem/link',{ cust:'8800000006', plan:'monitor' });
const nh=await api(env2,'/mem/tags',{ cust:'8800000006' });
ok(!nh.ok&&/管理用ドメイン/.test(nh.detail),'★⚙の管理用ドメインが無ければそう出す');

console.log('\n=== ⑦ D1 の作り・触るタグ ===');
const mig=fs.readFileSync(new URL('../proxy-sync/migrate-0076-mem-tags.sql',import.meta.url),'utf8');
ok(/ALTER TABLE mem ADD COLUMN shop_tags/.test(mig)&&!/DROP|DELETE|UPDATE/i.test(mig.replace(/--.*$/gm,'')),'★★列を足すだけ');
ok(W.schemaFixOf('shop_tags')==='migrate-0076-mem-tags.sql','★列が無いときに流すマイグレーション');
const src=fs.readFileSync(new URL('../proxy-sync/worker.js',import.meta.url),'utf8');
ok(/MEM_TAG_RE = \/\^grade-\(monitor\|light\|standard\|premium\)\$\//.test(src),'★★触るのは member-list と grade-<4つのプラン> だけ');
ok(/customer\(id: \$id\) \{ id tags \}/.test(src),'★★Shopify から読むのは顧客の番号とタグだけ（氏名・メールは読まない）');
T.done();
