/* Worker：MW の価格を自動で取り直す（毎時 :37・7.86）
   ・既定はオフ（⚙設定 mwAutoMode）
   ・1回 価格20件（＋手数料）・可否20件
   ・優先順 ①仕入れる印あり ②まだ値段が無い ③粗利の大きい順 ④価格が古い順
     ③は手数料が取れている行は**その手数料で**、まだの行は一律の見込みで
   ・既存の毎時（:07）と分で分ける（10秒に1回の間隔の取り合いを避ける） */
import { harness, loadWorker, makeEnv, post, asJson } from './lib.mjs';
const T=harness('Worker：MWの自動の取り直し');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwauto');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs', LWA_REFRESH_TOKEN:'rt',
  SP_SELLER_ID:'A1SELLER9999' });

let calls=[], offers={}, rst={};
globalThis.fetch=async(u,i)=>{
  const url=String(u); calls.push(url);
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
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
    return new Response(JSON.stringify({FeesEstimateResultList:
      b.FeesEstimateByIdRequestList.map((q)=>({
        FeesEstimateIdentifier:{IdType:'ASIN',IdValue:q.IdValue},
        FeesEstimateResult:{Status:'Success',FeesEstimate:{
          TotalFeesEstimate:{Amount:1000},
          FeeDetailList:[{FeeType:'ReferralFee',FinalFee:{Amount:700}},
                         {FeeType:'FBAFees',FinalFee:{Amount:230}},
                         {FeeType:'ReferralFeeTax',FinalFee:{Amount:70}}]}}}))}),
      {status:200});
  }
  if(/restrictions/.test(url)){
    const a=new URL(url).searchParams.get('asin');
    return new Response(JSON.stringify(rst[a]||{restrictions:[]}),{status:200});
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
const mkOff=(asin,yen)=>({ ASIN:asin, Summary:{ TotalOfferCount:2,
  NumberOfOffers:[{condition:'new',OfferCount:2}],
  BuyBoxPrices:[{condition:'New',LandedPrice:{Amount:yen}}],
  LowestPrices:[{condition:'new',LandedPrice:{Amount:yen}}] },
  Offers:[{ SubCondition:'new', ListingPrice:{Amount:yen}, Shipping:{Amount:0},
    IsBuyBoxWinner:true, IsFulfilledByAmazon:true, SellerId:'A1X' }] });
const row=(jan,x)=>Object.assign({jan:jan,sha:'M200',idx:0,kishu:'NS',
  name:jan+'の商品',list_price:9800,release:'2025/01/01',cond:'新品',
  wholesale:3000,stock:9,note:'',ship_text:'即日出荷',ship_days:0},x||{});
const put=async(path,body,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
let atSeq=0;
const setCfg=async(o)=>await asJson(await worker.fetch(post('/settings',
  {at:new Date(Date.now()+(++atSeq)*1000).toISOString(),
   settings:Object.assign({mwKishu:'NS',mwShipMax:4,mwStockMin:5,mwNoteNg:'',
     pbMode:'off',autoMdMode:'off',autoRvMode:'off'},o||{})}),env));

console.log('=== 既定はオフ ===');
await setCfg({});
let st=await W.mwAutoSettings(env);
console.log('   '+JSON.stringify({mode:st.mode,opt:st.opt}));
ok(st.mode==='off','★★★既定はオフ');
ok(st.opt.kishu==='NS'&&st.opt.ship_max===4&&st.opt.stock_min===5,
   '★★★画面の絞り込み（⚙設定）と同じ条件を使う');
calls=[];
let r=await put('/mw/auto',{});
console.log('   '+JSON.stringify({mode:r.body.mode,price:r.body.price_n}));
ok(r.body.mode==='off'&&r.body.price_n===0,'★★オフなら何もしない');
ok(calls.filter((u)=>/itemOffers|restrictions|feesEstimate/.test(u)).length===0,
   '★★★オフなら1回も呼ばない');

console.log('\n=== オンにすると価格・手数料・可否を取る ===');
await setCfg({ mwAutoMode:'on' });
const J=[];
for(let i=0;i<5;i++){
  const jan='49023705504'+String(60+i);
  J.push(jan);
  await put('/mw/stock',{at:'2026-11-09T00:00:00Z',part:1,parts:1,rows:[row(jan)]});
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,checked_at,asin_at,created_at)
     VALUES (?1,?2,'x','x','x','x')`)
    .bind(jan,'B0AUTO000'+i).run();
  offers['B0AUTO000'+i]=mkOff('B0AUTO000'+i,8000+i*1000);
}
calls=[];
r=await put('/mw/auto',{});
console.log('   '+JSON.stringify({price:r.body.price_n,fee:r.body.fee_n,
  rst:r.body.rst_n,calls:r.body.calls}));
ok(r.body.mode==='on','★★オン');
ok(r.body.price_n===5,'★★★価格を取る');
ok(r.body.fee_n===5,'★★★手数料も取る');
ok(r.body.rst_n===5,'★★★可否も同じ回で調べる');
ok(calls.filter((u)=>/itemOffers/.test(u)).length===1,'★価格は1回');
ok(calls.filter((u)=>/feesEstimate/.test(u)).length===1,'★手数料は1回');
ok(calls.filter((u)=>/restrictions/.test(u)).length===5,'★可否は1件1回');
ok(W.MW_AUTO_PRICE_N===20&&W.MW_AUTO_RST_N===20,'★★1回20件ずつ');

console.log('\n=== 記録を残す ===');
const last=await env.DB.prepare(
  'SELECT * FROM mw_auto_runs ORDER BY id DESC LIMIT 1').first();
console.log('   '+String(last.note).slice(0,70));
ok(last.kind==='hand'&&last.price_n===5&&last.rst_n===5,'★★記録に件数を残す');
ok(/価格 5件/.test(String(last.note||'')),'★中身も残す');

console.log('\n=== 優先順（仕入れる印・粗利）===');
/* 価格をいったん古くして、どの順で取るかを見る。 */
await env.DB.prepare("UPDATE mw_amz SET price_at='2020-01-01T00:00:00Z'").run();
/* いちばん粗利が低い行に「仕入れる」印を付ける → それが先に来る */
await put('/mw/buy',{ jan:J[0], qty:1 });
const run0={ kind:'t', subrequests:0, pages:0, errors:0, notes:[], rows:0 };
const o={ kishu:'NS', stock_min:5, limit:2, order:'auto' };
calls=[];
let sp=await W.mwScanPrice(env,run0,o,Date.now()+60000);
const uris=calls.filter((u)=>/itemOffers/.test(u)).length;
console.log('   '+JSON.stringify({done:sp.done,calls:uris}));
ok(sp.done===2,'★★上限2件だけ取る');
const got=await env.DB.prepare(
  "SELECT jan FROM mw_amz WHERE price_at<>'2020-01-01T00:00:00Z' ORDER BY jan").all();
const gj=got.results.map((x)=>String(x.jan));
console.log('   取った JAN: '+JSON.stringify(gj));
ok(gj.indexOf(J[0])>=0,'★★★仕入れる印の行を先に取る（粗利が低くても）');
ok(gj.indexOf(J[4])>=0,'★★★残りは粗利の大きい順（売値がいちばん高い行）');

console.log('\n=== 手数料が入っていれば、その手数料で粗利を見る ===');
/* J[4]（売値12,000）の手数料をわざと大きくして、J[3] より下げる */
await env.DB.prepare("UPDATE mw_amz SET price_at='2020-01-01T00:00:00Z'").run();
await env.DB.prepare(
  "UPDATE mw_amz SET fee_total=9000 WHERE jan=?1").bind(J[4]).run();
await put('/mw/buy',{ jan:J[0], qty:0 });       // 印を外す
calls=[];
sp=await W.mwScanPrice(env,run0,{ kishu:'NS', stock_min:5, limit:1, order:'auto' },
  Date.now()+60000);
const got2=await env.DB.prepare(
  "SELECT jan FROM mw_amz WHERE price_at<>'2020-01-01T00:00:00Z'").all();
console.log('   取った JAN: '+JSON.stringify(got2.results.map((x)=>x.jan)));
ok(got2.results.length===1&&String(got2.results[0].jan)===J[3],
   '★★★手数料が大きい行は後回しになる（本当の粗利で並ぶ）');

console.log('\n=== Cron の時間帯 ===');
const src=(await import('node:fs')).default.readFileSync(
  (await import('./lib.mjs')).ROOT+'/proxy-sync/wrangler.toml','utf8');
console.log('   '+(/crons = \[(.*)\]/.exec(src)||[])[1]);
ok(/"37 \* \* \* \*"/.test(src),'★★★毎時37分の Cron を足す');
ok(/"7 \* \* \* \*"/.test(src),'★既存の毎時（:07）はそのまま');
const ws=(await import('node:fs')).default.readFileSync(
  (await import('./lib.mjs')).WORKER,'utf8');
ok(/cron\.indexOf\("37 "\) === 0/.test(ws),'★★:37 の回で自動の取り直しを走らせる');
ok(W.MW_AUTO_BUDGET_MS===45000,'★1回の持ち時間は45秒（60秒の手前）');

console.log('\n=== 作業者のキー ===');
r=await put('/mw/auto',{},'staff-key-123');
ok(r.status===403,'★★作業者では走らせられない');

await T.done();
