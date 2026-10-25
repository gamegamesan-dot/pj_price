/* 出品CSVタブ：原産国が既定値のままの行を要確認にしない（6.84）
   ・③「写真・原産国・カテゴリ」の件数・赤枠から外す（写真とカテゴリは今のまま）
   ・行のバッジ「原産国：既定値」を出さない
   ・上のまとめの「原産国が既定値 n件」を出さない
   ・原産国が**空欄**の行は今までどおり要確認（③にも数える・書き出しも止める）
   ・既定値というだけで書き出せない行を作らない
   ・絞り込み「原産国：既定値の行だけ」は残す（探したいときに使う） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('出品CSV：原産国の既定値');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

/* カジの手元と同じ形：10件すべて 写真あり・カテゴリあり・原産国は既定値のまま。
   最後の2件だけ、空欄とカテゴリなしを混ぜて区別を確かめる。 */
const setup=async(o)=>await p.evaluate((o)=>{
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('autoAdRate').value='6';
  $('csvShipProfile').value='W1000'; $('csvRetProfile').value='R';
  $('csvPayProfile').value='P'; $('csvLocation').value='Tokyo';
  $('csvOriginDefault').value='China';
  $('syncApi').value=''; $('syncKey').value='';
  const row=(n,x)=>Object.assign({
    id:'o'+n,src:'sedori',sku:'toy-20261025-UG-B0ORG0000'+n+'-7980',
    asin:'B0ORG0000'+n,jan:'490000'+n,titleJa:'テスト商品'+n,
    titleEn:'Used Bandai Test Figure '+n,
    cat:'261068',catFixed:true,condId:3000,condSrc:'良い',cost:7980,qty:1,weight:700,
    pics:[{url:'u'+n,key:'k'+n},{url:'v'+n,key:'l'+n}],descHtml:'<p>d</p>',
    /* 取り込みのときに ⚙設定の既定値で埋められた状態（originDefault=true）。 */
    specs:{origin:'China',originDefault:true,material:'Plastic'},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',sold:'160',amzLow:'',
    dropship:false,titleStatus:'',titleCands:[],titleNote:'',titleManual:false},x||{});
  const list=[];
  for(let i=1;i<=10;i++)list.push(row(i));
  if(o.empty)     list[8].specs={origin:'',originDefault:false};   // 原産国が空欄
  /* カテゴリなし。書き出しを止めるのは「カテゴリ未振分」（catFixed/catDone）
     なので、取り込み直後と同じ形にする。 */
  if(o.nocat){ list[9].cat=''; list[9].catFixed=false; list[9].catDone=false; }
  if(o.nopic)     list[7].pics=[];                                 // 写真なし
  csvList=list; csvSaveList(); csvPick={};
  switchTab('D'); csvRender();
},o||{});
const step3=async()=>await p.evaluate(()=>{
  const b=Array.prototype.slice.call(
    document.querySelectorAll('#csvSteps [data-step]'))
    .filter(function(x){ return /③/.test(x.textContent); })[0];
  return { text:b?b.textContent.replace(/\s+/g,' '):'',
           cls:b?b.className:'', n:CSV_STEPS[2].n() };
});

console.log('=== 10件すべて原産国が既定値（写真・カテゴリはそろっている）===');
await setup({});
let s3=await step3();
console.log('   ③: '+s3.text+'（class='+s3.cls+'・n='+s3.n+'）');
ok(s3.n===0,'★★③の件数が 0件になる（既定値は数えない）');
ok(/そろいました/.test(s3.text),'★★「確認 n件」ではなく「そろいました」');
ok(s3.cls==='done'&&s3.cls!=='todo','★★赤枠（todo）にならない');

console.log('\n=== 行のバッジとまとめ ===');
let v=await p.evaluate(()=>{
  const d=document.querySelector('#csvList [data-row="o1"]');
  return { badge:d.querySelector('[data-badge]').innerText,
           card:d.innerText.replace(/\n/g,' | '),
           sum:$('csvSummary').textContent,
           iss:csvIssues(csvRowById('o1')),
           notes:csvNotes(csvRowById('o1')) };
});
console.log('   バッジ: '+JSON.stringify(v.badge));
console.log('   まとめ: '+v.sum.slice(0,120));
ok(!/原産国/.test(v.badge),'★★行のバッジに「原産国：既定値」を出さない');
ok(!/原産国が既定値/.test(v.sum),'★★上のまとめの「原産国が既定値 n件」を消す');
ok(v.iss.length===0,'★★不備にしない（書き出しを止めない）');
ok(!v.notes.some(function(t){ return /原産国/.test(t); }),'★注意にも出さない');

console.log('\n=== 書き出し（④）の可否 ===');
let ex=await p.evaluate(()=>{
  const d=csvExportSplit();
  return { rows:d.rows.length, bad:d.bad.map(function(x){ return x.why; }) };
});
console.log('   '+JSON.stringify(ex));
ok(ex.rows===10,'★★10件すべて書き出せる（既定値で止まらない）');
ok(ex.bad.length===0,'★不備で外れる行は無い');

console.log('\n=== 原産国が空欄の行は今までどおり要確認 ===');
await setup({empty:true});
s3=await step3();
let em=await p.evaluate(()=>{
  const r=csvRowById('o9');
  const d=csvExportSplit();
  return { need:csvOriginNeed(r), iss:csvIssues(r),
           rows:d.rows.length,
           bad:d.bad.filter(function(x){ return x.r.id==='o9'; })
                 .map(function(x){ return x.why; }) };
});
console.log('   ③: '+s3.text+'（n='+s3.n+'）／'+JSON.stringify(em));
ok(s3.n===1&&s3.cls==='todo','★★空欄の行は③に数えて赤枠にする');
ok(em.need===true&&em.iss.indexOf('原産国なし')>=0,'★★不備「原産国なし」は残す');
ok(em.rows===9&&/原産国なし/.test((em.bad[0]||'')),
   '★★空欄の行は今までどおり書き出さない');

console.log('\n=== 写真なし・カテゴリなしは今までどおり ===');
await setup({nopic:true,nocat:true});
s3=await step3();
let other=await p.evaluate(()=>({
  pic:csvIssues(csvRowById('o8')).indexOf('写真なし')>=0,
  cat:csvIssues(csvRowById('o10')).length>0,
  rows:csvExportSplit().rows.length }));
console.log('   ③: '+s3.text+'（n='+s3.n+'）／'+JSON.stringify(other));
ok(s3.n===2&&s3.cls==='todo','★★写真なし1件＋カテゴリなし1件＝2件');
ok(other.pic===true,'★写真なしは今までどおり不備');
ok(other.cat===true,'★カテゴリ未振分は今までどおり不備');
ok(other.rows===8,'★その2件は書き出さない');

console.log('\n=== ゲームの行（Japan 固定）は対象外 ===');
await p.evaluate(()=>{
  csvList[0].cat='139973'; csvList[0].specs={origin:'',originDefault:true};
  csvSaveList(); csvRender();
});
let game=await p.evaluate(()=>({ need:csvOriginNeed(csvRowById('o1')),
  iss:csvIssues(csvRowById('o1')) }));
console.log('   '+JSON.stringify(game));
ok(game.need===false,'★★ゲーム（139973）は原産国を見ない（Japan 固定）');
ok(game.iss.indexOf('原産国なし')<0,'★不備にもしない');

console.log('\n=== 絞り込み「原産国：既定値の行だけ」は残す ===');
await setup({});
await openCsvBoxes(p);
let f=await p.evaluate(()=>{
  const sel=$('csvFilter');
  const has=Array.prototype.some.call(sel.options,
    function(o){ return o.value==='origin'; });
  sel.value='origin'; csvRender();
  return { has:has,
    n:document.querySelectorAll('#csvList [data-row]').length };
});
console.log('   '+JSON.stringify(f));
ok(f.has===true,'★★既定値のままの行を探す絞り込みは残す');
ok(f.n===10,'★10件が出る');

await T.done();
})();
