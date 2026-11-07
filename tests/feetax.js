/* 画面・Worker：手数料の消費税と在庫管理手数料（6.147／7.108）
   実物（B0GYC8BM48 S.H.フィギュアーツ アイアンマン マーク85・売値 ¥9,900）で
   せどりすと と ¥110 ずれていた。
     pj         ：販売手数料 1,030 ＋ 消費税 0、FBA 420、合計 1,450
     せどりすと ：販売手数料 1,029 ＋ 消費税 103、FBA 428（420＋8）、合計 1,560
   ・SP-API の TaxAmount が 0 のときは販売手数料（成約料を含む）の10%を足す
   ・SP-API の FBA手数料には在庫管理手数料が入らないので⚙の目安を足す
   ・サイズ区分は Amazon の寸法・重さから決め、取れない行は⚙の既定 */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：手数料の消費税と在庫管理');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

const setup=async()=>await p.evaluate(()=>{
  $('mwShipFee').value='176'; $('mwNetMode').value='sedori';
  $('mwProfitMode').value='mw';
  $('mwFbaShipS').value='288'; $('mwFbaStoreS').value='1';
  $('mwFbaShipM').value='425'; $('mwFbaStoreM').value='8';
  $('mwFbaShipL').value='675'; $('mwFbaStoreL').value='93';
  $('mwFbaSizeGame').value='s'; $('mwFbaSizeHobby').value='m';
  $('mwAmzFeeHobby').value='10';
  /* 実額（SP-API）。消費税は 0 で返り、FBA は配送代行だけ。 */
  const r={ jan:'4573102666001', asin:'B0GYC8BM48', kishu:'figure', cond:'新品',
    name:'S.H.フィギュアーツ アイアンマン マーク85',
    mw_name:'S.H.フィギュアーツ アイアンマン マーク85',
    sha:'M200', stock:3, ship_days:1, list_price:11000, wholesale:5000,
    price:9900, basis:'カート', rank:1000, rank_cat:'ホビー', rst:'ok', note:'',
    fee_ref:1030, fee_tax:0, fee_fba:420, fee_fba_ship:420, fee_fba_store:0,
    fee_total:1450, fee_base:9900,
    /* Amazon の寸法から決めた区分（標準）。 */
    size_tier:'m', size_cm3:9000, size_long:30, size_g:600 };
  mwAmzRows=[r];
  return mwAmzCalc(r);
});

let c=await setup();
console.log('   '+JSON.stringify({ref:c.feeRef,tax:c.feeTax,fba:c.fba,
  ship:c.fbaShip,store:c.fbaStore,fee:c.fee,size:c.feeSize,from:c.feeSizeFrom}));
ok(c.feeRef===1030,'★販売手数料は実額（1,030）');
ok(c.feeTax===103,'★★★消費税が0のときは販売手数料の10%を足す（103）');
ok(c.feeTaxGuess===true,'★★足したことが分かる');
ok(c.fbaShip===420,'★配送代行は実額（420）');
ok(c.fbaStore===8,'★★★在庫管理は⚙の目安を足す（標準＝8）');
ok(c.feeStoreGuess===true,'★★足したことが分かる');
ok(c.fba===428,'★★★FBA手数料は 428（420＋8）');
ok(Math.abs(c.fee-1560)<=1,
   '★★★合計は せどりすと と同じ 1,560（出た値 '+c.fee+'・1円まで）');
ok(c.feeSize==='標準'&&c.feeSizeFrom==='寸法から',
   '★★★サイズ区分は Amazon の寸法から（標準）');
ok(c.feeReal===true,'★実額の行だと分かる');

/* 寸法が取れていない行は⚙の既定（フィギュア＝標準） */
let c2=await p.evaluate(()=>{
  const r=Object.assign({},mwAmzRows[0],{ size_tier:'', size_cm3:0, size_g:0 });
  return mwAmzCalc(r);
});
ok(c2.feeSize==='標準'&&c2.feeSizeFrom==='既定',
   '★★寸法が無い行は⚙の既定を使い、そう出す');

/* 消費税が返っている行は、その値をそのまま使う */
let c3=await p.evaluate(()=>{
  const r=Object.assign({},mwAmzRows[0],{ fee_tax:90 });
  return mwAmzCalc(r);
});
ok(c3.feeTax===90&&c3.feeTaxGuess===false,
   '★★★消費税が返っていればその値を使う（足さない）');

/* 在庫管理が実額で返っている行は、目安を足さない */
let c4=await p.evaluate(()=>{
  const r=Object.assign({},mwAmzRows[0],
    { fee_fba:430, fee_fba_ship:420, fee_fba_store:10 });
  return mwAmzCalc(r);
});
ok(c4.fbaStore===10&&c4.fba===430&&c4.feeStoreGuess===false,
   '★★在庫管理が実額なら目安を足さない');

/* 内訳の文面 */
let h=await p.evaluate(()=>{
  const d=document.createElement('div');
  d.innerHTML=mwAmzBreak(mwAmzRows[0],mwAmzCalc(mwAmzRows[0]));
  return d.textContent.replace(/\s+/g,' ');
});
console.log('   '+h);
ok(/＋手数料消費税 ¥103（10%を足しました）/.test(h),
   '★★消費税を足したことを文にも出す');
ok(/FBA手数料 ¥428（配送代行 ¥420＋在庫管理 ¥8・標準の目安・寸法から）/.test(h),
   '★★★FBA の内訳と、目安だと分かる文を出す');

await T.done();
})();
