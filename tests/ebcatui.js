/* 出品CSVタブ：eBayカテゴリを足す／カテゴリ候補／出品文の直し（8.65〜8.67）
   ・カテゴリの表は pj-sync（D1 の ebay_cat）が持つ。画面は GET /ebay/cat で読む
   ・⚙から「探す」（getCategorySuggestions）→「足す」（getItemAspectsForCategory）
   ・足したカテゴリは行の選択肢に出て、列ヘッダはそのカテゴリの Item specifics で作る
   ・必須の項目が空の行は書き出さない（理由はカードに出す）
   ・英題から聞いたカテゴリ候補が未登録の行は書き出さない
   ・英題を手で直したら出品文の商品名も合う。無在庫（MW）は手で検品した言い方を使わない
   pj-sync への通信は、この確認では画面の中で差し替えている（鍵は送られる形だけ見る）。 */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('出品CSVタブ：eBayカテゴリを足す（8.65〜8.67）');
const ok = T.ok;

const CSV=['SKU,商品名,ASIN,JAN,出品コンディション,仕入価格,数量,重量',
  'hobby-20260101-N-B0CARD001-1200,カードポッド スイッチ2用,B0CARD001,4528272010290,新品,1200,1,',
  'hobby-20260101-N-B0CARD002-1200,カードケース スイッチ2用,B0CARD002,4528272010306,新品,1200,1,'
].join('\n');

(async()=>{
const p=await T.open();
await p.click('#tabD');

// pj-sync の返事を画面の中で差し替える（通信はしない）
await p.evaluate(()=>{
  window.__posts=[];
  window.__cats=[
    {code:'139973',name:'Video Games',ja:'ゲーム',path:'Video Games',
     need:['Game Name','Platform'],opt:['Publisher'],tpl:'139973',seed:true},
    {code:'261055',name:'Figures',ja:'',path:'Collectibles > Figures',
     need:['Type'],opt:['Brand'],tpl:'261055',seed:true},
    {code:'261068',name:'Action Figures',ja:'',path:'Collectibles > Action Figures',
     need:['Type'],opt:['Brand'],tpl:'261068',seed:true}
  ];
  window.__find=[{code:'183456',name:'Card Storage Cases',
                  path:'Toys & Hobbies > Collectible Card Games > Card Storage Cases'}];
  window.fetch=function(url,opt){
    url=String(url); opt=opt||{};
    var body=null;
    try{ body=opt.body?JSON.parse(opt.body):null; }catch(e){}
    var key=(opt.headers||{})['X-PJ-Key']||'';
    function J(o){ return Promise.resolve({ ok:true, status:200,
      json:function(){ return Promise.resolve(o); } }); }
    if(/\/ebay\/cat$/.test(url)){
      window.__posts.push({path:'list',method:opt.method||'GET',key:key});
      return J({ok:true,rows:window.__cats,n:window.__cats.length});
    }
    if(/\/ebay\/cat\/find$/.test(url)){
      window.__posts.push({path:'find',method:opt.method,key:key,body:body});
      return J({ok:true,rows:window.__find,q:body&&body.q});
    }
    if(/\/ebay\/cat\/add$/.test(url)){
      window.__posts.push({path:'add',method:opt.method,key:key,body:body});
      window.__cats=window.__cats.concat([{code:String(body.code),name:body.name,
        ja:body.ja,path:body.path,need:['Type','Brand'],
        opt:['Color','Material'],tpl:'261055',seed:false}]);
      return J({ok:true,code:String(body.code),name:body.name,path:body.path,
                need:['Type','Brand'],opt:['Color','Material']});
    }
    if(/\/ebay\/cat\/del$/.test(url)){
      window.__posts.push({path:'del',method:opt.method,key:key,body:body});
      window.__cats=window.__cats.filter(function(c){
        return String(c.code)!==String(body.code); });
      return J({ok:true,code:String(body.code)});
    }
    if(/figure-titles$/.test(url)){
      window.__posts.push({path:'titles',method:opt.method,body:body});
      return J({results:[{status:'ok',candidates:[],note:'',
        fields:{brand:'Hori',series:'',chara:'',item_name:'Card Pod',
                aspects:{Type:'Card Case',Brand:'Hori'}}}]});
    }
    return J({ok:false,error:'not_stubbed'});
  };
  $('syncApi').value='https://sync.test';
  $('syncKey').value='TEST-KEY';
  $('csvCatCustom').value='';
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P';
  $('csvLocation').value='Tokyo'; $('csvShipProfile').value='W1000';
  ebCats=[];
});

console.log('=== ① ⚙の一覧（pj-sync の表を読む）===');
const one=await p.evaluate(async()=>{
  await ebCatPull();
  var box=$('ebCatListBox').textContent;
  return { n:ebCats.length, box:box,
           seed:ebCats.filter(function(c){return c.seed;}).length,
           del:document.querySelectorAll('#ebCatListBox [data-ebdel]').length,
           note:$('ebCatNote').textContent,
           got:(window.__posts[0]||{}),
           // 行の選択肢（はじめの3つだけ）
           opts:csvCustomCats().map(function(c){return c.id;}) };
});
ok(one.n===3,'はじめから入っているカテゴリ3つを読む（'+one.n+'件）');
ok(one.seed===3,'3つとも「はじめから」の印が付く');
ok(one.del===0,'はじめの3つに「外す」は出ない');
ok(one.box.indexOf('ゲーム（139973）')>=0,'表示名（ゲーム）と番号が出る');
ok(one.box.indexOf('必須：Game Name／Platform')>=0,'必須の Item specifics が出る');
ok(one.got.method==='GET'&&one.got.key==='TEST-KEY',
   '一覧は GET で、⚙のキーを付けて読む');
ok(one.opts.length===0,'はじめの3つは「足したカテゴリ」には出ない');
ok(one.note.indexOf('3件')>=0,'読めた件数を出す：'+one.note);

console.log('=== ② 探す → 足す（必須の項目を eBay から控える）===');
const two=await p.evaluate(async()=>{
  $('ebCatQ').value='card case for Nintendo Switch 2';
  $('ebCatJa').value='カードケース';
  ebCatFind();
  await new Promise(function(r){ setTimeout(r,60); });
  var found=$('ebCatFoundBox').textContent;
  var btn=document.querySelector('#ebCatFoundBox [data-ebadd]');
  var findPost=window.__posts.filter(function(x){return x.path==='find';})[0]||{};
  if(btn)btn.click();
  await new Promise(function(r){ setTimeout(r,120); });
  var addPost=window.__posts.filter(function(x){return x.path==='add';})[0]||{};
  return { found:found, findPost:findPost, addPost:addPost,
           note:$('ebCatNote').textContent,
           n:ebCats.length, need:ebCatNeed('183456'),
           box:$('ebCatListBox').textContent,
           del:document.querySelectorAll('#ebCatListBox [data-ebdel]').length,
           cats:csvCustomCats() };
});
ok(two.findPost.method==='POST'&&two.findPost.body.q==='card case for Nintendo Switch 2',
   '英語の商品名をそのまま pj-sync に渡す');
ok(two.found.indexOf('Card Storage Cases（183456）')>=0,'候補を名前と番号で出す');
ok(two.found.indexOf('Card Storage Cases')>=0&&two.found.indexOf('Toys & Hobbies')>=0,
   '候補にカテゴリの道筋も出る');
ok(two.addPost.body&&two.addPost.body.code==='183456'
   &&two.addPost.body.name==='Card Storage Cases'
   &&two.addPost.body.path.indexOf('Toys & Hobbies')===0,
   '足すときは番号・名前・道筋を渡す');
ok(two.addPost.body&&two.addPost.body.ja==='カードケース','表示名（日本語）も渡す');
ok(String(two.addPost.key||'')==='TEST-KEY','足すときも⚙のキーを付ける');
ok(two.note.indexOf('Type')>=0&&two.note.indexOf('Brand')>=0,
   '足したあと、必須の Item specifics を知らせる：'+two.note);
ok(two.n===4,'一覧が4件になる');
ok(two.need.join(',')==='Type,Brand','必須の項目を控えている');
ok(two.del===1,'足したカテゴリには「外す」が出る（はじめの3つには出ない）');
ok(two.cats.length===1&&two.cats[0].id==='183456'&&two.cats[0].name==='カードケース'
   &&two.cats[0].d1===true,'行の選択肢に出る形になる');

console.log('=== ③ 行のカテゴリ選択と列ヘッダ ===');
await openCsvBoxes(p);
const three=await p.evaluate((text)=>{
  csvList=[]; csvPick={};
  csvImport(text);
  csvList.forEach(function(r){
    r.pics=[{url:'https://example.test/1.jpg'}];
    r.titleEn='Card Pod for Nintendo Switch 2 Japan';
    r.specs=Object.assign(r.specs||{},{origin:'Japan'});
    r.catFixed=true; r.catDone=true;
  });
  var r0=csvList[0];
  csvCatApply(r0,'183456',true);
  csvRender();
  var sel=document.querySelector('#csvList select[data-cat="'+r0.id+'"]');
  var head=csvHeadFor('183456').split(',');
  var figHead=CSV_HEAD['261055'].split(',');
  return {
    cat:r0.cat,
    selHas:!!sel&&sel.innerHTML.indexOf('>カードケース（183456）<')>=0,
    selVal:sel?sel.value:'',
    name:csvCatName('183456'),
    tpl:csvCatTpl('183456'),
    need:head.filter(function(h){return /^\*C:/.test(h);}),
    opt:head.filter(function(h){return /^C:/.test(h);}),
    keepTitle:head.indexOf('*Title')>=0,
    keepPic:head.indexOf('PicURL')>=0,
    keepLast:head[head.length-1]===figHead[figHead.length-1],
    noFigSpec:head.indexOf('C:Franchise')<0,
    len:head.length
  };
},CSV);
ok(three.cat==='183456','行のカテゴリを足したカテゴリにできる');
ok(three.selHas,'行のカテゴリ選択に「カードケース（183456）」が出る');
ok(three.selVal==='183456','いまのカテゴリが選ばれている');
ok(three.name==='カードケース（183456）','画面に出す名前');
ok(three.tpl==='261055','出品文の形は非可動フィギュアのものを流用する');
ok(three.need.join(',')==='*C:Type,*C:Brand','必須の項目は *C: の列になる');
ok(three.opt.join(',')==='C:Color,C:Material','そのほかの項目は C: の列になる');
ok(three.keepTitle&&three.keepPic&&three.keepLast,
   'C: 以外の列（題名・写真・末尾）はテンプレートのまま');
ok(three.noFigSpec,'フィギュアの項目（C:Franchise）は入らない');

console.log('=== ④ 必須の項目が空の行は書き出さない ===');
const four=await p.evaluate(()=>{
  var r0=csvList[0];
  r0.descHtml=csvDescFor(r0);
  var miss0=csvNeedMiss(r0).slice();
  var iss0=csvIssues(r0);
  var sp0=csvExportSplit([r0.id]);
  var card=document.querySelector('#csvList div[data-row="'+r0.id+'"]');
  // 行の欄から必須の項目を入れる
  r0.specs.aspects={Type:'Card Case',Brand:'Hori'};
  var miss1=csvNeedMiss(r0).slice();
  var iss1=csvIssues(r0);
  var sp1=csvExportSplit([r0.id]);
  var row=csvRowFor(r0);
  var csv=csvBuild('183456',[r0],'Add').split('\r\n');
  var head=csv[1].split(',');
  var vals=csv[2].split(',');
  return { miss0:miss0, why0:(sp0.bad[0]||{}).why||'', nRows0:sp0.rows.length,
           iss0:iss0.filter(function(x){return x.indexOf('必須の項目')===0;}),
           miss1:miss1, nRows1:sp1.rows.length, iss1:iss1,
           type:row['*C:Type'], brand:row['*C:Brand'], color:row['C:Color'],
           mpn:row['C:MPN'], cat:row['*Category'],
           csvType:vals[head.indexOf('*C:Type')],
           csvBrand:vals[head.indexOf('*C:Brand')],
           fields:document.querySelectorAll('[data-aspk]').length,
           cardTxt:card?card.textContent:'' };
});
ok(four.miss0.join(',')==='Type,Brand','必須の項目が空だと分かる');
ok(four.nRows0===0,'空のままでは書き出さない');
ok(four.why0.indexOf('必須の項目「Type」が空')>=0,
   '書き出さない理由を出す：'+four.why0);
ok(four.cardTxt.indexOf('このカテゴリの必須の項目')>=0,
   'カードに必須の項目の欄が出る（空のときは開いた状態）');
ok(four.fields===2,'必須の項目ぶんの入力欄が出る（'+four.fields+'）');
ok(four.miss1.length===0,'入れると空が無くなる');
ok(four.nRows1===1,'入れると書き出せる');
ok(four.type==='Card Case'&&four.brand==='Hori','入れた値が Item specifics に入る');
ok(four.color===''&&four.mpn===undefined,
   'そのほかの項目は空のまま（フィギュアの決め打ちは入らない）');
ok(four.csvType==='Card Case'&&four.csvBrand==='Hori','CSVの列に入る');
ok(four.cat==='183456','*Category は足したカテゴリの番号');

console.log('=== ⑤ カテゴリ候補（未登録は書き出さない）===');
const five=await p.evaluate(async()=>{
  var r1=csvList[1];
  // いまはフィギュア（261055）。英題から聞くと「カードケース」が返る形にする
  window.__find=[{code:'183456',name:'Card Storage Cases',path:'Toys & Hobbies'}];
  await csvCatSugAsk(r1);
  var s1=csvCatSugOf(r1);
  csvRender();
  var card1=document.querySelector('#csvList div[data-row="'+r1.id+'"]');
  var use=document.querySelector('#csvList [data-catuse="'+r1.id+'"]');
  var txt1=card1?card1.textContent:'';
  // 登録してあるカテゴリなので、押せば切り替わる
  if(use)use.click();
  await new Promise(function(r){ setTimeout(r,60); });
  var after=r1.cat;
  /* ほかの不備（説明文・必須の項目）は埋めておく。
     ここで見たいのは「未登録の候補だけで書き出しが止まるか」。 */
  r1.specs.aspects={Type:'Card Case',Brand:'Hori'};
  r1.descHtml=csvDescFor(r1);
  // 未登録のカテゴリが返る形にする
  window.__find=[{code:'999999',name:'Brand New Thing',path:'Toys & Hobbies > New'}];
  r1.titleEn='Something Else Entirely';
  await csvCatSugAsk(r1);
  var s2=csvCatSugOf(r1);
  var blocked=csvCatSugBlock(r1);
  var sp=csvExportSplit([r1.id]);
  csvRender();
  var card2=document.querySelector('#csvList div[data-row="'+r1.id+'"]');
  var txt2=card2?card2.textContent:'';
  var keep=document.querySelector('#csvList [data-catkeep="'+r1.id+'"]');
  if(keep)keep.click();
  await new Promise(function(r){ setTimeout(r,60); });
  var sp2=csvExportSplit([r1.id]);
  // 候補が変わったら、また止める（別の候補を見ていないため）
  window.__find=[{code:'888888',name:'Yet Another',path:'Toys & Hobbies > Other'}];
  r1.titleEn='Third Title Here';
  await csvCatSugAsk(r1);
  return { code1:s1&&s1.code, known1:s1&&s1.known, same1:s1&&s1.same,
           txt1:txt1, after:after,
           code2:s2&&s2.code, known2:s2&&s2.known, blocked:blocked,
           why:(sp.bad[0]||{}).why||'', nRows:sp.rows.length,
           txt2:txt2,
           okAfterKeep:sp2.rows.length, blockAgain:csvCatSugBlock(r1) };
});
ok(five.code1==='183456'&&five.known1===true&&five.same1!==true,
   '英題からカテゴリ候補が出て、登録済みと分かる');
ok(five.txt1.indexOf('カテゴリ候補：Card Storage Cases（183456）')>=0,
   'カードに「カテゴリ候補：〇〇（番号）」と出る');
ok(five.after==='183456','押すとその場でカテゴリが切り替わる');
ok(five.code2==='999999'&&five.known2===false,'未登録の候補も分かる');
ok(five.txt2.indexOf('新しいカテゴリ（未登録）')>=0,
   'カードに「新しいカテゴリ（未登録）」と出る');
ok(five.txt2.indexOf('⚙')>=0,'⚙で足せることも出る');
ok(five.blocked===true&&five.nRows===0,'未登録の候補が出ている行は書き出さない');
ok(five.why.indexOf('新しいカテゴリ（未登録）')>=0,'理由を出す：'+five.why);
ok(five.okAfterKeep===1,'「このままでよい」を押せば書き出せる');
ok(five.blockAgain===true,'別の候補が出たら、また止める');

console.log('=== ⑥ 出品文（英題を直したとき・無在庫のとき）===');
const six=await p.evaluate(()=>{
  var r=csvList[0];
  r.buySource=''; r.dropship=false;
  r.titleEn='Card Pod for Nintendo Switch 2 Japan';
  r.descHtml=csvDescFor(r);
  var had=r.descHtml.indexOf('Card Pod for Nintendo Switch 2 Japan')>=0;
  var hand=/inspected by hand/i.test(r.descHtml);
  // 英題を手で直す
  r.titleEn='Card Pod 24 Slots for Nintendo Switch 2';
  var fixed=csvDescTitleFix(r);
  var m=r.descHtml.match(/<!--TITLE-->([\s\S]*?)<!--\/TITLE-->/);
  // 無在庫（MW）の行
  var w=csvList[1];
  w.buySource='mw'; w.dropship=true;
  w.titleEn='Card Case for Nintendo Switch 2';
  w.descHtml=csvDescFor(w);
  var plainOn=(function(){
    $('bDrop').checked=true; var t=descPlain(); $('bDrop').checked=false; return t; })();
  // すでに作ってある出品文（手で検品した言い方）も直す
  w.descHtml=w.descHtml.split(CONDNOTE_MW.sealed).join(CONDNOTE.sealed);
  var before=/inspected by hand/i.test(w.descHtml);
  var mwFix=csvDescMwFix(w);
  return { had:had, hand:hand, fixed:fixed, title:m?m[1]:'',
           mw:w.descHtml, before:before, mwFix:mwFix,
           plainHand:/inspected by hand/i.test(plainOn) };
});
ok(six.had&&six.hand,'手持ちの行は今までどおり（商品名と「手で検品」の文）');
ok(six.fixed===true&&six.title==='Card Pod 24 Slots for Nintendo Switch 2',
   '英題を手で直すと、出品文の商品名も合う');
ok(!/inspected by hand/i.test(six.mw),
   '無在庫（MW）の行に「手で検品した」文を入れない');
ok(six.mw.indexOf('not photographs of the individual copy you will receive')>=0,
   '写真が届く1点のものではないと書く');
ok(six.before===true&&six.mwFix===true,
   'すでに作ってある出品文も、その文だけ入れ替える');
ok(!six.plainHand,'アプリ用の文字だけの版も同じ');

console.log('=== ⑦ 英題生成に「このカテゴリで必須の項目」を渡す ===');
const seven=await p.evaluate(async()=>{
  $('csvTitleApi').value='https://title.test';
  $('csvTitleKey').value='T-KEY';
  var r=csvList[0];
  r.cat='183456'; r.specs.aspects={};
  await csvTitleSend('fig',[r],false);
  var post=window.__posts.filter(function(x){return x.path==='titles';})[0]||{};
  var it=(post.body&&post.body.items&&post.body.items[0])||{};
  return { need:(it.need_aspects||[]).join(','),
           asp:JSON.stringify(r.specs.aspects||{}),
           miss:csvNeedMiss(r).length };
});
ok(seven.need==='Type,Brand','そのカテゴリで必須の項目を渡す');
ok(seven.asp==='{"Type":"Card Case","Brand":"Hori"}',
   '返ってきた値を行に入れる：'+seven.asp);
ok(seven.miss===0,'埋まった行は「不備」にならない');

await T.done();
})();
