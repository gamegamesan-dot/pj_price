/* Worker：フィギュアのみ（箱なし・-L）の扱い（7.36）
   CustomLabel E-<ASIN>-L を cond='loose' として読み、カートリッジのみ（-C）と
   同じ「箱なしで出す行」として扱う。
   ・一点物の見張り・再調達の候補・在庫の突き合わせから外す（手元の実物なので）
   ・Amazon の最安値は中古を見る（lowestKey は asin|used）
   ・仕入値が無い行は、箱付き中古（-U）の SKU から引く */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：フィギュアのみ（箱なし・-L）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('loose');
const env=makeEnv();
const now=new Date().toISOString();

console.log('=== CustomLabel の読み方（parseLabel）===');
[['E-B0LOOSE001-L','loose',true,false],
 ['M-B0LOOSE001-L','loose',true,true],
 ['e-b0loose001-l','loose',true,false],
 ['E-B0LOOSE001-C','cart',true,false],
 ['E-B0LOOSE001-U','used',false,false],
 ['E-B0LOOSE001','new',false,false]].forEach(([s,cond,cart,drop])=>{
  const k=W.parseLabel(s);
  console.log('   '+s+' → '+JSON.stringify({cond:k.cond,cart:k.cart,dropship:!!k.dropship}));
  ok(k.ok&&k.cond===cond,'★'+s+' の区分は '+cond);
  ok(!!k.cart===cart,'★'+s+' は箱なしで出す行＝'+cart);
  ok(!!k.dropship===drop,s+' の無在庫の印');
});

console.log('\n=== 箱なしで出す行の判定（isCart）===');
[['loose',true],['cart',true],['used',false],['new',false],['',false]].forEach(([c,want])=>{
  const got=W.isCart({cond:c});
  console.log('   cond='+(c||'（空）')+' → '+got);
  ok(got===want,'★cond='+(c||'空')+' は '+(want?'箱なし':'ふつうの行'));
});

console.log('\n=== Amazon の最安値は中古を見る（lowestKey / lowestReqs）===');
ok(W.lowestKey({asin:'B0LOOSE001',cond:'loose'})==='B0LOOSE001|used',
   '★-L の行は中古の最安値を使う');
const reqs=W.lowestReqs([{asin:'B0LOOSE001',cond:'loose'}]);
console.log('   '+JSON.stringify(reqs));
ok(reqs.some((x)=>x.cond==='used')&&reqs.some((x)=>x.cond==='new'),
   '★中古と新品の両方を取りにいく（新品のほうが安ければ基準になる）');

console.log('\n=== 名簿（/listings）で cond=loose の行ができる ===');
const put=await asJson(await worker.fetch(post('/listings',{at:now,items:[
  {custom_label:'E-B0LOOSE001-L',title:'ねんどろいど 錦木千束（箱なし）',
   item_id:'330111',hand_qty:1,weight_g:200,cost_yen:4500},
  {custom_label:'E-B0LOOSE001-U',title:'ねんどろいど 錦木千束（箱付き）',
   item_id:'330112',hand_qty:1,weight_g:650,cost_yen:9000}]}),env));
console.log('   '+JSON.stringify(put.body));
const rows=(await env.DB.prepare(
  `SELECT asin,cond,ebay_item_id,hand_qty,weight_g,cost_yen FROM items
   WHERE asin='B0LOOSE001' ORDER BY cond`).all()).results;
rows.forEach((r)=>console.log('   '+JSON.stringify(r)));
ok(rows.length===2&&rows.some((r)=>r.cond==='loose')&&rows.some((r)=>r.cond==='used'),
   '★-L と -U は別の行として入る（PK は asin＋cond）');
const lo=rows.find((r)=>r.cond==='loose');
ok(lo.ebay_item_id==='330111'&&Number(lo.hand_qty)===1,
   '★-L の行に ItemID と手元在庫が入る');
ok(Number(lo.weight_g)===200&&Number(lo.cost_yen)===4500,
   '★実重量と仕入値も -L の行に入る');

console.log('\n=== 再調達の候補にしない（手元の実物なので）===');
/* どちらも「eBayに数量1で出ていて、FBAの販売可能は0」＝ふつうなら再調達の候補。
   箱なしで出す行（-L）だけが候補から外れることを見る。 */
await env.DB.prepare(`UPDATE items SET scope='ebay',ebay_sku='E-'||asin||'-L',
  ebay_qty=1,ebay_price=40,ebay_seen_at=?1,mode='restock',fba_link=1,fba_seen_at=?1,
  fba_available=0,fba_inbound=0,fba_reserved=0,on_hand=0,
  one_off=0,one_off_known=1 WHERE asin='B0LOOSE001' AND cond='loose'`).bind(now).run();
await env.DB.prepare(`UPDATE items SET scope='ebay',ebay_sku='E-'||asin||'-U',
  ebay_qty=1,ebay_price=70,ebay_seen_at=?1,mode='restock',fba_link=1,fba_seen_at=?1,
  fba_available=0,fba_inbound=0,fba_reserved=0,on_hand=0,
  one_off=0,one_off_known=1 WHERE asin='B0LOOSE001' AND cond='used'`).bind(now).run();
const st=(await asJson(await worker.fetch(get('/status?limit=100'),env))).body;
st.items.forEach((x)=>console.log('   '+x.cond+'：restock='+x.restock
  +' 警告='+JSON.stringify(x.warnings)));
const fl=st.items.find((x)=>x.cond==='loose');
const fu=st.items.find((x)=>x.cond==='used');
ok(fl.restock===0,'★-L の行は再調達の候補に入らない');
ok(fu.restock===1,'★箱付き中古（-U）は今までどおり候補に入る');
ok(!(fl.warnings||[]).some((w)=>/一点物|FBA/.test(String(w))),
   '★FBAの在庫が無いことは警告にしない（手元から送る行なので）');
ok(!(fl.warnings||[]).some((w)=>/手元在庫が合いません/.test(String(w))),
   '★数量と手元在庫が合っていれば警告は出ない');
await T.done();
