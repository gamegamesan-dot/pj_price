/* 画面：書き出しのまとめと「Shopify に読み込みました」の対象（6.194・カジの報告）
   ① CSV の書き出しで「書き出した ◯件・外した ◯件（商品名と理由）」を必ず出す
   ② 同じ JAN が2行来ても Handle は1つ（Shopify が読める形）
   ③ 在庫は「上限 − 取り込んだ注文の点数」
   ④ 「Shopify に読み込みました」は、直前の CSV に入っていた商品だけを既定にし、
      行ごとに外せる。以前から印がある商品は別に分けて出す
   ⑤ Shopify の商品CSV と突き合わせて、あるものだけ印を付ける
   ⑥ 「会員に出す印のある行だけ表示」と「印をまとめて外す」 */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：読み込みましたの対象と書き出しのまとめ（6.194）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], no=false;
p.on('dialog',async d=>{ dlg.push(d.message()); if(no)await d.dismiss();
                         else await d.accept(); });

const SUB=(o)=>Object.assign({ jan:'4902370550001', name:'商品1',
  asin:'B0AA000001', kishu:'NS', price:3400, max_qty:5, grades:'monitor',
  cost:3300, size_g:110, size_tier:'s', px_hand:0, loaded_at:'', sold:0,
  on:1 },o);

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('fx').value='160';
  window.__q=[]; window.__dl=[];
  window.dl=(name,text)=>{ window.__dl.push({ name:name, text:text });
    return true; };
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body;
    const res=(x,st)=>new Response(JSON.stringify(x),{status:st||200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/mw\/sub\/put/.test(url)){
      window.__q.push({ u:'subput', b:JSON.parse(String(b||'{}')) });
      return res({ ok:true, n:1, prices:{} });
    }
    if(/\/sub\/loaded/.test(url)){
      const body=JSON.parse(String(b||'{}'));
      window.__q.push({ u:'loaded', b:body });
      return res({ ok:true, n:(body.jans||[]).length });
    }
    if(/\/sub\/plan/.test(url))return res({ ok:true, rows:[], n:0 });
    if(/\/mw\/sub/.test(url)&&(i||{}).method==='POST'){
      const body=JSON.parse(String(b||'{}'));
      window.__q.push({ u:'subpost', b:body });
      return res({ ok:true, n:(body.items||[]).length,
        rows:(body.items||[]).map((x)=>({ jan:x.jan, on:x.on })) });
    }
    if(/\/mw\/sub/.test(url)){
      window.__q.push({ u:'subget', url:url });
      return res({ ok:true, table_ok:true, n:(o.rows||[]).length,
                   rows:o.rows||[] });
    }
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
  switchTab('F');
},o||{});

console.log('=== ①② 書き出しのまとめ（黙って外さない）===');
await setup({ rows:[
  SUB({}),
  /* 同じ JAN が2行（2社が扱う商品）。Handle がダブると Shopify が読めない。 */
  SUB({}),
  SUB({ jan:'4902370550002', name:'薔薇と椿 〜お豪華絢爛版〜 -Switch【特典】お表裏ジャケット、お取扱' }),
  SUB({ jan:'4902370550003', name:'価格なし', price:0, cost:0 }),
  SUB({ jan:'4902370550004', name:'上限なし', max_qty:0 })] });
await openCsvBoxes(p);
await p.evaluate(()=>mwSubCsvGo());
await p.waitForTimeout(500);
{
  const t=await p.evaluate(()=>({
    note:($('mwSubNote').textContent||'').replace(/\s+/g,' '),
    text:(window.__dl[0]||{}).text||'' }));
  console.log('   '+t.note.slice(0,220));
  ok(/書き出した 2件/.test(t.note),'★★★書き出した件数を出す');
  ok(/外した 3件/.test(t.note),'★★★外した件数を出す');
  ok(/同じ JAN が2行/.test(t.note),
     '★★★理由：同じ JAN が2行あります（Shopify が読めない形）');
  ok(/販売価格が入っていません/.test(t.note)
     ||/販売数の上限が入っていません/.test(t.note),
     '★★値段・上限が無い行の理由を出す');
  ok(/販売数の上限が入っていません/.test(t.note),'★★理由：販売数の上限');
  ok(/上限なし/.test(t.note)&&/商品1/.test(t.note),
     '★★★商品名も出す（どれが外れたか分かる）');
  ok((t.text.match(/sub-4902370550001/g)||[]).length===1,
     '★★★CSV に同じ Handle の行は1つだけ');
  ok(/薔薇と椿 〜お豪華絢爛版〜,/.test(t.text)
     ||t.text.indexOf('薔薇と椿 〜お豪華絢爛版〜')>=0,
     '★★★Title から MW の付け足し（【特典】…）を外す');
  ok(/特典：お表裏ジャケット、お取扱/.test(t.text),
     '★★★特典の中身は説明文に移す');
}

console.log('=== ③ 在庫は「上限 − 取り込んだ注文の点数」===');
await setup({ rows:[SUB({ max_qty:5, sold:1 })] });
await p.evaluate(()=>mwSubCsvGo());
await p.waitForTimeout(500);
{
  const t=await p.evaluate(()=>({
    note:($('mwSubNote').textContent||'').replace(/\s+/g,' '),
    text:(window.__dl[0]||{}).text||'' }));
  const rows=await p.evaluate((x)=>PJ_SHOPCSV.splitCsv(x),t.text);
  const i=rows[0].indexOf('Variant Inventory Qty');
  ok(rows[1][i]==='4','★★★CSV の在庫は 上限5 − 注文1 ＝ 4');
  ok(/上限 5 − 注文 1 ＝ 4点/.test(t.note),
     '★★注文のぶんを引いたことを画面にも出す');
}

console.log('=== ④ 「Shopify に読み込みました」の対象を選ぶ ===');
await setup({ rows:[SUB({ jan:'4902370550001', name:'いま出した1' }),
                    SUB({ jan:'4902370550002', name:'いま出した2' }),
                    SUB({ jan:'4902370550009', name:'前からの印' })] });
await p.evaluate(()=>{
  /* 直前に書き出した CSV は2件だけだった、という控え。 */
  subLastCsvSave([{ jan:'4902370550001', name:'いま出した1' },
                  { jan:'4902370550002', name:'いま出した2' }]);
});
await p.evaluate(()=>subLoadedGo());
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>({
    html:($('subLoadedBox').innerHTML||''),
    txt:($('subLoadedBox').textContent||'').replace(/\s+/g,' '),
    on:Array.prototype.filter.call(
      document.querySelectorAll('#subLoadedBox [data-slchk]'),
      (el)=>el.checked).map((el)=>el.getAttribute('data-slchk')),
    all:document.querySelectorAll('#subLoadedBox [data-slchk]').length }));
  console.log('   '+t.txt.slice(0,160));
  ok(t.all===3,'★★★対象の商品を一覧で出す（行ごとにチェックがある）');
  ok(t.on.length===2&&t.on.indexOf('4902370550009')<0,
     '★★★既定の対象は「直前に書き出した CSV の商品」だけ');
  ok(/直前に書き出した CSV の商品 2件/.test(t.txt),'★★見出しに件数');
  ok(/以前から印が付いている商品 1件/.test(t.txt),
     '★★★前からの印は別に分けて出す');
  ok(/いま出した1/.test(t.txt)&&/前からの印/.test(t.txt),'★商品名が出る');
}
/* 1件チェックを外して押す → 外した商品は送らない。 */
await p.evaluate(()=>{
  document.querySelector('#subLoadedBox [data-slchk="4902370550002"]').checked=false;
  subLoadedPut();
});
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>({
    b:(window.__q.filter((x)=>x.u==='loaded').pop()||{}).b,
    box:($('subLoadedBox').innerHTML||''),
    note:($('subNote').textContent||'') }));
  console.log('   結果：'+t.note);
  ok((t.b.jans||[]).length===1&&t.b.jans[0]==='4902370550001',
     '★★★チェックを外した商品は送らない');
  ok(!t.box,'★★押したら一覧を閉じる');
  ok(/1件/.test(t.note)&&/印を付けました/.test(t.note),'★結果を出す');
}

console.log('=== ⑤ Shopify の商品CSV と突き合わせる ===');
{
  const g=await p.evaluate(()=>subShopHandles(
    'Handle,Title,Variant SKU\n'
    +'sub-4902370550001,いま出した1,SUB-1\n'
    +'os-4902370550003,海外向け,W-3\n'
    +'sub-4902370550009,前からの印,SUB-9\n'));
  ok(g.ok&&g.jans.length===2,'★★★Handle が sub- の商品だけ拾う');
  ok(g.jans.indexOf('4902370550003')<0,
     '★★★海外向け（os-）は会員用に混ぜない');
  const ng=await p.evaluate(()=>subShopHandles('A,B\n1,2\n'));
  ok(ng.ok===false,'★Handle の列が無いファイルは断る');
  const nw=await p.evaluate(()=>subShopHandles(
    'URL handle,Title\nsub-4902370550001,いま出した1\n'));
  ok(nw.ok&&nw.jans.length===1,'★★新しい列名（URL handle）でも読める');
}

console.log('=== ⑥ 印のある行だけ表示・印をまとめて外す ===');
await setup({ rows:[SUB({ jan:'4902370550001' }),SUB({ jan:'4902370550002' })] });
{
  const t=await p.evaluate(()=>({
    chk:!!$('mwSubOnly'), btn:!!$('mwSubOffAll'),
    f:(function(){ $('mwSubOnly').checked=true; return mwAmzFilters().subOn; })() }));
  ok(t.chk,'★★★「会員に出す印のある行だけ表示」のチェックがある');
  ok(t.btn,'★★★「印をまとめて外す」のボタンがある');
  ok(t.f===true,'★★チェックすると絞り込みに効く');
  const keep=await p.evaluate(()=>{
    mwSubMap={ '4902370550001':{ on:1 } };
    const x={ r:{ jan:'4902370550002' }, c:{ profit:100 } };
    const y={ r:{ jan:'4902370550001' }, c:{ profit:100 } };
    const f=mwAmzFilters();
    return { no:mwAmzKeep(x,f,true), yes:mwAmzKeep(y,f,true) };
  });
  ok(keep.yes===true&&keep.no===false,
     '★★★印のある行だけ残る（印の付け外しを確かめられる）');
}
await p.evaluate(()=>{ $('mwSubOnly').checked=false; window.__q=[];
                       return mwSubOffAllGo(); });
await p.waitForTimeout(500);
{
  const t=await p.evaluate(()=>({
    posts:window.__q.filter((x)=>x.u==='subpost'),
    note:($('mwSubNote').textContent||'') }));
  const items=(t.posts[0]||{b:{}}).b.items||[];
  ok(items.length===2&&items.every((x)=>x.on===0),
     '★★★印のある行ぜんぶの印を外す');
  ok(/2件/.test(t.note),'★件数を出す');
  ok(dlg.some((m)=>/印だけ外します|上限と販売価格は消しません/.test(m)),
     '★★確認のときに「上限と価格は消さない」と伝える');
}

await T.done();
})();
