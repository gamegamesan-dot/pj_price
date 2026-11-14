/* 画面：ライト・スタンダード・プレミアムまで試す（8.20・カジの依頼）
   ① 配信の予定を**プランごとの見出し**で出す（どのプランのぶんか分かる）
   ② 0件のプランは**なぜ0件か**を出す（印オフ／チャンネルID なし／
      ほかのプランに振り分け／ゲームソフトだけのプラン）
   ③ プランごとに「◯◯だけ送る」で1つずつ試せる
   ④ 案の行ごとに**出すプラン**を変えられる（「ぜんぶのプラン」も選べる） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：ライト・スタンダード・プレミアムまで試す（8.20）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[];
p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

const PLAN=(o)=>Object.assign({ ok:true, table_ok:true, token:true,
  day:'2026-11-14', skip:false, on:false, hour:8, pre:true,
  domain:'omakase-ship.myshopify.com', rows:3, plans:[
    { key:'monitor', name:'モニター', on:true, ch:'111', n:10, q:1,
      kinds:'game', add:1, edit:0, keep:0, why:'',
      items:[{ jan:'4902370550001', name:'商品A', price:3645, qty:1, left:1,
               gross:1200, sent:false, same:false }] },
    { key:'light', name:'ライト', on:true, ch:'222', n:20, q:2, kinds:'game',
      add:2, edit:1, keep:0, why:'',
      items:[{ jan:'4902370550002', name:'商品B', price:4200, qty:2, left:2,
               gross:900, sent:false, same:false },
             { jan:'4902370550003', name:'商品C', price:5200, qty:2, left:1,
               gross:800, sent:false, same:false },
             { jan:'4902370550004', name:'商品D', price:6200, qty:2, left:2,
               gross:700, sent:true, same:false }] },
    { key:'standard', name:'スタンダード', on:true, ch:'', n:50, q:5,
      kinds:'all', add:0, edit:0, keep:0, items:[],
      why:'⚙にチャンネルID が入っていません' },
    { key:'premium', name:'プレミアム', on:false, ch:'', n:100, q:5,
      kinds:'one', add:0, edit:0, keep:0, items:[],
      why:'⚙で「配信する」が入っていません' }] },o||{});

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__q=[]; window.__plan=o.plan;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body;
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/sub\/plan/.test(url)){ window.__q.push({u:'plan'});
      return res(window.__plan); }
    if(/\/sub\/send/.test(url)){
      window.__q.push({u:'send',b:JSON.parse(String(b||'{}'))});
      return res({ ok:true, sent:2, edited:1, skipped:0, plans:[] }); }
    if(/\/mw\/sub/.test(url)&&(i||{}).method==='POST'){
      window.__q.push({u:'subpost',b:JSON.parse(String(b||'{}'))});
      return res({ ok:true, n:1, rows:[] }); }
    if(/\/sub\/draft/.test(url)){
      window.__q.push({u:'draft',b:JSON.parse(String(b||'{}'))});
      return res({ ok:true, n:1 }); }
    if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, n:0, rows:[] });
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
},o||{});

console.log('=== ①② プランごとの見出しと「なぜ0件か」===');
await setup({ plan:PLAN({}) });
await openCsvBoxes(p);
/* 8.23：予定はプランのタブで分かれた。ここは全プランを見るので［すべて］。 */
await p.evaluate(()=>{ subTabSet('all'); return subPlanGo(); });
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>({
    txt:($('subPlanList').textContent||'').replace(/\s+/g,' '),
    btn:Array.prototype.map.call(
      document.querySelectorAll('#subPlanList button:not(.tabbtn)'),
      (b)=>b.textContent.replace(/\s+/g,' ')) }));
  console.log('   '+t.txt.slice(0,230));
  ok(/モニター 1件/.test(t.txt),'★★★モニターの見出しと件数');
  ok(/ライト 3件/.test(t.txt),'★★★ライトの見出しと件数');
  ok(/スタンダード 0件/.test(t.txt),'★★スタンダードの見出し');
  ok(/新しく 2・書き換え 1/.test(t.txt),
     '★★プランごとに「新しく・書き換え・そのまま」を出す');
  ok(/0件：⚙にチャンネルID が入っていません/.test(t.txt),
     '★★★0件の理由（チャンネルID なし）を出す');
  ok(/プレミアム ⚙で「配信する」が入っていません/.test(t.txt),
     '★★★止めているプランも理由を出す');
  ok(/商品B/.test(t.txt)&&/商品D/.test(t.txt),'★商品名が出る');
  console.log('   ボタン：'+t.btn.join(' / '));
  ok(t.btn.some((x)=>/モニターだけ送る/.test(x)),
     '★★★「モニターだけ送る」のボタンが出る');
  ok(t.btn.some((x)=>/ライトだけ送る（新しく 2・書き換え 1）/.test(x)),
     '★★★「ライトだけ送る」に件数が出る');
  ok(!t.btn.some((x)=>/スタンダードだけ送る/.test(x)),
     '★★送るものが無いプランにはボタンを出さない');
}

console.log('=== ③ そのプランだけ送る ===');
await p.evaluate(()=>{ window.__q=[]; return subSendGo('light'); });
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>({
    b:(window.__q.filter((x)=>x.u==='send')[0]||{}).b,
    note:($('subNote').textContent||'') }));
  ok(t.b&&t.b.plan==='light','★★★plan を付けて送る（そのプランだけ）');
  ok(t.b&&t.b.approve===true,'★確認したうえで送る');
  ok(dlg.some((m)=>/【ライト】だけに送ります/.test(m)),
     '★★確認の文に「ライトだけ」と出る');
  ok(/新しく 2件/.test(t.note),'★結果を出す');
}
await p.evaluate(()=>{ window.__q=[]; return subSendGo('premium'); });
await p.waitForTimeout(300);
{
  const t=await p.evaluate(()=>({
    n:window.__q.filter((x)=>x.u==='send').length,
    note:($('subNote').textContent||'') }));
  ok(t.n===0,'★★★止めているプランは送らない');
  ok(/そのプランは送れません/.test(t.note),'★★理由を出す');
}
await p.evaluate(()=>{ window.__q=[]; return subSendGo(); });
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>(window.__q.filter((x)=>x.u==='send')[0]||{}).b);
  ok(t&&t.plan===undefined,'★★「今すぐ送る」は今までどおり全プラン');
}

console.log('=== ④ 案の行ごとに出すプランを変える ===');
await setup({ plan:PLAN({}) });
await p.evaluate(()=>{
  /* 案の形だけ作って、画面に出す。 */
  subDraftData={ at:'2026-11-14T00:00:00Z', rows:3, opt:{ stockPct:30,
    qtyDays:2, wantQty:5 }, plans:[
    { key:'monitor', name:'モニター', on:true, ch:'111', over:0, items:[
      { jan:'4902370550001', name:'【新品】商品A ★', price:3645, qty:1,
        gross:1200, rate:30, speed:1, stock:9, sale:false }] },
    { key:'light', name:'ライト', on:true, ch:'222', over:0, items:[
      { jan:'4902370550002', name:'商品B', price:4200, qty:2, gross:900,
        rate:25, speed:2, stock:12, sale:false }] }] };
  /* 8.23：プランのタブで分かれたので、ここは［すべて］で見る。 */
  subTabSet('all');
  $('subDraftBox').innerHTML=subDraftHtml(subDraftData.plans);
});
{
  const t=await p.evaluate(()=>({
    sel:document.querySelectorAll('#subDraftBox select').length,
    opts:Array.prototype.map.call(
      document.querySelectorAll('#subDraftBox select')[0].options,
      (o)=>o.value),
    now:document.querySelectorAll('#subDraftBox select')[0].value,
    name:($('subDraftBox').textContent||'').replace(/\s+/g,' ') }));
  ok(t.sel===2,'★★★行ごとに「出すプラン」の欄がある');
  ok(t.opts.join(',')==='monitor,light,standard,premium,all',
     '★★★4つのプランと「ぜんぶのプラン」を選べる');
  ok(t.now==='monitor','★★はじめは案で振り分けたプランが選ばれている');
  ok(/商品A/.test(t.name)&&!/【新品】/.test(t.name),
     '★★案の商品名も掃除した名前で出す（6.194）');
}
await p.evaluate(()=>{
  /* 1件を「ぜんぶのプラン」に、もう1件をスタンダードに変える。 */
  document.querySelectorAll('#subDraftBox select')[0].value='all';
  document.querySelectorAll('#subDraftBox select')[1].value='standard';
  window.__q=[];
  return subDraftApply();
});
await p.waitForTimeout(700);
{
  const t=await p.evaluate(()=>({
    post:(window.__q.filter((x)=>x.u==='subpost')[0]||{}).b,
    draft:(window.__q.filter((x)=>x.u==='draft')[0]||{}).b }));
  const items=(t.post||{}).items||[];
  const a=items.filter((x)=>x.jan==='4902370550001')[0]||{};
  const b=items.filter((x)=>x.jan==='4902370550002')[0]||{};
  ok(a.grades==='','★★★「ぜんぶのプラン」は grades を空で送る（どのプランにも出る）');
  ok(b.grades==='standard','★★★選び直したプランで送る');
  const dr=((t.draft||{}).items||[]);
  ok(dr.filter((x)=>x.plan==='all').length===1,
     '★★案の記録には「all」として残す');
  ok(dlg.some((m)=>/「ぜんぶのプラン」に出します/.test(m)),
     '★★確認の文にも件数を出す');
}

console.log('=== 8.21（【1】）通常版の印と速さ0の印 ===');
{
  const t=await p.evaluate(()=>{
    $('subNormalNg').value='アルティメット、スペシャルパック';
    subDraftData={ at:'2026-11-14T00:00:00Z', rows:3, opt:{ stockPct:30,
      qtyDays:2, wantQty:5 }, plans:[
      { key:'monitor', name:'モニター', on:true, ch:'111', over:0, items:[
        { jan:'4902370550001', name:'薔薇と椿 〜お豪華絢爛版〜', price:3000,
          qty:1, gross:800, rate:30, speed:1, stock:9, sale:false,
          maybe:true, slow:false },
        { jan:'4902370550002', name:'ふつうのゲーム', price:3000, qty:1,
          gross:900, rate:30, speed:0, stock:9, sale:false,
          maybe:false, slow:true }] }] };
    /* 8.23：プランのタブで分かれたので、ここは［すべて］で見る。 */
    subTabSet('all');
    $('subDraftBox').innerHTML=subDraftHtml(subDraftData.plans);
    return { html:$('subDraftBox').innerHTML,
             cfg:subPickCfg().subNormalNg,
             ng:SUBPLAN.ngWords(subPickCfg()).indexOf('アルティメット')>=0,
             mon:SUBPLAN.list(subCfgAll()).filter((x)=>x.key==='monitor')[0] };
  });
  ok(/通常版か要確認/.test(t.html),'★★★「通常版か要確認」の印が出る');
  ok(/売れる速さ 0/.test(t.html),'★★★「売れる速さ 0」の印が出る');
  ok(t.cfg==='アルティメット、スペシャルパック',
     '★★⚙「通常版でない言葉」を読む');
  ok(t.ng===true,'★★★⚙で足した言葉が判定の表に入る');
  ok(t.mon.normal===true,'★★モニターは通常版だけのプラン');
  const judge=await p.evaluate(()=>{
    const m=SUBPLAN.list(subCfgAll()).filter((x)=>x.key==='monitor')[0];
    return { ng:SUBPLAN.fitWhy(m,{ name:'SW版 東方少女綺想譚 限定版',
               grades:'' },true),
             ok:SUBPLAN.fitWhy(m,{ name:'薔薇と椿 〜お豪華絢爛版〜',
               grades:'' },true),
             add:SUBPLAN.fitWhy(m,{ name:'◯◯ アルティメット',
               grades:'' },true) };
  });
  ok(/通常版ではありません（限定版）/.test(judge.ng),
     '★★★画面でも限定版はモニターから外れる');
  ok(judge.ok==='','★★「お豪華絢爛版」は外さない');
  ok(/アルティメット/.test(judge.add),'★★★⚙で足した言葉でも外れる');
}

await T.done();
})();
