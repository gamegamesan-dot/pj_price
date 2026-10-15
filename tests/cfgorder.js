/* ⚙設定を使う頻度で並べる（6.50）
   ・上（よく変える）＝値付けの目標／自動値下げ／売値の自動反映／相場の扱い は初期から開く
   ・中（ときどき）・下（ほぼ触らない）は畳む。見出しをタップで開閉し、開閉を保存する
   ・要対応（キーが空・設定を送っていない）のグループは自動で開いて赤く出す
     （自動で開いたぶんは覚えない＝直したら元の畳んだ状態に戻る）
   ・説明は1行だけ出し、残りは「?」で出す
   ・値・保存先・動作は変えない（並び替えと表示だけ） */
const { harness } = require('./lib');
const T = harness('⚙設定の並び（使う頻度で3段）');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.waitForTimeout(300);
const groups=async()=>await p.evaluate(()=>{
  switchTab('G');
  return Array.from(document.querySelectorAll('#tabCfg details[data-cfgg]')).map(d=>({
    k:d.getAttribute('data-cfgg'), id:d.id, open:d.open,
    sum:d.querySelector('summary').textContent.replace(/\s+/g,' ').trim(),
    bad:/cfggbad/.test(d.querySelector('summary').className),
    n:d.querySelector('.cfggn').textContent.trim(),
    ids:Array.from(d.querySelectorAll('input,select,textarea')).map(x=>x.id)
  }));
});
const byKey=(g,k)=>g.filter(x=>x.k===k)[0]||{};

console.log('=== 3段に並ぶ ===');
let g=await groups();
g.forEach(x=>console.log('   '+(x.open?'開':'閉')+' '+x.k+' '+x.sum));
const band=await p.evaluate(()=>Array.from(document.querySelectorAll('#tabCfg .cfgband'))
  .map(d=>d.textContent.replace(/\s+/g,' ').trim()));
console.log('   帯: '+JSON.stringify(band));
ok(band.length===3&&/よく変える/.test(band[0])&&/ときどき変える/.test(band[1])
   &&/ほぼ触らない/.test(band[2]),'★「よく変える／ときどき変える／ほぼ触らない」の3段');
ok(g.map(x=>x.k).join()==='goal,md,rv,sold,tune,list,conn,fee,policy,sync,ops,man,ui',
   '★上から 値付けの目標→自動値下げ→自動反映→相場→（中）→（下）の順');

console.log('\n=== 上の4つは初期から開く ===');
ok(['goal','md','rv','sold'].every(k=>byKey(g,k).open===true),
   '★値付けの目標・自動値下げ・売値の自動反映・相場の扱いは開いて始まる');
ok(['tune','list','fee','policy','sync','ops','man','ui']
   .every(k=>byKey(g,k).open===false),
   '★中・下のグループは畳んで始まる（接続設定はキーが空なので別に見る）');

console.log('\n=== どのグループに何が入っているか ===');
const has=(k,id)=>(byKey(g,k).ids||[]).indexOf(id)>=0;
ok(has('goal','baseProfit')&&has('goal','linkRate')&&has('goal','saleRate')
   &&has('goal','targetMode'),'★値付けの目標：下限利益・連動率・売上比・決め方');
ok(has('md','autoMdMode')&&has('md','autoMdMax')&&has('md','csvMarkTimes')
   &&has('md','csvMarkDays')&&has('md','csvStartMode'),
   '★自動値下げ：オフ／予定／オン・1日の上限・回数と間隔・開始価格');
ok(has('rv','autoRvMode')&&has('rv','autoRvMax')&&has('rv','autoRvPct'),
   '★売値の自動反映：確認／自動・1日の上限・変更幅の上限');
ok(has('sold','syncSoldCut')&&has('sold','syncSkipAcc')&&has('sold','syncTol'),
   '★相場の扱い：相場から下げる額・「可」を除く・最安グループの許容差額');
ok(has('tune','csvReviewAbs')&&has('tune','csvReviewPct')&&has('tune','syncWeightGame')
   &&has('tune','syncWeight')&&has('tune','csvPackGame')&&has('tune','csvPackFig'),
   '★ときどき：見直しのしきい値・既定重量（ゲーム／ホビー）・梱包マージン');
ok(has('list','csvOriginDefault')&&has('list','csvCatCustom'),
   '★ときどき：原産国の既定値・よく使うeBayカテゴリ');
ok(has('conn','csvTitleApi')&&has('conn','csvTitleKey')&&has('conn','syncApi')
   &&has('conn','syncKey')&&has('conn','csvImgBase')&&has('conn','csvImgToken'),
   '★ほぼ触らない：接続設定（URL・キー・トークン）');
ok(has('fee','fx')&&has('fee','fee')&&has('fee','duty')&&has('fee','amzFeeRate')
   &&has('fee','spFeeSale'),'★ほぼ触らない：為替・手数料・関税・Amazon手数料・Shopee');
ok(has('ui','csvPerPage')&&has('ui','uiHideShopee'),'★ほぼ触らない：画面');

console.log('\n=== 要対応のグループは自動で開く（キーが空）===');
let conn=byKey(g,'conn');
console.log('   '+JSON.stringify({open:conn.open,n:conn.n,bad:conn.bad}));
ok(conn.open===true&&/要対応 6件/.test(conn.n)&&conn.bad===true,
   '★★キーが空の接続設定は開いて「要対応 6件」を赤く出す');
const filled=await p.evaluate(()=>{
  localStorage.setItem('pj:csvcfg:v1',JSON.stringify({
    csvTitleApi:'https://pj-title.example.workers.dev',csvTitleKey:'k',
    csvImgBase:'https://pj-img.example.workers.dev',csvImgToken:'t',
    syncApi:'https://pj-sync.example.workers.dev',syncKey:'k'}));
});
await p.reload(); await p.waitForTimeout(400);
g=await groups();
conn=byKey(g,'conn');
console.log('   入れたあと: '+JSON.stringify({open:conn.open,n:conn.n,bad:conn.bad}));
ok(conn.open===false&&!conn.n&&conn.bad===false,
   '★★直したら印は消え、畳んだ状態に戻る（自動で開いたぶんは覚えない）');

console.log('\n=== 自動値下げ・自動反映の「設定を送っていない」も要対応 ===');
const need=await p.evaluate(()=>{
  $('autoMdMode').value='on'; $('autoRvMode').value='confirm';
  $('csvMarkDays').value='3'; $('csvMarkTimes').value='10'; $('csvMarkStep').value='1';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  const old=new Date(Date.now()-5*86400000).toISOString();
  syncData={at:new Date().toISOString(),counts:{},items:[{asin:'B0CFG00001',cond:'used',
    scope:'ebay',prefix:'game',ebay_sku:'E-B0CFG00001-U',ebay_item_id:'331234',ebay_qty:1,
    ebay_price:90,title:'テスト商品',cost_yen:1200,weight_g:150,one_off:0,dropship:0,
    restocking:0,mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,
    ebay_sale:null,md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,
    amazon_lowest:9000,amazon_offers_json:JSON.stringify([{p:9000,c:'used'}]),
    sold_usd:null,fba_available:1,fba_inbound:0,fba_reserved:0,
    warnings:[],notes:[],state:'ok'}]};
  cfgGrpRender();
  const q=(k)=>{ const d=document.querySelector('#tabCfg details[data-cfgg="'+k+'"]');
    return { open:d.open, n:d.querySelector('.cfggn').textContent.trim() }; };
  return { md:q('md'), rv:q('rv'), mdN:syncMdNeed().length, rvN:syncRvNeed().length };
});
console.log('   '+JSON.stringify(need));
ok(need.md.open===true&&/要対応 1件/.test(need.md.n),
   '★自動値下げの設定を送っていない行があれば印を出す');
ok(need.rv.open===true&&/要対応 1件/.test(need.rv.n),
   '★売値の自動反映の目標を送っていない行があれば印を出す');
const off=await p.evaluate(()=>{
  $('autoMdMode').value='off'; $('autoRvMode').value='off';
  cfgGrpRender();
  const q=(k)=>document.querySelector('#tabCfg details[data-cfgg="'+k+'"]')
    .querySelector('.cfggn').textContent.trim();
  return { md:q('md'), rv:q('rv') };
});
ok(!off.md&&!off.rv,'★オフのときは印を出さない');

console.log('\n=== 見出しをタップで開閉し、開閉を保存する ===');
const tap=async(k)=>{ await p.evaluate((k)=>{
    document.querySelector('#tabCfg details[data-cfgg="'+k+'"] summary').click();
  },k); await p.waitForTimeout(150); };
await tap('tune');
await tap('goal');
let saved=await p.evaluate(()=>localStorage.getItem('pj:cfggrp:v1')||'');
console.log('   保存: '+saved);
ok(/"tune":1/.test(saved)&&/"goal":0/.test(saved),
   '★開けたグループと畳んだグループを控える');
await p.reload(); await p.waitForTimeout(400);
g=await groups();
console.log('   開き直し: tune='+byKey(g,'tune').open+' / goal='+byKey(g,'goal').open);
ok(byKey(g,'tune').open===true&&byKey(g,'goal').open===false,
   '★★開き直しても、開いた／畳んだ状態がそのまま');

console.log('\n=== 説明は1行、詳しくは「?」 ===');
const q=await p.evaluate(()=>{
  const el=Array.from(document.querySelectorAll('#tabCfg .note2[data-q]'))
    .find(x=>/値下げ幅/.test(x.textContent));
  const all=document.querySelectorAll('#tabCfg .note2[data-q]').length;
  if(!el)return { all:all };
  const one=el.querySelector('.cfgq1'), d=el.querySelector('.cfgqd'),
        b=el.querySelector('.cfgqb');
  return { all:all, one:one.textContent, hidden:(d.style.display==='none'),
           btn:b.textContent, more:d.textContent.slice(0,30) };
});
console.log('   分けた説明: '+q.all+'件');
console.log('   1行: '+q.one+'　／　詳しく: '+q.more);
ok(q.all>=20,'★長い説明はまとめて「?」に入れる');
ok(q.one.length<=46&&/。$/.test(q.one),'★1行目は最初の1文だけ');
ok(q.hidden===true&&q.btn==='?','★詳しい説明は初期状態では出さない');
const open2=await p.evaluate(()=>{
  const el=Array.from(document.querySelectorAll('#tabCfg .note2[data-q]'))
    .find(x=>/値下げ幅/.test(x.textContent));
  el.querySelector('.cfgqb').click();
  const d=el.querySelector('.cfgqd');
  return { shown:(d.style.display!=='none'), btn:el.querySelector('.cfgqb').textContent };
});
console.log('   「?」を押したあと: '+JSON.stringify(open2));
ok(open2.shown===true&&open2.btn==='×','★「?」を押すと出て、×で閉じられる');
const dyn=await p.evaluate(()=>{
  // 中身を書き替える案内（id つき）は触らない
  return ['fxNote','csvChangedNote','autoMdCfgNote','autoRvCfgNote','cfgConnNote',
          'csvMarkCfgNote','autoNote','advSyncNote']
    .map(id=>({id:id,q:!!($(id)||{}).getAttribute&&!!$(id).getAttribute('data-q')}));
});
ok(dyn.every(x=>!x.q),'★画面が書き替える案内（fxNote など）はそのまま');

console.log('\n=== 値・保存先・動作は変えていない ===');
const keep=await p.evaluate(()=>{
  switchTab('G');
  document.querySelectorAll('#tabCfg details').forEach(d=>{ d.open=true; });
  $('baseProfit').value='2500'; $('baseProfit').dispatchEvent(new Event('input'));
  $('csvPackGame').value='70'; $('csvPackGame').dispatchEvent(new Event('input'));
  $('autoRvMax').value='80'; $('autoRvMax').dispatchEvent(new Event('input'));
  return { adv:JSON.parse(localStorage.getItem('pj:pricing:v1')||'{}').baseProfit,
           cfg:JSON.parse(localStorage.getItem('pj:csvcfg:v1')||'{}').csvPackGame,
           rv:JSON.parse(localStorage.getItem('pj:csvcfg:v1')||'{}').autoRvMax,
           /* 目標は計算機の仕入値欄（既定500円）から出る。式は変えていない。 */
           cost:+$('cost').value||0, target:autoTarget(),
           price:csvPriceFor(3000,200).price };
});
console.log('   '+JSON.stringify(keep));
ok(keep.adv==='2500','★値付けの目標は今までどおり pj:pricing:v1 に入る');
ok(keep.cfg==='70'&&keep.rv==='80','★出品CSV側の設定は今までどおり pj:csvcfg:v1 に入る');
ok(keep.target===2500+keep.cost*0.3&&keep.price>0,
   '★計算も今までどおり（目標＝下限利益＋仕入×連動率）');

await T.done();
})();
