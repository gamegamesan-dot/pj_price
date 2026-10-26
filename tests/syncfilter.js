/* 販売連携：一覧の絞り込みの整理（6.71）
   ・削除：「値下げの時期」→「自動値下げの予定」／「再調達の候補」→「FBAで売れた（対応予定）」
     （自動値下げがオフのときだけ「値下げの時期」を出す）
   ・名前の変更：「写真の切り替えが必要」→「写真が小さい（要撮り直し）」
   ・0件の項目は出さない（「すべて」「対応が必要」と、いま選んでいる項目は必ず出す）
   ・見出し（optgroup）で 毎日見る／出品／価格／状態 に分ける
   ・削除した絞り込みが選ばれていた端末は「すべて」に戻す
   ・「今日やること」からは 0件の項目も選べる */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('販売連携：絞り込みの整理');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

const DAY=86400000;
const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('csvMarkDays').value='3'; $('csvMarkStep').value='1';
  $('autoMdMode').value=o.md||'on'; $('autoRvMode').value='confirm';
  $('pbMode').value='plan'; $('autoRkMode').value='auto';
  const ago=new Date(Date.now()-9*86400000).toISOString();
  const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'66'+asin.slice(-4),ebay_qty:1,ebay_price:60,
    title:asin+'の商品',cost_yen:2000,weight_g:200,one_off:0,one_off_known:1,
    dropship:0,restocking:0,on_hand:0,mode:'hold',
    fba_available:1,fba_inbound:0,fba_reserved:0,fba_res_cust:null,
    fba_res_trans:null,fba_res_proc:null,fba_seen_at:new Date().toISOString(),
    mark_at:ago,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,ebay_sale:0,
    md_step:1,md_start:60,md_floor:40,md_n:10,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,revise_err:null,
    rk_want:null,rk_floor:null,rk_low:null,rk_n:null,rk_max_cost:null,rk_fail:0,
    pics_eps:1,pb_act:null,pb_why:null,pb_skip:0,pb_fail:0,pb_want:null,
    amazon_lowest:9000,amazon_offers:3,
    amazon_offers_json:'[{"p":9000,"c":"good"},{"p":9100,"c":"good"}]',
    amazon_lowest_at:new Date().toISOString(),
    sold_usd:null,warnings:[],notes:[],state:'ok'},x||{});
  syncData={at:new Date().toISOString(),counts:{},items:(o.items===undefined?[
    it('B0FLT00001',{warnings:['売り越しの恐れ']}),       // 対応が必要
    it('B0FLT00002',{fba_available:0}),                   // 再調達の候補＝FBAで売れた
    it('B0FLT00003',{on_hand:1,fba_available:null,fba_seen_at:null}), // FBA納品の判断
    it('B0FLT00004',{pics_eps:0}),                        // 写真が小さい
    it('B0FLT00005',{restocking:1}),                      // 再調達中
    it('B0FLT00006',{dropship:1})                         // 無在庫
  ]:o.items)};
  syncPick={}; csvList=[]; csvSaveList();
  switchTab('E'); roleCheck();
  if($('syncFilter').querySelector('option[value="all"]'))$('syncFilter').value='all';
  syncRender();
},o||{});

const opts=async()=>await p.evaluate(()=>
  Array.from($('syncFilter').options).map(o=>o.value+'|'+o.textContent));
const groups=async()=>await p.evaluate(()=>
  Array.from($('syncFilter').querySelectorAll('optgroup')).map(g=>
    g.label+'：'+Array.from(g.children).map(o=>o.value).join(',')));

console.log('=== 削除した絞り込み ===');
await setup({});
await openCsvBoxes(p);
let o=await opts();
console.log('   '+JSON.stringify(o));
ok(!o.some(x=>/^markdown\|/.test(x)),'★★自動値下げがオンなら「値下げの時期」は出さない');
ok(!o.some(x=>/^restock\|/.test(x)),'★★「再調達の候補」は出さない');
ok(await p.evaluate(()=>syncFilterHas('restock'))===false,
   '★★「再調達の候補」は絞り込みの表からも消す');
ok(await p.evaluate(()=>syncFilterHas('markdown'))===true,
   '★「値下げの時期」は表には残す（オフのときに使う）');

console.log('=== まとめ先に中身が入っている ===');
let n=await p.evaluate(()=>({
  pb:syncData.items.filter(syncFilterBy('pbplan').f).length,
  pbOnly:syncData.items.filter(function(r){ return !!syncPbActOf(r); }).length,
  re:syncData.items.filter(syncIsRestock).length,
  md:syncData.items.filter(syncFilterBy('automd').f).length,
  mdOnly:syncData.items.filter(syncMdTarget).length,
  due:syncData.items.filter(syncMarkDue).length }));
console.log('   '+JSON.stringify(n));
ok(n.re===1&&n.pb>=n.re,'★★「再調達の候補」の行は「FBAで売れた」に入る');
ok(await p.evaluate(()=>{
  var r=syncRowBy('B0FLT00002|used');
  return syncFilterBy('pbplan').f(r); })===true,
  '★★その行が実際に当たる');
ok(n.due>0&&n.md>=n.due,'★★「値下げの時期」の行は「自動値下げの予定」に入る');

console.log('=== 名前の変更 ===');
o=await opts();
ok(o.some(x=>/^picsneed\|写真が小さい（要撮り直し）/.test(x)),
   '★★「写真が小さい（要撮り直し）」に変える');
ok(!o.some(x=>/写真の切り替えが必要/.test(x)),'★★古い名前は出さない');

console.log('=== 0件の項目は出さない ===');
await setup({items:[]});
await p.evaluate(()=>{ syncData.items=[]; syncRender(); });
o=await opts();
console.log('   '+JSON.stringify(o));
ok(o.length===2,'★★0件だけのときは2つだけ');
ok(/^all\|/.test(o[0])&&/^warn\|/.test(o[1]),
   '★★「すべて」と「対応が必要」は0件でも必ず出す');

console.log('=== 見出し（optgroup）で分ける ===');
await setup({});
await openCsvBoxes(p);
let g=await groups();
console.log('   '+JSON.stringify(g));
ok(g.length===4,'★★見出しは4つ');
ok(g[0]==='毎日見る：all,warn,pbplan,on_hand','★★毎日見る：すべて／対応が必要／FBAで売れた／FBA納品の判断');
ok(g[1]==='出品：fba_not_listed,picsneed'||g[1]==='出品：picsneed',
   '★★出品：eBay出品の候補／写真が小さい');
ok(g[2]==='価格：automd,review'||g[2]==='価格：automd','★★価格：自動値下げの予定／売値の見直し');
ok(g[3]==='状態：restocking,dropship','★★状態：再調達中／無在庫');

console.log('=== 自動値下げがオフのとき ===');
await setup({md:'off'});
await openCsvBoxes(p);
o=await opts(); g=await groups();
console.log('   '+JSON.stringify(o.filter(x=>/markdown|automd/.test(x))));
ok(o.some(x=>/^markdown\|値下げの時期/.test(x)),
   '★★自動値下げがオフのときだけ「値下げの時期」を出す');
ok(/^価格：markdown/.test(g[2]),'★★「価格」の先頭に入れる');

console.log('=== 削除した絞り込みが選ばれていたら「すべて」に戻す ===');
await setup({});
let back=await p.evaluate(()=>{
  /* 古い端末に残っていた値を入れてみる（選択肢が無いので入らない）。 */
  $('syncFilter').value='restock';
  var mid=$('syncFilter').value;
  syncRender();
  return { mid:mid, after:$('syncFilter').value };
});
console.log('   '+JSON.stringify(back));
ok(back.after==='all','★★「すべて」に戻る');
let back2=await p.evaluate(()=>{
  /* 項目を無理に足してから選び、作り直したときに戻るかを見る。 */
  $('syncFilter').insertAdjacentHTML('beforeend',
    '<option value="markdown">値下げの時期（0）</option>');
  $('syncFilter').value='markdown';
  syncRender();
  return $('syncFilter').value;
});
ok(back2==='all','★★自動値下げがオンのとき「値下げの時期」も「すべて」に戻る');

console.log('=== 0件の項目も「今日やること」から選べる ===');
await setup({});
await openCsvBoxes(p);
/* 「eBay出品の候補」（fba_not_listed）は 6.99 で消した。
   0件でも選べることは、残っている別の項目（無在庫）で確かめる。 */
let z=await p.evaluate(()=>{
  var gone=!!$('syncFilter').querySelector('option[value="fba_not_listed"]');
  var has2=syncFilterHas('fba_not_listed');
  syncFilterSet('dropship');
  return { gone:gone, has2:has2, v:$('syncFilter').value,
    has:!!$('syncFilter').querySelector('option[value="dropship"]') };
});
console.log('   '+JSON.stringify(z));
ok(z.gone===false&&z.has2===false,
   '★★「eBay出品の候補」は消えている（まとめの件数で見る・6.99）');
ok(z.v==='dropship'&&z.has,'★★0件で隠れている項目も選べる');
ok((await opts()).some(x=>/^dropship\|/.test(x)),
   '★★選んでいるあいだは一覧に残す');

console.log('=== 売値の見直しは自動反映が auto のときだけ隠す（6.99）===');
await setup({});
await openCsvBoxes(p);
let rv=await p.evaluate(()=>{
  const seen=()=>Array.prototype.map.call($('syncFilter').options,(o)=>o.value);
  $('autoRvMode').value='off';      syncRender(); const off=seen();
  $('autoRvMode').value='confirm';  syncRender(); const cf=seen();
  $('autoRvMode').value='auto';     syncRender(); const au=seen();
  /* auto のときに選んでいたら「すべて」に戻る */
  $('autoRvMode').value='off'; syncRender(); syncFilterSet('review');
  const picked=$('syncFilter').value;
  $('autoRvMode').value='auto'; syncRender();
  const after=$('syncFilter').value;
  $('autoRvMode').value='confirm'; syncRender();
  return { off:off.indexOf('review')>=0, cf:cf.indexOf('review')>=0,
    au:au.indexOf('review')>=0, picked:picked, after:after }; });
console.log('   '+JSON.stringify(rv));
ok(rv.off===true,'★★「オフ」のときは出す（人が見て承認する）');
ok(rv.cf===true,'★★★「確認モード」のときは出す');
ok(rv.au===false,'★★★「自動実行」のときだけ隠す（pj-sync が勝手に反映する）');
ok(rv.picked==='review'&&rv.after==='all',
   '★★選んでいる途中で auto にしたら「すべて」に戻る');

console.log('=== 再調達CSV は消した（6.99）===');
await setup({});
await openCsvBoxes(p);
let csv=await p.evaluate(()=>{
  syncFilterSet('pbplan');
  return { box:!!$('syncRestockBox'), bar:!!$('syncBarRestock'),
    btn:!!$('syncRestock'),
    /* 選んだ件数の表示は残す（箱の中にあったので外に出した）。 */
    pick:!!$('syncPickNote') }; });
console.log('   '+JSON.stringify(csv));
ok(csv.box===false&&csv.btn===false,
   '★★★再調達で出し直すCSVの箱とボタンは無い（Worker が直接書き込むため）');
ok(csv.bar===false,'★★操作バーのボタンも無い');
ok(csv.pick===true,'★★選んだ件数の表示は残っている');

console.log('=== 絞り込みの中身は変えていない ===');
await setup({});
let same=await p.evaluate(()=>({
  pics:syncData.items.filter(syncFilterBy('picsneed').f).map(r=>r.asin),
  resting:syncData.items.filter(syncFilterBy('restocking').f).map(r=>r.asin),
  drop:syncData.items.filter(syncFilterBy('dropship').f).map(r=>r.asin),
  hand:syncData.items.filter(syncFilterBy('on_hand').f).map(r=>r.asin),
  warn:syncData.items.filter(syncFilterBy('warn').f).map(r=>r.asin) }));
console.log('   '+JSON.stringify(same));
ok(same.pics.join()==='B0FLT00004','★写真が小さい行はそのまま');
ok(same.resting.join()==='B0FLT00005','★再調達中はそのまま');
ok(same.drop.join()==='B0FLT00006','★無在庫はそのまま');
ok(same.hand.join()==='B0FLT00003','★FBA納品の判断はそのまま');
/* 「対応が必要」は警告の有無で決まる（売り越しの恐れ・Amazonでも販売中など）。
   決まりは変えていないので、警告を入れた行が必ず入ることだけ見張る。 */
ok(same.warn.indexOf('B0FLT00001')>=0,'★対応が必要の決まりはそのまま');

await T.done();
})();
