/* 画面：JAN重複の選択・手数料の内訳・JANコピー（6.108〜6.110）
   ・JAN重複（要確認）の印。候補を MW の商品名に近い順に並べ、選べる
   ・決まるまで「仕入れる」と「Amazon登録用ファイル」の対象外
   ・手数料は Amazon から取れた商品ごとの値を使い、消費税も足す。
     取れていない行は一律の値で出し「仮の手数料」と表示
   ・仕入れる行の JAN を改行区切りでコピー */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：JAN重複と手数料');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const base={ sha:'M200', kishu:'NS', cond:'新品', stock:9, note:'',
  ship_text:'即日出荷', ship_days:0, basis:'カート', new_n:4, amz:0,
  rank:100, rank_cat:'ゲーム', list_price:9800, gone_at:null, qty:1,
  rst:'ok', rst_why:'', rst_link:'', rst_at:'2026-10-29T01:00:00Z',
  cand_n:1, cands:null, jan_picked_at:null,
  fee_ref:null, fee_fba:null, fee_tax:null, fee_total:null, fee_base:null,
  fee_at:null, fee_err:null };
/* サイヴァリア3：せどりすと の内訳と同じ手数料が入っている行 */
const SAI=Object.assign({},base,{ jan:'4944076005667', kishu:'PS5',
  mw_name:'サイヴァリア3 限定版', amz_name:'サイヴァリア3 限定版 PS5',
  wholesale:4500, asin:'B0SAIVA001', price:9638,
  fee_ref:1484, fee_fba:441, fee_tax:148, fee_total:2073, fee_base:9638,
  fee_at:'2026-10-29T01:00:00Z' });
/* 手数料が取れていない行（仮の手数料） */
const TMP=Object.assign({},base,{ jan:'4902370550467',
  mw_name:'手数料が取れていない商品', amz_name:'手数料が取れていない商品',
  wholesale:3000, asin:'B0TMPFEE01', price:9000 });
/* JAN重複の行 */
const DUP=Object.assign({},base,{ jan:'4573102666987', kishu:'FIG',
  mw_name:'ウルトラマン ソフビ ティガ', amz_name:'', wholesale:3000,
  asin:'', price:9500, cand_n:2, jan_picked_at:null,
  cands:JSON.stringify([
    { asin:'B00STARW01', name:'スター・ウォーズ ブラックシリーズ' },
    { asin:'B00ULTRA01', name:'ウルトラマン ソフビ ティガ 新品' }]) });

const META={ ok:true, n:3, rows:[SAI,TMP,DUP], seen:3, priced:3, left:0,
  per_run:120, ttl_days:3, limit:3000 };

const setup=async()=>await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='5';
  $('mwKishu').value='NS,PS5,FIG'; $('mwNewOnly').checked=true;
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  $('mwAmzFeeHobby').value='10'; $('mwAmzFbaHobby').value='580';
  window.__posts=[]; window.__copied=null;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/mw\/jan-pick/.test(url)){
      window.__posts.push({url:url,body:b});
      return new Response(JSON.stringify({ok:true,jan:b.jan,asin:b.asin}),{status:200});
    }
    if(/\/mw\/buy/.test(url)){
      if(i&&i.method==='POST')return new Response(JSON.stringify({ok:true}),{status:200});
      return new Response(JSON.stringify({ok:true,n:2,qty:3,yen:9900,gone:0,
        rows:[{jan:'4944076005667',qty:2,sha:'M200',mw_name:'サイヴァリア3',
               wholesale:4500,asin:'B0SAIVA001',price:9638,rst:'ok',cand_n:1},
              {jan:'4902370550467',qty:1,sha:'M200',mw_name:'もう1件',
               wholesale:3000,asin:'B0TMPFEE01',price:9000,rst:'ok',cand_n:1}]}),
        {status:200});
    }
    if(/\/mw\/amz/.test(url))
      return new Response(JSON.stringify(META),{status:200});
    return real(u,i);
  };
  Object.defineProperty(navigator,'clipboard',{configurable:true,
    value:{ writeText:function(t){ window.__copied=t; return Promise.resolve(); } }});
  switchTab('D'); roleApply(); csvRender();
},META);

console.log('=== 手数料の内訳（6.108）===');
await setup();
await openCsvBoxes(p);
let c=await p.evaluate((R)=>{ mwAmzRows=R; mwAmzMeta={n:3,seen:3,priced:3,left:0};
  mwBuyMap={}; mwAmzRender();
  const f=(jan)=>{
    const r=R.filter((x)=>x.jan===jan)[0];
    const z=mwAmzCalc(r);
    return { fee:z.fee, ref:z.feeRef, tax:z.feeTax, fba:z.fba, real:z.feeReal,
             cost:z.cost, profit:z.profit, net:z.net };
  };
  return { sai:f('4944076005667'), tmp:f('4902370550467') };
},[SAI,TMP,DUP]);
console.log('   サイヴァリア3: '+JSON.stringify(c.sai));
ok(c.sai.ref===1484,'★★★販売手数料は Amazon の値（1,484円）');
ok(c.sai.tax===148,'★★★手数料の消費税も入れる（148円）');
ok(c.sai.fba===441,'★★★FBA手数料も Amazon の値（441円）');
ok(c.sai.fee===2073,'★★★手数料の合計 2,073円（せどりすと と同じ）');
ok(c.sai.real===true,'★★取れた手数料だと分かる');
ok(c.sai.cost===5126,'★仕入は 卸値×1.1＋仕入送料（4,950＋176）');
ok(c.sai.profit===9638-2073-5126,'★★★粗利＝売値−手数料−仕入');
console.log('   仮の手数料: '+JSON.stringify(c.tmp));
ok(c.tmp.real===false,'★★★取れていない行は「仮」');
ok(c.tmp.ref===Math.round(9000*0.15)&&c.tmp.fba===530&&c.tmp.tax===0,
   '★★取れていない行は⚙設定の一律の値');

console.log('\n=== 画面の表示 ===');
const card=async(jan)=>await p.evaluate((jan)=>{
  const box=document.getElementById('mwBuyChk_'+jan);
  const el=box?box.closest('div[style*="border"]'):null;
  return el?el.outerHTML:'';
},jan);
let sc=await card('4944076005667');
ok(/販売手数料/.test(sc)&&/1,484/.test(sc),'★★★行に販売手数料を出す');
ok(/手数料消費税/.test(sc)&&/148/.test(sc),'★★★手数料消費税も出す');
ok(/FBA手数料/.test(sc)&&/441/.test(sc),'★★FBA手数料も出す');
ok(/仮の手数料/.test(sc)===false,'★取れた行に「仮」とは出さない');
let tc=await card('4902370550467');
ok(/仮の手数料/.test(tc),'★★★取れていない行に「仮の手数料」と出す');

console.log('\n=== JAN重複（6.109）===');
let dc=await card('4573102666987');
ok(/JAN重複（要確認）/.test(dc),'★★★印を出す');
ok(/Amazon の商品が 2件/.test(dc),'★★候補の件数を出す');
ok(/B00ULTRA01/.test(dc)&&/B00STARW01/.test(dc),'★★★候補の ASIN を並べる');
/* MW の商品名「ウルトラマン ソフビ ティガ」に近い順 */
let order=await p.evaluate((R)=>{
  const r=R.filter((x)=>x.jan==='4573102666987')[0];
  return mwCandSort(r).map((x)=>x.asin);
},[SAI,TMP,DUP]);
console.log('   近い順: '+JSON.stringify(order));
ok(order[0]==='B00ULTRA01','★★★MW の商品名に近い順に並べる');
ok(/名前の近さ/.test(dc),'★近さも出す');
ok(/これにする/.test(dc),'★★選ぶボタンを出す');
let dis=await p.evaluate(()=>({
  dup:$('mwBuyChk_4573102666987').disabled,
  ok2:$('mwBuyChk_4944076005667').disabled }));
console.log('   '+JSON.stringify(dis));
ok(dis.dup===true,'★★★決まるまで「仕入れる」を付けられない');
ok(dis.ok2===false,'★ふつうの行は付けられる');
ok(/JANの重複を決めてから/.test(dc),'★★理由も書く');
/* 保存側でも止める */
await p.evaluate(()=>{ window.__posts=[]; mwBuySet('4573102666987',2); });
await p.waitForTimeout(300);
ok((await p.evaluate(()=>window.__posts.filter((x)=>/\/mw\/buy/.test(x.url)).length))===0,
   '★★★重複の行は保存もしない');
ok(/複数あります/.test(await p.evaluate(()=>$('csvMwAmzListNote').textContent)),
   '★★理由を画面に出す');
/* 選ぶと /mw/jan-pick を呼ぶ */
await p.evaluate(()=>{ window.__posts=[];
  mwJanPickGo('4573102666987','B00ULTRA01'); });
await p.waitForTimeout(400);
let pp=await p.evaluate(()=>window.__posts.filter((x)=>/jan-pick/.test(x.url))[0]);
console.log('   送った: '+JSON.stringify(pp&&pp.body));
ok(pp&&pp.body.jan==='4573102666987'&&pp.body.asin==='B00ULTRA01',
   '★★★選ぶと JAN と ASIN を送る');
ok(/決めました/.test(await p.evaluate(()=>$('csvMwDupNote').textContent)),
   '★★決めたことを出す（一覧の取り込みで消えない場所に）');

console.log('\n=== 登録ファイルの対象外（6.109）===');
let pk=await p.evaluate((R)=>{
  const z=mwRegPick(R);
  return { take:z.take.map((r)=>r.jan), skip:z.skip.map((x)=>[x.r.jan,x.why]) };
},[SAI,TMP,DUP]);
console.log('   '+JSON.stringify(pk));
ok(pk.take.indexOf('4573102666987')<0,'★★★重複の行は登録ファイルに入れない');
ok(/JAN重複/.test((pk.skip.filter((x)=>x[0]==='4573102666987')[0]||[])[1]||''),
   '★★★理由を出す');

console.log('\n=== 仕入れる行の JAN をコピー（6.110）===');
ok(await p.evaluate(()=>typeof $('csvMwJanCopy').onclick==='function'),
   '★★ボタンが結ばれている');
await p.evaluate(()=>{ $('csvMwJanCopy').click(); });
await p.waitForTimeout(500);
let cp=await p.evaluate(()=>window.__copied);
console.log('   '+JSON.stringify(cp));
ok(cp==='4944076005667\n4902370550467','★★★改行区切りで JAN だけをコピーする');
let cn=await p.evaluate(()=>$('csvMwJanNote').textContent);
console.log('   '+cn);
ok(/2件/.test(cn)&&/コピーしました/.test(cn),'★★★コピーしたと短く出す');
await p.waitForTimeout(2600);
ok((await p.evaluate(()=>$('csvMwJanNote').textContent))==='',
   '★★少し待つと消える');

console.log('\n=== ⚙設定（自動の取り直し）===');
let cfg=await p.evaluate(()=>({
  has:!!$('mwAutoMode'), v:$('mwAutoMode').value,
  opts:Array.prototype.map.call($('mwAutoMode').options,(o)=>o.value).join(',') }));
console.log('   '+JSON.stringify(cfg));
ok(cfg.has===true,'★設定がある');
ok(cfg.v==='off','★★★既定はオフ');
ok(cfg.opts==='off,on','★オフとオンの2つ');
/* 「MW の在庫CSVを自動で取り込む」と読み違えやすいので、名前と説明で分ける。 */
let lab=await p.evaluate(()=>{
  const row=$('mwAutoMode').closest('.rowv');
  return { label:row.querySelector('label').textContent,
           note:row.querySelector('.note2').textContent };
});
console.log('   '+lab.label);
ok(/MW候補の Amazon 価格/.test(lab.label),
   '★★★名前は「MW候補の Amazon 価格（手数料・可否）」');
ok(/手数料/.test(lab.label)&&/可否/.test(lab.label),'★★何を取り直すか名前に入れる');
ok(/在庫CSV/.test(lab.label)===false,'★★名前に「在庫CSV」を入れない');
ok(/MW の在庫CSVの取り込みは手動のままです/.test(lab.note),
   '★★★説明に「在庫CSVの取り込みは手動のまま」と書く');

await T.done();
})();
