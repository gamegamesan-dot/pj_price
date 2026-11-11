/* 会員に出す商品の販売価格（shared/subprice.js・6.178／7.135・【2】）

   方針：**商品代に利益を載せない。会費が収益。**
     販売価格 ＝ (仕入原価 ＋ 梱包材 ＋ 上乗せ) ÷ (1 − カード決済手数料の率)
     仕入原価 ＝ round(卸値（税抜）×1.1) ＋ MW の1点あたりの仕入れ送料
   ① 掛け率（×1.3）はやめた／10円・100円単位の切り上げもしない
   ② 上乗せは配信のたびに ¥10〜150 の乱数（⚙で範囲を変えられる）
   ③ 卸値そのもの・卸値×1.1 と同じ額にはしない
   ④ カード決済手数料はちょうど回収できるように割り戻す
   ⑤ 会員の粗利の目安が⚙の下限（既定 ¥800）を下回る商品は「会員向きではない」
   ⑥ 人が決めた値（おすすめ値の帯の外）は配信のときもそのまま使う */
import { harness } from './lib.mjs';
import SUB from '../shared/subprice.js';
const T=harness('会員に出す販売価格（shared/subprice.js・6.178）');
const ok=T.ok;
const row=(o)=>Object.assign({ wholesale:3000, price:7000, fee_total:1500 },o);

console.log('=== ① 仕入原価と、切り上げをしないこと ===');
{
  ok(SUB.costOf(row({wholesale:3000}),{ship:0})===3300,
     '★★★仕入原価＝卸値×1.1（3,000→3,300）');
  ok(SUB.costOf(row({wholesale:3000}),{ship:120})===3420,
     '★★★MW の1点あたりの仕入れ送料を足す（＋120）');
  ok(SUB.costOf(row({wholesale:0}),{})===0,'★卸値が無ければ 0');
  /* 上乗せを 10 に固定して、割り戻しの形を確かめる。 */
  const p=SUB.priceOf(row({wholesale:3000}),
    { ship:0, pack:30, addMin:10, addMax:10, cardFee:0.0355 });
  console.log('   '+JSON.stringify(p)+'  '+SUB.text(p));
  ok(p.cost===3300&&p.pack===30&&p.add===10,'★内訳（仕入原価・梱包材・上乗せ）');
  ok(p.price===Math.round(3340/(1-0.0355)),'★★★手数料ぶんを割り戻す');
  ok(p.price===3463,'★★★3,463円（3,340 ÷ 0.9645）');
  ok(p.price%10!==0,'★★★10円単位に切り上げない（端数を残す）');
  ok(p.fee===p.price-3340,'★手数料の額を内訳に返す');
  /* 掛け率 1.3・100円単位だったころの値（4,300）にはならない。 */
  ok(p.price!==4300,'★★★×1.3 の掛け率はやめた');
}

console.log('\n=== ② 上乗せは乱数（⚙で範囲）===');
{
  const g=SUB.addRange({});
  ok(g.lo===10&&g.hi===150,'★★既定の範囲は ¥10〜150');
  ok(SUB.addOf({ rnd:()=>0 })===10,'★★★いちばん小さいとき ¥10');
  ok(SUB.addOf({ rnd:()=>0.999999 })===150,'★★★いちばん大きいとき ¥150');
  ok(SUB.addOf({ addMin:50, addMax:50, rnd:()=>0.5 })===50,'★⚙で範囲を変えられる');
  /* 100回まわして、範囲の中だけに入ること・ばらけること。 */
  const seen={};
  for(let i=0;i<200;i++){ const a=SUB.addOf({}); seen[a]=1;
    if(a<10||a>150){ ok(false,'範囲の外 '+a); break; } }
  ok(Object.keys(seen).length>20,'★★★配信のたびに変わる（ばらける）');
  ok(SUB.addOf({ addMin:-5, addMax:-5 })===0,'★おかしな範囲は 0 にする');
  ok(SUB.addOf({ addMin:200, addMax:10 })===200,
     '★下が上より大きければ下に合わせる');
}

console.log('\n=== ③ 卸値・卸値×1.1 と同じ額にしない ===');
{
  /* 卸値 3,300 → 卸値×1.1 は 3,630。販売価格がちょうど 3,630 になる
     上乗せ・梱包材を選んで、1円ずれることを見る。 */
  ok(SUB.avoidOf(3300,{wholesale:3300})===3301,'★★★卸値と同じなら1円ずらす');
  ok(SUB.avoidOf(3630,{wholesale:3300})===3631,
     '★★★卸値×1.1 と同じなら1円ずらす');
  ok(SUB.avoidOf(3500,{wholesale:3300})===3500,'★ちがう額はそのまま');
  /* 卸値×1.1 が 卸値＋1 になる並びでも、両方を避ける。 */
  /* 卸値 10 → 卸値×1.1 は 11。10 も 11 も避けて 12 になる。 */
  ok(SUB.avoidOf(10,{wholesale:10})===12,'★★並んでいても両方を避ける');
}

console.log('\n=== ④ ⚙の手数料の書き方 ===');
{
  ok(SUB.feeRate({})===0.0355,'★既定は 3.55%');
  ok(SUB.feeRate({cardFee:3.55})===0.0355,'★★「3.55」と入れても 3.55% と読む');
  ok(SUB.feeRate({cardFee:0.0355})===0.0355,'★「0.0355」でも読む');
  ok(SUB.feeRate({cardFee:50})===0.2,'★★おかしな値は 20% で止める');
  ok(SUB.packOf({})===30,'★梱包材の既定は ¥30');
  ok(SUB.packOf({pack:0})===0,'★★0 にもできる');
}

console.log('\n=== ⑤ 会員の粗利の目安と、会員向きかどうか ===');
{
  ok(SUB.grossOf(7000,1500,3463)===2037,
     '★★★粗利＝Amazon の実売 − 手数料 − 販売価格');
  ok(SUB.grossOf(7000,0,3463)===null,'★★手数料が取れていない行は出さない');
  ok(SUB.grossOf(0,1500,3463)===null,'★★実売が取れていない行は出さない');
  const f1=SUB.fitOf(7000,1500,3463,{});
  ok(f1.ok===true&&f1.gross===2037&&f1.min===800,'★★下限（既定 ¥800）以上なら可');
  const f2=SUB.fitOf(5000,1500,3463,{});
  console.log('   '+JSON.stringify(f2));
  ok(f2.ok===false&&f2.why==='low_gross','★★★下限を下回れば「会員向きではない」');
  ok(SUB.fitOf(7000,0,3463,{}).why==='no_fee',
     '★手数料が取れていない行は理由を分ける');
  ok(SUB.fitOf(5000,1500,3463,{grossMin:0}).ok===true,'★下限は⚙で変えられる');
}

console.log('\n=== ⑥ 人が決めた値はそのまま使う ===');
{
  const o={ ship:0, pack:30, cardFee:0.0355 };
  const r=row({wholesale:3000});
  /* おすすめ値の帯（上乗せ ¥10〜150）の中 → 配信のたびに決め直してよい */
  ok(SUB.inBand(3463,r,o)===true,'★★★おすすめ値の帯の中だと分かる');
  ok(SUB.inBand(3609,r,o)===true,'★帯の上のほうも中');
  ok(SUB.inBand(5000,r,o)===false,'★★★帯の外（人が決めた値）だと分かる');
  ok(SUB.inBand(1000,r,o)===false,'★安すぎる値も帯の外');
  ok(SUB.inBand(0,r,o)===false,'★0 は帯の外');
  ok(SUB.inBand(3463,row({wholesale:0}),o)===false,'★卸値が無ければ帯も無い');
}

T.done();
