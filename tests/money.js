/* 仕入値・売値・利益の帯（6.43）
   ・出品CSVタブ・販売連携タブの各行に、3つの数字を横に並べた帯を出す
   ・利益の色：目標利益以上は緑／下限利益以上は黄／下限未満・赤字は赤
   ・仮の仕入値は「（仮）」を付けて薄く、仕入値欄は 0 ではなく placeholder に出す
   ・値を変えたら帯もすぐ変わる。書き出すCSVは変わらない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('仕入値・売値・利益の帯');
const ok = T.ok;
const HEAD='"SKU","JAN","ASIN","タイトル","基準価格","配送料","基準コンディション",'
  +'"基準出品種別","データ更新日","参考価格","カテゴリ","ランク","重量","粗利",'
  +'"仕入原価","個数","出品予定価格","出品コンディション","出品種別","出品コメント",'
  +'"仕入日","仕入店舗","仕入店舗コード","メモ"';
// 依頼の例：鬼滅の刃 嘴平伊之助（仕入れ前の候補・基準価格 ¥10,900・重量170g）
const PRE=[HEAD,
  '"","4573102721297","B0MB00001Z","TAMASHII NATIONS S.H.フィギュアーツ 鬼滅の刃 '
  +'嘴平伊之助 約140mm PVC&ABS製 塗装済み可動フィギュア","10900.000000","無料",'
  +'"新品","FBA","2026-10-12","9,000","ホビー","16,118","170.000000","8,302",'
  +'"-1.000000","-1","-1.000000","","-","","未設定","店舗設定なし","store00",""',
  // 仕入値が入っている行（仮ではない）
  '"hobby-20260101-UG-B0MB00002Z-2500","4573102721298","B0MB00002Z","ねんどろいど '
  +'テスト 約100mm PVC製","9000.000000","無料","中古","FBA","2026-10-12","9,000",'
  +'"ホビー","1,000","400.000000","0","2500.000000","1","-1.000000","良い","FBA","",'
  +'"2026-10-01","店舗","store00",""',
  // 基準価格が無く仕入原価も無い行（仕入値 未確定）
  '"","4573102721299","B0MB00003Z","フィギュア テスト 約150mm PVC製","-1.000000",'
  +'"無料","新品","FBA","2026-10-12","9,000","ホビー","1,000","300.000000","0",'
  +'"-1.000000","-1","-1.000000","","-","","未設定","店舗設定なし","store00",""'
].join('\n');

(async()=>{
const p=await T.open();
await p.click('#tabD');

const setup=async()=>await p.evaluate((text)=>{
  $('fx').value='160'; $('zone').value='2'; $('baseProfit').value='1000';
  $('linkRate').value='30'; $('saleRate').value='15'; $('usTaxRate').value='8';
  $('targetMode').value='auto'; $('csvPackFig').value='250'; $('csvPackGame').value='60';
  $('csvStartMode').value='cost'; $('autoMdMode').value='off';
  $('csvShipProfile').value='W1000'; $('csvShipProfileRe').value='W2000';
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P'; $('csvLocation').value='Tokyo';
  $('syncApi').value=''; $('syncKey').value='';
  csvList=[]; csvPick={}; csvNew={ low:{}, cat:{}, pick:{} }; syncData=null;
  csvImport(text);
  csvRender(); $('csvListBox').open=true;
  return csvList.map(r=>r.asin);
},PRE);
const band=async(asin)=>await p.evaluate((a)=>{
  const r=csvList.find(x=>x.asin===a);
  const card=document.querySelector('#csvList [data-row="'+r.id+'"]');
  const el=card.querySelector('[data-money]');
  const cells=Array.from(el.children).map(d=>({
    label:d.children[0].textContent, main:d.children[1].textContent,
    sub:d.children[2].textContent, col:d.children[1].style.color,
    dim:d.children[1].style.opacity }));
  return { cells:cells, text:el.innerText.replace(/\n/g,' | '),
    cost:csvCostOf(r), price:csvStartPrice(r),
    profit:csvProfitAt(csvCostOf(r),r.weight,csvStartPrice(r),csvFlatOf(r)),
    target:Math.round(csvTargetYen(csvCostOf(r))),
    input:card.querySelector('[data-cost]').value,
    ph:card.querySelector('[data-cost]').getAttribute('placeholder') };
},asin);

console.log('=== 依頼の例（仕入れ前の候補・仮の仕入値）===');
console.log('   '+JSON.stringify(await setup()));
let b=await band('B0MB00001Z');
console.log('   '+b.text);
console.log('   '+JSON.stringify({cost:b.cost,price:b.price,profit:b.profit,
  target:b.target,input:b.input,ph:b.ph}));
ok(b.cells.length===3&&b.cells.map(c=>c.label).join()==='仕入値,売値,利益',
   '★3つ（仕入値・売値・利益）を横に並べる');
ok(b.cells[0].main==='¥10,900（仮）','★仕入値は ¥10,900（仮）');
ok(b.cells[0].sub==='Amazon基準価格','★仮の出どころ（Amazon基準価格）も出す');
ok(b.cells[0].dim&&+b.cells[0].dim<1,'★仮の仕入値は色を薄くする');
ok(b.cells[1].main==='$'+b.price.toFixed(2),'★売値は書き出す売値');
ok(b.cells[1].sub==='≈¥'+(Math.round(b.price*160/100)*100).toLocaleString(),
   '★売値の下に円換算を小さく出す');
ok(b.cells[2].main.indexOf('¥'+b.profit.toLocaleString())===0,
   '★利益は今の計算（手数料・送料・為替込み）の値');
ok(/利益率 \d+\.\d%/.test(b.cells[2].sub)&&!/%/.test(b.cells[2].main),
   '★利益率は大きい数字の横ではなく、下の小さい行に出す（6.48・はみ出し防止）');
ok(b.input===''&&b.ph==='10900（仮）',
   '★仕入値欄は 0 ではなく、仮の値を placeholder で薄く出す');

console.log('\n=== 利益の色（目標・下限の境目）===');
const col=await p.evaluate(()=>{
  const pick=(html)=>{
    const d=document.createElement('div'); d.innerHTML=html;
    const c=d.firstChild.children[2];
    return { col:c.children[1].style.color, main:c.children[1].textContent,
             sub:c.children[2].textContent };
  };
  const base=+$('baseProfit').value, tgt=Math.round(csvTargetYen(10000));
  return { tgt:tgt, base:base,
    over:pick(moneyBarHtml({cost:10000,price:100,profit:tgt+1})),
    just:pick(moneyBarHtml({cost:10000,price:100,profit:tgt})),
    mid:pick(moneyBarHtml({cost:10000,price:100,profit:base})),
    under:pick(moneyBarHtml({cost:10000,price:100,profit:base-1})),
    minus:pick(moneyBarHtml({cost:10000,price:100,profit:-500})),
    none:pick(moneyBarHtml({cost:0,price:100,profit:null,costUnknown:true})) };
});
console.log('   目標 ¥'+col.tgt+'／下限 ¥'+col.base);
Object.keys(col).forEach(k=>{ if(col[k]&&col[k].col!==undefined)
  console.log('   '+k+': '+col[k].main+' '+col[k].col+' 「'+col[k].sub+'」'); });
ok(col.over.col==='var(--good)'&&col.just.col==='var(--good)',
   '★目標利益以上は緑（ちょうどでも緑）');
ok(col.mid.col==='rgb(138, 109, 0)'||col.mid.col==='#8a6d00',
   '★下限利益以上〜目標未満は黄');
ok(col.under.col==='var(--bad)'&&/下限未満/.test(col.under.sub),
   '★下限利益未満は赤＋「下限未満」');
ok(col.minus.col==='var(--bad)'&&/赤字/.test(col.minus.sub),
   '★赤字は赤＋「赤字」');
ok(col.none.main==='—','★仕入値が無い行の利益は「—」');

console.log('\n=== 仕入値が無い行 ===');
b=await band('B0MB00003Z');
console.log('   '+b.text);
ok(b.cells[0].main==='未確定'&&b.cells[0].col==='',
   '★「未確定」と出す（赤はセルの中の文字色で付ける）');
ok(/未確定/.test(b.cells[0].main)&&b.cells[2].main==='—',
   '★利益は「—」');

console.log('\n=== 仕入値が入っている行は「（仮）」を付けない ===');
b=await band('B0MB00002Z');
console.log('   '+b.text);
ok(b.cells[0].main==='¥2,500'&&!/仮/.test(b.cells[0].main),
   '★入っている仕入値はそのまま出す');
ok(!b.cells[0].dim||+b.cells[0].dim===1,'薄くしない');
ok(b.input==='2500'&&!b.ph,'★欄にはその値が入る（placeholder は出さない）');

console.log('\n=== 仕入値を入れると帯がすぐ変わる ===');
const upd=await p.evaluate(()=>{
  const r=csvList.find(x=>x.asin==='B0MB00001Z');
  const card=document.querySelector('#csvList [data-row="'+r.id+'"]');
  const el=card.querySelector('[data-cost]');
  el.value='6000';
  el.dispatchEvent(new Event('input',{bubbles:true}));
  const b=card.querySelector('[data-money]');
  const cells=Array.from(b.children).map(d=>d.children[1].textContent);
  return { cells:cells, cost:csvCostOf(r), price:csvStartPrice(r),
    profit:csvProfitAt(csvCostOf(r),r.weight,csvStartPrice(r),csvFlatOf(r)),
    target:Math.round(csvTargetYen(csvCostOf(r))),
    text:b.innerText.replace(/\n/g,' | ') };
});
console.log('   '+upd.text);
ok(upd.cells[0]==='¥6,000','★入れた値がすぐ帯に出る（仮ではなくなる）');
ok(upd.cells[1]==='$'+upd.price.toFixed(2)&&upd.price>0,'★売値も作り直す');
ok(upd.cells[2].indexOf('¥'+upd.profit.toLocaleString())===0,'★利益も作り直す');

console.log('\n=== 相場を入れても帯が残る（作り直される）===');
const sold=await p.evaluate(()=>{
  const r=csvList.find(x=>x.asin==='B0MB00001Z');
  const card=document.querySelector('#csvList [data-row="'+r.id+'"]');
  const el=card.querySelector('[data-sold]');
  el.value='150';
  el.dispatchEvent(new Event('input',{bubbles:true}));
  const b=card.querySelector('[data-money]');
  return { ok:!!b, text:b?b.innerText.replace(/\n/g,' | '):'' };
});
console.log('   '+sold.text);
ok(sold.ok&&/仕入値/.test(sold.text)&&/利益/.test(sold.text),'★帯は消えない');

console.log('\n=== 書き出すCSVは変わらない ===');
const csv=await p.evaluate(()=>{
  const r=csvList.find(x=>x.asin==='B0MB00002Z');
  const o=csvRowFor(r);
  const lines=csvBuild(r.cat,[r],'Add').split(/\r\n/);
  return { start:o['*StartPrice'], qty:o['*Quantity'], label:o['CustomLabel'],
    head:lines[1].split(',').length, cols:lines[1].slice(0,60) };
});
console.log('   '+JSON.stringify(csv));
ok(Number(csv.start)>0&&csv.label==='E-B0MB00002Z-U'&&Number(csv.qty)===1,
   '★*StartPrice・CustomLabel・数量は今までどおり');
ok(csv.head>=80,'★列の数も変わらない（帯は画面だけ）');

console.log('\n=== 販売連携タブの行にも同じ帯 ===');
await p.evaluate(()=>{
  const it=(asin,o)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'hobby',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'44'+asin.slice(-4),ebay_qty:1,
    cost_yen:2500,weight_g:400,one_off:0,dropship:0,restocking:0,ebay_first:1,
    warnings:[],notes:[],state:'ok',fba_available:1,fba_inbound:0,fba_reserved:0,
    amazon_lowest:9000,amazon_offers_json:JSON.stringify([{p:9000,c:'used'}])},o||{});
  syncData={at:new Date().toISOString(),counts:{},items:[
    it('B0MBS0001Z',{ebay_price:120}),          // 高く売れている（緑）
    it('B0MBS0002Z',{ebay_price:40}),           // 安い（赤）
    it('B0MBS0003Z',{ebay_price:70,cost_yen:null,sku_cost:null})]};  // 仕入値はAmazon基準
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E'); syncRender();
});
await openCsvBoxes(p);
const sb=await p.evaluate(()=>{
  const g=(a)=>{
    const card=Array.from(document.querySelectorAll('#syncList > div'))
      .find(d=>(d.getAttribute('data-srow')||'').indexOf(a)===0);
    const el=card.querySelector('[data-money]');
    return { cells:Array.from(el.children).map(d=>({main:d.children[1].textContent,
      sub:d.children[2].textContent,col:d.children[1].style.color})),
      text:el.innerText.replace(/\n/g,' | ') };
  };
  return { hi:g('B0MBS0001Z'), lo:g('B0MBS0002Z'), amz:g('B0MBS0003Z') };
});
console.log('   高い: '+sb.hi.text);
console.log('   安い: '+sb.lo.text);
console.log('   Amazon基準: '+sb.amz.text);
ok(sb.hi.cells[0].main==='¥2,500'&&sb.hi.cells[1].main==='$120.00',
   '★売値は eBay に出ている今の売値');
ok(sb.hi.cells[2].col==='var(--good)','★高く売れている行は緑');
ok(sb.lo.cells[2].col==='var(--bad)'&&/赤字|下限未満/.test(sb.lo.cells[2].sub),
   '★安い行は赤（赤字・下限未満）');
ok(/（仮）/.test(sb.amz.cells[0].main)&&sb.amz.cells[0].sub==='Amazon基準価格',
   '★仕入値が分からない行は Amazon基準価格を仮に使う');
console.log('\n=== iPhone の幅で金額が切れない（320／360／390／414px）===');
let bad=0, lines2=0;
for(const w of [320,360,390,414]){
  await p.setViewportSize({width:w,height:900});
  const m=await p.evaluate(()=>{
    /* 6桁の例（¥12,345・−¥1,234・$123.45）と、桁数が多い例（¥1,234,567）、
       「（仮）」付きの例を並べて、枠からあふれていないかを測る。 */
    switchTab('D');                      // 見えている状態で測る（高さが0にならないように）
    $('csvListBox').open=true;
    const box=$('csvList');
    box.innerHTML='<div class="lcard">'
      +moneyBarHtml({key:'w1',cost:12345,price:123.45,profit:-1234})
      +moneyBarHtml({key:'w2',cost:1234567,price:1234.56,profit:-123456})
      +moneyBarHtml({key:'w3',cost:10900,costTemp:true,price:116.78,profit:1250})
      +'</div>';
    const cells=[];
    Array.from(box.querySelectorAll('[data-money]')).forEach(bar=>{
      Array.from(bar.children).forEach(d=>{
        const el=d.querySelector('.mbmain'), num=el.querySelector('.mbnum');
        const st=getComputedStyle(el);
        cells.push({ text:el.textContent,
          h:Math.round(el.clientHeight), cw:Math.round(el.clientWidth),
          clip:el.scrollWidth>el.clientWidth+0.5,
          numOver:num?(num.getBoundingClientRect().width>el.clientWidth+0.5):false,
          ellipsis:st.textOverflow,
          numLines:num?Math.round(num.getClientRects().length):0,
          fs:Math.round(parseFloat(st.fontSize)*10)/10,
          lines:Math.round(el.clientHeight/parseFloat(st.lineHeight)) });
      });
    });
    return cells;
  });
  console.log('   --- '+w+'px ---');
  m.forEach(c=>console.log('      '+c.text+'　'+c.fs+'px／'+c.lines+'行'
    +(c.clip?'　切れている':'')+(c.numOver?'　はみ出し':'')));
  m.forEach(c=>{ if(c.clip||c.numOver||c.ellipsis==='ellipsis'||c.numLines>1)bad++;
                 if(c.lines>1)lines2++; });
  ok(m.every(c=>!c.clip&&!c.numOver),'★'+w+'px：枠からあふれない（全桁が見える）');
  ok(m.every(c=>c.ellipsis!=='ellipsis'),'★'+w+'px：省略（…）を使わない');
  ok(m.every(c=>c.numLines<=1),'★'+w+'px：金額の途中で改行しない（¥と数字を離さない）');
  ok(m.every(c=>c.fs>=10),'★'+w+'px：文字の大きさは下限（10px）より小さくしない');
  ok(m.every(c=>c.h>0&&c.cw>0),'（測れている：高さと幅が0でない）');
}
ok(bad===0,'★4つの幅すべてで、切れ・省略・金額の分断が無い');
ok(lines2>0,'★入らない行は枠の中で2行に折り返している');
const shrink=await p.evaluate(async()=>{
  const read=()=>{
    const el=$('csvList').querySelector('[data-money] .mbmain');
    return Math.round(parseFloat(getComputedStyle(el).fontSize)*10)/10;
  };
  return read();
});
console.log('   414px での文字の大きさ: '+shrink+'px');
await p.setViewportSize({width:320,height:900});
const small=await p.evaluate(()=>{
  const el=$('csvList').querySelector('[data-money] .mbmain');
  return Math.round(parseFloat(getComputedStyle(el).fontSize)*10)/10;
});
console.log('   320px での文字の大きさ: '+small+'px');
ok(small<shrink,'★幅が狭いほど文字を小さくする（自動）');
ok(small>=13,'★ふつうの桁数では 13px より小さくしない（読みやすさ）');
const long=await p.evaluate(()=>{
  const els=Array.from($('csvList').querySelectorAll('[data-money] .mbmain'));
  const big=els.find(e=>/1,234,567/.test(e.textContent));
  return { cls:big.className, fs:Math.round(parseFloat(getComputedStyle(big).fontSize)*10)/10 };
});
console.log('   桁数が多い金額: '+JSON.stringify(long));
ok(/mblong|mbxlong/.test(long.cls)&&long.fs<small,
   '★桁数が多い金額だけ、もうひと段小さくする');
// 画面の幅を元に戻す
await p.setViewportSize({width:390,height:900});
await T.done();
})();
