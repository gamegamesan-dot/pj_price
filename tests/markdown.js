/* 出品CSVタブ：配送ポリシーと値下げ（6.30）
   ・新しく出すものはすべて W2000。行の「即発送」の印の行だけ W1000
   ・選んだ行を最低売値まで下げる Revise CSV
   ・3日ごとに $1 ずつ値下げ（半自動） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('出品CSVタブ：配送ポリシーと値下げ');
const ok = T.ok;
(async()=>{
const p=await T.open();
const fs=require('fs');
const dlg=[]; let answer=true;
p.on('dialog',async d=>{ dlg.push(d.message()); if(answer)await d.accept(); else await d.dismiss(); });
const dl=[]; p.on('download',async d=>dl.push({name:d.suggestedFilename(),
  text:fs.readFileSync(await d.path(),'utf8')}));
await p.click('#tabD');

const DAY=86400000;
const setupRaw=async()=>await p.evaluate((DAY)=>{
  $('csvSort').value='add';
  $('csvShipProfile').value='W1000'; $('csvShipProfileRe').value='W2000';
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P';
  $('csvLocation').value='Tokyo'; $('fx').value='160';
  $('baseProfit').value='1000'; $('linkRate').value='30'; $('saleRate').value='15';
  $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('csvMarkDays').value='3'; $('csvMarkStep').value='1';
  const iso=(d)=>new Date(Date.now()-d*DAY).toISOString();
  const row=(id,asin,extra)=>Object.assign({id:id,src:'sedori',
    sku:'game-20260101-UG-'+asin+'-1200',asin:asin,jan:'49'+id,titleJa:'商品'+id,
    titleEn:'Used Nintendo Switch Item '+id+' Japan Import',cat:'139973',catFixed:true,
    condId:5000,condSrc:'良い',cost:3000,qty:1,weight:200,pics:[{url:'u'}],
    descHtml:'<p>d</p>',specs:{origin:'Japan',platform:'Nintendo Switch',gameName:id},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',titleStatus:'',titleCands:[],
    titleNote:'',titleManual:false},extra||{});
  csvList=[
    row('m1','B0MARK00001',{itemId:'110001'}),
    row('m2','B0MARK00002',{itemId:'110002'}),
    row('m3','B0MARK00003',{itemId:'110003',oneOff:true}),
    row('m4','B0MARK00004',{itemId:'110004'}),
    row('m5','B0MARK00005',{itemId:'110005',dropship:true}),
    row('m6','B0MARK00006',{itemId:'110006'}),
    // まだ出品していない
    row('m7','B0MARK00007',{})
  ];
  csvPick={}; csvTrash=[]; csvTrashSave();
  csvList.forEach(csvRecalc);
  // eBayに出ている売値（pj-sync の取り込み）
  /* 値下げの記録（最後に値下げした日 mark_at・値下げしない mark_stop）は D1 に置く。
     判定も書き出しも、この出品データで行う（出品リストは空でもよい）。 */
  const it=(asin,o)=>Object.assign({asin:asin,cond:'used',scope:'ebay',
    ebay_sku:'E-'+asin+'-U',ebay_qty:1,ebay_price:60,dropship:0,restocking:0,
    one_off:0,mark_at:null,mark_stop:0,
    ebay_sold_at:null,ebay_ship_profile:'W2000',warnings:[],notes:[],state:'ok'},o||{});
  syncData={at:new Date().toISOString(),counts:{},items:[
    // 4日前に値下げ → 今日が値下げの日
    it('B0MARK00001',{ebay_item_id:'110001',mark_at:iso(4)}),
    // 1日前に値下げ → まだ
    it('B0MARK00002',{ebay_item_id:'110002',mark_at:iso(1)}),
    // 一点物
    it('B0MARK00003',{ebay_item_id:'110003',one_off:1,mark_at:iso(4)}),
    // 値下げしない の印
    it('B0MARK00004',{ebay_item_id:'110004',mark_stop:1,mark_at:iso(4)}),
    // 無在庫
    it('B0MARK00005',{ebay_item_id:'110005',dropship:1,mark_at:iso(4)}),
    // 2日前に売れた（値下げは4日前なので「売れたので停止」）
    it('B0MARK00006',{ebay_item_id:'110006',mark_at:iso(4),
      ebay_sold_at:new Date(Date.now()-2*DAY).toISOString()})]};
  csvSaveList(); csvRender(); $('csvListBox').open=true;
},DAY);
const setup=async()=>{ await setupRaw(); await openCsvBoxes(p); };

console.log('=== 配送ポリシー：既定は W2000 ===');
await setup();
let sh=await p.evaluate(()=>csvList.map(r=>r.id+':'+csvShipProfileFor(r)));
console.log('   '+JSON.stringify(sh));
ok(sh.every(x=>/:W2000$/.test(x)),'★どの行も W2000（在庫0のときの動作に関係なく）');
sh=await p.evaluate(()=>{
  const r=csvRowById('m7');
  r.zeroAct='restock'; const a=csvShipProfileFor(r);
  r.zeroAct='hold'; r.dropship=true; const b=csvShipProfileFor(r);
  r.dropship=false; r.onHand=true; const c=csvShipProfileFor(r);
  r.onHand=false;
  return [a,b,c];
});
console.log('   '+JSON.stringify(sh));
ok(sh.every(x=>x==='W2000'),'★再調達・無在庫・手元在庫でも W2000 のまま');

console.log('\n=== 即発送（W1000）の印 ===');
const fast=await p.evaluate(()=>{
  const btn=document.querySelector('#csvList button[data-fast="m7"]');
  const before=btn.textContent;
  btn.click();
  const r=csvRowById('m7');
  return { before:before, after:csvShipProfileFor(r), on:!!r.fastShip, need:r.shipNeed };
});
console.log('   '+JSON.stringify(fast));
ok(/即発送：オフ/.test(fast.before),'★行に「即発送」のボタンがある');
ok(fast.on&&fast.after==='W1000','★オンにすると W1000 になる');
ok(fast.need===undefined,'出品していない行はポリシー変更の対象にしない');
// 出品済みの行を切り替えるとポリシー変更の対象になる
const pend=await p.evaluate(()=>{
  document.querySelector('#csvList button[data-fast="m1"]').click();
  const r=csvRowById('m1');
  return { need:r.shipNeed, want:csvShipProfileFor(r),
    btn:$('csvShipCsv').textContent };
});
console.log('   '+JSON.stringify(pend));
ok(pend.need==='W1000'&&pend.want==='W1000','★出品済みの行は変更の対象になる');
ok(/配送ポリシー変更CSV（1件）/.test(pend.btn),'★ボタンに件数を出す');
dlg.length=0; dl.length=0;
await p.click('#csvShipCsv'); await p.waitForTimeout(400);
let L=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   '+JSON.stringify(L));
ok(/ShippingProfileName/.test(L[1])&&L[2]==='Revise,110001,W1000',
   '★ポリシーを変える Revise CSV が出る');
const after=await p.evaluate(()=>({need:csvRowById('m1').shipNeed,
  sent:csvRowById('m1').shipSent,btn:$('csvShipCsv').textContent}));
ok(after.need===undefined&&after.sent==='W1000'&&!/（/.test(after.btn),
   '★書き出したら対象から外れる');
// オフに戻すと W2000 に戻す CSV
dlg.length=0; dl.length=0;
await p.evaluate(()=>{ document.querySelector('#csvList button[data-fast="m1"]').click(); });
await p.click('#csvShipCsv'); await p.waitForTimeout(400);
L=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   '+JSON.stringify(L));
ok(L[2]==='Revise,110001,W2000','★オフに戻すと W2000 に戻す CSV が出る');

console.log('\n=== ポリシーが印と違う行 ===');
const mis=await p.evaluate(()=>{
  // eBay 側は W1000、この行の印は W2000（即発送オフ）
  syncData.items[1].ebay_ship_profile='W1000';
  csvRender();
  const card=Array.from(document.querySelectorAll('#csvList > div'))
    .map(d=>d.innerText).find(t=>/商品m2/.test(t))||'';
  return { mis:csvShipMismatch(csvRowById('m2')), card:card.replace(/\n/g,' | ') };
});
console.log('   '+mis.card.split(' | ').filter(x=>/ポリシー/.test(x)).join('  '));
ok(mis.mis==='W1000','★食い違いを見つける');
ok(/ポリシーが印と違います/.test(mis.card),'★一覧に「ポリシーが印と違います」と出す');

console.log('\n=== 最低売値まで下げるCSV（販売連携の出品データで動かす）===');
await setup();
// 出品データの行を ItemID で引く
const sRow=async(id)=>await p.evaluate((id)=>{
  const r=syncData.items.find(x=>x.ebay_item_id===id);
  return r?{ price:+r.ebay_price||0, floor:syncFloorOf(r).v, from:syncFloorOf(r).from,
             skip:syncMarkSkip(r), due:syncMarkDue(r), next:syncMarkNext(r),
             left:syncMarkLeft(r), at:r.mark_at||'' }:null;
},id);
let fl=await sRow('110001');
console.log('   '+JSON.stringify(fl));
ok(fl.floor>0&&fl.floor<fl.price,'最低売値はいまの売値より下');
ok(fl.from==='list','出品リストに行があるときはその仕入値で出す');
dlg.length=0; dl.length=0;
// 販売連携タブの一覧でチェックした行が対象
await p.click('#tabE'); await openCsvBoxes(p);
await p.evaluate(()=>{
  syncPick={};
  ['110001','110003'].forEach(id=>{
    const r=syncData.items.find(x=>x.ebay_item_id===id);
    if(r)syncPick[r.asin+'|'+r.cond]=true;
  });
  syncRender();
});
await p.click('#syncFloorCsv'); await p.waitForTimeout(500);
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/選んだ 2件のうち 1件を最低売値まで下げます/.test(dlg[0]||''),
   '★件数と「今の売値 → 最低売値」を出す');
ok((dlg[0]||'').indexOf('一点物')>=0,'★一点物は外して理由を出す');
ok(await p.evaluate(()=>getComputedStyle($('syncBar')).display!=='none'),
   '★行を選ぶと画面の下に操作バーが出る');
L=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   '+JSON.stringify(L));
ok(L.length===3&&L[2]==='Revise,110001,'+fl.floor.toFixed(2),
   '★最低売値で書き出す');
ok((await sRow('110001')).at!=='','★下限に着いた行は値下げの記録を進める');
// すでに最低売値以下の行は対象外
await p.click('#tabD');
await setup();
dlg.length=0; dl.length=0;
await p.click('#tabE'); await openCsvBoxes(p);
await p.evaluate(()=>{
  syncPick={};
  const r=syncData.items[1];
  r.ebay_price=1;                     // 最低売値より下
  syncPick[r.asin+'|'+r.cond]=true;
  syncRender();
});
await p.click('#syncFloorCsv'); await p.waitForTimeout(400);
console.log('   '+JSON.stringify(dlg[0]));
ok(/すでに最低売値以下/.test(dlg[0]||'')&&dl.length===0,
   '★すでに最低売値以下の行は対象外');

console.log('\n=== 3日ごとの値下げ ===');
await p.click('#tabD');
await setup();
await p.click('#tabE'); await openCsvBoxes(p);
const due=await p.evaluate(()=>{
  const o={};
  syncData.items.forEach(r=>{ o[r.ebay_item_id]={due:syncMarkDue(r),why:syncMarkSkip(r)}; });
  o.__bar=$('syncMarkRun').textContent;
  o.__show=getComputedStyle($('syncMarkBar')).display;
  o.__open=$('syncPriceBox').open;
  return o;
});
['110001','110002','110003','110004','110005','110006'].forEach(k=>
  console.log('   '+k+': '+JSON.stringify(due[k])));
console.log('   '+due.__bar+' / '+due.__show);
ok(due['110001'].due===true,'★4日前に下げた出品は今日が値下げの日');
ok(due['110002'].due===false,'★1日前の出品はまだ（3日たっていない）');
ok(due['110003'].why==='一点物'&&due['110004'].why==='値下げしない'
   &&due['110005'].why==='無在庫',
   '★一点物・値下げしない・無在庫は対象外');
ok(due['110006'].why==='売れたので値下げ停止','★値下げ後に売れた出品は止める');
ok(due.__show!=='none'&&/値下げの時期です（1件）/.test(due.__bar),
   '★「値下げの時期です（n件）」と出す');
ok(due.__open===true,'★値下げの時期が来ていれば「価格の操作」は自動で開く');
// 出品していない行は対象外（出品データに無い＝値下げの対象にならない）
ok(await p.evaluate(()=>syncMarkSkip({asin:'B0MARK00007',cond:'used'})==='出品していません'),
   '出品していない行は対象外');
// 行の表示（出品CSVタブの一覧にも、販売連携タブと同じ案内を出す）
await p.click('#tabD');
const rowTxt=await p.evaluate(()=>{
  const t=(w)=>(Array.from(document.querySelectorAll('#csvList > div'))
    .map(d=>d.textContent).find(x=>x.indexOf(w)>=0)||'');
  return { m1:t('商品m1'), m2:t('商品m2'), m6:t('商品m6') };
});
ok(/値下げ中/.test(rowTxt.m1)&&/→ 下限 \$/.test(rowTxt.m1)&&/あと\d+回/.test(rowTxt.m1),
   '★「値下げ中：$45.00 → 下限 $36.80（あと9回）」の形で出す');
ok(/今日が値下げの日です/.test(rowTxt.m1),'今日の行はそう出す');
ok(/次は\d{4}-\d{2}-\d{2}/.test(rowTxt.m2),'まだの行は次の日を出す');
ok(/売れたので値下げ停止/.test(rowTxt.m6),'★売れた行はそう出す');
// 書き出し
dlg.length=0; dl.length=0;
const before=await sRow('110001');
await p.click('#tabE'); await openCsvBoxes(p);
await p.click('#syncMarkRun'); await p.waitForTimeout(500);
console.log('   確認: '+JSON.stringify(dlg[0]));
L=((dl[0]||{}).text||'').trim().split(/\r\n/);
console.log('   '+JSON.stringify(L)+' / '+JSON.stringify(before));
ok(Math.abs(before.price-before.next-1)<0.001,'★1回で $1 下げる');
ok(L.length===3&&L[2]==='Revise,110001,'+before.next.toFixed(2),'★その値で書き出す');
const post=await p.evaluate(()=>{
  const r=syncData.items.find(x=>x.ebay_item_id==='110001');
  return { at:r.mark_at, due:syncMarkDue(r),
    bar:getComputedStyle($('syncMarkBar')).display };
});
console.log('   '+JSON.stringify(post));
ok(!!post.at&&post.due===false,'★書き出した日を記録し、次の3日はそこから数える');
ok(post.bar==='none','★対象が無くなれば帯は消える');

console.log('\n=== 最低売値で止まる ===');
await p.click('#tabD');
await setup();
const stop=await p.evaluate(()=>{
  const r=syncData.items[0], fl=syncFloorOf(r).v;
  // 下限のすぐ上（$0.40 上）にして、1回で下限に着くか見る
  r.ebay_price=Math.round((fl+0.4)*100)/100;
  csvRender();
  return { fl:fl, live:+r.ebay_price, next:syncMarkNext(r), left:syncMarkLeft(r) };
});
console.log('   '+JSON.stringify(stop));
ok(stop.next===stop.fl,'★1回の下げ幅より下限が近いときは下限で止める');
ok(stop.left===1,'あと1回と出す');
const stopped=await p.evaluate(()=>{
  const r=syncData.items[0];
  r.ebay_price=syncFloorOf(r).v;        // ちょうど下限
  csvRender();
  return { why:syncMarkSkip(r), due:syncMarkDue(r),
    row:(Array.from(document.querySelectorAll('#csvList > div'))
      .map(d=>d.textContent).find(x=>x.indexOf('商品m1')>=0)||'') };
});
console.log('   '+JSON.stringify({why:stopped.why,due:stopped.due}));
ok(stopped.why==='最低売値に着いています'&&stopped.due===false,
   '★下限に着いたら止まる');
ok(/値下げ：最低売値に着いています/.test(stopped.row),'★行にもそう出す');

console.log('\n=== 間隔と下げ幅は設定で変えられる ===');
await setup();
const cfg=await p.evaluate(()=>{
  $('csvMarkDays').value='7'; $('csvMarkDays').dispatchEvent(new Event('input'));
  $('csvMarkStep').value='2.5'; $('csvMarkStep').dispatchEvent(new Event('input'));
  const r=syncData.items[0];
  return { days:csvMarkDays(), step:csvMarkStep(), due:syncMarkDue(r),
    next:Math.round(((+r.ebay_price||0)-syncMarkNext(r))*100)/100 };
});
console.log('   '+JSON.stringify(cfg));
ok(cfg.days===7&&cfg.step===2.5,'★設定を読む');
ok(cfg.due===false,'★間隔を7日にすると、4日前の行はまだ対象にならない');
ok(cfg.next===2.5,'★下げ幅も設定どおり');
await p.reload(); await p.waitForTimeout(500); await p.click('#tabD');
const kept=await p.evaluate(()=>[$('csvMarkDays').value,$('csvMarkStep').value]);
console.log('   開き直し: '+JSON.stringify(kept));
ok(kept[0]==='7'&&kept[1]==='2.5','★設定は端末に残る');
await T.done();
})();
