/* 画面：MW の写真の半自動（6.129／7.94）
   会員サイトの自動取得は作らない方針のまま、**人が見ているページから送る**。
   ・一覧の行に「MW で検索」（/buy/?q=JAN を新しいタブで開く）
   ・ブックマークレットは**開いているページだけ**を読み、
     商品番号（products/…/NNNNNNNN.jpg）と JAN の組を作る
   ・v219（6.131）：pj は**開かない**。「JAN:商品番号」を**クリップボードにコピー**し、
     pj の「MW の写真を貼り付けて取り込む」に貼って取り込む
     （ホーム画面のアプリと Safari では設定が別で、Safari 側の pj では取り込めない）
   ・JAN が決まらない画面では**何も出さない**
   ・鍵はブックマークに入れない（送るのは pj の側） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：MW の写真の半自動');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const JAN='4902370554922', ID='10970132';
const ROWS=[{ jan:JAN, sha:'M200', kishu:'NS2', mw_name:'ゼルダの伝説 時のオカリナ',
  amz_name:'ゼルダの伝説 時のオカリナ NS2', wholesale:3000, stock:9,
  ship_text:'即日出荷', ship_days:0, asin:'B0H8D9NY89', price:6500,
  basis:'カート', new_n:4, amz:0, rst:'ok', cond:'新品', list_price:7678,
  rank:1200, rank_cat:'ゲーム' }];
/* 候補をもう2件（6.135 の振り分けを確かめるため）。 */
ROWS.push(Object.assign({},ROWS[0],{ jan:'4902370554923', asin:'B0H8D9NY90',
  mw_name:'候補2', amz_name:'候補2' }));
ROWS.push(Object.assign({},ROWS[0],{ jan:'4902370554924', asin:'B0H8D9NY91',
  mw_name:'候補3', amz_name:'候補3' }));
const META={ ok:true, n:3, rows:ROWS, seen:3, priced:3, left:0, per_run:120,
  ttl_days:3, limit:3000 };

const setup=async(role)=>await p.evaluate(([META,role])=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('csvImgBase').value='https://img.example'; $('csvImgToken').value='t';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='5';
  $('mwKishu').value='NS2'; $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  window.__img=[]; window.__up=0;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/mw\/img/.test(url)&&i&&i.method==='POST'){
      window.__img.push(b);
      /* 本物は1件2〜3秒かかる。止められるかを確かめたいので少し待たせる。 */
      if(window.__slow&&!b.saved)
        await new Promise((r)=>setTimeout(r,window.__slow));
      if(b.saved)return new Response(JSON.stringify({ok:true,n:b.saved.length}),
        {status:200});
      return new Response(JSON.stringify({ ok:true, jan:b.jan,
        n:(b.ids||[]).length, good:(b.ids||[]).length, bad:0,
        rows:(b.ids||[]).map((id,k)=>({ pos:k, mw_id:String(id), w:1200, h:1200,
          long:1200, bytes:50000, ct:'image/jpeg', ok:true, err:'',
          b64:'AAAA' }))}),{status:200});
    }
    if(/\/upload/.test(url)){
      window.__up++;
      return new Response(JSON.stringify({ok:true,
        url:'https://img.example/i/20261105/00000000-0000-4000-8000-00000000000'
          +window.__up+'.jpg'}),{status:200});
    }
    if(/\/mw\/buy/.test(url))
      return new Response(JSON.stringify({ok:true,rows:[],n:0}),{status:200});
    if(/\/mw\/amz/.test(url))
      return new Response(JSON.stringify(META),{status:200});
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:role,staff_key_set:true}),
        {status:200});
    return real(u,i);
  };
  syncRole=role; roleApply();
},[META,role]);

console.log('=== 行の「MW で検索」===');
await setup('admin');
await openCsvBoxes(p);
await p.evaluate(()=>{ switchTab('F'); $('csvMwAmzLoad').click(); });
await p.waitForTimeout(500);
let a=await p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('#csvMwAmzList a'),
  (el)=>({ t:(el.textContent||'').trim(), href:el.getAttribute('href'),
    tgt:el.getAttribute('target') })).filter((x)=>/MW/.test(x.t)));
console.log('   '+JSON.stringify(a));
ok(a.length===3,'★★★候補の行に「MW で検索」がある（行ごとに1つ）');
ok(a[0].href==='https://matchingworld.asia/buy/?q='+JAN,
   '★★★会員サイトの JAN 検索（/buy/?q=JAN）を開く');
ok(a[0].tgt==='_blank','★★新しいタブで開く（MW の画面を残す）');
ok(await p.evaluate((j)=>mwSearchUrl(j),JAN)
   ==='https://matchingworld.asia/buy/?q='+JAN,'★アドレスの作り方');

console.log('\n=== ブックマークレット ===');
const code=await p.evaluate(()=>mwMarkCode());
console.log('   長さ '+code.length+' / '+code.slice(0,60)+'…');
ok(code.indexOf('javascript:')===0,'★★★javascript: で始まる1行');
ok(code.length<5000,'★1行におさまる長さ（ブックマークに入る）');
const src=decodeURIComponent(code.replace(/^javascript:/,''));
ok(src.indexOf('syncKey')<0&&src.indexOf('X-PJ-Key')<0&&src.indexOf("'k'")<0,
   '★★★鍵はブックマークに入らない（送るのは pj の側）');
ok(src.indexOf('window.open')<0&&src.indexOf('#mwpic')<0,
   '★★★pj を開かない（6.131。ホーム画面のアプリと設定が別になる）');
ok(!/matchingworld\.asia\/(buy|products)/.test(src)
   &&src.indexOf('fetch(')<0&&src.indexOf('XMLHttpRequest')<0,
   '★★★ほかのページを取りに行かない（開いているページだけを読む）');

/* 本物に近い形の会員サイトの画面を作って、ブックマークレットを走らせる。
   ・画像は1枚、src は products/…/NNNNNNNN.jpg
   ・JAN は行の中ではなく <script> に入っている（実物の報告どおり） */
const mwPage=async(ctx,url,html)=>{
  const q=await ctx.newPage();
  await q.route('**/*',(route)=>route.fulfill({ status:200,
    contentType:'text/html; charset=utf-8', body:html }));
  await q.goto(url);
  return q;
};
const HTML=(rows,extra)=>'<!doctype html><meta charset="utf-8"><body>'
  +'<img src="/img/logo.png"><table id="searchrslt">'+rows+'</table>'
  +(extra||'')+'</body>';
/* MW の一覧（詳細検索）に近い形。商品ごとの箱の中に
   「JAN:13桁 定価:…」の文字と、写真（または No Image）がある。 */
const BOX=(id,name,jan)=>'<div class="item"><table><tr>'
  +'<td class="pic">'+(id
    ?('<img src="/products/'+(Math.floor(id/10000)*10000)+'/'
      +(Math.floor(id/100)*100)+'/'+id+'.jpg">')
    :'<span>No Image</span>')+'</td>'
  +'<td><a href="/buy/detail/?id='+(id||0)+'">'+name+'</a>'
  +'<div>JAN:'+jan+' 定価:7,800円 （発売日：1994/03/18）</div>'
  +'<table><tr><td>新品</td><td>B037</td><td>371,850円</td></tr></table>'
  +'</td></tr></table></div>';
const LIST=(boxes)=>'<!doctype html><meta charset="utf-8"><body>'
  +'<div id="side">機種で絞込み TVゲーム（5040）</div>'
  +'<div id="main">該当件数：5,030件 '+boxes.join('')+'</div></body>';
const ROW=(id,name,jan)=>'<tr><td><a href="#"><img src="/products/'
  +(Math.floor(id/10000)*10000)+'/'+(Math.floor(id/100)*100)+'/'+id+'.jpg"></a></td>'
  +'<td>'+name+(jan?('<br>JAN'+jan):'')+'</td><td>在庫 9</td></tr>';
const run=async(q,noClip)=>{
  const out=await q.evaluate(([s,noClip])=>{
    window.__open=null;
    window.open=function(u){ window.__open=u; return { focus:function(){} }; };
    window.__alert=null;
    window.alert=function(m){ window.__alert=m; };
    window.__clip=null;
    /* クリップボードに書けるとき／書けないときの両方を試せるようにする。 */
    try{
      Object.defineProperty(navigator,'clipboard',{ configurable:true, value:(noClip
        ?undefined
        :{ writeText:function(t){ window.__clip=t; return Promise.resolve(); } }) });
    }catch(e){}
    document.execCommand=function(c){ if(c==='copy')window.__exec=1; return false; };
    eval(s);
    return true;
  },[src,!!noClip]);
  await q.waitForTimeout(120);
  return await q.evaluate(()=>{
    const d=document.body.lastElementChild;
    const t=d&&d.querySelector?d.querySelector('textarea'):null;
    return { url:window.__open, alert:window.__alert, clip:window.__clip,
      exec:window.__exec||0, box:t?String(t.value||''):'',
      msg:d?String(d.textContent||'').replace(/\s+/g,' '):'',
      sel:!!(t&&document.activeElement===t&&t.selectionEnd>0) };
  });
};

const ctx=p.context();
let q=await mwPage(ctx,'https://matchingworld.asia/buy/?q='+JAN,
  HTML(ROW(10970132,'ゼルダの伝説 時のオカリナ'),
    '<script>var d={jan:"'+JAN+'"};</script>'));
let r=await run(q);
console.log('   '+JSON.stringify(r));
ok(!r.url,'★★★pj は開かない（ホーム画面のアプリと Safari で設定が別・6.131）');
ok(r.clip===JAN+':'+ID,
   '★★★「JAN:商品番号」をクリップボードにコピーする');
ok(/コピーしました/.test(r.msg)&&/貼り付け/.test(r.msg),
   '★★★「コピーしました。pj に戻って貼り付けてください」と出す');
ok(r.box===JAN+':'+ID,'★★枠にも同じ文字を出す（手でコピーできる）');
await q.close();

console.log('\n=== コピーできない端末 ===');
q=await mwPage(ctx,'https://matchingworld.asia/buy/?q='+JAN,
  HTML(ROW(10970132,'ゼルダの伝説 時のオカリナ')));
r=await run(q,1);
console.log('   '+JSON.stringify({sel:r.sel,exec:r.exec,msg:r.msg.slice(0,60)}));
ok(r.box===JAN+':'+ID,'★★★枠に出す');
ok(r.sel===true,'★★★選んだ状態にする（長押しで「コピー」が出せる）');
ok(/長押し/.test(r.msg),'★★どうすればよいかを書く');
await q.close();

console.log('\n=== 複数の社が出たとき ===');
q=await mwPage(ctx,'https://matchingworld.asia/buy/?q='+JAN,
  HTML(ROW(10970132,'ゼルダ（M200）')+ROW(10970140,'ゼルダ（MC02）')));
r=await run(q);
console.log('   '+String(r.clip));
ok(r.clip===JAN+':10970132.10970140',
   '★★★同じ JAN の写真はまとめて渡す（社が複数でも）');
await q.close();

console.log('\n=== JAN が違う行は送らない ===');
q=await mwPage(ctx,'https://matchingworld.asia/buy/?q='+JAN,
  HTML(ROW(10970132,'ゼルダ','4902370554922')+ROW(10970999,'別の商品','4902370550467')));
r=await run(q);
console.log('   '+String(r.clip));
ok(r.clip===JAN+':'+ID,
   '★★★JAN が一致するものだけを渡す（検索した JAN と違う行は外す）');
await q.close();

console.log('\n=== JAN が分からない画面では何も送らない ===');
q=await mwPage(ctx,'https://matchingworld.asia/buy/list/',
  HTML(ROW(10970132,'なにかの商品')));
r=await run(q);
console.log('   '+JSON.stringify({clip:r.clip,alert:r.alert}));
ok(!r.clip,'★★★当てずっぽうではコピーしない');
ok(/JAN で検索した画面/.test(String(r.alert)),
   '★★どうすればよいかを知らせる');
await q.close();

console.log('\n=== 写真が1枚も無い画面 ===');
q=await mwPage(ctx,'https://matchingworld.asia/buy/?q='+JAN,HTML(''));
r=await run(q);
ok(!r.clip&&!!r.alert,'★★写真が無ければコピーしない');
await q.close();

console.log('\n=== 一覧の画面からまとめて（6.135）===');
/* 詳細検索の一覧（?q= が無い画面）。4商品のうち2つが No Image。 */
q=await mwPage(ctx,'https://matchingworld.asia/buy/?mode=detail&hits=100',
  LIST([ BOX(10958868,'VAMPIRE KILLER','4573419410549'),
         BOX(0,'ツインクルテール','4934529000011'),
         BOX(10970132,'ゼルダの伝説 時のオカリナ','4902370554922'),
         BOX(0,'TATSUJIN','4988611920015') ]));
r=await run(q);
console.log('   '+JSON.stringify({clip:r.clip,msg:r.msg.slice(0,120)}));
ok(r.clip==='4573419410549:10958868\n4902370554922:10970132',
   '★★★一覧でも、行ごとに JAN と写真を組にしてまとめてコピーする');
ok(/2件/.test(r.msg),'★★★組にできた件数を出す');
ok(/写真が無い・組にできなかった 2件/.test(r.msg),
   '★★★No Image の商品の件数も知らせる');
await q.close();

console.log('\n=== 100件でも1回で ===');
const many=[];
for(let i=0;i<100;i++)
  many.push(BOX(10900000+i,'商品'+i,'49000000'+String(10000+i)));
q=await mwPage(ctx,'https://matchingworld.asia/buy/?mode=detail&hits=100',
  LIST(many));
r=await run(q);
const lines=String(r.clip||'').split('\n');
console.log('   '+lines.length+'行 / 先頭 '+lines[0]+' / 末尾 '+lines[lines.length-1]);
ok(lines.length===100,'★★★100件でも1回でコピーする');
ok(lines[0]==='4900000010000:10900000','★★1行1件（JAN:商品番号）');
await q.close();

console.log('\n=== となりの商品の JAN と取り違えない ===');
/* 写真の親をたどると2つ以上 JAN が出る形（箱で分かれていない画面）。 */
q=await mwPage(ctx,'https://matchingworld.asia/buy/?mode=detail',
  '<!doctype html><meta charset="utf-8"><body><div>'
  +'<img src="/products/10900000/10900100/10900123.jpg">'
  +'JAN:4902370554922 と JAN:4573419410549 が同じ箱にある'
  +'</div></body>');
r=await run(q);
console.log('   '+JSON.stringify({clip:r.clip,alert:String(r.alert||'').slice(0,60)}));
ok(!r.clip,'★★★どちらの JAN か決められない写真は渡さない');
ok(/JAN は2件見えています|組が分かりませんでした/.test(String(r.alert||'')),
   '★★なぜ渡せないかを知らせる');
await q.close();

console.log('\n=== pj で受け取る（#mwpic）===');
let got=await p.evaluate(()=>mwPicParse('#mwpic='
  +encodeURIComponent('4902370554922:10970132.10970140|4902370550467:10921742')));
console.log('   '+JSON.stringify(got));
ok(got.length===2&&got[0].ids.length===2,'★★★アドレスから JAN と番号を読む');
ok(await p.evaluate(()=>mwPicParse('#mwpic=123:1').length)===0,
   '★★13桁でない JAN は受けない');
ok(await p.evaluate(()=>mwPicParse('#tab=F').length)===0,'★関係ない印は読まない');
/* 帯が出て、押すまで取り込まない。 */
await p.evaluate((j)=>{
  location.hash='#mwpic='+encodeURIComponent(j+':10970132');
  mwPicHash();
},JAN);
await p.waitForTimeout(200);
let bar=await p.evaluate(()=>({ shown:$('mwPicBar').style.display!=='none',
  text:($('mwPicText').innerText||'').replace(/\s+/g,' '),
  hash:location.hash, posts:window.__img.length }));
console.log('   '+JSON.stringify(bar));
ok(bar.shown===true,'★★★受け取ったら帯を出す（どのタブでも）');
ok(/1件/.test(bar.text)&&/1枚/.test(bar.text)&&new RegExp(JAN).test(bar.text),
   '★★★JAN と枚数を出す');
ok(bar.posts===0,'★★★押すまで取り込まない（勝手に取りに行かない）');
ok(bar.hash==='','★★アドレスから消す（読み直しで二度取り込まない）');

console.log('\n=== 取り込む ===');
await p.evaluate(()=>{ $('mwPicGo').click(); });
await p.waitForTimeout(900);
let st=await p.evaluate(()=>({ posts:window.__img, up:window.__up,
  text:($('mwPicText').innerText||'').replace(/\s+/g,' '),
  btn:$('mwPicGo').textContent }));
console.log('   '+JSON.stringify(st));
ok(st.posts.length===2,'★★★今までの口（POST /mw/img）を使う');
ok(st.posts[0].jan===JAN&&String(st.posts[0].ids[0])===ID,
   '★★★JAN と商品番号をそのまま送る');
ok(st.up===1,'★★使える写真を pj-img（R2）に上げる');
ok(st.posts[1].saved&&st.posts[1].saved.length===1,
   '★★★公開URLを控え直す（C-① と同じ流れ）');
ok(/取り込みました/.test(st.text)&&/1枚/.test(st.text),'★★結果を出す');
ok(st.btn==='閉じる','★終わったら閉じられる');
await p.evaluate(()=>{ $('mwPicGo').click(); });
await p.waitForTimeout(100);
ok(await p.evaluate(()=>$('mwPicBar').style.display==='none'),'★帯を閉じられる');

console.log('\n=== 貼り付けて取り込む（6.131）===');
/* ブックマークレットがコピーする形を、そのまま貼る。
   6.156：取り込むのは候補の JAN だけなので、先に候補を読んでおく
   （刈取の行は「仕入れる」の印が付いたものだけが対象）。 */
await p.evaluate(()=>{ switchTab('F'); $('csvMwAmzLoad').click(); });
await p.waitForTimeout(400);
await p.evaluate(()=>{ switchTab('F'); $('mwPicPasteBox').open=true;
  $('mwPicIn').value=''; window.__img=[]; window.__up=0;
  mwBuyMap={}; (mwAmzRows||[]).forEach(function(r){ mwBuyMap[r.jan]=1;
    r.pics_ok=0; r.pics_n=0; }); });
got=await p.evaluate((j)=>mwPicRead(j+':10970132.10970140'),JAN);
console.log('   '+JSON.stringify(got));
ok(got.length===1&&got[0].ids.length===2,'★★★貼り付けた形を読める');
ok(await p.evaluate(()=>mwPicRead('4902370554922:10970132\n4902370550467:10921742')
     .length)===2,'★★★複数まとめて貼れる（改行区切り）');
ok(await p.evaluate(()=>mwPicRead(
     '4902370554922:10970132|4902370550467:10921742').length)===2,
   '★★| 区切りでも読める');
ok(await p.evaluate(()=>{
     const g=mwPicRead('JAN 4902370554922 の写真 10970132, 10970140');
     return g.length===1&&g[0].ids.length===2; }),
   '★★★空白やカンマが混じっても読める（手で直せる）');
ok(await p.evaluate(()=>{
     const g=mwPicRead('4902370554922:10970132\n4902370554922:10970140');
     return g.length===1&&g[0].ids.length===2; }),
   '★★同じ JAN が2行あればまとめる');
ok(await p.evaluate(()=>mwPicRead('123:10970132').length)===0,
   '★★13桁でない JAN は受けない');
ok(await p.evaluate(()=>mwPicRead('4902370554922').length)===0,
   '★商品番号が無ければ受けない');
/* 貼ると、取り込む前に中身を知らせる。 */
await p.evaluate((j)=>{
  $('mwPicIn').value=j+':10970132';
  $('mwPicIn').dispatchEvent(new Event('input',{bubbles:true}));
},JAN);
await p.waitForTimeout(150);
let pn=await p.evaluate(()=>({ note:($('mwPicInNote').innerText||'')
  .replace(/\s+/g,' '), posts:window.__img.length }));
console.log('   '+JSON.stringify(pn));
ok(/1件/.test(pn.note)&&/1枚/.test(pn.note)&&new RegExp(JAN).test(pn.note),
   '★★★貼ったら「何件・何枚」を先に出す');
ok(pn.posts===0,'★★★押すまで取り込まない');
await p.evaluate(()=>{ $('mwPicTake').click(); });
await p.waitForTimeout(900);
let ps=await p.evaluate(()=>({ posts:window.__img, up:window.__up,
  note:($('mwPicInNote').innerText||'').replace(/\s+/g,' ') }));
console.log('   '+JSON.stringify(ps));
ok(ps.posts.length===2&&ps.posts[0].jan===JAN
   &&String(ps.posts[0].ids[0])===ID,
   '★★★今までの口（POST /mw/img）で取り込む');
ok(ps.up===1,'★★pj-img（R2）にも上げる');
ok(ps.posts[1].saved&&ps.posts[1].saved.length===1,'★★公開URLを控え直す');
ok(/取り込みました/.test(ps.note)&&/1枚/.test(ps.note),'★★結果を出す');
/* 読めない文字を貼ったとき。 */
await p.evaluate(()=>{
  $('mwPicIn').value='なにか関係のない文字';
  $('mwPicIn').dispatchEvent(new Event('input',{bubbles:true}));
});
await p.waitForTimeout(150);
ok(/読めませんでした/.test(await p.evaluate(()=>
     ($('mwPicInNote').innerText||''))),'★★★読めないときはそう出す');
/* クリップボードから読む。 */
await p.evaluate((j)=>{
  Object.defineProperty(navigator,'clipboard',{ configurable:true,
    value:{ readText:function(){ return Promise.resolve(j+':10970132'); } } });
  $('mwPicIn').value='';
  $('mwPicRead').click();
},JAN);
await p.waitForTimeout(300);
pn=await p.evaluate(()=>({ v:$('mwPicIn').value,
  note:($('mwPicInNote').innerText||'').replace(/\s+/g,' ') }));
console.log('   '+JSON.stringify(pn));
ok(pn.v===JAN+':10970132','★★★「クリップボードから読む」で欄に入る');
ok(/1件/.test(pn.note),'★★読めた中身を出す');

console.log('\n=== 候補の JAN だけ取り込む（6.135／6.156）===');
/* 候補（Amazon刈取の一覧）を読み込んだ状態にする。 */
await p.evaluate(()=>{ switchTab('F'); $('csvMwAmzLoad').click(); });
await p.waitForTimeout(400);
await p.evaluate(()=>{ $('mwPicPasteBox').open=true; window.__img=[]; window.__up=0; });
let sp=await p.evaluate((j)=>{
  /* 6.156：刈取（Amazon FBA）の行は**「仕入れる」の印が付いた JAN だけ**が対象。
     1件目と2件目に印を付け、2件目はすでに写真あり。 */
  mwBuyMap={}; mwBuyMap[mwAmzRows[0].jan]=1; mwBuyMap[mwAmzRows[1].jan]=1;
  mwAmzRows[0].pics_ok=0;
  mwAmzRows[1].pics_ok=2;
  $('mwPicIn').value=[ mwAmzRows[1].jan+':10900001',   // すでに写真あり
    j+':10970132',                                     // 取り込む（印あり）
    '4900000000001:10900002' ].join('\n');            // 候補外
  $('mwPicIn').dispatchEvent(new Event('input',{bubbles:true}));
  return { note:($('mwPicInNote').innerText||'').replace(/\s+/g,' '),
    take:mwPicInNote().map((x)=>x.jan) };
},JAN);
console.log('   '+JSON.stringify(sp));
ok(sp.take.length===1&&sp.take[0]===JAN,
   '★★★候補で、まだ写真が無い JAN だけ取り込む');
ok(/取り込む 1件/.test(sp.note),'★★★取り込む件数を出す');
ok(/候補外 1件/.test(sp.note),'★★★候補外の件数を出す');
ok(/すでに写真あり 1件/.test(sp.note),'★★★すでに写真がある件数を出す');
/* 6.156：候補が読めていないときは**振り分けられないので取り込まない**。
   全部取り込むと候補外まで取ってしまう（1件2〜3秒かかる）。 */
const noCand=await p.evaluate((j)=>{
  const keep=mwAmzRows, keep2=mwRows, keep3=mwBuyRows, keep4=mwBuyMap;
  mwAmzRows=[]; mwRows=[]; mwBuyRows=[]; mwBuyMap={};
  $('mwPicIn').value=j+':10900003\n4900000000001:10900004';
  const take=mwPicInNote().map((x)=>x.jan);
  const note=($('mwPicInNote').innerText||'').replace(/\s+/g,' ');
  const r=mwPicSplit(mwPicRead($('mwPicIn').value));
  mwAmzRows=keep; mwRows=keep2; mwBuyRows=keep3; mwBuyMap=keep4;
  return { take:take.length, cand:r.cand, note:note };
},JAN);
console.log('   '+JSON.stringify(noCand));
ok(noCand.cand===0&&noCand.take===0,
   '★★★候補がまだ読めていないときは取り込まない（候補外まで取らない）');
ok(/振り分けられません/.test(noCand.note)&&/一覧を出す/.test(noCand.note),
   '★★★先に「一覧を出す」を押すよう知らせる');

console.log('\n=== 途中で止めて、続きから ===');
await p.evaluate((j)=>{
  window.__img=[]; window.__up=0;
  /* 6.156：3件ぜんぶに「仕入れる」の印を付けて、対象にする。 */
  mwBuyMap={};
  mwAmzRows.forEach(function(r){ mwBuyMap[r.jan]=1; });
  $('mwPicIn').value=[j+':10970132', mwAmzRows[1].jan+':10970140',
    mwAmzRows[2].jan+':10970141'].join('\n');
  mwAmzRows[1].pics_ok=0; mwAmzRows[2].pics_ok=0; mwAmzRows[0].pics_ok=0;
  $('mwPicIn').dispatchEvent(new Event('input',{bubbles:true}));
},JAN);
await p.waitForTimeout(150);
/* 取り込みを始めて、すぐ「止める」を押す。 */
await p.evaluate(()=>{ window.__slow=300; $('mwPicTake').click(); });
await p.waitForTimeout(350);
await p.evaluate(()=>{ $('mwPicTake').click(); });   // 2回目の押下＝止める
await p.waitForTimeout(900);
let qst=await p.evaluate(()=>({
  note:($('mwPicInNote').innerText||'').replace(/\s+/g,' '),
  q:(function(){ try{ return JSON.parse(localStorage.getItem('pj:mwpicq:v1')||'[]'); }
                 catch(e){ return []; } })(),
  qn:($('mwPicQNote').innerText||'').replace(/\s+/g,' '),
  shown:$('mwPicQNote').style.display!=='none',
  btn:$('mwPicTake').textContent }));
console.log('   '+JSON.stringify(qst).slice(0,300));
ok(/止めました/.test(qst.note),'★★★「止める」で中断できる');
ok(qst.q.length>=1,'★★★残りを端末に覚える（閉じても続きから）');
ok(qst.shown===true&&/前回の続きが/.test(qst.qn),
   '★★★残りがあることを知らせる');
ok(qst.btn==='取り込む','★押せる状態に戻る');
/* 「続きを取り込む」で残りを片づける。 */
await p.evaluate(()=>{ window.__slow=0; $('mwPicGoOn').click(); });
await p.waitForTimeout(1500);
let fin=await p.evaluate(()=>({
  note:($('mwPicInNote').innerText||'').replace(/\s+/g,' '),
  q:localStorage.getItem('pj:mwpicq:v1'),
  posts:window.__img.filter((b)=>!b.saved).map((b)=>b.jan) }));
console.log('   '+JSON.stringify(fin).slice(0,300));
ok(/取り込みました/.test(fin.note),'★★★続きから最後まで取り込める');
ok(!fin.q,'★★終わったら残りは消える');
ok(fin.posts.length>=1,'★★残りの行も POST /mw/img に送られる');

console.log('\n=== ホーム画面のアプリ（PWA）では Safari で開く ===');
let urls=await p.evaluate((j)=>({ web:mwSearchUrl(j,false), app:mwSearchUrl(j,true) }),JAN);
console.log('   '+JSON.stringify(urls));
ok(urls.web==='https://matchingworld.asia/buy/?q='+JAN,
   '★ふつうのブラウザではそのまま開く');
ok(urls.app==='x-safari-https://matchingworld.asia/buy/?q='+JAN,
   '★★★ホーム画面のアプリからは x-safari-https で Safari 本体を開く');
ok(await p.evaluate(()=>typeof mwStandalone==='function'),
   '★ホーム画面のアプリかどうかを見ている');
ok(await p.evaluate((j)=>{
     const b=mwFindBtn(j);
     return b.indexOf('target="_blank"')>0&&b.indexOf('matchingworld')>0;
   },JAN),'★★行のボタンは新しいタブで開く');
/* x-safari-https: が効かない端末のために、ふつうに開くリンクも添える。 */
await p.evaluate(()=>{ window.mwStandalone=function(){ return true; }; });
let bb=await p.evaluate((j)=>mwFindBtn(j),JAN);
console.log('   '+bb);
ok(bb.indexOf('x-safari-https://')>0&&/MW で検索（Safari）/.test(bb),
   '★★★アプリのときは「MW で検索（Safari）」になる');
ok((bb.match(/href="/g)||[]).length===2
   &&bb.indexOf('href="https://matchingworld')>0,
   '★★★効かない端末のために、ふつうに開くリンクも添える');

console.log('\n=== 作業者用の端末でも送れる（A）===');
await p.evaluate(()=>{ try{ localStorage.clear(); }catch(e){} });
await p.reload(); await p.waitForTimeout(300);
await setup('staff');
await openCsvBoxes(p);
/* 6.156：候補を先に読む（取り込むのは候補の JAN だけ）。 */
await p.evaluate(()=>{ switchTab('F'); $('csvMwAmzLoad').click(); });
await p.waitForTimeout(400);
await p.evaluate((j)=>{
  switchTab('F'); $('mwPicPasteBox').open=true;
  mwBuyMap={}; (mwAmzRows||[]).forEach(function(r){ mwBuyMap[r.jan]=1;
    r.pics_ok=0; r.pics_n=0; });
  $('mwPicIn').value=j+':10970132';
  $('mwPicIn').dispatchEvent(new Event('input',{bubbles:true}));
},JAN);
await p.waitForTimeout(150);
ok(await p.evaluate(()=>!$('mwPicTake').disabled),
   '★★★作業者用の端末でも貼り付けの欄が使える');
await p.evaluate(()=>{ $('mwPicTake').click(); });
await p.waitForTimeout(900);
st=await p.evaluate(()=>({ posts:window.__img.length,
  text:($('mwPicInNote').innerText||'').replace(/\s+/g,' ') }));
console.log('   '+JSON.stringify(st));
ok(st.posts>=1,'★★★作業者用の端末でも取り込める（7.94・選択A）');
ok(/取り込みました/.test(st.text),'★★結果も出る');
await T.done();
})();
