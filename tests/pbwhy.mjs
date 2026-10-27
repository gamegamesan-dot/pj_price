/* Worker：「売り越しの恐れ」に、フェイズBがどうするかを書き足す（7.80）
   v199 までは「売り越しの恐れ：…（FBA 0 / eBay 1）」だけで、
   なぜ eBay が直らないのかが分からなかった（2026-10-27 の報告）。
   ・対象外なら理由（手元在庫あり／納品待ち／セール中／今回は動かさない／
     続けて失敗／出品していません など）
   ・⚙設定が「オフ」「予定だけ」なら、そのせいで直らないと書く
   ・対象なら「次の回（15分ごと）に数量を0にします」
   通知の文だけを変える。どの行を直すかの判定（pbTarget）は変えない。 */
import { harness, loadWorker, makeEnv, asJson, get } from './lib.mjs';
const T=harness('Worker：売り越しの通知に理由を足す');
const ok=T.ok;
const { worker, T:W }=await loadWorker('pbwhy');
const env=makeEnv({ STAFF_KEY:'staff-key-123' });
const now=new Date().toISOString();

/* FBA 0・eBay 1 の行を作る（売り越しの恐れが出る形）。 */
const seed=async(asin,x)=>{
  const o=Object.assign({ title:asin+'の商品', scope:'ebay', cond:'new',
    item:'110'+asin.slice(-4), qty:1, mode:null, on_hand:0, dropship:0,
    restocking:0, sale:0, inbound:0, reserved:0, skip:0, fail:0,
    one_off:0, one_off_known:0 },x||{});
  await env.DB.prepare(
    `INSERT INTO items (asin,cond,scope,title,ebay_item_id,ebay_sku,ebay_qty,
       ebay_price,ebay_seen_at,fba_available,fba_inbound,fba_reserved,
       fba_res_cust,fba_res_trans,fba_res_proc,fba_seen_at,mode,on_hand,
       dropship,restocking,ebay_sale,pb_skip,pb_fail,one_off,one_off_known,
       updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,30,?8,0,?9,?10,?11,0,0,?8,?12,?13,?14,?15,
       ?16,?17,?18,?19,?20,?8)`)
    .bind(asin,o.cond,o.scope,o.title,o.item,'E-'+asin,o.qty,now,
          o.inbound,o.reserved,o.reserved?o.reserved:0,
          o.mode,o.on_hand,o.dropship,o.restocking,o.sale,o.skip,o.fail,
          o.one_off,o.one_off_known).run();
};
const ev=(asin)=>env.DB._db.prepare(
  "SELECT * FROM events WHERE type='OVERSELL_RISK' AND asin=?").all(asin);
const text=(asin)=>{
  const r=ev(asin)[0];
  if(!r)return '';
  return W.EV_TEXT.OVERSELL_RISK(JSON.parse(r.detail||"{}"));
};
const fire=async(pb)=>{
  env.DB._db.prepare('DELETE FROM events').run();
  const all=env.DB._db.prepare('SELECT * FROM items').all();
  await env.DB.batch(W.stateEvents(env,all,pb));
};

console.log('=== 対象の行（直る行）===');
await seed('B0PBOK0001',{ title:'ふつうに直る商品' });
await fire({ mode:'on', restock:'confirm' });
let t=text('B0PBOK0001');
console.log('   '+t.replace(/\n/g,' / '));
ok(/売り越しの恐れ/.test(t)&&/FBA 0 \/ eBay 1/.test(t),'★今までの文は変えない');
ok(/フェイズB：/.test(t),'★★★フェイズBの行を書き足す');
ok(/数量を0にします/.test(t),'★★★対象なら「数量を0にします」');
ok(/15分ごと/.test(t),'★★いつ直るかも書く');

console.log('\n=== ⚙設定で止まっているとき ===');
await fire({ mode:'plan', restock:'confirm' });
t=text('B0PBOK0001');
console.log('   予定だけ: '+t.split('\n')[1]);
ok(/予定だけなので eBay は直りません/.test(t),
   '★★★「予定だけ表示」なら、そのせいで直らないと書く');
ok(/FBAで売れたときの動作/.test(t),'★★★どこを変えればよいか書く');
await fire({ mode:'off', restock:'confirm' });
t=text('B0PBOK0001');
console.log('   オフ: '+t.split('\n')[1]);
ok(/オフなので eBay は直りません/.test(t),'★★★「オフ」もそう書く');
ok(/FBAで売れたときの動作/.test(t),'★★直し方を書く');

console.log('\n=== 対象外の理由（2章の条件）===');
/* 手元在庫は売り越しの通知そのものが出ないので、ここでは出ない条件を確かめる。 */
const cases=[
  ['B0PBINB001','納品待ち',       { inbound:2 },            /納品待ち/],
  ['B0PBSAL001','セール中',       { sale:1 },               /セール中/],
  ['B0PBSKP001','今回は動かさない',{ skip:1 },              /今回は動かさない/],
  ['B0PBFAI001','続けて失敗',     { fail:3 },               /続けて失敗/],
  ['B0PBNOI001','出品していません',{ item:'' },             /出品していません/],
];
for(const [asin,label,x,re] of cases){
  await seed(asin,Object.assign({ title:label+'の商品' },x));
}
await fire({ mode:'on', restock:'confirm' });
for(const [asin,label,x,re] of cases){
  const z=text(asin);
  console.log('   '+label+'：'+(z?z.split('\n')[1]:'（通知なし）'));
  if(asin==='B0PBNOI001'){
    /* ItemID が無い行は通知そのものが出ない（出品していないので） */
    ok(z===''||/対象外/.test(z),'★ItemID が無い行は通知しないか理由を書く');
    continue;
  }
  ok(/対象外：/.test(z),'★★'+label+'：対象外と書く');
  ok(re.test(z),'★★★'+label+'：理由を書く');
  ok(/この行は直りません/.test(z),'★'+label+'：直らないと分かる');
}

console.log('\n=== 控えにも理由を残す（あとで調べられるように）===');
let one=ev('B0PBINB001')[0];
let d=JSON.parse(one.detail||"{}");
console.log('   '+JSON.stringify({act:d.pb_act,why:d.pb_why,mode:d.pb_mode}));
ok(d.pb_act==='','★★対象外は pb_act が空');
ok(/納品待ち/.test(String(d.pb_why||'')),'★★★理由を payload に残す');
ok(d.pb_mode==='on','★★そのときの⚙設定も残す');
let g=ev('B0PBOK0001')[0];
let dg=JSON.parse(g.detail||"{}");
ok(dg.pb_act==='zero'&&/寝かせる/.test(String(dg.pb_why||'')),
   '★★対象の行は act と理由が入る');

console.log('\n=== 1日1通のまま（dedup_key に理由を入れない）===');
const k1=ev('B0PBOK0001')[0].dedup_key;
await fire({ mode:'plan', restock:'confirm' });
const k2=ev('B0PBOK0001')[0].dedup_key;
console.log('   '+k1+' / '+k2);
ok(k1===k2,'★★★理由が変わっても同じ日は1通だけ');
ok(/^OVERSELL_RISK\|B0PBOK0001\|new\|\d{4}-\d{2}-\d{2}$/.test(k1),
   '★鍵は ASIN＋状態＋日付のまま');

console.log('\n=== 設定を渡さなければ今までの文のまま ===');
await fire(null);
t=text('B0PBOK0001');
console.log('   '+t.replace(/\n/g,' / '));
ok(/売り越しの恐れ/.test(t),'★文は出る');
ok(/フェイズB：/.test(t),'★★設定が無くても行の理由は書ける');
ok(/オフなので/.test(t)===false,'★★設定が無いのに「オフ」とは書かない');

console.log('\n=== 判定そのものは変えていない ===');
ok(typeof W.pbNoteFor==='function','★理由を作る関数がある');
ok(W.pbNoteFor({ ebay_item_id:'1', ebay_qty:1, on_hand:1 },{ mode:'on' })
   .indexOf('手元在庫あり')>=0,'★★★手元在庫は理由に出る（pbTarget と同じ判定）');

await T.done();
