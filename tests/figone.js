/* 画面：中古フィギュアの一点物を自動でオンにする（6.94）と
   MW の行を出品リストに入れる（6.96）
   ・書き出し・名簿送信のときに、中古のホビー（フィギュア）の一点物をオンにする
   ・手でオフにした行はそのまま残す
   ・中古フィギュアで一点物がオフの行を絞り込みで出せる
   ・MW の行は CustomLabel が W-<JAN>、MW用ポリシー、ハンドリングの検査つき */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：中古フィギュアの一点物とMWの出品');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const setup=async()=>await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('csvShipProfile').value='W1000'; $('csvShipProfileRe').value='W2000';
  $('csvShipProfileMw').value='W2000'; $('csvShipDaysMw').value='10';
  $('csvRetProfile').value='R1'; $('csvPayProfile').value='P1';
  $('csvDispatch').value='3';
  csvList=[
    /* 中古のフィギュア（非可動）。一点物がオフ → 自動でオンになる */
    { id:'f1', asin:'B00FIG00001', jan:'4582292602828', titleJa:'中古フィギュアA',
      titleEn:'Used Figure A', cat:'261055', condId:3000, qty:1, cost:3000,
      oneOff:false, specs:{origin:'Japan'}, pics:[{url:'u1'}], zeroAct:'hold' },
    /* 中古のフィギュア（可動）。手でオフにした → そのまま */
    { id:'f2', asin:'B00FIG00002', jan:'4582292602829', titleJa:'中古フィギュアB',
      titleEn:'Used Figure B', cat:'261068', condId:3000, qty:1, cost:3000,
      oneOff:false, oneOffSet:true, specs:{origin:'Japan'}, pics:[{url:'u2'}],
      zeroAct:'hold' },
    /* 新品のフィギュア → 対象外 */
    { id:'f3', asin:'B00FIG00003', jan:'4582292602830', titleJa:'新品フィギュア',
      titleEn:'Figure C', cat:'261055', condId:1000, qty:1, cost:3000,
      oneOff:false, specs:{origin:'Japan'}, pics:[{url:'u3'}], zeroAct:'hold' },
    /* 中古のゲーム → 対象外 */
    { id:'f4', asin:'B00GAME0001', jan:'4902370550467', titleJa:'中古ゲーム',
      titleEn:'Used Game', cat:'139973', condId:3000, qty:1, cost:3000,
      oneOff:false, specs:{gameName:'G',platform:'Nintendo Switch'},
      pics:[{url:'u4'}], zeroAct:'hold' },
    /* カートリッジのみ（ゲーム） → 対象外 */
    { id:'f5', asin:'B00GAME0002', jan:'4902370550468', titleJa:'カートのみ',
      titleEn:'Used Game Cartridge Only', cat:'139973', condId:3000, qty:1,
      cost:3000, cartOnly:true, oneOff:false,
      specs:{gameName:'G',platform:'Nintendo Switch'}, pics:[{url:'u5'}],
      zeroAct:'hold' }];
  csvSaveList(); switchTab('D'); roleCheck(); csvRender();
});

console.log('=== 対象の見分け（csvFigUsed）===');
await setup();
let f=await p.evaluate(()=>{
  const by={}; csvList.forEach((r)=>{ by[r.id]=csvFigUsed(r); });
  return by; });
console.log('   '+JSON.stringify(f));
ok(f.f1===true,'★★中古の非可動フィギュアは対象');
ok(f.f2===true,'★★中古の可動フィギュアも対象');
ok(f.f3===false,'★★新品は対象外');
ok(f.f4===false,'★★中古でもゲームは対象外');
ok(f.f5===false,'★★カートリッジのみ（ゲーム）は対象外');

console.log('\n=== 自動でオンにする（手でオフにした行は残す）===');
let auto=await p.evaluate(()=>{
  const n=csvFigOneAuto();
  const by={}; csvList.forEach((r)=>{ by[r.id]=!!r.oneOff; });
  return { n:n, by:by }; });
console.log('   '+JSON.stringify(auto));
ok(auto.n===1,'★★オンにしたのは1件');
ok(auto.by.f1===true,'★★★中古フィギュアの一点物がオンになる');
ok(auto.by.f2===false,'★★★手でオフにした行（oneOffSet）はそのまま残る');
ok(auto.by.f3===false&&auto.by.f4===false&&auto.by.f5===false,
   '★★対象外の行は触らない');
let again=await p.evaluate(()=>csvFigOneAuto());
ok(again===0,'★もう一度押しても何も増えない');

console.log('\n=== 手で切り替えると「人が決めた」印が立つ ===');
await setup();
let hand=await p.evaluate(()=>{
  /* 行の「一点物」ボタンを押したのと同じ処理 */
  const i=csvList.findIndex((r)=>r.id==='f1');
  csvList[i].oneOff=!csvList[i].oneOff;
  csvList[i].oneOffSet=true;
  /* オンにしたあと、もう一度押してオフに戻す */
  csvList[i].oneOff=!csvList[i].oneOff;
  csvList[i].oneOffSet=true;
  csvSaveList();
  const n=csvFigOneAuto();
  return { n:n, one:csvList[i].oneOff, set:csvList[i].oneOffSet }; });
console.log('   '+JSON.stringify(hand));
ok(hand.set===true,'★★手で触ったら印が立つ');
ok(hand.n===0&&hand.one===false,
   '★★★手でオフにしたあとは自動でオンにしない');

console.log('\n=== 絞り込みで出せる ===');
await setup();
let flt=await p.evaluate(()=>{
  const g=csvFilterBy('figone');
  return { label:g.label, ids:csvList.filter(g.f).map((r)=>r.id),
    opts:Array.prototype.map.call($('csvFilter').options,(o)=>o.textContent) }; });
console.log('   '+JSON.stringify(flt.ids));
ok(/中古フィギュアで一点物がオフ/.test(flt.label),'★★絞り込みの名前');
ok(flt.ids.join()==='f1,f2','★★★中古フィギュアで一点物がオフの行だけ出る');
ok(flt.opts.some((x)=>/中古フィギュアで一点物がオフ（2）/.test(x)),
   '★★絞り込みの選択肢に件数つきで出る');
await p.evaluate(()=>{ csvFigOneAuto(); csvRender(); });
let after=await p.evaluate(()=>
  csvList.filter(csvFilterBy('figone').f).map((r)=>r.id));
ok(after.join()==='f2','★★自動オンのあとは、手でオフにした行だけ残る');

console.log('\n=== 名簿に one_off が入る ===');
let src=await p.evaluate(()=>{
  const r=csvList.filter((x)=>x.id==='f1')[0];
  return csvPriceSrcOf(r); });
ok(src.one_off===true,'★★★名簿（/items）に一点物として送られる');

console.log('\n=== MW の行：CustomLabel と配送ポリシー（6.96）===');
let mwr=await p.evaluate(()=>{
  const r={ id:'w1', src:'mw', jan:'4595120538169', asin:'B0FVLXGFMH',
    titleJa:'千銃士', titleEn:'Senjushi', cat:'139973', catFixed:true,
    condId:1000, qty:1, cost:13376, dropship:true, buySource:'mw',
    descHtml:'<p>MW の商品説明</p>',
    mwSha:'M200', mwShipDays:0, mwStock:9, oneOff:false, oneOffSet:true,
    specs:{gameName:'Senjushi',platform:'Nintendo Switch'},
    pics:[{url:'https://img.example/i/20261030/x.jpg'}], zeroAct:'hold',
    price:62.05, floor:51.16 };
  csvList=[r]; csvSaveList(); csvRender();
  return { label:csvCustomLabel(r), ship:csvShipProfileFor(r),
    need:csvMwNeedDays(r), issues:csvIssues(r) }; });
console.log('   不備: '+JSON.stringify(mwr.issues));
console.log('   '+JSON.stringify(mwr));
ok(mwr.label==='W-4595120538169','★★★CustomLabel は W-<JAN>');
ok(mwr.ship==='W2000','★★★MW用の配送ポリシーで出す');
ok(mwr.need===2,'★★要るハンドリングは MW の出荷日数＋2日');
ok(mwr.issues.length===0,'★不備なし（ふだんの流れで出せる）');

console.log('\n=== ハンドリングが足りない行は書き出せない ===');
let bad=await p.evaluate(()=>{
  const r=csvList[0];
  r.mwShipDays=9;                 // 9営業日＋2日＝11日 > ポリシー10日
  const a=csvIssues(r);
  $('csvShipDaysMw').value='12';  // ポリシーを12日にすれば通る
  const b=csvIssues(r);
  $('csvShipDaysMw').value='10';
  r.mwShipDays=0;
  return { a:a, b:b }; });
console.log('   '+JSON.stringify(bad.a));
ok(bad.a.some((x)=>/ハンドリングが足りません/.test(x)),
   '★★★MW の出荷日数＋2日がポリシーを超えたら不備にする');
ok(bad.a.some((x)=>/11日 > ポリシー 10日/.test(x)),'★★数字を出して分かるようにする');
ok(bad.b.length===0,'★★ポリシーを長くすれば通る');
let noProf=await p.evaluate(()=>{
  $('csvShipProfileMw').value='';
  const a=csvIssues(csvList[0]);
  $('csvShipProfileMw').value='W2000';
  return a; });
ok(noProf.some((x)=>/MW用の配送ポリシー名が未設定/.test(x)),
   '★★ポリシー名が空なら不備にする');

console.log('\n=== MW の行は一点物にしない ===');
let mwOne=await p.evaluate(()=>{
  const r=csvList[0];
  return { fig:csvFigUsed(r), auto:csvFigOneAuto(), one:r.oneOff }; });
ok(mwOne.fig===false,'★★新品なので中古フィギュアの対象外');
ok(mwOne.one===false,'★★★MW の無在庫は一点物にしない（在庫がある限り補充する）');

await T.done();
})();
