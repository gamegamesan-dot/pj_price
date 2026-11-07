/* 画面：推奨売値の下に地域ごとの支払い総額と利益を出す（6.148）
   「内訳の表示先」を米国にしていても、推奨売値の基準がアジア（送料無料）だと
   「商品代 $17.28 ＋ 請求送料 $0.00」と出て、米国の送料 $15 が消えたように見えた。
   ・4地帯ぶん「買い手の支払い総額（商品代＋請求送料）」と「利益」を出す
   ・★基準（推奨売値を決めた地帯）と（表示中）の印を付ける
   ・総額の行にも、どの地帯の請求送料かを書き添える */
const { harness } = require('./lib');
const T = harness('画面：地域ごとの総額と利益');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

const setup=async(o)=>await p.evaluate((o)=>{
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('shipCharge').value='15.00'; $('adRate').value='5.0';
  $('cost').value=String(o.cost||1000); $('weight').value=String(o.weight||400);
  $('pack').value='150';
  $('zone').value=String(o.zone||4);
  $('soldPrice').value='';
  calc();
  const txt=(id)=>($(id)||{}).textContent||'';
  return { total:txt('bigTotal'), zones:$('bigZones').textContent,
           html:$('bigZones').innerHTML, val:txt('bigVal'), sub:txt('bigSub') };
},o);

/* 軽い商品（基準がアジア側になりやすい） */
let g=await setup({cost:1000,weight:150,zone:4});
console.log('   推奨 '+g.val);
console.log('   '+g.total);
console.log('   '+g.zones.replace(/\s+/g,' '));
ok(/第[1-4]＝基準/.test(g.total),
   '★★★総額の行に、どの地帯の請求送料かを書く');
ok(/第1 中国・韓国・台湾/.test(g.zones)&&/第2 アジア/.test(g.zones)
  &&/第3 オセアニア/.test(g.zones)&&/第4 米国/.test(g.zones),
   '★★★4地帯ぶん出す');
ok(/★基準/.test(g.zones),'★★基準の地帯に印を付ける');
ok(/（表示中）/.test(g.zones),'★★「内訳の表示先」の地帯にも印を付ける');
ok(/送料無料/.test(g.zones),'★★送料を別建てしない地帯は「送料無料」と出す');
ok(/＋送料 \$15\.00/.test(g.zones),
   '★★★送料を別建てする地帯は「商品 $○＋送料 $15.00」と出す');
ok(/利益 ¥/.test(g.zones),'★★地帯ごとの利益も出す');

/* 表示先を変えると（表示中）が移る */
let g2=await setup({cost:1000,weight:150,zone:2});
/* textContent には改行が入らないので、innerHTML の <br> で分ける。 */
let lines=g2.html.split(/<br\s*\/?>/i);
let line4=lines.filter((x)=>/第4/.test(x))[0]||'';
let line2=lines.filter((x)=>/第2/.test(x))[0]||'';
ok(/（表示中）/.test(line2)&&!/（表示中）/.test(line4),
   '★★「内訳の表示先」を変えると印が移る');

/* 米国の総額＝商品代＋$15、アジアは商品代そのまま */
let n=await p.evaluate(()=>{
  const m=PJ_PRICING.model(calcSettings(),
    { cost:+$('cost').value, weight:+$('weight').value, flat:0 });
  const rec=Math.ceil(m.pRec*100)/100;
  const out={};
  PJ_PRICING.C.ZONES.forEach(function(z){
    out[z]={ g:m.zoneShipCharge(z), tot:Math.round((rec+m.zoneShipCharge(z))*100)/100,
             profit:Math.round(m.zoneProfit(rec,z).profit) };
  });
  return { rec:rec, out:out, basis:m.basisZone };
});
console.log('   '+JSON.stringify(n));
let txt=await p.evaluate(()=>$('bigZones').textContent);
ok(txt.indexOf('$'+n.out[4].tot.toFixed(2))>=0,
   '★★★米国の総額は 商品代＋$15（'+n.out[4].tot.toFixed(2)+'）');
ok(txt.indexOf('$'+n.out[2].tot.toFixed(2))>=0,
   '★★アジアの総額は商品代そのまま（'+n.out[2].tot.toFixed(2)+'）');
ok(n.out[4].tot>n.out[2].tot,'★米国の総額はアジアより高い（送料のぶん）');

await T.done();
})();
