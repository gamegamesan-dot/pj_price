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

console.log('\n=== ④ 値段だけを直す CSV（8.98：Title・公開している商品だけ・読み込んでから記録）===');
const SH=(st,title,on)=>({ status:st, title:title, on:on!==false, live:st==='ACTIVE'&&on!==false });
const PX={ ok:true, n:6, shop_ok:true, rows:[
  { jan:'4902370550002', handle:'os-4902370550002', name:'Octopath Traveler 0', price:12222, qty:1, wholesale:5000, now_px:5000, why:'',
    shop:SH('ACTIVE','Octopath Traveler 0 Nintendo Switch Japan, Shop Title') },
  { jan:'4902370550001', handle:'os-4902370550001', name:'Game 1', price:5722, qty:1, wholesale:3000, now_px:3000, why:'',
    shop:SH('ACTIVE','Game 1 Japan') },
  { jan:'4902370550003', handle:'os-4902370550003', name:'Game 3', price:15200, qty:0, wholesale:7000, now_px:0, why:'gone',
    shop:SH('ACTIVE','Game 3 Japan') },
  { jan:'4902370550009', handle:'os-4902370550009', name:'Game 9', price:6000, qty:1, wholesale:0, now_px:0, why:'',
    shop:SH('ACTIVE','Game 9 Japan') },
  { jan:'4260650747380', handle:'os-4260650747380', name:'Not public', price:9000, qty:1, wholesale:4000, now_px:4000, why:'',
    shop:SH('DRAFT','Draft title') },
  { jan:'4902370550010', handle:'os-4902370550010', name:'Gone', price:9000, qty:1, wholesale:4000, now_px:4000, why:'',
    shop:SH('MISSING','',false) }] };
await setup({ px:PX });
await openCsvBoxes(p);
await p.evaluate(()=>{ try{ lsSet('pj:ospx:pending:v1',''); }catch(e){} $('csvOsPx').click(); });
await p.waitForTimeout(500);
{
  const t=await p.evaluate(()=>({ f:window.__dl[0]||{}, note:($('csvOsPxNote').textContent||'').replace(/\s+/g,' '),
    post:window.__q.filter((x)=>x.u==='ospx'&&x.m==='POST').length,
    pend:!!document.getElementById('csvOsPxPend') }));
  console.log('   '+t.f.name+'　'+String(t.f.text||'').replace(/\n/g,' | '));
  console.log('   '+t.note.slice(0,300));
  const rows=String(t.f.text||'').trim().split('\n');
  ok(/^shopify-os-price-\d{8}-\d{2}-2\.csv$/.test(t.f.name||''),'★★ファイル名（値段が変わる2件）');
  ok(rows[0]==='Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Price','★★★列に Title（上書きインポートで必須・8.98）');
  ok(rows.indexOf('os-4902370550002,"Octopath Traveler 0 Nintendo Switch Japan, Shop Title",Title,Default Title,W-4902370550002,8689')>0
     &&rows.indexOf('os-4902370550003,Game 3 Japan,Title,Default Title,W-4902370550003,11656')>0,
     '★★★Title はいまの Shopify の題名のまま（カンマ入りも壊れない）・値段は新しい式');
  ok(rows.length===3,'★★値段が変わらない商品・卸値が分からない商品は入れない');
  ok(!/4260650747380|4902370550010/.test(String(t.f.text)),'★★★公開していない商品（下書き・Shopify に無い）は入れない');
  ok(/公開していないので入れなかった 2件/.test(t.note)&&/4260650747380（下書き）/.test(t.note)&&/Shopify に無い/.test(t.note),
     '★★★入れなかった商品と理由を出す');
  ok(!/(^|,)(5000|7000|5500|7700)(,|$)/m.test(String(t.f.text))&&!/wholesale|いろは/.test(String(t.f.text)),
     '★★★卸値・仕入れ先は CSV に入れない');
  ok(/¥12,222 → ¥8,689/.test(t.note),'★★結果に変更前 → 変更後');
  ok(t.post===0&&t.pend,'★★★作っただけでは pj-sync に記録しない（「Shopify に読み込みました」まで待つ）');
}
/* 読み込む前に CSV を失った → もう一度同じ CSV を出せる（ページを開き直しても）。 */
{
  const a=await p.evaluate(()=>({ text:window.__dl[0].text, name:window.__dl[0].name }));
  await p.evaluate(()=>{ window.__dl=[]; document.getElementById('csvOsPxAgain').click(); });
  const b=await p.evaluate(()=>window.__dl[0]||{});
  ok(b.text===a.text&&b.name===a.name,'★★★「もう一度同じ CSV を出す」で同じ中身・同じ名前');
  await p.evaluate(()=>{ $('csvOsPxNote').innerHTML=''; window.__dl=[]; });
  const again=await p.evaluate(()=>{ try{ $('csvOsPxNote').innerHTML=osPxPendHtml(); }catch(e){} return !!document.getElementById('csvOsPxPend'); });
  ok(again,'★★開き直しても、読み込みの印を付けていない CSV が出る（この端末に控える）');
  /* もう一度「値段の直しCSVを作る」を押しても、記録していないので同じ品が出る。 */
  await p.evaluate(()=>{ window.confirm=()=>true; window.__dl=[]; $('csvOsPx').click(); });
  await p.waitForTimeout(400);
  const c=await p.evaluate(()=>(window.__dl[0]||{}).text||'');
  ok(c.split('\n').length===a.text.split('\n').length&&c.indexOf('8689')>0,'★★作り直しても同じ品が出る（記録していないので）');
  /* 読み込みました → ここで記録する。 */
  await p.evaluate(()=>document.getElementById('csvOsPxDone').click());
  await p.waitForTimeout(400);
  const d=await p.evaluate(()=>({ post:(window.__q.filter((x)=>x.u==='ospx'&&x.m==='POST')[0]||{}).b,
    pend:osPxPendGet(), note:($('csvOsPxNote').textContent||'') }));
  ok(d.post&&d.post.items.length===2&&d.post.items.some((x)=>x.jan==='4902370550002'&&x.price===8689&&x.wholesale===5000),
     '★★★「Shopify に読み込みました」で値段と卸値を pj-sync に記録する');
  ok(d.pend===null&&/記録しました/.test(d.note),'★★記録したら控えを消す');
}
/* Shopify の題名・状態が読めないときは作らない（Title が要るので）。 */
await setup({ px:{ ok:true, n:1, shop_ok:false, shop_why:'Shopify の鍵が pj-sync に登録されていません', rows:PX.rows.slice(0,1) } });
await openCsvBoxes(p);
await p.evaluate(()=>{ try{ lsSet('pj:ospx:pending:v1',''); }catch(e){} window.__dl=[]; $('csvOsPx').click(); });
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>({ n:window.__dl.length, note:$('csvOsPxNote').textContent||'' }));
  ok(t.n===0&&/題名と公開の状態を読めませんでした/.test(t.note)&&/鍵/.test(t.note),'★★★題名と状態が読めなければ作らない（理由を出す）');
}

await T.done();
})();
