/* 画面：国内FBA の一覧で仕入れの判断をする（6.93）
   ・並べ替え：粗利（税抜）順（既定）／利益率順／ジャンルごと
   ・絞り込み：黒字のみ（既定）・新品出品者2人以上・Amazon本体なし・利益率○%以上
   ・MW の数字には「MW」を付ける
   ・JAN と ASIN はタップでコピー。Keepa と Amazon を新しいタブで開く
   ・仕入れる印と数量を D1 に保存し、合計と送料無料までの残りを上に出す
   ・印を付けた行だけの一覧と、注文用CSV */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：仕入れの判断');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

/* 税抜の粗利と利益率が逆順になる組み合わせにしておく（並べ替えの違いが出る）。 */
const ROWS=[
 { jan:'4595120538169', sha:'M200', kishu:'NS', mw_name:'千銃士 限定版',
   list_price:22800, cond:'新品', wholesale:12000, stock:65, note:'在庫処分',
   ship_text:'即日出荷', ship_days:0, asin:'B0FVLXGFMH', amz_name:'千銃士（Amazon）',
   rank:649, rank_cat:'Switch ソフト', price:24829, basis:'カート', low:24829,
   buybox:24829, new_n:4, low_n:1, amz:1, fba_n:3, amz_err:'',
   amz_at:'2026-10-28T01:00:00Z', buy_qty:0 },
 { jan:'4582292602828', sha:'MC02', kishu:'b2cchara_figure', mw_name:'グリザイア',
   list_price:18700, cond:'新品', wholesale:4000, stock:4, note:'',
   ship_text:'ご注文より3．4営業日', ship_days:4, asin:'B0B98TXLKY',
   amz_name:'グリザイア（Amazon）', rank:2310, rank_cat:'フィギュア',
   price:9800, basis:'カート', low:9800, buybox:9800, new_n:1, low_n:1, amz:0,
   fba_n:1, amz_err:'', amz_at:'2026-10-28T01:00:00Z', buy_qty:0 },
 { jan:'4902370550467', sha:'E027', kishu:'NS', mw_name:'赤字の行',
   list_price:3000, cond:'新品', wholesale:9000, stock:3, note:'',
   ship_text:'翌営業日', ship_days:1, asin:'B00REDAAAA', amz_name:'赤字',
   rank:50000, rank_cat:'ゲーム', price:5000, basis:'最安', low:5000, buybox:0,
   new_n:2, low_n:1, amz:0, fba_n:0, amz_err:'', amz_at:'2026-10-28T01:00:00Z',
   buy_qty:0 }];
const META={ ok:true, n:3, rows:ROWS, seen:3, priced:3, left:0, per_run:120,
  ttl_days:3, last:{ at_jst:'2026-10-28 10:00' }, limit:3000 };

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('autoAdRate').value='6';
  $('fee').value='13.6'; $('intlFee').value='1.35'; $('feeTax').value='10';
  $('fixed').value='0.40'; $('pack').value='150'; $('shipCharge').value='15';
  $('targetMode').value='auto';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='2';
  $('mwKishu').value='NS,NS2,P5,b2cchara_figure,figure';
  $('mwNewOnly').checked=true; $('mwNoteAll').checked=false;
  $('mwNoteNg').value='ダメージ,引き上げ';
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  $('mwAmzFeeHobby').value='10'; $('mwAmzFbaHobby').value='580';
  $('csvMwAmzSort').value='net'; $('csvMwAmzWin').checked=true;
  $('csvMwAmzMulti').checked=false; $('csvMwAmzNoAmz').checked=false;
  $('csvMwAmzMinM').value='0';
  window.__buy=[]; window.__dl=[]; window.__copied=[];
  window.__buyRows=o.buyRows||[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/mw\/buy/.test(url)){
      if(i&&i.method==='POST'){
        window.__buy.push(b);
        /* 保存されたものを控えに反映する（本物と同じ動き） */
        const j=String(b.jan), q=+b.qty||0;
        window.__buyRows=window.__buyRows.filter((x)=>String(x.jan)!==j);
        if(q>0){
          const src=(o.rows||[]).filter((x)=>String(x.jan)===j)[0]||{};
          window.__buyRows.push(Object.assign({},src,{jan:j,qty:q}));
        }
        return new Response(JSON.stringify({ok:true,n:1,rows:[{jan:j,qty:q}]}),{status:200});
      }
      const rows=window.__buyRows;
      let yenSum=0;
      rows.forEach((r)=>{ yenSum+=Math.round((+r.wholesale||0)*1.1)*(+r.qty||0); });
      return new Response(JSON.stringify({ok:true,rows:rows,n:rows.length,
        qty:rows.reduce((a,x)=>a+(+x.qty||0),0),yen:yenSum,
        gone:rows.filter((x)=>x.gone_at).length}),{status:200});
    }
    if(/\/mw\/amz/.test(url)){
      if(i&&i.method==='POST')
        return new Response(JSON.stringify({ok:true,done:3,left:0,calls_cat:1,
          calls_prc:1,asin_ok:3,asin_ng:0,priced:3,none:0}),{status:200});
      return new Response(JSON.stringify(o.meta),{status:200});
    }
    return real(u,i);
  };
  /* navigator.clipboard は読み取り専用なので defineProperty で差し替える
     （素の代入は黙って失敗し、本物のクリップボードが使われてしまう）。 */
  Object.defineProperty(navigator,'clipboard',{ configurable:true,
    value:{ writeText:(t)=>{ window.__copied.push(t);
      return Promise.resolve(); } } });
  window.csvDownloadBlob=function(name,blob){
    return blob.arrayBuffer().then(function(ab){
      const u=new Uint8Array(ab);
      window.__dl.push({ name:name,
        text:new TextDecoder('utf-8').decode(u),
        bom:(u[0]===0xEF&&u[1]===0xBB&&u[2]===0xBF) }); });
  };
  switchTab('D'); roleCheck(); csvRender();
},o||{});

const load=async()=>{ await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
  await p.waitForTimeout(500); };

console.log('=== 既定は粗利（税抜）順（全ジャンル）===');
await setup({ meta:META, rows:ROWS });
await openCsvBoxes(p);
await load();
let t=await p.evaluate(()=>$('csvMwAmzList').textContent);
let order=await p.evaluate(()=>{
  const l=mwAmzPicked();
  l.sort((a,b)=>b.c.net-a.c.net);
  return l.map((x)=>x.r.jan+':'+x.c.net+':'+x.c.margin); });
console.log('   '+JSON.stringify(order));
ok(/粗利（税抜）の高い順/.test(t),'★★既定は粗利（税抜）順と出す');
ok(order.length===2,'★★黒字のみが既定（赤字の1件が外れる）');
ok(/ゲーム 1件/.test(t)===false,'★ジャンルで分けていない（全ジャンル）');

console.log('\n=== 並べ替えを変える ===');
let sorts=await p.evaluate(()=>{
  const g=(v)=>{ $('csvMwAmzSort').value=v; mwAmzRender();
    return { txt:$('csvMwAmzList').textContent.slice(0,40),
      ids:Array.prototype.map.call($('csvMwAmzList').querySelectorAll(
        'input[id^=mwBuyChk_]'),(x)=>x.id.replace('mwBuyChk_','')) }; };
  const net=g('net'), mg=g('margin'), ge=g('genre');
  $('csvMwAmzSort').value='net'; mwAmzRender();
  return { net:net, mg:mg, ge:ge };
});
console.log('   税抜順: '+JSON.stringify(sorts.net.ids));
console.log('   利益率順: '+JSON.stringify(sorts.mg.ids));
ok(/利益率の高い順/.test(sorts.mg.txt),'★★「利益率順」を選べる');
ok(sorts.net.ids.join()!==sorts.mg.ids.join(),
   '★★★粗利（税抜）順と利益率順で並びが変わる');
ok(/ゲーム|フィギュア/.test(sorts.ge.txt),'★★「ジャンルごと」を選べる');

console.log('\n=== 絞り込み ===');
let f=await p.evaluate(()=>{
  const n=()=>mwAmzPicked().length;
  const base=n();
  $('csvMwAmzWin').checked=false; const noWin=n();
  $('csvMwAmzWin').checked=true;
  $('csvMwAmzMulti').checked=true; const multi=n();
  $('csvMwAmzMulti').checked=false;
  $('csvMwAmzNoAmz').checked=true; const noAmz=n();
  $('csvMwAmzNoAmz').checked=false;
  $('csvMwAmzMinM').value='30'; const m30=n();
  $('csvMwAmzMinM').value='0';
  mwAmzRender();
  return { base:base, noWin:noWin, multi:multi, noAmz:noAmz, m30:m30 };
});
console.log('   '+JSON.stringify(f));
ok(f.base===2,'★黒字のみで2件');
ok(f.noWin===3,'★★「黒字のみ」を外すと赤字も出る');
ok(f.multi<f.base,'★★「新品出品者が2人以上」で減る');
ok(f.noAmz<f.base,'★★「Amazon本体なし」で減る');
ok(f.m30<=f.base,'★★「利益率がこれ以上」で絞れる');

console.log('\n=== MW の数字に「MW」が付く ===');
await p.evaluate(()=>{ $('csvMwAmzSort').value='net'; mwAmzRender(); });
t=await p.evaluate(()=>$('csvMwAmzList').textContent);
ok(/MW在庫 65点/.test(t),'★★★「MW在庫 65点」と出す');
ok(/MW出荷 0営業日/.test(t),'★★★「MW出荷 0営業日」と出す');
ok(/MW卸値/.test(t)&&/MW定価/.test(t),'★★卸値と定価にも MW を付ける');
ok(/MW備考/.test(t),'★★備考にも MW を付ける');
ok(/新品出品者 4人/.test(t),'★Amazon 側の数字はそのまま');

console.log('\n=== Keepa と Amazon のボタン ===');
let links=await p.evaluate(()=>Array.prototype.map.call(
  $('csvMwAmzList').querySelectorAll('a[target=_blank]'),
  (a)=>({href:a.getAttribute('href'),rel:a.getAttribute('rel'),t:a.textContent})));
console.log('   '+JSON.stringify(links.slice(0,2)));
ok(links.some((x)=>x.href==='https://keepa.com/#!product/5-B0FVLXGFMH'),
   '★★★Keepa のURLが仕様どおり（5-<ASIN>）');
ok(links.some((x)=>x.href==='https://www.amazon.co.jp/dp/B0FVLXGFMH'),
   '★★Amazon の商品ページ');
ok(links.every((x)=>/noopener/.test(x.rel||'')),'★★新しいタブで安全に開く');

console.log('\n=== タップでコピー ===');
await p.evaluate(()=>{
  const as=$('csvMwAmzList').querySelectorAll('a[onclick]');
  as[0].click(); as[1].click(); });
await p.waitForTimeout(200);
let cp=await p.evaluate(()=>({ copied:window.__copied,
  note:$('csvMwAmzCopyNote').textContent,
  show:getComputedStyle($('csvMwAmzCopyNote')).display }));
console.log('   '+JSON.stringify(cp));
ok(cp.copied.length===2,'★★JAN と ASIN の両方がコピーできる');
ok(cp.copied.indexOf('4595120538169')>=0,'★★★JAN をコピーする');
ok(cp.copied.indexOf('B0FVLXGFMH')>=0,'★★★ASIN をコピーする');
ok(/コピーしました/.test(cp.note)&&cp.show!=='none','★★コピーしたと短く出す');

console.log('\n=== 仕入れる印と数量 ===');
await p.evaluate(()=>{
  $('mwBuyQty_4595120538169').value='3';
  $('mwBuyChk_4595120538169').checked=true;
  mwBuyToggle('4595120538169'); });
await p.waitForTimeout(500);
let buy=await p.evaluate(()=>({ sent:window.__buy,
  bar:$('csvMwBuyBar').textContent,
  show:getComputedStyle($('csvMwBuyBar')).display }));
console.log('   送った: '+JSON.stringify(buy.sent));
console.log('   '+buy.bar.replace(/\s+/g,' '));
ok(buy.sent.length===1&&buy.sent[0].jan==='4595120538169'&&buy.sent[0].qty===3,
   '★★★印と数量を D1 に送る（ほかの端末でも見える）');
ok(buy.show!=='none','★まとめの帯が出る');
ok(/仕入れる 1件/.test(buy.bar),'★★件数を出す');
ok(/数量の合計 3点/.test(buy.bar),'★★数量の合計を出す');
const want=Math.round(12000*1.1)*3;
ok(buy.bar.indexOf(String(want.toLocaleString('ja-JP')))>=0
  ||buy.bar.replace(/[^0-9]/g,'').indexOf(String(want))>=0,
   '★★★合計は卸値×1.1×数量');
ok(/送料無料/.test(buy.bar)&&/まであと/.test(buy.bar),
   '★★★送料無料（5万円）まであといくらを出す');
let row=await p.evaluate(()=>{
  const d=$('csvMwAmzList').querySelector('div[style*="--good"]');
  /* 1行目に税抜の式（6.111）が入って長くなったので、札の全文を見る。 */
  return d?d.textContent:''; });
ok(/仕入れる 3点/.test(row),'★★印の付いた行に数量のバッジを出す');

console.log('\n=== 印を外す ===');
await p.evaluate(()=>{ $('mwBuyChk_4595120538169').checked=false;
  mwBuyToggle('4595120538169'); });
await p.waitForTimeout(500);
let off=await p.evaluate(()=>({ sent:window.__buy[window.__buy.length-1],
  show:getComputedStyle($('csvMwBuyBar')).display }));
ok(off.sent.qty===0,'★★チェックを外すと数量0で送る（印が消える）');
ok(off.show==='none','★★印が無くなれば帯も消える');

console.log('\n=== ほかの端末で付けた印が見える ===');
await setup({ meta:{ ok:true, n:3, rows:ROWS.map(function(r){
    return (r.jan==='4582292602828')?Object.assign({},r,{buy_qty:2}):r; }),
  seen:3, priced:3, left:0, per_run:120, last:{at_jst:'x'}, limit:3000 },
  rows:ROWS,
  buyRows:[Object.assign({},ROWS[1],{qty:2})] });
await openCsvBoxes(p);
await load();
let other=await p.evaluate(()=>({
  chk:$('mwBuyChk_4582292602828').checked,
  qty:$('mwBuyQty_4582292602828').value,
  bar:$('csvMwBuyBar').textContent }));
console.log('   '+JSON.stringify(other));
ok(other.chk===true&&other.qty==='2',
   '★★★一覧を出したときに D1 の印がチェックと数量に入る');
ok(/仕入れる 1件/.test(other.bar),'★★帯にも出る');

console.log('\n=== 仕入れる一覧と注文用CSV ===');
await p.evaluate(()=>{ $('csvMwBuyShow').click(); });
await p.waitForTimeout(400);
let only=await p.evaluate(()=>$('csvMwAmzList').textContent);
console.log('   '+only.replace(/\s+/g,' ').slice(0,140));
ok(/仕入れる 1件/.test(only),'★★印を付けた行だけの一覧が出る');
ok(/グリザイア/.test(only)&&!/千銃士/.test(only),'★★印の無い行は出ない');
ok(/MW在庫/.test(only)&&/MW出荷/.test(only),'★こちらでも MW を付ける');
await p.evaluate(()=>{ $('csvMwBuyCsv').click(); });
await p.waitForTimeout(500);
let dl=await p.evaluate(()=>window.__dl);
ok(dl.length===1&&/^mw_order_\d{8}\.csv$/.test(dl[0].name),
   '★★★注文用CSV を書き出す（mw_order_日付.csv）');
const parse=(txt)=>{ const rows=[]; let row=[],cur='',q=false;
  const t=txt.replace(/^﻿/,'').replace(/\r\n$/,'');
  for(let i=0;i<t.length;i++){ const c=t[i];
    if(q){ if(c==='"'){ if(t[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else if(c==='"')q=true; else if(c===','){ row.push(cur); cur=''; }
    else if(c==='\r'&&t[i+1]==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; i++; }
    else cur+=c; }
  if(cur!==''||row.length){ row.push(cur); rows.push(row); }
  return rows; };
const cells=parse(dl[0].text);
console.log('   列: '+cells[0].join(','));
ok(cells[0][0]==='数量'&&cells[0][1]==='JAN','★★数量と JAN が先頭（注文用）');
ok(cells[0].indexOf('社')>=0&&cells[0].indexOf('仕入値（税込）')>=0,
   '★★社と仕入値が入る');
ok(cells[0].indexOf('MW在庫')>=0&&cells[0].indexOf('MW出荷（営業日）')>=0,
   '★★MW の列に MW を付ける');
ok(cells[1][1]==='="4582292602828"','★★JAN は ="…" の形');
ok(+cells[1][0]===2,'★数量が入る');
ok(cells[cells.length-1][3]==='合計','★★★最後に合計の行を入れる');
ok(+cells[cells.length-1][6]===Math.round(4000*1.1)*2,'★★合計の金額');
ok(dl[0].bom===true,'★BOM 付き（Excel で開ける）');

await T.done();
})();
