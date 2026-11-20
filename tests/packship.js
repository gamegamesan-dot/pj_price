/* 画面：出品文の「Shipping」の文を商品の大きさで出し分ける（8.79・カジの依頼）
   いままでは全部「段ボールに入れて送る」の文だった。実際は、通常版のゲームソフト
   などクリックポストに入る大きさの商品は、緩衝材＋封筒で送っている。
   ・行ごとに入れ物（封筒／段ボール）を決める（手 → 箱なし → 大きさ → 種類）
   ・eBay の出品文と海外向け Shopify の説明に、同じ文を出す
   ・出品済みの行は Revise 用 CSV（Action・ItemID・Description だけ）で直す
     ＝ PicURL を入れない（手で差し替えた写真が戻らない） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：発送の文を大きさで出し分ける（8.79）');
const ok = T.ok;
const ENV='Tracking is included on every parcel. Each item is wrapped in protective cushioning and shipped in a padded envelope.';
const BOX='Tracking is included on every parcel, and each item is cushioned and boxed inside a separate shipping carton.';

(async()=>{
const p=await T.open();
let dlg=[];
p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
await p.click('#tabD');
await p.evaluate(()=>{
  ebCats=[
    {code:'139973',name:'Video Games',ja:'ゲーム',path:'Video Games & Consoles > Video Games',
     need:[],opt:[],tpl:'139973',seed:true},
    {code:'261055',name:'Figures',ja:'',path:'Toys & Hobbies > Action Figures',
     need:[],opt:[],tpl:'261055',seed:true},
    {code:'262324',name:'Figures',ja:'プラモデル',path:'Toys & Hobbies > Models & Kits > Figures',
     need:[],opt:['Brand'],tpl:'261055',seed:false}
  ];
  csvAddCatOpts();
  $('fx').value='150'; $('csvRetProfile').value='R'; $('csvPayProfile').value='P';
  $('csvLocation').value='Tokyo'; $('csvShipProfile').value='W1000';
  $('syncApi').value=''; $('syncKey').value='';
  mwRows=[]; mwAmzRows=[]; mwBuyRows=[];
  window.mk=function(id,cat,x){
    return Object.assign({ id:id, src:'mw', sku:'', jan:'490237055046'+id,
      asin:'B0PACK000'+id, titleJa:'テスト'+id, titleEn:'Test Item '+id+' Japan Import',
      cat:cat, catFixed:true, catDone:true, condId:1000, cost:1200, qty:1, weight:200,
      pics:[{url:'https://img.test/i/20261118/'+id+'aaaaaaa-2222-3333-4444-555555555555.jpg'}],
      descHtml:'', specs:{ origin:'Japan', platform:'Nintendo Switch', gameName:'Test',
                           brand:'Bandai' },
      buySource:'mw', dropship:true, mwKishu:'NS', zeroAct:'hold', fba:false,
      oneOff:false, itemId:'', sold:'', price:30, osOn:true, osAt:'',
      titleStatus:'', titleCands:[], titleNote:'', titleManual:false },x||{});
  };
});
await openCsvBoxes(p);

console.log('=== ① 入れ物の決め方 ===');
const one=await p.evaluate(()=>{
  var k=function(r){ var p=csvPackOf(r); return p.kind+(p.hand?'*':''); };
  var o={};
  // 大きさが分かる行
  o.thin=k(mk('1','139973',{ dimL:19, dimW:13.5, dimH:1.4, dimG:110 }));
  o.edge=k(mk('1','261055',{ dimL:34, dimW:25, dimH:3, dimG:1000 }));
  o.thick=k(mk('1','139973',{ dimL:19, dimW:13.5, dimH:3.1, dimG:110 }));
  o.wide=k(mk('1','139973',{ dimL:34.1, dimW:20, dimH:2, dimG:110 }));
  o.wide2=k(mk('1','139973',{ dimL:30, dimW:25.1, dimH:2, dimG:110 }));
  o.heavy=k(mk('1','139973',{ dimL:19, dimW:13.5, dimH:1.4, dimG:1001 }));
  o.order=k(mk('1','139973',{ dimL:1.4, dimW:19, dimH:13.5, dimG:110 }));  // 並びが違っても同じ
  // 大きさが分からない行
  o.game=k(mk('2','139973'));
  o.limited=k(mk('2','139973',{ titleJa:'ソフト名 限定版' }));
  o.fig=k(mk('3','261055',{ mwKishu:'b2cchara_figure' }));
  o.model=k(mk('4','262324',{ mwKishu:'plasticmodel' }));
  // 箱なしで出す行
  o.cart=k(mk('5','139973',{ cartOnly:true, dimL:30, dimW:30, dimH:10 }));
  o.loose=k(mk('5','261055',{ looseOnly:true }));
  // MW の一覧（Amazon の採寸）から引く
  mwRows=[{ jan:'4902370550466', size_long:19, size_wid:13.5, size_hei:1.4, size_g:110 },
          { jan:'4902370550467', size_long:30, size_wid:20, size_hei:12, size_g:800 }];
  o.fromList=k(mk('6','261055'))+'/'+k(mk('7','139973'));
  o.why=csvPackOf(mk('6','261055')).why;
  mwRows=[];
  // 出品リストに入れる行に大きさが入る
  var row=mwListRow({ jan:'4902370550461', sha:'MC02', kishu:'NS', name:'ソフト',
    wholesale:3000, stock:5, ship_days:0, size_long:19, size_wid:13.5, size_hei:1.4,
    size_g:110 },[],1);
  o.rowDim=[row.dimL,row.dimW,row.dimH,row.dimG].join('/');
  return o;
});
ok(one.thin==='env','★★★34×25cm・厚さ3cm・1kg 以内は封筒（通常版のゲームソフト）');
ok(one.edge==='env','★★ちょうど 34×25×3cm・1kg も封筒');
ok(one.thick==='box'&&one.wide==='box'&&one.wide2==='box'&&one.heavy==='box',
   '★★★厚さ・長辺・短辺・重さのどれかが超えたら段ボール');
ok(one.order==='env','★3辺の並びが違っても同じ結果');
ok(one.game==='env','★★★大きさが分からないゲームソフト（通常版）は封筒とみなす');
ok(one.limited==='box','★★大きさが分からない限定版は段ボール');
ok(one.fig==='box'&&one.model==='box','★★★フィギュア・プラモデルは段ボール');
ok(one.cart==='env'&&one.loose==='env','★★箱なしで出す行（カートリッジのみ・フィギュアのみ）は封筒');
ok(one.fromList==='env/box'&&/大きさから（19×13\.5×1\.4cm・110g）/.test(one.why),
   '★★行に大きさが無ければ MW の一覧（Amazon の採寸）から引く：'+one.why);
ok(one.rowDim==='19/13.5/1.4/110','★★出品リストに入れる行に大きさを持たせる');

console.log('=== ② 出品文（eBay）と手での切り替え ===');
const two=await p.evaluate(()=>{
  csvList=[ mk('1','139973'),
            mk('2','261055',{ mwKishu:'b2cchara_figure',
                              specs:{ origin:'China', brand:'Banpresto', franchise:'One Piece',
                                      character:'Luffy' } }),
            mk('3','262324',{ mwKishu:'plasticmodel',
                              specs:{ origin:'Japan', brand:'Bandai Spirits' } }) ];
  csvList.forEach(function(r){ r.descHtml=csvDescFor(r); });
  csvPick={}; csvSaveList(); csvRender();
  var o={ d1:csvList[0].descHtml, d2:csvList[1].descHtml, d3:csvList[2].descHtml };
  var b=function(id){ var x=document.querySelector('#csvList [data-pack="'+id+'"]');
    return x?x.textContent:''; };
  o.btn1=b('1'); o.btn2=b('2');
  // 手で切り替える（ゲームを段ボールに）
  document.querySelector('#csvList [data-pack="1"]').click();
  var r1=csvRowById('1');
  o.hand=r1.packHand; o.btn1b=b('1'); o.d1b=r1.descHtml;
  o.row=csvRowFor(r1)['*Description'];
  // もう一度押すと自動（封筒）に戻る
  document.querySelector('#csvList [data-pack="1"]').click();
  r1=csvRowById('1');
  o.hand2=r1.packHand; o.btn1c=b('1'); o.d1c=r1.descHtml;
  // フィギュアを手で封筒に
  document.querySelector('#csvList [data-pack="2"]').click();
  o.hand3=csvRowById('2').packHand; o.d2b=csvRowById('2').descHtml;
  o.plain=(function(){ $('bEnv').checked=true; var t=descPlain(); $('bEnv').checked=false;
    return t; })();
  return o;
});
ok(two.d1.includes(ENV)&&!two.d1.includes('shipping carton'),
   '★★★通常版のゲームソフトの出品文は封筒の文');
ok(two.d2.includes('carton')||/outer box|outer carton/.test(two.d2),
   '★★★フィギュアの出品文は段ボールの文（今までどおり）');
ok(!two.d2.includes('padded envelope')&&!two.d3.includes('padded envelope'),
   '★★★フィギュア・プラモデルの出品文に封筒の文は入らない');
ok(/発送：封筒（クリックポスト）/.test(two.btn1)&&/発送：段ボール/.test(two.btn2),
   '★★★カードに「発送：封筒（クリックポスト）／段ボール」が出る');
ok(two.hand==='box'&&/段ボール（手）/.test(two.btn1b),'★★押すと切り替わる（手で変えた印）');
ok(two.d1b.includes(BOX)&&!two.d1b.includes('padded envelope')&&two.row.includes(BOX),
   '★★★手で切り替えた値が出品文と書き出しに反映される');
ok(two.hand2===''&&/封筒/.test(two.btn1c)&&!/（手）/.test(two.btn1c)&&two.d1c.includes(ENV),
   '★★もう一度押すと自動の判定に戻る');
ok(two.hand3==='env'&&two.d2b.includes(ENV),'★★段ボールの行を手で封筒にもできる');
ok(two.plain.includes(ENV),'★アプリ用の文字だけの版も同じ文');

console.log('=== ③ 海外向け Shopify の説明も同じ文 ===');
const three=await p.evaluate(()=>{
  var g=csvOsItem(csvRowById('1')), m=csvOsItem(csvRowById('3'));
  return { g:PJ_OSSCSV.rowOf(g,osOpt())['Body (HTML)'],
           m:PJ_OSSCSV.rowOf(m,osOpt())['Body (HTML)'] };
});
ok(three.g.includes(ENV),'★★★ゲームソフトは封筒の文（eBay と同じ文）');
ok(three.m.includes(BOX)&&!three.m.includes('padded envelope'),
   '★★★プラモデルは段ボールの文');
ok(!/ebay/i.test(three.g+three.m)&&/shown at checkout/.test(three.g),
   '★★eBay の文は入らない・配送の案内は残る');

console.log('=== ④ 出品済みの行：Revise 用 CSV ===');
const four=await p.evaluate(()=>{
  var OLD=V_PACK[2];
  var wrap=function(t){ return '<div><h1><!--TITLE-->x<!--/TITLE--></h1><ul><li>'+t
    +'</li></ul></div>'; };
  csvList=[
    /* 手で写真を差し替えた出品。出品文は今までの段ボールの文。 */
    mk('1','139973',{ itemId:'880134619879', descHtml:wrap(OLD), titleEn:'x' }),
    mk('2','139973',{ itemId:'168874294220', descHtml:wrap(V_PACK[0]), titleEn:'x' }),
    /* フィギュア（段ボールのまま＝食い違いなし）。 */
    mk('3','261055',{ itemId:'333333333333', descHtml:wrap(OLD), titleEn:'x',
                      mwKishu:'b2cchara_figure' }),
    /* まだ出品していない行。 */
    mk('4','139973',{ itemId:'', descHtml:wrap(OLD), titleEn:'x' }),
    /* 発送の文が無い出品文（触らない）。 */
    mk('5','139973',{ itemId:'555555555555', descHtml:'<div><p>custom</p></div>',
                      titleEn:'x' })
  ];
  csvPick={}; csvSaveList(); csvRender();
  var o={ has:!!$('csvPackFind')&&!!$('csvPackRun'),
          adm:$('csvPackBox').className.indexOf('admcfg')>=0 };
  o.off=csvList.map(function(r){ return csvPackOff(r)?1:0; }).join('');
  $('csvPackFind').click();
  o.note1=$('csvPackNote').textContent;
  o.filter=CSV_FILTERS.filter(function(x){ return x.v==='packoff'; })
    .map(function(x){ return csvList.filter(x.f).map(function(r){ return r.id; }).join(','); })[0];
  window.__dl=[];
  var oldDl=csvDownload;
  csvDownload=function(name,text){ window.__dl.push({ name:name, text:text }); return true; };
  var picsBefore=JSON.stringify(csvRowById('1').pics);
  $('csvPackRun').click();
  csvDownload=oldDl;
  var f=window.__dl[0]||{ name:'', text:'' };
  var rows=PJ_SHOPCSV.splitCsv(f.text.split('\r\n').slice(1).join('\n'));
  o.name=f.name; o.info=f.text.split('\r\n')[0];
  o.head=(rows[0]||[]).join(',');
  o.n=rows.filter(function(x){ return x.length>1; }).length-1;
  o.r1=rows[1]||[]; o.r2=rows[2]||[];
  o.hasPic=/PicURL/i.test(f.text)||/img\.test/.test(f.text);
  o.hasPrice=/StartPrice|Quantity|Title/.test(o.head);
  o.picsSame=(JSON.stringify(csvRowById('1').pics)===picsBefore);
  o.after=csvList.map(function(r){ return csvPackOff(r)?1:0; }).join('');
  o.d5=csvRowById('5').descHtml;
  o.note2=$('csvPackNote').textContent;
  return o;
});
ok(four.has&&four.adm,'★ボタンがある（管理者だけに出す）');
ok(four.off==='11000',
   '★★★食い違っているのは「出品済みのゲームソフトで段ボールの文」の2件だけ（'+four.off+'）');
ok(/食い違っている出品 2件/.test(four.note1)&&/封筒の文に直す 2件/.test(four.note1),
   '★★件数を出す：'+four.note1.slice(0,70));
ok(four.filter==='1,2','★★絞り込み「発送の文が食い違う出品」で選べる');
ok(dlg.some((m)=>/ItemID と Description だけ/.test(m)&&/PicURL の列は入れません/.test(m)),
   '★★書き出す前に確認を出す（写真は変えないと書く）');
ok(/^ebay-desc-revise-\d{8}-2\.csv$/.test(four.name)&&/^Info,/.test(four.info),
   '★ファイル名と File Exchange の形：'+four.name);
ok(/^\*Action\([^)]*\),ItemID,\*Description$/.test(four.head),
   '★★★列は Action・ItemID・Description だけ：'+four.head.replace(/\(.*\)/,'(…)'));
ok(four.n===2&&four.r1[0]==='Revise'&&four.r1[1]==='880134619879'
   &&four.r2[1]==='168874294220','★★★ItemID 880134619879・168874294220 の2件');
ok(four.r1[2].includes(ENV)&&!four.r1[2].includes('shipping carton')
   &&four.r2[2].includes(ENV)&&!four.r2[2].includes('outer box'),
   '★★★Description は封筒の文に直っている（前の3通りの段ボールの文のどれでも）');
ok(four.hasPic===false,'★★★Revise 用 CSV に PicURL が含まれない（写真の URL も入らない）');
ok(four.hasPrice===false,'★★★値段・数量・題名の列も無い');
ok(four.picsSame,'★★行の写真の記録にも触らない');
ok(four.after==='00000','★★書き出したあとは食い違いが無くなる');
ok(four.d5==='<div><p>custom</p></div>','★★発送の文が無い出品文は触らない');
ok(/写真・値段・数量はそのまま/.test(four.note2),'★結果に「写真はそのまま」と出す');

console.log('=== ⑤ 出品済みの行は、控えの出品文を黙って書き換えない ===');
const five=await p.evaluate(()=>{
  var OLD=V_PACK[2];
  var d0='<div><ul><li>'+OLD+'</li></ul></div>';
  csvList=[ mk('1','139973',{ itemId:'880134619879', descHtml:d0, titleEn:'x' }) ];
  csvPick={}; csvSaveList(); csvRender();
  var o={};
  /* 一覧を描く・書き出しの行を作る、だけでは変わらない。 */
  csvRowFor(csvRowById('1'));
  o.same1=(csvRowById('1').descHtml===d0);
  o.off1=csvPackOff(csvRowById('1'));
  o.btn=(document.querySelector('#csvList [data-pack="1"]')||{}).textContent||'';
  /* 手で段ボールに切り替える → 食い違いが無くなる（出品文は段ボールのまま）。 */
  document.querySelector('#csvList [data-pack="1"]').click();
  o.same2=(csvRowById('1').descHtml===d0);
  o.off2=csvPackOff(csvRowById('1'));
  return o;
});
ok(five.same1&&five.off1===true,
   '★★★一覧を描いても、出品済みの行の出品文は書き換えない（食い違いが残る）');
ok(/出品文と違う/.test(five.btn),'★★カードのボタンに「出品文と違う」と出す');
ok(five.same2&&five.off2===false,
   '★★手で段ボールにすると食い違いが消える（出品文は書き換えない）');

await T.done();
})();
