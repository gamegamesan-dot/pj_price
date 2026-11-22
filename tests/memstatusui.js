/* 画面：会員用・1点ものの Status と「非公開（Unlisted）にそろえる」（8.88）

   カジの報告（2026-11-22）one-・sub- の CSV を取り込むと、一般のストアの
   一覧・検索・海外向けカタログに出てしまった（Status の列が無いと active）。
   カジの決定：CSV は draft・取り込んだあと pj-sync が管理 API で UNLISTED に。
   ここで見ること
     ① sub- の CSV：まだの商品は Status＝draft・読み込み済みは Status の列なし（ファイルを分ける）
     ② one- の CSV：同じ
     ③ 「Shopify に読み込みました」を押す前の案内に「ステータスが非公開か確かめる」の1行
     ④ 「非公開（Unlisted）にそろえる」：確かめる → 件数 → 確認 → 直す（続きも頼む）
     ⑤ 作業者は押せない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：会員用・1点ものの Status（8.88）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });
await openCsvBoxes(p);
const CHECK='取り込んだあと、Shopify でステータスが「非公開」になっているか確かめてください。';

const SUB={ ok:true, table_ok:true, rows:[
  { jan:'4902370550467', name:'まだの商品', asin:'B0D1GSZJ8T', kishu:'NS', price:5300,
    max_qty:3, grades:'light', size_tier:'s', size_g:110, px_hand:1, loaded_at:'' },
  { jan:'4902370550474', name:'読み込み済みの商品', asin:'B0D1GSZJ8U', kishu:'NS', price:3800,
    max_qty:2, grades:'light', size_tier:'s', size_g:110, px_hand:1,
    loaded_at:'2026-11-20T00:00:00Z' }] };
const ONE=(o)=>Object.assign({ one_id:1, handle:'one-1', name:'まだの1点もの', real_jan:'',
  asin:'', cond:'中古', cond_note:'', cost:2000, price:4800, qty:1, sold:0, left:1,
  ship_kind:'box', note:'', pic:false, pic_n:0, pics:[], pics_changed:false,
  pre_at:'', open_at:'', loaded_at:'', put_at:'', off:0 },o||{});

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__q=[]; window.__dl=[]; window.__un=[];
  window.dl=(name,text)=>{ window.__dl.push({ name, text }); return true; };
  window.csvDownload=window.dl;
  const real=window.__realFetch||window.fetch; window.__realFetch=real;
  let calls=0;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body, m=String((i||{}).method||'GET');
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/shop\/unlist/.test(url)){
      const x=JSON.parse(String(b||'{}')); window.__un.push(x); calls++;
      /* 2回に分かれて返る（続きを頼むか見る）。 */
      const first=!x.from;
      if(!x.approve)return res({ ok:true, approve:false, all:5, checked:first?3:2,
        unlisted:first?1:0, active:first?1:1, draft:first?1:0, archived:0, missing:first?0:1,
        over_in:first?2:1, need:first?2:1, next:first?3:5, left:first?2:0,
        items:first?[{ handle:'sub-4902370550467', status:'ACTIVE', over:true }]:[], errors:[],
        over_miss:[] });
      return res({ ok:true, approve:true, all:5, checked:first?3:2, unlisted:first?1:0,
        active:first?1:1, draft:first?1:0, archived:0, missing:first?0:1, over_in:first?2:1,
        need:first?2:1, done:first?2:1, fail:0, next:first?3:5, left:first?2:0, items:[],
        errors:[], over_miss:[] });
    }
    if(/\/mw\/sub\/put/.test(url))return res({ ok:true, prices:{}, unloaded:0 });
    if(/\/mw\/sub/.test(url))return res(o.sub||{ ok:true, table_ok:true, rows:[] });
    if(/\/one/.test(url)&&m==='GET')return res({ ok:true, table_ok:true, rows:o.ones||[],
      pre_grades:'premium', open_grades:'standard,premium', hours:24 });
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
},o||{});
const col=async(text,name)=>await p.evaluate(([t,n])=>{
  const r=PJ_SHOPCSV.splitCsv(t), i=r[0].indexOf(n);
  return i<0?null:r.slice(1).map((x)=>x[i]); },[text,name]);

console.log('=== ① 会員用（sub-）の CSV ===');
await setup({ sub:SUB });
await p.evaluate(()=>mwSubCsvGo()); await p.waitForTimeout(800);
{
  const t=await p.evaluate(()=>({ dl:window.__dl.slice(), note:$('mwSubNote').textContent.replace(/\s+/g,' ') }));
  const st0=await col(t.dl[0].text,'Status'), st1=await col(t.dl[1].text,'Status');
  console.log('   '+t.dl.map((x)=>x.name).join('／')+'　Status：'+JSON.stringify(st0)+' ／ '+JSON.stringify(st1));
  ok(t.dl.length===2&&/-new\.csv$/.test(t.dl[0].name)&&/-loaded\.csv$/.test(t.dl[1].name),
     '★★★まだの商品と読み込み済みの商品でファイルを分ける');
  ok(JSON.stringify(st0)==='["draft"]'&&/sub-4902370550467/.test(t.dl[0].text),
     '★★★まだ入れていない商品は Status＝draft（取り込んだ直後から、どこにも出ない）');
  ok(st1===null&&/sub-4902370550474/.test(t.dl[1].text),
     '★★★読み込み済みの商品は Status の列を出さない（いまの非公開を崩さない）');
  ok(!/unlisted|active/i.test((st0||[]).join()),'★★CSV に unlisted・active は書かない');
  ok(/Status＝draft/.test(t.note)&&/Status の列なし/.test(t.note),'★★どちらをどう出したかを出す');
  ok(t.note.indexOf(CHECK)>=0,'★★★書き出したあとの案内に「ステータスが非公開か確かめる」の1行');
  ok(/非公開（Unlisted）にそろえる/.test(t.note),'★★取り込んだら「非公開にそろえる」を押すと出す');
}
{
  /* 読み込み済みが無ければ1つだけ。 */
  await setup({ sub:{ ok:true, table_ok:true, rows:[SUB.rows[0]] } });
  await p.evaluate(()=>mwSubCsvGo()); await p.waitForTimeout(600);
  const t=await p.evaluate(()=>window.__dl.slice());
  ok(t.length===1&&/^shopify-products-\d{8}\.csv$/.test(t[0].name)
     &&JSON.stringify(await col(t[0].text,'Status'))==='["draft"]','★まだの商品だけなら1つ（Status＝draft）');
}

console.log('\n=== ② 1点もの（one-）の CSV ===');
await setup({ ones:[ONE(), ONE({ one_id:2, handle:'one-2', name:'読み込み済みの1点もの',
  loaded_at:'2026-11-20T00:00:00Z' })] });
await p.evaluate(()=>oneCsvGo()); await p.waitForTimeout(600);
{
  const t=await p.evaluate(()=>({ dl:window.__dl.slice(), note:$('oneNote2').textContent.replace(/\s+/g,' ') }));
  const st0=await col(t.dl[0].text,'Status'), st1=await col(t.dl[1].text,'Status');
  console.log('   '+t.dl.map((x)=>x.name).join('／')+'　Status：'+JSON.stringify(st0)+' ／ '+JSON.stringify(st1));
  ok(t.dl.length===2&&JSON.stringify(st0)==='["draft"]'&&st1===null,
     '★★★one- も、まだの品は Status＝draft・読み込み済みは Status の列なし');
  ok(t.note.indexOf(CHECK)>=0&&/非公開（Unlisted）にそろえる/.test(t.note),
     '★★★1点ものの案内にも「ステータスが非公開か確かめる」の1行');
}

console.log('\n=== ③ 「Shopify に読み込みました」の前の案内 ===');
{
  const t=await p.evaluate(()=>{
    const a=$('subUnlistCheck'), b=$('oneUnlistCheck');
    const pos=(x,y)=>!!(x&&y&&(x.compareDocumentPosition(y)&Node.DOCUMENT_POSITION_FOLLOWING));
    return { a:a?a.textContent:'', b:b?b.textContent:'',
      before:pos(a,$('subLoaded'))&&pos($('subUnlistBtn'),$('subLoaded')),
      old:/商品を未掲載にする/.test(document.body.innerHTML) };
  });
  ok(t.a.indexOf(CHECK)>=0&&t.b.indexOf(CHECK)>=0,
     '★★★sub-・one- の両方に「取り込んだあと、ステータスが非公開か確かめる」の1行');
  ok(t.before,'★★「Shopify に読み込みました」より前（上）に、案内と「非公開にそろえる」がある');
  ok(!t.old,'★前の手作業の手順（商品を未掲載にする）は、ボタンに置き換えた');
}

console.log('\n=== ④ 非公開（Unlisted）にそろえる ===');
await setup({});
await p.evaluate(()=>shopUnlistGo('sub','subUnlistNote')); await p.waitForTimeout(800);
{
  const t=await p.evaluate(()=>({ un:window.__un.slice(), note:$('subUnlistNote').textContent.replace(/\s+/g,' ') }));
  console.log('   '+t.note.slice(0,160));
  ok(t.un.length===4&&t.un[0].approve===false&&t.un[1].approve===false&&t.un[1].from===3
     &&t.un[2].approve===true&&t.un[3].from===3,
     '★★★まず確かめる（続きも頼む）→ 確認 → 直す（続きも頼む）');
  ok(t.un.every((x)=>x.kind==='sub'),'★sub- のボタンは sub- だけ');
  ok(/非公開（Unlisted）にそろえました/.test(t.note)&&/直した 3件/.test(t.note),
     '★★★直した件数をまとめて出す');
  ok(/公開（active） 2/.test(t.note)&&/下書き（draft） 1/.test(t.note)&&/Shopify に無い 1/.test(t.note),
     '★★状態ごとの件数を出す');
  ok(t.note.indexOf(CHECK)>=0,'★★結果にも「ステータスが非公開か確かめる」の1行');
}
{
  /* 確認でやめると、何も変えない。 */
  await setup({});
  p.removeAllListeners('dialog'); p.on('dialog',async d=>{ await d.dismiss(); });
  await p.evaluate(()=>shopUnlistGo('one','oneUnlistNote')); await p.waitForTimeout(600);
  const t=await p.evaluate(()=>({ un:window.__un.slice(), note:$('oneUnlistNote').textContent }));
  ok(t.un.every((x)=>x.approve===false&&x.kind==='one')&&/確かめました（何も変えていません）/.test(t.note)
     &&/直す必要がある 3件/.test(t.note),'★★★確認でやめると何も変えない（直す必要がある件数だけ出す）');
  p.removeAllListeners('dialog'); p.on('dialog',async d=>{ await d.accept(); });
}

console.log('\n=== ⑤ 作業者は押せない・版 ===');
{
  await setup({});
  await p.evaluate(()=>{ syncRole='staff'; roleApply(); return shopUnlistGo('sub','subUnlistNote'); });
  await p.waitForTimeout(200);
  ok(await p.evaluate(()=>window.__un.length)===0,'★★★作業者のキーでは押せない');
  const fs=require('fs'), path=require('path');
  const v=await p.evaluate(()=>APP_V);
  const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  ok(sw.indexOf("'pj-pricing-"+v+"'")>=0&&+v.slice(1)>=337,'★sw.js と APP_V がそろっている（'+v+'）');
}
await T.done();
})();
