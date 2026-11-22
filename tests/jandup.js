/* 画面：同じ JAN・同じ状態の出品中の行とぶつけない（8.93）

   カジの報告（2026-11-22）MW 無在庫の行が、同じ JAN のせどりの行（ItemID あり＝
   eBay に出品中）とぶつかり、eBay の重複出品で2件失敗した
   （BURAI MSX2・ライザのアトリエ3 DX PS4）。
   eBay の重複の禁止は「同じ状態の同じ商品」が対象なので：
   ① 同じ JAN・同じ区分（新品・中古・カートリッジのみ・本体のみ）で ItemID のある行が
      あれば、MW の行を出品リストに入れない（どの仕入れ元でも）
   ② CSV の書き出しでも、その行は書き出さず、確認の文に「eBay に同じ JAN が出品中」
   ③ 区分が違えば今までどおり入れて、書き出す
   ④ 出品CSV タブに、同じ JAN・同じ区分で ItemID が2つ以上ある行の一覧 */
const { harness }=require('./lib');
const T=harness('画面：同じ JAN・同じ状態の出品中の行（8.93）');
const ok=T.ok;
(async()=>{
const p=await T.open();
let msgs=[];
p.on('dialog',async d=>{ msgs.push(d.message()); await d.dismiss(); });

const J1='4988615012345', J2='4582224491234', J3='4580000000001';
await p.evaluate(()=>{ switchTab('D'); });
const base=(o)=>Object.assign({ src:'sedori', sku:'', jan:'', asin:'B0TEST0001', titleJa:'商品',
  titleEn:'Item', cat:'139973', condId:1000, qty:1, cost:3000, pics:[], itemId:'',
  cartOnly:false, looseOnly:false, dropship:false, specs:{} },o);

console.log('=== 区分と JAN の読み方 ===');
{
  const t=await p.evaluate((a)=>{
    csvList=[
      Object.assign({},a.b,{ id:'s1', jan:a.J1, condId:1000, itemId:'111111111111', titleJa:'BURAI MSX2（せどり・新品）' }),
      Object.assign({},a.b,{ id:'s2', jan:a.J2, condId:3000, itemId:'222222222222', titleJa:'ライザのアトリエ3（せどり・中古）' }),
      Object.assign({},a.b,{ id:'s3', jan:a.J3, condId:1000, itemId:'', titleJa:'まだ出していない' })];
    return {
      k:[csvKindOf({ condId:1000 }),csvKindOf({ condId:3000 }),csvKindOf({ cartOnly:true }),csvKindOf({ looseOnly:true })],
      key:[csvJanKey({ jan:' 4988-6150-12345 ' }),csvJanKey({ jan:'123' }),csvJanKey({})],
      a:(csvJanLive({ jan:a.J1 },'new')||{}).itemId||'',
      b:(csvJanLive({ jan:a.J2 },'new')||{}).itemId||'',
      c:(csvJanLive({ jan:a.J2 },'used')||{}).itemId||'',
      d:(csvJanLive({ jan:a.J3 },'new')||{}).itemId||'',
      self:(csvJanLive(csvList[0])||{}).itemId||'' };
  },{ b:base({}), J1, J2, J3 });
  console.log('   '+JSON.stringify(t));
  ok(t.k.join()==='new,used,cart,loose','★区分は新品・中古・カートリッジのみ・本体のみ');
  ok(t.key[0]==='4988615012345'&&t.key[1]===''&&t.key[2]==='','★JAN は数字だけで比べる（短すぎるものは見ない）');
  ok(t.a==='111111111111','★★★同じ JAN・同じ区分（新品）で ItemID のある行を見つける');
  ok(t.b==='','★★★同じ JAN でも区分が違えば（中古の出品・新品の候補）見つけない');
  ok(t.c==='222222222222','★★同じ区分（中古）なら見つける');
  ok(t.d==='','★★ItemID の無い行（まだ出していない）は見つけない');
  ok(t.self==='','★自分の行は数えない');
}

console.log('\n=== ① 写真が付いた出品候補を出品リストに入れる ===');
{
  const t=await p.evaluate((a)=>{
    /* この節だけで完結させる（前の節の出品リストに頼らない）。 */
    csvList=[
      Object.assign({},a.b,{ id:'s1', jan:a.J1, condId:1000, itemId:'111111111111', titleJa:'BURAI MSX2（せどり・新品）' }),
      Object.assign({},a.b,{ id:'s2', jan:a.J2, condId:3000, itemId:'222222222222', titleJa:'ライザのアトリエ3（せどり・中古）' }),
      Object.assign({},a.b,{ id:'s3', jan:a.J3, condId:1000, itemId:'', titleJa:'まだ出していない' })];
    /* 写真・相場・ポリシーの条件は通る形にして、JAN の決まりだけを見る。 */
    window.mwRec=function(){ return { price:50, total:50 }; };
    window.mwMktJudge=function(){ return { k:'ok', pct:90 }; };
    window.csvShipMwPick=function(){ return { name:'MW', why:'' }; };
    const r=(jan)=>({ jan:jan, pics_ok:2, ship_days:0 });
    return { a:mwPushWhy(r(a.J1)), b:mwPushWhy(r(a.J2)), c:mwPushWhy(r(a.J3)),
             btn:mwPushBtn(r(a.J1)).replace(/<[^>]+>/g,''),
             btn2:/data-mwpush/.test(mwPushBtn(r(a.J2))),
             skip:mwPushSkipHtml([{ r:r(a.J1), why:mwPushWhy(r(a.J1)) },
                                  { r:{ jan:'4900000000002' }, why:'eBay に同じ JAN が出品中（新品・ItemID 333333333333）' }])
               .replace(/<[^>]+>/g,'') };
  },{ b:base({}), J1, J2, J3 });
  console.log('   '+JSON.stringify(t));
  ok(/eBay に同じ JAN が出品中（新品・ItemID 111111111111）/.test(t.a),
     '★★★同じ JAN の新品が eBay に出品中（せどりの行）→ MW の行は入れない・理由を出す');
  ok(t.b==='','★★★同じ JAN でも出品中なのが中古なら、MW（新品）の行は今までどおり入れる');
  ok(t.c==='','★★まだ出していない同じ JAN の行は止めない（今までどおり）');
  ok(/入れられません：eBay に同じ JAN が出品中/.test(t.btn)&&t.btn2,
     '★★行のボタンも同じ決まり（押せない形にして理由を出す）');
  ok(/eBay に同じ JAN が出品中（新品） 2件/.test(t.skip)&&/4988615012345→111111111111/.test(t.skip),
     '★★まとめて入れたときの「入れなかった行」に、JAN と出品中の ItemID を出す');
}

console.log('\n=== ② ③ CSV の書き出し ===');
{
  const t=await p.evaluate((a)=>{
    window.csvIssues=function(){ return []; };
    window.csvNotes=function(){ return []; };
    csvList=[
      Object.assign({},a.b,{ id:'s1', jan:a.J1, condId:1000, itemId:'111111111111', titleJa:'BURAI MSX2（せどり）' }),
      Object.assign({},a.b,{ id:'m1', src:'mw', buySource:'mw', dropship:true, jan:a.J1, condId:1000,
                             titleJa:'BURAI MSX2（MW 無在庫）', asin:'B0MW000001' }),
      Object.assign({},a.b,{ id:'s2', jan:a.J2, condId:3000, itemId:'222222222222', titleJa:'ライザ（中古）' }),
      Object.assign({},a.b,{ id:'m2', src:'mw', buySource:'mw', dropship:true, jan:a.J2, condId:1000,
                             titleJa:'ライザ（MW 新品）', asin:'B0MW000002' })];
    const sp=csvExportSplit();
    return { rows:sp.rows.map((r)=>r.id), live:sp.live.map((x)=>x.r.id+':'+x.why),
             skip:sp.skip, done:sp.done.map((x)=>x.r.id) };
  },{ b:base({}), J1, J2 });
  console.log('   '+JSON.stringify(t));
  ok(t.live.length===1&&/^m1:eBay に同じ JAN が出品中（新品・ItemID 111111111111）$/.test(t.live[0]),
     '★★★同じ JAN・同じ区分で ItemID のある行が別にあれば、その行は書き出さない（理由つき）');
  ok(t.rows.indexOf('m2')>=0,'★★★同じ JAN でも区分が違う（中古の出品・新品の MW）なら今までどおり書き出す');
  ok(t.done.join()==='s1,s2'&&t.skip===3,'★出品済みの行は今までどおり「出品済み」・除外の合計に入る');
  /* 確認の文 */
  msgs=[];
  await p.evaluate(()=>{ try{ csvExportRun(null); }catch(e){} });
  await p.waitForTimeout(200);
  const m=msgs.join('\n');
  console.log('   '+m.split('\n').filter((x)=>/出品中|BURAI/.test(x)).join(' / '));
  ok(/eBay に同じ JAN が出品中 1件/.test(m)&&/BURAI MSX2（MW 無在庫）：eBay に同じ JAN が出品中（新品・ItemID 111111111111）/.test(m),
     '★★★確認の文に「eBay に同じ JAN が出品中」と、その行・ItemID を出す');
  ok(/重複出品で失敗します/.test(m),'★★なぜ外すかを書く');
  await p.evaluate(()=>csvRender());
  const note=await p.evaluate(()=>($('csvExportNote').textContent||''));
  ok(/eBay に同じ JAN が出品中 1件/.test(note),'★★書き出しの見通しにも件数を出す（押すとその行へ）');
  const sum=await p.evaluate(()=>csvExpSumHtml(csvExportSplit(),{ go:[], no:[] },[]).replace(/<[^>]+>/g,''));
  ok(/eBay に同じ JAN が出品中 1件/.test(sum),'★書き出しのまとめにも出す');
}

console.log('\n=== ④ 同じ JAN・同じ区分で ItemID が2つ以上ある行の一覧 ===');
{
  const t=await p.evaluate((a)=>{
    csvList=[
      Object.assign({},a.b,{ id:'d1', jan:'4570101051127', condId:1000, itemId:'300000000001', titleJa:'重複の新品（せどり）' }),
      Object.assign({},a.b,{ id:'d2', src:'mw', buySource:'mw', dropship:true, jan:'4570101051127', condId:1000,
                             itemId:'300000000002', titleJa:'重複の新品（MW）' }),
      Object.assign({},a.b,{ id:'d3', jan:a.J2, condId:1000, itemId:'300000000003', titleJa:'新品' }),
      Object.assign({},a.b,{ id:'d4', jan:a.J2, condId:3000, itemId:'300000000004', titleJa:'中古' }),
      Object.assign({},a.b,{ id:'d5', jan:a.J3, condId:1000, itemId:'300000000005', titleJa:'1つだけ' }),
      Object.assign({},a.b,{ id:'d6', jan:a.J3, condId:1000, itemId:'', titleJa:'まだ出していない' })];
    csvRender();
    return { n:csvJanDups().length, jans:csvJanDups().map((x)=>x.jan+':'+x.kind+':'+x.rows.length),
             html:($('csvJanDup').textContent||'').replace(/\s+/g,' ') };
  },{ b:base({}), J2, J3 });
  console.log('   '+t.html.slice(0,300));
  ok(t.n===1&&t.jans[0]==='4570101051127:new:2','★★★同じ JAN・同じ区分で ItemID が2つ以上（4570101051127）だけを出す');
  ok(/同じ JAN・同じ区分で eBay に2つ以上出ている行 1件/.test(t.html)
     &&/4570101051127（新品）/.test(t.html)&&/300000000001/.test(t.html)&&/300000000002/.test(t.html),
     '★★★一覧に JAN・区分・それぞれの ItemID を出す');
  ok(/MW 無在庫/.test(t.html)&&/せどり/.test(t.html),'★★どの仕入れ元の行かを出す');
  ok(!/300000000003|300000000004/.test(t.html),'★★★区分が違う（新品と中古）なら重複に数えない');
  ok(!/300000000005/.test(t.html),'★ItemID が1つだけなら出さない');
  await p.evaluate(()=>{ csvList=[]; csvRender(); });
  ok(await p.evaluate(()=>$('csvJanDup').innerHTML==='' ),'★無ければ何も出さない');
}

await T.done();
})();
