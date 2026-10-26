/* 画面：段取り D のボタンと、取り込みが古いときの催促（6.97）
   ・販売連携タブの「無在庫の予定を見る」「実行する」（管理者だけ）
   ・実行は確認を出してから送る
   ・MW の在庫CSVを最後に取り込んでから24時間を過ぎたら帯で催促する
   ・MW在庫の下限の既定が5点であること（6.98） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：段取り D のボタンと催促');
const ok = T.ok;
(async()=>{
const p=await T.open();

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__post=[]; window.__confirm=[];
  window.confirm=function(m){ window.__confirm.push(m); return o.okConfirm!==false; };
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/sync$/.test(url)){
      window.__post.push(b);
      return new Response(JSON.stringify(o.reply||{ok:true,mode:b.approve?'auto':'confirm',
        picked:12,zero:1,up:2,relist:1,restock:0,failed:0,
        rows:[{jan:'4902370550467',act:'zero',to:0,qty:0,why:'MWで欠品',
               title:'欠品した商品'},
              {jan:'4580416924740',act:'up',to:88.5,qty:0,
               why:'卸値が上がったので売値を上げる（下限 $80.00）',
               title:'卸値が上がった商品'},
              {jan:'4988611224878',act:'relist',to:0,qty:1,
               why:'MWに在庫が戻った（在庫 9点）',title:'戻った商品'}]}),{status:200});
    }
    if(/\/mw\/list/.test(url)){
      return new Response(JSON.stringify({ok:true,n:0,rows:[],mkt:{},
        stale_h:24, last:o.last||null}),{status:200});
    }
    if(/\/status/.test(url))
      return new Response(JSON.stringify({ok:true,items:[],counts:{}}),{status:200});
    return real(u,i);
  };
  syncRole='admin'; roleApply();
  syncData={ items:[], counts:{}, fx:160 };
  switchTab('E'); syncRender();
},o||{});

console.log('=== ボタンがある（管理者）===');
await setup({});
let b=await p.evaluate(()=>({
  box:getComputedStyle($('syncMwBox')).display,
  plan:typeof $('syncMwPlan').onclick==='function',
  go:typeof $('syncMwGo').onclick==='function',
  txt:$('syncMwBox').textContent }));
ok(b.box!=='none','★★管理者には出る');
ok(b.plan&&b.go,'★★2つのボタンが結ばれている');
ok(/欠品の数量0は取り込みのたびに自動/.test(b.txt),
   '★★★欠品は自動だと書いてある（ここで見るのは値上げと数量1）');

console.log('\n=== 予定を見る（確認を出さない・送らない）===');
await p.evaluate(()=>{ $('syncMwPlan').click(); });
await p.waitForTimeout(400);
let plan=await p.evaluate(()=>({ post:window.__post, conf:window.__confirm,
  note:$('syncMwNote').textContent, list:$('syncMwList').textContent }));
console.log('   送った: '+JSON.stringify(plan.post));
ok(plan.post.length===1&&plan.post[0].kind==='mwdrop','★★/sync {kind:mwdrop} を送る');
ok(plan.post[0].approve===false,'★★★予定は approve:false で送る（変えない）');
ok(plan.conf.length===0,'★★予定を見るだけなら確認を出さない');
console.log('   '+plan.note.replace(/\s+/g,' '));
ok(/まだ変えていません/.test(plan.note),'★★★「まだ変えていません」と出す');
ok(/見た出品 12件/.test(plan.note),'★見た件数');
ok(/数量0 1件/.test(plan.note)&&/値上げ 2件/.test(plan.note)
  &&/数量1に戻す 1件/.test(plan.note),'★★内訳を出す');
ok(/MWで欠品/.test(plan.list)&&/卸値が上がった/.test(plan.list),
   '★★★1行ずつ理由を出す');
ok(/JAN 4902370550467/.test(plan.list),'★JAN を出す');
ok(/\$88\.50/.test(plan.list),'★★値上げ後の売値を出す');

console.log('\n=== 実行（確認を出す）===');
await setup({});
await p.evaluate(()=>{ $('syncMwGo').click(); });
await p.waitForTimeout(500);
let go=await p.evaluate(()=>({ post:window.__post, conf:window.__confirm,
  note:$('syncMwNote').textContent }));
console.log('   確認: '+(go.conf[0]||'').slice(0,60));
ok(go.conf.length===1,'★★★実行の前に確認を出す');
ok(/数量・売値を変えます/.test(go.conf[0]),'★★何が起きるかを書く');
ok(/予定を見る/.test(go.conf[0]),'★★先に予定を見られると案内する');
ok(go.post.length===1&&go.post[0].approve===true,'★★★approve:true で送る');
ok(/実行しました/.test(go.note),'★★実行したと出す');
ok(!/まだ変えていません/.test(go.note),'★★「まだ」とは出さない');

console.log('\n=== 確認でやめたら送らない ===');
await setup({ okConfirm:false });
await p.evaluate(()=>{ $('syncMwGo').click(); });
await p.waitForTimeout(300);
let no=await p.evaluate(()=>window.__post.length);
ok(no===0,'★★★確認でやめたら送らない');

console.log('\n=== 作業者には出さない ===');
await p.evaluate(()=>{ syncRole='staff'; roleApply(); });
let staff=await p.evaluate(()=>getComputedStyle($('syncMwBox')).display);
ok(staff==='none','★★★作業者には出さない（数量と売値を動かすため）');
await p.evaluate(()=>{
  window.__post=[]; syncRole='staff';
  mwDropAct(true);
  return null; });
await p.waitForTimeout(200);
let sp=await p.evaluate(()=>({ post:window.__post.length,
  note:$('syncMwNote').textContent }));
ok(sp.post===0&&/管理者用のキー/.test(sp.note),
   '★★作業者が呼んでも送らない（念のための歯止め）');
await p.evaluate(()=>{ syncRole='admin'; roleApply(); });

console.log('\n=== 取り込みが24時間を過ぎたら催促する ===');
/* まだ新しいとき */
await setup({ last:{ at:new Date(Date.now()-3600000).toISOString(), at_jst:'x' } });
await p.evaluate(()=>{ switchTab._mw=0; mwStaleLoad(); });
await p.waitForTimeout(400);
let fresh=await p.evaluate(()=>getComputedStyle($('syncMwStale')).display);
ok(fresh==='none','★★1時間前なら出さない');
/* 25時間前 */
await setup({ last:{ at:new Date(Date.now()-25*3600000).toISOString(), at_jst:'x' } });
await p.evaluate(()=>{ switchTab._mw=0; mwStaleLoad(); });
await p.waitForTimeout(400);
let stale=await p.evaluate(()=>({ show:getComputedStyle($('syncMwStale')).display,
  txt:$('syncMwStale').textContent }));
console.log('   '+stale.txt.replace(/\s+/g,' '));
ok(stale.show!=='none','★★★25時間前なら帯を出す');
ok(/MW の在庫CSVを取り込んでください/.test(stale.txt),'★★★文言');
ok(/25時間前/.test(stale.txt),'★★何時間前かを出す');
ok(/売り越し/.test(stale.txt),'★★★なぜ必要かを書く');
ok(/MWの在庫CSVを取り込む/.test(stale.txt),'★★どこから入れるかを書く');
/* 一度も取り込んでいないときは出さない（MW を使っていない） */
await setup({ last:null });
await p.evaluate(()=>{ mwStaleAt=''; mwLast=null; switchTab._mw=0; mwStaleLoad(); });
await p.waitForTimeout(400);
let never=await p.evaluate(()=>getComputedStyle($('syncMwStale')).display);
ok(never==='none','★★一度も取り込んでいなければ出さない（MW を使っていない）');

console.log('\n=== MW在庫の下限の既定（6.98）===');
await p.evaluate(()=>{ switchTab('G'); });
let min=await p.evaluate(()=>({ val:$('mwStockMin').value, fn:mwStockMin(),
  note:$('mwStockMin').parentNode.textContent }));
console.log('   '+JSON.stringify(min));
ok(min.val==='5','★★★⚙設定の既定は5点');
ok(min.fn===5,'★★読み取りも5点');
ok(/既定は5点/.test(min.note),'★★なぜ5点かを書く');
let chg=await p.evaluate(()=>{ $('mwStockMin').value='2';
  const v=mwStockMin(); $('mwStockMin').value='5'; return v; });
ok(chg===2,'★★⚙設定で変えられる');

await T.done();
})();
