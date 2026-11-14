/* 画面：商品ごとの送料の区分（8.27・カジの依頼3・2）
   ① ⚙（会員便の段・薄物とみなす機種・箱ものの下限）を読む
   ② 「今日の配信の案」に送り方の札とカードの文を出す
   ③ 「今日の配信の予定」にも出す（pj-sync が同じ判定で返したもの）
   ④ 仕入れの行で送り方を手で選び直せる（pj-sync に送る） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：商品ごとの送料の区分（8.27）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__q=[];
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body;
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/mw\/sub/.test(url)&&(i||{}).method==='POST'){
      window.__q.push({ u:'subpost', b:JSON.parse(String(b||'{}')) });
      return res({ ok:true, n:1, rows:[] }); }
    if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, n:0, rows:[] });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
});
await openCsvBoxes(p);

console.log('=== ① ⚙ を読む ===');
{
  const t=await p.evaluate(()=>{
    $('mwSubTiers').value='250:250／0:900';
    $('mwSubThinKishu').value='GF';
    $('mwSubBoxMin').value='700';
    const o=mwShipOpt();
    return { tiers:o.tiers, thin:o.thinKishu, min:mwShipBoxMin(),
             gf:PJ_SHOPCSV.shipWay({ kishu:'GF' },o).key,
             line:PJ_SHOPCSV.shipLine({ kishu:'GF' },
               Object.assign({},o,{ grams:100 })) };
  });
  ok(t.tiers.length===2&&t.tiers[0].yen===250&&t.tiers[1].yen===900,
     '★★★⚙の「会員便の段」を読む');
  ok(t.min===700,'★★⚙の「箱ものの送料の下限」を読む');
  ok(t.gf==='cp','★★★⚙で足した機種が薄物になる');
  ok(/¥250/.test(t.line)&&!/¥200/.test(t.line),
     '★★★カードの金額が⚙の段から出る');
  await p.evaluate(()=>{ $('mwSubTiers').value=''; $('mwSubThinKishu').value='';
                         $('mwSubBoxMin').value='600'; });
}

console.log('=== ② 案に送り方を出す ===');
{
  const t=await p.evaluate(()=>{
    const mk=(o)=>Object.assign({ jan:'', name:'', price:3000, qty:2,
      gross:800, rate:30, speed:1, stock:9, sale:false },o);
    subDraftData={ at:'2026-11-14T00:00:00Z', rows:3,
      opt:{ stockPct:30, qtyDays:2, wantQty:5 }, plans:[
      { key:'premium', name:'プレミアム', on:true, ch:'444', over:0, items:[
        mk({ jan:'4902370550001', name:'ふつうのゲーム',
             ship:'クリックポスト', ship_sure:true,
             ship_text:'クリックポスト（1〜2本 ¥200／3本 ¥300／4本以上 ¥600）',
             ship_warn:'' }),
        mk({ jan:'4535506307842', name:'S.H.Figuarts ◯◯',
             ship:'レターパックプラス', ship_sure:true,
             ship_text:'レターパックプラス（1点 ¥300／2点以上 ¥600）',
             ship_warn:'送料が足りません（会員便の段 ¥300／レターパックプラス）' }),
        mk({ jan:'4535506307843', name:'採寸がない商品',
             ship:'', ship_sure:false,
             ship_text:'送料はお会計で表示（会員便・重さで計算）',
             ship_warn:'' })] }] };
    subTabSet('all');
    $('subDraftBox').innerHTML=subDraftHtml(subDraftData.plans);
    return ($('subDraftBox').textContent||'').replace(/\s+/g,' ');
  });
  console.log('   '+t.slice(0,260));
  ok(/クリックポスト/.test(t),'★★★ゲームの行に区分が出る');
  ok(/レターパックプラス/.test(t),'★★★箱ものの行に区分が出る');
  ok(/送り方 未確認/.test(t),'★★★採寸が無い行は「送り方 未確認」');
  ok(/送料が足りません/.test(t),
     '★★★会員便の段が足りないときは案で知らせる');
  ok(/送料 送料はお会計で表示/.test(t),
     '★★カードに出る送料の文もそのまま出す');
}

console.log('=== ③ 予定にも出す ===');
{
  const t=await p.evaluate(()=>{
    subPlanData={ ok:true, table_ok:true, token:true, day:'2026-11-14',
      skip:false, on:true, hour:8, pre:true, domain:'x.myshopify.com', rows:2,
      plans:[{ key:'premium', name:'プレミアム', on:true, ch:'444', n:100,
        q:5, kinds:'all', add:2, edit:0, keep:0, why:'', items:[
        { jan:'4902370550001', name:'ふつうのゲーム', price:3000, qty:1,
          left:1, gross:800, sent:false, same:false,
          ship:'クリックポスト', ship_sure:true,
          ship_text:'クリックポスト（1〜2本 ¥200）', ship_warn:'' },
        { jan:'4535506307842', name:'S.H.Figuarts ◯◯', price:9000, qty:2,
          left:2, gross:1800, sent:false, same:false,
          ship:'宅配便（60サイズ）', ship_sure:true,
          ship_text:'宅配便（60サイズ）（1点以上 ¥600）',
          ship_warn:'' }] }] };
    subTabSet('all'); subPlanRender();
    return ($('subPlanList').textContent||'').replace(/\s+/g,' ');
  });
  console.log('   '+t.slice(0,220));
  ok(/クリックポスト/.test(t)&&/宅配便（60サイズ）/.test(t),
     '★★★予定の行にも送り方が出る');
  ok(/送料 宅配便（60サイズ）（1点以上/.test(t),
     '★★カードに出る文を予定でも見られる');
}

console.log('=== ④ 一覧で手で選び直す ===');
{
  const t=await p.evaluate(()=>{
    mwSubTableOk=true;
    const r={ jan:'4535506307842', kishu:'figure', size_g:350,
              size_long:18, size_wid:11, size_hei:7 };
    mwAmzRows=[r];
    const box=document.createElement('div');
    box.innerHTML=mwSubWayLine(r);
    document.body.appendChild(box);
    return { html:box.innerHTML,
             txt:(box.textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+t.txt.slice(0,200));
  ok(/レターパックプラス/.test(t.txt),'★★★一覧の行に区分が出る');
  ok(/採寸から（18×11×7cm・350g）/.test(t.txt),
     '★★★どこで決めたかを出す（採寸）');
  ok(/mwSubWay_4535506307842/.test(t.html),'★手で選ぶ欄がある');
  ok(/自動（採寸・機種から）/.test(t.txt)&&/宅急便コンパクト/.test(t.txt),
     '★★選べる区分がぜんぶ出る');
  const q=await p.evaluate(async()=>{
    window.__q=[];
    $('mwSubWay_4535506307842').value='compact';
    await mwSubWayChange('4535506307842');
    return { b:(window.__q.filter((x)=>x.u==='subpost')[0]||{}).b,
             txt:($('mwSubWayBox_4535506307842').textContent||'')
                   .replace(/\s+/g,' ') };
  });
  ok(q.b&&q.b.ship_way==='compact',
     '★★★選んだ区分を pj-sync に送る（mw_sub.ship_way）');
  ok(/宅急便コンパクト/.test(q.txt)&&/手で選びました/.test(q.txt),
     '★★★選んだあと、その行の札だけ書き換わる');
  const q2=await p.evaluate(async()=>{
    window.__q=[];
    $('mwSubWay_4535506307842').value='';
    await mwSubWayChange('4535506307842');
    return { b:(window.__q.filter((x)=>x.u==='subpost')[0]||{}).b,
             txt:($('mwSubWayBox_4535506307842').textContent||'')
                   .replace(/\s+/g,' ') };
  });
  ok(q2.b&&q2.b.ship_way==='','★★「自動」に戻すと空で送る');
  ok(/採寸から/.test(q2.txt),'★自動に戻ると採寸の判定に戻る');
}

await T.done();
})();
