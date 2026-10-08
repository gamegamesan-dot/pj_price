/* 出品CSVタブ：数量0の出品の復活と、重複出品の警告（6.20）
   ・同じASIN・同じ区分の出品が eBay にあって数量0 → 新規出品ではなく Revise で復活
   ・数量1以上 → Add せず警告だけ（重複出品の防止）
   ・写真0枚の行は書き出さない（前の出品の写真のまま復活させない）
   ・CustomLabel が M- の出品は E- に変える
   ・判定は pj-sync が取り込んだ eBay の出品からだけ見る（出品リストは見ない） */
const { harness } = require('./lib');
const T = harness('出品CSVタブ：復活と重複の判定');
const ok = T.ok;
(async()=>{
const p=await T.open();
const fs=require('fs');
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
const dl=[]; p.on('download',async d=>dl.push({name:d.suggestedFilename(),
  text:fs.readFileSync(await d.path(),'utf8')}));
await p.click('#tabD');

const setup=async(opt)=>await p.evaluate((o)=>{
  window.__qtyCalls=[]; window.__posts=[];
  window.__qty=o.qty;
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u);
    if(/\/cart-qty/.test(url)){ window.__qtyCalls.push(JSON.parse(i.body));
      if(window.__qty==='bad')return Promise.resolve({ok:false,status:500});
      return Promise.resolve({ok:true,json:()=>Promise.resolve(window.__qty)}); }
    if(/\/listings/.test(url)){ window.__posts.push(JSON.parse(i.body).items);
      return Promise.resolve({ok:true,json:()=>Promise.resolve({accepted:1,rejected:0})}); }
    return real(u,i);
  };
  $('csvSort').value='add';
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('csvShipProfile').value='W1000'; $('csvShipProfileRe').value='W2000';
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P';
  $('csvLocation').value='Tokyo'; $('fx').value='160'; $('csvWeightCart').value='50';
  const row=(id,asin,cond,extra)=>Object.assign({id:id,src:'sedori',
    sku:'game-20260101-UG-'+asin+'-1200',asin:asin,jan:'49'+id,titleJa:'商品'+id,
    titleEn:'Used Nintendo Switch Item '+id+' Japan Import',cat:'139973',catFixed:true,
    condId:cond,condSrc:'良い',cost:2000,qty:1,weight:150,
    pics:[{url:'https://img/'+id+'-1.jpg'},{url:'https://img/'+id+'-2.jpg'}],
    descHtml:'<p>desc '+id+'</p>',
    specs:{origin:'Japan',platform:'Nintendo Switch',gameName:'Item '+id},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',cartOnly:false,dropship:false,
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false},extra||{});
  csvList=[
    row('r1','B07571RH4P',5000),                                   // 中古 -U：数量0 → 復活
    row('r2','B09TPBVJ5F',1000,
      {titleEn:'Nintendo Switch Item r2 Japan Import'}),            // 新品：数量0 → 復活（M-）
    row('r3','B0CWGXZWNV',5000),                                   // 数量2 → 重複の警告
    row('r4','B0JPONLY01',6000,{cartOnly:true}),                   // -C：数量0 → 復活
    row('r5','B0NOPIC0001',5000,{pics:[]})                         // 写真0枚
  ];
  csvPick={}; csvCart={};
  csvList.forEach(csvRecalc);
  csvSaveList();
  // pj-sync が取り込んだ eBay の出品
  syncData={at:new Date().toISOString(),counts:{},items:[
    {asin:'B07571RH4P',cond:'used',scope:'ebay',ebay_sku:'E-B07571RH4P-U',
     ebay_item_id:'110111',ebay_qty:0,ebay_price:42.5,dropship:0,warnings:[],state:'ok'},
    {asin:'B09TPBVJ5F',cond:'new',scope:'ebay',ebay_sku:'M-B09TPBVJ5F',
     ebay_item_id:'110222',ebay_qty:0,ebay_price:30,dropship:1,warnings:[],state:'ok'},
    {asin:'B0CWGXZWNV',cond:'used',scope:'ebay',ebay_sku:'E-B0CWGXZWNV-U',
     ebay_item_id:'110333',ebay_qty:2,ebay_price:55,dropship:0,warnings:[],state:'ok'},
    {asin:'B0JPONLY01',cond:'cart',scope:'ebay',ebay_sku:'E-B0JPONLY01-C',
     ebay_item_id:'110444',ebay_qty:0,ebay_price:18,dropship:0,warnings:[],state:'ok'},
    {asin:'B0NOPIC0001',cond:'used',scope:'ebay',ebay_sku:'E-B0NOPIC0001-U',
     ebay_item_id:'110555',ebay_qty:0,ebay_price:20,dropship:0,warnings:[],state:'ok'}]};
  csvRender(); $('csvListBox').open=true;
},opt||{qty:{ok:true,at:'2026-10-06T09:00:00Z',
  qty:{'110111':{qty:0,price:42.5},'110222':{qty:0,price:30},
       '110444':{qty:0,price:18}},missing:[]}});
const cardOf=async(w)=>(await p.$$eval('#csvList > div',
  ds=>ds.map(x=>x.innerText.replace(/\n/g,' | ')))).filter(t=>t.indexOf(w)>=0)[0]||'';

console.log('=== 新規出品（Add）から外れる ===');
await setup();
const sp=await p.evaluate(()=>{ const d=csvExportSplit(null);
  return { rows:d.rows.map(x=>x.id), done:d.done.map(x=>x.r.id+':'+x.why),
           bad:d.bad.map(x=>x.r.id+':'+x.why) }; });
sp.done.forEach(x=>console.log('   '+x));
console.log('   Addに残る: '+JSON.stringify(sp.rows)+' / 不備: '+JSON.stringify(sp.bad));
ok(sp.rows.length===0,'★5件すべて新規出品（Add）から外れる');
ok(sp.done.some(x=>/^r1:既存の出品を復活（ItemID 110111・現在の数量 0）/.test(x)),
   '★中古(-U)の数量0は「既存の出品を復活」');
ok(sp.done.some(x=>/^r2:既存の出品を復活/.test(x)),'★新品の数量0も復活');
ok(sp.done.some(x=>/^r4:既存の出品を復活/.test(x)),'★カートリッジのみ(-C)の数量0も復活');
ok(sp.done.some(x=>/^r3:同じ出品がすでにあります（ItemID 110333・数量 2）/.test(x)),
   '★数量1以上は重複の警告だけ（Addしない）');

console.log('\n=== 行の表示 ===');
const c1=await cardOf('商品r1');
console.log('   r1: '+c1.split(' | ').filter(x=>/復活|写真/.test(x)).join('  '));
ok(/既存の出品を復活/.test(c1)&&/ItemID 110111・現在の数量 0/.test(c1),
   '★「既存の出品を復活（ItemID xxxx・現在の数量 0）」と出る');
ok(/売値 \$42\.50（維持します）/.test(c1),'売値を維持すると出す');
ok(/写真 2枚で全差し替え/.test(c1),'★写真の差し替え枚数を出す');
const c2=await cardOf('商品r2');
console.log('   r2: '+c2.split(' | ').filter(x=>/CustomLabel/.test(x)).join('  '));
ok(/CustomLabel を E-B09TPBVJ5F に変えます/.test(c2),'★M- の出品は E- に変えると出す');
const c3=await cardOf('商品r3');
console.log('   r3: '+c3.split(' | ').filter(x=>/同じ出品/.test(x)).join('  '));
ok(/同じ出品があります/.test(c3)&&/数量 2/.test(c3)&&/重複出品になる/.test(c3),
   '★重複はそう出す');
const c5=await cardOf('商品r5');
console.log('   r5: '+c5.split(' | ').filter(x=>/写真が0枚/.test(x)).join('  '));
ok(/写真が0枚なので復活させません/.test(c5)&&/撮り直した写真を付けて/.test(c5),
   '★写真0枚の理由を出す');

console.log('\n=== 価格の見直し候補（2割以上ずれたときだけ）===');
const gap=await p.evaluate(()=>{
  const r=csvRowById('r1');
  return { rec:r.price, now:42.5,
    near:csvCartPriceGap(r,{price:Math.round(r.price*100)/100}),
    far:csvCartPriceGap(r,{price:Math.round(r.price*0.5*100)/100}) };
});
console.log('   '+JSON.stringify(gap));
ok(gap.near===0,'★ずれが小さい行には出さない');
ok(gap.far>=0.2,'★2割以上ずれたら「価格の見直し候補」');

console.log('\n=== 書き出し（Revise・数量は取り直して+1）===');
dlg.length=0; dl.length=0;
await p.click('#csvRevive2');
await p.waitForFunction(()=>!$('csvRevive2').disabled,null,{timeout:8000});
await p.waitForTimeout(300);
console.log('   /cart-qty へ: '+JSON.stringify(await p.evaluate(()=>window.__qtyCalls)));
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/3件/.test(dlg[0]||''),'★復活できる3件を確認する（写真0枚と重複は入らない）');
ok(/写真が0枚の1件/.test(dlg[0]||''),'★写真0枚の件数も知らせる');
const L=(((dl[0]||{}).text)||'').trim().split(/\r\n/);
console.log('   '+JSON.stringify(L.slice(1)));
ok(L.length===5,'★ヘッダ2行＋3件');
const head=L[1].split(',');
['ItemID','CustomLabel','*Title','*ConditionID','*Description','PicURL','*Quantity']
  .forEach(k=>ok(head.indexOf(k)>=0,'列 '+k+' がある'));
ok(head.indexOf('ConditionDescription')>=0,
   '★カートリッジのみがあるので ConditionDescription の列も足す');
ok(!/StartPrice/.test(L[1]),'★売値の列は入れない（いまの売値を維持する）');
const r2line=L.slice(2).find(x=>/110222/.test(x))||'';
console.log('   r2: '+r2line.slice(0,90));
ok(/E-B09TPBVJ5F/.test(r2line)&&!/M-B09TPBVJ5F/.test(r2line),
   '★M- の出品は E- の CustomLabel で出す');
ok(L.slice(2).every(x=>/,1$/.test(x)),'★数量は取り直した0に+1した1で出す');
ok(L.slice(2).every(x=>/https:\/\/img\//.test(x)),'★撮り直した写真を全差し替えする');

console.log('\n=== 数量を取り直せなければ書き出さない ===');
await setup({qty:'bad'});
dl.length=0;
await p.click('#csvRevive2');
await p.waitForFunction(()=>!$('csvRevive2').disabled,null,{timeout:8000});
await p.waitForTimeout(200);
const note=await p.textContent('#csvReviveNote');
console.log('   '+note.replace(/\n/g,' ').slice(0,100));
ok(dl.length===0&&/止めました/.test(note),'★取り直せなければ書き出さずに止める');

console.log('\n=== 判定は pj-sync の取り込みだけを見る ===');
const only=await p.evaluate(()=>{
  // 出品リストを空にしても、同じASIN・区分の数量0の出品があれば復活の対象
  const keep=csvList.slice();
  const one=keep[0];
  csvList=[one];
  csvRender();
  const a=!!csvRevive(one);
  // 逆に pj-sync の取り込みが無ければ判定しない
  const sd=syncData; syncData=null; csvRender();
  const b=!!csvRevive(one);
  const html=csvReviveHtml(one);
  syncData=sd; csvList=keep; csvRender();
  return { withSync:a, withoutSync:b, note:/eBayの出品を取り込んでいません/.test(html) };
});
console.log('   '+JSON.stringify(only));
ok(only.withSync,'★出品リストに他の行が残っていなくても復活の対象になる');
ok(!only.withoutSync,'★pj-sync の取り込みが無ければ判定しない');
ok(only.note,'★「eBayの出品を取り込んでいません」と知らせる');

console.log('\n=== 復活させた行は 無在庫オフ・手元在庫オン にする ===');
await setup();
dlg.length=0; dl.length=0;
await p.click('#csvRevive2');
await p.waitForFunction(()=>!$('csvRevive2').disabled,null,{timeout:8000});
await p.waitForTimeout(400);
const posts=await p.evaluate(()=>window.__posts);
console.log('   /listings へ: '+JSON.stringify(posts));
ok(posts.length>0&&posts[0].some(x=>x.dropship===0||x.dropship===false),
   '★復活させた行は無在庫オフで送る');
ok(posts[0].some(x=>x.on_hand===1||x.on_hand===true),'★手元在庫オンで送る');
await T.done();
})();
