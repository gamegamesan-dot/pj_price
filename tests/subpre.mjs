/* Worker：予告・受付終了・今週のねらい目（8.31・カジの依頼・v289）

   ① 予告は「**翌朝に新しく出るカードがある日だけ**」出す（件数も新しい数）
      8.29 までは items.length（前に送って何も変わっていないカードまで）を
      数えていたので、リストが変わらない日も毎日予告が出て、翌朝は新しい
      カードが1枚も出ないことがあった。
   ② 新しく出るカードが0件のチャンネルには**何も出さない**
      （書き換えは通知が鳴らないので、知らせることが無い）
   ③ リストから外れた商品（MW 欠品・販売終了・上限0）の前のカードを
      「この商品の受付は終わりました」に**書き換える**（消さない）
   ④ 週1回の「今週のねらい目」（⚙・既定オフ）。◎ から最大◯件、
      すでに出したカードへのリンクを1通にまとめる
   ⑤ 予定に「自動の回で何が起きるか」を返す */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import SUBGUIDE from '../shared/subguide.js';
const T=harness('Worker：予告・受付終了・今週のねらい目（8.31）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('subpre');

let dc=[], notes=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/\/api\/webhooks\//.test(url)){
    notes.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response(null,{status:204});
  }
  if(/discord\.com\/api/.test(url)){
    const cc=/\/channels\/(\d+)$/.exec(url);
    if(cc)return new Response(JSON.stringify({ id:cc[1], name:'ch-'+cc[1],
      guild_id:'555000555' }),
      {status:200,headers:{'content-type':'application/json'}});
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    dc.push({ method:String(o.method||'GET'), ch:m[1]||'', msg:m[2]||'',
      body:o.body?JSON.parse(String(o.body)):null });
    return new Response(JSON.stringify({ id:String(900000+dc.length) }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  return new Response('{}',{status:200});
};
const CH='1111111111';
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz',
  DISCORD_WEBHOOK_URL:'https://discord.com/api/webhooks/1/abc' });
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subPre:true, subChMonitor:CH,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const JAN=['4902370550467','4902370550468','4902370550469'];
const stock=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,created_at)
   VALUES (?1,'いろは商会',0,?2,?3,?4,'h',?5,?5)`)
  .bind(jan,(o||{}).kishu||'NS',(o||{}).name||('商品'+jan.slice(-3)),
        (o||{}).stock===undefined?9:(o||{}).stock,
        new Date().toISOString()).run();
/* ◎（ねらい目）になる行：よく売れて・ライバルが少なく・利益率が高い。 */
const amz=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,rank,rank_cat,
     new_n,amz,checked_at,basis,price_at)
   VALUES (?1,?2,?3,?4,?5,'s',?6,'ゲーム',?7,?8,?9,'カート',?9)`)
  .bind(jan,(o||{}).asin||'B0D1GSZJ8T',(o||{}).name||('Amazon '+jan.slice(-3)),
        (o||{}).price||9000,(o||{}).fee||1200,
        (o||{}).rank===undefined?12000:(o||{}).rank,
        (o||{}).newN===undefined?4:(o||{}).newN,(o||{}).amzSelf||0,
        new Date().toISOString()).run();
const sub=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
   VALUES (?1,1,?2,?3,'',?4,?4,?4,?4)`)
  .bind(jan,(o||{}).qty===undefined?1:(o||{}).qty,(o||{}).price||3645,
        new Date().toISOString()).run();
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;

console.log('=== ① 予告は「新しく出るカードがある日だけ」===');
{
  const env=env0();
  await setCfg(env,{});
  await stock(env,JAN[0]); await amz(env,JAN[0]); await sub(env,JAN[0]);
  await stock(env,JAN[1]); await amz(env,JAN[1]); await sub(env,JAN[1]);
  dc=[];
  const r=await api(env,'/sub/pre',{});
  const txt=String(((dc[0]||{}).body||{}).content||'');
  console.log('   '+txt.split('\n')[0]);
  ok(r.sent===1&&dc.length===1,'★★★新しく出るカードがある日は予告を出す');
  ok(/2件の予定/.test(txt),'★★★件数は「新しく出る数」');
  ok(/明日/.test(txt)&&/08:00/.test(txt),
     '★★★時刻を書く（⚙を触っていなければ既定の8時）');
  ok(!/@everyone|@here/.test(txt),'★★★@everyone・@here は使わない');
  /* 送ってしまえば、次の日は「そのまま」なので予告しない。 */
  await api(env,'/sub/send',{ approve:true });
  await env.DB.prepare(`DELETE FROM sync_state WHERE k='sub.pre'`).run();
  dc=[];
  const r2=await api(env,'/sub/pre',{});
  console.log('   '+String(r2.why||''));
  ok(r2.sent===0&&dc.length===0,
     '★★★変わらない日は予告しない（翌朝に新しいカードが出ないため）');
  ok(/新しく出るカードがありません/.test(String(r2.why||'')),
     '★★なぜ出さないかを返す');
  ok((r2.plans||[])[0]&&(r2.plans||[])[0].add===0,
     '★プランごとの件数も返す');
  /* 値段を変えると「書き換え」になるが、**書き換えだけでは予告しない**。 */
  await env.DB.prepare(`UPDATE mw_sub SET price=3900 WHERE jan=?1`)
    .bind(JAN[0]).run();
  await env.DB.prepare(`DELETE FROM sync_state WHERE k='sub.pre'`).run();
  dc=[];
  const r3=await api(env,'/sub/pre',{});
  console.log('   書き換えだけの日：'+JSON.stringify((r3.plans||[])[0]));
  ok(r3.sent===0&&dc.length===0,
     '★★★書き換えだけの日は予告しない（通知が鳴らないので知らせることが無い）');
  ok((r3.plans||[])[0].edit===1,'★★書き換えの件数は分かる');
}

console.log('=== ② 新しく出るカードが0件のチャンネルには何も出さない ===');
{
  const env=env0();
  await setCfg(env,{});
  await stock(env,JAN[0]); await amz(env,JAN[0]); await sub(env,JAN[0]);
  await api(env,'/sub/send',{ approve:true });
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true });
  console.log('   '+JSON.stringify({ sent:r.sent, edited:r.edited,
    skipped:r.skipped, dc:dc.length }));
  ok(r.sent===0&&dc.filter((x)=>x.method==='POST').length===0,
     '★★★新しく出すものが無ければ1通も出さない');
  ok(dc.length===0,'★★★書き換えるものも無ければ何も触らない');
  /* 値段が変わった日は「書き換え」だけ（新しいメッセージは出さない）。 */
  await env.DB.prepare(`UPDATE mw_sub SET price=3900 WHERE jan=?1`)
    .bind(JAN[0]).run();
  dc=[];
  const r2=await api(env,'/sub/send',{ approve:true });
  ok(r2.edited===1&&dc.filter((x)=>x.method==='PATCH').length===1
     &&dc.filter((x)=>x.method==='POST').length===0,
     '★★★書き換えの日は PATCH だけ（新しい通知を鳴らさない）');
}

console.log('=== ③ リストから外れた商品のカードを「受付終了」に ===');
{
  const env=env0();
  await setCfg(env,{});
  await stock(env,JAN[0]); await amz(env,JAN[0]); await sub(env,JAN[0]);
  await stock(env,JAN[1]); await amz(env,JAN[1]); await sub(env,JAN[1]);
  await api(env,'/sub/send',{ approve:true });
  /* JAN[1] をリストから外す（上限0＝販売終了の扱い）。 */
  await env.DB.prepare(`UPDATE mw_sub SET max_qty=0 WHERE jan=?1`)
    .bind(JAN[1]).run();
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true });
  const pt=dc.filter((x)=>x.method==='PATCH');
  console.log('   '+JSON.stringify(r.retire)+' / PATCH '+pt.length);
  ok(r.retire&&r.retire.off===1,'★★★外れた商品のカードを1件書き換える');
  ok(pt.length===1&&/受付終了/.test(JSON.stringify(pt[0].body)),
     '★★★「受付終了」のカードに書き換える');
  ok(/この商品の受付は終わりました/.test(JSON.stringify(pt[0].body)),
     '★★★文は「この商品の受付は終わりました」');
  ok(dc.filter((x)=>x.method==='DELETE').length===0,
     '★★★既定では消さない（残す）');
  const row=await env.DB.prepare(
    `SELECT off_at FROM sub_post WHERE jan=?1`).bind(JAN[1]).first();
  ok(String((row||{}).off_at||'')!=='','★★控えに受付終了の時刻が入る');
  /* 二度は書き換えない。 */
  dc=[];
  const r2=await api(env,'/sub/send',{ approve:true });
  ok((r2.retire||{}).off===0&&dc.length===0,
     '★★★一度書き換えたカードは二度触らない');
  /* ⚙に日数を入れると、そのあいだを置いてから消す。 */
  await setCfg(env,{ subOffDays:3 });
  dc=[];
  const r3=await api(env,'/sub/send',{ approve:true });
  ok((r3.retire||{}).del===0&&dc.length===0,
     '★★★日数がたつまでは消さない');
  await env.DB.prepare(`UPDATE sub_post SET off_at=?2 WHERE jan=?1`)
    .bind(JAN[1],new Date(Date.now()-5*86400000).toISOString()).run();
  dc=[];
  const r4=await api(env,'/sub/send',{ approve:true });
  console.log('   '+JSON.stringify(r4.retire));
  ok((r4.retire||{}).del===1
     &&dc.filter((x)=>x.method==='DELETE').length===1,
     '★★★日数がたったら消す（⚙で選んだときだけ）');
  const gone=await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sub_post WHERE jan=?1`).bind(JAN[1]).first();
  ok(Number((gone||{}).n)===0,'★★控えも片づける');
  /* 1点もの（one-…）は別の仕組みなので触らない。 */
  const e2=env0();
  await setCfg(e2,{});
  await e2.DB.prepare(
    `INSERT INTO sub_post (jan,ch,plan,msg_id,price,qty,at,created_at)
     VALUES ('one-3',?1,'one_pre','900001',3000,1,?2,?2)`)
    .bind(CH,new Date().toISOString()).run();
  dc=[];
  const r5=await api(e2,'/sub/send',{ approve:true });
  ok((r5.retire||{}).off===0&&dc.filter((x)=>x.msg==='900001').length===0,
     '★★★1点もののカードには触らない');
}

console.log('=== ④ 今週のねらい目（⚙・既定オフ）===');
{
  const env=env0();
  await setCfg(env,{});
  for(const j of JAN){ await stock(env,j); await amz(env,j); await sub(env,j); }
  await setCfg(env,{ subNMonitor:5 });
  await api(env,'/sub/send',{ approve:true });
  dc=[];
  const off=await api(env,'/sub/hot',{});
  ok(off.sent===0&&dc.length===0,'★★★既定はオフ（出さない）');
  ok(/オフ/.test(String(off.why||'')),'★なぜ出さないかを返す');
  /* オンにすると、◎ の商品のリンクを1通で出す。 */
  await setCfg(env,{ subNMonitor:5, subHotOn:true, subHotN:2 });
  dc=[];
  const r=await api(env,'/sub/hot',{});
  const txt=String(((dc[0]||{}).body||{}).content||'');
  console.log('   '+txt.replace(/\n/g,' / '));
  ok(r.sent===1&&dc.length===1&&dc[0].method==='POST',
     '★★★1通にまとめて出す');
  ok(/今週のねらい目/.test(txt),'★★★見出しは「今週のねらい目」');
  ok((txt.match(/^・/gm)||[]).length===2,
     '★★★⚙の件数（2件）まで');
  ok(/discord\.com\/channels\/555000555\/1111111111\/90000/.test(txt),
     '★★★すでに出したカードへのリンクを出す');
  ok(/目安です/.test(txt),'★★「目安です」を添える');
  ok(!/@everyone|@here/.test(txt),'★★★@everyone・@here は使わない');
  const am=((dc[0]||{}).body||{}).allowed_mentions;
  ok(am&&Array.isArray(am.parse)&&am.parse.length===0,
     '★★★だれにも通知しない（allowed_mentions を空にする）');
  ok((r.picked||[]).length===2,'★選んだ商品を控える');
  /* 同じ日に2回は出さない。 */
  dc=[];
  const r2=await api(env,'/sub/hot',{});
  ok(r2.sent===0&&/もう出しています/.test(String(r2.why||'')),
     '★★同じ日に2回は出さない');
  /* 先週選んだ商品は後ろに回す（2週続けて選ばれにくく）。 */
  const first=(r.picked||[]).slice().sort().join(',');
  await env.DB.prepare(`DELETE FROM sync_state WHERE k='sub.hot'`).run();
  dc=[];
  const r3=await api(env,'/sub/hot',{});
  const second=(r3.picked||[]).slice().sort().join(',');
  console.log('   先週：'+first+' → 今週：'+second);
  ok(first!==second,'★★★先週選んだ商品は後ろに回す');
  /* ◎ でない商品は選ばない。 */
  const e2=env0();
  await setCfg(e2,{ subHotOn:true });
  await stock(e2,JAN[0]); await sub(e2,JAN[0]);
  /* ライバルが多く売れ行きも悪い（△ になる）行。 */
  await amz(e2,JAN[0],{ rank:400000, newN:40 });
  await api(e2,'/sub/send',{ approve:true });
  dc=[];
  const r4=await api(e2,'/sub/hot',{});
  console.log('   '+String(r4.why||''));
  ok(r4.sent===0&&dc.filter((x)=>x.method==='POST').length===0,
     '★★★◎ の商品が無ければ出さない');
  ok(/の商品がありません/.test(String(r4.why||'')),'★★理由を返す');
}

console.log('=== ⑤ 予定に「自動の回で何が起きるか」===');
{
  const env=env0();
  await setCfg(env,{ subHotOn:true, subHotDow:5, subHotN:3, subOffDays:7 });
  await stock(env,JAN[0]); await amz(env,JAN[0]); await sub(env,JAN[0]);
  const d=await api(env,'/sub/plan');
  console.log('   '+JSON.stringify(d.auto));
  const a=d.auto||{};
  ok(a.on===true&&a.hour===8,
     '★★★自動配信の入／切と時刻を返す（既定は8時）');
  ok(a.add===1&&a.edit===0,'★★★新しく出る数・書き換える数を返す');
  ok(a.pre===true&&a.pre_n===1&&(a.pre_plans||[])[0]==='モニター',
     '★★★予告を出すか・何件かを返す');
  ok(a.hot_on===true&&a.hot_dow===5&&a.hot_n===3,
     '★★今週のねらい目の⚙も返す');
  ok(a.off_days===7,'★受付終了を消す日数も返す');
  /* 送ったあとは「新しく出るもの無し・予告なし」になる。 */
  await api(env,'/sub/send',{ approve:true });
  const d2=await api(env,'/sub/plan');
  console.log('   送ったあと：'+JSON.stringify(d2.auto));
  ok((d2.auto||{}).add===0&&(d2.auto||{}).pre===false,
     '★★★送ったあとは「予告を出しません」になる');
}

T.done();
