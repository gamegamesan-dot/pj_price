/* 画面：会員向けの自動配信の⚙と「試しに配信内容を作る」（8.80）

   カジの依頼（2026-11-20）
     ・⚙に「自動配信オン／オフ」を付ける。時刻（1日2回）と1回の上限も⚙
     ・「試しに配信内容を作る（投稿しない）」で、次の配信内容を pj の画面で
       見られるようにする
   ここで見ること
     ① ⚙の欄がある（既定はオフ・12時と20時・上限20件・写真のチェックはオフ）
     ② 入れたらすぐ pj-sync に送る（pj-sync はこの設定で動く）
     ③ 「試しに配信内容を作る」で、プランごとの中身・止めた理由の件数・
        止めた行（理由つき）・Shopify の用意が出る
     ④ 理由を押すと、その理由の行だけに絞れる
     ⑤ CSV では出さない／作業者のキーでは押せない
     ⑥ 鍵や宛先を画面に出さない */
const { harness } = require('./lib');
const fs=require('fs');
const path=require('path');
const T = harness('画面：会員向けの自動配信の⚙と試し（8.80）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const setup=async()=>await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__post=[]; window.__calls=[];
  window.__srv={ at:'2026-11-20T00:00:00Z', settings:{} };
  window.__dl=0;
  const real=window.fetch;
  const res=(v,st)=>new Response(JSON.stringify(v),{status:st||200});
  const stop=(i,why,ja,on)=>({ jan:'49023705520'+String(10+i),
    name:'止めた商品 その'+i, price:3500, qty:5, gross:900, net:on?-120:1500,
    rate:20, ship:'', on:false, why:why, why_ja:ja });
  const stops=[];
  for(let i=0;i<70;i++)stops.push(stop(i,['no_dim'],'採寸がない'));
  stops.push(stop(70,['name'],'商品名が崩れている（英数字だけ）'));
  stops.push(Object.assign(stop(71,['shop'],'Shopify に商品を作れなかった'),
    { shop_err:'Shopify が受け付けませんでした：Title is invalid' }));
  for(let i=72;i<80;i++)stops.push(stop(i,['loss'],'利益がマイナス',1));
  window.__try={ ok:true, dry:true, ran:true, on:false, slot:'2026-11-20@13',
    hours:[12,20], max:20, cand_n:120, ok_n:40, sent:7, edited:1, sold_out:1,
    stop_n:80, act_n:72, cut:3, trim:2, keep_max:200,
    tally:{ no_dim:70, name:1, shop:1, loss:8 },
    skip:{ 'Amazon 本体あり':4 },
    shop:{ ready:true, why:'', need:6, zero:1, back:0, key:true, cols:true },
    plans:[
      { key:'monitor', name:'モニター', add:5, edit:1, out:1,
        items:[0,1,2,3,4].map((i)=>({ jan:'49023705510'+String(10+i),
          name:'テストのゲームソフト その'+i, price:3500+i, qty:5, left:5,
          gross:4300, net:3300, ship:'クリックポスト', is_new:i<4,
          plan_from:'monitor' })),
        out_items:[{ jan:'4902370559999', name:'在庫が切れた商品' }] },
      { key:'light', name:'ライト', add:2, edit:0, out:0,
        items:[0,1].map((i)=>({ jan:'49023705530'+String(10+i),
          name:'限定版のゲーム その'+i, price:6000, qty:3, left:3, gross:2000,
          net:null, ship:'宅急便コンパクト', is_new:true, plan_from:'light' })),
        out_items:[] }],
    stops_all:stops };
  window.__stat={ ok:true, on:false, hours:[12,20], night:[3], bad:[],
    hours_text:'12時・20時', weekend:true, max:20, pic:false,
    next:{ add:0, hour:20, dow:5 }, now_hour:13,
    last:{ at:'2026-11-20T03:07:00Z', at_jst:'2026-11-20 12:07', sent:4,
           stop_n:60, sold_out:0, errors:[] },
    shop:{ key:true, host:true, cols:false }, bot:true, ops:true,
    ops_own:false, table_ok:true };
  window.fetch=async(u,i)=>{
    const url=String(u), op=i||{};
    window.__calls.push(String(op.method||'GET')+' '+url.replace(/^https?:\/\/[^/]+/,''));
    if(/\/whoami/.test(url))
      return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url)){
      if(String(op.method||'')==='POST'){
        const b=JSON.parse(String(op.body||'{}'));
        window.__post.push(b);
        Object.assign(window.__srv.settings,b.settings||{});
        return res({ ok:true, at:window.__srv.at, settings:window.__srv.settings });
      }
      return res({ ok:true, at:window.__srv.at, settings:window.__srv.settings });
    }
    if(/\/sub\/auto\/try/.test(url)){
      if(window.__tryFail)return res({ ok:false },500);
      return res(window.__try);
    }
    if(/\/sub\/auto/.test(url))return res(window.__stat);
    if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, n:0, rows:[] });
    if(/\/mw\/(amz|buy)/.test(url))return res({ ok:true, rows:[], n:0 });
    return real(u,i);
  };
  /* ダウンロードが起きないことを見る。 */
  const dl0=window.csvDownload;
  window.csvDownload=function(){ window.__dl++; return dl0?undefined:undefined; };
  syncRole='admin'; roleApply();
});
await setup();

console.log('=== ① ⚙の欄（既定）===');
{
  const t=await p.evaluate(()=>({
    on:!!$('subAutoOn')&&$('subAutoOn').checked===false,
    hours:($('subAutoHours')||{}).value,
    wk:!!$('subAutoWeekend')&&$('subAutoWeekend').checked===true,
    max:($('subAutoMax')||{}).value,
    pic:!!$('subAutoPic')&&$('subAutoPic').checked===false,
    admin:!!$('subShopAdmin'),
    btn:($('subAutoTryBtn')||{}).textContent,
    txt:($('subAutoTxt')||{}).textContent,
    mod:typeof SUBAUTO==='object'&&typeof SUBAUTO.gate==='function',
    inSub:['subAutoHours','subAutoMax','subShopAdmin'].every((k)=>
      ADV_SUB.indexOf(k)>=0&&CSV_CFG_IDS.indexOf(k)>=0),
    inChk:['subAutoOn','subAutoWeekend','subAutoPic'].every((k)=>
      ADV_SUBCHK.indexOf(k)>=0&&CSV_CFG_IDS.indexOf(k)<0),
    note:document.body.innerHTML.indexOf('0時〜8時（夜中）は配信しません')>=0 }));
  console.log('   '+JSON.stringify(t));
  ok(t.on,'★★★⚙に「自動配信を使う」がある（既定はオフ）');
  ok(t.hours==='12,20','★★★配信の時刻は既定で 12時と20時（⚙で変えられる）');
  ok(t.note,'★★夜中は配信しないことを欄のそばに書いてある');
  ok(t.wk&&t.max==='20','★★土日も配信する（既定オン）・1回の上限 20件');
  ok(t.pic,'★★★「写真が無い品は配信しない」は既定オフ');
  ok(t.admin,'★Shopify の管理用ドメインの欄がある');
  ok(/試しに配信内容を作る（投稿しない）/.test(t.btn),
     '★★★「試しに配信内容を作る（投稿しない）」のボタンがある');
  ok(t.txt==='いまは止めています','★オフのときは「いまは止めています」');
  ok(t.mod,'★shared/subauto.js を読み込んでいる');
  ok(t.inSub&&t.inChk,'★★★pj-sync に送るまとまりに入っている');
  const html=await p.evaluate(()=>document.body.innerHTML);
  ok(!/SHOPIFY_CLIENT_SECRET[^<]{0,5}=|shpat_|webhooks\/\d/.test(html),
     '★鍵の値や宛先を画面に書いていない（名前だけ）');
}

console.log('\n=== ② 入れたらすぐ pj-sync に送る ===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[];
    $('subAutoOn').checked=true;
    $('subAutoOn').dispatchEvent(new Event('change',{bubbles:true}));
    $('subAutoWeekend').checked=false;
    $('subAutoWeekend').dispatchEvent(new Event('change',{bubbles:true}));
    $('subAutoHours').value='9,21';
    $('subAutoHours').dispatchEvent(new Event('input',{bubbles:true}));
    $('subAutoMax').value='12';
    $('subAutoMax').dispatchEvent(new Event('input',{bubbles:true}));
    $('subShopAdmin').value='omakase-ship.myshopify.com';
    $('subShopAdmin').dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise((x)=>setTimeout(x,1600));
    let o={}; try{ o=JSON.parse(localStorage.getItem(CSV_CFG_KEY)||'{}'); }catch(e){}
    return { n:window.__post.length, s:window.__srv.settings,
             txt:$('subAutoTxt').textContent, loc:o };
  });
  console.log('   '+JSON.stringify({ on:t.s.subAutoOn, wk:t.s.subAutoWeekend,
    hours:t.s.subAutoHours, max:t.s.subAutoMax, admin:t.s.subShopAdmin }));
  ok(t.n>=1,'★★★pj-sync に送る');
  ok(t.s.subAutoOn===true&&t.s.subAutoWeekend===false,
     '★★★オン／オフが真偽値で pj-sync に入る');
  ok(t.s.subAutoHours==='9,21'&&String(t.s.subAutoMax)==='12'
     &&t.s.subShopAdmin==='omakase-ship.myshopify.com',
     '★★★時刻・上限・管理用ドメインが pj-sync に入る');
  ok(t.txt==='動かしています','★オンにすると「動かしています」');
  ok(t.loc.subAutoOn===true&&t.loc.subAutoHours==='9,21',
     '★端末にも控える');
  await p.reload({ waitUntil:'load' });
  await setup();
  const r=await p.evaluate(()=>({ on:$('subAutoOn').checked,
    h:$('subAutoHours').value, m:$('subAutoMax').value,
    wk:$('subAutoWeekend').checked }));
  ok(r.on===true&&r.h==='9,21'&&r.m==='12'&&r.wk===false,
     '★★開き直しても残る');
}

console.log('\n=== ③ 試しに配信内容を作る ===');
{
  await p.evaluate(async()=>{ window.__calls=[]; await subAxTry(); });
  await p.waitForTimeout(300);
  const t=await p.evaluate(()=>({
    calls:window.__calls.filter((c)=>/sub\/auto/.test(c)),
    box:$('subAutoBox').textContent,
    plans:Array.from(document.querySelectorAll('[data-axplan]')).map((e)=>
      e.getAttribute('data-axplan')+'｜'+e.textContent),
    items:document.querySelectorAll('[data-axitem]').length,
    first:(document.querySelector('[data-axitem]')||{}).textContent,
    stops:document.querySelectorAll('[data-stop]').length,
    tabs:Array.from(document.querySelectorAll('[data-axwhy]')).map((e)=>e.textContent),
    stat:$('subAutoStat').textContent,
    btn:$('subAutoTryBtn').disabled,
    dl:window.__dl }));
  console.log('   呼び出し '+JSON.stringify(t.calls));
  console.log('   '+t.box.slice(0,150));
  ok(t.calls[0]==='POST /sub/auto/try'&&t.calls.indexOf('GET /sub/auto')>=0,
     '★★★pj-sync の試しの口を呼ぶ（そのあと様子も読む）');
  ok(/次の配信内容（試し・何も投稿していません）/.test(t.box),
     '★★★「何も投稿していません」と出す');
  ok(/候補 120件 → チェックを通った 40件 → 新しく出すカード 7枚/.test(t.box)
     &&/売り切れにする商品 1件/.test(t.box),'★★★件数のまとめ');
  ok(/1回の上限（20件）で 3件を次の回に回しました/.test(t.box),
     '★★1回の上限で回した件数');
  ok(/出しておく商品の上限（200件）を超えるので、古い順に 2件を受付終了にします/.test(t.box),
     '★★出しておく上限を超えるぶん（古い順に受付終了）が分かる');
  ok(/自動配信はオフです/.test(t.box),'★オフのときは「オンにすると配信されます」');
  ok(t.plans.length===2&&/モニター　新しく出す 5件・書き換え 1件・完売にする 1件/.test(t.plans[0])
     &&/ライト　新しく出す 2件/.test(t.plans[1]),'★★★プランごとの件数');
  ok(t.items===7,'★★★新しく出す商品を1行ずつ出す');
  ok(/テストのゲームソフト その0/.test(t.first)&&/¥3,500/.test(t.first)
     &&/クリックポスト/.test(t.first)&&/Shopify に新しく作る/.test(t.first),
     '★★商品名・会員価格・送り方・Shopify に作るかが分かる');
  ok(/完売にするカード：在庫が切れた商品（4902370559999）/.test(t.box),
     '★★完売にするカードが分かる');
  ok(/Shopify　つながります/.test(t.box)&&/会員用の商品を作る・直す 6件/.test(t.box)
     &&/在庫を0にする 1件/.test(t.box),'★★Shopify の用意と件数');
  ok(/配信前のチェックで止めた行　80件/.test(t.box),'★★★止めた件数');
  console.log('   理由 '+JSON.stringify(t.tabs));
  ok(t.tabs.join('|')==='すべて|利益がマイナス 8|商品名が崩れている 1|採寸がない 70|Shopify に商品を作れなかった 1',
     '★★★止めた理由ごとの件数（決まった並び）');
  ok(t.stops===60,'★止めた行は 60行ずつ出す');
  ok(/手を打てば出せる行）は 72件/.test(t.box),'★手を打てる行の件数');
  ok(/振り分けの決まりで対象外　Amazon 本体あり 4件/.test(t.box),
     '★振り分けの決まりで対象外の件数');
  ok(/自動配信：止めています/.test(t.stat)&&/次の回：今日 20:07 ごろ/.test(t.stat)
     &&/夜中なので使わない時刻：3時/.test(t.stat)
     &&/最後の回（2026-11-20 12:07）：配信 4件/.test(t.stat),
     '★★いまの設定・次の回・最後の回が出る');
  ok(/Shopify の鍵：登録済み/.test(t.stat)&&/D1（migrate-0067）：まだ/.test(t.stat)
     &&/運営への報告：社内用のチャンネル/.test(t.stat),
     '★★鍵・D1・報告の宛先が「登録してあるか」だけ出る');
  ok(t.btn===false,'★終わったらボタンを戻す');
  ok(t.dl===0,'★★★CSV を書き出さない（リストの流出を避ける）');
}

console.log('\n=== ④ 理由で絞る・続きを出す ===');
{
  const t=await p.evaluate(()=>{
    const n0=document.querySelectorAll('[data-stop]').length;
    $('subAxMoreBtn').click();
    const n1=document.querySelectorAll('[data-stop]').length;
    document.querySelector('[data-axwhy="name"]').click();
    const nm=Array.from(document.querySelectorAll('[data-stop]')).map((e)=>e.textContent);
    document.querySelector('[data-axwhy="shop"]').click();
    const sh=Array.from(document.querySelectorAll('[data-stop]')).map((e)=>e.textContent);
    document.querySelector('[data-axwhy="loss"]').click();
    const ls=document.querySelectorAll('[data-stop]').length;
    const lsTxt=(document.querySelector('[data-stop]')||{}).textContent;
    document.querySelector('[data-axwhy=""]').click();
    const all=document.querySelectorAll('[data-stop]').length;
    return { n0, n1, nm, sh, ls, lsTxt, all };
  });
  console.log('   '+JSON.stringify({ n0:t.n0, n1:t.n1, nm:t.nm.length, sh:t.sh.length,
    ls:t.ls, all:t.all }));
  ok(t.n0===60&&t.n1===80,'★★「あと ◯件を出す」で続きが出る');
  ok(t.nm.length===1&&/商品名が崩れている（英数字だけ）/.test(t.nm[0]),
     '★★★理由を押すと、その理由の行だけになる');
  ok(t.sh.length===1&&/Title is invalid/.test(t.sh[0]),
     '★★Shopify に作れなかった行は、Shopify の返事も出す');
  ok(t.ls===8&&/−¥120/.test(t.lsTxt),'★利益がマイナスの行は手残りが見える');
  ok(t.all===60,'★「すべて」で戻る');
}

console.log('\n=== ⑤ Shopify が使えないとき・失敗したとき ===');
{
  const t=await p.evaluate(async()=>{
    window.__try.shop={ ready:false, need:6, zero:0, back:0,
      why:'Shopify の鍵が pj-sync に登録されていません（SHOPIFY_CLIENT_ID／SHOPIFY_CLIENT_SECRET）' };
    await subAxTry();
    const a=$('subAutoBox').textContent;
    window.__tryFail=true;
    await subAxTry();
    const b=$('subAutoNote').textContent;
    window.__tryFail=false;
    return { a, b };
  });
  ok(/Shopify　まだ使えません：Shopify の鍵が pj-sync に登録されていません/.test(t.a)
     &&/新しい商品は配信されません/.test(t.a),
     '★★★Shopify が使えないと「新しい商品は配信されません」と大きく出す');
  ok(/作れませんでした/.test(t.b),'★★失敗を黙って捨てない');
}

console.log('\n=== ⑥ 作業者のキーでは押せない ===');
{
  const t=await p.evaluate(async()=>{
    syncRole='staff'; roleApply();
    window.__calls=[];
    await subAxTry();
    const r={ calls:window.__calls.filter((c)=>/sub\/auto/.test(c)).length,
              note:$('subAutoNote').textContent };
    syncRole='admin'; roleApply();
    return r;
  });
  console.log('   '+JSON.stringify(t));
  ok(t.calls===0&&/管理者用のキーが必要/.test(t.note),
     '★★★作業者のキーでは呼ばない（管理者だけ）');
}

console.log('\n=== ⑦ 版と読み込み ===');
{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  const a=(/var APP_V='(v\d+)'/.exec(html)||[])[1];
  const b=(/const V = 'pj-pricing-(v\d+)'/.exec(sw)||[])[1];
  console.log('   APP_V '+a+' / sw.js '+b);
  ok(a===b&&+a.slice(1)>=329,'★★★APP_V と sw.js の V が同じ（v329 以上）');
  ok(/<script src="\.\/shared\/subauto\.js"><\/script>/.test(html)
     &&sw.indexOf("'./shared/subauto.js'")>=0,
     '★★★shared/subauto.js を読み込み、オフラインの控えにも入れている');
}
await T.done();
})();
