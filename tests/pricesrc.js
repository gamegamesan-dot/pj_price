/* 価格の操作を販売連携（pj-sync の出品データ）で行う（6.31・7.27）
   ・出品CSVの書き出し・名簿送信で、実重量・仕入値・相場・一点物を D1 に送る
   ・出品リストを空にしても、見直し・最低売値・3日ごとの値下げが同じ結果になる
   ・実重量は D1 に残した値を使う（無い行だけ既定重量）
   ・取り込みが上限で切れたら警告を出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('価格の操作を販売連携でそろえる');
const ok = T.ok;
(async()=>{
const p=await T.open();
const fs=require('fs');
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
const dl=[]; p.on('download',async d=>dl.push({name:d.suggestedFilename(),
  text:fs.readFileSync(await d.path(),'utf8')}));
await p.click('#tabD');

const DAY=86400000;
/* 下ごしらえ。出品リストに3行（ItemIDつき）と、同じ出品の pj-sync 側のデータ。
   eBayに出ている売値は推奨売値より安く、最低売値よりは上にしておく。 */
const setup=async()=>{
  await p.evaluate((DAY)=>{
    $('csvSort').value='add';
    $('csvShipProfile').value='W1000'; $('csvShipProfileRe').value='W2000';
    $('csvRetProfile').value='R'; $('csvPayProfile').value='P';
    $('csvLocation').value='Tokyo'; $('fx').value='160'; $('zone').value='2';
    $('baseProfit').value='1000'; $('linkRate').value='30'; $('saleRate').value='15';
    $('usTaxRate').value='8'; $('targetMode').value='auto';
    $('csvReviewAbs').value='1'; $('csvReviewPct').value='3';
    $('csvReviewZero').checked=false; $('csvPriceChangedOnly').checked=true;
    $('csvMarkDays').value='3'; $('csvMarkStep').value='1';
    $('syncWeightGame').value='150'; $('syncWeight').value='400';
    $('syncApi').value=''; $('syncKey').value='';     // 送信はしない（書き出しだけ見る）
    const row=(id,asin,itemId,extra)=>Object.assign({id:id,src:'sedori',
      sku:'game-20260101-UG-'+asin+'-1200',asin:asin,jan:'49'+id,titleJa:'商品'+id,
      titleEn:'Used Nintendo Switch Item '+id+' Japan Import',cat:'139973',catFixed:true,
      condId:5000,condSrc:'良い',cost:3000,qty:1,weight:520,pics:[{url:'u'}],
      descHtml:'<p>d</p>',specs:{origin:'Japan',platform:'Nintendo Switch',gameName:id},
      zeroAct:'hold',fba:true,oneOff:false,itemId:itemId,sold:'',
      titleStatus:'',titleCands:[],titleNote:'',titleManual:false},extra||{});
    csvList=[row('s1','B0SRC000001','110001'),
             row('s2','B0SRC000002','110002',{weight:150,cost:1200}),
             row('s3','B0SRC000003','110003',{oneOff:true})];
    csvPick={}; syncPick={}; csvTrash=[]; csvTrashSave();
    csvList.forEach(csvRecalc);
    syncData={at:new Date().toISOString(),counts:{},
      items:csvList.map(r=>({asin:r.asin,cond:'used',scope:'ebay',prefix:'game',
        ebay_sku:'E-'+r.asin+'-U',ebay_item_id:r.itemId,ebay_qty:1,
        /* 推奨売値より安いが、最低売値よりは上（見直しと値下げの両方の対象になる） */
        ebay_price:(function(){ const q=csvPriceFor(+r.cost||0,+r.weight||0);
          return Math.round(Math.max(q.floor+2.5,q.price-5)*100)/100; })(),
        one_off:r.oneOff?1:0,dropship:0,restocking:0,mark_at:null,mark_stop:0,
        ebay_sold_at:null,amazon_lowest:null,amazon_offers_json:'[]',
        warnings:[],notes:[],state:'ok'}))};
    csvSaveList(); csvRender(); syncRender(); $('csvListBox').open=true;
  },DAY);
  await openCsvBoxes(p);
};

console.log('=== 書き出し・名簿で D1 に送る中身 ===');
await setup();
const src=await p.evaluate(()=>{
  const r=csvRowById('s1');
  r.sold='88.5';
  return { s1:csvPriceSrcOf(r), s3:csvPriceSrcOf(csvRowById('s3')) };
});
console.log('   '+JSON.stringify(src.s1));
ok(src.s1.weight_g===520,'★実重量（梱包込）を送る');
ok(src.s1.cost_yen===3000,'★仕入値（手直し後）を送る');
ok(src.s1.sold_usd===88.5,'★相場（総額$）を送る');
ok(src.s1.asin==='B0SRC000001'&&src.s1.cond==='used'&&src.s1.item_id==='110001',
   '★突き合わせのキー（ASIN＋区分）と ItemID も送る');
ok(src.s3.one_off===true&&src.s1.one_off===false,'★一点物の印を送る');
ok(src.s1.mark_at===undefined&&src.s1.mark_stop===undefined,
   '値下げの記録が無い行は送らない（D1 側の記録を消さない）');

console.log('\n=== 出品リストを空にしても同じ結果になる ===');
await setup();
const withList=await p.evaluate(()=>{
  return { rev:syncRevRows().map(x=>x.id+':'+x.next),
           floor:syncData.items.map(r=>r.ebay_item_id+':'+syncFloorOf(r).v
             +':'+syncFloorOf(r).from),
           due:syncMarkRows().map(r=>r.ebay_item_id),
           next:syncData.items.map(r=>r.ebay_item_id+':'+syncMarkNext(r)),
           w:syncData.items.map(r=>syncWeightNote(r)) };
});
console.log('   リストあり 見直し: '+JSON.stringify(withList.rev));
console.log('   リストあり 最低売値: '+JSON.stringify(withList.floor));
console.log('   リストあり 重量: '+JSON.stringify(withList.w));
// D1 に残った値（実重量・仕入値）を出品データに移して、出品リストを空にする
const noList=await p.evaluate(()=>{
  const by={}; csvList.forEach(r=>{ by[r.itemId]=csvPriceSrcOf(r); });
  syncData.items.forEach(r=>{
    const o=by[r.ebay_item_id]||{};
    r.weight_g=o.weight_g; r.cost_yen=o.cost_yen;
    if(o.sold_usd)r.sold_usd=o.sold_usd;
    r.one_off=o.one_off?1:0;
  });
  csvList=[]; csvPick={}; csvSaveList(); csvRender(); syncRender();
  return { n:csvList.length,
           rev:syncRevRows().map(x=>x.id+':'+x.next),
           floor:syncData.items.map(r=>r.ebay_item_id+':'+syncFloorOf(r).v
             +':'+syncFloorOf(r).from),
           due:syncMarkRows().map(r=>r.ebay_item_id),
           next:syncData.items.map(r=>r.ebay_item_id+':'+syncMarkNext(r)),
           w:syncData.items.map(r=>syncWeightNote(r)) };
});
console.log('   リスト空　 見直し: '+JSON.stringify(noList.rev));
console.log('   リスト空　 最低売値: '+JSON.stringify(noList.floor));
console.log('   リスト空　 重量: '+JSON.stringify(noList.w));
ok(noList.n===0,'出品リストは空になっている');
ok(noList.rev.join('|')===withList.rev.join('|'),'★売値の見直しの結果が同じ');
ok(noList.due.join('|')===withList.due.join('|'),'★3日ごとの値下げの対象が同じ');
ok(noList.next.join('|')===withList.next.join('|'),'★次に出す売値も同じ');
ok(noList.floor.map(x=>x.split(':').slice(0,2).join(':')).join('|')
   ===withList.floor.map(x=>x.split(':').slice(0,2).join(':')).join('|'),
   '★最低売値も同じ');
ok(withList.floor.every(x=>/:list$/.test(x))&&noList.floor.every(x=>/:d1$/.test(x)),
   '★出どころは「出品リスト」から「保存済み（D1）」に変わる');

console.log('\n=== 実重量は D1 から使う（無い行だけ既定重量）===');
console.log('   '+JSON.stringify(noList.w));
ok(noList.w[0]==='520g（実測）'&&noList.w[1]==='150g（実測）',
   '★D1 に残した実重量を「実測」として使う');
const def=await p.evaluate(()=>{
  const r=syncData.items[0];
  delete r.weight_g; delete r.cost_yen;
  r.amazon_lowest=2500; r.amazon_offers_json=JSON.stringify([{p:2500,c:'good'}]);
  syncRender();
  return { w:syncWeightNote(r), from:syncFloorOf(r).from, v:syncFloorOf(r).v };
});
console.log('   '+JSON.stringify(def));
ok(def.w==='150g（既定）','★D1 に無い行は既定重量（ゲーム 150g）を「既定」と出す');
ok(def.from==='amazon'&&def.v>0,
   '★仕入値が無い行は Amazon最安値を仕入値とみなして最低売値を出す');

console.log('\n=== 書き出しも出品リストなしで動く ===');
await setup();
await p.evaluate(()=>{
  const by={}; csvList.forEach(r=>{ by[r.itemId]=csvPriceSrcOf(r); });
  syncData.items.forEach(r=>{
    const o=by[r.ebay_item_id]||{};
    r.weight_g=o.weight_g; r.cost_yen=o.cost_yen; r.one_off=o.one_off?1:0;
  });
  csvList=[]; csvSaveList(); csvRender(); syncRender();
});
// 売値の見直し（価格更新CSV）
dlg.length=0; dl.length=0;
await p.click('#tabE');
await p.click('#syncPriceCsv'); await p.waitForTimeout(500);
let L=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   見直し: '+JSON.stringify(L));
ok(L.length===5&&L.slice(2).every(x=>/^Revise,11000\d,\d/.test(x)),
   '★出品リストが空でも価格更新CSVが出る（3件）');
ok(/保存済み/.test(dlg[0]||'')||/D1に残した仕入値/.test(dlg[0]||''),
   '★確認に「D1に残した仕入値で計算している」と出す');
// 3日ごとの値下げ
dlg.length=0; dl.length=0;
const mk=await p.evaluate(()=>({ n:syncMarkRows().length,
  bar:getComputedStyle($('syncMarkBar')).display,
  btn:$('syncMarkRun').textContent }));
console.log('   値下げの帯: '+JSON.stringify(mk));
ok(mk.n===2&&mk.bar!=='none'&&/値下げの時期です（2件）/.test(mk.btn),
   '★値下げの時期は2件（一点物の s3 は外す）');
await p.click('#syncMarkRun'); await p.waitForTimeout(500);
L=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   値下げ: '+JSON.stringify(L));
ok(L.length===4,'★出品リストが空でも値下げCSVが出る（2件）');
const at=await p.evaluate(()=>({ at:syncData.items[0].mark_at||'',
  note:$('syncMarkNote').textContent,
  bar:getComputedStyle($('syncMarkBar')).display }));
console.log('   '+JSON.stringify(at));
ok(!!at.at&&at.bar==='none','★書き出した日を記録して帯が消える');
ok(/この端末にだけ残しました/.test(at.note),
   '★pj-sync のURL・キーが空のときは、そう知らせる');
// 選んだ行を最低売値まで下げる
dlg.length=0; dl.length=0;
await p.evaluate(()=>{
  syncPick={}; syncData.items.forEach(r=>{ syncPick[r.asin+'|'+r.cond]=true; });
  syncRender();
});
await p.click('#syncFloorCsv'); await p.waitForTimeout(500);
L=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   最低売値: '+JSON.stringify(L));
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(L.length===4&&/一点物/.test(dlg[0]||''),
   '★出品リストが空でも最低売値CSVが出る（一点物は外す）');

console.log('\n=== D1 に仕入値が無いときは せどりすとSKU の仕入値を使う ===');
await setup();
const skuc=await p.evaluate(()=>{
  /* 出品リストを空にし、D1 の仕入値も無い状態。
     Worker が返す sku_cost（せどりすとSKU の末尾の数字）だけがある。 */
  syncData.items.forEach((r,i)=>{ r.weight_g=(i===1)?150:520; delete r.cost_yen;
    r.amazon_lowest=2500; r.amazon_offers_json=JSON.stringify([{p:2500,c:'good'}]); });
  syncData.items[0].sku_cost=4030;
  syncData.items[1].sku_cost=1200;
  csvList=[]; csvSaveList(); csvRender(); syncRender();
  // 新しい仕入値での最低売値より少し上に売値を置く（値下げの対象にする）
  syncData.items.forEach(r=>{ r.ebay_price=Math.round((syncFloorOf(r).v+3)*100)/100; });
  csvRender(); syncRender();
  const r0=syncData.items[0], r2=syncData.items[2];
  return { c0:syncCostOf(r0), c2:syncCostOf(r2),
    from0:syncFloorOf(r0).from, name:syncFromName('sku'),
    rec:syncRecCost(r0)&&syncRecCost(r0).cost,
    // SKU も無い行は Amazon 最安値で代用する
    from2:syncFloorOf(r2).from,
    row:(Array.from(document.querySelectorAll('#syncList > div'))
      .map(d=>d.textContent).find(x=>x.indexOf('B0SRC000001')>=0)||'') };
});
console.log('   '+JSON.stringify({c0:skuc.c0,c2:skuc.c2,from0:skuc.from0,from2:skuc.from2}));
ok(skuc.c0.v===4030&&skuc.c0.from==='sku',
   '★SKU の末尾の仕入値（4,030円）を使う');
ok(skuc.rec===4030,'★推奨売値・最低売値もその仕入値で出す');
ok(skuc.from0==='sku'&&skuc.from2==='amazon',
   '★SKU からも取れない行だけ Amazon 最安値で代用する');
ok(/仕入値 ¥4,030（せどりすとSKU）/.test(skuc.row)
   ||/仕入値 ￥4,030（せどりすとSKU）/.test(skuc.row)
   ||/4,030.*せどりすとSKU/.test(skuc.row),'★一覧に出どころを出す');
// 確認の文に、仕入値の出どころごとの件数を分けて出す
const brk=await p.evaluate(()=>{
  const n=syncCostBreak(syncData.items);
  return { n:n, t:syncCostBreakText(n) };
});
console.log('   内訳: '+JSON.stringify(brk.n)+' / '+JSON.stringify(brk.t));
ok(brk.n.sku===2&&brk.n.amazon===1&&brk.n.d1===0,
   '★SKUから読めた行と、Amazonで代用する行を分けて数える');
ok(/せどりすとSKUの仕入値 2件／Amazon最安値で代用 1件/.test(brk.t),
   '★「せどりすとSKUの仕入値 n件／Amazon最安値で代用 n件」と出す');
dlg.length=0; dl.length=0;
await p.click('#tabE');
await p.click('#syncMarkRun'); await p.waitForTimeout(500);
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/せどりすとSKUの仕入値 2件/.test(dlg[0]||''),
   '★「せどりすとSKUの仕入値 n件」と出す');
// 一度読めた仕入値は D1（cost_yen）に残す
const saved=await p.evaluate(()=>({
  cost:syncData.items[0].cost_yen,
  from:syncCostOf(syncData.items[0]).from,
  note:$('syncMarkNote').textContent }));
console.log('   '+JSON.stringify(saved));
ok(saved.cost===4030&&saved.from==='d1',
   '★読めた仕入値は D1 に残し、次からは「保存済み」になる');
ok(/せどりすとSKUから読んだ仕入値 2件/.test(saved.note),'★何件残したかを出す');

console.log('\n=== 再調達中・無在庫は必ず Amazon最安値を仕入値とみなす ===');
const rst=await p.evaluate(()=>{
  const r=syncData.items[1];
  r.cost_yen=1200; r.sku_cost=1200;
  r.amazon_lowest=2500; r.amazon_offers_json=JSON.stringify([{p:2500,c:'good'}]);
  syncRender();
  const a=syncCostOf(r).from;
  r.restocking=1; syncRender();
  const b=syncCostOf(r).from, bf=syncFloorOf(r).from;
  r.restocking=0; r.dropship=1; syncRender();
  const c=syncCostOf(r).from;
  r.dropship=0; syncRender();
  return { normal:a, restocking:b, floor:bf, drop:c };
});
console.log('   '+JSON.stringify(rst));
ok(rst.normal==='d1','ふだんは保存済みの仕入値を使う');
ok(rst.restocking===''&&rst.floor==='amazon',
   '★再調達中はもとの仕入値を使わず、いまのAmazon最安値から最低売値を出す');
ok(rst.drop==='','★無在庫も同じ（売れてから仕入れるため）');

console.log('\n=== 「値下げしない」の印は D1 に置く ===');
await setup();
await p.click('#tabE');
const mstop=await p.evaluate(()=>{
  const key=syncData.items[0].asin+'|used';
  const btn=document.querySelector('#syncList button[data-smstop="'+key+'"]');
  return { has:!!btn, txt:btn?btn.textContent:'',
    why:syncMarkSkip(Object.assign({},syncData.items[0],{mark_stop:1})) };
});
console.log('   '+JSON.stringify(mstop));
ok(mstop.has&&/値下げしない オフ/.test(mstop.txt),'★行に「値下げしない」のボタンを出す');
ok(mstop.why==='値下げしない','★印が立っている出品は値下げの対象から外す');

console.log('\n=== 相場（総額$）は D1 に残した値も使う ===');
const sold=await p.evaluate(()=>{
  const r=syncData.items[1];
  r.sold_usd=70;
  syncRowReplace(r.asin+'|'+r.cond);
  const o=syncSoldGet(r);
  return { v:o&&o.v, label:syncSoldAt(o), item:syncSoldItem(r),
    want:syncWantPrice(r) };
});
console.log('   '+JSON.stringify(sold));
ok(sold.v===70,'★端末に入力が無ければ D1 の相場を使う');
ok(sold.label==='保存済み','★日付のかわりに「保存済み」と出す');
ok(sold.item>0&&sold.item<70,'相場（総額）から請求送料を引いた商品代を出す');

console.log('\n=== 取り込みが上限で切れたら警告 ===');
const cut=await p.evaluate(()=>{
  $('syncLimit').value='1000';
  syncData.limit=1000; syncData.rows_total=1734; syncData.truncated=true;
  syncRender();
  return { show:getComputedStyle($('syncCutWarn')).display,
    txt:$('syncCutWarn').textContent, limit:syncLimit() };
});
console.log('   '+cut.txt);
ok(cut.show!=='none'&&/上限 1000件で切れています/.test(cut.txt)
   &&/1734件/.test(cut.txt),'★切れたことと全体の件数を出す');
ok(/取り込みの上限/.test(cut.txt),'★設定で増やせると案内する');
const nocut=await p.evaluate(()=>{
  syncData.truncated=false; syncRender();
  return getComputedStyle($('syncCutWarn')).display;
});
ok(nocut==='none','★切れていなければ出さない');
const lim=await p.evaluate(()=>{
  $('syncLimit').value='9000'; const a=syncLimit();
  $('syncLimit').value=''; const b=syncLimit();
  $('syncLimit').value='3000'; return [a,b,syncLimit()];
});
console.log('   上限: '+JSON.stringify(lim));
ok(lim[0]===5000&&lim[1]===3000&&lim[2]===3000,
   '★上限は Worker の5000件まで。空のときは3000件');
await T.done();
})();
