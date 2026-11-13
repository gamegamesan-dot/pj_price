/* Worker：会員に出す販売価格の「手入れ」と、値段が変わったときの印外し
   （7.139／6.185・【1】）

   2026-11-13 の不具合
     pj の仕入れタブの価格の欄：2528 円
     その CSV を Shopify に読み込んだあとの価格：2539 円
   原因（この口のぶん）
     Shopify 用 CSV は書き出すたびに上乗せ（¥10〜150 の乱数）を引き直すのに、
     ・引き直した値を控える口（POST /mw/sub/put）が**どれを控えたか返さない**
       ので、画面は欄を書き直せず、古い値（2528）を出したままだった
     ・そのあと行の点数や印をいじると、画面の古い値が
       POST /mw/sub で price に書き戻され、Shopify の値（2539）が消えていた
     ・カジが手で直した値も、おすすめ値の範囲に入っていると引き直していた
   直し
     ① /mw/sub は hand（手入れ）の印を受け、/mw/sub（GET）は px_hand を返す
     ② 手入れの行は /mw/sub/put で引き直さない（控えの値をそのまま返す）
     ③ /mw/sub/put は控えた値段を prices（{JAN:値段}）で返す
     ④ 値段が変わった行は loaded_at（Shopify に読み込みました）を外す
     ⑤ px_hand が無い D1（migrate-0054 の前）でも落ちない */
import { harness, loadWorker, makeEnv, asJson } from './lib.mjs';
const T=harness('Worker：販売価格の手入れと印外し（7.139）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('subhand');
globalThis.fetch=async()=>new Response(null,{status:204});

const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123' });
const JAN='4571442047947', JAN2='4902370550467';
const put=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,list_price,release,cond,
     wholesale,stock,note,ship_text,ship_days,row_hash,pick,seen_at,gone_at,
     created_at)
   VALUES (?1,'いろは商会',0,?2,?3,7678,'','新品',?5,9,'備考','即日',0,
     'h',1,?4,NULL,?4)`).bind(o.jan, o.kishu||'NS',
       o.name||('商品'+o.jan), '2026-11-13T00:00:00Z', o.wholesale||2000).run();
const amz=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,basis,new_n,checked_at,price_at,
     fee_total,size_tier,size_g)
   VALUES (?1,?2,?3,?4,'カート',3,?5,?5,?6,'s',110)`)
  .bind(o.jan, o.asin||'B0D1GSZJ8T', o.amz_name||'Amazon の名前',
        o.price||6000, '2026-11-13T00:00:00Z', o.fee_total||900).run();
const req=(path,body,key)=>new Request('https://x'+path,
  { method:body?'POST':'GET',
    headers:Object.assign({'X-PJ-Key':key||'k'},
      body?{'content-type':'application/json'}:{}),
    body:body?JSON.stringify(body):undefined });
const call=async(env,path,body,key)=>
  asJson(await worker.fetch(req(path,body,key),env));
const col=async(env,jan,c)=>(await env.DB.prepare(
  'SELECT '+c+' AS v FROM mw_sub WHERE jan=?1').bind(jan).first()||{}).v;

console.log('=== ① 手入れの印（px_hand）を控える ===');
let env=env0();
await put(env,{ jan:JAN, name:'スチーム・ハーツ&アドヴァンスト' });
await amz(env,{ jan:JAN });
await put(env,{ jan:JAN2 }); await amz(env,{ jan:JAN2 });
let r=await call(env,'/mw/sub',{ jan:JAN, on:1, max_qty:3, price:2528 });
ok(r.status===200&&r.body.ok===true,'★控えられる');
ok(+(await col(env,JAN,'px_hand'))===0,'★★hand を入れなければ 0（おすすめ値）');
r=await call(env,'/mw/sub',{ jan:JAN, on:1, max_qty:3, price:2528, hand:1 });
ok(+(await col(env,JAN,'px_hand'))===1,'★★★hand:1 で手入れの印が立つ');
r=await call(env,'/mw/sub',{ jan:JAN, on:1, max_qty:5, price:2528 });
ok(+(await col(env,JAN,'px_hand'))===1,
   '★★★点数だけ直しても手入れの印は消えない（hand を入れていないとき）');
r=await call(env,'/mw/sub',{ jan:JAN, on:1, max_qty:5, price:2528, hand:0 });
ok(+(await col(env,JAN,'px_hand'))===0,'★★★hand:0 でおすすめ値に戻す');

console.log('\n=== ② GET /mw/sub が手入れの印を返す（画面が出し分ける）===');
await call(env,'/mw/sub',{ jan:JAN, on:1, max_qty:5, price:2528, hand:1 });
r=await call(env,'/mw/sub');
let row=(r.body.rows||[]).filter((x)=>x.jan===JAN)[0]||{};
console.log('   '+JSON.stringify({ px:row.price, hand:row.px_hand,
  loaded:row.loaded_at }));
ok(+row.px_hand===1,'★★★px_hand を返す');
ok(row.loaded_at!==undefined,'★★読み込み済みの印も返す');
ok(row.wholesale===undefined&&row.note===undefined,
   '★★★卸値・備考は返さない（会員に見せない項目・§8.2）');

console.log('\n=== ③ /mw/sub/put：控えた値段を返す（画面がこれで欄を直す）===');
r=await call(env,'/mw/sub',{ jan:JAN2, on:1, max_qty:2, price:3000 });
r=await call(env,'/mw/sub/put',{ jans:[JAN,JAN2],
  prices:{ [JAN]:2539, [JAN2]:3111 } });
console.log('   '+JSON.stringify({ prices:r.body.prices, ch:r.body.changed,
  hand:r.body.hand, un:r.body.unloaded }));
ok(r.body.ok===true&&r.body.n===2,'★件数を返す');
ok(+r.body.prices[JAN2]===3111,'★★★引き直した値段を控え、それを返す');
ok(+(await col(env,JAN2,'price'))===3111,'★★★D1 にも入る');
ok(+r.body.prices[JAN]===2528,
   '★★★手入れの行は引き直さない（控えの 2528 のまま）');
ok(+(await col(env,JAN,'price'))===2528,'★★★手入れの行の D1 も変わらない');
ok(+r.body.hand===1,'★★手入れでそのままにした件数を返す');
ok(+r.body.changed===1,'★★控え直した件数を返す');
ok(!!(await col(env,JAN,'put_at')),'★出した日時は手入れの行にも入る');

console.log('\n=== ④ 値段が変わったら「Shopify に読み込みました」の印を外す ===');
await call(env,'/sub/loaded',{ jans:[JAN,JAN2] });
ok(!!(await col(env,JAN2,'loaded_at')),'★印が付く');
r=await call(env,'/mw/sub/put',{ jans:[JAN,JAN2],
  prices:{ [JAN]:2528, [JAN2]:3222 } });
console.log('   '+JSON.stringify({ un:r.body.unloaded,
  l1:await col(env,JAN,'loaded_at'), l2:await col(env,JAN2,'loaded_at') }));
ok(+r.body.unloaded===1,'★★★値段が変わった件数を返す（画面が知らせに出す）');
ok(!(await col(env,JAN2,'loaded_at')),
   '★★★値段が変わった行は印を外す（読み込み直すまで配信に載せない）');
ok(!!(await col(env,JAN,'loaded_at')),
   '★★★値段が変わっていない行の印はそのまま');
r=await call(env,'/sub/plan');
let jans=[];
(r.body.plans||[]).forEach((p)=>(p.items||[]).forEach((x)=>jans.push(x.jan)));
ok(jans.indexOf(JAN2)<0,
   '★★★印を外した商品は配信の予定に出ない（Shopify と違う値段を会員に出さない）');

console.log('\n=== ⑤ 作業者用のキーでは控えられない ===');
r=await call(env,'/mw/sub',{ jan:JAN, on:1, max_qty:1, price:100, hand:1 },
  'staff-key-123');
ok(r.status===403,'★★★手入れも管理者だけ');

console.log('\n=== ⑥ px_hand が無い D1（migrate-0054 の前）でも落ちない ===');
{
  const w2=await loadWorker('subhand-nocol');
  const e2=env0();
  await e2.DB.prepare('ALTER TABLE mw_sub DROP COLUMN px_hand').run();
  await put(e2,{ jan:JAN }); await amz(e2,{ jan:JAN });
  const c=async(p,b)=>asJson(await w2.worker.fetch(req(p,b),e2));
  let z=await c('/mw/sub',{ jan:JAN, on:1, max_qty:3, price:2528, hand:1 });
  ok(z.status===200&&z.body.ok===true,'★★★控えられる（落ちない）');
  z=await c('/mw/sub');
  console.log('   '+JSON.stringify({ px:(z.body.rows[0]||{}).price,
    hand:(z.body.rows[0]||{}).px_hand }));
  ok(z.status===200&&+(z.body.rows[0]||{}).px_hand===0,
     '★★★印は 0（＝おすすめ値のまま）として返す・列を読まないだけ');
  z=await c('/mw/sub/put',{ jans:[JAN], prices:{ [JAN]:2539 } });
  console.log('   '+JSON.stringify({ ok:z.body.ok, prices:z.body.prices }));
  ok(z.status===200&&z.body.ok===true&&+z.body.prices[JAN]===2539,
     '★★★引き直した値段は控える（印が無いので引き直しは止まらない）');
}

console.log('\n=== ⑦ bind の数（D1 は 1文 100個まで）===');
{
  const e3=env0();
  const many=[];
  for(let i=0;i<250;i++){
    const j=String(4900000000000+i);
    await put(e3,{ jan:j });
    await e3.DB.prepare(
      `INSERT INTO mw_sub (jan,on_sale,max_qty,price,at,created_at)
       VALUES (?1,1,1,1000,?2,?2)`).bind(j,'2026-11-13T00:00:00Z').run();
    many.push(j);
  }
  const got=await W.mwSubRowsByJan(e3,many);
  ok(Object.keys(got).length===250,
     '★★★250件でも 90件ずつに割って引ける（bind は 100個まで）');
}
T.done();
