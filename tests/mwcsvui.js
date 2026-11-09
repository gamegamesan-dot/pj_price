/* 画面：在庫CSVの自動取り込み（6.160・【P】）
   ⚙に、オンオフ・「すぐ止める」・取得先・間隔・最近の取得の記録を置く。
   ・既定はオフ（カジがオンにしてから動く）
   ・取得先の URL は⚙に置く（コードに直書きしない）
   ・最近の取得は10件ずつ・「さらに10件」
   ・続けて失敗して止まったら、そう出して「もう一度動かす」で戻せる
   ・手で取り込む「MWの在庫CSVを取り込む」は残す（自動が止まったとき用）
   ・「前回の取り込み」に、自動か手動か・次に取りに行く予定を出す */
const { harness, clickCfg } = require('./lib');
const T = harness('画面：在庫CSVの自動取り込み（6.160）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], cancel=false;
p.on('dialog',async d=>{ dlg.push(d.message());
  if(cancel)await d.dismiss(); else await d.accept(); });

/* /mw/csv の返り（記録 n件）。 */
const runs=(n,x)=>{
  const rows=[];
  for(let i=0;i<n;i++)rows.push(Object.assign({
    at:'2026-11-0'+(1+(i%8))+'T0'+(i%10)+':07:00Z',
    at_jst:'2026-11-0'+(1+(i%8))+' 1'+(i%10)+':07',
    src:(i%3===0)?'hand':'auto', http:200,
    changed:(i%2===0)?1:0, took:(i%2===0)?1:0,
    bytes:(i%2===0)?1800000:0, rows_in:(i%2===0)?12062:0,
    added:(i%2===0)?3:0, changed_rows:(i%2===0)?12:0, gone:(i%2===0)?5:0,
    elapsed_ms:(i%2===0)?8400:120, ok:1, why:(i%2===0)?'':'変わっていません'
  },(i===0)?(x||{}):{}));
  return rows;
};
const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__posts=[]; window.__csv=o.csv;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')
      ?JSON.parse(i.body):null;
    const res=(x,st)=>new Response(JSON.stringify(x),{status:st||200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/mw\/csv\/run/.test(url)){ window.__posts.push({u:'run',b:b});
      return res(o.run||{ ok:true, took:true, rows_in:12062, added:3,
        changed_rows:12, same:12047, gone:5, picked:11900, elapsed_ms:8400,
        warn:'' }); }
    if(/\/mw\/csv\/on/.test(url)){ window.__posts.push({u:'on',b:b});
      return res({ok:true}); }
    if(/\/mw\/csv/.test(url))return res(window.__csv);
    if(/\/mw\/list/.test(url))
      return res(o.list||{ ok:true, n:0, rows:[], alive:0, picked:0,
        stale_h:24, mkt:{}, last:null, csv:null });
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return real(u,i);
  };
  syncRole=o.role||'admin'; roleApply();
},o||{});

const CSV_OK={ ok:true, rows:runs(14), n:14, limit:50,
  on:true, stop:false, url_set:true, every_h:1, body_h:3,
  checked_at:'2026-11-08T16:07:00Z', checked_jst:'2026-11-09 01:07',
  body_at:'2026-11-08T13:07:00Z',
  next_at:'2026-11-08T17:07:00Z', next_jst:'2026-11-09 02:07',
  fail:0, fail_stop:3, auto_off:'',
  ua:'pj-sync（有限会社オーシャン貿易・在庫確認）' };

console.log('=== ⚙の欄 ===');
await setup({ csv:CSV_OK });
let f=await p.evaluate(()=>{
  switchTab('G');
  Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
    function(d){ d.open=true; });
  return { auto:!!$('mwCsvAuto'), v:String(($('mwCsvAuto')||{}).value||''),
    stop:!!$('mwCsvStop'), stopv:!!(($('mwCsvStop')||{}).checked),
    url:!!$('mwCsvUrl'), every:String(($('mwCsvEveryH')||{}).value||''),
    body:String(($('mwCsvBodyH')||{}).value||''),
    now:!!$('mwCsvNow'), list:!!$('mwCsvRunsBtn'),
    im:!!$('csvMwImport')&&!!$('mwTopImport'),
    txt:($('tabCfg').textContent||'').replace(/\s+/g,' ') };
});
console.log('   '+JSON.stringify(f).slice(0,260));
ok(f.auto&&f.v==='off','★★★自動取り込みの欄があり、既定は「オフ」');
ok(f.stop&&f.stopv===false,'★★★「すぐ止める」のスイッチがあり、既定はオフ');
ok(f.url===true,'★★★取得先（在庫CSVのアドレス）の欄がある');
ok(f.every==='1'&&f.body==='3',
   '★★★既定は「1時間に1回確かめる・本体は3時間に1回まで」');
ok(f.now&&f.list,'★★「いますぐ確かめる」「最近の取得を見る」のボタンがある');
ok(f.im===true,
   '★★★手で取り込む「MWの在庫CSVを取り込む」は残してある（自動が止まったとき用）');
ok(/変わっていなければ取り込みません/.test(f.txt),
   '★★★変わっていなければ取らないと書いてある');
ok(/本体を取るのは多くても/.test(f.txt),'★★本体を取る間隔のことも書いてある');
ok(/メールアドレスは入れません/.test(f.txt),
   '★★★名乗るがメールアドレスは入れないと書いてある');
ok(/3回続けて失敗したら自動を止めて/.test(f.txt),'★★止める決まりも書いてある');
ok(/ログイン画面（HTML）/.test(f.txt),'★★止める条件も書いてある');
ok(/shared\/mwcsv\.js/.test(f.txt),
   '★★★読み方は手で取り込むときと同じ1か所だと書いてある');

console.log('\n=== 取得先は⚙に置く（コードに直書きしない）===');
let src=await p.evaluate(()=>{
  const s=document.documentElement.outerHTML;
  return { hard:/matchingworld\.asia\/stocks\.csv/.test(s),
    ph:String(($('mwCsvUrl')||{}).placeholder||'') };
});
ok(src.hard===false,
   '★★★画面のどこにも取得先のアドレスを書いていない（⚙に入れる）');
ok(/stocks\.csv/.test(src.ph),'★入れ方の例だけ置いてある');

console.log('\n=== 最近の取得の記録（10件ずつ）===');
await clickCfg(p,'#mwCsvRunsBtn',false);
await p.waitForTimeout(250);
let r=await p.evaluate(()=>{
  const el=$('mwCsvRuns');
  const cells=el.querySelectorAll('div.note2');
  return { note:($('mwCsvNote').innerText||'').replace(/\s+/g,' '),
    txt:(el.innerText||'').replace(/\s+/g,' '),
    n:cells.length, bar:!!el.querySelector('[data-listmore]') };
});
console.log('   '+r.note);
console.log('   '+r.txt.slice(0,220));
ok(/自動で取り込みます/.test(r.note),'★★いまの様子を出す');
ok(/次に確かめるのは 2026-11-09 02:07ごろ/.test(r.note),
   '★★★次に取りに行く予定の時刻を出す');
ok(/確かめる間隔 1時間に1回/.test(r.note)&&/本体を取るのは 3時間に1回/.test(r.note),
   '★★間隔も出す');
ok(r.n===10,'★★★既定は10件だけ出す');
ok(r.bar===true,'★★★「さらに10件」で広げられる');
ok(/取り込んだ/.test(r.txt),'★★取り込めた回が分かる');
ok(/変わっていない/.test(r.txt),'★★★「変わっていない」回も残っている');
ok(/12,062行/.test(r.txt),'★★★行数を出す');
ok(/足した 3／変わった 12／今回 新しく欠品 5行/.test(r.txt),
   '★★★足した・変わった・新しく欠品を出す');
ok(/かかった時間 8\.4秒/.test(r.txt),'★★★かかった時間を出す');
ok(/自動/.test(r.txt)&&/手で押した/.test(r.txt),'★★★自動か手で押したかを出す');
ok(/1758KB|1,758KB/.test(r.txt)||/KB/.test(r.txt),'★取った大きさも出す');
let more=await p.evaluate(()=>{
  $('mwCsvRuns').querySelector('[data-listmore]').click();
  return $('mwCsvRuns').querySelectorAll('div.note2').length;
});
ok(more===14,'★★押すと広がる');

console.log('\n=== 続けて失敗して止まったとき ===');
await setup({ csv:Object.assign({},CSV_OK,
  { fail:3, auto_off:'2026-11-08T16:07:00Z HTTP 404 が返りました',
    next_at:'', next_jst:'' }) });
await clickCfg(p,'#mwCsvRunsBtn',false);
await p.waitForTimeout(250);
let off=await p.evaluate(()=>({
  note:($('mwCsvNote').innerText||'').replace(/\s+/g,' '),
  btn:!!$('mwCsvResume') }));
console.log('   '+off.note);
ok(/続けて失敗 3回/.test(off.note),'★★★続けて失敗した回数を出す');
ok(/止まっています/.test(off.note),'★★★止まっていることを出す');
ok(off.btn===true,'★★★「もう一度動かす」のボタンが出る');
dlg=[]; cancel=false;
let on=await p.evaluate(async()=>{
  $('mwCsvResume').click();
  await new Promise(function(r){ setTimeout(r,250); });
  return window.__posts.map(function(x){ return x.u; });
});
ok(on.indexOf('on')>=0,'★★★押すと /mw/csv/on を呼ぶ');
ok(dlg.some((m)=>/もう一度動かします/.test(m)),'★★先に確認を出す');
/* やめたら呼ばない。 */
await setup({ csv:Object.assign({},CSV_OK,{ fail:3, auto_off:'x' }) });
await clickCfg(p,'#mwCsvRunsBtn',false);
await p.waitForTimeout(250);
dlg=[]; cancel=true;
let no=await p.evaluate(async()=>{
  window.__posts=[];
  $('mwCsvResume').click();
  await new Promise(function(r){ setTimeout(r,200); });
  return window.__posts.length;
});
cancel=false;
ok(no===0,'★★やめたら戻さない');

console.log('\n=== 「いますぐ確かめる」 ===');
await setup({ csv:CSV_OK });
await p.evaluate(()=>{
  switchTab('G');
  Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
    function(d){ d.open=true; });
  $('mwCsvUrl').value='';
});
dlg=[];
let noUrl=await p.evaluate(async()=>{
  window.__posts=[];
  $('mwCsvNow').click();
  await new Promise(function(r){ setTimeout(r,200); });
  return { n:window.__posts.length,
    note:($('mwCsvRunNote').textContent||'').replace(/\s+/g,' ') };
});
ok(noUrl.n===0&&/取得先（在庫CSVのアドレス）を入れてください/.test(noUrl.note),
   '★★★取得先が空なら取りに行かない');
dlg=[]; cancel=false;
let now=await p.evaluate(async()=>{
  $('mwCsvUrl').value='https://example.test/stocks.csv';
  window.__posts=[];
  $('mwCsvNow').click();
  await new Promise(function(r){ setTimeout(r,400); });
  return { posts:JSON.parse(JSON.stringify(window.__posts)),
    note:($('mwCsvRunNote').textContent||'').replace(/\s+/g,' ') };
});
console.log('   '+now.note);
ok(dlg.some((m)=>/取りに行きます/.test(m)),'★★★先に確認を出す');
ok(now.posts.some((x)=>x.u==='run'&&x.b&&x.b.force===true),
   '★★★押したときは間隔を待たずに取りに行く（force）');
ok(/12,062行を取り込みました/.test(now.note),'★★★結果を出す');
ok(/足した 3／変わった 12／同じ 12,047/.test(now.note),'★★★内訳を出す');
ok(/今回 新しく欠品 5行/.test(now.note),'★★新しく欠品も出す');
ok(/8\.4秒/.test(now.note),'★かかった時間も出す');
/* 変わっていなかったとき。 */
await setup({ csv:CSV_OK,
  run:{ ok:true, took:false, why:'変わっていません', rows_in:0 } });
await p.evaluate(()=>{
  switchTab('G');
  Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
    function(d){ d.open=true; });
  $('mwCsvUrl').value='https://example.test/stocks.csv';
});
dlg=[];
let same=await p.evaluate(async()=>{
  $('mwCsvNow').click();
  await new Promise(function(r){ setTimeout(r,400); });
  return ($('mwCsvRunNote').textContent||'').replace(/\s+/g,' ');
});
ok(/変わっていません/.test(same)&&/本体は取っていません/.test(same),
   '★★★変わっていなければ「本体は取っていません」と出す');
/* 失敗したとき。 */
await setup({ csv:CSV_OK,
  run:{ ok:false, why:'CSV ではなく HTML が返ってきました（ログイン画面かもしれません）' } });
await p.evaluate(()=>{
  switchTab('G');
  Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
    function(d){ d.open=true; });
  $('mwCsvUrl').value='https://example.test/stocks.csv';
});
dlg=[];
let ng=await p.evaluate(async()=>{
  $('mwCsvNow').click();
  await new Promise(function(r){ setTimeout(r,400); });
  return ($('mwCsvRunNote').textContent||'').replace(/\s+/g,' ');
});
ok(/取り込めませんでした/.test(ng)&&/ログイン画面/.test(ng),
   '★★★失敗したら理由を出す');

console.log('\n=== 作業者の端末 ===');
await setup({ csv:CSV_OK, role:'staff' });
let st=await p.evaluate(async()=>{
  switchTab('G');
  Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
    function(d){ d.open=true; });
  const row=$('mwCsvAuto')?$('mwCsvAuto').closest('.rowv'):null;
  const vis=row?getComputedStyle(row).display:'';
  window.__posts=[];
  if($('mwCsvUrl'))$('mwCsvUrl').value='https://example.test/stocks.csv';
  $('mwCsvNow').click();
  await new Promise(function(r){ setTimeout(r,250); });
  return { vis:vis, posts:window.__posts.length,
    note:($('mwCsvRunNote').textContent||'').replace(/\s+/g,' ') };
});
console.log('   '+JSON.stringify(st));
ok(st.vis==='none','★★★作業者には設定を見せない（値段と仕入れに関わる設定）');
ok(st.posts===0&&/管理者用のキー/.test(st.note),
   '★★★作業者の端末からは取りに行かせない');

console.log('\n=== 「前回の取り込み」（自動か手動か・次の予定）===');
const topNote=async(list)=>{
  await setup({ csv:CSV_OK, list:list });
  await p.evaluate(async()=>{
    switchTab('F');
    mwLast=null; mwStaleLast=null; mwStaleAt=''; mwCsvState=null;
    mwStaleLoad();
    await new Promise(function(r){ setTimeout(r,300); });
  });
  return await p.evaluate(()=>($('mwTopNote').innerText||'')
    .replace(/\s+/g,' '));
};
let t1=await topNote({ ok:true, n:0, rows:[], alive:3, picked:0, stale_h:24,
  mkt:{}, limit:1,
  last:{ at:new Date(Date.now()-3600000).toISOString(), at_jst:'2026-11-09 01:07',
    rows_in:12062, added:3, changed:12, gone:5, src:'auto' },
  csv:{ on:true, stop:false, url_set:true, every_h:1, body_h:3,
    checked_at:'2026-11-08T16:07:00Z', checked_jst:'2026-11-09 01:07',
    next_at:'2026-11-08T17:07:00Z',
    next_jst:'2026-11-09 02:07', auto_off:'' } });
console.log('   '+t1);
ok(/12,062行/.test(t1),'★行数を出す');
ok(/自動/.test(t1),'★★★自動で取り込んだと出す');
ok(/最後に確かめたのは 2026-11-09 01:07/.test(t1),
   '★★★最後に確かめた時刻（変わっていなかった回も）を出す');
/* 6.163：⚙と**同じ文**にした（最後に確かめた＋次に確かめる）。 */
ok(/次に確かめるのは 2026-11-09 02:07ごろ/.test(t1),
   '★★★次に確かめる時刻を出す（⚙と同じ文）');
let t2=await topNote({ ok:true, n:0, rows:[], alive:3, picked:0, stale_h:24,
  mkt:{}, limit:1,
  last:{ at:new Date(Date.now()-3600000).toISOString(), at_jst:'x',
    rows_in:12062, added:3, changed:12, gone:5, src:'hand' },
  csv:{ on:false, stop:false, url_set:false, every_h:1, body_h:3,
    checked_at:'', next_at:'', next_jst:'', auto_off:'' } });
console.log('   '+t2);
ok(/手で取り込み/.test(t2),'★★★手で取り込んだと出す');
ok(/自動取り込みはオフ/.test(t2),'★★★オフならそう出す');
let t3=await topNote({ ok:true, n:0, rows:[], alive:3, picked:0, stale_h:24,
  mkt:{}, limit:1,
  last:{ at:new Date(Date.now()-3600000).toISOString(), at_jst:'x',
    rows_in:12062, added:0, changed:0, gone:0, src:'auto' },
  csv:{ on:true, stop:false, url_set:true, every_h:1, body_h:3,
    checked_at:'x', next_at:'', next_jst:'', auto_off:'2026-11-08 404' } });
console.log('   '+t3);
ok(/自動取り込みは止まっています/.test(t3),
   '★★★続けて失敗して止まっていたら、一覧の上にも出す');
let t4=await topNote({ ok:true, n:0, rows:[], alive:3, picked:0, stale_h:24,
  mkt:{}, limit:1,
  last:{ at:new Date(Date.now()-3600000).toISOString(), at_jst:'x',
    rows_in:1, added:0, changed:0, gone:0, src:'auto' },
  csv:{ on:true, stop:true, url_set:true, every_h:1, body_h:3,
    checked_at:'x', next_at:'', next_jst:'', auto_off:'' } });
ok(/「すぐ止める」が入っています/.test(t4),'★★「すぐ止める」もそう出す');

await T.done();
})();
