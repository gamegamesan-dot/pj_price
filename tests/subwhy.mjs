/* Worker：ライト・スタンダード・プレミアムまで試す（8.20・カジの依頼）

   ① プランごとの予定が0件のとき、**なぜ0件か**を返す
      （印オフ／チャンネルID なし／上のプランから出す商品／
        ゲームソフトだけのプラン／1点ものは出さない／配信できる商品が0）
   8.35：プランは**積み上げ型**（下のプランの商品は上のプランにも出る）に
   なったので、「monitor だけ」のような grades は
   「**モニターだけに出す**」という意味になる（上には出ない）。
   ② `POST /sub/send` に plan を付けると**そのプランだけ**に送る
   ③ grades が空の商品は**どのプランにも出る**（「ぜんぶのプラン」） */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import SUBPLAN from '../shared/subplan.js';
const T=harness('Worker：ライト〜プレミアムまで試す（8.20）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('subwhy');

let dc=[];
let mon=[];        // 8.43 モニターへの「今週の配信」
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/discord\.com\/api\/v/.test(url)&&/\/channels\//.test(url)){
    /* 8.86 チャンネルそのもの（名前・説明文）の読み書きはメッセージでは
       ないので、送ったカードの数には入れない。 */
    if(/\/channels\/\d+$/.test(url))
      return new Response(JSON.stringify({ id:'0' }),
        {status:200,headers:{'content-type':'application/json'}});
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    const bd=(()=>{ try{ return JSON.parse(String(o.body||'{}')); }
                    catch(e){ return {}; } })();
    /* 8.43 モニターへの「今週の配信」は**カードではない**（文だけの1通）。
       カードの数を見るので、別に取っておく（中身は tests/submon.mjs）。 */
    (((!bd.embeds)&&bd.content)?mon:dc).push({
      method:String(o.method||'GET'), ch:m[1]||'' });
    return new Response(JSON.stringify({ id:String(900000+dc.length) }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  return new Response('{}',{status:200});
};
const CH={ monitor:'111', light:'222', standard:'333', premium:'444' };
const env0=()=>makeEnv({ DISCORD_BOT_TOKEN:'bot-token-xyz' });
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subMonSame:false,
      /* 8.46 この試験は**カードの数**を見るので、会員チャンネルの
         「今週の一覧」は出さない（一覧そのものは
         tests/subindexw.mjs・subindex.mjs で見る）。 */
      gdIdxOn:false,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const stock=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,pick,row_hash,seen_at,created_at)
   VALUES (?1,'いろは商会',0,?2,?3,?4,1,'h',?5,?5)`)
  .bind(jan,(o||{}).kishu||'NS',(o||{}).name||('商品'+jan),
        (o||{}).stock===undefined?9:(o||{}).stock,new Date().toISOString()).run();
const amz=(env,jan)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,checked_at,
     basis,price_at)
   VALUES (?1,'B0D1GSZJ8T','Amazonの名前',9000,1200,'s',?2,'カート',?2)`)
  .bind(jan,new Date().toISOString()).run();
const sub=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
   VALUES (?1,1,?2,?3,?4,?5,?5,?5,?5)`)
  .bind(jan,(o||{}).qty===undefined?2:(o||{}).qty,(o||{}).price||3645,
        (o||{}).grades===undefined?'':(o||{}).grades,
        new Date().toISOString()).run();
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
const planOf=(d,k)=>((d.plans||[]).filter((p)=>p.key===k)[0]||{});
const ON={ subOnLight:1, subOnStandard:1, subOnPremium:1,
  subChMonitor:CH.monitor, subChLight:CH.light,
  subChStandard:CH.standard, subChPremium:CH.premium };

console.log('=== 決まり（shared/subplan.js）===');
{
  const l=SUBPLAN.list(ON);
  ok(l.every((p)=>p.on===true),'★★★⚙で4つぜんぶ動かせる');
  ok(SUBPLAN.active(ON).length===4,'★★★チャンネルIDを入れた4プランが動く');
  const light=l.filter((p)=>p.key==='light')[0];
  ok(SUBPLAN.fitWhy(light,{grades:''},true)==='','★ゲームソフトは出す');
  ok(/ゲームソフトだけ/.test(SUBPLAN.fitWhy(light,{grades:''},false)),
     '★★★理由：ゲームソフトだけのプラン');
  /* 8.35 'monitor' だけの grades は「モニターだけ」。ライトには出ない。 */
  ok(/このプランには出さない商品です/
     .test(SUBPLAN.fitWhy(light,{grades:'monitor'},true)),
     '★★★理由：このプランには出さない商品です（8.35）');
  /* 「ライトから上」の商品は、モニターには出ない（下には流れない）。 */
  const mon=l.filter((p)=>p.key==='monitor')[0];
  ok(/ライトから上に出す商品です/
     .test(SUBPLAN.fitWhy(mon,{grades:'light,standard,premium',
                               name:'ふつうのゲーム'},true)),
     '★★★理由：ライトから上に出す商品です（8.35）');
  ok(SUBPLAN.fitWhy(light,{grades:'monitor,light,standard,premium',
                           name:'ふつうのゲーム'},true)==='',
     '★★★積み上げ型（モニターから上）ならライトにも出る（8.35）');
  const std=l.filter((p)=>p.key==='standard')[0];
  ok(/1点もの/.test(SUBPLAN.fitWhy(std,{grades:'',one_off:1},false)),
     '★★理由：1点ものはこのプランに出しません');
  ok(SUBPLAN.fitWhy(l.filter((p)=>p.key==='premium')[0],
     {grades:'',one_off:1},false)==='','★プレミアムは1点ものも出す');
  ok(/配信する/.test(SUBPLAN.whyNone(SUBPLAN.list({}).filter(
     (p)=>p.key==='light')[0],[{grades:''}])),
     '★★★印がオフなら「⚙で「配信する」が入っていません」');
  ok(/チャンネルID/.test(SUBPLAN.whyNone(SUBPLAN.list({subOnLight:1}).filter(
     (p)=>p.key==='light')[0],[{grades:''}])),
     '★★★チャンネルID が空ならそう言う');
  ok(/配信できる商品がありません/.test(SUBPLAN.whyNone(
     SUBPLAN.list(ON).filter((p)=>p.key==='light')[0],[])),
     '★★★商品が0なら印の話をする');
}

console.log('=== ① 予定が0件の理由（GET /sub/plan）===');
{
  const env=env0();
  await setCfg(env,ON);
  /* モニターに振り分けたゲームソフト1件だけ。 */
  await stock(env,'4902370550001',{ name:'ゲームA' });
  await amz(env,'4902370550001');
  await sub(env,'4902370550001',{ grades:'monitor' });
  const d=await api(env,'/sub/plan');
  console.log('   '+(d.plans||[]).map((p)=>p.key+':'+p.items.length
    +(p.why?('（'+p.why+'）'):'')).join(' / '));
  ok(planOf(d,'monitor').items.length===1,'★★モニターには出る');
  ok(/このプランには出さない商品です（monitor） 1件/
     .test(planOf(d,'light').why||''),
     '★★★ライトが0件の理由（モニターだけに出す商品・8.35）');
  ok(/このプランには出さない商品です/.test(planOf(d,'standard').why||''),
     '★★スタンダードも同じ理由');
  ok(planOf(d,'monitor').why==='','★出ているプランには理由を付けない');
}
{
  const env=env0();
  await setCfg(env,{ subOnLight:1, subChLight:CH.light });
  await stock(env,'4580033110113',{ name:'フィギュアA', kishu:'b2cchara_figure' });
  await amz(env,'4580033110113');
  await sub(env,'4580033110113',{ grades:'' });
  const d=await api(env,'/sub/plan');
  ok(/ゲームソフトだけのプランです 1件/.test(planOf(d,'light').why||''),
     '★★★ゲーム以外しか無いときの理由');
  ok(/チャンネルID/.test(planOf(d,'standard').why||'')
     ||/配信する/.test(planOf(d,'standard').why||''),
     '★★止めているプランの理由も返す');
}

console.log('=== ③ grades が空なら「ぜんぶのプラン」に出る ===');
{
  const env=env0();
  await setCfg(env,ON);
  await stock(env,'4902370550002',{ name:'ゲームB' });
  await amz(env,'4902370550002');
  await sub(env,'4902370550002',{ grades:'' });
  const d=await api(env,'/sub/plan');
  ok(planOf(d,'monitor').items.length===1&&planOf(d,'light').items.length===1
     &&planOf(d,'standard').items.length===1
     &&planOf(d,'premium').items.length===1,
     '★★★grades が空の商品は4プランぜんぶに出る');
}

console.log('=== ② plan を付けるとそのプランだけ送る ===');
{
  const env=env0();
  await setCfg(env,ON);
  await stock(env,'4902370550003',{ name:'ゲームC' });
  await amz(env,'4902370550003');
  await sub(env,'4902370550003',{ grades:'' });
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true, plan:'light' });
  console.log('   送り先：'+dc.map((x)=>x.ch).join(',')
    +'／plans='+(r.plans||[]).map((x)=>x.key).join(','));
  ok(r.ok===true&&r.sent===1,'★★★1件だけ送る');
  ok(dc.length===1&&dc[0].ch===CH.light,
     '★★★ライトのチャンネルだけに送る（ほかには送らない）');
  ok((r.plans||[]).length===1&&r.plans[0].key==='light',
     '★★返す結果もそのプランだけ');
  /* 続けてスタンダードだけ送る。ライトのぶんは二重に送らない。 */
  dc=[];
  const r2=await api(env,'/sub/send',{ approve:true, plan:'standard' });
  ok(r2.sent===1&&dc.length===1&&dc[0].ch===CH.standard,
     '★★★次はスタンダードだけに送れる');
  /* 全プラン（plan なし）では、残りの2つに送る。 */
  dc=[];
  const r3=await api(env,'/sub/send',{ approve:true });
  const chs=dc.map((x)=>x.ch).sort().join(',');
  ok(r3.sent===2&&chs===[CH.monitor,CH.premium].sort().join(','),
     '★★★plan なしなら残りのプランに送る（送ったぶんは二重に送らない）');
}

T.done();
