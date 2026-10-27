/* 画面：版の表示をヘッダーに移す（6.104）
   ・上の黄色い帯の「Play Japan 出品ツール」の横に小さく版を出す
   ・版の数字は APP_V から出す（sw.js の const V と一致しているもの）
   ・新しい版が届いて更新待ちのときは「更新があります（タップで再読み込み）」
   ・フッターの版の表示は消した
   ・スマホの幅（390px・320px）でタイトルが崩れないこと */
const { harness } = require('./lib');
const fs = require('fs');
const path = require('path');
const T = harness('画面：ヘッダーの版の表示');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.waitForTimeout(400);

const ROOT=path.join(__dirname,'..');
const SW=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
const swV=(/pj-pricing-(v\d+)/.exec(SW)||[])[1]||'';

console.log('=== ヘッダーに版が出る ===');
let h=await p.evaluate(()=>{
  const el=$('appVer');
  const t2=document.querySelector('.t2');
  return { txt:el?el.textContent:'なし',
    inHeader:!!(el&&el.closest('header')),
    inTag:!!(el&&el.closest('.tag')),
    sameRow:!!(el&&t2&&t2.contains(el)),
    appv:APP_V,
    cls:el?el.className:'' };
});
console.log('   '+JSON.stringify(h));
ok(h.inHeader===true,'★★★ヘッダーの中にある');
ok(h.inTag===true&&h.sameRow===true,'★★★黄色い帯のタイトルの横にある');
ok(h.txt===h.appv,'★★★版は APP_V から出す');
ok(/^v\d+$/.test(h.txt),'★★「v196」の形で出る');
ok(h.appv===swV,'★★★sw.js の const V と一致している（'+swV+'）');

console.log('\n=== フッターの版は消した ===');
let f=await p.evaluate(()=>{
  const ft=document.querySelector('footer');
  return { txt:ft?ft.textContent.replace(/\s+/g,' ').trim():'なし',
    hasVer:!!(ft&&ft.querySelector('#appVer')) };
});
console.log('   '+f.txt);
ok(f.hasVer===false,'★★★フッターに版は無い');
ok(/v\d+/.test(f.txt)===false,'★★フッターに版の数字が出ない');
ok(/料金表を内蔵/.test(f.txt),'★ほかのフッターの文は残る');

console.log('\n=== 字の大きさ（タイトルより小さい）===');
let sz=await p.evaluate(()=>{
  const v=getComputedStyle($('appVer'));
  const t=getComputedStyle(document.querySelector('.t2n'));
  return { ver:parseFloat(v.fontSize), title:parseFloat(t.fontSize) };
});
console.log('   '+JSON.stringify(sz));
ok(sz.ver<sz.title,'★★版はタイトルより小さい字');
ok(sz.ver<=12,'★小さく出す（12px 以下）');

console.log('\n=== スマホの幅で崩れない ===');
const fits=async(w)=>{
  await p.setViewportSize({width:w,height:900});
  await p.waitForTimeout(120);
  return await p.evaluate(()=>{
    const t=document.querySelector('.t2n'), v=$('appVer');
    const tag=document.querySelector('.tag');
    return {
      /* タイトルは1行のまま（折り返して1文字ずつ縦に並ばない） */
      lines:Math.round(t.getBoundingClientRect().height
        /parseFloat(getComputedStyle(t).fontSize)),
      over:document.documentElement.scrollWidth>window.innerWidth,
      tagOver:tag.scrollWidth>tag.clientWidth+1,
      verRight:Math.round(v.getBoundingClientRect().right),
      inner:window.innerWidth,
      /* 版が見えているか（幅・高さがある） */
      shown:v.getBoundingClientRect().width>0&&v.getBoundingClientRect().height>0 };
  });
};
for(const w of [390,360,320]){
  const r=await fits(w);
  console.log('   '+w+'px: '+JSON.stringify(r));
  ok(r.over===false,'★★★'+w+'px で横にはみ出さない');
  ok(r.tagOver===false,'★★'+w+'px で帯からあふれない');
  ok(r.shown===true,'★★'+w+'px でも版が見える');
  ok(r.verRight<=r.inner,'★'+w+'px で版が画面の内側');
  ok(r.lines<=2,'★★'+w+'px でタイトルが縦に崩れない');
}
await p.setViewportSize({width:390,height:900});

console.log('\n=== 更新待ちのとき ===');
let up=await p.evaluate((APPV)=>{
  /* 1つ新しい版が届いた状態にする。 */
  const n=+(/^v(\d+)$/.exec(APPV)[1])+1;
  window.__reload=0;
  window.appVerReload=function(){ window.__reload++; };
  appVerShow('v'+n);
  const el=$('appVer');
  return { txt:el.textContent, cls:el.className, role:el.getAttribute('role'),
    tab:el.getAttribute('tabindex'), cur:getComputedStyle(el).cursor,
    title:el.title, tap:typeof el.onclick==='function' };
},await p.evaluate(()=>APP_V));
console.log('   '+JSON.stringify(up));
ok(/更新があります（タップで再読み込み）/.test(up.txt),
   '★★★「更新があります（タップで再読み込み）」と出る');
ok(/^v\d+ /.test(up.txt),'★★いまの版も続けて出す');
ok(up.cls.indexOf('up')>=0,'★★押せる見た目にする');
ok(up.role==='button'&&up.tab==='0','★★★押せる印（role と tabindex）');
ok(up.cur==='pointer','★指の形になる');
ok(/新しい版 v\d+/.test(up.title),'★新しい版の番号は title で分かる');
ok(up.tap===true,'★★★タップで動く');
/* 押すと読み込み直す */
await p.evaluate(()=>{ $('appVer').click(); });
await p.waitForTimeout(120);
ok((await p.evaluate(()=>window.__reload))===1,'★★★タップで読み込み直す');
/* キーボードでも押せる */
await p.evaluate(()=>{ $('appVer').focus();
  $('appVer').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); });
await p.waitForTimeout(120);
ok((await p.evaluate(()=>window.__reload))===2,'★★Enter でも読み込み直す');
/* 更新待ちでも幅があふれない */
let ov=await p.evaluate(()=>({
  over:document.documentElement.scrollWidth>window.innerWidth,
  tagOver:(function(){ const t=document.querySelector('.tag');
    return t.scrollWidth>t.clientWidth+1; })() }));
console.log('   '+JSON.stringify(ov));
ok(ov.over===false&&ov.tagOver===false,'★★★更新の知らせが出ても崩れない');

console.log('\n=== 版がそろっているとき ===');
let same=await p.evaluate(()=>{
  appVerShow('');
  const el=$('appVer');
  return { txt:el.textContent, cls:el.className, role:el.getAttribute('role'),
    tap:typeof el.onclick==='function' };
});
console.log('   '+JSON.stringify(same));
ok(same.txt===h.appv,'★★★そろっていれば版だけ出す');
ok(/更新/.test(same.txt)===false,'★★★更新の知らせは出さない');
ok(same.cls==='tver'&&!same.role&&same.tap===false,'★★★押せる状態に残らない');
/* SW のほうが古いときも「更新があります」とは出さない（v109 の不具合） */
await p.evaluate((APPV)=>{
  const n=+(/^v(\d+)$/.exec(APPV)[1])-1;
  appVerShow('v'+n);
},await p.evaluate(()=>APP_V));
let old=await p.evaluate(()=>$('appVer').textContent);
console.log('   古いSW: '+old);
ok(/更新/.test(old)===false,'★★★SW のほうが古いときは出さない');

await T.done();
})();
