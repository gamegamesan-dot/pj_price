/* 決まり・Worker：Discord の配信の3点の直し（8.86）

   カジの依頼（2026-11-21）
   1. ピン留めの「今週の一覧」：1行を「◎ 商品名／仕入れ ¥…／粗利 ¥…／残り…／カード」
      にする（金額にラベル・長いときは商品名を切る・「…」を2つ続けない・
      1通の上限を超えたら分ける＝途中で切らない）
   2. カードに毎回入っている「Amazon FBA で売った場合〜」を固定の説明へ
      （数字は残す・#はじめに の「カードの読み方」に1回・各リストのピン留めに
       短い説明とリンク）。出ているカードは、書き換える前に枚数を数える
   3. チャンネルの説明文（トピック）を shared/subplan.js の上限から作る
      （上限を変えたら自動で変わる）
   守ること：@everyone／@here を使わない・仕入れ先が分かる情報を出さない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const I=require('../shared/subindex.js');
const G=require('../shared/subguide.js');
const C=require('../shared/subcard.js');
const SUBPLAN=require('../shared/subplan.js');
const T=harness('決まり・Worker：Discord の配信の3点の直し（8.86）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('subtidy');
const read=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');

/* ---- 作り物の Discord（チャンネルの説明文も持つ）---- */
let dc=[], chCalls=[], topics={}, chFail={};
const J=(v,st)=>new Response(JSON.stringify(v),{status:st||200,
  headers:{'content-type':'application/json'}});
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/\/api\/webhooks\//.test(url))return new Response(null,{status:204});
  if(/discord\.com\/api/.test(url)){
    if(/\/pins\//.test(url))return new Response(null,{status:204});
    const cc=/\/channels\/(\d+)$/.exec(url);
    if(cc){
      const m=String(o.method||'GET');
      chCalls.push({ method:m, ch:cc[1], body:o.body?JSON.parse(String(o.body)):null });
      if(m==='PATCH'){
        if(chFail[cc[1]])return J({ code:50013, message:'Missing Permissions' },403);
        topics[cc[1]]=JSON.parse(String(o.body)).topic;
      }
      return J({ id:cc[1], name:'ch-'+cc[1], guild_id:'555000555',
                 topic:topics[cc[1]]||'' });
    }
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    const b=o.body?JSON.parse(String(o.body)):null;
    dc.push({ method:String(o.method||'GET'), ch:m[1]||'', msg:m[2]||'', body:b });
    return J({ id:String(900000+dc.length) });
  }
  return J({});
};
const reset=()=>{ dc=[]; chCalls=[]; };
const MO='1111111111', LI='2222222222', ST='3333333333', PR='4444444444';
const HOME='9999999999';
const NOW=new Date().toISOString();
const env0=(extra)=>makeEnv(Object.assign({ STAFF_KEY:'staff-key-123',
  WORKER_KEY:'worker-key-999', DISCORD_BOT_TOKEN:'bot-token-xyz' },extra||{}));
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subOnMonitor:false, subMonNote:false,
      subChMonitor:MO, subOnLight:true, subChLight:LI,
      subOnStandard:true, subChStandard:ST, subOnPremium:false, subChPremium:PR,
      gdPinCh:HOME, gdIdxWeek:false,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const jan=(i)=>'490237055'+String(3000+i);
const add=async(env,i,o)=>{
  const x=o||{}, j=jan(i);
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,wholesale,stock,row_hash,
       seen_at,created_at) VALUES (?1,'いろは商会',0,'NS',?2,2100,20,'h',?3,?3)`)
    .bind(j,x.name||('ゲーム'+i),NOW).run();
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,rank,rank_cat,
       checked_at,basis,price_at)
     VALUES (?1,'B0D1GSZJ8T',?2,9000,1200,'s',?4,'ゲーム',?3,'カート',?3)`)
    .bind(j,x.name||('テストのゲームソフト その'+i),NOW,100+i*10).run();
  await env.DB.prepare(
    `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,
       at,created_at) VALUES (?1,1,10,3645,?2,?3,?3,?3,?3)`)
    .bind(j,x.grades===undefined?'light,standard,premium':x.grades,NOW).run();
  return j;
};
const api=async(env,path,body,key)=>{
  const r=body?post(path,body):get(path);
  if(key)r.headers.set('X-PJ-Key',key);
  return await asJson(await worker.fetch(r,env,{}));
};
const planOf=(r,k)=>(r.plans||[]).filter((x)=>x.key===k)[0]||{};
const FBA='Amazon FBA で売った場合';
const grossOf=(b)=>(((b||{}).embeds||[])[0]||b||{}).fields
  ? ((((b||{}).embeds||[])[0]||b).fields.filter((f)=>/粗利/.test(f.name))[0]||{}).value||''
  : '';
const NG=/いろは商会|卸値|卸|MW|matchingworld|mwsrc|仕入れ先|仕入原価|2,?100/;

console.log('=== 1. 今週の一覧の1行 ===');
const LONG='スーパーマリオパーティ ジャンボリー Nintendo Switch 2 Edition ＋ ジャンボリーTV 限定版 特典つき';
const R=(o)=>Object.assign({ jan:'4902370550467', name:'ゲームA', kishu:'NS',
  price:5210, gross:2186, left:3, msg_id:'1234567890123456789', mark:'◎' },o||{});
const OPT={ guild:'555000555000555000', gdPinCh:HOME };
const CH='222222222222222222';
{
  const t=I.lineOf(R(),OPT,CH);
  console.log('   '+t);
  ok(/^◎ \*\*ゲームA\*\*／仕入れ ¥5,210／粗利 ¥2,186／残り3／\[カード\]\(https:\/\/discord\.com\/channels\/555000555000555000\/222222222222222222\/1234567890123456789\)$/.test(t),
     '★★★1行の形：◎ 商品名／仕入れ ¥…／粗利 ¥…／残り…／カード');
  ok(/仕入れ ¥5,210/.test(t)&&/粗利 ¥2,186/.test(t)&&!/[^れ利] ¥/.test(t.replace(/仕入れ ¥|粗利 ¥/g,'')),
     '★★★金額には必ずラベルが付く（仕入れ・粗利）');
  ok(t.indexOf('…')<0,'★★★名前を切らない行に「…」は出ない');
  const l=I.lineOf(R({ name:LONG }),OPT,CH);
  console.log('   '+l);
  ok((l.match(/…/g)||[]).length===1&&/…\*\*／仕入れ/.test(l),
     '★★★「…」は商品名の終わりに1つだけ（「… …」にならない）');
  ok(/／仕入れ ¥5,210／粗利 ¥2,186／残り3／\[カード\]\(https:[^)]+\)$/.test(l),
     '★★★長いときも、金額・残り・カードのリンクは切らない');
  const l2=I.lineOf(R({ name:LONG+'…' }),OPT,CH);
  const l3=I.lineOf(R({ name:'テスト…… …　続き...' }),OPT,CH);
  ok((l2.match(/…/g)||[]).length===1&&!/……|… …|…\.\.\./.test(l3),
     '★★★元の名前に「…」が入っていても、続けて2つにならない：'+l3.slice(0,24));
  /* 商品名の字数を⚙で大きくしても、1行の上限では名前のほうを切る。 */
  const wide=I.lineOf(R({ name:LONG.repeat(3) }),Object.assign({ gdIdxName:60 },OPT),CH);
  ok(wide.length<=I.LINE_MAX&&/／仕入れ ¥5,210／粗利 ¥2,186／残り3／\[カード\]\([^)]+\)$/.test(wide),
     '★★★1行が長すぎるときは商品名を切る（1行 '+wide.length+'字／上限 '+I.LINE_MAX+'字）');
  const q=I.lineOf(R(),Object.assign({ gdIdxYen:false },OPT),CH);
  ok(!/¥|仕入れ|粗利/.test(q)&&/^◎ \*\*ゲームA\*\*／残り3／\[カード\]/.test(q),
     '★⚙で値段と粗利を外した形も崩れない');
  const z=I.lineOf(R({ gross:0 }),OPT,CH);
  ok(/／仕入れ ¥5,210／残り3／/.test(z)&&!/粗利/.test(z),'★粗利が出せない行は、粗利ごと出さない');
  ok(!NG.test(t+l)&&!/@everyone|@here/.test(t+l),'★★仕入れ先が分かる情報・@everyone は出ない');
}
{
  /* 1通の上限を超えたら分ける（行の途中で切らない）。 */
  const rows=[]; for(let i=0;i<400;i++)rows.push(R({ jan:'49023705'+String(50000+i),
    name:LONG+i, msg_id:String(1234567890123456000+i), gross:1000+i }));
  const pg=I.pagesOf(rows,OPT,CH);
  let lines=0, bad=0, big=0;
  pg.forEach((p)=>{
    let sum=0;
    if(p.embeds.length>10)big++;
    p.embeds.forEach((e)=>{
      if(e.description.length>4096)big++;
      sum+=e.description.length+e.title.length;
      e.description.split('\n').forEach((ln)=>{ lines++;
        if(!/^◎ \*\*.+\*\*／仕入れ ¥[\d,]+／粗利 ¥[\d,]+／残り3／\[カード\]\(https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+\)$/.test(ln))bad++; });
    });
    if(sum>6000)big++;
  });
  console.log('   400件 → '+pg.length+'通・行 '+lines+'・途中で切れた行 '+bad);
  ok(pg.length>1&&big===0,'★★★Discord の上限（1通 6,000字・10 embed・embed 4,096字）を超えない');
  ok(lines===400&&bad===0,'★★★上限を超えるぶんは通を分ける（400行ぜんぶ・途中で切れた行なし）');
  ok(/カードの読み方は <#9999999999>/.test(pg[0].note)&&/Amazon FBA で売った場合/.test(pg[0].note)
     &&pg.slice(1).every((p)=>!p.note),
     '★★★1ページめ（ピン留めする通）にだけ、短い説明と #はじめに へのリンク');
  const wk=I.weekText(rows.map((r)=>Object.assign({ is_new:true },r)),OPT,CH,'777',40);
  const wl=wk.split('\n');
  ok(wk.length<=2000&&wl.slice(1,-2).every((ln)=>/^・◎ .+\[カード\]\([^)]+\)$/.test(ln))
     &&/^・ほか \d+件$/.test(wl[wl.length-2])&&/^ぜんぶの一覧 → https:/.test(wl[wl.length-1]),
     '★★★「今週の新着」も行の途中で切らない（入らない分は「ほか ◯件」・一覧へのリンクは残す）');
}

console.log('\n=== 2. カードの共通の説明 ===');
const ITEM={ jan:'4902370550467', name:'テストのゲーム', kishu:'NS', price:5210,
  gross:2186, amz_price:9000, amz_basis:'カート', qty:3, size_tier:'s', size_g:100 };
{
  const c1=C.card(ITEM,{ maxQty:1, domain:'omakase-ship.myshopify.com' });
  const c2=C.card(ITEM,{ maxQty:1, domain:'omakase-ship.myshopify.com', slim:true });
  const g1=c1.fields.filter((f)=>/粗利/.test(f.name))[0].value;
  const g2=c2.fields.filter((f)=>/粗利/.test(f.name))[0].value;
  console.log('   いま：'+g1.replace(/\n/g,'⏎'));
  console.log('   外す：'+g2);
  ok(g1==='¥2,186（利益率 42%）\n（**Amazon FBA で売った場合**・Amazon の手数料を引いたあと・送料と倉庫までの送料は別）',
     '★★★⚙がオフのあいだは、カードは今までと1文字も変わらない（書き換えが起きない）');
  ok(g2==='¥2,186（利益率 42%）','★★★外すと説明文だけ無くなり、数字（粗利・利益率）は残る');
  ok(JSON.stringify(c1).length-JSON.stringify(c2).length>40
     &&c1.fields.length===c2.fields.length,'★★ほかの項目は変わらない（カードが短くなる）');
  ok(G.grossNote()==='\n（'+G.GROSS_JA+'）'&&g1.endsWith(G.grossNote()),
     '★★説明の文は shared/subguide.js の1か所');
  const L=SUBPLAN.list({});
  const pin=G.pinCommon({ gdPinCh:HOME },L);
  const at=pin.indexOf('**カードの読み方**');
  ok(at>0&&(pin.match(/Amazon FBA で売った場合/g)||[]).length===1
     &&/見込みの Amazon 粗利\*\* … \*\*Amazon FBA で売った場合\*\*の見込みです（Amazon の手数料を引いたあと・送料と倉庫までの送料は別）/.test(pin),
     '★★★#はじめに の「カードの読み方」に、同じ説明を1回だけ載せる');
  ok(/仕入れ価格（税込・送料別）\*\* … 当店からお買い求めいただく値段/.test(pin)
     &&/利益率\*\*は 粗利 ÷ 仕入れ価格/.test(pin),'★★仕入れ価格と利益率の意味も書く');
  ok(G.pinSplit(pin).every((x)=>x.length<=2000),'★#はじめに の文は1通 2,000字に入るように分かれる');
  ['monitor','light','standard','premium'].forEach((k)=>{
    const p=G.pinPlan(k,{ gdPinCh:HOME },L.filter((x)=>x.key===k)[0]);
    ok(/粗利\*\*は \*\*Amazon FBA で売った場合\*\*の見込みです。/.test(p)
       &&(p.match(/<#9999999999>/g)||[]).length===1,
       '★★★'+k+' の短い文：短い説明と #はじめに へのリンクが1つ');
  });
  ok(!NG.test(pin)&&!/@everyone|@here/.test(pin+G.idxNote({})),
     '★★★説明の文に、仕入れ先が分かる情報・@everyone は無い');
}

console.log('\n=== 3. チャンネルの説明文（トピック）の文 ===');
{
  const L=SUBPLAN.list({}), by={}; L.forEach((p)=>{ by[p.key]=p; });
  const t={ light:G.topicOf([by.light]), standard:G.topicOf([by.standard]),
            premium:G.topicOf([by.premium]), monitor:G.topicOf([by.monitor]) };
  Object.keys(t).forEach((k)=>console.log('   '+t[k]));
  ok(/^ライトの商品リスト。お一人1点まで／1回5件まで。/.test(t.light),'★★★ライト：お一人1点まで／1回5件まで');
  ok(/^スタンダードの商品リスト。お一人2点まで／1回20件まで。/.test(t.standard),
     '★★★スタンダード：お一人2点まで／1回20件まで');
  ok(/^プレミアムの商品リスト。お一人5点まで／1回50件まで。/.test(t.premium)
     &&!/100件/.test(t.premium),'★★★プレミアム：お一人5点まで／1回50件まで（100件ではない）');
  ok(/^モニターの商品リスト。お一人1点まで／毎週 新しく5件。/.test(t.monitor),
     '★★★モニター：お一人1点まで／毎週 新しく5件（モニターは週ごと）');
  const L2=SUBPLAN.list({ subLimNPremium:30, subLimQPremium:3, subMonNew:4 });
  const b2={}; L2.forEach((p)=>{ b2[p.key]=p; });
  ok(/お一人3点まで／1回30件まで/.test(G.topicOf([b2.premium]))
     &&/毎週 新しく4件/.test(G.topicOf([b2.monitor])),
     '★★★上限を変えると、説明文の数字も変わる（数字の元は shared/subplan.js）');
  const sh=G.topicOf([by.standard,by.monitor]);
  ok(/^スタンダード・モニターの商品リスト。スタンダード：お一人2点まで／1回20件まで　モニター：お一人1点まで／毎週 新しく5件。/.test(sh),
     '★★同じチャンネルを2つのプランで使うときは、両方を書く');
  ok(Object.keys(t).every((k)=>t[k].length<=1024&&t[k].endsWith(G.TOPIC_TAIL))
     &&!NG.test(Object.values(t).join('')),'★説明文は Discord の上限（1,024字）に入り、仕入れ先の情報は無い');
  const cfg=JSON.parse(read('discord/server.config.json'));
  const chs=[]; cfg.categories.forEach((c)=>c.channels.forEach((x)=>chs.push(x)));
  const tp=(k)=>(chs.filter((x)=>x.key===k)[0]||{}).topic;
  ok(tp('list-light')===t.light&&tp('list-premium')===t.premium&&tp('list-standard')===sh,
     '★★★Discord の設計の表（server.config.json）の説明文も同じ文');
  ok(!/G\.topicOf|お一人.{0,3}点まで/.test(read('proxy-sync/worker.js').replace(/\/\*[\s\S]*?\*\//g,'')
       .replace(/SUBGUIDE\.topicOf/g,'')),
     '★★pj-sync は説明文の文や数字を自分で持たない（SUBGUIDE.topicOf を呼ぶだけ）');
}

console.log('\n=== 2. 出ているカード：書き換える前に枚数を数える ===');
let envA=null;
{
  reset(); topics={};
  const env=env0(); envA=env;
  await setCfg(env,{ subTopicOn:false });
  for(let i=0;i<4;i++)await add(env,i);
  await api(env,'/sub/send',{ approve:true });
  const posted=dc.filter((x)=>x.method==='POST'&&x.body&&x.body.embeds
    &&(x.ch===LI||x.ch===ST)&&/JAN/.test(JSON.stringify(x.body)));
  ok(posted.length===8&&posted.every((x)=>JSON.stringify(x.body).indexOf(FBA)>0),
     '★用意：いまの形（説明つき）のカードが 8枚出ている');
  let p=(await api(env,'/sub/plan')).body;
  console.log('   '+JSON.stringify(p.slim));
  ok(p.slim&&p.slim.on===false&&p.slim.total===8,
     '★★★外すと書き換わるカードの枚数を数える（8枚）');
  ok(planOf(p.slim,'light').n===4&&planOf(p.slim,'standard').n===4,'★★プランごとの枚数');
  ok(planOf(p,'light').edit===0&&planOf(p,'standard').edit===0,
     '★★★数えるだけ（予定に書き換えは出ない）');
  reset();
  await api(env,'/sub/send',{ approve:true });
  ok(dc.filter((x)=>x.method==='PATCH'&&/JAN/.test(JSON.stringify(x.body))).length===0,
     '★★★⚙がオフのあいだは、配信しても出ているカードを書き換えない');
  /* オンにする。 */
  await setCfg(env,{ subTopicOn:false, subCardSlim:true });
  p=(await api(env,'/sub/plan')).body;
  ok(p.slim.on===true&&planOf(p,'light').edit===4&&planOf(p,'standard').edit===4,
     '★★★オンにすると、予定に書き換えるカードが出る（数えた 8枚と同じ）');
  reset();
  const r=(await api(env,'/sub/send',{ approve:true })).body;
  const ed=dc.filter((x)=>x.method==='PATCH'&&/JAN/.test(JSON.stringify(x.body)));
  console.log('   書き換え '+ed.length+'枚　粗利の欄：'+JSON.stringify(
    (ed[0].body.embeds[0].fields.filter((f)=>/粗利/.test(f.name))[0]||{}).value));
  ok(ed.length===8&&r.edited===8,'★★★8枚を書き換える（PATCH＝通知は鳴らない）');
  ok(ed.every((x)=>JSON.stringify(x.body).indexOf(FBA)<0
     &&/¥[\d,]+（利益率 \d+%）/.test(JSON.stringify(x.body))),
     '★★★説明文は無くなり、数字（粗利・利益率）は残る');
  ok(dc.filter((x)=>x.method==='POST'&&/JAN/.test(JSON.stringify(x.body))).length===0
     &&dc.filter((x)=>x.method==='DELETE').length===0,
     '★★新しく出し直さない・消さない');
  ok(ed.every((x)=>!NG.test(JSON.stringify(x.body))&&!/@everyone|@here/.test(JSON.stringify(x.body))
     &&JSON.stringify(x.body.allowed_mentions||{ parse:[] })==='{"parse":[]}'),
     '★★★カードに仕入れ先が分かる情報を出さない・@everyone を使わない');
  reset();
  await api(env,'/sub/send',{ approve:true });
  ok(dc.filter((x)=>x.method==='PATCH'&&/JAN/.test(JSON.stringify(x.body))).length===0,
     '★★もう一度配信しても、二度は書き換えない');
  await add(env,9);
  reset();
  await api(env,'/sub/send',{ approve:true });
  const nw=dc.filter((x)=>x.method==='POST'&&/JAN/.test(JSON.stringify(x.body)));
  ok(nw.length===2&&nw.every((x)=>JSON.stringify(x.body).indexOf(FBA)<0),
     '★★新しく出すカードも説明なし');
  /* 一覧（ピン留めの通）の中身。 */
  const idx=dc.concat([]).filter((x)=>x.body&&/今週の一覧/.test(String(x.body.content||'')));
  const body=(idx[idx.length-1]||{}).body||{};
  console.log('   一覧：'+String(body.content||'').replace(/\n/g,' ⏎ '));
  console.log('   　　　'+String(((body.embeds||[])[0]||{}).description||'').split('\n')[0]);
  ok(/^今週の一覧\n\*\*仕入れ\*\*＝当店からの仕入れ価格/.test(String(body.content||''))
     &&/カードの読み方は <#9999999999> をご覧ください。$/.test(String(body.content||'')),
     '★★★ピン留めの「今週の一覧」に、短い説明と #はじめに へのリンクが1つ入る');
  ok(((body.embeds||[])[0].description.split('\n')).every((ln)=>
       /\*\*／仕入れ ¥3,645／粗利 ¥[\d,]+／残り\d+／\[カード\]\(https:\/\/discord\.com\/channels\/555000555\/\d+\/\d+\)$/.test(ln)),
     '★★★一覧の行が新しい形（ラベルつき）で出る');
  ok(!NG.test(JSON.stringify(body)),'★★一覧に仕入れ先が分かる情報を出さない');
}

console.log('\n=== 3. チャンネルの説明文（トピック）を合わせる ===');
{
  reset(); topics={}; chFail={};
  topics[PR]='プレミアムのリスト。お一人5点まで／1回 100件まで';   // カジの報告の文
  const env=env0();
  await setCfg(env,{ subOnPremium:true });
  for(let i=0;i<2;i++)await add(env,i);
  /* 予定（読むだけ）。 */
  let p=(await api(env,'/sub/plan')).body;
  console.log('   予定：'+p.topic.n+'か所のうち '+p.topic.diff+'か所が食い違い');
  ok(p.topic&&p.topic.n===4&&p.topic.diff===4,'★★★予定に、食い違っているチャンネルの数が出る');
  ok(chCalls.every((x)=>x.method==='GET'),'★★★予定は読むだけ（書き換えない）');
  const g=(await api(env,'/sub/topic')).body;
  const rowOf=(d,ch)=>(d.rows||[]).filter((x)=>x.ch===ch)[0]||{};
  ok(g.ok&&g.approve===false&&rowOf(g,PR).was==='プレミアムのリスト。お一人5点まで／1回 100件まで'
     &&/お一人5点まで／1回50件まで/.test(rowOf(g,PR).want)&&rowOf(g,PR).same===false,
     '★★★「確かめる」で、いまの文と入れる文が分かる（プレミアムは 100件 → 50件）');
  ok(chCalls.every((x)=>x.method==='GET'),'★★「確かめる」も読むだけ');
  /* 配信の回に自動で合わせる。 */
  reset();
  const r=(await api(env,'/sub/send',{ approve:true })).body;
  const pt=chCalls.filter((x)=>x.method==='PATCH');
  console.log('   配信の回：書き換え '+pt.length+'か所　'+topics[PR]);
  ok(pt.length===4&&r.topic&&r.topic.edit===4,'★★★配信の回に、4つのチャンネルの説明文を合わせる');
  ok(/^プレミアムの商品リスト。お一人5点まで／1回50件まで。/.test(topics[PR])
     &&/^ライトの商品リスト。お一人1点まで／1回5件まで。/.test(topics[LI])
     &&/^スタンダードの商品リスト。お一人2点まで／1回20件まで。/.test(topics[ST])
     &&/^モニターの商品リスト。お一人1点まで／毎週 新しく5件。/.test(topics[MO]),
     '★★★4つとも、上限から作った文になる');
  ok(pt.every((x)=>Object.keys(x.body).join()==='topic'),
     '★★★送るのは説明文だけ（名前・権限・並びは送らない）');
  ok(pt.every((x)=>[MO,LI,ST,PR].indexOf(x.ch)>=0)&&chCalls.every((x)=>x.ch!==HOME),
     '★★⚙に入れたプランのチャンネルだけ（#はじめに などは触らない）');
  ok(chCalls.every((x)=>x.method==='GET'||x.method==='PATCH'),'★チャンネルを作らない・消さない');
  /* 文が変わらなければ Discord を呼ばない。 */
  reset();
  await api(env,'/sub/send',{ approve:true });
  ok(chCalls.filter((x)=>x.method==='PATCH').length===0,
     '★★★文が同じなら書き換えない（Discord の回数の上限に当たらない）');
  /* 上限を変えると、次の配信で説明文も変わる。 */
  await setCfg(env,{ subOnPremium:true, subLimNPremium:30, subLimQStandard:3 });
  reset();
  await api(env,'/sub/send',{ approve:true });
  const pt2=chCalls.filter((x)=>x.method==='PATCH').map((x)=>x.ch).sort();
  console.log('   上限を変えたあと：'+topics[PR].slice(0,34)+'／'+topics[ST].slice(0,36));
  ok(JSON.stringify(pt2)===JSON.stringify([ST,PR].sort())
     &&/お一人5点まで／1回30件まで/.test(topics[PR])&&/お一人3点まで／1回20件まで/.test(topics[ST]),
     '★★★上限を変えると、変わったチャンネルだけ説明文が自動で変わる');
  /* 手で同じ文にしてあれば書き換えない。 */
  const env2=env0();
  await setCfg(env2,{}); await add(env2,0);
  topics={}; topics[LI]=G.topicOf([SUBPLAN.list({}).filter((x)=>x.key==='light')[0]]);
  reset();
  const r2=(await api(env2,'/sub/send',{ approve:true })).body;
  ok(chCalls.filter((x)=>x.method==='PATCH'&&x.ch===LI).length===0&&r2.topic.same>=1,
     '★★もう合っているチャンネルは書き換えない');
  /* 権限が無いとき。 */
  const env3=env0();
  await setCfg(env3,{}); await add(env3,0);
  topics={}; chFail={}; chFail[LI]=1;
  reset();
  const r3=(await api(env3,'/sub/send',{ approve:true })).body;
  console.log('   権限なし：'+r3.topic.why);
  ok(r3.ok!==false&&r3.sent>0,'★★★説明文を書き換えられなくても、配信は止めない');
  ok(r3.topic.fail>=1&&/チャンネルの管理/.test(r3.topic.why),
     '★★★できなかった理由を返す（ボットに「チャンネルの管理」が要る）');
  reset();
  await api(env3,'/sub/send',{ approve:true });
  ok(chCalls.filter((x)=>x.method==='PATCH'&&x.ch===LI).length===0,
     '★★できなかったチャンネルに、配信のたびにくり返し頼まない');
  chFail={};
  reset();
  const fx=(await api(env3,'/sub/topic',{ approve:true })).body;
  ok(fx.ok&&fx.edit>=1&&/^ライトの商品リスト/.test(topics[LI]),
     '★★★「いま合わせる」は、その場で書き換える');
  /* ⚙がオフなら配信の回では触らない。 */
  const env4=env0();
  await setCfg(env4,{ subTopicOn:false }); await add(env4,0);
  topics={}; reset();
  const r4=(await api(env4,'/sub/send',{ approve:true })).body;
  ok(chCalls.filter((x)=>x.method==='PATCH').length===0&&r4.topic.on===false,
     '★★⚙がオフなら、配信の回では説明文を触らない');
  /* 同じチャンネルを2つのプランで使う。 */
  const env5=env0();
  await setCfg(env5,{ subChMonitor:ST }); await add(env5,0);
  topics={}; reset();
  await api(env5,'/sub/send',{ approve:true });
  ok(chCalls.filter((x)=>x.method==='PATCH'&&x.ch===ST).length===1
     &&/^モニター・スタンダードの商品リスト。モニター：.+　スタンダード：/.test(topics[ST]||''),
     '★★同じチャンネルを2つのプランで使うときは、1回で両方を書く');
  /* 作業者のキー。 */
  const w=await api(env,'/sub/topic',{ approve:true },'worker-key-999');
  ok(w.status===403||w.status===401||(w.body&&w.body.ok===false),
     '★★★作業者のキーでは説明文を書き換えられない');
  ok(!NG.test(Object.values(topics).join(''))&&!/@everyone|@here/.test(Object.values(topics).join('')),
     '★★説明文に仕入れ先が分かる情報・@everyone は無い');
}
T.done();
