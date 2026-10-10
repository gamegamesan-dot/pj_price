/* 画面の整理（6.33）
   ・出品CSVタブ：①〜⑤の手順バー／毎日使うボタンだけ常に表示／
     対象があるときだけ出すボタン／その他に畳む／価格の操作は置かない
   ・設定は⚙の1か所。各タブは今の値を1行だけ出す
   ・畳んだ状態・開いた状態の保存
   ・整理しても書き出すCSVの中身と件数は変わらない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面の整理（出品CSVタブ）');
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
  csvList.forEach(r=>{ r.priceSent=r.price; r.fxSent=160; });
  csvSaveList(); csvRender();
});

console.log('=== 仕入れのたびの手順（①〜⑤）===');
await setup();
const st=await p.evaluate(()=>{
  const b=Array.from(document.querySelectorAll('#csvSteps button'));
  return { n:b.length, txt:b.map(x=>x.textContent.replace(/\s+/g,' ')),
    cls:b.map(x=>x.className), go:b.map(x=>x.getAttribute('data-step')),
    head:$('csvSteps').previousElementSibling.textContent };
});
console.log('   '+JSON.stringify(st.txt));
ok(st.n===5,'★手順は①〜⑤の5つ');
ok(/①取り込み/.test(st.head)&&/⑤結果ファイル/.test(st.head),
   '★画面の上に使い方の案内を出す');
ok(/①/.test(st.txt[0])&&/リスト 3件/.test(st.txt[0]),'★①に今の件数を出す');
ok(/書き出せる 1件/.test(st.txt[3]),'★④に書き出せる件数を出す');
ok(st.go.join()==='csvImportBox,csvGenAll,csvListBox,csvExport,csvResBox',
   '★押すとその場所へ移動する');
// 残りがある手順は目立たせる
const st2=await p.evaluate(()=>{
  csvRowById('p3').titleEn='';          // 英題なしを1件作る
  csvRowById('p3').pics=[];             // 写真なしも1件
  csvSaveList(); csvRender();
  const b=Array.from(document.querySelectorAll('#csvSteps button'));
  return { txt:b.map(x=>x.textContent.replace(/\s+/g,' ')), cls:b.map(x=>x.className) };
});
console.log('   '+JSON.stringify(st2.txt));
ok(/残り 1件/.test(st2.txt[1])&&st2.cls[1]==='todo','★残りがある手順は赤くする');
ok(/確認 1件/.test(st2.txt[2]),'★写真・原産国・カテゴリの残りも数える');
// 押すとその欄が開く
await setup();
await p.evaluate(()=>{ $('csvImportBox').open=false; });
await p.click('#csvSteps button[data-step="csvImportBox"]');
await p.waitForTimeout(150);
ok(await p.evaluate(()=>$('csvImportBox').open===true),'★押すと畳んである欄が開く');

console.log('\n=== いつも出すボタン ===');
await setup();
const vis=async(id)=>await p.isVisible('#'+id);
for(const id of ['csvExport','csvExportPick','csvGenAll','csvImportBox','csvResBox',
                 'csvListBox']){
  const v=await vis(id);
  console.log('   '+id+': '+v);
  ok(v,'★'+id+' は畳まずに出す');
}

console.log('\n=== 対象があるときだけ出すボタン ===');
let hot=await p.evaluate(()=>({
  rv:getComputedStyle($('csvRevive2')).display,
  ca:getComputedStyle($('csvCartAdd')).display }));
console.log('   '+JSON.stringify(hot));
ok(hot.rv==='none'&&hot.ca==='none','★対象が無いときは出さない');
hot=await p.evaluate(()=>{
  // 数量0で残っている出品を pj-sync 側に用意する（復活の対象）
  syncData={at:new Date().toISOString(),counts:{},items:[
    {asin:'B0CWGXZWNV',cond:'used',scope:'ebay',ebay_sku:'E-B0CWGXZWNV-U',
     ebay_item_id:'110333',ebay_qty:0,ebay_price:40,dropship:0,warnings:[],
     notes:[],state:'ok'}]};
  csvRender();
  const b=$('csvRevive2');
  return { show:getComputedStyle(b).display, label:b.textContent,
    hot:b.classList.contains('primary') };
});
console.log('   '+JSON.stringify(hot));
ok(hot.show!=='none'&&/（1件）/.test(hot.label)&&hot.hot,
   '★対象ができたら件数つきで出す');

console.log('\n=== その他に畳む ===');
await setup();
const more=await p.evaluate(()=>{
  const b=$('csvMoreBox');
  return { open:b.open,
    has:['csvTitleRedo','csvDropOn','csvDropOff','csvShipCsv','csvRevise',
         'csvTrashBox','csvClear'].every(id=>b.contains($(id))),
    last:(function(){ const all=Array.from(b.querySelectorAll('button'));
      return all[all.length-1].id; })() };
});
console.log('   '+JSON.stringify(more));
ok(more.open===false,'★「その他」は畳んである');
ok(more.has,'★英題を作り直す・無在庫・数量更新CSV・ゴミ箱・リストを空にする が入っている');
ok(more.last==='csvClear','★「リストを空にする」は一番下');
ok(!(await vis('csvRevise'))&&!(await vis('csvClear')),'★畳むと中は見えない');

console.log('\n=== 価格の操作は出品CSVタブに置かない ===');
const gone=await p.evaluate(()=>['csvPriceCsv','csvFloorCsv','csvMarkRun','csvMarkBar',
  'csvReviewBox','csvStockBox'].map(id=>id+':'+!!$(id)));
console.log('   '+JSON.stringify(gone));
ok(gone.every(x=>/:false$/.test(x)),
   '★価格更新CSV・最低売値・3日値下げのボタンは無い（販売連携タブにある）');
const inCfg=await p.evaluate(()=>{
  const c=$('tabCfg');
  return ['csvReviewAbs','csvReviewPct','csvMarkDays','csvMarkStep','csvPriceChangedOnly',
          'csvPackGame','syncWeight','baseProfit','fx','spFeeSale']
    .every(id=>c.contains($(id)));
});
ok(inCfg,'★しきい値・値下げの間隔などの設定は⚙設定にある');
const inTab=await p.evaluate(()=>{
  const d=$('tabCsv');
  return ['csvPackGame','csvDispatch','csvShipProfile','csvTitleApi']
    .some(id=>d.contains($(id)));
});
ok(!inTab,'★出品CSVタブには設定欄を置かない');
ok(/梱包マージン/.test(await p.textContent('#cfgLineCsv')),
   '★いまの値は1行だけ出す');

console.log('\n=== 畳んだ状態でも書き出しの中身は変わらない ===');
await setup();
dlg.length=0; dl.length=0;
await openCsvBoxes(p);
await p.click('#csvRevise'); await p.waitForTimeout(500);
const qOpen=((dl[0]||{}).text||'').trim();
console.log('   開いた状態: '+JSON.stringify(qOpen.split(/\r\n/)));
await setup();
dlg.length=0; dl.length=0;
await p.evaluate(()=>{ $('csvMoreBox').open=false; $('csvRevise').click(); });
await p.waitForTimeout(500);
const qClosed=((dl[0]||{}).text||'').trim();
console.log('   畳んだ状態: '+(qOpen===qClosed));
ok(qOpen===qClosed&&qOpen.split(/\r\n/).length===4,
   '★数量更新CSVは畳んでいても同じ（3件・同じ中身）');
// 書き出し（カテゴリごと）も同じ
await setup();
dlg.length=0; dl.length=0;
await p.click('#csvExport'); await p.waitForTimeout(600);
const ex=((dl[0]||{}).text||'').trim();
console.log('   書き出し: '+ex.split(/\r\n/).length+'行 / '+(dl[0]||{}).name);
ok(ex.split(/\r\n/).length===3&&/B0CWGXZWNV/.test(ex),
   '★CSVの書き出しも中身と件数はそのまま（未出品の1件）');

console.log('\n=== 開いた・畳んだ状態は端末に保存する ===');
await p.evaluate(()=>{
  $('csvMoreBox').open=true; $('csvMoreBox').dispatchEvent(new Event('toggle'));
});
await p.waitForTimeout(150);
const ui=await p.evaluate(()=>JSON.parse(localStorage.getItem('pj:ui:v1')||'{}'));
console.log('   '+JSON.stringify(ui));
ok(ui.csvMore===true,'★開いた状態を保存する');
await p.reload(); await p.waitForTimeout(500); await p.click('#tabD');
ok(await p.evaluate(()=>$('csvMoreBox').open)===true,'★開き直しても開いたまま');
await p.evaluate(()=>{
  $('csvMoreBox').open=false; $('csvMoreBox').dispatchEvent(new Event('toggle'));
});
await p.waitForTimeout(150);
await p.reload(); await p.waitForTimeout(500); await p.click('#tabD');
ok(await p.evaluate(()=>$('csvMoreBox').open)===false,'★畳んだ状態も残る');
await T.done();
})();
