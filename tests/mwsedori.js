/* 画面：Amazon刈取の粗利を せどりすと に合わせる（6.145）
   実物3件で突き合わせた結果から直した。
   | 商品 | 売値 | 販売手数料＋消費税 | FBA（配送代行＋在庫管理） | 仕入原価 | 粗利 |
   | Everafter Falls | 5,980 | 920＋92 | 289（288＋1） | 3,762 | 825 |
   | ねんどろいど八奈見 | 7,480 | 777＋78 | 441（425＋16） | 5,480 | 634 |
   | CAworks ホロ | 27,835 | 2,894＋289 | 768（675＋93） | 22,000 | 1,695 |
   ・粗利は2つ出す（せどりすと方式＝卸値×1.1／MW送料込み＝＋¥176）
   ・並べ替え・黒字のみ・利益率に使うほうは⚙で選ぶ（既定は MW送料込み）
   ・実額が取れない行は、販売手数料に消費税10%を足し、
     FBA手数料はサイズ区分の目安（配送代行＋在庫管理）を使う
   ・内訳は せどりすと と同じ並びで出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：刈取の粗利を せどりすと に合わせる');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

/* 実額（SP-API が返した値）を入れた行。卸値は 仕入原価÷1.1 から戻す。 */
const ROWS=[
  { name:'Everafter Falls', jan:'4573591750747', asin:'B0DW3QJQK8',
    kishu:'NS', price:5980, wholesale:3420,          // 3420×1.1=3762
    fee_ref:920, fee_tax:92, fee_fba:289, fee_fba_ship:288, fee_fba_store:1,
    fee_total:1301, fee_base:5980, sedo:825, mw:667 },
  { name:'ねんどろいど 八奈見杏菜', jan:'4580416928922', asin:'B0DJ8V5RT7',
    kishu:'figure', price:7480, wholesale:4982,      // 4982×1.1=5480.2→5480
    fee_ref:777, fee_tax:78, fee_fba:441, fee_fba_ship:425, fee_fba_store:16,
    fee_total:1296, fee_base:7480, sedo:634, mw:476 },
  { name:'CAworks ホロ 白無垢ver.', jan:'4935228529131', asin:'B0B4NPXC22',
    kishu:'figure', price:27835, wholesale:20000,    // 20000×1.1=22000
    fee_ref:2894, fee_tax:289, fee_fba:768, fee_fba_ship:675, fee_fba_store:93,
    fee_total:3951, fee_base:27835, sedo:1695, mw:1537 }
];
const setup=async(mode)=>await p.evaluate((o)=>{
  $('mwShipFee').value='176';
  $('mwNetMode').value='sedori';
  $('mwProfitMode').value=o.mode||'mw';
  $('mwFbaShipS').value='288'; $('mwFbaStoreS').value='1';
  $('mwFbaShipM').value='425'; $('mwFbaStoreM').value='16';
  $('mwFbaShipL').value='675'; $('mwFbaStoreL').value='93';
  $('mwFbaSizeGame').value='s'; $('mwFbaSizeHobby').value='m';
  $('mwAmzFeeGame').value='15'; $('mwAmzFeeHobby').value='10';
  mwAmzRows=o.rows.map((x)=>Object.assign({ cond:'新品', stock:5, ship_days:1,
    list_price:x.price, rank:1000, rank_cat:'ゲーム', rst:'ok', note:'',
    name:x.name, mw_name:x.name, sha:'M200' },x));
  mwAmzMeta={ n:3, seen:3, priced:3 };
  return mwAmzRows.map((r)=>({ name:r.name, c:mwAmzCalc(r) }));
},{rows:ROWS,mode:mode});

console.log('=== 実額で せどりすと と同じ粗利になる ===');
let g=await setup('mw');
g.forEach(function(x,i){
  const e=ROWS[i], c=x.c;
  console.log('   '+e.name+'：販売'+c.feeRef+'＋税'+c.feeTax+'／FBA'+c.fba
    +'（'+c.fbaShip+'＋'+c.fbaStore+'）／仕入'+c.costSedo+'（+送料='+c.cost+'）'
    +'／粗利 せどりすと '+c.netSedo+'・MW '+c.netMw);
  ok(c.feeRef===e.fee_ref&&c.feeTax===e.fee_tax,
     '★★'+e.name+'：販売手数料と手数料の消費税は実額');
  ok(c.fba===e.fee_fba&&c.fbaShip===e.fee_fba_ship&&c.fbaStore===e.fee_fba_store,
     '★★★'+e.name+'：FBA手数料を配送代行と在庫管理に分けて出す');
  ok(c.costSedo===Math.round(e.wholesale*1.1),
     '★'+e.name+'：仕入原価（卸値×1.1）');
  ok(c.cost===c.costSedo+176,'★'+e.name+'：MW送料込みは＋¥176');
  /* 納付消費税の丸め方で、せどりすと の表示と**最大1円**ずれることがある。
     917×0.9＝825.3→825／704×0.9＝633.6→634 は四捨五入で合うが、
     1,884×0.9＝1,695.6 は四捨五入で 1,696（せどりすと の表示は 1,695）。
     pj は四捨五入でそろえる（6.111 から変えない）。 */
  ok(Math.abs(c.netSedo-e.sedo)<=1,
     '★★★'+e.name+'：せどりすと方式の粗利 '+e.sedo+'円（出た値 '+c.netSedo
     +'・1円まで）');
  ok(Math.abs(c.netMw-e.mw)<=1,
     '★★★'+e.name+'：MW送料込みの粗利 '+e.mw+'円（出た値 '+c.netMw+'）');
});

console.log('\n=== 並べ替え・絞り込みに使う粗利は⚙で選ぶ ===');
ok(g[0].c.profitMode==='mw'&&g[0].c.profit===g[0].c.profitMw,
   '★★既定は MW送料込み');
let g2=await setup('sedori');
ok(g2[0].c.profitMode==='sedori'&&g2[0].c.profit===g2[0].c.profitSedo,
   '★★「せどりすと方式」を選べば、そちらで並べ替え・絞り込みする');
ok(g2[0].c.net===g2[0].c.netSedo&&g2[0].c.margin===g2[0].c.marginSedo,
   '★利益率もそろう');
ok(g2[0].c.netMw!==undefined&&g2[0].c.netSedo!==undefined,
   '★どちらを選んでも両方の粗利を持つ（一覧に並べて出す）');

console.log('\n=== 仮の手数料：消費税10%を足し、サイズ区分の目安を使う ===');
let t=await p.evaluate(()=>{
  const mk=(o)=>Object.assign({ cond:'新品', stock:5, ship_days:1, rst:'ok',
    note:'', sha:'M200', rank:1000 },o);
  /* 実額なし（fee_total なし）の行。 */
  const game=mk({ jan:'4902370550001', asin:'B0GAME00001', kishu:'NS',
    name:'ゲームの行', mw_name:'ゲームの行', price:5980, wholesale:3420,
    list_price:6000, rank_cat:'ゲーム' });
  const fig=mk({ jan:'4580416920001', asin:'B0FIG000001', kishu:'figure',
    name:'フィギュアの行', mw_name:'フィギュアの行', price:7480, wholesale:4982,
    list_price:8000, rank_cat:'ホビー' });
  return { game:mwAmzCalc(game), fig:mwAmzCalc(fig) };
});
console.log('   ゲーム（仮）：販売'+t.game.feeRef+'＋税'+t.game.feeTax
  +'／FBA'+t.game.fba+'（'+t.game.fbaShip+'＋'+t.game.fbaStore+'・'
  +t.game.feeSize+'）');
console.log('   フィギュア（仮）：販売'+t.fig.feeRef+'＋税'+t.fig.feeTax
  +'／FBA'+t.fig.fba+'（'+t.fig.fbaShip+'＋'+t.fig.fbaStore+'・'
  +t.fig.feeSize+'）');
ok(t.game.feeRef===897&&t.game.feeTax===90,
   '★★★仮でも手数料の消費税10%を足す（5,980×15%＝897＋90）');
ok(t.game.fba===289&&t.game.fbaShip===288&&t.game.fbaStore===1,
   '★★★ゲームは小型の目安（288＋1）');
ok(t.fig.fba===441&&t.fig.fbaShip===425&&t.fig.fbaStore===16,
   '★★★フィギュアは標準の目安（425＋16）');
ok(t.game.feeReal===false&&t.fig.feeReal===false,'★仮の手数料だと分かる');
ok(t.game.feeSize==='小型'&&t.fig.feeSize==='標準','★★サイズ区分を出す');

console.log('\n=== 内訳の並びは せどりすと と同じ ===');
let h=await p.evaluate(()=>{
  const r=mwAmzRows[0];
  const d=document.createElement('div');
  d.innerHTML=mwAmzBreak(r,mwAmzCalc(r));
  return d.textContent.replace(/\s+/g,' ');
});
console.log('   '+h);
ok(/販売手数料 ¥920（15%）＋手数料消費税 ¥92/.test(h)
  ||/販売手数料 ¥920.*＋手数料消費税 ¥92/.test(h),
   '★★販売手数料＋手数料消費税');
ok(/FBA手数料 ¥289（配送代行 ¥288＋在庫管理 ¥1）/.test(h),
   '★★★FBA手数料の内訳');
ok(/仕入原価 ¥3,762（卸値×1.1）＋MW送料 ¥176/.test(h),'★★仕入原価と MW送料');
ok(/せどりすと方式 ¥825/.test(h)&&/MW送料込み ¥667/.test(h),
   '★★★粗利を2つ並べる');

await T.done();
})();
