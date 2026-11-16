/* 決まり：Amazon の順位から売れ行きを見積もる（8.47・shared/rankspd.js）

   カジの実感（2026-11-16）「ゲームは3万位で3か月に2〜3個」。
   前のたたき台（3万位で18個）は甘すぎたので、次の表にした。
     〜1,000位 270／〜5,000位 30／〜10,000位 11／〜30,000位 2.5／
     〜50,000位 1／それより下・順位なしは**推定しない**
   ・単位は**3か月の個数**（Keepa の既定が3か月。中では 個÷90日）
   ・係数 ゲーム×1.0／フィギュア×0.5／その他×0.3・上限 3か月270個
   ・**MW の在庫の減りがある品はそちらが先**（推定は足りない分だけ）
   ・順位は**平均**で見る（1回ぶんだけの品は印）
   ・カードに出すのは「早い／ふつう／ゆっくり」の**言葉だけ** */
import { harness } from './lib.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const R=require('../shared/rankspd.js');
const T=harness('決まり：順位からの売れ行きの推定（8.47）');
const ok=T.ok;
const O={};

console.log('=== ① 換算表（3か月の個数）===');
{
  console.log('   '+[500,1000,3000,5000,9000,10000,20000,30000,45000,50000,
    60000].map((r)=>r+'位:'+R.q3Of(r,'ゲーム',O)).join(' '));
  ok(R.q3Of(1000,'ゲーム',O)===270&&R.q3Of(500,'ゲーム',O)===270,
     '★★★〜1,000位は3か月270個');
  ok(R.q3Of(5000,'ゲーム',O)===30&&R.q3Of(3000,'ゲーム',O)===30,
     '★★★〜5,000位は30個');
  ok(R.q3Of(10000,'ゲーム',O)===11,'★★★〜10,000位は11個');
  ok(R.q3Of(30000,'ゲーム',O)===2.5&&R.q3Of(20000,'ゲーム',O)===2.5,
     '★★★〜30,000位は2.5個（カジの実感：3万位で3か月に2〜3個）');
  ok(R.q3Of(50000,'ゲーム',O)===1,'★★★〜50,000位は1個');
  ok(R.q3Of(50001,'ゲーム',O)===null&&R.q3Of(90000,'ゲーム',O)===null,
     '★★★50,000位より下は推定しない（候補に入れない）');
  ok(R.q3Of(0,'ゲーム',O)===null&&R.q3Of('','ゲーム',O)===null,
     '★★★順位が無い品も推定しない');
  ok(R.q3Of(20000,'フィギュア',O)===1.25,
     '★★★フィギュアは係数 ×0.5');
  ok(R.q3Of(20000,'その他',O)===0.75,'★★★その他は係数 ×0.3');
  ok(R.q3Of(20000,'',O)===0.75,'★★ジャンルが分からない品は「その他」の係数');
  ok(R.q3Of(500,'ゲーム',{ rsCap:30 })===30,'★★★上限（⚙）で止める');
  ok(R.q3Of(20000,'ゲーム',{ rsB4:5 })===5,'★★★⚙で帯の数字を直せる');
  ok(R.q3Of(20000,'ゲーム',{ rsGame:2 })===5,'★★⚙で係数も直せる');
}

console.log('\n=== ② 3か月の個数 ↔ 1日あたり ===');
{
  ok(R.DAYS===90,'★★「3か月」は90日とみなす');
  ok(R.perDay(90)===1,'★★★90個/3か月＝1日1個');
  ok(Math.round(R.toQ3(0.3)*10)/10===27,'★★★1日0.3個＝3か月27個');
  ok(R.toQ3(R.perDay(45))===45,'★行きも帰りも同じ数');
}

console.log('\n=== ③ MW の減りが先・足りない分を推定で ===');
{
  const mw=R.estOf({ speed:0.3, speed_ok:true, rank:30000, genre:'ゲーム' },O);
  console.log('   MW あり '+JSON.stringify(mw));
  ok(mw.src==='mw'&&Math.round(mw.q3)===27,
     '★★★MW の減りがある品は MW の数字を使う（推定にしない）');
  ok(mw.est===2.5,'★★推定の数字も返す（画面で比べられる）');
  const am=R.estOf({ speed:0, speed_ok:false, rank:30000, genre:'ゲーム' },O);
  console.log('   MW なし '+JSON.stringify(am));
  ok(am.src==='amz'&&am.q3===2.5,'★★★MW の減りが無い品は推定を使う');
  ok(Math.round(am.day*10000)/10000===0.0278,'★★1日あたりにも直す');
  const no=R.estOf({ speed:0, speed_ok:false, rank:90000, genre:'ゲーム' },O);
  ok(no.src===''&&no.q3===0,'★★★どちらも出ない品は空（候補に入れない）');
  const off=R.estOf({ speed:0, speed_ok:false, rank:30000, genre:'ゲーム' },
    { rsOn:false });
  ok(off.src===''&&off.est===0,'★★★⚙を切れば推定を使わない');
}

console.log('\n=== ④ 順位は平均で見る（1回ぶんは印）===');
{
  const a=R.estOf({ speed:0, speed_ok:false, rank:45000, rank_avg:9000,
    rank_n:5, genre:'ゲーム' },O);
  console.log('   '+JSON.stringify(a));
  ok(a.rank===9000&&a.q3===11,
     '★★★控えがあれば**平均の順位**で推定する（1回の順位はぶれる）');
  ok(a.one===false,'★★2回以上の記録があれば印は付かない');
  const b=R.estOf({ speed:0, speed_ok:false, rank:45000, rank_n:1,
    genre:'ゲーム' },O);
  ok(b.rank===45000&&b.one===true,
     '★★★記録が1回ぶんだけの品は印を付ける（画面に出す）');
  const c=R.estOf({ speed:0, speed_ok:false, rank:45000, genre:'ゲーム' },O);
  ok(c.one===true,'★★記録が無い品（migrate を流す前）も印を付ける');
}

console.log('\n=== ⑤ カードに出す言葉（数字は出さない）===');
{
  ok(R.jaOf(30,O)===R.JA_FAST&&R.jaOf(100,O)===R.JA_FAST,
     '★★★3か月30個以上は「早い」');
  ok(R.jaOf(10,O)===R.JA_MID&&R.jaOf(29,O)===R.JA_MID,
     '★★★10〜30個は「ふつう」');
  ok(R.jaOf(9,O)===R.JA_SLOW&&R.jaOf(1,O)===R.JA_SLOW,
     '★★★10個未満は「ゆっくり」');
  ok(/数か月かかることがあります/.test(R.JA_SLOW),
     '★★★「ゆっくり」には「数か月かかることがあります」を添える');
  ok(R.jaOf(0,O)===''&&R.jaOf(null,O)==='',
     '★★★出ない品は言葉も出さない（当てずっぽうを書かない）');
  ok(!/個|位|\d/.test(R.JA_FAST+R.JA_MID+R.JA_SLOW),
     '★★★言葉に数字は入れない（会員のカードに推定の数字を出さない）');
  ok(R.jaOf(20,{ rsFast:15 })===R.JA_FAST,'★★⚙で境目を直せる');
}

console.log('\n=== ⑥ MW の減りとの比べ（参考）===');
{
  const rows=[
    { jan:'1', speed:0.3, speed_ok:true, rank:30000, genre:'ゲーム' },
    { jan:'2', speed:0.1, speed_ok:true, rank:10000, genre:'ゲーム' },
    /* MW の減りが無い品・推定が出ない品は比べに入れない。 */
    { jan:'3', speed:0, speed_ok:false, rank:10000, genre:'ゲーム' },
    { jan:'4', speed:0.5, speed_ok:true, rank:90000, genre:'ゲーム' }];
  const c=R.compare(rows,O);
  console.log('   '+JSON.stringify({ n:c.n, ratio:c.ratio }));
  ok(c.n===2,'★★★両方ある品だけを比べる');
  ok(c.ratio>0,'★★★実測 ÷ 推定 の中央値を返す');
  ok(c.both.every((x)=>x.mw>0&&x.est>0),'★中身（JAN・実測・推定）も返す');
  ok(R.compare([],O).n===0&&R.compare([],O).ratio===0,
     '★★両方ある品が無ければ 0（画面は「まだありません」と出す）');
}

console.log('\n=== ⑦ 出どころの言い方（画面だけ）===');
{
  ok(R.srcJa('mw')==='MW の減り'&&R.srcJa('amz')==='Amazon の推定'
     &&R.srcJa('')==='—','★★★出どころを画面に出せる言い方で返す');
}
T.done();
