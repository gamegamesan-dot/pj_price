/* 画面：MW在庫の取り込みが途中で切れたときの送り直し（6.100）
   iPhone の Safari はアプリを切り替えると動いている fetch を切るので、
   「通信できませんでした（Load failed）」で止まっていた。
   ・取り込み中は上に「この画面を開いたままにしてください」を出す
   ・切れたら失敗した便を覚えて、画面に戻ったとき（visibilitychange）に
     **その便から**自動で送り直す（送れた便は送り直さない）
   ・「続きから送り直す」ボタンでも同じことができる */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：取り込みの送り直し');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

/* 3便（MW_SEND_MAX=400）になる行数を作る。 */
const mkCsv=async()=>await p.evaluate(()=>{
  const head='社,JAN,商品名,定価,発売日,状態,卸値,在庫,備考,出荷日';
  const rows=[];
  for(let i=0;i<900;i++){
    /* JAN は13桁。頭を 49 にして末尾を連番にする。 */
    const j='49'+String(100000000000+i).slice(0,11);
    rows.push('M200,'+j+',商品'+i+',5000,2025/01/01,新品,3000,9,,即日出荷');
  }
  return head+'\n'+rows.join('\n')+'\n';
});

const setup=async()=>await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176';
  window.__sent=[]; window.__fail={};
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/mw\/stock/.test(url)&&i&&i.method==='POST'){
      window.__sent.push({part:b.part,parts:b.parts,n:(b.rows||[]).length});
      if(window.__fail[b.part]){
        /* iPhone でアプリを切り替えたときと同じ切れ方。 */
        throw new TypeError('Load failed');
      }
      return new Response(JSON.stringify({ok:true,added:(b.rows||[]).length,
        changed:0,same:0,skipped:0,gone:0,back:0,picked:b.part*10,
        seen:(b.rows||[]).length}),{status:200});
    }
    if(/\/mw\/list/.test(url))
      return new Response(JSON.stringify({ok:true,rows:[],n:0}),{status:200});
    return real(u,i);
  };
  switchTab('D'); roleApply(); csvRender();
});

console.log('=== 取り込み中の案内 ===');
await setup();
await openCsvBoxes(p);
const CSV=await mkCsv();
ok(await p.evaluate(()=>!!document.getElementById('csvMwSendBar')),
   '★案内の場所がある');
/* 2便目で切る */
await p.evaluate((CSV)=>{ window.__fail={2:true}; mwImportRun(CSV,null); },CSV);
await p.waitForTimeout(600);
let sent=await p.evaluate(()=>window.__sent);
console.log('   送った便: '+JSON.stringify(sent));
ok(sent.length===2&&sent[0].part===1&&sent[1].part===2,'★★2便目で止まる');
ok(sent[0].parts===3,'★3便に分かれる（400行ずつ）');
let bar=await p.evaluate(()=>({ show:$('csvMwSendBar').style.display!=='none',
  html:$('csvMwSendBar').innerHTML }));
console.log('   '+bar.html.replace(/<[^>]*>/g,'').slice(0,90));
ok(bar.show===true,'★★止まったら上に出す');
ok(/途中で止まりました/.test(bar.html),'★★★止まったことを知らせる');
ok(/続きから送り直す/.test(bar.html),'★★★送り直すボタンを出す');
let n=await p.evaluate(()=>$('csvMwNote').textContent);
console.log('   '+n.replace(/\s+/g,' ').slice(0,120));
ok(/2便目で失敗/.test(n),'★★何便目で失敗したか出す');
ok(/Load failed/.test(n),'★原因も出す');
ok(/自動で送り直します/.test(n),'★★★画面に戻れば続くと伝える');
ok(await p.evaluate(()=>mwSend&&mwSend.pi===1),
   '★★★失敗した便（2便目＝pi 1）を覚えている');

console.log('\n=== 画面に戻ると、その便から送り直す ===');
await p.evaluate(()=>{ window.__sent=[]; window.__fail={}; });
/* iPhone でアプリから戻ったときと同じ（hidden → 見える）。 */
await p.evaluate(()=>{
  Object.defineProperty(document,'hidden',{value:true,configurable:true});
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForTimeout(100);
ok((await p.evaluate(()=>window.__sent)).length===0,
   '★★隠れただけでは送らない');
await p.evaluate(()=>{
  Object.defineProperty(document,'hidden',{value:false,configurable:true});
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForTimeout(900);
sent=await p.evaluate(()=>window.__sent);
console.log('   送り直した便: '+JSON.stringify(sent.map((x)=>x.part)));
ok(sent.length===2&&sent[0].part===2&&sent[1].part===3,
   '★★★失敗した2便目から送り直す（1便目は送り直さない）');
let done=await p.evaluate(()=>$('csvMwNote').textContent);
console.log('   '+done.replace(/\s+/g,' ').slice(0,100));
ok(/900行を送りました/.test(done),'★★★最後まで送れる');
ok(await p.evaluate(()=>$('csvMwSendBar').style.display==='none'),
   '★★終わったら案内を消す');
ok(await p.evaluate(()=>mwSend===null),'★★終わったら覚えを捨てる');
ok(await p.evaluate(()=>$('csvMwImport').disabled===false),
   '★ボタンを押せる状態に戻す');

console.log('\n=== 二重に送らない ===');
await p.evaluate(()=>{
  Object.defineProperty(document,'hidden',{value:false,configurable:true});
  document.dispatchEvent(new Event('visibilitychange'));
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForTimeout(300);
ok((await p.evaluate(()=>window.__sent)).length===2,
   '★★★終わったあとに戻っても送り直さない');
/* 動いている途中（why が空）なら戻っても二重に送らない */
await p.evaluate((CSV)=>{ window.__sent=[]; window.__fail={};
  mwImportRun(CSV,null); },CSV);
await p.evaluate(()=>{
  Object.defineProperty(document,'hidden',{value:false,configurable:true});
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForTimeout(900);
let all=await p.evaluate(()=>window.__sent.map((x)=>x.part));
console.log('   '+JSON.stringify(all));
ok(all.length===3&&all.join(',')==='1,2,3',
   '★★★動いている途中に戻っても二重に送らない');

console.log('\n=== ボタンでも送り直せる ===');
await p.evaluate((CSV)=>{ window.__sent=[]; window.__fail={3:true};
  mwImportRun(CSV,null); },CSV);
await p.waitForTimeout(900);
ok((await p.evaluate(()=>window.__sent.length))===3,'★3便目で止まる');
await p.evaluate(()=>{ window.__sent=[]; window.__fail={};
  $('csvMwResume').click(); });
await p.waitForTimeout(900);
sent=await p.evaluate(()=>window.__sent.map((x)=>x.part));
console.log('   '+JSON.stringify(sent));
ok(sent.length===1&&sent[0]===3,'★★★ボタンで3便目だけ送り直す');
let b2=await p.evaluate(()=>$('csvMwSendBar').innerHTML);
ok(/開いたままに/.test(b2)===false&&
   await p.evaluate(()=>$('csvMwSendBar').style.display==='none'),
   '★★送り終われば案内を消す');

await T.done();
})();
