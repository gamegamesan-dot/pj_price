/* 画面：電池・危険物の申告（確認の画面・7.92／6.127）
   ・確認の画面に、行ごとに「付ける申告」を出す（自動か、人が選んだか）
   ・自動で付けられない行（ほかの種類・商品名に LED など）は選ぶ欄を出し、
     選ぶまで「1件だけ送る」を押せない
   ・選んだ申告は送るときに一緒に渡す
   ・結果には「何を足せばよいか」の案内と、足りない項目名、
     「同じ SKU で送り直せる」ことを出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：電池・危険物の申告');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const ROWS=[
 { jan:'4580590170018', sha:'MC02', kishu:'figure', mw_name:'怪物事変 日下夏羽',
   amz_name:'怪物事変 日下夏羽 1/8 フィギュア', wholesale:11713, stock:9,
   ship_text:'即日出荷', ship_days:0, asin:'B091VLKFVC', price:19800,
   basis:'カート', new_n:3, amz:0, rst:'ok', cond:'新品', list_price:24200,
   rank:3000, rank_cat:'ホビー' },
 { jan:'4580590170019', sha:'MC02', kishu:'figure', mw_name:'LED で光る置物',
   amz_name:'LED で光る置物', wholesale:5000, stock:9, ship_text:'即日出荷',
   ship_days:0, asin:'B0LED00001', price:12800, basis:'カート', new_n:3,
   amz:0, rst:'ok', cond:'新品', list_price:15000, rank:4000, rank_cat:'ホビー' }];
const META={ ok:true, n:2, rows:ROWS, seen:2, priced:2, left:0, per_run:120,
  ttl_days:3, limit:3000 };
const PLAN={
  B091VLKFVC:{ ptype:'TOY_FIGURE', auto:true, hand:false, batteries:false,
    dg:'not_applicable',
    why:'フィギュア・プラモデルなので「電池なし・危険物に該当しない」で送ります',
    req:['batteries_required','supplier_declared_dg_hz_regulation'],
    def_err:'', need_batt:true, need_dg:true },
  B0LED00001:{ ptype:'TOY_FIGURE', auto:false, hand:false, batteries:null, dg:'',
    why:'商品名に電池・発光などの言葉があります（電池の申告を選んでください）',
    req:['batteries_required'], def_err:'', need_batt:true, need_dg:true }};

const setup=async()=>await p.evaluate(([META,PLAN])=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='5';
  $('mwKishu').value='figure'; $('mwAmzFeeHobby').value='10';
  $('mwAmzFbaHobby').value='580';
  window.__posts=[]; window.__checks=0; window.__putReply=null;
  window.__buy={ '4580590170018':1, '4580590170019':1 };
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/mw\/put/.test(url)){
      if(i&&i.method==='POST'){
        if(b&&b.check){
          window.__checks++;
          return new Response(JSON.stringify({ok:true,plan:(b.rows||[]).map((x)=>
            Object.assign({sku:x.sku,asin:x.asin},PLAN[x.asin]||{}))}),{status:200});
        }
        window.__posts.push(b);
        return new Response(JSON.stringify(window.__putReply||{ok:true,
          sent:(b.rows||[]).length,ok_n:(b.rows||[]).length,ng:0,
          rows:(b.rows||[]).map((x)=>({sku:x.sku,asin:x.asin,ok:true,
            status:'ACCEPTED',issues:[],err:'',ptype:'TOY_FIGURE',
            dg:(b.dg||{})[x.sku]||{batteries:false,dg:'not_applicable',hand:false}}))
        }),{status:200});
      }
      return new Response(JSON.stringify({ok:true,rows:[],sent_ok:0,max:30}),
        {status:200});
    }
    if(/\/mw\/buy/.test(url)){
      if(i&&i.method==='POST')return new Response(JSON.stringify({ok:true}),{status:200});
      const rows=Object.keys(window.__buy).map((j)=>{
        const r=(META.rows||[]).filter((x)=>String(x.jan)===j)[0]||{};
        return Object.assign({},r,{ qty:window.__buy[j], gone_at:null });
      });
      return new Response(JSON.stringify({ok:true,rows:rows,n:rows.length,gone:0}),
        {status:200});
    }
    if(/\/mw\/amz/.test(url))
      return new Response(JSON.stringify(META),{status:200});
    return real(u,i);
  };
  syncRole='admin'; roleApply(); switchTab('F');
},[META,PLAN]);
const show=async()=>{
  await p.evaluate(()=>{ $('csvMwPut').click(); });
  await p.waitForTimeout(700);
  return p.evaluate(()=>({ html:$('csvMwPutBox').innerHTML,
    text:($('csvMwPutBox').innerText||'').replace(/\s+/g,' '),
    checks:window.__checks }));
};

console.log('=== 確認の画面に申告を出す ===');
await setup();
await openCsvBoxes(p);
await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
await p.waitForTimeout(400);
let v=await show();
console.log('   下調べ '+v.checks+'回 / '+v.text.slice(0,200));
ok(v.checks===1,'★★★確認の画面を出すとき、種類と必須項目を調べる（check=1）');
ok(/種類 TOY_FIGURE/.test(v.text),'★★★行ごとに Amazon の種類を出す');
ok(/申告：電池なし／危険物に該当しない（自動）/.test(v.text),
   '★★★自動で付ける申告を行ごとに出す');
ok(/フィギュア・プラモデルなので/.test(v.text),'★★なぜ自動なのかも出す');
ok(/この種類で必須：電池・危険物/.test(v.text),
   '★★その種類で必須だと分かるように出す');
ok(/1件/.test(v.text)&&/選んでください/.test(v.text),
   '★★★選ぶ必要がある件数を出す');
ok(/選んでください/.test(v.text),'★★★選んでいない行はそう出す');
ok(v.html.indexOf('data-dgsku="')>=0,'★★★選ぶ欄を出す');
ok(/電池は入っていない/.test(v.html)&&/電池が入っている/.test(v.html),
   '★★選べるのは「入っていない」「入っている」');

console.log('\n=== 選ぶまで送らない ===');
let dis=await p.evaluate(()=>({ one:$('csvMwPutOne').disabled,
  all:!!document.getElementById('csvMwPutAll') }));
console.log('   '+JSON.stringify(dis));
ok(dis.one===false,'★★★申告が決まっている行があるので「1件だけ送る」は押せる');
await p.evaluate(()=>{ $('csvMwPutOne').click(); });
await p.waitForTimeout(600);
let pp=await p.evaluate(()=>window.__posts[0]);
console.log('   送った: '+JSON.stringify((pp.rows||[]).map((x)=>x.asin))
  +' / dg '+JSON.stringify(pp.dg));
ok((pp.rows||[]).length===1&&pp.rows[0].asin==='B091VLKFVC',
   '★★★送るのは申告が決まっている行だけ（LED の行は送らない）');

console.log('\n=== 人が選べば送れる ===');
v=await show();
await p.evaluate(()=>{
  const sel=document.querySelector('#csvMwPutBox select[data-dgsku]');
  sel.value='yes'; sel.dispatchEvent(new Event('change'));
});
await p.waitForTimeout(300);
v=await p.evaluate(()=>({ text:($('csvMwPutBox').innerText||'').replace(/\s+/g,' '),
  html:$('csvMwPutBox').innerHTML }));
console.log('   '+v.text.slice(0,180));
ok(/申告：電池あり／危険物に該当しない（選びました）/.test(v.text),
   '★★★選んだ申告を行に出す');
ok(v.html.indexOf('data-dgsku="')<0,'★★選び終わった行の欄は消える');
ok(!/選んでください/.test(v.text),'★★「選んでください」は消える');
await p.evaluate(()=>{ window.__posts=[]; $('csvMwPutOne').click(); });
await p.waitForTimeout(600);
pp=await p.evaluate(()=>window.__posts[0]);
console.log('   送った dg: '+JSON.stringify(pp.dg));
const key=Object.keys(pp.dg||{})[0]||'';
ok(/B0LED00001/.test(key),'★★★選んだ行の SKU で申告を送る');
ok(pp.dg[key].batteries===true&&pp.dg[key].dg==='not_applicable',
   '★★★選んだとおり（電池あり・該当しない）を送る');

console.log('\n=== 結果に案内を出す ===');
await p.evaluate(()=>{
  window.__putReply={ ok:true, sent:1, ok_n:0, ng:1, rows:[{
    sku:'mwhobby-20261031-N-B091VLKFVC-11713', asin:'B091VLKFVC', ok:false,
    status:'INVALID', ptype:'TOY_FIGURE',
    dg:{batteries:false,dg:'not_applicable',hand:false},
    err:"90220: '原産国' は必須ですが、入力されていません。",
    missing:['country_of_origin'],
    hint:'必須の項目が足りません：country_of_origin（この項目は pj からは送れないので、'
      +'セラーセントラルの商品編集で入れてから、同じ SKU で送り直してください）',
    issues:[{code:'90220',severity:'ERROR',
      message:"'原産国' は必須ですが、入力されていません。",
      attributeNames:['country_of_origin']}] }] };
});
await show();
await p.evaluate(()=>{ $('csvMwPutOne').click(); });
await p.waitForTimeout(600);
const res=await p.evaluate(()=>({ text:($('csvMwPutBox').innerText||'')
  .replace(/\s+/g,' ') }));
console.log('   '+res.text.slice(0,260));
ok(/だめ/.test(res.text),'★だめだったと出す');
ok(/90220/.test(res.text)&&/原産国/.test(res.text),'★★エラーの文をそのまま出す');
ok(/→ 必須の項目が足りません/.test(res.text),
   '★★★何を足せばよいかの案内を出す');
ok(/足りない項目：country_of_origin/.test(res.text),
   '★★★足りない項目の名前も出す');
ok(/同じ SKU のまま/.test(res.text),
   '★★★直したら同じ SKU で送り直せると出す（べき等）');
ok(/種類 TOY_FIGURE/.test(res.text)&&/申告 電池なし/.test(res.text),
   '★★結果にも種類と付けた申告を出す');
await T.done();
})();
