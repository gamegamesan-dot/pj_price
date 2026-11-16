/* Worker：採寸だけ取り直す（8.55・カジの依頼E）

   カジの報告（11/17）「一覧を取り直したら候補が 148件 → 59件 に減った」
   の調査で分かったこと
     ・出品の可否（mw_restrict）は **ASIN** で結んでいる
     ・採寸の取り直し（/mw/dim/again）は asin_at を空にするので、
       **ASIN ごと引き直し**になり、ASIN が変わった行は可否が未確認に戻る
   そこで、**採寸だけ**聞く口を足した。
     ・ASIN で Catalog Items に聞いて **size_* だけ**書く
     ・ASIN・順位・値段・手数料・出品の可否は**触らない**
     ・1回 120件まで。聞いた行は dim_at で覚えて次の回に進む（migrate-0064） */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：採寸だけ取り直す（8.55）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwdim');
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  SP_CLIENT_ID:'c', SP_CLIENT_SECRET:'s', SP_REFRESH:'r' });
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
/* Catalog は **ASIN で**聞かれたら採寸を返す。 */
let calls=[], dims={};
globalThis.fetch=async(u,i)=>{
  const url=String(u);
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({ access_token:'t', expires_in:3600 }),
      {status:200,headers:{'content-type':'application/json'}});
  if(/catalog\/2022-04-01\/items/.test(url)){
    calls.push(url);
    const p=new URL(url).searchParams;
    const ids=String(p.get('identifiers')||'').split(',').filter(Boolean);
    return new Response(JSON.stringify({ items:ids.map((a)=>({
      asin:a,
      dimensions:(dims[a]===null)?[]:[{ package:Object.assign({
        length:{ value:17, unit:'centimeters' },
        width:{ value:13, unit:'centimeters' },
        height:{ value:1.5, unit:'centimeters' },
        weight:{ value:110, unit:'grams' } },dims[a]||{}) }] })) }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  return new Response('{}',{status:200});
};
const add=async(env,jan,o)=>{
  const at=new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,
       created_at) VALUES (?1,'いろは',0,'NS','商品',20,'h',?2,?2)`)
    .bind(jan,at).run();
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,basis,rank,rank_cat,new_n,amz,
       size_long,size_wid,size_hei,size_g,fee_total,fee_ref,fee_at,
       checked_at,asin_at,price_at,created_at)
     VALUES (?1,?2,'A',9000,'カート',1200,'ゲーム',3,0,?3,?4,?5,?6,1500,975,?7,
             ?7,?7,?7,?7)`)
    .bind(jan,(o||{}).asin===undefined?('B0DIM0000'+jan.slice(-1)):(o||{}).asin,
          (o||{}).long||0,(o||{}).wid||0,(o||{}).hei||0,(o||{}).g||0,at).run();
};
const row=async(env,jan)=>await env.DB.prepare(
  `SELECT * FROM mw_amz WHERE jan=?1`).bind(jan).first();

console.log('=== ① 採寸が足りない行を数える（GET）===');
let env=env0();
{
  await add(env,'4902370550001',{ long:17, wid:13, hei:1.5, g:110 }); // そろい
  await add(env,'4902370550002',{ long:17 });                        // 長辺だけ
  await add(env,'4902370550003',{ long:17, wid:13, hei:1.5 });        // 重さ無し
  await add(env,'4902370550004',{});                                 // 丸ごと無い
  await add(env,'4902370550005',{ asin:'' });                        // ASIN 無し
  calls=[];
  const d=await api(env,'/mw/dim/go');
  console.log('   '+JSON.stringify({ ok:d.ok, asked:d.asked, done:d.done,
    calls:d.calls, mark:d.mark }));
  ok(d.ok===true&&d.asked===3,
     '★★★採寸が足りない行だけ数える（ASIN が無い行は数えない）');
  ok(d.done===0&&d.calls===0&&calls.length===0,
     '★★★GET では Amazon に聞かない（数えるだけ）');
  ok(d.mark===true,'★migrate-0064 の列（dim_at）がある');
}

console.log('\n=== ② 聞くのは ASIN で・書くのは採寸だけ ===');
{
  const b0=await row(env,'4902370550002');
  calls=[];
  const d=await api(env,'/mw/dim/go',{});
  console.log('   '+JSON.stringify({ done:d.done, fix:d.fix, calls:d.calls,
    left:d.left }));
  ok(d.done===3&&d.fix===3,'★★★足りない3件に採寸が入る');
  ok(calls.length===1&&/identifiersType=ASIN/.test(calls[0]),
     '★★★**ASIN で**聞く（JAN では聞かない＝ASIN は引き直さない）');
  ok(/includedData=dimensions/.test(calls[0]),
     '★★聞くのは採寸だけ（includedData=dimensions）');
  const a=await row(env,'4902370550002');
  console.log('   '+JSON.stringify({ long:a.size_long, wid:a.size_wid,
    hei:a.size_hei, g:a.size_g, tier:a.size_tier, src:a.size_src }));
  ok(+a.size_wid===13&&+a.size_hei===1.5&&+a.size_g===110,
     '★★★3辺と重さが入る');
  ok(String(a.size_tier||'')!=='','★★サイズ区分も入れ直す');
  ok(a.asin===b0.asin&&String(a.asin_at||'')===String(b0.asin_at||''),
     '★★★ASIN と「最後に調べた時刻」は触らない（可否が未確認に戻らない）');
  ok(+a.price===9000&&String(a.basis||'')==='カート'
     &&+a.new_n===3&&+a.rank===1200,
     '★★★値段・出品者数・順位は触らない');
  ok(+a.fee_total===1500&&+a.fee_ref===975
     &&String(a.fee_at||'')===String(b0.fee_at||''),
     '★★★手数料も触らない');
  ok(!!String(a.dim_at||''),'★★聞いた印（dim_at）が入る');
  const z=await row(env,'4902370550001');
  ok(!String(z.dim_at||''),'★そろっている行は聞かない');
}

console.log('\n=== ③ 残りがあるときは次の回に進む ===');
{
  const e3=env0();
  for(let i=1;i<=4;i++)await add(e3,'490237055000'+i,{ long:17 });
  calls=[];
  const d1=await api(e3,'/mw/dim/go',{ limit:2 });
  console.log('   1回目 '+JSON.stringify({ done:d1.done, left:d1.left }));
  ok(d1.done===2&&d1.left===2,'★★★1回に聞くのは⚙の件数まで（残りを返す）');
  const d2=await api(e3,'/mw/dim/go',{ limit:2 });
  console.log('   2回目 '+JSON.stringify({ done:d2.done, left:d2.left }));
  ok(d2.done===2,'★★★2回目は**次の2件**を聞く（同じ行を聞き直さない）');
  const n=Number(((await e3.DB.prepare(
    `SELECT COUNT(*) AS n FROM mw_amz WHERE COALESCE(size_wid,0)>0`)
    .first())||{}).n||0);
  ok(n===4,'★★4件ぜんぶに採寸が入った');
  const d3=await api(e3,'/mw/dim/go',{});
  ok(d3.asked===0&&d3.done===0,'★★もう足りない行はない');
}

console.log('\n=== ④ 採寸が返らない行でも、次の回に進む ===');
{
  const e4=env0();
  await add(e4,'4902370550009',{ long:17 });
  dims['B0DIM00009']=null;                 // 採寸が返らない
  const d=await api(e4,'/mw/dim/go',{});
  console.log('   '+JSON.stringify({ done:d.done, fix:d.fix }));
  ok(d.done===1&&d.fix===0,'★★★返らなければ採寸は書かない（0 で消さない）');
  const a=await row(e4,'4902370550009');
  ok(+a.size_long===17,'★★★前に取れていた長辺は消さない');
  ok(!!String(a.dim_at||''),'★★★聞いた印は進める（同じ行を聞き続けない）');
  dims={};
}

console.log('\n=== ⑤ 管理者だけ ===');
{
  const req=(path,body)=>new Request('https://x'+path,
    { method:body?'POST':'GET',
      headers:Object.assign({'X-PJ-Key':'staff-key-123'},
        body?{'content-type':'application/json'}:{}),
      body:body?JSON.stringify(body):undefined });
  const a=await asJson(await worker.fetch(req('/mw/dim/go',{}),env,{}));
  ok(a.status===403,'★★★動かすのは管理者だけ');
  /* 数えるだけ（GET）は作業者でも見られる（/mw/dim/again と同じ）。
     売値も卸値も出さず、件数しか返さないため。 */
  const b=await asJson(await worker.fetch(req('/mw/dim/go'),env,{}));
  ok(b.status===200&&b.body.done===0,
     '★★数えるだけ（GET）は作業者でも見られる・何も変えない');
}

T.done();
