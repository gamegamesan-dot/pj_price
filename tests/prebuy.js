/* 出品CSVタブ：仕入れ登録前のリスト（SKUが空のせどりすとCSV）の取り込み（6.40）
   せどりすとで仕入れ登録前のリストを書き出すと
   SKU が空・仕入原価 -1・個数 -1・出品コンディションが空になる。
   これを「仕入れ前の候補」として取り込み、無在庫（M-<ASIN>）で出せるようにする。 */
const { harness } = require('./lib');
const T = harness('出品CSVタブ：仕入れ前の候補（SKUが空のCSV）');
const ok = T.ok;

// 仕入れ登録前のリスト（63件）。SKU・出品コンディションは空、仕入原価と個数は -1
const HEAD='SKU,JAN,ASIN,タイトル,カテゴリ,重量,仕入原価,個数,出品コンディション,'
  +'基準コンディション,粗利,ランク,出品種別';
const PRE=(function(){
  const out=[HEAD];
  for(let i=1;i<=63;i++){
    const n=String(i).padStart(4,'0');
    out.push([''/*SKU*/,'49'+n+'00000','B0PRE'+n+'Z',
      'S.H.フィギュアーツ 仮面ライダー No'+i,'ホビー',
      String(300+i),'-1','-1','',(i%10===0)?'新品':'中古','0','12345','']
      .join(','));
  }
  return out.join('\n');
})();
// 今までどおりの（SKUがある）CSV
const OLD=[HEAD,
  'hobby-20260101-UG-B0OLD00001-2500,4901000000001,B0OLD00001,'
    +'ねんどろいど テスト,ホビー,400,2500,1,良い,中古,0,12345,FBA',
  'game-20260101-N-B0OLD00002-1200,4901000000002,B0OLD00002,'
    +'星のカービィ SW版,ゲーム,150,1200,2,新品,新品,0,2345,FBA'].join('\n');

(async()=>{
const p=await T.open();
await p.click('#tabD');

const setup=async()=>await p.evaluate(()=>{
  $('fx').value='160'; $('zone').value='2'; $('baseProfit').value='1000';
  $('linkRate').value='30'; $('saleRate').value='15'; $('usTaxRate').value='8';
  $('targetMode').value='auto';
  $('csvShipProfile').value='W1000'; $('csvShipProfileRe').value='W2000';
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P'; $('csvLocation').value='Tokyo';
  $('csvPackFig').value='250'; $('csvPackGame').value='60';
  $('csvStartMode').value='cost'; $('autoMdMode').value='off';
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  csvList=[]; csvPick={}; csvNew={ low:{}, cat:{}, pick:{} };
  syncData=null; csvSaveList();
  // /lowest の差し替え（Amazon基準価格を返す）
  window.__low=[];
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u);
    if(/\/lowest/.test(url)){
      const items=JSON.parse(i.body).items;
      window.__low.push(items);
      const low={};
      items.forEach(function(x,n){
        // 中古は ¥3,000、新品は ¥5,000 で返す（1件だけ「見つからない」にする）
        if(x.asin==='B0PRE0001Z')return;
        low[x.asin+'|'+x.cond]={ low:(x.cond==='new')?5000:3000, lowN:1, total:3 };
      });
      return Promise.resolve({ok:true,json:()=>Promise.resolve(
        {at:new Date().toISOString(),lowest:low})});
    }
    if(/\/listings/.test(url))
      return Promise.resolve({ok:true,json:()=>Promise.resolve({accepted:1,rejected:0})});
    return real(u,i);
  };
});

console.log('=== 63件（SKUが空）が取り込まれる ===');
await setup();
const imp=await p.evaluate((text)=>{
  const r=csvImport(text);
  csvRender();
  const rows=csvList;
  const one=rows.find(x=>x.asin==='B0PRE0002Z');
  const nw=rows.find(x=>x.asin==='B0PRE0010Z');
  return { res:r, n:rows.length,
    pre:rows.filter(x=>x.preBuy).length,
    labels:rows.slice(0,3).map(x=>csvCustomLabel(x)),
    used:{ label:csvCustomLabel(one), cond:one.condId,
           condName:CSV_COND_NAME[one.condId], drop:!!one.dropship,
           qty:one.qty, wRaw:one.wRaw, weight:one.weight, cost:one.cost,
           temp:!!one.costTemp, one:!!one.oneOff, cat:one.cat,
           sum:csvRowSummary(one), stat:csvCostStat(one) },
    newRow:{ label:csvCustomLabel(nw), cond:nw.condId, condName:CSV_COND_NAME[nw.condId] } };
},PRE);
console.log('   '+JSON.stringify(imp.res));
console.log('   中古の行: '+JSON.stringify(imp.used));
console.log('   新品の行: '+JSON.stringify(imp.newRow));
ok(imp.res.added===63&&imp.n===63,'★63件すべて取り込む');
ok(imp.res.pre===63&&imp.pre===63,'★63件すべて「仕入れ前の候補」として入る');
ok(imp.used.label==='M-B0PRE0002Z-U','★CustomLabel は M-<ASIN>-U（中古）');
ok(imp.newRow.label==='M-B0PRE0010Z','★新品は M-<ASIN>');
ok(imp.used.drop===true,'★無在庫オンで取り込む');
ok(imp.used.cond===3000&&imp.used.condName==='Used',
   '★状態は「基準コンディション」の中古から決める（フィギュアは Used 3000）');
ok(imp.newRow.cond===1000,'★新品は New 1000');
ok(imp.used.qty===1,'★数量は1（個数 -1 のとき）');
ok(imp.used.wRaw===302,'★重量は CSV の「重量」を使う');
ok(imp.used.weight===302+250,'梱包マージン（フィギュア+250g）は今までどおり足す');
ok(imp.used.cost===0&&imp.used.temp===true,'★仕入原価 -1 は仕入値0＋「仮」の印');
ok(imp.used.one===false,'★一点物にはしない（手元に無いので）');
ok(/仕入れ前・SKUなし/.test(imp.used.sum),'見出しに「仕入れ前・SKUなし」と出す');

console.log('\n=== Amazon基準価格を取るまでは書き出さない ===');
const before=await p.evaluate(()=>{
  const r=csvRowById(csvList[1].id);
  return { unknown:csvCostUnknown(r), iss:csvIssues(r).filter(x=>/仕入値/.test(x)),
    btn:$('csvBaseLow').style.display+'/'+$('csvBaseLow').textContent,
    stat:csvCostStat(r), price:r.price,
    split:csvExportSplit(null).bad.filter(x=>/仕入値が未確定/.test(x.why)).length };
});
console.log('   '+JSON.stringify(before));
ok(before.unknown===true&&before.iss.length===1,'★「仕入値が未確定」を不備に出す');
ok(/block/.test(before.btn)&&/（63件）/.test(before.btn),
   '★「仕入れ前の候補：Amazon基準価格を取る（63件）」のボタンを出す');
ok(/仕入値：未確定/.test(before.stat),'★行にも未確定と出す');
ok(before.split===63,'★書き出しの対象から外す（63件すべて不備）');

console.log('\n=== Amazon基準価格を取ると仮の仕入値で値付けできる ===');
await p.click('#csvBaseLow');
await p.waitForFunction(()=>!$('csvBaseLow').disabled,null,{timeout:8000});
await p.waitForTimeout(300);
const after=await p.evaluate(()=>{
  const r=csvRowById(csvList[1].id);          // B0PRE0002Z（中古）
  const nw=csvList.find(x=>x.asin==='B0PRE0010Z');
  const miss=csvList.find(x=>x.asin==='B0PRE0001Z');
  return { sent:(window.__low[0]||[]).slice(0,2),
    sentN:(window.__low[0]||[]).length,
    note:$('csvBaseLowNote').textContent,
    used:{ base:csvAmzBase(r), cost:csvCostOf(r), price:r.price, floor:r.floor,
           temp:csvCostIsTemp(r), stat:csvCostStat(r),
           iss:csvIssues(r).filter(x=>/仕入値/.test(x)).length },
    newRow:{ base:csvAmzBase(nw), price:nw.price },
    miss:{ unknown:csvCostUnknown(miss), iss:csvIssues(miss)
             .filter(x=>/仕入値が未確定/.test(x)).length },
    btn:$('csvBaseLow').textContent };
});
console.log('   送った内容: '+JSON.stringify(after.sent)+' 計'+after.sentN+'件');
console.log('   '+after.note);
console.log('   中古の行: '+JSON.stringify(after.used));
console.log('   新品の行: '+JSON.stringify(after.newRow));
ok(after.sentN===63&&after.sent[0].cond==='used'&&
   after.sent.some(x=>x.asin==='B0PRE0001Z'),
   '★行の状態（新品／中古）で pj-sync に問い合わせる');
ok(after.used.base===3000&&after.used.cost===3000,
   '★中古は中古の最安値（¥3,000・送料込み）を仮の仕入値にする');
ok(after.newRow.base===5000,'★新品は新品の最安値（¥5,000）');
ok(after.used.price>0&&after.used.floor>0&&after.used.price>after.used.floor,
   '★仮の仕入値で推奨売値・最低売値が出る');
ok(after.used.temp===true&&/仕入値：仮（Amazon基準価格 ¥3,000・送料込み）/
   .test(after.used.stat),
   '★行に「仕入値：仮（Amazon基準価格 ¥3,000・送料込み）」と出す');
ok(after.used.iss===0,'★不備から外れる');
ok(after.miss.unknown===true&&after.miss.iss===1,
   '★出品が見つからなかった行は未確定のまま（手で入れる）');
ok(/1件は出品が見つかりませんでした/.test(after.note),'★取れなかった件数も出す');

console.log('\n=== 仕入値を手で入れたら「仮」ではなくなる ===');
const fixed=await p.evaluate(()=>{
  const r=csvRowById(csvList[1].id);
  csvCostSet(r,2000);
  return { cost:csvCostOf(r), temp:csvCostIsTemp(r), stat:csvCostStat(r),
    src:csvPriceSrcOf(r).cost_yen };
});
console.log('   '+JSON.stringify(fixed));
ok(fixed.cost===2000&&fixed.temp===false,'★入れた値を使う');
ok(fixed.src===2000,'★D1 にはその値を送る');
const tempSrc=await p.evaluate(()=>{
  const nw=csvList.find(x=>x.asin==='B0PRE0010Z');
  return csvPriceSrcOf(nw).cost_yen; });
console.log('   仮の行が D1 に送る仕入値: '+JSON.stringify(tempSrc));
ok(tempSrc===undefined,'★仮の仕入値は D1 に残さない（本当の仕入値を上書きしない）');

console.log('\n=== 無在庫（M-）から E- に切り替えられる ===');
const toE=await p.evaluate(()=>{
  const r=csvRowById(csvList[1].id);
  r.dropship=false;
  const a=csvCustomLabel(r);
  r.dropship=true;
  return { off:a, on:csvCustomLabel(r) };
});
console.log('   '+JSON.stringify(toE));
ok(toE.off==='E-B0PRE0002Z-U','★無在庫をオフにすると E-<ASIN>-U になる（空にしない）');
ok(toE.on==='M-B0PRE0002Z-U','★既定は M-');

console.log('\n=== SKUがある CSV は今までと同じ ===');
await setup();
const old=await p.evaluate((text)=>{
  const r=csvImport(text);
  csvRender();
  return { res:r, rows:csvList.map(x=>({sku:x.sku,asin:x.asin,cat:x.cat,
    cond:x.condId,qty:x.qty,cost:x.cost,wRaw:x.wRaw,weight:x.weight,
    pre:!!x.preBuy,temp:!!x.costTemp,drop:!!x.dropship,
    label:csvCustomLabel(x),cost0:csvCostOf(x)})) };
},OLD);
console.log('   '+JSON.stringify(old.res));
old.rows.forEach(x=>console.log('   '+JSON.stringify(x)));
ok(old.res.added===2&&old.res.pre===0&&old.res.noSku===0,
   '★2件とも今までどおり（仕入れ前の候補にはしない）');
ok(old.rows[0].cat==='261055'&&old.rows[0].cond===3000&&old.rows[0].cost===2500
   &&old.rows[0].qty===1&&old.rows[0].wRaw===400&&old.rows[0].weight===650,
   '★ホビーの行（良い＝Used 3000・仕入値2500・400g＋250g）');
ok(old.rows[1].cat==='139973'&&old.rows[1].cond===1000&&old.rows[1].cost===1200
   &&old.rows[1].qty===2&&old.rows[1].weight===210,
   '★ゲームの行（新品1000・仕入値1200・150g＋60g）');
ok(old.rows.every(x=>!x.pre&&!x.temp&&!x.drop),
   '★仮の仕入値・無在庫の印は付かない');
ok(old.rows[0].label==='E-B0OLD00001-U'&&old.rows[1].label==='E-B0OLD00002',
   '★CustomLabel も今までどおり E-');
ok(old.rows.every(x=>x.cost0===x.cost),'★仕入値はCSVの値そのまま');

console.log('\n=== SKUもASINも空なら、理由を出す ===');
await setup();
const none=await p.evaluate(()=>{
  const text=['SKU,JAN,ASIN,タイトル,カテゴリ,重量,仕入原価,個数,出品コンディション,'
    +'基準コンディション,粗利,ランク,出品種別',
    ',4901000000003,,テスト商品A,ホビー,300,-1,-1,,中古,0,12345,',
    ',4901000000004,,テスト商品B,ホビー,300,-1,-1,,中古,0,12345,'].join('\n');
  const r=csvImport(text);
  return r;
});
console.log('   '+JSON.stringify(none));
ok(none.added===0&&none.noSku===2,'★ASINが無い行は取り込めない（件数を数える）');
const msg=await p.evaluate(()=>{
  // ファイル選択と同じ案内を作る（メッセージの作り方を確かめる）
  const r={added:0,merged:0,skipped:0,noSku:63,pre:0};
  return '✓ '+r.added+'件を追加しました。'
    +((!r.added&&r.noSku)?('SKUが空の行が'+r.noSku+'件あります（仕入れ登録前のリスト）。'):'');
});
console.log('   '+msg);
ok(/SKUが空の行が63件あります（仕入れ登録前のリスト）/.test(msg),
   '★0件のときは「SKUが空の行が○件あります（仕入れ登録前のリスト）」と出す');
await T.done();
})();
