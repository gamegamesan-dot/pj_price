/* 画面：MW の写真をページ単位（100件）で取り込む（6.156〜6.159・【F】）
   F1 ブックマークレットは一覧（100件）でも動く（tests/mwpic.js で確かめている）
   F2 貼ったうちで取り込むのは
      ① 出品候補（相場の115%以内）／② 相場なし／「仕入れる」の印
      だけ。③後回し・④未調査は捨てる。すでに写真がある JAN は上書きしない。
      結果に「取り込んだ n件／候補外 m件／すでに写真あり k件／失敗 j件」
   F3 取り込んだ分をサムネイル（10件ずつ・さらに10件）で出し、
      商品名と JAN を添えて、タップで外せる（その JAN は写真なしに戻る）
   F4 自動の巡回・ページ送りはしない
   あわせて：無在庫（eBay）の候補一覧に検索欄（商品名・JAN・社）
             ⚙「手数料を1件ためす」の FBA に在庫管理の目安を足す */
const { harness, openCsvBoxes, clickCfg } = require('./lib');
const T = harness('画面：MW の写真をページ単位で取り込む（6.156）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], cancel=false;
p.on('dialog',async d=>{ dlg.push(d.message());
  if(cancel)await d.dismiss(); else await d.accept(); });

/* MW の候補（無在庫 eBay 用）。①〜④がそろう形にする。 */
const mw=(jan,x)=>Object.assign({ jan:jan, sha:'M200', kishu:'NS2',
  name:'商品'+jan.slice(-3), cond:'新品', wholesale:3000, stock:9,
  ship_text:'即日出荷', ship_days:0, list_price:7678, note:'',
  pics_ok:0, pics_n:0, pics_long:0, pics_main:'',
  mkt_at:'2026-11-01T00:00:00Z', mkt_n:3, mkt_low:200, mkt_err:'' },x||{});
/* ① 相場の115%以内（相場が高い）／② 相場なし／③ 115%超（相場が安い）／④ 未調査 */
const MWROWS=[
  mw('4902370550001',{ name:'ゼルダ①', mkt_low:300 }),
  mw('4902370550002',{ name:'マリオ②', mkt_n:0, mkt_low:null }),
  mw('4902370550003',{ name:'カービィ③', mkt_low:20 }),
  mw('4902370550004',{ name:'ピクミン④', mkt_at:null, mkt_n:0, mkt_low:null }),
  mw('4902370550005',{ name:'スプラ①写真あり', mkt_low:300, pics_ok:2, pics_n:2 }),
];
/* 刈取（Amazon FBA）の候補。印が付くのは1件だけ。 */
const AMZROWS=[
  { jan:'4902370550101', sha:'M300', kishu:'NS2', mw_name:'刈取・印あり',
    amz_name:'刈取・印あり NS2', wholesale:3000, stock:9, ship_days:0,
    ship_text:'即日', asin:'B0AMZ00001', price:6500, basis:'カート', new_n:4,
    amz:0, rst:'ok', cond:'新品', list_price:7678, rank:1200, rank_cat:'ゲーム',
    pics_ok:0, pics_n:0, size_tier:'m' },
  { jan:'4902370550102', sha:'M300', kishu:'NS2', mw_name:'刈取・印なし',
    amz_name:'刈取・印なし NS2', wholesale:3000, stock:9, ship_days:0,
    ship_text:'即日', asin:'B0AMZ00002', price:6500, basis:'カート', new_n:4,
    amz:0, rst:'ok', cond:'新品', list_price:7678, rank:1200, rank_cat:'ゲーム',
    pics_ok:0, pics_n:0, size_tier:'m' },
];
const BUY={ ok:true, n:1, qty:1, yen:3476, gone:0,
  rows:[{ jan:'4902370550101', qty:1, sha:'M300', mw_name:'刈取・印あり',
    amz_name:'刈取・印あり NS2', wholesale:3000, asin:'B0AMZ00001',
    price:6500, rst:'ok', cand_n:1, kishu:'NS2', cond:'新品', stock:9,
    ship_days:0, gone_at:null }] };

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('csvImgBase').value='https://img.example'; $('csvImgToken').value='t';
  $('mwShipFee').value='176'; $('fx').value='160'; $('baseProfit').value='1000';
  $('linkRate').value='30'; $('shipCharge').value='15.00';
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  $('mwFbaShipM').value='425'; $('mwFbaStoreM').value='16';
  $('mwFbaSizeHobby').value='m'; $('mwFbaSizeGame').value='m';
  $('mwUnder').value='97';
  window.__img=[]; window.__up=0; window.__del=[]; window.__fee=null;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')
      ?JSON.parse(i.body):null;
    const res=(x,st)=>new Response(JSON.stringify(x),{status:st||200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/mw\/img\/del/.test(url)){ window.__del.push(b);
      return res(o.delNg?{ok:false,error:'だめ'}:{ok:true,jan:b.jan,n:2}); }
    if(/\/mw\/img/.test(url)&&i&&i.method==='POST'){
      window.__img.push(b);
      if(b.saved)return res({ok:true,n:b.saved.length});
      return res({ ok:true, jan:b.jan, n:(b.ids||[]).length,
        good:(b.ids||[]).length, bad:0,
        rows:(b.ids||[]).map((id,k)=>({ pos:k, mw_id:String(id), w:1200,
          h:1200, long:1200, bytes:50000, ct:'image/jpeg', ok:true, err:'',
          b64:'AAAA' })) });
    }
    if(/\/upload/.test(url)){ window.__up++;
      return res({ok:true,url:'https://img.example/i/20261109/'
        +'00000000-0000-4000-8000-0000000000'+String(10+window.__up)+'.jpg'}); }
    if(/\/mw\/fee\/test/.test(url)){ window.__fee=url;
      return res(o.fee||{ ok:true, asin:'B0AMZ00001', price:6500, http:200,
        err:'', sent:[], got_n:1, got:[],
        size:{ tier:'m', cm3:1000, long:20, g:300 },
        pick:{ ok:true, ref:975, tax:97, fba:425, total:1497 } }); }
    if(/\/mw\/buy/.test(url)){
      if(i&&i.method==='POST')return res({ok:true});
      return res(o.buy||{ok:true,rows:[],n:0});
    }
    if(/\/mw\/list/.test(url))
      return res({ ok:true, n:o.mw.length, rows:o.mw, seen:o.mw.length,
        priced:o.mw.length, left:0, limit:3000 });
    if(/\/mw\/amz/.test(url))
      return res({ ok:true, n:o.amz.length, rows:o.amz, seen:o.amz.length,
        priced:o.amz.length, left:0, per_run:120, ttl_days:3, limit:3000 });
    return real(u,i);
  };
  syncRole=o.role||'admin'; roleApply();
  switchTab('F');
},Object.assign({ mw:MWROWS, amz:AMZROWS, buy:BUY },o||{}));

const load=async()=>{
  /* 無在庫（eBay）の候補と、刈取の一覧・印をぜんぶ読む。 */
  await p.evaluate(()=>{ $('csvMwLoad').click(); });
  await p.waitForTimeout(400);
  await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
  await p.waitForTimeout(400);
  await p.evaluate(()=>mwBuyLoad(true));
  await p.waitForTimeout(300);
};

console.log('=== F2：取り込む相手の決め方（mwPicCand）===');
await setup({});
await openCsvBoxes(p);
await load();
let c=await p.evaluate(()=>{
  const g=mwPicCand();
  return { ok:Object.keys(g.ok).sort(), has:Object.keys(g.has).sort(),
    buy:Object.keys(g.buy).sort(), n:g.n,
    name:g.name['4902370550001']||'' };
});
console.log('   '+JSON.stringify(c));
ok(c.ok.indexOf('4902370550001')>=0,'★★★① 出品候補（115%以内）は対象');
ok(c.ok.indexOf('4902370550002')>=0,'★★★② 相場なしも対象');
ok(c.ok.indexOf('4902370550003')<0,'★★★③ 後回し（115%超）は捨てる');
ok(c.ok.indexOf('4902370550004')<0,'★★★④ 未調査は捨てる');
ok(c.ok.indexOf('4902370550101')>=0,
   '★★★刈取の「仕入れる」の印が付いた JAN も対象（届いたあと eBay にも出せる）');
ok(c.ok.indexOf('4902370550102')<0,'★★★印が付いていない刈取の行は捨てる');
ok(c.buy.indexOf('4902370550101')>=0,'★★印が付いている JAN が分かる');
ok(c.has.indexOf('4902370550005')>=0,'★★★すでに写真がある JAN が分かる');
ok(c.name==='ゼルダ①','★★商品名も引ける（サムネイルに添える）');

console.log('\n=== F2：3つに分ける（mwPicSplit）===');
let sp=await p.evaluate(()=>{
  const g=mwPicRead([
    '4902370550001:10900001',        // ① 取り込む
    '4902370550002:10900002',        // ② 取り込む
    '4902370550003:10900003',        // ③ 候補外
    '4902370550004:10900004',        // ④ 候補外
    '4902370550005:10900005',        // すでに写真あり
    '4902370550101:10900006',        // 印あり → 取り込む
    '4902370550102:10900007',        // 印なし → 候補外
    '4900000000099:10900008' ].join('\n'));   // 候補にも無い
  const s=mwPicSplit(g);
  return { take:s.take.map((x)=>x.jan), out:s.out.map((x)=>x.jan),
    already:s.already.map((x)=>x.jan), cand:s.cand };
});
console.log('   '+JSON.stringify(sp));
ok(JSON.stringify(sp.take)==='["4902370550001","4902370550002","4902370550101"]',
   '★★★取り込むのは ①・②・印ありだけ');
ok(sp.out.length===4,'★★★候補外は4件（③・④・印なし・候補に無い）');
ok(JSON.stringify(sp.already)==='["4902370550005"]',
   '★★★すでに写真がある JAN は触らない（上書きしない）');
ok(sp.cand>0,'★候補が読めている');

console.log('\n=== F2：貼ったときの知らせ ===');
let note=await p.evaluate(()=>{
  $('mwPicPasteBox').open=true;
  $('mwPicIn').value=[
    '4902370550001:10900001','4902370550003:10900003',
    '4902370550005:10900005'].join('\n');
  $('mwPicIn').dispatchEvent(new Event('input',{bubbles:true}));
  return ($('mwPicInNote').innerText||'').replace(/\s+/g,' ');
});
console.log('   '+note);
ok(/取り込む 1件/.test(note),'★★取り込む件数');
ok(/候補外 1件/.test(note),'★★★「候補外」と書く');
ok(/すでに写真あり 1件/.test(note),'★★すでに写真ありの件数');
ok(/① 出品候補（相場の115%以内）・② 相場なし・「仕入れる」の印/.test(note),
   '★★★何を取り込むのかを書く');
ok(/③後回し・④未調査は捨てます/.test(note),'★★捨てるものも書く');

console.log('\n=== F2：結果の4つの件数 ===');
await p.evaluate(()=>{
  window.__img=[]; window.__up=0;
  $('mwPicIn').value=[
    '4902370550001:10900001',   // 取り込む
    '4902370550002:10900002',   // 取り込む
    '4902370550003:10900003',   // 候補外
    '4902370550004:10900004',   // 候補外
    '4902370550005:10900005'].join('\n');   // すでに写真あり
  $('mwPicIn').dispatchEvent(new Event('input',{bubbles:true}));
});
await p.waitForTimeout(150);
await p.evaluate(()=>{ $('mwPicTake').click(); });
await p.waitForFunction(()=>/取り込んだ/.test($('mwPicInNote').innerText||''),
  {timeout:9000});
let res=await p.evaluate(()=>({
  note:($('mwPicInNote').innerText||'').replace(/\s+/g,' '),
  jans:window.__img.filter((b)=>!b.saved).map((b)=>b.jan) }));
console.log('   '+JSON.stringify(res));
ok(/取り込んだ 2件/.test(res.note),'★★★「取り込んだ n件」');
ok(/候補外 2件/.test(res.note),'★★★「候補外 m件」');
ok(/すでに写真あり 1件/.test(res.note),'★★★「すでに写真あり k件」');
ok(/失敗 0件/.test(res.note),'★★★「失敗 j件」');
ok(JSON.stringify(res.jans)==='["4902370550001","4902370550002"]',
   '★★★MW に取りに行くのは取り込む2件だけ（候補外は捨てる）');

console.log('\n=== F3：サムネイルの一覧 ===');
let sh=await p.evaluate(()=>({
  html:$('mwPicShots').innerHTML,
  txt:($('mwPicShots').innerText||'').replace(/\s+/g,' ') }));
console.log('   '+sh.txt.slice(0,200));
ok(/取り込んだ写真 2件/.test(sh.txt),'★★★取り込んだ分をサムネイルで出す');
ok((sh.html.match(/<img /g)||[]).length===2,'★★★写真を2枚出す');
ok(/ゼルダ①/.test(sh.txt)&&/マリオ②/.test(sh.txt),
   '★★★商品名を添える（写真と見比べられる）');
ok(/JAN 4902370550001/.test(sh.txt),'★★★JAN も添える');
ok(/img\.example\/i\//.test(sh.html),'★上げた写真を出す');
ok(/data-picdel="4902370550001"/.test(sh.html),
   '★★★タップで外せるボタンがある');
ok(/違う写真（外す）/.test(sh.txt),'★★そう書いてある');
/* 10件ずつ（さらに10件）。 */
let many=await p.evaluate(()=>{
  mwPicShots=[];
  for(var i=0;i<14;i++)
    mwPicShots.push({ jan:'490000000'+String(1000+i), name:'商品'+i,
      url:'https://img.example/i/20261109/x'+i+'.jpg', n:1 });
  listSet('mwpicshot',10);
  mwPicShotRender();
  const el=$('mwPicShots');
  const cells=el.querySelectorAll('[data-picdel]');
  let shown=0;
  Array.prototype.forEach.call(cells,function(b){
    if(b.parentElement.style.display!=='none')shown++; });
  return { all:cells.length, shown:shown,
    bar:(el.innerText||'').replace(/\s+/g,' ') };
});
console.log('   '+JSON.stringify(many).slice(0,220));
ok(many.all===14,'★14件ある');
ok(many.shown===10,'★★★既定は10件だけ出す');
ok(/さらに10件/.test(many.bar),'★★★「さらに10件」で広げられる');
let more=await p.evaluate(()=>{
  const b=$('mwPicShots').querySelector('[data-listmore]');
  if(b)b.click();
  const cells=$('mwPicShots').querySelectorAll('[data-picdel]');
  let shown=0;
  Array.prototype.forEach.call(cells,function(x){
    if(x.parentElement.style.display!=='none')shown++; });
  return shown;
});
ok(more===14,'★★押すと広がる');

console.log('\n=== F3：タップで外す（写真なしに戻る）===');
await setup({});
await openCsvBoxes(p);
await load();
await p.evaluate(()=>{
  $('mwPicPasteBox').open=true;
  mwPicShots=[{ jan:'4902370550001', name:'ゼルダ①',
    url:'https://img.example/i/20261109/a.jpg', n:2 }];
  listSet('mwpicshot',10);
  mwPicShotRender();
});
dlg=[]; cancel=false;
let del=await p.evaluate(async()=>{
  $('mwPicShots').querySelector('[data-picdel]').click();
  await new Promise(function(r){ setTimeout(r,250); });
  const row=(mwRows||[]).filter(function(x){
    return x.jan==='4902370550001'; })[0]||{};
  return { del:JSON.parse(JSON.stringify(window.__del)),
    note:($('mwPicInNote').innerText||'').replace(/\s+/g,' '),
    left:$('mwPicShots').querySelectorAll('[data-picdel]').length,
    pics:+row.pics_ok||0 };
});
console.log('   '+JSON.stringify(del)+' / '+JSON.stringify(dlg).slice(0,160));
ok(del.del.length===1&&del.del[0].jan==='4902370550001',
   '★★★/mw/img/del にその JAN を送る');
ok(dlg.some((m)=>/写真なし>に戻ります/.test(m)),
   '★★★先に確認を出す（写真なしに戻ると書く）');
ok(dlg.some((m)=>/上げた画像そのものは消しません/.test(m)),
   '★★★上げた画像は消さないと書く');
ok(/外しました/.test(del.note),'★★結果を出す');
ok(del.left===0,'★★★外したものはサムネイルから消える');
ok(del.pics===0,'★★★その JAN は写真なしに戻る（一覧の写真の数も0）');
/* やめたら送らない。 */
await p.evaluate(()=>{
  window.__del=[];
  mwPicShots=[{ jan:'4902370550002', name:'マリオ②',
    url:'https://img.example/i/20261109/b.jpg', n:1 }];
  mwPicShotRender();
});
dlg=[]; cancel=true;
let no=await p.evaluate(async()=>{
  $('mwPicShots').querySelector('[data-picdel]').click();
  await new Promise(function(r){ setTimeout(r,200); });
  return { del:window.__del.length,
    left:$('mwPicShots').querySelectorAll('[data-picdel]').length };
});
cancel=false;
ok(no.del===0&&no.left===1,'★★やめたら外さない');

console.log('\n=== F4：自動の巡回・ページ送りはしない ===');
const code=await p.evaluate(()=>mwMarkCode());
const src=decodeURIComponent(code.replace(/^javascript:/,''));
ok(src.indexOf('fetch(')<0&&src.indexOf('XMLHttpRequest')<0,
   '★★★ブックマークレットはほかのページを取りに行かない');
ok(!/location\s*\.\s*(href|assign|replace)\s*=/.test(src)
   &&src.indexOf('window.open')<0,
   '★★★ページ送りもしない（人が開いたページだけを読む）');
ok(/\\n/.test(src)||src.indexOf('join("\\n")')>0||/join\(/.test(src),
   '★一覧の全件を改行区切りで出す');

console.log('\n=== 無在庫（eBay）の候補一覧に検索欄（6.158）===');
await setup({});
await openCsvBoxes(p);
await load();
let f0=await p.evaluate(()=>({ has:!!$('mwlFind'),
  ph:String(($('mwlFind')||{}).placeholder||''),
  cam:!!$('mwlFindCam'), clr:!!$('mwlFindClear') }));
console.log('   '+JSON.stringify(f0));
ok(f0.has===true,'★★★検索欄がある');
ok(/商品名/.test(f0.ph)&&/JAN/.test(f0.ph)&&/社/.test(f0.ph),
   '★★★商品名・JAN・社 で探せると書いてある');
ok(f0.cam===true&&f0.clr===true,'★★バーコードと「×」もある');
const find=async(q)=>await p.evaluate((q)=>{
  $('mwlFind').value=q;
  findRun('mwl');
  const el=$('csvMwList');
  return { txt:(el.innerText||'').replace(/\s+/g,' '),
    note:($('mwlFindNote').innerText||'').replace(/\s+/g,' '),
    clr:$('mwlFindClear').style.display };
},q);
/* ① の行を名前で探す。 */
let f1=await find('ゼルダ');
console.log('   '+f1.txt.slice(0,140));
ok(/ゼルダ①/.test(f1.txt)&&!/マリオ②/.test(f1.txt),
   '★★★商品名で絞れる');
ok(/検索に当たった 1件を表示/.test(f1.txt),'★★当たった件数を出す');
/* ③（後回し・畳んである区分）の行も見つかる。 */
let f3=await find('カービィ');
console.log('   '+f3.txt.slice(0,140));
ok(/カービィ③/.test(f3.txt),
   '★★★③ 後回しの区分にあっても見つかる');
/* ④（未調査）も見つかる。 */
ok(/ピクミン④/.test((await find('ピクミン')).txt),
   '★★★④ 未調査の区分にあっても見つかる');
/* JAN と社でも探せる。 */
ok(/マリオ②/.test((await find('4902370550002')).txt),'★★★JAN で探せる');
let fs=await find('M200');
ok(/ゼルダ①/.test(fs.txt)&&/マリオ②/.test(fs.txt),'★★★社で探せる');
/* 当たらないときは、そう出す。 */
let f9=await find('そんなものはない');
ok(/当たる候補がありません/.test(f9.txt),'★★当たらないときはそう出す');
ok(f9.clr!=='none','★「×」が出る');
/* 「×」で戻る。 */
let fc=await p.evaluate(()=>{
  $('mwlFindClear').click();
  return { v:$('mwlFind').value,
    txt:($('csvMwList').innerText||'').replace(/\s+/g,' ') };
});
ok(fc.v===''&&/ゼルダ①/.test(fc.txt)&&/カービィ③/.test(fc.txt),
   '★★★「×」で全部に戻る');

console.log('\n=== ⚙「手数料を1件ためす」に在庫管理の目安（6.159）===');
await setup({});
await clickCfg(p,'#mwFeeTestBtn',false);
await p.waitForTimeout(100);
let fee=await p.evaluate(async()=>{
  $('mwFeeTestAsin').value='B0AMZ00001';
  $('mwFeeTestPrice').value='6500';
  $('mwFeeTestBtn').click();
  await new Promise(function(r){ setTimeout(r,300); });
  return ($('mwFeeTestNote').innerText||'').replace(/\s+/g,' ');
});
console.log('   '+fee);
ok(/取れました/.test(fee),'★取れた');
ok(/FBA手数料 ¥441/.test(fee),
   '★★★FBA手数料に在庫管理の目安を足す（配送代行425＋在庫管理16）');
ok(/配送代行 ¥425＋在庫管理 ¥16/.test(fee),'★★★内訳を出す');
ok(/寸法から/.test(fee),'★★サイズ区分の出どころを出す（控えにあれば寸法から）');
ok(/合計 ¥1,513/.test(fee),'★★★合計も在庫管理を足した額（1,497＋16）');
ok(/Amazon の返り ¥425/.test(fee),
   '★★Amazon が返した額（配送代行だけ）も添える');
/* 控えにサイズ区分が無いときは⚙の既定で出す。 */
let fee2=await p.evaluate(async()=>{
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    if(/\/mw\/fee\/test/.test(String(u)))
      return new Response(JSON.stringify({ ok:true, asin:'B0AMZ00003',
        price:6500, http:200, err:'', sent:[], got_n:1, got:[], size:null,
        pick:{ ok:true, ref:975, tax:97, fba:425, total:1497 } }),{status:200});
    return real(u,i);
  };
  $('mwFeeTestAsin').value='B0AMZ00003';
  $('mwFeeTestBtn').click();
  await new Promise(function(r){ setTimeout(r,300); });
  return ($('mwFeeTestNote').innerText||'').replace(/\s+/g,' ');
});
console.log('   '+fee2.slice(0,200));
ok(/⚙の既定/.test(fee2),'★★★控えに無いときは「⚙の既定」と書く');
ok(/在庫管理/.test(fee2),'★★それでも在庫管理の目安は足す');

await T.done();
})();
