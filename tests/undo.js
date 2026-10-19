/* 行ボタン（印）の取り消し（6.69）
   ・押した直後に画面下へ「{商品名}：一点物 オフ→オン ［元に戻す］」を出す
   ・「元に戻す」で、印だけを押す前の値に戻す（/listings に逆向きを送る）
   ・操作の履歴（この端末で直近50件・新しい順）。1つ戻す／各行の「戻す」
   ・まとめて付けた印は1回の操作として一括で戻す
   ・eBay に送った操作は「eBay への変更は戻せません」と出し、戻さない
   ・戻す時点で値が変わっていたら上書きせず「その後に変更されています」
   ・在庫0時を未設定に戻すときは mode:'' を送る
   ・出品CSVタブの行の印も同じ履歴で戻せる（この端末の中だけ）
   ・作業者のキーでも、自分が押した印は戻せる */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('行ボタン（印）の取り消し');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], cancel=false;
p.on('dialog',async d=>{ dlg.push(d.message()); if(cancel)await d.dismiss();
                         else await d.accept(); });

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('autoRvMode').value='off'; $('autoMdMode').value='off'; $('pbMode').value='off';
  window.__posts=[]; window.__fail=false;
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(o2,st)=>Promise.resolve({ok:!st||st<400,status:st||200,
      text:()=>Promise.resolve(JSON.stringify(o2)), json:()=>Promise.resolve(o2)});
    if(/\/whoami/.test(url))return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/status/.test(url))return res({counts:{},items:[],last_runs:[],sold_recent:[]});
    if(/\/listings/.test(url)){
      window.__posts.push(body.items);
      if(window.__fail)return res({error:'ng'},500);
      return res({accepted:(body.items||[]).length,rejected:0});
    }
    if(/\/sync/.test(url))return res({mode:'on',changed:1,zeroed:0,restocked:0,failed:0});
    return real(u,i);
  };
  const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'88'+asin.slice(-4),ebay_qty:1,ebay_price:30,
    title:asin+'の商品',cost_yen:1200,weight_g:150,one_off:0,one_off_known:1,
    dropship:0,restocking:0,on_hand:0,mode:'',
    fba_available:1,fba_inbound:0,fba_reserved:0,fba_res_cust:null,
    fba_res_trans:null,fba_res_proc:null,fba_seen_at:new Date().toISOString(),
    mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,ebay_sale:0,
    md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,revise_err:null,
    pics_eps:1,pb_act:null,pb_why:null,pb_skip:0,pb_fail:0,pb_want:null,
    amazon_lowest:9000,amazon_offers:3,amazon_offers_json:'[{"p":9000,"c":"used"}]',
    amazon_lowest_at:new Date().toISOString(),
    sold_usd:null,warnings:[],notes:[],state:'ok'},x||{});
  syncData={at:new Date().toISOString(),counts:{},items:[
    it('B0UND00001'),
    it('B0UND00002'),
    it('B0UND00003',{restocking:1,ebay_qty:1,restock_price:40,restock_max_cost:3000,
                     restock_skip_acc:1})]};
  /* 履歴はこの端末（localStorage）に残るので、試すたびに空にしておく。 */
  syncUndoList=[]; syncUndoSave(); syncUndoHide();
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E'); roleCheck(); syncRender();
},o||{});

/* 行のボタンを押す（data-s… の属性で引く）。 */
const rowBtn=async(attr,key)=>{
  const sel='#syncList [data-srow="'+key+'"] [data-'+attr+'="'+key+'"]';
  await p.waitForSelector(sel,{state:'visible'});
  await p.click(sel);
  await p.waitForTimeout(140);
};
const view=async()=>await p.evaluate(()=>({
  bar:$('syncUndoBar').style.display, barText:$('syncUndoText').textContent,
  sum:$('syncHistSum').textContent, hist:$('syncHistList').innerText,
  note:$('syncHistNote').textContent, fix:$('syncFixNote').textContent,
  n:syncUndoList.length, posts:JSON.parse(JSON.stringify(window.__posts)),
  one1:syncRowBy('B0UND00001|used').one_off,
  one2:syncRowBy('B0UND00002|used').one_off,
  rest3:syncRowBy('B0UND00003|used').restocking,
  mode1:syncRowBy('B0UND00001|used').mode,
  undoBtns:$('syncHistList').querySelectorAll('[data-undo]').length }));

console.log('=== 押した直後の帯 ===');
await setup({});
await openCsvBoxes(p);
await rowBtn('soneoff','B0UND00001|used');
let v=await view();
console.log('   帯：'+v.barText);
console.log('   履歴：'+v.hist.replace(/\n/g,' / '));
ok(v.bar==='flex','★押した直後に画面下へ帯を出す');
ok(/B0UND00001の商品/.test(v.barText),'★★帯に商品名を出す');
ok(/一点物 オフ→オン/.test(v.barText),'★★帯に「印 オフ→オン」を出す');
ok(v.one1===1,'★印は付いている');
ok(v.n===1,'★履歴に1件残る');
ok(/戻せる 1件/.test(v.sum),'★★履歴の見出しに戻せる件数を出す');
ok(/この商品を表示/.test(v.hist),'★履歴に「この商品を表示」を出す');

console.log('=== 帯の「元に戻す」===');
await p.click('#syncUndoBtn');
await p.waitForTimeout(160);
v=await view();
console.log('   送った内容：'+JSON.stringify(v.posts[1]));
console.log('   '+v.fix);
ok(v.posts.length===2,'★★「元に戻す」で /listings に送る');
ok(v.posts[1][0].one_off===false,'★★押す前の値（オフ）を送る');
ok(v.one1===0,'★★行の印もオフに戻る');
ok(v.bar==='none','★戻したら帯を閉じる');
ok(/戻しました：一点物 1件/.test(v.fix),'★戻した件数を出す');
v=await view();
ok(/戻し済み/.test(v.hist),'★★履歴に「戻し済み」と出す');
ok(v.undoBtns===0,'★戻した操作に「戻す」ボタンは出さない');

console.log('=== 履歴の「1つ戻す」===');
await setup({});
await openCsvBoxes(p);
await rowBtn('soneoff','B0UND00001|used');
await rowBtn('smstop','B0UND00002|used');
let ord=await p.evaluate(()=>syncUndoList.map(x=>x.field));
console.log('   並び：'+JSON.stringify(ord));
ok(ord.length===2&&ord[0]==='mark_stop'&&ord[1]==='one_off',
   '★★履歴は新しい順に並べる');
await p.click('#syncHistUndo');
await p.waitForTimeout(160);
v=await view();
console.log('   '+v.note);
ok(/戻しました：値下げしない 1件/.test(v.note),'★★「1つ戻す」は直近の操作を戻す');
ok(v.one1===1,'★それより前の操作はそのまま');

console.log('=== その後に変更されていたら上書きしない ===');
await setup({});
await openCsvBoxes(p);
await rowBtn('soneoff','B0UND00001|used');
await p.evaluate(()=>{ syncRowBy('B0UND00001|used').one_off=0; });   // 自動処理・別の端末
const before=(await view()).posts.length;
await p.click('#syncHistUndo');
await p.waitForTimeout(160);
v=await view();
console.log('   '+v.note);
ok(/その後に変更されています/.test(v.note),'★★値が変わっていたら知らせる');
ok(v.posts.length===before,'★★そのときは /listings に送らない');
ok(v.undoBtns===1,'★戻していないので「戻す」は残る');

console.log('=== まとめて付けた印 ===');
await setup({});
await openCsvBoxes(p);
await p.evaluate(()=>{
  syncPick={'B0UND00001|used':1,'B0UND00002|used':1};
  syncRender(); syncFlagBulk('one_off',true);
});
await p.waitForTimeout(200);
v=await view();
console.log('   帯：'+v.barText);
ok(v.n===1,'★★まとめて付けた印は1件の操作として残す');
ok(/ほか1件/.test(v.barText),'★★帯に「ほか1件」と出す');
ok(v.one1===1&&v.one2===1,'★2件とも印が付く');
await p.click('#syncHistUndo');
await p.waitForTimeout(200);
v=await view();
console.log('   '+v.note);
ok(/戻しました：一点物 2件/.test(v.note),'★★まとめて付けた印を一括で戻す');
ok(v.one1===0&&v.one2===0,'★★2件とも元に戻る');

console.log('=== 再調達中の解除を戻す ===');
await setup({});
await openCsvBoxes(p);
await rowBtn('srestock','B0UND00003|used');
v=await view();
ok(v.rest3===0,'★解除できる');
ok(/再調達中 オン→オフ/.test(v.barText),'★★帯に出す');
await p.click('#syncUndoBtn');
await p.waitForTimeout(200);
v=await view();
console.log('   送った内容：'+JSON.stringify(v.posts[v.posts.length-1]));
ok(v.rest3===1,'★★印が戻る');
ok(v.posts[v.posts.length-1][0].restock_max_cost===3000,
   '★★一緒に消えた上限・売値も戻す');

console.log('=== 在庫0時を未設定に戻す ===');
await setup({});
await openCsvBoxes(p);
await rowBtn('szero','B0UND00001|used');
v=await view();
console.log('   帯：'+v.barText);
ok(v.mode1==='hold','★未設定の行は「寝かせる」に回る');
ok(/在庫0時 未設定→寝かせる/.test(v.barText),'★★帯に「未設定→…」と出す');
await p.click('#syncUndoBtn');
await p.waitForTimeout(200);
v=await view();
console.log('   送った内容：'+JSON.stringify(v.posts[v.posts.length-1]));
ok(v.posts[v.posts.length-1][0].mode==='','★★未設定に戻すときは空文字を送る');
ok(v.mode1==='','★★行も未設定に戻る');

console.log('=== eBay に送った変更は戻せない ===');
await setup({});
await openCsvBoxes(p);
await p.evaluate(()=>{
  syncUndoPush({ noundo:true, label:'売値の見直しをまとめて実行',
    items:[{asin:'B0UND00001',cond:'used',title:'B0UND00001の商品'}] });
});
await p.waitForTimeout(80);
v=await view();
console.log('   履歴：'+v.hist.replace(/\n/g,' / '));
ok(/eBay への変更は戻せません/.test(v.hist),'★★履歴にそう出す');
ok(v.undoBtns===0,'★★「戻す」ボタンは出さない');
ok(v.bar!=='flex','★戻せない操作では帯を出さない');
let r2=await p.evaluate(()=>{
  syncUndoRun(syncUndoList[0].id,'syncHistNote');
  return $('syncHistNote').textContent; });
ok(/eBay への変更なので戻せません/.test(r2),'★★押しても戻さない');
ok((await view()).posts.length===0,'★★/listings にも送らない');

console.log('=== 送信に失敗したら戻さない ===');
await setup({});
await openCsvBoxes(p);
await rowBtn('soneoff','B0UND00001|used');
await p.evaluate(()=>{ window.__fail=true; });
await p.click('#syncHistUndo');
await p.waitForTimeout(200);
v=await view();
console.log('   '+v.note);
ok(/戻せませんでした/.test(v.note),'★戻せなかったことを出す');
ok(v.undoBtns===1,'★★失敗した操作は履歴に残したまま（もう一度押せる）');

console.log('=== 履歴を消す ===');
dlg=[];
await p.click('#syncHistClear');
await p.waitForTimeout(140);
v=await view();
ok(dlg.length===1&&/eBay や印は変わりません/.test(dlg[0]),'★★確認してから消す');
ok(v.n===0&&/まだありません/.test(v.hist),'★履歴が空になる');
ok(v.one1===1,'★★履歴を消しても印は変わらない');

console.log('=== 直近50件まで ===');
await setup({});
let n50=await p.evaluate(()=>{
  for(var i=0;i<60;i++)syncUndoPush({ field:'one_off',
    items:[{asin:'B0UND00001',cond:'used',title:'x'+i,from:0,to:1}] });
  return [syncUndoList.length,syncUndoList[0].items[0].title,
          JSON.parse(localStorage.getItem('pj:undo:v1')).length]; });
ok(n50[0]===50,'★★残すのは50件まで');
ok(n50[1]==='x59','★★新しいものから残す');
ok(n50[2]===50,'★この端末（localStorage）に残す');

console.log('=== 出品CSVタブの行の印 ===');
await setup({});
await p.evaluate(()=>{
  csvList=[{id:'r1',asin:'B0UND00001',sku:'S-1',titleJa:'テスト商品',titleEn:'Test',
            cat:'139973',condId:3000,condSrc:'可',cost:1200,weight:150,
            fba:false,oneOff:false,dropship:false,markStop:false,fastShip:false,
            zeroAct:'',qty:1,pics:[],specs:{}}];
  csvSaveList(); switchTab('D'); csvRender();
});
await openCsvBoxes(p);
await p.click('#csvList [data-one="r1"]');
await p.waitForTimeout(140);
let c=await p.evaluate(()=>({
  bar:$('syncUndoBar').style.display, barText:$('syncUndoText').textContent,
  n:syncUndoList.length, one:!!csvRowById('r1').oneOff }));
console.log('   帯：'+c.barText);
ok(c.one===true,'★出品CSVの行にも印が付く');
ok(c.bar==='flex'&&/テスト商品：一点物 オフ→オン/.test(c.barText),
   '★★出品CSVでも帯を出す');
ok(/（出品CSV）/.test(c.barText),'★★どちらのタブの印か分かるようにする');
ok(c.n===1,'★履歴にも残る');
await p.click('#syncUndoBtn');
await p.waitForTimeout(160);
c=await p.evaluate(()=>({ one:!!csvRowById('r1').oneOff,
  posts:window.__posts.length, note:$('syncFixNote').textContent }));
console.log('   '+c.note);
ok(c.one===false,'★★出品CSVの印も戻る');
ok(c.posts===0,'★★この端末だけの印なので pj-sync には送らない');

console.log('=== 出品CSV：その後に変更されていたら上書きしない ===');
await p.evaluate(()=>{
  syncUndoList=[]; syncUndoSave(); csvRowById('r1').zeroAct=''; csvSaveList(); csvRender(); });
await p.click('#csvList [data-zero="r1"]');
await p.waitForTimeout(140);
await p.evaluate(()=>{ csvRowById('r1').zeroAct='end'; csvSaveList(); });
c=await p.evaluate(()=>{
  syncUndoRun(syncUndoList[0].id,'syncHistNote');
  return { note:$('syncHistNote').textContent, zero:csvRowById('r1').zeroAct }; });
console.log('   '+c.note);
ok(/その後に変更されています/.test(c.note),'★★出品CSVでも知らせる');
ok(c.zero==='end','★★上書きしない');

console.log('=== 作業者のキー ===');
await setup({role:'staff'});
await openCsvBoxes(p);
let st=await p.evaluate(()=>({
  hist:getComputedStyle($('syncHistBox')).display,
  bar:getComputedStyle($('syncUndoBar')).display }));
ok(st.hist!=='none','★★作業者でも「操作の履歴」を出す');
await rowBtn('soneoff','B0UND00001|used');
v=await view();
ok(v.n===1&&v.bar==='flex','★★作業者でも押した印は履歴に残る');
await p.click('#syncUndoBtn');
await p.waitForTimeout(200);
v=await view();
console.log('   '+v.fix);
ok(v.one1===0&&/戻しました/.test(v.fix),'★★作業者でも自分が押した印は戻せる');

await T.done();
})();
