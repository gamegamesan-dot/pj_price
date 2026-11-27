/* 画面：出品済みの無在庫（W-）の英題を作り直す（8.108・v358）

   カジの依頼（2026-11-27）
   ・英題の作り方を直す。目安は70〜80字。メーカー → 作品名 → キャラクター名（よく使われる別名）
     → 商品の種類（Figure・Prize Figure・Plush・Acrylic Stand）→ シリーズ・型番・スケール → Japan Import
   ・ゲームは「機種名 → タイトル →（Japanese Ver.）→ Japan Import」
   ・宣伝の言葉・記号の飾り・全部大文字は入れない。New は新品だけ。単語の途中で切らない
   ・出品済みの行に「タイトルを作り直す」。変更前と変更後を並べ、変わった行だけ
     Revise 用の CSV（ItemID と Title だけ）。まず50件（閲覧が少なく、まだ売れていない出品）
   ・これから出す新規の出品にも同じ作り方 */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：出品済みの無在庫の英題を作り直す（8.108）');
const ok = T.ok;
(async()=>{
const p=await T.open();

console.log('=== ① 英題の決まり（これから作る英題も同じ）===');
const a=await p.evaluate(()=>{
  const f=(u,o,opt,lo)=>figTitleFrom(u,o,!!lo,opt).text;
  const g=(u,pf,n,opt,c)=>gameTitleFrom(u,pf,n,!!c,opt).text;
  return {
    alastor:f(false,{brand:'Banpresto',series:'Hazbin Hotel',chara:'Alastor',alias:'Radio Demon',
      ja:'ハズビン・ホテル アラスター フィギュア'},{isNew:true}),
    noAlias:f(false,{brand:'Banpresto',series:'Hazbin Hotel',chara:'Alastor',
      ja:'ハズビン・ホテル アラスター フィギュア'},{isNew:true}),
    used:f(true,{brand:'Banpresto',series:'Hazbin Hotel',chara:'Alastor',ja:'フィギュア'},{isNew:true}),
    kuji:f(false,{brand:'Bandai Spirits',series:'One Piece',chara:'Monkey D. Luffy',line:'Ichiban Kuji',
      variant:'Prize A',ja:'一番くじ ワンピース A賞 ルフィ フィギュア'},{isNew:true}),
    lumi:f(false,{brand:'SEGA',series:'Hatsune Miku',chara:'Hatsune Miku',line:'Luminasta',
      ja:'初音ミク Luminasta'},{isNew:true}),
    nendo:f(false,{brand:'Good Smile Company',series:'Frieren',chara:'Frieren',line:'Nendoroid',
      ja:'ねんどろいど 葬送のフリーレン フリーレン'},{isNew:true}),
    plush:f(false,{brand:'Sanrio',series:'Chiikawa',chara:'Hachiware',itemType:'figure',
      ja:'ちいかわ ハチワレ ぬいぐるみ'},{isNew:true}),
    acst:f(false,{brand:'Kotobukiya',series:'Blue Archive',chara:'Shiroko',itemType:'other',
      itemName:'Acrylic Stand',ja:'ブルーアーカイブ シロコ アクリルスタンド'},{isNew:true}),
    scale:f(false,{brand:'Kotobukiya',series:'Evangelion',chara:'Rei Ayanami',scale:'1/7',
      ja:'エヴァンゲリオン 綾波レイ 1/7 フィギュア'},{isNew:true}),
    caps:f(false,{brand:'BANPRESTO',series:'ONE PIECE',chara:'Nami',
      ja:'ワンピース ナミ フィギュア'},{isNew:true}),
    promo:f(false,{brand:'Banpresto',series:'Naruto L@@K',chara:'Naruto Free Shipping!!',
      ja:'ナルト フィギュア'},{}),
    long:f(false,{brand:'Bandai Spirits',series:'Mobile Suit Gundam SEED Destiny',
      chara:'Strike Freedom Gundam Wings of Light Full Burst Mode',line:'Metal Build',
      variant:'Ver. Special Edition',scale:'1/100',ja:'機動戦士ガンダムSEED DESTINY フィギュア'},{isNew:true}),
    game:g(false,'Nintendo Switch','Super Mario Bros. Wonder',{isNew:true}),
    gUsed:g(true,'PlayStation 5','Final Fantasy XVI',{isNew:true}),
    gVer:g(false,'Nintendo Switch','Dragon Quest X Online Version 7',{isNew:true}),
    gCaps:g(false,'Nintendo Switch','POKEMON LEGENDS Z-A',{isNew:true}),
    tab:(()=>{ $('cond').value='sealed'; $('brand').value='Banpresto'; $('series').value='Hazbin Hotel';
      $('chara').value='Alastor'; $('variant').value=''; $('line').value='';
      return buildTitle().text; })(),
    tabOpen:(()=>{ $('cond').value='newopen'; return buildTitle().text; })()
  };
});
for(const k of Object.keys(a))console.log('   '+k+'：'+a[k]+'（'+a[k].length+'）');
ok(a.alastor==='Banpresto Hazbin Hotel Alastor Radio Demon Prize Figure Japan Import New',
   '★★★並び：ブランド → 作品名 → キャラクター → 別名 → 種類 → Japan Import → New（例の37字が72字に）');
ok(a.alastor.length>=70&&a.alastor.length<=80,'★★★目安の70〜80字');
ok(!/Radio Demon/.test(a.noAlias)&&/Prize Figure Japan Import New$/.test(a.noAlias),'★★別名は pj-title が答えたときだけ（作り出さない）');
ok(/^Used /.test(a.used)&&!/\bNew\b/.test(a.used),'★★★New は新品だけ（中古には入れない）');
ok(/Ichiban Kuji Figure/.test(a.kuji)&&!/Prize Figure/.test(a.kuji),'★★一番くじはプライズと書かない');
ok(/Luminasta Prize Figure/.test(a.lumi)&&(a.lumi.match(/Hatsune Miku/g)||[]).length===1,
   '★★プライズの商品ライン（Luminasta）は Prize Figure・作品名とキャラクター名が同じなら1回だけ');
ok(/Nendoroid Figure/.test(a.nendo)&&!/Prize/.test(a.nendo),'★プライズでないフィギュアは Figure');
ok(/Hachiware Plush Japan Import New$/.test(a.plush)&&!/Figure/.test(a.plush),'★★ぬいぐるみは Plush（AI が figure と答えても）');
ok(/Shiroko Acrylic Stand Japan Import New$/.test(a.acst)&&!/Stand Acrylic Stand/.test(a.acst),'★★アクリルスタンドは Acrylic Stand（二重にしない）');
ok(/Figure 1\/7 Japan Import/.test(a.scale),'★★スケールは種類のあと');
ok(a.caps==='Banpresto One Piece Nami Prize Figure Japan Import New','★★★全部大文字の語は普通の書き方に');
ok(!/L@@K|Free Shipping|!/i.test(a.promo),'★★★宣伝の言葉・記号の飾りは入れない');
ok(a.long.length<=80&&!/1\/100/.test(a.long)&&/Figure/.test(a.long),'★★★80字を超えたら後ろの情報（版・スケール）から削る・種類は残す');
ok(a.long.split(' ').every((w)=>/^[A-Za-z0-9.\/:'&-]+$/.test(w)),'★単語の途中で切らない');
ok(a.game==='Nintendo Switch Super Mario Bros. Wonder Japanese Ver. Japan Import New',
   '★★★ゲームは 機種名 → タイトル → Japanese Ver. → Japan Import（新品は New）');
ok(a.gUsed==='Used PlayStation 5 Final Fantasy XVI Japanese Ver. Japan Import','★★中古のゲームには New を入れない');
ok(!/Japanese Ver\./.test(a.gVer),'★ソフト名に版（Version）があるときは Japanese Ver. を足さない');
ok(/Pokemon Legends Z-A/.test(a.gCaps),'★ゲームの全部大文字も直す');
ok(a.tab==='Banpresto Hazbin Hotel Alastor Prize Figure Japan Import New','★★★出品文タブ（新品・未開封）も同じ作り方');
ok(!/\bNew\b/.test(a.tabOpen),'★箱開封済には New を付けない');

console.log('\n=== ② 出品済みの行を作り直す（変更前と変更後・CSV）===');
await p.evaluate(()=>{
  window.__calls=[]; window.__dl=[];
  csvDownload=function(name,text){ window.__dl.push({name:name,text:text}); return true; };
  window.confirm=function(){ return true; };
  window.fetch=function(url,opt){
    url=String(url); opt=opt||{};
    var body=null; try{ body=opt.body?JSON.parse(opt.body):null; }catch(e){}
    function J(o){ return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve(o); } }); }
    window.__calls.push({url:url,body:body,key:(opt.headers||{})['X-PJ-Key']||''});
    if(/\/titlefix\/cands/.test(url))
      return J({ ok:true, n:3, pool:3, min_days:14, views_known:3, sort:'views', rows:[
        { item_id:'111', sku:'W-4900000000001', jan:'4900000000001', title:'Banpresto Hazbin Hotel Alastor Figure',
          mw_name:'ハズビン・ホテル アラスター フィギュア【バンプレスト】', kishu:'b2cchara_figure', views:2, watch:0 },
        { item_id:'222', sku:'W-4900000000002', jan:'4900000000002', title:'Nintendo Switch Kirby Japan Import',
          mw_name:'星のカービィ ディスカバリー', kishu:'NS', views:3, watch:0 },
        { item_id:'333', sku:'W-4900000000003', jan:'4900000000003', title:'Same Title Japan Import New',
          mw_name:'同じになる商品', kishu:'b2cchara_figure', views:5, watch:1 } ]});
    if(/figure-titles$/.test(url))
      return J({ results:body.items.map(function(it){
        if(/アラスター/.test(it.ja_title))return { status:'ok', candidates:[], note:'',
          fields:{ brand:'Banpresto', series:'Hazbin Hotel', series_short:'Hazbin Hotel', chara:'Alastor',
            chara_short:'Alastor', chara_alias:'Radio Demon', item_name:'', variant:'', line:'',
            item_type:'figure', origin:'China' } };
        return { status:'review', candidates:[], note:'', fields:{ brand:'', series:'', chara:'',
          item_name:'Same Title', item_type:'other', origin:'' } };
      }) });
    if(/\/titles$/.test(url))
      return J({ results:body.items.map(function(){ return { status:'ok', english_name:'Kirby and the Forgotten Land',
        candidates:[], note:'' }; }) });
    return J({ ok:false, error:'not_stubbed' });
  };
  $('syncApi').value='https://sync.test'; $('syncKey').value='ADMIN-KEY';
  $('csvTitleApi').value='https://title.test'; $('csvTitleKey').value='T';
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P';
  $('csvLocation').value='Tokyo'; $('csvShipProfile').value='W1000';
  localStorage.removeItem(TF_KEY); tfRows=[];
  csvList=[{ id:'own1', src:'mw', sku:'', jan:'4900000000001', asin:'', titleJa:'ハズビン・ホテル アラスター フィギュア',
    titleEn:'Banpresto Hazbin Hotel Alastor Figure', cat:'261055', catFixed:true, condId:1000,
    specs:{ brand:'Banpresto', franchise:'Hazbin Hotel', character:'Alastor', origin:'China', originManual:true },
    buySource:'mw', dropship:true, itemId:'111', pics:[], qty:1 }];
  csvSaveList(); switchTab('D'); csvRender();
});
await openCsvBoxes(p);
const btn=await p.evaluate(()=>{
  const b=document.querySelector('[data-tfrow="own1"]');
  return { has:!!b, box:!!$('tfBox'), pick:!!$('tfPick'), csv:!!$('tfCsv') };
});
ok(btn.has,'★★★出品済みの無在庫の行のカードに「英題を作り直す」がある');
ok(btn.box&&btn.pick&&btn.csv,'★★出品リストに「出品済みの英題を作り直す」の欄がある');
await p.evaluate(()=>tfPick());
await p.waitForFunction(()=>tfRows.length===3&&tfRows.every((x)=>x.st!=='wait'),null,{timeout:8000});
const b=await p.evaluate(()=>({
  rows:tfRows.map((x)=>({id:x.itemId,old:x.old,nu:x.nu,st:x.st})),
  cands:window.__calls.filter((c)=>/titlefix/.test(c.url)).map((c)=>c.url),
  force:window.__calls.filter((c)=>/titles$/.test(c.url)).every((c)=>c.body&&c.body.force===true),
  html:$('tfList').textContent,
  own:csvList[0].titleEn, note:$('tfNote').textContent
}));
console.log('   '+JSON.stringify(b.rows));
ok(b.cands.length===1&&/n=50/.test(b.cands[0]),'★★★まず50件（pj-sync の候補：閲覧が少なく、まだ売れていない出品）');
ok(b.force,'★★pj-title に問い合わせ直す（force・別名を取るため）');
const r1=b.rows.find((x)=>x.id==='111'), r2=b.rows.find((x)=>x.id==='222'), r3=b.rows.find((x)=>x.id==='333');
ok(r1&&r1.nu==='Banpresto Hazbin Hotel Alastor Radio Demon Prize Figure Japan Import New','★★★変更後の英題（Radio Demon・Prize Figure・Japan Import・New）');
ok(r2&&r2.nu==='Nintendo Switch Kirby and the Forgotten Land Japanese Ver. Japan Import New','★★ゲームの行も同じ作り方');
ok(/旧（37字）：Banpresto Hazbin Hotel Alastor Figure/.test(b.html)&&/新（72字）/.test(b.html),
   '★★★変更前と変更後・文字数を並べて見せる');
ok(b.own==='Banpresto Hazbin Hotel Alastor Figure','★★★出品リストの行はまだ書き換えない（アップロードのあとで）');
ok(/eBay にはまだ何も送っていません/.test(b.note),'★eBay には何も送らない');
const c=await p.evaluate(()=>{ tfCsvRun(); return window.__dl.slice(-1)[0]; });
const lines=c.text.trim().split(/\r\n/);
console.log('   '+c.name+'\n   '+lines.join('\n   '));
ok(/^ebay-title-revise-\d{8}-2\.csv$/.test(c.name),'★★変わった行だけ（2件）');
ok(lines.length===4&&/ItemID,\*Title$/.test(lines[1]),'★★★CSV は Action・ItemID・Title だけ');
ok(/^Revise,111,/.test(lines[2])&&lines.every((l)=>!/333/.test(l)),'★★変わらない行（333）は入れない');
const d=await p.evaluate(()=>{ tfDone(); return { own:csvList[0].titleEn, alias:(csvList[0].specs||{}).charaAlias||'',
  origin:(csvList[0].specs||{}).origin, man:!!(csvList[0].specs||{}).originManual }; });
ok(d.own==='Banpresto Hazbin Hotel Alastor Radio Demon Prize Figure Japan Import New'&&d.alias==='Radio Demon',
   '★★「アップロードした」で出品リストの行の英題も新しいものに');
ok(d.origin==='China'&&d.man,'★手で決めた原産国はそのまま');
const t=await p.evaluate(()=>tfText());
ok(/^商品名\t旧タイトル\t旧の字数\t新タイトル\t新の字数/.test(t)&&t.split('\n').length===4,'★★確認用の一覧（商品名・旧タイトル・新タイトル・文字数）');
/* 作業者のキーではボタンを出さない */
const st=await p.evaluate(()=>{ var s0=syncRole; syncRole='staff'; var h=tfRowBtn(csvList[0]); syncRole=s0; return h; });
ok(st==='','★作業者にはボタンを出さない（MW の商品名を扱うので管理者だけ）');
/* 保存して読み直しても一覧が残る */
const keep=await p.evaluate(()=>{ tfRows=[]; tfLoad(); return tfRows.length; });
ok(keep===3,'★一覧は端末に残る（読み直しても消えない）');
T.done();
})();
