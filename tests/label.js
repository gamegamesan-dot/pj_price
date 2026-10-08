/* 出品CSVタブ：アップロード結果の照合（6.22 の再発防止）
   -C（カートリッジのみ）の行の ItemID が記録されなかった不具合。
   原因は E-/M- の接頭辞の食い違いだったので、ASIN＋区分で照合する。 */
const { harness } = require('./lib');
const T = harness('出品CSVタブ：結果ファイルの照合（-C / M-）');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.click('#tabD');

console.log('=== CustomLabel の読み方（csvLabelKey）===');
const keys=await p.evaluate(()=>{
  const o={};
  ['E-B0DHVQGLVT','E-B0DHVQGLVT-U','E-B0DHVQGLVT-C','M-B0DHVQGLVT',
   'M-B0DHVQGLVT-U','M-B0DHVQGLVT-C','e-b0dhvqglvt-c','game-20260101-UG-xxx','']
    .forEach(x=>o[x||'(空)']=csvLabelKey(x));
  return o;
});
Object.keys(keys).forEach(k=>console.log('   '+k+' → '+JSON.stringify(keys[k])));
ok(keys['E-B0DHVQGLVT'].kind==='new','接尾辞なしは新品');
ok(keys['E-B0DHVQGLVT-U'].kind==='used','-U は箱付き中古');
ok(keys['E-B0DHVQGLVT-C'].kind==='cart','★-C はカートリッジのみ');
ok(keys['M-B0DHVQGLVT-C'].kind==='cart'&&keys['M-B0DHVQGLVT-C'].asin==='B0DHVQGLVT',
   '★M- でも同じ区分として読む（接頭辞は照合に使わない）');
ok(keys['e-b0dhvqglvt-c'].asin==='B0DHVQGLVT','小文字でも読む');
ok(keys['game-20260101-UG-xxx']===null&&keys['(空)']===null,
   'せどりすとSKU・空は読めない（null）');

console.log('=== 下ごしらえ（カートリッジのみ・箱付き中古・無在庫）===');
await p.evaluate(()=>{
  const row=(id,asin,extra)=>Object.assign({id:id,src:'sedori',
    sku:'game-20260101-UG-'+asin+'-1200',asin:asin,jan:'49'+id,titleJa:'商品'+id,
    titleEn:'Used Nintendo Switch Item '+id+' Japan Import',cat:'139973',condId:5000,
    condSrc:'良い',cost:1200,qty:1,weight:150,pics:[{url:'u'}],descHtml:'<p>d</p>',
    specs:{origin:'Japan',platform:'Nintendo Switch',gameName:'Item '+id},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',cartOnly:false,dropship:false,
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false},extra||{});
  csvList=[
    row('c1','B0DHVQGLVT',{cartOnly:true,condId:6000}),            // E-…-C
    row('c2','B0DX747PD2',{cartOnly:true,condId:6000,dropship:true}),// M-…-C
    row('u1','B07571RH4P'),                                        // E-…-U（箱付き中古）
    row('n1','B09TPBVJ5F',{condId:1000})                           // E-…（新品）
  ];
  csvLog=[]; csvPick={}; csvSaveList(); csvSaveLog(); csvRender();
});
const labels=await p.evaluate(()=>csvList.map(r=>r.id+'='+csvCustomLabel(r)
  +'('+csvKindOf(r)+')'));
console.log('   '+JSON.stringify(labels));
ok(labels.join().indexOf('c1=E-B0DHVQGLVT-C')>=0,'★カートリッジのみは E-<ASIN>-C');
ok(labels.join().indexOf('c2=M-B0DX747PD2-C')>=0,'★無在庫のカートリッジのみは M-<ASIN>-C');

console.log('\n=== 結果ファイルを取り込む ===');
const res=await p.evaluate(()=>{
  /* 実際に出た結果ファイルと同じ形。
     行2・行3 は -C の行で、v114 までは「一致する行がありません」になっていた。 */
  const txt=['Info,Version=1.0.0',
    'Line Number,Action,Status,Item ID,Custom Label,Error and Warning Message',
    '2,Add,Success,960022636874,E-B0DHVQGLVT-C,',
    '3,Add,Warning,168766782856,M-B0DX747PD2-C,Item specifics were added',
    '4,Add,Success,110000000001,E-B07571RH4P-U,',
    '5,Add,Success,110000000002,E-B09TPBVJ5F,'].join('\r\n');
  const r=csvResImport(txt);
  csvRender();
  return { r:r, ids:csvList.map(x=>x.id+':'+(x.itemId||'なし')) };
});
console.log('   '+JSON.stringify(res.r));
console.log('   '+JSON.stringify(res.ids));
ok(res.r.ok===4&&res.r.miss===0,'★4件すべて照合できる（照合できなかった行は0）');
ok(res.r.warnN===1,'警告の1件も成功として数える');
ok(res.ids.join().indexOf('c1:960022636874')>=0,'★E-…-C の行に ItemID が入る');
ok(res.ids.join().indexOf('c2:168766782856')>=0,'★M-…-C の行にも入る');
ok(res.ids.join().indexOf('u1:110000000001')>=0&&res.ids.join().indexOf('n1:110000000002')>=0,
   '箱付き中古・新品もこれまでどおり入る');

console.log('\n=== 接頭辞が食い違っていても結び付ける ===');
const pre=await p.evaluate(()=>{
  csvList.forEach(r=>{ r.itemId=''; });
  /* 復活で M- → E- に変えて出した出品、無在庫の印を切り替えたあとの出品。
     結果ファイルの接頭辞と行の接頭辞が食い違う。 */
  const txt=['Line Number,Action,Status,Item ID,Custom Label',
    '2,Add,Success,900000000001,M-B0DHVQGLVT-C',      // 行は E-…-C
    '3,Add,Success,900000000002,E-B0DX747PD2-C',      // 行は M-…-C
    '4,Add,Success,900000000003,M-B07571RH4P-U'].join('\r\n');
  const r=csvResImport(txt);
  return { r:r, ids:csvList.map(x=>x.id+':'+(x.itemId||'なし')) };
});
console.log('   '+JSON.stringify(pre.r)+' '+JSON.stringify(pre.ids));
ok(pre.r.miss===0&&pre.ids.join().indexOf('c1:900000000001')>=0,
   '★E-/M- が食い違っても ASIN＋区分で結び付ける');

console.log('\n=== 区分が違う行には入れない ===');
const kind=await p.evaluate(()=>{
  csvList.forEach(r=>{ r.itemId=''; });
  // 同じASINでカートリッジのみの結果だが、リストには箱付き中古の行しかない
  const txt=['Line Number,Action,Status,Item ID,Custom Label',
    '2,Add,Success,900000000009,E-B07571RH4P-C'].join('\r\n');
  const r=csvResImport(txt);
  return { r:r, u1:csvRowById('u1').itemId,
    why:csvLabelWhy('E-B07571RH4P-C'), none:csvLabelWhy('E-B0NOSUCH01-U') };
});
console.log('   '+JSON.stringify(kind));
ok(kind.r.miss===1&&!kind.u1,'★区分が違う行には ItemID を入れない');
ok(/区分が違います/.test(kind.why)&&/カートリッジのみ/.test(kind.why),
   '★理由に「区分が違います」と出す');
ok(/行が出品リストにありません/.test(kind.none),'リストに無いASINはそう出す');

console.log('\n=== 照合できなかった行の ItemID は手で入れられる ===');
const manual=await p.evaluate(()=>{
  csvRender();
  const el=document.querySelector('#csvList input[data-item="u1"]');
  return { exists:!!el, ro:el?(el.readOnly||el.disabled):null };
});
console.log('   '+JSON.stringify(manual));
ok(manual.exists&&manual.ro===false,'★行のItemID欄に手で入れられる（入力できる）');
const typed=await p.evaluate(async()=>{
  const el=document.querySelector('#csvList input[data-item="u1"]');
  el.value='123456789012';
  el.dispatchEvent(new Event('input',{bubbles:true}));
  return csvRowById('u1').itemId;
});
ok(typed==='123456789012','★入れた値が行に残る');

console.log('\n=== 書き出しログにも記録する ===');
const log=await p.evaluate(()=>{
  csvLog=[{at:'2026-10-06T00:00:00Z',name:'ebay_add_261006.csv',sku:'E-B0DHVQGLVT-C',
    title:'商品c1',itemId:''}];
  csvSaveLog();
  const txt=['Line Number,Action,Status,Item ID,Custom Label',
    '2,Add,Success,970000000001,M-B0DHVQGLVT-C'].join('\r\n');
  const r=csvResImport(txt);
  return { logged:r.logged, log:csvLog.map(L=>L.sku+':'+(L.itemId||'なし')) };
});
console.log('   '+JSON.stringify(log));
ok(log.logged===1&&log.log.join().indexOf('970000000001')>=0,
   '★ログも接頭辞の違いを見ずに結び付ける');
await T.done();
})();
