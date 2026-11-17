/* Worker：会員の月額課金と Discord のロール（8.56・カジの依頼）

   ・pj からは定期購入（subscription contract）を読めないので、
     **支払いの注文（orders/paid）**だけを見て期限を延ばす
   ・つなぎはカジが⚙で**手で**（カジの決定C）
   ・毎時の見回りで「期限＋猶予」を過ぎた会員のロールを外す（追い出さない）
   ・積み上げ：上のプランには下のロールも付ける（モニターは別）
   ・触るのは⚙に入れた4つのロールだけ
   ・残すのは 会員番号・Discord の番号・プラン・期限・状態だけ
     （氏名・住所・メールは残さない） */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：会員の月額課金とロール（8.56）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mem');

const GUILD='555000555', RL='9001', RS='9002', RP='9003', RM='9000';
const VL='15523683434661', VS='15523683434662', VP='15523683434663';
const SECRET='shpss-test-secret';
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz', SHOPIFY_WEBHOOK_SECRET:SECRET });
/* Discord：メンバーのロールを覚えておく（付け外しをまねる）。 */
let dcRoles={}, dcCalls=[], dcFail=0;
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{}, m=String(o.method||'GET');
  if(/discord\.com\/api/.test(url)){
    const g=/\/guilds\/(\d+)\/members\/(\d+)(?:\/roles\/(\d+))?$/.exec(url);
    if(g){
      const who=g[2], role=g[3]||'';
      dcCalls.push({ m:m, who:who, role:role });
      if(dcRoles[who]===undefined)
        return new Response(JSON.stringify({ code:10007,
          message:'Unknown Member' }),{status:404,
          headers:{'content-type':'application/json'}});
      if(dcFail&&role)
        return new Response(JSON.stringify({ code:50013,
          message:'Missing Permissions' }),{status:403,
          headers:{'content-type':'application/json'}});
      if(m==='GET')
        return new Response(JSON.stringify({ user:{ id:who },
          roles:dcRoles[who] }),{status:200,
          headers:{'content-type':'application/json'}});
      if(m==='PUT'){
        if(dcRoles[who].indexOf(role)<0)dcRoles[who].push(role);
        return new Response(null,{status:204});
      }
      if(m==='DELETE'){
        dcRoles[who]=dcRoles[who].filter((x)=>x!==role);
        return new Response(null,{status:204});
      }
    }
    return new Response('{}',{status:200});
  }
  return new Response('{}',{status:200});
};
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ memOn:true, memGuild:GUILD,
      memRoleMonitor:RM, memRoleLight:RL, memRoleStandard:RS,
      memRolePremium:RP,
      memVarLight:VL, memVarStandard:VS, memVarPremium:VP },o||{}) }),
    new Date().toISOString()).run();
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
/* Shopify の webhook（署名つき）。 */
const hmac=async(raw)=>{
  const k=await crypto.subtle.importKey('raw',
    new TextEncoder().encode(SECRET),{ name:'HMAC', hash:'SHA-256' },
    false,['sign']);
  const mac=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(raw));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
};
const order=(o)=>Object.assign({ id:'5001', created_at:'2026-11-17T00:00:00Z',
  customer:{ id:'7777000001' },
  line_items:[{ variant_id:VL, price:'2980', quantity:1,
                selling_plan_id:'991' }] },o||{});
const hook=async(env,body,o)=>{
  const raw=JSON.stringify(body);
  const sig=(o||{}).sig===undefined?await hmac(raw):(o||{}).sig;
  const req=new Request('https://x/mem/hook',{ method:'POST',
    headers:{ 'content-type':'application/json',
      'X-Shopify-Topic':(o||{}).topic||'orders/paid',
      'X-Shopify-Hmac-Sha256':sig }, body:raw });
  return await asJson(await worker.fetch(req,env,{}));
};
const row=async(env,cust)=>await env.DB.prepare(
  `SELECT * FROM mem WHERE cust=?1`).bind(cust).first();

console.log('=== ① 署名を確かめる（鍵は見ない口）===');
let env=env0();
{
  await setCfg(env,{});
  const bad=await hook(env,order(),{ sig:'ZZZZ' });
  ok(bad.status===401&&bad.body.error==='bad_signature',
     '★★★署名が合わなければ 401（鍵は要らないが署名は要る）');
  const none=await hook(env,order(),{ sig:'' });
  ok(none.status===401,'★★★署名が無ければ 401');
  const other=await hook(env,order(),{ topic:'products/update' });
  ok(other.status===200&&other.body.skip==='products/update',
     '★★ほかの題（topic）は数えない');
}

console.log('\n=== ② 支払いの注文で期限を1か月延ばす ===');
{
  const r=await hook(env,order());
  console.log('   '+JSON.stringify(r.body));
  ok(r.status===200&&r.body.ok===true&&r.body.plan==='light',
     '★★★バリアントの番号でプランが分かる（ライト）');
  const a=await row(env,'7777000001');
  console.log('   '+JSON.stringify({ plan:a.plan, paid_to:a.paid_to,
    state:a.state, last:a.last_order }));
  ok(String(a.paid_to||'').slice(0,10)==='2026-12-17',
     '★★★期限は1か月あと（2026-11-17 → 2026-12-17）');
  ok(a.state==='active','★★状態は「有効」');
  /* 同じ注文をもう一度（Shopify は再送することがある）。 */
  const r2=await hook(env,order());
  const b=await row(env,'7777000001');
  ok(r2.body.same===true&&b.paid_to===a.paid_to,
     '★★★同じ注文が2回来ても二重に延ばさない');
  /* 次の月の注文（番号が違う）。 */
  await hook(env,order({ id:'5002', created_at:'2026-12-17T00:00:00Z' }));
  const c=await row(env,'7777000001');
  console.log('   2か月め '+c.paid_to);
  ok(String(c.paid_to||'').slice(0,10)==='2027-01-17',
     '★★★次の支払いでまた1か月延びる');
  /* プランが上がった注文（バリアントが違う）。 */
  await hook(env,order({ id:'5003', created_at:'2027-01-17T00:00:00Z',
    line_items:[{ variant_id:VP, price:'9800', quantity:1,
                  selling_plan_id:'993' }] }));
  const d=await row(env,'7777000001');
  ok(d.plan==='premium','★★★バリアントが変わればプランも変わる');
  /* 会員の注文ではない注文（定期購入の行が無い）。 */
  const z=await hook(env,order({ id:'5009',
    customer:{ id:'7777000009' },
    line_items:[{ variant_id:'111', price:'3645', quantity:1 }] }));
  ok(z.body.ok===true&&!z.body.plan&&!(await row(env,'7777000009')),
     '★★★会員の注文でなければ何もしない（当てずっぽうで延ばさない）');
}

console.log('\n=== ③ 手でつなぐ（カジの決定C）===');
{
  dcRoles={ '111222333':[] }; dcCalls=[];
  const r=await api(env,'/mem/link',{ cust:'7777000001', dc:'111222333',
    dc_name:'kaji#0001' });
  console.log('   '+JSON.stringify({ ok:r.ok, add:(r.sync||{}).add,
    roles:dcRoles['111222333'] }));
  ok(r.ok===true,'★★★会員番号と Discord の番号を手で結べる');
  ok(dcRoles['111222333'].indexOf(RP)>=0,'★★★つないだらロールが付く');
  ok(dcRoles['111222333'].indexOf(RL)>=0
     &&dcRoles['111222333'].indexOf(RS)>=0,
     '★★★積み上げ：プレミアムには下のロール（ライト・スタンダード）も付く');
  ok(dcRoles['111222333'].indexOf(RM)<0,
     '★★★モニターのロールは付けない（お試しは別）');
  ok(dcCalls.filter((x)=>x.m==='DELETE').length===0,
     '★★外す呼び出しはしていない');
}

console.log('\n=== ④ 期限＋猶予を過ぎたらロールを外す（追い出さない）===');
{
  /* 期限を2日前にする（猶予3日なので、まだ外さない）。 */
  await env.DB.prepare(`UPDATE mem SET paid_to=?1 WHERE cust='7777000001'`)
    .bind(new Date(Date.now()-2*86400000).toISOString()).run();
  dcCalls=[];
  const a=await api(env,'/mem/sync',{});
  console.log('   猶予のうち '+JSON.stringify({ add:a.add, del:a.del,
    roles:dcRoles['111222333'] }));
  ok(a.del===0&&dcRoles['111222333'].indexOf(RP)>=0,
     '★★★猶予（既定3日）のうちは外さない');
  /* 期限を5日前にする（猶予を過ぎた）。 */
  await env.DB.prepare(`UPDATE mem SET paid_to=?1 WHERE cust='7777000001'`)
    .bind(new Date(Date.now()-5*86400000).toISOString()).run();
  dcCalls=[];
  const b=await api(env,'/mem/sync',{});
  console.log('   猶予を過ぎた '+JSON.stringify({ del:b.del,
    roles:dcRoles['111222333'] }));
  ok(b.del===3&&dcRoles['111222333'].length===0,
     '★★★期限＋猶予を過ぎたら、付けた3つのロールを外す');
  ok(dcCalls.filter((x)=>x.m==='DELETE'&&!x.role).length===0,
     '★★★追い出し（メンバーの削除）はしない');
  const c=await row(env,'7777000001');
  ok(c.state==='expired','★★状態が「期限切れ」になる');
  /* 支払いが来たら戻る。 */
  await hook(env,order({ id:'5010', created_at:new Date().toISOString(),
    line_items:[{ variant_id:VP, price:'9800', quantity:1,
                  selling_plan_id:'993' }] }));
  ok(dcRoles['111222333'].indexOf(RP)>=0,
     '★★★また支払いが来たらロールが戻る');
}

console.log('\n=== ⑤ ⚙に入れたロールだけ触る ===');
{
  dcRoles['111222333'].push('7777');          // ほかのロール（手で付けたもの）
  dcCalls=[];
  await api(env,'/mem/sync',{});
  ok(dcRoles['111222333'].indexOf('7777')>=0,
     '★★★⚙に入れていないロールは外さない');
  ok(dcCalls.filter((x)=>x.role==='7777').length===0,
     '★★★⚙に無いロールには触らない');
}

console.log('\n=== ⑥ 積み上げを切る・猶予を変える ===');
{
  const e2=env0();
  await setCfg(e2,{ memStack:false, memGrace:0 });
  dcRoles={ '222333444':[] };
  await hook(e2,order({ id:'6001', customer:{ id:'8888000001' },
    line_items:[{ variant_id:VS, price:'5980', quantity:1,
                  selling_plan_id:'992' }] }));
  await api(e2,'/mem/link',{ cust:'8888000001', dc:'222333444' });
  console.log('   '+JSON.stringify(dcRoles['222333444']));
  ok(dcRoles['222333444'].indexOf(RS)>=0
     &&dcRoles['222333444'].indexOf(RL)<0,
     '★★★積み上げを切ると、そのプランのロールだけ');
  /* 猶予0：期限を1日前にすると、すぐ外れる。 */
  await e2.DB.prepare(`UPDATE mem SET paid_to=?1 WHERE cust='8888000001'`)
    .bind(new Date(Date.now()-86400000).toISOString()).run();
  await api(e2,'/mem/sync',{});
  ok(dcRoles['222333444'].length===0,'★★★猶予0なら期限の翌日に外れる');
}

console.log('\n=== ⑦ モニターは3週間で外す（⚙で残すこともできる）===');
{
  const e3=env0();
  await setCfg(e3,{});
  dcRoles={ '333444555':[] };
  const old=new Date(Date.now()-22*86400000).toISOString();
  await api(e3,'/mem/link',{ cust:'9999000001', dc:'333444555',
    plan:'monitor', mon_from:old });
  console.log('   3週間すぎ '+JSON.stringify(dcRoles['333444555']));
  ok(dcRoles['333444555'].length===0,
     '★★★始めて3週間すぎたモニターにはロールを付けない');
  /* まだ3週間のうち。 */
  dcRoles={ '333444666':[] };
  await api(e3,'/mem/link',{ cust:'9999000002', dc:'333444666',
    plan:'monitor', mon_from:new Date(Date.now()-3*86400000).toISOString() });
  ok(dcRoles['333444666'].indexOf(RM)>=0,
     '★★★3週間のうちはモニターのロールが付く');
  /* ⚙で「残す」にすると外さない。 */
  const e4=env0();
  await setCfg(e4,{ memMonOff:false });
  dcRoles={ '444555666':[] };
  await api(e4,'/mem/link',{ cust:'9999000003', dc:'444555666',
    plan:'monitor', mon_from:old });
  ok(dcRoles['444555666'].indexOf(RM)>=0,
     '★★★⚙「モニターのロールを残す」なら外さない');
}

console.log('\n=== ⑧ 解約・支払いの失敗・つなぎを外す ===');
{
  const e5=env0();
  await setCfg(e5,{});
  dcRoles={ '555666777':[] };
  await hook(e5,order({ id:'7001', customer:{ id:'1000000001' } }));
  await api(e5,'/mem/link',{ cust:'1000000001', dc:'555666777' });
  ok(dcRoles['555666777'].indexOf(RL)>=0,'★ロールが付いている');
  const c=await api(e5,'/mem/state',{ cust:'1000000001', state:'canceled' });
  console.log('   解約 '+JSON.stringify({ ok:c.ok,
    roles:dcRoles['555666777'] }));
  ok(c.ok===true&&dcRoles['555666777'].length===0,
     '★★★解約にするとロールを外す');
  /* 支払いの失敗は、状態だけ変えて猶予のうちは外さない。 */
  await hook(e5,order({ id:'7002', customer:{ id:'1000000001' },
    created_at:new Date().toISOString() }));
  const f=await api(e5,'/mem/state',{ cust:'1000000001', state:'failed' });
  ok(f.ok===true&&dcRoles['555666777'].indexOf(RL)>=0,
     '★★★支払い失敗でも、期限＋猶予のうちは外さない（締め出さない）');
  const u=await api(e5,'/mem/unlink',{ cust:'1000000001' });
  const r=await row(e5,'1000000001');
  ok(u.ok===true&&dcRoles['555666777'].length===0
     &&!String(r.dc||''),
     '★★★つなぎを外すと、ロールを外してから番号を消す');
}

console.log('\n=== ⑨ ⚙の一覧（会員番号は下4桁・氏名やメールは無い）===');
{
  const d=await api(env,'/mem');
  console.log('   '+JSON.stringify({ n:d.n, on:d.on, grace:d.grace,
    row:(d.rows||[])[0] }));
  ok(d.ok===true&&d.n>0,'★★一覧が返る');
  const r0=(d.rows||[])[0]||{};
  ok(r0.cust4&&r0.cust4.length===4,'★★★会員番号は下4桁で返す');
  ok(JSON.stringify(d).indexOf('@')<0,
     '★★★メールらしきものは1つも入らない');
  ok(d.hook===true&&d.token===true,
     '★★⚙の様子（署名の秘密・ボットのトークンがあるか）も返す');
  ok(d.roles_ok===4&&d.vars_ok===3,
     '★★ロールID 4つ・バリアント3つが入っていることが分かる');
}

console.log('\n=== ⑩ できないときは理由を返す ===');
{
  const e6=env0();
  await setCfg(e6,{ memGuild:'', memRoleLight:'', memRoleStandard:'',
    memRolePremium:'', memRoleMonitor:'' });
  await hook(e6,order({ id:'8001', customer:{ id:'1200000001' } }));
  const a=await api(e6,'/mem/link',{ cust:'1200000001', dc:'666777888' });
  console.log('   '+JSON.stringify((a.sync||{}).rows||[]));
  ok(/サーバーID|ロールID/.test(String((((a.sync||{}).rows||[])[0]||{})
    .why||'')),'★★★⚙が足りなければ理由を返す（黙って失敗しない）');
  /* ロールを付けられない（権限がない）。 */
  const e7=env0();
  await setCfg(e7,{});
  dcRoles={ '777888999':[] }; dcFail=1;
  await hook(e7,order({ id:'8002', customer:{ id:'1300000001' } }));
  const b=await api(e7,'/mem/link',{ cust:'1300000001', dc:'777888999' });
  const why=String((((b.sync||{}).rows||[])[0]||{}).why||'');
  console.log('   '+why);
  ok(/権限がありません/.test(why)&&/ロールの管理/.test(why),
     '★★★権限が無いときは「ロールの管理」が要ると出す');
  ok(/上/.test(why),
     '★★★ボットのロールが上にある必要があることも出す');
  dcFail=0;
  /* Discord にまだ入っていない会員。 */
  dcRoles={};
  const c=await api(e7,'/mem/sync',{ cust:'1300000001' });
  ok(/サーバーにいません|見つかりません/
     .test(String(((c.rows||[])[0]||{}).why||'')),
     '★★サーバーにいない会員は、理由を返して何もしない');
}

console.log('\n=== ⑪ 管理者だけ ===');
{
  const req=(path,body)=>new Request('https://x'+path,
    { method:body?'POST':'GET',
      headers:Object.assign({'X-PJ-Key':'staff-key-123'},
        body?{'content-type':'application/json'}:{}),
      body:body?JSON.stringify(body):undefined });
  const a=await asJson(await worker.fetch(req('/mem'),env,{}));
  ok(a.status===403,'★★★一覧を見るのも管理者だけ');
  const b=await asJson(await worker.fetch(req('/mem/link',
    { cust:'1', dc:'2' }),env,{}));
  ok(b.status===403,'★★★手でつなぐのも管理者だけ');
}

console.log('\n=== ⑫ 表が無い D1 でも落ちない ===');
{
  /* 「列がある」は worker のなかで覚えている（COL_OK）ので、
     表を消して試すときは**別の worker**を読み込む。 */
  const { worker:w2 }=await loadWorker('mem-notable');
  const e8=makeEnv({ STAFF_KEY:'staff-key-123',
    DISCORD_BOT_TOKEN:'t', SHOPIFY_WEBHOOK_SECRET:SECRET });
  await e8.DB.prepare(`DROP TABLE IF EXISTS mem`).run();
  const d=(await asJson(await w2.fetch(get('/mem'),e8,{}))).body;
  console.log('   '+JSON.stringify(d));
  ok(d.error==='no_table'&&/migrate-0065/.test(String(d.detail||'')),
     '★★★表が無ければ、流すマイグレーションを教える');
  const raw=JSON.stringify(order({ id:'9001' }));
  const req=new Request('https://x/mem/hook',{ method:'POST',
    headers:{ 'content-type':'application/json',
      'X-Shopify-Topic':'orders/paid',
      'X-Shopify-Hmac-Sha256':await hmac(raw) }, body:raw });
  const h=await asJson(await w2.fetch(req,e8,{}));
  ok(h.status===200&&h.body.error==='no_table',
     '★★★webhook も落ちない（Shopify に 200 を返す）');
}

console.log('\n=== ⑬ 解約にした行は「付け直す」でも戻らない（8.62・カジの報告）===');
{
  /* カジの流れ（会員番号 …4883・モニター・手でつないだ行）
       つなぐ → 解約にする → 付け直す → 有効に戻す → 付け直す
     v315 では「解約にする」でロールが外れたあと、状態を expired に
     書き換えていたので、「付け直す」でモニターのロールがまた付いていた。 */
  const e9=env0();
  await setCfg(e9,{});
  dcRoles={ '999000111':[] };
  /* ① 手でモニターをつなぐ。 */
  const a=await api(e9,'/mem/link',{ cust:'1400004883', dc:'999000111',
    plan:'monitor' });
  const r1=await row(e9,'1400004883');
  console.log('   つないだ '+JSON.stringify({ state:r1.state,
    paid_to:String(r1.paid_to||'').slice(0,10), roles:dcRoles['999000111'] }));
  ok(dcRoles['999000111'].indexOf(RM)>=0,'★★モニターのロールが付く');
  ok(r1.state==='active','★★★つないだ行の状態は「有効」');
  /* 8.62 期限は「つないだ日＋モニターの日数（21日）」。 */
  const want=new Date(Date.now()+21*86400000).toISOString().slice(0,10);
  ok(String(r1.paid_to||'').slice(0,10)===want,
     '★★★期限は「つないだ日＋21日」（空のままにしない）');
  /* ② 解約にする → ロールが外れる。 */
  await api(e9,'/mem/state',{ cust:'1400004883', state:'canceled' });
  const r2=await row(e9,'1400004883');
  console.log('   解約 '+JSON.stringify({ state:r2.state,
    roles:dcRoles['999000111'] }));
  ok(dcRoles['999000111'].length===0,'★★★解約でロールが外れる');
  ok(r2.state==='canceled',
     '★★★状態は「解約」のまま（expired に書き換えない）');
  /* ③ 「付け直す」→ 付かない（ここが不具合だった）。 */
  const s3=await api(e9,'/mem/sync',{ cust:'1400004883' });
  console.log('   付け直す '+JSON.stringify({ add:s3.add,
    roles:dcRoles['999000111'] }));
  ok(s3.add===0&&dcRoles['999000111'].length===0,
     '★★★解約の行は「付け直す」でもロールを付けない');
  /* ④ 「ぜんぶ付け直す」でも付かない。 */
  const s4=await api(e9,'/mem/sync',{});
  ok(dcRoles['999000111'].length===0,
     '★★★「ぜんぶ付け直す」でも付かない');
  /* ⑤ 毎時の見回りでも付かない。 */
  await W.jobMemSync(e9,{});
  ok(dcRoles['999000111'].length===0,'★★★毎時の見回りでも付かない');
  const r5=await row(e9,'1400004883');
  ok(r5.state==='canceled','★★★見回りのあとも「解約」のまま');
  /* ⑥ 「有効に戻す」を押したときだけ戻る。 */
  await api(e9,'/mem/state',{ cust:'1400004883', state:'active' });
  const r6=await row(e9,'1400004883');
  console.log('   有効に戻す '+JSON.stringify({ state:r6.state,
    roles:dcRoles['999000111'] }));
  ok(dcRoles['999000111'].indexOf(RM)>=0,
     '★★★「有効に戻す」でロールが戻る');
  ok(r6.state==='active','★★状態は「有効」');
  /* ⑦ そのあとの「付け直す」でも、付いたまま（二重に付けない）。 */
  dcCalls=[];
  await api(e9,'/mem/sync',{ cust:'1400004883' });
  ok(dcRoles['999000111'].length===1
     &&dcCalls.filter((x)=>x.m==='PUT').length===0,
     '★★★もう付いているロールは付け直さない（PUT を出さない）');
  /* ⑧ つなぎ直しても、入っている期限や状態は上書きしない。 */
  await api(e9,'/mem/state',{ cust:'1400004883', state:'canceled' });
  await api(e9,'/mem/link',{ cust:'1400004883', dc:'999000111',
    plan:'monitor' });
  const r8=await row(e9,'1400004883');
  console.log('   つなぎ直し '+JSON.stringify({ state:r8.state,
    roles:dcRoles['999000111'] }));
  ok(r8.state==='canceled'&&dcRoles['999000111'].length===0,
     '★★★つなぎ直しても解約は解約のまま（勝手に戻さない）');
  /* ⑨ モニターの期限が空の古い行は、付け直しで入り直す。 */
  await e9.DB.prepare(
    `UPDATE mem SET paid_to='', state='active' WHERE cust='1400004883'`).run();
  await api(e9,'/mem/sync',{ cust:'1400004883' });
  const r9=await row(e9,'1400004883');
  console.log('   期限の入れ直し '+String(r9.paid_to||'').slice(0,10));
  ok(String(r9.paid_to||'').slice(0,10)===want,
     '★★★「期限 —」の古い行も、付け直すと期限が入る');
  /* ⑩ 一覧にも状態と期限が出る。 */
  const d=await api(e9,'/mem');
  const li=(d.rows||[]).filter((x)=>x.cust==='1400004883')[0]||{};
  console.log('   一覧 '+JSON.stringify(li));
  ok(li.state==='active'&&String(li.paid_to||'').slice(0,10)===want
     &&li.days>=20,'★★★一覧に状態（有効）と期限（あと21日）が出る');
  ok(li.cust4==='4883','★会員番号は下4桁');
}

T.done();
