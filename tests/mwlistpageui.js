/* 画面：MW の候補一覧を 500件より先まで読む（8.84・カジの依頼）
   ・「候補一覧を取り込む」は 500件ずつ、続きを offset で順に読んでつなぐ
   ・つないだ行が区分（①出品候補〜④未調査）に入る＝500件より先の出品候補も出る
   ・古い pj-sync（offset を知らない版）のときは今までと同じ 500件で止まる
   ・続きが読めなかったときは、読めたところまでを出す
   ・画面に持つのは 3,000件まで（超えたぶんは「うち◯件を表示」）
   ・相場を調べるボタンは今までどおり 120件 */
const { harness, openCsvBoxes }=require('./lib');
const T=harness('画面：MW の候補一覧のページ読み（8.84）');
const ok=T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

/* total 件の候補を返す pj-sync をまねる。mode で古い版・途中の失敗も作る。 */
const setup=async(o)=>await p.evaluate((o)=>{
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('autoAdRate').value='6';
  $('fee').value='13.6'; $('intlFee').value='1.35'; $('feeTax').value='10';
  $('fixed').value='0.40'; $('pack').value='150'; $('shipCharge').value='15';
  $('targetMode').value='auto';
  $('syncWeightGame').value='150'; $('syncWeight').value='400';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='2';
  $('mwKishu').value='NS'; $('mwNewOnly').checked=true;
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  var row=function(i){
    /* 400件目から先に「出品候補（相場の115%以内）」を置く
       ＝今までの 500件では一部しか見えなかった行。 */
    var okRow=(i>=400&&i%4===0);
    return { jan:'49'+String(10000000000+i), sha:'MC02', idx:0, kishu:'NS',
      name:'商品'+i, cond:'新品', wholesale:1000+i, stock:9, ship_days:0,
      ship_text:'即日出荷',
      mkt_n:okRow?5:null, mkt_n_new:okRow?3:null, mkt_low:okRow?400:null,
      mkt_low_any:okRow?400:null, mkt_ship:0, mkt_cur:'USD', mkt_no_ship:0,
      mkt_err:'', mkt_at:okRow?'2026-11-20T01:00:00Z':null, pics_ok:0 };
  };
  if(!window.__real)window.__real=window.fetch;
  window.__calls=[];
  window.fetch=async(u,i)=>{
    var url=String(u);
    if(/\/mw\/list/.test(url)){
      var sp=new URL(url).searchParams;
      var lim=Math.min(500,+sp.get('limit')||200);
      var off=(o.mode==='old')?0:(+sp.get('offset')||0);
      window.__calls.push({ offset:sp.get('offset'), lite:sp.get('lite'),
                            limit:sp.get('limit') });
      if(o.mode==='fail'&&off>=1000)
        return new Response(JSON.stringify({ ok:false, error:'server_error',
          detail:'D1 が混んでいます' }),{status:500});
      var rows=[];
      for(var k=off;k<Math.min(o.total,off+lim);k++)rows.push(row(k));
      var body={ ok:true, n:o.total, rows:rows, limit:lim, offset:off };
      if(sp.get('lite')!=='1'||o.mode==='old')Object.assign(body,{
        alive:12000, picked:9000,
        mkt:{ seen:10, hit:5, none:5, left:o.total-10, over:1.15, ttl_days:7,
              per_run:120 },
        last:{ at:'2026-11-20T00:00:00Z', at_jst:'2026-11-20 09:00', added:1,
               changed:0, gone:0 } });
      return new Response(JSON.stringify(body),{status:200});
    }
    if(/\/mw\/market/.test(url)){
      window.__mkt=JSON.parse(i.body);
      return new Response(JSON.stringify({ ok:true, asked:10, done:3, hit:2,
        none:1, failed:0, left:7, calls:3, limit:3, stopped:'limit' }),{status:200});
    }
    if(/sync\.example/.test(url))
      return new Response(JSON.stringify({ ok:true, rows:[] }),{status:200});
    return window.__real(u,i);
  };
  switchTab('D'); roleCheck(); csvRender();
},o);
const load=async()=>{
  await p.evaluate(()=>{ $('csvMwLoad').click(); });
  await p.waitForFunction(()=>!/取り込んでいます/.test($('csvMwListNote').textContent),
                          null,{timeout:20000});
  return await p.evaluate(()=>{
    var g={ ok:0, none:0 };
    mwRows.forEach(function(r){
      var k=mwMktJudge(r,mwRec(r)).k;
      if(k==='ok')g.ok++; else if(k==='none')g.none++;
    });
    return { rows:mwRows.length, uniq:Object.keys(mwRows.reduce(function(a,r){
               a[r.jan]=1; return a; },{})).length,
             note:$('csvMwListNote').textContent, calls:window.__calls,
             ok:g.ok, none:g.none, html:$('csvMwList').textContent.slice(0,200),
             mkt:mwMkt, last:!!mwLast };
  });
};

console.log('=== ① 1,230件の候補を、500件ずつつないで読む ===');
await setup({ total:1230 });
await openCsvBoxes(p);
let a=await load();
console.log('   行 '+a.rows+'／呼び出し '+JSON.stringify(a.calls));
console.log('   '+a.note.slice(0,120));
ok(a.rows===1230&&a.uniq===1230,'★★★500件より先も読める（1,230件・重なりなし）');
ok(a.calls.length===3,'★★★呼び出しは3回（500＋500＋230）');
ok(a.calls[0].offset===null&&a.calls[0].limit==='500',
   '★★1ページ目は今までどおりの呼び方（offset なし・limit 500）');
ok(a.calls[1].offset==='500'&&a.calls[1].lite==='1'
   &&a.calls[2].offset==='1000'&&a.calls[2].lite==='1',
   '★★続きは offset と lite=1 を付けて読む');
ok(/候補 1230件/.test(a.note)&&!/うち/.test(a.note),
   '★★★全部読めたときは「うち◯件を表示」と出さない');
ok(/前回の取り込み/.test(a.note)&&a.last===true&&a.mkt&&a.mkt.per_run===120,
   '★★前回の取り込み・相場の進み具合は1ページ目のものを使う');
/* 400件目から先の4件に1件が出品候補。500件までだと 25件、全部で 208件。 */
ok(a.ok===208,'★★★500件より先の出品候補も区分に入る（25件 → '+a.ok+'件）');
ok(a.none===1230-208,'★★新しく読めた行は「未調査」に入る');
ok(/候補 1230件/.test(a.html),'★一覧の見出しも 1,230件');

console.log('\n=== ② ちょうど 500件・それ以下のときは1回で終わる ===');
await setup({ total:500 });
a=await load();
ok(a.rows===500&&a.calls.length===1,'★★★500件ちょうどなら1回（余計に読まない）');
await setup({ total:37 });
a=await load();
ok(a.rows===37&&a.calls.length===1,'★★少ないときも1回');
await setup({ total:0 });
a=await load();
ok(a.rows===0&&a.calls.length===1&&/候補はありません/.test(a.html),
   '★★0件のときは今までどおりの案内');

console.log('\n=== ③ 古い pj-sync（offset を知らない）では 500件で止まる ===');
await setup({ total:1230, mode:'old' });
a=await load();
console.log('   行 '+a.rows+'／呼び出し '+a.calls.length+'回　'+a.note.slice(0,40));
ok(a.rows===500&&a.uniq===500,'★★★同じ 500件が返ってきても重ねない');
ok(a.calls.length===2,'★★★増えなかったらそこでやめる（回り続けない）');
ok(/候補 1230件（うち 500件を表示）/.test(a.note),
   '★★★今までと同じ「うち 500件を表示」と出る');

console.log('\n=== ④ 続きが読めなかったときは、読めたところまでを出す ===');
await setup({ total:1230, mode:'fail' });
a=await load();
console.log('   '+a.note.slice(0,200));
ok(a.rows===1000,'★★★読めた 1,000件は捨てない');
ok(/うち 1000件を表示/.test(a.note)&&/続きを読めませんでした/.test(a.note),
   '★★★読めなかったことと、もう一度押すことを伝える');

console.log('\n=== ⑤ 画面に持つのは 3,000件まで ===');
await setup({ total:4200 });
const t0=Date.now();
a=await load();
const ms=Date.now()-t0;
console.log('   行 '+a.rows+'／呼び出し '+a.calls.length+'回／'+ms+'ms');
ok(a.rows===3000&&a.calls.length===6,'★★★3,000件（6回）で止まる');
ok(/候補 4200件（うち 3000件を表示）/.test(a.note),
   '★★★超えたぶんは「うち 3000件を表示」と出る');
const rt=await p.evaluate(()=>{
  var t=performance.now(); mwListRender(); return Math.round(performance.now()-t); });
console.log('   3,000件の一覧を作り直す時間 '+rt+'ms');
ok(rt<3000,'★★3,000件でも一覧の作り直しは3秒かからない（'+rt+'ms）');

console.log('\n=== ⑥ 相場を調べるボタンは今までどおり 120件 ===');
await p.evaluate(()=>{ $('csvMwMkt').click(); });
await p.waitForTimeout(400);
const mk=await p.evaluate(()=>window.__mkt);
console.log('   '+JSON.stringify(mk));
ok(mk&&mk.limit===120,'★★★1回に調べるのは 120件（変えていない）');
await T.done();
})();
