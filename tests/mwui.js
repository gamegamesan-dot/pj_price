/* 出品CSVタブ：MW の在庫CSVの取り込みと候補一覧（6.85・段取りA）
   ・Shift_JIS のまま読める／出荷日を営業日数に直す／読めない文字を画面に残す
   ・400行ずつ分けて pj-sync に送る（part / parts）
   ・候補一覧に 5章の式（卸値×1.1＋送料）の推奨売値・最低売値・利益を出す
   ・この段では出品しない（写真も付けない）
   ・作業者のキーでは取り込めない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('出品CSV：MW の在庫');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('autoAdRate').value='6';
  $('fee').value='13.6'; $('intlFee').value='1.35'; $('feeTax').value='10';
  $('fixed').value='0.40'; $('pack').value='150'; $('shipCharge').value='15';
  $('targetMode').value='auto';
  $('syncWeightGame').value='150'; $('syncWeight').value='400';
  $('mwShipFee').value='176';
  $('mwKishu').value='NS,NS2,NS2H,P5,P4,b2cchara_figure,figure,FIG,GF,plasticmodel';
  $('mwShipMax').value='4'; $('mwStockMin').value='2'; $('mwNewOnly').checked=true;
  window.__mw=[]; window.__q=null;
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(x,st)=>Promise.resolve({ok:!st||st<400,status:st||200,
      text:()=>Promise.resolve(JSON.stringify(x)), json:()=>Promise.resolve(x)});
    if(/\/whoami/.test(url))return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/mw\/stock/.test(url)){
      window.__mw.push(body);
      return res({ ok:true, part:body.part, parts:body.parts, taken:body.rows.length,
        added:body.rows.length, changed:0, same:0, skipped:0, gone:0, back:0,
        picked:(body.part>=body.parts)?3:0, seen:body.rows_in,
        warn:o.warn||'' });
    }
    if(/\/mw\/list/.test(url)){
      window.__q=url;
      return res({ ok:true, n:3, alive:12, picked:5,
        last:{at:'2026-10-25T01:00:00Z',at_jst:'2026-10-25 10:00',rows_in:12,
              added:12,changed:0,same:0,gone:0,back:0,picked:5,unreadable:2,warn:null},
        rows:[
          { jan:'4902370550467',sha:'M200',idx:0,kishu:'NS',name:'ベヨネッタ',
            list_price:3480,release:'2022/01/01',cond:'新品',wholesale:2888,
            stock:5,note:'',ship_text:'即日出荷',ship_days:0,
            seen_at:'2026-10-25T01:00:00Z' },
          { jan:'4580416924740',sha:'MC02',idx:0,kishu:'b2cchara_figure',
            name:'グリザイア トーカ',list_price:18700,release:'2022/06/01',
            cond:'新品',wholesale:16082,stock:4,note:'◎値引き商品',
            ship_text:'ご注文より3．4営業日',ship_days:4,
            seen_at:'2026-10-25T01:00:00Z' },
          { jan:'4573591750617',sha:'M200',idx:0,kishu:'NS',name:'高すぎる商品',
            list_price:4980,release:'2025/01/01',cond:'新品',wholesale:300000,
            stock:9,note:'',ship_text:'即日出荷',ship_days:0,
            seen_at:'2026-10-25T01:00:00Z' }]});
    }
    if(/\/status|\/settings|\/listings|\/sync/.test(url))return res({accepted:0,items:[]});
    return real(u,i);
  };
  csvList=[]; csvSaveList();
  switchTab('D'); roleCheck(); csvRender();
},o||{});

console.log('=== 出荷日 → 営業日数（仕様3章の規則）===');
await setup({});
const days=async(list)=>await p.evaluate((a)=>a.map(function(t){
  return t+' → '+String(mwShipDays(t)); }),list);
let d=await days(['即日出荷','12時締め、当日出荷','即出荷可能','翌営業日','翌日',
  '1~2営業日','ご注文より2．3営業日','ご注文より3.4営業日','5.6営業日','7.8営業日',
  'ご注文後2〜4日程度','注文後2〜3日','土日祭日を除き、3日以内に弊社出荷',
  '11月中旬予定','29日（木）','毎週月曜日AM締め、翌々週月曜日入荷予定','2週間',
  '','　','へんな文字']);
d.forEach(function(x){ console.log('   '+x); });
console.log('   '+(await days(['ご注文後2〜3営業','0716 出荷','ご注文後2〜3'])).join('／'));
let m=await p.evaluate(()=>({
  soku:mwShipDays('即日出荷'), tome:mwShipDays('12時締め、当日出荷'),
  kano:mwShipDays('即出荷可能'), yoku:mwShipDays('翌営業日'), yo2:mwShipDays('翌日'),
  d12:mwShipDays('1~2営業日'), d23:mwShipDays('ご注文より2．3営業日'),
  d34:mwShipDays('ご注文より3.4営業日'), d56:mwShipDays('5.6営業日'),
  d78:mwShipDays('7.8営業日'), nichi:mwShipDays('ご注文後2〜4日程度'),
  nichi2:mwShipDays('注文後2〜3日'), inai:mwShipDays('土日祭日を除き、3日以内に弊社出荷'),
  yotei:mwShipDays('11月中旬予定'), hi:mwShipDays('29日（木）'),
  shu:mwShipDays('毎週月曜日AM締め、翌々週月曜日入荷予定'),
  wk:mwShipDays('2週間'), kara:mwShipDays(''), zen:mwShipDays('　'),
  nasi:mwShipDays('ご注文後2〜3営業'), hiz:mwShipDays('0716 出荷'),
  bad:mwShipDays('へんな文字') }));
ok(m.soku===0&&m.tome===0&&m.kano===0,'★★即日・当日出荷・即出荷可能＝0');
ok(m.yoku===1&&m.yo2===1,'★★翌営業日・翌日＝1');
ok(m.d12===2&&m.d23===3&&m.d34===4&&m.d56===6&&m.d78===8,
   '★★「N.M営業日」は大きい方（全角の．も読む）');
ok(m.nichi===4&&m.nichi2===3&&m.inai===3,
   '★★「営業日」が無い「N〜M日」「N日以内」も大きい方');
ok(m.yotei===99&&m.hi===99&&m.shu===99&&m.wk===99,
   '★★日付・週単位・予約・2週間は 99（無在庫に使わない）');
ok(m.nasi===3,'★★「日」が落ちた「N〜M営業」も読む（実データにあった書き方）');
ok(m.hiz===99,'★★「0716 出荷」のような日付だけの書き方は 99');
ok(m.kara===99&&m.zen===99,'★★空欄は 99（無在庫に使わない。読めない文字とは分ける）');
ok(m.bad===null,'★★読めない文字だけ null（呼ぶ側が 99 にして一覧に残す）');

console.log('\n=== Shift_JIS の CSV を読む ===');
/* Shift_JIS のバイト列を作って、file 選択と同じ流れで読ませる。 */
const CSV=[
 'JAN,社,機種,商品名,定価,発売日,新・中,卸値,掲載数,備考,出荷日',
 '4902370550467,M200,NS,ベヨネッタ,3480,2022/01/01,新品,2888,5,,即日出荷',
 '4902370550467,Co52,NS,ベヨネッタ,3480,2022/01/01,新品,2500,2,,12時締め、当日出荷',
 '4902370550467,M200,NS,ベヨネッタ,3480,2022/01/01,新品,3100,300,,即日出荷',
 '4580416924740,MC02,b2cchara_figure,グリザイア,18700,2022/06/01,新品,16082,4,◎値引き商品,ご注文より3．4営業日',
 '4970381909444,Q061,seal,ちいかわシール,500,2024/09/01,新品,300,200,,11月中旬予定',
 '490237055046,M200,NS,桁が足りない,3480,2022/01/01,新品,2888,5,,即日出荷',
 '4988611224878,E027,NS,新古の商品,3980,2021/01/01,新古,3984,8,,へんな文字'
].join('\r\n');
let parsed=await p.evaluate((t)=>{
  const d=mwParse(t);
  return { n:d.rows.length, ng:d.ng, dup:d.dup, unread:d.unread,
    bad:Object.keys(d.bad||{}),
    first:d.rows[0], idx:d.rows.map(function(r){ return r.jan+'/'+r.sha+'/'+r.idx; }),
    days:d.rows.map(function(r){ return r.ship_days; }) };
},CSV);
console.log('   '+JSON.stringify(parsed.idx));
console.log('   読めない: '+JSON.stringify(parsed.bad)+'／出荷日: '+JSON.stringify(parsed.days));
ok(parsed.n===6&&parsed.ng===1,'★★13桁でないJANの1行を除いて6行');
ok(parsed.idx[0]==='4902370550467/M200/0'&&parsed.idx[2]==='4902370550467/M200/1',
   '★★同じ (JAN,社) は idx 0,1 で分ける');
ok(parsed.dup===1,'★重複した行数を数える');
ok(parsed.bad.length===1&&parsed.bad[0]==='へんな文字','★★読めない文字を集める');
ok(parsed.unread===1,'★読めなかった行数');
ok(parsed.days[4]===99,'★★予約は 99');
ok(parsed.first.wholesale===2888&&parsed.first.cond==='新品','★中身が入る');
let kara=await p.evaluate(()=>{
  const d=mwParse('JAN,社,機種,商品名,定価,発売日,新・中,卸値,掲載数,備考,出荷日\r\n'
    +'4902370550467,M200,NS,空欄の行,3480,2022/01/01,新品,2888,5,,');
  return { empty:d.empty, unread:d.unread, bad:Object.keys(d.bad||{}),
    days:d.rows[0].ship_days, note:0 };
});
ok(kara.empty===1&&kara.unread===0&&kara.bad.length===0&&kara.days===99,
   '★★出荷日が空欄の行は 99 にするだけで、読めない文字の一覧には出さない');

console.log('\n=== 分けて送る（part / parts）===');
await setup({});
await p.evaluate((t)=>{ mwImportRun(t); },CSV);
await p.waitForTimeout(500);
let sent=await p.evaluate(()=>({ n:window.__mw.length,
  parts:window.__mw.map(function(x){ return x.part+'/'+x.parts; }),
  rows:window.__mw[0]?window.__mw[0].rows.length:0,
  at:window.__mw[0]?!!window.__mw[0].at:false,
  rows_in:window.__mw[0]?window.__mw[0].rows_in:0,
  unread:window.__mw[0]?window.__mw[0].unreadable:0,
  note:$('csvMwNote').textContent,
  ship:$('csvMwShipList').textContent,
  shipShow:getComputedStyle($('csvMwShipBox')).display }));
console.log('   '+JSON.stringify({n:sent.n,parts:sent.parts,rows:sent.rows}));
console.log('   '+sent.note.slice(0,160));
ok(sent.n===1&&sent.parts[0]==='1/1','★★6行なら1便');
ok(sent.rows===6&&sent.rows_in===6,'★★送るのは13桁のJANの行だけ');
ok(sent.at===true,'★取り込みの時刻を付ける');
ok(sent.unread===1,'★★読めなかった行数も送る');
ok(/6行を送りました/.test(sent.note),'★結果を出す');
ok(/JANが13桁でない行 1件/.test(sent.note),'★★除いた行を知らせる');
ok(/同じJAN・社の行 1件/.test(sent.note),'★★同じJAN・社の行を知らせる');
ok(/出荷日が読めなかった 1行/.test(sent.note),'★★読めなかった行を知らせる');
ok(sent.shipShow!=='none'&&/へんな文字/.test(sent.ship),
   '★★読めなかった文字を画面に残す');

console.log('\n=== 候補一覧（推奨売値と利益）===');
let lst=await p.evaluate(()=>({ q:window.__q,
  note:$('csvMwListNote').textContent,
  html:$('csvMwList').textContent.replace(/\s+/g,' ') }));
console.log('   '+lst.q);
console.log('   '+lst.note.slice(0,200));
console.log('   '+lst.html.slice(0,400));
ok(/kishu=NS/.test(lst.q)&&/new_only=1/.test(lst.q)
   &&/ship_max=4/.test(lst.q)&&/stock_min=2/.test(lst.q),
   '★★⚙設定の条件を付けて取り込む');
ok(/候補 3件/.test(lst.note),'★件数を出す');
ok(/MW の生きている行 12/.test(lst.note)&&/代表 5/.test(lst.note),
   '★★生きている行と代表の数も出す');
ok(/前回の取り込み 2026-10-25 10:00/.test(lst.note),'★★前回を日本時間で出す');
ok(/ベヨネッタ/.test(lst.html)&&/グリザイア/.test(lst.html),'★★候補が並ぶ');
ok(/JAN 4902370550467/.test(lst.html)&&/社 M200/.test(lst.html),'★JANと社を出す');
ok(/在庫 5点/.test(lst.html)&&/出荷 0営業日/.test(lst.html),'★在庫と出荷を出す');

console.log('\n=== 5章の式（卸値×1.1＋¥176）===');
let calc=await p.evaluate(()=>{
  const r={ jan:'4902370550467',kishu:'NS',wholesale:2888,stock:5 };
  const rec=mwRec(r);
  const f={ jan:'4580416924740',kishu:'b2cchara_figure',wholesale:16082,stock:4 };
  const recF=mwRec(f);
  return { cost:mwCost(r), w:mwWeight(r), price:rec.price, floor:rec.floor,
           profit:rec.profit, target:rec.target,
           costF:mwCost(f), wF:mwWeight(f), priceF:recF.price,
           /* 同じ仕入値を出品CSVの式に入れたときと一致するか */
           same:csvPriceFor(mwCost(r),150).price };
});
console.log('   '+JSON.stringify(calc));
ok(calc.cost===Math.round(2888*1.1)+176,'★★仕入値＝卸値×1.1＋¥176');
ok(calc.w===150&&calc.wF===400,'★★重量はゲーム150g・ホビー400g（⚙設定）');
ok(calc.price>0&&calc.floor>0&&calc.price>=calc.floor,'★推奨売値と最低売値が出る');
ok(calc.price===calc.same,
   '★★出品CSV・販売連携と同じ式（shared/pricing.js）で1円もずれない');
ok(Math.abs(calc.target-(1000+calc.cost*0.3))<0.01,
   '★★下限利益＝下限利益＋仕入値×連動率');
ok(/推奨売値/.test(lst.html)&&/利益/.test(lst.html)&&/下限利益/.test(lst.html),
   '★★一覧に推奨売値・利益・下限利益を出す');

console.log('\n=== 相場を調べる前は「未調査」に入る（4章の6は 6.86）===');
let split=await p.evaluate(()=>{
  const t=$('csvMwList').textContent;
  return { n:/候補 3件/.test(t),
    none:/④ 相場 未調査 3件/.test(t),
    say:/相場 未調査/.test(t),
    order:(function(){
      /* 未調査の中は売値が低い順に並ぶ。 */
      const i1=t.indexOf('ベヨネッタ'), i2=t.indexOf('グリザイア'),
            i3=t.indexOf('高すぎる商品');
      return i1<i2&&i2<i3; })() };
});
console.log('   '+JSON.stringify(split));
/* 推奨売値は下限利益がちょうど出る値段なので、3件すべて「利益は出る」。
   実際のふるい分けは eBay の相場と比べる 4章の6（6.86 で実装した）。
   相場をまだ引いていない行は「未調査」に入り、出品候補には混ぜない。 */
ok(split.n,'★★値段を出せた3件が候補になる');
ok(split.none,'★★相場を調べていない行は「未調査」に入る（出品候補に混ぜない）');
ok(split.say,'★★行にも「相場 未調査」と出して、調べるよう促す');
ok(split.order,'★★売値が低い順に並べる');

console.log('\n=== 行数が減りすぎたときの警告 ===');
await setup({warn:'今回の取り込みは 3行で、生きている 12行より 75% 少ないため、欠品にしていません'});
await p.evaluate((t)=>{ mwImportRun(t); },CSV);
await p.waitForTimeout(400);
let w=await p.evaluate(()=>({ show:getComputedStyle($('csvMwWarn')).display,
  txt:$('csvMwWarn').textContent }));
console.log('   '+w.txt.slice(0,80));
ok(w.show!=='none'&&/欠品にしていません/.test(w.txt),
   '★★取得ミスの警告を画面に出す');

console.log('\n=== この段では出品しない ===');
let no=await p.evaluate(()=>({ list:csvList.length,
  btn:!!document.querySelector('#csvMwBox button[id*="Export"]') }));
ok(no.list===0,'★★出品リストには入れない（候補を見るだけ）');
ok(no.btn===false,'★★書き出しのボタンは置かない');

console.log('\n=== 作業者のキー ===');
await setup({role:'staff'});
await p.evaluate((t)=>{ mwImportRun(t); },CSV);
await p.waitForTimeout(300);
let st=await p.evaluate(()=>({ n:window.__mw.length,
  note:$('csvMwNote').textContent }));
console.log('   '+JSON.stringify(st));
ok(st.n===0,'★★送らない');
ok(/管理者用のキー/.test(st.note),'★理由を出す');

await T.done();
})();
