/* 画面：Amazon 登録用ファイル（6.103）
   ・せどりすと のアップロード用ファイルと同じ形（実物から合わせた）
     1行目 TemplateType=Offer / Version=2020.000、2行目 日本語名、3行目 機械名、31列
     UTF-8（BOM なし）・改行 LF・区切りはタブ
   ・FBA なので 在庫数は空、fulfillment-center-id は AMAZON_JP
   ・MW は新品のみなので condition-type は 11、説明文は新品の定型
   ・SKU は mwgame／mwhobby-仕入日-N-ASIN-仕入値
   ・出品できる（緑）行だけ入れる。それ以外は理由つきで外す
   ・作ったら /mw/reg に 仕入れ元・社・JAN・仕入値を控える */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：Amazon登録用ファイル');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const base={ cond:'新品', stock:9, note:'', ship_text:'即日出荷', ship_days:0,
  basis:'カート', new_n:4, amz:0, rank:649, rank_cat:'ゲーム', list_price:9800,
  gone_at:null, qty:1, rst:'ok', rst_why:'', rst_link:'',
  rst_at:'2026-10-27T01:00:00Z' };
const BUY=[
 Object.assign({},base,{ jan:'4111111111111', sha:'M200', kishu:'NS',
   mw_name:'ゲームの商品', amz_name:'ゲームの商品（Amazonの名前）',
   wholesale:3000, asin:'B00RSTOK01', price:9000, qty:2 }),
 Object.assign({},base,{ jan:'4222222222222', sha:'MC02', kishu:'figure',
   mw_name:'フィギュアの商品', amz_name:'フィギュアの商品（Amazonの名前）',
   wholesale:5000, asin:'B00RSTOK02', price:14000 }),
 /* 外れる行 */
 Object.assign({},base,{ jan:'4333333333333', sha:'M200', kishu:'NS',
   mw_name:'許可が要る商品', amz_name:'許可が要る商品', wholesale:3000,
   asin:'B00RSTAP01', price:9000, rst:'approval',
   rst_link:'https://sellercentral.amazon.co.jp/apply/1' }),
 Object.assign({},base,{ jan:'4444444444444', sha:'M200', kishu:'NS',
   mw_name:'出せない商品', amz_name:'出せない商品', wholesale:3000,
   asin:'B00RSTNG01', price:9000, rst:'blocked' }),
 Object.assign({},base,{ jan:'4555555555555', sha:'M200', kishu:'NS',
   mw_name:'未調査の商品', amz_name:'未調査の商品', wholesale:3000,
   asin:'B00RSTUN01', price:9000, rst:'' }),
 Object.assign({},base,{ jan:'4666666666666', sha:'M200', kishu:'NS',
   mw_name:'ASINが無い商品', amz_name:'', wholesale:3000, asin:'',
   price:0 }),
 Object.assign({},base,{ jan:'4777777777777', sha:'M200', kishu:'NS',
   mw_name:'MWで欠品した商品', amz_name:'欠品', wholesale:3000,
   asin:'B00RSTGN01', price:9000, gone_at:'2026-10-26T00:00:00Z' })];

const setup=async()=>await p.evaluate((BUY)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='5';
  $('mwKishu').value='NS,figure'; $('mwNewOnly').checked=true;
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  window.__posts=[]; window.__dl=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/mw\/reg/.test(url)){
      window.__posts.push({url:url,body:b});
      return new Response(JSON.stringify({ok:true,saved:(b.rows||[]).length,
        skipped:0}),{status:200});
    }
    if(/\/mw\/buy/.test(url))
      return new Response(JSON.stringify({ok:true,rows:BUY,n:BUY.length,
        qty:8,yen:30000,gone:1}),{status:200});
    if(/\/mw\/amz/.test(url))
      return new Response(JSON.stringify({ok:true,n:0,rows:[],seen:0,priced:0,
        left:0,per_run:120}),{status:200});
    return real(u,i);
  };
  /* バイト列で控える（BOM の有無を見るため）。 */
  window.csvDownloadBlob=function(name,blob){
    return blob.arrayBuffer().then(function(ab){
      const u=new Uint8Array(ab);
      window.__dl.push({ name:name, type:blob.type,
        text:new TextDecoder('utf-8').decode(u),
        bom:(u[0]===0xEF&&u[1]===0xBB&&u[2]===0xBF),
        crlf:Array.prototype.some.call(u,function(c,i){
          return c===0x0D&&u[i+1]===0x0A; }) });
    });
  };
  switchTab('D'); roleApply(); csvRender();
},BUY);

console.log('=== ボタンが結ばれているか ===');
await setup();
await openCsvBoxes(p);
ok(await p.evaluate(()=>typeof $('csvMwReg').onclick==='function'),
   '★★「Amazon登録用ファイルを作る」が結ばれている');

console.log('\n=== SKU の形 ===');
let sk=await p.evaluate((BUY)=>({
  game:mwRegSku(BUY[0],'20261026'), fig:mwRegSku(BUY[1],'20261026'),
  cost:mwCost(BUY[0]) }),BUY);
console.log('   '+JSON.stringify(sk));
ok(sk.game==='mwgame-20261026-N-B00RSTOK01-3476','★★★ゲームは mwgame');
ok(sk.fig==='mwhobby-20261026-N-B00RSTOK02-5676','★★★それ以外は mwhobby');
ok(sk.cost===3476,'★仕入値は 卸値×1.1＋仕入送料（3000×1.1＝3300＋176）');
ok(sk.game.length<=40&&sk.fig.length<=40,'★★Amazon の40文字に収まる');

console.log('\n=== 出品できる行だけ ===');
let pk=await p.evaluate((BUY)=>{ const z=mwRegPick(BUY);
  return { take:z.take.map((r)=>r.jan), skip:z.skip.map((x)=>[x.r.jan,x.why]) }; },BUY);
console.log('   取る: '+JSON.stringify(pk.take));
pk.skip.forEach((x)=>console.log('   外す: '+x[0]+' '+x[1]));
ok(pk.take.length===2&&pk.take[0]==='4111111111111','★★★緑の2件だけ取る');
ok(/許可/.test(pk.skip.filter((x)=>x[0]==='4333333333333')[0][1]),
   '★★★黄は外す（申請してから）');
ok(/出品できません/.test(pk.skip.filter((x)=>x[0]==='4444444444444')[0][1]),
   '★★★赤は外す');
ok(/調べていません/.test(pk.skip.filter((x)=>x[0]==='4555555555555')[0][1]),
   '★★未調査は外す');
ok(/ASIN/.test(pk.skip.filter((x)=>x[0]==='4666666666666')[0][1]),
   '★★ASIN が無い行は外す');
ok(/欠品/.test(pk.skip.filter((x)=>x[0]==='4777777777777')[0][1]),
   '★★★MW で欠品した行は外す');

console.log('\n=== ファイルの形（せどりすと の実物と同じ）===');
await p.evaluate(()=>{ $('csvMwReg').click(); });
await p.waitForTimeout(700);
let dl=await p.evaluate(()=>window.__dl[0]);
ok(!!dl,'★★押すとファイルを書き出す');
console.log('   '+dl.name+' BOM='+dl.bom+' CRLF='+dl.crlf);
ok(/^amazon_offer_\d{8}\.txt$/.test(dl.name),'★★名前は amazon_offer_日付.txt');
ok(dl.bom===false,'★★★BOM は付けない（実物に無い）');
ok(dl.crlf===false,'★★★改行は LF（実物と同じ）');
let L=dl.text.split('\n');
console.log('   1行目: '+L[0]);
ok(L[0]==='TemplateType=Offer\tVersion=2020.000','★★★1行目');
ok(L[1].split('\t').length===31,'★★★2行目は日本語の列名31列');
ok(L[1].split('\t')[0]==='商品管理番号'&&L[1].split('\t')[30]==='危険物該当の該否',
   '★★日本語の列名');
let H=L[2].split('\t');
ok(H.length===31,'★★★3行目は機械の列名31列');
ok(H[0]==='sku'&&H[1]==='price'&&H[3]==='quantity'
   &&H[30]==='supplier_declared_dg_hz_regulation1','★★★機械の列名');
ok(L.length===3+2+1&&L[L.length-1]==='','★★中身は2行（最後に改行）');
let c=L[3].split('\t'), at=(k)=>c[H.indexOf(k)];
console.log('   sku='+at('sku')+' price='+at('price')+' qty='+JSON.stringify(at('quantity'))
  +' cond='+at('condition-type')+' fc='+at('fulfillment-center-id'));
ok(c.length===31,'★★★中身も31列');
ok(/^mwgame-\d{8}-N-B00RSTOK01-3476$/.test(at('sku')),'★★★SKU が入る');
ok(at('price')==='9000','★★★販売価格は Amazon の実売価格');
ok(at('quantity')==='','★★★在庫数は空（FBA）');
ok(at('product-id')==='B00RSTOK01'&&at('product-id-type')==='ASIN',
   '★★★商品コードは ASIN');
ok(at('condition-type')==='11','★★★コンディションは 11（新品）');
ok(/★国内正規品★迅速発送★/.test(at('condition-note'))
   &&at('condition-note').length===114,'★★★新品の説明文（実物と同じ114字）');
ok(at('fulfillment-center-id')==='AMAZON_JP','★★★AMAZON_JP');
ok(at('item_name')==='ゲームの商品（Amazonの名前）','★★商品名は Amazon の名前');
ok(at('batteries_required')==='false'&&at('supplier_declared_dg_hz_regulation1')==='該当なし',
   '★★電池・危険物の欄');
ok(at('standard-price-points-percent')==='0','★ポイントは 0');
ok(at('ASIN-hint')===''&&at('title')===''&&at('operation-type')===''
   &&at('main-offer-image')==='','★★使わない列は空');
let c2=L[4].split('\t');
ok(/^mwhobby-/.test(c2[0]),'★★2行目はフィギュア（mwhobby）');

console.log('\n=== 書き出したら D1 に控える ===');
let pp=await p.evaluate(()=>window.__posts.filter((x)=>/\/mw\/reg/.test(x.url))[0]);
console.log('   '+JSON.stringify(pp&&pp.body).slice(0,220));
ok(!!pp,'★★★/mw/reg に送る');
ok(pp.body.rows.length===2,'★★出した2件だけ送る');
let one=pp.body.rows[0];
ok(one.jan==='4111111111111'&&one.sha==='M200'&&one.cost_src===3476,
   '★★★JAN・社・仕入値を送る');
ok(/^mwgame-/.test(one.sku),'★★SKU も送る');
let n=await p.evaluate(()=>$('csvMwRegNote').textContent);
console.log('   '+n.replace(/\s+/g,' ').slice(0,180));
ok(/2件/.test(n)&&/amazon_offer_/.test(n),'★★件数とファイル名を出す');
ok(/外した 5件/.test(n),'★★★外した件数と理由を出す');
ok(/D1 に控えました/.test(n),'★控えたことも出す');

console.log('\n=== タブと改行は列を崩さない ===');
let cell=await p.evaluate(()=>mwRegCell('あ\tい\nう\r\nえ'));
ok(cell==='あ い う え','★★★タブ・改行は空白に直す');

await T.done();
})();
