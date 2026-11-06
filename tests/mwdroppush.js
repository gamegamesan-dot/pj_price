/* 画面：MW 無在庫を出品リストに入れたときのずれ（6.144）
   W-4562475323733（おそ松さん ワールドコレクタブルフィギュア）で、
   MW の欄とカードの売値・重量・利益が食い違い、書き出しも0件になっていた。
   ・相場と比べる請求送料は**米国向け**（W2000-MW は米国に $15 請求）
   ・MW の欄で使った重量（400g）をカードにそのまま引き継ぐ
   ・カードの売値・最低売値・利益が MW の欄と同じになる
   ・無在庫（dropship）の行は Amazon と比べない（書き出しから外れない）
   ・英題の末尾の Figure が二重にならない
   ・MW の欄 ⇄ 出品リスト を行き来でき、除外の件数を押すとその行に飛ぶ */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：MW 無在庫の売値と重量');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

const setup=async()=>await p.evaluate(()=>{
  $('syncApi').value='https://s.example'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('shipCharge').value='15.00';
  $('csvShipProfileMw').value='W2000'; $('csvShipDaysMw').value='';
  $('csvShipProfileMw2').value='W2000-MW'; $('csvShipDaysMw2').value='6';
  $('mwShipFee').value='176'; $('syncWeight').value='400';
  $('csvPackFig').value='250';
  const r={ jan:'4562475323733', sha:'M200', kishu:'figure', cond:'新品',
    name:'おそ松さん ワールドコレクタブルフィギュア チェス松 白ver. カラ松',
    mw_name:'おそ松さん ワールドコレクタブルフィギュア チェス松 白ver. カラ松',
    wholesale:400, stock:5, ship_days:1, ship_text:'即日', list_price:1500,
    pics_ok:1, pics_n:1, mkt_low:32.00, mkt_n:3, mkt_ship:0,
    mkt_at:new Date().toISOString(), asin:'' };
  mwRows=[r];
  window.__r=r;
  const rec=mwRec(r), sl=mwSell(r,rec);
  const row=mwListRow(r,[{url:'https://x/i/1.jpg',w:600,h:600}],0);
  csvList=[row]; csvSaveList&&csvSaveList();
  /* 一覧の作り直しと同じ手順（重量は wManual なら触らない）。 */
  if(!row.wManual)row.weight=csvWeightFor(row);
  csvRecalc(row);
  return { rec:rec, sl:sl, row:row };
});

let g=await setup();
console.log('   MW: '+JSON.stringify({ship:g.rec.ship,w:g.rec.weight,
  price:g.rec.price,floor:g.rec.floor,under:g.sl.under,sell:g.sl.price}));
console.log('   行: '+JSON.stringify({w:g.row.weight,wRaw:g.row.wRaw,
  wManual:g.row.wManual,price:g.row.price,floor:g.row.floor}));

/* ---- A1：請求送料は米国向け（$15）を引く ---- */
ok(g.rec.ship===15,'★★★相場と比べる請求送料は米国向けの $15');
ok(g.sl.under===Math.round((32*0.97-15)*100)/100,
   '★★★相場の売値＝相場×97%−請求送料（32.00×0.97−15.00＝16.04）');

/* ---- A2：重量を引き継ぐ ---- */
ok(g.row.weight===400&&g.row.wRaw===400,'★★★MW の重量 400g を引き継ぐ');
ok(g.row.wManual===true,'★★一覧の作り直しで 0g＋梱包マージンに戻らない');

/* ---- A1/A3：カードの売値・最低売値・利益が MW の欄と同じ ---- */
let c=await p.evaluate(()=>{
  const r=csvList[0];
  return { price:r.price, floor:r.floor, profit:r.profit,
           start:csvStartPrice(r), weight:r.weight,
           verdict:csvVerdict(r), issues:csvIssues(r),
           judge:csvJudgeText(r) };
});
console.log('   カード: '+JSON.stringify({price:c.price,floor:c.floor,
  profit:Math.round(c.profit),verdict:c.verdict}));
ok(c.price===g.rec.price,'★★★カードの売値が MW の欄と同じ');
ok(c.floor===g.rec.floor,'★★★カードの最低売値が MW の欄と同じ');
ok(Math.round(c.profit)===Math.round(g.rec.profit),
   '★★★カードの利益が MW の欄と同じ（食い違わない）');
ok(c.start===g.sl.price,'★★出す売値（MW の欄で決めた値）を引き継ぐ');

/* ---- A4：無在庫は Amazon と比べない ---- */
ok(c.verdict==='drop','★★★無在庫の行は Amazon優先の判定をしない');
ok(c.issues.indexOf('Amazon優先')<0,'★★★書き出しから外れない');
ok(/無在庫（MW）/.test(c.judge)&&!/Amazon優先/.test(c.judge),
   '★行の案内も「無在庫（MW）」と出す');
let sp=await p.evaluate(()=>{
  /* 書き出しに必要な不備（英題・説明文・原産国）を埋めて、書き出せること */
  const r=csvList[0];
  r.titleEn='Osomatsu san World Collectible Figure Karamatsu';
  r.descHtml='<p>x</p>'; r.specs.origin='Japan'; r.cat='261055';
  const z=csvExportSplit();
  return { rows:z.rows.length, amz:z.amz.length, bad:z.bad.map((x)=>x.why) };
});
console.log('   書き出し: '+JSON.stringify(sp));
ok(sp.rows===1&&sp.amz===0,
   '★★★無在庫の行が書き出しに入る（「除外：Amazon優先 1件」で0件にならない）');

/* ---- A5：英題の末尾の Figure が二重にならない ---- */
let t=await p.evaluate(()=>{
  const mk=(o)=>figTitleFrom(false,o).text;
  return {
    dup:mk({ series:'Osomatsu san', chara:'Karamatsu',
             line:'World Collectible Figure', itemType:'figure' }),
    dup2:mk({ series:'Osomatsu san', chara:'Karamatsu',
              itemName:'World Collectible Figures', itemType:'figure' }),
    keep:mk({ series:'Gundam', chara:'Char Aznable', line:'HG',
              itemType:'figure' }),
    none:mk({ series:'Pokemon', chara:'Pikachu', itemType:'plush' })
  };
});
console.log('   '+JSON.stringify(t));
ok(/World Collectible Figure/.test(t.dup)&&!/Figure Figure/.test(t.dup),
   '★★★末尾が Figure のときは種類の Figure を足さない');
ok(!/Figures Figure/.test(t.dup2),'★★Figures（複数形）でも足さない');
ok(/HG Figure/.test(t.keep),'★ふつうの行には今までどおり Figure を付ける');
ok(!/Figure/.test(t.none),'★フィギュア以外には付けない（今までどおり）');

/* ---- A6：行き来と、件数を押して飛ぶ ---- */
await openCsvBoxes(p);
let nav=await p.evaluate(()=>{
  const open=(id)=>{ const b=$(id); return !!(b&&b.open); };
  $('csvMwFold').click();
  const afterFold=open('csvMwBox');
  $('csvListToMw').click();
  const afterTo=open('csvMwBox');
  return { afterFold:afterFold, afterTo:afterTo,
           hasToList:!!$('csvMwToList'), hasToMw:!!$('csvListToMw') };
});
ok(nav.hasToList&&nav.hasToMw,'★★行き来するボタンがある');
ok(nav.afterFold===false&&nav.afterTo===true,
   '★★「MW の欄を閉じる」で閉じ、「MW の候補一覧へ」で開く');
let jm=await p.evaluate(()=>{
  /* 不備のある行を作って、件数を押すとその行に飛ぶこと */
  const r=csvList[0];
  r.titleEn=''; csvRender();
  const a=$('csvExportNote').querySelector('[data-cjump="bad"]');
  if(!a)return { link:false };
  a.click();
  const el=document.querySelector('#csvList [data-row="'+r.id+'"]');
  return { link:true, text:a.textContent,
           lit:!!(el&&el.style.boxShadow) };
});
console.log('   '+JSON.stringify(jm));
ok(jm.link&&/不備/.test(jm.text),'★★★除外の件数が押せる形で出る');
ok(jm.lit,'★★★押すとその行まで飛んで光る');

await T.done();
})();
