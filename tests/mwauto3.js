/* 画面：仕入れタブを開いたら一覧を自動で出す（8.32・カジの依頼・v290）
   ① 開いたら自動で取り込む（ボタンは「一覧を取り直す」で残る）
   ② 前の一覧をこの端末に覚えて、開いた瞬間に出す → 裏で取り直して差し替える
      （絞り込み・並べ替え・開いている件数・チェックが消えない）
   ③ 取り直すのは「⚙の分数がたった」か「MW の取り込みが前の一覧より新しい」
      ときだけ
   ④ 一覧の上に「◯時◯分の一覧（MW の取り込み ◯時◯分）」／取り直し中はそう出す
   ⑤ 「仕入れる一覧」を開いていたときは、そのまま出す */
const { harness } = require('./lib');
const T = harness('画面：仕入れタブの自動の一覧（8.32）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const ROW=(jan,o)=>Object.assign({ jan:jan, sha:'いろは商会', kishu:'NS',
  mw_name:'商品'+jan.slice(-3), amz_name:'Amazon '+jan.slice(-3),
  asin:'B0D1GSZJ8T', stock:9, ship_days:0, wholesale:2000, list_price:5000,
  price:5800, basis:'カート', low:5800, new_n:4, amz:0, rank:12000,
  rank_cat:'ゲーム', fee_total:900, fee_ref:800, fee_tax:80, fee_fba:500,
  fee_at:'2026-11-15T00:00:00.000Z', amz_at:'2026-11-15T00:00:00.000Z',
  price_at:'2026-11-15T00:00:00.000Z', size_tier:'s', size_g:118,
  rst:'ok', buy_qty:0 },o||{});

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__n={ amz:0, list:0 };
  window.__rows=o.rows;
  window.__mwAt=o.mwAt;
  window.fetch=async(u,i)=>{
    const url=String(u);
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/mw\/list/.test(url)){ window.__n.list++;
      return res({ ok:true, rows:[], last:{ at:window.__mwAt, rows_in:10 },
                   csv:null, stale_h:24 }); }
    if(/\/mw\/amz/.test(url)&&!/method/.test(String((i||{}).method||''))){
      window.__n.amz++;
      return res({ ok:true, n:window.__rows.length, seen:2, left:0, priced:2,
                   rows:window.__rows, more:false, per_run:120 });
    }
    if(/\/mw\/buy/.test(url))return res({ ok:true,
      rows:window.__buy||[], n:(window.__buy||[]).length });
    if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, rows:[] });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
  /* 覚え書きと一覧を空にしてから始める。 */
  try{ localStorage.removeItem('pj:mwamz:v1'); }catch(e){}
  window.__buy=[];
  mwAmzRows=[]; mwAmzMeta=null; mwAmzView='list'; mwAmzAt=''; mwAmzAtMw='';
  mwStaleAt=''; mwBuyMap={};
},o);

console.log('=== ① 開いたら自動で出す ===');
{
  /* MW の取り込みは2時間前（いまの一覧より古い）。
     こうしておくと、開いたときの取り込みは**1回だけ**になる。 */
  await setup({ rows:[ROW('4902370550001'),ROW('4902370550002')],
                mwAt:new Date(Date.now()-2*3600000).toISOString() });
  const t=await p.evaluate(async()=>{
    switchTab('F');
    await new Promise((r)=>setTimeout(r,500));
    return { amz:window.__n.amz, list:window.__n.list, rows:mwAmzRows.length,
             html:($('csvMwAmzList').textContent||'').slice(0,60),
             btn:($('csvMwAmzLoad').textContent||''),
             at:($('mwAmzAtNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+t.at+' / '+t.html+' / amz='+t.amz+' list='+t.list);
  ok(t.amz===1,
     '★★★タブを開いたら自動で取り込む（押さなくてよい・1回だけ）');
  ok(t.rows===2,'★★一覧が入る');
  ok(/Amazon 001|商品001/.test(t.html),'★★★一覧が出る');
  ok(t.btn==='一覧を取り直す','★★★ボタンは「一覧を取り直す」で残る');
  ok(/の一覧/.test(t.at)&&/MW の取り込み/.test(t.at),
     '★★★「◯時◯分の一覧（MW の取り込み ◯時◯分）」を出す');
  /* 覚え書きに入る。 */
  const c=await p.evaluate(()=>{
    try{ const d=JSON.parse(localStorage.getItem('pj:mwamz:v1')||'null');
      return { n:(d&&d.rows||[]).length, at:!!(d&&d.at),
               key:JSON.stringify(d).indexOf('syncKey')<0 }; }
    catch(e){ return null; }
  });
  ok(c&&c.n===2&&c.at,'★★★この端末に覚える');
  ok(c&&c.key,'★★★覚え書きに pj-sync のキーは入れない');
}

console.log('=== ② 覚えてある一覧をすぐ出して、裏で差し替える ===');
{
  /* 画面を作り直した状態（一覧は空・覚え書きはある）にして開く。 */
  const t=await p.evaluate(async()=>{
    /* 覚え書きの時刻を1時間前にする（⚙30分を超えた状態）。 */
    try{
      const d=JSON.parse(localStorage.getItem('pj:mwamz:v1')||'{}');
      d.at=new Date(Date.now()-3600000).toISOString();
      localStorage.setItem('pj:mwamz:v1',JSON.stringify(d));
    }catch(e){}
    mwAmzRows=[]; mwAmzMeta=null; mwAmzAt=''; mwAmzAtMw=''; mwStaleAt='';
    window.__n.amz=0;
    /* 覚え書きが読めた時点の様子（取り直しの前）を控える。 */
    const okCache=mwCacheLoad();
    const n0=mwAmzRows.length;
    mwAmzRows=[]; mwAmzAt=''; mwAmzAtMw='';
    switchTab('F');
    const now={ rows:mwAmzRows.length,
                html:($('csvMwAmzList').textContent||'').slice(0,40),
                at:($('mwAmzAtNote').textContent||'').replace(/\s+/g,' ') };
    await new Promise((r)=>setTimeout(r,500));
    return { okCache:okCache, n0:n0, now:now,
             after:mwAmzRows.length, amz:window.__n.amz,
             at:($('mwAmzAtNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   開いた瞬間：'+t.now.at+' / '+t.now.html);
  ok(t.okCache&&t.n0===2,'★★★覚え書きから読み直せる');
  ok(t.now.rows===2&&/商品001|Amazon 001/.test(t.now.html),
     '★★★開いた瞬間に覚えてある一覧が出る（待たない）');
  ok(/新しい一覧を取っています/.test(t.now.at),
     '★★★取り直し中はそう出す');
  ok(t.amz===1&&t.after===2,'★★裏で取り直して差し替える');
  ok(/の一覧/.test(t.at)&&!/取っています/.test(t.at),
     '★★★届いたら「◯時◯分の一覧」に戻る');
}

console.log('=== ②の2 差し替えても絞り込み・並べ替え・件数・チェックが消えない ===');
{
  const t=await p.evaluate(async()=>{
    /* 絞り込み（黒字のみを外す）・並べ替え（ランキング順）・
       開いている件数（すべて表示）・仕入れる印を入れておく。 */
    $('csvMwAmzWin').checked=false;
    $('csvMwAmzSort').value='rank';
    listN['more:mwamzall']=999;
    /* 印の正は D1（mw_buy）。pj-sync も返す状態にしておく。 */
    window.__buy=[{ jan:'4902370550001', qty:2 }];
    mwBuyMap['4902370550001']=2;
    mwAmzRender();
    const before={ win:$('csvMwAmzWin').checked, sort:$('csvMwAmzSort').value,
      more:listN['more:mwamzall'],
      chk:!!($('mwBuyChk_4902370550001')||{}).checked,
      qty:($('mwBuyQty_4902370550001')||{}).value };
    window.__n.amz=0;
    await mwAmzLoad(true);
    await new Promise((r)=>setTimeout(r,300));
    return { before:before, win:$('csvMwAmzWin').checked,
      sort:$('csvMwAmzSort').value, more:listN['more:mwamzall'],
      chk:!!($('mwBuyChk_4902370550001')||{}).checked,
      qty:($('mwBuyQty_4902370550001')||{}).value, amz:window.__n.amz };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.amz===1,'★取り直した');
  ok(t.win===false&&t.win===t.before.win,'★★★絞り込みが消えない');
  ok(t.sort==='rank','★★★並べ替えが消えない');
  ok(t.more===999,'★★★開いている件数が消えない');
  ok(t.chk===true&&t.qty==='2','★★★仕入れるのチェックと数量が消えない');
}

console.log('=== ③ 取り直すのは要るときだけ ===');
{
  const t=await p.evaluate(async()=>{
    /* いま取り直したばかり（⚙30分）→ 開いても取りに行かない。 */
    $('mwAmzAutoMin').value='30';
    window.__n.amz=0;
    switchTab('D'); switchTab('F');
    await new Promise((r)=>setTimeout(r,300));
    const a=window.__n.amz;
    /* ⚙の分数がたった（一覧の時刻を1時間前にする）→ 取り直す。 */
    mwAmzAt=new Date(Date.now()-3600000).toISOString();
    window.__n.amz=0;
    switchTab('D'); switchTab('F');
    await new Promise((r)=>setTimeout(r,400));
    const b=window.__n.amz;
    /* MW の取り込みが一覧より新しい → 分数がたっていなくても取り直す。 */
    mwAmzAt=new Date().toISOString();
    mwStaleAt=new Date(Date.now()+1000).toISOString();
    window.__n.amz=0;
    switchTab('D'); switchTab('F');
    await new Promise((r)=>setTimeout(r,400));
    const c=window.__n.amz;
    /* ⚙を 0 にすると時間では取り直さない。 */
    $('mwAmzAutoMin').value='0';
    mwAmzAt=new Date(Date.now()-86400000).toISOString();
    mwStaleAt=mwAmzAt;
    window.__n.amz=0;
    switchTab('D'); switchTab('F');
    await new Promise((r)=>setTimeout(r,300));
    const d=window.__n.amz;
    /* ⚙でオフにすると自動で出さない（覚えてある一覧はそのまま）。 */
    $('mwAmzAuto').checked=false;
    mwAmzAt=new Date(Date.now()-86400000).toISOString();
    $('mwAmzAutoMin').value='30';
    window.__n.amz=0;
    switchTab('D'); switchTab('F');
    await new Promise((r)=>setTimeout(r,300));
    const e=window.__n.amz;
    $('mwAmzAuto').checked=true; $('mwAmzAutoMin').value='30';
    return { fresh:a, old:b, mwNew:c, zero:d, off:e };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.fresh===0,'★★★取ったばかりなら取り直さない（通信を増やさない）');
  ok(t.old===1,'★★★⚙の分数がたったら取り直す');
  ok(t.mwNew===1,
     '★★★MW の取り込みが一覧より新しければ取り直す');
  ok(t.zero===0,'★★⚙を 0 にすると時間では取り直さない');
  ok(t.off===0,'★★★⚙でオフにすると自動で出さない');
}

console.log('=== ⑤ 「仕入れる一覧」を開いていたらそのまま ===');
{
  const t=await p.evaluate(async()=>{
    mwBuyMap['4902370550001']=2;
    mwAmzView='buy'; mwBuyRender();
    const before=($('csvMwAmzList').textContent||'').slice(0,40);
    mwAmzAt=new Date(Date.now()-86400000).toISOString();   // 古くする
    window.__n.amz=0;
    switchTab('D'); switchTab('F');
    await new Promise((r)=>setTimeout(r,400));
    return { before:before, view:mwAmzView, amz:window.__n.amz,
             after:($('csvMwAmzList').textContent||'').slice(0,40) };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.view==='buy','★★★「仕入れる一覧」を開いていたら切り替えない');
  ok(t.amz===0,'★★★そのときは裏で取り直しもしない');
  ok(t.after===t.before,'★★出ているものが変わらない');
  /* 裏で取り直したときも、開いている側を変えない。 */
  const t2=await p.evaluate(async()=>{
    window.__n.amz=0;
    await mwAmzLoad(true);
    await new Promise((r)=>setTimeout(r,300));
    return { view:mwAmzView, amz:window.__n.amz };
  });
  ok(t2.amz===1&&t2.view==='buy',
     '★★★裏で取り直しても「仕入れる一覧」のまま');
  /* 押して取り直したときは、候補の一覧に戻す（今までどおり）。 */
  const t3=await p.evaluate(async()=>{
    await mwAmzLoad();
    await new Promise((r)=>setTimeout(r,300));
    return mwAmzView;
  });
  ok(t3==='list','★★ボタンで取り直したときは候補の一覧に戻る');
}

console.log('=== ⑥ 覚え書きが無くても・壊れていても動く ===');
{
  const t=await p.evaluate(async()=>{
    try{ localStorage.setItem('pj:mwamz:v1','{壊れた'); }catch(e){}
    mwAmzRows=[]; mwAmzAt='';
    const okBad=mwCacheLoad();
    try{ localStorage.removeItem('pj:mwamz:v1'); }catch(e){}
    const okNone=mwCacheLoad();
    window.__n.amz=0;
    mwAmzView='list';
    switchTab('D'); switchTab('F');
    await new Promise((r)=>setTimeout(r,400));
    return { okBad:okBad, okNone:okNone, amz:window.__n.amz,
             rows:mwAmzRows.length };
  });
  ok(t.okBad===false&&t.okNone===false,
     '★★★覚え書きが壊れていても・無くても落ちない');
  ok(t.amz===1&&t.rows===2,'★★★そのときは取り込んで出す');
}

await T.done();
})();
