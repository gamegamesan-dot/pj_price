/* Worker：海外向け Shopify（os-）の在庫・値段の追従（7.143・カジの依頼【3】）

   ① POST /os/put … Shopify 用 CSV を書き出した商品を控える
   ② MW の取り込みのあと … 品切れ・値段が変わった商品に印を付け、
      社内用の Discord に「Shopify に読み込んでください ◯件」と知らせる
   ③ GET /os/diff … 直しが要る行（画面が直しCSVを作るのに使う）
   ④ POST /os/done … Shopify に読み込んだら印を消す
   ⑤ 会員向け（sub-）とは混ざらない・作業者用のキーでは触れない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import OSSCSV from '../shared/osscsv.js';
const T=harness('Worker：海外向け Shopify の追従（7.143）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('osfix');

let msg=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/discord/.test(url)){
    const b=JSON.parse(String(o.body||'{}'));
    msg.push(String(b.content||''));
    ((b.embeds)||[]).forEach((e)=>msg.push(JSON.stringify(e)));
    return new Response(null,{status:204});
  }
  return new Response('{}',{status:200});
};
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123' });
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
const row=(o)=>Object.assign({ sha:'いろは商会', idx:0, kishu:'NS',
  name:'商品'+o.jan, list_price:7678, release:'', cond:'新品',
  wholesale:3000, note:'', ship_text:'即日', ship_days:0 },o);
const impo=async(env,at,rows)=>await api(env,'/mw/stock',
  { at:at, part:1, parts:1, rows_in:rows.length, rows:rows });
/* 3割の歯止めが効かないよう、動かさない行を並べておく。 */
const fill=(n)=>{ const a=[]; for(let i=0;i<(n||12);i++)
  a.push(row({ jan:'49023709'+String(i).padStart(5,'0'), stock:9 })); return a; };
const F=fill(12);
const J='4902370550467';
const item=(o)=>Object.assign({ jan:J, name:'Super Mario Party Jamboree',
  usd:49.99, fx:160, pct:100, price:7998, qty:1, wholesale:3000, stock:5 },o);
const osRow=async(env,jan)=>(await env.DB.prepare(
  `SELECT * FROM os_item WHERE jan=?1`).bind(jan||J).first())||{};

console.log('=== ① 書き出した商品を控える（POST /os/put）===');
{
  const env=env0();
  const r=await api(env,'/os/put',{ items:[item({})] });
  ok(r.ok&&r.n===1,'★★★1件を控える');
  const o=await osRow(env);
  ok(o.handle==='os-4902370550467','★★★Handle は os-<JAN>');
  ok(o.sku==='W-4902370550467','★★★SKU は eBay と同じ W-<JAN>');
  ok(Math.round(o.price)===7998&&Math.round(o.qty)===1,'★値段と数量を控える');
  ok(Math.round(o.wholesale)===3000,'★★そのときの卸値を控える（値段の変化を見る元）');
  ok(!o.fix_at,'★控えた直後は直し不要');
  const r2=await api(env,'/os/put',{ items:[item({ price:8500, qty:2 })] });
  ok(r2.n===1&&Math.round((await osRow(env)).price)===8500,
     '★★同じ JAN は上書きする（1商品1行）');
  const bad=await api(env,'/os/put',{ items:[item({ jan:'12' })] });
  ok(bad.ok&&bad.n===0,'★JAN がおかしい行は控えない');
}

console.log('=== ② 品切れを見つけて知らせる ===');
{
  const env=env0();
  msg=[];
  await impo(env,'2026-11-13T00:00:00Z',[...F,row({ jan:J, stock:5 })]);
  await api(env,'/os/put',{ items:[item({})] });
  msg=[];
  /* MW の CSV から行が消える＝品切れ */
  await impo(env,'2026-11-13T06:00:00Z',F);
  const o=await osRow(env);
  ok(String(o.fix_why||'')==='gone','★★★品切れは gone の印');
  ok(Math.round(o.fix_qty)===0,'★★★直したあとの数量は0');
  ok(!!o.fix_at,'★★直しが要るようになった日時が入る');
  const t=msg.join('\n');
  ok(/Shopify に読み込んでください/.test(t),
     '★★★社内用の Discord に「Shopify に読み込んでください ◯件」');
  ok(/1件/.test(t),'★★件数が出る');
  ok(t.indexOf(J)>=0,'★どの商品かが分かる');
  /* 同じ理由でもう印が付いているときは知らせ直さない */
  msg=[];
  await impo(env,'2026-11-13T12:00:00Z',F);
  ok(msg.join('\n').indexOf('Shopify に読み込んでください')<0,
     '★★★同じ商品を毎回は知らせない');
}

console.log('=== ② 値段が変わったときも知らせる ===');
{
  const env=env0();
  await impo(env,'2026-11-13T00:00:00Z',[...F,row({ jan:J, stock:5 })]);
  await api(env,'/os/put',{ items:[item({})] });
  msg=[];
  await impo(env,'2026-11-13T06:00:00Z',
    [...F,row({ jan:J, stock:5, wholesale:3400 })]);
  const o=await osRow(env);
  ok(String(o.fix_why||'')==='price','★★★卸値が変わったら price の印');
  ok(Math.round(o.fix_qty)===1,'★★数量はそのまま（値段だけ直す）');
  const t=msg.join('\n');
  ok(/Shopify に読み込んでください/.test(t),'★★★知らせが出る');
  ok(/3000/.test(t)&&/3400/.test(t),'★★卸値の前と後が出る');
}
{
  const env=env0();
  await impo(env,'2026-11-13T00:00:00Z',[...F,row({ jan:J, stock:5 })]);
  await api(env,'/os/put',{ items:[item({})] });
  msg=[];
  await impo(env,'2026-11-13T06:00:00Z',
    [...F,row({ jan:J, stock:5, wholesale:3010 })]);
  ok(!(await osRow(env)).fix_at,
     '★★★わずかな違い（3000→3010・0.3%）では直さない（既定 1%）');
}
{
  const env=env0();
  await env.DB.prepare(
    `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
     ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
    .bind(JSON.stringify({ at:'2026-11-13T00:00:00Z',
      settings:{ osFixPct:10 } }),'2026-11-13T00:00:00Z').run();
  await impo(env,'2026-11-13T00:00:00Z',[...F,row({ jan:J, stock:5 })]);
  await api(env,'/os/put',{ items:[item({})] });
  await impo(env,'2026-11-13T06:00:00Z',
    [...F,row({ jan:J, stock:5, wholesale:3100 })]);
  ok(!(await osRow(env)).fix_at,
     '★★★⚙「値段が変わったとみなす割合」を10%にすると 3000→3100 は直さない');
}
console.log('=== 見立ての決まり（osFixOf）===');
{
  const f=(r)=>W.osFixOf(r,1);
  ok(f({ live:1, now_stock:5, wholesale:3000, now_px:3000, qty:1 }).why==='',
     '★変わっていなければ直し不要');
  ok(f({ live:0, now_stock:0, wholesale:3000, now_px:0, qty:1 }).why==='gone',
     '★★MW から消えたら品切れ');
  ok(f({ live:1, now_stock:0, wholesale:3000, now_px:3000, qty:1 }).why==='gone',
     '★★★在庫0でも品切れ');
  ok(f({ live:0, now_stock:0, wholesale:3000, now_px:0, qty:0 }).why==='',
     '★★★もう数量0で出しているなら直しは済んでいる');
  ok(f({ live:1, now_stock:2, wholesale:3000, now_px:3000, qty:5 }).qty===2,
     '★★★数量は MW の在庫を超えない');
  ok(W.osPxPct({})===1&&W.osPxPct({ osFixPct:5 })===5,
     '★★⚙の割合（既定 1%）');
}

console.log('=== ③ 直しが要る行（GET /os/diff）===');
{
  const env=env0();
  await impo(env,'2026-11-13T00:00:00Z',[...F,row({ jan:J, stock:5 })]);
  await api(env,'/os/put',{ items:[item({})] });
  const none=await api(env,'/os/diff');
  ok(none.ok&&none.n===0,'★直しが無ければ0件');
  await impo(env,'2026-11-13T06:00:00Z',F);
  const d=await api(env,'/os/diff');
  ok(d.ok&&d.n===1,'★★★品切れの1件が出る');
  const x=d.rows[0];
  ok(x.handle==='os-4902370550467'&&x.sku==='W-4902370550467',
     '★★Handle と SKU で突き合わせる');
  ok(x.why==='gone'&&x.fix_qty===0,'★★★理由と直したあとの数量');
  ok(x.usd===49.99&&x.fx===160&&x.pct===100,
     '★★★書き出したときの売値・為替・⚙% を返す（画面が値段を出し直せる）');
  ok(!!x.fix_at_jst,'★日本時間の表示も返す');
}

console.log('=== ④ 読み込んだら印を消す（POST /os/done）===');
{
  const env=env0();
  await impo(env,'2026-11-13T00:00:00Z',[...F,row({ jan:J, stock:5 })]);
  await api(env,'/os/put',{ items:[item({})] });
  await impo(env,'2026-11-13T06:00:00Z',F);
  const r=await api(env,'/os/done',{ items:[{ jan:J, qty:0, price:7998 }] });
  ok(r.ok&&r.n===1,'★★★1件を読み込み済みにする');
  const o=await osRow(env);
  ok(!o.fix_at&&!o.fix_why,'★★★直しの印が消える');
  ok(Math.round(o.qty)===0,'★★読み込んだ数量に書き替える');
  ok(!!o.done_at,'★読み込んだ日時が入る');
  ok((await api(env,'/os/diff')).n===0,'★★直しの一覧から消える');
  msg=[];
  await impo(env,'2026-11-13T12:00:00Z',F);
  ok(msg.join('\n').indexOf('Shopify に読み込んでください')<0,
     '★★★読み込み済みの品切れを知らせ直さない');
}

console.log('=== ⑤ 会員向けと混ざらない・鍵（カジの依頼【4】）===');
{
  const env=env0();
  await api(env,'/os/put',{ items:[item({})] });
  const o=await osRow(env);
  ok(String(o.handle).indexOf('sub-')<0,'★★★os_item に sub- の Handle は入らない');
  ok(OSSCSV.handleOf(J)!=='sub-'+J,'★★★会員用とは別の商品');
  const sub=await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mw_sub WHERE jan=?1`).bind(J).first();
  ok(Number((sub&&sub.n)||0)===0,
     '★★★海外向けに出しても会員向け（mw_sub）には入らない');
  const key={'X-PJ-Key':'staff-key-123','content-type':'application/json'};
  const r1=await worker.fetch(new Request('https://x/os/diff',{ headers:key }),env,{});
  ok(r1.status===403,'★★★作業者用のキーでは海外向けの窓口を触れない');
  const r2=await worker.fetch(new Request('https://x/os/put',
    { method:'POST', headers:key, body:'{}' }),env,{});
  ok(r2.status===403,'★★★控えるのも管理者だけ');
}

console.log('=== 表が無くても落ちない ===');
{
  /* 列があるかの答えは worker.js の中で覚えているので、別に読み込む。 */
  const { worker:w2, T:W2 }=await loadWorker('osfix-notable');
  const env=env0();
  env.DB._db.exec('DROP TABLE os_item');
  const api2=async(path,body)=>(await asJson(await w2.fetch(
    body?post(path,body):get(path),env,{}))).body;
  const r=await api2('/os/put',{ items:[item({})] });
  ok(r.ok===false&&r.error==='no_table','★表が無ければ no_table を返す');
  ok(/migrate-0058/.test(String(r.detail||'')),'★★流すマイグレーションを教える');
  const d=await api2('/os/diff');
  ok(d.table_ok===false,'★一覧も落ちない');
  ok(W2.schemaFixOf('os_item')==='migrate-0058-os-item.sql',
     '★★★足りない表 → migrate-0058 を案内する');
}

T.done();
