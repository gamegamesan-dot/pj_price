/* 画面：Amazon刈取タブ（6.116〜6.120）
   出品CSVタブの「国内 Amazon FBA で見る」を独立したタブに移した（機能は同じ）。
   ・タブは 出品CSV／販売連携／eBay／Amazon刈取／⚙（Shopee はタブから外した）
   ・スマホの幅（390・360・320px）で1行に収まる
   ・MW の在庫CSVの取り込みはタブの上にも置く（同じ処理）。前回の取り込みと催促も
   ・作業者でも見える（見る・印・JANコピー・注文用CSVまで）
   ・「Amazonで調べる」「Amazon に登録する」は管理者だけ
   ・最後に開いていたタブから始める */
const { harness } = require('./lib');
const T = harness('画面：Amazon刈取タブ');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });
await p.waitForTimeout(400);

console.log('=== タブの並び ===');
let bar=await p.$$eval('.tabbar .tabs button',bs=>bs
  .filter(b=>getComputedStyle(b).display!=='none')
  .map(b=>b.textContent));
console.log('   '+JSON.stringify(bar));
ok(bar.join('|')==='出品CSV|販売連携|eBay|Amazon刈取|⚙',
   '★★★出品CSV／販売連携／eBay／Amazon刈取／⚙');
ok(bar.length===5,'★5つ');

console.log('\n=== スマホの幅で1行に収まる ===');
for(const w of [414,390,360,320]){
  await p.setViewportSize({width:w,height:900});
  await p.waitForTimeout(120);
  const r=await p.evaluate(()=>{
    const tabs=document.querySelector('.tabbar .tabs');
    const bs=Array.prototype.filter.call(tabs.querySelectorAll('button'),
      (b)=>getComputedStyle(b).display!=='none');
    const top=bs.map((b)=>Math.round(b.getBoundingClientRect().top));
    return { rows:new Set(top).size,
      over:tabs.scrollWidth>tabs.clientWidth+1,
      pageOver:document.documentElement.scrollWidth>window.innerWidth,
      wrap:bs.some((b)=>b.getBoundingClientRect().height>60),
      font:parseFloat(getComputedStyle(bs[0]).fontSize) };
  });
  console.log('   '+w+'px: '+JSON.stringify(r));
  ok(r.rows===1,'★★★'+w+'px で1行に収まる');
  ok(r.over===false,'★★'+w+'px でタブがあふれない');
  ok(r.pageOver===false,'★'+w+'px で横にはみ出さない');
  ok(r.wrap===false,'★★'+w+'px でボタンが縦に伸びない（文字を詰める）');
}
await p.setViewportSize({width:390,height:900});

console.log('\n=== Amazon刈取タブの中身（移したもの）===');
await p.evaluate(()=>{ switchTab('F'); });
await p.waitForTimeout(200);
let v=await p.evaluate(()=>{
  const d=(id)=>{ const el=$(id); return !!el&&getComputedStyle(el).display!=='none'; };
  const inTab=(id)=>{ const el=$(id);
    return !!(el&&el.closest('#tabAmz')); };
  return { tab:d('tabAmz'), csv:d('tabCsv'),
    scan:inTab('csvMwAmz'), list:inTab('csvMwAmzList'),
    sort:inTab('csvMwAmzSort'), dup:inTab('csvMwAmzDup'),
    rstOk:inTab('csvMwAmzRstOk'), buyBar:inTab('csvMwBuyBar'),
    buyShow:inTab('csvMwBuyShow'), jan:inTab('csvMwJanCopy'),
    orderCsv:inTab('csvMwBuyCsv'), reg:inTab('csvMwReg'),
    put:inTab('csvMwPut'), find:inTab('mwAmzFind'), cam:inTab('mwAmzFindCam'),
    /* 出品CSVタブに残すもの */
    mwBox:!!$('csvMwBox'), mwImport:!!($('csvMwImport')
      &&$('csvMwImport').closest('#tabCsv')) };
});
console.log('   '+JSON.stringify(v));
ok(v.tab===true&&v.csv===false,'★★★Amazon刈取タブが開く');
ok(v.scan&&v.list&&v.sort&&v.dup&&v.rstOk,
   '★★★「Amazonで調べる」・一覧・並べ替え・絞り込み（JAN重複だけを含む）が入っている');
ok(v.buyBar&&v.buyShow&&v.jan&&v.orderCsv,
   '★★★仕入れる印の帯・仕入れる一覧・JANコピー・注文用CSVが入っている');
ok(v.reg&&v.put,'★★★Amazon登録用ファイルと Amazon への登録が入っている');
ok(v.find&&v.cam,'★★★検索欄と📷が入っている');
ok(v.mwBox&&v.mwImport,
   '★★★MW の無在庫（在庫CSVの取り込み）は出品CSVタブに残る');

console.log('\n=== MW の在庫CSVの取り込みはタブの上にも ===');
let top=await p.evaluate(()=>{
  const b=$('mwTopImport');
  return { has:!!b, outside:!!(b&&!b.closest('#tabCsv')&&!b.closest('#tabAmz')),
    above:!!(b&&document.querySelector('.tabbar')
      &&b.compareDocumentPosition(document.querySelector('.tabbar'))
        &Node.DOCUMENT_POSITION_PRECEDING)===false,
    same:!!(b&&$('csvMwFile')),
    note:!!$('mwTopNote'), stale:!!$('mwTopStale'),
    noteText:$('mwTopNote').textContent };
});
console.log('   '+JSON.stringify(top));
ok(top.has&&top.outside,'★★★タブの外（どのタブからでも押せる）にある');
ok(top.same,'★★同じファイル選択を使う（取り込みの処理は1つだけ）');
ok(top.note&&top.stale,'★★前回の取り込みと催促の場所がある');
ok(/まだ取り込んでいません/.test(top.noteText),'★取り込み前はそう出す');
/* 前回の取り込みと24時間の催促 */
let st=await p.evaluate(()=>{
  mwStaleLast={ at:new Date(Date.now()-3*3600000).toISOString(), rows_in:12062 };
  mwLast=null; MW_STALE_H=24; mwStaleRender();
  const a={ note:$('mwTopNote').textContent,
            stale:$('mwTopStale').style.display!=='none' };
  mwStaleLast={ at:new Date(Date.now()-26*3600000).toISOString(), rows_in:12062 };
  mwStaleRender();
  return { fresh:a, old:{ note:$('mwTopNote').textContent,
    stale:$('mwTopStale').style.display!=='none',
    text:$('mwTopStale').textContent,
    sync:$('syncMwStale').style.display!=='none' } };
});
console.log('   3時間前: '+JSON.stringify(st.fresh));
console.log('   26時間前: '+st.old.note+' / 催促 '+st.old.stale);
ok(/前回の取り込み/.test(st.fresh.note)&&/12,062行/.test(st.fresh.note),
   '★★★前回の取り込み日時と行数を出す');
ok(st.fresh.stale===false,'★★24時間以内は催促しない');
ok(st.old.stale===true&&/26時間前/.test(st.old.text),
   '★★★24時間を過ぎたら催促する');
ok(/取り込んでください/.test(st.old.text),'★★何をすればよいか書く');
ok(st.old.sync===true,'★★販売連携タブにも今までどおり出す');
ok(/26時間前/.test(st.old.note),'★上の行にも古さを出す');

console.log('\n=== ⚙の「Amazon刈取」のまとまり ===');
let cfg=await p.evaluate(()=>{
  const box=$('cfgAmzBox');
  const has=(id)=>!!($(id)&&$(id).closest('#cfgAmzBox'));
  return { box:!!box, sum:box?box.querySelector('summary').textContent:'',
    fee:has('mwAmzFeeGame')&&has('mwAmzFbaGame')&&has('mwAmzFeeHobby')
        &&has('mwAmzFbaHobby'),
    net:has('mwNetMode'), auto:has('mwAutoMode'),
    autoLabel:$('mwAutoMode').closest('.rowv').querySelector('label').textContent,
    autoNote:$('mwAutoMode').closest('.rowv').querySelector('.note2').textContent };
});
console.log('   '+JSON.stringify({box:cfg.box,sum:cfg.sum,fee:cfg.fee,
  net:cfg.net,auto:cfg.auto}));
ok(cfg.box&&/Amazon刈取/.test(cfg.sum),'★★★⚙に「Amazon刈取」のまとまりがある');
ok(cfg.fee,'★★★FBA の手数料が入っている');
ok(cfg.net,'★★★税抜の粗利の出し方が入っている');
ok(cfg.auto,'★★★自動の取り直しが入っている');
ok(/MW候補の Amazon 価格/.test(cfg.autoLabel),'★★名前は「MW候補の Amazon 価格」');
ok(/MW の在庫CSVの取り込みは手動のままです/.test(cfg.autoNote),
   '★★★「在庫CSVの取り込みは手動のまま」と添える');

console.log('\n=== 作業者でも見える（6.120）===');
await p.evaluate(()=>{ syncRole='staff'; roleApply(); switchTab('F'); });
await p.waitForTimeout(200);
let sv=await p.evaluate(()=>{
  const d=(id)=>{ const el=$(id); return !!el&&getComputedStyle(el).display!=='none'; };
  return { tabBtn:d('tabF'), tab:d('tabAmz'), list:d('csvMwAmzList'),
    sort:d('csvMwAmzSort'), dup:d('csvMwAmzDup'),
    jan:d('csvMwJanCopy'), orderCsv:d('csvMwBuyCsv'), buyShow:d('csvMwBuyShow'),
    scan:d('csvMwAmz'), put:d('csvMwPut'), reg:d('csvMwReg') };
});
console.log('   '+JSON.stringify(sv));
ok(sv.tabBtn&&sv.tab,'★★★作業者でも Amazon刈取タブが見える');
ok(sv.list&&sv.sort&&sv.dup,'★★★一覧・並べ替え・絞り込みが見える');
ok(sv.jan&&sv.orderCsv&&sv.buyShow,
   '★★★JANコピー・注文用CSV・仕入れる一覧が見える');
ok(sv.scan===false,'★★★「Amazonで調べる」は管理者だけ');
ok(sv.put===false,'★★★「Amazon に登録する」も管理者だけ');
await p.evaluate(()=>{ syncRole='admin'; roleApply(); });

console.log('\n=== 仕入れる印は作業者でも付けられる ===');
/* Worker 側も作業者で通る口（7.68）。画面でも押せること。 */
let chk=await p.evaluate(()=>{
  syncRole='staff'; roleApply();
  mwAmzRows=[{ jan:'4902370550467', sha:'M200', kishu:'NS', cond:'新品',
    mw_name:'テスト', amz_name:'テスト', wholesale:3000, stock:9, note:'',
    ship_text:'即日', ship_days:0, asin:'B00TEST0001', price:9000,
    basis:'カート', new_n:2, amz:0, rank:1, rst:'ok', cand_n:1 }];
  mwAmzMeta={n:1,seen:1,priced:1,left:0}; mwBuyMap={};
  $('mwShipFee').value='176'; mwAmzRender();
  const el=$('mwBuyChk_4902370550467');
  const r={ has:!!el, dis:el?el.disabled:null,
            shown:el?getComputedStyle(el).display!=='none':false };
  syncRole='admin'; roleApply();
  return r;
});
console.log('   '+JSON.stringify(chk));
ok(chk.has&&chk.shown&&chk.dis===false,
   '★★★作業者でも「仕入れる」を付けられる');

await T.done();
})();
