/* 値下げ・価格更新CSVのエラー対策（6.37・7.34）
   ・ベストオファーの金額（自動拒否・自動承諾）を値段と一緒に出す
   ・結果ファイルの Failure は値下げの記録を戻し、理由を出す
   ・写真が500px未満の行は書き出し前に知らせる */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('値段を変えるCSVのエラー対策');
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
    $('fx').value='160'; $('baseProfit').value='650'; $('linkRate').value='30';
    $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
    $('amzFeeRate').value='15'; $('amzFbaFee').value='400';
    $('csvMarkDays').value='3'; $('csvMarkStep').value='1';
    $('csvBoCols').checked=true;
    $('syncApi').value=''; $('syncKey').value='';
    const ago=new Date(Date.now()-4*DAY).toISOString();
    const it=(asin,o)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
      ebay_sku:'E-'+asin+'-U',ebay_item_id:'96'+asin.slice(-6),ebay_qty:1,
      ebay_price:22.96,one_off:0,dropship:0,restocking:0,mark_at:ago,mark_stop:0,
      ebay_first:0,ebay_sold_at:null,cost_yen:1000,weight_g:150,
      amazon_lowest:null,amazon_offers_json:'[]',
      fba_available:1,fba_inbound:0,fba_reserved:0,
      ebay_bo:1,ebay_bo_accept:null,ebay_bo_decline:22.96,
      revise_err:null,warnings:[],notes:[],state:'ok'},o||{});
    syncData={at:new Date().toISOString(),counts:{},items:[
      // ① ベストオファーあり・自動拒否 $22.96（＝いまの売値）
      it('B0BO000001'),
      // ② ベストオファーを使っていない
      it('B0BO000002',{ebay_bo:0,ebay_bo_decline:null}),
      // ③ 自動承諾が新しい売値以上
      it('B0BO000003',{ebay_bo:1,ebay_bo_accept:22.50,ebay_bo_decline:10})]};
    csvList=[]; csvSaveList(); syncPick={}; syncSent={};
    switchTab('E'); syncRender();
  },DAY);
  await openCsvBoxes(p);
};

console.log('=== 値下げCSVにベストオファーの金額を出す ===');
await setup();
const info=await p.evaluate(()=>({
  rows:syncMarkRows().length,
  next:syncData.items.map(r=>syncMarkNext(r)),
  floor:syncData.items.map(r=>syncFloorOf(r).v) }));
console.log('   '+JSON.stringify(info));
dlg.length=0; dl.length=0;
await p.click('#syncMarkRun'); await p.waitForTimeout(600);
const L=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   '+JSON.stringify(L));
const cols=L[1].split(',');
ok(cols[0].indexOf('*Action')===0&&cols[1]==='ItemID'&&cols[2]==='*StartPrice',
   '★これまでの3列はそのまま（順番も）');
ok(cols[3]==='MinimumBestOfferPrice'&&cols[4]==='BestOfferAutoAcceptPrice',
   '★自動拒否額・自動承諾額の列を足す');
// ① 自動拒否は最低売値、ただし新しい売値以上なら 売値−$0.01
const c1=L[2].split(','), c2=L[3].split(','), c3=L[4].split(',');
console.log('   ①'+JSON.stringify(c1)+' ②'+JSON.stringify(c2)+' ③'+JSON.stringify(c3));
const fl=info.floor[0], nx=info.next[0];
ok(+c1[2]===nx,'★新しい売値は $1 下げた値');
ok(+c1[3]===((fl<nx-0.01)?fl:Math.round((nx-0.01)*100)/100),
   '★自動拒否額は最低売値（売値以上になるときは 売値 − $0.01）');
ok(+c1[3]<+c1[2],'★自動拒否額は必ず新しい売値より下（22003 を避ける）');
ok(c2[3]===''&&c2[4]==='','★ベストオファーを使っていない出品は空のまま');
ok(+c3[4]===Math.round((+c3[2]-0.01)*100)/100,
   '★自動承諾が新しい売値以上の行は 売値 − $0.01 に下げる');
ok(c1[4]==='','★自動承諾が分からない行は空のまま（変えない）');
// 設定で止められる
const off=await p.evaluate(()=>{
  $('csvBoCols').checked=false; $('csvBoCols').dispatchEvent(new Event('change'));
  const r=syncData.items[0];
  r.mark_at=new Date(Date.now()-4*86400000).toISOString(); syncRender();
  return syncPriceCsvText([{id:r.ebay_item_id,price:21.96,r:r}]).text.split(/\r\n/)[1];
});
console.log('   列を出さない設定: '+off);
ok(off.split(',').length===3,'★設定を外せば、これまでの3列に戻せる');
await p.evaluate(()=>{ $('csvBoCols').checked=true;
  $('csvBoCols').dispatchEvent(new Event('change')); });

console.log('\n=== 結果ファイルの Failure は記録を戻す ===');
await setup();
const before=await p.evaluate(()=>syncData.items.map(r=>String(r.mark_at||'')));
dlg.length=0; dl.length=0;
await p.click('#syncMarkRun'); await p.waitForTimeout(600);
const mid=await p.evaluate(()=>({
  marks:syncData.items.map(r=>String(r.mark_at||'')),
  sent:Object.keys(syncSent).length }));
console.log('   書き出し後: '+JSON.stringify(mid.sent)+'件を控えた');
ok(mid.sent===3,'★書き出した内容を控える');
ok(mid.marks[0]!==before[0],'値下げの記録はいったん進む');
// 1件目は写真エラーで失敗、2件目は成功
const res=await p.evaluate(()=>{
  const id1=syncData.items[0].ebay_item_id, id2=syncData.items[1].ebay_item_id;
  const text='Line Number,Action,Status,ItemID,Error Code,Error Message\n'
    +'2,Revise,Failure,'+id1+',21919137,Picture is smaller than 500 pixels on the longest side\n'
    +'3,Revise,Success,'+id2+',,\n';
  const r=csvResImport(text);
  return { r:r, marks:syncData.items.map(x=>String(x.mark_at||'')),
    err:syncData.items.map(x=>String(x.revise_err||'')),
    alert:syncData.items.map(x=>syncReviseAlert(x)),
    sent:Object.keys(syncSent).length };
});
console.log('   '+JSON.stringify(res.r));
console.log('   '+JSON.stringify({marks:res.marks.map(x=>x.slice(0,10)),err:res.err}));
ok(res.r.rev===2&&res.r.revNg===1,'★値段の更新の結果として数える');
ok(res.marks[0]===before[0],'★失敗した行は値下げの記録を書き出す前に戻す');
ok(res.marks[1]!==before[1],'★成功した行はそのまま');
ok(/21919137/.test(res.err[0]),'★失敗の理由を行に残す');
ok(res.alert[0]===true&&res.alert[1]===false,
   '★写真が原因の行は「対応が必要」に出す');
ok(res.sent===1,'使った控えは消す（残り1件は結果に出てこなかった行）');
const face=await p.evaluate(()=>{
  syncRender();
  return { card:(Array.from(document.querySelectorAll('#syncList > div'))
      .map(d=>d.textContent).find(x=>x.indexOf('B0BO000001')>=0)||'').replace(/\s+/g,' '),
    warn:syncFilterBy('warn').f(syncData.items[0]),
    brk:$('syncWarnBreak').textContent,
    due:syncMarkDue(syncData.items[0]) };
});
console.log('   '+face.card.slice(0,160));
ok(/写真が500px未満：差し替えが必要/.test(face.card),'★行に短い理由を出す');
ok(face.warn===true&&/写真が500px未満 1件/.test(face.brk),
   '★「対応が必要」と理由ごとの件数に出る');
ok(face.due===true,'★記録が戻ったので、もう一度値下げの対象になる');
// 次に成功したら消える
const clr=await p.evaluate(()=>{
  const id1=syncData.items[0].ebay_item_id;
  csvResImport('Line Number,Action,Status,ItemID\n2,Revise,Success,'+id1+'\n');
  return { err:String(syncData.items[0].revise_err||''),
    warn:syncFilterBy('warn').f(syncData.items[0]) };
});
console.log('   '+JSON.stringify(clr));
ok(clr.err===''&&clr.warn===false,'★次のアップロードが通れば消える');

console.log('\n=== 写真が500px未満の行は書き出し前に知らせる ===');
await p.click('#tabD');
const pic=await p.evaluate(()=>{
  const row=(id,pics)=>({id:id,src:'sedori',sku:'game-20260101-UG-B0PIC0000'+id+'-1200',
    asin:'B0PIC0000'+id,titleJa:'商品'+id,
    titleEn:'Used Nintendo Switch Item '+id+' Japan Import',cat:'139973',catFixed:true,condId:5000,
    condSrc:'良い',cost:1200,qty:1,weight:150,pics:pics,descHtml:'<p>d</p>',
    specs:{origin:'Japan',platform:'Nintendo Switch',gameName:id},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',sold:'',titleStatus:'',
    titleCands:[],titleNote:'',titleManual:false});
  csvList=[row('1',[{url:'u',w:1600,h:1200}]),
           row('2',[{url:'u',w:400,h:300}]),
           row('3',[{url:'u'}])];                       // 大きさが分からない写真
  csvList.forEach(csvRecalc); csvSaveList(); csvRender();
  return { small:csvList.map(r=>csvPicSmall(r)),
    notes:csvList.map(r=>csvNotes(r).join('／')) };
});
console.log('   '+JSON.stringify(pic));
ok(pic.small.join()==='0,1,0','★長辺500px未満の写真だけを数える');
ok(/写真が小さい（長辺500px未満）1枚/.test(pic.notes[1]),
   '★書き出し前の注意に出す');
ok(!/写真が小さい/.test(pic.notes[2]),
   '★大きさが分からない写真は知らせない（pj-img から取れたときだけ）');
dlg.length=0; dl.length=0;
await p.click('#csvExport'); await p.waitForTimeout(700);
console.log('   確認: '+(dlg[0]||'').replace(/\n/g,' | ').slice(0,200));
ok(/写真が小さい（長辺500px未満）/.test(dlg[0]||''),
   '★書き出しの確認にも出す');
await T.done();
})();
