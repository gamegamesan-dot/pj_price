/* 画面：「Shopify に読み込みました」で非公開にそろえて確かめる（8.89）
   ① 会員用（sub-）：印を付けたら、そのまま /shop/unlist（approve・handles）を呼ぶ
      → ボタンを2回押さなくてよい。確かめた件数・できなかった品と理由を出す
   ② 1点もの（one-）も同じ。一覧に「非公開を確かめ済み」／「配信しません：理由」
   ③ Shopify の鍵が無い・⚙ でオフのときは「配信しません」と言い切らない
   ④ 配信の案の上に、確かめていないので配らない品を出す
   ⑤ ⚙「Shopify で非公開を確かめた品だけを配る」（既定オン・端末をまたいで同じ） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：非公開を確かめてから配る（8.89）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const SUB=(o)=>Object.assign({ jan:'4902370550001', name:'商品1',
  asin:'B0AA000001', kishu:'NS', price:3400, max_qty:5, grades:'monitor',
  cost:3300, size_g:110, size_tier:'s', px_hand:0, loaded_at:'', sold:0, on:1 },o);
const ONE=(o)=>Object.assign({ one_id:1, handle:'one-1', name:'血界戦線 & BEYOND Vol.3',
  cond:'中古', price:4800, qty:1, sold:0, left:1, ship_kind:'small', pic:false,
  pre_at:'', open_at:'', loaded_at:'2026-11-22T01:00:00Z', put_at:'', off:0,
  shop_vis:'', shop_vis_ja:'', at:'2026-11-22T00:00:00Z' },o||{});

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__q=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body, m=String((i||{}).method||'GET');
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    const body=JSON.parse(String(b||'{}'));
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/shop\/unlist/.test(url)){
      window.__q.push({ u:'unlist', b:body });
      if(o.unlistErr)return res({ ok:false, error:'shop', detail:o.unlistErr });
      const vis={};
      (body.handles||[]).forEach((h)=>{ vis[h]=(o.vis||{})[h]||'ok'; });
      return res(Object.assign({ ok:true, approve:true, all:(body.handles||[]).length, vis:vis,
        ok_all:Object.keys(vis).filter((h)=>vis[h]==='ok').length, left:0, next:0, errors:[] },
        o.extra||{}));
    }
    if(/\/sub\/loaded/.test(url)){
      window.__q.push({ u:'loaded', b:body });
      return res({ ok:true, n:(body.jans||[]).length });
    }
    if(/\/sub\/plan/.test(url)){ window.__q.push({ u:'plan' });
      return res(o.plan||{ ok:true, plans:[] }); }
    if(/\/mw\/sub/.test(url)&&m==='GET')
      return res({ ok:true, table_ok:true, n:(o.rows||[]).length, rows:o.rows||[] });
    if(/\/one\/mark/.test(url)){
      window.__q.push({ u:'mark', b:body });
      return res({ ok:true, n:1 });
    }
    if(/\/one/.test(url)&&m==='GET'){
      window.__q.push({ u:'onelist' });
      return res({ ok:true, table_ok:true, n:(o.ones||[]).length, rows:o.ones||[],
        pre_grades:'premium', open_grades:'standard,premium', hours:24,
        vis_on:o.vis_on!==false });
    }
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
  switchTab('F');
},o||{});

console.log('=== ⑤ ⚙ の設定 ===');
await setup({});
await openCsvBoxes(p);
{
  const t=await p.evaluate(()=>({ el:!!$('subVisGate'), on:$('subVisGate').checked,
    adv:(typeof ADV_SUBCHK!=='undefined')&&ADV_SUBCHK.indexOf('subVisGate')>=0,
    label:(document.querySelector('label[for="subVisGate"]')||{}).textContent||'' }));
  ok(t.el&&t.on,'★★★⚙「Shopify で非公開を確かめた品だけを配る」があり、既定オン');
  ok(t.adv,'★★端末をまたいで同じ設定にする（pj-sync に保存する設定に入っている）');
  ok(/海外向けカタログ/.test(t.label),'★何を確かめるかを書いてある');
}

console.log('\n=== ① 会員用：印を付けたら、そのまま非公開にそろえて確かめる ===');
await setup({ rows:[SUB({}),SUB({ jan:'4902370550002', name:'商品2' })],
              vis:{ 'sub-4902370550002':'draft' } });
await p.evaluate(()=>{
  subLastCsvSave([{ jan:'4902370550001', name:'商品1' },{ jan:'4902370550002', name:'商品2' }]);
  return subLoadedGo();
});
await p.waitForTimeout(300);
await p.evaluate(()=>subLoadedPut());
await p.waitForTimeout(600);
{
  const t=await p.evaluate(()=>({ q:window.__q.map((x)=>x.u),
    un:(window.__q.filter((x)=>x.u==='unlist')[0]||{}).b,
    note:($('subNote').textContent||'').replace(/\s+/g,' ') }));
  console.log('   呼んだ順：'+t.q.join(' → '));
  console.log('   結果：'+t.note.slice(0,200));
  ok(t.q.indexOf('loaded')>=0&&t.q.indexOf('unlist')>t.q.indexOf('loaded'),
     '★★★印を付けたあと、続けて「非公開にそろえる」を呼ぶ（2回押さなくてよい）');
  ok(t.un&&t.un.kind==='sub'&&t.un.approve===true
     &&JSON.stringify(t.un.handles)==='["sub-4902370550001","sub-4902370550002"]',
     '★★★押した品の Handle（sub-<JAN>）だけを送る（os- は送らない）');
  ok(/非公開を確かめました：1件/.test(t.note),'★★★確かめた件数を出す');
  ok(/確かめられなかった 1件（配信しません）/.test(t.note)
     &&/sub-4902370550002（Shopify で下書き（draft）のままです）/.test(t.note),
     '★★★draft のままの品は「配信しません」と理由を出す');
  ok(t.q.lastIndexOf('plan')>t.q.indexOf('unlist'),'★★確かめたあとに配信の案を読み直す');
}
/* ⚙ でオフのとき */
await setup({ rows:[SUB({})], vis:{ 'sub-4902370550001':'active' } });
await p.evaluate(()=>{ $('subVisGate').checked=false;
  subLastCsvSave([{ jan:'4902370550001', name:'商品1' }]); return subLoadedGo(); });
await p.waitForTimeout(300);
await p.evaluate(()=>subLoadedPut());
await p.waitForTimeout(600);
{
  const note=await p.evaluate(()=>($('subNote').textContent||'').replace(/\s+/g,' '));
  ok(/確かめられなかった 1件/.test(note)&&!/配信しません/.test(note)&&/配信は止めません/.test(note),
     '★★⚙ でオフのときは「配信しません」と言わない');
  await p.evaluate(()=>{ $('subVisGate').checked=true; });
}

console.log('\n=== ② 1点もの（one-1）===');
await setup({ ones:[ONE({ shop_vis:'ok' })] });
await p.evaluate(()=>oneMarkGo(1,'loaded',1));
await p.waitForTimeout(600);
{
  const t=await p.evaluate(()=>({ q:window.__q.map((x)=>x.u),
    un:(window.__q.filter((x)=>x.u==='unlist')[0]||{}).b,
    note:($('oneNote2').textContent||'').replace(/\s+/g,' '),
    badge:(document.querySelector('#oneList [data-onevis]')||{}).textContent||'',
    vis:(document.querySelector('#oneList [data-onevis]')||{getAttribute:()=>''}).getAttribute('data-onevis') }));
  console.log('   呼んだ順：'+t.q.join(' → ')+'　'+t.note.slice(0,100)+'　印：'+t.badge);
  ok(t.q.join()==='mark,unlist,onelist','★★★印 → 非公開にそろえて確かめる → 一覧を読み直す');
  ok(t.un.kind==='one'&&JSON.stringify(t.un.handles)==='["one-1"]'&&t.un.approve===true,
     '★★★その1点だけ（one-1）を確かめる');
  ok(/非公開を確かめました：1件/.test(t.note),'★★★結果を出す');
  ok(t.vis==='ok'&&/非公開を確かめ済み/.test(t.badge),'★★★一覧に「非公開を確かめ済み」');
}
await setup({ ones:[ONE({ shop_vis:'active' })], vis:{ 'one-1':'active' } });
await p.evaluate(()=>oneMarkGo(1,'loaded',1));
await p.waitForTimeout(600);
{
  const t=await p.evaluate(()=>({
    note:($('oneNote2').textContent||'').replace(/\s+/g,' '),
    badge:(document.querySelector('#oneList [data-onevis]')||{}).textContent||'' }));
  ok(/確かめられなかった 1件（配信しません）/.test(t.note)&&/active/.test(t.note),
     '★★★active のままなら「配信しません」と理由');
  ok(/配信しません：Shopify で公開（active）のままです/.test(t.badge),'★★★一覧にも理由を出す');
}
console.log('\n=== ③ 鍵が無いとき ===');
await setup({ ones:[ONE({})], unlistErr:'Shopify の管理 API の鍵がありません', vis_on:false });
await p.evaluate(()=>oneMarkGo(1,'loaded',1));
await p.waitForTimeout(600);
{
  const t=await p.evaluate(()=>({
    note:($('oneNote2').textContent||'').replace(/\s+/g,' '),
    badge:(document.querySelector('#oneList [data-onevis]')||{}).textContent||'' }));
  console.log('   '+t.note.slice(0,140)+'　印：'+t.badge);
  ok(/確かめられませんでした/.test(t.note)&&/配信は止めません/.test(t.note)
     &&!/配信しません/.test(t.note),'★★★鍵が無いときは「配信は止めません」と正しく言う');
  ok(/配信は止めません/.test(t.badge)&&!/配信しません/.test(t.badge),
     '★★一覧の印も「配信しません」と言い切らない');
}

console.log('\n=== ④ 配信の案の上に、配らない品と理由 ===');
{
  const t=await p.evaluate(()=>({
    a:subVisHtml({ vis:{ on:true, n:1, rows:[{ jan:'4902370550002', handle:'sub-4902370550002',
        name:'商品2', why:'Shopify で下書き（draft）のままです' }] },
      plans:[{ key:'one_pre', vis_hold:[{ handle:'one-1', name:'血界戦線 & BEYOND Vol.3',
        why:'まだ Shopify で非公開を確かめていません' }] }] }).replace(/<[^>]+>/g,' '),
    b:subVisHtml({ vis:{ on:true, n:0, rows:[] }, plans:[] }).replace(/<[^>]+>/g,' '),
    c:subVisHtml({ vis:{ on:false, why:'no_key' } }).replace(/<[^>]+>/g,' '),
    d:subVisHtml({ vis:{ on:false, why:'off' } }).replace(/<[^>]+>/g,' '),
    e:subVisHtml({}) }));
  console.log('   '+t.a.replace(/\s+/g,' ').slice(0,200));
  ok(/配らない品 2件/.test(t.a)&&/sub-4902370550002/.test(t.a)&&/draft/.test(t.a)
     &&/one-1/.test(t.a),'★★★会員用と1点ものの、配らない品と理由を出す');
  ok(/非公開（Unlisted）にそろえる/.test(t.a),'★★何を押せばよいかを書く');
  ok(/確かめていない品はありません/.test(t.b),'★0件ならそう出す');
  ok(/鍵が無い/.test(t.c)&&/オフ/.test(t.d)&&t.e==='','★★確かめが効いていない理由を出す');
}

console.log('\n=== 直し：⚙ のカタログ ID・確かめ直す・pj が読んだ商品 ===');
await setup({ ones:[ONE({ shop_vis:'over_miss', shop_vis_jst:'11/22 13:05' })],
  vis:{ 'one-1':'over_miss' },
  extra:{ over_n:0, scopes:['read_products','write_publications'],
    over_ja:'「Overseas products」を Shopify に問い合わせられませんでした（Shopify の返事：Access denied）。足りない権限：read_markets',
    look:[{ handle:'one-1', pid:'8800123', status:'ACTIVE', on:true, over:false, title:'',
      same:[{ handle:'one-1-1', pid:'8800999', status:'UNLISTED' }] }] } });
await p.evaluate(()=>{ $('subShopAdmin').value='omakase-ship.myshopify.com'; });
await p.evaluate(()=>oneListGo());
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>({ id:!!$('subShopOverseasId'),
    adv:ADV_SUB.indexOf('subShopOverseasId')>=0&&CSV_CFG_IDS.indexOf('subShopOverseasId')>=0,
    btn:!!document.querySelector('#oneList [data-onevisgo="1"]'),
    badge:(document.querySelector('#oneList [data-onevis]')||{}).textContent||'' }));
  ok(t.id&&t.adv,'★★★⚙「海外向けカタログの ID」があり、pj-sync に保存する設定に入っている');
  ok(t.btn,'★★★読み込み済みの1点ものに「Shopify で確かめ直す」');
  ok(/11\/22 13:05 に確かめた/.test(t.badge),'★★いつ確かめた値かを出す（古い値か分かる）');
}
await p.evaluate(()=>{ window.__q=[]; document.querySelector('#oneList [data-onevisgo="1"]').click(); });
await p.waitForTimeout(700);
{
  const t=await p.evaluate(()=>({ un:(window.__q.filter((x)=>x.u==='unlist')[0]||{}).b,
    note:($('oneNote2').textContent||'').replace(/\s+/g,' '),
    links:Array.prototype.map.call(document.querySelectorAll('#oneNote2 a'),(a)=>a.href) }));
  console.log('   '+t.note.slice(0,400));
  ok(t.un&&t.un.approve===true&&JSON.stringify(t.un.handles)==='["one-1"]',
     '★★★その1点だけを、そろえて確かめ直す');
  ok(/商品 ID 8800123/.test(t.note)&&/状態 ACTIVE/.test(t.note),'★★★pj が読んだ商品の ID と状態を出す');
  ok(/同じ名前の別の商品/.test(t.note)&&/one-1-1（UNLISTED・ID 8800999）/.test(t.note),
     '★★★同じ名前の別の商品（Handle のずれ）を出す');
  ok(/read_markets/.test(t.note)&&/いまの鍵の権限：read_products・write_publications/.test(t.note),
     '★★★海外向けカタログが引けない理由と、足りない権限・いまの権限を出す');
  ok(t.links.some((h)=>h==='https://omakase-ship.myshopify.com/admin/products/8800123'),
     '★★管理画面の商品へのリンク（見比べられるように）');
  ok(!/shpat|secret/i.test(t.note),'★鍵は出さない');
}

await T.done();
})();
