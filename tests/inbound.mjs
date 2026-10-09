/* Worker：入庫中の行の扱い（7.25）
   ・入庫中（納品した在庫がFCへ向かっている）行は再調達の候補にしない
   ・納品待ちで出品中は、配送ポリシーが再調達用（W2000）なら情報、
     それ以外（手元発送のポリシー）だけ警告に残す */
import { harness, loadWorker, makeEnv, get, asJson } from './lib.mjs';
const T=harness('Worker：入庫中と納品待ちの扱い');
const ok=T.ok;
const { worker, T:W }=await loadWorker('inb');
const env=makeEnv();
const now=new Date().toISOString();

async function seed(asin,extra){
  const d=Object.assign({cond:'used',scope:'ebay',title:asin+'の商品',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'110'+asin.slice(-3),ebay_qty:1,ebay_price:70,
    fba_available:0,fba_inbound:0,fba_reserved:0,fba_res_cust:null,fba_res_trans:null,
    fba_res_proc:null,fba_seen_at:now,mode:'hold',one_off:0,one_off_known:1,fba_link:1,
    on_hand:0,dropship:0,restocking:0,amazon_lowest:4140,amazon_offers:6,
    amazon_lowest_at:now},extra||{});
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,fba_available,fba_inbound,fba_reserved,fba_res_cust,
    fba_res_trans,fba_res_proc,fba_seen_at,mode,one_off,one_off_known,fba_link,on_hand,
    dropship,restocking,amazon_lowest,amazon_offers,amazon_lowest_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,
            ?22,?23,?24,?25,?26,?27)`)
    .bind(asin,d.cond,d.scope,d.title,d.ebay_sku,d.ebay_item_id,d.ebay_qty,d.ebay_price,
      now,d.fba_available,d.fba_inbound,d.fba_reserved,d.fba_res_cust,d.fba_res_trans,
      d.fba_res_proc,d.fba_seen_at,d.mode,d.one_off,d.one_off_known,d.fba_link,d.on_hand,
      d.dropship,d.restocking,d.amazon_lowest,d.amazon_offers,d.amazon_lowest_at,now).run();
}
const find=(items,a)=>items.find((x)=>x.asin===a);

console.log('=== 配送ポリシーが再調達用（W2000）とみなす行 ===');
[[{mode:'restock'},true,'在庫0のときの動作＝再調達'],
 [{dropship:1,ebay_qty:1},true,'無在庫'],
 [{restocking:1,ebay_qty:1},true,'再調達中'],
 [{mode:'hold'},false,'寝かせる（手元発送のポリシー）'],
 [{mode:'end'},false,'終了'],
 [{},false,'動作の指定なし']].forEach(([r,want,label])=>{
  const got=W.isShipRestock(r);
  console.log('   '+label+': '+got);
  ok(got===want,'★'+label+' → '+(want?'W2000':'それ以外'));
});

console.log('\n=== 入庫中の行は再調達の候補にしない（B0009NUP58・B003M2WQXW）===');
await seed('B0009NUP58',{title:'入庫1・販売可能0',fba_inbound:1,mode:'restock'});
await seed('B003M2WQXW',{title:'入庫2・販売可能0',fba_inbound:2,mode:'hold'});
await seed('B0SOLDOUT01',{title:'本当に売り切れ（入庫も予約も0）',mode:'restock'});
await seed('B0RESERVED1',{title:'注文が入っている',fba_reserved:1,
  fba_res_cust:1,fba_res_trans:0,fba_res_proc:0,mode:'restock'});
const st=(await asJson(await worker.fetch(get('/status?limit=100'),env))).body;
st.items.forEach((x)=>console.log('   '+x.title+'：restock='+x.restock
  +' 警告='+JSON.stringify(x.warnings)+' 情報='+JSON.stringify(x.notes)));
ok(find(st.items,'B0009NUP58').restock===0,'★入庫1の行は候補に入らない');
ok(find(st.items,'B003M2WQXW').restock===0,'★入庫2の行も候補に入らない');
ok(find(st.items,'B0SOLDOUT01').restock===1,'★入庫も予約も0の行は候補に入る');
ok(find(st.items,'B0RESERVED1').restock===1,'★注文が入っている行も候補に入る');
console.log('   件数: restock='+st.counts.restock);
ok(st.counts.restock===2,'★件数も2件（入庫中の2件は数えない）');
const sr=(await asJson(await worker.fetch(get('/status?state=restock&limit=100'),env))).body;
console.log('   '+JSON.stringify(sr.items.map((x)=>x.title)));
ok(sr.items.length===2
   &&!sr.items.some((x)=>x.asin==='B0009NUP58'||x.asin==='B003M2WQXW'),
   '★絞り込みでも入庫中の行は出ない');

console.log('\n=== 納品待ちで出品中：W2000 は情報、それ以外は警告 ===');
ok(find(st.items,'B0009NUP58').warnings.length===0,
   '★W2000（再調達）の納品待ちは警告にしない');
ok(find(st.items,'B0009NUP58').notes.join()==='納品待ちで出品中（再調達ポリシー）',
   '★情報として出す');
ok(find(st.items,'B0009NUP58').ship_restock===1,'★W2000 の印が付く');
ok(find(st.items,'B003M2WQXW').warnings.join()==='納品待ちで出品中',
   '★W1000（手元発送）の納品待ちは警告に残す');
ok(find(st.items,'B003M2WQXW').notes.length===0&&find(st.items,'B003M2WQXW').ship_restock===0,
   '★その行には情報の印を付けない');
// 無在庫・再調達中の行は、これまでどおり納品待ちの警告を出さない
await seed('B0DROP00001',{title:'無在庫',fba_inbound:1,dropship:1});
await seed('B0RESTOCK01',{title:'再調達中',fba_inbound:1,restocking:1});
const st2=(await asJson(await worker.fetch(get('/status?limit=100'),env))).body;
ok(find(st2.items,'B0DROP00001').warnings.length===0
   &&find(st2.items,'B0RESTOCK01').warnings.length===0,
   '無在庫・再調達中の行はこれまでどおり警告を出さない');

console.log('\n=== 入庫が無い行の判定は変えていない ===');
await seed('B0OVER00001',{title:'売り越しの恐れ',mode:'hold'});
await seed('B0ONHAND001',{title:'手元在庫あり',on_hand:1,mode:'hold'});
await seed('B0MISMATCH1',{title:'数量の食い違い',fba_available:1,ebay_qty:3,mode:'hold'});
const st3=(await asJson(await worker.fetch(get('/status?limit=100'),env))).body;
console.log('   '+JSON.stringify(st3.items.filter((x)=>/売り越し|手元|食い違い/.test(x.title))
  .map((x)=>x.title+'→'+x.warnings.join(','))));
ok(find(st3.items,'B0OVER00001').warnings.join()==='売り越しの恐れ','売り越しの恐れは残る');
ok(find(st3.items,'B0ONHAND001').warnings.length===0,'手元在庫の行は警告しない');
ok(find(st3.items,'B0MISMATCH1').warnings.join()==='数量の食い違い','数量の食い違いは残る');

console.log('\n=== 警告と情報を分けて返す（judgeRow）===');
const j=W.judgeRow({scope:'ebay',ebay_qty:1,fba_available:0,fba_inbound:1,
  fba_seen_at:now,mode:'restock',on_hand:0});
console.log('   '+JSON.stringify(j));
ok(j.w.length===0&&j.n.length===1,'★w（対応が必要）と n（情報）に分かれている');
ok(W.warnOf({scope:'ebay',ebay_qty:1,fba_available:0,fba_inbound:1,fba_seen_at:now,
  mode:'hold'}).join()==='納品待ちで出品中','warnOf はこれまでどおり警告だけ返す');
ok(W.noteOf({scope:'ebay',ebay_qty:1,fba_available:0,fba_inbound:1,fba_seen_at:now,
  mode:'restock'}).length===1,'noteOf は情報だけ返す');
T.done();
