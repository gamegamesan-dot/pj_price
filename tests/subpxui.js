/* 画面：会員に出す販売価格と、仕入れタブの畳んである欄
   （6.178／6.179・【2】／【5】）

   ① ⚙に「会員向けの販売価格」の欄が出る（手数料・梱包材・上乗せ・粗利の下限）
      掛け率（mwSubMarkup）はもう無い
   ② Shopify 用 CSV：Price は出し直すたびに決め直し、Cost per item に仕入原価
   ③ 人が直した値（おすすめ値の範囲の外）は決め直さない
   ④ 決め直した販売価格は pj-sync に控え直す
   ⑤ 仕入れタブの「CSVで書き出す」「注文用CSV」は畳んである欄に入っている
      （消していない。「仕入れる行の JAN をコピー」は今までの場所） */
const { harness } = require('./lib');
const T = harness('画面：会員の販売価格と畳んである欄（6.178／6.179）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const SUB=(o)=>Object.assign({
  jan:'4902370550467', name:'スーパーマリオパーティ ジャンボリー',
  asin:'B0D1GSZJ8T', kishu:'Switch', on:1, max_qty:3,
  /* 6.183：機種がゲームかどうかで重さの決め方が変わる。 */
  price:0, grades:'', cost:3476, size_tier:'s', size_g:110, size_long:14,
  amz_price:6000, fee_total:900 },o||{});

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176';
  $('mwSubCardFee').value='3.55'; $('mwSubPack').value='30';
  $('mwSubAddMin').value='10'; $('mwSubAddMax').value='150';
  $('mwSubGrossMin').value='800';
  window.__q=[]; window.__dl=[];
  const real=window.fetch;
  window.csvDownload=(name,text)=>{ window.__dl.push({ name:name, text:text });
    return true; };
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body;
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/mw\/sub\/put/.test(url)){
      window.__q.push({ u:'subput', b:JSON.parse(String(b||'{}')) });
      return res({ ok:true, n:1 });
    }
    if(/\/mw\/sub/.test(url))
      return res({ ok:true, table_ok:true, n:(o.rows||[]).length,
                   rows:o.rows||[] });
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return real(u,i);
  };
  syncRole='admin'; roleApply();
},o||{});

console.log('=== ① ⚙の欄（掛け率はもう無い）===');
{
  const t=await p.evaluate(()=>({
    markup:!!document.getElementById('mwSubMarkup'),
    fee:($('mwSubCardFee')||{}).value,
    pack:($('mwSubPack')||{}).value,
    lo:($('mwSubAddMin')||{}).value,
    hi:($('mwSubAddMax')||{}).value,
    min:($('mwSubGrossMin')||{}).value }));
  console.log('   '+JSON.stringify(t));
  ok(t.markup===false,'★★★掛け率の欄（mwSubMarkup）は外した');
  ok(t.fee==='3.55','★★★カード決済手数料の既定は 3.55%');
  ok(t.pack==='30','★★★梱包材の既定は ¥30');
  ok(t.lo==='10'&&t.hi==='150','★★★上乗せの既定は ¥10〜150');
  ok(t.min==='800','★★★会員の粗利の下限の既定は ¥800');
  ok(await p.evaluate(()=>typeof mwSubPxOpt==='function'),
     '★おすすめ値の設定を1か所で読む（mwSubPxOpt）');
}

console.log('\n=== ② Shopify 用 CSV（決め直す・仕入原価）===');
await setup({ rows:[SUB({})] });
{
  const d=await p.evaluate(async()=>{
    window.__dl=[]; window.__q=[];
    await mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,300));
    return { dl:window.__dl, q:window.__q };
  });
  ok(d.dl.length===1,'★CSV を書き出す');
  const rows=require('../shared/shopcsv.js').splitCsv(d.dl[0].text);
  const col=(name)=>{ const i=rows[0].indexOf(name);
    return i<0?undefined:rows[1][i]; };
  console.log('   Price '+col('Variant Price')
    +'／Cost per item '+col('Cost per item'));
  ok(col('Cost per item')==='3476',
     '★★★Cost per item に仕入原価（卸値×1.1＋MW送料）が入る');
  const px=+col('Variant Price');
  ok(px>=Math.round(3516/(1-0.0355))&&px<=Math.round(3656/(1-0.0355))+4,
     '★★★Price は仕入原価＋梱包材＋上乗せ（¥10〜150）を割り戻した額');
  ok(px%10!==0||px%100!==0,'★★10円・100円単位に切り上げない');
  /* 決め直した販売価格を pj-sync に控え直す（6.178）。 */
  const put=(d.q.filter((x)=>x.u==='subput')[0]||{}).b||{};
  console.log('   '+JSON.stringify(put));
  ok(put.jans&&put.jans[0]==='4902370550467','★出した印を送る');
  ok(put.prices&&+put.prices['4902370550467']===px,
     '★★★決め直した販売価格も一緒に控える');
}

console.log('\n=== ③ 出し直すたびに変わる／人が直した値はそのまま ===');
{
  const seen=await p.evaluate(async()=>{
    const got={};
    for(let i=0;i<8;i++){
      window.__dl=[];
      await mwSubCsvGo();
      await new Promise((x)=>setTimeout(x,80));
      const t=window.__dl[0]?window.__dl[0].text:'';
      const rows=PJ_SHOPCSV.splitCsv(t);
      const i2=rows[0].indexOf('Variant Price');
      got[rows[1][i2]]=1;
    }
    return Object.keys(got).length;
  });
  console.log('   '+seen+'通りの値段');
  ok(seen>=2,'★★★出し直すたびに上乗せを決め直す');
}
/* 人が直した値（おすすめ値の範囲の外）はそのまま使う。 */
await setup({ rows:[SUB({ price:9800 })] });
{
  const px=await p.evaluate(async()=>{
    window.__dl=[];
    await mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,200));
    const rows=PJ_SHOPCSV.splitCsv(window.__dl[0].text);
    const i=rows[0].indexOf('Variant Price');
    return rows[1][i];
  });
  ok(px==='9800','★★★人が直した値は決め直さない');
}

console.log('\n=== ③の2 ゲームソフトは一律の重さ（6.183・【2】）===');
await setup({ rows:[SUB({ kishu:'NS', size_g:118 })] });
{
  const t=await p.evaluate(()=>({
    g:($('mwSubGameG')||{}).value,
    fn:(typeof mwSubGameG==='function')?mwSubGameG():null }));
  console.log('   '+JSON.stringify(t));
  ok(t.g==='100','★★★⚙「ゲームソフト1本の重さ」の既定は 100g');
  ok(t.fn===100,'★★⚙の値を1か所で読む');
  const w=await p.evaluate(async()=>{
    window.__dl=[];
    await mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,250));
    const rows=PJ_SHOPCSV.splitCsv(window.__dl[0].text);
    const i=rows[0].indexOf('Variant Grams');
    return rows[1][i];
  });
  console.log('   Variant Grams '+w);
  ok(w==='100','★★★ゲームソフトは 118g ではなく 100g で出る');
  /* ⚙を 0 にすると今までどおり（Amazon の梱包重量＋足し分）。 */
  const w2=await p.evaluate(async()=>{
    $('mwSubGameG').value='0';
    window.__dl=[];
    await mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,250));
    $('mwSubGameG').value='100';
    const rows=PJ_SHOPCSV.splitCsv(window.__dl[0].text);
    const i=rows[0].indexOf('Variant Grams');
    return rows[1][i];
  });
  ok(w2==='118','★★★0 にすると今までどおり（118g）');
}
await setup({ rows:[SUB({ kishu:'FIG', size_g:400 })] });
{
  const w=await p.evaluate(async()=>{
    $('mwSubAddG').value='50';
    window.__dl=[];
    await mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,250));
    $('mwSubAddG').value='0';
    const rows=PJ_SHOPCSV.splitCsv(window.__dl[0].text);
    const i=rows[0].indexOf('Variant Grams');
    return rows[1][i];
  });
  console.log('   フィギュア: '+w);
  ok(w==='450','★★★ゲーム以外は今までどおり（梱包重量＋足し分）');
}

console.log('\n=== ④ 仕入れタブの畳んである欄（6.179・【5】）===');
{
  const t=await p.evaluate(()=>{
    const box=document.getElementById('csvMwMoreBox');
    const inBox=(id)=>!!(box&&box.querySelector('#'+id));
    const copy=document.getElementById('csvMwJanCopy');
    return { box:!!box, open:!!(box&&box.open),
             csv:inBox('csvMwAmzCsv'), order:inBox('csvMwBuyCsv'),
             copyIn:!!(box&&copy&&box.contains(copy)),
             copyAlive:!!copy,
             sum:box?String((box.querySelector('summary')||{}).textContent||''):'' };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.box===true,'★★★「その他（ときどき使う）」の欄がある');
  ok(t.open===false,'★★★畳んである（既定は閉じている）');
  ok(/ときどき使う/.test(t.sum),'★見出しに「ときどき使う」と出る');
  ok(t.csv===true,'★★★「CSVで書き出す」はその中にある');
  ok(t.order===true,'★★★「注文用CSV」もその中にある');
  ok(t.copyAlive===true&&t.copyIn===false,
     '★★★「仕入れる行の JAN をコピー」は今までの場所（畳まない）');
  /* 畳んであっても押せる（消していない）。 */
  ok(await p.evaluate(()=>typeof $('csvMwBuyCsv').onclick==='function'
     ||!!$('csvMwBuyCsv')),'★★消していない（押せる）');
}

T.done();
})();
