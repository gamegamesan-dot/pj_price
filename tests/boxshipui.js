/* 画面：箱ものの「送料用の重さ」の⚙・段の表・いまある商品を直す（8.81）

   カジの依頼（2026-11-20）会員便の送料を実額に合わせる
     ・配送プロファイルは作らず、**いまの会員便に段を足す**
     ・箱ものには pj が「送料用の重さ」を Shopify に入れる（実際の重さは pj に残す）
     ・会員用の商品を海外向けの商品リストから外す
   ここで見ること
     ① ⚙の欄（既定オフ・海外向けの商品リストの名前）と、Shopify に入れる段の表
     ② ⚙を入れると、案の「送料が足りない品」が 0 件になる・重さが分かれて出る
     ③ 商品CSV（手の流れ）の重さも送料用の重さになる
     ④ 「確かめる」「いまある会員用の商品を直す」（続きを自分で頼む）
     ⑤ 入れたらすぐ pj-sync に送る／作業者は押せない */
const { harness } = require('./lib');
const fs=require('fs');
const path=require('path');
const T = harness('画面：箱ものの送料用の重さ（8.81）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',(d)=>d.accept());

const setup=async()=>await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__post=[]; window.__calls=[]; window.__srv={ at:'2026-11-20T00:00:00Z', settings:{} };
  window.__left=[2,0];
  const real=window.fetch;
  const res=(v,st)=>new Response(JSON.stringify(v),{status:st||200});
  window.fetch=async(u,i)=>{
    const url=String(u), op=i||{};
    if(/\/whoami/.test(url))return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url)){
      if(String(op.method||'')==='POST'){
        const b=JSON.parse(String(op.body||'{}'));
        window.__post.push(b);
        Object.assign(window.__srv.settings,b.settings||{});
      }
      return res({ ok:true, at:window.__srv.at, settings:window.__srv.settings });
    }
    if(/\/sub\/box\/sync/.test(url)){
      const b=JSON.parse(String(op.body||'{}'));
      window.__calls.push(b.approve?'go':'chk');
      const base={ ok:true, on:true, cols:true, ready:true, why:'', all:12, box_n:5,
        over:{ want:['Overseas products'], found:1, miss:[] }, errors:[] };
      if(!b.approve)return res(Object.assign(base,{ approve:false, todo:5, left:5,
        items:[{ jan:'4902370551011', name:'テストのゲーム 限定版', g:4000,
                 real_g:900, box:true, ship:'宅配便（60サイズ）', why:'重さ' },
               { jan:'4902370551010', name:'テストのゲーム 通常版', g:100,
                 real_g:100, box:false, ship:'クリックポスト', why:'海外のリスト' }] }));
      const left=window.__left.shift();
      return res(Object.assign(base,{ approve:true, todo:5, done:left?3:2,
        left:left===undefined?0:left, fail:0, items:[] }));
    }
    if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, n:0, rows:[] });
    if(/\/mw\/(amz|buy)/.test(url))return res({ ok:true, rows:[], n:0 });
    return real(u,i);
  };
  syncRole='admin'; roleApply();
});
await setup();

console.log('=== ① ⚙の欄と、Shopify に入れる段の表 ===');
{
  const t=await p.evaluate(()=>({
    on:!!$('subBoxOn')&&$('subBoxOn').checked===false,
    over:($('subShopOverseas')||{}).value,
    rows:Array.from(document.querySelectorAll('[data-boxtier]')).map((e)=>e.textContent),
    txt:($('subBoxTxt')||{}).textContent,
    off:/いまはオフ/.test($('subBoxTbl').textContent),
    inChk:ADV_SUBCHK.indexOf('subBoxOn')>=0,
    inSub:ADV_SUB.indexOf('subShopOverseas')>=0&&CSV_CFG_IDS.indexOf('subShopOverseas')>=0,
    btns:[($('subBoxChkBtn')||{}).textContent,($('subBoxGoBtn')||{}).textContent] }));
  console.log('   '+t.txt);
  console.log('   行 '+JSON.stringify([t.rows[0],t.rows[3],t.rows[7]]));
  ok(t.on,'★★★⚙「箱ものは送料用の重さで実額を取る」は既定オフ');
  ok(t.over==='Overseas products','★★海外向けの商品リストの名前（既定 Overseas products）');
  ok(t.txt==='250:200／350:300／1999:600／2999:520／3999:600／5999:800／8999:1000／0:1200',
     '★★★Shopify の会員便に入れる段を1行で出す');
  ok(t.rows.length===8&&/2,000〜2,999g¥520宅急便コンパクト（送料用の重さ 2,000g）/.test(t.rows[3])
     &&/9,000g〜¥1,200宅配便（100サイズ以上）（送料用の重さ 9,000g）/.test(t.rows[7])
     &&/0〜250g¥200薄物/.test(t.rows[0]),
     '★★★段の一覧（重さ・送料・送り方と送料用の重さ）');
  ok(t.off,'★オフのあいだは「いまはオフ」と出す');
  ok(t.inChk&&t.inSub,'★★pj-sync に送るまとまりに入っている');
  ok(/確かめる（何も変えない）/.test(t.btns[0])&&/いまある会員用の商品を直す/.test(t.btns[1]),
     '★★ボタンが2つある');
  /* ⚙の実額や会員便の段を変えると、表も変わる。 */
  const t2=await p.evaluate(()=>{
    $('gdShipBox60').value='850';
    $('gdShipBox60').dispatchEvent(new Event('input',{bubbles:true}));
    $('mwSubTiers').value='250:200／350:300／600:600／0:800';
    $('mwSubTiers').dispatchEvent(new Event('input',{bubbles:true}));
    const a=$('subBoxTxt').textContent;
    $('gdShipBox60').value='800';
    $('gdShipBox60').dispatchEvent(new Event('input',{bubbles:true}));
    $('mwSubTiers').value='';
    $('mwSubTiers').dispatchEvent(new Event('input',{bubbles:true}));
    return a;
  });
  console.log('   変えたあと '+t2);
  ok(t2==='250:200／350:300／600:600／1999:800／2999:520／3999:600／5999:850／8999:1000／0:1200',
     '★★★実額や会員便の段を変えると、表もその場で変わる');
}

console.log('\n=== ② ⚙を入れると、送料が足りない品が 0 件になる ===');
{
  const t=await p.evaluate(()=>{
    const big={ jan:'4902370551011', kishu:'NS', amz_name:'テストのゲーム 限定版',
                size_long:30, size_wid:22, size_hei:8, size_g:900 };
    const game={ jan:'4902370551010', kishu:'NS', amz_name:'テストのゲーム 通常版',
                 size_long:17, size_wid:10.5, size_hei:1.2, size_g:80 };
    $('subBoxOn').checked=false;
    const a=mwShipInfo(big), a2=mwShipInfo(game);
    const h0=subShortHtml([{ ship_short:'x', ship:'宅配便（60サイズ）', ship_yen1:600,
      ship_g:900, ship_cost:800, ship_short_gap:200 }]);
    $('subBoxOn').checked=true;
    $('subBoxOn').dispatchEvent(new Event('change',{bubbles:true}));
    const b=mwShipInfo(big), b2=mwShipInfo(game);
    const h1=subShortHtml([{ ship_box:true },{ ship_box:false }]);
    const off=/いまはオフ/.test($('subBoxTbl').textContent);
    return { a, a2, b, b2, h0, h1, off };
  });
  console.log('   オフ：'+JSON.stringify({ g:t.a.grams, yen1:t.a.yen1, short:t.a.short })
    +'　オン：'+JSON.stringify({ g:t.b.grams, real:t.b.real_g, yen1:t.b.yen1,
                                 short:t.b.short, text:t.b.text }));
  ok(t.a.short===true&&t.a.yen1===600&&t.a.grams===900,
     '★いままで（オフ）：60サイズは ¥600 しか受け取れず、不足');
  ok(t.b.short===false&&t.b.yen1===800&&t.b.grams===4000&&t.b.real_g===900
     &&t.b.box===true,'★★★オン：送料用の重さ 4,000g・¥800＝実額・不足なし（実際は 900g）');
  ok(t.b.text==='宅配便（60サイズ） ¥800（実費）','★★案にも「送り方 ¥◯（実費）」');
  ok(t.a2.yen1===200&&t.b2.yen1===200&&t.b2.grams===t.a2.grams&&t.b2.box===false,
     '★★★ゲームソフト1本の送料はいまと同じ（¥200）');
  ok(/箱ものは送料用の重さで実額を取る」を入れると/.test(t.h0),
     '★★足りない品が残っているときは、直し方を出す');
  ok(/会員便の送料が足りない品 0件/.test(t.h1)&&/箱もの 1件は送料用の重さで実額/.test(t.h1),
     '★★★オンで足りない品が無ければ「0件」と出す');
  ok(t.off===false,'★オンにすると表の「いまはオフ」が消える');
}

console.log('\n=== ③ 商品CSV（手の流れ）の重さも送料用の重さ ===');
{
  const t=await p.evaluate(()=>{
    const big={ jan:'4902370551011', kishu:'NS', name:'テストのゲーム 限定版',
                size_long:30, size_wid:22, size_hei:8, size_g:900, price:5000,
                max_qty:2 };
    const o=mwSubOpt();
    const csv=PJ_SHOPCSV.build([big],o);
    $('subBoxOn').checked=false;
    const csv0=PJ_SHOPCSV.build([big],mwSubOpt());
    $('subBoxOn').checked=true;
    const head=csv.split('\n')[0].split(','), row=csv.split('\n')[1];
    return { boxOn:o.boxOn, has4000:/,4000,/.test(row), has900:/,900,/.test(csv0.split('\n')[1]) };
  });
  ok(t.boxOn===true&&t.has4000,'★★★オン：CSV の重さも送料用の重さ（管理 API と同じ）');
  ok(t.has900,'★★オフ：今までどおり実際の重さ');
}

console.log('\n=== ④ 確かめる・いまある会員用の商品を直す ===');
{
  await p.evaluate(async()=>{ window.__calls=[]; await subBoxGo(false); });
  const a=await p.evaluate(()=>({ calls:window.__calls.slice(),
    box:$('subBoxBox').textContent,
    items:Array.from(document.querySelectorAll('[data-boxitem]')).map((e)=>e.textContent) }));
  console.log('   '+a.box.slice(0,120));
  ok(a.calls.join()==='chk','★★「確かめる」は数えるだけの口を1回呼ぶ');
  ok(/確かめました（何も変えていません）/.test(a.box)
     &&/会員用の商品 12件（うち箱もの 5件）/.test(a.box)
     &&/直す必要がある 5件/.test(a.box),'★★★件数が分かる');
  ok(/海外向けの商品リスト：見つかりました（1件・会員用の商品を外します）/.test(a.box),
     '★★海外向けの商品リストが見つかったかが分かる');
  ok(a.items.length===2&&/宅配便（60サイズ）4,000g（送料用）900g/.test(a.items[0])
     &&/クリックポスト100g100g/.test(a.items[1]),
     '★★★Shopify に入れる重さと実際の重さを並べて出す');
  await p.evaluate(async()=>{ window.__calls=[]; window.__left=[2,0]; await subBoxGo(true); });
  const b=await p.evaluate(()=>({ calls:window.__calls.slice(),
    box:$('subBoxBox').textContent, dis:$('subBoxGoBtn').disabled }));
  console.log('   呼び出し '+JSON.stringify(b.calls));
  ok(b.calls.join()==='go,go','★★★残りがあるあいだ、続きを自分で頼む');
  ok(/いまある会員用の商品を直しました/.test(b.box)&&/直した 5件/.test(b.box),
     '★★直した件数の合計を出す');
  ok(b.dis===false,'★終わったらボタンを戻す');
  /* オフのときは直さない。 */
  const c=await p.evaluate(async()=>{
    $('subBoxOn').checked=false; window.__calls=[];
    await subBoxGo(true);
    const r={ calls:window.__calls.length, note:$('subBoxNote').textContent };
    $('subBoxOn').checked=true;
    return r;
  });
  ok(c.calls===0&&/先に「箱ものは送料用の重さで実額を取る」を入れてください/.test(c.note),
     '★★⚙がオフのときは直さない（先に入れるように言う）');
}

console.log('\n=== ⑤ すぐ pj-sync に送る・作業者は押せない ===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[];
    $('subBoxOn').checked=true;
    $('subBoxOn').dispatchEvent(new Event('change',{bubbles:true}));
    $('subShopOverseas').value='Overseas products, Asia';
    $('subShopOverseas').dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise((x)=>setTimeout(x,1600));
    return { n:window.__post.length, s:window.__srv.settings };
  });
  ok(t.n>=1&&t.s.subBoxOn===true&&t.s.subShopOverseas==='Overseas products, Asia',
     '★★★⚙を入れたらすぐ pj-sync に送る');
  const s=await p.evaluate(async()=>{
    syncRole='staff'; roleApply(); window.__calls=[];
    await subBoxGo(false);
    const r={ calls:window.__calls.length, note:$('subBoxNote').textContent };
    syncRole='admin'; roleApply();
    return r;
  });
  ok(s.calls===0&&/管理者用のキーが必要/.test(s.note),'★★★作業者のキーでは押せない');
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  const a=(/var APP_V='(v\d+)'/.exec(html)||[])[1];
  const b=(/const V = 'pj-pricing-(v\d+)'/.exec(sw)||[])[1];
  ok(a===b&&+a.slice(1)>=330,'★★★APP_V と sw.js の V が同じ（v330 以上）');
}
await T.done();
})();
