/* 回帰：設定の保存・タブの開閉・価格計算が壊れていないか。
   1品ごとの値（仕入値・重量・請求送料）は保存しない決まりと、
   広告料率は**設定として保存する**（6.73 で直した）ことと、
   推奨売値の決まり（利益＝円式の目標）をここで見張る。 */
const { harness, ROOT } = require('./lib');
const T = harness('回帰：保存とタブ・価格計算');
const ok = T.ok;
const fs=require('fs');
(async()=>{
const p=await T.open();
await p.waitForTimeout(300);

console.log('=== どのタブも例外なく開く ===');
// タブは 出品CSV ― 販売連携 ― eBay ― Shopee。eBayの中は 値付け｜出品文
/* Shopee（tabC）はタブから外した（6.116）。ボタンは隠れているので、
   中身が今までどおり開くことは switchTab で確かめる。 */
for(const t of ['tabD','tabE','tabA','tabF','tabG']){
  await p.click('#'+t); await p.waitForTimeout(150);
}
await p.evaluate(()=>{ switchTab('C'); }); await p.waitForTimeout(150);
await p.evaluate(()=>{ switchTab('D'); }); await p.waitForTimeout(150);
await p.click('#tabA'); await p.waitForTimeout(150);
await p.click('#ebSubList'); await p.waitForTimeout(150);
await p.click('#ebSubPrice'); await p.waitForTimeout(150);
console.log('   pageerror: '+JSON.stringify(T.errs));
ok(T.errs.length===0,'★4つのタブ・⚙設定・eBay の中の切り替えを開いても例外が出ない');

console.log('\n=== 1品ごとの値は今も保存しない ===');
await p.click('#tabA'); await p.waitForTimeout(150);
await p.fill('#cost','3210'); await p.fill('#weight','345');
await p.fill('#adRate','7.5'); await p.fill('#shipCharge','12');
// 詳細設定（目標の決め方）は⚙設定画面にある
await p.click('#tabG'); await p.waitForTimeout(150);
await p.evaluate(()=>{ $('advBox').open=true; });
await p.fill('#baseProfit','2200');
await p.waitForTimeout(250);
const raw=await p.evaluate(()=>JSON.parse(localStorage.getItem('pj:pricing:v1')||'{}'));
console.log('   保存の中身: '+JSON.stringify(Object.keys(raw).filter(k=>
  /cost|weight|adRate|shipCharge|baseProfit|linkRate/.test(k))));
ok(raw.cost===undefined&&raw.weight===undefined&&raw.shipCharge===undefined,
   '★仕入値・重量・請求送料は保存しない（1品ごとの値）');
/* 広告料率は値付けの式に入る設定なので保存する（6.73）。
   以前は保存から外していて、開き直すと5.0%に戻っていた。 */
ok(raw.adRate==='7.5','★★広告料率は設定として保存する（6.73）');
ok(raw.baseProfit==='2200','★詳細設定だけ保存する');
await p.reload(); await p.waitForTimeout(400);
const after=await p.evaluate(()=>({cost:$('cost').value,weight:$('weight').value,
  adRate:$('adRate').value,base:$('baseProfit').value}));
console.log('   開き直し: '+JSON.stringify(after));
// HTML の既定値（仕入500・重量400）に戻り、打った値は残らない
ok(after.cost==='500'&&after.weight==='400',
   '★開き直すと1品ごとの値はHTMLの既定値に戻る');
ok(after.adRate==='7.5','★★広告料率は開き直しても残る（6.73）');
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
/* 直前の計算の節は欄に値を入れただけ（保存していない）なので、
   詳細設定を保存し直してから出品CSVタブの設定を触る。
   見直しのしきい値は pj-sync にも送る欄になった（6.47）ので、
   触ったときに詳細設定が巻き戻らないことをここで見張る。 */
await p.click('#tabG'); await p.waitForTimeout(150);
await p.evaluate(()=>{ $('advBox').open=true; });
await p.fill('#baseProfit','2200'); await p.waitForTimeout(250);
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

console.log('\n=== Worker の設定に仮の文字が残っていないか ===');
/* KV の id は秘密ではない（それだけでは誰も読めない。読み書きには
   アカウントの認証が要る）。リポジトリに入れておかないと、手元で
   書き換えるたびに git pull でぶつかる。 */
{
  const path2=require('path');
  const dirs=['proxy','proxy-img','proxy-title','proxy-sync'];
  const bad=[], kvs=[];
  for(const d of dirs){
    const f=path2.join(ROOT,d,'wrangler.toml');
    if(!fs.existsSync(f))continue;
    const t=fs.readFileSync(f,'utf8');
    /* コメント（#）の行は見ない。account_id の例はコメントのままで良い。 */
    const live=t.split('\n').filter((x)=>!/^\s*#/.test(x)).join('\n');
    if(/ここに|<your|YOUR_|xxxxxxxx/.test(live))bad.push(d);
    const m=live.match(/^\s*id\s*=\s*"([0-9a-f]{32})"/mg)||[];
    m.forEach((x)=>kvs.push(d+':'+(x.match(/"([0-9a-f]{32})"/)||[])[1]));
  }
  console.log('   KV: '+JSON.stringify(kvs));
  console.log('   仮のまま: '+JSON.stringify(bad));
  ok(bad.length===0,'★★★仮の文字（ここに…を入れる）が残っていない');
  const title=fs.readFileSync(path2.join(ROOT,'proxy-title','wrangler.toml'),'utf8');
  ok(/id = "28a081b66712442a8ca25b40167a2ef1"/.test(title),
     '★★pj-title の KV の id が入っている');
  const sync=fs.readFileSync(path2.join(ROOT,'proxy-sync','wrangler.toml'),'utf8');
  ok(/id = "[0-9a-f]{32}"/.test(sync),'★pj-sync の KV の id も入っている');
  /* 秘密は入っていないこと（トークン・パスワードの形） */
  for(const d of dirs){
    const f=path2.join(ROOT,d,'wrangler.toml');
    if(!fs.existsSync(f))continue;
    const t=fs.readFileSync(f,'utf8');
    ok(/\[vars\][\s\S]*(TOKEN|SECRET|PASSWORD|KEY)\s*=/.test(t)===false,
       '★★'+d+'：秘密を vars に書いていない（secret put で入れる）');
  }
}

await T.done();
})();
