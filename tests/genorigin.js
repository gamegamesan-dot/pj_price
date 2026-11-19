/* 出品CSVタブ・販売連携タブ：ジャンルごとの原産国の既定（8.72・カジの方針）
   ・ゲーム関連 → Japan／フィギュア・ホビー関連 → China
   ・Amazon で原産国が分からない品はこの既定で出し、**発送のときに実物で確かめる**
   ・入れる順（上が優先）：行で確定した値 → Amazon のカタログ →
     ⚙「メーカーごとの原産国」→ ジャンルの既定 → （どれも無ければ入れない）
   ・⚙は「ジャンルごとの原産国の既定」1か所だけ（v324 までの「原産国の既定値」は
     この表にまとめた）
   ・既定で入れた行は「原産国：ジャンルの既定」と出し、**書き出しは止めない**
   ・売れた行には「原産国は既定値（発送時に確認）」と出し、その場で直せる */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('原産国：ジャンルごとの既定（8.72）');
const ok = T.ok;

(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept('Vietnam'); });
await p.click('#tabD');

await p.evaluate(()=>{
  /* 登録したカテゴリ：ゲームの下（カードケース）とホビーの下（ぬいぐるみ）、
     どちらにも当てはまらないもの。 */
  ebCats=[
    {code:'139973',name:'Video Games',ja:'ゲーム',path:'Video Games & Consoles > Video Games',
     need:[],opt:[],tpl:'139973',seed:true},
    {code:'261055',name:'Figures',ja:'',path:'Toys & Hobbies > Action Figures',
     need:[],opt:[],tpl:'261055',seed:true},
    {code:'261068',name:'Action Figures',ja:'',path:'Toys & Hobbies > Action Figures',
     need:[],opt:[],tpl:'261068',seed:true},
    {code:'171831',name:'Card Storage Cases',ja:'カードケース',
     path:'Video Games & Consoles > Video Game Accessories > Card Storage Cases',
     need:[],opt:['Country/Region of Manufacture'],tpl:'261055',seed:false},
    {code:'20915',name:'Plush',ja:'ぬいぐるみ',
     path:'Toys & Hobbies > Stuffed Animals > Plush',
     need:[],opt:[],tpl:'261055',seed:false},
    {code:'99900',name:'Other',ja:'そのほか',path:'Everything Else > Other',
     need:[],opt:[],tpl:'261055',seed:false}
  ];
  csvAddCatOpts();
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P';
  $('csvLocation').value='Tokyo'; $('csvShipProfile').value='W1000';
  $('csvMakerOrigin').value='キーズファクトリー,Japan,Keys Factory';
  $('syncApi').value=''; $('syncKey').value='';
});
await openCsvBoxes(p);

console.log('=== ① ジャンルの見分け方 ===');
const one=await p.evaluate(()=>{
  /* 行を作る（この中で作らないと渡せない）。 */
  var mk=function(id,cat,x){
    return Object.assign({
      id:id, src:'sedori', sku:'hobby-20261118-N-B0GEN000'+id+'-1200',
      asin:'B0GEN000'+id, jan:'452827201029'+id, titleJa:'テスト'+id,
      titleEn:'Test Item '+id, cat:cat, catFixed:true, catDone:true,
      condId:1000, cost:1200, qty:1, weight:200,
      pics:[{url:'u'+id}], descHtml:'<p>d</p>',
      specs:{ origin:'', platform:'', brand:'' },
      zeroAct:'hold', fba:false, oneOff:false, itemId:'', sold:'',
      dropship:false, titleStatus:'', titleCands:[], titleNote:'',
      titleManual:false },x||{});
  };
  csvList=[
    mk('1','139973'),                                  // ゲームソフト
    mk('2','171831',{mwKishu:'NS2H'}),                 // ゲームの下（カードケース）
    mk('3','261055'),                                  // フィギュア
    mk('4','20915'),                                   // ホビーの下（ぬいぐるみ）
    mk('5','99900'),                                   // どちらでもない
    mk('6','',{mwKishu:'b2cchara_figure'}),            // 機種だけで見分ける
    mk('7','',{mwKishu:'NS2H'})                        // 機種だけで見分ける
  ];
  csvSaveList();
  return csvList.map(function(r){
    var gi=csvGenreInfo(r);
    return { id:r.id, genre:csvGenreOf(r), origin:gi?gi.origin:'' };
  });
});
console.log('   '+JSON.stringify(one));
ok(one[0].genre==='game'&&one[0].origin==='Japan','★★★ゲーム 139973 → ゲーム・Japan');
ok(one[1].genre==='game'&&one[1].origin==='Japan',
   '★★★Video Games & Consoles の下で登録したカテゴリ（171831）→ ゲーム');
ok(one[2].genre==='fig'&&one[2].origin==='China',
   '★★★フィギュア 261055 → フィギュア・ホビー・China');
ok(one[3].genre==='fig'&&one[3].origin==='China',
   '★★★Toys & Hobbies の下で登録したカテゴリ → フィギュア・ホビー');
ok(one[4].genre===''&&one[4].origin==='',
   '★★★どちらにも当てはまらないカテゴリは決めない（推測しない）');
ok(one[5].genre==='fig','★★MW の機種（b2cchara_figure）でも見分ける');
ok(one[6].genre==='game','★★MW の機種（NS2H）でも見分ける');

console.log('=== ② 入れる順（上が優先）===');
const two=await p.evaluate(()=>{
  var o={};
  // ①行で確定した値
  var a=csvRowById('3');
  a.specs={ origin:'Vietnam', originManual:true };
  o.manual=csvOriginFill(a)===false&&a.specs.origin==='Vietnam';
  // ②Amazon のカタログ（csvApplyFields で入る値）
  var b=csvRowById('3');
  b.specs={ origin:'' };
  csvApplyFields(b,{ origin:'Thailand' });
  o.amz=(b.specs.origin==='Thailand'&&!b.specs.originGenre&&!b.specs.originDefault);
  // ③メーカーの表
  var c=csvRowById('2');
  c.specs={ origin:'' }; c.mwSha='MC02'; c.buySource='mw';
  c.titleJa='カードポッド【キーズファクトリー 】';
  var f3=csvOriginFill(c);
  o.maker={ f:f3, origin:c.specs.origin, mk:!!c.specs.originMaker,
            gn:!!c.specs.originGenre };
  // ④ジャンルの既定（メーカーが表に無い行）
  var d=csvRowById('2');
  d.specs={ origin:'' }; d.titleJa='カードポッド【知らない社 】';
  var f4=csvOriginFill(d);
  o.genre={ f:f4, origin:d.specs.origin, gn:!!d.specs.originGenre,
            ja:d.specs.originGenreJa||'', def:!!d.specs.originDefault };
  // ⑤どれも無い行
  var e=csvRowById('5');
  e.specs={ origin:'' };
  o.none={ f:csvOriginFill(e), origin:e.specs.origin,
           need:csvIssues(e).filter(function(x){ return x==='原産国なし'; }).length };
  return o;
});
ok(two.manual,'★★★行で確定した値はどの処理でも上書きしない');
ok(two.amz,'★★★Amazon のカタログの値が次（既定の印は付かない）');
ok(two.maker.f&&two.maker.origin==='Japan'&&two.maker.mk&&!two.maker.gn,
   '★★★メーカーの表はジャンルより先（メーカーの既定の印）');
ok(two.genre.f&&two.genre.origin==='Japan'&&two.genre.gn&&two.genre.ja==='ゲーム',
   '★★★メーカーが表に無ければジャンルの既定（ゲーム→Japan）');
ok(two.genre.def,'★★「既定で入れた」印も立つ（6.84 の扱いは今までどおり）');
ok(two.none.f===false&&two.none.origin===''&&two.none.need===1,
   '★★★どのジャンルにも当てはまらない行は入れずに「原産国なし」で止める');

console.log('=== ③ ⚙は1か所・バッジ・書き出しは止めない ===');
const three=await p.evaluate(()=>{
  var o={ old:!!document.getElementById('csvOriginDefault'),
          box:!!document.getElementById('csvGenreOrigin'),
          saved:CSV_CFG_IDS.indexOf('csvGenreOrigin')>=0 };
  var d=csvRowById('2');
  d.specs={ origin:'' }; d.titleJa='カードポッド【知らない社 】';
  csvOriginFill(d);
  csvRender();
  var sel=document.querySelector('#csvList select[data-origsel="2"]');
  o.badge=sel?sel.options[0].textContent:'';
  o.iss=csvIssues(d).filter(function(x){ return /原産国/.test(x); }).length;
  o.rows=csvExportSplit(['2']).rows.length;
  o.col=csvRowFor(d)['C:Country/Region of Manufacture'];
  /* 絞り込み「原産国：既定値の行だけ」でも拾える。 */
  o.filter=CSV_FILTERS.filter(function(x){ return x.v==='origin'; })
    .map(function(x){ return x.f(d); })[0];
  /* ⚙の表を変えたら、次に埋める値も変わる。 */
  $('csvGenreOrigin').value='ゲーム,Japan\nフィギュア・ホビー,Vietnam';
  var f=csvRowById('3');
  f.specs={ origin:'' };
  csvOriginFill(f);
  o.changed=f.specs.origin;
  /* ジャンルを足せる（3列目の「見分ける言葉」で見分ける）。 */
  $('csvGenreOrigin').value='ゲーム,Japan\nフィギュア・ホビー,China\n'
    +'そのほか,Thailand,Everything Else';
  var g=csvRowById('5');
  g.specs={ origin:'' };
  o.addFill=csvOriginFill(g);
  o.added=g.specs.origin;
  o.addedJa=g.specs.originGenreJa||'';
  $('csvGenreOrigin').value='ゲーム,Japan\nフィギュア・ホビー,China';
  return o;
});
ok(three.old===false&&three.box,
   '★★★⚙は「ジャンルごとの原産国の既定」1か所だけ（前の「原産国の既定値」は無い）');
ok(three.saved,'★★⚙の値として保存される');
ok(/ジャンルの既定/.test(three.badge)&&/Japan/.test(three.badge),
   '★★★カードに「原産国：ジャンルの既定（Japan）」と出る：'+three.badge);
ok(three.iss===0&&three.rows===1,'★★★既定で入れても書き出しは止めない');
ok(three.col==='Japan','★★原産国の項目にも入る');
ok(three.filter===true,'★★絞り込み「原産国：既定値の行だけ」で探せる');
ok(three.changed==='Vietnam','★★★⚙を変えると入る値も変わる');
ok(three.addFill&&three.added==='Thailand'&&three.addedJa==='そのほか',
   '★★★ジャンルを足せる（見分ける言葉で見分ける）');

console.log('=== ④ 売れた行で発送のときに確かめる ===');
const four=await p.evaluate(()=>{
  var d=csvRowById('2');
  d.specs={ origin:'' }; d.titleJa='カードポッド【知らない社 】'; d.asin='B0GEN0002';
  csvOriginFill(d);
  d.descHtml='<p>x</p>';
  /* 販売連携の行（D1 の出品データ）を作る。売れた行（sold_keep=1）。 */
  syncData={ at:new Date().toISOString(), items:[
    { asin:'B0GEN0002', cond:'new', title:'Test Item 2', sku:d.sku,
      ebay_item_id:'1234567890', ebay_qty:0, ebay_price:30,
      sold_keep:1, sold_price:30, sold_kept_at:'2026-11-18T01:00:00Z' },
    { asin:'B0GEN0003', cond:'new', title:'Not sold', ebay_item_id:'2',
      ebay_qty:1, ebay_price:20, sold_keep:0 }
  ] };
  syncRender();
  var txt=$('syncList').textContent;
  var sel=document.querySelector('#syncList select[data-sorig]');
  var o={ shown:/原産国は既定値（発送時に確認）/.test(txt),
          onSold:!!sel,
          only:document.querySelectorAll('#syncList select[data-sorig]').length };
  /* 実物を見て Japan ではなく China だった、という操作。 */
  if(sel){
    sel.value='China';
    sel.dispatchEvent(new Event('change',{bubbles:true}));
  }
  var d2=csvRowById('2');
  o.after=d2.specs.origin;
  o.manual=!!d2.specs.originManual;
  o.gone=!!d2.specs.originGenre;
  o.col=csvRowFor(d2)['C:Country/Region of Manufacture'];
  o.txt2=$('syncList').textContent;
  return o;
});
ok(four.shown,'★★★売れた行に「原産国は既定値（発送時に確認）」と出る');
ok(four.onSold&&four.only===1,'★★売れた行だけに出る（売れていない行には出さない）');
ok(four.after==='China'&&four.manual&&!four.gone,
   '★★★その場で実物の値を入れると、出品リストの行に「確かめた値」として入る');
ok(four.col==='China','★★★次の再出品・Revise でその値が使われる（書き出しの列）');
ok(/実物で確かめた値/.test(four.txt2),
   '★★確かめたあとは「実物で確かめた値」と出る');

await T.done();
})();
