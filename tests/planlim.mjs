/* 決まり・Worker：会員プランの上限（8.82）

   カジの依頼（2026-11-20）「会員プランの上限を変更してください。料金表を
   見直しました」
     モニター     1回のリスト 5件まで／1商品で買える数 1点まで（今のまま）
     ライト       5件／1点      （前は 2点）
     スタンダード 20件／2点     （前は 5点）
     プレミアム   50件／5点

   ① 数字の元は shared/subplan.js の PLANS の1か所。⚙（subLimN*・subLimQ*）で
      変えられる。前の欄（subN*・subQ*）に残っている数は上限には使わない
   ② 届く商品の種類は変えない
   ③ 件数が上限を超えるときは、**今の並びのまま上から**上限まで
   ④ 新しく出すカードは新しい上限（お一人◯点まで）
   ⑤ **出ているカードは、カジが決めるまで前の数のまま**（値段の書き換えでも
      数は変えない）。上限より多いカードの件数を数えて返す
   ⑥ ⚙「出ているカードも書き換える」をオンにすると、新しい上限に書き換える
   ⑦ 注文を取り込んだときの書き換えでも、数は前のまま
   ⑧ 自動配信（jobSubAuto）も同じ上限・同じ数え上げ
   ⑨ migrate-0069 がまだの D1 でも落ちない・数字が行ったり来たりしない
   ⑩ 会員向けのカードに、仕入れ元が分かる情報を出さない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import SUBPLAN from '../shared/subplan.js';
import fs from 'node:fs';
const T=harness('決まり・Worker：会員プランの上限（8.82）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('planlim');

/* ---- 作り物の Discord と Shopify ---- */
let dc=[];
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
          catalog:{ title:'オンラインストア' } },
        /* 8.89 海外向けの商品リスト（外せたかを確かめるので、あるものとする）。 */
        { id:'gid://shopify/Publication/3', supportsFuturePublishing:false,
          catalog:{ title:'Overseas products' } }] } } });
    if(name==='pjSet'){
      const h=b.variables.input.handle;
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
  if(/\/api\/webhooks\//.test(url))return new Response(null,{status:204});
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
const MO='1111111111', LI='2222222222', ST='3333333333', PR='4444444444';
const NOW=new Date().toISOString();
const env0=(extra)=>makeEnv(Object.assign({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz' },extra||{}));
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subOnMonitor:false, gdIdxOn:false,
      subMonNote:false, subChMonitor:MO,
      subOnLight:true, subChLight:LI,
      subOnStandard:true, subChStandard:ST,
      subOnPremium:true, subChPremium:PR,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const jan=(i)=>'490237055'+String(1000+i);
/* 会員用の印が付いた品（もう Shopify に読み込んである）。 */
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
    .bind(j,'テストのゲームソフト その'+i,NOW,x.rank||(100+i*10)).run();
  await env.DB.prepare(
    `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,
       at,created_at) VALUES (?1,1,10,3645,?2,?3,?3,?3,?3)`)
    .bind(j,x.grades===undefined?'light,standard,premium':x.grades,NOW).run();
  return j;
};
const api=async(env,path,body,key)=>{
  const r=body?post(path,body):get(path);
  if(key)r.headers.set('X-PJ-Key',key);
  return (await asJson(await worker.fetch(r,env,{}))).body;
};
const planOf=(r,k)=>(r.plans||[]).filter((x)=>x.key===k)[0]||{};
/* カードに出ている「お一人◯点まで」。 */
const qOf=(b)=>Number((/お一人 (\d+)点まで/.exec(JSON.stringify(b||{}))||[])[1]||0);
const cards=(ch,method)=>dc.filter((x)=>x.ch===ch
  &&(!method||x.method===method));
const qs=(ch,method)=>cards(ch,method).map((x)=>qOf(x.body));
const all=(a,v)=>a.length>0&&a.every((x)=>x===v);
const rowsOf=async(env,sql)=>((await env.DB.prepare(sql).all()).results||[]);

console.log('=== ⑨ migrate-0069 がまだの D1（列が無い）===');
{
  /* 列があると分かったあとは覚えたままになるので、この確認を先にする。 */
  const env=env0();
  await env.DB.prepare(`ALTER TABLE sub_post DROP COLUMN max_q`).run();
  await setCfg(env,{});
  for(let i=0;i<3;i++)await add(env,i,{ grades:'light' });
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true, plan:'light' });
  console.log('   ライト '+JSON.stringify({ add:planOf(r,'light').add,
    q:qs(LI,'POST') }));
  ok(r.ok!==false&&planOf(r,'light').add===3,'★★★列が無くても配信できる（落ちない）');
  ok(all(qs(LI,'POST'),2),
     '★★★控えの列が無いあいだは、新しいカードも前の数（2点）のまま');
  await env.DB.prepare(`UPDATE mw_sub SET price=4000`).run();
  dc=[];
  await api(env,'/sub/send',{ approve:true, plan:'light' });
  ok(cards(LI,'PATCH').length===3&&all(qs(LI,'PATCH'),2),
     '★★★書き換えても数字は動かない（行ったり来たりしない）');
  const p=await api(env,'/sub/plan');
  ok(p.q_over&&p.q_over.col===false,'★★列が無いことを画面に返す');
  ok(p.q_over.total===3,'★上限より多いカードとして数える（3件）');
  /* あとから列を足しても、数字は合っている（控えが空＝前の数）。 */
  await env.DB.prepare(`ALTER TABLE sub_post ADD COLUMN max_q INTEGER`).run();
  await env.DB.prepare(`UPDATE mw_sub SET price=4100`).run();
  dc=[];
  await api(env,'/sub/send',{ approve:true, plan:'light' });
  ok(cards(LI,'PATCH').length===3&&all(qs(LI,'PATCH'),2),
     '★★★列を足したあとも、出ているカードは前の数のまま');
  const p2=await api(env,'/sub/plan');
  ok(p2.q_over.col===true&&p2.q_over.total===3,'★列があると返り、件数も同じ');
}

console.log('\n=== ① 数字の元は1か所・⚙で変えられる ===');
{
  const l=SUBPLAN.list({});
  const pl=(k,a)=>(a||l).filter((p)=>p.key===k)[0];
  console.log('   '+l.map((p)=>p.name+' '+p.n+'件・'+p.q+'点').join('／'));
  ok(pl('monitor').n===5&&pl('monitor').q===1,'★★★モニター 5件・1点（今のまま）');
  ok(pl('light').n===5&&pl('light').q===1,'★★★ライト 5件・1点');
  ok(pl('standard').n===20&&pl('standard').q===2,'★★★スタンダード 20件・2点');
  ok(pl('premium').n===50&&pl('premium').q===5,'★★★プレミアム 50件・5点');
  const by={}; SUBPLAN.PLANS.forEach((p)=>{ by[p.key]=p; });
  ok(by.light.n===5&&by.light.q===1&&by.standard.n===20&&by.standard.q===2
     &&by.premium.n===50&&by.premium.q===5,'★★表（PLANS）と同じ数');
  const m=SUBPLAN.list({ subLimNLight:7, subLimQLight:3, subLimNStandard:30,
                         subLimQPremium:4, subMonNew:3, subQMonitor:2 });
  ok(pl('light',m).n===7&&pl('light',m).q===3&&pl('standard',m).n===30
     &&pl('standard',m).q===2&&pl('premium',m).q===4,
     '★★★⚙（subLimN*・subLimQ*）で変えられる（入れていない所は表のまま）');
  ok(pl('monitor',m).n===3&&pl('monitor',m).q===2,
     '★★モニターは今までの欄（subMonNew・subQMonitor）のまま');
  const old=SUBPLAN.list({ subNLight:20, subQLight:2, subNStandard:50,
                           subQStandard:5, subNPremium:100, subQPremium:5 });
  ok(pl('light',old).n===5&&pl('light',old).q===1&&pl('standard',old).n===20
     &&pl('standard',old).q===2&&pl('premium',old).n===50,
     '★★★前の欄に残っている数（20件・2点など）は上限に使わない');
  ok(SUBPLAN.limIds('light').n==='subLimNLight'
     &&SUBPLAN.limIds('premium').q==='subLimQPremium'
     &&SUBPLAN.limIds('monitor').n==='subMonNew'
     &&SUBPLAN.limIds('monitor').q==='subQMonitor','★欄の名前も1か所');
  /* 出ているカードの数の決まり。 */
  ok(SUBPLAN.legacyQ({},'light')===2&&SUBPLAN.legacyQ({},'standard')===5
     &&SUBPLAN.legacyQ({},'premium')===5&&SUBPLAN.legacyQ({},'monitor')===1,
     '★★前のカードに書いてある数（前の既定）');
  ok(SUBPLAN.legacyQ({ subQLight:3 },'light')===3,
     '★前の欄に数が残っていれば、それが前のカードの数');
  ok(SUBPLAN.keepQ(1,2,false)===2&&SUBPLAN.keepQ(1,2,true)===1,
     '★★★上限を下げても、決めるまでは前の数（オンなら新しい上限）');
  ok(SUBPLAN.keepQ(5,2,false)===5&&SUBPLAN.keepQ(2,0,false)===2,
     '★★上限を上げたときと、新しいカードはいまの上限');
}

console.log('\n=== ② 届く商品の種類は変えない ===');
{
  const by={}; SUBPLAN.PLANS.forEach((p)=>{ by[p.key]=p; });
  ok(by.monitor.kinds==='game'&&by.monitor.normal===true,
     '★★★モニターはゲームソフト通常版');
  ok(by.light.kinds==='game','★★★ライトはゲームソフト');
  ok(by.standard.kinds==='all','★★★スタンダードはゲームソフト＋フィギュア・グッズ');
  ok(by.premium.kinds==='one','★★★プレミアムはすべて＋1点ものの先行');
  const game={ is_game:true }, fig={ is_game:false }, one={ one_off:true };
  const f=(k,r)=>!!SUBPLAN.fits(by[k],r,r.is_game);
  ok(f('light',game)&&!f('light',fig)&&!f('light',one),'★ライトに入る種類');
  ok(f('standard',game)&&f('standard',fig)&&!f('standard',one),
     '★スタンダードに入る種類');
  ok(f('premium',game)&&f('premium',fig)&&f('premium',one),
     '★プレミアムに入る種類');
}

console.log('\n=== ③ 上限を超えるときは、今の並びのまま上から ===');
{
  const row=(i,o)=>Object.assign({ jan:jan(i), name:'商品'+i, fit:true,
    rst:'ok', amz:0, buy_qty:0, price:2000, qty:2, gross:300+i*7, speed:1+i%4,
    stock:9, is_game:true, grades:'', no_back:false, one_off:false },o);
  const rows=[]; for(let i=0;i<60;i++)rows.push(row(i,{ is_game:i%3!==0 }));
  const on={ subOnLight:1, subOnStandard:1, subOnPremium:1 };
  const lim=SUBPLAN.draft(rows,SUBPLAN.list(on),{});
  /* 並びを見るために、上限だけ大きくした案と比べる。 */
  const wide=SUBPLAN.draft(rows,SUBPLAN.list(Object.assign({ subLimNLight:200,
    subLimNStandard:200, subLimNPremium:200 },on)),{});
  const J2=(d,k)=>(d.plans.filter((p)=>p.key===k)[0].items||[])
    .map((x)=>x.jan);
  const n={ light:J2(lim,'light').length, standard:J2(lim,'standard').length,
            premium:J2(lim,'premium').length };
  console.log('   上限つき '+JSON.stringify(n)+'　上限なし '
    +JSON.stringify({ light:J2(wide,'light').length,
      standard:J2(wide,'standard').length, premium:J2(wide,'premium').length }));
  ok(n.light===5&&n.standard===20&&n.premium===50,
     '★★★1回のリストは上限まで（5件／20件／50件）');
  ['light','standard','premium'].forEach((k)=>{
    ok(JSON.stringify(J2(lim,k))
       ===JSON.stringify(J2(wide,k).slice(0,n[k])),
       '★★★'+k+'：並びは今のまま、上から上限まで');
  });
  const over=lim.plans.filter((p)=>p.key==='light')[0].over;
  ok(over===J2(wide,'light').length-5,'★あと何件あるかも返す');
}

console.log('\n=== ④ 新しく出すカードは新しい上限 ===');
{
  const env=env0();
  await setCfg(env,{});
  for(let i=0;i<8;i++)await add(env,i);
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true });
  console.log('   '+['light','standard','premium'].map((k)=>k+' 新しく '
    +planOf(r,k).add).join('／')+'　お一人 '
    +JSON.stringify({ light:qs(LI,'POST')[0], standard:qs(ST,'POST')[0],
                      premium:qs(PR,'POST')[0] }));
  ok(planOf(r,'light').add===5,'★★★ライトは1回に5件まで');
  ok(planOf(r,'standard').add===8&&planOf(r,'premium').add===8,
     '★★スタンダード・プレミアムは上限（20件・50件）に届かないので全部');
  ok(all(qs(LI,'POST'),1),'★★★ライトのカードは「お一人 1点まで」');
  ok(all(qs(ST,'POST'),2),'★★★スタンダードのカードは「お一人 2点まで」');
  ok(all(qs(PR,'POST'),5),'★★★プレミアムのカードは「お一人 5点まで」');
  ok(/お一人 1点まで／残り 10点/.test(JSON.stringify(cards(LI,'POST')[0].body)),
     '★残り数は今までどおり出る');
  const m=await rowsOf(env,`SELECT ch, max_q FROM sub_post`);
  const by={}; m.forEach((x)=>{ (by[x.ch]=by[x.ch]||[]).push(Number(x.max_q)); });
  ok(all(by[LI],1)&&all(by[ST],2)&&all(by[PR],5),
     '★★★カードに書いた数を控える（sub_post.max_q）');
  const p=await api(env,'/sub/plan');
  ok(p.q_over&&p.q_over.total===0,'★★上限より多いカードは 0件');
  ok(planOf(p,'light').n===5&&planOf(p,'light').q===1
     &&planOf(p,'standard').n===20&&planOf(p,'premium').n===50,
     '★★予定にもプランの上限が出る');
}

console.log('\n=== ⑤ 出ているカードは、決めるまで前の数のまま ===');
let envOld=null;
{
  /* 前の上限（ライト 2点・スタンダード 5点・プレミアム 5点）で出しておく。 */
  const env=env0(); envOld=env;
  await setCfg(env,{ subLimQLight:2, subLimQStandard:5, subLimQPremium:5 });
  for(let i=0;i<4;i++)await add(env,i);
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  ok(all(qs(LI,'POST'),2)&&all(qs(ST,'POST'),5),'★用意：前の数のカードが出ている');
  /* 8.82 より前に出したカードは控えが空。 */
  await env.DB.prepare(`UPDATE sub_post SET max_q=NULL`).run();
  await setCfg(env,{});                     // 新しい上限（既定）にする
  const p=await api(env,'/sub/plan');
  const o=p.q_over||{};
  const ov=(k)=>(o.plans||[]).filter((x)=>x.key===k)[0]||{};
  console.log('   上限より多いカード '+o.total+'件 '
    +JSON.stringify((o.plans||[]).map((x)=>x.key+':'+x.n+'/'+x.cards)));
  ok(o.total===8,'★★★上限より多いカードを数える（ライト4＋スタンダード4＝8件）');
  ok(ov('light').n===4&&ov('light').now===1&&ov('light').by['2']===4,
     '★★★ライト：いまの上限 1点・カードは 2点までが4件');
  ok(ov('standard').n===4&&ov('standard').now===2&&ov('standard').by['5']===4,
     '★★★スタンダード：いまの上限 2点・カードは 5点までが4件');
  ok(ov('premium').n===0&&ov('premium').cards===4,
     '★★プレミアムは変わらない（5点のまま）ので 0件');
  ok(o.fix===false,'★いまは書き換えない設定だと返す');
  ok(planOf(p,'light').edit===0&&planOf(p,'standard').edit===0,
     '★★★数えるだけで、予定に書き換えは出ない');
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true });
  ok(dc.length===0&&r.edited===0,'★★★配信しても、出ているカードは書き換えない');
  /* 値段が変わって書き換えるときも、数は前のまま。 */
  await env.DB.prepare(`UPDATE mw_sub SET price=4000`).run();
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  console.log('   値段の書き換え '+JSON.stringify({ light:qs(LI,'PATCH'),
    standard:qs(ST,'PATCH') }));
  ok(cards(LI,'PATCH').length===4&&all(qs(LI,'PATCH'),2),
     '★★★値段を書き換えても、ライトのカードは「お一人 2点まで」のまま');
  ok(cards(ST,'PATCH').length===4&&all(qs(ST,'PATCH'),5),
     '★★★スタンダードのカードも「お一人 5点まで」のまま');
  const m=await rowsOf(env,`SELECT max_q FROM sub_post WHERE ch='${LI}'`);
  ok(all(m.map((x)=>Number(x.max_q)),2),'★書き換えたカードの数を控える（2点）');
  /* 新しく印を付けた品は新しい上限で出る。 */
  await add(env,7);
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  ok(all(qs(LI,'POST'),1)&&cards(LI,'POST').length===1
     &&all(qs(ST,'POST'),2),
     '★★★同じチャンネルでも、新しく出すカードは新しい上限');
  const p2=await api(env,'/sub/plan');
  ok(p2.q_over.total===8,'★★件数は変わらない（前のカード 8件）');
}

console.log('\n=== ⑦ 注文を取り込んだときも、数は前のまま ===');
{
  const env=envOld;
  dc=[];
  const out=await W.subEditLeft(env,{ notes:[], errors:0 },[jan(0)]);
  console.log('   '+JSON.stringify({ edited:out.edited,
    light:qs(LI,'PATCH'), standard:qs(ST,'PATCH'), premium:qs(PR,'PATCH') }));
  ok(out.edited===3,'★その商品のカード（3つのチャンネル）を書き換える');
  ok(all(qs(LI,'PATCH'),2)&&all(qs(ST,'PATCH'),5)&&all(qs(PR,'PATCH'),5),
     '★★★残り数の書き換えでも「お一人◯点まで」は前の数のまま');
  /* 取り込みのあとの配信の回（今までどおり、同じカードを出し直すことが
     ある）でも、数は前のまま。次の⑥の前に落ち着かせておく。 */
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  ok(dc.every((x)=>x.method==='PATCH')
     &&qs(LI).every((q)=>q===2)&&qs(ST).every((q)=>q===5),
     '★★そのあとの配信の回でも、前の数のまま');
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  ok(dc.length===0,'★もう一度配信しても書き換えない（落ち着いている）');
}

console.log('\n=== ⑥ ⚙をオンにすると、新しい上限に書き換える ===');
{
  const env=envOld;
  await setCfg(env,{ subQFix:true });
  const p=await api(env,'/sub/plan');
  ok(p.q_over.fix===true&&p.q_over.total===8,'★オンだと返る（件数はまだ 8件）');
  ok(planOf(p,'light').edit===4&&planOf(p,'standard').edit===4
     &&planOf(p,'premium').edit===0,
     '★★★予定に、書き換えるカードが出る（ライト4・スタンダード4）');
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  console.log('   書き換え '+JSON.stringify({ light:qs(LI,'PATCH'),
    standard:qs(ST,'PATCH'), premium:cards(PR,'PATCH').length }));
  ok(cards(LI,'PATCH').length===4&&all(qs(LI,'PATCH'),1),
     '★★★ライトのカードを「お一人 1点まで」に書き換える');
  ok(cards(ST,'PATCH').length===4&&all(qs(ST,'PATCH'),2),
     '★★★スタンダードのカードを「お一人 2点まで」に書き換える');
  ok(cards(PR,'PATCH').length===0,'★★変わらないプレミアムは触らない');
  ok(dc.every((x)=>x.method==='PATCH'),
     '★★★書き換えだけ（新しい投稿も削除もしない・通知は鳴らない）');
  const p2=await api(env,'/sub/plan');
  ok(p2.q_over.total===0,'★★★書き換えたあとは 0件');
  /* オフに戻しても、もう新しい数のまま。 */
  await setCfg(env,{});
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  ok(dc.length===0,'★★オフに戻しても、数字は戻らない（書き換えない）');
}

console.log('\n=== ⑧ 自動配信も同じ上限・同じ数え上げ ===');
{
  W.shopReset();
  const env=env0({ SHOPIFY_CLIENT_ID:'cid-123',
                   SHOPIFY_CLIENT_SECRET:'csec-SECRET-456' });
  await setCfg(env,{ subAutoOn:true, subAutoMax:200 });
  /* 候補（まだ印の付いていない品）。限定版はライトから上。 */
  for(let i=0;i<9;i++){
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
  const d=await api(env,'/sub/auto/try',{});
  const lim={}; (d.limits||[]).forEach((x)=>{ lim[x.key]=x.n+'/'+x.q; });
  console.log('   試し '+JSON.stringify(lim)+'　'
    +(d.plans||[]).map((p)=>p.key+' 新しく '+p.add).join('／'));
  ok(lim.light==='5/1'&&lim.standard==='20/2'&&lim.premium==='50/5',
     '★★★自動配信が使う上限も同じ（5件・1点／20件・2点／50件・5点）');
  ok(planOf(d,'light').add===5,'★★★ライトは1回に5件まで（9件あっても）');
  ok(planOf(d,'standard').add===9&&planOf(d,'premium').add===9,
     '★★スタンダード・プレミアムは上限に届かないので全部');
  ok(d.q_over&&d.q_over.total===0,'★上限より多いカードの件数も返す');
  dc=[];
  const r=await W.jobSubAuto(env,{ force:true });
  console.log('   本番 '+(r.plans||[]).map((p)=>p.key+' 新しく '+p.add).join('／'));
  ok(planOf(r,'light').add===5&&all(qs(LI,'POST'),1),
     '★★★本番もライトは5件・カードは「お一人 1点まで」');
  ok(all(qs(ST,'POST'),2)&&all(qs(PR,'POST'),5),
     '★★スタンダード 2点・プレミアム 5点');
  /* 並び：試しで見せた品と同じ品が、同じ順で出る。 */
  const want=(planOf(d,'light').items||[]).map((x)=>x.jan);
  const got=cards(LI,'POST').map((x)=>
    (/sub-(\d{13})/.exec(JSON.stringify(x.body))||[])[1]);
  ok(JSON.stringify(want)===JSON.stringify(got),
     '★★試しで見せた順のまま、上から上限まで出す');
}

console.log('\n=== ⑩ 会員向けのカードに仕入れ元を出さない ===');
{
  const env=env0();
  await setCfg(env,{});
  for(let i=0;i<3;i++)await add(env,i);
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  const txt=JSON.stringify(dc.map((x)=>x.body));
  ok(dc.length>0&&!/いろは商会/.test(txt),'★★★社の名前を出さない');
  ok(!/2100|2,100/.test(txt),'★★★卸値を出さない');
  /* 「仕入れ価格」は会員が払う値段の見出し（会員の仕入れ値）なので除く。 */
  ok(!/卸|仕入原価|仕入れ元|MW|mwsrc|在庫 ?20/.test(txt),
     '★★★卸・仕入れ元・MW・MWの在庫の語を出さない');
  ok(!/@everyone|@here/.test(txt),'★@everyone／@here を使わない');
  /* 上限の数え上げ（q_over）にも商品の中身は入れない。 */
  const p=await api(env,'/sub/plan');
  ok(!/いろは商会|jan/.test(JSON.stringify(p.q_over)),
     '★★数え上げは件数だけ（商品や仕入れ元は入れない）');
}

console.log('\n=== 作業者のキーでは見られない・共有の表を2か所に持たない ===');
{
  const env=env0({ WORKER_KEY:'worker-key-999' });
  const r=await asJson(await worker.fetch((()=>{ const q=get('/sub/plan');
    q.headers.set('X-PJ-Key','worker-key-999'); return q; })(),env,{}));
  ok(r.status===403||r.status===401||(r.body&&r.body.ok===false),
     '★★作業者のキーでは予定（件数の数え上げ）を見られない');
  const w=fs.readFileSync(new URL('../proxy-sync/worker.js',import.meta.url),'utf8');
  const h=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  ok(!/subLimN(Light|Standard|Premium)/.test(w),
     '★★★pj-sync は欄の名前を自分で持たない（shared/subplan.js の limIds）');
  ok(/SUBPLAN\.keepQ\(/.test(w)&&!/function keepQ/.test(w)&&!/function keepQ/.test(h),
     '★★★「前の数のまま」の決まりは shared/subplan.js の1か所');
  ok(/SUBPLAN\.limIds\(/.test(h),'★画面も欄の名前を limIds から読む');
  const cfg=JSON.parse(fs.readFileSync(
    new URL('../discord/server.config.json',import.meta.url),'utf8'));
  const by={}; SUBPLAN.PLANS.forEach((p)=>{ by[p.key]=p; });
  ok(cfg.plans.every((p)=>by[p.role]&&by[p.role].n===p.per_post
     &&by[p.role].q===p.max_qty),
     '★★★Discord の設計の表（server.config.json）も同じ数');
  ok(cfg.plans.every((p)=>!/[0-9]{3,}/.test(String(p.price||''))),
     '★★★月額の金額は pj に持たせない');
  const mg=fs.readFileSync(
    new URL('../proxy-sync/migrate-0069-sub-maxq.sql',import.meta.url),'utf8');
  ok(/ALTER TABLE sub_post ADD COLUMN max_q INTEGER/.test(mg)
     &&!/UPDATE|DELETE|DROP/.test(mg.replace(/--.*$/gm,'')),
     '★★migrate-0069 は列を足すだけ（今ある行は変えない）');
}
T.done();
