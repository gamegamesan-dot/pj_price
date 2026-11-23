/* 画面：後回し（high）の MW 候補を、相場に合わせた値段で出す（8.96・v344）

   カジの依頼（2026-11-23）ok がほぼ無くなった（ok 1件／相場なし 約245件／
   後回し 578件）。後回しの中から、相場の値段まで下げても利益が残る商品を
   出品候補にする。
   ① 相場の値段で出したときの利益（mwRec(r).profitAtMkt）。相場は判定と同じ値、
      利益はいまの式（eBay 手数料・広告費・国際送料・為替・仕入値）
   ② 新しい判定 mktok（相場に合わせれば出せる）：利益が⚙の下限（既定 ¥700）以上・
      最低売値を下回らない・相場が⚙の日数（既定 14日）より新しい。届かなければ high
   ③ 出品リストに入れると、売値は自動で「相場で出す」・行に「相場に合わせて出品」・
      「目標利益に戻す」で戻せる
   ④ 候補一覧の件数（出品候補／相場に合わせれば出せる／相場なし／後回し）
   ⑤ ok／nomkt／none／err の判定と、いまの値付けは変えない */
const { harness, openCsvBoxes }=require('./lib');
const T=harness('画面：相場に合わせれば出せる（8.96）');
const ok=T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

await p.evaluate(()=>{
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('autoAdRate').value='6';
  $('fee').value='13.6'; $('intlFee').value='1.35'; $('feeTax').value='10';
  $('fixed').value='0.40'; $('pack').value='150'; $('shipCharge').value='15';
  $('targetMode').value='auto';
  $('syncWeightGame').value='150'; $('syncWeight').value='400';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='2';
  $('mwKishu').value='NS,NS2,P5,P4,figure,b2cchara_figure';
  $('mwNewOnly').checked=true;
  $('syncApi').value=''; $('syncKey').value='';
  switchTab('D'); roleCheck(); csvRender();
});
await openCsvBoxes(p);

const NOW=new Date().toISOString();
const OLD=new Date(Date.now()-20*86400000).toISOString();
/* 行を作り、目標利益の総額（rec.total）を基に相場を決める（式はページのものを使う）。 */
const rows=await p.evaluate((a)=>{
  const R=(jan,w,o)=>Object.assign({ jan:jan, sha:'M200', idx:0, kishu:'NS', name:'商品'+jan.slice(-3),
    cond:'新品', wholesale:w, stock:5, ship_days:0, ship_text:'即日出荷',
    mkt_n:8, mkt_n_new:5, mkt_low:null, mkt_low_any:null, mkt_ship:0, mkt_cur:'USD',
    mkt_no_ship:0, mkt_err:'', mkt_at:a.NOW, pics_ok:2 },o||{});
  const set=(r,f)=>{ const t=mwRec(r).total; r.mkt_low=Math.round(t*f*100)/100; return r; };
  const out=[
    set(R('4902370550001',3000),1.05),                 // A：相場の115%以内 → ok
    set(R('4902370550002',3000),1/1.17),               // B：117% → 相場で出しても利益が残る
    set(R('4902370550003',6000),1/1.2),                // B2：利益がもっと大きい
    set(R('4902370550004',3000),1/1.9),                // C：相場が安すぎる → high
    set(R('4902370550005',3000,{ mkt_at:a.OLD }),1/1.17),   // D：相場が20日前 → high
    R('4902370550006',3000,{ mkt_n:0 }),               // E：相場なし
    R('4902370550007',3000,{ mkt_at:null, mkt_n:null }), // F：未調査
    set(R('4902370550008',3000),1/1.17),                // G：相場だけ mkt_low_any
    set(R('4902370550009',3000),1/1.25)];               // H：125% → 利益が下限未満
  out[7].mkt_low_any=out[7].mkt_low; out[7].mkt_low=null;
  return out;
},{ NOW, OLD });

console.log('=== ① ② 判定と、相場で出したときの利益 ===');
const J=await p.evaluate((rows)=>rows.map((r)=>{
  const rec=mwRec(r), j=mwMktJudge(r,rec);
  return { jan:r.jan, k:j.k, pct:j.pct, why:j.mktWhy||'', low:rec.mktLow, item:rec.mktItem,
    profit:rec.profitAtMkt, floor:rec.floor, target:rec.profit,
    ship:mwShipCharge(rec.cost,rec.weight), days:rec.mktDays };
}),rows);
J.forEach((x)=>console.log('   '+x.jan.slice(-1)+' '+x.k+' '+(x.pct||'')+'% 相場 '+x.low
  +' 売値 '+x.item+' 利益 '+x.profit+' 最低 '+x.floor+(x.why?(' 理由 '+x.why):'')));
const by=(d)=>J.filter((x)=>x.jan.slice(-1)===d)[0];
ok(by('1').k==='ok','★★★相場の115%以内は今までどおり ok');
ok(by('2').k==='mktok'&&by('3').k==='mktok','★★★相場の値段で出しても利益が下限以上の後回しは mktok');
ok(by('2').profit>=700&&by('2').profit<by('2').target,'★★相場で出したときの利益（目標利益より少ない・下限以上）');
ok(Math.abs(by('2').item-(by('2').low-by('2').ship))<0.011,
   '★★★相場の売値＝相場（総額）− 米国向けの請求送料（判定と同じそろえ方）');
ok(by('4').k==='high'&&/利益/.test(by('4').why)&&by('4').profit<0,'★★★相場で出すと赤字の商品は後回しのまま（理由つき）');
ok(by('9').k==='high'&&/下限 ¥700/.test(by('9').why)&&by('9').profit<700,'★★★相場で出すと利益が下限に届かない商品は後回しのまま');
ok(by('2').item<by('2').floor,'★（この例は）相場の売値が最低売値（下限利益の線）より低い');
ok(by('5').k==='high'&&/14日より古い/.test(by('5').why)&&by('5').days>=19,'★★★相場が14日より古い商品は使わない');
ok(by('6').k==='nomkt'&&by('7').k==='none','★★★相場なし・未調査は今までどおり');
ok(by('8').k==='mktok'&&by('8').low>0,'★相場が mkt_low_any だけの商品も判定と同じ値を使う');
{
  const t=await p.evaluate((rows)=>{
    const r=rows[1], rec=mwRec(r);
    const m=PJP.model(pricingSettings(),{ cost:rec.cost, weight:rec.weight, flat:0 });
    const a=m.zoneProfit(rec.mktItem,USA_ZONE).profit, b=m.zoneProfit(rec.mktItem,m.basisZone).profit;
    return { p:rec.profitAtMkt, want:Math.round(Math.min(a,b)) };
  },rows);
  ok(t.p===t.want,'★★★利益はいまの式（pricing.js の zoneProfit・米国と基準の地帯の低いほう）');
}
/* ⚙ の下限・日数 */
{
  const t=await p.evaluate((rows)=>{
    const o={ min:$('mwMktOkMin').value, days:$('mwMktMaxDays').value,
      saved:CSV_CFG_IDS.indexOf('mwMktOkMin')>=0&&CSV_CFG_IDS.indexOf('mwMktMaxDays')>=0 };
    const r=rows[1], p0=mwRec(r).profitAtMkt;
    $('mwMktOkMin').value=String(p0+1); o.k1=mwMktJudge(r,mwRec(r)).k; o.why1=mwMktJudge(r,mwRec(r)).mktWhy;
    $('mwMktOkMin').value='700';
    $('mwMktMaxDays').value='30'; o.k2=mwMktJudge(rows[4],mwRec(rows[4])).k;
    $('mwMktMaxDays').value='14';
    return o; },rows);
  ok(t.min==='700'&&t.days==='14'&&t.saved,'★★★⚙ 利益の下限（既定 ¥700）・相場の古さ（既定 14日）・この端末に控える');
  ok(t.k1==='high'&&/下限/.test(t.why1),'★★★下限に届かなければ後回しのまま');
  ok(t.k2==='mktok','★★⚙ の日数を延ばすと、古い相場も使える');
}

console.log('\n=== ④ 候補一覧の件数と区分 ===');
await p.evaluate((rows)=>{ mwRows=rows; mwMkt={ seen:7, left:1 }; mwListRender(); },rows);
{
  const t=await p.evaluate(()=>({ cnt:($('mwKindCount')||{}).textContent||'',
    txt:($('csvMwList').textContent||'').replace(/\s+/g,' '),
    order:Array.prototype.map.call(document.querySelectorAll('#csvMwList [data-mktok]'),(el)=>
      el.closest('div').textContent.slice(0,6)) }));
  console.log('   '+t.cnt);
  ok(/出品候補 1件／相場に合わせれば出せる 3件／相場なし 1件／後回し 3件／未調査 1件/.test(t.cnt),
     '★★★件数：出品候補／相場に合わせれば出せる／相場なし／後回し');
  ok(/①′ 相場に合わせれば出せる 3件/.test(t.txt),'★★★「相場に合わせれば出せる」の区分');
  const h=await p.evaluate(()=>$('csvMwList').innerHTML);
  ok(h.indexOf('① 出品候補')<h.indexOf('①′ 相場に合わせれば出せる')
     &&h.indexOf('①′ 相場に合わせれば出せる')<h.indexOf('② 相場なし'),'★★①のあと、②の前に出す');
  const pr=await p.evaluate(()=>Array.prototype.map.call(document.querySelectorAll('#csvMwList [data-mktok]'),
    (el)=>+(el.textContent.replace(/[^\d]/g,''))));
  ok(pr.length===3&&pr[0]>=pr[1]&&pr[1]>=pr[2],'★★相場で出したときの利益が大きい順');
  ok(/相場の値段 \$[\d.]+（\$[\d.]+ − 米国向けの請求送料）で出すと利益 ¥[\d,]+（相場に合わせれば出せる）/.test(t.txt),
     '★★行に相場の値段と利益を出す');
  ok(/後回しのまま：相場が14日より古い/.test(t.txt),'★★後回しの行に、相場に合わせても出せない理由');
}

console.log('\n=== ③ 出品リストに入れたとき ===');
{
  const t=await p.evaluate((rows)=>{
    const rB=rows[1], rA=rows[0], recB=mwRec(rB), recA=mwRec(rA);
    csvList=[]; const why0=mwPushWhy(rB), btn0=/data-mwpush/.test(mwPushBtn(rB));
    const lb=mwListRow(rB,[{url:'https://img.example/b.jpg'}],0);
    const la=mwListRow(rA,[{url:'https://img.example/a.jpg'}],1);
    csvList=[lb,la]; csvSaveList(); csvRender();
    const o={ why:why0, btn:btn0,
      mode:lb.priceMode, auto:lb.mktAuto, sold:lb.sold, low:recB.mktLow,
      start:csvStartPrice(lb), item:recB.mktItem, target:lb.price,
      badge:csvSoldPriceHtml(lb).replace(/<[^>]+>/g,''),
      modeA:la.priceMode||'', autoA:!!la.mktAuto, startA:csvStartPrice(la), slA:+la.price,
      under:csvSoldStart(lb).under, mkt:!!csvSoldStart(lb).mkt, fl:+lb.floor,
      cand:!!mwPicCand().ok[rB.jan] };
    lb.priceMode='target';
    o.back=csvStartPrice(lb); o.badge2=csvSoldPriceHtml(lb);
    return o; },rows);
  console.log('   '+JSON.stringify(t));
  ok(t.why===''&&t.btn,'★★★相場に合わせれば出せる行は出品リストに入れられる（行のボタンも出る）');
  ok(t.mode==='sold'&&t.auto===true&&t.sold===t.low,'★★★入れた時点で「相場で出す」（相場は判定と同じ値）');
  ok(Math.abs(t.start-t.item)<0.011,'★★★書き出す売値は相場の売値（相場 − 米国向けの請求送料）');
  ok(t.start<t.fl&&t.under===false&&t.mkt===true,
     '★★★利益が⚙の下限以上なら、最低売値（下限利益の線）で止めずに相場の売値で出す');
  ok(/相場に合わせて出品/.test(t.badge),'★★★行に「相場に合わせて出品」の印');
  ok(Math.abs(t.back-t.target)<0.011&&t.badge2==='','★★「目標利益に戻す」で目標利益の売値に戻り、印も消える');
  ok(t.modeA===''&&!t.autoA&&Math.abs(t.startA-t.slA)<0.011,'★★★ok の行の値付けは今までどおり');
  ok(t.cand,'★★写真の取り込みの対象にも入る');
}

await T.done();
})();
