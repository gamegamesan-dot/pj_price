/* 販売連携：在庫の根拠がない出品（6.139）
   ・手元にも FBA にも無いのに出している行を見つけて数える
   ・行に「在庫の根拠がありません」／「Amazon 無在庫」を出す
   ・手元在庫をオフにした瞬間に、扱いを選ぶ確認の画面を出す（既定は⚙）
   ・絞り込み「在庫の根拠がない出品」「Amazon 無在庫」 */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('販売連携：在庫の根拠がない出品');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], answer=true;
p.on('dialog',async d=>{ dlg.push(d.message());
  if(answer)await d.accept(); else await d.dismiss(); });

const it=(asin,x)=>Object.assign({ asin:asin, cond:'used', scope:'ebay',
  title:asin+'の商品', ebay_sku:'E-'+asin+'-U', ebay_item_id:'99'+asin.slice(-4),
  ebay_qty:1, ebay_price:37.71, cost_yen:1200, weight_g:150,
  on_hand:0, one_off:0, one_off_known:1, dropship:0, restocking:0, amz_drop:0,
  fba_available:null, fba_inbound:0, fba_reserved:0, fba_seen_at:null,
  amazon_lowest:3000, amazon_lowest_n:2, amazon_offers:3,
  amazon_offers_json:'[{"p":3000,"c":"good"},{"p":3500,"c":"good"}]',
  amazon_lowest_at:new Date().toISOString(),
  warnings:[], notes:[], state:'ok' },x||{});

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('amzDropMode').value=o.mode||'plan';
  $('amzDropPick').value=o.pick||'keep';
  window.__posts=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body)?JSON.parse(i.body):null;
    const res=(o2,st)=>new Response(JSON.stringify(o2),{status:st||200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/listings/.test(url)){ window.__posts.push(b.items);
      return res({accepted:(b.items||[]).length,rejected:0}); }
    if(/\/status/.test(url))return res({counts:{},items:[],last_runs:[]});
    return real(u,i);
  };
  syncData={ at:new Date().toISOString(), counts:{}, items:o.items };
  syncPick={}; syncPage=1;
  syncRole=o.role||'admin'; roleApply();
  switchTab('E'); syncRender();
},o||{});

const ROWS=[
  /* 在庫の根拠がない行（FBA と結び付いていない・手元在庫オフ） */
  it('B07MLZ2JKF',{ cond:'cart', ebay_sku:'E-B07MLZ2JKF-C' }),
  /* 手元在庫あり（対象外） */
  it('B0ONHAND001',{ on_hand:1 }),
  /* FBA に在庫あり（対象外） */
  it('B0FBA000001',{ fba_available:2, fba_seen_at:new Date().toISOString() }),
  /* MW の無在庫（対象外） */
  it('B0MW0000001',{ ebay_sku:'W-4902370550467', dropship:1 }),
  /* もう Amazon 無在庫に切り替えた行 */
  it('B0AMZD00001',{ amz_drop:1, restocking:1,
    amz_drop_why:'在庫の根拠がないので Amazon 無在庫にしました' })];

console.log('=== 在庫の根拠がない行を見分ける ===');
await setup({ items:ROWS });
await openCsvBoxes(p);
let v=await p.evaluate(()=>({
  nobasis:(syncData.items||[]).filter(syncNoBasis).map((r)=>r.asin),
  amzdrop:(syncData.items||[]).filter(syncIsAmzDrop).map((r)=>r.asin) }));
console.log('   '+JSON.stringify(v));
ok(v.nobasis.length===1&&v.nobasis[0]==='B07MLZ2JKF',
   '★★★手元にも FBA にも無い行だけを「在庫の根拠がない」とする');
ok(v.amzdrop.length===1&&v.amzdrop[0]==='B0AMZD00001',
   '★★切り替え済みの行は別に数える');

console.log('\n=== 絞り込みに出る ===');
let f=await p.evaluate(()=>{
  const opts=Array.prototype.map.call($('syncFilter').options,
    (o)=>o.value+':'+o.textContent);
  syncFilterSet('nobasis'); syncRender();
  const a=Array.prototype.map.call(document.querySelectorAll('#syncList [data-srow]'),
    (x)=>x.getAttribute('data-srow'));
  syncFilterSet('amzdrop'); syncRender();
  const b=Array.prototype.map.call(document.querySelectorAll('#syncList [data-srow]'),
    (x)=>x.getAttribute('data-srow'));
  syncFilterSet('all'); syncRender();
  return { opts:opts.filter((x)=>/nobasis|amzdrop/.test(x)), a:a, b:b };
});
console.log('   '+JSON.stringify(f));
ok(f.opts.some((x)=>/nobasis.*在庫の根拠がない出品（1）/.test(x)),
   '★★★「在庫の根拠がない出品」の絞り込みが件数つきで出る');
ok(f.a.length===1&&f.a[0]==='B07MLZ2JKF|cart','★★★その行だけ出る');
ok(f.b.length===1&&f.b[0]==='B0AMZD00001|used','★★「Amazon 無在庫」の絞り込みも出る');

console.log('\n=== 行の表示 ===');
let t=await p.evaluate(()=>{
  const d=(a)=>{ const x=document.querySelector('#syncList [data-srow="'+a+'"]');
    return x?(x.textContent||'').replace(/\s+/g,' '):''; };
  return { no:d('B07MLZ2JKF|cart'), yes:d('B0AMZD00001|used') };
});
console.log('   '+JSON.stringify(t).slice(0,300));
ok(/在庫の根拠がありません/.test(t.no),'★★★根拠がない行はそう出す');
ok(/手元在庫.*扱いを選ぶ|扱いを選ぶ/.test(t.no),'★★どうすればよいかも書く');
ok(/Amazon 無在庫/.test(t.yes)&&/Amazon の最安値を仕入れ先/.test(t.yes),
   '★★★切り替えた行は「Amazon 無在庫」と出す');

console.log('\n=== 手元在庫をオフにすると扱いを選ぶ ===');
/* 手元在庫がオンの行をオフにする → 確認の画面が出る（既定＝続ける）。 */
await setup({ items:[it('B0PICK00001',{ on_hand:1 })], pick:'keep' });
dlg=[]; answer=true;
await p.click('#syncList [data-srow="B0PICK00001|used"] [data-sonhand]');
await p.waitForTimeout(500);
let sent=await p.evaluate(()=>window.__posts);
console.log('   '+JSON.stringify(dlg).slice(0,200)+' / '+JSON.stringify(sent));
ok(dlg.length===1&&/在庫がありません/.test(dlg[0]),
   '★★★オフにする瞬間に確認の画面を1回出す');
ok(/Amazon 無在庫で続ける/.test(dlg[0])&&/数量0/.test(dlg[0]),
   '★★★どちらを選ぶかを書く');
ok(sent.length===1&&sent[0][0].on_hand===0&&sent[0][0].amz_drop===1,
   '★★★「続ける」を選ぶと amz_drop=1 で送る');
let note=await p.evaluate(()=>($('syncFixNote').textContent||'').replace(/\s+/g,' '));
ok(/Amazon 無在庫にしました/.test(note),'★★結果を知らせる');
/* 既定が「数量0」のときは、OK で数量0。 */
await setup({ items:[it('B0PICK00002',{ on_hand:1 })], pick:'zero' });
dlg=[]; answer=true;
await p.click('#syncList [data-srow="B0PICK00002|used"] [data-sonhand]');
await p.waitForTimeout(500);
sent=await p.evaluate(()=>window.__posts);
console.log('   '+JSON.stringify(sent));
ok(sent[0][0].amz_drop===0,'★★★既定が「数量0」なら OK で数量0を選ぶ');
/* キャンセルは逆の扱い（既定の反対）。 */
await setup({ items:[it('B0PICK00003',{ on_hand:1 })], pick:'keep' });
dlg=[]; answer=false;
await p.click('#syncList [data-srow="B0PICK00003|used"] [data-sonhand]');
await p.waitForTimeout(500);
sent=await p.evaluate(()=>window.__posts);
ok(sent[0][0].amz_drop===0,'★★キャンセルなら反対（数量0）を選ぶ');
/* FBA に在庫がある行・MW の無在庫の行では、この確認は出さない。 */
let noAsk=await p.evaluate(()=>{
  const fba={ asin:'B0PICK00004', cond:'used', scope:'ebay', ebay_item_id:'1',
    ebay_qty:1, on_hand:1, fba_available:3, fba_seen_at:new Date().toISOString() };
  const mw={ asin:'B0PICK00005', cond:'new', scope:'ebay', ebay_item_id:'1',
    ebay_qty:1, on_hand:1, ebay_sku:'W-4902370550467', dropship:1 };
  const ok1={ asin:'B0PICK00006', cond:'used', scope:'ebay', ebay_item_id:'1',
    ebay_qty:1, on_hand:1 };
  return { fba:syncNoBasisAfterOff(fba), mw:syncNoBasisAfterOff(mw),
    plain:syncNoBasisAfterOff(ok1) };
});
console.log('   '+JSON.stringify(noAsk));
ok(noAsk.fba===false,'★★★FBA に在庫がある行では、この確認は出さない');
ok(noAsk.mw===false,'★★MW の無在庫の行でも出さない');
ok(noAsk.plain===true,'★★根拠が無くなる行でだけ出す');
await T.done();
})();
