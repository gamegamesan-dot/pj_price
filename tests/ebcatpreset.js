/* 画面：はじめから用意する eBay カテゴリ（8.84・カジの依頼）
   171821 Headsets／117042 Controllers & Attachments／69528 Other Animation Merchandise
   ・一覧を読んだときに、まだ無いものだけを**今までの「足す」と同じ口**で足す
     （必須の Item specifics は eBay から取る。コードに書き写さない）
   ・足したカテゴリは ebCatKnown が true になる＝「新しいカテゴリ（未登録）」で止まらない
   ・必須の項目が CSV の列（*C:…）になり、カードで入力できる
   ・原産国の既定：ヘッドセット・コントローラー＝China／アニメグッズ＝Japan
   ・カテゴリごとの書き出しのファイル名が重ならない（headset／controller／anime）
   ・既存のカテゴリ（139973／171831／262324／261055）の動きは変えない
   ・Amazon の画像を使わない／出品文に Shopify への誘導を入れない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：用意してある eBay カテゴリ（8.84）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });
await p.click('#tabD');

/* pj-sync をまねる。eBay が返す必須の項目はここで決める（本番は eBay の値）。 */
const setup=async(o)=>await p.evaluate((o)=>{
  try{ localStorage.removeItem(EB_CAT_PRESET_LS); }catch(e){}
  var NEED={ '171821':['Brand','Type','Compatible Platform'],
             '117042':['Brand','Type','Compatible Platform'],
             '69528':['Type','Franchise'] };
  window.__d1=[
    {code:'139973',name:'Video Games',ja:'ゲーム',path:'Video Games & Consoles > Video Games',
     need:['Game Name','Platform'],opt:[],tpl:'139973',seed:true},
    {code:'261055',name:'Action Figures & Accessories',ja:'フィギュア（非可動）',
     path:'Toys & Hobbies > Action Figures & Accessories',need:['Type'],opt:[],
     tpl:'261055',seed:true},
    {code:'261068',name:'Action Figures',ja:'フィギュア（可動）',
     path:'Toys & Hobbies > Action Figures & Accessories > Action Figures',
     need:['Type'],opt:[],tpl:'261068',seed:true},
    {code:'171831',name:'Card Storage Cases',ja:'カードケース',
     path:'Video Games & Consoles > Video Game Accessories > Card Storage Cases',
     need:[],opt:['Brand','Country/Region of Manufacture'],tpl:'261055',seed:false},
    {code:'262324',name:'Figures',ja:'プラモデル',
     path:'Toys & Hobbies > Models & Kits > Figures',need:['Brand'],opt:['Type'],
     tpl:'261055',seed:false}];
  window.__posts=[];
  if(!window.__real)window.__real=window.fetch;
  window.fetch=async(u,i)=>{
    var url=String(u), m=(i&&i.method)||'GET';
    var key=(i&&i.headers&&i.headers['X-PJ-Key'])||'';
    if(/\/ebay\/cat\/add$/.test(url)){
      var b=JSON.parse(i.body);
      window.__posts.push({ path:'add', body:b, key:key });
      if(o.staff)return new Response(JSON.stringify({ ok:false, error:'forbidden',
        detail:'管理者だけが足せます' }),{status:403});
      if(o.ebayNg)return new Response(JSON.stringify({ ok:false, error:'api',
        detail:'eBay が 503 を返しました' }),{status:200});
      window.__d1=window.__d1.filter(function(c){ return c.code!==b.code; });
      window.__d1.push({ code:b.code, name:b.name, ja:b.ja, path:b.path,
        need:NEED[b.code]||[], opt:['Model','Color','Country/Region of Manufacture','MPN'],
        tpl:b.tpl, seed:false });
      return new Response(JSON.stringify({ ok:true, code:b.code,
        need:NEED[b.code]||[], opt:[] }),{status:200});
    }
    if(/\/ebay\/cat$/.test(url)&&m==='GET'){
      window.__posts.push({ path:'list', key:key });
      return new Response(JSON.stringify({ ok:true, rows:window.__d1,
        n:window.__d1.length }),{status:200});
    }
    if(/sync\.example/.test(url))
      return new Response(JSON.stringify({ ok:true, rows:[] }),{status:200});
    return window.__real(u,i);
  };
  ebCats=[]; ebCatLsSave();
  $('syncApi').value='https://sync.example'; $('syncKey').value='TEST-KEY';
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P';
  $('csvLocation').value='Tokyo'; $('csvShipProfile').value='W1000';
  $('csvMakerOrigin').value='';
},o||{});
const pull=async(manual)=>{
  await p.evaluate((manual)=>ebCatPull(!manual),!!manual);
  await p.waitForTimeout(500);
};
const CODES=['171821','117042','69528'];

console.log('=== ① 足す前は「登録なし」（ebCatKnown が false）===');
await setup({ staff:true });
let z=await p.evaluate((C)=>C.map(function(c){ return ebCatKnown(c); }),CODES);
ok(z.every((x)=>x===false),'★★足す前は3つとも登録なし');

console.log('\n=== ② 作業者のキーでは足せない（落ちない・うるさくしない）===');
await pull(false);
let st=await p.evaluate((C)=>({ known:C.map(function(c){ return ebCatKnown(c); }),
  posts:window.__posts.filter(function(x){ return x.path==='add'; }).length,
  done:lsGet(EB_CAT_PRESET_LS)||'', n:ebCats.length }),CODES);
console.log('   '+JSON.stringify(st));
ok(st.posts===3&&st.known.every((x)=>x===false),'★★断られたら登録なしのまま');
ok(st.n===5,'★★一覧はそのまま読めている（5件）');
ok(!/171821/.test(st.done),'★★足せなかったものに「済み」の印を付けない（次にまた試す）');

console.log('\n=== ③ 管理者のキーなら、一覧を読んだときに3つを足す ===');
await setup({});
await pull(false);
let a=await p.evaluate((C)=>({
  adds:window.__posts.filter(function(x){ return x.path==='add'; }),
  known:C.map(function(c){ return ebCatKnown(c); }),
  need:C.map(function(c){ return ebCatNeed(c).join(','); }),
  names:C.map(function(c){ return csvCatName(c); }),
  note:$('ebCatNote').textContent, box:$('ebCatListBox').textContent,
  del:document.querySelectorAll('#ebCatListBox [data-ebdel]').length,
  n:ebCats.length, done:lsGet(EB_CAT_PRESET_LS)||'' }),CODES);
console.log('   '+JSON.stringify(a.adds.map((x)=>x.body)));
console.log('   '+a.note);
ok(a.adds.length===3&&a.adds.map((x)=>x.body.code).join(',')===CODES.join(','),
   '★★★3つを今までの「足す」の口（/ebay/cat/add）で足す');
ok(a.adds.every((x)=>x.key==='TEST-KEY'),'★★⚙のキーを付ける');
ok(a.adds[0].body.name==='Headsets'&&a.adds[0].body.ja==='ヘッドセット'
   &&/Video Game Accessories > Headsets$/.test(a.adds[0].body.path),
   '★★★171821 Headsets（Video Game Accessories の下）');
ok(a.adds[1].body.name==='Controllers & Attachments'&&a.adds[1].body.ja==='コントローラー'
   &&/Video Game Accessories > Controllers & Attachments$/.test(a.adds[1].body.path),
   '★★★117042 Controllers & Attachments');
ok(a.adds[2].body.name==='Other Animation Merchandise'&&a.adds[2].body.ja==='アニメグッズ'
   &&/^Collectibles > /.test(a.adds[2].body.path),
   '★★★69528 Other Animation Merchandise');
ok(a.known.every((x)=>x===true),'★★★3つとも ebCatKnown が true になる');
ok(a.need[0]==='Brand,Type,Compatible Platform'&&a.need[2]==='Type,Franchise',
   '★★★必須の項目は eBay（pj-sync）が返したものを控える');
ok(a.names.join('|')==='ヘッドセット（171821）|コントローラー（117042）|アニメグッズ（69528）',
   '★★画面に出す名前');
ok(a.n===8&&a.del===5,'★★一覧は8件・足したものは「外す」で外せる');
ok(/ヘッドセット（171821）必須：Brand／Type／Compatible Platform/.test(a.note)
   &&/アニメグッズ（69528）必須：Type／Franchise/.test(a.note),
   '★★★足したあと、カテゴリごとの必須の項目を知らせる');
ok(/171821/.test(a.done)&&/117042/.test(a.done)&&/69528/.test(a.done),
   '★足したものに「済み」の印を付ける');

console.log('\n=== ④ もう一度読んでも足し直さない／外したものを勝手に戻さない ===');
await p.evaluate(()=>{ window.__posts=[]; });
await pull(false);
let b1=await p.evaluate(()=>window.__posts.filter(function(x){ return x.path==='add'; }).length);
ok(b1===0,'★★★そろっていれば足さない');
await p.evaluate(()=>{ window.__d1=window.__d1.filter(function(c){ return c.code!=='117042'; });
                       window.__posts=[]; });
await pull(false);
let b2=await p.evaluate(()=>({ adds:window.__posts.filter(function(x){ return x.path==='add'; }).length,
                               known:ebCatKnown('117042') }));
ok(b2.adds===0&&b2.known===false,'★★★外したカテゴリを、開いただけで戻さない');
await pull(true);
let b3=await p.evaluate(()=>window.__posts.filter(function(x){ return x.path==='add'; }).length);
ok(b3===0,'★★「一覧を取り直す」を押しても戻さない（戻すときは⚙で「足す」）');
/* このあとの確かめのために、⚙の「足す」で戻す。 */
await p.evaluate(()=>{ ebCatFoundRows=[{ code:'117042', name:'Controllers & Attachments',
  path:'Video Games & Consoles > Video Game Accessories > Controllers & Attachments' }];
  $('ebCatJa').value='コントローラー'; ebCatAdd(0); });
await p.waitForTimeout(500);
ok(await p.evaluate(()=>ebCatKnown('117042')),'★★⚙の「足す」で戻せる');

console.log('\n=== ⑤ 必須の項目が CSV の列になり、カードで入力できる ===');
await openCsvBoxes(p);
const mkRows=async()=>await p.evaluate(()=>{
  var mk=function(id,cat,x){
    return Object.assign({
      id:id, src:'sedori', sku:'hobby-20261121-N-B0PRE000'+id+'-1200',
      asin:'B0PRE000'+id, jan:'496123456789'+id, titleJa:'テスト'+id,
      titleEn:'Test Item '+id+' Japan', cat:cat, catFixed:true, catDone:true,
      condId:1000, cost:1200, qty:1, weight:300, price:39.99, floor:30,
      pics:[{url:'https://img.example/i/20261121/mw-'+id+'.jpg'}],
      descHtml:'<p>Brand new item from Japan.</p>',
      specs:{ origin:'', platform:'', brand:'' },
      zeroAct:'hold', fba:false, oneOff:false, itemId:'', sold:'',
      dropship:false, titleStatus:'', titleCands:[], titleNote:'',
      titleManual:false },x||{});
  };
  csvList=[
    mk('1','171821',{ titleJa:'HORI ゲーミングヘッドセット',
                      titleEn:'HORI Gaming Headset for Nintendo Switch 2 Japan' }),
    mk('2','117042',{ titleJa:'HORIPAD TURBO',
                      titleEn:'HORIPAD TURBO Controller for Nintendo Switch 2 Japan' }),
    mk('3','69528',{ titleJa:'ensky 呪術廻戦 スナップカード',
                     titleEn:'Ensky Jujutsu Kaisen Snap Card Japan' }),
    mk('4','139973',{ specs:{ origin:'', platform:'Nintendo Switch', gameName:'Test' } }),
    mk('5','171831'), mk('6','262324',{ mwKishu:'plasticmodel' }), mk('7','261055')
  ];
  csvList.forEach(function(r){ if(r.cat!=='139973')csvOriginFill(r); });
  csvSaveList(); csvRender();
});
await mkRows();
let c=await p.evaluate(()=>{
  var star=function(cat){ return csvHeadFor(cat).split(',')
    .filter(function(h){ return /^\*C:/.test(h); }); };
  var r1=csvRowById('1'), r3=csvRowById('3');
  var card=document.querySelectorAll('#csvList input[data-aspid="1"]');
  var out={ h1:star('171821'), h2:star('117042'), h3:star('69528'),
    opt1:csvHeadFor('171821').split(',').filter(function(h){ return /^C:/.test(h); }),
    noFig:csvHeadFor('171821').indexOf('C:Franchise')<0
          &&csvHeadFor('171821').indexOf('C:Character')<0,
    cardKeys:[].map.call(card,function(x){ return x.getAttribute('data-aspk'); }),
    miss1:csvNeedMiss(r1), miss3:csvNeedMiss(r3),
    issues1:csvIssues(r1).filter(function(x){ return /必須の項目/.test(x); }) };
  /* カードで入力する（実際の input に入れて、変更を伝える）。 */
  var set=function(id,k,v){
    var el=document.querySelector('#csvList input[data-aspid="'+id+'"][data-aspk="'+k+'"]');
    if(!el)return false;
    el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); return true;
  };
  out.typed=[set('1','Brand','HORI'),set('1','Type','Headset'),
             set('1','Compatible Platform','Nintendo Switch 2')];
  return out;
});
console.log('   171821: '+c.h1.join(' ')+'／117042: '+c.h2.join(' ')+'／69528: '+c.h3.join(' '));
ok(c.h1.join(',')==='*C:Brand,*C:Type,*C:Compatible Platform',
   '★★★171821 の必須の項目が *C: の列になる');
ok(c.h2.join(',')==='*C:Brand,*C:Type,*C:Compatible Platform',
   '★★★117042 の必須の項目が *C: の列になる');
ok(c.h3.join(',')==='*C:Type,*C:Franchise','★★★69528 の必須の項目が *C: の列になる');
ok(c.opt1.indexOf('C:Model')>=0&&c.noFig,
   '★★そのほかの項目も eBay のもの（フィギュアの決め打ちの列を混ぜない）');
ok(c.cardKeys.join(',')==='Brand,Type,Compatible Platform',
   '★★★カードに必須の項目の入力欄が出る');
ok(c.miss1.length===3&&c.issues1.length===3,
   '★★★空のままの行は「必須の項目が空」で書き出さない');
ok(c.typed.every((x)=>x===true),'★入力欄に入れられる');
await p.waitForTimeout(200);
let c2=await p.evaluate(()=>{
  var r1=csvRowById('1'), o=csvRowFor(r1);
  return { asp:(r1.specs||{}).aspects||{}, miss:csvNeedMiss(r1),
           brand:o['*C:Brand'], type:o['*C:Type'], plat:o['*C:Compatible Platform'],
           origin:o['C:Country/Region of Manufacture'] };
});
console.log('   '+JSON.stringify(c2));
ok(c2.miss.length===0,'★★★カードで入れると不備が消える');
ok(c2.brand==='HORI'&&c2.type==='Headset'&&c2.plat==='Nintendo Switch 2',
   '★★★入れた値がそのまま CSV の列に出る');
ok(c2.origin==='China','★★原産国の列には行の原産国が入る');

console.log('\n=== ⑥ 原産国の既定 ===');
let d=await p.evaluate(()=>{
  var o={};
  csvList.forEach(function(r){
    var gi=csvGenreInfo(r);
    o[r.cat]={ origin:(r.specs||{}).origin||'', genre:csvGenreOf(r),
               def:gi?gi.origin:'', gn:!!(r.specs||{}).originGenre };
  });
  return o;
});
console.log('   '+JSON.stringify(d));
ok(d['171821'].origin==='China'&&d['171821'].gn,'★★★ヘッドセット（171821）→ China');
ok(d['117042'].origin==='China'&&d['117042'].gn,'★★★コントローラー（117042）→ China');
ok(d['69528'].origin==='Japan'&&d['69528'].gn,'★★★アニメグッズ（69528）→ Japan');
ok(d['139973'].genre==='game'&&d['139973'].def==='Japan','★★★ゲーム 139973 は今までどおり Japan');
ok(d['171831'].genre==='game'&&d['171831'].origin==='Japan',
   '★★★カードケース 171831 は今までどおり Japan（ゲームの下）');
ok(d['262324'].genre==='model'&&d['262324'].origin==='Japan',
   '★★★プラモデル 262324 は今までどおり Japan');
ok(d['261055'].genre==='fig'&&d['261055'].origin==='China',
   '★★★フィギュア 261055 は今までどおり China');
let d2=await p.evaluate(()=>{
  var o={};
  /* 行で確定した値は触らない。 */
  var a=csvRowById('1'); a.specs.origin='Vietnam'; a.specs.originManual=true;
  a.specs.originGenre=false; a.specs.originDefault=false;
  o.manual=(csvOriginFill(a)===false&&a.specs.origin==='Vietnam');
  /* ⚙に書いた値のほうが優先（カテゴリ番号で見分ける言葉を書いたとき）。 */
  var keep=$('csvGenreOrigin').value;
  $('csvGenreOrigin').value=keep+'\nヘッドセット,Vietnam,171821';
  var b=csvRowById('1'); var gi=csvGenreInfo(b);
  o.cfg=gi?gi.origin:'';
  $('csvGenreOrigin').value=keep;
  /* フィギュア（China・ジャンルの既定）→ アニメグッズに切り替えると Japan。 */
  var f=csvRowById('7');
  csvCatApply(f,'69528',true);
  o.figToAnime=f.specs.origin+'/'+!!f.specs.originGenre;
  csvCatApply(f,'261055',true);
  o.animeToFig=f.specs.origin;
  /* ゲーム → ヘッドセットに切り替えると China。 */
  var g=csvRowById('4');
  csvCatApply(g,'171821',true);
  o.gameToHead=g.specs.origin;
  csvCatApply(g,'139973',true);
  /* 手で確定した行は切り替えても変えない。 */
  var m=csvRowById('3'); m.specs.origin='Thailand'; m.specs.originManual=true;
  m.specs.originGenre=false; m.specs.originDefault=false;
  csvCatApply(m,'171821',true);
  o.manualSwitch=m.specs.origin;
  csvCatApply(m,'69528',true);
  /* 既存のカテゴリどうしの切り替えは今までどおり（入れ直さない）。 */
  var k=csvRowById('5');           // 171831・Japan（ジャンルの既定）
  csvCatApply(k,'261055',true);
  o.oldSwitch=k.specs.origin;
  csvCatApply(k,'171831',true);
  return o;
});
console.log('   '+JSON.stringify(d2));
ok(d2.manual===true,'★★★行で確定した原産国は上書きしない');
ok(d2.cfg==='Vietnam','★★⚙「ジャンルごとの原産国」に書いた値のほうが優先');
ok(d2.figToAnime==='Japan/true','★★★フィギュア → アニメグッズに切り替えると Japan に入れ直す');
ok(d2.animeToFig==='China','★★アニメグッズ → フィギュアに戻すと China');
ok(d2.gameToHead==='China','★★★ゲーム → ヘッドセットに切り替えると China');
ok(d2.manualSwitch==='Thailand','★★★手で確定した行は切り替えても変えない');
ok(d2.oldSwitch==='Japan','★★★既存のカテゴリどうしの切り替えは今までどおり（入れ直さない）');

console.log('\n=== ⑦ カテゴリごとの書き出し ===');
await mkRows();
let e=await p.evaluate(()=>{
  /* 必須の項目を埋める（カードで入れたのと同じ場所）。 */
  var fill=function(id,o){ var r=csvRowById(id); r.specs.aspects=o; };
  fill('1',{ Brand:'HORI', Type:'Headset', 'Compatible Platform':'Nintendo Switch 2' });
  fill('2',{ Brand:'HORI', Type:'Gamepad', 'Compatible Platform':'Nintendo Switch 2' });
  fill('3',{ Type:'Trading Card', Franchise:'Jujutsu Kaisen' });
  fill('6',{ Brand:'Bandai' });
  var slug=['171821','117042','69528','139973','261055','261068','171831','262324']
    .map(function(c){ return c+':'+csvCatSlug(c); });
  var saved=[];
  var k1=csvDownload, k2=csvDownloadBlob;
  csvDownload=function(n,t){ saved.push(n); return true; };
  csvDownloadBlob=function(n,b){ saved.push(n); return true; };
  var err='';
  try{ csvExportRun(['1','2','3']); }catch(x){ err=String(x&&x.message||x); }
  csvDownload=k1; csvDownloadBlob=k2;
  /* 並びはカテゴリ番号の順なので、名前で引けるようにする。 */
  var byName=function(w){ return csvLastFiles.filter(function(f){
    return f.name.indexOf('-'+w+'-')>=0; })[0]||{ name:'', label:'', text:'' }; };
  var files=['headset','controller','anime'].map(byName).map(function(f){
    return { name:f.name, label:f.label, head:f.text.split('\r\n')[1]||'', body:f.text }; });
  var nFiles=csvLastFiles.length;
  return { slug:slug, saved:saved, err:err, files:files, nFiles:nFiles,
           exp:['1','2','3'].map(function(id){ return csvRowById(id).expAt||''; }) };
});
console.log('   '+e.slug.join(' '));
console.log('   '+e.files.map((f)=>f.name+'【'+f.label+'】').join(' / ')+(e.err?(' err='+e.err):''));
ok(e.slug.indexOf('171821:headset')>=0&&e.slug.indexOf('117042:controller')>=0
   &&e.slug.indexOf('69528:anime')>=0,'★★★3つは自分の名前でファイルが出る');
ok(e.slug.indexOf('139973:game')>=0&&e.slug.indexOf('261055:fig')>=0
   &&e.slug.indexOf('261068:fig')>=0&&e.slug.indexOf('171831:fig')>=0
   &&e.slug.indexOf('262324:fig')>=0,'★★★既存のカテゴリのファイル名は今までどおり');
ok(!e.err&&e.nFiles===3,'★★★3カテゴリを選んで書き出すと、カテゴリごとに3ファイル');
ok(new Set(e.files.map((f)=>f.name)).size===3,
   '★★★ファイル名が重ならない（同じ件数でも ZIP の中で上書きされない）');
ok(/-headset-/.test(e.files[0].name)&&/-controller-/.test(e.files[1].name)
   &&/-anime-/.test(e.files[2].name),'★★ファイル名にカテゴリの名前が入る');
ok(/ヘッドセット（171821）（1件）/.test(e.files[0].label),'★ボタンの名前にもカテゴリが出る');
ok(/\*C:Brand,\*C:Type,\*C:Compatible Platform/.test(e.files[0].head)
   &&/\*C:Type,\*C:Franchise/.test(e.files[2].head),
   '★★★それぞれのファイルが、そのカテゴリの必須の列を持つ');
ok(/,171821,/.test(e.files[0].body)&&/HORI/.test(e.files[0].body)
   &&/Jujutsu Kaisen/.test(e.files[2].body),'★★カテゴリ番号と入れた値が行に出る');
ok(e.saved.length===1&&/\.zip$/.test(e.saved[0]),'★2つ以上のときは1つの ZIP にまとめる（今までどおり）');
ok(e.exp.every((x)=>!!x),'★書き出した行に印が付く（今までどおり）');
{
  const all=e.files.map((f)=>f.body).join('\n');
  ok(!/shopify/i.test(all),'★★★出品ファイルに Shopify への誘導が入らない');
  ok(!/amazon|media-amazon|images-na/i.test(all),'★★★Amazon の画像（URL）が入らない');
  ok(/https:\/\/img\.example\/i\/20261121\/mw-1\.jpg/.test(all),
     '★★写真は行に控えた画像（MW が許諾した画像）だけ');
}

console.log('\n=== ⑧ 既存のカテゴリの列は変えていない ===');
let f=await p.evaluate(()=>({
  game:csvHeadFor('139973')===CSV_HEAD['139973'],
  fig:csvHeadFor('261055')===CSV_HEAD['261055'],
  act:csvHeadFor('261068')===CSV_HEAD['261068'],
  pod:csvHeadFor('171831').split(',').filter(function(h){ return /^\*?C:/.test(h); }).join(','),
  model:csvHeadFor('262324').split(',').filter(function(h){ return /^\*?C:/.test(h); }).join(',') }));
console.log('   '+JSON.stringify(f));
ok(f.game&&f.fig&&f.act,'★★★ゲーム・フィギュア2つの列はテンプレートのまま');
ok(f.pod==='C:Brand,C:Country/Region of Manufacture','★★★171831 の列は登録の中身のまま');
ok(f.model==='*C:Brand,C:Type','★★★262324 の列は登録の中身のまま');
await T.done();
})();
