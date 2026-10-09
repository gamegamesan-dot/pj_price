/* 出品CSVタブ：対象外機種でも英題を作れるようにする／Xbox 360／機種ごとの注記（6.28）
   例：Kanon カノン（ドリームキャスト）は「対象外機種（手入力）」とだけ出て、
   英題の入力欄すら出ずに先へ進めなかった。 */
const { harness } = require('./lib');
const T = harness('出品CSVタブ：機種の扱いと注記');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.click('#tabD');

console.log('=== 商品名から読む機種と eBay の Platform ===');
const plats=await p.evaluate(()=>{
  const o={};
  [['Kanon カノン ドリームキャスト','Sega Dreamcast'],
   ['グランディア セガサターン','Sega Saturn'],
   ['テイルズ オブ ヴェスペリア Xbox 360','Microsoft Xbox 360'],
   ['Halo 3 Xbox360','Microsoft Xbox 360'],
   ['Forza Horizon Xbox One','Microsoft Xbox One'],
   ['ファイナルファンタジーX PS2','Sony PlayStation 2'],
   ['バイオハザード PS1','Sony PlayStation'],
   ['モンスターハンター PSP','Sony PSP'],
   ['シェンムー PS Vita','Sony PlayStation Vita'],
   ['はじめの一歩 Wii','Nintendo Wii'],
   ['ゼノブレイド Wii U','Nintendo Wii U'],
   ['ピクミン ゲームキューブ','Nintendo GameCube']]
    .forEach(([ja,want])=>{ o[ja]={got:csvPlatformFrom(ja),want:want}; });
  return o;
});
Object.keys(plats).forEach(k=>console.log('   '+plats[k].got+'  ←'+k));
Object.keys(plats).forEach(k=>ok(plats[k].got===plats[k].want,
  '★'+k.split(' ').pop()+' → '+plats[k].want));

console.log('\n=== 対象外だった機種の行でも英題を作れる ===');
const setup=async()=>await p.evaluate(()=>{
  $('csvSort').value='add';
  const row=(id,asin,ja,extra)=>Object.assign({id:id,src:'sedori',
    sku:'game-20260101-UG-'+asin+'-1200',asin:asin,jan:'4901'+id,titleJa:ja,titleEn:'',
    cat:'139973',catFixed:true,condId:5000,condSrc:'良い',cost:1200,qty:1,weight:200,
    pics:[{url:'u'}],descHtml:'',specs:{origin:'Japan',platform:csvPlatformFrom(ja)},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',titleStatus:'',titleCands:[],
    titleNote:'',titleManual:false},extra||{});
  csvList=[
    row('dc','B0DC000001','Kanon カノン ドリームキャスト'),
    row('x3','B0X3000001','テイルズ オブ ヴェスペリア Xbox 360'),
    row('sw','B0SW000001','ゼルダの伝説 Switch版'),
    row('un','B0UN000001','機種の分からないゲーム')
  ];
  csvPick={}; csvList.forEach(csvRecalc); csvSaveList(); csvRender();
  $('csvListBox').open=true;
});
await setup();
const info=await p.evaluate(()=>{
  const o={};
  csvList.forEach(r=>{
    const box=csvTitleBox(r);
    o[r.id]={ plat:(r.specs||{}).platform, target:csvTitleTarget(r),
      sendable:csvTitleSendable(r), ten:/data-ten/.test(box), regen:/data-regen/.test(box),
      len80:/\/ 80/.test(box), sel:/data-plat/.test(box),
      issues:csvIssues(r).join('／') };
  });
  o.__genAll=csvList.filter(csvTitleSendable).filter(r=>
    !r.titleManual&&(!String(r.titleEn||'').trim()||r.titleStatus==='error')).map(r=>r.id);
  return o;
});
['dc','x3','sw','un'].forEach(k=>console.log('   '+k+': '+JSON.stringify(info[k])));
ok(info.dc.plat==='Sega Dreamcast'&&info.dc.target==='ok',
   '★ドリームキャストの行も「対象外」にならない');
ok(info.dc.ten&&info.dc.regen&&info.dc.len80,
   '★英題の入力欄・「再生成」・80文字チェックが出る');
ok(info.dc.sel,'★機種の選択欄も出る');
ok(info.dc.sendable,'★英題生成の対象になる');
ok(info.x3.plat==='Microsoft Xbox 360'&&info.x3.target==='ok'&&info.x3.sendable,
   '★Xbox 360 は通常の対象機種（取り込んだ時点で生成の対象）');
ok(info.sw.sel,'★もともと対象だった機種の行にも機種の選択欄を出す（取り違えを直せる）');
ok(info.un.target==='unknown'&&info.un.ten,
   '★機種が分からない行でも英題の入力欄は出す（空欄で止まらない）');
console.log('   一括作成の対象: '+JSON.stringify(info.__genAll));
ok(['dc','x3','sw','un'].every(id=>info.__genAll.indexOf(id)>=0),
   '★4行すべてが「英題と出品文を一括作成」の対象');

console.log('\n=== 機種を選ぶと行に入る ===');
const pick=await p.evaluate(()=>{
  const sel=document.querySelector('#csvList select[data-plat="un"]');
  const opts=Array.from(sel.options).map(o=>o.value);
  sel.value='dc'; sel.dispatchEvent(new Event('change',{bubbles:true}));
  const r=csvRowById('un');
  return { opts:opts, plat:(r.specs||{}).platform, target:csvTitleTarget(r),
    box:/data-ten/.test(csvTitleBox(r)), issues:csvIssues(r).join('／'),
    noOut:!/対象外/.test(csvTitleBox(r)) };
});
console.log('   '+JSON.stringify(pick).slice(0,200));
ok(pick.opts.indexOf('dc')>=0&&pick.opts.indexOf('x360')>=0,
   '★選択肢にドリームキャスト・Xbox 360 がある');
ok(pick.plat==='Sega Dreamcast'&&pick.target==='ok','★選ぶと行の Platform に入る');
ok(pick.box&&pick.noOut,'★選んだあとは通常の行と同じ（「対象外」の文字は出ない）');
const selnow=await p.evaluate(()=>
  document.querySelector('#csvList select[data-plat="un"]').value);
ok(selnow==='dc','★いま入っている機種が選ばれた状態で出る');

console.log('\n=== 英題を手で入れて書き戻すまで通る ===');
await setup();
const flow=await p.evaluate(()=>{
  const ta=document.querySelector('#csvList textarea[data-ten="dc"]');
  ta.value='Used Kanon Sega Dreamcast Japan Import';
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  return { titleEn:csvRowById('dc').titleEn, issues:csvIssues(csvRowById('dc')).join('／') };
});
console.log('   '+JSON.stringify(flow));
ok(flow.titleEn==='Used Kanon Sega Dreamcast Japan Import','★一覧の欄に手で入れられる');
ok(flow.issues.indexOf('英題なし')<0,'★「英題なし」が消える');
// 出品文を作る → 書き戻す
await p.click('#csvList button[data-edit="dc"]');
await p.waitForTimeout(400);
const edit=await p.evaluate(()=>({tab:$('tabA').getAttribute('aria-pressed'),
  sub:$('ebSubList').getAttribute('aria-pressed'),
  plat:$('gPlat').value, cat:$('cat').value}));
console.log('   '+JSON.stringify(edit));
ok(edit.tab==='true'&&edit.sub==='true','★eBayタブの「出品文」が開く');
ok(edit.plat==='Dreamcast'&&edit.cat==='game','★機種もゲームとして引き継ぐ');
await p.evaluate(()=>{ $('gTitle').value='Kanon';
  $('gTitle').dispatchEvent(new Event('input')); });
await p.click('#csvEditSave'); await p.waitForTimeout(400);
const back=await p.evaluate(()=>{
  const r=csvRowById('dc');
  return { game:(r.specs||{}).gameName, plat:(r.specs||{}).platform,
    desc:(r.descHtml||'').length, issues:csvIssues(r).join('／') };
});
console.log('   '+JSON.stringify(back));
ok(back.game==='Kanon'&&back.plat==='Sega Dreamcast',
   '★Game Name・Platform が行に書き戻される');
ok(back.desc>0&&back.issues==='','★出品文も入り、指摘が無くなる（先に進める）');
const csv=await p.evaluate(()=>{
  const sp=csvExportSplit(null);
  const r=csvRowById('dc');
  const txt=csvBuild(r.cat,[r]);
  const ln=String(txt).split(/\r?\n/);
  return { rows:sp.rows.map(x=>x.id), head:ln[1]||'', line:ln[2]||'' };
});
console.log('   '+csv.line.slice(0,110));
ok(csv.rows.indexOf('dc')>=0,'★書き出しにも進める');
ok(/Sega Dreamcast/.test(csv.line)&&/Kanon/.test(csv.line),
   '★CSVに Platform と Game Name が入る');

console.log('\n=== 機種ごとのリージョン注記 ===');
const notes=await p.evaluate(()=>{
  const out={};
  const want=[['Nintendo 3DS','3DS'],['Xbox 360','Xbox 360'],['Dreamcast','Dreamcast'],
    ['Sega Saturn','Sega Saturn'],['PS2','PlayStation 2'],['Wii','Wii'],
    ['GameCube','GameCube'],['Nintendo Switch',''],['PS5','']];
  $('cat').value='game';
  want.forEach(([title,word])=>{
    $('gPlat').value=title;
    $('gTitle').value='Test'; $('gPub').value='Pub';
    const html=descHTML(), txt=descPlain();
    out[title]={ lock:platLock(),
      html:/Region lock/.test(html),
      txt:/REGION LOCK/.test(txt),
      word:word?(html.indexOf('Japanese '+word)>=0||html.indexOf(word)>=0):true,
      head:(html.match(/Region lock[^<]*/)||[''])[0] };
  });
  return out;
});
Object.keys(notes).forEach(k=>console.log('   '+k+': '+JSON.stringify(notes[k])));
[['Nintendo 3DS','3ds'],['Xbox 360','x360'],['Dreamcast','dc'],['Sega Saturn','ss'],
 ['PS2','ps2'],['Wii','wii'],['GameCube','gc']].forEach(([t,k])=>{
  ok(notes[t].lock===k&&notes[t].html&&notes[t].txt&&notes[t].word,
     '★'+t+'：出品文（HTML・テキスト）に注記が入る');
});
ok(!notes['Nintendo Switch'].html&&!notes['PS5'].html,
   '★Switch・PS5 には注記を出さない（リージョンフリー）');
ok(/may be required/.test(notes['Xbox 360'].head),
   '★Xbox 360 は「ソフトによっては」の書き方にする');
ok(/required$/.test(notes['Dreamcast'].head),
   '★ドリームキャストは「日本版本体が必要」の書き方');
await T.done();
})();
