/* Worker：Amazon に登録した SKU を控える（7.77）
   ・skus に 仕入れ元（buy_src）・社（mw_sha）・JAN・仕入値（cost_src）を控える
   ・SKU の接頭辞 mwgame／mwhobby は MW から仕入れた分
   ・接頭辞の表（skuCatOf／skuSrcOf）が index.html と同じ区分を返す
   ・作業者のキーでは控えられない（仕入れ値が入るため） */
import { harness, loadWorker, makeEnv, asJson } from './lib.mjs';
const T=harness('Worker：Amazon登録の控え');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwreg');
const env=makeEnv({ STAFF_KEY:'staff-key-123' });
globalThis.fetch=async(u)=>{
  const url=String(u);
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
const post=async(path,body,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));

console.log('=== 接頭辞の表 ===');
ok(W.skuCatOf('mwgame')==='game'&&W.skuCatOf('game')==='game','★★mwgame はゲーム');
ok(W.skuCatOf('mwhobby')==='fig'&&W.skuCatOf('hobby')==='fig'
   &&W.skuCatOf('toy')==='fig','★★mwhobby はフィギュア扱い');
ok(W.skuCatOf('cd')===''&&W.skuCatOf('')==='','★対象外は空');
ok(W.skuSrcOf('mwgame')==='mw'&&W.skuSrcOf('mwhobby')==='mw','★★★MW の印');
ok(W.skuSrcOf('game')==='other'&&W.skuSrcOf('hobby')==='other'
   &&W.skuSrcOf('')==='other','★★それ以外は other');

console.log('\n=== SKU の解析（接頭辞が増えても壊れない）===');
let p=W.parseSku('mwgame-20261026-N-B0G1M2ZZN7-3476');
console.log('   '+JSON.stringify(p));
ok(p.ok===true,'★★★mwgame の SKU を読める');
ok(p.prefix==='mwgame'&&p.scope==='ebay','★★eBay に出す区分になる');
ok(p.asin==='B0G1M2ZZN7'&&p.cond==='new'&&p.condCode==='N','★ASIN と状態');
ok(p.purchasedOn==='2026-10-26'&&p.cost===3476,'★★仕入日と仕入原価');
let p2=W.parseSku('mwhobby-20261026-N-B07Q82JYFD-2200');
ok(p2.ok===true&&p2.prefix==='mwhobby'&&p2.scope==='ebay','★★mwhobby も読める');
/* せどりすと の今までの SKU がそのまま通ること */
let p3=W.parseSku('hobby-20261025-UA-B0BYZ19WFH-7500');
ok(p3.ok===true&&p3.prefix==='hobby'&&p3.cond==='used','★★★今までの SKU も通る');
/* Amazon の SKU は40文字まで。mwhobby でも収まること */
let longest='mwhobby-20261026-UKN-B0BYZ19WFH-999999';
ok(longest.length<=40,'★★★いちばん長い形でも40文字以内（'+longest.length+'文字）');

console.log('\n=== 控える ===');
let r=await post('/mw/reg',{ rows:[
  { sku:'mwgame-20261026-N-B0G1M2ZZN7-3476', jan:'4902370550467', sha:'M200',
    cost_src:3476, title:'ゲームの商品' },
  { sku:'mwhobby-20261026-N-B07Q82JYFD-2200', jan:'4580416924740', sha:'MC02',
    cost_src:2200, title:'フィギュアの商品' },
  { sku:'こわれたSKU', jan:'4988611224878', sha:'E027', cost_src:1 }] });
console.log('   '+r.status+' '+JSON.stringify(r.body).slice(0,300));
ok(r.body.ok===true,'★★通る');
ok(r.body.saved===2&&r.body.skipped===1,'★★★形が違う SKU は外す');
const g=async(sku)=>await env.DB.prepare(
  'SELECT * FROM skus WHERE seller_sku=?1').bind(sku).first();
let a=await g('mwgame-20261026-N-B0G1M2ZZN7-3476');
console.log('   '+JSON.stringify({src:a.buy_src,jan:a.jan,sha:a.mw_sha,
  cost:a.cost_src,asin:a.asin,prefix:a.prefix}));
ok(a.buy_src==='mw','★★★仕入れ元を控える');
ok(a.jan==='4902370550467','★★★JAN を控える');
ok(a.mw_sha==='M200','★★★社を控える');
ok(a.cost_src===3476,'★★★仕入値（卸値×1.1＋送料）を控える');
ok(a.asin==='B0G1M2ZZN7'&&a.cond==='new'&&a.prefix==='mwgame'&&a.scope==='ebay',
   '★★SKU から読んだ中身も入る');
ok(a.cost===3476&&a.purchased_on==='2026-10-26','★仕入日と仕入原価');
let b=await g('mwhobby-20261026-N-B07Q82JYFD-2200');
ok(b.buy_src==='mw'&&b.mw_sha==='MC02','★★2件目も控える');
ok(!(await g('こわれたSKU')),'★★形が違う SKU は入れない');

console.log('\n=== 送り直しても壊れない ===');
r=await post('/mw/reg',{ rows:[
  { sku:'mwgame-20261026-N-B0G1M2ZZN7-3476', jan:'', sha:'',
    cost_src:0, title:'' }] });
let a2=await g('mwgame-20261026-N-B0G1M2ZZN7-3476');
ok(r.body.saved===1,'★もう一度送れる');
ok(a2.jan==='4902370550467'&&a2.mw_sha==='M200'&&a2.cost_src===3476,
   '★★★空で送り直しても控えた中身は消えない');
ok(a2.title==='ゲームの商品','★★商品名も消えない');

console.log('\n=== 店舗仕入れの分と分けられる ===');
await post('/mw/reg',{ rows:[
  { sku:'hobby-20261026-N-B00IM66FJ4-5000', jan:'', sha:'', cost_src:5000,
    title:'店舗で仕入れた分' }] });
let c=await g('hobby-20261026-N-B00IM66FJ4-5000');
ok(c.buy_src==='other','★★★接頭辞が mw でなければ other');
let n=await env.DB.prepare(
  "SELECT COUNT(*) AS n FROM skus WHERE buy_src='mw'").first();
ok(n.n===2,'★★★MW の分だけ数えられる');

console.log('\n=== 件数の上限 ===');
ok(W.MW_REG_MAX===500,'★1回 500件まで');

console.log('\n=== 作業者のキー ===');
r=await post('/mw/reg',{ rows:[] },'staff-key-123');
ok(r.status===403,'★★作業者では控えられない（仕入れ値が入る）');

await T.done();
