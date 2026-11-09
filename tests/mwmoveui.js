/* 画面：在庫の動きの目安（6.166・【T】）
   ① 刈取・仕入れる・取り込みの回の一覧に、同じ目安の1行を出す
      （在庫の変化・売れる速さ・欠品までの見込み・再入荷・在庫処分・記録の日数）
   ② 並べ替えに「売れる速さ」「再入荷なし（在庫処分）」を足す
   ③ ⚙「記録を見る」で1商品の動きを出す（GET /mw/move）
   ④ ⚙「目安のまとめを見る」「いますぐ知らせる」（GET /mw/week・POST /mw/week/run）
   ⑤ 「在庫処分」と見なす言葉は⚙で変えられる
   ⑥ 式は shared/mwstat.js の1か所だけ（画面と pj-sync で同じ） */
const { harness, clickCfg } = require('./lib');
const T = harness('画面：在庫の動きの目安（6.166）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const AT='2026-11-09T01:00:00Z';
/* 目安の列（pj-sync が返す名前そのまま）。 */
const mv=(x)=>Object.assign({
  mv_first:'2026-08-01T00:00:00Z', mv_last:'2026-11-08T00:00:00Z',
  mv_down:60, mv_down_n:20, mv_up:0, mv_up_n:0, mv_gone_n:0,
  mv_back_n:0, mv_back_qty:0, mv_gone_days:0, mv7_down:7, mv7_n:3 },x||{});
const amzRow=(i,x)=>Object.assign({
  jan:'49023706'+String(10000+i).slice(-5), sha:'いろは商会', kishu:'NS2',
  mw_name:'刈取の商品'+i, cond:'新品', list_price:7678, wholesale:3000,
  stock:12, note:'', ship_text:'即日', ship_days:0,
  asin:'B0MV00000'+(i%10), amz_name:'Amazon の名前'+i, rank:1200,
  rank_cat:'ゲーム', price:9000, basis:'カート', new_n:3, amz:0,
  fee_total:1500, fee_ref:975, fee_fba:425, fee_tax:97,
  fee_fba_ship:425, fee_fba_store:16, size_tier:'m', size_g:300,
  price_at:AT, amz_at:AT, pics_ok:1, pics_n:1, buy_qty:0
},mv(),x||{});
const buyRow=(i,x)=>Object.assign({
  jan:'49023706'+String(20000+i).slice(-5), qty:1, by_role:'admin', at:AT,
  sha:'いろは商会', kishu:'NS2', mw_name:'仕入れる商品'+i, list_price:7678,
  wholesale:3000, mw_wholesale:3000, stock:12, note:'', ship_text:'即日',
  ship_days:0, cond:'新品', gone:0, asin:'B0BUY00000', price:9000,
  basis:'カート', fee_total:1500, pics:1, reg_state:'', ordered_at:'',
  ordered_by:'', reg_ok:0, cand_n:1
},mv(),x||{});
const ntRow=(i,x)=>Object.assign({
  jan:'49023706'+String(30000+i).slice(-5), sha:'いろは商会', kishu:'NS2',
  name:'欠品の商品'+i, mw_name:'欠品の商品'+i, cond:'新品', list_price:7678,
  wholesale:3000, stock:0, note:'', ship_text:'即日', ship_days:0,
  seen_at:AT, gone_at:AT, back_at:null, created_at:AT,
  asin:'B0NT000000', price:9000, basis:'カート', fee_total:1500,
  buy_qty:0, ordered_at:'', reg_state:'', ebay:0, reg_ok:0,
  mv_prev:12, mv_cur:0
},mv(),x||{});

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000';
  $('linkRate').value='30'; $('shipCharge').value='15.00';
  $('mwShipFee').value='176'; $('mwAmzFeeGame').value='15';
  $('mwAmzFbaGame').value='530'; $('mwFbaShipM').value='425';
  $('mwFbaStoreM').value='16'; $('mwFbaSizeGame').value='m';
  window.__posts=[]; window.__move=o.move; window.__week=o.week;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')
      ?JSON.parse(i.body):null;
    const res=(x,st)=>new Response(JSON.stringify(x),{status:st||200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/mw\/move/.test(url)){ window.__posts.push({u:'move',url:url});
      return res(window.__move); }
    if(/\/mw\/week\/run/.test(url)){ window.__posts.push({u:'weekrun',b:b});
      return res({ ok:true, sent:3 }); }
    if(/\/mw\/week/.test(url)){ window.__posts.push({u:'week',url:url});
      return res(window.__week); }
    if(/\/mw\/nt/.test(url))return res(o.nt||{ok:true,rows:[],n:0,jans:0});
    if(/\/mw\/csv/.test(url))return res({ok:true,n:0,rows:[],on:true});
    if(/\/mw\/buy/.test(url)){
      if(i&&i.method==='POST')return res({ok:true,n:1,rows:[]});
      return res(o.buy||{ok:true,rows:[],n:0,qty:0,yen:0,gone:0});
    }
    if(/\/mw\/amz/.test(url))
      return res(o.amz||{ ok:true, n:0, rows:[], seen:0, priced:0, left:0 });
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

console.log('=== ⑥ 式は shared/mwstat.js の1か所だけ ===');
{
  const r=await p.evaluate(()=>({
    loaded:typeof PJ_MWSTAT!=='undefined'&&typeof MWSTAT.calc==='function',
    same:MWSTAT===PJ_MWSTAT,
    label:MWSTAT.calc({ stock:12, note:'在庫処分',
      mv_first:'2026-08-01T00:00:00Z', mv_down:60, mv7_down:7 },
      { now:Date.parse('2026-11-09T00:00:00Z') }).label }));
  console.log('   '+r.label);
  ok(r.loaded&&r.same,'★★★shared/mwstat.js を読み込んでいる');
  ok(/1日 1点（直近7日）/.test(r.label)&&/残り 12日/.test(r.label),
     '★★★画面でも同じ式で出す');
  const tag=await p.evaluate(()=>
    Array.prototype.some.call(document.querySelectorAll('script'),
      (s)=>/shared\/mwstat\.js/.test(s.getAttribute('src')||'')));
  ok(tag,'★script で読み込んでいる');
}

console.log('\n=== ① 刈取の行に目安を出す ===');
await setup({ amz:{ ok:true, n:2, seen:2, priced:2, left:0,
  rows:[amzRow(0),amzRow(1,{ note:'※在庫処分品', mv_gone_n:2, mv_back_n:0,
    stock:4 })] } });
await p.evaluate(async()=>{ switchTab('F'); await mwAmzLoad(); });
await p.waitForTimeout(400);
let got=await p.evaluate(()=>{
  const el=$('csvMwAmzList');
  return { txt:(el.textContent||'').replace(/\s+/g,' '),
           more:el.querySelectorAll('a').length };
});
console.log('   '+got.txt.slice(0,260));
ok(/動き/.test(got.txt),'★★★刈取の行に「動き」の1行を出す');
ok(/1日 1点（直近7日）/.test(got.txt),'★★★売れる速さを出す');
ok(/欠品まで 12日/.test(got.txt),'★★★欠品までの見込みを出す');
ok(/在庫処分/.test(got.txt),'★★★在庫処分の印を出す');
ok(/再入荷なし/.test(got.txt),'★★★再入荷なしを出す（刈り切る候補）');
ok(/記録 \d+日/.test(got.txt),'★★記録の日数も出す');
ok(/記録を見る/.test(got.txt),'★★「記録を見る」から詳しい動きを開ける');

console.log('\n=== ② 並べ替え（売れる速さ・再入荷なし）===');
{
  const opts=await p.evaluate(()=>Array.prototype.map.call(
    $('csvMwAmzSort').options,(o)=>o.value));
  console.log('   '+opts.join('/'));
  ok(opts.indexOf('speed')>=0,'★★★「売れる速さ順」を足す');
  ok(opts.indexOf('nostock')>=0,'★★★「再入荷なし（在庫処分）を先に」を足す');
  const nm=await p.evaluate(()=>[mwAmzSortName('speed'),
    mwAmzSortName('nostock')]);
  ok(/売れる速さ/.test(nm[0])&&/再入荷なし/.test(nm[1]),
     '★★見出しも並べ替えに合わせる');
}
await setup({ amz:{ ok:true, n:3, seen:3, priced:3, left:0, rows:[
  amzRow(0,{ mw_name:'ゆっくり', amz_name:'ゆっくり', mv7_down:1, mv_down:5 }),
  amzRow(1,{ mw_name:'よく売れる', amz_name:'よく売れる',
             mv7_down:21, mv_down:90 }),
  amzRow(2,{ mw_name:'在庫処分で再入荷なし', amz_name:'在庫処分で再入荷なし',
             note:'在庫処分', mv7_down:3, mv_down:9, mv_gone_n:1,
             mv_back_n:0 })] } });
await p.evaluate(async()=>{ switchTab('F'); await mwAmzLoad();
  $('csvMwAmzSort').value='speed'; mwAmzRender(); });
await p.waitForTimeout(300);
let order=await p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('#csvMwAmzList [data-mwrow]'),
  (d)=>(d.textContent.match(/(ゆっくり|よく売れる|在庫処分で再入荷なし)/)||[])[0]));
console.log('   速さ順: '+order.join('→'));
ok(order[0]==='よく売れる','★★★売れる速さの速い順に並べる');
await p.evaluate(()=>{ $('csvMwAmzSort').value='nostock'; mwAmzRender(); });
await p.waitForTimeout(200);
order=await p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('#csvMwAmzList [data-mwrow]'),
  (d)=>(d.textContent.match(/(ゆっくり|よく売れる|在庫処分で再入荷なし)/)||[])[0]));
console.log('   在庫処分順: '+order.join('→'));
ok(order[0]==='在庫処分で再入荷なし',
   '★★★在庫処分で再入荷なしの行を先に出す');

console.log('\n=== ① 仕入れる一覧の行にも出す ===');
await setup({ buy:{ ok:true, n:1, qty:1, yen:3300, gone:0,
  rows:[buyRow(0)] } });
await p.evaluate(async()=>{ switchTab('F'); await mwBuyShow(); });
await p.waitForTimeout(400);
got=await p.evaluate(()=>({ txt:($('csvMwAmzList').textContent||'')
  .replace(/\s+/g,' ') }));
console.log('   '+got.txt.slice(0,200));
ok(/動き/.test(got.txt)&&/1日 1点/.test(got.txt),
   '★★★仕入れる一覧の行にも同じ目安を出す');
ok(/欠品まで 12日/.test(got.txt),'★★欠品までの見込みも出す');

console.log('\n=== ① 取り込みの回ごとの一覧にも出す ===');
await setup({ nt:{ ok:true, at:AT, at_jst:'2026-11-09 10:00', kind:'gone',
  rows:[ntRow(0)], n:1, jans:1, limit:500, over:1.15 } });
await openCfg();
await p.evaluate(()=>mwNtLoad('2026-11-09T01:00:00Z','gone'));
await p.waitForTimeout(400);
got=await p.evaluate(()=>({ txt:($('mwNtBox').textContent||'')
  .replace(/\s+/g,' ') }));
console.log('   '+got.txt.slice(0,220));
ok(/動き/.test(got.txt),'★★★取り込みの回の一覧にも目安を出す');
ok(/在庫 12→0/.test(got.txt),'★★★その回の在庫の変化（12→0）を出す');

console.log('\n=== ③ ⚙「記録を見る」（GET /mw/move）===');
await setup({ move:{ ok:true, jan:'4902370610000', name:'記録の商品',
  sha:'いろは商会', note:'在庫処分', stock:4, all:3, limit:60, keep_days:90,
  stat:{ days:100, per7:1, perAll:0.6, speed:1, speedSrc:'week', outDays:4,
    downN:2, down:8, upN:0, up:0, goneN:1, backN:1, backAvg:6, goneAvg:2.5,
    sale:true, saleWord:'在庫処分', noBack:false, thin:false, none:false,
    label:'1日 1点（直近7日）／残り 4日／再入荷 1回・平均 6点／在庫処分' },
  rows:[
    { at:'2026-11-08T00:00:00Z', at_jst:'2026-11-08 09:00', sha:'いろは商会',
      idx:0, prev:12, cur:4, d:-8, kind:'down' },
    { at:'2026-11-05T00:00:00Z', at_jst:'2026-11-05 09:00', sha:'いろは商会',
      idx:0, prev:null, cur:12, d:12, kind:'back' },
    { at:'2026-11-02T00:00:00Z', at_jst:'2026-11-02 09:00', sha:'いろは商会',
      idx:0, prev:9, cur:null, d:-9, kind:'gone' }] } });
await openCfg();
await p.evaluate(()=>{ $('mwMoveJan').value='4902370610000'; mwMoveGo(); });
await p.waitForTimeout(400);
got=await p.evaluate(()=>({ note:($('mwMoveNote').textContent||'')
  .replace(/\s+/g,' '), box:($('mwMoveBox').textContent||'')
  .replace(/\s+/g,' '), url:(window.__posts[0]||{}).url||'' }));
console.log('   '+got.note+' ／ '+got.box.slice(0,200));
ok(/jan=4902370610000/.test(got.url),'★★★JAN を渡して引く');
ok(/記録の商品/.test(got.note)&&/いまの在庫 4点/.test(got.note),
   '★★商品名といまの在庫を出す');
ok(/記録 3行（90日ぶん）/.test(got.note),'★★記録の行数と残す日数を出す');
ok(/減った/.test(got.box)&&/欠品から戻った/.test(got.box)
   &&/欠品/.test(got.box),'★★★出来事を日本語で出す');
ok(/12 → 4/.test(got.box),'★★★前の数と今の数を出す');
ok(/1日 1点/.test(got.box),'★★目安も出す');
{
  const bad=await p.evaluate(()=>{ $('mwMoveJan').value='123'; mwMoveGo();
    return ($('mwMoveNote').textContent||''); });
  ok(/13桁/.test(bad),'★JAN が13桁でなければそう言う');
}

console.log('\n=== ④ ⚙「目安のまとめ」（GET /mw/week）===');
const wk=(jan,name,st)=>({ jan:jan, name:name, sha:'いろは商会', stock:5,
  wholesale:3000, note:'', stat:st });
await setup({ week:{ ok:true, top:10, rows:120,
  from:'2026-08-01T00:00:00Z', to:'2026-11-09T00:00:00Z', keep_days:90,
  hot:[wk('4902370611111','よく売れる商品',{ days:100, speed:3,
    speedSrc:'week', outDays:2, backN:0, goneN:0, sale:false, noBack:false,
    thin:false, none:false, label:'1日 3点（直近7日）／残り 2日' })],
  none:[wk('4902370612222','在庫処分の商品',{ days:100, speed:1,
    speedSrc:'all', outDays:5, backN:0, goneN:3, sale:true, noBack:true,
    thin:false, none:false,
    label:'1日 1点（全期間）／残り 5日／再入荷なし／在庫処分（再入荷なし）' })],
  many:[wk('4902370613333','再入荷が多い商品',{ days:100, speed:2,
    speedSrc:'week', outDays:3, backN:4, backAvg:7, goneAvg:1.5, goneN:4,
    sale:false, noBack:false, thin:false, none:false,
    label:'1日 2点（直近7日）／残り 3日／再入荷 4回・平均 7点' })] } });
await openCfg();
await p.evaluate(()=>mwWeekShow());
await p.waitForTimeout(400);
got=await p.evaluate(()=>({ note:($('mwWeekNote').textContent||'')
  .replace(/\s+/g,' '), box:($('mwWeekBox').textContent||'')
  .replace(/\s+/g,' ') }));
console.log('   '+got.note+' ／ '+got.box.slice(0,240));
ok(/記録 120行/.test(got.note),'★★記録の行数を出す');
ok(/よく売れている商品/.test(got.box)&&/よく売れる商品/.test(got.box),
   '★★★よく売れる商品を出す');
ok(/在庫処分で再入荷がない商品/.test(got.box)&&/在庫処分の商品/.test(got.box),
   '★★★在庫処分で再入荷がない商品を出す');
ok(/再入荷が多い商品/.test(got.box),'★★★再入荷が多い商品を出す');
ok(/1日 3点/.test(got.box)&&/再入荷 4回・平均 7点/.test(got.box),
   '★★目安もそのまま出す（式は1か所）');
{
  const r=await p.evaluate(async()=>{ mwWeekSend();
    await new Promise((x)=>setTimeout(x,250));
    return { note:($('mwWeekNote').textContent||''),
             posts:window.__posts.filter((x)=>x.u==='weekrun').length }; });
  console.log('   '+r.note);
  ok(r.posts===1&&/3通 送りました/.test(r.note),
     '★★★「いますぐ知らせる」で Discord に送る');
}

console.log('\n=== ⑤ ⚙の設定 ===');
{
  const r=await p.evaluate(()=>({
    sale:!!$('mwSaleNote'), rest:!!$('mwNtRest'), week:!!$('mwWeek'),
    th:!!$('mwNtThread'),
    restOn:$('mwNtRest').checked, weekOn:$('mwWeek').checked,
    top:$('mwNtTop').value, max:$('mwNtTop').getAttribute('max'),
    inAdv:ADV_AMZCOND.indexOf('mwSaleNote')>=0
      &&ADV_AMZCOND.indexOf('mwNtThread')>=0,
    inChk:ADV_AMZCHK.indexOf('mwNtRest')>=0&&ADV_AMZCHK.indexOf('mwWeek')>=0 }));
  console.log('   '+JSON.stringify(r));
  ok(r.sale&&r.rest&&r.week&&r.th,'★★★4つの設定を置く');
  ok(r.restOn&&r.weekOn,'★★既定は「商品ごとに出す」「週に1回まとめる」');
  ok(r.top==='100'&&r.max==='200','★★★知らせる件数の既定を100件に上げる');
  ok(r.inAdv&&r.inChk,'★★★pj-sync にも送る（端末をまたいで同じ）');
  const w=await p.evaluate(()=>{ $('mwSaleNote').value='きずあり,訳あり';
    return [MWSTAT.saleHit('※きずありです',mwSaleWordsUi()),
            MWSTAT.saleHit('在庫処分',mwSaleWordsUi())]; });
  ok(w[0]==='きずあり'&&w[1]==='','★★★言葉は⚙で変えられる');
  await p.evaluate(()=>{ $('mwSaleNote').value=''; });
}
T.done();
})();
