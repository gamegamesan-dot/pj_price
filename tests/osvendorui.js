/* 画面：海外向け Shopify（os-）の販売元（Vendor）と直しCSV（8.85）

   カジの依頼（2026-11-21）
     1. 販売元は eBay 用に入れている Brand（ゲームなら発売元）。分からなければ空欄
     2. もう出ている os- の商品を直す「直しCSV」（Handle と Vendor だけ）
     3. eBay 用の CSV や会員用（sub-）の商品は変えない
   ここで見ること
     ① ⚙の「Vendor（代わりの名前）」の欄が無い
     ② 行ごとの販売元（ゲーム＝発売元・フィギュア＝ブランド・分からない＝空欄）
     ③ Shopify 用CSV の Vendor に店の名前が出ない
     ④ eBay 用の CSV の行は1文字も変わらない
     ⑤ 「販売元（Vendor）の直しCSVを作る」：対象の件数と CSV の中身
     ⑥ 会員用（sub-）の CSV の販売元は変わらない・作業者は押せない */
const { harness } = require('./lib');
const T = harness('画面：海外向け Shopify の販売元と直しCSV（8.85）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',(d)=>d.accept());
await p.evaluate(()=>{
  window.__dl=[];
  window.csvDownload=(name,text)=>{ window.__dl.push({ name:name, text:text }); return true; };
});

console.log('=== ① ⚙の欄 ===');
{
  const t=await p.evaluate(()=>({ has:!!$('osVendor'), type:!!$('osType'),
    opt:('vendor' in osOpt()), note:$('osCfgNote').textContent,
    adv:ADV_SUB.indexOf('osVendor')>=0||CSV_CFG_IDS.indexOf('osVendor')>=0,
    btn:($('csvOsVend')||{}).textContent }));
  ok(!t.has&&!t.opt&&!t.adv,'★★★⚙の「Vendor（代わりの名前）」の欄をやめた（設定にも送らない）');
  ok(t.type,'★Type の欄は今までどおり');
  ok(/販売元（Vendor）/.test(t.note)&&/発売元＝Publisher/.test(t.note)&&/空欄/.test(t.note),
     '★★⚙に、販売元の決め方（Brand／発売元・分からなければ空欄）を書いてある');
  ok(/販売元（Vendor）の直しCSVを作る/.test(t.btn||''),'★★直しCSV のボタンがある');
}

/* 出品リストの行（MW 無在庫）。 */
const setup=async()=>await p.evaluate(()=>{
  var mk=function(n,cat,x){
    return Object.assign({ id:'r'+n, src:'mw', sku:'', jan:'490237055'+String(1000+n),
      asin:'B0OS0000'+n, titleJa:'テスト'+n,
      titleEn:'Test Item '+n+' Nintendo Switch Japan',
      cat:cat, catFixed:true, catDone:true, condId:1000, cost:1200, qty:1, weight:200,
      pics:[{url:'https://img.test/i/20261121/'+n+'.jpg'}],
      descHtml:'<div><p>x</p></div>', specs:{},
      buySource:'mw', dropship:true, mwKishu:'NS', mwSha:'MC02', osOn:true,
      osAt:'2026-11-18', zeroAct:'hold', fba:false, oneOff:false, itemId:'', sold:'',
      price:30, titleStatus:'', titleCands:[], titleNote:'', titleManual:false },x||{});
  };
  var G='139973';
  csvList=[
    /* 1 ゲーム：発売元あり・ブランドなし（今まで店の名前になっていた行） */
    mk(1,G,{ specs:{ gameName:'Game One', platform:'Nintendo Switch',
                     publisher:'Nintendo', origin:'Japan' } }),
    /* 2 ゲーム：発売元もブランドも分からない */
    mk(2,G,{ specs:{ gameName:'Game Two', platform:'Nintendo Switch', origin:'Japan' } }),
    /* 3 フィギュア：ブランドあり（前から正しい） */
    mk(3,'261055',{ mwKishu:'b2cchara_figure',
                    specs:{ brand:'Bandai Spirits', origin:'China' } }),
    /* 4 フィギュア：ブランドなし */
    mk(4,'261055',{ mwKishu:'b2cchara_figure', specs:{ origin:'China' } }),
    /* 5 ゲーム：発売元あり（Sega） */
    mk(5,G,{ specs:{ gameName:'Game Five', platform:'Sony PlayStation 5',
                     publisher:'Sega', origin:'Japan' } }),
    /* 6 ゲーム：発売元が eBay の決まり文句 */
    mk(6,G,{ specs:{ gameName:'Game Six', platform:'Nintendo Switch',
                     publisher:'Does not apply', origin:'Japan' } }),
    /* 7 ゲーム：発売元なし・ブランドあり（前からブランドが出ていた） */
    mk(7,G,{ specs:{ gameName:'Game Seven', platform:'Nintendo Switch',
                     brand:'Keys Factory', origin:'Japan' } }) ];
  csvPick={}; csvSaveList(); csvRender();
});
await setup();

console.log('\n=== ② 行ごとの販売元 ===');
{
  const t=await p.evaluate(()=>csvList.map(function(r){
    return { id:r.id, v:csvOsVendorOf(r), old:csvOsBrandOld(r),
             item:csvOsItem(r).vendor, brand:csvOsItem(r).brand }; }));
  console.log('   '+t.map((x)=>x.id+':'+(x.v||'（空欄）')).join('　'));
  ok(t[0].v==='Nintendo'&&t[4].v==='Sega','★★★ゲームは発売元（eBay の Publisher）');
  ok(t[1].v==='','★★★発売元もブランドも分からないゲームは空欄');
  ok(t[2].v==='Bandai Spirits','★★★フィギュアは eBay の Brand');
  ok(t[3].v==='','★★ブランドが分からないフィギュアは空欄');
  ok(t[5].v==='','★★「Does not apply」は販売元にしない');
  ok(t[6].v==='Keys Factory','★★発売元が無くブランドがあるゲームは、今までどおりブランド');
  ok(t.every((x)=>x.item===x.v&&x.brand===x.old),
     '★書き出す品物に、販売元と（説明用の）ブランドを分けて渡す');
}

console.log('\n=== ③④ Shopify 用CSV と eBay 用CSV ===');
{
  const t=await p.evaluate(()=>{
    /* eBay 用の行（書き出す中身）を、Shopify 用を作る前後で比べる。 */
    var eb0=JSON.stringify(csvList.map(function(r){ return csvRowFor(r); }));
    var csv=OSS.build(csvList.map(csvOsItem),osOpt());
    var eb1=JSON.stringify(csvList.map(function(r){ return csvRowFor(r); }));
    var rows=PJ_SHOPCSV.splitCsv(csv), h=rows[0];
    var first={};                       // Handle ごとの最初の行（画像の行は除く）
    rows.slice(1).forEach(function(r){
      var k=r[h.indexOf('Handle')];
      if(!first[k]&&r[h.indexOf('Title')])first[k]=r; });
    var v=function(n){ return (first['os-490237055'+String(1000+n)]||[])[h.indexOf('Vendor')]; };
    var b=function(n){ return (first['os-490237055'+String(1000+n)]||[])[h.indexOf('Body (HTML)')]; };
    var e=csvList.map(function(r){ return csvRowFor(r); });
    return { same:eb0===eb1, v:[1,2,3,4,5,6,7].map(v), csv:csv,
             b1:b(1), b3:b(3),
             pub1:e[0]['C:Publisher'], brand3:e[2]['C:Brand'],
             ebHasVendor:Object.keys(e[0]).some(function(k){ return /vendor/i.test(k); }) };
  });
  console.log('   Vendor '+JSON.stringify(t.v));
  ok(JSON.stringify(t.v)===JSON.stringify(['Nintendo','','Bandai Spirits','','Sega','','Keys Factory']),
     '★★★Shopify 用CSV の Vendor：Brand／発売元・分からなければ空欄');
  ok(t.csv.indexOf('Omakase Ship')<0,'★★★CSV に店の名前が出ない');
  ok(t.v[0]===t.pub1&&t.v[2]===t.brand3,
     '★★★eBay 用に入れている値（C:Publisher・C:Brand）と同じ');
  ok(t.same&&!t.ebHasVendor,'★★★eBay 用の CSV の行は1文字も変わらない');
  ok(!/<li>Brand:/.test(t.b1)&&/<li>Brand: Bandai Spirits<\/li>/.test(t.b3),
     '★★説明の「Brand」の行は今までどおり（ゲームに発売元を足さない）');
}

console.log('\n=== ⑤ 販売元（Vendor）の直しCSV ===');
{
  const t=await p.evaluate(async()=>{
    $('syncApi').value='https://sync.example'; $('syncKey').value='k';
    syncRole='admin'; roleApply();
    var calls=[]; var real=window.fetch;
    var J=function(n){ return '490237055'+String(1000+n); };
    window.fetch=async function(u,i){
      var url=String(u);
      if(/\/os\//.test(url)){
        calls.push(String((i||{}).method||'GET')+' '+url.replace(/^.*\/os\//,'/os/'));
        if(/\/os\/list/.test(url))
          return new Response(JSON.stringify({ ok:true, n:8, rows:
            [1,2,3,4,5,6,7].map(function(n){
              return { jan:J(n), handle:'os-'+J(n), name:'Item '+n, at:'2026-11-18' }; })
            .concat([{ jan:'4902370559999', handle:'os-4902370559999',
                       name:'リストに無い商品', at:'2026-11-10' }]) }),{status:200});
        return new Response('{"ok":true}',{status:200});
      }
      return real(u,i);
    };
    window.__dl=[];
    var before=JSON.stringify(csvList);
    await csvOsVendGo();
    var f=window.__dl[0]||{ name:'', text:'' };
    var out={ name:f.name, text:f.text, note:$('csvOsVendNote').textContent,
              calls:calls.slice(), same:before===JSON.stringify(csvList),
              plan:csvOsVendPlan([1,2,3,4,5,6,7].map(function(n){ return { jan:J(n) }; })) };
    /* 直すものが無いとき。 */
    window.__dl=[]; calls.length=0;
    var keep=csvList; csvList=csvList.filter(function(r){ return r.id==='r3'||r.id==='r7'; });
    window.fetch=async function(u,i){
      if(/\/os\/list/.test(String(u)))
        return new Response(JSON.stringify({ ok:true, n:2, rows:[
          { jan:J(3), handle:'os-'+J(3) },{ jan:J(7), handle:'os-'+J(7) }] }),{status:200});
      return real(u,i);
    };
    await csvOsVendGo();
    out.none={ dl:window.__dl.length, note:$('csvOsVendNote').textContent };
    csvList=keep;
    /* 作業者は押せない。 */
    syncRole='staff'; roleApply();
    window.__dl=[]; var c2=0;
    window.fetch=async function(u,i){ if(/\/os\//.test(String(u)))c2++; return real(u,i); };
    try{ await csvOsVendGo(); }catch(e){}
    out.worker={ dl:window.__dl.length, calls:c2 };
    syncRole='admin'; roleApply();
    window.fetch=real;
    return out;
  });
  console.log('   '+t.note.replace(/\s+/g,' ').slice(0,200));
  console.log(t.text.trim().split('\n').map((l)=>'   '+l).join('\n'));
  const rows=t.text.trim().split('\n');
  ok(rows[0]==='Handle,Vendor','★★★直しCSV は Handle と Vendor の2列だけ');
  ok(rows.length===6,'★★★直す対象は5件（前からブランドが入っている2件は入れない）');
  ok(rows.indexOf('os-4902370551001,Nintendo')>0&&rows.indexOf('os-4902370551005,Sega')>0,
     '★★★発売元が分かるゲームに、発売元を入れる');
  ok(rows.indexOf('os-4902370551002,')>0&&rows.indexOf('os-4902370551004,')>0
     &&rows.indexOf('os-4902370551006,')>0,
     '★★★分からない行は Vendor を空欄にする（店の名前を消す）');
  ok(!/os-4902370551003|os-4902370551007|os-4902370559999/.test(t.text),
     '★★前からブランドが入っている行・出品リストに無い行は入れない');
  ok(t.text.indexOf('Omakase Ship')<0&&!/sub-/.test(t.text),
     '★★店の名前・会員用の商品は出てこない');
  ok(/書き出した os- の商品 8件/.test(t.note)&&/直す対象（販売元が店の名前の行） 5件/.test(t.note)
     &&/Brand／発売元を入れる 2件/.test(t.note)&&/分からないので空欄にする 3件/.test(t.note),
     '★★★対象の件数を出す（8件のうち 5件：入れる 2件・空欄 3件）');
  ok(/前からブランドが入っている 2件は対象外/.test(t.note)
     &&/1件は出品リストに無いので分かりません/.test(t.note),
     '★★対象外と、出品リストに無い件数も出す');
  ok(/Overwrite products with matching handles/.test(t.note)
     &&/Handle と Vendor の2列だけ/.test(t.note),'★読み込み方を出す');
  ok(/^shopify-os-vendor-\d{8}-\d{2}-5\.csv$/.test(t.name),'★ファイル名に件数が入る：'+t.name);
  ok(t.calls.join()==='GET /os/list'&&t.same,
     '★★★pj-sync は読むだけ・出品リストも書き換えない（CSV を作るだけ）');
  ok(t.plan.go.length===2&&t.plan.blank.length===3&&t.plan.kept.length===2,
     '★数え方（入れる・空欄・対象外）');
  ok(t.none.dl===0&&/直すものはありません/.test(t.none.note),
     '★★直すものが無ければ CSV を作らない');
  ok(t.worker.dl===0&&t.worker.calls===0,'★★★作業者のキーでは押せない');
}

console.log('\n=== ⑥ 会員用（sub-）の CSV の販売元は変わらない ===');
{
  const t=await p.evaluate(()=>{
    $('mwSubVendor').value='Omakase Stock';
    var row={ jan:'4902370551011', kishu:'NS', grades:'light', amz_name:'テストのゲーム',
              price:3645, max_qty:3, size_tier:'s', size_g:110 };
    var r=PJ_SHOPCSV.rowOf(row,mwSubOpt());
    var k=Object.keys(r).filter(function(x){ return /^Vendor$/i.test(x); })[0];
    return { v:r[k], h:r[Object.keys(r).filter(function(x){ return /Handle/i.test(x); })[0]] };
  });
  ok(t.v==='Omakase Stock'&&/^sub-/.test(t.h),
     '★★★会員用の商品の販売元は、今までどおり⚙（会員用の Vendor）の値');
}

console.log('\n=== 版 ===');
{
  const fs=require('fs'), path=require('path');
  const v=await p.evaluate(()=>APP_V);
  const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  ok(sw.indexOf("'pj-pricing-"+v+"'")>=0&&+v.slice(1)>=333,
     '★sw.js と APP_V がそろっている（'+v+'）');
}
await T.done();
})();
