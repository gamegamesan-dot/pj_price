/* Worker：401件目以降の行も必ず判断される（7.81）
   2026-10-27 の不具合：pb_runs が15分ごとに picked=0・skipped=400 を繰り返し、
   401件目以降（巴マミ・B005LMX2HA など）は pb_why も pb_at も NULL のままだった。
   原因は2つ。
     ① 候補を選ぶ SQL が「eBayに出ていて数量≧1」だけで先頭400件を取っていた
        （items 約1,180件のうち、売り越しの恐れが無い行で枠が埋まっていた）
     ② 対象外の行に理由も時刻も書かなかったので、pb_at の古い順に並べても
        同じ400件をずっと見続けていた（窓が進まない）
   直したあとは、SQL の段階で「売り越しの恐れがある行」だけに絞ってから上限を
   かけるので、1,000件を超えていても対象の行が拾われる。 */
import { harness, loadWorker, makeEnv, post, asJson } from './lib.mjs';
const T=harness('Worker：401件目以降も判断される');
const ok=T.ok;
const { worker, T:W }=await loadWorker('pbwindow');
const env=makeEnv({ STAFF_KEY:'staff-key-123' });
const now=new Date().toISOString();

let calls=[], listing={};
const xmlItem=(id)=>{
  const l=listing[id]||{qty:1,price:30,status:'Active'};
  return '<GetItemResponse><Ack>Success</Ack><Item><ItemID>'+id+'</ItemID>'
    +'<Title>テスト</Title><Quantity>'+l.qty+'</Quantity>'
    +'<SellingStatus><QuantitySold>0</QuantitySold>'
    +'<CurrentPrice currencyID="USD">'+l.price.toFixed(2)+'</CurrentPrice>'
    +'<ListingStatus>'+l.status+'</ListingStatus></SellingStatus>'
    +'</Item></GetItemResponse>';
};
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/ws\/api\.dll/.test(url)){
    const name=(o.headers||{})['X-EBAY-API-CALL-NAME']||'';
    const body=String(o.body||'');
    calls.push({name:name,body:body});
    if(name==='GetItem')
      return new Response(xmlItem((/<ItemID>(\d+)<\/ItemID>/.exec(body)||[])[1]||''),
        {status:200,headers:{'content-type':'text/xml'}});
    if(name==='ReviseInventoryStatus'){
      const parts=[...body.matchAll(
        /<InventoryStatus><ItemID>(\d+)<\/ItemID>([\s\S]*?)<\/InventoryStatus>/g)];
      for(const m of parts){
        const l=listing[m[1]]||(listing[m[1]]={qty:1,price:30,status:'Active'});
        const q=/<Quantity>(\d+)<\/Quantity>/.exec(m[2]);
        if(q)l.qty=Number(q[1]);
      }
      return new Response('<ReviseInventoryStatusResponse><Ack>Success</Ack>'
        +parts.map((m)=>'<InventoryStatus><ItemID>'+m[1]+'</ItemID></InventoryStatus>')
          .join('')+'</ReviseInventoryStatusResponse>',
        {status:200,headers:{'content-type':'text/xml'}});
    }
    throw new Error('想定外の呼び出し: '+name);
  }
  if(/discord/.test(url))return new Response('',{status:204});
  throw new Error('想定外の通信: '+url);
};
let seq=0;
const seed=async(asin,extra)=>{
  seq++;
  const id=String(900000+seq);
  const d=Object.assign({cond:'used',scope:'ebay',ebay_qty:1,ebay_price:30,
    fba_available:0,fba_inbound:0,fba_reserved:0,on_hand:0,dropship:0,
    restocking:0,ebay_sale:0,mode:'hold',pb_skip:0,pb_fail:0,
    one_off:0,one_off_known:1},extra||{});
  listing[id]={qty:d.ebay_qty,price:d.ebay_price,status:'Active'};
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,
    ebay_item_id,ebay_qty,ebay_price,ebay_seen_at,fba_available,fba_inbound,
    fba_reserved,fba_seen_at,on_hand,one_off,one_off_known,dropship,restocking,
    ebay_sale,mode,pb_skip,pb_fail,amazon_offers,amazon_lowest,ebay_bo,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?9,?13,?14,?15,?16,?17,?18,
            ?19,?20,?21,3,3000,0,?9)`)
    .bind(asin,d.cond,d.scope,asin+'の商品','E-'+asin,id,d.ebay_qty,d.ebay_price,
      now,d.fba_available,d.fba_inbound,d.fba_reserved,d.on_hand,d.one_off,
      d.one_off_known,d.dropship,d.restocking,d.ebay_sale,d.mode,d.pb_skip,
      d.pb_fail).run();
  return id;
};
const row=async(asin)=>await env.DB.prepare(
  `SELECT ebay_qty,pb_act,pb_why,pb_at,pb_done_at FROM items WHERE asin=?1`)
  .bind(asin).first();
let atSeq=0;
const setCfg=async(o)=>await asJson(await worker.fetch(post('/settings',
  {at:new Date(Date.now()+(++atSeq)*1000).toISOString(),
   settings:Object.assign({pbMode:'on',pbRestock:'confirm',
     autoMdMode:'off',autoRvMode:'off'},o||{})}),env));
const pb=async()=>(await asJson(await worker.fetch(
  post('/sync',{kind:'phaseb'}),env))).body;

console.log('=== 1,180件のうち、対象は1,000件目あたりの1件だけ ===');
await setCfg({});
/* FBA在庫がある行（恐れなし）を1,000件。以前はここで枠が埋まっていた。 */
for(let i=0;i<1000;i++)
  await seed('B0FULL'+String(i).padStart(5,'0'),{ fba_available:3 });
/* 売り越しの恐れがある行を、そのうしろに1件だけ入れる（巴マミの位置）。 */
const target=await seed('B005LMX2HA',{ fba_available:0 });
/* さらに、恐れはあるが動かさない行（納品待ち）も後ろに入れる。 */
await seed('B0INBOUND01',{ fba_available:0, fba_inbound:2 });
for(let i=0;i<178;i++)
  await seed('B0TAIL'+String(i).padStart(5,'0'),{ fba_available:5 });
const n=await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first();
console.log('   items '+n.n+'件（1回で見る上限は '+W.PB_PICK_LIMIT+'件）');
ok(n.n>W.PB_PICK_LIMIT*2,'★上限よりずっと多い行がある（'+n.n+'件）');

console.log('\n=== 1回で判断される ===');
let res=await pb();
console.log('   '+JSON.stringify({risky:res.risky,picked:res.picked,
  zeroed:res.zeroed,skipped:res.skipped,capped:res.capped,
  pick_capped:res.pick_capped}));
ok(res.risky===2,'★★★売り越しの恐れがある2件だけを SQL で取る');
ok(res.picked===1,'★★★対象は1件（納品待ちは動かさない）');
ok(res.skipped===1,'★★対象外は「恐れはあるが動かさない」1件だけ');
ok(res.pick_capped===0,'★★1回で見る上限に当たらない');
let a=await row('B005LMX2HA');
console.log('   巴マミの位置の行: '+JSON.stringify(a));
ok(Number(a.ebay_qty)===0,'★★★1,000件目より後ろでも数量0になる');
ok(!!a.pb_done_at,'★★実行した時刻が入る');
ok(Number(listing[target].qty)===0,'★★★eBay 側も数量0になっている');

console.log('\n=== 対象外の行にも理由と時刻を残す（窓が進む）===');
let b=await row('B0INBOUND01');
console.log('   納品待ちの行: '+JSON.stringify({why:b.pb_why,at:!!b.pb_at}));
ok(/納品待ち/.test(String(b.pb_why||'')),'★★★対象外の理由を残す');
ok(!!b.pb_at,'★★★見た時刻（pb_at）を残す（NULL のままにしない）');

console.log('\n=== 恐れが上限を超えたら、残りを次の回に回す ===');
/* 上限より多い「恐れのある行」を作り、2回で全部が判断されることを見る。 */
await env.DB.prepare('DELETE FROM items').run();
listing={}; seq=0;
const many=[];
for(let i=0;i<W.PB_PICK_LIMIT+30;i++)
  many.push(await seed('B0MANY'+String(i).padStart(5,'0'),
    { fba_available:0, pb_skip:1 }));   // 恐れはあるが動かさない（呼び出しを増やさない）
res=await pb();
console.log('   1回目 '+JSON.stringify({risky:res.risky,skipped:res.skipped,
  pick_capped:res.pick_capped}));
ok(res.risky===W.PB_PICK_LIMIT+30,'★★恐れのある件数を数える');
ok(res.pick_capped===30,'★★★上限を超えた分を知らせる');
ok(res.skipped===W.PB_PICK_LIMIT,'★1回目は上限ぶんだけ判断する');
const left1=await env.DB.prepare(
  'SELECT COUNT(*) AS n FROM items WHERE pb_at IS NULL').first();
console.log('   まだ見ていない行 '+left1.n+'件');
ok(left1.n===30,'★★1回目で残りは30件');
res=await pb();
const left2=await env.DB.prepare(
  'SELECT COUNT(*) AS n FROM items WHERE pb_at IS NULL').first();
console.log('   2回目のあと '+left2.n+'件');
ok(left2.n===0,'★★★2回目で全件が判断される（窓が進む）');

console.log('\n=== 記録に件数を残す ===');
const last=await env.DB.prepare(
  'SELECT * FROM pb_runs ORDER BY id DESC LIMIT 1').first();
console.log('   '+String(last.note).slice(0,80));
ok(/売り越しの恐れ \d+件/.test(String(last.note||'')),
   '★★pb_runs に恐れのある件数を残す');

console.log('\n=== 通知とフェイズBで同じ判定を使う（条件のずれを防ぐ）===');
ok(typeof W.pbRisky==='function'&&typeof W.PB_SQL_RISKY==='string',
   '★判定が JS と SQL の1か所にある');
/* JS と SQL が同じ行を選ぶこと（取り違えがあればここで落ちる）。 */
await env.DB.prepare('DELETE FROM items').run();
listing={}; seq=0;
await seed('B0RSK000001',{ fba_available:0 });                    // 恐れあり
await seed('B0RSK000002',{ fba_available:0, fba_inbound:9 });     // 恐れあり（納品待ち）
await seed('B0RSK000003',{ fba_available:0, ebay_sale:1 });       // 恐れあり（セール中）
await seed('B0RSK000004',{ fba_available:0, pb_skip:1 });         // 恐れあり（動かさない）
await seed('B0RSK000005',{ fba_available:2 });                    // FBA在庫あり
await seed('B0RSK000006',{ fba_available:0, on_hand:1 });         // 手元在庫あり
await seed('B0RSK000007',{ fba_available:0, dropship:1 });        // 無在庫
await seed('B0RSK000008',{ fba_available:0, restocking:1 });      // 再調達中
await seed('B0RSK000009',{ fba_available:0, cond:'cart' });        // 手元から発送
await seed('B0RSK000010',{ fba_available:0, scope:'out' });        // eBay対象外
const bySql=(await env.DB.prepare(
  `SELECT asin FROM items WHERE ${W.PB_SQL_RISKY} ORDER BY asin`).all())
  .results.map((x)=>x.asin);
const all=env.DB._db.prepare('SELECT * FROM items ORDER BY asin').all();
const byJs=all.filter((r)=>W.pbRisky(r)).map((r)=>r.asin);
console.log('   SQL '+JSON.stringify(bySql));
console.log('   JS  '+JSON.stringify(byJs));
ok(bySql.join()===byJs.join(),'★★★SQL と JS が同じ行を選ぶ');
ok(bySql.length===4,'★★恐れがあるのは4件（納品待ち・セール中・動かさないも入れる）');
/* 通知も同じ判定なので、通知が出た行は必ず判断される */
await env.DB.prepare('DELETE FROM events').run();
await env.DB.batch(W.stateEvents(env,all,{mode:'on',restock:'confirm'}));
const ev=env.DB._db.prepare(
  "SELECT asin FROM events WHERE type='OVERSELL_RISK' ORDER BY asin").all()
  .map((x)=>x.asin);
console.log('   通知 '+JSON.stringify(ev));
ok(ev.join()===bySql.join(),
   '★★★通知が出る行と、フェイズBが判断する行が同じ');

await T.done();
