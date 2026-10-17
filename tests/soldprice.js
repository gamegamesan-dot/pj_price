/* 出品CSVタブ：相場の値段で出す（6.54）
   ・行のボタンで「売値：目標利益／相場」を切り替える（初期は目標利益）
   ・相場で出す売値 ＝ 相場（総額$） − その行の請求送料
   ・相場が未入力の行は「相場」を選べない
   ・相場の売値が最低売値を下回るときは、赤で知らせて最低売値で出す
   ・利益・利益率・書き出すCSVの売値も切り替えた売値で計算する
   ・操作のところの「選んだ行を相場で出す」でまとめて切り替えられる */
const { harness, openCsvBoxes, openRowDet } = require('./lib');
const T = harness('出品CSVタブ：相場の値段で出す');
const ok = T.ok;
(async()=>{
const p=await T.open();
const fs=require('fs');
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
const dl=[]; p.on('download',async d=>dl.push({name:d.suggestedFilename(),
  text:fs.readFileSync(await d.path(),'utf8')}));

/* 仕入値1,200円・150g の行を3つ。
   s1 … 相場 $110（送料を引いても最低売値より上）
   s2 … 相場 $40（送料を引くと最低売値を下回る）
   s3 … 相場なし */
const setup=async()=>await p.evaluate(()=>{
  $('fx').value='160'; $('zone').value='2'; $('baseProfit').value='1000';
  $('linkRate').value='30'; $('saleRate').value='15'; $('usTaxRate').value='8';
  $('targetMode').value='auto'; $('csvStartMode').value='cost';
  $('csvShipProfile').value='W1000'; $('csvRetProfile').value='R';
  $('csvPayProfile').value='P'; $('csvLocation').value='Tokyo';
  const row=(id,sold)=>({id:id,src:'sedori',sku:'game-20260101-UG-B0SP0000'+id.slice(1)+'-1200',
    asin:'B0SP0000'+id.slice(1),jan:'49000'+id.slice(1),titleJa:'商品'+id,
    titleEn:'Used Nintendo Switch Item '+id+' Japan Import',cat:'139973',catFixed:true,
    condId:5000,condSrc:'良い',cost:1200,qty:1,weight:150,pics:[{url:'u'}],
    descHtml:'<p>d</p>',specs:{origin:'Japan',platform:'Nintendo Switch',gameName:'G'+id},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',sold:sold,amzLow:'',dropship:false,
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false});
  csvList=[row('s1','110'),row('s2','40'),row('s3','')];
  csvPick={}; syncData=null;
  csvList.forEach(csvRecalc); csvSaveList();
  switchTab('D'); csvRender(); $('csvListBox').open=true;
  const r1=csvRowById('s1');
  return { price:r1.price, floor:r1.floor, ship:csvShipCharge(r1) };
});
const row=async(id)=>await p.evaluate((id)=>{
  const r=csvRowById(id);
  const card=document.querySelector('#csvList [data-row="'+id+'"]');
  const btn=card.querySelector('[data-pmode="'+id+'"]');
  const note=card.querySelector('[data-smode="'+id+'"]');
  const bar=card.querySelector('[data-money="'+id+'"]');
  return { mode:r.priceMode||'', sold:csvSoldMode(r), start:csvStartPrice(r),
    soldPrice:csvSoldPrice(r), floor:+r.floor||0, price:+r.price||0,
    btn:btn.textContent, dis:btn.disabled,
    note:note?note.innerText.replace(/\s+/g,' ').trim():'',
    red:note&&note.firstChild?/var\(--bad\)|rgb\(192, 57, 43\)/.test(
      (note.firstChild.getAttribute&&note.firstChild.getAttribute('style'))||''):false,
    bar:bar.innerText.replace(/\n/g,' | '),
    out:csvRowFor(r)['*StartPrice'],
    profit:csvProfitAt(csvCostOf(r),r.weight,csvStartPrice(r),csvFlatOf(r)) };
},id);

console.log('=== はじめは「目標利益」（今までどおり）===');
const base=await setup();
console.log('   目標利益の売値 $'+base.price+'／最低売値 $'+base.floor
  +'／この行の請求送料 $'+base.ship);
let a=await row('s1');
console.log('   '+JSON.stringify({mode:a.mode,start:a.start,btn:a.btn}));
ok(a.mode===''&&a.sold===false,'★初期値は「目標利益」');
ok(a.start===base.price&&a.out===base.price.toFixed(2),
   '★売値も書き出すCSVも今までどおり（目標利益の売値）');
ok(/売値：目標利益/.test(a.btn)&&a.dis===false,'★ボタンに「売値：目標利益」と出す');
ok(a.note==='','★相場の案内は出さない');

console.log('\n=== 「相場」にすると 相場 − 送料 の値段になる ===');
await p.click('#csvList [data-pmode="s1"]');
await p.waitForTimeout(200);
a=await row('s1');
console.log('   '+JSON.stringify({start:a.start,soldPrice:a.soldPrice,out:a.out}));
console.log('   案内: '+a.note);
console.log('   帯: '+a.bar);
ok(a.sold===true&&/売値：相場/.test(a.btn),'★ボタンが「売値：相場」になる');
ok(a.soldPrice===Math.round((110-base.ship)*100)/100,
   '★★売値 ＝ 相場 $110.00 − 送料 $'+base.ship.toFixed(2)
   +' ＝ $'+(110-base.ship).toFixed(2));
ok(a.start===a.soldPrice,'★行の売値がその値になる');
ok(a.out===a.soldPrice.toFixed(2),'★★書き出すCSVの *StartPrice も同じ値');
ok(/相場で出す/.test(a.note)&&/\$110\.00 − 送料/.test(a.note)
   &&/目標利益なら \$/.test(a.note),'★計算の中身を1行で出す');
ok(/\$95\.00/.test(a.bar)&&/相場/.test(a.bar),'★帯の売値も入れ替わり「相場」と出る');
const prof=await p.evaluate(()=>{
  const r=csvRowById('s1');
  return { now:csvProfitAt(csvCostOf(r),r.weight,csvStartPrice(r),csvFlatOf(r)),
    target:csvProfitAt(csvCostOf(r),r.weight,+r.price||0,csvFlatOf(r)) };
});
console.log('   利益: 相場 '+prof.now+'円／目標利益のとき '+prof.target+'円');
ok(prof.now>prof.target,'★★利益も切り替え後の売値で計算する');
ok(/利益率 \d+\.\d%/.test(a.bar),'★利益率も帯に出る（同じ売値から）');

console.log('\n=== 相場が最低売値を下回る行は、赤で知らせて最低売値で出す ===');
await p.click('#csvList [data-pmode="s2"]');
await p.waitForTimeout(200);
let b=await row('s2');
console.log('   '+JSON.stringify({soldPrice:b.soldPrice,floor:b.floor,start:b.start,
  out:b.out}));
console.log('   案内: '+b.note);
ok(b.soldPrice<b.floor,'相場の売値（$40 − 送料）は最低売値より下');
ok(b.start===b.floor&&b.out===b.floor.toFixed(2),
   '★★売値も書き出すCSVも最低売値にする');
ok(b.red===true&&/最低売値 \$[\d.]+ を下回る/.test(b.note)
   &&/最低売値で出します/.test(b.note),'★★赤で警告を出す');
ok(/最低売値/.test(b.bar),'★帯の売値にも「最低売値」と出る');

console.log('\n=== 相場が未入力の行は「相場」を選べない ===');
let c=await row('s3');
console.log('   '+JSON.stringify({btn:c.btn,dis:c.dis,soldPrice:c.soldPrice}));
ok(c.dis===true&&/相場が未入力/.test(c.btn),'★★ボタンを押せない（理由も出す）');
const forced=await p.evaluate(()=>{
  const r=csvRowById('s3');
  r.priceMode='sold';                       // 無理に指定しても
  return { sold:csvSoldMode(r), start:csvStartPrice(r), price:+r.price||0 };
});
console.log('   '+JSON.stringify(forced));
ok(forced.sold===false&&forced.start===forced.price,
   '★指定が残っていても、相場が無ければ目標利益の売値で出す');

console.log('\n=== 相場を消したら目標利益に戻る ===');
const cleared=await p.evaluate(()=>{
  const r=csvRowById('s1');
  r.sold=''; csvRecalc(r); csvRender();
  return { sold:csvSoldMode(r), start:csvStartPrice(r), price:+r.price||0,
    btn:document.querySelector('#csvList [data-pmode="s1"]').textContent };
});
console.log('   '+JSON.stringify(cleared));
ok(cleared.sold===false&&cleared.start===cleared.price&&/目標利益/.test(cleared.btn),
   '★相場を消すと目標利益の売値に戻る');
await p.evaluate(()=>{ const r=csvRowById('s1'); r.sold='110'; csvRecalc(r); csvRender(); });

console.log('\n=== 開き直しても残る ===');
await p.reload(); await p.waitForTimeout(400);
await p.evaluate(()=>{ switchTab('D'); $('csvListBox').open=true; csvRender(); });
const kept=await p.evaluate(()=>({
  s1:(csvRowById('s1')||{}).priceMode, s2:(csvRowById('s2')||{}).priceMode,
  start:csvStartPrice(csvRowById('s1')) }));
console.log('   '+JSON.stringify(kept));
ok(kept.s1==='sold'&&kept.s2==='sold'&&kept.start===95,
   '★★切り替えは端末に残る（出品リストと一緒に保存）');

console.log('\n=== まとめて切り替える ===');
await setup();
const btn0=await p.evaluate(()=>({on:$('csvSoldOn').textContent,
  dis:$('csvSoldOn').disabled, note:$('csvSoldNote').textContent}));
console.log('   選択なし: '+JSON.stringify(btn0));
ok(btn0.dis===true,'★行を選んでいないときは押せない');
await p.evaluate(()=>{
  csvPick={s1:true,s2:true,s3:true}; csvRender(); csvPickNote();
});
await p.waitForTimeout(150);
const btn1=await p.evaluate(()=>({on:$('csvSoldOn').textContent,
  off:$('csvSoldOff').textContent, note:$('csvSoldNote').textContent}));
console.log('   3件選択: '+JSON.stringify(btn1));
ok(/選んだ行を相場で出す（2件）/.test(btn1.on),
   '★★相場が入っている2件だけを数える');
ok(/1件は相場が未入力/.test(btn1.note),'★相場が未入力の行があることを書く');
dlg.length=0;
await p.click('#csvSoldOn'); await p.waitForTimeout(300);
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/相場の値段で出します（2件）/.test(dlg[0]||''),'★件数を出して確認する');
ok(/最低売値で出します/.test(dlg[0]||''),'★最低売値で止まる行があることも出す');
ok(/相場が未入力の 1件はそのまま/.test(dlg[0]||''),'★とばす行の件数も出す');
const after=await p.evaluate(()=>({
  s1:csvSoldMode(csvRowById('s1')), s2:csvSoldMode(csvRowById('s2')),
  s3:csvSoldMode(csvRowById('s3')),
  start:[csvStartPrice(csvRowById('s1')),csvStartPrice(csvRowById('s2')),
         csvStartPrice(csvRowById('s3'))],
  note:$('csvSoldNote').textContent }));
console.log('   '+JSON.stringify(after));
ok(after.s1===true&&after.s2===true&&after.s3===false,
   '★★相場が入っている行だけ切り替わる');
ok(after.start[0]===95&&after.start[1]===after.start[1],'★売値も入れ替わる');
ok(/2件を相場の値段にしました/.test(after.note)&&/1件は最低売値/.test(after.note),
   '★結果を出す');
dlg.length=0;
await p.click('#csvSoldOff'); await p.waitForTimeout(300);
console.log('   戻す: '+JSON.stringify(dlg[0]));
const back=await p.evaluate(()=>({
  s1:csvSoldMode(csvRowById('s1')), s2:csvSoldMode(csvRowById('s2')),
  start:csvStartPrice(csvRowById('s1')), price:+csvRowById('s1').price||0,
  note:$('csvSoldNote').textContent }));
console.log('   '+JSON.stringify(back));
ok(/目標利益の売値に戻します（2件）/.test(dlg[0]||''),'★戻すときも確認する');
ok(back.s1===false&&back.s2===false&&back.start===back.price,
   '★★「目標利益に戻す」で元の売値に戻る');

console.log('\n=== 書き出すCSVの中身 ===');
await p.evaluate(()=>{
  csvRowById('s1').priceMode='sold'; csvSaveList(); csvRender();
});
dlg.length=0; dl.length=0;
await p.click('#csvExport'); await p.waitForTimeout(600);
const txt=(dl[0]||{}).text||'';
const line=txt.split(/\r\n/).filter(x=>/B0SP0000s1|商品s1|Item s1/.test(x))[0]||'';
console.log('   '+line.slice(0,160));
ok(/,95\.00,|,95\.00$/.test(line)||line.indexOf('95.00')>=0,
   '★★書き出したCSVの売値が相場の値段（$95.00）になっている');
console.log('   確認: '+JSON.stringify((dlg[0]||'').slice(0,60)));
ok(dlg.length>0,'確認のダイアログは今までどおり出る');

await T.done();
})();
