/* 画面：MW 無在庫の本格出品（18件）で見つかった点の直し（8.73〜8.77）
   1. 海外向け Shopify の商品CSV … Vendor＝ブランド・Type＝種類・既定は下書き・
      Shopify 用の説明・英語のタグ・単独で書き出せる・「まだ」に戻せる
   2. MW の「社」は売主のコード。メーカー名は商品名の末尾の【 】
   3. プラモデルは 262324・英題は Plastic Model Kit・原産国は Japan
   5. MW の機種から Platform を入れる（AirTwister で英題が作れなかった） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：Shopify 用CSV・メーカー名・プラモデル・機種（8.73〜8.77）');
const ok = T.ok;

(async()=>{
const p=await T.open();
let dlg=[];
p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
await p.click('#tabD');

await p.evaluate(()=>{
  window.__dl=[];
  window.csvDownload=(name,text)=>{ window.__dl.push({ name:name, text:text }); return true; };
  window.csvOsPut=function(){};                    // pj-sync には送らない
  ebCats=[
    {code:'139973',name:'Video Games',ja:'ゲーム',path:'Video Games & Consoles > Video Games',
     need:[],opt:[],tpl:'139973',seed:true},
    {code:'261055',name:'Figures',ja:'',path:'Toys & Hobbies > Action Figures',
     need:[],opt:[],tpl:'261055',seed:true},
    {code:'261068',name:'Action Figures',ja:'',path:'Toys & Hobbies > Action Figures',
     need:[],opt:[],tpl:'261068',seed:true},
    {code:'171831',name:'Card Storage Cases',ja:'カードケース',
     path:'Video Games & Consoles > Video Game Accessories > Cases',
     need:[],opt:['Brand','Platform'],tpl:'261055',seed:false},
    {code:'262324',name:'Figures',ja:'プラモデル',
     path:'Toys & Hobbies > Models & Kits > Figures',
     need:[],opt:['Brand'],tpl:'261055',seed:false}
  ];
  csvAddCatOpts();
  $('fx').value='150'; $('osPricePct').value='100';
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P';
  $('csvLocation').value='Tokyo'; $('csvShipProfile').value='W1000';
  $('csvMakerOrigin').value='キーズファクトリー,Japan,Keys Factory';
  $('syncApi').value=''; $('syncKey').value='';
});
await openCsvBoxes(p);

console.log('=== ① ⚙：数字だけの Vendor／Type は使わない・既定は下書き ===');
const one=await p.evaluate(()=>{
  /* カジの⚙に入っていた値（会員プランのバリアント番号）。 */
  $('osVendor').value='67979822694563'; $('osType').value='67979822727331';
  var before={ v:osVendor(), t:osTypeV() };
  var n=osCfgClean();
  return { before:before, n:n, v:$('osVendor').value, t:$('osType').value,
           st:osStatusV(), opt:osOpt().status,
           saved:CSV_CFG_IDS.indexOf('osStatus')>=0&&advCsvCfg().indexOf('osStatus')>=0,
           note:$('osCfgNote').textContent,
           ac:document.getElementById('osVendor').getAttribute('autocomplete'),
           acAny:document.getElementById('baseProfit').getAttribute('autocomplete'),
           acKey:document.getElementById('syncKey').getAttribute('autocomplete') };
});
ok(one.before.v===''&&one.before.t==='','★★★数字だけの値は読まない（Vendor／Type に出さない）');
ok(one.n===2&&one.v===''&&one.t==='','★★★⚙の欄からも消す（2か所）');
ok(/数字だけの値が入っていたので空にしました/.test(one.note),'★★消したことを⚙に出す');
ok(one.st==='draft'&&one.opt==='draft','★★★「Shopify に出すときの状態」の既定は下書き');
ok(one.saved,'★★⚙の値として保存され、pj-sync にも送られる');
ok(one.ac==='off'&&one.acAny==='off',
   '★★入力欄はブラウザの復元の対象から外す（並び順でずれて入るのを防ぐ）');
ok(one.acKey!=='off'||one.acKey==='off','★鍵の欄はそのまま');

console.log('=== ② メーカー名は商品名の末尾の【 】（社は売主のコード）===');
const two=await p.evaluate(()=>{
  var r={ id:'m1', jan:'4528272010290', buySource:'mw', mwSha:'MC02',
          titleJa:'カードポッド スプラトゥーン【キーズファクトリー 】', specs:{} };
  var o={ name:csvMakerOf(r) };
  o.info=csvMakerInfo(r);
  /* 「社」（MC02）だけでは引かない。 */
  var r2={ id:'m2', jan:'4528272010306', buySource:'mw', mwSha:'キーズファクトリー',
           titleJa:'カードポッド', specs:{} };
  o.sha=csvMakerOf(r2);
  /* 写真のブックマークレットが持ってきた名前（JAN:番号#メーカー）。 */
  var got=mwPicRead('4528272010306:10970132.10970140#キーズファクトリー\n'
                   +'4528272010313:10970150');
  o.got=got.map(function(x){ return x.jan+'/'+x.ids.length+'/'+(x.maker||''); }).join('|');
  o.afterPaste=csvMakerOf(r2);
  /* 手で入れた名前がいちばん先。 */
  r2.mwMaker='ホリ';
  o.hand=csvMakerOf(r2);
  o.mark=/【\[\^】\]\+】/.test(decodeURIComponent(mwMarkCode()));
  return o;
});
ok(two.name==='キーズファクトリー','★★★商品名の末尾の【 】からメーカー名を読む');
ok(two.info&&two.info.origin==='Japan'&&two.info.brand==='Keys Factory',
   '★★★⚙の表が引ける（原産国 Japan・ブランド Keys Factory）');
ok(two.sha==='','★★★「社」はメーカー名として使わない（売主のコード）');
ok(two.got==='4528272010306/2/キーズファクトリー|4528272010313/1/',
   '★★ブックマークレットの「JAN:番号#メーカー名」を読む（番号は今までどおり）：'+two.got);
ok(two.afterPaste==='キーズファクトリー','★★読めたメーカー名は端末に控えて使う');
ok(two.hand==='ホリ','★★行に手で入れたメーカー名がいちばん先');
ok(two.mark,'★ブックマークレットが箱の中の【 】も読む');

console.log('=== ③ プラモデル ===');
const three=await p.evaluate(()=>{
  var o={};
  o.cat=mwCatOf({ kishu:'plasticmodel' });
  o.catFig=mwCatOf({ kishu:'b2cchara_figure' });
  o.catGame=mwCatOf({ kishu:'NS' });
  /* 登録が無い端末では今までどおり 261055。 */
  var keep=ebCats; ebCats=ebCats.filter(function(c){ return c.code!=='262324'; });
  o.catNoReg=mwCatOf({ kishu:'plasticmodel' });
  ebCats=keep;
  var r={ id:'k1', cat:'262324', condId:1000, buySource:'mw', mwKishu:'plasticmodel',
          jan:'4573102660001', titleJa:'30MM（bEXM-40）【BANDAI SPIRITS 】',
          specs:{ brand:'Bandai Spirits', line:'30MM', model:'bEXM-40 Green',
                  itemName:'Option Parts Set', itemType:'figure', origin:'' } };
  csvFigRebuild(r);
  o.title=r.titleEn;
  o.isKit=csvIsModelKit(r);
  /* 長いときは Model Kit に縮める。 */
  var t2=figTitleFrom(false,{ brand:'Bandai Spirits', line:'30MM',
    itemName:'Customize Scene Base Option Parts Set Truss Base Version',
    variant:'bEXM-40 Dark Green', itemType:'model_kit' },false);
  o.short=t2.text;
  /* もう Model Kit で終わっていたら足さない。 */
  o.noDup=figTitleFrom(false,{ brand:'Bandai', itemName:'RG Gundam Model Kit',
    itemType:'model_kit' },false).text;
  o.plastic=figTitleFrom(false,{ brand:'Bandai', itemName:'RG Gundam Plastic Model',
    itemType:'model_kit' },false).text;
  /* 原産国：プラモデル＝Japan。 */
  o.genre=csvGenreOf(r);
  csvOriginFill(r);
  o.origin=r.specs.origin; o.ja=r.specs.originGenreJa||'';
  /* フィギュアのカテゴリに入ったままのプラモデル（前の行）も Japan。 */
  var old={ id:'k2', cat:'261055', mwKishu:'plasticmodel', buySource:'mw',
            titleJa:'x', specs:{ origin:'' } };
  csvOriginFill(old);
  o.oldOrigin=old.specs.origin;
  /* ふつうのフィギュアは今までどおり China・Figure。 */
  var fig={ id:'k3', cat:'261055', condId:1000, mwKishu:'b2cchara_figure',
            titleJa:'x', specs:{ brand:'Banpresto', franchise:'One Piece',
            character:'Luffy', origin:'' } };
  csvFigRebuild(fig); csvOriginFill(fig);
  o.figTitle=fig.titleEn; o.figOrigin=fig.specs.origin;
  o.type=osTypeOf(r);
  return o;
});
ok(three.cat==='262324','★★★機種 plasticmodel → 262324 を既定にする');
ok(three.catFig==='261055'&&three.catGame==='139973','★★フィギュア・ゲームは今までどおり');
ok(three.catNoReg==='261055','★★⚙に登録が無い端末では今までどおり 261055（列を作れないため）');
ok(three.isKit&&/Plastic Model Kit/.test(three.title)&&!/Figure/.test(three.title),
   '★★★英題は Figure と書かず Plastic Model Kit：'+three.title);
ok(/bEXM-40/.test(three.title),'★★型番が英題に入る');
ok(three.short.length<=80&&/Model Kit/.test(three.short),
   '★★長いときは Model Kit に縮めて80字に収める：'+three.short);
ok(!/Model Kit.*Model Kit/.test(three.noDup)&&/Plastic Model Kit/.test(three.plastic)
   &&!/Kit Kit|Model Plastic/.test(three.plastic),
   '★★種類の語を二重に付けない：'+three.noDup+'／'+three.plastic);
ok(three.genre==='model'&&three.origin==='Japan'&&three.ja==='プラモデル',
   '★★★原産国のジャンルは「プラモデル」＝Japan');
ok(three.oldOrigin==='Japan','★★フィギュアのカテゴリに入ったままのプラモデルも Japan');
ok(/Figure/.test(three.figTitle)&&three.figOrigin==='China',
   '★★フィギュアは今までどおり（Figure・China）');
ok(three.type==='Model Kit','★★Shopify の Type は Model Kit');

console.log('=== ④ MW の機種から Platform（AirTwister）===');
const four=await p.evaluate(async()=>{
  var o={};
  o.ns=mwPlatSpecOf('NS'); o.p5=mwPlatSpecOf('P5'); o.ns2h=mwPlatSpecOf('NS2H');
  o.xb=mwPlatSpecOf('XB'); o.fig=mwPlatSpecOf('b2cchara_figure');
  /* 出品リストに入れる行。 */
  var row=mwListRow({ jan:'4260650747380', sha:'MC02', kishu:'NS',
    name:'AirTwister【ININ Games 】', wholesale:3000, stock:5, ship_days:0 },[],1);
  o.rowPlat=row.specs.platform; o.rowCat=row.cat; o.rowMaker=row.mwMaker;
  /* 機種が分からない行でも、返ってきた英語名は入れる。 */
  var g={ id:'g1', cat:'139973', condId:1000, jan:'4260650747380', asin:'',
          titleJa:'AirTwister', buySource:'mw', mwKishu:'XB',
          specs:{ platform:'', gameName:'' }, titleEn:'', titleManual:false };
  csvList=[g]; csvSaveList();
  $('csvTitleApi').value='https://title.test'; $('csvTitleKey').value='K';
  var oldFetch=window.fetch;
  window.fetch=function(){ return Promise.resolve({ ok:true, status:200,
    json:function(){ return Promise.resolve({ results:[{ status:'review',
      english_name:'AirTwister', platform_key:'', candidates:[], note:'' }] }); } }); };
  await csvTitleSend('game',[g],false);
  window.fetch=oldFetch;
  o.name=g.specs.gameName; o.t1=g.titleEn;
  o.iss=csvIssues(g).filter(function(x){ return /Platform/.test(x); }).join('／');
  /* 行で機種を選ぶと、英題にも機種が入る。 */
  csvRender();
  var sel=document.querySelector('#csvList select[data-plat="g1"]');
  o.hasSel=!!sel;
  if(sel){ sel.value='switch'; sel.dispatchEvent(new Event('change',{bubbles:true})); }
  var g2=csvRowById('g1');
  o.plat=g2.specs.platform; o.t2=g2.titleEn;
  /* すでに入っている MW の行は、開いたときに機種から入る。 */
  csvList=[{ id:'g9', cat:'139973', condId:1000, jan:'4260650747380',
    titleJa:'AirTwister', buySource:'mw', mwKishu:'PS5', specs:{ platform:'' },
    titleEn:'', pics:[], qty:1, cost:1, weight:1 }];
  csvSaveList(); csvLoad();
  o.fixed=(csvRowById('g9').specs||{}).platform;
  return o;
});
ok(four.ns==='Nintendo Switch'&&four.p5==='Sony PlayStation 5'
   &&four.ns2h==='Nintendo Switch 2','★★★MW の機種 → Platform（NS・P5・NS2H）');
ok(four.xb===''&&four.fig==='','★★はっきり決まらない機種は入れない（推測しない）');
ok(four.rowPlat==='Nintendo Switch'&&four.rowCat==='139973',
   '★★★出品リストに入れる時点で Platform が入る');
ok(four.rowMaker==='ININ Games','★★メーカー名も行に入る');
ok(four.name==='AirTwister'&&/AirTwister/.test(four.t1),
   '★★★機種が分からない行でも、返ってきた英語名は入れる（捨てない）：'+four.t1);
ok(/Platform なし/.test(four.iss),'★★Platform が空のあいだは書き出さない');
ok(four.hasSel&&four.plat==='Nintendo Switch'&&/^Nintendo Switch AirTwister/.test(four.t2),
   '★★★行で機種を選ぶと英題にも機種が入る：'+four.t2);
ok(four.fixed==='Sony PlayStation 5','★★すでに入っている MW の行も、機種から Platform が入る');

console.log('=== ⑤ Shopify 用CSV（行から作る・単独で書き出す・「まだ」に戻す）===');
const five=await p.evaluate(()=>{
  var mk=function(id,cat,x){
    return Object.assign({ id:id, src:'mw', sku:'', jan:'452827201029'+id,
      asin:'B0OS00000'+id, titleJa:'テスト'+id+'【キーズファクトリー 】',
      titleEn:'Keys Factory Card Pod '+id+' Nintendo Switch 2 Japan',
      cat:cat, catFixed:true, catDone:true, condId:1000, cost:1200, qty:1, weight:200,
      pics:[{url:'https://img.test/i/20261118/'+id+'.jpg'}],
      descHtml:'<div><p>Returns… message us through eBay first.</p></div>',
      specs:{ origin:'Japan', brand:'Keys Factory', platform:'Nintendo Switch 2' },
      buySource:'mw', dropship:true, mwKishu:'NS2H', mwSha:'MC02', osOn:true, osAt:'',
      zeroAct:'hold', fba:false, oneOff:false, itemId:'', sold:'', price:30,
      titleStatus:'', titleCands:[], titleNote:'', titleManual:false },x||{});
  };
  csvList=[ mk('1','171831',{ itemId:'111111111111', expAt:'2026-11-18' }),  // eBay に出し終えた行
            mk('2','262324',{ mwKishu:'plasticmodel', itemId:'222222222222',
                              specs:{ origin:'Japan', brand:'Bandai Spirits' } }),
            mk('3','261055',{ mwKishu:'b2cchara_figure', osAt:'2026-11-18',
                              specs:{ origin:'China', brand:'Banpresto' } }) ];
  csvPick={}; csvSaveList(); csvRender();
  var o={ has:!!$('csvOsOnly')&&!!$('csvOsReset') };
  window.__dl=[];
  $('csvOsOnly').click();
  var f=window.__dl[0]||{ name:'', text:'' };
  o.name=f.name;
  var rows=PJ_SHOPCSV.splitCsv(f.text), h=rows[0]||[];
  var c=function(i,n){ return (rows[i]||[])[h.indexOf(n)]; };
  o.n=rows.length-1;
  o.r1={ handle:c(1,'Handle'), vendor:c(1,'Vendor'), type:c(1,'Type'), tags:c(1,'Tags'),
         status:c(1,'Status'), pub:c(1,'Published'), body:c(1,'Body (HTML)') };
  o.r2={ vendor:c(2,'Vendor'), type:c(2,'Type'), tags:c(2,'Tags') };
  o.at1=csvRowById('1').osAt; o.at3=csvRowById('3').osAt;
  o.note=$('csvOsNote').textContent;
  /* 「まだ」に戻す。 */
  $('csvOsReset').click();
  o.reset=[csvRowById('1').osAt,csvRowById('2').osAt,csvRowById('3').osAt].join('|');
  o.on=csvRowById('1').osOn;
  /* 公開にすると active。 */
  $('osStatus').value='active';
  window.__dl=[];
  $('csvOsOnly').click();
  var rows2=PJ_SHOPCSV.splitCsv((window.__dl[0]||{text:''}).text), h2=rows2[0]||[];
  o.live=(rows2[1]||[])[h2.indexOf('Status')]+'/'+(rows2[1]||[])[h2.indexOf('Published')];
  o.n2=rows2.length-1;
  o.r3type=(rows2[3]||[])[h2.indexOf('Type')];
  o.r3tags=(rows2[3]||[])[h2.indexOf('Tags')];
  $('osStatus').value='draft';
  return o;
});
ok(five.has,'★「Shopify 用CSV だけを書き出す」「「まだ」に戻す」のボタンがある');
ok(/^shopify-os-\d{8}-\d\d-2\.csv$/.test(five.name)&&five.n===2,
   '★★★eBay に出し終えた行でも、Shopify 用だけを書き出せる（まだの2件）：'+five.name);
ok(five.r1.handle==='os-4528272010291','★Handle は os-<JAN>');
ok(five.r1.vendor==='Keys Factory'&&five.r1.type==='Video Game Accessory',
   '★★★Vendor＝ブランド・Type＝商品の種類（カードケース）');
ok(five.r2.vendor==='Bandai Spirits'&&five.r2.type==='Model Kit',
   '★★★プラモデルは Type＝Model Kit');
ok(five.r1.tags==='export, Nintendo Switch 2'&&five.r2.tags==='export, Model Kit',
   '★★★タグは英語（'+five.r1.tags+'／'+five.r2.tags+'）');
ok(five.r1.status==='draft'&&five.r1.pub==='false','★★★既定は下書き・非公開');
ok(!/ebay/i.test(five.r1.body)&&/Brand: Keys Factory/.test(five.r1.body)
   &&/not photographs of the individual copy/.test(five.r1.body),
   '★★★説明は Shopify 用（eBay の文が入らない）');
ok(!!five.at1&&five.at3==='2026-11-18','★★書き出した行に印が付く（前からの印はそのまま）');
ok(/下書き/.test(five.note),'★書き出しの結果に状態（下書き）を出す');
ok(five.reset==='||'&&five.on===true,
   '★★★「まだ」に戻せる（印「Shopify にも出す」はそのまま）');
ok(five.live==='active/true'&&five.n2===3,
   '★★⚙を「公開」にすると active／true・戻した3件ぜんぶ書き出せる');
ok(five.r3type==='Figure'&&five.r3tags==='export, Figure',
   '★★フィギュアは Type＝Figure・タグも Figure（「フィギュア」と出さない）');

console.log('=== ⑥ 無在庫の「About」も手で検品と書かない（8.67 の直し残し）===');
const six=await p.evaluate(()=>{
  var r={ id:'a1', cat:'261055', condId:1000, titleEn:'Test Figure Japan Import',
          buySource:'mw', dropship:true, specs:{ brand:'Bandai', origin:'China' } };
  var d=csvDescFor(r);
  var hand={ id:'a2', cat:'261055', condId:1000, titleEn:'Test Figure Japan Import',
             buySource:'', specs:{ brand:'Bandai', origin:'China' } };
  var dh=csvDescFor(hand);
  /* すでに作ってある出品文（v325 までの文）も、その段だけ入れ替える。 */
  var old={ id:'a3', buySource:'mw', descHtml:'<div><p>'+V_ABOUT[1]+'</p></div>' };
  var fx=csvDescMwFix(old);
  return { mw:d, hand:dh, fx:fx, old:old.descHtml };
});
ok(!/inspected by hand|checked by hand|hand inspection|rather than through wholesalers/i
   .test(six.mw),'★★★無在庫の行は「手で検品」「卸を通さない」と書かない');
ok(/second-hand dealer/.test(six.mw)&&/eBay messages/.test(six.mw),
   '★★店の紹介と問い合わせの案内は残す');
ok(/hand/i.test(six.hand),'★★手持ちの行は今までどおり');
ok(six.fx===true&&!/checked by hand/.test(six.old),
   '★★すでに作ってある出品文も、その段だけ入れ替える');

await T.done();
})();
