/* 出品CSVタブ：フィギュアのみ（箱なし・-L）の出品（6.38・7.36）
   せどりすとで「可」として取り込んだフィギュアは、箱を外して本体だけで売る。
   プチプチで巻いて封筒で送れるので、箱付きより送料をかなり抑えられる。
   仕組みはカートリッジのみ（-C）と同じで、CustomLabel は E-<ASIN>-L、
   D1 の cond は 'loose'、一点物にせず同じASINの -L があれば数量を足す。 */
const { harness } = require('./lib');
const T = harness('出品CSVタブ：フィギュアのみ（箱なし・-L）');
const ok = T.ok;

// 「可」のフィギュア1行＋「可」のゲーム1行＋「良い」のフィギュア1行
const CSV=['SKU,商品名,ASIN,JAN,出品コンディション,仕入価格,数量,重量',
  'hobby-20260101-UA-B0LOOSE001-4500,ねんどろいど 錦木千束,B0LOOSE001,4901,可,4500,1,',
  'game-20260101-UA-B0LOOSE002-900,星のカービィ ディスカバリー SW版,B0LOOSE002,4902,可,900,1,',
  'hobby-20260101-UG-B0LOOSE003-6000,フィギュア 雪ミク,B0LOOSE003,4903,良い,6000,1,'
].join('\n');

(async()=>{
const p=await T.open();
await p.click('#tabD');

const base=async()=>await p.evaluate((text)=>{
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('csvWeightLoose').value='200'; $('csvShipLoose').value='0';
  $('csvLooseAmz').value='80'; $('csvWeightCart').value='50';
  $('csvShipProfile').value='W1000'; $('csvShipProfileLoose').value='';
  $('csvRetProfile').value='R'; $('csvPayProfile').value='P'; $('csvLocation').value='Tokyo';
  csvList=[]; csvPick={}; csvCart={}; syncData=null;
  csvImport(text);
  /* FBA（手元在庫）の行として見る＝CustomLabel が E- で出る。
     写真と英題は書き出しの条件なので、ここで埋めておく。 */
  csvList.forEach(function(r){
    r.fba=true;
    r.pics=[{url:'https://example.test/1.jpg'}];
    if(!String(r.titleEn||'').trim())r.titleEn='Used Japan Import Figure';
    r.catFixed=true; r.catDone=true;                 // カテゴリは確定済みとして見る
    r.specs=Object.assign(r.specs||{},{origin:'Japan'});
    if(r.cat==='139973')r.specs=Object.assign(r.specs,
      {platform:'Nintendo Switch',gameName:'Kirby'});
    try{ r.descHtml=csvDescFor(r); }catch(e){}
  });
  csvRender();
  return csvList.length;
},CSV);

console.log('=== 「可」のフィギュアは -L・Used・英題に Loose ===');
await base();
const imp=await p.evaluate(()=>{
  const fig=csvList.find(r=>r.asin==='B0LOOSE001');
  const gam=csvList.find(r=>r.asin==='B0LOOSE002');
  const good=csvList.find(r=>r.asin==='B0LOOSE003');
  // 英題は仕様（ブランド・シリーズ・キャラ）から作る
  fig.specs=Object.assign(fig.specs||{},{brand:'Good Smile Company',
    series:'Lycoris Recoil',chara:'Chisato Nishikigi',itemName:''});
  fig.titleEn=figTitleFrom(fig.condId!==1000,csvFigParts(fig),!!fig.looseOnly).text;
  const o=r=>({loose:!!r.looseOnly,cart:!!r.cartOnly,kind:csvKindOf(r),
    label:csvCustomLabel(r),cond:r.condId,condName:CSV_COND_NAME[r.condId],
    one:!!r.oneOff,weight:r.weight,syncKey:syncKeyOf(r)});
  return {fig:o(fig),gam:o(gam),good:o(good),titleEn:fig.titleEn,
    cd:csvLooseCD(fig),name:csvLooseName(fig),
    desc:csvDescFor(fig).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ')};
});
console.log('   フィギュア（可）: '+JSON.stringify(imp.fig));
console.log('   ゲーム（可）    : '+JSON.stringify(imp.gam));
console.log('   フィギュア（良）: '+JSON.stringify(imp.good));
ok(imp.fig.loose===true&&imp.fig.label==='E-B0LOOSE001-L',
   '★「可」のフィギュアは CustomLabel が E-<ASIN>-L');
ok(imp.fig.kind==='loose'&&imp.fig.syncKey==='B0LOOSE001|loose',
   '★区分（D1 の cond）は loose');
ok(imp.fig.cond===3000&&imp.fig.condName==='Used','★状態は Used（3000）');
ok(imp.fig.one===false,'★一点物にしない（同じ出品を使い続ける）');
console.log('   英題: '+imp.titleEn);
ok(/Loose No Box$/.test(imp.titleEn)&&imp.titleEn.length<=80,
   '★英題の末尾に Loose No Box が入る（80文字以内）');
ok(/^Used /.test(imp.titleEn),'英題の先頭は Used');
console.log('   ConditionDescription: '+imp.cd+' ／ 呼び名: '+imp.name);
ok(imp.cd==='Figure only (no box)'&&imp.name==='フィギュアのみ',
   '★ConditionDescription に「箱なし」を書く');
console.log('   出品文: '+imp.desc.slice(0,200));
ok(/Figure only\. The original box is NOT included\./.test(imp.desc)
   &&/padded envelope/.test(imp.desc)&&/shown in the photos/.test(imp.desc),
   '★出品文に3文（箱なし・封筒発送・付属品は写真のとおり）を入れる');

console.log('\n=== 「可」のゲームは今までどおり -C ===');
ok(imp.gam.cart===true&&imp.gam.loose===false&&imp.gam.label==='E-B0LOOSE002-C'
   &&imp.gam.kind==='cart','★「可」のゲームは E-<ASIN>-C（カートリッジのみ）');
ok(imp.gam.cond===6000,'ゲームの既定は Acceptable（6000）のまま');
ok(imp.good.loose===false&&imp.good.label==='E-B0LOOSE003-U',
   '★「可」以外のフィギュアは今までどおり E-<ASIN>-U');

console.log('\n=== 箱付きに切り替えると E-<ASIN>-U に戻る ===');
const tog=await p.evaluate(()=>{
  const fig=csvRowById(csvList.find(r=>r.asin==='B0LOOSE001').id);
  csvLooseToggle(fig);
  const off={loose:!!fig.looseOnly,label:csvCustomLabel(fig),kind:csvKindOf(fig),
    cond:fig.condId,weight:fig.weight,title:fig.titleEn,cd:csvLooseCD(fig)};
  csvLooseToggle(fig);
  const on={loose:!!fig.looseOnly,label:csvCustomLabel(fig),cond:fig.condId,
    weight:fig.weight,title:fig.titleEn};
  return {off:off,on:on};
});
console.log('   箱付き: '+JSON.stringify(tog.off));
console.log('   箱なし: '+JSON.stringify(tog.on));
ok(tog.off.loose===false&&tog.off.label==='E-B0LOOSE001-U'
   &&tog.off.kind==='used','★箱付きに切り替えると E-<ASIN>-U');
ok(!/Loose/.test(tog.off.title)&&/Loose No Box$/.test(tog.on.title),
   '★英題の Loose No Box も連動して出し入れされる');
ok(tog.off.cd===''&&tog.off.cond===3000,'箱付きでも状態は Used（フィギュアの表）');
ok(tog.off.weight>tog.on.weight,
   '★箱付きに戻すと重量も戻る（箱なしのほうが軽い）');

console.log('\n=== 重量 200g と封筒の送料で推奨売値が出る ===');
await base();
const price=await p.evaluate(()=>{
  const fig=csvList.find(r=>r.asin==='B0LOOSE001');
  const boxed=csvList.find(r=>r.asin==='B0LOOSE003');
  const noFlat={w:fig.weight,price:fig.price,floor:fig.floor};
  $('csvShipLoose').value='380'; csvList.forEach(csvRecalc);
  const flat={w:fig.weight,price:fig.price,floor:fig.floor,
    ship:csvShipProfileFor(fig),flat:csvFlatOf(fig)};
  $('csvShipProfileLoose').value='ENV500'; csvRender();
  return {noFlat:noFlat,flat:flat,prof:csvShipProfileFor(fig),
    boxedW:boxed.weight,boxedFlat:csvFlatOf(boxed),
    boxedProf:csvShipProfileFor(boxed),slow:csvShipSlow()};
});
console.log('   '+JSON.stringify(price));
ok(price.noFlat.w===200,'★実重量が空なら既定の 200g を使う（梱包マージンを足さない）');
ok(price.flat.flat===380&&price.flat.price>0&&price.flat.price<price.noFlat.price,
   '★封筒の送料（1通ぶん固定）で推奨売値が出る（送料表より安いので売値も下がる）');
ok(price.flat.floor>0&&price.flat.floor<price.flat.price,'最低売値も出る');
ok(price.prof==='ENV500','★封筒用の配送ポリシーを使う');
ok(price.boxedFlat===0&&price.boxedProf!=='ENV500',
   '★箱付きの行は今までどおり（送料表・いつもの配送ポリシー）');

console.log('\n=== 同じASINの -L が出品中なら +1 CSV に入る ===');
const stack=await p.evaluate(()=>{
  const fig=csvList.find(r=>r.asin==='B0LOOSE001');
  const before=csvCartStack(fig);
  syncData={at:new Date().toISOString(),counts:{},items:[
    {asin:'B0LOOSE001',cond:'loose',scope:'ebay',ebay_sku:'E-B0LOOSE001-L',
     ebay_item_id:'330111',ebay_qty:2,ebay_price:40,dropship:0,warnings:[],state:'ok'},
    {asin:'B0LOOSE003',cond:'used',scope:'ebay',ebay_sku:'E-B0LOOSE003-U',
     ebay_item_id:'330222',ebay_qty:1,ebay_price:70,dropship:0,warnings:[],state:'ok'}]};
  csvRender();
  const ex=csvCartStack(fig);
  const sp=csvExportSplit(null);
  return {before:before,ex:ex,
    done:sp.done.map(x=>x.r.asin+':'+x.why),rows:sp.rows.map(x=>x.asin),
    bad:sp.bad.map(x=>x.r.asin+':'+x.why),
    dup:csvList.filter(r=>!!csvDupListing(r)).map(r=>r.asin),
    btn:$('csvCartAdd').style.display+'/'+$('csvCartAdd').textContent};
});
console.log('   '+JSON.stringify(stack));
ok(stack.before===null,'出品が無ければ新規出品（Add）のまま');
ok(!!stack.ex&&stack.ex.itemId==='330111'&&stack.ex.qty===2,
   '★同じASINの -L の出品（ItemID）を引き当てる');
ok(stack.done.some(x=>/^B0LOOSE001:既存の出品に追加（ItemID 330111）/.test(x))
   &&stack.rows.indexOf('B0LOOSE001')<0,
   '★新規出品ではなく「既存の出品に+1」に回る');
ok(stack.dup.indexOf('B0LOOSE001')<0,
   '★「重複の恐れ」には出さない（同じ出品に積み上げるため）');
ok(/block/.test(stack.btn)&&/\+1するCSV/.test(stack.btn),
   '★+1するCSVのボタンが出る');

console.log('\n=== 既存の CSV の列や形式は変わらない ===');
const head=await p.evaluate(()=>{
  const fig=csvList.find(r=>r.asin==='B0LOOSE001');
  const boxed=csvList.find(r=>r.asin==='B0LOOSE003');
  const row=csvRowFor(fig);
  return {loose:csvBuild(fig.cat,[fig],'Add').split(/\r\n/).slice(0,2),
    boxed:csvBuild(boxed.cat,[boxed],'Add').split(/\r\n/).slice(0,2),
    label:row['CustomLabel'],cond:row['*ConditionID'],
    cd:row['ConditionDescription'],qty:row['*Quantity'],
    ship:row['ShippingProfileName']};
});
console.log('   見出しの列数: 箱なし '+head.loose[1].split(',').length
  +' / 箱付き '+head.boxed[1].split(',').length);
console.log('   箱なしの見出しの末尾: ...'+head.loose[1].split(',').slice(-3).join(','));
console.log('   箱付きの見出しの末尾: ...'+head.boxed[1].split(',').slice(-3).join(','));
console.log('   '+JSON.stringify({label:head.label,cond:head.cond,cd:head.cd,
  qty:head.qty,ship:head.ship}));
ok(head.loose[0]===head.boxed[0],'★1行目（テンプレートの案内行）は今までどおり');
ok(head.boxed[1].indexOf('ConditionDescription')<0,
   '★箱付きだけの書き出しに ConditionDescription の列を足さない');
ok(head.loose[1]===head.boxed[1]+',ConditionDescription',
   '★箱なしの行があるときだけ列を末尾に足す（ほかの列は同じ順）');
ok(head.label==='E-B0LOOSE001-L'&&Number(head.cond)===3000
   &&head.cd==='Figure only (no box)','★行の中身も -L・Used・箱なしの注記');

console.log('\n=== 販売連携：Amazon基準は中古最安値×係数・同等ラインは使わない ===');
const sync=await p.evaluate(()=>{
  $('syncApi').value=''; $('syncKey').value='';
  $('amzFeeRate').value='15'; $('amzFbaFee').value='400';
  $('csvLooseAmz').value='80'; $('csvWeightLoose').value='200';
  $('csvShipLoose').value='380'; $('syncSkipAcc').checked=false;
  const it=(asin,o)=>Object.assign({asin:asin,scope:'ebay',prefix:'hobby',
    ebay_item_id:'33'+asin.slice(-4),ebay_qty:1,one_off:0,dropship:0,restocking:0,
    mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,
    fba_available:0,fba_inbound:0,fba_reserved:0,warnings:[],notes:[],state:'ok'},o||{});
  syncData={at:new Date().toISOString(),counts:{},items:[
    // 箱なし（-L）：仕入値は分からない。Amazon の中古最安値 ¥9,719
    it('B0LOOSE001',{cond:'loose',ebay_sku:'E-B0LOOSE001-L',ebay_price:45,
      cost_yen:null,amazon_lowest:9719,amazon_offers_json:JSON.stringify([{p:9719,c:'used'}])}),
    // 箱付き中古（-U）：同じ最安値。こちらは割り引かない
    it('B0LOOSE003',{cond:'used',ebay_sku:'E-B0LOOSE003-U',ebay_price:80,
      cost_yen:null,amazon_lowest:9719,amazon_offers_json:JSON.stringify([{p:9719,c:'used'}])}),
    // 箱なしで仕入値が分かっている行（Amazon同等ラインを使わない確認）
    it('B0LOOSE004',{cond:'loose',ebay_sku:'E-B0LOOSE004-L',ebay_price:30,
      cost_yen:1680,amazon_lowest:9719,amazon_offers_json:JSON.stringify([{p:9719,c:'used'}])})]};
  switchTab('E');
  const o=(a)=>{ const r=syncData.items.find(x=>x.asin===a);
    const b=syncBasis(r), al=syncAmzLine(r), f=syncFloorOf(r);
    return { low:b.low, cut:!!b.looseCut, weight:syncDefWeight(r), flat:syncFlatOf(r),
             line:al&&al.price, floor:f.v, amz:!!f.amz,
             rec:(syncRecommend(r)||{}).price }; };
  return { lo:o('B0LOOSE001'), used:o('B0LOOSE003'), cost:o('B0LOOSE004') };
});
console.log('   箱なし（仕入値なし）: '+JSON.stringify(sync.lo));
console.log('   箱付き（仕入値なし）: '+JSON.stringify(sync.used));
console.log('   箱なし（仕入値あり）: '+JSON.stringify(sync.cost));
ok(sync.lo.cut===true&&sync.lo.low===Math.round(9719*0.8),
   '★箱なしの Amazon基準は中古最安値×80%（¥7,775）');
ok(sync.used.cut===false&&sync.used.low===9719,
   '★箱付き中古は今までどおり中古最安値そのまま');
ok(sync.lo.weight===200&&sync.lo.flat===380,
   '★販売連携でも既定重量 200g・封筒の送料を使う');
ok(sync.lo.line===null&&sync.cost.line===null,
   '★箱なしの行では Amazon同等ライン（安売りしない下限）を使わない');
ok(sync.lo.amz===false&&sync.cost.amz===false,
   '★最低売値も同等ラインで押し上げない');
ok(sync.used.line!==null,'★箱付き中古の行は今までどおり同等ラインが出る');
ok(sync.lo.rec>0&&sync.lo.rec<sync.used.rec,
   '★箱なしの推奨売値は箱付きより安く出る（基準も送料も安いため）');
await T.done();
})();
