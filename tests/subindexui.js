/* 画面：会員チャンネルの「今週の一覧（目次）」（8.46・カジの依頼）

   ・⚙（一覧を出す・配信のあとに書き換える・新着の1通・仕入れ値と粗利・
     商品名の字数・新着の行数・カテゴリの順）
   ・「一覧の予定を見る」… Discord には何も出さず、件数とページ数を見る
   ・「一覧を書き直す」… 書き換えだけ（通知は鳴らない）
   ・作業者の端末では出さない（売値が出るため） */
const { harness } = require('./lib');
const T = harness('画面：会員チャンネルの一覧（8.46）');
const ok = T.ok;
(async()=>{
const p=await T.open();

await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__post=[];
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), o=i||{};
    if(/\/whoami/.test(url))
      return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    if(/\/sub\/index/.test(url)){
      const post=String(o.method||'')==='POST';
      window.__post.push({ u:'index', post:post });
      /* 8.54 ピン留めの失敗を返す回（window.__pinFail）。 */
      const pf=!!window.__pinFail;
      const chs=[{ key:'light', name:'ライト', ch:'222', n:12, pages:1,
        was:1, pin:pf?0:1, pinned:pf?0:1,
        pin_fail:pf?1:0,
        pin_why:pf?'権限がありません（ボットに「メッセージの管理」が要ります）':'',
        new_n:5,
        cats:[{ cat:'ゲーム', n:9 },{ cat:'フィギュア', n:3 }] },
        { key:'premium', name:'プレミアム', ch:'333', n:48, pages:2, was:3,
          pin:false, new_n:10, cats:[{ cat:'ゲーム', n:40 },
            { cat:'その他', n:8 }] }];
      if(post)return res({ ok:true, chs:chs.map((c)=>Object.assign({},c,
        { add:0, edit:1, same:0, empty:1, fail:0 })),
        pages:3, add:0, edit:2, same:0, fail:0,
        pin:pf?0:1, pin_fail:pf?1:0,
        pin_why:pf?'権限がありません（ボットに「メッセージの管理」が要ります）'
          :'' });
      return res({ ok:true, on:true, auto:true, week:true, chs:chs });
    }
    return real(u,i);
  };
  switchTab('G'); syncRole='admin'; roleApply();
});

console.log('=== ① ⚙の欄と既定 ===');
{
  const t=await p.evaluate(()=>({
    on:($('gdIdxOn')||{}).checked, auto:($('gdIdxAuto')||{}).checked,
    week:($('gdIdxWeek')||{}).checked, yen:($('gdIdxYen')||{}).checked,
    name:($('gdIdxName')||{}).value, weekN:($('gdIdxWeekN')||{}).value,
    cats:($('gdIdxCats')||{}).value,
    ph:($('gdIdxCats')||{}).placeholder,
    cfg:gdCfg() }));
  console.log('   '+JSON.stringify(t));
  ok(t.on===true&&t.auto===true&&t.week===true&&t.yen===true,
     '★★★既定は「一覧を出す・配信のあとに書き換える・新着の1通・値段を出す」');
  ok(t.name==='28'&&t.weekN==='10',
     '★★★既定は 商品名28字・新着10行');
  ok(t.cats===''&&/ゲーム,フィギュア,その他,1点もの/.test(t.ph),
     '★★カテゴリの順は空＝既定（例を placeholder に出す）');
  ok(t.cfg.gdIdxOn===1&&t.cfg.gdIdxName==='28'
     &&t.cfg.gdIdxWeekN==='10','★★⚙を1か所で読む（gdCfg）');
}

console.log('\n=== ② 一覧の予定を見る（何も出さない）===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[];
    await gdIdxPlan();
    await new Promise((x)=>setTimeout(x,200));
    return { post:window.__post, note:$('gdIdxNote').textContent,
             box:($('gdIdxBox').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+t.box);
  ok(t.post.length===1&&t.post[0].post===false,
     '★★★見るだけ（POST しない＝Discord には何も出さない）');
  ok(/まだ何も出していません/.test(t.note),
     '★★★「まだ何も出していません」と出す');
  ok(/ライト 12件／1ページ/.test(t.box)&&/プレミアム 48件／2ページ/.test(t.box),
     '★★★チャンネルごとの件数とページ数');
  ok(/ゲーム 9件・フィギュア 3件/.test(t.box),
     '★★★カテゴリごとの件数も出す');
  ok(/今週の新着 5件/.test(t.box),'★★その日に新しく出た件数');
  ok(/前は 3ページ/.test(t.box)&&/空です/.test(t.box),
     '★★★ページが減るときは「余ったページは空ですに書き換えます」と出す');
  ok(/ピン留め済み/.test(t.box),'★ピン留めしてあるかも分かる');
}

console.log('\n=== ③ 一覧を書き直す（通知は鳴らない）===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[];
    await gdIdxGo();
    await new Promise((x)=>setTimeout(x,200));
    return { post:window.__post, note:$('gdIdxNote').textContent,
             box:($('gdIdxBox').textContent||'').replace(/\s+/g,' '),
             btn:($('gdIdxBtn')||{}).disabled };
  });
  console.log('   '+t.note.replace(/\s+/g,' '));
  ok(t.post.length===1&&t.post[0].post===true,'★★★押すと書き直す');
  ok(/書き直しました/.test(t.note)&&/書き換え 2/.test(t.note),
     '★★★結果（新しく・書き換え・そのまま）を出す');
  ok(/通知は鳴りません/.test(t.note),
     '★★★「書き換えでは通知は鳴りません」と書く');
  ok(/空にした 1/.test(t.box),'★★空にしたページの数も出す');
  ok(t.btn===false,'★終わったらボタンを押せるように戻す');
}

console.log('\n=== ④ 作業者の端末では出さない ===');
{
  const t=await p.evaluate(()=>{
    syncRole='staff'; roleApply();
    const b=document.getElementById('gdIdxBtn');
    const hid=window.getComputedStyle(b).display==='none';
    syncRole='admin'; roleApply();
    return hid;
  });
  ok(t===true,'★★★作業者の端末では「一覧を書き直す」を出さない');
}

console.log('\n=== ⑤ 決まりは shared/subindex.js の1か所 ===');
{
  const t=await p.evaluate(()=>({
    has:typeof PJ_SUBINDEX!=='undefined',
    line:SUBINDEX.lineOf({ jan:'4902370550001', name:'ゲームA', kishu:'NS',
      price:3645, gross:1200, left:2, msg_id:'900001', mark:'◎' },
      { guild:'555' },'222'),
    max:SUBINDEX.EMBED_MAX }));
  console.log('   '+t.line);
  ok(t.has&&t.max===4096,'★★★画面も同じ決まりを読む');
  ok(/◎ \*\*ゲームA\*\* … ¥3,645／粗利 ¥1,200／残り2/.test(t.line),
     '★★★行の形も同じ（札・名前・仕入れ値・粗利・残り）');
  ok(!/卸値|いろは|matchingworld/.test(t.line),
     '★★★卸値・仕入れ先は入らない（8.2）');
}
console.log('\n=== ⑥ ピン留めの失敗は必ず出す（8.54・カジの報告）===');
{
  const t=await p.evaluate(async()=>{
    window.__pinFail=true;
    await gdIdxPlan();
    await new Promise((x)=>setTimeout(x,200));
    const plan=($('gdIdxBox').textContent||'').replace(/\s+/g,' ');
    await gdIdxGo();
    await new Promise((x)=>setTimeout(x,200));
    const out={ plan:plan, note:$('gdIdxNote').textContent
      .replace(/\s+/g,' '),
      box:($('gdIdxBox').textContent||'').replace(/\s+/g,' ') };
    window.__pinFail=false;
    return out;
  });
  console.log('   '+t.note);
  ok(/ピン留め 失敗 1/.test(t.note),
     '★★★結果に「ピン留め 失敗 1」を出す');
  ok(/権限がありません/.test(t.note)&&/メッセージの管理/.test(t.note),
     '★★★理由（権限がありません・メッセージの管理）も出す');
  ok(/もう一度このボタンを押して/.test(t.note)
     &&/ピン留めできるまで毎回ためします/.test(t.note),
     '★★★権限を足して押し直せば留まる、と書く');
  ok(/ピン留め 失敗 1/.test(t.box),
     '★★チャンネルごとの行にも失敗と理由を出す');
  ok(/ピン留めはまだ/.test(t.plan)||/ピン留め 失敗/.test(t.plan),
     '★★予定のほうでも「ピン留めはまだ」が分かる');
  const u=await p.evaluate(async()=>{
    await gdIdxGo();
    await new Promise((x)=>setTimeout(x,200));
    return $('gdIdxNote').textContent.replace(/\s+/g,' ');
  });
  ok(/ピン留め 1/.test(u)&&!/失敗/.test(u),
     '★★★ピン留めできた回は「ピン留め 1」だけを出す');
}

await T.done();
})();
