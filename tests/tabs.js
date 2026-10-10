/* タブの並びと、eBayタブの中の「値付け｜出品文」の切り替え（6.26）
   ・並びは 出品CSV ― 販売連携 ― eBay ― Shopee。開いたときは出品CSV
   ・出品文は eBay タブの中に入れた（タブは4つ＋⚙設定）
   ・出品CSVの行の「出品文を作る」→ eBay タブの出品文側 →「書き戻す」の往復
   ・各タブの設定が混ざらないこと */
const { harness } = require('./lib');
const T = harness('タブの並びと eBay タブの中の切り替え');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.waitForTimeout(400);

console.log('=== 並びと初期表示 ===');
const bar=await p.$$eval('.tabbar .tabs button',bs=>bs.map(b=>b.id+':'+b.textContent
  +':'+b.getAttribute('aria-pressed')));
console.log('   '+JSON.stringify(bar));
ok(bar.length===5,'★タブは4つ＋⚙設定（出品文は eBay の中に入れた）');
ok(bar.map(x=>x.split(':')[1]).join('|')==='出品CSV|販売連携|eBay|Shopee|⚙',
   '★並びは 出品CSV ― 販売連携 ― eBay ― Shopee ― ⚙設定');
ok(bar[0].indexOf(':true')>0&&bar.slice(1).every(x=>x.indexOf(':false')>0),
   '★開いたときは「出品CSV」が選ばれている');
const vis=()=>p.evaluate(()=>{
  const d=(id)=>{ const el=$(id); return el?getComputedStyle(el).display:'なし'; };
  return { csv:d('tabCsv'), sync:d('tabSync'), price:d('tabPricing'),
    list:d('tabListing'), shopee:d('tabShopee'), sub:d('ebSubBar'),
    item:d('itemBox'),
    sel:['tabD','tabE','tabA','tabC'].filter(x=>$(x)
      &&$(x).getAttribute('aria-pressed')==='true').join(),
    subSel:['ebSubPrice','ebSubList'].filter(x=>
      $(x).getAttribute('aria-pressed')==='true').join() };
});
let v=await vis();
console.log('   '+JSON.stringify(v));
ok(v.csv!=='none'&&v.price==='none'&&v.list==='none'&&v.shopee==='none'
   &&v.sync==='none','★出品CSVの中身だけが出ている');
ok(v.sub==='none','★eBayタブの中の切り替えは、ほかのタブでは出さない');
ok(v.item==='none','出品CSVでは計算機の「商品」欄を隠す（これまでどおり）');
ok(!(await p.evaluate(()=>!!document.getElementById('tabB'))),
   '★「出品文」タブのボタンは無くなった');

console.log('\n=== eBayタブ：値付けと出品文を切り替える ===');
await p.click('#tabA'); await p.waitForTimeout(200);
v=await vis();
console.log('   eBayを開く: '+JSON.stringify(v));
ok(v.price!=='none'&&v.list==='none','★eBayタブは「値付け」から始まる');
ok(v.sub!=='none'&&v.subSel==='ebSubPrice','★中の切り替えが出て「値付け」が選ばれる');
ok(v.item!=='none','★「商品」欄（仕入値・重量）はどちらの側でも使うので出す');
ok(v.sel==='tabA','タブは eBay が選ばれている');
await p.click('#ebSubList'); await p.waitForTimeout(200);
v=await vis();
console.log('   出品文へ: '+JSON.stringify(v));
ok(v.list!=='none'&&v.price==='none','★「出品文」に切り替わる');
ok(v.subSel==='ebSubList'&&v.sel==='tabA','★タブは eBay のまま（中だけ入れ替わる）');
await p.click('#ebSubPrice'); await p.waitForTimeout(200);
v=await vis();
ok(v.price!=='none'&&v.list==='none','★「値付け」に戻せる');
// ほかのタブへ行って帰ってくると、最後に見ていた側で開く
await p.click('#ebSubList'); await p.waitForTimeout(150);
await p.click('#tabD'); await p.waitForTimeout(150);
await p.click('#tabA'); await p.waitForTimeout(200);
v=await vis();
console.log('   戻ってきたとき: '+JSON.stringify({list:v.list,subSel:v.subSel}));
ok(v.list!=='none'&&v.subSel==='ebSubList',
   '★ほかのタブから戻ると、最後に見ていた側（出品文）で開く');

console.log('\n=== 値付けで決めた値が出品文側で使われる ===');
const share=await p.evaluate(()=>{
  switchTab('A');
  $('cost').value='3000'; $('cost').dispatchEvent(new Event('input'));
  $('weight').value='250'; $('weight').dispatchEvent(new Event('input'));
  const price=$('bigVal').textContent;
  switchTab('B');
  buildListing();
  return { cost:$('cost').value, weight:$('weight').value, price:price,
    desc:($('descPreview').innerHTML||'').length };
});
console.log('   '+JSON.stringify(share));
ok(share.cost==='3000'&&share.weight==='250',
   '★「商品」欄は共通なので、出品文側でもそのまま引き継ぐ');
ok(share.desc>0,'出品文が作られている');

console.log('\n=== 出品CSVの「出品文を作る」→「書き戻す」の往復 ===');
await p.click('#tabD'); await p.waitForTimeout(200);
await p.evaluate(()=>{
  $('csvSort').value='add';
  csvList=[{id:'t1',src:'sedori',sku:'hobby-20260101-UG-B07571RH4P-1200',
    asin:'B07571RH4P',jan:'4901234567890',titleJa:'ねんどろいど 初音ミク',
    titleEn:'',cat:'261068',catDone:true,condId:3000,condSrc:'良い',cost:1200,qty:1,
    weight:300,pics:[{url:'u'}],descHtml:'',specs:{origin:'China',brand:'Good Smile Company'},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',titleStatus:'',titleCands:[],
    titleNote:'',titleManual:false}];
  csvPick={}; csvSaveList(); csvRender(); $('csvListBox').open=true;
});
await p.click('#csvList button[data-edit="t1"]');
await p.waitForTimeout(400);
v=await vis();
const bar2=await p.evaluate(()=>({edit:getComputedStyle($('csvEditBar')).display,
  title:$('csvEditTitle').textContent}));
console.log('   '+JSON.stringify(v)+' '+JSON.stringify(bar2));
ok(v.sel==='tabA'&&v.subSel==='ebSubList'&&v.list!=='none',
   '★eBayタブの「出品文」側が開く');
ok(bar2.edit!=='none'&&/初音ミク/.test(bar2.title),
   '★「出品リストの行を編集中」のバーに、その行が出る');
await p.evaluate(()=>{ $('title').value='Nendoroid Hatsune Miku Japan';
  $('title').dispatchEvent(new Event('input')); });
await p.click('#csvEditSave'); await p.waitForTimeout(400);
const back=await p.evaluate(()=>{
  const r=csvRowById('t1');
  return { titleEn:r.titleEn, desc:(r.descHtml||'').length, cat:r.cat,
    note:$('csvEditNote').textContent };
});
console.log('   '+JSON.stringify(back));
ok(back.titleEn==='Nendoroid Hatsune Miku Japan','★英題が行に書き戻される');
ok(back.desc>0&&back.cat==='261068','★出品文も行に入り、カテゴリは変わらない');
ok(/書き戻しました/.test(back.note),'書き戻したと知らせる');
await p.click('#tabD'); await p.waitForTimeout(300);
const card=await p.evaluate(()=>({
  text:$('csvList').innerText||'',
  // 英題は textarea の中なので innerText には出ない
  ten:(document.querySelector('#csvList textarea[data-ten="t1"]')||{}).value||''}));
console.log('   一覧: '+card.ten+' / '+card.text.replace(/\n/g,' | ').slice(0,80));
ok(card.ten==='Nendoroid Hatsune Miku Japan','★出品CSVの一覧（英題欄）にも出る');
ok(/編集済み/.test(card.text),'★手で直した行として出る');

console.log('\n=== 設定は⚙の1か所にまとまっている ===');
const cfg=await p.evaluate(()=>{
  switchTab('G');
  $('baseProfit').value='2800'; $('baseProfit').dispatchEvent(new Event('input'));
  $('csvPackGame').value='33'; $('csvPackGame').dispatchEvent(new Event('input'));
  csvSaveCfg();
  const r={ cfgShown:getComputedStyle($('tabCfg')).display,
    // 設定の欄が各タブに残っていないこと（⚙を閉じると見えない）
    has:['baseProfit','csvPackGame','syncWeight','csvReviewAbs','spFeeSale']
      .every(id=>!!$(id)) };
  switchTab('D');
  r.csvShown=getComputedStyle($('tabCfg')).display;
  r.line=$('cfgLineCsv').textContent;
  switchTab('A');
  return r;
});
console.log('   '+JSON.stringify(cfg));
ok(cfg.cfgShown==='block'&&cfg.has,'★⚙設定にすべての設定がある');
ok(cfg.csvShown==='none','★ほかのタブでは設定画面を出さない');
ok(/梱包マージン ゲーム33g/.test(cfg.line),'★各タブにはいまの値を1行だけ出す');
await p.reload(); await p.waitForTimeout(500);
const kept=await p.evaluate(()=>({base:$('baseProfit').value,pack:$('csvPackGame').value,
  tab:['tabD','tabE','tabA','tabC','tabG'].filter(x=>$(x)
    &&$(x).getAttribute('aria-pressed')==='true').join()}));
console.log('   開き直し: '+JSON.stringify(kept));
ok(kept.base==='2800','★詳細設定は残る（v118 の保存）');
ok(kept.pack==='33','★出品CSVタブの設定も残る');
ok(kept.tab==='tabD','★開き直すとまた「出品CSV」から始まる');

console.log('\n=== フッターの版・更新の帯 ===');
const ver=await p.evaluate(()=>({foot:$('appVer').textContent,
  bar:!!document.getElementById('appVerBar')}));
console.log('   '+JSON.stringify(ver));
ok(/v\d+/.test(ver.foot),'★フッターに版が出る');
ok(ver.bar===false,'版がそろっているので更新の帯は出ない');
await T.done();
})();
