/* 画面：国内FBA の出品の可否（6.101）
   ・各行に 緑（出せる）／黄（許可が要る・申請リンク）／赤（出せない）／灰（未調査）
   ・赤の行は「仕入れる」を付けられない（見た目も保存も止める）
   ・「出品の可否を調べる」で /mw/restrict を候補と同じ絞り込みで呼ぶ
   ・「出品できる行だけ」の絞り込み */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：出品の可否');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const base={ sha:'M200', kishu:'NS', cond:'新品', stock:9, note:'',
  ship_text:'即日出荷', ship_days:0, basis:'カート', new_n:4, low_n:1,
  amz:0, fba_n:3, amz_err:'', amz_at:'2026-10-27T01:00:00Z', rank:649,
  rank_cat:'ゲーム', list_price:9800 };
const ROWS=[
 Object.assign({},base,{ jan:'4111111111111', mw_name:'出せる商品',
   wholesale:3000, asin:'B00RSTOK01', amz_name:'出せる商品', price:9000,
   rst:'ok', rst_why:'', rst_link:'', rst_at:'2026-10-27T01:00:00Z' }),
 Object.assign({},base,{ jan:'4222222222222', mw_name:'許可が要る商品',
   wholesale:3000, asin:'B00RSTAP01', amz_name:'許可が要る商品', price:9500,
   rst:'approval', rst_why:'この商品を出品するには承認が必要です',
   rst_link:'https://sellercentral.amazon.co.jp/apply/1',
   rst_at:'2026-10-27T01:00:00Z' }),
 Object.assign({},base,{ jan:'4333333333333', mw_name:'出せない商品',
   wholesale:3000, asin:'B00RSTNG01', amz_name:'出せない商品', price:12000,
   rst:'blocked', rst_why:'この商品は出品できません', rst_link:'',
   rst_at:'2026-10-27T01:00:00Z' }),
 Object.assign({},base,{ jan:'4444444444444', mw_name:'まだ調べていない商品',
   wholesale:3000, asin:'B00RSTUN01', amz_name:'まだ調べていない商品',
   price:9200, rst:'', rst_why:'', rst_link:'', rst_at:null })];
const META={ ok:true, n:4, rows:ROWS, seen:4, priced:4, left:0, per_run:120,
  ttl_days:3, limit:3000 };

const setup=async()=>await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='5';
  $('mwKishu').value='NS,NS2,P5'; $('mwNewOnly').checked=true;
  $('mwNoteAll').checked=false; $('mwNoteNg').value='ダメージ,訳あり';
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  window.__posts=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/mw\/restrict/.test(url)){
      window.__posts.push({url:url,body:b});
      return new Response(JSON.stringify({ok:true,asked:4,done:4,ok_n:1,
        approval:1,blocked:1,failed:1,left:7}),{status:200});
    }
    if(/\/mw\/buy/.test(url)){
      window.__posts.push({url:url,body:b});
      if(i&&i.method==='POST')
        return new Response(JSON.stringify({ok:true}),{status:200});
      return new Response(JSON.stringify({ok:true,rows:[],n:0}),{status:200});
    }
    if(/\/mw\/amz/.test(url))
      return new Response(JSON.stringify(META),{status:200});
    return real(u,i);
  };
  switchTab('D'); roleApply('admin'); csvRender();
},META);

console.log('=== ボタンが結ばれているか ===');
await setup();
await openCsvBoxes(p);
ok(await p.evaluate(()=>typeof $('csvMwRst').onclick==='function'),
   '★★「出品の可否を調べる」が結ばれている');

console.log('\n=== 押すと /mw/restrict を呼ぶ ===');
await p.evaluate(()=>{ $('csvMwRst').click(); });
await p.waitForTimeout(500);
let pp=await p.evaluate(()=>window.__posts.filter((x)=>/restrict/.test(x.url))[0]);
console.log('   送った: '+JSON.stringify(pp&&pp.body));
ok(!!pp,'★★★押すと /mw/restrict を呼ぶ');
ok(pp.body.kishu.indexOf('NS')>=0&&pp.body.ship_max===4&&pp.body.stock_min===5,
   '★★候補と同じ絞り込みを送る');
ok(pp.body.note_ng.indexOf('ダメージ')>=0&&pp.body.note_all===0,
   '★備考の除外も送る');
let n=await p.evaluate(()=>$('csvMwRstNote').textContent);
console.log('   '+n.replace(/\s+/g,' '));
ok(/出せる 1/.test(n)&&/許可が要る 1/.test(n)&&/出せない 1/.test(n),
   '★★3つに分けた件数を出す');
ok(/まだ 7件/.test(n),'★★残りと押し直しを知らせる');

console.log('\n=== 行の色（緑・黄・赤・灰）===');
await p.evaluate((R)=>{ mwAmzRows=R; mwAmzMeta={n:4,seen:4,priced:4,left:0};
  mwBuyMap={}; mwAmzRender(); },ROWS);
await p.waitForTimeout(120);
const card=async(jan)=>await p.evaluate((jan)=>{
  const box=document.getElementById('mwBuyChk_'+jan);
  let el=box; while(el&&!/^mwBuyChk_/.test(''))el=el.parentElement;
  el=box?box.closest('div[style*="border"]'):null;
  return el?el.outerHTML:'';
},jan);
let okc=await card('4111111111111');
ok(/出品できる/.test(okc),'★★★緑の行に「出品できる」');
let apc=await card('4222222222222');
ok(/許可が要る/.test(apc),'★★★黄の行に「許可が要る」');
ok(/承認が必要/.test(apc),'★理由も出す');
ok(/sellercentral\.amazon\.co\.jp\/apply\/1/.test(apc)&&/申請ページを開く/.test(apc),
   '★★★申請リンクを出す');
let ngc=await card('4333333333333');
ok(/出品できない/.test(ngc),'★★★赤の行に「出品できない」');
let unc=await card('4444444444444');
ok(/未調査/.test(unc),'★★調べていない行は「未調査」');

console.log('\n=== 赤は「仕入れる」を付けられない ===');
let dis=await p.evaluate(()=>({
  ng:$('mwBuyChk_4333333333333').disabled,
  ngQty:$('mwBuyQty_4333333333333').disabled,
  okay:$('mwBuyChk_4111111111111').disabled,
  ap:$('mwBuyChk_4222222222222').disabled,
  un:$('mwBuyChk_4444444444444').disabled }));
console.log('   '+JSON.stringify(dis));
ok(dis.ng===true&&dis.ngQty===true,'★★★赤の行は押せない');
ok(dis.okay===false&&dis.ap===false&&dis.un===false,
   '★★緑・黄・未調査は押せる');
/* 画面を書き換えても保存されないこと（保存側でも止める） */
await p.evaluate(()=>{ window.__posts=[]; mwBuySet('4333333333333',3); });
await p.waitForTimeout(300);
let buy=await p.evaluate(()=>window.__posts.filter((x)=>/\/mw\/buy/.test(x.url)
  &&x.body&&x.body.qty>0));
ok(buy.length===0,'★★★赤の行は保存もしない');
ok(/出品できない/.test(await p.evaluate(()=>$('csvMwAmzListNote').textContent)),
   '★★理由を画面に出す');
await p.evaluate(()=>{ window.__posts=[]; mwBuySet('4111111111111',2); });
await p.waitForTimeout(300);
let buy2=await p.evaluate(()=>window.__posts.filter((x)=>/\/mw\/buy/.test(x.url)
  &&x.body&&x.body.qty===2));
ok(buy2.length===1,'★★緑の行はこれまでどおり保存できる');

console.log('\n=== 絞り込み「出品できる行だけ」===');
await p.evaluate((R)=>{ mwAmzRows=R; mwBuyMap={};
  $('csvMwAmzWin').checked=false; $('csvMwAmzRstOk').checked=true;
  mwAmzRender(); },ROWS);
await p.waitForTimeout(120);
let left=await p.evaluate(()=>mwAmzPicked().map((x)=>String(x.r.jan)));
console.log('   '+JSON.stringify(left));
ok(left.length===1&&left[0]==='4111111111111',
   '★★★出せる行だけ残る（未調査も隠す）');
await p.evaluate(()=>{ $('csvMwAmzRstOk').checked=false; mwAmzRender(); });
await p.waitForTimeout(120);
ok((await p.evaluate(()=>mwAmzPicked().length))===4,'★外せば全部出る');

await T.done();
})();
