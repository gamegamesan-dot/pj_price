/* Worker：MW 無在庫が売れたら「どこで買うか」を1通で知らせる（8.99）

   カジの依頼（2026-11-24）
   自動出品した MW 無在庫（W-<JAN>）が eBay で初めて売れ、MW と Amazon の値段を
   手で比べて MW で注文した。スマホで1タップにしたい。
   ① 15分ごとの注文の取り込みに乗せる（orders の W- の明細で、まだ知らせていないもの）
   ② MW＝卸値（税抜）×1.1＋送料 ¥176・在庫数（取り込み済みの CSV だけ。MW には行かない）
      Amazon＝新品の最安値（送料込み・SP-API で取り直す）・商品ページだけ（カートのリンクは出さない・v348）
   ③ 安いほうと、それぞれの利益の目安（shared/pricing.js の式）
   ④ 管理用のチャンネル（DISCORD_BUY_WEBHOOK_URL → OPS → 社内用）
   ・買うのは人（通知だけ）・買い手の情報は入れない・同じ明細は二度知らせない
   ・MW の在庫0／CSV が6時間以上古いときは注意 */
import { harness, loadWorker, makeEnv, asJson, post } from './lib.mjs';
import PRICING from '../shared/pricing.js';
const T=harness('Worker：MW 無在庫が売れたら「どこで買うか」（8.99）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('buynote');

const HOOK_MAIN='https://discord.com/api/webhooks/1/main';
const HOOK_OPS='https://discord.com/api/webhooks/2/ops';
const HOOK_BUY='https://discord.com/api/webhooks/3/buy';
let notes=[], hooks=[], discordFail=false, ebayOrders={}, ebayCalls=[], amzLow={}, listOrders=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u&&u.url?u.url:u);
  if(/discord/.test(url)){
    if(discordFail)return new Response('x',{status:500});
    hooks.push(url); notes.push(JSON.parse((i&&i.body)||'{}').content||'');
    return new Response(null,{status:204});
  }
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),{status:200});
  if(/sell\/fulfillment\/v1\/order\?/.test(url)){
    const q=new URL(url).searchParams;
    ebayCalls.push(Object.fromEntries(q.entries()));
    if(q.get('orderIds')){
      const ids=q.get('orderIds').split(',');
      return new Response(JSON.stringify({ orders:ids.filter((x)=>ebayOrders[x]).map((x)=>ebayOrders[x]),
        total:ids.length }),{status:200});
    }
    return new Response(JSON.stringify({ orders:listOrders, total:listOrders.length }),{status:200});
  }
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  if(/itemOffers/.test(url)){
    const body=JSON.parse((i&&i.body)||'{}');
    return new Response(JSON.stringify({ responses:(body.requests||[]).map((q)=>{
      const m=/\/items\/([A-Z0-9]{10})\/offers/.exec(q.uri);
      const a=m?m[1]:'';
      return { request:q, body:{ payload:{ ASIN:a, ItemCondition:'New',
        Summary:{ NumberOfOffers:[{ condition:'new', OfferCount:2 }], TotalOfferCount:2, BuyBoxPrices:[] },
        Offers:amzLow[a]?[{ ListingPrice:{ Amount:amzLow[a]-300 }, Shipping:{ Amount:300 },
          SellerId:'A1X', SubCondition:'new', IsFulfilledByAmazon:false }]:[] } } };
    })}),{status:200});
  }
  return new Response('{}',{status:200});
};
/* 買い手の情報（モックの eBay の注文に入れておく。通知に出てはいけない）。 */
const BUYER={ username:'buyer_kaji_secret', taxAddress:{ postalCode:'90210' } };
const SHIP={ shipTo:{ fullName:'John Q Buyer', contactAddress:{ addressLine1:'123 Secret St',
  city:'Springfield' }, primaryPhone:{ phoneNumber:'555-0100' }, email:'buyer@example.com' } };
const eOrder=(id,lines,o)=>Object.assign({ orderId:id, creationDate:new Date().toISOString(),
  orderFulfillmentStatus:'NOT_STARTED', orderPaymentStatus:'PAID', buyer:BUYER,
  fulfillmentStartInstructions:[{ shippingStep:SHIP }],
  cancelStatus:{ cancelState:'NONE_REQUESTED' },
  lineItems:lines.map((l)=>({ lineItemId:l.line, sku:l.sku, title:'Game '+l.sku, quantity:l.qty||1,
    lineItemCost:{ value:String(l.usd*(l.qty||1)), currency:'USD' },
    total:{ value:String(l.usd*(l.qty||1)+12), currency:'USD' } })) },o||{});

const mkEnv=(x)=>makeEnv(Object.assign({ STAFF_KEY:'s',
  EBAY_CLIENT_ID:'ci', EBAY_CLIENT_SECRET:'cs', EBAY_USER_REFRESH_TOKEN:'rt',
  LWA_CLIENT_ID:'a', LWA_CLIENT_SECRET:'b', LWA_REFRESH_TOKEN:'c',
  DISCORD_WEBHOOK_URL:HOOK_MAIN },x||{}));
const ST={ fx:'155', mwShipFee:'176', baseProfit:'1000', linkRate:'30', targetMode:'auto',
  saleRate:'15', usTaxRate:'8', fee:'13.6', intlFee:'1.65', feeTax:'10', fixed:'0.4',
  pack:'220', autoAdRate:'6' };
const NOW=new Date().toISOString();
const hAgo=(h)=>new Date(Date.now()-h*3600000).toISOString();
async function setup(env,o){
  const oo=o||{};
  await asJson(await worker.fetch(post('/settings',{ at:NOW, settings:ST }),env));
  env.DB._db.prepare(`INSERT INTO mw_runs (at,created_at) VALUES (?,?)`).run(oo.csvAt||hAgo(1),NOW);
}
const seedMw=(env,jan,w,stock,o)=>env.DB._db.prepare(`INSERT INTO mw_stock (jan,sha,idx,kishu,name,
  cond,wholesale,stock,ship_days,row_hash,pick,seen_at,created_at,gone_at)
  VALUES (?,'いろは商会',0,'NS',?,'新品',?,?,2,'h',1,?,?,?)`)
  .run(jan,(o&&o.name)||'ゼルダの伝説 ティアーズ オブ ザ キングダム',w,stock,NOW,NOW,(o&&o.gone)?NOW:null);
const seedAmz=(env,jan,asin,low)=>{ env.DB._db.prepare(`INSERT INTO mw_amz (jan,asin,name,low,price_at,
  size_g,size_src,checked_at,created_at) VALUES (?,?,?,?,?,400,'pkg',?,?)`)
  .run(jan,asin,'Amazon の商品名',9999,NOW,NOW,NOW); amzLow[asin]=low; };
const seedOrder=(env,id,line,sku,qty,at)=>env.DB._db.prepare(`INSERT INTO orders (channel,order_id,
  line_id,sku,asin,cond,qty,amount,currency,ordered_at,status,created_at)
  VALUES ('ebay',?,?,?,?, 'new',?,99,'USD',?,'NOT_STARTED',?)`)
  .run(id,line,sku,'W'+sku.slice(2),qty,at||NOW,NOW);
const run0=()=>({ kind:'t', subrequests:0, pages:0, errors:0, notes:[], rows:0 });
const reset=()=>{ notes=[]; hooks=[]; ebayCalls=[]; discordFail=false; };

console.log('=== ① MW が安い（おすすめ：MW）===');
{
  reset(); ebayOrders={}; amzLow={};
  const env=mkEnv(); await setup(env);
  const J='4902370550467';
  seedMw(env,J,3000,5); seedAmz(env,J,'B0BXYZ1234',4200);
  seedOrder(env,'12-34567-89012','10001',('W-'+J),1);
  ebayOrders['12-34567-89012']=eOrder('12-34567-89012',[{ line:'10001', sku:'W-'+J, usd:45 }]);
  const r=await W.jobBuyNote(env,run0(),{});
  console.log('   '+JSON.stringify(r));
  const t=notes[0]||'';
  console.log(t.split('\n').map((x)=>'   | '+x).join('\n'));
  ok(r.ok&&r.sent===1&&notes.length===1,'★★★1明細で1通');
  ok(/おすすめ：\*\*MW\*\*/.test(t),'★★★安いほう（MW ¥3,476 < Amazon ¥4,200）を「おすすめ：MW」');
  ok(/ゼルダの伝説/.test(t)&&/JAN 4902370550467/.test(t)&&/\$45\.00/.test(t)&&/× 1点/.test(t),
     '★★★日本語の商品名・JAN・eBay の売値（商品代）・数量');
  ok(/仕入れ ¥3,476/.test(t)&&/卸値 ¥3,000×1\.1＋送料 ¥176/.test(t)&&/在庫 5点/.test(t),
     '★★★MW：税込の仕入れ値（卸値×1.1＋¥176）・在庫数');
  ok(/最安値 ¥4,200（新品・送料込み）/.test(t),'★★★Amazon：最安値（送料込み・いま取り直した値）');
  ok(/\[MW で開く\]\(<https:\/\/matchingworld\.asia\/buy\/\?q=4902370550467>\)/.test(t),
     '★★★MW の商品ページ（JAN の検索結果）へのリンク');
  ok(/\[商品ページ\]\(<https:\/\/www\.amazon\.co\.jp\/dp\/B0BXYZ1234>\)/.test(t),
     '★★★Amazon：商品ページへのリンク');
  ok(!/カートに入れる|aws\/cart/.test(t),
     '★★★「カートに入れる」は出さない（2026-11-24 に試してカートに入らなかった・v348）');
  ok(/eBay 注文番号 12-34567-89012/.test(t)
     &&/\[Seller Hub で開く\]\(<https:\/\/www\.ebay\.com\/sh\/ord\/details\?orderid=12-34567-89012>\)/.test(t),
     '★★★eBay の注文番号と Seller Hub の注文ページ');
  /* 利益の目安は shared/pricing.js の式と同じ。 */
  const S=PRICING.settings({ fx:155, fee:13.6, intlFee:1.65, adRate:6, feeTax:10, fixed:0.4,
    pack:220, usTaxRate:8, baseProfit:1000, linkRate:30, saleRate:15, targetMode:'auto' });
  const pf=(c)=>{ const m=PRICING.model(S,{ cost:c, weight:400, flat:0 }); return Math.round(m.zoneProfit(45,m.basisZone).profit); };
  const pm=pf(3476), pa=pf(4200);
  console.log('   利益の目安 MW '+pm+'／Amazon '+pa);
  const yen=(n)=>(n<0?'🔴 −':'')+'¥'+Math.abs(n).toLocaleString('en-US');
  ok(t.indexOf('利益の目安 '+yen(pm))>=0&&t.indexOf('利益の目安 '+yen(pa))>=0,
     '★★★利益の目安（MW・Amazon とも pj の式＝model→zoneProfit）');
  ok(!/John|Secret St|Springfield|555-0100|buyer@|buyer_kaji|90210/.test(t),
     '★★★買い手の名前・住所・電話・メールは入れない');
  ok(!/@everyone|@here/.test(t),'★★@everyone／@here は使わない');
  ok(hooks[0]===HOOK_MAIN,'★★送り先：専用の宛先が無ければ社内用');
  ok(ebayCalls.length===1&&ebayCalls[0].orderIds==='12-34567-89012','★★eBay の注文は番号で読む（明細の商品代）');
  ok(!/匿名|warn|⚠/.test(t),'★注意が無いときは出さない');
  const b=env.DB._db.prepare(`SELECT * FROM buy_note`).all();
  ok(b.length===1&&b[0].state==='sent'&&b[0].pick==='mw'&&b[0].mw_cost===3476&&b[0].amz_cost===4200,
     '★★★知らせた明細を控える');
  console.log('\n=== ② 二度知らせない ===');
  reset();
  const r2=await W.jobBuyNote(env,run0(),{});
  ok(r2.ok&&r2.found===0&&notes.length===0&&ebayCalls.length===0,'★★★同じ明細は二度知らせない（eBay も読まない）');
}

console.log('\n=== ③ Amazon が安い／MW の在庫0／CSV が古い ===');
{
  reset(); ebayOrders={}; amzLow={};
  const env=mkEnv({ DISCORD_OPS_WEBHOOK_URL:HOOK_OPS }); await setup(env,{ csvAt:hAgo(7) });
  const J1='4902370550474', J2='4902370550481';
  seedMw(env,J1,5000,3); seedAmz(env,J1,'B0BAMZ0001',4000);              // Amazon が安い
  seedMw(env,J2,1000,0,{ gone:true, name:'品切れの商品' }); seedAmz(env,J2,'B0BAMZ0002',5000);  // MW は欠品
  seedOrder(env,'01-11111-11111','1',('W-'+J1),2);
  seedOrder(env,'02-22222-22222','1',('W-'+J2),1);
  ebayOrders['01-11111-11111']=eOrder('01-11111-11111',[{ line:'1', sku:'W-'+J1, usd:60, qty:2 }]);
  ebayOrders['02-22222-22222']=eOrder('02-22222-22222',[{ line:'1', sku:'W-'+J2, usd:50 }]);
  const r=await W.jobBuyNote(env,run0(),{});
  ok(r.sent===2&&notes.length===2,'★2明細で2通');
  const a=notes.filter((x)=>/4902370550474/.test(x))[0]||'', b=notes.filter((x)=>/4902370550481/.test(x))[0]||'';
  console.log(b.split('\n').map((x)=>'   | '+x).join('\n'));
  ok(/おすすめ：\*\*Amazon\*\*/.test(a)&&/× 2点/.test(a)&&/（2点で）/.test(a),
     '★★★Amazon が安ければ「おすすめ：Amazon」・数量2は利益も2点ぶん');
  ok(/おすすめ：\*\*Amazon\*\*/.test(b)&&/MW の在庫が 0 です/.test(b)&&/在庫 0点/.test(b),
     '★★★MW の在庫が 0（欠品）なら注意を出し、Amazon をすすめる（MW のほうが安くても）');
  ok(/MW の在庫CSV が古いです/.test(a)&&/7時間前/.test(a),'★★★在庫CSV が6時間以上古いと注意');
  ok(hooks.every((h)=>h===HOOK_OPS),'★★送り先：運営専用があればそちら（会員向けではない）');
}

console.log('\n=== ④ 対象外：取り消し・W- でない・古い注文・手元在庫 ===');
{
  reset(); ebayOrders={}; amzLow={};
  const env=mkEnv({ DISCORD_OPS_WEBHOOK_URL:HOOK_OPS, DISCORD_BUY_WEBHOOK_URL:HOOK_BUY }); await setup(env);
  const J='4902370550498', J3='4902370550504';
  seedMw(env,J,2000,4); seedAmz(env,J,'B0BAMZ0003',9000);
  seedMw(env,J3,2000,4);
  seedOrder(env,'03-33333-33333','1',('W-'+J),1);                             // 取り消し
  ebayOrders['03-33333-33333']=eOrder('03-33333-33333',[{ line:'1', sku:'W-'+J, usd:40 }],
    { cancelStatus:{ cancelState:'CANCELED' } });
  env.DB._db.prepare(`INSERT INTO orders (channel,order_id,line_id,sku,asin,cond,qty,amount,currency,
    ordered_at,status,created_at) VALUES ('ebay','04-44444-44444','1','E-B0BXYZ9999','B0BXYZ9999','new',1,40,'USD',?,'x',?)`).run(NOW,NOW);
  seedOrder(env,'05-55555-55555','1',('W-'+J),1,hAgo(W.BUY_LOOK_H+1));        // 古い
  /* 手元在庫から送る行（無在庫ではない）。 */
  env.DB._db.prepare(`INSERT INTO items (asin,cond,scope,ebay_sku,hand_qty,updated_at)
    VALUES ('W${J3}','new','ebay','W-${J3}',2,?)`).run(NOW);
  seedOrder(env,'06-66666-66666','1',('W-'+J3),1);
  ebayOrders['06-66666-66666']=eOrder('06-66666-66666',[{ line:'1', sku:'W-'+J3, usd:40 }]);
  const r=await W.jobBuyNote(env,run0(),{});
  console.log('   '+JSON.stringify(r));
  ok(notes.length===0&&r.skipped===2,'★★★取り消し・手元在庫の行は知らせない');
  const b=env.DB._db.prepare(`SELECT order_id,state FROM buy_note ORDER BY order_id`).all();
  ok(JSON.stringify(b.map((x)=>x.order_id+':'+x.state))==='["03-33333-33333:cancel","06-66666-66666:hand"]',
     '★★取り消し・手元在庫は控える（毎回読み直さない）。W- でない（FBA・手元・せどり）・古い注文は拾わない');
  console.log('\n=== ⑤ 管理用の宛先 ===');
  reset();
  seedOrder(env,'07-77777-77777','1',('W-'+J),1);
  ebayOrders['07-77777-77777']=eOrder('07-77777-77777',[{ line:'1', sku:'W-'+J, usd:40 }]);
  await W.jobBuyNote(env,run0(),{});
  ok(hooks.length===1&&hooks[0]===HOOK_BUY,'★★★DISCORD_BUY_WEBHOOK_URL があればそこへ（管理用）');
}

console.log('\n=== ⑥ 送れなかったら控えない（次の回にやり直す）===');
{
  reset(); ebayOrders={}; amzLow={};
  const env=mkEnv(); await setup(env);
  const J='4902370550511';
  seedMw(env,J,2000,4);
  seedOrder(env,'08-88888-88888','1',('W-'+J),1);
  ebayOrders['08-88888-88888']=eOrder('08-88888-88888',[{ line:'1', sku:'W-'+J, usd:40 }]);
  discordFail=true;
  const r=await W.jobBuyNote(env,run0(),{});
  ok(r.failed===1&&!env.DB._db.prepare(`SELECT * FROM buy_note`).all().length,'★★送れなければ控えない');
  discordFail=false;
  const r2=await W.jobBuyNote(env,run0(),{});
  ok(r2.sent===1&&notes.length===1,'★★次の回に送る');
  ok(/Amazon\*\*　ASIN が分かりません/.test(notes[0])&&/おすすめ：\*\*MW\*\*/.test(notes[0]),
     '★Amazon の ASIN が無ければ MW だけで決める');
  const env2=makeEnv({ DISCORD_WEBHOOK_URL:'' });
  const r3=await W.jobBuyNote(env2,run0(),{});
  ok(r3.ok===false&&/送り先/.test(r3.why),'★宛先が1つも無ければ何もしない');
}

console.log('\n=== ⑦ 15分ごとの注文の取り込みから（二度出さない・古い知らせは出さない）===');
{
  reset(); ebayOrders={}; amzLow={};
  const env=mkEnv(); await setup(env);
  const J='4902370550528';
  seedMw(env,J,2500,6); seedAmz(env,J,'B0BAMZ0005',6000);
  const o=eOrder('09-99999-99999',[{ line:'5', sku:'W-'+J, usd:55 }]);
  listOrders=[o]; ebayOrders['09-99999-99999']=o;
  const s1=await asJson(await worker.fetch(post('/sync',{ kind:'orders' }),env));
  console.log('   '+JSON.stringify(s1.body.buy));
  ok(s1.body.buy&&s1.body.buy.sent===1&&notes.filter((x)=>/MW 無在庫が売れました/.test(x)).length===1,
     '★★★注文の取り込みのあとに知らせる');
  ok(!notes.some((x)=>/仕入れてください/.test(x)),'★★前の「仕入れてください」（7.72）は出さない（二重にしない）');
  /* 発送などで注文が変わると、eBay は同じ注文をまた返す。 */
  reset();
  o.orderFulfillmentStatus='FULFILLED';
  const s2=await asJson(await worker.fetch(post('/sync',{ kind:'orders' }),env));
  ok(s2.body.buy&&s2.body.buy.found===0&&!notes.some((x)=>/MW 無在庫が売れました/.test(x)),
     '★★★同じ注文がまた返っても二度知らせない');
  listOrders=[];
}

console.log('\n=== ⑧ 小さな部品 ===');
ok(W.buyAmzUrl('b0bxyz1234')==='https://www.amazon.co.jp/dp/B0BXYZ1234'
   &&W.buyAmzUrl('W4902370550467')==='','★ASIN の形のときだけ商品ページのリンクを作る');
ok(W.buyPick({ mw:{ cost:3000, stock:1 }, amz:{ low:3000 } })==='mw','★同じ値段なら MW');
ok(W.buyPick({ mw:{ cost:3000, stock:0 }, amz:{ low:0 } })==='','★どちらも買えなければ空');
ok(W.BUY_CSV_OLD_H===6,'★CSV が古いとみなすのは6時間');

T.done();
