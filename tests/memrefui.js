/* 画面：会員の紹介者と紹介のお礼（8.118・カジの依頼）

   ・⚙「手でつなぐ」に「紹介者（任意）」。POST /mem/link に ref を渡す
   ・⚙に「紹介のお礼の率／最長の月数」（既定 40%・12か月）。pj-sync に渡して控える
   ・会員の一覧の各行に紹介者・「紹介者を直す」（POST /mem/ref）
   ・一覧の下に「紹介者ごとの集計」と「紹介のお礼（月ごと）」 */
const { harness } = require('./lib');
const T = harness('画面：会員の紹介者と紹介のお礼（8.118）');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__post=[];
  window.__mem={ ok:true, n:3, on:true, guild:true, roles_ok:4, vars_ok:3, grace:3, stack:true,
    mon_off:true, mon_days:21, token:true, hook:true, shop:true, tag_cols:true,
    ref_col:true, ref_rate:40, ref_months:12,
    refs:{ self:1, list:[ { ref:'NAKANO', n:4, paid:2, plans:{ monitor:1, light:1, standard:0, premium:1 } } ] },
    ref_pay:{ rate:40, max:12, months:[
      { month:'2026-11', pay:4712, unknown:1, rows:[ { ref:'NAKANO', n:2, yen:11780, unknown:0, pay:4712 },
                                                      { ref:'SATO', n:1, yen:0, unknown:1, pay:0 } ] } ] },
    rows:[
      { cust:'7777000001', cust4:'0001', dc:'111', dc_name:'a', plan:'light', paid_to:'2026-12-17T00:00:00Z',
        state:'active', roles:'9001', days:20, want:1, tag_ok:true, tag_want:'x', shop_tag_at:'x', ref:'NAKANO' },
      { cust:'7777005347', cust4:'5347', dc:'222', dc_name:'b', plan:'premium', paid_to:'2026-12-17T00:00:00Z',
        state:'active', roles:'9003', days:20, want:1, tag_ok:true, tag_want:'x', shop_tag_at:'x', ref:'（本人）' },
      { cust:'7777000003', cust4:'0003', dc:'333', dc_name:'c', plan:'standard', paid_to:'2026-12-17T00:00:00Z',
        state:'active', roles:'9002', days:20, want:1, tag_ok:true, tag_want:'x', shop_tag_at:'x', ref:'' } ] };
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), o=i||{};
    const body=o.body?JSON.parse(String(o.body)):null;
    if(/\/whoami/.test(url))return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    if(/\/mem\/ref/.test(url)){ window.__post.push({ u:'ref', body:body });
      return res({ ok:true, ref:String(body.ref||'').toUpperCase() }); }
    if(/\/mem\/link/.test(url)){ window.__post.push({ u:'link', body:body });
      return res({ ok:true, sync:{ n:1, add:1, del:0, fail:0, rows:[] } }); }
    if(/\/mem$/.test(url))return res(window.__mem);
    return real(u,i);
  };
  switchTab('G'); syncRole='admin'; roleApply();
  window.confirm=()=>true;
});

console.log('=== ① ⚙の欄 ===');
{
  const t=await p.evaluate(()=>({ rate:$('memRefRate').value, months:$('memRefMonths').value,
    ref:!!$('memLinkRef'), ph:$('memLinkRef').getAttribute('placeholder')||'',
    note:document.body.textContent }));
  ok(t.rate==='40'&&t.months==='12','★★★お礼の率は既定40%・最長の月数は既定12か月');
  ok(t.ref&&/NAKANO/.test(t.ph),'★★★「手でつなぐ」に「紹介者（任意）」の欄');
  ok(/氏名・住所・メールは入れません/.test(t.note),'★★氏名・住所・メールは入れないと書く');
  ok(/モニターの期間は数えません/.test(t.note),'★モニターの期間は数えないと書く');
  const src=await p.evaluate(()=>document.documentElement.outerHTML);
  ok((src.match(/'memRefRate','memRefMonths'/g)||[]).length>=2,'★★⚙を控える一覧と pj-sync に渡す一覧の両方に入れる');
}

console.log('=== ② 手でつなぐときに紹介者を渡す ===');
{
  const r=await p.evaluate(async()=>{ $('memLinkCust').value='7777000009'; $('memLinkDc').value='999';
    $('memLinkRef').value=' nakano '; await memLinkGo();
    return { post:window.__post.find((x)=>x.u==='link'), left:$('memLinkRef').value }; });
  ok(r.post&&r.post.body.ref==='nakano','★★★POST /mem/link に紹介者を渡す（前後の空白は落とす）');
  ok(r.left==='','★つないだら欄を空にする');
}

console.log('=== ③ 一覧の各行の紹介者・直すボタン ===');
await p.evaluate(()=>memListGo());
await p.waitForFunction(()=>/紹介者ごとの集計/.test($('memBox').textContent),null,{timeout:5000});
{
  const t=await p.evaluate(()=>$('memBox').textContent);
  const line=(c)=>{ const i=t.indexOf('…'+c); const j=t.indexOf('…',i+1); return i<0?'':t.slice(i,j<0?undefined:j); };
  ok(/紹介者 NAKANO/.test(line('0001')),'★★★行に紹介者を出す');
  ok(/紹介者なし（本人）/.test(line('5347')),'★★★…5347 は「紹介者なし（本人）」');
  ok(/紹介者 —/.test(line('0003')),'★まだ入れていない人は「—」');
  const nb=await p.evaluate(()=>[...$('memBox').querySelectorAll('button')].filter((b)=>/memRefGo/.test(b.getAttribute('onclick')||'')).length);
  ok(nb===3,'★★★各行に「紹介者を直す」（'+nb+'）');
  const r=await p.evaluate(async()=>{ window.prompt=()=>'sato'; await memRefGo('7777000003');
    return { post:window.__post.find((x)=>x.u==='ref'), note:$('memNote').textContent }; });
  ok(r.post&&r.post.body.cust==='7777000003'&&r.post.body.ref==='sato','★★★「紹介者を直す」で POST /mem/ref（その会員だけ）');
  ok(/紹介者を「SATO」にしました/.test(r.note),'★直した結果を出す');
  const n0=await p.evaluate(async()=>{ const n=window.__post.length; window.prompt=()=>null;
    await memRefGo('7777000003'); return window.__post.length-n; });
  ok(n0===0,'★取り消したら何もしない');
}

console.log('=== ④ 紹介者ごとの集計・月ごとのお礼 ===');
{
  const t=await p.evaluate(()=>$('memBox').textContent);
  console.log('   '+t.slice(t.indexOf('紹介者ごとの集計')).replace(/\s+/g,' ').slice(0,300));
  ok(/NAKANO 紹介した会員 4人 いま有料 2人（ライト 1・スタンダード 0・プレミアム 1） モニター 1人/.test(t.replace(/\s+/g,' ')),
     '★★★紹介者ごとに人数・いま有料の人数・プラン別');
  ok(/紹介者なし（本人） 1人/.test(t),'★紹介者なし（本人）の人数');
  ok(/2026-11 合計 ¥4,712/.test(t.replace(/\s+/g,' ')),'★★★月ごとのお礼の合計');
  ok(/NAKANO：¥4,712（支払い 2件・¥11,780）/.test(t),'★★★紹介者ごとのお礼と元の金額');
  ok(/金額が分からない支払い 1件（足していません）/.test(t),'★★金額が分からない支払いは足さないと出す');
  ok(/率 40%・最長 12か月/.test(t),'★⚙の率と月数を出す');
  const no=await p.evaluate(()=>memRowsHtml(Object.assign({},window.__mem,{ ref_col:false })));
  ok(/migrate-0079/.test(no)&&!/紹介者を直す/.test(no),'★D1 の列が無いときはそう出す（直すボタンも出さない）');
}
T.done();
})();
