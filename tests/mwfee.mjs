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
    /* 7.104：**本物と同じ**ふるまいにする。
       getMyFeesEstimates の本文は FeesEstimateByIdRequest の**配列**で、
       `{"FeesEstimateByIdRequestList":[…]}` で送ると Amazon は
       HTTP 400 InvalidInput「This is an invalid request」で断る。
       作り物がその形を受け取ってしまっていたので、1071件が仮の手数料の
       ままになっていることに気づけなかった。 */
    if(!Array.isArray(b))
      return new Response(JSON.stringify({ errors:[{ code:'InvalidInput',
        message:'This is an invalid request. Please verify your request and try again.',
        details:'' }] }),{status:400});
    /* 応答も**配列**（FeesEstimateResult が平たく並ぶ）。 */
    return new Response(JSON.stringify(b.map((q)=>{
      const a=q.IdValue;
      return Object.assign({ FeesEstimateIdentifier:{ IdType:'ASIN', IdValue:a } },
        fees[a]||{ Status:'ClientError',
                   Error:{ Type:'Client', Code:'DataNotFound', Message:'no fee' } });
    })),{status:200});
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
const SAI={ Status:'Success', FeesEstimate:{
  TotalFeesEstimate:{ CurrencyCode:'JPY', Amount:2073 },
  FeeDetailList:[
    { FeeType:'ReferralFee', FinalFee:{ CurrencyCode:'JPY', Amount:1484 } },
    { FeeType:'FBAFees',     FinalFee:{ CurrencyCode:'JPY', Amount:441 } },
    { FeeType:'VariableClosingFee', FinalFee:{ CurrencyCode:'JPY', Amount:0 } },
    { FeeType:'PerItemFee',  FinalFee:{ CurrencyCode:'JPY', Amount:0 } },
    { FeeType:'ReferralFeeTax', FinalFee:{ CurrencyCode:'JPY', Amount:148 } },
  ] } };

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
let z2=W.mwFeePick({ Status:'Success', FeesEstimate:{
  TotalFeesEstimate:{ Amount:2200 },
  FeeDetailList:[
    { FeeType:'ReferralFee', FeeAmount:{ Amount:1500 },
      TaxAmount:{ Amount:150 } },
    { FeeType:'FBAFees', FeeAmount:{ Amount:500 }, TaxAmount:{ Amount:50 } }] } });
console.log('   '+JSON.stringify(z2));
ok(z2.ref===1500&&z2.fba===500&&z2.tax===200,
   '★★★明細の中に税がある形も読める');
let z3=W.mwFeePick({ Status:'ClientError',
  Error:{ Type:'Client', Code:'InvalidInput', Message:'bad price' } });
ok(z3.ok===false&&/返りませんでした/.test(z3.err),'★★返らない行は理由を残す');
ok(/InvalidInput/.test(z3.err)&&/bad price/.test(z3.err),
   '★★★1件ごとの理由（Error の中身）も残す（7.104）');
/* 包まれた形（FeesEstimateResult の中）でも読めること（念のため） */
ok(W.mwFeePick({ FeesEstimateResult:SAI }).ref===1484,
   '★包まれた形でも読める');
ok(W.MW_FEE_BATCH===20,'★1回20件');

console.log('\n=== 送る本文・受ける応答の形（7.104）===');
const fbody=W.mwFeeBody([{asin:'B0SAIVA001',price:9638.4}]);
ok(Array.isArray(fbody),'★★★本文は**配列そのもの**（これを間違えて全件 400 だった）');
ok(fbody[0].IdType==='ASIN'&&fbody[0].IdValue==='B0SAIVA001','★IdType と IdValue');
ok(fbody[0].FeesEstimateRequest.Identifier==='B0SAIVA001','★Identifier も入れる');
ok(fbody[0].FeesEstimateRequest.PriceToEstimateFees.ListingPrice.Amount===9638,
   '★★売値は整数（円）にして送る');
ok(W.mwFeeList([{Status:'Success'}]).length===1,'★★応答が配列でも読める');
ok(W.mwFeeList({payload:[{Status:'Success'}]}).length===1,'★payload 包みでも読める');
ok(W.mwFeeList({FeesEstimateResultList:[{Status:'Success'}]}).length===1,
   '★古い形でも読める');
ok(W.mwFeeList(null).length===0,'★空は空');

console.log('\n=== ④の段で手数料を取る（7.97）===');
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
console.log('   ③'+JSON.stringify({priced:r.body.price.priced})
  +' ④'+JSON.stringify(r.body.fee));
ok(r.body.price.priced===1,'★値段が取れる');
ok(r.body.fee.ok_n===1,'★★★同じ回の④で手数料も取れる');
ok(r.body.fee.calls===1,'★★呼び出しは1回（20件まとめて）');
ok(r.body.fee.need>=1&&r.body.fee.done>=1,'★★要る件数と取った件数を返す');
const fc=calls.filter((x)=>/feesEstimate/.test(x.url));
ok(fc.length===1,'★★feesEstimate を1回だけ呼ぶ');
const fb=JSON.parse(fc[0].body);
console.log('   送った: '+JSON.stringify(fb[0]));
ok(Array.isArray(fb),'★★★配列で送っている（7.104）');
ok(fb[0].IdType==='ASIN','★★★ASIN で聞く');
ok(fb[0].FeesEstimateRequest.IsAmazonFulfilled===true,
   '★★★FBA の手数料として聞く');
ok(fb[0].FeesEstimateRequest.PriceToEstimateFees.ListingPrice.Amount===9638,
   '★★★いまの売値で聞く');
ok(fb[0].FeesEstimateRequest.MarketplaceId==='A1VC38T7YXB528','★★amazon.co.jp');
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
console.log('   '+JSON.stringify(r.body.fee));
ok(r.body.fee.ng>=1,'★★取れない行を数える');
ok(Object.keys(r.body.fee.whys||{}).length>=1,
   '★★★理由ごとの件数も返す（報告に使う・7.97）');
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

/* ========== ここから v221（7.97）==========
   「仮の手数料」のままの行が多かった。v220 までは手数料を**③価格の段の中**で
   「時間が余っていれば」取っていたので、③が持ち時間を使い切った回は
   取らずに捨てていた（fee_left）。捨てた行は値段を引き直す3日後まで
   「仮の手数料」のままだった。→ ④として**別の持ち時間**で取る。 */
console.log('\n=== 手数料だけの段（④）がある ===');
ok(W.MW_SCAN_SHARE.fee>0,'★★★手数料に持ち時間が割り当てられている');
ok(W.MW_SCAN_SHARE.asin+W.MW_SCAN_SHARE.rst+W.MW_SCAN_SHARE.price
   +W.MW_SCAN_SHARE.fee<=W.MW_SCAN_BUDGET_MS,
   '★★合わせても1回の持ち時間を超えない');
ok(W.MW_FEE_TTL_D===7&&W.MW_FEE_DIFF===0.1,
   '★手数料は7日で作り直し、売値が1割ずれたら取り直す');

console.log('\n=== 値段はあるが手数料が無い行を、あとの回で拾う ===');
/* 値段は取れているが手数料が入っていない行（v220 で捨てられた行）を作る。 */
await env.DB.prepare(
  `UPDATE mw_amz SET fee_ref=NULL, fee_fba=NULL, fee_tax=NULL, fee_total=NULL,
     fee_base=NULL, fee_at=NULL, fee_err='' WHERE jan=?1`).bind(JAN).run();
/* 値段は新しいまま（＝③は何もしない）。それでも④が拾うこと。 */
await env.DB.prepare(
  `UPDATE mw_amz SET price_at=?2 WHERE jan=?1`).bind(JAN, new Date().toISOString()).run();
calls=[];
r=await post('/mw/amz',{ kishu:'PS5', stock_min:5 });
console.log('   ③'+JSON.stringify({done:r.body.price.done})
  +' ④'+JSON.stringify(r.body.fee));
ok(r.body.price.done===0,'★値段は引き直さない（まだ新しい）');
ok(r.body.fee.ok_n>=1,
   '★★★値段を引き直さない回でも、手数料だけ取り直す（3日待たない）');
let a2=await env.DB.prepare(
  'SELECT fee_total, fee_base FROM mw_amz WHERE jan=?1').bind(JAN).first();
ok(a2.fee_total===2073&&a2.fee_base===9638,'★★控えが入る');

console.log('\n=== 取れている行は何度も聞かない ===');
calls=[];
r=await post('/mw/amz',{ kishu:'PS5', stock_min:5 });
console.log('   ④'+JSON.stringify(r.body.fee)
  +' 呼び出し '+calls.filter((x)=>/feesEstimate/.test(x.url)).length);
ok(r.body.fee.need===1,
   '★★取れている行は対象に入らない（取れない1件だけ残る）');

console.log('\n=== 売値が1割ずれたら取り直す ===');
await env.DB.prepare(
  `UPDATE mw_amz SET price=12000 WHERE jan=?1`).bind(JAN).run();
fees['B0SAIVA001']=SAI;
calls=[];
r=await post('/mw/amz',{ kishu:'PS5', stock_min:5 });
const fb2=calls.filter((x)=>/feesEstimate/.test(x.url))
  .map((x)=>JSON.parse(x.body)
    .map((y)=>y.FeesEstimateRequest.PriceToEstimateFees.ListingPrice.Amount));
console.log('   聞いた売値: '+JSON.stringify(fb2)+' / '+JSON.stringify(r.body.fee));
ok(fb2.some((x)=>x.indexOf(12000)>=0),
   '★★★売値が1割以上ずれた行は、新しい売値で聞き直す');
console.log('\n=== 一覧（GET /mw/amz）が様子を返す ===');
/* 写真の控えを1枚入れる（6.133。Amazon刈取の行に出すため）。 */
await env.DB.prepare(
  `INSERT INTO mw_img (jan,pos,mw_id,src,url,w,h,long_px,bytes,ct,ok,err,at,created_at)
   VALUES (?1,0,'10958868','https://matchingworld.asia/products/1/2/10958868.jpg',
     NULL,600,600,600,1000,'image/jpeg',1,'',?2,?2)`)
  .bind(JAN, new Date().toISOString()).run();
const g=await asJson(await worker.fetch(new Request(
  'https://x/mw/amz?kishu=PS5&stock_min=5',{headers:{'X-PJ-Key':'k'}}),env));
const gr=(g.body.rows||[]).filter((x)=>String(x.jan)===JAN)[0]||{};
console.log('   '+JSON.stringify({pics_ok:gr.pics_ok,pics_n:gr.pics_n,
  pics_long:gr.pics_long,main:String(gr.pics_main||'').slice(-18)})
  +' / fee '+JSON.stringify(g.body.fee));
ok(Number(gr.pics_ok)===1&&Number(gr.pics_n)===1,
   '★★★行ごとに写真の枚数を返す（6.133）');
ok(Number(gr.pics_long)===600,'★★★メインの長辺も返す');
ok(/10958868\.jpg$/.test(String(gr.pics_main||'')),'★★見本に使うURLも返す');
ok(g.body.fee&&Number(g.body.fee.n)>0,'★★★手数料の様子を返す（7.97）');
ok(Number(g.body.fee.ok)>=1,'★★実額が取れている件数');
ok(Array.isArray(g.body.fee.why),'★★だめだった理由の一覧');
await T.done();
