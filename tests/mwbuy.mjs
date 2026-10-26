/* Worker：MW の仕入れの印（7.68）と実行をまたいだ間隔（7.70）
   ・印は D1 に置くので、端末をまたいで同じものが見える
   ・**作業者（STAFF_KEY）でも付けられる**（仕入れの候補を選ぶ仕事）
   ・「Amazonの実売価格を取る」は管理者だけ（Cron と Amazon の上限を分け合うため）
   ・getItemOffersBatch の間隔は KV にも置いて、実行をまたいで守る */
import { harness, loadWorker, makeEnv, get, asJson } from './lib.mjs';
const T=harness('Worker：仕入れの印');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwbuy');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  LWA_CLIENT_ID:'a', LWA_CLIENT_SECRET:'b', LWA_REFRESH_TOKEN:'c' });
globalThis.fetch=async(u)=>{
  if(/discord/.test(String(u)))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+u);
};
const post=async(path,body,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
const getj=async(path,key)=>(await asJson(await worker.fetch(
  new Request('https://x'+path,{headers:{'X-PJ-Key':key||'k'}}),env))).body;
const row=(jan,sha,x)=>Object.assign({jan:jan,sha:sha,idx:0,kishu:'NS',
  name:jan+'の商品',list_price:5000,release:'2025/01/01',cond:'新品',
  wholesale:12000,stock:9,note:'',ship_text:'即日出荷',ship_days:0},x||{});

console.log('=== 在庫と Amazon の中身を入れる ===');
let r=await post('/mw/stock',{ at:'2026-10-28T00:00:00Z', part:1, parts:1, rows:[
  row('4595120538169','M200'), row('4582292602828','MC02',{wholesale:16082}),
  row('4902370550467','E027',{wholesale:3000})] });
ok(r.body.added===3,'★3件');
await env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,rank,rank_cat,price,basis,new_n,amz,
     checked_at,created_at)
   VALUES ('4595120538169','B0FVLXGFMH','千銃士',649,'Switch',24829,'カート',4,1,'x','x')`).run();

console.log('\n=== 印を付ける ===');
r=await post('/mw/buy',{ jan:'4595120538169', qty:1 });
console.log('   '+JSON.stringify(r.body.rows));
ok(r.body.ok===true&&r.body.n===1,'★★印が付く');
let b=await getj('/mw/buy');
console.log('   '+JSON.stringify({n:b.n,qty:b.qty,yen:b.yen}));
ok(b.n===1&&b.qty===1,'★★一覧に出る');
ok(b.yen===Math.round(12000*1.1),'★★合計は卸値×1.1');
ok(b.rows[0].mw_name&&b.rows[0].asin==='B0FVLXGFMH',
   '★★MW と Amazon の中身も一緒に返す（注文用）');
ok(b.rows[0].ship_text==='即日出荷'&&b.rows[0].sha==='M200',
   '★社と出荷日も返る');

console.log('\n=== 数量を変える ===');
r=await post('/mw/buy',{ jan:'4595120538169', qty:3 });
b=await getj('/mw/buy');
ok(b.qty===3&&b.yen===Math.round(12000*1.1)*3,'★★数量ぶん合計も増える');
r=await post('/mw/buy',{ jan:'4595120538169', qty:999 });
b=await getj('/mw/buy');
ok(b.rows[0].qty===W.MW_BUY_MAX_QTY,'★★数量の上限で止める');

console.log('\n=== 印を外す（数量0）===');
r=await post('/mw/buy',{ jan:'4595120538169', qty:0 });
b=await getj('/mw/buy');
ok(b.n===0,'★★数量0で印が消える');

console.log('\n=== まとめて付ける ===');
r=await post('/mw/buy',{ items:[
  { jan:'4595120538169', qty:2 }, { jan:'4582292602828', qty:1 },
  { jan:'490237055046', qty:1 } ] });
console.log('   '+JSON.stringify({n:r.body.n}));
b=await getj('/mw/buy');
ok(b.n===2,'★★13桁でない JAN は入らない');
ok(b.qty===3,'★数量の合計');
ok(b.yen===Math.round(12000*1.1)*2+Math.round(16082*1.1),'★★合計の計算');

console.log('\n=== 候補一覧に印が付いて返る ===');
let d=await getj('/mw/amz?kishu=NS&ship_max=4&stock_min=2&limit=100');
let one=d.rows.filter((x)=>x.jan==='4595120538169')[0];
console.log('   buy_qty='+(one&&one.buy_qty));
ok(one&&one.buy_qty===2,'★★★一覧の行に仕入れの数量が入る（端末をまたいで見える）');
let other=d.rows.filter((x)=>x.jan==='4902370550467')[0];
ok(other&&other.buy_qty===0,'★印の無い行は0');

console.log('\n=== 欠品した行は知らせる ===');
await env.DB.prepare(
  "UPDATE mw_stock SET gone_at='2026-10-29T00:00:00Z' WHERE jan='4582292602828'").run();
b=await getj('/mw/buy');
ok(b.gone===1,'★★印を付けたあとに欠品した行を数える');

console.log('\n=== 作業者のキー（7.68・項目5）===');
r=await post('/mw/buy',{ jan:'4902370550467', qty:1 },'staff-key-123');
console.log('   印: '+JSON.stringify({status:r.status,ok:r.body.ok}));
ok(r.status===200&&r.body.ok===true,'★★★作業者でも仕入れの印は付けられる');
let srow=await env.DB.prepare(
  "SELECT by_role FROM mw_buy WHERE jan='4902370550467'").first();
ok(srow.by_role==='staff','★★誰が付けたかを控える');
let sb=await getj('/mw/buy','staff-key-123');
ok(sb.ok===true,'★★作業者でも印の一覧は見られる');
let sl=await getj('/mw/amz?kishu=NS&limit=10','staff-key-123');
ok(sl.ok===true,'★★作業者でも候補一覧は見られる');
/* 実売価格の取得は管理者だけ（Cron と Amazon の上限を分け合うため） */
r=await post('/mw/amz',{ kishu:'NS' },'staff-key-123');
console.log('   実売価格: '+JSON.stringify({status:r.status,err:r.body.error}));
ok(r.status===403&&r.body.error==='forbidden_for_staff',
   '★★★「Amazonの実売価格を取る」は作業者では使えない');

console.log('\n=== 実行をまたいだ間隔（7.70）===');
ok(W.SP_KV_LANES.getItemOffersBatch===1,
   '★★getItemOffersBatch は KV でも間隔を守る');
ok(!W.SP_KV_LANES.searchCatalogItems,'★Catalog は速いので対象外');
/* KV に「いま呼んだ」と書いてから、すぐ呼ぼうとすると待たされる */
await env.SYNC_CACHE.put('sp:last:getItemOffersBatch',String(Date.now()));
let t0=Date.now();
await W.spSlotKv(env,'getItemOffersBatch');
let waited=Date.now()-t0;
console.log('   待った時間: '+waited+'ms');
ok(waited>=200,'★★★直前に呼ばれていたら待つ（Cron と取り合わない）');
let t1=Date.now();
await W.spSlotKv(env,'getOrders');
ok(Date.now()-t1<100,'★対象外の呼び出しは待たない');

await T.done();
