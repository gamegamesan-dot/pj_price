/* 画面：会員価格の MW 送料と、会員向きの判定に利益率を足す
   （6.187／6.188・【1】【2】）

   【1】会員のぶんはカジの仕入れとまとめて MW に発注するので、5万円以上で
        送料無料になることが多く、1点あたりの MW 送料はほぼ 0。
        ⚙「会員価格に含める MW 送料（1点あたり・既定 ¥0）」で決める。
        **仕入れタブの利益（カジの利益・せどりすと方式・MW送料込み）は
        今のまま**（⚙ mwShipFee・¥176 を引く）。会員価格だけの話。
   【2】「会員向き」の判定に利益率を足す。
        会員の利益率 ＝ 会員の粗利の目安 ÷ 会員価格。
        粗利が⚙の下限（既定 ¥800）以上、または
        利益率が⚙の下限（既定 30%）以上で粗利が⚙の最低額（既定 ¥300）以上
        なら会員向き。どちらも満たさないときだけ「会員向きではありません」。

   例：あの、素晴らしい をもう一度／再装版HD 通常版
       （JAN 4573419410280・卸 ¥1,300・Amazon ¥3,000・手数料 ¥797）
       今　　：会員価格 ¥1,818・粗利 ¥385 → 会員向きではない
       直した後：会員価格 約 ¥1,636・粗利 約 ¥567・利益率 約 35% → 会員向き */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：会員価格の MW 送料と利益率の判定（6.187／6.188）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const JAN='4573419410280';
const AMZ={ ok:true, n:1, seen:1, priced:1, left:0, per_run:120, ttl_days:3,
  limit:3000, rows:[{ jan:JAN, sha:'いろは商会', kishu:'NS', cond:'新品',
  mw_name:'【新品】あの、素晴らしい をもう一度／再装版HD 通常版',
  amz_name:'あの、素晴らしい をもう一度 再装版HD', asin:'B0D1GSZJ8T',
  wholesale:1300, list_price:3300, price:3000, rank:5000, rank_cat:'ゲーム',
  stock:9, note:'', ship_text:'即日', ship_days:0, new_n:3, amz:0,
  basis:'カート', rst:'ok',
  /* 手数料は実額（会員の粗利の目安は実額の行だけ出す）。 */
  fee_total:797, fee_ref:450, fee_fba:300, fee_tax:47,
  fee_fba_ship:284, fee_fba_store:16, fee_base:3000,
  size_tier:'s', size_g:110, pics_ok:1, pics_n:1, buy_qty:0,
  price_at:'2026-11-13T00:00:00Z', amz_at:'2026-11-13T00:00:00Z',
  fee_at:'2026-11-13T00:00:00Z' }] };

await p.evaluate((x)=>{
  const AMZ=x.AMZ;
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  /* カジの仕入れの送料（利益の計算に使う）。会員価格とは別の欄。 */
  $('mwShipFee').value='176';
  $('csvMwAmzWin').checked=false;
  if($('csvMwAmzFbaNg'))$('csvMwAmzFbaNg').checked=false;
  window.__sub={};
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), op=i||{};
    if(/\/whoami/.test(url))
      return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    if(/\/mw\/sub/.test(url)){
      if(String(op.method||'')==='POST')return res({ ok:true, n:1,
        table_ok:true });
      return res({ ok:true, table_ok:true, n:0, rows:[] });
    }
    if(/\/mw\/buy/.test(url))return res({ ok:true, rows:[], n:0 });
    if(/\/mw\/amz/.test(url))return res(AMZ);
    return real(u,i);
  };
  switchTab('F'); syncRole='admin'; roleApply();
},{ AMZ:AMZ });
await openCsvBoxes(p);
await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
await p.waitForTimeout(500);

console.log('=== ① ⚙の欄と既定 ===');
{
  const t=await p.evaluate(()=>({
    ship:($('mwSubShip')||{}).value,
    min:($('mwSubGrossMin')||{}).value,
    rate:($('mwSubRateMin')||{}).value,
    floor:($('mwSubGrossFloor')||{}).value,
    o:mwSubPxOpt() }));
  console.log('   '+JSON.stringify(t));
  ok(t.ship==='0','★★★「会員価格に含める MW 送料」の既定は ¥0');
  ok(t.rate==='30','★★★「会員の利益率の下限」の既定は 30%');
  ok(t.floor==='300','★★★「そのときの粗利の最低額」の既定は ¥300');
  ok(t.min==='800','★会員の粗利の下限は今までどおり ¥800');
  ok(+t.o.ship===0&&+t.o.rateMin===30&&+t.o.grossFloor===300,
     '★★★おすすめ値の設定（mwSubPxOpt）が⚙の3つを読む');
}

console.log('\n=== ② 会員価格は MW 送料を含めない（カジの利益は今のまま）===');
{
  const t=await p.evaluate(()=>({
    subCost:mwSubCostOf({ wholesale:1300 }),
    kajiCost:mwCost({ wholesale:1300 }),
    kajiShip:mwShipFee() }));
  console.log('   '+JSON.stringify(t));
  ok(t.subCost===1430,'★★★会員の仕入原価は 卸値×1.1 だけ（1,300→1,430）');
  ok(t.kajiCost===1606&&t.kajiShip===176,
     '★★★仕入れタブの利益は今までどおり ¥176 を引く（1,430＋176）');
  /* ⚙で送料を入れたら会員価格の仕入原価だけが動く。 */
  const t2=await p.evaluate(()=>{
    $('mwSubShip').value='176';
    const a={ sub:mwSubCostOf({ wholesale:1300 }),
              kaji:mwCost({ wholesale:1300 }) };
    $('mwSubShip').value='0';
    return a;
  });
  console.log('   '+JSON.stringify(t2));
  ok(t2.sub===1606&&t2.kaji===1606,'★★⚙に入れた分は会員価格にも足される');
}

console.log('\n=== ③ 会員価格と利益率（例の商品）===');
{
  const t=await p.evaluate((j)=>{
    const r={ jan:j, wholesale:1300, price:3000, fee_total:797,
      fee_ref:450, fee_fba:300, fee_tax:47, size_tier:'s', size_g:110 };
    const px=mwSubPriceOf(r).price;
    const g=mwSubGrossOf(r,px);
    const fit=mwSubFitOf(r,px);
    return { px:px, g:g, fit:fit, fee:(mwFeeOf(r)||{}).fee };
  },JAN);
  console.log('   '+JSON.stringify(t));
  ok(t.px>=1518&&t.px<=1670,
     '★★★会員価格は約 ¥1,636（1,430＋30＋上乗せ ÷ 0.9645）');
  ok(t.g===3000-t.fee-t.px&&t.fee>=790&&t.fee<=800,
     '★★粗利＝Amazon の実売 − 手数料 − 会員価格');
  ok(t.fit.pct===Math.round(t.g/t.px*100),'★★★利益率＝粗利 ÷ 会員価格');
  ok(t.fit.pct>=30&&t.fit.ok===true&&t.fit.by==='rate',
     '★★★粗利は ¥800 未満でも、利益率 30% 以上・粗利 ¥300 以上で会員向き');
}

console.log('\n=== ④ 行に「（利益率 ◯%）」が出る／会員向きではない行だけ注意 ===');
{
  const t=await p.evaluate((j)=>{
    const el=document.getElementById('mwSubPx_'+j);
    const box=el?el.parentNode:null;
    return { px:el?el.value:null, text:box?box.textContent:'' };
  },JAN);
  console.log('   '+JSON.stringify(t));
  ok(/会員の粗利の目安/.test(t.text),'★粗利の目安を出す');
  ok(/利益率 \d+%/.test(t.text),'★★★「（利益率 ◯%）」も出す');
  ok(!/会員向きではありません/.test(t.text),
     '★★★利益率で通る行には「会員向きではありません」と出さない');
  /* ⚙の送料を ¥176 に戻すと、同じ商品が「会員向きではない」に変わる。 */
  const t2=await p.evaluate((j)=>{
    $('mwSubShip').value='176';
    mwSubPxCache={};
    mwAmzRender();
    const el=document.getElementById('mwSubPx_'+j);
    const box=el?el.parentNode:null;
    const out={ px:el?el.value:null, text:box?box.textContent:'' };
    $('mwSubShip').value='0'; mwSubPxCache={}; mwAmzRender();
    return out;
  },JAN);
  console.log('   '+JSON.stringify(t2));
  ok(+t2.px>=1700,'★送料を入れると会員価格が上がる（約 ¥1,818）');
  ok(/会員向きではありません/.test(t2.text),
     '★★★利益率が下限を割ると「会員向きではありません」と出る');
  ok(/利益率の下限 30%/.test(t2.text)&&/粗利 ¥300以上/.test(t2.text),
     '★★注意の文に⚙の下限も書く');
}

console.log('\n=== ⑤ ⚙を変えると判定が変わる ===');
{
  const t=await p.evaluate((j)=>{
    const r={ jan:j, wholesale:1300, price:3000, fee_total:797,
      fee_ref:450, fee_fba:300, fee_tax:47 };
    const px=1636;
    const a=mwSubFitOf(r,px).ok;
    $('mwSubRateMin').value='40';
    const b=mwSubFitOf(r,px).ok;
    $('mwSubRateMin').value='30';
    $('mwSubGrossFloor').value='600';
    const c=mwSubFitOf(r,px).ok;
    $('mwSubGrossFloor').value='300';
    $('mwSubGrossMin').value='300';
    const d=mwSubFitOf(r,px).by;
    $('mwSubGrossMin').value='800';
    return { a:a, b:b, c:c, d:d };
  },JAN);
  console.log('   '+JSON.stringify(t));
  ok(t.a===true,'★既定では会員向き');
  ok(t.b===false,'★★★利益率の下限を 40% にすると会員向きでなくなる');
  ok(t.c===false,'★★★粗利の最低額を ¥600 にすると会員向きでなくなる');
  ok(t.d==='gross','★★粗利の下限を下げれば粗利の道で通る');
}
await T.done();
})();
