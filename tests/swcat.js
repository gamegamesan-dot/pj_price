/* 出品CSVタブ：SW版/Switch版の自動確定と、手でカテゴリを選んだ行の流れ */
const { harness, ROOT } = require('./lib');
const T = harness('出品CSVタブ：SW版の自動確定と手動カテゴリの流れ');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.click('#tabD');

console.log('=== 商品名から機種を読む（csvGameHint）===');
const hint=await p.evaluate(()=>{
  const t=['ゼルダの伝説 ティアーズ オブ ザ キングダム SW版',
    'スプラトゥーン3 Switch版','ポケットモンスター スカーレット［Switch］',
    'マリオカート8 デラックス -Switch','ドンキーコング バナンザ Switch2版',
    'マリオカート ワールド Switch 2','ニンテンドースイッチ2 ソフト',
    'ゼルダの伝説 ニンテンドースイッチ','SW スター・ウォーズ ブラックシリーズ フィギュア',
    'ねんどろいど 初音ミク（Switch風スタンド付）',
    'figma スター・ウォーズ SW ストームトルーパー',
    'Switch 2本セット まとめ売り','S.H.Figuarts スイッチ戦士'];
  const o={};
  t.forEach(x=>o[x]={hint:csvGameHint(x),fig:csvLooksFig(x),
    spec:csvGameSpec(csvGameHint(x))});
  return o;
});
Object.keys(hint).forEach(k=>console.log('   '+JSON.stringify(hint[k])+'  ←'+k));
ok(hint['ゼルダの伝説 ティアーズ オブ ザ キングダム SW版'].hint==='switch','★「SW版」→ Switch');
ok(hint['スプラトゥーン3 Switch版'].hint==='switch','★「Switch版」→ Switch');
ok(hint['ポケットモンスター スカーレット［Switch］'].hint==='switch','★「［Switch］」→ Switch');
ok(hint['マリオカート8 デラックス -Switch'].hint==='switch','★「-Switch」→ Switch');
ok(hint['ドンキーコング バナンザ Switch2版'].hint==='switch2','★「Switch2版」→ Switch 2');
ok(hint['マリオカート ワールド Switch 2'].hint==='switch2','★「Switch 2」→ Switch 2');
ok(hint['ニンテンドースイッチ2 ソフト'].hint==='switch2','★「スイッチ2」→ Switch 2');
ok(hint['ゼルダの伝説 ニンテンドースイッチ'].hint==='switch','「スイッチ」→ Switch');
ok(hint['ゼルダの伝説 ティアーズ オブ ザ キングダム SW版'].spec==='Nintendo Switch'
   &&hint['ドンキーコング バナンザ Switch2版'].spec==='Nintendo Switch 2',
   '★Item Specifics の Platform も機種どおり');
ok(hint['SW スター・ウォーズ ブラックシリーズ フィギュア'].hint==='',
   '★「SW」だけ（スター・ウォーズ）は機種として読まない');
ok(hint['figma スター・ウォーズ SW ストームトルーパー'].fig===true,
   '★figma の行はフィギュアの手がかりがある');
ok(hint['ねんどろいど 初音ミク（Switch風スタンド付）'].fig===true,
   '★ねんどろいどの行もフィギュア（Switch が入っていても）');
ok(hint['Switch 2本セット まとめ売り'].hint==='switch',
   '★「2本」は Switch 2 にしない（Switch として読む）');

console.log('\n=== 取り込み（hobby の接頭辞でも SW版 はゲーム）===');
const imp=await p.evaluate(()=>{
  const head='SKU,JAN,ASIN,タイトル,重量,仕入原価,個数,出品コンディション,粗利,ランク,出品種別';
  const rows=[
    'hobby-20260101-UG-B0SW000001-1200,4901111111111,B0SW000001,ゼルダの伝説 SW版,200,1200,1,良い,3000,5000,FBA',
    'toy-20260101-UG-B0SW000002-1300,4901222222222,B0SW000002,スプラトゥーン3 Switch版,200,1300,1,非常に良い,3000,5000,FBA',
    'hobby-20260101-UG-B0SW000003-1400,4901333333333,B0SW000003,ドンキーコング バナンザ Switch2版,200,1400,1,良い,3000,5000,FBA',
    'hobby-20260101-UA-B0SW000004-900,4901444444444,B0SW000004,星のカービィ SW版,200,900,1,可,3000,5000,FBA',
    'hobby-20260101-UG-B0FIG00001-2000,4901555555555,B0FIG00001,ねんどろいど 初音ミク Switch風スタンド,300,2000,1,良い,3000,5000,FBA',
    'hobby-20260101-UG-B0FIG00002-2500,4901666666666,B0FIG00002,SW スター・ウォーズ ブラックシリーズ フィギュア,300,2500,1,良い,3000,5000,FBA',
    'game-20260101-UG-B0GAME0001-1500,4901777777777,B0GAME0001,スーパーマリオRPG,200,1500,1,良い,3000,5000,FBA'
  ];
  csvList=[]; csvPick={}; csvSaveList();
  const res=csvImport([head].concat(rows).join('\n'));
  return { res:res, rows:csvList.map(r=>({ja:r.titleJa,cat:r.cat,fixed:!!r.catFixed,
    done:!!r.catDone,manual:!!r.catManual,plat:(r.specs||{}).platform,
    cond:r.condId,cart:!!r.cartOnly,issues:csvIssues(r).join('／')})) };
});
imp.rows.forEach(r=>console.log('   '+JSON.stringify(r)));
const byJa=(w)=>imp.rows.find(x=>x.ja.indexOf(w)>=0);
ok(byJa('ゼルダ').cat==='139973'&&byJa('ゼルダ').plat==='Nintendo Switch',
   '★「SW版」の行はゲーム（139973）＋Nintendo Switch');
ok(byJa('ゼルダ').fixed===true&&byJa('ゼルダ').issues.indexOf('カテゴリ未振分')<0,
   '★「カテゴリ未振分」にならない');
ok(byJa('スプラトゥーン').cat==='139973'&&byJa('スプラトゥーン').plat==='Nintendo Switch',
   '★「Switch版」の行も同じ（toy の接頭辞でも）');
ok(byJa('ドンキーコング').plat==='Nintendo Switch 2',
   '★「Switch2版」は Switch 2（Switch に落ちない）');
ok(byJa('スプラトゥーン').cond===4000&&byJa('ゼルダ').cond===5000,
   '★状態もゲームの表で入る（非常に良い→4000・良い→5000）');
ok(byJa('カービィ').cond===6000&&byJa('カービィ').cart===true,
   '★「可」のゲームはカートリッジのみ（Acceptable 6000）になる');
ok(byJa('ねんどろいど').cat==='261055'||byJa('ねんどろいど').cat==='261068',
   '★ねんどろいどの行はゲームにしない');
ok(byJa('ねんどろいど').plat===''&&byJa('スター・ウォーズ').cat!=='139973',
   '★スター・ウォーズ（SW）のフィギュアもゲームにしない');
ok(byJa('スーパーマリオRPG').cat==='139973','game の接頭辞はこれまでどおりゲーム');

console.log('\n=== 保存済みの未振分の行も直す（開き直し）===');
const fixed=await p.evaluate(()=>{
  const row=(id,ja,extra)=>Object.assign({id:id,src:'sedori',
    sku:'hobby-20260101-UG-B07571RH4P-1200',asin:'B07571RH4P',jan:'4901234567890',
    titleJa:ja,titleEn:'',cat:'261055',condId:3000,condSrc:'良い',cost:1200,qty:1,
    weight:300,pics:[],descHtml:'',specs:{},zeroAct:'hold',fba:true,oneOff:false,
    itemId:'',titleStatus:'',titleCands:[],titleNote:'',titleManual:false},extra||{});
  csvList=[
    row('u1','メトロイドプライム4 SW版'),                       // 未振分 → 直す
    row('u2','ねんどろいど ミク Switch風',{catDone:true,cat:'261055'}), // 振り分け済 → 触らない
    row('u3','スプラトゥーン Switch版',{catDone:true,catManual:true,cat:'261068'}) // 人が選んだ → 触らない
  ];
  csvSaveList();
  csvLoad();                                 // 開き直しと同じ道を通す
  return csvList.map(r=>({id:r.id,cat:r.cat,plat:(r.specs||{}).platform,
    cond:r.condId,fixed:!!r.catFixed}));
});
fixed.forEach(r=>console.log('   '+JSON.stringify(r)));
ok(fixed[0].cat==='139973'&&fixed[0].plat==='Nintendo Switch'&&fixed[0].cond===5000,
   '★保存済みの未振分の行も、開き直したときにゲームに確定する');
ok(fixed[1].cat==='261055','★自動で振り分けが済んでいる行は変えない');
ok(fixed[2].cat==='261068','★人が選んだ行は変えない');

console.log('\n=== 手でカテゴリを選んだ行の流れ ===');
const flow=await p.evaluate(()=>{
  $('csvCatCustom').value='183454,ゲーム周辺機器,fig'; csvAddCatOpts();
  const row=(id,extra)=>Object.assign({id:id,src:'sedori',
    sku:'hobby-20260101-UG-B07571RH4P-1200',asin:'B07571RH4P',jan:'4901234567890',
    titleJa:'商品'+id,titleEn:'',cat:'261055',condId:3000,condSrc:'良い',cost:1200,
    qty:1,weight:300,pics:[{url:'u'}],descHtml:'',specs:{origin:'Japan'},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',titleStatus:'',titleCands:[],
    titleNote:'',titleManual:false},extra||{});
  csvList=[
    row('n1',{catDone:true,cat:'261068'}),            // ふつうの行（自動で振り分け済み）
    row('m1'),                                        // 未振分 → これから選ぶ
    row('m2',{catDone:true,catManual:true,cat:'183454'}),   // 登録カテゴリ
    row('m3',{catDone:true,catManual:true,cat:'999999'})    // 登録が消えたカテゴリ
  ];
  csvPick={}; csvSaveList(); csvRender();
  // 未振分の行で、一覧のプルダウンからゲームを選ぶ
  const sel=document.querySelector('#csvList select[data-cat="m1"]');
  const opts=Array.from(sel.options).map(o=>o.value);
  sel.value='139973'; sel.dispatchEvent(new Event('change',{bubbles:true}));
  const r1=csvRowById('m1');
  const info=(r)=>({cat:r.cat,kind:csvTitleKind(r),sendable:csvTitleSendable(r),
    titleBox:csvTitleBox(r).length>0,regen:/data-regen/.test(csvTitleBox(r)),
    len80:/\/ 80/.test(csvTitleBox(r)),
    fields:/data-figk|data-plat/.test(csvTitleBox(r)),
    issues:csvIssues(r).join('／')});
  return { opts:opts, m1:info(r1), plat:(r1.specs||{}).platform, cond:r1.condId,
    manual:!!r1.catManual, n1:info(csvRowById('n1')), m2:info(csvRowById('m2')),
    m3:info(csvRowById('m3')),
    genAll:csvList.filter(csvTitleSendable).filter(r=>
      !r.titleManual&&(!String(r.titleEn||'').trim()||r.titleStatus==='error')).map(r=>r.id) };
});
console.log('   プルダウンの選択肢: '+JSON.stringify(flow.opts));
ok(flow.opts.indexOf('139973')>=0,'★一覧のプルダウンでゲームも選べる（出品文タブに行かずに済む）');
console.log('   m1（ゲームを選んだ行）: '+JSON.stringify(flow.m1)
  +' plat='+flow.plat+' cond='+flow.cond);
ok(flow.m1.cat==='139973'&&flow.m1.kind==='game','★選んだ時点でゲームの扱いになる');
ok(flow.plat==='',"機種は商品名に無いので空（行で選ぶ）");
ok(flow.cond===5000,'★状態もゲームの表で引き直す（良い→5000）');
ok(flow.manual===true,'人が選んだ印が付く');
ok(flow.m1.issues.indexOf('カテゴリ未振分')<0,'★未振分の指摘が消える');
console.log('   n1（ふつうの行）: '+JSON.stringify(flow.n1));
console.log('   m2（登録カテゴリ）: '+JSON.stringify(flow.m2));
console.log('   m3（登録が消えたID）: '+JSON.stringify(flow.m3));
ok(flow.m2.kind==='fig'&&flow.m2.sendable&&flow.m2.titleBox&&flow.m2.regen
   &&flow.m2.len80&&flow.m2.fields,'★登録カテゴリの行はふつうの行と同じ（英題欄・再生成・80文字・各欄）');
ok(flow.m3.kind==='fig'&&flow.m3.sendable&&flow.m3.titleBox&&flow.m3.regen
   &&flow.m3.len80&&flow.m3.fields,'★登録が消えたIDの行も同じ（前は英題欄ごと消えていた）');
console.log('   一括作成の対象: '+JSON.stringify(flow.genAll));
ok(['n1','m1','m2','m3'].every(id=>flow.genAll.indexOf(id)>=0),
   '★4行すべてが「英題と出品文を一括作成」の対象');

console.log('\n=== 出品文を作る → 書き戻す ===');
const wb=await p.evaluate(()=>{
  const out={};
  ['n1','m2','m3'].forEach(id=>{
    csvEditOpen(id);
    const before={sel:$('addCsvCat').value,
      opts:Array.from($('addCsvCat').options).map(o=>o.value)};
    csvEditWrite();                                  // 英題は触らずに書き戻す
    const r=csvRowById(id);
    out[id]={ before:before, cat:r.cat, desc:(r.descHtml||'').length,
      manual:!!r.titleManual, sendable:csvTitleSendable(r) };
  });
  // 英題を自分で書き換えた行は「手で直した行」にする
  csvEditOpen('n1');
  $('title').value='My Own Title';
  $('title').dispatchEvent(new Event('input'));
  csvEditWrite();
  out.edited={ titleEn:csvRowById('n1').titleEn, manual:!!csvRowById('n1').titleManual };
  out.genAll=csvList.filter(csvTitleSendable).filter(r=>
    !r.titleManual&&(!String(r.titleEn||'').trim()||r.titleStatus==='error')).map(r=>r.id);
  return out;
});
['n1','m2','m3'].forEach(id=>console.log('   '+id+': '+JSON.stringify(wb[id])));
ok(wb.m3.cat==='999999','★登録が消えたIDでもカテゴリが消えない（前は空になっていた）');
ok(wb.m2.cat==='183454','登録カテゴリはそのまま');
ok(wb.n1.desc>0&&wb.m2.desc>0&&wb.m3.desc>0,'★3行すべて出品文が一覧に書き戻される');
ok(!wb.n1.manual&&!wb.m2.manual&&!wb.m3.manual,
   '★カテゴリだけ選んで書き戻した行に「手で直した」印は付かない');
console.log('   英題を書き換えた行: '+JSON.stringify(wb.edited));
ok(wb.edited.titleEn==='My Own Title'&&wb.edited.manual===true,
   '★英題を自分で書き換えた行だけ「手で直した行」にする');
console.log('   書き戻し後の一括作成の対象: '+JSON.stringify(wb.genAll));
ok(wb.genAll.indexOf('m2')>=0&&wb.genAll.indexOf('m3')>=0
   &&wb.genAll.indexOf('n1')<0,
   '★書き戻しただけの行は対象のまま・英題を書き換えた行だけ外れる');

console.log('\n=== ゲームに確定した行がゲームのCSVで出る ===');
const exp=await p.evaluate(()=>{
  $('csvShipProfile').value='W1000'; $('csvShipProfileRe').value='W2000';
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P'; $('csvLocation').value='Tokyo';
  $('fx').value='160';
  csvList=[{id:'g1',src:'sedori',sku:'hobby-20260101-UG-B0SW000001-1200',
    asin:'B0SW000001',jan:'4901111111111',titleJa:'ゼルダの伝説 SW版',
    titleEn:'Used Zelda Tears of the Kingdom Nintendo Switch Japan Import',
    cat:'261055',condId:3000,condSrc:'良い',cost:1200,qty:1,weight:300,
    pics:[{url:'https://img/1.jpg'}],descHtml:'<p>d</p>',specs:{},zeroAct:'hold',
    fba:true,oneOff:false,itemId:'',titleStatus:'',titleCands:[],titleNote:'',
    titleManual:false}];
  csvGameFix(csvList[0]);
  const r=csvList[0];
  r.specs.gameName='Zelda Tears of the Kingdom';
  csvPick={}; csvSaveList(); csvRender();
  const sp=csvExportSplit(null);
  const txt=csvBuild(r.cat,sp.rows);
  const ln=String(txt).split(/\r?\n/);
  return { cat:r.cat, cond:r.condId, plat:r.specs.platform, tpl:csvCatTpl(r.cat),
    rows:sp.rows.map(x=>x.id), bad:sp.bad.map(x=>x.r.id+':'+x.why),
    head:ln[1]||'', line:ln[2]||'' };
});
console.log('   '+JSON.stringify({cat:exp.cat,cond:exp.cond,plat:exp.plat,
  tpl:exp.tpl,rows:exp.rows,bad:exp.bad}));
console.log('   '+exp.line.slice(0,120));
ok(exp.rows.length===1&&!exp.bad.length,'★不備なく書き出しに進む');
ok(exp.tpl==='139973'&&/C:Game Name/.test(exp.head),
   '★ゲームのテンプレート（139973）の列で書き出す');
ok(/C:Platform/.test(exp.head)&&/Nintendo Switch/.test(exp.line),
   '★Platform にも Nintendo Switch が入る');
ok(/,139973,/.test(exp.line),'★*Category はゲーム');

await T.done();
})();
