/* Worker：手数料の「だめ」を自動で切り分ける（7.129・【V の続き】の4）

   カジの切り分け（B00C1W039S・3Dマウスパッド『春』・¥3,137）
     ① いまと同じ（FBA で出す）… だめ ／ ② 自分で発送 … 取れた ¥290
     ③ FBA の指定なし … 取れた ¥290 ／ ④ FBA・1,000円 … だめ
   → **その ASIN で FBA の見積もりが出せない**のが原因だった。

   ① だめだった行を 20件ずつ聞いて FBA不可／値段／ASIN・市場 に分ける
   ② FBA不可の行は「自分で発送」の販売手数料と消費税を**実額**で控える
   ③ 分かった行は手数料の取り直しの対象から外す（30日に1回だけ確かめ直す）
   ④ 一覧の「だめ」の件数を内訳つきで返す
   ⑤ 列が無い（migrate-0050 の前）でも落ちない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：手数料の「だめ」を自動で切り分ける（7.129）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwfeekind');

/* FBA 不可の ASIN・値段が原因の ASIN・どちらでもだめな ASIN を作る。 */
const FBA_NG='B0FBANG0001', PRICE_NG='B0PRICE0002', OTHER='B0OTHER0003';
let sent=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/discord/.test(url))return new Response(null,{status:204});
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),
                        {status:200});
  if(/feesEstimate/.test(url)){
    const b=JSON.parse(String(o.body||'[]'));
    sent.push(b);
    const out=b.map((x)=>{
      const req=x.FeesEstimateRequest||{};
      const id=String(x.IdValue||'');
      const fba=req.IsAmazonFulfilled;
      const amt=((req.PriceToEstimateFees||{}).ListingPrice||{}).Amount;
      let ok2=true;
      if(id===FBA_NG)ok2=(fba===false);              // 自分で発送なら取れる
      else if(id===PRICE_NG)ok2=(amt===1000);        // 1,000円なら取れる
      else if(id===OTHER)ok2=false;                  // どれでもだめ
      if(!ok2)return { Status:'ClientError',
        FeesEstimateIdentifier:{ IdValue:id },
        Error:{ Type:'Sender', Code:'InvalidParameterValue',
          Message:'There is an client-side error. Please verify your inputs.' } };
      return { Status:'Success', FeesEstimateIdentifier:{ IdValue:id },
        FeesEstimate:{ TotalFeesEstimate:{ Amount:290 },
          FeeDetailList:[{ FeeType:'ReferralFee', FinalFee:{ Amount:264 } },
                         { FeeType:'Tax', FinalFee:{ Amount:26 } }] } };
    });
    return new Response(JSON.stringify(out),{status:200});
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
  `INSERT INTO mw_amz (jan,asin,name,price,basis,new_n,checked_at,price_at,
     fee_total,fee_err,fee_at,fee_kind,fee_kind_at)
   VALUES (?1,?2,'Amazon名',?3,'カート',3,?4,?4,?5,?6,?7,?8,?9)`)
  .bind(o.jan, o.asin, o.price===undefined?3137:o.price,
        '2026-11-10T00:00:00Z', o.fee_total||null,
        o.fee_err===undefined
          ? '手数料が返りませんでした（ClientError）：Sender: '
            +'InvalidParameterValue: There is an client-side error.'
          : o.fee_err,
        o.fee_at||'2026-11-10T00:00:00Z', o.fee_kind||null,
        o.fee_kind_at||null).run();
const jan=(i)=>'49023714'+String(10000+i).slice(-5);
const opt=()=>({ kishu:'', new_only:1, ship_max:14, stock_min:1 });
const kind=async(env,asin)=>(await env.DB.prepare(
  `SELECT fee_kind,fee_kind_at,fee_mfn,fee_ref,fee_tax,fee_base,fee_err,
          fee_total FROM mw_amz WHERE asin=?1`).bind(asin).first())||{};

console.log('=== ① 20件ずつ聞いて3つに分ける ===');
{
  const env=env0();
  await put(env,{ jan:jan(0), name:'3Dマウスパッド『春』' });
  await amz(env,{ jan:jan(0), asin:FBA_NG, price:3137 });
  await put(env,{ jan:jan(1) });
  await amz(env,{ jan:jan(1), asin:PRICE_NG, price:99999 });
  await put(env,{ jan:jan(2) });
  await amz(env,{ jan:jan(2), asin:OTHER, price:3000 });
  sent=[];
  const st=await W.mwScanFeeWhy(env,W.newRun('t'),opt(),Date.now()+60000);
  console.log('   '+JSON.stringify({ need:st.need, done:st.done,
    fba_ng:st.fba_ng, price:st.price, other:st.other, calls:st.calls }));
  ok(st.need===3&&st.done===3,'★★★だめだった3件をぜんぶ切り分ける');
  ok(st.fba_ng===1&&st.price===1&&st.other===1,
     '★★★FBA不可・値段・その他 に分かれる');
  ok(st.calls===2,
     '★★★20件ずつ・2回で済む（まず自分で発送、だめな行だけ FBA・1,000円）');
  ok(sent[0].every((x)=>x.FeesEstimateRequest.IsAmazonFulfilled===false),
     '★★★1回目は「自分で発送」で聞く');
  ok(sent[0].length===3,'★★1回目は3件まとめて');
  ok(sent[1].length===2
     &&sent[1].every((x)=>x.FeesEstimateRequest.IsAmazonFulfilled===true
       &&((x.FeesEstimateRequest.PriceToEstimateFees||{}).ListingPrice||{})
         .Amount===1000),
     '★★★2回目は取れなかった2件だけ「FBA・1,000円」で聞く');
  const ids=sent[0].map((x)=>x.FeesEstimateRequest.Identifier);
  const u={}; ids.forEach((x)=>{ u[x]=1; });
  ok(Object.keys(u).length===3,'★Identifier は重ならない');
  const a=await kind(env,FBA_NG), b=await kind(env,PRICE_NG),
        c=await kind(env,OTHER);
  console.log('   '+JSON.stringify({ a:a.fee_kind, b:b.fee_kind,
    c:c.fee_kind }));
  ok(a.fee_kind==='fba_ng'&&b.fee_kind==='price'&&c.fee_kind==='other',
     '★★★D1 に結果を控える');
  ok(a.fee_kind_at&&b.fee_kind_at,'★★切り分けた日時も控える');
  ok(/返りませんでした/.test(String(a.fee_err||''))
     &&/InvalidParameterValue/.test(String(a.fee_err||'')),
     '★★★fee_err は SP-API の原文のまま残す（⚙で原文を確かめられる）');
  ok(/返りませんでした/.test(String(b.fee_err||''))
     &&/返りませんでした/.test(String(c.fee_err||'')),
     '★★ほかの理由の行も原文のまま');
}

console.log('\n=== ② FBA不可の行は「自分で発送」の手数料を実額で控える ===');
{
  const env=env0();
  await put(env,{ jan:jan(0) });
  await amz(env,{ jan:jan(0), asin:FBA_NG, price:3137 });
  await W.mwScanFeeWhy(env,W.newRun('t'),opt(),Date.now()+60000);
  const a=await kind(env,FBA_NG);
  console.log('   '+JSON.stringify(a));
  ok(+a.fee_mfn===1,'★★★「販売手数料だけ実額」の印を立てる');
  ok(+a.fee_ref===264&&+a.fee_tax===26,
     '★★★販売手数料と消費税は Amazon の実額（¥264＋¥26＝¥290）');
  ok(+a.fee_base===3137,'★★どの値段で聞いたかも控える');
  ok(a.fee_total===null,
     '★★★合計は入れない（FBA は⚙の目安を足すので、画面側で出す）');
  /* 値段が原因・その他の行は実額を控えない。 */
  const env2=env0();
  await put(env2,{ jan:jan(1) });
  await amz(env2,{ jan:jan(1), asin:OTHER, price:3000 });
  await W.mwScanFeeWhy(env2,W.newRun('t'),opt(),Date.now()+60000);
  const c=await kind(env2,OTHER);
  ok(+c.fee_mfn===0&&c.fee_ref===null,'★★取れなかった行は実額を控えない');
}

console.log('\n=== ③ 分かった行は取り直しの対象から外す ===');
{
  const env=env0();
  await put(env,{ jan:jan(0) });
  await amz(env,{ jan:jan(0), asin:FBA_NG, price:3137 });
  await put(env,{ jan:jan(1) });
  await amz(env,{ jan:jan(1), asin:'B0YET000004', price:3000 });
  /* 切り分ける前は、手数料の取り直しの対象に2件とも入る。 */
  const f0=await W.mwScanFee(env,W.newRun('t'),
    Object.assign({},opt(),{ limit:0 }),Date.now()-1);
  ok(f0.need===2,'★切り分ける前は2件とも対象');
  await W.mwScanFeeWhy(env,W.newRun('t'),opt(),Date.now()+60000);
  const f1=await W.mwScanFee(env,W.newRun('t'),
    Object.assign({},opt(),{ limit:0 }),Date.now()-1);
  console.log('   切り分けたあとの対象 '+f1.need+'件');
  ok(f1.need===0,
     '★★★切り分けが済んだ行は、手数料の取り直しの対象から外れる');
  /* 30日たつと、切り分けだけもう一度やる。 */
  const old=new Date(Date.now()-40*86400000).toISOString();
  await env.DB.prepare(`UPDATE mw_amz SET fee_kind_at=?1 WHERE asin=?2`)
    .bind(old,FBA_NG).run();
  const w2=await W.mwScanFeeWhy(env,W.newRun('t'),opt(),Date.now()+60000);
  console.log('   30日たったあとの切り分け '+w2.need+'件');
  ok(w2.need>=1,'★★★30日たったら、もう一度だけ確かめ直す');
  ok(W.MW_WHY_TTL_D===30&&W.MW_WHY_MAX===40,
     '★★30日に1回・1回40件まで');
  /* 「値段が原因」の行は、値段が1割以上変わったら手数料をもう一度取りに行く。 */
  const env3=env0();
  await put(env3,{ jan:jan(2) });
  await amz(env3,{ jan:jan(2), asin:PRICE_NG, price:99999 });
  await W.mwScanFeeWhy(env3,W.newRun('t'),opt(),Date.now()+60000);
  const g0=await W.mwScanFee(env3,W.newRun('t'),
    Object.assign({},opt(),{ limit:0 }),Date.now()-1);
  ok(g0.need===0,'★「値段が原因」も、値段が同じうちは対象にしない');
  await env3.DB.prepare(`UPDATE mw_amz SET price=1000 WHERE asin=?1`)
    .bind(PRICE_NG).run();
  const g1=await W.mwScanFee(env3,W.newRun('t'),
    Object.assign({},opt(),{ limit:0 }),Date.now()-1);
  ok(g1.need===1,
     '★★★「値段が原因」の行は、値段が変わったらもう一度取りに行く');
}

console.log('\n=== ④ 一覧の「だめ」の件数を内訳で返す ===');
{
  const env=env0();
  await put(env,{ jan:jan(0) });
  await amz(env,{ jan:jan(0), asin:FBA_NG, price:3137 });
  await put(env,{ jan:jan(1) });
  await amz(env,{ jan:jan(1), asin:PRICE_NG, price:99999 });
  await put(env,{ jan:jan(2) });
  await amz(env,{ jan:jan(2), asin:OTHER, price:3000 });
  await put(env,{ jan:jan(4) });
  await amz(env,{ jan:jan(4), asin:'B0OK00000006', price:3000,
    fee_total:1500, fee_err:'' });
  await W.mwScanFeeWhy(env,W.newRun('t'),opt(),Date.now()+60000);
  /* 切り分けたあとに「まだ切り分けていない行」を1件足す。 */
  await put(env,{ jan:jan(3) });
  await amz(env,{ jan:jan(3), asin:'B0YET000005', price:3000 });
  const d=(await asJson(await worker.fetch(
    get('/mw/amz?limit=10&ship_max=14&stock_min=1'),env,{}))).body;
  console.log('   '+JSON.stringify(d.fee));
  ok(d.fee.kind_ok===true,'★内訳を出せる（列がある）');
  ok(d.fee.fba_ng===1&&d.fee.price_ng===1&&d.fee.other_ng===1,
     '★★★FBA不可／値段／その他 の件数を返す');
  ok(d.fee.yet===1,'★★★まだ切り分けていない件数も返す');
  ok(d.fee.mfn===1,'★★「販売手数料だけ実額」の件数も返す');
  ok(d.fee.ng===4,'★「だめ」の合計は今までどおり');
  /* 行にも fee_kind を返す（画面が「FBA 不可」の印を出せる）。 */
  const row=(d.rows||[]).filter((r)=>r.asin===FBA_NG)[0]||{};
  ok(row.fee_kind==='fba_ng'&&+row.fee_mfn===1,
     '★★★行にも切り分けの結果を返す');
  ok(+row.fee_ref===264&&+row.fee_tax===26,
     '★★★行に「自分で発送」の実額を返す（画面が⚙の目安を足す）');
}

console.log('\n=== ④ POST /mw/fee/why/run（いますぐ切り分ける）===');
{
  const env=env0();
  await put(env,{ jan:jan(0) });
  await amz(env,{ jan:jan(0), asin:FBA_NG, price:3137 });
  const d=(await asJson(await worker.fetch(
    post('/mw/fee/why/run',{ max:40 }),env,{}))).body;
  console.log('   '+JSON.stringify({ ok:d.ok, done:d.done, fba_ng:d.fba_ng }));
  ok(d.ok===true&&d.done===1&&d.fba_ng===1,'★★★押すとその場で切り分ける');
  const r=await worker.fetch(
    new Request('https://x/mw/fee/why/run',{ method:'POST',
      headers:{ 'X-PJ-Key':'staff-key-123','content-type':'application/json' },
      body:'{}' }),env,{});
  ok(r.status===403,'★★★作業者のキーでは動かせない');
}

console.log('\n=== ⑤ 列が無くても落ちない（migrate-0050 の前）===');
{
  const { worker:w2, T:W2 }=await loadWorker('mwfeekind-no');
  const env=env0();
  await env.DB.prepare(`DROP INDEX IF EXISTS idx_mw_amz_fee_kind`).run();
  await env.DB.prepare(`ALTER TABLE mw_amz DROP COLUMN fee_kind`).run();
  await env.DB.prepare(`ALTER TABLE mw_amz DROP COLUMN fee_mfn`).run();
  await put(env,{ jan:jan(0) });
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,basis,new_n,checked_at,price_at,
       fee_err,fee_at) VALUES (?1,?2,'x',3137,'カート',3,?3,?3,'だめ',?3)`)
    .bind(jan(0),FBA_NG,'2026-11-10T00:00:00Z').run();
  const st=await W2.mwScanFeeWhy(env,W2.newRun('t'),opt(),Date.now()+60000);
  console.log('   '+JSON.stringify({ stopped:st.stopped, done:st.done }));
  ok(st.stopped==='no_column'&&st.done===0,
     '★★★列が無ければ「no_column」で止まる（落ちない）');
  const d=(await asJson(await w2.fetch(
    get('/mw/amz?limit=10&ship_max=14&stock_min=1'),env,{}))).body;
  ok(d.ok===true&&d.fee.kind_ok===false,
     '★★★一覧も落ちない（内訳は出さない）');
  const f=await W2.mwScanFee(env,W2.newRun('t'),
    Object.assign({},opt(),{ limit:0 }),Date.now()-1);
  ok(f.need===1,'★★★手数料の取り直しも今までどおり動く');
}
T.done();
