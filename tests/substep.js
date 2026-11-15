/* 画面：「会員に配信」を作業の順に並べる（8.36・v294）

   カジ（iPhone）
     ・「全プランに配る」が上と下の2か所にあり、下を押しても確認の画面は
       上に出るので、反応していないように見える
     ・「送る」のあと、送っているのか止まっているのか画面で分からない
     ・案 → CSV → Shopify に読み込む → 配る の順に作業するのに、
       ボタンが上下ばらばら
     ・毎回は使わないボタンが、毎回使うボタンと同じ大きさで並んでいる

   直し（ボタンの働きは変えない。並び・見せ方・進み具合だけ）
     ① 案を作る ② Shopify に入れる ③ 確認して配る ④ 結果 の4段に分け、
        済んだ段に「✓ 済（M/D H:MM）」を出す
     ・「全プランに配る」は③に1つだけ。確認の画面はそのすぐ下
     ・送っている間はボタンを「送っています…」にして押せなくし、
       進み具合（プランごと／全体）をボタンの下に出す
     ・ブラウザの「OK／キャンセル」（confirm）はやめて、確認の画面の
       「送る」をそのまま確定にする
     ・毎回は使わないものは「そのほかの操作」に畳む（端末に覚える）
     ・1点ものの登録は別のまとまりにして、既定で畳む
     ・スマホ（375px）で「全プランに配る」→「送りました」まで、
       上下にスクロールしなくて済む */
const { harness } = require('./lib');
const T = harness('画面：会員に配信を作業の順に並べる（8.36）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[];
p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

const ITEM=(n)=>({ jan:'49023705500'+(n<10?('0'+n):n), name:'商品'+n,
  price:3645, qty:1, left:1, gross:1200, sent:false, same:false,
  ship:'クリックポスト', ship_text:'クリックポスト（1〜2本 ¥200）',
  ship_sure:true, ship_warn:'', handle:'sub-x'+n, warns:[] });
const items=(a,b)=>{ const o=[]; for(let i=a;i<=b;i++)o.push(ITEM(i)); return o; };
/* モニター 5件・ライト 9件（ぜんぶ新しく出す。警告なし）。 */
const PLAN=(mn,lt)=>({ ok:true, table_ok:true, token:true, day:'2026-11-15',
  skip:false, on:true, hour:8, pre:true, domain:'omakase-ship.myshopify.com',
  rows:mn+lt,
  auto:{ on:true, hour:8, add:3, edit:1, pre_on:true, pre:true, pre_n:3,
         pre_plans:['モニター'], hot_on:false, hot_dow:1, hot_n:3, off_days:0 },
  plans:[
  { key:'monitor', name:'モニター', on:true, ch:'111', ch_name:'リスト-モニター',
    n:10, q:1, kinds:'game', add:mn, edit:0, keep:0, why:'',
    items:items(1,mn) },
  { key:'light', name:'ライト', on:true, ch:'222', ch_name:'リスト-ライト',
    n:20, q:2, kinds:'game', add:lt, edit:0, keep:0, why:'',
    items:items(21,20+lt) },
  { key:'standard', name:'スタンダード', on:false, ch:'', ch_name:'', n:50, q:5,
    kinds:'all', add:0, edit:0, keep:0, items:[],
    why:'⚙で「配信する」が入っていません' },
  { key:'premium', name:'プレミアム', on:false, ch:'', ch_name:'', n:100, q:5,
    kinds:'all', add:0, edit:0, keep:0, items:[],
    why:'⚙で「配信する」が入っていません' }] });

const setup=async(wait)=>{
  await p.evaluate((ms)=>{
    $('syncApi').value='https://sync.example'; $('syncKey').value='k';
    window.__q=[]; window.__wait=+ms||0; window.__send={};
    window.fetch=async(u,i)=>{
      const url=String(u), b=(i||{}).body;
      const res=(x)=>new Response(JSON.stringify(x),{status:200});
      if(/\/whoami/.test(url))
        return res({ ok:true, role:'admin', staff_key_set:true });
      if(/\/sub\/plan/.test(url))return res(window.__plan);
      if(/\/sub\/send/.test(url)){
        const body=JSON.parse(String(b||'{}'));
        window.__q.push({ u:'send', b:body });
        if(window.__wait)
          await new Promise((r)=>setTimeout(r,window.__wait));
        const q=window.__send[body.plan]||[];
        return res(q.shift()
          ||{ ok:true, sent:0, edited:0, skipped:0, fail:0, left:0 });
      }
      if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, n:0, rows:[] });
      if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
      return res({ ok:true });
    };
    try{ localStorage.removeItem('pj:substep:v1'); }catch(e){}
    try{ localStorage.removeItem('pj:exp:v1'); }catch(e){}
    syncRole='admin'; roleApply(); switchTab('F');
  },wait||0);
  await p.waitForTimeout(80);
};

console.log('=== ① 4つの段が作業の順に並ぶ ===');
await setup(0);
{
  const t=await p.evaluate(()=>{
    const el=['subStep1','subStep2','subStep3','subStep4'].map((x)=>$(x));
    const top=(x)=>x.getBoundingClientRect().top;
    return { all:el.every(Boolean),
      hd:el.map((x)=>x?(x.querySelector('.stephd').textContent||'')
        .replace(/\s+/g,' ').trim():''),
      ord:el.every((x,i)=>i===0||top(x)>top(el[i-1])),
      inStep:[$('subStep1').contains($('subDraftBtn')),
              $('subStep2').contains($('mwSubCsv')),
              $('subStep2').contains($('subLoaded')),
              $('subStep2').contains($('subShopBtn')),
              $('subStep3').contains($('subAllBtn')),
              $('subStep3').contains($('subAllBox')),
              $('subStep4').contains($('subResBox'))],
      nAll:document.querySelectorAll('#subAllBtn,#subAllBtn2').length,
      how:($('subStep2').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+JSON.stringify(t.hd));
  ok(t.all,'★★★「会員に配信」が4つの段に分かれている');
  ok(/^①/.test(t.hd[0])&&/^②/.test(t.hd[1])&&/^③/.test(t.hd[2])
     &&/^④/.test(t.hd[3]),'★★★段ごとに番号を付ける');
  ok(/今日の配信の案/.test(t.hd[0])&&/Shopify に入れる/.test(t.hd[1])
     &&/確認して配る/.test(t.hd[2])&&/結果/.test(t.hd[3]),
     '★★★作業の順（案 → Shopify → 配る → 結果）の見出し');
  ok(t.ord,'★★★上から順に並んでいる');
  ok(t.inStep.every(Boolean),
     '★★★ボタンがその段に入っている（案・CSV・読み込みました・配る・結果）');
  ok(t.nAll===1,'★★★「全プランに配る」は1つだけ（下のもう1つを外した）');
  ok(/商品 → インポート/.test(t.how)&&/matching handles/.test(t.how),
     '★★②に Shopify で取り込む手順を1行だけ出す');
}

console.log('=== ② 確認の画面は「全プランに配る」のすぐ下 ===');
await p.evaluate((d)=>{ window.__plan=d; },PLAN(5,9));
await p.evaluate(()=>subAllOpen());
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>{
    const b=$('subAllBtn').getBoundingClientRect();
    const x=$('subAllBox').getBoundingClientRect();
    return { under:x.top>=b.bottom-2, filled:($('subAllBox').innerHTML||'').length>50,
      send:!!$('subAllSendBtn')&&$('subAllBox').contains($('subAllSendBtn')),
      txt:($('subAllSendBtn').textContent||''),
      note2:!!$('subAllNote2')
        &&$('subAllNote2').getBoundingClientRect().bottom
           <=$('subAllSendBtn').getBoundingClientRect().top+2,
      prog:!!$('subAllProg')
        &&$('subAllProg').getBoundingClientRect().top
           >=$('subAllSendBtn').getBoundingClientRect().bottom-2,
      sends:window.__q.length };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.under&&t.filled,'★★★確認の画面は押したボタンのすぐ下に出る');
  ok(t.sends===0,'★★★確認の画面を出すだけで、まだ何も送らない');
  ok(t.send&&/送る/.test(t.txt)&&/確定/.test(t.txt),
     '★★★確認の画面の「送る」がそのまま確定（そう書いてある）');
  ok(t.note2,'★★知らせ（送っています…・結果）は「送る」のすぐ上に出す');
  ok(t.prog,'★★進み具合は「送る」のすぐ下に出す');
}

console.log('=== ③ 送っている間（押せなくする・進み具合）===');
{
  dlg=[];
  await p.evaluate(()=>{
    window.__q=[];
    window.__send={ monitor:[{ ok:true, sent:5, edited:0, skipped:0, fail:0, left:0 }],
                    light:[{ ok:true, sent:5, edited:0, skipped:0, fail:0, left:4 },
                           { ok:true, sent:4, edited:0, skipped:0, fail:0, left:0 }] };
    window.__wait=300;
    window.__p=subAllSend();
  });
  await p.waitForTimeout(150);
  const mid1=await p.evaluate(()=>({
    txt:($('subAllSendBtn').textContent||''),
    off:!!$('subAllSendBtn').disabled, big:!!$('subAllBtn').disabled,
    prog:($('subAllProg').textContent||'').replace(/\s+/g,' ') }));
  console.log('   '+JSON.stringify(mid1));
  ok(/送っています/.test(mid1.txt)&&mid1.off,
     '★★★押したボタンを「送っています…」にして押せなくする');
  ok(mid1.big,'★★上の「全プランに配る」も押せなくする（二度押し防止）');
  ok(/モニターに送っています 0／5件（全体 0／14件）/.test(mid1.prog),
     '★★★どのプランを何件送っているか（全体の件数も）出す');
  await p.waitForTimeout(1500);
  const mid2=await p.evaluate(()=>
    ($('subAllProg').textContent||'').replace(/\s+/g,' '));
  console.log('   '+mid2);
  ok(/ライトに送っています 5／9件（全体 10／14件）/.test(mid2),
     '★★★続きを頼んでいる間も、進み具合が増えていく');
  await p.evaluate(()=>window.__p);
  await p.waitForTimeout(600);
  const t=await p.evaluate(()=>({
    note:($('subAllNote').textContent||'').replace(/\s+/g,' '),
    res:($('subResBox').textContent||'').replace(/\s+/g,' '),
    ok3:($('subStepOk3').textContent||'').replace(/\s+/g,' '),
    prog:($('subAllProg')?($('subAllProg').textContent||''):''),
    off:!!($('subAllBtn').disabled),
    q:window.__q.map((x)=>x.b.plan).join(',') }));
  console.log('   '+t.note.slice(0,200));
  ok(dlg.length===0,'★★★ブラウザの確認（confirm）は出さない');
  ok(t.q==='monitor,light,light','★★プランの順に送り、残りは続きを頼む');
  ok(/✓ 送りました：新しく 14件・書き換え 0件・失敗 0件/.test(t.note),
     '★★★終わったら「✓ 送りました：…」と出す');
  ok(/モニター（#リスト-モニター） 新しく 5/.test(t.note)
     &&/ライト（#リスト-ライト） 新しく 9/.test(t.note),
     '★★★送ったチャンネルごとの件数も出す');
  ok(/送りました/.test(t.res),'★★★④「結果」の段にも結果を出す');
  ok(/^✓ 済（\d+\/\d+ \d+:\d\d）$/.test(t.ok3),
     '★★★済んだ段に「✓ 済（M/D H:MM）」を出す');
  ok(!t.prog&&!t.off,'★★終わったら進み具合を消して、ボタンを押せるようにする');
}

console.log('=== ④ 自動の回の1行は④の段にも出る ===');
{
  const t=await p.evaluate(()=>
    ($('subAutoLine').textContent||'').replace(/\s+/g,' '));
  console.log('   '+t.slice(0,120));
  ok(/自動の回（平日 08:00）/.test(t),'★★★④に自動の回の1行を出す');
}

console.log('=== ⑤ 済んだ段は端末に覚える ===');
{
  const t=await p.evaluate(()=>{
    const o=JSON.parse(localStorage.getItem('pj:substep:v1')||'{}');
    $('subStepOk3').innerHTML='';          // 開き直したことにする
    subStepRender();
    return { keys:Object.keys(o),
             again:($('subStepOk3').textContent||'').replace(/\s+/g,' ') };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.keys.indexOf('sent')>=0,'★★★済んだ段をこの端末に覚える');
  ok(/✓ 済/.test(t.again),'★★★開き直しても「✓ 済」が出る');
}

console.log('=== ⑥ そのほかの操作・1点ものは畳む ===');
{
  const t=await p.evaluate(()=>{
    const more=document.querySelector('details.exp.grp[data-exp="subMore"]');
    const one=document.querySelector('details.exp.grp[data-exp="oneGrp"]');
    const has=(d,id)=>!!(d&&$(id)&&d.contains($(id)));
    return { more:!!more, one:!!one, mOpen:more?more.open:null,
      oOpen:one?one.open:null,
      ids:['subSendBtn','subSkipBtn','subRedoBtn','subStackBtn',
           'subDraftLogBtn','subPlanBtn','subPlanList']
        .map((x)=>has(more,x)),
      ones:['oneName','onePicFile','oneNote','oneSaveBtn']
        .map((x)=>has(one,x)),
      why:(more?(more.textContent||''):'').replace(/\s+/g,' ') };
  });
  console.log('   '+JSON.stringify({ ids:t.ids, ones:t.ones }));
  ok(t.more&&t.mOpen===false,
     '★★★毎回は使わないものは「そのほかの操作」に畳む（既定は閉じる）');
  ok(t.ids.every(Boolean),
     '★★★今すぐ送る・今日は送らない・書き直す・積み上げ型・案の記録・'
     +'今日の配信の予定がその中に入る');
  ok(/自動の回を待たずに/.test(t.why)&&/⚙（送料の文など）を変えたとき/.test(t.why)
     &&/下のプランの商品を上のプランにも/.test(t.why)
     &&/あとから見直すとき/.test(t.why),
     '★★★どんなときに使うかを1行ずつ添える');
  ok(t.one&&t.oOpen===false&&t.ones.every(Boolean),
     '★★★1点ものの登録は別のまとまりにして、既定で畳む');
  /* 開いた状態はこの端末に覚える（details.exp の仕組みと同じ）。 */
  const kept=await p.evaluate(()=>{
    const more=document.querySelector('details.exp.grp[data-exp="subMore"]');
    more.open=true;
    return new Promise((r)=>setTimeout(()=>{
      let o={}; try{ o=JSON.parse(localStorage.getItem('pj:exp:v1')||'{}'); }
      catch(e){}
      r({ saved:!!o.subMore, open:more.open });
    },60));
  });
  console.log('   '+JSON.stringify(kept));
  ok(kept.saved,'★★★開いた状態をこの端末に覚える');
  await p.evaluate(()=>{
    document.querySelector('details.exp.grp[data-exp="subMore"]').open=false; });
}

console.log('=== ⑦ スマホ（375px）で上下にスクロールしなくて済む ===');
await p.setViewportSize({ width:375, height:667 });
await setup(0);
await p.evaluate((d)=>{ window.__plan=d; },PLAN(1,1));
await p.evaluate(()=>{
  window.__send={ monitor:[{ ok:true, sent:1, edited:0, skipped:0, fail:0, left:0 }],
                  light:[{ ok:true, sent:1, edited:0, skipped:0, fail:0, left:0 }] };
  /* ③の段まで来たところから始める。 */
  $('subAllBtn').scrollIntoView({ block:'center' });
});
await p.waitForTimeout(120);
{
  await p.click('#subAllBtn');
  await p.waitForTimeout(500);
  const t1=await p.evaluate(()=>{
    const H=window.innerHeight;
    const r=(id)=>{ const el=$(id); if(!el)return null;
      const b=el.getBoundingClientRect(); return { top:b.top, bot:b.bottom }; };
    return { H:H, btn:r('subAllBtn'), send:r('subAllSendBtn'),
             box:r('subAllBox'), y:window.scrollY };
  });
  console.log('   '+JSON.stringify(t1));
  ok(t1.box&&t1.box.top>=0&&t1.box.top<=t1.H,
     '★★★押したあと、確認の画面が画面のうちに出る（探さなくてよい）');
  ok(t1.send&&t1.send.top>=0&&t1.send.bot<=t1.H,
     '★★★確認の画面の「送る」も、スクロールせずに押せる');
  await p.click('#subAllSendBtn');
  await p.waitForTimeout(3200);
  const t2=await p.evaluate(()=>{
    const H=window.innerHeight;
    const el=$('subAllNote2')||$('subAllNote');
    const b=el.getBoundingClientRect();
    return { H:H, top:b.top, bot:b.bottom,
             txt:(el.textContent||'').replace(/\s+/g,' '), y:window.scrollY };
  });
  console.log('   '+JSON.stringify(t2));
  ok(/送りました/.test(t2.txt),'★★★「送りました」が出る');
  ok(t2.top>=0&&t2.top<=t2.H,
     '★★★「送りました」も画面のうちに出る（上下に動かさなくて済む）');
}

await T.done();
})();
