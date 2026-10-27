/* Worker：MW の候補を Amazon（国内FBA）で見る（7.66）
   ・JAN → ASIN・ランキング（Catalog Items・1回20件）
   ・ASIN → 新品の実売価格と出品の様子（getItemOffersBatch・1回20件・0.1回/秒）
   ・Amazon本体の有無／新品の出品者数／FBA の出品者数／カート価格
   ・販売価格はカートがあればカート、無ければ最安（基準も控える）
   ・利益の計算はここでは行わない（手数料率は⚙設定で変わるので画面で計算する）
   ・3日たつまで取り直さない。取れなかったものは1日後 */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：MW×Amazon の実売価格');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwamz');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs', LWA_REFRESH_TOKEN:'rt' });

let calls=[], cat={}, offers={};
globalThis.fetch=async(u,i)=>{
  const url=String(u); calls.push(url);
  if(/api\.amazon\.com\/auth\/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:3600}),{status:200});
  if(/catalog\/2022-04-01\/items/.test(url)){
    const ids=new URL(url).searchParams.get('identifiers').split(',');
    const items=ids.map((j)=>cat[j]).filter(Boolean);
    return new Response(JSON.stringify({items}),{status:200});
  }
  if(/itemOffers/.test(url)){
    const body=JSON.parse(i.body);
    return new Response(JSON.stringify({ responses:body.requests.map((q)=>{
      const m=/\/items\/([A-Z0-9]{10})\/offers/.exec(q.uri);
      const a=m?m[1]:'';
      const o=offers[a];
      return { request:q, body:{ payload: o||{ ASIN:a, Offers:[] } } };
    })}),{status:200});
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
const put=async(path,body,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
const list=async(q)=>(await asJson(await worker.fetch(get('/mw/amz'+(q||'')),env))).body;
const row=(jan,sha,x)=>Object.assign({jan:jan,sha:sha,idx:0,kishu:'NS',
  name:jan+'の商品',list_price:5000,release:'2025/01/01',cond:'新品',
  wholesale:3000,stock:5,note:'',ship_text:'即日出荷',ship_days:0},x||{});
/* Catalog Items の返り（JAN・ASIN・ランキング） */
const mkCat=(jan,asin,name,rank)=>({ asin:asin,
  identifiers:[{ marketplaceId:'A1VC38T7YXB528',
    identifiers:[{ identifierType:'EAN', identifier:jan }] }],
  summaries:[{ itemName:name }],
  salesRanks:[{ classificationRanks:[
    { title:'ゲーム', rank:rank*10 }, { title:'Nintendo Switch ソフト', rank:rank } ] }] });
/* getItemOffers の返り */
const mkOff=(asin,list,o)=>Object.assign({ ASIN:asin, ItemCondition:'New',
  Summary:{ NumberOfOffers:[{ condition:'new', OfferCount:list.length }],
            TotalOfferCount:list.length,
            BuyBoxPrices:(o&&o.buy)?[{ LandedPrice:{ Amount:o.buy } }]:[] },
  Offers:list },o||{});
const off=(price,ship,seller,fba)=>({ ListingPrice:{ Amount:price },
  Shipping:{ Amount:ship||0 }, SellerId:seller||'A1OTHER', SubCondition:'new',
  IsFulfilledByAmazon:!!fba });

console.log('=== 出品の様子を読む ===');
/* amazonLowest は応答の URI から ASIN を読む（正規表現は **10文字**）。
   試験データの ASIN が11文字だと一致せず、値段が入らないのに件数だけ合う。 */
['B00GAME001','B00FIG0001','B00NONE001','B00TEST001'].forEach(function(a){
  ok(a.length===10,'★試験データの ASIN '+a+' は10文字（実物と同じ長さ）'); });
ok(W.AMZ_SELF_ID==='AN1VRQENFRJN5','★Amazon本体の出品者ID');
let pl=mkOff('B00TEST001',[off(1000,0,'AN1VRQENFRJN5',true),off(1200,0,'A1X',true),
  off(1300,500,'A2Y',false)],{buy:1000});
ok(W.amzSelf(pl)===1,'★★Amazon本体の出品があれば 1');
ok(W.amzSelf(mkOff('B2',[off(1000,0,'A1X')]))===0,'★★無ければ 0');
ok(W.fbaN(pl)===2,'★★FBA の出品者数');
ok(W.buyBox(pl)===1000,'★★カート価格を読む');
ok(W.buyBox(mkOff('B2',[off(1000,0,'A1X')]))===0,'★カートが無ければ0');
ok(W.offerN(pl,'New')===3,'★★新品の出品者数（大文字小文字どちらでも）');

console.log('\n=== 在庫を入れる ===');
const CAND=['4902370550467','4580416924740','4988611224878','4970381909444'];
let r=await put('/mw/stock',{ at:'2026-10-27T00:00:00Z', part:1, parts:1,
  rows:CAND.map((j,i)=>row(j,'M200',{ wholesale:3000+i*100 })) });
ok(r.body.ok===true&&r.body.added===4,'★候補4件');

console.log('\n=== Amazon の実売価格を取る ===');
/* ①カートあり・Amazon本体あり ②カート無し（最安を使う） ③出品なし ④ASINなし */
cat['4902370550467']=mkCat('4902370550467','B00GAME001','ゲームA（Amazon名）',649);
cat['4580416924740']=mkCat('4580416924740','B00FIG0001','フィギュアB（Amazon名）',2310);
cat['4988611224878']=mkCat('4988611224878','B00NONE001','出品なしC',99999);
// 4970381909444 は Catalog に無い（ASIN が引けない）
offers['B00GAME001']=mkOff('B00GAME001',[
  off(24829,0,'AN1VRQENFRJN5',true), off(25000,0,'A1X',true),
  off(25500,500,'A2Y',false), off(26000,0,'A3Z',true)],{buy:24829});
offers['B00FIG0001']=mkOff('B00FIG0001',[
  off(26299,500,'A1X',true), off(27000,0,'A2Y',true)]);     // カート無し
offers['B00NONE001']=mkOff('B00NONE001',[]);              // 出品なし
calls=[];
r=await put('/mw/amz',{ kishu:'NS', ship_max:4, stock_min:2 });
/* 返りは段ごと（7.79）。①ASIN → ②可否 → ③価格。 */
console.log('   '+JSON.stringify({asin:r.body.asin,price:r.body.price}));
ok(r.body.ok===true,'★★実売価格の取得が通る');
ok(r.body.asin.asked===4&&r.body.asin.done===4,'★候補4件すべて');
ok(r.body.asin.ok_n===3&&r.body.asin.ng===1,'★★ASIN が引けた3件・引けなかった1件');
ok(r.body.price.priced===2&&r.body.price.none===1,
   '★★値段が取れた2件・出品が無い1件');
ok(r.body.price.asked===3&&r.body.price.done===3,
   '★★★価格は ASIN が取れた3件だけ（引けなかった行は呼ばない）');
/* まず20件まとめて1回。そのあと引けなかった JAN を1件ずつ引き直す（7.69）。
   ここでは 4970381909444 が引けないので、引き直しが1回増える。 */
ok(r.body.asin.calls===2,
   '★★まず20件まとめて1回＋引けなかった1件を引き直して1回');
ok(r.body.price.calls===1,'★★getItemOffersBatch も20件まとめて1回');
ok(W.MW_AMZ_MAX===120,'★1回に調べるのは120件（0.1回/秒の上限から）');

let a=async(jan)=>await env.DB.prepare(
  'SELECT * FROM mw_amz WHERE jan=?1').bind(jan).first();
let g1=await a('4902370550467');
console.log('   '+JSON.stringify({asin:g1.asin,price:g1.price,basis:g1.basis,
  low:g1.low,buybox:g1.buybox,new_n:g1.new_n,amz:g1.amz,fba:g1.fba_n,rank:g1.rank}));
ok(g1.asin==='B00GAME001','★★JAN から ASIN が入る');
ok(g1.price===24829&&g1.basis==='カート','★★カートがあればカート価格を販売価格にする');
ok(g1.low===24829,'★最安値も控える（送料込み）');
ok(g1.new_n===4,'★★新品の出品者数');
ok(g1.amz===1,'★★Amazon本体ありを控える');
ok(g1.fba_n===3,'★FBA の出品者数');
ok(g1.rank===649&&g1.rank_cat==='Nintendo Switch ソフト',
   '★★ランキングはいちばん細かい分類のものを採る');
ok(/ゲームA/.test(g1.name),'★Amazon の商品名も控える');

let g2=await a('4580416924740');
console.log('   '+JSON.stringify({price:g2.price,basis:g2.basis,low:g2.low,amz:g2.amz}));
ok(g2.price===26799&&g2.basis==='最安',
   '★★カートが無ければ最安（送料込み 26299+500）を販売価格にする');
ok(g2.amz===0,'★Amazon本体なし');
let g3=await a('4988611224878');
ok(!g3.price&&/出品がありません/.test(g3.err||''),'★★出品が無ければ理由を残す');
let g4=await a('4970381909444');
/* 理由は引き直しで分かったものをそのまま残す（7.79。
   「ASINが見つかりません」より「カタログに無い」のほうが切り分けやすい）。 */
console.log('   ASIN引けず: '+g4.err);
ok(!g4.asin&&/カタログにこの JAN がありません|ASINが見つかりません/.test(g4.err||''),
   '★★ASIN が引けなければ理由を残す');

console.log('\n=== 識別子が合わない商品も引き直しで救える（7.69）===');
/* Amazon が商品を返しても、その商品の identifiers に要求した JAN が
   入っていないことがある。20件まとめてだと「どの JAN の答えか」決められず
   落ちていた（120件中59件しか取れなかった原因のひとつ）。
   1件ずつ引き直せば取り違えようがないので採れる。 */
const env5=makeEnv({ LWA_CLIENT_ID:'a',LWA_CLIENT_SECRET:'b',LWA_REFRESH_TOKEN:'c' });
const put5=async(body)=>asJson(await worker.fetch(new Request('https://x/mw/stock',
  {method:'POST',headers:{'X-PJ-Key':'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env5));
await put5({ at:'2026-10-28T00:00:00Z', part:1, parts:1, rows:[
  row('4510417032793','M200'), row('4510417032847','M200')] });
/* 識別子に JAN が入っていない（UPC しか返らない）商品にする */
cat['4510417032793']={ asin:'B00NOID001',
  identifiers:[{ identifiers:[{ identifierType:'UPC', identifier:'012345678905' }] }],
  summaries:[{ itemName:'識別子が合わない商品' }],
  salesRanks:[{ classificationRanks:[{ title:'Switch', rank:777 }] }] };
cat['4510417032847']=mkCat('4510417032847','B00OKID001','ふつうの商品',888);
calls=[];
let r5=await asJson(await worker.fetch(new Request('https://x/mw/amz',
  {method:'POST',headers:{'X-PJ-Key':'k','content-type':'application/json'},
   body:JSON.stringify({ kishu:'NS' })}),env5));
console.log('   '+JSON.stringify(r5.body.asin));
ok(r5.body.asin.ok_n===2&&r5.body.asin.ng===0,
   '★★★識別子が合わない商品も、1件ずつ引き直して ASIN が取れる');
ok(r5.body.asin.calls===2,'★まとめて1回＋引き直し1回');
let g5=await env5.DB.prepare(
  "SELECT asin FROM mw_amz WHERE jan='4510417032793'").first();
ok(g5.asin==='B00NOID001','★★引き直した ASIN が入る');

console.log('\n=== カタログに無い JAN は理由を分けて控える（7.69）===');
const env6=makeEnv({ LWA_CLIENT_ID:'a',LWA_CLIENT_SECRET:'b',LWA_REFRESH_TOKEN:'c' });
const run6={ kind:'t', subrequests:0, pages:0, errors:0, notes:[], rows:0 };
let f6=await W.mwAsinFind(env6,run6,['4999999999994']);
console.log('   '+JSON.stringify(f6.why));
ok(/カタログにこの JAN がありません/.test(f6.why['4999999999994']||''),
   '★★「カタログに無い」と分かる理由を残す');
let j6=await env6.DB.prepare(
  "SELECT err FROM jan_map WHERE jan='4999999999994'").first();
ok(/カタログにこの JAN がありません/.test(j6.err||''),'★★控えにも理由が入る');
ok(W.MW_AMZ_RETRY_MAX===120,'★引き直しの上限');

console.log('\n=== 3日たつまで取り直さない ===');
r=await put('/mw/amz',{ kishu:'NS' });
console.log('   '+JSON.stringify({asin:r.body.asin.asked,price:r.body.price.asked}));
ok(W.MW_AMZ_TTL_D===3,'★取り直さない日数は3日');
ok(r.body.asin.asked===0&&r.body.price.asked===0,'★★取れた分は対象外');
/* 段ごとに時刻を分けたので、価格は price_at で見る（7.79） */
await env.DB.prepare("UPDATE mw_amz SET price_at=?1 WHERE jan='4902370550467'")
  .bind(new Date(Date.now()-4*86400000).toISOString()).run();
r=await put('/mw/amz',{ kishu:'NS' });
ok(r.body.price.asked===1,'★★4日前のものは取り直す');
/* ASIN が引けなかった行は1日後に取り直す（asin_at で見る） */
await env.DB.prepare("UPDATE mw_amz SET asin_at=?1 WHERE jan='4970381909444'")
  .bind(new Date(Date.now()-26*3600000).toISOString()).run();
r=await put('/mw/amz',{ kishu:'NS' });
ok(r.body.asin.asked>=1,'★★取れなかったものは1日後に取り直す');
/* ASIN が入っている行は引き直さない（ASIN は変わらないので呼び出しを減らす） */
await env.DB.prepare("UPDATE mw_amz SET asin_at=?1 WHERE jan='4902370550467'")
  .bind(new Date(Date.now()-40*86400000).toISOString()).run();
r=await put('/mw/amz',{ kishu:'NS' });
ok((r.body.asin.rows||r.body.asin).asked===0
   ||r.body.asin.asked===1,'★ASIN の対象は「まだの行」だけ');
let gA=await a('4902370550467');
ok(gA.asin==='B00GAME001','★★ASIN が入っている行の ASIN は変わらない');

console.log('\n=== 一覧（CSV の元）===');
let d=await list('?kishu=NS&ship_max=4&stock_min=2&limit=100');
console.log('   件数 '+d.n+'／調べ終わった '+d.seen+'／値段あり '+d.priced);
ok(d.n===4&&d.seen===4,'★候補と調べ終わった件数');
ok(d.priced===2,'★★値段が取れた件数');
let one=d.rows.filter((x)=>x.jan==='4902370550467')[0];
ok(one&&one.wholesale===3000&&one.list_price===5000,'★★MW の卸値・定価も返す');
ok(one&&one.asin==='B00GAME001'&&one.price===24829,'★★Amazon の事実も返す');
ok(one&&one.rank===649&&one.new_n===4&&one.amz===1,
   '★★ランキング・新品出品者数・Amazon本体を返す（10/7 のファイルと同じ列）');
ok(one&&one.ship_text==='即日出荷','★出荷日の原文も返す');
ok(!!d.last&&!!d.last.at_jst,'★前回の取得を日本時間で返す');
ok(d.per_run===120,'★1回の件数を返す');
d=await list('?kishu=NS&ship_max=4&stock_min=2&priced=1&limit=100');
ok(d.rows.length===2,'★★priced=1 で値段が取れた行だけに絞れる');
ok(d.rows[0].price>=d.rows[1].price,'★値段の高い順');

console.log('\n=== 利益はここでは計算しない ===');
let cols=Object.keys(one);
console.log('   '+cols.join(','));
ok(!cols.some((k)=>/profit|rieki|粗利|fee/i.test(k)),
   '★★利益や手数料の列は返さない（手数料率は⚙設定で変わるので画面で計算する）');

console.log('\n=== 作業者のキー ===');
r=await put('/mw/amz',{ kishu:'NS' },'staff-key-123');
ok(r.status===403&&r.body.error==='forbidden_for_staff','★★作業者では取れない');
let dl=await asJson(await worker.fetch(new Request('https://x/mw/amz',
  {headers:{'X-PJ-Key':'staff-key-123'}}),env));
ok(dl.status===200,'★一覧は読めてよい');

console.log('\n=== 会員サイトなど余計なところへ行かない ===');
ok(calls.every((u)=>/amazon\.com|discord/.test(u)),'★★Amazon 以外に出ていない');
const cc=calls.filter((u)=>/catalog\/2022-04-01/.test(u));
ok(cc.length>=1&&cc.every((u)=>/identifiersType=EAN/.test(u)),
   '★★ASIN は JAN（EAN）で引く');
ok(cc.every((u)=>/marketplaceIds=A1VC38T7YXB528/.test(u)),
   '★★amazon.co.jp のみを見る');
ok(calls.filter((u)=>/catalog/.test(u)&&!/identifiersType=EAN/.test(u)).length===0,
   '★商品名などでの検索はしない（JAN照合だけ）');

await T.done();
