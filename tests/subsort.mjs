/* 決まり：プランの並び（下は早い品から・上は手残りの大きい順）（8.52）

   カジの決定（2026-11-16）
   「プランの振り分け（下は早い品＋手残り、上は手残りの大きい順）も、
     設計案のとおり進めてください」

   ① 下のプラン（モニター・ライト）… **早い品から**（同じなら手残り）
   ② 上のプラン（スタンダード・プレミアム）… **手残りの大きい順**
   ③ 速さが取れない品は、今までどおり**いちばん後ろ**
   ④ ⚙「プランの並びを手残りで決める」を切ると「粗利×速さ」の順に戻る
   ⑤ pj-sync の配信も**同じ順**（決まりは shared/subplan.js の sortPick）
   ⑥ 並べ替えても「1回に新しく出す件数」は変わらない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const P=require('../shared/subplan.js');
const T=harness('決まり：プランの並び（8.52）');
const ok=T.ok;
const { worker }=await loadWorker('subsort');

/* ---- 画面の案（shared/subplan.js）---- */
const row=(o)=>Object.assign({ jan:'4902370550001', name:'ふつうのゲーム',
  fit:true, rst:'ok', amz:0, buy_qty:0, price:3000, qty:1, gross:800,
  speed:1, est:0, net:500, stock:9, is_game:true, grades:'' },o);
const janOf=(items)=>items.map((x)=>String(x.jan).slice(-1)).join('');
const draftOf=(rows,cfg)=>P.draft(rows,P.list({ subOnMonitor:1,
  subChMonitor:'1', subOnLight:1, subChLight:'2', subOnStandard:1,
  subChStandard:'3', subOnPremium:1, subChPremium:'4' }),cfg||{},[],Date.now());
const planOf=(d,k)=>(d.plans||[]).filter((x)=>x.key===k)[0]||{ items:[] };

/* 速さ 3／手残り 100・速さ 1／手残り 500・速さ 0.5／手残り 900 */
const three=[row({ jan:'4902370550001', speed:3, net:100 }),
             row({ jan:'4902370550002', speed:0.5, net:900 }),
             row({ jan:'4902370550003', speed:1, net:500 })];

console.log('=== ① 下のプランは早い品から ===');
{
  const d=draftOf(three);
  console.log('   monitor '+janOf(planOf(d,'monitor').items)
    +' / light '+janOf(planOf(d,'light').items));
  ok(janOf(planOf(d,'light').items)==='132',
     '★★★ライトは速さの大きい順（3→1→0.5 点/日）');
  ok(janOf(planOf(d,'monitor').items)==='132',
     '★★★モニターも早い品から');
}

console.log('\n=== ② 上のプランは手残りの大きい順 ===');
{
  const d=draftOf(three);
  console.log('   standard '+janOf(planOf(d,'standard').items)
    +' / premium '+janOf(planOf(d,'premium').items));
  ok(janOf(planOf(d,'standard').items)==='231',
     '★★★スタンダードは手残りの大きい順（900→500→100）');
  ok(janOf(planOf(d,'premium').items)==='231',
     '★★★プレミアムも手残りの大きい順');
}

console.log('\n=== ②-2 同じ速さなら手残りの大きい順（下のプラン）===');
{
  const d=draftOf([row({ jan:'4902370550001', speed:2, net:100 }),
                   row({ jan:'4902370550002', speed:2, net:900 })]);
  ok(janOf(planOf(d,'light').items)==='21',
     '★★★速さが同じなら手残りの大きいほうが先');
}

console.log('\n=== ③ 速さが取れない品はいちばん後ろ ===');
{
  const d=draftOf([row({ jan:'4902370550001', speed:0, est:0, net:9000 }),
                   row({ jan:'4902370550002', speed:0.2, net:100 })]);
  console.log('   light '+janOf(planOf(d,'light').items)
    +' / premium '+janOf(planOf(d,'premium').items));
  ok(janOf(planOf(d,'light').items)==='21',
     '★★★速さ 0 の品は後ろ（手残りが大きくても）');
  ok(janOf(planOf(d,'premium').items)==='21',
     '★★★上のプランでも、速さ 0 の品は後ろ');
}

console.log('\n=== ③-2 MW の減りが無い品は、順位からの推定で見る ===');
{
  const d=draftOf([row({ jan:'4902370550001', speed:0, est:0.5, net:100 }),
                   row({ jan:'4902370550002', speed:0, est:0.1, net:900 })]);
  ok(janOf(planOf(d,'light').items)==='12',
     '★★★推定（est）でも早い品から');
}

console.log('\n=== ④ ⚙を切ると「粗利×速さ」の順に戻る ===');
{
  const d=draftOf(three,{ subSortNet:0 });
  const a=janOf(planOf(d,'light').items), b=janOf(planOf(d,'premium').items);
  console.log('   light '+a+' / premium '+b);
  ok(a===b,'★★★⚙を切るとプランで並びが変わらない');
  ok(a==='132','★★★粗利が同じなら速さの大きい順（今までの点数）');
  const d2=draftOf([row({ jan:'4902370550001', gross:400, speed:2, net:100 }),
                    row({ jan:'4902370550002', gross:900, speed:2, net:900 })],
                   { subSortNet:0 });
  ok(janOf(planOf(d2,'premium').items)==='21',
     '★★点数は粗利×速さ（粗利の大きいほうが先）');
}

console.log('\n=== ⑤ pj-sync の配信も同じ順 ===');
/* 順位が良い品＝早い品（Amazon の順位からの推定）／
   Amazon の価格が高い品＝手残りの大きい品。
   わざと**逆**にして、プランごとにどちらが先に出るかを見る。 */
let dc=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/discord\.com\/api/.test(url)){
    const cc=/\/channels\/(\d+)$/.exec(url);
    if(cc)return new Response(JSON.stringify({ id:cc[1], name:'ch-'+cc[1],
      guild_id:'555000555' }),
      {status:200,headers:{'content-type':'application/json'}});
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    const b=o.body?JSON.parse(String(o.body)):null;
    const rec={ method:String(o.method||'GET'), ch:m[1]||'', body:b };
    /* 文だけの1通（今週の一覧など）はカードではないので数えない。 */
    (((b||{}).embeds===undefined&&(b||{}).content)?[]:dc).push(rec);
    return new Response(JSON.stringify({ id:String(900000+dc.length) }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  return new Response('{}',{status:200});
};
/* 上のプランは**スタンダード**で見る（プレミアムは1点もの向けの型）。
   積み上げ型なので、ライトの品はスタンダードからも見えている。 */
const LI='2222222222', ST='3333333333';
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz' });
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subOnMonitor:false,
      /* カードの数だけを見るので、会員チャンネルの一覧は出さない。 */
      gdIdxOn:false,
      subOnLight:true, subChLight:LI,
      subOnStandard:true, subChStandard:ST,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
/* i 番の品（順位・Amazon の価格をこちらで決める）。 */
const add=async(env,i,rank,amzPx,grades)=>{
  const j='490237055'+String(1000+i), at=new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,
       created_at) VALUES (?1,'いろは',0,'NS',?2,20,'h',?3,?3)`)
    .bind(j,'ゲーム'+i,at).run();
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,low,fee_total,fee_ref,fee_tax,
       size_tier,size_g,rank,rank_cat,checked_at,basis,price_at)
     VALUES (?1,'B0D1GSZJ8T',?2,?3,?3,?4,?5,?6,'s',110,?7,'ゲーム',?8,
             'カート',?8)`)
    .bind(j,'Amazon'+i,amzPx,Math.round(amzPx*0.15),
          Math.round(amzPx*0.10),Math.round(amzPx*0.01),rank,at).run();
  await env.DB.prepare(
    `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,
       at,created_at) VALUES (?1,1,1,3000,?3,?2,?2,?2,?2)`)
    .bind(j,at,String(grades||'light')).run();
  return j;
};
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
const sentJans=async(env,ch)=>((await env.DB.prepare(
  `SELECT jan FROM sub_post WHERE ch=?1 ORDER BY at ASC, jan ASC`)
  .bind(ch).all()).results||[]).map((r)=>String(r.jan).slice(-1)).sort()
  .join('');
{
  const env=env0();
  /* ライトもプレミアムも「新しく出すのは1件」にして、
     どちらの品が選ばれるかを見る。 */
  await setCfg(env,{ subNLight:1, subNStandard:1 });
  /* 1番：順位 800（早い）・Amazon ¥6,000（手残り小）
     2番：順位 45,000（遅い）・Amazon ¥20,000（手残り大） */
  await add(env,1,800,6000);
  await add(env,2,45000,20000);
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true, plan:'light' });
  console.log('   light '+JSON.stringify({ add:(r.plans||[])
    .filter((x)=>x.key==='light').map((x)=>x.add)[0],
    jan:await sentJans(env,LI) }));
  ok(await sentJans(env,LI)==='1',
     '★★★ライトは順位の良い品（早い品）を先に出す');
}
{
  /* 同じ2件を**スタンダード向け**（印）にして、上のプランの順を見る。 */
  const env=env0();
  await setCfg(env,{ subNStandard:1 });
  await add(env,1,800,6000,'standard');
  await add(env,2,45000,20000,'standard');
  dc=[];
  await api(env,'/sub/send',{ approve:true, plan:'standard' });
  console.log('   standard '+JSON.stringify({ jan:await sentJans(env,ST) }));
  ok(await sentJans(env,ST)==='2',
     '★★★スタンダードは手残りの大きい品を先に出す（順位は悪くても）');
}

console.log('\n=== ⑥ 並べ替えても「新しく出す件数」は変わらない ===');
{
  const env=env0();
  await setCfg(env,{ subNLight:2 });
  await add(env,1,800,6000);
  await add(env,2,45000,20000);
  await add(env,3,2000,9000);
  dc=[];
  const r1=await api(env,'/sub/send',{ approve:true, plan:'light' });
  const p1=(r1.plans||[]).filter((x)=>x.key==='light')[0]||{};
  console.log('   1回目 '+JSON.stringify({ add:p1.add,
    post:dc.filter((x)=>x.method==='POST').length,
    jan:await sentJans(env,LI) }));
  ok(p1.add===2&&dc.filter((x)=>x.method==='POST').length===2,
     '★★★1回目は⚙の件数（2件）だけ');
  ok(await sentJans(env,LI)==='13',
     '★★★早い順に2件（順位 800・2,000）');
  dc=[];
  const r2=await api(env,'/sub/send',{ approve:true, plan:'light' });
  const p2=(r2.plans||[]).filter((x)=>x.key==='light')[0]||{};
  ok(p2.add===1,'★★2回目は残りの1件（前の2件は件数に数えない）');
  ok(await sentJans(env,LI)==='123','★★3件ぜんぶ出ている');
}

T.done();
