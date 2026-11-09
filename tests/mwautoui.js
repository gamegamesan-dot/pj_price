/* 画面：自動の取り直しの記録（6.162・【R】）
   ・⚙に「自動の回の記録を見る」。日時・段ごとの件数・かかった時間・
     止まった理由を10件ずつ出す
   ・いまの様子（オンオフ・最後に動いた時刻・次の回・飛んだ回数）
   ・「いま1回動かす」で、毎時37分を待たずに同じ中身を回せる
   ・一覧の「前回の取得」に、自動の回か手で押した回かを出す */
const { harness, clickCfg } = require('./lib');
const T = harness('画面：自動の取り直しの記録（6.162）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], cancel=false;
p.on('dialog',async d=>{ dlg.push(d.message());
  if(cancel)await d.dismiss(); else await d.accept(); });

const runs=(n)=>{
  const rows=[];
  for(let i=0;i<n;i++)rows.push({
    at:'2026-11-09T0'+(i%10)+':37:00Z',
    at_jst:'2026-11-09 1'+(i%10)+':37',
    kind:(i%4===0)?'hand':'cron',
    asin_n:100, rst_n:36, price_n:80, fee_n:140,
    fee_ng:(i%3===0)?2:0, fee_left:(i%5===0)?12:0,
    calls:19, left_n:1200, ms:88400,
    stopped:(i%6===0)?'価格:time':'', err:(i===1)?'ネットワークが切れました':null,
    mode:'on', per_hour:100, asin_left:900,
    note:'1時間ぶん 100件…'
  });
  return rows;
};
const AUTO=(x)=>Object.assign({ ok:true, rows:runs(14), n:14, limit:50,
  full:true, mode:'on', per_hour:100,
  plan:{ per:100, asin:100, price:80, rst:60, price_cap:80 },
  cron_min:37, budget_ms:90000,
  last_cron_at:'2026-11-09T02:37:00Z', last_cron_jst:'2026-11-09 11:37',
  miss:0, miss_warn:2,
  next_at:'2026-11-09T03:37:00Z', next_jst:'2026-11-09 12:37' },x||{});

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__posts=[]; window.__auto=o.auto;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')
      ?JSON.parse(i.body):null;
    const res=(x,st)=>new Response(JSON.stringify(x),{status:st||200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/mw\/auto/.test(url)){
      if(i&&i.method==='POST'){ window.__posts.push({u:'run',b:b});
        return res(o.run||{ ok:true, asin_n:100, rst_n:36, price_n:80,
          fee_n:140, ms:88400, stopped:'' }); }
      return res(window.__auto);
    }
    if(/\/mw\/amz/.test(url))
      return res(o.amz||{ ok:true, n:0, rows:[], seen:0, priced:0, left:0,
        per_run:120, ttl_days:3, last:null, fee:{} });
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return real(u,i);
  };
  syncRole=o.role||'admin'; roleApply();
},o||{});
const openCfg=async()=>await p.evaluate(()=>{
  switchTab('G');
  Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
    function(d){ d.open=true; });
});

console.log('=== ⚙のボタンと、いまの様子 ===');
await setup({ auto:AUTO() });
await openCfg();
let has=await p.evaluate(()=>({ btn:!!$('mwAutoRunsBtn'), now:!!$('mwAutoNow'),
  box:!!$('mwAutoRuns') }));
ok(has.btn&&has.now&&has.box,
   '★★★「自動の回の記録を見る」「いま1回動かす」のボタンがある');
await p.evaluate(()=>mwAutoRunsShow());
await p.waitForTimeout(300);
let st=await p.evaluate(()=>({
  note:($('mwAutoNote').textContent||'').replace(/\s+/g,' '),
  n:($('mwAutoRuns').textContent.match(/ASIN引き /g)||[]).length,
  bar:!!$('mwAutoRuns').querySelector('[data-listmore]'),
  box:($('mwAutoRuns').textContent||'').replace(/\s+/g,' ') }));
console.log('   '+st.note);
console.log('   '+st.box.slice(0,300));
ok(/自動で取り直します（1時間に 100件）/.test(st.note),
   '★★★いまの⚙の設定を出す');
ok(/最後に自動で動いたのは 2026-11-09 11:37/.test(st.note),
   '★★★最後に自動で動いた時刻を出す');
ok(/次の自動の回は 2026-11-09 12:37ごろ（毎時37分）/.test(st.note),
   '★★★次の自動の回を出す');
ok(/1回の見込み：ASIN 100件／可否 60件／価格 80件（持ち時間 90秒）/.test(st.note),
   '★★1回に進む見込みと持ち時間も出す');
ok(st.n===10,'★★★既定は10件だけ出す');
ok(st.bar===true,'★★★「さらに10件」で広げられる');
ok(/自動（毎時37分）/.test(st.box)&&/手で押した/.test(st.box),
   '★★★自動の回か手で押した回かを出す');
ok(/ASIN引き 100件／可否 36件／価格 80件／手数料 140件/.test(st.box),
   '★★★段ごとの件数を出す');
ok(/かかった時間 88\.4秒/.test(st.box),'★★★かかった時間を出す');
ok(/止まった理由 価格:time/.test(st.box),'★★★止まった理由を出す');
ok(/手数料 12件は次回/.test(st.box),'★★次回に回した手数料の件数も出す');
ok(/だめ 2/.test(st.box),'★手数料が取れなかった件数も出す');
ok(/落ちた/.test(st.box)&&/ネットワークが切れました/.test(st.box),
   '★★★落ちた回は理由（例外の文）まで出す');
ok(/動いた/.test(st.box),'★★動いた回も分かる');
let wide=await p.evaluate(()=>{
  $('mwAutoRuns').querySelector('[data-listmore]').click();
  return ($('mwAutoRuns').textContent.match(/ASIN引き /g)||[]).length;
});
ok(wide===14,'★★押すと広がる');

console.log('\n=== 飛んでいるとき ===');
await setup({ auto:AUTO({ miss:3,
  last_cron_at:'2026-11-08T11:03:00Z', last_cron_jst:'2026-11-08 20:03' }) });
await openCfg();
let miss=await p.evaluate(async()=>{
  mwAutoRunsShow();
  await new Promise(function(r){ setTimeout(r,300); });
  return ($('mwAutoNote').textContent||'').replace(/\s+/g,' ');
});
console.log('   '+miss);
ok(/自動の回が 3回ぶん飛んでいます/.test(miss),'★★★飛んでいることを出す');
ok(/2回で Discord に知らせます/.test(miss),'★★知らせる決まりも書く');
ok(/2026-11-08 20:03/.test(miss),'★★最後に動いた時刻（カジが見た時刻）を出す');

console.log('\n=== まだ一度も動いていないとき ===');
await setup({ auto:AUTO({ last_cron_at:'', last_cron_jst:'', miss:0 }) });
await openCfg();
let none=await p.evaluate(async()=>{
  mwAutoRunsShow();
  await new Promise(function(r){ setTimeout(r,300); });
  return ($('mwAutoNote').textContent||'').replace(/\s+/g,' ');
});
ok(/まだ一度も自動で動いていません/.test(none),'★★★そう出す');

console.log('\n=== D1 の列がまだ無いとき ===');
await setup({ auto:AUTO({ full:false }) });
await openCfg();
let old=await p.evaluate(async()=>{
  mwAutoRunsShow();
  await new Promise(function(r){ setTimeout(r,300); });
  return ($('mwAutoNote').textContent||'').replace(/\s+/g,' ');
});
ok(/migrate-0048 を流すと/.test(old),
   '★★★列がまだ無いことと、どうすればよいかを出す');

console.log('\n=== 「いま1回動かす」 ===');
await setup({ auto:AUTO() });
await openCfg();
dlg=[]; cancel=false;
let now=await p.evaluate(async()=>{
  window.__posts=[];
  $('mwAutoNow').click();
  await new Promise(function(r){ setTimeout(r,400); });
  return { posts:JSON.parse(JSON.stringify(window.__posts)),
    note:($('mwAutoRunNote').textContent||'').replace(/\s+/g,' ') };
});
console.log('   '+now.note);
ok(dlg.some((m)=>/自動の回とまったく同じ中身/.test(m)),'★★★先に確認を出す');
ok(now.posts.some((x)=>x.u==='run'&&x.b&&x.b.force===true),
   '★★★押すとオフでも動かす（force）');
ok(/ASIN引き 100件／可否 36件／価格 80件／手数料 140件/.test(now.note),
   '★★★結果を段ごとに出す');
ok(/88\.4秒/.test(now.note),'★かかった時間も出す');
/* やめたら動かさない。 */
dlg=[]; cancel=true;
let no=await p.evaluate(async()=>{
  window.__posts=[];
  $('mwAutoNow').click();
  await new Promise(function(r){ setTimeout(r,250); });
  return window.__posts.length;
});
cancel=false;
ok(no===0,'★★やめたら動かさない');

console.log('\n=== 作業者の端末 ===');
await setup({ auto:AUTO(), role:'staff' });
await openCfg();
let staff=await p.evaluate(async()=>{
  window.__posts=[];
  $('mwAutoNow').click();
  await new Promise(function(r){ setTimeout(r,250); });
  return { n:window.__posts.length,
    note:($('mwAutoRunNote').textContent||'').replace(/\s+/g,' '),
    vis:getComputedStyle($('mwAutoNow').parentElement).display };
});
ok(staff.vis==='none','★★作業者には出さない（値段に関わる設定）');
ok(staff.n===0&&/管理者/.test(staff.note),
   '★★★作業者の端末からは動かせない');

console.log('\n=== 一覧の「前回の取得」に 自動／手で ===');
const lastNote=async(last)=>{
  await setup({ auto:AUTO(), amz:{ ok:true, n:1, seen:1, priced:1, left:0,
    per_run:120, ttl_days:3, fee:{ n:1, ok:1, ng:0 }, last:last,
    rows:[{ jan:'4902370550001', sha:'いろは商会', kishu:'NS2',
      mw_name:'商品', amz_name:'商品', wholesale:3000, stock:9, ship_days:0,
      ship_text:'即日', asin:'B0AUTO0001', price:9000, basis:'カート',
      new_n:1, amz:0, rst:'ok', cond:'新品', list_price:20000, rank:1200,
      rank_cat:'ゲーム', pics_ok:0, pics_n:0, size_tier:'m',
      fee_total:1500, fee_ref:975, fee_fba:425, fee_tax:100 }] } });
  await p.evaluate(async()=>{
    switchTab('F');
    $('csvMwAmzLoad').click();
    await new Promise(function(r){ setTimeout(r,400); });
  });
  return await p.evaluate(()=>($('csvMwAmzListNote').textContent||'')
    .replace(/\s+/g,' '));
};
let a1=await lastNote({ at:'2026-11-09T02:37:00Z', at_jst:'2026-11-09 11:37',
  src:'auto', price_n:80, fee_n:140, rst_n:36 });
console.log('   '+a1.slice(-120));
ok(/前回の取得 2026-11-09 11:37（自動）/.test(a1),
   '★★★自動の回だったら「（自動）」と出す（直った点）');
let a2=await lastNote({ at:'2026-11-09T03:00:00Z', at_jst:'2026-11-09 12:00',
  src:'hand', asked:1, done:1, priced:1 });
ok(/前回の取得 2026-11-09 12:00（手で押した）/.test(a2),
   '★★★手で押した回だったらそう出す');

await T.done();
})();
