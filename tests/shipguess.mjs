/* 決まり：採寸が無い品の送り方と重さの目安（8.49・shared/shipguess.js）

   Amazon に採寸が無い品（グッズはほとんど）は送り方が決められず、会員に
   出せていなかった。**商品名の言葉**から種類を見分けて既定を当てる。

   ・当てた値は「**目安**」（はっきり決まったことにはしない）
   ・**迷う種類は大きめの区分**に寄せ、**重さは必ず入れる**
   ・「**分からない**」に当てた品は案に印（自動では出さない）
   ・⚙「**出さない種類（言葉）**」（既定：ポスター）は案にも配信にも入れない
   ・カジの直し（2026-11-16）：ポスターは扱わない／タペストリーは
     宅配便（80）で、「スリム」「ミニ」だけクリックポスト200g */
import { harness } from './lib.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const G=require('../shared/shipguess.js');
const S=require('../shared/shopcsv.js');
const T=harness('決まり：採寸が無い品の送り方の目安（8.49）');
const ok=T.ok;
const g=(n,o)=>G.guessOf({ name:n },o||{});

console.log('=== ① 種類の表（たたき台）===');
{
  const t=['缶バッジ','アクリルスタンド','クリアファイル','キーホルダー',
    '色紙','ぬいぐるみ','フィギュア','BOX'].map((n)=>n+':'
    +g(n+' ◯◯').way+'/'+g(n+' ◯◯').g);
  console.log('   '+t.join(' '));
  ok(g('推しの缶バッジ').way==='cp'&&g('推しの缶バッジ').g===50,
     '★★★缶バッジ＝クリックポスト 50g');
  ok(g('アクスタ 第2弾').way==='cp'&&g('アクスタ 第2弾').g===120,
     '★★★アクスタ＝クリックポスト 120g');
  ok(g('クリアファイル A4').g===60,'★★クリアファイル 60g');
  ok(g('ラバーストラップ 全3種').way==='cp'
     &&g('ラバーストラップ 全3種').g===60,
     '★★キーホルダー・ラバスト＝クリックポスト 60g');
  ok(g('色紙 直筆サイン').g===80,'★★色紙・ブロマイド 80g');
  ok(g('ぬいぐるみ S').way==='compact'&&g('ぬいぐるみ S').g===400,
     '★★★ぬいぐるみ＝宅急便コンパクト 400g');
  ok(g('ねんどろいど ◯◯').way==='box60'&&g('ねんどろいど ◯◯').g===900,
     '★★★フィギュア＝宅配便（60）900g');
  ok(g('コンプリートBOX').way==='box80'&&g('コンプリートBOX').g===1500,
     '★★★BOX・セット＝宅配便（80）1,500g');
  ok(G.KINDS.every((k)=>k.g>0),
     '★★★どの種類にも重さの既定が入っている（Shopify は重さで送料を決める）');
  ok(G.KINDS.every((k)=>!!S.wayOf(k.way)),
     '★★送り方は shared/shopcsv.js の表の key を使う');
}

console.log('\n=== ② カジの直し：タペストリー ===');
{
  const big=g('B2 タペストリー 描き下ろし');
  const slim=g('スリムタペストリー ◯◯');
  const mini=g('ミニタペストリー ◯◯');
  console.log('   '+JSON.stringify({ big:big.way+'/'+big.g,
    slim:slim.way+'/'+slim.g, mini:mini.way+'/'+mini.g }));
  ok(big.way==='box80'&&big.g===700,
     '★★★タペストリーの既定は宅配便（80）（B2 は丸めても34cmを超える）');
  ok(slim.way==='cp'&&slim.g===200,
     '★★★「スリム」だけクリックポスト 200g');
  ok(mini.way==='cp'&&mini.g===200,'★★★「ミニ」も同じ');
  ok(/スリム/.test(slim.kind)&&/タペストリー/.test(slim.kind),
     '★★種類の名前にも「スリム」と出す');
}

console.log('\n=== ③ カジの直し：ポスターは扱わない ===');
{
  ok(G.NG.join(',')==='ポスター','★★★既定の「出さない種類」はポスター');
  ok(G.ngOf('描き下ろし ポスター 2枚',{})==='ポスター',
     '★★★商品名に「ポスター」が入れば当たる');
  ok(g('◯◯ ポスター').ng==='ポスター'&&g('◯◯ ポスター').way==='',
     '★★★出さない種類には送り方を当てない');
  ok(G.ngOf('缶バッジ',{})==='','★ほかの品は当たらない');
  ok(G.ngOf('◯◯ 下敷き',{ sgNg:'ポスター、下敷き' })==='下敷き',
     '★★★⚙で言葉を足せる（読点・カンマ・改行で区切る）');
  ok(G.ngOf('◯◯ ポスター',{ sgNg:'' })==='',
     '★★⚙を空にすれば外さない');
}

console.log('\n=== ④ 分からない品は大きめに寄せる ===');
{
  const u=g('謎のグッズ 2025');
  console.log('   '+JSON.stringify(u));
  ok(u.unknown===true,'★★★当たる種類が無ければ「分からない」');
  ok(u.way==='box60'&&u.g===800,
     '★★★分からない品の既定は宅配便（60）800g（大きめに寄せる）');
  ok(u.kind==='分からない','★★案に出す名前も「分からない」');
  const c=g('謎のグッズ',{ sgUnknownWay:'cp', sgUnknownG:150 });
  ok(c.way==='cp'&&c.g===150,'★★★⚙で分からない品の既定を変えられる');
  ok(g('謎のグッズ',{ sgOn:false }).unknown===true,
     '★★⚙を切っても「分からない」は返す（画面が出さないだけ）');
  ok(g('缶バッジ',{ sgOn:false }).unknown===true,
     '★★★⚙を切れば種類を当てない（今までどおり未確認）');
}

console.log('\n=== ⑤ ⚙で種類を足す・上書きする ===');
{
  const a=g('ドラマCD 第1巻',{ sgTable:'ドラマCD=クリックポスト,120' });
  console.log('   '+JSON.stringify(a));
  ok(a.way==='cp'&&a.g===120&&a.kind==='ドラマCD',
     '★★★⚙の行（言葉=送り方,重さ）で種類を足せる');
  const b=g('推しの缶バッジ',{ sgTable:'缶バッジ=宅配便（60サイズ）,300' });
  ok(b.way==='box60'&&b.g===300,
     '★★★同じ言葉を書けば、はじめからの種類を上書きできる');
  ok(G.rows('# これはコメント\nドラマCD=クリックポスト,120').length===1,
     '★★# で始まる行は読まない');
  ok(G.rows('こわれた行').length===0&&G.rows('x=なぞの送り方,1').length===0,
     '★形が違う行・知らない送り方は読まない（落ちない）');
}

console.log('\n=== ⑥ 採寸が取れていない理由 ===');
{
  const d=(o)=>G.dimWhy(o);
  ok(d({ size_long:20, size_wid:15, size_hei:2 })==='',
     '★★★3辺そろっていれば内訳に入れない');
  ok(d({ asin:'B0', checked_at:'2026-11-16' })==='all',
     '★★★調べたのに採寸が無い行は「採寸が丸ごと無い」');
  ok(d({ asin:'B0', checked_at:'x', size_long:20 })==='part',
     '★★★1〜2辺だけある行は「3辺そろっていない」');
  ok(d({ asin:'B0', checked_at:'x', size_g:110 })==='g',
     '★★★重さだけある行');
  ok(d({})==='none','★★★まだ Amazon を調べていない行');
  ok(/調べていない/.test(G.WHY_JA.none)&&/3辺/.test(G.WHY_JA.part),
     '★★理由の言い方も1か所に持つ');
}

console.log('\n=== ⑦ 一覧ぶんの内訳 ===');
{
  const list=[
    { name:'推しの缶バッジ', asin:'B0', checked_at:'x' },
    { name:'アクスタ', asin:'B0', checked_at:'x' },
    { name:'謎のグッズ', asin:'B0', checked_at:'x' },
    { name:'◯◯ ポスター', asin:'B0', checked_at:'x' },
    /* 採寸がある品は内訳に入らない。 */
    { name:'ゲームソフト', size_long:17, size_wid:13, size_hei:1 }];
  const sm=G.sumOf(list,{});
  console.log('   '+JSON.stringify(sm));
  ok(sm.n===3,'★★★採寸が無い品だけを数える（ポスターは別に数える）');
  ok(sm.ng===1&&sm.ngWords['ポスター']===1,
     '★★★出さない種類で外した件数も返す');
  ok(sm.unknown===1,'★★★「分からない」に当てた件数');
  ok(sm.kinds['缶バッジ']===1&&sm.kinds['分からない']===1,
     '★★★種類ごとの件数');
  ok(sm.ways['クリックポスト']===2&&sm.ways['宅配便（60サイズ）']===1,
     '★★★既定を当てたときの送り方の件数');
  ok(sm.why.all===3,'★★理由ごとの件数');
}
T.done();
