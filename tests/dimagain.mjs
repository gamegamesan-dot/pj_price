/* Worker：採寸の取り直し（8.51・カジの直し2）

   カジの報告（2026-11-16）「3辺そろっていない 98件は多すぎます。
   migrate-0060 より前に取った行が取り直されていないのでは」。

   原因は2つ
     ① 見つけた不具合：Catalog の採寸を読むとき、**梱包のほうに重さだけ
        あると、商品のほうの寸法を見ていなかった**（tests/sizetier.mjs）
     ② migrate-0060（短辺・厚さ）より前に取った行は長辺だけ
   ASIN・順位は3日ごとに引き直すので直した版のあとは順に埋まるが、
   すぐ埋めたいときは `asin_at` を空にして、次の「Amazonで調べる」で
   先に取り直させる（**消すのは時刻だけ**）。 */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：採寸の取り直し（8.51）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('dimagain');
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123' });
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
const add=async(env,jan,o)=>{
  const at=new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,
       created_at) VALUES (?1,'いろは',0,'NS','商品',20,'h',?2,?2)`)
    .bind(jan,at).run();
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,size_long,size_wid,size_hei,
       size_g,checked_at,asin_at,price_at,basis,created_at)
     VALUES (?1,?2,'A',9000,?3,?4,?5,110,?6,?6,?6,'カート',?6)`)
    .bind(jan,(o||{}).asin===undefined?'B0AAA':(o||{}).asin,
          (o||{}).long||0,(o||{}).wid||0,(o||{}).hei||0,at).run();
};

console.log('=== ① 取り直す行を数える（GET）===');
let env=env0();
{
  await add(env,'4902370550001',{ long:17, wid:13, hei:1.5 });  // そろっている
  await add(env,'4902370550002',{ long:17 });                   // 長辺だけ
  await add(env,'4902370550003',{ long:17, wid:13 });           // 2辺
  await add(env,'4902370550004',{});                            // 丸ごと無い
  /* ASIN が無い行は、ふだんの引き当てで取るのでここでは数えない。 */
  await add(env,'4902370550005',{ asin:'', long:0 });
  const d=await api(env,'/mw/dim/again');
  console.log('   '+JSON.stringify(d));
  ok(d.ok===true&&d.n===3,
     '★★★3辺そろっていない行だけ数える（ASIN が無い行は数えない）');
  ok(d.done===0,'★★★GET では何も変えない（数えるだけ）');
  const a=await env.DB.prepare(
    `SELECT asin_at FROM mw_amz WHERE jan='4902370550002'`).first();
  ok(!!String((a||{}).asin_at||''),'★★時刻もそのまま');
}

console.log('\n=== ② 取り直す印を付ける（POST）===');
{
  const d=await api(env,'/mw/dim/again',{});
  console.log('   '+JSON.stringify(d));
  ok(d.ok===true&&d.done===3,'★★★3件に印を付ける');
  const rows=await env.DB.prepare(
    `SELECT jan, asin, asin_at, size_long, price FROM mw_amz ORDER BY jan`)
    .all();
  const by={};
  for(const r of ((rows&&rows.results)||[]))by[String(r.jan)]=r;
  ok(!String(by['4902370550002'].asin_at||''),
     '★★★「最後に調べた時刻」を空にする（次の回で先に取り直す）');
  ok(String(by['4902370550002'].asin||'')==='B0AAA'
     &&Number(by['4902370550002'].size_long)===17
     &&Number(by['4902370550002'].price)===9000,
     '★★★ASIN・採寸・値段は消さない（時刻だけ）');
  ok(!!String(by['4902370550001'].asin_at||''),
     '★★★そろっている行は触らない');
}

console.log('\n=== ③ 列が無い D1 では落ちない ===');
{
  const w2=await loadWorker('dimagain-nocol');
  const e2=env0();
  await e2.DB.prepare('ALTER TABLE mw_amz DROP COLUMN size_wid').run()
    .catch(()=>{});
  const z=await asJson(await w2.worker.fetch(get('/mw/dim/again'),e2,{}));
  console.log('   '+JSON.stringify(z.body));
  ok(z.status===200,'★★落ちない');
  ok(z.body.ok===false?/migrate-0060/.test(String(z.body.detail||''))
     :z.body.ok===true,
     '★★列が無ければ、どの migrate を流すか出す');
}

console.log('\n=== ④ 作業者のキーでは動かせない ===');
{
  const req=(path,body)=>new Request('https://x'+path,
    { method:body?'POST':'GET',
      headers:Object.assign({'X-PJ-Key':'staff-key-123'},
        body?{'content-type':'application/json'}:{}),
      body:body?JSON.stringify(body):undefined });
  const z=await asJson(await worker.fetch(req('/mw/dim/again',{}),env,{}));
  ok(z.status===403,'★★★印を付けるのは管理者だけ');
}
T.done();
