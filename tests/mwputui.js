/* 画面：税抜の式の設定・Amazon への登録の確認画面・JAN重複の絞り込み
   （6.111／6.112／6.113） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：税抜の式と Amazon 登録');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const base={ sha:'M200', kishu:'PS5', cond:'新品', stock:9, note:'',
  ship_text:'即日出荷', ship_days:0, basis:'カート', new_n:4, amz:0,
  rank:100, rank_cat:'ゲーム', list_price:9800, gone_at:null, qty:1,
  rst:'ok', rst_why:'', rst_link:'', rst_at:'2026-10-29T01:00:00Z',
  cand_n:1, cands:null, jan_picked_at:null,
  fee_ref:null, fee_fba:null, fee_tax:null, fee_total:null, fee_base:null,
  fee_at:null, fee_err:null };
/* サイヴァリア3（せどりすと の内訳どおりの手数料） */
const SAI=Object.assign({},base,{ jan:'4944076005667',
  mw_name:'サイヴァリア3 限定版', amz_name:'サイヴァリア3 限定版 PS5',
  wholesale:4500, asin:'B0SAIVA001', price:9638,
  fee_ref:1484, fee_fba:441, fee_tax:148, fee_total:2073, fee_base:9638,
  fee_at:'2026-10-29T01:00:00Z' });
/* JAN重複（値段も ASIN も無い。v204 ではこの行が一覧から落ちていた） */
const DUP=Object.assign({},base,{ jan:'4573102666987', kishu:'FIG',
  mw_name:'ウルトラマン ソフビ ティガ', amz_name:'', wholesale:3000,
  asin:'', price:null, cand_n:2,
  cands:JSON.stringify([
    { asin:'B00STARW01', name:'スター・ウォーズ ブラックシリーズ' },
    { asin:'B00ULTRA01', name:'ウルトラマン ソフビ ティガ 新品' }]) });
const META={ ok:true, n:2, rows:[SAI,DUP], seen:2, priced:1, left:0,
  per_run:120, ttl_days:3, limit:3000 };

const setup=async()=>await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='5';
  $('mwKishu').value='PS5,FIG'; $('mwNewOnly').checked=true;
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  window.__posts=[]; window.__putReply=null; window.__log=[]; window.__sentOk=0;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/mw\/put/.test(url)){
      if(i&&i.method==='POST'){
        window.__posts.push({url:url,body:b});
        return new Response(JSON.stringify(window.__putReply||{ok:true,sent:1,
          ok_n:1,ng:0,rows:[{sku:b.rows[0].sku,asin:b.rows[0].asin,ok:true,
            status:'ACCEPTED',issues:[],err:''}]}),{status:200});
      }
      return new Response(JSON.stringify({ok:true,rows:window.__log,
        sent_ok:window.__sentOk,max:30}),{status:200});
    }
    if(/\/mw\/buy/.test(url)){
      if(i&&i.method==='POST')return new Response(JSON.stringify({ok:true}),{status:200});
      return new Response(JSON.stringify({ok:true,n:1,qty:1,yen:4950,gone:0,
        rows:[{jan:'4944076005667',qty:1,sha:'M200',mw_name:'サイヴァリア3 限定版',
               amz_name:'サイヴァリア3 限定版 PS5',wholesale:4500,
               asin:'B0SAIVA001',price:9638,rst:'ok',cand_n:1,kishu:'PS5',
               cond:'新品',stock:9,ship_days:0,gone_at:null}]}),{status:200});
    }
    if(/\/mw\/amz/.test(url))
      return new Response(JSON.stringify(META),{status:200});
    return real(u,i);
  };
  syncRole='admin'; switchTab('D'); roleApply(); csvRender();
},META);

console.log('=== 税抜の式（6.111）===');
await setup();
await openCsvBoxes(p);
let cfg=await p.evaluate(()=>({ has:!!$('mwNetMode'), v:$('mwNetMode').value,
  opts:Array.prototype.map.call($('mwNetMode').options,(o)=>o.value).join(',') }));
console.log('   '+JSON.stringify(cfg));
ok(cfg.has===true,'★設定がある');
ok(cfg.v==='sedori','★★★既定は せどりすと方式');
ok(cfg.opts==='sedori,exact','★2つから選ぶ');
let n=await p.evaluate((R)=>{
  mwAmzRows=R;
  const f=()=>{ const c=mwAmzCalc(R[0]); return { profit:c.profit, net:c.net,
    mode:c.netMode, label:mwNetLabel() }; };
  $('mwNetMode').value='sedori'; const a=f();
  $('mwNetMode').value='exact';  const b=f();
  $('mwNetMode').value='sedori';
  return { a:a, b:b, neg:mwNet(-500) };
},[SAI,DUP]);
console.log('   '+JSON.stringify(n));
ok(n.a.profit===9638-2073-5126,'★税込の粗利（売値−手数料−仕入）');
ok(n.a.profit===2439,'★この例の税込粗利は 2,439円');
ok(n.a.net===Math.round(2439*0.9),'★★★せどりすと方式は ×0.9');
ok(n.b.net===Math.round(2439*10/11),'★★★もう一方は ×10/11');
ok(n.a.net<n.b.net,'★★せどりすと方式のほうが低く（安全側に）出る');
ok(/せどりすと方式/.test(n.a.label)&&/10\/11/.test(n.b.label),
   '★★どちらで出したか画面に書く');
ok(n.neg===-500,'★★★赤字の行はどちらでも引かない');
/* 行の表示にも式が出る */
await p.evaluate((R)=>{ mwAmzRows=R; mwAmzMeta={n:2,seen:2,priced:1,left:0};
  mwBuyMap={}; mwAmzRender(); },[SAI,DUP]);
await p.waitForTimeout(120);
let html=await p.evaluate(()=>$('csvMwAmzList').innerHTML);
ok(/せどりすと方式/.test(html),'★★★行に「せどりすと方式」と出す');

console.log('\n=== JAN重複の絞り込み（6.112）===');
/* v204 では値段が無い行が一覧から落ちていた */
let shown=await p.evaluate(()=>mwAmzPicked().map((x)=>String(x.r.jan)));
console.log('   既定で出る: '+JSON.stringify(shown));
ok(shown.indexOf('4573102666987')>=0,
   '★★★値段が無い JAN重複の行も一覧に出る（落とさない）');
ok(/JAN重複（要確認）/.test(html),'★★印を出す');
ok(/B00ULTRA01/.test(html)&&/これにする/.test(html),
   '★★★候補と「これにする」を出す');
let note=await p.evaluate(()=>$('csvMwAmzListNote').textContent);
console.log('   '+note.replace(/\s+/g,' ').slice(0,120));
ok(/JAN重複 1件/.test(note),'★★★件数を案内に出す');
ok((await p.evaluate(()=>$('csvMwAmzDupN').textContent))==='（1件）',
   '★★絞り込みの横にも件数を出す');
/* 絞り込みで重複だけに */
await p.evaluate(()=>{ $('csvMwAmzDup').checked=true; mwAmzRender(); });
await p.waitForTimeout(120);
let only=await p.evaluate(()=>mwAmzPicked().map((x)=>String(x.r.jan)));
console.log('   重複だけ: '+JSON.stringify(only));
ok(only.length===1&&only[0]==='4573102666987','★★★JAN重複だけになる');
await p.evaluate(()=>{ $('csvMwAmzDup').checked=false;
  $('csvMwAmzSort').value='genre'; mwAmzRender(); });
await p.waitForTimeout(120);
ok(/JAN重複（要確認）/.test(await p.evaluate(()=>$('csvMwAmzList').innerHTML)),
   '★★ジャンル別でも落ちない（専用の束に入る）');
await p.evaluate(()=>{ $('csvMwAmzSort').value='net'; mwAmzRender(); });

console.log('\n=== Amazon に登録する（6.113）===');
ok(await p.evaluate(()=>typeof $('csvMwPut').onclick==='function'),
   '★★ボタンが結ばれている');
await p.evaluate(()=>{ $('csvMwPut').click(); });
await p.waitForTimeout(600);
let box=await p.evaluate(()=>({ show:$('csvMwPutBox').style.display!=='none',
  html:$('csvMwPutBox').innerHTML }));
console.log('   '+box.html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,180));
ok(box.show===true,'★★★押すと確認の画面が出る');
ok(/送るのは <b>1件<\/b>/.test(box.html),'★★★件数を出す');
ok(/mwgame-\d{8}-N-B0SAIVA001-5126/.test(box.html),'★★★SKU の一覧を出す');
ok(/B0SAIVA001/.test(box.html),'★★ASIN も出す');
ok(/9,638/.test(box.html),'★★売値も出す');
ok(/相乗り出品/.test(box.html),'★何をするか書く');
ok(/1件だけ送る/.test(box.html),'★★★「1件だけ送る」がある');
/* 案内の文にも「まとめて送る」が出るので、**ボタンの有無**で見る。 */
ok(box.html.indexOf('id="csvMwPutAll"')<0,
   '★★★最初は「まとめて送る」のボタンを出さない');
ok(box.html.indexOf('id="csvMwPutOne"')>=0,'★「1件だけ送る」のボタンはある');
ok(/まず <b>1件だけ送って<\/b>/.test(box.html),'★★先に1件だけ、と書く');
/* 押す前は1回も送っていない */
ok((await p.evaluate(()=>window.__posts.length))===0,
   '★★★確認の画面を出しただけでは送らない');
/* 1件だけ送る */
await p.evaluate(()=>{ $('csvMwPutOne').click(); });
await p.waitForTimeout(600);
let pp=await p.evaluate(()=>window.__posts[0]);
console.log('   送った: '+JSON.stringify(pp&&pp.body).slice(0,200));
ok(!!pp&&pp.body.rows.length===1,'★★★1件だけ送る');
ok(/^mwgame-/.test(pp.body.rows[0].sku)&&pp.body.rows[0].asin==='B0SAIVA001',
   '★★SKU と ASIN を送る');
ok(pp.body.rows[0].price===9638,'★★売値を送る');
ok(pp.body.rows[0].cost_src===5126,'★仕入値も送る（skus に控えるため）');
let res=await p.evaluate(()=>$('csvMwPutBox').innerHTML);
ok(/結果/.test(res)&&/通った/.test(res),'★★★結果を行ごとに出す');
ok(/ACCEPTED/.test(res),'★★Amazon の status も出す');
let nt=await p.evaluate(()=>$('csvMwPutNote').textContent);
console.log('   '+nt);
ok(/送った 1件/.test(nt)&&/通った 1/.test(nt),'★★件数を出す');

console.log('\n=== だめだった行の出し方 ===');
await p.evaluate(()=>{
  window.__posts=[];
  window.__putReply={ok:true,sent:1,ok_n:0,ng:1,rows:[{
    sku:'mwgame-20261029-N-B0SAIVA001-5126',asin:'B0SAIVA001',ok:false,
    status:'ACCEPTED',err:'90220: この商品は出品に承認が必要です',
    issues:[{code:'90220',severity:'ERROR',
      message:'この商品は出品に承認が必要です'}]}]};
  $('csvMwPut').click();
});
await p.waitForTimeout(600);
await p.evaluate(()=>{ $('csvMwPutOne').click(); });
await p.waitForTimeout(600);
res=await p.evaluate(()=>$('csvMwPutBox').innerHTML);
console.log('   '+res.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').slice(0,160));
ok(/だめ/.test(res),'★★★だめだったと出す');
ok(/90220/.test(res)&&/承認が必要/.test(res),
   '★★★指摘のコードと文をそのまま出す');

console.log('\n=== 1件でも通ってから「まとめて送る」 ===');
await p.evaluate(()=>{ window.__sentOk=1; window.__putReply=null;
  $('csvMwPut').click(); });
await p.waitForTimeout(600);
box=await p.evaluate(()=>$('csvMwPutBox').innerHTML);
ok(box.indexOf('id="csvMwPutAll"')>=0,
   '★★★1件でも通っていれば「まとめて送る」のボタンが出る');
ok(box.indexOf('id="csvMwPutOne"')>=0,'★「1件だけ送る」も残る');

console.log('\n=== 作業者には出さない ===');
/* roleApply() は引数を取らず、syncRole を見る（6.113 のテストで踏んだ）。 */
await p.evaluate(()=>{ syncRole='staff'; roleApply(); });
await p.waitForTimeout(150);
let st=await p.evaluate(()=>{
  const el=$('csvMwPut');
  return { shown:getComputedStyle(el).display!=='none' };
});
console.log('   '+JSON.stringify(st));
ok(st.shown===false,'★★★作業者にはボタンを出さない（cfgprice）');
await p.evaluate(()=>{ window.__posts=[]; mwPutShow(); });
await p.waitForTimeout(400);
ok((await p.evaluate(()=>window.__posts.length))===0,
   '★★★呼んでも送らない');
ok(/管理者用のキー/.test(await p.evaluate(()=>$('csvMwPutNote').textContent)),
   '★★理由を出す');

await T.done();
})();
