/* 画面：MW の相場の見比べ（6.86）と写真を貼る口（6.87）
   ・候補を ①出品候補（115%以内）②相場なし ③後回し ④未調査 に分ける
   ・出品候補は「相場に対して安い順」（写真を貼る順番）
   ・写真は MW の商品IDか画像URLを改行で最大12枚。1枚目がメイン
   ・長辺500px未満は赤で「使えません」
   ・ボタンが実際に結ばれていること（v186 では結び忘れていた）
   ・出品（CSVの書き出し）はまだ無いこと */
const { harness, openCsvBoxes }=require('./lib');
const T=harness('画面：MWの相場と写真');
const ok=T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

let posts=[], mktReply=null, imgReply=null, uploads=[];
const setup=async(o)=>await p.evaluate((o)=>{
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('autoAdRate').value='6';
  $('fee').value='13.6'; $('intlFee').value='1.35'; $('feeTax').value='10';
  $('fixed').value='0.40'; $('pack').value='150'; $('shipCharge').value='15';
  $('targetMode').value='auto';
  $('syncWeightGame').value='150'; $('syncWeight').value='400';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='2';
  $('mwKishu').value='NS,NS2,P5,P4,figure,b2cchara_figure';
  $('mwNewOnly').checked=true;
  const real=window.fetch;
  window.__posts=[]; window.__uploads=[];
  $('syncApi').value='https://sync.example';
  $('syncKey').value='k';
  $('csvImgBase').value='https://img.example';
  $('csvImgToken').value='tok';
  window.fetch=async(u,i)=>{
    const url=String(u), body=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/mw\/market/.test(url)){
      window.__posts.push({url:url,body:body});
      return new Response(JSON.stringify(o.mkt||{ok:true,asked:10,done:3,hit:2,
        none:1,failed:0,left:7,calls:3,limit:3,stopped:'limit'}),{status:200});
    }
    if(/\/mw\/img/.test(url)){
      window.__posts.push({url:url,body:body});
      return new Response(JSON.stringify(o.img||{ok:true}),{status:200});
    }
    if(/\/mw\/list/.test(url)){
      window.__posts.push({url:url,body:null});
      return new Response(JSON.stringify(o.list||{ok:true,n:0,rows:[],mkt:{}}),{status:200});
    }
    if(/img\.example\/upload/.test(url)){
      window.__uploads.push({ct:(i&&i.headers&&i.headers['Content-Type'])||'',
        bytes:(i&&i.body&&i.body.size)||0});
      return new Response(JSON.stringify({url:'https://img.example/i/20261026/'
        +'1b4e28ba-2fa1-11d2-883f-0016d3cca4'+String(27+window.__uploads.length)+'.jpg'}),
        {status:200});
    }
    return real(u,i);
  };
  switchTab('D'); roleCheck(); csvRender();
},o||{});

/* 候補4件：115%以内・相場なし・115%超・未調査 */
const ROWS=[
 { jan:'4902370550467', sha:'M200', idx:0, kishu:'NS', name:'安い新品ソフト',
   cond:'新品', wholesale:3000, stock:5, ship_days:0, ship_text:'即日出荷',
   mkt_n:12, mkt_n_new:8, mkt_low:75, mkt_low_any:40, mkt_ship:0, mkt_cur:'USD',
   mkt_url:'https://www.ebay.com/itm/1', mkt_no_ship:0, mkt_err:'',
   mkt_at:'2026-10-26T01:00:00Z', pics_ok:0 },
 { jan:'4580416924740', sha:'MC02', idx:0, kishu:'figure', name:'相場が無いフィギュア',
   cond:'新品', wholesale:16082, stock:4, ship_days:4, ship_text:'3.4営業日',
   mkt_n:0, mkt_n_new:0, mkt_low:null, mkt_low_any:null, mkt_ship:null,
   mkt_no_ship:0, mkt_err:'', mkt_at:'2026-10-26T01:00:00Z', pics_ok:0 },
 { jan:'4988611224878', sha:'E027', idx:0, kishu:'NS', name:'高すぎるソフト',
   cond:'新品', wholesale:12000, stock:3, ship_days:1, ship_text:'翌営業日',
   mkt_n:5, mkt_n_new:3, mkt_low:30, mkt_low_any:25, mkt_ship:4.5, mkt_cur:'USD',
   mkt_no_ship:1, mkt_err:'', mkt_at:'2026-10-26T01:00:00Z', pics_ok:0 },
 { jan:'4970381909444', sha:'Q061', idx:0, kishu:'NS', name:'まだ調べていない',
   cond:'新品', wholesale:5000, stock:9, ship_days:2, ship_text:'2営業日',
   mkt_n:null, mkt_at:null, pics_ok:2 }];
const LIST={ ok:true, n:4, rows:ROWS, alive:900, picked:880,
  mkt:{ seen:3, hit:2, none:1, left:1, over:1.15, ttl_days:7, per_run:150 },
  last:{ at:'2026-10-26T00:00:00Z', at_jst:'2026-10-26 09:00', added:4,
         changed:0, gone:0 }, limit:500 };

console.log('=== ボタンが結ばれているか（v186 の抜け）===');
await setup({ list:LIST });
await openCsvBoxes(p);
let bound=await p.evaluate(()=>({
  load:typeof $('csvMwLoad').onclick==='function',
  mkt:typeof $('csvMwMkt').onclick==='function',
  imp:typeof $('csvMwImport').onclick==='function' }));
ok(bound.load===true,'★★「候補一覧を取り込む」が結ばれている');
ok(bound.mkt===true,'★★「eBayの相場を調べる」が結ばれている');
ok(bound.imp===true,'★「MWの在庫CSVを取り込む」が結ばれている');

console.log('\n=== 相場を調べるボタンを実際に押す ===');
await p.evaluate(()=>{ $('csvMwMkt').click(); });
await p.waitForTimeout(400);
posts=await p.evaluate(()=>window.__posts);
let mp=posts.filter((x)=>/\/mw\/market/.test(x.url))[0];
console.log('   '+JSON.stringify(mp&&mp.body));
ok(!!mp,'★★押すと /mw/market を呼ぶ');
ok(mp.body.limit===120,"★★1回に調べる件数を送る（既定120件）");
ok(mp.body.kishu.indexOf('NS')>=0&&mp.body.ship_max===4&&mp.body.stock_min===2,
   '★★一覧と同じ絞り込みを送る（画面に出る候補だけを調べる）');
let mnote=await p.evaluate(()=>$('csvMwMktNote').textContent);
console.log('   '+mnote.slice(0,120));
ok(/調べた/.test(mnote)&&/3件/.test(mnote),'★調べた件数を出す');
ok(/呼び出し/.test(mnote)&&/3回/.test(mnote),'★★eBay の呼び出し回数を出す');
ok(/まだ/.test(mnote)&&/7件/.test(mnote),'★★残りの件数と押し直しを知らせる');

console.log('\n=== 4つに分かれて出る ===');
await p.evaluate((L)=>{ mwRows=L.rows; mwMkt=L.mkt; mwListRender(); },LIST);
let txt=await p.evaluate(()=>$('csvMwList').textContent);
ok(/① 出品候補（相場の115%以内） 1件/.test(txt),'★★①出品候補（115%以内）');
ok(/② 相場なし（eBayに出品なし） 1件/.test(txt),'★★②相場なしは別に出す');
ok(/③ 後回し（相場の115%超） 1件/.test(txt),'★★③115%超は後回し（畳む）');
ok(/④ 相場 未調査 1件/.test(txt),'★★④未調査');
ok(/相場を調べ終わった 3件/.test(txt)&&/まだ 1件/.test(txt),'★進み具合を出す');

console.log('\n=== 判定の中身 ===');
let j=await p.evaluate((L)=>{
  const f=(jan)=>{ const r=L.rows.filter((x)=>x.jan===jan)[0];
    const rec=mwRec(r); const d=mwMktJudge(r,rec);
    return { k:d.k, pct:d.pct, low:d.low, lim:d.lim, mine:d.mine,
             price:rec?rec.price:null, ship:rec?rec.ship:null,
             total:rec?rec.total:null }; };
  return { a:f('4902370550467'), b:f('4580416924740'),
           c:f('4988611224878'), d:f('4970381909444') };
},LIST);
console.log('   '+JSON.stringify(j));
ok(j.a.k==='ok'&&j.a.pct<=115,'★★こちらの総額が最安値の115%以内なら出品候補');
ok(j.b.k==='nomkt','★★eBay に出品が無ければ相場なし');
ok(j.c.k==='high'&&j.c.pct>115,'★★115%を超えたら後回し');
ok(j.d.k==='none','★★調べていない行は未調査');
ok(j.a.low===75&&j.c.low===30,'★新品の最安値を使う');
/* 商品代だけで比べていたら 62.05/75＝83% で候補、総額なら 77.05/75＝103% で候補。
   どちらでも候補になる行とは別に、「商品代なら候補・総額なら後回し」の行も見る。 */
/* ここが v188 で直したところ。eBay の最安値は「本体＋送料」の総額なのに、
   priceFor が返すのは商品代（請求送料は別建て）。そろえずに比べると、
   請求送料のぶん自分を安く見せてしまう。 */
console.log('   商品代 '+j.a.price+' ＋請求送料 '+j.a.ship+' ＝ 総額 '+j.a.total);
ok(Math.abs(j.a.total-(j.a.price+j.a.ship))<0.01,
   '★★こちらの総額＝商品代＋請求送料');
ok(j.a.mine===j.a.total,
   '★★比べるのは「商品代」ではなく「総額」（相場も総額なので）');
ok(j.a.ship>0,'★この条件では請求送料が別建てになっている（そろえる意味がある）');
ok(Math.abs(j.a.pct-Math.round(j.a.total/j.a.low*100))<0.01,
   '★★%も総額どうしで出す');
ok(Math.abs(j.a.lim-Math.round(j.a.low*1.15*100)/100)<0.01,
   '★115%の金額も出す');

let edge=await p.evaluate(()=>{
  const r={ jan:'4902370550467', sha:'M200', idx:0, kishu:'NS', name:'境目の行',
    cond:'新品', wholesale:3000, stock:5, ship_days:0, mkt_n:3, mkt_n_new:3,
    mkt_low:0, mkt_low_any:null, mkt_ship:0, mkt_err:'',
    mkt_at:'2026-10-26T01:00:00Z' };
  const rec=mwRec(r);
  /* 相場を「商品代ちょうど」に置く。商品代で比べれば100%、総額なら100%超。 */
  r.mkt_low=rec.price;
  const d=mwMktJudge(r,rec);
  return { price:rec.price, ship:rec.ship, total:rec.total, low:r.mkt_low,
           k:d.k, pct:d.pct }; });
console.log('   '+JSON.stringify(edge));
ok(edge.pct>115&&edge.k==='high',
   '★★相場が商品代ちょうどの行は、請求送料のぶん115%を超えて後回しになる'
   +'（商品代で比べていたら100%で候補に見えてしまう）');

console.log('\n=== 行に出る相場の中身 ===');
ok(/eBay 最安値/.test(txt),'★最安値を出す');
ok(/送料無料/.test(txt),'★★送料0なら「送料無料」と出す');
ok(/送料 \$4\.50/.test(txt)||/送料 \$4.5/.test(txt),'★★送料があれば金額を出す');
ok(/出品 12件（新品 8）/.test(txt),'★★出品数と新品の数を出す');
ok(/送料が分からない出品が混じる/.test(txt),
   '★★送料が分からない出品が混じるときは、低めに見ていると断る');
ok(/115%＝/.test(txt),'★115%の金額を出す');
ok(/こちらの総額/.test(txt),'★★行に「こちらの総額」を出す（商品代と請求送料の内訳つき）');

console.log('\n=== 写真を貼る口（6.1 の①）===');
let box=await p.evaluate(()=>({
  ta:!!$('mwImgIn_4902370550467'), out:!!$('mwImgOut_4902370550467'),
  max:MW_IMG_MAX, min:MW_IMG_MIN }));
ok(box.ta===true&&box.out===true,'★★行ごとに貼る欄がある');
ok(box.max===12,'★★最大12枚');
ok(box.min===500,'★★長辺の下限は500px');
ok(/改行で区切って最大12枚/.test(txt)&&/1枚目がメイン/.test(txt),
   '★★改行で最大12枚・1枚目がメインと書いてある');
ok(/控え 2枚/.test(txt),'★★すでに控えがある行は枚数を出す');

console.log('\n=== 大きさだけ調べる ===');
await setup({ list:LIST, img:{ ok:true, n:3, good:2, bad:1, min_long:500, max:12,
  rows:[{ pos:0, mw_id:'10921742', w:1600, h:1200, long:1600, ok:true, err:'' },
        { pos:1, mw_id:'10921743', w:400, h:300, long:400, ok:false,
          err:'長辺 400px（500px未満なので使えません）' },
        { pos:2, mw_id:'10921744', w:600, h:900, long:900, ok:true, err:'' }] } });
await openCsvBoxes(p);
await p.evaluate((L)=>{ mwRows=L.rows; mwMkt=L.mkt; mwListRender();
  $('mwImgIn_4902370550467').value='10921742\n10921743\n10921744';
  mwImgProbe('4902370550467'); },LIST);
await p.waitForTimeout(400);
let out=await p.evaluate(()=>$('mwImgOut_4902370550467').textContent);
posts=await p.evaluate(()=>window.__posts);
let ip=posts.filter((x)=>/\/mw\/img/.test(x.url))[0];
console.log('   送った: '+JSON.stringify(ip&&ip.body));
console.log('   '+out.replace(/\s+/g,' ').slice(0,170));
ok(ip&&ip.body.probe===1,'★★「大きさだけ調べる」は probe で送る（取り込まない）');
ok(ip&&ip.body.ids.length===3&&ip.body.ids[0]==='10921742',
   '★★改行で区切って送る（1枚目が先頭）');
ok(ip&&ip.body.jan==='4902370550467','★JAN を一緒に送る');
ok(/1600/.test(out)&&/1600px/.test(out),'★★長辺を一覧に出す');
ok(/使えません/.test(out)&&/400px/.test(out),
   '★★500px未満は「使えません」と出す');
ok(/1（メイン）/.test(out),'★★1枚目をメインと出す');
ok(/まだ取り込んでいません/.test(out),'★調べただけだと分かる');
let red=await p.evaluate(()=>{
  const t=$('mwImgOut_4902370550467').querySelectorAll('td');
  let n=0; t.forEach((x)=>{ if(/var\(--bad\)/.test(x.getAttribute('style')||''))n++; });
  return n; });
ok(red>=1,'★★使えない行は赤で出す');

console.log('\n=== 取り込む（pj-img に控える）===');
const B64=await p.evaluate(()=>{
  /* 小さな JPEG の形を作って base64 にする */
  const a=new Uint8Array([0xff,0xd8,0xff,0xc0,0,0x11,8,4,0xb0,6,0x40,3,1,
    0x11,0,2,0x11,1,3,0x11,1,0x5a,0x5a]);
  let s=''; for(let i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);
  return btoa(s); });
await setup({ list:LIST, img:{ ok:true, n:2, good:2, bad:0, min_long:500, max:12,
  rows:[{ pos:0, mw_id:'10921742', w:1600, h:1200, long:1600, ok:true, err:'',
          ct:'image/jpeg', b64:B64 },
        { pos:1, mw_id:'10921744', w:900, h:600, long:900, ok:true, err:'',
          ct:'image/jpeg', b64:B64 }] } });
await openCsvBoxes(p);
await p.evaluate((L)=>{ mwRows=L.rows; mwMkt=L.mkt; mwListRender();
  $('mwImgIn_4902370550467').value='10921742\n10921744';
  mwImgTake('4902370550467'); },LIST);
await p.waitForTimeout(700);
out=await p.evaluate(()=>$('mwImgOut_4902370550467').textContent);
uploads=await p.evaluate(()=>window.__uploads);
posts=await p.evaluate(()=>window.__posts);
console.log('   上げた枚数: '+uploads.length+'　'+JSON.stringify(uploads));
console.log('   '+out.replace(/\s+/g,' ').slice(0,150));
ok(uploads.length===2,'★★使える画像を pj-img（今までの口）に上げる');
ok(uploads.every((x)=>/image\/jpeg/.test(x.ct)),'★形式をそのまま渡す');
ok(uploads.every((x)=>x.bytes>0),'★中身が入っている');
let saved=posts.filter((x)=>/\/mw\/img/.test(x.url)&&x.body&&x.body.saved)[0];
console.log('   控えた: '+JSON.stringify(saved&&saved.body.saved));
ok(!!saved,'★★上げ終わった公開URLを pj-sync に控える（二度は取りに行かない）');
ok(saved.body.saved.length===2&&saved.body.saved[0].pos===0,
   '★★1枚目を pos=0（メイン）で控える');
ok(/2枚.*控えました/.test(out.replace(/\s+/g,'')) || /2枚/.test(out),'★控えた枚数を出す');
ok(/メイン/.test(out),'★メインがどれか出す');
ok(/まだ作っていません/.test(out),
   '★★出品（CSVの書き出し）はまだ無いと断る');

console.log('\n=== 出品はしない ===');
let noList=await p.evaluate(()=>{
  const t=$('csvMwList').innerHTML;
  return { push:/出品する|出品リストに入れる|書き出す/.test(t),
    api:typeof window.mwListPush };
});
ok(noList.push===false,'★★一覧に「出品する」ボタンは無い');
ok(noList.api==='undefined','★★出品の処理そのものが無い');

console.log('\n=== 画像サーバーの設定が無いとき ===');
await setup({ list:LIST });
await openCsvBoxes(p);
await p.evaluate((L)=>{ mwRows=L.rows; mwMkt=L.mkt; mwListRender();
  $('csvImgBase').value=''; $('csvImgToken').value='';
  $('mwImgIn_4902370550467').value='10921742';
  mwImgTake('4902370550467'); },LIST);
await p.waitForTimeout(300);
out=await p.evaluate(()=>$('mwImgOut_4902370550467').textContent);
ok(/画像サーバーURL/.test(out),'★★設定が無いときは理由を出して送らない');
posts=await p.evaluate(()=>window.__posts);
ok(posts.filter((x)=>/\/mw\/img/.test(x.url)).length===0,'★★送っていない');

await T.done();
})();
