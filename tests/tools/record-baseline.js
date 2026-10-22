/* 移行前の金額を記録する（C段の前に1回だけ走らせる）。
   値付けの式を shared/pricing.js に切り出す前と後で、**同じ入力なら同じ金額**に
   なることを tests/pricing.js が見比べるための元データを作る。
   **これは一括実行（sh tests/run.sh）には入れない**。走らせると基準が
   いまのコードで上書きされ、見比べる意味が無くなる。そのため tests/ ではなく
   tests/tools/ に置いてある（run.sh が拾うのは tests/*.js だけ）。

   使い方:  node tests/tools/record-baseline.js
     → tests/pricing-baseline.json を作り直す。
       **式を変えたときだけ**、変える前のコードで走らせること。 */
const { harness } = require('../lib');
const T = harness('基準の記録');
(async()=>{
const p=await T.open();

/* 設定の組み合わせ。既定値と、ぜんぶ変えた値。 */
const SETS=[
  { name:'既定', s:{ adRate:'6' } },
  { name:'変更', s:{ fx:'151.4', fxc:'3.5', fee:'14.2', intlFee:'1.8', adRate:'7.5',
      feeTax:'10', fixed:'0.55', pack:'220', usTaxRate:'9.5', baseProfit:'1500',
      linkRate:'45', saleRate:'18', targetMode:'auto',
      dutyShip:true, taxRefund:true, stampDisc:true } },
  { name:'円式', s:{ adRate:'6', targetMode:'yen', baseProfit:'2000', linkRate:'20' } },
  { name:'売上比', s:{ adRate:'6', targetMode:'rate', saleRate:'25' } },
  { name:'還付のみ', s:{ adRate:'6', taxRefund:true } },
  { name:'切手のみ', s:{ adRate:'6', stampDisc:true } },
];
/* 1品ごとの入力。仕入値・重量・封筒の送料（フィギュアのみ）。 */
const ITEMS=[];
[0,500,1200,3980,9000,25000].forEach(function(c){
  [0,50,150,345,400,1200,2100,4800].forEach(function(w){
    ITEMS.push({cost:c,weight:w,flat:0});
  });
});
[1200,3980].forEach(function(c){ ITEMS.push({cost:c,weight:200,flat:320}); });

const out=await p.evaluate((o)=>{
  const SETS=o.SETS, ITEMS=o.ITEMS;
  const r={ at:new Date().toISOString(), app:APP_V, sets:[] };
  const base={ fx:'160', fxc:'2', fee:'13.6', intlFee:'1.35', adRate:'5.0',
    feeTax:'10', fixed:'0.40', pack:'150', usTaxRate:'8', baseProfit:'1000',
    linkRate:'30', saleRate:'15', targetMode:'auto', shipCharge:'15',
    dutyShip:false, taxRefund:false, stampDisc:false };
  SETS.forEach(function(sv){
    const s=Object.assign({},base,sv.s);
    Object.keys(s).forEach(function(k){
      const el=$(k); if(!el)return;
      if(typeof s[k]==='boolean')el.checked=s[k]; else el.value=String(s[k]);
    });
    /* 広告料率は「その場の計算用」と「自動処理用」に分かれた（6.74）。
       どちらの道でも同じ金額になるよう、両方に同じ値を入れてから測る。 */
    if($('autoAdRate'))$('autoAdRate').value=String(s.adRate);
    const rows=[];
    ITEMS.forEach(function(it){
      /* ① csvPriceFor（推奨売値・最低売値・損益分岐・利益） */
      const pf=csvPriceFor(it.cost,it.weight,it.flat);
      /* ② priceModel（地帯の係数・採用した基準） */
      $('cost').value=it.cost; $('weight').value=it.weight;
      const m=csvWithFlat(it.flat,function(){ return priceModel(); });
      /* ③ 目標の利益をちょうど得る売値 */
      const pp=csvPriceForProfit(it.cost,it.weight,5000,it.flat);
      /* ④ 円式の目標 */
      const tg=autoTarget();
      /* ⑤ 地帯ごとの係数と利益（丸めの差まで見る） */
      const zs=[1,2,3,4].map(function(z){
        const c=m.zoneCoef(z), pr=m.zoneProfit(pf.price,z);
        return { z:z, den:c.den, rest:c.rest, u:c.u,
                 profit:pr.profit, recv:pr.recv, duty:pr.duty, ship:pr.ship,
                 feeTotal:pr.fb.total };
      });
      rows.push({ in:it, price:pf.price, floor:pf.floor, be:pf.be, zone:pf.zone,
                  profit:pf.profit, pRec:m.pRec, mFloor:m.floor, denB:m.denB,
                  restB:m.restB, basisZone:m.basisZone, basis:m.basis,
                  unreach:m.rateUnreachable, pp:pp, target:tg, zones:zs });
    });
    r.sets.push({ name:sv.name, settings:s, rows:rows });
  });
  /* ⑥ 販売連携側（D1 の値だけで動かす＝出品リストは空にする） */
  csvList=[]; try{ csvSaveList(); }catch(e){}
  Object.keys(base).forEach(function(k){
    const el=$(k); if(!el)return;
    if(typeof base[k]==='boolean')el.checked=base[k]; else el.value=String(base[k]);
  });
  $('adRate').value='6';
  if($('autoAdRate'))$('autoAdRate').value='6';
  $('syncTol').value='200'; $('syncSkipAcc').checked=true;
  $('syncWeight').value='400'; $('syncWeightGame').value='150';
  $('csvWeightCart').value='50'; $('csvWeightLoose').value='200';
  $('csvShipLoose').value='0'; $('csvLooseAmz').value='80';
  $('csvMarkStep').value='1'; $('csvMarkTimes').value='10';
  $('csvReviewAbs').value='1'; $('csvReviewPct').value='3';
  $('syncSoldCut').value='0'; $('csvReviewZero').checked=false;
  const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'99'+asin.slice(-4),ebay_qty:1,ebay_price:60,
    title:asin,cost_yen:null,weight_g:null,sku_cost:null,
    one_off:0,one_off_known:1,dropship:0,restocking:0,on_hand:0,mode:'hold',
    fba_available:1,fba_inbound:0,fba_reserved:0,fba_res_cust:null,
    fba_res_trans:null,fba_res_proc:null,fba_seen_at:new Date().toISOString(),
    mark_at:null,mark_stop:0,ebay_first:0,ebay_bo:0,ebay_sale:0,
    md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,
    rk_want:null,rk_floor:null,rk_low:null,rk_n:null,rk_max_cost:null,
    sold_usd:null,amazon_lowest:9000,amazon_offers:3,
    amazon_offers_json:'[{"p":9000,"c":"good"},{"p":9100,"c":"verygood"}]',
    amazon_new_low:null,amazon_new_n:0,
    /* 鮮度の判定（lowOf・24時間）に効くので、日付は固定しない。
       固定するとその日を越えた翌日から pbWant が「古い」に落ちる。 */
    amazon_lowest_at:new Date(Date.now()-3600000).toISOString(),
    warnings:[],notes:[],state:'ok'},x||{});
  const items=[
    it('B0BASE0001'),                                             // 仕入値なし
    it('B0BASE0002',{cost_yen:3980,weight_g:345}),                // 仕入値あり
    it('B0BASE0003',{cond:'new',amazon_lowest:14000}),            // 新品
    it('B0BASE0004',{cond:'cart',ebay_sku:'E-B0BASE0004-C'}),     // カートリッジのみ
    it('B0BASE0005',{cond:'loose',ebay_sku:'E-B0BASE0005-L'}),    // フィギュアのみ
    it('B0BASE0006',{prefix:'fig'}),                              // ホビー（既定重量）
    it('B0BASE0007',{amazon_new_low:6280,amazon_new_n:4}),        // 新品の方が安い
    it('B0BASE0008',{amazon_offers_json:
      '[{"p":8000,"c":"acceptable"},{"p":9000,"c":"good"}]'}),    // 可を除く
    it('B0BASE0009',{sold_usd:120}),                              // 相場あり
    it('B0BASE0010',{sold_usd:40}),                               // 相場が低い（見送り）
    it('B0BASE0011',{restocking:1,restock_price:60,restock_max_cost:2500}),
    it('B0BASE0012',{amazon_lowest:0,amazon_offers:0,amazon_offers_json:'[]'}),
    it('B0BASE0013',{fba_available:0,mode:'restock'}),            // フェイズBの再調達
    it('B0BASE0014',{ebay_price:200,restocking:1,restock_price:200,
      restock_max_cost:9000}),                                    // 下げる追従
  ];
  syncData={at:new Date().toISOString(),counts:{},items:items};
  syncMemoClear();
  const sv=[];
  items.forEach(function(x){
    const b=syncBasis(x), rec=syncRecommend(x), rc=syncRecCost(x);
    const fl=syncFloorOf(x), rv=syncRvTargetOf(x), md=syncMdPlanOf(x);
    const pb=syncPbWant(x), rk=syncRkTargetOf(x), pr=syncPriceReview(x);
    sv.push({ asin:x.asin, cond:x.cond,
      basis:{ low:b.low, lowAll:b.lowAll, near:b.near.length, useNew:b.useNew,
              skipped:b.skipped, looseCut:b.looseCut },
      rec:rec?{price:rec.price,floor:rec.floor,be:rec.be,profit:rec.profit,
               weight:rec.weight,from:rec.weightFrom}:null,
      cost:rc?{price:rc.price,floor:rc.floor,cost:rc.cost,from:rc.costFrom}:null,
      floor:{ v:fl.v, from:fl.from },
      want:syncWantPrice(x),
      maxCost:syncMaxCost(60,syncWeightOf(x).v),
      rv:rv, md:md,
      pb:pb.ok?{price:pb.price,floor:pb.floor,down:pb.down,under:pb.under}
              :{ok:false,why:pb.why},
      rk:{ kind:rk.kind, to:rk.to, want:rk.want, under:rk.under, n:rk.n,
           held:!!rk.held, why:rk.why },
      review:pr?{now:pr.now,next:pr.next,diff:pr.diff,up:pr.up,from:pr.from}:null });
  });
  r.sync=sv;
  return r;
},{SETS:SETS,ITEMS:ITEMS});

require('fs').writeFileSync(__dirname+'/../pricing-baseline.json',
  JSON.stringify(out,null,1));
let n=0;
out.sets.forEach(function(s){ n+=s.rows.length; });
console.log('   設定 '+out.sets.length+'組 × 1品 '+(out.sets[0].rows.length)
  +'通り ＝ '+n+'件／販売連携 '+out.sync.length+'行');
T.ok(n>=250&&out.sync.length>=14,'★基準を記録した（tests/pricing-baseline.json）');
await T.done();
})();
