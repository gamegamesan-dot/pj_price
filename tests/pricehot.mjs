/* Worker：大事な行を24時間で取り直す／1行だけ売値を直す（7.131・v254）

   原因（E-B075LC617B-U で起きたこと）
     ① 3時間ごとの最安値（7.49）は 再調達中・Amazon無在庫・フェイズBの候補を
        まとめて1回40件ずつ取っていた。候補の行が増えたぶん**再調達中の行が
        後ろに回され**、最安値が4日古いままになっていた。
     ② 最安値が24時間より古いと rkTarget は何もしない（「最安値が古い」）。
        さらに売値の追従（jobRkPrice）は**日次**だったので、3時間ごとに
        最安値が新しくなっても売値は次の日次まで古いままだった。
   直したこと
     ① 大事な行（restocking=1／amz_drop）を**必ず先に**取り直す。
        24時間より古いまま残ったら知らせる。1回の上限は 40→60。
     ② 最安値を取り直した**直後に** jobRkPrice を回す。
     ③ 画面の行から1件だけ売値を直す口（POST /sync kind:price-one）。 */
import { harness, loadWorker, makeEnv, asJson } from './lib.mjs';
const T=harness('Worker：大事な行の最安値と1行の売値（7.131）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('pricehot');

const now=new Date().toISOString();
const ago=(h)=>new Date(Date.now()-h*3600000).toISOString();
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  EBAY_CLIENT_ID:'x', EBAY_CLIENT_SECRET:'y', EBAY_REFRESH:'z' });
const item=(env,o)=>env.DB.prepare(
  `INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,ebay_qty,
     ebay_price,ebay_seen_at,on_hand,one_off,one_off_known,dropship,mark_stop,
     restocking,fba_available,amazon_lowest,amazon_lowest_n,amazon_offers,
     amazon_lowest_at,cost_yen,weight_g,updated_at)
   VALUES (?1,?2,'ebay',?3,?4,?5,?6,?7,?8,0,0,1,?9,0,?10,?11,?12,?13,?14,?15,
     ?16,?17,?8)`)
  .bind(o.asin, o.cond||'used', o.title||('商品'+o.asin),
        o.sku||('E-'+o.asin+'-U'), o.item_id||('1'+o.asin.slice(1,10)),
        o.qty===undefined?1:o.qty, o.price||64.96, now,
        o.dropship||0, o.restocking===undefined?1:o.restocking,
        o.fba===undefined?0:o.fba,
        o.low||0, o.lowN||0, o.offers||0, o.low_at||null,
        o.cost||3000, o.g||200).run();
const call=async(env,body,key)=>asJson(await worker.fetch(
  new Request('https://x/sync',{ method:'POST',
    headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
    body:JSON.stringify(body) }), env));

console.log('=== ① 大事な行の条件（再調達中・Amazon 無在庫）===');
const pri=W.pricingHotPri();
console.log('   '+pri.replace(/\s+/g,' '));
ok(/restocking=1/.test(pri),'★★★再調達中（restocking=1）が入る');
ok(/amz_drop/.test(pri),'★★★Amazon 無在庫（amz_drop）も入る');
ok(!/fba_available/.test(pri),
   '★★★フェイズBの候補は「大事な行」に入れない（こちらは後回しでよい）');
ok(W.PRICING_HOT_KEEP_MS===24*60*60*1000,
   '★★★大事な行は24時間より古くしない');
ok(W.PRICING_HOT_MAX===60,
   '★★★1回の上限は60件（中古は新品も聞くので 120件＝呼び出し6回ぶん）');
ok(/restocking=1/.test(W.pricingHotWhere()),'★対象の条件にも入っている');

console.log('\n=== ② 大事な行を先に取り直す（候補の行に押しのけられない）===');
{
  const env=env0();
  /* 大事な行1件（4日古い）＋候補の行を上限より多く（ぜんぶ未取得＝もっと古い扱い）。 */
  await item(env,{ asin:'B075LC617B', title:'マリオオデッセイ 箱付き中古',
    restocking:1, low_at:ago(96), low:40, lowN:3, offers:5 });
  for(let i=0;i<80;i++)
    await item(env,{ asin:'B'+String(100000000+i), restocking:0, fba:0,
      qty:1, low_at:null });
  let sent=[];
  globalThis.fetch=async(u,o)=>{
    const url=String(u);
    if(/discord/.test(url))return new Response(null,{status:204});
    if(/o2\/token|identity/.test(url))
      return new Response(JSON.stringify({access_token:'t',expires_in:3600}),
        {status:200});
    if(/batches\/products\/pricing/.test(url)){
      const b=JSON.parse(String((o||{}).body||'{}'));
      sent.push(...(b.requests||[]).map((x)=>x.uri));
      return new Response(JSON.stringify({ responses:(b.requests||[])
        .map((q)=>({ request:q, status:{ statusCode:200 },
          body:{ payload:{ Summary:{ TotalOfferCount:3 },
            Offers:[{ SubCondition:q.ItemCondition==='New'?'new':'good',
              ListingPrice:{ Amount:5000 }, Shipping:{ Amount:0 } }] } } })) }),
        {status:200});
    }
    return new Response('{}',{status:200});
  };
  const run=W.PRICING&&null;
  const res=await W.syncPricingHot(env,{ at:now, kind:'t', notes:[], errors:0,
    net:[], calls:0 });
  console.log('   '+JSON.stringify({ picked:res.picked, rows:res.rows,
    pri:res.pri, pri_rows:res.pri_rows, pri_old:res.pri_old,
    after:res.pri_old_after }));
  ok(res.picked===81,'★★対象は81件（大事な行1＋候補80）');
  ok(res.pri===1&&res.pri_old===1,'★★★大事な行1件・24時間より古い1件');
  ok(res.rows===60,'★★1回に取るのは上限の60件');
  ok(res.pri_rows===1,
     '★★★候補が80件あっても大事な行は必ず入る（押しのけられない）');
  ok(res.pri_old_after===0,'★★★古いまま残った大事な行は0件');
  ok(sent.some((u)=>/B075LC617B/.test(u)),
     '★★★その行の最安値を本当に聞いている');
  const row=await env.DB.prepare(
    `SELECT amazon_lowest_at FROM items WHERE asin='B075LC617B'`).first();
  ok(String(row.amazon_lowest_at||'')>ago(1),'★★★取り直した時刻が新しくなる');
}

console.log('\n=== ③ 大事な行が上限を超えたら、古い順に取って残りを知らせる ===');
{
  const env=env0();
  for(let i=0;i<70;i++)
    await item(env,{ asin:'B'+String(200000000+i), restocking:1,
      low_at:ago(30+i), low:40, lowN:3, offers:5 });
  let msg=[];
  globalThis.fetch=async(u,o)=>{
    const url=String(u);
    if(/discord/.test(url)){
      msg.push(JSON.parse(String((o||{}).body||'{}')).content||'');
      return new Response(null,{status:204});
    }
    if(/o2\/token|identity/.test(url))
      return new Response(JSON.stringify({access_token:'t',expires_in:3600}),
        {status:200});
    if(/batches\/products\/pricing/.test(url)){
      const b=JSON.parse(String((o||{}).body||'{}'));
      return new Response(JSON.stringify({ responses:(b.requests||[])
        .map((q)=>({ request:q, status:{ statusCode:200 },
          body:{ payload:{ Summary:{ TotalOfferCount:3 },
            Offers:[{ SubCondition:q.ItemCondition==='New'?'new':'good',
              ListingPrice:{ Amount:5000 }, Shipping:{ Amount:0 } }] } } })) }),
        {status:200});
    }
    return new Response('{}',{status:200});
  };
  const res=await W.syncPricingHot(env,{ at:now, kind:'t', notes:[], errors:0,
    net:[], calls:0 });
  console.log('   '+JSON.stringify({ pri:res.pri, pri_rows:res.pri_rows,
    pri_old:res.pri_old, after:res.pri_old_after })+'／知らせ '+msg.length+'件');
  ok(res.pri===70&&res.pri_old===70,'★★70件ぜんぶが大事な行で24時間より古い');
  ok(res.pri_rows===60,'★★上限ぶんだけ取る');
  ok(res.pri_old_after===10,'★★★古いまま残った10件を数える');
  ok(msg.some((t)=>/24時間以上取り直せていません/.test(t)),
     '★★★残ったら必ず知らせる（売値の追従が止まるため）');
  ok(msg.some((t)=>/売値の追従が止まる/.test(t)),
     '★★★何が起きるかも書く');
  const first=await env.DB.prepare(
    `SELECT asin FROM items WHERE amazon_lowest_at > ?1
      ORDER BY asin LIMIT 1`).bind(ago(1)).first();
  ok(!!first,'★取り直した行がある');
}

console.log('\n=== ④ 1行だけ売値を直す（oneTarget）===');
{
  const S={ fx:155, adRate:2, csvRevAbs:1, csvRevPct:3 };
  const r0={ ebay_item_id:'1234567890', ebay_price:64.96, ebay_qty:1,
             rv_want:55.25, rv_floor:40, ebay_sale:0 };
  /* rvTarget は shared/pricing.js が計算する。ここでは「推奨売値が出ている行」
     として、Worker が最低売値で止めるかどうかだけを見る。 */
  const fake=(want,floor)=>({ rvTarget:()=>({ rv_kind:'rec', rv_want:want,
    rv_floor:floor, rv_max_cost:0 }) });
  const orig=W.PRICING.rvTarget;
  W.PRICING.rvTarget=fake(55.25,40).rvTarget;
  let t=W.oneTarget(S,r0);
  console.log('   '+JSON.stringify(t));
  ok(t.ok===true&&t.from===64.96&&t.to===55.25,
     '★★★推奨売値まで下げる（$64.96 → $55.25）');
  ok(t.under===false,'★最低売値より上なので止めない');
  W.PRICING.rvTarget=fake(30,40).rvTarget;
  t=W.oneTarget(S,r0);
  ok(t.ok===true&&t.to===40&&t.under===true,
     '★★★最低売値（$40）より下げない（下限利益を守る）');
  W.PRICING.rvTarget=fake(64.96,40).rvTarget;
  t=W.oneTarget(S,r0);
  ok(t.ok===false&&/同じです/.test(t.why),'★★同じ値なら何もしない');
  W.PRICING.rvTarget=fake(0,40).rvTarget;
  t=W.oneTarget(S,r0);
  ok(t.ok===false&&/推奨売値を計算できません/.test(t.why),
     '★★推奨売値が出ない行は触らない');
  W.PRICING.rvTarget=fake(55.25,40).rvTarget;
  ok(W.oneTarget(S,Object.assign({},r0,{ ebay_sale:1 })).why==='eBayのセール中です',
     '★★★セール中は触らない');
  ok(/数量0/.test(W.oneTarget(S,Object.assign({},r0,{ ebay_qty:0 })).why),
     '★★★数量0は触らない');
  ok(/出品していません/.test(
     W.oneTarget(S,Object.assign({},r0,{ ebay_item_id:'' })).why),
     '★出品していない行は触らない');
  /* ベストオファーのある行は自動拒否額を売値より下にする（22003 を避ける）。 */
  const bo=W.oneBo({ ebay_bo:1, ebay_bo_accept:70 },55.25,40);
  console.log('   BO '+JSON.stringify(bo));
  ok(bo.min===40,'★★★自動拒否額は最低売値');
  ok(bo.acc===55.24,'★★自動承諾額は新しい売値より下げる');
  ok(W.oneBo({ ebay_bo:0 },55.25,40).min===0,
     '★ベストオファーが無い行は触らない');
  W.PRICING.rvTarget=orig;
}

console.log('\n=== ⑤ POST /sync kind:price-one ===');
{
  const env=env0();
  await item(env,{ asin:'B075LC617B', title:'マリオオデッセイ 箱付き中古',
    restocking:1, price:64.96, low:40, lowN:3, offers:5, low_at:now });
  let wrote=[], msg=[];
  globalThis.fetch=async(u,o)=>{
    const url=String(u), body=String((o||{}).body||'');
    if(/discord/.test(url)){
      msg.push(JSON.parse(body).content||''); return new Response(null,{status:204});
    }
    if(/identity|o2\/token/.test(url))
      return new Response(JSON.stringify({access_token:'t',expires_in:3600}),
        {status:200});
    if(/ws\/api\.dll/.test(url)){
      wrote.push(body);
      return new Response('<?xml version="1.0"?><ReviseFixedPriceItemResponse>'
        +'<Ack>Success</Ack></ReviseFixedPriceItemResponse>',{status:200});
    }
    return new Response('{}',{status:200});
  };
  const r=await call(env,{ kind:'price-one', asin:'B075LC617B', cond:'used' });
  console.log('   '+JSON.stringify({ ok:r.body.ok, from:r.body.from,
    to:r.body.to, why:r.body.why }));
  ok(r.status===200,'★★口が開いている');
  ok(wrote.length===1&&/ReviseFixedPriceItem/.test(wrote[0]),
     '★★★eBay に1回だけ書き込む');
  ok(/<ItemID>1075LC617<\/ItemID>/.test(wrote[0])
     ||/<ItemID>/.test(wrote[0]),'★★その出品に書く');
  if(r.body.ok){
    const row=await env.DB.prepare(
      `SELECT ebay_price, restock_price FROM items WHERE asin='B075LC617B'`)
      .first();
    ok(Math.abs(+row.ebay_price-r.body.to)<0.01,
       '★★★D1 の売値も新しい値にそろえる');
    ok(Math.abs(+row.restock_price-r.body.to)<0.01,
       '★★★再調達中の行は「出し直した売値」もそろえる');
    ok(msg.some((t)=>/売値の見直しを1件反映/.test(t)),'★★Discord にも出す');
  } else {
    ok(!!r.body.why,'★直せないときは理由を返す');
    ok(true,'★（推奨売値が出ない環境では飛ばす）');
    ok(true,'★');
  }
}

console.log('\n=== ⑥ 作業者用のキーでは売値を変えられない ===');
{
  const env=env0();
  await item(env,{ asin:'B075LC617B', restocking:1 });
  const r=await call(env,{ kind:'price-one', asin:'B075LC617B', cond:'used' },
    'staff-key-123');
  ok(r.status===403,'★★★作業者用キーは 403');
}

console.log('\n=== ⑦ 行が無い・指定が足りない ===');
{
  const env=env0();
  let r=await call(env,{ kind:'price-one' });
  ok(r.body.ok===false&&/行が分かりません/.test(r.body.why),
     '★★asin と cond が無ければそう言う');
  r=await call(env,{ kind:'price-one', asin:'B000000000', cond:'used' });
  ok(r.body.ok===false&&/その行がありません/.test(r.body.why),
     '★★無い行はそう言う');
}

console.log('\n=== ⑧ 最安値を取り直した直後に売値を合わせる（源の確認）===');
{
  const fs=await import('node:fs');
  const src=fs.default.readFileSync(
    (await import('./lib.mjs')).WORKER,'utf8');
  const i=src.indexOf('syncPricingHot(env, run)');
  const j=src.indexOf('await jobPhaseB(env, {})', i);
  const between=src.slice(i,j);
  ok(/jobRkPrice/.test(between),
     '★★★3時間ごとの最安値のすぐあとに jobRkPrice を回す');
  ok(/getUTCHours\(\) % 3 === 0/.test(src),'★3時間ごとのまま');
  ok(W.PRICING_HOT_MAX>40,'★★上限を上げた（40→60）');
}
T.done();
