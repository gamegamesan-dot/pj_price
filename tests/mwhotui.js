/* 画面：古い値段の言い方と、手数料のだめの切り分け（6.168・【V の続き】）
   ① 値段が24時間より古いとき、いつ取り直すかも書く
      ・大事な行（「仕入れる」の印・eBay に無在庫で出品中・利益の高い行）
        → 赤で「次の自動で取り直します」
      ・それ以外 → 黒で「3日で取り直します」
   ② だめだった行から「原因を切り分ける」を押せる（GET /mw/fee/why） */
const { harness } = require('./lib');
const T = harness('画面：古い値段の言い方と手数料の切り分け（6.168）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('fx').value='160'; $('mwShipFee').value='176';
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  $('mwFbaShipM').value='425'; $('mwFbaStoreM').value='16';
  $('mwFbaSizeGame').value='m';
  window.__q=[]; window.__why=o.why;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u);
    const res=(x,st)=>new Response(JSON.stringify(x),{status:st||200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/mw\/fee\/why/.test(url)){ window.__q.push({u:'why',url:url});
      return res(window.__why); }
    if(/\/mw\/fee\/ng/.test(url))return res(o.ng||{ok:true,n:0,all:0,rows:[]});
    if(/\/mw\/amz/.test(url))
      return res({ ok:true, n:0, rows:[], seen:0, priced:0, left:0,
        per_run:120 });
    if(/\/mw\/buy/.test(url))return res({ok:true,rows:[],n:0,qty:0,yen:0,gone:0});
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return real(u,i);
  };
  syncRole='admin'; roleApply();
},o||{});

console.log('=== ① 値段の古さの言い方 ===');
await setup({});
{
  const r=await p.evaluate(()=>{
    /* 2026-11-09 18:37（日本時間）＝ 24時間より古い。 */
    const at={ price_at:'2026-11-09T09:37:00Z' };
    const fee={ fee_total:1500, fee_ref:975, fee_fba:425, fee_tax:97,
                fee_fba_ship:425, fee_fba_store:16, size_tier:'m' };
    /* 利益の高い行（粗利 4,024円） */
    const hot=Object.assign({ kishu:'NS2', price:9000, wholesale:3000 },fee,at);
    /* 粗利が小さい行（赤字ぎみ） */
    const cold=Object.assign({ kishu:'NS2', price:3600, wholesale:3000 },fee,at);
    const buy=Object.assign({},cold,{ buy_qty:1 });   // 「仕入れる」の印
    const ebay=Object.assign({},cold,{ ebay:1 });     // eBay に無在庫で出品中
    const fresh=Object.assign({},hot,
      { price_at:new Date(Date.now()-2*3600000).toISOString() });
    return { hot:mwPriceAgeHtml(hot), cold:mwPriceAgeHtml(cold),
             buy:mwPriceAgeHtml(buy), ebay:mwPriceAgeHtml(ebay),
             fresh:mwPriceAgeHtml(fresh),
             none:mwPriceAgeHtml({}),
             f:{ hot:mwPriceHot(hot), cold:mwPriceHot(cold),
                 buy:mwPriceHot(buy), ebay:mwPriceHot(ebay) },
             profit:mwAmzCalc(hot).profit };
  });
  console.log('   利益の高い行：'+r.hot.replace(/<[^>]+>/g,''));
  console.log('   ふつうの行　：'+r.cold.replace(/<[^>]+>/g,''));
  ok(r.profit>1000,'★利益の高い行の粗利は1,000円より大きい');
  ok(r.f.hot&&r.f.buy&&r.f.ebay&&!r.f.cold,
     '★★★大事な行（利益が高い・仕入れるの印・eBay 無在庫）を見分ける');
  ok(/24時間より古い・次の自動で取り直します/.test(r.hot),
     '★★★利益の高い行は「次の自動で取り直します」');
  ok(/24時間より古い・次の自動で取り直します/.test(r.buy),
     '★★★「仕入れる」の印の行も同じ');
  ok(/24時間より古い・次の自動で取り直します/.test(r.ebay),
     '★★eBay に無在庫で出品中の行も同じ');
  ok(/color:var\(--bad\)/.test(r.hot)&&/font-weight:700/.test(r.hot),
     '★★★大事な行は赤で目立たせる');
  ok(/24時間より古い・3日で取り直します/.test(r.cold)
     &&!/color:var\(--bad\)/.test(r.cold),
     '★★★それ以外は「3日で取り直します」（赤くしない）');
  ok(!/24時間より古い/.test(r.fresh),'★★新しい値段には何も添えない');
  ok(/値段の日時なし/.test(r.none),'★日時が無い行は今までどおり');
}

console.log('\n=== ② だめだった行から「原因を切り分ける」 ===');
{
  const why='手数料が返りませんでした（ClientError）：Sender: '
    +'InvalidParameterValue: The value for IsAmazonFulfilled is not valid.';
  await setup({
    ng:{ ok:true, n:1, all:749, limit:30, why:'', mp:'A1VC38T7YXB528', rows:[
      { jan:'4902371300001', name:'スチーム・ハーツ&アドヴァンスト',
        sha:'いろは商会', kishu:'NS2', asin:'B0DV5D74ZQ', price:9000,
        sent:8800, at:'2026-11-10T01:00:00Z', at_jst:'2026-11-10 10:00',
        why:why, rank_cat:'ゲーム', size_tier:'m' }] },
    why:{ ok:true, asin:'B0DV5D74ZQ', price:8800, mp:'A1VC38T7YXB528',
      tried:[
        { key:'fba', label:'いまと同じ（FBA で出す）', http:200, ok:false,
          total:null, err:why },
        { key:'mfn', label:'自分で発送（FBA にしない）', http:200, ok:true,
          total:1400, err:'' },
        { key:'omit', label:'FBA の指定を付けない', http:200, ok:true,
          total:1400, err:'' },
        { key:'price', label:'値段だけ変える（1,000円）', http:200, ok:true,
          total:300, err:'' }],
      why:'**この ASIN は FBA（Amazon から出す）の見積もりが出せません**'
        +'（値段・市場・送り方は正しい）。',
      fix:'pj からは直せません。この行は「仮の手数料」のまま使うか、'
        +'刈取の対象から外してください。' } });
  await p.evaluate(()=>{ switchTab('G');
    Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
      function(d){ d.open=true; }); });
  const got=await p.evaluate(async()=>{
    mwFeeNgShow();
    await new Promise((x)=>setTimeout(x,250));
    const b=Array.prototype.filter.call(
      $('mwFeeNgBox').querySelectorAll('button'),
      (x)=>/原因を切り分ける/.test(x.textContent));
    const had=b.length;
    const one=Array.prototype.filter.call(
      $('mwFeeNgBox').querySelectorAll('button'),
      (x)=>/この1件で試す/.test(x.textContent)).length;
    if(had)b[0].click();
    await new Promise((x)=>setTimeout(x,300));
    return { had:had, one:one,
      url:(window.__q.filter((x)=>x.u==='why')[0]||{}).url||'',
      asin:$('mwFeeTestAsin').value, price:$('mwFeeTestPrice').value,
      note:($('mwFeeTestNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+got.note.slice(0,240));
  ok(got.one===1,'★「この1件で試す」は今までどおりある（7.127）');
  ok(got.had===1,'★★★だめだった行に「原因を切り分ける」を出す');
  ok(/asin=B0DV5D74ZQ/.test(got.url)&&/price=8800/.test(got.url),
     '★★★その ASIN と**送った値段**で聞く');
  ok(got.asin==='B0DV5D74ZQ'&&got.price==='8800',
     '★★1件テストの欄にも入れる（続けて試せる）');
  ok(/いまと同じ（FBA で出す）/.test(got.note)
     &&/自分で発送（FBA にしない）/.test(got.note)
     &&/FBA の指定を付けない/.test(got.note)
     &&/値段だけ変える/.test(got.note),'★★★4通りの結果を並べる');
  ok(/だめ/.test(got.note)&&/取れた/.test(got.note),
     '★★どれが通ったかが分かる');
  ok(/FBA（Amazon から出す）の見積もりが出せません/.test(got.note),
     '★★★原因を日本語で出す');
  ok(/pj からは直せません/.test(got.note),'★★直し方も出す');
  ok(/A1VC38T7YXB528/.test(got.note),'★送っている市場も出す');
}
T.done();
})();
