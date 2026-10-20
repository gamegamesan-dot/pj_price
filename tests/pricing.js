/* 画面：値付けの式を shared/pricing.js に出しても金額が変わらないこと（6.75）
   tests/pricing-baseline.json は切り出す前（v173）に記録した金額で、
   広告料率は 6%（「自動処理の広告料率」の既定）にそろえてある。
   設定6組 × 1品50通り ＝ 300件と、販売連携14行を**1円単位（セント単位）で**見比べる。
   あわせて、広告料率が「その場の計算用」と「自動処理用」に分かれたことも見張る。 */
const { harness } = require('./lib');
const base = require('./pricing-baseline.json');
const T = harness('画面：値付けの式の切り出し（金額が変わらないこと）');
const ok = T.ok;
(async()=>{
const p=await T.open();

/* 基準が「切り出す前の版」で記録されたものであることを先に確かめる。
   うっかり今のコードで取り直すと、見比べる意味が無くなる
   （記録する道具は tests/tools/ に置いて一括実行から外してある）。 */
console.log('=== 基準は切り出す前の記録 ===');
console.log('   記録した版: '+base.app+'　記録日時: '+String(base.at).slice(0,16));
ok(base.app==='v173','★★基準は切り出す前（v173）の記録');
ok(base.sets.length===6&&base.sets[0].rows.length===50&&base.sync.length===14,
   '★設定6組 × 1品50通り ＝ 300件と、販売連携14行');

console.log('=== 式は shared/pricing.js から読んでいる ===');
let mod=await p.evaluate(()=>({
  has:typeof PJ_PRICING!=='undefined',
  ver:(typeof PJ_PRICING!=='undefined')?PJ_PRICING.VERSION:'',
  keys:(typeof PJ_PRICING!=='undefined')?Object.keys(PJ_PRICING).sort():[],
  air:(typeof PJ_PRICING!=='undefined')?PJ_PRICING.C.AIR[4][0]:0,
  same:(typeof PJ_PRICING!=='undefined')?(AIR===PJ_PRICING.C.AIR):false,
  noWith:typeof window.csvWithItem==='undefined' }));
console.log('   '+JSON.stringify({ver:mod.ver,air:mod.air,same:mod.same}));
ok(mod.has,'★★shared/pricing.js が読み込まれている');
ok(mod.keys.indexOf('model')>=0&&mod.keys.indexOf('priceFor')>=0
   &&mod.keys.indexOf('settings')>=0&&mod.keys.indexOf('maxCost')>=0,
   '★★式が外に出ている（model／priceFor／settings／maxCost）');
ok(mod.same&&mod.air===1200,'★★送料表も shared の1か所だけを見ている');
ok(mod.noWith,'★★csvWithItem（画面の欄を書き換える仕掛け）は無くなった');

/* 基準と同じ設定・同じ入力で測り直す。 */
const now=await p.evaluate((b)=>{
  const out=[];
  b.sets.forEach(function(sv){
    const s=sv.settings;
    Object.keys(s).forEach(function(k){
      const el=$(k); if(!el)return;
      if(typeof s[k]==='boolean')el.checked=s[k]; else el.value=String(s[k]);
    });
    /* 広告料率は2つに分かれた（6.74）。どちらの道でも同じ金額になるよう
       両方に同じ値を入れる（基準は1つだった時代の記録）。 */
    $('autoAdRate').value=String(s.adRate);
    const rows=[];
    sv.rows.forEach(function(r0){
      const it=r0.in;
      const pf=csvPriceFor(it.cost,it.weight,it.flat);
      $('cost').value=it.cost; $('weight').value=it.weight;
      const m=priceModelFor(it.cost,it.weight,it.flat);
      const pp=csvPriceForProfit(it.cost,it.weight,5000,it.flat);
      const tg=autoTarget();
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
    out.push({ name:sv.name, rows:rows });
  });
  return out;
},base);

console.log('=== 推奨売値・最低売値・損益分岐・利益（設定6組 × 1品50通り）===');
let bad=[], n=0, zbad=0, flatN=0;
base.sets.forEach(function(sv,si){
  const cur=now[si];
  sv.rows.forEach(function(b,ri){
    const a=cur.rows[ri]; n++;
    ['price','floor','be','zone','pp','target','basisZone','basis','unreach']
      .forEach(function(k){
        if(String(a[k])!==String(b[k]))
          bad.push(sv.name+' '+JSON.stringify(b.in)+' '+k+': '+b[k]+' → '+a[k]);
      });
    // 浮動小数の計算（利益・係数）は 1e-9 まで同じことを見る
    [['profit',a.profit,b.profit],['pRec',a.pRec,b.pRec],['mFloor',a.mFloor,b.mFloor],
     ['denB',a.denB,b.denB],['restB',a.restB,b.restB]].forEach(function(x){
      if(Math.abs(x[1]-x[2])>1e-9)
        bad.push(sv.name+' '+JSON.stringify(b.in)+' '+x[0]+': '+x[2]+' → '+x[1]);
    });
    /* 地帯ごとの係数。封筒の送料（flat）が入る行だけは、**基準の記録のほうが
       間違っていた**のでここでは見比べない（下の節で正しい値を見張る）。
       旧 priceModel() が返す zoneCost(z) は global の PRICE_FLAT を見ていたため、
       csvWithFlat を抜けたあとに呼ぶと封筒の送料が 0 に戻り、重量の表の送料で
       計算されていた。式を切り出したときに flat を閉じ込めたので直った。 */
    if(b.in.flat>0){ flatN++; return; }
    b.zones.forEach(function(z,zi){
      const y=a.zones[zi];
      ['den','rest','u','profit','recv','duty','ship','feeTotal'].forEach(function(k){
        if(Math.abs(y[k]-z[k])>1e-9){ zbad++;
          if(zbad<=4)console.log('   ✗zone '+sv.name+' '+JSON.stringify(b.in)
            +' z'+z.z+' '+k+': '+z[k]+' → '+y[k]); }
      });
    });
  });
});
console.log('   見比べた件数: '+n+'　ちがい: '+bad.length
  +'　地帯の係数のちがい: '+zbad+'（封筒の送料の行 '+flatN+'件は別に見る）');
bad.slice(0,8).forEach(function(x){ console.log('   ✗ '+x); });
ok(n===300,'★300件を見比べた');
ok(bad.length===0,'★★推奨売値・最低売値・損益分岐・利益・採用基準がぜんぶ同じ');
ok(zbad===0,'★★地帯ごとの係数・入金・関税・送料・手数料もぜんぶ同じ');

/* 封筒の送料（フィギュアのみ）の行。旧版は、価格モデルを受け取ったあとに
   zoneCost / zoneProfit を呼ぶと封筒の送料が 0 に戻り、重量の表の送料で
   計算されていた（推奨売値そのものは正しかったが、あとから利益を出すと狂う）。 */
console.log('=== 封筒の送料が閉じ込められている（旧版の不具合の修正）===');
const fl=await p.evaluate(()=>{
  $('adRate').value='6'; $('autoAdRate').value='6';
  const m=priceModelFor(1200,200,320);
  return { ship1:m.zoneCost(1), ship4:m.zoneCost(4),
           face1:faceShip(200,1), face4:faceShip(200,4),
           pf:csvPriceFor(1200,200,320), pf0:csvPriceFor(1200,200,0) };
});
console.log('   '+JSON.stringify(fl));
ok(fl.ship1===320&&fl.ship4===320,
   '★★どの地帯でも封筒の送料（320円）を使う');
ok(fl.face1===820&&fl.face4===1410,'★重量の表の送料とは別の値（旧版はこちらを使っていた）');
ok(fl.pf.price<fl.pf0.price,'★封筒のほうが送料が安いので推奨売値も安い');

console.log('=== 販売連携の目標（D1 の値だけ・出品リストは空）===');
const sv=await p.evaluate((b)=>{
  csvList=[]; try{ csvSaveList(); }catch(e){}
  const base={ fx:'160', fxc:'2', fee:'13.6', intlFee:'1.35', adRate:'6',
    feeTax:'10', fixed:'0.40', pack:'150', usTaxRate:'8', baseProfit:'1000',
    linkRate:'30', saleRate:'15', targetMode:'auto', shipCharge:'15',
    dutyShip:false, taxRefund:false, stampDisc:false };
  Object.keys(base).forEach(function(k){
    const el=$(k); if(!el)return;
    if(typeof base[k]==='boolean')el.checked=base[k]; else el.value=String(base[k]);
  });
  $('autoAdRate').value='6';
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
    amazon_lowest_at:'2026-10-19T12:00:00Z',
    warnings:[],notes:[],state:'ok'},x||{});
  const items=[
    it('B0BASE0001'),
    it('B0BASE0002',{cost_yen:3980,weight_g:345}),
    it('B0BASE0003',{cond:'new',amazon_lowest:14000}),
    it('B0BASE0004',{cond:'cart',ebay_sku:'E-B0BASE0004-C'}),
    it('B0BASE0005',{cond:'loose',ebay_sku:'E-B0BASE0005-L'}),
    it('B0BASE0006',{prefix:'fig'}),
    it('B0BASE0007',{amazon_new_low:6280,amazon_new_n:4}),
    it('B0BASE0008',{amazon_offers_json:
      '[{"p":8000,"c":"acceptable"},{"p":9000,"c":"good"}]'}),
    it('B0BASE0009',{sold_usd:120}),
    it('B0BASE0010',{sold_usd:40}),
    it('B0BASE0011',{restocking:1,restock_price:60,restock_max_cost:2500}),
    it('B0BASE0012',{amazon_lowest:0,amazon_offers:0,amazon_offers_json:'[]'}),
    it('B0BASE0013',{fba_available:0,mode:'restock'}),
    it('B0BASE0014',{ebay_price:200,restocking:1,restock_price:200,
      restock_max_cost:9000}),
  ];
  syncData={at:new Date().toISOString(),counts:{},items:items};
  syncMemoClear();
  return items.map(function(x){
    const bs=syncBasis(x), rec=syncRecommend(x), rc=syncRecCost(x);
    const fl=syncFloorOf(x), rv=syncRvTargetOf(x), md=syncMdPlanOf(x);
    const pb=syncPbWant(x), rk=syncRkTargetOf(x), pr=syncPriceReview(x);
    return { asin:x.asin, cond:x.cond,
      basis:{ low:bs.low, lowAll:bs.lowAll, near:bs.near.length, useNew:bs.useNew,
              skipped:bs.skipped, looseCut:bs.looseCut },
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
      review:pr?{now:pr.now,next:pr.next,diff:pr.diff,up:pr.up,from:pr.from}:null };
  });
},base);

let sbad=[];
const near=(a,b)=>(typeof a==='number'&&typeof b==='number')
  ? Math.abs(a-b)<=1e-9 : JSON.stringify(a)===JSON.stringify(b);
base.sync.forEach(function(b,i){
  const a=sv[i];
  if(!a){ sbad.push(b.asin+' が無い'); return; }
  Object.keys(b).forEach(function(k){
    if(k==='asin'||k==='cond')return;
    const x=JSON.stringify(a[k]), y=JSON.stringify(b[k]);
    if(x===y)return;
    /* 中身の数字だけ 1e-9 まで見る（利益は小数が長いので） */
    if(a[k]&&b[k]&&typeof a[k]==='object'&&typeof b[k]==='object'
       &&Object.keys(b[k]).every(function(kk){ return near(a[k][kk],b[k][kk]); }))return;
    sbad.push(b.asin+' '+k+': '+y+' → '+x);
  });
});
console.log('   見比べた行: '+base.sync.length+'　ちがい: '+sbad.length);
sbad.slice(0,10).forEach(function(x){ console.log('   ✗ '+x); });
ok(base.sync.length===14,'★14行を見比べた');
ok(sbad.length===0,
   '★★Amazon基準・推奨売値・最低売値・仕入値の上限・見直し・自動値下げ・'
   +'再調達・追従の目標がぜんぶ同じ');

console.log('=== 広告料率は「その場の計算用」と「自動処理用」に分かれた ===');
const ad=await p.evaluate(()=>{
  $('adRate').value='0'; $('autoAdRate').value='6';
  syncMemoClear();
  const a={ calc:priceModel().adRate, auto:priceModelFor(3980,345,0).adRate,
            price:csvPriceFor(3980,345,0).price };
  $('adRate').value='12'; syncMemoClear();
  const b={ calc:priceModel().adRate, auto:priceModelFor(3980,345,0).adRate,
            price:csvPriceFor(3980,345,0).price };
  $('adRate').value='0'; $('autoAdRate').value='10'; syncMemoClear();
  const c={ auto:priceModelFor(3980,345,0).adRate,
            price:csvPriceFor(3980,345,0).price };
  return { a:a, b:b, c:c, def:AUTO_AD_DEFAULT,
           sent:advGet(), html:$('autoAdRate').getAttribute('value') };
});
console.log('   '+JSON.stringify({a:ad.a,b:ad.b,c:ad.c}));
ok(ad.a.calc===0&&ad.a.auto===0.06,
   '★★計算機は欄の値（0%）、自動処理は6%');
ok(ad.b.calc===0.12&&ad.b.auto===0.06,
   '★★計算機を12%にしても自動処理は6%のまま');
ok(ad.a.price===ad.b.price,
   '★★一覧の推奨売値は計算機の広告料率で変わらない');
ok(ad.c.auto===0.10&&ad.c.price!==ad.a.price,
   '★★「自動処理の広告料率」を変えると一覧の推奨売値が変わる');
ok(ad.def===6&&ad.html==='6','★★既定は6%');
ok(!('adRate' in ad.sent),'★★計算機の広告料率は pj-sync に送らない');
ok(ad.sent.autoAdRate==='10','★★「自動処理の広告料率」は送る');

console.log('=== 設定が足りなくても既定値で動く ===');
const def=await p.evaluate(()=>{
  const S=PJ_PRICING.settings({});
  const S2=PJ_PRICING.settings({ fx:'', fee:null, adRate:undefined, targetMode:'へんな値' });
  return { S:S, S2:S2,
    p:PJ_PRICING.priceFor(S,3980,345,0), d:PJ_PRICING.DEFAULTS.adRate };
});
console.log('   '+JSON.stringify(def.p));
ok(def.S.fx===160&&def.S.fee===13.6&&def.S.targetMode==='auto','★既定値が入る');
ok(def.S2.fx===160&&def.S2.fee===13.6&&def.S2.targetMode==='auto',
   '★★空・null・知らない値は既定値にする');
ok(def.d===5.0,'★shared の既定の広告料率は5%（画面の初期値と同じ）');

await T.done();
})();
