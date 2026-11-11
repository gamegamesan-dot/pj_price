/* 販売連携：選んだ行をまとめて直す（6.177・【Z】）
   ① 「取り直してから直す」が既定のボタン。1・2は「▾」の中
   ② 最安値をまとめて取り直す（20件ずつ・進み具合と残り秒数を帯に出す）
   ③ 売値をまとめて直す（確認に上げ・下げ・変わらないを分けて出す）
   ④ 結果を行にその場で当て、まとめを帯に出す
   ⑤ 再調達中にする（売値を直して数量1に戻す） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('販売連携：選んだ行をまとめて直す（6.177）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], cancel=false;
p.on('dialog',async d=>{ dlg.push(d.message()); if(cancel)await d.dismiss();
                         else await d.accept(); });

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('autoRvMode').value='confirm'; $('autoMdMode').value='off'; $('pbMode').value='off';
  $('autoRkMode').value='auto'; $('syncTol').value='200';
  $('syncSkipAcc').checked=true;
  if(o.max!==undefined)$('syncPxMax').value=String(o.max);
  window.__posts=[]; window.__low=[]; window.__lowN=0;
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(x,st)=>Promise.resolve({ok:!st||st<400,status:st||200,
      text:()=>Promise.resolve(JSON.stringify(x)), json:()=>Promise.resolve(x)});
    if(/\/whoami/.test(url))return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/status/.test(url))return res({counts:{},items:[],last_runs:[]});
    if(/\/settings/.test(url))return res({ok:true,stored:true});
    if(/\/listings/.test(url))return res({accepted:0,rejected:0});
    if(/\/lowest/.test(url)){
      window.__low.push((body.items||[]).length);
      window.__lowN++;
      const lowest={};
      (body.items||[]).forEach((k)=>{
        if((o.lowFail||[]).indexOf(k.asin)>=0)return;
        lowest[k.asin+'|'+k.cond]={ low:4000, lowN:3, total:3,
          offers:[{p:4000,c:'good'},{p:4100,c:'good'},{p:4150,c:'good'}] };
      });
      return res({ ok:true, at:new Date().toISOString(), lowest:lowest });
    }
    if(/\/sync/.test(url)){
      window.__posts.push(body);
      if(body.kind==='price-many')
        return res(o.px||{ ok:true, n:(body.items||[]).length,
          done:(body.items||[]).length, skipped:0, failed:0, capped:0,
          used:(body.items||[]).length, max:30,
          rows:(body.items||[]).map((x)=>({ asin:x.asin, cond:x.cond, ok:true,
            from:100, to:90, floor:50, under:false, why:'' })) });
      if(body.kind==='restock-start')
        return res(o.rs||{ ok:true, n:(body.items||[]).length,
          done:(body.items||[]).length, skipped:0, failed:0,
          low:{ picked:1, got:1 },
          rows:(body.items||[]).map((x)=>({ asin:x.asin, cond:x.cond, ok:true,
            from:84.36, to:82.73, qty:1, why:'' })) });
      return res({ ok:true });
    }
    return real(u,i);
  };
  const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'99'+asin.slice(-4),ebay_qty:1,
    ebay_price:120,title:asin+'の商品',cost_yen:3980,weight_g:150,
    one_off:0,one_off_known:1,dropship:0,restocking:0,on_hand:0,mode:'',
    fba_available:0,fba_inbound:0,fba_reserved:0,
    fba_seen_at:new Date().toISOString(),
    mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,ebay_sale:0,
    md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,
    revise_err:null,
    rk_want:null,rk_floor:null,rk_low:null,rk_n:null,rk_max_cost:null,
    rk_want_at:null,rk_fail:0,
    pics_eps:1,pb_act:null,pb_why:null,pb_skip:0,pb_fail:0,pb_want:null,
    amazon_lowest:5000,amazon_offers:3,
    amazon_offers_json:'[{"p":5000,"c":"good"},{"p":5100,"c":"good"},'
      +'{"p":5150,"c":"good"}]',
    amazon_lowest_at:new Date().toISOString(),
    sold_usd:null,warnings:[],notes:[],state:'ok'},x||{});
  syncData={at:new Date().toISOString(),counts:{},
    items:(o.items||[
      it('B0ZB000001'),
      it('B0ZB000002',{ebay_price:40}),            // 上げ側
      it('B0ZB000003',{ebay_qty:0}),               // 数量0 → とばす
      it('B0ZB000004',{ebay_sale:1}),              // セール中 → とばす
      it('B0ZB000005',{ebay_item_id:''})           // 未出品 → とばす
    ])};
  csvList=[]; csvSaveList();
  syncPick={};
  (syncData.items||[]).forEach((r)=>{ syncPick[r.asin+'|'+r.cond]=true; });
  syncUndoList=[]; syncUndoSave(); syncUndoHide();
  switchTab('E'); roleCheck(); syncRender();
},o||{});

const bar=async()=>await p.evaluate(()=>({
  show:getComputedStyle($('syncBar')).display,
  n:($('syncBarN').textContent||'').replace(/\s+/g,' '),
  go:$('syncBarPxGo').textContent, low:$('syncBarPxLow').textContent,
  fix:$('syncBarPxFix').textContent, rs:$('syncBarRestockGo').textContent,
  menu:$('syncBarPxMenu').style.display,
  note:($('syncBarPxNote').textContent||'').replace(/\s+/g,' ')}));

console.log('=== ① 帯のボタンと件数 ===');
await setup({});
await openCsvBoxes(p);
{
  const b=await bar();
  console.log('   '+b.n);
  console.log('   '+b.go+' / '+b.low+' / '+b.fix);
  ok(b.show!=='none','★帯が出る');
  ok(/取り直してから直す（5件）/.test(b.go),
     '★★★既定のボタンは「取り直してから直す」で件数が出る');
  ok(b.menu==='none','★★★1・2は「▾」の中（最初は閉じている）');
  ok(/最安値をまとめて取り直す（5件）/.test(b.low),'★★★①のボタン');
  ok(/売値をまとめて直す（2件）/.test(b.fix),
     '★★★②のボタン（直せる2件だけ数える）');
  ok(/再調達中にする（/.test(b.rs),'★★★⑤のボタン');
  ok(/まとめて直せる 2件/.test(b.n)&&/とばす 3件/.test(b.n),
     '★★★帯に内訳を出す（押す前に分かる）');
  const m=await p.evaluate(()=>{ $('syncBarPxMore').click();
    return $('syncBarPxMenu').style.display; });
  ok(m==='block','★★「▾」で開く');
}

console.log('\n=== ② 最安値をまとめて取り直す ===');
{
  await setup({});
  await openCsvBoxes(p);
  const d=await p.evaluate(async()=>{
    pxRun('low');
    await new Promise((x)=>setTimeout(x,600));
    return { low:window.__low, posts:window.__posts.length,
             note:($('syncBarPxNote').textContent||'').replace(/\s+/g,' '),
             at:((syncData.items||[])[0]||{}).amazon_lowest };
  });
  console.log('   '+JSON.stringify(d.low)+' / '+d.note);
  ok(d.low.length===1&&d.low[0]===5,
     '★★★20件ずつ送る（5件なので1回）');
  ok(d.posts===0,'★★★「取り直す」だけでは売値を送らない');
  ok(/最安値を取り直した 5件/.test(d.note),'★★★結果を帯に出す');
  ok(d.at===4000,'★★★行の最安値をその場で新しくする');
}
{
  /* 20件を超えると分けて送り、進み具合を出す。 */
  const many=[];
  for(let i=0;i<25;i++)many.push(i);
  await p.evaluate((n)=>{
    const base=(syncData.items||[])[0];
    syncData.items=[];
    syncPick={};
    for(let i=0;i<n;i++){
      const a='B0ZC'+String(100000+i).slice(-6);
      const r=Object.assign({},base,{ asin:a, ebay_sku:'E-'+a+'-U',
        ebay_item_id:'88'+String(1000+i) });
      syncData.items.push(r);
      syncPick[a+'|used']=true;
    }
    syncRender();
  },25);
  const d=await p.evaluate(async()=>{
    window.__low=[];
    /* 帯の文は速く書き換わるので、変わるたびに控える。 */
    const seen=[];
    const el=$('syncBarPxNote');
    const mo=new MutationObserver(()=>{
      seen.push((el.textContent||'').replace(/\s+/g,' ')); });
    mo.observe(el,{ childList:true, subtree:true, characterData:true });
    pxRun('low');
    await new Promise((x)=>setTimeout(x,900));
    mo.disconnect();
    return { low:window.__low, seen:seen,
             note:(el.textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+JSON.stringify(d.low));
  console.log('   帯の文: '+JSON.stringify(d.seen.slice(0,3)));
  ok(d.low.length===2&&d.low[0]===20&&d.low[1]===5,
     '★★★20件ずつに分けて送る');
  ok(d.seen.some((t)=>/\d+\/25件/.test(t)),'★★★進み具合（n/m 件）を出す');
  ok(d.seen.some((t)=>/残り約 \d+秒/.test(t)),'★★★残り秒数も出す');
  ok(/最安値を取り直した 25件/.test(d.note),'★★終わったら結果に変わる');
}
{
  /* 取り直せなかった行は理由を残す。 */
  await setup({ lowFail:['B0ZB000001'] });
  await openCsvBoxes(p);
  const d=await p.evaluate(async()=>{
    pxRun('low');
    await new Promise((x)=>setTimeout(x,600));
    return ($('syncBarPxNote').textContent||'').replace(/\s+/g,' ');
  });
  console.log('   '+d);
  ok(/取り直せなかった 1件/.test(d),'★★★取り直せなかった件数を出す');
  ok(/B0ZB000001/.test(d)&&/出品が見つかりません/.test(d),
     '★★★行ごとの理由も出す');
}

console.log('\n=== ③ 売値をまとめて直す（確認の一覧）===');
{
  await setup({});
  await openCsvBoxes(p);
  dlg=[];
  const d=await p.evaluate(async()=>{
    pxRun('fix');
    await new Promise((x)=>setTimeout(x,600));
    return { posts:JSON.parse(JSON.stringify(window.__posts)),
             low:window.__low.length,
             note:($('syncBarPxNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   確認: '+(dlg[0]||'').replace(/\n/g,' / ').slice(0,260));
  ok(dlg.length===1,'★★★確認を出す');
  ok(/選んだ行の売値を直します（合計 2件）/.test(dlg[0]),'★★★合計の件数');
  ok(/【値上げ 1件】/.test(dlg[0])&&/【値下げ 1件】/.test(dlg[0]),
     '★★★上げ・下げを分けて出す');
  ok(/【とばす 3件】/.test(dlg[0]),'★★★とばす行も理由つきで出す');
  ok(/数量0/.test(dlg[0])&&/セール中/.test(dlg[0])
     &&/出品していません/.test(dlg[0]),'★★★とばす理由を書く');
  ok(/→ \$/.test(dlg[0]),'★★★いくら → いくら を出す');
  ok(/最低売値より下げません/.test(dlg[0]),'★★下限を守ると書く');
  ok(/1日の上限（80件）/.test(dlg[0]),'★★★上限のことも書く（既定80件）');
  ok(d.low===0,'★★★「売値だけ」では最安値を取り直さない');
  ok(d.posts.length===1&&d.posts[0].kind==='price-many','★★★kind:price-many');
  ok((d.posts[0].items||[]).length===2,'★★★直せる2件だけ送る');
  ok(d.posts[0].max===80,'★★⚙の上限も送る（既定80件）');
  ok(d.posts[0].items.every((x)=>x.asin&&x.cond&&x.price===undefined),
     '★★★売値は送らない（pj-sync が計算する）');
  ok(/売値を直した 2件/.test(d.note),'★★★結果を帯に出す');
}
{
  /* 取り消したら送らない。 */
  await setup({});
  await openCsvBoxes(p);
  cancel=true; dlg=[];
  const n=await p.evaluate(async()=>{
    pxRun('fix');
    await new Promise((x)=>setTimeout(x,600));
    return window.__posts.length;
  });
  cancel=false;
  ok(dlg.length===1&&n===0,'★★★確認で「いいえ」なら送らない');
}
{
  /* 上限で次回に回った分を出す。 */
  await setup({ px:{ ok:true, n:2, done:1, skipped:0, failed:0, capped:1,
    used:30, max:30, rows:[
      { asin:'B0ZB000001', cond:'used', ok:true, from:120, to:90 },
      { asin:'B0ZB000002', cond:'used', ok:false, capped:true,
        why:'上限のため次回（1日 30件）' }] } });
  await openCsvBoxes(p);
  dlg=[];
  const d=await p.evaluate(async()=>{
    pxRun('fix');
    await new Promise((x)=>setTimeout(x,600));
    return { note:($('syncBarPxNote').textContent||'').replace(/\s+/g,' '),
             px:((syncData.items||[]).filter((x)=>x.asin==='B0ZB000001')[0]||{})
               .ebay_price };
  });
  console.log('   '+d.note);
  ok(/上限のため次回 1件/.test(d.note),'★★★上限で次回に回った件数を出す');
  ok(/1日の上限 30件のうち 30件/.test(d.note),'★★使った件数も出す');
  ok(/上限のため次回/.test(d.note),'★★★理由も出す');
  ok(d.px===90,'★★★直せた行の売値はその場で新しくする');
}

console.log('\n=== ④ 取り直してから直す（既定のボタン）===');
{
  await setup({});
  await openCsvBoxes(p);
  dlg=[];
  const d=await p.evaluate(async()=>{
    pxRun('both');
    await new Promise((x)=>setTimeout(x,900));
    return { low:window.__low.length, posts:window.__posts.length,
             note:($('syncBarPxNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+d.note);
  ok(d.low===1,'★★★まず最安値を取り直す');
  ok(d.posts===1,'★★★そのあと売値を送る');
  ok(/最安値を取り直した/.test(d.note)&&/売値を直した/.test(d.note),
     '★★★両方の結果をまとめて出す');
  ok(dlg.length===1&&/合計/.test(dlg[0]),
     '★★★取り直したあとの推奨売値で確認する');
}

console.log('\n=== ⑤ 再調達中にする ===');
{
  await setup({ items:null });
  await openCsvBoxes(p);
  /* 再調達の候補の形（FBA で売れて数量0）にする。 */
  await p.evaluate(()=>{
    (syncData.items||[]).forEach((r)=>{ r.ebay_qty=0; r.fba_available=0; });
    syncData.items[4].ebay_item_id='';     // 未出品 → 対象外
    syncData.items[3].dropship=1;          // 無在庫 → 対象外
    syncRender();
  });
  const b=await bar();
  console.log('   '+b.rs);
  ok(/再調達中にする（3件/.test(b.rs),
     '★★★できる行だけ数える（未出品・無在庫は外す）');
  dlg=[];
  const d=await p.evaluate(async()=>{
    pxRestockStart();
    await new Promise((x)=>setTimeout(x,600));
    const r=(syncData.items||[])[0];
    return { posts:JSON.parse(JSON.stringify(window.__posts)),
             note:($('syncBarPxNote').textContent||'').replace(/\s+/g,' '),
             qty:r.ebay_qty, px:r.ebay_price, rs:r.restocking };
  });
  console.log('   確認: '+(dlg[0]||'').replace(/\n/g,' / ').slice(0,200));
  ok(dlg.length===1,'★★★確認を出す');
  ok(/<再調達中>にします/.test(dlg[0]),'★★何をするか書く');
  ok(/Amazon最安値を取り直す/.test(dlg[0])
     &&/推奨売値に直す/.test(dlg[0])&&/数量を1に戻す/.test(dlg[0]),
     '★★★1回で行う3つの手順を書く');
  ok(/下限利益は守ります/.test(dlg[0]),'★★下限を守ると書く');
  ok(d.posts.length===1&&d.posts[0].kind==='restock-start',
     '★★★kind:restock-start を送る');
  ok((d.posts[0].items||[]).length===3,'★★★できる3件だけ送る');
  ok(/再調達中にした 3件/.test(d.note),'★★★結果を帯に出す');
  ok(d.qty===1&&d.rs===1&&d.px===82.73,
     '★★★行に数量1・再調達中・新しい売値をその場で当てる');
}
{
  /* とばした行の理由を出す。 */
  await setup({ items:null, rs:{ ok:true, n:2, done:1, skipped:1, failed:0,
    rows:[{ asin:'B0ZB000001', cond:'used', ok:true, from:84, to:82 },
          { asin:'B0ZB000002', cond:'used', ok:false,
            why:'FBA に在庫があります（再調達は要りません）' }] } });
  await openCsvBoxes(p);
  await p.evaluate(()=>{
    (syncData.items||[]).forEach((r)=>{ r.ebay_qty=0; }); syncRender(); });
  dlg=[];
  const d=await p.evaluate(async()=>{
    pxRestockStart();
    await new Promise((x)=>setTimeout(x,600));
    return ($('syncBarPxNote').textContent||'').replace(/\s+/g,' ');
  });
  console.log('   '+d);
  ok(/とばした 1件/.test(d),'★★★とばした件数を出す');
  ok(/FBA に在庫があります/.test(d),'★★★その理由も出す');
}

console.log('\n=== ⑥ 作業者のキーでは動かない ===');
{
  await setup({ role:'staff' });
  await openCsvBoxes(p);
  const d=await p.evaluate(async()=>{
    pxRun('fix');
    await new Promise((x)=>setTimeout(x,400));
    pxRestockStart();
    await new Promise((x)=>setTimeout(x,400));
    return { posts:window.__posts.length, low:window.__low.length };
  });
  ok(d.posts===0&&d.low===0,'★★★作業者のキーでは1件も送らない');
}
T.done();
})();
