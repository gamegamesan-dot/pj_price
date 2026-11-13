/* 画面：過去の記録を数え直す（6.190／7.142・カジの依頼）

   ・⚙「3. 仕入れ」の「記録を見る」の下に
     「過去の記録を数え直す（まず下見）」を置いた
   ・**押すと下見だけ**（pj-sync に approve を送らない＝何も書かない）。
     対象の商品数・売れた数から外す点数・一度に消えた回数と、
     主な例（JAN・商品名・減った数）を出す
   ・中身を見てから「この内容で数え直す」→ 確認（confirm）→ 実行
   ・作業者の端末では押せない（売れる速さが変わるため） */
const { harness, clickCfg } = require('./lib');
const T = harness('画面：過去の記録を数え直す（6.190）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const PLAN={ ok:true, dry_run:true, applied:false, n_rows:3, n_jan:2,
  down_off:535, wipe_add:535, wipe_n:2, back_off:1, gone_off:1,
  wipe_pct:80, wipe_min:50, table_ok:true,
  rows:[
    { jan:'4571442047206', name:'彩京 SHOOTING LIBRARY Vol.1', down_off:415,
      wipe_n:1, wipe_qty:415, back_off:0, gone_off:0 },
    { jan:'4902370550002', name:'1回で消えた商品', down_off:120,
      wipe_n:1, wipe_qty:120, back_off:1, gone_off:1 }] };

await p.evaluate((PLAN)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__post=[]; window.__fail=0;
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), o=i||{};
    if(/\/whoami/.test(url))
      return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    if(/\/mw\/move\/recount/.test(url)){
      const b=JSON.parse(String(o.body||'{}'));
      window.__post.push(b);
      if(window.__fail)return new Response('{"ok":false,"error":"boom"}',
        {status:500});
      if(b.approve===true)
        return res(Object.assign({},PLAN,{ dry_run:false, applied:true }));
      return res(PLAN);
    }
    return real(u,i);
  };
  syncRole='admin'; roleApply();
},PLAN);

console.log('=== ① ボタンがある（⚙の在庫の動きのところ）===');
{
  const t=await p.evaluate(()=>{
    const b=document.getElementById('mwRecountBtn');
    return { ok:!!b, text:b?b.textContent.trim():'',
      near:!!document.getElementById('mwMoveBox'),
      box:!!document.getElementById('mwRecountBox') };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.ok&&/下見/.test(t.text),'★★★「まず下見」と書いたボタンがある');
  ok(t.near&&t.box,'★★「記録を見る」の下にある');
}

console.log('\n=== ② 押すと下見だけ（何も書かない）===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[];
    await mwRecountPlanGo();
    await new Promise((x)=>setTimeout(x,300));
    return { post:window.__post, note:$('mwRecountNote').textContent,
             box:$('mwRecountBox').innerHTML };
  });
  console.log('   '+JSON.stringify(t.post));
  console.log('   '+t.note.replace(/\s+/g,' ').slice(0,200));
  ok(t.post.length===1&&t.post[0].approve===undefined,
     '★★★approve を送らない（pj-sync は何も書かない）');
  ok(/下見/.test(t.note)&&/まだ何も変えていません/.test(t.note),
     '★★★「まだ何も変えていません」と書く');
  ok(/直す商品 2件/.test(t.note),'★★★直す商品の数を出す');
  ok(/売れた数から外す 535点/.test(t.note),'★★★売れた数から外す点数を出す');
  ok(/一度に消えた 2回・535点/.test(t.note),'★★一度に消えた回数と点数');
  ok(/再入荷から外す 1回/.test(t.note),'★★再入荷から外す回数');
  ok(/80% 以上・50点以上/.test(t.note),'★使ったしきい値も出す');
  ok(/4571442047206/.test(t.box)&&/彩京 SHOOTING LIBRARY Vol.1/.test(t.box)
     &&/415点/.test(t.box),
     '★★★主な例に JAN・商品名・減った数を出す');
  ok(/この内容で数え直す/.test(t.box),'★★★見てから押すボタンを出す');
}

console.log('\n=== ③ 確認してから実行する ===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[];
    window.confirm=()=>false;                 // 「いいえ」
    await mwRecountRun();
    await new Promise((x)=>setTimeout(x,200));
    return window.__post.length;
  });
  ok(t===0,'★★★「いいえ」では実行しない');
  const t2=await p.evaluate(async()=>{
    window.__post=[]; window.__ask='';
    window.confirm=(m)=>{ window.__ask=String(m||''); return true; };
    await mwRecountRun();
    await new Promise((x)=>setTimeout(x,300));
    return { post:window.__post, ask:window.__ask,
             note:$('mwRecountNote').textContent,
             box:$('mwRecountBox').innerHTML };
  });
  console.log('   '+JSON.stringify(t2.post));
  console.log('   確認の文: '+t2.ask.replace(/\n/g,' ⏎ ').slice(0,160));
  ok(t2.post.length===1&&t2.post[0].approve===true,
     '★★★「はい」で approve を送る');
  ok(/直す商品：2件/.test(t2.ask)&&/売れた数から外す：535点/.test(t2.ask),
     '★★★確認の文に中身を出す');
  ok(/売れる速さ・欠品までの見込みが変わります/.test(t2.ask),
     '★★何が変わるかを書く');
  ok(/✓ 数え直しました/.test(t2.note),'★★★終わったら知らせる');
  ok(t2.box==='','★実行したらボタンを消す（二度押しを防ぐ）');
}

console.log('\n=== ④ 直すものが無いとき・失敗したとき ===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[];
    const real=window.fetch;
    window.fetch=async(u,i)=>{
      if(/recount/.test(String(u)))
        return new Response(JSON.stringify({ ok:true, n_jan:0, n_rows:0,
          down_off:0, wipe_n:0, rows:[] }),{status:200});
      return real(u,i);
    };
    await mwRecountPlanGo();
    await new Promise((x)=>setTimeout(x,300));
    return $('mwRecountNote').textContent;
  });
  ok(/数え直すものはありません/.test(t),
     '★★★もう直っているときは、そう出す');
  const t2=await p.evaluate(async()=>{
    window.__fail=1;
    const real=window.fetch;
    window.fetch=async(u,i)=>{
      if(/recount/.test(String(u)))
        return new Response('{"ok":false,"error":"boom","detail":"だめでした"}',
          {status:500});
      return real(u,i);
    };
    await mwRecountPlanGo();
    await new Promise((x)=>setTimeout(x,300));
    const el=$('mwRecountNote');
    return { note:el.textContent, color:el.style.color };
  });
  console.log('   '+JSON.stringify(t2).slice(0,160));
  ok(/下見できませんでした/.test(t2.note),'★★★失敗を黙らない');
  ok(/bad/.test(t2.color),'★赤で出す');
}

console.log('\n=== ⑤ 作業者の端末では押せない ===');
{
  const t=await p.evaluate(()=>{
    syncRole='staff'; roleApply();
    const b=document.getElementById('mwRecountBtn');
    const st=window.getComputedStyle(b);
    const hid=(st.display==='none'||st.visibility==='hidden');
    syncRole='admin'; roleApply();
    return hid;
  });
  ok(t===true,'★★★作業者の端末ではボタンが出ない（売れる速さが変わるため）');
}
await T.done();
})();
