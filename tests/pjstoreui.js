/* 画面：端末の保存（localStorage が足りない・6.191・【1】〜【4】）

   カジ（iPhone の Safari／ホーム画面の pj）
     ⚙ に値を入れると「⚠ この端末に保存できませんでした
     （The quota has been exceeded.）」と出る。localStorage がいっぱい。

   直し
     ① ⚙に「この端末の保存」を作り、キーごとの大きさを見られるようにした
     ② 大きいもの（出品リスト・ゴミ箱・書き出しログ・販売連携の控えなど）は
        IndexedDB に移す。**書けたことを確かめてから**消す
     ③ 古いもの（期限切れの控え・多すぎるログ）は立ち上がりに自動で消す
     ④ 保存できないときに何が困るかを⚙に書く */
const { harness, clickCfg } = require('./lib');
const T = harness('画面：端末の保存（6.191）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const BIG='pj:csvlist:v1';
const row=(i)=>({ id:'r'+i, jan:'49023705500'+String(i).padStart(2,'0'),
  name:'商品'+i, cost:3000, weight:300, pics:[], specs:{} });

console.log('=== ① 何がどれだけ入っているか（⚙）===');
{
  const t=await p.evaluate(()=>{
    localStorage.setItem('pj:ui:v1',JSON.stringify({ a:1 }));
    pjStoreRender(1);
    return { html:$('pjStoreBox').innerHTML,
             txt:($('pjStoreBox').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+t.txt.slice(0,220));
  ok(/端末の設定（localStorage）/.test(t.txt),'★★★localStorage の合計を出す');
  ok(/大きい保存（IndexedDB）/.test(t.txt),'★★★IndexedDB の合計も出す');
  ok(/pj:ui:v1/.test(t.txt)&&/画面の設定/.test(t.txt),
     '★★★キーごとに「何のためのものか」と大きさを出す');
  ok(/KB|B/.test(t.txt),'★★大きさを読める形で出す');
}

console.log('\n=== ② 大きいものを IndexedDB に移す（中身を失わない）===');
{
  const t=await p.evaluate(async(BIG)=>{
    const rows=[]; for(let i=0;i<50;i++)rows.push({ id:'r'+i, name:'商品'+i });
    const text=JSON.stringify(rows);
    localStorage.setItem(BIG,text);
    await pjStoreInit();
    const idb=await pjIdbGet(BIG);
    return { ls:localStorage.getItem(BIG), idb:String(idb||'').length,
             mem:(pjBigMem[BIG]||'').length, same:String(idb)===text,
             get:lsGet(BIG)===text, moved:pjStoreMoved };
  },BIG);
  console.log('   '+JSON.stringify({ ls:t.ls, idb:t.idb, mem:t.mem,
    same:t.same, get:t.get }));
  ok(t.idb>0&&t.same===true,'★★★IndexedDB に入る（中身がそのまま）');
  ok(t.ls===null,'★★★入ったことを確かめてから localStorage から消す');
  ok(t.get===true,'★★★読み出し（lsGet）は今までどおり同じ中身を返す');
  ok(t.mem>0,'★★画面はすぐ読めるように中身を持っている');
  ok((t.moved||[]).some((x)=>x.key===BIG&&x.moved>0),
     '★★移した大きさを控える（⚙に出す）');
}

console.log('\n=== ③ 書き込みは IndexedDB へ（localStorage を太らせない）===');
{
  const t=await p.evaluate(async(BIG)=>{
    lsSet(BIG,JSON.stringify([{ id:'x' }]));
    await new Promise((x)=>setTimeout(x,120));
    const idb=await pjIdbGet(BIG);
    return { ls:localStorage.getItem(BIG), idb:String(idb||''),
             get:lsGet(BIG) };
  },BIG);
  console.log('   '+JSON.stringify(t));
  ok(t.ls===null,'★★★大きいものは localStorage に書かない');
  ok(/"id":"x"/.test(t.idb),'★★★IndexedDB に書く');
  ok(/"id":"x"/.test(t.get),'★★すぐ読み直せる');
}

console.log('\n=== ④ 出品リストが開き直しても残る ===');
{
  await p.evaluate(async()=>{
    csvList=[{ id:'keep1', jan:'4902370550467', name:'残る商品',
      cost:3000, weight:300, pics:[], specs:{} }];
    csvSaveList();
    await new Promise((x)=>setTimeout(x,150));
  });
  await p.reload({ waitUntil:'load' });
  await p.waitForTimeout(600);
  const t=await p.evaluate(()=>({ n:csvList.length,
    name:(csvList[0]||{}).name,
    ls:localStorage.getItem('pj:csvlist:v1') }));
  console.log('   '+JSON.stringify(t));
  ok(t.n===1&&t.name==='残る商品',
     '★★★開き直しても出品リストが残る（IndexedDB から当て直す）');
  ok(t.ls===null,'★★localStorage には置かない');
}

console.log('\n=== ⑤ 書けなかったときは消さない（中身を守る）===');
{
  const t=await p.evaluate(async()=>{
    const K='pj:csvtrash:v1';
    localStorage.setItem(K,JSON.stringify([{ r:{ id:'t1' } }]));
    const real=pjIdbRun;
    /* IndexedDB が書けない状態をまねる。 */
    window.pjIdbRun=function(mode){
      if(mode==='readwrite')return Promise.reject(new Error('書けません'));
      return real.apply(null,arguments);
    };
    await pjStoreInit();
    window.pjIdbRun=real;
    return { ls:localStorage.getItem(K),
             err:(pjStoreMoved||[]).filter((x)=>x.key===K)[0] };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.ls!==null,'★★★移せなかったら localStorage に残す（中身を失わない）');
  ok(!!(t.err&&t.err.err),'★★移せなかったことを控える（⚙に出す）');
}

console.log('\n=== ⑥ 古いものを自動で消す ===');
{
  const t=await p.evaluate(()=>{
    /* 60日前の一覧の控え＋多すぎるログ。 */
    const old=new Date(Date.now()-60*86400000).toISOString();
    lsSet('pj:sync:v1',JSON.stringify({ at:old, items:[{ id:1 }] }));
    csvLog=[]; for(let i=0;i<PJ_LOG_MAX+5;i++)csvLog.push({ at:old, n:i });
    const out=pjStoreSweep();
    return { out:out, sync:lsGet('pj:sync:v1'), log:csvLog.length };
  });
  console.log('   '+JSON.stringify(t.out)+' log='+t.log);
  ok(t.sync===null||t.sync===undefined,
     '★★★30日より古い一覧の控えは捨てる（押せば作り直せる）');
  ok(t.log===2000,'★★★書き出し済みログは新しい 2,000件まで');
  ok(t.out.length>=2,'★★消したものを控える');
  /* 出品リストとゴミ箱は消さない。 */
  const t2=await p.evaluate(()=>{
    csvList=[{ id:'keep2' }]; csvSaveList();
    csvTrash=[{ at:new Date().toISOString(), pos:0, r:{ id:'t' } }];
    try{ csvTrashSave(); }catch(e){}
    pjStoreSweep();
    return { list:csvList.length, trash:csvTrash.length };
  });
  ok(t2.list===1&&t2.trash===1,
     '★★★出品リストとゴミ箱は自動で消さない（作り直せないので）');
}

console.log('\n=== ⑦ 「古いものを消す」のボタン ===');
{
  const t=await p.evaluate(()=>{
    pjStoreSweepGo();
    return $('pjStoreNote').textContent;
  });
  console.log('   '+t);
  ok(/消しました|消せる古いものはありませんでした/.test(t),
     '★★★押した結果を出す');
}

console.log('\n=== ⑧ 保存できないときに何が困るかを書いてある（【4】）===');
{
  const t=await p.evaluate(()=>
    (document.getElementById('pjStoreBox').parentNode.textContent||'')
      .replace(/\s+/g,' '));
  ok(/5MB/.test(t),'★iPhone の目安（5MB）を書く');
  ok(/The quota has been exceeded/.test(t),'★★出るメッセージを書く');
  ok(/⚙の設定/.test(t)&&/開いていたタブ/.test(t),
     '★★★困るのは⚙の設定・開閉の覚え・キーの控えだと書く');
  ok(/出品リストと pj-sync のデータは無事/.test(t),
     '★★★大事なものは無事だと書く');
}

console.log('\n=== ⑨ IndexedDB が使えない端末でも動く ===');
{
  const t=await p.evaluate(async()=>{
    const real=pjIdbOpen;
    window.pjIdbOpen=function(){ return Promise.reject(new Error('だめ')); };
    pjIdb=null; pjBigMem={};
    await pjStoreInit();
    window.pjIdbOpen=real;
    lsSet('pj:csvlog:v1',JSON.stringify([{ n:1 }]));
    const got=lsGet('pj:csvlog:v1');
    const ls=localStorage.getItem('pj:csvlog:v1');
    pjStoreRender(1);
    return { err:pjIdbErr, got:got, ls:ls,
             txt:($('pjStoreBox').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+JSON.stringify({ err:t.err, ls:!!t.ls }));
  ok(!!t.err,'★★使えない理由を控える');
  ok(/"n":1/.test(String(t.got||'')),'★★★読み書きは今までどおりできる');
  ok(!!t.ls,'★★★そのときは localStorage に置く（今までどおり）');
  ok(/この端末では使えません/.test(t.txt),'★★⚙にもそう出す');
}
await T.done();
})();
