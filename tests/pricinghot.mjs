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
    sku:'E-'+asin+'-U',
    amazon_lowest:null,amazon_lowest_at:null},extra||{});
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,restocking,fba_available,fba_inbound,fba_reserved,
    on_hand,dropship,one_off,one_off_known,amazon_lowest,amazon_lowest_at,updated_at)
    VALUES (?1,?2,'ebay',?3,?4,?5,?6,30,?7,?8,?9,0,0,?10,?11,?12,1,?13,?14,?7)`)
    .bind(asin,d.cond,asin+'の商品',d.sku,d.ebay_item_id,d.ebay_qty,now,
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
/* 7.136：⚙「3時間ごとに取り直す上限」（syncHotMax）。0・未設定なら自動。 */
const setHotMax=async(n)=>{
  const v=JSON.stringify({ at:new Date().toISOString(),
    settings:(n===null?{}:{ syncHotMax:n }) });
  await env.DB.prepare(
    `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
     ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
    .bind(v,new Date().toISOString()).run();
};
const hot=async()=>(await asJson(await worker.fetch(
  post('/sync',{kind:'pricing-hot'}),env))).body;

console.log('=== 対象の決まり ===');
await wipe(); calls=[];
await seed('B0HOT00001',{restocking:1});                 // 再調達中 → 対象
await seed('B0HOT00002',{fba_available:0});              // FBAで売れた → 対象
await seed('B0HOT00003');                                // FBA在庫あり → 対象外
await seed('B0HOT00004',{fba_available:0,on_hand:1});    // 手元在庫 → 対象外
/* 7.132：無在庫（dropship=1）も**対象**になった（売値の追従がこの値を見る）。
   ただし MW 無在庫（W-<JAN>）は Amazon の ASIN が無いので対象外。 */
await seed('B0HOT00005',{fba_available:0,dropship:1});   // 無在庫 → 対象
await seed('B0HOT00010',{fba_available:0,dropship:1,
  sku:'W-4902370550467'});                               // MW 無在庫 → 対象外
await seed('B0HOT00006',{fba_available:0,one_off:1});    // 一点物 → 対象外
await seed('B0HOT00007',{fba_available:0,ebay_qty:0});   // 数量0 → 対象外
await seed('B0HOT00008',{fba_available:0,ebay_item_id:''}); // 未出品 → 対象外
await seed('B0HOT00009',{fba_available:null});           // FBA未確認 → 対象外
let r=await hot();
console.log('   '+JSON.stringify(r.hot));
console.log('   送った要求: '+JSON.stringify(calls));
ok(r.hot.picked===3&&r.hot.rows===3,
   '★★対象は再調達中・FBAで売れた行・無在庫の3件（7.132）');
ok(calls.flat().every((x)=>x.indexOf('B0HOT00010')<0),
   '★★★MW 無在庫（W-<JAN>）は要求しない（段取り D が見る）');
ok(r.hot.left===0,'★上限の中に収まっている');
const sent=calls.flat().map((x)=>x.split('|')[0]);
ok(sent.indexOf('B0HOT00001')>=0&&sent.indexOf('B0HOT00002')>=0
   &&sent.indexOf('B0HOT00005')>=0,
   '★★その3件を要求する（再調達中・FBAで売れた行・無在庫）');
ok(['B0HOT00003','B0HOT00004','B0HOT00006','B0HOT00007','B0HOT00008',
    'B0HOT00009','B0HOT00010'].every((a)=>sent.indexOf(a)<0),
   '★★対象外の行は要求しない（手元在庫・一点物・数量0・未出品・MW無在庫）');

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

console.log('\n=== 7.136 対象の件数に合わせて自動で決める ===');
await wipe(); calls=[]; notes=[];
await setHotMax(null);                      // ⚙ は空（自動）
/* 新品の行だけにして、1行＝1要求にする。
   7.136：既定 150件なので、65件なら**取り切れる**（v260 は 60件で止まっていた）。 */
for(let i=0;i<65;i++)await seed('B0HOTM'+String(1000+i),{cond:'new',restocking:1});
r=await hot();
console.log('   '+JSON.stringify(r.hot));
ok(r.hot.picked===65&&r.hot.rows===65&&r.hot.left===0,
   '★★★対象65件を1回で取り切る（既定150件・v260 は60件で止まっていた）');
ok(r.hot.max===150&&r.hot.auto===true,'★★★上限は自動で 150件');
ok(calls.length===4&&calls.flat().length===65,
   '★★★1回20件で4回呼ぶ（既定の6回の枠に縛られない）');
ok(notes.length===0,'★★取り切れたので知らせない');
/* 対象が既定より多ければ、そのぶん上限も増える（上限の上限まで）。 */
ok(W.hotMaxOf({auto:true,dflt:150,cap:1150},400)===400,
   '★★★対象が多ければ上限も増える');
ok(W.hotMaxOf({auto:true,dflt:150,cap:1150},2000)===1150,
   '★★★SP-API の間隔で収まる件数（上限の上限）で止める');
ok(W.hotMaxOf({auto:true,dflt:150,cap:1150},10)===150,
   '★対象が少なくても既定（150件）までは取る');
ok(W.hotMaxOf({auto:false,set:60,dflt:150,cap:1150},900)===60,
   '★★⚙で決めた件数はそのまま使う');
ok(W.hotMaxOf({auto:false,set:9999,dflt:150,cap:1150},900)===1150,
   '★★⚙の値も上限の上限で止める');

console.log('\n=== 7.136 上限の上限は SP-API の間隔から出す ===');
{
  const cap=W.pricingHotCap();
  const calls2=Math.floor(W.PRICING_HOT_WINDOW_MS/10500)+1;
  console.log('   1回に使ってよい時間 '+(W.PRICING_HOT_WINDOW_MS/60000)
    +'分／呼べる回数 '+calls2+'回／上限の上限 '+cap+'件');
  ok(cap===Math.floor(calls2*20/2),
     '★★★10.5秒に1回・1回20件・1行は最大2件 で出す');
  ok(cap>=150,'★既定（150件）はその中に収まっている');
}

console.log('\n=== 上限で取り切れなかった件数（⚙で小さくしたとき）===');
await setHotMax(60);
calls=[]; notes=[];
await env.DB.prepare("DELETE FROM sync_state WHERE k='pricing.hot'").bind().run();
r=await hot();
console.log('   '+JSON.stringify(r.hot)+' / note: '+JSON.stringify(r.note||r));
ok(r.hot&&r.hot.picked===65&&r.hot.rows===60&&r.hot.left===5,
   '★★対象65件・取り直し60件・取り切れなかった5件');
ok(r.hot.max===60&&r.hot.auto===false,'★★⚙の上限（60件）を使う');
ok(calls.flat().length===60,'★要求は60件（1回20件×3回）');
console.log('   '+(notes[0]||'').replace(/\n/g,' / '));
ok(/3時間ごと/.test(notes[0]||'')&&/65件のうち 60件/.test(notes[0]||''),
   '★★Discord に取り切れなかったことを出す');
ok(/取り切れなかった 5件/.test(notes[0]||''),'★★件数を出す');
ok(/空にすると/.test(notes[0]||'')&&/自動/.test(notes[0]||''),
   '★★★⚙を空にすれば自動になることを知らせる');
let st=await asJson(await worker.fetch(get('/status?limit=5'),env));
console.log('   /status: '+JSON.stringify(st.body.hot_pricing));
ok(st.body.hot_pricing&&st.body.hot_pricing.left===5
   &&st.body.hot_pricing.max===60,
   '★★/status（hot_pricing）にも出す');
ok(st.body.hot_pricing.picked===65&&st.body.hot_pricing.rows===60,'★内訳も返す');
ok(st.body.hot_pricing.auto===false&&st.body.hot_pricing.cap>=150,
   '★★自動かどうかと、上限の上限も返す（画面の帯に出す）');

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
  .bind(JSON.stringify({ at:now, picked:65, rows:60, left:5, max:60, wrote:60,
    auto:false, warn_at:ago(DAY+60000) })).run();
notes=[];
r=await hot();
ok(notes.length===1,'★★24時間たてばまた知らせる');

console.log('\n=== 取り切れていれば知らせない ===');
await wipe(); calls=[]; notes=[]; await setHotMax(null);
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
ok(W.PRICING_HOT_MAX===150,
   '★★★既定の上限は150件（7.136 で 60 → 150。⚙ syncHotMax で変えられる）');

globalThis.setTimeout=realTimeout;
await T.done();
