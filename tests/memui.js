/* 画面：会員の月額課金と Discord のロール（8.56・カジの依頼）

   ・⚙（自動の付け外し・サーバーID・ロールID 4つ・バリアント3つ・
     猶予・モニターの日数・積み上げ・モニターのロールを外す・表示名）
   ・一覧（会員番号は**下4桁**・プラン・状態・期限・Discord・ロールの数）
   ・手でつなぐ／付け直す／解約にする／有効に戻す／つなぎを外す
   ・**氏名・住所・メールは画面にも出ない**（pj に持っていない）
   ・作業者の端末では押せない（プランと期限が見えるため） */
const { harness } = require('./lib');
const T = harness('画面：会員の月額課金とロール（8.56）');
const ok = T.ok;
(async()=>{
const p=await T.open();

await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__post=[];
  window.__mem={ ok:true, n:2, on:true, guild:true, roles_ok:4, vars_ok:3,
    grace:3, stack:true, mon_off:true, mon_days:21, token:true, hook:true,
    rows:[
      { cust:'7777000001', cust4:'0001', dc:'111222333',
        dc_name:'kaji', plan:'premium', paid_to:'2026-12-17T00:00:00Z',
        state:'active', roles:'9001,9002,9003', days:30, want:3 },
      { cust:'7777000002', cust4:'0002', dc:'', dc_name:'',
        plan:'light', paid_to:'2026-11-10T00:00:00Z',
        state:'expired', roles:'', days:-7, want:0 },
      /* 8.62（カジの報告）解約の行とモニターの行も出す。 */
      { cust:'7777000003', cust4:'0003', dc:'999000111',
        dc_name:'monitor-san', plan:'monitor',
        paid_to:'2026-12-08T00:00:00Z', state:'canceled', roles:'',
        days:21, want:0 },
      /* 8.64（カジの報告）番号を間違えて作った行（解約・Discord なし）。 */
      { cust:'7777009198', cust4:'9198', dc:'', dc_name:'',
        plan:'monitor', paid_to:'', state:'canceled', roles:'',
        days:null, want:0 }] };
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), o=i||{};
    const body=o.body?JSON.parse(String(o.body)):null;
    if(/\/whoami/.test(url))
      return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    if(/\/mem\/link/.test(url)){
      window.__post.push({ u:'link', body:body });
      return res({ ok:true, sync:{ n:1, add:3, del:0, fail:0, rows:[{}] } });
    }
    if(/\/mem\/unlink/.test(url)){
      window.__post.push({ u:'unlink', body:body });
      return res({ ok:true });
    }
    if(/\/mem\/state/.test(url)){
      window.__post.push({ u:'state', body:body });
      return res({ ok:true });
    }
    if(/\/mem\/del/.test(url)){
      window.__post.push({ u:'del', body:body });
      return res({ ok:true, cust:(body||{}).cust });
    }
    if(/\/mem\/sync/.test(url)){
      window.__post.push({ u:'sync', body:body });
      return res({ ok:true, n:2, add:1, del:2, fail:0, rows:[] });
    }
    if(/\/mem$/.test(url)){
      window.__post.push({ u:'list', get:String(o.method||'GET')==='GET' });
      return res(window.__mem);
    }
    return real(u,i);
  };
  switchTab('G'); syncRole='admin'; roleApply();
  window.confirm=()=>true;
});

console.log('=== ① ⚙の欄と既定 ===');
{
  const t=await p.evaluate(()=>({
    on:($('memOn')||{}).checked, stack:($('memStack')||{}).checked,
    monOff:($('memMonOff')||{}).checked, keep:($('memKeepName')||{}).checked,
    grace:($('memGrace')||{}).value, monDays:($('memMonDays')||{}).value,
    ids:['memGuild','memRoleMonitor','memRoleLight','memRoleStandard',
         'memRolePremium','memVarLight','memVarStandard','memVarPremium']
      .filter((x)=>!!$(x)).length,
    adv:ADV_SUB.indexOf('memGuild')>=0&&ADV_SUB.indexOf('memGrace')>=0,
    advChk:ADV_SUBCHK.indexOf('memOn')>=0
      &&ADV_SUBCHK.indexOf('memStack')>=0 }));
  console.log('   '+JSON.stringify(t));
  ok(t.on===false,'★★★自動の付け外しは**既定オフ**（ロールID を入れてから入れる）');
  ok(t.stack===true&&t.monOff===true&&t.keep===true,
     '★★★積み上げ・モニターは3週間で外す・表示名を控える＝既定オン');
  ok(t.grace==='3'&&t.monDays==='21','★★★既定は 猶予3日・モニター21日');
  ok(t.ids===8,'★★サーバーID・ロール4つ・バリアント3つの欄がある');
  ok(t.adv===true&&t.advChk===true,
     '★★★⚙は pj-sync に送る一覧に入っている（端末だけに残さない）');
}

console.log('\n=== ② 一覧（会員番号は下4桁・氏名やメールは出ない）===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[];
    await memListGo();
    await new Promise((x)=>setTimeout(x,200));
    return { post:window.__post, note:$('memNote').textContent,
             box:($('memBox').textContent||'').replace(/\s+/g,' '),
             html:$('memBox').innerHTML };
  });
  console.log('   '+t.box.slice(0,200));
  ok(t.post.length===1&&t.post[0].u==='list'&&t.post[0].get===true,
     '★★★見るだけ（GET）');
  ok(/…0001/.test(t.box)&&!/7777000001/.test(t.box),
     '★★★会員番号は**下4桁だけ**（全部は出さない）');
  ok(/プレミアム/.test(t.box)&&/有効/.test(t.box)&&/期限 2026-12-17/.test(t.box),
     '★★★プラン・状態・期限を出す');
  ok(/あと30日/.test(t.box)&&/7日すぎ/.test(t.box),
     '★★★期限まで（過ぎたぶんも）日数で出す');
  ok(/つないでいません/.test(t.box),
     '★★★Discord とつないでいない会員が分かる');
  /* 8.62 状態（有効／解約／期限切れ）と期限が、行ごとに正しく出る。 */
  ok(/解約/.test(t.box)&&/期限切れ/.test(t.box)&&/有効/.test(t.box),
     '★★★状態を日本語で出す（有効・解約・期限切れ）');
  ok(/モニター/.test(t.box)&&/期限 2026-12-08/.test(t.box),
     '★★★モニターの行にも期限が出る（「—」のままにしない）');
  ok(/猶予 3日/.test(t.box)&&/積み上げ：入/.test(t.box)
     &&/21日で外す/.test(t.box),'★★⚙の様子も出す');
  ok(/ロールID 4\/4/.test(t.box)&&/バリアント 3\/3/.test(t.box)
     &&/webhook の秘密 あり/.test(t.box),
     '★★★⚙が足りているかが一目で分かる');
  ok(!/@/.test(t.box),'★★★メールらしきものは出ない');
  ok(/氏名やメールは/.test(t.note),'★持っていないことを書く');
}

console.log('\n=== ③ 手でつなぐ（カジの決定C）===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[];
    $('memLinkCust').value='7777000003';
    $('memLinkDc').value='999888777';
    $('memLinkPlan').value='monitor';
    $('memLinkName').value='someone';
    await memLinkGo();
    await new Promise((x)=>setTimeout(x,250));
    return { post:window.__post, note:$('memNote').textContent,
             cleared:($('memLinkCust')||{}).value };
  });
  console.log('   '+JSON.stringify(t.post[0]));
  const b=(t.post[0]||{}).body||{};
  ok(b.cust==='7777000003'&&b.dc==='999888777'&&b.plan==='monitor'
     &&b.dc_name==='someone','★★★会員番号・Discord の番号・プラン・表示名を送る');
  ok(/つなぎました/.test(t.note)&&/付けた 3/.test(t.note),
     '★★★結果（付けたロールの数）を出す');
  ok(t.cleared==='','★入れた欄は空に戻す');
  ok(t.post.filter((x)=>x.u==='list').length===1,
     '★★つないだあと一覧を出し直す');
}

console.log('\n=== ④ 付け直す・解約にする・つなぎを外す ===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[];
    await memSyncGo('7777000001');
    await new Promise((x)=>setTimeout(x,200));
    const one=$('memNote').textContent;
    window.__post=[];
    await memSyncGo();
    await new Promise((x)=>setTimeout(x,200));
    const all=window.__post.filter((x)=>x.u==='sync')[0];
    window.__post=[];
    await memStateGo('7777000001','canceled');
    await new Promise((x)=>setTimeout(x,200));
    const st=window.__post.filter((x)=>x.u==='state')[0];
    window.__post=[];
    await memUnlinkGo('7777000001');
    await new Promise((x)=>setTimeout(x,200));
    const un=window.__post.filter((x)=>x.u==='unlink')[0];
    return { one:one, all:all, st:st, un:un,
             note:$('memNote').textContent };
  });
  ok(/2人を見ました/.test(t.one)&&/外した 2/.test(t.one),
     '★★★1人だけ付け直せる（結果を出す）');
  ok(t.all&&!((t.all.body||{}).cust),
     '★★★「ぜんぶ付け直す」は cust を送らない');
  ok((t.st.body||{}).cust==='7777000001'
     &&(t.st.body||{}).state==='canceled',
     '★★★「解約にする」は state=canceled を送る');
  ok((t.un.body||{}).cust==='7777000001','★★★「つなぎを外す」も送れる');
  ok(/つなぎを外しました/.test(t.note),'★結果を出す');
}

console.log('\n=== ⑤ 作業者の端末では押せない ===');
{
  const t=await p.evaluate(async()=>{
    syncRole='staff'; roleApply();
    window.__post=[];
    await memListGo();
    await memLinkGo();
    await memSyncGo();
    await new Promise((x)=>setTimeout(x,150));
    const out={ post:window.__post.length,
                note:$('memNote').textContent };
    syncRole='admin'; roleApply();
    return out;
  });
  console.log('   '+t.note);
  ok(t.post===0,'★★★作業者の端末では1回も呼ばない');
  ok(/管理者|作業者/.test(t.note),'★★理由を出す');
}

console.log('\n=== ⑥ 間違えて作った行を消す（8.64・カジの依頼）===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[];
    await memListGo();
    await new Promise((x)=>setTimeout(x,200));
    const btns=[].slice.call($('memBox').querySelectorAll('button'))
      .map((b)=>(b.textContent||'').trim());
    /* 行ごとに「行を消す」が出ているか（解約で Discord なしの行だけ）。 */
    /* 行は <div style="margin:4px 0"> の1つずつ（外側の箱は数えない）。 */
    const rows=[].slice.call($('memBox')
      .querySelectorAll('div[style="margin:4px 0"]'));
    const per=rows.map((d)=>({
      t:(d.textContent||'').replace(/\s+/g,' ').slice(0,28),
      del:/行を消す/.test(d.innerHTML) }));
    window.__post=[];
    await memDelGo('7777009198');
    await new Promise((x)=>setTimeout(x,200));
    return { n:btns.filter((x)=>x==='行を消す').length, per:per,
             post:window.__post, note:$('memNote').textContent };
  });
  console.log('   '+JSON.stringify({ n:t.n, per:t.per.map((x)=>x.del),
    post:(t.post[0]||{}).u }));
  ok(t.n===1,'★★★「行を消す」は1つだけ（解約で Discord なしの行）');
  ok(t.per.filter((x)=>x.del).length===1
     &&/9198/.test((t.per.filter((x)=>x.del)[0]||{}).t||''),
     '★★★出ているのは …9198（解約・Discord なし）の行だけ');
  ok(!t.per.filter((x)=>/0003/.test(x.t))[0].del,
     '★★★解約でも**つないである**行には出さない（先に外す）');
  ok(!t.per.filter((x)=>/0001/.test(x.t))[0].del,
     '★★★有効でつないである行には出さない');
  ok(!t.per.filter((x)=>/0002/.test(x.t))[0].del,
     '★★★期限切れ（解約ではない）行にも出さない');
  ok((t.post[0]||{}).u==='del'&&((t.post[0]||{}).body||{}).cust==='7777009198',
     '★★★押すと会員番号を送る');
  ok(/行を消しました/.test(t.note)&&/9198/.test(t.note),
     '★★結果を出す（下4桁で）');
}

await T.done();
})();
