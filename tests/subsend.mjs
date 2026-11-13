/* Worker：会員向け Discord の配信と、Shopify の注文の取り込み（8.11／8.13・【Y】）

   ① 配信するのは「会員に出す」の印＋**Shopify に読み込み済み**の商品だけ
   ② カードの販売価格は mw_sub.price（Shopify に入っている値）。引き直さない
   ③ プランの表（shared/subplan.js）。いまはモニターだけ動かす
   ④ 同じ商品を同じチャンネルに二重に送らない。値段や数が変われば書き換える
   ⑤ 会員用のカードに 卸値・社・MW・pj の URL・仕入原価・上乗せを出さない
   ⑥ 「今日は送らない」の印／予告
   ⑦ 注文CSV：SKU で突き合わせ・二重読み込みで二重に数えない・
      残り数を書き換え・0 で完売・MW の在庫が足りなければ知らせる */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import SUBPLAN from '../shared/subplan.js';
import SUBCARD from '../shared/subcard.js';
const T=harness('Worker：会員向けの配信と注文（8.11／8.13）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('subsend');

let dc=[], notes=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  /* Webhook（社内用の知らせ）とボットの口（会員向けの配信）を分ける。 */
  if(/\/api\/webhooks\//.test(url)){
    notes.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response(null,{status:204});
  }
  if(/discord\.com\/api/.test(url)){
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    const b=JSON.parse(String(o.body||'{}'));
    dc.push({ method:String(o.method||'GET'), ch:m[1]||'', msg:m[2]||'', body:b,
              auth:String((o.headers||{})['authorization']||'') });
    return new Response(JSON.stringify({ id:String(900000+dc.length) }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  if(/discord/.test(url)){
    notes.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response(null,{status:204});
  }
  return new Response('{}',{status:200});
};
const CH='1234567890';
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz',
  DISCORD_WEBHOOK_URL:'https://discord.com/api/webhooks/1/abc' });
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subChMonitor:CH,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const JAN='4902370550467', JAN2='4902370550468', JAN3='4580033110113';
const stock=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,created_at)
   VALUES (?1,'いろは商会',0,?2,?3,?4,'h',?5,?5)`)
  .bind(jan,(o||{}).kishu||'NS',(o||{}).name||('商品'+jan),
        (o||{}).stock===undefined?9:(o||{}).stock,new Date().toISOString()).run();
/* 8.17：カードに「Amazon の販売価格（カート・◯月◯日 ◯時 時点）」を出すので、
   基準（basis）と取った日時（price_at）も入れておく。 */
const amz=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,checked_at,
     basis,price_at)
   VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?7)`)
  .bind(jan,(o||{}).asin||'B0D1GSZJ8T',(o||{}).name||'Amazonの名前',
        (o||{}).price||9000,(o||{}).fee||1200,(o||{}).tier||'s',
        new Date().toISOString(),(o||{}).basis||'カート').run();
const sub=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
   VALUES (?1,1,?2,?3,?4,?5,?6,?5,?5)`)
  .bind(jan,(o||{}).qty===undefined?1:(o||{}).qty,(o||{}).price||3645,
        (o||{}).grades||'',new Date().toISOString(),
        (o||{}).loaded===false?null:new Date().toISOString()).run();
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;

console.log('=== ① プランの表（モニターだけ動かす）===');
{
  const l=SUBPLAN.list({});
  console.log('   '+l.map((p)=>p.key+' on='+p.on+' n='+p.n+' q='+p.q).join(' / '));
  const m=l.filter((p)=>p.key==='monitor')[0];
  ok(m.on===true&&m.n===10&&m.q===1&&m.kinds==='game',
     '★★★モニター：ゲームソフト通常版のみ・1回10件・1商品1点');
  ok(l.filter((p)=>p.key!=='monitor').every((p)=>p.on===false),
     '★★★ライト・スタンダード・プレミアムは止めてある');
  ok(SUBPLAN.active({}).length===0,'★チャンネルIDが無ければ動かさない');
  ok(SUBPLAN.active({ subChMonitor:CH })[0].key==='monitor',
     '★★チャンネルIDを入れたプランだけ動く');
  ok(SUBPLAN.list({ subQMonitor:5 }).filter((p)=>p.key==='monitor')[0].q===5,
     '★★★1商品あたりの数は⚙で変えられる');
  ok(SUBPLAN.list({ subNMonitor:3 }).filter((p)=>p.key==='monitor')[0].n===3,
     '★★1回の件数も⚙で変えられる');
  /* ゲームソフトだけ（モニター）。フィギュアは出さない。 */
  ok(SUBPLAN.fits(m,{grades:''},true)===true,'★★★ゲームソフトは出す');
  ok(SUBPLAN.fits(m,{grades:''},false)===false,'★★★ゲーム以外は出さない');
  ok(SUBPLAN.fits(m,{grades:'light'},true)===false,
     '★★grades で見せるプランを絞れる');
  ok(SUBPLAN.fits(m,{grades:'',one_off:1},true)===false,
     '★★1点ものはプレミアム（one）だけ');
}

console.log('\n=== ①の2 ⚙のドメインが https:// つきでも購入リンクが出る（8.16）===');
{
  const env=env0();
  await setCfg(env,{ subDomain:'https://omakase-ship.myshopify.com/' });
  await stock(env,JAN); await amz(env,JAN); await sub(env,JAN);
  const d=await api(env,'/sub/plan');
  console.log('   domain '+JSON.stringify(d.domain));
  ok(d.domain==='omakase-ship.myshopify.com',
     '★★★pj-sync も https:// と末尾の / を外して持つ');
  const it=((d.plans||[]).filter((p)=>p.key==='monitor')[0]||{}).items||[];
  ok(it.length===1,'★配信できる商品がある');
}

console.log('\n=== ② Shopify に読み込んだ印が付いた商品だけ配信する ===');
{
  const env=env0();
  await setCfg(env,{});
  await stock(env,JAN); await amz(env,JAN); await sub(env,JAN,{});
  /* 印が付いていない商品は出さない。 */
  await stock(env,JAN2); await amz(env,JAN2);
  await sub(env,JAN2,{ loaded:false });
  /* ゲーム以外（フィギュア）は モニターに出さない。 */
  await stock(env,JAN3,{ kishu:'figure' }); await amz(env,JAN3);
  await sub(env,JAN3,{});
  const pl=await api(env,'/sub/plan');
  console.log('   '+JSON.stringify(pl.plans.filter((p)=>p.key==='monitor')[0]));
  const m=pl.plans.filter((p)=>p.key==='monitor')[0];
  ok(pl.table_ok===true&&pl.token===true,'★表とトークンがある');
  ok(m.items.length===1&&m.items[0].jan===JAN,
     '★★★読み込み済みのゲームソフト1件だけが予定に入る');
  ok(m.add===1&&m.edit===0&&m.keep===0,'★★新しく送る1件');
  ok(m.items[0].price===3645,
     '★★★カードの値段は mw_sub.price（Shopify と同じ値）');
}

console.log('\n=== ③ 送る・二重に送らない・書き換える ===');
{
  const env=env0();
  await setCfg(env,{});
  await stock(env,JAN); await amz(env,JAN); await sub(env,JAN,{});
  dc=[];
  let r=await api(env,'/sub/send',{ approve:true });
  console.log('   '+JSON.stringify({sent:r.sent,edited:r.edited,skipped:r.skipped}));
  ok(r.ok===true&&r.sent===1,'★★★1件送る');
  ok(dc.length===1&&dc[0].method==='POST'&&dc[0].ch===CH,
     '★★★⚙のチャンネルへ送る');
  ok(/^Bot /.test(dc[0].auth),'★★ボットのトークンで送る');
  const card=dc[0].body.embeds[0];
  console.log('   '+JSON.stringify(card.fields.map((f)=>f.name)));
  ok(/¥3,645/.test(JSON.stringify(card)),'★★★販売価格は ¥3,645');
  ok(/products\/sub-4902370550467/.test(JSON.stringify(card)),
     '★★★購入リンクは Shopify の商品ページ');
  /* 8.15（【返事】）機種は記号（NS）ではなく正式な呼び名で出す。
     表は shared/mwfee.js の1か所だけ（Shopify の説明文と同じもの）。 */
  /* 8.16（【3】）⚙のドメインに https:// や末尾の / が付いていても
     購入リンクが作れること（整え方は shared/subcard.js の1か所だけ）。 */
  ok(SUBCARD.domainOf(' https://Omakase-Ship.myshopify.com/ ')
     ==='omakase-ship.myshopify.com',
     '★★★https:// と末尾の / と空白と大文字を整える');
  ok(SUBCARD.domainOf('omakase-ship.myshopify.com/admin')
     ==='omakase-ship.myshopify.com','★★/ から後ろは落とす');
  ok(SUBCARD.domainOf('')===''&&SUBCARD.buyUrl('','4902370550467')==='',
     '★空なら購入リンクを出さない');
  /* 8.17（会員の目線）項目の名前・並び・中身。 */
  {
    const nm=(card.fields||[]).map((f)=>f.name);
    const fv=(n)=>((card.fields||[]).filter((f)=>f.name===n)[0]||{}).value||'';
    console.log('   並び '+nm.join('→'));
    console.log('   '+JSON.stringify({ px:fv('仕入れ価格（税込・送料別）'),
      amz:fv('Amazon の販売価格'), gr:fv('見込みの Amazon 粗利'),
      ship:fv('送料') }));
    ok(JSON.stringify(nm)===JSON.stringify(['JAN','機種',
       '仕入れ価格（税込・送料別）','Amazon の販売価格','見込みの Amazon 粗利',
       '購入できる数','送料','購入リンク']),
       '★★★頼まれた並び順と名前（商品名は見出し）');
    ok(/^¥3,645$/.test(fv('仕入れ価格（税込・送料別）')),
       '★★★「仕入れ価格（税込・送料別）」＝会員が当社から買う値段');
    ok(/¥9,000/.test(fv('Amazon の販売価格')),
       '★★★Amazon の販売価格も出す');
    ok(/時点/.test(fv('Amazon の販売価格')),
       '★★★取った日時も出す（◯月◯日 ◯時 時点）');
    ok(/カート/.test(fv('Amazon の販売価格')),'★★基準（カート／最安）も出す');
    ok(/利益率 \d+%/.test(fv('見込みの Amazon 粗利')),
       '★★★粗利の横に利益率（粗利 ÷ 仕入れ価格）');
    ok(/Amazon の手数料を引いたあと・送料は別/.test(fv('見込みの Amazon 粗利')),
       '★★★「手数料を引いたあと・送料は別」と添える');
    ok(/クリックポスト/.test(fv('送料'))&&/1〜2本 ¥200/.test(fv('送料'))
       &&/3本 ¥300/.test(fv('送料'))&&/4本以上 ¥600/.test(fv('送料')),
       '★★★送料は本数ごとの額（ゲームソフトは Shopify と同じ 1本100g）');
    ok(!/まだ採寸していません/.test(fv('送料')),
       '★★★「—（まだ採寸していません）」とは出さない');
  }
  const kf=(card.fields||[]).filter((f)=>f.name==='機種')[0]||{};
  console.log('   機種 '+JSON.stringify(kf.value));
  ok(kf.value==='Nintendo Switch',
     '★★★会員用のカードの機種は正式な呼び名（NS → Nintendo Switch）');
  /* もう一度押しても二重に送らない。 */
  dc=[];
  r=await api(env,'/sub/send',{ approve:true });
  ok(r.sent===0&&r.skipped===1&&dc.length===0,
     '★★★同じ商品を同じチャンネルに二重に送らない');
  /* 値段が変われば**書き換える**（新しく送らない）。 */
  await env.DB.prepare(`UPDATE mw_sub SET price=3900 WHERE jan=?1`).bind(JAN).run();
  dc=[];
  r=await api(env,'/sub/send',{ approve:true });
  console.log('   書き換え: '+JSON.stringify(dc.map((x)=>x.method)));
  ok(r.edited===1&&r.sent===0,'★★★値段が変わったら書き換える');
  ok(dc.length===1&&dc[0].method==='PATCH'&&dc[0].msg==='900001',
     '★★★前のカードを書き換える（新しく送らない）');
  ok(/¥3,900/.test(JSON.stringify(dc[0].body)),'★★新しい値段になる');
}

console.log('\n=== ③の2 カードの形が変わったら、送ったぶんも書き換える（8.17）===');
{
  const env=env0();
  await setCfg(env,{});
  await stock(env,JAN); await amz(env,JAN); await sub(env,JAN);
  dc=[];
  let r=await api(env,'/sub/send',{ approve:true });
  ok(r.sent===1,'★1件送る');
  dc=[];
  r=await api(env,'/sub/send',{ approve:true });
  ok(r.skipped===1&&r.sent===0&&r.edited===0,'★★二度目はそのまま');
  ok(r.reform===false,'★★形は変わっていない');
  /* 前の版で送ってあったことにする（カードの形が変わった回）。 */
  await env.DB.prepare(
    `INSERT INTO sync_state (k,v,updated_at) VALUES ('sub.card.v','8.11',?1)
     ON CONFLICT(k) DO UPDATE SET v=excluded.v`)
    .bind(new Date().toISOString()).run();
  dc=[];
  r=await api(env,'/sub/send',{});          // まず予定（送らない）
  console.log('   予定: '+JSON.stringify({ reform:r.reform,
    why:r.why_reform, edit:(r.plans[0]||{}).edit }));
  ok(r.reform===true&&/形が変わった/.test(String(r.why_reform||'')),
     '★★★予定にも「形が変わったので書き換えます」と出す');
  ok((r.plans[0]||{}).edit===1,'★★★値段が同じでも「書き換え」に数える');
  ok(dc.length===0,'★予定では送らない');
  dc=[];
  r=await api(env,'/sub/send',{ approve:true });
  console.log('   '+JSON.stringify({ edited:r.edited, m:dc.map((x)=>x.method) }));
  ok(r.edited===1&&dc.length===1&&dc[0].method==='PATCH',
     '★★★前のカードを新しい形に書き換える（新しく送らない）');
  ok(/仕入れ価格（税込・送料別）/.test(JSON.stringify(dc[0].body)),
     '★★★書き換えた中身は新しい形');
  const v=await env.DB.prepare(
    `SELECT v FROM sync_state WHERE k='sub.card.v'`).first();
  ok(String((v||{}).v||'')===SUBCARD.CARD_V,'★★そろえ終えたら版を控える');
  dc=[];
  r=await api(env,'/sub/send',{ approve:true });
  ok(r.skipped===1&&r.edited===0,
     '★★★次からはまた「そのまま」（毎回書き換えない）');
}

console.log('\n=== ③の3 送料の文はプランごとに変えられる（8.17）===');
{
  const env=env0();
  await setCfg(env,{ subShipMonitor:'クリックポスト（1〜2本 ¥200／3本 ¥300'
    +'／4本以上 送料無料）' });
  await stock(env,JAN); await amz(env,JAN); await sub(env,JAN);
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  const f=((dc[0]||{}).body||{}).embeds[0].fields
    .filter((x)=>x.name==='送料')[0]||{};
  console.log('   '+JSON.stringify(f.value));
  ok(/4本以上 送料無料/.test(String(f.value||'')),
     '★★★⚙に入れた文をそのまま出す（モニターは4本以上 送料無料）');
  /* ⚙の「ゲームソフト1本の重さ」を 0 にして、採寸も無い行は
     今までどおり区分の名前（6.183 と同じ読み方）。 */
  const e2=env0();
  await setCfg(e2,{ mwSubGameG:0 });
  await stock(e2,JAN2); await amz(e2,JAN2,{ tier:'' }); await sub(e2,JAN2);
  await e2.DB.prepare(`UPDATE mw_amz SET size_g=0, size_tier='' WHERE jan=?1`)
    .bind(JAN2).run();
  dc=[];
  await api(e2,'/sub/send',{ approve:true });
  const f2=(((dc[0]||{}).body||{ embeds:[{ fields:[] }] })
    .embeds[0].fields||[]).filter((x)=>x.name==='送料')[0]||{};
  console.log('   '+JSON.stringify(f2.value));
  ok(/まだ採寸していません/.test(String(f2.value||'')),
     '★★重さも区分も分からない行は今までどおり');
}

console.log('\n=== ③の4 残り数は「上限 − 取り込んだ注文の点数」（8.19・不具合1）===');
{
  const env=env0();
  await setCfg(env,{});
  await stock(env,JAN); await amz(env,JAN); await sub(env,JAN,{ qty:10 });
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  const f=(x)=>((((dc[0]||{}).body||{}).embeds||[{}])[0].fields||[])
    .filter((y)=>y.name===x)[0]||{};
  ok(/残り 10点/.test(String(f('購入できる数').value||'')),'★はじめは残り10点');
  /* 注文を1点取り込む。 */
  await env.DB.prepare(
    `INSERT INTO sub_order (order_no,sku,jan,qty,price,at,created_at)
     VALUES ('#1001','SUB-'||?1||'-20261113',?1,1,2539,?2,?2)`)
    .bind(JAN,'2026-11-13T02:00:00Z').run();
  let r=await api(env,'/sub/plan');
  const it=((r.plans||[]).filter((p)=>p.key==='monitor')[0]||{}).items||[];
  console.log('   予定: '+JSON.stringify(it.map((x)=>({ jan:x.jan,
    left:x.left, same:x.same }))));
  ok((it[0]||{}).left===9,
     '★★★配信の予定の残り数も「上限 − 注文の点数」（10 − 1 ＝ 9）');
  ok((it[0]||{}).same===false,'★★★残りが変わったので「書き換え」になる');
  /* **チャンネルを入れ替えても**同じ（新しいチャンネルに控えが無くても）。 */
  const e2=env0();
  await setCfg(e2,{ subChMonitor:'999888777666555444' });
  await stock(e2,JAN); await amz(e2,JAN); await sub(e2,JAN,{ qty:10 });
  await e2.DB.prepare(
    `INSERT INTO sub_order (order_no,sku,jan,qty,price,at,created_at)
     VALUES ('#1001','SUB-'||?1||'-20261113',?1,1,2539,?2,?2)`)
    .bind(JAN,'2026-11-13T02:00:00Z').run();
  dc=[];
  await api(e2,'/sub/send',{ approve:true });
  const f2=((((dc[0]||{}).body||{}).embeds||[{}])[0].fields||[])
    .filter((y)=>y.name==='購入できる数')[0]||{};
  console.log('   新しいチャンネル: '+JSON.stringify(f2.value));
  ok(/残り 9点/.test(String(f2.value||'')),
     '★★★チャンネルを入れ替えたあとのカードも残り 9点');
}

console.log('\n=== ③の5 カードの中身が変われば書き換える（8.19・不具合2）===');
{
  const env=env0();
  await setCfg(env,{});
  await stock(env,JAN); await amz(env,JAN); await sub(env,JAN);
  dc=[];
  let r=await api(env,'/sub/send',{ approve:true });
  ok(r.sent===1,'★1件送る');
  const h0=await env.DB.prepare(
    `SELECT card_h FROM sub_post WHERE jan=?1`).bind(JAN).first();
  ok(!!(h0||{}).card_h,'★★★カードの指紋を控える');
  r=await api(env,'/sub/send',{ approve:true });
  ok(r.skipped===1,'★★中身が同じならそのまま');
  /* ⚙の送料の文だけを変える（値段も数も変わらない）。 */
  await setCfg(env,{ subShipMonitor:'クリックポスト（1〜2本 ¥200／'
    +'3本 ¥300／4本以上 送料無料）' });
  r=await api(env,'/sub/plan');
  const it=((r.plans||[]).filter((p)=>p.key==='monitor')[0]||{}).items||[];
  ok((it[0]||{}).same===false,
     '★★★送料の文を変えただけでも「書き換え」と分かる（予定）');
  dc=[];
  r=await api(env,'/sub/send',{ approve:true });
  console.log('   '+JSON.stringify({ edited:r.edited, m:dc.map((x)=>x.method) }));
  ok(r.edited===1&&dc.length===1&&dc[0].method==='PATCH',
     '★★★値段も数も同じでも、中身が変われば書き換える');
  ok(/4本以上 送料無料/.test(JSON.stringify(dc[0].body)),
     '★★★新しい送料の文になる');
  const h1=await env.DB.prepare(
    `SELECT card_h FROM sub_post WHERE jan=?1`).bind(JAN).first();
  ok((h1||{}).card_h!==(h0||{}).card_h,'★★指紋も新しくなる');
  r=await api(env,'/sub/send',{ approve:true });
  ok(r.skipped===1,'★★★書き換えたあとはまた「そのまま」');
  /* 「送ったカードをすべて今の形で書き直す」（redo）。 */
  dc=[];
  r=await api(env,'/sub/send',{ approve:true, redo:true });
  console.log('   redo: '+JSON.stringify({ edited:r.edited, redo:r.redo,
    why:r.why_reform, m:dc.map((x)=>x.method) }));
  ok(r.redo===true&&r.edited===1&&dc[0].method==='PATCH',
     '★★★「書き直す」は中身が同じでも書き換える（送り直さない）');
  ok(/書き直します/.test(String(r.why_reform||'')),'★★理由も返す');
}

console.log('\n=== ④ 会員用のカードに出さないもの ===');
{
  const env=env0();
  await setCfg(env,{});
  await stock(env,JAN,{ name:'【新品】商品 ★' });
  await amz(env,JAN); await sub(env,JAN,{});
  await env.DB.prepare(
    `UPDATE mw_stock SET wholesale=2600, note='在庫処分' WHERE jan=?1`)
    .bind(JAN).run();
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  const all=JSON.stringify(dc[0].body);
  console.log('   '+all.slice(0,220));
  ok(!/matchingworld/.test(all),'★★★MW の URL が入っていない');
  ok(!/卸値/.test(all)&&!/いろは商会/.test(all),'★★★卸値・社が入っていない');
  ok(!/2,600/.test(all),'★★★仕入原価も入っていない');
  ok(!/workers\.dev/.test(all)&&!/github\.io/.test(all),
     '★★★pj の URL も入っていない');
  ok(!/在庫処分/.test(all),'★★MW の備考も入っていない');
  ok(SUBCARD.MEMBER_NG.every((n)=>all.indexOf('"'+n+'"')<0),
     '★★★出してはいけない欄の名前が1つも無い');
}

console.log('\n=== ⑤ 今日は送らない・予定だけ ===');
{
  const env=env0();
  await setCfg(env,{});
  await stock(env,JAN); await amz(env,JAN); await sub(env,JAN,{});
  /* approve なしは送らない（予定だけ）。 */
  dc=[];
  let r=await api(env,'/sub/send',{});
  ok(r.sent===0&&dc.length===0&&r.plans[0].add===1,
     '★★★「予定を見る」では送らない');
  /* 「今日は送らない」の印。 */
  let sk=await api(env,'/sub/skip',{});
  ok(sk.ok===true&&sk.skip===true,'★★印を付けられる');
  r=await api(env,'/sub/send',{ approve:true, });
  ok(r.sent===1,'★★★手で押したときは印があっても送る');
  /* 自動（Cron）の回は印があれば送らない。 */
  const env2=env0();
  await setCfg(env2,{});
  await stock(env2,JAN); await amz(env2,JAN); await sub(env2,JAN,{});
  await W.subSkipSet(env2,true);
  dc=[];
  const r2=await W.jobSubSend(env2,{ approve:true, auto:true });
  ok(r2.sent===0&&dc.length===0&&/送らない/.test(String(r2.why||'')),
     '★★★自動の回は「今日は送らない」を守る');
  const pl=await api(env2,'/sub/plan');
  ok(pl.skip===true,'★画面にも印が出る');
  await api(env2,'/sub/skip',{ off:true });
  ok((await api(env2,'/sub/plan')).skip===false,'★印は外せる');
}

console.log('\n=== ⑥ 注文CSV の取り込み ===');
{
  const env=env0();
  await setCfg(env,{});
  await stock(env,JAN,{ stock:5 }); await amz(env,JAN);
  await sub(env,JAN,{ qty:3 });
  await api(env,'/sub/send',{ approve:true });
  const CSV='Name,Created at,Lineitem quantity,Lineitem price,Lineitem sku\n'
    +'#1001,2026-11-13 09:00:00 +0900,1,3645,SUB-4902370550467-20261113\n'
    +'#1002,2026-11-13 09:30:00 +0900,1,3645,SUB-4902370550467-20261113\n'
    +'#1003,2026-11-13 10:00:00 +0900,1,0,ほかの商品のSKU\n';
  dc=[];
  let r=await api(env,'/sub/orders',{ text:CSV, name:'orders.csv' });
  console.log('   '+JSON.stringify({added:r.added,dup:r.dup,other:r.other,
    edited:r.edited,sold_out:r.sold_out}));
  ok(r.ok===true&&r.added===2,'★★★SKU で突き合わせて2件を取り込む');
  ok(r.other===1,'★★会員用でない SKU は数えない');
  ok(r.edited===1,'★★★カードの残り数を書き換える');
  ok(dc.length===1&&dc[0].method==='PATCH','★★★Discord で書き換える');
  ok(/残り 1点/.test(JSON.stringify(dc[0].body)),'★★★残り 1点 になる');
  /* 同じ CSV をもう一度読んでも二重に数えない。 */
  dc=[];
  r=await api(env,'/sub/orders',{ text:CSV, name:'orders.csv' });
  console.log('   2回目: '+JSON.stringify({added:r.added,dup:r.dup}));
  ok(r.added===0&&r.dup===2,'★★★同じ CSV を2回読んでも二重に数えない');
  ok(dc.length===0,'★★2回目はカードも書き換えない');
  /* 残り 0 で完売。 */
  const CSV2='Name,Created at,Lineitem quantity,Lineitem price,Lineitem sku\n'
    +'#1004,2026-11-13 11:00:00 +0900,1,3645,SUB-4902370550467-20261113\n';
  dc=[];
  r=await api(env,'/sub/orders',{ text:CSV2, name:'o2.csv' });
  console.log('   '+JSON.stringify(dc[0].body.embeds[0].fields
    .filter((f)=>/購入/.test(f.name))));
  ok(r.sold_out===1,'★★★0 になったら完売');
  ok(/完売しました/.test(JSON.stringify(dc[0].body)),'★★★カードに「完売」と出る');
  /* 注文のまとめ。 */
  const list=await api(env,'/sub/orders');
  console.log('   '+JSON.stringify(list.rows));
  ok(list.rows.length===1&&list.rows[0].qty===3&&list.rows[0].left===0,
     '★★注文のまとめを返す（残り 0）');
  ok(list.rows[0].sold_out===true,'★完売の印');
  /* 仕入れの一覧に「会員の注文 n点」として載る。 */
  const q=await W.subOrderQty(env);
  ok(q[JAN]===3,'★★★仕入れの一覧に足す数（会員の注文 3点）');
}

console.log('\n=== ⑦ MW の在庫が足りない（返金が必要）===');
{
  const env=env0();
  await setCfg(env,{});
  await stock(env,JAN,{ stock:1 }); await amz(env,JAN);
  await sub(env,JAN,{ qty:3 });
  await api(env,'/sub/send',{ approve:true });
  notes=[];
  const CSV='Name,Created at,Lineitem quantity,Lineitem price,Lineitem sku\n'
    +'#2001,2026-11-13 09:00:00 +0900,3,3645,SUB-4902370550467-20261113\n';
  const r=await api(env,'/sub/orders',{ text:CSV, name:'o.csv' });
  console.log('   '+JSON.stringify(r.short)+' / 知らせ '+notes.length+'件');
  ok(r.short.length===1&&r.short[0].sold===3&&r.short[0].stock===1,
     '★★★MW の在庫が足りない商品を見つける');
  ok(notes.some((t)=>/返金/.test(t)),'★★★社内用に「返金が必要」と知らせる');
  ok(notes.every((t)=>!/matchingworld/.test(t)),'★知らせは社内用なのでそのまま');
}

console.log('\n=== ⑧ 表が無いとき・トークンが無いとき ===');
{
  const env=makeEnv({ STAFF_KEY:'staff-key-123' });   // トークンなし
  await setCfg(env,{});
  await stock(env,JAN); await amz(env,JAN); await sub(env,JAN,{});
  const r=await api(env,'/sub/send',{ approve:true });
  console.log('   '+JSON.stringify({error:r.error,detail:r.detail}));
  ok(r.error==='no_token','★★★トークンが無ければ送らずに理由を返す');
  const pl=await api(env,'/sub/plan');
  ok(pl.token===false,'★★画面にも「トークンが無い」と出せる');
}

console.log('\n=== ⑨ 作業者のキーでは動かせない ===');
{
  const env=env0();
  await setCfg(env,{});
  const r=await asJson(await worker.fetch(
    new Request('https://x/sub/send',{ method:'POST',
      headers:{'X-PJ-Key':'staff-key-123','content-type':'application/json'},
      body:JSON.stringify({ approve:true }) }),env,{}));
  console.log('   '+r.status+' '+JSON.stringify(r.body).slice(0,120));
  ok(r.status===403,'★★★作業者のキーでは配信できない');
  ok(/会員向けの配信/.test(JSON.stringify(r.body)),'★★理由も返す');
}

T.done();
