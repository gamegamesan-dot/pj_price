/* Worker：仕入れ済み（MW で売り切れ・CSV から消えた商品）7.105
   MW で買った商品が届いたとき、その商品が MW で売り切れて stocks_3.csv から
   消えていると、一覧に出ず Amazon に登録できなかった。
   ・印を付けた時点の中身（JAN・ASIN・名前・社・機種・新中・卸値・数・日・写真）を
     mw_buy 側に控える
   ・CSV から消えても /mw/buy は返す（gone=1）。卸値は**仕入れ時の値**
   ・すでに印が付いている行は、いまの CSV・直近のデータから埋める
   ・POST /mw/buy/refresh … その1件だけ最安値・可否・手数料を取り直す
   ・POST /mw/buy/check … 同じ ASIN で mw から始まる SKU が Amazon にあれば
     登録済みにする（pj から＝pj／せどりすと等＝other）
   ・「登録済みにする」「この区分から外す」も /mw/buy で受ける */
import { harness, loadWorker, makeEnv, post, get, asJson } from './lib.mjs';
const T=harness('Worker：仕入れ済み（CSVから消えた商品）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwbought');
const env=makeEnv({ SP_SELLER_ID:'A1SELLER', STAFF_KEY:'staff-key-123', LWA_CLIENT_ID:'ci',
  LWA_CLIENT_SECRET:'cs', LWA_REFRESH_TOKEN:'rt' });

let calls=[], listings={}, offers={}, fees={}, rst={};
globalThis.fetch=async(u,i)=>{
  const url=String(u); calls.push(url);
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  if(/\/listings\/2021-08-01\/items\//.test(url)){
    const a=new URL(url).searchParams.get('identifiers')||'';
    return new Response(JSON.stringify({items:(listings[a]||[]).map((sku)=>({sku}))}),
      {status:200});
  }
  if(/restrictions/.test(url)){
    const a=new URL(url).searchParams.get('asin');
    return new Response(JSON.stringify(rst[a]||{restrictions:[]}),{status:200});
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
    return new Response(JSON.stringify(b.map((q)=>Object.assign(
      { FeesEstimateIdentifier:{IdType:'ASIN',IdValue:q.IdValue} },
      fees[q.IdValue]||{ Status:'ClientError',
        Error:{Code:'DataNotFound',Message:'no fee'} }))),{status:200});
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
const FEE={ Status:'Success', FeesEstimate:{
  TotalFeesEstimate:{Amount:900},
  FeeDetailList:[{FeeType:'ReferralFee',FinalFee:{Amount:600}},
                 {FeeType:'FBAFees',FinalFee:{Amount:230}},
                 {FeeType:'ReferralFeeTax',FinalFee:{Amount:70}}]} };
const row=(jan,x)=>Object.assign({jan:jan,sha:'M200',idx:0,kishu:'NS2',
  name:'ヨッシークラフトワールド',list_price:6578,release:'2025/01/01',cond:'新品',
  wholesale:4000,stock:3,note:'',ship_text:'即日出荷',ship_days:1},x||{});
const put=async(path,body,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
const buy=async()=>asJson(await worker.fetch(get('/mw/buy'),env));
const JAN='4902370556789';

console.log('=== 印を付けた時点の中身を控える ===');
/* 欠品の判定には安全網がある（取り込みが急に減ったら欠品にしない）ので、
   本物に近い件数（10行）を入れておく。 */
const OTHERS=[];
for(let i=0;i<9;i++)OTHERS.push(row('490237055900'+i,{name:'ほかの商品'+i}));
await put('/mw/stock',{at:'2026-11-06T00:00:00Z',part:1,parts:1,
  rows:[row(JAN)].concat(OTHERS)});
await env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,basis,checked_at,created_at)
   VALUES (?1,'B07MLZ2JKF','ヨッシー クラフトワールド',5480,'カート',?2,?2)`)
  .bind(JAN,new Date().toISOString()).run();
await env.DB.prepare(
  `INSERT INTO mw_img (jan,pos,mw_id,src,url,w,h,long_px,bytes,ct,ok,err,at,created_at)
   VALUES (?1,0,'10958868','https://matchingworld.asia/products/1/2/10958868.jpg',
     NULL,600,600,600,1000,'image/jpeg',1,'',?2,?2)`)
  .bind(JAN,new Date().toISOString()).run();
await put('/mw/buy',{ jan:JAN, qty:2 });
let b=await env.DB.prepare('SELECT * FROM mw_buy WHERE jan=?1').bind(JAN).first();
console.log('   '+JSON.stringify({asin:b.asin,name:String(b.name||'').slice(0,12),
  sha:b.sha,kishu:b.kishu,cond:b.cond,wholesale:b.wholesale,pics:b.pics,qty:b.qty}));
ok(b.asin==='B07MLZ2JKF','★★★ASIN を控える');
ok(/ヨッシー/.test(String(b.name||'')),'★★商品名を控える');
ok(b.sha==='M200'&&b.kishu==='NS2'&&b.cond==='新品','★★社・機種・新中を控える');
ok(b.wholesale===4000,'★★★卸値（税抜）を控える');
ok(b.qty===2,'★仕入れ数を控える');
ok(!!b.at&&!!b.snap_at,'★印を付けた日と控えた時刻');
ok(b.pics===1,'★★写真の有無（枚数）を控える');

console.log('\n=== MW の CSV から消えても残る（卸値は仕入れ時の値）===');
/* 次の取り込みで JAN が消える（売り切れ）。ほかの行だけ送る。 */
await put('/mw/stock',{at:'2026-11-07T00:00:00Z',part:1,parts:1,rows:OTHERS});
let st=await env.DB.prepare('SELECT gone_at FROM mw_stock WHERE jan=?1').bind(JAN).first();
ok(!!st.gone_at,'★CSV から消えた印（gone_at）が付く');
let r=await buy();
let x=(r.body.rows||[])[0];
console.log('   '+JSON.stringify({n:r.body.n,gone:r.body.gone,live:r.body.live,
  w:x.wholesale,mw:x.mw_wholesale,g:x.gone}));
ok(r.body.n===1,'★★★一覧から消えない');
ok(r.body.gone===1&&r.body.live===0,'★★★仕入れ済みの件数を返す（区分を分けられる）');
ok(Number(x.gone)===1,'★★行ごとに「CSV から消えた」が分かる（gone='+x.gone+'）');
ok(x.wholesale===4000,'★★★卸値は仕入れた時点の値');
ok(x.asin==='B07MLZ2JKF'&&/ヨッシー/.test(String(x.mw_name||'')),
   '★★ASIN と商品名も返る（CSV が無くても登録できる）');
ok(x.pics===1,'★写真の枚数も返る');

console.log('\n=== CSV に戻ってきたら、いまの卸値も分かる（印と卸値は仕入れ済みを優先）===');
await put('/mw/stock',{at:'2026-11-08T00:00:00Z',part:1,parts:1,
  rows:[row(JAN,{wholesale:4500,stock:1})].concat(OTHERS)});
r=await buy(); x=(r.body.rows||[])[0];
ok(Number(x.gone)===0&&r.body.live===1,'★★CSV に戻れば「これから仕入れる」に戻る');
ok(x.wholesale===4000,'★★★卸値は仕入れ時の 4000円のまま（優先）');
ok(x.mw_wholesale===4500,'★★いまの MW の卸値（4500円）も分かる');

console.log('\n=== すでに印が付いている行を埋める（v229 以前の行）===');
const OLD='4902370551111';
await put('/mw/stock',{at:'2026-11-09T00:00:00Z',part:1,parts:1,
  rows:[row(JAN,{wholesale:4500,stock:1}),
        row(OLD,{name:'古い印の商品',wholesale:3000})].concat(OTHERS)});
await env.DB.prepare(
  `INSERT INTO mw_buy (jan,qty,by_role,at,created_at) VALUES (?1,1,'admin',?2,?2)`)
  .bind(OLD,new Date().toISOString()).run();
await env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,checked_at,created_at)
   VALUES (?1,'B0OLD00001','古い印の商品',?2,?2)`)
  .bind(OLD,new Date().toISOString()).run();
r=await buy();
let o=(r.body.rows||[]).filter((y)=>y.jan===OLD)[0];
console.log('   '+JSON.stringify({asin:o.asin,w:o.wholesale,sha:o.sha}));
ok(o.asin==='B0OLD00001'&&o.wholesale===3000&&o.sha==='M200',
   '★★★読んだときに、いまの CSV・直近のデータで控えを埋める');
let ob=await env.DB.prepare('SELECT snap_at FROM mw_buy WHERE jan=?1').bind(OLD).first();
ok(!!ob.snap_at,'★控えた時刻が入る（次からは埋め直さない）');

console.log('\n=== 1件だけ取り直す（最安値・可否・手数料）===');
offers['B07MLZ2JKF']=mkOff('B07MLZ2JKF',5980);
fees['B07MLZ2JKF']=FEE;
calls=[];
r=await put('/mw/buy/refresh',{ jan:JAN });
console.log('   '+JSON.stringify({ok:r.body.ok,asin:r.body.asin,price:r.body.price,
  rst:r.body.rst,fee:r.body.fee&&r.body.fee.total,reg:r.body.reg_state}));
ok(r.body.ok===true,'★取り直せる');
ok(r.body.price===5980&&r.body.basis==='カート','★★★最安値（カート）を取り直す');
ok(r.body.rst==='ok','★★出品の可否も調べる');
ok(r.body.fee&&r.body.fee.ok&&r.body.fee.total===900,'★★★手数料も取り直す');
let a=await env.DB.prepare('SELECT price,fee_total FROM mw_amz WHERE jan=?1')
  .bind(JAN).first();
ok(a.price===5980&&a.fee_total===900,'★★D1 にも控える（一覧にも出る）');
ok(calls.filter((u)=>/itemOffers/.test(u)).length===1
  &&calls.filter((u)=>/feesEstimate/.test(u)).length===1
  &&calls.filter((u)=>/restrictions/.test(u)).length===1,
  '★★呼び出しは1件ぶんだけ');

console.log('\n=== 二重に登録しない（pj 以外で先に登録した）===');
listings['B07MLZ2JKF']=['mwgame-20261106-N-B07MLZ2JKF-4400'];
r=await put('/mw/buy/check',{ jans:[JAN] });
console.log('   '+JSON.stringify({done:r.body.done,found:r.body.found,
  rows:r.body.rows}));
ok(r.body.found===1,'★★★同じ ASIN の mw から始まる SKU を見つける');
b=await env.DB.prepare('SELECT reg_state,reg_sku,reg_at FROM mw_buy WHERE jan=?1')
  .bind(JAN).first();
ok(b.reg_state==='other','★★★pj が送っていない SKU は「pj 以外」');
ok(/^mwgame-/.test(String(b.reg_sku||''))&&!!b.reg_at,'★SKU と時刻を控える');
/* pj が送った SKU なら 'pj' になる。 */
await env.DB.prepare(
  `INSERT INTO mw_reg_log (at,sku,asin,jan,price,ok,created_at)
   VALUES (?3,?1,?4,?2,5980,1,?3)`)
  .bind('mwgame-20261106-N-B07MLZ2JKF-4400',JAN,new Date().toISOString(),
        'B07MLZ2JKF').run();
await put('/mw/buy',{ items:[{ jan:JAN, reg:'' }] });
r=await put('/mw/buy/check',{ jans:[JAN] });
b=await env.DB.prepare('SELECT reg_state FROM mw_buy WHERE jan=?1').bind(JAN).first();
ok(b.reg_state==='pj','★★pj が送った SKU なら「pj から」');
/* mw で始まらない SKU（ほかの仕入れ元）は登録済みにしない。 */
listings['B0OLD00001']=['game-20261101-N-B0OLD00001-2000'];
r=await put('/mw/buy/check',{ jans:[OLD] });
b=await env.DB.prepare('SELECT reg_state FROM mw_buy WHERE jan=?1').bind(OLD).first();
ok(String(b.reg_state||'')==='','★★mw で始まらない SKU は数えない');

console.log('\n=== 手で「登録済みにする」「この区分から外す」===');
await put('/mw/buy',{ items:[{ jan:OLD, reg:'other' }] });
b=await env.DB.prepare('SELECT reg_state,reg_at,qty FROM mw_buy WHERE jan=?1')
  .bind(OLD).first();
ok(b.reg_state==='other'&&!!b.reg_at,'★★手で登録済みにできる');
ok(b.qty===1,'★★数量（印）はそのまま＝一覧から消えない');
await put('/mw/buy',{ items:[{ jan:OLD, reg:'' }] });
b=await env.DB.prepare('SELECT reg_state,reg_at FROM mw_buy WHERE jan=?1')
  .bind(OLD).first();
ok(String(b.reg_state||'')===''&&!b.reg_at,'★未登録に戻せる');
await put('/mw/buy',{ items:[{ jan:OLD, off:1 }] });
b=await env.DB.prepare('SELECT jan FROM mw_buy WHERE jan=?1').bind(OLD).first();
ok(!b,'★★★この区分から外すと、印ごと消える');

console.log('\n=== 作業者のキーでは取り直し・確認はできない ===');
r=await put('/mw/buy/refresh',{ jan:JAN },'staff-key-123');
ok(r.status===403,'★取り直しは管理者だけ');
r=await put('/mw/buy/check',{ jans:[JAN] },'staff-key-123');
ok(r.status===403,'★登録済みの確認は管理者だけ');
r=await put('/mw/buy',{ jan:JAN, qty:1 },'staff-key-123');
ok(r.status===200,'★印そのものは作業者でも付けられる（今までどおり）');

T.done();
