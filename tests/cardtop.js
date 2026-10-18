/* 出品CSVタブの行カードの並び替え（6.56）
   上から：日本語タイトル → 英題 → 写真 → 検索リンク＋検索語 →
   仕入値・売値・利益 → バッジ → 相場 → ボタン（写真・カテゴリ・原産国…）→ 計算の詳細
   ・原産国はカテゴリと同じプルダウンにして隣に並べる（未選択は「原産国：既定値」）
   ・仕入値の欄は無くし、「仕入値」の枠をタップしてその場で直す
   ・計算と書き出しの中身は変えない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('行カードの並び替え（出品CSV）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], answer=null;
p.on('dialog',async d=>{
  dlg.push(d.message());
  if(d.type()==='prompt'&&answer!==null)await d.accept(answer);
  else if(answer===null&&d.type()==='prompt')await d.dismiss();
  else await d.accept();
});

/* フィギュア（原産国を選べる）とゲーム（選べない）の2行。 */
const setup=async()=>await p.evaluate(()=>{
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8';
  $('csvShipProfile').value='W1000'; $('csvRetProfile').value='R';
  $('csvPayProfile').value='P'; $('csvLocation').value='Tokyo';
  $('csvOriginDefault').value='China';
  $('syncApi').value=''; $('syncKey').value='';
  csvList=[
   {id:'c1',src:'sedori',sku:'toy-20261017-UG-B0TOP00001-7980',
    asin:'B0TOP00001',jan:'4900001',titleJa:'SDX サタンガンダム',
    titleEn:'Used Bandai Spirits Mobile Suit Gundam Satan Gundam SDX Figure',
    cat:'261068',catFixed:true,condId:3000,condSrc:'良い',cost:7980,qty:1,weight:700,
    pics:[{url:'u1',key:'k1'},{url:'u2',key:'k2'}],descHtml:'<p>d</p>',
    specs:{origin:'China',originDefault:true},
    zeroAct:'hold',fba:true,oneOff:true,itemId:'',sold:'160',amzLow:'',dropship:false,
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false},
   {id:'c2',src:'sedori',sku:'game-20261017-UG-B0TOP00002-1200',
    asin:'B0TOP00002',jan:'4900002',titleJa:'テストゲーム',
    titleEn:'Used Nintendo Switch Test Game Japan Import',cat:'139973',catFixed:true,
    condId:5000,condSrc:'良い',cost:1200,qty:1,weight:150,pics:[],descHtml:'<p>d</p>',
    specs:{platform:'Nintendo Switch',gameName:'Test'},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',sold:'',amzLow:'',dropship:false,
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false}];
  csvPick={}; syncData=null;
  csvList.forEach(csvRecalc); csvSaveList();
  switchTab('D'); csvRender();
});
await setup();
await openCsvBoxes(p);

console.log('=== 並び順 ===');
const order=await p.evaluate(()=>{
  const d=document.querySelector('#csvList [data-row="c1"]');
  const kids=Array.from(d.children);
  const at=(sel)=>kids.findIndex(k=>(k.matches&&k.matches(sel))||k.querySelector(sel));
  return { head:at('.lhead'), en:at('[data-ten]'), pic:at('img'), kw:at('[data-kw]'),
           money:at('[data-money]'), badge:at('[data-badge]'), sold:at('[data-sold]'),
           btns:at('[data-btns]'), det:at('details[data-det]'),
           text:d.innerText.replace(/\n/g,' | ').slice(0,260) };
});
console.log('   '+JSON.stringify(order));
ok(order.head===0,'★日本語タイトルが一番上');
ok(order.en>order.head&&order.en<order.pic,
   '★★英題は日本語タイトルのすぐ下（写真より上）');
ok(order.pic>order.en&&order.pic<order.kw,'★★写真は英題の下・検索リンクの上');
ok(order.kw<order.money,'★★検索語は検索リンクと同じ並びで、帯より上');
ok(order.money<order.badge&&order.badge<order.sold&&order.sold<order.btns
   &&order.btns<order.det,
   '★★帯 → バッジ → 相場 → ボタン → 計算の詳細の順');
const same=await p.evaluate(()=>{
  const d=document.querySelector('#csvList [data-row="c1"]');
  const kids=Array.from(d.children);
  const i=kids.findIndex(k=>k.querySelector('[data-kw]'));
  const box=kids[i];
  return { links:!!box.querySelector('[data-links]'),
           kw:!!box.querySelector('[data-kw]'),
           label:box.innerText.replace(/\n/g,' ') };
});
console.log('   検索の列: '+same.label);
ok(same.links&&same.kw,'★★検索語は「元の名前で検索」と同じ列に入っている');

console.log('\n=== 原産国のプルダウン ===');
const org=await p.evaluate(()=>{
  const d=document.querySelector('#csvList [data-row="c1"]');
  const sel=d.querySelector('[data-origsel]');
  const btns=d.querySelector('[data-btns]');
  const kids=Array.from(btns.children);
  return { exists:!!sel, value:sel?sel.value:null,
    opts:sel?Array.from(sel.options).map(o=>o.textContent):[],
    nextToCat:kids.findIndex(k=>k.hasAttribute('data-origsel'))
             -kids.findIndex(k=>k.hasAttribute('data-cat')),
    oldBtns:Array.from(btns.querySelectorAll('[data-orig]')).length,
    badge:d.querySelector('[data-badge]').innerText,
    game:!!document.querySelector('#csvList [data-row="c2"] [data-origsel]') };
});
console.log('   '+JSON.stringify(org));
ok(org.exists&&org.oldBtns===0,'★★原産国はボタンでなくプルダウンにする');
ok(org.nextToCat===1,'★★カテゴリのプルダウンのすぐ隣に並べる');
ok(org.opts.length===5&&/China/.test(org.opts[1])&&/Japan/.test(org.opts[2])
   &&/Vietnam/.test(org.opts[3])&&/その他/.test(org.opts[4]),
   '★選択肢は China / Japan / Vietnam / その他');
ok(org.value===''&&/原産国：既定値/.test(org.opts[0]),
   '★★未選択のときは「原産国：既定値」と分かる');
ok(/原産国：既定値/.test(org.badge),'★黄色いバッジも今までどおり出す');
ok(org.game===false,'★ゲームの行には出さない（今までと同じ）');
const pick=async(v)=>await p.evaluate((v)=>{
  const sel=document.querySelector('#csvList [data-row="c1"] [data-origsel]');
  sel.value=v; sel.dispatchEvent(new Event('change',{bubbles:true}));
},v);
await pick('Japan');
await p.waitForTimeout(150);
let after=await p.evaluate(()=>{
  const r=csvRowById('c1');
  const d=document.querySelector('#csvList [data-row="c1"]');
  return { origin:(r.specs||{}).origin, def:!!(r.specs||{}).originDefault,
    manual:!!(r.specs||{}).originManual,
    value:d.querySelector('[data-origsel]').value,
    badge:d.querySelector('[data-badge]').innerText };
});
console.log('   '+JSON.stringify(after));
ok(after.origin==='Japan'&&after.def===false&&after.manual===true,
   '★★選ぶと原産国が確定する（手で決めた印も付く）');
ok(after.value==='Japan'&&!/原産国：既定値/.test(after.badge),
   '★確定したらバッジが消え、選んだ国が出たままになる');
answer='Taiwan';
await pick('*');
await p.waitForTimeout(150);
after=await p.evaluate(()=>{
  const r=csvRowById('c1');
  const sel=document.querySelector('#csvList [data-row="c1"] [data-origsel]');
  return { origin:(r.specs||{}).origin, value:sel.value,
    last:sel.options[sel.options.length-1].textContent };
});
console.log('   '+JSON.stringify(after));
ok(after.origin==='Taiwan'&&/Taiwan/.test(after.last),
   '★★「その他」は今までどおり入力して決める');
answer=null;
await pick('*');
await p.waitForTimeout(150);
after=await p.evaluate(()=>({origin:(csvRowById('c1').specs||{}).origin}));
ok(after.origin==='Taiwan','★入力をやめたら変えない');

console.log('\n=== 仕入値は枠をタップして直す ===');
let cost=await p.evaluate(()=>{
  const d=document.querySelector('#csvList [data-row="c1"]');
  return { input:!!d.querySelector('[data-cost]'),
    tap:!!d.querySelector('[data-costedit]'),
    label:d.querySelector('[data-money]').children[0].innerText.replace(/\n/g,' '),
    det:(d.querySelector('details[data-det] .detbody')||{}).innerText||'' };
});
console.log('   '+JSON.stringify(cost));
ok(cost.input===false,'★★「仕入値 [7980] 円」の欄は無くした');
ok(cost.tap&&/仕入値/.test(cost.label),'★「仕入値」の枠はタップで直せる印を出す');
ok(!/円/.test(cost.det)||!/7980/.test(cost.det),'★計算の詳細にも仕入値の欄は無い');
await p.click('#csvList [data-row="c1"] [data-costedit]');
await p.waitForTimeout(120);
cost=await p.evaluate(()=>{
  const d=document.querySelector('#csvList [data-row="c1"]');
  const i=d.querySelector('[data-cost]');
  return { shown:!!i, value:i?i.value:'',
    focus:document.activeElement===i,
    inBox:!!(d.querySelector('[data-costbox]')||{}).innerHTML };
});
console.log('   '+JSON.stringify(cost));
ok(cost.shown&&cost.value==='7980','★★タップするとその場で直せる欄が出る');
ok(cost.inBox,'★欄は帯の下（帯の中ではない）に出す');
await p.fill('#csvList [data-row="c1"] [data-cost]','5000');
await p.waitForTimeout(200);
const money=await p.evaluate(()=>{
  const d=document.querySelector('#csvList [data-row="c1"]');
  return { cost:csvCostOf(csvRowById('c1')),
    bar:d.querySelector('[data-money]').innerText.replace(/\n/g,' | '),
    still:!!d.querySelector('[data-cost]') };
});
console.log('   '+money.bar);
ok(money.cost===5000&&/5,000/.test(money.bar),
   '★★直すと帯の「仕入値」もその場で変わる');
ok(money.still,'★★打っている途中で欄が消えない');
await p.click('#csvList [data-row="c1"] [data-costedit]');
await p.waitForTimeout(120);
ok(await p.evaluate(()=>!document.querySelector('#csvList [data-row="c1"] [data-cost]')),
   '★もう一度タップすると閉じる');

console.log('\n=== 検索語を打ってもリンクが作り直されるだけ ===');
await p.click('#csvList [data-row="c1"] [data-kw]');
await p.type('#csvList [data-row="c1"] [data-kw]','X');
await p.waitForTimeout(200);
const kw=await p.evaluate(()=>{
  const d=document.querySelector('#csvList [data-row="c1"]');
  const i=d.querySelector('[data-kw]');
  return { kw:csvRowById('c1').mercKw, focus:document.activeElement===i,
    links:d.querySelectorAll('[data-links] a').length };
});
console.log('   '+JSON.stringify(kw));
ok(/X$/.test(kw.kw),'★打った検索語がその行に入る');
ok(kw.focus===true,'★★打っている途中で欄が消えない（リンクだけ作り直す）');
ok(kw.links>=3,'★検索リンクはそのまま出ている');

console.log('\n=== iPhone の幅（390px）ではみ出さない ===');
const fit=await p.evaluate(()=>{
  const d=document.querySelector('#csvList [data-row="c1"]');
  const over=[];
  Array.prototype.forEach.call(d.querySelectorAll('*'),function(el){
    if(el.getBoundingClientRect().right>window.innerWidth+1)
      over.push((el.tagName+'.'+(el.className||'')).slice(0,40));
  });
  return { page:document.documentElement.scrollWidth<=window.innerWidth,
    card:d.scrollWidth<=d.clientWidth+1, over:over.slice(0,5), w:window.innerWidth };
});
console.log('   '+JSON.stringify(fit));
ok(fit.page,'★★横スクロールが出ない（390px）');
ok(fit.card&&fit.over.length===0,'★★カードの中身もはみ出さない');

console.log('\n=== 作業者のキーでも隠すものは隠れたまま ===');
const staff=await p.evaluate(()=>{
  document.body.classList.add('staff');
  const v=(sel)=>{ const el=document.querySelector(sel);
    return el?el.getClientRects().length>0:null; };
  switchTab('D');
  return { card:v('#csvList [data-row="c1"]'),
    money:v('#csvList [data-row="c1"] [data-money]'),
    origin:v('#csvList [data-row="c1"] [data-origsel]'),
    revPrice:v('#csvRevisePrice'), cfgPrice:v('.cfgprice') };
});
console.log('   '+JSON.stringify(staff));
ok(staff.revPrice===false&&staff.cfgPrice===false,
   '★★作業者で隠している項目は、並べ替えても隠れたまま');
ok(staff.card===true&&staff.money===true&&staff.origin===true,
   '★今までどおり出ていたものは出る（カード・帯・原産国）');
await p.evaluate(()=>{ document.body.classList.remove('staff'); });

console.log('\n=== 書き出す中身は変えない ===');
const csv=await p.evaluate(()=>{
  const sp=csvExportSplit();
  const o=csvRowFor(csvRowById('c1'));
  return { n:sp.rows.length,
    title:o['*Title'], price:o['*StartPrice'],
    origin:o['C:Country of Origin'],
    spec:(csvRowById('c1').specs||{}).origin };
});
console.log('   '+JSON.stringify(csv));
ok(csv.n===1,'★書き出す行は今までどおり（写真が無い行は除外のまま）');
ok(/Satan Gundam/.test(csv.title||'')&&(+String(csv.price).replace(/[^0-9.]/g,''))>0,
   '★タイトルと売値は今までどおり入る');
ok(csv.spec==='Taiwan'&&csv.origin==='Taiwan',
   '★★原産国は選んだ値がそのまま書き出される（表示だけの変更）');

T.done();
})();
