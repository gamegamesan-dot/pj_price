/* 決まり：採寸から「限定版」とみなす（8.58・カジの依頼）

   カジの報告（11/17）
   「JAN 4589864470205 を実物の写真で確かめました。ぬいぐるみ・ブックレット
     付きの限定版（PS4）の箱で、宅配便60で正しいです」

   ・機種がゲームなのに、**採寸がクリックポストに入らない**品は、
     商品名に「限定版」が無くても**限定版とみなす**
   ・モニター（ゲームソフトは通常版だけ）の候補から**外す**
   ・手で送り方を上書きした品は**カジの判断に従う**（みなさない）
   ・採寸が無い品は**みなさない**（当てずっぽうにしない）
   決まりは shared/shopcsv.js の bigGame の1か所（画面も pj-sync も同じ）。 */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const SHOPCSV=require('../shared/shopcsv.js');
const SUBPLAN=require('../shared/subplan.js');
const T=harness('決まり：採寸から限定版とみなす（8.58）');
const ok=T.ok;
const { worker }=await loadWorker('bigver');

const game=(o)=>Object.assign({ kishu:'NS', size_long:17, size_wid:13,
  size_hei:1.5, size_g:100 },o||{});

console.log('=== ① 決まり（shared/shopcsv.js の bigGame）===');
{
  ok(SHOPCSV.bigGame(game(),{})===false,
     '★★★ふつうのゲーム（17×13×1.5cm）は限定版とみなさない');
  /* カジが確かめた品（ぬいぐるみ・ブックレット付き・宅配便60）。 */
  const big=game({ kishu:'PS4', size_long:25, size_wid:20, size_hei:10,
    size_g:900 });
  ok(SHOPCSV.bigGame(big,{})===true,
     '★★★機種はゲームでも、採寸が箱なら限定版とみなす');
  ok(String(SHOPCSV.shipWay(big,{}).name||'')==='宅配便（60サイズ）',
     '★送り方は宅配便60（採寸から）');
  /* 厚さだけ超える品（クリックポストは厚さ3cm まで）。 */
  ok(SHOPCSV.bigGame(game({ size_hei:4 }),{})===true,
     '★★★厚さが3cm を超えるだけでも箱＝限定版とみなす');
  ok(SHOPCSV.bigGame(game({ size_hei:3 }),{})===false,
     '★★ちょうど3cm は入る（みなさない）');
  /* 採寸が無い・手で上書き・ゲームでない。 */
  ok(SHOPCSV.bigGame({ kishu:'NS' },{})===false,
     '★★★採寸が無い品はみなさない（当てずっぽうにしない）');
  ok(SHOPCSV.bigGame(game({ kishu:'PS4', size_long:25, size_wid:20,
    size_hei:10, size_g:900, ship_way:'cp' }),{})===false,
     '★★★手で送り方を直した品は、カジの判断に従う');
  ok(SHOPCSV.bigGame({ kishu:'FIG', size_long:25, size_wid:20,
    size_hei:10, size_g:900 },{})===false,
     '★★★機種がゲームでない品（フィギュア）は関係ない');
  /* ⚙「薄物とみなす機種」で足した機種も同じ見方。 */
  ok(SHOPCSV.bigGame({ kishu:'PS5', size_long:25, size_wid:20,
    size_hei:10, size_g:900 },{ thinKishu:'PS5' })===true,
     '★★⚙で薄物に足した機種でも、採寸が箱なら限定版とみなす');
}

console.log('\n=== ② モニター（通常版だけ）から外れる ===');
{
  const mon=SUBPLAN.list({}).filter((p)=>p.key==='monitor')[0];
  const r=(o)=>Object.assign({ jan:'4589864470205', name:'アイザック',
    grades:'', fit:true, rst:'ok', price:3000 },o||{});
  ok(SUBPLAN.fitWhy(mon,r(),true)==='',
     '★★名前に「限定版」が無ければ、今までは通っていた');
  const why=SUBPLAN.fitWhy(mon,r({ big_box:true }),true);
  console.log('   '+why);
  ok(/通常版ではありません/.test(why)&&/採寸から（箱）/.test(why),
     '★★★採寸から限定版とみなした品は「通常版ではありません（採寸から（箱））」');
  ok(SUBPLAN.fits(mon,r({ big_box:true }),true)===false,
     '★★★モニターの候補から外れる');
  /* ほかのプランには出る。 */
  const light=SUBPLAN.list({}).filter((p)=>p.key==='light')[0];
  ok(SUBPLAN.fits(light,r({ big_box:true }),true)===true,
     '★★★ライト（通常版だけではない）には出る');
  /* 名前の言葉でみなす今までの道も残っている。 */
  const nm=SUBPLAN.normalOf('ゲームA 限定版',null);
  ok(nm.ok===false&&nm.hit==='限定版',
     '★★名前の言葉（限定版）の判定は今までどおり');
}

console.log('\n=== ③ pj-sync も同じ（モニターに出さない）===');
const CH='1111111111';
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz' });
globalThis.fetch=async(u,i)=>{
  const url=String(u);
  if(/discord\.com\/api/.test(url)){
    const cc=/\/channels\/(\d+)$/.exec(url);
    if(cc)return new Response(JSON.stringify({ id:cc[1], name:'c',
      guild_id:'5' }),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({ id:'900001' }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  return new Response('{}',{status:200});
};
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, gdIdxOn:false,
      subOnMonitor:true, subChMonitor:CH,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
const add=async(env,jan,o)=>{
  const at=new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,
       created_at) VALUES (?1,'いろは',0,?2,?3,20,'h',?4,?4)`)
    .bind(jan,(o||{}).kishu||'NS',(o||{}).name||'ゲーム',at).run();
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,fee_total,fee_ref,fee_tax,
       size_tier,size_long,size_wid,size_hei,size_g,rank,rank_cat,new_n,
       checked_at,basis,price_at)
     VALUES (?1,?2,?3,9000,1200,900,90,'s',?4,?5,?6,?7,900,'ゲーム',3,?8,
             'カート',?8)`)
    .bind(jan,'B0BIG'+jan.slice(-5),(o||{}).name||'ゲーム',
          (o||{}).long||17,(o||{}).wid||13,(o||{}).hei||1.5,
          (o||{}).g||100,at).run();
  await env.DB.prepare(
    `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,
       at,created_at) VALUES (?1,1,1,3000,'',?2,?2,?2,?2)`)
    .bind(jan,at).run();
};
{
  const env=env0();
  await setCfg(env,{});
  /* ふつうのゲームと、限定版の箱（カジの品と同じ形）。 */
  await add(env,'4902370550001',{ name:'ふつうのゲーム' });
  await add(env,'4589864470205',{ name:'アイザック', kishu:'PS4',
    long:25, wid:20, hei:10, g:900 });
  const d=await api(env,'/sub/plan');
  const mon=(d.plans||[]).filter((p)=>p.key==='monitor')[0]||{};
  const jans=(mon.items||[]).map((x)=>String(x.jan));
  console.log('   '+JSON.stringify({ jans:jans, why:mon.why }));
  ok(jans.indexOf('4902370550001')>=0,'★★ふつうのゲームはモニターに出る');
  ok(jans.indexOf('4589864470205')<0,
     '★★★採寸から限定版とみなした品は、モニターに出さない');
  /* 限定版の箱だけのときは、0件の理由に出る。 */
  const e2=env0();
  await setCfg(e2,{});
  await add(e2,'4589864470205',{ name:'アイザック', kishu:'PS4',
    long:25, wid:20, hei:10, g:900 });
  const d2=await api(e2,'/sub/plan');
  const mon2=(d2.plans||[]).filter((p)=>p.key==='monitor')[0]||{};
  console.log('   0件の理由 '+JSON.stringify(mon2.why||''));
  ok((mon2.items||[]).length===0
     &&/通常版ではありません|採寸から/.test(String(mon2.why||'')),
     '★★0件の理由にも「通常版ではありません（採寸から（箱））」が出る');
}

T.done();
