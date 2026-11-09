/* 画面：取り込みの中身を見る・「注文した」の印（6.161・【Q】）
   ① ⚙「最近の取得を見る」の各回から、その回の
      「新しく欠品」「新しく出てきた」「欠品から戻った」を開ける
      （商品名・JAN・社・機種・卸値・相場の区分・Amazon の見込み粗利。
       10件ずつ・検索つき）
   ② 仕入れる一覧の行に「注文した」の印（日付つき）を付けられる
   ③ 「注文した」「Amazon 登録済み」の行は「仕入れ済み」の区分に移る */
const { harness, clickCfg } = require('./lib');
const T = harness('画面：取り込みの中身と「注文した」の印（6.161）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], cancel=false;
p.on('dialog',async d=>{ dlg.push(d.message());
  if(cancel)await d.dismiss(); else await d.accept(); });

const AT='2026-11-09T01:00:00Z';
/* /mw/nt の1行（候補一覧と刈取と同じ名前で返ってくる）。 */
const ntRow=(i,x)=>Object.assign({
  jan:'49023705'+String(10000+i).slice(-5), sha:'いろは商会', kishu:'NS2',
  name:'商品の名前'+i, mw_name:'商品の名前'+i, cond:'新品',
  list_price:7678, wholesale:3000, stock:9, note:'', ship_text:'即日',
  ship_days:0, seen_at:AT, gone_at:AT, back_at:null, created_at:AT,
  mkt_n:3, mkt_n_new:2, mkt_low:60, mkt_low_any:60, mkt_ship:0, mkt_cur:'USD',
  mkt_err:'', mkt_at:'2026-11-08T00:00:00Z',
  asin:'B0NT00000'+(i%10), amz_name:'Amazon の名前'+i, rank:1200,
  rank_cat:'ゲーム', price:9000, basis:'カート', new_n:3, amz:0,
  amz_err:'', amz_at:AT, price_at:AT, fee_total:1500, fee_ref:975,
  fee_fba:425, fee_tax:97, fee_fba_ship:425, fee_fba_store:16,
  size_tier:'m', size_g:300, amz_low:8800, amz_new_n:3, amz_g:300,
  pics_ok:1, pics_n:1, buy_qty:0, ordered_at:'', reg_state:'', reg_sku:null,
  ebay:0, reg_ok:0
},x||{});
const csvRuns=(stockAt)=>({ ok:true, n:1, limit:50, rows:[{
    at:'2026-11-09T01:05:00Z', at_jst:'2026-11-09 10:05', src:'auto',
    http:200, changed:1, took:1, bytes:1800000, rows_in:12062, added:3,
    changed_rows:12, gone:5, elapsed_ms:8400, ok:1, why:'',
    stock_at:stockAt===undefined?AT:stockAt }],
  on:true, stop:false, url_set:true, every_h:1, body_h:3,
  checked_at:'2026-11-09T01:05:00Z', checked_jst:'2026-11-09 10:05',
  body_at:'2026-11-09T01:05:00Z', next_at:'2026-11-09T02:05:00Z',
  next_jst:'2026-11-09 11:05', fail:0, fail_stop:3, auto_off:'',
  ua:'pj-sync（有限会社オーシャン貿易・在庫確認）' });

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000';
  $('linkRate').value='30'; $('shipCharge').value='15.00';
  $('mwShipFee').value='176'; $('mwAmzFeeGame').value='15';
  $('mwAmzFbaGame').value='530'; $('mwFbaShipM').value='425';
  $('mwFbaStoreM').value='16'; $('mwFbaSizeGame').value='m';
  window.__posts=[]; window.__nt=o.nt; window.__csv=o.csv;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')
      ?JSON.parse(i.body):null;
    const res=(x,st)=>new Response(JSON.stringify(x),{status:st||200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/mw\/nt/.test(url)){
      window.__posts.push({u:'nt',url:url});
      return res(window.__nt);
    }
    if(/\/mw\/csv/.test(url))return res(window.__csv);
    if(/\/mw\/buy/.test(url)){
      if(i&&i.method==='POST'){ window.__posts.push({u:'buy',b:b});
        return res({ok:true,n:1,rows:[]}); }
      return res(o.buy||{ok:true,rows:[],n:0,qty:0,yen:0,gone:0});
    }
    if(/\/mw\/amz/.test(url))
      return res({ ok:true, n:0, rows:[], seen:0, priced:0, left:0 });
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return real(u,i);
  };
  syncRole=o.role||'admin'; roleApply();
},o||{});
const openCfg=async()=>await p.evaluate(()=>{
  switchTab('G');
  Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
    function(d){ d.open=true; });
});

console.log('=== ① 記録の各回から中身を開く ===');
await setup({ csv:csvRuns(),
  nt:{ ok:true, at:AT, at_jst:'2026-11-09 10:00', kind:'gone',
       rows:[ntRow(0),ntRow(1)], n:2, jans:2, limit:500, over:1.15 } });
await openCfg();
await p.evaluate(()=>mwCsvRunsShow());
await p.waitForTimeout(300);
let btn=await p.evaluate(()=>{
  const el=$('mwCsvRuns');
  return { gone:!!el.querySelector('[data-nt="gone"]'),
    nw:!!el.querySelector('[data-nt="new"]'),
    back:!!el.querySelector('[data-nt="back"]'),
    at:(el.querySelector('[data-nt="gone"]')||{}).getAttribute
      ?el.querySelector('[data-nt="gone"]').getAttribute('data-ntat'):'',
    txt:(el.textContent||'').replace(/\s+/g,' ') };
});
console.log('   '+JSON.stringify(btn).slice(0,220));
ok(btn.gone&&btn.nw&&btn.back,'★★★3つのボタンを出す');
ok(/新しく欠品/.test(btn.txt)&&/新しく出てきた/.test(btn.txt)
   &&/欠品から戻った/.test(btn.txt),'★★そう書いてある');
ok(btn.at===AT,'★★★その回の日時を持たせる');
let got=await p.evaluate(async()=>{
  $('mwCsvRuns').querySelector('[data-nt="gone"]').click();
  await new Promise(function(r){ setTimeout(r,350); });
  return { url:(window.__posts.filter(function(x){ return x.u==='nt'; })[0]||{}).url||'',
    note:($('mwNtNote').textContent||'').replace(/\s+/g,' '),
    box:($('mwNtBox').textContent||'').replace(/\s+/g,' ') };
});
console.log('   '+got.url);
console.log('   '+got.note);
console.log('   '+got.box.slice(0,260));
ok(/kind=gone/.test(got.url)&&/at=2026-11-09T01%3A00%3A00Z/.test(got.url),
   '★★★その回・その区分を聞きに行く');
ok(/新しく欠品 2件/.test(got.note),'★★★区分と件数を出す');
ok(/の取り込み/.test(got.note),'★いつの取り込みかも出す');
ok(/商品の名前0/.test(got.box),'★★★商品名を出す');
ok(/JAN 4902370510000/.test(got.box),'★★★JAN を出す');
ok(/社 いろは商会/.test(got.box),'★★★社を出す');
ok(/機種 NS2/.test(got.box),'★★★機種を出す');
ok(/卸値 ¥3,000/.test(got.box),'★★★卸値を出す');
ok(/相場 /.test(got.box)&&/(出品候補|後回し|相場なし)/.test(got.box),
   '★★★相場の区分を出す');
ok(/見込み粗利 ¥/.test(got.box),'★★★Amazon の見込み粗利を出す');
ok(/利益率/.test(got.box),'★利益率も出す');
/* 新しく出てきた・戻った も開ける。 */
let kinds=await p.evaluate(async()=>{
  const out=[];
  for(const k of ['new','back']){
    window.__posts=[];
    $('mwCsvRuns').querySelector('[data-nt="'+k+'"]').click();
    await new Promise(function(r){ setTimeout(r,300); });
    out.push((window.__posts[0]||{}).url||'');
  }
  return out;
});
ok(/kind=new/.test(kinds[0]),'★★★「新しく出てきた」も開ける');
ok(/kind=back/.test(kinds[1]),'★★★「欠品から戻った」も開ける');

console.log('\n=== ① 10件ずつ・検索つき ===');
let many=[]; for(let i=0;i<14;i++)many.push(ntRow(i));
many[3].name='ゼルダの伝説'; many[3].mw_name='ゼルダの伝説';
many[4].sha='たちつ商事';
await setup({ csv:csvRuns(),
  nt:{ ok:true, at:AT, at_jst:'x', kind:'gone', rows:many, n:14, jans:14,
       limit:500, over:1.15 } });
await openCfg();
await p.evaluate(async()=>{
  mwCsvRunsShow();
  await new Promise(function(r){ setTimeout(r,250); });
  $('mwCsvRuns').querySelector('[data-nt="gone"]').click();
  await new Promise(function(r){ setTimeout(r,350); });
});
let more=await p.evaluate(()=>({
  n:($('mwNtBox').textContent.match(/JAN /g)||[]).length,
  bar:!!$('mwNtBox').querySelector('[data-listmore]'),
  find:!!$('mwNtFind'), cam:!!$('mwNtFindCam'), clr:!!$('mwNtFindClear'),
  ph:String(($('mwNtFind')||{}).placeholder||'') }));
console.log('   '+JSON.stringify(more));
ok(more.n===10,'★★★既定は10件だけ出す');
ok(more.bar===true,'★★★「さらに10件」で広げられる');
ok(more.find&&more.cam&&more.clr,'★★★検索欄とバーコードと「×」がある');
ok(/商品名/.test(more.ph)&&/JAN/.test(more.ph)&&/社/.test(more.ph),
   '★★検索できるものを書いてある');
let wide=await p.evaluate(()=>{
  $('mwNtBox').querySelector('[data-listmore]').click();
  return ($('mwNtBox').textContent.match(/JAN /g)||[]).length;
});
ok(wide===14,'★★押すと広がる');
const find=async(q)=>await p.evaluate((q)=>{
  $('mwNtFind').value=q;
  findRun('nt');
  return { box:($('mwNtBox').textContent||'').replace(/\s+/g,' '),
    note:($('mwNtNote').textContent||'').replace(/\s+/g,' ') };
},q);
let f1=await find('ゼルダ');
ok(/ゼルダの伝説/.test(f1.box)&&!/商品の名前0/.test(f1.box),
   '★★★商品名で絞れる');
ok(/検索に当たった 1件/.test(f1.note),'★★当たった件数を出す');
ok(/たちつ商事/.test((await find('たちつ')).box),'★★★社で探せる');
ok(/JAN 4902370510005/.test((await find('4902370510005')).box),
   '★★★JAN で探せる');
let f9=await find('そんなものはない');
ok(/当たった商品がありません|検索に当たった商品がありません/.test(f9.box),
   '★★当たらないときはそう出す');
let fc=await p.evaluate(()=>{
  $('mwNtFindClear').click();
  return ($('mwNtBox').textContent||'').replace(/\s+/g,' ');
});
ok(/商品の名前0/.test(fc),'★★★「×」で全部に戻る');

console.log('\n=== ① なぜ知らせに出たのかも出す ===');
await setup({ csv:csvRuns(),
  nt:{ ok:true, at:AT, at_jst:'x', kind:'gone', jans:4, limit:500, over:1.15,
    n:4, rows:[
      ntRow(0,{ ebay:1 }),
      ntRow(1,{ buy_qty:2 }),
      ntRow(2,{ buy_qty:1, ordered_at:'2026-11-08T00:00:00Z' }),
      ntRow(3,{ buy_qty:1, reg_state:'pj',
        reg_sku:'mwhobby-20261108-N-B0NT000003-3476', reg_ok:1 })] } });
await openCfg();
let why=await p.evaluate(async()=>{
  mwCsvRunsShow();
  await new Promise(function(r){ setTimeout(r,250); });
  $('mwCsvRuns').querySelector('[data-nt="gone"]').click();
  await new Promise(function(r){ setTimeout(r,350); });
  return ($('mwNtBox').textContent||'').replace(/\s+/g,' ');
});
console.log('   '+why.slice(0,420));
ok(/eBay に無在庫で出品中/.test(why),'★★★eBay に出していたことが分かる');
ok(/仕入れる印 2点/.test(why),'★★★仕入れる印が分かる');
ok(/注文した /.test(why),'★★★「注文した」が分かる（日付つき）');
ok(/Amazon 登録済み/.test(why),'★★★Amazon に登録済みが分かる');
ok(/mwhobby-20261108/.test(why),'★★SKU も出す');

console.log('\n=== ② 「注文した」の印 ===');
const BUY=(x)=>({ ok:true, n:1, qty:1, yen:3476, gone:0, rows:[Object.assign({
  jan:'4570101051127', qty:1, sha:'いろは商会', mw_name:'薔薇と椿',
  amz_name:'薔薇と椿 フィギュア', wholesale:3160, asin:'B0BARA0001',
  price:8920, rst:'ok', cand_n:1, kishu:'ホビー', cond:'新品', stock:9,
  ship_days:0, gone:0, gone_at:null, pics:2, fee_total:1500,
  reg_state:'', reg_sku:null, reg_at:null, ordered_at:'', ordered_by:'',
  reg_ok:0 },x||{})] });
await setup({ csv:csvRuns(), buy:BUY(),
  nt:{ ok:true, rows:[], n:0, jans:0 } });
await p.evaluate(async()=>{
  switchTab('F');
  await new Promise(function(r){ setTimeout(r,120); });
  mwBuyShow();
  await new Promise(function(r){ setTimeout(r,350); });
});
let b1=await p.evaluate(()=>({
  txt:($('csvMwAmzList').textContent||'').replace(/\s+/g,' '),
  note:($('csvMwAmzListNote').textContent||'').replace(/\s+/g,' '),
  btn:!!document.querySelector('#csvMwAmzList [data-buyord]'),
  lbl:(document.querySelector('#csvMwAmzList [data-buyord]')||{}).textContent||'' }));
console.log('   '+b1.note);
console.log('   '+b1.txt.slice(0,200));
ok(b1.btn===true&&/注文した/.test(b1.lbl),'★★★行に「注文した」のボタンがある');
ok(/これから仕入れる（MW にあります・まだ注文していません） 1件/.test(b1.txt),
   '★★★まだ注文していない行は「これから仕入れる」');
ok(/注文したら行の「注文した」を押してください/.test(b1.txt),
   '★★押し方を書いてある');
dlg=[];
let b2=await p.evaluate(async()=>{
  document.querySelector('#csvMwAmzList [data-buyord]').click();
  await new Promise(function(r){ setTimeout(r,350); });
  return window.__posts.filter(function(x){ return x.u==='buy'; })
    .map(function(x){ return x.b; });
});
console.log('   '+JSON.stringify(b2));
ok(b2.some((x)=>x&&x.items&&x.items[0]&&x.items[0].jan==='4570101051127'
   &&x.items[0].ordered===1),
   '★★★押すと ordered=1 を送る（数量は触らない）');
ok(dlg.length===0,'★★付けるときは確認を出さない（すぐ押せる）');

console.log('\n=== ③ 「注文した」行は仕入れ済みに移る ===');
await setup({ csv:csvRuns(), nt:{ ok:true, rows:[], n:0, jans:0 },
  buy:BUY({ ordered_at:'2026-11-08T00:00:00Z', ordered_by:'admin' }) });
await p.evaluate(async()=>{
  switchTab('F');
  mwBuyShow();
  await new Promise(function(r){ setTimeout(r,350); });
});
let b3=await p.evaluate(()=>({
  txt:($('csvMwAmzList').textContent||'').replace(/\s+/g,' '),
  note:($('csvMwAmzListNote').textContent||'').replace(/\s+/g,' '),
  lbl:(document.querySelector('#csvMwAmzList [data-buyord]')||{}).textContent||'' }));
console.log('   '+b3.note);
console.log('   '+b3.txt.slice(0,260));
ok(/仕入れ済み 1件/.test(b3.note)&&/これから仕入れる 0件/.test(b3.note),
   '★★★「注文した」行は仕入れ済みに数える');
ok(/注文した 1件/.test(b3.note),'★★注文した件数も出す');
ok(/仕入れ済み（注文した・登録済み・MW で売り切れ） 1件/.test(b3.txt),
   '★★★仕入れ済みの区分に出す');
ok(/注文した 11\/08|注文した 2026/.test(b3.txt),
   '★★★行に「注文した」の日付を出す');
ok(/注文を取り消す/.test(b3.lbl),'★★もう一度押せば取り消せる');
ok(/「注文前に売り切れました」からも外れます/.test(b3.txt),
   '★★★知らせの対象から外れると書いてある');
/* 取り消すときは確認を出す。 */
dlg=[]; cancel=true;
let b4=await p.evaluate(async()=>{
  window.__posts=[];
  document.querySelector('#csvMwAmzList [data-buyord]').click();
  await new Promise(function(r){ setTimeout(r,250); });
  return window.__posts.filter(function(x){ return x.u==='buy'; }).length;
});
cancel=false;
ok(dlg.some((m)=>/「注文した」の印を外します/.test(m)),
   '★★★外すときは確認を出す');
ok(b4===0,'★★やめたら外さない');

console.log('\n=== ③ Amazon 登録済みの行も仕入れ済み ===');
await setup({ csv:csvRuns(), nt:{ ok:true, rows:[], n:0, jans:0 },
  buy:BUY({ reg_ok:1 }) });     // mw_reg_log は通っているが reg_state は空
await p.evaluate(async()=>{
  switchTab('F');
  mwBuyShow();
  await new Promise(function(r){ setTimeout(r,350); });
});
let b5=await p.evaluate(()=>({
  txt:($('csvMwAmzList').textContent||'').replace(/\s+/g,' '),
  note:($('csvMwAmzListNote').textContent||'').replace(/\s+/g,' ') }));
console.log('   '+b5.note);
ok(/仕入れ済み 1件/.test(b5.note),
   '★★★pj が通した記録があれば（reg_state が空でも）仕入れ済みに移る');
ok(/Amazon 登録済み/.test(b5.txt),'★★★行にも「Amazon 登録済み」と出す');

console.log('\n=== 作業者の端末 ===');
await setup({ csv:csvRuns(), role:'staff', buy:BUY(),
  nt:{ ok:true, rows:[], n:0, jans:0 } });
let st=await p.evaluate(async()=>{
  switchTab('F');
  mwBuyShow();
  await new Promise(function(r){ setTimeout(r,350); });
  window.__posts=[];
  const b=document.querySelector('#csvMwAmzList [data-buyord]');
  if(b)b.click();
  await new Promise(function(r){ setTimeout(r,250); });
  return { posts:window.__posts.filter(function(x){ return x.u==='buy'; }).length,
    note:($('csvMwAmzListNote').textContent||'').replace(/\s+/g,' ') };
});
ok(st.posts===0&&/管理者/.test(st.note),
   '★★★作業者の端末からは印を付けられない（仕入れの判断なので）');

await T.done();
})();
