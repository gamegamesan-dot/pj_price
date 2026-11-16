/* 決まり：会員チャンネルの「今週の一覧（目次）」（8.46・shared/subindex.js）

   ・1品1行：総合の札・商品名（短く）・仕入れ値・見込みの粗利・残り数・
     そのカードへのリンク
   ・カテゴリ別（ゲーム／フィギュア／グッズ／その他／1点もの）の見出し
   ・並びは **札の良い順（◎→○→△→—）→ 粗利の大きい順**
   ・受付終了・完売・残り0・カードが消えた品は出さない
   ・Discord の上限（embed 4,096字／1通 10 embed・6,000字）で分ける
   ・会員に見せない項目（§8.2）は1つも出さない。CSV では配らない */
import { harness } from './lib.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const X=require('../shared/subindex.js');
const G=require('../shared/subguide.js');
const T=harness('決まり：会員チャンネルの一覧（8.46）');
const ok=T.ok;
const CH='2222222222', GU='555000555';
const row=(o)=>Object.assign({ jan:'4902370550001', name:'ゲームA',
  kishu:'NS', price:3645, gross:1200, left:2, msg_id:'900001', mark:'◎',
  off_at:'', sold_out:0 },o);
const opt={ guild:GU };

console.log('=== ① 1品1行の形 ===');
{
  const t=X.lineOf(row({}),opt,CH);
  console.log('   '+t);
  ok(/^◎ /.test(t),'★★★総合の札から始める');
  ok(/\*\*ゲームA\*\*/.test(t),'★★商品名を太字で出す');
  ok(/¥3,645/.test(t),'★★★仕入れ値（会員が払う額）');
  ok(/粗利 ¥1,200/.test(t),'★★★見込みの粗利');
  ok(/残り2/.test(t),'★★★残り数');
  ok(t.indexOf('[カード](https://discord.com/channels/'+GU+'/'+CH
     +'/900001)')>=0,'★★★そのカードへのリンク');
  ok(!/卸値|仕入原価|matchingworld|いろは/.test(t),
     '★★★卸値・仕入原価・MW のことは入らない（8.2）');
  /* 粗利が取れていない行は粗利の欄を出さない（当てずっぽうを出さない）。 */
  ok(!/粗利/.test(X.lineOf(row({ gross:0 }),opt,CH)),
     '★★粗利が無い行は粗利を書かない');
  /* ⚙で仕入れ値と粗利を外せる（画面を撮られたときに備えて）。 */
  const q=X.lineOf(row({}),{ guild:GU, gdIdxYen:false },CH);
  ok(!/¥/.test(q)&&/残り2/.test(q)&&/\[カード\]/.test(q),
     '★★★⚙で値段と粗利を外せる（札・名前・残り・リンクだけ）');
  /* 長い名前は切る（⚙ gdIdxName・既定28字）。 */
  const long=X.lineOf(row({ name:'あ'.repeat(40) }),opt,CH);
  ok(/…/.test(long)&&long.indexOf('あ'.repeat(28))<0,
     '★★★長い名前は28字で切って「…」を付ける');
  ok(/あ{40}/.test(X.lineOf(row({ name:'あ'.repeat(40) }),
     { guild:GU, gdIdxName:60 },CH)),'★★⚙で字数を変えられる');
  /* リンクが作れないときは行だけ出す（空のリンクを出さない）。 */
  ok(!/\[カード\]/.test(X.lineOf(row({}),{ guild:'' },CH)),
     '★サーバーID が分からないときはリンクを出さない');
}

console.log('\n=== ② 一覧に出す品／出さない品 ===');
{
  ok(X.liveOf(row({}))===true,'★いま買える品は出す');
  ok(X.liveOf(row({ off_at:'2026-11-16T00:00:00Z' }))===false,
     '★★★受付終了の品は出さない');
  ok(X.liveOf(row({ sold_out:1 }))===false,'★★★完売の品は出さない');
  ok(X.liveOf(row({ left:0 }))===false,'★★★残り0の品は出さない');
  ok(X.liveOf(row({ msg_id:'' }))===false,
     '★★★カードが消えた品（控えが空）は出さない');
}

console.log('\n=== ③ カテゴリと並び ===');
{
  const rows=[row({ jan:'4902370550001', mark:'△', gross:3000 }),
              row({ jan:'4902370550002', mark:'◎', gross:800 }),
              row({ jan:'4902370550003', mark:'○', gross:2000 }),
              row({ jan:'4902370550004', mark:'◎', gross:1500 }),
              /* フィギュア（機種が無い＝ゲームではない） */
              row({ jan:'4902370550005', kishu:'', name:'フィギュアB',
                    genre:'フィギュア', mark:'○', gross:900 }),
              /* 1点もの（jan が one-…） */
              row({ jan:'one-12', name:'目玉商品C', mark:'', gross:5000 })];
  const g=X.groupsOf(rows,opt);
  console.log('   '+JSON.stringify(g.map((x)=>x.cat+':'+x.rows.length)));
  ok(g[0].cat==='ゲーム','★★★カテゴリの順は⚙のとおり（既定はゲームが先）');
  ok(g[1].cat==='フィギュア','★★ジャンルは機種から決まる（mwfee の genreOf）');
  ok(g[g.length-1].cat===X.ONE_JA,'★★★1点ものはいちばん後ろ');
  ok(g.filter((x)=>x.cat===X.ONE_JA)[0].rows.length===1,
     '★★1点もの（one-…）は別のカテゴリにする');
  const ja=g[0].rows.map((x)=>x.mark+Math.round(x.gross));
  console.log('   '+JSON.stringify(ja));
  ok(ja[0]==='◎1500'&&ja[1]==='◎800',
     '★★★札の良い順（◎が先）→ そのなかで粗利の大きい順');
  ok(ja[2]==='○2000'&&ja[3]==='△3000',
     '★★★粗利が大きくても札が下なら後ろ');
  ok(X.markRank('◎')<X.markRank('○')&&X.markRank('○')<X.markRank('△')
     &&X.markRank('△')<X.markRank(G.MARKS.x.mark),
     '★★★札の順は shared/subguide.js の表から取る');
  /* ⚙でカテゴリの順を変えられる。 */
  const g2=X.groupsOf(rows,{ guild:GU, gdIdxCats:'フィギュア,ゲーム' });
  ok(g2[0].cat==='フィギュア','★★★⚙でカテゴリの順を変えられる');
  ok(g2.filter((x)=>x.cat===X.ONE_JA).length===1,
     '★★⚙に書かなかったカテゴリも落とさない');
}

console.log('\n=== ④ Discord の上限で分ける ===');
{
  ok(X.EMBED_MAX===4096&&X.EMBED_N===10&&X.MSG_MAX<=6000,
     '★★★上限（embed 4,096字・1通 10個・6,000字）');
  const many=[];
  for(let i=0;i<60;i++)many.push(row({ jan:'49023705510'+String(10+i),
    name:'あ'.repeat(58), msg_id:'91000'+i, gross:1000+i }));
  const p1=X.pagesOf(many,{ guild:GU, gdIdxName:60 },CH);
  console.log('   ページ '+p1.length+'／1ページめの embed '
    +p1[0].embeds.length+'／字数 '+p1[0].embeds[0].description.length);
  ok(p1.length>=2,'★★★1通に入らなければページを分ける');
  ok(p1[0].embeds.every((e)=>e.description.length<=X.EMBED_MAX),
     '★★★embed は 4,096字を超えない');
  ok(p1.every((pg)=>pg.embeds.length<=X.EMBED_N),
     '★★★1通の embed は10個まで');
  ok(p1.every((pg)=>pg.embeds.reduce((a,e)=>a+e.description.length
     +e.title.length,0)<=X.MSG_MAX),'★★★1通の字数も上限の中');
  ok(/今週の一覧（1\/2）/.test(p1[0].title)
     &&/今週の一覧（2\/2）/.test(p1[1].title),
     '★★★見出しに「1/2」「2/2」を入れる');
  ok(/ゲーム（60件/.test(p1[0].embeds[0].title),
     '★★カテゴリの見出しに件数（分けたときは 1/2 も）');
  const one=X.pagesOf([row({})],opt,CH);
  ok(one[0].title==='今週の一覧'&&one.length===1,
     '★★1通で足りるときは「（1/1）」を付けない');
  ok(X.pagesOf([],opt,CH).length===0,'★出す品が無ければページも無い');
  /* 余ったページの文（消さずにこれに書き換える）。 */
  const e=X.emptyPage(1,2);
  ok(/今週の一覧（2\/2）/.test(e.title)
     &&/このページは空です/.test(e.embeds[0].title),
     '★★★余ったページは「（このページは空です）」にする');
}

console.log('\n=== ⑤ 週の短い知らせ（B）===');
{
  const rows=[row({ jan:'4902370550001', is_new:true, mark:'◎' }),
              row({ jan:'4902370550002', is_new:true, mark:'○' }),
              row({ jan:'4902370550003', is_new:false })];
  const t=X.weekText(rows,opt,CH,'900999',10);
  console.log('   '+t.replace(/\n/g,' ／ '));
  ok(/今週の新着 2件/.test(t),'★★★その回に新しく出た件数だけ数える');
  ok(t.split('\n').length===4,'★★★新しい品の行＋一覧へのリンク');
  ok(t.indexOf('https://discord.com/channels/'+GU+'/'+CH+'/900999')>=0,
     '★★★固定の一覧へのリンクを入れる');
  const t2=X.weekText(rows,opt,CH,'900999',1);
  ok(/ほか 1件/.test(t2),'★★★行数の上限を超えたぶんは「ほか◯件」');
  ok(X.weekText(rows,opt,CH,'900999',10).length<=1900,
     '★Discord の1通（2,000字）に入る');
  ok(!/@everyone|@here/.test(t),'★★★@everyone・@here は使わない');
}

console.log('\n=== ⑥ 同じ中身なら書き換えない（指紋）===');
{
  const a=X.pagesOf([row({})],opt,CH);
  const b=X.pagesOf([row({})],opt,CH);
  ok(X.hashOf(a[0])===X.hashOf(b[0]),'★★★同じ中身なら同じ指紋');
  ok(X.hashOf(X.pagesOf([row({ price:4000 })],opt,CH)[0])
     !==X.hashOf(a[0]),'★★★値段が変われば指紋も変わる');
  ok(X.hashOf(X.pagesOf([row({ left:1 })],opt,CH)[0])!==X.hashOf(a[0]),
     '★★★残り数が変われば指紋も変わる');
}
T.done();
