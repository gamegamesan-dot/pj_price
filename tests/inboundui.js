/* 販売連携タブ：入庫中の行と、納品待ちの見せ方（7.25）
   ・入庫中の行は「再調達の候補」に入らない
   ・W2000（再調達ポリシー）の納品待ちは灰色の情報で、「対応が必要」から外れる
   ・W1000（手元発送）の納品待ちは警告に残り、直し方を案内する
   ・警告の理由ごとの件数を出す */
const { harness } = require('./lib');
const T = harness('販売連携タブ：入庫中と納品待ち');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.click('#tabE');
await p.evaluate(()=>{
  const real=window.fetch;
  const item=(o)=>Object.assign({cond:'used',scope:'ebay',ebay_currency:'USD',
    ebay_seen_at:'2026-10-09T00:00:00Z',fba_available:0,fba_inbound:0,fba_reserved:0,
    fba_res_cust:null,fba_res_trans:null,fba_res_proc:null,
    fba_seen_at:'2026-10-09T00:00:00Z',mode:'hold',one_off:0,one_off_known:1,fba_link:1,
    on_hand:0,dropship:0,restocking:0,restock:0,fc_processing:0,ship_restock:0,
    state:'ok',warnings:[],notes:[],ebay_sold:0,prefix:'game',
    amazon_lowest:4140,amazon_lowest_n:1,amazon_offers:6,
    amazon_offers_json:JSON.stringify([{p:4140,c:'good'}]),
    amazon_lowest_at:'2026-10-09T00:00:00Z',ebay_start:'2026-09-01T00:00:00Z'},o);
  window.fetch=function(url,opt){
    if(/\/status/.test(String(url)))return Promise.resolve({ok:true,json:()=>Promise.resolve({
      counts:{ebay:5,ebay_in_stock:5,listed:5,listed_no_fba:0,fba_not_listed:0,past_zero:0,
              on_hand:0,restock:1,restocking:0,dropship:0,ebay_unparsed:0},
      errors_recent:false,last_runs:[],sold_recent:[],
      items:[
        // 0 入庫1・再調達ポリシー（W2000）→ 情報だけ
        item({asin:'B0009NUP58',title:'入庫中・W2000',ebay_sku:'E-B0009NUP58-U',
              ebay_item_id:'110111',ebay_qty:1,ebay_price:70,fba_inbound:1,
              mode:'restock',ship_restock:1,
              notes:['納品待ちで出品中（再調達ポリシー）']}),
        // 1 入庫2・手元発送のポリシー（W1000）→ 警告
        item({asin:'B003M2WQXW',title:'入庫中・W1000',ebay_sku:'E-B003M2WQXW-U',
              ebay_item_id:'110222',ebay_qty:1,ebay_price:70,fba_inbound:2,
              warnings:['納品待ちで出品中']}),
        // 2 本当に売り切れ → 再調達の候補
        item({asin:'B0SOLDOUT01',title:'売り切れ',ebay_sku:'E-B0SOLDOUT01-U',
              ebay_item_id:'110333',ebay_qty:1,ebay_price:70,mode:'restock',
              ship_restock:1,restock:1,warnings:['売り越しの恐れ']}),
        // 3 注文が入っている
        item({asin:'B0RESERVED1',title:'注文あり',ebay_sku:'E-B0RESERVED1-U',
              ebay_item_id:'110444',ebay_qty:1,ebay_price:70,fba_reserved:1,
              fba_res_cust:1,fba_res_trans:0,fba_res_proc:0,restock:1,
              warnings:['予約済みのみ（Amazonで注文済み）']}),
        // 4 数量の食い違い
        item({asin:'B0MISMATCH1',title:'食い違い',ebay_sku:'E-B0MISMATCH1-U',
              ebay_item_id:'110555',ebay_qty:3,ebay_price:70,fba_available:1,
              warnings:['数量の食い違い']})]})});
    return real(url,opt);
  };
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
});
await p.click('#syncLoad');
await p.waitForFunction(()=>!$('syncLoad').disabled&&$('syncNote').textContent.length>0,
  null,{timeout:8000});

console.log('=== 再調達の候補 ===');
const opts=await p.$$eval('#syncFilter option',os=>os.map(o=>o.value+':'+o.textContent));
console.log('   '+JSON.stringify(opts.filter(o=>/restock:|warn:/.test(o))));
ok(opts.some(o=>/^restock:再調達の候補（2）/.test(o)),
   '★候補は2件（入庫中の2件は入らない）');
await p.selectOption('#syncFilter','restock'); await p.waitForTimeout(200);
const rs=await p.$$eval('#syncList > div',ds=>ds.map(d=>d.innerText.split('\n')[0]));
console.log('   '+JSON.stringify(rs));
ok(rs.length===2&&!rs.some(t=>/入庫中/.test(t)),'★入庫中の行は候補に出ない');
const flags=await p.evaluate(()=>((syncData&&syncData.items)||[]).map(r=>
  r.asin+':'+(syncIsRestock(r)?1:0)));
console.log('   '+JSON.stringify(flags));
ok(flags.join().indexOf('B0009NUP58:0')>=0&&flags.join().indexOf('B003M2WQXW:0')>=0,
   '★画面側の判定でも入庫中は候補にしない');

console.log('\n=== 納品待ちの見せ方 ===');
await p.selectOption('#syncFilter','all'); await p.waitForTimeout(200);
const rows=await p.$$eval('#syncList > div',ds=>ds.map(d=>d.innerText.replace(/\n/g,' | ')));
rows.forEach((r,i)=>console.log('   '+i+': '+r.split(' | ').slice(0,2).join(' ')));
ok(/納品待ちで出品中（再調達ポリシー）/.test(rows[0]),'★W2000 の行は情報として出す');
ok(!/配送ポリシーを W2000/.test(rows[0]),'W2000 の行には直し方を出さない');
ok(/納品待ちで出品中/.test(rows[1])&&/配送ポリシーを W2000（再調達用）に変えるか、受領まで eBay の数量を0に/.test(rows[1]),
   '★W1000 の行は警告のまま・直し方を案内する');
const cols=await p.$$eval('#syncList > div',ds=>ds.map(d=>
  Array.from(d.querySelectorAll('span')).filter(s=>/納品待ち/.test(s.textContent))
    .map(s=>getComputedStyle(s).backgroundColor).join()));
console.log('   '+JSON.stringify(cols.slice(0,2)));
ok(/rgb\(138, 138, 138\)/.test(cols[0]),'★情報の印は灰色');
ok(cols[1]&&!/rgb\(138, 138, 138\)/.test(cols[1]),'警告の印は灰色ではない');

console.log('\n=== 「対応が必要」から外れる ===');
const opts2=await p.$$eval('#syncFilter option',os=>os.map(o=>o.value+':'+o.textContent));
console.log('   '+JSON.stringify(opts2.filter(o=>/warn:/.test(o))));
ok(opts2.some(o=>/^warn:対応が必要（警告あり）（4）/.test(o)),
   '★W2000 の納品待ちは数えない（5件中4件）');
await p.selectOption('#syncFilter','warn'); await p.waitForTimeout(200);
const ws=await p.$$eval('#syncList > div',ds=>ds.map(d=>d.innerText.split('\n')[0]));
console.log('   '+JSON.stringify(ws));
ok(ws.length===4&&!ws.some(t=>/入庫中・W2000/.test(t)),
   '★絞り込みでも W2000 の行は出ない');

console.log('\n=== 理由ごとの件数 ===');
await p.selectOption('#syncFilter','all'); await p.waitForTimeout(200);
const brk=await p.evaluate(()=>$('syncWarnBreak').innerText);
console.log('   '+brk.replace(/\n/g,' ／ '));
ok(/対応が必要 4件/.test(brk),'★対応が必要の合計を出す');
['納品待ちで出品中 1件','売り越しの恐れ 1件','予約済みのみ（Amazonで注文済み） 1件',
 '数量の食い違い 1件'].forEach(t=>
  ok(brk.indexOf(t)>=0,'★理由ごとの件数：'+t));
ok(/情報 1件/.test(brk)&&/納品待ちで出品中（再調達ポリシー） 1件/.test(brk),
   '★情報も分けて数える');
console.log('\n=== 選んだ行を最低売値まで下げるCSV ===');
const fs=require('fs');
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
const dl=[]; p.on('download',async d=>dl.push({name:d.suggestedFilename(),
  text:fs.readFileSync(await d.path(),'utf8')}));
const prep=await p.evaluate(()=>{
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
  // 出品リストに同じ商品があれば、その仕入値から最低売値を出す
  csvList=[{id:'s1',src:'sedori',sku:'game-20260101-UG-B0SOLDOUT01-1200',
    asin:'B0SOLDOUT01',cond:'used',titleJa:'売り切れ',cat:'139973',catFixed:true,
    condId:5000,cost:3000,weight:200,qty:1,pics:[],descHtml:'',specs:{},
    zeroAct:'hold',itemId:'110333'}];
  csvSaveList();
  syncData.items.forEach(r=>{ r.ebay_price=90; });
  // 一点物の行を1つ作る
  syncData.items[4].one_off=1;
  syncPick={}; syncPick['B0SOLDOUT01|used']=true;   // 下げられる行
  syncPick['B0MISMATCH1|used']=true;                // 一点物
  syncRender();
  const r=syncData.items.find(x=>x.asin==='B0SOLDOUT01');
  return { floor:syncFloorOf(r), now:+r.ebay_price };
});
console.log('   '+JSON.stringify(prep));
ok(prep.floor.v>0&&prep.floor.from==='list',
   '★出品リストに仕入値があれば、そこから最低売値を出す');
dlg.length=0; dl.length=0;
await p.click('#syncFloorCsv'); await p.waitForTimeout(500);
console.log('   確認: '+JSON.stringify(dlg[0]));
const L=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   '+JSON.stringify(L));
ok(/選んだ 2件のうち 1件を最低売値まで下げます/.test(dlg[0]||''),
   '★件数と「今の売値 → 最低売値」を出す');
ok(/一点物/.test(dlg[0]||''),'★一点物は外して理由を出す');
ok(L.length===3&&L[2]==='Revise,110333,'+prep.floor.v.toFixed(2),
   '★最低売値で書き出す');
ok(/書き出しました/.test(await p.textContent('#syncFloorNote')),'結果を出す');

await T.done();
})();
