/* Worker：過去の記録を数え直す（7.142・カジの手当ての依頼）

   v270 で「一度に消えた」を売れた数に数えないようにしたが、
   **それまでに積んでしまった記録はそのまま**だった。
   （彩京 SHOOTING LIBRARY Vol.1 の 415点など）

   ・「CSV から行がなくなった回」と「1回で⚙のしきい値以上が減って0になった回」を
     さかのぼって「一度に消えた」に直す（売れた数・売れる速さ・
     欠品までの見込みから外す）
   ・同じ数で戻ってきた回も「再入荷」「欠品」から外す
   ・**直す前に下見**（対象の商品数と主な例）を出し、
     approve を付けたときだけ書く
   ・積み直しは mw_move から（90日より古い記録はもう無いので、
     そこは今までどおり・§7.134 と同じ決まり） */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：過去の記録を数え直す（7.142）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwrecount');
globalThis.fetch=async()=>new Response(null,{status:204});

const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123' });
const J='4571442047206', J2='4902370550002', J3='4902370550003';
const stock=(env,jan,name)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,wholesale,stock,row_hash,
     seen_at,created_at)
   VALUES (?1,'いろは商会',0,'NS2',?2,3000,0,'h',?3,?3)`)
  .bind(jan,name,'2026-11-13T00:00:00Z').run();
/* v269 までの「まちがった」記録を直に作る（当時と同じ中身）。 */
const mv=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_move (at,jan,sha,idx,prev,cur,d,kind,created_at)
   VALUES (?1,?2,'いろは商会',0,?3,?4,?5,?6,?1)`)
  .bind(o.at,o.jan,o.prev===undefined?null:o.prev,
        o.cur===undefined?null:o.cur,o.d,o.kind).run();
const st=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_stat (jan,sha,first_at,last_at,down_n,down_qty,up_n,up_qty,
     gone_n,back_n,back_qty,gone_days,base_qty,wipe_n,wipe_qty,created_at)
   VALUES (?1,'いろは商会',?2,?3,?4,?5,0,0,?6,?7,?8,?9,?10,0,0,?2)`)
  .bind(jan,'2026-11-01T00:00:00Z','2026-11-12T00:00:00Z',
        o.down_n||0,o.down_qty||0,o.gone_n||0,o.back_n||0,o.back_qty||0,
        o.gone_days||0,o.base||0).run();
const stat=async(env,jan)=>(await env.DB.prepare(
  `SELECT * FROM mw_stat WHERE jan=?1`).bind(jan).first())||{};
const api=async(env,path,body)=>asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}));
/* 作業者用のキーで叩く（lib の get/post は管理者用のキーを入れる）。 */
const reqKey=(path,body,key)=>new Request('https://x'+path,
  { method:body?'POST':'GET',
    headers:Object.assign({'X-PJ-Key':key},
      body?{'content-type':'application/json'}:{}),
    body:body?JSON.stringify(body):undefined });

/* ① 彩京の形（415 → CSV から消えた）。
   ② 1回で 0 になった（しきい値以上）。
   ③ 同じ数で戻ってきた。
   ④ ふつうに売れた行（触らない）。 */
const seed=async(env)=>{
  await stock(env,J,'彩京 SHOOTING LIBRARY Vol.1');
  await stock(env,J2,'1回で消えた商品');
  await stock(env,J3,'ふつうに売れた商品');
  /* J：はじめの記録 → CSV から消えた（v269 は down_qty に 415 を足していた） */
  await mv(env,{ at:'2026-11-01T00:00:00Z', jan:J, prev:null, cur:415, d:0,
    kind:'new' });
  await mv(env,{ at:'2026-11-12T00:00:00Z', jan:J, prev:415, cur:null,
    d:-415, kind:'gone' });
  await st(env,J,{ down_n:1, down_qty:415, gone_n:1, base:415 });
  /* J2：120 → 0（CSV には残っている・v269 は「売れた」にしていた） */
  await mv(env,{ at:'2026-11-02T00:00:00Z', jan:J2, prev:null, cur:120, d:0,
    kind:'new' });
  await mv(env,{ at:'2026-11-10T00:00:00Z', jan:J2, prev:120, cur:0, d:-120,
    kind:'down' });
  await st(env,J2,{ down_n:1, down_qty:120, base:120 });
  /* J3：20 → 15 → 10（ふつうに売れた） */
  await mv(env,{ at:'2026-11-03T00:00:00Z', jan:J3, prev:null, cur:20, d:0,
    kind:'new' });
  await mv(env,{ at:'2026-11-05T00:00:00Z', jan:J3, prev:20, cur:15, d:-5,
    kind:'down' });
  await mv(env,{ at:'2026-11-07T00:00:00Z', jan:J3, prev:15, cur:10, d:-5,
    kind:'down' });
  await st(env,J3,{ down_n:2, down_qty:10, base:20 });
};

console.log('=== ① 下見（何も書かない）===');
let env=env0();
await seed(env);
let r=await api(env,'/mw/move/recount',{});
console.log('   '+JSON.stringify({ ok:r.body.ok, dry:r.body.dry_run,
  n_jan:r.body.n_jan, down_off:r.body.down_off, wipe_n:r.body.wipe_n,
  wipe_add:r.body.wipe_add }));
console.log('   '+JSON.stringify(r.body.rows));
ok(r.status===200&&r.body.ok===true,'★下見が返る');
ok(r.body.dry_run===true&&r.body.applied===false,'★★★下見では何もしない');
ok(r.body.n_jan===2,'★★★直す商品は2件（ふつうに売れた行は入らない）');
ok(r.body.down_off===535,'★★★売れた数から外す合計（415＋120）');
ok(r.body.wipe_n===2&&r.body.wipe_add===535,'★★★一度に消えた回数と数');
const ex=(r.body.rows||[]).filter((x)=>x.jan===J)[0]||{};
ok(ex.name==='彩京 SHOOTING LIBRARY Vol.1'&&ex.down_off===415,
   '★★★主な例に JAN・商品名・減った数を出す');
ok((await stat(env,J)).down_qty===415,'★★★下見のあとも記録は変わっていない');
ok(+r.body.wipe_pct===80&&+r.body.wipe_min===50,
   '★使ったしきい値も返す（⚙で変えられる）');

console.log('\n=== ② 実行（approve を付けたとき）===');
r=await api(env,'/mw/move/recount',{ approve:true });
console.log('   '+JSON.stringify({ applied:r.body.applied, n_jan:r.body.n_jan,
  down_off:r.body.down_off }));
ok(r.body.applied===true,'★★★approve で実行する');
{
  const a=await stat(env,J), b=await stat(env,J2), c=await stat(env,J3);
  console.log('   彩京: '+JSON.stringify({ down:a.down_qty, wipe_n:a.wipe_n,
    wipe_q:a.wipe_qty, gone:a.gone_n }));
  console.log('   1回で: '+JSON.stringify({ down:b.down_qty, wipe_n:b.wipe_n,
    wipe_q:b.wipe_qty }));
  console.log('   ふつう: '+JSON.stringify({ down:c.down_qty, n:c.down_n }));
  ok(+a.down_qty===0&&+a.wipe_n===1&&+a.wipe_qty===415,
     '★★★CSV から消えた回を「一度に消えた」に直す');
  ok(+a.gone_n===1,'★欠品の回数は残る（本当に消えたので）');
  ok(+b.down_qty===0&&+b.wipe_n===1&&+b.wipe_qty===120,
     '★★★1回でしきい値以上減って0になった回も直す');
  ok(+c.down_qty===10&&+c.down_n===2,
     '★★★ふつうに売れた行はそのまま（触らない）');
  ok(+a.base_qty===415&&+c.base_qty===20,'★★基準の数は残る');
}
/* もう一度下見すると「直すものが無い」。 */
r=await api(env,'/mw/move/recount',{});
console.log('   2回目の下見: '+JSON.stringify({ n_jan:r.body.n_jan,
  down_off:r.body.down_off }));
ok(r.body.n_jan===0&&r.body.down_off===0,
   '★★★2回やっても二重に外さない（数え直しなので何度でも通る）');

console.log('\n=== ③ 同じ数で戻ってきた回（再入荷・欠品から外す）===');
{
  const e2=env0();
  await stock(e2,J,'彩京 SHOOTING LIBRARY Vol.1');
  await mv(e2,{ at:'2026-11-01T00:00:00Z', jan:J, prev:null, cur:415, d:0,
    kind:'new' });
  await mv(e2,{ at:'2026-11-10T00:00:00Z', jan:J, prev:415, cur:null, d:-415,
    kind:'gone' });
  /* v269 は prev=0・cur=415 の 'back' を書いていた（同じ数で戻った） */
  await mv(e2,{ at:'2026-11-12T00:00:00Z', jan:J, prev:0, cur:415, d:415,
    kind:'back' });
  await st(e2,J,{ down_n:1, down_qty:415, gone_n:1, back_n:1, back_qty:415,
    gone_days:2, base:415 });
  let z=await api(e2,'/mw/move/recount',{});
  console.log('   '+JSON.stringify({ n_jan:z.body.n_jan,
    back_off:z.body.back_off, gone_off:z.body.gone_off,
    down_off:z.body.down_off }));
  ok(z.body.back_off===1&&z.body.gone_off===1,
     '★★★下見に「再入荷から外す」「欠品から外す」も出す');
  z=await api(e2,'/mw/move/recount',{ approve:true });
  const a=await stat(e2,J);
  console.log('   '+JSON.stringify({ back:a.back_n, back_q:a.back_qty,
    gone:a.gone_n, gone_d:a.gone_days, wipe_n:a.wipe_n, down:a.down_qty }));
  ok(+a.back_n===0&&+a.back_qty===0,'★★★「再入荷」から外す');
  ok(+a.gone_n===0&&+a.gone_days===0,'★★★「欠品」からも外す');
  ok(+a.wipe_n===0&&+a.down_qty===0,
     '★★★消えた回も取り消す（CSV の抜けだったので）');
  /* 数が違って戻ったときは今までどおり「再入荷」。 */
  const e3=env0();
  await stock(e3,J2,'数が違って戻った商品');
  await mv(e3,{ at:'2026-11-01T00:00:00Z', jan:J2, prev:null, cur:415, d:0,
    kind:'new' });
  await mv(e3,{ at:'2026-11-10T00:00:00Z', jan:J2, prev:415, cur:null, d:-415,
    kind:'gone' });
  await mv(e3,{ at:'2026-11-12T00:00:00Z', jan:J2, prev:0, cur:300, d:300,
    kind:'back' });
  await st(e3,J2,{ down_qty:415, gone_n:1, back_n:1, back_qty:300, base:415 });
  await api(e3,'/mw/move/recount',{ approve:true });
  const b=await stat(e3,J2);
  console.log('   '+JSON.stringify({ back:b.back_n, back_q:b.back_qty,
    gone:b.gone_n, gone_d:b.gone_days, wipe_q:b.wipe_qty }));
  ok(+b.back_n===1&&+b.back_qty===300,'★★★数が違えば「再入荷」のまま');
  ok(Math.abs(+b.gone_days-2)<0.05,
     '★★★欠品していた日数も出し直す（消えた回と戻った回の差・2日）');
  ok(+b.wipe_qty===415,'★★消えた回は「一度に消えた」に数える');
}

console.log('\n=== ④ しきい値（⚙）で変わる ===');
{
  const e4=env0();
  await e4.DB.prepare(
    `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)`)
    .bind(JSON.stringify({ at:'2026-11-13T00:00:00Z',
      settings:{ mwWipeMin:200 } }),'2026-11-13T00:00:00Z').run();
  await stock(e4,J2,'1回で消えた商品');
  await mv(e4,{ at:'2026-11-02T00:00:00Z', jan:J2, prev:null, cur:120, d:0,
    kind:'new' });
  await mv(e4,{ at:'2026-11-10T00:00:00Z', jan:J2, prev:120, cur:0, d:-120,
    kind:'down' });
  await st(e4,J2,{ down_n:1, down_qty:120, base:120 });
  const z=await api(e4,'/mw/move/recount',{});
  console.log('   '+JSON.stringify({ min:z.body.wipe_min,
    n_jan:z.body.n_jan }));
  ok(+z.body.wipe_min===200,'★⚙のしきい値を使う');
  ok(z.body.n_jan===0,
     '★★★しきい値（200点）に届かない行は「一度に消えた」にしない');
}

console.log('\n=== ⑤ 作業者用のキーでは動かせない ===');
{
  const e5=env0();
  await seed(e5);
  let z=await asJson(await worker.fetch(
    reqKey('/mw/move/recount',{},'staff-key-123'),e5,{}));
  ok(z.status===403,'★★★下見も管理者だけ（売れる速さが変わるため）');
  z=await asJson(await worker.fetch(
    reqKey('/mw/move/recount',{ approve:true },'staff-key-123'),e5,{}));
  ok(z.status===403,'★★★実行も管理者だけ');
}

console.log('\n=== ⑥ 列が無い D1（migrate-0055 の前）===');
{
  const w2=await loadWorker('mwrecount-nocol');
  const e6=env0();
  await e6.DB.prepare('ALTER TABLE mw_stat DROP COLUMN wipe_n').run();
  await e6.DB.prepare('ALTER TABLE mw_stat DROP COLUMN wipe_qty').run();
  const z=await asJson(await w2.worker.fetch(
    post('/mw/move/recount',{}),e6,{}));
  console.log('   '+JSON.stringify({ ok:z.body.ok, err:z.body.error,
    detail:z.body.detail }));
  ok(z.status===200&&z.body.ok===false&&z.body.error==='no_column'
     &&/migrate-0055/.test(String(z.body.detail||'')),
     '★★★どの migrate を流せばよいか出す（落ちない）');
}
T.done();
