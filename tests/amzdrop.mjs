/* Worker：在庫の根拠がない出品を「Amazon 無在庫」で続ける（7.102）
   手元にも FBA にも無いのに eBay に出ている行（例：E-B07MLZ2JKF-C）。
   数量0にして眠らせず、Amazon の中古を仕入れ先として出し続ける。
   ・対象は「手元在庫オフ・FBA 0か未連動・MW の無在庫でない・数量1以上」
   ・切り替えると amz_drop=1 と restocking=1（値段の追従は再調達の仕組み）
   ・Amazon に出品が無い／下限利益を割る／最安値が24時間取れない → 数量0
   ・売れたら「Amazon で仕入れてください」（ASIN・状態・最安値・リンク・期限）
   ・既定は「予定だけ」。⚙で「実行」に切り替える */
import { harness, loadWorker, makeEnv, post, asJson } from './lib.mjs';
const T=harness('Worker：在庫の根拠がない出品（Amazon 無在庫）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('amzdrop');
const env=makeEnv();
const now=new Date().toISOString();
const old=new Date(Date.now()-3*24*3600000).toISOString();

let notes=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u);
  if(/discord/.test(url)){
    notes.push(JSON.parse(String((i||{}).body||'{}')).content||'');
    return new Response(null,{status:204});
  }
  throw new Error('外へ出てはいけない: '+url);
};

/* 値付けの設定（推奨売値の計算に要る）。 */
let atSeq=0;
const setCfg=async(o)=>await asJson(await worker.fetch(post('/settings',
  {at:new Date(Date.now()+(++atSeq)*1000).toISOString(),
   settings:Object.assign({ fx:160, fee:13.6, intlFee:1.35, autoAdRate:6,
     feeTax:10, fixed:0.40, pack:150, shipCharge:15, usTaxRate:8,
     baseProfit:1000, linkRate:30, saleRate:15, targetMode:'auto',
     amzDropMode:'plan', amzDropPick:'keep' },o||{})}),env));

async function seed(asin,x){
  const d=Object.assign({ cond:'cart', scope:'ebay', sku:'E-'+asin+'-C',
    item:'1687747022', qty:1, price:37.71, on_hand:0, dropship:0,
    fba_av:null, fba_in:0, fba_res:0, fba_seen:null, low:3000, low_at:now,
    weight:150 },x||{});
  await env.DB.prepare(
    `INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,ebay_qty,
       ebay_price,ebay_seen_at,on_hand,dropship,fba_available,fba_inbound,
       fba_reserved,fba_seen_at,amazon_lowest,amazon_lowest_n,amazon_offers,
       amazon_offers_json,amazon_lowest_at,weight_g,updated_at)
     VALUES (?1,?2,'ebay',?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,2,3,
       ?16,?17,?18,?8)`)
    .bind(asin,d.cond,asin+'の商品',d.sku,d.item,d.qty,d.price,now,
      d.on_hand,d.dropship,d.fba_av,d.fba_in,d.fba_res,d.fba_seen,
      d.low,JSON.stringify([{p:d.low,c:'good'},{p:d.low+500,c:'good'}]),
      d.low_at,d.weight).run();
}
/* items は D1 の上限（1表100列）ちょうどなので、印は別表（amz_drop）に持つ。 */
const row=async(asin)=>await env.DB.prepare(
  `SELECT i.ebay_qty AS ebay_qty, i.restocking AS restocking,
          (SELECT 1 FROM amz_drop d WHERE d.asin=i.asin AND d.cond=i.cond)
            AS amz_drop,
          (SELECT d.why FROM amz_drop d WHERE d.asin=i.asin AND d.cond=i.cond)
            AS amz_drop_why
     FROM items i WHERE i.asin=?1`).bind(asin).first();
const job=async(b)=>(await asJson(await worker.fetch(
  post('/sync',Object.assign({kind:'amzdrop'},b||{})),env))).body;

console.log('=== 対象の条件（AMZD_SQL）===');
await setCfg({});
await seed('B07MLZ2JKF');                                  // 対象（-C）
await seed('B0ONHAND001',{ on_hand:1 });                   // 手元在庫あり
await seed('B0FBA000001',{ fba_av:2, fba_seen:now });       // FBA にある
await seed('B0INBOUND01',{ fba_av:0, fba_in:1, fba_seen:now }); // 入庫中
await seed('B0RESERVE01',{ fba_av:0, fba_res:1, fba_seen:now }); // 予約済み
await seed('B0MWDROP001',{ sku:'W-4902370550467', cond:'new' }); // MW の無在庫
await seed('B0DROP00001',{ dropship:1, cond:'new' });       // 無在庫の印
await seed('B0QTY000001',{ qty:0 });                        // 数量0
let r=await job();
console.log('   '+JSON.stringify({seen:r.seen,keep:r.keep,zero:r.zero,
  err:r.error||'',note:(r.notes||[]).join('/').slice(0,160),
  plan:(r.plan||[]).map((x)=>x.asin)}));
ok(r.ok===true&&r.mode==='plan','★既定は「予定だけ」');
ok(r.seen===1&&(r.plan||[])[0].asin==='B07MLZ2JKF',
   '★★★対象は「手元にも FBA にも無い・MW でない・数量1以上」の行だけ');
ok((r.plan||[])[0].act==='keep','★★★既定は「Amazon 無在庫で続ける」');
let a=await row('B07MLZ2JKF');
ok(Number(a.amz_drop||0)===0,'★★★予定だけのときは何も変えない');
console.log('   知らせ: '+notes.join(' / ').slice(0,160));
ok(/在庫の根拠がない出品（予定だけ）/.test(notes.join('')),
   '★★★Discord に一覧を出す');
ok(/実行.*にすると切り替えます/.test(notes.join('')),'★★どうすれば実行できるかも書く');
notes=[];
await job();
ok(notes.length===0,'★★★予定の知らせは1日1回（毎時鳴らさない）');

console.log('\n=== 実行に切り替える ===');
await setCfg({ amzDropMode:'on' });
notes=[];
r=await job();
console.log('   '+JSON.stringify({mode:r.mode,done:r.done,zeroed:r.zeroed}));
a=await row('B07MLZ2JKF');
console.log('   '+JSON.stringify(a));
ok(r.done===1,'★★★切り替える');
ok(Number(a.amz_drop)===1&&Number(a.restocking)===1,
   '★★★amz_drop と restocking を立てる（値段の追従は再調達の仕組み）');
ok(Number(a.ebay_qty)===1,'★★数量はそのまま（0にしない）');
ok(/Amazon 無在庫に切り替えました/.test(notes.join('')),'★★Discord に出す');
r=await job();
ok(r.seen===0,'★★★切り替えた行は、もう対象に出てこない');

console.log('\n=== 続けられない行は数量0にする ===');
await setCfg({ amzDropMode:'plan' });
await seed('B0NOOFFER01',{ low:0, cond:'used', sku:'E-B0NOOFFER01-U' });
await env.DB.prepare(
  `UPDATE items SET amazon_lowest=NULL, amazon_offers=0, amazon_offers_json='[]'
     WHERE asin='B0NOOFFER01'`).run();
await seed('B0OLDLOW001',{ low_at:old, cond:'used', sku:'E-B0OLDLOW001-U' });
r=await job();
const by={}; (r.plan||[]).forEach((x)=>{ by[x.asin]=x; });
console.log('   '+JSON.stringify(by));
ok(by['B0NOOFFER01']&&by['B0NOOFFER01'].act==='zero'
   &&/出品がありません/.test(by['B0NOOFFER01'].why),
   '★★★Amazon に出品が無い行は数量0');
ok(by['B0OLDLOW001']&&by['B0OLDLOW001'].act==='zero'
   &&/古い/.test(by['B0OLDLOW001'].why),
   '★★★最安値が24時間以上取れない行も数量0');

console.log('\n=== 値段の追従（rkTarget）===');
/* Amazon 無在庫の行は、最安値が古くなったら数量0にする。
   再調達中（amz_drop でない）の行は今までどおり触らない。 */
const base={ scope:'ebay', ebay_item_id:'1', ebay_qty:1, ebay_price:40,
  restocking:1, one_off:0, dropship:0, ebay_sale:0, amazon_offers:3,
  amazon_lowest:3000, rk_want:45, rk_want_at:now, rk_n:3, rk_floor:30 };
let t1=W.rkTarget(Object.assign({},base,{ amazon_lowest_at:old }));
console.log('   再調達中（古い）: '+JSON.stringify(t1));
ok(t1.kind===''&&/古い/.test(t1.why),'★★再調達中は、古いだけでは触らない');
let t2=W.rkTarget(Object.assign({},base,{ amazon_lowest_at:old, amz_drop:1 }));
console.log('   Amazon無在庫（古い）: '+JSON.stringify(t2));
ok(t2.kind==='zero'&&/24時間以上/.test(t2.why),
   '★★★Amazon 無在庫は、最安値が24時間取れなければ数量0');
let t3=W.rkTarget(Object.assign({},base,{ amazon_lowest_at:now, amz_drop:1,
  rk_want:20, rk_floor:30 }));
console.log('   Amazon無在庫（下限割れ）: '+JSON.stringify(t3));
ok(t3.kind==='zero'&&/下限利益/.test(t3.why),
   '★★★Amazon 無在庫は、下限利益を割るなら数量0');
let t4=W.rkTarget(Object.assign({},base,{ amazon_lowest_at:now,
  rk_want:20, rk_floor:30 }));
ok(t4.kind==='down'&&t4.under===true,
   '★★再調達中は今までどおり下限で止める（数量0にしない）');
let t5=W.rkTarget(Object.assign({},base,{ amazon_lowest_at:now, amz_drop:1,
  rk_want:50 }));
ok(t5.kind==='up'&&t5.to===50,'★★★ふだんは最安値に合わせて売値を直す');

console.log('\n=== 3時間ごとの最安値に入る ===');
const w=W.pricingHotWhere();
ok(/FROM amz_drop/.test(w),
   '★★★Amazon 無在庫の行も3時間ごとの最安値の対象に入る');
/* 実際に拾えるか（印の付いた行）。 */
const hot=await env.DB.prepare(
  `SELECT asin FROM items WHERE ${W.pricingHotWhere()}`).all();
console.log('   '+JSON.stringify((hot.results||[]).map((x)=>x.asin)));
ok((hot.results||[]).some((x)=>x.asin==='B07MLZ2JKF'),
   '★★★切り替えた行が実際に対象に入る');

console.log('\n=== 売れたときの知らせ ===');
const txt=W.EV_TEXT.EBAY_SOLD({ title:'ヨッシークラフトワールド', amz_drop:1,
  asin:'B07MLZ2JKF', cond:'cart', low:3480, ship_by:'2026-11-10T00:00:00Z',
  days:3 });
console.log('   '+txt);
ok(/要仕入れ/.test(txt)&&/Amazon 無在庫/.test(txt),'★★★「要仕入れ」と出す');
ok(/B07MLZ2JKF/.test(txt)&&/amazon\.co\.jp\/dp\/B07MLZ2JKF/.test(txt),
   '★★★ASIN とリンクを出す');
ok(/¥3480/.test(txt),'★★Amazon最安値を出す');
ok(/中古（可を除く）以上/.test(txt),'★★★どの状態で買えばよいかを出す');
ok(/ハンドリング期限/.test(txt),'★★発送期限を出す');
const txt2=W.EV_TEXT.EBAY_SOLD({ title:'ふつうの行', fba_available:0, ebay_qty:1 });
ok(!/要仕入れ/.test(txt2),'★ふつうの行は今までどおり');

console.log('\n=== 作業者のキー ===');
const st=await worker.fetch(new Request('https://x/listings',
  {method:'POST',headers:{'X-PJ-Key':'staff-key-123','content-type':'application/json'},
   body:JSON.stringify({items:[{asin:'B07MLZ2JKF',cond:'cart',amz_drop:1}]})}),
  makeEnv({ STAFF_KEY:'staff-key-123' }));
ok(st.status===403,'★★★作業者用のキーでは切り替えられない（値段が動くため）');
await T.done();
