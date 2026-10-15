/* 販売連携：売値の見直しの自動反映（6.47）
   ・⚙設定の「売値の自動反映」（オフ／確認モード／自動実行・1日の上限・変更幅の上限）
   ・帯：変更の予定（先頭3件＋すべて表示）・前回の結果・3回失敗の知らせ
   ・「見直しの目標を送る」が送る中身（売値・下限・判断・仕入値の上限）と設定
   ・「まとめて実行」が pj-sync に承認を送ること
   ・値上げだけ（下げる行は自動値下げに任せる）・見送りは数量0・赤字は例外
   ・3回失敗した行は「対応が必要」に出る */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('販売連携：売値の自動反映（値上げ）');
const ok = T.ok;
(async()=>{
const p=await T.open();
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

/* pj-sync への通信を差し替える。__posts に /listings の中身、
   __sync に /sync の中身、__settings に /settings の中身を積む。 */
const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('zone').value='2'; $('baseProfit').value='1000';
  $('linkRate').value='30'; $('saleRate').value='15'; $('usTaxRate').value='8';
  $('targetMode').value='auto'; $('syncSoldCut').value='0';
  $('csvReviewAbs').value='1'; $('csvReviewPct').value='3';
  $('autoRvMode').value=o.mode||'confirm';
  $('autoRvMax').value=String(o.max||50); $('autoRvPct').value=String(o.pct||30);
  $('autoMdMode').value='off';
  window.__posts=[]; window.__sync=[]; window.__settings=[];
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    if(/\/listings/.test(url)){
      window.__posts.push(body.items);
      return Promise.resolve({ok:true,json:()=>Promise.resolve({accepted:body.items.length,
        rejected:0})});
    }
    if(/\/settings/.test(url)){
      window.__settings.push(body);
      return Promise.resolve({ok:true,json:()=>Promise.resolve({ok:true,stored:true,
        at:body.at,settings:body.settings})});
    }
    if(/\/sync/.test(url)){
      window.__sync.push(body);
      return Promise.resolve({ok:true,json:()=>Promise.resolve({mode:'approve',changed:2,
        zeroed:1,failed:0,capped:0})});
    }
    return real(u,i);
  };
  const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'66'+asin.slice(-4),ebay_qty:1,
    title:asin+'の商品',cost_yen:1200,weight_g:150,one_off:0,dropship:0,restocking:0,
    mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,ebay_sale:null,
    md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,
    amazon_lowest:0,amazon_offers_json:'[]',sold_usd:null,
    fba_available:1,fba_inbound:0,fba_reserved:0,warnings:[],notes:[],state:'ok'},x||{});
  /* 仕入値1,200円・150g の推奨売値を基準に、eBayの売値をずらした行を並べる。
     mid … 最低売値より上・推奨売値よりは安い（ふつうの値上げの対象）。
     相場（Sold）は送料ぶん（G）を引いた額で判定するので、見送りの行は G+1 にする。 */
  const want=csvPriceFor(1200,150).price;
  const floor=csvPriceFor(1200,150).floor;
  const mid=Math.round((floor+1)*100)/100;
  const m=priceModel(), G=m.zoneShipCharge(m.basisZone);
  syncData={at:new Date().toISOString(),counts:{},items:[
    // ① 推奨売値よりだいぶ安い（値上げの対象）
    it('B0ARV00001',{ebay_price:mid}),
    // ② 推奨売値より高い（下げる話なので自動反映の対象にしない）
    it('B0ARV00002',{ebay_price:Math.round((want+8)*100)/100}),
    // ③ 差が小さい（しきい値に届かない）
    it('B0ARV00003',{ebay_price:Math.round((want-0.4)*100)/100}),
    // ④ 自動値下げの途中（赤字ではない）→ 上げない
    it('B0ARV00004',{ebay_price:mid,md_done:2,md_step:1,
      md_floor:floor,md_start:want,md_n:10}),
    // ⑤ 赤字（最低売値より下）＋値下げの途中 → それでも上げる
    it('B0ARV00005',{ebay_price:Math.round((floor-3)*100)/100,md_done:2,md_step:1,
      md_floor:floor,md_start:want,md_n:10}),
    // ⑥ 「値下げしない」の印がある行 → 値上げはする
    it('B0ARV00006',{ebay_price:mid,mark_stop:1}),
    // ⑦ 相場が低すぎる（見送り）→ 数量0
    it('B0ARV00007',{ebay_price:mid,sold_usd:Math.round((G+1)*100)/100}),
    // ⑧ eBayのセール中 → 触らない
    it('B0ARV00008',{ebay_price:mid,ebay_sale:1}),
  ]};
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E'); syncRender();
  return { want:want, floor:floor, mid:mid, G:G };
},o||{});

const view=async()=>await p.evaluate(()=>({
  bar:getComputedStyle($('syncRvBar')).display,
  note:$('syncRvNote').innerText, list:$('syncRvList').innerText,
  send:$('syncRvSend').textContent, go:$('syncRvGo').textContent,
  goDis:$('syncRvGo').disabled,
  plan:syncRvPlanRows().rows.map(x=>x.asin+':'+x.kind+':'+x.from+'→'+x.to),
  need:syncRvNeed().length, cfg:$('autoRvCfgNote').textContent }));

console.log('=== 設定（確認モードが既定）===');
const def=await p.evaluate(()=>({mode:$('autoRvMode').value,max:$('autoRvMax').value,
  pct:$('autoRvPct').value,fn:autoRvMode()+'/'+autoRvMax()+'/'+autoRvPct()}));
console.log('   '+JSON.stringify(def));
ok(def.mode==='confirm'&&def.max==='50'&&def.pct==='30',
   '★はじめは「確認モード」・1日50件・1回30%');

const base=await setup({mode:'confirm'});
await openCsvBoxes(p);
console.log('   推奨売値 $'+base.want+'／最低売値 $'+base.floor
  +'／ふつうの行の売値 $'+base.mid+'／送料 $'+base.G);

console.log('\n=== どの行を上げるか ===');
let v=await view();
console.log('   予定: '+JSON.stringify(v.plan));
const has=(asin)=>v.plan.some(x=>x.indexOf(asin)===0);
ok(has('B0ARV00001'),'★推奨売値よりだいぶ安い行は上げる');
ok(!has('B0ARV00002'),'★推奨売値より高い行は下げない（自動値下げに任せる）');
ok(!has('B0ARV00003'),'★差がしきい値より小さい行は触らない');
ok(!has('B0ARV00004'),'★自動値下げの途中の行は上げない');
ok(has('B0ARV00005'),'★赤字の行は、値下げの途中でも上げる');
ok(has('B0ARV00006'),'★「値下げしない」の行も値上げはする');
ok(v.plan.some(x=>x.indexOf('B0ARV00007:zero')===0),'★見送りの行は数量0にする');
ok(!has('B0ARV00008'),'★eBayのセール中は触らない');

console.log('\n=== 1回の変更幅の上限（30%）===');
const cap=await p.evaluate(()=>{
  const r=syncData.items.find(x=>x.asin==='B0ARV00001');
  const keep=r.ebay_price;
  r.ebay_price=5;                      // 目標まで何倍も上げる行
  const a=syncRvActOf(r);
  r.ebay_price=keep;
  return { from:a.from, to:a.to, want:a.want, capped:a.capped };
});
console.log('   '+JSON.stringify(cap));
ok(cap.to===6.5&&cap.capped===true,'★$5.00 → $6.50（30%まで）。残りは次の回');

console.log('\n=== 帯の見せ方（確認モード）===');
v=await view();
console.log('   '+v.note.replace(/\n/g,' / '));
console.log('   一覧: '+v.list.replace(/\n/g,' / '));
ok(v.bar!=='none','★オフ以外では帯を出す');
ok(/確認モード/.test(v.note)&&/まとめて実行」を押すまで eBay は変えません/.test(v.note),
   '★押すまで変わらないと書く');
ok(/変更の予定：4件/.test(v.note),'★予定の件数を出す');
ok(/この端末の計算/.test(v.note),'★pj-sync の予定が無いときはそう書く');
ok((v.list.match(/^・/gm)||[]).length===3&&/すべて表示（4件）/.test(v.list),
   '★一覧は先頭3件＋「すべて表示（4件）」（6.46 と同じ）');
ok(/見送り → 数量0/.test(v.list.replace(/\n/g,''))
   ||v.plan.some(x=>/zero/.test(x)),'★見送りの行はそう出す');
ok(/1日に最大 50件・1回の変更幅は 30% まで/.test(v.cfg),'★⚙設定にも今の値を出す');

console.log('\n=== 「見直しの目標を送る」の中身 ===');
console.log('   送る件数: '+v.need+'　ボタン: '+v.send);
ok(v.need>0&&/見直しの目標を送る（\d+件）/.test(v.send),'★送る件数をボタンに出す');
await p.click('#syncRvSend'); await p.waitForTimeout(400);
const sent=await p.evaluate(()=>({posts:window.__posts,settings:window.__settings,
  done:$('syncRvDone').textContent,need:syncRvNeed().length}));
const one=(sent.posts[0]||[]).find(x=>x.asin==='B0ARV00001');
const zero=(sent.posts[0]||[]).find(x=>x.asin==='B0ARV00007');
console.log('   '+JSON.stringify(one)+'\n   '+JSON.stringify(zero));
ok(one&&one.rv_want>0&&one.rv_floor>0&&one.rv_max_cost>0&&one.rv_kind==='none',
   '★売値・最低利益ライン・判断・仕入値の上限を送る');
ok(zero&&zero.rv_kind==='skip'&&zero.rv_want===0,'★見送りの行は skip として送る');
ok(sent.need===0&&/目標を \d+件 pj-sync に残しました/.test(sent.done),
   '★送った行はこの端末の表示にも反映する');
console.log('   設定: '+JSON.stringify((sent.settings[0]||{}).settings||{}));
const st=(sent.settings[0]||{}).settings||{};
ok(st.autoRvMode==='confirm'&&st.autoRvMax==='50'&&st.autoRvPct==='30',
   '★モード・上限・変更幅も pj-sync に送る（Worker はこれを読んで動く）');
ok(st.autoMdMode==='off'&&st.csvMarkDays==='3',
   '★自動値下げの設定も一緒に送る（v136 で届いていなかったぶん）');
ok(st.csvReviewAbs==='1'&&st.csvReviewPct==='3','★見直しのしきい値も送る');

console.log('\n=== 「まとめて実行」で承認する ===');
v=await view();
console.log('   ボタン: '+v.go+'　押せる: '+(!v.goDis));
ok(/まとめて実行（4件）/.test(v.go)&&!v.goDis,'★予定の件数を出して押せる');
dlg.length=0;
await p.click('#syncRvGo'); await p.waitForTimeout(400);
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/eBay の売値を pj-sync から変えます（4件）/.test(dlg[0]||''),'★件数を出して確認する');
ok(/値上げ 3件／見送りで数量0 1件/.test(dlg[0]||''),'★内訳も出す');
const go=await p.evaluate(()=>({sync:window.__sync,done:$('syncRvDone').textContent}));
console.log('   送った内容: '+JSON.stringify(go.sync));
ok(go.sync.length===1&&go.sync[0].kind==='review'&&go.sync[0].approve===true,
   '★pj-sync に「承認して実行」を送る');
ok(/上げた 2件／数量0 1件／失敗 0件/.test(go.done),'★結果を出す');

console.log('\n=== pj-sync の予定が来ていればそれを出す ===');
const fromSync=await p.evaluate(()=>{
  syncData.rv_plan={at:'2026-10-15T18:00:00Z',mode:'confirm',n:2,capped:5,rows:[
    {asin:'B0ARV00001',name:'pj-syncの予定1',kind:'up',from:20,to:25,want:25,
     capped:false,loss:false},
    {asin:'B0ARV00009',name:'pj-syncの予定2',kind:'zero',from:30,to:0,want:0,
     capped:false,loss:false}]};
  syncData.rv_last={at:'2026-10-15T18:00:00Z',mode:'auto',changed:3,zeroed:1,failed:2,
    capped:4};
  syncRender();
  return { note:$('syncRvNote').innerText, list:$('syncRvList').innerText,
           from:syncRvPlanRows().from, go:$('syncRvGo').textContent };
});
console.log('   '+fromSync.note.replace(/\n/g,' / '));
console.log('   一覧: '+fromSync.list.replace(/\n/g,' / '));
ok(fromSync.from==='sync'&&/pj-sync の予定 2026-10-15 18:00/.test(fromSync.note),
   '★pj-sync が残した予定（とその時刻）を出す');
ok(/変更の予定：2件/.test(fromSync.note)&&/まとめて実行（2件）/.test(fromSync.go),
   '★承認の件数も pj-sync の予定に合わせる');
ok(/1日の上限を超えた 5件は翌日に回ります/.test(fromSync.note),'★持ち越しも出す');
ok(/pj-syncの予定1/.test(fromSync.list),'★予定の中身を出す');
ok(/前回/.test(fromSync.note)&&/上げた 3件/.test(fromSync.note)
   &&/数量0 1件/.test(fromSync.note)&&/失敗 2件/.test(fromSync.note),
   '★前回の結果（上げた・数量0・失敗）も出す');

console.log('\n=== 3回続けて失敗した行は「対応が必要」に出す ===');
const f3=await p.evaluate(()=>{
  const r=syncData.items.find(x=>x.asin==='B0ARV00001');
  r.rv_fail=3;
  syncRender();
  return { alert:syncRvAlert(r), n:syncRvFail3(), inWarn:syncFilterBy('warn').f(r),
    note:$('syncRvNote').innerText, brk:$('syncWarnBreak').innerText,
    card:(Array.from(document.querySelectorAll('#syncList > div'))
      .map(d=>d.textContent).find(x=>x.indexOf('B0ARV00001')>=0)||'') };
});
console.log('   '+JSON.stringify({alert:f3.alert,n:f3.n,inWarn:f3.inWarn}));
console.log('   理由ごとの件数: '+f3.brk.replace(/\n/g,' / '));
ok(f3.alert&&f3.inWarn,'★絞り込み「対応が必要」に入る');
ok(/自動反映が3回失敗/.test(f3.card),'★行に印を出す');
ok(/売値の自動反映が3回失敗 1件/.test(f3.brk),'★理由ごとの件数にも出る');
ok(/1件は3回続けて失敗しています/.test(f3.note),'★帯でも知らせる');

console.log('\n=== 自動実行とオフ ===');
await setup({mode:'auto'});
await openCsvBoxes(p);
v=await view();
console.log('   '+v.note.replace(/\n/g,' / '));
ok(/自動実行/.test(v.note)&&!/押すまで eBay は変えません/.test(v.note),
   '★自動実行では確認の文を出さない');
ok(/自動反映の予定/.test(await p.evaluate(()=>
  (Array.from(document.querySelectorAll('#syncList > div'))
    .map(d=>d.textContent).find(x=>x.indexOf('B0ARV00001')>=0)||''))),
   '★行にも「自動反映の予定」と出す');
await setup({mode:'off'});
await openCsvBoxes(p);
v=await view();
console.log('   オフ: '+JSON.stringify({bar:v.bar,cfg:v.cfg}));
ok(v.bar==='none','★オフのときは帯を出さない');
ok(/価格更新CSVを書き出して/.test(v.cfg),'★オフのときは今までのやり方を案内する');
const offRow=await p.evaluate(()=>
  (Array.from(document.querySelectorAll('#syncList > div'))
    .map(d=>d.textContent).find(x=>x.indexOf('B0ARV00001')>=0)||''));
ok(!/自動反映の予定|確認待ち/.test(offRow)&&/売値の見直し/.test(offRow),
   '★オフのときは行も今までの「売値の見直し」だけ');

console.log('\n=== 価格更新CSVは今までどおり ===');
const csv=await p.evaluate(()=>{
  const rows=syncRevRows();
  return { n:rows.length, has1:rows.some(x=>x.r.asin==='B0ARV00001') };
});
console.log('   '+JSON.stringify(csv));
ok(csv.n>0&&csv.has1,'★「売値の見直し」の対象と書き出しは変えていない');

await T.done();
})();
