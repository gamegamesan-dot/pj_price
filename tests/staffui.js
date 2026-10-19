/* 作業者用のキーのときの画面（6.52）
   ・pj-sync の /whoami でどちらのキーかを聞き、端末に控える
   ・作業者のときは⚙設定の価格の欄（値付けの目標・自動値下げ・自動反映・相場・
     見直しのしきい値・手数料）と、価格を変えるボタンを出さない
   ・作業者だと分かる案内を⚙設定と販売連携タブに出す
   ・設定の送信（/settings）はしない。価格のボタンを無理に呼んでも止める
   ・管理者のときは今までどおり全部出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('作業者用のキーのときの画面');
const ok = T.ok;
(async()=>{
const p=await T.open();
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

/* /whoami の答えを差し替える。role を 'staff' / 'admin' / 'ng'（401）で切り替える。 */
const setup=async(role)=>await p.evaluate((role)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('autoMdMode').value='plan'; $('autoRvMode').value='confirm';
  window.__who=0; window.__settings=[]; window.__posts=[];
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(o,okk)=>Promise.resolve({ok:okk!==false,status:okk===false?401:200,
      text:()=>Promise.resolve(JSON.stringify(o)), json:()=>Promise.resolve(o)});
    if(/\/whoami/.test(url)){ window.__who++;
      if(role==='ng')return res({error:'unauthorized'},false);
      return res({ok:true,role:role,staff_key_set:true}); }
    if(/\/settings/.test(url)){
      if(i&&i.method==='POST'){ window.__settings.push(body);
        return res({ok:true,stored:true,at:body.at,settings:body.settings}); }
      return res({ok:true,at:'',settings:{}}); }
    if(/\/listings/.test(url)){ window.__posts.push(body.items);
      return res({accepted:(body.items||[]).length,rejected:0}); }
    if(/\/sync/.test(url))return res({changed:0});
    return real(u,i);
  };
  const old=new Date(Date.now()-5*86400000).toISOString();
  syncData={at:new Date().toISOString(),counts:{},items:[{asin:'B0STF00001',cond:'used',
    scope:'ebay',prefix:'game',ebay_sku:'E-B0STF00001-U',ebay_item_id:'881234',ebay_qty:1,
    ebay_price:90,title:'テスト商品',cost_yen:1200,weight_g:150,one_off:0,dropship:0,
    restocking:0,mark_at:old,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,
    ebay_sale:null,md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,
    amazon_lowest:9000,amazon_offers_json:JSON.stringify([{p:9000,c:'used'}]),
    sold_usd:null,fba_available:1,fba_inbound:0,fba_reserved:0,
    warnings:[],notes:[],state:'ok'}]};
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E'); syncRender();
  roleCheck();
},role);
const view=async()=>await p.evaluate(()=>{
  /* 畳んである欄の中にあるものも測れるように、先に開く
     （⚙設定のグループは「開いた」と覚えさせない）。 */
  ['syncMoreBox','syncPriceBox'].forEach(function(id){
    var el=$(id); if(el)el.open=true; });
  Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
    function(d){ if(!d.open){ d.setAttribute('data-cfgauto','1'); d.open=true; } });
  /* 画面に出ているか。親が隠れている場合も「出ていない」と見る。 */
  const vis=(sel)=>{ const el=document.querySelector(sel);
    if(!el)return null; return el.getClientRects().length>0; };
  const grp=(k)=>{ const d=document.querySelector('#tabCfg details[data-cfgg="'+k+'"]');
    return d?getComputedStyle(d.parentNode).display!=='none':null; };
  /* ⚙設定の中は、設定画面を出しているあいだに測る。 */
  switchTab('G');
  const g={ goal:grp('goal'), md:grp('md'), rv:grp('rv'), sold:grp('sold'),
            tune:grp('tune'), fee:grp('fee'), conn:grp('conn'), list:grp('list'),
            policy:grp('policy'), ops:grp('ops'), man:grp('man'), ui:grp('ui') };
  const cfgNote=vis('#tabCfg .staffonly');
  const price=vis('.cfgprice');
  const revPrice=vis('#csvRevisePrice');
  /* 再調達CSVは絞り込みが「FBAで売れた（対応予定）」のときだけ出る欄なので
     （6.71）、そこに合わせたうえで（作業者では出ないことを）見る。 */
  switchTab('E');
  syncFilterSet('pbplan');
  const restock=vis('#syncRestockBox');
  if($('syncFilter').querySelector('option[value="all"]'))$('syncFilter').value='all';
  syncRender();
  ['syncMoreBox','syncPriceBox'].forEach(function(id){
    var el=$(id); if(el)el.open=true; });
  return { role:syncRole, staff:isStaff(), body:document.body.className,
    g:g, cfgNote:cfgNote, price:price, revPrice:revPrice, restock:restock,
    syncNote:vis('#tabSync .staffonly'),
    priceBox:vis('#syncPriceBox'),
    onhand:vis('#syncOnHandFix'),
    barRev:vis('#syncBarRev'), barFloor:vis('#syncBarFloor'),
    load:vis('#syncLoad'), push:vis('#syncPush'),
    saved:localStorage.getItem('pj:role:v1')||'' };
});

console.log('=== 管理者のキー（今までどおり）===');
await setup('admin');
await p.waitForTimeout(300);
let v=await view();
console.log('   '+JSON.stringify({role:v.role,body:v.body,priceBox:v.priceBox,
  goal:v.g.goal,md:v.g.md,fee:v.g.fee}));
ok(v.role==='admin'&&v.staff===false&&!/staff/.test(v.body),'★role=admin');
ok(v.g.goal&&v.g.md&&v.g.rv&&v.g.sold&&v.g.tune&&v.g.fee,
   '★⚙設定の価格の欄はぜんぶ出る');
console.log('   '+JSON.stringify({priceBox:v.priceBox,onhand:v.onhand,
  revPrice:v.revPrice,restock:v.restock}));
ok(v.priceBox&&v.onhand&&v.revPrice&&v.restock,
   '★価格の操作・再調達CSV・手元在庫の付け直し・「売値も含める」も出る');
ok(v.cfgNote===false&&v.syncNote===false,'★作業者用の案内は出さない');

console.log('\n=== 作業者のキー ===');
await setup('staff');
await p.waitForTimeout(300);
v=await view();
console.log('   '+JSON.stringify({role:v.role,body:v.body,saved:v.saved}));
console.log('   グループ: '+JSON.stringify(v.g));
ok(v.role==='staff'&&v.staff===true&&/staff/.test(v.body),
   '★★/whoami の答えで作業者だと分かる');
ok(v.saved==='staff','★どちらのキーかを端末に控える');
ok(v.g.goal===false&&v.g.md===false&&v.g.rv===false&&v.g.sold===false
   &&v.g.tune===false&&v.g.fee===false,
   '★★⚙設定の価格の欄（目標・自動値下げ・自動反映・相場・しきい値・手数料）を出さない');
ok(v.g.conn&&v.g.list&&v.g.policy&&v.g.ops&&v.g.man&&v.g.ui,
   '★価格でない設定（接続・原産国・ポリシー・操作・マニュアル・画面）は出す');
ok(v.priceBox===false&&v.restock===false&&v.revPrice===false,
   '★★価格の操作・再調達CSV・「売値も含める」を出さない');
ok(v.onhand===false,'★手動実行になる操作（手元在庫の付け直し）も出さない');
ok(v.load===true&&v.push===true,
   '★「状況を取り込む」と「名簿を送る」は出す（作業者の仕事）');
ok(v.cfgNote===true&&v.syncNote===true,'★★作業者用のキーだと分かる案内を出す');
const bar=await p.evaluate(()=>{
  syncPick['B0STF00001|used']=true; syncRender(); syncBarRender();
  const vis=(id)=>{ const el=$(id); return el?el.getClientRects().length>0:null; };
  return { bar:vis('syncBar'), rev:vis('syncBarRev'), floor:vis('syncBarFloor'),
           mark:vis('syncBarMarkBtn'), clear:vis('syncBarClear') };
});
console.log('   操作バー: '+JSON.stringify(bar));
ok(bar.rev===false&&bar.floor===false&&bar.mark===false,
   '★★選んだ行の操作バーからも価格のボタンを外す');
ok(bar.clear===true,'★価格でないボタン（選択を外す）は残す');

console.log('\n=== 作業者では設定を送らない・価格のボタンは止める ===');
const sent=await p.evaluate(()=>{
  window.__settings=[];
  $('baseProfit').value='2500'; $('baseProfit').dispatchEvent(new Event('input'));
  advPush();
  return { settings:window.__settings.length, note:$('advSyncNote').textContent };
});
console.log('   '+JSON.stringify(sent));
ok(sent.settings===0&&/作業者用のキー/.test(sent.note),
   '★★設定（/settings）は送らない（この端末だけに保存する）');
const deny=await p.evaluate(()=>{
  window.__posts=[];
  const out={};
  syncMdSend();  out.md=$('syncMdNote').textContent;
  syncRvSend();  out.rv=$('syncRvDone').textContent;
  syncRvGo();    out.go=$('syncRvDone').textContent;
  syncRevRun();  out.rev=$('syncPriceNote').textContent;
  syncFloorRun();out.floor=$('syncFloorNote').textContent;
  syncMarkRun(); out.mark=$('syncMarkNote').textContent;
  out.posts=window.__posts.length;
  return out;
});
console.log('   '+JSON.stringify(deny));
ok(deny.posts===0,'★★価格のボタンを直に呼んでも送らない');
ok(/価格の設定を送れません/.test(deny.md)&&/価格の設定を送れません/.test(deny.rv)
   &&/価格の設定を送れません/.test(deny.rev)&&/価格の設定を送れません/.test(deny.floor)
   &&/価格の設定を送れません/.test(deny.mark),'★断った理由を出す');

console.log('\n=== 作業者の仕事はできる ===');
const work=await p.evaluate(()=>{
  window.__posts=[];
  csvList=[{id:'s1',src:'sedori',sku:'game-20260101-UG-B0STF00009-1200',
    asin:'B0STF00009',jan:'4900009',titleJa:'テスト商品（未出品）',
    titleEn:'Used Nintendo Switch Test Item Japan Import',cat:'139973',catFixed:true,
    condId:5000,condSrc:'良い',cost:1200,qty:1,weight:150,pics:[{url:'u1'}],
    descHtml:'<p>d</p>',specs:{origin:'Japan',platform:'Nintendo Switch',gameName:'T'},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',sold:'',amzLow:'',dropship:false,
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false}];
  csvList.forEach(csvRecalc); csvSaveList();
  syncPushRun();
  const sp=csvExportSplit(null);
  return { csv:sp.rows.length, bad:sp.bad.map(x=>x.why),
           done:sp.done.map(x=>x.why), issues:csvIssues(csvList[0]) };
});
await p.waitForTimeout(400);
const pushed=await p.evaluate(()=>({posts:window.__posts.length,
  note:$('syncPushNote').textContent,
  keys:Object.keys((window.__posts[0]||[{}])[0]||{})}));
console.log('   名簿: '+JSON.stringify(pushed.posts)+'件送信／'+pushed.note.slice(0,40));
ok(pushed.posts===1&&/名簿を送りました/.test(pushed.note),'★名簿の送信はできる');
ok(pushed.keys.indexOf('md_step')<0&&pushed.keys.indexOf('rv_want')<0,
   '★★名簿には価格の設定（md_*・rv_*）を入れない（Worker が 403 にする項目）');
console.log('   書き出し: '+JSON.stringify(work));
ok(work.csv===1,'★出品CSVの書き出しもできる');

console.log('\n=== /whoami が答えないときは今までどおり ===');
await p.evaluate(()=>{ localStorage.removeItem('pj:role:v1'); });
await p.reload(); await p.waitForTimeout(300);
await setup('ng');
await p.waitForTimeout(300);
v=await view();
console.log('   '+JSON.stringify({role:v.role,priceBox:v.priceBox,goal:v.g.goal}));
ok(v.role==='admin'&&v.priceBox===true&&v.g.goal===true,
   '★聞けないときは管理者として出す（押しても Worker が 403 で断る）');

console.log('\n=== 控えがあれば開いた直後から隠す ===');
await p.evaluate(()=>{ localStorage.setItem('pj:role:v1','staff'); });
await p.reload(); await p.waitForTimeout(400);
const boot=await p.evaluate(()=>({ body:document.body.className, staff:isStaff(),
  priceBox:$('syncPriceBox').getClientRects().length>0 }));
console.log('   '+JSON.stringify(boot));
ok(/staff/.test(boot.body)&&boot.staff===true&&boot.priceBox===false,
   '★★前回が作業者なら、開いた直後から価格の操作を出さない');

await T.done();
})();
