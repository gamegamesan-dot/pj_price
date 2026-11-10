/* Worker：件数の打ち切りをなくす・手数料のだめだった行（7.127・【V】）

   ① /mw/amz を offset で**続きから**取れる（打ち切らずに全件そろう）
      ・並びが一意（同じ値段の行があってもページの境目で重複・抜けが出ない）
      ・more で続きがあるか分かる
   ② /mw/fee/ng … だめだった行（ASIN・送った値段・理由の全文）を返す
      ・理由で絞り込める／そのまま /mw/fee/test に渡せる
   ③ 手数料の1件テストは B 以外の ASIN（本の10桁）も試せる
   ④ Amazon が受けない形（ASIN・売値0）は**送らない**で理由を残す
   ⑤ Identifier は1回のなかで重ならない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：件数の打ち切りと手数料のだめだった行（7.127）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwcount');

let fees=[], sent=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/discord/.test(url))return new Response(null,{status:204});
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),
                        {status:200});
  if(/feesEstimate/.test(url)){
    const b=JSON.parse(String(o.body||'[]'));
    sent.push(b);
    return new Response(JSON.stringify(b.map((x)=>({
      Status:'ClientError',
      FeesEstimateIdentifier:{ IdType:'ASIN',
        IdValue:String(x.IdValue||''),
        SellerInputIdentifier:String((x.FeesEstimateRequest||{}).Identifier||'') },
      Error:{ Type:'Sender', Code:'InvalidParameterValue',
        Message:'The value for IsAmazonFulfilled is not valid for this ASIN '
          +'because the item is not eligible for Fulfillment by Amazon.' } }))),
      {status:200});
  }
  return new Response('{}',{status:200});
};
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123', SP_SELLER_ID:'A1SELLER' });
const put=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,list_price,release,cond,
     wholesale,stock,note,ship_text,ship_days,row_hash,pick,seen_at,gone_at,
     created_at)
   VALUES (?1,'いろは商会',0,'NS2',?2,7678,'','新品',3000,9,'','即日',0,'h',1,
     ?3,NULL,?3)`).bind(o.jan, o.name||('商品'+o.jan),
       '2026-11-10T00:00:00Z').run();
const amz=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,basis,new_n,checked_at,
     fee_total,fee_err,fee_at,fee_base,rank_cat,size_tier)
   VALUES (?1,?2,?3,?4,'カート',3,?5,?6,?7,?8,?9,?10,'m')`)
  .bind(o.jan, o.asin, o.name||'Amazon の名前', o.price===undefined?9000:o.price,
        '2026-11-10T00:00:00Z', o.fee_total||null, o.fee_err||null,
        o.fee_at||null, o.fee_base||null, o.rank_cat||'ゲーム').run();
const jan=(i)=>'49023708'+String(10000+i).slice(-5);
const asin=(i)=>'B0CNT'+String(10000+i).slice(-5);

console.log('=== ① /mw/amz は offset で続きから取れる ===');
{
  const env=env0();
  /* 値段は**わざと同じ**にして、並びが一意でないと境目でずれることを見る。 */
  for(let i=0;i<25;i++){ await put(env,{ jan:jan(i) });
    await amz(env,{ jan:jan(i), asin:asin(i), price:9000 }); }
  const page=async(off,lim)=>(await asJson(await worker.fetch(
    get('/mw/amz?priced=1&limit='+lim+'&offset='+off),env,{}))).body;
  const a=await page(0,10), b=await page(10,10), c=await page(20,10);
  console.log('   '+a.rows.length+'＋'+b.rows.length+'＋'+c.rows.length
    +'／値段あり '+a.priced+'　more '+a.more+'/'+b.more+'/'+c.more);
  ok(a.rows.length===10&&b.rows.length===10&&c.rows.length===5,
     '★★★offset で続きが取れる');
  ok(a.more===true&&b.more===true&&c.more===false,
     '★★★続きがあるかを more で返す');
  const all=a.rows.concat(b.rows).concat(c.rows).map((r)=>r.jan);
  const uniq={}; all.forEach((x)=>{ uniq[x]=1; });
  ok(all.length===25&&Object.keys(uniq).length===25,
     '★★★同じ値段でも重複・抜けが出ない（並びが一意）');
  ok(a.priced===25&&a.n===25,'★★値段ありの全件数も返す');
  ok(a.offset===0&&b.offset===10,'★offset をそのまま返す');
  ok(a.page_max===W.MW_AMZ_PAGE&&W.MW_AMZ_PAGE===1500,
     '★★1回に返す上限（1,500件）を返す');
  /* 上限を超えて頼んでも、上限までしか返さない。 */
  const big=await page(0,99999);
  ok(big.limit===W.MW_AMZ_PAGE,'★★★上限より多くは返さない（offset で続きを取る）');
}

console.log('\n=== ② /mw/fee/ng（だめだった行）===');
{
  const env=env0();
  await put(env,{ jan:jan(0), name:'だめだった商品A' });
  await amz(env,{ jan:jan(0), asin:asin(0), price:9000, fee_base:8800,
    fee_err:'手数料が返りませんでした（ClientError）：Sender: '
      +'InvalidParameterValue: The value for IsAmazonFulfilled is not valid',
    fee_at:'2026-11-10T01:00:00Z' });
  await put(env,{ jan:jan(1), name:'だめだった商品B' });
  await amz(env,{ jan:jan(1), asin:'4047356123', price:1200,
    fee_err:'ASIN の形が違うので送っていません（英数字10桁）',
    fee_at:'2026-11-10T02:00:00Z' });
  await put(env,{ jan:jan(2), name:'取れている商品' });
  await amz(env,{ jan:jan(2), asin:asin(2), price:9000, fee_total:1500,
    fee_at:'2026-11-10T03:00:00Z' });
  const d=(await asJson(await worker.fetch(get('/mw/fee/ng?limit=10'),env,{}))).body;
  console.log('   '+d.all+'件：'+d.rows.map((r)=>r.asin+' '+r.sent).join('／'));
  ok(d.ok===true&&d.all===2&&d.rows.length===2,
     '★★★だめだった行だけを返す（取れている行は返さない）');
  const a0=d.rows.filter((r)=>r.jan===jan(0))[0]||{};
  ok(a0.asin===asin(0)&&a0.sent===8800,
     '★★★ASIN と**送った値段**（fee_base）を返す');
  ok(/InvalidParameterValue: The value for IsAmazonFulfilled/.test(a0.why),
     '★★★理由を全文で返す（切らない）');
  ok(a0.at_jst&&a0.rank_cat==='ゲーム','★★日時（日本時間）と分類も返す');
  ok(d.mp&&/^A[0-9A-Z]+$/.test(String(d.mp)),
     '★★★送っている市場（MarketplaceId）も返す');
  const b0=d.rows.filter((r)=>r.jan===jan(1))[0]||{};
  ok(b0.asin==='4047356123'&&b0.sent===1200,
     '★★送った値段が無い行は、いまの値段を返す');
  /* 理由で絞り込む。 */
  const f=(await asJson(await worker.fetch(
    get('/mw/fee/ng?limit=10&why='+encodeURIComponent('IsAmazonFulfilled')),
    env,{}))).body;
  ok(f.all===1&&f.rows[0].jan===jan(0),'★★★理由で絞り込める');
  const g=(await asJson(await worker.fetch(
    get('/mw/fee/ng?limit=10&why='+encodeURIComponent("'%_\\")),env,{}))).body;
  ok(g.ok===true,'★★★記号を入れても落ちない（文字は落として組む）');
  ok(W.MW_FEE_NG_MAX===200,'★一度に返す上限');
}

console.log('\n=== ③ 1件テストは B 以外の ASIN も試せる ===');
{
  const env=env0();
  sent=[];
  const d=(await asJson(await worker.fetch(
    get('/mw/fee/test?asin=4047356123&price=1200'),env,{}))).body;
  console.log('   '+JSON.stringify({ ok:d.ok, asin:d.asin, err:String(d.err||'')
    .slice(0,60) }));
  ok(d.error!=='bad_asin'&&d.asin==='4047356123',
     '★★★本・雑誌の10桁の ASIN も試せる（B… だけに限らない）');
  ok(sent.length===1,'★★Amazon に1回だけ聞く');
  ok(/IsAmazonFulfilled/.test(String((d.pick||{}).err||'')),
     '★★★その商品の理由を全文で返す');
  const bad=(await asJson(await worker.fetch(
    get('/mw/fee/test?asin=ABC&price=1200'),env,{}))).body;
  ok(bad.ok===false&&bad.error==='bad_asin'&&/英数字10桁/.test(bad.note),
     '★★10桁でなければ断る（言い方も直す）');
  const bad2=(await asJson(await worker.fetch(
    get('/mw/fee/test?asin=B07MLZ2JKF&price=0'),env,{}))).body;
  ok(bad2.ok===false&&bad2.error==='bad_price','★売値が0なら断る');
}

console.log('\n=== ⑤ 送る本文：Identifier は重ならない ===');
{
  const body=W.mwFeeBody([{ asin:'B07MLZ2JKF', price:1980 },
                          { asin:'B07MLZ2JKF', price:2980 },
                          { asin:'4047356123', price:1200 }]);
  const ids=body.map((x)=>x.FeesEstimateRequest.Identifier);
  console.log('   '+ids.join('／'));
  const u={}; ids.forEach((x)=>{ u[x]=1; });
  ok(ids.length===3&&Object.keys(u).length===3,
     '★★★同じ ASIN が2つあっても Identifier は重ならない');
  ok(body.every((x)=>x.IdType==='ASIN'),'★IdType は ASIN');
  ok(body[0].IdValue==='B07MLZ2JKF','★★IdValue は ASIN そのまま（応答の照合に使う）');
  ok(body.every((x)=>x.FeesEstimateRequest.IsAmazonFulfilled===true),
     '★FBA の見積もりで聞く');
  ok(body[0].FeesEstimateRequest.PriceToEstimateFees.ListingPrice.Amount===1980
     &&body[0].FeesEstimateRequest.PriceToEstimateFees.ListingPrice
       .CurrencyCode==='JPY',
     '★★★送る値段は整数の円（JPY）');
}

console.log('\n=== ④ Amazon が受けない形は送らない ===');
{
  const env=env0();
  /* 形の違う ASIN と、売値0 の行。どちらも送らずに理由を残す。 */
  await put(env,{ jan:jan(0) });
  await amz(env,{ jan:jan(0), asin:'W4902370812345', price:9000 });
  await put(env,{ jan:jan(1) });
  await amz(env,{ jan:jan(1), asin:asin(1), price:9000 });
  sent=[];
  const r=await W.mwScanFee(env,W.newRun('t'),
    { kishu:'', new_only:1, ship_max:3, stock_min:1 },
    Date.now()+60000);
  console.log('   '+JSON.stringify({ need:r.need, done:r.done, ng:r.ng,
    whys:Object.keys(r.whys) })+'／送った '+sent.length+'回');
  ok(sent.length===1&&sent[0].length===1,
     '★★★形の違う ASIN は送らない（正しい1件だけ送る）');
  ok(r.whys['ASIN の形が違うので送っていません（英数字10桁）']===1,
     '★★★その場で理由を残す');
  const e=await env.DB.prepare(
    `SELECT fee_err FROM mw_amz WHERE asin='W4902370812345'`).first();
  ok(/ASIN の形が違う/.test(String((e||{}).fee_err||'')),
     '★★★D1 にも理由を残す（次に取り直すときの手がかり）');
}
{
  const env=env0();
  /* 値段が取れていない行は、そもそも手数料の対象に入らない（price>0 の条件）。 */
  await put(env,{ jan:jan(5) });
  await amz(env,{ jan:jan(5), asin:asin(5), price:0 });
  sent=[];
  const r=await W.mwScanFee(env,W.newRun('t'),
    { kishu:'', new_only:1, ship_max:3, stock_min:1 }, Date.now()+60000);
  ok(r.need===0&&!sent.length,'★★★値段が0の行は Amazon に聞かない');
}

console.log('\n=== ② だめだった理由は全文で残る ===');
{
  const env=env0();
  await put(env,{ jan:jan(0) });
  await amz(env,{ jan:jan(0), asin:asin(0), price:9000 });
  await W.mwScanFee(env,W.newRun('t'),
    { kishu:'', new_only:1, ship_max:3, stock_min:1 }, Date.now()+60000);
  const e=await env.DB.prepare(
    `SELECT fee_err FROM mw_amz WHERE asin=?1`).bind(asin(0)).first();
  const why=String((e||{}).fee_err||'');
  console.log('   '+why);
  ok(/Sender: InvalidParameterValue:/.test(why),
     '★★★Amazon の型・番号・文面をそのまま残す');
  ok(/not eligible for Fulfillment by Amazon\.$/.test(why),
     '★★★**最後まで**残す（300字で切らない）');
  const d=(await asJson(await worker.fetch(get('/mw/amz?priced=1'),env,{}))).body;
  const w0=((d.fee||{}).why||[])[0]||{};
  ok(/not eligible for Fulfillment by Amazon\.$/.test(String(w0.why||'')),
     '★★★一覧の「だめだった理由」にも全文で出す');
}
T.done();
