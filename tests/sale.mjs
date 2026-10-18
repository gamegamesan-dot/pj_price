/* Worker：eBayのセール中の出品（7.43）
   ・ActiveList の SellingStatus.PromotionalSaleDetails から
     セール前の値段（OriginalPrice）と終わる時刻（EndTime）を取って残す
   ・セールが終わったら印を 0 に戻す（値上げ・値下げの対象に自動で戻す）
   ・エラー 21919248（セール中で変えられない）は「失敗」に数えず、
     印を立てて対象から外す。連続失敗の回数も増やさない
   ・自動値下げも同じ（セールの値引きと二重に下がるのを防ぐ）
   ・いまの売値（CurrentPrice）はセール後の値段なので、利益はそのまま計算してよい */
import { harness, loadWorker, makeEnv, post, asJson } from './lib.mjs';
const T=harness('Worker：eBayのセール中の出品');
const ok=T.ok;
const { worker, T:W }=await loadWorker('sale');
const env=makeEnv();
const now=new Date().toISOString();

/* eBay への通信を差し替える。
   active … GetMyeBaySelling が返す ActiveList の中身
   fail   … その ItemID を失敗させ、err の内容でエラーを返す */
let calls=[], active=[], fail={}, err={code:'21919248',
  short:'Price cannot be revised while the item is in a promotional sale.'};
const itemXml=(x)=>'<Item><ItemID>'+x.id+'</ItemID><SKU>'+x.sku+'</SKU>'
  +'<Title>'+x.sku+'の商品</Title><Quantity>1</Quantity>'
  +'<SellingStatus><QuantitySold>0</QuantitySold>'
  +'<CurrentPrice currencyID="USD">'+x.price+'</CurrentPrice>'
  +(x.sale
    ? ('<PromotionalSaleDetails>'
       +(x.orig?('<OriginalPrice currencyID="USD">'+x.orig+'</OriginalPrice>'):'')
       +(x.end?('<EndTime>'+x.end+'</EndTime>'):'')
       +'</PromotionalSaleDetails>')
    :'')
  +'</SellingStatus>'
  +'<ListingDetails><StartTime>'+now+'</StartTime></ListingDetails>'
  +'<QuantityAvailable>1</QuantityAvailable></Item>';
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/ws\/api\.dll/.test(url)){
    const name=(o.headers||{})['X-EBAY-API-CALL-NAME']||'';
    const body=String(o.body||'');
    calls.push({name:name,body:body});
    if(name==='GetMyeBaySelling')
      return new Response('<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>'
        +'<PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages>'
        +'</PaginationResult><ItemArray>'
        +active.map(itemXml).join('')+'</ItemArray></ActiveList>'
        +'</GetMyeBaySellingResponse>',
        {status:200,headers:{'content-type':'text/xml'}});
    const ids=(body.match(/<ItemID>(\d+)<\/ItemID>/g)||[]).map((x)=>x.replace(/\D/g,''));
    const bad=ids.filter((x)=>fail[x]), okIds=ids.filter((x)=>!fail[x]);
    if(name==='ReviseFixedPriceItem')
      return new Response('<ReviseFixedPriceItemResponse><Ack>'
        +(bad.length?'Failure':'Success')+'</Ack>'
        +(bad.length?('<Errors><ErrorCode>'+err.code+'</ErrorCode>'
          +'<ShortMessage>'+err.short+'</ShortMessage></Errors>'):'')
        +'</ReviseFixedPriceItemResponse>',
        {status:200,headers:{'content-type':'text/xml'}});
    /* ReviseInventoryStatus は4件まとめて送るので、どの行のエラーかを
       ErrorParameters の ItemID で返す（本物と同じ形）。 */
    return new Response('<ReviseInventoryStatusResponse><Ack>'
      +(bad.length?'Warning':'Success')+'</Ack>'
      +bad.map((x)=>'<Errors><ErrorCode>'+err.code+'</ErrorCode>'
        +'<ShortMessage>'+err.short+'</ShortMessage>'
        +'<ErrorParameters ParamID="0"><Value>'+x+'</Value></ErrorParameters>'
        +'</Errors>').join('')
      +okIds.map((x)=>'<InventoryStatus><ItemID>'+x+'</ItemID></InventoryStatus>').join('')
      +'</ReviseInventoryStatusResponse>',
      {status:200,headers:{'content-type':'text/xml'}});
  }
  if(/discord/.test(url))return new Response('',{status:204});
  throw new Error('想定外の通信: '+url);
};

let seq=0;
async function seed(asin,extra){
  seq++;
  const d=Object.assign({cond:'used',scope:'ebay',ebay_item_id:String(880100+seq),
    ebay_qty:1,ebay_price:20,rv_want:25,rv_floor:18,rv_kind:'none',rv_max_cost:3000,
    rv_fail:0,md_done:0,md_step:1,md_floor:12,md_start:20,md_n:10,mark_stop:0,
    one_off:0,dropship:0,restocking:0,ebay_sale:0,
    fba_available:1,mark_at:null},extra||{});
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,rv_want,rv_floor,rv_kind,rv_max_cost,rv_at,rv_fail,
    md_done,md_step,md_floor,md_start,md_n,mark_stop,mark_at,one_off,dropship,restocking,
    ebay_sale,fba_available,fba_inbound,fba_reserved,fba_seen_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?9,?14,?15,?16,?17,?18,?19,?20,
            ?21,?22,?23,?24,?25,?26,0,0,?9,?9)`)
    .bind(asin,d.cond,d.scope,asin+'の商品','E-'+asin+'-U',d.ebay_item_id,d.ebay_qty,
      d.ebay_price,now,d.rv_want,d.rv_floor,d.rv_kind,d.rv_max_cost,d.rv_fail,d.md_done,
      d.md_step,d.md_floor,d.md_start,d.md_n,d.mark_stop,d.mark_at,d.one_off,d.dropship,
      d.restocking,d.ebay_sale,d.fba_available).run();
  return d.ebay_item_id;
}
const row=async(asin)=>await env.DB.prepare(
  `SELECT ebay_price,ebay_qty,ebay_sale,ebay_sale_orig,ebay_sale_end,rv_fail,
          revise_err,md_done,mark_at FROM items WHERE asin=?1`).bind(asin).first();
const wipe=async()=>{
  await env.DB.prepare('DELETE FROM items').bind().run();
  await env.DB.prepare('DELETE FROM rv_log').bind().run();
  await env.DB.prepare('DELETE FROM rv_runs').bind().run();
  await env.DB.prepare('DELETE FROM md_runs').bind().run();
};
let atSeq=0;
const setCfg=async(o)=>await asJson(await worker.fetch(post('/settings',
  {at:new Date(Date.now()+(++atSeq)*1000).toISOString(),
   settings:Object.assign({autoRvMode:'auto',autoRvMax:'50',autoRvPct:'30',
     csvReviewAbs:'1',csvReviewPct:'3',autoMdMode:'off',autoMdDays:'3',
     autoMdMax:'50',autoMdStep:'5'},o||{})}),env));
const rv=async()=>(await asJson(await worker.fetch(
  post('/sync',{kind:'review'}),env))).body;
const md=async()=>(await asJson(await worker.fetch(
  post('/sync',{kind:'markdown'}),env))).body;

console.log('=== セールの中身を取り込む ===');
await wipe();
await seed('B0SAL00001');
const end=new Date(Date.now()+3*86400000).toISOString();
active=[{id:'880101',sku:'E-B0SAL00001-U',price:'18.00',sale:true,
         orig:'24.00',end:end}];
await W.syncEbayActive(env,W.newRun('ebay'));
let r=await row('B0SAL00001');
console.log('   '+JSON.stringify(r));
ok(Number(r.ebay_sale)===1,'★★セール中の出品に印を立てる');
ok(Number(r.ebay_sale_orig)===24,'★★セール前の値段（OriginalPrice）を残す');
ok(String(r.ebay_sale_end).slice(0,10)===end.slice(0,10),'★★終わる時刻も残す');
ok(Number(r.ebay_price)===18,
   '★★いまの売値はセール後の値段（CurrentPrice）。利益はこれで計算する');

console.log('\n=== セールが終わったら自動で対象に戻す ===');
active=[{id:'880101',sku:'E-B0SAL00001-U',price:'24.00',sale:false}];
await W.syncEbayActive(env,W.newRun('ebay'));
r=await row('B0SAL00001');
console.log('   '+JSON.stringify(r));
ok(Number(r.ebay_sale)===0,'★★セールが終われば印を消す（次の取り込みで対象に戻る）');
ok(r.ebay_sale_orig===null&&r.ebay_sale_end===null,'★セールの中身も消す');
ok(Number(r.ebay_price)===24,'★売値は元に戻っている');

console.log('\n=== とばす決まり（印が立っている間）===');
console.log('   rvSkip: '+W.rvSkip({ebay_item_id:'1',ebay_sale:1,ebay_qty:1,rv_want:25,
  ebay_price:20},{pct:30}));
console.log('   mdSkip: '+W.mdSkip({ebay_item_id:'1',ebay_sale:1,ebay_qty:1,md_step:1,
  md_floor:10,ebay_price:20},{days:3},now));
ok(/セール中/.test(W.rvSkip({ebay_item_id:'1',ebay_sale:1,ebay_qty:1,rv_want:25,
  ebay_price:20},{pct:30})),'★値上げはセール中の行をとばす');
ok(/セール中/.test(W.mdSkip({ebay_item_id:'1',ebay_sale:1,ebay_qty:1,md_step:1,
  md_floor:10,ebay_price:20},{days:3},now)),
   '★★自動値下げもセール中の行をとばす（二重に下がるのを防ぐ）');

console.log('\n=== 21919248 は「失敗」に数えない（値上げ）===');
await wipe();
await setCfg({autoRvMode:'auto'});
const idA=await seed('B0SAL00002');            // ふつうに上がる行
const idB=await seed('B0SAL00003');            // セール中で変えられない行
fail={}; fail[idB]=1;
err={code:'21919248',
     short:'Price cannot be revised while the item is in a promotional sale.'};
calls=[];
let res=await rv();
console.log('   '+JSON.stringify({changed:res.changed,failed:res.failed,
  sale:res.sale,skipped:res.skipped}));
const a=await row('B0SAL00002'), b=await row('B0SAL00003');
console.log('   上がった行: '+JSON.stringify(a));
console.log('   セールの行: '+JSON.stringify(b));
ok(res.changed===1&&res.failed===0&&res.sale===1,
   '★★セール中の行は失敗に数えず、別に数える');
ok(Number(b.ebay_sale)===1,'★★「セール中」の印を立てる');
ok(Number(b.rv_fail)===0,'★★連続失敗の回数は増やさない');
ok(!b.revise_err,'★★エラーとして残さない（人が直すものではない）');
ok(Number(a.ebay_price)===25&&Number(a.rv_fail)===0,'★同じ回のほかの行はふつうに上がる');
const log=await env.DB.prepare(
  `SELECT asin,ok,why FROM rv_log WHERE asin='B0SAL00003'`).first();
console.log('   記録: '+JSON.stringify(log));
ok(/セール中/.test(String(log.why||'')),'★記録には理由を残す');

console.log('\n=== 次の回はもう送らない ===');
calls=[];
res=await rv();
console.log('   '+JSON.stringify({changed:res.changed,skipped:res.skipped,
  calls:calls.filter(c=>c.name==='ReviseInventoryStatus').length}));
ok(!calls.some((c)=>c.name==='ReviseInventoryStatus'&&c.body.indexOf(idB)>=0),
   '★★印が立っている間は eBay に送らない');

console.log('\n=== ほかのエラーは今までどおり失敗 ===');
await wipe();
const idC=await seed('B0SAL00004');
fail={}; fail[idC]=1;
err={code:'21919188',short:'この出品は変えられません'};
res=await rv();
const c=await row('B0SAL00004');
console.log('   '+JSON.stringify({failed:res.failed,sale:res.sale,
  rv_fail:c.rv_fail,err:String(c.revise_err||'').slice(0,40),sale_flag:c.ebay_sale}));
ok(res.failed===1&&res.sale===0,'★★セール以外のエラーは失敗のまま');
ok(Number(c.rv_fail)===1&&/21919188/.test(String(c.revise_err||'')),
   '★★連続失敗の回数と理由を残す');
ok(Number(c.ebay_sale)===0,'★★セールの印は立てない（取り違えない）');

console.log('\n=== 自動値下げも同じ ===');
await wipe();
await setCfg({autoRvMode:'off',autoMdMode:'on',autoMdDays:'0'});
const idD=await seed('B0SAL00005',{ebay_price:20,md_step:1,md_floor:12,md_done:1,
  mark_at:new Date(Date.now()-10*86400000).toISOString()});
fail={}; fail[idD]=1;
err={code:'21919248',short:'Price cannot be revised while the item is in a sale.'};
res=await md();
const d=await row('B0SAL00005');
console.log('   '+JSON.stringify({changed:res.changed,failed:res.failed,sale:res.sale}));
console.log('   '+JSON.stringify(d));
ok(res.failed===0&&res.sale===1,'★★自動値下げでも失敗に数えない');
ok(Number(d.ebay_sale)===1&&!d.revise_err,'★★印を立て、エラーとしては残さない');
ok(Number(d.md_done)===1&&Number(d.ebay_price)===20,
   '★値下げの回数も値段も進めない');

T.done();
