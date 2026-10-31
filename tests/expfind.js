/* 画面：説明文を畳む／一覧のすぐ上の検索欄／並べ替えの見出し（6.126）
   1. 長い説明文は「説明 ▸」の1行に畳む。既定は畳んだ状態で、開いたかどうかは
      端末に覚える。ボタンの名前・件数・進み具合・エラーの知らせは畳まない
   2. Amazon刈取の検索欄（📷つき）を一覧のすぐ上にも置き、タブの上のものと
      連動させる（どちらに入れても同じ結果）。下にスクロールしても残る（sticky）
   3. 並べ替えを変えたら、その場で並べ直して見出しもそろえる */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：説明の畳み・一覧上の検索・並べ替えの見出し');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const base={ sha:'M200', cond:'新品', stock:9, note:'', ship_text:'即日出荷',
  ship_days:0, basis:'カート', new_n:4, low_n:1, amz:0, fba_n:3, amz_err:'',
  amz_at:'2026-10-30T01:00:00Z', rst:'ok', list_price:9800 };
const ROWS=[
 Object.assign({},base,{ jan:'4595120538169', kishu:'NS', mw_name:'千銃士 限定版',
   asin:'B0FVLXGFMH', amz_name:'千銃士 限定版', wholesale:12000, price:24829,
   rank:900000, rank_cat:'ゲーム' }),
 Object.assign({},base,{ jan:'4582292602828', kishu:'figure', sha:'MC02',
   mw_name:'グリザイア トーカ', asin:'B0B98TXLKY', amz_name:'グリザイア 1/6',
   wholesale:4000, price:26799, rank:2310, rank_cat:'ホビー' })];
const META={ ok:true, n:2, rows:ROWS, seen:2, priced:2, left:0, per_run:120,
  ttl_days:3, limit:3000 };
const setup=async()=>await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='5';
  $('mwKishu').value='NS,figure'; $('mwAmzFeeGame').value='15';
  $('mwAmzFbaGame').value='530'; $('mwAmzFeeHobby').value='10';
  $('mwAmzFbaHobby').value='580';
  window.__buy={};
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/mw\/buy/.test(url)&&i&&i.method==='POST'){
      (b.items||[{jan:b.jan,qty:b.qty}]).forEach((x)=>{
        if(+x.qty>0)window.__buy[String(x.jan)]=+x.qty;
        else delete window.__buy[String(x.jan)]; });
      return new Response(JSON.stringify({ok:true}),{status:200});
    }
    if(/\/mw\/buy/.test(url)){
      const rows=Object.keys(window.__buy).map((j)=>{
        const r=(META.rows||[]).filter((x)=>String(x.jan)===j)[0]||{};
        return { jan:j, qty:window.__buy[j], mw_name:r.mw_name||'', sha:r.sha||'',
          wholesale:r.wholesale||0, stock:9, ship_days:0, asin:r.asin||'',
          price:r.price||0, gone_at:null }; });
      return new Response(JSON.stringify({ok:true,rows:rows,n:rows.length,gone:0}),
        {status:200});
    }
    if(/\/mw\/amz/.test(url))
      return new Response(JSON.stringify(META),{status:200});
    return real(u,i);
  };
  roleApply(); switchTab('F');
},META);
const load=async()=>{ await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
  await p.waitForTimeout(400); };
const names=()=>p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('#csvMwAmzList > div'),
  (el)=>((el.innerText||'').match(/\b\d{13}\b/)||[''])[0]).filter(Boolean));

console.log('=== 1. 長い説明文を畳む ===');
await setup();
await openCsvBoxes(p);
const exp=await p.evaluate(()=>{
  const all=Array.prototype.map.call(document.querySelectorAll('details.exp'),(d)=>({
    key:d.getAttribute('data-exp'), open:d.open,
    sum:(d.querySelector('summary').textContent||'').trim(),
    len:(d.textContent||'').replace(/\s+/g,'').length,
    tab:['tabCsv','tabSync','tabPricing','tabListing','tabAmz']
      .filter((t)=>$(t)&&$(t).contains(d)).join() }));
  return { n:all.length, all:all };
});
console.log('   '+exp.n+'件: '+JSON.stringify(exp.all.map((x)=>x.key)));
ok(exp.n>=12,'★★長い説明文が畳める形になっている');
ok(exp.all.every((x)=>x.open===false),'★★★既定は畳んだ状態');
ok(exp.all.every((x)=>x.sum==='説明'),'★★★「説明」の1行で畳む');
const tabs=exp.all.map((x)=>x.tab);
console.log('   タブ: '+JSON.stringify(Array.from(new Set(tabs))));
['tabAmz','tabCsv','tabSync'].forEach(function(t){
  ok(tabs.indexOf(t)>=0,'★'+t+' の説明文も畳める');
});
ok(tabs.filter((t)=>t==='tabAmz').length>=4,'★★Amazon刈取の説明文は4つ以上');
ok(tabs.indexOf('tabPricing')>=0||tabs.indexOf('tabListing')>=0,
   '★eBay タブの説明文も畳める');
/* ボタンの名前と知らせは畳まない */
const vis=await p.evaluate(()=>{
  switchTab('F');
  const inExp=(id)=>{ const el=$(id); return !!(el&&el.closest('details.exp')); };
  return { btns:['csvMwAmz','csvMwAmzLoad','csvMwBuyShow','csvMwReg','csvMwPut',
      'csvMwJanCopy','csvMwAmzCsv','csvMwBuyCsv'].filter(inExp),
    notes:['csvMwAmzNote','csvMwAmzListNote','csvMwRegNote','csvMwPutNote',
      'csvMwJanNote','csvMwBuyBar','mwAmzFindNote'].filter(inExp) };
});
console.log('   '+JSON.stringify(vis));
ok(vis.btns.length===0,'★★★ボタンの名前は畳まない');
ok(vis.notes.length===0,'★★★件数・進み具合・エラーの知らせは畳まない');
/* 開いたかどうかを端末に覚える */
await p.evaluate(()=>{
  const d=document.querySelector('#tabAmz details.exp[data-exp="amzGo"]');
  d.open=true; d.dispatchEvent(new Event('toggle'));
});
await p.waitForTimeout(200);
const kept=await p.evaluate(()=>localStorage.getItem('pj:exp:v1'));
console.log('   覚え: '+kept);
ok(/amzGo/.test(String(kept)),'★★開いたことを端末に覚える');
await p.reload(); await p.waitForTimeout(400);
const after=await p.evaluate(()=>({
  one:document.querySelector('#tabAmz details.exp[data-exp="amzGo"]').open,
  other:document.querySelector('#tabAmz details.exp[data-exp="amzRank"]').open }));
console.log('   開き直し: '+JSON.stringify(after));
ok(after.one===true,'★★★次に開いたときも開いたまま');
ok(after.other===false,'★★ほかの説明は畳んだまま');
await p.evaluate(()=>{
  const d=document.querySelector('#tabAmz details.exp[data-exp="amzGo"]');
  d.open=false; d.dispatchEvent(new Event('toggle'));
});
await p.waitForTimeout(200);
ok(!/amzGo/.test(String(await p.evaluate(()=>localStorage.getItem('pj:exp:v1')))),
   '★畳み直せば覚えも消える');

console.log('\n=== 2. 一覧のすぐ上の検索欄 ===');
await setup();
await openCsvBoxes(p);
await load();
const place=await p.evaluate(()=>{
  const bar=$('mwAmz2FindBar'), list=$('csvMwAmzList'), note=$('csvMwAmzListNote');
  const cs=getComputedStyle(bar);
  return { has:!!bar, cam:!!$('mwAmz2FindCam'), clr:!!$('mwAmz2FindClear'),
    beforeList:!!(bar.compareDocumentPosition(list)&Node.DOCUMENT_POSITION_FOLLOWING),
    beforeNote:!!(bar.compareDocumentPosition(note)&Node.DOCUMENT_POSITION_FOLLOWING),
    sticky:cs.position, top:cs.top, inTab:$('tabAmz').contains(bar) };
});
console.log('   '+JSON.stringify(place));
ok(place.has&&place.cam&&place.clr,'★★★一覧のすぐ上に検索欄と📷がある');
ok(place.beforeList&&place.beforeNote,'★★★一覧より前にある');
ok(place.sticky==='sticky','★★★スクロールしても画面の上に残る（sticky）');
ok(place.inTab,'Amazon刈取タブの中');
/* 下の欄に入れると上の欄にも入り、同じ結果になる */
await p.evaluate(()=>{ $('mwAmz2Find').value='グリザイア';
  $('mwAmz2Find').dispatchEvent(new Event('change')); });
await p.waitForTimeout(300);
let v=await p.evaluate(()=>({ top:$('mwAmzFind').value, bottom:$('mwAmz2Find').value,
  note1:($('mwAmzFindNote').textContent||'').replace(/\s+/g,' '),
  note2:($('mwAmz2FindNote').textContent||'').replace(/\s+/g,' '),
  clr1:getComputedStyle($('mwAmzFindClear')).display!=='none',
  clr2:getComputedStyle($('mwAmz2FindClear')).display!=='none' }));
let got=await names();
console.log('   下の欄に入れた: '+JSON.stringify(got)+' / 上の欄 '+v.top);
ok(got.length===1&&got[0]==='4582292602828','★★★下の欄で絞り込める');
ok(v.top==='グリザイア','★★★上の欄にも同じ言葉が入る（連動）');
ok(/当たったのは 1件/.test(v.note1)&&/当たったのは 1件/.test(v.note2),
   '★★★件数は両方に出る');
ok(v.clr1&&v.clr2,'★「×」も両方に出る');
/* 上の欄に入れても同じ */
await p.evaluate(()=>{ $('mwAmzFind').value='B0FVLXGFMH';
  $('mwAmzFind').dispatchEvent(new Event('change')); });
await p.waitForTimeout(300);
v=await p.evaluate(()=>({ bottom:$('mwAmz2Find').value }));
got=await names();
console.log('   上の欄に入れた: '+JSON.stringify(got)+' / 下の欄 '+v.bottom);
ok(got.length===1&&got[0]==='4595120538169','★★上の欄でも絞り込める');
ok(v.bottom==='B0FVLXGFMH','★★★下の欄にも入る（連動）');
/* 「×」はどちらからでも消せる */
await p.evaluate(()=>{ $('mwAmz2FindClear').click(); });
await p.waitForTimeout(300);
v=await p.evaluate(()=>({ top:$('mwAmzFind').value, bottom:$('mwAmz2Find').value }));
ok(v.top===''&&v.bottom==='','★★★下の「×」で両方消える');
ok((await names()).length===2,'★全部戻る');
/* 仕入れる一覧でも効く */
await p.evaluate(()=>{ mwBuySet('4582292602828',1); });
await p.waitForTimeout(400);
await p.evaluate(()=>{ $('csvMwBuyShow').click(); });
await p.waitForTimeout(400);
await p.evaluate(()=>{ $('mwAmz2Find').value='4595120538169';
  $('mwAmz2Find').dispatchEvent(new Event('change')); });
await p.waitForTimeout(300);
got=await names();
console.log('   仕入れる一覧で別の JAN を探す: '+JSON.stringify(got));
ok(got.length===0,'★★仕入れる一覧でも下の欄が効く');
await p.evaluate(()=>{ $('mwAmz2FindClear').click(); });
await p.waitForTimeout(300);
/* 📷で読んだ JAN は押した欄に入る（v212 までは販売連携の欄に入っていた） */
const cam=await p.evaluate(()=>{
  const r={};
  ['amz','amz2'].forEach(function(w){
    $(findPre(w)).value=''; $('syncFind').value='';
    /* カメラの読み取りと同じところだけを呼ぶ */
    $(findPre(w)).value='4595120538169'; findRun(w);
    r[w]={ self:$(findPre(w)).value, twin:$(findPre(w==='amz'?'amz2':'amz')).value,
      sync:$('syncFind').value };
    $(findPre(w)).value=''; findRun(w);
  });
  return r;
});
console.log('   '+JSON.stringify(cam));
ok(cam.amz2.self==='4595120538169'&&cam.amz2.twin==='4595120538169',
   '★★★下の欄に入れた JAN は上の欄にも入る');
ok(cam.amz.sync===''&&cam.amz2.sync==='',
   '★★★販売連携の検索欄には入れない（v212 までの取り違えを直した）');

console.log('\n=== 3. 並べ替えの見出し ===');
await setup();
await openCsvBoxes(p);
await load();
const head=async(v)=>{
  await p.evaluate((v)=>{ $('csvMwAmzSort').value=v;
    $('csvMwAmzSort').dispatchEvent(new Event('change')); },v);
  await p.waitForTimeout(300);
  return p.evaluate(()=>({
    head:(($('csvMwAmzList').innerText||'').split('\n')[0]||'').trim(),
    order:Array.prototype.map.call(document.querySelectorAll('#csvMwAmzList > div'),
      (el)=>((el.innerText||'').match(/\b\d{13}\b/)||[''])[0]).filter(Boolean) }));
};
let h=await head('net');
console.log('   net: '+h.head+' / '+JSON.stringify(h.order));
ok(/粗利（税抜）の高い順/.test(h.head),'★既定は「粗利（税抜）の高い順」');
h=await head('rank');
console.log('   rank: '+h.head+' / '+JSON.stringify(h.order));
ok(/ランキング順/.test(h.head)&&/大分類・売れている順/.test(h.head),
   '★★★ランキング順にすると見出しもそろう');
ok(!/粗利（税抜）の高い順/.test(h.head),'★★★「粗利の高い順」のままにしない');
ok(h.order[0]==='4582292602828'&&h.order[1]==='4595120538169',
   '★★★その場で並べ直す（2,310位 → 900,000位）');
h=await head('margin');
console.log('   margin: '+h.head);
ok(/利益率の高い順/.test(h.head),'★★利益率順の見出し');
/* 仕入れる一覧を見ているときに並べ替えを変えたら、候補の一覧に戻して並べ直す */
await p.evaluate(()=>{ $('csvMwBuyShow').click(); });
await p.waitForTimeout(400);
h=await head('rank');
console.log('   仕入れる一覧から: '+h.head);
ok(/ランキング順/.test(h.head),
   '★★★仕入れる一覧を見ていても、並べ替えを変えれば候補の一覧で並べ直す');
await T.done();
})();
