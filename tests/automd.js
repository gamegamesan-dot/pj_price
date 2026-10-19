/* 出品CSV／販売連携：自動値下げと開始価格（6.39・7.37）
   ・出品時の開始価格を「Amazon基準の推奨売値」から始められる（最低売値で止める）
   ・値下げ幅＝（開始価格 − 最低売値）÷ 回数（既定10回・最低 $1・$0.01単位）
   ・値下げ幅と最低売値は D1 に送る（pj-sync の自動値下げはこれを使う）
   ・自動値下げ オフ／予定だけ表示／オン の見せ方と、CSVとの二重防止 */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('自動値下げと出品時の開始価格');
const ok = T.ok;
(async()=>{
const p=await T.open();
const fs=require('fs');
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
const dl=[]; p.on('download',async d=>dl.push({name:d.suggestedFilename(),
  text:fs.readFileSync(await d.path(),'utf8')}));
await p.click('#tabD');

/* 出品CSVタブ：仕入値 ¥1,200・重量150g の行。
   Amazon最安値（amzLow）が入っている行と、入っていない行を並べる。 */
const setup=async(opt)=>await p.evaluate((o)=>{
  $('fx').value='160'; $('zone').value='2'; $('baseProfit').value='1000';
  $('linkRate').value='30'; $('saleRate').value='15'; $('usTaxRate').value='8';
  $('targetMode').value='auto';
  $('csvShipProfile').value='W1000'; $('csvRetProfile').value='R';
  $('csvPayProfile').value='P'; $('csvLocation').value='Tokyo';
  $('csvStartMode').value=o.start||'amz';
  $('csvMarkDays').value='3'; $('csvMarkTimes').value=String(o.times||10);
  $('csvMarkStep').value='1';
  $('autoMdMode').value=o.mode||'off'; $('autoMdMax').value=String(o.max||200);
  $('csvWeightLoose').value='200'; $('csvShipLoose').value='0';
  const row=(id,extra)=>Object.assign({id:id,src:'sedori',
    sku:'game-20260101-UG-B0'+id+'000001-1200',asin:'B0'+id+'000001',jan:'49'+id,
    titleJa:'商品'+id,titleEn:'Used Nintendo Switch Item '+id+' Japan Import',
    cat:'139973',catFixed:true,condId:5000,condSrc:'良い',cost:1200,qty:1,weight:150,
    pics:[{url:'u'}],descHtml:'<p>d</p>',
    specs:{origin:'Japan',platform:'Nintendo Switch',gameName:'I'+id},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',amzLow:'',dropship:false,
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false},extra||{});
  csvList=[
    // Amazon最安値 ¥9,000（高い）→ Amazon基準の推奨売値で出したい行
    row('A',{amzLow:9000}),
    // Amazon最安値が取れていない行（これまでどおり仕入値基準）
    row('B',{}),
    // Amazon最安値はあるが無在庫（M-）の行
    row('C',{amzLow:9000,dropship:true})];
  csvPick={}; syncData=null;
  csvList.forEach(csvRecalc);
  csvSaveList(); csvRender(); $('csvListBox').open=true;
  return csvList.map(r=>({id:r.id,price:r.price,floor:r.floor,
    amzRec:csvAmzRecOf(r),start:csvStartPrice(r)}));
},opt||{});

console.log('=== 出品時の開始価格（Amazon基準から始める）===');
let st=await setup({start:'amz'});
st.forEach(x=>console.log('   '+x.id+': 推奨 $'+x.price+'／Amazon基準 $'+x.amzRec
  +'／最低 $'+x.floor+' → 開始 $'+x.start));
ok(st[0].amzRec>st[0].price&&st[0].start===st[0].amzRec,
   '★Amazon最安値が高い行は、Amazon基準の推奨売値で出す');
ok(st[1].amzRec===0&&st[1].start===st[1].price,
   '★Amazon最安値が取れていない行は、これまでどおり仕入値基準');
ok(st[2].start===st[2].price,'★無在庫（M-）の行はこれまでどおり仕入値基準');
ok(st.every(x=>x.start>=x.floor),'★開始価格が最低売値より下になることはない');

console.log('\n=== 「仕入値基準」を選べば今までの動き ===');
const stc=await setup({start:'cost'});
console.log('   '+JSON.stringify(stc.map(x=>x.id+':'+x.start)));
ok(stc.every(x=>Math.abs(x.start-x.price)<0.001),
   '★3行とも推奨売値（仕入値基準）のまま');

console.log('\n=== 開始価格が低すぎる行は最低売値にする ===');
const clamp=await p.evaluate(()=>{
  const r=csvRowById('A');
  const keep=r.cost;
  r.cost=100; csvRecalc(r);                 // 仕入値が極端に安い行
  const o={price:r.price,floor:r.floor,start:csvStartPrice(r)};
  r.cost=keep; csvRecalc(r);
  return o;
});
console.log('   '+JSON.stringify(clamp));
ok(clamp.start>=clamp.floor,'★最低売値で止める');

console.log('\n=== 値下げ幅＝（開始価格 − 最低売値）÷ 回数（最低 $1・$0.01単位）===');
await setup({start:'amz'});
const step=await p.evaluate(()=>{
  const r=csvRowById('A');
  return { start:csvStartPrice(r), floor:r.floor, step:csvMdStepOf(csvStartPrice(r),r.floor),
    times:csvMarkTimes(),
    // 依頼の例：開始 $85・最低 $60・10回 → $2.50
    ex:csvMdStepOf(85,60),
    // 幅が $1 未満になる例（$30 → $25・10回なら $0.50）
    small:csvMdStepOf(30,25),
    // $0.01 単位に切り上げる例
    cent:csvMdStepOf(50,40.005),
    plan:csvMdPlanOf(r), src:csvPriceSrcOf(r) };
});
console.log('   '+JSON.stringify(step));
ok(step.ex===2.5,'★開始 $85・最低 $60・10回 → 幅 $2.50');
ok(step.small===1,'★幅が $1 未満になる行は $1');
ok(step.cent===1,'$0.01 単位（1.0 未満は最低の $1）');
ok(Math.abs(step.step-Math.ceil((step.start-step.floor)/10*100)/100)<0.001,
   '★行の幅も同じ式で出す');
ok(step.plan&&step.plan.md_start===step.start&&step.plan.md_floor===step.floor
   &&step.plan.md_step===step.step&&step.plan.md_n===10,
   '★D1 に送る値（開始・下限・幅・回数）がそろう');
ok(step.src.md_step===step.step&&step.src.md_floor===step.floor,
   '★出品CSVの書き出しで送る項目（価格の元データ）に入る');

console.log('\n=== 出品CSVの開始価格とベストオファーの金額 ===');
const csv=await p.evaluate(()=>{
  const r=csvRowById('A'), o=csvRowFor(r);
  return { start:o['*StartPrice'], bo:o['MinimumBestOfferPrice'],
    on:o['BestOfferEnabled'], floor:r.floor, price:r.price };
});
console.log('   '+JSON.stringify(csv));
ok(Number(csv.start)===await p.evaluate(()=>csvStartPrice(csvRowById('A'))),
   '★*StartPrice は開始価格');
ok(Number(csv.bo)<=csv.floor+0.001&&Number(csv.bo)<Number(csv.start),
   '★自動拒否額は最低売値（かつ開始価格より下）');

console.log('\n=== 販売連携：自動値下げ オフ／予定だけ表示／オン ===');
const syncSetup=async(mode)=>await p.evaluate((m)=>{
  $('autoMdMode').value=m;
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  window.__posts=[];
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u);
    if(/\/listings/.test(url)){
      const items=JSON.parse(i.body).items;
      window.__posts.push(items);
      /* 本物の Response と同じように text() も返す
         （画面側は本文を読んで失敗の理由を作る・6.49）。 */
      const body={accepted:items.length,rejected:0};
      return Promise.resolve({ok:true,status:200,
        text:()=>Promise.resolve(JSON.stringify(body)),
        json:()=>Promise.resolve(body)});
    }
    return real(u,i);
  };
  const old=new Date(Date.now()-5*86400000).toISOString();
  const it=(asin,o)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'77'+asin.slice(-4),ebay_qty:1,
    ebay_price:85,cost_yen:1200,weight_g:150,one_off:0,dropship:0,restocking:0,
    mark_at:old,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:1,
    md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    amazon_lowest:9000,amazon_offers_json:JSON.stringify([{p:9000,c:'used'}]),
    fba_available:1,fba_inbound:0,fba_reserved:0,warnings:[],notes:[],state:'ok'},o||{});
  syncData={at:new Date().toISOString(),counts:{},
    md_last:{at:'2026-10-10T18:00:00Z',mode:'on',picked:3,changed:2,failed:1,
             skipped:7,capped:0},
    items:[
      // 幅が未設定の行（設定を送る対象）
      it('B0AMD000001'),
      // 幅が入っている行（$85・下限$60・幅$2.50・3回ぶん済み）
      it('B0AMD000002',{ebay_price:77.5,md_step:2.5,md_start:85,md_floor:60,md_n:10,
        md_done:3}),
      // 値下げしない行
      it('B0AMD000003',{mark_stop:1,md_step:2.5,md_start:85,md_floor:60,md_n:10})]};
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E');
},mode);

await syncSetup('off');
await openCsvBoxes(p);
let ui=await p.evaluate(()=>({
  bar:getComputedStyle($('syncMdBar')).display,
  mark:$('syncMarkRun').textContent,
  cfg:$('autoMdCfgNote').textContent,
  mode:autoMdMode(), on:autoMdOn() }));
console.log('   オフ: '+JSON.stringify(ui));
ok(ui.bar==='none'&&ui.mode==='off'&&ui.on===false,'★オフのときは帯を出さない');
ok(/値下げの時期です/.test(ui.mark),'★値下げCSVのボタンはそのまま');

await syncSetup('plan');
await openCsvBoxes(p);
ui=await p.evaluate(()=>({
  bar:getComputedStyle($('syncMdBar')).display,
  note:$('syncMdNote').textContent, list:$('syncMdList').textContent,
  send:$('syncMdSend').textContent, dis:$('syncMdSend').disabled,
  need:syncMdNeed().length, plan:syncMdPlan().map(x=>x.name+':'+x.now+'→'+x.next) }));
console.log('   予定だけ表示: '+JSON.stringify(ui));
ok(ui.bar!=='none','★「予定だけ表示」では帯を出す');
ok(/予定だけ表示/.test(ui.note)&&/eBay は変えません/.test(ui.note),
   '★eBayを変えないことを書く');
ok(/次の自動値下げ予定：1件/.test(ui.note),'★予定の件数を出す');
ok(/\$77\.50 → \$75\.00/.test(ui.list),'★「$77.50 → $75.00」の一覧を出す');
ok(/下限 \$60\.00/.test(ui.list)&&/あと7回/.test(ui.list),'★下限と残り回数も出す');
ok(/前回/.test(ui.note)&&/下げた 2件/.test(ui.note)&&/失敗 1件/.test(ui.note),
   '★前回の実行結果（下げた・失敗・とばした）を出す');
ok(ui.need===1&&/設定を送る/.test(ui.send)&&ui.dis===false,
   '★幅が未設定の行には「設定を送る」を出す');

console.log('\n=== 値下げ幅を D1 に送る ===');
dlg.length=0;
await p.click('#syncMdSend');
await p.waitForTimeout(400);
const sent=await p.evaluate(()=>({posts:window.__posts,
  note:$('syncMdNote').textContent,
  row:syncData.items.find(x=>x.asin==='B0AMD000001'),
  need:syncMdNeed().length }));
console.log('   確認: '+JSON.stringify(dlg[0]));
console.log('   送った内容: '+JSON.stringify(sent.posts));
ok(/自動値下げの設定を 1件/.test(dlg[0]||''),'★件数を出して確認する');
ok(sent.posts.length===1&&sent.posts[0][0].md_step>0&&sent.posts[0][0].md_floor>0
   &&sent.posts[0][0].md_n===10&&sent.posts[0][0].md_start===85,
   '★開始・下限・幅・回数を送る');
ok(sent.need===0&&+sent.row.md_step>0,'★送った行はこの端末の表示にも反映する');
ok(/残しました/.test(sent.note),'結果を書く');

console.log('\n=== オンのときは CSV を予備にする（二重に下げない）===');
await syncSetup('on');
await openCsvBoxes(p);
ui=await p.evaluate(()=>({
  mark:$('syncMarkRun').textContent, cls:$('syncMarkRun').className,
  note:$('syncMarkNote').textContent, cfg:$('autoMdCfgNote').textContent,
  rowTxt:(Array.from(document.querySelectorAll('#syncList > div'))
    .map(d=>d.textContent).find(x=>/B0AMD000002/.test(x))||'') }));
console.log('   オン: '+JSON.stringify({mark:ui.mark,cls:ui.cls}));
console.log('   案内: '+ui.note.slice(0,120));
ok(/自動値下げ中：CSVで下げると二重になります/.test(ui.mark)&&!/primary/.test(ui.cls),
   '★値下げCSVのボタンに「自動値下げ中」と出す（目立たせない）');
ok(/自動値下げ中：CSVで下げると二重になります/.test(ui.note),
   '★案内にも二重になることを書く');
console.log('   行: '+ui.rowTxt.replace(/\s+/g,' ').slice(0,160));
ok(/自動値下げ中/.test(ui.rowTxt),'★行には「自動値下げ中」と出す');
ok(/\$2\.50 ずつ/.test(ui.rowTxt),'★その行の値下げ幅を出す');

console.log('\n=== 絞り込み「自動値下げの予定」（日付の近い順）===');
const planSetup=async(mode)=>await p.evaluate((m)=>{
  $('autoMdMode').value=m; $('csvMarkDays').value='3'; $('csvMarkTimes').value='10';
  const d=(n)=>new Date(Date.now()-n*86400000).toISOString();
  const it=(asin,o)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'78'+asin.slice(-4),ebay_qty:1,
    ebay_price:47.65,cost_yen:1200,weight_g:150,one_off:0,dropship:0,restocking:0,
    mark_stop:0,ebay_first:1,ebay_sold_at:null,ebay_bo:1,ebay_sale:null,
    md_step:1,md_start:57.65,md_floor:44.66,md_n:10,md_done:3,
    amazon_lowest:3000,amazon_offers_json:JSON.stringify([{p:3000,c:'used'}]),
    fba_available:1,fba_inbound:0,fba_reserved:0,warnings:[],notes:[],state:'ok'},o||{});
  syncData={at:new Date().toISOString(),counts:{},md_last:null,items:[
    // 今日が値下げの日（5日前に下げた）
    it('B0PLAN00001',{mark_at:d(5)}),
    // 明日（2日前に下げた＝3日後は明日）
    it('B0PLAN00002',{mark_at:d(2)}),
    // 3日後（今日下げた）
    it('B0PLAN00003',{mark_at:d(0)}),
    // 値下げ幅が未設定（自動値下げの対象外。CSVで下げる行）
    it('B0PLAN00004',{mark_at:d(5),md_step:null,md_start:null,md_floor:null,md_n:null}),
    // 値下げしない
    it('B0PLAN00005',{mark_at:d(5),mark_stop:1}),
    // eBayのセール中
    it('B0PLAN00006',{mark_at:d(5),ebay_sale:1})]};
  syncPick={}; syncPage=1;
  switchTab('E'); syncRender();
  const names=(v)=>SYNC_FILTERS.find(x=>x.v===v);
  return { opt:Array.from($('syncFilter').options).map(o=>o.textContent),
    target:syncData.items.filter(syncMdTarget).map(r=>r.asin),
    count:syncMdCount(),
    plan:syncMdPlan().map(x=>x.r.asin+':'+x.due+':'+x.now+'→'+x.next),
    csvN:syncMarkCsvRows().length, allN:syncMarkRows().length,
    has:!!names('automd') };
},mode);
let pl=await planSetup('on');
console.log('   選択肢: '+JSON.stringify(pl.opt.filter(x=>/自動値下げ|値下げの時期/.test(x))));
console.log('   対象: '+JSON.stringify(pl.target));
console.log('   件数: '+JSON.stringify(pl.count));
console.log('   予定: '+JSON.stringify(pl.plan));
/* 6.71 で「値下げの時期」をここにまとめたので、自動値下げの対象3件＋
   値下げの時期だけ来ている1件（B0PLAN00004）の4件になる。 */
ok(pl.has&&pl.opt.some(x=>/^自動値下げの予定（4）$/.test(x)),
   '★★絞り込みに「自動値下げの予定（4件）」が出る（値下げの時期も含む）');
ok(pl.target.join()==='B0PLAN00001,B0PLAN00002,B0PLAN00003',
   '★幅が未設定・値下げしない・セール中の行は対象にしない');
ok(pl.count.n===3&&pl.count.today===1&&pl.count.soon===3,
   '★今日 1件／3日以内 3件（3日以内は今日を含む）');
const dd=(n)=>{ const d=new Date(Date.now()+n*86400000);
  return (d.getMonth()+1)+'/'+d.getDate(); };
ok(pl.plan[0].indexOf('B0PLAN00001:今日')===0,'★今日の行が先頭（「今日」と出す）');
ok(pl.plan[1]==='B0PLAN00002:'+dd(1)+':47.65→46.65','★次は明日の行（'+dd(1)+'）');
ok(pl.plan[2].indexOf('B0PLAN00003:'+dd(3))===0,'★そのあとに3日後の行');

console.log('\n=== 一覧も日付の近い順に並ぶ ===');
await p.evaluate(()=>{ syncFilterSet('automd'); });
const order=await p.evaluate(()=>({
  rows:Array.from(document.querySelectorAll('#syncList > div'))
    .map(d=>(d.getAttribute('data-srow')||'').split('|')[0]),
  txt:(Array.from(document.querySelectorAll('#syncList > div'))
    .map(d=>d.textContent).find(x=>/B0PLAN00002/.test(x))||'')
      .replace(/\s+/g,' ') }));
console.log('   並び: '+JSON.stringify(order.rows));
ok(order.rows.join()==='B0PLAN00001,B0PLAN00002,B0PLAN00003,B0PLAN00004',
   '★★一覧も次の自動値下げ日が近い順（対象でない行は最後）');
const line=(order.txt.match(/次の自動値下げ[^。]*/)||[''])[0];
console.log('   行: '+line);
ok(/次の自動値下げ/.test(order.txt),'★行に「次の自動値下げ」を出す');
ok(line.indexOf(dd(1))>=0,'★日付（'+dd(1)+'）を出す');
ok(/\$47\.65 → \$46\.65/.test(line),'★「$47.65 → $46.65」を出す');
ok(/あと3回/.test(line)&&/下限 \$44\.66/.test(line),'★「あと3回・下限 $44.66」を出す');

console.log('\n=== 「次の自動値下げ予定」の横に 今日／3日以内 を出す ===');
const note=await p.evaluate(()=>({ note:$('syncMdNote').textContent,
  list:$('syncMdList').textContent,
  link:!!document.getElementById('syncMdPick') }));
console.log('   '+note.note);
console.log('   '+note.list.slice(0,120));
ok(/次の自動値下げ予定：3件（今日 1件／3日以内 3件）/.test(note.note),
   '★「次の自動値下げ予定：3件（今日 1件／3日以内 3件）」');
ok(note.link,'★「一覧で見る」から絞り込みに飛べる');
ok(note.list.indexOf('今日　')>=0&&note.list.indexOf(dd(1))>=0,
   '★予定の一覧にも日付を出す');

console.log('\n=== 値下げCSVの件数は自動値下げの対象外だけ ===');
let bar=await p.evaluate(()=>({ btn:$('syncMarkRun').textContent,
  note:$('syncMarkNote').textContent, csvN:syncMarkCsvRows().length,
  allN:syncMarkRows().length,
  sum:$('syncPriceSum').textContent }));
console.log('   '+JSON.stringify(bar));
ok(bar.csvN===1&&bar.allN===2,
   '★値下げの時期は2件だが、CSVで下げるのは自動値下げの対象外の1件だけ');
ok(/自動値下げ中：CSVで下げると二重になります（1件）/.test(bar.btn),
   '★ボタンに「自動値下げ中：CSVで下げると二重になります（1件）」');
ok(/自動値下げ中：CSVで下げると二重になります/.test(bar.note),
   '★案内にも同じことを書く');
ok(/値下げの時期 2件/.test(bar.sum),'価格の操作の見出しは「値下げの時期」全体の件数');

console.log('\n=== 「予定だけ表示」でも同じ（eBayは変えていないと添える）===');
pl=await planSetup('plan');
bar=await p.evaluate(()=>({ btn:$('syncMarkRun').textContent,
  note:$('syncMarkNote').textContent,
  row:(Array.from(document.querySelectorAll('#syncList > div'))
    .map(d=>d.textContent).find(x=>/B0PLAN00001/.test(x))||'') }));
console.log('   '+JSON.stringify({btn:bar.btn,note:bar.note.slice(-80)}));
ok(/自動値下げ中：CSVで下げると二重になります（1件）/.test(bar.btn),
   '★「予定だけ表示」でもボタンに出す');
ok(/eBay はまだ変わっていません/.test(bar.note),'★eBayはまだ変わっていないと添える');
ok(/予定だけ（eBayは変えません）/.test(bar.row),'★行にもそう出す');

console.log('\n=== オフなら今までどおり（値下げの時期の件数で出す）===');
pl=await planSetup('off');
bar=await p.evaluate(()=>({ btn:$('syncMarkRun').textContent,
  bar:getComputedStyle($('syncMdBar')).display,
  csvN:syncMarkCsvRows().length,
  opt:Array.from($('syncFilter').options).map(o=>o.textContent) }));
console.log('   '+JSON.stringify(bar));
ok(bar.csvN===2&&/値下げの時期です（2件）/.test(bar.btn),
   '★オフのときは値下げの時期の2件すべてがCSVの対象');
ok(bar.bar==='none','★自動値下げの帯は出さない');
ok(bar.opt.some(x=>/^自動値下げの予定（4）$/.test(x)),
   '★絞り込みは残す（オフでも、どの行が対象になるかは見られる）');
/* オフのときだけ「値下げの時期」も出す（6.71）。 */
ok(bar.opt.some(x=>/^値下げの時期（2）$/.test(x)),
   '★★自動値下げがオフのときは「値下げの時期」も出す');

console.log('\n=== オンのときに値下げCSVを押すと、まず確認を出す ===');
await planSetup('on');
await openCsvBoxes(p);
dlg.length=0; dl.length=0;
await p.click('#syncMarkRun');
await p.waitForTimeout(400);
console.log('   '+JSON.stringify(dlg));
ok(dlg.length>=1&&/自動値下げがオンです/.test(dlg[0])
   &&/二重には下がりません/.test(dlg[0])
   &&/対象の行をCSVで下げると二重になります/.test(dlg[0]),
   '★押す前に「この行は対象外なので二重にはならない」ことを知らせる');
await T.done();
})();
