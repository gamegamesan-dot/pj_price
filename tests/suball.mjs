/* Worker：全プランにまとめて配る（8.28・カジの依頼1）

   いままでプランごとに「◯◯だけ送る」を押していたので手数が多かった。
   画面が「確認 → プランの順に1本ずつ」で送れるように、pj-sync 側で
     ・予定にチャンネル名と**配る前の警告**を返す
     ・確認の画面で外した行（skip）を送らない
     ・途中で失敗したら**そこで止めて**、どこまで出たかを返す
     ・Discord の送信制限に当たらないよう、カード1枚ごとに間隔をあける
   を用意した。ここはその口と中身を当たる。 */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import SUBCARD from '../shared/subcard.js';
const T=harness('Worker：全プランにまとめて配る（8.28）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('suball');
const ROOT=path.resolve(new URL('.',import.meta.url).pathname,'..');

let dc=[], notes=[], chNames={}, failCh='';
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/\/api\/webhooks\//.test(url)){
    notes.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response(null,{status:204});
  }
  if(/discord\.com\/api/.test(url)){
    const mm=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url);
    const cc=/\/channels\/(\d+)$/.exec(url);
    /* チャンネル名を聞かれたとき（確認の画面に出す）。 */
    if(cc)return new Response(JSON.stringify({ id:cc[1],
      name:chNames[cc[1]]||'ch-'+cc[1] }),
      {status:200,headers:{'content-type':'application/json'}});
    const ch=(mm||[])[1]||'';
    const b=JSON.parse(String(o.body||'{}'));
    dc.push({ method:String(o.method||'GET'), ch:ch, msg:(mm||[])[2]||'',
              body:b, at:Date.now() });
    /* わざと失敗させるチャンネル（途中で止まるかを見る）。 */
    if(failCh&&ch===failCh)return new Response('{}',{status:403});
    return new Response(JSON.stringify({ id:String(900000+dc.length) }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  if(/discord/.test(url)){
    notes.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response(null,{status:204});
  }
  return new Response('{}',{status:200});
};
const CH='1111111111', CH2='2222222222';
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz',
  DISCORD_WEBHOOK_URL:'https://discord.com/api/webhooks/1/abc' });
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subChMonitor:CH,
      subOnPremium:true, subChPremium:CH2,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const JAN=['4902370550467','4902370550468','4902370550469'];
const stock=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,created_at)
   VALUES (?1,'いろは商会',0,?2,?3,?4,'h',?5,?5)`)
  .bind(jan,(o||{}).kishu||'NS',(o||{}).name||('商品'+jan),
        (o||{}).stock===undefined?9:(o||{}).stock,
        new Date().toISOString()).run();
const amz=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,checked_at,
     basis,price_at)
   VALUES (?1,?2,?3,?4,?5,?6,?7,'カート',?7)`)
  .bind(jan,(o||{}).asin||'B0D1GSZJ8T',(o||{}).name||('Amazon '+jan),
        (o||{}).price||9000,(o||{}).fee||1200,(o||{}).tier||'s',
        new Date().toISOString()).run();
const sub=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
   VALUES (?1,1,?2,?3,?4,?5,?6,?5,?5)`)
  .bind(jan,(o||{}).qty===undefined?1:(o||{}).qty,(o||{}).price||3645,
        (o||{}).grades||'',(o||{}).put||new Date().toISOString(),
        (o||{}).loaded===false?null:(o||{}).loaded
          ||new Date().toISOString()).run();
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
const plan=async(env,key)=>((await api(env,'/sub/plan')).plans||[])
  .filter((p)=>p.key===key)[0]||{ items:[] };

console.log('=== ① 予定にチャンネル名を返す（確認の画面に出す）===');
{
  const env=env0();
  await setCfg(env,{});
  chNames[CH]='リスト-モニター';
  await stock(env,JAN[0]); await amz(env,JAN[0]); await sub(env,JAN[0]);
  const p=await plan(env,'monitor');
  console.log('   '+p.ch_name+' / '+p.items.length+'件');
  ok(p.ch_name==='リスト-モニター',
     '★★★チャンネル名を返す（カジが「どこに出るか」を見られる）');
  ok(p.items.length===1&&p.items[0].handle==='sub-'+JAN[0],
     '★★Shopify の商品ページ（handle）も返す');
  /* 止めているプランは聞かない（むだな呼び出しをしない）。 */
  const l=((await api(env,'/sub/plan')).plans||[])
    .filter((x)=>x.key==='light')[0]||{};
  ok(!l.ch_name,'★止めているプランのチャンネル名は聞かない');
}

console.log('=== ② 配る前の警告（警告のある行は画面で既定で外す）===');
{
  const env=env0();
  await setCfg(env,{});
  /* ふつうの行。 */
  await stock(env,JAN[0]); await amz(env,JAN[0]); await sub(env,JAN[0]);
  /* CSV に出したあと Shopify に読み込み直していない行。 */
  await stock(env,JAN[1]); await amz(env,JAN[1]);
  await sub(env,JAN[1],{ put:'2026-11-14T05:00:00.000Z',
                         loaded:'2026-11-13T05:00:00.000Z' });
  /* MW が欠品した行（残りはある）。 */
  await stock(env,JAN[2]); await amz(env,JAN[2]); await sub(env,JAN[2]);
  await env.DB.prepare(`UPDATE mw_stock SET gone_at=?2 WHERE jan=?1`)
    .bind(JAN[2],new Date().toISOString()).run();
  const p=await plan(env,'monitor');
  const by={}; for(const x of p.items)by[x.jan]=x.warns||[];
  console.log('   '+JSON.stringify(by));
  ok((by[JAN[0]]||[]).length===0,'★★ふつうの行には警告を出さない');
  ok((by[JAN[1]]||[]).some((s)=>/読み込み直していません/.test(s)),
     '★★★CSV を出したあと Shopify に読み込み直していない行を知らせる');
  ok((by[JAN[2]]||[]).some((s)=>/欠品/.test(s)),
     '★★★MW が欠品した行を知らせる');
  /* 送料の区分が決まっていない行（採寸がない・8.27）。 */
  const e2=env0();
  await setCfg(e2,{});
  await stock(e2,JAN[0],{ kishu:'figure' });
  await amz(e2,JAN[0],{ tier:'m' }); await sub(e2,JAN[0]);
  await setCfg(e2,{ subOnPremium:true, subChPremium:CH2 });
  await e2.DB.prepare(`UPDATE mw_sub SET grades='premium' WHERE jan=?1`)
    .bind(JAN[0]).run();
  const pp=await plan(e2,'premium');
  console.log('   '+JSON.stringify((pp.items[0]||{}).warns));
  ok(((pp.items[0]||{}).warns||[]).some((s)=>/送料の区分が要確認/.test(s)),
     '★★★送料の区分が決まっていない行を知らせる（8.27）');
  /* 残り0（完売）の行。 */
  const e3=env0();
  await setCfg(e3,{});
  await stock(e3,JAN[0]); await amz(e3,JAN[0]); await sub(e3,JAN[0],{ qty:1 });
  await e3.DB.prepare(
    `INSERT INTO sub_order (order_no,jan,sku,qty,at,created_at)
     VALUES ('#1001',?1,'SUB-x',1,?2,?2)`)
    .bind(JAN[0],new Date().toISOString()).run();
  const p3=await plan(e3,'monitor');
  ok(((p3.items[0]||{}).warns||[]).some((s)=>/残り0/.test(s)),
     '★★★残り0（完売）の行を知らせる');
}

console.log('=== ③ 外した行（skip）は送らない ===');
{
  const env=env0();
  await setCfg(env,{});
  await stock(env,JAN[0]); await amz(env,JAN[0]); await sub(env,JAN[0]);
  await stock(env,JAN[1]); await amz(env,JAN[1]); await sub(env,JAN[1]);
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true, plan:'monitor',
                                      skip:[JAN[1]] });
  console.log('   送った '+dc.length+'通／skip '+r.skip_n);
  ok(r.sent===1&&dc.length===1,'★★★チェックを外した行は送らない');
  ok(String((dc[0].body.embeds[0]||{}).title||'').indexOf('Amazon '+JAN[0])>=0
     ||JSON.stringify(dc[0].body).indexOf(JAN[0])>=0,
     '★★残した行だけ送る');
  ok(r.skip_n===1,'★外した件数を返す');
  /* 外した行は控えも触らない（次に送れる）。 */
  dc=[];
  const r2=await api(env,'/sub/send',{ approve:true, plan:'monitor' });
  ok(r2.sent===1&&dc.length===1,
     '★★★外した行はあとから送れる（控えを触っていない）');
  ok(r2.skipped===1,'★★前に送った行は「そのまま」で二重に出さない');
}

console.log('=== ④ 途中で失敗したらそこで止める ===');
{
  const env=env0();
  await setCfg(env,{});
  chNames[CH]='リスト-モニター'; chNames[CH2]='リスト-プレミアム';
  /* モニター（ゲーム）とプレミアム（ぜんぶ）に1件ずつ。 */
  await stock(env,JAN[0]); await amz(env,JAN[0]);
  await sub(env,JAN[0],{ grades:'monitor' });
  await stock(env,JAN[1]); await amz(env,JAN[1]);
  await sub(env,JAN[1],{ grades:'premium' });
  failCh=CH2;                    // プレミアムのチャンネルだけ失敗させる
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true });
  failCh='';
  console.log('   '+JSON.stringify({ sent:r.sent, fail:r.fail,
    stopped:r.stopped, plan:r.stop_plan, status:r.stop_status }));
  ok(r.sent===1,'★★★失敗の前に出したぶんは数に入る（どこまで出たか）');
  ok(r.fail===1&&r.stopped==='fail','★★★失敗したらそこで止める');
  ok(String(r.stop_plan||'')==='プレミアム',
     '★★★どのプランで止まったかを返す');
  ok(Number(r.stop_status)===403,'★Discord の返事（番号）も返す');
  /* もう一度送れば続きから（出したぶんは二重に出ない）。 */
  dc=[];
  const r2=await api(env,'/sub/send',{ approve:true });
  console.log('   続き：'+JSON.stringify({ sent:r2.sent, edited:r2.edited,
    post:dc.filter((x)=>x.method==='POST').map((x)=>x.ch) }));
  ok(r2.sent===1&&dc.filter((x)=>x.ch===CH2&&x.method==='POST').length===1,
     '★★★もう一度押すと続きから（止まったプランから出る）');
  ok(dc.filter((x)=>x.ch===CH&&x.method==='POST').length===0,
     '★★★すでに出したカードは新しく出し直さない（二重に出ない）');
}

console.log('=== ⑤ Discord の送信制限に当たらないよう間隔をあける ===');
{
  const env=env0();
  await setCfg(env,{ subNMonitor:5, subQMonitor:1 });
  for(const j of JAN){ await stock(env,j); await amz(env,j); await sub(env,j); }
  dc=[];
  const t0=Date.now();
  const r=await api(env,'/sub/send',{ approve:true, plan:'monitor' });
  const ms=Date.now()-t0;
  console.log('   '+r.sent+'通を '+ms+'ms で送った');
  ok(r.sent===3,'★3件とも送れた');
  ok(ms>=2*W.SUB_GAP_MS*0.9,
     '★★★2枚目から間隔をあける（Discord の送信制限に当たらないように）');
  ok(W.SUB_GAP_MS>=1000,
     '★★間隔は「同じチャンネルに5通／5秒」より遅い');
}

console.log('=== ⑥ 1点ものも同じ口でまとめて送れる ===');
{
  const env=env0();
  await setCfg(env,{ subChPre:'3333333333', subChHot:'4444444444' });
  chNames['3333333333']='目玉商品-先行';
  await env.DB.prepare(
    `INSERT INTO one_item (id,handle,name,cond,cost,price,qty,ship_kind,
       loaded_at,at,created_at)
     VALUES (1,'one-1','秋葉原の1点もの','中古',1000,3000,1,'box',?1,?1,?1)`)
    .bind(new Date().toISOString()).run();
  const d=await api(env,'/sub/plan');
  const g=(d.plans||[]).filter((p)=>p.key==='one_pre')[0]||{};
  console.log('   '+g.name+' → '+g.ch_name+'／'+(g.items||[]).length+'件');
  ok(g.ch_name==='目玉商品-先行',
     '★★★1点もののチャンネル名も返す（同じ画面に出せる）');
  ok((g.items||[]).length===1&&(g.items[0].warns||[]).length===0,
     '★★区分を選んである1点ものには警告を出さない');
  ok((g.items[0]||{}).ship==='宅配便','★カジが選んだ区分を返す');
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true, plan:'one_pre' });
  ok(r.sent===1&&dc.length===1&&dc[0].ch==='3333333333',
     '★★★1点ものだけを送れる（プランの順に送るときの最後）');
  /* 外すこともできる（キーは 'one-<連番>'）。 */
  const e2=env0();
  await setCfg(e2,{ subChPre:'3333333333' });
  await e2.DB.prepare(
    `INSERT INTO one_item (id,handle,name,cond,cost,price,qty,ship_kind,
       loaded_at,at,created_at)
     VALUES (1,'one-1','秋葉原の1点もの','中古',1000,3000,1,'box',?1,?1,?1)`)
    .bind(new Date().toISOString()).run();
  dc=[];
  const r2=await api(e2,'/sub/send',{ approve:true, plan:'one_pre',
                                      skip:['one-1'] });
  ok(r2.sent===0&&dc.length===0,
     '★★★1点ものもチェックを外せる（one-<連番> で指す）');
}

console.log('=== ⑦ 画面と手順書 ===');
{
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  ok(/subAllOpen\(\)/.test(html)&&/全プランに配る/.test(html),
     '★★★「全プランに配る」のボタンがある');
  ok(/だけ送る/.test(html),'★★★「◯◯だけ送る」は残してある');
  ok(/subAllSend/.test(html)&&/skip:j\.skip/.test(html),
     '★★外した行を pj-sync に渡す');
  const doc=path.join(ROOT,'pj_price_追加仕様_配信の短縮.md');
  ok(fs.existsSync(doc),'★★★計画の手順書がある（配信の短縮）');
  const md=fs.readFileSync(doc,'utf8');
  for(const k of ['SHOPLOCK','Webhook','Admin API','予約配信'])
    ok(md.indexOf(k)>=0,'★手順書に「'+k+'」の章がある');
  ok(!/[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/.test(md)
     &&!/discord\.com\/api\/webhooks\/\d/.test(md)
     &&!/shpat_/.test(md)&&!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(md),
     '★★★手順書に鍵・トークン・Webhook URL・メールアドレスを書かない');
}

T.done();
