/* 販売連携：行の「値下げしない」が、どの区分の行でも効くこと（6.140）
   ・E-<ASIN>-C（カートリッジのみ）・-L（フィギュアのみ）・-U（中古）・新品・
     W-<JAN>（MW 無在庫）の行で、押すと /listings に mark_stop が送られ、
     ボタンが「オン」に変わる
   ・送るキーは ASIN＋区分（cart／loose／used／new）そのまま
   ・行を特定できないとき・キーが空のとき・送信に失敗したときは、
     押したボタンのすぐ下に理由を出す（黙って何も起きない状態を無くす）
   ・表示の作り直しでつまずいても、保存できたことは残す
   ・一覧のキーの作り方は syncRowKey だけ。区分の書き方が違っても引ける
   ・値下げの対象外の行は、その理由を必ず行に出す（今夜の自動値下げに
     かからないことを行の上で確かめられる） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('販売連携：値下げしないの切り替え');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value=o.api===''?'':'https://pj-sync.example.workers.dev';
  $('syncKey').value=(o.key===''?'':'k');
  $('csvMarkDays').value='3'; $('csvMarkStep').value='1';
  $('autoMdMode').value='on';
  window.__posts=[]; window.__fail=!!o.fail;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body)?JSON.parse(i.body):null;
    if(/\/listings/.test(url)){
      window.__posts.push((b&&b.items)||[]);
      if(window.__fail)return new Response('no',{status:403});
      return new Response(JSON.stringify({accepted:1,rejected:0}),{status:200});
    }
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:'admin',staff_key_set:true}),{status:200});
    if(/\/status/.test(url))
      return new Response(JSON.stringify({counts:{},items:[],last_runs:[]}),{status:200});
    return real(u,i);
  };
  const it=(asin,cond,sku,x)=>Object.assign({asin:asin,cond:cond,scope:'ebay',
    title:asin+'の商品',ebay_sku:sku,ebay_item_id:'1687747'+asin.slice(-4),
    ebay_qty:1,ebay_price:60,cost_yen:2000,weight_g:200,
    on_hand:0,one_off:0,one_off_known:1,dropship:0,restocking:0,mode:'hold',
    fba_available:null,fba_inbound:0,fba_reserved:0,fba_seen_at:null,
    mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,ebay_sale:0,
    md_step:1,md_start:60,md_floor:40,md_n:10,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_fail:0,revise_err:null,
    pb_act:null,pb_why:null,pb_skip:0,pb_fail:0,pics_eps:1,sold_keep:0,
    amazon_lowest:5000,amazon_offers:2,
    amazon_offers_json:'[{"p":5000,"c":"good"},{"p":5200,"c":"good"}]',
    amazon_lowest_at:new Date().toISOString(),
    sold_usd:null,warnings:[],notes:[],state:'ok'},x||{});
  syncData={at:new Date().toISOString(),counts:{},items:o.items||[
    it('B07MLZ2JKF','cart','E-B07MLZ2JKF-C'),
    it('B0LOOSE0001','loose','E-B0LOOSE0001-L'),
    it('B0USED00001','used','E-B0USED00001-U'),
    it('B0NEW000001','new','E-B0NEW000001'),
    it('B0MWDROP001','new','W-4902370550467',{dropship:1}),
    it('B0RESTOCK01','used','E-B0RESTOCK01-U',{restocking:1})
  ]};
  window.__it=it;
  syncPick={}; syncPage=1; syncRole='admin'; roleApply();
  switchTab('E'); $('syncFilter').value='all'; syncRender();
},o||{});

const row=async(key)=>await p.evaluate((key)=>{
  const el=document.querySelector('#syncList [data-srow="'+key+'"]');
  if(!el)return null;
  const b=el.querySelector('[data-smstop]');
  const nt=el.querySelector('[data-sbtns] [data-sbtnnote]');
  return { btn:b?b.textContent.trim():'', note:nt?nt.textContent.trim():'',
           md:String(el.textContent||'') };
},key);
const press=async(key)=>{
  await p.click('#syncList [data-srow="'+key+'"] [data-smstop]');
  await p.waitForTimeout(250);
};
const posts=async()=>await p.evaluate(()=>window.__posts);

/* ---- 1. どの区分の行でも、押せば送られて「オン」になる ---- */
await setup();
await openCsvBoxes(p);
const keys=['B07MLZ2JKF|cart','B0LOOSE0001|loose','B0USED00001|used',
            'B0NEW000001|new','B0MWDROP001|new'];
for(const k of keys){
  const b0=await row(k);
  ok(!!b0&&b0.btn==='値下げしない オフ','押す前は「オフ」：'+k);
  await press(k);
  const b1=await row(k);
  ok(!!b1&&b1.btn==='値下げしない オン','押すと「オン」に変わる：'+k);
}
const ps=await posts();
ok(ps.length===5,'5件とも pj-sync に送っている（'+ps.length+'件）');
ok(ps.every((x)=>x.length===1&&x[0].mark_stop===true),
   'どれも mark_stop:true を送っている');
ok(JSON.stringify(ps.map((x)=>x[0].asin+'|'+x[0].cond))
   ===JSON.stringify(['B07MLZ2JKF|cart','B0LOOSE0001|loose','B0USED00001|used',
                      'B0NEW000001|new','B0MWDROP001|new']),
   'ASIN と区分をそのまま送っている（-C は cart、-L は loose）');
ok((await row('B07MLZ2JKF|cart')).md.indexOf('値下げ：値下げしない')>=0,
   'オンにした行は「値下げ：値下げしない」と出る');

/* もう一度押せばオフに戻る（送るのは false） */
await press('B07MLZ2JKF|cart');
ok((await row('B07MLZ2JKF|cart')).btn==='値下げしない オフ','もう一度押すとオフに戻る');
ok((await posts())[5][0].mark_stop===false,'戻すときは mark_stop:false を送る');

/* ---- 2. 対象外の理由は必ず行に出す（今夜の値下げにかからない確認） ---- */
ok((await row('B0RESTOCK01|used')).md.indexOf('値下げ：対象外（再調達中）')>=0,
   '再調達中の行は「値下げ：対象外（再調達中）」と出る');
ok((await row('B0MWDROP001|new')).md.indexOf('値下げ：値下げしない')>=0,
   '無在庫でも、値下げしないの印が立っていればそれを出す');

/* ---- 3. 行を特定できないときは、黙らずに理由を出す ---- */
await setup();
await openCsvBoxes(p);
await p.evaluate(()=>{
  /* 一覧の控えを入れ替えて、キーが合わない状態を作る（v225 の不具合の形）。 */
  syncData.items=[window.__it('B0OTHER0001','used','E-B0OTHER0001-U'),
                  window.__it('B0OTHER0002','used','E-B0OTHER0002-U')];
});
await press('B07MLZ2JKF|cart');
const miss=await row('B07MLZ2JKF|cart');
ok(/この行を特定できませんでした/.test(miss.note),
   '行を引けないときは、ボタンのすぐ下に理由を出す');
ok((await posts()).length===0,'引けないときは送らない');

/* 区分の書き方が違っても引ける（①が外れても②③で拾う） */
const by=await p.evaluate(()=>{
  syncData.items=[window.__it('B0CART00001','cart','E-B0CART00001-C')];
  return { exact:!!syncRowBy('B0CART00001|cart'),
           empty:!!syncRowBy('B0CART00001|'),
           asin:!!syncRowBy('B0CART00001|used'),
           none:!!syncRowBy('B0NOTHERE01|cart'),
           key:syncRowKey(syncData.items[0]) };
});
ok(by.exact&&by.empty&&by.asin,'キーの書き方が違っても同じ行を引ける');
ok(!by.none,'無い ASIN は引かない');
ok(by.key==='B0CART00001|cart','キーの作り方は syncRowKey だけ（区分はそのまま）');

/* ---- 4. キーが空・送信に失敗したときも、その場に出す ---- */
await setup({key:''});
await openCsvBoxes(p);
await press('B07MLZ2JKF|cart');
ok(/のキー」が空です/.test((await row('B07MLZ2JKF|cart')).note),
   'pj-sync のキーが空なら、その場に「キーが空です」と出す');
ok((await posts()).length===0,'キーが無いときは送らない');

await setup({fail:true});
await openCsvBoxes(p);
await press('B07MLZ2JKF|cart');
const bad=await row('B07MLZ2JKF|cart');
ok(/切り替えに失敗しました：HTTP 403/.test(bad.note),
   '断られたら、その場に HTTP の番号まで出す');
ok(bad.btn==='値下げしない オフ','失敗したらボタンは元のまま');

/* ---- 5. 表示の作り直しでつまずいても、保存できたことは残す ---- */
await setup();
await openCsvBoxes(p);
const kept=await p.evaluate(async()=>{
  const real=window.syncRender;
  window.syncRender=function(){ throw new Error('わざと失敗'); };
  document.querySelector('#syncList [data-srow="B07MLZ2JKF|cart"] [data-smstop]').click();
  await new Promise((r)=>setTimeout(r,250));
  window.syncRender=real;
  const r=syncRowBy('B07MLZ2JKF|cart');
  return { mark:Number(r.mark_stop||0), note:$('syncFixNote').textContent };
});
ok(kept.mark===1,'作り直しが失敗しても、印は保存されている');
ok(/保存は済みました/.test(kept.note),
   '作り直しの失敗は「保存は済みました」と分けて出す');

await T.done();
})();
