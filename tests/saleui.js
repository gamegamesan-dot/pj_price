/* 販売連携：eBayのセール中の出品（6.59）
   ・「セール中 ○%引き」のバッジと、セール前の値段・終わる時刻を出す
   ・利益と赤字の判定は **セール後の値段** で計算する（売値の枠に「セール後」）
   ・値上げ・自動値下げの対象から外す
   ・セール前の値段が取れない出品は、その旨を出す
   ・「まとめて実行」の結果に「セール中で外した n件」を出す
   ・D1 に列が無いときは migrate-0019 を案内する */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('販売連携：eBayのセール中の出品');
const ok = T.ok;
(async()=>{
const p=await T.open();
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

const setup=async()=>await p.evaluate(()=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('autoRvMode').value='confirm'; $('autoMdMode').value='plan';
  window.__sync=[];
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(o,st)=>Promise.resolve({ok:!st||st<400,status:st||200,
      text:()=>Promise.resolve(JSON.stringify(o)), json:()=>Promise.resolve(o)});
    if(/\/status/.test(url))return res({counts:{},items:[],last_runs:[],sold_recent:[]});
    if(/\/sync/.test(url)){ window.__sync.push(body);
      return res({mode:'approve',changed:1,zeroed:0,failed:0,sale:2,capped:0}); }
    if(/\/listings|\/settings/.test(url))return res({accepted:0});
    return real(u,i);
  };
  const end=new Date(Date.now()+3*86400000).toISOString();
  const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'88'+asin.slice(-4),ebay_qty:1,ebay_price:20,
    title:asin+'の商品',cost_yen:1200,weight_g:150,one_off:0,dropship:0,restocking:0,
    mark_at:new Date(Date.now()-10*86400000).toISOString(),mark_stop:0,ebay_first:0,
    ebay_sold_at:null,ebay_bo:0,ebay_sale:0,ebay_sale_orig:null,ebay_sale_end:null,
    md_step:1,md_start:20,md_floor:12,md_n:10,md_done:1,
    rv_want:25,rv_floor:18,rv_kind:'none',rv_max_cost:3000,rv_fail:0,
    revise_err:null,amazon_lowest:9000,amazon_offers_json:'[{"p":9000,"c":"used"}]',
    sold_usd:null,fba_available:1,fba_inbound:0,fba_reserved:0,
    warnings:[],notes:[],state:'ok'},x||{});
  syncData={at:new Date().toISOString(),counts:{},items:[
    // ① セール中（セール前の値段あり）：$24 → $18（25%引き）
    it('B0SLU00001',{ebay_sale:1,ebay_sale_orig:24,ebay_sale_end:end,ebay_price:18}),
    // ② セール中だがセール前の値段が取れていない
    it('B0SLU00002',{ebay_sale:1,ebay_price:19}),
    // ③ セールではないふつうの行
    it('B0SLU00003',{ebay_price:20}),
    // ④ セール中で、セール後の値段が最低売値を下回る（赤字の判定に使う）
    it('B0SLU00004',{ebay_sale:1,ebay_sale_orig:30,ebay_price:6})]};
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E'); syncRender();
  return end;
});
const card=async(key)=>await p.evaluate((key)=>{
  const d=document.querySelector('#syncList [data-srow="'+key+'|used"]');
  const m=d?d.querySelector('[data-money]'):null;
  return { text:d?d.innerText.replace(/\n/g,' | '):'',
    badge:d?d.querySelector('[data-sbadge]').innerText:'',
    money:m?m.innerText.replace(/\n/g,' | '):'' };
},key);

const end=await setup();
await openCsvBoxes(p);

console.log('=== セール中のバッジと中身 ===');
let c=await card('B0SLU00001');
console.log('   バッジ: '+c.badge);
console.log('   '+c.text.slice(0,260));
ok(/セール中 25%引き/.test(c.badge),'★★「セール中 ○%引き」のバッジを出す');
ok(/\$24\.00 → \$18\.00/.test(c.text),'★★セール前の値段といまの値段を出す');
ok(c.text.indexOf(String(end).slice(0,10))>=0,'★★いつまでかを出す');
ok(/値上げと自動値下げはお休みします/.test(c.text),'★対象から外していることを書く');

console.log('\n=== 利益はセール後の値段で計算 ===');
console.log('   帯: '+c.money);
const calc=await p.evaluate(()=>{
  const r=syncData.items.find(x=>x.asin==='B0SLU00001');
  return { on:syncOnSale(r), off:syncSaleOff(r),
    prof:Math.round(csvProfitAt(1200,150,18,syncFlatOf(r))),
    profOrig:Math.round(csvProfitAt(1200,150,24,syncFlatOf(r))) };
});
console.log('   '+JSON.stringify(calc));
ok(/\$18\.00/.test(c.money)&&/セール後/.test(c.money),
   '★★売値の枠はセール後の値段（「セール後」と書く）');
ok(c.money.indexOf(String(calc.prof).replace(/\B(?=(\d{3})+(?!\d))/g,','))>=0,
   '★★利益もセール後の値段で計算する');
ok(calc.prof!==calc.profOrig,'★（セール前の値段で計算した利益とは違う）');
const red=await card('B0SLU00004');
console.log('   赤字の行: '+red.money);
ok(/赤字|下限未満/.test(red.money),
   '★★セール後の値段で赤字・下限未満を判定する');

console.log('\n=== 値上げ・自動値下げの対象から外す ===');
const skip=await p.evaluate(()=>{
  const s=syncData.items.find(x=>x.asin==='B0SLU00001');
  const n=syncData.items.find(x=>x.asin==='B0SLU00003');
  return { rvSale:syncRvActOf(s), rvNormal:!!syncRvActOf(n),
    mdSale:syncMarkSkip(s), mdNormal:syncMarkSkip(n),
    plan:syncRvPlanRows().rows.map(x=>x.asin) };
});
console.log('   '+JSON.stringify(skip));
ok(skip.rvSale===null&&skip.rvNormal===true,'★★値上げの対象から外す');
ok(/セール中/.test(skip.mdSale)&&!skip.mdNormal,'★★自動値下げの対象からも外す');
ok(skip.plan.indexOf('B0SLU00001')<0&&skip.plan.indexOf('B0SLU00004')<0,
   '★★変更の予定にも入れない');

console.log('\n=== セール前の値段が取れないとき ===');
c=await card('B0SLU00002');
console.log('   '+c.badge+'／'+c.text.slice(0,160));
ok(/セール中/.test(c.badge)&&!/%引き/.test(c.badge),
   '★値引き率が出せないときはバッジに付けない');
ok(/セール前の値段は取れていません/.test(c.text),'★★取れていないことを画面に出す');

console.log('\n=== ふつうの行は今までどおり ===');
c=await card('B0SLU00003');
ok(!/セール中/.test(c.badge)&&!/セール後/.test(c.money),
   '★セールでない行には何も出さない');

console.log('\n=== 「まとめて実行」の結果 ===');
await p.evaluate(()=>{
  syncData.rv_plan={at:new Date().toISOString(),mode:'confirm',n:1,capped:0,rows:[
    {asin:'B0SLU00003',name:'ふつうの行',kind:'up',from:20,to:25,want:25,
     capped:false,loss:false}]};
  syncRender();
});
await p.click('#syncRvGo');
await p.waitForTimeout(500);
const done=await p.evaluate(()=>$('syncRvDone').textContent);
console.log('   '+done);
ok(/セール中で外した 2件/.test(done),
   '★★セール中で変えられなかった行は「失敗」と別に数えて出す');
ok(!/失敗 2件/.test(done),'★失敗には足さない');

console.log('\n=== D1 に列が無いとき ===');
const hint=await p.evaluate(()=>syncMigrateHint('D1_ERROR: no such column: ebay_sale_orig'));
console.log('   '+hint);
ok(/migrate-0019-ebay-sale\.sql/.test(hint),'★★migrate-0019 を案内する');

T.done();
})();
