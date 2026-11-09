/* Worker：取り込みのたびの知らせ（7.110）と作業者からの登録（7.111）
   【H】MW の在庫CSVを取り込んだときの Discord 通知
   ・在庫切れ（今回新しく欠品・在庫0）のうち
       eBay に無在庫で出品中（W-<JAN>）… 数量0にした
       「仕入れる」の印あり（まだ注文していない）… 注文前に売り切れ
   ・新入荷（前回の CSV に無かった JAN）のうち
       刈取の「見込みあり」または eBay 無在庫の候補
   ・1回の取り込みにつき1通。件数と上位n件（商品名・JAN・卸値・見込み粗利）、
     残りは pj の一覧へのリンク
   ・どれを知らせるか・上位何件かは⚙（mwNtDrop／mwNtBuy／mwNtNew／mwNtTop）
   ・「欠品」は**今回新しく**の数。合計は別に返す（gone_all_jan）
   【I】作業者（STAFF_KEY）の端末から Amazon に直接登録 */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：取り込みの知らせと作業者の登録（7.110／7.111）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwnote');
const j=asJson;

/* Discord に出た文を集める env。 */
const mkEnv=()=>{
  const e=makeEnv({ STAFF_KEY:'s' });
  e.__posts=[];
  return e;
};
let posts=[], embs=[];
/* 7.125：商品は**埋め込み（embeds）**で出るので、そちらも拾う。
   embText() は埋め込みの中の文をぜんぶつないだもの（探しやすくするため）。 */
const embText=()=>embs.map((e)=>[e.title,e.url,e.description||'']
  .concat((e.fields||[]).map((f)=>f.name+' '+f.value)).join(' ')).join('\n');
const hook=(e)=>{
  globalThis.fetch=async(u,i)=>{
    const url=String(u&&u.url?u.url:u);
    if(/discord/.test(url)){
      const b=JSON.parse((i&&i.body)||((u&&u.body)?await u.text():'{}'));
      posts.push(b.content||'');
      embs.push(...((b.embeds)||[]));
      return new Response('{}',{status:200});
    }
    return new Response('{}',{status:200});
  };
  return e;
};
const reset=()=>{ posts=[]; embs=[]; };
const row=(jan,o)=>Object.assign({ jan:jan, sha:'M200', idx:0, kishu:'NS',
  name:jan+'の商品', list_price:9800, release:'2025/01/01', cond:'新品',
  wholesale:3000, stock:9, note:'', ship_text:'即日出荷', ship_days:0 },o||{});
const put=async(env,at,rows)=>await j(await worker.fetch(post('/mw/stock',
  { at:at, part:1, parts:1, rows:rows, rows_in:rows.length }),env));
const cfg=async(env,o)=>await j(await worker.fetch(post('/settings',
  { at:new Date().toISOString(), settings:o }),env));

console.log('=== ①「欠品」は今回新しく消えたぶん（合計は別）===');
let env=hook(mkEnv());
reset();
/* 1回目：12行。2回目：そのうち3行が消える。 */
const first=[];
for(let i=0;i<12;i++)first.push(row('49023705500'+String(10+i).slice(-2)));
let r=await put(env,'2026-11-07T01:00:00.000Z',first);
console.log('   1回目: '+JSON.stringify({added:r.body.added,gone:r.body.gone,
  added_jan:r.body.added_jan}));
ok(r.body.added===12&&r.body.gone===0,'★1回目は12行足して欠品なし');
ok(r.body.added_jan===12,'★★新しく出てきた商品（JAN）の数も返す');
r=await put(env,'2026-11-07T02:00:00.000Z',first.slice(0,9));
console.log('   2回目: '+JSON.stringify({gone:r.body.gone,gone_jan:r.body.gone_jan,
  gone_all:r.body.gone_all,gone_all_jan:r.body.gone_all_jan}));
ok(r.body.gone===3,'★★★「欠品」は**今回新しく**消えた行数（累計ではない）');
ok(r.body.gone_jan===3,'★★今回新しく欠品になった商品（JAN）の数も返す');
ok(r.body.gone_all===3&&r.body.gone_all_jan===3,'★★欠品の**合計**も別に返す');
/* もう1回消すと、合計だけが増える。 */
r=await put(env,'2026-11-07T03:00:00.000Z',first.slice(0,8));
console.log('   3回目: '+JSON.stringify({gone:r.body.gone,gone_all:r.body.gone_all}));
ok(r.body.gone===1&&r.body.gone_all===4,
   '★★★今回1件・合計4件（分けて数えている）');

console.log('\n=== ② eBay 無在庫（W-）が欠品 → 数量0にした ===');
env=hook(mkEnv());
reset();
const JAN_W='4902370551001';
const base=[];
for(let i=0;i<12;i++)base.push(row('49023705520'+String(10+i).slice(-2)));
base.push(row(JAN_W,{ name:'ヨッシークラフトワールド', wholesale:4000 }));
await put(env,'2026-11-07T01:00:00.000Z',base);
/* eBay に W- で出品中にする。 */
env.DB._db.prepare(
  `INSERT INTO items (asin,cond,scope,title,ebay_item_id,ebay_sku,ebay_qty,
     updated_at)
   VALUES ('B0YOSHI0001','new','ebay','Yoshi','1234567','W-`+JAN_W+`',1,
     '2026-11-01T00:00:00Z')`).run();
reset();
r=await put(env,'2026-11-07T02:00:00.000Z',base.filter((x)=>x.jan!==JAN_W));
console.log('   通知: '+(posts[0]||'（なし）').slice(0,420));
/* 7.126（【T】）：1通目は**要約だけ**。見出しと商品は次の通に出る。 */
ok(posts.length>=2&&!/数量0にしました/.test(posts[0])
   &&/MW の在庫CSVを取り込みました/.test(posts[0]),
   '★★★1通目は要約だけ（7.126）');
ok(/新しく欠品 1件（欠品の合計 1件）/.test(posts[0]),
   '★★「今回 新しく欠品 n件（欠品の合計 n件）」と書く');
/* 7.125：見出しは文、商品は埋め込みに出る。 */
ok(/数量0にしました/.test(posts.join('\n'))
   &&embs.some((e)=>e.title==='ヨッシークラフトワールド'),
   '★★★eBay に無在庫で出していた商品は「数量0にしました」');
ok(new RegExp(JAN_W).test(embText())&&/¥4,000/.test(embText()),
   '★★商品名・JAN・卸値を出す（埋め込みの中）');

console.log('\n=== ③ 仕入れる印の商品が売り切れ → 注文前に売り切れ ===');
env=hook(mkEnv());
const JAN_B='4902370552002';
const b2=[];
for(let i=0;i<12;i++)b2.push(row('49023705530'+String(10+i).slice(-2)));
b2.push(row(JAN_B,{ name:'ねんどろいど八奈見', wholesale:2500, list_price:7000 }));
await put(env,'2026-11-07T01:00:00.000Z',b2);
env.DB._db.prepare(
  `INSERT INTO mw_buy (jan,qty,by_role,at,created_at,asin,name,wholesale)
   VALUES ('`+JAN_B+`',1,'staff','2026-11-05T00:00:00Z','2026-11-05T00:00:00Z',
     'B0NENDO0001','ねんどろいど八奈見',2500)`).run();
reset();
r=await put(env,'2026-11-07T02:00:00.000Z',b2.filter((x)=>x.jan!==JAN_B));
console.log('   通知: '+(posts[0]||'（なし）').slice(0,400));
ok(/注文前に売り切れました/.test(posts.join('\n')),
   '★★★印が付いている商品は「注文前に売り切れました」');
ok(embs.some((e)=>e.title==='ねんどろいど八奈見'),
   '★その商品を埋め込みで出す（7.125）');
/* 7.125：pj へのリンクは出さない（Discord の中のブラウザはキーを持たない）。
   代わりに埋め込みの中に Amazon と Keepa のリンクを出す。 */
ok(!/#tab=/.test(posts.join('\n'))&&!/#tab=/.test(embText()),
   '★★pj へのリンクは出さない');
ok(/amazon\.co\.jp/.test(embText()),'★★Amazon のリンクを出す');
/* 同じ商品を2回は知らせない。 */
reset();
r=await put(env,'2026-11-07T03:00:00.000Z',b2.filter((x)=>x.jan!==JAN_B));
ok(posts.length===0,'★★同じ商品は2回知らせない（mw_notify に控える）');

console.log('\n=== ④ 新入荷（見込みあり／eBay 無在庫の候補）===');
env=hook(mkEnv());
const old=[];
for(let i=0;i<12;i++)old.push(row('49023705540'+String(10+i).slice(-2),
  { list_price:3000, wholesale:2800 }));
await put(env,'2026-11-07T01:00:00.000Z',old);
reset();
const add=old.concat([
  /* 見込みあり：9800×0.85 − 3000×1.1 = 5030 > 1000 */
  row('4902370554001',{ name:'見込みのある新商品', list_price:9800, wholesale:3000 }),
  /* 見込みなし・eBay 候補でもない（在庫1点・出荷10日） */
  row('4902370554002',{ name:'見込みのない新商品', list_price:3000,
    wholesale:2900, stock:1, ship_days:10 })]);
r=await put(env,'2026-11-07T02:00:00.000Z',add);
console.log('   '+JSON.stringify({added_jan:r.body.added_jan})+' 通知: '
  +(posts[0]||'（なし）').slice(0,420));
ok(r.body.added_jan===2,'★新しく出てきた商品は2件');
ok(/新しく入荷しました/.test(posts.join('\n'))
   &&embs.some((e)=>e.title==='見込みのある新商品'),
   '★★★見込みのある新入荷を知らせる');
ok(!embs.some((e)=>e.title==='見込みのない新商品'),
   '★★★見込みもなく候補にも入らない行は知らせない');
ok(/¥5,030/.test(embText()),'★★見込みの粗利を出す');
ok(/定価からの目安/.test(embText()),'★★★出どころも出す（7.125）');

console.log('\n=== ⑤ ⚙で切り替えられる（どれを知らせるか・上位何件）===');
env=hook(mkEnv());
await cfg(env,{ mwNtNew:false, mwNtDrop:false, mwNtBuy:false });
const o5=[];
for(let i=0;i<12;i++)o5.push(row('49023705550'+String(10+i).slice(-2)));
await put(env,'2026-11-07T01:00:00.000Z',o5);
reset();
await put(env,'2026-11-07T02:00:00.000Z',o5.concat(
  [row('4902370555901',{ name:'新商品', list_price:9800, wholesale:3000 })]));
ok(posts.length===0,'★★★ぜんぶオフなら知らせない');
await cfg(env,{ mwNtNew:true, mwNtTop:'2' });
reset();
await put(env,'2026-11-07T03:00:00.000Z',o5.concat([
  row('4902370555902',{ name:'新A', list_price:9800, wholesale:3000 }),
  row('4902370555903',{ name:'新B', list_price:9700, wholesale:3000 }),
  row('4902370555904',{ name:'新C', list_price:9600, wholesale:3000 })]));
console.log('   '+(posts[0]||'').slice(0,300)+' / 埋め込み '
  +embs.map((e)=>e.title).join('・'));
const t5=embs.map((e)=>e.title);
ok(t5.indexOf('新A')>=0&&t5.indexOf('新B')>=0&&t5.indexOf('新C')<0,
   '★★★上位2件だけ出す（⚙ mwNtTop）');
/* 知らせは区分ごとに別の通になるので、ぜんぶつないで見る。 */
ok(/ほか 1件/.test(posts.join('\n')),'★★残りは件数で出す');
ok(!/#tab=/.test(posts.join('\n')),'★★★一覧へのリンクは出さない（7.125）');

console.log('\n=== ⑥ 3割の歯止めが効いた回は在庫切れを知らせない ===');
env=hook(mkEnv());
const o6=[];
for(let i=0;i<20;i++)o6.push(row('49023705560'+String(10+i).slice(-2)));
await put(env,'2026-11-07T01:00:00.000Z',o6);
reset();
r=await put(env,'2026-11-07T02:00:00.000Z',o6.slice(0,10));
console.log('   warn: '+String(r.body.warn||'').slice(0,60));
ok(!!r.body.warn&&r.body.gone===0,'★半分に減ったら欠品にしない（今までどおり）');
ok(posts.length===0,'★★そのときは在庫切れも知らせない');
T.done();
