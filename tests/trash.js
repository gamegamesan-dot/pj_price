/* 出品CSVタブ：ゴミ箱（間違えて消した行を戻す・6.27）
   ・行の「削除」と「リストを空にする」はゴミ箱へ移すだけ
   ・中身（写真・英題・出品文・カテゴリ・仕入値の直し・ItemID）はそのまま
   ・元に戻すと、消す前と同じ位置（追加順）に戻る
   ・同じSKUの行があるときは戻す前に確認する
   ・30日で自動的に消える／多すぎたら古いものから
   ・写真（R2）は消さない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('出品CSVタブ：ゴミ箱');
const ok = T.ok;
(async()=>{
const p=await T.open();
const dlg=[]; let answer=true;
p.on('dialog',async d=>{ dlg.push(d.message()); if(answer)await d.accept();
  else await d.dismiss(); });
await p.click('#tabD');

const setup=async()=>{ await setupRaw(); await openCsvBoxes(p); };
const setupRaw=async()=>await p.evaluate(()=>{
  window.__del=[];                     // R2の削除（DELETE /i/…）を見張る
  const real=window.fetch;
  window.fetch=function(u,i){
    if(i&&i.method==='DELETE'){ window.__del.push(String(u)); 
      return Promise.resolve({ok:true,json:()=>Promise.resolve({ok:true})}); }
    return real(u,i);
  };
  $('csvSort').value='add';
  $('csvImgBase').value='https://img.example.workers.dev';
  $('csvImgToken').value='t';
  const row=(id,asin,extra)=>Object.assign({id:id,src:'sedori',
    sku:'game-20260101-UG-'+asin+'-1200',asin:asin,jan:'49'+id,titleJa:'商品'+id,
    titleEn:'Used Nintendo Switch Item '+id+' Japan Import',cat:'139973',catFixed:true,
    condId:5000,condSrc:'良い',cost:1200,qty:1,weight:150,
    pics:[{url:'https://img.example.workers.dev/i/2026-10-09/'+id+'.jpg',
           key:'2026-10-09/'+id+'.jpg'}],
    descHtml:'<p>desc '+id+'</p>',
    specs:{origin:'Japan',platform:'Nintendo Switch',gameName:'Item '+id},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',titleStatus:'',titleCands:[],
    titleNote:'',titleManual:false},extra||{});
  csvList=[row('a','B07571RH4P'),
           row('b','B09TPBVJ5F',{itemId:'110222',costOrig:900,cost:1500,
             titleEn:'手で直した英題',titleManual:true}),
           row('c','B0CWGXZWNV')];
  csvTrash=[]; csvTrashSave(); csvPick={};
  csvList.forEach(csvRecalc); csvSaveList(); csvRender();
  $('csvListBox').open=true; $('csvTrashBox').open=true;
});
const ids=()=>p.evaluate(()=>csvList.map(r=>r.id));
const trash=()=>p.evaluate(()=>csvTrash.map(t=>t.r.id+'@'+t.pos));

console.log('=== 行の「削除」はゴミ箱へ ===');
await setup();
console.log('   はじめ: '+JSON.stringify(await ids()));
await p.click('#csvList button[data-del="b"]');
await p.waitForTimeout(300);
console.log('   消したあと: '+JSON.stringify(await ids())+' / ゴミ箱 '+JSON.stringify(await trash()));
ok((await ids()).join()==='a,c','★一覧から消える');
ok((await trash()).join()==='b@1','★ゴミ箱に入る（元の位置も覚えている）');
const sum=await p.textContent('#csvTrashSum');
console.log('   '+sum);
ok(/ゴミ箱（1件）/.test(sum),'★一覧の上部に「ゴミ箱（n件）」と出る');
const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('pj:csvtrash:v1')||'[]'));
ok(saved.length===1&&saved[0].r.id==='b','★端末にも保存する（開き直しても残る）');
const del=await p.evaluate(()=>window.__del);
console.log('   R2への削除: '+JSON.stringify(del));
ok(del.length===0,'★写真（R2）は消さない');

console.log('\n=== 削除した直後の帯 ===');
const bar=await p.evaluate(()=>({disp:getComputedStyle($('csvUndoBar')).display,
  text:$('csvUndoText').textContent}));
console.log('   '+JSON.stringify(bar));
ok(bar.disp!=='none'&&/削除しました/.test(bar.text),'★「削除しました」の帯が出る');
ok(/商品b/.test(bar.text),'どの行を消したか出す');
await p.click('#csvUndoBtn'); await p.waitForTimeout(300);
console.log('   元に戻す: '+JSON.stringify(await ids()));
ok((await ids()).join()==='a,b,c','★帯の「元に戻す」で元の位置に戻る');
ok((await trash()).length===0,'ゴミ箱は空になる');
ok(await p.evaluate(()=>getComputedStyle($('csvUndoBar')).display)==='none','帯は消える');

console.log('\n=== 中身がそのまま戻る ===');
await setup();
const before=await p.evaluate(()=>JSON.parse(JSON.stringify(csvRowById('b'))));
await p.click('#csvList button[data-del="b"]'); await p.waitForTimeout(250);
await p.click('#csvTrashList button[data-undel="b"]'); await p.waitForTimeout(300);
const after=await p.evaluate(()=>JSON.parse(JSON.stringify(csvRowById('b'))));
const same=JSON.stringify(before)===JSON.stringify(after);
console.log('   同じ: '+same);
if(!same)console.log('   前: '+JSON.stringify(before)+'\n   後: '+JSON.stringify(after));
ok(same,'★写真・英題・出品文・カテゴリ・仕入値の直し・ItemID がそのまま戻る');
ok(after.pics.length===1&&after.itemId==='110222'&&after.costOrig===900
   &&after.titleEn==='手で直した英題','中身を個別にも確かめる');
ok((await ids()).join()==='a,b,c','★並び順も元の位置（追加順）に戻る');

console.log('\n=== リストを空にする → すべて戻す ===');
await setup();
dlg.length=0;
await p.click('#csvClear'); await p.waitForTimeout(300);
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/ゴミ箱に入るので/.test(dlg[0]||''),'★戻せることを確認で伝える');
console.log('   '+JSON.stringify(await ids())+' / ゴミ箱 '+JSON.stringify(await trash()));
ok((await ids()).length===0&&(await trash()).length===3,'★3件ともゴミ箱へ');
await p.click('#csvTrashAll'); await p.waitForTimeout(300);
console.log('   すべて戻す: '+JSON.stringify(await ids()));
ok((await ids()).join()==='a,b,c','★「すべて戻す」で元の並びのまま戻る');

console.log('\n=== 同じSKUの行があるときは確認する ===');
await setup();
await p.click('#csvList button[data-del="a"]'); await p.waitForTimeout(250);
// 同じSKUの行を取り込み直した状態を作る
await p.evaluate(()=>{
  const r=JSON.parse(JSON.stringify(csvTrash[0].r));
  r.id='again'; r.pics=[]; r.titleEn='';
  csvList.unshift(r); csvSaveList(); csvRender();
});
dlg.length=0; answer=false;                     // 確認で「いいえ」
await p.click('#csvTrashList button[data-undel="a"]'); await p.waitForTimeout(300);
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/同じSKUの行がすでに一覧にあります/.test(dlg[0]||''),'★戻す前に確認を出す');
ok((await trash()).length===1,'★「いいえ」なら戻さない（重複させない）');
answer=true;
dlg.length=0;
await p.click('#csvTrashList button[data-undel="a"]'); await p.waitForTimeout(300);
ok((await ids()).indexOf('a')>=0&&(await trash()).length===0,
   '★「はい」なら戻す（判断は人に任せる）');

console.log('\n=== ゴミ箱から完全に消す ===');
await setup();
await p.click('#csvList button[data-del="c"]'); await p.waitForTimeout(250);
dlg.length=0;
await p.click('#csvTrashList button[data-tdrop="c"]'); await p.waitForTimeout(300);
console.log('   確認: '+JSON.stringify(dlg[0]));
ok(/もう元に戻せません/.test(dlg[0]||''),'★戻せなくなることを伝える');
ok(/写真は消しません/.test(dlg[0]||''),'★写真は消さないと伝える');
ok((await trash()).length===0,'ゴミ箱から消える');
ok((await p.evaluate(()=>window.__del)).length===0,'★それでも R2 の写真は消さない');
// 「ゴミ箱を空にする」も同じ
await setup();
await p.click('#csvList button[data-del="a"]'); await p.waitForTimeout(200);
await p.click('#csvList button[data-del="b"]'); await p.waitForTimeout(200);
dlg.length=0;
await p.click('#csvTrashPurge'); await p.waitForTimeout(300);
ok(/ゴミ箱の 2件を完全に消します/.test(dlg[0]||''),'★件数を出して確認する');
ok((await trash()).length===0,'★空になる');
ok((await p.evaluate(()=>window.__del)).length===0,'写真は消さない');

console.log('\n=== 30日で自動的に消える ===');
const age=await p.evaluate(()=>{
  const mk=(id,days)=>({at:new Date(Date.now()-days*86400000).toISOString(),pos:0,
    r:{id:id,sku:'s'+id,titleJa:'古い行'+id,pics:[],cat:'139973'}});
  csvTrash=[mk('new',1),mk('d29',29),mk('d31',31),mk('d400',400)];
  csvTrashSave();
  csvTrashLoad();                    // 開き直したときと同じ道を通す
  return csvTrash.map(t=>t.r.id);
});
console.log('   '+JSON.stringify(age));
ok(age.join()==='new,d29','★30日を過ぎた行は自動で消える（29日は残る）');
const many=await p.evaluate(()=>{
  csvTrash=[];
  for(let i=0;i<320;i++)csvTrash.push({at:new Date(Date.now()-i*60000).toISOString(),
    pos:0,r:{id:'x'+i,sku:'s'+i,titleJa:'行'+i,pics:[],cat:'139973'}});
  csvTrashSave(); csvTrashLoad();
  return { n:csvTrash.length, first:csvTrash[0].r.id, last:csvTrash[csvTrash.length-1].r.id };
});
console.log('   '+JSON.stringify(many));
ok(many.n===300&&many.first==='x0'&&many.last==='x299',
   '★多すぎたら古いものから消す（新しい300件が残る）');

console.log('\n=== 開き直しても残る ===');
await setup();
await p.click('#csvList button[data-del="b"]'); await p.waitForTimeout(250);
await p.reload(); await p.waitForTimeout(500); await p.click('#tabD');
await p.evaluate(()=>{ $('csvTrashBox').open=true; csvRender(); });
await p.waitForTimeout(200);
const keep=await p.evaluate(()=>({n:csvTrash.length,sum:$('csvTrashSum').textContent,
  list:$('csvTrashList').innerText.replace(/\n/g,' | ')}));
console.log('   '+JSON.stringify(keep).slice(0,200));
ok(keep.n===1&&/ゴミ箱（1件）/.test(keep.sum),'★開き直してもゴミ箱に残る');
ok(/商品b/.test(keep.list)&&/写真 1枚/.test(keep.list)&&/ItemID 110222/.test(keep.list),
   '★中身（写真の枚数・英題・ItemID）が見える');
await p.click('#csvTrashList button[data-undel="b"]'); await p.waitForTimeout(300);
ok((await ids()).join()==='a,b,c','★開き直したあとでも元の位置に戻せる');
console.log('\n=== R2に残っている写真から戻す ===');
await setup();
const found=await p.evaluate(()=>{
  // /list を差し替える（本物の Worker は呼ばない）
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u);
    if(/\/list\?day=/.test(url)){
      window.__listUrl=url;
      return Promise.resolve({ok:true,json:()=>Promise.resolve({ok:true,day:'20261009',n:3,
        truncated:false,items:[
          {key:'20261009/aaa.jpg',url:'https://img.example.workers.dev/i/20261009/aaa.jpg',
           at:'2026-10-09T01:00:00Z',size:1000},
          {key:'20261009/bbb.jpg',url:'https://img.example.workers.dev/i/20261009/bbb.jpg',
           at:'2026-10-09T02:00:00Z',size:1000},
          // これは行aにもう付いている写真
          {key:'2026-10-09/a.jpg',url:'https://img.example.workers.dev/i/2026-10-09/a.jpg',
           at:'2026-10-09T03:00:00Z',size:1000}]})});
    }
    if(i&&i.method==='DELETE'){ window.__del.push(url);
      return Promise.resolve({ok:true,json:()=>Promise.resolve({ok:true})}); }
    return real(u,i);
  };
  $('csvPicFindBox').open=true;
  $('csvPicFindDay').value='2026-10-09';
  return true;
});
await p.click('#csvPicFind'); await p.waitForTimeout(400);
const note=await p.textContent('#csvPicFindNote');
console.log('   '+note+' / '+await p.evaluate(()=>window.__listUrl));
ok(/day=20261009/.test(await p.evaluate(()=>window.__listUrl)),
   '★選んだ日付で /list を呼ぶ');
ok(/3枚見つかりました/.test(note),'★見つかった枚数を出す');
ok(/どの行にも付いていない写真 2枚/.test(note),
   '★どの行にも付いていない写真（＝消した行のもの）の数を出す');
const thumbs=await p.$$eval('#csvPicFindList img',is=>is.map(i=>i.getAttribute('src')));
console.log('   '+JSON.stringify(thumbs));
ok(thumbs.length===3,'★写真を並べる');
// 2枚選んで行cに付ける
await p.evaluate(()=>{
  const sel=$('csvPicFindRow');
  const opt=Array.from(sel.options).find(o=>/商品c/.test(o.textContent));
  sel.value=opt.value;
  ['20261009/aaa.jpg','20261009/bbb.jpg'].forEach(k=>{
    const el=document.querySelector('#csvPicFindList input[data-pfind="'+k+'"]');
    el.checked=true; el.dispatchEvent(new Event('change',{bubbles:true}));
  });
});
await p.click('#csvPicFindAdd'); await p.waitForTimeout(400);
const got=await p.evaluate(()=>({pics:csvRowById('c').pics.map(x=>x.key),
  note:$('csvPicFindNote').textContent}));
console.log('   '+JSON.stringify(got));
ok(got.pics.length===3&&got.pics.indexOf('20261009/aaa.jpg')>=0
   &&got.pics.indexOf('20261009/bbb.jpg')>=0,'★選んだ写真が行に付く（元の写真も残る）');
ok(/2枚を付けました/.test(got.note),'付けた枚数を知らせる');
// 同じ写真をもう一度付けても増えない
await p.evaluate(()=>{
  const el=document.querySelector('#csvPicFindList input[data-pfind="20261009/aaa.jpg"]');
  el.checked=true; el.dispatchEvent(new Event('change',{bubbles:true}));
});
await p.click('#csvPicFindAdd'); await p.waitForTimeout(300);
ok((await p.evaluate(()=>csvRowById('c').pics.length))===3,
   '★同じ写真は二重に付かない');

await T.done();
})();
