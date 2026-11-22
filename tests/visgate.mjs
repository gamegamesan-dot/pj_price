/* Worker：非公開を確かめてから配る（8.89）

   カジの依頼（2026-11-22）CSV は draft で出し、API で非公開（UNLISTED）に
   する（8.88）。あわせて：
   ① 「Shopify に読み込みました」を押した品だけ、そろえて**確かめる**
      （/shop/unlist に handles。pj が知っている sub-・one- だけ・os- は見ない）
   ② 非公開・オンラインストア・海外向けカタログ（Overseas products）から
      外れたことを**直したあとにもう一度読んで**確かめ、品ごとに控える
   ③ 確かめた品だけ新しく配る。draft・active のままの品は配らず、
      配信の案に理由を出す（出ているカードは今までどおり書き換える）
   ④ 1点もの（one-）も同じ。Shopify の画面で直してあった品は、触らずに
      確かめるだけで ok になる（one-1 のケース）
   ⑤ 自動配信（jobSubAuto）は、配る前に確かめていない品をそろえて確かめる
   ⑥ ⚙ でオフ・Shopify の鍵が無い D1 では止めない（理由を出す） */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：非公開を確かめてから配る（8.89）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('visgate');

/* ---- 作り物の Shopify と Discord ---- */
let gql=[], prods={}, dc=[], noOver=false, stuckOver={};
/* 8.89 直し：マーケットのカタログ（publications に出てこない店のため）。 */
let cats=null, catsErr='', catById={}, same=[], tokN=0;
const OVER='gid://shopify/Publication/3', ONLINE='gid://shopify/Publication/9';
const J=(v,st)=>new Response(JSON.stringify(v),{status:st||200,
  headers:{'content-type':'application/json'}});
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/myshopify\.com\/admin\/oauth\/access_token/.test(url))
    { tokN++; return J({ access_token:'shpat-SECRET', expires_in:86399,
      scope:'write_products,read_products,write_publications,read_publications' }); }
  if(/myshopify\.com\/admin\/api\//.test(url)){
    const b=JSON.parse(String(o.body||'{}'));
    const name=(/(?:query|mutation)\s+(\w+)/.exec(b.query)||[])[1]||'';
    gql.push({ name, v:b.variables, q:b.query });
    if(name==='pjReady')return J({ data:{ shop:{ name:'店' },
      locations:{ nodes:[{ id:'gid://shopify/Location/1', name:'本店' }] },
      publications:{ nodes:[
        { id:ONLINE, supportsFuturePublishing:true, catalog:{ title:'オンラインストア' } }]
        .concat(noOver?[]:[{ id:OVER, supportsFuturePublishing:false,
                             catalog:{ title:'Overseas products' } }]) } } });
    if(name==='pjCats'){
      if(catsErr)return J({ errors:[{ message:catsErr }] });
      return J({ data:{ catalogs:{ nodes:cats||[] } } });
    }
    if(name==='pjCatId'){
      const c=catById[b.variables.c]||null, pp=catById[b.variables.p]||null;
      return J({ data:{ c:c, p:pp } });
    }
    if(name==='pjSame')return J({ data:{ products:{ nodes:same } } });
    if(name==='pjStat'){
      const h=b.variables.identifier.handle, p=prods[h];
      if(!p)return J({ data:{ productByIdentifier:null } });
      return J({ data:{ productByIdentifier:{ id:'gid://shopify/Product/'+h, handle:h,
        status:p.status, on:p.online!==false, ov0:!!p.over } } });
    }
    if(name==='pjUnlist'){
      const h=b.variables.product.id.split('/').pop();
      prods[h].status=b.variables.product.status;
      return J({ data:{ productUpdate:{ product:{ id:b.variables.product.id,
        status:prods[h].status }, userErrors:[] } } });
    }
    if(name==='pjPub'){ const h=b.variables.id.split('/').pop();
      if(prods[h])prods[h].online=true;
      return J({ data:{ publishablePublish:{ userErrors:[] } } }); }
    if(name==='pjUnpub'){ const h=b.variables.id.split('/').pop();
      /* stuckOver … 外したと返すのに、外れていない（確かめで見つける）。 */
      if(b.variables.pub===OVER&&prods[h]&&!stuckOver[h])prods[h].over=false;
      return J({ data:{ publishableUnpublish:{ userErrors:[] } } }); }
    if(name==='pjSet'){
      const h=b.variables.input.handle;
      prods[h]={ status:'UNLISTED', over:true, online:false };
      return J({ data:{ productSet:{ product:{ id:'gid://shopify/Product/'+h,
        handle:h, status:'UNLISTED', variants:{ nodes:[{ id:'gid://v/'+h,
          inventoryItem:{ id:'gid://shopify/InventoryItem/'+h } }] } },
        userErrors:[] } } });
    }
    if(name==='pjInv')return J({ data:{ inventorySetQuantities:{ userErrors:[] } } });
    return J({ data:{} });
  }
  if(/\/api\/webhooks\//.test(url))return new Response(null,{status:204});
  if(/discord\.com\/api/.test(url)){
    if(/\/channels\/\d+$/.test(url))return J({ id:'0' });
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    const body=o.body;
    const form=(typeof FormData!=='undefined'&&body instanceof FormData);
    const pl=form?JSON.parse(String(body.get('payload_json')||'{}'))
                 :JSON.parse(String(body||'{}'));
    if(pl.embeds||String(o.method||'GET')!=='GET')
      dc.push({ method:String(o.method||'GET'), ch:m[1]||'', msg:m[2]||'', body:pl });
    return J({ id:String(900000+dc.length), name:'部屋', guild_id:'1' });
  }
  return J({});
};
const reset=()=>{ gql=[]; prods={}; dc=[]; noOver=false; stuckOver={};
  cats=null; catsErr=''; catById={}; same=[]; tokN=0; W.shopReset(); };
const NOW=new Date().toISOString();
const CH='1234567890', CH_PRE='777', CH_HOT='888';
const env0=(extra)=>makeEnv(Object.assign({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz',
  SHOPIFY_CLIENT_ID:'cid', SHOPIFY_CLIENT_SECRET:'csec-SECRET' },extra||{}));
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:NOW, settings:Object.assign({ subOn:true,
    subChMonitor:CH, subChPre:CH_PRE, subChHot:CH_HOT, gdIdxOn:false, subMonNote:false,
    subDomain:'omakase-ship.myshopify.com' },o||{}) }),NOW).run();
const api=async(env,path,body,key)=>{
  const r=body?post(path,body):get(path);
  if(key)r.headers.set('X-PJ-Key',key);
  return (await asJson(await worker.fetch(r,env,{}))).body;
};
const stock=(env,jan)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,created_at)
   VALUES (?1,'いろは商会',0,'NS',?2,9,'h',?3,?3)`).bind(jan,'商品'+jan,NOW).run();
const amz=(env,jan)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,checked_at,basis,price_at)
   VALUES (?1,'B0D1GSZJ8T','テストのゲームソフト',9000,1200,'s',?2,'カート',?2)`)
  .bind(jan,NOW).run();
const sub=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
   VALUES (?1,1,1,?2,'',?3,?3,?3,?3)`).bind(jan,(o||{}).price||3645,NOW).run();
const visOf=async(env,jan)=>String(((await env.DB.prepare(
  `SELECT shop_vis FROM mw_sub WHERE jan=?1`).bind(jan).first())||{}).shop_vis||'');
const planOf=(d,k)=>((d.plans||[]).filter((p)=>p.key===k)[0]||{});
const A='4902370550467', B='4902370550474', C='4902370550481';

console.log('=== 状態の読み方（shopVisOf）===');
{
  const rdy={ over_miss:[] };
  ok(W.shopVisOf(null,rdy,1)==='missing','★Shopify に無い');
  ok(W.shopVisOf({ id:'x', status:'ACTIVE' },rdy,1)==='active'
     &&W.shopVisOf({ id:'x', status:'DRAFT' },rdy,1)==='draft'
     &&W.shopVisOf({ id:'x', status:'ARCHIVED' },rdy,1)==='archived',
     '★★★active・draft・archived は ok にしない');
  ok(W.shopVisOf({ id:'x', status:'UNLISTED', on:true, ov0:true },rdy,1)==='over',
     '★★★非公開でも海外向けカタログに入っていれば ok にしない');
  ok(W.shopVisOf({ id:'x', status:'UNLISTED', on:false, ov0:false },rdy,1)==='online',
     '★★オンラインストアに出ていない（リンクで開けない）');
  ok(W.shopVisOf({ id:'x', status:'UNLISTED', on:true, ov0:false },{ over_miss:['Overseas products'] },0)
     ==='over_miss','★★海外向けの商品リストが見つからなければ、確かめられない');
  ok(W.shopVisOf({ id:'x', status:'UNLISTED', on:true, ov0:false },rdy,1)==='ok',
     '★★★非公開・オンラインストア・海外向けから外れている → ok');
  ok(/active/.test(W.shopVisJa('active'))&&/draft/.test(W.shopVisJa('draft'))
     &&/Overseas/.test(W.shopVisJa('over'))&&/確かめていません/.test(W.shopVisJa('')),
     '★理由は日本語で出す');
}

console.log('\n=== ① ② 読み込んだ品だけ、そろえて確かめる ===');
{
  reset();
  const env=env0(); await setCfg(env,{});
  for(const j of [A,B,C]){ await stock(env,j); await amz(env,j); await sub(env,j); }
  prods={ ['sub-'+A]:{ status:'DRAFT', over:true, online:false },
          ['sub-'+B]:{ status:'ACTIVE', over:true },
          ['sub-'+C]:{ status:'DRAFT', over:true },
          ['os-'+A]:{ status:'ACTIVE', over:true } };
  const r=await api(env,'/shop/unlist',{ kind:'sub', approve:true,
    handles:['sub-'+A,'sub-'+B,'os-'+A,'SUB-9999999999999'] });
  console.log('   '+JSON.stringify({ all:r.all, done:r.done, fail:r.fail, ok_all:r.ok_all, vis:r.vis }));
  ok(r.ok&&r.all===2,'★★★押した品（sub-A・sub-B）だけ。os- や知らない Handle は入らない');
  ok(!gql.some((x)=>x.v&&x.v.identifier&&/^os-/.test(x.v.identifier.handle)),
     '★★★os- は読みもしない');
  ok(prods['os-'+A].status==='ACTIVE'&&prods['os-'+A].over===true,
     '★★★海外向けの os- は active のまま（変えない）');
  ok(prods['sub-'+C].status==='DRAFT','★押していない品（sub-C）は触らない');
  ok(r.done===2&&r.ok_all===2&&r.vis['sub-'+A]==='ok'&&r.vis['sub-'+B]==='ok',
     '★★★直したあと、もう一度読んで ok を確かめる');
  const stats=gql.filter((x)=>x.name==='pjStat');
  ok(stats.length===4&&stats.every((x)=>x.v.on===ONLINE&&x.v.o0===OVER),
     '★★★1品につき2回読む（直す前・直したあと）。オンラインストアと海外向けを見る');
  ok(prods['sub-'+A].online===true&&prods['sub-'+A].over===false,
     '★★オンラインストアには出して、海外向けカタログから外す');
  ok(await visOf(env,A)==='ok'&&await visOf(env,B)==='ok'&&await visOf(env,C)==='',
     '★★★確かめた結果を品ごとに控える（mw_sub.shop_vis）');
  /* 外したと返るのに外れていない → 確かめで見つけて「できなかった」にする。 */
  prods['sub-'+C]={ status:'DRAFT', over:true }; stuckOver['sub-'+C]=1;
  const r2=await api(env,'/shop/unlist',{ kind:'sub', approve:true, handles:['sub-'+C] });
  console.log('   外れなかった品：'+JSON.stringify({ done:r2.done, fail:r2.fail, errors:r2.errors }));
  ok(r2.done===0&&r2.fail===1&&/Overseas/.test(r2.errors.join(''))&&await visOf(env,C)==='over',
     '★★★海外向けカタログから外れていなければ ok にしない（理由を返す）');
  /* 確かめるだけ（approve なし）でも状態を控える。 */
  prods['sub-'+B].status='ACTIVE';
  const r3=await api(env,'/shop/unlist',{ kind:'sub', approve:false, handles:['sub-'+B] });
  ok(r3.vis['sub-'+B]==='active'&&await visOf(env,B)==='active'&&prods['sub-'+B].status==='ACTIVE',
     '★★確かめるだけのときは何も変えず、active に戻ったことを控える');
}

console.log('\n=== ③ 確かめた品だけ新しく配る ===');
{
  reset();
  const env=env0(); await setCfg(env,{});
  for(const j of [A,B]){ await stock(env,j); await amz(env,j); await sub(env,j); }
  prods={ ['sub-'+A]:{ status:'UNLISTED', over:false }, ['sub-'+B]:{ status:'DRAFT', over:true } };
  let d=await api(env,'/sub/plan');
  const m=planOf(d,'monitor');
  console.log('   確かめる前：monitor '+(m.items||[]).length+'件・止める '
    +JSON.stringify(d.vis&&d.vis.rows.map((x)=>x.jan+':'+x.why)));
  ok(d.vis&&d.vis.on===true&&d.vis.why==='','★★★Shopify の鍵があれば確かめが効く');
  ok((m.items||[]).length===0&&d.vis.n===2,'★★★まだ確かめていない品は新しく出さない');
  ok(d.vis.rows.every((x)=>/確かめていません/.test(x.why)&&/^sub-/.test(x.handle)),
     '★★★配信の案に理由を出す');
  await api(env,'/shop/unlist',{ kind:'sub', approve:false, handles:['sub-'+A,'sub-'+B] });
  d=await api(env,'/sub/plan');
  const m2=planOf(d,'monitor');
  console.log('   確かめたあと：monitor '+(m2.items||[]).map((x)=>x.jan).join(',')
    +'・止める '+JSON.stringify(d.vis.rows.map((x)=>x.jan+':'+x.why)));
  ok((m2.items||[]).length===1&&m2.items[0].jan===A,'★★★非公開を確かめた品（A）だけ出る');
  ok(d.vis.n===1&&d.vis.rows[0].jan===B&&/draft/.test(d.vis.rows[0].why),
     '★★★draft のままの品（B）は配らない・「下書き（draft）のまま」と出す');
  ok(!/いろは商会|卸値|wholesale/.test(JSON.stringify(d.vis)),'★理由に仕入れ元を出さない');
  dc=[];
  const s=await api(env,'/sub/send',{ approve:true, plan:'monitor' });
  ok(s.sent===1&&dc.filter((x)=>x.method==='POST').length===1,'★★★送るのも確かめた1件だけ');
  /* いちど出したカードは、あとで状態が変わっても書き換えを続ける。 */
  await env.DB.prepare(`UPDATE mw_sub SET shop_vis='active', price=3999 WHERE jan=?1`).bind(A).run();
  d=await api(env,'/sub/plan');
  const m3=planOf(d,'monitor');
  ok((m3.items||[]).some((x)=>x.jan===A&&x.sent)&&!d.vis.rows.some((x)=>x.jan===A),
     '★★★出ているカードは今までどおり書き換える（止めるのは新しく出す品だけ）');
  dc=[];
  await api(env,'/sub/send',{ approve:true, plan:'monitor' });
  ok(dc.some((x)=>x.method==='PATCH'),'★★値段が変わったカードは書き換わる');
}

console.log('\n=== ④ 1点もの（one-1：Shopify の画面で直してあった品）===');
{
  reset();
  const env=env0(); await setCfg(env,{});
  const r=await api(env,'/one',{ name:'血界戦線 & BEYOND Vol.3', cond:'中古', price:4800, qty:1,
    ship_kind:'small' });
  await api(env,'/one/mark',{ ids:[r.id], loaded:1 });
  let d=await api(env,'/sub/plan');
  const p=planOf(d,'one_pre');
  console.log('   確かめる前：'+(p.why||'')+' '+JSON.stringify(p.vis_hold));
  ok((p.items||[]).length===0&&/非公開を確かめていない品が 1件/.test(p.why||'')
     &&p.vis_hold.length===1&&p.vis_hold[0].handle==='one-'+r.id,
     '★★★読み込みの印だけでは出さない（理由を出す）');
  /* カジが Shopify の画面で非公開に直した（海外向けからも外した）。 */
  prods['one-'+r.id]={ status:'UNLISTED', over:false };
  gql=[];
  const u=await api(env,'/shop/unlist',{ kind:'one', approve:true, handles:['one-'+r.id] });
  console.log('   そろえる：'+JSON.stringify({ all:u.all, unlisted:u.unlisted, need:u.need,
    done:u.done, ok_all:u.ok_all, vis:u.vis }));
  ok(u.all===1&&u.unlisted===1&&u.need===0&&u.done===0&&u.ok_all===1,
     '★★★直してあった品は、触らずに確かめるだけで ok');
  ok(gql.every((x)=>/^(pjReady|pjStat)$/.test(x.name)),'★★★変える呼び出しはしない');
  const l=await api(env,'/one');
  const row=l.rows.filter((x)=>x.one_id===r.id)[0];
  ok(row.shop_vis==='ok'&&/確かめました/.test(row.shop_vis_ja)&&!!row.shop_vis_at,
     '★★一覧に確かめた結果と日時が出る');
  d=await api(env,'/sub/plan');
  ok((planOf(d,'one_pre').items||[]).length===1&&planOf(d,'one_pre').vis_hold.length===0,
     '★★★確かめた品は先行に出る');
  /* active のまま取り込んだ 1点もの → そろえて確かめる。 */
  const r2=await api(env,'/one',{ name:'別の1点もの', price:3000, qty:1, ship_kind:'small' });
  await api(env,'/one/mark',{ ids:[r2.id], loaded:1 });
  prods['one-'+r2.id]={ status:'ACTIVE', over:true };
  const u2=await api(env,'/shop/unlist',{ kind:'one', approve:true, handles:['one-'+r2.id] });
  ok(u2.done===1&&u2.ok_all===1&&prods['one-'+r2.id].status==='UNLISTED'
     &&prods['one-'+r2.id].over===false,'★★★active の品は非公開にして、海外向けから外して確かめる');
}

console.log('\n=== ⑤ 自動配信：配る前に確かめる ===');
{
  reset();
  const env=env0(); await setCfg(env,{ subAutoOn:true, subOn:false });
  const G=(n)=>'49023705510'+String(10+n);
  for(let i=0;i<3;i++){
    const jan=G(i);
    await env.DB.prepare(
      `INSERT INTO mw_stock (jan,sha,idx,kishu,name,cond,wholesale,stock,ship_days,
         row_hash,pick,seen_at,created_at)
       VALUES (?1,'いろは商会',0,'NS',?2,'新品',3000,20,1,'h',1,?3,?3)`)
      .bind(jan,'テストのゲームソフト '+jan.slice(-3),NOW).run();
    await env.DB.prepare(
      `INSERT INTO mw_amz (jan,asin,name,price,fee_total,fee_ref,fee_fba,fee_tax,
         size_tier,size_long,size_wid,size_hei,size_g,size_cm3,rank,rank_cat,
         checked_at,basis,price_at)
       VALUES (?1,?2,?3,9000,1200,700,420,80,'s',17,10.5,1.2,80,200,?4,'ゲーム',?5,'カート',?5)`)
      .bind(jan,'B0'+jan.slice(-8),'テストのゲームソフト '+jan.slice(-3),300+i*20,NOW).run();
  }
  const pre=await api(env,'/sub/auto/try',{});
  const px={}; for(const x of (planOf(pre,'monitor').items||[]))px[x.jan]=x.price;
  ok(Object.keys(px).length===3,'★試しでは3件とも出る（試しは確かめたものとみなす）');
  /* G0・G1 はカジが前から印を付けた品（読み込み済み）。G0 は draft のまま、
     G1 は Shopify に無い。G2 は自動で作る。 */
  for(const j of [G(0),G(1)])
    await env.DB.prepare(
      `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
       VALUES (?1,1,1,?2,'monitor,light,standard,premium',?3,?3,?3,?3)`)
      .bind(j,px[j],NOW).run();
  prods['sub-'+G(0)]={ status:'DRAFT', over:true };
  gql=[]; dc=[];
  const r=await W.jobSubAuto(env,{ force:true });
  const sentJ=(await env.DB.prepare(`SELECT jan FROM sub_post WHERE COALESCE(msg_id,'')<>''`).all())
    .results.map((x)=>x.jan).sort();
  console.log('   配信 '+r.sent+' 確かめ '+JSON.stringify(r.vis)+' 送った '+sentJ.join(','));
  ok(r.vis&&r.vis.checked===2&&r.vis.ok===1,'★★★前から印のある2件を、配る前に確かめる');
  ok(prods['sub-'+G(0)].status==='UNLISTED'&&prods['sub-'+G(0)].over===false
     &&await visOf(env,G(0))==='ok','★★★draft のままの品は非公開にして確かめる');
  ok(await visOf(env,G(1))==='missing','★★Shopify に無い品は「無い」と控える');
  ok(await visOf(env,G(2))==='ok','★★★自動で作った品は、作ったときに確かめた結果を控える');
  ok(sentJ.join()===[G(0),G(2)].join(),'★★★確かめられた品だけ配る（G1 は配らない）');
  /* 次の回は、確かめ済みの品を確かめ直さない。 */
  gql=[];
  await W.jobSubAuto(env,{ force:true });
  const again=gql.filter((x)=>x.name==='pjStat').map((x)=>x.v.identifier.handle);
  ok(again.indexOf('sub-'+G(0))<0&&again.indexOf('sub-'+G(2))<0,
     '★★確かめ済み（ok）の品は次の回に読み直さない');
}

console.log('\n=== ⑥ ⚙ でオフ・鍵が無い・海外向けリストが無い ===');
{
  reset();
  const env=env0(); await setCfg(env,{ subVisGate:false });
  await stock(env,A); await amz(env,A); await sub(env,A);
  let d=await api(env,'/sub/plan');
  ok(d.vis.on===false&&d.vis.why==='off'&&(planOf(d,'monitor').items||[]).length===1,
     '★★⚙ でオフにすると今までどおり（読み込みの印だけで出す）');
  const env2=makeEnv({ STAFF_KEY:'staff-key-123', DISCORD_BOT_TOKEN:'bot-token-xyz' });
  await setCfg(env2,{});
  await stock(env2,A); await amz(env2,A); await sub(env2,A);
  d=await api(env2,'/sub/plan');
  ok(d.vis.on===false&&d.vis.why==='no_key'&&(planOf(d,'monitor').items||[]).length===1,
     '★★Shopify の管理 API の鍵が無いときは止めない（理由 no_key）');
  const env3=env0(); await setCfg(env3,{ subDomain:'' });
  await stock(env3,A); await amz(env3,A); await sub(env3,A);
  d=await api(env3,'/sub/plan');
  ok(d.vis.on===false&&d.vis.why==='no_host','★店のアドレスが無いときも止めない（no_host）');
  /* 海外向けの商品リストが Shopify に見つからない → ok にしない。 */
  reset(); noOver=true;
  const env4=env0(); await setCfg(env4,{});
  await stock(env4,A); await amz(env4,A); await sub(env4,A);
  prods['sub-'+A]={ status:'UNLISTED', over:false };
  const u=await api(env4,'/shop/unlist',{ kind:'sub', approve:true, handles:['sub-'+A] });
  ok(u.vis['sub-'+A]==='over_miss'&&await visOf(env4,A)==='over_miss',
     '★★★海外向けの商品リストが見つからなければ「確かめられない」（配らない）');
  ok(!/csec-SECRET|shpat-SECRET/.test(JSON.stringify(u)),'★★鍵は返さない');
  /* 作業者のキーでは使えない。 */
  const w=await asJson(await worker.fetch((()=>{ const q=post('/shop/unlist',
    { kind:'sub', approve:true, handles:['sub-'+A] }); q.headers.set('X-PJ-Key','worker-key-999');
    return q; })(),makeEnv({ STAFF_KEY:'staff-key-123', WORKER_KEY:'worker-key-999',
    SHOPIFY_CLIENT_ID:'cid', SHOPIFY_CLIENT_SECRET:'csec-SECRET' }),{}));
  ok(w.status===401||w.status===403||(w.body&&w.body.ok===false),'★★★作業者のキーでは使えない');
}

console.log('\n=== ⑦ 直し：海外向けカタログがマーケットのカタログのとき ===');
{
  /* publications の一覧に Overseas products が出てこない（カジの店）。
     カタログ（type: MARKET）の側から引いて、結び付いた publication で外す。 */
  reset(); noOver=true;
  cats=[{ id:'gid://shopify/MarketCatalog/133353570467', title:'Overseas products',
          status:'ACTIVE', publication:{ id:OVER } },
        { id:'gid://shopify/MarketCatalog/5', title:'Japan', status:'ACTIVE', publication:null }];
  const env=env0(); await setCfg(env,{});
  const r=await api(env,'/one',{ name:'血界戦線 & BEYOND Vol.3', price:4800, qty:1, ship_kind:'small' });
  await api(env,'/one/mark',{ ids:[r.id], loaded:1 });
  prods['one-'+r.id]={ status:'UNLISTED', over:true };
  const c=await api(env,'/shop/unlist',{ kind:'one', approve:false, handles:['one-'+r.id] });
  console.log('   確かめる：'+JSON.stringify({ over_n:c.over_n, over_miss:c.over_miss, vis:c.vis,
    look:c.look }));
  ok(c.over_n===1&&c.over_miss.length===0&&gql.some((x)=>x.name==='pjCats'),
     '★★★販売チャネルの一覧に無ければ、カタログの一覧から「Overseas products」を引く');
  ok(c.need===1&&c.over_in===1&&c.vis['one-'+r.id]==='over',
     '★★★one-1 が海外向けカタログに入っていることが分かる（ok にしない）');
  ok(!c.look[0].after&&!c.look[0].before,'★確かめるだけのときは読んだ状態そのまま（直したあとの印は付けない）');
  ok(c.look[0].handle==='one-'+r.id&&c.look[0].pid==='one-'+r.id&&c.look[0].status==='UNLISTED'
     &&c.look[0].over===true,'★★★pj が読んだ商品（ID・状態・海外向け）を返す');
  const u=await api(env,'/shop/unlist',{ kind:'one', approve:true, handles:['one-'+r.id] });
  ok(u.done===1&&u.ok_all===1&&prods['one-'+r.id].over===false
     &&gql.some((x)=>x.name==='pjUnpub'&&x.v.pub===OVER),
     '★★★カタログの publication から外して、もう一度読んで「確かめ済み」');
  console.log('   直したあと：'+JSON.stringify(u.look));
  ok(u.look[0].after===true&&u.look[0].over===false&&u.look[0].status==='UNLISTED'
     &&u.look[0].on===true&&u.look[0].vis==='ok',
     '★★★結果の「読んだ商品」は直したあとに読み直した状態（海外向け：入っていない）');
  ok(u.look[0].before&&u.look[0].before.over===true&&u.look[0].before.status==='UNLISTED',
     '★★直す前の状態は before に残す');
  const l=(await api(env,'/one')).rows[0];
  ok(l.shop_vis==='ok','★★★1点ものの一覧も「非公開を確かめ済み」');

  console.log('\n=== ⑦ カタログに商品の一覧（publication）が無い ===');
  reset(); noOver=true;
  cats=[{ id:'gid://shopify/MarketCatalog/133353570467', title:'Overseas products',
          status:'ACTIVE', publication:null }];
  prods['one-'+r.id]={ status:'UNLISTED', over:false };
  const n=await api(env,'/shop/unlist',{ kind:'one', approve:true, handles:['one-'+r.id] });
  console.log('   '+n.over_ja);
  ok(n.vis['one-'+r.id]==='over_miss'&&/商品の一覧（publication）が結び付いていない/.test(n.over_ja)
     &&n.over_cats[0].pub==='','★★「カタログはあるが商品の一覧が無い」と理由を返す（ok にしない）');

  console.log('\n=== ⑦ 権限が足りない ===');
  reset(); noOver=true;
  catsErr='Access denied for catalogs field. Required access: `read_markets` access scope.';
  const d=await api(env,'/shop/unlist',{ kind:'one', approve:false, handles:['one-'+r.id] });
  console.log('   '+d.over_ja);
  ok(d.over_scopes.join()==='read_markets'&&/read_markets/.test(d.over_ja)
     &&/問い合わせられませんでした/.test(d.over_ja),'★★★足りない権限の名前を返す');
  ok(d.scopes.indexOf('read_publications')>=0&&!/shpat-SECRET|csec-SECRET/.test(JSON.stringify(d)),
     '★★いまの鍵の権限の名前は返す（鍵の値は返さない）');
  const t0=tokN;
  catsErr='';
  cats=[{ id:'gid://shopify/MarketCatalog/133353570467', title:'Overseas products',
          status:'ACTIVE', publication:{ id:OVER } }];
  const d2=await api(env,'/shop/unlist',{ kind:'one', approve:false, handles:['one-'+r.id] });
  ok(d2.over_n===1&&!d2.over_ja&&tokN>t0,
     '★★★権限を足したら、控えを使い回さずにすぐ効く（鍵も取り直す）');

  console.log('\n=== ⑦ ⚙ にカタログの ID ===');
  reset(); noOver=true;
  catById['gid://shopify/MarketCatalog/133353570467']={ id:'gid://shopify/MarketCatalog/133353570467',
    title:'Overseas products', status:'ACTIVE', publication:{ id:OVER } };
  await setCfg(env,{ subShopOverseasId:'133353570467', subShopOverseas:'違う名前' });
  prods['one-'+r.id]={ status:'UNLISTED', over:true };
  const g=await api(env,'/shop/unlist',{ kind:'one', approve:true, handles:['one-'+r.id] });
  ok(g.over_n===1&&g.ok_all===1&&!gql.some((x)=>x.name==='pjCats')
     &&gql.some((x)=>x.name==='pjCatId'&&x.v.c==='gid://shopify/MarketCatalog/133353570467'),
     '★★★⚙ の ID で引く（名前より先・名前が違っていても見つかる）');
  await setCfg(env,{ subShopOverseasId:'999' });
  W.shopReset();
  const g2=await api(env,'/shop/unlist',{ kind:'one', approve:false, handles:['one-'+r.id] });
  ok(g2.over_miss.join()==='ID 999'&&/ID 999」が Shopify に見つかりません/.test(g2.over_ja),
     '★★ID が違えば「見つかりません」と ID を出す');
  ok(W.shopOverIds({ subShopOverseasId:'gid://shopify/MarketCatalog/12345, 678 x' })
       .map((x)=>x.kind+':'+x.n).join()==='MarketCatalog:12345,:678','★ID の読み方（gid・数字）');

  console.log('\n=== ⑦ one- を active と読んだとき：読んだ商品と同じ名前の商品 ===');
  reset();
  await setCfg(env,{});
  prods['one-'+r.id]={ status:'ACTIVE', over:false };
  same=[{ id:'gid://shopify/Product/one-'+r.id, handle:'one-'+r.id, status:'ACTIVE' },
        { id:'gid://shopify/Product/777', handle:'one-'+r.id+'-1', status:'UNLISTED' }];
  const a=await api(env,'/shop/unlist',{ kind:'one', approve:false, handles:['one-'+r.id] });
  console.log('   '+JSON.stringify(a.look));
  ok(a.look[0].status==='ACTIVE'&&a.look[0].same.length===1&&a.look[0].same[0].handle==='one-'+r.id+'-1'
     &&a.look[0].same[0].pid==='777'&&a.look[0].same[0].status==='UNLISTED',
     '★★★同じ名前の別の商品（Handle がずれた商品）を見つけて返す');
  const sq=gql.filter((x)=>x.name==='pjSame')[0];
  ok(sq&&/^title:"血界戦線 & BEYOND Vol\.3"$/.test(sq.v.q),'★★名前（Shopify のタイトル）で探す');
  ok(!/いろは商会|cost|wholesale/.test(JSON.stringify(a.look)),'★仕入れの情報は返さない');
}

T.done();
