/* Worker：価格の元データを D1 に残す／一覧の上限（7.27）
   ・POST /listings で weight_g・cost_yen・sold_usd・mark_at・mark_stop を保存する
   ・送られてこなかった項目は消さない（COALESCE）
   ・GET /status は返した件数と全体の件数を出し、上限で切れたら truncated を立てる */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：価格の元データと一覧の上限');
const ok=T.ok;
const { worker }=await loadWorker('pricesrc');
const env=makeEnv();
const now=new Date().toISOString();

async function seed(asin,extra){
  const d=Object.assign({cond:'used',scope:'ebay',title:asin+'の商品',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'110'+asin.slice(-3),ebay_qty:1,ebay_price:70,
    fba_available:1,fba_inbound:0,fba_reserved:0,fba_seen_at:now},extra||{});
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,fba_available,fba_inbound,fba_reserved,fba_seen_at,
    one_off,one_off_known,fba_link,on_hand,dropship,restocking,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,0,0,0,0,0,0,?14)`)
    .bind(asin,d.cond,d.scope,d.title,d.ebay_sku,d.ebay_item_id,d.ebay_qty,d.ebay_price,
      now,d.fba_available,d.fba_inbound,d.fba_reserved,d.fba_seen_at,now).run();
}
const row=async(asin)=>await env.DB.prepare(
  `SELECT weight_g,cost_yen,sold_usd,mark_at,mark_stop,one_off,one_off_known
     FROM items WHERE asin=?1 AND cond='used'`).bind(asin).first();

console.log('=== 名簿・書き出しで送った値を保存する ===');
await seed('B0PSRC0001');
await seed('B0PSRC0002');
await seed('B0PSRC0003');
let r=await asJson(await worker.fetch(post('/listings',{items:[
  { asin:'B0PSRC0001', cond:'used', custom_label:'E-B0PSRC0001-U',
    weight_g:520, cost_yen:3000, sold_usd:88.5, one_off:true }]}),env));
console.log('   '+JSON.stringify(r.body));
let v=await row('B0PSRC0001');
console.log('   '+JSON.stringify(v));
ok(r.status===200&&r.body.accepted===1,'受け付ける');
ok(v.weight_g===520&&v.cost_yen===3000&&Math.abs(v.sold_usd-88.5)<0.001,
   '★実重量・仕入値・相場を保存する');
ok(v.one_off===1&&v.one_off_known===1,'★一点物の印も立つ（人が決めた印つき）');

console.log('\n=== 送られてこなかった項目は消さない ===');
await asJson(await worker.fetch(post('/listings',{items:[
  { asin:'B0PSRC0001', cond:'used', custom_label:'E-B0PSRC0001-U',
    hand_qty:2 }]}),env));
v=await row('B0PSRC0001');
console.log('   '+JSON.stringify(v));
ok(v.weight_g===520&&v.cost_yen===3000&&Math.abs(v.sold_usd-88.5)<0.001,
   '★別の用事で送っても、価格の元データはそのまま残る');

console.log('\n=== 値下げの記録（最後に値下げした日・値下げしない）===');
const at='2026-10-08T01:02:03.000Z';
await asJson(await worker.fetch(post('/listings',{items:[
  { asin:'B0PSRC0002', cond:'used', mark_at:at, mark_stop:true }]}),env));
v=await row('B0PSRC0002');
console.log('   '+JSON.stringify(v));
ok(v.mark_at===at&&v.mark_stop===1,'★値下げした日と「値下げしない」を保存する');
// 印を下ろす（0 を送る）
await asJson(await worker.fetch(post('/listings',{items:[
  { asin:'B0PSRC0002', cond:'used', mark_stop:false }]}),env));
v=await row('B0PSRC0002');
console.log('   '+JSON.stringify(v));
ok(v.mark_stop===0&&v.mark_at===at,'★印は下ろせる。値下げした日は残る');

console.log('\n=== eBay優先の印（Amazon同等ラインを使わない行）===');
await asJson(await worker.fetch(post('/listings',{items:[
  { asin:'B0PSRC0003', cond:'used', ebay_first:true }]}),env));
let v3=await env.DB.prepare(
  `SELECT ebay_first,weight_g FROM items WHERE asin='B0PSRC0003' AND cond='used'`).first();
console.log('   '+JSON.stringify(v3));
ok(v3.ebay_first===1,'★印を保存する');
await asJson(await worker.fetch(post('/listings',{items:[
  { asin:'B0PSRC0003', cond:'used', ebay_first:false }]}),env));
v3=await env.DB.prepare(
  `SELECT ebay_first FROM items WHERE asin='B0PSRC0003' AND cond='used'`).first();
ok(v3.ebay_first===0,'★下ろせる');
const st0=(await asJson(await worker.fetch(get('/status?limit=50'),env))).body;
ok('ebay_first' in (st0.items.find((x)=>x.asin==='B0PSRC0003')||{}),
   '★一覧にも返す（pj_price が読む）');

console.log('\n=== 相場は 0 を送ると取り消せる ===');
await asJson(await worker.fetch(post('/listings',{items:[
  { asin:'B0PSRC0001', cond:'used', sold_usd:0 }]}),env));
v=await row('B0PSRC0001');
console.log('   '+JSON.stringify(v));
ok(v.sold_usd===0&&v.weight_g===520,
   '★相場だけ取り消せる（実重量・仕入値はそのまま）');
await asJson(await worker.fetch(post('/listings',{items:[
  { asin:'B0PSRC0001', cond:'used', sold_usd:88.5 }]}),env));

console.log('\n=== /status が価格の元データを返す ===');
let st=(await asJson(await worker.fetch(get('/status?limit=50'),env))).body;
const it=st.items.find((x)=>x.asin==='B0PSRC0001');
console.log('   '+JSON.stringify({weight_g:it.weight_g,cost_yen:it.cost_yen,
  sold_usd:it.sold_usd,mark_at:it.mark_at,mark_stop:it.mark_stop}));
ok(it.weight_g===520&&it.cost_yen===3000&&Math.abs(it.sold_usd-88.5)<0.001,
   '★pj_price が読めるように一覧に入れて返す');
ok('mark_at' in it&&'mark_stop' in it,'★値下げの記録も返す');

console.log('\n=== せどりすとSKU の仕入値を返す（D1 に仕入値が無い行のため）===');
/* せどりすとSKU は 接頭辞-仕入日-状態コード-ASIN-仕入原価。
   末尾の数字が仕入値（game-20261006-UA-B0DX747PD2-4030 → 4030円）。 */
async function sku(seller){
  await asJson(await worker.fetch(post('/listings',{items:[
    { sku:seller, custom_label:'E-'+seller.split('-')[3]+'-U' }]}),env));
}
await seed('B0SKU00001',{ebay_sku:'E-B0SKU00001-U'});
await sku('game-20261006-UA-B0SKU00001-4030');
await seed('B0SKU00002',{ebay_sku:'E-B0SKU00002-U'});
await sku('game-20260901-UG-B0SKU00002-1200');
await sku('game-20261006-UG-B0SKU00002-3500');   // 同じASINに2つ目（高いほう）
await sku('game-20261007-UG-B0SKU00002-2000');
st=(await asJson(await worker.fetch(get('/status?limit=50'),env))).body;
const s1=st.items.find((x)=>x.asin==='B0SKU00001');
const s2=st.items.find((x)=>x.asin==='B0SKU00002');
console.log('   1つだけ: '+JSON.stringify({sku_cost:s1.sku_cost,cost_yen:s1.cost_yen}));
console.log('   3つある: '+JSON.stringify({sku_cost:s2.sku_cost}));
ok(s1.sku_cost===4030,'★SKU の末尾の数字を仕入値として返す');
ok(s1.cost_yen===null,'D1 の仕入値（cost_yen）とは別に返す');
ok(s2.sku_cost===3500,'★同じASINに複数あるときはいちばん高い仕入値');
// 状態区分が違う個体は混ぜない
await seed('B0SKU00003',{ebay_sku:'E-B0SKU00003'});
await env.DB.prepare(`UPDATE items SET cond='new' WHERE asin='B0SKU00003'`).run();
await sku('game-20261006-UG-B0SKU00003-9000');   // こちらは中古の個体
st=(await asJson(await worker.fetch(get('/status?limit=50&scope=all'),env))).body;
const s3=st.items.find((x)=>x.asin==='B0SKU00003');
console.log('   区分ちがい: '+JSON.stringify({cond:s3.cond,sku_cost:s3.sku_cost}));
ok(s3.cond==='new'&&!s3.sku_cost,'★新品の出品に中古の個体の仕入値は使わない');
// カートリッジのみ（cart）の出品は、中古の個体の仕入値も見る
await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
  ebay_qty,ebay_price,ebay_seen_at,updated_at)
  VALUES ('B0SKU00002','cart','ebay','カートのみ','E-B0SKU00002-C','110999',1,30,?1,?1)`)
  .bind(now).run();
st=(await asJson(await worker.fetch(get('/status?limit=50'),env))).body;
const sc=st.items.find((x)=>x.asin==='B0SKU00002'&&x.cond==='cart');
console.log('   カートのみ: '+JSON.stringify({sku_cost:sc.sku_cost}));
ok(sc.sku_cost===3500,'★カートリッジのみは中古の個体の仕入値を使う（安全側）');

console.log('\n=== 一覧の上限と、切れたかどうか ===');
const all=(await asJson(await worker.fetch(get('/status?limit=50'),env))).body.rows_total;
st=(await asJson(await worker.fetch(get('/status?limit=2'),env))).body;
console.log('   '+JSON.stringify({limit:st.limit,ret:st.rows_returned,
  total:st.rows_total,cut:st.truncated})+'（全部で'+all+'件）');
ok(st.limit===2&&st.rows_returned===2,'★上限どおりの件数を返す');
ok(st.rows_total===all&&all>2,'★全部で何件あるかを返す');
ok(st.truncated===true,'★上限で切れたことを知らせる');
st=(await asJson(await worker.fetch(get('/status?limit=50'),env))).body;
console.log('   '+JSON.stringify({limit:st.limit,ret:st.rows_returned,
  total:st.rows_total,cut:st.truncated}));
ok(st.rows_returned===all&&st.rows_total===all&&st.truncated===false,
   '★切れていなければ truncated は立たない');
st=(await asJson(await worker.fetch(get('/status?limit=99999'),env))).body;
console.log('   上限の指定: limit='+st.limit);
ok(st.limit===5000,'★上限は5000件まで（1000件で切れていたのを上げた）');
T.done();
