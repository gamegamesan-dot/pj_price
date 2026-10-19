/* Worker：印の取り消しで送る値を受け取れること（6.69）
   行ボタンの押し間違いを戻すとき、pj_price は /listings に「押す前の値」を送る。
   ・在庫0時（mode）は空文字（''）で「未設定」に戻せる
   ・送られてこなければ（null）いまの値をそのまま残す
   ・印（一点物・手元在庫・無在庫・値下げしない・eBay優先・今回は動かさない）は
     0/1 のどちらにも戻せる
   ・再調達中を戻すときは、一緒に消えた上限・売値も戻せる */
import { harness, loadWorker, makeEnv, post, asJson } from './lib.mjs';
const T=harness('Worker：印の取り消しで送る値');
const ok=T.ok;
const { worker }=await loadWorker('undo');
const env=makeEnv();
const now=new Date().toISOString();

const row=(asin)=>env.DB._db.prepare(
  'SELECT mode,one_off,one_off_known,on_hand,dropship,mark_stop,ebay_first,'
  +'pb_skip,pb_fail,restocking,restock_price,restock_max_cost '
  +'FROM items WHERE asin=? AND cond=?').get(asin,'used');
const send=async(items)=>await asJson(await worker.fetch(post('/listings',{items}),env));

async function seed(asin,extra){
  const d=Object.assign({mode:'hold',one_off:0,one_off_known:1,on_hand:0,dropship:0,
    mark_stop:0,ebay_first:0,pb_skip:0,pb_fail:0,restocking:0,
    restock_price:null,restock_max_cost:null},extra||{});
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,mode,one_off,one_off_known,on_hand,dropship,
    mark_stop,ebay_first,pb_skip,pb_fail,restocking,restock_price,restock_max_cost,
    updated_at)
    VALUES (?1,'used','ebay',?2,?3,'990001',1,30,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,
            ?14,?15,?16,?4)`)
    .bind(asin,asin+'の商品','E-'+asin+'-U',now,d.mode,d.one_off,d.one_off_known,
      d.on_hand,d.dropship,d.mark_stop,d.ebay_first,d.pb_skip,d.pb_fail,d.restocking,
      d.restock_price,d.restock_max_cost).run();
}

console.log('=== 在庫0時（mode）===');
await seed('B0UNDW0001',{mode:'restock'});
let r=await send([{asin:'B0UNDW0001',cond:'used',title:'x',mode:''}]);
console.log('   '+JSON.stringify(row('B0UNDW0001').mode));
ok(r.status===200&&r.body.accepted===1,'★受け付ける');
ok(row('B0UNDW0001').mode===null,'★★空文字（\'\'）で「未設定」に戻せる');
await send([{asin:'B0UNDW0001',cond:'used',title:'x',mode:'hold'}]);
ok(row('B0UNDW0001').mode==='hold','★値を送れば入る');
await send([{asin:'B0UNDW0001',cond:'used',title:'x',on_hand:true}]);
ok(row('B0UNDW0001').mode==='hold','★★送られてこなければそのまま残す');

console.log('\n=== 印を0/1のどちらにも戻せる ===');
await seed('B0UNDW0002',{one_off:1,dropship:1,mark_stop:1,ebay_first:1,pb_skip:1,
  pb_fail:2});
await send([{asin:'B0UNDW0002',cond:'used',title:'x',one_off:false,dropship:false,
  mark_stop:false,ebay_first:false,pb_skip:false}]);
let x=row('B0UNDW0002');
console.log('   '+JSON.stringify(x));
ok(x.one_off===0&&x.dropship===0&&x.mark_stop===0&&x.ebay_first===0&&x.pb_skip===0,
   '★★オフに戻せる');
ok(x.one_off_known===1,'★一点物を戻しても「人が決めた」印は立ったまま');
ok(x.pb_fail===0,'★「今回は動かさない」を外すと失敗の回数も0に戻る');
await send([{asin:'B0UNDW0002',cond:'used',title:'x',one_off:true,dropship:true,
  mark_stop:true,ebay_first:true,pb_skip:true}]);
x=row('B0UNDW0002');
ok(x.one_off===1&&x.dropship===1&&x.mark_stop===1&&x.ebay_first===1&&x.pb_skip===1,
   '★★オンにも戻せる');

console.log('\n=== 手元在庫は在庫があるとオンにしない ===');
await seed('B0UNDW0003',{on_hand:1});
await send([{asin:'B0UNDW0003',cond:'used',title:'x',on_hand:false}]);
ok(row('B0UNDW0003').on_hand===0,'★★オフに戻せる');
await send([{asin:'B0UNDW0003',cond:'used',title:'x',on_hand:true}]);
ok(row('B0UNDW0003').on_hand===1,'★在庫が無い行はオンに戻せる');

console.log('\n=== 再調達中の解除を戻す ===');
await seed('B0UNDW0004',{restocking:0});
await send([{asin:'B0UNDW0004',cond:'used',title:'x',restocking:true,
  restock_price:40,restock_max_cost:3000,restock_skip_acc:1}]);
x=row('B0UNDW0004');
console.log('   '+JSON.stringify(x));
ok(x.restocking===1,'★★印が戻る');
ok(x.restock_price===40&&x.restock_max_cost===3000,
   '★★一緒に消えた上限・売値も戻せる');

await T.done();
