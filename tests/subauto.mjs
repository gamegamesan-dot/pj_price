/* Worker：会員向けの自動配信（8.80）

   カジの依頼（2026-11-20）「会員向けの商品リスト配信（Discord）を自動にする」
   v328 まで自動だったのは「印の付いた品を平日の朝に送る」所だけで、
   候補を選ぶ・印を付ける・Shopify に会員用の商品を作る は PC の画面で
   人がやっていた。pj-sync が定時に自分でやる（jobSubAuto）。

   ① 試し（dry）は**何も書かない・送らない**。止める条件に当たる行は入らない
   ② 本番：Shopify に**非公開（UNLISTED）**で作り、作れた行だけ印を付けて配信
   ③ モニターは**週に5件**（同じ週に2回走っても増えない・前の週の品は選ばない）
   ④ 積み上げ型と、1回の配信件数の上限
   ⑤ **Shopify に作れなかった行は配信しない**（失敗は運営に知らせる）
   ⑥ MW で在庫が切れた品：カードを完売に書き換え、Shopify の在庫を 0 に。
      在庫が戻ればカードも在庫も戻す
   ⑦ 定時（1日2回・夜中は走らない・同じ回を二度走らせない）
   ⑧ 運営への報告（専用の宛先があればそこへ）。鍵をログ・知らせに出さない
   ⑨ いちど決めた値段は動かさない／卸値が変わったら決め直す
   ⑩ 作業者のキーでは使えない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import fs from 'node:fs';
const T=harness('Worker：会員向けの自動配信（8.80）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('subauto');

/* ---- 作り物の Discord と Shopify ---- */
let dc=[], notes=[], ops=[], shop=[];
let shopFail={};          // { handle: 'user'|'http' } … その商品だけ作れない
let shopLocs=null;        // ロケーションの差し替え
let invFail=false;
const J=(v,st)=>new Response(JSON.stringify(v),{status:st||200,
  headers:{'content-type':'application/json'}});
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/myshopify\.com\/admin\/oauth\/access_token/.test(url)){
    shop.push({ kind:'token', body:String(o.body||'') });
    return J({ access_token:'shpat-SECRET-TOKEN', expires_in:86399, scope:'x' });
  }
  if(/myshopify\.com\/admin\/api\//.test(url)){
    const b=JSON.parse(String(o.body||'{}'));
    const name=(/(?:query|mutation)\s+(\w+)/.exec(b.query)||[])[1]||'';
    shop.push({ kind:name, url:url, v:b.variables, q:b.query,
                tok:String((o.headers||{})['x-shopify-access-token']||'') });
    if(name==='pjReady')return J({ data:{ shop:{ name:'店' },
      locations:{ nodes:shopLocs||[{ id:'gid://shopify/Location/1', name:'本店' }] },
      publications:{ nodes:[
        { id:'gid://shopify/Publication/9', supportsFuturePublishing:true,
          catalog:{ title:'オンラインストア' } },
        /* 8.89 海外向けの商品リスト（外せたかを確かめるので、あるものとする）。 */
        { id:'gid://shopify/Publication/3', supportsFuturePublishing:false,
          catalog:{ title:'Overseas products' } },
        { id:'gid://shopify/Publication/8', supportsFuturePublishing:false,
          catalog:{ title:'POS' } }] } } });
    if(name==='pjSet'){
      const h=b.variables.input.handle;
      if(shopFail[h]==='http')return new Response('boom',{status:500});
      if(shopFail[h]==='user')return J({ data:{ productSet:{ product:null,
        userErrors:[{ code:'INVALID', field:['title'], message:'Title is invalid' }] } } });
      return J({ data:{ productSet:{ product:{ id:'gid://shopify/Product/'+h,
        handle:h, status:'UNLISTED', variants:{ nodes:[{ id:'gid://v/'+h,
          inventoryItem:{ id:'gid://shopify/InventoryItem/'+h } }] } },
        userErrors:[] } } });
    }
    if(name==='pjPub')return J({ data:{ publishablePublish:{ userErrors:[] } } });
    if(name==='pjOne')return J({ data:{ productByIdentifier:{ id:'gid://p',
      variants:{ nodes:[{ id:'v', inventoryItem:{ id:'gid://shopify/InventoryItem/looked-up' } }] } } } });
    if(name==='pjInv'){
      if(invFail)return J({ data:{ inventorySetQuantities:{ userErrors:[
        { code:'X', field:[], message:'nope' }] } } });
      return J({ data:{ inventorySetQuantities:{ userErrors:[] } } });
    }
    return J({ data:{} });
  }
  if(/\/api\/webhooks\/7\//.test(url)){
    ops.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response(null,{status:204});
  }
  if(/\/api\/webhooks\//.test(url)){
    notes.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response(null,{status:204});
  }
  if(/discord\.com\/api/.test(url)){
    /* 8.86 チャンネルそのもの（名前・説明文）の読み書きはメッセージでは
       ないので、送ったカードの数には入れない。 */
    if(/\/channels\/\d+$/.test(url))
      return new Response(JSON.stringify({ id:'0' }),
        {status:200,headers:{'content-type':'application/json'}});
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    const b=JSON.parse(String(o.body||'{}'));
    dc.push({ method:String(o.method||'GET'), ch:(m[1]||''), msg:m[2]||'', body:b });
    return J({ id:String(900000+dc.length), name:'部屋', guild_id:'1' });
  }
  return J({});
};
const reset=()=>{ dc=[]; notes=[]; ops=[]; shop=[]; shopFail={}; shopLocs=null;
                  invFail=false; W.shopReset(); };
const CH='1234567890', CH_L='2234567890', CH_S='3234567890';
const NOW=new Date().toISOString();
const env0=(extra)=>makeEnv(Object.assign({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz',
  SHOPIFY_CLIENT_ID:'cid-123', SHOPIFY_CLIENT_SECRET:'csec-SECRET-456' },extra||{}));
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:NOW, settings:Object.assign({ subAutoOn:true,
    subChMonitor:CH, gdIdxOn:false, subMonNote:false,
    subDomain:'omakase-ship.myshopify.com' },o||{}) }),NOW).run();
/* 候補1件（MW の在庫＋Amazon の値段・手数料・採寸）。 */
const item=async(env,jan,o)=>{
  const x=o||{};
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,cond,wholesale,stock,ship_days,
       row_hash,pick,seen_at,created_at)
     VALUES (?1,'いろは商会',0,?2,?3,'新品',?4,?5,1,'h',1,?6,?6)`)
    .bind(jan,x.kishu||'NS',x.name||('テストのゲームソフト '+jan.slice(-3)),
          x.wh||3000,x.stock===undefined?20:x.stock,NOW).run();
  const dim=(x.dim===false)?[0,0,0]:(x.dims||[17,10.5,1.2]);
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,fee_total,fee_ref,fee_fba,fee_tax,
       size_tier,size_long,size_wid,size_hei,size_g,size_cm3,rank,rank_cat,
       checked_at,basis,price_at)
     VALUES (?1,?2,?3,?4,?5,700,420,80,?6,?7,?8,?9,?12,200,?10,'ゲーム',?11,'カート',?11)`)
    .bind(jan,'B0'+jan.slice(-8),
          x.aname===undefined?('テストのゲームソフト '+jan.slice(-3)):x.aname,
          x.price===undefined?9000:x.price,x.fee===undefined?1200:x.fee,
          (x.dim===false)?'':(x.dims?'m':'s'),dim[0],dim[1],dim[2],
          x.rank||500,NOW,x.g||80).run();
};
const G=(n)=>'49023705510'+String(10+n);        // 通るゲーム
const BAD={ loss:'4902370552001', nopx:'4902370552002', name:'4902370552003',
            poster:'4902370552004', nodim:'4902370552005', short:'4902370552006' };
const seed=async(env,n)=>{
  for(let i=0;i<(n||12);i++)await item(env,G(i),{ rank:300+i*20 });
  await item(env,BAD.loss,{ price:3400 });                 // 利益がマイナス
  await item(env,BAD.nopx,{ price:0 });                    // 相場が取れていない
  /* 8.101：MW の名前も同じにする（違うと「商品違いの疑い」も付くため）。 */
  await item(env,BAD.name,{ aname:'ABC-123 XZ', name:'ABC-123 XZ' });   // 名前が崩れている
  await item(env,BAD.poster,{ aname:'テストのゲーム B2ポスター付き' });
  await item(env,BAD.nodim,{ kishu:'b2cchara_figure', dim:false,
                             aname:'テストのフィギュア 1/7スケール' });
  await item(env,BAD.short,{ aname:'ゲーム', name:'ゲーム' });
};
const api=async(env,path,body,key)=>{
  const r=body?post(path,body):get(path);
  if(key)r.headers.set('X-PJ-Key',key);
  return await asJson(await worker.fetch(r,env,{}));
};
const rowsOf=async(env,sql)=>((await env.DB.prepare(sql).all()).results||[]);
const count=async(env,sql)=>Number(((await env.DB.prepare(sql).first())||{}).n||0);

console.log('=== ① 試し（dry）：何も書かない・止める条件の行は入らない ===');
{
  reset();
  const env=env0(); await setCfg(env,{}); await seed(env);
  const d=(await api(env,'/sub/auto/try',{})).body;
  const mon=(d.plans||[]).filter((p)=>p.key==='monitor')[0]||{};
  const jans=(mon.items||[]).map((x)=>x.jan);
  console.log('   候補 '+d.cand_n+' 通った '+d.ok_n+' 新しく '+d.sent
    +' 止めた '+d.stop_n+' '+JSON.stringify(d.tally));
  ok(d.ok===true&&d.dry===true&&d.ran===true,'★試しが返る');
  ok(d.cand_n===18&&d.ok_n===12&&d.stop_n===6,
     '★★候補18件のうち 12件が通り、6件を止める');
  ok(jans.length===5,'★★★モニターは新しく5件');
  const bad=Object.keys(BAD).map((k)=>BAD[k]);
  ok(jans.every((j)=>bad.indexOf(j)<0),
     '★★★止める条件に当たる行は、配信内容に入らない');
  ok(d.tally.loss===1&&d.tally.no_px===1&&d.tally.name===2&&d.tally.poster===1
     &&d.tally.no_dim===1,'★★★止めた理由ごとの件数');
  const st=d.stops_all||[];
  const of=(j)=>(st.filter((x)=>x.jan===j)[0]||{});
  ok(of(BAD.loss).why_ja==='利益がマイナス'
     &&of(BAD.nopx).why_ja==='相場が取れていない'
     &&of(BAD.name).why_ja==='商品名が崩れている（英数字だけ）'
     &&of(BAD.short).why_ja==='商品名が崩れている（短すぎる）'
     &&of(BAD.poster).why_ja==='ポスター'&&of(BAD.nodim).why_ja==='採寸がない',
     '★★★止めた行に理由が付く');
  ok(d.act_n===4,'★利益は足りているのに止めた行（手を打てる行）は4件');
  ok(st.slice(0,4).every((x)=>['loss','low','no_px'].indexOf(x.why[0])<0),
     '★手を打てる行を先に並べる');
  ok(dc.length===0,'★★★Discord に何も送らない');
  ok(notes.length===0&&ops.length===0,'★★★運営のチャンネルにも送らない');
  ok(shop.every((x)=>x.kind==='token'||x.kind==='pjReady'),
     '★★★Shopify は読むだけ（商品を作らない・在庫を変えない）');
  ok(await count(env,`SELECT COUNT(*) AS n FROM mw_sub`)===0
     &&await count(env,`SELECT COUNT(*) AS n FROM sub_post`)===0
     &&await count(env,`SELECT COUNT(*) AS n FROM sub_stop`)===0,
     '★★★D1 に何も書かない（印・カードの控え・止めた行の控え）');
  ok(String(await W.subAutoStatus(env).then((s)=>s.last))==='null',
     '★最後の回の控えも書かない');
  ok(d.shop.ready===true&&d.shop.need===5,'★Shopify につながるかも分かる');
  ok(mon.items.every((x)=>x.is_new===true&&x.price>0&&x.net>0),
     '★新しく作る品には会員価格と手残りが出る');
  /* 自動配信がオフでも試せる。 */
  const env2=env0(); await setCfg(env2,{ subAutoOn:false }); await seed(env2,6);
  const d2=(await api(env2,'/sub/auto/try',{})).body;
  ok(d2.ok===true&&d2.on===false&&d2.sent===5,'★★オフでも試しは押せる');
}

console.log('\n=== ② 本番：Shopify に非公開で作り、作れた行だけ配信する ===');
{
  reset();
  const env=env0(); await setCfg(env,{}); await seed(env);
  const pre=(await api(env,'/sub/auto/try',{})).body;
  const want=((pre.plans||[])[0].items||[]).map((x)=>x.jan+':'+x.price).sort();
  reset();
  const r=await W.jobSubAuto(env,{ force:true });
  console.log('   配信 '+r.sent+' Shopify '+JSON.stringify(r.shop));
  ok(r.ok===true&&r.sent===5&&r.shop.made===5&&r.shop.fail===0,
     '★★★5件を Shopify に作って5枚配信');
  const sets=shop.filter((x)=>x.kind==='pjSet');
  const pubs=shop.filter((x)=>x.kind==='pjPub');
  ok(sets.length===5&&pubs.length===5,'★★作るたびにオンラインストアへ公開する');
  ok(sets.every((x)=>x.v.input.status==='UNLISTED'
     &&/^sub-\d{13}$/.test(x.v.input.handle)
     &&x.v.identifier.handle===x.v.input.handle),
     '★★★非公開（UNLISTED）・handle は sub-<JAN>（あれば直す・無ければ作る）');
  ok(sets.every((x)=>/\/admin\/api\/2026-10\/graphql\.json$/.test(x.url)),
     '★★API の版を固定している');
  ok(pubs.every((x)=>x.v.pub==='gid://shopify/Publication/9'),
     '★★オンラインストア（先の日付で公開できるチャネル）に出す');
  ok(sets.every((x)=>x.v.input.variants[0].inventoryQuantities[0].locationId
     ==='gid://shopify/Location/1'),'★在庫の置き場所を入れる');
  const sj=JSON.stringify(sets.map((x)=>x.v));
  ok(sj.indexOf('いろは商会')<0&&!/matchingworld/i.test(sj)
     &&sj.indexOf('"3000"')<0&&!/image|\.jpg/i.test(sj),
     '★★★Shopify に卸値・社・MW の URL・画像を送らない');
  const posts=dc.filter((x)=>x.method==='POST'&&x.ch===CH);
  ok(posts.length===5,'★★★カードを5枚出す');
  const got=sets.map((x)=>x.v.input.handle.slice(4)+':'+x.v.input.variants[0].price).sort();
  ok(JSON.stringify(got)===JSON.stringify(want),
     '★★★試しで見た中身（商品と値段）が、そのまま本番で出る');
  const cj=JSON.stringify(posts.map((x)=>x.body));
  ok(cj.indexOf('いろは商会')<0&&!/matchingworld/i.test(cj)
     &&!/@everyone|@here/.test(cj)&&cj.indexOf('3000')<0,
     '★★★カードに仕入れ元が分かる情報・@everyone を出さない');
  ok(/omakase-ship\.myshopify\.com\/products\/sub-\d{13}/.test(cj),
     '★★カードのリンク先（会員用の商品）がある');
  const m=await rowsOf(env,`SELECT * FROM mw_sub ORDER BY jan`);
  ok(m.length===5&&m.every((x)=>x.on_sale===1&&x.loaded_at&&x.auto_at
     &&/^gid:\/\/shopify\/Product\//.test(x.shop_pid)
     &&/^gid:\/\/shopify\/InventoryItem\//.test(x.shop_iid)&&x.by_role==='auto'),
     '★★★作れた行にだけ印が付く（Shopify の控えつき）');
  ok(m.every((x)=>x.grades==='monitor,light,standard,premium'),
     '★★★積み上げ型（モニターから上のプランぜんぶ）');
  const st=await rowsOf(env,`SELECT jan, why FROM sub_stop ORDER BY jan`);
  console.log('   止めた行の控え '+JSON.stringify(st));
  ok(st.length===4&&st.filter((x)=>x.jan===BAD.nodim)[0].why==='no_dim',
     '★★★止めた行は理由つきで D1 に残す（採寸がない行も）');
  const rep=notes.join('\n');
  console.log(rep.split('\n').slice(0,6).map((x)=>'   '+x).join('\n'));
  ok(/配信した件数：\*\*5件\*\*（モニター 5件）/.test(rep)
     &&/止めた件数：\*\*6件\*\*/.test(rep)&&/採寸がない：1件/.test(rep)
     &&/売り切れにした件数：\*\*0件\*\*/.test(rep),
     '★★★運営に報告する（プラン別の件数・止めた件数と理由・売り切れ）');
  ok(/テストのフィギュア[^\n]*（4902370552005）… 採寸がない/.test(rep),
     '★★★止めた行の一覧（理由つき）も運営に出す');
  ok(!/@everyone|@here/.test(rep),'★★報告にも @everyone・@here を使わない');
  const s=(await api(env,'/sub/auto')).body;
  ok(s.ok&&s.on===true&&s.last&&s.last.sent===5&&s.hours.join()==='12,20'
     &&s.shop.key===true&&s.shop.host===true&&s.shop.cols===true,
     '★GET /sub/auto で設定と最後の回が見える');
  ok(JSON.stringify(s).indexOf('csec-SECRET')<0
     &&JSON.stringify(s).indexOf('myshopify')<0
     &&JSON.stringify(s).indexOf('webhooks')<0,
     '★★★鍵・宛先は返さない（登録してあるかどうかだけ）');
}

console.log('\n=== ③ モニターは週に5件 ===');
{
  reset();
  const env=env0(); await setCfg(env,{}); await seed(env);
  await W.jobSubAuto(env,{ force:true });
  const first=(await rowsOf(env,`SELECT jan FROM sub_post`)).map((x)=>x.jan);
  reset();
  const r2=await W.jobSubAuto(env,{ force:true });
  console.log('   同じ週の2回目 新しく '+r2.sent+' Shopify '+r2.shop.made);
  ok(r2.sent===0&&dc.filter((x)=>x.method==='POST').length===0,
     '★★★同じ週にもう一度走っても、モニターは増えない（週5件）');
  ok(r2.shop.made===0&&shop.filter((x)=>x.kind==='pjSet').length===0,
     '★★Shopify にも余計な商品を作らない');
  ok(await count(env,`SELECT COUNT(*) AS n FROM mw_sub WHERE on_sale=1`)===5,
     '★印も増えない');
  /* 次の週：前の週のカードを8日前にずらす。 */
  await env.DB.prepare(`UPDATE sub_post SET at=?1`)
    .bind(new Date(Date.now()-8*86400000).toISOString()).run();
  reset();
  const r3=await W.jobSubAuto(env,{ force:true });
  const all=(await rowsOf(env,`SELECT jan FROM sub_post`)).map((x)=>x.jan);
  const fresh=all.filter((j)=>first.indexOf(j)<0);
  console.log('   次の週 新しく '+r3.sent+'（前の週と重なる '
    +(5-fresh.length)+'件）');
  ok(r3.sent===5&&fresh.length===5,
     '★★★次の週は新しい5件（前の週までに出した品は選ばない）');
  /* 件数を⚙で変えられる。 */
  const env2=env0(); await setCfg(env2,{ subMonNew:3 }); await seed(env2);
  reset();
  const r4=await W.jobSubAuto(env2,{ force:true });
  ok(r4.sent===3,'★★モニターの件数は⚙（subMonNew）のまま効く');
}

console.log('\n=== ④ 積み上げ型と、1回の配信件数の上限 ===');
{
  reset();
  const env=env0();
  await setCfg(env,{ subChLight:CH_L, subOnLight:true, subLimNLight:4,
                     subChStandard:CH_S, subOnStandard:true, subLimNStandard:4,
                     subAutoMax:6 });
  /* 通常版のゲーム（モニターから）・限定版のゲーム（ライトから）・
     フィギュア（スタンダードから）を混ぜる。 */
  /* 順位：限定版は 1,000位以内（早い）、通常版は 5,000位以内（ふつう）。 */
  for(let i=0;i<6;i++)await item(env,G(i),{ rank:3000+i*20 });
  for(let i=0;i<4;i++)await item(env,'49023705530'+String(10+i),{ rank:50+i,
    aname:'テストのゲームソフト 限定版 その'+i });
  for(let i=0;i<4;i++)await item(env,'49023705540'+String(10+i),{
    kishu:'b2cchara_figure', price:16000, fee:2400, dims:[30,20,15], g:900,
    rank:400+i, aname:'テストのフィギュア 完成品 その'+i });
  const d=(await api(env,'/sub/auto/try',{})).body;
  console.log('   '+d.plans.map((p)=>p.key+' 新しく '+p.add).join('／')
    +'　上限で回した '+d.cut);
  ok(d.max===6&&d.cut>0,'★★上限（6件）を超えたぶんは次の回に回す');
  reset();
  const r=await W.jobSubAuto(env,{ force:true });
  const m=await rowsOf(env,`SELECT jan, grades FROM mw_sub WHERE on_sale=1`);
  console.log('   印 '+m.length+'件 '+JSON.stringify(m.map((x)=>x.grades.split(',')[0])));
  ok(m.length===6,'★★★1回に新しく出す商品は上限まで（6件）');
  ok(r.shop.made===6,'★Shopify に作るのも上限まで');
  const kinds={};
  m.forEach((x)=>{ const k=x.grades.split(',')[0]; kinds[k]=(kinds[k]||0)+1; });
  ok(kinds.monitor===2&&kinds.light===2&&kinds.standard===2,
     '★★プランを順に1件ずつ取る（どのプランも0件にならない）');
  const chOf=(ch)=>dc.filter((x)=>x.method==='POST'&&x.ch===ch)
    .map((x)=>/sub-(\d{13})/.exec(JSON.stringify(x.body))[1]);
  const mon=m.filter((x)=>/^monitor/.test(x.grades)).map((x)=>x.jan);
  const std=m.filter((x)=>/^standard/.test(x.grades)).map((x)=>x.jan);
  ok(mon.every((j)=>chOf(CH).indexOf(j)>=0),'★モニターの品はモニターに出る');
  ok(std.every((j)=>chOf(CH).indexOf(j)<0&&chOf(CH_L).indexOf(j)<0),
     '★★★スタンダードから上の品は、モニター・ライトには出ない');
  ok(std.every((j)=>chOf(CH_S).indexOf(j)>=0),
     '★スタンダードの品はスタンダードに出る');
  ok(mon.some((j)=>chOf(CH_L).indexOf(j)>=0||chOf(CH_S).indexOf(j)>=0),
     '★★★下のプランの品は、上のプランにも出る（積み上げ型）');
  const rep=notes.join('\n');
  ok(/モニター \d+件／ライト \d+件／スタンダード \d+件/.test(rep),
     '★報告はプラン別の件数');
}

console.log('\n=== ⑤ Shopify に作れなかった行は配信しない ===');
{
  reset();
  const env=env0(); await setCfg(env,{}); await seed(env);
  const pre=(await api(env,'/sub/auto/try',{})).body;
  const pick=((pre.plans||[])[0].items||[]).map((x)=>x.jan);
  reset();
  shopFail['sub-'+pick[0]]='user';
  shopFail['sub-'+pick[1]]='http';
  const r=await W.jobSubAuto(env,{ force:true });
  console.log('   配信 '+r.sent+' 作れなかった '+r.shop.fail+' '
    +JSON.stringify(r.errors));
  ok(r.shop.made===3&&r.shop.fail===2,'★2件が作れなかった');
  ok(r.sent===3,'★★★作れなかった行は配信しない（3枚だけ出る）');
  const cj=JSON.stringify(dc.map((x)=>x.body));
  ok(cj.indexOf(pick[0])<0&&cj.indexOf(pick[1])<0,
     '★★★作れなかった商品のカードは出ていない');
  ok(await count(env,`SELECT COUNT(*) AS n FROM mw_sub WHERE on_sale=1`)===3,
     '★★★作れなかった行には印を付けない');
  const rep=notes.join('\n');
  ok(/呼び出しの失敗/.test(rep)&&/Title is invalid/.test(rep)
     &&/HTTP 500/.test(rep),'★★★失敗を理由つきで運営に知らせる');
  ok(/Shopify に商品を作れなかった：2件/.test(rep),'★止めた理由にも数える');
  const st=await rowsOf(env,`SELECT jan, why FROM sub_stop WHERE why='shop'`);
  ok(st.length===2,'★止めた行の控えにも残る');
  /* 次の回で直っていれば作って出す（モニターの週の残り2件）。 */
  reset();
  const r2=await W.jobSubAuto(env,{ force:true });
  ok(r2.sent===2&&r2.shop.made===2,'★★次の回に、作れたぶんを出す');
  ok(await count(env,`SELECT COUNT(*) AS n FROM sub_stop WHERE why='shop'
      AND COALESCE(off_at,'')=''`)===0,'★直った行は「止まっていない」に戻す');

  /* 鍵が登録されていない。 */
  reset();
  const env2=makeEnv({ DISCORD_BOT_TOKEN:'bot-token-xyz' });
  await setCfg(env2,{}); await seed(env2);
  const d2=(await api(env2,'/sub/auto/try',{})).body;
  ok(d2.shop.ready===false&&/鍵が pj-sync に登録されていません/.test(d2.shop.why)
     &&d2.sent===0,'★★★鍵が無いと「新しい商品は出ない」と試しで分かる');
  const r3=await W.jobSubAuto(env2,{ force:true });
  ok(r3.sent===0&&dc.length===0&&shop.length===0
     &&await count(env2,`SELECT COUNT(*) AS n FROM mw_sub`)===0,
     '★★★鍵が無ければ、商品も作らずカードも出さない');
  ok(/Shopify：Shopify の鍵が pj-sync に登録されていません/.test(notes.join('\n')),
     '★★運営に理由を知らせる');

  /* 管理用ドメインが myshopify.com でない。 */
  reset();
  const env3=env0(); await setCfg(env3,{ subDomain:'shop.example.com' });
  await seed(env3,6);
  const d3=(await api(env3,'/sub/auto/try',{})).body;
  ok(d3.shop.ready===false&&/管理用ドメイン/.test(d3.shop.why),
     '★独自ドメインだけでは管理 API を呼ばない（⚙に管理用ドメインが要る）');
  await setCfg(env3,{ subDomain:'shop.example.com',
                      subShopAdmin:'https://omakase-ship.myshopify.com/' });
  reset();
  const d4=(await api(env3,'/sub/auto/try',{})).body;
  ok(d4.shop.ready===true,'★⚙の管理用ドメインを入れれば使える');

  /* ロケーションが2つ以上。 */
  reset();
  shopLocs=[{ id:'gid://shopify/Location/1', name:'本店' },
            { id:'gid://shopify/Location/2', name:'倉庫' }];
  const d5=(await api(env3,'/sub/auto/try',{})).body;
  ok(d5.shop.ready===false&&/ロケーション/.test(d5.shop.why),
     '★★置き場所が2つ以上で決められないときは作らない');
  await setCfg(env3,{ subDomain:'omakase-ship.myshopify.com', mwSubLoc:'倉庫' });
  reset();
  shopLocs=[{ id:'gid://shopify/Location/1', name:'本店' },
            { id:'gid://shopify/Location/2', name:'倉庫' }];
  const r6=await W.jobSubAuto(env3,{ force:true });
  ok(r6.shop.made===5&&shop.filter((x)=>x.kind==='pjSet').every((x)=>
     x.v.input.variants[0].inventoryQuantities[0].locationId==='gid://shopify/Location/2'),
     '★★⚙「ロケーション名」と合う置き場所を使う');
}

console.log('\n=== ⑥ MW で在庫が切れた品：完売に書き換え、Shopify の在庫を 0 に ===');
{
  reset();
  const env=env0(); await setCfg(env,{}); await seed(env);
  await W.jobSubAuto(env,{ force:true });
  const sent=await rowsOf(env,`SELECT jan, msg_id FROM sub_post ORDER BY jan`);
  const outJan=sent[0].jan, goneJan=sent[1].jan;
  await env.DB.prepare(`UPDATE mw_stock SET stock=0 WHERE jan=?1`).bind(outJan).run();
  await env.DB.prepare(`UPDATE mw_stock SET gone_at=?2 WHERE jan=?1`)
    .bind(goneJan,NOW).run();
  /* 試しでも「売り切れにする」と分かる。 */
  reset();
  const d=(await api(env,'/sub/auto/try',{})).body;
  ok(d.sold_out===2&&d.shop.zero===2&&dc.length===0
     &&shop.every((x)=>x.kind!=='pjInv'),
     '★★試しで「売り切れにする2件」と出る（何も変えない）');
  reset();
  const r=await W.jobSubAuto(env,{ force:true });
  console.log('   売り切れ '+r.sold_out+' Shopify 0に '+r.shop.zero);
  ok(r.sold_out===2,'★★★売り切れにした件数');
  const pat=dc.filter((x)=>x.method==='PATCH');
  ok(pat.length===2&&pat.every((x)=>/完売しました/.test(JSON.stringify(x.body))),
     '★★★配信済みのカードを「完売」に書き換える（消さない）');
  ok(dc.filter((x)=>x.method==='DELETE').length===0,'★メッセージは消さない');
  const inv=shop.filter((x)=>x.kind==='pjInv');
  ok(inv.length===2&&inv.every((x)=>x.v.input.quantities[0].quantity===0
     &&x.v.input.quantities[0].changeFromQuantity===null
     &&x.v.input.name==='available'
     &&/^gid:\/\/shopify\/InventoryItem\/sub-/.test(x.v.input.quantities[0].inventoryItemId)
     &&x.v.input.quantities[0].locationId==='gid://shopify/Location/1'
     &&/^[0-9a-f-]{36}$/.test(String(x.v.key))&&/@idempotent\(key: \$key\)/.test(x.q)),
     '★★★Shopify の会員用商品の在庫を 0 にする');
  ok(await count(env,`SELECT COUNT(*) AS n FROM mw_sub
      WHERE COALESCE(shop_zero_at,'')<>''`)===2,'★0 にした印を控える');
  ok(await count(env,`SELECT COUNT(*) AS n FROM sub_post WHERE sold_out=1`)===2,
     '★カードの控えも完売になる');
  ok(/売り切れにした件数：\*\*2件\*\*/.test(notes.join('\n'))
     &&/在庫を0にした 2件/.test(notes.join('\n')),'★★★運営に報告する');
  /* もう一度走っても、同じことを繰り返さない。 */
  reset();
  const r2=await W.jobSubAuto(env,{ force:true });
  ok(r2.sold_out===0&&dc.filter((x)=>x.method==='PATCH').length===0
     &&shop.filter((x)=>x.kind==='pjInv').length===0,
     '★★同じカードを何度も書き換えない・Shopify も呼び直さない');
  /* MW に在庫が戻った。 */
  await env.DB.prepare(`UPDATE mw_stock SET stock=20 WHERE jan=?1`).bind(outJan).run();
  reset();
  const r3=await W.jobSubAuto(env,{ force:true });
  const inv3=shop.filter((x)=>x.kind==='pjInv');
  console.log('   在庫が戻った：Shopify '+JSON.stringify(inv3.map((x)=>
    x.v.input.quantities[0].quantity))+' 書き換え '+r3.edited);
  ok(inv3.length===1&&inv3[0].v.input.quantities[0].quantity===5&&r3.shop.back===1,
     '★★★在庫が戻れば Shopify の在庫を残りの数に戻す');
  ok(dc.filter((x)=>x.method==='PATCH'&&x.msg===sent[0].msg_id
     &&/購入する/.test(JSON.stringify(x.body))).length===1,
     '★★★カードも元（購入できる）に戻す');
  /* Shopify の在庫を戻せなかったら、カードは完売のまま。 */
  await env.DB.prepare(`UPDATE mw_stock SET gone_at=NULL WHERE jan=?1`)
    .bind(goneJan).run();
  reset(); invFail=true;
  const r4=await W.jobSubAuto(env,{ force:true });
  ok(dc.filter((x)=>x.method==='PATCH'&&x.msg===sent[1].msg_id).length===0
     &&/在庫を戻せませんでした/.test(r4.errors.join('／')),
     '★★Shopify の在庫を戻せないあいだは、カードを完売のままにする');
  /* 自動配信がオフのときは、手の配信の動きを変えない。 */
  const env2=env0(); await setCfg(env2,{}); await seed(env2,6);
  await W.jobSubAuto(env2,{ force:true });
  await setCfg(env2,{ subAutoOn:false, subOn:true });
  await env2.DB.prepare(`UPDATE mw_stock SET stock=0`).run();
  reset();
  const p=(await api(env2,'/sub/plan')).body;
  const mon=(p.plans||[]).filter((x)=>x.key==='monitor')[0];
  ok(mon.items.every((x)=>x.left>0),
     '★★自動配信がオフなら、今までどおり（勝手に完売にしない）');
}

console.log('\n=== ⑦ 定時（1日2回・夜中は走らない・同じ回は1回だけ）===');
{
  reset();
  const env=env0(); await setCfg(env,{}); await seed(env,6);
  const runsN=()=>count(env,`SELECT COUNT(*) AS n FROM sync_runs WHERE kind='sub-auto'`);
  /* JST 13時（配信の時刻ではない）。 */
  const a=await W.jobSubAuto(env,{ now:'2026-11-20T04:10:00Z' });
  ok(a.ran===false&&/時刻ではありません/.test(a.why)&&dc.length===0,
     '★★配信の時刻でなければ走らない');
  ok(await runsN()===0,'★時刻でない回は実行の記録も残さない');
  /* JST 3時（夜中）。⚙に 3 を入れても走らない。 */
  await setCfg(env,{ subAutoHours:'3,12,20' });
  const b=await W.jobSubAuto(env,{ now:'2026-11-19T18:10:00Z' });
  ok(b.ran===false&&dc.length===0,'★★★夜中（0:00〜8:00）は配信しない');
  /* JST 12時。 */
  const c=await W.jobSubAuto(env,{ now:'2026-11-20T03:10:00Z' });
  ok(c.ran===true&&c.sent===5&&c.slot==='2026-11-20@12','★★★12時の回で配信する');
  reset();
  const c2=await W.jobSubAuto(env,{ now:'2026-11-20T03:40:00Z' });
  ok(c2.ran===false&&/もう走っています/.test(c2.why)&&dc.length===0
     &&notes.length===0,'★★★同じ回を二度走らせない');
  /* JST 20時（2回目）。 */
  const e=await W.jobSubAuto(env,{ now:'2026-11-20T11:10:00Z' });
  ok(e.ran===true&&e.slot==='2026-11-20@20','★★20時の回も走る（1日2回）');
  /* 土日を切る。2026-11-21 は土曜。 */
  await setCfg(env,{ subAutoWeekend:false });
  const f=await W.jobSubAuto(env,{ now:'2026-11-21T03:10:00Z' });
  ok(f.ran===false,'★⚙「土日も配信する」を切ると土曜は走らない');
  await setCfg(env,{});
  const f2=await W.jobSubAuto(env,{ now:'2026-11-21T03:10:00Z' });
  ok(f2.ran===true,'★既定は土曜も走る');
  /* オフ。 */
  await setCfg(env,{ subAutoOn:false });
  const g=await W.jobSubAuto(env,{ now:'2026-11-22T03:10:00Z' });
  ok(g.ran===false&&/オフ/.test(g.why),'★★★⚙でオフにすると走らない');
  /* 「今日は送らない」の印。 */
  await setCfg(env,{});
  await env.DB.prepare(`INSERT INTO sync_state (k,v,updated_at) VALUES ('sub.skip',?1,?2)
    ON CONFLICT(k) DO UPDATE SET v=excluded.v`).bind('2026-11-23',NOW).run();
  reset();
  const h=await W.jobSubAuto(env,{ now:'2026-11-23T03:10:00Z' });
  ok(h.ran===false&&/今日は送らない/.test(h.why)&&shop.length===0,
     '★★「今日は送らない」の印がある日は走らない');
  /* 定時の回への組み込み（毎時の回のいちばん最後・在庫CSV の取り込みの後）。 */
  const src=fs.readFileSync(new URL('../proxy-sync/worker.js',import.meta.url),'utf8');
  const iCsv=src.indexOf('await jobMwCsv(env, { src: "auto" })');
  const iAuto=src.indexOf('await jobSubAuto(env, {});');
  ok(iCsv>0&&iAuto>iCsv,
     '★★★MW の在庫CSV の取り込みより後に走る（新しい在庫は次の定時にまとめて配信）');
  ok(/if \(sa\.autoOn && SUBAUTO\.dueOf\(sa\.autoHours, subJst\(\), sa\.autoWeekend\)\)/.test(src),
     '★定時の回は時刻を見てから呼ぶ');
  ok(/if \(weekday && !sc\.autoOn\)\s*\n\s*await jobSubSend\(env, \{ approve: true, auto: true \}\);/.test(src)
     &&/if \(sc\.pre && !sc\.autoOn && tomo >= 1/.test(src),
     '★★自動配信を使うあいだは、平日の朝の回と予告を出さない（二重に出さない）');
  /* ボットの鍵が無い。 */
  const env2=makeEnv({ SHOPIFY_CLIENT_ID:'c', SHOPIFY_CLIENT_SECRET:'s' });
  await setCfg(env2,{}); await seed(env2,6);
  reset();
  const k=await W.jobSubAuto(env2,{ force:true });
  ok(k.error==='no_token'&&shop.length===0
     &&/DISCORD_BOT_TOKEN/.test(notes.join('\n')),
     '★ボットの鍵が無ければ何もせず、運営に知らせる');
}

console.log('\n=== ⑧ 運営専用の宛先・鍵を出さない ===');
{
  reset();
  const env=env0({ DISCORD_OPS_WEBHOOK_URL:'https://discord.com/api/webhooks/7/ops-url-SECRET' });
  await setCfg(env,{}); await seed(env);
  const r=await W.jobSubAuto(env,{ force:true });
  ok(ops.length>=1&&notes.length===0,
     '★★★専用の宛先（DISCORD_OPS_WEBHOOK_URL）があれば、報告はそこだけに出す');
  ok(dc.every((x)=>x.ch===CH),'★会員のチャンネルにはカードだけ');
  const tk=shop.filter((x)=>x.kind==='token');
  ok(tk.length===1&&/grant_type=client_credentials/.test(tk[0].body)
     &&/client_id=cid-123/.test(tk[0].body)&&!/scope=/.test(tk[0].body),
     '★★鍵の交換は1回だけ（client credentials）');
  ok(shop.filter((x)=>x.kind!=='token').every((x)=>x.tok==='shpat-SECRET-TOKEN'),
     '★交換した鍵で呼ぶ');
  const runs=JSON.stringify(await rowsOf(env,`SELECT * FROM sync_runs`));
  const state=JSON.stringify(await rowsOf(env,`SELECT * FROM sync_state`));
  const subs=JSON.stringify(await rowsOf(env,`SELECT * FROM mw_sub`));
  const all=runs+state+subs+ops.join('\n')+JSON.stringify(dc)+JSON.stringify(r);
  ok(all.indexOf('csec-SECRET-456')<0&&all.indexOf('shpat-SECRET-TOKEN')<0
     &&all.indexOf('ops-url-SECRET')<0&&all.indexOf('bot-token-xyz')<0,
     '★★★鍵・交換した鍵・宛先を、D1・知らせ・カード・返事のどこにも出さない');
  /* 旧い形の鍵（管理画面のカスタムアプリ）でも動く。 */
  reset();
  const env2=makeEnv({ DISCORD_BOT_TOKEN:'bot-token-xyz',
                       SHOPIFY_ADMIN_TOKEN:'shpat-OLD-TOKEN' });
  await setCfg(env2,{}); await seed(env2,6);
  const r2=await W.jobSubAuto(env2,{ force:true });
  ok(r2.shop.made===5&&shop.filter((x)=>x.kind==='token').length===0
     &&shop.every((x)=>x.tok==='shpat-OLD-TOKEN'),
     '★前からある鍵（SHOPIFY_ADMIN_TOKEN）でも動く');
  /* 会員の月額課金（8.56）で登録した SHOPIFY_WEBHOOK_SECRET は同じアプリの
     client secret。専用の SHOPIFY_CLIENT_SECRET が無ければそれで交換する。 */
  reset();
  const env3=makeEnv({ DISCORD_BOT_TOKEN:'bot-token-xyz',
    SHOPIFY_CLIENT_ID:'cid-123', SHOPIFY_WEBHOOK_SECRET:'hook-SECRET-789' });
  await setCfg(env3,{}); await seed(env3,6);
  const r3=await W.jobSubAuto(env3,{ force:true });
  const tk3=shop.filter((x)=>x.kind==='token');
  ok(r3.shop.made===5&&tk3.length===1
     &&/client_secret=hook-SECRET-789/.test(tk3[0].body),
     '★★client secret が1つだけ登録済み（SHOPIFY_WEBHOOK_SECRET）でも動く');
  ok(W.shopKeyKind({ SHOPIFY_CLIENT_ID:'x' })===''
     &&W.shopKeyKind({ SHOPIFY_WEBHOOK_SECRET:'y' })==='',
     '★client ID か secret の片方だけでは「未登録」');
  /* 許可表：版の違う口・ほかの店の形は通さない。 */
  const g=(m,u,w)=>{ try{ W.assertReadOnly(u,m,{},w); return true; }catch(e){ return false; } };
  ok(g('POST','https://omakase-ship.myshopify.com/admin/api/2026-10/graphql.json',true)
     &&!g('POST','https://omakase-ship.myshopify.com/admin/api/2026-10/graphql.json',false),
     '★★Shopify の口は write:true を付けた呼び出しだけ通す');
  ok(!g('POST','https://omakase-ship.myshopify.com/admin/api/2025-01/graphql.json',true)
     &&!g('POST','https://evil.example.com/admin/api/2026-10/graphql.json',true)
     &&!g('DELETE','https://omakase-ship.myshopify.com/admin/api/2026-10/graphql.json',true)
     &&!g('POST','https://omakase-ship.myshopify.com/admin/api/2026-10/orders.json',true),
     '★★版の違う口・ほかの宛先・ほかの窓口は通さない');
}

console.log('\n=== ⑨ いちど決めた値段は動かさない ===');
{
  reset();
  const env=env0(); await setCfg(env,{}); await seed(env);
  await W.jobSubAuto(env,{ force:true });
  const p1=await rowsOf(env,`SELECT jan, price FROM mw_sub ORDER BY jan`);
  /* 日が変わっても（上乗せの乱数が変わっても）値段はそのまま。 */
  reset();
  await W.jobSubAuto(env,{ force:true,
    now:new Date(Date.now()+86400000).toISOString() });
  const p2=await rowsOf(env,`SELECT jan, price FROM mw_sub ORDER BY jan`);
  ok(p1.every((x)=>(p2.filter((y)=>y.jan===x.jan)[0]||{}).price===x.price),
     '★★★配信済みの品の値段は、回が変わっても動かさない');
  ok(dc.filter((x)=>x.method==='PATCH').length===0,
     '★値段が同じならカードも書き換えない');
  /* 卸値が変わったら決め直して、Shopify もカードも直す。 */
  const j=p1[0].jan;
  await env.DB.prepare(`UPDATE mw_stock SET wholesale=3600 WHERE jan=?1`).bind(j).run();
  reset();
  const r=await W.jobSubAuto(env,{ force:true });
  const now=(await rowsOf(env,`SELECT price FROM mw_sub WHERE jan='${j}'`))[0].price;
  console.log('   卸値 3000→3600：会員価格 '+p1[0].price+' → '+now);
  ok(now>p1[0].price+500,'★★卸値が変わった品は値段を決め直す');
  ok(shop.filter((x)=>x.kind==='pjSet'&&x.v.input.handle==='sub-'+j
     &&x.v.input.variants[0].price===String(now)).length===1,
     '★★Shopify の値段も直す');
  ok(dc.filter((x)=>x.method==='PATCH').length===1,'★カードも書き換える');
  /* カジが手で直した値段はそのまま。 */
  await env.DB.prepare(`UPDATE mw_sub SET price=9999, px_hand=1 WHERE jan=?1`)
    .bind(p1[1].jan).run();
  reset();
  await W.jobSubAuto(env,{ force:true });
  ok((await rowsOf(env,`SELECT price FROM mw_sub WHERE jan='${p1[1].jan}'`))[0].price===9999,
     '★★★手で直した値段（px_hand）は決め直さない');
}

console.log('\n=== ⑪ 出しておく商品の上限（古い順に受付終了）===');
{
  /* 配信が見るのは新しい順に SUB_ROWS_MAX 件まで。自動配信は商品が増え続ける
     ので、超えたぶんは古い順に 在庫0 → 印を外す → カードは受付終了。 */
  reset();
  const env=env0(); await setCfg(env,{}); await seed(env,6);
  const MAX=W.SUB_ROWS_MAX;
  const old=(i)=>'4900000'+String(100000+i);
  const st=[];
  for(let i=0;i<MAX+2;i++){
    const at=new Date(Date.parse('2026-10-01T00:00:00Z')+i*60000).toISOString();
    st.push(env.DB.prepare(
      `INSERT INTO mw_stock (jan,sha,idx,kishu,name,cond,wholesale,stock,ship_days,
         row_hash,pick,seen_at,created_at)
       VALUES (?1,'S',0,'NS',?2,'新品',3000,20,1,'h',1,?3,?3)`)
      .bind(old(i),'前から出している品 '+i,at));
    st.push(env.DB.prepare(
      `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
       VALUES (?1,1,3,4000,'premium',?2,?2,?2,?2)`).bind(old(i),at));
  }
  for(let i=0;i<st.length;i+=50)await env.DB.batch(st.slice(i,i+50));
  /* いちばん古い品にはカードが出ている（モニターの週の件数に数えないよう、
     別のチャンネルに置く）。 */
  await env.DB.prepare(
    `INSERT INTO sub_post (jan,ch,plan,msg_id,price,qty,sold,sold_out,at,created_at)
     VALUES (?1,?2,'premium','777001',4000,3,0,0,?3,?3)`)
    .bind(old(0),CH_S,NOW).run();
  const d=(await api(env,'/sub/auto/try',{})).body;
  console.log('   試し：受付終了にする '+d.trim+'件（上限 '+d.keep_max+'件）');
  ok(d.trim===7&&d.keep_max===MAX,
     '★★試しで「古い順に7件を受付終了にする」と分かる（前から2件超過＋新しい5件）');
  ok(await count(env,`SELECT COUNT(*) AS n FROM mw_sub WHERE on_sale=1`)===MAX+2,
     '★試しでは印を外さない');
  reset();
  const r=await W.jobSubAuto(env,{ force:true });
  const on=await count(env,`SELECT COUNT(*) AS n FROM mw_sub WHERE on_sale=1`);
  console.log('   本番：受付終了 '+r.trim+'件・出している商品 '+on+'件');
  ok(r.trim===7&&on===MAX,'★★★出している商品は上限（'+MAX+'件）に収まる');
  const off=(await rowsOf(env,`SELECT jan FROM mw_sub WHERE on_sale=0 ORDER BY jan`))
    .map((x)=>x.jan);
  ok(off.join()===[0,1,2,3,4,5,6].map(old).join(),
     '★★★外すのは**古い順**（新しく選んだ品は残る）');
  const inv=shop.filter((x)=>x.kind==='pjInv');
  ok(inv.length===7&&inv.every((x)=>x.v.input.quantities[0].quantity===0),
     '★★★外した品の Shopify の在庫を 0 にする（買えないようにする）');
  ok(dc.filter((x)=>x.method==='PATCH'&&x.msg==='777001'
     &&/受付は終わりました/.test(JSON.stringify(x.body))).length===1,
     '★★外した品のカードは「受付終了」に書き換わる');
  ok(/受付終了にした件数（出しておく上限を超えた古い品）：\*\*7件\*\*/
     .test(notes.join('\n')),'★★運営に報告する');
  /* Shopify を呼べなかった品は印を残して、次の回にやり直す。 */
  const env2=env0(); await setCfg(env2,{});
  const st2=[];
  for(let i=0;i<MAX+1;i++){
    const at=new Date(Date.parse('2026-10-01T00:00:00Z')+i*60000).toISOString();
    st2.push(env2.DB.prepare(
      `INSERT INTO mw_stock (jan,sha,idx,kishu,name,cond,wholesale,stock,ship_days,
         row_hash,pick,seen_at,created_at)
       VALUES (?1,'S',0,'NS','品','新品',3000,20,1,'h',1,?2,?2)`).bind(old(i),at));
    st2.push(env2.DB.prepare(
      `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
       VALUES (?1,1,3,4000,'premium',?2,?2,?2,?2)`).bind(old(i),at));
  }
  for(let i=0;i<st2.length;i+=50)await env2.DB.batch(st2.slice(i,i+50));
  reset(); invFail=true;
  const r2=await W.jobSubAuto(env2,{ force:true });
  ok(r2.trim===0&&await count(env2,`SELECT COUNT(*) AS n FROM mw_sub WHERE on_sale=1`)===MAX+1
     &&/在庫を0にできませんでした/.test(r2.errors.join('／')),
     '★★Shopify の在庫を 0 にできなかった品は印を残す（次の回にやり直す）');
}

console.log('\n=== ⑩ 作業者のキーでは使えない ===');
{
  reset();
  const env=env0(); await setCfg(env,{}); await seed(env,6);
  const a=await api(env,'/sub/auto/try',{},'staff-key-123');
  const b=await api(env,'/sub/auto',null,'staff-key-123');
  ok(a.status===403&&b.status===403,
     '★★★作業者のキーでは試しも様子見もできない（値段と手残りが出るため）');
  ok(dc.length===0&&shop.length===0,'★何も呼ばない');
}
T.done();
