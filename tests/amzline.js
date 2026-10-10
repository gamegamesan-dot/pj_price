/* Amazonの方が得な商品を eBay で安売りしない（Amazon同等ライン・6.34／7.30）
   ・Amazon手取り＝最安値×(1−販売手数料)−FBA手数料／Amazon利益＝手取り−仕入値
   ・Amazon同等ライン＝その利益になる eBay 売値（既存の利益計算の逆算）
   ・最低売値・推奨売値・見直し・3日値下げ・一括最低売値のすべてに効く
   ・Amazon利益が下限利益以下の行、eBay優先の行は今までどおり */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('Amazon同等ライン（安売りしない下限）');
const ok = T.ok;
(async()=>{
const p=await T.open();
const fs=require('fs');
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
const dl=[]; p.on('download',async d=>dl.push({name:d.suggestedFilename(),
  text:fs.readFileSync(await d.path(),'utf8')}));

/* 依頼の例：お姉チャンバラ vorteX（Xbox 360）E-B000VO8NZ4
   仕入値 ¥1,680／Amazon最安値（新品）¥5,100／eBay $27.60 */
const setup=async()=>{
  await p.evaluate(()=>{
    $('fx').value='160'; $('zone').value='2';
    $('baseProfit').value='500'; $('linkRate').value='30'; $('saleRate').value='15';
    $('usTaxRate').value='8'; $('targetMode').value='auto';
    $('amzFeeRate').value='15'; $('amzFbaFee').value='400';
    $('csvReviewAbs').value='1'; $('csvReviewPct').value='3';
    $('csvMarkDays').value='3'; $('csvMarkStep').value='1';
    $('csvPriceChangedOnly').checked=true;
    $('syncApi').value=''; $('syncKey').value='';
    const it=(asin,o)=>Object.assign({asin:asin,cond:'new',scope:'ebay',prefix:'game',
      ebay_sku:'E-'+asin,ebay_item_id:'11'+asin.slice(-4),ebay_qty:1,
      one_off:0,dropship:0,restocking:0,mark_at:null,mark_stop:0,ebay_first:0,
      ebay_sold_at:null,weight_g:150,fba_available:1,fba_inbound:0,fba_reserved:0,
      warnings:[],notes:[],state:'ok'},o||{});
    syncData={at:new Date().toISOString(),counts:{},items:[
      // ① Amazonの方が得（仕入値が安い）
      it('B000VO8NZ4',{ebay_price:27.60,cost_yen:1680,amazon_lowest:5100,
        amazon_offers_json:JSON.stringify([{p:5100,c:'new'}])}),
      // ② Amazon利益が下限利益（500円）以下（仕入値が最安値に近い）
      it('B000VO8NZ5',{ebay_price:70,cost_yen:3900,amazon_lowest:5100,
        amazon_offers_json:JSON.stringify([{p:5100,c:'new'}])}),
      // ③ Amazon最安値が取れていない
      it('B000VO8NZ6',{ebay_price:27.60,cost_yen:1680,amazon_lowest:null,
        amazon_offers_json:'[]'})]};
    csvList=[]; csvSaveList(); syncPick={};
    switchTab('E');
  });
  await openCsvBoxes(p);
};
// 画面の usd() と同じ書き方にそろえる（$と3桁区切り）
const usdStr=(v)=>'$'+(+v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d)\.)/g,',');
const row=async(i)=>await p.evaluate((i)=>{
  const r=syncData.items[i];
  const f=syncFloorOf(r), a=syncAmzLine(r), rv=syncPriceReview(r);
  return { amzProfit:syncAmzProfit(r), line:a&&a.price, floor:f.v, amz:!!f.amz,
    costFloor:(syncRecCost(r)||{}).floor, costPrice:(syncRecCost(r)||{}).price,
    want:syncWantPrice(r), next:syncMarkNext(r), due:syncMarkDue(r),
    skip:syncMarkSkip(r), better:syncAmzBetter(r), alert:syncAmzAlert(r),
    review:rv&&{now:rv.now,next:rv.next,up:rv.up} };
},i);

console.log('=== Amazonの方が得な行（仕入値1,680／最安値5,100）===');
await setup();
const a=await row(0);
console.log('   '+JSON.stringify(a));
ok(a.amzProfit===2255,'★Amazon利益 ＝ 5100×0.85 − 400 − 1680 ＝ ¥2,255');
ok(a.line>a.costFloor&&a.line>a.costPrice,
   '★Amazon同等ラインは仕入値基準の最低売値・推奨売値より高い');
ok(a.floor===a.line&&a.amz===true,'★最低売値は Amazon同等ラインまで上がる');
ok(a.want===a.line,'★出すべき売値（推奨売値）も Amazon同等ラインまで上がる');
ok(a.better===true,'★「Amazonの方が得」の行として分かる');
console.log('   仕入値基準の下限 $'+a.costFloor+' → Amazon同等ライン $'+a.line);

console.log('\n=== 値下げの対象から外れる ===');
ok(a.due===false,'★3日ごとの値下げの対象にならない');
ok(a.skip==='Amazonの方が得（これ以上は下げません）','★止める理由をそう出す');
ok(a.next===a.line,'★下げるとしても Amazon同等ラインで止まる');

console.log('\n=== 見直しは「上げる」提案になる ===');
console.log('   '+JSON.stringify(a.review));
ok(a.review&&a.review.up===true&&a.review.next===a.line,
   '★$27.60 → Amazon同等ライン への値上げを出す');
// 書き出しの中身（列・形式は今までどおり）
dlg.length=0; dl.length=0;
await p.click('#syncPriceCsv'); await p.waitForTimeout(500);
const L=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   '+JSON.stringify(L));
ok(L.some(x=>x==='Revise,118NZ4,'+a.line.toFixed(2)),
   '★価格更新CSVに Amazon同等ラインの値が入る');
ok(/^\*Action\(SiteID=US/.test(L[1])&&/,ItemID,\*StartPrice$/.test(L[1]),
   '★CSVの列と形式は変わらない');

console.log('\n=== FBA在庫があって eBay が安い行は「対応が必要」===');
const warn=await p.evaluate(()=>{
  const r=syncData.items[0];
  return { alert:syncAmzAlert(r), inWarn:syncFilterBy('warn').f(r),
    card:(Array.from(document.querySelectorAll('#syncList > div'))
      .map(d=>d.textContent).find(x=>x.indexOf('B000VO8NZ4')>=0)||''),
    brk:$('syncWarnBreak').textContent };
});
console.log('   '+warn.card.replace(/\s+/g,' ').slice(0,220));
ok(warn.alert&&warn.inWarn,'★「対応が必要」に入る');
ok(/Amazonでも販売中/.test(warn.card),'★行にそう出す');
ok(/eBay を \$[\d.]+ 以上にするか、eBay を数量0に/.test(warn.card),
   '★直し方を出す');
ok(/Amazon利益 ¥2,255/.test(warn.card)&&/eBayで同じ利益/.test(warn.card),
   '★Amazon利益と、同じ利益になる eBay の売値を出す');
ok(/Amazonでも販売中 1件/.test(warn.brk),'★理由ごとの件数にも出る');
// 在庫が無い行（FBA0・入庫0）は注意を出さない
const nostock=await p.evaluate(()=>{
  const r=syncData.items[0];
  r.fba_available=0; r.fba_inbound=0; syncRender();
  const o={ alert:syncAmzAlert(r), floor:syncFloorOf(r).v };
  r.fba_available=1; syncRender();
  return o;
});
console.log('   在庫なし: '+JSON.stringify(nostock));
ok(nostock.alert===false,'★在庫が無ければ注意は出さない');
ok(nostock.floor>0,'★下限（Amazon同等ライン）はそのまま効く');

console.log('\n=== 操作バー：見直し価格にする／最低売値まで下げる ===');
await setup();
await p.evaluate(()=>{
  const r=syncData.items[0];
  syncPick={}; syncPick[r.asin+'|'+r.cond]=true; syncRender();
});
const barBtn=await p.evaluate(()=>({
  show:getComputedStyle($('syncBar')).display,
  btn:Array.from(document.querySelectorAll('#syncBar button')).map(b=>b.textContent),
  // 一覧に出る最低売値は、押したときに使う値と同じ
  card:(Array.from(document.querySelectorAll('#syncList > div'))
    .map(d=>d.textContent).find(x=>x.indexOf('B000VO8NZ4')>=0)||'').replace(/\s+/g,' ') }));
console.log('   '+JSON.stringify(barBtn.btn));
ok(barBtn.btn.indexOf('見直し価格にする')>=0,'★操作バーに「見直し価格にする」がある');
ok(new RegExp('最低売値 \\'+usdStr(a.line)).test(barBtn.card)
   &&/Amazonの方が得。仕入値基準では/.test(barBtn.card),
   '★一覧の「最低売値」も Amazon同等ライン（仕入値基準は添えるだけ）');
// 見直し価格にする（選んだ行すべて・上げも下げも）
dlg.length=0; dl.length=0;
await p.click('#syncBarRev'); await p.waitForTimeout(500);
console.log('   確認: '+JSON.stringify(dlg[0]));
const RL=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   '+JSON.stringify(RL));
ok(/選んだ行すべて（上げも下げも）/.test(dlg[0]||''),
   '★「見直しが要る行だけ」の設定に関係なく、選んだ行すべてが対象');
ok(RL.length===3&&RL[2]==='Revise,118NZ4,'+a.line.toFixed(2),
   '★選んだ行を見直し価格（Amazon同等ライン）にする');
// 最低売値まで下げる → Amazon同等ラインより下げない
dlg.length=0; dl.length=0;
await p.click('#syncBarFloor'); await p.waitForTimeout(500);
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/Amazonの方が得（\$[\d.]+ 未満では出しません）/.test(dlg[0]||'')&&dl.length===0,
   '★Amazonの方が得な行は、そのラインより下げない');
// ラインより上にいる行は、ラインまで下げる（下限は仕入値基準ではない）
dlg.length=0; dl.length=0;
await p.evaluate(()=>{ syncData.items[0].ebay_price=99; syncRender(); });
await p.click('#syncBarFloor'); await p.waitForTimeout(500);
const FL=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   確認: '+JSON.stringify(dlg[0]));
console.log('   '+JSON.stringify(FL));
ok(/Amazon同等ライン/.test(dlg[0]||''),'★確認に「Amazon同等ラインで止めます」と出す');
ok(FL.length===3&&FL[2]==='Revise,118NZ4,'+a.line.toFixed(2),
   '★下げ先は Amazon同等ライン（仕入値基準の最低売値ではない）');

console.log('\n=== Amazon利益が下限利益以下の行は今までどおり ===');
const b=await row(1);
console.log('   '+JSON.stringify(b));
ok(b.amzProfit!==null&&b.amzProfit<=500,'Amazon利益は下限利益（500円）以下');
ok(b.line===undefined||b.line===null,'★Amazon同等ラインを使わない');
ok(b.floor===b.costFloor&&!b.amz,'★最低売値は仕入値基準のまま');
ok(b.due===true,'★3日ごとの値下げの対象のまま');

console.log('\n=== Amazon最安値が取れない行も今までどおり ===');
const c=await row(2);
console.log('   '+JSON.stringify(c));
ok(c.amzProfit===null&&!c.line,'★計算しない');
ok(c.floor===c.costFloor&&c.due===true,'★今までどおりの下限と値下げ');

console.log('\n=== eBay優先をオンにすると今までの値に戻る ===');
await setup();          // 前の節で売値と値下げの記録を動かしたので、入れ直す
const on=await p.evaluate(()=>{
  const r=syncData.items[0];
  const before={ floor:syncFloorOf(r).v, want:syncWantPrice(r), due:syncMarkDue(r) };
  r.ebay_first=1; syncRender();
  const after={ floor:syncFloorOf(r).v, want:syncWantPrice(r), due:syncMarkDue(r),
    line:syncAmzLine(r), better:syncAmzBetter(r), alert:syncAmzAlert(r),
    costFloor:syncRecCost(r).floor, costPrice:syncRecCost(r).price,
    badge:(Array.from(document.querySelectorAll('#syncList > div'))
      .map(d=>d.textContent).find(x=>x.indexOf('B000VO8NZ4')>=0)||'') };
  return { before:before, after:after };
});
console.log('   '+JSON.stringify({before:on.before,floor:on.after.floor,
  want:on.after.want,due:on.after.due}));
ok(on.after.line===null,'★Amazon同等ラインを使わない');
ok(on.after.floor===on.after.costFloor,'★最低売値は仕入値基準に戻る');
ok(on.after.want===on.after.costPrice,'★推奨売値も仕入値基準に戻る');
ok(on.after.due===true,'★3日ごとの値下げの対象に戻る');
ok(on.after.alert===false&&!on.after.better,'★注意とバッジも出さない');
ok(/eBay優先/.test(on.after.badge),'★行に「eBay優先」と出す');
// ボタンで切り替えられる（送信は pj-sync が無いので失敗するが、印の有無は見える）
const btn=await p.evaluate(()=>{
  const r=syncData.items[0]; r.ebay_first=0; syncRender();
  const key=r.asin+'|'+r.cond;
  const b=document.querySelector('#syncList button[data-sefirst="'+key+'"]');
  return b?b.textContent:'';
});
console.log('   ボタン: '+btn);
ok(/eBay優先 オフ/.test(btn),'★行に「eBay優先」のボタンを出す');

console.log('\n=== 手数料は⚙設定で変えられる ===');
const cfg=await p.evaluate(()=>{
  const r=syncData.items[0];
  const a1=syncAmzProfit(r);
  $('amzFeeRate').value='8'; $('amzFbaFee').value='0';
  syncRender();
  const a2=syncAmzProfit(r);
  $('amzFeeRate').value='15'; $('amzFbaFee').value='400'; syncRender();
  return { a1:a1, a2:a2, inCfg:$('tabCfg').contains($('amzFeeRate'))
    &&$('tabCfg').contains($('amzFbaFee')),
    adv:advGet().amzFeeRate!==undefined&&advGet().amzFbaFee!==undefined };
});
console.log('   '+JSON.stringify(cfg));
ok(cfg.a2===Math.round(5100*0.92-1680),'★手数料を変えると Amazon利益も変わる');
ok(cfg.inCfg,'★設定は⚙設定の中にある');
ok(cfg.adv,'★pj-sync（D1）にも送る設定に入っている');
await T.done();
})();
