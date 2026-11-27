/* Worker：会員向け Discord の買えなくなったカードを消す（8.111・v362）

   カジの依頼（2026-11-27）受付終了に書き換えるだけではチャンネルに残り続け、新しいモニターが
   古いカードを押して「買えない」「会員専用のページ」になっていた。
   ① 購入期限（モニター・配信から7日）を過ぎた／売り切れた（上限・MW の在庫）／プランから外した
      カードは、Discord のメッセージを消す
   ② 毎時の見回りで消す（自動配信がオフでも動く）
   ③ 消した記録（JAN・チャンネル・送った日・消した日・理由）は D1（sub_del）。sub_post の行は残す
   ④ ピン留めの「今週の一覧」は消さずに書き換える
   ⑤ 再入荷・期限の延長でまた出すときは新しいカードとして送る
   ⑥ 残っている古いカード（11/15 のテスト配信の分を含む）をまとめて消す（確認の件数つき）
   ⑦ ボットの権限が足りないときはそう出す */
import fs from 'node:fs';
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：買えなくなったカードを消す（8.111）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('subprune');
let dc=[], deny=0, goneIds={};
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{}, m=String(o.method||'GET');
  if(/\/api\/webhooks\//.test(url))return new Response(null,{status:204});
  if(/discord\.com\/api/.test(url)){
    const cc=/\/channels\/(\d+)$/.exec(url);
    if(cc)return new Response(JSON.stringify({ id:cc[1], name:'ch-'+cc[1], guild_id:'555' }),{status:200});
    const mm=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    dc.push({ method:m, ch:mm[1]||'', msg:mm[2]||'', body:o.body?JSON.parse(String(o.body)):null });
    if(m==='DELETE'&&deny)return new Response(JSON.stringify({code:50013,message:'Missing Permissions'}),{status:403});
    if(m==='DELETE'&&goneIds[mm[2]])return new Response(JSON.stringify({code:10008,message:'Unknown Message'}),{status:404});
    if(m==='DELETE')return new Response(null,{status:204});
    return new Response(JSON.stringify({ id:String(800000+dc.length) }),{status:200});
  }
  return new Response('{}',{status:200});
};
const MON='1111111111', LI='2222222222', PR='3333333333';
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123', DISCORD_BOT_TOKEN:'bot-token-xyz',
  DISCORD_WEBHOOK_URL:'https://discord.com/api/webhooks/1/abc' });
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:false, subAutoOn:false, subChMonitor:MON, subChLight:LI, subChPremium:PR,
      subOnLight:true, subOnPremium:true, gdIdxOn:false,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }), new Date().toISOString()).run();
const J=(n)=>'49023705505'+String(n).padStart(2,'0');
const item=async(env,jan,o)=>{
  const at=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,created_at,pick)
    VALUES (?1,'い',0,'NS',?2,?3,'h',?4,?4,1)`).bind(jan,'商品'+jan.slice(-2),(o||{}).stock===undefined?9:o.stock,at).run();
  await env.DB.prepare(`INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,rank,rank_cat,new_n,amz,checked_at,basis,price_at)
    VALUES (?1,'B0D1GSZJ8T',?2,9000,1200,'s',12000,'ゲーム',4,0,?3,'カート',?3)`).bind(jan,'A'+jan,at).run();
  await env.DB.prepare(`INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
    VALUES (?1,1,?2,3645,?3,?4,?4,?4,?4)`).bind(jan,(o||{}).qty===undefined?3:o.qty,(o||{}).grades||'light,standard,premium',at).run();
};
const card=(env,jan,ch,plan,msg,at,o)=>env.DB.prepare(
  `INSERT INTO sub_post (jan,ch,plan,msg_id,price,qty,sold,sold_out,at,created_at,off_at)
   VALUES (?1,?2,?3,?4,3645,?5,?6,?7,?8,?8,?9)`)
  .bind(jan,ch,plan,msg,(o||{}).qty||3,(o||{}).sold||0,(o||{}).soldOut||0,at,(o||{}).off||null).run();
const api=async(env,path,body)=>(await asJson(await worker.fetch(body?post(path,body):get(path),env,{}))).body;
const ago=(d)=>new Date(Date.now()-d*86400000).toISOString();
const allMode=(env)=>env.DB.prepare(`INSERT INTO sync_state (k,v,updated_at) VALUES ('sub.prune.from','all',?1)
  ON CONFLICT(k) DO UPDATE SET v='all'`).bind(new Date().toISOString()).run();
const post1=async(env,jan,ch)=>await env.DB.prepare(`SELECT * FROM sub_post WHERE jan=?1 AND ch=?2`).bind(jan,ch).first();

console.log('=== ① 消す理由 ===');
let env=env0(); await setCfg(env);
await allMode(env);
await item(env,J(1)); await card(env,J(1),LI,'light','701',ago(1));               // 残す
await item(env,J(2),{ qty:2 }); await card(env,J(2),LI,'light','702',ago(1));
await env.DB.prepare(`INSERT INTO sub_order (order_id,jan,qty,at,created_at) VALUES ('o1',?1,2,?2,?2)`).bind(J(2),new Date().toISOString()).run().catch(()=>{});
await card(env,J(3),LI,'light','703',ago(1));                                       // リストに無い
await item(env,J(4),{ grades:'premium' }); await card(env,J(4),LI,'light','704',ago(1)); // プランから外した
await item(env,J(5)); await card(env,J(5),MON,'monitor','705',ago(8));              // モニターの期限切れ
await item(env,J(6),{ stock:0 }); await card(env,J(6),LI,'light','706',ago(1));     // MW の在庫が無い
await item(env,J(7)); await card(env,J(7),LI,'light','707',ago(1),{ soldOut:1 });    // 完売の印
await item(env,J(8)); await card(env,J(8),PR,'premium','708',ago(1));               // 残す
const cfg0=await (async()=>{ const r=await api(env,'/sub/prune?bulk=0'); return r; })();
console.log('   予定：'+JSON.stringify(cfg0.by));
dc=[];
let r=await W.jobSubPrune(env,{});
const dels=dc.filter((x)=>x.method==='DELETE').map((x)=>x.msg).sort();
console.log('   消した：'+dels.join(',')+' '+JSON.stringify(r.by));
ok(r.ok&&!dels.includes('701')&&!dels.includes('708'),'★★★まだ買えるカードは消さない');
ok(dels.includes('703')&&r.by.gone>=1,'★★★リストから外れた品（在庫が無い・販売終了）のカードを消す');
ok(dels.includes('704')&&r.by.off_plan>=1,'★★★そのプランから外したカードを消す（ほかのプランは残す）');
ok(dels.includes('705')&&r.by.expired===1,'★★★モニターの購入期限（7日）を過ぎたカードを消す');
ok(dels.includes('707')&&r.by.sold_out>=1,'★★★売り切れたカードを消す');
ok(dels.includes('706'),'★★MW の在庫が無くなった品のカードを消す');
ok(dc.filter((x)=>x.method==='PATCH'&&/受付終了/.test(JSON.stringify(x.body||''))).length===0,'★★「受付終了」には書き換えない');
const p3=await post1(env,J(3),LI);
ok(!!p3&&p3.msg_id===''&&!p3.off_at,'★★★sub_post の行は残す（msg_id を空にする）');
const d3=await env.DB.prepare(`SELECT * FROM sub_del WHERE jan=?1`).bind(J(3)).first();
ok(!!d3&&d3.ch===LI&&d3.plan==='light'&&d3.msg_id==='703'&&d3.sent_at===p3.at&&!!d3.del_at&&d3.why==='gone',
   '★★★消した記録（JAN・チャンネル・送った日・消した日・理由）を D1 に残す');
ok(!/name|price/.test(fs.readFileSync(new URL('../proxy-sync/migrate-0077-sub-del.sql',import.meta.url),'utf8').replace(/--.*$/gm,'')),
   '★記録に商品名・値段は持たない');
const cnt=Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM sub_post`).first()).n);
ok(cnt===8,'★★★配信の控え（sub_post）の件数は変わらない（前の週までに出した品として数える）');
dc=[]; r=await W.jobSubPrune(env,{});
ok(dc.filter((x)=>x.method==='DELETE').length===0,'★★二度は消さない');

console.log('\n=== ② 自動配信がオフでも毎時の見回りで動く・⚙で止められる ===');
const src=fs.readFileSync(new URL('../proxy-sync/worker.js',import.meta.url),'utf8');
const hourly=src.slice(src.indexOf('await jobHourly(env);'),src.indexOf('await jobPhaseB(env, {});',src.indexOf('await jobHourly(env);')));
ok(/try \{ await jobSubPrune\(env, \{\}\); \}/.test(hourly)&&hourly.indexOf('jobSubPrune')>hourly.indexOf('sc.on && jt.hour'),
   '★★★毎時の回で（自動配信の入／切に関係なく）見回る');
const e2=env0(); await setCfg(e2,{ subPruneOn:false }); await allMode(e2);
await card(e2,J(3),LI,'light','713',ago(1));
dc=[]; r=await W.jobSubPrune(e2,{});
ok(r.ok&&dc.length===0&&/オフ/.test(r.why),'★⚙で「自動で消す」を切れば消さない');

console.log('\n=== ③ 入れる前に出した古いカードは、確認してからまとめて消す ===');
const e3=env0(); await setCfg(e3,{ subMonFrom:'2026-11-20' });
await item(e3,J(1)); await card(e3,J(1),LI,'light','721','2026-11-15T01:00:00Z');      // テスト配信（まだ買える）
await card(e3,J(3),LI,'light','722',ago(2));                                             // 古い・リストに無い
await item(e3,J(9)); await card(e3,J(9),PR,'premium','723',ago(3),{ off:ago(3) });      // 受付終了にしてあった
dc=[]; r=await W.jobSubPrune(e3,{});
ok(dc.filter((x)=>x.method==='DELETE').length===0,'★★★まとめて消す前は、毎時の見回りは入れる前に出したカードを消さない（確認なしに消さない）');
await card(e3,J(4),LI,'light','724',new Date(Date.now()+1000).toISOString());          // 入れたあとに出した
dc=[]; r=await W.jobSubPrune(e3,{});
ok(dc.filter((x)=>x.method==='DELETE').map((x)=>x.msg).join()==='724','★★入れたあとに出したカードは見回りで消す');
const pv=await api(e3,'/sub/prune');
console.log('   確認：'+pv.n+'件 '+JSON.stringify(pv.chs.map((c)=>({ch:c.ch,name:c.name,n:c.n,by:c.by}))));
ok(pv.ok&&pv.n===3,'★★★確認の画面に「消すカード ◯件」');
const li=pv.chs.find((c)=>c.ch===LI), pr=pv.chs.find((c)=>c.ch===PR);
ok(li&&li.n===2&&li.by.test===1&&li.by.gone===1&&pr&&pr.n===1&&pr.by.closed===1,
   '★★★チャンネルごと・理由ごとの件数（テスト配信・リストから外れた・受付終了にしてあった）');
ok(dc.filter((x)=>x.method==='DELETE').length===1,'★確認では何も消さない');
const stf=await asJson(await worker.fetch(new Request('https://x/sub/prune?bulk=1',{headers:{'X-PJ-Key':'staff-key-123'}}),e3,{}));
ok(stf.status===403,'★★確認・まとめて消すのは管理者だけ');
dc=[];
const b=await api(e3,'/sub/prune',{ bulk:true });
console.log('   まとめて：'+JSON.stringify({del:b.del,by:b.by,all:b.all}));
ok(b.ok&&b.del===3&&dc.filter((x)=>x.method==='DELETE').map((x)=>x.msg).sort().join()==='721,722,723',
   '★★★まとめて消す（11/15 のテスト配信・受付終了にしてあったカードも）');
const st=await e3.DB.prepare(`SELECT v FROM sync_state WHERE k='sub.prune.from'`).first();
ok(st.v==='all','★★まとめて消し終えたら、毎時の見回りはぜんぶのカードを見る');

console.log('\n=== ④ ピン留めの「今週の一覧」は消さずに書き換える ===');
const e4=env0(); await setCfg(e4,{ gdIdxOn:true }); await allMode(e4);
await item(e4,J(1)); await card(e4,J(1),LI,'light','731',ago(1));
await card(e4,J(3),LI,'light','732',ago(1));
dc=[]; r=await W.jobSubPrune(e4,{});
ok(!!r.index,'★★★消したら「今週の一覧」を書き換える（jobSubIndex）');
ok(dc.filter((x)=>x.method==='DELETE').every((x)=>x.msg==='732'),'★★一覧のメッセージは消さない（消すのはカードだけ）');

console.log('\n=== ⑤ 再入荷・期限の延長は新しいカードとして送る ===');
const e5=env0(); await setCfg(e5,{ subOn:true, subChMonitor:'' }); await allMode(e5);
await item(e5,J(1),{ qty:3, grades:'light' });
await api(e5,'/sub/send',{ approve:true });
const c1=await post1(e5,J(1),LI);
ok(!!c1&&!!c1.msg_id,'★送ったカード');
await e5.DB.prepare(`UPDATE mw_sub SET max_qty=0 WHERE jan=?1`).bind(J(1)).run();
await W.jobSubPrune(e5,{});
ok((await post1(e5,J(1),LI)).msg_id==='','★上限0にしたら消す');
await e5.DB.prepare(`UPDATE mw_sub SET max_qty=3 WHERE jan=?1`).bind(J(1)).run();
dc=[];
await api(e5,'/sub/send',{ approve:true });
const c2=await post1(e5,J(1),LI);
ok(dc.some((x)=>x.method==='POST'&&x.ch===LI)&&!!c2.msg_id&&c2.msg_id!==c1.msg_id&&c2.at>=c1.at,
   '★★★再入荷したら新しいカードとして送り直す（送った日も新しくする）');

console.log('\n=== ⑥ 権限が足りない・もう無いメッセージ ===');
const e6=env0(); await setCfg(e6); await allMode(e6);
for(let n=10;n<18;n++)await card(e6,J(n),LI,'light',String(740+n),ago(1));
deny=1; dc=[];
r=await W.jobSubPrune(e6,{});
deny=0;
console.log('   '+r.why);
ok(r.fail===5&&r.stopped&&/チャンネルを見る/.test(r.why),'★★★権限が足りないときは理由を出して、続けて5件失敗したら止める');
ok(Number((await e6.DB.prepare(`SELECT COUNT(*) AS n FROM sub_post WHERE msg_id<>''`).first()).n)===8,'★★消せなかったカードの控えはそのまま（次の回でまた消す）');
goneIds['750']=1;
r=await W.jobSubPrune(e6,{});
ok(r.gone===1&&r.del===7,'★もう無いメッセージ（404）は控えだけ片づける');
const migr=fs.readFileSync(new URL('../proxy-sync/migrate-0077-sub-del.sql',import.meta.url),'utf8');
ok(/CREATE TABLE IF NOT EXISTS sub_del/.test(migr)&&W.schemaFixOf('sub_del')==='migrate-0077-sub-del.sql','★表を足すだけ・表が無いときに流すマイグレーション');
T.done();
