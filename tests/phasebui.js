/* 販売連携：フェイズBの画面（6.66）
   ・帯に「数量0の予定 n件／再調達の予定 n件」と、在庫0時の動作が未設定の件数
   ・絞り込み「FBAで売れた（対応予定）」
   ・行に予定（数量0／再調達の承認待ち／内訳待ち）を出す
   ・行のボタン「在庫0時：寝かせる／再調達／終了」と「今回は動かさない」
   ・「再調達をまとめて実行」は確認画面つき・目標を送ってから実行・あとで取り込み
   ・作業者のキーでは出さない／オフのときは帯を出さない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('販売連携：フェイズBの画面');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], cancel=false;
p.on('dialog',async d=>{ dlg.push(d.message()); if(cancel)await d.dismiss();
                         else await d.accept(); });

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('autoRvMode').value='off'; $('autoMdMode').value='off';
  $('pbMode').value=o.mode||'plan'; $('pbRestock').value=o.restock||'confirm';
  window.__posts=[]; window.__sync=[]; window.__status=0;
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(o2,st)=>Promise.resolve({ok:!st||st<400,status:st||200,
      text:()=>Promise.resolve(JSON.stringify(o2)), json:()=>Promise.resolve(o2)});
    if(/\/whoami/.test(url))return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/status/.test(url)){ window.__status++;
      return res({counts:{},items:[],last_runs:[],sold_recent:[]}); }
    if(/\/listings/.test(url)){ window.__posts.push(body.items);
      return res({accepted:(body.items||[]).length,rejected:0}); }
    if(/\/sync/.test(url)){ window.__sync.push(body);
      return res({mode:'on',zeroed:2,restocked:1,failed:0}); }
    if(/\/ebay\/pics\/switch/.test(url))return res({ok:true,n:1,items:[]});
    return real(u,i);
  };
  const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'99'+asin.slice(-4),ebay_qty:1,ebay_price:30,
    title:asin+'の商品',cost_yen:1200,weight_g:150,one_off:0,one_off_known:1,
    dropship:0,restocking:0,on_hand:0,mode:'hold',
    fba_available:0,fba_inbound:0,fba_reserved:0,fba_res_cust:null,
    fba_res_trans:null,fba_res_proc:null,fba_seen_at:new Date().toISOString(),
    mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,ebay_sale:0,
    md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,revise_err:null,
    pics_eps:1,pb_act:null,pb_why:null,pb_skip:0,pb_fail:0,pb_want:null,
    amazon_lowest:9000,amazon_offers:3,amazon_offers_json:'[{"p":9000,"c":"used"}]',
    sold_usd:null,warnings:[],notes:[],state:'ok'},x||{});
  syncData={at:new Date().toISOString(),counts:{},items:[
    it('B0PBU00001'),                                   // 寝かせる（数量0の予定）
    it('B0PBU00002',{mode:'restock'}),                  // 再調達の予定
    it('B0PBU00003',{mode:''}),                         // 在庫0時が未設定
    it('B0PBU00004',{fba_available:2}),                 // FBA在庫あり（対象外）
    it('B0PBU00005',{fba_reserved:1})],                 // 内訳不明
    pb_last:{at:'2026-10-19T01:00:00Z',mode:'on',picked:3,zeroed:2,restocked:1,failed:0}};
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E'); roleCheck(); syncRender();
},o||{});

const view=async()=>await p.evaluate(()=>({
  bar:getComputedStyle($('syncPbBar')).display,
  note:$('syncPbNote').innerText, list:$('syncPbList').innerText,
  go:$('syncPbGo').textContent, goDis:$('syncPbGo').disabled,
  zero:syncPbRows('zero').length, restock:syncPbRows('restock').length,
  unknown:syncPbRows('unknown').length, noMode:syncPbNoMode() }));

console.log('=== 帯（予定だけ表示）===');
await setup({mode:'plan'});
await openCsvBoxes(p);
let v=await view();
console.log('   '+v.note.replace(/\n/g,' / '));
console.log('   '+v.list.replace(/\n/g,' / '));
ok(v.bar!=='none','★フェイズBの帯を出す');
ok(v.zero===2&&v.restock===1&&v.unknown===1,
   '★★数量0・再調達・内訳不明を分けて数える（未設定は寝かせる扱い）');
ok(/数量0の予定 2件／再調達の予定 1件/.test(v.note),'★★件数を出す');
ok(/eBay はまだ変えません/.test(v.note),'★予定だけのときはそう書く');
ok(/在庫0時の動作が未設定：1件/.test(v.note),'★★未設定の件数も出す');
ok(/前回/.test(v.note)&&/数量0 2件/.test(v.note),'★前回の結果を出す');
ok(/B0PBU00002の商品/.test(v.list),'★予定の中身を出す');

console.log('\n=== 絞り込みと行の表示 ===');
const rows=await p.evaluate(()=>{
  $('syncFilter').value='pbplan'; syncPage=1; syncRender();
  const n=document.querySelectorAll('#syncList .lcard').length;
  const txt=(a)=>{ const d=document.querySelector('#syncList [data-srow="'+a+'|used"]');
    return d?d.innerText.replace(/\n/g,' | '):''; };
  return { n:n, zero:txt('B0PBU00001'), restock:txt('B0PBU00002'),
    unknown:txt('B0PBU00005'),
    opt:Array.from($('syncFilter').options).map(o=>o.textContent).join('／') };
});
console.log('   対象 '+rows.n+'件');
console.log('   数量0: '+rows.zero.slice(0,150));
console.log('   再調達: '+rows.restock.slice(0,170));
ok(rows.n===4,'★★「FBAで売れた（対応予定）」で4件（対象外の行は出ない）');
ok(/FBAで売れた（対応予定）/.test(rows.opt),'★絞り込みに名前を出す');
ok(/数量0の予定/.test(rows.zero)&&/寝かせる/.test(rows.zero),
   '★★数量0の予定と理由を行に出す');
ok(/再調達の承認待ち/.test(rows.restock)&&/→/.test(rows.restock),
   '★★再調達の行は承認待ちと新しい売値を出す');
ok(/内訳待ち/.test(rows.unknown),'★★内訳不明の行はそう出す');
await p.evaluate(()=>{ $('syncFilter').value='all'; syncRender(); });

console.log('\n=== 在庫0時の動作ボタン ===');
const z0=await p.evaluate(()=>{
  const d=document.querySelector('#syncList [data-srow="B0PBU00003|used"]');
  const b=d.querySelector('[data-szero]');
  return { label:b?b.textContent:'', has:!!b };
});
console.log('   '+JSON.stringify(z0));
ok(z0.has&&/未設定/.test(z0.label),'★★未設定の行は「在庫0時：未設定」と出す');
await p.click('#syncList [data-srow="B0PBU00003|used"] [data-szero]');
await p.waitForTimeout(400);
let st=await p.evaluate(()=>({posts:window.__posts,
  mode:(syncData.items.find(x=>x.asin==='B0PBU00003')||{}).mode,
  note:$('syncFixNote').textContent}));
console.log('   '+JSON.stringify(st));
ok((st.posts[0]||[])[0].mode==='hold'&&st.mode==='hold',
   '★★押すと「寝かせる」を pj-sync に送る');
ok(/寝かせる/.test(st.note),'★結果を知らせる');
await p.click('#syncList [data-srow="B0PBU00003|used"] [data-szero]');
await p.waitForTimeout(400);
st=await p.evaluate(()=>({mode:(syncData.items.find(x=>x.asin==='B0PBU00003')||{}).mode,
  act:(syncPbActOf(syncData.items.find(x=>x.asin==='B0PBU00003'))||{}).kind}));
console.log('   '+JSON.stringify(st));
ok(st.mode==='restock'&&st.act==='restock',
   '★★もう一度押すと「再調達」になり、予定も変わる');
const one=await p.evaluate(()=>{
  const r=syncData.items.find(x=>x.asin==='B0PBU00001');
  r.one_off=1; r.mode='hold'; syncRender();   // 次に押すと「再調達」になる並び
  window.__posts=[];
  document.querySelector('#syncList [data-srow="B0PBU00001|used"] [data-szero]').click();
  return 1;
});
await p.waitForTimeout(300);
st=await p.evaluate(()=>({posts:window.__posts,dlg:1}));
ok(st.posts.length===0&&/一点物の行は再調達にできません/.test(dlg.join('\n')),
   '★★一点物の行は再調達にしない');

console.log('\n=== 今回は動かさない ===');
await setup({mode:'plan'});
await p.waitForTimeout(200);
await p.click('#syncList [data-srow="B0PBU00001|used"] [data-spbskip]');
await p.waitForTimeout(400);
st=await p.evaluate(()=>({posts:window.__posts,
  skip:(syncData.items.find(x=>x.asin==='B0PBU00001')||{}).pb_skip,
  act:!!syncPbActOf(syncData.items.find(x=>x.asin==='B0PBU00001')),
  zero:syncPbRows('zero').length}));
console.log('   '+JSON.stringify(st));
ok((st.posts[0]||[])[0].pb_skip===true&&Number(st.skip)===1,
   '★★「今回は動かさない」を pj-sync に送る');
ok(st.act===false&&st.zero===1,'★★その行は予定から外れる');

console.log('\n=== 再調達をまとめて実行（確認モード）===');
await setup({mode:'on',restock:'confirm'});
await p.waitForTimeout(200);
v=await view();
console.log('   '+v.go+'　押せる: '+(!v.goDis));
ok(/再調達をまとめて実行（1件）/.test(v.go)&&!v.goDis,'★予定の件数を出して押せる');
dlg=[];
await p.click('#syncPbGo');
await p.waitForTimeout(800);
st=await p.evaluate(()=>({posts:window.__posts,sync:window.__sync,
  status:window.__status,done:$('syncPbDone').textContent}));
console.log('   確認: '+(dlg[0]||'').replace(/\n/g,' / '));
console.log('   送った中身: '+JSON.stringify(st.sync)+'／'+st.done);
ok(/再調達の予定 1件を実行します/.test(dlg[0]||''),'★★件数を出して確認する');
ok(/数量を1に戻します/.test(dlg[0]||''),'★何をするかを書く');
ok((st.posts[0]||[])[0].pb_want>0,
   '★★先に目標の売値（pb_want）を送ってから実行する');
ok(st.sync.length===1&&st.sync[0].kind==='phaseb'&&st.sync[0].approve===true,
   '★★pj-sync に「承認して実行」を送る');
ok(/数量0 2件／再調達 1件／失敗 0件/.test(st.done),'★結果を出す');
ok(st.status===1&&/最新の状況に更新しました/.test(st.done),
   '★★実行のあとは自動で状況を取り込む');

console.log('\n=== 自動実行のときは承認ボタンを出さない ===');
await setup({mode:'on',restock:'auto'});
await p.waitForTimeout(200);
const auto=await p.evaluate(()=>({
  go:getComputedStyle($('syncPbGo')).display, note:$('syncPbNote').innerText}));
console.log('   '+JSON.stringify(auto));
ok(auto.go==='none'&&/自動実行/.test(auto.note),
   '★★自動実行のときはボタンを出さず、そう書く');

console.log('\n=== オフ・作業者のキー ===');
await setup({mode:'off'});
await p.waitForTimeout(200);
ok((await view()).bar==='none','★★オフのときは帯を出さない');
await setup({mode:'plan',role:'staff'});
await p.waitForTimeout(300);
const staff=await p.evaluate(()=>{
  const v2=(sel)=>{ const el=document.querySelector(sel);
    return el?el.getClientRects().length>0:null; };
  return { bar:v2('#syncPbBar'), zero:v2('#syncList [data-szero]'),
    skip:v2('#syncList [data-spbskip]'), body:document.body.className };
});
console.log('   '+JSON.stringify(staff));
ok(staff.bar===false&&staff.zero===false&&staff.skip===false,
   '★★作業者のキーではフェイズBの帯もボタンも出さない');

T.done();
})();
