/* 選択バーで印をまとめて切り替える／小さな差では注意を出さない（6.38・7.35）
   ・バーは「見直し価格にする」「最低売値まで下げる」「印を付ける ▾」「選択解除」の4つ
   ・印はページをまたいだ選択すべてに反映し、D1 に保存する
   ・付けられない行はとばして件数を出す
   ・Amazon同等ラインとの差が小さい行は「対応が必要」に入れない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('選択バーの印と、小さな差の注意');
const ok = T.ok;
(async()=>{
const p=await T.open();
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

const N=60;
const setup=async()=>{
  await p.evaluate((N)=>{
    localStorage.removeItem('pj:ui:v1');
    $('fx').value='160'; $('baseProfit').value='650'; $('linkRate').value='30';
    $('amzFeeRate').value='15'; $('amzFbaFee').value='400';
    $('csvReviewAbs').value='1'; $('csvReviewPct').value='3';
    $('syncPerPage').value='25'; $('syncPerPage2').value='25';
    $('syncApi').value=''; $('syncKey').value='';     // 送信はせず、画面の変化だけ見る
    const it=(i)=>({asin:'B0FLG'+String(100000+i).slice(-6),cond:'used',scope:'ebay',
      prefix:'game',ebay_sku:'E-x'+i,ebay_item_id:'96'+(100000+i),ebay_qty:1,
      ebay_price:50,one_off:0,dropship:0,restocking:0,mark_at:null,mark_stop:0,
      ebay_first:0,ebay_sold_at:null,cost_yen:2000,weight_g:200,
      // 半分はFBA在庫あり（無在庫の印を付けられない行）
      fba_available:(i%2===0)?1:0,fba_inbound:0,fba_reserved:0,
      amazon_lowest:null,amazon_offers_json:'[]',
      warnings:[],notes:[],state:'ok'});
    const items=[]; for(let i=0;i<N;i++)items.push(it(i));
    syncData={at:new Date().toISOString(),counts:{},items:items};
    syncPick={}; syncPage=1; csvList=[]; csvSaveList();
    switchTab('E');
    if($('syncFilter').querySelector('option[value="all"]'))$('syncFilter').value='all';
    syncRender();
  },N);
  await p.waitForTimeout(120);
};

console.log('=== バーは4つ ===');
await setup();
await p.evaluate(()=>{
  $('syncPageAll').checked=true; $('syncPageAll').dispatchEvent(new Event('change'));
});
await p.waitForTimeout(120);
const bar=await p.evaluate(()=>({
  main:Array.from(document.querySelectorAll('#syncBar > div:nth-child(2) button'))
    .map(b=>b.textContent),
  n:$('syncBarN').textContent,
  flags:getComputedStyle($('syncBarFlags')).display }));
console.log('   '+JSON.stringify(bar));
ok(bar.main.length===4,'★iPhoneで1行に収まる4つ');
ok(bar.main.join('|')==='見直し価格にする|最低売値まで下げる|印を付ける ▾|選択解除',
   '★並びは 見直し価格・最低売値・印を付ける ▾・選択解除');
ok(bar.flags==='none','★印の欄は押すまで閉じている');
const open=await p.evaluate(()=>{
  $('syncBarMarkBtn').click();
  return Array.from(document.querySelectorAll('#syncBarFlags button[data-sflag]'))
    .map(b=>b.textContent);
});
console.log('   '+JSON.stringify(open));
ok(open.join('|')==='eBay優先 オン|eBay優先 オフ|一点物 オン|一点物 オフ|'
   +'値下げしない オン|値下げしない オフ|無在庫 オン|無在庫 オフ',
   '★eBay優先・一点物・値下げしない・無在庫 のオン／オフが並ぶ');

console.log('\n=== 25件を eBay優先 オンにする ===');
dlg.length=0;
await p.click('#syncBarFlags button[data-sflag="ebay_first|1"]');
await p.waitForTimeout(300);
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/25件を eBay優先 オンにします/.test(dlg[0]||''),'★件数を出して確認する');
const on=await p.evaluate(()=>({
  n:syncData.items.filter(r=>Number(r.ebay_first||0)===1).length,
  note:$('syncFixNote').textContent,
  badge:(Array.from(document.querySelectorAll('#syncList > div'))
    .map(d=>d.textContent)[0]||'').indexOf('eBay優先')>=0 }));
console.log('   '+JSON.stringify(on));
ok(on.n===25,'★選んだ25件すべてがオンになる');
ok(on.badge,'★一覧にもすぐ出る');
ok(/この端末にだけ記録しました/.test(on.note),
   'pj-sync のURL・キーが空のときはそう知らせる');
// 同じ操作をもう一度 → すでにその状態
dlg.length=0;
await p.click('#syncBarFlags button[data-sflag="ebay_first|1"]');
await p.waitForTimeout(250);
console.log('   2回目: '+JSON.stringify(dlg[0]));
ok(/すべて「eBay優先 オン」です/.test(dlg[0]||''),'★すでにその状態なら送らない');

console.log('\n=== ページをまたいだ選択にも反映する ===');
await setup();
await p.evaluate(()=>{
  $('syncPageAll').checked=true; $('syncPageAll').dispatchEvent(new Event('change'));
});
await p.click('#syncPagerTop button[data-spage="2"]');
await p.waitForTimeout(150);
await p.evaluate(()=>{
  $('syncPageAll').checked=true; $('syncPageAll').dispatchEvent(new Event('change'));
});
await p.waitForTimeout(150);
dlg.length=0;
await p.evaluate(()=>{ $('syncBarMarkBtn').click(); });
await p.click('#syncBarFlags button[data-sflag="mark_stop|1"]');
await p.waitForTimeout(300);
console.log('   確認: '+JSON.stringify(dlg[0]));
const both=await p.evaluate(()=>({
  n:syncData.items.filter(r=>Number(r.mark_stop||0)===1).length,
  p1:syncData.items.slice(0,25).filter(r=>Number(r.mark_stop||0)===1).length,
  p2:syncData.items.slice(25,50).filter(r=>Number(r.mark_stop||0)===1).length }));
console.log('   '+JSON.stringify(both));
ok(/50件を 値下げしない オンにします/.test(dlg[0]||''),'★全ページの選択行を数える');
ok(/他のページの 25件を含みます/.test(dlg[0]||''),'★他のページぶんも含むと出す');
ok(both.n===50&&both.p1===25&&both.p2===25,'★両方のページの行に反映される');

console.log('\n=== 付けられない印はとばす ===');
await setup();
await p.evaluate(()=>{
  $('syncPageAll').checked=true; $('syncPageAll').dispatchEvent(new Event('change'));
  $('syncBarMarkBtn').click();
});
dlg.length=0;
await p.click('#syncBarFlags button[data-sflag="dropship|1"]');
await p.waitForTimeout(300);
console.log('   確認: '+JSON.stringify(dlg[0]));
const dr=await p.evaluate(()=>({
  on:syncData.items.slice(0,25).filter(r=>Number(r.dropship||0)===1).length,
  stock:syncData.items.slice(0,25).filter(r=>Number(r.fba_available||0)>0).length }));
console.log('   '+JSON.stringify(dr));
ok(/件は付けられないためとばします/.test(dlg[0]||''),
   '★「○件は付けられないためとばしました」と出す');
ok(dr.on===25-dr.stock,'★在庫がある行には無在庫の印を付けない');

console.log('\n=== 小さな差では「Amazonでも販売中」を出さない ===');
await p.evaluate(()=>{
  // ザ・クルー E-B014UKMZVW：売値 $25.31／同等ライン $25.56 の形を作る
  const r={asin:'B014UKMZVW',cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-B014UKMZVW-U',ebay_item_id:'960000000001',ebay_qty:1,ebay_price:25.31,
    one_off:0,dropship:0,restocking:0,mark_at:null,mark_stop:0,ebay_first:0,
    ebay_sold_at:null,cost_yen:1500,weight_g:150,amazon_lowest:4800,
    amazon_offers_json:JSON.stringify([{p:4800,c:'very_good'}]),
    fba_available:1,fba_inbound:0,fba_reserved:0,warnings:[],notes:[],state:'ok'};
  syncData={at:new Date().toISOString(),counts:{},items:[r]};
  syncPick={}; syncRender();
});
const near=await p.evaluate(()=>{
  const r=syncData.items[0], line=syncAmzLine(r).price;
  const o=[];
  [0.25,2.5].forEach(function(d){
    r.ebay_price=Math.round((line-d)*100)/100; syncRender();
    o.push({ diff:d, price:r.ebay_price, alert:syncAmzAlert(r),
      warn:syncFilterBy('warn').f(r), better:syncAmzBetter(r),
      floor:syncFloorOf(r).v, card:(Array.from(document.querySelectorAll('#syncList > div'))
        .map(x=>x.textContent)[0]||'').replace(/\s+/g,' ') });
  });
  return { line:line, o:o };
});
console.log('   同等ライン $'+near.line);
console.log('   差$0.25: '+JSON.stringify({alert:near.o[0].alert,warn:near.o[0].warn,
  better:near.o[0].better,floor:near.o[0].floor}));
console.log('   差$2.50: '+JSON.stringify({alert:near.o[1].alert,warn:near.o[1].warn}));
ok(near.o[0].alert===false&&near.o[0].warn===false,
   '★差 $1 未満・3%未満の行は「対応が必要」に入れない');
ok(!/Amazon でも販売中です/.test(near.o[0].card),'★赤い注意も出さない');
ok(near.o[0].better===true&&/Amazonの方が得/.test(near.o[0].card),
   '★バッジ「Amazonの方が得」はそのまま');
ok(near.o[0].floor===near.line,'★値下げの下限（Amazon同等ライン）もそのまま');
ok(near.o[1].alert===true&&near.o[1].warn===true,
   '★差が $1 以上かつ 3%以上の行はこれまでどおり出す');
await T.done();
})();
