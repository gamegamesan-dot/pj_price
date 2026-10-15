/* カードを短くする（6.48）
   ・初期表示は 商品名・リンク・仕入値／売値／利益の帯・状態のバッジ・
     「次にやること」1行・相場の入力・行のボタン だけ
   ・細かい計算は「計算の詳細 ▸」の中。初期は閉じ、開閉はこの端末に保存する
   ・「売値の見直し」はどちらの基準（保存済みの仕入値／Amazon最安値）かを明記する
   ・利益の枠の利益率が枠からはみ出さない（320〜414px） */
const { harness, openCsvBoxes, openRowDet } = require('./lib');
const T = harness('カードを短くする（計算の詳細）');
const ok = T.ok;
(async()=>{
const p=await T.open();

/* 販売連携タブ：3行だけの出品データ。
   ① 仕入値が D1 に保存されている行（基準＝保存済みの仕入値）
   ② 仕入値が分からない行（基準＝Amazon最安値）
   ③ 自動値下げの時期が来ている行 */
const syncSetup=async()=>await p.evaluate(()=>{
  $('fx').value='160'; $('zone').value='2'; $('baseProfit').value='1000';
  $('linkRate').value='30'; $('saleRate').value='15'; $('usTaxRate').value='8';
  $('targetMode').value='auto'; $('syncSoldCut').value='0';
  $('csvReviewAbs').value='1'; $('csvReviewPct').value='3';
  $('autoRvMode').value='off'; $('autoMdMode').value='off';
  $('csvMarkDays').value='3'; $('csvMarkTimes').value='10'; $('csvMarkStep').value='1';
  const old=new Date(Date.now()-5*86400000).toISOString();
  const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'55'+asin.slice(-4),ebay_qty:1,
    title:asin+'の商品',cost_yen:1200,weight_g:150,one_off:0,dropship:0,restocking:0,
    mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,ebay_sale:null,
    md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,
    amazon_lowest:0,amazon_offers_json:'[]',sold_usd:null,ebay_start:old,
    fba_available:1,fba_inbound:0,fba_reserved:0,warnings:[],notes:[],state:'ok'},x||{});
  syncData={at:new Date().toISOString(),counts:{},items:[
    /* ① 保存済みの仕入値 ¥1,200（Amazon最安値 ¥9,000 もある）。
       売値が安いので「売値の見直し」が出る。基準は**仕入値のほう**。 */
    it('B0CRD00001',{ebay_price:15,amazon_lowest:9000,
      amazon_offers_json:JSON.stringify([{p:9000,c:'used'}])}),
    // ② 仕入値が無く、Amazon最安値 ¥9,000 を仕入値とみなす行
    it('B0CRD00002',{cost_yen:null,amazon_lowest:9000,
      amazon_offers_json:JSON.stringify([{p:9000,c:'used'}]),ebay_price:40}),
    // ③ 値下げの時期が来ている行（自動値下げの幅つき）
    it('B0CRD00003',{ebay_price:60,md_step:2.5,md_start:85,md_floor:44.94,md_n:10,
      md_done:2,mark_at:old}),
  ]};
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E'); syncRender();
});
const card=async(w)=>await p.evaluate((w)=>{
  const d=Array.from(document.querySelectorAll('#syncList > div'))
    .find(x=>x.textContent.indexOf(w)>=0);
  if(!d)return null;
  const det=d.querySelector('details[data-det]');
  return { text:d.innerText.replace(/\n/g,' | '),
           open:!!(det&&det.open),
           sum:det?det.querySelector('summary').textContent:'',
           detText:det?det.querySelector('.detbody').innerText.replace(/\n/g,' | '):'',
           h:Math.round(d.getBoundingClientRect().height),
           hasSold:!!d.querySelector('[data-ssold]'),
           hasBtns:!!d.querySelector('button'),
           hasLinks:!!d.querySelector('a'),
           hasMoney:!!d.querySelector('[data-money]'),
           kwInDet:!!(det&&det.querySelector('[data-skw]')) };
},w);

console.log('=== 販売連携：初期表示（6.48）===');
await syncSetup();
let c=await card('B0CRD00001');
console.log('   カード: '+c.text);
ok(c.open===false&&c.sum==='計算の詳細',
   '★「計算の詳細」は初期状態で閉じている');
ok(c.hasMoney&&c.hasLinks&&c.hasSold&&c.hasBtns,
   '★帯・検索リンク・相場の入力・行のボタンは初期表示に出す');
ok(!/FBA 販売可能/.test(c.text)&&!/最低利益ライン/.test(c.text)
   &&!/ItemID/.test(c.text)&&!/Amazon利益/.test(c.text)
   &&!/損益分岐/.test(c.text)&&!/E-B0CRD00001-U/.test(c.text),
   '★SKU・ItemID・FBA在庫・最低利益ライン・損益分岐・Amazon利益は初期表示に出さない');
ok(c.kwInDet,'★検索語の欄も「計算の詳細」の中に入れる');

console.log('\n=== 「次にやること」は1行だけ ===');
console.log('   ①: '+(c.text.split(' | ').find(x=>/売値の見直し/.test(x))||''));
ok(/売値の見直し/.test(c.text)&&/\$15\.00 → \$/.test(c.text),
   '★「売値の見直し：$15.00 → $○○」を1行で出す');
ok(/基準：保存済みの仕入値 ¥1,200/.test(c.text),
   '★★どちらの基準で計算したかをバッジの横に出す（保存済みの仕入値）');
const c2=await card('B0CRD00002');
console.log('   ②: '+(c2.text.split(' | ').find(x=>/基準/.test(x))||''));
ok(/基準：Amazon最安値 ¥9,000（仕入値が分かりません）/.test(c2.text),
   '★★仕入値が無い行は「Amazon最安値」が基準だと分かる');
const c3=await card('B0CRD00003');
console.log('   ③: '+(c3.text.split(' | ').find(x=>/値下げ/.test(x))||''));
ok(/値下げの時期|次の自動値下げ/.test(c3.text),'★値下げの時期の行はそれを1行で出す');
const one=await p.evaluate(()=>{
  const d=Array.from(document.querySelectorAll('#syncList > div'))
    .find(x=>x.textContent.indexOf('B0CRD00003')>=0);
  return Array.from(d.querySelectorAll(':scope > div > div.note2'))
    .map(x=>x.innerText).filter(t=>/値下げ|見直し|相場未確認|自動反映|要対応/.test(t)).length;
});
console.log('   次にやることの行数: '+one);
ok(one===1,'★案内は1行だけ（ほかは計算の詳細へ）');

console.log('\n=== 「計算の詳細」を開くと中身が出る ===');
await p.evaluate(()=>{
  const d=Array.from(document.querySelectorAll('#syncList > div'))
    .find(x=>x.textContent.indexOf('B0CRD00001')>=0);
  d.querySelector('summary').click();
});
await p.waitForTimeout(150);
const op=await card('B0CRD00001');
console.log('   詳細: '+op.detText.slice(0,260));
ok(op.open===true&&op.h>c.h,'★開くとカードが伸びる');
['E-B0CRD00001-U','ItemID','FBA 販売可能','eBay 数量','推奨売値','最低利益ライン',
 '損益分岐','重量'].forEach(function(t){
  ok(op.detText.indexOf(t)>=0,'★詳細に出る：'+t);
});
ok(/この仕入値での推奨売値/.test(op.detText)&&/最低売値/.test(op.detText),
   '★保存済み仕入値での推奨売値・最低売値も詳細に出る');
ok(/Amazon利益/.test(op.detText)&&/手数料/.test(op.detText)&&/FBA /.test(op.detText),
   '★Amazon利益の計算（最安値−手数料−FBA−仕入値）も詳細に出る');
await p.evaluate(()=>{
  Array.from(document.querySelectorAll('#syncList > div'))
    .find(x=>x.textContent.indexOf('B0CRD00002')>=0).querySelector('summary').click();
});
await p.waitForTimeout(150);
const amz2=await card('B0CRD00002');
ok(/Amazon最安値/.test(amz2.detText),'★最安値の出どころも詳細に出る');
await p.evaluate(()=>{
  Array.from(document.querySelectorAll('#syncList > div'))
    .find(x=>x.textContent.indexOf('B0CRD00003')>=0).querySelector('summary').click();
});
await p.waitForTimeout(150);
const md=await card('B0CRD00003');
ok(/下限 \$44\.94/.test(md.detText)&&/あと\d+回/.test(md.detText),
   '★自動値下げの下限・残り回数も詳細に出る');

console.log('\n=== 開閉はこの端末に保存する ===');
const saved=await p.evaluate(()=>localStorage.getItem('pj:det:v1')||'');
console.log('   保存: '+saved);
ok(/"B0CRD00001\|used":1/.test(saved),'★開けた行を控える');
await p.reload(); await p.waitForTimeout(400);
await syncSetup();
let again=await card('B0CRD00001');
let other=await card('B0CRD00002');
console.log('   開き直し: ①'+again.open+' / ③'+(await card('B0CRD00003')).open);
ok(again.open===true,'★開き直しても開いたまま');
ok(other.open===true,'★ほかに開けた行も開いたまま');
await p.evaluate(()=>{
  Array.from(document.querySelectorAll('#syncList > div'))
    .find(x=>x.textContent.indexOf('B0CRD00001')>=0).querySelector('summary').click();
});
await p.waitForTimeout(150);
const closed=await p.evaluate(()=>localStorage.getItem('pj:det:v1')||'');
ok(!/"B0CRD00001\|used"/.test(closed),'★畳んだら控えから外す');

console.log('\n=== 出品CSVタブも同じ ===');
const csvSetup=async()=>await p.evaluate(()=>{
  $('csvShipProfile').value='W1000'; $('csvRetProfile').value='R';
  $('csvPayProfile').value='P'; $('csvLocation').value='Tokyo';
  csvList=[{id:'c1',src:'sedori',sku:'game-20260101-UG-B0CRD10001-1200',
    asin:'B0CRD10001',jan:'4900001',titleJa:'テスト商品c1',
    titleEn:'Used Nintendo Switch Test Item Japan Import',cat:'139973',catFixed:true,
    condId:5000,condSrc:'良い',cost:1200,qty:1,weight:150,
    pics:[{url:'u1'}],descHtml:'<p>d</p>',
    specs:{origin:'Japan',platform:'Nintendo Switch',gameName:'Test'},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',sold:'',amzLow:'',dropship:false,
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false}];
  csvPick={}; syncData=null;
  csvList.forEach(csvRecalc); csvSaveList();
  switchTab('D'); csvRender(); $('csvListBox').open=true;
});
await csvSetup();
const ccard=async()=>await p.evaluate(()=>{
  const d=document.querySelector('#csvList [data-row="c1"]');
  const det=d.querySelector('details[data-det]');
  return { text:d.innerText.replace(/\n/g,' | '), open:!!(det&&det.open),
    detText:det?det.querySelector('.detbody').innerText.replace(/\n/g,' | '):'',
    hasSold:!!d.querySelector('[data-sold]'), hasMoney:!!d.querySelector('[data-money]'),
    costInDet:!!(det&&det.querySelector('[data-cost]')),
    qtyInDet:!!(det&&det.querySelector('[data-qty]')),
    itemInDet:!!(det&&det.querySelector('[data-item]')),
    enInDet:!!(det&&det.querySelector('[data-ten]')),
    picInDet:!!(det&&det.querySelector('img')),
    btns:Array.from(d.querySelectorAll('[data-btns] button')).length };
});
let cc=await ccard();
console.log('   カード: '+cc.text);
ok(cc.open===false,'★出品CSVタブも初期は閉じている');
ok(cc.hasMoney&&cc.hasSold&&cc.btns>0,
   '★帯・相場の入力・行のボタンは初期表示に出す');
ok(!/ポリシー/.test(cc.text)&&!/しきい値/.test(cc.text),
   '★SKU・ポリシー・判定の内訳は初期表示に出さない');
ok(cc.costInDet&&cc.qtyInDet&&cc.itemInDet&&cc.enInDet&&cc.picInDet,
   '★仕入値・数量・ItemID・英題・写真は計算の詳細の中');
ok(/相場未確認/.test(cc.text)&&/基準：仕入値 ¥1,200（せどりすとCSV）/.test(cc.text),
   '★★「次にやること」と基準（どの仕入値で計算したか）を1行で出す');
await openRowDet(p);
cc=await ccard();
console.log('   詳細: '+cc.detText.slice(0,200));
ok(/game-20260101-UG-B0CRD10001-1200/.test(cc.detText)&&/ポリシー/.test(cc.detText),
   '★詳細にSKUとポリシーが出る');
let csvSaved=await p.evaluate(()=>localStorage.getItem('pj:det:v1')||'');
ok(/"csv":\{"c1":1\}/.test(csvSaved),'★出品CSVタブの行も別に覚える');
await p.evaluate(()=>{
  document.querySelector('#csvList [data-row="c1"] summary').click();
});
await p.waitForTimeout(150);
csvSaved=await p.evaluate(()=>localStorage.getItem('pj:det:v1')||'');
console.log('   保存: '+csvSaved.slice(0,140));
ok(!/"c1"/.test(csvSaved)&&/"sync"/.test(csvSaved),
   '★畳んだら控えから外す（販売連携タブのぶんは残る）');

console.log('\n=== 書き出しと計算は変えていない ===');
const keep=await p.evaluate(()=>{
  const r=csvRowById('c1');
  const o=csvRowFor(r);
  return { price:o['*StartPrice'], cost:csvCostOf(r), profit:r.profit,
    rows:csvExportSplit(null).rows.length };
});
console.log('   '+JSON.stringify(keep));
ok(keep.rows===1&&+keep.price>0,'★書き出す行と売値はそのまま');

console.log('\n=== 利益率が枠からはみ出さない（6.48・3）===');
const fit=await p.evaluate(async()=>{
  const out=[];
  for(const w of [320,360,390,414]){
    document.body.style.maxWidth=w+'px';
    document.body.style.width=w+'px';
    await new Promise(r=>requestAnimationFrame(()=>r()));
    const bar=document.querySelector('#csvList [data-money]');
    const cells=Array.from(bar.children).map(c=>{
      const main=c.children[1], sub=c.children[2];
      return { over:(main.scrollWidth>main.clientWidth+1)
                  ||(sub.scrollWidth>sub.clientWidth+1)
                  ||(main.scrollWidth>c.clientWidth+1),
               main:main.textContent, sub:sub.textContent,
               size:getComputedStyle(main).fontSize };
    });
    out.push({w:w,cells:cells});
  }
  document.body.style.maxWidth=''; document.body.style.width='';
  return out;
});
fit.forEach(x=>console.log('   '+x.w+'px: '
  +x.cells.map(c=>c.main+'['+c.size+']'+(c.over?'✖はみ出し':'')).join(' / ')));
ok(fit.every(x=>x.cells.every(c=>!c.over)),
   '★320・360・390・414px のどれでも、金額も利益率も枠の中に収まる');
ok(fit.every(x=>x.cells.every(c=>!/%/.test(c.main)))
   &&fit.every(x=>/利益率 \d+\.\d%/.test(x.cells[2].sub)),
   '★利益率は下の小さい行に出す（大きい数字の横に並べない）');

await T.done();
})();
