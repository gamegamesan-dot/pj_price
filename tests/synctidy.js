/* 画面の整理（6.33・7.29）販売連携タブと⚙設定
   ・一番上は「状況を取り込む」と「今日やること」
   ・件数の説明文は「詳しい数字」に畳む
   ・名簿を送る／手元在庫の印／無在庫は「その他」へ
   ・結果ファイルを取り込んだら名簿を自動で送る
   ・行を選んだときだけ画面の下に操作バー
   ・再調達CSVは絞り込みが「再調達の候補」のときだけ
   ・使わないタブを隠す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面の整理（販売連携タブ・⚙設定）');
const ok = T.ok;
(async()=>{
const p=await T.open();
const fs=require('fs');
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
const dl=[]; p.on('download',async d=>dl.push({name:d.suggestedFilename(),
  text:fs.readFileSync(await d.path(),'utf8')}));

const DAY=86400000;
const setup=async()=>{
  await p.evaluate((DAY)=>{
    localStorage.removeItem('pj:ui:v1');
    $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
    $('csvMarkDays').value='3'; $('csvMarkStep').value='1';
    $('uiHideShopee').checked=false; $('uiHideEbay').checked=false; uiTabsApply();
    // 既定は「1日前に値下げ済み」（＝いまは値下げの時期ではない）
    const ago=new Date(Date.now()-1*DAY).toISOString();
    const it=(asin,o)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
      ebay_sku:'E-'+asin+'-U',ebay_item_id:'11'+asin.slice(-4),ebay_qty:1,ebay_price:60,
      one_off:0,dropship:0,restocking:0,mark_at:ago,mark_stop:0,ebay_sold_at:null,
      cost_yen:2000,weight_g:200,fba_available:1,fba_inbound:0,fba_reserved:0,
      warnings:[],notes:[],state:'ok'},o||{});
    syncData={at:new Date().toISOString(),
      counts:{listed:4,listed_no_fba:1,fba_not_listed:0,on_hand:1,past_zero:7},
      items:[
        // 警告あり（対応が必要）＋再調達の候補
        it('B0TIDY0001',{fba_available:0,warnings:['売り越しの恐れ']}),
        it('B0TIDY0002'),
        // 手元在庫（FBA納品の判断）
        it('B0TIDY0003',{on_hand:1,fba_seen_at:null,fba_available:null}),
        it('B0TIDY0004')]};
    syncPick={}; csvList=[]; csvSaveList();
    switchTab('E');
    if($('syncFilter').querySelector('option[value="all"]'))$('syncFilter').value='all';
    syncRender();
  },DAY);
  await p.waitForTimeout(120);
};

console.log('=== 今日やること ===');
await setup();
const todo=await p.evaluate(()=>{
  const b=Array.from(document.querySelectorAll('#syncTodo button'));
  const f=(v)=>{ const ff=syncFilterBy(v).f;
    return syncData.items.filter(ff).length; };
  return { n:b.length, txt:b.map(x=>x.textContent.replace(/\s+/g,' ')),
    cls:b.map(x=>x.className),
    same:['warn','markdown','restock','on_hand'].map(v=>v+':'+f(v)),
    head:$('syncTodo').previousElementSibling.textContent.replace(/\s+/g,' ') };
});
console.log('   '+JSON.stringify(todo.txt)+' / '+JSON.stringify(todo.same));
ok(todo.n===4,'★対応が必要・値下げの時期・再調達の候補・FBA納品の判断 の4つ');
ok(/毎日/.test(todo.head)&&/3日ごと/.test(todo.head)&&/ときどき/.test(todo.head),
   '★画面の上に使い方の案内を出す');
ok(todo.txt[0]==='対応が必要1'&&todo.txt[2]==='再調達の候補1',
   '★絞り込みと同じ件数を出す');
ok(todo.cls[1].indexOf('zero')>=0,'★0件の項目は薄く出す');
ok(todo.cls[0].indexOf('hit')>=0,'★1件以上ある項目は目立たせる');
// 押すとその絞り込みになる
await p.click('#syncTodo button[data-todo="restock"]');
await p.waitForTimeout(150);
const picked=await p.evaluate(()=>({ v:$('syncFilter').value,
  shown:$('syncList').textContent.indexOf('B0TIDY0001')>=0,
  on:document.querySelector('#syncTodo button[data-todo="restock"]').className }));
console.log('   '+JSON.stringify(picked));
ok(picked.v==='restock'&&picked.shown,'★押すとその絞り込みになる');
ok(/on/.test(picked.on),'★いま見ている項目が分かる');

console.log('\n=== 件数の説明文は「詳しい数字」に畳む ===');
const num=await p.evaluate(()=>({ open:$('syncNumBox').open,
  has:$('syncNumBox').contains($('syncSummary')),
  txt:$('syncSummary').textContent }));
console.log('   '+JSON.stringify({open:num.open,has:num.has})
  +' / '+num.txt.slice(0,40));
ok(num.open===false&&num.has,'★「eBayに出ている…過去SKU…」は畳んである');
ok(/過去SKU 7件/.test(num.txt),'★中身はこれまでどおり');

console.log('\n=== その他に畳む ===');
const more=await p.evaluate(()=>{
  const b=$('syncMoreBox');
  return { open:b.open,
    has:['syncPush','syncOnHandFix','syncDropOn','syncDropOff'].every(id=>b.contains($(id))),
    note:$('syncPushNote').textContent };
});
console.log('   '+JSON.stringify(more));
ok(more.open===false&&more.has,
   '★名簿を送る・手元在庫の印・無在庫オン／オフ は「その他」の中');
ok(/自動で送ります/.test(more.note),'★名簿は自動で送ると書いてある');
ok(!(await p.isVisible('#syncPush')),'★畳むと見えない');

console.log('\n=== 価格の操作は1つの欄にまとまっている ===');
const price=await p.evaluate(()=>{
  const b=$('syncPriceBox');
  return { open:b.open, sum:$('syncPriceSum').textContent,
    has:['syncPriceCsv','syncFloorCsv','syncMarkRun'].every(id=>b.contains($(id))) };
});
console.log('   '+JSON.stringify(price));
ok(price.has,'★売値の見直し・最低売値・3日値下げ が1つの欄に入っている');
ok(price.open===false&&price.sum==='価格の操作',
   '★値下げの時期が来ていなければ畳んだまま');
const due=await p.evaluate(()=>{
  syncData.items[1].mark_at=null;      // 一度も値下げしていない＝今日が値下げの日
  syncRender();
  return { open:$('syncPriceBox').open, sum:$('syncPriceSum').textContent };
});
console.log('   '+JSON.stringify(due));
ok(due.open===true&&/値下げの時期 \d+件/.test(due.sum),
   '★値下げの時期が来ていれば自動で開く');

console.log('\n=== 行を選んだときだけ出る操作バー ===');
await setup();
let bar=await p.evaluate(()=>getComputedStyle($('syncBar')).display);
ok(bar==='none','★選んでいなければ出さない');
await p.evaluate(()=>{
  const cb=document.querySelector('#syncList input[data-spick]');
  cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true}));
});
await p.waitForTimeout(120);
bar=await p.evaluate(()=>({ show:getComputedStyle($('syncBar')).display,
  n:$('syncBarN').textContent,
  btn:Array.from(document.querySelectorAll('#syncBar > div:nth-child(2) button'))
    .map(b=>b.textContent),
  restock:$('syncBarRestock').style.display }));
console.log('   '+JSON.stringify(bar));
ok(bar.show!=='none'&&/選択 1件/.test(bar.n),'★選ぶと画面の下に出る');
ok(bar.btn.join('|')==='見直し価格にする|最低売値まで下げる|印を付ける ▾|選択解除',
   '★バーは4つ（見直し価格・最低売値・印を付ける・選択解除）');
ok(bar.restock==='none','★再調達CSVは「再調達の候補」を見ているときだけ');
const rst=await p.evaluate(()=>{
  $('syncBarMarkBtn').click();            // 印の欄を開く（再調達CSVはこの中）
  $('syncFilter').value='restock'; syncRender();
  const cb=document.querySelector('#syncList input[data-spick]');
  cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true}));
  return { bar:$('syncBarRestock').style.display,
    box:getComputedStyle($('syncRestockBox')).display };
});
console.log('   '+JSON.stringify(rst));
ok(rst.bar!=='none'&&rst.box==='block',
   '★「再調達の候補」のときだけ再調達CSVを出す');
// 選択解除
await p.click('#syncBarClear'); await p.waitForTimeout(150);
ok(await p.evaluate(()=>getComputedStyle($('syncBar')).display)==='none',
   '★選択解除で消える');

console.log('\n=== 結果ファイルを取り込むと名簿を自動で送る ===');
await setup();
const push=await p.evaluate(async()=>{
  const sent=[];
  const real=window.fetch;
  window.fetch=function(u,i){
    sent.push(String(u));
    return Promise.resolve({ok:true,status:200,
      json:()=>Promise.resolve({accepted:1,rejected:0})});
  };
  $('syncApi').value='https://x.example'; $('syncKey').value='k';
  csvList=[{id:'t1',src:'sedori',sku:'game-20260101-UG-B0TIDY0002-1200',
    asin:'B0TIDY0002',titleJa:'商品t1',cat:'139973',catFixed:true,condId:5000,
    condSrc:'良い',cost:1200,qty:1,weight:150,pics:[{url:'u'}],zeroAct:'hold',
    specs:{},itemId:''}];
  csvSaveList(); csvRender();
  // 結果ファイル（Success・ItemID つき）を取り込む
  const text='Line Number,Action,Status,ItemID,CustomLabel\n'
    +'1,Add,Success,220001,E-B0TIDY0002-U\n';
  const r=csvResImport(text);
  csvRender();
  if(r.ok&&syncUrl()&&syncApiKey())syncPushRun(function(){},true);
  await new Promise(function(f){ setTimeout(f,300); });
  window.fetch=real;
  return { ok:r.ok, itemId:csvList[0].itemId, sent:sent };
});
console.log('   '+JSON.stringify(push));
ok(push.ok===1&&push.itemId==='220001','結果ファイルの ItemID が入る');
ok(push.sent.some(u=>/\/listings$/.test(u)),
   '★取り込んだら名簿（価格の元データつき）を自動で送る');

console.log('\n=== 使わないタブを隠す ===');
await setup();
const hide=await p.evaluate(()=>{
  switchTab('G');
  $('uiHideShopee').checked=true;
  $('uiHideShopee').dispatchEvent(new Event('change'));
  return { tab:getComputedStyle($('tabC')).display,
    cfg:getComputedStyle($('cfgBoxSp')).display };
});
console.log('   '+JSON.stringify(hide));
ok(hide.tab==='none','★Shopeeタブが消える');
ok(hide.cfg==='none','★設定画面からも Shopee の設定が消える');
await p.reload(); await p.waitForTimeout(500);
const kept=await p.evaluate(()=>({ chk:$('uiHideShopee').checked,
  tab:getComputedStyle($('tabC')).display }));
console.log('   開き直し: '+JSON.stringify(kept));
ok(kept.chk===true&&kept.tab==='none','★開き直しても隠れたまま');
const back=await p.evaluate(()=>{
  switchTab('G');
  $('uiHideShopee').checked=false;
  $('uiHideShopee').dispatchEvent(new Event('change'));
  return getComputedStyle($('tabC')).display;
});
ok(back!=='none','★戻せる（中身は消えていない）');
await T.done();
})();
