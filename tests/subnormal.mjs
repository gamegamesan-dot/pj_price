/* 決まり：モニターは「ゲームソフト通常版のみ」（8.21・カジの報告【1】）

   カジの報告（2026-11-14）
   「モニターの案に『SW版 東方少女綺想譚 限定版【限定版特典】…』
     『翠狂 KOKUGA 初回生産 - 3DS』が入っています」

   ① 限定版・特装版・初回限定・初回生産・豪華版・コレクターズ・同梱・
      セット・BOX・DXパック などがある商品はモニターから外す
   ② 作品名そのものに「版」が入るもの（薔薇と椿 〜お豪華絢爛版〜）は通常版。
      迷う行は「通常版か要確認」の印を出す
   ③ ⚙「通常版でない言葉」で足せる
   ④ 売れる速さが 1日 0点の行は案の後ろに回し、印を付ける */
import { harness } from './lib.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const P=require('../shared/subplan.js');
const T=harness('決まり：モニターは通常版のみ（8.21）');
const ok=T.ok;

const CH={ subChMonitor:'111', subChLight:'222', subOnLight:1 };
const mon=(cfg)=>P.list(cfg||CH).filter((p)=>p.key==='monitor')[0];
const lig=(cfg)=>P.list(cfg||CH).filter((p)=>p.key==='light')[0];

console.log('=== ① 通常版でない商品は外す ===');
{
  const no=['SW版 東方少女綺想譚 限定版【限定版特典】設定資料集・アクリルスタンド',
            '翠狂 KOKUGA 初回生産 - 3DS',
            '◯◯ 特装版','◯◯ 初回限定版','◯◯ 豪華版',
            'テイルズ コレクターズエディション','◯◯ 完全生産限定版',
            '◯◯ ツインパック','◯◯ サウンドトラック同梱',
            '◯◯ スペシャルセット','◯◯ アニバーサリーBOX',
            '◯◯ DXパック','◯◯ デラックスエディション','◯◯ 数量限定版'];
  let bad=[];
  no.forEach((n)=>{ if(P.normalOf(n).ok)bad.push(n); });
  console.log('   外せなかった：'+(bad.length?bad.join(' / '):'なし'));
  ok(!bad.length,'★★★通常版でない言葉のある商品はぜんぶ外す');
  ok(P.normalOf('SW版 東方少女綺想譚 限定版').hit==='限定版',
     '★★★当たった言葉を返す（限定版）');
  ok(P.normalOf('翠狂 KOKUGA 初回生産 - 3DS').hit==='初回生産',
     '★★★当たった言葉を返す（初回生産）');
  ok(P.normalOf('◯◯ box').ok===false,'★大文字小文字は見ない（box）');
}

console.log('=== ② 作品名に「版」が入るものは通常版（要確認の印）===');
{
  const r=P.normalOf('薔薇と椿 〜お豪華絢爛版〜 -Switch【特典】お表裏ジャケット、お取扱');
  ok(r.ok===true,'★★★「お豪華絢爛版」は通常版として残す');
  ok(r.maybe===true,'★★★「通常版か要確認」の印を出す');
  ok(P.normalOf('あの、素晴らしい をもう一度 再装版HD 通常版').maybe===false,
     '★★★「通常版」と書いてあれば迷わない');
  ok(P.normalOf('スーパーマリオパーティ ジャンボリー').maybe===false,
     '★「版」が無い名前は迷わない');
  ok(P.normalOf('メルルのアトリエ DX').ok===true,
     '★★「DX」だけなら通常版（DXパックではない）');
  /* 【特典】…の中の言葉では外さない（掃除したあとの名前で見る）。 */
  ok(P.normalOf('◯◯ (パッケージ版特典(ゲーム内アイテム) 同梱)').ok===true,
     '★★★特典の中の「同梱」では外さない（掃除したあとの名前で見る）');
  ok(P.normalOf('◯◯【限定版特典】ブックレット').ok===true,
     '★★特典の中の「限定版」でも外さない');
}

console.log('=== ③ ⚙ で言葉を足せる ===');
{
  const w=P.ngWords({ subNormalNg:'アルティメット、スペシャルパック' });
  ok(w.indexOf('アルティメット')>=0&&w.indexOf('スペシャルパック')>=0,
     '★★★⚙の言葉が表に入る');
  ok(w.indexOf('限定版')>=0,'★★はじめからの言葉も残る');
  ok(P.normalOf('◯◯ アルティメット',w).ok===false,
     '★★★足した言葉で外れる');
  ok(P.normalOf('◯◯ アルティメット').ok===true,
     '★足していなければ外さない');
  ok(P.ngWords({ subNormalNg:' , 、 ' }).length===P.NORMAL_NG.length,
     '★空の区切りは無視する');
}

console.log('=== プランごとの判定（fitWhy）===');
{
  const row=(n,o)=>Object.assign({ name:n, grades:'' },o||{});
  ok(/通常版ではありません（限定版）/
     .test(P.fitWhy(mon(),row('◯◯ 限定版'),true)),
     '★★★モニターは通常版でない商品を外し、理由を返す');
  ok(P.fitWhy(mon(),row('ふつうのゲーム'),true)==='','★モニターに通常版は出る');
  ok(P.fitWhy(lig(),row('◯◯ 限定版'),true)==='',
     '★★★ライトは限定版も出す（ゲームソフト全件）');
  ok(mon().normal===true&&lig().normal===false,
     '★★通常版だけのプランはモニターだけ');
  ok(/通常版ではありません/.test(P.whyNone(mon(),
     [row('◯◯ 限定版'),row('△△ 初回生産')],()=>true)||''),
     '★★★0件の理由にも出る');
}

console.log('=== ④ 売れる速さ 0点の行は後ろに回す ===');
{
  const r=(jan,o)=>Object.assign({ jan:jan, name:'ふつうのゲーム'+jan,
    fit:true, rst:'ok', amz:0, buy_qty:0, price:3000, qty:1, gross:800,
    speed:1, stock:9, is_game:true, grades:'', no_back:false },o||{});
  const d=P.draft([r('1',{ speed:0, gross:9000 }), r('2',{ speed:1 }),
                   r('3',{ speed:3 })],[mon()],{});
  const got=d.plans[0].items.map((x)=>x.jan);
  console.log('   並び：'+got.join(','));
  ok(got[got.length-1]==='1',
     '★★★速さ 0点の行は、粗利が大きくてもいちばん後ろ');
  ok(d.plans[0].items.filter((x)=>x.slow).length===1,'★★★速さ0の印が付く');
  ok(got[0]==='3','★ほかは今までどおり粗利×速さの順');
  const d2=P.draft([r('4',{ name:'薔薇と椿 〜お豪華絢爛版〜' }),
                    r('5',{ name:'◯◯ 限定版' })],[mon()],{});
  ok(d2.plans[0].items.length===1&&d2.plans[0].items[0].jan==='4',
     '★★★限定版は案に入らない');
  ok(d2.plans[0].items[0].maybe===true,'★★★要確認の印が付く');
  ok(d2.plans[0].skip===1,'★外した件数も数える');
}

T.done();
