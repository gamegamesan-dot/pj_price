/* 画面：MW の在庫CSVの取り込みは、どのタブからでもできる（6.123）
   v207 でタブの上に置いたボタンは、**隠れたタブの中**のファイル選択を
   開いていた。iPhone では隠れている（display:none の親の中の）input では
   ファイルを選べないので、押しても何も起きなかった。
   取り込みの知らせも出品CSVタブの中だけに出していたので、
   ほかのタブからは何も見えなかった。
   ・ファイル選択はタブの上（どのタブでも見える場所）に1つだけ
   ・ボタンは2つあるが、開く口も処理（mwFilePick → mwImportRun）も1つ
   ・知らせ（読んだ結果・送信中・終わり・途中で止まった）は両方に出す
   ・同じ名前のファイルを選び直しても取り込める（input の値を空に戻す）
   ・タブに置いたボタンが処理につながっていることを、押して確かめる */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：MW取り込みはどのタブからでも');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });
/* 押したときに結び付いているかを見るため、addEventListener を控える。 */
await p.addInitScript(()=>{
  window.__listen={};
  const real=EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener=function(t,f,o){
    try{
      const id=this&&this.id;
      if(id){ (window.__listen[id]=window.__listen[id]||[]).push(String(t)); }
    }catch(e){}
    return real.call(this,t,f,o);
  };
});
await p.reload();
await p.waitForTimeout(400);

const CSV='社,JAN,機種,商品名,定価,発売日,新・中,卸値,掲載数,備考,出荷日\n'
  +'M200,4902370550467,NS,商品A,5000,2025/01/01,新品,3000,9,,即日出荷\n'
  +'M200,4580033110113,figure,商品B,4000,2025/02/01,新品,1200,8,,即日出荷\n';
const setup=async()=>await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwKishu').value='NS,figure';
  window.__sent=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/mw\/stock/.test(url)&&i&&i.method==='POST'){
      window.__sent.push({part:b.part,n:(b.rows||[]).length});
      return new Response(JSON.stringify({ok:true,added:(b.rows||[]).length,
        changed:0,same:0,skipped:0,gone:0,back:0,picked:(b.rows||[]).length,
        seen:(b.rows||[]).length}),{status:200});
    }
    if(/\/mw\/(list|amz|buy)/.test(url))
      return new Response(JSON.stringify({ok:true,rows:[],n:0}),{status:200});
    return real(u,i);
  };
  roleApply();
});
const put=async()=>await p.setInputFiles('#csvMwFile',
  { name:'mw_stock.csv', mimeType:'text/csv', buffer:Buffer.from(CSV,'utf8') });
/* 無い欄（直す前の版）でも落ちずに ❌ になるように、そっと読む。 */
const seen=()=>p.evaluate(()=>{
  const g=(id)=>document.getElementById(id);
  const tx=(id)=>((g(id)||{}).textContent||'').replace(/\s+/g,' ');
  const dp=(id)=>g(id)?getComputedStyle(g(id)).display:'なし';
  return { sent:window.__sent.length,
    top:{ readTxt:tx('mwTopRead'), msg:tx('mwTopMsg'),
          shown:dp('mwTopRead'), msgShown:dp('mwTopMsg') },
    csv:{ readTxt:tx('csvMwRead'), msg:tx('csvMwNote') },
    value:(g('csvMwFile')||{}).value };
});

console.log('=== ファイル選択の置き場所 ===');
const where=await p.evaluate(()=>{
  const inp=document.getElementById('csvMwFile');
  const vis=(id)=>{ switchTab(id); return !!$('mwTopWrap').offsetParent
    &&getComputedStyle($('mwTopImport')).display!=='none'; };
  const r={ inTabCsv:!!inp.closest('#tabCsv'), inTabAmz:!!inp.closest('#tabAmz'),
    inTop:!!inp.closest('#mwTopWrap'), one:document.querySelectorAll(
      'input[type=file][accept*="csv"]').length };
  r.topVisible={ D:vis('D'), E:vis('E'), A:vis('A'), F:vis('F'), G:vis('G') };
  return r;
});
console.log('   '+JSON.stringify(where));
ok(where.inTop===true,'★★★ファイル選択はタブの上にある（どのタブでも生きている）');
ok(where.inTabCsv===false,
   '★★★隠れるタブの中には置かない（iPhone でファイルを選べなくなる）');
ok(['D','E','A','F','G'].every((k)=>where.topVisible[k]),
   '★★どのタブでもボタンが出ている');

console.log('\n=== Amazon刈取タブから取り込める ===');
await setup();
await p.evaluate(()=>switchTab('F'));
/* 押したら、同じファイル選択が開く（結び付いている）。 */
const click=await p.evaluate(()=>{
  let n=0;
  const inp=$('csvMwFile');
  const h=(e)=>{ n++; e.preventDefault(); };
  inp.addEventListener('click',h);
  $('mwTopImport').click();
  inp.removeEventListener('click',h);
  return { n:n, onclick:typeof $('mwTopImport').onclick };
});
console.log('   '+JSON.stringify(click));
ok(click.onclick==='function','★ボタンに処理が結び付いている');
ok(click.n===1,'★★★押すとファイル選択が開く（同じ口を使う）');
await put();
await p.waitForTimeout(700);
let v=await seen();
console.log('   送った便 '+v.sent+' / 上の知らせ: '+v.top.msg.slice(0,60));
ok(v.sent===1,'★★★Amazon刈取タブからでも pj-sync に送る（処理につながっている）');
ok(/読んだ行数/.test(v.top.readTxt)&&/送る行 2行/.test(v.top.readTxt),
   '★★★「読んだ結果」がタブの上に出る');
ok(v.top.shown!=='none','★★読んだ結果が見えている');
ok(/2行を送りました/.test(v.top.msg),'★★★終わったことがタブの上に出る');
ok(v.top.msgShown!=='none','★★知らせが見えている');
ok(/2行を送りました/.test(v.csv.msg),'★出品CSVタブの中にも同じことを出す');

console.log('\n=== 同じ名前のファイルを選び直しても取り込める ===');
console.log('   選んだあとの input の値: '+JSON.stringify(v.value));
ok(v.value==='','★★★選んだあとに input の値を空に戻す');
await p.evaluate(()=>{ window.__sent=[]; });
await put();
await p.waitForTimeout(700);
v=await seen();
console.log('   2回目: 送った便 '+v.sent);
ok(v.sent===1,'★★★同じファイルをもう一度選んでも取り込む');

console.log('\n=== 出品CSVタブのボタンも今までどおり ===');
await p.evaluate(()=>{ window.__sent=[]; switchTab('D'); });
await openCsvBoxes(p);
const click2=await p.evaluate(()=>{
  let n=0;
  const inp=$('csvMwFile');
  const h=(e)=>{ n++; e.preventDefault(); };
  inp.addEventListener('click',h);
  $('csvMwImport').click();
  inp.removeEventListener('click',h);
  return n;
});
ok(click2===1,'★★中のボタンも同じ口を開く');
await put();
await p.waitForTimeout(700);
v=await seen();
ok(v.sent===1&&/2行を送りました/.test(v.csv.msg),'★★出品CSVタブからも取り込める');

console.log('\n=== 取り込み中はどちらのボタンも押せない ===');
const busy=await p.evaluate(()=>{
  if(typeof mwImportBusy!=='function')return { top:false, csv:false, after:'' };
  mwImportBusy(true);
  const a={ top:$('mwTopImport').disabled, csv:$('csvMwImport').disabled };
  mwImportBusy(false);
  a.after=[$('mwTopImport').disabled,$('csvMwImport').disabled].join();
  return a;
});
console.log('   '+JSON.stringify(busy));
ok(busy.top===true&&busy.csv===true,'★★★2つとも押せなくする（二重に送らない）');
ok(busy.after==='false,false','★終わったら両方戻す');

console.log('\n=== 途中で止まった案内も両方に ===');
const bar=await p.evaluate(()=>{
  mwSendBarShow(true,true);
  const g=(id)=>document.getElementById(id)||{innerHTML:'',style:{}};
  return { top:g('mwTopSendBar').innerHTML, csv:g('csvMwSendBar').innerHTML,
    btnTop:!!document.getElementById('mwTopResume'),
    btnCsv:!!document.getElementById('csvMwResume') };
});
ok(/途中で止まりました/.test(bar.top)&&/途中で止まりました/.test(bar.csv),
   '★★★止まったことを両方に出す');
ok(bar.btnTop&&bar.btnCsv,'★★「続きから送り直す」はどちらからでも押せる');
const off=await p.evaluate(()=>{
  mwSendBarShow(false);
  const g=(id)=>document.getElementById(id)||{style:{}};
  return [g('mwTopSendBar').style.display,g('csvMwSendBar').style.display].join();
});
ok(off==='none,none','★終わったら両方消す');

console.log('\n=== タブに置いたボタンが結び付いているか（v186・v207 の見落とし）===');
const wired=await p.evaluate(()=>{
  const seen=window.__listen||{};
  const list=[];
  document.querySelectorAll('#mwTopWrap button, #tabAmz button').forEach((b)=>{
    if(!b.id)return;
    if(b.closest('#csvMwAmzList'))return;          // 一覧の中は出し直しで作る
    const has=(typeof b.onclick==='function')
      ||((seen[b.id]||[]).indexOf('click')>=0);
    list.push({ id:b.id, ok:has });
  });
  return list;
});
const ng=wired.filter((x)=>!x.ok).map((x)=>x.id);
console.log('   見たボタン '+wired.length+'個／結び付いていない '+JSON.stringify(ng));
ok(wired.length>=8,'★タブの上と Amazon刈取タブのボタンを見ている');
ok(ng.length===0,'★★★押しても何も起きないボタンが無い：'+JSON.stringify(ng));
await T.done();
})();
