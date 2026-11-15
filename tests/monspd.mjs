/* 決まり：売れる速さの内訳と、下限を変えたときの件数（8.44・カジの確認1〜4）

   カジの報告（2026-11-16）
   「売れる速さ 0／0／0 点/日」「モニターの条件に合う品：1件」
   → **データが取れていない行を 0点と同じに数えていた**。

   ① 速さの出し方は shared/mwstat.js（MW の在庫の減り）。
      直近7日に減った数 ÷ 日数（7日ぶん無ければその日数）。
      7日に減りが無ければ**全期間**（減った数 ÷ 記録のある日数）。
      どちらも無ければ **null（データなし）**。
   ② 内訳：データなし／本当に0（減っていない）／0より大きい
   ③ 0より大きい品の帯：0.1未満／0.1〜0.5／0.5〜1／1〜2.5／2.5以上
   ④ 下限（2.5／1／0.5／0.3 点/日）と対象（通常版ゲーム／クリックポストで
      送れる品まで）を変えたときの候補の件数（**数えるだけ**） */
import { harness } from './lib.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const P=require('../shared/subplan.js');
const S=require('../shared/mwstat.js');
const T=harness('決まり：速さの内訳と候補の件数（8.44）');
const ok=T.ok;
const O=P.pickOpt({});
const r=(o)=>Object.assign({ jan:'4902370550001', name:'ふつうのゲーム',
  fit:true, rst:'ok', amz:0, buy_qty:0, price:3000, qty:1, gross:800,
  speed:0, speed_ok:false, stock:9, is_game:true, grades:'', no_back:false,
  ship:'クリックポスト' },o);

console.log('=== ① 速さの出し方（shared/mwstat.js）===');
{
  const now=Date.parse('2026-11-16T00:00:00Z');
  const base={ mv_first:'2026-08-01T00:00:00Z', stock:20 };
  const c1=S.calc(Object.assign({},base,{ mv7_down:21, mv_down:90 }),{ now:now });
  console.log('   直近7日 '+JSON.stringify({ speed:c1.speed, src:c1.speedSrc }));
  ok(c1.speed===3&&c1.speedSrc==='week',
     '★★★直近7日に 21点 減っていれば 1日 3点（21 ÷ 7日）');
  const c2=S.calc(Object.assign({},base,{ mv7_down:0, mv_down:107 }),{ now:now });
  console.log('   全期間 '+JSON.stringify({ speed:c2.speed, src:c2.speedSrc }));
  ok(c2.speed>0&&c2.speedSrc==='all',
     '★★★直近7日に減りが無ければ全期間（減った数 ÷ 記録のある日数）');
  const c3=S.calc(Object.assign({},base,{ mv7_down:0, mv_down:0 }),{ now:now });
  console.log('   データなし '+JSON.stringify({ speed:c3.speed,
    src:c3.speedSrc }));
  ok(c3.speed===null&&c3.speedSrc==='',
     '★★★どちらも無ければ null（データなし）。0点ではない');
  const c4=S.calc({ mv_first:'', mv7_down:0, mv_down:0, stock:5 },{ now:now });
  ok(c4.speed===null,'★★記録がはじめから無い行も null');
  const c5=S.calc({ mv_first:new Date(now-3600000).toISOString(),
    mv7_down:3, mv_down:3, stock:5 },{ now:now });
  ok(c5.speed===null,'★★★記録が1日に届かない行も出さない（当てずっぽうにしない）');
}

console.log('\n=== ② 内訳（データなし／本当に0／0より大きい）===');
{
  const rows=[r({ jan:'4902370550001', speed:0, speed_ok:false }),
              r({ jan:'4902370550002', speed:0, speed_ok:false }),
              r({ jan:'4902370550003', speed:0, speed_ok:true }),
              r({ jan:'4902370550004', speed:0.05, speed_ok:true }),
              r({ jan:'4902370550005', speed:3, speed_ok:true }),
              /* 共通の条件で外れる行は数に入れない。 */
              r({ jan:'4902370550006', speed:3, speed_ok:true, fit:false })];
  const m=P.speedMix(rows,O);
  console.log('   '+JSON.stringify(m));
  ok(m.n===5,'★★★会員向きの候補だけを数える（外れる行は入れない）');
  ok(m.none===2,'★★★データなしは「データなし」で数える');
  ok(m.zero===1,'★★★本当に0（減っていない）は別に数える');
  ok(m.pos===2,'★★★0より大きい品も数える');
  ok(m.none+m.zero+m.pos===m.n,'★★内訳の合計は候補の数と同じ');
  /* speed_ok を付けていない古い行は、速さ>0 なら取れていたと見る。 */
  const old=P.speedMix([{ jan:'1', fit:true, rst:'ok', price:1, speed:2 },
    { jan:'2', fit:true, rst:'ok', price:1, speed:0 }],O);
  ok(old.pos===1&&old.none===1,'★★印の無い行でも落ちない');
}

console.log('\n=== ③ 0より大きい品の帯 ===');
{
  ok(JSON.stringify(P.SPEED_BANDS)==='[0.1,0.5,1,2.5]',
     '★★★帯は 0.1／0.5／1／2.5 で切る（カジの確認2）');
  ok(P.speedBand(0.05)===0&&P.speedBand(0.1)===1&&P.speedBand(0.4)===1
     &&P.speedBand(0.5)===2&&P.speedBand(0.9)===2&&P.speedBand(1)===3
     &&P.speedBand(2.4)===3&&P.speedBand(2.5)===4&&P.speedBand(9)===4,
     '★★★境目はその帯の下に入れる（0.1 は「0.1〜0.5」）');
  const rows=[0.05,0.2,0.4,0.7,1.5,2.5,4].map(function(v,i){
    return r({ jan:'490237055010'+i, speed:v, speed_ok:true }); });
  const m=P.speedMix(rows,O);
  console.log('   帯：'+JSON.stringify(m.bands));
  ok(JSON.stringify(m.bands)==='[1,2,1,1,2]',
     '★★★帯ごとの件数（0.1未満1・0.1〜0.5で2・0.5〜1で1・1〜2.5で1・2.5以上2）');
}

console.log('\n=== ④ 下限と対象を変えたときの件数 ===');
{
  const rows=[
    r({ jan:'4902370550001', speed:3, speed_ok:true }),
    r({ jan:'4902370550002', speed:1.2, speed_ok:true }),
    r({ jan:'4902370550003', speed:0.4, speed_ok:true }),
    /* ゲーム以外（クリックポストで送れる） */
    r({ jan:'4902370550004', speed:0.6, speed_ok:true, is_game:false }),
    /* ゲーム以外（箱もの＝クリックポストでは送れない） */
    r({ jan:'4902370550005', speed:2, speed_ok:true, is_game:false,
        ship:'宅配便（60サイズ）' }),
    /* 限定版（モニターは通常版だけ） */
    r({ jan:'4902370550006', speed:3, speed_ok:true, name:'◯◯ 限定版' }),
    /* 出せる数が無い */
    r({ jan:'4902370550007', speed:3, speed_ok:true, qty:0 })];
  ok(P.monCount(rows,O,2.5,false)===1,'★★★いまの下限（2.5点/日）では1件');
  ok(P.monCount(rows,O,1,false)===2,'★★★下限 1点/日 なら2件');
  ok(P.monCount(rows,O,0.3,false)===3,'★★★下限 0.3点/日 なら3件');
  ok(P.monCount(rows,O,2.5,true)===1,
     '★★★広げても、クリックポストで送れない箱ものと限定版は入らない');
  ok(P.monCount(rows,O,0.5,true)===3,
     '★★★広げると、ゲーム以外でもクリックポストで送れる品が入る');
  ok(P.monCount(rows,O,0.3,true)===4,'★★★下限を下げて広げれば4件');
  ok(P.monCount(rows,O,0,false)===3,
     '★★★限定版と「出せる数が無い」行は、下限を 0 にしても入らない');
  const tb=P.monTable(rows,O);
  console.log('   '+JSON.stringify(tb));
  ok(tb.length===4&&tb[0].now===true&&tb[0].min===2.5,
     '★★★表の1行目は「いまの下限」');
  ok(JSON.stringify(tb.map((x)=>x.min))==='[2.5,1,0.5,0.3]',
     '★★★そのあとは 1／0.5／0.3 点/日');
  ok(tb[1].game===2&&tb[1].wide===2&&tb[3].game===3&&tb[3].wide===4,
     '★★★通常版ゲームの件数と、広げた場合の件数を並べる');
  /* ⚙を変えると「いまの下限」も変わる。 */
  const tb2=P.monTable(rows,P.pickOpt({ subMonPeople:10, subMonDays:2 }));
  ok(tb2[0].min===5&&tb2[0].game===0,'★★人数10・2日なら いまの下限は 5点/日');
  ok(P.cpJa()==='クリックポスト',
     '★★送り方の名前は shared/shopcsv.js の1か所から取る');
}

console.log('\n=== ⑤ 数えるだけ（いまの配信の決まりは変えない）===');
{
  const rows=[r({ jan:'4902370550001', speed:0.4, speed_ok:true }),
              r({ jan:'4902370550002', speed:3, speed_ok:true })];
  const d=P.draft(rows,P.list({ subChMonitor:'111' })
    .filter((p)=>p.key==='monitor'),{},[],Date.now());
  ok(d.plans[0].items.length===1&&d.plans[0].items[0].jan==='4902370550002',
     '★★★試算をしても、案に入るのは下限を通る品だけ');
  ok(P.monCount(rows,O,0.3,true)===2,'★試算では2件と出る（数えるだけ）');
}
T.done();
