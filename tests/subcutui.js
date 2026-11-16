/* 画面：足切りの試算（8.48・カジの②・簡単な版）

   ・⚙「新しい足切り：利益率／粗利」（既定 15%・¥700・**数えるだけ**）
   ・案のまとめに「いまの決まりで◯件／新しい足切りなら◯件（減る・増える）」
   ・外れる理由の内訳（率だけ／粗利だけ／どちらも／手数料が無い）
   ・新しい足切りで通した品のプランごとの件数
   ・ライトに入る「早い」の線（3か月10／20／30個）の件数
   ・**判定も配信も変わらない**（いまの決まりのまま案が出る）
   ・率の表記（売上に対して／仕入れ値に対して）が画面で分かること */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：足切りの試算（8.48）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const AT='2026-11-16T01:00:00Z';
const base={ sha:'いろは商会', kishu:'NS', cond:'新品', list_price:7678,
  stock:20, note:'', ship_text:'即日', ship_days:0, new_n:3, amz:0,
  basis:'カート', rst:'ok', fee_total:250, fee_ref:150, fee_fba:50,
  fee_tax:50, fee_fba_ship:50, fee_fba_store:16, size_tier:'s', size_g:110,
  fee_base:5000, pics_ok:1, pics_n:1, buy_qty:0,
  price_at:AT, amz_at:AT, fee_at:AT, rank:9000, rank_cat:'ゲーム',
  mv_first:'2026-08-01T00:00:00Z', mv_last:'2026-11-15T00:00:00Z',
  mv_down:0, mv_down_n:0, mv_up:0, mv_up_n:0, mv_gone_n:0, mv_back_n:0,
  mv_back_qty:0, mv_gone_days:0, mv7_down:0, mv7_n:0, mv_wipe_n:0, mv_wipe:0 };
/* 会員が払う額は「卸値＋上乗せ」で決まるので、卸値で価格帯を作る。 */
const mk=(n,jan,o)=>Object.assign({},base,{ jan:jan, mw_name:n, amz_name:n,
  asin:'B00AAA'+jan.slice(-4) },o||{});
const ROWS=[
  /* 粗利が大きく率も高い（どちらの決まりでも通る） */
  mk('よい品','4902370550001',{ wholesale:2000, price:6000 }),
  /* 粗利¥1,000くらい・率は低い（いま通って・新しいで外れる） */
  mk('高いけど率が低い品','4902370550002',{ wholesale:9000, price:12000 }),
  /* 粗利が小さい（どちらでも外れる） */
  mk('薄い品','4902370550003',{ wholesale:2000, price:3200 }),
  /* 順位が良い（3か月30個以上＝早い） */
  mk('よく売れる品','4902370550004',{ wholesale:2000, price:6000,
    rank:900 }),
  /* 3か月11個（ふつう） */
  mk('ふつうに売れる品','4902370550005',{ wholesale:2000, price:6000,
    rank:9000 }),
  /* 手数料が取れていない */
  mk('手数料なしの品','4902370550006',{ wholesale:2000, price:6000,
    fee_total:0, fee_ref:0, fee_tax:0, fee_at:'' })];
const META={ ok:true, n:ROWS.length, rows:ROWS, seen:6, priced:6, left:0,
  per_run:120, ttl_days:3, limit:3000 };

await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwSubShip').value='0';
  $('csvMwAmzWin').checked=false;
  if($('csvMwAmzFbaNg'))$('csvMwAmzFbaNg').checked=false;
  if($('csvMwAmzRstOk'))$('csvMwAmzRstOk').checked=false;
  $('subChMonitor').value='123456789012345678';
  $('subOnMonitor').checked=true; $('subOnLight').checked=true;
  $('subChLight').value='223456789012345678';
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

console.log('=== ① ⚙の欄と既定（数えるだけ）===');
{
  const t=await p.evaluate(()=>({
    rate:($('subCutRate')||{}).value, gross:($('subCutGross')||{}).value,
    cfg:[subPickCfg().subCutRate,subPickCfg().subCutGross],
    note:document.body.innerHTML.indexOf('いまは「数えるだけ」です')>=0 }));
  console.log('   '+JSON.stringify(t));
  ok(t.rate==='15'&&t.gross==='700',
     '★★★既定は 率15%・粗利¥700（会員が払う額に対する率）');
  ok(t.cfg[0]==='15'&&t.cfg[1]==='700','★★⚙を1か所で読む');
  ok(t.note===true,
     '★★★「いまは数えるだけです（判定は変わりません）」と書いてある');
}

console.log('\n=== ② 率の表記（どちらの率か分かる）===');
{
  const t=await p.evaluate(()=>{
    const lab=[].slice.call(document.querySelectorAll('label'))
      .map((x)=>x.textContent);
    return { sale:lab.filter((x)=>/利益率（売上に対して）/.test(x)).length,
             body:document.body.innerHTML
               .indexOf('会員の利益率（仕入れ値に対して）')>=0 };
  });
  ok(t.sale>0,'★★★仕入れタブの絞り込みは「利益率（売上に対して）」');
  ok(t.body===true,
     '★★★会員の率は「会員の利益率（仕入れ値に対して）」と書く');
}

console.log('\n=== ③ 案の行に新しい足切りの結果が付く ===');
{
  const t=await p.evaluate(()=>subDraftRows().map((x)=>({ jan:x.jan,
    fit:x.fit, cut:x.cut, why:x.cut_why, g:x.gross, r:x.rate })));
  console.log('   '+JSON.stringify(t));
  const by={}; t.forEach((x)=>{ by[x.jan]=x; });
  ok(by['4902370550001'].cut===true,'★★★率も粗利も足りる品は通る');
  ok(by['4902370550003'].cut===false&&by['4902370550003'].why!=='',
     '★★★薄い品は外れ、理由も付く');
  ok(t.every((x)=>x.cut!==undefined&&x.why!==undefined),
     '★★行ごとに結果と理由を持つ');
}

console.log('\n=== ④ まとめに試算が出る（判定は変わらない）===');
{
  const t=await p.evaluate(async()=>{
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    return { note:($('subDraftNote').textContent||'').replace(/\s+/g,' '),
             rows:subDraftRows().filter((x)=>x.fit).length,
             data:(subDraftData.plans||[]).map((x)=>x.key+':'
               +x.items.length).join(' ') };
  });
  console.log('   '+t.note.slice(t.note.indexOf('足切りの試算')));
  console.log('   いまの案 '+t.data);
  ok(/足切りの試算/.test(t.note)&&/判定はまだ変えていません/.test(t.note),
     '★★★「判定はまだ変えていません」と出す');
  ok(/いまの決まりで会員向き \d+件/.test(t.note),
     '★★★いまの決まりの件数');
  ok(/新しい足切り（率 15% かつ 粗利 ¥700）… \d+件/.test(t.note),
     '★★★新しい足切りの件数（⚙の数字も出す）');
  ok(/減る \d+件/.test(t.note)&&/増える \d+件/.test(t.note),
     '★★★減る件数と増える件数を出す');
  ok(/率だけ足りない \d+件/.test(t.note)
     &&/粗利だけ足りない \d+件/.test(t.note)
     &&/どちらも \d+件/.test(t.note)
     &&/手数料が取れていない \d+件/.test(t.note),
     '★★★外れる理由の内訳');
  ok(/振り分け：モニター \d+件/.test(t.note)&&/ライト \d+件/.test(t.note),
     '★★★新しい足切りで通した品のプランごとの件数');
  ok(/3か月10個以上 \d+件/.test(t.note)&&/3か月20個以上 \d+件/.test(t.note)
     &&/3か月30個以上 \d+件/.test(t.note),
     '★★★ライトに入る「早い」の線を 10／20／30個 で並べる');
}

console.log('\n=== ⑤ ⚙を変えると試算だけが変わる ===');
{
  const t=await p.evaluate(async()=>{
    const was=subDraftRows().filter((x)=>x.cut).length;
    const fit0=subDraftRows().filter((x)=>x.fit).length;
    /* 粗利 ¥3,350〜3,410・率 140% ほどの品なので、
       粗利の下限を ¥3,400 にすれば1件だけが通る。 */
    $('subCutRate').value='40'; $('subCutGross').value='3400';
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    const now=subDraftRows().filter((x)=>x.cut).length;
    const fit1=subDraftRows().filter((x)=>x.fit).length;
    const note=($('subDraftNote').textContent||'').replace(/\s+/g,' ');
    $('subCutRate').value='15'; $('subCutGross').value='700';
    return { was:was, now:now, fit0:fit0, fit1:fit1, note:note };
  });
  console.log('   '+JSON.stringify({ was:t.was, now:t.now, fit0:t.fit0,
    fit1:t.fit1 }));
  ok(t.now<t.was,'★★★⚙を厳しくすると試算の件数が減る');
  ok(t.fit0===t.fit1,
     '★★★⚙を変えても**いまの判定（会員向き）は変わらない**');
  ok(/率 40% かつ 粗利 ¥3,400/.test(t.note),'★★⚙の数字が試算に出る');
}
console.log('\n=== ⑥ 売り方ごとの手残りの試算（8.50）===');
{
  const t=await p.evaluate(()=>({
    way:($('subCutWay')||{}).value, net:($('subCutNet')||{}).value,
    pct:[($('gdPctMercari')||{}).value,($('gdPctYahoo')||{}).value],
    rows:subDraftRows().map((x)=>({ jan:x.jan, fba:x.net_fba,
      self:x.net_self, mer:x.net_mer, cut:x.net_cut, way:x.cut_way,
      unsure:x.net_unsure })),
    note:($('subDraftNote').textContent||'').replace(/\s+/g,' ') }));
  console.log('   '+JSON.stringify(t.rows.slice(0,3)));
  console.log('   '+t.note.slice(t.note.indexOf('売り方ごとの手残り'),
    t.note.indexOf('足切りの試算')));
  ok(t.way==='mercari'&&t.net==='400',
     '★★★既定は メルカリ・手残り 400円以上（カジの数字）');
  ok(t.pct[0]==='90'&&t.pct[1]==='90',
     '★★★メルカリ・ヤフオクの売値は Amazon の 90%（⚙）');
  ok(t.rows.every((x)=>x.way==='mercari'),
     '★★案の行に「どの売り方で見たか」が入る');
  ok(t.rows.some((x)=>x.mer!==null&&x.mer!==undefined),
     '★★★案の行にメルカリの手残りが入る');
  ok(t.rows.some((x)=>x.fba!==null)&&t.rows.some((x)=>x.self!==null),
     '★★★Amazon FBA・自己配送の手残りも入る');
  ok(t.rows.filter((x)=>x.mer!==null&&x.self!==null)
     .every((x)=>x.self>=x.mer||x.mer>x.fba),
     '★手残りは売り方で変わる（メルカリは売値が9割・FBA は配送代行がある）');
  ok(/売り方ごとの手残りの試算/.test(t.note)
     &&/メルカリの売値＝Amazon の 90%/.test(t.note),
     '★★★試算に「メルカリの売値＝Amazon の 90%」と書く');
  ok(/手残り 300円以上/.test(t.note)&&/手残り 400円以上（いま⚙）/.test(t.note)
     &&/手残り 500円以上/.test(t.note),
     '★★★手残りの下限 300／400／500円 で並べる');
  ok(/Amazon FBA \d+件/.test(t.note)&&/Amazon 自己配送 \d+件/.test(t.note)
     &&/メルカリ \d+件/.test(t.note),
     '★★★売り方ごと（FBA・自己配送・メルカリ）の件数');
  ok(/いまの⚙（メルカリ・手残り ¥400以上）… \d+件/.test(t.note),
     '★★★いまの⚙での件数も出す');
  ok(/③の種類の既定の送料を引いたあと/.test(t.note)
     &&/かっこの中は引かない場合/.test(t.note),
     '★★★既定の送料を引いた件数と引かない件数の両方を出す（8.51）');
  ok(/送り方の区分が分からない品 \d+件は外しません/.test(t.note),
     '★★★送り方が分からない品は外さないと書く');
}

console.log('\n=== ⑦ ⚙を変えると試算だけが変わる（手残り）===');
{
  const t=await p.evaluate(async()=>{
    const fit0=subDraftRows().filter((x)=>x.fit).length;
    $('subCutWay').value='amz_fba'; $('subCutNet').value='300';
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    const note=($('subDraftNote').textContent||'').replace(/\s+/g,' ');
    const way=subDraftRows()[0].cut_way;
    const fit1=subDraftRows().filter((x)=>x.fit).length;
    $('subCutWay').value='mercari'; $('subCutNet').value='400';
    return { note:note, way:way, fit0:fit0, fit1:fit1 };
  });
  ok(t.way==='amz_fba','★★★⚙で見る売り方を変えられる');
  ok(/いまの⚙（Amazon FBA・手残り ¥300以上）/.test(t.note),
     '★★★試算の文も変わる');
  ok(t.fit0===t.fit1,
     '★★★⚙を変えても**いまの判定（会員向き）は変わらない**');
}
await T.done();
})();
