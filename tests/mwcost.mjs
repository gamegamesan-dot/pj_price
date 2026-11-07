/* Worker：MW 無在庫の仕入れ値は「MW と Amazon の安いほう」（7.112）
   【J】
   ・MW     … 卸値×1.1 ＋ 仕入れ送料（⚙ mwShipFee・既定¥176）
   ・Amazon … 新品の最安値（送料込み・ポイントは引かない）。**24時間以内**の値だけ
   ・どちらを基準にしたかを返す（画面と知らせに出す）
   ・毎日の見直し（段取り D）もこの仕入れ値で判定（値上げ・数量0）
   ・売れたら両方の値段を取り直し、安いほうを知らせる
     （Amazon なら ASIN・値段・URL・届け先「自宅」／MW なら届け先「秋葉原」）
   ・どちらでも下限利益を割るときは目立つように知らせる
   ・⚙「Amazon の値段も仕入れ値の候補にする」（mwAmzCost・既定オン）
   【K】Amazon の梱包重量を送料に使う（size_g／size_src） */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：MW 無在庫の仕入れ値（MW と Amazon の安いほう・7.112）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwcost');
const j=asJson;
const S={ fx:160, fee:13.6, intlFee:1.65, feeTax:10, fixed:0.4, pack:220,
  adRate:6, baseProfit:1000, linkRate:30, saleRate:15, targetMode:'auto',
  usTaxRate:8, zone:4, mwShipFee:176, dutyShip:true, taxRefund:true,
  stampDisc:true };
const now=new Date().toISOString();
const old=new Date(Date.now()-30*3600000).toISOString();   // 30時間前

console.log('=== 安いほうを選ぶ ===');
let c=W.mwDropCost(S,{ wholesale:3000 },{ amz_low:2500, amz_at:now },{});
console.log('   '+JSON.stringify(c));
ok(c.mw===3476,'★MW は 卸値×1.1＋送料（3000×1.1＝3300＋176）');
ok(c.amz===2500&&c.src==='amz'&&c.cost===2500,
   '★★★Amazon のほうが安ければ Amazon を基準にする');
c=W.mwDropCost(S,{ wholesale:1000 },{ amz_low:2500, amz_at:now },{});
console.log('   '+JSON.stringify(c));
ok(c.src==='mw'&&c.cost===1276,'★★★MW のほうが安ければ MW を基準にする');
ok(/仕入れ基準：MW ¥1,276（MW ¥1,276／Amazon ¥2,500）/.test(W.mwCostText(c)),
   '★★どちらを基準にしたかの1行を作る');

console.log('\n=== 24時間を超えた Amazon の値段は使わない ===');
c=W.mwDropCost(S,{ wholesale:3000 },{ amz_low:2500, amz_at:old },{});
console.log('   '+JSON.stringify(c));
ok(c.src==='mw'&&c.cost===3476&&c.amz===0,
   '★★★古い（24時間超）Amazon の値段は仕入れ値にしない');
ok(/24時間/.test(c.why),'★理由を返す');
c=W.mwDropCost(S,{ wholesale:3000 },null,{});
ok(c.src==='mw'&&c.amz===0,'★Amazon の値段が無ければ MW だけで決める');
c=W.mwDropCost(S,{ wholesale:0 },{ amz_low:2500, amz_at:now },{});
ok(c.src==='amz'&&c.cost===2500,'★★卸値が読めない行は Amazon で決められる');

console.log('\n=== ⚙でオフにできる（既定オン）===');
c=W.mwDropCost(S,{ wholesale:3000 },{ amz_low:2500, amz_at:now },{ mwAmzCost:false });
console.log('   '+JSON.stringify(c));
ok(c.src==='mw'&&c.amz===0,'★★★オフにすると Amazon を候補にしない');
c=W.mwDropCost(S,{ wholesale:3000 },{ amz_low:2500, amz_at:now },{ mwAmzCost:true });
ok(c.src==='amz','★オンなら候補にする');
c=W.mwDropCost(S,{ wholesale:3000 },{ amz_low:2500, amz_at:now },{});
ok(c.src==='amz','★★設定が無いときは**オン**（既定）');

console.log('\n=== 段取り D：安いほうの仕入れ値で判定する ===');
/* いまの売値が下限を割っていれば値上げ。相場の115%を超えるなら数量0。 */
const row={ asin:'B00W000001', cond:'new', prefix:'mwhobby',
  ebay_item_id:'1', ebay_sku:'W-4902370550467', ebay_qty:1, ebay_price:20,
  weight_g:0 };
const mw={ jan:'4902370550467', wholesale:9000, stock:5, ship_days:0 };
const mkt={ low:300, n:3 };
/* MW だけなら 9000×1.1＋176＝¥10,076 → 売値は高くなる（値上げ）。 */
let pl=W.mwDropPlan(S,row,mw,mkt,1.15,null,{});
console.log('   MWだけ: '+JSON.stringify({act:pl.act,to:pl.to,src:pl.cost_src,
  cost:pl.cost}));
ok(pl.cost===10076&&pl.cost_src==='mw','★MW の仕入れ値で計算する');
ok(pl.act==='up','★★下限を割るので値上げ');
/* Amazon が ¥4,000 ならそちらが安いので、値上げの幅が小さくなる。 */
let pl2=W.mwDropPlan(S,row,mw,mkt,1.15,{ amz_low:4000, amz_at:now },{});
console.log('   Amazon安い: '+JSON.stringify({act:pl2.act,to:pl2.to,
  src:pl2.cost_src,cost:pl2.cost}));
ok(pl2.cost===4000&&pl2.cost_src==='amz','★★★Amazon が安ければそれで計算する');
ok(pl2.to<pl.to,'★★★安い仕入れ値なら売値も低くなる');
ok(/仕入れ基準：Amazon/.test(pl2.cost_text||''),'★★基準を文字でも返す');
/* 相場が低いと、値上げしても115%を超えるので数量0。 */
let pl3=W.mwDropPlan(S,row,mw,{ low:20, n:3 },1.15,null,{});
console.log('   相場が低い: '+JSON.stringify({act:pl3.act,why:pl3.why}));
ok(pl3.act==='zero','★★★値上げしても相場の115%を超えるなら数量0');
ok(/仕入れ基準/.test(pl3.why),'★理由に仕入れ基準を書く');

console.log('\n=== 【K】Amazon の梱包重量を送料に使う ===');
/* 重さだけ変えて、送料（＝売値）が変わることを見る。 */
const light=W.mwDropPlan(S,row,{ jan:'4902370550467', wholesale:9000, stock:5,
  ship_days:0 },mkt,1.15,{ amz_g:150, amz_at:now },{});
const heavy=W.mwDropPlan(S,row,{ jan:'4902370550467', wholesale:9000, stock:5,
  ship_days:0 },mkt,1.15,{ amz_g:1500, amz_at:now },{});
console.log('   150g→'+light.to+' / 1500g→'+heavy.to);
ok(heavy.to>light.to,'★★★Amazon の重さ（梱包重量）が送料と売値に効く');
const hand=W.mwDropPlan(S,Object.assign({},row,{ weight_g:300 }),
  { jan:'4902370550467', wholesale:9000, stock:5, ship_days:0 },mkt,1.15,
  { amz_g:1500, amz_at:now },{});
console.log('   手で300g→'+hand.to);
ok(hand.to<heavy.to,'★★★手で直した重さがあればそれを優先する');

console.log('\n=== 売れたら安いほうを知らせる ===');
/* amazonLowest は応答の URI から ASIN を**10文字**で読む。
   試験データが11文字だと値段が入らない（mwamz.mjs と同じ罠）。 */
ok('B00AMZLOW1'.length===10,'★試験データの ASIN は10文字（実物と同じ長さ）');
/* SP-API の鍵（モックに行く。無いと amazonLowest が走らない）。 */
const env=makeEnv({ STAFF_KEY:'s', LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs',
  LWA_REFRESH_TOKEN:'rt', SP_SELLER_ID:'A1SELLER9999' });
let notes=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u&&u.url?u.url:u);
  if(/discord/.test(url)){
    notes.push(JSON.parse((i&&i.body)||'{}').content||'');
    return new Response('{}',{status:200});
  }
  /* Amazon の最安値の取り直し（売れた時点の値段）。 */
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  /* amazonLowest は応答の URI から ASIN（10文字）を読む。
     出品（Offers）の ListingPrice＋Shipping から最安値を出す。 */
  if(/itemOffers/.test(url)){
    const body=JSON.parse((i&&i.body)||'{}');
    return new Response(JSON.stringify({ responses:(body.requests||[]).map((q)=>{
      const m=/\/items\/([A-Z0-9]{10})\/offers/.exec(q.uri);
      const a=m?m[1]:'';
      return { request:q, body:{ payload:{ ASIN:a, ItemCondition:'New',
        Summary:{ NumberOfOffers:[{ condition:'new', OfferCount:3 }],
                  TotalOfferCount:3, BuyBoxPrices:[] },
        Offers:[{ ListingPrice:{ Amount:2200 }, Shipping:{ Amount:0 },
                  SellerId:'A1X', SubCondition:'new',
                  IsFulfilledByAmazon:true }] } } };
    })}),{status:200});
  }
  return new Response('{}',{status:200});
};
await j(await worker.fetch(post('/settings',{ at:now, settings:{
  fx:'160', mwShipFee:'176', baseProfit:'1000', linkRate:'30',
  targetMode:'auto', saleRate:'15', usTaxRate:'8', fee:'13.6',
  intlFee:'1.65', feeTax:'10', fixed:'0.4', pack:'220', autoAdRate:'6' } }),env));
const seed=(jan,w,asin,low,at)=>{
  env.DB._db.prepare(`INSERT INTO mw_stock (jan,sha,idx,kishu,name,cond,wholesale,
    stock,ship_days,row_hash,pick,seen_at,created_at)
   VALUES ('`+jan+`','M200',0,'FIG','`+jan+`の商品','新品',`+w+`,5,0,'h',1,
     '`+now+`','`+now+`')`).run();
  if(asin)env.DB._db.prepare(`INSERT INTO mw_amz (jan,asin,low,price_at,size_g,
    size_src,checked_at,created_at)
   VALUES ('`+jan+`','`+asin+`',`+low+`,'`+at+`',420,'pkg','`+at+`','`+at+`')`).run();
};
/* ① Amazon が安い行（卸値 9000 → MW ¥10,076、Amazon ¥2,200） */
seed('4902370550001',9000,'B00AMZLOW1',9999,now);
/* ② MW が安い行（Amazon は取れない） */
seed('4902370550002',1000,'',0,now);
notes=[];
let n=await W.mwOrderNotify(env,{ kind:'t',subrequests:0,pages:0,errors:0,
  notes:[],rows:0 },[
  { sku:'W-4902370550001', qty:1, orderedAt:now, price:30, hand:10 },
  { sku:'W-4902370550002', qty:1, orderedAt:now, price:30, hand:10 }]);
console.log('   '+notes[0]);
ok(n===2,'★2件を知らせる');
ok(/Amazon で購入してください/.test(notes[0]),
   '★★★Amazon が安い行は「Amazon で購入してください」');
ok(/ASIN \*\*B00AMZLOW1\*\*/.test(notes[0])&&/¥2,200/.test(notes[0]),
   '★★★ASIN と値段を出す（売れた時点で取り直した値）');
ok(/amazon\.co\.jp\/dp\/B00AMZLOW1/.test(notes[0]),'★★★URL を出す');
ok(/届け先：自宅/.test(notes[0]),'★★★Amazon で買うときは「届け先：自宅」');
ok(/MW に注文してください/.test(notes[0])&&/届け先：秋葉原/.test(notes[0]),
   '★★★MW が安い行は「MW に注文してください」「届け先：秋葉原」');
ok(!/[0-9]丁目|東京都|区|番地/.test(notes[0]),
   '★★★住所そのものは書かない（呼び名だけ）');
const amzRow=env.DB._db.prepare(
  "SELECT low,price_at FROM mw_amz WHERE jan='4902370550001'").get();
console.log('   取り直し: '+JSON.stringify(amzRow));
ok(amzRow.low===2200,'★★★売れたときに Amazon の値段を取り直して控える');

console.log('\n=== どちらでも下限利益を割るときは目立たせる ===');
notes=[];
/* 売れた値段 $5 では、仕入れ ¥2,200 の下限利益を割る。 */
await W.mwOrderNotify(env,{ kind:'t',subrequests:0,pages:0,errors:0,notes:[],rows:0 },
  [{ sku:'W-4902370550001', qty:1, orderedAt:now, price:5, hand:10 }]);
console.log('   '+notes[0].slice(0,420));
ok(/🔴/.test(notes[0])&&/下限利益を割ります/.test(notes[0]),
   '★★★下限利益を割るときは目立つ印を付けて知らせる');
ok(/買う前に確かめてください/.test(notes[0]),'★★どうすればよいかも書く');
T.done();
