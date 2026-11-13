/* Worker＋決まり：今日の配信の案（8.18・カジの依頼）

   ① 振り分けの決まり（shared/subplan.js）
      ・モニターはゲームソフト通常版のみ／ライト・スタンダード・プレミアムは全部
      ・共通：会員向き・出品できる・Amazon本体ありは除く（⚙）・
        「仕入れる」印は外す（⚙）・在庫処分で再入荷なしは優先
      ・並び：会員の粗利 × 売れる速さ の大きい順
   ② 販売数の上限：（MW在庫 − 売れる速さ×日数）× ⚙% と 想定購入数の小さいほう
   ③ 案の控え（POST /sub/draft）と、どの案から何が売れたか（GET /sub/draft） */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import SUBPLAN from '../shared/subplan.js';
const T=harness('今日の配信の案（8.18）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('subdraft');
globalThis.fetch=async()=>new Response(null,{status:204});
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123' });
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
const row=(o)=>Object.assign({ jan:'4902370550001', name:'ゲーム', fit:true,
  rst:'ok', amz:0, buy_qty:0, price:2000, qty:2, gross:800, speed:1,
  stock:9, is_game:true, grades:'', no_back:false, one_off:false },o);
const monitor=()=>SUBPLAN.list({}).filter((p)=>p.key==='monitor');
const all4=()=>SUBPLAN.list({ subOnLight:1, subOnStandard:1, subOnPremium:1 });

console.log('=== ① 共通の条件 ===');
{
  const o=SUBPLAN.pickOpt({});
  ok(SUBPLAN.whyNot(row({}),o)==='','★通る行は理由なし');
  ok(/会員向きではありません/.test(SUBPLAN.whyNot(row({ fit:false }),o)),
     '★★★会員向きでない行は外す');
  ok(/出品できません/.test(SUBPLAN.whyNot(row({ rst:'blocked' }),o)),
     '★★★出品できない行は外す');
  ok(/Amazon 本体/.test(SUBPLAN.whyNot(row({ amz:1 }),o)),
     '★★★Amazon 本体ありは外す（⚙）');
  ok(SUBPLAN.whyNot(row({ amz:1 }),
     SUBPLAN.pickOpt({ subPickNoAmz:false }))==='',
     '★★★⚙を切れば Amazon 本体ありも入れる');
  ok(/仕入れる印/.test(SUBPLAN.whyNot(row({ buy_qty:2 }),o)),
     '★★★「仕入れる」の印が付いた商品は案から外す（カジの5）');
  ok(SUBPLAN.whyNot(row({ buy_qty:2 }),
     SUBPLAN.pickOpt({ subPickSkipBuy:false }))==='',
     '★★★⚙を切れば外さない');
  ok(/販売価格/.test(SUBPLAN.whyNot(row({ price:0 }),o)),
     '★販売価格が出せない行は外す');
}

console.log('\n=== ② プランごとの振り分け ===');
{
  const rows=[row({ jan:'4902370550001', is_game:true }),
              row({ jan:'4902370550002', is_game:false }),
              row({ jan:'4902370550003', is_game:true, one_off:true })];
  const m=SUBPLAN.draft(rows,monitor(),{}).plans[0];
  console.log('   モニター '+JSON.stringify(m.items.map((x)=>x.jan)));
  ok(m.items.length===1&&m.items[0].jan==='4902370550001',
     '★★★モニターはゲームソフト通常版だけ（1点ものも入れない）');
  const d=SUBPLAN.draft(rows,all4(),{});
  const by={}; d.plans.forEach((p)=>{ by[p.key]=p.items.map((x)=>x.jan); });
  console.log('   '+JSON.stringify(by));
  ok(by.light.length===1,'★★ライトもゲームソフトだけ');
  ok(by.standard.length===2,'★★★スタンダードは全部（1点もの以外）');
  ok(by.premium.length===3,'★★★プレミアムは1点ものも入る');
}

console.log('\n=== ③ 並び順（会員の粗利 × 売れる速さ）===');
{
  const rows=[row({ jan:'4902370550001', gross:800, speed:1 }),
              row({ jan:'4902370550002', gross:500, speed:3 }),
              row({ jan:'4902370550003', gross:900, speed:0 }),
              row({ jan:'4902370550004', gross:400, speed:1, no_back:true,
                    sale:true })];
  const m=SUBPLAN.draft(rows,monitor(),{}).plans[0];
  console.log('   '+JSON.stringify(m.items.map((x)=>x.jan+':'
    +Math.round(x.score))));
  ok(m.items[0].jan==='4902370550002','★★★粗利×速さの大きい順');
  ok(SUBPLAN.scoreOf(row({ gross:400, speed:1, no_back:true }))
     >SUBPLAN.scoreOf(row({ gross:400, speed:1 })),
     '★★★在庫処分・再入荷なしは優先（点数を上げる）');
  ok(SUBPLAN.scoreOf(row({ gross:900, speed:0 }))===900*SUBPLAN.SPEED_MIN,
     '★★売れる速さが出せない行は 1日0.3点とみなす');
  const few=SUBPLAN.draft(rows,SUBPLAN.list({ subNMonitor:2 })
    .filter((p)=>p.key==='monitor'),{}).plans[0];
  ok(few.items.length===2&&few.over===2,
     '★★★1回の件数の上限で切り、あと何件かも返す');
}

console.log('\n=== ④ 販売数の上限のおすすめ ===');
{
  const o=SUBPLAN.pickOpt({});
  console.log('   '+JSON.stringify(o));
  ok(o.stockPct===30&&o.wantQty===5&&o.qtyDays===2,
     '★★★既定は MW在庫の30%・想定購入数5点・2日ぶん引く');
  ok(SUBPLAN.qtyOf({ stock:100, speed:0 },null,o)===5,
     '★★★在庫が多くても想定購入数（5点）まで');
  ok(SUBPLAN.qtyOf({ stock:9, speed:0.5 },null,o)===2,
     '★★★（9 − 0.5×2）×30% ＝ 2点');
  ok(SUBPLAN.qtyOf({ stock:3, speed:0 },null,o)===0,
     '★★★1点も出せない行は 0（案に出さない）');
  ok(SUBPLAN.qtyOf({ stock:0, speed:0 },null,o)===0,'★在庫が無ければ 0');
  ok(SUBPLAN.qtyOf({ stock:100, speed:0 },null,
     SUBPLAN.pickOpt({ subWantQty:10 }))===10,'★★⚙で想定購入数を変えられる');
  ok(SUBPLAN.qtyOf({ stock:100, speed:0 },null,
     SUBPLAN.pickOpt({ subStockPct:1 }))===1,'★★⚙で割合を変えられる');
  ok(SUBPLAN.qtyOf({ stock:20, speed:5 },null,
     SUBPLAN.pickOpt({ subQtyDays:4 }))===0,
     '★★★MW が先に売る分を引く（20 − 5×4 ＝ 0）');
  /* 上限が 0 の行は案に出ない。 */
  const m=SUBPLAN.draft([row({ qty:0 })],monitor(),{}).plans[0];
  ok(m.items.length===0&&m.skip===1,'★★★出せる数が無い行は案に出さない');
}

console.log('\n=== ⑤ 案を控える（POST /sub/draft）===');
let env=env0();
{
  const at='2026-11-13T09:00:00Z';
  let r=await api(env,'/sub/draft',{ at:at, items:[
    { jan:'4902370550001', plan:'monitor', name:'ゲームA', price:2000,
      qty:2, gross:800, speed:1.2 },
    { jan:'4902370550002', plan:'monitor', name:'ゲームB', price:3000,
      qty:1, gross:500, speed:0.4 }] });
  console.log('   '+JSON.stringify({ ok:r.ok, n:r.n, at:r.at }));
  ok(r.ok===true&&r.n===2,'★★★案の中身を控える');
  const row0=await env.DB.prepare(
    `SELECT * FROM sub_draft WHERE jan='4902370550001'`).first();
  ok(String(row0.at)===at&&row0.plan==='monitor'&&+row0.price===2000
     &&+row0.qty===2&&+row0.taken===1,
     '★★★日時・プラン・価格・上限・確定の印を残す');
  r=await api(env,'/sub/draft',{ at:at, items:[{ jan:'123' }] });
  ok(r.n===0,'★JAN の形でないものは控えない');
}

console.log('\n=== ⑥ どの案から何が売れたか（GET /sub/draft）===');
{
  /* 案のあとの注文を1件入れる。 */
  await env.DB.prepare(
    `INSERT INTO sub_order (order_no,sku,jan,qty,price,at,created_at)
     VALUES ('#1001','SUB-4902370550001-20261113','4902370550001',2,2000,
       ?1,?1)`).bind('2026-11-13T10:00:00Z').run();
  /* 案より前の注文は数えない。 */
  await env.DB.prepare(
    `INSERT INTO sub_order (order_no,sku,jan,qty,price,at,created_at)
     VALUES ('#0999','SUB-4902370550001-20261101','4902370550001',9,2000,
       ?1,?1)`).bind('2026-11-01T10:00:00Z').run();
  const d=await api(env,'/sub/draft?limit=5');
  console.log('   '+JSON.stringify(d.rows.map((g)=>({ at:g.at_jst, n:g.n,
    qty:g.qty, sold:g.sold }))));
  ok(d.ok===true&&d.rows.length===1,'★★★案ごとにまとめて返す');
  const g=d.rows[0];
  ok(g.n===2&&g.qty===3,'★★件数とのべ点数');
  ok(g.sold===2,'★★★その案から売れた点数（案より前の注文は数えない）');
  ok(!!g.at_jst,'★日本時間も返す');
  const it=(g.items||[]).filter((x)=>x.jan==='4902370550001')[0]||{};
  ok(it.sold===2&&it.name==='ゲームA','★★★商品ごとの売れた数も返す');
}

console.log('\n=== ⑦ 作業者のキーでは動かせない ===');
{
  const req=(path,body,key)=>new Request('https://x'+path,
    { method:body?'POST':'GET',
      headers:Object.assign({'X-PJ-Key':key},
        body?{'content-type':'application/json'}:{}),
      body:body?JSON.stringify(body):undefined });
  let z=await asJson(await worker.fetch(
    req('/sub/draft',{ items:[] },'staff-key-123'),env,{}));
  ok(z.status===403,'★★★控えるのは管理者だけ');
  z=await asJson(await worker.fetch(
    req('/sub/draft',null,'staff-key-123'),env,{}));
  ok(z.status===403,'★★見るのも管理者だけ（売値が出るため）');
}

console.log('\n=== ⑧ 表が無い（migrate-0056 の前）でも落ちない ===');
{
  const w2=await loadWorker('subdraft-nocol');
  const e2=env0();
  await e2.DB.prepare('DROP TABLE IF EXISTS sub_draft').run();
  let z=await asJson(await w2.worker.fetch(
    post('/sub/draft',{ items:[{ jan:'4902370550001' }] }),e2,{}));
  console.log('   '+JSON.stringify({ ok:z.body.ok, err:z.body.error }));
  ok(z.status===200&&z.body.ok===false&&z.body.error==='no_table'
     &&/migrate-0056/.test(String(z.body.detail||'')),
     '★★★どの migrate を流せばよいか出す');
  z=await asJson(await w2.worker.fetch(get('/sub/draft'),e2,{}));
  ok(z.status===200&&z.body.table_ok===false,'★★見る口も落ちない');
}
T.done();
