/* 画面：値付けの設定を pj-sync に送る（6.73）
   ・値付けの式が使う設定をぜんぶ送る（手数料・為替・既定重量・梱包マージン・
     チェック欄・値下げ幅など25項目）
   ・チェック欄は真偽値で送る／受け取ったら欄に入れて端末にも保存する
   ・触ると pj-sync に送る（少し待ってまとめて送る）
   ・広告料率（adRate）が端末に保存されるようになった（開き直しても戻らない）
   ・pj-sync が使っている為替を⚙設定に出す（この端末と見比べられる） */
const { harness, openCsvBoxes, clickCfg } = require('./lib');
const T = harness('画面：値付けの設定を pj-sync に送る');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

const setup=async(o)=>await p.evaluate((o)=>{
  localStorage.clear();
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  window.__put=[]; window.__fx=o.fx||{ok:true,rate:157.23,at:'2026-10-19T12:00:00Z',
    src:'https://open.er-api.com/v6/latest/USD',from:'api'};
  window.__get=o.get||null;
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(o2)=>Promise.resolve({ok:true,status:200,
      text:()=>Promise.resolve(JSON.stringify(o2)), json:()=>Promise.resolve(o2)});
    if(/\/whoami/.test(url))return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/fx/.test(url))return res(window.__fx);
    if(/\/settings/.test(url)){
      if(i&&i.method==='POST'){ window.__put.push(body);
        return res({ok:true,stored:true,at:body.at,settings:body.settings}); }
      return res(window.__get||{ok:true,at:'',settings:{}});
    }
    if(/\/status/.test(url))return res({counts:{},items:[],last_runs:[],sold_recent:[]});
    if(/er-api|frankfurter/.test(url))return Promise.reject(new Error('no net'));
    return real(u,i);
  };
  switchTab('G');
},o||{});

/* 送る中身（advGet）。欄を触らずに中身だけ見る。 */
const got=async()=>await p.evaluate(()=>advGet());

console.log('=== 値付けの式が使う設定をぜんぶ送る ===');
await setup({});
let g=await got();
console.log('   項目数: '+Object.keys(g).length);
const want=['targetMode','baseProfit','linkRate','saleRate','usTaxRate',
  'fx','fxc','fee','intlFee','adRate','feeTax','fixed','pack',
  'dutyShip','taxRefund','stampDisc','syncSkipAcc','csvReviewZero',
  'csvPackGame','csvPackFig','csvWeightCart','csvWeightLoose',
  'syncWeight','syncWeightGame','csvShipLoose','csvLooseAmz',
  'syncTol','syncSoldCut','csvMarkStep','csvMarkTimes'];
const miss=want.filter(function(k){ return !(k in g); });
console.log('   足りない: '+JSON.stringify(miss));
ok(miss.length===0,'★★値付けの式が読む設定がぜんぶ入っている');
ok(g.fx==='160'&&g.fee==='13.6'&&g.fixed==='0.40','★★手数料・為替を送る');
ok(g.adRate==='5.0','★★広告料率も送る');
ok(g.pack==='150'&&g.csvPackGame==='60'&&g.csvPackFig==='250','★梱包費とマージン');
ok(g.syncWeight==='400'&&g.syncWeightGame==='150'&&g.csvWeightCart==='50'
   &&g.csvWeightLoose==='200','★既定重量');
ok(g.syncTol==='200'&&g.csvLooseAmz==='80'&&g.csvShipLoose==='0','★最安グループと箱なし');
ok(g.csvMarkStep==='1'&&g.csvMarkTimes==='10','★値下げ幅と回数');
ok(!('cost' in g)&&!('weight' in g)&&!('shipCharge' in g),
   '★★1品ごとの値（仕入値・重量・請求送料）は送らない');

console.log('=== チェック欄は真偽値 ===');
ok(g.dutyShip===false&&g.taxRefund===false&&g.stampDisc===false,
   '★★チェックは true/false で送る');
ok(g.syncSkipAcc===true,'★★「可を除く」は既定でオン');
ok(g.csvReviewZero===false,'★「数量0も対象」は既定でオフ');

console.log('=== 触ると pj-sync に送る ===');
await setup({});
await p.evaluate(()=>{ $('fee').value='14.2';
  $('fee').dispatchEvent(new Event('input',{bubbles:true})); });
await p.waitForTimeout(1100);
let put=await p.evaluate(()=>window.__put);
console.log('   送った回数: '+put.length+' / fee='+(put[0]&&put[0].settings.fee));
ok(put.length===1&&put[0].settings.fee==='14.2','★★数値欄を触ると送る');
ok(!!put[0].at,'★変えた時刻も送る');
await p.evaluate(()=>{ window.__put=[];
  $('stampDisc').checked=true;
  $('stampDisc').dispatchEvent(new Event('change',{bubbles:true})); });
await p.waitForTimeout(1100);
put=await p.evaluate(()=>window.__put);
console.log('   チェック: '+JSON.stringify(put[0]&&put[0].settings.stampDisc));
ok(put.length===1&&put[0].settings.stampDisc===true,'★★チェック欄を触っても送る');
await p.evaluate(()=>{ window.__put=[];
  $('syncTol').value='300';
  $('syncTol').dispatchEvent(new Event('input',{bubbles:true})); });
await p.waitForTimeout(1100);
put=await p.evaluate(()=>window.__put);
ok(put.length===1&&put[0].settings.syncTol==='300',
   '★★販売連携タブの設定を触っても送る');

console.log('=== 受け取ったら欄に入れる ===');
await setup({get:{ok:true,at:'2026-10-19T23:00:00Z',settings:{
  fx:'151.40',fee:'14.5',adRate:'7.5',pack:'200',
  dutyShip:true,syncSkipAcc:false,csvReviewZero:true,
  syncWeight:'450',csvMarkStep:'2',syncTol:'250',
  targetMode:'auto',baseProfit:'1200',linkRate:'30',saleRate:'15',usTaxRate:'8'}}});
let adopt=await p.evaluate(()=>{
  return new Promise(function(done){
    advPull();
    setTimeout(function(){ done({ fx:$('fx').value, fee:$('fee').value,
      adRate:$('adRate').value, pack:$('pack').value,
      dutyShip:$('dutyShip').checked, skip:$('syncSkipAcc').checked,
      zero:$('csvReviewZero').checked, w:$('syncWeight').value,
      step:$('csvMarkStep').value, tol:$('syncTol').value,
      base:$('baseProfit').value,
      cfg:JSON.parse(localStorage.getItem('pj:csvcfg:v1')||'{}'),
      ui:JSON.parse(localStorage.getItem('pj:pricing:v1')||'{}') }); },400);
  });
});
console.log('   '+JSON.stringify({fx:adopt.fx,fee:adopt.fee,adRate:adopt.adRate,
  dutyShip:adopt.dutyShip,skip:adopt.skip,zero:adopt.zero,w:adopt.w}));
ok(adopt.fx==='151.40'&&adopt.fee==='14.5'&&adopt.pack==='200','★★数値欄に入る');
ok(adopt.adRate==='7.5','★★広告料率も入る');
ok(adopt.dutyShip===true&&adopt.skip===false&&adopt.zero===true,
   '★★チェック欄にも入る');
ok(adopt.w==='450'&&adopt.step==='2'&&adopt.tol==='250','★★販売連携側の設定も入る');
ok(adopt.base==='1200','★目標の決め方は今までどおり');
console.log('   端末の保存: csvcfg syncWeight='+adopt.cfg.syncWeight
  +' / ui fee='+adopt.ui.fee+' / ui dutyShip='+adopt.ui.dutyShip);
ok(adopt.cfg.syncWeight==='450'&&adopt.cfg.syncSkipAcc===false,
   '★★受け取った値を端末（csvcfg）にも保存する');
ok(adopt.ui.fee==='14.5'&&adopt.ui.dutyShip===true,
   '★★端末（ui）にも保存する');

console.log('=== 広告料率が開き直しても戻らない（6.73の不具合）===');
await setup({});
let kept=await p.evaluate(()=>{
  $('adRate').value='8.5';
  $('adRate').dispatchEvent(new Event('input',{bubbles:true}));
  const ui=JSON.parse(localStorage.getItem('pj:pricing:v1')||'{}');
  return { saved:ui.adRate, has:('adRate' in ui) };
});
console.log('   '+JSON.stringify(kept));
ok(kept.has&&kept.saved==='8.5','★★端末に保存される');
let back=await p.evaluate(()=>{ $('adRate').value='5.0'; load();
  return $('adRate').value; });
ok(back==='8.5','★★開き直しても戻らない（load で入る）');
let keep2=await p.evaluate(()=>{
  const ui=JSON.parse(localStorage.getItem('pj:pricing:v1')||'{}');
  return { cost:('cost' in ui), weight:('weight' in ui), ship:('shipCharge' in ui) };
});
ok(keep2.cost===false&&keep2.weight===false&&keep2.ship===false,
   '★1品ごとの値は今までどおり保存しない');

console.log('=== pj-sync が使っている為替を出す ===');
await setup({});
await p.evaluate(()=>{ $('fx').value='160'; fxEdited=true; });
let note=await p.evaluate(()=>{
  return new Promise(function(done){
    fxSyncShow(false);
    setTimeout(function(){ done($('fxSyncNote').textContent); },300);
  });
});
console.log('   '+note);
ok(/1ドル=157.23円/.test(note),'★★pj-sync の為替を出す');
ok(/自動取得/.test(note),'★★どこから採った値かを出す');
ok(/この端末は 160円/.test(note),'★★この端末の値と見比べられる');
ok(/%ちがいます/.test(note),'★★差が1%以上なら注意を出す');
// 既定値のままなら警告
note=await p.evaluate(()=>{
  window.__fx={ok:true,rate:160,at:'',src:'',from:'default'};
  return new Promise(function(done){
    fxSyncShow(true);
    setTimeout(function(){ done($('fxSyncNote').textContent); },300);
  });
});
console.log('   '+note.replace(/\n/g,' / '));
ok(/自動取得できていません/.test(note),'★★pj-sync が取れていないときは知らせる');
// 近い値なら注意を出さない
note=await p.evaluate(()=>{
  window.__fx={ok:true,rate:160.2,at:'',src:'x',from:'cache'};
  return new Promise(function(done){
    fxSyncShow(true);
    setTimeout(function(){ done($('fxSyncNote').textContent); },300);
  });
});
ok(/ほぼ同じ/.test(note)&&!/ちがいます/.test(note),'★差が小さければ注意を出さない');

console.log('=== 作業者のキー ===');
await setup({role:'staff'});
await p.evaluate(()=>roleCheck());
await p.waitForTimeout(250);
let st=await p.evaluate(()=>{
  switchTab('G');
  Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
    function(d){ if(!d.open){ d.setAttribute('data-cfgauto','1'); d.open=true; } });
  return { note:getComputedStyle($('fxSyncNote')).display,
           btn:getComputedStyle($('fxSyncGet')).display }; });
console.log('   '+JSON.stringify(st));
ok(st.note==='none'&&st.btn==='none','★★pj-sync の為替は作業者には出さない');

await T.done();
})();
