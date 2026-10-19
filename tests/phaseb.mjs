/* Worker：フェイズB（FBAで売れたら eBay を直す・7.47）
   ・2章の条件（手元在庫・-C/-L・無在庫・再調達中・セール中・納品待ちは対象外）
   ・予約済みは「顧客注文あり」だけ対象。FC移管・受領処理中は対象外。
     内訳不明は動かさず、24時間たったら知らせる
   ・在庫0時の動作にかかわらず、**まず全部を数量0**にする
   ・再調達は、数量0にしたうえで「売値を pb_want に変えて数量を1に戻す」を1回の書き込みで
   ・pb_want が無い／古い／最安グループ2人未満なら数量0のまま理由を出す
   ・書き込みの前に GetItem で数量と売値を確かめ、違えば実行しない
   ・数量0の直後に GetItem で Active を確かめ、終了していたら知らせる
   ・数量を増やすのは再調達のときだけ。1回20件／1日30件 */
import { harness, loadWorker, makeEnv, post, asJson } from './lib.mjs';
const T=harness('Worker：フェイズB（FBAで売れたら数量0・再調達）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('phaseb');
const env=makeEnv({ STAFF_KEY:'staff-key-123' });
const now=new Date().toISOString();

/* eBay の出品の状態をまねる。calls に呼び出しを積む。 */
let calls=[], listing={}, endOnZero=false, failIds={}, notes=[];
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
      const bad=[], good=[];
      for(const m of parts){
        const id=m[1], inner=m[2];
        if(failIds[id]){ bad.push(id); continue; }
        const l=listing[id]||(listing[id]={qty:1,price:30,status:'Active'});
        const q=/<Quantity>(\d+)<\/Quantity>/.exec(inner);
        const p=/<StartPrice[^>]*>([0-9.]+)<\/StartPrice>/.exec(inner);
        if(q)l.qty=Number(q[1]);
        if(p)l.price=Number(p[1]);
        if(q&&Number(q[1])===0&&endOnZero)l.status='Completed';
        good.push(id);
      }
      return new Response('<ReviseInventoryStatusResponse><Ack>'
        +(bad.length?'Warning':'Success')+'</Ack>'
        +bad.map((x)=>'<Errors><ErrorCode>21919188</ErrorCode>'
          +'<ShortMessage>この出品は変えられません</ShortMessage>'
          +'<ErrorParameters ParamID="0"><Value>'+x+'</Value></ErrorParameters>'
          +'</Errors>').join('')
        +good.map((x)=>'<InventoryStatus><ItemID>'+x+'</ItemID></InventoryStatus>').join('')
        +'</ReviseInventoryStatusResponse>',{status:200,headers:{'content-type':'text/xml'}});
    }
    if(name==='ReviseFixedPriceItem'){
      const id=(/<ItemID>(\d+)<\/ItemID>/.exec(body)||[])[1]||'';
      if(failIds[id])
        return new Response('<ReviseFixedPriceItemResponse><Ack>Failure</Ack><Errors>'
          +'<ErrorCode>21919188</ErrorCode><ShortMessage>だめ</ShortMessage></Errors>'
          +'</ReviseFixedPriceItemResponse>',{status:200,headers:{'content-type':'text/xml'}});
      const l=listing[id]||(listing[id]={qty:1,price:30,status:'Active'});
      const q=/<Quantity>(\d+)<\/Quantity>/.exec(body);
      const p=/<StartPrice[^>]*>([0-9.]+)<\/StartPrice>/.exec(body);
      if(q)l.qty=Number(q[1]);
      if(p)l.price=Number(p[1]);
      return new Response('<ReviseFixedPriceItemResponse><Ack>Success</Ack>'
        +'</ReviseFixedPriceItemResponse>',{status:200,headers:{'content-type':'text/xml'}});
    }
    throw new Error('想定外の呼び出し: '+name);
  }
  if(/discord/.test(url)){ notes.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response('',{status:204}); }
  throw new Error('想定外の通信: '+url);
};

let seq=0;
async function seed(asin,extra){
  seq++;
  const id=String(990000+seq);
  const d=Object.assign({cond:'used',scope:'ebay',ebay_item_id:id,ebay_qty:1,
    ebay_price:30,fba_available:0,fba_inbound:0,fba_reserved:0,
    fba_res_cust:null,fba_res_trans:null,fba_res_proc:null,
    on_hand:0,one_off:0,one_off_known:1,dropship:0,restocking:0,ebay_sale:0,
    mode:'hold',pb_want:null,pb_want_at:null,pb_max_cost:null,pb_skip:0,pb_fail:0,
    amazon_offers:3,amazon_lowest:3000,ebay_bo:0},extra||{});
  listing[id]={qty:d.ebay_qty,price:d.ebay_price,status:'Active'};
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,fba_available,fba_inbound,fba_reserved,
    fba_res_cust,fba_res_trans,fba_res_proc,fba_seen_at,on_hand,one_off,one_off_known,
    dropship,restocking,ebay_sale,mode,pb_want,pb_want_at,pb_max_cost,pb_skip,pb_fail,
    amazon_offers,amazon_lowest,ebay_bo,updated_at)
    VALUES (?1,?2,'ebay',?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?8,?15,?16,?17,?18,
            ?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?8)`)
    .bind(asin,d.cond,asin+'の商品','E-'+asin+'-U',id,d.ebay_qty,d.ebay_price,now,
      d.fba_available,d.fba_inbound,d.fba_reserved,d.fba_res_cust,d.fba_res_trans,
      d.fba_res_proc,d.on_hand,d.one_off,d.one_off_known,d.dropship,d.restocking,
      d.ebay_sale,d.mode,d.pb_want,d.pb_want_at,d.pb_max_cost,d.pb_skip,d.pb_fail,
      d.amazon_offers,d.amazon_lowest,d.ebay_bo).run();
  return id;
}
const row=async(asin)=>await env.DB.prepare(
  `SELECT ebay_qty,ebay_price,pb_act,pb_why,pb_at,pb_done_at,pb_fail,restocking,
          restock_price,revise_err FROM items WHERE asin=?1`).bind(asin).first();
const wipe=async()=>{
  await env.DB.prepare('DELETE FROM items').run();
  await env.DB.prepare('DELETE FROM pb_log').run();
  await env.DB.prepare('DELETE FROM pb_runs').run();
  calls=[]; listing={}; failIds={}; endOnZero=false; notes=[];
};
let atSeq=0;
const setCfg=async(o)=>await asJson(await worker.fetch(post('/settings',
  {at:new Date(Date.now()+(++atSeq)*1000).toISOString(),
   settings:Object.assign({pbMode:'plan',pbRestock:'confirm',
     autoMdMode:'off',autoRvMode:'off'},o||{})}),env));
const pb=async(body)=>(await asJson(await worker.fetch(
  post('/sync',Object.assign({kind:'phaseb'},body||{})),env))).body;

console.log('=== 設定の既定 ===');
await setCfg({});
let st=await W.pbSettings(env);
console.log('   '+JSON.stringify(st));
ok(st.mode==='plan'&&st.restock==='confirm','★既定は「予定だけ表示」・再調達は確認モード');
ok(W.PB_ZERO_MAX===20&&W.PB_RESTOCK_MAX===30,'★上限は数量0が20件・再調達が30件');

console.log('\n=== 対象にするか（2章）===');
const t=(x)=>W.pbTarget(Object.assign({ebay_item_id:'1',ebay_qty:1,fba_available:0,
  fba_inbound:0,fba_reserved:0,fba_seen_at:now,on_hand:0,one_off:0,one_off_known:1,
  dropship:0,restocking:0,ebay_sale:0,mode:'hold',cond:'used'},x));
console.log('   寝かせる: '+JSON.stringify(t({})));
console.log('   再調達: '+JSON.stringify(t({mode:'restock'})));
ok(t({}).act==='zero','★ふつうの行は数量0');
ok(t({mode:'restock'}).act==='restock','★★再調達の行は再調達の予定');
ok(t({mode:'end'}).act==='zero','★終了の指定でも数量0（出品は終わらせない）');
ok(t({mode:''}).act==='zero'&&/未設定|寝かせる/.test(t({mode:''}).why),
   '★★在庫0時の動作が未設定なら「寝かせる」扱い');
ok(t({mode:'restock',one_off:1}).act==='zero','★★一点物は再調達にしない');
ok(t({mode:'restock',one_off_known:0}).act==='zero'
   &&/未確定/.test(t({mode:'restock',one_off_known:0}).why),
   '★★一点物が未確定なら再調達にしない');
ok(t({on_hand:1}).act===''&&/手元在庫/.test(t({on_hand:1}).why),'★手元在庫ありは対象外');
ok(t({cond:'cart'}).act===''&&t({cond:'loose'}).act==='',
   '★★手元から発送（-C／-L）は対象外');
ok(t({dropship:1}).act==='','★無在庫は対象外');
ok(t({restocking:1}).act==='','★★再調達中は対象外（二度処理しない）');
ok(t({ebay_sale:1}).act===''&&/セール/.test(t({ebay_sale:1}).why),
   '★★eBayのセール中は対象外');
ok(t({fba_inbound:1}).act==='','★納品待ちは対象外');
ok(t({fba_available:1}).act==='','★FBA在庫ありは対象外');
ok(t({pb_skip:1}).act==='','★「今回は動かさない」は対象外');
ok(t({pb_fail:3}).act==='','★★3回続けて失敗した行は自動処理から外す');
console.log('   予約済み（顧客注文）: '+JSON.stringify(t({fba_reserved:1,fba_res_cust:1})));
ok(t({fba_reserved:1,fba_res_cust:1,fba_res_trans:0,fba_res_proc:0}).act==='zero',
   '★★予約済みでも顧客注文があれば「売れた」とみなす');
ok(t({fba_reserved:1,fba_res_cust:0,fba_res_trans:1,fba_res_proc:0}).act==='',
   '★★FC移管・受領処理中だけなら対象外');
ok(t({fba_reserved:1}).act==='unknown','★★内訳不明は動かさない');

console.log('\n=== 予定だけ表示（eBayを変えない）===');
await wipe(); await setCfg({pbMode:'plan'});
await seed('B0PHB00001');                       // 寝かせる
await seed('B0PHB00002',{mode:'restock'});      // 再調達
await seed('B0PHB00003',{on_hand:1});           // 対象外
let res=await pb();
console.log('   '+JSON.stringify({mode:res.mode,picked:res.picked,zero:res.zero_plan,
  restock:res.restock_plan,skipped:res.skipped}));
let a=await row('B0PHB00001'), b=await row('B0PHB00002');
console.log('   '+JSON.stringify({a:a.pb_act,b:b.pb_act,qty:a.ebay_qty}));
ok(res.zero_plan===1&&res.restock_plan===1&&res.skipped===1,'★予定を数える');
ok(a.pb_act==='zero'&&b.pb_act==='restock','★★予定を残す');
ok(Number(a.ebay_qty)===1&&!calls.some((c)=>/Revise/.test(c.name)),
   '★★予定だけのときは eBay を1回も変えない');
ok(notes.some((x)=>/予定だけ表示/.test(x)),'★Discord に予定を出す');

console.log('\n=== オン：まず全部を数量0にする ===');
await wipe(); await setCfg({pbMode:'on'});
const id1=await seed('B0PHB00011');                        // 寝かせる
const id2=await seed('B0PHB00012',{mode:'restock'});       // 再調達（まず数量0）
res=await pb();
a=await row('B0PHB00011'); b=await row('B0PHB00012');
console.log('   '+JSON.stringify({zeroed:res.zeroed,restocked:res.restocked,
  a:a.ebay_qty,b:b.ebay_qty,bAct:b.pb_act}));
ok(res.zeroed===2,'★★在庫0時の動作にかかわらず、まず数量0にする');
ok(Number(a.ebay_qty)===0&&Number(b.ebay_qty)===0,'★★D1 の数量も0にする');
ok(listing[id1].qty===0&&listing[id2].qty===0,'★★eBay の数量が0になる');
ok(b.pb_act==='restock'&&!a.pb_act,'★★再調達の行は予定を残す（承認待ち）');
ok(res.restocked===0,'★確認モードでは再調達までは進まない');
ok(!calls.some((c)=>/<Quantity>[1-9]/.test(c.body)),
   '★★数量を増やす呼び出しはしない');
const g=calls.filter((c)=>c.name==='GetItem').length;
console.log('   GetItem '+g+'回／Revise '
  +calls.filter((c)=>c.name==='ReviseInventoryStatus').length+'回');
ok(g>=4,'★★書き込みの前と後に GetItem で確かめる');

console.log('\n=== 判定したときと違う行は触らない ===');
await wipe(); await setCfg({pbMode:'on'});
const id3=await seed('B0PHB00021');
listing[id3].price=99;                 // eBay 側だけ売値が変わった
res=await pb();
a=await row('B0PHB00021');
console.log('   '+JSON.stringify({zeroed:res.zeroed,skipped:res.skipped,why:a.pb_why}));
ok(res.zeroed===0&&Number(a.ebay_qty)===1,'★★数量・売値が変わっていたら実行しない');
ok(/数量か売値が変わっています/.test(String(a.pb_why||'')),'★理由を残す');

console.log('\n=== 数量0にしたら出品が終わってしまったとき ===');
await wipe(); await setCfg({pbMode:'on'});
endOnZero=true;
await seed('B0PHB00031');
res=await pb();
console.log('   '+JSON.stringify({zeroed:res.zeroed,ended:res.ended}));
ok(res.zeroed===1&&res.ended===1,'★★出品が終了したら数える');
ok(notes.some((x)=>/出品が終了しました/.test(x)),
   '★★Out-of-stock control を確かめるように知らせる');
endOnZero=false;

console.log('\n=== 再調達（承認して実行）===');
await wipe(); await setCfg({pbMode:'on',pbRestock:'confirm'});
const id4=await seed('B0PHB00041',{mode:'restock',pb_want:52.3,
  pb_want_at:new Date().toISOString(),pb_max_cost:4000});
res=await pb();                     // まず数量0
ok(listing[id4].qty===0,'★先に数量0にする（古い売値で売れないように）');
res=await pb({approve:true});       // 承認して再調達
a=await row('B0PHB00041');
console.log('   '+JSON.stringify({restocked:res.restocked,qty:listing[id4].qty,
  price:listing[id4].price,restocking:a.restocking,rp:a.restock_price}));
ok(res.restocked===1&&listing[id4].qty===1&&listing[id4].price===52.3,
   '★★売値を変えて数量を1に戻す（1回の書き込み）');
ok(Number(a.restocking)===1&&Number(a.restock_price)===52.3&&!a.pb_act,
   '★★「再調達中」の印を付け、予定を消す');
const inv=calls.filter((c)=>c.name==='ReviseInventoryStatus').pop();
ok(/<StartPrice[^>]*>52.30<\/StartPrice><Quantity>1<\/Quantity>/.test(inv.body),
   '★★売値と数量を1回のリクエストで送る');

console.log('\n=== 再調達しない理由 ===');
await wipe(); await setCfg({pbMode:'on',pbRestock:'auto'});
const old=new Date(Date.now()-30*3600*1000).toISOString();
await seed('B0PHB00051',{mode:'restock'});                                  // 目標なし
await seed('B0PHB00052',{mode:'restock',pb_want:50,pb_want_at:old});        // 古い
await seed('B0PHB00053',{mode:'restock',pb_want:50,
  pb_want_at:new Date().toISOString(),amazon_offers:1});                    // 最安1人
res=await pb();
const w1=await row('B0PHB00051'), w2=await row('B0PHB00052'), w3=await row('B0PHB00053');
console.log('   '+JSON.stringify([w1.pb_why,w2.pb_why,w3.pb_why]));
ok(res.restocked===0,'★★条件を満たさない行は再調達しない');
ok(/目標の売値が届いていません/.test(w1.pb_why||''),'★目標が無い理由');
ok(/古い/.test(w2.pb_why||''),'★★24時間より古い目標は使わない');
ok(/最安グループが2人未満/.test(w3.pb_why||''),'★★最安グループ2人未満の理由');
ok(Number(w1.ebay_qty)===0&&Number(w2.ebay_qty)===0&&Number(w3.ebay_qty)===0,
   '★★数量0のままにする');

console.log('\n=== ベストオファーの出品は ReviseFixedPriceItem ===');
await wipe(); await setCfg({pbMode:'on',pbRestock:'auto'});
const id5=await seed('B0PHB00061',{mode:'restock',ebay_bo:1,pb_want:60,
  pb_want_at:new Date().toISOString()});
await pb();
console.log('   '+JSON.stringify({qty:listing[id5].qty,price:listing[id5].price}));
const fx=calls.filter((c)=>c.name==='ReviseFixedPriceItem').pop();
ok(!!fx&&/<Quantity>1<\/Quantity>/.test(fx.body),
   '★★自動拒否額を使う出品は ReviseFixedPriceItem で価格と数量を送る');
ok(/MinimumBestOfferPrice/.test(fx.body),'★★自動拒否額も直す');
ok(listing[id5].qty===1&&listing[id5].price===60,'★eBay が新しい値段と数量になる');

console.log('\n=== 失敗したら3回で自動処理から外す ===');
await wipe(); await setCfg({pbMode:'on'});
const id6=await seed('B0PHB00071');
failIds[id6]=1;
await pb(); await pb(); await pb();
a=await row('B0PHB00071');
console.log('   '+JSON.stringify({fail:a.pb_fail,err:String(a.revise_err||'').slice(0,40)}));
ok(Number(a.pb_fail)===3&&/数量0にできません/.test(String(a.revise_err||'')),
   '★★失敗の回数と理由を残す');
ok(W.pbTarget(Object.assign({},{ebay_item_id:id6,ebay_qty:1,fba_available:0,
  fba_inbound:0,fba_reserved:0,fba_seen_at:now,on_hand:0,pb_fail:3})).act==='',
   '★★3回失敗したら対象から外す（対応が必要）');

console.log('\n=== 内訳不明が24時間続いたら知らせる ===');
await wipe(); await setCfg({pbMode:'on'});
await seed('B0PHB00081',{fba_reserved:1});
await pb();
a=await row('B0PHB00081');
ok(a.pb_act==='unknown'&&!!a.pb_at,'★いつから分からないかを残す');
await env.DB.prepare(`UPDATE items SET pb_at=?1 WHERE asin='B0PHB00081'`)
  .bind(new Date(Date.now()-30*3600*1000).toISOString()).run();
notes=[];
res=await pb();
console.log('   '+JSON.stringify({unknown:res.unknown,old:res.unknown_old}));
ok(res.unknown_old===1&&notes.some((x)=>/24時間以上分かりません/.test(x)),
   '★★24時間たっても不明なら「対応が必要」と知らせる');

console.log('\n=== 1回20件まで ===');
await wipe(); await setCfg({pbMode:'on'});
for(let i=1;i<=23;i++)await seed('B0PHB1'+String(100+i));
res=await pb();
console.log('   '+JSON.stringify({picked:res.picked,zeroed:res.zeroed,capped:res.capped}));
ok(res.zeroed===20&&res.capped===3,'★★1回に数量0にするのは20件まで');

console.log('\n=== 作業者キーでは送れない ===');
const staff=await asJson(await worker.fetch(new Request('https://x/listings',
  {method:'POST',headers:{'X-PJ-Key':'staff-key-123','content-type':'application/json'},
   body:JSON.stringify({items:[{asin:'B0PHB00001',cond:'used',pb_want:50}]})}),env));
console.log('   '+JSON.stringify(staff.body));
ok(staff.status===403&&staff.body.error==='forbidden_for_staff',
   '★★作業者キーでは再調達の目標を送れない');
const staff2=await asJson(await worker.fetch(new Request('https://x/sync',
  {method:'POST',headers:{'X-PJ-Key':'staff-key-123','content-type':'application/json'},
   body:JSON.stringify({kind:'phaseb',approve:true})}),env));
ok(staff2.status===403,'★★作業者キーでは実行できない');

T.done();
