/* 出品CSVタブ：型番（MPN）・英題と specs の食い違い・メーカーの原産国（8.68〜8.71）
   カードポッド（MW 無在庫・登録したカテゴリ）の初出品で分かったこと。
   ・C:MPN に JAN が入っていた（MPN はメーカーの型番。JAN は EAN）
   ・英題を手で「Nintendo Switch 2」に直しても C:Platform が古いまま出ていた
   ・メーカー（キーズファクトリー）から Brand と原産国を入れたい
   ・写真を取り込んでも、候補一覧を取り直すまで「写真あり」にならなかった */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('出品CSVタブ：型番・英題と specs・メーカーの原産国（8.68〜8.71）');
const ok = T.ok;

const CSV=['SKU,商品名,ASIN,JAN,出品コンディション,仕入価格,数量,重量',
  'hobby-20260101-N-B0POD001-1200,カードポッド スイッチ2用,B0POD001,4528272010290,新品,1200,1,',
  'game-20260101-N-B0GAME01-3000,マリオ スイッチ2版,B0GAME01,4902370556789,新品,3000,1,'
].join('\n');

(async()=>{
const p=await T.open();
await p.click('#tabD');

// 登録したカテゴリ（171831）を持っている状態にする。EAN と MPN を項目に持つ
await p.evaluate(()=>{
  ebCats=[
    {code:'139973',name:'Video Games',ja:'ゲーム',path:'',
     need:['Game Name','Platform'],opt:[],tpl:'139973',seed:true},
    {code:'261055',name:'Figures',ja:'',path:'',need:['Type'],opt:[],
     tpl:'261055',seed:true},
    {code:'261068',name:'Action Figures',ja:'',path:'',need:['Type'],opt:[],
     tpl:'261068',seed:true},
    {code:'171831',name:'Card Storage Cases',ja:'カードケース',
     path:'Video Games & Consoles > Video Game Accessories',
     need:['Type','Brand'],
     opt:['MPN','EAN','UPC','Platform','Country/Region of Manufacture','Color'],
     tpl:'261055',seed:false}
  ];
  csvAddCatOpts();
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P';
  $('csvLocation').value='Tokyo'; $('csvShipProfile').value='W1000';
  $('csvGenreOrigin').value='ゲーム,Japan\nフィギュア・ホビー,China';
  $('csvMakerOrigin').value='キーズファクトリー,Japan,Keys Factory';
});
await openCsvBoxes(p);

const base=async()=>await p.evaluate((text)=>{
  csvList=[]; csvPick={};
  csvImport(text);
  csvList.forEach(function(r){
    r.pics=[{url:'https://example.test/1.jpg'}];
    r.catFixed=true; r.catDone=true;
  });
  // ①カードポッド：MW 無在庫・メーカーは キーズファクトリー
  var pod=csvList[0];
  csvCatApply(pod,'171831',true);
  /* 8.74「社」は売主のコード（MC02 など）。メーカー名は商品名の末尾の【 】。 */
  pod.buySource='mw'; pod.dropship=true; pod.mwSha='MC02';
  pod.titleJa='カードポッド スイッチ2用【キーズファクトリー 】';
  pod.titleEn='Keys Factory Card Pod 24 for Nintendo Switch 2 Japan';
  pod.specs.aspects={Type:'Card Case',Brand:'Keys Factory',
                     Platform:'Nintendo Switch 2'};
  // ②ゲーム：Switch 2 のソフト
  var g=csvList[1];
  csvCatApply(g,'139973',true);
  g.specs.platform='Nintendo Switch 2';
  g.specs.gameName='Mario';
  g.titleEn=gameTitleFrom(false,'Nintendo Switch 2','Mario',false).text;
  csvRender();
  return { n:csvList.length, pod:pod.id, game:g.id, gameTitle:g.titleEn };
},CSV);
const base0=await base();

console.log('   取り込み: '+JSON.stringify(base0));
console.log('=== ① MPN はメーカーの型番（JAN は入れない）===');
const one=await p.evaluate(()=>{
  var pod=csvList[0], g=csvList[1];
  var r1=csvRowFor(pod), r2=csvRowFor(g);
  pod.specs.mpn='KCP-004-1';
  var r3=csvRowFor(pod);
  return { podMpn:r1['*C:MPN']||r1['C:MPN'], gameMpn:r2['C:MPN'],
           podMpn2:r3['*C:MPN']||r3['C:MPN'],
           na:CSV_MPN_NA,
           ean:r3['C:EAN'], upc:r3['C:UPC'], jan:pod.jan,
           field:document.querySelectorAll('[data-mpn]').length };
});
ok(one.podMpn===one.na,'★★★型番が無い行は「'+one.na+'」（JAN は入れない）');
ok(one.gameMpn===one.na,'★★★ゲームの C:MPN も JAN を入れない');
ok(one.podMpn2==='KCP-004-1','★★★型番を入れた行はその型番が入る');
ok(one.ean===one.jan,'★★★JAN は EAN の項目に入る（'+one.ean+'）');
ok(one.upc==='','★★★UPC には入れない（13桁の JAN は UPC ではない）');
ok(one.field===2,'★行のカードに型番（MPN）の欄が出る（'+one.field+'）');

console.log('=== ② 英題と Platform の食い違い ===');
const two=await p.evaluate(()=>{
  var pod=csvList[0], g=csvList[1];
  var o={};
  o.podOk=csvPlatOff(pod);
  o.gameOk=csvPlatOff(g);
  /* 英題だけを「Nintendo Switch 2」に直した行（v323 で起きたこと）。 */
  pod.specs.aspects.Platform='Nintendo Switch';
  pod.specs.platform='Nintendo Switch';
  var off=csvPlatOff(pod);
  o.off=off;
  o.iss=csvIssues(pod).filter(function(x){ return x.indexOf('英題と Platform')===0; });
  o.rows=csvExportSplit([pod.id]).rows.length;
  o.why=(csvExportSplit([pod.id]).bad[0]||{}).why||'';
  csvRender();
  o.btn=!!document.querySelector('#csvList [data-spsync="'+pod.id+'"]');
  /* ボタンで合わせる。 */
  csvSpecSync(pod.id);
  o.after=pod.specs.platform;
  o.afterAsp=pod.specs.aspects.Platform;
  o.afterOff=csvPlatOff(pod);
  o.col=csvRowFor(pod)['C:Platform'];
  /* ゲームは Game Name も作り直す。 */
  g.titleEn='Nintendo Switch 2 Super Mario Bros Wonder Japan Import';
  g.specs.platform='Nintendo Switch';
  var goff=csvPlatOff(g);
  csvSpecSync(g.id);
  o.goff=goff;
  o.gPlat=g.specs.platform;
  o.gName=g.specs.gameName;
  /* 機種が書かれていない英題では何も言わない。 */
  var x=csvList[0];
  var keep=x.titleEn;
  x.titleEn='Card Pod 24 Slots Japan';
  o.quiet=csvPlatOff(x);
  x.titleEn=keep;
  return o;
});
ok(two.podOk===null&&two.gameOk===null,'★そろっている行は何も言わない');
ok(two.off&&two.off.en==='Nintendo Switch 2'&&two.off.sp==='Nintendo Switch',
   '★★★英題と Platform の食い違いが分かる');
ok(two.iss.length===1&&/英題：Nintendo Switch 2／Platform：Nintendo Switch/
   .test(two.iss[0]),'★★★不備の理由に両方を出す：'+two.iss[0]);
ok(two.rows===0&&/英題と Platform/.test(two.why),
   '★★★食い違う行は書き出さない');
ok(two.btn,'★行に「specs を英題に合わせる」が出る');
ok(two.after==='Nintendo Switch 2'&&two.afterAsp==='Nintendo Switch 2',
   '★★★押すと Platform（specs と項目の両方）が英題に合う');
ok(two.afterOff===null&&two.col==='Nintendo Switch 2',
   '★★★書き出しの C:Platform も直る');
ok(!!two.goff&&two.gPlat==='Nintendo Switch 2',
   '★★ゲームの行でも直る');
ok(two.gName==='Super Mario Bros Wonder',
   '★★★ゲームは Game Name も英題から作り直す：'+two.gName);
ok(two.quiet===null,'★★機種が書かれていない英題では何も言わない（推測しない）');

console.log('=== ③ メーカーから Brand と原産国 ===');
const three=await p.evaluate(()=>{
  var pod=csvList[0];
  pod.specs.brand=''; pod.specs.origin=''; delete pod.specs.aspects.Brand;
  var b=csvBrandFill(pod);
  var o1=csvOriginFill(pod);
  var o={ brand:pod.specs.brand, brandMaker:!!pod.specs.brandMaker,
          origin:pod.specs.origin, maker:!!pod.specs.originMaker,
          def:!!pod.specs.originDefault, b:b, o1:o1 };
  csvRender();
  var sel=document.querySelector('#csvList select[data-origsel="'+pod.id+'"]');
  o.sel=sel?sel.options[0].textContent:'';
  o.col=csvRowFor(pod)['*C:Brand']||csvRowFor(pod)['C:Brand'];
  o.cor=csvRowFor(pod)['C:Country/Region of Manufacture'];
  /* 8.72：表に無いメーカーでも、**ジャンルの既定**が入る（この行は
     Video Games & Consoles の下＝ゲームなので Japan）。 */
  var pod2=csvList[0];
  pod2.specs.origin=''; pod2.specs.originMaker=false;
  pod2.titleJa='カードポッド スイッチ2用【知らない社 】';
  o.genreFill=csvOriginFill(pod2);
  o.genreOrigin=pod2.specs.origin;
  o.genre=!!pod2.specs.originGenre;
  /* どのジャンルにも当てはまらない行は、今までどおり入れずに止める。 */
  pod2.specs.origin=''; pod2.specs.originGenre=false; pod2.cat='999001';
  o.noFill=csvOriginFill(pod2);
  o.after=pod2.specs.origin;
  o.need=csvIssues(pod2).filter(function(x){ return x==='原産国なし'; }).length;
  o.rows=csvExportSplit([pod2.id]).rows.length;
  pod2.cat='171831';
  /* 手持ちの行（MW でない行）は今までどおり⚙の既定値を入れる。 */
  var g=csvList[1];
  g.specs.origin=''; g.cat='261055';
  var gf=csvOriginFill(g);
  o.gOrigin=g.specs.origin; o.gDef=!!g.specs.originDefault; o.gf=gf;
  g.cat='139973';
  return o;
});
ok(three.b===true&&three.brand==='Keys Factory'&&three.brandMaker,
   '★★★メーカーから英語のブランド名を入れる');
ok(three.col==='Keys Factory','★★★C:Brand に入る');
ok(three.o1===true&&three.origin==='Japan'&&three.maker&&!three.def,
   '★★★メーカーの表から原産国を入れる（既定値ではない印）');
ok(/メーカーの既定/.test(three.sel)&&/Japan/.test(three.sel),
   '★★★カードに「原産国：メーカーの既定（Japan）」と出る：'+three.sel);
ok(three.cor==='Japan','★★原産国の項目にも入る');
ok(three.genreFill===true&&three.genreOrigin==='Japan'&&three.genre,
   '★★★メーカーが表に無くても、ジャンル（ゲーム）の既定 Japan が入る（8.72）');
ok(three.noFill===false&&three.after===''&&three.need===1&&three.rows===0,
   '★★★どのジャンルにも当てはまらない行は入れずに「原産国なし」で止める');
ok(three.gf===true&&three.gOrigin==='China'&&three.gDef,
   '★★フィギュアの行は「フィギュア・ホビー」の既定（China）を入れる');

console.log('=== ④ 写真を取り込んだら、その場で「写真あり」===');
const four=await p.evaluate(async()=>{
  /* 一覧（候補）に1行だけある状態を作る。 */
  mwRows=[{ jan:'4528272010290', sha:'キーズファクトリー', name:'カードポッド',
            wholesale:1200, stock:10, ship_days:0, pics_ok:0, pics_n:0,
            pics_long:0, pics_main:'' }];
  mwAmzRows=[]; mwBuyRows=[];
  var before=mwRows[0].pics_ok;
  var why=mwPushWhy?mwPushWhy(mwRows[0]):'';
  /* MW から画像を取る口と、画像サーバーへの上げを差し替える。 */
  var posts=[];
  var oldPost=mwPost, oldUp=csvPicUpload;
  mwPost=function(path,body){
    posts.push(path);
    if(path==='/mw/img'&&body&&body.ids)
      return Promise.resolve({ ok:true, n:2, good:2, bad:0, rows:[
        { pos:0, ok:true, long:1200, b64:'AAAA', ct:'image/jpeg' },
        { pos:1, ok:true, long:1100, b64:'AAAA', ct:'image/jpeg' }] });
    return Promise.resolve({ ok:true, n:2 });
  };
  csvPicUpload=function(){
    return Promise.resolve({ url:'https://img.test/i/20261118/'
      +'11111111-2222-3333-4444-555555555555.jpg' });
  };
  $('csvImgBase').value='https://img.test'; $('csvImgToken').value='T';
  var out={ innerHTML:'' };
  var z=await mwImgTake('4528272010290',['10970132','10970140'],out);
  mwPost=oldPost; csvPicUpload=oldUp;
  return { before:before, why:why, after:mwRows[0].pics_ok,
           n:mwRows[0].pics_n, main:mwRows[0].pics_main,
           long:mwRows[0].pics_long,
           why2:mwPushWhy?mwPushWhy(mwRows[0]):'',
           saved:z?z.saved.length:0, posts:posts.join('／'),
           /* 8.71 一覧を描き直したあとは、結果は**描き直した枠**に出る。 */
           txt:((document.getElementById('mwImgOut_4528272010290')||{}).innerHTML
                ||out.innerHTML) };
});
ok(four.before===0&&/写真なし/.test(four.why),
   '★取り込む前は「写真なし」（出品リストに入れられない）');
ok(four.saved===2&&/\/mw\/img/.test(four.posts),'★取り込みは今までどおり');
ok(four.after===2&&four.n===2,
   '★★★取り込んだその場で写真の枚数が入る（'+four.after+'枚）');
ok(!/写真なし/.test(four.why2),
   '★★★「写真なし」が消えて、出品リストに入れられるようになる：'+(four.why2||'（入れられる）'));
ok(/11111111-2222/.test(four.main)&&four.long===1200,
   '★★メインの写真と長辺もその場で入る');
ok(/候補一覧を取り直さなくても/.test(four.txt),
   '★取り込みの結果にもそう出す');

await T.done();
})();
