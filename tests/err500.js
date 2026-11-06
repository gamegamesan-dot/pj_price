/* 画面：pj-sync が HTTP 500 を返したとき、その理由をボタンの下に出す（6.141）
   ・行のボタン（値下げしない・手元在庫・一点物・無在庫・在庫0時）で、
     本文の error・where・detail まで出す（「HTTP 500」だけで終わらせない）
   ・D1 の列・表が足りないときは「どの migrate を流すか」まで出す
   ・Worker が付けた一言（hint）も出す
   ・「pj-sync の作りを確かめる」で、足りない表・列と実行の仕方を出す
   ・作りが合っているときは、合っていると出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：500 の理由を出す');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  window.__reply=o.reply;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u);
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:'admin'}),{status:200});
    if(/\/schema\/check/.test(url)||/\/listings/.test(url)||/\/lowest/.test(url)){
      const z=window.__reply;
      return new Response(JSON.stringify(z.body),{status:z.status});
    }
    return real(u,i);
  };
  const it={asin:'B07MLZ2JKF',cond:'cart',scope:'ebay',title:'ヨッシークラフトワールド',
    ebay_sku:'E-B07MLZ2JKF-C',ebay_item_id:'168774702258',ebay_qty:1,ebay_price:37.71,
    on_hand:0,one_off:0,one_off_known:1,dropship:0,restocking:0,mark_stop:0,mode:'hold',
    md_step:1,md_start:60,md_floor:40,md_n:10,md_done:0,
    fba_available:null,fba_inbound:0,fba_reserved:0,fba_seen_at:null,
    warnings:[],notes:[],amazon_lowest:5000,amazon_offers:1,
    amazon_offers_json:'[{"p":5000,"c":"good"}]',
    amazon_lowest_at:new Date().toISOString()};
  syncData={at:new Date().toISOString(),counts:{},items:[it]};
  syncPick={}; syncPage=1; syncRole='admin'; roleApply();
  switchTab('E'); $('syncFilter').value='all'; syncRender();
},o);
const note=async()=>await p.evaluate(()=>{
  const el=document.querySelector('#syncList [data-srow="B07MLZ2JKF|cart"] [data-sbtnnote]');
  return el?el.textContent:'';
});
const press=async(attr)=>{
  await p.click('#syncList [data-srow="B07MLZ2JKF|cart"] ['+attr+']');
  await p.waitForTimeout(250);
};

/* ---- 1. 列が足りないときの 500（Worker が返す本文そのまま） ---- */
const col500={ status:500, body:{ error:'server_error', where:'/listings',
  detail:'名簿の保存（items の書き替え）で失敗：D1_ERROR: no such column: sold_keep: SQLITE_ERROR',
  hint:'D1 に足りない表／列があります。GET /schema/check で確かめ、proxy-sync の migrate-*.sql を流してください。' }};
await setup({reply:col500});
await openCsvBoxes(p);
await press('data-smstop');
let n=await note();
console.log('   '+n);
ok(/HTTP 500/.test(n),'★HTTP の番号を出す');
ok(/server_error/.test(n),'★error を出す');
ok(/\/listings/.test(n),'★どの窓口か（where）を出す');
ok(/no such column: sold_keep/.test(n),'★★足りない列の名前を出す');
ok(/migrate-0023-sold-keep\.sql/.test(n),'★★流す migrate の名前まで出す');
ok(!/X-PJ-Key|key=/i.test(n),'★キーは出さない');

/* ほかの行ボタンでも同じ文面が出る */
for(const [attr,label] of [['data-sonhand','手元在庫'],['data-soneoff','一点物'],
                           ['data-sdrop','無在庫'],['data-szero','在庫0時']]){
  await setup({reply:col500});
  await openCsvBoxes(p);
  await press(attr);
  const m=await note();
  ok(/no such column: sold_keep/.test(m)&&/migrate-0023/.test(m),
     '★'+label+'でも同じ理由が出る');
}

/* 「最安値を今すぐ取り直す」（/lowest）でも出る */
await setup({reply:{ status:500, body:{ error:'server_error', where:'/lowest',
  detail:'D1_ERROR: no such column: amazon_new_low: SQLITE_ERROR', hint:'' }}});
await openCsvBoxes(p);
await press('data-slow');
n=await note();
ok(/HTTP 500/.test(n)&&/amazon_new_low/.test(n)&&/migrate-0014/.test(n),
   '★★最安値を今すぐ取り直す でも理由と migrate を出す');

/* ---- 2. 表が足りないときの 500 ---- */
await setup({reply:{ status:500, body:{ error:'server_error', where:'/listings',
  detail:'D1_ERROR: no such table: amz_drop: SQLITE_ERROR', hint:'' }}});
await openCsvBoxes(p);
await press('data-smstop');
n=await note();
ok(/no such table: amz_drop/.test(n)&&/migrate-0037-amz-drop\.sql/.test(n),
   '★★表のときも migrate-0037 まで出す');

/* ---- 3. 名前が読めない 500 は、Worker の一言を出す ---- */
await setup({reply:{ status:500, body:{ error:'server_error', where:'/listings',
  detail:'D1_ERROR: database is locked', hint:'あとでもう一度お試しください。' }}});
await openCsvBoxes(p);
await press('data-smstop');
n=await note();
ok(/database is locked/.test(n)&&/あとでもう一度/.test(n),
   '★migrate が分からないときは Worker の一言を出す');

/* ---- 4. 作りを確かめるボタン ---- */
await setup({reply:{ status:200, body:{ ok:false, tables:31, item_cols:99,
  item_cols_max:100, missing_tables:['amz_drop'], missing_item_cols:['sold_keep'],
  run:['cd proxy-sync && node d1-exec.mjs migrate-0037-amz-drop.sql',
       'cd proxy-sync && node d1-exec.mjs migrate-0023-sold-keep.sql'],
  note:'D1 に足りない表／列があります。' }}});
await openCsvBoxes(p);
await p.click('#syncSchemaChk');
await p.waitForTimeout(250);
let sn=await p.evaluate(()=>$('syncSchemaNote').textContent);
console.log('   '+sn);
ok(/足りない/.test(sn),'★足りないことを出す');
ok(/amz_drop/.test(sn)&&/sold_keep/.test(sn),'★★足りない表と列を並べる');
ok(/node d1-exec\.mjs migrate-0037-amz-drop\.sql/.test(sn)
  &&/node d1-exec\.mjs migrate-0023-sold-keep\.sql/.test(sn),
   '★★実行の仕方（d1-exec.mjs）を順に出す');
ok(/wrangler deploy/.test(sn),'★そのあとデプロイをやり直すことも出す');

await setup({reply:{ status:200, body:{ ok:true, tables:32, item_cols:100,
  item_cols_max:100, missing_tables:[], missing_item_cols:[], run:[],
  note:'D1 の作りは worker.js と合っています。' }}});
await openCsvBoxes(p);
await p.click('#syncSchemaChk');
await p.waitForTimeout(250);
sn=await p.evaluate(()=>$('syncSchemaNote').textContent);
ok(/合っています/.test(sn)&&/100/.test(sn),'★合っているときはそう出す（列数つき）');

await T.done();
})();
