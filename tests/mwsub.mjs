/* Worker：会員に出す商品の印・販売数の上限・販売価格（7.130・【U の改】の1）
   ① POST /mw/sub で印・上限・価格を控える（管理者だけ）
   ② 印を付けるには上限と価格が要る
   ③ GET /mw/sub は印の付いた行を CSV に要る中身つきで返し、
      **会員に見せない項目（卸値・社・備考・MW の商品番号）は返さない**
   ④ /mw/amz の行に印・上限・価格が相乗りする
   ⑤ 見せるプラン（grades）を控える。ぜんぶ選んだら空（＝全プラン）
   ⑥ 表が無い（migrate-0051 の前）でも落ちない
   ⑦ 仕入原価に足す送料は **⚙ mwSubShip（会員価格用・既定 ¥0）**（7.140・【1】）
      仕入れタブの「カジの利益」が引く ⚙ mwShipFee（¥176）とは別の欄 */
import { harness, loadWorker, makeEnv, asJson } from './lib.mjs';
const T=harness('Worker：会員に出す商品（7.130）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwsub');
globalThis.fetch=async()=>new Response(null,{status:204});

const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123' });
const JAN='4902370550467', JAN2='4948872415019', JAN3='4549660927846';
const put=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,list_price,release,cond,
     wholesale,stock,note,ship_text,ship_days,row_hash,pick,seen_at,gone_at,
     created_at)
   VALUES (?1,'いろは商会',0,?2,?3,7678,'','新品',3000,9,'店長おすすめ','即日',0,
     'h',1,?4,NULL,?4)`).bind(o.jan, o.kishu||'Switch',
       o.name||('商品'+o.jan), '2026-11-10T00:00:00Z').run();
const amz=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,basis,new_n,checked_at,price_at,
     fee_total,size_tier,size_g)
   VALUES (?1,?2,?3,?4,'カート',3,?5,?5,?6,?7,?8)`)
  .bind(o.jan, o.asin, o.amz_name||'Amazon の名前', o.price||6000,
        '2026-11-10T00:00:00Z', o.fee_total||900, o.size_tier||'s',
        o.size_g||110).run();
const req=(path,body,key,method)=>new Request('https://x'+path,
  { method:method||(body?'POST':'GET'),
    headers:Object.assign({'X-PJ-Key':key||'k'},
      body?{'content-type':'application/json'}:{}),
    body:body?JSON.stringify(body):undefined });
const call=async(env,path,body,key,method)=>
  asJson(await worker.fetch(req(path,body,key,method),env));

console.log('=== ① 印・上限・価格を控える ===');
let env=env0();
await put(env,{ jan:JAN, name:'【新品】スーパーマリオパーティ ★' });
await amz(env,{ jan:JAN, asin:'B0D1GSZJ8T', amz_name:'スーパーマリオパーティ ジャンボリー' });
let r=await call(env,'/mw/sub',{ jan:JAN, on:1, max_qty:3, price:5300 });
console.log('   '+JSON.stringify(r.body.rows));
ok(r.status===200&&r.body.ok===true,'★★★控えられる');
ok(r.body.n===1&&r.body.rows[0].on===1&&r.body.rows[0].max_qty===3
   &&r.body.rows[0].price===5300,'★★★印・上限・価格が入る');
let row=await env.DB.prepare('SELECT * FROM mw_sub WHERE jan=?1').bind(JAN).first();
ok(+row.on_sale===1&&+row.max_qty===3&&+row.price===5300,'★★D1 に入る');
ok(!!row.at&&row.by_role==='admin','★誰がいつ付けたかも控える');

console.log('\n=== ② 印を付けるには上限と価格が要る ===');
r=await call(env,'/mw/sub',{ jan:JAN2, on:1, max_qty:0, price:0 });
ok(r.body.n===0&&r.body.rows[0].error==='need_qty_price',
   '★★★上限も価格も無いまま印は付けない');
r=await call(env,'/mw/sub',{ jan:JAN2, on:1, max_qty:2, price:0 });
ok(r.body.rows[0].error==='need_qty_price','★★価格だけ無くても付けない');
ok(+W.SUB_MAX_QTY===99,'★上限の上限は99点');
r=await call(env,'/mw/sub',{ jan:JAN, on:1, max_qty:500, price:9999999 });
row=await env.DB.prepare('SELECT * FROM mw_sub WHERE jan=?1').bind(JAN).first();
ok(+row.max_qty===99&&+row.price===W.SUB_PRICE_MAX,
   '★★★打ち間違いは上限で止める');

console.log('\n=== ③ 印を外しても上限と価格は残る（また出せる）===');
r=await call(env,'/mw/sub',{ jan:JAN, on:0 });
row=await env.DB.prepare('SELECT * FROM mw_sub WHERE jan=?1').bind(JAN).first();
ok(+row.on_sale===0,'★★★印が外れる');
ok(+row.max_qty===99&&+row.price===W.SUB_PRICE_MAX,
   '★★★上限と価格は控えたまま（次に出すとき使える）');
await call(env,'/mw/sub',{ jan:JAN, on:1, max_qty:3, price:5300 });

console.log('\n=== ④ 見せるプラン（grades）===');
ok(W.mwSubGrades('premium,standard')==='premium,standard'
   ||W.mwSubGrades('premium,standard')==='standard,premium',
   '★★選んだプランを控える');
ok(W.mwSubGrades('light standard premium monitor')==='',
   '★★★ぜんぶ選んだら空（＝全プランに見せる）にそろえる');
ok(W.mwSubGrades('')===''&&W.mwSubGrades('そんなプラン')==='',
   '★★知らない名前は落とす');
ok(W.mwSubGrades('PREMIUM')==='premium','★大文字でも通る');
r=await call(env,'/mw/sub',{ jan:JAN, on:1, max_qty:3, price:5300,
  grades:'premium,monitor' });
row=await env.DB.prepare('SELECT grades FROM mw_sub WHERE jan=?1').bind(JAN).first();
ok(/premium/.test(row.grades)&&/monitor/.test(row.grades),'★★★D1 に入る');

console.log('\n=== ⑤ まとめて控える（items）===');
await put(env,{ jan:JAN2 }); await amz(env,{ jan:JAN2, asin:'B0CW1GB9VN' });
await put(env,{ jan:JAN3 }); await amz(env,{ jan:JAN3, asin:'B0CZ6Y8HP2' });
r=await call(env,'/mw/sub',{ items:[
  { jan:JAN2, on:1, max_qty:5, price:3800 },
  { jan:JAN3, on:1, max_qty:9, price:2600 }] });
ok(r.body.n===2,'★★★2件を1回で控える');

console.log('\n=== ⑥ GET /mw/sub は CSV に要る中身を返す ===');
r=await call(env,'/mw/sub');
console.log('   '+JSON.stringify(r.body.rows[0]));
ok(r.body.ok===true&&r.body.table_ok===true&&r.body.n===3,
   '★★★印の付いた3件を返す');
const one=r.body.rows.filter((x)=>x.jan===JAN)[0];
ok(one.max_qty===3&&one.price===5300&&one.on===1,'★★上限と価格が入る');
ok(one.name==='スーパーマリオパーティ ジャンボリー',
   '★★★名前は Amazon の名前を使う（MW の名前の癖を避ける）');
ok(one.asin==='B0D1GSZJ8T'&&one.kishu==='Switch'&&one.size_g===110,
   '★★ASIN・機種・重さも返す（送料の区分に使う）');
const flat=JSON.stringify(r.body.rows);
ok(!/wholesale|"sha"|店長おすすめ|idx/.test(flat),
   '★★★卸値・社・備考・MW の商品番号は返さない');
r=await call(env,'/mw/sub?all=1');
ok(r.body.n===3,'★★?all=1 では印の無い行も返す（いまは3件とも印あり）');
await call(env,'/mw/sub',{ jan:JAN3, on:0 });
r=await call(env,'/mw/sub');
ok(r.body.n===2,'★★★印を外した行は返らない');
r=await call(env,'/mw/sub?all=1');
ok(r.body.n===3,'★★★?all=1 なら外した行も返る');
await call(env,'/mw/sub',{ jan:JAN3, on:1, max_qty:9, price:2600 });

console.log('\n=== ⑦ 作業者用のキーでは控えられない（売値が入るので）===');
r=await call(env,'/mw/sub',{ jan:JAN, on:1, max_qty:1, price:100 },
  'staff-key-123');
ok(r.status===403,'★★★作業者用キーは 403');
r=await call(env,'/mw/sub',null,'staff-key-123');
ok(r.status===200&&r.body.ok===true,'★★読むのは作業者でもできる');
r=await call(env,'/mw/sub/put',{ jans:[JAN] },'staff-key-123');
ok(r.status===403,'★★「出した印」も管理者だけ');

console.log('\n=== ⑧ /mw/amz の行に相乗りする ===');
r=await call(env,'/mw/amz?priced=1');
const ar=(r.body.rows||[]).filter((x)=>x.jan===JAN)[0]||{};
console.log('   '+JSON.stringify({ on:ar.sub_on, max:ar.sub_max,
  px:ar.sub_price, gr:ar.sub_grades }));
ok(+ar.sub_on===1&&+ar.sub_max===3&&+ar.sub_price===5300,
   '★★★印・上限・価格が行に付いてくる');
ok(/premium/.test(String(ar.sub_grades||'')),'★★見せるプランも付いてくる');
const noSub=(r.body.rows||[]).filter((x)=>x.jan===JAN2)[0]||{};
ok(+noSub.sub_on===1,'★★ほかの行も入る');

console.log('\n=== ⑨ 「Shopify に出した」印（SKU の日付に使う）===');
r=await call(env,'/mw/sub/put',{ jans:[JAN,JAN2] });
ok(r.body.ok===true&&r.body.n===2,'★★★出した件数を返す');
row=await env.DB.prepare('SELECT put_at FROM mw_sub WHERE jan=?1').bind(JAN).first();
ok(!!row.put_at,'★★★日時を控える');
r=await call(env,'/mw/sub');
ok(!!(r.body.rows.filter((x)=>x.jan===JAN)[0]||{}).put_at_jst,
   '★★画面に出す日本時間も返す');
r=await call(env,'/mw/sub/put',{ jans:['1234'] });
ok(r.body.n===0,'★JAN の形でないものは数えない');

console.log('\n=== ⑩ 表が無い（migrate-0051 の前）でも落ちない ===');
{
  const w2=await loadWorker('mwsub-nocol');
  const e2=env0();
  await e2.DB.prepare('DROP INDEX IF EXISTS idx_mw_sub_on_sale').run();
  await e2.DB.prepare('DROP TABLE IF EXISTS mw_sub').run();
  await put(e2,{ jan:JAN }); await amz(e2,{ jan:JAN, asin:'B0D1GSZJ8T' });
  const c=async(p,b)=>asJson(await w2.worker.fetch(req(p,b),e2));
  let z=await c('/mw/sub',{ jan:JAN, on:1, max_qty:3, price:5300 });
  console.log('   POST '+JSON.stringify({ ok:z.body.ok, t:z.body.table_ok,
    e:z.body.error }));
  ok(z.status===200&&z.body.table_ok===false&&z.body.error==='no_table',
     '★★★控えられないことを返す（落ちない）');
  z=await c('/mw/sub');
  ok(z.status===200&&z.body.table_ok===false&&z.body.n===0
     &&/migrate-0051/.test(String(z.body.fix||'')),
     '★★★どの migrate を流せばよいか出す');
  z=await c('/mw/amz?priced=1');
  ok(z.status===200&&z.body.ok===true&&z.body.rows.length===1,
     '★★★一覧は今までどおり出る');
  ok(z.body.rows[0].sub_on===undefined,'★★印の列は付かないだけ');
  z=await c('/mw/sub/put',{ jans:[JAN] });
  ok(z.status===200&&z.body.table_ok===false,'★「出した印」も落ちない');
}
console.log('\n=== ⑦ 仕入原価の送料は ⚙ mwSubShip（会員価格用・既定 ¥0）===');
{
  const cfg=(env,o)=>env.DB.prepare(
    `INSERT INTO sync_state (k,v,updated_at) VALUES (?1,?2,?3)
     ON CONFLICT(k) DO UPDATE SET v=excluded.v`)
    .bind('ui.settings', JSON.stringify({ at:'2026-11-13T00:00:00Z',
      settings:o||{} }), '2026-11-13T00:00:00Z').run();
  const e4=env0();
  /* 卸値 3,000（test の put が入れる値）→ 卸値×1.1 ＝ 3,300 */
  await put(e4,{ jan:JAN }); await amz(e4,{ jan:JAN, asin:'B0D1GSZJ8T' });
  const c4=async(p,b)=>asJson(await worker.fetch(req(p,b),e4));
  await c4('/mw/sub',{ jan:JAN, on:1, max_qty:3, price:5300 });
  let z=await c4('/mw/sub');
  console.log('   ⚙なし cost='+(z.body.rows[0]||{}).cost);
  ok(+(z.body.rows[0]||{}).cost===3300,
     '★★★⚙が無いときは送料を足さない（既定 ¥0）');
  /* カジの利益用の ⚙（mwShipFee）は会員の仕入原価に足さない。 */
  await cfg(e4,{ mwShipFee:176 });
  z=await c4('/mw/sub');
  console.log('   mwShipFee=176 cost='+(z.body.rows[0]||{}).cost);
  ok(+(z.body.rows[0]||{}).cost===3300,
     '★★★mwShipFee（¥176）は会員の仕入原価に足さない（別の欄）');
  await cfg(e4,{ mwShipFee:176, mwSubShip:120 });
  z=await c4('/mw/sub');
  console.log('   mwSubShip=120 cost='+(z.body.rows[0]||{}).cost);
  ok(+(z.body.rows[0]||{}).cost===3420,
     '★★★mwSubShip を入れたぶんだけ足す（3,300＋120）');
}
T.done();
