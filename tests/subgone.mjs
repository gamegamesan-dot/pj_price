/* Worker：Discord から消えたカードで止まらない（8.38・カジの報告・v297）

   起きたこと
     「送ったカードをすべて今の形で書き直す」で
     「⚠ スタンダード（Discord の返事 404）で止まりました」。
     前のテストで #リスト-スタンダード のカードを手で消していたので、
     pj に残っている msg_id のメッセージがもう無く、PATCH が 404 に
     なった。そこで止まるので、後ろのプレミアムも書き直せていなかった。

   ここで当たること
     ① 書き換え（PATCH）が 404／10008（Unknown Message）なら**止めずに**
        控え（msg_id）を消して次へ進む（後ろのプランも書き直せる）
     ② 控えを消したカードは「まだ出していない」扱いになり、
        次の予定・確認の画面に「新しく出す（前のカードが消えていたため）」
     ③ 書き直しでは**新しく出さない**（出すと通知が鳴るため）
     ④ 結果に「消えていたカード ◯件」を返す
     ⑤ チャンネルが無い（404／10003）・見られない（403）のときは
        今までどおりそのプランで止めて理由を出す
     ⑥ 「全プランに配る」と自動の回でも同じ
     ⑦ **メッセージやチャンネルを消す処理は足していない** */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
const T=harness('Worker：消えたカードで止まらない（8.38）');
const ok=T.ok;
const { worker }=await loadWorker('subgone');
const ROOT=path.resolve(new URL('.',import.meta.url).pathname,'..');

/* Discord の返事を試験ごとに決める。
   gone[msg_id]=1 … そのメッセージは消えている（404／10008）
   noCh[ch]=1     … チャンネルが無い（404／10003）
   deny[ch]=1     … 見られない（403） */
let dc=[], gone={}, noCh={}, deny={};
let mon=[];        // 8.43 モニターへの「今週の配信」
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/\/api\/webhooks\//.test(url))return new Response(null,{status:204});
  if(/discord\.com\/api/.test(url)){
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    const ch=m[1]||'', msg=m[2]||'';
    const method=String(o.method||'GET');
    const bd=(()=>{ try{ return JSON.parse(String(o.body||'{}')); }
                    catch(e){ return {}; } })();
    /* 8.43 モニターへの「今週の配信」は**カードではない**（文だけの1通）。
       カードの数を見るので、別に取っておく（中身は tests/submon.mjs）。 */
    (((!bd.embeds)&&bd.content)?mon:dc).push({ method:method, ch:ch,
      msg:msg });
    const err=(st,code)=>new Response(JSON.stringify({ code:code,
      message:'x' }),{status:st,headers:{'content-type':'application/json'}});
    if(deny[ch])return err(403,50001);
    if(noCh[ch])return err(404,10003);
    if(method==='PATCH'&&gone[msg])return err(404,10008);
    return new Response(JSON.stringify({ id:String(900000+dc.length) }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  return new Response('{}',{status:200});
};
const CH1='1111111111', CH2='2222222222';
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz' });
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subOnMonitor:true, subOnLight:true,
      /* 8.46 この試験は**カードの数**を見るので、会員チャンネルの
         「今週の一覧」は出さない（一覧そのものは
         tests/subindexw.mjs・subindex.mjs で見る）。 */
      gdIdxOn:false,
      subChMonitor:CH1, subChLight:CH2, subNMonitor:10, subNLight:10,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const JAN1='4902370550467', JAN2='4902370550468';
const now=()=>new Date().toISOString();
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
/* すでに送ったことにする控え。 */
const post1=(env,jan,ch,plan,msg)=>env.DB.prepare(
  `INSERT INTO sub_post (jan,ch,plan,msg_id,price,qty,sold,sold_out,at,
     created_at) VALUES (?1,?2,?3,?4,3645,3,0,0,?5,?5)`)
  .bind(jan,ch,plan,msg,now()).run();
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
const mid=async(env,jan,ch)=>String(((await env.DB.prepare(
  `SELECT msg_id FROM sub_post WHERE jan=?1 AND ch=?2`)
  .bind(jan,ch).first())||{}).msg_id||'');

const build=async()=>{
  const env=env0();
  await setCfg(env);
  await stock(env,JAN1); await amz(env,JAN1); await sub(env,JAN1,'monitor');
  await stock(env,JAN2); await amz(env,JAN2); await sub(env,JAN2,'light');
  /* モニターのカードは消えている・ライトのカードは生きている。 */
  await post1(env,JAN1,CH1,'monitor','800001');
  await post1(env,JAN2,CH2,'light','800002');
  return env;
};

console.log('=== ① 消えたカードで止まらない（書き直し）===');
{
  const env=await build();
  dc=[]; gone={ '800001':1 }; noCh={}; deny={};
  const r=await api(env,'/sub/send',{ approve:true, redo:true });
  console.log('   '+JSON.stringify({ sent:r.sent, edited:r.edited,
    fail:r.fail, gone:r.gone, stop:r.stop_plan||'' }));
  console.log('   Discord：'+dc.map((x)=>x.method+' '+x.ch
    +(x.msg?('/'+x.msg):'')).join(' / '));
  ok(r.fail===0&&!r.stopped,'★★★404（カードが消えている）で止まらない');
  ok(r.gone===1,'★★★消えていたカードの数を返す');
  ok(r.edited===1,'★★★後ろのプラン（ライト）も書き直せる');
  ok(dc.filter((x)=>x.method==='PATCH').length===2,
     '★★両方のプランに書き換えを出している');
  ok(dc.filter((x)=>x.method==='POST').length===0,
     '★★★書き直しでは新しく出さない（通知が鳴らないように）');
  ok((await mid(env,JAN1,CH1))==='',
     '★★★消えていたカードの控え（msg_id）を片づける');
  ok((await mid(env,JAN2,CH2))==='800002','★生きているカードの控えはそのまま');
  /* 控えの行そのものは消さない（注文の数などを持っているため）。 */
  const n=Number(((await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sub_post`).first())||{}).n||0);
  ok(n===2,'★控えの行は消さない（msg_id を空にするだけ）');
}

console.log('=== ② 次は「新しく出す（前のカードが消えていたため）」 ===');
{
  const env=await build();
  dc=[]; gone={ '800001':1 };
  await api(env,'/sub/send',{ approve:true, redo:true });
  const pl=await api(env,'/sub/plan');
  const mon=(pl.plans||[]).filter((p)=>p.key==='monitor')[0]||{};
  const it=(mon.items||[])[0]||{};
  console.log('   '+JSON.stringify({ sent:it.sent, same:it.same,
    gone_card:it.gone_card, add:mon.add, edit:mon.edit }));
  ok(it.sent===false&&it.gone_card===true,
     '★★★「まだ出していない」扱いになり、理由（gone_card）も返す');
  ok(mon.add===1&&mon.edit===0,'★★★予定では「新しく出す」1件になる');
  const lt=(pl.plans||[]).filter((p)=>p.key==='light')[0]||{};
  ok(((lt.items||[])[0]||{}).gone_card===false,
     '★消えていない行には理由を付けない');
}

console.log('=== ③ 確認の画面から出すと、新しいカードが出る ===');
{
  const env=await build();
  gone={ '800001':1 };
  await api(env,'/sub/send',{ approve:true, redo:true });
  dc=[]; gone={};
  const r=await api(env,'/sub/send',{ approve:true, plan:'monitor' });
  console.log('   '+JSON.stringify({ sent:r.sent, edited:r.edited,
    gone:r.gone })+' / '+dc.map((x)=>x.method).join(','));
  ok(r.sent===1&&dc.filter((x)=>x.method==='POST').length===1,
     '★★★確認の画面（配信）からは新しいカードが出る');
  ok(/^\d+$/.test(await mid(env,JAN1,CH1)),
     '★★★新しい msg_id を控え直す');
}

console.log('=== ④ チャンネルが無い・見られないときは止める ===');
{
  const env=await build();
  dc=[]; gone={}; noCh={ [CH1]:1 };
  const r=await api(env,'/sub/send',{ approve:true, redo:true });
  console.log('   '+JSON.stringify({ fail:r.fail, gone:r.gone,
    stop:r.stop_plan||'', st:r.stop_status }));
  ok(r.fail===1&&r.stopped==='fail','★★★チャンネルが無いときは止める');
  ok(String(r.stop_plan||'')==='モニター'&&r.stop_status===404,
     '★★★どのプランで止まったかと返事の番号を出す');
  ok(!r.gone,'★★★チャンネルが無いのは「消えていたカード」に数えない');
  ok((await mid(env,JAN1,CH1))==='800001',
     '★★★控えは片づけない（チャンネルの問題なので）');
  const env2=await build();
  dc=[]; noCh={}; deny={ [CH1]:1 };
  const r2=await api(env2,'/sub/send',{ approve:true, redo:true });
  ok(r2.fail===1&&r2.stop_status===403,'★★★見られない（403）ときも止める');
  ok((await mid(env2,JAN1,CH1))==='800001','★★403 でも控えは片づけない');
  deny={};
}

console.log('=== ⑤ 「全プランに配る」と自動の回でも同じ ===');
{
  const env=await build();
  dc=[]; gone={ '800001':1 };
  /* 画面の「全プランに配る」はプランごとに plan を付けて呼ぶ。 */
  const a=await api(env,'/sub/send',{ approve:true, plan:'monitor' });
  console.log('   monitor：'+JSON.stringify({ fail:a.fail, gone:a.gone,
    sent:a.sent }));
  ok(a.fail===0&&a.gone===1&&a.sent===0,
     '★★★プランを指定した配信でも止めず、新しくも出さない');
  const b=await api(env,'/sub/send',{ approve:true, plan:'light' });
  /* 中身が同じカードは書き換えずに「そのまま」。止まらないことを見る。 */
  ok(b.fail===0&&(b.edited+b.skipped)===1,'★★★次のプランもそのまま送れる');
  /* 自動の回（cron）も同じ口を通る。 */
  const env2=await build();
  dc=[]; gone={ '800001':1 };
  const c=await api(env2,'/sub/send',{ approve:true });
  ok(c.fail===0&&c.gone===1&&c.edited===1,
     '★★★自動の回（ぜんぶのプラン）でも同じ扱い');
}

console.log('=== ⑥ 消す処理は足していない ===');
{
  const src=fs.readFileSync(path.join(ROOT,'proxy-sync/worker.js'),'utf8');
  const dels=(src.match(/dcApi\([^)]*"DELETE"/g)||[]).length;
  console.log('   DELETE を出すところ：'+dels+'か所');
  ok(dels===1,
     '★★★Discord を消すのは「受付終了から◯日で消す」の1か所だけ（増やさない）');
  ok(dc.every((x)=>x.method!=='DELETE'),
     '★★★この試験でメッセージを消していない');
  ok(/DC_GONE_MSG = 10008/.test(src)&&/DC_GONE_CH = 10003/.test(src),
     '★★消えているの見分けは番号（10008／10003）で書いてある');
}

await T.done();
