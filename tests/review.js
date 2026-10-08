/* 出品CSVタブ：価格更新CSVの「売値の見直しが要る行だけ」（6.24）
   いまの設定で計算した推奨売値と、eBayに出している売値の差で判定する。
   しきい値（金額・割合）・相場の行・数量0の除外・確認の件数を見張る。 */
const { harness } = require('./lib');
const T = harness('出品CSVタブ：売値の見直しの判定');
const ok = T.ok;
(async()=>{
const p=await T.open();
const fs=require('fs');
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
const dl=[]; p.on('download',async d=>dl.push({name:d.suggestedFilename(),
  text:fs.readFileSync(await d.path(),'utf8')}));
await p.click('#tabD');

/* 下ごしらえ。3行とも ItemID があり、eBayに出している売値は
   いまの設定で計算した推奨売値とぴったり同じ状態から始める。 */
const setup=async()=>await p.evaluate(()=>{
  $('csvSort').value='add';
  $('csvShipProfile').value='W1000'; $('csvRetProfile').value='R';
  $('csvPayProfile').value='P'; $('csvLocation').value='Tokyo';
  $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('fx').value='160'; $('zone').value='2';
  $('csvReviewAbs').value='1'; $('csvReviewPct').value='3';
  $('csvReviewZero').checked=false; $('csvPriceChangedOnly').checked=true;
  const row=(id,itemId,cost)=>({id:id,src:'sedori',sku:'game-20260101-UG-B0'+id+'000001-1200',
    asin:'B0'+id+'000001',jan:'49'+id,titleJa:'商品'+id,
    titleEn:'Used Nintendo Switch Item '+id+' Japan Import',cat:'139973',catFixed:true,
    condId:5000,condSrc:'良い',cost:cost,qty:2,weight:150,pics:[{url:'u'}],
    descHtml:'<p>d</p>',specs:{origin:'Japan',platform:'Nintendo Switch',gameName:'I'+id},
    zeroAct:'hold',fba:true,oneOff:false,itemId:itemId,sold:'',
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false});
  csvList=[row('A','110001',1200),row('B','110002',2000),row('C','110003',1200)];
  csvPick={}; syncData=null;
  csvList.forEach(csvRecalc);
  // eBayに出している売値＝いまの推奨売値（差0）にそろえる
  csvList.forEach(r=>{ r.priceSent=r.price; r.fxSent=160; });
  csvSaveList(); csvRender(); $('csvListBox').open=true;
  return csvList.map(r=>r.id+':'+r.price);
});
const review=()=>p.evaluate(()=>csvList.map(r=>({id:r.id,
  rv:csvPriceReview(r)})).filter(x=>x.rv));

console.log('=== 売値が一致していれば対象にしない ===');
console.log('   '+JSON.stringify(await setup()));
let rv=await review();
console.log('   '+JSON.stringify(rv));
ok(rv.length===0,'★差が無い行は対象にならない');
console.log('   案内: '+await p.textContent('#csvChangedNote'));
ok(/いまは0件です/.test(await p.textContent('#csvChangedNote')),'★件数の案内も0件');

console.log('\n=== 下限利益を変えると対象になる（仕入値は触っていない）===');
await p.evaluate(()=>{ $('baseProfit').value='3000';
  $('baseProfit').dispatchEvent(new Event('input')); csvRender(); });
rv=await review();
console.log('   '+JSON.stringify(rv));
ok(rv.length===3,'★3行すべてが対象（設定を変えただけ）');
ok(rv.every(x=>x.rv.why==='設定の変更'),'★理由は「設定の変更」');
ok(rv.every(x=>x.rv.up===true&&x.rv.next>x.rv.now),'★上げる行として出る');
console.log('   案内: '+await p.textContent('#csvChangedNote'));
ok(/いま 3件（上げる 3件／下げる 0件）/.test(await p.textContent('#csvChangedNote')),
   '★件数の案内に上げる・下げるの数を出す');

console.log('\n=== 仕入への連動率・税率・送料設定でも対象になる ===');
for(const [id,val,label] of [['linkRate','60','仕入への連動率'],
  ['saleRate','40','売上比下限'],['usTaxRate','20','米国の想定税率'],
  ['fee','20','eBay手数料率'],['intlFee','5','国際取引手数料'],
  ['fixed','1','固定手数料']]){
  await setup();
  const n=await p.evaluate((o)=>{
    $(o.id).value=o.val; $(o.id).dispatchEvent(new Event('input')); csvRender();
    return csvList.map(csvPriceReview).filter(Boolean).length;
  },{id:id,val:val});
  console.log('   '+label+' → 対象 '+n+'件');
  // 変え方によって差がしきい値に届かない行もあるので、1件でも対象になれば効いている
  ok(n>=1,'★'+label+'を変えても対象になる（'+n+'/3件）');
}

/* 梱包マージン（csvPackGame）は行の重量を変える設定で、重量を引き直したときに
   売値へ入る。ここだけ動き方が違うので分けて確かめる。 */
await setup();
const pack=await p.evaluate(()=>{
  const r=csvRowById('A');
  $('csvPackGame').value='400';
  r.weight=csvWeightFor(r); csvRecalc(r); csvRender();
  return { weight:r.weight, rv:csvPriceReview(r) };
});
console.log('   梱包マージン: '+JSON.stringify(pack));
ok(pack.weight>150&&!!pack.rv,'★梱包マージンも（重量を引き直せば）対象になる');

console.log('\n=== 仕入値・為替は理由を分けて出す ===');
await setup();
let why=await p.evaluate(()=>{
  const r=csvRowById('A');
  csvCostSet(r,4000);          // 行の仕入値欄を直したのと同じ（costOrig を控える）
  csvRender();
  return csvPriceReview(r);
});
console.log('   仕入値: '+JSON.stringify(why));
ok(why&&why.why==='仕入値の変更','★仕入値を直した行は「仕入値の変更」');
await setup();
why=await p.evaluate(()=>{
  $('fx').value='200'; $('fx').dispatchEvent(new Event('input')); csvRender();
  return csvPriceReview(csvRowById('A'));
});
console.log('   為替: '+JSON.stringify(why));
ok(why&&why.why==='為替の変更','★為替が動いた行は「為替の変更」');

console.log('\n=== しきい値（金額 $1 以上 かつ 割合 3% 以上）===');
const th=async(now,abs,pct)=>await p.evaluate((o)=>{
  $('csvReviewAbs').value=o.abs; $('csvReviewPct').value=o.pct;
  const r=csvRowById('A');
  r.priceSent=Math.round((r.price-o.d)*100)/100;
  csvRender();
  return { now:r.priceSent, next:r.price, rv:csvPriceReview(r) };
},{d:now,abs:abs,pct:pct});
await setup();
let t1=await th(0.99,'1','3');
console.log('   差 $0.99: '+JSON.stringify(t1));
ok(!t1.rv,'★金額が $1 未満の行は対象にしない');
let t2=await th(5,'1','3');
console.log('   差 $5: '+JSON.stringify(t2));
ok(!!t2.rv&&t2.rv.pct>=3,'★金額も割合も超えた行は対象');
// 割合だけ足りない行（金額は大きいが割合が小さい）
let t3=await p.evaluate(()=>{
  const r=csvRowById('A');
  r.priceSent=Math.round((r.price-2)*100)/100;
  $('csvReviewAbs').value='1'; $('csvReviewPct').value='90';
  csvRender();
  return { rv:csvPriceReview(r), pct:Math.round((2/r.priceSent)*1000)/10 };
});
console.log('   割合のしきい値 90%: '+JSON.stringify(t3));
ok(!t3.rv,'★割合が足りない行は対象にしない');
let t4=await p.evaluate(()=>{ $('csvReviewPct').value='0'; csvRender();
  return !!csvPriceReview(csvRowById('A')); });
ok(t4,'★割合のしきい値を0にすれば金額だけで対象になる');
// しきい値は端末に残る
await p.evaluate(()=>{ $('csvReviewAbs').value='2.5'; $('csvReviewPct').value='7';
  $('csvReviewAbs').dispatchEvent(new Event('input'));
  $('csvReviewPct').dispatchEvent(new Event('input')); csvSaveCfg(); });
await p.reload(); await p.waitForTimeout(400); await p.click('#tabD');
const kept=await p.evaluate(()=>[$('csvReviewAbs').value,$('csvReviewPct').value]);
console.log('   開き直し: '+JSON.stringify(kept));
ok(kept[0]==='2.5'&&kept[1]==='7','★しきい値は開き直しても残る');

console.log('\n=== eBayの売値は pj-sync を優先する ===');
await setup();
const src=await p.evaluate(()=>{
  const r=csvRowById('A');
  r.priceSent=r.price;                       // 最後に書き出した売値＝推奨売値
  syncData={at:new Date().toISOString(),counts:{},items:[
    {asin:r.asin,cond:'used',scope:'ebay',ebay_sku:'E-'+r.asin+'-U',
     ebay_item_id:'110001',ebay_qty:2,ebay_price:50,dropship:0,warnings:[],state:'ok'}]};
  csvRender();
  return csvPriceReview(r);
});
console.log('   '+JSON.stringify(src));
ok(src&&src.now===50&&src.from==='sync',
   '★pj-sync が取り込んだ売値（$50）と比べる（書き出した値ではない）');

console.log('\n=== 数量0の出品は既定で対象外 ===');
const zero=await p.evaluate(()=>{
  const r=csvRowById('A');
  syncData.items[0].ebay_qty=0;
  csvRender();
  const off=csvPriceReview(r);
  $('csvReviewZero').checked=true; csvRender();
  const on=csvPriceReview(r);
  $('csvReviewZero').checked=false; csvRender();
  return { off:off, on:!!on };
});
console.log('   '+JSON.stringify(zero));
ok(!zero.off,'★数量0の出品は対象外（復活のときに売値を直すため）');
ok(zero.on,'★設定をオンにすれば対象になる');

console.log('\n=== 相場（総額$）が入っている行は相場の判定で決まった売値と比べる ===');
const sold=await p.evaluate(()=>{
  syncData=null;
  const r=csvRowById('B');
  const rec=csvPriceFor(r.cost,r.weight).price;
  /* 相場を推奨売値より少し下に入れる。「相場に合わせる」と判定されたら
     その売値（相場から請求送料を引いた商品代）と比べる。 */
  const m=priceModel(), g=m.zoneShipCharge(m.basisZone);
  r.sold=String(Math.round((rec+g-3)*100)/100);
  r.priceSent=rec;
  csvRender();
  return { rec:rec, sold:r.sold, want:csvWantPrice(r), rv:csvPriceReview(r) };
});
console.log('   '+JSON.stringify(sold));
ok(sold.want!==sold.rec,'★相場が入っている行は推奨売値をそのまま使わない');
ok(sold.rv&&Math.abs(sold.rv.next-sold.want)<0.01,
   '★相場の判定で決まった売値と比べる');
const skip=await p.evaluate(()=>{
  const r=csvRowById('B');
  /* 請求送料より少しだけ高い相場。商品代がほとんど残らないので
     「見送り（利益不足）」になる。 */
  const m=priceModel(), g=m.zoneShipCharge(m.basisZone);
  r.sold=String(Math.round((g+5)*100)/100);
  csvRender();
  return { sold:r.sold, kind:soldVerdict(csvRecOf(r),csvSoldItemOf(r),
             $('syncSoldCut').value).kind,
           want:csvWantPrice(r), rv:csvPriceReview(r) };
});
console.log('   見送り: '+JSON.stringify(skip));
ok(/^(low|loss)$/.test(skip.kind),'相場が低い行は「見送り」と判定される');
ok(skip.want===0&&!skip.rv,'★「見送り」の行は対象にしない');

console.log('\n=== 書き出し（確認の件数と、入る売値）===');
await setup();
await p.evaluate(()=>{ $('baseProfit').value='3000';
  $('baseProfit').dispatchEvent(new Event('input'));
  csvRowById('C').cost=400; csvRecalc(csvRowById('C')); csvRender(); });
const expect=await p.evaluate(()=>{
  const rv=csvList.map(csvPriceReview).filter(Boolean);
  const up=rv.filter(x=>x.up===true).length;
  return { n:rv.length, up:up, down:rv.length-up };
});
console.log('   いまの対象: '+JSON.stringify(expect));
dlg.length=0; dl.length=0;
await p.click('#csvPriceCsv');
await p.waitForTimeout(500);
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(expect.n===3&&(expect.up+expect.down)===3,'3行が対象になっている');
ok(dlg[0]&&dlg[0].indexOf('売値の見直しが要る行 '+expect.n+'件（上げる '+expect.up
   +'件／下げる '+expect.down+'件）')>=0,
   '★確認に件数と上げる行・下げる行の数を出す');
ok(/→ \$/.test(dlg[0]||'')&&/の変更）/.test(dlg[0]||''),
   '★売値の並びと理由を出す');
const lines=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   '+JSON.stringify(lines));
const want=await p.evaluate(()=>csvList.map(r=>r.id+':'+csvWantPrice(r)));
console.log('   新しい売値: '+JSON.stringify(want));
ok(lines.length===5,'★3件を書き出す');
ok(lines.slice(2).every((l,i)=>Math.abs(+l.split(',')[2]
   -(+want[i].split(':')[1]))<0.005),'★CSVには新しい売値が入る（古い売値ではない）');

console.log('\n=== 2回目は対象から外れる（出した売値を控える）===');
dlg.length=0; dl.length=0;
await p.click('#csvPriceCsv'); await p.waitForTimeout(400);
console.log('   '+JSON.stringify(dlg.map(d=>d.split('\n')[0])));
ok(dlg.some(d=>/売値の見直しが要る行がありません/.test(d))&&dl.length===0,
   '★設定を変えていなければ2回目は対象なし');
await T.done();
})();
