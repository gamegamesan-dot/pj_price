/* 画面：前の①と比べる・絞り込みと母数の表示（8.55・カジの依頼A／D）

   カジの報告（11/17）「一覧を取り直したら候補が 148件 → 59件 に減った。
   行ごとに『前は通っていて今は外れた品』を見せてほしい」。

   A … ①を押したときの行ごとの数字を**2回分だけ**この端末に控えて、
       「前は通っていて今は外れた品」と、何の数字が前→後で変わったかを出す
       （CSV では出さない）
   D … 案の「効いている絞り込み」に**ランキング上限**も出す／
       足切りの内訳に「**見た品 ◯件**」（候補との差）を出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：前の①と比べる（8.55）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const AT='2026-11-17T01:00:00Z';
const base={ sha:'いろは商会', kishu:'NS', cond:'新品', list_price:7678,
  stock:20, note:'', ship_text:'即日', ship_days:0, new_n:3, amz:0,
  basis:'カート', rst:'ok', fee_total:250, fee_ref:150, fee_fba:50,
  fee_tax:50, fee_fba_ship:50, fee_fba_store:16, size_tier:'s', size_g:110,
  size_long:17, size_wid:13, size_hei:1.5,
  fee_base:5000, pics_ok:1, pics_n:1, buy_qty:0,
  price_at:AT, amz_at:AT, fee_at:AT, rank:9000, rank_cat:'ゲーム',
  mv_first:'2026-08-01T00:00:00Z', mv_last:'2026-11-16T00:00:00Z',
  mv_down:0, mv_down_n:0, mv_up:0, mv_up_n:0, mv_gone_n:0, mv_back_n:0,
  mv_back_qty:0, mv_gone_days:0, mv7_down:0, mv7_n:0, mv_wipe_n:0, mv_wipe:0 };
const mk=(n,jan,o)=>Object.assign({},base,{ jan:jan, mw_name:n, amz_name:n,
  asin:'B00AAA'+jan.slice(-4) },o||{});
/* 1件目：通る品（あとで Amazon の値段を下げて外れさせる）
   2件目：ずっと通る品 */
const R1=[mk('よい品','4902370550001',{ wholesale:2000, price:6000 }),
          mk('ずっとよい品','4902370550002',{ wholesale:2000, price:6500 })];
const meta=(rows)=>({ ok:true, n:rows.length, rows:rows, seen:rows.length,
  priced:rows.length, left:0, per_run:120, ttl_days:3, limit:3000 });

await p.evaluate((m)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwSubShip').value='0';
  $('csvMwAmzWin').checked=false;
  if($('csvMwAmzRstOk'))$('csvMwAmzRstOk').checked=false;
  $('subChMonitor').value='123456789012345678';
  $('subOnMonitor').checked=true;
  window.__meta=m;
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
    if(/\/mw\/amz/.test(url))return res(window.__meta);
    return real(u,i);
  };
  switchTab('F'); syncRole='admin'; roleApply();
  /* 前の控えは消しておく（この端末の前の回に引っぱられないため）。 */
  try{ localStorage.removeItem(SUB_CMP_KEY); }catch(e){}
},meta(R1));
await openCsvBoxes(p);
await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
await p.waitForTimeout(500);

console.log('=== ① 1回目は「控えがありません」と出して控える ===');
{
  const t=await p.evaluate(async()=>{
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    let n=0;
    try{ n=JSON.parse(localStorage.getItem(SUB_CMP_KEY)||'[]').length; }
    catch(e){ n=0; }
    return { note:($('subDraftNote').textContent||'').replace(/\s+/g,' '),
             saved:n };
  });
  console.log('   '+t.note.slice(0,160));
  ok(/前の①の控えがありません/.test(t.note),
     '★★★1回目は「前の①の控えがありません」と出す');
  ok(t.saved===1,'★★★この回を控える（次に押すと比べられる）');
  ok(/見た品/.test(t.note)&&/候補/.test(t.note),
     '★★★足切りの内訳に「見た品 ◯件（候補 ◯件のうち…）」を出す');
}

console.log('\n=== ② 2回目：前は通っていて今は外れた品を出す ===');
{
  const t=await p.evaluate(async(rows)=>{
    /* Amazon の値段を下げて、1件目だけ手残りが足りなくする。 */
    window.__meta={ ok:true, n:rows.length, rows:rows, seen:rows.length,
      priced:rows.length, left:0, per_run:120, ttl_days:3, limit:3000 };
    mwSubPxCache={};
    $('csvMwAmzLoad').click();
    await new Promise((x)=>setTimeout(x,500));
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    let n=0;
    try{ n=JSON.parse(localStorage.getItem(SUB_CMP_KEY)||'[]').length; }
    catch(e){ n=0; }
    return { note:($('subDraftNote').innerHTML||'').replace(/\s+/g,' '),
             txt:($('subDraftNote').textContent||'').replace(/\s+/g,' '),
             saved:n };
  },[Object.assign({},R1[0],{ price:3300 }),R1[1]]);
  console.log('   '+(/前の①と比べて[^。]*/.exec(t.txt)||[''])[0].slice(0,220));
  ok(/前の①と比べて/.test(t.txt),'★★★「前の①と比べて」を出す');
  ok(/前は通っていて今は外れた品 1件/.test(t.txt),
     '★★★外れた品の件数（1件）');
  ok(/よい品/.test(t.txt),'★★★外れた品の名前を並べる');
  ok(/Amazon の値段/.test(t.txt)&&/¥6,000/.test(t.txt)
     &&/¥3,300/.test(t.txt),
     '★★★変わった数字を「前→後」で出す（Amazon の値段 ¥6,000→¥3,300）');
  ok(/外れた理由/.test(t.txt)&&/手残りが足りない/.test(t.txt),
     '★★★外れた理由も出す');
  ok(/変わらない 1件/.test(t.txt),'★★変わらない品の件数も出す');
  ok(t.saved===2,'★★控えは2回分だけ');
  ok(/この端末だけ/.test(t.txt),'★控えは端末だけに置くと書く');
}

console.log('\n=== ③ ランキング上限も「効いている絞り込み」に出す ===');
{
  const t=await p.evaluate(async()=>{
    /* ゲームの上限を 1,000位にする（9,000位の行は隠れる）。
       上限は mwRankCaps（JSON の欄）の1か所で持っている。 */
    mwRankCapSet({ 'ゲーム':1000 });
    mwAmzRender();
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    return { txt:($('subDraftNote').textContent||'').replace(/\s+/g,' '),
             caps:JSON.stringify(mwRankCaps()) };
  });
  console.log('   caps='+t.caps+' / '
    +(/効いている絞り込み[^）]*/.exec(t.txt)||[''])[0].slice(0,160));
  ok(/ランキング上限/.test(t.txt),
     '★★★案の「効いている絞り込み」にランキング上限を出す');
  ok(/1,000位まで/.test(t.txt),'★★★上限の数字も出す');
  ok(/順位が取れていない行は隠す/.test(t.txt),
     '★★上限を入れているあいだは順位が無い行も隠れると書く');
}

await T.done();
})();
