/* 出品CSVタブ：ボタンを使う頻度で整理した（6.29）
   ・毎日使うものは開いたまま、ときどき使うものは畳む
   ・畳んだ状態でも書き出しの結果は変わらない
   ・見出しとボタンに件数を出す */
const { harness } = require('./lib');
const T = harness('出品CSVタブ：ボタンの整理');
const ok = T.ok;
(async()=>{
const p=await T.open();
const fs=require('fs');
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
const dl=[]; p.on('download',async d=>dl.push({name:d.suggestedFilename(),
  text:fs.readFileSync(await d.path(),'utf8')}));
await p.click('#tabD');

const setup=async()=>await p.evaluate(()=>{
  localStorage.removeItem('pj:ui:v1');
  $('csvSort').value='add';
  $('csvShipProfile').value='W1000'; $('csvShipProfileRe').value='W2000';
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P';
  $('csvLocation').value='Tokyo'; $('fx').value='160';
  $('baseProfit').value='1000'; $('linkRate').value='30';
  $('csvReviewAbs').value='1'; $('csvReviewPct').value='3';
  const row=(id,asin,extra)=>Object.assign({id:id,src:'sedori',
    sku:'game-20260101-UG-'+asin+'-1200',asin:asin,jan:'49'+id,titleJa:'商品'+id,
    titleEn:'Used Nintendo Switch Item '+id+' Japan Import',cat:'139973',catFixed:true,
    condId:5000,condSrc:'良い',cost:1200,qty:2,weight:150,pics:[{url:'u'}],
    descHtml:'<p>d</p>',specs:{origin:'Japan',platform:'Nintendo Switch',gameName:id},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',sold:'',titleStatus:'',
    titleCands:[],titleNote:'',titleManual:false},extra||{});
  csvList=[row('p1','B07571RH4P',{itemId:'110001'}),
           row('p2','B09TPBVJ5F',{itemId:'110002'}),
           row('p3','B0CWGXZWNV')];
  csvPick={}; csvTrash=[]; csvTrashSave(); syncData=null;
  csvList.forEach(csvRecalc);
  // p1 だけ eBayに出している売値を推奨売値から離す（見直しの対象にする）
  csvList.forEach(r=>{ r.priceSent=r.price; r.fxSent=160; });
  csvRowById('p1').priceSent=Math.round((csvRowById('p1').price-10)*100)/100;
  csvSaveList(); csvRender();
});

console.log('=== いつも開いているボタン ===');
await setup();
const vis=async(id)=>await p.isVisible('#'+id);
for(const id of ['csvExport','csvExportPick','csvGenAll','csvTitleRedo',
                 'csvRevive2','csvCartAdd']){
  const v=await vis(id);
  console.log('   '+id+': '+v);
  ok(v,'★'+id+' は畳まずに出す');
}
console.log('\n=== 畳んである欄 ===');
const boxes=await p.evaluate(()=>({
  stock:$('csvStockBox').open, review:$('csvReviewBox').open,
  revise:getComputedStyle($('csvRevise')).display,
  price:getComputedStyle($('csvPriceCsv')).display }));
console.log('   '+JSON.stringify(boxes));
ok(boxes.stock===false&&boxes.review===false,'★在庫・数量／売値の見直しは畳んである');
ok(!(await vis('csvRevise'))&&!(await vis('csvPriceCsv')),
   '★中のボタン（数量更新CSV・価格更新CSV）は畳むと見えない');
const inStock=await p.evaluate(()=>{
  const b=$('csvStockBox');
  return ['csvDropOn','csvDropOff','csvRevise','csvRevisePrice']
    .every(id=>b.contains($(id)));
});
ok(inStock,'★無在庫オン／オフ・数量更新CSV・売値も含める は「在庫・数量」の中');
const inReview=await p.evaluate(()=>{
  const b=$('csvReviewBox');
  return ['csvPriceCsv','csvPriceChangedOnly','csvReviewAbs','csvReviewPct','csvReviewZero']
    .every(id=>b.contains($(id)));
});
ok(inReview,'★価格更新CSV・見直しの設定は「売値の見直し」の中');
// 畳んでいる間は innerText が空になるので textContent で見る
const tip=await p.evaluate(()=>$('csvReviewBox').textContent);
console.log('   '+(tip.match(/使うタイミング[^。]*。/)||[''])[0]);
ok(/使うタイミング：設定を変えたとき・為替が動いたとき・週1回の点検/.test(tip),
   '★使うタイミングを1行で書く');
ok(await p.evaluate(()=>$('csvPriceChangedOnly').checked),
   '★「見直しが要る行だけ」は既定でオン');

console.log('\n=== 見出しの件数 ===');
let sum=await p.evaluate(()=>({t:$('csvReviewSum').textContent,
  w:$('csvReviewSum').style.fontWeight,c:$('csvReviewSum').style.color}));
console.log('   '+JSON.stringify(sum));
ok(/^売値の見直し（1件）/.test(sum.t),'★見出しに件数を出す');
ok(sum.w==='800'&&!!sum.c,'★1件以上なら見出しを目立たせる');
await p.evaluate(()=>{
  // 見直しの対象を無くす
  csvList.forEach(r=>{ r.priceSent=r.price; });
  csvSaveList(); csvRender();
});
sum=await p.evaluate(()=>({t:$('csvReviewSum').textContent,
  w:$('csvReviewSum').style.fontWeight,open:$('csvReviewBox').open}));
console.log('   0件: '+JSON.stringify(sum));
ok(sum.t==='売値の見直し'&&!sum.w,'★0件のときは件数を出さず、目立たせない');
ok(sum.open===false,'★0件のときは畳んだまま');

console.log('\n=== 対象の行があるときだけ目立たせる（復活・+1）===');
const hot=await p.evaluate(()=>{
  // 数量0の出品・カートリッジのみの出品を pj-sync 側に用意する
  syncData={at:new Date().toISOString(),counts:{},items:[
    {asin:'B0CWGXZWNV',cond:'used',scope:'ebay',ebay_sku:'E-B0CWGXZWNV-U',
     ebay_item_id:'110333',ebay_qty:0,ebay_price:40,dropship:0,warnings:[],state:'ok'}]};
  csvRender();
  const b=$('csvRevive2');
  return { label:b.textContent, hot:b.classList.contains('primary'), op:b.style.opacity };
});
console.log('   '+JSON.stringify(hot));
ok(/既存の出品を復活させるCSV（1件）/.test(hot.label),'★件数をボタンに出す');
ok(hot.hot&&!hot.op,'★対象があるときは目立たせる');
const cold=await p.evaluate(()=>{
  syncData=null; csvRender();
  const b=$('csvRevive2'), c=$('csvCartAdd');
  return { label:b.textContent, hot:b.classList.contains('primary'), op:b.style.opacity,
    cart:c.textContent, cartHot:c.classList.contains('primary') };
});
console.log('   '+JSON.stringify(cold));
ok(cold.label==='既存の出品を復活させるCSV'&&!cold.hot&&cold.op==='0.55',
   '★対象が無いときは件数を出さず、控えめにする');
ok(cold.cart==='カートリッジのみ：既存の出品に+1するCSV'&&!cold.cartHot,
   '+1のボタンも同じ');

console.log('\n=== 「リストを空にする」は一番下 ===');
const pos=await p.evaluate(()=>{
  const box=$('csvClear').closest('section');
  const all=Array.from(box.querySelectorAll('button'));
  return { last:all[all.length-1].id, idx:all.indexOf($('csvClear')), n:all.length,
    note:$('csvClear').nextElementSibling.textContent };
});
console.log('   '+JSON.stringify(pos));
ok(pos.last==='csvClear','★ボタンの中でいちばん下にある');
ok(/ゴミ箱/.test(pos.note),'★ゴミ箱に入ると書いてある');

console.log('\n=== 畳んだ状態でも書き出しの結果は変わらない ===');
await setup();
// 開いた状態で価格更新CSVを出す
await p.evaluate(()=>{ $('csvReviewBox').open=true; });
await p.waitForTimeout(100);
dlg.length=0; dl.length=0;
await p.click('#csvPriceCsv'); await p.waitForTimeout(500);
const opened=((dl[0]||{}).text||'').trim();
console.log('   開いた状態: '+JSON.stringify(opened.split(/\r\n/)));
ok(opened.split(/\r\n/).length===3,'開いた状態で1件書き出す');
// 畳んだ状態で同じことをする（ボタンは押せないので、その場で呼ぶ）
await setup();
await p.evaluate(()=>{ $('csvReviewBox').open=false; });
dlg.length=0; dl.length=0;
await p.evaluate(()=>{ $('csvPriceCsv').click(); });
await p.waitForTimeout(500);
const closed=((dl[0]||{}).text||'').trim();
console.log('   畳んだ状態: '+JSON.stringify(closed.split(/\r\n/)));
ok(closed===opened,'★畳んでいても中身は同じ');
ok(/売値の見直しが要る行 1件/.test(dlg[0]||''),'確認の中身も同じ');
// 数量更新CSVも同じ
await setup();
dlg.length=0; dl.length=0;
await p.evaluate(()=>{ $('csvStockBox').open=true; });
await p.waitForTimeout(100);
await p.click('#csvRevise'); await p.waitForTimeout(500);
const qOpen=((dl[0]||{}).text||'').trim();
await setup();
dlg.length=0; dl.length=0;
await p.evaluate(()=>{ $('csvStockBox').open=false; $('csvRevise').click(); });
await p.waitForTimeout(500);
const qClosed=((dl[0]||{}).text||'').trim();
console.log('   数量更新: '+(qOpen===qClosed));
ok(qOpen===qClosed&&qOpen.split(/\r\n/).length===4,'★数量更新CSVも畳んでいて同じ');

console.log('\n=== 開いた・畳んだ状態は端末に保存する ===');
await p.evaluate(()=>{
  $('csvStockBox').open=true; $('csvStockBox').dispatchEvent(new Event('toggle'));
  $('csvReviewBox').open=true; $('csvReviewBox').dispatchEvent(new Event('toggle'));
});
await p.waitForTimeout(150);
const ui=await p.evaluate(()=>JSON.parse(localStorage.getItem('pj:ui:v1')||'{}'));
console.log('   '+JSON.stringify(ui));
ok(ui.csvStock===true&&ui.csvReview===true,'★開いた状態を保存する');
await p.reload(); await p.waitForTimeout(500); await p.click('#tabD');
const after=await p.evaluate(()=>({stock:$('csvStockBox').open,review:$('csvReviewBox').open}));
console.log('   開き直し: '+JSON.stringify(after));
ok(after.stock===true&&after.review===true,'★開き直しても開いたまま');
await p.evaluate(()=>{
  $('csvStockBox').open=false; $('csvStockBox').dispatchEvent(new Event('toggle'));
});
await p.waitForTimeout(150);
await p.reload(); await p.waitForTimeout(500); await p.click('#tabD');
ok(await p.evaluate(()=>$('csvStockBox').open)===false,'★畳んだ状態も残る');
await T.done();
})();
