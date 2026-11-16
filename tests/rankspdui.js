/* 画面：Amazon の順位からの売れ行きの推定（8.47・カジの①）

   ・⚙（使うか・帯ごとの3か月の個数・係数・上限・早い/ゆっくりの境目）
   ・案の行に「推定」の売れ行き（3か月の個数）と出どころが付く
   ・案のまとめに推定の内訳（早い／ふつう／ゆっくり・順位が1回ぶんの件数）
   ・MW の減りとの比べ（**参考**）を出す
   ・MW の減りがある品はそちらが先・足りない分だけ推定で埋める（印） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：順位からの売れ行きの推定（8.47）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const AT='2026-11-16T01:00:00Z';
/* 在庫の動きが**まったく無い**行（MW の減りが取れない＝推定の出番）。 */
const base={ sha:'いろは商会', kishu:'NS', cond:'新品', list_price:7678,
  stock:20, note:'', ship_text:'即日', ship_days:0, new_n:3, amz:0,
  basis:'カート', rst:'ok', fee_total:900, fee_ref:600, fee_fba:200,
  fee_tax:100, fee_fba_ship:200, fee_fba_store:16, size_tier:'s', size_g:110,
  fee_base:6000, pics_ok:1, pics_n:1, buy_qty:0,
  price_at:AT, amz_at:AT, fee_at:AT,
  mv_first:'2026-08-01T00:00:00Z', mv_last:'2026-11-15T00:00:00Z',
  mv_down:0, mv_down_n:0, mv_up:0, mv_up_n:0, mv_gone_n:0, mv_back_n:0,
  mv_back_qty:0, mv_gone_days:0, mv7_down:0, mv7_n:0, mv_wipe_n:0, mv_wipe:0 };
const mk=(n,jan,o)=>Object.assign({},base,{ jan:jan, mw_name:n, amz_name:n,
  asin:'B00AAA'+jan.slice(-4), wholesale:2000, price:6000 },o||{});
const ROWS=[
  /* 900位（3か月270個＝早い） */
  mk('よく売れるゲーム','4902370550001',{ rank:900, rank_cat:'ゲーム' }),
  /* 9,000位（11個＝ふつう）・順位の記録が5回 */
  mk('ふつうのゲーム','4902370550002',{ rank:9000, rank_cat:'ゲーム',
    rk_sum:45000, rk_n:5 }),
  /* 25,000位（2.5個＝ゆっくり）・順位は1回ぶんだけ */
  mk('ゆっくりのゲーム','4902370550003',{ rank:25000, rank_cat:'ゲーム' }),
  /* 90,000位（推定しない） */
  mk('売れていないゲーム','4902370550004',{ rank:90000, rank_cat:'ゲーム' }),
  /* 順位が無い（推定しない） */
  mk('順位なしゲーム','4902370550005',{ rank:0 }),
  /* MW の減りがある品（推定より先に使う）：直近7日に21点 */
  mk('MW で売れているゲーム','4902370550006',{ rank:25000,
    rank_cat:'ゲーム', mv7_down:21, mv_down:90, mv_down_n:30 })];
const META={ ok:true, n:ROWS.length, rows:ROWS, seen:6, priced:6, left:0,
  per_run:120, ttl_days:3, limit:3000 };

await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwSubShip').value='0';
  $('csvMwAmzWin').checked=false;
  if($('csvMwAmzFbaNg'))$('csvMwAmzFbaNg').checked=false;
  if($('csvMwAmzRstOk'))$('csvMwAmzRstOk').checked=false;
  $('subChMonitor').value='123456789012345678';
  $('subOnMonitor').checked=true;
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
    on:($('rsOn')||{}).checked,
    b:[1,2,3,4,5].map((i)=>($('rsB'+i)||{}).value),
    cap:($('rsCap')||{}).value,
    g:[($('rsGame')||{}).value,($('rsHobby')||{}).value,
       ($('rsOther')||{}).value],
    fast:($('rsFast')||{}).value, slow:($('rsSlow')||{}).value,
    opt:RANKSPD.optOf(subPickCfg()) }));
  console.log('   '+JSON.stringify(t));
  ok(t.on===true,'★★★既定で「順位からの推定を使う」');
  ok(t.b.join(',')==='270,30,11,2.5,1',
     '★★★帯の既定（270／30／11／2.5／1個・3か月）');
  ok(t.cap==='270','★★上限は3か月270個（＝1日3個）');
  ok(t.g.join(',')==='1,0.5,0.3',
     '★★★係数（ゲーム1.0・フィギュア0.5・その他0.3）');
  ok(t.fast==='30'&&t.slow==='10','★★★早い30個・ゆっくり10個の境目');
  ok(t.opt.bands[3].q3===2.5&&t.opt.genre['フィギュア']===0.5,
     '★★⚙を1か所で読む（shared/rankspd.js）');
}

console.log('\n=== ② 案の行に推定が付く（MW の減りが先）===');
{
  const t=await p.evaluate(()=>subDraftRows().map((x)=>({ jan:x.jan,
    src:x.spd_src, q3:Math.round(x.q3*10)/10, one:x.rank_one,
    rank:x.rank })));
  console.log('   '+JSON.stringify(t));
  const by={}; t.forEach((x)=>{ by[x.jan]=x; });
  ok(by['4902370550001'].src==='amz'&&by['4902370550001'].q3===270,
     '★★★900位 → 3か月270個（推定）');
  ok(by['4902370550002'].src==='amz'&&by['4902370550002'].q3===11
     &&by['4902370550002'].one===false,
     '★★★順位の記録（5回）があれば平均で推定し、印は付かない');
  ok(by['4902370550003'].src==='amz'&&by['4902370550003'].q3===2.5
     &&by['4902370550003'].one===true,
     '★★★順位が1回ぶんだけの品は印を付ける');
  ok(by['4902370550004'].src===''&&by['4902370550004'].q3===0,
     '★★★50,000位より下は推定しない');
  ok(by['4902370550005'].src===''&&by['4902370550005'].q3===0,
     '★★★順位が無い品も推定しない');
  ok(by['4902370550006'].src==='mw'&&by['4902370550006'].q3>200,
     '★★★MW の減りがある品は MW の数字を使う（推定にしない）');
}

console.log('\n=== ③ まとめに推定の内訳と「MW の減りとの比べ」===');
{
  const t=await p.evaluate(()=>{
    const rows=subDraftRows();
    return { html:subEstHtml(rows).replace(/<[^>]*>/g,'') };
  });
  console.log('   '+t.html);
  ok(/Amazon の順位からの推定/.test(t.html),'★★★推定の内訳を出す');
  ok(/推定で売れ行きが出た品 3件/.test(t.html),
     '★★★推定が出た件数（MW の減りがある品は数えない）');
  ok(/順位が1回ぶんだけ 2件/.test(t.html),
     '★★★順位が1回ぶんだけの件数も出す');
  ok(/どちらも出ない品 2件/.test(t.html),
     '★★★どちらも出ない品の件数も出す');
  ok(/早い 2件/.test(t.html)&&/ふつう 1件/.test(t.html)
     &&/ゆっくり 1件/.test(t.html),
     '★★★「早い／ふつう／ゆっくり」の件数');
  ok(/MW の減りとの比較（参考）/.test(t.html),
     '★★★「比較（参考）」と分かる書き方にする');
  ok(/卸での売れ方/.test(t.html)&&/Amazon の売れ方とは別物/.test(t.html),
     '★★★MW の減りは卸での売れ方で別物だと書く');
}

console.log('\n=== ④ モニターは足りない分を推定で埋める（印）===');
{
  const t=await p.evaluate(async()=>{
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    const m=(subDraftData.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
    return { note:($('subDraftNote').textContent||'').replace(/\s+/g,' '),
             box:($('subDraftBox').textContent||'').replace(/\s+/g,' '),
             jans:(m.items||[]).map((x)=>x.jan+(x.mon_est?'(推定)':'')),
             mon:m.mon||{} };
  });
  console.log('   '+JSON.stringify(t.jans));
  console.log('   '+t.note.slice(-260));
  ok(t.jans[0]==='4902370550006','★★★MW の減りがある品が先');
  ok(t.jans.filter((x)=>/推定/.test(x)).length>0,
     '★★★足りない分は推定で埋める');
  ok(/推定で \d+件を埋めました/.test(t.note),
     '★★★「推定で◯件を埋めました」と出す');
  ok(/3か月で 10個 以上/.test(t.note),'★★★下限は「3か月で◯個」で出す');
  ok(/推定で入れました/.test(t.box),'★★★一覧にも「推定で入れました」の印');
  ok(t.mon.est>0,'★推定で埋めた件数を返す');
}

console.log('\n=== ⑤ ⚙を切れば推定を使わない ===');
{
  const t=await p.evaluate(async()=>{
    $('rsOn').checked=false;
    const rows=subDraftRows();
    const n=rows.filter((x)=>x.spd_src==='amz').length;
    await subDraftGo();
    await new Promise((x)=>setTimeout(x,200));
    const m=(subDraftData.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
    $('rsOn').checked=true;
    return { n:n, jans:(m.items||[]).map((x)=>x.jan), est:(m.mon||{}).est };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.n===0,'★★★⚙を切れば推定の行が無くなる');
  ok(t.jans.length===1&&t.jans[0]==='4902370550006'&&!t.est,
     '★★★MW の減りがある品だけになる');
}
await T.done();
})();
