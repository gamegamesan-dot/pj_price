/* 販売連携タブ：予約済みの内訳の見せ方と、再調達の候補から外すこと（7.23）*/
const { harness } = require('./lib');
const T = harness('販売連携タブ：予約済みの内訳');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.click('#tabE');
await p.evaluate(()=>{
  const real=window.fetch;
  const item=(o)=>Object.assign({cond:'used',scope:'ebay',ebay_currency:'USD',
    ebay_seen_at:'2026-10-05T00:00:00Z',fba_available:0,fba_inbound:0,fba_reserved:0,
    fba_res_cust:null,fba_res_trans:null,fba_res_proc:null,
    fba_seen_at:'2026-10-05T00:00:00Z',mode:'hold',one_off:0,one_off_known:1,fba_link:1,
    on_hand:0,dropship:0,restocking:0,restock:0,fc_processing:0,state:'ok',warnings:[],
    ebay_sold:0,prefix:'game',amazon_lowest:4140,amazon_lowest_n:1,amazon_offers:6,
    amazon_offers_json:JSON.stringify([{p:4140,c:'good'}]),
    amazon_lowest_at:'2026-10-05T00:00:00Z',ebay_start:'2026-09-01T00:00:00Z'},o);
  window.fetch=function(url,opt){
    if(/\/status/.test(String(url)))return Promise.resolve({ok:true,json:()=>Promise.resolve({
      counts:{ebay:6,ebay_in_stock:5,listed:5,listed_no_fba:0,fba_not_listed:0,past_zero:0,
              on_hand:0,restock:1,restocking:0,dropship:0,ebay_unparsed:0},
      errors_recent:false,last_runs:[],sold_recent:[],
      items:[
        // 0 納品した直後（FC処理中だけ）
        item({asin:'B0FCPROC001',title:'納品した直後の商品',ebay_sku:'E-B0FCPROC001-U',
              ebay_item_id:'110111',ebay_qty:1,ebay_price:70,
              fba_reserved:1,fba_res_cust:0,fba_res_trans:0,fba_res_proc:1,fc_processing:1}),
        // 1 本当に売れた
        item({asin:'B0SOLD00001',title:'本当に売れた商品',ebay_sku:'E-B0SOLD00001-U',
              ebay_item_id:'110222',ebay_qty:1,ebay_price:70,
              fba_reserved:1,fba_res_cust:1,fba_res_trans:0,fba_res_proc:0,restock:1,
              warnings:['予約済みのみ（Amazonで注文済み）']}),
        // 2 FC移管だけ
        item({asin:'B0TRANS0001',title:'FC移管だけの商品',ebay_sku:'E-B0TRANS0001-U',
              ebay_item_id:'110333',ebay_qty:1,ebay_price:70,
              fba_reserved:2,fba_res_cust:0,fba_res_trans:2,fba_res_proc:0,fc_processing:1}),
        /* 3 内訳をまだ取っていない。Worker は候補から外す（restock:0）が、
              ここでは古い Worker のつもりで 1 を送り、画面側の判断でも
              候補にしないことを確かめる。 */
        item({asin:'B0NOINFO001',title:'内訳をまだ取っていない商品',ebay_sku:'E-B0NOINFO001-U',
              ebay_item_id:'110444',ebay_qty:1,ebay_price:70,fba_reserved:1,restock:1,
              res_unknown:1,res_hold:1,warnings:['予約済み（内訳不明）']}),
        // 4 内訳の合計が予約済みに届かない
        item({asin:'B0PARTIAL01',title:'内訳が足りない商品',ebay_sku:'E-B0PARTIAL01-U',
              ebay_item_id:'110666',ebay_qty:1,ebay_price:70,
              fba_reserved:3,fba_res_cust:0,fba_res_trans:1,fba_res_proc:0,
              res_unknown:1,res_hold:1,warnings:['予約済み（内訳不明）']}),
        // 5 予約なし（販売可能あり）
        item({asin:'B0PLAIN0001',title:'ふつうの在庫あり',ebay_sku:'E-B0PLAIN0001-U',
              ebay_item_id:'110555',ebay_qty:1,ebay_price:70,fba_available:2,
              fba_reserved:0,fba_res_cust:0,fba_res_trans:0,fba_res_proc:0})]})});
    return real(url,opt);
  };
  $('syncApi').value='https://pj-sync.example.workers.dev';
  $('syncKey').value='k';
});
await p.click('#syncLoad');
await p.waitForFunction(()=>!$('syncLoad').disabled&&$('syncNote').textContent.length>0,
  null,{timeout:8000});

console.log('=== 一覧の内訳表示 ===');
const rows=await p.$$eval('#syncList > div',ds=>ds.map(d=>d.innerText.replace(/\n/g,' | ')));
const line=(i)=>rows[i].split(' | ').filter(x=>/FBA 販売可能/.test(x)).join('');
rows.forEach((r,i)=>console.log('   '+i+': '+line(i)));
ok(/予約 1（注文保留 0／移管中 0／処理中 1）/.test(line(0)),
   '★納品直後：予約 1（注文保留 0／移管中 0／処理中 1）');
ok(/予約 1（注文保留 1／移管中 0／処理中 0）/.test(line(1)),'★売れた行：注文保留 1 と分かる');
ok(/予約 2（注文保留 0／移管中 2／処理中 0）/.test(line(2)),'★FC移管だけ：移管中 2 と分かる');
ok(/予約 1（内訳不明・次の取り込みを待ちます）/.test(line(3)),
   '★内訳をまだ取っていない行は「内訳不明」と書く');
ok(/予約 3（注文保留 0／移管中 1／処理中 0／不明 2）/.test(line(4)),
   '★内訳が足りない行は、分かっているぶんと不明なぶんを分けて書く');
ok(/予約 0/.test(line(5))&&!/（/.test(line(5).split('予約')[1]),'予約0の行は内訳を出さない');

console.log('\n=== 内訳ごとの印 ===');
rows.forEach((r,i)=>console.log('   '+i+': '+r.split(' | ').filter(x=>
  /予約済み|受領処理中|FC移管中|再調達/.test(x)).join('  ')));
ok(/FBA受領処理中/.test(rows[0])&&!/FC移管中/.test(rows[0]),
   '★処理中だけの行は「FBA受領処理中」');
ok(/FC移管中/.test(rows[2])&&!/FBA受領処理中/.test(rows[2]),
   '★移管中だけの行は「FC移管中」（表示を分ける）');
ok(!/FBA受領処理中|FC移管中/.test(rows[1]),'売れた行には付かない');
ok(!/FBA受領処理中|FC移管中/.test(rows[3]),'内訳が分からない行には付かない');
ok(!/予約済みのみ/.test(rows[0])&&!/予約済みのみ/.test(rows[2]),
   '★受領処理中・移管中の行に「予約済みのみ」の警告は出ない');
ok(/予約済みのみ（Amazonで注文済み）/.test(rows[1]),'★売れた行だけ「Amazonで注文済み」');
ok(/予約済み（内訳不明）/.test(rows[3])&&!/Amazonで注文済み/.test(rows[3]),
   '★内訳が分からない行は「予約済み（内訳不明）」');
ok(/予約済み（内訳不明）/.test(rows[4]),'★内訳が足りない行も「予約済み（内訳不明）」');
const cols=await p.$$eval('#syncList > div',ds=>ds.map(d=>
  Array.from(d.querySelectorAll('span')).filter(s=>/予約済み/.test(s.textContent))
    .map(s=>s.textContent+'='+getComputedStyle(s).backgroundColor).join()));
console.log('   '+JSON.stringify(cols.filter(Boolean)));
ok(/rgb\(102, 102, 102\)/.test(cols[3]),'★内訳不明の印は赤ではない（灰色）');
ok(/rgb\(176, 0, 32\)/.test(cols[1]),'注文済みの印は赤のまま');

console.log('\n=== 再調達の候補 ===');
const opts=await p.$$eval('#syncFilter option',os=>os.map(o=>o.value+':'+o.textContent));
console.log('   '+JSON.stringify(opts.filter(o=>/restock:|warn:/.test(o))));
ok(opts.some(o=>/^restock:再調達の候補（1）/.test(o)),'★候補は売れた行の1件だけ');
await p.selectOption('#syncFilter','restock'); await p.waitForTimeout(200);
const rs=await p.$$eval('#syncList > div',ds=>ds.map(d=>d.innerText.split('\n')[0]));
console.log('   '+JSON.stringify(rs));
ok(rs.length===1&&/本当に売れた/.test(rs[0]),'★売れた行だけが候補');
ok(!rs.some(t=>/納品した直後|FC移管|内訳をまだ|内訳が足りない/.test(t)),
   '★納品直後・FC移管・内訳不明の行は出ない（Workerが候補として送ってきても）');
await p.selectOption('#syncFilter','all'); await p.waitForTimeout(200);
const rb=await p.$$eval('#syncList > div',ds=>ds.map(d=>d.innerText));
ok(!/再調達の候補/.test(rb[3])&&!/再調達の候補/.test(rb[4]),
   '★行の印にも「再調達の候補」を出さない');
ok(/再調達の候補/.test(rb[1]),'売れた行には印が出る');
await T.done();
})();
