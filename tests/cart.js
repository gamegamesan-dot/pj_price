/* 出品CSVタブ：カートリッジのみの「既存の出品に+1」（6.19・7.x の再発防止）
   File Exchange の Revise の数量は上書きなので、古い値＋1で出すと売り越しになる。
   書き出す直前に eBay のいまの数量を取り直し（POST /cart-qty）、その値＋1で出す。
   取り直せなかったら書き出さずに止める。 */
const { harness } = require('./lib');
const T = harness('出品CSVタブ：カートリッジのみの+1（数量の取り直し）');
const ok = T.ok;
(async()=>{
const p=await T.open();
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
const fs=require('fs');
const dl=[]; p.on('download',async d=>dl.push({name:d.suggestedFilename(),
  text:fs.readFileSync(await d.path(),'utf8')}));
await p.click('#tabD');

const setup=async(opt)=>await p.evaluate((o)=>{
  window.__posts=[]; window.__qtyCalls=[];
  window.__qty=o.qty;
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u);
    if(/\/cart-qty/.test(url)){
      window.__qtyCalls.push(JSON.parse(i.body));
      if(window.__qty==='http')return Promise.resolve({ok:false,status:500});
      if(window.__qty==='throw')return Promise.reject(new Error('offline'));
      return Promise.resolve({ok:true,json:()=>Promise.resolve(window.__qty)});
    }
    if(/\/listings/.test(url)){ window.__posts.push(JSON.parse(i.body).items);
      return Promise.resolve({ok:true,json:()=>Promise.resolve({accepted:1,rejected:0})}); }
    return real(u,i);
  };
  $('syncApi').value=o.api===''?'':'https://pj-sync.example.workers.dev';
  $('syncKey').value='k';
  $('csvShipProfile').value='W1000'; $('csvRetProfile').value='R';
  $('csvPayProfile').value='P'; $('csvLocation').value='Tokyo';
  $('fx').value='160'; $('csvWeightCart').value='50';
  csvList=[{id:'k1',src:'sedori',sku:'game-20260101-UA-B0JPONLY01-900',
    asin:'B0JPONLY01',jan:'4901',titleJa:'星のカービィ（可）',catFixed:true,
    titleEn:'Used Kirby Nintendo Switch Japan Import Cartridge Only',cat:'139973',
    condId:6000,condSrc:'可',cost:900,qty:1,weight:50,pics:[{url:'u'}],
    descHtml:'<p>d</p>',specs:{origin:'Japan',platform:'Nintendo Switch',gameName:'Kirby'},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',cartOnly:true,dropship:false,
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false}];
  csvCart={}; csvPick={};
  // pj-sync が取り込んだ eBay の出品（数量2・売値$18）
  syncData={at:new Date().toISOString(),counts:{},items:[
    {asin:'B0JPONLY01',cond:'cart',scope:'ebay',ebay_sku:'E-B0JPONLY01-C',
     ebay_item_id:'110444',ebay_qty:2,ebay_price:18,dropship:0,warnings:[],state:'ok'}]};
  csvSaveList(); csvRender(); $('csvListBox').open=true;
},opt);

console.log('=== 既存の出品に積み上げる行として扱う ===');
await setup({qty:{ok:true,at:'2026-10-06T09:00:00Z',
  qty:{'110444':{qty:3,price:18}},missing:[]}});
const stack=await p.evaluate(()=>{
  const r=csvRowById('k1'), ex=csvCartStack(r);
  return { label:csvCustomLabel(r), kind:csvKindOf(r), ex:ex,
    card:(Array.from(document.querySelectorAll('#csvList > div'))
      .map(d=>d.innerText).find(t=>/カービィ/.test(t))||'').replace(/\n/g,' | '),
    split:(function(){ var sp=csvExportSplit(null);
      return { rows:sp.rows.map(x=>x.id), done:sp.done.map(x=>x.r.id+':'+x.why),
               bad:sp.bad.map(x=>x.r.id+':'+x.why), amz:sp.amz.map(x=>x.r.id) }; })() };
});
console.log('   '+JSON.stringify({label:stack.label,kind:stack.kind,ex:stack.ex}));
console.log('   '+JSON.stringify(stack.split));
ok(stack.label==='E-B0JPONLY01-C'&&stack.kind==='cart','CustomLabel は E-<ASIN>-C');
ok(!!stack.ex&&stack.ex.itemId==='110444'&&stack.ex.from==='sync',
   '★数量は pj-sync が取り込んだ出品から取る');
ok(stack.ex.qtyKnown===true,'★pj-sync から取った数量だけ「分かっている」扱い');
ok(stack.split.done.some(x=>/^k1:既存の出品に追加（ItemID 110444）/.test(x))
   &&!stack.split.rows.length&&!stack.split.bad.length,
   '★新規出品（Add）ではなく「既存の出品に追加」に回る');

console.log('\n=== 書き出す直前に数量を取り直す ===');
dlg.length=0; dl.length=0;
await p.click('#csvCartAdd');
await p.waitForFunction(()=>!$('csvCartAdd').disabled,null,{timeout:8000});
await p.waitForTimeout(300);
const call=await p.evaluate(()=>window.__qtyCalls);
console.log('   /cart-qty へ: '+JSON.stringify(call));
ok(call.length===1&&call[0].item_ids.join()==='110444','★/cart-qty に ItemID を送る');
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/3 → 4/.test(dlg[0]||''),'★取り直した数量（3）＋1 で確認する（表示の2ではない）');
ok(/表示していた数量と違っていました/.test(dlg[0]||''),
   '★表示と違っていたことを知らせる');
ok(/売値は変えません/.test(dlg[0]||''),'売値は維持すると伝える');
console.log('   書き出し: '+JSON.stringify(dl.map(x=>x.name)));
const lines=(dl[0]||{}).text ? dl[0].text.trim().split(/\r\n/) : [];
console.log('   '+JSON.stringify(lines));
ok(lines.length===3&&lines[2]==='Revise,110444,4',
   '★CSVは取り直した数量＋1（Revise,110444,4）');
ok(lines[1].split(',').length===3&&/\*Quantity/.test(lines[1]),
   '★3列だけ（売値の列は入れない）');

console.log('\n=== 取り直せなかったら書き出さない ===');
for(const [q,label] of [
  [{ok:false,err:'ebay_active'},'eBayの出品を読めない'],
  [{ok:false,missing:['110444']},'出品が見つからない'],
  ['http','HTTPエラー'],
  ['throw','つながらない']]){
  await setup({qty:q});
  dlg.length=0; dl.length=0;
  await p.click('#csvCartAdd');
  await p.waitForFunction(()=>!$('csvCartAdd').disabled,null,{timeout:8000});
  await p.waitForTimeout(200);
  const note=await p.textContent('#csvCartNote');
  console.log('   '+label+': '+note.replace(/\n/g,' ').slice(0,90));
  ok(dl.length===0&&/書き出しを止めました/.test(note),
     '★'+label+'ときは書き出さずに止める');
  ok(/売り越し/.test(note),'★止めた理由（売り越しになる）を出す');
}

console.log('\n=== pj-sync の設定が無いときは止める ===');
await setup({api:'',qty:{ok:true,qty:{}}});
dl.length=0;
await p.click('#csvCartAdd'); await p.waitForTimeout(300);
const n2=await p.textContent('#csvCartNote');
console.log('   '+n2.slice(0,80));
ok(dl.length===0&&/pj-sync のURL/.test(n2),'★URLが無ければ書き出さずに知らせる');

console.log('\n=== 価格の見直し候補（2割以上ずれたら出す。自動では変えない）===');
const gap=await p.evaluate(()=>{
  const r=csvRowById('k1');
  // 推奨売値と既存の出品の売値のずれを、既存の出品の売値側で作る
  const rec=+r.price||0;
  return { rec:rec,
    near:csvCartPriceGap(r,{price:Math.round(rec*100)/100}),
    far:csvCartPriceGap(r,{price:Math.round(rec*0.5*100)/100}) };
});
console.log('   '+JSON.stringify(gap));
ok(gap.near===0,'★ずれが小さい行には出さない');
ok(gap.far>=0.2,'★2割以上ずれた行だけ出す');
await T.done();
})();
