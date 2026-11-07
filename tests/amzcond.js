/* 画面：Amazon刈取の候補の条件を eBay 無在庫と分ける（6.146）
   ・刈取は 機種すべて・新品・出荷14営業日以内・MW在庫1点以上（⚙で変えられる）
   ・eBay 無在庫の条件（mwKishu／mwShipMax／mwStockMin）は変えない
   ・自動の取り直しの件数を⚙で決める（既定 100件/時。ASIN の引き当ても含む）
   ・「1周（ASIN）」「1周（価格）」をその件数で出す
   ・ASIN の進み具合（済／残り）を一覧の上に出す
   ・ジャンルの絞り込み */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：刈取の候補の条件');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

const setup=async()=>await p.evaluate(()=>{
  $('syncApi').value='https://s.example'; $('syncKey').value='k';
  /* eBay 無在庫の条件（変えない） */
  $('mwKishu').value='NS,NS2,figure'; $('mwShipMax').value='4';
  $('mwStockMin').value='5'; $('mwNoteNg').value='難あり';
  window.__urls=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u);
    window.__urls.push(url);
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:'admin'}),{status:200});
    if(/\/mw\/count/.test(url))
      return new Response(JSON.stringify({ok:true,n:4900,alive:12000,jan:9000,
        asin_ok:100,priced:60,by_ship:[],by_stock:[],by_kishu:[],
        spread:{n:4900,plus:3000,plus1k:1200,plus3k:300}}),{status:200});
    if(/\/mw\/buy/.test(url))
      return new Response(JSON.stringify({ok:true,rows:[],n:0,gone:0,live:0,reg:0}),
        {status:200});
    if(/\/mw\/amz/.test(url)){
      const mk=(jan,g,price)=>({ jan:jan, asin:'B0'+jan.slice(0,8), name:'品'+jan,
        kishu:g, cond:'新品', stock:3, ship_days:5, wholesale:1000, list_price:3000,
        price:price, rank:1000, rank_cat:'ゲーム', fee_total:400, fee_ref:300,
        fee_fba:100, fee_tax:0, fee_base:price, rst:'ok', note:'' });
      return new Response(JSON.stringify({ok:true,
        rows:[mk('4902370550001','NS',5000),mk('4902370550002','figure',6000),
              mk('4902370550003','PS5',7000)],
        n:4900, seen:100, priced:60, left:4800, per_run:120 }),{status:200});
    }
    return real(u,i);
  };
  syncRole='admin'; roleApply();
  switchTab('F');
});

await setup();
await openCsvBoxes(p);

/* ---- 1. 既定の条件 ---- */
let c=await p.evaluate(()=>({ q:amzCondQ(), url:mwAmzQuery(1),
  kishu:$('amzKishu').value, ship:$('amzShipMax').value,
  stock:$('amzStockMin').value, per:$('mwAutoPerHour').value }));
console.log('   '+JSON.stringify(c));
ok(c.kishu===''&&c.ship==='14'&&c.stock==='1',
   '★★★既定は 機種すべて・14営業日・在庫1点');
ok(c.q.kishu===''&&c.q.ship_max===14&&c.q.stock_min===1&&c.q.new_only===1,
   '★★刈取の条件をひとまとめに返す（新品だけ）');
ok(/kishu=&/.test(c.url)&&/ship_max=14/.test(c.url)&&/stock_min=1/.test(c.url),
   '★★★一覧（/mw/amz）に刈取の条件を送る');
ok(c.per==='100','★★★自動の件数の既定は 100件/時');

/* eBay 無在庫の条件は変わっていない */
let e=await p.evaluate(()=>({ kishu:mwKishuList().join(','), ship:mwShipMax(),
  stock:mwStockMin() }));
ok(e.kishu==='NS,NS2,figure'&&e.ship===4&&e.stock===5,
   '★★★eBay 無在庫の条件はそのまま（機種3つ・4営業日・5点）');

/* ---- 2. 1周の見込みは⚙の件数で ----
   6.149：件数は「自動で取り直す」の選択肢そのもの（off／20／50／100／200）。 */
let d=await p.evaluate(()=>{
  const pick=(v)=>{ $('mwAutoMode').value=v; mwAutoSync(); };
  pick('100');
  const a=mwCountDays(4900);
  pick('200');
  const b=mwCountDays(4900);
  pick('100');
  return { a:a, b:b };
});
console.log('   '+JSON.stringify(d));
ok(d.a.per===100&&d.a.auto===Math.ceil(4900/(100*24)),
   '★★★1周（ASIN）は⚙の件数で計算する（100件/時なら3日）');
ok(d.a.pricePer===80&&d.a.price===Math.ceil(4900/(80*24)),
   '★★★価格は 80件/時 が上限（0.1回/秒の壁）');
ok(d.b.per===200&&d.b.auto<d.a.auto,'★★件数を増やせば日数が減る');
ok(d.b.pricePer===80,'★★価格は件数を増やしても 80件/時 のまま');

/* ---- 3. 件数を数える（刈取の条件が先頭） ---- */
await p.evaluate(()=>switchTab('G'));
await p.waitForTimeout(100);
await p.evaluate(()=>$('mwCountBtn').click());
await p.waitForTimeout(500);
let out=await p.evaluate(()=>$('mwCountOut').textContent);
console.log('   '+out.replace(/\s+/g,' ').slice(0,150));
ok(/いまの刈取の条件/.test(out),'★★★「いまの刈取の条件」を先頭に出す');
ok(/いまの eBay 無在庫の条件/.test(out),'★eBay 無在庫の条件も出す');
ok(/1周（ASIN）/.test(out)&&/1周（価格）/.test(out),'★★2つの1周を出す');
ok(/100件\/時/.test(out)&&/80件\/時/.test(out),
   '★★★設定の件数と価格の上限を文にも出す');
let urls=await p.evaluate(()=>window.__urls.filter((u)=>/\/mw\/count/.test(u)));
ok(urls.some((u)=>/kishu=&/.test(u)&&/ship_max=14/.test(u)&&/stock_min=1/.test(u)),
   '★★刈取の条件で数える');

/* ---- 4. ASIN の進み具合とジャンルの絞り込み ---- */
await p.evaluate(()=>switchTab('F'));
await p.evaluate(()=>mwAmzLoad());
await p.waitForTimeout(400);
let note=await p.evaluate(()=>$('csvMwAmzListNote').textContent);
console.log('   '+note.replace(/\s+/g,' ').slice(0,140));
ok(/ASIN 済 100／残り 4800/.test(note),'★★★ASIN の進み具合（済／残り）を出す');
ok(/1時間 100件/.test(note),'★★残りの日数の見込みも出す');
let g=await p.evaluate(()=>{
  const sel=$('csvMwAmzGenre');
  const opts=Array.prototype.map.call(sel.options,(o)=>o.value+':'+o.textContent);
  sel.value=(Array.prototype.map.call(sel.options,(o)=>o.value)
    .filter((v)=>v)[0])||'';
  mwAmzRender();
  return { opts:opts, picked:sel.value,
           rows:document.querySelectorAll('#csvMwAmzList [data-mwrow]').length };
});
console.log('   '+JSON.stringify(g));
ok(g.opts.length>=2,'★★ジャンルの選択肢をいまの一覧から作る');
ok(/すべて（3件）/.test(g.opts[0]),'★「すべて」に件数を出す');
ok(g.rows>0&&g.rows<3,'★★★ジャンルで絞れる');

await T.done();
})();
