/* 画面：件数の表示を絞り込みと一致させる（6.167・【V】）
   ① ジャンルの選択肢の件数は**ほかの絞り込みをかけたあと**の数
      （「その他 3件（全 1,444件）」の形）
   ② 絞り込みの各チェックの横に「これを外すと +n件」
   ③ 「値段あり」と「読み込んだ」の違いをはっきり出す。
      打ち切ったときは、打ち切ったことと残りの件数を出す
   ④ 続きを offset で取り切る（打ち切りが起きない）
   ⑤ 手数料の「だめだった行」を見て、そのまま1件で試せる */
const { harness, clickCfg } = require('./lib');
const T = harness('画面：件数の表示を絞り込みと一致させる（6.167）');
const ok = T.ok;
(async()=>{
const p=await T.open();

/* 刈取の1行。genre は rank_cat で決まる（ゲーム／フィギュア／その他）。 */
const row=(i,x)=>Object.assign({
  jan:'49023708'+String(10000+i).slice(-5), sha:'いろは商会', kishu:'NS2',
  mw_name:'商品'+i, amz_name:'商品'+i, cond:'新品', list_price:7678,
  wholesale:3000, stock:12, note:'', ship_text:'即日', ship_days:0,
  asin:'B0CNT'+String(10000+i).slice(-5), rank:1200, rank_cat:'ゲーム',
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
  $('mwAmzFeeHobby').value='10'; $('mwAmzFbaHobby').value='530';
  window.__pages=[]; window.__ng=o.ng; window.__test=o.test;
  const rows=o.rows||[], page=o.page||1500, priced=(o.priced===undefined)
    ? rows.length : o.priced;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u);
    const res=(x,st)=>new Response(JSON.stringify(x),{status:st||200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/mw\/fee\/ng/.test(url)){ window.__pages.push({u:'ng',url:url});
      return res(window.__ng); }
    if(/\/mw\/fee\/test/.test(url)){ window.__pages.push({u:'test',url:url});
      return res(window.__test); }
    if(/\/mw\/amz/.test(url)){
      const off=+((url.match(/[?&]offset=(\d+)/)||[])[1]||0);
      const lim=+((url.match(/[?&]limit=(\d+)/)||[])[1]||page);
      const take=Math.min(lim,page);
      const part=rows.slice(off,off+take);
      window.__pages.push({u:'amz',off:off,lim:lim,n:part.length});
      return res({ ok:true, n:rows.length, rows:part, seen:rows.length,
        priced:priced, left:0, per_run:120, offset:off, page_max:page,
        more:part.length>=take, limit:take,
        fee:o.fee||{ n:rows.length, ok:rows.length, ng:0, none:0, why:[] } });
    }
    if(/\/mw\/buy/.test(url))return res({ok:true,rows:[],n:0,qty:0,yen:0,gone:0});
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return real(u,i);
  };
  syncRole=o.role||'admin'; roleApply();
},o||{});
const load=async()=>{ await p.evaluate(async()=>{ switchTab('F');
  await mwAmzLoad(); }); await p.waitForTimeout(300); };
const note=async()=>await p.evaluate(()=>
  ($('csvMwAmzListNote').textContent||'').replace(/\s+/g,' '));
const opts=async()=>await p.evaluate(()=>Array.prototype.map.call(
  $('csvMwAmzGenre').options,(o)=>({ v:o.value, t:o.textContent })));
const plus=async()=>await p.evaluate(()=>({
  win:($('csvMwAmzWinN').textContent||''),
  multi:($('csvMwAmzMultiN').textContent||''),
  noAmz:($('csvMwAmzNoAmzN').textContent||''),
  rstOk:($('csvMwAmzRstOkN').textContent||''),
  minM:($('csvMwAmzMinMN').textContent||''),
  rank:($('csvMwAmzRankN').textContent||'') }));

console.log('=== ④ 続きを取り切る（打ち切りが起きない）===');
{
  /* 値段あり 3,411件・1回 1,500件。3回に分けて取り切る。 */
  const rows=[];
  for(let i=0;i<3411;i++)rows.push(row(i));
  await setup({ rows:rows, page:1500 });
  await load();
  const pg=await p.evaluate(()=>window.__pages.filter((x)=>x.u==='amz'));
  const n=await p.evaluate(()=>({ got:mwAmzRows.length, cut:mwAmzCut }));
  console.log('   '+pg.map((x)=>x.off+'→'+x.n).join('／')+'　合計 '+n.got
    +'　残り '+n.cut);
  ok(pg.length===3&&pg[0].off===0&&pg[1].off===1500&&pg[2].off===3000,
     '★★★続きを offset で取る');
  ok(n.got===3411&&n.cut===0,'★★★3,411件ぜんぶ読み込む（打ち切らない）');
  const t=await note();
  console.log('   '+t.slice(0,200));
  ok(/読み込んだ 3,411件/.test(t),'★★★「読み込んだ 3,411件」と出す');
  ok(!/3,000件のうち/.test(t)&&!/打ち切り/.test(t),
     '★★★「3,000件のうち」と出さない（打ち切っていない）');
}

console.log('\n=== ③ 打ち切ったときは、そうはっきり出す ===');
{
  /* 値段あり 3,411件のうち 3,000件しか取れない（頁の上限に当たった）形。 */
  const rows=[];
  for(let i=0;i<3000;i++)rows.push(row(i));
  await setup({ rows:rows, page:1500, priced:3411 });
  await load();
  const t=await note();
  console.log('   '+t.slice(0,240));
  ok(/打ち切りました/.test(t),'★★★打ち切ったことを出す');
  ok(/残り 411件は出ていません/.test(t),'★★★残りの件数を出す');
  ok(/絞り込み・並べ替え・CSV・ジャンルの件数は読み込んだぶんだけ/.test(t),
     '★★★漏れていることも書く');
}

console.log('\n=== ① ジャンルの件数は絞り込みのあとの数 ===');
{
  /* その他（rank_cat なし）1,444件のうち、黒字は3件だけ。
     ゲームは 10件（ぜんぶ黒字）。 */
  const rows=[];
  /* ジャンルは機種（kishu）で決まる。NS2＝ゲーム／知らない機種＝その他。 */
  for(let i=0;i<1444;i++)
    rows.push(row(i,{ kishu:'zzz', price:(i<3?9000:3200) }));
  for(let i=0;i<10;i++)
    rows.push(row(2000+i,{ kishu:'NS2', price:9000 }));
  await setup({ rows:rows, page:1500 });
  await load();
  let o=await opts();
  console.log('   '+o.map((x)=>x.t).join(' ｜ '));
  ok(o.some((x)=>/^その他 3件（全 1,444件）$/.test(x.t)),
     '★★★「その他 3件（全 1,444件）」の形で出す');
  ok(o.some((x)=>/^ゲーム 10件（全 10件）$/.test(x.t)),
     '★★絞り込みで減らないジャンルは同じ数');
  ok(/^すべて（13件／全 1,454件）$/.test(o[0].t),
     '★★★「すべて」も絞り込みのあとの数と全件数');
  /* 選ぶと、その数と一覧の件数が一致する。 */
  const got=await p.evaluate(async()=>{
    $('csvMwAmzGenre').value='その他'; mwAmzRender();
    await new Promise((x)=>setTimeout(x,80));
    return ($('csvMwAmzListNote').textContent||'').replace(/\s+/g,' ');
  });
  console.log('   '+got.slice(0,120));
  ok(/ 3件を表示（/.test(got),
     '★★★選んだときに出る数（3件）と、選択肢の件数が一致する');
  /* 黒字のみを外すと、その他の件数が増える。 */
  o=await p.evaluate(async()=>{
    $('csvMwAmzGenre').value=''; $('csvMwAmzWin').checked=false;
    mwAmzRender();
    await new Promise((x)=>setTimeout(x,80));
    return Array.prototype.map.call($('csvMwAmzGenre').options,
      (x)=>x.textContent);
  });
  console.log('   '+o.join(' ｜ '));
  ok(o.some((x)=>/^その他 1,444件（全 1,444件）$/.test(x)),
     '★★★絞り込みを外すと件数も変わる');
  await p.evaluate(()=>{ $('csvMwAmzWin').checked=true; });
}

console.log('\n=== ② 「これを外すと何件増えるか」 ===');
{
  const rows=[];
  /* 黒字10件／赤字20件（黒字のみを外すと +20）。
     新品出品者1人を5件（2人以上を外すと +5・黒字のうち）。 */
  for(let i=0;i<10;i++)rows.push(row(i,{ price:9000, new_n:3 }));
  for(let i=0;i<20;i++)rows.push(row(100+i,{ price:3200, new_n:3 }));
  for(let i=0;i<5;i++)rows.push(row(200+i,{ price:9000, new_n:1 }));
  await setup({ rows:rows, page:1500 });
  await load();
  let v=await plus();
  console.log('   '+JSON.stringify(v));
  ok(/外すと \+20件/.test(v.win),'★★★「黒字のみ」を外すと +20件');
  ok(v.multi===''&&v.noAmz===''&&v.rstOk==='',
     '★★入れていない絞り込みには何も出さない');
  /* 新品出品者2人以上を入れると、その横に +5件が出る。 */
  v=await p.evaluate(async()=>{
    $('csvMwAmzMulti').checked=true; mwAmzRender();
    await new Promise((x)=>setTimeout(x,80));
    return { win:($('csvMwAmzWinN').textContent||''),
             multi:($('csvMwAmzMultiN').textContent||'') };
  });
  console.log('   '+JSON.stringify(v));
  ok(/外すと \+5件/.test(v.multi),'★★★「新品出品者が2人以上」を外すと +5件');
  /* 利益率の下限。 */
  v=await p.evaluate(async()=>{
    $('csvMwAmzMulti').checked=false; $('csvMwAmzMinM').value='99';
    mwAmzRender();
    await new Promise((x)=>setTimeout(x,80));
    return ($('csvMwAmzMinMN').textContent||'');
  });
  console.log('   '+v);
  ok(/0%にすると \+\d+件/.test(v),'★★★利益率の下限は「0%にすると +n件」');
  await p.evaluate(()=>{ $('csvMwAmzMinM').value='0'; });
  /* ランキングの基準。 */
  v=await p.evaluate(async()=>{
    $('mwRankCaps').value=JSON.stringify({ 'ゲーム':100 }); mwAmzRender();
    await new Promise((x)=>setTimeout(x,80));
    return { rank:($('csvMwAmzRankN').textContent||''),
             note:($('csvMwAmzListNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+JSON.stringify(v).slice(0,200));
  ok(/ランキングの基準を外すと \+\d+件/.test(v.rank),
     '★★★ランキングの基準を外すと +n件');
  await p.evaluate(()=>{ $('mwRankCaps').value=''; });
}

console.log('\n=== ⑤ 手数料の「だめだった行」 ===');
{
  const why='手数料が返りませんでした（ClientError）：Sender: '
    +'InvalidParameterValue: The value for IsAmazonFulfilled is not valid '
    +'for this ASIN because the item is not eligible for Fulfillment by Amazon.';
  await setup({ rows:[row(0)], page:1500,
    fee:{ n:3411, ok:2693, ng:718, none:0, why:[{ why:why, n:718 }] },
    ng:{ ok:true, n:2, all:718, limit:30, why:'', mp:'A1VC38T7YXB528', rows:[
      { jan:'4902370810001', name:'だめだった商品A', sha:'いろは商会',
        kishu:'NS2', asin:'B0CNT10000', price:9000, sent:8800,
        at:'2026-11-10T01:00:00Z', at_jst:'2026-11-10 10:00', why:why,
        rank_cat:'ゲーム', size_tier:'m' },
      { jan:'4902370810002', name:'だめだった商品B', sha:'いろは商会',
        kishu:'NS2', asin:'4047356123', price:1200, sent:1200,
        at:'2026-11-10T02:00:00Z', at_jst:'2026-11-10 11:00',
        why:'ASIN の形が違うので送っていません（英数字10桁）',
        rank_cat:'本', size_tier:'' }] },
    test:{ ok:false, asin:'B0CNT10000', price:8800, http:200,
      err:'', got_n:1, pick:{ ok:false, err:why }, sent:[], size:null,
      note:'取れませんでした。' } });
  await load();
  const t=await note();
  ok(/だめ 718件/.test(t),'★一覧に「だめ 718件」と出る');
  await p.evaluate(()=>{ switchTab('G');
    Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
      function(d){ d.open=true; }); });
  const got=await p.evaluate(async()=>{
    mwFeeNgShow();
    await new Promise((x)=>setTimeout(x,250));
    return { note:($('mwFeeNgNote').textContent||'').replace(/\s+/g,' '),
             box:($('mwFeeNgBox').textContent||'').replace(/\s+/g,' '),
             url:(window.__pages.filter((x)=>x.u==='ng')[0]||{}).url||'' };
  });
  console.log('   '+got.note);
  console.log('   '+got.box.slice(0,260));
  ok(/だめだった行 718件/.test(got.note),'★★★だめだった行の全件数を出す');
  ok(/A1VC38T7YXB528/.test(got.note),
     '★★★送っている市場（MarketplaceId）も出す');
  ok(/ASIN B0CNT10000（10桁）/.test(got.box),
     '★★★ASIN と桁数を出す');
  ok(/4047356123（10桁・B で始まらない）/.test(got.box),
     '★★B で始まらない ASIN はそう書く');
  ok(/送った値段 ¥8,800/.test(got.box)&&/いまの値段 ¥9,000/.test(got.box),
     '★★★送った値段といまの値段を分けて出す');
  ok(/not eligible for Fulfillment by Amazon\./.test(got.box),
     '★★★理由を全文で出す');
  /* そのまま1件で試せる。 */
  const tried=await p.evaluate(async()=>{
    const b=$('mwFeeNgBox').querySelector('button');
    b.click();
    await new Promise((x)=>setTimeout(x,250));
    return { asin:$('mwFeeTestAsin').value, price:$('mwFeeTestPrice').value,
             url:(window.__pages.filter((x)=>x.u==='test')[0]||{}).url||'',
             note:($('mwFeeTestNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+JSON.stringify(tried).slice(0,260));
  ok(tried.asin==='B0CNT10000'&&tried.price==='8800',
     '★★★「この1件で試す」で ASIN と送った値段が入る');
  ok(/asin=B0CNT10000/.test(tried.url)&&/price=8800/.test(tried.url),
     '★★★同じ値段で1件だけ聞く');
  ok(/not eligible for Fulfillment by Amazon\./.test(tried.note),
     '★★★その1件の理由を全文で出す');
  /* 本の10桁の ASIN も試せる（B… に限らない）。 */
  const isbn=await p.evaluate(async()=>{
    $('mwFeeTestAsin').value='4047356123'; $('mwFeeTestPrice').value='1200';
    mwFeeTestRun();
    await new Promise((x)=>setTimeout(x,250));
    return ($('mwFeeTestNote').textContent||'');
  });
  ok(!/英数字10桁で入れて/.test(isbn),
     '★★★本・雑誌の10桁の ASIN も試せる');
}
T.done();
})();
