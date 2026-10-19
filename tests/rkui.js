/* 販売連携：再調達中の売値の追従（6.70）
   ・⚙設定「再調達中の売値：自動で更新する（既定）／確認してから」
   ・帯に「再調達中 n件／変更の予定 n件／下げを保留 n件／前回の結果」
   ・売値は Amazon最安値（可を除く）を仕入値とみなした推奨売値。保存済みの仕入値は使わない
   ・上げも下げも追従。下げは最低売値より下げない。差が小さい行は出さない
   ・最安グループが2人未満なら下げを保留。Amazonの在庫が消えたら数量0
   ・この行は「売値の自動反映」の対象から外れる
   ・「再調達中の目標を送る」が rk_* を送る／「まとめて実行」は確認してからのときだけ
   ・「再調達で赤字」のバッジが2つ並ばない
   ・自動で反映された回は操作の履歴に「戻せません」として残る
   ・作業者のキーでは帯を出さない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('販売連携：再調達中の売値の追従');
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
  $('autoRvMode').value='confirm'; $('autoMdMode').value='off'; $('pbMode').value='off';
  $('autoRkMode').value=o.mode||'auto';
  $('syncSkipAcc').checked=true; $('syncTol').value='200';
  window.__posts=[]; window.__sync=[];
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(o2,st)=>Promise.resolve({ok:!st||st<400,status:st||200,
      text:()=>Promise.resolve(JSON.stringify(o2)), json:()=>Promise.resolve(o2)});
    if(/\/whoami/.test(url))return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/status/.test(url))return res({counts:{},items:[],last_runs:[],sold_recent:[]});
    if(/\/settings/.test(url))return res({ok:true,stored:true});
    if(/\/listings/.test(url)){ window.__posts.push(body.items);
      return res({accepted:(body.items||[]).length,rejected:0}); }
    if(/\/sync/.test(url)){ window.__sync.push(body);
      return res({mode:'approve',up:2,down:1,zeroed:0,failed:0}); }
    return real(u,i);
  };
  /* 再調達中の行。仕入値（cost_yen）はあえて入れておく。
     それでも売値は Amazon最安値基準で出ること（6.70）を見張る。 */
  const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'77'+asin.slice(-4),ebay_qty:1,
    ebay_price:84.36,title:asin+'の商品',cost_yen:3980,weight_g:150,
    one_off:0,one_off_known:1,dropship:0,restocking:1,on_hand:0,mode:'restock',
    restock_price:84.36,restock_max_cost:2500,
    fba_available:0,fba_inbound:0,fba_reserved:0,fba_res_cust:null,
    fba_res_trans:null,fba_res_proc:null,fba_seen_at:new Date().toISOString(),
    mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,ebay_sale:0,
    md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,revise_err:null,
    rk_want:null,rk_floor:null,rk_low:null,rk_n:null,rk_max_cost:null,
    rk_want_at:null,rk_fail:0,
    pics_eps:1,pb_act:null,pb_why:null,pb_skip:0,pb_fail:0,pb_want:null,
    amazon_lowest:9000,amazon_offers:3,
    amazon_offers_json:'[{"p":9000,"c":"good"},{"p":9100,"c":"verygood"},'
      +'{"p":9150,"c":"good"}]',
    amazon_lowest_at:new Date().toISOString(),
    sold_usd:null,warnings:[],notes:[],state:'ok'},x||{});
  syncData={at:new Date().toISOString(),counts:{},items:(o.items||[
    it('B0RKU00001'),                                     // 最安値が上がった（赤字）
    it('B0RKU00002',{ebay_price:200}),                    // 最安値が下がった
    it('B0RKU00003',{ebay_price:200,
      amazon_offers_json:'[{"p":9000,"c":"good"}]',amazon_offers:1}), // 1人 → 保留
    it('B0RKU00004',{amazon_lowest:0,amazon_offers:0,
      amazon_offers_json:'[]'}),                          // Amazonの在庫なし
    it('B0RKU00005',{restocking:0})                       // 再調達中でない
  ]).map(function(x){ return x; }),
    rk_last:o.last||null, rk_plan:o.plan||null};
  csvList=[]; csvSaveList(); syncPick={};
  syncUndoList=[]; syncUndoSave(); syncUndoHide();
  try{ localStorage.removeItem('pj:rkseen:v1'); }catch(e){}
  switchTab('E'); roleCheck(); syncRender();
},o||{});

const view=async()=>await p.evaluate(()=>({
  bar:getComputedStyle($('syncRkBar')).display,
  note:$('syncRkNote').innerText, list:$('syncRkList').innerText,
  done:$('syncRkDone').textContent,
  send:$('syncRkSend').textContent, sendDis:$('syncRkSend').disabled,
  goShow:$('syncRkGo').style.display, goDis:$('syncRkGo').disabled,
  n:syncRkPlanRows().n, held:syncRkPlanRows().held,
  rows:syncRkPlanRows().rows, need:syncRkNeed().length,
  posts:JSON.parse(JSON.stringify(window.__posts)),
  sync:JSON.parse(JSON.stringify(window.__sync)) }));
const rowText=async(key)=>await p.evaluate((k)=>{
  const el=document.querySelector('#syncList [data-srow="'+k+'"]');
  return el?el.innerText:''; },key);

console.log('=== 帯（自動で更新する）===');
await setup({});
await openCsvBoxes(p);
let v=await view();
console.log('   '+v.note.replace(/\n/g,' / '));
console.log('   '+v.list.replace(/\n/g,' / '));
ok(v.bar!=='none','★再調達中の行があれば帯を出す');
ok(/再調達中の売値：自動で更新/.test(v.note),'★★いまの設定を出す');
ok(/再調達中 4件/.test(v.note),'★★再調達中の件数を出す');
ok(/承認なしで eBay に反映します/.test(v.note),'★★承認なしであることを書く');
ok(v.n===3,'★★上げ1件・下げ1件・数量0の1件が予定に入る');
ok(v.held===1,'★★最安グループ1人の行は下げを保留して予定から外す');
ok(/最安グループが2人未満の 1件は下げを保留/.test(v.note),'★保留の件数を出す');
ok(v.goShow==='none','★★自動のときは「まとめて実行」を出さない');

console.log('=== 売値は Amazon最安値基準（保存済みの仕入値は使わない）===');
let calc=await p.evaluate(()=>{
  const r=syncRowBy('B0RKU00001|used');
  const t=syncRkTargetOf(r);
  return { kind:t.kind, to:t.to, want:t.want, low:t.low.low, n:t.n,
           amz:syncRecommend(r).price, cost:syncRecCost(r),
           basis:syncPbLowNote(r) };
});
console.log('   '+JSON.stringify(calc));
ok(calc.kind==='up'&&calc.to===calc.amz,
   '★★目標は Amazon最安値を仕入値とみなした推奨売値');
ok(calc.cost===null,'★★再調達中の行は保存済みの仕入値を使わない（syncRecCost が null）');
ok(calc.low===9000,'★基準にした最安値は可を除いた 9,000円');
ok(/Amazon最安値/.test(calc.basis)&&/9,000/.test(calc.basis),
   '★★「基準：Amazon最安値 ¥9,000（取得日時）」を出す');

console.log('=== 行に出す予定 ===');
let t1=await rowText('B0RKU00001|used');
console.log('   '+t1.replace(/\n/g,' / ').slice(0,300));
ok(/再調達中の売値を更新/.test(t1),'★★上げる行に予定を出す');
ok(/最安値が上がりました/.test(t1),'★理由を出す');
ok(/Amazon最安値/.test(t1)&&/9,000/.test(t1),'★★基準の最安値と取得日時を出す');
ok(/最安グループ 3人/.test(t1),'★最安グループの人数を出す');
ok(!/確認待ち/.test(t1),'★★「売値の自動反映の確認待ち」は出さない');
let t3=await rowText('B0RKU00003|used');
console.log('   '+t3.replace(/\n/g,' / ').slice(0,220));
ok(/下げを保留/.test(t3)&&/最安グループが1人/.test(t3),'★★保留の理由を行に出す');
let t4=await rowText('B0RKU00004|used');
ok(/Amazonの在庫がなくなりました/.test(t4),'★★在庫が消えた行は要対応で出す');
ok(/数量を0/.test(t4),'★数量0にすると書く');

console.log('=== 「再調達で赤字」のバッジは1つだけ ===');
await setup({items:null});
await p.evaluate(()=>{
  /* pj-sync も同じ警告を warnings に入れてくる（Worker の restockTrouble）。
     これまでは画面側のバッジと二重に出ていた（6.70 で直した）。 */
  var r=syncRowBy('B0RKU00001|used');
  r.amazon_lowest=30000; r.warnings=['再調達で赤字'];
  syncMemoClear(); syncRender();
});
let b1=await p.evaluate(()=>{
  const el=document.querySelector('#syncList [data-srow="B0RKU00001|used"]');
  return (el.innerText.match(/再調達で赤字/g)||[]).length; });
console.log('   バッジの数：'+b1);
ok(b1===1,'★★同じバッジを2つ出さない');

console.log('=== 売値の自動反映からは外れる ===');
await setup({});
let rv=await p.evaluate(()=>({
  act:syncRvActOf(syncRowBy('B0RKU00001|used')),
  need:syncRvNeed().filter(function(r){ return syncIsRestocking(r); }).length,
  plan:syncRvPlanRows().rows.filter(function(x){
    return String(x.asin||'').indexOf('B0RKU0000')===0
      &&x.asin!=='B0RKU00005'; }).length }));
console.log('   '+JSON.stringify(rv));
ok(rv.act===null,'★★再調達中の行は自動反映の対象にしない');
ok(rv.need===0,'★★見直しの目標も送らない');
ok(rv.plan===0,'★自動反映の予定にも入らない');

console.log('=== 目標を送る ===');
await setup({});
await openCsvBoxes(p);
v=await view();
/* Amazon最安値が取れていない行（B0RKU00004）は目標を出せないので送らない。 */
ok(v.need===3,'★★目標を送る行を数える（最安値が無い行は送らない）');
ok(/再調達中の目標を送る/.test(v.send)&&!v.sendDis,'★ボタンが押せる');
await p.click('#syncRkSend');
await p.waitForTimeout(260);
v=await view();
let sent=(v.posts.find(function(a){ return a&&a[0]&&('rk_want' in a[0]); })||[]);
console.log('   送った内容：'+JSON.stringify(sent[0]));
console.log('   '+v.done);
ok(sent.length>0,'★★/listings に rk_* を送る');
ok(sent[0].rk_want>0&&sent[0].rk_floor>0,'★目標と最低売値を送る');
ok(sent[0].rk_low===9000&&sent[0].rk_n===3,'★★最安値と最安グループの人数も送る');
ok(sent[0].rk_max_cost>0,'★仕入値の上限も送る');
ok(/pj-sync に残しました/.test(v.done),'★結果を出す');
ok((await view()).need===0,'★★送った行はもう送らない');

console.log('=== 確認してから ===');
await setup({mode:'confirm'});
await openCsvBoxes(p);
v=await view();
console.log('   '+v.note.replace(/\n/g,' / '));
ok(/確認してから/.test(v.note),'★★いまの設定を出す');
ok(/「まとめて実行」を押すまで eBay は変えません/.test(v.note),'★★そう書く');
ok(v.goShow!=='none'&&!v.goDis,'★★「まとめて実行」を出す');
let t1b=await rowText('B0RKU00001|used');
ok(/確認待ち/.test(t1b),'★行は「確認待ち」になる');
dlg=[];
await p.click('#syncRkGo');
await p.waitForTimeout(300);
v=await view();
console.log('   確認：'+(dlg[0]||'').replace(/\n/g,' / ').slice(0,160));
console.log('   送った種類：'+JSON.stringify(v.sync));
ok(dlg.length===1&&/上げる 1件／下げる 1件/.test(dlg[0]),'★★確認画面に内訳を出す');
ok(/Amazonの在庫なしで数量0 1件/.test(dlg[0]),'★数量0の件数も出す');
ok(v.sync.length===1&&v.sync[0].kind==='restockprice'&&v.sync[0].approve===true,
   '★★kind=restockprice を approve で送る');
ok(/上げた 2件／下げた 1件/.test(v.done),'★結果を出す');
let hist=await p.evaluate(()=>$('syncHistList').innerText);
ok(/再調達中の売値をまとめて実行/.test(hist)&&/eBay への変更は戻せません/.test(hist),
   '★★操作の履歴に「戻せません」として残す');

console.log('=== 確認でやめたら送らない ===');
await setup({mode:'confirm'});
await openCsvBoxes(p);
cancel=true; dlg=[];
await p.click('#syncRkGo');
await p.waitForTimeout(200);
v=await view();
ok(v.sync.length===0,'★★やめたら送らない');
cancel=false;

console.log('=== 前回の結果と、自動で反映された回の履歴 ===');
await setup({last:{at:'2026-10-19T02:00:00Z',mode:'auto',up:2,down:1,zeroed:1,
  failed:0,held:1}});
await openCsvBoxes(p);
v=await view();
console.log('   '+v.note.replace(/\n/g,' / '));
ok(/前回/.test(v.note)&&/上げた 2件／下げた 1件/.test(v.note),'★★前回の結果を出す');
let h2=await p.evaluate(()=>{ syncRkSeen(); return $('syncHistList').innerText; });
console.log('   '+h2.replace(/\n/g,' / ').slice(0,180));
ok(/再調達中の売値を自動で更新/.test(h2),'★★自動の回も操作の履歴に残す');
ok(/eBay への変更は戻せません/.test(h2),'★★戻せないと書く');
let h3=await p.evaluate(()=>{ syncRkSeen(); return syncUndoList.length; });
ok(h3===1,'★★同じ回を二度残さない');

console.log('=== pj-sync の予定を優先する ===');
await setup({plan:{at:'2026-10-19T03:00:00Z',n:1,capped:0,held:0,
  rows:[{asin:'B0RKU00001',cond:'used',name:'サクラ大戦（通常版）',kind:'up',
         from:84.36,to:101.23,want:101.23,low:9000,under:false}]}});
await openCsvBoxes(p);
v=await view();
console.log('   '+v.list.replace(/\n/g,' / '));
ok(v.n===1&&/pj-sync の予定/.test(v.note),'★★pj-sync の予定があればそれを出す');
ok(/サクラ大戦（通常版）/.test(v.list)&&/\$84\.36/.test(v.list)
   &&/\$101\.23/.test(v.list),'★★前後の売値を出す');
ok(/Amazon最安値 ¥9,000/.test(v.list),'★★基準の最安値を出す');

console.log('=== 再調達中の行が無いときは出さない ===');
await setup({items:[]});
await p.evaluate(()=>{ syncData.items=[]; syncRender(); });
v=await view();
ok(v.bar==='none','★★帯を出さない');

console.log('=== 作業者のキー ===');
await setup({role:'staff'});
await openCsvBoxes(p);
v=await view();
ok(v.bar==='none','★★作業者のキーでは帯を出さない');
let cfg=await p.evaluate(()=>{
  switchTab('G');
  return getComputedStyle($('autoRkMode').closest('.rowv')).display; });
ok(cfg==='none','★★⚙設定の項目も出さない');

await T.done();
})();
