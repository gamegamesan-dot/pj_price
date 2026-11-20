/* 共有・Worker：箱ものの「送料用の重さ」で会員便の送料を実額に合わせる（8.81）

   カジの依頼（2026-11-20）
     「今日の配信の案」に「会員便の送料が足りない品 14件」。会員便（Shopify：
     マーケット → 日本 → 配送）は重さの段（¥200／¥300／¥600／¥800）で、
     宅配便・レターパックプラスで送る箱ものの実額に足りていない。段を上げると
     クリックポストのゲームソフトまで高くなるので、箱ものだけ分けたい。
   決めたこと（カジの回答）
     ・配送プロファイルは作らない。**いまの会員便に段を足す**
       （マーケットごとの配送の店では、アプリの配送プロファイルの料金は
         いまの料金に追加で並ぶだけで、置き換わらないため）
     ・箱ものには pj が「送料用の重さ」を Shopify に入れる
     ・**実際の重さは pj に残す**
     ・**会員用の商品を海外向けの商品リストから外す**

   ① 送料用の重さの表と、会員便に足す段
   ② ゲームソフト1本はいまと同じ・箱もの1点は実額・複数は合計で段が決まる
   ③ 足りない品の判定が 0 件になる（残るなら理由が分かる）
   ④ カード：箱ものは「送り方 ¥◯（実費）」。プランの送料の文は薄物だけ
   ⑤ Shopify に入れる重さ（CSV・管理 API）と、実際の重さ
   ⑥ pj-sync：作るときに海外向けの商品リストから外す
   ⑦ pj-sync：いまある会員用の商品を直す・送り方を直したら入れ替わる
   ⑧ ⚙がオフなら今までどおり */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import SHOPCSV from '../shared/shopcsv.js';
import SELLWAY from '../shared/sellway.js';
import SUBCARD from '../shared/subcard.js';
const T=harness('共有・Worker：箱ものの送料用の重さ（8.81）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('boxship');
const S=SHOPCSV;

const COSTS=SELLWAY.boxCosts({});
const THIN=S.tiersOf('');                      // 250:200／350:300／0:600
const TB=S.tiersBox(THIN,COSTS);
const ON={ boxOn:true, tiers:TB, gameG:100 };
const OFF={ boxOn:false, tiers:THIN, gameG:100 };
/* 品物の見本。 */
const game={ jan:'4902370551010', name:'テストのゲーム 通常版', kishu:'NS',
             size_long:17, size_wid:10.5, size_hei:1.2, size_g:80 };
const big={ jan:'4902370551011', name:'テストのゲーム 限定版', kishu:'NS',
            size_long:30, size_wid:22, size_hei:8, size_g:900 };      // 60サイズ
const fig={ jan:'4902370551012', name:'テストのフィギュア', kishu:'b2cchara_figure',
            size_long:35, size_wid:25, size_hei:18, size_g:1200 };    // 80サイズ
/* 宅急便コンパクトは、採寸からは選ばれない（先にレターパックプラスに入る）。
   カジが手で送り方を選んだ品だけがこの区分になる。 */
const compact={ jan:'4902370551013', name:'小さな箱', kishu:'b2cchara_figure',
                size_long:20, size_wid:15, size_hei:4.5, size_g:300,
                ship_way:'compact' };
const letter={ jan:'4902370551014', name:'設定資料集', kishu:'b2cchara_figure',
               size_long:30, size_wid:22, size_hei:6, size_g:1500 };
const huge={ jan:'4902370551015', name:'大きな箱', kishu:'b2cchara_figure',
             size_long:50, size_wid:40, size_hei:30, size_g:4000 };
const nodim={ jan:'4902370551016', name:'採寸なし', kishu:'b2cchara_figure',
              size_g:500 };

console.log('=== ① 送料用の重さの表と、会員便に足す段 ===');
{
  console.log('   実額 '+JSON.stringify(COSTS));
  ok(COSTS.compact===520&&COSTS.letter===600&&COSTS.box60===800
     &&COSTS.box80===1000&&COSTS.box===1200&&COSTS.cp===undefined,
     '★★箱ものの料金は⚙「送り方ごとの実額」から取る（クリックポストは入れない）');
  ok(SELLWAY.boxCosts({ gdShipBox60:'850' }).box60===850,
     '★⚙を変えれば料金も変わる');
  ok(S.boxG('compact')===2000&&S.boxG('letter')===3000&&S.boxG('box60')===4000
     &&S.boxG('box80')===6000&&S.boxG('box')===9000&&S.boxG('cp')===0,
     '★★★送料用の重さ：コンパクト2kg／レターパック3kg／60=4kg／80=6kg／100=9kg');
  const txt=S.tiersText(TB);
  console.log('   段 '+txt);
  ok(txt==='250:200／350:300／1999:600／2999:520／3999:600／5999:800／8999:1000／0:1200',
     '★★★会員便に足す段（薄物は 1,999g まで今のまま・2,000g から箱もの）');
  const rows=S.tiersRows(TB);
  ok(rows.length===8&&rows[3].from===2000&&rows[3].to===2999&&rows[3].box==='compact'
     &&rows[7].from===9000&&rows[7].to===0&&rows[7].box==='box'
     &&rows[5].name==='宅配便（60サイズ）'&&rows[7].name==='宅配便（100サイズ以上）'
     &&rows[3].name==='宅急便コンパクト'&&rows[4].name==='レターパックプラス',
     '★★段の一覧（◯g から ◯g まで・送り方の名前つき）');
  /* カジのいまの段（¥200／¥300／¥600／¥800）でも、薄物の段はそのまま残る。 */
  const t2=S.tiersText(S.tiersBox(S.tiersOf('250:200／350:300／600:600／0:800'),COSTS));
  console.log('   いまの段から '+t2);
  ok(t2==='250:200／350:300／600:600／1999:800／2999:520／3999:600／5999:800／8999:1000／0:1200',
     '★★★いまの段（4段）の薄物ぶんは金額を変えずに残す');
  /* もう箱ものまで伸ばしてある段でも、2,000g から上は実額の段に置き換える。 */
  const t3=S.tiersText(S.tiersBox(S.tiersOf('250:200／350:300／1500:800／3000:1000／0:1200'),COSTS));
  ok(t3==='250:200／350:300／1500:800／1999:1000／2999:520／3999:600／5999:800／8999:1000／0:1200',
     '★2,000g から上の古い段は使わない');
}

console.log('\n=== ② ゲームソフトはいまと同じ・箱ものは実額・複数は合計 ===');
const yenOf=(g)=>S.tierOf(g,TB).yen;
{
  ok(S.weightOf(game,ON)===100&&yenOf(100)===200&&S.tierOf(100,THIN).yen===200,
     '★★★ゲームソフト1本：重さ 100g・送料 ¥200（いまと同じ）');
  ok(yenOf(200)===S.tierOf(200,THIN).yen&&yenOf(300)===S.tierOf(300,THIN).yen
     &&yenOf(400)===S.tierOf(400,THIN).yen&&yenOf(1000)===S.tierOf(1000,THIN).yen,
     '★★★ゲームソフト 2・3・4・10本もいまと同じ送料');
  const each=[[compact,'compact',520],[letter,'letter',600],[big,'box60',800],
              [fig,'box80',1000],[huge,'box',1200]];
  each.forEach(function(e){
    const w=S.shipWay(e[0],ON);
    const g=S.weightOf(e[0],ON);
    console.log('   '+w.name+'：送料用 '+g+'g → ¥'+yenOf(g));
    ok(w.key===e[1]&&g===S.boxG(e[1])&&yenOf(g)===e[2]&&yenOf(g)===COSTS[e[1]],
       '★★★'+w.name+' 1点は実額ちょうど（¥'+e[2]+'）');
  });
  /* 複数：1点ずつ足し上げない（合計の重さで段が決まる）。 */
  ok(yenOf(4000+4000)===1000,'★★★60サイズ2点 → ¥1,000（足し上げの ¥1,600 ではない）');
  ok(yenOf(4000+4000+4000)===1200,'★★60サイズ3点 → ¥1,200');
  ok(yenOf(2000+2000)===800,'★★コンパクト2点 → ¥800（足し上げの ¥1,040 ではない）');
  ok(yenOf(3000+2000)===800,'★レターパック＋コンパクト → ¥800');
  ok(yenOf(6000+4000)===1200,'★80サイズ＋60サイズ → ¥1,200');
  /* ゲームソフト＋箱もの：箱ものの段に収まる。 */
  ok(yenOf(4000+100)===800&&yenOf(4000+500)===800,
     '★★★ゲームソフト＋60サイズ → ¥800（足し上げの ¥1,000 ではない）');
  ok(yenOf(6000+300)===1000,'★ゲームソフト3本＋80サイズ → ¥1,000');
}

console.log('\n=== ③ 足りない品の判定 ===');
{
  const short=(it,o)=>{
    const w=S.shipWay(it,o);
    const g=S.weightOf(it,o);
    const st=S.shipSteps(g,{ tiers:o.tiers, unit:'点' });
    return SELLWAY.shortOf(w.key,st?st.yen1:0,{ shipName:w.name });
  };
  const all=[game,compact,letter,big,fig,huge];
  const before=all.filter((x)=>short(x,OFF).short);
  const after=all.filter((x)=>short(x,ON).short);
  console.log('   オフ：足りない '+before.length+'件 → オン：'+after.length+'件');
  ok(before.length>=3,'★いままで（オフ）は箱ものが足りなかった');
  ok(short(big,OFF).gap===200&&short(big,OFF).got===600,
     '★いままで：60サイズは会員から ¥600・実額 ¥800・不足 ¥200');
  ok(after.length===0,'★★★オンにすると、足りない品が 0 件になる');
  ok(short(big,ON).got===800&&short(big,ON).cost===800,
     '★★会員から受け取る額が実額と同じになる');
  ok(short(game,ON).got===200&&short(game,ON).short===false,
     '★ゲームソフトは今までどおり足りている');
  /* 送り方が決まらない行（採寸なし）は、今までどおり実際の重さ・判定しない。 */
  ok(S.boxWayOf(nodim,ON)===null&&S.weightOf(nodim,ON)===500,
     '★★採寸が無い行は送料用の重さにしない（当てずっぽうにしない）');
  /* ⚙の実額を上げても、段がそれに付いてくるので足りなくならない。 */
  const c2=SELLWAY.boxCosts({ gdShipBox60:'950' });
  const tb2=S.tiersBox(THIN,c2);
  ok(S.tierOf(4000,tb2).yen===950,'★★⚙の実額を変えれば、受け取る額も同じだけ変わる');
}

console.log('\n=== ④ カード：箱ものは送り方と実額・プランの文は薄物だけ ===');
{
  const line=S.shipLine(big,ON);
  console.log('   '+line);
  ok(line==='宅配便（60サイズ） ¥800（実費）','★★★箱もの：送り方と送料（実費）');
  ok(S.shipLine(huge,ON)==='宅配便（100サイズ以上） ¥1,200（実費）'
     &&S.shipLine(letter,ON)==='レターパックプラス ¥600（実費）',
     '★★ほかの送り方も同じ形');
  ok(/^クリックポスト（1〜2本 ¥200／3本 ¥300／/.test(S.shipLine(game,ON)),
     '★★★ゲームソフトは今までどおり（本数ごとの段）');
  ok(S.shipLine(nodim,ON)===S.SHIP_UNSURE,'★採寸が無い行は今までどおり');
  /* プランごとの送料の文（特典）は、クリックポストの品だけ。 */
  const perk='クリックポスト（1点 ¥200・4点以上 送料無料）';
  const base={ price:3000, qty:3, left:3, sold:0, amz_price:9000, asin:'B0D1GSZJ8T' };
  const cardOf=(it,plan)=>SUBCARD.card(Object.assign({},base,it),
    Object.assign({ domain:'x.myshopify.com', maxQty:1, shipText:perk,
                    planKey:plan },ON));
  const shipOf=(c)=>(c.fields.filter((f)=>f.name==='送料')[0]||{}).value;
  ok(shipOf(cardOf(game,'monitor'))===perk,
     '★★★クリックポストの品には、プランの送料の文（特典）を出す');
  ['monitor','light','standard','premium'].forEach(function(k){
    ok(shipOf(cardOf(big,k))==='宅配便（60サイズ） ¥800（実費）',
       '★★★箱ものは '+k+' でも実費（特典の文を出さない）');
  });
  ok(shipOf(SUBCARD.card(Object.assign({},base,big),{ domain:'x.myshopify.com',
     maxQty:1, shipText:'プレミアムは送料無料', planKey:'premium', boxOn:true,
     tiers:TB, gameG:100 }))==='宅配便（60サイズ） ¥800（実費）',
     '★★「送料無料」の文を入れていても、箱ものには出さない');
}

console.log('\n=== ⑤ Shopify に入れる重さと、実際の重さ ===');
{
  const row=S.rowOf(Object.assign({ price:5000, max_qty:2 },big),ON);
  const api=S.apiOf(Object.assign({ price:5000, max_qty:2 },big),ON);
  ok(row['Weight value (grams)']==='4000'
     &&api.input.variants[0].inventoryItem.measurement.weight.value===4000,
     '★★★箱もの：CSV も管理 API も「送料用の重さ」（4,000g）');
  ok(S.realG(big,ON)===900&&big.size_g===900,
     '★★★実際の重さ（900g）は pj に残る（realG・採寸は書き換えない）');
  const g1=S.rowOf(Object.assign({ price:5000, max_qty:2 },game),ON);
  ok(g1['Weight value (grams)']==='100'&&S.realG(game,ON)===100,
     '★★ゲームソフトは今までどおり（一律の重さ）');
  /* 手で送り方を直すと、重さも入れ替わる。 */
  ok(S.weightOf(Object.assign({},big,{ ship_way:'cp' }),ON)===900
     &&S.weightOf(Object.assign({},game,{ ship_way:'box80' }),ON)===6000,
     '★★★送り方を手で直すと、Shopify に入れる重さも入れ替わる');
  ok(S.weightOf(big,OFF)===900&&S.rowOf(Object.assign({ price:5000, max_qty:2 },big),
     OFF)['Weight value (grams)']==='900','★★⚙がオフなら今までどおり実際の重さ');
}

/* ---- ここから pj-sync ---- */
let dc=[], notes=[], shop=[];
let pubs=null, unpubFail=false;
const J=(v,st)=>new Response(JSON.stringify(v),{status:st||200,
  headers:{'content-type':'application/json'}});
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/myshopify\.com\/admin\/oauth\/access_token/.test(url))
    return J({ access_token:'tok', expires_in:86399 });
  if(/myshopify\.com\/admin\/api\//.test(url)){
    const b=JSON.parse(String(o.body||'{}'));
    const name=(/(?:query|mutation)\s+(\w+)/.exec(b.query)||[])[1]||'';
    shop.push({ kind:name, v:b.variables });
    if(name==='pjReady')return J({ data:{ shop:{ name:'店' },
      locations:{ nodes:[{ id:'gid://shopify/Location/1', name:'本店' }] },
      publications:{ nodes:pubs||[
        { id:'gid://shopify/Publication/9', supportsFuturePublishing:true,
          catalog:{ title:'Online Store' } },
        { id:'gid://shopify/Publication/5', supportsFuturePublishing:false,
          catalog:{ title:'Overseas products' } },
        { id:'gid://shopify/Publication/6', supportsFuturePublishing:false,
          catalog:{ title:'Japan' } }] } } });
    if(name==='pjSet'){
      const h=b.variables.input.handle;
      return J({ data:{ productSet:{ product:{ id:'gid://shopify/Product/'+h,
        handle:h, status:'UNLISTED', variants:{ nodes:[{ id:'gid://v/'+h,
          inventoryItem:{ id:'gid://shopify/InventoryItem/'+h } }] } },
        userErrors:[] } } });
    }
    if(name==='pjPub')return J({ data:{ publishablePublish:{ userErrors:[] } } });
    if(name==='pjUnpub')return J({ data:{ publishableUnpublish:{ userErrors:
      unpubFail?[{ field:[], message:'cannot unpublish' }]:[] } } });
    return J({ data:{} });
  }
  if(/\/api\/webhooks\//.test(url)){
    notes.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response(null,{status:204});
  }
  if(/discord\.com\/api/.test(url)){
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    dc.push({ method:String(o.method||'GET'), ch:m[1]||'', msg:m[2]||'',
              body:JSON.parse(String(o.body||'{}')) });
    return J({ id:String(900000+dc.length), name:'部屋', guild_id:'1' });
  }
  return J({});
};
const reset=()=>{ dc=[]; notes=[]; shop=[]; pubs=null; unpubFail=false;
                  W.shopReset(); };
const CH='1234567890', CH_S='3234567890';
const NOW=new Date().toISOString();
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123', DISCORD_BOT_TOKEN:'bot',
  SHOPIFY_CLIENT_ID:'cid', SHOPIFY_CLIENT_SECRET:'csec' });
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:NOW, settings:Object.assign({ subBoxOn:true,
    subChMonitor:CH, subChStandard:CH_S, subOnStandard:true, gdIdxOn:false,
    subMonNote:false, subDomain:'omakase-ship.myshopify.com' },o||{}) }),NOW).run();
const item=async(env,it,o)=>{
  const x=o||{};
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,cond,wholesale,stock,ship_days,
       row_hash,pick,seen_at,created_at)
     VALUES (?1,'S',0,?2,?3,'新品',?4,20,1,'h',1,?5,?5)`)
    .bind(it.jan,it.kishu,it.name,x.wh||3000,NOW).run();
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,fee_total,fee_ref,fee_fba,fee_tax,
       size_tier,size_long,size_wid,size_hei,size_g,size_cm3,rank,rank_cat,
       checked_at,basis,price_at)
     VALUES (?1,?2,?3,?4,?5,700,420,80,'m',?6,?7,?8,?9,200,?10,'ゲーム',?11,'カート',?11)`)
    .bind(it.jan,'B0'+it.jan.slice(-8),it.name,x.price||16000,x.fee||2400,
          it.size_long||0,it.size_wid||0,it.size_hei||0,it.size_g||0,
          x.rank||400,NOW).run();
};
const sub=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
   VALUES (?1,1,3,?2,?3,?4,?4,?4,?4)`)
  .bind(jan,(o||{}).price||4000,(o||{}).grades||'',NOW).run();
const api=async(env,path,body,key)=>{
  const r=body?post(path,body):get(path);
  if(key)r.headers.set('X-PJ-Key',key);
  return await asJson(await worker.fetch(r,env,{}));
};
const rowsOf=async(env,sql)=>((await env.DB.prepare(sql).all()).results||[]);

console.log('\n=== ⑥ pj-sync：段・足りない品・カード ===');
{
  const env=env0(); await setCfg(env,{});
  const cfg=await W.subSettings(env);
  ok(cfg.boxOn===true&&S.tiersText(cfg.tiers)===S.tiersText(TB),
     '★★★pj-sync も同じ段の表を使う（画面と同じ作り方）');
  const sh=W.subShipInfo(Object.assign({},big),cfg);
  console.log('   '+JSON.stringify({ g:sh.grams, real:sh.real_g, yen1:sh.yen1,
    short:sh.short, text:sh.text, warn:sh.warn }));
  ok(sh.grams===4000&&sh.real_g===900&&sh.box===true,
     '★★★Shopify に入れる重さ 4,000g・実際の重さ 900g を分けて持つ');
  ok(sh.yen1===800&&sh.short===false&&sh.warn==='',
     '★★★会員から ¥800＝実額。送料が足りない印は付かない');
  ok(sh.text==='宅配便（60サイズ） ¥800（実費）','★★カードの送料の文');
  const c=W.subShipInfo(Object.assign({},compact),cfg);
  ok(c.yen1===520&&c.warn==='',
     '★★コンパクト（¥520）を「下限 ¥600 に足りない」と警告しない');
  const g=W.subShipInfo(Object.assign({},game),cfg);
  ok(g.grams===100&&g.yen1===200&&g.box===false,'★ゲームソフトは今までどおり');
  /* オフなら今までどおり。 */
  const env2=env0(); await setCfg(env2,{ subBoxOn:false });
  const cfg2=await W.subSettings(env2);
  const sh2=W.subShipInfo(Object.assign({},big),cfg2);
  ok(cfg2.boxOn===false&&sh2.grams===900&&sh2.yen1===600&&sh2.short===true,
     '★★★⚙がオフなら今までどおり（実際の重さ・不足の印）');
}

console.log('\n=== ⑦ 作るとき：送料用の重さ・海外向けの商品リストから外す ===');
{
  reset();
  const env=env0(); await setCfg(env,{ subAutoOn:true, subOnMonitor:false });
  await item(env,fig); await item(env,big);
  const r=await W.jobSubAuto(env,{ force:true });
  const sets=shop.filter((x)=>x.kind==='pjSet');
  const un=shop.filter((x)=>x.kind==='pjUnpub');
  console.log('   作った '+r.shop.made+'件・外した '+un.length+'回 '
    +JSON.stringify(sets.map((x)=>x.v.input.variants[0].inventoryItem.measurement.weight.value)));
  ok(r.shop.made===2&&sets.length===2,'★箱もの2件を作る');
  ok(sets.map((x)=>x.v.input.variants[0].inventoryItem.measurement.weight.value)
     .sort().join()==='4000,6000','★★★Shopify に入れる重さは送料用の重さ');
  ok(un.length===2&&un.every((x)=>x.v.pub==='gid://shopify/Publication/5'),
     '★★★作るときに、海外向けの商品リスト（Overseas products）から外す');
  ok(un.every((x)=>x.v.pub!=='gid://shopify/Publication/9'
     &&x.v.pub!=='gid://shopify/Publication/6'),
     '★★オンラインストアや、ほかのリストからは外さない');
  const m=await rowsOf(env,`SELECT jan, shop_g, shop_ov FROM mw_sub ORDER BY jan`);
  ok(m.length===2&&m.every((x)=>x.shop_ov===1)
     &&m.map((x)=>x.shop_g).sort().join()==='4000,6000',
     '★入れた重さと外した印を控える');
  const a=await rowsOf(env,`SELECT jan, size_g FROM mw_amz ORDER BY jan`);
  ok(a.map((x)=>x.size_g).sort().join()==='1200,900',
     '★★★D1 の採寸（実際の重さ）は書き換えない');
  const cj=JSON.stringify(dc.map((x)=>x.body));
  ok(/宅配便（60サイズ） ¥800（実費）/.test(cj)&&/宅配便（80サイズ） ¥1,000（実費）/.test(cj),
     '★★★カードに「送り方 ¥◯（実費）」が出る');

  /* 海外向けの商品リストが見つからない → 送料用の重さの品は作らない。 */
  reset();
  pubs=[{ id:'gid://shopify/Publication/9', supportsFuturePublishing:true,
          catalog:{ title:'Online Store' } }];
  const env2=env0(); await setCfg(env2,{ subAutoOn:true });
  await item(env2,fig);
  await item(env2,game,{ price:9000, fee:1200, rank:300 });
  const r2=await W.jobSubAuto(env2,{ force:true });
  const made=shop.filter((x)=>x.kind==='pjSet').map((x)=>x.v.input.handle);
  console.log('   リスト無し：'+JSON.stringify(r2.errors));
  ok(/海外向けの商品リスト「Overseas products」が見つかりません/.test(r2.errors.join('／')),
     '★★★リストが見つからないことを運営に知らせる');
  ok((await rowsOf(env2,`SELECT jan FROM mw_sub WHERE on_sale=1`))
     .map((x)=>x.jan).join()===game.jan,
     '★★★送料用の重さの品（箱もの）は作らない・配信しない。薄物は通す');
  ok(!/sub-4902370551012/.test(JSON.stringify(dc)),'★箱もののカードは出ていない');
  /* 外せなかった → 箱ものは作れなかった扱い。 */
  reset(); unpubFail=true;
  const env3=env0(); await setCfg(env3,{ subAutoOn:true, subOnMonitor:false });
  await item(env3,fig);
  const r3=await W.jobSubAuto(env3,{ force:true });
  ok(r3.shop.fail===1&&r3.sent===0
     &&/海外向けの商品リストから外せませんでした/.test(r3.errors.join('／')),
     '★★外せなかった箱ものは配信しない（理由を知らせる）');
  /* ⚙の名前を空にすると外さない（リストを使っていない店）。 */
  reset();
  const env4=env0(); await setCfg(env4,{ subAutoOn:true, subOnMonitor:false,
                                         subShopOverseas:'' });
  await item(env4,fig);
  const r4=await W.jobSubAuto(env4,{ force:true });
  ok(r4.shop.made===1&&shop.filter((x)=>x.kind==='pjUnpub').length===0,
     '★⚙の名前を空にすれば外さずに作る');
  ok(W.shopOverNames({}).join()==='Overseas products'
     &&W.shopOverNames({ subShopOverseas:'A, B' }).join()==='A,B',
     '★名前は⚙（既定 Overseas products・カンマ区切り）');
}

console.log('\n=== ⑧ いまある会員用の商品を直す ===');
{
  reset();
  const env=env0(); await setCfg(env,{});
  await item(env,fig); await sub(env,fig.jan);
  await item(env,big); await sub(env,big.jan);
  await item(env,game,{ price:9000, fee:1200 }); await sub(env,game.jan);
  const d=(await api(env,'/sub/box/sync',{})).body;
  console.log('   確かめる：直す '+d.todo+'件／会員用 '+d.all+'件（箱もの '+d.box_n+'件）');
  ok(d.ok&&d.approve===false&&d.todo===3&&d.all===3&&d.box_n===2,
     '★★確かめる：直す必要がある件数が分かる');
  ok(shop.every((x)=>x.kind!=='pjSet'&&x.kind!=='pjUnpub'),
     '★★★確かめるだけでは Shopify を変えない');
  ok(d.tiers_text===S.tiersText(TB)&&d.tiers.length===8,
     '★★Shopify の会員便に入れる段の表を返す');
  ok(d.over.found===1&&d.over.miss.length===0&&d.ready===true,
     '★海外向けの商品リストが見つかったかが分かる');
  const it=d.items.filter((x)=>x.jan===big.jan)[0];
  ok(it.g===4000&&it.real_g===900&&it.box===true&&it.ship==='宅配便（60サイズ）',
     '★★★送料用の重さと実際の重さを並べて返す');
  reset();
  const r=(await api(env,'/sub/box/sync',{ approve:true })).body;
  const sets=shop.filter((x)=>x.kind==='pjSet');
  console.log('   直した '+r.done+'件・残り '+r.left+'件');
  ok(r.ok&&r.done===3&&r.left===0&&r.fail===0,'★★★3件を直す');
  const wOf=(jan)=>sets.filter((x)=>x.v.input.handle==='sub-'+jan)[0]
    .v.input.variants[0].inventoryItem.measurement.weight.value;
  ok(wOf(fig.jan)===6000&&wOf(big.jan)===4000&&wOf(game.jan)===100,
     '★★★箱ものは送料用の重さ・クリックポストの品は今の重さのまま');
  ok(shop.filter((x)=>x.kind==='pjUnpub').length===3,
     '★★★いまある会員用の商品も、海外向けの商品リストから外す');
  ok(sets.every((x)=>x.v.input.status==='UNLISTED'),'★非公開のまま');
  /* もう一度：直すものが無い。 */
  reset();
  const r2=(await api(env,'/sub/box/sync',{ approve:true })).body;
  ok(r2.todo===0&&r2.done===0&&shop.filter((x)=>x.kind==='pjSet').length===0,
     '★★同じ商品を何度も直さない');
  /* 送り方を手で直す → 入れ替わる。 */
  await env.DB.prepare(`UPDATE mw_sub SET ship_way='cp' WHERE jan=?1`)
    .bind(big.jan).run();
  reset();
  const d3=(await api(env,'/sub/box/sync',{})).body;
  ok(d3.todo===1&&d3.items[0].jan===big.jan&&d3.items[0].g===900
     &&d3.items[0].box===false,'★★★送り方を手で直すと、直す品に出てくる');
  const r3=(await api(env,'/sub/box/sync',{ approve:true })).body;
  ok(r3.done===1&&shop.filter((x)=>x.kind==='pjSet')[0]
     .v.input.variants[0].inventoryItem.measurement.weight.value===900,
     '★★★クリックポストに直した品は、実際の重さに入れ替わる');
  /* 自動配信の回でも少しずつ直す。 */
  await env.DB.prepare(`UPDATE mw_sub SET ship_way='box80' WHERE jan=?1`)
    .bind(big.jan).run();
  await setCfg(env,{ subAutoOn:true });
  reset();
  const ra=await W.jobSubAuto(env,{ force:true });
  ok(ra.box.on===true&&ra.box.done>=1&&shop.filter((x)=>x.kind==='pjSet'
     &&x.v.input.handle==='sub-'+big.jan)[0]
     .v.input.variants[0].inventoryItem.measurement.weight.value===6000,
     '★★自動配信の回でも、送り方が変わった品を直す');
  /* 海外向けの商品リストが見つからない店：外せないことだけを理由に、
     同じ品を毎回直しに行かない（箱ものは作らないので、直す品にも残る）。 */
  {
    reset();
    pubs=[{ id:'gid://shopify/Publication/9', supportsFuturePublishing:true,
            catalog:{ title:'Online Store' } }];
    const e5=env0(); await setCfg(e5,{});
    await item(e5,game,{ price:9000, fee:1200 }); await sub(e5,game.jan);
    const a=(await api(e5,'/sub/box/sync',{ approve:true })).body;
    reset();
    pubs=[{ id:'gid://shopify/Publication/9', supportsFuturePublishing:true,
            catalog:{ title:'Online Store' } }];
    const b=(await api(e5,'/sub/box/sync',{ approve:true })).body;
    ok(a.done===1&&a.over.miss.join()==='Overseas products'
       &&b.todo===0&&shop.filter((x)=>x.kind==='pjSet').length===0,
       '★★海外向けの商品リストが見つからない店で、薄物を毎回直し続けない');
  }
  /* オフのときは直さない。 */
  const env2=env0(); await setCfg(env2,{ subBoxOn:false });
  await item(env2,fig); await sub(env2,fig.jan);
  reset();
  const o1=(await api(env2,'/sub/box/sync',{})).body;
  const o2=(await api(env2,'/sub/box/sync',{ approve:true })).body;
  ok(o1.on===false&&o1.todo===0&&o2.done===0
     &&shop.filter((x)=>x.kind==='pjSet').length===0,
     '★★★⚙がオフなら何も直さない');
  ok(o1.tiers_text===S.tiersText(TB),'★オフでも「入れたらこうなる」段の表は見られる');
  /* 作業者のキーでは使えない。 */
  reset();
  const s1=await api(env,'/sub/box/sync',{ approve:true },'staff-key-123');
  ok(s1.status===403&&shop.length===0,'★★★作業者のキーでは使えない');
}
T.done();
