/* 画面：仕入れる一覧から外す／両方の一覧で検索（6.125）
   ・「仕入れる一覧」の各行に「外す」。押すと印を外し、合計・送料無料までの残り・
     注文用CSV・JANコピーにすぐ反映する（mw_buy から外すのでほかの端末でも消える）
   ・押した直後に数秒「元に戻す」（確認の画面は出さない）
   ・一覧の上に「すべて外す」（こちらは確認の画面を出す）
   ・作業者用の端末でも外せる（印を付けられるのと同じ扱い）
   ・検索（商品名・ASIN・JAN・社。AND・全半角・大小文字）は
     「一覧を出す」のリストと「仕入れる一覧」の両方で効く
   ・絞り込みで隠れている行が検索に当たるときは「絞り込みで隠れている n件」 */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：仕入れる印を外す・両方で検索');
const ok = T.ok;
(async()=>{
const p=await T.open();
const dlg=[];
p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

const base={ sha:'M200', cond:'新品', stock:9, note:'', ship_text:'即日出荷',
  ship_days:0, basis:'カート', new_n:4, low_n:1, amz:0, fba_n:3, amz_err:'',
  amz_at:'2026-10-30T01:00:00Z', rst:'ok', list_price:9800 };
const ROWS=[
 Object.assign({},base,{ jan:'4595120538169', kishu:'NS',
   mw_name:'千銃士 ロドナイト 限定版', asin:'B0FVLXGFMH',
   amz_name:'千銃士:Rhodoknight 限定版', wholesale:12000, price:24829,
   rank:1200, rank_cat:'ゲーム' }),
 Object.assign({},base,{ jan:'4582292602828', kishu:'figure', sha:'MC02',
   mw_name:'グリザイア トーカ', asin:'B0B98TXLKY', amz_name:'グリザイア トーカ 1/6',
   wholesale:4000, price:26799, rank:2310, rank_cat:'ホビー' }),
 Object.assign({},base,{ jan:'4988611224878', kishu:'NS',
   mw_name:'赤字になる商品', asin:'B00REDAAAA', amz_name:'赤字',
   wholesale:9000, price:5000, rank:50000, rank_cat:'ゲーム' })];
const META={ ok:true, n:3, rows:ROWS, seen:3, priced:3, left:0, per_run:120,
  ttl_days:3, limit:3000 };

const setup=async(role)=>await p.evaluate(([META,role])=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='5';
  $('mwKishu').value='NS,figure'; $('mwNewOnly').checked=true;
  $('mwNoteAll').checked=false; $('mwNoteNg').value='';
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  $('mwAmzFeeHobby').value='10'; $('mwAmzFbaHobby').value='580';
  window.__buy={};                       // サーバー側の mw_buy のつもり
  window.__posts=[]; window.__dl=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:role,staff_key_set:true}),
        {status:200});
    if(/\/mw\/buy/.test(url)&&i&&i.method==='POST'){
      window.__posts.push(b);
      const list=b.items||[{jan:b.jan,qty:b.qty}];
      list.forEach((x)=>{ const j=String(x.jan);
        if(+x.qty>0)window.__buy[j]=+x.qty; else delete window.__buy[j]; });
      return new Response(JSON.stringify({ok:true,n:list.length}),{status:200});
    }
    if(/\/mw\/buy/.test(url)){
      const rows=Object.keys(window.__buy).map((j)=>{
        const r=(META.rows||[]).filter((x)=>String(x.jan)===j)[0]||{};
        return { jan:j, qty:window.__buy[j], mw_name:r.mw_name||'', sha:r.sha||'',
          wholesale:r.wholesale||0, stock:r.stock||0, ship_days:r.ship_days||0,
          asin:r.asin||'', price:r.price||0, gone_at:null };
      });
      return new Response(JSON.stringify({ok:true,rows:rows,n:rows.length,gone:0}),
        {status:200});
    }
    if(/\/mw\/amz/.test(url))
      return new Response(JSON.stringify(META),{status:200});
    return real(u,i);
  };
  window.csvDownloadBlob=function(name,blob){
    return blob.text().then(function(t){ window.__dl.push({name:name,text:t}); });
  };
  syncRole=role; roleApply(); switchTab('F');
},[META,role]);
const load=async()=>{
  await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
  await p.waitForTimeout(400);
};
const mark=async(jan,q)=>{
  await p.evaluate(([jan,q])=>{ mwBuySet(jan,q); },[jan,q]);
  await p.waitForTimeout(350);
};
const buyShow=async()=>{
  await p.evaluate(()=>{ $('csvMwBuyShow').click(); });
  await p.waitForTimeout(400);
};
const view=()=>p.evaluate(()=>({
  note:($('csvMwAmzListNote').textContent||'').replace(/\s+/g,' '),
  list:($('csvMwAmzList').textContent||'').replace(/\s+/g,' '),
  offs:Array.prototype.map.call(
    document.querySelectorAll('#csvMwAmzList [data-buyoff]'),
    (b)=>b.getAttribute('data-buyoff')),
  bar:($('csvMwBuyBar').textContent||'').replace(/\s+/g,' '),
  undo:{ show:getComputedStyle($('mwBuyUndoBar')).display!=='none',
         text:($('mwBuyUndoText').textContent||'') },
  srv:window.__buy }));
const find=async(q)=>{
  await p.evaluate((q)=>{ $('mwAmzFind').value=q;
    $('mwAmzFind').dispatchEvent(new Event('change')); },q);
  await p.waitForTimeout(300);
};
const names=()=>p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('#csvMwAmzList > div'),
  (el)=>((el.innerText||'').match(/\b\d{13}\b/)||[''])[0]).filter(Boolean));

console.log('=== 外す（確認は出さず、元に戻すを出す）===');
await setup('admin');
await openCsvBoxes(p);
await load();
await mark('4595120538169',1);
await mark('4582292602828',2);
await buyShow();
let v=await view();
console.log('   '+v.note.slice(0,40)+' / 外す '+JSON.stringify(v.offs));
ok(v.offs.length===2,'★★★行ごとに「外す」が付く');
ok(/仕入れる 2件/.test(v.note),'一覧の上に件数');
ok(/合計 ¥22,000/.test(v.bar),'外す前の合計（13,200＋8,800）');
dlg.length=0;
await p.evaluate(()=>{ document.querySelector(
  '#csvMwAmzList [data-buyoff="4595120538169"]').click(); });
await p.waitForTimeout(500);
v=await view();
console.log('   '+JSON.stringify({srv:v.srv,bar:v.bar.slice(0,60),
  undo:v.undo.text,dlg:dlg.length}));
ok(dlg.length===0,'★★★確認の画面は出さない');
ok(!v.srv['4595120538169']&&v.srv['4582292602828']===2,
   '★★★サーバー（mw_buy）からも外す（ほかの端末でも消える）');
ok(v.offs.length===1,'★★一覧からすぐ消える');
ok(/仕入れる 1件/.test(v.bar)&&/合計 ¥8,800/.test(v.bar),
   '★★★合計がすぐ変わる');
ok(/あと ¥41,200/.test(v.bar),'★★★送料無料までの残りも変わる');
ok(v.undo.show===true&&/外しました/.test(v.undo.text),
   '★★★押した直後に「元に戻す」を出す');

console.log('\n=== 元に戻す ===');
await p.evaluate(()=>{ $('mwBuyUndoBtn').click(); });
await p.waitForTimeout(500);
v=await view();
console.log('   '+JSON.stringify({srv:v.srv,bar:v.bar.slice(0,40),
  undo:v.undo.show}));
ok(v.srv['4595120538169']===1,'★★★数量もそのまま戻る');
ok(/仕入れる 2件/.test(v.bar),'★★合計も戻る');
ok(v.undo.show===false,'★帯は消える');

console.log('\n=== 注文用CSV と JAN コピーにも効く ===');
await p.evaluate(()=>{ document.querySelector(
  '#csvMwAmzList [data-buyoff="4595120538169"]').click(); });
await p.waitForTimeout(500);
await p.evaluate(()=>{ $('csvMwBuyCsv').click(); });
await p.waitForTimeout(500);
const dl=await p.evaluate(()=>window.__dl);
const csv=(dl[dl.length-1]||{}).text||'';
console.log('   '+csv.split('\r\n')[1]);
ok(!/4595120538169/.test(csv)&&/4582292602828/.test(csv),
   '★★★注文用CSV に外した行は入らない');
await p.evaluate(()=>{
  window.__clip='';
  try{ Object.defineProperty(navigator,'clipboard',{ configurable:true,
    value:{ writeText:(t)=>{ window.__clip=String(t); return Promise.resolve(); } } });
  }catch(e){}
  mwBuyJanCopy();
});
await p.waitForTimeout(600);
const jc=await p.evaluate(()=>({ clip:window.__clip,
  note:($('csvMwJanNote').textContent||'') }));
console.log('   JANコピー: '+JSON.stringify(jc));
ok(jc.clip==='4582292602828','★★★JAN コピーにも外した行は入らない');
ok(/1件の JAN をコピー/.test(jc.note),'★コピーした件数も出す');

console.log('\n=== すべて外す（確認を出す）===');
await mark('4595120538169',1);
await buyShow();
dlg.length=0;
await p.evaluate(()=>{ mwBuyOffAll(); });
await p.waitForTimeout(600);
v=await view();
console.log('   confirm: '+JSON.stringify(dlg)+' / srv '+JSON.stringify(v.srv));
ok(dlg.length===1&&/すべて外します/.test(dlg[0]),'★★★確認の画面を出す');
ok(Object.keys(v.srv).length===0,'★★★全部外れる');
ok(/すべて外しました/.test(v.undo.text)&&v.undo.show===true,
   '★★まとめて外したあとも「元に戻す」が出る');
const n1=await p.evaluate(()=>window.__posts.length);
await p.evaluate(()=>{ $('mwBuyUndoBtn').click(); });
await p.waitForTimeout(600);
v=await view();
const n2=await p.evaluate(()=>window.__posts.length);
console.log('   戻した: '+JSON.stringify(v.srv)+' / 呼び出し '+(n2-n1)+'回');
ok(v.srv['4595120538169']===1&&v.srv['4582292602828']===2,
   '★★★まとめて戻せる（数量もそのまま）');
ok(n2-n1===1,'★★まとめては1回の呼び出しで送る（items）');

console.log('\n=== 検索は両方の一覧で効く ===');
await load();
await find('ｸﾞﾘｻﾞｲｱ');
let got=await names();
console.log('   候補の一覧「ｸﾞﾘｻﾞｲｱ（半角）」: '+JSON.stringify(got));
ok(got.length===1&&got[0]==='4582292602828',
   '★★★候補の一覧で当たる（全角と半角をそろえる）');
await buyShow();
got=await names();
let fn=await p.evaluate(()=>($('mwAmzFindNote').textContent||'')
  .replace(/\s+/g,' '));
console.log('   仕入れる一覧: '+JSON.stringify(got)+' / '+fn.slice(0,40));
ok(got.length===1&&got[0]==='4582292602828',
   '★★★仕入れる一覧でも当たる（6.125）');
ok(/当たったのは 1件/.test(fn)&&/全2件/.test(fn),
   '★★★件数を出す（仕入れる一覧の全件のうち）');
ok(await p.evaluate(()=>getComputedStyle($('mwAmzFindClear')).display!=='none'),
   '★★「×」が出る');
await find('MC02 グリザイア');
got=await names();
ok(got.length===1,'★★空白で区切ると AND（社＋商品名）');
await find('B0FVLXGFMH');
got=await names();
console.log('   ASIN で: '+JSON.stringify(got));
ok(got.length===1&&got[0]==='4595120538169','★★★ASIN でも当たる');
await p.evaluate(()=>{ $('mwAmzFindClear').click(); });
await p.waitForTimeout(300);
ok((await names()).length===2,'★「×」で戻る（仕入れる一覧の2件）');

console.log('\n=== 検索と絞り込みの組み合わせ ===');
/* 「黒字のみ」は既定でオン。外すと赤字の行も出る。 */
await p.evaluate(()=>{ mwAmzRender(); $('csvMwAmzWin').checked=false;
  $('csvMwAmzWin').dispatchEvent(new Event('change')); });
await p.waitForTimeout(300);
await find('赤字');
got=await names();
let fn0=await p.evaluate(()=>($('mwAmzFindNote').textContent||'').replace(/\s+/g,' '));
console.log('   赤字（黒字のみを外す）: '+JSON.stringify(got)+' / '+fn0.slice(0,30));
ok(got.length===1,'★赤字の行に当たる');
ok(!/絞り込みで隠れている/.test(fn0),'★隠れている行が無ければ出さない');
await p.evaluate(()=>{ $('csvMwAmzWin').checked=true;
  $('csvMwAmzWin').dispatchEvent(new Event('change')); });
await p.waitForTimeout(300);
got=await names();
fn=await p.evaluate(()=>($('mwAmzFindNote').textContent||'').replace(/\s+/g,' '));
console.log('   黒字のみ: '+JSON.stringify(got)+' / '+fn);
ok(got.length===0,'★★黒字のみにすると消える（絞り込みと組み合わせ）');
ok(/絞り込みで隠れている 1件/.test(fn),
   '★★★「絞り込みで隠れている n件」と出す');
await p.evaluate(()=>{ mwRankCapSet({ 'ゲーム':10000 }); $('csvMwAmzWin').checked=false;
  $('csvMwAmzWin').dispatchEvent(new Event('change')); });
await p.waitForTimeout(300);
fn=await p.evaluate(()=>($('mwAmzFindNote').textContent||'').replace(/\s+/g,' '));
console.log('   ランキングの上限: '+fn);
ok(/絞り込みで隠れている 1件/.test(fn),
   '★★★ランキングの上限で隠れた行も数える');
await p.evaluate(()=>{ mwRankCapSet({}); mwAmzRender(); });
await find('');

console.log('\n=== 作業者用の端末でも外せる ===');
await setup('staff');
await openCsvBoxes(p);
await load();
await mark('4582292602828',2);
await buyShow();
v=await view();
console.log('   外す '+JSON.stringify(v.offs)+' / '+JSON.stringify(v.srv));
ok(v.offs.length===1,'★★★作業者用の端末でも「外す」が出る');
await p.evaluate(()=>{ document.querySelector(
  '#csvMwAmzList [data-buyoff]').click(); });
await p.waitForTimeout(500);
v=await view();
console.log('   '+JSON.stringify(v.srv)+' / '+v.undo.text);
ok(Object.keys(v.srv).length===0,'★★★作業者用の端末でも外せる（印と同じ扱い）');
ok(v.undo.show===true,'★「元に戻す」も出る');
await T.done();
})();
