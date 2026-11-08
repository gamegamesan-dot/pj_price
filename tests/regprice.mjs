/* Worker：登録の直前に値段を取り直す（7.115・【O】）
   2026-11-08：薔薇と椿（JAN 4570101051127）を MW で仕入れ、届く前に
   「Amazon に登録する」で登録したら売値が ¥5,800（古い控え）になった。
   実際は**新品の出品者0人**で、中古の最安値 ¥7,168＋送料 ¥265＝¥7,433。
   ・送る直前に、その ASIN の出品を SP-API で**新品と中古の両方**取り直す
   ・取り直せなかったら登録しない（理由を返す）
   ・新品の出品者がいる → 新品の最安値（送料込み）
   ・新品が0人         → 中古の最安値（送料込み）× ⚙ mwUsedPct（既定120%）
   ・どちらもいない     → 登録せず「値段を手で決めてください」
                          （管理者は売値を入れて登録できる）
   ・確認の画面に売値と根拠を返し、「仕入原価＋手数料＋下限利益」を
     下回る行は floor_ng で知らせる
   ・登録済みの mw… の SKU の売値を直せる（patchListingsItem・管理者だけ） */
import { harness, loadWorker, makeEnv, get, asJson } from './lib.mjs';
const T=harness('Worker：登録の直前に値段を取り直す（7.115）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('regprice');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs', LWA_REFRESH_TOKEN:'rt',
  SP_SELLER_ID:'A1SELLER9999' });
W.SP_GAP.getItemOffersBatch=0;      // 本物は 0.1回/秒。テストでは待たせない
W.SP_GAP.patchListingsItem=0;

const JAN='4570101051127';          // 薔薇と椿
const ASIN='B0BARA0001';
const SKU='mwhobby-20261105-N-'+ASIN+'-3476';

let calls=[], reply={}, offers={}, offersFail=false;
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  if(/batches\/products\/pricing\/v0\/itemOffers/.test(url)){
    calls.push({url:url,method:o.method,label:'offers'});
    if(offersFail)return new Response('{"errors":[{"code":"x"}]}',{status:503});
    const reqs=(JSON.parse(String(o.body||'{}')).requests)||[];
    return new Response(JSON.stringify({ responses:reqs.map((q)=>{
      const a=(/\/items\/([A-Z0-9]{10})\/offers/.exec(String(q.uri||''))||[])[1]||'';
      const cond=String(q.ItemCondition||'New');
      const g=offers[a]||{ New:[], Used:[] };
      const list=(cond==='New')?(g.New||[]):(g.Used||[]);
      return { request:q, status:{statusCode:200},
        body:{ payload:{ ASIN:a, ItemCondition:cond,
          Summary:{ NumberOfOffers:[{ condition:cond.toLowerCase(),
            OfferCount:list.length }], TotalOfferCount:list.length },
          Offers:list.map((x)=>({ SubCondition:(cond==='New'?'new':'good'),
            ListingPrice:{ Amount:x.b, CurrencyCode:'JPY' },
            Shipping:{ Amount:x.s||0, CurrencyCode:'JPY' } })) } } };
    }) }),{status:200});
  }
  if(/listings\/2021-08-01\/items/.test(url)){
    calls.push({url:url,method:o.method,body:String(o.body||''),label:'listings'});
    const sku=decodeURIComponent((url.split('/items/')[1]||'').split('?')[0]
      .split('/')[1]||'');
    const v=reply[sku];
    if(typeof v==='number')return new Response(JSON.stringify({errors:[
      {code:'InvalidInput',message:'bad'}]}),{status:v});
    return new Response(JSON.stringify(v||{status:'ACCEPTED',submissionId:'s1',
      issues:[]}),{status:200});
  }
  if(/catalog\/2022-04-01\/items/.test(url)){
    const ids=new URL(url).searchParams.get('identifiers').split(',');
    return new Response(JSON.stringify({ items:ids.map((a)=>({ asin:a,
      productTypes:[{ productType:'TOYS_AND_GAMES', marketplaceId:'A1VC38T7YXB528' }],
      summaries:[{ itemName:'薔薇と椿' }] })) }),{status:200});
  }
  if(/definitions\/2020-09-01\/productTypes/.test(url))
    return new Response(JSON.stringify({ productType:'TOYS_AND_GAMES',
      schema:{ link:{ resource:'https://d1.cloudfront.net/schema/T.json' } }
    }),{status:200});
  if(/cloudfront\.net\/schema/.test(url))
    return new Response(JSON.stringify({ required:['merchant_suggested_asin',
      'condition_type'],
      properties:{ merchant_suggested_asin:{}, condition_type:{},
        fulfillment_availability:{}, purchasable_offer:{}, condition_note:{},
        batteries_required:{}, batteries_included:{},
        supplier_declared_dg_hz_regulation:{} } }),{status:200});
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
const post=async(path,body,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
let atSeq=0;
const put=async(o)=>await post('/settings',
  {at:new Date(Date.now()+(++atSeq)*1000).toISOString(),settings:o});
await put({ baseProfit:'1000', amzFeeRate:'15' });
/* 古い控え（¥5,800）。この値がそのまま使われていたのが【O】の不具合。 */
env.DB._db.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,low,new_n,price_at,checked_at,
     fee_ref,fee_fba,fee_base)
   VALUES (?,?,'薔薇と椿',5800,5800,1,'2026-10-20T00:00:00Z','2026-10-20T00:00:00Z',
     870,500,5800)`).run(JAN,ASIN);
const row=(x)=>Object.assign({ sku:SKU, asin:ASIN, jan:JAN, sha:'M200',
  price:5800, cost_src:3476, title:'薔薇と椿' },x||{});

console.log('=== 値段の決め方（mwPickPrice）===');
let g=W.mwPickPrice(ASIN,{ [ASIN+'|new']:{ low:9800, total:3 } },120);
console.log('   '+JSON.stringify(g));
ok(g.src==='new'&&g.price===9800,'★★★新品の出品者がいれば新品の最安値');
ok(/新品の最安値 ¥9,800/.test(g.why),'★★根拠を書く');
/* 【O】そのもの：新品0人・中古 ¥7,168＋送料 ¥265。 */
g=W.mwPickPrice(ASIN,{ [ASIN+'|used']:{ low:7433, lowB:7168, lowS:265, total:2 } },120);
console.log('   '+JSON.stringify(g));
ok(g.src==='used','★★★新品が0人なら中古から決める');
ok(g.price===8920,'★★★中古の最安値 ¥7,433 × 120% ＝ ¥8,920');
ok(/新品の出品者なし：中古の最安値 ¥7,433（¥7,168＋送料 ¥265）× 120% ＝ ¥8,920/
   .test(g.why),'★★★根拠をそのまま出せる形で返す');
g=W.mwPickPrice(ASIN,{},120);
ok(g.src===''&&g.price===0&&/手で決めて/.test(g.why),
   '★★★新品も中古もいなければ値段を決めない');
/* 新品がいれば中古は見ない。 */
g=W.mwPickPrice(ASIN,{ [ASIN+'|new']:{ low:9800, total:1 },
  [ASIN+'|used']:{ low:3000, total:5 } },120);
ok(g.src==='new'&&g.price===9800,'★新品がいれば中古は見ない');

console.log('\n=== 掛け率は⚙で変えられる（既定120%）===');
ok(W.MW_USED_PCT===120&&W.mwUsedPct({})===120,'★★既定は120%');
ok(W.mwUsedPct({ mwUsedPct:'150' })===150,'★★⚙で変えられる');
ok(W.mwUsedPct({ mwUsedPct:'50' })===100&&W.mwUsedPct({ mwUsedPct:'999' })===300,
   '★行き過ぎた値は丸める（100〜300%）');
g=W.mwPickPrice(ASIN,{ [ASIN+'|used']:{ low:7433, total:1 } },150);
ok(g.price===11150,'★★掛け率を変えると売値も変わる（7,433×150%）');

console.log('\n=== 送る直前に取り直す（新品の出品者0人）===');
await put({ baseProfit:'1000', amzFeeRate:'15' });
offers[ASIN]={ New:[], Used:[{ b:7168, s:265 }, { b:8000, s:0 }] };
calls=[];
let r=await post('/mw/put',{ check:1, rows:[row()] });
let pl=(r.body.plan||[])[0]||{};
console.log('   '+JSON.stringify({price:pl.price,src:pl.price_src,why:pl.price_why,
  need:pl.need,ng:pl.floor_ng,cost:pl.cost,fee:pl.fee}));
ok(calls.some((c)=>c.label==='offers'),'★★★下調べでも値段を取り直す');
ok(pl.price===8920,'★★★古い控え（¥5,800）ではなく、取り直した値段で出す');
ok(pl.price_src==='used'&&pl.new_n===0,'★★新品が0人だったと返す');
ok(pl.used_low===7433&&pl.used_b===7168&&pl.used_s===265,
   '★★中古の最安値と内訳（本体＋送料）を返す');
ok(pl.used_pct===120,'★掛け率も返す');
ok(/新品の出品者なし：中古の最安値 ¥7,433（¥7,168＋送料 ¥265）× 120% ＝ ¥8,920/
   .test(pl.price_why),'★★★確認の画面に出す根拠を返す');
ok(!!pl.price_at_jst,'★★値段を取った日時も返す');
/* 控えも新しくなる（一覧の「販売価格」と日時）。 */
let amz=await env.DB.prepare(
  `SELECT price,low,new_n,used_low,used_n,price_at,basis FROM mw_amz WHERE jan=?1`)
  .bind(JAN).first();
console.log('   控え: '+JSON.stringify(amz));
ok(amz.price===8920&&amz.used_low===7433&&Number(amz.new_n)===0,
   '★★★取り直した値段を控えにも書く');
ok(String(amz.price_at)>'2026-11-01','★★値段を取った日時も新しくなる');
ok(amz.basis==='中古から','★どちらから決めたかを控える');

console.log('\n=== 「仕入原価＋手数料＋下限利益」の見張り ===');
/* 仕入原価 3,476・下限利益 1,000・販売手数料15%（＋消費税10%）・FBA 500。
   必要な売値 = (3476+500+1000) / (1 - 0.15×1.1) = 4976/0.835 ≒ 5,959 */
ok(W.mwNeedPrice(3476,500,0.15,1000)===5960,
   '★★★下限利益が残る最低の売値を出す');
ok(pl.need===5960&&pl.floor_ng===false,
   '★★★¥8,920 はこれを上回るので警告しない');
/* 中古が安い商品だと下回る。 */
offers[ASIN]={ New:[], Used:[{ b:3000, s:0 }] };
r=await post('/mw/put',{ check:1, rows:[row()] });
pl=(r.body.plan||[])[0]||{};
console.log('   '+JSON.stringify({price:pl.price,need:pl.need,ng:pl.floor_ng,
  profit:pl.profit_at}));
ok(pl.price===3600&&pl.floor_ng===true,
   '★★★下回る行は floor_ng で知らせる（画面で赤く出す）');
ok(pl.profit_at<1000,'★★その売値での利益も返す');
ok(W.mwFeeAt({ fee_ref:870, fee_fba:500, fee_base:5800 },{},8920).real===true,
   '★手数料は実額（率に直して使う）');
ok(W.mwFeeAt(null,{ amzFeeRate:'15' },10000).fee===1650,
   '★★取れていなければ⚙の率（15%＋消費税10%）で出す');

console.log('\n=== 新品の出品者がいれば今までどおり ===');
offers[ASIN]={ New:[{ b:9500, s:300 }], Used:[{ b:3000, s:0 }] };
calls=[];
r=await post('/mw/put',{ rows:[row()] });
const sent=calls.filter((c)=>c.label==='listings')[0]||{};
console.log('   '+JSON.stringify({ok_n:r.body.ok_n})+' '+String(sent.body).slice(0,120));
ok(r.body.ok_n===1,'★通る');
ok(/9800/.test(String(sent.body)),
   '★★★新品の最安値（9,500＋送料300＝9,800）で送る');
let log=await env.DB.prepare(
  `SELECT price,kind,price_src,price_why FROM mw_reg_log ORDER BY id DESC LIMIT 1`)
  .first();
console.log('   記録: '+JSON.stringify(log));
ok(log.price===9800&&log.kind==='put','★★記録にも取り直した値段が残る');
ok(log.price_src==='new'&&/新品の最安値/.test(log.price_why||''),
   '★★★値段の出どころと根拠も記録に残す');

console.log('\n=== 取り直せなかったら登録しない ===');
offersFail=true;
calls=[];
r=await post('/mw/put',{ rows:[row()] });
console.log('   '+JSON.stringify(r.body.rows[0]));
ok(r.body.sent===0&&r.body.ng===1,'★★★1件も送らない');
ok(calls.every((c)=>c.label!=='listings'),'★★★Amazon に書き込まない');
ok(/取り直せませんでした/.test(r.body.rows[0].err||''),'★★★理由を返す');
offersFail=false;

console.log('\n=== 新品も中古もいないとき ===');
offers[ASIN]={ New:[], Used:[] };
calls=[];
r=await post('/mw/put',{ rows:[row()] });
console.log('   '+JSON.stringify(r.body.rows[0]));
ok(r.body.sent===0&&r.body.ng===1,'★★★登録しない');
ok(/新品も中古も出品がありません/.test(r.body.rows[0].err||''),'★★理由を返す');
r=await post('/mw/put',{ check:1, rows:[row()] });
pl=(r.body.plan||[])[0]||{};
ok(pl.need_price===true&&/手で決めて/.test(pl.price_why),
   '★★★確認の画面に「値段を手で決めてください」と出せる');
/* 管理者は売値を入れて登録できる。 */
calls=[];
r=await post('/mw/put',{ rows:[row()], price:{ [SKU]:7500 } });
const s2=calls.filter((c)=>c.label==='listings')[0]||{};
console.log('   '+JSON.stringify({ok_n:r.body.ok_n})+' '+String(s2.body).slice(0,120));
ok(r.body.ok_n===1&&/7500/.test(String(s2.body)),
   '★★★管理者は売値を入れて登録できる');
log=await env.DB.prepare(
  `SELECT price,price_src FROM mw_reg_log ORDER BY id DESC LIMIT 1`).first();
ok(log.price===7500&&log.price_src==='hand','★★手で決めたと記録に残る');
/* 新品がいる行では、手で入れた売値は使わない（決め方は2のとおり）。 */
offers[ASIN]={ New:[{ b:9800, s:0 }], Used:[] };
calls=[];
r=await post('/mw/put',{ rows:[row()], price:{ [SKU]:100 } });
const s3=calls.filter((c)=>c.label==='listings')[0]||{};
ok(/9800/.test(String(s3.body))&&!/\b100\b/.test(String(s3.body)),
   '★★★新品がいる行では手入力より取り直した値段が勝つ');

console.log('\n=== 登録済みの SKU の売値を直す（patchListingsItem）===');
offers[ASIN]={ New:[], Used:[{ b:7168, s:265 }] };
calls=[];
r=await post('/mw/price',{ rows:[{ sku:SKU }] });
const pt=calls.filter((c)=>c.label==='listings')[0]||{};
console.log('   '+JSON.stringify({ok_n:r.body.ok_n,row:r.body.rows[0]}));
ok(r.body.ok_n===1,'★★★直せる');
ok(pt.method==='PATCH','★★★PATCH で送る（patchListingsItem）');
ok(pt.url.indexOf('/listings/2021-08-01/items/A1SELLER9999/')>=0
   &&pt.url.indexOf(encodeURIComponent(SKU))>=0,
   '★★出品者トークンと SKU をパスに入れる');
let pb=JSON.parse(String(pt.body||'{}'));
console.log('   '+JSON.stringify(pb));
ok((pb.patches||[]).length===1&&pb.patches[0].path==='/attributes/purchasable_offer',
   '★★★送るのは売値だけ（商品情報も数量も触らない）');
ok(pb.patches[0].value[0].our_price[0].schedule[0].value_with_tax===8920,
   '★★★取り直した値段（中古×120%）を入れる');
ok(r.body.rows[0].price===8920&&r.body.rows[0].price_src==='used'
   &&/中古の最安値/.test(r.body.rows[0].price_why||''),'★★根拠も返す');
ok(r.body.rows[0].need===5960&&r.body.rows[0].floor_ng===false,
   '★下限の見張りも同じ');
log=await env.DB.prepare(
  `SELECT sku,price,kind,price_src FROM mw_reg_log ORDER BY id DESC LIMIT 1`).first();
ok(log.kind==='price'&&log.price===8920,'★★★記録に「売値直し」として残る');
/* 売値を指定もできる。 */
calls=[];
r=await post('/mw/price',{ rows:[{ sku:SKU, price:9000 }] });
pb=JSON.parse(String((calls.filter((c)=>c.label==='listings')[0]||{}).body||'{}'));
ok(pb.patches[0].value[0].our_price[0].schedule[0].value_with_tax===9000,
   '★★売値を入れればその値にする');
ok(calls.every((c)=>c.label!=='offers'),'★その場合は取り直さない');
ok(r.body.rows[0].price_src==='hand','★手で決めたと返す');

console.log('\n=== 売値を直すときの歯止め ===');
r=await post('/mw/price',{ rows:[{ sku:'こわれたSKU' }] });
ok(r.body.ng===1&&/SKU の形/.test(r.body.rows[0].err),'★形が違えば断る');
r=await post('/mw/price',{ rows:[{ sku:'hobby-20261029-N-B0OTHER001-3476' }] });
console.log('   '+JSON.stringify(r.body.rows[0]));
ok(r.body.ng===1&&/mwgame／mwhobby/.test(r.body.rows[0].err),
   '★★★pj が登録した mw… の SKU だけ直せる');
calls=[];
r=await post('/mw/price',{ rows:[{ sku:SKU, price:9000 }] },'staff-key-123');
console.log('   '+JSON.stringify({ok:r.body.ok,why:r.body.why}));
ok(r.body.sent===0&&/管理者/.test(r.body.why||''),
   '★★★作業者のキーでは直せない（Amazon に書き込むので）');
ok(calls.every((c)=>c.label!=='listings'),'★★1回も呼ばない');

console.log('\n=== 許可表（ALLOWED）===');
let bad='';
try{ W.assertReadOnly('https://sellingpartnerapi-fe.amazon.com/listings/'
  +'2021-08-01/items/A1SELLER9999/x?y=1','PATCH',{},false); }
catch(e){ bad=e.message; }
ok(/blocked_by_readonly_guard/.test(bad),
   '★★★PATCH は write:true を明示しないと通らない');
bad='';
try{ W.assertReadOnly('https://sellingpartnerapi-fe.amazon.com/listings/'
  +'2021-08-01/items/A1SELLER9999/x?y=1','PATCH',{},true); }
catch(e){ bad=e.message; }
ok(bad==='','★write:true なら通る');
bad='';
try{ W.assertReadOnly('https://sellingpartnerapi-fe.amazon.com/listings/'
  +'2021-08-01/items/A1SELLER9999/x?y=1','DELETE',{},true); }
catch(e){ bad=e.message; }
ok(/blocked_by_readonly_guard/.test(bad),'★★DELETE は通らない（消さない）');

T.done();
