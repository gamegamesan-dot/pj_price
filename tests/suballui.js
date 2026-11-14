/* 画面：全プランにまとめて配る（8.28・カジの依頼1）
   ① 「全プランに配る」で**確認の画面**が出る（まだ送らない）
   ② プランごとに チャンネル名／新しく／書き換え／そのまま、
      0件は「飛ばします」、行の警告を出す
   ③ 警告のある行は**既定で外す**（チェックを入れれば出せる）
   ④ 「送る」でプランの順に1本ずつ送り、外した行は skip で渡す
   ⑤ 途中で失敗したらそこで止めて、どこまで出たかを出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：全プランにまとめて配る（8.28）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[];
p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

const ITEM=(o)=>Object.assign({ jan:'4902370550001', name:'商品A',
  price:3645, qty:1, left:1, gross:1200, sent:false, same:false,
  ship:'クリックポスト', ship_text:'クリックポスト（1〜2本 ¥200）',
  ship_sure:true, ship_warn:'', handle:'sub-4902370550001', warns:[] },o||{});
const PLAN=()=>({ ok:true, table_ok:true, token:true, day:'2026-11-14',
  skip:false, on:true, hour:8, pre:true, domain:'omakase-ship.myshopify.com',
  rows:4, plans:[
  { key:'monitor', name:'モニター', on:true, ch:'111', ch_name:'リスト-モニター',
    n:10, q:1, kinds:'game', add:2, edit:0, keep:1, why:'', items:[
      ITEM({}),
      ITEM({ jan:'4902370550002', name:'商品B' }),
      ITEM({ jan:'4902370550003', name:'商品C', same:true, sent:true })] },
  { key:'light', name:'ライト', on:false, ch:'', ch_name:'', n:20, q:2,
    kinds:'game', add:0, edit:0, keep:0, items:[],
    why:'⚙で「配信する」が入っていません' },
  { key:'standard', name:'スタンダード', on:true, ch:'333',
    ch_name:'リスト-スタンダード', n:50, q:5, kinds:'all',
    add:0, edit:0, keep:0, items:[], why:'選べる商品がありません' },
  { key:'premium', name:'プレミアム', on:true, ch:'444',
    ch_name:'リスト-プレミアム', n:100, q:5, kinds:'all',
    add:1, edit:1, keep:0, why:'', items:[
      ITEM({ jan:'4535506307842', name:'S.H.Figuarts ◯◯', price:9000,
             ship:'', ship_sure:false,
             ship_text:'送料はお会計で表示（会員便・重さで計算）',
             warns:['送料の区分が要確認（採寸がありません）'] }),
      ITEM({ jan:'4535506307843', name:'書き換える商品', sent:true,
             left:0, warns:['残り0（完売）',
               'CSV を出したあと Shopify に読み込み直していません'] })] },
  { key:'one_pre', name:'目玉商品-先行（プレミアム）', on:true, ch:'555',
    ch_name:'目玉商品-先行', one:true, pre:true, n:1, q:0, kinds:'one',
    add:1, edit:0, keep:0, why:'', items:[
      ITEM({ jan:'one-3', name:'秋葉原の1点もの', handle:'one-3',
             ship:'宅配便', ship_text:'宅配便' })] }] });

const setup=async()=>await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__q=[]; window.__fail='';
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body;
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/sub\/plan/.test(url))return res(window.__plan);
    if(/\/sub\/send/.test(url)){
      const body=JSON.parse(String(b||'{}'));
      window.__q.push({ u:'send', b:body });
      if(window.__fail&&body.plan===window.__fail)
        return res({ ok:true, sent:0, edited:0, skipped:0, fail:1,
                     stopped:'fail', stop_plan:'プレミアム', stop_status:403,
                     plans:[] });
      return res({ ok:true, sent:(body.plan==='monitor'?2:1), edited:0,
                   skipped:0, fail:0, left:0, plans:[] });
    }
    if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, n:0, rows:[] });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
});

console.log('=== ① 確認の画面（まだ送らない）===');
await setup();
await openCsvBoxes(p);
await p.evaluate((d)=>{ window.__plan=d; },PLAN());
await p.evaluate(()=>subAllOpen());
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>({
    txt:($('subAllBox').textContent||'').replace(/\s+/g,' '),
    note:($('subAllNote').textContent||'').replace(/\s+/g,' '),
    sends:window.__q.filter((x)=>x.u==='send').length }));
  console.log('   '+t.txt.slice(0,300));
  ok(t.sends===0,'★★★確認の画面を出すだけで、まだ何も送らない');
  ok(/まだ何も送っていません/.test(t.note),'★★そう画面にも書く');
  ok(/#リスト-モニター/.test(t.txt)&&/#リスト-プレミアム/.test(t.txt),
     '★★★チャンネル名を出す（⚙のIDが思っている先か分かる）');
  ok(/#目玉商品-先行/.test(t.txt),'★★★1点ものも同じ画面に出る');
  ok(/モニター → #リスト-モニター 新しく 2・書き換え 0・そのまま 1/.test(t.txt),
     '★★★プランごとに件数を出す');
  ok(/ライト 飛ばします（⚙で「配信する」が入っていません）/.test(t.txt),
     '★★★止めているプランは理由つきで「飛ばします」');
  ok(/スタンダード 飛ばします（選べる商品がありません）/.test(t.txt),
     '★★★0件のプランも「飛ばします」');
  ok(!/商品C/.test(t.txt),'★★「そのまま」の行は出さない（送らないので）');
}

console.log('=== ②③ 警告のある行は既定で外す ===');
{
  const t=await p.evaluate(()=>({
    txt:($('subAllBox').textContent||'').replace(/\s+/g,' '),
    on:['monitor_4902370550001','monitor_4902370550002',
        'premium_4535506307842','premium_4535506307843',
        'one_pre_one-3'].map((k)=>{
      const el=$('subAllChk_'+k); return el?el.checked:null; }),
    sum:($('subAllSumBox').textContent||'').replace(/\s+/g,' ') }));
  console.log('   チェック：'+JSON.stringify(t.on));
  console.log('   '+t.sum);
  ok(t.on[0]===true&&t.on[1]===true,'★★警告のない行は入れておく');
  ok(t.on[2]===false&&t.on[3]===false,'★★★警告のある行は既定で外す');
  ok(t.on[4]===true,'★★1点ものも入れておく');
  ok(/送料の区分が要確認/.test(t.txt)&&/残り0（完売）/.test(t.txt)
     &&/読み込み直していません/.test(t.txt),
     '★★★警告の中身をそのまま出す');
  ok(/外しています。出すときはチェックを入れてください/.test(t.txt),
     '★★なぜ外れているかを書く');
  ok(/2プランに出します（新しく 3件・書き換え 0件・外した 2件）/.test(t.sum),
     '★★★まとめに「外した件数」まで出す（警告で0件になったプランは数えない）');
  /* チェックを入れ直すと、まとめもその場で変わる。 */
  const s2=await p.evaluate(()=>{
    const el=$('subAllChk_premium_4535506307842');
    el.checked=true; subAllTick(el,'premium','4535506307842');
    return ($('subAllSumBox').textContent||'').replace(/\s+/g,' ');
  });
  console.log('   '+s2);
  ok(/新しく 4件/.test(s2)&&/外した 1件/.test(s2),
     '★★★チェックを入れたらまとめもすぐ変わる');
}

console.log('=== ④ プランの順に1本ずつ送る ===');
{
  dlg=[];
  await p.evaluate(()=>{ window.__q=[]; return subAllSend(); });
  await p.waitForTimeout(3500);
  const t=await p.evaluate(()=>({
    q:window.__q.filter((x)=>x.u==='send').map((x)=>x.b),
    note:($('subAllNote').textContent||'').replace(/\s+/g,' ') }));
  console.log('   '+JSON.stringify(t.q));
  ok(t.q.length===3,'★★★出すプランの数だけ送る（0件は飛ばす）');
  ok(t.q.map((x)=>x.plan).join(',')==='monitor,premium,one_pre',
     '★★★モニター→プレミアム→目玉商品の順（プランの順）');
  ok(t.q.every((x)=>x.approve===true),'★確認したうえで送る');
  ok((t.q[1].skip||[]).join(',')==='4535506307843',
     '★★★外した行だけ skip で渡す（入れ直した行は送る）');
  ok((t.q[0].skip||[]).length===0,'★外していないプランの skip は空');
  ok(dlg.some((m)=>/プランの順で送ります/.test(m))
     &&dlg.some((m)=>/#リスト-モニター/.test(m)),
     '★★確認の文にチャンネル名と件数を出す');
  ok(/ぜんぶ送りました/.test(t.note)&&/新しく 4件/.test(t.note),
     '★★★結果（どれだけ出たか）を出す');
}

console.log('=== ⑤ 途中で失敗したら止める ===');
{
  await p.evaluate((d)=>{ window.__plan=d; window.__fail='premium'; },PLAN());
  await p.evaluate(()=>subAllOpen());
  await p.waitForTimeout(400);
  /* プレミアムは警告で外れているので、1件だけ入れ直して送る。 */
  await p.evaluate(()=>{
    const el=$('subAllChk_premium_4535506307842');
    el.checked=true; subAllTick(el,'premium','4535506307842');
  });
  await p.evaluate(()=>{ window.__q=[]; return subAllSend(); });
  await p.waitForTimeout(3500);
  const t=await p.evaluate(()=>({
    q:window.__q.filter((x)=>x.u==='send').map((x)=>x.b.plan),
    note:($('subAllNote').textContent||'').replace(/\s+/g,' ') }));
  console.log('   送った順：'+t.q.join(',')+'／'+t.note.slice(0,160));
  ok(t.q.join(',')==='monitor,premium',
     '★★★失敗したプランで止める（目玉商品まで進まない）');
  ok(/プレミアム/.test(t.note)&&/止まりました/.test(t.note),
     '★★★どこで止まったかを出す');
  ok(/ここまで出ました/.test(t.note)&&/新しく 2件/.test(t.note),
     '★★★どこまで出たかを出す');
  ok(/もう一度「送る」を押してください/.test(t.note)
     &&/二重に出ません/.test(t.note),
     '★★★続きから送れることを書く');
}

console.log('=== ⑥ 作業者のキーでは送れない ===');
{
  const t=await p.evaluate(()=>{
    syncRole='staff'; roleApply();
    window.__q=[];
    subAllOpen();
    return ($('subAllNote').textContent||'');
  });
  await p.waitForTimeout(300);
  const q=await p.evaluate(()=>window.__q.filter((x)=>x.u==='send').length);
  ok(q===0,'★★★作業者のキーでは送らない');
  console.log('   '+t.slice(0,80));
  await p.evaluate(()=>{ syncRole='admin'; roleApply(); });
}

await T.done();
})();
