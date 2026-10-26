/* Worker：段取り D — MW の無在庫を守る（7.72）
   eBay の出品と MW は CustomLabel W-<JAN> で結ぶ（items に JAN の列は無い）。
   ・欠品（CSV から消えた・在庫0）→ 数量0
   ・卸値が上がって下限利益を割る → 売値を上げる。相場の115%超なら数量0
   ・卸値が下がった → 何もしない（自動値下げに任せる）
   ・欠品から戻って利益も出る → 数量1
   ・既定は「確認してから」。approve:true で実際に書き込む
   ・売れたら「MW に注文してください」を出す */
import { harness, loadWorker, makeEnv, asJson } from './lib.mjs';
const T=harness('Worker：段取り D（MW無在庫）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwdrop');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  EBAY_CLIENT_ID:'ci', EBAY_CLIENT_SECRET:'cs', EBAY_REFRESH_TOKEN:'rt',
  LWA_CLIENT_ID:'a', LWA_CLIENT_SECRET:'b', LWA_REFRESH_TOKEN:'c' });
let sent=[], notes=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u);
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),{status:200});
  if(/ws\/api\.dll/.test(url)){
    const call=(i.headers||{})['X-EBAY-API-CALL-NAME'];
    sent.push({ call:call, body:String(i.body||'') });
    return new Response('<?xml version="1.0"?><ReviseInventoryStatusResponse>'
      +'<Ack>Success</Ack></ReviseInventoryStatusResponse>',{status:200});
  }
  if(/discord/.test(url)){
    notes.push(JSON.parse(i.body).content||'');
    return new Response(null,{status:204});
  }
  throw new Error('外へ出てはいけない: '+url);
};
const post=async(body,key)=>asJson(await worker.fetch(new Request('https://x/sync',
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
/* 設定（下限利益1000・連動率30%・為替160・請求送料15ドル） */
await env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('settings',?1,'x')`)
  .bind(JSON.stringify({ fx:160, fxc:2, fee:13.6, intlFee:1.35, autoAdRate:6,
    feeTax:10, fixed:0.40, pack:150, shipCharge:15, usTaxRate:8,
    baseProfit:1000, linkRate:30, saleRate:15, targetMode:'auto',
    mwShipFee:176 })).run();
/* MW の在庫（代表）と相場 */
const mw=async(jan,x)=>await env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,list_price,release,cond,wholesale,
     stock,note,ship_text,ship_days,row_hash,pick,seen_at,gone_at,created_at)
   VALUES (?1,?2,0,'NS',?3,5000,'2025/01/01','新品',?4,?5,'','即日出荷',0,'h',1,'x',?6,'x')`)
  .bind(jan,x.sha||'M200',x.name||(jan+'の商品'),x.whole,x.stock,x.gone||null).run();
const mkt=async(jan,low)=>await env.DB.prepare(
  `INSERT INTO mw_market (jan,n,n_new,low,low_any,checked_at,created_at)
   VALUES (?1,3,3,?2,?2,'x','x')`).bind(jan,low).run();
/* eBay に出ている MW の出品（CustomLabel が W-<JAN>） */
const item=async(asin,jan,x)=>await env.DB.prepare(
  `INSERT INTO items (asin,cond,scope,title,ebay_item_id,ebay_sku,ebay_qty,
     ebay_price,weight_g,updated_at)
   VALUES (?1,'new','ebay',?2,?3,?4,?5,?6,150,'x')`)
  .bind(asin,x.title||'MWの出品','18000'+x.n,'W-'+jan,x.qty,x.price).run();

console.log('=== SKU から JAN を読む ===');
ok(W.mwJanOfSku('W-4902370550467')==='4902370550467','★★W-<JAN> から JAN を読む');
ok(W.mwJanOfSku('E-B00ABCDEFG')===''&&W.mwJanOfSku('M-B00ABCDEFG')==='',
   '★★ほかの出品（E-／M-）は対象にしない');
ok(W.mwJanOfSku('W-49023705504')==='','★13桁でないものは読まない');

console.log('\n=== 判定（mwDropPlan）===');
const PR=(await import('file:///home/user/pj_price/shared/pricing.js')).default;
const S=PR.settings({ fx:160, fxc:2, fee:13.6, intlFee:1.35, adRate:6, feeTax:10,
  fixed:0.40, pack:150, shipCharge:15, usTaxRate:8, baseProfit:1000,
  linkRate:30, saleRate:15, targetMode:'auto' });
S.mwShipFee=176;
const base=PR.priceFor(S,Math.round(3000*1.1)+176,150,0);
console.log('   卸値3000円 → 目標利益の売値 $'+base.price+'／下限 $'+base.floor);
let p1=W.mwDropPlan(S,{ebay_qty:1,ebay_price:base.price,weight_g:150,prefix:'game'},
  {stock:5,wholesale:3000,gone_at:null},{low:200,low_any:200,n:3});
ok(p1.act==='','★★問題なければ何もしない');
let p2=W.mwDropPlan(S,{ebay_qty:1,ebay_price:base.price,weight_g:150},
  null,{low:200,n:3});
ok(p2.act==='zero'&&/欠品/.test(p2.why),'★★★MW から消えたら数量0');
let p3=W.mwDropPlan(S,{ebay_qty:1,ebay_price:base.price,weight_g:150},
  {stock:5,wholesale:3000,gone_at:'2026-10-29T00:00:00Z'},{low:200,n:3});
ok(p3.act==='zero','★★gone_at が入っていたら数量0');
let p4=W.mwDropPlan(S,{ebay_qty:1,ebay_price:base.price,weight_g:150},
  {stock:0,wholesale:3000,gone_at:null},{low:200,n:3});
ok(p4.act==='zero'&&/在庫が0/.test(p4.why),'★★在庫0でも数量0');
/* 卸値が上がった（3000→9000）。いまの売値では下限を割る */
let p5=W.mwDropPlan(S,{ebay_qty:1,ebay_price:base.price,weight_g:150},
  {stock:5,wholesale:9000,gone_at:null},{low:400,low_any:400,n:3});
console.log('   卸値9000円: '+JSON.stringify(p5));
ok(p5.act==='up'&&p5.to>base.price,'★★★卸値が上がったら売値を上げる');
ok(/卸値が上がった/.test(p5.why),'★理由を出す');
/* 上げると相場の115%を超える → 数量0 */
let p6=W.mwDropPlan(S,{ebay_qty:1,ebay_price:base.price,weight_g:150},
  {stock:5,wholesale:9000,gone_at:null},{low:40,low_any:40,n:3});
console.log('   相場が安いとき: '+JSON.stringify(p6));
ok(p6.act==='zero'&&/115%/.test(p6.why),
   '★★★上げると相場の115%を超えるなら数量0');
/* 卸値が下がった → 何もしない（自動値下げに任せる） */
let p7=W.mwDropPlan(S,{ebay_qty:1,ebay_price:base.price,weight_g:150},
  {stock:5,wholesale:1000,gone_at:null},{low:200,n:3});
ok(p7.act==='','★★★卸値が下がっても何もしない（自動値下げに任せる）');
/* 欠品から戻った（数量0） */
let p8=W.mwDropPlan(S,{ebay_qty:0,ebay_price:base.price,weight_g:150},
  {stock:5,wholesale:3000,gone_at:null},{low:200,n:3});
ok(p8.act==='relist'&&p8.qty===1,'★★★戻って利益も出るなら数量1');
let p9=W.mwDropPlan(S,{ebay_qty:0,ebay_price:1,weight_g:150},
  {stock:5,wholesale:3000,gone_at:null},{low:200,n:3});
ok(p9.act==='restock'&&p9.to>1&&p9.qty===1,
   '★★いまの売値が下限を割るなら、売値を直して数量1');
let p10=W.mwDropPlan(S,{ebay_qty:0,ebay_price:1,weight_g:150},
  {stock:5,wholesale:9000,gone_at:null},{low:40,n:3});
ok(p10.act===''&&/戻せません/.test(p10.why),
   '★★相場が安すぎて戻せない行は何もしない（理由を残す）');
/* 相場が無い行は上限を見ない */
let p11=W.mwDropPlan(S,{ebay_qty:1,ebay_price:base.price,weight_g:150},
  {stock:5,wholesale:9000,gone_at:null},null);
ok(p11.act==='up','★★相場が無ければ上限で止めない（上げる）');

console.log('\n=== 確認モード（既定）===');
await mw('4902370550467',{whole:3000,stock:5});
await mw('4580416924740',{whole:9000,stock:5,sha:'MC02'});
await mw('4988611224878',{whole:3000,stock:5,gone:'2026-10-29T00:00:00Z'});
await mkt('4902370550467',200); await mkt('4580416924740',400);
await mkt('4988611224878',200);
await item('B00W000001','4902370550467',{n:1,qty:1,price:base.price});
await item('B00W000002','4580416924740',{n:2,qty:1,price:base.price});
await item('B00W000003','4988611224878',{n:3,qty:1,price:base.price});
/* MW ではない出品（対象外） */
await env.DB.prepare(
  `INSERT INTO items (asin,cond,scope,title,ebay_item_id,ebay_sku,ebay_qty,
     ebay_price,updated_at) VALUES ('B00OTHER01','used','ebay','ほかの出品',
     '180009','E-B00OTHER01-U',1,30,'x')`).run();
sent=[]; notes=[];
let r=await post({ kind:'mwdrop' });
console.log('   '+JSON.stringify({mode:r.body.mode,picked:r.body.picked,
  zero:r.body.zero,up:r.body.up,relist:r.body.relist,restock:r.body.restock}));
ok(r.body.ok===true,'★★通る');
ok(r.body.mode==='confirm','★★既定は「確認してから」');
ok(r.body.picked===3,'★★W- の出品だけを見る（ほかの出品は見ない）');
ok(r.body.zero===1&&r.body.up===1,'★★欠品1件・値上げ1件');
ok(sent.length===0,'★★★確認モードでは eBay を1回も呼ばない');
ok(notes.length===1&&/まだ変えていません/.test(notes[0]),
   '★★予定を Discord に出す（変えていないと断る）');
let q=await env.DB.prepare(
  "SELECT ebay_qty FROM items WHERE asin='B00W000003'").first();
ok(q.ebay_qty===1,'★★確認モードでは D1 も変えない');

console.log('\n=== 実行（approve）===');
sent=[]; notes=[];
r=await post({ kind:'mwdrop', approve:true });
console.log('   '+JSON.stringify({zero:r.body.zero,up:r.body.up,
  failed:r.body.failed}));
console.log('   送った呼び出し: '+sent.map((x)=>x.call).join(','));
ok(r.body.mode==='auto','★実行モード');
ok(sent.length>=1&&sent.every((x)=>x.call==='ReviseInventoryStatus'),
   '★★★書き込みは ReviseInventoryStatus だけ');
ok(/<Quantity>0<\/Quantity>/.test(sent.map((x)=>x.body).join('')),
   '★★★欠品の行は数量0を送る');
ok(/<StartPrice/.test(sent.map((x)=>x.body).join('')),
   '★★値上げの行は売値を送る');
q=await env.DB.prepare(
  "SELECT ebay_qty FROM items WHERE asin='B00W000003'").first();
ok(q.ebay_qty===0,'★★★D1 の数量も0になる');
q=await env.DB.prepare(
  "SELECT ebay_price FROM items WHERE asin='B00W000002'").first();
ok(q.ebay_price>base.price,'★★★D1 の売値も上がる');
q=await env.DB.prepare(
  "SELECT ebay_price,ebay_qty FROM items WHERE asin='B00W000001'").first();
ok(q.ebay_qty===1&&Math.abs(q.ebay_price-base.price)<0.01,
   '★★問題ない行は触らない');
ok(notes.length===1&&!/まだ変えていません/.test(notes[0]),'★実行は実行として出す');
console.log('   '+notes[0].split('\n').slice(0,4).join(' / '));

console.log('\n=== 戻った行の数量1 ===');
await env.DB.prepare(
  "UPDATE mw_stock SET gone_at=NULL WHERE jan='4988611224878'").run();
sent=[]; notes=[];
r=await post({ kind:'mwdrop', approve:true });
console.log('   '+JSON.stringify({relist:r.body.relist,restock:r.body.restock}));
ok(r.body.relist+r.body.restock===1,'★★★戻った行を数量1にする');
ok(/<Quantity>1<\/Quantity>/.test(sent.map((x)=>x.body).join('')),
   '★★数量1を送る');
q=await env.DB.prepare(
  "SELECT ebay_qty FROM items WHERE asin='B00W000003'").first();
ok(q.ebay_qty===1,'★D1 も1に戻る');

console.log('\n=== 1回の件数の上限 ===');
r=await post({ kind:'mwdrop', limit:1 });
ok(r.body.rows.length<=1,'★★上限で切る');
ok(W.MW_D_MAX===60,'★上限の既定は60件');
ok(W.MW_D_OVER===1.15,'★相場の上限は115%');

console.log('\n=== 売れたら「MW に注文してください」===');
notes=[];
const run={ kind:'t', subrequests:0, pages:0, errors:0, notes:[], rows:0 };
let n=await W.mwOrderNotify(env,run,[
  { sku:'W-4902370550467', qty:1, orderedAt:'2026-10-30T00:00:00Z', hand:10 },
  { sku:'E-B00OTHER01-U', qty:1, orderedAt:'2026-10-30T00:00:00Z' },
  { sku:'W-4999999999994', qty:1, orderedAt:'2026-10-30T00:00:00Z' }]);
console.log('   '+notes[0]);
ok(n===2,'★★W- の行だけを対象にする');
ok(/MW に注文してください/.test(notes[0]),'★★★見出し');
ok(/JAN 4902370550467/.test(notes[0]),'★★★JAN を出す');
ok(/社 \*\*M200\*\*/.test(notes[0]),'★★★社を出す');
ok(/卸値 ¥3,000/.test(notes[0]),'★★★卸値を出す');
ok(/MW出荷 0営業日/.test(notes[0]),'★★★出荷日を出す');
ok(/注文の期限 2026-11-0/.test(notes[0]),'★★★注文の期限を出す（日本時間の日付）');
ok(/在庫に見つかりません/.test(notes[0]),'★★MW に無い JAN はそう書く');
ok(/2週間の取り置き/.test(notes[0])&&/銀行振込/.test(notes[0]),
   '★★注文のしかたも書く');

console.log('\n=== 作業者のキー ===');
r=await post({ kind:'mwdrop' },'staff-key-123');
ok(r.status===403,'★★作業者では走らせられない（価格と数量を動かすため）');

await T.done();
