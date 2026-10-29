/* Worker：「Amazonで調べる」1つのボタン（7.79）
   ・1回押すと ①JAN→ASIN（まだの行）→ ②出品の可否 → ③実売価格 の順に進む
   ・赤（出品できない）の行は③で価格を取らない。緑に変われば次に取る
   ・60秒で区切り、残りを段ごとに返す
   ・段ごとに時刻を分ける（asin_at / price_at）。1つの checked_at だと
     ①で ASIN を引いた行が③の対象から外れて値段が取れない */
import { harness, loadWorker, makeEnv, get, asJson } from './lib.mjs';
const T=harness('Worker：Amazonで調べる');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwscan');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs', LWA_REFRESH_TOKEN:'rt',
  SP_SELLER_ID:'A1SELLER9999' });

let calls=[], cat={}, offers={}, rst={};
globalThis.fetch=async(u,i)=>{
  const url=String(u); calls.push(url);
  if(/api\.amazon\.com\/auth\/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:3600}),{status:200});
  if(/catalog\/2022-04-01\/items/.test(url)){
    const ids=new URL(url).searchParams.get('identifiers').split(',');
    return new Response(JSON.stringify({items:ids.map((j)=>cat[j]).filter(Boolean)}),
      {status:200});
  }
  if(/listings\/2021-08-01\/restrictions/.test(url)){
    const a=new URL(url).searchParams.get('asin');
    const v=rst[a];
    if(typeof v==='number')return new Response(JSON.stringify({errors:[
      {code:'InvalidInput',message:'bad'}]}),{status:v});
    return new Response(JSON.stringify(v||{restrictions:[]}),{status:200});
  }
  if(/itemOffers/.test(url)){
    const body=JSON.parse(i.body);
    return new Response(JSON.stringify({ responses:body.requests.map((q)=>{
      const m=/\/items\/([A-Z0-9]{10})\/offers/.exec(q.uri);
      const a=m?m[1]:'';
      return { request:q, body:{ payload: offers[a]||{ ASIN:a, Offers:[] } } };
    })}),{status:200});
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
const post=async(body,key,e)=>asJson(await worker.fetch(new Request('https://x/mw/amz',
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),e||env));
const row=(jan,x)=>Object.assign({jan:jan,sha:'M200',idx:0,kishu:'NS',
  name:jan+'の商品',list_price:5000,release:'2025/01/01',cond:'新品',
  wholesale:3000,stock:9,note:'',ship_text:'即日出荷',ship_days:0},x||{});
const stock=async(rows,e)=>asJson(await worker.fetch(new Request('https://x/mw/stock',
  {method:'POST',headers:{'X-PJ-Key':'k','content-type':'application/json'},
   body:JSON.stringify({at:'2026-11-05T00:00:00Z',part:1,parts:1,rows:rows})}),e||env));
const mkCat=(jan,asin,name)=>({ asin:asin,
  identifiers:[{ identifiers:[{ identifierType:'EAN', identifier:jan }] }],
  summaries:[{ itemName:name }],
  salesRanks:[{ classificationRanks:[{ title:'ゲーム', rank:100 }] }] });
const mkOff=(asin,yen)=>({ ASIN:asin, Summary:{ TotalOfferCount:2,
  NumberOfOffers:[{condition:'new',OfferCount:2}],
  BuyBoxPrices:[{condition:'New',LandedPrice:{Amount:yen}}],
  LowestPrices:[{condition:'new',LandedPrice:{Amount:yen}}] },
  Offers:[{ SubCondition:'new', ListingPrice:{Amount:yen},
    Shipping:{Amount:0}, IsBuyBoxWinner:true, IsFulfilledByAmazon:true,
    SellerId:'A1X' }] });
const g=async(jan)=>await env.DB.prepare(
  'SELECT * FROM mw_amz WHERE jan=?1').bind(jan).first();

const JANS=['4902370550467','4580416924740','4988611224878'];
console.log('=== 在庫を入れる ===');
let r=await stock(JANS.map((j)=>row(j)));
ok(r.body.added===3,'★3件');
cat[JANS[0]]=mkCat(JANS[0],'B00SCAN001','緑の商品');
cat[JANS[1]]=mkCat(JANS[1],'B00SCAN002','赤の商品');
cat[JANS[2]]=mkCat(JANS[2],'B00SCAN003','黄の商品');
offers['B00SCAN001']=mkOff('B00SCAN001',9000);
offers['B00SCAN002']=mkOff('B00SCAN002',14000);
offers['B00SCAN003']=mkOff('B00SCAN003',12000);
rst['B00SCAN001']={restrictions:[]};                       // 緑
rst['B00SCAN002']={restrictions:[{reasons:[{reasonCode:'NOT_ELIGIBLE',
  message:'出品できません'}]}]};                            // 赤
rst['B00SCAN003']={restrictions:[{reasons:[{reasonCode:'APPROVAL_REQUIRED',
  message:'承認が必要',links:[{resource:'https://x/apply'}]}]}]};   // 黄

console.log('\n=== 1回押すと ①②③ が順に進む ===');
calls=[];
r=await post({ kishu:'NS', stock_min:5 });
console.log('   ①'+JSON.stringify(r.body.asin));
console.log('   ②'+JSON.stringify({asked:r.body.rst.asked,done:r.body.rst.done,
  ok_n:r.body.rst.ok_n,approval:r.body.rst.approval,blocked:r.body.rst.blocked}));
console.log('   ③'+JSON.stringify(r.body.price));
ok(r.body.ok===true,'★★通る');
ok(!!r.body.asin&&!!r.body.rst&&!!r.body.price,'★★★段ごとに返す');
ok(r.body.asin.done===3&&r.body.asin.ok_n===3,'★★★①ASIN を3件引く');
ok(r.body.rst.done===3&&r.body.rst.ok_n===1&&r.body.rst.approval===1
   &&r.body.rst.blocked===1,'★★★②可否を緑・黄・赤に分ける');
/* 呼んだ順が ①→②→③ であること */
const seq=calls.filter((u)=>/catalog|restrictions|itemOffers/.test(u))
  .map((u)=>/catalog/.test(u)?'①':(/restrictions/.test(u)?'②':'③'));
console.log('   順番 '+seq.join(''));
ok(/^①+②+③+$/.test(seq.join('')),'★★★①ASIN → ②可否 → ③価格 の順に呼ぶ');

console.log('\n=== ③は赤の行を飛ばす ===');
ok(r.body.price.asked===2,'★★★価格の対象は赤を外した2件');
ok(r.body.price.skipped_red===1,'★★★飛ばした赤の件数を返す');
ok(r.body.price.priced===2,'★★値段を2件取る');
let gRed=await g(JANS[1]);
console.log('   赤の行: '+JSON.stringify({asin:gRed.asin,price:gRed.price,
  price_at:gRed.price_at}));
ok(gRed.asin==='B00SCAN002','★★赤の行も ASIN は入る');
ok(!gRed.price&&!gRed.price_at,'★★★赤の行は価格を取らない');
let gOk=await g(JANS[0]);
ok(gOk.price===9000&&gOk.basis==='カート','★★緑の行は価格が入る');
let gAp=await g(JANS[2]);
ok(gAp.price===12000,'★★★黄（許可が要る）の行は価格を取る');
/* 価格の呼び出しに赤の ASIN が入っていないこと */
const offBody=calls.filter((u)=>/itemOffers/.test(u)).length;
ok(offBody===1,'★価格は1回で足りる');

console.log('\n=== 同じ押しの中で、①で引いた行の価格まで取れる ===');
/* 段ごとに時刻を分けていないと、①が checked_at を today にして
   ③の対象から外れ、値段が一度も取れなくなる（7.79）。 */
ok(gOk.asin_at&&gOk.price_at,'★★★asin_at と price_at の両方が入る');
ok(r.body.price.done===2&&r.body.price.none===0,
   '★★★①で引いた行が、そのまま③で値段を取れている');

console.log('\n=== もう一度押しても同じ行は呼ばない ===');
calls=[];
r=await post({ kishu:'NS', stock_min:5 });
console.log('   '+JSON.stringify({asin:r.body.asin.asked,rst:r.body.rst.asked,
  price:r.body.price.asked,left:r.body.left}));
ok(r.body.asin.asked===0,'★★★ASIN が入っている行は引き直さない');
ok(r.body.rst.asked===0,'★★可否も取れた分は対象外');
ok(r.body.price.asked===0,'★★価格も取れた分は対象外');
ok(calls.filter((u)=>/catalog|restrictions|itemOffers/.test(u)).length===0,
   '★★★1回も呼ばない');
ok(r.body.left===0,'★残りは0');

console.log('\n=== 赤が緑に変わったら、次に押したとき価格を取る ===');
rst['B00SCAN002']={restrictions:[]};                 // 許可が下りた
await env.DB.prepare(
  "UPDATE mw_restrict SET checked_at=?1 WHERE asin='B00SCAN002'")
  .bind(new Date(Date.now()-8*86400000).toISOString()).run();
calls=[];
r=await post({ kishu:'NS', stock_min:5 });
console.log('   '+JSON.stringify({rst:r.body.rst.done,ok_n:r.body.rst.ok_n,
  price:r.body.price.asked,priced:r.body.price.priced,
  red:r.body.price.skipped_red}));
ok(r.body.rst.ok_n===1,'★★赤が緑に変わる（7日で調べ直す）');
ok(r.body.price.asked===1&&r.body.price.priced===1,
   '★★★緑に変わった行の価格を取る');
ok(r.body.price.skipped_red===0,'★飛ばす赤はもう無い');
gRed=await g(JANS[1]);
ok(gRed.price===14000,'★★★価格が入る');

console.log('\n=== 持ち時間を段ごとに分ける（7.82）===');
ok(W.MW_SCAN_BUDGET_MS===55000,'★★60秒の手前（55秒）で切る');
const SH=W.MW_SCAN_SHARE;
console.log('   '+JSON.stringify(SH));
ok(SH.asin===20000&&SH.rst===10000&&SH.price===25000,
   '★★★①20秒・②10秒・③25秒');
ok(SH.asin+SH.rst+SH.price===W.MW_SCAN_BUDGET_MS,
   '★★★3段の合計が持ち時間と同じ');
ok(W.MW_PRICE_CALL_MS===11000,'★価格は1回ぶん（約11秒）の余裕を見る');
/* 段ごとにかかった時間を返すこと（画面に出す） */
r=await post({ kishu:'NS', stock_min:5 });
console.log('   '+JSON.stringify({ms:r.body.ms,a:r.body.asin.ms,
  rr:r.body.rst.ms,p:r.body.price.ms,share:r.body.share_ms}));
ok(typeof r.body.asin.ms==='number'&&typeof r.body.rst.ms==='number'
   &&typeof r.body.price.ms==='number','★★★段ごとにかかった時間を返す');
ok(r.body.share_ms&&r.body.share_ms.price===25000,'★★持ち時間も返す（画面に出す）');
ok(typeof r.body.ms==='number','★合計の時間も返す');

console.log('\n=== ①が持ち時間を使い切っても②③に時間が残る ===');
/* ①の締め切りを過ぎた状態で③を呼んでも、③の締め切りは別なので動ける。
   締め切りは「開始からの積み上げ」なので、①の余りは次の段に繰り越される。 */
const envS=makeEnv({ LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs',
  LWA_REFRESH_TOKEN:'rt', SP_SELLER_ID:'A1SELLER9999' });
await stock(JANS.map((j)=>row(j)),envS);
for(let i=0;i<JANS.length;i++)
  await envS.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,checked_at,asin_at,created_at)
     VALUES (?1,?2,'x','x','x','x')`)
    .bind(JANS[i],'B00SCAN00'+(i+1)).run();
const runS={ kind:'t', subrequests:0, pages:0, errors:0, notes:[], rows:0 };
calls=[];
/* ③に1回ぶん（11秒）より少ない時間しか無ければ、**始めない** */
let sp=await W.mwScanPrice(envS,runS,{ kishu:'NS', stock_min:5 },Date.now()+5000);
console.log('   残り5秒: '+JSON.stringify({done:sp.done,stopped:sp.stopped}));
ok(sp.stopped==='time'&&sp.done===0,
   '★★★1回ぶんの時間が無ければ価格を始めない（60秒超えを防ぐ）');
ok(calls.filter((u)=>/itemOffers/.test(u)).length===0,'★★呼ばない');
/* 1回ぶんの時間があれば動く */
calls=[];
sp=await W.mwScanPrice(envS,runS,{ kishu:'NS', stock_min:5 },Date.now()+25000);
console.log('   残り25秒: '+JSON.stringify({done:sp.done,calls:sp.calls}));
ok(sp.done>0&&sp.calls===1,'★★★25秒あれば1回ぶん取る');

console.log('\n=== ①も自分の持ち時間で切り上げる ===');
/* 引き直しは1件ずつなので、時間が来たら残りを次回に回す */
const envC=makeEnv({ LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs',
  LWA_REFRESH_TOKEN:'rt', SP_SELLER_ID:'A1SELLER9999' });
const runC={ kind:'t', subrequests:0, pages:0, errors:0, notes:[], rows:0 };
calls=[];
let f=await W.mwAsinFind(envC,runC,['4999999999001','4999999999002'],Date.now()-1);
console.log('   '+JSON.stringify({cut:f.cut,why:Object.keys(f.why||{}).length}));
ok(f.cut===2,'★★★時間が無ければ1件も引かずに次回へ回す');
ok(calls.filter((u)=>/catalog/.test(u)).length===0,'★★カタログを呼ばない');
ok(runC.notes.some((x)=>/次回に回しました/.test(x)),'★記録に残す');
/* 締め切りを渡さなければ今までどおり最後まで引く */
calls=[];
f=await W.mwAsinFind(envC,runC,['4999999999003']);
ok(f.cut===0&&calls.filter((u)=>/catalog/.test(u)).length>0,
   '★★締め切りを渡さなければ今までどおり');
/* 期限が切れていれば、価格は1回も呼ばずに残りを返す */
const envT=makeEnv({ LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs',
  LWA_REFRESH_TOKEN:'rt', SP_SELLER_ID:'A1SELLER9999' });
await stock(JANS.map((j)=>row(j)),envT);
for(let i=0;i<JANS.length;i++)
  await envT.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,checked_at,asin_at,created_at)
     VALUES (?1,?2,'x','x','x','x')`)
    .bind(JANS[i],'B00SCAN00'+(i+1)).run();
const run0={ kind:'t', subrequests:0, pages:0, errors:0, notes:[], rows:0 };
calls=[];
let st=await W.mwScanPrice(envT,run0,{ kishu:'NS', stock_min:5 },Date.now()-1);
console.log('   '+JSON.stringify(st));
ok(st.stopped==='time','★★★時間が無ければ time で止まる');
ok(st.done===0&&st.left===st.asked,'★★★呼ばずに残りを返す');
ok(calls.filter((u)=>/itemOffers/.test(u)).length===0,'★★1回も呼ばない');
calls=[];
let sa=await W.mwScanAsin(envT,run0,{ kishu:'NS', stock_min:5 },Date.now()-1);
ok(calls.filter((u)=>/catalog/.test(u)).length===0,
   '★★ASIN の段も時間が無ければ呼ばない');

console.log('\n=== 可否が失敗しても ①③ は進む ===');
const env3=makeEnv({ LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs',
  LWA_REFRESH_TOKEN:'rt' });        // 出品者トークンなし
await stock([row('4510417032793')],env3);
cat['4510417032793']=mkCat('4510417032793','B00SCAN009','トークン無しの商品');
offers['B00SCAN009']=mkOff('B00SCAN009',7000);
calls=[];
r=await post({ kishu:'NS', stock_min:5 },'k',env3);
console.log('   '+JSON.stringify({asin:r.body.asin.ok_n,
  rstStop:r.body.rst.stopped,price:r.body.price.priced}));
ok(r.body.asin.ok_n===1,'★★★①は進む');
ok(r.body.rst.stopped==='no_seller_id','★★②は止まる');
ok(calls.filter((u)=>/restrictions/.test(u)).length===0,
   '★★可否は1回も呼ばない');
ok(r.body.price.priced===1,'★★★③も進む（可否が無い行は赤ではない）');

console.log('\n=== 記録と作業者のキー ===');
let last=await env.DB.prepare(
  'SELECT * FROM mw_amz_runs ORDER BY id DESC LIMIT 1').first();
console.log('   '+String(last.note).slice(0,90));
ok(/ASIN /.test(last.note)&&/可否 /.test(last.note)&&/価格 /.test(last.note),
   '★★記録に段ごとの件数を残す');
ok(/赤を飛ばした/.test(last.note),'★記録に飛ばした赤の件数も残す');
r=await post({ kishu:'NS' },'staff-key-123');
ok(r.status===403,'★★作業者では調べられない（今までと同じ）');

await T.done();
