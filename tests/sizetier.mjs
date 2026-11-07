/* Worker：手数料の消費税と、寸法からのサイズ区分（7.108）
   ・成約料（VariableClosingFee／PerItemFee）は販売手数料のグループに入れる
     （v232 までは FBA手数料に入っていた）
   ・TaxAmount が 0 のときは販売手数料の10%を足す（0 でなければその値）
   ・合計は足し直す（Amazon の TotalFeesEstimate は消費税を足す前の額）
   ・Catalog の dimensions からサイズ区分（小型／標準／大型）を出して控える */
import { harness, loadWorker, makeEnv, post, get, asJson } from './lib.mjs';
const T=harness('Worker：手数料の消費税とサイズ区分');
const ok=T.ok;
const { worker, T:W }=await loadWorker('sizetier');

console.log('=== 手数料の消費税（TaxAmount が 0）===');
/* 実物（B0GYC8BM48・売値 9,900）。消費税は 0 で返り、FBA は配送代行だけ。 */
const IRON={ Status:'Success', FeesEstimate:{
  TotalFeesEstimate:{ CurrencyCode:'JPY', Amount:1450 },
  FeeDetailList:[
    { FeeType:'ReferralFee', FinalFee:{ Amount:1030 },
      TaxAmount:{ Amount:0 } },
    { FeeType:'FBAFees', FinalFee:{ Amount:420 },
      IncludedFeeDetailList:[
        { FeeType:'FBAPerUnitFulfillmentFee', FinalFee:{ Amount:420 } }] }
  ] } };
let z=W.mwFeePick(IRON);
console.log('   '+JSON.stringify(z));
ok(z.ref===1030,'★販売手数料 1,030');
ok(z.tax===103,'★★★消費税が0なら販売手数料の10%を足す（103）');
ok(z.tax_guess===1,'★★足したことを返す');
ok(z.fba===420&&z.fba_ship===420&&z.fba_store===0,
   '★★FBA は配送代行だけ（在庫管理は入っていない）');
ok(z.total===1553,'★★合計は足し直す（1,030＋420＋103）');
ok(z.total_api===1450,'★Amazon が返した合計も持つ');

console.log('\n=== 成約料は販売手数料のグループ ===');
let z2=W.mwFeePick({ Status:'Success', FeesEstimate:{
  TotalFeesEstimate:{ Amount:1200 },
  FeeDetailList:[
    { FeeType:'ReferralFee', FinalFee:{ Amount:900 } },
    { FeeType:'VariableClosingFee', FinalFee:{ Amount:100 } },
    { FeeType:'PerItemFee', FinalFee:{ Amount:0 } },
    { FeeType:'FBAFees', FinalFee:{ Amount:200 } }] } });
console.log('   '+JSON.stringify(z2));
ok(z2.ref===1000,'★★★成約料は販売手数料に入れる（900＋100）');
ok(z2.fba===200,'★★FBA手数料には入れない');
ok(z2.tax===100,'★★★消費税の土台も成約料を含む（1,000の10%）');

console.log('\n=== 消費税が返っているときはその値 ===');
let z3=W.mwFeePick({ Status:'Success', FeesEstimate:{
  TotalFeesEstimate:{ Amount:2073 },
  FeeDetailList:[
    { FeeType:'ReferralFee', FinalFee:{ Amount:1484 } },
    { FeeType:'FBAFees', FinalFee:{ Amount:441 } },
    { FeeType:'ReferralFeeTax', FinalFee:{ Amount:148 } }] } });
ok(z3.tax===148&&!z3.tax_guess,'★★★返ってきた消費税をそのまま使う');
ok(z3.total===2073,'★合計も合う');

console.log('\n=== サイズ区分（寸法・重さから）===');
const tier=(cm,g)=>W.mwSizeTier(cm,g);
ok(tier([25,18,2],250)==='s','★★★小型（25×18×2.0cm・250g以内）');
ok(tier([20,15,1.5],200)==='s','★小型の中');
ok(tier([30,20,10],600)==='m','★★★標準（45×35×20cm・9kg以内）');
ok(tier([25,18,3],250)==='m','★厚みが2cmを超えたら標準');
ok(tier([25,18,2],300)==='m','★250gを超えたら標準');
ok(tier([50,35,20],5000)==='l','★★★大型（それより大きい）');
ok(tier([30,20,10],9500)==='l','★9kgを超えたら大型');
ok(tier([],0)==='','★★寸法も重さも無ければ空（画面は⚙の既定を使う）');
ok(tier([],200)==='s','★重さだけでも分かれば使う');

console.log('\n=== Catalog の dimensions の読み取り ===');
const dm=W.mwDimPick({ dimensions:[{ package:{
  length:{ value:30, unit:'centimeters' },
  width:{ value:20, unit:'centimeters' },
  height:{ value:10, unit:'centimeters' },
  weight:{ value:0.6, unit:'kilograms' } } }] });
console.log('   '+JSON.stringify(dm));
ok(dm.cm.length===3&&dm.g===600,'★★cm と g で読み取る（kg → g）');
const dm2=W.mwDimPick({ dimensions:[{ item:{
  length:{ value:10, unit:'inches' }, width:{ value:8, unit:'inches' },
  height:{ value:1, unit:'inches' }, weight:{ value:8, unit:'ounces' } } }] });
ok(Math.round(dm2.cm[0])===25&&Math.abs(dm2.g-227)<=1,
   '★★インチ・オンスも cm と g に直す');
ok(W.mwDimPick({}).cm.length===0,'★無ければ空');
ok(W.MW_FEE_TAX_PCT===10,'★手数料の消費税は10%');

T.done();
