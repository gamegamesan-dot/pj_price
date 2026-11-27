/* Worker：件数は「1回に新しく出す数」・プランから外れた品（8.45・段②）

   ① どのプランも **n ＝ 1回に新しく出す件数**（たたき台 モニター5／
      ライト5／スタンダード8／プレミアム10）。
      すでに出してあるカードは件数に数えず、値段と残り数の書き換えだけする
      （8.43 でモニターだけこうしていたのを全プランに揃えた）。
   ② **プランから外れた品**（印を付け直した・grades を変えた）は、
      そのプランのカードだけ「受付終了」に書き換える（消さない）。
      ほかのプランでは売り続ける。
   ③ 止めているプラン・入れ替えたチャンネルのカードは触らない
      （一気に受付終了にしてしまわないため）。 */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import SUBPLAN from '../shared/subplan.js';
const T=harness('Worker：新しく出す件数と外れた品（8.45）');
const ok=T.ok;
const { worker }=await loadWorker('subnew');

let dc=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/\/api\/webhooks\//.test(url))return new Response(null,{status:204});
  if(/discord\.com\/api/.test(url)){
    const cc=/\/channels\/(\d+)$/.exec(url);
    if(cc)return new Response(JSON.stringify({ id:cc[1], name:'ch-'+cc[1],
      guild_id:'555000555' }),
      {status:200,headers:{'content-type':'application/json'}});
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    const b=o.body?JSON.parse(String(o.body)):null;
    const rec={ method:String(o.method||'GET'), ch:m[1]||'', msg:m[2]||'',
                body:b };
    /* 文だけの1通（「今週の配信」）はカードではないので別にする。 */
    (((b||{}).embeds===undefined&&(b||{}).content)?[]:dc).push(rec);
    return new Response(JSON.stringify({ id:String(900000+dc.length) }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  return new Response('{}',{status:200});
};
const LI='2222222222', PR='3333333333', MO='1111111111';
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz' });
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subOnMonitor:false,
      /* 8.46 この試験は**カードの数**を見るので、会員チャンネルの
         「今週の一覧」は出さない（一覧そのものは
         tests/subindexw.mjs・subindex.mjs で見る）。 */
      gdIdxOn:false,
      subOnLight:true, subChLight:LI,
      subOnPremium:true, subChPremium:PR, subChMonitor:MO,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const jan=(i)=>'490237055'+String(1000+i);
const add=async(env,i,o)=>{
  const j=jan(i), at=new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,
       created_at) VALUES (?1,'いろは',0,'NS',?2,20,'h',?3,?3)`)
    .bind(j,'ゲーム'+i,at).run();
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,checked_at,
       basis,price_at) VALUES (?1,'B0D1GSZJ8T',?2,9000,1200,'s',?3,'カート',?3)`)
    .bind(j,'Amazon'+i,at).run();
  await env.DB.prepare(
    `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,
       at,created_at) VALUES (?1,1,1,3645,?2,?3,?3,?3,?3)`)
    .bind(j,((o||{}).grades===undefined?'light':(o||{}).grades),at).run();
  return j;
};
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
const planOf=(r,k)=>(r.plans||[]).filter((x)=>x.key===k)[0]||{};

console.log('=== ① 件数は「新しく出す数」（ライト・既定5件）===');
{
  const env=env0();
  await setCfg(env,{});
  for(let i=0;i<8;i++)await add(env,i);
  ok(SUBPLAN.list({}).filter((p)=>p.key==='light')[0].n===5,
     '★★★ライトの既定は1回に新しく5件');
  dc=[];
  const r1=await api(env,'/sub/send',{ approve:true, plan:'light' });
  const p1=planOf(r1,'light');
  console.log('   1回目 '+JSON.stringify({ add:p1.add, edit:p1.edit,
    post:dc.filter((x)=>x.method==='POST').length }));
  ok(p1.add===5&&r1.sent===5,'★★★1回目は5件だけ新しく出す');
  ok(dc.filter((x)=>x.method==='POST'&&x.ch===LI).length===5,
     '★★★Discord に出したカードも5枚');
  dc=[];
  const r2=await api(env,'/sub/send',{ approve:true, plan:'light' });
  const p2=planOf(r2,'light');
  console.log('   2回目 '+JSON.stringify({ add:p2.add, edit:p2.edit,
    keep:p2.keep }));
  ok(p2.add===3,'★★★2回目は残りの3件（前の5件は件数に数えない）');
  ok(dc.filter((x)=>x.method==='POST').length===3,
     '★★★新しく出すのは3枚だけ');
  const n=Number(((await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sub_post WHERE ch=?1`).bind(LI).first())||{})
    .n||0);
  ok(n===8,'★★2回で8件がライトに出ている');
  dc=[];
  const r3=await api(env,'/sub/send',{ approve:true, plan:'light' });
  ok(planOf(r3,'light').add===0&&dc.filter((x)=>x.method==='POST').length===0,
     '★★★もう新しく出すものが無ければ1枚も出さない');
}

console.log('\n=== ② 値段が変わったカードは、件数の外で書き換える ===');
{
  const env=env0();
  await setCfg(env,{});
  for(let i=0;i<7;i++)await add(env,i);
  await api(env,'/sub/send',{ approve:true, plan:'light' });   // 5件出す
  /* 出した5件ぜんぶの値段を変える。 */
  await env.DB.prepare(`UPDATE mw_sub SET price=4000`).run();
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true, plan:'light' });
  const p=planOf(r,'light');
  console.log('   '+JSON.stringify({ add:p.add, edit:p.edit,
    post:dc.filter((x)=>x.method==='POST').length,
    patch:dc.filter((x)=>x.method==='PATCH').length }));
  ok(p.add===2,'★★★新しく出すのは⚙の件数まで（残り2件）');
  ok(p.edit===5,'★★★書き換えは件数に数えない（5件ぜんぶ書き換える）');
  ok(dc.filter((x)=>x.method==='PATCH').length===5,
     '★★★書き換えは PATCH（通知は鳴らない）');
}

console.log('\n=== ③ プランから外れた品は、そのプランのカードだけ消す（8.111）===');
{
  const env=env0();
  await setCfg(env,{});
  /* 8.35 積み上げ型：「ライトから上」は light,standard,premium が入る。 */
  const j=await add(env,0,{ grades:'light,standard,premium' });
  await api(env,'/sub/send',{ approve:true });
  const was=await env.DB.prepare(
    `SELECT ch,msg_id FROM sub_post WHERE jan=?1 ORDER BY ch`).bind(j).all();
  console.log('   出したチャンネル：'
    +((was&&was.results)||[]).map((x)=>x.ch).join(','));
  ok(((was&&was.results)||[]).length===2,
     '★積み上げ型でライトとプレミアムに出ている');
  await env.DB.prepare(`INSERT INTO sync_state (k,v,updated_at) VALUES ('sub.prune.from','all',?1)
    ON CONFLICT(k) DO UPDATE SET v='all'`).bind(new Date().toISOString()).run();

  /* 「プレミアムだけ」に付け直す（ライトからは外れる）。 */
  await env.DB.prepare(`UPDATE mw_sub SET grades='premium' WHERE jan=?1`)
    .bind(j).run();
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true });
  console.log('   '+JSON.stringify(r.retire||{})+' / '
    +JSON.stringify(dc.map((x)=>x.method+':'+x.ch)));
  const li=await env.DB.prepare(
    `SELECT msg_id FROM sub_post WHERE jan=?1 AND ch=?2`).bind(j,LI).first();
  const pr=await env.DB.prepare(
    `SELECT msg_id FROM sub_post WHERE jan=?1 AND ch=?2`).bind(j,PR).first();
  ok(!!li&&!String(li.msg_id||''),
     '★★★外れたプラン（ライト）のカードは消す（控えの行は残す）');
  ok(!!String((pr||{}).msg_id||''),
     '★★★出し続けるプラン（プレミアム）のカードはそのまま');
  ok(dc.filter((x)=>x.method==='DELETE'&&x.ch===LI).length===1
     &&dc.filter((x)=>x.method==='PATCH'&&x.ch===LI).length===0,
     '★★★「受付終了」に書き換えずに消す');
  ok(dc.filter((x)=>x.method==='DELETE'&&x.ch===PR).length===0,'★★★ほかのプランのカードは消さない');
  const d1=await env.DB.prepare(`SELECT why FROM sub_del WHERE jan=?1 AND ch=?2`).bind(j,LI).first();
  ok(!!d1&&d1.why==='off_plan','★★消した理由は「そのプランから外した」');
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  ok(dc.filter((x)=>x.ch===LI).length===0,
     '★★二度は触らない（もう消してある・ライトにはまた出さない）');
}

console.log('\n=== ④ 止めているプラン・入れ替えたチャンネルは触らない ===');
{
  const env=env0();
  await setCfg(env,{});
  const j=await add(env,0,{ grades:'light,standard,premium' });
  await api(env,'/sub/send',{ approve:true });
  await env.DB.prepare(`INSERT INTO sync_state (k,v,updated_at) VALUES ('sub.prune.from','all',?1)
    ON CONFLICT(k) DO UPDATE SET v='all'`).bind(new Date().toISOString()).run();
  /* ライトを止める（チャンネルのカードはそのまま残す）。 */
  await setCfg(env,{ subOnLight:false });
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  const li=await env.DB.prepare(
    `SELECT msg_id FROM sub_post WHERE jan=?1 AND ch=?2`).bind(j,LI).first();
  ok(!!String((li||{}).msg_id||''),
     '★★★止めたプランのカードは消さない（一気に消さない）');
  /* チャンネルを入れ替えても、前のチャンネルのカードは触らない。 */
  await setCfg(env,{ subChLight:'9999999999' });
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  const li2=await env.DB.prepare(
    `SELECT msg_id FROM sub_post WHERE jan=?1 AND ch=?2`).bind(j,LI).first();
  ok(!!String((li2||{}).msg_id||''),
     '★★★入れ替える前のチャンネルのカードも触らない');
  /* リストから外れた品（MW 欠品）は消す（8.111）。 */
  await setCfg(env,{});
  await env.DB.prepare(`UPDATE mw_sub SET on_sale=0 WHERE jan=?1`).bind(j)
    .run();
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  const li3=await env.DB.prepare(
    `SELECT msg_id FROM sub_post WHERE jan=?1 AND ch=?2`).bind(j,LI).first();
  ok(!!li3&&!String(li3.msg_id||''),
     '★★★リストから外れた品のカードは消す（8.111）');
}
T.done();
