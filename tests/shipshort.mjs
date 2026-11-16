/* Worker：会員便の送料が足りない品（8.57・カジの依頼）

   カジの報告（11/17）「①の案に『⚠ 送料が足りません（会員便の段 ¥200／
   宅配便（60サイズ））』が出た品がありました」。

   ・原因：送り方は **採寸 → 機種** の順で決まるので、ゲームでも採寸が
     大きければ箱になる（shared/shopcsv.js の shipWay）
   ・いまの警告は⚙の下限と比べるだけで、**実際の送料とは比べていなかった**
   ① 決まりは shared/sellway.js の shortOf の1か所
      （会員から受け取る額 ＜ その送り方の実額 → 送料不足）
   ② 警告の文に**実額と不足額**を入れる
   ③ ⚙「送料が足りない品は自動では出さない」（**既定オフ**）を入れると、
      **新しく出す品だけ**外す（**出してあるカードは触らない**）
   ④ カジが送り方を手で直せば、次の回から出る */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const SELLWAY=require('../shared/sellway.js');
const SUBPLAN=require('../shared/subplan.js');
const T=harness('Worker：送料が足りない品（8.57）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('shipshort');

console.log('=== ① 決まりは1か所（shared/sellway.js の shortOf）===');
{
  const o={ shipName:'宅配便（60サイズ）' };
  const a=SELLWAY.shortOf('box60',600,o);
  console.log('   '+JSON.stringify(a));
  ok(a.short===true&&a.cost===800&&a.got===600&&a.gap===200,
     '★★★会員から ¥600・実際 ¥800 なら「不足 ¥200」');
  ok(/会員から ¥600/.test(a.ja)&&/実際 ¥800/.test(a.ja)
     &&/宅配便（60サイズ）/.test(a.ja)&&/不足 ¥200/.test(a.ja),
     '★★★文に 会員から・実際・送り方・不足額が入る');
  ok(SELLWAY.shortOf('cp',200,{}).short===false,
     '★★★クリックポスト（¥185）に ¥200 なら足りる');
  ok(SELLWAY.shortOf('letter',600,{}).short===false,
     '★★レターパックプラス（¥600）に ¥600 はぎりぎり足りる');
  ok(SELLWAY.shortOf('compact',300,{}).short===true
     &&SELLWAY.shortOf('compact',300,{}).gap===220,
     '★★★宅急便コンパクト（¥520）に ¥300 なら不足 ¥220');
  ok(SELLWAY.shortOf('',200,{}).short===false
     &&SELLWAY.shortOf('box60',0,{}).short===false,
     '★★★送り方か額が分からないときは**外さない**（当てずっぽうにしない）');
  /* ⚙で実額を変えられる。 */
  ok(SELLWAY.shortOf('box60',600,{ gdShipBox60:500 }).short===false,
     '★★実額は⚙（gdShipBox60）から取る');
}

console.log('\n=== ② ⚙を入れるまでは案から外さない ===');
{
  const r={ jan:'4589864470205', name:'ゲーム', fit:true, rst:'ok',
            price:3000, ship_short:'会員から ¥600／実際 ¥800・不足 ¥200' };
  ok(SUBPLAN.whyNot(r,SUBPLAN.pickOpt({}))==='',
     '★★★既定（⚙オフ）では、送料が足りない品も案に出す');
  const why=SUBPLAN.whyNot(r,SUBPLAN.pickOpt({ subShipShortOff:1 }));
  console.log('   '+why);
  ok(/会員便の送料が足りません/.test(why)&&/不足 ¥200/.test(why),
     '★★★⚙を入れると案から外し、理由に実額を出す');
  ok(SUBPLAN.whyNot({ jan:'1', name:'x', fit:true, rst:'ok', price:3000 },
    SUBPLAN.pickOpt({ subShipShortOff:1 }))==='',
     '★★印が無い品は今までどおり出す');
}

console.log('\n=== ③ pj-sync：警告の文と「新しく出さない」===');
const CH='2222222222';
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz' });
let dc=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/discord\.com\/api/.test(url)){
    const cc=/\/channels\/(\d+)$/.exec(url);
    if(cc)return new Response(JSON.stringify({ id:cc[1], name:'c',
      guild_id:'5' }),{status:200,headers:{'content-type':'application/json'}});
    const b=o.body?JSON.parse(String(o.body)):null;
    dc.push({ method:String(o.method||'GET'),
              ch:(/\/channels\/(\d+)\/messages/.exec(url)||[])[1]||'',
              body:b });
    return new Response(JSON.stringify({ id:String(900000+dc.length) }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  return new Response('{}',{status:200});
};
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subOnMonitor:false, gdIdxOn:false,
      subOnStandard:true, subChStandard:CH,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
/* 箱もの（宅配便60・900g）と薄物（ゲーム・100g）を入れる。 */
const add=async(env,jan,o)=>{
  const at=new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,
       created_at) VALUES (?1,'いろは',0,?2,?3,20,'h',?4,?4)`)
    .bind(jan,(o||{}).kishu||'NS',(o||{}).name||'商品',at).run();
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,fee_total,fee_ref,fee_tax,
       size_tier,size_long,size_wid,size_hei,size_g,rank,rank_cat,new_n,
       checked_at,basis,price_at)
     VALUES (?1,?2,?3,9000,1200,900,90,'s',?4,?5,?6,?7,1200,'ゲーム',3,?8,
             'カート',?8)`)
    .bind(jan,'B0SHORT'+jan.slice(-3),(o||{}).name||'商品',
          (o||{}).long||17,(o||{}).wid||13,(o||{}).hei||1.5,
          (o||{}).g||100,at).run();
  await env.DB.prepare(
    `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,
       at,created_at) VALUES (?1,1,1,3000,'standard',?2,?2,?2,?2)`)
    .bind(jan,at).run();
};
{
  const env=env0();
  await setCfg(env,{});
  /* 箱もの（25×20×10cm・900g → 宅配便60）。会員からは段で ¥600。 */
  await add(env,'4589864470205',{ name:'フィギュア', kishu:'FIG',
    long:25, wid:20, hei:10, g:900 });
  const d=await api(env,'/sub/plan');
  const it=((d.plans||[]).filter((p)=>p.key==='standard')[0]||{}).items||[];
  console.log('   '+JSON.stringify({ ship:(it[0]||{}).ship,
    warns:(it[0]||{}).warns }));
  ok(String((it[0]||{}).ship||'')==='宅配便（60サイズ）',
     '★採寸から宅配便60になる（機種より採寸が強い）');
  ok(((it[0]||{}).warns||[]).some((x)=>/送料が足りません/.test(String(x))
    &&/実際 ¥800/.test(String(x))&&/不足 ¥200/.test(String(x))),
     '★★★警告の文に**実額と不足額**が入る');
  /* ⚙を入れると、新しくは出さない。 */
  const e2=env0();
  await setCfg(e2,{ subShipShortOff:true });
  await add(e2,'4589864470205',{ name:'フィギュア', kishu:'FIG',
    long:25, wid:20, hei:10, g:900 });
  await add(e2,'4902370550001',{ name:'ふつうのゲーム' });
  dc=[];
  const r=await api(e2,'/sub/send',{ approve:true, plan:'standard' });
  const sent=((await e2.DB.prepare(
    `SELECT jan FROM sub_post WHERE ch=?1`).bind(CH).all()).results||[])
    .map((x)=>String(x.jan));
  console.log('   '+JSON.stringify({ sent:sent, add:(r.plans||[])
    .filter((p)=>p.key==='standard').map((p)=>p.add)[0] }));
  ok(sent.indexOf('4902370550001')>=0,'★★薄物（足りる品）は出る');
  ok(sent.indexOf('4589864470205')<0,
     '★★★⚙を入れると、送料が足りない品は**新しく出さない**');
  /* すでに出してあるカードは触らない（値段の書き換えは続ける）。 */
  const e3=env0();
  await setCfg(e3,{ subShipShortOff:true });
  await add(e3,'4589864470205',{ name:'フィギュア', kishu:'FIG',
    long:25, wid:20, hei:10, g:900 });
  const at=new Date().toISOString();
  await e3.DB.prepare(
    `INSERT INTO sub_post (jan,ch,plan,msg_id,price,qty,sold,sold_out,at,
       created_at) VALUES ('4589864470205',?1,'standard','940001',2500,1,0,0,
       ?2,?2)`).bind(CH,at).run();
  dc=[];
  const r3=await api(e3,'/sub/send',{ approve:true, plan:'standard' });
  const p3=(r3.plans||[]).filter((p)=>p.key==='standard')[0]||{};
  console.log('   出してあるカード '+JSON.stringify({ add:p3.add,
    edit:p3.edit, patch:dc.filter((x)=>x.method==='PATCH').length }));
  ok(p3.edit===1&&dc.filter((x)=>x.method==='PATCH').length===1,
     '★★★出してあるカードは**今までどおり書き換える**（放り出さない）');
  ok(dc.filter((x)=>x.method==='DELETE').length===0,
     '★★★勝手に消したり受付終了にしたりしない');
  /* 送り方を手で直すと、また出る。 */
  const e4=env0();
  await setCfg(e4,{ subShipShortOff:true });
  await add(e4,'4589864470205',{ name:'フィギュア', kishu:'FIG',
    long:25, wid:20, hei:10, g:900 });
  await e4.DB.prepare(
    `UPDATE mw_sub SET ship_way='cp' WHERE jan='4589864470205'`).run();
  dc=[];
  await api(e4,'/sub/send',{ approve:true, plan:'standard' });
  const sent4=((await e4.DB.prepare(
    `SELECT jan FROM sub_post WHERE ch=?1`).bind(CH).all()).results||[])
    .map((x)=>String(x.jan));
  ok(sent4.indexOf('4589864470205')>=0,
     '★★★送り方を手で「クリックポスト」に直せば、また出る');
}

T.done();
