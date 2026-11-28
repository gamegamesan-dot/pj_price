/* Worker：配信の直前に Amazon の値段を取り直す（8.117・カジの依頼）

   ・カードの「Amazon の販売価格」「見込みの粗利」が、見回りで取った古い値段（最長3日前）に
     ならないように、**本当に送る回だけ**、出す・書き換える予定の品の値段を先に取り直す
   ・60分以内に取った品は取り直さない／新しく出す品を先に、そのあと値段の古い順
   ・取れなかった品は控えの値段のまま（消さない）
   ・決まりは見回りと同じ（カート優先・カートが新品の最安値より大きく下なら最安値） */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import * as DIAG from '../proxy-sync/d1-diag.mjs';
const T=harness('Worker：配信の直前に Amazon の値段を取り直す（8.117）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('subpx');

let asked=[], dc=[];
const amz={};          // ASIN → { buy, low }（無ければ出品なし）
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{}, m=String(o.method||'GET');
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  if(/itemOffers/.test(url)){
    const body=JSON.parse(o.body||'{}');
    return new Response(JSON.stringify({ responses:(body.requests||[]).map((q)=>{
      const a=(/\/items\/([A-Z0-9]{10})\/offers/.exec(q.uri)||[])[1]||'';
      asked.push(a);
      const z=amz[a];
      return { request:q, body:{ payload:{ ASIN:a, ItemCondition:'New',
        Summary:{ NumberOfOffers:[{ condition:'new', OfferCount:z?2:0 }], TotalOfferCount:z?2:0,
          BuyBoxPrices:(z&&z.buy)?[{ condition:'new', LandedPrice:{ Amount:z.buy } }]:[] },
        Offers:z?[{ ListingPrice:{ Amount:z.low }, Shipping:{ Amount:0 }, SellerId:'A1X',
          SubCondition:'new', IsFulfilledByAmazon:false }]:[] } } };
    })}),{status:200});
  }
  if(/discord\.com\/api/.test(url)){
    const cc=/\/channels\/(\d+)$/.exec(url);
    if(cc)return new Response(JSON.stringify({ id:cc[1], name:'ch', guild_id:'555' }),{status:200});
    const mm=/\/channels\/(\d+)\/(?:messages|pins)(?:\/(\d+))?/.exec(url)||[];
    let b=null; try{ b=o.body?JSON.parse(String(o.body)):null; }catch(e){ b=null; }
    dc.push({ method:m, ch:mm[1]||'', msg:mm[2]||'', body:b });
    if(m==='DELETE'||m==='PUT')return new Response(null,{status:204});
    if(m==='GET')return new Response('[]',{status:200});
    return new Response(JSON.stringify({ id:String(mm[2]||(800000+dc.length)) }),{status:200});
  }
  return new Response('{}',{status:200});
};
const LI='2222222222';
const env=makeEnv({ STAFF_KEY:'staff-key-123', DISCORD_BOT_TOKEN:'bot-token-xyz',
  LWA_CLIENT_ID:'a', LWA_CLIENT_SECRET:'b', LWA_REFRESH_TOKEN:'c' });
await env.DB.prepare(`INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)`)
  .bind(JSON.stringify({ at:new Date().toISOString(), settings:{ subOn:false, subAutoOn:false,
    subOnMonitor:false, subOnLight:true, subChLight:LI, subOnStandard:false, subOnPremium:false,
    subLimNLight:8, gdIdxOn:false, subDomain:'omakase-ship.myshopify.com' } }), new Date().toISOString()).run();
const ago=(min)=>new Date(Date.now()-min*60000).toISOString();
const J=(n)=>'49023705508'+n, A=(n)=>'B0PXTEST0'+n;
const item=async(n,priceAt)=>{
  const at=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,created_at,pick)
    VALUES (?1,'い',0,'NS',?2,9,'h',?3,?3,1)`).bind(J(n),'ゲーム'+n,at).run();
  await env.DB.prepare(`INSERT INTO mw_amz (jan,asin,name,price,low,buybox,fee_ref,fee_total,size_tier,rank,rank_cat,new_n,amz,checked_at,basis,price_at)
    VALUES (?1,?2,?3,9000,9000,9000,900,1200,'s',12000,'ゲーム',4,0,?4,'カート',?4)`).bind(J(n),A(n),'A'+n,priceAt).run();
  await env.DB.prepare(`INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
    VALUES (?1,1,3,3645,'light,standard,premium',?2,?2,?2,?2)`).bind(J(n),at).run();
};
await item(1,ago(2*24*60));     // 2日前に取った値段（取り直す）
await item(2,ago(10));          // 10分前に取った値段（取り直さない）
await item(3,ago(2*24*60));     // 取り直しても出品が見つからない
amz[A(1)]={ buy:7000, low:7000 };
const api=async(path,body)=>(await asJson(await worker.fetch(body?post(path,body):get(path),env,{}))).body;
const row=async(n)=>await env.DB.prepare(`SELECT * FROM mw_amz WHERE jan=?1`).bind(J(n)).first();

console.log('=== ① 予定を数えるだけの回では取らない ===');
{
  asked=[];
  const r=await api('/sub/send',{ approve:false });
  ok(asked.length===0&&!r.px,'★★★確認の画面（予定を数えるだけ）では Amazon に聞かない');
}

console.log('=== ② 本当に送る回は、配る品の値段を先に取り直す ===');
{
  asked=[]; dc=[];
  const r=await api('/sub/send',{ approve:true });
  console.log('   取り直し '+JSON.stringify(r.px)+' 聞いた '+asked.join(','));
  ok(asked.includes(A(1))&&asked.includes(A(3)),'★★★古い値段の品（2日前）は配る前に取り直す');
  ok(!asked.includes(A(2)),'★★★60分以内に取った品は取り直さない');
  ok(r.px&&r.px.todo===2&&r.px.done===1&&r.px.none===1&&r.px.fresh===1,'★★数だけ返す（対象・取れた・取れなかった・新しい）');
  const a=await row(1), c=await row(3);
  ok(a.price===7000&&a.basis==='カート'&&Date.now()-Date.parse(a.price_at)<60000,
     '★★★取り直した値段と時刻を控える');
  ok(a.fee_ref===700&&a.fee_total===1000,'★★販売手数料は値段に比例するぶんだけ合わせる（900→700・合計 1200→1000）');
  ok(c.price===9000&&c.basis==='カート','★★★取れなかった品は控えの値段のまま（消さない）');
  const card=dc.filter((x)=>x.method==='POST'&&x.ch===LI&&x.body&&(x.body.embeds||[]).length)
    .map((x)=>JSON.stringify(x.body)).filter((t)=>t.includes(J(1)))[0]||'';
  ok(/¥7,000（カート・/.test(card),'★★★カードは取り直した値段で出す');
  ok(!/¥9,000/.test(card),'★★★古い値段は出さない');
}

console.log('=== ③ すぐにもう一度送っても、取り直したばかりの品は聞かない ===');
{
  asked=[];
  const r=await api('/sub/send',{ approve:true });
  ok(!asked.includes(A(1))&&!asked.includes(A(2)),'★★★60分以内に取り直した品は聞かない');
  ok(asked.includes(A(3)),'★取れなかった品は次の回でまた聞く');
  ok(r.ok!==false,'★送るのは止めない');
}

console.log('=== ④ 時間が足りないときは、新しく出す品を先に・値段の古い順 ===');
{
  const e2=makeEnv({ LWA_CLIENT_ID:'a', LWA_CLIENT_SECRET:'b', LWA_REFRESH_TOKEN:'c' });
  const cand=[];
  for(let i=0;i<25;i++){
    const jan='4902370551'+String(i).padStart(3,'0'), asin='B0PXOLD'+String(i).padStart(3,'0');
    amz[asin]={ buy:5000, low:5000 };
    await e2.DB.prepare(`INSERT INTO mw_amz (jan,asin,name,price,basis,price_at,checked_at)
      VALUES (?1,?2,'x',8000,'カート',?3,?3)`).bind(jan,asin,ago(5000-i*10)).run();
    cand.push({ jan, add:i>=20 });           // 後ろの5件がまだ出していない品
  }
  asked=[];
  const st=await W.subPxRefresh(e2,{ notes:[], errors:0, calls:0 },cand,1000);
  const done=(await e2.DB.prepare(`SELECT jan FROM mw_amz WHERE price=5000 ORDER BY jan`).all()).results.map((x)=>x.jan);
  console.log('   '+JSON.stringify(st));
  ok(st.calls===1&&st.done===20&&st.left===5&&st.stopped==='time','★★持ち時間で区切る（残りは次の回）');
  ok(['020','021','022','023','024'].every((k)=>done.includes('4902370551'+k)),'★★★まだ出していない品を先に取る');
  ok(['000','001','014'].every((k)=>done.includes('4902370551'+k))&&!done.includes('4902370551019'),
     '★★そのあとは値段の古い順');
}

console.log('=== ⑤ Actions の記録・決まりの1か所 ===');
{
  const t=DIAG.subKickText(JSON.stringify({ at:'2026-11-28T03:00:00Z',
    px:{ todo:12, done:10, fresh:3, none:2, left:0 }, send:{ sent:0, edited:4, plans:[] } })).join('\n');
  ok(/配る前に Amazon の値段を取り直した 10／対象 12/.test(t),'★★「いますぐ配る」の記録にも取り直した数を出す');
  const fs=await import('node:fs');
  const src=fs.readFileSync(new URL('../proxy-sync/worker.js',import.meta.url),'utf8');
  ok(/const pk = z \? amzPick\(z\.buy, z\.low\)/.test(src),'★★★値段の決まりは見回りと同じ amzPick');
  ok(/px_ms: SUB_PX_UI_MS/.test(src)&&/SUB_PX_FRESH_MS = 60 \* 60000/.test(src),'★★画面から押す回は短め・60分以内は取り直さない');
}
T.done();
