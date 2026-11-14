/* 画面：書き直し・今すぐ送るを続きから（8.33・カジの報告・v291）
   「送ったカードをすべて今の形で書き直す」を押したら
   「通信できませんでした（Load failed）」と出た（書き換え 51件・iPhone）。
   pj-sync は1枚ごとに間隔をあけるので、51件だと1分を超えて端末側で切れる。
   ① 残り（left）があれば**続きを頼む**（45秒で区切られるため）
   ② 通信が切れたら「pj-sync 側では続いているかもしれません」と出す
   ③ 結果に「書き換え◯件・残り◯件・失敗◯件」を出す
   ④ 「今すぐ送る」も同じしかけ */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：書き直しを続きから（8.33）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__q=[]; window.__plan={ ok:true, table_ok:true, token:true,
    day:'2026-11-15', on:true, hour:8, pre:true, rows:0, plans:[], auto:null };
  /* 返す中身は __reply（配列）から順に取る。 */
  window.__reply=[];
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body;
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/sub\/plan/.test(url))return res(window.__plan);
    if(/\/sub\/send/.test(url)){
      window.__q.push({ u:'send', b:JSON.parse(String(b||'{}')) });
      const r=(window.__reply||[]).shift();
      if(!r)return res({ ok:true, sent:0, edited:0, skipped:0, fail:0, left:0 });
      if(r.net)throw new TypeError('Load failed');
      return res(r);
    }
    if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, rows:[] });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
});
await openCsvBoxes(p);

console.log('=== ① 残りがあれば続きを頼む ===');
{
  const t=await p.evaluate(async()=>{
    /* 51件を 20・20・11 に分けて返す（pj-sync が45秒で区切る形）。 */
    window.__q=[];
    window.__reply=[
      { ok:true, sent:0, edited:20, skipped:0, fail:0, left:31 },
      { ok:true, sent:0, edited:20, skipped:0, fail:0, left:11 },
      { ok:true, sent:0, edited:11, skipped:0, fail:0, left:0 }];
    await subRedoGo();
    return { n:window.__q.filter((x)=>x.u==='send').length,
             b:window.__q.filter((x)=>x.u==='send').map((x)=>x.b),
             note:($('subNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+t.n+'回　'+t.note);
  ok(t.n===3,'★★★残りがあるあいだ続きを頼む（3回に分かれた）');
  ok(t.b.every((x)=>x.approve===true&&x.redo===true),
     '★★毎回 redo で頼む（続きからになる）');
  ok(/書き換え 51件/.test(t.note),'★★★合計を出す');
  ok(/残り 0件/.test(t.note)&&/失敗 0件/.test(t.note),
     '★★★「残り◯件・失敗◯件」も出す');
  ok(/書き直しました/.test(t.note),'★終わったと分かる');
}

console.log('=== ② 通信が切れたとき ===');
{
  const t=await p.evaluate(async()=>{
    window.__q=[];
    window.__reply=[
      { ok:true, sent:0, edited:20, skipped:0, fail:0, left:31 },
      { net:true }];
    await subRedoGo();
    return { n:window.__q.filter((x)=>x.u==='send').length,
             note:($('subNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+t.note);
  ok(/通信が切れました/.test(t.note)&&/Load failed/.test(t.note),
     '★★★通信が切れたとそう出す');
  ok(/pj-sync 側では続いているかもしれません/.test(t.note)
     &&/少し待ってからもう一度押してください/.test(t.note),
     '★★★「pj-sync 側では続いているかもしれません。少し待ってから…」と出す');
  ok(/書き換え済みのカードは飛ばして続きから/.test(t.note),
     '★★★もう一度押せば続きからだと書く');
  ok(/ここまで：/.test(t.note)&&/書き換え 20件/.test(t.note),
     '★★★ここまで何件できたかを出す');
  ok(t.n===2,'★切れたらそこで止める');
}

console.log('=== ③ 失敗・途中で区切られたとき ===');
{
  const t=await p.evaluate(async()=>{
    window.__q=[];
    window.__reply=[{ ok:true, sent:0, edited:5, skipped:0, fail:1,
                      stopped:'fail', stop_plan:'プレミアム', stop_status:403,
                      left:0 }];
    await subRedoGo();
    const a=($('subNote').textContent||'').replace(/\s+/g,' ');
    /* 上限まで続きを頼んでも残るとき（念のための止め）。 */
    window.__q=[];
    window.__reply=[];
    for(let i=0;i<60;i++)
      window.__reply.push({ ok:true, sent:0, edited:1, skipped:0, fail:0,
                            left:99 });
    await subRedoGo();
    return { fail:a, n:window.__q.filter((x)=>x.u==='send').length,
             many:($('subNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+t.fail);
  ok(/プレミアム/.test(t.fail)&&/止まりました/.test(t.fail),
     '★★★失敗したらどこで止まったかを出す');
  ok(/失敗 1件/.test(t.fail),'★★★「失敗◯件」を出す');
  ok(/もう一度押すと続きからやります/.test(t.fail),'★★続きの案内を出す');
  console.log('   '+t.n+'回　'+t.many.slice(0,80));
  ok(t.n<=40,'★★★続きを頼む回数には上限がある（念のため）');
  ok(/残り 99件/.test(t.many)&&/途中で区切りました/.test(t.many),
     '★★★それでも残ったら「もう一度押すと続きから」と出す');
}

console.log('=== ④ 「今すぐ送る」も同じしかけ ===');
{
  const t=await p.evaluate(async()=>{
    window.__plan={ ok:true, table_ok:true, token:true, day:'2026-11-15',
      on:true, hour:8, pre:true, rows:2, auto:null, plans:[
        { key:'monitor', name:'モニター', on:true, ch:'111', n:10, q:1,
          add:30, edit:0, keep:0, why:'', items:[] }] };
    await subPlanGo(true);
    window.__q=[];
    window.__reply=[
      { ok:true, sent:20, edited:0, skipped:0, fail:0, left:10 },
      { ok:true, sent:10, edited:0, skipped:0, fail:0, left:0 }];
    await subSendGo();
    return { n:window.__q.filter((x)=>x.u==='send').length,
             note:($('subNote').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+t.n+'回　'+t.note);
  ok(t.n===2,'★★★「今すぐ送る」も残りがあれば続きを頼む');
  ok(/新しく 30件/.test(t.note),'★★合計を出す');
  const t2=await p.evaluate(async()=>{
    window.__q=[];
    window.__reply=[{ net:true }];
    await subSendGo();
    return ($('subNote').textContent||'').replace(/\s+/g,' ');
  });
  ok(/pj-sync 側では続いているかもしれません/.test(t2)
     &&/二重に出ません/.test(t2),
     '★★★切れたときの言い方もそろえる（二重に出ないことも書く）');
}

await T.done();
})();
