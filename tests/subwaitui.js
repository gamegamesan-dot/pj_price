/* 画面：書き直しの結果の言い方（8.39・カジの確認・v298）
   ① 書き直しの結果に「書き換え◯件／まだ出していないカード◯件
      （全プランに配るで出せます）」が出る
   ② 書き直しなのに新しく出てしまったとき（pj-sync が古いとき）は
      「新しく出した◯件（会員に通知が鳴りました）」とはっきり出す
   ③ 確認の文にも「まだ出していないカードは出しません」と書く */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：書き直しの結果の言い方（8.39）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[];
p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

const PLAN=()=>({ ok:true, table_ok:true, token:true, day:'2026-11-15',
  skip:false, on:true, hour:8, pre:true, domain:'x.myshopify.com', rows:2,
  plans:[{ key:'monitor', name:'モニター', on:true, ch:'111',
    ch_name:'リスト-モニター', n:10, q:1, kinds:'game', add:0, edit:0,
    keep:0, why:'', items:[] }] });
const setup=async(send)=>{
  await p.evaluate((send)=>{
    $('syncApi').value='https://sync.example'; $('syncKey').value='k';
    window.__q=[]; window.__send=send;
    window.fetch=async(u,i)=>{
      const url=String(u), b=(i||{}).body;
      const res=(x)=>new Response(JSON.stringify(x),{status:200});
      if(/\/whoami/.test(url))
        return res({ ok:true, role:'admin', staff_key_set:true });
      if(/\/sub\/plan/.test(url))return res(window.__plan);
      if(/\/sub\/send/.test(url)){
        window.__q.push({ u:'send', b:JSON.parse(String(b||'{}')) });
        return res(window.__send);
      }
      if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, n:0, rows:[] });
      if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
      return res({ ok:true });
    };
    syncRole='admin'; roleApply(); switchTab('F');
  },send);
  await p.waitForTimeout(80);
};

console.log('=== ① カジの回（書き換え59・まだ出していない17・消えていた1）===');
await setup({ ok:true, sent:0, edited:59, skipped:0, fail:0, gone:1, wait:17,
              left:0 });
await openCsvBoxes(p);
await p.evaluate((d)=>{ window.__plan=d; },PLAN());
{
  dlg=[];
  await p.evaluate(async()=>{ await subRedoGo(); });
  await p.waitForTimeout(500);
  const t=await p.evaluate(()=>
    ($('subNote').textContent||'').replace(/\s+/g,' '));
  console.log('   '+t.slice(0,260));
  ok(/書き換え 59件/.test(t),'★★★書き換えた件数を出す');
  ok(/まだ出していないカード 17件/.test(t),
     '★★★「新しく」ではなく「まだ出していないカード」と出す');
  ok(/全プランに配る/.test(t),'★★★どこから出せるかを書く');
  ok(/通知が鳴ります/.test(t),'★★出すと通知が鳴ることも書く');
  ok(!/新しく 17件/.test(t),'★★★「新しく◯件」とは出さない（出していないので）');
  ok(/消えていたカード 1件/.test(t),'★★消えていたカードは今までどおり出す');
  ok(dlg.some((m)=>/まだ出していないカードは出しません/.test(m)),
     '★★★押す前の確認にも「出しません」と書く');
}

console.log('=== ② 新しく出てしまったとき（pj-sync が古い）===');
{
  await p.evaluate(()=>{ window.__send={ ok:true, sent:17, edited:59,
    skipped:0, fail:0, gone:0, wait:0, left:0 }; });
  dlg=[];
  await p.evaluate(async()=>{ await subRedoGo(); });
  await p.waitForTimeout(500);
  const t=await p.evaluate(()=>
    ($('subNote').textContent||'').replace(/\s+/g,' '));
  console.log('   '+t.slice(0,220));
  ok(/新しく出した 17件/.test(t),'★★★新しく出した件数をはっきり出す');
  ok(/会員に通知が鳴りました/.test(t),'★★★通知が鳴ったことを書く');
  ok(/deploy-pj-sync/.test(t),'★★どうすればよいかを書く');
}

console.log('=== ③ 出していないカードが無いときは出さない ===');
{
  await p.evaluate(()=>{ window.__send={ ok:true, sent:0, edited:3,
    skipped:0, fail:0, gone:0, wait:0, left:0 }; });
  await p.evaluate(async()=>{ await subRedoGo(); });
  await p.waitForTimeout(500);
  const t=await p.evaluate(()=>
    ($('subNote').textContent||'').replace(/\s+/g,' '));
  console.log('   '+t.slice(0,120));
  ok(/書き換え 3件/.test(t)&&!/まだ出していないカード/.test(t)
     &&!/新しく出した/.test(t),'★★★0件のときは余計な行を出さない');
}

await T.done();
})();
