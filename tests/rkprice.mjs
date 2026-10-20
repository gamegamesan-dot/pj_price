/* Worker：再調達中の売値を Amazon最安値に追従させる（7.48）
   ・対象は再調達中（restocking=1）の行だけ。上げも下げも承認なしで反映する
   ・上げは一度で（1回の変更幅の丸めはしない）。下げは最低売値（rk_floor）より下げない
   ・差が $1未満 かつ 3%未満のときは更新しない
   ・Amazon最安値が未取得／24時間より古い行は触らない
   ・最安グループが2人未満のときは上げだけ反映し、下げは保留する
   ・Amazonの在庫が消えた（最安値が出ない）行は数量0にして知らせる
   ・1日30件まで。eBayのセール中・一点物・無在庫は対象外
   ・ベストオファーのある出品は ReviseFixedPriceItem で自動拒否額も直す
   ・「確認してから」では eBay を1回も呼ばず、予定を残して Discord に出す
   ・売値を直した行は restock_price と restock_max_cost もそろえる（赤字の警告が消える）
   ・目標（rk_*）は pj_price から受け取る。作業者のキーでは送れない */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：再調達中の売値の追従');
const ok=T.ok;
const { worker, T:W }=await loadWorker('rkprice');
const env=makeEnv({ STAFF_KEY:'staff-key-123' });
const now=new Date().toISOString();
const ago=(ms)=>new Date(Date.now()-ms).toISOString();
const DAY=24*60*60*1000;

let calls=[], fail={}, errText='', notes=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/ws\/api\.dll/.test(url)){
    const name=(o.headers||{})['X-EBAY-API-CALL-NAME']||'';
    const body=String(o.body||'');
    calls.push({name:name,body:body});
    const ids=(body.match(/<ItemID>(\d+)<\/ItemID>/g)||[]).map((x)=>x.replace(/\D/g,''));
    const okIds=ids.filter((x)=>!fail[x]);
    if(name==='ReviseFixedPriceItem')
      return new Response('<ReviseFixedPriceItemResponse><Ack>'
        +(okIds.length?'Success':'Failure')+'</Ack>'
        +(okIds.length?'':('<Errors><ErrorCode>21919188</ErrorCode><ShortMessage>'
          +(errText||'だめ')+'</ShortMessage></Errors>'))
        +'</ReviseFixedPriceItemResponse>',
        {status:200,headers:{'content-type':'text/xml'}});
    return new Response('<ReviseInventoryStatusResponse><Ack>'
      +(okIds.length===ids.length?'Success':'Warning')+'</Ack>'
      +(okIds.length===ids.length?'':('<Errors><ErrorCode>21919188</ErrorCode>'
        +'<ShortMessage>'+(errText||'この出品は変えられません')+'</ShortMessage>'
        +ids.filter((x)=>fail[x]).map((x)=>'<ErrorParameters ParamID="0"><Value>'
          +x+'</Value></ErrorParameters>').join('')+'</Errors>'))
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
  const d=Object.assign({cond:'used',ebay_item_id:String(770000+seq),ebay_qty:1,
    ebay_price:84.36,restocking:1,restock_price:84.36,restock_max_cost:2500,
    one_off:0,dropship:0,ebay_sale:null,ebay_bo:0,ebay_bo_accept:null,
    amazon_lowest:5000,amazon_offers:3,amazon_lowest_at:now,amazon_new_low:null,
    rk_want:101.23,rk_floor:70,rk_low:5000,rk_n:3,rk_max_cost:7000,
    rk_want_at:now,rk_fail:0},extra||{});
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,restocking,restock_price,restock_max_cost,
    one_off,dropship,ebay_sale,ebay_bo,ebay_bo_accept,
    amazon_lowest,amazon_offers,amazon_lowest_at,amazon_new_low,
    rk_want,rk_floor,rk_low,rk_n,rk_max_cost,rk_want_at,rk_fail,updated_at)
    VALUES (?1,?2,'ebay',?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,
            ?20,?21,?22,?23,?24,?25,?26,?27,?8)`)
    .bind(asin,d.cond,asin+'の商品','E-'+asin+'-U',d.ebay_item_id,d.ebay_qty,
      d.ebay_price,now,d.restocking,d.restock_price,d.restock_max_cost,d.one_off,
      d.dropship,d.ebay_sale,d.ebay_bo,d.ebay_bo_accept,d.amazon_lowest,
      d.amazon_offers,d.amazon_lowest_at,d.amazon_new_low,d.rk_want,d.rk_floor,
      d.rk_low,d.rk_n,d.rk_max_cost,d.rk_want_at,d.rk_fail).run();
  return d.ebay_item_id;
}
const row=async(asin)=>await env.DB.prepare(
  `SELECT ebay_price,ebay_qty,rk_fail,rk_done_at,revise_err,ebay_sale,
          restock_price,restock_max_cost FROM items WHERE asin=?1`).bind(asin).first();
const wipe=async()=>{
  await env.DB.prepare('DELETE FROM items').bind().run();
  await env.DB.prepare('DELETE FROM rk_log').bind().run();
  await env.DB.prepare('DELETE FROM rk_runs').bind().run();
};
let atSeq=0;
const setMode=async(mode)=>await asJson(await worker.fetch(post('/settings',
  {at:new Date(Date.now()+(++atSeq)*1000).toISOString(),
   settings:{autoRkMode:mode,targetMode:'auto',baseProfit:'1000',linkRate:'30',
             saleRate:'15',usTaxRate:'8'}}),env));
const rk=async(body)=>(await asJson(await worker.fetch(
  post('/sync',Object.assign({kind:'restockprice'},body||{})),env))).body;

console.log('=== 既定は「自動で更新する」 ===');
await wipe(); calls=[]; notes=[];
await seed('B0RKA00001');
let res=await rk();
let a1=await row('B0RKA00001');
console.log('   '+JSON.stringify({mode:res.mode,up:res.up,down:res.down,row:a1}));
ok(res.mode==='auto','★★設定が無いときは自動（承認なし）');
ok(res.up===1&&res.down===0,'★★赤字の行を一度で上げる');
ok(a1.ebay_price===101.23,'★★目標の売値まで上げる（20%の丸めはしない）');
ok(a1.restock_price===101.23&&a1.restock_max_cost===7000,
   '★★出し直した売値と仕入値の上限もそろえる（赤字の警告が消える）');
ok(calls.length===1&&calls[0].name==='ReviseInventoryStatus',
   '★★実行は ReviseInventoryStatus');
ok(/再調達中の売値/.test(notes[0]||'')&&/上げた 1件/.test(notes[0]||''),
   '★Discord に出す');

console.log('\n=== 下げにも追従する（最低売値より下げない）===');
await wipe(); calls=[];
await seed('B0RKB00001',{ebay_price:101.23,rk_want:80,rk_floor:70});
await seed('B0RKB00002',{ebay_price:101.23,rk_want:50,rk_floor:70});  // 下限で止まる
res=await rk();
const b1=await row('B0RKB00001'), b2=await row('B0RKB00002');
console.log('   '+JSON.stringify({down:res.down,b1:b1.ebay_price,b2:b2.ebay_price}));
ok(res.down===2,'★★下げる方向も反映する');
ok(b1.ebay_price===80,'★目標まで下げる');
ok(b2.ebay_price===70,'★★最低売値（rk_floor）より下げない');
const why=await env.DB.prepare(
  "SELECT why FROM rk_log WHERE asin='B0RKB00002'").first();
ok(/最低売値で止めた/.test((why&&why.why)||''),'★止めたことを記録に残す');

console.log('\n=== 差が小さいときは更新しない（$1未満 かつ 3%未満）===');
await wipe(); calls=[];
await seed('B0RKC00001',{ebay_price:100,rk_want:100.5});        // $0.5・0.5%
await seed('B0RKC00002',{ebay_price:10,rk_want:10.6});          // $0.6 だが 6%
await seed('B0RKC00003',{ebay_price:100,rk_want:101.5});        // $1.5
res=await rk();
console.log('   '+JSON.stringify({picked:res.picked,up:res.up,skipped:res.skipped}));
ok(res.up===2&&res.skipped===1,'★★$1未満かつ3%未満の行だけとばす');
ok((await row('B0RKC00001')).ebay_price===100,'★その行は売値も変わらない');
ok((await row('B0RKC00002')).ebay_price===10.6,'★★3%以上なら $1未満でも反映する');

console.log('\n=== Amazon最安値の鮮度 ===');
await wipe(); calls=[];
await seed('B0RKD00001',{amazon_lowest_at:null});
await seed('B0RKD00002',{amazon_lowest_at:ago(DAY+60000)});
await seed('B0RKD00003');
res=await rk();
console.log('   '+JSON.stringify({up:res.up,skipped:res.skipped,calls:calls.length}));
ok(res.up===1&&res.skipped===2,'★★未取得・24時間より古い行は触らない');
ok((await row('B0RKD00001')).ebay_price===84.36
   &&(await row('B0RKD00002')).ebay_price===84.36,'★売値はそのまま');

/* 7.52 から、目標が古い／未設定の行は **Worker が自分で計算する**。
   「目標の売値が古い」で止まるのは、30分以内に pj_price から来た値が無く、
   かつ Worker も計算できない行（Amazon最安値が無い行）だけになった。 */
console.log('\n=== 目標が古い・未設定の行は Worker が自分で計算する（7.52）===');
await wipe(); calls=[];
await seed('B0RKE00001',{rk_want_at:ago(DAY+60000)});
await seed('B0RKE00002',{rk_want:null,rk_want_at:null});
res=await rk();
const e1=await env.DB.prepare(
  "SELECT rk_want,rk_floor,rk_low,rk_n,rk_max_cost,rk_want_at FROM items WHERE asin=?1")
  .bind('B0RKE00002').first();
console.log('   '+JSON.stringify({up:res.up,down:res.down,skipped:res.skipped})
  +' / 自分で計算: '+JSON.stringify(e1));
ok(e1.rk_want>0&&e1.rk_floor>0,'★★目標が無かった行にも目標が入る');
ok(e1.rk_low===5000,'★★基準にした Amazon最安値も残す');
ok(!!e1.rk_want_at,'★★自分で計算した時刻を入れる');
ok(res.up+res.down===2,'★★2行とも反映の対象になる（もう止まらない）');
// Amazon最安値が無い行は、Worker でも計算できないので今までどおり止まる
await wipe(); calls=[];
await seed('B0RKE00003',{rk_want:null,rk_want_at:null,
  amazon_lowest:0,amazon_offers:0});
res=await rk();
console.log('   最安値なし: '+JSON.stringify({zeroed:res.zeroed,skipped:res.skipped}));
ok(res.up===0&&res.down===0,'★★Amazon最安値が無い行は売値を動かさない');

console.log('\n=== 最安グループが2人未満のとき ===');
await wipe(); calls=[]; notes=[];
await seed('B0RKF00001',{ebay_price:101.23,rk_want:80,rk_n:1});   // 下げ → 保留
await seed('B0RKF00002',{ebay_price:84.36,rk_want:101.23,rk_n:1}); // 上げ → 反映
res=await rk();
const f1=await row('B0RKF00001'), f2=await row('B0RKF00002');
console.log('   '+JSON.stringify({up:res.up,down:res.down,held:res.held,
  f1:f1.ebay_price,f2:f2.ebay_price}));
ok(res.held===1&&res.down===0&&f1.ebay_price===101.23,
   '★★1人だけのときは下げを保留する');
ok(res.up===1&&f2.ebay_price===101.23,'★★上げる方向は保留しない（赤字を放置しない）');
ok(/下げを保留/.test(notes[0]||''),'★保留した件数を知らせる');

console.log('\n=== Amazonの在庫が消えたら数量0 ===');
await wipe(); calls=[]; notes=[];
await seed('B0RKG00001',{amazon_lowest:0,amazon_offers:0});
await seed('B0RKG00002',{amazon_lowest:0,amazon_offers:0,ebay_qty:0}); // もう済み
res=await rk();
const g1=await row('B0RKG00001');
console.log('   '+JSON.stringify({zeroed:res.zeroed,skipped:res.skipped,g1:g1}));
ok(res.zeroed===1&&g1.ebay_qty===0,'★★買い直せない行は eBay の数量を0にする');
ok(g1.ebay_price===84.36,'★売値は変えない（数量だけ）');
ok(/<Quantity>0<\/Quantity>/.test(calls[0].body),'★送るのは数量0だけ');
ok(/Amazonの在庫が消えた 1件/.test(notes[0]||''),'★★知らせる');
ok(res.skipped===1,'★すでに数量0の行はとばす');

console.log('\n=== 対象外（セール中・一点物・無在庫・再調達中でない）===');
await wipe(); calls=[];
await seed('B0RKH00001',{ebay_sale:1});
await seed('B0RKH00002',{one_off:1});
await seed('B0RKH00003',{dropship:1});
await seed('B0RKH00004',{restocking:0});
res=await rk();
console.log('   '+JSON.stringify({picked:res.picked,skipped:res.skipped,
  calls:calls.length}));
ok(res.picked===0&&calls.length===0,'★★どれも対象にしない');
ok(res.skipped===3,'★再調達中でない行は候補にも入らない');

console.log('\n=== ベストオファーのある出品 ===');
await wipe(); calls=[];
/* 自動承諾額が新しい売値以上の行（110 → 101.22 に下げる）。
   新しい売値より下にある承諾額（95 など）は触らない。 */
await seed('B0RKI00001',{ebay_bo:1,ebay_bo_accept:110,rk_want:101.23,rk_floor:70});
res=await rk();
console.log('   '+calls[0].name+'：'+calls[0].body.replace(/\s+/g,'').slice(0,240));
ok(calls[0].name==='ReviseFixedPriceItem',
   '★★ベストオファーのある出品は ReviseFixedPriceItem');
ok(/<MinimumBestOfferPrice[^>]*>70\.00</.test(calls[0].body),
   '★★自動拒否額を最低売値に直す（売値より下）');
ok(/<BestOfferAutoAcceptPrice[^>]*>101\.22</.test(calls[0].body),
   '★★自動承諾額が新しい売値以上なら下げる');
ok(W.rkBo({ebay_bo:1,rk_floor:70,ebay_bo_accept:95},101.23).acc===0,
   '★★新しい売値より下の承諾額は触らない');
ok(!/<Quantity>/.test(calls[0].body),'★★数量は送らない（増やさない）');

console.log('\n=== 「確認してから」では eBay を呼ばない ===');
await wipe(); calls=[]; notes=[];
await setMode('confirm');
await seed('B0RKJ00001');
res=await rk();
console.log('   '+JSON.stringify({mode:res.mode,picked:res.picked,up:res.up,
  calls:calls.length}));
ok(res.mode==='confirm'&&res.picked===1&&calls.length===0,
   '★★予定だけ立てて eBay は変えない');
ok((await row('B0RKJ00001')).ebay_price===84.36,'★売値はそのまま');
ok(/確認してから/.test(notes[0]||''),'★Discord に予定を出す');
let stt=await asJson(await worker.fetch(get('/status?limit=50'),env));
console.log('   予定: '+JSON.stringify(stt.body.rk_plan&&stt.body.rk_plan.rows));
ok(!!stt.body.rk_plan&&stt.body.rk_plan.n===1,'★★/status が予定を返す');
ok(stt.body.rk_plan.rows[0].to===101.23,'★予定に新しい売値が入る');
// 承認（まとめて実行）で実行できる
calls=[];
res=await rk({approve:true});
ok(res.mode==='approve'&&res.up===1&&calls.length===1,
   '★★approve で実行する');
ok((await row('B0RKJ00001')).ebay_price===101.23,'★売値が直る');
await setMode('auto');

console.log('\n=== 1日30件まで ===');
await wipe(); calls=[];
for(let i=0;i<32;i++)await seed('B0RKK'+String(10000+i));
res=await rk();
console.log('   '+JSON.stringify({picked:res.picked,up:res.up,capped:res.capped}));
ok(res.picked===32&&res.up===30&&res.capped===2,'★★1日30件で止める');
const used=await env.DB.prepare('SELECT COUNT(*) AS n FROM rk_log WHERE ok=1').first();
ok(Number(used.n)===30,'★記録も30件');
calls=[];
res=await rk();
ok(res.up===0&&res.capped===2&&calls.length===0,'★★同じ日のうちはもう変えない');

console.log('\n=== 失敗した行 ===');
await wipe(); calls=[]; notes=[];
const idL=await seed('B0RKL00001');
await seed('B0RKL00002');
fail[idL]=1; errText='この出品は変えられません';
res=await rk();
const l1=await row('B0RKL00001'), l2=await row('B0RKL00002');
console.log('   '+JSON.stringify({up:res.up,failed:res.failed,l1:l1}));
ok(res.failed===1&&res.up===1,'★失敗した行だけ数える（同じ回の他の行は通る）');
ok(l1.rk_fail===1&&/再調達中の売値/.test(l1.revise_err||''),'★★理由を残す');
ok(l2.ebay_price===101.23,'★通った行はそのまま直る');
fail={}; errText='';
res=await rk();
ok((await row('B0RKL00001')).rk_fail===0,'★★通ったら回数と理由を消す');

console.log('\n=== セール中のエラーは失敗に数えない ===');
await wipe(); calls=[];
const idM=await seed('B0RKM00001');
fail[idM]=1; errText='21919248 Promotional Sale';
res=await rk();
const m1=await row('B0RKM00001');
console.log('   '+JSON.stringify({failed:res.failed,m1:m1}));
ok(res.failed===0&&m1.ebay_sale===1,'★★セール中の印を立てて対象から外す');
ok(m1.rk_fail===0,'★連続失敗の回数は増やさない');
fail={}; errText='';

console.log('\n=== 目標は pj_price から受け取る ===');
await wipe();
await seed('B0RKN00001',{rk_want:null,rk_floor:null,rk_low:null,rk_n:null,
  rk_max_cost:null,rk_want_at:null});
let put=await asJson(await worker.fetch(post('/listings',{items:[
  {asin:'B0RKN00001',cond:'used',title:'x',
   rk_want:101.23,rk_floor:70,rk_low:5000,rk_n:3,rk_max_cost:7000}]}),env));
let n1=await env.DB.prepare(
  `SELECT rk_want,rk_floor,rk_low,rk_n,rk_max_cost,rk_want_at FROM items
    WHERE asin='B0RKN00001'`).first();
console.log('   '+JSON.stringify({put:put.body,n1:n1}));
ok(put.body.accepted===1&&n1.rk_want===101.23&&n1.rk_floor===70,'★★受け取る');
ok(n1.rk_low===5000&&n1.rk_n===3&&n1.rk_max_cost===7000,'★最安値・人数・上限も入る');
ok(!!n1.rk_want_at,'★★受け取った時刻が入る（24時間で古いとみなす）');
// 目標が変わったら連続失敗の回数は0に戻る
await env.DB.prepare("UPDATE items SET rk_fail=2 WHERE asin='B0RKN00001'").run();
await worker.fetch(post('/listings',{items:[
  {asin:'B0RKN00001',cond:'used',title:'x',rk_want:90}]}),env);
ok((await row('B0RKN00001')).rk_fail===0,'★★目標が変われば失敗の回数は0に戻る');

console.log('\n=== 作業者のキーでは目標を送れない ===');
const staff=await asJson(await worker.fetch(new Request('https://x/listings',
  {method:'POST',headers:{'X-PJ-Key':'staff-key-123','content-type':'application/json'},
   body:JSON.stringify({items:[{asin:'B0RKN00001',cond:'used',title:'x',rk_want:50}]})}),
  env));
console.log('   '+JSON.stringify(staff));
ok(staff.status===403&&staff.body.error==='forbidden_for_staff','★★403 で断る');
ok((staff.body.fields||[]).indexOf('rk_want')>=0,'★どの項目かを返す');
ok((await env.DB.prepare(
  "SELECT rk_want FROM items WHERE asin='B0RKN00001'").first()).rk_want===90,
  '★★D1 には1件も書かない');

console.log('\n=== 判定だけを直接見る（rkTarget）===');
const t=(o)=>W.rkTarget(Object.assign({restocking:1,ebay_item_id:'770001',ebay_qty:1,
  ebay_price:100,amazon_lowest:5000,amazon_offers:3,amazon_lowest_at:now,
  rk_want:120,rk_floor:70,rk_n:3,rk_want_at:now},o||{}));
ok(t({}).kind==='up','★上げる');
ok(t({rk_want:80}).kind==='down','★下げる');
ok(t({rk_want:80,rk_n:1}).held===true,'★★1人だけなら下げを保留');
ok(t({rk_want:120,rk_n:1}).kind==='up','★1人だけでも上げる');
ok(t({amazon_offers:0,amazon_lowest:0}).kind==='zero','★在庫が消えたら数量0');
ok(t({restocking:0}).kind===''&&/再調達中ではありません/.test(t({restocking:0}).why),
   '★再調達中でなければ何もしない');
ok(W.rkBo({ebay_bo:0},100).min===0,'★ベストオファーが無い出品は金額を送らない');
ok(W.rkBo({ebay_bo:1,rk_floor:70},100).min===70,'★自動拒否額は最低売値');
ok(W.rkBo({ebay_bo:1,rk_floor:0},100).min===99.99,
   '★最低売値が無ければ売値の1セント下');

await T.done();
