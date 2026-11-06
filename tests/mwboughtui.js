/* 画面：仕入れ済み（MW で売り切れ・CSV から消えた商品）6.143
   ・一覧の上に「仕入れ済み」と「これから仕入れる」の2つの区分を出し、件数も出す
   ・仕入れ済みの行からも Amazon に登録できる（CSV から消えても外さない）
   ・卸値は仕入れ時の値。CSV に戻った行は、いまの卸値も見せる
   ・登録済み（pj 以外）の行は登録に回さず、そう出す
   ・「最新を取り直す」「登録済みにする」「この区分から外す」が効く
   ・「すべて外す」は仕入れ済みの行を消さない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：仕入れ済みの区分');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

const ROWS=[
  /* 仕入れ済み（CSV から消えた）。登録できる形がそろっている。 */
  { jan:'4902370556789', qty:2, at:'2026-11-01T02:00:00Z', gone:1,
    sha:'M200', kishu:'NS2', cond:'新品', mw_name:'ヨッシークラフトワールド',
    amz_name:'ヨッシー クラフトワールド', wholesale:4000, mw_wholesale:null,
    stock:0, ship_days:1, asin:'B07MLZ2JKF', price:5980, basis:'カート',
    fee_total:900, fee_ref:600, fee_fba:230, fee_tax:70, fee_base:5980,
    rst:'ok', pics:1, reg_state:'', reg_sku:null, cand_n:1 },
  /* 仕入れ済み＋もう登録してある（pj 以外） */
  { jan:'4902370551111', qty:1, at:'2026-11-02T02:00:00Z', gone:1,
    sha:'M200', kishu:'NS2', cond:'新品', mw_name:'すでに登録した商品',
    wholesale:3000, stock:0, ship_days:1, asin:'B0DONE0001', price:4980,
    fee_total:700, rst:'ok', pics:0, reg_state:'other',
    reg_sku:'mwgame-20261101-N-B0DONE0001-3300', reg_at:'2026-11-03T02:00:00Z',
    cand_n:1 },
  /* これから仕入れる（MW にある）。卸値が値上がりしている */
  { jan:'4902370552222', qty:3, at:'2026-11-04T02:00:00Z', gone:0,
    sha:'M200', kishu:'NS2', cond:'新品', mw_name:'これから買う商品',
    wholesale:2000, mw_wholesale:2500, stock:5, ship_days:1,
    asin:'B0LIVE0001', price:3980, fee_total:600, rst:'ok', pics:0,
    reg_state:'', cand_n:1 }
];
const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('mwShipFee').value='0'; $('fx').value='160';
  window.__posts=[]; window.__rows=o.rows;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body)?JSON.parse(i.body):null;
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:o.role||'admin'}),{status:200});
    if(/\/mw\/buy\/refresh/.test(url)){
      window.__posts.push({p:'refresh',b:b});
      return new Response(JSON.stringify({ok:true,jan:b.jan,asin:'B07MLZ2JKF',
        price:6480,basis:'カート',rst:'ok',fee:{ok:true,total:950},
        reg_state:'',reg_sku:''}),{status:200});
    }
    if(/\/mw\/buy\/check/.test(url)){
      window.__posts.push({p:'check',b:b});
      return new Response(JSON.stringify({ok:true,done:(b.jans||[]).length,found:1}),
        {status:200});
    }
    if(/\/mw\/buy/.test(url)){
      if((i||{}).method==='POST'){ window.__posts.push({p:'buy',b:b});
        return new Response(JSON.stringify({ok:true,n:1,rows:[]}),{status:200}); }
      const rows=window.__rows;
      return new Response(JSON.stringify({ok:true,rows:rows,n:rows.length,
        gone:rows.filter((r)=>r.gone===1).length,
        live:rows.filter((r)=>r.gone!==1).length,
        reg:rows.filter((r)=>r.reg_state).length,qty:0,yen:0}),{status:200});
    }
    if(/\/mw\/put/.test(url)){
      window.__posts.push({p:'put',b:b});
      return new Response(JSON.stringify({ok:true,plan:[],rows:[],sent_ok:0}),{status:200});
    }
    return real(u,i);
  };
  syncRole=o.role||'admin'; roleApply();
  switchTab('F');
},o);
const show=async()=>{ await p.evaluate(()=>mwBuyShow()); await p.waitForTimeout(250); };
const txt=async(sel)=>await p.evaluate((s)=>{
  const el=document.querySelector(s); return el?el.textContent:''; },sel);

/* ---- 1. 2つの区分と件数 ---- */
await setup({rows:ROWS});
await openCsvBoxes(p);
await show();
let note=await txt('#csvMwAmzListNote');
console.log('   '+note.replace(/\s+/g,' ').slice(0,140));
ok(/印を付けた 3件/.test(note),'★印の総数を出す');
ok(/仕入れ済み 2件/.test(note),'★★★仕入れ済みの件数を出す');
ok(/これから仕入れる 1件/.test(note),'★★これから仕入れる件数も出す');
ok(/登録済み 1件/.test(note),'★登録済みの件数も出す');
let list=await txt('#csvMwAmzList');
ok(/仕入れ済み（MW で売り切れ・CSV から消えた商品） 2件/.test(list),
   '★★★仕入れ済みの見出しを出す');
ok(/これから仕入れる（MW にあります） 1件/.test(list),'★★もう一方の見出しも出す');
ok(/MWで売り切れ/.test(list),'★行に「MWで売り切れ」を出す');
ok(/登録済み（pj 以外）/.test(list),'★★★登録済み（pj 以外）を出す');
ok(/卸値 ¥4,000（税抜・仕入れ時）/.test(list),'★★★卸値は仕入れ時の値と分かる');
ok(/いまの MW の卸値 ¥2,500/.test(list),
   '★★CSV に戻った行は、いまの MW の卸値も見せる');
ok(/写真 1枚/.test(list),'★写真の枚数を出す');
ok(/SKU mwgame-20261101-N-B0DONE0001-3300/.test(list),'★登録済みの SKU を出す');

/* ---- 2. 仕入れ済みの行が登録に回る（CSV から消えても外さない）---- */
let pk=await p.evaluate(()=>{
  const r=mwRegPick(mwBuyRows);
  return { take:r.take.map((x)=>x.jan), skip:r.skip.map((x)=>({j:x.r.jan,w:x.why})) };
});
console.log('   '+JSON.stringify(pk));
ok(pk.take.indexOf('4902370556789')>=0,
   '★★★CSV から消えた行も「Amazon に登録」に回る（v229 までは外れていた）');
ok(pk.take.indexOf('4902370552222')>=0,'★MW にある行も今までどおり回る');
ok(pk.skip.some((x)=>x.j==='4902370551111'&&/登録済み（pj 以外）/.test(x.w)),
   '★★★登録済みの行は回さず、理由を出す');
let sku=await p.evaluate(()=>{
  const r=mwBuyRows.filter((x)=>x.jan==='4902370556789')[0];
  return { sku:mwRegSku(r,'20261106'), cost:mwCost(r) };
});
ok(sku.cost===4400,'★★仕入原価は仕入れ時の卸値×1.1（4,400円）');
ok(sku.sku==='mwgame-20261106-N-B07MLZ2JKF-4400',
   '★★★SKU の形は今までと同じ（mwgame-仕入日-N-ASIN-仕入原価）');

/* ---- 3. 最新を取り直す ---- */
await p.click('#csvMwAmzList [data-buyref="4902370556789"]');
await p.waitForTimeout(300);
let posts=await p.evaluate(()=>window.__posts);
ok(posts.some((x)=>x.p==='refresh'&&x.b.jan==='4902370556789'),
   '★★「最新を取り直す」でその1件だけ送る');
let row1=await txt('#csvMwAmzList [data-buyrow="4902370556789"]');
ok(/取り直しました/.test(row1)&&/¥6,480/.test(row1)&&/¥950/.test(row1),
   '★★★取り直した最安値と手数料をその場に出す');

/* ---- 4. 登録済みにする／この区分から外す ---- */
await setup({rows:ROWS});
await openCsvBoxes(p);
await show();
await p.click('#csvMwAmzList [data-buydone="4902370556789"]');
await p.waitForTimeout(300);
posts=await p.evaluate(()=>window.__posts);
ok(posts.some((x)=>x.p==='buy'&&x.b.items&&x.b.items[0].reg==='other'),
   '★★「登録済みにする」で reg:other を送る');
await setup({rows:ROWS});
await openCsvBoxes(p);
await show();
await p.click('#csvMwAmzList [data-buyoff="4902370556789"]');
await p.waitForTimeout(300);
posts=await p.evaluate(()=>window.__posts);
ok(posts.some((x)=>x.p==='buy'),'★★「この区分から外す」が送られる');
ok(await p.evaluate(()=>{
  const b=document.querySelector('#csvMwAmzList [data-buyoff="4902370552222"]');
  return !!b&&b.textContent==='外す'; }),
  '★MW にある行のボタンは「外す」のまま');

/* ---- 5. まとめて確かめる ---- */
await setup({rows:ROWS});
await openCsvBoxes(p);
await show();
await p.click('#mwBuyChkAll');
await p.waitForTimeout(300);
posts=await p.evaluate(()=>window.__posts);
let chk=posts.filter((x)=>x.p==='check')[0];
ok(!!chk&&chk.b.jans.length===1&&chk.b.jans[0]==='4902370556789',
   '★★まだ登録済みでない仕入れ済みの行だけを確かめる');

/* ---- 6. 「すべて外す」は仕入れ済みを消さない ---- */
await setup({rows:ROWS});
await openCsvBoxes(p);
await show();
await p.evaluate(()=>mwBuyOffAll());
await p.waitForTimeout(300);
posts=await p.evaluate(()=>window.__posts);
let off=posts.filter((x)=>x.p==='buy')[0];
console.log('   '+JSON.stringify(off&&off.b));
ok(!!off&&off.b.items.length===1&&off.b.items[0].jan==='4902370552222',
   '★★★「すべて外す」は MW にある行だけ（仕入れ済みは残す）');

/* ---- 7. 作業者の画面 ---- */
await setup({rows:ROWS,role:'staff'});
await openCsvBoxes(p);
await show();
let hid=await p.evaluate(()=>{
  const b=document.querySelector('#csvMwAmzList [data-buyref]');
  return !!b&&getComputedStyle(b).display==='none'; });
ok(hid,'★★作業者には「最新を取り直す」を出さない（Amazon に問い合わせるため）');
list=await txt('#csvMwAmzList');
ok(/仕入れ済み（MW で売り切れ・CSV から消えた商品） 2件/.test(list),
   '★★作業者にも区分と件数は出す');

await T.done();
})();
