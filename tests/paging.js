/* 一覧のページ分け（6.35・7.31）
   ・25／50／100件ずつ。初期値25件。タブごとに別に覚える（⚙設定にも同じ項目）
   ・上と下に「‹ 前へ 1 2 3 … 70 次へ ›」と「全 1,734件中 26〜50件目」
   ・2ページ目から先は押したときに初めて描く
   ・ページ内を全て選択。選択はページを移っても残り、操作は全ページの選択行に効く
   ・絞り込みを変えたら1ページ目に戻し、見えなくなった行の選択は外す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('一覧のページ分け');
const ok = T.ok;
(async()=>{
const p=await T.open();
const fs=require('fs');
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
const dl=[]; p.on('download',async d=>dl.push({name:d.suggestedFilename(),
  text:fs.readFileSync(await d.path(),'utf8')}));

const N=1734;
const setup=async()=>{
  await p.evaluate((N)=>{
    localStorage.removeItem('pj:ui:v1');
    $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
    $('csvPerPage').value='25'; $('csvPerPage2').value='25';
    $('syncPerPage').value='25'; $('syncPerPage2').value='25';
    $('amzFeeRate').value='15'; $('amzFbaFee').value='400';
    const it=(i)=>({asin:'B0PG'+String(100000+i).slice(-6),cond:'used',scope:'ebay',
      prefix:'game',ebay_sku:'E-x'+i,ebay_item_id:'9'+(100000+i),ebay_qty:1,
      ebay_price:50,one_off:0,dropship:0,restocking:0,mark_at:null,mark_stop:0,
      ebay_first:0,ebay_sold_at:null,cost_yen:2000,weight_g:200,
      // 10件に1件だけ警告あり（絞り込みの確認に使う）
      fba_available:1,fba_inbound:0,fba_reserved:0,
      warnings:(i%10===0)?['売り越しの恐れ']:[],notes:[],state:'ok'});
    const items=[]; for(let i=0;i<N;i++)items.push(it(i));
    syncData={at:new Date().toISOString(),counts:{},items:items};
    syncPick={}; syncPage=1;
    switchTab('E');
    if($('syncFilter').querySelector('option[value="all"]'))$('syncFilter').value='all';
    syncRender();
  },N);
  await p.waitForTimeout(100);
};
const bar=async()=>await p.evaluate(()=>({
  top:$('syncPagerTop').textContent.replace(/\s+/g,' ').trim(),
  bot:$('syncPagerBot').textContent.replace(/\s+/g,' ').trim(),
  cards:document.querySelectorAll('#syncList > div').length,
  label:$('syncPageAllLabel').textContent }));

console.log('=== 1,734件を25件ずつ ===');
await setup();
let b=await bar();
console.log('   '+b.top);
ok(b.cards===25,'★1ページに25件だけ描く');
ok(/全 1,734件中 1〜25件目（1\/70ページ）/.test(b.top),
   '★「全 1,734件中 1〜25件目（1/70ページ）」と出す');
ok(b.top===b.bot,'★一覧の上と下に同じものを出す');
ok(/‹ 前へ/.test(b.top)&&/次へ ›/.test(b.top)&&/…/.test(b.top),
   '★「‹ 前へ　1 2 … 70　次へ ›」の形');
ok(/このページを全て選択（25件）/.test(b.label),'★ページ内の件数を出す');
// 最後のページ
await p.click('#syncPagerTop button[data-spage="70"]');
await p.waitForTimeout(120);
b=await bar();
console.log('   '+b.top);
ok(b.cards===9,'★最後の70ページ目は9件（1734 − 69×25）');
ok(/全 1,734件中 1,726〜1,734件目（70\/70ページ）/.test(b.top),'★件数の出し方');
ok(await p.evaluate(()=>{
   const b=document.querySelector('#syncPagerTop button[data-spage="71"]');
   return !b||b.disabled; }),'★最後のページで「次へ」は進めない');

console.log('\n=== 2ページ目で「このページを全て選択」===');
await setup();
await p.click('#syncPagerTop button[data-spage="2"]');
await p.waitForTimeout(120);
const sel=await p.evaluate(()=>{
  $('syncPageAll').checked=true; $('syncPageAll').dispatchEvent(new Event('change'));
  return { n:Object.keys(syncPick).filter(k=>syncPick[k]).length,
    keys:Object.keys(syncPick).slice(0,2),
    checked:Array.from(document.querySelectorAll('#syncList input[data-spick]'))
      .filter(x=>x.checked).length,
    barN:$('syncBarN').textContent,
    page:$('syncPagerTop').textContent.replace(/\s+/g,' ').trim() };
});
console.log('   '+JSON.stringify(sel));
ok(sel.n===25&&sel.checked===25,'★そのページの25件だけが選ばれる');
ok(/26〜50件目/.test(sel.page),'★2ページ目にいる');
// 1ページ目に戻る
await p.click('#syncPagerTop button[data-spage="1"]');
await p.waitForTimeout(120);
const back=await p.evaluate(()=>({
  checked:Array.from(document.querySelectorAll('#syncList input[data-spick]'))
    .filter(x=>x.checked).length,
  n:Object.keys(syncPick).filter(k=>syncPick[k]).length,
  all:[$('syncPageAll').checked,$('syncPageAll').indeterminate],
  barN:$('syncBarN').textContent }));
console.log('   '+JSON.stringify(back));
ok(back.checked===0,'★1ページ目は未選択のまま（他のページは変えない）');
ok(back.n===25,'★選択の合計は25件のまま（ページを移っても残る）');
ok(back.all[0]===false&&back.all[1]===false,'★このページは0件なので「全て選択」は外れたまま');
ok(/選択 25件（他のページ 25件を含む）/.test(back.barN),
   '★操作バーに「（他のページ 25件を含む）」と出す');
// 一部だけ選ぶと「−」になる
const part=await p.evaluate(()=>{
  const cb=document.querySelector('#syncList input[data-spick]');
  cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true}));
  return { all:[$('syncPageAll').checked,$('syncPageAll').indeterminate],
    n:Object.keys(syncPick).filter(k=>syncPick[k]).length };
});
console.log('   '+JSON.stringify(part));
ok(part.all[1]===true&&part.all[0]===false,'★一部だけのときは「−」表示にする');
ok(part.n===26,'★選択は26件');

console.log('\n=== ページをまたいだ選択に操作が効く ===');
dlg.length=0; dl.length=0;
await openCsvBoxes(p);
await p.click('#syncFloorCsv'); await p.waitForTimeout(600);
console.log('   確認: '+(dlg[0]||'').split('\n')[0]);
const L=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   CSV: '+L.length+'行');
ok(/選んだ 26件のうち 26件を最低売値まで下げます/.test(dlg[0]||''),
   '★全ページの選択行（26件）が対象になる');
ok(L.length===28,'★26件ぶん書き出す（見出し2行＋26行）');

console.log('\n=== 絞り込みを変えると1ページ目に戻り、見えない行の選択が外れる ===');
await setup();
// 1ページ目には「3」が出ない（1 2 … 69 70）ので、2ページ目を経由する
await p.click('#syncPagerTop button[data-spage="2"]');
await p.waitForTimeout(120);
await p.click('#syncPagerTop button[data-spage="3"]');
await p.waitForTimeout(120);
await p.evaluate(()=>{
  $('syncPageAll').checked=true; $('syncPageAll').dispatchEvent(new Event('change'));
});
const before=await p.evaluate(()=>Object.keys(syncPick).filter(k=>syncPick[k]).length);
const filt=await p.evaluate(()=>{
  $('syncFilter').value='warn';
  $('syncFilter').dispatchEvent(new Event('change'));
  return { page:$('syncPagerTop').textContent.replace(/\s+/g,' ').trim(),
    n:Object.keys(syncPick).filter(k=>syncPick[k]).length,
    shown:document.querySelectorAll('#syncList > div').length };
});
console.log('   '+JSON.stringify(filt)+'（前の選択 '+before+'件）');
ok(before===25,'3ページ目で25件選んでいた');
ok(/1〜25件目/.test(filt.page),'★絞り込みを変えると1ページ目に戻る');
ok(filt.n<before,'★見えなくなった行の選択は外れる');
// 3ページ目（51〜75件目）のうち、警告がある行は3件だけ。それだけが残る
ok(filt.n===3,'★新しい絞り込みに当てはまる行の選択だけが残る');
// 今日やることのボタンでも1ページ目から
await p.evaluate(()=>{ $('syncFilter').value='all';
  $('syncFilter').dispatchEvent(new Event('change')); });
await p.click('#syncPagerTop button[data-spage="2"]');
await p.waitForTimeout(120);
await p.click('#syncPagerTop button[data-spage="3"]');
await p.waitForTimeout(120);
await p.click('#syncTodo button[data-todo="warn"]');
await p.waitForTimeout(150);
ok(/1〜25件目/.test((await bar()).top),
   '★「今日やること」で絞ったときも1ページ目から');

console.log('\n=== 件数は全件で数える（ページではない）===');
await setup();
const cnt=await p.evaluate(()=>({
  todo:Array.from(document.querySelectorAll('#syncTodo button'))
    .map(b=>b.textContent.replace(/\s+/g,' ')),
  filter:$('syncFilter').options[1].textContent }));
console.log('   '+JSON.stringify(cnt));
ok(/対応が必要174/.test(cnt.todo[0]),'★今日やることは全件で数える（174件）');
ok(/（174）/.test(cnt.filter),'★絞り込みの件数も全件');

console.log('\n=== 1ページの件数を変える（保存される）===');
const per=await p.evaluate(()=>{
  $('syncPerPage2').value='100';
  $('syncPerPage2').dispatchEvent(new Event('change'));
  return { cards:document.querySelectorAll('#syncList > div').length,
    cfg:$('syncPerPage').value,
    bar:$('syncPagerTop').textContent.replace(/\s+/g,' ').trim() };
});
console.log('   '+JSON.stringify(per));
ok(per.cards===100&&/1〜100件目（1\/18ページ）/.test(per.bar),
   '★100件ずつになる（18ページ）');
ok(per.cfg==='100','★⚙設定の項目も同じ値になる');
await p.reload(); await p.waitForTimeout(500);
const kept=await p.evaluate(()=>({ a:$('syncPerPage').value, b:$('syncPerPage2').value,
  c:$('csvPerPage').value }));
console.log('   開き直し: '+JSON.stringify(kept));
ok(kept.a==='100'&&kept.b==='100','★開き直しても100件ずつのまま');
ok(kept.c==='25','★出品CSVタブは別に覚える（25件のまま）');

console.log('\n=== 出品CSVタブの一覧も同じ ===');
await p.click('#tabD');
await p.evaluate(()=>{
  $('csvSort').value='add'; $('csvPerPage').value='25'; $('csvPerPage2').value='25';
  const row=(i)=>({id:'g'+i,src:'sedori',sku:'game-20260101-UG-B0GG'+String(100000+i).slice(-6)+'-1200',
    asin:'B0GG'+String(100000+i).slice(-6),jan:'49'+i,titleJa:'商品'+i,
    titleEn:'Used Nintendo Switch Item '+i+' Japan Import',cat:'139973',catFixed:true,
    condId:5000,condSrc:'良い',cost:1200,qty:1,weight:150,
    pics:[{url:'u'}],descHtml:'<p>d</p>',
    specs:{origin:'Japan',platform:'Nintendo Switch',gameName:'g'+i},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',sold:'',titleStatus:'',
    titleCands:[],titleNote:'',titleManual:false});
  csvList=[]; for(let i=0;i<60;i++)csvList.push(row(i));
  csvPick={}; csvPage=1; csvList.forEach(csvRecalc); csvSaveList(); csvRender();
  $('csvListBox').open=true;
});
await p.waitForTimeout(150);
const c1=await p.evaluate(()=>({
  cards:document.querySelectorAll('#csvList > div.lcard').length,
  bar:$('csvPagerTop').textContent.replace(/\s+/g,' ').trim(),
  label:$('csvPageAllLabel').textContent }));
console.log('   '+JSON.stringify(c1));
ok(c1.cards===25&&/全 60件中 1〜25件目（1\/3ページ）/.test(c1.bar),
   '★出品CSVの一覧も25件ずつ');
// ページ内を全て選択 → 書き出しは選択した全ページの行が対象
await p.evaluate(()=>{
  $('csvPageAll').checked=true; $('csvPageAll').dispatchEvent(new Event('change'));
});
await p.waitForTimeout(100);
await p.click('#csvPagerTop button[data-cpage="3"]');
await p.waitForTimeout(150);
const c2=await p.evaluate(()=>({
  n:csvPickIds().length, note:$('csvPickNote').textContent,
  btn:$('csvExportPick').textContent,
  cards:document.querySelectorAll('#csvList > div.lcard').length }));
console.log('   '+JSON.stringify(c2));
ok(c2.cards===10,'★3ページ目は10件');
ok(c2.n===25&&/（25件）/.test(c2.btn),'★選択はページを移っても残る');
ok(/他のページ 25件/.test(c2.note),'★「他のページ n件」と出す');
// 書き出しの中身はページ分けの影響を受けない
dlg.length=0; dl.length=0;
await p.click('#csvExportPick'); await p.waitForTimeout(700);
const ex=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   選択の書き出し: '+ex.length+'行');
ok(ex.length===2+25,'★選択した25件すべてを書き出す（ページに関係なく）');
dlg.length=0; dl.length=0;
await p.evaluate(()=>{ csvPick={}; csvRender(); });
await p.click('#csvExport'); await p.waitForTimeout(800);
const all=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   全件の書き出し: '+all.length+'行');
ok(all.length===2+60,'★全件の書き出しも60件のまま（ページ分けの影響を受けない）');
await T.done();
})();
