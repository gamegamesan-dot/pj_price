/* 画面：MW 無在庫の仕入れ値と重量（6.152）
   【J】仕入れ値は「MW と Amazon の安いほう」
   ・MW     … 卸値×1.1 ＋ 仕入れ送料（⚙ mwShipFee）
   ・Amazon … 新品の最安値（送料込み・ポイントは引かない）。24時間以内の値だけ
   ・行に「仕入れ基準：Amazon ¥○○」を出す
   ・相場（115%以内）・目標利益の売値・下限の売値もこの仕入れ値で計算
   ・⚙「Amazon の値段も仕入れ値の候補にする」（既定オン）で切れる
   【K】重量は Amazon の梱包重量＋⚙の梱包マージン。無ければ既定値。
   ・カードの計算の詳細に、どこから取った値かを出す
   ・手で直した重さはその値を優先する */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：MW 無在庫の仕入れ値と重量（6.152）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

const base={ jan:'4562475323733', sha:'M200', kishu:'figure', cond:'新品',
  name:'おそ松さん ワールドコレクタブルフィギュア',
  mw_name:'おそ松さん ワールドコレクタブルフィギュア',
  wholesale:3000, stock:5, ship_days:1, ship_text:'即日', list_price:9800,
  pics_ok:1, pics_n:1, mkt_low:60.00, mkt_n:3, mkt_ship:0, asin:'B00DROP001' };
const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://s.example'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('shipCharge').value='15.00';
  $('csvShipProfileMw').value='W2000'; $('csvShipDaysMw').value='';
  $('csvShipProfileMw2').value='W2000-MW'; $('csvShipDaysMw2').value='6';
  $('mwShipFee').value='176'; $('syncWeight').value='400';
  $('syncWeightGame').value='150';
  $('csvPackFig').value='250'; $('csvPackGame').value='60';
  $('mwAmzCost').checked=(o.amzOn!==false);
  const r=Object.assign({ mkt_at:new Date().toISOString() },o.row||{});
  mwRows=[r]; window.__r=r;
  const rec=mwRec(r);
  return { rec:rec, sell:mwSell(r,rec), judge:mwMktJudge(r,rec),
    cost:mwCostDrop(r), w:mwWeightOf(r) };
},o);

console.log('=== Amazon のほうが安いとき ===');
const now=new Date().toISOString();
let g=await setup({ row:Object.assign({},base,{ amz_low:2500, amz_at:now }) });
console.log('   '+JSON.stringify({cost:g.cost,recCost:g.rec.cost,
  src:g.rec.costSrc,text:g.rec.costText}));
ok(g.cost.mw===3476,'★MW は 卸値×1.1＋送料（3,000×1.1＝3,300＋176）');
ok(g.cost.src==='amz'&&g.cost.cost===2500,'★★★Amazon が安ければ Amazon を使う');
ok(g.rec.cost===2500,'★★★推奨売値の計算もその仕入れ値で行う');
ok(/仕入れ基準：Amazon ¥2,500/.test(g.rec.costText||''),
   '★★★「仕入れ基準：Amazon ¥2,500」と出す');
ok(/MW ¥3,476/.test(g.rec.costText||''),'★★両方の値段も添える');
const amzRec=g.rec;

console.log('\n=== MW のほうが安いとき ===');
g=await setup({ row:Object.assign({},base,{ wholesale:1000, amz_low:2500,
  amz_at:now }) });
console.log('   '+JSON.stringify({src:g.rec.costSrc,cost:g.rec.cost}));
ok(g.rec.costSrc==='mw'&&g.rec.cost===1276,'★★★MW が安ければ MW を使う');
ok(/仕入れ基準：MW ¥1,276/.test(g.rec.costText||''),'★★そう書く');
ok(g.rec.price<amzRec.price,'★★★安い仕入れ値なら推奨売値も低い');

console.log('\n=== 24時間を超えた Amazon の値段は使わない ===');
const old=new Date(Date.now()-30*3600000).toISOString();
g=await setup({ row:Object.assign({},base,{ amz_low:2500, amz_at:old }) });
console.log('   '+JSON.stringify({src:g.rec.costSrc,cost:g.rec.cost,
  why:g.cost.why}));
ok(g.rec.costSrc==='mw'&&g.rec.cost===3476,
   '★★★古い（24時間超）Amazon の値段は使わない');
ok(/24時間/.test(g.cost.why||''),'★その理由を出す');

console.log('\n=== ⚙でオフにできる（既定オン）===');
g=await setup({ amzOn:false, row:Object.assign({},base,{ amz_low:2500,
  amz_at:now }) });
console.log('   '+JSON.stringify({src:g.rec.costSrc,cost:g.rec.cost}));
ok(g.rec.costSrc==='mw'&&g.cost.amz===0,
   '★★★オフなら Amazon を候補にしない（これまでどおり MW だけ）');
ok(await p.evaluate(()=>$('mwAmzCost').checked===false),'★チェックが外れている');
await p.evaluate(()=>{ $('mwAmzCost').checked=true; });
ok(await p.evaluate(()=>mwAmzCostOn()===true),'★★戻せる（既定はオン）');

console.log('\n=== 相場の判定（115%以内）も同じ仕入れ値で ===');
/* 相場 $60 なら 115% は $69。Amazon 仕入れ（¥2,500）なら候補に入り、
   MW 仕入れ（¥20,176）なら後回しになる。 */
g=await setup({ row:Object.assign({},base,{ amz_low:2500, amz_at:now }) });
console.log('   Amazon基準: '+JSON.stringify({k:g.judge.k,pct:g.judge.pct}));
ok(g.judge.k==='ok','★★★Amazon 基準なら出品候補（相場の115%以内）');
g=await setup({ row:Object.assign({},base,{ wholesale:18000, amz_low:0,
  amz_at:'' }) });
console.log('   MW基準: '+JSON.stringify({k:g.judge.k,pct:g.judge.pct}));
ok(g.judge.k==='high','★★MW 基準で高くなる行は後回し（判定も同じ値で）');

console.log('\n=== 【K】重量は Amazon の梱包重量＋梱包マージン ===');
g=await setup({ row:Object.assign({},base,{ amz_g:420, amz_g_src:'pkg' }) });
console.log('   '+JSON.stringify(g.w)+' / '+g.rec.wText);
ok(g.w.src==='amz'&&g.w.base===420&&g.w.pack===250&&g.w.g===670,
   '★★★Amazon の梱包重量420g＋梱包250g＝670g');
ok(g.rec.weight===670,'★★★送料の計算にその重量を使う');
ok(/重量 670g（Amazon の梱包重量 420g＋梱包 250g）/.test(g.rec.wText||''),
   '★★★どこから取った値かを出す');
/* 梱包重量が無く商品の重量だけのとき。 */
g=await setup({ row:Object.assign({},base,{ amz_g:300, amz_g_src:'item' }) });
console.log('   '+g.rec.wText);
ok(/Amazon の商品の重量 300g/.test(g.rec.wText||''),
   '★★梱包重量が無ければ商品の重量と書く');
/* どちらも無ければ既定値（フィギュア400g）。 */
g=await setup({ row:Object.assign({},base,{ amz_g:0 }) });
console.log('   '+g.rec.wText);
ok(g.w.src==='def'&&g.rec.weight===400,'★★★取れなければ既定値（400g）');
ok(/重量 400g（既定値）/.test(g.rec.wText||''),'★★「（既定値）」と書く');
/* ゲームの行は既定値150g・梱包マージン60g。 */
g=await setup({ row:Object.assign({},base,{ kishu:'NS', amz_g:200,
  amz_g_src:'pkg' }) });
ok(g.rec.weight===260,'★ゲームの行は梱包マージン60g（200＋60）');

console.log('\n=== カードの計算の詳細にも出す ===');
let card=await p.evaluate(()=>{
  const r=Object.assign({},window.__r,{ kishu:'figure', amz_g:420,
    amz_g_src:'pkg', amz_low:2500, amz_at:new Date().toISOString(),
    wholesale:3000 });
  mwRows=[r];
  const row=mwListRow(r,[{url:'https://x/i/1.jpg',w:600,h:600}],0);
  csvList=[row]; csvSaveList&&csvSaveList();
  if(!row.wManual)row.weight=csvWeightFor(row);
  csvRecalc(row);
  return { html:csvWhereHtml(row).replace(/<[^>]*>/g,''), row:{ w:row.weight,
    wSrc:row.wSrc, wBase:row.wBase, wPack:row.wPack, costSrc:row.costSrc,
    costText:row.costText } };
});
console.log('   '+JSON.stringify(card));
ok(card.row.w===670&&card.row.wSrc==='amz','★★★出品リストの行にも引き継ぐ');
ok(/重量 670g（Amazon の梱包重量 420g＋梱包 250g）/.test(card.html),
   '★★★計算の詳細に重量の出どころを出す');
ok(/仕入れ基準：Amazon ¥2,500/.test(card.html),
   '★★★計算の詳細に仕入れ基準も出す');

console.log('\n=== 手で直した重さを優先する ===');
let hand=await p.evaluate(()=>{
  const row=csvList[0];
  row.wManual=true; row.wSrc='hand'; row.wHand=900; row.weight=900;
  csvRecalc(row);
  if(!row.wManual)row.weight=csvWeightFor(row);
  return { w:row.weight, html:csvWhereHtml(row).replace(/<[^>]*>/g,''),
    mw:mwWeightOf({ wHand:900, amz_g:420, kishu:'figure' }) };
});
console.log('   '+JSON.stringify(hand));
ok(hand.w===900,'★★★手で入れた重さは作り直しても残る');
ok(/重量 900g（手で入れた値）/.test(hand.html),'★★そう書く');
ok(hand.mw.src==='hand'&&hand.mw.g===900,
   '★★★Amazon の重さがあっても手で入れた値を優先する');
await T.done();
})();
