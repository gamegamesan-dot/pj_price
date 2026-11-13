/* 画面：海外向け Shopify（os-）の書き出し（6.193・カジの依頼【1】【3】【4】【7】）
   ① MW 無在庫の行に「Shopify にも出す」の印（行ごと・まとめて）
   ② 書き出すと eBay 用と Shopify 用の2つのファイルが同時に出る
      （ファイル名に日付・通し番号・件数）
   ③ 書き出しのまとめ「eBay ◯件・Shopify ◯件・外した行 ◯件（理由ごと）」
   ④ 書き出し済みの印と「まだ書き出していない行だけ選ぶ」
   ⑤ Shopify の在庫・価格を直す CSV（【3】）
   ⑥ 会員用（sub-）と取り違えない（【4】） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：海外向け Shopify の書き出し（6.193）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('fx').value='160'; $('osPricePct').value='100';
  $('csvLocation').value='Tokyo, Japan';
  window.__dl=[]; window.__q=[];
  window.csvDownload=(name,text)=>{ window.__dl.push({ name:name, text:text });
    return true; };
  window.csvDownloadBlob=(name)=>{ window.__dl.push({ name:name, text:'' });
    return true; };
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body;
    const res=(x,st)=>new Response(JSON.stringify(x),{status:st||200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/os\/put/.test(url)){
      window.__q.push({ u:'osput', b:JSON.parse(String(b||'{}')) });
      return res({ ok:true, n:1 });
    }
    if(/\/os\/done/.test(url)){
      window.__q.push({ u:'osdone', b:JSON.parse(String(b||'{}')) });
      return res({ ok:true, n:1 });
    }
    if(/\/os\/diff/.test(url)){
      window.__q.push({ u:'osdiff' });
      return res(o.diff||{ ok:true, n:0, rows:[] });
    }
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
  /* MW 無在庫の行（出品リスト）。英題・説明・写真まで揃った行にする。 */
  const desc='<div><h2>Condition</h2><p>Brand new, factory sealed.</p>'
    +'<h2>Shipping</h2><ul><li>Packed in a sturdy box.</li>'
    +'<li>Delivery speed and carrier options are shown in the Shipping and '
    +'payments section of this listing.</li></ul>'
    +'<h2>Returns</h2><p>Returns are accepted under the terms shown in the '
    +'Shipping and payments section. If anything arrives damaged or not as '
    +'described, message us through eBay first and it will be put right.</p></div>';
  const mk=(i,x)=>Object.assign({
    id:'w'+i, src:'mw', sku:'', jan:'490237055000'+i, asin:'B0OS0000'+i,
    titleJa:'商品'+i, titleEn:'Game Title '+i, cat:'139973', catFixed:true,
    condId:1000, condSrc:'MW（新品）', descHtml:desc, qty:1,
    cost:3300, wRaw:150, weight:210, wManual:true, rows:1,
    dropship:true, buySource:'mw', mwSha:'いろは商会', mwKishu:'NS',
    mwStock:12, mwWholesale:3000, mwShipDays:0,
    gross:0, rank:1200, fba:false, zeroAct:'hold',
    preBuy:false, costTemp:false, baseYen:0, osOn:false, osAt:'', expAt:'',
    cartOnly:false, looseOnly:false, forceEbay:false, oneOff:false,
    oneOffSet:true, pics:[{url:'https://img.example.jp/'+i+'-a.jpg'},
                          {url:'https://img.example.jp/'+i+'-b.jpg'}],
    amzLow:'', amzLowAt:'', itemId:'', uploadErr:'', sold:'',
    price:49.99, floor:30, picsEps:0, picsErr:'',
    titleStatus:'', titleCands:[], titleNote:'', titleManual:false,
    specs:{ gameName:'Game Title '+i, platform:'Nintendo Switch',
            publisher:'Nintendo', genre:'Party', year:'2024' } },x||{});
  csvList=[mk(1),mk(2),mk(3)];
  /* 1件は自前（MW 無在庫ではない）の行。印を付けられないことを見る。 */
  csvList.push(Object.assign(mk(4),{ id:'e4', dropship:false, buySource:'',
    sku:'S-4', jan:'4902370550004' }));
  csvLog=[]; csvPick={}; csvSaveList(); switchTab('D'); csvRender();
},o||{});

const cellOf=(text,r,name)=>{
  const rows=require('../shared/shopcsv.js').splitCsv(text);
  const i=rows[0].indexOf(name);
  return i<0?undefined:rows[r][i];
};

console.log('=== ① 行ごと・まとめての「Shopify にも出す」の印 ===');
await setup({});
await openCsvBoxes(p);
{
  const t=await p.evaluate(()=>({
    box:$('csvOsBox').style.display,
    btn:!!document.querySelector('#csvList [data-oson="w1"]'),
    no:!!document.querySelector('#csvList [data-oson="e4"]'),
    note:($('csvOsNote').textContent||'') }));
  ok(t.box!=='none','★★★MW 無在庫の行があると、海外向けの欄が出る');
  ok(t.btn,'★★★行に「Shopify にも出す」のボタンが出る');
  ok(!t.no,'★★★MW 無在庫でない行にはボタンを出さない');
  ok(/MW 無在庫 3件/.test(t.note),'★★件数が出る');
}
await p.click('#csvList [data-oson="w1"]');
await p.waitForTimeout(120);
ok(await p.evaluate(()=>!!csvRowById('w1').osOn),'★★★行ごとに印が付く');
await p.click('#csvOsAll');
await p.waitForTimeout(150);
{
  const t=await p.evaluate(()=>({
    n:csvList.filter(csvOsOn).length,
    e4:!!csvRowById('e4').osOn,
    note:($('csvOsNote').textContent||'') }));
  ok(t.n===3,'★★★まとめて印を付けると MW 無在庫の3件に付く');
  ok(!t.e4,'★★★MW 無在庫でない行には付かない');
  ok(/印を付けました/.test(t.note)||/3件/.test(t.note),'★結果が出る');
}

console.log('=== ② 書き出すと2つのファイルが同時に出る（【7】）===');
/* MW 無在庫の行だけを選んで書き出す（カジの 100件ずつの書き出しと同じ形）。 */
await p.evaluate(()=>{
  csvPick={}; csvList.filter(csvOsCan).forEach((r)=>{ csvPick[r.id]=1; });
  csvExportRun(csvPickIds());
});
await p.waitForTimeout(500);
{
  const t=await p.evaluate(()=>({
    dl:window.__dl.map((x)=>x.name),
    files:csvLastFiles.map((f)=>f.name),
    note:($('csvExportNote').textContent||'').replace(/\s+/g,' '),
    q:window.__q.filter((x)=>x.u==='osput').length,
    px:Math.round(csvStartPrice(csvRowById('w1'))*160),
    put:(window.__q.filter((x)=>x.u==='osput')[0]||{}).b }));
  console.log('   ファイル：'+t.files.join(' / '));
  console.log('   まとめ：'+t.note);
  ok(t.files.length===2,'★★★eBay 用と Shopify 用の2つが出る');
  ok(/^ebay-mw-\d{8}-\d{2}-3\.csv$/.test(t.files[0]),
     '★★★eBay 用のファイル名（日付・通し番号・件数）');
  ok(/^shopify-os-\d{8}-\d{2}-3\.csv$/.test(t.files[1]),
     '★★★Shopify 用のファイル名（日付・通し番号・件数）');
  const tail=(n)=>String(n).replace(/^[a-z-]+-/,'');
  ok(tail(t.files[0])===tail(t.files[1]),
     '★★同じ書き出しは同じ日付・通し番号・件数');
  ok(/eBay 3件/.test(t.note)&&/Shopify（海外向け）3件/.test(t.note),
     '★★★まとめに「eBay ◯件・Shopify ◯件」が出る');
  ok(/外した行 0件/.test(t.note),'★★外した行の件数も出る');
  ok(t.q===1&&(t.put.items||[]).length===3,
     '★★★書き出した商品を pj-sync に控える（在庫・値段の追従のため）');
  ok((t.put.items||[])[0].price===t.px&&t.px>0,
     '★★控える値段は eBay の売値 × 為替 × ⚙%');
}
{
  const csv=await p.evaluate(()=>csvLastFiles[1].text);
  const ebay=await p.evaluate(()=>csvLastFiles[0].text);
  ok(cellOf(csv,1,'Handle')==='os-4902370550001','★★★Handle は os-<JAN>');
  ok(cellOf(csv,1,'Variant SKU')==='W-4902370550001',
     '★★★SKU は eBay と同じ W-<JAN>');
  const px=await p.evaluate(()=>Math.round(csvStartPrice(csvRowById('w1'))*160));
  ok(cellOf(csv,1,'Variant Price')===String(px)&&px>0,
     '★★★値段は eBay の売値を⚙の為替と割合で円にした額（送料込み）');
  ok(cellOf(csv,1,'Variant Grams')==='210',
     '★★★重さは eBay の送料計算に使っている重さ');
  ok(cellOf(csv,1,'Variant Inventory Policy')==='deny','★★Inventory policy は deny');
  ok(cellOf(csv,1,'Cost per item')==='3300','★★Cost per item は仕入原価');
  ok(cellOf(csv,1,'Image Src')==='https://img.example.jp/1-a.jpg',
     '★★★画像は MW の画像をそのまま');
  ok(/Nintendo Switch/.test(cellOf(csv,1,'Tags')),'★★タグに機種（正式な呼び名）');
  ok(/export/.test(cellOf(csv,1,'Tags')),'★★タグに export');
  ok(csv.indexOf('member-list')<0&&csv.indexOf('grade-')<0,
     '★★★会員の印（member-list・grade-*）は付けない');
  const body=cellOf(csv,1,'Body (HTML)');
  ok(!/ebay/i.test(body),'★★★eBay 固有の文言・リンクは入れない');
  ok(/Brand new, factory sealed\./.test(body),'★★商品の説明は残る');
  ok(!/shopify/i.test(ebay)&&ebay.indexOf('os-')<0,
     '★★★eBay の出品文に Shopify への誘導を入れない（今の決まりのまま）');
}

console.log('=== ④ 書き出し済みの印と「まだ書き出していない行だけ選ぶ」===');
{
  const t=await p.evaluate(()=>({
    at:csvRowById('w1').osAt, exp:csvRowById('w1').expAt,
    html:($('csvList').innerHTML||'') }));
  ok(!!t.at&&!!t.exp,'★★★書き出した行に書き出し済みの印が付く');
  ok(/書き出し済み/.test(t.html),'★★行にも「書き出し済み」と出る');
}
await p.evaluate(()=>{
  csvList.push(Object.assign({},csvRowById('w1'),{ id:'w9',
    jan:'4902370550009', osAt:'', expAt:'' }));
  csvSaveList(); csvRender();
});
await p.click('#csvPickNew');
await p.waitForTimeout(150);
{
  const t=await p.evaluate(()=>({ ids:csvPickIds(),
    why:csvExportSplit(null).bad.map((x)=>x.r.id+'：'+x.why),
    done:csvExportSplit(null).done.map((x)=>x.r.id+'：'+x.why),
    note:($('csvOsNote').textContent||'') }));
  console.log('   選んだ：'+t.ids.join(',')+'／不備：'+t.why.join(' ')
    +'／出品済み：'+t.done.join(' '));
  ok(t.ids.indexOf('w9')>=0&&t.ids.indexOf('w1')<0&&t.ids.indexOf('w2')<0,
     '★★★まだ書き出していない行だけが選ばれる（二重に出さない）');
  ok(/まだ書き出していない/.test(t.note),'★件数が出る');
}

console.log('=== ③ 出せない行は理由ごとに数える ===');
await setup({});
await p.evaluate(()=>{
  csvList[1].pics=[{ url:'https://m.media-amazon.com/images/I/1.jpg' }];
  csvList[2].descHtml='';
  csvList.forEach((r)=>{ if(csvOsCan(r))r.osOn=true; });
  csvSaveList(); csvRender(); csvExportRun(null);
});
await p.waitForTimeout(500);
{
  const t=await p.evaluate(()=>({
    note:($('csvExportNote').textContent||'').replace(/\s+/g,' '),
    files:csvLastFiles.map((f)=>f.name),
    csv:(csvLastFiles[1]||{}).text||'' }));
  console.log('   まとめ：'+t.note);
  ok(/eBay \d+件/.test(t.note),'★eBay の件数が出る');
  ok(/Shopify（海外向け）1件/.test(t.note),
     '★★★Shopify に出せるのは1件（画像なし・説明なしを外す）');
  ok(/MW の画像がありません/.test(t.note),
     '★★★Amazon の画像しかない行は理由を出して外す');
  ok(/不備/.test(t.note),'★★eBay 側で外した行（不備）も理由を出す');
  ok(t.csv.indexOf('media-amazon')<0,
     '★★★Amazon の画像は Shopify 用CSVに入らない');
}

console.log('=== ⑤ Shopify の在庫・価格を直す CSV（【3】）===');
await setup({ diff:{ ok:true, n:2, rows:[
  { jan:'4902370550001', handle:'os-4902370550001', sku:'W-4902370550001',
    name:'Game Title 1', usd:49.99, fx:160, pct:100, price:7998, qty:1,
    wholesale:3000, fix_at:'2026-11-13T00:00:00Z', fix_at_jst:'11/13 09:00',
    why:'gone', fix_qty:0, stock:0, now_px:0 },
  { jan:'4902370550002', handle:'os-4902370550002', sku:'W-4902370550002',
    name:'Game Title 2', usd:49.99, fx:160, pct:100, price:7998, qty:1,
    wholesale:3000, fix_at:'2026-11-13T00:00:00Z', fix_at_jst:'11/13 09:00',
    why:'price', fix_qty:1, stock:5, now_px:3400 }] } });
await openCsvBoxes(p);
await p.evaluate(()=>{ csvRowById('w2').price=59.99; csvSaveList(); });
await p.click('#csvOsFix');
await p.waitForTimeout(500);
{
  const t=await p.evaluate(()=>({
    note:($('csvOsFixNote').textContent||'').replace(/\s+/g,' '),
    name:(window.__dl[window.__dl.length-1]||{}).name,
    text:(window.__dl[window.__dl.length-1]||{}).text,
    done:(window.__q.filter((x)=>x.u==='osdone')[0]||{}).b }));
  console.log('   '+t.name+'：'+t.note);
  ok(/^shopify-os-fix-\d{8}-\d{2}-2\.csv$/.test(String(t.name)),
     '★★★直しCSVのファイル名（日付・通し番号・件数）');
  ok(cellOf(t.text,1,'Variant Inventory Qty')==='0'
     &&cellOf(t.text,1,'Status')==='draft',
     '★★★品切れは数量0・下書きに落とす');
  ok(cellOf(t.text,2,'Variant Inventory Qty')==='1',
     '★★在庫がある行は数量そのまま');
  const px2=await p.evaluate(()=>Math.round(csvStartPrice(csvRowById('w2'))*160));
  ok(cellOf(t.text,2,'Variant Price')===String(px2)&&px2>0,
     '★★★値段が変わった行は今の売値で出し直す');
  ok(String(t.text).indexOf('Body (HTML)')<0&&String(t.text).indexOf('Tags')<0,
     '★★★説明・タグの列は出さない（空で上書きしない）');
  ok((t.done.items||[]).length===2,'★★読み込み済みを pj-sync に伝える');
  ok(/品切れ 1件/.test(t.note)&&/値段 1件/.test(t.note),'★★まとめが出る');
}

console.log('=== ⑥ 会員用（sub-）と取り違えない（【4】）===');
{
  const t=await p.evaluate(()=>{
    const o=OSS.build(csvOsItems(csvList),osOpt());
    return { os:o, sub:PJ_SHOPCSV.build([{ jan:'4902370550001',
      name:'商品1', kishu:'NS', price:3463, max_qty:10, size_g:110 }],{}) };
  });
  ok(t.os.indexOf('sub-')<0,'★★★海外向けCSVに sub- の商品は入らない');
  ok(t.sub.indexOf('os-')<0,'★★★会員用CSVに os- の商品は入らない');
  ok(t.sub.indexOf('W-4902370550001')<0,
     '★★★会員用CSVに eBay の SKU（W-）は入らない');
  ok(t.os.indexOf('member-list')<0,'★★★海外向けCSVに会員の印は入らない');
}

await T.done();
})();
