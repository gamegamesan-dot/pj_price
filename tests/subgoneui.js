/* 画面：Discord から消えたカードの知らせ（8.38・カジの報告・v297）
   ① 書き直し・今すぐ送る・全プランに配るの結果に
      「消えていたカード ◯件（次の配信で出し直せます）」が出る
   ② 止まらない（失敗 0 のまま最後まで進む）
   ③ 予定と確認の画面に「新しく（前のカードが消えていたため）」が出る */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：消えたカードの知らせ（8.38）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[];
p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

const ITEM=(o)=>Object.assign({ jan:'4902370550001', name:'商品A',
  price:3645, qty:1, left:1, gross:1200, sent:false, same:false,
  gone_card:false, ship:'クリックポスト',
  ship_text:'クリックポスト（1〜2本 ¥200）', ship_sure:true, ship_warn:'',
  handle:'sub-4902370550001', warns:[] },o||{});
const PLAN=()=>({ ok:true, table_ok:true, token:true, day:'2026-11-15',
  skip:false, on:true, hour:8, pre:true, domain:'x.myshopify.com', rows:2,
  plans:[
  { key:'monitor', name:'モニター', on:true, ch:'111', ch_name:'リスト-モニター',
    n:10, q:1, kinds:'game', add:1, edit:0, keep:0, why:'', items:[
      /* 前のカードが Discord から消えていた行。 */
      ITEM({ gone_card:true })] },
  { key:'light', name:'ライト', on:true, ch:'222', ch_name:'リスト-ライト',
    n:10, q:1, kinds:'game', add:1, edit:0, keep:0, why:'', items:[
      ITEM({ jan:'4902370550002', name:'商品B' })] },
  { key:'standard', name:'スタンダード', on:false, ch:'', add:0, edit:0,
    keep:0, items:[], why:'⚙で「配信する」が入っていません' },
  { key:'premium', name:'プレミアム', on:false, ch:'', add:0, edit:0,
    keep:0, items:[], why:'⚙で「配信する」が入っていません' }] });

const setup=async(send)=>{
  await p.evaluate((send)=>{
    $('syncApi').value='https://sync.example'; $('syncKey').value='k';
    window.__q=[]; window.__send=send;
    window.fetch=async(u,i)=>{
      const url=String(u), b=(i||{}).body;
      const res=(x)=>new Response(JSON.stringify(x),{status:200});
      if(/\/whoami/.test(url))
        return res({ ok:true, role:'admin', staff_key_set:true });
      if(/\/sub\/plan/.test(url))return res(window.__plan);
      if(/\/sub\/send/.test(url)){
        window.__q.push({ u:'send', b:JSON.parse(String(b||'{}')) });
        return res(window.__send);
      }
      if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, n:0, rows:[] });
      if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
      return res({ ok:true });
    };
    syncRole='admin'; roleApply(); switchTab('F');
  },send);
  await p.waitForTimeout(80);
};

console.log('=== ① 書き直しの結果 ===');
await setup({ ok:true, sent:0, edited:4, skipped:0, fail:0, gone:2, left:0 });
await openCsvBoxes(p);
await p.evaluate((d)=>{ window.__plan=d; },PLAN());
{
  dlg=[];
  await p.evaluate(async()=>{ await subRedoGo(); });
  await p.waitForTimeout(500);
  const t=await p.evaluate(()=>
    ($('subNote').textContent||'').replace(/\s+/g,' '));
  console.log('   '+t.slice(0,200));
  ok(/今の形に書き直しました/.test(t),'★★★止まらずに終わる');
  ok(/消えていたカード 2件/.test(t),'★★★消えていたカードの件数を出す');
  ok(/次の配信で出し直せます/.test(t),
     '★★★次の配信で出し直せると書く（ここでは出さない＝通知を鳴らさない）');
  ok(/書き換え 4件/.test(t),'★★後ろのプランも書き直せている');
}

console.log('=== ② 今すぐ送るの結果 ===');
{
  await p.evaluate(()=>{ window.__send={ ok:true, sent:1, edited:2,
    skipped:0, fail:0, gone:1, left:0 }; });
  await p.evaluate(async()=>{ await subPlanGo(true); await subSendGo(); });
  await p.waitForTimeout(500);
  const t=await p.evaluate(()=>
    ($('subNote').textContent||'').replace(/\s+/g,' '));
  console.log('   '+t.slice(0,160));
  ok(/消えていたカード 1件/.test(t),'★★★「今すぐ送る」でも同じ知らせ');
}

console.log('=== ③ 全プランに配るの結果 ===');
{
  await p.evaluate(()=>{ window.__send={ ok:true, sent:1, edited:0,
    skipped:0, fail:0, gone:1, left:0 }; });
  await p.evaluate(()=>subAllOpen());
  await p.waitForTimeout(400);
  const box=await p.evaluate(()=>
    ($('subAllBox').textContent||'').replace(/\s+/g,' '));
  console.log('   '+box.slice(0,220));
  ok(/新しく（前のカードが消えていたため）/.test(box),
     '★★★確認の画面に「新しく（前のカードが消えていたため）」と出る');
  ok(!/商品B.*消えていたため/.test(box),'★消えていない行には書かない');
  await p.evaluate(()=>subAllSend());
  await p.waitForTimeout(3200);
  const t=await p.evaluate(()=>
    ($('subAllNote').textContent||'').replace(/\s+/g,' '));
  console.log('   '+t.slice(0,200));
  ok(/送りました/.test(t)&&/失敗 0件/.test(t),'★★止まらずに送り終える');
  ok(/消えていたカード 2件/.test(t),
     '★★★「全プランに配る」でも合計して出す（プランごとに数える）');
}

console.log('=== ④ 予定の一覧 ===');
{
  const t=await p.evaluate(async()=>{
    window.__plan=JSON.parse(JSON.stringify(window.__plan));
    await subPlanGo(true);
    subTabSet('all');
    return ($('subPlanList').textContent||'').replace(/\s+/g,' ');
  });
  console.log('   '+t.slice(0,200));
  ok(/新しく送る（前のカードが消えていたため）/.test(t),
     '★★★予定の一覧にも理由を出す');
}

await T.done();
})();
