/* Worker：目標を自分で計算する（7.52）
   ・pj_price が送った目標が30分以内なら、そちらを使う（押した直後を上書きしない）
   ・それ以外は D1 の仕入値・重量・Amazon最安値と ⚙設定から自分で計算する
   ・計算した値は D1 に書き戻す（画面と同じ数字が出るように）
   ・md_start は、すでに入っている行では書き換えない（値下げの途中を巻き戻さない）
   ・切り出す前（v173）の基準と同じ金額になること（出品リストは Worker には無い）
   ・Cron 1回ぶんの計算が、CPU 時間の上限に収まること */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
import PRICING from '../shared/pricing.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const base=JSON.parse(fs.readFileSync(path.join(HERE,'pricing-baseline.json'),'utf8'));
const T=harness('Worker：目標を自分で計算する');
const ok=T.ok;
const { worker, T:W }=await loadWorker('selftarget');
const env=makeEnv();
const now=new Date().toISOString();
const ago=(ms)=>new Date(Date.now()-ms).toISOString();
const MIN=60*1000;

globalThis.fetch=async(u)=>{
  const url=String(u);
  if(/open\.er-api\.com/.test(url))
    return new Response(JSON.stringify({rates:{JPY:160}}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('想定外の通信: '+url);
};
let atSeq=0;
const put=async(o)=>await asJson(await worker.fetch(post('/settings',
  {at:new Date(Date.now()+(++atSeq)*1000).toISOString(),settings:o}),env));
/* 基準と同じ設定（広告料率6%・為替160円）。 */
const SET={ fx:'160', fxc:'2', fee:'13.6', intlFee:'1.35', autoAdRate:'6',
  feeTax:'10', fixed:'0.40', pack:'150', shipCharge:'15', usTaxRate:'8',
  baseProfit:'1000', linkRate:'30', saleRate:'15', targetMode:'auto',
  syncTol:'200', syncSkipAcc:true, csvLooseAmz:'80',
  syncWeight:'400', syncWeightGame:'150', csvWeightCart:'50', csvWeightLoose:'200',
  csvShipLoose:'0', syncSoldCut:'0', csvReviewAbs:'1', csvReviewPct:'3',
  csvReviewZero:false, csvMarkStep:'1', csvMarkTimes:'10',
  amzFeeRate:'15', amzFbaFee:'400' };
await put(SET);

let seq=0;
async function seed(asin,extra){
  seq++;
  const d=Object.assign({cond:'used',prefix:'game',ebay_item_id:String(660000+seq),
    ebay_qty:1,ebay_price:60,cost_yen:null,weight_g:null,
    restocking:0,dropship:0,one_off:0,ebay_first:0,ebay_sale:null,
    amazon_lowest:9000,amazon_offers:3,amazon_lowest_n:2,
    amazon_offers_json:'[{"p":9000,"c":"good"},{"p":9100,"c":"verygood"}]',
    amazon_new_low:null,amazon_new_n:0,amazon_lowest_at:now,
    sold_usd:null,mark_at:null,mark_stop:0,md_step:null,md_floor:null,md_n:null,
    md_start:null,md_done:0,
    rk_want:null,rk_floor:null,rk_low:null,rk_n:null,rk_max_cost:null,rk_want_at:null,
    pb_want:null,pb_max_cost:null,pb_want_at:null,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_at:null},extra||{});
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,cost_yen,weight_g,restocking,dropship,
    one_off,one_off_known,ebay_first,ebay_sale,amazon_lowest,amazon_offers,
    amazon_lowest_n,amazon_offers_json,amazon_new_low,amazon_new_n,amazon_lowest_at,
    sold_usd,mark_at,mark_stop,md_step,md_floor,md_n,md_start,md_done,
    rk_want,rk_floor,rk_low,rk_n,rk_max_cost,rk_want_at,
    pb_want,pb_max_cost,pb_want_at,rv_want,rv_floor,rv_kind,rv_max_cost,rv_at,
    updated_at)
    VALUES (?1,?2,'ebay',?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,1,?14,?15,?16,?17,
            ?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34,?35,
            ?36,?37,?38,?39,?40,?41,?42,?43,?44,?8)`)
    .bind(asin,d.cond,asin,'E-'+asin+'-U',d.ebay_item_id,d.ebay_qty,d.ebay_price,now,
      d.cost_yen,d.weight_g,d.restocking,d.dropship,d.one_off,d.ebay_first,
      d.ebay_sale,d.amazon_lowest,d.amazon_offers,d.amazon_lowest_n,
      d.amazon_offers_json,d.amazon_new_low,d.amazon_new_n,d.amazon_lowest_at,
      d.sold_usd,d.mark_at,d.mark_stop,d.md_step,d.md_floor,d.md_n,d.md_start,
      d.md_done,d.rk_want,d.rk_floor,d.rk_low,d.rk_n,d.rk_max_cost,d.rk_want_at,
      d.pb_want,d.pb_max_cost,d.pb_want_at,d.rv_want,d.rv_floor,d.rv_kind,
      d.rv_max_cost,d.rv_at).run();
  /* 接頭辞（prefix）は items ではなく skus にある。Worker は ITEM_COLS の
     副問い合わせで引くので、こちらにも1件入れておく。 */
  await env.DB.prepare(`INSERT INTO skus (seller_sku,asin,cond,prefix,scope,active,
    updated_at) VALUES (?1,?2,?3,?4,'ebay',1,?5)`)
    .bind('E-'+asin+'-U',asin,d.cond,d.prefix,now).run();
  return d;
}
const row=async(asin)=>await env.DB.prepare(
  `SELECT ${['rk_want','rk_floor','rk_low','rk_n','rk_max_cost','rk_want_at',
    'pb_want','pb_max_cost','pb_want_at','rv_want','rv_floor','rv_kind','rv_max_cost',
    'rv_at','md_step','md_floor','md_n','md_start'].join(',')}
   FROM items WHERE asin=?1`).bind(asin).first();
const wipe=async()=>{ await env.DB.prepare('DELETE FROM items').bind().run(); };
const mkRun=()=>({ kind:'t', notes:[], subrequests:0, errors:0, rows:0, pages:0, skus:0 });
/* ITEM_COLS で引いた行を selfFill に渡す（prefix / sku_cost も付く）。 */
const fill=async()=>{
  const q=await env.DB.prepare(
    `SELECT ${W.ITEM_COLS} FROM items ORDER BY asin`).all();
  return await W.selfFill(env,mkRun(),(q&&q.results)||[]);
};

console.log('=== 目標が無い行は自分で計算する ===');
await wipe();
await seed('B0SELF0001',{cost_yen:3980,weight_g:345});
let f=await fill();
let a=await row('B0SELF0001');
console.log('   '+JSON.stringify(a));
ok(a.rk_want>0&&a.rk_low===9000,'★★再調達中の売値の目標を入れる');
ok(a.pb_want>0&&a.pb_max_cost>0,'★★フェイズBの再調達の売値も入れる');
ok(a.rv_want>0&&a.rv_kind==='none','★★売値の見直しの目標も入れる');
/* この行は売値（$60）が最低売値（$84.51）より下なので、自動値下げの設定は
   入らない（下げる余地が無い）。売値が高い行で別に見張る。 */
ok(a.md_step===null&&a.md_floor===null,
   '★★売値が最低売値より下の行には自動値下げの設定を入れない');
ok(!!a.rk_want_at&&!!a.pb_want_at&&!!a.rv_at,'★計算した時刻を入れる');
ok(f.wrote===1,'★D1 に書き戻す');

console.log('\n=== 基準（切り出す前）と同じ金額になる ===');
ok(base.app==='v173','★★基準は切り出す前（v173）の記録');
const want=base.sync.find((x)=>x.asin==='B0BASE0002');   // 仕入値3,980円・345g
console.log('   基準: rv_want '+want.rv.rv_want+' / rv_floor '+want.rv.rv_floor
  +' / rv_max_cost '+want.rv.rv_max_cost+' / md '+JSON.stringify(want.md));
ok(a.rv_want===want.rv.rv_want&&a.rv_floor===want.rv.rv_floor
   &&a.rv_max_cost===want.rv.rv_max_cost&&a.rv_kind===want.rv.rv_kind,
   '★★売値の見直しの目標が基準と同じ');
ok(want.md===null,'★基準でもこの行は自動値下げの対象ではない');
ok(a.pb_want===want.pb.price,'★★再調達の売値が基準と同じ');
/* 自動値下げの設定が入る行（売値 $200・最低売値より上）。 */
await wipe();
await seed('B0SELF0003',{ebay_price:200});
await fill();
const md=await row('B0SELF0003');
const wantM=base.sync.find((x)=>x.asin==='B0BASE0014');
console.log('   自動値下げ: '+JSON.stringify({step:md.md_step,floor:md.md_floor,
  n:md.md_n,start:md.md_start})+' / 基準 '+JSON.stringify(wantM.md));
ok(md.md_start===wantM.md.md_start&&md.md_floor===wantM.md.md_floor
   &&md.md_step===wantM.md.md_step&&md.md_n===wantM.md.md_n,
   '★★自動値下げの設定が基準と同じ（幅 $9.12・下限 $108.83・10回）');
/* 再調達中の行（restocking=1）は仕入値を使わず Amazon最安値基準になる */
await wipe();
/* 基準の行（B0BASE0011）と同じ形：実重量は入れず既定重量（ゲーム150g）に落ちる。 */
await seed('B0SELF0002',{cost_yen:3980,restocking:1,ebay_price:60});
await fill();
let b=await row('B0SELF0002');
const wantR=base.sync.find((x)=>x.asin==='B0BASE0011');
console.log('   再調達中: rk_want '+b.rk_want+' / 基準 '+wantR.rk.want);
ok(b.rk_want===wantR.rk.want,'★★再調達中の行の目標が基準と同じ（Amazon最安値基準）');

console.log('\n=== pj_price が30分以内に送った目標はそのまま使う ===');
await wipe();
/* 画面で押した直後（1分前）の目標。わざと計算値とは違う数字を入れる。 */
await seed('B0SELF0010',{cost_yen:3980,weight_g:345,
  rk_want:99.99,rk_floor:88.88,rk_low:7777,rk_n:5,rk_max_cost:1111,
  rk_want_at:ago(1*MIN),
  pb_want:88.88,pb_max_cost:2222,pb_want_at:ago(1*MIN),
  rv_want:77.77,rv_floor:66.66,rv_kind:'rec',rv_max_cost:3333,rv_at:ago(1*MIN)});
f=await fill();
let c=await row('B0SELF0010');
console.log('   '+JSON.stringify(c));
ok(c.rk_want===99.99&&c.rk_low===7777,'★★30分以内の rk_* は上書きしない');
ok(c.pb_want===88.88,'★★30分以内の pb_want は上書きしない');
ok(c.rv_want===77.77&&c.rv_kind==='rec','★★30分以内の rv_* は上書きしない');
/* この行は売値が最低売値より下なので自動値下げの設定も入らない。
   30分以内の目標はそのままなので、書き戻すものが無い。 */
ok(f.wrote===0,'★★書き戻すものが無ければ D1 に触らない');
ok(W.WANT_FRESH_MS===30*60*1000,'★★境目は30分');

console.log('\n=== 30分を過ぎた目標は自分で計算し直す ===');
await wipe();
await seed('B0SELF0011',{cost_yen:3980,weight_g:345,
  rk_want:99.99,rk_want_at:ago(31*MIN),
  pb_want:88.88,pb_want_at:ago(31*MIN),
  rv_want:77.77,rv_kind:'rec',rv_at:ago(31*MIN)});
await fill();
let d=await row('B0SELF0011');
console.log('   '+JSON.stringify({rk:d.rk_want,pb:d.pb_want,rv:d.rv_want}));
ok(d.rk_want!==99.99&&d.rk_want===a.rk_want,'★★rk_* を計算し直す');
ok(d.pb_want!==88.88&&d.pb_want===a.pb_want,'★★pb_want を計算し直す');
ok(d.rv_want!==77.77&&d.rv_want===a.rv_want,'★★rv_* を計算し直す');

console.log('\n=== 値下げの途中は巻き戻さない ===');
await wipe();
await seed('B0SELF0020',{cost_yen:3980,weight_g:345,ebay_price:200,
  md_start:120,md_floor:50,md_step:5,md_n:10,md_done:4});
await fill();
let e=await row('B0SELF0020');
console.log('   '+JSON.stringify({start:e.md_start,floor:e.md_floor,step:e.md_step}));
ok(e.md_start===120,'★★md_start は入っていれば書き換えない（md_done が0に戻るため）');
ok(e.md_floor!==50&&e.md_floor>0,'★下限と幅は新しい設定で直す');

console.log('\n=== 計算できない行は触らない ===');
await wipe();
await seed('B0SELF0030',{amazon_lowest:0,amazon_offers:0,amazon_offers_json:'[]',
  cost_yen:null,weight_g:null,ebay_price:0});
f=await fill();
let g=await row('B0SELF0030');
console.log('   '+JSON.stringify(g)+' / 書き戻し '+f.wrote);
ok(g.rk_want===null&&g.pb_want===null,'★★Amazon最安値が無い行には目標を入れない');
ok(g.md_step===null,'★売値が分からない行に自動値下げの設定を入れない');
ok(f.wrote===0,'★★書き戻しもしない');

console.log('\n=== 出品リストは Worker には無い（D1 の値だけで計算する）===');
await wipe();
await seed('B0SELF0040',{cost_yen:null,weight_g:null});     // 既定重量に落ちる
await fill();
let h=await row('B0SELF0040');
const S=PRICING.settings(Object.assign({},SET,{adRate:6}));
const wd=PRICING.weightOf(S,{cond:'used',prefix:'game'});
console.log('   既定重量 '+JSON.stringify(wd)+' / rv_want '+h.rv_want);
ok(wd.v===150&&wd.from==='def','★★D1 に実測が無ければ既定重量（ゲーム150g）');
ok(h.rv_want===PRICING.rvTarget(S,{cond:'used',prefix:'game',ebay_price:60,
  amazon_lowest:9000,amazon_offers_json:
    '[{"p":9000,"c":"good"},{"p":9100,"c":"verygood"}]'}).rv_want,
  '★★同じ式・同じ設定なら同じ金額');

console.log('\n=== Cron 1回ぶんの計算の重さ ===');
await wipe();
for(let i=0;i<400;i++)await seed('B0LOAD'+String(1000+i),
  {cost_yen:1200+i,weight_g:150+i});
let t0=process.cpuUsage(), w0=Date.now();
f=await fill();
let cpu=(process.cpuUsage(t0).user+process.cpuUsage(t0).system)/1000;
let wall=Date.now()-w0;
console.log('   400行：CPU '+cpu.toFixed(0)+'ms／実時間 '+wall+'ms'
  +'／書き戻し '+f.wrote+'行');
console.log('   1行あたり CPU '+(cpu/400).toFixed(2)+'ms');
ok(f.rows.length===400,'★400行を計算した');
ok(cpu<20000,'★★400行の計算が CPU 20秒より速い（Cron の上限30秒に収まる）');
ok(f.wrote===W.SELF_WRITE_MAX,'★★書き戻しは1回300行まで（残りは次の回）');

await T.done();
