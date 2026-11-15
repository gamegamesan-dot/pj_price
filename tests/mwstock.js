/* 画面：一覧に MW の在庫数を出す（6.196・v295）

   カジ
     畳んだ行は「順位・卸・売・利」だけで、MW の在庫数は行を開かないと
     見えない。仕入れる数や会員に出せる数を決めるのに、在庫数を
     一覧のまま見比べたい。

   直し
     ・畳んだ行の2行目を「順位・卸・売・利・**在**」にする
     ・在庫 0 は灰色、⚙の「MW在庫が少ない」（既定 5点以下）は赤、
       在庫が取れていない行は「在 —」
     ・375px で1行に収まらないときは折り返す（文字が重ならない）
     ・並べ替えに「MW の在庫が多い順」
     ・「仕入れる一覧」の行にも同じ出し方で在庫数を出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：一覧に MW の在庫数を出す（6.196）');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.setViewportSize({ width:375, height:780 });

const base={ sha:'いろは商会', kishu:'NS', cond:'新品', list_price:9800,
  note:'', ship_text:'即日', ship_days:0, new_n:3, amz:0,
  basis:'カート', rst:'ok', fee_total:900, fee_ref:600, fee_fba:200,
  fee_tax:100, fee_fba_ship:200, fee_fba_store:16, size_tier:'s', size_g:110,
  fee_base:9000, pics_ok:1, pics_n:1, buy_qty:0, rank_cat:'ゲーム',
  price_at:'2026-11-12T00:00:00Z', amz_at:'2026-11-12T00:00:00Z',
  fee_at:'2026-11-12T00:00:00Z' };
const ROWS=[
  /* 在庫たくさん */
  Object.assign({},base,{ jan:'4902370550001', mw_name:'在庫が多い商品',
    amz_name:'在庫が多い商品', asin:'B00MANY0001', wholesale:3000, price:9000,
    rank:2124, stock:48 }),
  /* 在庫が少ない（⚙ 既定 5点以下 → 赤） */
  Object.assign({},base,{ jan:'4902370550002', mw_name:'在庫が少ない商品',
    amz_name:'在庫が少ない商品', asin:'B00FEW00001', wholesale:3000, price:9400,
    rank:1200, stock:3 }),
  /* 在庫 0（灰色） */
  Object.assign({},base,{ jan:'4902370550003', mw_name:'在庫0の商品',
    amz_name:'在庫0の商品', asin:'B00ZERO0001', wholesale:3000, price:9200,
    rank:300, stock:0 }),
  /* 在庫が取れていない（「在 —」） */
  Object.assign({},base,{ jan:'4902370550004', mw_name:'在庫が取れていない商品',
    amz_name:'在庫が取れていない商品', asin:'B00NULL0001', wholesale:3000,
    price:9100, rank:900, stock:null }),
  /* 桁が多い行（利が5桁・在が4桁）＝1行に収まらない行 */
  Object.assign({},base,{ jan:'4902370550005', mw_name:'桁が多い商品',
    amz_name:'桁が多い商品', asin:'B00BIG00001', wholesale:30000, price:99800,
    rank:12345, stock:1234, fee_base:99800 })];
const META={ ok:true, n:ROWS.length, rows:ROWS, seen:5, priced:5, left:0,
  per_run:120, ttl_days:3, limit:3000 };

await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='5';
  $('mwKishu').value='NS,NS2,P5,figure'; $('mwNewOnly').checked=true;
  $('mwNoteAll').checked=false; $('mwNoteNg').value='ダメージ,訳あり';
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  $('csvMwAmzWin').checked=false;
  if($('csvMwAmzFbaNg'))$('csvMwAmzFbaNg').checked=false;
  window.__buy={ '4902370550001':2, '4902370550003':1 };
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
      if(String(o.method||'')==='POST')
        return new Response(JSON.stringify({ok:true}),{status:200});
      /* 仕入れる一覧：MW にある行と、MW から消えた行（仕入れ済み）。 */
      const rows=[
        { jan:'4902370550001', qty:2, mw_name:'在庫が多い商品', stock:48,
          sha:'いろは商会', kishu:'NS', cond:'新品', wholesale:3000,
          ship_days:0, at:'2026-11-12T00:00:00Z' },
        { jan:'4902370550003', qty:1, mw_name:'在庫0の商品', stock:0,
          sha:'いろは商会', kishu:'NS', cond:'新品', wholesale:3000,
          ship_days:0, at:'2026-11-12T00:00:00Z' },
        { jan:'4902370550009', qty:1, mw_name:'MWで売り切れた商品', stock:7,
          sha:'いろは商会', kishu:'NS', cond:'新品', wholesale:3000,
          gone_at:'2026-11-13T00:00:00Z', at:'2026-11-10T00:00:00Z' }];
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
await p.evaluate(()=>{ mwOpenAll=0; mwOpenRow={}; mwOpenSave(); });
await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
await p.waitForTimeout(600);

const sums=()=>p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('#csvMwAmzList details[data-mwrow]'),
  (d)=>{
    const s2=d.querySelector('.mwsum2');
    const st=s2?s2.querySelector('.mwst'):null;
    return { jan:d.getAttribute('data-mwrow'),
      txt:(s2?(s2.innerText||''):'').replace(/\s+/g,' '),
      col:st?getComputedStyle(st.querySelector('b')||st).color:'',
      cls:st?st.className:'',
      h:Math.round(d.getBoundingClientRect().height),
      sh:s2?Math.round(s2.getBoundingClientRect().height):0,
      sw:s2?s2.scrollWidth:0, cw:s2?s2.clientWidth:0 };
  }));

console.log('=== ① 畳んだ行に「在 ◯」が出る（順位・卸・売・利・在）===');
let rs=await sums();
console.log('   '+JSON.stringify(rs.map((x)=>x.txt)));
{
  const by={}; rs.forEach((x)=>{ by[x.jan]=x; });
  ok(rs.length===5,'★5行とも出る');
  ok(/在 48/.test(by['4902370550001'].txt),'★★★MW の在庫数を出す');
  ok(/位.*卸.*売.*利.*在/.test(by['4902370550001'].txt),
     '★★★並びは「順位・卸・売・利・在」');
  ok(/在 —/.test(by['4902370550004'].txt),
     '★★★在庫が取れていない行は「在 —」（0 と分ける）');
  ok(/在 0/.test(by['4902370550003'].txt),'★★在庫 0 は「在 0」と出す');
  ok(/在 1,234/.test(by['4902370550005'].txt),'★桁は3桁ごとに区切る');
}

console.log('=== ② 0 は灰色・少ない行は赤 ===');
{
  const by={}; rs.forEach((x)=>{ by[x.jan]=x; });
  const mute=await p.evaluate(()=>getComputedStyle(document.documentElement)
    .getPropertyValue('--mute').trim());
  const bad=await p.evaluate(()=>getComputedStyle(document.documentElement)
    .getPropertyValue('--bad').trim());
  const hex=(c)=>{ const m=String(c).match(/(\d+), ?(\d+), ?(\d+)/);
    return m?('#'+[1,2,3].map((i)=>(+m[i]).toString(16).padStart(2,'0'))
      .join('')):String(c); };
  console.log('   0件: '+hex(by['4902370550003'].col)+'（--mute '+mute+'）'
    +' / 少ない: '+hex(by['4902370550002'].col)+'（--bad '+bad+'）'
    +' / ふつう: '+hex(by['4902370550001'].col));
  ok(/zero/.test(by['4902370550003'].cls)
     &&hex(by['4902370550003'].col)===mute.toLowerCase(),
     '★★★在庫 0 は灰色');
  ok(/low/.test(by['4902370550002'].cls)
     &&hex(by['4902370550002'].col)===bad.toLowerCase(),
     '★★★⚙の少ない基準（既定 5点以下）は赤');
  ok(!/zero|low/.test(by['4902370550001'].cls),
     '★★ふつうの行（48点）は赤にしない');
  ok(!/zero|low/.test(by['4902370550004'].cls),
     '★★★取れていない行（—）は赤にも灰色にもしない');
}

console.log('=== ③ ⚙の基準を変えると、その場で変わる ===');
{
  const def=await p.evaluate(()=>$('mwLowStock').value);
  ok(String(def)==='5','★★⚙の既定は 5点以下');
  await p.evaluate(()=>{
    $('mwLowStock').value='50';
    $('mwLowStock').dispatchEvent(new Event('input',{bubbles:true}));
    $('mwLowStock').dispatchEvent(new Event('change',{bubbles:true}));
  });
  await p.waitForTimeout(300);
  const rs2=await sums(); const by={}; rs2.forEach((x)=>{ by[x.jan]=x; });
  console.log('   48点の行: '+by['4902370550001'].cls);
  ok(/low/.test(by['4902370550001'].cls),
     '★★★基準を上げると、その行も赤になる（押し直さなくてよい）');
  const kept=await p.evaluate(()=>{
    let o={}; try{ o=JSON.parse(localStorage.getItem('pj:csvcfg:v1')||'{}'); }
    catch(e){}
    return String(o.mwLowStock||'');
  });
  ok(kept==='50','★★★この端末に覚える');
  await p.evaluate(()=>{
    $('mwLowStock').value='5';
    $('mwLowStock').dispatchEvent(new Event('input',{bubbles:true}));
    $('mwLowStock').dispatchEvent(new Event('change',{bubbles:true}));
  });
  await p.waitForTimeout(300);
}

console.log('=== ④ 375px：はみ出さない・文字が重ならない ===');
{
  rs=await sums();
  console.log('   '+JSON.stringify(rs.map((x)=>({ sw:x.sw, cw:x.cw, h:x.sh }))));
  ok(rs.every((x)=>x.sw<=x.cw),'★★★右にはみ出さない（切れない）');
  ok(rs.filter((x)=>x.jan!=='4902370550005').every((x)=>x.sh<=20),
     '★★★ふつうの行は今までどおり1行に収まる');
  ok(rs.every((x)=>x.sh<=40),
     '★★★入らない行（利5桁・在4桁）は2行目に回る（文字が重ならない）');
  /* 重ならないこと＝「在」の左端が「利」の右端より右か、下の行にある。 */
  const lap=await p.evaluate(()=>{
    const out=[];
    document.querySelectorAll('#csvMwAmzList .mwsum2').forEach((s)=>{
      const c4=s.querySelector('.c4'), c5=s.querySelector('.c5');
      if(!c4||!c5)return;
      const a=c4.getBoundingClientRect(), b=c5.getBoundingClientRect();
      out.push((b.left>=a.right-0.5)||(b.top>=a.bottom-0.5));
    });
    return out;
  });
  ok(lap.length===5&&lap.every(Boolean),
     '★★★「利」と「在」が重ならない（同じ行なら右・入らなければ下）');
}

console.log('=== ⑤ 並べ替え「MW の在庫が多い順」 ===');
{
  const opt=await p.evaluate(()=>Array.prototype.map.call(
    $('csvMwAmzSort').options,(o)=>o.value));
  ok(opt.indexOf('stock')>=0,'★★★並べ替えに「MW の在庫が多い順」がある');
  await p.evaluate(()=>{
    $('csvMwAmzSort').value='stock';
    $('csvMwAmzSort').dispatchEvent(new Event('change',{bubbles:true}));
  });
  await p.waitForTimeout(300);
  const order=await p.evaluate(()=>Array.prototype.map.call(
    document.querySelectorAll('#csvMwAmzList details[data-mwrow]'),
    (d)=>d.getAttribute('data-mwrow')));
  console.log('   '+JSON.stringify(order));
  ok(order[0]==='4902370550005'&&order[1]==='4902370550001',
     '★★★在庫の多い行から並ぶ（1,234点 → 48点）');
  ok(order[order.length-1]==='4902370550004',
     '★★★在庫が取れていない行（—）は後ろ');
  ok(order.indexOf('4902370550003')>order.indexOf('4902370550002'),
     '★★0点の行は、少なくても在庫がある行より後ろ');
  await p.evaluate(()=>{
    $('csvMwAmzSort').value='net';
    $('csvMwAmzSort').dispatchEvent(new Event('change',{bubbles:true}));
  });
  await p.waitForTimeout(300);
}

console.log('=== ⑥ 仕入れる一覧にも在庫数を出す ===');
{
  await p.evaluate(()=>$('csvMwBuyShow').click());
  await p.waitForTimeout(600);
  const t=await p.evaluate(()=>{
    const out=[];
    document.querySelectorAll('#csvMwAmzList [data-buyrow]').forEach((d)=>{
      const st=d.querySelector('.mwst');
      out.push({ jan:d.getAttribute('data-buyrow'),
        tag:st?(st.innerText||'').replace(/\s+/g,' '):'',
        cls:st?st.className:'',
        head:(d.firstElementChild.innerText||'').replace(/\s+/g,' ') });
    });
    return out;
  });
  console.log('   '+JSON.stringify(t));
  const by={}; t.forEach((x)=>{ by[x.jan]=x; });
  ok(t.length===3,'★仕入れる一覧が3行出る');
  ok(/在 48/.test(by['4902370550001'].tag),
     '★★★仕入れる一覧の行にも在庫数を出す');
  ok(/2点/.test(by['4902370550001'].head)
     &&/在庫が多い商品/.test(by['4902370550001'].head),
     '★★仕入れる点数・商品名と同じ行に出す');
  ok(/zero/.test(by['4902370550003'].cls),'★★★0 は候補の一覧と同じ灰色');
  ok(/在 —/.test(by['4902370550009'].tag),
     '★★★MW で売り切れた行（仕入れ済み）は「在 —」');
}

await T.done();
})();
