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
const amz=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,checked_at)
   VALUES (?1,?2,?3,?4,?5,?6,?7)`)
  .bind(jan,(o||{}).asin||'B0D1GSZJ8T',(o||{}).name||'Amazonの名前',
        (o||{}).price||9000,(o||{}).fee||1200,(o||{}).tier||'s',
        new Date().toISOString()).run();
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
