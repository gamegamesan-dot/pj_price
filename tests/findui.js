/* 画面：商品を探す（6.92）
   ・絞り込みの上の検索欄で、その場で一覧を絞る（絞り込みと組み合わせられる）
   ・対象：商品名（日本語・英題）・ASIN・JAN・ItemID・CustomLabel／SKU
   ・大文字小文字・全角半角を区別しない。空白で区切ると AND
   ・件数と「×」。ヒットが1件ならその行を開く
   ・JAN は items に列が無いので /find で ASIN に直してから当てる
   ・カメラは押したときだけ起動し、使えないときは手入力の案内を出す
   ・出品CSVタブにも同じものを付ける */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：商品を探す');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const ITEMS=[
 { asin:'B0PLAN00001', cond:'used', scope:'ebay', title:'ベヨネッタ3 Switch',
   ebay_item_id:'180001', custom_label:'E-B0PLAN00001', sku:'G-20250101-U-B0PLAN00001-1200',
   prefix:'G', ebay_price:47.65, ebay_qty:1, fba_total:1 },
 { asin:'B0PLAN00002', cond:'new', scope:'ebay', title:'グリザイア フィギュア',
   ebay_item_id:'180002', custom_label:'E-B0PLAN00002', sku:'H-20250101-N-B0PLAN00002-3000',
   prefix:'H', ebay_price:120.00, ebay_qty:1, fba_total:0 },
 { asin:'B0PLAN00003', cond:'used', scope:'ebay', title:'ちいかわ シール',
   ebay_item_id:'180003', custom_label:'E-B0PLAN00003', sku:'H-20250101-U-B0PLAN00003-300',
   prefix:'H', ebay_price:9.99, ebay_qty:0, fba_total:2 }];

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__find=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u);
    if(/\/find\?/.test(url)){
      window.__find.push(url);
      const jan=new URL(url).searchParams.get('jan');
      const map=o.map||{};
      return new Response(JSON.stringify({ok:true,rows:[{jan:jan,
        asin:map[jan]||'',name:'',rank:0,rank_cat:'',src:'catalog',
        err:map[jan]?'':'ASINが見つかりません'}]}),{status:200});
    }
    return real(u,i);
  };
  syncData={ items:o.items, counts:{}, fx:160 };
  syncPick={}; syncPage=1;
  switchTab('E'); syncRender();
},o||{});

console.log('=== 文字のそろえ方 ===');
await setup({ items:ITEMS });
let n=await p.evaluate(()=>({
  zen:findNorm('ＡＳＩＮ－１２３'), up:findNorm('B0PLAN00001'),
  sp:findNorm('  あ　い  '), hy:findNorm('ベヨネッタ―3'),
  t1:findTerms('ベヨネッタ  switch'), t2:findTerms('   '),
  jan:findJanOf('="4902370550467"'), jan2:findJanOf('490237055046'),
  hit:findHit('ベヨネッタ3 Switch',['ベヨネッタ','switch']),
  miss:findHit('ベヨネッタ3 Switch',['ベヨネッタ','ps5']) }));
console.log('   '+JSON.stringify(n));
ok(n.zen==='asin-123','★★全角の英数字と記号を半角にする');
ok(n.up==='b0plan00001','★★大文字小文字を区別しない');
ok(n.sp==='あ い','★★全角空白も空白として扱う');
ok(n.hy==='ベヨネッタ-3','★いろいろなハイフンをそろえる');
ok(n.t1.length===2,'★★空白で切る（AND 検索）');
ok(n.t2.length===0,'★空のときは言葉なし');
ok(n.jan==='4902370550467','★★="…" の形でも JAN を読む');
ok(n.jan2==='','★13桁でなければ JAN としない');
ok(n.hit===true&&n.miss===false,'★★AND：全部入っていないと当たらない');

console.log('\n=== 一覧をその場で絞る ===');
const find=async(q)=>await p.evaluate((q)=>{
  $('syncFind').value=q; findRun('sync');
  return { rows:(syncData.items||[]).filter(syncMatch).map((r)=>r.asin),
    note:$('syncFindNote').textContent,
    show:getComputedStyle($('syncFindNote')).display,
    clr:getComputedStyle($('syncFindClear')).display };
},q);
let d=await find('ベヨネッタ');
console.log('   '+JSON.stringify(d.rows)+'　'+d.note.replace(/\s+/g,' '));
ok(d.rows.join()==='B0PLAN00001','★★商品名（日本語）で当たる');
ok(/当たったのは 1件/.test(d.note)&&/全3件/.test(d.note),'★★件数を出す');
ok(d.show!=='none'&&d.clr!=='none','★★件数と「×」を出す');
d=await find('B0PLAN00002');
ok(d.rows.join()==='B0PLAN00002','★★ASIN で当たる');
d=await find('b0plan00002');
ok(d.rows.join()==='B0PLAN00002','★★小文字でも当たる');
d=await find('180003');
ok(d.rows.join()==='B0PLAN00003','★★eBay の ItemID で当たる');
d=await find('E-B0PLAN00001');
ok(d.rows.join()==='B0PLAN00001','★★CustomLabel で当たる');
d=await find('G-20250101-U-B0PLAN00001-1200');
ok(d.rows.join()==='B0PLAN00001','★★せどりすとSKU で当たる');
d=await find('シール ちいかわ');
ok(d.rows.join()==='B0PLAN00003','★★語順が違っても AND で当たる');
d=await find('ベヨネッタ ps5');
ok(d.rows.length===0&&/見つかりません/.test(d.note),
   '★★当たらないときは言葉を減らす案内を出す');
d=await find('');
ok(d.rows.length===3&&d.show==='none'&&d.clr==='none',
   '★★空にすると全部出て、件数と「×」が消える');

console.log('\n=== 絞り込みと組み合わせる ===');
let both=await p.evaluate(()=>{
  const ids=()=>(syncData.items||[]).filter(syncMatch).map((r)=>r.asin);
  $('syncFind').value=''; findRun('sync');
  const all=ids();
  /* 絞り込みだけ（検索なし） */
  syncFilterSet('listed_no_fba');
  const filt=ids();
  /* 絞り込み＋検索 */
  $('syncFind').value='ベヨネッタ'; findRun('sync');
  const both2=ids();
  /* 絞り込みで外れている行は、検索しても戻ってこない */
  const outside=all.filter((a)=>filt.indexOf(a)<0);
  let brought=[];
  if(outside.length){
    $('syncFind').value=outside[0]; findRun('sync');
    brought=ids();
  }
  syncFilterSet('all'); $('syncFind').value=''; findRun('sync');
  return { all:all, filt:filt, both:both2, outside:outside, brought:brought };
});
console.log('   '+JSON.stringify(both));
ok(both.all.length===3,'★検索なしで3件');
ok(both.filt.length<=both.all.length,'★絞り込みで減る（か同じ）');
ok(both.both.every((a)=>both.filt.indexOf(a)>=0),
   '★★絞り込み＋検索の結果は、絞り込みの結果の中に収まる（AND）');
ok(both.both.length<=both.filt.length,'★★検索を足すと増えない');
ok(both.outside.length===0||both.brought.length===0,
   '★★★絞り込みで外れた行は、その ASIN で検索しても出てこない');

console.log('\n=== 「×」で消す ===');
await p.evaluate(()=>{ $('syncFind').value='ベヨネッタ'; findRun('sync'); });
await p.evaluate(()=>{ $('syncFindClear').click(); });
let cleared=await p.evaluate(()=>({ v:$('syncFind').value,
  nrows:(syncData.items||[]).filter(syncMatch).length }));
ok(cleared.v===''&&cleared.nrows===3,'★★「×」で検索が消えて全部出る');

console.log('\n=== JAN で探す（items に列が無いので ASIN に直す）===');
await setup({ items:ITEMS, map:{ '4902370550467':'B0PLAN00001' } });
await p.evaluate(()=>{ $('syncFind').value='4902370550467'; findRun('sync'); });
await p.waitForTimeout(400);
let j=await p.evaluate(()=>({
  calls:window.__find, rows:(syncData.items||[]).filter(syncMatch).map((r)=>r.asin),
  note:$('syncFindNote').textContent }));
console.log('   '+JSON.stringify(j.calls)+'　'+JSON.stringify(j.rows));
console.log('   '+j.note.replace(/\s+/g,' '));
ok(j.calls.length===1&&/jan=4902370550467/.test(j.calls[0]),
   '★★JAN を入れたら /find で ASIN を聞く');
ok(j.rows.join()==='B0PLAN00001','★★★返った ASIN の行が当たる');
ok(/ASIN/.test(j.note)&&/B0PLAN00001/.test(j.note),
   '★★どの ASIN に直したかを出す');
/* 2回目は聞かない（画面にも控える） */
await p.evaluate(()=>{ $('syncFind').value=''; findRun('sync');
  $('syncFind').value='4902370550467'; findRun('sync'); });
await p.waitForTimeout(300);
let again=await p.evaluate(()=>window.__find.length);
ok(again===1,'★★★同じ JAN は2回聞かない（控える）');

console.log('\n=== 見つからない JAN ===');
await p.evaluate(()=>{ $('syncFind').value='4999999999994'; findRun('sync'); });
await p.waitForTimeout(400);
let nf=await p.evaluate(()=>({ rows:(syncData.items||[]).filter(syncMatch).length,
  note:$('syncFindNote').textContent }));
ok(nf.rows===0,'★当たらない');
ok(/見つかりません/.test(nf.note),'★★見つからないと分かる');

console.log('\n=== ヒットが1件ならその行を開く ===');
await setup({ items:ITEMS });
await p.evaluate(()=>{ $('syncFind').value='ベヨネッタ'; findRun('sync'); });
await p.waitForTimeout(300);
let opened=await p.evaluate(()=>{
  const ds=$('syncList').querySelectorAll('details.det');
  return { n:ds.length, open:ds.length?ds[0].open:null }; });
console.log('   '+JSON.stringify(opened));
ok(opened.n===1,'★1件だけ出ている');
ok(opened.open===true,'★★★ヒットが1件ならその行を開いた状態で出す');
/* 自動で開いた分は覚えない */
let remembered=await p.evaluate(()=>{
  const ds=$('syncList').querySelectorAll('details.det');
  const k=ds[0].getAttribute('data-detk'), t=ds[0].getAttribute('data-det');
  return detIsOpen(t,k); });
ok(remembered===false,'★★自動で開いた分は覚えない（次に全部出したとき開かない）');

console.log('\n=== バーコードの読み取り ===');
let cam=await p.evaluate(()=>({
  url:ZXING_URL,
  ean:[findEanOk('4902370550467'),findEanOk('4902370550468'),
       findEanOk('490237055046'),findEanOk('4580416924740')],
  box:getComputedStyle($('syncFindCamBox')).display }));
console.log('   '+cam.url);
ok(/@zxing\/browser@0\.2\.1/.test(cam.url),'★★版を固定して読む（0.2.1）');
ok(/cdn\.jsdelivr\.net/.test(cam.url),'★jsdelivr から読む');
ok(cam.ean[0]===true&&cam.ean[3]===true,'★★EAN-13 のチェックデジットが合えば通す');
ok(cam.ean[1]===false,'★★チェックデジットが違うものは弾く（読み間違い対策）');
ok(cam.ean[2]===false,'★13桁でないものは弾く');
ok(cam.box==='none','★★押すまでカメラは起動しない');

console.log('\n=== カメラが使えないとき ===');
await p.evaluate(()=>{
  Object.defineProperty(navigator,'mediaDevices',{value:undefined,configurable:true});
  $('syncFindCam').click(); });
await p.waitForTimeout(200);
let no=await p.evaluate(()=>({ note:$('syncFindCamNote').textContent,
  box:getComputedStyle($('syncFindCamBox')).display }));
console.log('   '+no.note);
ok(no.box!=='none','★枠は出る');
ok(/カメラを使えません/.test(no.note),'★★使えないと分かる');
ok(/手で入れて/.test(no.note),'★★★検索欄に手入力できる案内を出す');
await p.evaluate(()=>{ $('syncFindCamStop').click(); });
let stopped=await p.evaluate(()=>getComputedStyle($('syncFindCamBox')).display);
ok(stopped==='none','★★「カメラを止める」で閉じる');

console.log('\n=== 出品CSVタブにも同じものが付く ===');
await p.evaluate(()=>{
  csvList=[
    { id:'c1', asin:'B0CSV00001', jan:'4902370550467', name:'ベヨネッタ3',
      titleEn:'Bayonetta 3 Switch', cat:'139973', condId:1000, price:47.65,
      specs:{}, pics:[] },
    { id:'c2', asin:'B0CSV00002', jan:'4580416924740', name:'グリザイア',
      titleEn:'Grisaia Figure', cat:'261068', condId:1000, price:120,
      specs:{}, pics:[] }];
  csvSaveList(); switchTab('D'); csvRender();
});
await openCsvBoxes(p);
let c=await p.evaluate(()=>{
  const f=(q)=>{ $('csvFind').value=q; findRun('csv');
    return csvSorted().filter((r)=>csvMatchFilter(r)&&findMatchCsv(r))
      .map((r)=>r.id); };
  return { name:f('ベヨネッタ'), en:f('bayonetta'), asin:f('B0CSV00002'),
    jan:f('4580416924740'), none:f('存在しない'), all:f(''),
    note:(function(){ $('csvFind').value='ベヨネッタ'; findRun('csv');
      return $('csvFindNote').textContent; })() };
});
console.log('   '+JSON.stringify(c));
ok(c.name.join()==='c1','★★出品CSVでも商品名で当たる');
ok(c.en.join()==='c1','★★英題で当たる');
ok(c.asin.join()==='c2','★ASIN で当たる');
ok(c.jan.join()==='c2','★★★出品CSVの行は JAN をそのまま持っているので直接当たる');
ok(c.none.length===0,'★当たらない');
ok(c.all.length===2,'★空なら全部');
ok(/当たったのは 1件/.test(c.note),'★★件数も出る');
let cc=await p.evaluate(()=>({ box:getComputedStyle($('csvFindCamBox')).display,
  cam:typeof $('csvFindCam').onclick==='function',
  clr:typeof $('csvFindClear').onclick==='function' }));
ok(cc.cam&&cc.clr,'★★カメラと「×」が結ばれている');
ok(cc.box==='none','★押すまでカメラは起動しない');

await T.done();
})();
