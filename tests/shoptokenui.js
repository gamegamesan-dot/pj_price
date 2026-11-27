/* 画面：⚙「Shopify の通行証を取り直す」（8.112・v363） */
const { harness } = require('./lib');
const T = harness('画面：Shopify の通行証を取り直す（8.112）');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__post=[]; window.__res={ ok:true, kind:'client', scopes:['read_products','read_customers','write_customers'], customers:[] };
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  const real=window.fetch;
  window.fetch=async(u,i)=>{ const url=String(u), o=i||{};
    if(/\/whoami/.test(url))return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    if(/\/shop\/token\/reset/.test(url)){ window.__post.push({ m:o.method }); return res(window.__res); }
    return real(u,i); };
  switchTab('G'); syncRole='admin'; roleApply();
});
const a=await p.evaluate(async()=>{ const has=!!$('shopTokenReset'); await shopTokenResetGo();
  return { has, post:window.__post.slice(), note:$('shopTokenNote').textContent }; });
ok(a.has,'★★⚙に「Shopify の通行証を取り直す」がある');
ok(a.post.length===1&&a.post[0].m==='POST','★★★押すと pj-sync に取り直しを頼む（POST /shop/token/reset）');
ok(/取り直しました/.test(a.note)&&/read_customers/.test(a.note)&&/そろっています/.test(a.note),'★★新しい権限の名前と「そろっています」を出す');
const b=await p.evaluate(async()=>{ window.__res={ ok:true, kind:'client', scopes:['read_products'], customers:['read_customers','write_customers'] };
  await shopTokenResetGo(); return $('shopTokenNote').textContent; });
ok(/まだありません：read_customers・write_customers/.test(b),'★★★足りない権限はそう出す');
const c=await p.evaluate(async()=>{ window.__res={ ok:false, error:'fixed', detail:'固定の鍵（SHOPIFY_ADMIN_TOKEN）を使っているので取り直せません' };
  await shopTokenResetGo(); return $('shopTokenNote').textContent; });
ok(/取り直せませんでした/.test(c)&&/SHOPIFY_ADMIN_TOKEN/.test(c),'★取り直せないときは理由を出す');
T.done();
})();
