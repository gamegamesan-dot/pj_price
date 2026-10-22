/* Worker：売れた値段で保ち、同じ値段で再出品する（7.53）
   ・eBay で売れたら sold_keep を立て、そのときの**出品価格**を控える
     （落札額は使わない）。初めて見た明細だけ
   ・自動値下げは止まる（一度も値下げしていない行も止まる＝穴①）
   ・売値の自動反映の**値上げも止まる**（穴②）
   ・数量0の行を同じ値段のまま数量1に戻す。条件は shared/pricing.js の skRelist
   ・一点物／無在庫／再調達中／セール中／フェイズBの予定は対象外
   ・FBA在庫・手元在庫があれば仕入れ値は見ない。無ければ仕入れ値（24時間以内・
     その値で下限利益が残る）を見る
   ・1日30件（再調達とは別枠）・二重実行の防止・書き込み前後の GetItem
   ・「確認してから」では eBay を呼ばず、approve で実行
   ・値下げの再開（sold_keep=0）で mark_at と md_done が消える */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
import PRICING from '../shared/pricing.js';
const T=harness('Worker：売れた値段で再出品');
const ok=T.ok;
const { worker, T:W }=await loadWorker('soldkeep');
const env=makeEnv({ STAFF_KEY:'staff-key-123' });
const now=new Date().toISOString();
const ago=(ms)=>new Date(Date.now()-ms).toISOString();
const DAY=24*60*60*1000;

let calls=[], listing={}, fail={}, errText='', notes=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/open\.er-api\.com/.test(url))
    return new Response(JSON.stringify({rates:{JPY:160}}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/ws\/api\.dll/.test(url)){
    const name=(o.headers||{})['X-EBAY-API-CALL-NAME']||'';
    const body=String(o.body||'');
    calls.push({name:name,body:body});
    if(name==='GetItem'){
      const id=(/<ItemID>(\d+)<\/ItemID>/.exec(body)||[])[1]||'';
      const l=listing[id]||{qty:0,price:30,status:'Active'};
      return new Response('<GetItemResponse><Ack>Success</Ack><Item>'
        +'<ItemID>'+id+'</ItemID><Title>t</Title><Quantity>'+l.qty+'</Quantity>'
        +'<SellingStatus><QuantitySold>0</QuantitySold>'
        +'<CurrentPrice currencyID="USD">'+l.price.toFixed(2)+'</CurrentPrice>'
        +'<ListingStatus>'+l.status+'</ListingStatus></SellingStatus>'
        +'</Item></GetItemResponse>',{status:200,headers:{'content-type':'text/xml'}});
    }
    const ids=(body.match(/<ItemID>(\d+)<\/ItemID>/g)||[]).map((x)=>x.replace(/\D/g,''));
    const good=ids.filter((x)=>!fail[x]);
    good.forEach((x)=>{
      const l=listing[x]||(listing[x]={qty:0,price:30,status:'Active'});
      const q=/<Quantity>(\d+)<\/Quantity>/.exec(body);
      if(q)l.qty=Number(q[1]);
    });
    return new Response('<ReviseInventoryStatusResponse><Ack>'
      +(good.length===ids.length?'Success':'Warning')+'</Ack>'
      +(good.length===ids.length?'':('<Errors><ErrorCode>21919188</ErrorCode>'
        +'<ShortMessage>'+(errText||'だめ')+'</ShortMessage>'
        +ids.filter((x)=>fail[x]).map((x)=>'<ErrorParameters ParamID="0"><Value>'
          +x+'</Value></ErrorParameters>').join('')+'</Errors>'))
      +good.map((x)=>'<InventoryStatus><ItemID>'+x+'</ItemID></InventoryStatus>').join('')
      +'</ReviseInventoryStatusResponse>',
      {status:200,headers:{'content-type':'text/xml'}});
  }
  if(/discord/.test(url)){ notes.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response(null,{status:204}); }
  throw new Error('想定外の通信: '+url);
};
let atSeq=0;
const put=async(o)=>await asJson(await worker.fetch(post('/settings',
  {at:new Date(Date.now()+(++atSeq)*1000).toISOString(),settings:o}),env));
await put({ fx:'160', fee:'13.6', intlFee:'1.35', autoAdRate:'6', feeTax:'10',
  fixed:'0.40', pack:'150', shipCharge:'15', usTaxRate:'8', baseProfit:'1000',
  linkRate:'30', saleRate:'15', targetMode:'auto',
  syncWeightGame:'150', csvMarkStep:'1', csvMarkTimes:'10',
  autoSkMode:'confirm' });

let seq=0;
async function seed(asin,extra){
  seq++;
  const id=String(440000+seq);
  const d=Object.assign({cond:'used',ebay_item_id:id,ebay_qty:0,ebay_price:52.16,
    sold_keep:1,sold_price:52.16,sold_kept_at:ago(2*60*60*1000),
    one_off:0,one_off_known:1,dropship:0,restocking:0,on_hand:0,hand_qty:null,
    ebay_sale:null,pb_skip:0,pb_act:null,sk_fail:0,sk_act:null,
    fba_available:0,weight_g:null,cost_yen:null,
    amazon_lowest:3000,amazon_offers:3,amazon_lowest_n:2,
    amazon_offers_json:'[{"p":3000,"c":"good"},{"p":3050,"c":"good"}]',
    amazon_lowest_at:now,mw_low:null,mw_low_at:null,mw_stock:null,
    md_step:1,md_floor:40,md_n:10,md_done:3,mark_at:ago(5*DAY)},extra||{});
  listing[id]={qty:d.ebay_qty,price:d.ebay_price,status:'Active'};
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,sold_keep,sold_price,sold_kept_at,one_off,
    one_off_known,dropship,restocking,on_hand,hand_qty,ebay_sale,pb_skip,pb_act,
    sk_fail,sk_act,fba_available,fba_inbound,fba_reserved,weight_g,cost_yen,
    amazon_lowest,amazon_offers,amazon_lowest_n,amazon_offers_json,amazon_lowest_at,
    mw_low,mw_low_at,mw_stock,md_step,md_floor,md_n,md_done,mark_at,updated_at)
    VALUES (?1,?2,'ebay',?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,
            ?19,?20,?21,?22,?23,0,0,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34,?35,
            ?36,?37,?38,?8)`)
    .bind(asin,d.cond,asin+'の商品','E-'+asin+'-U',id,d.ebay_qty,d.ebay_price,now,
      d.sold_keep,d.sold_price,d.sold_kept_at,d.one_off,d.one_off_known,d.dropship,
      d.restocking,d.on_hand,d.hand_qty,d.ebay_sale,d.pb_skip,d.pb_act,d.sk_fail,
      d.sk_act,d.fba_available,d.weight_g,d.cost_yen,d.amazon_lowest,d.amazon_offers,
      d.amazon_lowest_n,d.amazon_offers_json,d.amazon_lowest_at,d.mw_low,d.mw_low_at,
      d.mw_stock,d.md_step,d.md_floor,d.md_n,d.md_done,d.mark_at).run();
  await env.DB.prepare(`INSERT INTO skus (seller_sku,asin,cond,prefix,scope,active,
    updated_at) VALUES (?1,?2,?3,'game','ebay',1,?4)`)
    .bind('E-'+asin+'-U',asin,d.cond,now).run();
  return id;
}
const row=async(asin)=>await env.DB.prepare(
  `SELECT ebay_qty,ebay_price,sold_keep,sold_price,sold_kept_at,sk_act,sk_why,
          sk_fail,sk_done_at,mark_at,md_done,ebay_sale FROM items WHERE asin=?1`)
  .bind(asin).first();
const wipe=async()=>{
  await env.DB.prepare('DELETE FROM items').bind().run();
  await env.DB.prepare('DELETE FROM skus').bind().run();
  await env.DB.prepare('DELETE FROM sk_log').bind().run();
  await env.DB.prepare('DELETE FROM sk_runs').bind().run();
};
const sk=async(b)=>(await asJson(await worker.fetch(
  post('/sync',Object.assign({kind:'soldkeep'},b||{})),env))).body;

console.log('=== 判定は shared/pricing.js に1か所（skRelist）===');
ok(typeof PRICING.skRelist==='function'&&typeof PRICING.buySource==='function',
   '★★skRelist と buySource が shared にある');
ok(W.SK_MAX===30,'★★1日の上限は30件（再調達とは別枠）');
ok(W.SK_FAIL_WARN===3&&PRICING.SK_FAIL_WARN===3,'★続けて3回失敗で外す');

console.log('\n=== 自動値下げが止まる（穴①）===');
await wipe();
/* 一度も値下げしていない行（mark_at が空）。印が無いと止まらなかった。 */
await seed('B0SK000001',{ebay_qty:1,mark_at:null,md_done:0,ebay_price:52.16});
const r1=await env.DB.prepare(`SELECT ${W.ITEM_COLS} FROM items WHERE asin=?1`)
  .bind('B0SK000001').all();
const i1=r1.results[0];
console.log('   '+W.mdSkip(i1,{days:3,max:200},ago(3*DAY)));
ok(W.mdSkip(i1,{days:3,max:200},ago(3*DAY))==='売れた値段で保っています',
   '★★一度も値下げしていない行も止まる');
const i1b=Object.assign({},i1,{sold_keep:0});
ok(W.mdSkip(i1b,{days:3,max:200},ago(3*DAY))==='',
   '★印が無ければ今までどおり値下げの対象');

console.log('\n=== 値上げも止まる（穴②）===');
const st0={abs:1,th:3,pct:30,max:50};
ok(W.rvSkip(i1,st0)==='売れた値段で保っています','★★売値の自動反映も止まる');
ok(W.rvSkip(Object.assign({},i1b,{rv_want:99,ebay_qty:1}),st0)!=='売れた値段で保っています',
   '★印が無ければ今までどおり');

console.log('\n=== 数量0の行を同じ値段で再出品 ===');
await wipe(); calls=[]; notes=[];
await seed('B0SK000010');
await put({ autoSkMode:'auto', fx:'160', fee:'13.6', autoAdRate:'6',
  baseProfit:'1000', linkRate:'30', saleRate:'15', targetMode:'auto',
  syncWeightGame:'150' });
let res=await sk();
let a=await row('B0SK000010');
console.log('   '+JSON.stringify({mode:res.mode,relisted:res.relisted,row:a}));
console.log('   送った: '+calls.map((c)=>c.name).join(','));
ok(res.mode==='auto'&&res.relisted===1,'★★自動で再出品する');
ok(a.ebay_qty===1,'★★数量が1に戻る');
ok(a.ebay_price===52.16,'★★売値は変えない（売れた値段のまま）');
ok(calls.filter((c)=>c.name==='ReviseInventoryStatus').length===1,
   '★実行は ReviseInventoryStatus');
const bd=calls.find((c)=>c.name==='ReviseInventoryStatus').body;
ok(/<Quantity>1<\/Quantity>/.test(bd)&&!/StartPrice/.test(bd),
   '★★送るのは数量だけ（売値は送らない）');
ok(calls.filter((c)=>c.name==='GetItem').length===2,
   '★★書き込みの前と後に GetItem で確かめる');
ok(a.sk_done_at&&!a.sk_act,'★実行した時刻を残し、予定を消す');
ok(/再出品/.test(notes[0]||''),'★Discord に出す');
const lg=await env.DB.prepare(
  `SELECT price,buy_low,buy_src,ok FROM sk_log WHERE asin='B0SK000010'`).first();
console.log('   記録: '+JSON.stringify(lg));
ok(lg.ok===1&&lg.price===52.16&&lg.buy_low===3000&&lg.buy_src==='amazon',
   '★★記録に売れた値段と、そのときの仕入れ値を残す');

console.log('\n=== 手持ちの在庫があれば仕入れ値は見ない ===');
await wipe(); calls=[];
/* 仕入れ値が高すぎる（下限利益を割る）が、FBA在庫がある行。 */
await seed('B0SK000020',{fba_available:2,amazon_lowest:90000,
  amazon_offers_json:'[{"p":90000,"c":"good"}]'});
await seed('B0SK000021',{on_hand:1,amazon_lowest:90000,
  amazon_offers_json:'[{"p":90000,"c":"good"}]'});
await seed('B0SK000022',{hand_qty:1,cond:'cart',amazon_lowest:90000,
  amazon_offers_json:'[{"p":90000,"c":"good"}]'});
await seed('B0SK000023',{amazon_lowest:90000,
  amazon_offers_json:'[{"p":90000,"c":"good"}]'});   // 手持ちなし → 止まる
res=await sk();
console.log('   '+JSON.stringify({relisted:res.relisted,skipped:res.skipped}));
ok(res.relisted===3,'★★FBA在庫・手元在庫・手元の数がある行は出せる');
const stk=await row('B0SK000023');
console.log('   '+stk.sk_why);
ok(stk.ebay_qty===0&&/下限利益を割ります/.test(stk.sk_why||''),
   '★★手持ちが無く仕入れ値が高い行は数量0のまま、理由を残す');

console.log('\n=== 対象外 ===');
await wipe(); calls=[];
await seed('B0SK000030',{one_off:1});
await seed('B0SK000031',{one_off_known:0});
await seed('B0SK000032',{dropship:1});
await seed('B0SK000033',{restocking:1});
await seed('B0SK000034',{ebay_sale:1});
await seed('B0SK000035',{pb_act:'restock'});
await seed('B0SK000036',{pb_skip:1});
await seed('B0SK000037',{sk_fail:3});
await seed('B0SK000038',{ebay_qty:1});             // 数量がある
await seed('B0SK000039',{sold_price:0});           // 値段が分からない
res=await sk();
console.log('   '+JSON.stringify({picked:res.picked,skipped:res.skipped,
  calls:calls.length}));
ok(res.picked===0&&calls.length===0,'★★どれも再出品しない（eBay も呼ばない）');
const w30=await row('B0SK000030'), w32=await row('B0SK000032');
ok(w30.sk_why==='一点物'&&w32.sk_why==='無在庫（いまは対象外）',
   '★★理由を行に残す');

console.log('\n=== 仕入れ値の鮮度と在庫 ===');
await wipe();
await seed('B0SK000040',{amazon_lowest_at:ago(DAY+60000)});   // 古い
await seed('B0SK000041',{amazon_lowest:0,amazon_offers:0,
  amazon_offers_json:'[]'});                                   // 在庫なし
await seed('B0SK000042',{amazon_lowest:0,amazon_offers:0,
  amazon_offers_json:'[]',amazon_lowest_at:null});             // 未取得
res=await sk();
const f40=await row('B0SK000040'), f41=await row('B0SK000041'),
      f42=await row('B0SK000042');
console.log('   '+JSON.stringify([f40.sk_why,f41.sk_why,f42.sk_why]));
ok(/古い/.test(f40.sk_why||''),'★★24時間より古い仕入れ値では出さない');
ok(/在庫がありません/.test(f41.sk_why||''),'★★仕入れ先に在庫が無い行は出さない');
ok(/未取得/.test(f42.sk_why||''),'★仕入れ値が未取得の行も出さない');

console.log('\n=== 二重実行の防止（書き込み前の GetItem）===');
await wipe(); calls=[];
const id50=await seed('B0SK000050');
listing[id50].qty=1;            // eBay 側ではすでに数量がある
res=await sk();
const f50=await row('B0SK000050');
console.log('   '+JSON.stringify({relisted:res.relisted,why:f50.sk_why}));
ok(res.relisted===0&&/数量が0ではありません/.test(f50.sk_why||''),
   '★★eBay の数量が0でなければ戻さない');
ok(calls.filter((c)=>c.name==='ReviseInventoryStatus').length===0,
   '★★書き込みもしない');

console.log('\n=== 出品が終了していたら知らせる ===');
await wipe(); calls=[]; notes=[];
const id60=await seed('B0SK000060');
listing[id60].status='Completed';
res=await sk();
const f60=await row('B0SK000060');
console.log('   '+JSON.stringify({ended:res.ended,why:f60.sk_why}));
ok(res.ended===1&&/出品が終了/.test(f60.sk_why||''),'★★終了を知らせる');
ok(/出品が終了していました/.test(notes[0]||''),'★Discord にも出す');

console.log('\n=== 失敗した行 ===');
await wipe(); calls=[]; notes=[];
const id70=await seed('B0SK000070');
await seed('B0SK000071');
fail[id70]=1; errText='この出品は変えられません';
res=await sk();
const f70=await row('B0SK000070'), f71=await row('B0SK000071');
console.log('   '+JSON.stringify({relisted:res.relisted,failed:res.failed,
  fail:f70.sk_fail,why:f70.sk_why}));
ok(res.failed===1&&res.relisted===1,'★失敗した行だけ数える');
ok(f70.sk_fail===1&&/再出品できません/.test(f70.sk_why||''),'★★理由と回数を残す');
ok(f71.ebay_qty===1,'★通った行はそのまま戻る');
fail={}; errText='';
res=await sk();
ok((await row('B0SK000070')).sk_fail===0,'★★通ったら回数を消す');

console.log('\n=== セール中のエラーは失敗に数えない ===');
await wipe(); calls=[];
const id80=await seed('B0SK000080');
fail[id80]=1; errText='21919248 Promotional Sale';
res=await sk();
const f80=await row('B0SK000080');
console.log('   '+JSON.stringify({failed:res.failed,sale:f80.ebay_sale}));
ok(res.failed===0&&f80.ebay_sale===1,'★★セール中の印を立てて対象から外す');
ok(f80.sk_fail===0,'★連続失敗の回数は増やさない');
fail={}; errText='';

console.log('\n=== 1日30件まで（再調達とは別枠）===');
await wipe(); calls=[];
for(let i=0;i<32;i++)await seed('B0SKM'+String(1000+i));
res=await sk();
console.log('   '+JSON.stringify({picked:res.picked,relisted:res.relisted,
  capped:res.capped}));
ok(res.picked===32&&res.relisted===30&&res.capped===2,'★★30件で止める');
const used=await env.DB.prepare(
  `SELECT COUNT(*) AS n FROM sk_log WHERE ok=1`).first();
ok(Number(used.n)===30,'★記録も30件');
res=await sk();
ok(res.relisted===0&&res.capped===2,'★★同じ日のうちはもう戻さない');

console.log('\n=== 「確認してから」では eBay を呼ばない ===');
await wipe(); calls=[]; notes=[];
await put({ autoSkMode:'confirm', fx:'160', fee:'13.6', autoAdRate:'6',
  baseProfit:'1000', linkRate:'30', saleRate:'15', targetMode:'auto',
  syncWeightGame:'150' });
await seed('B0SK000090');
res=await sk();
console.log('   '+JSON.stringify({mode:res.mode,picked:res.picked,
  calls:calls.length}));
ok(res.mode==='confirm'&&res.picked===1&&calls.length===0,
   '★★予定だけ立てて eBay は変えない');
ok((await row('B0SK000090')).ebay_qty===0,'★数量はそのまま');
ok((await row('B0SK000090')).sk_act==='relist','★★予定を行に残す');
ok(/確認してから/.test(notes[0]||''),'★Discord に予定を出す');
let stt=await asJson(await worker.fetch(get('/status?limit=50'),env));
console.log('   予定: '+JSON.stringify(stt.body.sk_plan&&stt.body.sk_plan.rows));
ok(!!stt.body.sk_plan&&stt.body.sk_plan.n===1,'★★/status が予定を返す');
ok(stt.body.sk_plan.rows[0].price===52.16,'★予定に売れた値段が入る');
calls=[];
res=await sk({approve:true});
ok(res.mode==='approve'&&res.relisted===1&&calls.length>0,'★★approve で実行する');
ok((await row('B0SK000090')).ebay_qty===1,'★数量が戻る');

console.log('\n=== 値下げを再開する（POST /listings sold_keep=false）===');
await wipe();
await seed('B0SK000100',{ebay_qty:1,md_done:4,mark_at:ago(2*DAY)});
let pr=await asJson(await worker.fetch(post('/listings',{items:[
  {asin:'B0SK000100',cond:'used',title:'x',sold_keep:false}]}),env));
const f100=await row('B0SK000100');
console.log('   '+JSON.stringify(f100));
ok(pr.body.accepted===1&&f100.sold_keep===0,'★★印が外れる');
ok(f100.mark_at===null,'★★最後に値下げした日が消える');
ok(f100.md_done===0,'★★進めた回数が0に戻る（売れた値段から数え直す）');
ok(f100.sk_act===null&&f100.sk_fail===0,'★予定と失敗の回数も消える');
/* 印が外れたので、値下げの対象に戻る */
const r100=await env.DB.prepare(`SELECT ${W.ITEM_COLS} FROM items WHERE asin=?1`)
  .bind('B0SK000100').all();
ok(W.mdSkip(r100.results[0],{days:3,max:200},ago(3*DAY))==='',
   '★★値下げの対象に戻る');
// もう一度立てられる
await worker.fetch(post('/listings',{items:[
  {asin:'B0SK000100',cond:'used',title:'x',sold_keep:true}]}),env);
ok((await row('B0SK000100')).sold_keep===1,'★★また立てられる');

console.log('\n=== 作業者のキーでは値下げを再開できない ===');
const staff=await asJson(await worker.fetch(new Request('https://x/listings',
  {method:'POST',headers:{'X-PJ-Key':'staff-key-123','content-type':'application/json'},
   body:JSON.stringify({items:[{asin:'B0SK000100',cond:'used',title:'x',
     sold_keep:false}]})}),env));
console.log('   '+JSON.stringify(staff.body));
ok(staff.status===403&&(staff.body.fields||[]).indexOf('sold_keep')>=0,
   '★★403 で断る（値段を動かす操作）');
ok((await row('B0SK000100')).sold_keep===1,'★★D1 には書かない');

console.log('\n=== 仕入れ先を差し替えられる（buySource）===');
const S=PRICING.settings({adRate:6});
const base={cond:'used',prefix:'game',amazon_lowest:3000,amazon_offers:3,
  amazon_offers_json:'[{"p":3000,"c":"good"}]',amazon_lowest_at:now};
console.log('   amazon: '+JSON.stringify(PRICING.buySource(S,base)));
ok(PRICING.buySource(S,base).src==='amazon','★いまは Amazon を使う');
const mw=Object.assign({},base,{mw_low:2000,mw_low_at:now,mw_n:1,mw_stock:1});
console.log('   auto(mw が安い): '+JSON.stringify(PRICING.buySource(S,mw)));
ok(PRICING.buySource(S,mw).src==='mw'&&PRICING.buySource(S,mw).low===2000,
   '★★mw_* が入っていて安ければそちらを使う（auto）');
ok(PRICING.buySource(PRICING.settings({buySrc:'amazon'}),mw).src==='amazon',
   '★★設定で Amazon に固定できる');
ok(PRICING.buySource(PRICING.settings({buySrc:'mw'}),base).src==='mw',
   '★★mw に固定もできる（値が無ければ has:false）');
const mwNo=Object.assign({},base,{mw_low:2000,mw_low_at:now,mw_stock:0});
ok(PRICING.buySource(PRICING.settings({buySrc:'mw'}),mwNo).stock===false,
   '★★仕入れ先の在庫有無を持てる（マッチングワールド用）');
ok(PRICING.buySource(S,base).stock===true,'★Amazon は最安値が出れば在庫あり');

await T.done();
