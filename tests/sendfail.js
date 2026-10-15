/* 送信の結果の見方（6.49）
   wrangler tail が Ok でも応答が HTTP 500（D1 のエラーなど）のことがある。
   ・失敗したら HTTP の状態と Worker のエラー文を画面に出す
   ・D1 の列が無いときは、どの migrate を実行すればよいかまで出す
   ・分けて送ったうち一部だけ失敗したら、送れたぶんは控えに残し、件数も分けて出す
   ・受け取れなかった件数（rejected）も出す
   ・通信そのものができなかったときはそう書く */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('送信の結果の見方（失敗の理由を出す）');
const ok = T.ok;
(async()=>{
const p=await T.open();
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

/* 433件ぶんの行（3回に分けて送られる）。mode で応答を切り替える。
   fail=[n,...] … n回目（0から）の送信を失敗させる */
const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('zone').value='2'; $('baseProfit').value='1000';
  $('linkRate').value='30'; $('saleRate').value='15'; $('usTaxRate').value='8';
  $('targetMode').value='auto'; $('syncSoldCut').value='0';
  $('csvReviewAbs').value='1'; $('csvReviewPct').value='3';
  $('autoRvMode').value='confirm'; $('autoMdMode').value='off';
  window.__calls=[];
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    if(/\/settings/.test(url))
      return Promise.resolve({ok:true,status:200,
        text:()=>Promise.resolve(JSON.stringify({ok:true,stored:true,at:body.at,
          settings:body.settings})),
        json:()=>Promise.resolve({ok:true,stored:true,at:body.at,settings:body.settings})});
    if(/\/listings/.test(url)){
      const n=window.__calls.length;
      window.__calls.push(body.items.length);
      if((o.net||[]).indexOf(n)>=0)
        return Promise.reject(new TypeError('Failed to fetch'));
      if((o.fail||[]).indexOf(n)>=0)
        return Promise.resolve({ok:false,status:500,
          text:()=>Promise.resolve(JSON.stringify({error:'server_error',
            detail:'D1_ERROR: no such column: rv_want at offset 0: SQLITE_ERROR'}))});
      const rj=(o.reject||0);
      return Promise.resolve({ok:true,status:200,
        text:()=>Promise.resolve(JSON.stringify({accepted:body.items.length-rj,
          rejected:rj}))});
    }
    return real(u,i);
  };
  const it=(i)=>({asin:'B0SF'+String(100000+i).slice(0,6),cond:'used',scope:'ebay',
    prefix:'game',ebay_sku:'E-SF'+i,ebay_item_id:'44'+i,ebay_qty:1,ebay_price:15,
    title:'商品'+i,cost_yen:1200,weight_g:150,one_off:0,dropship:0,restocking:0,
    mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,ebay_sale:null,
    md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,
    amazon_lowest:0,amazon_offers_json:'[]',sold_usd:null,
    fba_available:1,fba_inbound:0,fba_reserved:0,warnings:[],notes:[],state:'ok'});
  const rows=[]; for(let i=1;i<=433;i++)rows.push(it(i));
  syncData={at:new Date().toISOString(),counts:{},items:rows};
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E'); syncRender();
  return { need:syncRvNeed().length, btn:$('syncRvSend').textContent };
},o||{});

console.log('=== 433件を3回に分けて送る ===');
let st=await setup({});
await openCsvBoxes(p);
console.log('   '+JSON.stringify(st));
ok(st.need===433&&/見直しの目標を送る（433件）/.test(st.btn),'★433件が対象');
await p.click('#syncRvSend');
await p.waitForFunction(()=>$('syncRvDone').textContent.length>0
  &&!/送っています/.test($('syncRvDone').textContent),null,{timeout:8000});
let r=await p.evaluate(()=>({calls:window.__calls,done:$('syncRvDone').textContent,
  need:syncRvNeed().length}));
console.log('   送った回: '+JSON.stringify(r.calls));
console.log('   '+r.done);
ok(r.calls.join()==='200,200,33','★200件ずつ3回に分けて送る');
ok(/目標を 433件 pj-sync に残しました/.test(r.done)&&!/送れませんでした/.test(r.done),
   '★全部通ったら件数を出す（433件）');
ok(r.need===0,'★送れた行は控えに反映して、対象から外れる');

console.log('\n=== 全部が HTTP 500（D1 に列が無い）===');
st=await setup({fail:[0,1,2]});
await openCsvBoxes(p);
await p.click('#syncRvSend');
await p.waitForFunction(()=>$('syncRvDone').textContent.length>0
  &&!/送っています/.test($('syncRvDone').textContent),null,{timeout:8000});
r=await p.evaluate(()=>({done:$('syncRvDone').textContent,need:syncRvNeed().length}));
console.log('   '+r.done);
ok(/送れませんでした 433件/.test(r.done),'★送れなかった件数を出す');
ok(/HTTP 500/.test(r.done)&&/server_error/.test(r.done),
   '★★HTTPの状態と Worker のエラー名を出す（件数だけで終わらせない）');
ok(/no such column: rv_want/.test(r.done),'★★D1 のエラー文もそのまま出す');
ok(/migrate-0018-auto-review\.sql を実行/.test(r.done),
   '★★どの migrate を実行すればよいかまで出す');
ok(r.need===433,'★送れていないので、対象はそのまま残る');

console.log('\n=== 一部だけ失敗（3回のうち2回目だけ 500）===');
st=await setup({fail:[1]});
await openCsvBoxes(p);
await p.click('#syncRvSend');
await p.waitForFunction(()=>$('syncRvDone').textContent.length>0
  &&!/送っています/.test($('syncRvDone').textContent),null,{timeout:8000});
r=await p.evaluate(()=>({done:$('syncRvDone').textContent,need:syncRvNeed().length,
  btn:$('syncRvSend').textContent}));
console.log('   '+r.done);
console.log('   残り: '+r.need+'件　ボタン: '+r.btn);
ok(/送れませんでした 200件/.test(r.done)&&/送れた 233件は残っています/.test(r.done),
   '★★送れた件数と送れなかった件数を分けて出す');
ok(r.need===200&&/見直しの目標を送る（200件）/.test(r.btn),
   '★★送れた行は控えに残し、もう一度押すと残りだけを送る');
const again=await p.evaluate(async()=>{
  window.__calls=[];
  $('syncRvSend').click();
  return new Promise((res)=>setTimeout(()=>res(window.__calls),600));
});
console.log('   もう一度押したとき: '+JSON.stringify(again));
ok(again.join()==='200','★2回目は残りの200件だけを送る');

console.log('\n=== 受け取れなかった行（rejected）も出す ===');
st=await setup({reject:5});
await openCsvBoxes(p);
await p.click('#syncRvSend');
await p.waitForFunction(()=>$('syncRvDone').textContent.length>0
  &&!/送っています/.test($('syncRvDone').textContent),null,{timeout:8000});
r=await p.evaluate(()=>$('syncRvDone').textContent);
console.log('   '+r);
ok(/目標を 418件/.test(r)&&/受け取れなかった 15件/.test(r),
   '★受け取れた件数と受け取れなかった件数を分けて出す');

console.log('\n=== 通信そのものができないとき ===');
st=await setup({net:[0,1,2]});
await openCsvBoxes(p);
await p.click('#syncRvSend');
await p.waitForFunction(()=>$('syncRvDone').textContent.length>0
  &&!/送っています/.test($('syncRvDone').textContent),null,{timeout:8000});
r=await p.evaluate(()=>$('syncRvDone').textContent);
console.log('   '+r);
ok(/通信できませんでした/.test(r)&&/Failed to fetch/.test(r),
   '★通信できないときは、そう分かる文にする');

console.log('\n=== 自動値下げの設定を送るときも同じ ===');
await p.evaluate(()=>{
  $('autoMdMode').value='plan';
  $('csvMarkDays').value='3'; $('csvMarkTimes').value='10'; $('csvMarkStep').value='1';
  window.fetch=(function(real){ return function(u,i){
    const url=String(u);
    if(/\/listings/.test(url))
      return Promise.resolve({ok:false,status:500,
        text:()=>Promise.resolve(JSON.stringify({error:'server_error',
          detail:'D1_ERROR: no such column: md_step'}))});
    if(/\/settings/.test(url))
      return Promise.resolve({ok:true,status:200,
        text:()=>Promise.resolve('{"ok":true,"stored":true}')});
    return real(u,i);
  }; })(window.fetch);
  /* 自動値下げの対象になる行にする（売値が最低売値よりずっと高い行）。 */
  syncData.items=syncData.items.slice(0,3);
  syncData.items.forEach(function(r){ r.ebay_price=90; r.mark_at=null; });
  syncRender();
  return { need:syncMdNeed().length, dis:$('syncMdSend').disabled };
});
await openCsvBoxes(p);
dlg.length=0;
console.log('   対象: '+JSON.stringify(await p.evaluate(()=>({need:syncMdNeed().length,
  dis:$('syncMdSend').disabled}))));
await p.click('#syncMdSend');
await p.waitForFunction(()=>!$('syncMdSend').disabled,null,{timeout:8000});
await p.waitForTimeout(300);
const mdNote=await p.evaluate(()=>$('syncMdNote').innerText);
console.log('   '+mdNote.replace(/\n/g,' / '));
ok(/送れませんでした 3件/.test(mdNote)&&/no such column: md_step/.test(mdNote)
   &&/migrate-0016-auto-markdown\.sql/.test(mdNote),
   '★自動値下げの設定でも、理由と migrate の名前を出す');

console.log('\n=== 取り込み（状況を取り込む）でも理由を出す ===');
await p.evaluate(()=>{
  window.fetch=function(u){
    if(/\/status/.test(String(u)))
      return Promise.resolve({ok:false,status:500,
        text:()=>Promise.resolve(JSON.stringify({error:'server_error',
          detail:'D1_ERROR: no such column: rv_want'}))});
    return Promise.reject(new Error('想定外'));
  };
});
await p.click('#syncLoad');
await p.waitForFunction(()=>!$('syncLoad').disabled,null,{timeout:8000});
const say=await p.evaluate(()=>$('syncNote').textContent);
console.log('   '+say);
ok(/取り込みに失敗しました/.test(say)&&/HTTP 500/.test(say)
   &&/no such column: rv_want/.test(say)&&/migrate-0018/.test(say),
   '★取り込みの失敗も、理由と migrate の名前を出す');

await T.done();
})();
