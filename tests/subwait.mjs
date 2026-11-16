/* Worker：書き直しでは新しいカードを出さない（8.39・カジの確認・v298）

   カジの報告
     「送ったカードをすべて今の形で書き直す」の結果が
     **「書き換え 59件・新しく 17件」**だった。
     v297 の報告では「書き直しでは新しく出さない」と書いたが、
     それは**消えていたカードの出し直し**のことで、
     **まだ一度も出していない商品は新しく出していた**（通知が鳴る）。

   ここで当たること
     ① 書き直し（redo）では**まだ出していない商品を出さない**
        （Discord に POST しない＝会員に通知が鳴らない）
     ② 出さなかった件数を wait で返す
     ③ 書き換え（PATCH）は今までどおり出す
     ④ 「全プランに配る」「今すぐ送る」「自動の回」では**今までどおり出す**
     ⑤ 1点もの（写真つき）でも同じ */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：書き直しでは新しく出さない（8.39）');
const ok=T.ok;
const { worker }=await loadWorker('subwait');

let dc=[];
let mon=[];        // 8.43 モニターへの「今週の配信」
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/\/api\/webhooks\//.test(url))return new Response(null,{status:204});
  if(/discord\.com\/api/.test(url)){
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    const bd=(()=>{ try{ return JSON.parse(String(o.body||'{}')); }
                    catch(e){ return {}; } })();
    /* 8.43 モニターへの「今週の配信」は**カードではない**（文だけの1通）。
       カードの数を見るので、別に取っておく（中身は tests/submon.mjs）。 */
    (((!bd.embeds)&&bd.content)?mon:dc).push({
      method:String(o.method||'GET'), ch:m[1]||'', msg:m[2]||'' });
    return new Response(JSON.stringify({ id:String(900000+dc.length) }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  return new Response('{}',{status:200});
};
const CH1='1111111111', CH2='2222222222';
const now=()=>new Date().toISOString();
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz' });
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:now(),
    settings:Object.assign({ subOn:true, subOnMonitor:true, subOnLight:true,
      /* 8.46 この試験は**カードの数**を見るので、会員チャンネルの
         「今週の一覧」は出さない（一覧そのものは
         tests/subindexw.mjs・subindex.mjs で見る）。 */
      gdIdxOn:false,
      subChMonitor:CH1, subChLight:CH2, subNMonitor:10, subNLight:10,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),now()).run();
const JAN1='4902370550467', JAN2='4902370550468';
const stock=(env,jan)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,created_at)
   VALUES (?1,'いろは商会',0,'NS',?2,9,'h',?3,?3)`)
  .bind(jan,'商品'+jan,now()).run();
const amz=(env,jan)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,checked_at,
     basis,price_at)
   VALUES (?1,'B0D1GSZJ8T',?2,9000,1200,'s',?3,'カート',?3)`)
  .bind(jan,'Amazonの名前'+jan,now()).run();
const sub=(env,jan,grades)=>env.DB.prepare(
  `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,
     created_at) VALUES (?1,1,3,3645,?2,?3,?3,?3,?3)`)
  .bind(jan,grades||'',now()).run();
const post1=(env,jan,ch,plan,msg)=>env.DB.prepare(
  `INSERT INTO sub_post (jan,ch,plan,msg_id,price,qty,sold,sold_out,at,
     created_at) VALUES (?1,?2,?3,?4,3645,3,0,0,?5,?5)`)
  .bind(jan,ch,plan,msg,now()).run();
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
/* JAN1 は出してある（書き換えになる）／JAN2 はまだ出していない。 */
const build=async()=>{
  const env=env0();
  await setCfg(env);
  await stock(env,JAN1); await amz(env,JAN1); await sub(env,JAN1,'monitor');
  await stock(env,JAN2); await amz(env,JAN2); await sub(env,JAN2,'monitor');
  await post1(env,JAN1,CH1,'monitor','800001');
  return env;
};

console.log('=== ① 書き直しでは新しく出さない ===');
{
  const env=await build();
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true, redo:true });
  console.log('   '+JSON.stringify({ sent:r.sent, edited:r.edited,
    wait:r.wait, fail:r.fail }));
  console.log('   Discord：'+dc.map((x)=>x.method).join(',')||'（なし）');
  ok(dc.filter((x)=>x.method==='POST').length===0,
     '★★★新しいカードを出さない（会員に通知が鳴らない）');
  ok(r.sent===0,'★★★「新しく」は 0件になる');
  ok(r.edited===1&&dc.filter((x)=>x.method==='PATCH').length===1,
     '★★★書き換えは今までどおり出す');
  ok(r.wait===1,'★★★出さなかった件数（まだ出していないカード）を返す');
  const n=Number(((await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sub_post`).first())||{}).n||0);
  ok(n===1,'★★★控えも増やさない（出していないので）');
}

console.log('=== ② プランごとにも数える ===');
{
  const env=await build();
  /* ライトにも出す商品（積み上げ型）。どちらもまだ出していない。 */
  await env.DB.prepare(`UPDATE mw_sub SET grades='monitor,light'`).run();
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true, redo:true });
  const by={}; (r.plans||[]).forEach((x)=>{ by[x.key]=x; });
  console.log('   '+JSON.stringify((r.plans||[]).map((x)=>
    x.key+' edit='+x.edit+' wait='+x.wait)));
  ok(r.wait===3,'★★★プランをまたいで数える（モニター1・ライト2）');
  ok((by.monitor||{}).wait===1&&(by.light||{}).wait===2,
     '★★プランごとにも返す');
  ok(dc.filter((x)=>x.method==='POST').length===0,
     '★★★どのプランでも新しく出さない');
}

console.log('=== ③ 配信（全プランに配る・今すぐ送る・自動）は今までどおり ===');
{
  const env=await build();
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true });
  console.log('   '+JSON.stringify({ sent:r.sent, edited:r.edited,
    wait:r.wait })+' / '+dc.map((x)=>x.method).join(','));
  ok(r.sent===1&&dc.filter((x)=>x.method==='POST').length===1,
     '★★★配信では新しいカードを出す（ここで通知が鳴る）');
  ok(!r.wait,'★★配信では「まだ出していない」は出ない');
  const env2=await build();
  dc=[];
  const r2=await api(env2,'/sub/send',{ approve:true, plan:'monitor' });
  ok(r2.sent===1,'★★★「全プランに配る」（プラン指定）でも出す');
}

console.log('=== ④ 予定の数え方は変えない ===');
{
  const env=await build();
  const pl=await api(env,'/sub/plan');
  const mon=(pl.plans||[]).filter((p)=>p.key==='monitor')[0]||{};
  console.log('   '+JSON.stringify({ add:mon.add, edit:mon.edit,
    keep:mon.keep }));
  ok(mon.add===1,'★★★予定では「新しく出す1件」のまま（確認の画面から出せる）');
  ok(mon.edit+mon.keep===1,'★出してあるカードは書き換え／そのまま');
}

console.log('=== ⑤ 1点ものでも同じ ===');
{
  const env=await build();
  /* #目玉商品-先行 に出せる1点もの（Shopify に読み込みました の印つき）。 */
  await env.DB.prepare(
    `INSERT INTO one_item (name,cond,cost,price,qty,ship_kind,handle,
       loaded_at,at,created_at) VALUES ('秋葉原の1点もの','新品',2000,4800,1,
       'small','one-1',?1,?1,?1)`).bind(now()).run();
  await setCfg(env,{ subChPre:'3333333333', subChHot:'4444444444' });
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true, redo:true });
  const one=(r.plans||[]).filter((x)=>x.one)[0]||{};
  console.log('   '+JSON.stringify({ wait:r.wait, one:one.wait||0 })
    +' / '+dc.map((x)=>x.method).join(','));
  ok(dc.filter((x)=>x.method==='POST').length===0,
     '★★★1点ものも書き直しでは出さない');
  ok((one.wait||0)>0,'★★1点ものの「まだ出していない」も数える');
}

await T.done();
