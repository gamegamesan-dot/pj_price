/* Worker：値付けの式を shared/pricing.js から読む（7.51）
   ・Worker と pj_price が**同じファイル**の式を使うこと
   ・tests/pricing-baseline.json（切り出す前・広告料率6%で記録）と
     1円単位（セント単位）で同じ金額になること
   ・設定は /settings に送られた値＋Worker が取った為替から作ること
   ・広告料率は「自動処理の広告料率」（autoAdRate・既定6%）を使うこと
   ・GET /pricing が確かめるための窓口になること */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
import PRICING from '../shared/pricing.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const base=JSON.parse(fs.readFileSync(path.join(HERE,'pricing-baseline.json'),'utf8'));
const T=harness('Worker：値付けの式の切り出し');
const ok=T.ok;
const { worker, T:W }=await loadWorker('pricing');
const env=makeEnv();

globalThis.fetch=async(u)=>{
  const url=String(u);
  if(/open\.er-api\.com/.test(url))
    return new Response(JSON.stringify({rates:{JPY:160}}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/frankfurter/.test(url))return new Response('ng',{status:500});
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('想定外の通信: '+url);
};
let atSeq=0;
const put=async(o)=>await asJson(await worker.fetch(post('/settings',
  {at:new Date(Date.now()+(++atSeq)*1000).toISOString(),settings:o}),env));

console.log('=== 基準は切り出す前の記録 ===');
console.log('   記録した版: '+base.app);
ok(base.app==='v173','★★基準は切り出す前（v173）の記録');

console.log('\n=== 式は1か所（Worker も同じファイルを読む）===');
ok(!!PRICING&&typeof PRICING.model==='function','★shared/pricing.js を読める');
ok(W.PRICING===PRICING,'★★Worker が読んでいるのは同じファイル（同じ中身）');
ok(typeof W.PRICING.priceFor==='function'&&typeof W.PRICING.maxCost==='function',
   '★推奨売値と仕入値の上限の式が使える');
ok(W.AUTO_AD_DEFAULT===6,'★★自動処理の広告料率の既定は6%');

console.log('\n=== 設定は /settings と為替から作る ===');
await put({ fx:'151.4', fxc:'3.5', fee:'14.2', intlFee:'1.8', autoAdRate:'7.5',
  feeTax:'10', fixed:'0.55', pack:'220', usTaxRate:'9.5', baseProfit:'1500',
  linkRate:'45', saleRate:'18', targetMode:'auto', shipCharge:'15',
  dutyShip:true, taxRefund:true, stampDisc:true });
let ps=await W.pricingSettings(env, { notes:[], subrequests:0, errors:0 });
console.log('   '+JSON.stringify(ps.S));
ok(ps.S.fee===14.2&&ps.S.pack===220&&ps.S.baseProfit===1500,'★★送られた値が入る');
ok(ps.S.adRate===7.5,'★★広告料率は autoAdRate を使う');
ok(ps.S.dutyShip===true&&ps.S.taxRefund===true&&ps.S.stampDisc===true,
   '★★チェック欄（真偽値）も入る');
ok(ps.S.fx===160,'★★為替は Worker が取った値を使う（設定の151.4ではない）');
// autoAdRate が無い設定では既定6%
await put({ fx:'160', fee:'13.6', targetMode:'auto', baseProfit:'1000' });
ps=await W.pricingSettings(env, { notes:[], subrequests:0, errors:0 });
ok(ps.S.adRate===6,'★★autoAdRate が無ければ6%');
// eBayタブの広告料率が混ざっていても使わない
await put({ fx:'160', fee:'13.6', targetMode:'auto', baseProfit:'1000', adRate:'0' });
ps=await W.pricingSettings(env, { notes:[], subrequests:0, errors:0 });
ok(ps.S.adRate===6,'★★adRate（その場の計算用）が来ても使わない');

console.log('\n=== 基準と同じ金額になる（設定6組 × 1品50通り）===');
let bad=[], n=0;
for(const sv of base.sets){
  const s=sv.settings;
  const S=PRICING.settings(Object.assign({},s,{ adRate:s.adRate }));
  for(const r of sv.rows){
    n++;
    const pf=PRICING.priceFor(S,r.in.cost,r.in.weight,r.in.flat);
    const m=PRICING.model(S,{cost:r.in.cost,weight:r.in.weight,flat:r.in.flat});
    const pp=PRICING.priceForProfit(S,r.in.cost,r.in.weight,5000,r.in.flat);
    const tg=PRICING.autoTarget(S,r.in.cost);
    const chk=[['price',pf.price,r.price],['floor',pf.floor,r.floor],
      ['be',pf.be,r.be],['zone',pf.zone,r.zone],['pp',pp,r.pp],['target',tg,r.target],
      ['basisZone',m.basisZone,r.basisZone],['basis',m.basis,r.basis]];
    chk.forEach(function(x){
      if(String(x[1])!==String(x[2]))
        bad.push(sv.name+' '+JSON.stringify(r.in)+' '+x[0]+': '+x[2]+' → '+x[1]);
    });
    [['profit',pf.profit,r.profit],['pRec',m.pRec,r.pRec],['mFloor',m.floor,r.mFloor],
     ['denB',m.denB,r.denB],['restB',m.restB,r.restB]].forEach(function(x){
      if(Math.abs(x[1]-x[2])>1e-9)
        bad.push(sv.name+' '+JSON.stringify(r.in)+' '+x[0]+': '+x[2]+' → '+x[1]);
    });
  }
}
console.log('   見比べた件数: '+n+'　ちがい: '+bad.length);
bad.slice(0,8).forEach(function(x){ console.log('   ✗ '+x); });
ok(n===300,'★300件を見比べた');
ok(bad.length===0,'★★Worker 側でも金額がぜんぶ同じ');

console.log('\n=== 仕入値の上限も同じ ===');
let mbad=0;
base.sync.forEach(function(r){
  if(!r.rec)return;
  const S=PRICING.settings({ fx:160, fxc:2, fee:13.6, intlFee:1.35, adRate:6,
    feeTax:10, fixed:0.40, pack:150, shipCharge:15, usTaxRate:8,
    baseProfit:1000, linkRate:30, saleRate:15, targetMode:'auto' });
  const w=r.rec.weight;
  if(PRICING.maxCost(S,60,w,0)!==r.maxCost)mbad++;
});
ok(mbad===0,'★★その売値で買い直せる上限（maxCost）も同じ');

console.log('\n=== GET /pricing（確かめるための窓口）===');
await put({ fx:'160', fxc:'2', fee:'13.6', intlFee:'1.35', autoAdRate:'6',
  feeTax:'10', fixed:'0.40', pack:'150', shipCharge:'15', usTaxRate:'8',
  baseProfit:'1000', linkRate:'30', saleRate:'15', targetMode:'auto' });
let r=await asJson(await worker.fetch(
  get('/pricing?cost=3980&weight=345&price=60'),env));
console.log('   '+JSON.stringify(r.body.price)+' / 目標 '+r.body.target
  +' / 上限 '+r.body.max_cost+' / 広告 '+r.body.auto_ad_rate+'%');
const want=base.sync.find((x)=>x.asin==='B0BASE0002');
ok(r.status===200&&r.body.ok===true,'★返る');
ok(r.body.price.price===want.cost.price&&r.body.price.floor===want.cost.floor,
   '★★画面と同じ推奨売値・最低売値（仕入値3,980円・345g）');
ok(r.body.max_cost===want.maxCost,'★★仕入値の上限も同じ');
ok(r.body.auto_ad_rate===6,'★使った広告料率を返す');
ok(r.body.version===PRICING.VERSION,'★式の版を返す');
ok(!!r.body.fx&&r.body.fx.rate===160,'★使った為替も返す');
// 封筒の送料
let r2=await asJson(await worker.fetch(
  get('/pricing?cost=1200&weight=200&flat=320'),env));
console.log('   封筒: '+JSON.stringify(r2.body.price));
ok(r2.body.price.price===25.69,'★★封筒の送料（flat）も効く');

console.log('\n=== 作業者のキーでも読める（読み取りだけ）===');
const env2=makeEnv({ STAFF_KEY:'staff-key-123' });
await worker.fetch(new Request('https://x/settings',{method:'POST',
  headers:{'X-PJ-Key':'k','content-type':'application/json'},
  body:JSON.stringify({at:new Date().toISOString(),
    settings:{fx:'160',fee:'13.6',targetMode:'auto',baseProfit:'1000'}})}),env2);
const staff=await asJson(await worker.fetch(new Request(
  'https://x/pricing?cost=1200&weight=150',{headers:{'X-PJ-Key':'staff-key-123'}}),env2));
ok(staff.status===200&&staff.body.price.price>0,'★★作業者でも計算を見られる');

await T.done();
