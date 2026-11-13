/* 画面：会員に出す販売価格が Shopify と食い違わない（6.185・【1】）

   2026-11-13 の不具合
     pj の仕入れタブの価格の欄：2528 円
     その CSV を Shopify に読み込んだあとの価格：2539 円
     （画面を開き直しても欄は 2528 のまま）
   原因（画面のぶん）
     書き出しのときに上乗せを引き直して pj-sync に控えていたが、
     ・控える口の返事を**捨てていた**（['catch'](function(){})）ので、
       控え損なっても気づけず
     ・控えたあと**画面の欄を読み直していなかった**ので、欄は古い値のまま
     ・そのあと行の点数や印をいじると、古い値が price に書き戻っていた
   直し
     ① 価格の欄を手で直したら「手入れ」の印を送る（引き直さない）
     ② 書き出しのあと必ず控え、**画面の欄を控えの値に書き直す**
     ③ 値段が変わって読み込み済みの印が外れたら、はっきり知らせる
     ④ 控え損なったら「この CSV は読み込まないで」と知らせる
     ⑤ 「Shopify に読み込みました」のボタンの在りか（会員に配信する の欄） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：販売価格が Shopify と食い違わない（6.185）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const JAN='4571442047947';
const AMZ={ ok:true, n:1, seen:1, priced:1, left:0, per_run:120, ttl_days:3,
  limit:3000, rows:[{ jan:JAN, sha:'いろは商会', kishu:'NS', cond:'新品',
  mw_name:'【新品】スチーム・ハーツ&アドヴァンスト',
  amz_name:'スチーム・ハーツ&アドヴァンスト', asin:'B0D1GSZJ8T',
  wholesale:2000, list_price:7678, price:6000, rank:2124, rank_cat:'ゲーム',
  stock:9, note:'', ship_text:'即日', ship_days:0, new_n:3, amz:0,
  basis:'カート', rst:'ok', fee_total:900, fee_ref:600, fee_fba:200,
  fee_tax:100, fee_fba_ship:200, fee_fba_store:16, size_tier:'s', size_g:110,
  fee_base:6000, pics_ok:1, pics_n:1, buy_qty:0,
  price_at:'2026-11-13T00:00:00Z', amz_at:'2026-11-13T00:00:00Z',
  fee_at:'2026-11-13T00:00:00Z' }] };

/* pj-sync のまね（mw_sub を持ち、Worker と同じ決まりで動く）。 */
const setup=async(o)=>{
  await p.evaluate((x)=>{
    const o=x.o, AMZ=x.AMZ, JAN=x.JAN;
    $('syncApi').value='https://sync.example'; $('syncKey').value='k';
    $('mwShipFee').value='176';
    $('mwSubCardFee').value='3.55'; $('mwSubPack').value='30';
    $('mwSubAddMin').value='10'; $('mwSubAddMax').value='150';
    $('mwSubGrossMin').value='800';
    $('csvMwAmzWin').checked=false;
    if($('csvMwAmzFbaNg'))$('csvMwAmzFbaNg').checked=false;
    window.__sub={}; window.__sub[JAN]=Object.assign(
      { on:1, max_qty:3, price:2528, px_hand:0, loaded_at:'' }, o.sub||{});
    window.__q=[]; window.__dl=[]; window.__putFail=!!o.putFail;
    window.csvDownload=(name,text)=>{ window.__dl.push({ name:name,
      text:text }); return true; };
    const real=window.fetch;
    const res=(v)=>new Response(JSON.stringify(v),{status:200});
    window.fetch=async(u,i)=>{
      const url=String(u), op=i||{};
      const body=()=>JSON.parse(String(op.body||'{}'));
      if(/\/whoami/.test(url))
        return res({ ok:true, role:'admin', staff_key_set:true });
      if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
      if(/\/mw\/sub\/put/.test(url)){
        const b=body();
        window.__q.push({ u:'put', b:b });
        if(window.__putFail)
          return new Response('{"error":"boom"}',{status:500});
        const out={}; let un=0, ch=0, hd=0;
        (b.jans||[]).forEach((j)=>{
          const r=window.__sub[j]; if(!r)return;
          let px=Math.round(+(b.prices||{})[j]||0);
          if(r.px_hand&&r.price>0){ if(px!==r.price)hd++; px=r.price; }
          const chg=(px>0&&px!==r.price);
          if(chg){ ch++;
            if(r.loaded_at){ un++; r.loaded_at=''; }
            r.price=px; }
          out[j]=r.price;
        });
        return res({ ok:true, n:(b.jans||[]).length, prices:out,
                     changed:ch, hand:hd, unloaded:un });
      }
      if(/\/mw\/sub/.test(url)){
        if(String(op.method||'')==='POST'){
          const b=body(), j=String(b.jan||'');
          const r=window.__sub[j]||(window.__sub[j]={ on:0, max_qty:0,
            price:0, px_hand:0, loaded_at:'' });
          window.__q.push({ u:'sub', b:b });
          r.on=+b.on?1:0;
          if(+b.max_qty)r.max_qty=+b.max_qty;
          if(+b.price)r.price=+b.price;
          if(b.hand===1||b.hand===0)r.px_hand=b.hand;
          return res({ ok:true, n:1, table_ok:true });
        }
        const rows=Object.keys(window.__sub).map((j)=>Object.assign(
          { jan:j, name:'スチーム・ハーツ&アドヴァンスト', asin:'B0D1GSZJ8T',
            kishu:'NS', grades:'', cost:2376, size_tier:'s', size_g:110,
            size_long:14, amz_price:6000, fee_total:900, stock:9, put_at:'' },
          window.__sub[j]));
        return res({ ok:true, table_ok:true, n:rows.length, rows:rows });
      }
      if(/\/mw\/buy/.test(url))return res({ ok:true, rows:[], n:0 });
      if(/\/mw\/amz/.test(url))return res(AMZ);
      return real(u,i);
    };
    switchTab('F'); syncRole='admin'; roleApply();
  },{ o:o||{}, AMZ:AMZ, JAN:JAN });
  await openCsvBoxes(p);
  await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
  await p.waitForTimeout(500);
};
const field=()=>p.evaluate((j)=>{
  const el=document.getElementById('mwSubPx_'+j);
  const h=document.getElementById('mwSubHand_'+j);
  return { px:el?el.value:null, hand:h?h.textContent:null };
},JAN);
const csvPx=()=>p.evaluate(()=>{
  const t=(window.__dl[0]||{}).text||'';
  const rows=PJ_SHOPCSV.splitCsv(t);
  const i=rows[0].indexOf('Variant Price');
  return rows[1]?rows[1][i]:null;
});

console.log('=== ① 価格の欄を手で直すと「手入れ」の印を送る ===');
await setup({});
{
  const f=await field();
  console.log('   欄 '+JSON.stringify(f));
  ok(f.px==='2528','★★★控えの値段を欄に出す');
  ok(!/手入れ/.test(String(f.hand||'')),'★おすすめ値のままなら印は出ない');
  const q=await p.evaluate(async(j)=>{
    window.__q=[];
    const el=document.getElementById('mwSubPx_'+j);
    el.value='2600';
    await mwSubPxChange(j);
    await new Promise((x)=>setTimeout(x,200));
    return { q:window.__q, hand:window.__sub[j].px_hand,
      note:(document.getElementById('mwSubHand_'+j)||{}).textContent };
  },JAN);
  console.log('   '+JSON.stringify(q));
  ok(q.q.length===1&&q.q[0].b.hand===1,
     '★★★価格の欄の onchange は hand:1 を送る（手入れ）');
  ok(+q.q[0].b.price===2600,'★★直した値段を送る');
  ok(+q.hand===1,'★★★pj-sync の px_hand が立つ');
  ok(/手入れ/.test(String(q.note||'')),'★★画面にも「手入れ」と出す');
  ok(/おすすめに戻す/.test(String(q.note||'')),'★★「おすすめに戻す」も出す');
}

console.log('\n=== ② 手入れの行は書き出しで引き直さない ===');
await setup({ sub:{ price:2528, px_hand:1 } });
{
  const r=await p.evaluate(async()=>{
    window.__dl=[]; window.__q=[];
    await mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,400));
    return { note:$('mwSubNote').textContent };
  });
  const px=await csvPx();
  const f=await field();
  console.log('   CSV '+px+'／欄 '+f.px);
  ok(px==='2528','★★★CSV の値段は手入れの 2528 のまま');
  ok(f.px==='2528','★★★画面の欄も 2528 のまま');
  ok(/引き直していません|そのまま/.test(r.note),'★★そのまま出したと知らせる');
}

console.log('\n=== ③ 書き出したら、画面の欄が Shopify に出した値になる ===');
await setup({});
{
  const before=(await field()).px;
  await p.evaluate(async()=>{
    window.__dl=[]; window.__q=[];
    await mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,400));
  });
  const px=await csvPx();
  const f=await field();
  const kept=await p.evaluate((j)=>window.__sub[j].price,JAN);
  console.log('   前 '+before+'／CSV '+px+'／欄 '+f.px+'／pj '+kept);
  ok(px!=='2528','★上乗せを引き直す（出し直すたびに変わる）');
  ok(String(kept)===px,'★★★引き直した値段を pj-sync に控える');
  ok(f.px===px,
     '★★★画面の欄も Shopify に出した値になる（ここが食い違っていた）');
  /* そのあと点数をいじっても、控えた値段が古い値に戻らない。 */
  const after=await p.evaluate(async(j)=>{
    const el=document.getElementById('mwSubQty_'+j);
    el.value='5'; await mwSubChange(j);
    await new Promise((x)=>setTimeout(x,200));
    return window.__sub[j].price;
  },JAN);
  console.log('   点数を直したあと pj '+after);
  ok(String(after)===px,
     '★★★点数を直しても値段は書き戻らない（Shopify と同じまま）');
}

console.log('\n=== ④ 値段が変わったら、読み込み済みの印を外して知らせる ===');
await setup({ sub:{ price:2528, px_hand:0,
  loaded_at:'2026-11-13T00:00:00Z' } });
{
  const r=await p.evaluate(async(j)=>{
    window.__dl=[];
    await mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,400));
    return { note:$('mwSubNote').textContent,
             loaded:window.__sub[j].loaded_at };
  },JAN);
  console.log('   '+JSON.stringify(r).slice(0,220));
  ok(/価格が変わりました。Shopify に読み込み直すまで配信に載せません/
     .test(r.note),'★★★そのままの文で知らせる');
  ok(r.loaded==='','★★★読み込み済みの印が外れる（配信に載せない）');
  ok(/もう一度押して/.test(r.note),'★★次に何をすればよいか書く');
}

console.log('\n=== ⑤ 控え損なったら「この CSV は読み込まないで」と知らせる ===');
await setup({ putFail:true });
{
  const r=await p.evaluate(async()=>{
    window.__dl=[];
    await mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,400));
    return { note:$('mwSubNote').textContent, dl:window.__dl.length };
  });
  console.log('   '+JSON.stringify(r).slice(0,240));
  ok(r.dl===1,'★CSV 自体は書き出せている');
  ok(/控えられませんでした/.test(r.note),'★★★控え損なったことを知らせる');
  ok(/読み込まないで/.test(r.note),
     '★★★「この CSV は読み込まないで」と書く（食い違いを作らない）');
}

console.log('\n=== ⑥ 「おすすめに戻す」で手入れの印を外す ===');
await setup({ sub:{ price:2528, px_hand:1 } });
{
  const r=await p.evaluate(async(j)=>{
    window.__q=[];
    await mwSubPxFree(j);
    await new Promise((x)=>setTimeout(x,200));
    return { q:window.__q, hand:window.__sub[j].px_hand,
      note:(document.getElementById('mwSubHand_'+j)||{}).textContent };
  },JAN);
  console.log('   '+JSON.stringify(r));
  ok(r.q.length===1&&r.q[0].b.hand===0,'★★★hand:0 を送る');
  ok(+r.hand===0,'★★★印が外れる（次の書き出しで引き直される）');
  ok(!/手入れ/.test(String(r.note||'')),'★★画面の印も消える');
}

console.log('\n=== ⑦ 「Shopify に読み込みました」のボタンの在りか ===');
{
  const t=await p.evaluate(()=>{
    const b=document.getElementById('subLoaded');
    if(!b)return { ok:false };
    const box=b.closest('details,div[data-pane],section')||{};
    return { ok:true, text:b.textContent.trim(),
      toc:Array.prototype.map.call(document.querySelectorAll('[data-toc]'),
        (x)=>x.getAttribute('data-toc')).indexOf('会員に配信する')>=0,
      tab:(function(){ let e=b; while(e){ if(e.getAttribute
        &&e.getAttribute('data-pane'))return e.getAttribute('data-pane');
        e=e.parentNode; } return ''; })(),
      sib:!!document.getElementById('subPlanBtn') };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.ok&&t.text==='Shopify に読み込みました','★★★ボタンがある');
  ok(t.toc,'★★★「会員に配信する」の欄に入っている（目次からも行ける）');
  ok(t.sib,'★★「今日の配信の予定を見る」と並んでいる');
}
await T.done();
})();
