/* 画面：絞り込みと並べ替えを pj-sync にまかせる（6.168・【V の続き】）
   ① /mw/amz/find に絞り込みと並べ替えを渡し、条件に合った行だけを受け取る
   ② ジャンルの件数・「外すと +n件」は pj-sync が**全件**で数えたものを使う
   ③ 絞り込みを変えたら取り直す（画面側で絞り直さない）
   ④ 古い pj-sync（find が無い）なら画面側で絞る形に戻り、そう書く
   ⑤ 打ち切ったときは「続きを読み込む」で足せる
   ⑥ だめだった行から「原因を切り分ける」を押せる（/mw/fee/why）
   ⑦ 利益の式は shared/mwamz.js（pj-sync と同じ） */
const { harness } = require('./lib');
const T = harness('画面：絞り込みを pj-sync にまかせる（6.168）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const row=(i,x)=>Object.assign({
  jan:'49023712'+String(10000+i).slice(-5), sha:'いろは商会', kishu:'NS2',
  mw_name:'商品'+i, amz_name:'商品'+i, cond:'新品', list_price:7678,
  wholesale:3000, stock:12, note:'', ship_text:'即日', ship_days:0,
  asin:'B0FUI'+String(10000+i).slice(-5), rank:1200, rank_cat:'ゲーム',
  price:9000, basis:'カート', new_n:3, amz:0, fee_total:1500, fee_ref:975,
  fee_fba:425, fee_tax:97, fee_fba_ship:425, fee_fba_store:16,
  size_tier:'m', size_g:300, price_at:'2026-11-10T00:00:00Z',
  amz_at:'2026-11-10T00:00:00Z', pics_ok:1, pics_n:1, buy_qty:0, rst:'ok'
},x||{});

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000';
  $('linkRate').value='30'; $('shipCharge').value='15.00';
  $('mwShipFee').value='176'; $('mwAmzFeeGame').value='15';
  $('mwAmzFbaGame').value='530'; $('mwFbaShipM').value='425';
  $('mwFbaStoreM').value='16'; $('mwFbaSizeGame').value='m';
  window.__q=[]; window.__why=o.why;
  const rows=o.rows||[], n=(o.n===undefined?rows.length:o.n);
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u);
    const res=(x,st)=>new Response(JSON.stringify(x),{status:st||200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/mw\/fee\/why/.test(url)){ window.__q.push({u:'why',url:url});
      return res(window.__why); }
    if(/\/mw\/fee\/ng/.test(url))return res(o.ng||{ok:true,n:0,all:0,rows:[]});
    if(/\/mw\/amz\/find/.test(url)){
      const off=+((url.match(/[?&]offset=(\d+)/)||[])[1]||0);
      const lim=+((url.match(/[?&]limit=(\d+)/)||[])[1]||1500);
      window.__q.push({u:'find',url:url,off:off});
      if(o.old)return new Response('{}',{status:404});
      const part=rows.slice(off,off+Math.min(lim,o.page||1500));
      return res(Object.assign({ ok:true, rows:part, n:n, cand_n:o.cand||n,
        offset:off,
        limit:lim, more:off+part.length<n, scan:o.scan||n, scan_max:20000,
        cut:false, calc_n:n, find_n:n, hid:{rank:o.rankHid||0}, sort:'net',
        per_run:120,
        fee:{ n:n, ok:n, ng:0, none:0, why:[] } },o.extra||{}));
    }
    if(/\/mw\/amz/.test(url)){
      const off=+((url.match(/[?&]offset=(\d+)/)||[])[1]||0);
      window.__q.push({u:'amz',url:url,off:off});
      const part=rows.slice(off,off+(o.page||1500));
      return res({ ok:true, n:rows.length, rows:part, seen:rows.length,
        priced:(o.priced===undefined?rows.length:o.priced), left:0,
        per_run:120, fee:{ n:rows.length, ok:rows.length, ng:0, none:0,
        why:[] } });
    }
    if(/\/mw\/buy/.test(url))return res({ok:true,rows:[],n:0,qty:0,yen:0,gone:0});
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return real(u,i);
  };
  syncRole='admin'; roleApply();
},o||{});
const load=async()=>{ await p.evaluate(async()=>{ switchTab('F');
  await mwAmzLoad(); }); await p.waitForTimeout(300); };
const note=async()=>await p.evaluate(()=>
  ($('csvMwAmzListNote').textContent||'').replace(/\s+/g,' '));

console.log('=== ⑦ 利益の式は shared/mwamz.js の1か所だけ ===');
{
  const r=await p.evaluate(()=>({
    loaded:typeof PJ_MWAMZ!=='undefined'&&typeof MWAMZ.calc==='function',
    same:MWAMZ===PJ_MWAMZ,
    tag:Array.prototype.some.call(document.querySelectorAll('script'),
      (s)=>/shared\/mwamz\.js/.test(s.getAttribute('src')||'')),
    /* 画面の mwAmzCalc が共通のものを呼んでいるか（同じ答えになるか）。 */
    same2:(function(){
      const row={ kishu:'NS2', price:9000, wholesale:3000, size_tier:'m' };
      const a=mwAmzCalc(row), b=MWAMZ.calc(row,mwAmzS());
      return a&&b&&a.net===b.net&&a.margin===b.margin&&a.fee===b.fee;
    })(),
    genre:mwAmzGenre({kishu:'NS2'})==='ゲーム'
      &&mwAmzGenre({kishu:'zzz'})==='その他' }));
  console.log('   '+JSON.stringify(r));
  ok(r.loaded&&r.same&&r.tag,'★★★shared/mwamz.js を読み込んでいる');
  ok(r.same2,'★★★画面の計算は共通のものを呼ぶ（pj-sync と同じ式）');
  ok(r.genre,'★★ジャンルの判定も共通');
}

console.log('\n=== ① find に絞り込みと並べ替えを渡す ===');
{
  const rows=[]; for(let i=0;i<12;i++)rows.push(row(i));
  await setup({ rows:rows, n:120, cand:150 });
  await p.evaluate(()=>{ $('csvMwAmzWin').checked=true;
    $('csvMwAmzMulti').checked=true; $('csvMwAmzMinM').value='5';
    $('csvMwAmzSort').value='margin'; });
  await load();
  const q=await p.evaluate(()=>window.__q.filter((x)=>x.u==='find'));
  console.log('   '+decodeURIComponent(q[0].url).slice(0,220));
  ok(q.length>=1,'★★★/mw/amz/find に聞く');
  const u=decodeURIComponent(q[0].url);
  ok(/win=1/.test(u)&&/multi=1/.test(u)&&/minM=5/.test(u),
     '★★★絞り込みをそのまま渡す');
  ok(/sort=margin/.test(u),'★★★並べ替えも渡す');
  ok(/counts=1/.test(u),'★★★1回目は件数の数え直しも頼む');
  ok(/kishu=/.test(u)&&/ship_max=/.test(u)&&/stock_min=/.test(u),
     '★★候補の条件も渡す');
  ok(/caps=/.test(u),'★ランキングの基準（⚙）も渡す');
  const srv=await p.evaluate(()=>mwAmzSrv);
  ok(srv===true,'★★pj-sync 側で絞っていると覚える');
  const t=await note();
  console.log('   '+t.slice(0,200));
  ok(/候補 150件/.test(t),'★★★候補の件数は絞り込み前の数（cand_n）');
  ok(/条件に合った 120件/.test(t),
     '★★★「条件に合った n件」（pj-sync が全件で数えた数）を出す');
  ok(/pj-sync が全 120件を見ました/.test(t),'★★見た件数も出す');
  /* 6.168：手数料の様子（「だめ n件」）は find でも同じものを返す。 */
  ok(/手数料：商品ごとの実額/.test(t),
     '★★★手数料の様子も出す（find でも消えない）');
  await p.evaluate(()=>{ $('csvMwAmzMulti').checked=false;
    $('csvMwAmzMinM').value='0'; $('csvMwAmzSort').value='net'; });
}

console.log('\n=== ③ 絞り込みを変えたら取り直す ===');
{
  const rows=[]; for(let i=0;i<5;i++)rows.push(row(i));
  await setup({ rows:rows });
  await load();
  const before=await p.evaluate(()=>window.__q.filter((x)=>x.u==='find').length);
  await p.evaluate(async()=>{
    $('csvMwAmzNoAmz').checked=true;
    $('csvMwAmzNoAmz').dispatchEvent(new Event('change'));
    await new Promise((x)=>setTimeout(x,250));
  });
  const after=await p.evaluate(()=>window.__q.filter((x)=>x.u==='find'));
  console.log('   '+before+' → '+after.length+'　'
    +decodeURIComponent((after[after.length-1]||{}).url||'').slice(-80));
  ok(after.length>before,'★★★絞り込みを変えると取り直す');
  ok(/noAmz=1/.test(decodeURIComponent(after[after.length-1].url)),
     '★★★変えた絞り込みが渡る');
  await p.evaluate(()=>{ $('csvMwAmzNoAmz').checked=false; });
}

console.log('\n=== ② ジャンルの件数と「外すと +n件」は pj-sync の数を使う ===');
{
  const rows=[]; for(let i=0;i<10;i++)rows.push(row(i));
  await setup({ rows:rows, n:13, scan:3796, extra:{
    genres:[{ g:'ゲーム', n:10, all:1444 },
            { g:'その他', n:3, all:2352 }],
    genre_total:13,
    plus:{ win:1234, multi:null, noAmz:null, rstOk:null, minM:null,
           rank:56, dup:null },
    jans:[], jans_cut:0 } });
  await p.evaluate(()=>{ $('csvMwAmzWin').checked=true;
    $('mwRankCaps').value=JSON.stringify({ 'ゲーム':100 }); });
  await load();
  const o=await p.evaluate(()=>Array.prototype.map.call(
    $('csvMwAmzGenre').options,(x)=>x.textContent));
  console.log('   '+o.join(' ｜ '));
  ok(o.some((x)=>/^ゲーム 10件（全 1,444件）$/.test(x)),
     '★★★ジャンルの件数は pj-sync が全件で数えたもの');
  ok(o.some((x)=>/^その他 3件（全 2,352件）$/.test(x)),
     '★★★画面に来ていない行も数に入る');
  ok(/^すべて（13件／全 3,796件）$/.test(o[0]),
     '★★★「すべて」も全件（3,796件）が土台');
  const v=await p.evaluate(()=>({ win:($('csvMwAmzWinN').textContent||''),
    rank:($('csvMwAmzRankN').textContent||'') }));
  console.log('   '+JSON.stringify(v));
  ok(/外すと \+1,234件/.test(v.win),
     '★★★「外すと +n件」も pj-sync の数（全件が土台）');
  ok(/ランキングの基準を外すと \+56件/.test(v.rank),
     '★★★ランキングの基準も同じ');
  await p.evaluate(()=>{ $('mwRankCaps').value=''; });
}

console.log('\n=== ① 続きも find で取り切る ===');
{
  const rows=[]; for(let i=0;i<25;i++)rows.push(row(i));
  await setup({ rows:rows, page:10 });
  await load();
  const q=await p.evaluate(()=>window.__q.filter((x)=>x.u==='find')
    .map((x)=>x.off));
  const got=await p.evaluate(()=>({ n:mwAmzRows.length, cut:mwAmzCut }));
  console.log('   頁 '+q.join('→')+'　合計 '+got.n+'　残り '+got.cut);
  ok(q.length===3&&q[0]===0&&q[1]===10&&q[2]===20,
     '★★★offset で続きを取る');
  ok(got.n===25&&got.cut===0,'★★★条件に合った25件をぜんぶ読み込む');
  ok(!/打ち切り/.test(await note()),'★打ち切っていない');
}

console.log('\n=== ⑤ 打ち切ったときは「続きを読み込む」で足せる ===');
{
  const rows=[]; for(let i=0;i<40;i++)rows.push(row(i));
  await setup({ rows:rows, n:40, page:10 });
  /* 前の節で選んだジャンル・ランキングの基準を戻しておく。 */
  await p.evaluate(()=>{ $('csvMwAmzGenre').value=''; $('mwRankCaps').value='';
    window.__pagesMax=MW_AMZ_PAGES; MW_AMZ_PAGES=2; });
  await load();
  let got=await p.evaluate(()=>({ n:mwAmzRows.length, cut:mwAmzCut }));
  let t=await note();
  console.log('   '+got.n+'件／残り '+got.cut+'　'+t.slice(-160));
  ok(got.n===20&&got.cut===20,'★2頁で打ち切った');
  ok(/20件を表示/.test(t),'★★読み込んだぶんは一覧に出る');
  ok(/打ち切りました/.test(t)&&/残り 20件は出ていません/.test(t),
     '★★★打ち切ったことと残りを出す');
  ok(/続きの \d+件を読み込む/.test(t),'★★★「続きを読み込む」を出す');
  got=await p.evaluate(async()=>{
    $('csvMwAmzListNote').querySelector('button').click();
    await new Promise((x)=>setTimeout(x,300));
    return { n:mwAmzRows.length, cut:mwAmzCut };
  });
  console.log('   押したあと '+got.n+'件／残り '+got.cut);
  ok(got.n===30&&got.cut===10,'★★★押すと続きが足される');
  await p.evaluate(()=>{ MW_AMZ_PAGES=window.__pagesMax; });
}

console.log('\n=== ④ 古い pj-sync なら画面側で絞る ===');
{
  const rows=[]; for(let i=0;i<8;i++)rows.push(row(i));
  await setup({ rows:rows, old:true });
  await p.evaluate(()=>{ mwAmzSrv=null; });
  await load();
  const q=await p.evaluate(()=>({
    find:window.__q.filter((x)=>x.u==='find').length,
    amz:window.__q.filter((x)=>x.u==='amz').length,
    srv:mwAmzSrv, n:mwAmzRows.length }));
  console.log('   '+JSON.stringify(q));
  ok(q.find>=1&&q.amz>=1,'★★★find がだめなら /mw/amz に聞き直す');
  ok(q.srv===false&&q.n===8,'★★★画面側で絞る形に戻る（行は取れている）');
  const t=await note();
  ok(/pj-sync が古いので/.test(t)&&/画面側/.test(t),
     '★★★そのことを画面に書く（デプロイの案内つき）');
  ok(/読み込んだ 8件/.test(t),'★★そのときの件数の言い方は今までどおり');
}

console.log('\n=== ⑥ だめだった行から「原因を切り分ける」 ===');
{
  const why='手数料が返りませんでした（ClientError）：Sender: '
    +'InvalidParameterValue: The value for IsAmazonFulfilled is not valid.';
  await setup({ rows:[row(0)],
    ng:{ ok:true, n:1, all:749, limit:30, why:'', mp:'A1VC38T7YXB528', rows:[
      { jan:'4902371200001', name:'だめだった商品', sha:'いろは商会',
        kishu:'NS2', asin:'B0DV5D74ZQ', price:9000, sent:8800,
        at:'2026-11-10T01:00:00Z', at_jst:'2026-11-10 10:00', why:why,
        rank_cat:'ゲーム', size_tier:'m' }] },
    why:{ ok:true, asin:'B0DV5D74ZQ', price:8800, mp:'A1VC38T7YXB528',
      tried:[
        { key:'fba', label:'いまと同じ（FBA で出す）', http:200, ok:false,
          total:null, err:why },
        { key:'mfn', label:'自分で発送（FBA にしない）', http:200, ok:true,
          total:1400, err:'' },
        { key:'omit', label:'FBA の指定を付けない', http:200, ok:true,
          total:1400, err:'' },
        { key:'price', label:'値段だけ変える（1,000円）', http:200, ok:true,
          total:300, err:'' }],
      why:'**この ASIN は FBA（Amazon から出す）の見積もりが出せません**'
        +'（値段・市場・送り方は正しい）。',
      fix:'pj からは直せません。この行は「仮の手数料」のまま使うか、'
        +'刈取の対象から外してください。' } });
  await p.evaluate(()=>{ switchTab('G');
    Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
      function(d){ d.open=true; }); });
  const got=await p.evaluate(async()=>{
    mwFeeNgShow();
    await new Promise((x)=>setTimeout(x,250));
    const b=Array.prototype.filter.call(
      $('mwFeeNgBox').querySelectorAll('button'),
      (x)=>/原因を切り分ける/.test(x.textContent));
    const had=b.length;
    if(had)b[0].click();
    await new Promise((x)=>setTimeout(x,300));
    return { had:had,
      url:(window.__q.filter((x)=>x.u==='why')[0]||{}).url||'',
      note:($('mwFeeTestNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+got.note.slice(0,260));
  ok(got.had===1,'★★★だめだった行に「原因を切り分ける」を出す');
  ok(/asin=B0DV5D74ZQ/.test(got.url)&&/price=8800/.test(got.url),
     '★★★その ASIN と送った値段で聞く');
  ok(/いまと同じ（FBA で出す）/.test(got.note)
     &&/自分で発送（FBA にしない）/.test(got.note),
     '★★★4通りの結果を並べる');
  ok(/だめ/.test(got.note)&&/取れた/.test(got.note),
     '★★どれが通ったかが分かる');
  ok(/FBA（Amazon から出す）の見積もりが出せません/.test(got.note),
     '★★★原因を日本語で出す');
  ok(/pj からは直せません/.test(got.note),'★★直し方も出す');
}

console.log('\n=== ⑤ 値段の古さの言い方（6.168 の5）===');
{
  const r=await p.evaluate(()=>{
    const old={ price_at:'2026-11-09T09:37:00Z' };
    const hot=Object.assign({ kishu:'NS2', price:9000, wholesale:3000,
      size_tier:'m', fee_total:1500, fee_ref:975, fee_fba:425, fee_tax:97 },old);
    const cold=Object.assign({ kishu:'NS2', price:3600, wholesale:3000,
      size_tier:'m', fee_total:1500, fee_ref:975, fee_fba:425, fee_tax:97 },old);
    const buy=Object.assign({},cold,{ buy_qty:1 });
    return { hot:mwPriceAgeHtml(hot), cold:mwPriceAgeHtml(cold),
             buy:mwPriceAgeHtml(buy),
             hotf:mwPriceHot(hot), coldf:mwPriceHot(cold),
             buyf:mwPriceHot(buy) };
  });
  console.log('   '+JSON.stringify(r).slice(0,300));
  ok(r.hotf===true&&r.coldf===false&&r.buyf===true,
     '★★★大事な行（粗利が大きい・仕入れるの印）を見分ける');
  ok(/次の自動で取り直します/.test(r.hot)&&/次の自動で取り直します/.test(r.buy),
     '★★★大事な行は「次の自動で取り直します」と出す');
  ok(/3日で取り直します/.test(r.cold),
     '★★★それ以外は「3日で取り直します」と出す（赤くしない）');
}
T.done();
})();
