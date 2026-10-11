/* Worker：自動値下げ（3日ごとの値下げを eBay に直接反映・7.37）
   ・⚙設定が 'on' のときだけ eBay を変える。'plan' では1回も呼ばない
   ・値下げ幅は D1 の md_step（出品時に決めて保存した値）。最低売値で止まる
   ・ベストオファーの自動拒否額は必ず新しい売値より下（22003 を避ける）
   ・値下げしない・一点物・セール中・数量0・最低売値の行はとばす
   ・失敗した行は売値も回数も進めず、理由を revise_err に残す */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：自動値下げ（eBayに直接反映）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('automd');
const env=makeEnv();
const now=new Date().toISOString();
const ago=(d)=>new Date(Date.now()-d*86400000).toISOString();

/* eBay への通信をすべて差し替える。
   calls に ReviseFixedPriceItem の本文だけを積む（何回呼んだかを数える）。 */
let calls=[], ack='Success', errText='';
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/ws\/api\.dll/.test(url)){
    const name=(o.headers||{})['X-EBAY-API-CALL-NAME']||'';
    calls.push({name:name,body:String(o.body||'')});
    const body=(ack==='Success')
      ? '<ReviseFixedPriceItemResponse><Ack>Success</Ack></ReviseFixedPriceItemResponse>'
      : '<ReviseFixedPriceItemResponse><Ack>Failure</Ack><Errors><ErrorCode>21919137'
        +'</ErrorCode><ShortMessage>'+errText+'</ShortMessage></Errors>'
        +'</ReviseFixedPriceItemResponse>';
    return new Response(body,{status:200,headers:{'content-type':'text/xml'}});
  }
  if(/discord/.test(url))return new Response('',{status:204});
  throw new Error('想定外の通信: '+url);
};

async function seed(asin,extra){
  const d=Object.assign({cond:'used',scope:'ebay',title:asin+'の商品',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'99'+asin.slice(-4),ebay_qty:1,
    ebay_price:85,ebay_bo:1,ebay_bo_accept:null,ebay_bo_decline:60,
    md_step:2.5,md_start:85,md_floor:60,md_n:10,md_done:0,
    mark_at:null,mark_stop:0,one_off:0,dropship:0,restocking:0,ebay_sale:null,
    fba_available:1,fba_inbound:0,fba_reserved:0,fba_seen_at:now},extra||{});
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,ebay_bo,ebay_bo_accept,ebay_bo_decline,
    md_step,md_start,md_floor,md_n,md_done,mark_at,mark_stop,one_off,dropship,
    restocking,ebay_sale,fba_available,fba_inbound,fba_reserved,fba_seen_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,
            ?21,?22,?23,?24,?25,?26,?27,?28)`)
    .bind(asin,d.cond,d.scope,d.title,d.ebay_sku,d.ebay_item_id,d.ebay_qty,d.ebay_price,
      now,d.ebay_bo,d.ebay_bo_accept,d.ebay_bo_decline,d.md_step,d.md_start,d.md_floor,
      d.md_n,d.md_done,d.mark_at,d.mark_stop,d.one_off,d.dropship,d.restocking,
      d.ebay_sale,d.fba_available,d.fba_inbound,d.fba_reserved,d.fba_seen_at,now).run();
}
const row=async(asin)=>await env.DB.prepare(
  `SELECT ebay_price,mark_at,md_done,md_step,md_floor,ebay_bo_decline,revise_err
     FROM items WHERE asin=?1`).bind(asin).first();
const setMode=async(mode,max)=>await asJson(await worker.fetch(post('/settings',
  {at:new Date(Date.now()+1000).toISOString(),
   settings:{autoMdMode:mode,autoMdMax:String(max||200),csvMarkDays:'3',
             csvMarkTimes:'10',csvMarkStep:'1'}}),env));
const md=async()=>(await asJson(await worker.fetch(post('/sync',{kind:'markdown'}),env))).body;

console.log('=== 書き込みの見張り（ReviseFixedPriceItem だけ・write:true だけ）===');
const guard=(call,write)=>{
  try{ W.assertReadOnly('https://api.ebay.com/ws/api.dll','POST',
        {'X-EBAY-API-CALL-NAME':call},write); return 'ok'; }
  catch(e){ return e.message.split(' ')[0]; }
};
console.log('   Revise（write無し）: '+guard('ReviseFixedPriceItem',false));
console.log('   Revise（write有り）: '+guard('ReviseFixedPriceItem',true));
console.log('   AddItem（write有り）: '+guard('AddFixedPriceItem',true));
console.log('   GetMyeBaySelling   : '+guard('GetMyeBaySelling',false));
ok(guard('ReviseFixedPriceItem',false)==='blocked_by_readonly_guard',
   '★write を付けない呼び出しは書き込めない');
ok(guard('ReviseFixedPriceItem',true)==='ok','★自動値下げの呼び出しだけ通る');
ok(guard('AddFixedPriceItem',true)==='blocked_by_readonly_guard',
   '★ほかの書き込みAPIは通らない（出品も削除もできない）');
ok(guard('GetMyeBaySelling',false)==='ok','読み取りは今までどおり通る');

console.log('\n=== 設定の読み方 ===');
await setMode('off');
let st=await W.mdSettings(env);
console.log('   '+JSON.stringify(st));
ok(st.mode==='off'&&st.max===200&&st.days===3,'★オフ・上限200件・間隔3日');
await setMode('on',5);
st=await W.mdSettings(env);
ok(st.mode==='on'&&st.max===5,'★オン・上限5件');

console.log('\n=== 値下げ幅と次の売値（開始$85・最低$60・10回 → 幅$2.50）===');
const r0={ebay_price:85,md_step:2.5,md_floor:60,ebay_bo:1};
console.log('   次の売値: '+W.mdNext(r0)+'　自動拒否額: '+JSON.stringify(W.mdBo(r0,82.5)));
ok(W.mdNext(r0)===82.5,'★$85 → $82.50');
ok(W.mdNext({ebay_price:61,md_step:2.5,md_floor:60})===60,
   '★最低売値を下回るときは最低売値で止める（$61 → $60）');
ok(W.mdNext({ebay_price:60,md_step:2.5,md_floor:60})===null,
   '★最低売値に着いた行は下げない');
ok(W.mdBo(r0,82.5).min===60,'★自動拒否額は最低売値（売値より下）');
ok(W.mdBo({ebay_price:61,md_step:2.5,md_floor:60.5,ebay_bo:1},60.5).min===60.49,
   '★最低売値が新しい売値と同じときは1セント下げる（22003 を避ける）');
ok(W.mdBo({md_floor:60,ebay_bo:0},82.5).min===0,
   'ベストオファーを使っていない行には金額を出さない');
ok(W.mdBo({md_floor:60,ebay_bo:1,ebay_bo_accept:90},82.5).acc===82.49,
   '★自動承諾額が新しい売値以上の行は、売値の1セント下に下げる');
ok(W.mdBo({md_floor:60,ebay_bo:1,ebay_bo_accept:70},82.5).acc===0,
   '自動承諾額が売値より下の行はそのまま');

console.log('\n=== 「予定だけ表示」では eBay を1回も呼ばない ===');
const mark01=ago(5);
await seed('B0AUTOMD01',{mark_at:mark01});
await setMode('plan');
calls=[];
const plan=await md();
console.log('   '+JSON.stringify({mode:plan.mode,picked:plan.picked,changed:plan.changed,
  plan:plan.plan,calls:calls.length}));
ok(calls.length===0,'★eBayへの呼び出しが0回');
ok(plan.mode==='plan'&&plan.picked===1&&plan.changed===0,'★予定だけ（1件）');
ok(plan.plan[0].from===85&&plan.plan[0].to===82.5&&plan.plan[0].floor===60,
   '★予定に「$85.00 → $82.50（下限 $60.00）」が入る');
const keep=await row('B0AUTOMD01');
ok(Number(keep.ebay_price)===85&&keep.mark_at===mark01&&Number(keep.md_done)===0,
   '★売値・値下げした時刻・回数は変わらない');

console.log('\n=== オンにすると eBay を変える（3日ごとに$2.50）===');
await setMode('on');
calls=[]; ack='Success';
const r1=await md();
console.log('   '+JSON.stringify({changed:r1.changed,failed:r1.failed,skipped:r1.skipped}));
console.log('   呼び出し: '+calls.length+'回　'+(calls[0]||{}).name);
const body=(calls[0]||{}).body||'';
console.log('   '+body.replace(/^.*<Item>/,'<Item>'));
ok(calls.length===1&&calls[0].name==='ReviseFixedPriceItem',
   '★ReviseFixedPriceItem を1回呼ぶ');
ok(/<StartPrice currencyID="USD">82\.50<\/StartPrice>/.test(body),
   '★新しい売値（$82.50）を送る');
ok(/<MinimumBestOfferPrice currencyID="USD">60\.00<\/MinimumBestOfferPrice>/.test(body),
   '★自動拒否額も一緒に送る（ReviseInventoryStatus では変えられない）');
const a1=await row('B0AUTOMD01');
console.log('   '+JSON.stringify(a1));
ok(Number(a1.ebay_price)===82.5&&Number(a1.md_done)===1&&!!a1.mark_at,
   '★D1 の売値・回数・値下げした時刻が進む');
ok(Number(a1.ebay_bo_decline)===60,'自動拒否額も D1 に残す');

console.log('\n=== 間隔が空いていなければ下げない ===');
calls=[];
const r2=await md();
console.log('   '+JSON.stringify({picked:r2.picked,skipped:r2.skipped,calls:calls.length}));
ok(calls.length===0&&r2.changed===0&&r2.skipped===1,
   '★同じ日に2回動かしても下がらない（3日たつまで待つ）');

console.log('\n=== 3日ごとにくり返すと最低売値で止まる（開始$85・10回）===');
// 1度も下げていない行で、最低売値に着くまでくり返す
await seed('B0AUTOMD11',{mark_at:ago(5)});
const seen=[85];
for(let i=0;i<14;i++){
  await env.DB.prepare(`UPDATE items SET mark_at=?1 WHERE asin='B0AUTOMD11'`)
    .bind(ago(4)).run();
  calls=[];
  await md();
  const x=await row('B0AUTOMD11');
  if(Number(x.ebay_price)!==seen[seen.length-1])seen.push(Number(x.ebay_price));
  else break;
}
console.log('   '+seen.map((v)=>'$'+v.toFixed(2)).join(' → '));
ok(seen[1]===82.5&&seen[2]===80&&seen[seen.length-1]===60,
   '★$85 → $82.50 → $80.00 → …… → $60.00');
ok(seen.length===11,'★10回で最低売値に着く（回数の設定どおり）');
const last=await row('B0AUTOMD11');
ok(Number(last.md_done)===10,'値下げした回数も10回');
calls=[];
await env.DB.prepare(`UPDATE items SET mark_at=?1 WHERE asin='B0AUTOMD11'`)
  .bind(ago(4)).run();
const rEnd=await md();
ok(calls.length===0&&rEnd.changed===0,'★最低売値に着いた行はもう呼ばない');

console.log('\n=== 幅が $1 未満になる行は $1（pj_price が決めて保存した値を使う）===');
await seed('B0AUTOMD02',{ebay_price:30,md_start:30,md_floor:25,md_step:1,md_n:10,
  mark_at:ago(5)});
calls=[];
await md();
const b2=await row('B0AUTOMD02');
console.log('   $30.00 → $'+Number(b2.ebay_price).toFixed(2)+'（幅 $'+b2.md_step+'）');
ok(Number(b2.ebay_price)===29,'★（30−25）÷10＝$0.50 ではなく $1 下げる');

console.log('\n=== とばす行 ===');
await seed('B0AUTOMD03',{mark_stop:1,mark_at:ago(9)});
await seed('B0AUTOMD04',{one_off:1,mark_at:ago(9)});
await seed('B0AUTOMD05',{ebay_sale:1,mark_at:ago(9)});
await seed('B0AUTOMD06',{ebay_qty:0,mark_at:ago(9)});
await seed('B0AUTOMD07',{ebay_price:60,mark_at:ago(9)});
await seed('B0AUTOMD08',{dropship:1,mark_at:ago(9)});
await seed('B0AUTOMD09',{md_step:null,md_floor:null,mark_at:ago(9)});
const cut=ago(3);
for(const [asin,why] of [['B0AUTOMD03','値下げしない'],['B0AUTOMD04','一点物'],
  ['B0AUTOMD05','eBayのセール中'],['B0AUTOMD06','数量0'],
  ['B0AUTOMD07','最低売値に着いています'],['B0AUTOMD08','無在庫'],
  ['B0AUTOMD09','値下げ幅が未設定']]){
  const r=await env.DB.prepare(`SELECT * FROM items WHERE asin=?1`).bind(asin).first();
  const got=W.mdSkip(r,{days:3},cut);
  console.log('   '+asin+' → '+(got||'（対象）'));
  ok(got===why,'★'+why+'の行はとばす');
}
calls=[];
const r3=await md();
console.log('   '+JSON.stringify({picked:r3.picked,changed:r3.changed,skipped:r3.skipped,
  calls:calls.length}));
ok(calls.length===0&&r3.changed===0,'★とばす行だけのときは1回も呼ばない');

console.log('\n=== 失敗した行は売値も回数も進めない ===');
const markWas=ago(5);
await seed('B0AUTOMD10',{mark_at:markWas});
ack='Failure'; errText='Picture is too small (500px)';
calls=[];
const r4=await md();
const f=await row('B0AUTOMD10');
console.log('   '+JSON.stringify({changed:r4.changed,failed:r4.failed})+'　'+JSON.stringify(f));
ok(r4.failed===1&&r4.changed===0,'★失敗として数える');
ok(Number(f.ebay_price)===85&&Number(f.md_done)===0&&f.mark_at===markWas,
   '★売値・回数・値下げした時刻はそのまま（次の日にもう一度試す）');
ok(/自動値下げ/.test(String(f.revise_err||''))
   &&/500px/.test(String(f.revise_err||'')),
   '★理由を行に残す（「対応が必要」に出る）');
ack='Success';

console.log('\n=== 1日の上限で翌日に回す ===');
await env.DB.prepare(`UPDATE items SET mark_at=?1, revise_err=NULL
  WHERE asin IN ('B0AUTOMD02','B0AUTOMD10')`).bind(ago(5)).run();
await setMode('on',1);
calls=[];
const r5=await md();
console.log('   '+JSON.stringify({picked:r5.picked,changed:r5.changed,capped:r5.capped,
  calls:calls.length}));
ok(r5.picked===2&&r5.changed===1&&r5.capped===1&&calls.length===1,
   '★上限1件なら1件だけ変えて、残りは翌日に回す');

console.log('\n=== 実行結果を D1 に残す ===');
const log=await W.mdLast(env);
console.log('   '+JSON.stringify(log));
ok(!!log&&log.mode==='on'&&Number(log.changed)===1&&Number(log.capped)===1,
   '★md_runs に 下げた／失敗／とばした／翌日に回した 件数が入る');
const sb=(await asJson(await worker.fetch(get('/status?limit=50'),env))).body;
ok(!!sb.md_last&&Number(sb.md_last.changed)===1,
   '★一覧（/status）にも直近の実行結果を返す');

console.log('\n=== オフのときは何もしない ===');
await setMode('off');
calls=[];
const r6=await md();
console.log('   '+JSON.stringify({mode:r6.mode,picked:r6.picked,calls:calls.length}));
ok(r6.mode==='off'&&calls.length===0&&r6.picked===0,'★オフなら1回も呼ばない');

console.log('\n=== 値下げ幅は pj_price から受け取る（POST /listings）===');
const put=await asJson(await worker.fetch(post('/listings',{at:now,items:[
  {asin:'B0AUTOMD09',cond:'used',custom_label:'E-B0AUTOMD09-U',
   md_step:3.2,md_start:92,md_floor:60,md_n:10}]}),env));
console.log('   '+JSON.stringify(put.body.accepted));
const g9=await row('B0AUTOMD09');
console.log('   '+JSON.stringify(g9));
ok(Number(g9.md_step)===3.2&&Number(g9.md_floor)===60,
   '★md_step・md_floor が入る（これが入るまで自動値下げは動かない）');
await env.DB.prepare(`UPDATE items SET md_done=4 WHERE asin='B0AUTOMD09'`).run();
await asJson(await worker.fetch(post('/listings',{at:now,items:[
  {asin:'B0AUTOMD09',cond:'used',md_step:3.2,md_start:92,md_floor:60,md_n:10}]}),env));
const g9b=await env.DB.prepare(`SELECT md_done FROM items WHERE asin='B0AUTOMD09'`).first();
ok(Number(g9b.md_done)===4,'同じ開始価格を送り直しても回数は戻らない');
await asJson(await worker.fetch(post('/listings',{at:now,items:[
  {asin:'B0AUTOMD09',cond:'used',md_step:4,md_start:100,md_floor:60,md_n:10}]}),env));
const g9c=await env.DB.prepare(`SELECT md_done,md_step FROM items WHERE asin='B0AUTOMD09'`)
  .first();
console.log('   開始価格を変えたあと: '+JSON.stringify(g9c));
ok(Number(g9c.md_done)===0&&Number(g9c.md_step)===4,
   '★開始価格が変わったら回数を0に戻す（再出品・値上げのあと）');
T.done();
