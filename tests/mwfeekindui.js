/* 画面：FBA 不可の行の出し方と、だめの内訳（6.169・【V の続き】の4）
   ① FBA 不可の行は刈取の一覧から**既定で外す**。
      「FBA 不可も表示」で出すと「FBA 不可」の印と説明が付く
   ② 手数料は仮の値ではなく「自分で発送」の実額＋⚙の発送の目安で出す
   ③ 一覧の「だめ n件」を「FBA 不可／値段／その他／まだ」に分けて出す
   ④ ⚙「いますぐ切り分ける」で、だめだった行をまとめて切り分けられる */
const { harness } = require('./lib');
const T = harness('画面：FBA 不可の行とだめの内訳（6.169）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const row=(i,x)=>Object.assign({
  jan:'49023715'+String(10000+i).slice(-5), sha:'いろは商会', kishu:'NS2',
  mw_name:'商品'+i, amz_name:'商品'+i, cond:'新品', list_price:7678,
  wholesale:1000, stock:12, note:'', ship_text:'即日', ship_days:0,
  asin:'B0KND'+String(10000+i).slice(-5), rank:1200, rank_cat:'ゲーム',
  price:3137, basis:'カート', new_n:3, amz:0,
  fee_total:1500, fee_ref:975, fee_fba:425, fee_tax:97,
  fee_fba_ship:425, fee_fba_store:16, size_tier:'m', size_g:300,
  price_at:'2026-11-10T00:00:00Z', amz_at:'2026-11-10T00:00:00Z',
  fee_at:'2026-11-10T00:00:00Z', fee_base:3137,
  fee_kind:'', fee_kind_at:null, fee_mfn:0,
  pics_ok:1, pics_n:1, buy_qty:0, rst:'ok'
},x||{});
/* FBA 不可の行（販売手数料だけ実額・合計は入っていない）。 */
const ngRow=(i,x)=>row(i,Object.assign({
  mw_name:'3Dマウスパッド『春』'+i, amz_name:'3Dマウスパッド『春』'+i,
  asin:'B00C1W039'+String(i%10), fee_kind:'fba_ng',
  fee_kind_at:'2026-11-10T05:00:00Z', fee_mfn:1,
  fee_total:null, fee_ref:264, fee_tax:26, fee_fba:null,
  fee_fba_ship:null, fee_fba_store:null, fee_base:3137 },x||{}));

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('fx').value='160'; $('mwShipFee').value='176';
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  $('mwFbaShipM').value='425'; $('mwFbaStoreM').value='16';
  $('mwFbaSizeGame').value='m';
  $('csvMwAmzWin').checked=false; $('csvMwAmzFbaNg').checked=false;
  window.__q=[];
  const rows=o.rows||[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u);
    const res=(x,st)=>new Response(JSON.stringify(x),{status:st||200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/mw\/fee\/why\/run/.test(url)){
      window.__q.push({u:'whyrun',url:url,
        b:JSON.parse(String((i||{}).body||'{}'))});
      return res(o.whyrun||{ ok:true, done:40, fba_ng:38, price:1, other:1,
        left:733, calls:3, stopped:'limit' });
    }
    if(/\/mw\/fee\/ng/.test(url))return res({ok:true,n:0,all:0,rows:[]});
    if(/\/mw\/amz/.test(url)){
      window.__q.push({u:'amz',url:url});
      return res({ ok:true, n:rows.length, rows:rows, seen:rows.length,
        priced:rows.length, left:0, per_run:120,
        fee:o.fee||{ n:rows.length, ok:1, ng:4, none:0, kind_ok:true,
          fba_ng:2, price_ng:1, other_ng:1, yet:0, mfn:2, why:[] } });
    }
    if(/\/mw\/buy/.test(url))return res({ok:true,rows:[],n:0,qty:0,yen:0,gone:0});
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return real(u,i);
  };
  syncRole='admin'; roleApply();
},o||{});
const load=async()=>{ await p.evaluate(async()=>{ switchTab('F');
  await mwAmzLoad(); }); await p.waitForTimeout(300); };
const list=async()=>await p.evaluate(()=>
  ($('csvMwAmzList').textContent||'').replace(/\s+/g,' '));
const note=async()=>await p.evaluate(()=>
  ($('csvMwAmzListNote').textContent||'').replace(/\s+/g,' '));

console.log('=== ① FBA 不可は既定で外す ===');
await setup({ rows:[row(0),row(1),ngRow(2),ngRow(3)] });
await load();
{
  const n=await p.evaluate(()=>({
    rows:document.querySelectorAll('#csvMwAmzList [data-mwrow]').length,
    chk:!!$('csvMwAmzFbaNg'), on:$('csvMwAmzFbaNg').checked }));
  console.log('   出ている行 '+n.rows+'／チェック '+n.on);
  ok(n.chk,'★★★「FBA 不可も表示」のチェックがある');
  ok(n.on===false,'★★★既定はオフ（刈取は FBA なので外す）');
  ok(n.rows===2,'★★★FBA 不可の2件は出ない');
  const plus=await p.evaluate(()=>($('csvMwAmzFbaNgN').textContent||''));
  console.log('   '+plus);
  ok(/入れると \+2件/.test(plus),'★★★「入れると +2件」と出す');
}
{
  const t=await p.evaluate(async()=>{
    $('csvMwAmzFbaNg').checked=true;
    $('csvMwAmzFbaNg').dispatchEvent(new Event('change'));
    await new Promise((x)=>setTimeout(x,200));
    return { n:document.querySelectorAll('#csvMwAmzList [data-mwrow]').length,
             txt:($('csvMwAmzList').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   入れたら '+t.n+'行：'+t.txt.slice(0,200));
  ok(t.n===4,'★★★チェックを入れると出る');
  ok(/FBA 不可/.test(t.txt),'★★★行に「FBA 不可」の印を出す');
  ok(/Amazon がこの商品の FBA の手数料を出せません/.test(t.txt),
     '★★★何が起きているかを説明する');
  ok(/自分で発送なら出ます/.test(t.txt),'★★そう調べた結果だと書く');
  ok(/販売手数料と消費税は実額/.test(t.txt),
     '★★★手数料の出どころも書く');
  ok(/切り分け 2026-11-10/.test(t.txt),'★切り分けた日も出す');
}

console.log('\n=== ② 手数料は「自分で発送」の実額＋⚙の目安 ===');
{
  const r=await p.evaluate(()=>{
    const ng={ kishu:'NS2', price:3137, wholesale:1000, size_tier:'m',
      fee_kind:'fba_ng', fee_mfn:1, fee_ref:264, fee_tax:26, fee_base:3137 };
    const yet={ kishu:'NS2', price:3137, wholesale:1000, size_tier:'m' };
    return { ng:mwFeeOf(ng), yet:mwFeeOf(yet),
             cNg:mwAmzCalc(ng), cYet:mwAmzCalc(yet),
             fba:mwFbaGuess(ng) };
  });
  console.log('   FBA不可: 販売 '+r.ng.ref+'＋税 '+r.ng.tax+'＋FBA '+r.ng.fba
    +'＝'+r.ng.fee+'　／ 仮の値: '+r.yet.fee);
  ok(r.ng.ref===264&&r.ng.tax===26,
     '★★★販売手数料と消費税は Amazon の実額をそのまま使う');
  ok(r.ng.fba===r.fba.fba&&r.ng.fbaShip===425&&r.ng.fbaStore===16,
     '★★★発送のぶんは⚙「FBA手数料の目安」を足す');
  ok(r.ng.fee===264+26+441,'★★★合計は実額＋目安');
  ok(r.ng.mfn===true&&r.ng.real===false,
     '★★実額ではない（FBA は目安）と分かるようにする');
  ok(r.yet.ref===Math.round(3137*0.15),
     '★仮の値は今までどおり率で出す（比べるため）');
  ok(r.ng.fee!==r.yet.fee,'★★★仮の値とは違う数になる');
  ok(r.cNg&&r.cNg.profit===Math.round(3137-r.ng.fee-(1100+176)),
     '★★★粗利もその手数料で出る');
}

console.log('\n=== ③ 「だめ」の内訳 ===');
await setup({ rows:[row(0)],
  fee:{ n:3796, ok:3023, ng:773, none:0, kind_ok:true,
        fba_ng:742, price_ng:12, other_ng:9, yet:10, mfn:742, why:[] } });
await load();
{
  const t=await note();
  console.log('   '+t.slice(-220));
  ok(/だめ 773件/.test(t),'★合計は今までどおり');
  ok(/FBA 不可 742件/.test(t),'★★★FBA 不可の件数を出す');
  ok(/値段 12件/.test(t),'★★★値段が原因の件数を出す');
  ok(/その他 9件/.test(t),'★★★その他の件数を出す');
  ok(/まだ切り分けていない 10件/.test(t),'★★★まだの件数も出す');
}
{
  /* 古い pj-sync（内訳が無い）のときは今までどおり。 */
  await setup({ rows:[row(0)],
    fee:{ n:10, ok:6, ng:4, none:0, why:[] } });
  await load();
  const t=await note();
  ok(/だめ 4件/.test(t)&&!/FBA 不可 \d+件/.test(t),
     '★★内訳が無ければ今までどおり出す（古い pj-sync）');
}

console.log('\n=== ④ ⚙「いますぐ切り分ける」 ===');
{
  await p.evaluate(()=>{ switchTab('G');
    Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
      function(d){ d.open=true; }); });
  const r=await p.evaluate(async()=>{
    const auto=$('mwFeeWhyAuto');
    $('mwFeeWhyN').value='40';
    mwFeeWhyRun();
    await new Promise((x)=>setTimeout(x,300));
    return { autoOn:!!(auto&&auto.checked),
      b:(window.__q.filter((x)=>x.u==='whyrun')[0]||{}).b||null,
      note:($('mwFeeWhyNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+r.note);
  ok(r.autoOn===true,
     '★★★「自動で切り分ける」は既定オン（毎時の回のついでに）');
  ok(r.b&&r.b.max===40,'★★★件数を渡して頼む');
  ok(/40件を切り分けました/.test(r.note),'★★★結果を出す');
  ok(/FBA 不可 38件/.test(r.note)&&/値段 1件/.test(r.note)
     &&/その他 1件/.test(r.note),'★★★内訳も出す');
  ok(/残り 733件/.test(r.note),'★★残りも出す');
  const adv=await p.evaluate(()=>
    ADV_AMZCHK.indexOf('mwFeeWhyAuto')>=0
    &&ADV_AMZCHK.indexOf('csvMwAmzFbaNg')>=0);
  ok(adv,'★★pj-sync にも送る（端末をまたいで同じ）');
  const mig=await p.evaluate(()=>
    SYNC_MIGRATE.filter((x)=>x[0]==='fee_kind')[0]||null);
  ok(mig&&/migrate-0050/.test(mig[1]),
     '★★★列が足りないときは migrate-0050 を案内する');
}
T.done();
})();
