/* 画面：案と予定をプランのタブで分ける（8.23・カジの依頼）
   ① タブを横一列で出す（すべて／モニター／ライト／スタンダード／
      プレミアム／目玉商品）。件数つき・止めているプランは薄く「止めています」
   ② タブを選ぶと、そのプランの行・まとめ・0件の理由・
      「◯◯だけ送る」だけを出す
   ③ ［すべて］は今までどおり全部。「この案で出す」はタブの中でも押せて、
      どの範囲を出すかが確認で分かる
   ④ 開いていたタブをこの端末に覚える（初めてはモニター）
   ⑤ ⚙の「◯◯に配信する」は、印を入れると「配信中」に変わる */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：プランのタブ（8.23）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], no=false;
p.on('dialog',async d=>{ dlg.push(d.message()); if(no)await d.dismiss();
                         else await d.accept(); });

const item=(jan,o)=>Object.assign({ jan:jan, name:'商品'+jan, price:3000,
  qty:1, left:1, gross:800, sent:false, same:false },o||{});
const PLAN={ ok:true, table_ok:true, token:true, day:'2026-11-14', skip:false,
  on:false, hour:8, pre:true, domain:'x.myshopify.com', rows:3, plans:[
    { key:'monitor', name:'モニター', on:true, ch:'111', n:10, q:1,
      kinds:'game', add:1, edit:0, keep:0, why:'',
      items:[item('4902370550001')] },
    { key:'light', name:'ライト', on:true, ch:'222', n:20, q:2, kinds:'game',
      add:2, edit:1, keep:0, why:'',
      items:[item('4902370550002'),item('4902370550003'),
             item('4902370550004',{ sent:true })] },
    { key:'standard', name:'スタンダード', on:true, ch:'', n:50, q:5,
      kinds:'all', add:0, edit:0, keep:0, items:[],
      why:'⚙にチャンネルID が入っていません' },
    { key:'premium', name:'プレミアム', on:false, ch:'', n:100, q:5,
      kinds:'one', add:0, edit:0, keep:0, items:[],
      why:'⚙で「配信する」が入っていません' },
    { key:'one_pre', name:'目玉商品-先行（プレミアム）', on:true, ch:'777',
      one:true, add:1, edit:0, keep:0, why:'',
      items:[item('one-1',{ name:'ガンダム RG νガンダム', price:4800 })] },
    { key:'one_open', name:'目玉商品（スタンダード以上）', on:true, ch:'888',
      one:true, add:0, edit:0, keep:0, items:[],
      why:'先行のあと 20時間待ちです 1件' }] };

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__q=[]; window.__plan=o.plan;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body;
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/sub\/plan/.test(url))return res(window.__plan);
    if(/\/sub\/send/.test(url)){
      window.__q.push({u:'send',b:JSON.parse(String(b||'{}'))});
      return res({ ok:true, sent:1, edited:0, skipped:0, plans:[] }); }
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
  syncRole='admin'; roleApply(); switchTab('F');
  try{ lsDel('pj:sub:tab:v1'); }catch(e){}
},o||{});
const tabs=async()=>await p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('#subPlanList .tabbtn'),
  (b)=>({ key:b.getAttribute('data-tab'),
          txt:b.textContent.replace(/\s+/g,' '),
          on:b.className.indexOf('on')>=0,
          off:b.className.indexOf('off')>=0 })));

console.log('=== ①④ タブの帯と件数（既定はモニター）===');
await setup({ plan:PLAN });
await openCsvBoxes(p);
await p.evaluate(()=>subPlanGo());
await p.waitForTimeout(400);
{
  const t=await tabs();
  console.log('   '+t.map((x)=>x.txt+(x.on?'◀':'')).join(' | '));
  ok(t.length===6,'★★★タブは6つ（すべて・4プラン・目玉商品）');
  ok(t.map((x)=>x.key).join(',')==='all,monitor,light,standard,premium,one',
     '★★★並びは すべて→モニター→ライト→スタンダード→プレミアム→目玉商品');
  ok(/モニター 1/.test(t[1].txt),'★★★タブに件数が出る（モニター 1）');
  ok(/ライト 3/.test(t[2].txt),'★★★ライト 3件');
  ok(/すべて 5/.test(t[0].txt),'★★すべては合計');
  ok(/目玉商品 1/.test(t[5].txt),'★★★目玉商品は先行＋みんなの合計');
  ok(t[4].off===true&&/止めています/.test(t[4].txt),
     '★★★配信がオフのプランは薄く「止めています」');
  ok(t[3].off===false,'★チャンネルIDが無いだけのプランは止めていない扱い');
  ok(t[1].on===true,'★★★初めてのときはモニターのタブ');
}
{
  const txt=await p.evaluate(()=>($('subPlanList').textContent||'')
    .replace(/\s+/g,' '));
  ok(/モニター 1件/.test(txt),'★★★選んだタブのプランだけ出る');
  ok(!/ライト 3件/.test(txt)&&!/目玉商品-先行/.test(txt),
     '★★★ほかのプランは出さない');
  const btn=await p.evaluate(()=>Array.prototype.map.call(
    document.querySelectorAll('#subPlanList button:not(.tabbtn)'),
    (b)=>b.textContent.replace(/\s+/g,' ')));
  ok(btn.length===1&&/モニターだけ送る/.test(btn[0]),
     '★★★「◯◯だけ送る」もそのプランのぶんだけ');
}

console.log('=== ② タブを選び替える ===');
await p.evaluate(()=>subTabPick('light'));
await p.waitForTimeout(150);
{
  const txt=await p.evaluate(()=>($('subPlanList').textContent||'')
    .replace(/\s+/g,' '));
  ok(/ライト 3件/.test(txt)&&/新しく 2・書き換え 1・そのまま 0/.test(txt),
     '★★★ライトの行とまとめが出る');
  ok(!/モニター 1件/.test(txt),'★★モニターは出ない');
  const t=await tabs();
  ok(t[2].on===true,'★★選んだタブに印が付く');
}
await p.evaluate(()=>subTabPick('standard'));
await p.waitForTimeout(150);
{
  const txt=await p.evaluate(()=>($('subPlanList').textContent||'')
    .replace(/\s+/g,' '));
  ok(/0件：⚙にチャンネルID が入っていません/.test(txt),
     '★★★0件の理由もタブの中に出る');
}
await p.evaluate(()=>subTabPick('one'));
await p.waitForTimeout(150);
{
  const txt=await p.evaluate(()=>($('subPlanList').textContent||'')
    .replace(/\s+/g,' '));
  ok(/目玉商品-先行（プレミアム） 1件/.test(txt)
     &&/目玉商品（スタンダード以上） 0件/.test(txt),
     '★★★目玉商品のタブは先行とみんなの両方を出す');
  ok(/先行のあと 20時間待ちです/.test(txt),'★★待ち時間も出る');
}
await p.evaluate(()=>subTabPick('all'));
await p.waitForTimeout(150);
{
  const txt=await p.evaluate(()=>($('subPlanList').textContent||'')
    .replace(/\s+/g,' '));
  ok(/モニター 1件/.test(txt)&&/ライト 3件/.test(txt)
     &&/目玉商品-先行/.test(txt),'★★★［すべて］は今までどおり全部出す');
}

console.log('=== ④ 覚えている（開き直しても同じタブ）===');
{
  await p.evaluate(()=>subTabPick('light'));
  const kept=await p.evaluate(()=>lsGet('pj:sub:tab:v1'));
  ok(kept==='light','★★★選んだタブをこの端末に覚える');
  await p.evaluate(()=>{ subPlanData=null; $('subPlanList').innerHTML='';
                         return subPlanGo(); });
  await p.waitForTimeout(400);
  const t=await tabs();
  ok(t[2].on===true,'★★★出し直しても前のタブで開く');
}

console.log('=== ③ 案のタブと「この案で出す」の範囲 ===');
await p.evaluate(()=>{
  subDraftData={ at:'2026-11-14T00:00:00Z', rows:4, opt:{ stockPct:30,
    qtyDays:2, wantQty:5 }, plans:[
    { key:'monitor', name:'モニター', on:true, ch:'111', over:0, items:[
      { jan:'4902370550001', name:'ゲームA', price:3000, qty:1, gross:800,
        rate:30, speed:1, stock:9, sale:false, maybe:false, slow:false }] },
    { key:'light', name:'ライト', on:true, ch:'222', over:1, items:[
      { jan:'4902370550002', name:'ゲームB', price:3200, qty:2, gross:900,
        rate:30, speed:2, stock:12, sale:false, maybe:false, slow:false },
      { jan:'4902370550003', name:'ゲームC', price:3400, qty:2, gross:700,
        rate:25, speed:1, stock:8, sale:false, maybe:false, slow:false }] },
    { key:'standard', name:'スタンダード', on:false, ch:'', over:0, items:[] }] };
  subTabSet('monitor');
  $('subDraftBox').innerHTML=subDraftHtml(subDraftData.plans);
});
{
  const t=await p.evaluate(()=>({
    tabs:Array.prototype.map.call(
      document.querySelectorAll('#subDraftBox .tabbtn'),
      (b)=>b.textContent.replace(/\s+/g,' ')),
    txt:($('subDraftBox').textContent||'').replace(/\s+/g,' '),
    btn:Array.prototype.map.call(
      document.querySelectorAll('#subDraftBox button:not(.tabbtn)'),
      (b)=>b.textContent.replace(/\s+/g,' ')) }));
  console.log('   '+t.tabs.join(' | '));
  ok(t.tabs.length===6,'★★★案にもタブが出る');
  ok(/モニター 1/.test(t.tabs[1])&&/ライト 2/.test(t.tabs[2]),
     '★★案のタブにも件数が出る');
  ok(/ゲームA/.test(t.txt)&&!/ゲームB/.test(t.txt),
     '★★★選んだタブのプランの行だけ出る');
  ok(t.btn.length===1&&/この案で出す（モニターの 1件）/.test(t.btn[0]),
     '★★★ボタンに「どの範囲を出すか」を書く');
  ok(/このプランの 1件だけ/.test(t.txt),'★★★ボタンの下にも書く');
}
await p.evaluate(()=>{ window.__q=[]; return subDraftApply(); });
await p.waitForTimeout(600);
{
  const t=await p.evaluate(()=>({
    post:(window.__q.filter((x)=>x.u==='subpost')[0]||{}).b }));
  const items=(t.post||{}).items||[];
  ok(items.length===1&&items[0].jan==='4902370550001',
     '★★★タブの中で押すと、そのプランの行だけを出す');
  ok(dlg.some((m)=>/【モニター】のタブで押しました/.test(m)
     &&/このプランの行だけを出します/.test(m)),
     '★★★確認の画面で範囲がはっきり分かる');
}
const allBtn=await p.evaluate(()=>{ subTabSet('all');
  $('subDraftBox').innerHTML=subDraftHtml(subDraftData.plans);
  return Array.prototype.map.call(
    document.querySelectorAll('#subDraftBox button:not(.tabbtn)'),
    (b)=>b.textContent.replace(/\s+/g,' ')); });
console.log('   ボタン：'+allBtn.join(' / '));
ok(allBtn.some((x)=>/この案で出す（すべてのプランの 3件）/.test(x)),
   '★★ボタンの文も変わる');
await p.evaluate(()=>{ window.__q=[]; return subDraftApply(); });
await p.waitForTimeout(600);
{
  const t=await p.evaluate(()=>({
    post:(window.__q.filter((x)=>x.u==='subpost')[0]||{}).b }));
  const items=(t.post||{}).items||[];
  ok(items.length===3,'★★★［すべて］では全部のプランを出す');
  ok(dlg.some((m)=>/【すべてのプラン】の行を出します/.test(m)),
     '★★★確認でも「すべて」と分かる');
}

console.log('=== ③ 今すぐ送るはタブに関わらず全プラン ===');
await setup({ plan:PLAN });
await p.evaluate(()=>{ subTabSet('light'); return subPlanGo(); });
await p.waitForTimeout(400);
await p.evaluate(()=>{ window.__q=[]; return subSendGo(); });
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>(window.__q.filter((x)=>x.u==='send')[0]||{}).b);
  ok(t&&t.plan===undefined,'★★★「今すぐ送る」は全プランのまま');
  ok(dlg.some((m)=>/タブ（ライト）に関わらず/.test(m)),
     '★★★確認の文で「ぜんぶに送る」と分かる');
}

console.log('=== ⑤ ⚙の「配信中」／「いまは止めています」===');
{
  const t=await p.evaluate(()=>{
    $('subOnLight').checked=false; subOnTxt();
    const off=$('subOnTxtLight').textContent;
    $('subOnLight').checked=true; subOnTxt();
    return { off:off, on:$('subOnTxtLight').textContent,
             mon:$('subOnTxtMonitor').textContent,
             prem:!!document.getElementById('subOnTxtPremium') };
  });
  ok(t.off==='いまは止めています','★★印が無いときは「いまは止めています」');
  ok(t.on==='配信中','★★★印を入れると「配信中」に変わる');
  ok(t.prem===true,'★プレミアムにも同じ文がある');
  const ev=await p.evaluate(async()=>{
    $('subOnStandard').checked=false; subOnTxt();
    $('subOnStandard').checked=true;
    $('subOnStandard').dispatchEvent(new Event('change'));
    await new Promise((x)=>setTimeout(x,100));
    return $('subOnTxtStandard').textContent;
  });
  ok(ev==='配信中','★★★チェックを押しただけで文が変わる');
}

await T.done();
})();
