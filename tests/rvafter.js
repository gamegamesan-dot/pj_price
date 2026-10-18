/* 販売連携「まとめて実行」のあと（6.58）
   ・実行が終わったら自動で「状況を取り込む」を行い、予定の一覧と件数を新しくする
   ・取り込みに失敗したら、押し直すように知らせる
   ・3回続けて失敗した行は、eBay のコードと短い文を行ごとに出す
     （「対応が必要」で絞り込んだときも同じ理由が見える）
   ・予定が24時間より古いときは「予定が古いです。状況を取り込むを押してください」 */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('まとめて実行のあとの取り込みと失敗の理由');
const ok = T.ok;
(async()=>{
const p=await T.open();
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

/* 取り込み（/status）は、実行のあとの世界（予定1件・失敗の理由つき）を返す。 */
const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('autoRvMode').value='confirm'; $('autoRvMax').value='50'; $('autoRvPct').value='30';
  $('autoMdMode').value='off';
  window.__sync=[]; window.__status=0; window.__statusFail=false;
  const real=window.fetch;
  const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'66'+asin.slice(-4),ebay_qty:1,ebay_price:30,
    title:asin+'の商品',cost_yen:1200,weight_g:150,one_off:0,dropship:0,restocking:0,
    mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,ebay_sale:null,
    md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,
    revise_err:null,revise_err_at:null,
    amazon_lowest:0,amazon_offers_json:'[]',sold_usd:null,
    fba_available:1,fba_inbound:0,fba_reserved:0,warnings:[],notes:[],state:'ok'},x||{});
  window.__it=it;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(o,st)=>Promise.resolve({ok:!st||st<400,status:st||200,
      text:()=>Promise.resolve(JSON.stringify(o)), json:()=>Promise.resolve(o)});
    if(/\/status/.test(url)){
      window.__status++;
      if(window.__statusFail)return res({error:'d1_error',detail:'no such column'},500);
      /* 取り込み直したあとの世界：実行できた行は予定から消え、
         失敗した行は rv_fail=3 と eBay の理由が入っている。 */
      return res({ counts:{}, rows_total:2, limit:500, items:[
          window.__it('B0RVA00001',{rv_fail:0}),
          window.__it('B0RVA00002',{rv_fail:3,
            revise_err:'売値の自動反映 21919137 / Input data is invalid. / '
              +'The picture is smaller than 500 pixels on its longest side.',
            revise_err_at:new Date().toISOString()})],
        last_runs:[], sold_recent:[],
        rv_plan:{at:new Date().toISOString(),mode:'confirm',n:1,capped:0,rows:[
          {asin:'B0RVA00001',name:'取り込み後の予定',kind:'up',from:20,to:25,
           want:25,capped:false,loss:false}]},
        rv_last:{at:new Date().toISOString(),mode:'approve',changed:1,zeroed:0,
                 failed:1,capped:0} });
    }
    if(/\/sync/.test(url)){
      window.__sync.push(body);
      return res({mode:'approve',changed:1,zeroed:0,failed:1,capped:0});
    }
    if(/\/listings|\/settings/.test(url))return res({accepted:0});
    return real(u,i);
  };
  syncData={at:new Date().toISOString(),counts:{},items:[
    it('B0RVA00001'), it('B0RVA00002')],
    rv_plan:{at:o.planAt,mode:'confirm',n:2,capped:0,rows:[
      {asin:'B0RVA00001',name:'実行前の予定1',kind:'up',from:20,to:25,want:25,
       capped:false,loss:false},
      {asin:'B0RVA00002',name:'実行前の予定2',kind:'up',from:30,to:35,want:35,
       capped:false,loss:false}]},
    rv_last:null};
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E'); syncRender();
},o||{});

const view=async()=>await p.evaluate(()=>({
  note:$('syncRvNote').innerText, list:$('syncRvList').innerText,
  go:$('syncRvGo').textContent, done:$('syncRvDone').textContent,
  status:window.__status, sync:window.__sync,
  n:syncRvPlanRows().n, at:syncRvPlanRows().at }));

console.log('=== 実行のあと、自動で取り込む ===');
await setup({planAt:new Date().toISOString()});
await openCsvBoxes(p);
let v=await view();
console.log('   前: '+v.go+'／予定 '+v.n+'件');
ok(/まとめて実行（2件）/.test(v.go)&&v.status===0,'★実行前は予定2件・取り込みはしていない');
await p.click('#syncRvGo');
await p.waitForTimeout(600);
v=await view();
console.log('   送った内容: '+JSON.stringify(v.sync));
console.log('   結果: '+v.done);
console.log('   後: '+v.go+'／予定 '+v.n+'件　一覧: '+v.list.replace(/\n/g,' / '));
ok(v.sync.length===1&&v.sync[0].approve===true,'★pj-sync に「承認して実行」を送る');
ok(v.status===1,'★★実行が終わったら自動で「状況を取り込む」を行う');
ok(/上げた 1件／数量0 0件／失敗 1件/.test(v.done),'★実行の結果を出す');
ok(/最新の状況に更新しました/.test(v.done),'★★取り込んだことも知らせる');
ok(v.n===1&&/まとめて実行（1件）/.test(v.go),
   '★★予定の件数が新しくなる（実行できた行は消える）');
ok(/取り込み後の予定/.test(v.list)&&!/実行前の予定/.test(v.list),
   '★★予定の一覧も新しくなる');
ok(/前回/.test(v.note)&&/上げた 1件/.test(v.note),'★前回の結果も新しくなる');

console.log('\n=== 3回続けて失敗した行の理由 ===');
const row=await p.evaluate(()=>{
  const r=(syncData.items||[]).find(x=>x.asin==='B0RVA00002');
  const d=document.querySelector('#syncList [data-srow="B0RVA00002|used"]');
  return { why:syncRvWhy(r), alert:syncRvAlert(r),
    card:d?d.innerText.replace(/\n/g,' | '):'',
    warn:syncFilterBy('warn').f(r), n:syncRvFail3() };
});
console.log('   理由: '+row.why);
console.log('   カード: '+row.card.slice(0,220));
ok(row.alert&&row.n===1,'★3回失敗の行を数える');
ok(/コード 21919137/.test(row.why)&&/Input data is invalid/.test(row.why),
   '★★eBay のコードと短い文を取り出す');
ok(/自動反映が3回失敗/.test(row.card)&&/コード 21919137/.test(row.card)
   &&/Input data is invalid/.test(row.card),
   '★★行のカード（畳まずに見えるところ）に理由を出す');
ok(/長辺500px以上の写真に差し替え/.test(row.card),'★直し方が分かるものは直し方も出す');
ok(row.warn===true,'★★「対応が必要」の絞り込みに入る');
const warn=await p.evaluate(()=>{
  $('syncFilter').value='warn'; syncPage=1; syncRender();
  const d=document.querySelector('#syncList [data-srow="B0RVA00002|used"]');
  return { rows:document.querySelectorAll('#syncList .lcard').length,
    card:d?d.innerText.replace(/\n/g,' | '):'',
    breakdown:$('syncWarnBreak').textContent };
});
console.log('   対応が必要: '+warn.rows+'件　'+warn.breakdown);
ok(warn.rows===1&&/コード 21919137/.test(warn.card)&&/Input data is invalid/.test(warn.card),
   '★★絞り込んだあとも同じ理由が見える');
ok(/売値の自動反映が3回失敗/.test(warn.breakdown),'★内訳にも出る');
await p.evaluate(()=>{ $('syncFilter').value='all'; syncRender(); });

console.log('\n=== 予定が古いとき ===');
await setup({planAt:new Date(Date.now()-25*3600*1000).toISOString()});
v=await view();
console.log('   '+v.note.replace(/\n/g,' / '));
ok(/予定が古いです。状況を取り込むを押してください/.test(v.note),
   '★★24時間より古い予定は、取り込み直すように出す');
await setup({planAt:new Date(Date.now()-23*3600*1000).toISOString()});
v=await view();
ok(!/予定が古いです/.test(v.note),'★★24時間以内なら出さない');
const local=await p.evaluate(()=>{
  syncData.rv_plan=null; syncRender();
  return { from:syncRvPlanRows().from, old:syncRvPlanOld(),
           note:$('syncRvNote').innerText };
});
console.log('   '+JSON.stringify({from:local.from,old:local.old}));
ok(local.from==='local'&&local.old===false,
   '★この端末で計算した予定には出さない（時刻が無いため）');

console.log('\n=== 取り込みに失敗したとき ===');
await setup({planAt:new Date().toISOString()});
await p.evaluate(()=>{ window.__statusFail=true; });
await p.click('#syncRvGo');
await p.waitForTimeout(600);
v=await view();
console.log('   '+v.done);
ok(/上げた 1件/.test(v.done)&&/状況の取り込みに失敗しました/.test(v.done),
   '★★取り込みに失敗しても、実行の結果は残す');
ok(/「状況を取り込む」を押してください/.test(v.done),'★★押し直すように知らせる');
ok(await p.evaluate(()=>$('syncLoad').disabled===false&&$('syncRvGo').disabled===false),
   '★ボタンは押せる状態に戻る');

T.done();
})();
