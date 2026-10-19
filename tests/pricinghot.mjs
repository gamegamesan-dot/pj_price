/* Worker：3時間ごとの Amazon最安値（7.49）
   ・対象は再調達中の行と、フェイズBが見る行（FBAの販売可能が0・出品中）だけ
   ・手元在庫・無在庫・一点物・数量0・ItemIDなしは対象外
   ・最安値が古い行（まだ取っていない行を含む）から順に、1回 PRICING_HOT_MAX 件まで
   ・取り直した値は items に書く（中古の行は新品の最安値も入れる）
   ・上限で取り切れなかった件数を /status（hot_pricing）と Discord に出す
   ・同じ知らせは24時間に1回まで
   ・日次（syncPricing）はそのまま動く */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：3時間ごとのAmazon最安値');
const ok=T.ok;
const { worker, T:W }=await loadWorker('pricinghot');
const env=makeEnv();
const now=new Date().toISOString();
const ago=(ms)=>new Date(Date.now()-ms).toISOString();
const DAY=24*60*60*1000;

/* SP-API の呼び出し間隔（10.5秒）はテストでは待たない。
   sleep は setTimeout を使うので、長い待ちだけ短く差し替える。 */
const realTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms,...a)=>realTimeout(fn,(ms>50?1:ms),...a);

let calls=[], notes=[], offers={};
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/api\.amazon\.com\/auth\/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:3600}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/batches\/products\/pricing\/v0\/itemOffers/.test(url)){
    const body=JSON.parse(String(o.body||'{}'));
    calls.push((body.requests||[]).map((r)=>{
      const m=/\/items\/([A-Z0-9]{10})\/offers/.exec(String(r.uri||''));
      return (m?m[1]:'?')+'|'+(r.ItemCondition==='New'?'new':'used'); }));
    return new Response(JSON.stringify({ responses:(body.requests||[]).map((r)=>{
      const m=/\/items\/([A-Z0-9]{10})\/offers/.exec(String(r.uri||''));
      const asin=m?m[1]:'';
      const key=asin+'|'+(r.ItemCondition==='New'?'new':'used');
      const list=offers[key]||[];
      return { request:r, status:{statusCode:200},
        body:{ payload:{ ASIN:asin, ItemCondition:r.ItemCondition,
          Offers:list.map((p)=>({ ListingPrice:{Amount:p,CurrencyCode:'JPY'},
            Shipping:{Amount:0,CurrencyCode:'JPY'},
            SubCondition:(r.ItemCondition==='New')?'new':'good' })) } } };
    }) }),{status:200,headers:{'content-type':'application/json'}});
  }
  if(/discord/.test(url)){ notes.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response(null,{status:204}); }
  throw new Error('想定外の通信: '+url);
};

let seq=0;
async function seed(asin,extra){
  seq++;
  const d=Object.assign({cond:'used',ebay_item_id:String(550000+seq),ebay_qty:1,
    restocking:0,fba_available:5,on_hand:0,dropship:0,one_off:0,
    amazon_lowest:null,amazon_lowest_at:null},extra||{});
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,restocking,fba_available,fba_inbound,fba_reserved,
    on_hand,dropship,one_off,one_off_known,amazon_lowest,amazon_lowest_at,updated_at)
    VALUES (?1,?2,'ebay',?3,?4,?5,?6,30,?7,?8,?9,0,0,?10,?11,?12,1,?13,?14,?7)`)
    .bind(asin,d.cond,asin+'の商品','E-'+asin+'-U',d.ebay_item_id,d.ebay_qty,now,
      d.restocking,d.fba_available,d.on_hand,d.dropship,d.one_off,
      d.amazon_lowest,d.amazon_lowest_at).run();
}
const row=async(asin)=>await env.DB.prepare(
  `SELECT amazon_lowest,amazon_lowest_n,amazon_offers,amazon_offers_json,
          amazon_lowest_at,amazon_new_low,amazon_new_at FROM items WHERE asin=?1`)
  .bind(asin).first();
const wipe=async()=>{
  await env.DB.prepare('DELETE FROM items').bind().run();
  await env.DB.prepare("DELETE FROM sync_state WHERE k='pricing.hot'").bind().run();
};
const hot=async()=>(await asJson(await worker.fetch(
  post('/sync',{kind:'pricing-hot'}),env))).body;

console.log('=== 対象の決まり ===');
await wipe(); calls=[];
await seed('B0HOT00001',{restocking:1});                 // 再調達中 → 対象
await seed('B0HOT00002',{fba_available:0});              // FBAで売れた → 対象
await seed('B0HOT00003');                                // FBA在庫あり → 対象外
await seed('B0HOT00004',{fba_available:0,on_hand:1});    // 手元在庫 → 対象外
await seed('B0HOT00005',{fba_available:0,dropship:1});   // 無在庫 → 対象外
await seed('B0HOT00006',{fba_available:0,one_off:1});    // 一点物 → 対象外
await seed('B0HOT00007',{fba_available:0,ebay_qty:0});   // 数量0 → 対象外
await seed('B0HOT00008',{fba_available:0,ebay_item_id:''}); // 未出品 → 対象外
await seed('B0HOT00009',{fba_available:null});           // FBA未確認 → 対象外
let r=await hot();
console.log('   '+JSON.stringify(r.hot));
console.log('   送った要求: '+JSON.stringify(calls));
ok(r.hot.picked===2&&r.hot.rows===2,'★★対象は再調達中とFBAで売れた行の2件だけ');
ok(r.hot.left===0,'★上限の中に収まっている');
const sent=calls.flat().map((x)=>x.split('|')[0]);
ok(sent.indexOf('B0HOT00001')>=0&&sent.indexOf('B0HOT00002')>=0,
   '★★その2件を要求する');
ok(['B0HOT00003','B0HOT00004','B0HOT00005','B0HOT00006','B0HOT00007','B0HOT00008',
    'B0HOT00009'].every((a)=>sent.indexOf(a)<0),
   '★★対象外の行は要求しない');

console.log('\n=== 取り直した値を書く ===');
await wipe(); calls=[]; offers={};
offers['B0HOT10001|used']=[9000,9100,9150];
offers['B0HOT10001|new']=[12000];
await seed('B0HOT10001',{restocking:1});
r=await hot();
let a1=await row('B0HOT10001');
console.log('   '+JSON.stringify(a1));
ok(a1.amazon_lowest===9000&&a1.amazon_offers===3,'★★最安値と出品件数を書く');
ok(!!a1.amazon_lowest_at,'★★取得日時を入れる（24時間の鮮度に使う）');
ok(JSON.parse(a1.amazon_offers_json).length===3,'★出品の明細も残す');
ok(a1.amazon_new_low===12000&&!!a1.amazon_new_at,
   '★★中古の行には新品の最安値も入れる');
ok(calls.flat().length===2,'★1行につき「その行の状態＋新品」の2件を要求する');

console.log('\n=== 古い行から順に取る ===');
await wipe(); calls=[];
await seed('B0HOT20001',{cond:'new',restocking:1,amazon_lowest:5000,
  amazon_lowest_at:ago(1*60*60*1000)});                  // 1時間前（新しい）
await seed('B0HOT20002',{cond:'new',restocking:1,amazon_lowest:5000,
  amazon_lowest_at:ago(10*DAY)});                        // 10日前
await seed('B0HOT20003',{cond:'new',restocking:1});      // まだ一度も取っていない
r=await hot();
console.log('   送った順: '+JSON.stringify(calls.flat()));
ok(calls.flat()[0]==='B0HOT20003|new','★★まだ取っていない行が最初');
ok(calls.flat()[1]==='B0HOT20002|new','★★次に古い行');

console.log('\n=== 上限で取り切れなかった件数 ===');
await wipe(); calls=[]; notes=[];
/* 新品の行だけにして、1行＝1要求にする（40件＝2回の呼び出し）。 */
for(let i=0;i<45;i++)await seed('B0HOTM'+String(1000+i),{cond:'new',restocking:1});
r=await hot();
console.log('   '+JSON.stringify(r.hot)+' / note: '+JSON.stringify(r.note||r));
ok(r.hot&&r.hot.picked===45&&r.hot.rows===W.PRICING_HOT_MAX&&r.hot.left===5,
   '★★対象45件・取り直し40件・取り切れなかった5件');
ok(calls.flat().length===40,'★要求は40件（1回20件×2回）');
console.log('   '+(notes[0]||'').replace(/\n/g,' / '));
ok(/3時間ごと/.test(notes[0]||'')&&/45件のうち 40件/.test(notes[0]||''),
   '★★Discord に取り切れなかったことを出す');
ok(/取り切れなかった 5件/.test(notes[0]||''),'★★件数を出す');
ok(/上限を上げてください/.test(notes[0]||''),'★上限を上げるよう促す');
let st=await asJson(await worker.fetch(get('/status?limit=5'),env));
console.log('   /status: '+JSON.stringify(st.body.hot_pricing));
ok(st.body.hot_pricing&&st.body.hot_pricing.left===5
   &&st.body.hot_pricing.max===W.PRICING_HOT_MAX,
   '★★/status（hot_pricing）にも出す');
ok(st.body.hot_pricing.picked===45&&st.body.hot_pricing.rows===40,'★内訳も返す');

console.log('\n=== 同じ知らせは24時間に1回 ===');
notes=[];
r=await hot();
console.log('   2回目の知らせ: '+JSON.stringify(notes));
ok(r.hot.left===5,'★取り切れないことは変わらない');
ok(notes.length===0,'★★24時間のうちは同じ知らせを出さない');
st=await asJson(await worker.fetch(get('/status?limit=5'),env));
ok(st.body.hot_pricing.left===5,'★★画面にはいつも出す（知らせだけ間隔をあける）');
// 24時間より前に知らせたことにすると、また知らせる
await env.DB.prepare(
  `UPDATE sync_state SET v=?1 WHERE k='pricing.hot'`)
  .bind(JSON.stringify({ at:now, picked:45, rows:40, left:5, max:40, wrote:40,
    warn_at:ago(DAY+60000) })).run();
notes=[];
r=await hot();
ok(notes.length===1,'★★24時間たてばまた知らせる');

console.log('\n=== 取り切れていれば知らせない ===');
await wipe(); calls=[]; notes=[];
await seed('B0HOT30001',{cond:'new',restocking:1});
r=await hot();
console.log('   '+JSON.stringify(r.hot)+' / 知らせ '+notes.length+'件');
ok(r.hot.left===0&&notes.length===0,'★★取り切れていれば知らせない');
let st2=await asJson(await worker.fetch(get('/status?limit=5'),env));
ok(st2.body.hot_pricing.left===0,'★結果は残す（画面の警告は出ない）');

console.log('\n=== 対象が無いときは何もしない ===');
await wipe(); calls=[]; notes=[];
await seed('B0HOT40001');                                // FBA在庫あり → 対象外
r=await hot();
console.log('   '+JSON.stringify(r.hot)+' / 呼び出し '+calls.length+'回');
ok(r.hot.picked===0&&calls.length===0,'★★Amazon を呼ばない');
ok(notes.length===0,'★知らせも出さない');

console.log('\n=== 日次（syncPricing）はそのまま ===');
await wipe(); calls=[];
await seed('B0HOT50001',{cond:'new'});                   // 対象外だが日次は見る
await seed('B0HOT50002',{cond:'new',restocking:1});
await asJson(await worker.fetch(post('/sync',{kind:'pricing'}),env));
const sent2=calls.flat().map((x)=>x.split('|')[0]);
console.log('   日次が送った: '+JSON.stringify(sent2));
ok(sent2.indexOf('B0HOT50001')>=0&&sent2.indexOf('B0HOT50002')>=0,
   '★★日次は eBayに出ている行すべてを見る（変えていない）');

console.log('\n=== 対象の条件を直接見る ===');
const w=W.pricingHotWhere();
ok(/restocking=1/.test(w),'★再調達中を含む');
ok(/fba_available,-1\)=0/.test(w),'★★FBA未確認（NULL）は含めない');
ok(/on_hand,0\)=0/.test(w)&&/dropship,0\)=0/.test(w)&&/one_off,0\)=0/.test(w),
   '★手元在庫・無在庫・一点物を外す');
ok(/ebay_qty>0/.test(w),'★数量0は外す');
ok(W.PRICING_HOT_MAX===40,'★★1回の上限は40件');

globalThis.setTimeout=realTimeout;
await T.done();
