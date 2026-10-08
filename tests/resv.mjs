/* Worker：FBAの予約済みの内訳で分ける（7.20・7.23 の再発防止）
   ・納品した直後の「FC処理中」を売れたと取り違えない
   ・移管中・処理中だけの行を「Amazonで注文済み」と言わない
   ・内訳が分からない行は「予約済み（内訳不明）」とし、再調達の候補に入れない
   ・在庫0の古いSKUの NULL で、商品ごと永久に内訳不明にしない */
import { harness, loadWorker, makeEnv, get, asJson } from './lib.mjs';
const T=harness('Worker：予約済みの内訳');
const ok=T.ok;
const { worker, T:W }=await loadWorker('resv');
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

console.log('=== SP-API の応答から内訳を読む（invRow）===');
const s1=W.invRow({sellerSku:'game-20260101-UG-B0FCPROC001-1200',asin:'B0FCPROC001',
  productName:'納品した直後の商品',
  inventoryDetails:{fulfillableQuantity:0,reservedQuantity:{totalReservedQuantity:1,
    pendingCustomerOrderQuantity:0,pendingTransshipmentQuantity:0,fcProcessingQuantity:1}}});
console.log('   '+JSON.stringify(s1));
ok(s1.reserved===1&&s1.resCust===0&&s1.resProc===1,'★FC処理中だけの行を内訳どおりに読む');
const s2=W.invRow({sellerSku:'x',asin:'B0SOLD00001',
  inventoryDetails:{reservedQuantity:{totalReservedQuantity:1}}});
console.log('   合計だけ: '+JSON.stringify({r:s2.reserved,c:s2.resCust}));
ok(s2.reserved===1&&s2.resCust===null,
   '★合計だけの応答は内訳を0で埋めず未取得（null）にする');
ok(/details:\s*"true"/.test(
     (await import('node:fs')).default.readFileSync(
       (await import('./lib.mjs')).WORKER,'utf8')),
   'getInventorySummaries は details=true で呼ぶ（内訳が返る条件）');

console.log('\n=== 内訳ごとの言葉（resWarn）===');
const W1={fba_reserved:1,fba_res_cust:1,fba_res_trans:0,fba_res_proc:0};  // 注文保留
const W2={fba_reserved:1,fba_res_cust:0,fba_res_trans:0,fba_res_proc:1};  // 処理中だけ
const W3={fba_reserved:2,fba_res_cust:0,fba_res_trans:2,fba_res_proc:0};  // 移管中だけ
const W4={fba_reserved:1,fba_res_cust:null,fba_res_trans:null,fba_res_proc:null}; // 内訳なし
const W5={fba_reserved:3,fba_res_cust:0,fba_res_trans:1,fba_res_proc:0};  // 足りない内訳
[['注文保留',W1],['処理中だけ',W2],['移管中だけ',W3],['内訳なし',W4],['足りない',W5]]
  .forEach(([n,r])=>console.log('   '+n+': "'+W.resWarn(r)+'"'));
ok(W.resWarn(W1)==='予約済みのみ（Amazonで注文済み）',
   '★注文保留があるときだけ「Amazonで注文済み」');
ok(W.resWarn(W2)===''&&W.resWarn(W3)==='',
   '★移管中・処理中だけなら何も言わない（通常扱い）');
ok(W.resWarn(W4)==='予約済み（内訳不明）','★内訳が無い行は「予約済み（内訳不明）」');
ok(W.resWarn(W5)==='予約済み（内訳不明）','★内訳の合計が足りない行も「内訳不明」');
ok(!W.resSold(W4)&&!W.resSold(W5),'★内訳が分からない行を売れたとみなさない');
ok(W.resSold({fba_reserved:3,fba_res_cust:1,fba_res_trans:0,fba_res_proc:0}),
   '★残りが不明でも注文保留が1以上なら売れたとみなす');
ok(W.resHold(W2)&&W.resHold(W3)&&W.resHold(W4)&&W.resHold(W5)&&!W.resHold(W1),
   '★再調達の候補から外すのは 移管中・処理中だけ／内訳不明 の行');
ok(W.isFcProcessing(W2)&&W.isFcProcessing(W3)&&!W.isFcProcessing(W4)
   &&!W.isFcProcessing(W5),'★受領処理中と言えるのは内訳が揃っている行だけ');

console.log('\n=== 納品した直後の10件に警告を出さない（7.20 の不具合）===');
for(let i=1;i<=10;i++)
  await seed('B0FCPROC'+String(i).padStart(3,'0'),
    {title:'納品直後 '+i+'件目',fba_reserved:1,fba_res_cust:0,fba_res_trans:0,fba_res_proc:1});
await seed('B0SOLD00001',{title:'本当に売れた商品',fba_reserved:1,
  fba_res_cust:1,fba_res_trans:0,fba_res_proc:0});
await seed('B0TRANS0001',{title:'FC移管だけの商品',fba_reserved:2,
  fba_res_cust:0,fba_res_trans:2,fba_res_proc:0});
await seed('B0MIXED0001',{title:'注文と処理中が混ざった商品',fba_reserved:3,
  fba_res_cust:1,fba_res_trans:0,fba_res_proc:2});
await seed('B0NOINFO001',{title:'内訳をまだ取っていない商品',fba_reserved:1});
const st=(await asJson(await worker.fetch(get('/status?limit=100'),env))).body;
const warn=st.items.filter((x)=>x.warnings.length);
console.log('   警告: '+JSON.stringify(warn.map((x)=>x.title+'→'+x.warnings.join(','))));
ok(Array.from({length:10},(_,i)=>find(st.items,'B0FCPROC'+String(i+1).padStart(3,'0')))
   .every((r)=>r.warnings.length===0&&r.fc_processing===1),
   '★納品直後の10件すべて 警告なし・FBA受領処理中の印');
ok(find(st.items,'B0SOLD00001').warnings.join()==='予約済みのみ（Amazonで注文済み）',
   '★注文保留がある行だけ「Amazonで注文済み」');
ok(find(st.items,'B0MIXED0001').warnings.join()==='予約済みのみ（Amazonで注文済み）',
   '★注文が混ざっていれば警告する（処理中があっても）');
ok(find(st.items,'B0TRANS0001').warnings.length===0
   &&find(st.items,'B0TRANS0001').fc_processing===1,'★FC移管だけの行も通常扱い');
ok(find(st.items,'B0NOINFO001').warnings.join()==='予約済み（内訳不明）'
   &&find(st.items,'B0NOINFO001').res_unknown===1,
   '★内訳が無い行は「予約済み（内訳不明）」（注文済みとは言わない）');

console.log('\n=== 再調達の候補（納品直後の二重仕入れを防ぐ）===');
console.log('   件数: restock='+st.counts.restock);
ok(st.counts.restock===2,'★候補は注文保留がある2件だけ');
const sr=(await asJson(await worker.fetch(get('/status?state=restock&limit=100'),env))).body;
console.log('   '+JSON.stringify(sr.items.map((x)=>x.title)));
ok(sr.items.length===2&&!sr.items.some((x)=>/納品直後/.test(x.title)),
   '★絞り込みでも納品直後の行は出ない');
ok(!sr.items.some((x)=>/FC移管|内訳をまだ/.test(x.title)),
   '★FC移管だけ・内訳不明の行も候補に出ない');
ok(find(st.items,'B0TRANS0001').restock===0&&find(st.items,'B0NOINFO001').restock===0,
   '★行の印（restock）でも候補にしない');

console.log('\n=== 通知も注文保留があるときだけ ===');
const all=env.DB._db.prepare('SELECT * FROM items').all();
await env.DB.batch(W.stateEvents(env,all));
const ev=env.DB._db.prepare("SELECT asin FROM events WHERE type='RESERVED_ONLY'").all();
console.log('   RESERVED_ONLY: '+JSON.stringify(ev.map((x)=>x.asin)));
ok(ev.length===2&&!ev.some((x)=>/FCPROC|TRANS|NOINFO/.test(x.asin)),
   '★通知は2件だけ（納品直後・移管中・内訳不明は通知しない）');
const n=env.DB._db.prepare('SELECT COUNT(*) AS n FROM events').get();
ok(n.n===2,'ほかの警告も増えていない（売り越しにもしない）');

console.log('\n=== 在庫0の古いSKUの NULL で内訳不明にしない（7.23 の不具合）===');
const run={subrequests:0,pages:0,skus:0,rows_written:0,events:0,errors:0,notes:[]};
await seed('B0OLDSKU001',{title:'古いSKUが混ざった商品'});
env.DB._db.prepare(`INSERT INTO skus (seller_sku,asin,cond,scope,fba_available,fba_inbound,
  fba_reserved,fba_res_cust,fba_res_trans,fba_res_proc,active,updated_at)
  VALUES ('game-20250101-UG-B0OLDSKU001-800','B0OLDSKU001','used','ebay',0,0,0,
          NULL,NULL,NULL,0,'2025-01-01T00:00:00Z')`).run();
await W.writeInventory(env,run,[{sku:'game-20261001-UG-B0OLDSKU001-1200',
  asin:'B0OLDSKU001',title:'いまのSKU',available:0,inbound:0,reserved:1,
  resCust:0,resTrans:0,resProc:1}]);
const od=env.DB._db.prepare("SELECT * FROM items WHERE asin='B0OLDSKU001'").get();
console.log('   '+JSON.stringify({res:od.fba_reserved,cust:od.fba_res_cust,
  proc:od.fba_res_proc}));
ok(od.fba_reserved===1&&od.fba_res_cust===0&&od.fba_res_proc===1,
   '★予約済みが0の古いSKUの NULL では内訳不明にしない');
ok(W.isFcProcessing(od)&&!W.resUnknown(od),
   '★FBA受領処理中と判定できる（ずっと内訳不明のままにならない）');
ok(W.resHold(od)&&!W.resSold(od),'★再調達の候補にもしない');

console.log('\n=== 予約済みを持つ個体に未取得が混ざったら内訳不明 ===');
await seed('B0MIXNULL01',{title:'内訳が混ざった商品'});
await W.writeInventory(env,run,[
  {sku:'game-20260104-UG-B0MIXNULL01-900',asin:'B0MIXNULL01',title:'内訳あり',
   available:0,inbound:0,reserved:1,resCust:1,resTrans:0,resProc:0},
  {sku:'game-20260105-UG-B0MIXNULL01-950',asin:'B0MIXNULL01',title:'内訳なし',
   available:0,inbound:0,reserved:1,resCust:null,resTrans:null,resProc:null}]);
const mx=env.DB._db.prepare("SELECT * FROM items WHERE asin='B0MIXNULL01'").get();
console.log('   '+JSON.stringify({res:mx.fba_reserved,cust:mx.fba_res_cust}));
ok(mx.fba_reserved===2&&mx.fba_res_cust===null,'★商品単位でも未取得（NULL）にする');
ok(W.resUnknown(mx)&&W.resHold(mx)&&!W.isFcProcessing(mx),
   '★その商品は内訳不明として扱う（売れたとも受領処理中とも決めない）');
T.done();
