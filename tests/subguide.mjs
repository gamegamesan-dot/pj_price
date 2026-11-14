/* 決まり：買うかどうかの目安（8.29・カジの依頼・v287）

   せどりが初めての会員でも、カードだけで決められるようにする案内。
   モニター → プレミアムへ進んでもらうためのもので、
   **利益を保証するものではない**（カードにもそう書く）。

   ここで当たること
     ・総合の札（◎ ねらい目／○ ふつう／△ 慎重に）と一言の理由
     ・Amazon 本体がいる行は ◎ にしない
     ・材料が足りない行・データが古い行は「データ確認中」（当てずっぽうを書かない）
     ・出し方（加工した表現だけ／数字も出す）。**既定は加工した表現だけ**
     ・プランごとに出す項目を⚙で選べる（モニターは短く、プレミアムはぜんぶ）
     ・赤字にならない売値の出し方（会員価格＋Amazon の手数料・送料は別）
     ・値動きは pj が控えた値段の記録から出す（Keepa があればそちら）
     ・カードに Keepa のグラフ画像・Amazon の画像を入れない
     ・配ったカードは次の配信で書き換わる（CARD_V が上がっている） */
import { harness, loadWorker, makeEnv, asJson, get, post, wantBinds }
  from './lib.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const G=require('../shared/subguide.js');
const C=require('../shared/subcard.js');
const T=harness('決まり：買うかどうかの目安（8.29）');
const ok=T.ok;
const ROOT=path.resolve(new URL('.',import.meta.url).pathname,'..');
const NOW='2026-11-14T09:00:00.000Z';
/* よく売れて・ライバルが少なくて・利益率が高い行（◎ になるはず）。 */
const GOOD={ rank:12000, rank_cat:'ゲーム', new_n:4, amz:0,
  price:3645, amz_price:5800, fee_total:900, fee_rate:0.15, gross:1255,
  px_min:5200, px_avg:6100, px_days:40, amz_at:'2026-11-14T06:00:00.000Z' };

console.log('=== ① 総合の札 ===');
{
  const b=G.badgeOf(GOOD,{},NOW);
  console.log('   '+G.badgeText(b));
  ok(b.mark==='◎'&&b.name==='ねらい目','★★★よく売れて・ライバルが少なく・利益率が高い行は ◎');
  ok(/よく売れています/.test(b.why)&&/ライバルが少ない/.test(b.why),
     '★★★一言の理由を出す');
  ok(/目安です/.test(b.note)&&/保証するものではありません/.test(b.note),
     '★★★「目安であって利益の保証ではない」と分かる文を付ける');
  const mid=G.badgeOf({ ...GOOD, rank:200000, new_n:20 },{},NOW);
  console.log('   '+G.badgeText(mid));
  ok(mid.mark==='△','★★★売れ行きが悪くライバルが多ければ △');
  const b2=G.badgeOf({ ...GOOD, rank:60000, new_n:12 },{},NOW);
  console.log('   '+G.badgeText(b2));
  ok(b2.mark==='○','★★ふつうの行は ○');
  /* Amazon 本体がいる行は ◎ にしない（勝ちにくい）。 */
  const amz=G.badgeOf({ ...GOOD, amz:1 },{},NOW);
  console.log('   '+G.badgeText(amz));
  ok(amz.mark!=='◎'&&/Amazon 本体/.test(amz.why),
     '★★★Amazon 本体が売っている行は札を下げる');
  /* しきい値は⚙で直せる。 */
  ok(G.badgeOf(GOOD,{ gdRankA:1000, gdRivalA:1, gdRateA:90 },NOW).mark!=='◎',
     '★★★しきい値を⚙で厳しくすると札が下がる');
  ok(G.badgeOf({ ...GOOD, rank:200000, new_n:20 },
               { gdRankB:300000, gdRivalB:30 },NOW).mark==='○',
     '★★★ゆるくすれば上がる');
}

console.log('=== ② 材料が足りない・古いときは札を出さない ===');
{
  const old=G.badgeOf({ ...GOOD, amz_at:'2026-10-01T00:00:00.000Z' },{},NOW);
  console.log('   '+G.badgeText(old));
  ok(old.mark==='—'&&old.name==='データ確認中'&&old.stale===true,
     '★★★データが古い行は「データ確認中」');
  ok(/取り直してから/.test(old.note),'★★なぜ出せないかを書く');
  ok(G.badgeOf({ ...GOOD, amz_at:'' },{},NOW).name==='データ確認中',
     '★★取った時刻が分からない行も「データ確認中」');
  ok(G.badgeOf({ ...GOOD, amz_at:'2026-10-01T00:00:00.000Z' },
               { gdOldDays:0 },NOW).name!=='データ確認中',
     '★⚙を 0 にすると古さを見ない');
  /* 売れ行きもライバルも取れていない行。 */
  const thinR={ price:3645, amz_price:5800, fee_total:900, gross:1255,
                amz_at:NOW };
  const thin=G.badgeOf(thinR,{},NOW);
  ok(!thin.mark&&!thin.ok&&G.badgeText(thin)==='',
     '★★★材料が足りない行は**札そのものを出さない**（当てずっぽうを書かない）');
  ok(G.cardOf(thinR,{},'premium',NOW).badge===null,
     '★★★カードにも札の行を出さない');
  ok(G.cardOf(thinR,{},'premium',NOW).lines.some((x)=>x.name==='ライバル')===false,
     '★取れていない項目も出さない');
  const g=G.cardOf({ ...GOOD, amz_at:'2026-10-01T00:00:00.000Z' },{},
                   'premium',NOW);
  ok(g.lines.length===0,'★★★古い行は数字の行もぜんぶ出さない');
}

console.log('=== ③ 出し方（既定は加工した表現だけ）===');
{
  ok(G.modeOf({})==='word','★★★既定は「加工した表現だけ」');
  ok(G.modeOf({ gdMode:'num' })==='num','★⚙で「数字も出す」に変えられる');
  const w=G.cardOf(GOOD,{},'premium',NOW);
  const n=G.cardOf(GOOD,{ gdMode:'num' },'premium',NOW);
  const wt=w.lines.map((x)=>x.value).join('｜');
  const nt=n.lines.map((x)=>x.value).join('｜');
  console.log('   word: '+wt.slice(0,120));
  console.log('   num : '+nt.slice(0,120));
  ok(!/12,?000位|4人|¥6,100/.test(wt),
     '★★★加工した表現だけのときは、ランキング・出品者数・平均を出さない');
  ok(/よく売れています/.test(wt)&&/ライバルが少ない/.test(wt),
     '★★★言葉では出す');
  ok(/12,000位/.test(nt)&&/4人/.test(nt)&&/¥6,100/.test(nt),
     '★★★「数字も出す」にすると数字が入る');
}

console.log('=== ④ プランごとに出す項目 ===');
{
  const key=(k,o)=>G.cardOf(GOOD,o||{},k,NOW).lines.map((x)=>x.name).join(',');
  console.log('   モニター：'+key('monitor'));
  console.log('   プレミアム：'+key('premium'));
  ok(key('monitor')==='売れ行き','★★★モニターは札と売れ行きだけ');
  ok(G.cardOf(GOOD,{},'monitor',NOW).badge.mark==='◎',
     '★★モニターにも札は出る');
  ok(/値動き/.test(key('premium'))&&/ライバル/.test(key('premium'))
     &&/赤字にならない売値/.test(key('premium'))
     &&/出品できるか/.test(key('premium')),
     '★★★プレミアムはぜんぶ出る');
  ok(key('standard').indexOf('出品できるか')<0,
     '★スタンダードは出品制限の行を出さない（固定メッセージに任せる）');
  ok(key('monitor',{ gdItemsMonitor:'badge,sell,rival' })==='売れ行き,ライバル',
     '★★★⚙でプランごとに変えられる');
  ok(G.cardOf(GOOD,{ gdItemsMonitor:'sell' },'monitor',NOW).badge===null,
     '★★★札そのものを外すこともできる');
  /* 1行の長さ（カードが長くなりすぎないように）。 */
  const L=G.cardOf(GOOD,{ gdMode:'num' },'premium',NOW).lines;
  ok(L.every((x)=>String(x.value).indexOf('\n')<0),
     '★★★1項目1行（改行を入れない）');
}

console.log('=== ⑤ 赤字にならない売値 ===');
{
  /* 会員価格 3,645／いまの売値 5,800／手数料 900（率 15%＝870・固定 30）
     → (3645+30) / (1-0.15) = 4,323.5 → 10円単位で 4,330 */
  const f=G.floorOf(GOOD);
  console.log('   '+f.text);
  ok(f.ok&&f.yen===4330,'★★★会員価格と手数料から、赤字にならない売値を出す');
  ok(/送料は別/.test(f.text),'★★★送料は別と書く');
  ok(f.yen>Math.round(GOOD.price),'★会員価格より高い（当然）');
  /* 率が取れていない行は、手数料ぜんぶを比例とみなす（安全側に高く出る）。 */
  const f2=G.floorOf({ ...GOOD, fee_rate:0 });
  console.log('   率が分からないとき：'+f2.text);
  ok(f2.ok&&f2.yen>f.yen&&f2.yen===4550,
     '★★★率が分からない行は「手数料は安くならない」とみなす（安全側）');
  ok(!G.floorOf({ ...GOOD, fee_total:0 }).ok,
     '★★★手数料が取れていない行は出さない');
  ok(!G.floorOf({ ...GOOD, price:0 }).ok,'★会員価格が無い行は出さない');
}

console.log('=== ⑥ 売れ行きと値動きの出どころ ===');
{
  const s1=G.sellOf({ rank:12000, rank_cat:'ゲーム' },{ gdMode:'num' });
  ok(s1.ok&&/ランキング 12,000位/.test(s1.text),
     '★★★Keepa が無いときは pj のランキングで出す');
  const s2=G.sellOf({ rank:12000, keepa_sales30:45 },{ gdMode:'num' });
  ok(s2.ok&&/月 およそ 45個/.test(s2.text),
     '★★★Keepa の月間販売数があればそれを使う');
  ok(!G.sellOf({},{}).ok,'★★★どちらも無ければ出さない');
  const p1=G.pxOf({ px_min:5200, px_avg:6100, px_days:40, amz_price:5600 },
                  { gdMode:'num' });
  console.log('   '+p1.text);
  ok(p1.ok&&/この 40日/.test(p1.text)&&/安い/.test(p1.text),
     '★★★pj が控えた値段の記録から「平均より安い」を出す');
  const p2=G.pxOf({ keepa_min180:5000, keepa_avg180:6000, amz_price:6400 },
                  { gdMode:'num' });
  ok(p2.ok&&/この 180日/.test(p2.text)&&/高い/.test(p2.text),
     '★★★Keepa があれば180日の統計で出す');
  ok(!G.pxOf({ amz_price:5600 },{}).ok,
     '★★★記録が無ければ値動きの行を出さない');
  ok(/平均どおり/.test(G.pxOf({ px_min:5200, px_avg:6100, px_days:40,
    amz_price:6100 },{}).text),'★平均どおりのときはそう書く');
}

console.log('=== ⑦ カード ===');
{
  const e=C.card({ jan:'4902370550467', name:'【新品】商品A ★', kishu:'NS',
                   qty:2, ...GOOD },
                 { gameG:100, planKey:'premium', guide:{}, now:NOW });
  console.log('   '+e.description);
  ok(/^◎ ねらい目/.test(String(e.description||'')),
     '★★★札は見出しのすぐ下（1行）に出す');
  ok(/目安です/.test(String(e.description||'')),
     '★★★カードに「目安です」と出る');
  const names=e.fields.map((f)=>f.name);
  console.log('   '+names.join(','));
  ok(names.indexOf('売れ行き')>=0&&names.indexOf('値動き')>=0
     &&names.indexOf('ライバル')>=0&&names.indexOf('赤字にならない売値')>=0
     &&names.indexOf('出品できるか')>=0,'★★★6つの項目がカードに出る');
  ok(names.indexOf('見込みの Amazon 粗利')<names.indexOf('売れ行き')
     &&names.indexOf('売れ行き')<names.indexOf('購入できる数'),
     '★★目安は粗利のあと・購入できる数の前');
  const s=JSON.stringify(e);
  ok(!/keepa|graph|\.png|\.jpg|media-amazon|images-amazon/i.test(s),
     '★★★Keepa のグラフ画像・Amazon の画像を入れない');
  ok(!e.image&&!e.thumbnail,'★★画像の欄を使わない');
  const m=C.card({ jan:'4902370550467', name:'商品A', kishu:'NS', qty:2,
                   ...GOOD },{ gameG:100, planKey:'monitor', guide:{},
                               now:NOW });
  ok(m.fields.map((f)=>f.name).indexOf('値動き')<0,
     '★★★モニターのカードは短い（⚙のとおり）');
  /* 8.27（6.195）より新しければよい（次の直しで上げても落ちない）。 */
  ok(parseFloat(C.CARD_V)>6.195,
     '★★★カードの形の版を上げた（配ったカードは次の配信で書き換わる）');
  /* 会員に見せない項目が混ざっていないか（§8.2）。 */
  for(const ng of ['卸値','仕入原価','MW','matchingworld','いろは'])
    ok(s.indexOf(ng)<0,'★★★カードに「'+ng+'」を出さない');
}

console.log('=== ⑧ pj-sync（Worker）===');
{
  const { worker, T:W }=await loadWorker('subguide');
  /* 列があるかを1回だけ調べる（schema.sql には入っている）。 */
  const env=makeEnv({ STAFF_KEY:'s' });
  ok((await W.pxOk(env))===true,
     '★★★値段の記録の列を見つける（migrate-0061）');
  /* 値段の記録（px_*）を足す SQL は、**値を増やさない**（?N が増えない）。 */
  const sql=`UPDATE mw_amz SET price=?2, checked_at=?11${W.pxSet('?2','?11')}
             WHERE jan=?1`;
  ok(W.pxSet('?2','?11')!=='','★pxSet は（列があれば）文を返す');
  ok(wantBinds(sql)===11,
     '★★★値段の記録を足しても渡す値は増えない（?N が増えない）');
  ok(!/\?(?!2\b|11\b|1\b)\d/.test(W.pxSet('?2','?11')),
     '★★★使う ?N は値段と時刻だけ');
  /* ⚙（gd…）だけを拾って渡す。 */
  const g=W.gdOf({ gdMode:'num', gdRankA:'1000', subOn:true, mwSubTiers:'x' });
  ok(g.gdMode==='num'&&g.gdRankA==='1000'
     &&g.subOn===undefined&&g.mwSubTiers===undefined,
     '★★★⚙のうち目安の欄（gd…）だけを渡す');
  ok(W.SUBGUIDE&&typeof W.SUBGUIDE.badgeOf==='function',
     '★★pj-sync も同じ shared/subguide.js を読む');
}

console.log('=== ⑨ 決まりが1か所にあるか ===');
{
  const bare=(f)=>fs.readFileSync(path.join(ROOT,f),'utf8')
    .replace(/\/\*[\s\S]*?\*\//g,' ').replace(/^\s*\/\/.*$/gm,' ');
  const card=bare('shared/subcard.js');
  ok(!/ねらい目|ライバルが少ない|データ確認中/.test(card),
     '★★★subcard.js に目安の言葉を直書きしない');
  ok(/cardOf|badgeText/.test(card),'★カードは subguide を呼ぶ');
  const w=bare('proxy-sync/worker.js');
  ok(!/ねらい目|ライバルが少ない|データ確認中/.test(w),
     '★★★worker.js に目安の言葉を直書きしない');
  const html=bare('index.html');
  ok(/SUBGUIDE\.badgeOf/.test(html)&&/PJ_SUBGUIDE/.test(html),
     '★★画面も同じ判定を使う');
  ok(/gdMode|gdRankA|gdItemsMonitor/.test(html),'★⚙の欄がある');
  const mig=fs.readFileSync(
    path.join(ROOT,'proxy-sync/migrate-0061-amz-px.sql'),'utf8');
  ok(/px_min/.test(mig)&&/px_from/.test(mig),
     '★★★migrate-0061 で値段の記録の列を足す');
  ok(/ALTER TABLE mw_amz/.test(mig)&&!/CREATE TABLE/.test(mig),
     '★★行は増やさない（列だけ足す）');
  const sch=fs.readFileSync(path.join(ROOT,'proxy-sync/schema.sql'),'utf8');
  ok(/px_from/.test(sch),'★schema.sql にも入っている');
  const sw=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
  ok(/shared\/subguide\.js/.test(sw),
     '★★★sw.js にも入れた（画面と一緒に新しくなる）');
}

T.done();
