/* 画面：採寸が無い品の内訳と目安（8.49・カジの③）

   ・⚙（既定を当てる・出さない種類・分からない品の既定・種類を足す）
   ・案のまとめに「採寸が取れていない品 ◯件」と理由・種類・送り方の内訳
   ・「分からない」に当てた品は**案に印**（自動では出さない）
   ・⚙「出さない種類」（既定：ポスター）の品は**案に入らない**・件数を出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：採寸が無い品の内訳（8.49）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const AT='2026-11-16T01:00:00Z';
/* 採寸が無い行（size_long/wid/hei がすべて 0）。 */
const base={ sha:'いろは商会', kishu:'ホビー', cond:'新品', list_price:3000,
  stock:20, note:'', ship_text:'即日', ship_days:0, new_n:3, amz:0,
  basis:'カート', rst:'ok', fee_total:250, fee_ref:150, fee_fba:50,
  fee_tax:50, fee_fba_ship:50, fee_fba_store:16, size_tier:'s',
  size_g:0, size_cm3:0, size_long:0, size_wid:0, size_hei:0,
  fee_base:5000, pics_ok:1, pics_n:1, buy_qty:0, wholesale:800, price:3000,
  price_at:AT, amz_at:AT, fee_at:AT, checked_at:AT, rank:9000,
  rank_cat:'ホビー',
  mv_first:'2026-08-01T00:00:00Z', mv_last:'2026-11-15T00:00:00Z',
  mv_down:0, mv_down_n:0, mv_up:0, mv_up_n:0, mv_gone_n:0, mv_back_n:0,
  mv_back_qty:0, mv_gone_days:0, mv7_down:0, mv7_n:0, mv_wipe_n:0, mv_wipe:0 };
const mk=(n,jan,o)=>Object.assign({},base,{ jan:jan, mw_name:n, amz_name:n,
  asin:'B00AAA'+jan.slice(-4) },o||{});
const ROWS=[
  mk('推しの缶バッジ','4902370550001'),
  mk('初音ミク アクスタ','4902370550002'),
  mk('B2 タペストリー 描き下ろし','4902370550003'),
  mk('スリムタペストリー ◯◯','4902370550004'),
  mk('ねんどろいど ◯◯','4902370550005'),
  mk('謎のグッズ 2025','4902370550006'),
  /* 出さない種類（ポスター）→ 案に入らない */
  mk('描き下ろし ポスター 2枚','4902370550007'),
  /* 採寸がある品（内訳に入らない） */
  mk('ゲームソフト','4902370550008',{ kishu:'NS', size_long:17,
    size_wid:13, size_hei:1, size_g:110 }),
  /* まだ Amazon を調べていない品 */
  mk('まだ調べていない品','4902370550009',{ asin:'', checked_at:'',
    amz_at:'', fee_at:'', fee_total:0, fee_ref:0, fee_tax:0 }),
  /* 8.51（カジの直し5）まとめ買いは BOX の既定（宅急便コンパクト400g）。 */
  mk('推しの缶バッジ 5個セット','4902370550010')];
const META={ ok:true, n:ROWS.length, rows:ROWS, seen:9, priced:9, left:0,
  per_run:120, ttl_days:3, limit:3000 };

await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwSubShip').value='0';
  $('csvMwAmzWin').checked=false;
  if($('csvMwAmzFbaNg'))$('csvMwAmzFbaNg').checked=false;
  if($('csvMwAmzRstOk'))$('csvMwAmzRstOk').checked=false;
  $('subChMonitor').value='123456789012345678';
  $('subOnMonitor').checked=true;
  /* グッズ（ゲーム以外）なので、スタンダード（全部）も動かして案に出す。 */
  $('subOnStandard').checked=true;
  $('subChStandard').value='323456789012345678';
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u);
    if(/\/whoami/.test(url))
      return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    if(/\/sub\/mon/.test(url))return res({ ok:true, sent:[], ch:'1', n:0 });
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

console.log('=== ① ⚙の欄と既定 ===');
{
  const t=await p.evaluate(()=>({
    on:($('sgOn')||{}).checked, ng:($('sgNg')||{}).value,
    way:($('sgUnknownWay')||{}).value, g:($('sgUnknownG')||{}).value,
    table:($('sgTable')||{}).value,
    opt:SHIPGUESS.optOf(subPickCfg()) }));
  console.log('   '+JSON.stringify(t));
  ok(t.on===true,'★★★既定で「採寸が無い品に既定を当てる」');
  ok(t.ng==='ポスター',
     '★★★「出さない種類」の既定は ポスター（カジの判断）');
  ok(t.way==='box60'&&t.g==='800',
     '★★★分からない品の既定は宅配便（60）800g（大きめ）');
  ok(t.table==='','★種類を足す欄は空から');
  ok(t.opt.ng.join(',')==='ポスター'&&t.opt.unknown.g===800,
     '★★⚙を1か所で読む（shared/shipguess.js）');
}

console.log('\n=== ② 案の行に目安が付く ===');
{
  const t=await p.evaluate(()=>subDraftRows().map((x)=>({ jan:x.jan,
    ng:x.ng_kind, why:x.dim_why, kind:x.guess_kind, way:x.guess_way,
    g:x.guess_g, unk:!!x.guess_unknown })));
  console.log('   '+JSON.stringify(t));
  const by={}; t.forEach((x)=>{ by[x.jan]=x; });
  ok(by['4902370550001'].kind==='缶バッジ'
     &&by['4902370550001'].way==='クリックポスト'
     &&by['4902370550001'].g===50,'★★★缶バッジの目安が付く');
  ok(by['4902370550010'].kind==='BOX・セット'
     &&by['4902370550010'].way==='宅急便コンパクト'
     &&by['4902370550010'].g===400,
     '★★★「缶バッジ 5個セット」は BOX の既定（8.51）');
  ok(by['4902370550003'].way==='宅配便（80サイズ）'
     &&by['4902370550003'].g===700,
     '★★★タペストリーは宅配便（80）700g');
  ok(by['4902370550004'].way==='クリックポスト'
     &&by['4902370550004'].g===200,
     '★★★スリムタペストリーはクリックポスト 200g');
  ok(by['4902370550006'].unk===true,'★★★当たらない品は「分からない」');
  ok(by['4902370550007'].ng==='ポスター',
     '★★★ポスターは「出さない種類」の印が付く');
  ok(!by['4902370550008'].why&&!by['4902370550008'].kind,
     '★★★採寸がある品には目安を付けない');
  ok(by['4902370550009'].why==='none',
     '★★まだ調べていない品の理由も付く');
}

console.log('\n=== ③ 出さない種類は案に入らない ===');
{
  const t=await p.evaluate(async()=>{
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    const all=[];
    (subDraftData.plans||[]).forEach((p)=>{
      (p.items||[]).forEach((x)=>{ all.push(x.jan); }); });
    return { jans:all,
             why:SUBPLAN.whyNot({ ng_kind:'ポスター', fit:true, rst:'ok',
               price:1 },SUBPLAN.pickOpt(subPickCfg())),
             note:($('subDraftNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+t.why);
  ok(t.jans.indexOf('4902370550007')<0,
     '★★★ポスターは案に入らない（配信にも入りません）');
  ok(/出さない種類（ポスター）/.test(t.why),
     '★★★理由も「出さない種類（ポスター）」と返す');
  ok(/出さない種類で外した品 1件/.test(t.note)&&/ポスター 1件/.test(t.note),
     '★★★外した件数を案のまとめに出す');
}

console.log('\n=== ④ 内訳（理由・種類・送り方）===');
{
  /* グッズはスタンダードの案に入るので、そのタブに切り替えて見る。 */
  const t=await p.evaluate(()=>{
    subTabPick('standard');
    return { html:subDimHtml(subDraftRows()).replace(/<[^>]*>/g,''),
             box:($('subDraftBox').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+t.html);
  ok(/採寸が取れていない品 8件/.test(t.html),
     '★★★採寸が取れていない件数（ポスターと採寸がある品は除く）');
  ok(/採寸が丸ごと無い 7/.test(t.html)
     &&/まだ Amazon を調べていない 1/.test(t.html),
     '★★★理由の内訳');
  ok(/缶バッジ 1件/.test(t.html)&&/分からない 2件/.test(t.html),
     '★★★種類の内訳（商品名の言葉から）');
  ok(/既定を当てると：/.test(t.html)&&/クリックポスト 3件/.test(t.html)
     &&/宅急便コンパクト 1件/.test(t.html),
     '★★★既定を当てたときの送り方の内訳');
  ok(/「分からない」に当てた品 2件/.test(t.html)
     &&/自動では出しません/.test(t.html),
     '★★★「分からない」の件数と「自動では出しません」');
  ok(/送り方が分からない/.test(t.box),
     '★★★案の一覧にも「送り方が分からない」の印が出る');
  ok(/缶バッジの目安/.test(t.box),'★★当てた種類も一覧に出す');
}

console.log('\n=== ⑤ ⚙を変えると内訳も変わる ===');
{
  const t=await p.evaluate(async()=>{
    $('sgTable').value='謎のグッズ=クリックポスト,90';
    /* ⚙を変えたら案の行を作り直す（行が目安を持つ）。 */
    const a=SHIPGUESS.sumPicked(subDraftRows());
    $('sgNg').value='';
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    const all=[];
    (subDraftData.plans||[]).forEach((p)=>{
      (p.items||[]).forEach((x)=>{ all.push(x.jan); }); });
    $('sgTable').value=''; $('sgNg').value='ポスター';
    return { unknown:a.unknown, kinds:a.kinds['謎のグッズ']||0,
             hasPoster:all.indexOf('4902370550007')>=0 };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.kinds===1&&t.unknown===1,
     '★★★⚙で種類を足すと「分からない」が減る');
  ok(t.hasPoster===true,
     '★★★⚙「出さない種類」を空にすればポスターも案に入る');
}
await T.done();
})();
