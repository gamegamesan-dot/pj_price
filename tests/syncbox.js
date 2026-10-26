/* 販売連携：折りたたみの開閉を覚える・描き直しで画面が飛ばない（6.80）
   ・「価格の操作」「写真を eBay 保管に切り替え」「その他」「詳しい数字」
     「操作の履歴」「一覧」の開閉をこの端末に保存し、描き直しても戻さない
   ・開き直しても前回の状態にする（localStorage）
   ・「価格の操作」は値下げの時期が来ていれば自動で開くが、
     一度でも人が開閉したらその判断を優先する
   ・描き直しでスクロールが飛ばない（操作した行が画面内に残る）
   ・チェックを付けるだけの操作では一覧を作り直さず、件数とチェック欄だけ直す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('販売連携：折りたたみとスクロール');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const BOXES=['syncPriceBox','syncPicsBox','syncMoreBox','syncNumBox',
             'syncHistBox','syncListBox'];
const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('autoAdRate').value='6';
  $('autoRvMode').value='off'; $('autoMdMode').value='off'; $('pbMode').value='off';
  $('autoRkMode').value='off'; $('autoSkMode').value='confirm';
  $('csvMarkStep').value='1'; $('csvMarkTimes').value='10'; $('csvMarkDays').value='3';
  $('syncPerPage').value='100'; $('syncPerPage2').value='100';
  $('syncFilter').value='all';
  if(!o.keep){
    try{ localStorage.removeItem('pj:boxopen:v1'); }catch(e){}
    boxOpen={};
    /* 前のかたまりで開けた状態が残らないように、HTML の既定に戻す
       （一覧だけ既定で開いている）。 */
    Array.prototype.forEach.call(document.querySelectorAll('details[data-box]'),
      function(d){ d.open=(d.id==='syncListBox'); });
    boxOpen={}; try{ localStorage.removeItem('pj:boxopen:v1'); }catch(e){}
  }
  window.__posts=[];
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(x,st)=>Promise.resolve({ok:!st||st<400,status:st||200,
      text:()=>Promise.resolve(JSON.stringify(x)), json:()=>Promise.resolve(x)});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/status/.test(url))return res({counts:{},items:[],last_runs:[],sold_recent:[]});
    if(/\/listings/.test(url)){ window.__posts.push(body.items); return res({accepted:1}); }
    return real(u,i);
  };
  const NOW=new Date().toISOString();
  const OLD=new Date(Date.now()-10*86400000).toISOString();
  const it=(n,x)=>Object.assign({asin:'B0BOX0000'+n,cond:'used',scope:'ebay',
    prefix:'game',ebay_sku:'E-B0BOX0000'+n+'-U',ebay_item_id:'9900'+n,
    ebay_qty:1,ebay_price:52.16,title:'テスト商品'+n+'（販売連携の行）',
    cost_yen:1200,weight_g:150,one_off:0,one_off_known:1,dropship:0,restocking:0,
    on_hand:0,hand_qty:null,mode:null,ebay_start:NOW,ebay_sale:0,ebay_bo:0,
    mark_at:x&&x.mark_at!==undefined?x.mark_at:OLD,mark_stop:0,ebay_first:0,
    md_step:1,md_start:null,md_floor:40,md_n:10,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,
    revise_err:null,rk_want:null,rk_fail:0,pb_act:null,pb_skip:0,pb_fail:0,
    sold_keep:0,sold_price:null,sk_act:null,sk_fail:0,
    pics_eps:1,pics_eps_at:NOW,pics_n:2,
    amazon_lowest:0,amazon_offers:0,amazon_offers_json:'[]',amazon_lowest_at:null,
    sold_usd:null,fba_available:1,fba_inbound:0,fba_reserved:0,
    warnings:[],notes:[],state:'ok'},x||{});
  const items=[];
  for(let i=1;i<=12;i++)items.push(it(i,o.nomark?{mark_at:NOW}:null));
  syncData={at:NOW,counts:{listed:12},items:items,last_runs:[],sold:[],
            md_last:o.last||null};
  csvList=[]; csvSaveList(); syncPick={};
  syncUndoList=[]; syncUndoSave(); syncUndoHide();
  switchTab('E'); roleCheck(); syncRender();
},o||{});
const boxes=async()=>await p.evaluate((ids)=>{
  const o={};
  ids.forEach(function(id){ const d=$(id); o[id]=d?!!d.open:null; });
  o.saved=JSON.parse(localStorage.getItem('pj:boxopen:v1')||'{}');
  return o;
},BOXES);

console.log('=== data-box が付いている ===');
await setup({});
let has=await p.evaluate((ids)=>ids.map(function(id){
  const d=$(id); return id+':'+(d&&d.hasAttribute('data-box')?'1':'0'); }),BOXES);
console.log('   '+has.join(' '));
ok(has.every(function(x){ return /:1$/.test(x); }),
   '★★対象の折りたたみ全部に印が付いている');

console.log('\n=== 描き直しても開閉が戻らない ===');
await setup({});
let b=await boxes();
console.log('   はじめ: '+JSON.stringify(b));
ok(b.syncPriceBox===true,'★★値下げの時期が来ていれば「価格の操作」は自動で開く');
/* 人が閉じる → 描き直しても閉じたまま */
await p.evaluate(()=>{ $('syncPriceBox').open=false; });
await p.waitForTimeout(60);
await p.evaluate(()=>{ syncRender(); });
b=await boxes();
console.log('   閉じたあと: '+JSON.stringify({price:b.syncPriceBox,saved:b.saved}));
ok(b.syncPriceBox===false,'★★人が閉じたら、描き直しても開かない');
ok(b.saved.syncPriceBox===false,'★★閉じたことを端末に保存する');
/* 人が開ける → 保存される */
await p.evaluate(()=>{ $('syncMoreBox').open=true; $('syncNumBox').open=true;
                       $('syncHistBox').open=true; });
await p.waitForTimeout(60);
await p.evaluate(()=>{ syncRender(); });
b=await boxes();
console.log('   開けたあと: '+JSON.stringify(b.saved));
ok(b.syncMoreBox===true&&b.syncNumBox===true&&b.syncHistBox===true,
   '★★開けた折りたたみは描き直しても開いたまま');
ok(b.saved.syncMoreBox===true&&b.saved.syncNumBox===true
   &&b.saved.syncHistBox===true,'★★開けたことも保存する');
/* 一覧と写真の欄も同じ */
await p.evaluate(()=>{ $('syncListBox').open=false; $('syncPicsBox').open=true; });
await p.waitForTimeout(60);
await p.evaluate(()=>{ syncRender(); });
b=await boxes();
ok(b.syncListBox===false&&b.syncPicsBox===true,
   '★★「一覧」「写真を eBay 保管に切り替え」も覚える');

console.log('\n=== 行の操作（印のボタン）でも戻らない ===');
await openCsvBoxes(p);
/* 開閉はこのあとで決める（openCsvBoxes はテスト用に全部開けてしまうので）。 */
await p.evaluate(()=>{ $('syncPriceBox').open=false; $('syncMoreBox').open=true; });
await p.waitForTimeout(60);
await p.evaluate(()=>{
  const el=document.querySelector('#syncList [data-srow="B0BOX00001|used"]');
  const btn=el.querySelector('[data-sonhand]');
  if(btn)btn.click();
});
await p.waitForTimeout(400);
b=await boxes();
console.log('   '+JSON.stringify({price:b.syncPriceBox,more:b.syncMoreBox}));
ok(b.syncPriceBox===false&&b.syncMoreBox===true,
   '★★印のボタンを押しても開閉はそのまま');

console.log('\n=== 開き直しても前回の状態 ===');
await p.evaluate(()=>{
  /* 読み込み直しのかわりに、保存した値から当てはめ直す（起動時と同じ処理）。 */
  $('syncPriceBox').open=true; $('syncMoreBox').open=false;
  boxApply();
});
b=await boxes();
console.log('   '+JSON.stringify({price:b.syncPriceBox,more:b.syncMoreBox,
  saved:b.saved}));
ok(b.syncPriceBox===false&&b.syncMoreBox===true,
   '★★起動時に保存した状態へ戻す（boxApply）');
let reload=await p.evaluate(async()=>{
  const before=JSON.parse(localStorage.getItem('pj:boxopen:v1')||'{}');
  return { before:before, known:boxKnown('syncPriceBox'),
           isOpen:boxIsOpen('syncMoreBox') };
});
ok(reload.known===true&&reload.isOpen===true,'★保存した値を読めている');

console.log('\n=== まだ一度も開閉していないときは自動で開く ===');
await setup({});                      // 保存を消して作り直す
b=await boxes();
ok(b.syncPriceBox===true,'★★初めてのときは「価格の操作」を自動で開く');
console.log('   保存: '+JSON.stringify(b.saved));
ok(b.saved.syncPriceBox===undefined,
   '★★自動で開いた分は保存しない（人が押したときだけ覚える）');
await setup({nomark:true});           // 値下げの時期が来ていない
b=await boxes();
console.log('   値下げの時期なし: '+JSON.stringify({price:b.syncPriceBox}));
ok(b.syncPriceBox===false,'★値下げの時期が無ければ開かない');

console.log('\n=== 描き直しでスクロールが飛ばない ===');
await setup({});
await openCsvBoxes(p);
let sc=await p.evaluate(async()=>{
  const el=document.querySelector('#syncList [data-srow="B0BOX00008|used"]');
  el.scrollIntoView({block:'center'});
  await new Promise(function(r){ setTimeout(r,80); });
  const y0=window.scrollY;
  const t0=el.getBoundingClientRect().top;
  /* 上の帯の高さが変わる状況をまねる（警告を1つ増やす）。 */
  syncData.items[0].warnings=['予約済み（内訳不明）'];
  syncRender();
  const el2=document.querySelector('#syncList [data-srow="B0BOX00008|used"]');
  return { y0:y0, y1:window.scrollY, t0:Math.round(t0),
           t1:Math.round(el2.getBoundingClientRect().top),
           inView:el2.getBoundingClientRect().top>0
                  &&el2.getBoundingClientRect().top<window.innerHeight };
});
console.log('   '+JSON.stringify(sc));
ok(Math.abs(sc.t1-sc.t0)<=2,'★★目印の行が同じ位置に残る');
ok(sc.inView===true,'★★操作した行が画面内に残る');
ok(sc.y0!==0,'★テストが実際にスクロールしている');

console.log('\n=== チェックだけの操作では一覧を作り直さない ===');
await setup({});
await openCsvBoxes(p);
let pick=await p.evaluate(()=>{
  const list=$('syncList');
  const el=list.querySelector('#syncList [data-srow="B0BOX00003|used"]')
    ||list.querySelector('[data-srow="B0BOX00003|used"]');
  el.setAttribute('data-sentinel','1');         // 作り直されたら消える印
  const cb=el.querySelector('[data-spick]');
  cb.checked=true;
  cb.dispatchEvent(new Event('change',{bubbles:true}));
  const keep=list.querySelector('[data-srow="B0BOX00003|used"]')
    .hasAttribute('data-sentinel');
  return { keep:keep, note:$('syncPickNote').textContent,
           n:Object.keys(syncPick).filter(function(k){ return syncPick[k]; }).length,
           bar:getComputedStyle($('syncBar')).display };
});
console.log('   '+JSON.stringify({keep:pick.keep,n:pick.n})+'／'+pick.note.slice(0,60));
ok(pick.keep===true,'★★一覧を作り直さない（印が残る）');
ok(pick.n===1,'★選択の控えは増える');
ok(/選択 1件/.test(pick.note),'★★件数の表示だけ直す');
ok(pick.bar!=='none','★下の操作バーは出る');

console.log('\n=== 「ページ内を全て選択」も作り直さない ===');
let all=await p.evaluate(()=>{
  const list=$('syncList');
  list.querySelector('[data-srow="B0BOX00005|used"]')
    .setAttribute('data-sentinel','1');
  const a=$('syncPageAll');
  a.checked=true;
  a.dispatchEvent(new Event('change',{bubbles:true}));
  const el=list.querySelector('[data-srow="B0BOX00005|used"]');
  const boxes=Array.prototype.slice.call(list.querySelectorAll('[data-spick]'));
  return { keep:el.hasAttribute('data-sentinel'),
           checked:boxes.filter(function(c){ return c.checked; }).length,
           total:boxes.length,
           n:Object.keys(syncPick).filter(function(k){ return syncPick[k]; }).length,
           note:$('syncPickNote').textContent };
});
console.log('   '+JSON.stringify({keep:all.keep,checked:all.checked,
  total:all.total,n:all.n}));
ok(all.keep===true,'★★一覧を作り直さない');
ok(all.checked===all.total&&all.total===12,'★★出ている行のチェックが全部入る');
ok(all.n===12,'★選択の控えも全部');
ok(/選択 12件/.test(all.note),'★★件数の表示を直す');
let off=await p.evaluate(()=>{
  const a=$('syncPageAll');
  a.checked=false; a.dispatchEvent(new Event('change',{bubbles:true}));
  const boxes=Array.prototype.slice.call(
    $('syncList').querySelectorAll('[data-spick]'));
  return { checked:boxes.filter(function(c){ return c.checked; }).length,
           n:Object.keys(syncPick).filter(function(k){ return syncPick[k]; }).length };
});
ok(off.checked===0&&off.n===0,'★★外すときも同じ');

console.log('\n=== チェックの操作でも折りたたみは動かない ===');
let bb=await p.evaluate(()=>{
  $('syncPriceBox').open=false;
  const cb=$('syncList').querySelector('[data-spick]');
  cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true}));
  return { price:$('syncPriceBox').open };
});
ok(bb.price===false,'★★チェックを付けても開かない');

console.log('\n=== 出品CSVタブの折りたたみも覚える（6.81）===');
await setup({});
let csvb=await p.evaluate(()=>{
  const ids=['csvNewBox','csvListBox','csvPicFindBox','csvTrashBox','csvLogBox'];
  const miss=ids.filter(function(id){
    const d=$(id); return !d||!d.hasAttribute('data-box'); });
  /* 「新しい仕入れ」は隠れていると閉じられるので、出してから試す。 */
  $('csvShowNew').checked=true; csvNewBoxApply();
  switchTab('D');
  ids.forEach(function(id){ const d=$(id); if(d)d.open=false; });
  return { miss:miss };
},0);
console.log('   印が無いもの: '+JSON.stringify(csvb.miss));
ok(csvb.miss.length===0,'★★出品リスト・新しい仕入れ・写真を探す・ログ・ごみ箱に印');
await p.waitForTimeout(80);
/* 人が開けるところまでをまねる（開く → 一部を閉じる）。
   既定で閉じている箱に open=false を入れても toggle は起きないので、
   いったん開けてから閉じる。 */
await p.evaluate(()=>{
  ['csvNewBox','csvListBox','csvPicFindBox','csvTrashBox','csvLogBox']
    .forEach(function(id){ $(id).open=true; });
});
await p.waitForTimeout(80);
await p.evaluate(()=>{ $('csvNewBox').open=false; $('csvLogBox').open=false; });
await p.waitForTimeout(80);
let csv3=await p.evaluate(()=>{
  csvRender();                       // 出品CSV側の描き直し
  return { list:$('csvListBox').open, trash:$('csvTrashBox').open,
    newb:$('csvNewBox').open, log:$('csvLogBox').open,
    saved:JSON.parse(localStorage.getItem('pj:boxopen:v1')||'{}') };
});
console.log('   '+JSON.stringify(csv3));
ok(csv3.list===true&&csv3.trash===true,'★★開けたものは描き直しても開いたまま');
ok(csv3.newb===false&&csv3.log===false,'★★閉じたものは閉じたまま');
ok(csv3.saved.csvListBox===true&&csv3.saved.csvTrashBox===true
   &&csv3.saved.csvPicFindBox===true,'★★開けたものを端末に保存する');
ok(csv3.saved.csvNewBox===false&&csv3.saved.csvLogBox===false,
   '★★閉じたものも端末に保存する');
let csv4=await p.evaluate(()=>{
  /* 起動時と同じ当てはめ。わざと逆にしてから戻す。 */
  $('csvListBox').open=false; $('csvNewBox').open=true;
  boxApply();
  return { list:$('csvListBox').open, newb:$('csvNewBox').open };
});
ok(csv4.list===true&&csv4.newb===false,'★★開き直しても前回の状態（boxApply）');

console.log('\n=== 「新しい仕入れ」を隠したときの閉じるは覚えない ===');
let hide=await p.evaluate(()=>{
  $('csvNewBox').open=true;
  return 1;
});
await p.waitForTimeout(80);
let hide2=await p.evaluate(()=>{
  const before=JSON.parse(localStorage.getItem('pj:boxopen:v1')||'{}').csvNewBox;
  $('csvShowNew').checked=false; csvNewBoxApply();   // 隠す＝自動で閉じる
  const after=JSON.parse(localStorage.getItem('pj:boxopen:v1')||'{}').csvNewBox;
  return { before:before, after:after, open:$('csvNewBox').open };
});
console.log('   '+JSON.stringify(hide2));
ok(hide2.open===false,'★隠すと閉じる');
ok(hide2.before===true&&hide2.after===true,
   '★★自動で閉じた分は覚えない（また出したときは開いた状態）');

console.log('\n=== 画面に出る時刻は日本時間（6.82）===');
let tz=await p.evaluate(()=>({
  t:jstText('2026-10-21T18:15:00.000Z'),
  sh:jstShort('2026-10-21T18:15:00.000Z'),
  d:jstDay('2026-10-21T18:15:00.000Z'),
  md:jstMd('2026-10-21T18:15:00.000Z'),
  noTz:jstText('2026-10-21T18:15:00'),       // 時間帯なし＝UTC とみなす
  bad:jstText('へんな値'), empty:jstText('')
}));
console.log('   '+JSON.stringify(tz));
ok(tz.t==='2026-10-22 03:15','★★UTC の 18:15 は日本時間の翌日 03:15');
ok(tz.sh==='10-22 03:15','★年を省いた形');
ok(tz.d==='2026-10-22'&&tz.md==='10月22日','★日付だけの形');
ok(tz.noTz==='2026-10-22 03:15','★★時間帯が付いていなければ UTC とみなす');
ok(tz.bad==='へんな値'&&tz.empty==='','★読めない値はそのまま');
/* 帯の「前回」が日本時間で出ること。 */
await setup({last:{at:'2026-10-21T18:15:00Z',mode:'on',changed:3,failed:16,
  skipped:5,capped:0}});
await openCsvBoxes(p);
let md2=await p.evaluate(()=>{
  $('autoMdMode').value='on';            // 帯は自動値下げがオフだと出ない
  syncRender();
  return $('syncMdNote').textContent;
});
console.log('   '+md2.replace(/\n/g,' / ').slice(0,160));
ok(/前回（2026-10-22 03:15/.test(md2),'★★「前回」を日本時間で出す');
ok(!/2026-10-21 18:15/.test(md2),'★★UTC のままでは出さない');

console.log('\n=== eBay の書き込みに失敗した行を「対応が必要」に出す（6.82）===');
await setup({});
await p.evaluate(()=>{
  var a=syncRowBy('B0BOX00001|used');
  a.revise_err='自動値下げ 22003 / Auto decline amount cannot be greater / x';
  a.revise_err_at='2026-10-21T18:15:00Z';
  var b=syncRowBy('B0BOX00002|used');
  b.revise_err='売値の自動反映 21919137 / Picture is too small / x';
  var c=syncRowBy('B0BOX00003|used');
  c.revise_err='在庫補充（数量を1に戻す） 21919188 / cannot be revised / x';
  syncMemoClear(); syncRender();
});
let we=await p.evaluate(()=>{
  $('syncFilter').value='warn'; syncRender();
  var keys=Array.prototype.map.call(
    document.querySelectorAll('#syncList [data-srow]'),
    function(e){ return e.getAttribute('data-srow'); });
  var el=document.querySelector('#syncList [data-srow="B0BOX00001|used"]');
  return { keys:keys, txt:el?el.innerText.replace(/\n/g,' | '):'',
    src:[syncErrSrc('自動値下げ 22003 / x'),
         syncErrSrc('売値の自動反映 1 / x'),
         syncErrSrc('在庫補充（数量を1に戻す） 1 / x'),
         syncErrSrc('再調達中の売値 1 / x'),
         syncErrSrc('なにか')] };
});
console.log('   '+JSON.stringify(we.keys));
console.log('   '+we.txt.slice(0,200));
ok(we.keys.indexOf('B0BOX00001|used')>=0,'★★22003 で失敗した行が入る');
ok(we.keys.indexOf('B0BOX00002|used')>=0,'★★写真のエラーの行も入る（今までどおり）');
ok(we.keys.indexOf('B0BOX00003|used')>=0,'★★在庫補充の失敗も入る');
ok(we.keys.indexOf('B0BOX00004|used')<0,'★失敗していない行は入らない');
ok(/自動値下げに失敗/.test(we.txt),'★★どの処理で失敗したかを出す');
ok(/ベストオファー金額/.test(we.txt),'★★理由を日本語で出す');
console.log('   '+JSON.stringify(we.src));
ok(we.src[0]==='自動値下げ'&&we.src[1]==='売値の自動反映'
   &&we.src[2]==='在庫補充'&&we.src[3]==='再調達中の売値',
   '★★処理の名前を revise_err の先頭から読む');
ok(we.src[4]==='eBay への書き込み','★分からなければそう書く');

console.log('\n=== 写真が小さい行は「写真が小さい（要撮り直し）」に入る ===');
let pf=await p.evaluate(()=>{
  $('syncFilter').value='picsneed'; syncRender();
  return Array.prototype.map.call(
    document.querySelectorAll('#syncList [data-srow]'),
    function(e){ return e.getAttribute('data-srow'); });
});
console.log('   '+JSON.stringify(pf));
ok(pf.indexOf('B0BOX00002|used')>=0,'★★写真が500px未満で弾かれた行が入る');
ok(pf.indexOf('B0BOX00001|used')<0,'★★22003 の行は入らない（写真の話ではない）');

console.log('\n=== 「対応が必要」の内訳を理由ごとに分ける（6.83）===');
await setup({});
let br=await p.evaluate(()=>{
  var a=syncRowBy('B0BOX00001|used');
  a.revise_err='自動値下げ 22003 / Auto decline amount cannot be greater / x';
  var b=syncRowBy('B0BOX00002|used');
  b.revise_err='自動値下げ 21919137 / Picture is too small / x';
  var c=syncRowBy('B0BOX00003|used');
  c.revise_err='売値の自動反映 21919188 / cannot be revised / x';
  var d=syncRowBy('B0BOX00004|used');
  d.revise_err='自動値下げ 22003 / Auto decline amount cannot be greater / x';
  syncMemoClear(); syncRender();
  return $('syncWarnBreak').textContent;
});
console.log('   '+br.replace(/\n/g,' / ').slice(0,220));
ok(/写真が500px未満 1件/.test(br),
   '★★写真のエラーだけを「写真が500px未満」として数える');
ok(/ベストオファー金額（22003） 2件/.test(br),'★★22003 は別に数える');
ok(/eBay への書き込みに失敗 1件/.test(br),'★★そのほかも別に数える');
ok(!/写真が500px未満 4件/.test(br),
   '★★失敗の全部を写真の問題として数えない（v183 の数え違い）');

console.log('\n=== 写真が小さい行の案内 ===');
let pg=await p.evaluate(()=>{
  $('syncFilter').value='all'; syncRender();
  const el=document.querySelector('#syncList [data-srow="B0BOX00002|used"]');
  return el?el.innerText.replace(/\n/g,' | '):'';
});
console.log('   '+pg.slice(0,240));
ok(/写真が500px未満/.test(pg),'★理由を出す');
ok(/「写真を eBay 保管に切り替え」でこの行を確かめると/.test(pg),
   '★★差し替えたあとの戻し方を書く（6.83）');

await T.done();
})();
