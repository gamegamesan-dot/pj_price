/* 販売連携：売れた値段で保ち、同じ値段で再出品する（6.77）
   ・行に「売れた値段で保っています（$xx.xx・○月○日に売れた）」
   ・自動値下げが止まる（一度も値下げしていない行も止まる＝穴①）
   ・売値の自動反映の値上げも止まる（穴②）
   ・「値下げを再開」ボタン（確認つき・操作の履歴に残る＝穴③）
   ・帯に「保っている n件／再出品の予定 n件／前回の結果」
   ・再出品できない行は「対応が必要」に出て、理由を行に出す
   ・「確認してから」では kind=soldkeep を approve で送る（戻せない履歴）
   ・⚙設定「売れたあとの再出品：確認してから（既定）／自動で実行」
   ・作業者のキーでは帯を出さない・値下げを再開できない */
const { harness, openCsvBoxes, clickCfg } = require('./lib');
const T = harness('販売連携：売れた値段で再出品');
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
  $('autoAdRate').value='6'; $('autoRvMode').value='confirm';
  $('autoMdMode').value='auto'; $('pbMode').value='off'; $('autoRkMode').value='off';
  $('autoSkMode').value=o.mode||'confirm';
  $('csvMarkStep').value='1'; $('csvMarkTimes').value='10';
  $('syncSkipAcc').checked=true; $('syncTol').value='200';
  window.__posts=[]; window.__sync=[]; window.__loaded=0;
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(o2,st)=>Promise.resolve({ok:!st||st<400,status:st||200,
      text:()=>Promise.resolve(JSON.stringify(o2)), json:()=>Promise.resolve(o2)});
    if(/\/whoami/.test(url))return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/status/.test(url)){ window.__loaded++;
      return res({counts:{},items:[],last_runs:[],sold_recent:[]}); }
    if(/\/settings/.test(url))return res({ok:true,stored:true});
    if(/\/listings/.test(url)){ window.__posts.push(body.items);
      return res({accepted:(body.items||[]).length,rejected:0}); }
    if(/\/sync/.test(url)){ window.__sync.push(body);
      return res({mode:'approve',picked:2,relisted:2,failed:0,ended:0,capped:0}); }
    return real(u,i);
  };
  const NOW=new Date().toISOString();
  const SOLD='2026-10-19T04:00:00Z';
  /* 値下げの途中で売れて数量0になった行。仕入れ直せば出せる。 */
  const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'88'+asin.slice(-4),ebay_qty:0,
    ebay_price:52.16,title:asin+'の商品',cost_yen:3980,weight_g:null,
    one_off:0,one_off_known:1,dropship:0,restocking:0,on_hand:0,hand_qty:null,
    mode:null,sold_keep:1,sold_price:52.16,sold_kept_at:SOLD,
    sk_act:null,sk_why:null,sk_at:null,sk_done_at:null,sk_fail:0,
    fba_available:0,fba_inbound:0,fba_reserved:0,fba_res_cust:null,
    fba_res_trans:null,fba_res_proc:null,fba_seen_at:NOW,
    mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:SOLD,ebay_bo:0,ebay_sale:0,
    md_step:1,md_start:58.00,md_floor:40,md_n:10,md_done:3,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,
    revise_err:null,rk_want:null,rk_floor:null,rk_low:null,rk_n:null,
    rk_max_cost:null,rk_want_at:null,rk_fail:0,
    pics_eps:1,pb_act:null,pb_why:null,pb_skip:0,pb_fail:0,pb_want:null,
    amazon_lowest:3000,amazon_offers:3,
    amazon_offers_json:'[{"p":3000,"c":"good"},{"p":3050,"c":"good"}]',
    amazon_lowest_at:NOW,mw_low:null,mw_low_at:null,mw_n:null,mw_stock:null,
    sold_usd:null,warnings:[],notes:[],state:'ok'},x||{});
  syncData={at:NOW,counts:{},items:(o.items||[
    it('B0SKU00001'),                                   // 仕入れ直して出せる
    it('B0SKU00002',{fba_available:2,amazon_lowest:90000,
      amazon_offers_json:'[{"p":90000,"c":"good"}]'}),  // 手持ちで出せる
    it('B0SKU00003',{amazon_lowest:90000,
      amazon_offers_json:'[{"p":90000,"c":"good"}]'}),  // 赤字 → 出せない
    it('B0SKU00004',{one_off:1}),                       // 一点物 → 出せない
    it('B0SKU00005',{ebay_qty:2,mark_at:null,md_done:0}), // 2点以上・値下げ停止だけ
    it('B0SKU00006',{sold_keep:0,sold_price:null,sold_kept_at:null,
      ebay_qty:1,md_done:0})                            // 保っていない（比べる用）
  ]),
    sk_last:o.last||null, sk_plan:o.plan||null};
  if($('syncFilter'))$('syncFilter').value='all';
  csvList=[]; csvSaveList(); syncPick={};
  syncUndoList=[]; syncUndoSave(); syncUndoHide();
  switchTab('E'); roleCheck(); syncRender();
},o||{});

const view=async()=>await p.evaluate(()=>({
  bar:getComputedStyle($('syncSkBar')).display,
  note:$('syncSkNote').textContent, list:$('syncSkList').textContent,
  done:$('syncSkDone').textContent,
  goShow:$('syncSkGo').style.display, goDis:$('syncSkGo').disabled,
  goText:$('syncSkGo').textContent,
  n:syncSkPlanRows().n, from:syncSkPlanRows().from,
  rows:syncSkPlanRows().rows, stuck:syncSkStuck().length,
  posts:JSON.parse(JSON.stringify(window.__posts)),
  sync:JSON.parse(JSON.stringify(window.__sync)) }));
const rowText=async(key)=>await p.evaluate((k)=>{
  const el=document.querySelector('#syncList [data-srow="'+k+'"]');
  return el?el.innerText:''; },key);

console.log('=== 行に「売れた値段で保っています」===');
await setup({});
await openCsvBoxes(p);
let t1=await rowText('B0SKU00001|used');
console.log('   '+t1.replace(/\n/g,' / ').slice(0,260));
ok(/売れた値段で保っています/.test(t1),'★★印を出す');
ok(/\$52\.16/.test(t1),'★★売れた値段を出す');
ok(/10月19日に売れた/.test(t1),'★★売れた日を出す');
ok(/値下げも値上げもしません/.test(t1),'★止まることを書く');
let t6=await rowText('B0SKU00006|used');
ok(!/売れた値段で保っています/.test(t6),'★保っていない行には出さない');

console.log('=== 自動値下げが止まる（穴①：一度も値下げしていない行も）===');
let md=await p.evaluate(()=>({
  s1:syncMarkSkip(syncRowBy('B0SKU00001|used')),
  s5:syncMarkSkip(syncRowBy('B0SKU00005|used')),
  s6:syncMarkSkip(syncRowBy('B0SKU00006|used')),
  due5:syncMarkDue(syncRowBy('B0SKU00005|used')),
  due6:syncMarkDue(syncRowBy('B0SKU00006|used')),
  next5:syncMdDueAt(syncRowBy('B0SKU00005|used')),
  rows:syncMarkRows().map(function(r){ return r.asin; }) }));
console.log('   '+JSON.stringify(md));
/* 2点以上で1点売れた行（数量が残る）。印を見るまでは、
   一度も値下げしていない（mark_at が空）せいで止まらなかった。 */
ok(md.s5==='売れた値段で保っています',
   '★★2点以上で1点売れた行（印あり・値下げ歴なし）も止まる');
ok(md.due5===false,'★★値下げの対象から外れる');
ok(md.next5===null,'★★次の自動値下げの予定も出さない');
ok(md.s1==='数量0','★数量0の行は今までどおり先に「数量0」で止まる');
ok(md.s6!=='売れた値段で保っています'&&md.due6===true,
   '★★印の無い行は今までどおり値下げする');
ok(md.rows.indexOf('B0SKU00005')<0,'★★値下げの一覧に入らない');

console.log('=== 値上げも止まる（穴②）===');
let rv=await p.evaluate(()=>{
  var r=syncRowBy('B0SKU00005|used');
  r.rv_want=99; r.rv_floor=50; r.rv_kind='up';   // 目標が入っていても
  var r6=syncRowBy('B0SKU00006|used');
  r6.rv_want=99; r6.rv_floor=50; r6.rv_kind='up';
  return { a:syncRvActOf(r), need:syncRvNeed().filter(function(x){
    return x.asin==='B0SKU00005'; }).length,
    b:!!syncRvActOf(r6) };
});
console.log('   '+JSON.stringify(rv));
ok(rv.a===null,'★★売値の自動反映（値上げ）の対象にしない');
ok(rv.need===0,'★★見直しの目標も送らない');
ok(rv.b===true,'★印の無い行は今までどおり');

console.log('=== 帯（確認してから）===');
await setup({});
await openCsvBoxes(p);
let v=await view();
console.log('   '+v.note.replace(/\n/g,' / '));
console.log('   '+v.list.replace(/\n/g,' / '));
ok(v.bar!=='none','★保っている行があれば帯を出す');
ok(/売れた値段で保っている：5件/.test(v.note),'★★保っている件数を出す');
ok(/再出品は確認してから/.test(v.note),'★★いまの設定を出す');
ok(v.n===2&&v.from==='local','★★出せる2件だけが予定に入る');
ok(/「まとめて再出品」を押すまで eBay は変えません/.test(v.note),'★★そう書く');
ok(/2件は数量0のまま再出品できません/.test(v.note),'★★出せない件数を出す');
ok(/B0SKU00002の商品/.test(v.list)&&/手持ちの在庫/.test(v.list),
   '★★手持ちで出せる行はそう書く');
ok(/B0SKU00001の商品/.test(v.list)&&/仕入 ¥3,000/.test(v.list),
   '★★仕入れ直す行は仕入れ値と上限を出す');
ok(v.goShow!=='none'&&!v.goDis&&/まとめて再出品/.test(v.goText),
   '★★「まとめて再出品」を出す');
ok(/2/.test(v.goText),'★ボタンに件数を出す');

console.log('=== 売値は変えない・数量だけ戻す（予定の中身）===');
console.log('   '+JSON.stringify(v.rows[0]));
ok(v.rows[0].price===52.16,'★★売れた値段のまま（下げた今の売値ではない）');
ok(v.rows.every(function(x){ return !('to' in x); }),'★売値を動かす予定は持たない');

console.log('=== 再出品できない行は「対応が必要」に出る ===');
let t3=await rowText('B0SKU00003|used');
console.log('   '+t3.replace(/\n/g,' / ').slice(0,260));
ok(/下限利益を割ります/.test(t3),'★★理由を行に出す');
ok(/90,000/.test(t3),'★いまの仕入れ値を出す');
let t4=await rowText('B0SKU00004|used');
ok(/一点物/.test(t4),'★★一点物は対象外と出す');
let warn=await p.evaluate(()=>{
  $('syncFilter').value='warn'; syncRender();
  return Array.from(document.querySelectorAll('#syncList [data-srow]'))
    .map(function(e){ return e.getAttribute('data-srow'); }); });
console.log('   対応が必要：'+JSON.stringify(warn));
ok(warn.indexOf('B0SKU00003|used')>=0&&warn.indexOf('B0SKU00004|used')>=0,
   '★★数量0のまま出せない行は「対応が必要」に入る');
ok(warn.indexOf('B0SKU00001|used')<0,'★★出せる行は入らない');
ok(warn.indexOf('B0SKU00005|used')<0,'★数量がある行は入らない');

console.log('=== まとめて再出品 ===');
await setup({});
await openCsvBoxes(p);
dlg=[];
await p.click('#syncSkGo');
await p.waitForTimeout(320);
v=await view();
console.log('   確認：'+(dlg[0]||'').replace(/\n/g,' / ').slice(0,200));
console.log('   送った：'+JSON.stringify(v.sync));
console.log('   '+v.done);
ok(dlg.length===1&&/数量を1に戻します（2件）/.test(dlg[0]),'★★確認画面に件数を出す');
ok(/売値は変えません/.test(dlg[0]),'★★売値は変えないと書く');
ok(/1日に戻す上限は 30件/.test(dlg[0]),'★★1日の上限を書く');
ok(v.sync.length===1&&v.sync[0].kind==='soldkeep'&&v.sync[0].approve===true,
   '★★kind=soldkeep を approve で送る');
ok(/再出品 2件/.test(v.done),'★結果を出す');
let hist=await p.evaluate(()=>$('syncHistList').innerText);
ok(/売れた値段でまとめて再出品/.test(hist)&&/eBay への変更は戻せません/.test(hist),
   '★★操作の履歴に「戻せません」として残す');

console.log('=== 確認でやめたら送らない ===');
await setup({});
await openCsvBoxes(p);
cancel=true; dlg=[];
await p.click('#syncSkGo');
await p.waitForTimeout(200);
ok((await view()).sync.length===0,'★★やめたら送らない');
cancel=false;

console.log('=== 自動で実行する ===');
await setup({mode:'auto'});
await openCsvBoxes(p);
v=await view();
console.log('   '+v.note.replace(/\n/g,' / '));
ok(/再出品は自動で実行/.test(v.note),'★★いまの設定を出す');
ok(/承認なしで数量を1に戻します/.test(v.note),'★★承認なしであることを書く');
ok(v.goShow==='none','★★自動のときは「まとめて再出品」を出さない');

console.log('=== 値下げを再開する（穴③）===');
await setup({});
await openCsvBoxes(p);
dlg=[];
let before=await p.evaluate(()=>{
  const el=document.querySelector('#syncList [data-srow="B0SKU00001|used"]');
  return !!el.querySelector('[data-sresume]'); });
ok(before,'★★印のある行に「値下げを再開」ボタンを出す');
ok(!(await p.evaluate(()=>{
  const el=document.querySelector('#syncList [data-srow="B0SKU00006|used"]');
  return !!el.querySelector('[data-sresume]'); })),'★印の無い行には出さない');
await p.click('#syncList [data-srow="B0SKU00001|used"] [data-sresume]');
await p.waitForTimeout(320);
v=await view();
console.log('   確認：'+(dlg[0]||'').replace(/\n/g,' / '));
let sent=(v.posts.find(function(a){ return a&&a[0]&&('sold_keep' in a[0]); })||[]);
console.log('   送った：'+JSON.stringify(sent[0]));
ok(/値下げを再開します/.test(dlg[0]||''),'★★確認してから送る');
ok(/売れた値段：\$52\.16/.test(dlg[0]||''),'★★売れた値段を見せる');
ok(/この値段から同じ幅で下げ直します/.test(dlg[0]||''),
   '★★売れた値段から数え直すと書く');
ok(sent.length===1&&sent[0].sold_keep===false,
   '★★/listings に sold_keep=false を送る');
let after=await p.evaluate(()=>{
  const r=syncRowBy('B0SKU00001|used');
  return { keep:r.sold_keep, mark:r.mark_at, done:r.md_done, act:r.sk_act,
           fail:r.sk_fail, note:$('syncFixNote').textContent,
           html:(document.querySelector('#syncList [data-srow="B0SKU00001|used"]')
                 ||{}).innerText||'',
           md:syncMarkSkip(r) };
});
console.log('   '+JSON.stringify({keep:after.keep,mark:after.mark,done:after.done}));
ok(after.keep===0,'★★印が外れる');
ok(after.done===0,'★★進めた回数が0に戻る（売れた値段から数え直す）');
ok(after.mark===null,'★最後に値下げした日も消える');
ok(after.act===null&&after.fail===0,'★予定と失敗の回数も消える');
ok(!/売れた値段で保っています/.test(after.html),'★★行の印が消える');
ok(after.md!=='売れた値段で保っています','★★値下げの対象に戻る');
ok(/値下げを再開しました/.test(after.note),'★結果を出す');
let h2=await p.evaluate(()=>$('syncHistList').innerText);
console.log('   '+h2.replace(/\n/g,' / ').slice(0,160));
ok(/売れた値段で保つ/.test(h2),'★★操作の履歴に残る（この印は戻せる）');
ok(!/戻せません/.test(h2.split('\n')[0]||''),'★eBay は変えていないので戻せる');

console.log('=== pj-sync の予定と前回の結果を優先する ===');
await setup({last:{at:'2026-10-21T05:00:00Z',mode:'auto',picked:3,relisted:2,
  failed:0,ended:1,capped:0},
  plan:{at:'2026-10-21T06:00:00Z',n:1,capped:3,rows:[
    {asin:'B0SKU00001',cond:'used',name:'サクラ大戦（通常版）',price:52.16,
     hand:false,max:4572,buy_low:3000,buy_src:'amazon',why:'仕入れ直して出せます'}]}});
await openCsvBoxes(p);
v=await view();
console.log('   '+v.note.replace(/\n/g,' / '));
console.log('   '+v.list.replace(/\n/g,' / '));
ok(v.from==='sync'&&v.n===1,'★★pj-sync の予定があればそれを出す');
ok(/pj-sync の予定 2026-10-21 06:00/.test(v.note),'★いつの予定かを出す');
ok(/サクラ大戦（通常版）/.test(v.list)&&/\$52\.16/.test(v.list),'★★中身を出す');
ok(/1日の上限 30件を超えた 3件は翌日/.test(v.note),'★★上限を超えた件数を出す');
ok(/前回/.test(v.note)&&/再出品 2件/.test(v.note)
   &&/出品が終了していた 1件/.test(v.note),'★★前回の結果を出す');

console.log('=== 3回続けて失敗した行 ===');
await setup({items:null});
await p.evaluate(()=>{
  syncRowBy('B0SKU00001|used').sk_fail=3; syncMemoClear(); syncRender(); });
v=await view();
ok(/1件は3回続けて失敗しています/.test(v.note),'★★帯に出す');

console.log('=== 保っている行が無いときは出さない ===');
await setup({items:[]});
ok((await view()).bar==='none','★★帯を出さない');

console.log('=== ⚙設定 ===');
await setup({});
let cfg=await p.evaluate(()=>{
  switchTab('G');
  const s=$('autoSkMode');
  return { v:s.value, opts:Array.from(s.options).map(function(o){ return o.value; }),
           txt:Array.from(s.options).map(function(o){ return o.text; }).join(' / '),
           adv:ADV_PB.indexOf('autoSkMode')>=0,
           csv:CSV_CFG_IDS.indexOf('autoSkMode')>=0 };
});
console.log('   '+JSON.stringify(cfg));
ok(cfg.opts.join(',')==='confirm,auto','★★確認してから／自動で実行');
ok(/確認してから/.test(cfg.txt)&&/自動/.test(cfg.txt),'★表示も日本語');
ok(cfg.adv,'★★⚙設定として pj-sync に送る（Worker も同じ設定で動く）');
ok(cfg.csv,'★この端末にも保存する');

console.log('=== 作業者のキー ===');
await setup({role:'staff'});
await openCsvBoxes(p);
v=await view();
ok(v.bar==='none','★★作業者のキーでは帯を出さない');
let st=await p.evaluate(()=>{
  const el=document.querySelector('#syncList [data-srow="B0SKU00001|used"]');
  const b=el?el.querySelector('[data-sresume]'):null;
  if(b)b.click();
  return { had:!!b, posts:window.__posts.length,
           note:$('syncFixNote').textContent }; });
console.log('   '+JSON.stringify(st));
ok(st.posts===0,'★★値下げを再開できない（送らない）');
ok(!st.had||/管理者/.test(st.note),'★理由を出す');

await T.done();
})();
