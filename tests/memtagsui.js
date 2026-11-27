/* 画面：会員の Shopify の顧客タグ（8.110・v361）

   ・一覧に「Shopify のタグ：あり／なし／ずれ」（理由つき）
   ・「タグを付け直す」（1人）で POST /mem/tags
   ・つないだ・付け直したときの文に、タグを付けた・外した数と理由 */
const { harness } = require('./lib');
const T = harness('画面：会員の Shopify の顧客タグ（8.110）');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__post=[];
  window.__mem={ ok:true, n:4, on:true, guild:true, roles_ok:4, vars_ok:3, grace:3, stack:true,
    mon_off:true, mon_days:21, token:true, hook:true, shop:true, tag_cols:true,
    rows:[
      { cust:'7777000001', cust4:'0001', dc:'111', dc_name:'kaji', plan:'monitor', paid_to:'2026-12-17T00:00:00Z',
        state:'active', roles:'9000', days:20, want:1, shop_tags:'grade-monitor,member-list',
        shop_tag_at:'2026-11-27T00:00:00Z', shop_tag_err:'', tag_want:'grade-monitor,member-list', tag_ok:true },
      { cust:'7777000002', cust4:'0002', dc:'222', dc_name:'b', plan:'light', paid_to:'2026-12-17T00:00:00Z',
        state:'active', roles:'9001', days:20, want:1, shop_tags:'', shop_tag_at:'2026-11-27T00:00:00Z',
        shop_tag_err:'Shopify の権限が足りません（write_customers）', tag_want:'grade-light,member-list', tag_ok:false },
      { cust:'7777000003', cust4:'0003', dc:'', dc_name:'', plan:'light', paid_to:'2026-11-01T00:00:00Z',
        state:'expired', roles:'', days:-26, want:0, shop_tags:'', shop_tag_at:'2026-11-27T00:00:00Z',
        shop_tag_err:'', tag_want:'', tag_ok:true },
      { cust:'7777000004', cust4:'0004', dc:'444', dc_name:'d', plan:'standard', paid_to:'2026-12-17T00:00:00Z',
        state:'active', roles:'9002', days:20, want:1, shop_tags:'', shop_tag_at:'', shop_tag_err:'',
        tag_want:'grade-standard,member-list', tag_ok:false } ] };
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), o=i||{};
    const body=o.body?JSON.parse(String(o.body)):null;
    if(/\/whoami/.test(url))return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    if(/\/mem\/tags/.test(url)){ window.__post.push({ u:'tags', body:body });
      return res({ ok:true, tags:{ ok:true, add:['member-list','grade-standard'], del:[] } }); }
    if(/\/mem\/link/.test(url)){ window.__post.push({ u:'link', body:body });
      return res({ ok:true, sync:{ n:1, add:1, del:0, fail:0, tag_add:2, tag_del:0, tag_fail:0,
        rows:[{ tags:{ ok:true, add:['member-list','grade-monitor'], del:[], why:'' } }] } }); }
    if(/\/mem\/sync/.test(url)){ window.__post.push({ u:'sync', body:body });
      return res({ ok:true, n:1, add:0, del:0, fail:0, tag_add:0, tag_del:0, tag_fail:1,
        rows:[{ tags:{ ok:false, why:'Shopify の権限が足りません（write_customers）' } }] }); }
    if(/\/mem$/.test(url))return res(window.__mem);
    return real(u,i);
  };
  switchTab('G'); syncRole='admin'; roleApply();
  window.confirm=()=>true;
});
await p.evaluate(()=>memListGo());
await p.waitForFunction(()=>/Shopify のタグ/.test($('memBox').textContent),null,{timeout:5000});
const t=await p.evaluate(()=>({ all:$('memBox').textContent,
  rows:[...$('memBox').querySelectorAll('div > div')].map((d)=>d.textContent) }));
const line=(c)=>{ const i=t.all.indexOf('…'+c); const j=t.all.indexOf('…',i+1); return i<0?'':t.all.slice(i,j<0?undefined:j); };
console.log('   '+line('0001').slice(0,160));
ok(/Shopify のタグ 付けられる/.test(t.all),'★一覧の上に「Shopify のタグ 付けられる」');
ok(/Shopify のタグ：あり/.test(line('0001')),'★★★合っている会員は「Shopify のタグ：あり」');
ok(/Shopify のタグ：なし/.test(line('0002'))&&/write_customers/.test(line('0002')),'★★★付いていない会員は「なし」と理由（足りない権限）');
ok(/Shopify のタグ：なし（会員でないので付けない）/.test(line('0003')),'★期限切れの会員は「なし（会員でないので付けない）」');
ok(/まだ確かめていません/.test(line('0004')),'★まだ確かめていない会員はそう出す');
const nb=await p.evaluate(()=>[...$('memBox').querySelectorAll('button')].filter((b)=>/memTagsGo/.test(b.getAttribute('onclick')||'')).length);
ok(nb===4,'★★各行に「タグを付け直す」（'+nb+'）');
const fx=await p.evaluate(async()=>{ await memTagsGo('7777000004');
  return { post:window.__post.find((x)=>x.u==='tags'), note:$('memNote').textContent }; });
ok(fx.post&&fx.post.body.cust==='7777000004','★★★「タグを付け直す」で POST /mem/tags（その会員だけ）');
ok(/付けた member-list・grade-standard/.test(fx.note),'★付けたタグを出す');
const lk=await p.evaluate(async()=>{ $('memLinkCust').value='7777000005'; $('memLinkDc').value='555';
  $('memLinkPlan').value='monitor'; await memLinkGo(); return $('memNote').textContent; });
ok(/Shopify のタグ：付けた 2・外した 0/.test(lk),'★★手でつないだときの文にタグの結果も出す');
const sy=await p.evaluate(async()=>{ await memSyncGo('7777000002'); return $('memNote').textContent; });
ok(/付けられなかった 1/.test(sy)&&/write_customers/.test(sy),'★★付け直したときの文に、付けられなかった数と理由');
const no=await p.evaluate(()=>{ const d=Object.assign({},window.__mem,{ tag_cols:false }); return memRowsHtml(d); });
ok(/D1 の列なし（migrate-0076）/.test(no),'★D1 の列が無いときはそう出す');
T.done();
})();
