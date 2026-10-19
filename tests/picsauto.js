/* 新しい出品の写真を取り込みのときに自動で切り替える（6.63・B案）
   ・CSV は今までどおり R2 の URL で出品し、取り込みのあとに1回だけ切り替える
   ・対象は「出品から24時間以内」かつ「まだ eBay 保管にしていない」行だけ
   ・1回の取り込みで最大10件。写真の元は出品リストの写真（r.pics）
   ・失敗した行は「対応が必要」に理由を出し、手動でやり直せる
   ・切り替えが終わるまで「写真の切り替え待ち（eBayアプリで写真を触らない）」と出す
   ・作業者のキーでは自動で切り替えない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('新しい出品の写真を自動で eBay 保管にする');
const ok = T.ok;
(async()=>{
const p=await T.open();
const dlg=[]; p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

const setup=async(role)=>await p.evaluate((role)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8';
  $('autoRvMode').value='off'; $('autoMdMode').value='off';
  window.__switch=[]; window.__fail={};
  try{ localStorage.removeItem('pj:picserr:v1'); }catch(e){}
  syncPicsErrs={};
  const hour=3600000;
  const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'77'+asin.slice(-4),ebay_qty:1,ebay_price:30,
    ebay_start:new Date(Date.now()-2*hour).toISOString(),
    title:asin+'の商品',cost_yen:1200,weight_g:150,one_off:0,dropship:0,restocking:0,
    mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,ebay_sale:0,
    md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,revise_err:null,
    pics_eps:0,pics_eps_at:null,pics_n:null,
    amazon_lowest:9000,amazon_offers_json:'[]',sold_usd:null,
    fba_available:1,fba_inbound:0,fba_reserved:0,warnings:[],notes:[],state:'ok'},x||{});
  /* /status は「新しい出品が2件・古い出品が1件・切り替え済みが1件」を返す。 */
  const items=[
    it('B0AUT00001'),                                        // 新しい（2時間前）
    it('B0AUT00002'),                                        // 新しい（2時間前）
    it('B0AUT00003',{ebay_start:new Date(Date.now()-48*hour).toISOString()}), // 古い
    it('B0AUT00004',{pics_eps:1,pics_n:3}),                  // 切り替え済み
    it('B0AUT00005',{ebay_item_id:'',ebay_qty:0})];          // 出品していない
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(o,st)=>Promise.resolve({ok:!st||st<400,status:st||200,
      text:()=>Promise.resolve(JSON.stringify(o)), json:()=>Promise.resolve(o)});
    if(/\/whoami/.test(url))return res({ok:true,role:role||'admin',staff_key_set:true});
    if(/\/status/.test(url))
      return res({counts:{},rows_total:items.length,limit:500,
        items:JSON.parse(JSON.stringify(items)),last_runs:[],sold_recent:[]});
    if(/\/ebay\/pics\/switch/.test(url)){
      window.__switch.push(body);
      const id=(body.item_ids||[])[0];
      if(window.__fail[id])
        return res({ ok:false, n:1, mode:'fresh', done:0, items:[{ok:false,item_id:id,
          done:false, error:'写真が減りました（前 3枚・送った 3枚 → 後 2枚）。'
            +'eBayアプリで写真を確かめてください'}]});
      return res({ ok:true, n:1, mode:'fresh', done:1, items:[{ok:true,item_id:id,
        done:true, fixed_by:'fresh', pics_eps:1, n_before:3, n_after:3,
        before:{n:3,ext_n:1,picture_source:'Vendor',eps_only:false},
        after:{n:3,ext_n:0,picture_source:'EPS',eps_only:true}}]});
    }
    if(/\/listings|\/settings|\/sync/.test(url))return res({accepted:0});
    return real(u,i);
  };
  /* 出品リストには1件だけ写真が残っている（写真の元に使う）。 */
  csvList=[{id:'a1',src:'sedori',sku:'toy-20261019-UG-B0AUT00001-1200',
    asin:'B0AUT00001',jan:'4900001',titleJa:'テスト',titleEn:'Test Item',
    cat:'261068',catFixed:true,condId:3000,cost:1200,qty:1,weight:150,
    itemId:'770001',
    pics:[{url:'https://pj-img.example.workers.dev/i/20261019/'
            +'9113905f-e34f-44b5-9671-54f525b28e49.jpg',key:'k1'},
          {url:'https://pj-img.example.workers.dev/i/20261019/'
            +'0123abcd-4567-89ab-cdef-0123456789ab.jpg',key:'k2'}],
    specs:{},zeroAct:'hold',fba:true,oneOff:false,sold:'',amzLow:'',dropship:false,
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false}];
  csvSaveList(); syncPick={}; syncData=null;
  switchTab('E'); roleCheck(); syncRender();
},role);

console.log('=== 取り込みのあとに自動で切り替える ===');
await setup('admin');
await p.waitForTimeout(300);
await p.click('#syncLoad');
await p.waitForTimeout(900);
let st=await p.evaluate(()=>({sw:window.__switch,
  note:$('syncPicsNote').textContent,
  rows:(syncData.items||[]).map(r=>r.asin+':'+(r.pics_eps||0))}));
console.log('   送った中身: '+JSON.stringify(st.sw));
console.log('   '+st.note+'／'+JSON.stringify(st.rows));
ok(st.sw.length===2,'★★新しい出品（24時間以内・未切り替え）だけ自動で切り替える');
ok(st.sw.every(x=>x.item_ids.length===1&&x.mode==='fresh'&&x.confirm===true),
   '★1件ずつ・預け直し（fresh）で送る');
ok((st.sw[0].urls||[]).length===2
   &&st.sw[0].urls[0].indexOf('9113905f')>=0,
   '★★出品リストに写真が残っている行は、その写真（1枚目がメイン）を元にする');
ok(!st.sw[1].urls,'★★写真が残っていない行は、今の eBay の写真を作り直すだけ');
ok(!st.sw.some(x=>x.item_ids[0]==='770003'),'★★24時間より古い出品は切り替えない');
ok(!st.sw.some(x=>x.item_ids[0]==='770004'),'★★切り替え済みの出品は切り替えない');
ok(/新しい出品の写真を eBay 保管にしました：2件/.test(st.note),'★件数を出す');
ok(st.rows.indexOf('B0AUT00001:1')>=0&&st.rows.indexOf('B0AUT00002:1')>=0,
   '★★切り替えた行に「eBay 保管済み」の印が付く');

console.log('\n=== 切り替え待ちの表示 ===');
const wait=await p.evaluate(()=>{
  const r=(syncData.items||[]).find(x=>x.asin==='B0AUT00003');  // 古い＝未切り替え
  const n=(syncData.items||[]).find(x=>x.asin==='B0AUT00001');  // 切り替え済み
  r.ebay_start=new Date(Date.now()-3600000).toISOString();      // 新しくしてみる
  syncRender();
  const d=document.querySelector('#syncList [data-srow="B0AUT00003|used"]');
  const e=document.querySelector('#syncList [data-srow="B0AUT00001|used"]');
  return { wait:d?d.innerText.replace(/\n/g,' | '):'',
    done:e?e.innerText.replace(/\n/g,' | '):'',
    need:syncPicsNeed(r), fresh:syncPicsNew(r), doneFlag:syncPicsDone(n) };
});
console.log('   '+wait.wait.slice(0,200));
ok(/写真の切り替え待ち/.test(wait.wait),'★★切り替え待ちの行にそう出す');
ok(/eBayアプリで写真を触らないでください/.test(wait.wait),
   '★★「eBayアプリで写真を触らない」と伝える');
ok(/eBay 保管済み/.test(wait.done)&&!/切り替え待ち/.test(wait.done),
   '★切り替え済みの行には出さない');

console.log('\n=== 失敗したら「対応が必要」に理由を出す ===');
await setup('admin');
await p.waitForTimeout(200);
await p.evaluate(()=>{ window.__fail={'770001':1}; });
await p.click('#syncLoad');
await p.waitForTimeout(900);
const bad=await p.evaluate(()=>{
  const r=(syncData.items||[]).find(x=>x.asin==='B0AUT00001');
  syncRender();
  const d=document.querySelector('#syncList [data-srow="B0AUT00001|used"]');
  return { why:syncPicsErrOf(r), eps:Number(r.pics_eps||0),
    warn:syncFilterBy('warn').f(r),
    card:d?d.innerText.replace(/\n/g,' | '):'',
    note:$('syncPicsNote').textContent,
    breakdown:$('syncWarnBreak').textContent,
    saved:localStorage.getItem('pj:picserr:v1')||'' };
});
console.log('   '+JSON.stringify({why:bad.why,eps:bad.eps,warn:bad.warn}));
console.log('   '+bad.card.slice(0,220));
ok(/写真が減りました/.test(bad.why)&&bad.eps===0,
   '★★失敗した行は印を付けず、理由を控える');
ok(bad.warn===true&&/写真の切り替えに失敗/.test(bad.breakdown),
   '★★「対応が必要」に入れて、内訳にも出す');
ok(/写真の切り替えに失敗/.test(bad.card)&&/写真が減りました/.test(bad.card),
   '★★行のカードに理由を出す');
ok(/ItemID を入れてやり直せます/.test(bad.card),'★★手動でやり直せると書く');
ok(/できなかった 1件/.test(bad.note),'★できなかった件数も出す');
ok(/770001/.test(bad.saved)||/B0AUT00001/.test(bad.saved),
   '★理由は端末に残す（開き直しても出る）');

console.log('\n=== 直ったら理由を消す ===');
await p.evaluate(()=>{ window.__fail={}; });
await p.click('#syncLoad');
await p.waitForTimeout(900);
const fixed=await p.evaluate(()=>{
  const r=(syncData.items||[]).find(x=>x.asin==='B0AUT00001');
  syncRender();
  return { why:syncPicsErrOf(r), eps:Number(r.pics_eps||0),
    breakdown:$('syncWarnBreak').textContent };
});
console.log('   '+JSON.stringify(fixed));
ok(fixed.eps===1&&fixed.why==='',
   '★★やり直して直ったら、理由を消して印を付ける');
ok(/写真の切り替えに失敗/.test(fixed.breakdown)===false,
   '★★「対応が必要」の内訳からも消える');

console.log('\n=== 1回の取り込みで最大10件 ===');
const many=await p.evaluate(()=>{
  window.__switch=[];
  const hour=3600000, base=syncData.items[0];
  syncData.items=[];
  for(var i=1;i<=13;i++){
    const a='B0MNY000'+(i<10?('0'+i):i);
    syncData.items.push(Object.assign({},base,{asin:a,ebay_sku:'E-'+a+'-U',
      ebay_item_id:'7710'+(10+i),pics_eps:0,pics_n:null,
      ebay_start:new Date(Date.now()-hour).toISOString()}));
  }
  return syncPicsAutoRows().length;
});
ok(many===10,'★★1回の取り込みで切り替えるのは最大10件');

console.log('\n=== 作業者のキーでは自動で切り替えない ===');
await setup('staff');
await p.waitForTimeout(300);
await p.click('#syncLoad');
await p.waitForTimeout(800);
const staff=await p.evaluate(()=>({sw:window.__switch,body:document.body.className}));
console.log('   '+JSON.stringify(staff));
ok(staff.sw.length===0&&/staff/.test(staff.body),
   '★★作業者のキーのときは1件も送らない');

T.done();
})();
