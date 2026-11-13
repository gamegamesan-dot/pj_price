/* 画面：「一度に消えた」と、そのしきい値の⚙（6.189・【2】）

   ・⚙「3. 仕入れ」に「一度に消えたと見なす割合（既定 80%）」と
     「そのときの減った数（既定 50点以上）」を作った。
     **Worker が取り込みで読む**設定なので pj-sync にも送る
   ・一覧の「動き」の行に「一度に消えた n回・n点（売れた数に数えていません）」
   ・一度に消えた回しかない商品は「減っていません」ではなく
     「出せません（一度に消えた回しかありません）」
   ・記録（記録を見る）にも「一度に消えた」「CSV の抜けから戻った」を出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：一度に消えた（6.189）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const AT='2026-11-13T01:00:00Z';
const mv=(x)=>Object.assign({
  mv_first:'2026-08-01T00:00:00Z', mv_last:'2026-11-12T00:00:00Z',
  mv_down:0, mv_down_n:0, mv_up:0, mv_up_n:0, mv_gone_n:1,
  mv_back_n:0, mv_back_qty:0, mv_gone_days:0, mv7_down:0, mv7_n:0,
  mv_wipe_n:1, mv_wipe:415 },x||{});
const ROW=Object.assign({
  jan:'4571442047206', sha:'いろは商会', kishu:'NS2',
  mw_name:'彩京 SHOOTING LIBRARY Vol.1', amz_name:'彩京 SHOOTING LIBRARY Vol.1',
  cond:'新品', list_price:7678, wholesale:3000,
  stock:0, note:'', ship_text:'即日', ship_days:0,
  asin:'B0SAI00001', rank:2124, rank_cat:'ゲーム', price:9000, basis:'カート',
  new_n:3, amz:0, fee_total:1500, fee_ref:975, fee_fba:425, fee_tax:97,
  fee_fba_ship:425, fee_fba_store:16, size_tier:'m', size_g:300,
  price_at:AT, amz_at:AT, fee_at:AT, pics_ok:1, pics_n:1, buy_qty:0,
  mv_prev:415, mv_cur:0, rst:'ok' },mv());
const META={ ok:true, n:1, rows:[ROW], seen:1, priced:1, left:0,
  per_run:120, ttl_days:3, limit:3000 };

await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('csvMwAmzWin').checked=false;
  if($('csvMwAmzFbaNg'))$('csvMwAmzFbaNg').checked=false;
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  const real=window.fetch;
  window.__post=[];
  window.fetch=async(u,i)=>{
    const url=String(u), o=i||{};
    if(/\/whoami/.test(url))
      return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url)){
      if(String(o.method||'')==='POST'){
        window.__post.push(JSON.parse(String(o.body||'{}')));
        return res({ ok:true, at:'2026-11-13T00:00:00Z', settings:{} });
      }
      return res({ ok:true, at:'', settings:{} });
    }
    if(/\/mw\/move/.test(url))
      return res({ ok:true, jan:'4571442047206', n:3, rows:[
        { at:'2026-11-01T00:00:00Z', at_jst:'2026-11-01 09:00', kind:'new',
          prev:null, cur:415, d:0, sha:'いろは商会' },
        { at:'2026-11-12T00:00:00Z', at_jst:'2026-11-12 09:00', kind:'wipe',
          prev:415, cur:0, d:-415, sha:'いろは商会' },
        { at:'2026-11-13T00:00:00Z', at_jst:'2026-11-13 09:00', kind:'csvback',
          prev:0, cur:415, d:415, sha:'いろは商会' }], stat:mvStat() });
    if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, n:0, rows:[] });
    if(/\/mw\/buy/.test(url))return res({ ok:true, rows:[], n:0 });
    if(/\/mw\/amz/.test(url))return res(META);
    return real(u,i);
  };
  window.mvStat=function(){
    return { days:100, speed:null, speedSrc:'', outDays:null, downN:0, down:0,
             upN:0, up:0, goneN:1, backN:0, backAvg:null, goneAvg:null,
             wipeN:1, wipeQty:415, sale:false, saleWord:'', noBack:false,
             thin:false, tooNew:false, base:415, none:false,
             label:'一度に消えた 1回' };
  };
  switchTab('F'); syncRole='admin'; roleApply();
},META);
await openCsvBoxes(p);
await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
await p.waitForTimeout(500);

console.log('=== ① ⚙の欄と既定 ===');
{
  const t=await p.evaluate(()=>({
    pct:($('mwWipePct')||{}).value, min:($('mwWipeMin')||{}).value,
    inCfg:CSV_CFG_IDS.indexOf('mwWipePct')>=0
          &&CSV_CFG_IDS.indexOf('mwWipeMin')>=0,
    inAdv:advCsvCfg().indexOf('mwWipePct')>=0
          &&advCsvCfg().indexOf('mwWipeMin')>=0 }));
  console.log('   '+JSON.stringify(t));
  ok(t.pct==='80','★★★「一度に消えたと見なす割合」の既定は 80%');
  ok(t.min==='50','★★★「そのときの減った数」の既定は 50点以上');
  ok(t.inCfg,'★★端末にも控える');
  ok(t.inAdv,'★★★pj-sync にも送る（Worker が取り込みで読む設定）');
}

console.log('\n=== ② 入れたら pj-sync に送る ===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[]; advSent={};
    $('mwWipeMin').value='100';
    $('mwWipeMin').dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise((x)=>setTimeout(x,1500));
    const sent=window.__post.map((b)=>b.settings||{});
    $('mwWipeMin').value='50';
    return sent.filter((x)=>x.mwWipeMin!==undefined).length;
  });
  ok(t>=1,'★★★変えたら pj-sync に送る');
}

console.log('\n=== ③ 一覧の「動き」に出る ===');
{
  const t=await p.evaluate(()=>
    ($('csvMwAmzList').textContent||'').replace(/\s+/g,' '));
  console.log('   '+t.slice(0,300));
  ok(/一度に消えた 1回・415点/.test(t),
     '★★★「一度に消えた n回・n点」を出す');
  ok(/売れた数に数えていません/.test(t),'★★★売れた数に入れていないと書く');
  ok(/出せません（一度に消えた回しかありません）/.test(t),
     '★★★「減っていません」ではなく、出せない理由を書く');
  ok(!/1日 \d/.test(t),'★★★1日あたりの数を出さない');
  ok(!/欠品まで/.test(t),'★★欠品までの見込みも出さない');
}

console.log('\n=== ④ 記録（記録を見る）の言い方 ===');
{
  const t=await p.evaluate(async()=>{
    mwMoveShow('4571442047206');
    await new Promise((x)=>setTimeout(x,400));
    return ($('mwMoveBox')||$('mwMoveNote')||{}).textContent||'';
  });
  console.log('   '+String(t).replace(/\s+/g,' ').slice(0,260));
  ok(/一度に消えた（売れた数に数えない）/.test(t),
     '★★★記録に「一度に消えた（売れた数に数えない）」と出す');
  ok(/CSV の抜けから戻った（再入荷に数えない）/.test(t),
     '★★★「CSV の抜けから戻った（再入荷に数えない）」も出す');
}
await T.done();
})();
