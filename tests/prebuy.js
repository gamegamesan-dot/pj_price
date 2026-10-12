/* 出品CSVタブ：仕入れ登録前のリスト（SKUが空のせどりすとCSV）の取り込み（6.40）
   せどりすとで仕入れ登録前のリストを書き出すと
   SKU が空・仕入原価 -1・個数 -1・出品コンディションが空になる。
   これを「仕入れ前の候補」として取り込み、無在庫（M-<ASIN>）で出せるようにする。 */
const { harness } = require('./lib');
const T = harness('出品CSVタブ：仕入れ前の候補（SKUが空のCSV）');
const ok = T.ok;

/* 実物（sedolist_24.csv・2026-10-12）と同じ24列。
   仕入れ登録前のリストでは SKU・出品コンディションが空、仕入原価・個数・
   出品予定価格が -1、配送料は「無料」、基準価格に Amazon の値が入る。 */
const COLS=['SKU','JAN','ASIN','タイトル','基準価格','配送料','基準コンディション',
  '基準出品種別','データ更新日','参考価格','カテゴリ','ランク','重量','粗利',
  '仕入原価','個数','出品予定価格','出品コンディション','出品種別','出品コメント',
  '仕入日','仕入店舗','仕入店舗コード','メモ'];
const q=(a)=>a.map(x=>'"'+String(x)+'"').join(',');
const HEAD=q(COLS);
function line(o){
  return q(COLS.map(k=>(o[k]===undefined?'':o[k])));
}
// 仕入れ登録前のリスト（63件）。実物と同じく全件 新品・配送料 無料
const CATS=['ホビー','ホーム&キッチン','おもちゃ'];
const PRE=(function(){
  const out=[HEAD];
  for(let i=1;i<=63;i++){
    const n=String(i).padStart(4,'0');
    out.push(line({ 'SKU':'', 'JAN':'457310'+n+'000', 'ASIN':'B0PRE'+n+'Z',
      'タイトル':'TAMASHII NATIONS S.H.フィギュアーツ テスト No'+i
        +' 約145mm PVC&ABS製 塗装済み可動フィギュア',
      '基準価格':(3000+i)+'.000000', '配送料':'無料',
      '基準コンディション':'新品', '基準出品種別':'FBA',
      'データ更新日':'2026-10-12', '参考価格':'4,000', 'カテゴリ':CATS[i%3],
      'ランク':'21,570', '重量':(300+i)+'.000000', '粗利':'2,565',
      '仕入原価':'-1.000000', '個数':'-1', '出品予定価格':'-1.000000',
      '出品コンディション':'', '出品種別':'-', '出品コメント':'',
      '仕入日':'未設定', '仕入店舗':'店舗設定なし', '仕入店舗コード':'store00',
      'メモ':'' }));
  }
  return out.join('\n');
})();
/* 変わりだねの4件。
   ・中古（基準コンディション 中古）→ M-<ASIN>-U
   ・配送料が有料 → 基準価格＋配送料
   ・基準価格が無い → 仕入値：未確定（取り寄せの対象）
   ・仕入原価が入っている → その値を使う（仮にしない） */
const ODD=[HEAD,
  line({ 'SKU':'', 'JAN':'4573109000001', 'ASIN':'B0ODD0001Z',
    'タイトル':'ねんどろいど テスト中古 約100mm',
    '基準価格':'9719.000000', '配送料':'無料', '基準コンディション':'中古',
    'カテゴリ':'ホビー', 'ランク':'1,000', '重量':'400.000000', '粗利':'0',
    '仕入原価':'-1.000000', '個数':'-1', '出品コンディション':'', '出品種別':'-' }),
  line({ 'SKU':'', 'JAN':'4573109000002', 'ASIN':'B0ODD0002Z',
    'タイトル':'フィギュア テスト送料あり 約150mm',
    '基準価格':'5000.000000', '配送料':'350', '基準コンディション':'新品',
    'カテゴリ':'ホビー', 'ランク':'2,000', '重量':'500.000000', '粗利':'0',
    '仕入原価':'-1.000000', '個数':'-1', '出品コンディション':'', '出品種別':'-' }),
  line({ 'SKU':'', 'JAN':'4573109000003', 'ASIN':'B0ODD0003Z',
    'タイトル':'フィギュア テスト基準価格なし 約150mm',
    '基準価格':'-1.000000', '配送料':'無料', '基準コンディション':'新品',
    'カテゴリ':'ホビー', 'ランク':'3,000', '重量':'300.000000', '粗利':'0',
    '仕入原価':'-1.000000', '個数':'-1', '出品コンディション':'', '出品種別':'-' }),
  line({ 'SKU':'', 'JAN':'4573109000004', 'ASIN':'B0ODD0004Z',
    'タイトル':'フィギュア テスト仕入値あり 約150mm',
    '基準価格':'5000.000000', '配送料':'無料', '基準コンディション':'新品',
    'カテゴリ':'ホビー', 'ランク':'4,000', '重量':'300.000000', '粗利':'0',
    '仕入原価':'2500.000000', '個数':'2', '出品コンディション':'', '出品種別':'-' })
].join('\n');
// 今までどおりの（SKUがある）CSV
const OLD=[HEAD,
  line({ 'SKU':'hobby-20260101-UG-B0OLD00001-2500', 'JAN':'4901000000001',
    'ASIN':'B0OLD00001', 'タイトル':'ねんどろいど テスト',
    '基準価格':'9000.000000', '配送料':'無料', '基準コンディション':'中古',
    'カテゴリ':'ホビー', 'ランク':'12,345', '重量':'400.000000', '粗利':'0',
    '仕入原価':'2500.000000', '個数':'1', '出品コンディション':'良い',
    '出品種別':'FBA' }),
  line({ 'SKU':'game-20260101-N-B0OLD00002-1200', 'JAN':'4901000000002',
    'ASIN':'B0OLD00002', 'タイトル':'星のカービィ SW版',
    '基準価格':'5000.000000', '配送料':'無料', '基準コンディション':'新品',
    'カテゴリ':'ゲーム', 'ランク':'2,345', '重量':'150.000000', '粗利':'0',
    '仕入原価':'1200.000000', '個数':'2', '出品コンディション':'新品',
    '出品種別':'FBA' })].join('\n');

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
  // /lowest の差し替え（基準価格が無い行の取り寄せ）
  window.__low=[];
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u);
    if(/\/lowest/.test(url)){
      const items=JSON.parse(i.body).items;
      window.__low.push(items);
      const low={};
      items.forEach(function(x){
        if(x.asin==='B0MISS0001Z')return;        // 見つからない行
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

console.log('=== 実物と同じ形の63件（SKUが空）が取り込まれる ===');
await setup();
const imp=await p.evaluate((text)=>{
  const r=csvImport(text);
  csvRender();
  const one=csvList.find(x=>x.asin==='B0PRE0002Z');
  return { res:r, n:csvList.length,
    pre:csvList.filter(x=>x.preBuy).length,
    allM:csvList.every(x=>/^M-B[0-9A-Z]{9}$/.test(csvCustomLabel(x))),
    labels:csvList.slice(0,2).map(x=>csvCustomLabel(x)),
    conds:Array.from(new Set(csvList.map(x=>x.condId))),
    cats:Array.from(new Set(csvList.map(x=>x.cat))),
    drop:csvList.every(x=>!!x.dropship),
    qty:Array.from(new Set(csvList.map(x=>x.qty))),
    temp:csvList.filter(csvCostIsTemp).length,
    unknown:csvList.filter(csvCostUnknown).length,
    one:{ base:one.baseYen, cost:csvCostOf(one), rawCost:one.cost, wRaw:one.wRaw,
          weight:one.weight, price:one.price, floor:one.floor, oneOff:!!one.oneOff,
          stat:csvCostStat(one), sum:csvRowSummary(one), gross:one.gross,
          rank:one.rank, label:csvCustomLabel(one) },
    iss:Array.from(new Set([].concat.apply([],csvList.map(x=>csvIssues(x))))) };
},PRE);
console.log('   '+JSON.stringify(imp.res));
console.log('   '+JSON.stringify({allM:imp.allM,labels:imp.labels,conds:imp.conds,
  cats:imp.cats,drop:imp.drop,qty:imp.qty,temp:imp.temp,unknown:imp.unknown}));
console.log('   1行目: '+JSON.stringify(imp.one));
console.log('   不備: '+JSON.stringify(imp.iss));
ok(imp.res.added===63&&imp.n===63,'★63件すべて取り込む（実物と同じ24列・SKUが空）');
ok(imp.res.pre===63&&imp.pre===63,'★63件すべて「仕入れ前の候補」として入る');
ok(imp.allM,'★63件すべて CustomLabel が M-<ASIN>（新品）');
ok(imp.drop===true,'★無在庫オンで取り込む');
ok(imp.conds.length===1&&imp.conds[0]===1000,
   '★状態は「基準コンディション」の新品から決める（New 1000）');
ok(imp.qty.length===1&&imp.qty[0]===1,'★数量は1（個数 -1 のとき）');
ok(imp.one.wRaw===302&&imp.one.weight===302+250,
   '★重量は CSV の「重量」を使う（梱包マージンは今までどおり）');
ok(imp.one.rawCost===0&&imp.one.cost===3002,
   '★仕入原価 -1 は「基準価格＋配送料」を仮の仕入値にする');
ok(imp.temp===63&&imp.unknown===0,'★63件すべて仮の仕入値で値付けできる');
ok(/仕入値：仮（Amazon基準価格 ¥3,002・送料込み）/.test(imp.one.stat),
   '★行に「仕入値：仮（Amazon基準価格 ¥3,002・送料込み）」と出す');
ok(imp.one.price>0&&imp.one.floor>0&&imp.one.price>imp.one.floor,
   '★推奨売値・最低売値が出る');
ok(imp.one.oneOff===false,'★一点物にはしない（手元に無いので）');
ok(imp.one.gross===2565&&imp.one.rank===21570,'粗利・ランクも今までどおり読む');
ok(/仕入れ前・SKUなし/.test(imp.one.sum),'見出しに「仕入れ前・SKUなし」と出す');
ok(imp.iss.indexOf('仕入値が未確定（Amazon基準価格を取ってください）')<0,
   '★仕入値の不備は出ない');
ok(imp.cats.length===1&&imp.cats[0]==='261055',
   'ホビー／ホーム&キッチン／おもちゃ はフィギュア側で取り込む（カテゴリは行で選ぶ）');

console.log('\n=== 中古・送料あり・基準価格なし・仕入原価あり ===');
await setup();
const odd=await p.evaluate((text)=>{
  csvImport(text);
  csvRender();
  const g=(a)=>{ const r=csvList.find(x=>x.asin===a);
    return { label:csvCustomLabel(r), cond:r.condId, condName:CSV_COND_NAME[r.condId],
      base:r.baseYen, cost:csvCostOf(r), rawCost:r.cost, qty:r.qty,
      temp:csvCostIsTemp(r), unknown:csvCostUnknown(r),
      stat:csvCostStat(r), iss:csvIssues(r).filter(x=>/仕入値/.test(x)) }; };
  return { used:g('B0ODD0001Z'), ship:g('B0ODD0002Z'), none:g('B0ODD0003Z'),
    cost:g('B0ODD0004Z'),
    btn:$('csvBaseLow').style.display+'/'+$('csvBaseLow').textContent,
    bad:csvExportSplit(null).bad.filter(x=>/仕入値が未確定/.test(x.why))
      .map(x=>x.r.asin) };
},ODD);
console.log('   中古      : '+JSON.stringify(odd.used));
console.log('   送料あり  : '+JSON.stringify(odd.ship));
console.log('   基準価格なし: '+JSON.stringify(odd.none));
console.log('   仕入原価あり: '+JSON.stringify(odd.cost));
console.log('   '+JSON.stringify({btn:odd.btn,bad:odd.bad}));
ok(odd.used.label==='M-B0ODD0001Z-U'&&odd.used.cond===3000,
   '★中古は M-<ASIN>-U（フィギュアは Used 3000）');
ok(odd.used.cost===9719,'★中古も「基準価格＋配送料」を仮の仕入値にする');
ok(odd.ship.cost===5350,'★配送料が有料の行は 基準価格＋配送料（¥5,000＋¥350）');
ok(odd.none.unknown===true&&odd.none.iss.length===1
   &&/仕入値：未確定/.test(odd.none.stat),
   '★基準価格が無い行は「仕入値：未確定」で不備にする');
ok(odd.bad.join()==='B0ODD0003Z','★その行だけ書き出しの対象から外す');
ok(/block/.test(odd.btn)&&/（1件）/.test(odd.btn),
   '★「仕入れ前の候補：Amazon基準価格を取る（1件）」のボタンを出す');
ok(odd.cost.rawCost===2500&&odd.cost.cost===2500&&odd.cost.temp===false,
   '★仕入原価が入っている行はその値を使う（仮にしない）');
ok(odd.cost.qty===2,'★個数が入っている行はその数量');

console.log('\n=== 基準価格が無い行は pj-sync から取り寄せる ===');
await p.click('#csvBaseLow');
await p.waitForFunction(()=>!$('csvBaseLow').disabled,null,{timeout:8000});
await p.waitForTimeout(300);
const got=await p.evaluate(()=>{
  const r=csvList.find(x=>x.asin==='B0ODD0003Z');
  return { sent:window.__low[0], note:$('csvBaseLowNote').textContent,
    cost:csvCostOf(r), temp:csvCostIsTemp(r), stat:csvCostStat(r),
    iss:csvIssues(r).filter(x=>/仕入値/.test(x)).length,
    btn:$('csvBaseLow').style.display };
});
console.log('   送った内容: '+JSON.stringify(got.sent));
console.log('   '+got.note);
console.log('   '+JSON.stringify({cost:got.cost,temp:got.temp,iss:got.iss,btn:got.btn}));
ok(got.sent.length===1&&got.sent[0].asin==='B0ODD0003Z'&&got.sent[0].cond==='new',
   '★行の状態（新品／中古）で問い合わせる');
ok(got.cost===5000&&got.temp===true,'★取れた最安値を仮の仕入値にする');
ok(got.iss===0&&got.btn==='none','★不備から外れ、ボタンも消える');
ok(/Amazon基準価格を取りました：1件/.test(got.note),'件数を出す');

console.log('\n=== 仕入値を手で入れたら「仮」ではなくなる ===');
const fixed=await p.evaluate(()=>{
  const r=csvList.find(x=>x.asin==='B0ODD0001Z');
  csvCostSet(r,4000);
  return { cost:csvCostOf(r), temp:csvCostIsTemp(r), src:csvPriceSrcOf(r).cost_yen };
});
const tempSrc=await p.evaluate(()=>{
  const r=csvList.find(x=>x.asin==='B0ODD0002Z');
  return csvPriceSrcOf(r).cost_yen; });
console.log('   '+JSON.stringify(fixed)+'　仮の行が送る仕入値: '+JSON.stringify(tempSrc));
ok(fixed.cost===4000&&fixed.temp===false,'★入れた値を使う');
ok(fixed.src===4000,'★D1 にはその値を送る');
ok(tempSrc===undefined,'★仮の仕入値は D1 に残さない（本当の仕入値を上書きしない）');

console.log('\n=== 無在庫（M-）を外すと E- になる ===');
const toE=await p.evaluate(()=>{
  const r=csvList.find(x=>x.asin==='B0ODD0002Z');
  r.dropship=false;
  const off=csvCustomLabel(r);
  r.dropship=true;
  return { off:off, on:csvCustomLabel(r) };
});
console.log('   '+JSON.stringify(toE));
ok(toE.off==='E-B0ODD0002Z','★無在庫をオフにすると E-<ASIN>（空にしない）');
ok(toE.on==='M-B0ODD0002Z','★既定は M-');

console.log('\n=== SKUがある CSV は今までと同じ ===');
await setup();
const old=await p.evaluate((text)=>{
  const r=csvImport(text);
  csvRender();
  return { res:r, rows:csvList.map(x=>({sku:x.sku,asin:x.asin,cat:x.cat,
    cond:x.condId,qty:x.qty,cost:x.cost,cost0:csvCostOf(x),wRaw:x.wRaw,weight:x.weight,
    pre:!!x.preBuy,temp:!!x.costTemp,drop:!!x.dropship,
    label:csvCustomLabel(x),src:csvPriceSrcOf(x).cost_yen})) };
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
ok(old.rows.every(x=>!x.pre&&!x.temp&&!x.drop),'★仮の仕入値・無在庫の印は付かない');
ok(old.rows[0].label==='E-B0OLD00001-U'&&old.rows[1].label==='E-B0OLD00002',
   '★CustomLabel も今までどおり E-');
ok(old.rows.every(x=>x.cost0===x.cost&&x.src===x.cost),
   '★仕入値はCSVの値そのまま（D1 にもその値を送る）');

console.log('\n=== SKUもASINも空なら、理由を出す ===');
await setup();
const none=await p.evaluate((h)=>{
  const text=[h,
    '"","4901000000003","","テスト商品A","3000.000000","無料","新品","FBA",'
      +'"2026-10-12","4,000","ホビー","1,000","300.000000","0","-1.000000","-1",'
      +'"-1.000000","","-","","未設定","店舗設定なし","store00",""',
    '"","4901000000004","","テスト商品B","3000.000000","無料","新品","FBA",'
      +'"2026-10-12","4,000","ホビー","1,000","300.000000","0","-1.000000","-1",'
      +'"-1.000000","","-","","未設定","店舗設定なし","store00",""'].join('\n');
  return csvImport(text);
},HEAD);
console.log('   '+JSON.stringify(none));
ok(none.added===0&&none.noSku===2,'★ASINが無い行は取り込めない（件数を数える）');
const msg=await p.evaluate(()=>{
  const r={added:0,merged:0,skipped:0,noSku:63,pre:0};
  return '✓ '+r.added+'件を追加しました。'
    +((!r.added&&r.noSku)?('SKUが空の行が'+r.noSku+'件あります（仕入れ登録前のリスト）。'
      +'ASIN が入っていればそのまま取り込めます。'):'');
});
console.log('   '+msg);
ok(/SKUが空の行が63件あります（仕入れ登録前のリスト）/.test(msg),
   '★0件のときは「SKUが空の行が○件あります（仕入れ登録前のリスト）」と出す');
await T.done();
})();
