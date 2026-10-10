/* 出品CSVタブ：更新CSVは一覧で選んだ行だけを書き出す（6.23・6.24）
   ・チェックがあればその行だけ
   ・ItemIDが無い行は除外して理由を出す
   ・「売値の見直しが要る行だけ」と組み合わせると、選んだ中の対象行だけ */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('出品CSVタブ：更新CSVの選択行');
const ok = T.ok;
(async()=>{
const p=await T.open();
const fs=require('fs');
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
const dl=[]; p.on('download',async d=>dl.push({name:d.suggestedFilename(),
  text:fs.readFileSync(await d.path(),'utf8')}));
await p.click('#tabD');

const setup=async()=>{ await setupRaw(); await openCsvBoxes(p); };
const setupRaw=async()=>await p.evaluate(()=>{
  $('csvSort').value='add';
  $('csvShipProfile').value='W1000'; $('csvRetProfile').value='R';
  $('csvPayProfile').value='P'; $('csvLocation').value='Tokyo'; $('fx').value='160';
  $('baseProfit').value='1000'; $('linkRate').value='30'; $('saleRate').value='15';
  $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('csvReviewAbs').value='1'; $('csvReviewPct').value='3';
  $('csvRevisePrice').checked=false; $('csvPriceChangedOnly').checked=false;
  const row=(id,asin,itemId,extra)=>Object.assign({id:id,src:'sedori',
    sku:'game-20260101-UG-'+asin+'-1200',asin:asin,jan:'49'+id,titleJa:'商品'+id,
    titleEn:'Used Nintendo Switch Item '+id+' Japan Import',cat:'139973',catFixed:true,
    condId:5000,condSrc:'良い',cost:1200,qty:2,weight:150,pics:[{url:'u'}],
    descHtml:'<p>d</p>',specs:{origin:'Japan',platform:'Nintendo Switch',gameName:id},
    zeroAct:'hold',fba:true,oneOff:false,itemId:itemId,sold:'',
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false},extra||{});
  csvList=[
    row('r1','B07571RH4P','110001'),
    row('r2','B09TPBVJ5F','110002'),
    row('r3','B0CWGXZWNV','110003'),
    // カートリッジのみで ItemID が入っていない行
    row('r4','B0DHVQGLVT','',{cartOnly:true,condId:6000}),
    row('r5','B0DX747PD2','',{cartOnly:true,condId:6000,dropship:true})
  ];
  csvPick={}; syncData=null;
  csvList.forEach(csvRecalc);
  csvList.forEach(r=>{ r.priceSent=r.price; r.fxSent=160; });
  csvSaveList(); csvRender(); $('csvListBox').open=true;
});
const lines=(i)=>(((dl[i]||{}).text)||'').trim().split(/\r\n/).filter(Boolean);
/* 価格更新CSVは販売連携タブの出品データ（ItemID）で書き出す（6.31）。
   eBayに出ている売値＝いまの推奨売値（差0）から始める。 */
const withSync=async()=>await p.evaluate(()=>{
  syncPick={};
  syncData={at:new Date().toISOString(),counts:{},
    items:csvList.filter(r=>r.itemId).map(r=>({
      asin:r.asin,cond:'used',scope:'ebay',ebay_sku:'E-'+r.asin+'-U',
      ebay_item_id:r.itemId,ebay_qty:2,ebay_price:+r.price||0,
      one_off:0,dropship:0,restocking:0,mark_at:null,mark_stop:0,ebay_sold_at:null,
      warnings:[],notes:[],state:'ok'}))};
  syncRender();
});

console.log('=== チェックなし：ItemIDのある3件 ===');
await setup();
dlg.length=0; dl.length=0;
await p.click('#csvRevise'); await p.waitForTimeout(500);
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/^数量更新CSVを書き出します。/.test(dlg[0]||''),'確認ダイアログが出る');
ok(/全件 3件（ItemIDのある行）/.test(dlg[0]||''),'★「全件 n件」と件数で出す');
ok(/ItemIDが無い 2件は除外します/.test(dlg[0]||''),'★ItemIDが無い行の件数を出す');
ok(/商品r4（E-B0DHVQGLVT-C）/.test(dlg[0]||'')&&/商品r5（M-B0DX747PD2-C）/.test(dlg[0]||''),
   '★どの行かを CustomLabel つきで出す');
let L=lines(0);
console.log('   '+JSON.stringify(L));
ok(L.length===5&&L.slice(2).map(x=>x.split(',')[1]).join()==='110001,110002,110003',
   '★ItemIDのある3件を書き出す');
ok(/全件が対象です/.test(await p.textContent('#csvExportNote')),'結果にも全件と出す');

console.log('\n=== チェックあり：その行だけ ===');
await setup();
dlg.length=0; dl.length=0;
await p.click('#csvList input[data-cpick="r2"]');
await p.click('#csvList input[data-cpick="r3"]');
await p.waitForTimeout(200);
await p.click('#csvRevise'); await p.waitForTimeout(500);
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/選択した 2件のうち 2件/.test(dlg[0]||''),'★「選択した n件」と出す');
L=lines(0);
console.log('   '+JSON.stringify(L));
ok(L.length===4&&L.slice(2).map(x=>x.split(',')[1]).join()==='110002,110003',
   '★選んだ2件だけを書き出す（全件3件ではない）');
ok(/一覧で選んだ 2件/.test(await p.textContent('#csvExportNote')),'結果にも選んだ件数');

console.log('\n=== 選んだ行に ItemID が無いものが混じるとき ===');
await setup();
dlg.length=0; dl.length=0;
await p.click('#csvList input[data-cpick="r1"]');
await p.click('#csvList input[data-cpick="r4"]');
await p.click('#csvList input[data-cpick="r5"]');
await p.waitForTimeout(200);
await p.click('#csvRevise'); await p.waitForTimeout(500);
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/選択した 3件のうち 1件/.test(dlg[0]||''),'★選んだ3件のうち書き出すのは1件と出す');
ok(/結果ファイルを取り込むか、行のItemID欄に入れてください/.test(dlg[0]||''),
   '★どうすればよいかを出す');
L=lines(0);
console.log('   '+JSON.stringify(L));
ok(L.length===3&&/,110001,/.test(L[2]),'★ItemIDのある1件だけを書き出す');
ok(/ItemIDのない 2件は対象外です/.test(await p.textContent('#csvExportNote')),
   '結果にも除外の件数を出す');

console.log('\n=== 選んだ行すべてに ItemID が無いとき ===');
await setup();
dlg.length=0; dl.length=0;
await p.click('#csvList input[data-cpick="r4"]');
await p.click('#csvList input[data-cpick="r5"]');
await p.waitForTimeout(200);
await p.click('#csvRevise'); await p.waitForTimeout(400);
console.log('   '+JSON.stringify(dlg[0]));
ok(/選んだ2件には ItemID が入っていません/.test(dlg[0]||''),'★そう知らせる');
ok(dl.length===0,'★CSVは書き出さない');

console.log('\n=== 価格更新CSVも同じ（列は売値だけ。選択は販売連携タブへ引き継ぐ）===');
await setup(); await withSync();
dlg.length=0; dl.length=0;
await p.click('#csvList input[data-cpick="r2"]'); await p.waitForTimeout(200);
await p.click('#csvPriceCsv'); await p.waitForTimeout(500);
L=lines(0);
console.log('   '+JSON.stringify(L));
ok(L.length===3&&/,110002,/.test(L[2]),'★選んだ1件だけ');
ok(/\*StartPrice/.test(L[1])&&!/\*Quantity/.test(L[1]),'★数量の列は入れない');
ok(await p.evaluate(()=>Object.keys(syncPick).filter(k=>syncPick[k]).length===1),
   '★出品CSVタブの選択を販売連携タブへ引き継ぐ');

console.log('\n=== 「売値の見直しが要る行だけ」との組み合わせ ===');
await p.click('#tabD');
await setup(); await withSync();
await p.evaluate(()=>{
  /* r1 だけ eBayに出している売値を推奨売値から離す。
     r2・r3 は推奨売値と同じなので対象にならない。 */
  syncData.items[0].ebay_price=Math.round((csvRowById('r1').price-10)*100)/100;
  $('csvPriceChangedOnly').checked=true;
  csvRender(); syncRender();
});
dlg.length=0; dl.length=0;
await p.click('#csvPriceCsv'); await p.waitForTimeout(500);   // チェックなし
console.log('   チェックなし: '+JSON.stringify(dlg[0]));
L=lines(0);
console.log('   '+JSON.stringify(L));
ok(L.length===3&&/,110001,/.test(L[2]),'★見直しの要る行（r1）だけが出る');
ok(/1件（売値の見直しが要る行）/.test(dlg[0]||'')
   &&/上げる 1件／下げる 0件/.test(dlg[0]||''),
   '★確認に上げる行・下げる行の数を出す');

// 対象ではない r2 だけを選んだとき
await p.click('#tabD');
dlg.length=0; dl.length=0;
await p.click('#csvList input[data-cpick="r2"]'); await p.waitForTimeout(200);
await p.click('#csvPriceCsv'); await p.waitForTimeout(400);
console.log('   r2だけ選ぶ: '+JSON.stringify(dlg[0]));
ok(/選んだ 1件には、売値の見直しが要る出品がありません/.test(dlg[0]||''),
   '★選んだ中に対象が無ければ書き出さずに知らせる');
ok(dl.length===0,'★対象外の行は選んでも書き出さない');

// 選んだ中の対象行だけを書き出す（r1 と r2 を選ぶ → r1 だけ）
await p.click('#tabD');
dlg.length=0; dl.length=0;
await p.click('#csvList input[data-cpick="r1"]'); await p.waitForTimeout(200);
await p.click('#csvPriceCsv'); await p.waitForTimeout(500);
console.log('   r1とr2を選ぶ: '+JSON.stringify(dlg[0]));
L=lines(0);
console.log('   '+JSON.stringify(L));
ok(/選んだ 2件のうち 1件（売値の見直しが要る行）/.test(dlg[0]||''),
   '★「選んだ n件のうち n件」と対象に絞った件数で出す');
ok(L.length===3&&/,110001,/.test(L[2]),'★選んだ中の見直しが要る行だけを書き出す');

console.log('\n=== キャンセルしたら書き出さない ===');
await p.click('#tabD');
await setup();
p.removeAllListeners('dialog');
const dlg2=[]; p.on('dialog',async d=>{ dlg2.push(d.message()); await d.dismiss(); });
dl.length=0;
await p.click('#csvList input[data-cpick="r1"]'); await p.waitForTimeout(200);
await p.click('#csvRevise'); await p.waitForTimeout(500);
ok(dlg2.length===1&&dl.length===0,'★キャンセルで書き出さない');
await T.done();
})();
