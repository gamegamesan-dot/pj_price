/* 出品CSV：MW の在庫CSVの読み込み（6.88）
   v187 の不具合：MW の書き出しには備考に閉じていない「"」が入る行があり
   （stocks_3.csv の物理行 3805）、欄が改行をまたげる普通の読み方だと
   その行以降が1つの欄に飲み込まれ、12,062行あるのに 3,802行で静かに終わる。
   ・改行は必ず行の区切り（1行＝1件）
   ・列の数が合わない行は数えて、足りない行は飛ばし、多い行は先頭11列を使う
   ・送る前に「ファイルの大きさ・読んだ行数・列が合わない行」を画面に出す
   ・備考の注意する言葉で候補から外す（6.89）
   ・推奨売値は目標利益の売値であることを正しく表示する（6.90） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('出品CSV：MW の読み込み');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const setup=async()=>await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('autoAdRate').value='6';
  $('fee').value='13.6'; $('intlFee').value='1.35'; $('feeTax').value='10';
  $('fixed').value='0.40'; $('pack').value='150'; $('shipCharge').value='15';
  $('targetMode').value='auto';
  $('syncWeightGame').value='150'; $('syncWeight').value='400';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='2';
  $('mwKishu').value='NS,NS2,NS2H,P5,P4,b2cchara_figure,figure,FIG,GF,plasticmodel';
  $('mwNewOnly').checked=true; $('mwNoteAll').checked=false;
  $('mwNoteNg').value='ダメージ,引き上げ,箱潰れ,訳あり,難あり,ジャンク,外箱不良,パッケージ不良';
  window.__mw=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body)?JSON.parse(i.body):null;
    if(/\/mw\/stock/.test(url)){ window.__mw.push(b);
      return new Response(JSON.stringify({ok:true,taken:b.rows.length,
        added:b.rows.length,changed:0,same:0,gone:0,back:0,picked:0,
        skipped:0,seen:0,warn:''}),{status:200}); }
    if(/\/mw\/list/.test(url))
      return new Response(JSON.stringify({ok:true,n:0,rows:[],mkt:{}}),{status:200});
    return real(u,i);
  };
  switchTab('D'); roleCheck(); csvRender();
});

/* ---- 実データと同じ形の CSV を作る ----
   ・全部の欄を " で囲む（MW の書き出しの形）
   ・物理行 3805 は stocks_3.csv の壊れた行をそのまま置く
   ・JAN が13桁でない行を 147 行混ぜる
   ・中身は 12,209 行（stocks_3.csv と同じ）
   → 送れる行は 12,209 − 147 ＝ 12,062 行になるはず */
const BROKEN='"4582224494569","F313","PP","機動戦士ガンダム 木馬の軌跡","5981",'
  +'"2012/01/26","新古","1600","2","\\\\\\\\初回封入シリアルコード\t\\\\\\\\""",,,,,,'
  +'2100-01-01 00:00:00""",""';
const BIG=await p.evaluate((broken)=>{
  const q=(x)=>'"'+String(x)+'"';
  const line=(jan,sha,kishu,name,note,ship)=>[jan,sha,kishu,name,'5000',
    '2025/01/01','新品','3000','5',note,ship].map(q).join(',');
  const out=['JAN,社,機種,商品名,定価,発売日,新・中,卸値,掲載数,備考,出荷日'
    .split(',').map(q).join(',')];
  let bad=0;
  for(let i=1;i<=12209;i++){
    if(i===3804){ out.push(broken); continue; }   // 中身の3804件目＝物理行3805
    if(bad<147&&i%80===0){ bad++;
      out.push(line('490237055046'+'', 'M200','NS','桁が足りない','','即日出荷'));
      continue; }
    out.push(line(String(4900000000000+i),'M200','NS','商品'+i,'','即日出荷'));
  }
  return { text:out.join('\r\n')+'\r\n', bad:bad, n:out.length };
},BROKEN);
console.log('=== 作った CSV ===');
console.log('   行数（見出し込み）: '+BIG.n+'　JANが13桁でない行: '+BIG.bad
  +'　大きさ: '+Math.round(BIG.text.length/1024)+'KB');
ok(BIG.n===12210,'★見出し1行＋中身12,209行');
ok(BIG.bad===147,'★13桁でないJANを147行混ぜた');

console.log('\n=== 壊れた行で止まらないこと（v187 の不具合）===');
await setup();
let d=await p.evaluate((t)=>{
  const r=mwParse(t);
  return { n:r.rows.length, ng:r.ng, few:r.few, many:r.many, blank:r.blank,
    lines:r.lines, data:r.data, cols:r.cols };
},BIG.text);
console.log('   '+JSON.stringify(d));
ok(d.lines===12210&&d.data===12209,'★★12,210行すべて読む（途中で終わらない）');
ok(d.cols===11,'★列は11');
ok(d.many===1&&d.few===0,'★★列の数が合わない行は1行（壊れた備考の行）だけ');
ok(d.ng===147,'★★13桁でないJANを147行と数える（画面でも147件）');
ok(d.n===12062,'★★★送る行は 12,062 行（v187 は 3,802 行で終わっていた）');

console.log('\n=== 1行＝1件で読む ===');
let one=await p.evaluate(()=>({
  /* 欄の中のカンマは引用符で守られる */
  comma:mwSplitLine('"a","b,c","d"').join('|'),
  /* "" は1つの " */
  esc:mwSplitLine('"a","b""c","d"').join('|'),
  /* 閉じていない " があっても、その行で終わる（次の行に続かない） */
  open:mwSplitLine('"a","b').join('|'),
  /* 囲んでいない欄も読む */
  plain:mwSplitLine('a,b,c').join('|'),
  /* 改行は必ず区切り */
  lines:mwLines('a\r\nb\nc\r').length,
  tail:mwLines('a\r\nb\r\n').length }));
console.log('   '+JSON.stringify(one));
ok(one.comma==='a|b,c|d','★★欄の中のカンマは守る');
ok(one.esc==='a|b"c|d','★★"" は1つの " として読む');
ok(one.open==='a|b','★★閉じていない " はその行で切る（以降を飲み込まない）');
ok(one.plain==='a|b|c','★囲んでいない欄も読む');
ok(one.lines===3,'★★改行（CRLF・LF・CR）はすべて行の区切り');
ok(one.tail===2,'★末尾の空行は数えない');

console.log('\n=== 壊れた行の中身（先頭11列を使う）===');
let br=await p.evaluate((b)=>{
  const f=mwSplitLine(b);
  const r=mwParse('"JAN","社","機種","商品名","定価","発売日","新・中","卸値",'
    +'"掲載数","備考","出荷日"\r\n'+b);
  return { cols:f.length, row:r.rows[0], many:r.many, n:r.rows.length };
},BROKEN);
console.log('   列数: '+br.cols+'　'+JSON.stringify(br.row));
ok(br.cols>11,'★★壊れた行は列が11より多くなる');
ok(br.many===1&&br.n===1,'★★数えたうえで、先頭11列で救う');
ok(br.row.jan==='4582224494569'&&br.row.sha==='F313'
  &&br.row.wholesale===1600&&br.row.stock===2,
   '★★JAN・社・卸値・在庫は正しく取れる');
ok(br.row.ship_days===99,
   '★★出荷日は読めないので 99（無在庫には使わない）＝安全側');

console.log('\n=== 送る前に読んだ結果を出す（黙って減らない）===');
await setup();
await p.evaluate((t)=>{ mwImportRun(t,{ name:'stocks_3.csv', size:1924439 }); },BIG.text);
await p.waitForTimeout(1500);
let read=await p.evaluate(()=>({
  show:getComputedStyle($('csvMwRead')).display,
  txt:$('csvMwRead').textContent }));
console.log('   '+read.txt.replace(/\s+/g,' '));
ok(read.show!=='none','★★読んだ結果を画面に出す');
ok(/1\.84MB|1\.83MB|MB/.test(read.txt),'★★ファイルの大きさを出す');
ok(/stocks_3\.csv/.test(read.txt),'★ファイル名を出す');
ok(/読んだ行数 12210行/.test(read.txt),'★★読んだ行数を出す');
ok(/列の数が合わない行 1行/.test(read.txt),'★★列の数が合わない行の数を出す');
ok(/送る行 12062行/.test(read.txt),'★★送る行数を出す');
ok(!/説明の付かない行/.test(read.txt),'★★数が全部つじつまが合う');

console.log('\n=== 本当に 12,062 行送られるか ===');
let sent=await p.evaluate(()=>({
  parts:window.__mw.length,
  rows:window.__mw.reduce((a,b)=>a+b.rows.length,0),
  rows_in:window.__mw[0]?window.__mw[0].rows_in:0,
  last:window.__mw.length?window.__mw[window.__mw.length-1].parts:0 }));
console.log('   '+JSON.stringify(sent));
ok(sent.rows===12062,'★★★送った行の合計が 12,062 行');
ok(sent.parts===31&&sent.last===31,'★★400行ずつ31便で送る');

console.log('\n=== 備考による除外（6.89）===');
const MKROWS=[
 { jan:'4902370550467', sha:'M200', idx:0, kishu:'NS', name:'ふつうの新品',
   cond:'新品', wholesale:3000, stock:5, ship_days:0, note:'在庫処分',
   mkt_n:12, mkt_n_new:8, mkt_low:90, mkt_low_any:40, mkt_ship:0,
   mkt_err:'', mkt_at:'2026-10-26T01:00:00Z', pics_ok:0 },
 { jan:'4562475323726', sha:'MC02', idx:0, kishu:'figure', name:'店頭引き上げ品',
   cond:'新品', wholesale:3000, stock:4, ship_days:2,
   note:'在庫処分 ★新品・未使用品ですが、店頭引き上げ品の為パッケージにダメージがあります',
   mkt_n:3, mkt_n_new:3, mkt_low:200, mkt_low_any:200, mkt_ship:0,
   mkt_err:'', mkt_at:'2026-10-26T01:00:00Z', pics_ok:0 }];
await setup();
await openCsvBoxes(p);
let ex=await p.evaluate((rows)=>{
  const a=mwNoteHit(rows[0]), b=mwNoteHit(rows[1]);
  mwRows=rows; mwMkt={seen:2,hit:2,none:0,left:0}; mwListRender();
  const t=$('csvMwList').textContent;
  return { a:a, b:b, badge:/状態に注意/.test(t),
    words:/「引き上げ」「ダメージ」|「ダメージ」|「引き上げ」/.test(t),
    cfg:/⚙設定で候補に含められます/.test(t) };
},MKROWS);
console.log('   当たった言葉: '+JSON.stringify(ex.a)+' / '+JSON.stringify(ex.b));
ok(ex.a.length===0,'★★備考が「在庫処分」だけの行は注意にしない');
ok(ex.b.indexOf('引き上げ')>=0&&ex.b.indexOf('ダメージ')>=0,
   '★★「引き上げ」「ダメージ」の両方を拾う');
ok(ex.badge,'★★行に「状態に注意」の印を出す');
ok(ex.words,'★★当たった言葉を出す（なぜ注意なのか分かる）');
ok(ex.cfg,'★★⚙設定で含められると案内する');

let q=await p.evaluate(()=>{
  window.__q=null;
  const real=window.fetch;
  window.fetch=async(u,i)=>{ const url=String(u);
    if(/\/mw\/list/.test(url)){ window.__q=url;
      return new Response(JSON.stringify({ok:true,n:0,rows:[],mkt:{}}),{status:200}); }
    return real(u,i); };
  mwListRun();
  return new Promise((r)=>setTimeout(()=>r(window.__q),400));
});
console.log('   '+String(q).replace(/^.*\/mw\/list/,''));
ok(/note_ng=/.test(q),'★★注意する言葉を Worker に送る（候補の件数もそろう）');
ok(/note_all=0/.test(q),'★★既定は「外す」（note_all=0）');
ok(decodeURIComponent(q).indexOf('ダメージ')>=0,'★言葉の中身が乗る');
let q2=await p.evaluate(()=>{
  window.__q=null; $('mwNoteAll').checked=true; mwListRun();
  return new Promise((r)=>setTimeout(()=>r(window.__q),400));
});
ok(/note_all=1/.test(q2),'★★⚙で「含める」にしたら note_all=1 で送る');
await p.evaluate(()=>{ $('mwNoteAll').checked=false; });

console.log('\n=== 推奨売値は「目標利益」の売値（6.90）===');
let lab=await p.evaluate((rows)=>{
  mwRows=rows; mwMkt={seen:2,hit:2,none:0,left:0}; mwListRender();
  const t=$('csvMwList').textContent;
  const rec=mwRec(rows[0]);
  return { t:t, target:rec.target, price:rec.price, floor:rec.floor,
    profit:rec.profit,
    auto:PJP.autoTarget(pricingSettings(),rec.cost),
    base:+$('baseProfit').value };
},MKROWS);
console.log('   推奨売値 $'+lab.price+'　利益 '+Math.round(lab.profit)
  +'円　目標利益 '+Math.round(lab.target)+'円　下限の売値 $'+lab.floor
  +'（下限利益 '+lab.base+'円）');
ok(Math.abs(lab.target-lab.auto)<0.01,
   '★★rec.target は autoTarget（＝下限利益＋仕入値×連動率）＝**目標利益**');
ok(Math.abs(lab.profit-lab.target)<2,
   '★★推奨売値で出る利益は目標利益とほぼ同じ（＝目標利益の売値）');
ok(lab.floor<lab.price,'★下限の売値は推奨売値より低い');
ok(/目標利益/.test(lab.t),'★★画面に「目標利益」と出す');
ok(!/下限利益 '+'/.test(lab.t)||/下げられる下限/.test(lab.t),
   '★★下限は「下げられる下限」として別に出す');
ok(!/（最低 \$/.test(lab.t),'★★目標利益を「下限利益」と誤って書かない');

console.log('\n=== ② 相場なしの説明 ===');
let nm=await p.evaluate(()=>{
  mwRows=[{ jan:'4580416924740', sha:'MC02', idx:0, kishu:'figure',
    name:'相場なし', cond:'新品', wholesale:16082, stock:4, ship_days:4,
    note:'', mkt_n:0, mkt_err:'', mkt_at:'2026-10-26T01:00:00Z', pics_ok:0 }];
  mwMkt={seen:1,hit:0,none:1,left:0}; mwListRender();
  return $('csvMwList').textContent; });
ok(/② 相場なし（eBayに出品なし） 1件/.test(nm),'★相場なしに入る');
ok(/目標利益がちょうど出る売値/.test(nm),
   '★★相場なしは「目標利益がちょうど出る売値」で出すと書く');
ok(/自動値下げで下げます/.test(nm),
   '★★売れなければ自動値下げで下げると書く');
ok(/下限利益/.test(nm),'★下限がどこかも書く');

/* ---- 実物の stocks_3.csv があれば、それでも確かめる ----
   仕入値が入った取引先のデータなので、リポジトリには置かない。
   手元で確かめるときは置き場所を渡す：
     PJ_MW_CSV=/path/stocks_3.csv sh tests/run.sh mwread */
const fs=require('fs');
const REAL=process.env.PJ_MW_CSV||'';
if(REAL&&fs.existsSync(REAL)){
  console.log('\n=== 実物の stocks_3.csv で確かめる ===');
  const buf=fs.readFileSync(REAL);
  const text=new TextDecoder('shift_jis').decode(buf);
  console.log('   '+REAL+'　'+Math.round(buf.length/1024)+'KB');
  await setup();
  let rd=await p.evaluate((t)=>{
    const r=mwParse(t);
    return { n:r.rows.length, ng:r.ng, few:r.few, many:r.many,
      lines:r.lines, data:r.data, cols:r.cols, dup:r.dup,
      empty:r.empty, unread:r.unread };
  },text);
  console.log('   '+JSON.stringify(rd));
  ok(rd.lines===12210,'★★実物も 12,210行すべて読む');
  ok(rd.cols===11,'★実物の列は11');
  ok(rd.many===1&&rd.few===0,'★★実物で列が合わない行は1行（3805行目）');
  ok(rd.ng===147,'★★実物の13桁でないJANは147行');
  ok(rd.n===12062,'★★★実物で送る行は 12,062 行');
  /* 実物での備考の該当件数も控える（⚙設定の言葉の一覧で変わる）。 */
  let hit=await p.evaluate((t)=>{
    const r=mwParse(t);
    let n=0; const per={};
    r.rows.forEach(function(x){
      const h=mwNoteHit(x);
      if(h.length){ n++; h.forEach(function(w){ per[w]=(per[w]||0)+1; }); }
    });
    return { n:n, per:per };
  },text);
  console.log('   備考に注意する言葉: '+hit.n+'行　'+JSON.stringify(hit.per));
  ok(hit.n>0,'★★実物でも備考の注意する言葉が当たる');
}else{
  console.log('\n   （実物の stocks_3.csv は未指定。PJ_MW_CSV で渡せます）');
}

await T.done();
})();
