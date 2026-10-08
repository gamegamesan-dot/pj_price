/* 回帰：設定の保存・タブの開閉・価格計算が壊れていないか。
   1品ごとの値（仕入値・重量・請求送料・広告料率）は保存しない決まりと、
   推奨売値の決まり（利益＝円式の目標）をここで見張る。 */
const { harness, ROOT } = require('./lib');
const T = harness('回帰：保存とタブ・価格計算');
const ok = T.ok;
const fs=require('fs');
(async()=>{
const p=await T.open();
await p.waitForTimeout(300);

console.log('=== どのタブも例外なく開く ===');
for(const t of ['tabA','tabB','tabC','tabD','tabE']){
  await p.click('#'+t); await p.waitForTimeout(150);
}
await p.click('#tabA'); await p.waitForTimeout(150);
console.log('   pageerror: '+JSON.stringify(T.errs));
ok(T.errs.length===0,'★5つのタブを開いても例外が出ない');

console.log('\n=== 1品ごとの値は今も保存しない ===');
await p.evaluate(()=>{ $('advBox').open=true; });
await p.fill('#cost','3210'); await p.fill('#weight','345');
await p.fill('#adRate','7.5'); await p.fill('#shipCharge','12');
await p.fill('#baseProfit','2200');
await p.waitForTimeout(250);
const raw=await p.evaluate(()=>JSON.parse(localStorage.getItem('pj:pricing:v1')||'{}'));
console.log('   保存の中身: '+JSON.stringify(Object.keys(raw).filter(k=>
  /cost|weight|adRate|shipCharge|baseProfit|linkRate/.test(k))));
ok(raw.cost===undefined&&raw.weight===undefined&&raw.shipCharge===undefined
   &&raw.adRate===undefined,'★仕入値・重量・請求送料・広告料率は保存しない（1品ごとの値）');
ok(raw.baseProfit==='2200','★詳細設定だけ保存する');
await p.reload(); await p.waitForTimeout(400);
const after=await p.evaluate(()=>({cost:$('cost').value,weight:$('weight').value,
  adRate:$('adRate').value,base:$('baseProfit').value}));
console.log('   開き直し: '+JSON.stringify(after));
// HTML の既定値（仕入500・重量400）に戻り、打った値は残らない
ok(after.cost==='500'&&after.weight==='400'&&after.adRate==='5.0',
   '★開き直すと1品ごとの値はHTMLの既定値・広告料率は5%');
ok(after.base==='2200','★詳細設定は残る');

console.log('\n=== 価格の計算は変わっていない ===');
/* 数字を書き写すと設定の違いで当てにならないので、計算の決まりそのものを見る。
   ・推奨売値で出る利益＝円式の目標（下限利益＋仕入×連動率）
   ・同じ設定なら、開き直しても同じ結果になる */
const setAdv=(o)=>p.evaluate((o)=>{
  Object.keys(o).forEach(k=>{ $(k).value=String(o[k]); });
  // autoTarget() は画面の仕入値を見るので、csvPriceFor に渡す値とそろえる
  $('cost').value='3000'; $('fx').value='160'; $('zone').value='2';
  const a=csvPriceFor(3000,200);
  return { price:a.price, profit:a.profit, target:autoTarget() };
},o);
const d1=await setAdv({baseProfit:'1000',linkRate:'30',saleRate:'15',usTaxRate:'8',
  targetMode:'auto'});
console.log('   既定の設定: '+JSON.stringify(d1));
ok(Math.abs(d1.profit-d1.target)<=1,'★推奨売値の利益＝円式の目標（1000＋3000×30%）');
const d2=await setAdv({baseProfit:'2500',linkRate:'45',saleRate:'15',usTaxRate:'8',
  targetMode:'auto'});
console.log('   変えた設定: '+JSON.stringify(d2));
ok(Math.abs(d2.profit-d2.target)<=1&&d2.target===2500+3000*0.45,
   '★設定を変えると目標も推奨売値も追いつく');
ok(d2.price>d1.price,'目標が上がれば推奨売値も上がる');
await p.reload(); await p.waitForTimeout(400);
const d3=await setAdv({baseProfit:'1000',linkRate:'30',saleRate:'15',usTaxRate:'8',
  targetMode:'auto'});
console.log('   開き直して同じ設定: '+JSON.stringify(d3));
ok(d3.price===d1.price,'★同じ設定なら開き直しても同じ推奨売値');

console.log('\n=== ほかのタブの設定は触っていない ===');
await p.click('#tabD'); await p.waitForTimeout(200);
await p.evaluate(()=>{
  $('csvPackGame').value='25'; $('csvPackGame').dispatchEvent(new Event('input'));
  $('csvReviewAbs').value='2'; $('csvReviewAbs').dispatchEvent(new Event('input'));
  csvSaveCfg();
});
await p.reload(); await p.waitForTimeout(400); await p.click('#tabD');
const cfg=await p.evaluate(()=>({pack:$('csvPackGame').value,abs:$('csvReviewAbs').value,
  base:$('baseProfit').value}));
console.log('   '+JSON.stringify(cfg));
ok(cfg.pack==='25'&&cfg.abs==='2','★出品CSVタブの設定もこれまでどおり残る');
ok(cfg.base==='2200','★eBayタブの詳細設定と混ざらない');

console.log('\n=== 版の番号 ===');
const sw=fs.readFileSync(require('path').join(ROOT,'sw.js'),'utf8');
const html=fs.readFileSync(require('path').join(ROOT,'index.html'),'utf8');
const a=(sw.match(/pj-pricing-(v\d+)/)||[])[1];
const c=(html.match(/var APP_V='(v\d+)'/)||[])[1];
console.log('   sw.js='+a+' / APP_V='+c);
ok(!!a&&a===c,'★sw.js と APP_V が同じ番号');

await T.done();
})();
