/* 画面：MW 無在庫（W-<JAN>）の出品を販売連携で扱う（6.153）
   【至急】2026-11-08：W-4562475323733（カラ松・ItemID 960161917613）
   ・販売連携の行に「仕入れ基準：MW ¥○○／Amazon ¥○○」と
     「重量 ○○g（出どころ）」を出す
   ・「解析不可の出品」の内訳（形ごとの件数と例）を出す
   ・ItemID を1件だけ手で結び付ける（/ebay/link）
   ・出品リストのカードは、ItemID と結び付くまで消さない
   ・アップロード結果の取り込みで、消えている行はゴミ箱から戻して結び付ける */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：MW 無在庫（W-<JAN>）の出品（6.153）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], answer=true;
p.on('dialog',async d=>{ dlg.push(d.message());
  if(answer)await d.accept(); else await d.dismiss(); });

const JAN='4562475323733';
const ITEM='960161917613';
const now=new Date().toISOString();
const old=new Date(Date.now()-30*3600000).toISOString();

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('mwShipFee').value='176'; $('syncWeight').value='400';
  $('syncWeightGame').value='150';
  $('csvPackFig').value='250'; $('csvPackGame').value='60';
  $('mwAmzCost').checked=(o.amzOn!==false);
  window.__posts=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body)?JSON.parse(i.body):null;
    const res=(o2,st)=>new Response(JSON.stringify(o2),{status:st||200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/ebay\/link/.test(url)){ window.__posts.push({link:b});
      return res(o.link||{ok:true,asin:'W'+b.item_id.slice(0,0)+'4562475323733',
        cond:'new',item_id:b.item_id,sku:'W-4562475323733',jan:'4562475323733',
        dropship:1,qty:1,price:37}); }
    if(/\/listings/.test(url)){ window.__posts.push({listings:b.items});
      return res({accepted:(b.items||[]).length,rejected:0}); }
    if(/\/status/.test(url))return res({counts:{},items:[],last_runs:[]});
    return real(u,i);
  };
  syncData=o.data;
  syncPick={}; syncPage=1; syncRole='admin'; roleApply();
  switchTab('E'); syncRender();
},o||{});

const ROW={ asin:'W'+JAN, cond:'new', scope:'ebay',
  title:'おそ松さん カラ松 ぬいぐるみ', ebay_sku:'W-'+JAN, ebay_item_id:ITEM,
  ebay_qty:1, ebay_price:37, dropship:1, restocking:0, amz_drop:0,
  on_hand:0, one_off:0, one_off_known:1, weight_g:0,
  fba_available:null, fba_inbound:0, fba_reserved:0, fba_seen_at:null,
  amazon_lowest:0, amazon_lowest_n:0, amazon_offers:0,
  warnings:[], notes:[], state:'ok' };
const MW={ jan:JAN, cost:2500, cost_src:'amz', cost_mw:3476, cost_amz:2500,
  cost_why:'', cost_text:'仕入れ基準：Amazon ¥2,500（MW ¥3,476／Amazon ¥2,500）',
  amz_g:600, amz_g_src:'pkg', amz_low:2500, amz_at:now, asin:'B00ABCDEFG',
  wholesale:3000, kishu:'b2cchara_figure', sha:'M200', stock:5, gone:0,
  name:'おそ松さん カラ松' };

console.log('=== 行の仕入れ基準と重量（Amazon のほうが安いとき）===');
await setup({ data:{ at:now, counts:{}, items:[ROW], mw:{ [JAN]:MW } } });
let h=await p.evaluate(()=>syncMwDropHtml(syncData.items[0]));
console.log('   '+h.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
ok(/MW 無在庫/.test(h),'★★行が MW 無在庫だと分かる');
ok(/JAN 4562475323733/.test(h),'★JAN を出す');
ok(/仕入れ基準：MW ¥3,476／Amazon ¥2,500/.test(h),
   '★★★「仕入れ基準：MW ¥○○／Amazon ¥○○」を出す');
ok(/→ <b>Amazon ¥2,500<\/b>/.test(h),'★★★どちらを使うかを出す');
ok(/重量 850g（Amazon の梱包重量 600g＋梱包 250g）/.test(h),
   '★★★「重量 ○○g（出どころ）」を出す（600＋フィギュアの梱包250）');
ok(/Amazon 最安値 /.test(h),'★Amazon の値段をいつ取ったかも出す');
/* カードの計算の詳細に入っていること。 */
await openCsvBoxes(p);
let det=await p.evaluate(()=>{
  const el=document.querySelector('[data-srow] [data-det]');
  return el?el.innerHTML:'';
});
ok(/仕入れ基準：MW ¥3,476／Amazon ¥2,500/.test(det),
   '★★★行の「計算の詳細」に出る');

console.log('\n=== MW のほうが安いとき・Amazon の値段が古いとき ===');
await setup({ data:{ at:now, counts:{}, items:[ROW],
  mw:{ [JAN]:Object.assign({},MW,{ cost:1276, cost_src:'mw', cost_mw:1276,
    cost_amz:2500 }) } } });
h=await p.evaluate(()=>syncMwDropHtml(syncData.items[0]));
ok(/→ <b>MW ¥1,276<\/b>/.test(h),'★★MW が安ければ MW と出す');
await setup({ data:{ at:now, counts:{}, items:[ROW],
  mw:{ [JAN]:Object.assign({},MW,{ cost:3476, cost_src:'mw', cost_amz:0,
    cost_why:'Amazon の値段が古い（24時間超）', amz_at:old }) } } });
h=await p.evaluate(()=>syncMwDropHtml(syncData.items[0]));
ok(/Amazon —/.test(h),'★★使えない Amazon の値段は「—」で出す');
ok(/24時間超/.test(h),'★★理由も出す');

console.log('\n=== 重さの出どころ ===');
/* 手で直した重さが行にあれば、それを優先する。 */
await setup({ data:{ at:now, counts:{},
  items:[Object.assign({},ROW,{ weight_g:700 })], mw:{ [JAN]:MW } } });
h=await p.evaluate(()=>syncMwDropHtml(syncData.items[0]));
ok(/重量 700g（手で入れた値）/.test(h),'★★★手で直した重さを優先する');
/* Amazon の重さが無ければ既定値（ジャンル）。 */
await setup({ data:{ at:now, counts:{}, items:[ROW],
  mw:{ [JAN]:Object.assign({},MW,{ amz_g:0, amz_g_src:'' }) } } });
h=await p.evaluate(()=>syncMwDropHtml(syncData.items[0]));
ok(/重量 400g（既定値）/.test(h),'★★重さが無ければ既定値（フィギュア 400g）');
/* 商品の重量（item）のときはそう書く。 */
await setup({ data:{ at:now, counts:{}, items:[ROW],
  mw:{ [JAN]:Object.assign({},MW,{ amz_g_src:'item' }) } } });
h=await p.evaluate(()=>syncMwDropHtml(syncData.items[0]));
ok(/Amazon の商品の重量 600g/.test(h),'★梱包重量が無い行は「商品の重量」と書く');
/* MW の在庫CSVを取り込んでいない（mw が無い）行でも落ちない。 */
await setup({ data:{ at:now, counts:{}, items:[ROW] } });
h=await p.evaluate(()=>syncMwDropHtml(syncData.items[0]));
ok(/まだ分かりません/.test(h),'★★取り込み前は「まだ分かりません」と出す');
/* MW で欠品した行は赤で知らせる。 */
await setup({ data:{ at:now, counts:{}, items:[ROW],
  mw:{ [JAN]:Object.assign({},MW,{ gone:1 }) } } });
h=await p.evaluate(()=>syncMwDropHtml(syncData.items[0]));
ok(/MW で欠品しています/.test(h),'★★欠品を行に出す');
/* W- でない行には出さない。 */
h=await p.evaluate(()=>syncMwDropHtml({ asin:'B00ABCDEFG', ebay_sku:'E-B00ABCDEFG' }));
ok(h==='','★W- でない行には出さない');

console.log('\n=== 解析不可の出品の内訳 ===');
await setup({ data:{ at:now, counts:{ ebay_unparsed:69 }, items:[ROW],
  mw:{ [JAN]:MW },
  ebay_unparsed:{ n:69, at_jst:'2026-11-08 09:00',
    kinds:{ 'CustomLabel が空':40, 'W-（MW 無在庫）だが JAN が13桁でない':12,
            'せどりすとの SKU':10, 'その他':7 },
    samples:[{ sku:'', item_id:'880000000001', title:'ラベルなし' },
             { sku:'W-12345', item_id:'880000000002', title:'桁が足りない' }] } } });
let unp=await p.evaluate(()=>({ sum:$('syncUnpSum').textContent,
  note:$('syncUnpNote').textContent, list:$('syncUnpList').innerHTML }));
console.log('   '+unp.sum+' / '+unp.note);
ok(/69件/.test(unp.sum),'★★見出しに件数を出す');
ok(/読めなかった出品 69件/.test(unp.note),'★件数を出す');
ok(/2026-11-08 09:00/.test(unp.note),'★いつの取り込みかを出す');
ok(/CustomLabel が空.*40件/.test(unp.list),'★★★形ごとの件数を出す');
ok(/W-（MW 無在庫）だが JAN が13桁でない.*12件/.test(unp.list),
   '★★★W- がいくつ含まれるかが分かる');
ok(unp.list.indexOf('CustomLabel が空')<unp.list.indexOf('せどりすとの SKU'),
   '★多い順に並べる');
ok(/880000000001/.test(unp.list)&&/W-12345/.test(unp.list),
   '★★例（CustomLabel・ItemID・題）も出す');
ok(/data-unplink="880000000001"/.test(unp.list),
   '★★例から「手で結び付ける」を押せる');
/* 例のボタンを押すと、ItemID が欄に入る。 */
await p.evaluate(()=>{
  document.querySelector('[data-unplink="880000000002"]').click(); });
let lk=await p.evaluate(()=>({ id:$('syncLinkId').value,
  open:$('syncLinkBox').open }));
ok(lk.id==='880000000002'&&lk.open===true,
   '★★押すと「手で結び付ける」の欄に ItemID が入る');
/* 読めなかった出品が無いとき。 */
await setup({ data:{ at:now, counts:{}, items:[ROW],
  ebay_unparsed:{ n:0, kinds:{}, samples:[], at_jst:'' } } });
unp=await p.evaluate(()=>$('syncUnpNote').textContent);
ok(/ありません/.test(unp),'★0件のときはそう書く');

console.log('\n=== 出品を手で結び付ける ===');
await setup({ data:{ at:now, counts:{}, items:[], mw:{} } });
await p.evaluate((o)=>{
  $('syncLinkBox').open=true;
  $('syncLinkId').value=o.item; $('syncLinkSku').value='';
  $('syncLinkGo').click();
},{ item:ITEM });
await p.waitForFunction(()=>/結び付けました|結び付けられません/
  .test($('syncLinkRes').textContent));
let res=await p.evaluate(()=>({ txt:$('syncLinkRes').textContent,
  posts:window.__posts }));
console.log('   '+res.txt);
ok(/結び付けました/.test(res.txt),'★★★ItemID だけで結び付けられる');
ok(/W-4562475323733/.test(res.txt)&&/960161917613/.test(res.txt),
   '★★結び付いた CustomLabel と ItemID を出す');
ok(/無在庫/.test(res.txt),'★無在庫として入ったと出す');
ok(res.posts.length===1&&res.posts[0].link.item_id===ITEM,
   '★★/ebay/link に ItemID を送る');
ok(!('label' in res.posts[0].link),'★CustomLabel が空のときは送らない');
/* 断られたときは理由を出す。 */
await setup({ data:{ at:now, counts:{}, items:[], mw:{} },
  link:{ ok:false, why:'eBay の CustomLabel は「W-1」です' } });
await p.evaluate((o)=>{ $('syncLinkBox').open=true;
  $('syncLinkId').value=o.item; $('syncLinkSku').value='W-'+o.jan;
  $('syncLinkForce').checked=true; $('syncLinkGo').click(); },
  { item:ITEM, jan:JAN });
await p.waitForFunction(()=>/結び付け/.test($('syncLinkRes').textContent));
res=await p.evaluate(()=>({ txt:$('syncLinkRes').textContent,
  posts:window.__posts }));
ok(/結び付けられません/.test(res.txt)&&/CustomLabel/.test(res.txt),
   '★★断られた理由をそのまま出す');
ok(res.posts[0].link.label==='W-'+JAN&&res.posts[0].link.force===true,
   '★★入れた CustomLabel と「上書きする」を送る');
/* ItemID の形が違えば送らない。 */
await p.evaluate(()=>{ window.__posts=[]; $('syncLinkId').value='abc';
  $('syncLinkGo').click(); });
res=await p.evaluate(()=>({ txt:$('syncLinkRes').textContent,
  posts:window.__posts }));
ok(/数字/.test(res.txt)&&res.posts.length===0,'★形が違えば送らない');

console.log('\n=== 出品リストのカードは ItemID と結び付くまで消さない ===');
const seedCsv=async()=>await p.evaluate((o)=>{
  csvList=[
    /* 書き出したのに ItemID が入っていない行（消してはいけない） */
    { id:'c1', jan:o.jan, asin:'', titleJa:'カラ松（無在庫）', buySource:'mw',
      cond:'新品', condId:1000, price:37, cost:3476, qty:1, priceSent:37,
      itemId:'', pics:[], dropship:true },
    /* ItemID が入っている行（消してよい） */
    { id:'c2', jan:'4902370550467', asin:'B00ABCDEFG', titleJa:'出品済みの行',
      condId:1000, price:20, cost:1000, qty:1, priceSent:20, itemId:'880000111' },
    /* まだ書き出していない行（消してよい） */
    { id:'c3', jan:'4902370550468', asin:'B00ABCDEFH', titleJa:'書き出し前の行',
      condId:1000, price:20, cost:1000, qty:1, itemId:'' }];
  csvLog=[]; csvTrash=[]; csvSaveList(); csvTrashSave(); csvPick={};
  switchTab('A'); csvRender();
  return csvList.map(function(r){ return { id:r.id, wait:csvWaitId(r) }; });
},{ jan:JAN });
let w=await seedCsv();
console.log('   '+JSON.stringify(w));
ok(w[0].wait===true,'★★★書き出したのに ItemID が無い行を「ItemID 待ち」とする');
ok(w[1].wait===false,'★ItemID が入っている行は対象外');
ok(w[2].wait===false,'★書き出していない行は対象外');
/* 「リストを空にする」でも ItemID 待ちの行は残る。 */
dlg=[]; answer=true;
await p.evaluate(()=>{ $('csvClear').click(); });
let left=await p.evaluate(()=>csvList.map(function(r){ return r.id; }));
console.log('   '+JSON.stringify(left)+' / '+JSON.stringify(dlg));
ok(left.length===1&&left[0]==='c1',
   '★★★「リストを空にする」でも ItemID 待ちの行は残す');
ok(dlg.some(function(m){ return /ItemID 待ちの 1件は残します/.test(m); }),
   '★★残すことを先に知らせる');
/* 行の「削除」は、理由を見せてから消す。 */
await seedCsv();
dlg=[]; answer=false;
await openCsvBoxes(p);
await p.evaluate(()=>{
  document.querySelector('[data-del="c1"]').click(); });
left=await p.evaluate(()=>csvList.map(function(r){ return r.id; }));
ok(left.indexOf('c1')>=0,'★★★「いいえ」なら消さない');
ok(dlg.some(function(m){ return /ItemID がまだ入っていない/.test(m)
  &&/アップロード結果を取り込む/.test(m); }),'★★消すと何が困るかを書く');
dlg=[]; answer=true;
await p.evaluate(()=>{
  document.querySelector('[data-del="c1"]').click(); });
left=await p.evaluate(()=>csvList.map(function(r){ return r.id; }));
ok(left.indexOf('c1')<0,'★「はい」なら消せる（押し間違いだけを防ぐ）');
/* アップロードが失敗した行は、直して出し直すので対象外。 */
w=await p.evaluate(()=>{
  csvList=[{ id:'c4', jan:'4902370550469', asin:'B00ABCDEFI', titleJa:'失敗した行',
    condId:1000, price:20, cost:1000, qty:1, priceSent:20, itemId:'',
    uploadErr:'[21919] なにか' }];
  return csvWaitId(csvList[0]);
});
ok(w===false,'★★アップロードが失敗した行は消してよい');
/* カードに「ItemID 待ち」の印が出る。 */
await seedCsv();
let badge=await p.evaluate(()=>{
  const el=document.querySelector('[data-badge="c1"]');
  return el?el.textContent:''; });
ok(/ItemID 待ち/.test(badge),'★★★カードに「ItemID 待ち」の印を出す');

console.log('\n=== W-<JAN> の照合（アップロード結果の取り込み）===');
let hit=await p.evaluate((o)=>{
  const k=csvLabelKey('W-'+o.jan);
  return { key:k, hit:csvLabelHit(csvList[0],'W-'+o.jan),
    why:csvLabelWhy('W-4902370550467'),
    label:csvCustomLabel(csvList[0]) };
},{ jan:JAN });
console.log('   '+JSON.stringify(hit));
ok(hit.key&&hit.key.jan===JAN&&hit.key.mw===true,
   '★★★W-<JAN> を読めるようにする');
ok(hit.hit===true,'★★★JAN で行に突き合わせられる');
ok(/JAN 4902370550467/.test(hit.why),
   '★★当たらないときは JAN を書く（「E-<ASIN> の形でない」ではなく）');
ok(hit.label==='W-'+JAN,'★無在庫の行の CustomLabel は W-<JAN>');

console.log('\n=== 消した行はゴミ箱から戻して結び付ける ===');
let back=await p.evaluate((o)=>{
  csvList=[{ id:'c1', jan:o.jan, asin:'', titleJa:'カラ松（無在庫）',
    buySource:'mw', cond:'新品', condId:1000, price:37, cost:3476, qty:1,
    priceSent:37, itemId:'', pics:[], dropship:true }];
  csvLog=[]; csvTrash=[]; csvSaveList(); csvTrashSave();
  /* 結果を取り込む前に消してしまった状態を作る。 */
  csvDeleteRows(csvList.slice(),'消しました',true);
  const gone=csvList.length;
  const text='Action,Status,ItemID,CustomLabel,ErrorMessage\n'
    +'Add,Success,'+o.item+',W-'+o.jan+',\n';
  const r=csvResImport(text);
  return { gone:gone, back:r.back, miss:r.miss, ok:r.ok,
    rows:csvList.map(function(x){ return { id:x.id, itemId:x.itemId }; }),
    trash:csvTrash.length };
},{ jan:JAN, item:ITEM });
console.log('   '+JSON.stringify(back));
ok(back.gone===0,'★消したあとは一覧が空');
ok(back.back===1,'★★★ゴミ箱から1件戻す');
ok(back.miss===0,'★★★「出品リストにありません」にならない');
ok(back.rows.length===1&&back.rows[0].itemId===ITEM,
   '★★★戻した行に ItemID が入る');
ok(back.trash===0,'★戻した行はゴミ箱から消える');

await T.done();
})();
