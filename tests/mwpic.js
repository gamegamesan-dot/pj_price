/* 画面：MW の写真の半自動（6.129／7.94）
   会員サイトの自動取得は作らない方針のまま、**人が見ているページから送る**。
   ・一覧の行に「MW で検索」（/buy/?q=JAN を新しいタブで開く）
   ・ブックマークレットは**開いているページだけ**を読み、
     商品番号（products/…/NNNNNNNN.jpg）と JAN の組を作って pj に渡す
   ・JAN が決まらない画面では**何も送らない**
   ・pj は #mwpic=… を読んで帯を出し、**人が「取り込む」を押してから**
     今までの口（POST /mw/img）で取り込む
   ・鍵はブックマークに入れない（pj を開いて渡す） */
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
const META={ ok:true, n:1, rows:ROWS, seen:1, priced:1, left:0, per_run:120,
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
ok(a.length===1,'★★★候補の行に「MW で検索」がある');
ok(a[0].href==='https://matchingworld.asia/buy/?q='+JAN,
   '★★★会員サイトの JAN 検索（/buy/?q=JAN）を開く');
ok(a[0].tgt==='_blank','★★新しいタブで開く（MW の画面を残す）');
ok(await p.evaluate((j)=>mwSearchUrl(j),JAN)
   ==='https://matchingworld.asia/buy/?q='+JAN,'★アドレスの作り方');

console.log('\n=== ブックマークレット ===');
const code=await p.evaluate(()=>mwMarkCode());
console.log('   長さ '+code.length+' / '+code.slice(0,60)+'…');
ok(code.indexOf('javascript:')===0,'★★★javascript: で始まる1行');
ok(code.length<2600,'★短い（ブックマークに入る）');
const src=decodeURIComponent(code.replace(/^javascript:/,''));
ok(src.indexOf('syncKey')<0&&src.indexOf('X-PJ-Key')<0&&src.indexOf("'k'")<0,
   '★★★鍵はブックマークに入らない（pj を開いて渡す）');
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
const ROW=(id,name,jan)=>'<tr><td><a href="#"><img src="/products/'
  +(Math.floor(id/10000)*10000)+'/'+(Math.floor(id/100)*100)+'/'+id+'.jpg"></a></td>'
  +'<td>'+name+(jan?('<br>JAN'+jan):'')+'</td><td>在庫 9</td></tr>';
const run=async(q)=>await q.evaluate((s)=>{
  window.__open=null;
  window.open=function(u){ window.__open=u; return { focus:function(){} }; };
  window.__alert=null;
  window.alert=function(m){ window.__alert=m; };
  eval(s);
  return { url:window.__open, alert:window.__alert };
},src);

const ctx=p.context();
let q=await mwPage(ctx,'https://matchingworld.asia/buy/?q='+JAN,
  HTML(ROW(10970132,'ゼルダの伝説 時のオカリナ'),
    '<script>var d={jan:"'+JAN+'"};</script>'));
let r=await run(q);
console.log('   '+JSON.stringify(r));
ok(!!r.url&&r.url.indexOf('#mwpic=')>0,'★★★pj を開いて渡す');
ok(decodeURIComponent(r.url.split('#mwpic=')[1])===JAN+':'+ID,
   '★★★JAN と商品番号の組を渡す（JAN は検索のアドレスから取る）');
ok(r.url.indexOf('matchingworld')<0,'★MW のページには何も残さない');
await q.close();

console.log('\n=== 複数の社が出たとき ===');
q=await mwPage(ctx,'https://matchingworld.asia/buy/?q='+JAN,
  HTML(ROW(10970132,'ゼルダ（M200）')+ROW(10970140,'ゼルダ（MC02）')));
r=await run(q);
console.log('   '+decodeURIComponent(String(r.url).split('#mwpic=')[1]||''));
ok(decodeURIComponent(r.url.split('#mwpic=')[1])===JAN+':10970132.10970140',
   '★★★同じ JAN の写真はまとめて渡す（社が複数でも）');
await q.close();

console.log('\n=== JAN が違う行は送らない ===');
q=await mwPage(ctx,'https://matchingworld.asia/buy/?q='+JAN,
  HTML(ROW(10970132,'ゼルダ','4902370554922')+ROW(10970999,'別の商品','4902370550467')));
r=await run(q);
console.log('   '+decodeURIComponent(String(r.url).split('#mwpic=')[1]||''));
ok(decodeURIComponent(r.url.split('#mwpic=')[1])===JAN+':'+ID,
   '★★★JAN が一致するものだけを渡す（検索した JAN と違う行は外す）');
await q.close();

console.log('\n=== JAN が分からない画面では何も送らない ===');
q=await mwPage(ctx,'https://matchingworld.asia/buy/list/',
  HTML(ROW(10970132,'なにかの商品')));
r=await run(q);
console.log('   '+JSON.stringify(r));
ok(!r.url,'★★★当てずっぽうでは送らない');
ok(/JAN で検索した画面/.test(String(r.alert)),
   '★★どうすればよいかを知らせる');
await q.close();

console.log('\n=== 写真が1枚も無い画面 ===');
q=await mwPage(ctx,'https://matchingworld.asia/buy/?q='+JAN,HTML(''));
r=await run(q);
ok(!r.url&&!!r.alert,'★★写真が無ければ送らない');
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

console.log('\n=== 作業者用の端末でも送れる（A）===');
await p.evaluate(()=>{ try{ localStorage.clear(); }catch(e){} });
await p.reload(); await p.waitForTimeout(300);
await setup('staff');
await openCsvBoxes(p);
await p.evaluate((j)=>{
  location.hash='#mwpic='+encodeURIComponent(j+':10970132');
  mwPicHash();
},JAN);
await p.waitForTimeout(200);
ok(await p.evaluate(()=>$('mwPicBar').style.display!=='none'),
   '★★★作業者用の端末でも帯が出る');
await p.evaluate(()=>{ $('mwPicGo').click(); });
await p.waitForTimeout(900);
st=await p.evaluate(()=>({ posts:window.__img.length,
  text:($('mwPicText').innerText||'').replace(/\s+/g,' ') }));
console.log('   '+JSON.stringify(st));
ok(st.posts>=1,'★★★作業者用の端末でも取り込める（7.94・選択A）');
ok(/取り込みました/.test(st.text),'★★結果も出る');
await T.done();
})();
