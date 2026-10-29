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
   price:9200, rst:'', rst_why:'', rst_link:'', rst_at:null }),
 /* 調べようとして失敗した行（6.105） */
 Object.assign({},base,{ jan:'4555555555555', mw_name:'調べられなかった商品',
   wholesale:3000, asin:'B00RSTER01', amz_name:'調べられなかった商品',
   price:9300, rst:'', rst_why:'', rst_link:'', rst_at:null,
   rst_err:'HTTP 400 InvalidInput: Invalid request parameters: sellerId is required' })];
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
    /* 可否は「Amazonで調べる」の②段（7.79）。返りは段ごとに入る。 */
    if(/\/mw\/amz/.test(url)&&i&&i.method==='POST'){
      window.__posts.push({url:url,body:b});
      const wrap=(rst,price)=>new Response(JSON.stringify({ok:true,
        left:(rst.left||0)+(price.left||0),stopped:rst.stopped||'',
        asin:{asked:0,done:0,ok_n:0,ng:0,calls:0,left:0,stopped:''},
        rst:rst,price:price}),{status:200});
      if(window.__mode==='fail')
        return wrap({asked:158,done:5,ok_n:0,approval:0,blocked:0,failed:5,
          left:153,stopped:'fail',calls:5,
          why:'失敗が5件続いたので止めました（HTTP 400 InvalidInput: '
            +'Invalid request parameters: sellerId is required）',
          fails:[{asin:'B003Y2WDAG',
            err:'HTTP 400 InvalidInput: Invalid request parameters: '
              +'sellerId is required'}]},
          {asked:0,done:0,priced:0,none:0,skipped_red:0,calls:0,left:0,stopped:''});
      if(window.__mode==='nokey')
        return wrap({asked:0,done:0,ok_n:0,approval:0,blocked:0,failed:0,
          left:0,stopped:'no_seller_id',calls:0,
          why:'出品者トークン（SP_SELLER_ID）が入っていません。pj-sync に '
            +'npx wrangler secret put SP_SELLER_ID で入れてください。',
          fails:[]},
          {asked:0,done:0,priced:0,none:0,skipped_red:0,calls:0,left:0,stopped:''});
      return wrap({asked:4,done:4,ok_n:1,approval:1,blocked:1,failed:1,
        left:7,stopped:'limit',calls:4,fails:[],why:''},
        {asked:2,done:2,priced:2,none:0,skipped_red:1,calls:1,left:0,stopped:''});
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
  switchTab('D'); roleApply(); csvRender();
},META);

console.log('=== 1つのボタンにまとまっている（6.106）===');
await setup();
await openCsvBoxes(p);
ok(await p.evaluate(()=>typeof $('csvMwAmz').onclick==='function'),
   '★★「Amazonで調べる」が結ばれている');
ok(await p.evaluate(()=>$('csvMwAmz').textContent)==='Amazonで調べる',
   '★★★ボタンは1つ「Amazonで調べる」');
ok(await p.evaluate(()=>!document.getElementById('csvMwRst')),
   '★★★「出品の可否を調べる」のボタンは消した');
ok(await p.evaluate(()=>!/実売価格を取る/.test(
     document.getElementById('csvMwAmzBox').innerHTML)),
   '★★「Amazonの実売価格を取る」のボタンも消した');

console.log('\n=== 押すと ①②③ を順に進める ===');
await p.evaluate(()=>{ $('csvMwAmz').click(); });
await p.waitForTimeout(500);
let pp=await p.evaluate(()=>window.__posts.filter((x)=>/\/mw\/amz/.test(x.url))[0]);
console.log('   送った: '+JSON.stringify(pp&&pp.body));
ok(!!pp,'★★★押すと /mw/amz を呼ぶ（1回で3段）');
ok(pp.body.kishu.indexOf('NS')>=0&&pp.body.ship_max===4&&pp.body.stock_min===5,
   '★★候補と同じ絞り込みを送る');
ok(pp.body.note_ng.indexOf('ダメージ')>=0&&pp.body.note_all===0,
   '★備考の除外も送る');
let n=await p.evaluate(()=>$('csvMwAmzNote').textContent);
console.log('   '+n.replace(/\s+/g,' '));
ok(/① ASIN引き/.test(n)&&/② 可否/.test(n)&&/③ 価格/.test(n),
   '★★★段ごとに1行ずつ出す');
ok(/緑 1/.test(n)&&/黄 1/.test(n)&&/赤 1/.test(n)&&/失敗 1/.test(n),
   '★★★可否は緑・黄・赤・失敗に分けて出す');
ok(/赤は取っていません 1件/.test(n),'★★★赤を飛ばした件数を出す');
ok(/まだ 7件/.test(n)&&/もう一度押すと続きます/.test(n),
   '★★残りと押し直しを知らせる');

console.log('\n=== 失敗の理由を出す（6.105）===');
/* 全件失敗が続いて途中で止まったとき */
await p.evaluate(()=>{ window.__mode='fail'; $('csvMwAmz').click(); });
await p.waitForTimeout(500);
let fn=await p.evaluate(()=>$('csvMwAmzNote').textContent);
console.log('   '+fn.replace(/\s+/g,' ').slice(0,200));
ok(/失敗 5/.test(fn),'★★失敗の件数を出す');
ok(/HTTP 400/.test(fn),'★★★HTTP の番号を出す');
ok(/InvalidInput/.test(fn),'★★★Amazon のエラーコードを出す');
ok(/B003Y2WDAG/.test(fn),'★★どの ASIN で失敗したか出す');
ok(/失敗が5件続いたので止めました/.test(fn),'★★★止めた理由を出す');
ok(/可否はこれ以上呼んでいません/.test(fn),'★★★むだに呼び続けないと伝える');
ok(/まだ 153件/.test(fn)===false,'★★止めた段は押し直しの件数に数えない');
ok(/もう一度押すと続きます/.test(fn)===false,
   '★★★進まないときは「もう一度押す」と出さない');
/* 出品者トークンが入っていないとき */
await p.evaluate(()=>{ window.__mode='nokey'; $('csvMwAmz').click(); });
await p.waitForTimeout(500);
let kn=await p.evaluate(()=>$('csvMwAmzNote').textContent);
console.log('   '+kn.replace(/\s+/g,' ').slice(0,160));
ok(/SP_SELLER_ID/.test(kn)&&/出品者トークン/.test(kn),
   '★★★トークンが無いことと入れ方を出す');
ok(/可否はこれ以上呼んでいません/.test(kn),'★★呼ばずに止めたと伝える');
await p.evaluate(()=>{ window.__mode=''; });

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
let erc=await card('4555555555555');
ok(/可否を調べられず/.test(erc),'★★★失敗した行は「未調査」と分ける');
ok(/HTTP 400/.test(erc)&&/InvalidInput/.test(erc),
   '★★★行にも失敗の理由（HTTP とコード）を出す');
ok(/未調査/.test(erc)===false,'★★失敗した行に「未調査」とは出さない');

console.log('\n=== 赤は「仕入れる」を付けられない ===');
let dis=await p.evaluate(()=>({
  ng:$('mwBuyChk_4333333333333').disabled,
  ngQty:$('mwBuyQty_4333333333333').disabled,
  okay:$('mwBuyChk_4111111111111').disabled,
  ap:$('mwBuyChk_4222222222222').disabled,
  un:$('mwBuyChk_4444444444444').disabled,
  er:$('mwBuyChk_4555555555555').disabled }));
console.log('   '+JSON.stringify(dis));
ok(dis.ng===true&&dis.ngQty===true,'★★★赤の行は押せない');
ok(dis.okay===false&&dis.ap===false&&dis.un===false&&dis.er===false,
   '★★緑・黄・未調査・失敗は押せる（止めるのは赤だけ）');
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
ok((await p.evaluate(()=>mwAmzPicked().length))===5,'★外せば全部出る');

await T.done();
})();
