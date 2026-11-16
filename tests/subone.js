/* 画面：同じ商品を何度も数えない／結果が画面に残る（8.42・カジの報告・v301）

   カジの報告（2026-11-15）
     ・案は「候補136件 → 107件を選択（モニター10・ライト13・
       スタンダード22・プレミアム62）」
     ・ボタンは「この案で出す（すべてのプランの70件）」
     ・押したあと「会員に出す」が 52件のまま増えていない
     ・確認でOKを押したか覚えていない（結果の文がどこに出るか分からない）

   分かったこと
     8.35（積み上げ型）から**1つの商品が複数のプランの案に出る**ので、
     「107件」は**のべの数**（同じ商品を何度も数えている）。
     印は**商品ごとに1つ**なので、出るのは**商品の数**。
     しかも、のべのまま送ると**あとの行が前の行を上書き**するので、
     「モニターから上」のつもりの商品が「プレミアムだけ」になっていた。

   ここで当たること
     ① 案のまとめに「商品◯件（のべ◯件）」と出る
     ② ボタンも「商品◯件」。のべと違うときは、その理由を下に書く
     ③ 送るのは**商品ごとに1件**（同じ JAN を何度も送らない）
     ④ まとめ方：「◯◯だけ」を選んだ行があればそれ。無ければ
        **いちばん下のプラン**（＝いちばん広く出る）
     ⑤ 「この案で出す」の結果が**画面に残る**（ダイアログを閉じても・
        次の案を作っても）。キャンセルしたことも残る
     ⑥ 候補は「いま一覧に出ている行」から数えるので、
        効いている絞り込みを案のまとめに出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：同じ商品を何度も数えない（8.42）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], answer=true;
p.on('dialog',async d=>{ dlg.push(d.message());
  if(answer)await d.accept(); else await d.dismiss(); });

await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__q=[];
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body;
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/mw\/sub/.test(url)){
      if(String((i||{}).method||'')==='POST'){
        const bb=JSON.parse(String(b||'{}'));
        window.__q.push({ u:'sub', items:bb.items||[] });
        return res({ ok:true, rows:(bb.items||[]).map((x)=>({ jan:x.jan })) });
      }
      return res({ ok:true, table_ok:true, n:0, rows:[] });
    }
    if(/\/sub\/draft/.test(url)){ window.__q.push({ u:'draft' });
      return res({ ok:true }); }
    if(/\/sub\/plan/.test(url))return res({ ok:true, plans:[] });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    return res({ ok:true });
  };
  syncRole='admin'; roleApply(); switchTab('F');
  try{ localStorage.removeItem('pj:subdraft:last:v1'); }catch(e){}
  try{ localStorage.setItem('pj:sub:tab:v1','all'); }catch(e){}
  /* 4つのプランを動かす。 */
  ['Monitor','Light','Standard','Premium'].forEach((U,i)=>{
    if($('subOn'+U))$('subOn'+U).checked=true;
    if($('subCh'+U))$('subCh'+U).value=String(111*(i+1));
  });
  $('subMonNew').value='2'; $('subNLight').value='3';
  $('subNStandard').value='4'; $('subNPremium').value='4';
  /* 8.43（v302）モニターは「新しく◯件・速く売れる品だけ」。
     ここはのべの数え方を見る試験なので、2件・下限なしにそろえる。 */
  $('subMonNew').value='2'; $('subMonSpeedMin').value='0.1';
});
await openCsvBoxes(p);

/* ゲームソフト4件。どれも4プランに入る（のべ 2+3+4+4＝13・商品は4件）。 */
const mk=()=>p.evaluate(()=>{
  const S=PJ_SUBPLAN;
  const rows=[];
  for(let i=0;i<4;i++)rows.push({ jan:'490237055000'+i, name:'ゲーム'+i,
    kishu:'NS', stock:20, speed:3+i*0.1, gross:1500, rate:35, price:3000,
    fit:true, rst:'ok', amz:0, buy_qty:0, no_back:false, one_off:false,
    grades:'', is_game:true, on:false, qty:2, ship:'クリックポスト',
    ship_sure:true, ship_text:'クリックポスト', ship_warn:'' });
  const d=S.draft(rows,S.list(subCfgAll()),subPickCfg(),[],Date.now());
  subDraftData={ at:new Date().toISOString(), plans:d.plans, opt:d.opt,
                 rows:9 };
  $('subDraftBox').innerHTML=subDraftHtml(d.plans);
  return { per:d.plans.filter((x)=>x.on).map((x)=>x.key+':'+x.items.length),
           sum:d.plans.filter((x)=>x.on)
             .reduce((a,x)=>a+x.items.length,0),
           one:subDraftPicked('all').length,
           all:subDraftAll('all'),
           btn:(document.querySelector('#subDraftBox button')||{})
             .textContent||'',
           box:($('subDraftBox').textContent||'').replace(/\s+/g,' ') };
});

console.log('=== ①② 商品の数とのべの数 ===');
{
  const t=await mk();
  console.log('   '+JSON.stringify({ per:t.per, sum:t.sum, one:t.one,
    all:t.all }));
  console.log('   '+t.btn.trim());
  ok(t.sum===13&&t.all===13,'★★★のべは 13件（同じ商品が4プランに出る）');
  ok(t.one===4,'★★★送るのは商品 4件（印は商品ごとに1つ）');
  ok(/商品 4件/.test(t.box),'★★★ボタンに「商品 4件」と出る');
  ok(/のべ 13件/.test(t.box),'★★★のべの数と、その理由も出る');
}

console.log('=== ③④ 送るのは商品ごとに1件 ===');
{
  await p.evaluate(()=>{ window.__q=[]; });
  dlg=[]; answer=true;
  await p.evaluate(()=>subDraftApply());
  await p.waitForTimeout(800);
  const t=await p.evaluate(()=>({
    items:(window.__q.filter((x)=>x.u==='sub')[0]||{}).items||[],
    note:($('subDraftNote').textContent||'').replace(/\s+/g,' '),
    last:($('subDraftLast').textContent||'').replace(/\s+/g,' ') }));
  console.log('   送った：'+JSON.stringify(t.items));
  const jans=t.items.map((x)=>x.jan);
  ok(jans.length===4&&new Set(jans).size===4,
     '★★★同じ JAN を何度も送らない（4件だけ）');
  /* いちばん下のプランで送る。モニターは上限2件なので、
     上の2件は「モニターから上」、次はライト、その次はスタンダード。 */
  const gr={}; t.items.forEach((x)=>{ gr[x.jan]=x.grades; });
  console.log('   '+JSON.stringify(gr));
  ok(gr['4902370550003']==='monitor,light,standard,premium'
     &&gr['4902370550002']==='monitor,light,standard,premium',
     '★★★モニターに入った商品は「モニターから上」で送る');
  ok(gr['4902370550001']==='light,standard,premium'
     &&gr['4902370550000']==='standard,premium',
     '★★★入れなかった商品は、入れたいちばん下のプランから上で送る');
  ok(/確認/.test(dlg.join())||dlg.length===1,'★確認を1回だけ出す');
  ok(/商品：4件/.test(dlg.join('')),'★★確認の文も商品の数で出す');
}

console.log('=== ⑤ 結果が画面に残る ===');
{
  const t=await p.evaluate(()=>
    ($('subDraftLast').textContent||'').replace(/\s+/g,' '));
  console.log('   '+t);
  ok(/直前の「この案で出す」/.test(t)&&/4件/.test(t)&&/印を付けました/.test(t),
     '★★★押したあとの結果が①の段に残る');
  /* 次の案を作っても消えない。 */
  await mk();
  const t2=await p.evaluate(()=>
    ($('subDraftLast').textContent||'').replace(/\s+/g,' '));
  ok(/4件/.test(t2)&&/印を付けました/.test(t2),
     '★★★もう一度案を作っても消えない');
  /* 開き直しても出る（この端末に覚える）。 */
  const t3=await p.evaluate(()=>{
    $('subDraftLast').innerHTML=''; subDraftLastRender();
    return ($('subDraftLast').textContent||'').replace(/\s+/g,' '); });
  ok(/4件/.test(t3),'★★★開き直しても出る');
}

console.log('=== ⑤b キャンセルしたことも残る ===');
{
  await mk();
  await p.evaluate(()=>{ window.__q=[]; });
  dlg=[]; answer=false;
  await p.evaluate(()=>subDraftApply());
  await p.waitForTimeout(500);
  const t=await p.evaluate(()=>({
    n:window.__q.filter((x)=>x.u==='sub').length,
    note:($('subDraftNote').textContent||'').replace(/\s+/g,' '),
    last:($('subDraftLast').textContent||'').replace(/\s+/g,' ') }));
  console.log('   '+t.note+' ／ '+t.last);
  ok(t.n===0,'★★★キャンセルしたら何も送らない');
  ok(/やめました/.test(t.note),'★★★「やめました」と画面に出る');
  ok(/キャンセル/.test(t.last),
     '★★★キャンセルしたことも①の段に残る（押したか分かる）');
  answer=true;
}

console.log('=== ⑥ 効いている絞り込みを案に出す ===');
{
  const t=await p.evaluate(()=>{
    $('mwSubOnly').checked=true;
    return subDraftFiltHtml().replace(/<[^>]*>/g,'');
  });
  console.log('   '+t);
  ok(/いま一覧に出ている行/.test(t),
     '★★★候補は「いま一覧に出ている行」から選ぶと書く');
  ok(/「会員に出す」印のある行だけ表示/.test(t),
     '★★★効いている絞り込みを名前で出す（候補が減った理由が分かる）');
  const t2=await p.evaluate(()=>{
    $('mwSubOnly').checked=false;
    $(findPre('amz')).value='FINAL FANTASY';
    const s=subDraftFiltHtml().replace(/<[^>]*>/g,'');
    $(findPre('amz')).value='';
    return s;
  });
  console.log('   '+t2);
  ok(/検索「FINAL FANTASY」/.test(t2),'★★★検索の言葉も出す');
}

await T.done();
})();
