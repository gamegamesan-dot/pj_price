/* Worker：1点もの（秋葉原などで仕入れた商品）の登録と配信（8.22・カジの依頼【2】）

   ① 登録（POST /one）… 商品名だけでも登録できる。Handle は one-<連番>
   ② 写真はカジが撮った写真だけ（KV に置く・Amazon／MW の画像は使わない）
   ③ Amazon の値段と手数料（GET /one/amz）… mw_amz があればそれを使う
   ④ 配信 … #目玉商品-先行（プレミアム）→ ⚙の時間のあと #目玉商品
   ⑤ モニター・ライトには出ない／0件のときは理由を出す
   ⑥ 売り切れたら完売に書き換える（注文の取り込みは今の仕組みのまま）
   ⑦ one- の商品は海外向け（os-）の CSV に混ざらない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import SUBPLAN from '../shared/subplan.js';
import SHOPCSV from '../shared/shopcsv.js';
import OSSCSV from '../shared/osscsv.js';
const T=harness('Worker：1点ものの登録と配信（8.22）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('one');

let dc=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/discord\.com\/api\/v/.test(url)&&/\/channels\//.test(url)){
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    const body=o.body;
    const form=(typeof FormData!=='undefined'&&body instanceof FormData);
    dc.push({ method:String(o.method||'GET'), ch:m[1]||'', msg:m[2]||'',
      form:form,
      payload:form?JSON.parse(String(body.get('payload_json')||'{}'))
                  :JSON.parse(String(body||'{}')),
      file:form?body.get('files[0]'):null });
    return new Response(JSON.stringify({ id:String(900000+dc.length) }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  return new Response('{}',{status:200});
};
const CH={ pre:'777', hot:'888', monitor:'111' };
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
                         DISCORD_BOT_TOKEN:'bot-token-xyz' });
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subChPre:CH.pre, subChHot:CH.hot,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
const ITEM={ name:'ガンダム RG νガンダム', cond:'中古',
  cond_note:'箱にスレ', cost:2000, price:4800, qty:1, ship_kind:'box',
  note:'開封済み・説明書あり' };
const planOf=(d,k)=>((d.plans||[]).filter((p)=>p.key===k)[0]||{});
const PIC='iVBORw0KGgoAAAANSUhEUg==';

console.log('=== ① 登録（商品名だけでもよい）===');
{
  const env=env0();
  await setCfg(env,{});
  const r=await api(env,'/one',ITEM);
  ok(r.ok&&r.id>0,'★★★登録できる');
  ok(r.handle==='one-'+r.id,'★★★Handle は one-<連番>');
  const d=await api(env,'/one');
  ok(d.n===1,'★一覧に出る');
  const x=d.rows[0];
  ok(x.name===ITEM.name&&x.cond==='中古'&&x.cond_note==='箱にスレ',
     '★★状態とメモを控える');
  ok(x.price===4800&&x.cost===2000&&x.qty===1,'★★値段・仕入原価・数量');
  ok(x.jan==='one-'+r.id,'★★★配信のキーは one-<連番>（JAN が無くてもよい）');
  ok(x.left===1,'★残りは数量 − 注文');
  const r2=await api(env,'/one',{ name:'名前だけ' });
  ok(r2.ok&&r2.id>0,'★★★JAN も ASIN も無くても登録できる');
  const r3=await api(env,'/one',{ name:'' });
  ok(r3.ok===false&&r3.error==='no_name','★名前が無ければ断る');
  /* 直す */
  const r4=await api(env,'/one',{ id:r.id, ...ITEM, price:5200 });
  ok(r4.ok&&r4.id===r.id,'★★同じ番号を直せる');
  ok((await api(env,'/one')).rows.filter((y)=>y.one_id===r.id)[0].price===5200,
     '★★直した値段が入る');
}

console.log('=== ② 写真（カジが撮った写真だけ）===');
{
  const env=env0();
  await setCfg(env,{});
  const r=await api(env,'/one',{ ...ITEM, pic:PIC, pic_type:'image/png',
                                 pic_name:'gundam.png' });
  ok(r.ok&&r.pic===true,'★★★写真を控える');
  ok(!!(await env.SYNC_CACHE.get('one:pic:'+r.id)),
     '★★★写真は KV に置く（D1 に入れない）');
  const d=await api(env,'/one');
  ok(d.rows[0].pic===true,'★一覧で写真ありが分かる');
  ok(d.rows[0].pic_type==='image/png','★形も控える');
  const ng=await api(env,'/one',{ id:r.id, ...ITEM, pic:PIC,
                                  pic_type:'application/pdf' });
  ok(ng.ok===false&&ng.error==='pic_type','★★画像でないファイルは断る');
  const big=await api(env,'/one',{ id:r.id, ...ITEM,
    pic:'A'.repeat(2*1024*1024+10), pic_type:'image/jpeg' });
  ok(big.ok===false&&big.error==='pic_big','★★大きすぎる写真は断る');
  /* 写真を消す */
  await api(env,'/one',{ id:r.id, ...ITEM, pic:'' });
  ok(!(await env.SYNC_CACHE.get('one:pic:'+r.id)),'★写真を消せる');
}

console.log('=== ③ Amazon の値段と手数料 ===');
{
  const env=env0();
  await setCfg(env,{});
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,fee_total,basis,price_at,checked_at)
     VALUES (?1,'B0D1GSZJ8T','Amazonの名前',9000,1200,'カート',?2,?2)`)
    .bind('4902370550467',new Date().toISOString()).run();
  const a=await api(env,'/one/amz?jan=4902370550467&cost=2000');
  ok(a.ok&&a.price===9000&&a.fee===1200,
     '★★★取り込み済み（mw_amz）があれば API を使わずに返す');
  ok(a.gross===5800,'★★★見込みの粗利＝販売価格 − 手数料 − 仕入原価');
  ok(a.src==='mw_amz','★どこから取ったか返す');
  ok(a.asin==='B0D1GSZJ8T','★ASIN も返す');
  const n=await api(env,'/one/amz');
  ok(n.ok===false&&n.error==='no_key','★JAN も ASIN も無ければ断る');
  const r=await api(env,'/one',ITEM);
  const p=await api(env,'/one/amz',{ id:r.id, price:9000, fee:1200,
    basis:'カート', gross:5800, asin:'B0D1GSZJ8T' });
  ok(p.ok,'★★控えられる');
  const d=await api(env,'/one');
  ok(d.rows[0].amz_price===9000&&d.rows[0].gross===5800,
     '★★★控えた値が一覧に出る');
}

console.log('=== ④ 配信（先行 → ⚙の時間のあと みんな）===');
{
  const env=env0();
  await setCfg(env,{ subPreHours:24 });
  const r=await api(env,'/one',{ ...ITEM, pic:PIC, pic_type:'image/png' });
  /* 「Shopify に読み込みました」の印が要る。 */
  let d=await api(env,'/sub/plan');
  ok(/読み込みました/.test(planOf(d,'one_pre').why||''),
     '★★★印が無いうちは出さない（理由を出す）');
  await api(env,'/one/mark',{ ids:[r.id], loaded:1 });
  d=await api(env,'/sub/plan');
  ok(planOf(d,'one_pre').items.length===1,'★★★印を付けると先行に出る');
  ok(/まだ先行に出していません/.test(planOf(d,'one_open').why||''),
     '★★★#目玉商品 はまだ（先行が先）');
  ok(planOf(d,'one_pre').name.indexOf('目玉商品-先行')>=0,'★名前が出る');
  dc=[];
  const s1=await api(env,'/sub/send',{ approve:true, plan:'one_pre' });
  ok(s1.sent===1&&dc.length===1&&dc[0].ch===CH.pre,
     '★★★先行のチャンネルだけに送る');
  ok(dc[0].form===true,'★★★写真は添付として一緒に送る');
  ok(/attachment:\/\/pic\.png/.test(JSON.stringify(dc[0].payload)),
     '★★★カードの写真は添付を指す');
  const emb=dc[0].payload.embeds[0];
  ok(emb.fields.some((f)=>f.name==='状態'&&/中古（箱にスレ）/.test(f.value)),
     '★★★カードに状態が出る');
  ok(emb.fields.some((f)=>f.name==='メモ'&&/開封済み/.test(f.value)),
     '★★★カードにメモが出る');
  ok(emb.fields.some((f)=>f.name==='送料'&&/宅配便/.test(f.value)),
     '★★★送料は選んだ区分の名前');
  ok(emb.fields.some((f)=>/購入リンク/.test(f.name)&&/products\/one-/.test(f.value)),
     '★★★購入リンクは one-<連番>');
  ok(!emb.fields.some((f)=>f.name==='JAN'),'★★JAN が無ければ JAN 欄を出さない');
  /* 先行のあいだは #目玉商品 に出ない。 */
  dc=[];
  const s2=await api(env,'/sub/send',{ approve:true, plan:'one_open' });
  ok(s2.sent===0&&dc.length===0,'★★★⚙の時間が来るまで #目玉商品 に出さない');
  d=await api(env,'/sub/plan');
  console.log('   one_open の理由：'+(planOf(d,'one_open').why||'(なし)'));
  ok(/時間待ちです/.test(planOf(d,'one_open').why||''),'★★あと何時間かを出す');
  /* 先行を25時間前にして、時間が来たことにする。 */
  await env.DB.prepare(`UPDATE one_item SET pre_at=?2 WHERE id=?1`)
    .bind(r.id,new Date(Date.now()-25*3600*1000).toISOString()).run();
  d=await api(env,'/sub/plan');
  ok(planOf(d,'one_open').items.length===1,'★★★時間がたてば #目玉商品 に出る');
  dc=[];
  const s3=await api(env,'/sub/send',{ approve:true, plan:'one_open' });
  ok(s3.sent===1&&dc.length===1&&dc[0].ch===CH.hot,
     '★★★#目玉商品 に送る（先行はもう送り済みなので送り直さない）');
}

console.log('=== ⑤ モニター・ライトには出ない ===');
{
  const env=env0();
  await setCfg(env,{ subChMonitor:CH.monitor, subOnLight:1, subChLight:'222' });
  const r=await api(env,'/one',ITEM);
  await api(env,'/one/mark',{ ids:[r.id], loaded:1 });
  const d=await api(env,'/sub/plan');
  ok(planOf(d,'monitor').items.length===0,
     '★★★1点ものはモニターに出ない');
  ok(planOf(d,'light').items.length===0,'★★★ライトにも出ない');
  ok(planOf(d,'one_pre').items.length===1,'★★先行には出る');
  dc=[];
  await api(env,'/sub/send',{ approve:true, plan:'monitor' });
  ok(dc.length===0,'★★★モニターを送っても1点ものは送らない');
  /* チャンネルID が無いときの理由。 */
  const env2=env0();
  await setCfg(env2,{ subChPre:'' });
  const r2=await api(env2,'/one',ITEM);
  await api(env2,'/one/mark',{ ids:[r2.id], loaded:1 });
  const d2=await api(env2,'/sub/plan');
  ok(/チャンネルID/.test(planOf(d2,'one_pre').why||''),
     '★★★チャンネルID が無ければ理由を出す');
  /* 1点ものが1件も無いとき。 */
  const env3=env0();
  await setCfg(env3,{});
  const d3=await api(env3,'/sub/plan');
  ok(/1点ものがありません/.test(planOf(d3,'one_pre').why||''),
     '★★0件の理由（登録がない）');
}

console.log('=== ⑥ 売り切れたら完売に書き換える ===');
{
  const env=env0();
  await setCfg(env,{});
  const r=await api(env,'/one',ITEM);
  await api(env,'/one/mark',{ ids:[r.id], loaded:1 });
  await api(env,'/sub/send',{ approve:true, plan:'one_pre' });
  dc=[];
  const sku='ONE-'+r.id+'-20261114';
  const o=await api(env,'/sub/orders',{ name:'orders.csv',
    text:'Name,Lineitem quantity,Lineitem sku\n#1001,1,'+sku+'\n' });
  ok(o.ok&&o.added===1,'★★★1点ものの注文も今の取り込みで入る（ONE- の SKU）');
  ok(o.sold_out===1,'★★★完売にしたカード 1件');
  const ed=dc.filter((x)=>x.method==='PATCH');
  ok(ed.length===1,'★★★カードを書き換える');
  ok(/完売しました/.test(JSON.stringify(ed[0].payload)),
     '★★★「完売しました」に書き換わる');
  const d=await api(env,'/one');
  ok(d.rows[0].sold===1&&d.rows[0].left===0,'★★残りが0になる');
}

console.log('=== ⑦ Shopify 用 CSV と、海外向けに混ざらないこと ===');
{
  const it={ id:3, name:'ガンダム RG νガンダム', cond:'中古',
             cond_note:'箱にスレ', price:4800, qty:1, sold:0, cost:2000,
             ship_kind:'box', note:'開封済み', grades:'premium' };
  const csv=SHOPCSV.oneBuild([it],{});
  const rows=SHOPCSV.splitCsv(csv);
  const cell=(n)=>rows[1][rows[0].indexOf(n)];
  ok(cell('Handle')==='one-3','★★★Handle は one-<連番>');
  ok(/^ONE-3-\d{8}$/.test(cell('Variant SKU')),'★★★SKU は ONE-<連番>-<日付>');
  ok(/member-list/.test(cell('Tags'))&&/grade-premium/.test(cell('Tags')),
     '★★★タグは member-list と grade-premium');
  ok(!/grade-standard/.test(cell('Tags')),'★★★先行のあいだは premium だけ');
  ok(cell('Cost per item')==='2000','★★仕入原価は Cost per item');
  ok(cell('Variant Inventory Qty')==='1','★在庫は残り');
  ok(csv.indexOf('Image Src')<0&&csv.indexOf('Product image URL')<0,
     '★★★写真は CSV に入れない（カジが Shopify で入れる）');
  ok(/状態：中古（箱にスレ）/.test(cell('Body (HTML)')),'★★説明に状態');
  ok(/メモ：開封済み/.test(cell('Body (HTML)')),'★★説明にメモ');
  const open=SHOPCSV.oneBuild([{ ...it, grades:SUBPLAN.oneGrades({},true) }],{});
  ok(/grade-standard/.test(open)&&/grade-premium/.test(open),
     '★★★先行があいたら ⚙ のプランも足す');
  /* 海外向け（os-）には混ざらない。 */
  const os={ jan:'4902370550467', titleEn:'T', descHtml:'<p>x</p>', usd:10,
             qty:1, grams:100, cost:100, pics:[{url:'https://img.jp/a.jpg'}] };
  ok(OSSCSV.whyNot({ ...os, handle:'one-3' },{fx:160})==='会員向けの行です',
     '★★★one- の商品は海外向け CSV に入らない');
  ok(OSSCSV.whyNot({ ...os, one:true },{fx:160})==='会員向けの行です',
     '★★★1点ものの印でも入らない');
  ok(OSSCSV.build([{ ...os, handle:'one-3' }],{fx:160}).indexOf('one-')<0,
     '★★★海外向け CSV に one- が出ない');
  ok(SHOPCSV.oneBuild([it],{}).indexOf('os-')<0,
     '★★★1点ものの CSV に os- が出ない');
}

console.log('=== 鍵と、表が無いとき ===');
{
  const env=env0();
  const key={'X-PJ-Key':'staff-key-123','content-type':'application/json'};
  const r1=await worker.fetch(new Request('https://x/one',{ headers:key }),env,{});
  ok(r1.status===403,'★★★作業者用のキーでは触れない');
  const { worker:w2 }=await loadWorker('one-notable');
  const env2=env0();
  env2.DB._db.exec('DROP TABLE one_item');
  const d=(await asJson(await w2.fetch(get('/one'),env2,{}))).body;
  ok(d.table_ok===false&&/migrate-0059/.test(String(d.detail||'')),
     '★★表が無ければ migrate-0059 を案内する');
  ok(W.schemaFixOf('one_item')==='migrate-0059-one-item.sql',
     '★足りない表 → migrate-0059');
}

T.done();
