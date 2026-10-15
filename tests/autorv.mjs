/* Worker：売値の見直しの自動反映（7.39）
   ・上げるだけ（値下げは自動値下げに任せる）。最低利益ラインより下げない
   ・相場の判断を優先し、見送り（skip）の行は数量0にする（出品は終了しない）
   ・「値下げしない」「一点物」の行も値上げはする。自動値下げの途中は上げない
     （赤字の行だけ例外）
   ・ReviseInventoryStatus を4件ずつ。許可表に増えたのはこの呼び出しだけ
   ・確認モードでは eBay を1回も呼ばず、予定を残して Discord に出す
   ・1日の上限（既定50件）と1回の変更幅の上限（既定30%）
   ・結果を rv_runs・rv_log（変更前後の売値つき）に残し、失敗は3回で警告
   ・再調達中の行は「出し直した売値」と「仕入値の上限」もそろえる */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：売値の見直しの自動反映');
const ok=T.ok;
const { worker, T:W }=await loadWorker('autorv');
const env=makeEnv();
const now=new Date().toISOString();

/* eBay への通信を差し替える。calls に ReviseInventoryStatus の本文を積む。
   fail に入れた ItemID は応答に返さない（その行だけ失敗する）。 */
let calls=[], fail={}, ack='Success', errText='', notes=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/ws\/api\.dll/.test(url)){
    const name=(o.headers||{})['X-EBAY-API-CALL-NAME']||'';
    const body=String(o.body||'');
    calls.push({name:name,body:body});
    const ids=(body.match(/<ItemID>(\d+)<\/ItemID>/g)||[])
      .map((x)=>x.replace(/\D/g,''));
    const okIds=ids.filter((x)=>!fail[x]);
    if(ack!=='Success'&&!okIds.length)
      return new Response('<ReviseInventoryStatusResponse><Ack>Failure</Ack><Errors>'
        +'<ErrorCode>21916884</ErrorCode><ShortMessage>'+errText+'</ShortMessage>'
        +'</Errors></ReviseInventoryStatusResponse>',
        {status:200,headers:{'content-type':'text/xml'}});
    return new Response('<ReviseInventoryStatusResponse><Ack>'
      +(okIds.length===ids.length?'Success':'Warning')+'</Ack>'
      +(okIds.length===ids.length?'':('<Errors><ErrorCode>21919188</ErrorCode>'
        +'<ShortMessage>'+(errText||'この出品は変えられません')+'</ShortMessage></Errors>'))
      +okIds.map((x)=>'<InventoryStatus><ItemID>'+x+'</ItemID></InventoryStatus>').join('')
      +'</ReviseInventoryStatusResponse>',
      {status:200,headers:{'content-type':'text/xml'}});
  }
  if(/discord/.test(url)){ notes.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response('',{status:204}); }
  throw new Error('想定外の通信: '+url);
};

let seq=0;
async function seed(asin,extra){
  seq++;
  const d=Object.assign({cond:'used',scope:'ebay',title:asin+'の商品',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:String(880000+seq),ebay_qty:1,
    ebay_price:20,rv_want:25,rv_floor:18,rv_kind:'none',rv_max_cost:3000,rv_fail:0,
    md_done:0,mark_stop:0,one_off:0,dropship:0,restocking:0,ebay_sale:null,
    restock_price:null,restock_max_cost:null,
    fba_available:1,fba_inbound:0,fba_reserved:0},extra||{});
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,rv_want,rv_floor,rv_kind,rv_max_cost,rv_at,rv_fail,
    md_done,mark_stop,one_off,dropship,restocking,ebay_sale,restock_price,
    restock_max_cost,fba_available,fba_inbound,fba_reserved,fba_seen_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?9,?14,?15,?16,?17,?18,?19,?20,
            ?21,?22,?23,?24,?25,?9,?9)`)
    .bind(asin,d.cond,d.scope,d.title,d.ebay_sku,d.ebay_item_id,d.ebay_qty,d.ebay_price,
      now,d.rv_want,d.rv_floor,d.rv_kind,d.rv_max_cost,d.rv_fail,d.md_done,d.mark_stop,
      d.one_off,d.dropship,d.restocking,d.ebay_sale,d.restock_price,d.restock_max_cost,
      d.fba_available,d.fba_inbound,d.fba_reserved).run();
  return d.ebay_item_id;
}
const row=async(asin)=>await env.DB.prepare(
  `SELECT ebay_price,ebay_qty,rv_want,rv_fail,rv_done_at,revise_err,
          restock_price,restock_max_cost FROM items WHERE asin=?1`).bind(asin).first();
const wipe=async()=>{
  await env.DB.prepare('DELETE FROM items').bind().run();
  await env.DB.prepare('DELETE FROM rv_log').bind().run();
  await env.DB.prepare('DELETE FROM rv_runs').bind().run();
};
let atSeq=0;
const setMode=async(mode,o)=>await asJson(await worker.fetch(post('/settings',
  {at:new Date(Date.now()+(++atSeq)*1000).toISOString(),
   settings:Object.assign({autoRvMode:mode,autoRvMax:'50',autoRvPct:'30',
     csvReviewAbs:'1',csvReviewPct:'3'},o||{})}),env));
const rv=async(body)=>(await asJson(await worker.fetch(
  post('/sync',Object.assign({kind:'review'},body||{})),env))).body;

console.log('=== 書き込みの見張り（増えたのは ReviseInventoryStatus だけ）===');
const guard=(call,write)=>{
  try{ W.assertReadOnly('https://api.ebay.com/ws/api.dll','POST',
        {'X-EBAY-API-CALL-NAME':call},write); return 'ok'; }
  catch(e){ return e.message.split(' ')[0]; }
};
console.log('   ReviseInventoryStatus（write有り）: '+guard('ReviseInventoryStatus',true));
console.log('   ReviseInventoryStatus（write無し）: '+guard('ReviseInventoryStatus',false));
console.log('   EndFixedPriceItem（write有り）    : '+guard('EndFixedPriceItem',true));
ok(guard('ReviseInventoryStatus',true)==='ok','★ReviseInventoryStatus は通る');
ok(guard('ReviseInventoryStatus',false)==='blocked_by_readonly_guard',
   '★write を付けない呼び出しは書き込めない');
ok(guard('ReviseFixedPriceItem',true)==='ok','自動値下げの呼び出しはそのまま通る');
ok(guard('EndFixedPriceItem',true)==='blocked_by_readonly_guard',
   '★出品を終了するAPIは通らない（見送りは数量0にするだけ）');
ok(guard('ReviseItem',true)==='blocked_by_readonly_guard','★ほかの書き込みも通らない');

console.log('\n=== 設定の読み方 ===');
await setMode('off');
let st=await W.rvSettings(env);
console.log('   '+JSON.stringify(st));
ok(st.mode==='off'&&st.max===50&&st.pct===30,'★オフ・1日50件・1回30%が既定');
await setMode('confirm',{autoRvMax:'5',autoRvPct:'10'});
st=await W.rvSettings(env);
ok(st.mode==='confirm'&&st.max===5&&st.pct===10,'★設定を変えれば読み替える');
ok(st.abs===1&&st.th===3,'★しきい値は出品CSVタブの設定（$1かつ3%）を使う');

console.log('\n=== 何をするかの判定（rvSkip / rvAct）===');
const S={mode:'auto',max:50,pct:30,abs:1,th:3};
const mk=(o)=>Object.assign({ebay_item_id:'1',ebay_qty:1,ebay_price:20,rv_want:25,
  rv_floor:18,rv_kind:'none',md_done:0},o||{});
const act=(o)=>W.rvAct(mk(o),S), why=(o)=>W.rvSkip(mk(o),S);
console.log('   上げる: '+JSON.stringify(act({})));
ok(act({}).kind==='up'&&act({}).to===25,'★推奨売値より低い行は推奨売値に上げる');
ok(why({rv_want:20.5})==='差が小さい','★差が金額のしきい値（$1）に届かない行はとばす');
ok(why({ebay_price:100,rv_want:102,rv_floor:90})==='差が小さい',
   '★差が割合のしきい値（3%）に届かない行もとばす');
ok(why({rv_want:15})==='上げる必要がありません',
   '★推奨売値のほうが低い行は下げない（値下げは自動値下げに任せる）');
ok(act({md_done:3})===null&&why({md_done:3})==='自動値下げの途中',
   '★自動値下げの途中の行は上げない（綱引きを防ぐ）');
console.log('   赤字（売値$17・下限$18）: '+JSON.stringify(act({ebay_price:17,md_done:3})));
ok(W.rvLoss(mk({ebay_price:17}))===true,'★いまの売値が最低利益ラインより下なら赤字');
ok(act({ebay_price:17,md_done:3}).kind==='up',
   '★赤字の行は、自動値下げの途中でも上げる');
ok(act({ebay_price:17,rv_want:17.5,md_done:3}).to===17.5,
   '★赤字の行はしきい値より小さい差でも上げる');
ok(act({mark_stop:1}).kind==='up'&&act({one_off:1}).kind==='up',
   '★「値下げしない」「一点物」の行も値上げはする');
ok(why({ebay_sale:1})==='eBayのセール中','★eBayのセール中はとばす');
ok(why({ebay_qty:0})==='数量0','★数量0の出品はとばす');
ok(why({rv_want:0})==='目標の売値が未設定','★目標が来ていない行は触らない');
ok(why({ebay_item_id:''})==='出品していません','★ItemIDが無い行は触らない');
console.log('   見送り: '+JSON.stringify(act({rv_kind:'skip',rv_want:0})));
ok(act({rv_kind:'skip',rv_want:0}).kind==='zero','★見送りの行は数量0にする');
ok(why({rv_kind:'skip',ebay_qty:0})==='すでに数量0','★すでに0の行は触らない');
console.log('   30%の上限（$20 → 目標$40）: '+JSON.stringify(act({rv_want:40})));
ok(act({rv_want:40}).to===26&&act({rv_want:40}).capped===true,
   '★1回の変更幅は30%まで（$20 → $26。残りは次の回）');

console.log('\n=== ReviseInventoryStatus の本文（4件ずつ・売値／数量0）===');
const body=W.invBody([{item_id:'111',kind:'up',to:25},{item_id:'222',kind:'zero',to:0}]);
console.log('   '+body.replace(/^<\?xml[^>]*>/,''));
ok(/<ReviseInventoryStatusRequest/.test(body),'★ReviseInventoryStatus で送る');
ok((body.match(/<InventoryStatus>/g)||[]).length===2,'★1回の本文に複数の行を入れる');
ok(/<ItemID>111<\/ItemID><StartPrice currencyID="USD">25\.00<\/StartPrice>/.test(body),
   '★値上げの行は売値だけを送る（ベストオファーは触らない）');
ok(/<ItemID>222<\/ItemID><Quantity>0<\/Quantity>/.test(body),
   '★見送りの行は数量0だけを送る（出品は終了しない）');

console.log('\n=== 確認モード：eBay を1回も呼ばず、予定を残す ===');
await wipe();
await seed('B0RV000001');
await seed('B0RV000002',{ebay_price:30,rv_want:33,rv_floor:25});
await setMode('confirm');
calls=[]; notes=[];
let res=await rv();
console.log('   '+JSON.stringify({mode:res.mode,picked:res.picked,changed:res.changed,
  calls:calls.length,plan:res.plan.map((x)=>x.from+'→'+x.to)}));
ok(calls.length===0,'★eBayへの呼び出しが0回');
ok(res.mode==='confirm'&&res.picked===2&&res.changed===0,'★予定だけ（2件）');
const stored=await W.rvPlanGet(env);
console.log('   保存した予定: '+JSON.stringify(stored&&{n:stored.n,rows:stored.rows.length}));
ok(stored&&stored.n===2&&stored.rows.length===2,'★予定を D1 に残す（画面に出すため）');
console.log('   通知: '+JSON.stringify(notes[0]||''));
ok(/確認モード/.test(notes[0]||'')&&/変更の予定 2件/.test(notes[0]||''),
   '★Discord に予定を出す');
ok(/まとめて実行/.test(notes[0]||''),'★承認の押し方も書く');
const keep=await row('B0RV000001');
ok(keep.ebay_price===20&&!keep.rv_done_at,'★D1 の売値も変えない');
const st1=await asJson(await worker.fetch(get('/status'),env));
ok(st1.body.rv_plan&&st1.body.rv_plan.n===2,'★GET /status でも予定を返す（画面に出す）');

console.log('\n=== 「まとめて実行」（承認）で実行する ===');
calls=[]; notes=[];
res=await rv({approve:true});
console.log('   '+JSON.stringify({mode:res.mode,changed:res.changed,zeroed:res.zeroed,
  failed:res.failed,calls:calls.length}));
ok(res.mode==='approve'&&res.changed===2&&res.failed===0,'★2件とも上げる');
ok(calls.length===1&&calls[0].name==='ReviseInventoryStatus',
   '★2件は1回の呼び出しでまとめて送る（4件ずつ）');
const a1=await row('B0RV000001');
console.log('   '+JSON.stringify(a1));
ok(a1.ebay_price===25&&a1.rv_fail===0&&!!a1.rv_done_at,
   '★D1 の売値も新しい値にそろえ、反映した時刻を残す');
const log=(await env.DB.prepare(
  'SELECT asin,kind,from_price,to_price,ok,why FROM rv_log ORDER BY id').all()).results;
console.log('   記録: '+JSON.stringify(log));
ok(log.length===2&&log[0].from_price===20&&log[0].to_price===25&&log[0].ok===1,
   '★変更前後の売値を記録する');
const runs=(await env.DB.prepare(
  'SELECT mode,picked,changed,zeroed,failed FROM rv_runs ORDER BY id').all()).results;
console.log('   実行ログ: '+JSON.stringify(runs));
ok(runs.length===2&&runs[0].mode==='confirm'&&runs[1].mode==='approve'
   &&runs[1].changed===2,'★確認の回と実行の回を rv_runs に残す');
console.log('   通知: '+JSON.stringify(notes[0]||''));
ok(/まとめて実行/.test(notes[0]||'')&&/上げた 2件/.test(notes[0]||''),
   '★実行結果も Discord に出す（変更前後の売値つき）');
ok(/\$20\.00 → \$25\.00/.test(notes[0]||''),'★「$20.00 → $25.00」と出す');
const after=await W.rvPlanGet(env);
ok(after&&after.n===0&&after.ran&&after.ran.changed===2,
   '★実行したら予定は空にして、結果を残す');
calls=[];
res=await rv({approve:true});
ok(calls.length===0&&res.changed===0,'★もう上げる行は無い（二度押しても変えない）');

console.log('\n=== 自動実行（設定で切り替え）===');
await wipe();
await seed('B0RV000010');
await setMode('auto');
calls=[]; notes=[];
res=await rv();
console.log('   '+JSON.stringify({mode:res.mode,changed:res.changed,calls:calls.length}));
ok(res.mode==='auto'&&res.changed===1&&calls.length===1,'★確認なしで実行する');
ok(/自動実行/.test(notes[0]||''),'★通知にもそう書く');

console.log('\n=== 見送りの行は数量0（出品は終了しない）===');
await wipe();
await seed('B0RV000020',{rv_kind:'skip',rv_want:0});
calls=[];
res=await rv();
console.log('   '+calls[0].body.replace(/^<\?xml[^>]*>/,''));
ok(res.zeroed===1&&res.changed===0,'★数量0にした件数で数える');
ok(/<Quantity>0<\/Quantity>/.test(calls[0].body)
   &&!/EndItem|EndFixedPriceItem/.test(calls[0].body),
   '★数量0を送るだけ（終了のAPIは呼ばない）');
const z=await row('B0RV000020');
ok(z.ebay_qty===0&&z.ebay_price===20,'★D1 の数量も0にする（売値はそのまま）');

console.log('\n=== 4件ずつ送る ===');
await wipe();
for(let i=1;i<=9;i++)await seed('B0RVB0000'+i);
calls=[];
res=await rv();
console.log('   呼び出し '+calls.length+'回／'
  +JSON.stringify(calls.map((c)=>(c.body.match(/<InventoryStatus>/g)||[]).length)));
ok(res.changed===9,'★9件を上げる');
ok(calls.length===3&&(calls[0].body.match(/<InventoryStatus>/g)||[]).length===4
   &&(calls[2].body.match(/<InventoryStatus>/g)||[]).length===1,
   '★4件＋4件＋1件の3回に分けて送る');

console.log('\n=== 1日の上限（既定50件・設定で変えられる）===');
await wipe();
await setMode('auto',{autoRvMax:'2'});
for(let i=1;i<=5;i++)await seed('B0RVC0000'+i);
calls=[];
res=await rv();
console.log('   '+JSON.stringify({picked:res.picked,changed:res.changed,capped:res.capped,
  used:res.used}));
ok(res.changed===2&&res.capped===3,'★上限2件まで変え、残り3件は翌日に回す');
calls=[];
res=await rv();
console.log('   同じ日にもう一度: '+JSON.stringify({changed:res.changed,used:res.used,
  capped:res.capped,calls:calls.length}));
ok(res.used===2&&res.changed===0&&calls.length===0,
   '★同じ日は、もう一度走らせても上限を超えない');
ok(/翌日/.test(notes.join('\n')),'★持ち越したことを通知に書く');

console.log('\n=== 失敗した行は次回に再試行し、3回で警告 ===');
await wipe();
await setMode('auto',{autoRvMax:'50'});
const badId=await seed('B0RVD00001');
fail[badId]=1; errText='この出品は変えられません';
let r3=null;
for(let i=1;i<=3;i++){ notes=[]; res=await rv(); r3=await row('B0RVD00001'); }
console.log('   3回目: '+JSON.stringify({failed:res.failed,fail3:res.fail3,
  rv_fail:r3.rv_fail,err:r3.revise_err,price:r3.ebay_price}));
ok(r3.rv_fail===3,'★失敗のたびに数え、毎回もう一度ためす');
ok(r3.ebay_price===20,'★失敗した行の売値は進めない');
ok(/売値の自動反映/.test(r3.revise_err||''),'★理由を行に残す（対応が必要に出す）');
ok(res.fail3===1&&/3回以上続けて失敗/.test(notes[0]||''),'★3回続いたら通知で知らせる');
const bad=(await env.DB.prepare(
  'SELECT ok,why FROM rv_log WHERE asin=?1 ORDER BY id').bind('B0RVD00001').all()).results;
ok(bad.length===3&&bad[0].ok===0&&/変えられません/.test(bad[0].why||''),
   '★失敗も記録に残す（理由つき）');
fail={}; notes=[];
res=await rv();
r3=await row('B0RVD00001');
console.log('   直ったあと: '+JSON.stringify({price:r3.ebay_price,rv_fail:r3.rv_fail,
  err:r3.revise_err}));
ok(r3.ebay_price===25&&r3.rv_fail===0&&!r3.revise_err,
   '★通ったら回数と理由を消す');

console.log('\n=== 権限が足りないときは打ち切って知らせる ===');
await wipe();
const sId=await seed('B0RVE00001');
await seed('B0RVE00002');
fail[sId]=1; ack='Failure'; errText='Insufficient permissions to fulfill the request';
calls=[]; notes=[];
res=await rv();
console.log('   '+JSON.stringify({changed:res.changed,failed:res.failed,
  calls:calls.length}));
ok(res.failed===1&&calls.length===1,'★最初の失敗で打ち切る（同じ失敗をくり返さない）');
ok(/権限が足りません/.test(notes[0]||''),'★トークンの取り直しを知らせる');
ack='Success'; errText=''; fail={};

console.log('\n=== 再調達中の行は「出し直した売値」と「仕入値の上限」もそろえる ===');
await wipe();
await seed('B0RVF00001',{restocking:1,restock_price:20,restock_max_cost:2500,
  rv_want:25,rv_max_cost:3800});
await seed('B0RVF00002',{restocking:1,restock_price:20,restock_max_cost:2500,
  rv_want:40,rv_max_cost:7000});      // 30%の上限で丸める行
res=await rv();
const f1=await row('B0RVF00001'), f2=await row('B0RVF00002');
console.log('   '+JSON.stringify({f1:f1,f2:f2}));
ok(f1.ebay_price===25&&f1.restock_price===25&&f1.restock_max_cost===3800,
   '★目標どおり上げた行は、売値と仕入値の上限を新しい値にする');
ok(f2.ebay_price===26&&f2.restock_price===26&&f2.restock_max_cost===2500,
   '★上限で丸めた行は売値だけ直し、仕入値の上限は前の値（安全側）のまま');

console.log('\n=== 目標は pj_price から受け取る（POST /listings）===');
await wipe();
await seed('B0RVG00001',{rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null});
let put=await asJson(await worker.fetch(post('/listings',{items:[
  {sku:'game-20260101-UG-B0RVG00001-1200',asin:'B0RVG00001',cond:'used',
   item_id:'880001',rv_want:25,rv_floor:18,rv_kind:'rec',rv_max_cost:3000}]}),env));
let g=await env.DB.prepare(
  `SELECT rv_want,rv_floor,rv_kind,rv_max_cost,rv_at,rv_fail FROM items WHERE asin=?1`)
  .bind('B0RVG00001').first();
console.log('   '+JSON.stringify({accepted:put.body.accepted,row:g}));
ok(g.rv_want===25&&g.rv_floor===18&&g.rv_kind==='rec'&&g.rv_max_cost===3000&&!!g.rv_at,
   '★目標（売値・下限・判断・仕入値の上限）を受け取って残す');
await env.DB.prepare('UPDATE items SET rv_fail=2 WHERE asin=?1').bind('B0RVG00001').run();
await worker.fetch(post('/listings',{items:[
  {sku:'game-20260101-UG-B0RVG00001-1200',asin:'B0RVG00001',cond:'used',
   item_id:'880001',rv_want:30,rv_floor:18,rv_kind:'rec',rv_max_cost:3500}]}),env);
g=await env.DB.prepare('SELECT rv_want,rv_fail FROM items WHERE asin=?1')
  .bind('B0RVG00001').first();
ok(g.rv_want===30&&g.rv_fail===0,'★目標が変わったら連続失敗の回数は0に戻す');
await worker.fetch(post('/listings',{items:[
  {sku:'game-20260101-UG-B0RVG00001-1200',asin:'B0RVG00001',cond:'used',
   item_id:'880001'}]}),env);
g=await env.DB.prepare('SELECT rv_want,rv_kind FROM items WHERE asin=?1')
  .bind('B0RVG00001').first();
ok(g.rv_want===30&&g.rv_kind==='rec','★送られてこない項目はそのまま残す');

console.log('\n=== オフのときは何もしない ===');
await wipe();
await seed('B0RVH00001');
await setMode('off');
calls=[]; notes=[];
res=await rv();
console.log('   '+JSON.stringify({mode:res.mode,changed:res.changed,calls:calls.length,
  notes:notes.length}));
ok(res.mode==='off'&&res.changed===0&&calls.length===0&&!notes.length,
   '★オフなら呼ばない・通知もしない');
res=await rv({approve:true});
ok(res.changed===1,'★ただし「まとめて実行」で押したときは実行する');

console.log('\n=== 直近の実行結果を返す（画面の「前回」）===');
const last=await W.rvLast(env);
console.log('   '+JSON.stringify(last&&{mode:last.mode,changed:last.changed}));
ok(last&&last.mode==='approve'&&last.changed===1,'★rv_last に前回の結果が入る');

T.done();
