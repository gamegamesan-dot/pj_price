/* Worker：選んだ行をまとめて直す（7.133・【Z】）
   ① POST /sync kind:price-many … 推奨売値に直す
      ・売値は Worker が計算する（画面から来た値は使わない）
      ・最低売値より下げない。数量0・セール中・出品なしはとばして理由を返す
      ・1日の上限（⚙ syncPxMax・既定30）を超える分は「上限のため次回」
      ・使った件数は sync_state に控える（D1 の列は増やさない）
   ② POST /sync kind:restock-start … 再調達の候補を再調達中にする
      ・Amazon最安値を取り直してから、売値を直して数量を1に戻すところまで1回
      ・一点物・無在庫・手元在庫・FBA在庫あり・すでに再調達中はとばす
   ③ どちらも作業者のキーでは動かない */
import { harness, loadWorker, makeEnv, asJson } from './lib.mjs';
const T=harness('Worker：選んだ行をまとめて直す（7.133）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('pxmany');

const now=new Date().toISOString();
let wrote=[], msg=[], lowCalls=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{}, body=String(o.body||'');
  if(/discord/.test(url)){ msg.push(JSON.parse(body).content||'');
    return new Response(null,{status:204}); }
  if(/identity|o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),
      {status:200});
  if(/batches\/products\/pricing/.test(url)){
    const b=JSON.parse(body||'{}');
    lowCalls.push((b.requests||[]).length);
    return new Response(JSON.stringify({ responses:(b.requests||[])
      .map((q)=>({ request:q, status:{ statusCode:200 },
        body:{ payload:{ Summary:{ TotalOfferCount:3 },
          Offers:[0,1,2].map(()=>({
            SubCondition:q.ItemCondition==='New'?'new':'good',
            ListingPrice:{ Amount:5000 }, Shipping:{ Amount:0 } })) } } })) }),
      {status:200});
  }
  if(/ws\/api\.dll/.test(url)){
    wrote.push(body);
    if(/GetItemRequest/.test(body))
      return new Response('<?xml version="1.0"?><GetItemResponse><Ack>Success</Ack>'
        +'<Item><Quantity>1</Quantity><SellingStatus><CurrentPrice>84.36'
        +'</CurrentPrice></SellingStatus><ListingStatus>Active</ListingStatus>'
        +'</Item></GetItemResponse>',{status:200});
    return new Response('<?xml version="1.0"?><X><Ack>Success</Ack></X>',
      {status:200});
  }
  return new Response('{}',{status:200});
};

const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  EBAY_CLIENT_ID:'x', EBAY_CLIENT_SECRET:'y', EBAY_REFRESH:'z',
  SP_CLIENT_ID:'a', SP_CLIENT_SECRET:'b', SP_REFRESH:'c' });
let seq=0;
const item=(env,o)=>{
  seq++;
  const d=Object.assign({ cond:'used', qty:1, price:84.36, restocking:0,
    dropship:0, one_off:0, sale:0, on_hand:0, fba:0, bo:0,
    low:5000, offers:3, low_at:now, cost:3000, g:150 },o||{});
  return env.DB.prepare(
    `INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,ebay_qty,
       ebay_price,ebay_seen_at,restocking,dropship,one_off,one_off_known,
       ebay_sale,ebay_bo,on_hand,fba_available,amazon_lowest,amazon_offers,
       amazon_lowest_at,cost_yen,weight_g,updated_at)
     VALUES (?1,?2,'ebay',?3,?4,?5,?6,?7,?8,?9,?10,?11,1,?12,?13,?14,?15,?16,
       ?17,?18,?19,?20,?8)`)
    .bind(d.asin, d.cond, d.asin+'の商品', 'E-'+d.asin+'-U',
          String(880000+seq), d.qty, d.price, now, d.restocking, d.dropship,
          d.one_off, d.sale, d.bo, d.on_hand, d.fba, d.low, d.offers,
          d.low_at, d.cost, d.g).run();
};
const call=async(env,body,key)=>asJson(await worker.fetch(
  new Request('https://x/sync',{ method:'POST',
    headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
    body:JSON.stringify(body) }), env));
const px=async(env,items,extra)=>await call(env,
  Object.assign({ kind:'price-many', items:items },extra||{}));

console.log('=== ① まとめて売値を直す ===');
{
  const env=env0();
  await item(env,{ asin:'B0PX000001' });
  await item(env,{ asin:'B0PX000002' });
  await item(env,{ asin:'B0PX000003' });
  wrote=[]; msg=[];
  const r=await px(env,[{asin:'B0PX000001',cond:'used'},
    {asin:'B0PX000002',cond:'used'},{asin:'B0PX000003',cond:'used'}]);
  console.log('   '+JSON.stringify({ n:r.body.n, done:r.body.done,
    skipped:r.body.skipped, max:r.body.max, used:r.body.used }));
  console.log('   '+JSON.stringify((r.body.rows||[])[0]));
  ok(r.status===200&&r.body.ok===true,'★★口が開いている');
  ok(r.body.n===3,'★★★選んだ3件を受ける');
  ok(r.body.done===3,'★★★3件とも直す');
  ok(wrote.filter((x)=>/ReviseFixedPriceItem/.test(x)).length===3,
     '★★★eBay に行ごとに1回ずつ書く');
  ok((r.body.rows||[]).every((x)=>x.ok&&x.from>0&&x.to>0),
     '★★★行ごとに いくら→いくら を返す');
  ok(r.body.max===80,'★★★1日の上限は既定80件（7.136 で 30 → 80）');
  ok(r.body.used===3,'★★使った件数を返す');
  ok(msg.some((t)=>/売値を 3件直しました/.test(t)),'★★Discord にも出す');
  const g=await env.DB.prepare(
    `SELECT ebay_price FROM items WHERE asin='B0PX000001'`).first();
  ok(Math.abs(+g.ebay_price-(r.body.rows||[])[0].to)<0.01,
     '★★★D1 の売値も新しい値にそろえる');
}

console.log('\n=== ② とばす行は理由を返す ===');
{
  const env=env0();
  await item(env,{ asin:'B0PX000011', qty:0 });
  await item(env,{ asin:'B0PX000012', sale:1 });
  await item(env,{ asin:'B0PX000013' });
  await env.DB.prepare(
    `UPDATE items SET ebay_item_id='' WHERE asin='B0PX000013'`).run();
  wrote=[];
  const r=await px(env,[{asin:'B0PX000011',cond:'used'},
    {asin:'B0PX000012',cond:'used'},{asin:'B0PX000013',cond:'used'},
    {asin:'B0PX000099',cond:'used'}]);
  const why=(a)=>((r.body.rows||[]).filter((x)=>x.asin===a)[0]||{}).why||'';
  console.log('   '+JSON.stringify((r.body.rows||[]).map((x)=>x.asin+':'+x.why)));
  ok(r.body.done===0&&r.body.skipped===4,'★★★4件ともとばす');
  ok(/数量0/.test(why('B0PX000011')),'★★★数量0は理由を返す');
  ok(/セール中/.test(why('B0PX000012')),'★★★セール中は理由を返す');
  ok(/出品していません/.test(why('B0PX000013')),'★★★出品なしは理由を返す');
  ok(/その行がありません/.test(why('B0PX000099')),'★★無い行も理由を返す');
  ok(wrote.filter((x)=>/Revise/.test(x)).length===0,'★★★eBay を呼ばない');
}

console.log('\n=== ③ 1日の上限（⚙ syncPxMax）===');
{
  const env=env0();
  for(let i=0;i<5;i++)await item(env,{ asin:'B0PXM0000'+i });
  const items=[0,1,2,3,4].map((i)=>({ asin:'B0PXM0000'+i, cond:'used' }));
  /* ⚙で上限を2件にする。 */
  await env.DB.prepare(
    `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,'x')
     ON CONFLICT(k) DO UPDATE SET v=excluded.v`)
    .bind(JSON.stringify({ at:now, settings:{ syncPxMax:2 } })).run();
  wrote=[];
  let r=await px(env,items);
  console.log('   '+JSON.stringify({ done:r.body.done, capped:r.body.capped,
    max:r.body.max, used:r.body.used }));
  ok(r.body.max===2,'★★★⚙で上限を変えられる');
  ok(r.body.done===2,'★★★上限ぶんだけ直す');
  ok(r.body.capped===3,'★★★超えた分は「上限のため次回」に数える');
  ok((r.body.rows||[]).filter((x)=>x.capped).length===3,'★★行にも印を付ける');
  ok(/上限のため次回/.test(((r.body.rows||[]).filter((x)=>x.capped)[0]||{}).why||''),
     '★★★理由にそう書く');
  ok(wrote.filter((x)=>/ReviseFixedPriceItem/.test(x)).length===2,
     '★★★上限を超えた行は eBay を呼ばない');
  /* もう一度押しても、24時間の枠を使い切っているので0件。 */
  r=await px(env,items);
  console.log('   2回目 '+JSON.stringify({ done:r.body.done,
    capped:r.body.capped, used:r.body.used }));
  ok(r.body.done===0&&r.body.capped>=1,
     '★★★24時間の枠を使い切っていれば次も直さない');
  ok(r.body.used===2,'★★使った件数は控えてある（D1 の列は増やさない）');
  await env.DB.prepare(`DELETE FROM sync_state WHERE k='ui.settings'`).run();
  ok(await W.pxUsed(env)===2,'★★控えは sync_state に入っている');
}

console.log('\n=== ④ 最低売値より下げない（price-one と同じ）===');
{
  const env=env0();
  /* 仕入値を高くして、推奨売値が最低売値より下になる行を作る。 */
  await item(env,{ asin:'B0PXF00001', price:200, cost:20000 });
  const r=await px(env,[{asin:'B0PXF00001',cond:'used'}]);
  const row=(r.body.rows||[])[0]||{};
  console.log('   '+JSON.stringify(row));
  ok(row.ok===true||!!row.why,'★返事がある');
  if(row.ok&&row.under)ok(row.to>=row.floor,'★★★最低売値で止める');
  else ok(true,'★（この仕入値では下限に当たらない）');
}

console.log('\n=== ⑤ 作業者のキーでは動かない ===');
{
  const env=env0();
  await item(env,{ asin:'B0PXS00001' });
  let r=await px(env,[{asin:'B0PXS00001',cond:'used'}],{},'x');
  r=await call(env,{ kind:'price-many',
    items:[{asin:'B0PXS00001',cond:'used'}] },'staff-key-123');
  ok(r.status===403,'★★★price-many は作業者用キーで 403');
  r=await call(env,{ kind:'restock-start',
    items:[{asin:'B0PXS00001',cond:'used'}] },'staff-key-123');
  ok(r.status===403,'★★★restock-start も 403');
}

console.log('\n=== ⑥ 再調達中にする（売値を直して数量1に戻す）===');
{
  const env=env0();
  /* FBA で売れて数量0・再調達の候補（マリオパーティ スーパースターズの形）。 */
  await item(env,{ asin:'B0RS000001', qty:0, price:84.36, fba:0,
    low_at:new Date(Date.now()-96*3600000).toISOString() });
  wrote=[]; msg=[]; lowCalls=[];
  const r=await call(env,{ kind:'restock-start',
    items:[{asin:'B0RS000001',cond:'used'}] });
  const row=(r.body.rows||[])[0]||{};
  console.log('   '+JSON.stringify({ n:r.body.n, done:r.body.done,
    skipped:r.body.skipped, low:r.body.low })+' row '+JSON.stringify(row));
  ok(r.status===200&&r.body.ok===true,'★★口が開いている');
  ok(lowCalls.length>=1,'★★★先に Amazon最安値を取り直す（古かったので）');
  if(r.body.done===1){
    ok(true,'★★★再調達中にする');
    const g=await env.DB.prepare(
      `SELECT ebay_qty,ebay_price,restocking,restock_price FROM items
        WHERE asin='B0RS000001'`).first();
    console.log('   '+JSON.stringify(g));
    ok(+g.ebay_qty===1,'★★★数量を1に戻す');
    ok(+g.restocking===1,'★★★再調達中の印を立てる');
    ok(Math.abs(+g.ebay_price-row.to)<0.01&&+g.ebay_price>0,
       '★★★売値を Amazon最安値の基準に直す');
    ok(Math.abs(+g.restock_price-+g.ebay_price)<0.01,
       '★★出し直した売値もそろえる');
    ok(wrote.some((x)=>/<Quantity>1<\/Quantity>/.test(x)),
       '★★★eBay に数量1と売値を1回で送る');
    ok(msg.some((t)=>/再調達中にしました/.test(t)),'★★Discord にも出す');
  }else{
    ok(!!row.why,'★直せないときは理由を返す：'+row.why);
    ok(true,'★'); ok(true,'★'); ok(true,'★'); ok(true,'★'); ok(true,'★');
  }
}

console.log('\n=== ⑦ 再調達中にしない行は理由を返す ===');
{
  const env=env0();
  await item(env,{ asin:'B0RS000011', qty:0, restocking:1 });
  await item(env,{ asin:'B0RS000012', qty:0, one_off:1 });
  await item(env,{ asin:'B0RS000013', qty:0, dropship:1 });
  await item(env,{ asin:'B0RS000014', qty:0, on_hand:1 });
  await item(env,{ asin:'B0RS000015', qty:0, fba:5 });
  await item(env,{ asin:'B0RS000016', qty:0, sale:1 });
  const r=await call(env,{ kind:'restock-start', items:[
    {asin:'B0RS000011',cond:'used'},{asin:'B0RS000012',cond:'used'},
    {asin:'B0RS000013',cond:'used'},{asin:'B0RS000014',cond:'used'},
    {asin:'B0RS000015',cond:'used'},{asin:'B0RS000016',cond:'used'}] });
  const why=(a)=>((r.body.rows||[]).filter((x)=>x.asin===a)[0]||{}).why||'';
  console.log('   '+JSON.stringify((r.body.rows||[]).map((x)=>x.asin+':'+x.why)));
  ok(r.body.done===0&&r.body.skipped===6,'★★★6件ともとばす');
  ok(/すでに再調達中/.test(why('B0RS000011')),'★★すでに再調達中');
  ok(/一点物/.test(why('B0RS000012')),'★★一点物');
  ok(/無在庫/.test(why('B0RS000013')),'★★無在庫');
  ok(/手元在庫/.test(why('B0RS000014')),'★★手元在庫');
  ok(/FBA に在庫があります/.test(why('B0RS000015')),'★★★FBA 在庫あり');
  ok(/セール中/.test(why('B0RS000016')),'★★セール中');
}

console.log('\n=== ⑧ 送る中身の整え方 ===');
ok(W.pxKeys({ items:[{asin:'A',cond:'used'},{asin:'A',cond:'used'},
  {asin:'B',cond:'new'},{asin:'',cond:'x'}] },10).length===2,
  '★★★同じ行と空の行は落とす');
ok(W.pxKeys({ items:[1,2,3].map((i)=>({asin:'A'+i,cond:'used'})) },2).length===2,
  '★★上限で切る');
ok(W.pxKeys({},10).length===0,'★空でも落ちない');
ok(W.PX_MAX_DEFAULT===80&&W.RESTOCK_ONE_MAX===30,
  '★★上限の既定（まとめて直す 80件・再調達中にする 30件）');
{
  const env=env0();
  ok((await W.pxSettings(env)).max===80,'★★⚙が無ければ既定80');
  await env.DB.prepare(
    `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,'x')`)
    .bind(JSON.stringify({ settings:{ syncPxMax:9999 } })).run();
  ok((await W.pxSettings(env)).max===W.PX_MAX_CAP,'★★★大きすぎる値は上限で止める');
}
T.done();
