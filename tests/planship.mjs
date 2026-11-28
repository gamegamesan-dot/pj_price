/* 決まり＋Worker：カードの「送料」はプランごとに1つの書き方（8.119・カジの依頼）

   Shopify（2026-11-29）：会員便は重さの段で ¥200〜。プレミアム会員は自動割引で会員便が ¥0。
   ・プレミアム（#リスト-プレミアム・目玉商品-先行（プレミアム））…「送料無料（プレミアム会員）」
   ・モニター・ライト・スタンダード（目玉商品（スタンダード以上）も）… 会員便の段どおり
   ・同じプランなら商品ごとに変えない。Shopify に無い特典（「4本以上 送料無料」）は書かない
   ・出ているカードはメッセージの編集で直す（カードの形の版を上げる） */
import fs from 'node:fs';
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import SHOP from '../shared/shopcsv.js';
import SUBCARD from '../shared/subcard.js';
import * as DIAG from '../proxy-sync/d1-diag.mjs';
const T=harness('決まり＋Worker：カードの送料はプランごとに1つの書き方（8.119）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('planship');

console.log('=== ① 書き方の決まり（1か所）===');
{
  const t=SHOP.tiersOf('');
  ok(SHOP.planShipText('premium',t)==='送料無料（プレミアム会員）','★★★プレミアムは「送料無料（プレミアム会員）」');
  ok(SHOP.planShipText('one_pre',t)==='送料無料（プレミアム会員）','★★★目玉商品-先行（プレミアム）も送料無料');
  const L=SHOP.planShipText('light',t);
  console.log('   '+L);
  ok(L==='会員便・重さで ¥200〜¥600（〜250g ¥200／〜350g ¥300／351g〜 ¥600）','★★★会員便の段をそのまま書く');
  ok(SHOP.planShipText('monitor',t)===L&&SHOP.planShipText('standard',t)===L&&SHOP.planShipText('one_open',t)===L,
     '★★★モニター・ライト・スタンダード・目玉商品（スタンダード以上）は同じ書き方');
  ok(!/送料無料/.test(L),'★★★Shopify に無い特典（◯本以上 送料無料）は書かない');
  const t2=SHOP.tiersOf('250:200／350:300／1000:600／0:1200');
  ok(/重さで ¥200〜¥1,200/.test(SHOP.planShipText('light',t2))&&/1,001g〜 ¥1,200/.test(SHOP.planShipText('light',t2)),
     '★★⚙の会員便の段（Shopify と同じ表）を変えれば書き方も変わる（上限 ¥1,200）');
  const t3=SHOP.tiersOf('250:200／350:200／0:600');
  ok(SHOP.planShipText('light',t3)==='会員便・重さで ¥200〜¥600（〜350g ¥200／351g〜 ¥600）','★同じ金額の段は1つにまとめる');
  ok(SUBCARD.CARD_V==='8.119','★★★カードの形の版を上げる（出ているカードも書き換える）');
}

console.log('=== ② 配る：同じプランなら商品ごとに変えない ===');
let dc=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{}, m=String(o.method||'GET');
  if(/\/api\/webhooks\//.test(url))return new Response(null,{status:204});
  if(/discord\.com\/api/.test(url)){
    const cc=/\/channels\/(\d+)$/.exec(url);
    if(cc)return new Response(JSON.stringify({ id:cc[1], name:'ch', guild_id:'555' }),{status:200});
    const mm=/\/channels\/(\d+)\/(?:messages|pins)(?:\/(\d+))?/.exec(url)||[];
    let b=null; try{ b=o.body?JSON.parse(String(o.body)):null; }catch(e){ b=null; }
    dc.push({ method:m, ch:mm[1]||'', msg:mm[2]||'', body:b });
    if(m==='DELETE'||m==='PUT')return new Response(null,{status:204});
    if(m==='GET')return new Response('[]',{status:200});
    return new Response(JSON.stringify({ id:String(mm[2]||(800000+dc.length)) }),{status:200});
  }
  return new Response('{}',{status:200});
};
const CH={ monitor:'1111111111', light:'2222222222', standard:'3333333333', premium:'4444444444' };
const env=makeEnv({ STAFF_KEY:'staff-key-123', DISCORD_BOT_TOKEN:'bot-token-xyz' });
await env.DB.prepare(`INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)`)
  .bind(JSON.stringify({ at:new Date().toISOString(), settings:{ subOn:false, subAutoOn:false,
    subOnMonitor:true, subChMonitor:CH.monitor, subOnLight:true, subChLight:CH.light,
    subOnStandard:true, subChStandard:CH.standard, subOnPremium:true, subChPremium:CH.premium,
    subMonSame:true, subLimNLight:9, subLimNStandard:9, subLimNPremium:9, subMonSpeedMin:'0.1',
    gdIdxOn:false, subDomain:'omakase-ship.myshopify.com',
    /* 前に⚙へ入れてあったプランごとの文（もう使わない）。 */
    subShipMonitor:'クリックポスト（1〜2本 ¥200／3本 ¥300／4本以上 送料無料）',
    subShipPremium:'クリックポスト（1〜2本 ¥200）' } }), new Date().toISOString()).run();
const at=new Date().toISOString();
const item=async(jan,o)=>{
  await env.DB.prepare(`INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,created_at,pick)
    VALUES (?1,'い',0,?2,?3,9,'h',?4,?4,1)`).bind(jan,o.kishu||'NS','商品'+jan.slice(-2),at).run();
  await env.DB.prepare(`INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,size_g,size_long,size_wid,size_hei,rank,rank_cat,new_n,amz,checked_at,basis,price_at)
    VALUES (?1,'B0D1GSZJ8T',?2,9000,1200,?3,?4,?5,?6,?7,12000,'ゲーム',4,0,?8,'カート',?8)`)
    .bind(jan,'A'+jan,o.tier||'s',o.g||0,o.l||null,o.w||null,o.h||null,at).run();
  await env.DB.prepare(`INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
    VALUES (?1,1,3,3645,?2,?3,?3,?3,?3)`).bind(jan,o.grades||'light,standard,premium',at).run();
};
await item('4902370550901',{ kishu:'NS' });                                           // ゲーム（薄物）
await item('4902370550902',{ kishu:'NS', tier:'', g:0 });                            // 大きさが分からない
await item('4902370550903',{ kishu:'figure', tier:'m', g:900, l:30, w:20, h:15, grades:'standard,premium' }); // 箱もの
dc=[];
const api=async(path,body)=>(await asJson(await worker.fetch(body?post(path,body):get(path),env,{}))).body;
let r=await api('/sub/send',{ approve:true });
const shipOf=(ch)=>dc.filter((x)=>x.ch===ch&&x.body&&(x.body.embeds||[]).length)
  .map((x)=>((x.body.embeds[0].fields||[]).filter((f)=>f.name==='送料')[0]||{}).value);
const t=SHOP.tiersOf('');
const L=SHOP.planShipText('light',t);
for(const k of ['monitor','light','standard','premium']){
  const v=shipOf(CH[k]);
  console.log('   '+k+'：'+v.length+'件 '+JSON.stringify([...new Set(v)]));
}
ok(shipOf(CH.premium).length>=3&&shipOf(CH.premium).every((v)=>v==='送料無料（プレミアム会員）'),
   '★★★#リスト-プレミアムのカードは、どの商品も「送料無料（プレミアム会員）」');
ok(['monitor','light','standard'].every((k)=>shipOf(CH[k]).length>=1&&shipOf(CH[k]).every((v)=>v===L)),
   '★★★モニター・ライト・スタンダードは、どの商品も会員便の段どおり（商品ごとにばらばらにしない）');
ok(shipOf(CH.standard).length===3,'★箱もの・大きさが分からない商品も同じ書き方（スタンダードに3件）');
ok(!dc.some((x)=>/4本以上 送料無料/.test(JSON.stringify(x.body||''))),'★★★⚙に残っていた「4本以上 送料無料」は出さない');

console.log('=== ③ 出ているカードはメッセージの編集で直す ===');
{
  /* 前の形（版 6.200）で出したカードとして控えを戻す。 */
  await env.DB.prepare(`UPDATE sync_state SET v='6.200' WHERE k='sub.card.v'`).run();
  await env.DB.prepare(`UPDATE sub_post SET card_h='old'`).run();
  dc=[];
  r=await api('/sub/send',{ approve:true });
  const meth=dc.filter((x)=>x.body&&(x.body.embeds||[]).length).map((x)=>x.method);
  console.log('   '+JSON.stringify({ edited:r.edited, sent:r.sent, m:[...new Set(meth)] }));
  ok(r.edited>=10&&r.sent===0&&meth.every((m)=>m==='PATCH'),'★★★出ているカードはぜんぶ書き換える（出し直さない）');
  ok(!dc.some((x)=>x.method==='DELETE'),'★★★消さない');
}

console.log('=== ④ 目玉商品（1点もの）・記録・⚙ ===');
{
  const cfg=await W.subSettings(env);
  const card=(k)=>(((W.oneCardOf?W.oneCardOf({ name:'1点もの', price:5000, qty:1, ship_kind:'box' },cfg,'',k):null)||{ fields:[] }).fields||[])
    .filter((f)=>f.name==='送料').map((f)=>f.value)[0];
  if(W.oneCardOf){
    ok(card('one_pre')==='送料無料（プレミアム会員）','★★★目玉商品-先行（プレミアム）のカードは送料無料');
    ok(card('one_open')===L,'★★★目玉商品（スタンダード以上）のカードは会員便の段どおり');
  } else ok(false,'oneCardOf を試験から呼べる');
  const src=fs.readFileSync(new URL('../proxy-sync/worker.js',import.meta.url),'utf8');
  ok(/String\(y\.plan \|\| ""\) \|\| "one_pre"\)/.test(src),'★★注文を取り込んで書き換えるときも、出したチャンネルのプランの書き方');
  const txt=DIAG.subKickText(JSON.stringify({ at:'x', ship:{ light:L, premium:'送料無料（プレミアム会員）' } })).join('\n');
  ok(/カードの送料 light：会員便・重さで/.test(txt)&&/カードの送料 premium：送料無料/.test(txt),'★★「いますぐ配る」の記録にプランごとの送料の文を出す');
  const h=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  ok(!/id="subShip(Monitor|Light|Standard|Premium)"/.test(h),'★★★⚙のプランごとの送料の文（使わなくなった欄）を外す');
  ok(/8\.119：カードの「送料」は<b>プランごとに1つの書き方<\/b>/.test(h),'★⚙に決まりを書く');
}
T.done();
