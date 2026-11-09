/* 画面：在庫CSVの帯を「そのタブのいちばん下」に移す（6.163・【R】）
   自動の取り込み（【P】）になってほぼ押さないので、タブの上から下へ移した。
   ・どのタブを見ていても、そのタブの中身の**いちばん下**に出る
   ・ファイル選択（csvMwFile）は**畳まれるタブの中に入れない**（v210）
     display:none の親の中にあると iPhone でファイルを選べない
   ・帯の文は⚙と同じ（最後に確かめた時刻・次に確かめる時刻） */
const { harness } = require('./lib');
const T = harness('画面：在庫CSVの帯をいちばん下へ（6.163）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const CSV={ on:true, stop:false, url_set:true, every_h:1, body_h:3,
  checked_at:'2026-11-09T04:08:00Z', checked_jst:'2026-11-09 13:08',
  body_at:'2026-11-09T04:08:00Z',
  next_at:'2026-11-09T05:08:00Z', next_jst:'2026-11-09 14:08', auto_off:'' };
const LAST={ at:'2026-11-09T01:35:00Z', at_jst:'2026-11-09 10:35',
  rows_in:12062, added:3, changed:12, gone:5, src:'hand' };
const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u);
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/mw\/list/.test(url))
      return res({ ok:true, n:0, rows:[], alive:3, picked:0, stale_h:24,
        mkt:{}, limit:1, last:o.last, csv:o.csv });
    if(/\/mw\/csv/.test(url))
      return res(Object.assign({ ok:true, rows:[], n:0, limit:50, full:true,
        fail:0, fail_stop:3, ua:'pj-sync（…）' },o.csv||{}));
    if(/\/mw\/(amz|buy|nt|auto)/.test(url))
      return res({ ok:true, n:0, rows:[], seen:0, priced:0, left:0, fee:{} });
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return real(u,i);
  };
  syncRole='admin'; roleApply();
},o||{});

console.log('=== 置き場所：タブの外・中身のいちばん下 ===');
await setup({ last:LAST, csv:CSV });
let pos=await p.evaluate(()=>{
  const bar=$('mwTopWrap'), file=$('csvMwFile');
  /* 畳まれるタブの箱（#tabCsv など）の中に入っていないこと。 */
  const panes=['tabEb','tabCsv','tabSync','tabBuy','tabCfg','tabDrop'];
  let inPane='';
  panes.forEach(function(id){
    const el=$(id);
    if(el&&el.contains(bar))inPane=id;
  });
  /* 中身（footer）より前で、タブの箱より後ろにあること。 */
  const foot=document.querySelector('footer');
  const after=!!(foot&&(bar.compareDocumentPosition(foot)&4));
  let afterPanes=true;
  panes.forEach(function(id){
    const el=$(id);
    if(el&&!(el.compareDocumentPosition(bar)&4))afterPanes=false;
  });
  return { inPane:inPane, before_footer:after, after_panes:afterPanes,
    file_in_bar:bar.contains(file),
    tabs_before:!!(document.querySelector('.tabs')
      &&(document.querySelector('.tabs').compareDocumentPosition(bar)&4)) };
});
console.log('   '+JSON.stringify(pos));
ok(pos.inPane==='','★★★畳まれるタブの箱の中に入っていない（v210 の再発防止）');
ok(pos.file_in_bar===true,
   '★★★ファイル選択は帯の中（＝タブの外）にある＝iPhone でも開ける');
ok(pos.after_panes===true,'★★★タブの中身より**後ろ**にある（いちばん下）');
ok(pos.before_footer===true,'★★footer より前にある');
ok(pos.tabs_before===true,'★★★タブの切り替えより後ろ（もう上には無い）');
/* どのタブを開いても見えること（display:none の親が無いので当然だが見張る）。 */
let vis=await p.evaluate(()=>{
  const out={};
  ['D','E','F','A','G'].forEach(function(t){
    try{ switchTab(t); }catch(e){}
    out[t]=getComputedStyle($('mwTopWrap')).display!=='none'
      &&getComputedStyle($('mwTopImport')).display!=='none';
  });
  return out;
});
console.log('   '+JSON.stringify(vis));
ok(Object.keys(vis).every((k)=>vis[k]===true),
   '★★★どのタブを見ていても帯が出る');

console.log('=== 帯の文（⚙と同じ）===');
let txt=await p.evaluate(async()=>{
  switchTab('F');
  mwLast=null; mwStaleLast=null; mwStaleAt=''; mwCsvState=null;
  mwStaleLoad();
  await new Promise(function(r){ setTimeout(r,300); });
  return { note:($('mwTopNote').textContent||'').replace(/\s+/g,' '),
    wrap:($('mwTopWrap').textContent||'').replace(/\s+/g,' ') };
});
console.log('   '+txt.note);
ok(/前回の取り込み 11-09 10:35/.test(txt.note),'★前回の取り込みを出す');
ok(/手で取り込み/.test(txt.note),'★自動か手かを出す');
ok(/最後に確かめたのは 2026-11-09 13:08/.test(txt.note),
   '★★★最後に確かめた時刻を出す（変わっていなかった回も・⚙と同じ）');
ok(/次に確かめるのは 2026-11-09 14:08ごろ/.test(txt.note),
   '★★★次に確かめる時刻を出す（⚙と同じ文）');
ok(!/次に取りに行くのは/.test(txt.note),
   '★★古い言い方（次に取りに行くのは）は使わない');
ok(/pj-sync が自動で取り込みます/.test(txt.wrap),
   '★★★自動で取り込むこと・ボタンは自動が止まったとき用だと書いてある');

console.log('=== オフ・止まっているとき ===');
const note=async(csv)=>{
  await setup({ last:LAST, csv:csv });
  return await p.evaluate(async()=>{
    switchTab('F');
    mwLast=null; mwStaleLast=null; mwStaleAt=''; mwCsvState=null;
    mwStaleLoad();
    await new Promise(function(r){ setTimeout(r,300); });
    return ($('mwTopNote').textContent||'').replace(/\s+/g,' ');
  });
};
ok(/自動取り込みはオフ/.test(await note(
  Object.assign({},CSV,{ on:false }))),'★★オフならそう出す');
ok(/「すぐ止める」が入っています/.test(await note(
  Object.assign({},CSV,{ stop:true }))),'★★「すぐ止める」も出す');
ok(/自動取り込みは止まっています/.test(await note(
  Object.assign({},CSV,{ auto_off:'2026-11-09 404' }))),
  '★★★続けて失敗して止まっていたら出す');
ok(/取得先の URL が未設定/.test(await note(
  Object.assign({},CSV,{ url_set:false }))),'★★URL 未設定も出す');

console.log('=== ⚙を見ると帯も新しくなる ===');
await setup({ last:LAST, csv:Object.assign({},CSV,
  { checked_jst:'2026-11-09 13:08', next_jst:'2026-11-09 14:08' }) });
let sync=await p.evaluate(async()=>{
  switchTab('F');
  mwCsvState=null; mwLast=null; mwStaleLast=null;
  mwStaleAt='2026-11-09T01:35:00Z';
  mwStaleRender();
  const before=($('mwTopNote').textContent||'').replace(/\s+/g,' ');
  /* ⚙の「最近の取得を見る」を押すと、同じ値で帯も出し直す。 */
  switchTab('G');
  Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
    function(d){ d.open=true; });
  mwCsvRunsShow();
  await new Promise(function(r){ setTimeout(r,350); });
  return { before:before,
    after:($('mwTopNote').textContent||'').replace(/\s+/g,' '),
    cfg:($('mwCsvNote').textContent||'').replace(/\s+/g,' ') };
});
console.log('   前：'+sync.before);
console.log('   後：'+sync.after);
ok(!/最後に確かめたのは/.test(sync.before),'★はじめは確かめた時刻が無い');
ok(/最後に確かめたのは 2026-11-09 13:08/.test(sync.after),
   '★★★⚙を見ると帯も新しくなる（⚙と食い違わない）');
ok(/最後に確かめたのは 2026-11-09 13:08/.test(sync.cfg)
   &&/次に確かめるのは 2026-11-09 14:08/.test(sync.cfg),
   '★★★⚙と帯がまったく同じ時刻を出す');

console.log('=== 仕入れタブの中のボタンも残っている ===');
let both=await p.evaluate(()=>{
  switchTab('D');
  return { top:!!$('mwTopImport'), inTab:!!$('csvMwImport'),
    file:!!$('csvMwFile') };
});
ok(both.top&&both.inTab&&both.file,
   '★★手で取り込む道は2つとも残してある（自動が止まったとき用）');

await T.done();
})();
