/* 画面：登録の直前に値段を取り直す（6.155・【O】）
   2026-11-08：薔薇と椿（JAN 4570101051127）を届く前に Amazon に登録したら
   売値が ¥5,800（古い控え）になった。実際は新品0人・中古最安 ¥7,433。
   ・確認の画面に、取り直した売値と**根拠**を出す
   ・「仕入原価＋手数料＋下限利益」を下回る行は赤で警告する
   ・新品も中古もいない行は、管理者が売値を入れるまで送らない
   ・取り直せなかった行は送らない
   ・一覧の「販売価格」の横に値段を取った日時を出し、24時間より古いときは目立たせる
   ・登録済みの mw… の SKU の売値を直せる（管理者だけ） */
const { harness, openCsvBoxes, clickCfg } = require('./lib');
/* ⚙を開いて、畳んである欄を全部開くだけ（ボタンは自分で押す）。 */
const openCfg=async(page)=>{
  await page.evaluate(()=>{
    switchTab('F');
    Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
      function(d){ if(!d.open)d.open=true; });
  });
  await page.waitForTimeout(80);
};
const T = harness('画面：登録の直前に値段を取り直す（6.155）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], cancel=false;
p.on('dialog',async d=>{ dlg.push(d.message());
  if(cancel)await d.dismiss(); else await d.accept(); });

const JAN='4570101051127';
const ASIN='B0BARA0001';
/* 画面が作る SKU と同じ形にする（仕入日＝今日の日本時間・仕入原価＝卸値×1.1＋送料）。
   確認の画面は SKU をキーに下調べ（plan）を突き合わせるので、ここがずれると
   「値段を調べていません」になる。 */
const YMD=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
  .replace(/-/g,'');
const SKU='mwhobby-'+YMD+'-N-'+ASIN+'-3476';
const now=new Date().toISOString();
const old=new Date(Date.now()-30*3600000).toISOString();

const base={ sha:'M200', kishu:'FIG', cond:'新品', stock:3, note:'',
  ship_text:'即日出荷', ship_days:0, basis:'最安', new_n:0, amz:0,
  rank:3000, rank_cat:'ホビー', list_price:9900, gone_at:null, qty:1,
  rst:'ok', rst_why:'', rst_link:'', rst_at:now,
  cand_n:1, cands:null, jan_picked_at:null,
  fee_ref:870, fee_fba:500, fee_fba_ship:500, fee_fba_store:0,
  fee_tax:87, fee_total:1457, fee_base:5800, fee_at:now, fee_err:null };
const BARA=Object.assign({},base,{ jan:JAN, mw_name:'薔薇と椿',
  amz_name:'薔薇と椿 フィギュア', wholesale:3000, asin:ASIN,
  price:8920, low:0, new_n:0, used_low:7433, used_n:2, used_at:now,
  price_at:now, amz_at:now });

/* pj-sync が返す下調べ（plan）。試したい形を差し替える。 */
let plan=null, fix=null, log=[];
const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('baseProfit').value='1000';
  $('mwUsedPct').value=String(o.pct||120);
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  $('mwFbaShipM').value='500'; $('mwFbaStoreM').value='0';
  $('mwFbaSizeHobby').value='m';
  window.__posts=[]; window.__price=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')
      ?JSON.parse(i.body):null;
    const res=(x,st)=>new Response(JSON.stringify(x),{status:st||200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/mw\/price/.test(url)){ window.__price.push(b);
      return res(o.fix||{ok:true,sent:1,ok_n:1,ng:0,rows:[{sku:(b.rows[0]||{}).sku,
        ok:true,price:8920,price_src:'used',
        price_why:'新品の出品者なし：中古の最安値 ¥7,433（¥7,168＋送料 ¥265）× 120% ＝ ¥8,920',
        need:5960,floor_ng:false,profit_at:3900}]}); }
    if(/\/mw\/put/.test(url)){
      if(i&&i.method==='POST'){
        if(b&&b.check)return res({ok:true,plan:o.plan||[],rows:[]});
        window.__posts.push(b);
        return res({ok:true,sent:1,ok_n:1,ng:0,
          rows:[{sku:(b.rows[0]||{}).sku,asin:(b.rows[0]||{}).asin,ok:true,
            status:'ACCEPTED',issues:[],err:''}]});
      }
      return res({ok:true,rows:o.log||[],sent_ok:1,max:30});
    }
    if(/\/mw\/buy/.test(url)){
      if(i&&i.method==='POST')return res({ok:true});
      return res({ok:true,n:1,qty:1,yen:3300,gone:0,
        rows:[{jan:o.row.jan,qty:1,sha:'M200',mw_name:o.row.mw_name,
          amz_name:o.row.amz_name,wholesale:o.row.wholesale,asin:o.row.asin,
          price:o.row.price,rst:'ok',cand_n:1,kishu:'FIG',cond:'新品',
          stock:3,ship_days:0,gone_at:null}]});
    }
    if(/\/mw\/amz/.test(url))
      return res({ok:true,n:1,rows:[o.row],seen:1,priced:1,left:0,
        per_run:120,ttl_days:3,limit:3000});
    return real(u,i);
  };
  syncRole=o.role||'admin'; switchTab('D'); roleApply(); csvRender();
  mwAmzRows=[o.row]; mwAmzMeta={n:1,seen:1,priced:1,left:0}; mwBuyMap={};
  mwAmzRender();
},Object.assign({ row:BARA },o||{}));

console.log('=== 一覧の「販売価格」の横に値段を取った日時（6.155）===');
await setup({});
await p.waitForTimeout(150);
let html=await p.evaluate(()=>$('csvMwAmzList').innerHTML);
console.log('   '+(/販売価格/.test(html)?'（販売価格の行あり）':'（無い）'));
ok(/販売価格/.test(html),'★販売価格を出す');
let age=await p.evaluate((r)=>({ fresh:mwPriceAgeHtml(r),
  isOld:mwPriceOld(r) }),BARA);
ok(!/24時間より古い/.test(age.fresh),'★新しいうちは目立たせない');
let ageOld=await p.evaluate((o)=>({ html:mwPriceAgeHtml(o),
  isOld:mwPriceOld(o) }),Object.assign({},BARA,{ price_at:old }));
console.log('   '+ageOld.html);
ok(ageOld.isOld===true,'★★★24時間より古い値段を見分ける');
ok(/24時間より古い/.test(ageOld.html)&&/var\(--bad\)/.test(ageOld.html),
   '★★★古い値段は赤で「24時間より古い」と出す');
let noAt=await p.evaluate(()=>mwPriceAgeHtml({}));
ok(/日時なし/.test(noAt),'★★日時が無い行もそう書く');
ok(/2026-11/.test(ageOld.html)||/\d{2}:\d{2}/.test(ageOld.html),
   '★日時そのものを出す');

console.log('\n=== 新品0人の行に中古の最安値と登録の売値を出す ===');
let used=await p.evaluate((r)=>mwUsedLowHtml(r),BARA);
console.log('   '+used.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
ok(/中古最安/.test(used)&&/¥7,433/.test(used),'★★★中古の最安値を出す');
ok(/新品0人/.test(used)&&/¥8,920/.test(used)&&/×120%/.test(used),
   '★★★新品0人の行には「登録の売値」も出す');
let used2=await p.evaluate((r)=>mwUsedLowHtml(Object.assign({},r,{ new_n:3 })),BARA);
ok(/中古最安/.test(used2)&&!/新品0人/.test(used2),
   '★新品がいる行には「新品0人」とは書かない');
ok(await p.evaluate((r)=>mwUsedLowHtml(Object.assign({},r,{ used_low:0 })),BARA)==='',
   '★中古の最安値が無ければ出さない');

console.log('\n=== ⚙「新品が0人のときの掛け率」（既定120%）===');
let pct=await p.evaluate(()=>({ has:!!$('mwUsedPct'), v:$('mwUsedPct').value,
  now:mwUsedPct() }));
console.log('   '+JSON.stringify(pct));
ok(pct.has===true&&pct.now===120,'★★設定があって既定は120%');
let pct2=await p.evaluate(()=>{ $('mwUsedPct').value='150';
  const a=mwUsedPct(); $('mwUsedPct').value='';
  const b=mwUsedPct(); $('mwUsedPct').value='120'; return { a:a, b:b }; });
ok(pct2.a===150,'★★変えられる');
ok(pct2.b===120,'★空のときは120%に戻す');
ok(await p.evaluate(()=>ADV_AMZCOND.indexOf('mwUsedPct')>=0),
   '★★⚙設定として pj-sync に送る（Worker も同じ率で動く）');

console.log('\n=== 確認の画面に売値と根拠を出す ===');
const PL=[{ sku:SKU, asin:ASIN, jan:JAN, price:8920, name:'薔薇と椿 フィギュア',
  ptype:'TOYS_AND_GAMES', auto:true, hand:false, batteries:false,
  dg:'not_applicable', why:'フィギュアなので自動', req:[], def_err:'',
  need_batt:false, need_dg:false,
  price_src:'used', price_at_jst:'2026-11-08 13:40', price_err:'',
  price_why:'新品の出品者なし：中古の最安値 ¥7,433（¥7,168＋送料 ¥265）× 120% ＝ ¥8,920',
  new_n:0, new_low:0, used_low:7433, used_n:2, used_b:7168, used_s:265,
  used_pct:120, cost:3476, fee:1457, fee_real:true, need:5960,
  profit_at:3987, floor_ng:false, need_price:false }];
await setup({ plan:PL });
await openCsvBoxes(p);
await p.evaluate(()=>{ $('csvMwPut').click(); });
await p.waitForFunction(()=>/確認/.test($('csvMwPutBox').innerHTML),{timeout:9000});
let box=await p.evaluate(()=>$('csvMwPutBox').innerText);
console.log('   '+box.replace(/\n/g,' / ').slice(0,420));
ok(/¥8,920/.test(box),'★★★取り直した売値を出す');
ok(/新品の出品者なし：中古の最安値 ¥7,433（¥7,168＋送料 ¥265）× 120% ＝ ¥8,920/
   .test(box),'★★★根拠をそのまま出す');
ok(/2026-11-08 13:40 に取り直し/.test(box),'★★いつ取り直したかも出す');
ok(/仕入原価 ¥3,476/.test(box)&&/手数料 ¥1,457/.test(box),
   '★仕入原価と手数料も出す');
ok(/必要な売値 ¥5,960/.test(box),'★★必要な売値（下限）も出す');
ok(/新品が0人なら中古の最安値×120%/.test(box),'★★箱の上に決め方を1行で出す');
ok(!/下限利益を割ります/.test(box),'★★上回っているときは警告しない');
let btn=await p.evaluate(()=>({ one:!$('csvMwPutOne').disabled }));
ok(btn.one===true,'★送れる');

console.log('\n=== 下限を割る行は赤で警告する ===');
await setup({ plan:[Object.assign({},PL[0],{ price:3600, need:5960,
  floor_ng:true, profit_at:-420,
  price_why:'新品の出品者なし：中古の最安値 ¥3,000 × 120% ＝ ¥3,600' })] });
await openCsvBoxes(p);
await p.evaluate(()=>{ $('csvMwPut').click(); });
await p.waitForFunction(()=>/確認/.test($('csvMwPutBox').innerHTML),{timeout:9000});
let h2=await p.evaluate(()=>$('csvMwPutBox').innerHTML);
let t2=await p.evaluate(()=>$('csvMwPutBox').innerText);
console.log('   '+t2.replace(/\n/g,' / ').slice(0,300));
ok(/下限利益を割ります/.test(t2),'★★★下回る行は警告する');
ok(/var\(--bad\)/.test(h2),'★★★赤で出す');
ok(/必要な売値 ¥5,960/.test(t2),'★★必要な売値を出す');
ok(/見込みの利益 -?¥?420|見込みの利益 -¥420/.test(t2)||/見込みの利益/.test(t2),
   '★見込みの利益も出す');
ok(await p.evaluate(()=>!$('csvMwPutOne').disabled),
   '★★警告だけで、送るのは止めない（人が決める）');

console.log('\n=== 取り直せなかった行は送らない ===');
await setup({ plan:[Object.assign({},PL[0],{ price:0, price_src:'',
  price_why:'値段を取り直せませんでした',
  price_err:'値段を取り直せませんでした（Amazon に聞けませんでした）',
  need_price:false })] });
await openCsvBoxes(p);
await p.evaluate(()=>{ $('csvMwPut').click(); });
await p.waitForFunction(()=>/確認/.test($('csvMwPutBox').innerHTML),{timeout:9000});
let t3=await p.evaluate(()=>$('csvMwPutBox').innerText);
console.log('   '+t3.replace(/\n/g,' / ').slice(0,260));
ok(/取り直せませんでした/.test(t3),'★★★理由を出す');
ok(await p.evaluate(()=>$('csvMwPutOne').disabled===true),
   '★★★送れないようにする');
let gone=await p.evaluate(()=>{ $('csvMwPutOne').click();
  return window.__posts.length; });
ok(gone===0,'★★押しても送らない');

console.log('\n=== 新品も中古もいない行は、売値を入れるまで送らない ===');
await setup({ plan:[Object.assign({},PL[0],{ price:0, price_src:'',
  price_why:'新品も中古も出品がありません。値段を手で決めてください',
  price_err:'', need_price:true })] });
await openCsvBoxes(p);
await p.evaluate(()=>{ $('csvMwPut').click(); });
await p.waitForFunction(()=>/確認/.test($('csvMwPutBox').innerHTML),{timeout:9000});
let t4=await p.evaluate(()=>$('csvMwPutBox').innerText);
console.log('   '+t4.replace(/\n/g,' / ').slice(0,240));
ok(/値段を手で決めてください/.test(t4),'★★★そう出す');
ok(await p.evaluate(()=>!!document.querySelector('[data-mwprice]')),
   '★★★管理者には売値の欄を出す');
ok(await p.evaluate(()=>$('csvMwPutOne').disabled===true),
   '★★入れるまでは送れない');
/* 売値を入れると送れるようになり、price として送られる。 */
let hand=await p.evaluate(async()=>{
  const el=document.querySelector('[data-mwprice]');
  el.value='7500';
  el.dispatchEvent(new Event('input',{bubbles:true}));
  const canSend=!$('csvMwPutOne').disabled;
  $('csvMwPutOne').click();
  await new Promise(function(r){ setTimeout(r,120); });
  return { canSend:canSend, posts:JSON.parse(JSON.stringify(window.__posts)) };
});
console.log('   '+JSON.stringify(hand));
ok(hand.canSend===true,'★★★入れると送れるようになる');
ok(hand.posts.length===1&&hand.posts[0].price&&hand.posts[0].price[SKU]===7500,
   '★★★入れた売値を pj-sync に送る');
/* 作業者には欄を出さない。 */
await setup({ role:'staff', plan:[Object.assign({},PL[0],{ price:0,
  price_src:'', price_why:'新品も中古も出品がありません。値段を手で決めてください',
  price_err:'', need_price:true })] });
await openCsvBoxes(p);
await p.evaluate(()=>{ $('csvMwPut').click(); });
await p.waitForFunction(()=>/確認/.test($('csvMwPutBox').innerHTML),{timeout:9000});
let st4=await p.evaluate(()=>({ has:!!document.querySelector('[data-mwprice]'),
  txt:$('csvMwPutBox').innerText }));
ok(st4.has===false,'★★★作業者には売値の欄を出さない');
ok(/管理者に売値を決めてもらって/.test(st4.txt),'★★そう書く');

console.log('\n=== 登録済みの売値を直す（6.155・管理者だけ）===');
await setup({ log:[{ at:now, at_jst:'2026-11-08 13:00', sku:SKU, asin:ASIN,
  jan:JAN, price:5800, ok:1, status:'ACCEPTED', issues:[], err:'',
  by_role:'admin', ptype:'TOYS_AND_GAMES', ptype_try:'TOYS_AND_GAMES',
  kind:'put', price_src:'new', price_why:'新品の最安値 ¥5,800（送料込み）' }] });
await clickCfg(p,'#mwPutLogBtn',false);
await p.waitForFunction(()=>/data-mwfix/.test($('mwPutLogBox').innerHTML),
  {timeout:9000});
let lg=await p.evaluate(()=>$('mwPutLogBox').innerHTML);
ok(/data-mwfix="/.test(lg),'★★★通った行に「売値を直す」を出す');
ok(/新品の最安値 ¥5,800/.test(lg),'★★記録に残した値段の根拠も出す');
/* 押すと /mw/price に SKU を送る（売値は空＝取り直す）。 */
dlg=[]; cancel=false;
let fx=await p.evaluate(async()=>{
  document.querySelector('[data-mwfix]').click();
  await new Promise(function(r){ setTimeout(r,200); });
  return { price:JSON.parse(JSON.stringify(window.__price)),
           sku:$('mwFixSku').value, res:$('mwFixRes').innerText };
});
console.log('   '+JSON.stringify(fx.price)+' / '+fx.res.replace(/\n/g,' / '));
ok(fx.price.length===1&&fx.price[0].rows[0].sku===SKU,
   '★★★/mw/price に SKU を送る');
ok(!('price' in fx.price[0].rows[0]),'★★売値を入れなければ取り直してもらう');
ok(dlg.some((m)=>/売値だけを送ります/.test(m)),
   '★★★先に確認を出す（商品情報も数量も触らないと書く）');
ok(/直しました/.test(fx.res)&&/¥8,920/.test(fx.res),'★★★結果と新しい売値を出す');
ok(/中古の最安値/.test(fx.res),'★★根拠も出す');
/* 売値を入れればその値を送る。 */
let fx2=await p.evaluate(async(k)=>{
  window.__price=[];
  $('mwFixSku').value=k;
  $('mwFixPrice').value='9000';
  $('mwFixGo').click();
  await new Promise(function(r){ setTimeout(r,200); });
  return JSON.parse(JSON.stringify(window.__price));
},SKU);
ok(fx2.length===1&&fx2[0].rows[0].price===9000,'★★入れた売値を送る');
/* 下限を割るときは赤で知らせる。 */
await setup({ fix:{ ok:true, sent:1, ok_n:1, ng:0,
  rows:[{ sku:SKU, ok:true, price:3600, price_src:'used',
    price_why:'新品の出品者なし：中古の最安値 ¥3,000 × 120% ＝ ¥3,600',
    need:5960, floor_ng:true, profit_at:-420 }] } });
await openCfg(p);
let fx3=await p.evaluate(async(k)=>{
  $('mwFixSku').value=k;
  $('mwFixPrice').value='';
  $('mwFixGo').click();
  await new Promise(function(r){ setTimeout(r,200); });
  return { html:$('mwFixRes').innerHTML, txt:$('mwFixRes').innerText };
},SKU);
ok(/下限利益を割ります/.test(fx3.txt)&&/var\(--bad\)/.test(fx3.html),
   '★★★下限を割るときは赤で知らせる');
/* 形が違う SKU は送らない。 */
let fx4=await p.evaluate(async()=>{
  window.__price=[];
  $('mwFixSku').value='hobby-20261105-N-B0BARA0001-3476';
  $('mwFixGo').click();
  await new Promise(function(r){ setTimeout(r,120); });
  return { n:window.__price.length, res:$('mwFixRes').innerText };
});
console.log('   '+JSON.stringify(fx4));
ok(fx4.n===0&&/mwgame／mwhobby/.test(fx4.res),
   '★★★pj が登録した mw… の SKU 以外は送らない');
/* 作業者は使えない。 */
await setup({ role:'staff' });
await openCfg(p);
let fx5=await p.evaluate(async(k)=>{
  window.__price=[];
  $('mwFixSku').value=k;
  $('mwFixGo').click();
  await new Promise(function(r){ setTimeout(r,120); });
  return { n:window.__price.length, res:$('mwFixRes').innerText };
},SKU);
ok(fx5.n===0&&/管理者/.test(fx5.res),'★★★作業者のキーでは直せない');

await T.done();
})();
