/* Worker：配送ポリシー名を eBay から取って判定に使う（7.26）
   v124 までは「再調達・無在庫・再調達中なら W2000」と推測していた。
   「出品はすべて W2000、即発送の印の行だけ W1000」に変わると合わなくなるので、
   取り込みでポリシー名を保存し、それで判定する。 */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：配送ポリシー名');
const ok=T.ok;
const { worker, T:W }=await loadWorker('ship');
const env=makeEnv();
const now=new Date().toISOString();

async function seed(asin,extra){
  const d=Object.assign({cond:'used',scope:'ebay',title:asin+'の商品',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'110'+asin.slice(-3),ebay_qty:1,ebay_price:70,
    ebay_ship_profile:null,fba_available:0,fba_inbound:1,fba_reserved:0,
    fba_seen_at:now,mode:'hold',one_off:0,one_off_known:1,fba_link:1,
    on_hand:0,dropship:0,restocking:0},extra||{});
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,ebay_ship_profile,fba_available,fba_inbound,
    fba_reserved,fba_seen_at,mode,one_off,one_off_known,fba_link,on_hand,dropship,
    restocking,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)`)
    .bind(asin,d.cond,d.scope,d.title,d.ebay_sku,d.ebay_item_id,d.ebay_qty,d.ebay_price,
      now,d.ebay_ship_profile,d.fba_available,d.fba_inbound,d.fba_reserved,d.fba_seen_at,
      d.mode,d.one_off,d.one_off_known,d.fba_link,d.on_hand,d.dropship,d.restocking,now).run();
}
const find=(items,a)=>items.find((x)=>x.asin===a);

console.log('=== pj_price の設定から名前を読む ===');
await asJson(await worker.fetch(post('/settings',{at:now,
  settings:{csvShipProfile:'W1000',csvShipProfileRe:'W2000'}}),env));
await W.shipNamesLoad(env);
[['W2000','yes'],['w2000','yes'],[' W2000 ','yes'],['W1000','no'],
 ['Free shipping','' ],['','']].forEach(([v,want])=>{
  const got=W.shipKindOf(v);
  console.log('   「'+v+'」→ '+(got||'（分からない）'));
  ok(got===want,'★「'+v+'」の判定');
});

console.log('\n=== 名前が取れていればそれで決める（推測しない）===');
// mode=hold（推測なら W1000 扱い）なのに、eBay のポリシーは W2000
ok(W.isShipRestock({mode:'hold',ebay_ship_profile:'W2000'}),
   '★取れた名前が W2000 なら、mode が hold でも再調達用とみなす');
// mode=restock（推測なら W2000 扱い）なのに、eBay のポリシーは W1000
ok(!W.isShipRestock({mode:'restock',ebay_ship_profile:'W1000'}),
   '★取れた名前が W1000 なら、mode が restock でも即発送とみなす');
ok(W.isShipRestock({mode:'restock'})&&!W.isShipRestock({mode:'hold'}),
   '★名前が取れていない行は、これまでどおり推測で判定する');
ok(W.isShipRestock({mode:'hold',dropship:1})&&W.isShipRestock({mode:'hold',restocking:1}),
   '無在庫・再調達中の推測も残っている');

console.log('\n=== 納品待ちの分け方が名前で決まる ===');
await seed('B0W2000001',{title:'W2000で出している',ebay_ship_profile:'W2000',mode:'hold'});
await seed('B0W1000001',{title:'W1000で出している',ebay_ship_profile:'W1000',mode:'restock'});
await seed('B0NOPROF001',{title:'ポリシー名が取れていない',mode:'restock'});
const st=(await asJson(await worker.fetch(get('/status?limit=50'),env))).body;
st.items.forEach((x)=>console.log('   '+x.title+'：警告'+JSON.stringify(x.warnings)
  +' 情報'+JSON.stringify(x.notes)+' ship_restock='+x.ship_restock
  +' ship_known='+x.ship_known+' 名前='+(x.ebay_ship_profile||'（なし）')));
ok(find(st.items,'B0W2000001').warnings.length===0
   &&find(st.items,'B0W2000001').notes.length===1,
   '★W2000 の行は情報（mode が hold でも）');
ok(find(st.items,'B0W2000001').ship_known===1,'★名前で判定した印が付く');
ok(find(st.items,'B0W1000001').warnings.join()==='納品待ちで出品中',
   '★W1000 の行は警告（mode が restock でも）');
ok(find(st.items,'B0NOPROF001').notes.length===1
   &&find(st.items,'B0NOPROF001').ship_known===0,
   '★名前が無い行は推測のまま（印は付かない）');
ok(find(st.items,'B0W2000001').ebay_ship_profile==='W2000',
   '★一覧にポリシー名を返す（画面で食い違いを見せるため）');

console.log('\n=== 設定が無いときは 1000 / 2000 で見る ===');
const env2=makeEnv();
await W.shipNamesLoad(env2);
ok(W.shipKindOf('W2000')==='yes'&&W.shipKindOf('W1000')==='no',
   '★設定が無くても W1000 / W2000 は読める');
ok(W.shipKindOf('標準配送')==='','★知らない名前は「分からない」（推測に任せる）');
// 設定の名前が W1000/W2000 でなくても読める
await asJson(await worker.fetch(post('/settings',{at:new Date(Date.now()+1000).toISOString(),
  settings:{csvShipProfile:'即発送',csvShipProfileRe:'取り寄せ'}}),env));
await W.shipNamesLoad(env);
ok(W.shipKindOf('取り寄せ')==='yes'&&W.shipKindOf('即発送')==='no',
   '★pj_price で付けた名前でも読める');

console.log('\n=== 通知も同じ決まり（W2000 の納品待ちは通知しない）===');
const all=env.DB._db.prepare('SELECT * FROM items').all();
await env.DB.batch(W.stateEvents(env,all));
const ev=env.DB._db.prepare("SELECT type,asin FROM events WHERE type='INBOUND_LISTED'").all();
console.log('   INBOUND_LISTED: '+JSON.stringify(ev.map((x)=>x.asin)));
ok(!ev.some((x)=>x.asin==='B0W2000001'),'★W2000 の行は「納品待ち」を通知しない');
ok(ev.some((x)=>x.asin==='B0W1000001'),'★W1000 の行は通知する');

console.log('\n=== 最後に売れた日時を返す（値下げの停止に使う）===');
for(const [id,at] of [['o1','2026-10-08T00:00:00Z'],['o2','2026-10-09T00:00:00Z']])
  await env.DB.prepare(`INSERT INTO orders (channel,order_id,sku,asin,cond,qty,amount,
    currency,ordered_at,status,created_at) VALUES ('ebay',?1,'E-B0W2000001-U',
    'B0W2000001','used',1,70,'USD',?2,'Complete',?3)`).bind(id,at,now).run();
const st2=(await asJson(await worker.fetch(get('/status?limit=50'),env))).body;
const row=find(st2.items,'B0W2000001');
console.log('   '+row.title+'：最後に売れた '+row.ebay_sold_at);
ok(row.ebay_sold_at==='2026-10-09T00:00:00Z','★いちばん新しい注文の日時を返す');
ok(find(st2.items,'B0W1000001').ebay_sold_at===null,'売れていない行は空');
T.done();
