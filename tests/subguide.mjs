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
     &&/赤字にならない売値/.test(key('premium')),
     '★★★プレミアムはぜんぶ出る');
  /* 8.34：「出品できるか」はどのプランのカードにも出さない。 */
  ok(key('premium').indexOf('出品できるか')<0
     &&key('one_pre').indexOf('出品できるか')<0
     &&key('monitor').indexOf('出品できるか')<0,
     '★★★カードに「出品できるか」の行を出さない（8.34）');
  ok(G.ITEMS.indexOf('limit')<0
     &&G.itemsOf('monitor',{ gdItemsMonitor:'badge,sell,limit' })
         .indexOf('limit')<0,
     '★★★⚙でも「出品できるか」は選べない（8.34）');
  ok(key('monitor',{ gdItemsMonitor:'badge,sell,rival' })==='売れ行き,ライバル',
     '★★★⚙でプランごとに変えられる');
  ok(G.cardOf(GOOD,{ gdItemsMonitor:'sell' },'monitor',NOW).badge===null,
     '★★★札そのものを外すこともできる');
  /* 1行の長さ（カードが長くなりすぎないように）。
     8.37（v296）「赤字にならない売値」だけは**売り方ごとに1行**なので
     改行が入る（ほかの項目は今までどおり1項目1行）。 */
  const L=G.cardOf(GOOD,{ gdMode:'num' },'premium',NOW).lines;
  ok(L.filter((x)=>x.name!=='赤字にならない売値')
      .every((x)=>String(x.value).indexOf('\n')<0),
     '★★★1項目1行（改行を入れない）');
  ok(L.filter((x)=>x.name==='赤字にならない売値')
      .every((x)=>String(x.value).split('\n').length<=5),
     '★★売り方ごとの売値も5行まで（カードが長くなりすぎない）');
}

console.log('=== ⑤ 赤字にならない売値（売り方ごと・8.37）===');
{
  /* 会員価格 3,645／率 15%。送り方が分からないので送料は足さない。
     Amazon 自己配送 … (3645 + 梱包材20) / (1-0.15) = 4,311.8 → 4,320
     メルカリ・ヤフオク … 3645 / (1-0.10) = 4,050 → 4,050 */
  const f=G.floorOf(GOOD);
  console.log('   '+String(f.text).replace(/\n/g,' ／ '));
  ok(f.ok&&f.yen===4320,'★★★会員価格と手数料から、赤字にならない売値を出す');
  ok(/Amazon 自己配送/.test(f.text)&&/メルカリ/.test(f.text)
     &&/ヤフオク/.test(f.text),
     '★★★売り方ごとに出す（既定は Amazon 自己配送・メルカリ・ヤフオク）');
  ok(/送料は別/.test(f.text),
     '★★★送り方が分からない行は送料を足さず「送料は別」と書く');
  ok(f.yen>Math.round(GOOD.price),'★会員価格より高い（当然）');
  /* 送り方が分かる行は、⚙の送料を引いたあとの値段になる。 */
  const f3=G.floorOf(GOOD,{ shipKey:'cp', shipSure:true,
                            shipName:'クリックポスト' });
  console.log('   送り方が分かるとき：'
    +String(f3.text).replace(/\n/g,' ／ '));
  ok(f3.ok&&f3.yen>f.yen,'★★★送料のぶん高くなる');
  ok(/送料 ¥185/.test(f3.text)&&/クリックポスト/.test(f3.text),
     '★★★引いた送料と送り方を書く');
  /* 率が取れていない行は、**Amazon の売り方を出さない**
     （当てずっぽうの額は出さない）。メルカリ・ヤフオクは⚙の率で出せる。 */
  const f2=G.floorOf({ ...GOOD, fee_rate:0 });
  console.log('   率が分からないとき：'
    +String(f2.text).replace(/\n/g,' ／ '));
  ok(f2.ok&&!/Amazon/.test(f2.text)&&/メルカリ/.test(f2.text),
     '★★★Amazon の手数料が取れていない行は、Amazon の売り方を出さない');
  ok(!G.floorOf({ ...GOOD, price:0 }).ok,'★会員価格が無い行は出さない');
  /* ⚙で売り方を選べる。 */
  const f4=G.floorOf(GOOD,{ gdWays:'amz_fba' });
  console.log('   FBA だけ：'+String(f4.text).replace(/\n/g,' ／ '));
  ok(f4.ok&&/Amazon FBA/.test(f4.text)&&!/メルカリ/.test(f4.text),
     '★★★⚙でどの売り方を出すか選べる');
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
     &&names.indexOf('ライバル')>=0&&names.indexOf('赤字にならない売値')>=0,
     '★★★目安の項目がカードに出る');
  ok(names.indexOf('出品できるか')<0
     &&!/アカウントごとに違います/.test(JSON.stringify(e)),
     '★★★カードに「出品できるか」の注意を入れない（8.34）');
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
  /* 8.29（6.196）より新しければよい（次の直しで上げても落ちない）。 */
  ok(parseFloat(C.CARD_V)>6.196,
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

console.log('=== ⑩ 読み方の固定メッセージ（8.30）===');
{
  const PLANS=[{ key:'monitor', name:'モニター', n:10, q:1, on:true },
               { key:'premium', name:'プレミアム', n:100, q:5, on:false }];
  const c=G.pinCommon({},PLANS);
  console.log('   共通 '+c.length+'字');
  ok(/はじめに/.test(c)&&/読み方/.test(c),'★★★共通の文は「はじめに」用');
  ok(/◎ ねらい目/.test(c)&&/○ ふつう/.test(c)&&/△ 慎重に/.test(c)
     &&/— データ確認中/.test(c),'★★★札の意味をぜんぶ書く');
  ok(/目安です/.test(c)&&/保証するものではありません/.test(c),
     '★★★「目安です。利益を保証するものではありません」を書く');
  ok(/アカウントごとに違います/.test(c),
     '★★★出品できるかの注意は必ず入れる');
  ok(/月曜/.test(c)&&/火曜/.test(c),'★★★締めと発送の曜日を書く（既定）');
  const c2=G.pinCommon({ gdCloseDay:'金', gdShipDay:'土' },PLANS);
  ok(/金曜/.test(c2)&&/土曜/.test(c2)&&!/月曜/.test(c2),
     '★★★曜日は⚙の値から出す');
  ok(/商品ごと/.test(c)&&/お会計で確定/.test(c),
     '★★★送料の考え方（区分は商品ごと・金額はお会計）を書く');
  /* プランで出ない項目には「（◯◯プラン以上）」を付ける。 */
  ok(/\*\*値動き\*\*（スタンダードプラン以上）/.test(c),
     '★★★出ないプランがある項目に「（◯◯プラン以上）」を付ける');
  ok(/\*\*ライバル\*\*（ライトプラン以上）/.test(c),'★★ライバルも同じ');
  ok(/\*\*売れ行き\*\*\s*…/.test(c),
     '★★★いちばん下のプランにも出る項目には付けない');
  ok(G.planFirst('px',{})==='standard'&&G.planFirst('sell',{})==='monitor',
     '★★項目を出すいちばん下のプランを⚙から出す');
  /* どのプランにも出していない項目は**書かない**。 */
  const none=G.pinCommon({ gdItemsMonitor:'badge', gdItemsLight:'badge',
    gdItemsStandard:'badge', gdItemsPremium:'badge' },PLANS);
  /* 札の説明には「売れ行き・ライバル・利益率から付けています」と出る
     （札の作り方そのもの）。**項目の行**が出ないことを見る。 */
  ok(!/\*\*値動き\*\*/.test(none)&&!/\*\*ライバル\*\*/.test(none)
     &&!/\*\*赤字にならない売値\*\*/.test(none)
     &&!/カードの項目/.test(none),
     '★★★出していない項目は共通の文にも書かない');
  ok(/アカウントごとに違います/.test(none),
     '★★★それでも出品できるかの注意は入れる');
  ok(/◎ ねらい目/.test(none),'★札だけでも説明は出る');
  /* 持っていないデータ・仕入れ先のことは書かない。 */
  for(const ng of ['Keepa','keepa','卸値','仕入原価','MW','matchingworld',
                   'いろは'])
    ok(c.indexOf(ng)<0,'★★★共通の文に「'+ng+'」を書かない');
  ok(!/月間の販売数|月 およそ/.test(c),
     '★★★持っていないデータ（月間の販売数）の説明は書かない');
}
{
  /* チャンネルごとの短い文（2〜3行）。 */
  const m=G.pinPlan('monitor',{},{ name:'モニター', n:10, q:1 });
  console.log('   '+m.replace(/\n/g,' / '));
  const lines=m.split('\n');
  ok(lines.length<=3,'★★★チャンネルごとの文は3行まで');
  ok(/モニターの商品リスト/.test(m),'★★どのプランの部屋か分かる');
  ok(/総合の札・売れ行き/.test(m),
     '★★★そのプランのカードに出る項目を書く');
  ok(/お一人 1点まで/.test(m)&&/1回 10件まで/.test(m),
     '★★★プランごとの決まり（1人あたりの点数・1回の件数）を書く');
  ok(/読み方と\*\*出品できるかの注意\*\*は #はじめに をご覧ください/.test(m),
     '★★★「読み方と出品できるかの注意は #はじめに」と書く（8.34）');
  ok(/目安です/.test(m),'★★短い文にも「目安です」を入れる');
  ok(!/値動き|赤字にならない売値/.test(m),
     '★★★そのプランに出ない項目は書かない');
  /* 8.43（v302）モニターの短い文には「毎週 新しく◯件・◯日で締め切り」。 */
  const mo=G.pinPlan('monitor',{},{ name:'モニター', n:10, q:1,
    mon:{ n:5, days:7 } });
  console.log('   '+mo.replace(/\n/g,' / '));
  ok(mo.split('\n').length<=4,'★★モニターの文は4行まで');
  ok(/お試しの3週間/.test(mo),'★★★モニターは「お試しの3週間」と書く');
  ok(/毎週 \*\*新しく 5件\*\*/.test(mo),
     '★★★毎週 新しく出す件数（⚙）を書く');
  ok(/出してから 7日\*\*で締め切ります/.test(mo),
     '★★★購入期限（⚙）を書く');
  ok(/受付終了/.test(mo),'★★期限を過ぎたカードがどうなるかも書く');
  ok(!/1回 10件まで/.test(mo),
     '★★★モニターは「1回◯件まで」ではなく「毎週 新しく◯件」');
  ok(!/\d{13}|¥/.test(mo),'★★★商品名・JAN・値段は書かない');
  const p=G.pinPlan('premium',{},{ name:'プレミアム', n:100, q:5 });
  ok(/値動き/.test(p)&&/赤字にならない売値/.test(p),
     '★★プレミアムの文には出る項目がぜんぶ入る');
  /* #はじめに の指し方（名前／チャンネルID）。 */
  ok(G.pinRef({})==='#はじめに','★★既定は #はじめに');
  ok(G.pinRef({ gdPinCh:'案内' })==='#案内',
     '★★★⚙でチャンネル名を変えられる');
  ok(G.pinRef({ gdPinCh:'#案内' })==='#案内','★# を付けて入れてもよい');
  ok(G.pinRef({ gdPinCh:'123456789012345' })==='<#123456789012345>',
     '★★★チャンネルID を入れたら <#ID> のリンクにする');
  ok(/<#123456789012345>/.test(
    G.pinPlan('monitor',{ gdPinCh:'123456789012345' },{ q:1 })),
     '★★★短い文の中もリンクになる');
}
{
  /* Discord の1通（2,000字）で分ける。 */
  const long=Array.from({ length:200 },(x,i)=>'・'+i+'行目の説明です').join('\n');
  const parts=G.pinSplit(long);
  console.log('   '+long.length+'字 → '+parts.length+'通');
  ok(parts.length>1,'★★★2,000字を超えたら分ける');
  ok(parts.every((x)=>x.length<=G.PIN_MAX),'★★★どの通も 1,900字以内');
  ok(parts.join('\n')===long,'★★★分けても中身は変わらない');
  ok(parts.every((x)=>!/^\s|\s$/.test(x)),'★行の切れ目で分ける');
  ok(G.pinSplit(G.pinCommon({},[])).length===1,
     '★共通の文はいまのところ1通に収まる');
  /* 指紋（貼り直しが要るか）。 */
  const h1=G.hashOf(G.pinCommon({},[]));
  const h2=G.hashOf(G.pinCommon({ gdCloseDay:'金' },[]));
  ok(h1!==h2,'★★★⚙を変えると指紋が変わる（貼り直しが分かる）');
  ok(h1===G.hashOf(G.pinCommon({},[])),'★同じ文なら同じ指紋');
}

T.done();
