/* 画面：お一人の上限を Shopify でも抑える（8.83）

   カジの依頼（2026-11-20）「テーマで数量を抑える」
   ここで見ること
     ① pj の⚙（既定オフ）・手で作る CSV のタグ・「商品を直す」の結果の行
     テーマに貼るスクリプト（shopify/snippets/member-qty-guard.liquid の中身）を
     作り物の店のページで動かして見る：
     ② 商品ページ：数量の欄を上限までにする・超える「カートに入れる」を止める
     ③ カートに入っている数も数える
     ④ カートが上限を超えていたら、数量を減らして知らせる（くり返さない）
     ⑤ テーマがカートを書き換えたあと（横から出るカート）も数え直す
     ⑥ カートのページの数量の欄（まだ送っていない数）も見る
     ⑦ 会員用でない商品のページ・カートでは何もしない
     ⑧ 同じページの別の商品（おすすめ）は触らない */
const { harness } = require('./lib');
const fs=require('fs');
const path=require('path');
const T = harness('画面：お一人の上限を Shopify でも抑える（8.83）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',(d)=>d.accept());

console.log('=== ① pj の⚙・CSV のタグ・「商品を直す」の結果 ===');
{
  const t=await p.evaluate(()=>{
    const row={ jan:'4902370551011', kishu:'NS', grades:'light,standard,premium',
                amz_name:'テストのゲーム' };
    const off=!!$('subShopQtyOn')&&$('subShopQtyOn').checked===false;
    const by0=mwSubOpt().qtyBy;
    const tags0=PJ_SHOPCSV.tagsOf(row,mwSubOpt());
    $('subShopQtyOn').checked=true;
    const by1=mwSubOpt().qtyBy;
    const tags1=PJ_SHOPCSV.tagsOf(row,mwSubOpt());
    $('subLimQStandard').value='3';
    const by2=mwSubOpt().qtyBy;
    $('subLimQStandard').value='2';
    $('subShopQtyOn').checked=false;
    subBoxShow({ ok:true, on:false, cols:true, ready:true, all:5, box_n:0, todo:3,
      qty_on:true, qcol:true, qty_n:3, over:{ want:[], found:0, miss:[] },
      items:[{ jan:'4902370551011', name:'テストのゲーム', g:100, real_g:100,
               box:false, why:'買える数', q:'light-1,standard-2', ship:'クリックポスト' }] },
      { done:0, fail:0, errors:[] },false);
    const line=($('subBoxQtyLine')||{}).textContent||'';
    const item=(document.querySelector('[data-boxitem]')||{}).textContent||'';
    subBoxShow({ ok:true, on:false, cols:true, ready:true, all:5, box_n:0, todo:0,
      qty_on:true, qcol:false, qty_n:0, over:{ want:[], found:0, miss:[] }, items:[] },
      { done:0, fail:0, errors:[] },false);
    const line2=($('subBoxQtyLine')||{}).textContent||'';
    return { off, by0, by1, by2, tags0, tags1, line, item, line2,
      chk:ADV_SUBCHK.indexOf('subShopQtyOn')>=0,
      note:($('subShopQtyNote')||{}).textContent||'' };
  });
  console.log('   '+JSON.stringify(t.by1)+'　'+t.tags1.filter((x)=>/^qty-/.test(x)).join(','));
  ok(t.off,'★★★⚙「お一人の上限を Shopify の商品にも入れる」は既定オフ');
  ok(t.by0===null&&t.tags0.every((x)=>!/^qty-/.test(x)),
     '★★★オフのあいだは、CSV のタグに何も足さない');
  ok(JSON.stringify(t.by1)==='{"monitor":1,"light":1,"standard":2,"premium":5}',
     '★★★オンにすると、⚙の上限をタグの元にする');
  ok(t.tags1.filter((x)=>/^qty-/.test(x)).join(',')==='qty-light-1,qty-standard-2,qty-premium-5',
     '★★★手で作る CSV にも、同じ上限のタグが入る（その商品のプランだけ）');
  ok(t.by2.standard===3,'★★⚙の上限の欄を変えると、タグの数も変わる');
  ok(t.chk,'★pj-sync に送るまとまりに入っている');
  ok(/付けます/.test(t.line)&&/3件/.test(t.line),
     '★★「確かめる」の結果に、上限のタグを直す件数が出る');
  ok(/直す所：買える数/.test(t.item)&&/light-1,standard-2/.test(t.item),
     '★★直す品に、直す所と付けるタグが出る');
  ok(/migrate-0070/.test(t.line2),'★D1 に migrate-0070 がまだなら、そのことを出す');
  ok(/会員用でない商品/.test(t.note)&&/運営のチャンネルに知らせます/.test(t.note),
     '★欄の説明に、会員用の商品だけ・超えた注文は知らせる、と書いてある');
}

/* ---- テーマに貼るスクリプトを、作り物の店で動かす ---- */
const src=fs.readFileSync(path.join(__dirname,'..','shopify','snippets',
  'member-qty-guard.liquid'),'utf8');
const a=src.indexOf('/* pj-qty-guard:start */'), b=src.indexOf('/* pj-qty-guard:end */');
const GUARD=src.slice(a,b);
ok(a>0&&b>a&&/fixCart/.test(GUARD),'★スニペットからスクリプトを取り出せる');

const ctx=p.context();
/* 店の状態（カート）と、届いた呼び出しの記録。 */
let shop=null;
const html=(o)=>'<!doctype html><html><body>'
  +(o.form===false?'':('<form id="pf" action="/cart/add" method="post">'
    +'<input type="hidden" name="product-id" value="'+(o.formPid||111)+'">'
    +'<input type="hidden" name="id" value="v1">'
    +'<button type="submit" id="addbtn">カートに入れる</button></form>'
    +'<input name="quantity" form="pf" id="qty" type="number" value="1" min="1">'))
  +(o.other?('<form id="of" action="/cart/add" method="post">'
    +'<input type="hidden" name="product-id" value="999">'
    +'<input name="quantity" id="oqty" type="number" value="7">'
    +'<button type="submit" id="obtn">おすすめを入れる</button></form>'):'')
  +(o.updates?('<form action="/cart" method="post" id="cf">'
    +o.updates.map((v,i)=>'<input name="updates[]" id="u'+i+'" value="'+v+'">').join('')
    +'<button type="submit" name="checkout" id="cobtn">ご購入手続きへ</button></form>'):'')
  +'<a href="/checkout" id="co">ご購入手続きへ</a>'
  /* テーマの動き：AJAX でカートに入れる（フォーム自身で受ける）。 */
  +'<script>window.__adds=0;window.__co=0;'
  +'["pf","of"].forEach(function(id){var f=document.getElementById(id);if(!f)return;'
  +'f.addEventListener("submit",function(e){e.preventDefault();window.__adds++;'
  +'fetch("/cart/add.js",{method:"POST",body:JSON.stringify({pid:+this.querySelector("[name=\\"product-id\\"]").value,'
  +'quantity:+(new FormData(this).get("quantity")||1)})});});});'
  +'document.addEventListener("click",function(e){var t=e.target.closest("#co,#cobtn");'
  +'if(t){e.preventDefault();window.__co++;}});'
  +'var cf=document.getElementById("cf");if(cf)cf.addEventListener("submit",function(e){e.preventDefault();});'
  +'</script>'
  +'<script type="application/json" id="pj-qty-data">'+JSON.stringify(o.data())+'</script>'
  +'<script>'+GUARD+'</script></body></html>';
const open=async(o)=>{
  const g=await ctx.newPage();
  const errs=[]; g.on('pageerror',(e)=>errs.push(String(e)));
  shop={ cart:(o.cart||[]).map((x)=>Object.assign({},x)), calls:[], loads:0,
         stuck:!!o.stuck, max:o.max||{} };
  /* ページを開くたびに、そのときのカートから Liquid のデータを作る。 */
  const data=()=>({ product:o.product||null,
    cart:shop.cart.map((x)=>({ key:x.key, pid:x.pid, qty:x.qty,
                               max:shop.max[x.pid]||0 })) });
  await g.route('https://shop.test/**',async(route)=>{
    const req=route.request(), u=new URL(req.url());
    const J=(v)=>route.fulfill({ status:200, contentType:'application/json',
                                 body:JSON.stringify(v) });
    if(u.pathname==='/cart.js')
      return J({ items:shop.cart.map((x)=>({ key:x.key, product_id:x.pid,
                                             quantity:x.qty })) });
    if(u.pathname==='/cart/change.js'){
      const b=JSON.parse(req.postData()||'{}');
      shop.calls.push({ u:'change', id:b.id, quantity:b.quantity });
      if(!shop.stuck){
        const l=shop.cart.filter((x)=>x.key===b.id)[0];
        if(l)l.qty=b.quantity;
        shop.cart=shop.cart.filter((x)=>x.qty>0);
      }
      return J({ ok:true });
    }
    if(u.pathname==='/cart/add.js'){
      const b=JSON.parse(req.postData()||'{}');
      shop.calls.push({ u:'add', pid:b.pid, quantity:b.quantity });
      const l=shop.cart.filter((x)=>x.pid===b.pid)[0];
      if(l)l.qty+=b.quantity;
      else shop.cart.push({ key:'k'+b.pid, pid:b.pid, qty:b.quantity });
      return J({ ok:true });
    }
    shop.loads++;
    return route.fulfill({ status:200, contentType:'text/html; charset=utf-8',
      body:html(Object.assign({},o,{ data })) });
  });
  await g.goto('https://shop.test/'+(o.path||'products/sub-4902370551011'));
  await g.waitForTimeout(250);
  return { g, errs };
};
const msg=async(g)=>await g.evaluate(()=>{
  const e=document.getElementById('pj-qty-msg'); return e?e.textContent:''; });
const note=async(g)=>await g.evaluate(()=>{
  const e=document.getElementById('pj-qty-note'); return e?e.textContent:''; });

console.log('\n=== ② 商品ページ：数量を上限までにする（ライト・1点まで）===');
{
  const { g, errs }=await open({ product:{ id:111, max:1 }, max:{ 111:1 } });
  const t=await g.evaluate(()=>({ max:document.getElementById('qty').getAttribute('max') }));
  ok(t.max==='1','★★★数量の欄の上限が 1 になる');
  ok(/^お一人 1点まで$/.test(await note(g)),'★★★商品ページに「お一人 1点まで」と出る');
  const v=await g.evaluate(()=>{ const q=document.getElementById('qty');
    q.value='3'; q.dispatchEvent(new Event('input',{bubbles:true})); return q.value; });
  ok(v==='1','★★★3 と入れても、上限（1）に戻る');
  await g.click('#addbtn'); await g.waitForTimeout(700);
  ok(shop.calls.filter((x)=>x.u==='add').length===1&&shop.cart[0].qty===1,
     '★★上限までの「カートに入れる」は通す');
  console.log('   '+await note(g));
  ok(/カートに 1点 入っています・これ以上は入れられません/.test(await note(g)),
     '★★★カートに入れたあと、「これ以上は入れられません」と出る');
  await g.click('#addbtn'); await g.waitForTimeout(400);
  ok(shop.calls.filter((x)=>x.u==='add').length===1
     &&await g.evaluate(()=>window.__adds)===1,
     '★★★上限を超える「カートに入れる」は止める（テーマの処理も動かさない）');
  console.log('   '+await msg(g));
  ok(/この商品はお一人 1点までです。（カートに 1点 入っています）/.test(await msg(g)),
     '★★★止めた理由を出す');
  ok(shop.calls.filter((x)=>x.u==='change').length===0&&shop.loads===1,
     '★上限以内なら、カートを書き換えない・開き直さない');
  ok(errs.length===0,'★スクリプトのエラーが無い');
  await g.close();
}

console.log('\n=== ③ カートに入っている数も数える（スタンダード・2点まで）===');
{
  const { g }=await open({ product:{ id:111, max:2 }, max:{ 111:2 },
    cart:[{ key:'k111', pid:111, qty:1 }] });
  ok(await g.evaluate(()=>document.getElementById('qty').getAttribute('max'))==='1',
     '★★★カートに 1点あるので、数量の欄はあと 1点まで');
  ok(/お一人 2点まで（カートに 1点 入っています・あと 1点）/.test(await note(g)),
     '★★★「あと 1点」と出る');
  await g.evaluate(()=>{ document.getElementById('qty').value='2'; });
  await g.evaluate(()=>document.getElementById('pf').requestSubmit());
  await g.waitForTimeout(300);
  ok(shop.calls.filter((x)=>x.u==='add').length===0,
     '★★★カートの分と合わせて超える数量は止める');
  await g.close();
}

console.log('\n=== ④ カートが上限を超えていたら、数量を減らして知らせる ===');
{
  const { g, errs }=await open({ path:'cart', form:false, max:{ 111:1, 222:3 },
    cart:[{ key:'k111', pid:111, qty:3 }, { key:'k222a', pid:222, qty:2 },
          { key:'k222b', pid:222, qty:2 }, { key:'k9', pid:999, qty:8 }] });
  await g.waitForTimeout(600);
  const ch=shop.calls.filter((x)=>x.u==='change');
  console.log('   '+JSON.stringify(ch)+'　開いた回数 '+shop.loads);
  ok(ch.some((x)=>x.id==='k111'&&x.quantity===1),
     '★★★上限 1点の商品を 3点 → 1点に減らす');
  ok(ch.some((x)=>x.id==='k222b'&&x.quantity===1)&&!ch.some((x)=>x.id==='k222a'),
     '★★★同じ商品が2行あるときは、合計で数えて後ろの行から減らす（2＋2→2＋1）');
  ok(!ch.some((x)=>x.id==='k9'),'★★★会員用でない商品（上限なし）は触らない');
  ok(shop.loads===2,'★★直したあと、1回だけ開き直す');
  ok(/カートの数量を、お一人の上限に合わせて直しました/.test(await msg(g)),
     '★★★直したことを知らせる');
  ok(ch.length===2,'★★開き直したあとは、もう書き換えない（くり返さない）');
  ok(shop.cart.filter((x)=>x.pid===999)[0].qty===8,'★ほかの商品の数量はそのまま');
  ok(errs.length===0,'★スクリプトのエラーが無い');
  await g.close();
}
{
  /* 直せなかったとき（店が数量を変えない）：くり返さず、知らせるだけ。 */
  const { g }=await open({ path:'cart', form:false, max:{ 111:1 }, stuck:true,
    cart:[{ key:'k111', pid:111, qty:3 }] });
  await g.waitForTimeout(900);
  const ch=shop.calls.filter((x)=>x.u==='change');
  ok(ch.length===1&&shop.loads===2,'★★★直せなくても、開き直しをくり返さない');
  ok(/上限を超えている商品があります/.test(await msg(g)),
     '★★直っていなければ「数量を減らしてください」と出す');
  await g.click('#co'); await g.waitForTimeout(200);
  ok(await g.evaluate(()=>window.__co)===0,
     '★★★超えたままでは「ご購入手続きへ」を押せない');
  await g.close();
}

console.log('\n=== ⑤ テーマがカートを書き換えたあとも数え直す ===');
{
  const { g }=await open({ path:'collections/all', form:false, max:{ 111:2 },
    cart:[{ key:'k111', pid:111, qty:1 }] });
  ok(shop.calls.length===0,'★はじめは上限以内なので何もしない');
  /* 横から出るカートで「＋」を押した（テーマの AJAX）。 */
  await g.evaluate(()=>fetch('/cart/change.js',{ method:'POST',
    body:JSON.stringify({ id:'k111', quantity:5 }) }));
  await g.waitForTimeout(1200);
  const ch=shop.calls.filter((x)=>x.u==='change');
  console.log('   '+JSON.stringify(ch));
  ok(ch.length===2&&ch[0].quantity===5&&ch[1].quantity===2,
     '★★★テーマが 5点にしたあと、上限（2点）に戻す');
  ok(shop.cart[0].qty===2&&shop.loads===2,'★★カートは 2点になり、開き直す');
  await g.click('#co'); await g.waitForTimeout(150);
  ok(await g.evaluate(()=>window.__co)===1,'★上限以内なら「ご購入手続きへ」は通す');
  await g.close();
}

console.log('\n=== ⑥ カートのページの数量の欄（まだ送っていない数）===');
{
  const { g }=await open({ path:'cart', form:false, max:{ 111:1 }, updates:[1,4],
    cart:[{ key:'k111', pid:111, qty:1 }, { key:'k9', pid:999, qty:4 }] });
  await g.evaluate(()=>{ document.getElementById('u0').value='4'; });
  await g.click('#cobtn'); await g.waitForTimeout(200);
  const t=await g.evaluate(()=>({ u0:document.getElementById('u0').value,
    u1:document.getElementById('u1').value, co:window.__co }));
  ok(t.co===0&&t.u0==='1','★★★欄に 4 と入れて進もうとしても止め、上限（1）に戻す');
  ok(t.u1==='4','★★会員用でない商品の欄は触らない');
  ok(/上限を超えている商品があります/.test(await msg(g)),'★理由を出す');
  await g.click('#cobtn'); await g.waitForTimeout(150);
  ok(await g.evaluate(()=>window.__co)===1,'★直ったあとは進める');
  await g.close();
}

console.log('\n=== ⑦ 会員用でない商品のページ・カートでは何もしない ===');
{
  const { g, errs }=await open({ product:null, max:{},
    cart:[{ key:'k9', pid:999, qty:30 }] });
  const t=await g.evaluate(()=>({ max:document.getElementById('qty').getAttribute('max'),
    native:/native code/.test(String(window.fetch)),
    note:!!document.getElementById('pj-qty-note') }));
  ok(t.max===null&&!t.note,'★★★海外向け・サービス商品のページでは、数量の欄を触らない');
  ok(t.native,'★★★テーマの通信にも手を入れない');
  await g.evaluate(()=>{ document.getElementById('qty').value='20'; });
  await g.click('#addbtn'); await g.waitForTimeout(300);
  ok(shop.calls.filter((x)=>x.u==='add'&&x.quantity===20).length===1
     &&shop.calls.filter((x)=>x.u==='change').length===0,
     '★★★何点でも入れられる・カートも書き換えない');
  await g.click('#co'); await g.waitForTimeout(100);
  ok(await g.evaluate(()=>window.__co)===1&&errs.length===0,
     '★「ご購入手続きへ」もそのまま');
  await g.close();
}

console.log('\n=== ⑧ 同じページの別の商品（おすすめ）は触らない ===');
{
  const { g }=await open({ product:{ id:111, max:1 }, max:{ 111:1 }, other:true });
  const t=await g.evaluate(()=>({ q:document.getElementById('qty').getAttribute('max'),
    o:document.getElementById('oqty').getAttribute('max') }));
  ok(t.q==='1'&&t.o===null,'★★★このページの商品の欄だけ上限を付ける');
  await g.click('#obtn'); await g.waitForTimeout(300);
  ok(shop.calls.filter((x)=>x.u==='add'&&x.pid===999&&x.quantity===7).length===1,
     '★★★別の商品（会員用でない）は 7点でも入れられる');
  await g.close();
}

console.log('\n=== 版 ===');
{
  const v=await p.evaluate(()=>APP_V);
  const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  ok(sw.indexOf("'pj-pricing-"+v+"'")>=0&&+v.slice(1)>=332,
     '★sw.js と APP_V がそろっている（'+v+'）');
}
await T.done();
})();
