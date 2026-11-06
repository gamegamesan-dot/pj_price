/* 画面：仕入れる印が、一覧に出ていない行でも外れて見えないこと（6.144）
   東方少女綺想譚（JAN 4573419410549）の印が、午後は作業者の画面で付いていたのに
   夜の管理者の画面では外れて見えた。
   原因は「印の控え（mwBuyMap）を**その回の一覧に出ている行から作り直していた**」こと。
   ランキングの基準などで一覧に出ていない行の印は、その端末では消えて見えた。
   ・印の正は D1（mw_buy）。/mw/buy を読んだあとに**もう一度作り直す**
   ・合計の帯に「うち n件はこの一覧に出ていません」と出す
   ・一覧に出ている行の印は今までどおり付いて見える */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：仕入れる印は消えない');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

const HID='4573419410549';   // 一覧に出ていない行（印あり）
const SHOWN='4902370550001'; // 一覧に出ている行（印あり）
const setup=async()=>await p.evaluate((o)=>{
  $('syncApi').value='https://s.example'; $('syncKey').value='k';
  $('mwShipFee').value='176';
  const amzRow=(jan,buy)=>({ jan:jan, asin:'B0'+jan.slice(0,8), name:'品 '+jan,
    kishu:'Switch', cond:'新品', stock:5, ship_days:1, wholesale:1000,
    list_price:3000, price:3000, rank:1000, rank_cat:'ゲーム',
    fee_total:400, fee_ref:300, fee_fba:100, fee_tax:0, fee_base:3000,
    rst_ok:1, rst:'ok', buy_qty:buy, note:'' });
  const buyRow=(jan,qty)=>({ jan:jan, qty:qty, at:'2026-11-06T05:00:00Z',
    gone:0, sha:'M200', kishu:'Switch', cond:'新品', mw_name:'品 '+jan,
    wholesale:1000, stock:5, ship_days:1, asin:'B0'+jan.slice(0,8),
    price:3000, rst:'ok', pics:0, reg_state:'', cand_n:1 });
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u);
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:'admin'}),{status:200});
    if(/\/mw\/amz/.test(url)){
      /* 一覧には SHOWN だけ出る（HID はランキングの基準などで出ない）。 */
      return new Response(JSON.stringify({ok:true,
        rows:[amzRow(o.shown,1)], n:1237, seen:1237, priced:1237,
        per_run:120 }),{status:200});
    }
    if(/\/mw\/buy/.test(url)){
      if((i||{}).method==='POST')
        return new Response(JSON.stringify({ok:true,n:1,rows:[]}),{status:200});
      /* D1 には両方の印がある。 */
      return new Response(JSON.stringify({ok:true,
        rows:[buyRow(o.hid,2),buyRow(o.shown,1)], n:2, qty:3, yen:0,
        gone:0, live:2, reg:0 }),{status:200});
    }
    return real(u,i);
  };
  syncRole='admin'; roleApply();
  switchTab('F');
},{hid:HID,shown:SHOWN});

await setup();
await openCsvBoxes(p);
await p.evaluate(()=>mwAmzLoad());
await p.waitForTimeout(400);

let g=await p.evaluate((o)=>({
  map:Object.keys(mwBuyMap).sort(),
  qtyHid:mwBuyQtyOf(o.hid), qtyShown:mwBuyQtyOf(o.shown),
  bar:$('csvMwBuyBar').innerHTML.replace(/<[^>]*>/g,''),
  chkShown:(($('mwBuyChk_'+o.shown)||{}).checked)===true,
  rows:document.querySelectorAll('#csvMwAmzList [data-mwrow]').length
}),{hid:HID,shown:SHOWN});
console.log('   '+JSON.stringify(g));
ok(g.map.length===2,'★★★D1 の印（2件）がそろって残る（一覧に出ていない行も）');
ok(g.qtyHid===2,'★★★一覧に出ていない行の印（2点）が消えない');
ok(g.qtyShown===1,'★一覧に出ている行の印はそのまま');
ok(g.chkShown===true,'★★一覧に出ている行のチェックは付いて見える');
ok(/仕入れる 2件/.test(g.bar),'★★合計の帯は D1 の件数（2件）で出す');
ok(/うち1件はこの一覧に出ていません/.test(g.bar),
   '★★★この一覧に出ていない印の件数を出す（外れたと見えないように）');

/* 「すべて外す」は、一覧に出ていない行の印も対象にしない…のではなく、
   D1 にある「これから仕入れる」行が対象。確認のあとに送る中身を見る。 */
let sent=await p.evaluate(()=>{
  window.__posts=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    if(/\/mw\/buy/.test(String(u))&&(i||{}).method==='POST'){
      window.__posts.push(JSON.parse(i.body));
      return new Response(JSON.stringify({ok:true,n:1,rows:[]}),{status:200});
    }
    return real(u,i);
  };
  mwBuyOffAll();
  return null;
});
await p.waitForTimeout(300);
let posts=await p.evaluate(()=>window.__posts);
console.log('   '+JSON.stringify(posts));
ok(posts.length===1&&posts[0].items.length===2,
   '★★「すべて外す」は D1 の印をすべて外す（一覧に出ていない行も含む）');

await T.done();
})();
