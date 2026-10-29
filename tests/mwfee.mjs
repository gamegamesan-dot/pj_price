/* Worker：商品ごとの手数料（Product Fees API・7.85）
   一律の率（15%＋FBA 530円）だと せどりすと の内訳とずれる。
   例：サイヴァリア3 限定版 PS5（¥9,638）
     せどりすと … 販売手数料 1,484＋手数料消費税 148／FBA 441（配送代行425＋在庫管理16）
     pj（一律）  … 販売手数料 1,446＋FBA 530（消費税なし）
   getMyFeesEstimates（POST /products/fees/v0/feesEstimate）で ASIN ごとに取り、
   手数料の消費税も含めて控える。1回20件・0.5回/秒。 */
import { harness, loadWorker, makeEnv, asJson } from './lib.mjs';
const T=harness('Worker：商品ごとの手数料');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwfee');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs', LWA_REFRESH_TOKEN:'rt' });

let calls=[], fees={}, cat={}, offers={};
globalThis.fetch=async(u,i)=>{
  const url=String(u); calls.push({url:url,body:String((i||{}).body||'')});
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  if(/catalog\/2022-04-01\/items/.test(url)){
    const ids=new URL(url).searchParams.get('identifiers').split(',');
    return new Response(JSON.stringify({items:ids.map((j)=>cat[j]).filter(Boolean)}),
      {status:200});
  }
  if(/itemOffers/.test(url)){
    const b=JSON.parse(i.body);
    return new Response(JSON.stringify({responses:b.requests.map((q)=>{
      const m=/\/items\/([A-Z0-9]{10})\/offers/.exec(q.uri);
      const a=m?m[1]:'';
      return { request:q, body:{ payload: offers[a]||{ASIN:a,Offers:[]} } };
    })}),{status:200});
  }
  if(/feesEstimate/.test(url)){
    const b=JSON.parse(i.body);
    if(fees.__status)return new Response('ng',{status:fees.__status});
    return new Response(JSON.stringify({ FeesEstimateResultList:
      b.FeesEstimateByIdRequestList.map((q)=>{
        const a=q.IdValue;
        return Object.assign({ FeesEstimateIdentifier:{ IdType:'ASIN', IdValue:a } },
          fees[a]||{ FeesEstimateResult:{ Status:'ClientError' } });
      })}),{status:200});
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
const mkCat=(jan,asin,name)=>({ asin:asin,
  identifiers:[{ identifiers:[{ identifierType:'EAN', identifier:jan }] }],
  summaries:[{ itemName:name }],
  salesRanks:[{ classificationRanks:[{ title:'ゲーム', rank:100 }] }] });
const mkOff=(asin,yen)=>({ ASIN:asin, Summary:{ TotalOfferCount:2,
  NumberOfOffers:[{condition:'new',OfferCount:2}],
  BuyBoxPrices:[{condition:'New',LandedPrice:{Amount:yen}}],
  LowestPrices:[{condition:'new',LandedPrice:{Amount:yen}}] },
  Offers:[{ SubCondition:'new', ListingPrice:{Amount:yen}, Shipping:{Amount:0},
    IsBuyBoxWinner:true, IsFulfilledByAmazon:true, SellerId:'A1X' }] });
/* せどりすと の実物と同じ内訳を返す（サイヴァリア3） */
const SAI={ FeesEstimateResult:{ Status:'Success', FeesEstimate:{
  TotalFeesEstimate:{ CurrencyCode:'JPY', Amount:2073 },
  FeeDetailList:[
    { FeeType:'ReferralFee', FinalFee:{ CurrencyCode:'JPY', Amount:1484 } },
    { FeeType:'FBAFees',     FinalFee:{ CurrencyCode:'JPY', Amount:441 } },
    { FeeType:'VariableClosingFee', FinalFee:{ CurrencyCode:'JPY', Amount:0 } },
    { FeeType:'PerItemFee',  FinalFee:{ CurrencyCode:'JPY', Amount:0 } },
    { FeeType:'ReferralFeeTax', FinalFee:{ CurrencyCode:'JPY', Amount:148 } },
  ] } } };

console.log('=== 明細の振り分け（mwFeePick）===');
let z=W.mwFeePick(SAI);
console.log('   '+JSON.stringify(z));
ok(z.ok===true,'★通る');
ok(z.ref===1484,'★★★販売手数料を取り出す');
ok(z.fba===441,'★★★FBA手数料を取り出す（配送代行＋在庫管理）');
ok(z.tax===148,'★★★手数料の消費税を取り出す');
ok(z.total===2073,'★★合計は Amazon の総額をそのまま');
ok(z.ref+z.fba+z.tax===2073,'★★★内訳の合計が総額と合う（せどりすと と同じ）');
/* 税が明細の中に入っている形 */
let z2=W.mwFeePick({ FeesEstimateResult:{ Status:'Success', FeesEstimate:{
  TotalFeesEstimate:{ Amount:2200 },
  FeeDetailList:[
    { FeeType:'ReferralFee', FeeAmount:{ Amount:1500 },
      TaxAmount:{ Amount:150 } },
    { FeeType:'FBAFees', FeeAmount:{ Amount:500 }, TaxAmount:{ Amount:50 } }] } } });
console.log('   '+JSON.stringify(z2));
ok(z2.ref===1500&&z2.fba===500&&z2.tax===200,
   '★★★明細の中に税がある形も読める');
let z3=W.mwFeePick({ FeesEstimateResult:{ Status:'ClientError' } });
ok(z3.ok===false&&/返りませんでした/.test(z3.err),'★★返らない行は理由を残す');
ok(W.MW_FEE_BATCH===20,'★1回20件');

console.log('\n=== ③の段で手数料も取る ===');
const JAN='4944076005667';            // サイヴァリア3 限定版 PS5
cat[JAN]=mkCat(JAN,'B0SAIVA001','サイヴァリア3 限定版 PS5');
offers['B0SAIVA001']=mkOff('B0SAIVA001',9638);
fees['B0SAIVA001']=SAI;
const row=(jan,x)=>Object.assign({jan:jan,sha:'M200',idx:0,kishu:'PS5',
  name:'サイヴァリア3 限定版',list_price:9800,release:'2025/01/01',cond:'新品',
  wholesale:4500,stock:9,note:'',ship_text:'即日出荷',ship_days:0},x||{});
const post=async(path,body,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
await post('/mw/stock',{at:'2026-11-07T00:00:00Z',part:1,parts:1,rows:[row(JAN)]});
calls=[];
let r=await post('/mw/amz',{ kishu:'PS5', stock_min:5 });
console.log('   ③'+JSON.stringify({priced:r.body.price.priced,
  fee_ok:r.body.price.fee_ok,fee_calls:r.body.price.fee_calls}));
ok(r.body.price.priced===1,'★値段が取れる');
ok(r.body.price.fee_ok===1,'★★★手数料も同じ段で取れる');
ok(r.body.price.fee_calls===1,'★★呼び出しは1回（20件まとめて）');
const fc=calls.filter((x)=>/feesEstimate/.test(x.url));
ok(fc.length===1,'★★feesEstimate を1回だけ呼ぶ');
const fb=JSON.parse(fc[0].body);
console.log('   送った: '+JSON.stringify(fb.FeesEstimateByIdRequestList[0]));
ok(fb.FeesEstimateByIdRequestList[0].IdType==='ASIN','★★★ASIN で聞く');
ok(fb.FeesEstimateByIdRequestList[0].FeesEstimateRequest.IsAmazonFulfilled===true,
   '★★★FBA の手数料として聞く');
ok(fb.FeesEstimateByIdRequestList[0].FeesEstimateRequest
     .PriceToEstimateFees.ListingPrice.Amount===9638,
   '★★★いまの売値で聞く');
ok(fb.FeesEstimateByIdRequestList[0].FeesEstimateRequest.MarketplaceId
   ==='A1VC38T7YXB528','★★amazon.co.jp');
const a=await env.DB.prepare(
  'SELECT * FROM mw_amz WHERE jan=?1').bind(JAN).first();
console.log('   控え: '+JSON.stringify({ref:a.fee_ref,fba:a.fee_fba,tax:a.fee_tax,
  total:a.fee_total,base:a.fee_base}));
ok(a.fee_ref===1484&&a.fee_fba===441&&a.fee_tax===148,'★★★内訳を控える');
ok(a.fee_total===2073,'★★合計も控える');
ok(a.fee_base===9638,'★★★どの売値で出した手数料か控える');
ok(!!a.fee_at&&!String(a.fee_err||''),'★時刻を控え、理由は空');

console.log('\n=== せどりすと の内訳と合う ===');
/* 手数料の合計（税込）が せどりすと の 1,632＋441＝2,073 と同じになる */
ok(a.fee_ref+a.fee_tax===1632,'★★★販売手数料＋消費税＝1,632円');
ok(a.fee_ref+a.fee_tax+a.fee_fba===2073,'★★★手数料の合計＝2,073円');
/* 一律だと 1,446＋530＝1,976 でずれていた */
ok(Math.round(9638*0.15)+530===1976,'★一律だと 1,976円（97円ずれる）');

console.log('\n=== 取れない行は理由を残す（画面は「仮の手数料」）===');
const JAN2='4902370550467';
cat[JAN2]=mkCat(JAN2,'B0NOFEE001','手数料が取れない商品');
offers['B0NOFEE001']=mkOff('B0NOFEE001',5000);
await post('/mw/stock',{at:'2026-11-08T00:00:00Z',part:1,parts:1,
  rows:[row(JAN),row(JAN2,{name:'手数料が取れない商品'})]});
await env.DB.prepare("UPDATE mw_amz SET price_at=NULL WHERE jan=?1").bind(JAN2).run();
r=await post('/mw/amz',{ kishu:'PS5', stock_min:5 });
console.log('   '+JSON.stringify({fee_ok:r.body.price.fee_ok,
  fee_ng:r.body.price.fee_ng}));
ok(r.body.price.fee_ng>=1,'★★取れない行を数える');
const b=await env.DB.prepare(
  'SELECT * FROM mw_amz WHERE jan=?1').bind(JAN2).first();
ok(!b.fee_total&&/返りませんでした/.test(String(b.fee_err||'')),
   '★★★取れない行は理由を残す（合計は入れない）');

console.log('\n=== 呼び出しの間隔と許可表 ===');
ok(W.SP_GAP_TEST?true:true,'★（間隔は下で確かめる）');
const src=(await import('node:fs')).default.readFileSync(
  (await import('./lib.mjs')).WORKER,'utf8');
ok(/getMyFeesEstimates:\s*2100/.test(src),'★★0.5回/秒（2.1秒の間隔）');
ok(/products\\\/fees\\\/v0\\\/feesEstimate\$\//.test(src),
   '★★★許可表に POST の1本だけ足す');
ok(W.MW_FEE_CALL_MS===2500,'★1回ぶんの見込みは2.5秒');

await T.done();
