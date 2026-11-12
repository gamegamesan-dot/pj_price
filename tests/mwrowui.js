/* 画面：刈取の一覧は 1商品＝1行（6.182・v263）

   ① 畳んだ状態（既定）は2行だけ
      1行目 … 商品名（1行で切る・末尾は…）＋ 印（小さな丸）
      2行目 … 大分類ランキング ／ MW卸値（税抜）／ Amazon の販売価格 ／ 利益額
   ② スマホの幅（375px）で2行目が折り返さない
   ③ 行を押すと今までのカードの中身がすべて開く（消した項目はない）
   ④ 「すべて開く／すべて畳む」。開閉は端末に覚える
   ⑤ 並べ替え・絞り込み・まとめて操作（仕入れる印）はそのまま動く
   ⑥ 赤字の利益額は赤 */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：刈取の一覧は 1商品＝1行（6.182）');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.setViewportSize({ width:375, height:780 });

const base={ sha:'いろは商会', kishu:'NS', cond:'新品', list_price:9800,
  stock:12, note:'', ship_text:'即日', ship_days:0, new_n:3, amz:0,
  basis:'カート', rst:'ok', fee_total:900, fee_ref:600, fee_fba:200,
  fee_tax:100, fee_fba_ship:200, fee_fba_store:16, size_tier:'s', size_g:110,
  fee_base:9000, pics_ok:1, pics_n:1, buy_qty:0,
  price_at:'2026-11-12T00:00:00Z', amz_at:'2026-11-12T00:00:00Z',
  fee_at:'2026-11-12T00:00:00Z' };
const ROWS=[
  Object.assign({},base,{ jan:'4902370550001',
    mw_name:'【新品】とても長い商品名がここにずっと続きます・限定版・特典つき ★',
    amz_name:'とても長い商品名がここにずっと続きます 限定版 特典つき',
    asin:'B00LONG0001', wholesale:6000, price:11570, rank:2124,
    rank_cat:'ゲーム' }),
  Object.assign({},base,{ jan:'4902370550002', mw_name:'ふつうの商品',
    amz_name:'ふつうの商品', asin:'B00NORM0001', wholesale:3000, price:9000,
    rank:1200, rank_cat:'ゲーム', amz:1 }),
  /* 赤字の行（卸値が高い） */
  Object.assign({},base,{ jan:'4902370550003', mw_name:'赤字の商品',
    amz_name:'赤字の商品', asin:'B00AKA00001', wholesale:9000, price:9000,
    rank:300, rank_cat:'ゲーム' }),
  /* 順位がまだ取れていない行 */
  Object.assign({},base,{ jan:'4902370550004', mw_name:'順位がない商品',
    amz_name:'順位がない商品', asin:'B00NORANK1', wholesale:3000, price:9400,
    rank:null, rank_cat:'' })];
const META={ ok:true, n:ROWS.length, rows:ROWS, seen:4, priced:4, left:0,
  per_run:120, ttl_days:3, limit:3000 };

await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='5';
  $('mwKishu').value='NS,NS2,P5,figure'; $('mwNewOnly').checked=true;
  $('mwNoteAll').checked=false; $('mwNoteNg').value='ダメージ,訳あり';
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  /* 赤字の行も出す（「黒字のみ」を外す）。FBA 不可の既定の絞り込みも外す。 */
  $('csvMwAmzWin').checked=false;
  if($('csvMwAmzFbaNg'))$('csvMwAmzFbaNg').checked=false;
  /* 「仕入れる」の印は控えを覚えておく（押したら印が残るように）。 */
  window.__buy={};
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), o=i||{};
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:'admin',
        staff_key_set:true}),{status:200});
    if(/\/mw\/sub/.test(url))
      return new Response(JSON.stringify({ok:true,table_ok:true,n:0,rows:[]}),
        {status:200});
    if(/\/mw\/buy/.test(url)){
      if(String(o.method||'')==='POST'){
        const b=JSON.parse(String(o.body||'{}'));
        if(+b.qty>0)window.__buy[b.jan]=+b.qty; else delete window.__buy[b.jan];
        return new Response(JSON.stringify({ok:true}),{status:200});
      }
      const rows=Object.keys(window.__buy).map((j)=>({ jan:j,
        qty:window.__buy[j], mw_name:'x', at:'2026-11-12T00:00:00Z' }));
      return new Response(JSON.stringify({ok:true,rows:rows,n:rows.length}),
        {status:200});
    }
    if(/\/mw\/amz/.test(url))
      return new Response(JSON.stringify(META),{status:200});
    return real(u,i);
  };
  switchTab('F'); syncRole='admin'; roleApply();
},META);
await openCsvBoxes(p);
/* 6.182：ここでは**畳んだ状態**を見るので、lib の「開いておく」を戻す。 */
await p.evaluate(()=>{ mwOpenAll=0; mwOpenRow={}; mwOpenSave(); });
await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
await p.waitForTimeout(500);

const rows=()=>p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('#csvMwAmzList details[data-mwrow]'),
  (d)=>({ jan:d.getAttribute('data-mwrow'), open:d.open,
          sum:(d.querySelector('summary').innerText||'').replace(/\s+/g,' '),
          h:Math.round(d.getBoundingClientRect().height) })));

console.log('=== ① 畳んだ状態は2行だけ ===');
let rs=await rows();
console.log('   '+JSON.stringify(rs,null,0));
ok(rs.length===4,'★★4行とも出る');
ok(rs.every((x)=>x.open===false),'★★★既定は畳んである');
const r1=rs.filter((x)=>x.jan==='4902370550001')[0]||{};
ok(/2,124位/.test(r1.sum),'★★★大分類ランキングを出す');
ok(/卸 ¥6,000/.test(r1.sum),'★★★MW卸値（税抜）を出す');
ok(/売 ¥11,570/.test(r1.sum),'★★★Amazon の販売価格を出す');
ok(/利 ¥/.test(r1.sum),'★★★利益額を出す');
ok(/とても長い商品名/.test(r1.sum),'★★商品名も出す');
/* 1商品が画面に何件も入ること（カード1枚で1画面、ではない）。 */
console.log('   行の高さ: '+JSON.stringify(rs.map((x)=>x.h)));
ok(rs.every((x)=>x.h<=72),'★★★1行は低い（画面に何件も並ぶ）');

console.log('\n=== ② 375px で2行目が折り返さない ===');
{
  const w=await p.evaluate(()=>Array.prototype.map.call(
    document.querySelectorAll('#csvMwAmzList .mwsum2'),
    (el)=>({ sw:el.scrollWidth, cw:el.clientWidth,
             h:Math.round(el.getBoundingClientRect().height) })));
  console.log('   '+JSON.stringify(w));
  ok(w.length===4,'★2行目が4つある');
  ok(w.every((x)=>x.sw<=x.cw),'★★★はみ出さない（折り返しも起きない）');
  ok(w.every((x)=>x.h<=20),'★★★1行に収まる（高さが2行ぶんにならない）');
  /* 桁をそろえる（tabular-nums）。 */
  const tn=await p.evaluate(()=>getComputedStyle(
    document.querySelector('#csvMwAmzList .mwsum2')).fontVariantNumeric);
  ok(/tabular-nums/.test(tn),'★★数字の桁をそろえる');
}

console.log('\n=== ③ 押すと中身がすべて開く ===');
{
  const before=await p.evaluate(()=>{
    const d=document.querySelector('#csvMwAmzList details[data-mwrow]');
    return (d.innerText||'').replace(/\s+/g,' ');
  });
  ok(!/ASIN/.test(before),'★★畳んでいるうちは中身が出ていない');
  await p.evaluate(()=>{
    const d=document.querySelector('[data-mwrow="4902370550001"]');
    d.querySelector('summary').click();
  });
  await p.waitForTimeout(120);
  const t=await p.evaluate(()=>{
    const d=document.querySelector('[data-mwrow="4902370550001"]');
    return { open:d.open, txt:(d.innerText||'').replace(/\s+/g,' ') };
  });
  console.log('   '+t.txt.slice(0,200));
  ok(t.open===true,'★★★押すと開く');
  ['ASIN','MW在庫','MW卸値','ランキング','仕入れる','会員に出す','手数料']
    .forEach((k)=>ok(t.txt.indexOf(k)>=0,'★★中身に「'+k+'」が出る'));
  ok(await p.evaluate(()=>!!document.getElementById(
     'mwBuyChk_4902370550001')),'★★「仕入れる」のチェックも出る');
  /* もう一度押すと畳む。 */
  await p.evaluate(()=>{
    document.querySelector('[data-mwrow="4902370550001"] summary').click(); });
  await p.waitForTimeout(120);
  ok(await p.evaluate(()=>document.querySelector(
     '[data-mwrow="4902370550001"]').open)===false,'★★★もう一度押すと畳む');
}

console.log('\n=== ④ すべて開く／すべて畳む・端末に覚える ===');
{
  ok(await p.evaluate(()=>($('mwOpenAllBtn').textContent||''))==='すべて開く',
     '★★ボタンは「すべて開く」');
  await p.evaluate(()=>{ $('mwOpenAllBtn').click(); });
  await p.waitForTimeout(200);
  rs=await rows();
  ok(rs.length===4&&rs.every((x)=>x.open===true),'★★★すべて開く');
  ok(await p.evaluate(()=>($('mwOpenAllBtn').textContent||''))==='すべて畳む',
     '★★ボタンが「すべて畳む」に変わる');
  const saved=await p.evaluate(()=>localStorage.getItem('pj_mw_open'));
  console.log('   覚えた値: '+saved);
  ok(/"all":1/.test(String(saved)),'★★★端末に覚える');
  await p.evaluate(()=>{ $('mwOpenAllBtn').click(); });
  await p.waitForTimeout(200);
  rs=await rows();
  ok(rs.every((x)=>x.open===false),'★★★すべて畳む');
  /* 1行だけ開いたことも覚える。 */
  await p.evaluate(()=>{
    document.querySelector('[data-mwrow="4902370550002"] summary').click(); });
  await p.waitForTimeout(150);
  const s2=await p.evaluate(()=>localStorage.getItem('pj_mw_open'));
  console.log('   '+s2);
  ok(/4902370550002/.test(String(s2)),'★★★1行だけ開いたことも覚える');
  /* 作り直しても開いたまま。 */
  await p.evaluate(()=>{ mwAmzRender(); });
  await p.waitForTimeout(150);
  rs=await rows();
  ok((rs.filter((x)=>x.jan==='4902370550002')[0]||{}).open===true,
     '★★★一覧を作り直しても開いたまま');
}

console.log('\n=== ⑤ 印（小さな丸）と赤字 ===');
{
  await p.evaluate(()=>{ mwOpenAll=0; mwOpenRow={}; mwOpenSave(); mwAmzRender(); });
  await p.waitForTimeout(150);
  const d=await p.evaluate(()=>Array.prototype.map.call(
    document.querySelectorAll('#csvMwAmzList details[data-mwrow]'),
    (x)=>({ jan:x.getAttribute('data-mwrow'),
            dots:Array.prototype.map.call(x.querySelectorAll('summary .mwdot'),
              (z)=>z.getAttribute('title')) })));
  console.log('   '+JSON.stringify(d));
  const d2=(d.filter((x)=>x.jan==='4902370550002')[0]||{}).dots||[];
  ok(d2.indexOf('Amazon本体あり')>=0,'★★★Amazon本体ありを小さな印で出す');
  ok(d2.indexOf('出品できる')>=0,'★★★出品できる／できないも印で出す');
  /* 「仕入れる」の印を付けると、畳んだ行にも印が出る。 */
  await p.evaluate(()=>{
    document.querySelector('[data-mwrow="4902370550001"] summary').click(); });
  await p.waitForTimeout(120);
  await p.evaluate(()=>{
    const b=$('mwBuyChk_4902370550001'); b.checked=true;
    b.dispatchEvent(new Event('change'));
  });
  await p.waitForTimeout(400);
  const d3=await p.evaluate(()=>Array.prototype.map.call(
    document.querySelectorAll('[data-mwrow="4902370550001"] summary .mwdot'),
    (z)=>z.getAttribute('title')));
  console.log('   '+JSON.stringify(d3));
  ok(d3.indexOf('仕入れる')>=0,'★★★「仕入れる」の印も畳んだ行で分かる');
  /* 赤字の行は利益額が赤。 */
  const red=await p.evaluate(()=>{
    const el=document.querySelector('[data-mwrow="4902370550003"] .mwsum2 .c4');
    return { txt:(el.innerText||'').replace(/\s+/g,' '),
             cls:el.className, color:getComputedStyle(el).color };
  });
  console.log('   赤字の行: '+JSON.stringify(red));
  ok(/bad/.test(red.cls),'★★★赤字の利益額は赤');
  ok(/-/.test(red.txt)||/−/.test(red.txt),'★★赤字はマイナスで出る');
}

console.log('\n=== ⑥ 並べ替え・絞り込みはそのまま動く ===');
{
  await p.evaluate(()=>{ $('csvMwAmzSort').value='rank';
    $('csvMwAmzSort').dispatchEvent(new Event('change')); });
  await p.waitForTimeout(250);
  const order=await p.evaluate(()=>Array.prototype.map.call(
    document.querySelectorAll('#csvMwAmzList details[data-mwrow]'),
    (d)=>d.getAttribute('data-mwrow')));
  console.log('   ランキング順: '+JSON.stringify(order));
  ok(order[0]==='4902370550003','★★★ランキング順に並ぶ（300位が先頭）');
  ok(order[order.length-1]==='4902370550004',
     '★★順位が取れていない行は後ろ');
  await p.evaluate(()=>{ $('csvMwAmzSort').value='net';
    $('csvMwAmzSort').dispatchEvent(new Event('change')); });
  await p.waitForTimeout(250);
  ok((await rows()).length===4,'★並べ替えを戻しても4行');
}

T.done();
})();
