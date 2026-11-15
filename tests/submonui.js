/* 画面：モニターの3週間と分布（8.43・カジの依頼1）

   ・モニターは「速く売れる品だけ・1回に新しく◯件・前の週に出した品は選ばない」
   ・1週目は速い順／2週目からは週ごとに決まるランダムの順
   ・候補が足りない週は、速さの下限を一段下げて埋める（下げた品には印）
   ・案のまとめに「モニターの様子」と「候補の分布」を出す
     （線引きの数字を実データで決めるため）
   ・⚙：新しく出す件数・人数・何日ぶん・購入期限・速さの下限・下げる割合 */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：モニターの3週間（8.43）');
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
/* 速さ＝直近7日に減った数 ÷ 7（shared/mwstat.js）。
   既定の下限は 人数5 ÷ 2日 ＝ 1日 2.5点。
     速い（3.0点）… 4件（下限を通る）
     ふつう（2.0点）… 3件（下限は通らないが、下げれば通る 1.25点以上）
     おそい（0.7点）… 1件（下げても通らない） */
const mk=(n,jan,down,price)=>Object.assign({},base,{ jan:jan,
  mw_name:n, amz_name:n, asin:'B00AAA'+jan.slice(-4), wholesale:2000,
  price:price, mv7_down:down });
const ROWS=[
  mk('速いゲーム1','4902370550001',21,6000),
  mk('速いゲーム2','4902370550002',21,6100),
  mk('速いゲーム3','4902370550003',21,6200),
  mk('速いゲーム4','4902370550004',21,6300),
  mk('ふつうゲーム1','4902370550005',14,6400),
  mk('ふつうゲーム2','4902370550006',14,6500),
  mk('ふつうゲーム3','4902370550007',14,6600),
  mk('おそいゲーム','4902370550008',5,6700)];
const META={ ok:true, n:ROWS.length, rows:ROWS, seen:8, priced:8, left:0,
  per_run:120, ttl_days:3, limit:3000 };

await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwSubShip').value='0';
  $('csvMwAmzWin').checked=false;
  if($('csvMwAmzFbaNg'))$('csvMwAmzFbaNg').checked=false;
  if($('csvMwAmzRstOk'))$('csvMwAmzRstOk').checked=false;
  $('subChMonitor').value='123456789012345678';
  $('subOnMonitor').checked=true;
  window.__mon={ ok:true, sent:[], ch:'123456789012345678', n:0, new_n:5,
                 limit_days:7, people:5 };
  window.__monFail=false;
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), o=i||{};
    if(/\/whoami/.test(url))
      return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    if(/\/sub\/mon/.test(url)){
      if(window.__monFail)return new Response('{"ok":false}',{ status:500 });
      return res(window.__mon);
    }
    if(/\/mw\/sub/.test(url))
      return res({ ok:true, table_ok:true, n:0, rows:[] });
    if(/\/mw\/buy/.test(url))return res({ ok:true, rows:[], n:0 });
    if(/\/mw\/amz/.test(url))return res(META);
    return real(u,i);
  };
  switchTab('F'); syncRole='admin'; roleApply();
},META);
await openCsvBoxes(p);
await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
await p.waitForTimeout(500);
const draft=()=>p.evaluate(async()=>{
  await subDraftGo();
  await new Promise((x)=>setTimeout(x,200));
  const m=(subDraftData.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
  return { note:($('subDraftNote').textContent||'').replace(/\s+/g,' '),
           box:($('subDraftBox').textContent||'').replace(/\s+/g,' '),
           mon:m.mon||{}, jans:(m.items||[]).map((x)=>x.jan),
           low:(m.items||[]).filter((x)=>x.mon_low).map((x)=>x.jan) };
});

console.log('=== ① ⚙の欄と既定 ===');
{
  const t=await p.evaluate(()=>({
    newN:($('subMonNew')||{}).value, people:($('subMonPeople')||{}).value,
    days:($('subMonDays')||{}).value,
    limit:($('subMonLimitDays')||{}).value,
    min:($('subMonSpeedMin')||{}).value, short:($('subMonShort')||{}).value,
    note:($('subMonNote')||{}).checked,
    opt:SUBPLAN.pickOpt(subPickCfg()),
    speed:SUBPLAN.monSpeed(SUBPLAN.pickOpt(subPickCfg()),false) }));
  console.log('   '+JSON.stringify(t));
  ok(t.newN==='5'&&t.people==='5'&&t.days==='2'&&t.limit==='7',
     '★★★既定は 新しく5件・人数5・2日ぶん・期限7日');
  ok(t.min===''&&t.short==='50',
     '★★速さの下限は空（自動）・足りないときは 50% 下げる');
  ok(t.note===true,'★★既定で「今週の配信」を1通出す');
  ok(t.opt.monNew===5&&t.opt.monPeople===5&&t.opt.monDays===2
     &&t.opt.monLimitDays===7,'★★⚙を1か所で読む（pickOpt）');
  ok(t.speed===2.5,'★★★速さの下限は 人数5 ÷ 2日 ＝ 1日 2.5点');
}

console.log('\n=== ② 1週目：速い順に新しく5件（足りない分は下限を下げる）===');
{
  const t=await draft();
  console.log('   '+t.note.slice(0,400));
  console.log('   '+JSON.stringify({ jans:t.jans, low:t.low,
    okN:t.mon.okN, min:t.mon.min, min2:t.mon.min2, first:t.mon.first }));
  ok(t.mon.first===true,'★★★前の週の控えが空なら1週目');
  ok(/モニター/.test(t.note)&&/1週目：速い順/.test(t.note),
     '★★★案のまとめに「1週目：速い順」と出す');
  ok(t.jans.length===5,'★★★新しく出すのは⚙の 5件');
  ok(t.jans.slice(0,4).join(',')==='4902370550001,4902370550002,'
     +'4902370550003,4902370550004','★★★1週目は速い順（速い4件が先）');
  ok(t.mon.okN===4&&t.mon.min===2.5,
     '★★★下限（2.5点/日）を通る候補は4件');
  ok(t.low.length===1&&t.mon.min2===1.25,
     '★★★足りない1件は下限を 1.25点/日 まで下げて埋める');
  ok(t.jans.indexOf('4902370550008')<0,
     '★★★下げても通らない品（0.7点/日）は入らない');
  ok(/新しく 5件/.test(t.note)&&/候補 4件/.test(t.note)
     &&/速さ 2.5点\/日 以上/.test(t.note),
     '★★★新しく出す件数・候補の件数・下限を出す');
  ok(/下限を 1.25点\/日 まで下げて 1件を埋めました/.test(t.note),
     '★★★下限を下げたことを出す');
  ok(/下限を下げて入れました/.test(t.box),
     '★★★下げて入れた品には一覧で印を付ける');
  ok(/前の週までに出した 0件は選びません/.test(t.note),
     '★★控えを読めたことを出す');
}

console.log('\n=== ③ 候補の分布（線引きを決めるため）===');
{
  const t=await p.evaluate(()=>{
    const rows=subDraftRows();
    return { html:subStatHtml(rows).replace(/<[^>]*>/g,''),
             st:SUBPLAN.statsOf(rows,SUBPLAN.pickOpt(subPickCfg())) };
  });
  console.log('   '+t.html);
  ok(/いまの候補 8件の分布/.test(t.html),'★★★候補の件数');
  ok(/下位25%／中央／上位25%/.test(t.html),'★★★下位25%・中央・上位25%');
  ok(/粗利 ¥/.test(t.html)&&/売れる速さ /.test(t.html)
     &&/粗利×速さ /.test(t.html),
     '★★★粗利・売れる速さ・粗利×速さ の3つを出す');
  ok(/点\/日/.test(t.html)&&/円\/日/.test(t.html),'★★単位（点/日・円/日）');
  ok(t.st.speed.q1===2&&t.st.speed.med===3&&t.st.speed.q3===3,
     '★★★速さの分布（下位2.0点／中央3.0点／上位3.0点）');
  ok(/モニターの条件に合う品：4件/.test(t.html),
     '★★★モニターの条件に合う件数');
  ok(/下限を下げれば 7件/.test(t.html),'★★★下限を下げたときの件数');
}

console.log('\n=== ③-2 速さの内訳と、下限を変えたときの件数（8.44）===');
{
  const t=await p.evaluate(()=>{
    const rows=subDraftRows();
    return { html:subSpdHtml(rows).replace(/<[^>]*>/g,''),
             mix:SUBPLAN.speedMix(rows,SUBPLAN.pickOpt(subPickCfg())),
             ok:rows.map((x)=>x.speed_ok) };
  });
  console.log('   '+t.html);
  ok(t.ok.every((x)=>x===true),
     '★★★案の行に「速さが取れたか」の印を付ける（mwstat の speedSrc）');
  ok(/売れる速さの内訳/.test(t.html),'★★★内訳を出す');
  ok(/データなし 0件/.test(t.html)&&/MW の在庫の減りが取れていません/
     .test(t.html),
     '★★★「データなし」を別に出す（本当に0と同じに数えない）');
  ok(/本当に0（減っていない） 0件/.test(t.html),'★★★「本当に0」も別に出す');
  ok(/0より大きい 8件/.test(t.html),'★★★0より大きい品の件数');
  ok(/0.1未満 0件/.test(t.html)&&/1〜2.5 3件/.test(t.html)
     &&/2.5以上 4件/.test(t.html),
     '★★★0より大きい品の帯（0.1未満／0.1〜0.5／0.5〜1／1〜2.5／2.5以上）');
  ok(/下限を変えたときのモニターの候補/.test(t.html),
     '★★★下限を変えたときの件数（試算）を出す');
  ok(/いま 2.5点\/日 … 4件/.test(t.html),
     '★★★いまの下限の件数（通常版ゲーム）');
  ok(/0.3点\/日/.test(t.html)&&/クリックポストで送れる品まで広げた場合/
     .test(t.html),
     '★★★1／0.5／0.3 点/日 と「広げた場合」も並べる');
  ok(t.mix.none===0&&t.mix.pos===8,'★★内訳は shared/subplan.js で数える');
}

console.log('\n=== ③-3 モニターの開始日（8.44）===');
{
  const t=await p.evaluate(async()=>{
    const el=$('subMonFrom');
    const was=(el||{}).value;
    const vals={ has:!!el, type:(el||{}).type, dflt:was,
                 opt0:SUBPLAN.pickOpt(subPickCfg()).monFrom };
    window.__mon={ ok:true, n:2, ch:'123456789012345678', new_n:5,
      limit_days:7, people:5, from:'2026-11-16',
      sent:['4902370550001','4902370550002'] };
    el.value='2026-11-16';
    vals.opt=SUBPLAN.pickOpt(subPickCfg()).monFrom;
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    vals.note=($('subDraftNote').textContent||'').replace(/\s+/g,' ');
    el.value=was;
    window.__mon={ ok:true, sent:[], ch:'123456789012345678', n:0, new_n:5,
                   limit_days:7, people:5 };
    return vals;
  });
  console.log('   '+(t.note||'').slice(0,240));
  ok(t.has&&t.type==='date'&&t.dflt==='',
     '★★★⚙に「モニターの開始日」がある（既定は空＝今までどおり）');
  ok(t.opt0===''&&t.opt==='2026-11-16','★★⚙を1か所で読む（pickOpt）');
  ok(/開始日 2026-11-16 から数えています/.test(t.note),
     '★★★案のまとめに開始日を出す');
  ok(/それより前のテスト配信は数えません/.test(t.note),
     '★★★テスト配信を数えないことも書く');
}

console.log('\n=== ④ ⚙で下限・件数を変えられる ===');
{
  const t=await p.evaluate(async()=>{
    $('subMonShort').value='0';
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    const m=(subDraftData.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
    $('subMonShort').value='50';
    return { note:($('subDraftNote').textContent||'').replace(/\s+/g,' '),
             n:(m.items||[]).length, short:(m.mon||{}).short };
  });
  console.log('   '+JSON.stringify({ n:t.n, short:t.short }));
  ok(t.n===4&&t.short===1,
     '★★★下げる割合 0% なら下げない（そのまま少なく出す）');
  ok(/1件たりません（そのまま少なく出します）/.test(t.note),
     '★★★足りないことを出す');
  const t2=await p.evaluate(async()=>{
    $('subMonNew').value='2';
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    const m=(subDraftData.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
    $('subMonNew').value='5';
    return { n:(m.items||[]).length, jans:(m.items||[]).map((x)=>x.jan) };
  });
  ok(t2.n===2,'★★★⚙の件数（2件）だけ出す');
  const t3=await p.evaluate(async()=>{
    $('subMonSpeedMin').value='1';
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    const m=(subDraftData.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
    $('subMonSpeedMin').value='';
    return { min:(m.mon||{}).min, okN:(m.mon||{}).okN,
             note:($('subDraftNote').textContent||'').replace(/\s+/g,' ') };
  });
  ok(t3.min===1&&t3.okN===7,'★★★⚙で速さの下限を直に決められる（1点/日）');
  ok(/速さ 1点\/日 以上/.test(t3.note),'★★下限を画面にも出す');
}

console.log('\n=== ⑤ 2週目から：前の週に出した品は選ばない ===');
{
  const t=await p.evaluate(async()=>{
    window.__mon={ ok:true, n:4, ch:'123456789012345678', new_n:5,
      limit_days:7, people:5,
      sent:['4902370550001','4902370550002','4902370550003',
            '4902370550004'] };
    $('subMonSpeedMin').value='1';
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    const m=(subDraftData.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
    return { note:($('subDraftNote').textContent||'').replace(/\s+/g,' '),
             jans:(m.items||[]).map((x)=>x.jan), first:(m.mon||{}).first };
  });
  console.log('   '+JSON.stringify(t.jans));
  ok(t.first===false,'★★★控えがあれば2週目から');
  ok(/2週目から：候補からランダム/.test(t.note),
     '★★★「候補からランダム」と出す');
  ok(t.jans.indexOf('4902370550001')<0&&t.jans.indexOf('4902370550004')<0,
     '★★★前の週までに出した品は選ばない');
  ok(/前の週までに出した 4件は選びません/.test(t.note),
     '★★★何件を外したか出す');
  /* 同じ週のあいだは、押し直しても同じ品・同じ順。 */
  const t2=await p.evaluate(async()=>{
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    const m=(subDraftData.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
    $('subMonSpeedMin').value='';
    return (m.items||[]).map((x)=>x.jan);
  });
  ok(t2.join(',')===t.jans.join(','),'★★★同じ週なら押し直しても同じ');
}

console.log('\n=== ⑥ 控えが読めないときは断りを出す（案は作れる）===');
{
  const t=await p.evaluate(async()=>{
    window.__monFail=true;
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,300));
    const m=(subDraftData.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
    window.__monFail=false;
    return { note:($('subDraftNote').textContent||'').replace(/\s+/g,' '),
             n:(m.items||[]).length };
  });
  console.log('   '+t.note.slice(0,260));
  ok(t.n>0,'★★★控えが読めなくても案は作れる');
  ok(/控えが読めませんでした/.test(t.note),'★★★読めなかったことを出す');
  ok(/同じ品が選ばれるかもしれません/.test(t.note),'★★★何が起きるかも書く');
}
await T.done();
})();
