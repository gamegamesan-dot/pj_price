/* 画面：今日の配信の案（8.18／6.193・カジの依頼）

   ・「今日の配信の案を作る」… 一覧の候補をプランごとに自動で振り分けて出す
     （**押しただけでは何も変わらない**）
   ・行ごとのチェックで外せる
   ・「この案で出す」… 印・上限・価格をまとめて付け、Shopify 用 CSV を書き出す
   ・案の中身は pj-sync に控える（あとで「どの案から何が売れたか」を見る）
   ・⚙で決まりを変えられる（Amazon本体・仕入れる印・在庫の%・想定購入数・日数） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：今日の配信の案（6.193）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const AT='2026-11-13T01:00:00Z';
const base={ sha:'いろは商会', kishu:'NS', cond:'新品', list_price:7678,
  stock:20, note:'', ship_text:'即日', ship_days:0, new_n:3, amz:0,
  basis:'カート', rst:'ok', fee_total:900, fee_ref:600, fee_fba:200,
  fee_tax:100, fee_fba_ship:200, fee_fba_store:16, size_tier:'s', size_g:110,
  fee_base:6000, pics_ok:1, pics_n:1, buy_qty:0,
  price_at:AT, amz_at:AT, fee_at:AT,
  mv_first:'2026-08-01T00:00:00Z', mv_last:'2026-11-12T00:00:00Z',
  mv_down:90, mv_down_n:30, mv_up:0, mv_up_n:0, mv_gone_n:0, mv_back_n:0,
  mv_back_qty:0, mv_gone_days:0, mv7_down:7, mv7_n:3, mv_wipe_n:0, mv_wipe:0 };
const ROWS=[
  /* よく売れて粗利も大きい（いちばん先に出る） */
  Object.assign({},base,{ jan:'4902370550001', mw_name:'ゲームA',
    amz_name:'ゲームA', asin:'B00AAA0001', wholesale:2000, price:6000 }),
  /* 粗利は大きいが売れていない */
  Object.assign({},base,{ jan:'4902370550002', mw_name:'ゲームB',
    amz_name:'ゲームB', asin:'B00BBB0001', wholesale:2000, price:6500,
    mv7_down:0, mv_down:0 }),
  /* Amazon 本体あり（既定では外れる） */
  Object.assign({},base,{ jan:'4902370550003', mw_name:'本体ありゲーム',
    amz_name:'本体ありゲーム', asin:'B00CCC0001', wholesale:2000, price:6000,
    amz:1 }),
  /* 「仕入れる」の印（既定では外れる） */
  Object.assign({},base,{ jan:'4902370550004', mw_name:'仕入れるゲーム',
    amz_name:'仕入れるゲーム', asin:'B00DDD0001', wholesale:2000, price:6000,
    buy_qty:2 }),
  /* 出品できない */
  Object.assign({},base,{ jan:'4902370550005', mw_name:'出せないゲーム',
    amz_name:'出せないゲーム', asin:'B00EEE0001', wholesale:2000, price:6000,
    rst:'blocked' }),
  /* 粗利が小さい（会員向きではない） */
  Object.assign({},base,{ jan:'4902370550006', mw_name:'薄いゲーム',
    amz_name:'薄いゲーム', asin:'B00FFF0001', wholesale:2000, price:3100 })];
const META={ ok:true, n:ROWS.length, rows:ROWS, seen:6, priced:6, left:0,
  per_run:120, ttl_days:3, limit:3000 };

await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwSubShip').value='0';
  $('csvMwAmzWin').checked=false;
  if($('csvMwAmzFbaNg'))$('csvMwAmzFbaNg').checked=false;
  if($('csvMwAmzRstOk'))$('csvMwAmzRstOk').checked=false;
  $('subChMonitor').value='123456789012345678';
  $('subOnMonitor').checked=true;
  window.__post=[]; window.__sub={};
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), o=i||{};
    const body=()=>JSON.parse(String(o.body||'{}'));
    if(/\/whoami/.test(url))
      return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    if(/\/sub\/draft/.test(url)){
      if(String(o.method||'')==='POST'){
        window.__post.push({ u:'draft', b:body() });
        return res({ ok:true, n:(body().items||[]).length, at:body().at });
      }
      return res({ ok:true, rows:[{ at:'2026-11-12T09:00:00Z',
        at_jst:'2026-11-12 18:00', n:2, qty:3, sold:2, gross:1600,
        plans:{ monitor:2 }, items:[
          { plan:'monitor', jan:'4902370550001', name:'ゲームA', price:2000,
            qty:2, gross:800, speed:1, taken:1, sold:2 },
          { plan:'monitor', jan:'4902370550002', name:'ゲームB', price:3000,
            qty:1, gross:500, speed:0, taken:1, sold:0 }] }] });
    }
    if(/\/mw\/sub\/put/.test(url)){
      window.__post.push({ u:'put', b:body() });
      return res({ ok:true, n:1, prices:{} });
    }
    if(/\/mw\/sub/.test(url)){
      if(String(o.method||'')==='POST'){
        const b=body();
        window.__post.push({ u:'sub', b:b });
        (b.items||[]).forEach((x)=>{ window.__sub[x.jan]=x; });
        return res({ ok:true, n:(b.items||[]).length, table_ok:true });
      }
      const rows=Object.keys(window.__sub).map((j)=>Object.assign(
        { jan:j, name:'x', asin:'B00AAA0001', kishu:'NS', cost:2200,
          size_tier:'s', size_g:110, px_hand:0, loaded_at:'', put_at:'' },
        window.__sub[j],{ on:1, max_qty:window.__sub[j].max_qty,
          price:window.__sub[j].price }));
      return res({ ok:true, table_ok:true, n:rows.length, rows:rows });
    }
    if(/\/mw\/buy/.test(url))return res({ ok:true, rows:[], n:0 });
    if(/\/mw\/amz/.test(url))return res(META);
    return real(u,i);
  };
  window.csvDownload=(n,t)=>{ window.__dl=(window.__dl||[]).concat([n]);
    return true; };
  switchTab('F'); syncRole='admin'; roleApply();
},META);
await openCsvBoxes(p);
await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
await p.waitForTimeout(500);

console.log('=== ① ⚙の欄と既定 ===');
{
  const t=await p.evaluate(()=>({
    noAmz:($('subPickNoAmz')||{}).checked,
    skipBuy:($('subPickSkipBuy')||{}).checked,
    pct:($('subStockPct')||{}).value, want:($('subWantQty')||{}).value,
    days:($('subQtyDays')||{}).value,
    opt:SUBPLAN.pickOpt(subPickCfg()) }));
  console.log('   '+JSON.stringify(t));
  ok(t.noAmz===true&&t.skipBuy===true,
     '★★★既定で「Amazon 本体ありを外す」「仕入れる印を外す」');
  ok(t.pct==='30'&&t.want==='5'&&t.days==='2',
     '★★★既定は MW在庫30%・想定購入数5点・2日ぶん引く');
  ok(t.opt.stockPct===30&&t.opt.wantQty===5,'★★⚙を1か所で読む');
}

console.log('\n=== ② 案を作る（まだ何も変えない）===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[];
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    return { post:window.__post, note:$('subDraftNote').textContent,
             box:($('subDraftBox').textContent||'').replace(/\s+/g,' '),
             data:subDraftData&&subDraftData.plans.map((x)=>({ k:x.key,
               on:x.on, n:x.items.length,
               jans:x.items.map((y)=>y.jan) })) };
  });
  console.log('   '+t.note.replace(/\s+/g,' ').slice(0,200));
  console.log('   '+JSON.stringify(t.data));
  ok(t.post.length===0,'★★★押しただけでは pj-sync に何も送らない');
  ok(/まだ何も変えていません/.test(t.note),'★★★「まだ何も変えていません」');
  const m=(t.data||[]).filter((x)=>x.k==='monitor')[0]||{};
  ok(m.jans.indexOf('4902370550003')<0,'★★★Amazon 本体ありは入らない');
  ok(m.jans.indexOf('4902370550004')<0,'★★★「仕入れる」印は入らない');
  ok(m.jans.indexOf('4902370550005')<0,'★★★出品できない行は入らない');
  ok(m.jans.indexOf('4902370550006')<0,'★★★会員向きでない行は入らない');
  ok(m.jans[0]==='4902370550001',
     '★★★よく売れて粗利も大きい行が先（粗利×速さ）');
  ok(/ゲームA/.test(t.box)&&/点まで/.test(t.box)&&/粗利/.test(t.box),
     '★★★商品名・価格・上限・粗利を一覧で出す');
  ok(/この案で出す/.test(t.box),'★★★「この案で出す」を出す');
}

console.log('\n=== ③ 行ごとに外せる ===');
{
  const t=await p.evaluate(()=>{
    const el=document.getElementById('subDraftChk_monitor_4902370550001');
    const n0=subDraftPicked().length;
    el.checked=false;
    const n1=subDraftPicked().length;
    el.checked=true;
    return { has:!!el, n0:n0, n1:n1 };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.has,'★★★行ごとにチェックがある');
  ok(t.n1===t.n0-1,'★★★外した行は「この案で出す」に入らない');
}

console.log('\n=== ④ この案で出す（印・上限・価格＋CSV）===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[]; window.__dl=[];
    window.confirm=()=>true;
    await subDraftApply();
    await new Promise((x)=>setTimeout(x,800));
    return { post:window.__post.map((x)=>x.u), sub:window.__sub,
             draft:(window.__post.filter((x)=>x.u==='draft')[0]||{}).b,
             items:(window.__post.filter((x)=>x.u==='sub')[0]||{}).b,
             dl:window.__dl, note:$('subDraftNote').textContent };
  });
  console.log('   '+JSON.stringify(t.post)+' dl='+JSON.stringify(t.dl));
  console.log('   '+JSON.stringify(t.items).slice(0,220));
  ok(t.post.indexOf('sub')>=0,'★★★「会員に出す」の印をまとめて付ける');
  const it=(t.items.items||[])[0]||{};
  ok(it.on===1&&+it.max_qty>0&&+it.price>0&&it.grades==='monitor',
     '★★★印・上限・価格・プランを送る');
  ok(t.post.indexOf('draft')>=0,'★★★案の中身を pj-sync に控える');
  ok((t.draft.items||[]).length>0&&!!t.draft.at,
     '★★★案の日時と中身を控える（あとで売れた数を見る）');
  ok((t.dl||[]).length===1&&/shopify-products-/.test(t.dl[0]),
     '★★★そのまま Shopify 用 CSV を書き出す');
}

console.log('\n=== ⑤ 案の記録（どの案から何が売れたか）===');
{
  const t=await p.evaluate(async()=>{
    await subDraftLogGo();
    await new Promise((x)=>setTimeout(x,200));
    return { note:$('subDraftNote').textContent,
             box:($('subDraftBox').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+t.box.slice(0,200));
  ok(/案の記録/.test(t.note),'★★★案の記録を出す');
  ok(/2026-11-12 18:00/.test(t.box),'★★★案を作った日時');
  ok(/売れた 2点/.test(t.box),'★★★その案から何が売れたか');
  ok(/ゲームA/.test(t.box),'★★商品ごとにも出す');
}

console.log('\n=== ⑥ ⚙を変えると案が変わる ===');
{
  const t=await p.evaluate(async()=>{
    $('subPickNoAmz').checked=false;
    $('subPickSkipBuy').checked=false;
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    const m=(subDraftData.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
    $('subPickNoAmz').checked=true; $('subPickSkipBuy').checked=true;
    return m.items.map((x)=>x.jan);
  });
  console.log('   '+JSON.stringify(t));
  ok(t.indexOf('4902370550003')>=0&&t.indexOf('4902370550004')>=0,
     '★★★⚙を切ると Amazon 本体あり・仕入れる印も案に入る');
  const t2=await p.evaluate(async()=>{
    $('subWantQty').value='1';
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    const m=(subDraftData.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
    $('subWantQty').value='5';
    return (m.items[0]||{}).qty;
  });
  ok(t2===1,'★★★⚙の想定購入数で上限が変わる');
}

console.log('\n=== ⑦ 作業者の端末では出ない ===');
{
  const t=await p.evaluate(()=>{
    syncRole='staff'; roleApply();
    const b=document.getElementById('subDraftBtn');
    const hid=window.getComputedStyle(b).display==='none';
    syncRole='admin'; roleApply();
    return hid;
  });
  ok(t===true,'★★★作業者の端末では案のボタンを出さない（売値が出るため）');
}
await T.done();
})();
