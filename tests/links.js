/* 行から相場を調べるリンク（6.14 → 6.41）
   ・メル 売切：売り切れ（sold_out|trading）＋新しい順＋その行の状態
   ・ヤフオク 落札：落札相場（closedsearch）＋終了日時の新しい順＋新品／中古
   ・「メル 販売中」は両方のタブから消す
   ・キーワードはこれまでと同じ（csvSearchKw／行の「検索語」欄） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('相場を調べるリンク（メル 売切・ヤフオク 落札）');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.click('#tabD');

const setup=async()=>await p.evaluate(()=>{
  $('fx').value='160'; $('csvShipProfile').value='W1000';
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P';
  const row=(id,o)=>Object.assign({id:id,src:'sedori',
    sku:'hobby-20260101-UG-B0LNK0'+id+'001-2500',asin:'B0LNK0'+id+'001',jan:'49'+id,
    titleJa:'セガ 初音ミク Project DIVA ノンスケール ABS&PVC製 塗装済み完成品フィギュア',
    titleEn:'Used Sega Hatsune Miku Figure Japan Import',
    cat:'261055',catFixed:true,condId:3000,condSrc:'良い',cost:2500,qty:1,weight:400,
    pics:[{url:'u'}],descHtml:'<p>d</p>',specs:{origin:'Japan'},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',dropship:false,
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false},o||{});
  csvList=[
    row('A',{}),                                  // 中古（-U）
    row('B',{condId:1000,condSrc:'新品'}),         // 新品
    row('C',{cat:'139973',condId:6000,condSrc:'可',cartOnly:true,
             specs:{origin:'Japan',platform:'Nintendo Switch',gameName:'Kirby'},
             titleJa:'星のカービィ ディスカバリー'}),   // カートリッジのみ（-C）
    row('D',{condId:6000,condSrc:'可',looseOnly:true})]; // フィギュアのみ（-L）
  csvPick={}; syncData=null;
  csvList.forEach(csvRecalc);
  csvSaveList(); csvRender(); $('csvListBox').open=true;
});
const links=async(name)=>await p.evaluate((n)=>{
  const card=Array.from(document.querySelectorAll('#csvList > div'))
    .find(d=>(d.getAttribute('data-row')||'')===n);
  return Array.from(card.querySelectorAll('a.btn'))
    .map(a=>({t:a.textContent,u:a.getAttribute('href')}));
},name);

console.log('=== 並び（Amazon／ヤフオク 落札／メル 売切／eBay Sold）===');
await setup();
let L=await links('A');
L.forEach(x=>console.log('   '+x.t+' → '+x.u));
ok(L.map(x=>x.t).join()==='Amazon,ヤフオク 落札,メル 売切,eBay Sold',
   '★4つ。「メル 販売中」は無く、同じ場所に「ヤフオク 落札」が入る');
ok(!L.some(x=>/メル 販売中/.test(x.t)||/status=on_sale/.test(x.u)),
   '★「メル 販売中」は消えている');

console.log('\n=== メル 売切（中古の行）===');
const mU=L.find(x=>x.t==='メル 売切').u;
console.log('   '+mU);
ok(/^https:\/\/jp\.mercari\.com\/search\?keyword=/.test(mU),'メルカリの検索');
ok(mU.indexOf('&status=sold_out%7Ctrading')>=0,
   '★売り切れの条件（sold_out|trading）はそのまま');
ok(mU.indexOf('&sort=created_time&order=desc')>=0,'★並び順は新しい順');
ok(mU.indexOf('&item_condition_id=2%7C3%7C4%7C5%7C6')>=0,
   '★中古の行は「新品、未使用」以外のすべて（2〜6）');

console.log('\n=== メル 売切（新品の行）===');
L=await links('B');
const mN=L.find(x=>x.t==='メル 売切').u;
console.log('   '+mN);
ok(mN.indexOf('&sort=created_time&order=desc')>=0,'★新品の行も新しい順');
ok(mN.indexOf('&item_condition_id=1')>=0&&mN.indexOf('item_condition_id=1%7C')<0,
   '★新品の行は「新品、未使用」だけ（1）');
ok(mN.indexOf('&status=sold_out%7Ctrading')>=0,'売り切れの条件は同じ');

console.log('\n=== ヤフオク 落札 ===');
const yU=(await links('A')).find(x=>x.t==='ヤフオク 落札').u;
const yN=(await links('B')).find(x=>x.t==='ヤフオク 落札').u;
console.log('   中古: '+yU);
console.log('   新品: '+yN);
ok(/^https:\/\/auctions\.yahoo\.co\.jp\/closedsearch\/closedsearch\?p=/.test(yU),
   '★落札相場（終了したオークション）の検索');
ok(yU.indexOf('&istatus=2')>=0,'★中古の行は中古（istatus=2）');
ok(yN.indexOf('&istatus=1')>=0,'★新品の行は新品（istatus=1）');
ok(yU.indexOf('&s1=end&o1=d')>=0&&yN.indexOf('&s1=end&o1=d')>=0,
   '★並び順は終了日時の新しい順');

console.log('\n=== 箱なしの行（-C／-L）は中古として引く ===');
const c=await links('C'), d=await links('D');
console.log('   -C: '+c.find(x=>x.t==='メル 売切').u);
console.log('   -L: '+d.find(x=>x.t==='ヤフオク 落札').u);
ok(c.find(x=>x.t==='メル 売切').u.indexOf('item_condition_id=2%7C3%7C4%7C5%7C6')>=0
   &&c.find(x=>x.t==='ヤフオク 落札').u.indexOf('istatus=2')>=0,
   '★カートリッジのみ（-C）は中古');
ok(d.find(x=>x.t==='メル 売切').u.indexOf('item_condition_id=2%7C3%7C4%7C5%7C6')>=0
   &&d.find(x=>x.t==='ヤフオク 落札').u.indexOf('istatus=2')>=0,
   '★フィギュアのみ（-L）は中古');

console.log('\n=== キーワードはこれまでと同じ（日本語のエンコード）===');
const kw=await p.evaluate(()=>{
  const r=csvRowById('A');
  return { kw:csvKwOf(r), enc:encodeURIComponent(csvKwOf(r)) };
});
console.log('   検索語: '+kw.kw);
const mA=(await links('A')).find(x=>x.t==='メル 売切').u;
const yA=(await links('A')).find(x=>x.t==='ヤフオク 落札').u;
ok(kw.kw==='セガ 初音ミク Project DIVA',
   '★これまでどおり素材・スケール・完成品フィギュアを落とす');
ok(mA.indexOf('keyword='+kw.enc)>=0,'★メルカリは keyword= に同じ検索語');
ok(yA.indexOf('p='+kw.enc)>=0,'★ヤフオクは p= に同じ検索語');
ok(/%E3%82%BB%E3%82%AC/.test(mA)&&/%E3%82%BB%E3%82%AC/.test(yA),
   '★日本語は UTF-8 の%エンコード');

console.log('\n=== 行の「検索語」を直すと両方のリンクが作り直される ===');
const edit=await p.evaluate(()=>{
  const el=document.querySelector('#csvList [data-kw="A"]');
  el.value='初音ミク フィギュア';
  el.dispatchEvent(new Event('input',{bubbles:true}));
  const card=Array.from(document.querySelectorAll('#csvList > div'))
    .find(d=>(d.getAttribute('data-row')||'')==='A');
  return Array.from(card.querySelectorAll('a.btn')).map(a=>a.getAttribute('href'));
});
console.log('   '+JSON.stringify(edit.slice(1,3)));
const q2=encodeURIComponent('初音ミク フィギュア');
ok(edit[1].indexOf('p='+q2)>=0&&edit[1].indexOf('istatus=2')>=0,
   '★ヤフオクのリンクも新しい検索語になる');
ok(edit[2].indexOf('keyword='+q2)>=0
   &&edit[2].indexOf('item_condition_id=2%7C3%7C4%7C5%7C6')>=0,
   '★メル 売切も新しい検索語＋状態のまま');

console.log('\n=== 販売連携タブも同じ ===');
await p.evaluate(()=>{
  const it=(asin,o)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'hobby',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'66'+asin.slice(-4),ebay_qty:1,ebay_price:70,
    title:'セガ 初音ミク Project DIVA ノンスケール ABS&PVC製 塗装済み完成品フィギュア',
    one_off:0,dropship:0,restocking:0,warnings:[],notes:[],state:'ok',
    fba_available:1,fba_inbound:0,fba_reserved:0},o||{});
  syncData={at:new Date().toISOString(),counts:{},items:[
    it('B0LNKS00001'),
    it('B0LNKS00002',{cond:'new',ebay_sku:'E-B0LNKS00002'}),
    it('B0LNKS00003',{cond:'cart',ebay_sku:'E-B0LNKS00003-C'})]};
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E'); syncRender();
});
await openCsvBoxes(p);
const sync=await p.evaluate(()=>{
  const g=(a)=>{ const card=Array.from(document.querySelectorAll('#syncList > div'))
      .find(d=>(d.getAttribute('data-srow')||'').indexOf(a)===0);
    return Array.from(card.querySelectorAll('a.btn'))
      .map(x=>({t:x.textContent,u:x.getAttribute('href')})); };
  return { used:g('B0LNKS00001'), nw:g('B0LNKS00002'), cart:g('B0LNKS00003') };
});
sync.used.forEach(x=>console.log('   中古 '+x.t+' → '+x.u));
console.log('   新品 '+sync.nw.find(x=>x.t==='メル 売切').u);
ok(!sync.used.some(x=>/メル 販売中/.test(x.t)),
   '★販売連携タブからも「メル 販売中」が消えている');
ok(sync.used.some(x=>x.t==='ヤフオク 落札'),'★「ヤフオク 落札」が出る');
ok(sync.used.find(x=>x.t==='メル 売切').u
     .indexOf('item_condition_id=2%7C3%7C4%7C5%7C6')>=0
   &&sync.used.find(x=>x.t==='ヤフオク 落札').u.indexOf('istatus=2')>=0,
   '★中古の行は中古で引く');
ok(sync.nw.find(x=>x.t==='メル 売切').u.indexOf('item_condition_id=1')>=0
   &&sync.nw.find(x=>x.t==='ヤフオク 落札').u.indexOf('istatus=1')>=0,
   '★新品の行は新品で引く');
ok(sync.cart.find(x=>x.t==='メル 売切').u
     .indexOf('item_condition_id=2%7C3%7C4%7C5%7C6')>=0
   &&sync.cart.find(x=>x.t==='ヤフオク 落札').u.indexOf('istatus=2')>=0,
   '★カートリッジのみ（cond=cart）も中古で引く');
ok(sync.used.every(x=>/^https:\/\//.test(x.u)),'リンクはすべて https');
await T.done();
})();
