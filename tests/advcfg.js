/* eBayタブ：詳細設定（目標の決め方）を保存して、開き直しても残す */
const { harness, ROOT } = require('./lib');
const T = harness('eBayタブ：詳細設定（目標の決め方）の保存');
const ok = T.ok;
const ADV=['targetMode','baseProfit','linkRate','saleRate','usTaxRate'];
(async()=>{
const p=await T.open();
/* 詳細設定は eBayタブ（値付け）の中にあり、欄は既定で畳まれている。
   開いたときのタブは「出品CSV」なので、触る前に eBayタブを開いて欄も開く。 */
const show=async()=>{ await p.evaluate(()=>{ switchTab('A');
  var d=$('advBox'); if(d)d.open=true; });
  await p.waitForTimeout(120); };
await show();
const vals=()=>p.evaluate((ids)=>{
  const o={}; ids.forEach(id=>o[id]=$(id).value); o.at=advAt; return o; },ADV);

console.log('=== 既定値 ===');
let v=await vals();
console.log('   '+JSON.stringify(v));
ok(v.baseProfit==='1000'&&v.linkRate==='30'&&v.saleRate==='15'&&v.usTaxRate==='8'
   &&v.targetMode==='auto','はじめは既定値（下限利益1000円・連動率30%）');
ok(v.at==='','まだ変えていないので時刻は空');

console.log('\n=== 変えて開き直す ===');
await p.fill('#baseProfit','2500');
await p.fill('#linkRate','45');
await p.fill('#saleRate','20');
await p.fill('#usTaxRate','9.5');
await p.selectOption('#targetMode','rate');
await p.waitForTimeout(200);
const saved=await p.evaluate(()=>localStorage.getItem('pj:pricing:v1'));
console.log('   保存: '+JSON.stringify(JSON.parse(saved).baseProfit)+' / at='
  +(JSON.parse(saved).advAt||'').slice(0,19));
ok(/"baseProfit":"2500"/.test(saved)&&/"linkRate":"45"/.test(saved)
   &&/"targetMode":"rate"/.test(saved),'★端末（localStorage）に入る');
ok(!!JSON.parse(saved).advAt,'★変えた時刻も控える');
await p.reload(); await p.waitForTimeout(400); await show();
v=await vals();
console.log('   開き直し: '+JSON.stringify(v));
ok(v.baseProfit==='2500'&&v.linkRate==='45'&&v.saleRate==='20'&&v.usTaxRate==='9.5'
   &&v.targetMode==='rate','★開き直しても変更後の値で始まる');
ok(await p.textContent('#autoNote')==='既定値から変更中','「既定値から変更中」も出る');

console.log('\n=== 保存した設定で計算される（v116 の売値の見直し）===');
const calcd=await p.evaluate(()=>{
  $('cost').value='3000'; $('weight').value='200'; $('fx').value='160';
  $('cost').dispatchEvent(new Event('input')); $('weight').dispatchEvent(new Event('input'));
  const p1=csvPriceFor(3000,200);
  return { base:+$('baseProfit').value, link:+$('linkRate').value,
           price:p1.price, target:autoTarget() };
});
console.log('   '+JSON.stringify(calcd));
ok(calcd.base===2500&&calcd.link===45,'★計算に使う設定が保存値のまま');
ok(calcd.target===2500+3000*0.45,'★円式の目標 ＝ 下限利益 ＋ 仕入 × 連動率（保存値）');
// 既定値（1000・30%）だと目標が下がって推奨売値も下がる＝見直しの対象が変わってしまう
const def=await p.evaluate(()=>{
  const keep={b:$('baseProfit').value,l:$('linkRate').value};
  $('baseProfit').value='1000'; $('linkRate').value='30';
  const p2=csvPriceFor(3000,200).price;
  $('baseProfit').value=keep.b; $('linkRate').value=keep.l;
  return p2;
});
console.log('   既定値なら '+def+' / 保存値なら '+calcd.price);
ok(def<calcd.price,'★既定値に戻ると推奨売値が変わる（だから保存が要る）');
// 「売値の見直し」が保存した設定で判定しているか
const rev=await p.evaluate(()=>{
  $('csvShipProfile').value='W1000'; $('csvRetProfile').value='R'; $('csvPayProfile').value='P';
  $('csvLocation').value='Tokyo';
  csvList=[{id:'a1',sku:'game-20260101-UG-B07571RH4P-3000',asin:'B07571RH4P',jan:'4901',
    titleJa:'見直しの行',titleEn:'Used Nintendo Switch Item Japan Import',cat:'139973',
    condId:5000,price:0,qty:1,floor:0,cost:3000,weight:200,pics:[{url:'u'}],
    descHtml:'<p>d</p>',specs:{origin:'Japan'},zeroAct:'hold',fba:true,oneOff:false,
    // eBayに出している売値（しきい値を超える差があるので見直しの対象になる）
    itemId:'110001',priceSent:45}];
  csvPick={}; csvSaveList(); csvRender();
  const r=csvRowById('a1');
  return { price:r.price, want:csvWantPrice(r),
           review:csvPriceReview(r), note:$('csvChangedNote').textContent };
});
console.log('   '+JSON.stringify({price:rev.price,want:rev.want,review:rev.review}));
ok(rev.want===calcd.price,'★見直しの新しい売値も保存した設定で出る');
ok(rev.review&&Math.abs(rev.review.next-calcd.price)<0.01&&rev.review.now===45,
   '★「売値の見直し」の行も保存値で判定する（$45.00 → '+calcd.price+'）');
ok(/いま 1件/.test(rev.note),'件数の案内にも出る');

console.log('\n=== 初期値に戻す ===');
await p.click('#resetAuto'); await p.waitForTimeout(200);
v=await vals();
console.log('   '+JSON.stringify(v));
ok(v.baseProfit==='1000'&&v.linkRate==='30'&&v.saleRate==='15'&&v.usTaxRate==='8'
   &&v.targetMode==='auto','★押すと既定値に戻る');
ok(await p.textContent('#autoNote')==='','「既定値から変更中」が消える');
await p.reload(); await p.waitForTimeout(400); await show();
v=await vals();
console.log('   開き直し: '+JSON.stringify(v));
ok(v.baseProfit==='1000'&&v.linkRate==='30'&&v.targetMode==='auto',
   '★戻した状態も保存される（開き直しても既定値）');

console.log('\n=== pj-sync（D1）と突き合わせる ===');
// 別の端末であとから変えた設定が D1 にあるとき
await p.evaluate(()=>{
  const cfg=JSON.parse(localStorage.getItem('pj:csvcfg:v1')||'{}');
  cfg.syncApi='https://pj-sync.example.workers.dev'; cfg.syncKey='k';
  localStorage.setItem('pj:csvcfg:v1',JSON.stringify(cfg));
  const px=JSON.parse(localStorage.getItem('pj:pricing:v1')||'{}');
  px.baseProfit='1200'; px.linkRate='31'; px.advAt='2026-10-08T01:00:00.000Z';
  localStorage.setItem('pj:pricing:v1',JSON.stringify(px));
});
const calls=[];
await p.addInitScript(()=>{
  window.__calls=[];
  const real=window.fetch;
  window.fetch=function(u,o){
    const url=String(u);
    if(/\/settings/.test(url)){
      window.__calls.push({m:(o&&o.method)||'GET',body:o&&o.body});
      if(!o||o.method!=='POST')return Promise.resolve({ok:true,json:()=>Promise.resolve(
        {ok:true,at:'2026-10-08T05:00:00.000Z',
         settings:{targetMode:'yen',baseProfit:'4000',linkRate:'50',
                   saleRate:'18',usTaxRate:'7'}})});
      return Promise.resolve({ok:true,json:()=>Promise.resolve({ok:true,stored:true})});
    }
    return real(u,o);
  };
});
await p.reload(); await p.waitForTimeout(700); await show();
v=await vals();
console.log('   '+JSON.stringify(v));
console.log('   呼び出し: '+JSON.stringify(await p.evaluate(()=>window.__calls)));
ok(v.baseProfit==='4000'&&v.linkRate==='50'&&v.saleRate==='18'&&v.usTaxRate==='7'
   &&v.targetMode==='yen','★D1 のほうが新しければ、その値に合わせる（別の端末と同じになる）');
ok(v.at==='2026-10-08T05:00:00.000Z','★時刻も D1 のものを引き継ぐ');
ok(/ほかの端末で変えた設定に合わせました/.test(await p.textContent('#advSyncNote')),
   '★そう知らせる');
await p.reload(); await p.waitForTimeout(700); await show();
ok((await vals()).baseProfit==='4000','★合わせた値は端末にも保存される');

console.log('\n=== 端末のほうが新しいときは pj-sync に送る ===');
await p.evaluate(()=>{ window.__calls.length=0; });
await p.fill('#baseProfit','5000'); await p.waitForTimeout(1200);
const sent=await p.evaluate(()=>window.__calls.filter(x=>x.m==='POST'));
console.log('   '+JSON.stringify(sent));
ok(sent.length===1,'★変えたら1回だけ送る（打つたびには送らない）');
const bd=JSON.parse(sent[0].body);
ok(bd.settings.baseProfit==='5000'&&bd.settings.linkRate==='50','★いまの値を送る');
ok(bd.at>'2026-10-08T05:00:00.000Z','★送る時刻は D1 のものより新しい');
ok(/pj-sync にも保存しました/.test(await p.textContent('#advSyncNote')),'★そう知らせる');

console.log('\n=== 送ろうとしたら D1 にもっと新しい設定があった ===');
await p.addInitScript(()=>{
  window.__calls2=[];
  const real=window.fetch;
  window.fetch=function(u,o){
    const url=String(u);
    if(/\/settings/.test(url)){
      window.__calls2.push({m:(o&&o.method)||'GET'});
      if(!o||o.method!=='POST')return Promise.resolve({ok:true,json:()=>Promise.resolve(
        {ok:true,at:'',settings:{}})});
      // 別の端末があとから変えていた（書き込みは退けられ、そちらの設定が返る）
      return Promise.resolve({ok:true,json:()=>Promise.resolve({ok:true,stored:false,
        at:'2099-01-01T00:00:00.000Z',
        settings:{targetMode:'auto',baseProfit:'7777',linkRate:'33',
                  saleRate:'15',usTaxRate:'8'}})});
    }
    return real(u,o);
  };
});
await p.reload(); await p.waitForTimeout(500); await show();
await p.fill('#linkRate','40'); await p.waitForTimeout(1200);
v=await vals();
console.log('   '+JSON.stringify(v));
ok(v.baseProfit==='7777'&&v.linkRate==='33','★退けられたら、D1 の新しい設定に合わせる');
ok(v.at==='2099-01-01T00:00:00.000Z','その時刻も引き継ぐ');

console.log('\n=== pj-sync に届かなくても止まらない ===');
await p.addInitScript(()=>{
  const real=window.fetch;
  window.fetch=function(u,o){
    if(/\/settings/.test(String(u)))return Promise.reject(new Error('offline'));
    return real(u,o);
  };
});
await p.reload(); await p.waitForTimeout(500); await show();
await p.fill('#saleRate','22'); await p.waitForTimeout(1200);
v=await vals();
console.log('   '+JSON.stringify(v)+' / note='+await p.textContent('#advSyncNote'));
ok(v.saleRate==='22','★端末の値はそのまま使える');
ok(/この端末だけに保存しました/.test(await p.textContent('#advSyncNote')),'★そう知らせる');
await p.reload(); await p.waitForTimeout(500); await show();
ok((await vals()).saleRate==='22','★開き直しても残る');

console.log('\n=== pj-sync を設定していない端末 ===');
await p.evaluate(()=>{
  const cfg=JSON.parse(localStorage.getItem('pj:csvcfg:v1')||'{}');
  cfg.syncApi=''; cfg.syncKey='';
  localStorage.setItem('pj:csvcfg:v1',JSON.stringify(cfg));
});
await p.reload(); await p.waitForTimeout(400); await show();
await p.fill('#usTaxRate','6'); await p.waitForTimeout(1000);
await p.reload(); await p.waitForTimeout(400); await show();
v=await vals();
console.log('   '+JSON.stringify(v));
ok(v.usTaxRate==='6','★URL・キーが無くても端末には保存される');

await T.done();
})();
