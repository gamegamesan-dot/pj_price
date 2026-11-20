/* 決まり・Worker：お一人の上限を Shopify でも抑える（8.83）

   カジの依頼（2026-11-20）「テーマで数量を抑える」＋
     1. 上限を超えた数量の注文が入ったら、運営チャンネルに知らせる
        （会員のプランと、商品・数量・上限だけ。名前・住所・メールは出さない・
          pj にも保存しない）
     2. 貼る場所と手順（手順書）。プランのタグが無い人・ログインしていない人の動き
     3. 海外向けの商品・サービス商品には制限をかけない（会員用の商品だけ）

   ① タグの形（qty-<プラン>-<点数>）は shared/shopcsv.js の1か所
   ② 上限の決まり（shared/mgate.js の qtyOf）と組み合わせの表
   ③ テーマのスニペット（Liquid）に、同じ決まりがそのまま入っている
   ④ ⚙がオフなら今までどおり（タグを付けない）
   ⑤ ⚙がオン：作る商品にタグが付く。数は出ているカードに書いてある数
   ⑥ いまある商品を直す（確かめるだけでは変えない・直したら 0 件）
   ⑦ ⚙をオフに戻すと、付けたタグを外す
   ⑧ 上限を超えた注文の知らせ（webhook）：プラン・商品・数量・上限だけ
   ⑨ 上限を超えた注文の知らせ（注文CSV の取り込み）
   ⑩ migrate-0070 がまだの D1 でも落ちない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const SHOPCSV=require('../shared/shopcsv.js');
const M=require('../shared/mgate.js');
const SUBPLAN=require('../shared/subplan.js');
const T=harness('決まり・Worker：お一人の上限を Shopify でも抑える（8.83）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('qtylim');
const read=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');

/* ---- 作り物の Discord と Shopify ---- */
let dc=[], notes=[], ops=[], sets=[];
const J=(v,st)=>new Response(JSON.stringify(v),{status:st||200,
  headers:{'content-type':'application/json'}});
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/myshopify\.com\/admin\/oauth\/access_token/.test(url))
    return J({ access_token:'shpat-SECRET-TOKEN', expires_in:86399, scope:'x' });
  if(/myshopify\.com\/admin\/api\//.test(url)){
    const b=JSON.parse(String(o.body||'{}'));
    const name=(/(?:query|mutation)\s+(\w+)/.exec(b.query)||[])[1]||'';
    if(name==='pjReady')return J({ data:{ shop:{ name:'店' },
      locations:{ nodes:[{ id:'gid://shopify/Location/1', name:'本店' }] },
      publications:{ nodes:[
        { id:'gid://shopify/Publication/9', supportsFuturePublishing:true,
          catalog:{ title:'オンラインストア' } }] } } });
    if(name==='pjSet'){
      const h=b.variables.input.handle;
      sets.push({ handle:h, tags:b.variables.input.tags||[] });
      return J({ data:{ productSet:{ product:{ id:'gid://shopify/Product/'+h,
        handle:h, status:'UNLISTED', variants:{ nodes:[{ id:'gid://v/'+h,
          inventoryItem:{ id:'gid://shopify/InventoryItem/'+h } }] } },
        userErrors:[] } } });
    }
    if(name==='pjPub')return J({ data:{ publishablePublish:{ userErrors:[] } } });
    if(name==='pjInv')
      return J({ data:{ inventorySetQuantities:{ userErrors:[] } } });
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
    const cc=/\/channels\/(\d+)$/.exec(url);
    if(cc)return J({ id:cc[1], name:'ch-'+cc[1], guild_id:'555000555' });
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    const b=o.body?JSON.parse(String(o.body)):null;
    if((b||{}).embeds!==undefined||!(b||{}).content)
      dc.push({ method:String(o.method||'GET'), ch:m[1]||'', msg:m[2]||'',
                body:b });
    return J({ id:String(900000+dc.length) });
  }
  return J({});
};
const reset=()=>{ dc=[]; notes=[]; ops=[]; sets=[]; W.shopReset(); };
const MO='1111111111', LI='2222222222', ST='3333333333', PR='4444444444';
const SECRET='shpss-test-secret';
const NOW=new Date().toISOString();
const env0=(extra)=>makeEnv(Object.assign({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz', SHOPIFY_WEBHOOK_SECRET:SECRET,
  SHOPIFY_CLIENT_ID:'cid-123', SHOPIFY_CLIENT_SECRET:'csec-SECRET-456',
  DISCORD_OPS_WEBHOOK_URL:'https://discord.com/api/webhooks/7/ops-url-SECRET' },
  extra||{}));
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subOnMonitor:false, gdIdxOn:false,
      subMonNote:false, subChMonitor:MO,
      subOnLight:true, subChLight:LI, subOnStandard:true, subChStandard:ST,
      subOnPremium:true, subChPremium:PR,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const jan=(i)=>'490237055'+String(1000+i);
/* 会員用の印が付いた品（もう Shopify にある）。 */
const add=async(env,i,o)=>{
  const x=o||{}, j=jan(i);
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,wholesale,stock,row_hash,
       seen_at,created_at) VALUES (?1,'いろは商会',0,'NS',?2,2100,20,'h',?3,?3)`)
    .bind(j,'ゲーム'+i,NOW).run();
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,rank,rank_cat,
       checked_at,basis,price_at)
     VALUES (?1,'B0D1GSZJ8T',?2,9000,1200,'s',?4,'ゲーム',?3,'カート',?3)`)
    .bind(j,'テストのゲームソフト その'+i,NOW,100+i*10).run();
  await env.DB.prepare(
    `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,
       at,created_at,shop_pid,shop_iid,shop_at)
     VALUES (?1,1,10,3645,?2,?3,?3,?3,?3,'gid://p','gid://i',?3)`)
    .bind(j,x.grades===undefined?'light,standard,premium':x.grades,NOW).run();
  return j;
};
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
const qOf=(tags)=>SHOPCSV.qtyText(tags);
const rowOf=async(env,j)=>await env.DB.prepare(
  `SELECT * FROM mw_sub WHERE jan=?1`).bind(j).first();

console.log('=== ⑩ migrate-0070 がまだの D1（列が無い）===');
{
  /* 列があると分かったあとは覚えたままになるので、この確認を先にする。 */
  reset();
  const env=env0();
  await env.DB.prepare(`ALTER TABLE mw_sub DROP COLUMN shop_q`).run();
  await setCfg(env,{ subShopQtyOn:true });
  for(let i=0;i<2;i++)await add(env,i);
  const c=await api(env,'/sub/box/sync',{ approve:false });
  console.log('   '+JSON.stringify({ ok:c.ok, qcol:c.qcol, todo:c.todo }));
  ok(c.ok===true&&c.qcol===false,'★★★列が無くても落ちない（無いことを返す）');
  ok(c.todo===0&&sets.length===0,'★★控えられないあいだは、直しに行かない');
}

console.log('\n=== ① タグの形は1か所 ===');
{
  const by={ monitor:1, light:1, standard:2, premium:5 };
  const t=SHOPCSV.tagsOf({ grades:'light,standard,premium', kishu:'NS' },{ qtyBy:by });
  console.log('   '+t.join(', '));
  ok(t.indexOf('qty-light-1')>=0&&t.indexOf('qty-standard-2')>=0
     &&t.indexOf('qty-premium-5')>=0,'★★★プランごとの上限のタグ（qty-プラン-点数）');
  ok(t.indexOf('qty-monitor-1')<0,'★★★その商品のプランのぶんだけ付ける');
  ok(t.indexOf('member-list')>=0&&t.indexOf('grade-light')>=0,
     '★今までのタグ（member-list・grade-◯◯）はそのまま');
  ok(SHOPCSV.qtyText(t)==='light-1,standard-2,premium-5','★控えの形');
  const none=SHOPCSV.tagsOf({ grades:'light' },{});
  ok(none.every((x)=>x.indexOf('qty-')!==0),'★★★⚙がオフ（元が無い）なら付けない');
  const all=SHOPCSV.tagsOf({ grades:'' },{ qtyBy:by });
  ok(SHOPCSV.qtyText(all)==='monitor-1,light-1,standard-2,premium-5',
     '★プランの指定が無い商品（ぜんぶのプラン）は4つ付く');
}

console.log('\n=== ② 上限の決まり（組み合わせの表）===');
const ALL=['member-list','grade-monitor','grade-light','grade-standard',
  'grade-premium','ship-small','qty-monitor-1','qty-light-1','qty-standard-2',
  'qty-premium-5'];
{
  const rows=[
    ['海外向けの商品（os-）',            ['os-item','export'],   ['member-list','grade-premium'], 0],
    ['Omakase Ship のサービス商品',      ['service'],            null, 0],
    ['会員用でない商品に qty- が付いても', ['qty-light-1'],        ['grade-light'], 0],
    ['会員用・上限のタグなし',           ['member-list','grade-light'], ['member-list','grade-light'], 0],
    ['モニター会員',                     ALL, ['member-list','grade-monitor'], 1],
    ['ライト会員',                       ALL, ['member-list','grade-light'], 1],
    ['スタンダード会員',                 ALL, ['member-list','grade-standard'], 2],
    ['プレミアム会員',                   ALL, ['member-list','grade-premium'], 5],
    ['プランを2つ持つ人（大きいほう）',  ALL, ['member-list','grade-light','grade-premium'], 5],
    ['社内（member-staff）',             ALL, ['member-staff'], 0],
    ['ログインしていない',               ALL, null, 1],
    ['ログイン済み・タグなし',           ALL, [], 1],
    ['会員だがプランのタグなし',         ALL, ['member-list'], 1],
    ['プランが合わない（スタンダード商品にライト会員）',
      ['member-list','grade-standard','grade-premium','qty-standard-2','qty-premium-5'],
      ['member-list','grade-light'], 2],
    ['読めないタグは無視',
      ['member-list','qty-light-x','qty-a-b-3','qty-premium-4'], ['grade-premium'], 4]];
  let bad=0;
  for(const r of rows){
    const z=M.qtyOf(r[1],r[2]);
    if(z.max!==r[3]){ bad++; console.log('   NG '+r[0]+' → '+z.max); }
    else console.log('   '+(r[3]?('お一人 '+r[3]+'点'):'上限なし　')+'　'+r[0]);
  }
  ok(bad===0,'★★★組み合わせの表（'+rows.length+'通り）');
  ok(M.qtyOf(ALL,['grade-standard']).plan==='standard','★当たったプランを返す');
  ok(M.qtyOf(ALL,[],{ unknown:'max' }).max===5,
     '★プランが分からない注文は、いちばん大きい数で比べられる');
}

console.log('\n=== ③ テーマのスニペットに同じ決まりが入っている ===');
{
  const q=read('shopify/snippets/member-qty.liquid');
  const g=read('shopify/snippets/member-qty-guard.liquid');
  const code=q.slice(q.indexOf('{%- endcomment -%}'));
  const at=(t)=>code.indexOf(t);
  ok(at("p.tags contains 'member-list'")>0,
     '★★★会員用の商品（member-list）だけ見る（海外向け・サービス商品は 0）');
  ok(at("head == 'qty-'")>at("p.tags contains 'member-list'")
     &&at("split: '-'")>0&&at('parts.size == 3')>0,'★★qty-プラン-点数 を読む');
  ok(at("'grade-' | append: parts[1]")>0&&at('customer.tags contains g')>0,
     '★★★買う人のプラン（grade-◯◯）と突き合わせる');
  ok(at('if n > qmax')>0&&at('n < qmin')>0&&at('assign qmax = qmin')>0,
     '★★★合うプランの大きいほう・合わなければいちばん小さい数');
  ok(at("customer.tags contains 'member-staff'")>at('assign qmax = qmin'),
     '★★社内（member-staff）は上限なし');
  ok(/\{\{ qmax \}\}\s*$/.test(code),'★出すのは数字だけ');
  ok(/render 'member-qty', product: product/.test(g)
     &&/render 'member-qty', product: item\.product/.test(g),
     '★★★商品ページとカートの両方で、同じ部品を使う');
  ok(/template\.name == 'product'/.test(g)&&/for item in cart\.items/.test(g),
     '★商品ページとカートの中身を読む');
  ok(!/customer\.(email|name|first_name|last_name|phone|default_address)/.test(q+g)
     &&!/\baddress\b|\bemail\b/i.test((q+g).replace(/\{%- comment -%\}[\s\S]*?\{%- endcomment -%\}/g,'')),
     '★★★名前・住所・メールは読まない');
  ok(/if \(!any\) return;/.test(g),'★★★会員用の商品が無いページでは何もしない');
  ok(/cart\/change\.js/.test(g)&&/cart\.js/.test(g)&&!/cart\/clear/.test(
     g.replace(/\(add\|change\|update\|clear\)/,'')),
     '★カートは数量を減らすだけ（空にしない）');
  ok(!/https?:\/\//.test(g),'★外のサーバーには何も送らない');
}

console.log('\n=== ④ ⚙がオフなら今までどおり ===');
{
  reset();
  const env=env0();
  await setCfg(env,{});
  for(let i=0;i<3;i++)await add(env,i);
  const c=await api(env,'/sub/box/sync',{ approve:false });
  console.log('   '+JSON.stringify({ qty_on:c.qty_on, qcol:c.qcol, todo:c.todo }));
  ok(c.qty_on===false&&c.qcol===true&&c.todo===0,
     '★★★オフのあいだは、直す商品が無い');
  const r=await api(env,'/sub/box/sync',{ approve:true });
  ok(sets.length===0&&r.ok===true,'★★★「直す」を押しても Shopify を書き換えない');
}

console.log('\n=== ⑤⑥ ⚙がオン：タグを付ける・いまある商品を直す ===');
let envOn=null;
{
  reset();
  const env=env0(); envOn=env;
  /* 前の上限（ライト 2点・スタンダード 5点）のカードを出しておく。 */
  await setCfg(env,{ subLimQLight:2, subLimQStandard:5 });
  const a=await add(env,0), b=await add(env,1);
  await api(env,'/sub/send',{ approve:true });
  await env.DB.prepare(`UPDATE sub_post SET max_q=NULL`).run();
  /* 新しい上限にして、⚙をオンにする。新しい品を1つ足す（カードはまだ）。 */
  await setCfg(env,{ subShopQtyOn:true });
  const c2=await add(env,2,{ grades:'standard,premium' });
  reset();
  const chk=await api(env,'/sub/box/sync',{ approve:false });
  console.log('   確かめる '+JSON.stringify({ todo:chk.todo, qty_n:chk.qty_n,
    why:(chk.items||[]).map((x)=>x.why+':'+x.q) }));
  ok(chk.todo===3&&chk.qty_n===3&&sets.length===0,
     '★★★確かめるだけでは変えない（直す必要がある 3件）');
  ok((chk.items||[]).every((x)=>x.why==='買える数'),'★直す所は「買える数」');
  const go=await api(env,'/sub/box/sync',{ approve:true });
  const tagOf=(j)=>qOf((sets.filter((x)=>x.handle==='sub-'+j)[0]||{}).tags||[]);
  console.log('   直した '+go.done+'件　'+JSON.stringify({ a:tagOf(a), c:tagOf(c2) }));
  ok(go.done===3&&go.fail===0,'★★★いまある商品を直す（3件）');
  ok(tagOf(a)==='light-2,standard-5,premium-5',
     '★★★数は、出ているカードに書いてある数（前の数のカードは 2点・5点）');
  ok(tagOf(c2)==='standard-2,premium-5',
     '★★★カードがまだ無い品はいまの上限（その商品のプランだけ）');
  const all=(sets.filter((x)=>x.handle==='sub-'+a)[0]||{}).tags||[];
  ok(all.indexOf('member-list')>=0&&all.indexOf('grade-light')>=0,
     '★今までのタグも一緒に入れる（消さない）');
  ok(String((await rowOf(env,a)).shop_q)==='light-2,standard-5,premium-5',
     '★★入れた中身を控える（mw_sub.shop_q）');
  reset();
  const again=await api(env,'/sub/box/sync',{ approve:false });
  ok(again.todo===0,'★★★直したあとは 0件（同じ商品を何度も直さない）');
  /* カードを新しい上限に書き換えると、商品のタグも入れ替わる。 */
  await setCfg(env,{ subShopQtyOn:true, subQFix:true });
  await api(env,'/sub/send',{ approve:true });
  reset();
  const c3=await api(env,'/sub/box/sync',{ approve:false });
  ok(c3.qty_n===2,'★★カードを書き換えた品（2件）は、タグも直す必要がある');
  await api(env,'/sub/box/sync',{ approve:true });
  ok(tagOf(a)==='light-1,standard-2,premium-5',
     '★★★カードを新しい上限に直すと、商品のタグも新しい上限になる');
}

console.log('\n=== ⑦ ⚙をオフに戻すと、付けたタグを外す ===');
{
  const env=envOn;
  await setCfg(env,{ subQFix:true });
  reset();
  const c=await api(env,'/sub/box/sync',{ approve:false });
  ok(c.qty_on===false&&c.qty_n===3,'★★★オフにすると、外す必要がある 3件と出る');
  const go=await api(env,'/sub/box/sync',{ approve:true });
  ok(go.done===3&&sets.every((x)=>qOf(x.tags)===''),
     '★★★上限のタグを外す（ほかのタグは残る）');
  ok(sets.every((x)=>x.tags.indexOf('member-list')>=0),'★member-list は残る');
  ok(String((await rowOf(env,jan(0))).shop_q)==='','★控えも空になる');
}

console.log('\n=== ⑤ 自動配信で作る商品にも付く ===');
{
  reset();
  const env=env0();
  await setCfg(env,{ subAutoOn:true, subShopQtyOn:true, subAutoMax:200 });
  for(let i=0;i<3;i++){
    const j='49023705530'+String(10+i);
    await env.DB.prepare(
      `INSERT INTO mw_stock (jan,sha,idx,kishu,name,cond,wholesale,stock,
         ship_days,row_hash,pick,seen_at,created_at)
       VALUES (?1,'いろは商会',0,'NS',?2,'新品',3000,20,1,'h',1,?3,?3)`)
      .bind(j,'テストのゲームソフト 限定版 その'+i,NOW).run();
    await env.DB.prepare(
      `INSERT INTO mw_amz (jan,asin,name,price,fee_total,fee_ref,fee_fba,fee_tax,
         size_tier,size_long,size_wid,size_hei,size_g,size_cm3,rank,rank_cat,
         checked_at,basis,price_at)
       VALUES (?1,?2,?3,9000,1200,700,420,80,'s',17,10.5,1.2,80,200,?4,
               'ゲーム',?5,'カート',?5)`)
      .bind(j,'B0'+j.slice(-8),'テストのゲームソフト 限定版 その'+i,50+i,NOW)
      .run();
  }
  const r=await W.jobSubAuto(env,{ force:true });
  console.log('   作った '+r.shop.made+'件　'+JSON.stringify(sets.slice(0,1)
    .map((x)=>qOf(x.tags))));
  ok(r.shop.made===3&&sets.length>=3,'★自動配信が商品を作る');
  ok(sets.every((x)=>qOf(x.tags)==='light-1,standard-2,premium-5'),
     '★★★作る商品に、いまの上限のタグが付く（ライト1・スタンダード2・プレミアム5）');
  const m=await rowOf(env,'4902370553010');
  ok(String(m.shop_q)==='light-1,standard-2,premium-5','★★控えも入る');
  ok(r.box&&r.box.qty_on===true&&r.box.todo===0,
     '★★作ったばかりの商品は、直す必要が無い');
}

/* ---- 注文（webhook） ---- */
const hmac=async(raw)=>{
  const k=await crypto.subtle.importKey('raw',
    new TextEncoder().encode(SECRET),{ name:'HMAC', hash:'SHA-256' },
    false,['sign']);
  const mac=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(raw));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
};
const NAME='山田 太郎', MAIL='taro.yamada@example.com', ADDR='東京都千代田区1-2-3';
const order=(o)=>Object.assign({ id:'9001', name:'#2001',
  created_at:'2026-11-20T00:00:00Z', email:MAIL, contact_email:MAIL,
  customer:{ id:'7777000001', first_name:'太郎', last_name:'山田', email:MAIL,
             tags:'member-list, grade-light' },
  shipping_address:{ name:NAME, address1:ADDR, phone:'090-0000-0000' },
  billing_address:{ name:NAME, address1:ADDR },
  line_items:[{ sku:'SUB-'+jan(0)+'-20261120', quantity:3,
                title:'テストのゲームソフト その0', variant_id:1 }] },o||{});
const hook=async(env,body,o)=>{
  const raw=JSON.stringify(body);
  const sig=(o||{}).sig===undefined?await hmac(raw):(o||{}).sig;
  const req=new Request('https://x/mem/hook',{ method:'POST',
    headers:{ 'content-type':'application/json',
      'X-Shopify-Topic':(o||{}).topic||'orders/create',
      'X-Shopify-Hmac-Sha256':sig }, body:raw });
  return await asJson(await worker.fetch(req,env,{}));
};
const dump=async(env)=>{
  let t='';
  for(const tb of ['sync_state','sync_runs','sub_order','mw_sub','sub_post',
                   'mem','mem_order','mem_log']){
    try{ t+=JSON.stringify((await env.DB.prepare(`SELECT * FROM ${tb}`).all())
      .results||[]); }catch(e){}
  }
  return t;
};

console.log('\n=== ⑧ 上限を超えた注文の知らせ（webhook）===');
{
  reset();
  const env=env0();
  await setCfg(env,{});
  for(let i=0;i<3;i++)await add(env,i);
  let r=await hook(env,order({}));
  console.log('   '+(ops[0]||'').replace(/\n/g,' ／ '));
  ok(r.status===200&&ops.length===1,'★★★上限を超えた注文を、運営のチャンネルに知らせる');
  ok(notes.length===0,'★★運営専用の宛先があれば、そこだけに出す');
  const t=ops[0]||'';
  ok(/注文 #2001/.test(t)&&/プラン：ライト/.test(t)
     &&/数量 3点／上限 1点/.test(t)&&t.indexOf(jan(0))>=0
     &&/テストのゲームソフト その0/.test(t),
     '★★★出すのは 注文番号・プラン・商品・数量・上限');
  ok(t.indexOf('山田')<0&&t.indexOf('太郎')<0&&t.indexOf(MAIL)<0
     &&t.indexOf('千代田')<0&&t.indexOf('090-')<0&&t.indexOf('7777000001')<0,
     '★★★名前・住所・メール・電話・顧客番号は出さない');
  ok(!/@everyone|@here/.test(t)&&!/いろは商会|卸/.test(t),
     '★★@everyone を使わない・仕入れ元を出さない');
  const d=await dump(env);
  ok(d.indexOf('山田')<0&&d.indexOf('太郎')<0&&d.indexOf(MAIL)<0
     &&d.indexOf('千代田')<0&&d.indexOf('090-0000')<0,
     '★★★名前・住所・メール・電話は pj（D1）に保存しない');
  /* 同じ注文がもう一度来ても（orders/paid）、二度は知らせない。 */
  await hook(env,order({}),{ topic:'orders/paid' });
  ok(ops.length===1,'★★★同じ注文を二度知らせない（orders/create と orders/paid）');
  /* 上限以内は知らせない。 */
  await hook(env,order({ id:'9002', name:'#2002',
    line_items:[{ sku:'SUB-'+jan(0)+'-20261120', quantity:1, title:'x' }] }));
  ok(ops.length===1,'★★★上限以内の注文は知らせない');
  /* プレミアムは 5点まで。6点で知らせる。 */
  const pre={ id:'7', tags:'member-list, grade-premium', first_name:'太郎' };
  await hook(env,order({ id:'9003', name:'#2003', customer:pre,
    line_items:[{ sku:'SUB-'+jan(1)+'-20261120', quantity:5, title:'x' }] }));
  ok(ops.length===1,'★★プレミアム会員の 5点は知らせない');
  await hook(env,order({ id:'9004', name:'#2004', customer:pre,
    line_items:[{ sku:'SUB-'+jan(1)+'-20261120', quantity:4, title:'x' },
                { sku:'SUB-'+jan(1)+'-20261120', quantity:2, title:'x' }] }));
  ok(ops.length===2&&/プラン：プレミアム/.test(ops[1])
     &&/数量 6点／上限 5点/.test(ops[1]),
     '★★★同じ商品が2行に分かれていても足して比べる（6点／上限 5点）');
  /* プランのタグが無い人（すり抜け）は、いちばんきびしい数で比べる。 */
  await hook(env,order({ id:'9005', name:'#2005',
    customer:{ id:'8', tags:'newsletter' },
    line_items:[{ sku:'SUB-'+jan(2)+'-20261120', quantity:2, title:'x' }] }));
  ok(ops.length===3&&/プラン：プランのタグなし/.test(ops[2])
     &&/数量 2点／上限 1点/.test(ops[2]),
     '★★★プランのタグが無い人は、いちばん小さい上限で比べる');
  /* 社内の確認（member-staff）は知らせない。 */
  await hook(env,order({ id:'9006', name:'#2006',
    customer:{ id:'9', tags:'member-staff' } }));
  ok(ops.length===3,'★★社内（member-staff）の注文は知らせない');
  /* 会員用でない商品（海外向け・サービス）は、何点でも知らせない。 */
  await hook(env,order({ id:'9007', name:'#2007',
    line_items:[{ sku:'OS-ABC-123', quantity:50, title:'海外向けの商品' },
                { sku:'', quantity:9, title:'Omakase Ship 転送サービス' },
                { sku:'SERVICE-1', quantity:9, title:'サービス' }] }));
  ok(ops.length===3,'★★★海外向けの商品・サービス商品は見ない（何点でも知らせない）');
  /* 署名が合わなければ見ない。 */
  const bad=await hook(env,order({ id:'9008', name:'#2008' }),{ sig:'AAAA' });
  ok(bad.status===401&&ops.length===3,'★★★署名が合わない注文は見ない');
  /* 宛先や鍵を文に出さない。 */
  ok(ops.join('').indexOf('ops-url-SECRET')<0&&ops.join('').indexOf(SECRET)<0,
     '★★宛先・鍵を文に出さない');
  /* カードに書いてある数（前の数）に合わせて比べる。 */
  const env2=env0();
  await setCfg(env2,{ subLimQLight:2 });
  await add(env2,0);
  await api(env2,'/sub/send',{ approve:true, plan:'light' });
  await env2.DB.prepare(`UPDATE sub_post SET max_q=NULL`).run();
  await setCfg(env2,{});
  reset();
  await hook(env2,order({ line_items:[{ sku:'SUB-'+jan(0)+'-20261120',
    quantity:2, title:'x' }] }));
  ok(ops.length===0,'★★★カードが「お一人 2点まで」のままの品は、2点の注文を知らせない');
  await hook(env2,order({ id:'9010', name:'#2010' }));
  ok(ops.length===1&&/数量 3点／上限 2点/.test(ops[0]),
     '★★3点なら知らせる（上限はカードの数）');
  /* 専用の宛先が無ければ、今までの社内用の宛先へ。 */
  const env3=env0({ DISCORD_OPS_WEBHOOK_URL:'' });
  await setCfg(env3,{}); await add(env3,0);
  reset();
  await hook(env3,order({}));
  ok(ops.length===0&&notes.length===1&&/上限を超えた数量の注文/.test(notes[0]),
     '★★専用の宛先が無ければ、今までの社内用の宛先に出す');
}

console.log('\n=== ⑨ 上限を超えた注文の知らせ（注文CSV の取り込み）===');
{
  reset();
  const env=env0();
  await setCfg(env,{});
  for(let i=0;i<3;i++)await add(env,i);
  await api(env,'/sub/send',{ approve:true });
  reset();
  const S=(i)=>'SUB-'+jan(i)+'-20261120';
  const CSV='Name,Created at,Lineitem quantity,Lineitem price,Lineitem sku,'
    +'Lineitem name,Tags,Shipping Name,Email\n'
    +'#3001,2026-11-20 09:00:00 +0900,3,3645,'+S(0)+',ゲームA,grade-standard,'
      +NAME+','+MAIL+'\n'
    +'#3002,2026-11-20 09:10:00 +0900,2,3645,'+S(0)+',ゲームA,grade-standard,'
      +NAME+','+MAIL+'\n'
    +'#3003,2026-11-20 09:20:00 +0900,3,3645,'+S(1)+',ゲームB,,'+NAME+','+MAIL+'\n'
    +'#3004,2026-11-20 09:30:00 +0900,6,3645,'+S(1)+',ゲームB,,'+NAME+','+MAIL+'\n'
    +'#3005,2026-11-20 09:40:00 +0900,9,1000,OS-XYZ,海外向け,,'+NAME+','+MAIL+'\n';
  const r=await api(env,'/sub/orders',{ text:CSV, name:'orders.csv' });
  const t=ops.join('\n');
  console.log('   '+t.replace(/\n/g,' ／ '));
  ok(r.ok===true&&r.over_qty===2,'★★★取り込みのときにも数える（2件）');
  ok(/注文 #3001　プラン：スタンダード　商品：ゲームA（/.test(t)
     &&/数量 3点／上限 2点/.test(t),
     '★★★注文のタグ（Flow が写したプラン）で比べる（スタンダード 3点／上限 2点）');
  ok(!/#3002/.test(t),'★★上限以内（2点）は知らせない');
  ok(!/#3003/.test(t)&&/注文 #3004　プラン：分かりません/.test(t)
     &&/数量 6点／上限 5点/.test(t),
     '★★★プランが分からない注文は、どのプランでも超える数量だけ知らせる');
  ok(!/#3005/.test(t),'★★★海外向けの商品は見ない');
  ok(t.indexOf('山田')<0&&t.indexOf(MAIL)<0,'★★★名前・メールは出さない');
  const d=await dump(env);
  ok(d.indexOf('山田')<0&&d.indexOf(MAIL)<0,'★★★名前・メールは pj に保存しない');
  /* webhook で知らせた注文は、CSV の取り込みで二度知らせない。 */
  const env2=env0();
  await setCfg(env2,{}); await add(env2,0);
  reset();
  await hook(env2,order({ name:'#4001' }));
  ok(ops.length===1,'★用意：webhook で知らせた');
  await api(env2,'/sub/orders',{ text:
    'Name,Lineitem quantity,Lineitem sku,Tags\n#4001,3,'+S(0)+',grade-light\n',
    name:'o.csv' });
  ok(ops.length===1,'★★★webhook で知らせた注文を、取り込みでもう一度知らせない');
}

console.log('\n=== 共有の決まりを2か所に持たない・作業者は使えない ===');
{
  const w=read('proxy-sync/worker.js');
  const h=read('index.html');
  ok(/MGATE\.qtyOf\(/.test(w)&&!/function qtyOf/.test(w)&&!/function qtyOf/.test(h),
     '★★★上限の決まりは shared/mgate.js の1か所（pj-sync も使う）');
  ok(/SHOPCSV\.qtyTags\(/.test(w)&&!/"qty-"/.test(w)&&!/'qty-'/.test(
       h.replace(/<code>qty-light-1<\/code>/,'')),
     '★★★タグの形は shared/shopcsv.js の1か所');
  const env=env0({ WORKER_KEY:'worker-key-999' });
  const q=post('/sub/box/sync',{ approve:true });
  q.headers.set('X-PJ-Key','worker-key-999');
  const r=await asJson(await worker.fetch(q,env,{}));
  ok(r.status===403||r.status===401||(r.body&&r.body.ok===false),
     '★★作業者のキーでは「商品を直す」を使えない');
  const mg=read('proxy-sync/migrate-0070-sub-qty.sql');
  ok(/ALTER TABLE mw_sub ADD COLUMN shop_q TEXT/.test(mg)
     &&!/UPDATE|DELETE|DROP/.test(mg.replace(/--.*$/gm,'')),
     '★★migrate-0070 は列を足すだけ');
  ok(SUBPLAN.PLANS.every((p)=>p.q>0),'★プランの上限の元は shared/subplan.js のまま');
}
T.done();
