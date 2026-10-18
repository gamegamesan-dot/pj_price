/* 写真を eBay 保管に切り替える画面（6.55）
   ・販売連携に「写真を eBay 保管に切り替え」を置く（管理者のキーのときだけ）
   ・ItemID を入れて「1件お試し」→ pj-sync の /ebay/pics/switch に mode=auto で送る
   ・前と後（写真の枚数・自前ホストの紐づけ・PictureSource）と、
     どちらの方式で直ったかを画面に出す
   ・選んだ行をまとめて切り替えるときは、確認を出してから5件ずつ送る
   ・ItemID が無い行はとばす。送れなかったときは理由を出す */
const { harness } = require('./lib');
const T = harness('写真を eBay 保管に切り替え（画面）');
const ok = T.ok;
(async()=>{
const p=await T.open();
/* 確認（confirm）が開いているあいだ evaluate は返ってこないので、
   出た文と「いいえ」の切り替えは Node 側だけで持ち、
   確認が出るボタンは p.click で押す。 */
let dlg=[], cancel=false;
p.on('dialog',async d=>{
  dlg.push(d.message());
  if(cancel)await d.dismiss(); else await d.accept();
});

/* 画面の下ごしらえ。/whoami と /ebay/pics/switch を差し替える。
   返し方は Worker と同じ（items の配列）。 */
const setup=async(role)=>await p.evaluate((role)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8';
  window.__posts=[]; window.__fail=0; window.__mode='reuse';
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(o,st)=>Promise.resolve({ok:!st||st<400,status:st||200,
      text:()=>Promise.resolve(JSON.stringify(o)), json:()=>Promise.resolve(o)});
    if(/\/whoami/.test(url))return res({ok:true,role:role,staff_key_set:true});
    if(/\/ebay\/pics\/switch/.test(url)){
      window.__posts.push(body);
      if(window.__fail)return res({error:'too_many',max:5},400);
      const fresh=(window.__mode==='fresh');
      const items=(body.item_ids||[]).map(function(id){
        return { ok:true, item_id:id, title:'Satan Gundam SDX Figure',
          done:true, fixed_by:fresh?'fresh':'reuse',
          expiration:fresh?'2026-11-17T00:00:00.000Z':'',
          before:{ n:3, ext_n:1, picture_source:'Vendor', eps_only:false },
          after:{ n:3, ext_n:0, picture_source:'EPS', eps_only:true } };
      });
      return res({ ok:true, n:items.length, mode:body.mode,
                   done:items.length, items:items });
    }
    if(/\/listings|\/settings|\/sync/.test(url))return res({accepted:0});
    return real(u,i);
  };
  const row=(asin,itemId)=>({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:itemId,ebay_qty:1,ebay_price:90,
    title:'テスト商品 '+asin,cost_yen:1200,weight_g:150,one_off:0,dropship:0,
    restocking:0,mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,
    ebay_sale:null,md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,
    amazon_lowest:9000,amazon_offers_json:null,sold_usd:null,
    fba_available:1,fba_inbound:0,fba_reserved:0,warnings:[],notes:[],state:'ok'});
  syncData={at:new Date().toISOString(),counts:{},items:[
    row('B0PIC00001','880025406600'), row('B0PIC00002','880025406601'),
    row('B0PIC00003',''),             // ItemID が無い行（とばす）
    row('B0PIC00004','880025406603'), row('B0PIC00005','880025406604'),
    row('B0PIC00006','880025406605'), row('B0PIC00007','880025406606')]};
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E'); syncRender(); roleCheck();
},role);
const vis=async(sel)=>await p.evaluate((sel)=>{
  const el=document.querySelector(sel);
  if(!el)return null;
  const box=$('syncPicsBox'); if(box)box.open=true;
  const pr=$('syncPriceBox'); if(pr)pr.open=true;
  return el.getClientRects().length>0;
},sel);
const openBox=async()=>await p.evaluate(()=>{ $('syncPicsBox').open=true; });

console.log('=== 置き場所（管理者のキー）===');
await setup('admin');
await p.waitForTimeout(300);
ok(await vis('#syncPicsBox')===true,'★★販売連携に「写真を eBay 保管に切り替え」がある');
ok(await vis('#syncPicsId')===true&&await vis('#syncPicsOne')===true,
   '★ItemID の欄と「1件お試し」のボタンがある');
ok(await vis('#syncPicsBulk')===true,'★「選んだ行をまとめて切り替え」もある');
const sum=await p.evaluate(()=>$('syncPicsBox').querySelector('summary').textContent);
console.log('   見出し: '+sum);
const lead=await p.evaluate(()=>$('syncPicsBox').textContent);
ok(/写真以外（価格・数量・タイトル）は送りません/.test(lead),
   '★★「写真以外は送らない」と書いてある');
ok(/pj-img の写真は消しません/.test(lead),'★★R2 の写真は消さないと書いてある');

console.log('\n=== 1件お試し ===');
await p.evaluate(()=>{ window.__mode='reuse'; $('syncPicsBox').open=true; });
await p.fill('#syncPicsId','880025406600');
await p.click('#syncPicsOne');
await p.waitForTimeout(400);
let st=await p.evaluate(()=>({posts:window.__posts,
  note:$('syncPicsNote').textContent, res:$('syncPicsRes').textContent}));
console.log('   送った中身: '+JSON.stringify(st.posts));
console.log('   結果: '+st.res.replace(/\s+/g,' ').trim());
ok(st.posts.length===1&&st.posts[0].item_ids.join()==='880025406600',
   '★★ItemID を1件だけ送る');
ok(st.posts[0].mode==='auto',
   '★★mode=auto（預け直さない→だめなら預け直す）で送る');
ok(/よろしいですか/.test(dlg.join('\n')),'★確認を出してから送る');
ok(/写真以外（価格・数量・タイトル）は送りません/.test(dlg.join('\n')),
   '★★確認の文でも「写真以外は送らない」と伝える');
ok(/写真3枚/.test(st.res)&&/自前ホストの紐づけ 1件/.test(st.res)
   &&/自前ホストの紐づけ 0件/.test(st.res),
   '★★前と後（写真の枚数・自前ホストの紐づけ）を並べて出す');
ok(/Vendor/.test(st.res)&&/EPS/.test(st.res),'★★PictureSource の前後も出す');
ok(/預け直さずに直りました/.test(st.res),'★★どちらの方式で直ったかを出す');
ok(/1件お試し：1／1件/.test(st.note),'★できた件数を出す');

console.log('\n=== 預け直して直ったとき ===');
await p.evaluate(()=>{ window.__posts=[]; window.__mode='fresh'; });
await p.click('#syncPicsOne');
await p.waitForTimeout(400);
st=await p.evaluate(()=>({res:$('syncPicsRes').textContent}));
console.log('   '+st.res.replace(/\s+/g,' ').trim());
ok(/預け直して直りました/.test(st.res),'★★預け直したときはそう出す');
ok(/期限：2026-11-17/.test(st.res),'★★預け直した写真の期限（30日）を出す');

console.log('\n=== ItemID の形・確認のキャンセル ===');
await p.evaluate(()=>{ window.__posts=[]; });
await p.fill('#syncPicsId','12');
await p.click('#syncPicsOne');
await p.waitForTimeout(200);
st=await p.evaluate(()=>({posts:window.__posts,note:$('syncPicsNote').textContent}));
ok(st.posts.length===0&&/9〜15桁/.test(st.note),'★ItemID の形が違えば送らない');
cancel=true;
await p.fill('#syncPicsId','880025406600');
await p.click('#syncPicsOne');
await p.waitForTimeout(300);
cancel=false;
st=await p.evaluate(()=>({posts:window.__posts}));
ok(st.posts.length===0,'★★確認で「いいえ」なら送らない');

console.log('\n=== 選んだ行をまとめて（5件ずつ・ItemID のある行だけ）===');
dlg=[];
await p.evaluate(()=>{ window.__posts=[]; window.__mode='reuse';
  syncPick={}; syncRender();
  ['B0PIC00001','B0PIC00002','B0PIC00003'].forEach(function(a){
    syncPick[a+'|used']=true; });
  syncRender(); $('syncPicsBox').open=true; });
await p.click('#syncPicsBulk');
await p.waitForTimeout(500);
st=await p.evaluate(()=>({posts:window.__posts,
  note:$('syncPicsNote').textContent}));
console.log('   送った中身: '+JSON.stringify(st.posts.map(x=>x.item_ids)));
ok(st.posts.length===1&&st.posts[0].item_ids.length===2,
   '★★ItemID が無い行はとばす（3件選んで2件）');
ok(st.posts[0].confirm===true,'★confirm を付けて送る');
ok(/2件の写真を eBay 保管に切り替えます/.test(dlg.join('\n')),
   '★★まとめて実行は件数を出して確認する');
ok(/まとめて切り替え：2／2件/.test(st.note),'★できた件数を出す');

console.log('\n=== 6件選んだら5件＋1件に分ける ===');
await p.evaluate(()=>{ window.__posts=[]; syncPick={};
  ['B0PIC00001','B0PIC00002','B0PIC00004','B0PIC00005','B0PIC00006','B0PIC00007']
    .forEach(function(a){ syncPick[a+'|used']=true; });
  syncRender(); $('syncPicsBox').open=true; });
await p.click('#syncPicsBulk');
await p.waitForTimeout(900);
st=await p.evaluate(()=>({posts:window.__posts,note:$('syncPicsNote').textContent,
  res:$('syncPicsRes').textContent}));
console.log('   '+JSON.stringify(st.posts.map(x=>x.item_ids.length))+'／'+st.note);
ok(st.posts.length===2&&st.posts[0].item_ids.length===5
   &&st.posts[1].item_ids.length===1,
   '★★1回5件までに分けて送る（Worker の上限と同じ）');
ok(/まとめて切り替え：6／6件/.test(st.note),'★全部の件数で数える');
ok((st.res.match(/880025406/g)||[]).length===6,'★★6件ぶんの結果を並べて出す');

console.log('\n=== 選んでいないとき・送れなかったとき ===');
await p.evaluate(()=>{ window.__posts=[]; syncPick={}; syncRender();
  $('syncPicsBox').open=true; });
await p.click('#syncPicsBulk');
await p.waitForTimeout(200);
st=await p.evaluate(()=>({posts:window.__posts,note:$('syncPicsNote').textContent}));
ok(st.posts.length===0&&/選んでください/.test(st.note),
   '★行を選んでいなければ送らない');
await p.evaluate(()=>{ window.__fail=1; });
await p.fill('#syncPicsId','880025406600');
await p.click('#syncPicsOne');
await p.waitForTimeout(400);
st=await p.evaluate(()=>{ window.__fail=0; return {note:$('syncPicsNote').textContent}; });
console.log('   '+st.note);
ok(/送れませんでした/.test(st.note)&&/400/.test(st.note)&&/too_many/.test(st.note),
   '★★送れなかったときは理由（HTTPと中身）を出す');
ok(/やり直せます/.test(st.note),'★やり直し方も書く');

console.log('\n=== 作業者のキーでは出さない ===');
await setup('staff');
await p.waitForTimeout(300);
const sv=await p.evaluate(()=>{
  const box=$('syncPicsBox'); if(box)box.open=true;
  const v=(id)=>{ const el=$(id); return el?el.getClientRects().length>0:null; };
  syncPick={'B0PIC00001|used':true}; syncRender(); syncBarRender();
  window.__posts=[];
  syncPicsRun(['880025406600'],'1件お試し');   // 無理に呼んでも止まること
  return { box:v('syncPicsBox'), bar:v('syncBarPics'), body:document.body.className };
});
await p.waitForTimeout(300);
st=await p.evaluate(()=>({posts:window.__posts,note:$('syncPicsNote').textContent}));
console.log('   '+JSON.stringify(sv)+'／'+st.note);
ok(sv.box===false,'★★作業者のキーでは切り替えの欄を出さない');
ok(sv.bar===false,'★★下の操作バーのボタンも出さない');
ok(st.posts.length===0&&/管理者用のキーが必要/.test(st.note),
   '★★無理に呼んでも送らない');

T.done();
})();
