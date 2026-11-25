/* 画面：MW と Amazon の「商品違いの疑い」（8.101・v349）

   カジの報告（2026-11-25）
   MW の JAN 4573102666987「EG ULTRAMAN（ULTRAMAN: RISING）」（定価 1,500円・卸値 1,020円）を、
   pj は Amazon の B09VGGZCKM「BANDAI SPIRITS スター・ウォーズ マンダロリアン」（売値 5,000円）に
   つなぎ、利益 2,423円・「出品できる」と出していた。
   ① 商品名に共通する言葉がほとんどない → 疑い（メーカー名・一般的な言葉は数えない）
   ② Amazon の売値が MW 定価×倍率（⚙ mwMisX・既定 2.5）を超える → 疑い
   ③ 疑いの行：「出品できる」を出さず赤で「商品違いの疑い」・利益とおすすめ順から外す・
      eBay 無在庫の候補から外す・MW と Amazon の商品名を並べる・「同じ商品」で外す */
const { harness, openCsvBoxes }=require('./lib');
const T=harness('画面：商品違いの疑い（8.101）');
const ok=T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });
await p.evaluate(()=>{
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('autoAdRate').value='6';
  $('fee').value='13.6'; $('intlFee').value='1.35'; $('feeTax').value='10';
  $('fixed').value='0.40'; $('pack').value='150'; $('shipCharge').value='15';
  $('targetMode').value='auto'; $('mwShipFee').value='176';
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  syncRole='admin'; roleApply(); switchTab('F');
});
await openCsvBoxes(p);

const BAD='4573102666987', OK1='4902370550001', PX='4902370550002', SAMEJ='4902370550003';
const mk=(jan,o)=>Object.assign({ jan:jan, sha:'M200', kishu:'figure', cond:'新品',
  mw_name:'商品', amz_name:'商品', wholesale:1020, list_price:1500, stock:5, note:'',
  ship_text:'即日', ship_days:0, asin:'B0'+jan.slice(-8), price:2000, basis:'カート',
  new_n:3, amz:0, rank:1000, rank_cat:'ホビー', rst:'ok', cand_n:1,
  fee_total:400, fee_ref:300, fee_fba:100, fee_tax:0, fee_base:2000 },o||{});
const ROWS=[
  /* カジの例：名前がまったく違い、売値も定価の 3.3倍。 */
  mk(BAD,{ mw_name:'EG ULTRAMAN（ULTRAMAN: RISING）', asin:'B09VGGZCKM',
    amz_name:'BANDAI SPIRITS スター・ウォーズ マンダロリアン', price:5000, list_price:1500 }),
  /* 同じ商品（名前が合う・売値も普通）。 */
  mk(OK1,{ mw_name:'HG 1/144 ガンダムエアリアル', list_price:1430, price:2400,
    amz_name:'BANDAI SPIRITS HG 機動戦士ガンダム 水星の魔女 ガンダムエアリアル 1/144スケール 色分け済みプラモデル' }),
  /* 名前は合うが、売値が定価の 3倍（倍率で疑い）。 */
  mk(PX,{ mw_name:'一番くじ ドラゴンボール A賞 孫悟空', list_price:800, price:2400,
    amz_name:'一番くじ ドラゴンボール A賞 孫悟空 フィギュア' }),
  /* 名前は違うが「同じ商品」と控えてある（その ASIN のとき）。 */
  mk(SAMEJ,{ mw_name:'EG ULTRAMAN', amz_name:'エントリーグレード ウルトラマン', asin:'B0SAME0001',
    same_asin:'B0SAME0001', list_price:1500, price:1800 })];

console.log('=== ① ② 見立て（shared/mwmatch.js）===');
const J=await p.evaluate((rows)=>rows.map((r)=>{ const j=mwMisOf(r); return { jan:r.jan, bad:j.bad, why:j.why, ratio:j.ratio }; }),ROWS);
console.log('   '+JSON.stringify(J));
const jb=(j)=>J.filter((x)=>x.jan===j)[0];
ok(jb(BAD).bad&&jb(BAD).why.indexOf('name')>=0&&jb(BAD).why.indexOf('price')>=0,
   '★★★カジの例（EG ULTRAMAN ↔ スター・ウォーズ・定価の3.3倍）は疑い（名前・値段の両方）');
ok(!jb(OK1).bad,'★★★名前が合い、売値も普通の行は疑わない（メーカー名・プラモデルは数えない）');
ok(jb(PX).bad&&jb(PX).why.join()==='price'&&jb(PX).ratio===3,'★★★名前が合っても定価の2.5倍を超えたら疑い');
ok(!jb(SAMEJ).bad,'★★★「同じ商品」と控えた JAN（同じ ASIN）は疑わない');

console.log('\n=== ③ 刈取の一覧 ===');
const L=await p.evaluate((rows)=>{
  $('csvMwAmzWin').checked=false; $('csvMwAmzMulti').checked=false;
  $('csvMwAmzRstOk').checked=false; $('csvMwAmzDup').checked=false; $('csvMwAmzMis').checked=false;
  $('csvMwAmzMinM').value='0'; $('csvMwAmzNoRank').checked=true; $('mwRankCaps').value='';
  $('csvMwAmzSort').value='net';
  mwAmzRows=JSON.parse(JSON.stringify(rows)); mwAmzMeta={ n:4, seen:4, priced:4, left:0 }; mwBuyMap={};
  mwAmzRender();
  const rowEl=(j)=>document.querySelector('#csvMwAmzList [data-mwrow="'+j+'"]');
  const order=[].slice.call(document.querySelectorAll('#csvMwAmzList [data-mwrow]')).map((e)=>e.getAttribute('data-mwrow'));
  const b=rowEl('4573102666987');
  return { order:order, note:$('csvMwAmzListNote').textContent, misN:$('csvMwAmzMisN').textContent,
    badText:b?b.textContent:'', badHtml:b?b.innerHTML:'',
    badCalc:mwAmzCalc(mwAmzRows[0]), okCalc:!!mwAmzCalc(mwAmzRows[1]),
    okText:rowEl('4902370550001')?rowEl('4902370550001').textContent:'',
    buyChk:!!document.getElementById('mwBuyChk_4573102666987'),
    sameBtn:!!(b&&b.querySelector('[data-mwsame]')) };
},ROWS);
console.log('   並び '+JSON.stringify(L.order)+' / '+L.misN);
ok(L.badCalc===null&&L.okCalc,'★★★疑いの行は利益を出さない（mwAmzCalc が null）');
ok(L.order[L.order.length-1]===BAD||L.order.slice(-2).indexOf(BAD)>=0,
   '★★★おすすめ順（粗利の高い順）では後ろ（利益 2,423円で上に来ない）');
ok(/商品違いの疑い/.test(L.badText)&&/color:\s*var\(--bad\)/.test(L.badHtml),'★★★赤字で「商品違いの疑い」');
ok(!/出品できる/.test(L.badText),'★★★「出品できる」は出さない（可否が ok でも）');
ok(/出品できる/.test(L.okText),'★同じ商品の行はいままでどおり「出品できる」');
ok(/EG ULTRAMAN（ULTRAMAN: RISING）/.test(L.badText)&&/スター・ウォーズ マンダロリアン/.test(L.badText)
   &&/MW の商品名/.test(L.badText)&&/Amazon の商品名/.test(L.badText),
   '★★★MW の商品名と Amazon の商品名を並べて出す');
ok(/MW 定価/.test(L.badText)&&/¥1,500/.test(L.badText)&&/¥5,000/.test(L.badText)&&/3\.33倍/.test(L.badText),
   '★★MW 定価と Amazon の売値（倍率）も出す');
ok(!/2,423/.test(L.badText)&&!L.buyChk,'★★利益と「仕入れる」は出さない');
ok(/商品違いの疑い 2件/.test(L.note)&&/2件/.test(L.misN),'★★件数を一覧の上と絞り込みに出す');
ok(L.sameBtn,'★★管理者には「同じ商品」のボタン');

const F=await p.evaluate(()=>{ $('csvMwAmzMis').checked=true; mwAmzRender();
  const o=[].slice.call(document.querySelectorAll('#csvMwAmzList [data-mwrow]')).map((e)=>e.getAttribute('data-mwrow'));
  $('csvMwAmzMis').checked=false; mwAmzRender(); return o; });
ok(JSON.stringify(F.slice().sort())===JSON.stringify([BAD,PX].sort()),'★★「商品違いの疑いだけ表示」');

console.log('\n=== ④ 「同じ商品」を押す ===');
const S=await p.evaluate(async()=>{
  const sent=[];
  const f0=window.fetch;
  window.fetch=function(u,i){
    if(/\/mw\/same$/.test(String(u))){
      sent.push(JSON.parse((i&&i.body)||'{}'));
      return Promise.resolve(new Response(JSON.stringify({ ok:true, jan:'4573102666987',
        asin:'B09VGGZCKM', on:true }),{ status:200, headers:{ 'content-type':'application/json' } }));
    }
    return f0.apply(this,arguments);
  };
  const b=document.querySelector('#csvMwAmzList [data-mwsame="4573102666987"]');
  b.click();
  await new Promise((r)=>setTimeout(r,300));
  window.fetch=f0;
  const row=mwAmzRows.filter((r)=>r.jan==='4573102666987')[0];
  const el=document.querySelector('#csvMwAmzList [data-mwrow="4573102666987"]');
  return { sent:sent, same:row.same_asin, bad:mwMisBad(row), calc:!!mwAmzCalc(row),
    text:el?el.textContent:'', note:$('csvMwAmzListNote').textContent };
});
console.log('   '+JSON.stringify(S.sent));
ok(S.sent.length===1&&S.sent[0].jan===BAD&&S.sent[0].asin==='B09VGGZCKM'&&S.sent[0].on===true,
   '★★★pj-sync に JAN と ASIN を送る（POST /mw/same）');
ok(S.same==='B09VGGZCKM'&&!S.bad&&S.calc,'★★★押したら疑いを外し、利益を出す');
ok(/出品できる/.test(S.text)&&!/商品違いの疑い/.test(S.text),'★★行は普通の行に戻る');
ok(/商品違いの疑い 1件/.test(S.note)&&/同じ商品」として控えました/.test(S.note),'★件数が減り、控えたことを出す');

console.log('\n=== ⑤ 作業者・⚙の倍率 ===');
const W=await p.evaluate((rows)=>{
  syncRole='staff'; roleApply();
  mwAmzRows=JSON.parse(JSON.stringify(rows)); mwMisMemo={}; mwAmzRender();
  const b=document.querySelector('#csvMwAmzList [data-mwrow="4573102666987"]');
  const r={ btn:!!(b&&b.querySelector('[data-mwsame]')), text:b?b.textContent:'' };
  syncRole='admin'; roleApply();
  $('mwMisX').value='3.5'; mwMisMemo={};
  r.px35=mwMisBad(mwAmzRows[2]);
  $('mwMisX').value='2'; r.ok2=mwMisBad(mwAmzRows[1]);
  $('mwMisX').value='2.5'; mwMisMemo={};
  r.list=CSV_CFG_IDS.indexOf('mwMisX')>=0;
  return r;
},ROWS);
ok(!W.btn&&/管理者が「同じ商品」を押します/.test(W.text),'★★作業者には「同じ商品」のボタンを出さない');
ok(W.px35===false,'★★⚙の倍率を 3.5 にすると、定価の 3倍の行は疑わない（倍率は⚙で変えられる）');
ok(W.ok2===false,'★倍率 2 でも、定価の 1.68倍の行は疑わない');
ok(W.list,'★★⚙の倍率は pj-sync にも送る（設定の一覧に入っている）');

console.log('\n=== ⑥ eBay 無在庫の出品候補から外す ===');
const M=await p.evaluate(()=>{
  const NOW=new Date().toISOString();
  const R=(jan,o)=>Object.assign({ jan:jan, sha:'M200', idx:0, kishu:'NS', name:'商品'+jan.slice(-3),
    cond:'新品', wholesale:1020, list_price:1500, stock:5, ship_days:0, ship_text:'即日出荷',
    mkt_n:8, mkt_n_new:5, mkt_low:60, mkt_low_any:null, mkt_ship:0, mkt_cur:'USD',
    mkt_no_ship:0, mkt_err:'', mkt_at:NOW, pics_ok:2 },o||{});
  mwRows=[R('4573102666987',{ name:'EG ULTRAMAN（ULTRAMAN: RISING）', asin:'B09VGGZCKM',
            amz_name:'BANDAI SPIRITS スター・ウォーズ マンダロリアン', amz_price:5000, amz_low:900 }),
          R('4902370550011',{ name:'ゼルダの伝説 ティアーズ オブ ザ キングダム', asin:'B0ZELDA001',
            amz_name:'ゼルダの伝説 ティアーズ オブ ザ キングダム -Switch', amz_price:6800, list_price:7900 })];
  mwMkt={ seen:2, left:0 }; mwMisMemo={};
  mwListRender();
  const el=$('mwList')||document.querySelector('#mwKindCount').parentNode;
  return { rec:mwRec(mwRows[0]), rec2:!!mwRec(mwRows[1]), why:mwPushWhy(mwRows[0]),
    kind:$('mwKindCount').textContent, sect:!!$('mwMisSect'),
    sectText:$('mwMisSect')?$('mwMisSect').textContent:'' };
});
console.log('   '+M.kind);
ok(M.rec===null&&M.rec2,'★★★疑いの行は無在庫の値段を出さない（Amazon の値段・重さを使わない）');
ok(/商品違いの疑い/.test(M.why),'★★★出品リストに入れられない理由は「商品違いの疑い」');
ok(/商品違いの疑い 1件/.test(M.kind)&&M.sect&&/スター・ウォーズ/.test(M.sectText),
   '★★出品候補の外に「商品違いの疑い」として分けて、名前を並べる');

await T.done();
})();
