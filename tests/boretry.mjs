/* Worker：22003（ベストオファーの自動拒否額）を直してやり直す（7.58）
   ・GetMyeBaySelling は BestOfferDetails を返さないことがあり、そのとき
     ebay_bo が 0/NULL のままなので自動拒否額を一緒に送れていなかった
     （2026-10-22 の自動値下げで10件失敗した原因）
   ・22003 が返ったら GetItem で本当の設定を取り直し、自動拒否額（と必要なら
     自動承諾額）を新しい売値より下に直して1回だけやり直す
   ・取れた設定は D1 に控えるので、次回は1回で通る
   ・自動値下げ・売値の自動反映・再調達中の売値・フェイズBで同じ処理を使う
   ・写真が小さい行（21919137）は値下げの対象から外す
   ・一時的なエラー（System error など）は失敗の回数に数えない
   ・Discord に失敗の理由の上位3つを件数つきで出す
   ・時刻は日本時間で出す */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：22003 を直してやり直す');
const ok=T.ok;
const { worker, T:W }=await loadWorker('boretry');
const env=makeEnv({ STAFF_KEY:'staff-key-123' });
const now=new Date().toISOString();
const ago=(ms)=>new Date(Date.now()-ms).toISOString();
const DAY=24*60*60*1000;

/* eBay の持ち方をまねる。revise は「自動拒否額が売値以上」なら 22003 を返す。 */
let item={ price:85, bo:{on:1,min:84.5,acc:0}, qty:1, status:'Active' };
let calls=[], notes=[], reviseN=0;
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/open\.er-api\.com/.test(url))
    return new Response(JSON.stringify({rates:{JPY:160}}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/ws\/api\.dll/.test(url)){
    const name=(o.headers||{})['X-EBAY-API-CALL-NAME']||'';
    const body=String(o.body||'');
    calls.push({name:name,body:body});
    if(name==='GetItem'){
      /* GetItem は BestOfferDetails と ListingDetails を返す（本当の設定）。 */
      return new Response('<GetItemResponse><Ack>Success</Ack><Item>'
        +'<Title>テスト商品</Title><Quantity>'+item.qty+'</Quantity>'
        +'<BestOfferDetails><BestOfferEnabled>'+(item.bo.on?'true':'false')
        +'</BestOfferEnabled><BestOfferCount>0</BestOfferCount></BestOfferDetails>'
        +'<ListingDetails>'
        +(item.bo.min?('<MinimumBestOfferPrice currencyID="USD">'
            +item.bo.min.toFixed(2)+'</MinimumBestOfferPrice>'):'')
        +(item.bo.acc?('<BestOfferAutoAcceptPrice currencyID="USD">'
            +item.bo.acc.toFixed(2)+'</BestOfferAutoAcceptPrice>'):'')
        +'</ListingDetails>'
        /* 写真の大きさは URL の /s/ に base64 で入っている（7.59）。
           1600x1200 ＝ 500px以上なので「写真が小さい」の記録は消える。 */
        +'<PictureDetails><PictureSource>EPS</PictureSource>'
        +'<PictureURL>https://i.ebayimg.com/00/s/'
        +Buffer.from('1600X1200','utf8').toString('base64')
        +'/z/a/$_1.JPG</PictureURL></PictureDetails>'
        +'<SellingStatus><QuantitySold>0</QuantitySold>'
        +'<CurrentPrice currencyID="USD">'+item.price.toFixed(2)+'</CurrentPrice>'
        +'<ListingStatus>'+item.status+'</ListingStatus></SellingStatus>'
        +'</Item></GetItemResponse>',
        {status:200,headers:{'content-type':'text/xml'}});
    }
    if(name==='ReviseFixedPriceItem'){
      reviseN++;
      const price=Number((/<StartPrice[^>]*>([\d.]+)</.exec(body)||[])[1]||0);
      const min=Number((/<MinimumBestOfferPrice[^>]*>([\d.]+)</.exec(body)||[])[1]||0);
      const acc=Number((/<BestOfferAutoAcceptPrice[^>]*>([\d.]+)</.exec(body)||[])[1]||0);
      /* 送られてきた自動拒否額（無ければ今の設定）が売値以上なら 22003。 */
      const useMin=min||item.bo.min;
      if(item.bo.on&&useMin>=price)
        return new Response('<ReviseFixedPriceItemResponse><Ack>Failure</Ack>'
          +'<Errors><ErrorCode>22003</ErrorCode><ShortMessage>Auto decline amount '
          +'cannot be greater than or equal to the Buy It Now price.</ShortMessage>'
          +'<LongMessage>…</LongMessage></Errors></ReviseFixedPriceItemResponse>',
          {status:200,headers:{'content-type':'text/xml'}});
      item.price=price;
      if(min)item.bo.min=min;
      if(acc)item.bo.acc=acc;
      return new Response('<ReviseFixedPriceItemResponse><Ack>Success</Ack>'
        +'</ReviseFixedPriceItemResponse>',
        {status:200,headers:{'content-type':'text/xml'}});
    }
    if(name==='ReviseInventoryStatus'){
      reviseN++;
      const price=Number((/<StartPrice[^>]*>([\d.]+)</.exec(body)||[])[1]||0);
      /* ReviseInventoryStatus はベストオファーを送れないので、
         自動拒否額が売値以上なら必ず 22003 になる。 */
      if(item.bo.on&&item.bo.min>=price)
        return new Response('<ReviseInventoryStatusResponse><Ack>Failure</Ack>'
          +'<Errors><ErrorCode>22003</ErrorCode><ShortMessage>Auto decline amount '
          +'cannot be greater than or equal to the Buy It Now price.</ShortMessage>'
          +'</Errors></ReviseInventoryStatusResponse>',
          {status:200,headers:{'content-type':'text/xml'}});
      item.price=price;
      return new Response('<ReviseInventoryStatusResponse><Ack>Success</Ack>'
        +'<InventoryStatus><ItemID>880000990001</ItemID></InventoryStatus>'
        +'</ReviseInventoryStatusResponse>',
        {status:200,headers:{'content-type':'text/xml'}});
    }
    throw new Error('想定外の呼び出し: '+name);
  }
  if(/discord/.test(url)){ notes.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response(null,{status:204}); }
  throw new Error('想定外の通信: '+url);
};
let atSeq=0;
const put=async(o)=>await asJson(await worker.fetch(post('/settings',
  {at:new Date(Date.now()+(++atSeq)*1000).toISOString(),settings:o}),env));
await put({ fx:'160', fee:'13.6', autoAdRate:'6', baseProfit:'1000', linkRate:'30',
  saleRate:'15', targetMode:'auto', syncWeightGame:'150',
  autoMdMode:'on', csvMarkStep:'5', csvMarkTimes:'10', csvMarkDays:'3',
  autoMdMax:'150', autoRvMode:'auto', autoRkMode:'auto',
  pbMode:'on', pbRestock:'auto', autoSkMode:'auto' });

const wipe=async()=>{
  for(const t of ['items','skus','md_runs','rv_runs','rk_runs','pb_runs',
                  'rv_log','rk_log','pb_log','orders'])
    await env.DB.prepare('DELETE FROM '+t).bind().run();
};
async function seed(asin,extra){
  const d=Object.assign({cond:'used',ebay_item_id:'880000990001',ebay_qty:1,ebay_price:85,
    ebay_bo:0,ebay_bo_accept:null,ebay_bo_decline:null,   // ← D1 は「オフ」のまま
    md_step:5,md_floor:40,md_n:10,md_done:0,mark_at:ago(5*DAY),
    one_off:0,one_off_known:1,dropship:0,restocking:0,on_hand:0,ebay_sale:null,
    revise_err:null,weight_g:150,cost_yen:1200},extra||{});
  const cols=['asin','cond','scope','title','ebay_sku','ebay_item_id','ebay_qty',
    'ebay_price','ebay_seen_at','ebay_bo','ebay_bo_accept','ebay_bo_decline',
    'md_step','md_floor','md_n','md_done','mark_at','one_off','one_off_known',
    'dropship','restocking','on_hand','ebay_sale','revise_err','weight_g',
    'cost_yen','updated_at'];
  const vals=[asin,d.cond,'ebay',asin+'の商品','E-'+asin+'-U',d.ebay_item_id,
    d.ebay_qty,d.ebay_price,now,d.ebay_bo,d.ebay_bo_accept,d.ebay_bo_decline,
    d.md_step,d.md_floor,d.md_n,d.md_done,d.mark_at,d.one_off,d.one_off_known,
    d.dropship,d.restocking,d.on_hand,d.ebay_sale,d.revise_err,d.weight_g,
    d.cost_yen,now];
  await env.DB.prepare('INSERT INTO items ('+cols.join(',')+') VALUES ('
    +cols.map((_,i)=>'?'+(i+1)).join(',')+')').bind(...vals).run();
  await env.DB.prepare(`INSERT INTO skus (seller_sku,asin,cond,prefix,scope,active,
    updated_at) VALUES (?1,?2,?3,'game','ebay',1,?4)`)
    .bind('E-'+asin+'-U',asin,d.cond,now).run();
}
const row=async(asin)=>await env.DB.prepare(
  `SELECT ebay_price,ebay_bo,ebay_bo_accept,ebay_bo_decline,md_done,mark_at,
          revise_err,rv_fail,rk_fail,pb_fail FROM items WHERE asin=?1`)
  .bind(asin).first();

console.log('=== 失敗の理由のまとめ（whyTop）===');
const fails=['22003 / Auto decline amount cannot be greater / long',
  '22003 / Auto decline amount cannot be greater / long',
  '22003 / Auto decline amount cannot be greater / long',
  '21919137 / Picture is too small / long',
  '21919137 / Picture is too small / long',
  '10007 / System error / long'];
console.log('   '+JSON.stringify(W.whyTop(fails)));
ok(W.whyTop(fails).length===3,'★★上位3つだけ');
ok(/^コード 22003：.*3件$/.test(W.whyTop(fails)[0]),'★★多い順・件数つき');
ok(/21919137.*2件/.test(W.whyTop(fails)[1])&&/10007.*1件/.test(W.whyTop(fails)[2]),
   '★コードごとにまとめる');
ok(W.whyTop([]).length===0&&W.whyLine([])==='','★1件も無ければ空');
ok(/失敗の理由：/.test(W.whyLine(fails)),'★「失敗の理由：」で始める');

console.log('\n=== エラーの見分け ===');
ok(W.BO_ERR.test('22003 / Auto decline amount cannot be greater')
   &&!W.BO_ERR.test('21919137 / too small'),'★★22003 を見分ける');
ok(W.PIC_ERR.test('21919137 / Picture is too small')
   &&!W.PIC_ERR.test('22003 / x'),'★★21919137 を見分ける');
ok(W.TEMP_ERR.test('10007 / System error')
   &&!W.TEMP_ERR.test('22003 / Auto decline amount'),'★★一時的なエラーを見分ける');

console.log('\n=== 売値より下の自動拒否額を作る（boBelow）===');
console.log('   '+JSON.stringify(W.boBelow(45,36.8,{min:60,acc:0})));
ok(W.boBelow(45,36.8,{min:60,acc:0}).min===36.8,'★★最低売値を使う');
ok(W.boBelow(45,0,{min:60,acc:0}).min===44.99,'★★最低売値が無ければ 売値−$0.01');
ok(W.boBelow(45,50,{min:60,acc:0}).min===44.99,
   '★★最低売値が売値以上なら 売値−$0.01（必ず下にする）');
ok(W.boBelow(45,36.8,{min:60,acc:50}).acc===44.99,
   '★★自動承諾額が売値以上なら、それも下げる');
ok(W.boBelow(45,36.8,{min:60,acc:30}).acc===0,
   '★★自動承諾額が売値より下なら触らない（人が決めた値を動かさない）');

console.log('\n=== GetItem が本当のベストオファー設定を返す ===');
item={ price:85, bo:{on:1,min:84.5,acc:0}, qty:1, status:'Active' };
await wipe(); await seed('B0BO000001');
calls=[];
let g=await asJson(await worker.fetch(get('/ebay/item?id=880000990001'),env));
console.log('   status='+g.status+' keys='+Object.keys(g.body||{}).join(',')
  +' bo='+JSON.stringify(g.body.bo));
ok(g.body.bo&&g.body.bo.on===1&&g.body.bo.min===84.5,
   '★★BestOfferDetails と MinimumBestOfferPrice を返す');
let r1=await row('B0BO000001');
console.log('   D1: '+JSON.stringify(r1));
ok(Number(r1.ebay_bo)===1&&Number(r1.ebay_bo_decline)===84.5,
   '★★D1 にも控える（次回は1回で通る）');

console.log('\n=== 自動値下げ：22003 を直してやり直す ===');
item={ price:85, bo:{on:1,min:84.5,acc:0}, qty:1, status:'Active' };
await wipe(); await seed('B0BO000010');
calls=[]; notes=[]; reviseN=0;
let md=(await asJson(await worker.fetch(post('/sync',{kind:'markdown'}),env))).body;
console.log('   '+JSON.stringify({changed:md.changed,failed:md.failed,bofix:md.bofix}));
console.log('   送った順: '+calls.map((c)=>c.name).join(' → '));
let r10=await row('B0BO000010');
console.log('   '+JSON.stringify(r10)+' / eBay: '+JSON.stringify(item));
ok(md.changed===1&&md.failed===0,'★★下げられた（失敗0件）');
ok(md.bofix===1,'★★22003 を直した件数を数える');
ok(calls.map((c)=>c.name).join(',')
   ==='ReviseFixedPriceItem,GetItem,ReviseFixedPriceItem',
   '★★1回目が 22003 → GetItem → もう1回だけやり直す');
ok(item.price<85&&item.price>0,'★★売値が下がった');
ok(item.bo.min<item.price,'★★自動拒否額が新しい売値より下になった');
ok(Number(r10.ebay_price)===item.price&&Number(r10.md_done)===1,'★D1 も進む');
ok(Number(r10.ebay_bo)===1&&Number(r10.ebay_bo_decline)===84.5,
   '★★取り直した設定を D1 に控える（次回は1回で通る）');
ok(!r10.revise_err,'★失敗の記録は残らない');
console.log('   Discord: '+(notes[0]||'').split('\n').join(' / '));
ok(/自動拒否額を直してやり直した 1件/.test(notes[0]||''),'★★Discord にも出す');
ok(/日本時間/.test(notes[0]||''),'★★Discord の時刻は日本時間');

console.log('\n=== 2回目は1回で通る（D1 に控えた設定を使う）===');
calls=[]; reviseN=0;
await env.DB.prepare(`UPDATE items SET mark_at=?2 WHERE asin=?1`)
  .bind('B0BO000010',ago(5*DAY)).run();
md=(await asJson(await worker.fetch(post('/sync',{kind:'markdown'}),env))).body;
console.log('   送った順: '+calls.map((c)=>c.name).join(' → ')
  +' / '+JSON.stringify({changed:md.changed,bofix:md.bofix}));
ok(md.changed===1&&md.bofix===0,'★★やり直し無しで通る');
ok(calls.filter((c)=>c.name==='GetItem').length===0,'★★GetItem を呼ばない');

console.log('\n=== 自動拒否額を売値より下にできないとき ===');
item={ price:1.00, bo:{on:1,min:5,acc:0}, qty:1, status:'Active' };
await wipe(); await seed('B0BO000020',{ebay_price:0.50,md_step:0.49,md_floor:0.01});
calls=[]; notes=[];
md=(await asJson(await worker.fetch(post('/sync',{kind:'markdown'}),env))).body;
let r20=await row('B0BO000020');
console.log('   '+JSON.stringify({changed:md.changed,failed:md.failed})
  +' / '+String(r20.revise_err||'').slice(0,60));
ok(md.failed===1&&/22003|Auto decline/.test(String(r20.revise_err||'')),
   '★★直せなければ失敗として理由を残す');

console.log('\n=== 写真が小さい行は値下げの対象から外す ===');
item={ price:85, bo:{on:0,min:0,acc:0}, qty:1, status:'Active' };
await wipe();
await seed('B0BO000030',{revise_err:'自動値下げ 21919137 / Picture is too small / x'});
await seed('B0BO000031');
calls=[]; notes=[];
md=(await asJson(await worker.fetch(post('/sync',{kind:'markdown'}),env))).body;
console.log('   '+JSON.stringify({changed:md.changed,skipped:md.skipped,pic:md.pic}));
ok(md.changed===1&&md.pic===1,'★★写真が小さい行はとばす（毎回失敗しない）');
const r30=await env.DB.prepare(
  `SELECT ${W.ITEM_COLS} FROM items WHERE asin='B0BO000030'`).all();
ok(W.mdSkip(r30.results[0],{days:3,max:150},ago(3*DAY))==='写真が小さい（要撮り直し）',
   '★★とばす理由を返す');
ok(/写真が小さくて対象外 1件/.test(notes[0]||''),'★★Discord に件数を出す');

console.log('\n=== 写真を切り替えると値下げの対象に戻る ===');
let sw=await asJson(await worker.fetch(new Request(
  'https://x/ebay/pics/switch',{method:'POST',
    headers:{'X-PJ-Key':'k','content-type':'application/json'},
    body:JSON.stringify({item_id:'880000990001'})}),env));
const r30b=await env.DB.prepare(
  `SELECT revise_err FROM items WHERE asin='B0BO000030'`).first();
console.log('   '+JSON.stringify({done:sw.body.done,err:r30b.revise_err}));
ok(!r30b.revise_err,
   '★★写真が全部500px以上になっていれば、写真のエラーは消える（7.59）');

console.log('\n=== 一時的なエラーは失敗の回数に数えない ===');
ok(W.TEMP_ERR.test('10007 / System error / x'),'★★10007 は一時的なエラー');
ok(!W.TEMP_ERR.test('21919188 / This listing cannot be revised'),
   '★ふつうの失敗は一時的ではない');

console.log('\n=== 時刻は日本時間 ===');
console.log('   '+W.jstText('2026-10-21T18:15:00.000Z'));
ok(W.jstText('2026-10-21T18:15:00.000Z')==='2026-10-22 03:15',
   '★★UTC の 18:15 は日本時間の翌日 03:15');
ok(W.jstText('')===''&&W.jstText('へんな値')==='へんな値',
   '★読めない値はそのまま');
let rs=await asJson(await worker.fetch(get('/runs?limit=3'),env));
console.log('   '+JSON.stringify((rs.body.runs||[])[0]
  ? { at:rs.body.runs[0].started_at, jst:rs.body.runs[0].started_jst } : null));
ok((rs.body.runs||[]).length>0&&!!rs.body.runs[0].started_jst,
   '★★/runs に日本時間の列を足す');
ok(rs.body.runs[0].started_jst===W.jstText(rs.body.runs[0].started_at),
   '★★保存している UTC はそのまま返す');

await T.done();
