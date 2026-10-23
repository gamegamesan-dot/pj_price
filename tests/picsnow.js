/* 出品した直後に写真を切り替える・切り替え待ちを赤で出す（6.79／Worker は 7.57）
   ・「アップロード結果を取り込む」で ItemID が分かった時点で、その場で切り替える
     （「状況を取り込む」を待たない。待つあいだに eBayアプリで編集されると
      メイン画像が抜ける。2026-10-22 に再発）
   ・行ごとに違う写真を渡すので items:[{item_id,urls}] で1回にまとめて送る
   ・notify:true・fresh:true を付けて Discord にも注意を出してもらう
   ・切り替えが済むまで、出品CSVと販売連携の行に赤で
     「写真の切り替え待ち：eBayアプリで編集しないでください」を出す
   ・eBay の写真が出品リストより少ない行に「写真が抜けています」を出し、
     「対応が必要」に含める */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('出品した直後の写真の切り替え');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const PIC=(n)=>'https://pj-img.example.workers.dev/i/20261022/'
  +'9113905f-e34f-44b5-9671-54f525b28e'+String(40+n)+'.jpg';
const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('autoAdRate').value='6';
  $('autoRvMode').value='off'; $('autoMdMode').value='off'; $('pbMode').value='off';
  $('autoRkMode').value='off';
  window.__switch=[]; window.__fail=o.fail||{}; window.__status=0;
  try{ localStorage.removeItem('pj:picserr:v1'); }catch(e){}
  syncPicsErrs={};
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(x,st)=>Promise.resolve({ok:!st||st<400,status:st||200,
      text:()=>Promise.resolve(JSON.stringify(x)), json:()=>Promise.resolve(x)});
    if(/\/whoami/.test(url))return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/status/.test(url)){ window.__status++;
      return res({counts:{},items:JSON.parse(JSON.stringify(o.items||[])),
                  last_runs:[],sold_recent:[]}); }
    if(/\/ebay\/pics\/switch/.test(url)){
      window.__switch.push(body);
      const list=(body.items||[]).map(function(x){
        const id=String(x.item_id);
        if(window.__fail[id])
          return { ok:false, item_id:id, done:false, title:'T-'+id,
                   error:'写真が減りました（前 3枚・送った 3枚 → 後 2枚）' };
        return { ok:true, item_id:id, done:true, title:'T-'+id, fixed_by:'fresh',
                 n_before:2, n_after:2,
                 before:{n:2,ext_n:1,picture_source:'Vendor',eps_only:false},
                 after:{n:2,ext_n:0,picture_source:'EPS',eps_only:true} };
      });
      return res({ ok:list.every(function(x){ return x.ok; }), n:list.length,
                   mode:'fresh', done:list.filter(function(x){ return x.done; }).length,
                   items:list });
    }
    if(/\/listings|\/settings|\/sync/.test(url))return res({accepted:1,rejected:0});
    return real(u,i);
  };
  /* 出品リスト：書き出し済みで、まだ ItemID が入っていない2件。 */
  const row=(id,asin,sku)=>({id:id,src:'sedori',sku:sku,asin:asin,jan:'4900001',
    titleJa:'テスト'+asin,titleEn:'Test '+asin,cat:'261068',catFixed:true,
    condId:3000,cost:1200,qty:1,weight:150,itemId:'',uploadErr:'',sold:'',
    picsEps:0,picsErr:'',
    pics:[{url:o.pic[0],key:'k1'},{url:o.pic[1],key:'k2'}],
    specs:{origin:'Japan'},zeroAct:'hold',fba:true,oneOff:false,amzLow:'',
    dropship:false,titleStatus:'',titleCands:[],titleNote:'',titleManual:false});
  csvList=[row('a1','B0NOW00001','toy-20261022-UG-B0NOW00001-1200'),
           row('a2','B0NOW00002','toy-20261022-UG-B0NOW00002-1200')];
  if(o.noPics)csvList[1].pics=[];
  csvSaveList(); csvPick={};
  syncData=o.items?{at:new Date().toISOString(),counts:{},items:o.items,
                    last_runs:[],sold:[]}:null;
  switchTab('C'); roleCheck(); csvRender();
},Object.assign({pic:[PIC(1),PIC(2)]},o||{}));

const RES=[
 'Action(SiteID=US|Country=JP|Currency=USD|Version=1193),ItemID,CustomLabel,Status,Error Message',
 'Add,880000000001,E-B0NOW00001-U,Success,',
 'Add,880000000002,E-B0NOW00002-U,Success,'].join('\n');
const feed=async(text)=>await p.evaluate((t)=>{
  const r=csvResImport(t);
  window.__res=r;
  return { ok:r.ok, fresh:(r.fresh||[]).map(function(x){ return x.id; }) };
},text||RES);

console.log('=== 取り込んだ時点で ItemID が分かる ===');
await setup({});
let f=await feed();
console.log('   '+JSON.stringify(f));
ok(f.ok===2,'★結果ファイルを読めた');
ok(f.fresh.join(',')==='880000000001,880000000002',
   '★★この取り込みで ItemID が入った行を覚える');

console.log('\n=== その場で切り替える（状況を取り込むを待たない）===');
await setup({});
await openCsvBoxes(p);
await p.evaluate((t)=>{
  const r=csvResImport(t);
  csvRender();
  csvResPicsRun(r.fresh||[],$('csvResResult'));
},RES);
await p.waitForTimeout(600);
let st=await p.evaluate(()=>({sw:window.__switch,status:window.__status,
  box:$('csvResResult').textContent,
  rows:(csvList||[]).map(function(r){
    return r.asin+':'+(r.picsEps||0)+':'+(r.picsErr?'ng':''); })}));
console.log('   送った中身: '+JSON.stringify(st.sw));
console.log('   '+st.box.replace(/\n/g,' / ')+'／'+JSON.stringify(st.rows));
ok(st.sw.length===1,'★★1回の呼び出しでまとめて送る（Discord も1通）');
ok((st.sw[0].items||[]).length===2,'★★items で2件');
ok(st.sw[0].items[0].item_id==='880000000001'
   &&(st.sw[0].items[0].urls||[]).length===2,
   '★★行ごとに出品リストの写真（pj-img）を渡す');
ok(st.sw[0].items[1].item_id==='880000000002','★★2件目は別の ItemID');
ok(st.sw[0].notify===true&&st.sw[0].fresh===true,
   '★★Discord に「出品しました」と注意を出してもらう');
ok(st.sw[0].confirm===true,'★2件以上なので confirm を付ける');
ok(st.status===0,'★★「状況を取り込む」は呼ばない（待たない）');
ok(st.rows.join(' ')==='B0NOW00001:1: B0NOW00002:1:','★★通った行に印を付ける');
ok(/できた 2件/.test(st.box),'★結果を出す');
ok(/eBayアプリで編集しても大丈夫/.test(st.box),'★★終わったことが分かる');

console.log('\n=== 失敗した行は赤で残る ===');
await setup({fail:{'880000000002':1}});
await openCsvBoxes(p);
await p.evaluate((t)=>{
  const r=csvResImport(t); csvRender();
  csvResPicsRun(r.fresh||[],$('csvResResult'));
},RES);
await p.waitForTimeout(600);
let ng=await p.evaluate(()=>{
  const el=document.querySelector('#csvList [data-row="a2"]');
  return { box:$('csvResResult').textContent,
    err:(csvList[1]||{}).picsErr||'',
    txt:el?el.innerText.replace(/\n/g,' | '):'',
    wait:csvPicsWait(csvList[1]), done:csvPicsDone(csvList[0]) };
});
console.log('   '+ng.txt.slice(0,220));
ok(/できなかった 1件/.test(ng.box),'★件数を出す');
ok(/写真が減りました/.test(ng.err),'★★理由を行に残す');
ok(/写真の切り替え待ち：eBayアプリで編集しないでください/.test(ng.txt),
   '★★失敗した行は赤で「切り替え待ち」のまま');
ok(ng.wait===true&&ng.done===true,'★★通った行だけ待ちが消える');

console.log('\n=== 出品CSVの行：切り替え待ちの赤表示 ===');
await setup({});
await openCsvBoxes(p);
let w=await p.evaluate(()=>{
  csvList[0].itemId='880000000001'; csvList[0].picsEps=0;
  csvList[1].itemId='880000000002'; csvList[1].picsEps=1;
  csvSaveList(); csvRender();
  const a=document.querySelector('#csvList [data-row="a1"]');
  const b=document.querySelector('#csvList [data-row="a2"]');
  return { a:a?a.innerText.replace(/\n/g,' | '):'', b:b?b.innerText.replace(/\n/g,' | '):'',
    notes:csvNotes(csvList[0]).join('／') };
});
console.log('   '+w.a.slice(0,200));
ok(/写真の切り替え待ち：eBayアプリで編集しないでください/.test(w.a),
   '★★切り替えていない行に赤で出す');
ok(/メイン画像が抜けます/.test(w.a),'★★編集すると何が起きるかを書く');
ok(!/写真の切り替え待ち/.test(w.b),'★★切り替えた行には出さない');
ok(/写真の切り替え待ち/.test(w.notes),'★一覧の注意にも出る');

console.log('\n=== 写真が抜けています（eBay の枚数 < 出品リストの枚数）===');
const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
  ebay_sku:'E-'+asin+'-U',ebay_item_id:'88000000000'+asin.slice(-1),ebay_qty:1,
  ebay_price:30,ebay_start:new Date(Date.now()-3600000).toISOString(),
  title:asin+'の商品',cost_yen:1200,weight_g:150,one_off:0,one_off_known:1,
  dropship:0,restocking:0,on_hand:0,hand_qty:null,mark_at:null,mark_stop:0,
  ebay_first:0,ebay_bo:0,ebay_sale:0,md_step:null,md_start:null,md_floor:null,
  md_n:null,md_done:0,rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,
  rv_fail:0,revise_err:null,rk_want:null,rk_fail:0,pb_act:null,pb_skip:0,
  sold_keep:0,sold_price:null,sk_act:null,sk_fail:0,
  pics_eps:1,pics_eps_at:'2026-10-22T04:00:00Z',pics_n:2,
  /* Amazon の警告（「Amazonの方が得」）が出ると、写真とは関係なく
     「対応が必要」に入ってしまう。ここでは写真の抜けだけを見たいので外す。 */
  amazon_lowest:0,amazon_offers:0,amazon_offers_json:'[]',
  amazon_lowest_at:new Date().toISOString(),sold_usd:null,
  fba_available:1,fba_inbound:0,fba_reserved:0,warnings:[],notes:[],
  state:'ok'},x||{});
await setup({items:[ it('B0NOW00001',{pics_n:1}),     // 1枚に減った → 抜け
                     it('B0NOW00002',{pics_n:2}) ]}); // 2枚のまま
await p.evaluate(()=>{
  csvList[0].itemId='880000000001'; csvList[0].picsEps=1;
  csvList[1].itemId='880000000002'; csvList[1].picsEps=1;
  csvSaveList(); switchTab('E'); syncRender();
});
await openCsvBoxes(p);
let g=await p.evaluate(()=>{
  const a=document.querySelector('#syncList [data-srow="B0NOW00001|used"]');
  const b=document.querySelector('#syncList [data-srow="B0NOW00002|used"]');
  return { a:a?a.innerText.replace(/\n/g,' | '):'',
    b:b?b.innerText.replace(/\n/g,' | '):'',
    gone:!!syncPicsGoneOf(syncRowBy('B0NOW00001|used')),
    ok2:!!syncPicsGoneOf(syncRowBy('B0NOW00002|used')) };
});
console.log('   '+g.a.slice(0,240));
ok(g.gone===true&&g.ok2===false,
   '★★eBay の枚数が出品リストより少ない行だけ');
ok(/写真が抜けています/.test(g.a),'★★バッジを出す');
ok(/eBay 1枚／出品リスト 2枚/.test(g.a),'★★両方の枚数を出す');
ok(/2026-10-22 04:00に確認/.test(g.a),'★いつ確かめた枚数かを出す');
ok(/出品リストの 2枚に戻します/.test(g.a),'★★戻し方を書く');
ok(!/写真が抜けています/.test(g.b),'★減っていない行には出さない');

console.log('\n=== 「対応が必要」に含める ===');
let warn=await p.evaluate(()=>{
  $('syncFilter').value='warn'; syncRender();
  return Array.from(document.querySelectorAll('#syncList [data-srow]'))
    .map(function(e){ return e.getAttribute('data-srow'); });
});
console.log('   '+JSON.stringify(warn));
ok(warn.indexOf('B0NOW00001|used')>=0,'★★写真が抜けている行が入る');
ok(warn.indexOf('B0NOW00002|used')<0,'★減っていない行は入らない');

console.log('\n=== 出品CSVタブにも出す ===');
let cg=await p.evaluate(()=>{
  switchTab('C'); csvRender();
  const a=document.querySelector('#csvList [data-row="a1"]');
  return { txt:a?a.innerText.replace(/\n/g,' | '):'',
    gone:!!csvPicsGone(csvList[0]), notes:csvNotes(csvList[0]).join('／') };
});
console.log('   '+cg.txt.slice(0,200));
ok(cg.gone===true,'★★出品CSVの行でも判定できる');
ok(/写真が抜けています（eBay 1枚／この行 2枚）/.test(cg.txt),'★★行に出す');
ok(/写真が抜けています/.test(cg.notes),'★一覧の注意にも出る');

console.log('\n=== 写真が残っていない行は送らない ===');
await setup({noPics:true});
await openCsvBoxes(p);
await p.evaluate((t)=>{
  const r=csvResImport(t); csvRender();
  csvResPicsRun(r.fresh||[],$('csvResResult'));
},RES);
await p.waitForTimeout(500);
let np=await p.evaluate(()=>({sw:window.__switch,
  n:(window.__switch[0]&&window.__switch[0].items||[]).length}));
console.log('   '+JSON.stringify(np.sw));
ok(np.n===1,'★★写真が残っている行だけ送る');

console.log('\n=== 作業者のキーでは切り替えない ===');
await setup({role:'staff'});
await openCsvBoxes(p);
await p.evaluate((t)=>{
  const r=csvResImport(t); csvRender();
  csvResPicsRun(r.fresh||[],$('csvResResult'));
},RES);
await p.waitForTimeout(400);
let stf=await p.evaluate(()=>({sw:window.__switch.length,
  box:$('csvResResult').textContent}));
console.log('   '+stf.box.replace(/\n/g,' / ').slice(0,160));
ok(stf.sw===0,'★★送らない');
ok(/管理者用のキー/.test(stf.box),'★理由を出す');

await T.done();
})();
