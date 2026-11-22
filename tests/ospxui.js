/* 画面：海外向け Shopify（os-）の値段を卸値から出す（8.94・v342）
   ① ⚙：目標利益（既定は eBay と同じ）・Shopify の決済手数料（既定 3.6%）
   ② 変更前と変更後の値段の比べ（出品リストの os- の行）と、行の「計算の詳細」の内訳
   ③ 書き出す Shopify 用CSV の値段は新しい式（為替・送料・eBay の手数料は使わない）
   ④ 値段だけを直す CSV（/os/px → 値段が変わる商品だけ・卸値は入れない）
   ⑤ 卸値・仕入れ先の名前は Shopify の CSV に出さない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：os- の値段を卸値から出す（8.94）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('fx').value='160'; $('osPricePct').value='100';
  $('baseProfit').value='1000'; $('linkRate').value='30';
  $('osProfitEbay').checked=true; $('osPayPct').value='3.6';
  window.__dl=[]; window.__q=[];
  window.csvDownload=(name,text)=>{ window.__dl.push({ name:name, text:text }); return true; };
  window.csvDownloadBlob=(name)=>{ window.__dl.push({ name:name, text:'' }); return true; };
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body, m=String((i||{}).method||'GET');
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/os\/px/.test(url)){
      window.__q.push({ u:'ospx', m:m, b:b?JSON.parse(String(b)):null });
      return m==='POST'?res({ ok:true, n:1 }):res(o.px||{ ok:true, n:0, rows:[] });
    }
    if(/\/os\/put/.test(url)){ window.__q.push({ u:'osput', b:JSON.parse(String(b||'{}')) }); return res({ ok:true }); }
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
  const mk=(i,x)=>Object.assign({
    id:'w'+i, src:'mw', sku:'', jan:'490237055000'+i, asin:'B0OS0000'+i,
    titleJa:'商品'+i, titleEn:'Game Title '+i, cat:'139973', catFixed:true,
    condId:1000, condSrc:'MW（新品）', descHtml:'<div><p>x</p></div>', qty:1,
    cost:3300, wRaw:150, weight:210, wManual:true, rows:1,
    dropship:true, buySource:'mw', mwSha:'いろは商会', mwKishu:'NS',
    mwStock:12, mwWholesale:3000, mwShipDays:0, osOn:true, osAt:'', expAt:'',
    cartOnly:false, looseOnly:false, forceEbay:false, oneOff:false, oneOffSet:true,
    pics:[{url:'https://img.example.jp/'+i+'-a.jpg'}], itemId:'', price:49.99, floor:30,
    titleStatus:'', titleCands:[], titleNote:'', titleManual:false,
    specs:{ gameName:'Game Title '+i, platform:'Nintendo Switch', publisher:'Nintendo' } },x||{});
  /* 仕入値（eBay の計算）は卸値×1.1＋MW の仕入れ送料（¥176）。 */
  const c=(w)=>Math.round(w*1.1)+176;
  csvList=[mk(1,{ cost:c(3000) }),mk(2,{ mwWholesale:5000, cost:c(5000), titleJa:'オクトパストラベラー0' }),
           mk(3,{ mwWholesale:7000, cost:c(7000) }),mk(4,{ mwWholesale:2000, cost:c(2000) }),
           mk(5,{ mwWholesale:10000, cost:c(10000) })];
  csvSaveList();
  switchTab('D'); csvRender();
},o||{});

console.log('=== ① ⚙ ===');
await setup({});
await openCsvBoxes(p);
{
  const t=await p.evaluate(()=>({ ids:['osProfitEbay','osProfitBase','osProfitRate','osPayPct','osShipFee','osPackFee'].map((x)=>!!$(x)),
    ship:$('osShipFee').value, pack:$('osPackFee').value,
    adv2:['osShipFee','osPackFee'].every((x)=>ADV_SUB.indexOf(x)>=0&&CSV_CFG_IDS.indexOf(x)>=0),
    ebay:$('osProfitEbay').checked, pay:$('osPayPct').value,
    adv:['osProfitBase','osProfitRate','osPayPct'].every((x)=>ADV_SUB.indexOf(x)>=0&&CSV_CFG_IDS.indexOf(x)>=0)
      &&ADV_SUBCHK.indexOf('osProfitEbay')>=0,
    a:osPxOpt(), note:($('osPxCfgNote').textContent||'') }));
  console.log('   '+JSON.stringify(t.a)+'　'+t.note);
  ok(t.ids.every(Boolean)&&t.ebay&&t.pay==='3.6','★★★目標利益（既定は eBay と同じ）・決済手数料（既定 3.6%）の欄');
  ok(t.adv&&t.adv2,'★★pj-sync に保存する設定に入っている（端末をまたいで同じ）');
  ok(t.ship==='176'&&t.pack==='50','★★★MW 仕入れ送料（既定 ¥176）・梱包材（既定 ¥50）の欄（8.95）');
  ok(t.a.profitBase===1000&&t.a.profitRate===30&&t.a.pay===3.6,'★★★既定は eBay の目標利益（下限利益 ¥1,000＋仕入値×30%）');
  ok(/卸値 ¥5,000/.test(t.note)&&/¥8,689/.test(t.note),'★★⚙に例（卸値 ¥5,000 → ¥8,689）を出す');
  ok(/MW 仕入れ送料 ¥176/.test(t.note)&&/梱包材 ¥50/.test(t.note),'★★⚙の説明に MW 仕入れ送料・梱包材');
  const off=await p.evaluate(()=>{ $('osProfitEbay').checked=false; $('osProfitBase').value='800';
    $('osProfitRate').value='10'; $('osPayPct').value='4'; $('osShipFee').value='200'; $('osPackFee').value='0';
    const a=osPxOpt(); const z=OSS.pxOf({ wholesale:5000 },osOpt());
    $('osProfitEbay').checked=true; $('osPayPct').value='3.6'; $('osShipFee').value='176'; $('osPackFee').value='50';
    return Object.assign(a,{ z:z }); });
  ok(off.profitBase===800&&off.profitRate===10&&off.pay===4,'★★オフにすると⚙の目標利益と手数料を使う');
  ok(off.ship===200&&off.pack===0&&off.z.ship===200&&off.z.pack===0
     &&off.z.price===Math.ceil((5500+200+0+off.z.profit)/0.96),'★★★⚙の MW 仕入れ送料・梱包材が値段に効く（0 も入れられる）');
}

console.log('\n=== ② 変更前と変更後・計算の詳細 ===');
{
  await p.evaluate(()=>{ osPxCfgRender(); });
  const t=await p.evaluate(()=>({
    rows:Array.prototype.map.call(document.querySelectorAll('#osPxCmp tr[data-oscmp]'),(tr)=>
      Array.prototype.map.call(tr.children,(td)=>td.textContent.replace(/\s+/g,' ').trim())),
    det:(document.querySelector('[data-ospx="w2"]')||{}).textContent||'' }));
  t.rows.forEach((r)=>console.log('   '+r.slice(0,4).join('　')));
  console.log('   詳細：'+t.det);
  ok(t.rows.length===5,'★★★出品リストの os- の行を並べる（5件）');
  const r2=t.rows.filter((r)=>/オクトパス/.test(r[0]))[0];
  const was2=await p.evaluate(()=>yen(OSS.yenOf(csvStartPrice(csvRowById('w2')),osOpt())));
  ok(r2&&r2[1]===was2&&r2[2]==='¥8,689'&&/^−¥/.test(r2[3]),
     '★★★変更前（eBay の売値 × 為替 '+was2+'）と変更後（¥8,689）・差');
  ok(t.rows.every((r)=>+r[1].replace(/\D/g,'')>+r[2].replace(/\D/g,'')),
     '★★★どの行も変更後のほうが安い（送料・eBay の手数料の二重取りが無くなる）');
  ok(/卸値（税込）¥5,500/.test(r2[4])&&/MW 仕入れ送料 ¥176/.test(r2[4])&&/梱包材 ¥50/.test(r2[4])
     &&/目標利益 ¥2,650/.test(r2[4])&&/決済手数料 ¥313（3.6%）/.test(r2[4]),
     '★★★比べの内訳（卸値・MW 仕入れ送料・梱包材・利益・手数料）を出す');
  ok(/Shopify（海外向け）の値段/.test(t.det)&&/MW 仕入れ送料 ¥176/.test(t.det)&&/梱包材 ¥50/.test(t.det)
     &&/¥8,689/.test(t.det)&&/国際送料はチェックアウトで別/.test(t.det),
     '★★★行の「計算の詳細」にも内訳（MW 仕入れ送料・梱包材つき）');
}

console.log('\n=== ③ 書き出す Shopify 用CSV ===');
{
  await p.evaluate(()=>{ window.__dl=[]; csvOsOnlyRun(); });
  const t=await p.evaluate(()=>{ const f=window.__dl[0]||{ text:'' };
    const rows=PJ_SHOPCSV.splitCsv(f.text), h=rows[0]||[];
    return { px:rows.slice(1).filter((r)=>r[h.indexOf('Handle')]&&r[h.indexOf('Variant Price')])
      .map((r)=>r[h.indexOf('Handle')]+':'+r[h.indexOf('Variant Price')]), text:f.text,
      put:(window.__q.filter((x)=>x.u==='osput')[0]||{}).b }; });
  console.log('   '+t.px.join(' / '));
  ok(t.px.indexOf('os-4902370550002:8689')>=0&&t.px.indexOf('os-4902370550001:5722')>=0,
     '★★★Shopify 用CSV の値段は新しい式（¥8,689・¥5,722）');
  ok(!/いろは商会/.test(t.text),'★★★仕入れ先の名前は Shopify の CSV に出さない');
  ok(t.put&&t.put.items.some((x)=>x.jan==='4902370550002'&&x.price===8689),'★★pj-sync に控える値段も新しい式');
}

console.log('\n=== ④ 値段だけを直す CSV ===');
await setup({ px:{ ok:true, n:4, rows:[
  { jan:'4902370550002', handle:'os-4902370550002', name:'Octopath Traveler 0', price:12222, qty:1, wholesale:5000, now_px:5000, why:'' },
  { jan:'4902370550001', handle:'os-4902370550001', name:'Game 1', price:5722, qty:1, wholesale:3000, now_px:3000, why:'' },
  { jan:'4902370550003', handle:'os-4902370550003', name:'Game 3', price:15200, qty:0, wholesale:7000, now_px:0, why:'gone' },
  { jan:'4902370550009', handle:'os-4902370550009', name:'Game 9', price:6000, qty:1, wholesale:0, now_px:0, why:'' }] } });
await openCsvBoxes(p);
await p.evaluate(()=>$('csvOsPx').click());
await p.waitForTimeout(500);
{
  const t=await p.evaluate(()=>({ f:window.__dl[0]||{}, note:($('csvOsPxNote').textContent||'').replace(/\s+/g,' '),
    post:(window.__q.filter((x)=>x.u==='ospx'&&x.m==='POST')[0]||{}).b }));
  console.log('   '+t.f.name+'　'+String(t.f.text||'').replace(/\n/g,' | '));
  console.log('   '+t.note.slice(0,260));
  const rows=String(t.f.text||'').trim().split('\n');
  ok(/^shopify-os-price-\d{8}-\d{2}-2\.csv$/.test(t.f.name||''),'★★ファイル名（値段が変わる2件）');
  ok(rows[0]==='Handle,Option1 Name,Option1 Value,Variant SKU,Variant Price','★★★値段だけの列');
  ok(rows.indexOf('os-4902370550002,Title,Default Title,W-4902370550002,8689')>0
     &&rows.indexOf('os-4902370550003,Title,Default Title,W-4902370550003,11656')>0,
     '★★★いまの卸値（品切れは控えた卸値）から新しい式で出し直す');
  ok(rows.length===3,'★★値段が変わらない商品・卸値が分からない商品は入れない');
  ok(!/(^|,)(5000|7000|5500|7700)(,|$)/m.test(String(t.f.text))&&!/wholesale|いろは/.test(String(t.f.text)),
     '★★★卸値・仕入れ先は CSV に入れない');
  ok(/2件/.test(t.note)&&/変わらない 1件/.test(t.note)&&/卸値が分からない 1件/.test(t.note)
     &&/¥12,222 → ¥8,689/.test(t.note),'★★★結果に件数と変更前 → 変更後');
  ok(t.post&&t.post.items.length===2&&t.post.items.some((x)=>x.jan==='4902370550002'&&x.price===8689&&x.wholesale===5000),
     '★★作った値段と卸値を pj-sync に控える');
}

await T.done();
})();
