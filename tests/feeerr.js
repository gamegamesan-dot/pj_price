/* 画面：手数料がだめだった理由を全文で出す／1件ためす（6.142）
   「だめ 1071件：HTTP 400 InvalidInput: This is an invali…」で切れていて、
   何が不正なのか分からなかった。
   ・一覧の上の案内は短く出し、**全文**は折りたたみに入れる
   ・⚙「Amazon刈取」の「手数料を1件ためす」で、HTTP・理由の全文・
     送った中身・拾えた内訳を出す（D1 は書かない窓口）
   ・作業者用のキーでは出さない（Amazon に問い合わせるため） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：手数料の理由を全文で出す');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

const LONG='HTTP 400 InvalidInput: This is an invalid request. '
  +'Please verify your request and try again. '
  +'(FeesEstimateByIdRequestList is not a valid field for this operation)';

/* ---- 1. 一覧の案内：短く出して、全文は折りたたみ ---- */
let r=await p.evaluate((long)=>{
  const h=mwFeeNote({ n:1237, ok:0, ng:1071, none:0,
    why:[{ why:long, n:1071 }] });
  const d=document.createElement('div'); d.innerHTML=h;
  return { html:h, text:d.textContent,
    det:d.querySelectorAll('details').length,
    sum:(d.querySelector('summary')||{}).textContent||'' };
},LONG);
ok(/商品ごとの実額 0件/.test(r.text)&&/仮の手数料 1071件/.test(r.text),
   '★件数はいままでどおり出る');
ok(/だめ 1071件/.test(r.text),'★だめな件数が出る');
ok(r.det===1&&/全文/.test(r.sum),'★★全文の折りたたみが付く');
ok(r.text.indexOf(LONG)>=0,
   '★★★理由の全文が出る（以前は40字で「This is an invali…」で切れていた）');
ok(/FeesEstimateByIdRequestList/.test(r.text),
   '★★どの項目が不正かまで読める');

/* 短い理由だけのときも壊れない */
r=await p.evaluate(()=>{
  const d=document.createElement('div');
  d.innerHTML=mwFeeNote({ n:10, ok:9, ng:1, none:0,
    why:[{ why:'手数料の明細がありません', n:1 }] });
  return d.textContent;
});
ok(/手数料の明細がありません/.test(r),'★短い理由はそのまま');
r=await p.evaluate(()=>{
  const d=document.createElement('div');
  d.innerHTML=mwFeeNote({ n:10, ok:10, ng:0, none:0, why:[] });
  return { t:d.textContent, det:d.querySelectorAll('details').length };
});
ok(r.det===0&&/実額 10件/.test(r.t),'★全部取れていれば折りたたみは出ない');

/* ---- 2. 1件ためす ---- */
const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  window.__url='';
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u);
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:'admin'}),{status:200});
    if(/\/mw\/fee\/test/.test(url)){
      window.__url=url;
      return new Response(JSON.stringify(o.body),{status:o.status||200});
    }
    return real(u,i);
  };
  syncRole=o.role||'admin'; roleApply();
  $('mwFeeTestAsin').value=o.asin===undefined?'B0SAIVA001':o.asin;
  $('mwFeeTestPrice').value=String(o.price===undefined?9638:o.price);
},o);
const note=async()=>await p.evaluate(()=>$('mwFeeTestNote').textContent);

await setup({ body:{ ok:true, asin:'B0SAIVA001', price:9638, http:200, err:'',
  sent:[{IdType:'ASIN',IdValue:'B0SAIVA001'}], got_n:1, got:[{Status:'Success'}],
  pick:{ ok:true, ref:1484, fba:441, tax:148, total:2073 } }});
await openCsvBoxes(p);
await p.evaluate(()=>switchTab('G'));
await p.waitForTimeout(120);
await p.click('#mwFeeTestBtn');
await p.waitForTimeout(250);
let n=await note();
console.log('   '+n.slice(0,120));
ok(/取れました/.test(n),'★取れたらそう出る');
ok(/1,484/.test(n)&&/441/.test(n)&&/148/.test(n)&&/2,073/.test(n),
   '★★内訳（販売手数料・FBA・消費税・合計）を出す');
let u=await p.evaluate(()=>window.__url);
ok(/asin=B0SAIVA001/.test(u)&&/price=9638/.test(u),'★ASIN と売値を送る');

await setup({ body:{ ok:false, asin:'B0SAIVA001', price:9638, http:400,
  err:LONG, sent:[{IdType:'ASIN',IdValue:'B0SAIVA001'}], got_n:0, got:[],
  pick:null }});
await openCsvBoxes(p);
await p.evaluate(()=>switchTab('G'));
await p.waitForTimeout(120);
await p.click('#mwFeeTestBtn');
await p.waitForTimeout(250);
n=await note();
ok(/取れませんでした/.test(n)&&/HTTP 400/.test(n),'★だめならHTTPを出す');
ok(n.indexOf(LONG)>=0,'★★★理由の全文を出す');
ok(/IdValue/.test(n),'★★送った中身も見られる');

/* ASIN の形が違うときは送らない */
await setup({ asin:'xxx', body:{ ok:true } });
await openCsvBoxes(p);
await p.evaluate(()=>switchTab('G'));
await p.waitForTimeout(120);
await p.click('#mwFeeTestBtn');
await p.waitForTimeout(200);
n=await note();
/* 6.167（【V】）本・雑誌の ASIN は B で始まらない10桁なので、
   断る条件は「英数字10桁かどうか」にした。 */
ok(/英数字10桁/.test(n)&&!(await p.evaluate(()=>window.__url)),
   '★ASIN の形が違えば送らない（英数字10桁・6.167）');

/* 作業者では使えない（Amazon に問い合わせるため） */
await setup({ role:'staff', body:{ ok:true } });
await openCsvBoxes(p);
await p.evaluate(()=>switchTab('G'));
await p.waitForTimeout(120);
const hid=await p.evaluate(()=>{
  const el=$('mwFeeTestBtn').closest('.cfgprice');
  return !!el&&getComputedStyle(el).display==='none';
});
ok(hid,'★★作業者の画面では欄ごと隠れている');
/* 隠れていても、古い画面や履歴から呼ばれたときに止まること。 */
await p.evaluate(()=>mwFeeTestRun());
await p.waitForTimeout(150);
n=await note();
ok(/管理者用のキー/.test(n)&&!(await p.evaluate(()=>window.__url)),
   '★★作業者用のキーでは送らない');

await T.done();
})();
