/* 画面：会員向け Discord の配信と、Shopify の注文の取り込み（8.11／8.13・【Y】）

   ① ⚙に配信の欄（自動のオン／時刻／予告／Shopify のドメイン／プランごと）
      いまはモニターだけオン、ほかは設定だけ持って止めてある
   ② 「今日の配信の予定を見る」で帯と一覧が出る
   ③ 「今すぐ送る」は確認してから送る（「いいえ」では送らない）
   ④ 「今日は送らない」の印
   ⑤ 「Shopify に読み込みました」の印（これが付いた商品だけ配信に載る）
   ⑥ 注文CSV を読み込むと、取り込んだ件数と完売が出る
   ⑦ 仕入れる一覧に「会員の注文 n点」が出る */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：会員向けの配信と注文（8.11／8.13）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const PLAN={ ok:true, table_ok:true, token:true, day:'2026-11-13', skip:false,
  on:false, hour:8, pre:true, domain:'omakase-ship.myshopify.com', rows:2,
  plans:[
    { key:'monitor', name:'モニター', on:true, ch:'1234567890', n:10, q:1,
      kinds:'game', add:1, edit:1, keep:0,
      items:[{ jan:'4902370550467', name:'商品A', price:3645, qty:1, left:1,
               gross:1200, sent:false, same:false },
             { jan:'4902370550468', name:'商品B', price:4200, qty:1, left:1,
               gross:900, sent:true, same:false }] },
    { key:'light', name:'ライト', on:false, ch:'', n:20, q:2, kinds:'game',
      add:0, edit:0, keep:0, items:[] },
    { key:'standard', name:'スタンダード', on:false, ch:'', n:50, q:5,
      kinds:'all', add:0, edit:0, keep:0, items:[] },
    { key:'premium', name:'プレミアム', on:false, ch:'', n:100, q:5,
      kinds:'one', add:0, edit:0, keep:0, items:[] }] };

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__q=[]; window.__plan=o.plan;
  window.confirm=()=>{ window.__ask=(window.__ask||0)+1;
    return o.yes===undefined?true:o.yes; };
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body, m=String((i||{}).method||'GET');
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/sub\/plan/.test(url)){ window.__q.push({u:'plan'});
      return res(window.__plan); }
    if(/\/sub\/send/.test(url)){
      window.__q.push({u:'send',b:JSON.parse(String(b||'{}'))});
      return res(o.send||{ ok:true, sent:1, edited:1, skipped:0, plans:[] }); }
    if(/\/sub\/skip/.test(url)){
      window.__q.push({u:'skip',b:JSON.parse(String(b||'{}'))});
      return res({ ok:true, skip:true, day:'2026-11-13' }); }
    if(/\/sub\/loaded/.test(url)){
      window.__q.push({u:'loaded',b:JSON.parse(String(b||'{}'))});
      return res({ ok:true, n:2 }); }
    if(/\/sub\/orders/.test(url)&&m==='POST'){
      window.__q.push({u:'orders',b:JSON.parse(String(b||'{}'))});
      return res(o.orders||{ ok:true, added:2, dup:0, other:1, edited:1,
        sold_out:1, short:[] }); }
    if(/\/sub\/orders/.test(url))
      return res({ ok:true, table_ok:true, all:2, qty:2,
        rows:[{ jan:'4902370550467', name:'商品A', qty:2, orders:2,
                put_qty:2, left:0, sold_out:true }] });
    if(/\/mw\/sub/.test(url))
      return res({ ok:true, table_ok:true, n:2, rows:[
        { jan:'4902370550467', name:'商品A', asin:'B0A', kishu:'NS',
          price:3645, max_qty:1, cost:3476, size_g:110, size_tier:'s' },
        { jan:'4902370550468', name:'商品B', asin:'B0B', kishu:'NS',
          price:4200, max_qty:1, cost:3900, size_g:110, size_tier:'s' }] });
    if(/\/mw\/buy/.test(url))return res({ok:true,rows:[],n:0});
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return real(u,i);
  };
  syncRole='admin'; roleApply();
},o||{});

console.log('=== ① ⚙の欄 ===');
await setup({ plan:PLAN });
await openCsvBoxes(p);
{
  const t=await p.evaluate(()=>({
    on:($('subOn')||{}).checked, hour:($('subHour')||{}).value,
    pre:($('subPre')||{}).checked, dom:($('subDomain')||{}).value,
    mon:($('subOnMonitor')||{}).checked, monN:($('subNMonitor')||{}).value,
    monQ:($('subQMonitor')||{}).value, monCh:($('subChMonitor')||{}).value,
    light:($('subOnLight')||{}).checked,
    std:($('subOnStandard')||{}).checked,
    pre2:($('subOnPremium')||{}).checked }));
  console.log('   '+JSON.stringify(t));
  ok(t.on===false,'★★★自動の配信は既定オフ（まず手で送る）');
  ok(t.hour==='8','★★★配信の時刻は 8時（日本時間）');
  ok(t.pre===true,'★★前日の予告は既定オン');
  ok(t.dom==='','★Shopify のドメインは空から始める');
  ok(t.mon===true&&t.monN==='10'&&t.monQ==='1',
     '★★★モニター：オン・1回10件・1商品1点');
  ok(t.light===false&&t.std===false&&t.pre2===false,
     '★★★ライト・スタンダード・プレミアムは止めてある');
  /* プランの表は shared/subplan.js と同じ（画面も pj-sync も同じものを読む）。 */
  const sp=await p.evaluate(()=>SUBPLAN.list({}).map((x)=>x.key+':'+x.n+'/'+x.q));
  console.log('   '+JSON.stringify(sp));
  ok(sp[0]==='monitor:10/1','★★★画面も同じプランの表を読む');
}

console.log('\n=== ② 今日の配信の予定を見る ===');
{
  await p.evaluate(()=>{ switchTab('F'); });
  await p.evaluate(async()=>{ await subPlanGo(); });
  await p.waitForTimeout(250);
  const t=await p.evaluate(()=>({
    bar:($('subBar').textContent||'').replace(/\s+/g,' '),
    list:($('subPlanList').textContent||'').replace(/\s+/g,' '),
    note:($('subNote').textContent||'') }));
  console.log('   '+t.bar);
  console.log('   '+t.list);
  ok(/配信できる商品 2件/.test(t.bar),'★★★配信できる商品の件数を出す');
  ok(/新しく送る 1件/.test(t.bar)&&/書き換える 1件/.test(t.bar),
     '★★★新しく送る／書き換えるを分けて出す');
  ok(/自動: オフ|自動：オフ/.test(t.bar),'★★自動がオフだと分かる');
  ok(/モニター 2件/.test(t.bar),'★★プランごとの件数');
  ok(/ライト 止めています/.test(t.bar),'★★止めているプランも出す');
  ok(/商品A/.test(t.list)&&/¥3,645/.test(t.list),
     '★★★送る中身（商品名と販売価格）を出す');
  ok(/新しく送る/.test(t.list)&&/書き換え/.test(t.list),
     '★★★行ごとに「新しく送る／書き換え」が分かる');
}

console.log('\n=== ③ 今すぐ送る（確認してから）===');
{
  const d=await p.evaluate(async()=>{
    window.__q=[]; window.__ask=0;
    await subSendGo();
    await new Promise((x)=>setTimeout(x,250));
    return { q:window.__q, ask:window.__ask,
             note:($('subNote').textContent||'') };
  });
  console.log('   '+JSON.stringify(d.q.map((x)=>x.u))+' / '+d.note);
  ok(d.ask===1,'★★★確認を出してから送る');
  const send=d.q.filter((x)=>x.u==='send')[0];
  ok(!!send&&send.b.approve===true,'★★★approve を付けて送る');
  ok(/新しく 1件/.test(d.note)&&/書き換え 1件/.test(d.note),
     '★★★結果を出す');
  /* 「いいえ」では送らない。 */
  await setup({ plan:PLAN, yes:false });
  await p.evaluate(async()=>{ await subPlanGo(); });
  await p.waitForTimeout(200);
  const d2=await p.evaluate(async()=>{
    window.__q=[];
    await subSendGo();
    await new Promise((x)=>setTimeout(x,200));
    return window.__q.filter((x)=>x.u==='send').length;
  });
  ok(d2===0,'★★★「いいえ」では送らない');
}

console.log('\n=== ③の2 送ったカードをすべて今の形で書き直す（8.19）===');
{
  await setup({ plan:PLAN, yes:true,
    send:{ ok:true, sent:0, edited:2, skipped:0, redo:true, plans:[] } });
  await p.evaluate(async()=>{ await subPlanGo(); });
  await p.waitForTimeout(200);
  const d=await p.evaluate(async()=>{
    window.__q=[]; window.__ask=0;
    await subRedoGo();
    await new Promise((x)=>setTimeout(x,250));
    return { q:window.__q, ask:window.__ask,
             note:($('subNote').textContent||''),
             btn:!!document.getElementById('subRedoBtn') };
  });
  console.log('   '+JSON.stringify(d.q.map((x)=>x.u))+' / '+d.note);
  ok(d.btn,'★★★「送ったカードをすべて今の形で書き直す」ボタンがある');
  ok(d.ask===1,'★★確認を出してから書き直す');
  const send=d.q.filter((x)=>x.u==='send')[0];
  ok(!!send&&send.b.redo===true&&send.b.approve===true,
     '★★★redo を付けて送る（送り直しではなく書き換え）');
  ok(/2件を今の形に書き直しました/.test(d.note),'★★★結果を出す');
  /* 「いいえ」では書き直さない。 */
  await setup({ plan:PLAN, yes:false });
  await p.evaluate(async()=>{ await subPlanGo(); });
  await p.waitForTimeout(200);
  const n=await p.evaluate(async()=>{
    window.__q=[];
    await subRedoGo();
    await new Promise((x)=>setTimeout(x,200));
    return window.__q.filter((x)=>x.u==='send').length;
  });
  ok(n===0,'★★「いいえ」では書き直さない');
}

console.log('\n=== ④ 今日は送らない ===');
{
  await setup({ plan:PLAN });
  await p.evaluate(async()=>{ await subPlanGo(); });
  await p.waitForTimeout(200);
  const d=await p.evaluate(async()=>{
    window.__q=[];
    await subSkipGo();
    await new Promise((x)=>setTimeout(x,250));
    return { q:window.__q, note:($('subNote').textContent||'') };
  });
  console.log('   '+d.note);
  ok(d.q.some((x)=>x.u==='skip'),'★★★印を送る');
  ok(/自動で送りません/.test(d.note),'★★結果を出す');
  /* 印が付いているときは帯にも出る。 */
  await setup({ plan:Object.assign({},PLAN,{ skip:true }) });
  await p.evaluate(async()=>{ await subPlanGo(); });
  await p.waitForTimeout(200);
  const bar=await p.evaluate(()=>($('subBar').textContent||''));
  ok(/今日は送らない印/.test(bar),'★★★帯にも印が出る');
}

console.log('\n=== ⑤ Shopify に読み込みました（6.194・【5】で対象を選ぶ形に）===');
{
  await setup({ plan:PLAN });
  /* 6.194（【5】）押すと**対象の一覧**が出る。まだ何も送らない。 */
  const d=await p.evaluate(async()=>{
    window.__q=[]; window.__ask=0;
    subLastCsvSave([{ jan:'4902370550467', name:'商品A' }]);
    await subLoadedGo();
    await new Promise((x)=>setTimeout(x,300));
    return { q:window.__q.map((x)=>x.u),
             n:document.querySelectorAll('#subLoadedBox [data-slchk]').length,
             on:Array.prototype.filter.call(
               document.querySelectorAll('#subLoadedBox [data-slchk]'),
               (el)=>el.checked).map((el)=>el.getAttribute('data-slchk')),
             txt:($('subLoadedBox').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+JSON.stringify(d.q)+' / '+d.txt.slice(0,120));
  ok(d.q.indexOf('loaded')<0,
     '★★★押しただけでは印を付けない（対象を選んでもらう）');
  ok(d.n===2,'★★対象の商品を一覧で出す');
  ok(d.on.length===1&&d.on[0]==='4902370550467',
     '★★★既定は直前に書き出した CSV の商品だけ');
  ok(/以前から印が付いている商品 1件/.test(d.txt),
     '★★前からの印は別に分けて出す');
  /* ぜんぶチェックして押すと、その2件に印が付く。 */
  const e=await p.evaluate(async()=>{
    window.__q=[];
    Array.prototype.forEach.call(
      document.querySelectorAll('#subLoadedBox [data-slchk]'),
      (el)=>{ el.checked=true; });
    await subLoadedPut();
    await new Promise((x)=>setTimeout(x,300));
    return { q:window.__q, note:($('subNote').textContent||'') };
  });
  const lo=e.q.filter((x)=>x.u==='loaded')[0];
  ok(!!lo&&(lo.b.jans||[]).length===2,'★★★チェックした行を送る');
  ok(/2件/.test(e.note)&&/印を付けました/.test(e.note),'★★結果を出す');
}

console.log('\n=== ⑥ 注文CSV を取り込む ===');
{
  await setup({ plan:PLAN });
  const d=await p.evaluate(async()=>{
    window.__q=[];
    /* ファイルを選んだことにする。 */
    const f=new File(['Name,Lineitem quantity,Lineitem sku\n'
      +'#1001,1,SUB-4902370550467-20261113\n'],'orders.csv',{type:'text/csv'});
    const dt=new DataTransfer(); dt.items.add(f);
    $('subOrdFile').files=dt.files;
    await subOrdGo();
    await new Promise((x)=>setTimeout(x,400));
    return { q:window.__q, note:($('subOrdNote').textContent||''),
             list:($('subOrdList').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+d.note);
  console.log('   '+d.list);
  const o=d.q.filter((x)=>x.u==='orders')[0];
  ok(!!o&&/SUB-4902370550467/.test(String(o.b.text||'')),
     '★★★CSV の中身を送る');
  ok(o.b.name==='orders.csv','★ファイル名も送る');
  ok(/2件を取り込みました/.test(d.note),'★★★取り込んだ件数を出す');
  ok(/二重 0件/.test(d.note),'★★二重に数えなかった件数も出す');
  /* 6.192：結果はボタンのすぐ下の目立つ箱に出す（言い方も変えた）。 */
  ok(/完売にしたカード 1件/.test(d.note),'★★★完売になった件数を出す');
  ok(/残り数を書き換えたカード/.test(d.note),
     '★★★残り数をどう変えたかも出す（6.192）');
  ok(/会員の注文 2点/.test(d.list),'★★★注文のまとめを出す');
  ok(/完売/.test(d.list),'★★完売の印');
}

console.log('\n=== ⑦ MW の在庫が足りないとき ===');
{
  await setup({ plan:PLAN, orders:{ ok:true, added:1, dup:0, other:0,
    edited:1, sold_out:0, short:[{ jan:'4902370550467', sold:3, stock:1 }] } });
  const note=await p.evaluate(async()=>{
    const f=new File(['Name,Lineitem quantity,Lineitem sku\n'
      +'#1,3,SUB-4902370550467-20261113\n'],'o.csv',{type:'text/csv'});
    const dt=new DataTransfer(); dt.items.add(f);
    $('subOrdFile').files=dt.files;
    await subOrdGo();
    await new Promise((x)=>setTimeout(x,400));
    return ($('subOrdNote').textContent||'');
  });
  console.log('   '+note);
  ok(/MW の在庫が足りない商品が 1件/.test(note),
     '★★★返金が必要かもしれない件数を出す');
}

T.done();
})();
