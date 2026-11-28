/* 決まり＋Worker：モニターにはライトと同じ品を配る・Amazon のカートの値段（8.116・カジの依頼）

   ・⚙「モニターにはライトと同じ品を配る」（既定オン）。①の配信の案でも、モニターはライトと同じ品
   ・購入の制限はモニターのまま（お一人1点・購入期限。カードの「購入できる数」の書き方も今と同じ）
   ・ライトに出す品には Shopify の grade-monitor も付ける（モニター会員が買えるように）
   ・まとめて消す処理で、ライトと同じ品のモニターのカードを「プランに合わない」で消さない
   ・カートの値段が新品の最安値より大きく下（9割より安い）なら新品の最安値を使う
   ・「いますぐ配る」（Actions の sub_now）：モニターに足りないカードだけを出し、
     ほかは書き換えだけ（消さない・二重にしない）。一覧も書き換える。記録は数だけ */
import fs from 'node:fs';
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import SUBPLAN from '../shared/subplan.js';
import * as DIAG from '../proxy-sync/d1-diag.mjs';
const T=harness('決まり：モニターにはライトと同じ品（8.116）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('submonsame');

console.log('=== ① ⚙と Shopify のタグ（grade-monitor）===');
{
  ok(SUBPLAN.pickOpt({}).monSame===true,'★★★既定でオン');
  ok(SUBPLAN.pickOpt({ subMonSame:false }).monSame===false,'★★★⚙で切れる');
  ok(SUBPLAN.monSameGrades('light,standard,premium',true)==='monitor,light,standard,premium',
     '★★★ライトに出す品には grade-monitor も付ける');
  ok(SUBPLAN.monSameGrades('light,standard,premium',false)==='light,standard,premium',
     '★★★⚙がオフなら今までどおり');
  ok(SUBPLAN.monSameGrades('standard,premium',true)==='standard,premium',
     '★★ライトに出さない品には付けない');
  ok(SUBPLAN.monSameGrades('',true)==='','★★空（全プラン）はそのまま（タグなし＝誰でも）');
  ok(SUBPLAN.monSameGrades('monitor,light',true)==='monitor,light','★もう付いていれば二重にしない');
}

console.log('=== ② 配信の案でもモニターはライトと同じ品 ===');
{
  const rows=[];
  for(let i=0;i<9;i++) rows.push({ jan:'49023705509'+i, name:'ゲーム'+i, fit:true, rst:'ok',
    price:2000+i, qty:3, gross:800, speed:3+i, stock:9, is_game:true, grades:'', amz:0, buy_qty:0 });
  const cfg={ subOnLight:true, subOnMonitor:true, subChLight:'2', subChMonitor:'1',
              subLimNLight:8, subMonSpeedMin:'0.1' };
  const plans=SUBPLAN.list(cfg).filter((p)=>p.key==='light'||p.key==='monitor');
  const d=SUBPLAN.draft(rows,plans,cfg,[],Date.now()).plans;
  const li=d.filter((x)=>x.key==='light')[0], mo=d.filter((x)=>x.key==='monitor')[0];
  console.log('   ライト '+li.items.length+'件／モニター '+mo.items.length+'件');
  ok(li.items.length===8&&mo.items.map((x)=>x.jan).join()===li.items.map((x)=>x.jan).join(),
     '★★★案のモニターはライトと同じ8件（同じ並び）');
  ok(mo.items.every((x)=>x.plan==='monitor')&&mo.same===true,'★★モニターのカードとして出す');
  const d2=SUBPLAN.draft(rows,plans,Object.assign({ subMonSame:false },cfg),[],Date.now()).plans;
  const mo2=d2.filter((x)=>x.key==='monitor')[0];
  ok(mo2.items.length===5&&!mo2.same,'★★★⚙を切ればモニターは今までどおり（新しく5件）');
}

console.log('=== ③ Amazon の販売価格：カートが新品の最安値より大きく下なら最安値 ===');
{
  const p=W.amzPick(2930,5500);
  ok(p.price===5500&&p.basis==='最安','★★★カート ¥2,930・新品の最安値 ¥5,500 → ¥5,500（最安）');
  ok(W.amzPick(5200,5500).price===5200&&W.amzPick(5200,5500).basis==='カート',
     '★★★少し下（9割以上）ならカートのまま');
  ok(W.amzPick(6000,5500).basis==='カート','★★カートが最安値より上ならカート');
  ok(W.amzPick(0,5500).basis==='最安'&&W.amzPick(3000,0).basis==='カート'&&W.amzPick(0,0).price===0,
     '★片方しか無いときは今までどおり');
  const src=fs.readFileSync(new URL('../proxy-sync/worker.js',import.meta.url),'utf8');
  ok(!/buy > 0 \? buy : lw/.test(src)&&!/Number\(got\.buy\) > 0 \? got\.buy : got\.low/.test(src)
     &&(src.match(/amzPick\(/g)||[]).length>=4,
     '★★★値段を決める3か所は amzPick の1か所の決まりを使う');
  ok(/mwAmzCartFix\(env\)[\s\S]{0,400}SUBAUTO\.dueSched/.test(src),'★★控えの値段の直しは毎時、配信より前');

  const env=makeEnv({});
  const at=new Date().toISOString();
  const ins=(jan,price,low,basis,ref,tot)=>env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,low,buybox,basis,fee_ref,fee_total,fee_base,checked_at,created_at)
     VALUES (?1,'B0TEST',?2,?3,?4,?3,?5,?6,?7,?3,?8,?8)`).bind(jan,'A'+jan,price,low,basis,ref,tot,at).run();
  await ins('4595121489019',2930,5500,'カート',293,1200);
  await ins('4902370550001',5200,5500,'カート',520,1500);
  await ins('4902370550002',5500,6000,'最安',550,1500);
  const r=await W.mwAmzCartFix(env);
  const a=await env.DB.prepare(`SELECT * FROM mw_amz WHERE jan='4595121489019'`).first();
  const b=await env.DB.prepare(`SELECT * FROM mw_amz WHERE jan='4902370550001'`).first();
  console.log('   直した '+r.n+'件：'+JSON.stringify({ price:a.price, basis:a.basis, ref:a.fee_ref, tot:a.fee_total }));
  ok(r.n===1&&a.price===5500&&a.basis==='最安','★★★控えのカートの値段を新品の最安値に直す');
  ok(a.fee_ref===550&&a.fee_total===1457,'★★販売手数料は値段に比例するぶんだけ合わせる（293→550・合計 1200→1457）');
  ok(a.fee_base===2930,'★★手数料の取り直しの基準は残す（1割以上変わったので次に取り直す）');
  ok(b.price===5200&&b.basis==='カート','★★少し下のカートは直さない');
  const r2=await W.mwAmzCartFix(env);
  ok(r2.n===0,'★★何度走らせても同じ（2回目は0件）');
}

/* ---- Worker：配る・いますぐ配る・まとめて消す ---- */
let dc=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{}, m=String(o.method||'GET');
  if(/\/api\/webhooks\//.test(url))return new Response(null,{status:204});
  if(/discord\.com\/api/.test(url)){
    const cc=/\/channels\/(\d+)$/.exec(url);
    if(cc)return new Response(JSON.stringify({ id:cc[1], name:'ch-'+cc[1], guild_id:'555' }),{status:200});
    const mm=/\/channels\/(\d+)\/(?:messages|pins)(?:\/(\d+))?/.exec(url)||[];
    let body=null; try{ body=o.body?JSON.parse(String(o.body)):null; }catch(e){ body=null; }
    dc.push({ method:m, ch:mm[1]||'', msg:mm[2]||'', body, pin:/\/pins/.test(url) });
    if(m==='DELETE')return new Response(null,{status:204});
    if(m==='PUT')return new Response(null,{status:204});
    if(m==='GET')return new Response('[]',{status:200});
    return new Response(JSON.stringify({ id:String(mm[2]||(800000+dc.length)) }),{status:200});
  }
  return new Response('{}',{status:200});
};
const MON='1111111111', LI='2222222222';
const env=makeEnv({ STAFF_KEY:'staff-key-123', DISCORD_BOT_TOKEN:'bot-token-xyz' });
const setCfg=(o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:false, subAutoOn:false, subOnMonitor:true, subChMonitor:MON,
      subOnLight:true, subChLight:LI, subOnStandard:false, subOnPremium:false,
      subLimNLight:8, subMonSpeedMin:'0.1', subMonNew:5,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }), new Date().toISOString()).run();
const J=(n)=>'49023705507'+String(n);
const api=async(path,body)=>(await asJson(await worker.fetch(body?post(path,body):get(path),env,{}))).body;
await setCfg();
for(let i=0;i<8;i++){
  const jan=J(i), at=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,created_at,pick)
    VALUES (?1,'い',0,'NS',?2,9,'h',?3,?3,1)`).bind(jan,'ゲーム'+i,at).run();
  await env.DB.prepare(`INSERT INTO mw_amz (jan,asin,name,price,low,buybox,fee_total,size_tier,rank,rank_cat,new_n,amz,checked_at,basis,price_at)
    VALUES (?1,'B0D1GSZJ8T',?2,9000,9000,9000,1200,'s',12000,'ゲーム',4,0,?3,'カート',?3)`).bind(jan,'A'+jan,at).run();
  await env.DB.prepare(`INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
    VALUES (?1,1,3,3645,'light,standard,premium',?2,?2,?2,?2)`).bind(jan,at).run();
}

console.log('=== ④ 控えの行：ライトに出す品にはモニターの印 ===');
{
  const cfg=await W.subSettings(env);
  const rows=await W.subRows(env,cfg);
  ok(rows.length===8&&rows.every((r)=>/^monitor,light/.test(r.grades)&&r.mon_same===1),
     '★★★ライトに出す品は grades に monitor が入る（Shopify に grade-monitor を付ける）');
  const src=fs.readFileSync(new URL('../proxy-sync/worker.js',import.meta.url),'utf8');
  ok(/r\.mon_same \? SUB_MON_SAME_MARK/.test(src)&&/cfg\.boxOn \|\| cfg\.qtyOn \|\| \(cfg\.pick \|\| \{\}\)\.monSame/.test(src),
     '★★★まだ付けていない品は1回だけ Shopify で付け直す（控えに印）');
  await setCfg({ subMonSame:false });
  const rows2=await W.subRows(env,await W.subSettings(env));
  ok(rows2.every((r)=>r.grades==='light,standard,premium'&&!r.mon_same),'★★⚙がオフなら付けない');
  await setCfg();
}

console.log('=== ⑤ ライトに8件・モニターに3件だけ出ている週 ===');
dc=[];
let r=await api('/sub/send',{ approve:true, plan:'light' });
const l1=(r.plans||[]).filter((x)=>x.key==='light')[0]||{};
ok(l1.add===8,'★★ライトに8件出した（準備）');
const liveOf=async(ch)=>(await env.DB.prepare(
  `SELECT jan,msg_id FROM sub_post WHERE ch=?1 AND COALESCE(msg_id,'')<>'' AND jan NOT LIKE 'one-%' ORDER BY jan`).bind(ch).all()).results;
const mAt=new Date(Date.now()-3600000).toISOString();
for(const i of [0,1,2])
  await env.DB.prepare(`INSERT INTO sub_post (jan,ch,plan,msg_id,price,qty,sold,sold_out,at,created_at)
    VALUES (?1,?2,'monitor',?3,3645,1,0,0,?4,?4)`).bind(J(i),MON,'70000'+i,mAt).run();
/* ENDER LILIES のように、控えの値段がカートの安い値段になっている品 */
await env.DB.prepare(`UPDATE mw_amz SET price=2930, buybox=2930, low=5500, basis='カート' WHERE jan=?1`).bind(J(3)).run();

console.log('=== ⑥ いますぐ配る（Actions の sub_now）===');
{
  ok(/sub\.kick/.test(DIAG.subKickSql('2026-11-28T00:00:00Z')),'★★Actions は印を置くだけ');
  await env.DB.prepare(DIAG.subKickSql(new Date().toISOString())).run();
  dc=[];
  const k=await W.jobSubKick(env,{});
  const posts=dc.filter((x)=>x.method==='POST'&&x.ch===MON&&x.body&&(x.body.embeds||[]).length);
  const dels=dc.filter((x)=>x.method==='DELETE');
  const liP=dc.filter((x)=>x.method==='POST'&&x.ch===LI&&x.body&&(x.body.embeds||[]).length
    &&!/今週の一覧/.test(JSON.stringify(x.body)));
  console.log('   '+JSON.stringify(k.send)+' 一覧 '+JSON.stringify(k.idx)+' 出ている '+JSON.stringify(k.chs));
  const mo=(k.send.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
  const li=(k.send.plans||[]).filter((x)=>x.key==='light')[0]||{};
  ok(mo.add===5,'★★★モニターに足りない5件だけを出す');
  ok(!posts.some((x)=>/70000[012]/.test(x.msg)),'★★★すでにある3件は送り直さない（二重にしない）');
  const mLive=await liveOf(MON), lLive=await liveOf(LI);
  ok(mLive.length===8&&mLive.map((x)=>x.jan).join()===lLive.map((x)=>x.jan).join(),
     '★★★モニターのカードはライトと同じ8件');
  ok(li.add===0&&liP.length===0,'★★★ライトには新しく出さない（書き換えだけ）');
  ok(dels.length===0,'★★★消さない（カードも一覧も、メッセージの編集で直す）');
  const amz=await env.DB.prepare(`SELECT price,basis FROM mw_amz WHERE jan=?1`).bind(J(3)).first();
  ok(amz.price===5500&&amz.basis==='最安'&&k.amz.n===1,'★★★値段を新品の最安値に直してから配る');
  const edL=dc.filter((x)=>x.method==='PATCH'&&x.ch===LI&&x.body&&(x.body.embeds||[]).length);
  ok(li.edit>=1&&edL.length>=1,'★★★値段が変わったライトのカードはメッセージの編集で直す');
  const mt=JSON.stringify(posts.map((x)=>x.body));
  ok(/お一人 1点まで/.test(mt)&&!/お一人 3点/.test(mt),'★★★モニターのカードの「購入できる数」は今までどおり（お一人1点まで）');
  const note=dc.filter((x)=>x.ch===MON&&x.body&&x.body.content&&!(x.body.embeds||[]).length
    &&/今週の配信/.test(x.body.content))[0];
  console.log('   今週の配信：'+((note||{}).body||{}).content);
  ok(!!note&&/\d+\/\d+ まで/.test(note.body.content),'★★★購入期限も今までどおり「今週の配信」に出す');
  const ix=(k.idx||[]).filter((x)=>x.key==='monitor')[0]||{}, ixL=(k.idx||[]).filter((x)=>x.key==='light')[0]||{};
  ok(ix.n===8&&ixL.n===8,'★★★「今週の一覧」はモニターもライトと同じ8件');
  const cm=(k.chs||[]).filter((x)=>x.key==='monitor')[0]||{};
  ok(cm.cards===8,'★★出ているモニターのカードの数を返す');
  const gone=await env.DB.prepare(`SELECT v FROM sync_state WHERE k='sub.kick'`).first();
  ok(!gone,'★★★印は1回で消す（同じことを繰り返さない）');
  const last=await env.DB.prepare(`SELECT v FROM sync_state WHERE k='sub.kick.last'`).first();
  ok(!!last&&!/ゲーム|\d{13}|¥|https?:/.test(last.v),'★★★記録は数だけ（商品名・JAN・値段・URL は控えない）');
  const txt=DIAG.subKickText(last.v).join('\n');
  console.log('   '+txt.replace(/\n/g,' ／ '));
  ok(/monitor：8件/.test(txt)&&/今週の一覧 monitor：8件/.test(txt),'★★Actions のログにカードと一覧の件数を出す');
  const k2=await W.jobSubKick(env,{});
  ok(k2.skip==='no_kick','★★印が無ければ何もしない');
}

console.log('=== ⑦ まとめて消す処理で今週のモニターのカードを消さない ===');
{
  await env.DB.prepare(`INSERT INTO sync_state (k,v,updated_at) VALUES ('sub.prune.from','all',?1)
    ON CONFLICT(k) DO UPDATE SET v='all'`).bind(new Date().toISOString()).run();
  /* 見本：ライトにもモニターにも合わない品のモニターのカード（これは消える）。 */
  const at9=new Date(Date.now()-86400000).toISOString();
  await env.DB.prepare(`INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,created_at,pick)
    VALUES (?1,'い',0,'NS','ゲーム9',9,'h',?2,?2,1)`).bind(J(9),at9).run();
  await env.DB.prepare(`INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,rank,rank_cat,new_n,amz,checked_at,basis,price_at)
    VALUES (?1,'B0D1GSZJ8T','A9',9000,1200,'s',12000,'ゲーム',4,0,?2,'カート',?2)`).bind(J(9),at9).run();
  await env.DB.prepare(`INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
    VALUES (?1,1,3,3645,'premium',?2,?2,?2,?2)`).bind(J(9),at9).run();
  await env.DB.prepare(`INSERT INTO sub_post (jan,ch,plan,msg_id,price,qty,sold,sold_out,at,created_at)
    VALUES (?1,?2,'monitor','709999',3645,1,0,0,?3,?3)`).bind(J(9),MON,at9).run();
  dc=[];
  const p=await W.jobSubPrune(env,{});
  const dels=dc.filter((x)=>x.method==='DELETE');
  console.log('   '+JSON.stringify(p.by||{})+' 消した '+dels.map((x)=>x.msg).join(','));
  ok(dels.length===1&&dels[0].msg==='709999','★★見本：どのプランにも合わない品のカードは今までどおり消す');
  ok((await liveOf(MON)).length===8,'★★★ライトと同じ品のモニターのカード（今週の8件）は消さない');
}

console.log('=== ⑧ 画面の⚙・Actions ===');
{
  const h=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  ok(/id="subMonSame" checked/.test(h)&&/モニターにはライトと同じ品を配る/.test(h),'★★★⚙のチェック（既定でオン）');
  ok(/subMonSame:c\('subMonSame'\)/.test(h)&&/'subMonSame'/.test(h),'★★⚙を pj-sync に渡して控える');
  ok(/SUBPLAN\.monSameGrades\(/.test(h),'★★画面から Shopify に入れるときも grade-monitor を付ける');
  const y=fs.readFileSync(new URL('../.github/workflows/deploy-pj-sync.yml',import.meta.url),'utf8');
  ok(/sub_now:/.test(y)&&/d1-diag\.mjs --sub-kick/.test(y)&&/--sub-count/.test(y),
     '★★★Actions から「いますぐ配る」を押せて、件数を読める');
  ok(!/name|price|title/.test(DIAG.Q_SUB_CARDS),'★★★件数を読む SQL は商品名・値段を読まない');
}
T.done();
