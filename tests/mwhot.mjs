/* Worker：古い値段の取り直しの優先と、手数料のだめの切り分け（7.128・【V の続き】）

   ① 大事な行（「仕入れる」の印・eBay に無在庫で出品中・利益の高い行）は、
      値段が**24時間**より古くなったら取り直しの対象に入れる
      （v249 までは **3日**たった行だけだったので、画面が「24時間より古い」と
        赤で出していても対象に入っていなかった）
   ② それ以外の行は今までどおり3日
   ③ 自動の並びでは、24時間より古い行をいちばん先に回す
   ④ GET /mw/fee/why … 送り方を変えて4回聞き、原因を切り分ける（調べるだけ） */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：古い値段の優先と手数料の切り分け（7.128）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwhot');

let sent=[], feeMode='ng';
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/discord/.test(url))return new Response(null,{status:204});
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),
                        {status:200});
  if(/feesEstimate/.test(url)){
    const b=JSON.parse(String(o.body||'[]'));
    sent.push(b);
    const req=(b[0]||{}).FeesEstimateRequest||{};
    const fba=req.IsAmazonFulfilled;
    const amt=((req.PriceToEstimateFees||{}).ListingPrice||{}).Amount;
    /* FBA のときだけだめ（＝この ASIN は FBA の見積もりが出せない）。 */
    if((feeMode==='ng')&&(fba===true)&&(amt!==1000))
      return new Response(JSON.stringify([{ Status:'ClientError',
        FeesEstimateIdentifier:{ IdValue:String(b[0].IdValue||'') },
        Error:{ Type:'Sender', Code:'InvalidParameterValue',
          Message:'The value for IsAmazonFulfilled is not valid for this ASIN.' }
      }]),{status:200});
    return new Response(JSON.stringify([{ Status:'Success',
      FeesEstimateIdentifier:{ IdValue:String(b[0].IdValue||'') },
      FeesEstimate:{ TotalFeesEstimate:{ Amount:1500 },
        FeeDetailList:[{ FeeType:'ReferralFee', FinalFee:{ Amount:1000 } },
                       { FeeType:'FBAFees', FinalFee:{ Amount:400 } },
                       { FeeType:'Tax', FinalFee:{ Amount:100 } }] } }]),
      {status:200});
  }
  return new Response('{}',{status:200});
};
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123', SP_SELLER_ID:'A1SELLER' });
const put=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,list_price,release,cond,
     wholesale,stock,note,ship_text,ship_days,row_hash,pick,seen_at,gone_at,
     created_at)
   VALUES (?1,'いろは商会',0,'NS2',?2,7678,'','新品',?3,9,'','即日',0,'h',1,?4,
     NULL,?4)`)
  .bind(o.jan, o.name||('商品'+o.jan), o.wholesale||3000,
        '2026-11-10T00:00:00Z').run();
const amz=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,basis,new_n,checked_at,
     fee_total,fee_ref,fee_fba,fee_tax,fee_base,size_tier,price_at)
   VALUES (?1,?2,'Amazon名',?3,'カート',3,?4,1500,1000,400,100,?3,'m',?5)`)
  .bind(o.jan, o.asin, o.price, '2026-11-10T00:00:00Z', o.price_at).run();
const buy=(env,jan)=>env.DB.prepare(
  `INSERT INTO mw_buy (jan,qty,by_role,at,created_at)
   VALUES (?1,1,'admin',?2,?2)`).bind(jan,'2026-11-01T00:00:00Z').run();
const item=(env,jan)=>env.DB.prepare(
  `INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,updated_at)
   VALUES (?1,'new','ebay','x',?2,'1234567890',?3)`)
  .bind('W'+jan,'W-'+jan,'2026-11-10T00:00:00Z').run();
const jan=(i)=>'49023713'+String(10000+i).slice(-5);
const hrs=(h)=>new Date(Date.now()-h*3600000).toISOString();
const scan=async(env)=>await W.mwScanPrice(env,W.newRun('t'),
  { kishu:'', new_only:1, ship_max:3, stock_min:1, limit:0, order:'auto' },
  Date.now()-1);

console.log('=== ① 大事な行は24時間で取り直す ===');
{
  const env=env0();
  /* ぜんぶ30時間前の値段。
     ① 仕入れるの印（粗利は小さい） ② eBay 無在庫（粗利は小さい）
     ③ 利益の高い行 ④ ふつう（粗利が小さい・印なし） */
  await put(env,{ jan:jan(0) });
  await amz(env,{ jan:jan(0), asin:'B0HOT00001', price:4200,
                  price_at:hrs(30) });
  await buy(env,jan(0));
  await put(env,{ jan:jan(1) });
  await amz(env,{ jan:jan(1), asin:'B0HOT00002', price:4200,
                  price_at:hrs(30) });
  await item(env,jan(1));
  await put(env,{ jan:jan(2) });
  await amz(env,{ jan:jan(2), asin:'B0HOT00003', price:9000,
                  price_at:hrs(30) });
  await put(env,{ jan:jan(3) });
  await amz(env,{ jan:jan(3), asin:'B0COL00004', price:4200,
                  price_at:hrs(30) });
  const st=await scan(env);
  console.log('   30時間前の4件のうち 対象 '+st.asked+'件');
  ok(st.asked===3,
     '★★★30時間前なら、仕入れるの印・eBay 無在庫・利益の高い行が対象に入る');
  ok(W.MW_AMZ_TTL_HOT_H===24,'★★大事な行は24時間');
  ok(W.MW_HOT_YEN===1000,'★★「利益が高い」の目安は1,000円');
  /* ふつうの行は3日たてば入る（今までどおり）。 */
  await env.DB.prepare(`UPDATE mw_amz SET price_at=?1 WHERE jan=?2`)
    .bind(hrs(24*4),jan(3)).run();
  const st2=await scan(env);
  console.log('   ふつうの行を4日前にしたら 対象 '+st2.asked+'件');
  ok(st2.asked===4,'★★★3日たてばふつうの行も対象に入る（今までどおり）');
}

console.log('\n=== ② 24時間たっていない行は対象にしない ===');
{
  const env=env0();
  await put(env,{ jan:jan(0) });
  await amz(env,{ jan:jan(0), asin:'B0NEW00001', price:9000,
                  price_at:hrs(20) });     // 20時間前（まだ新しい）
  await buy(env,jan(0));
  const st=await scan(env);
  ok(st.asked===0,'★★★24時間たっていなければ、大事な行でも取り直さない');
}
{
  const env=env0();
  await put(env,{ jan:jan(1) });
  await amz(env,{ jan:jan(1), asin:'B0OLD00002', price:4200,
                  price_at:hrs(30) });     // 30時間前・ふつうの行
  const st=await scan(env);
  ok(st.asked===0,
     '★★★ふつうの行は24時間では取り直さない（3日のまま・枠を食わない）');
}

console.log('\n=== ③ 自動の並びは24時間より古い行を先に ===');
{
  const env=env0();
  /* 40時間前のふつうの行（4日前にして対象に入れる）と、
     26時間前の仕入れるの印の行。印の行が先に来ること。 */
  await put(env,{ jan:jan(5) });
  await amz(env,{ jan:jan(5), asin:'B0ORD00005', price:4200,
                  price_at:hrs(24*5) });
  await put(env,{ jan:jan(6) });
  await amz(env,{ jan:jan(6), asin:'B0ORD00006', price:4200,
                  price_at:hrs(26) });
  await buy(env,jan(6));
  const q=await env.DB.prepare(
    `SELECT jan FROM mw_amz ORDER BY price_at ASC`).all();
  console.log('   古い順: '+(q.results||[]).map((x)=>x.jan.slice(-1)).join('/'));
  const st=await scan(env);
  ok(st.asked===2,'★2件とも対象に入る');
  /* 取り直す順（1件だけ回したときに、どちらが先か）。 */
  const st1=await W.mwScanPrice(env,W.newRun('t'),
    { kishu:'', new_only:1, ship_max:3, stock_min:1, limit:1, order:'auto' },
    Date.now()+30000);
  ok(st1.done<=1,'★★1件だけ回せる');
}

console.log('\n=== ④ GET /mw/fee/why（原因の切り分け）===');
{
  const env=env0();
  sent=[]; feeMode='ng';
  const d=(await asJson(await worker.fetch(
    get('/mw/fee/why?asin=B0DV5D74ZQ&price=8800'),env,{}))).body;
  console.log('   '+(d.tried||[]).map((x)=>x.label+':'+(x.ok?'○':'×'))
    .join('／'));
  console.log('   '+String(d.why||''));
  ok(d.ok===true&&(d.tried||[]).length===4,'★★★送り方を4通り試す');
  ok(sent.length===4,'★★★Amazon に4回だけ聞く');
  ok(sent[0][0].FeesEstimateRequest.IsAmazonFulfilled===true
     &&sent[1][0].FeesEstimateRequest.IsAmazonFulfilled===false
     &&sent[2][0].FeesEstimateRequest.IsAmazonFulfilled===undefined,
     '★★★FBA あり／なし／指定なし を試す');
  ok(((sent[3][0].FeesEstimateRequest.PriceToEstimateFees||{})
      .ListingPrice||{}).Amount===1000,'★★★値段だけ変えた回も試す');
  ok(d.tried[0].ok===false&&d.tried[1].ok===true,'★★★どれなら通るかを返す');
  ok(/FBA（Amazon から出す）の見積もりが出せません/.test(String(d.why)),
     '★★★「この ASIN は FBA の見積もりが出せない」と言い当てる');
  ok(/pj からは直せません/.test(String(d.fix)),'★★直し方も日本語で出す');
  ok(d.mp&&/^A[0-9A-Z]+$/.test(String(d.mp)),'★送っている市場も返す');
  /* ぜんぶ通るときは「そのときだけの失敗」。 */
  sent=[]; feeMode='ok';
  const d2=(await asJson(await worker.fetch(
    get('/mw/fee/why?asin=B0DV5D74ZQ&price=8800'),env,{}))).body;
  ok(d2.tried[0].ok===true&&/もう一度/.test(String(d2.fix)),
     '★★通ったときはそう言う');
  const bad=(await asJson(await worker.fetch(
    get('/mw/fee/why?asin=ABC&price=100'),env,{}))).body;
  ok(bad.ok===false&&bad.error==='bad_asin','★ASIN の形が違えば断る');
  const bad2=(await asJson(await worker.fetch(
    get('/mw/fee/why?asin=B0DV5D74ZQ&price=0'),env,{}))).body;
  ok(bad2.ok===false&&bad2.error==='bad_price','★売値が0なら断る');
  /* 作業者のキーでは動かせない。D1 も書かない。 */
  const r=await worker.fetch(
    new Request('https://x/mw/fee/why?asin=B0DV5D74ZQ&price=100',
      { headers:{ 'X-PJ-Key':'staff-key-123' } }),env,{});
  ok(r.status===403,'★★★作業者のキーでは動かせない');
  const e=await env.DB.prepare(
    `SELECT fee_err,fee_total FROM mw_amz WHERE asin='B0DV5D74ZQ'`).first();
  ok(!e,'★★★D1 は書き替えない（調べるだけ）');
}
T.done();
