/* Worker：会員向けの自動配信を週に1回にする（8.107・v356）

   カジの依頼（2026-11-27）
   LP と動画では「毎週リストが届く」と案内している。いまの自動配信は「毎日、決めた時刻」
   だけなので、週に1回（決まった曜日・時刻）にできるようにする。
   ① ⚙「配信の間隔」：毎日（今の動き・既定）／毎週。毎週は曜日（既定 火）・時刻（既定 12時）
   ② 毎週は選んだ曜日・時刻の回だけ配信し、ほかの定時の回では何もしない
      「土日も配信する」は毎日のときだけ効く
   ③ その週（選んだ曜日の 0:00 から7日間）に手で配信してあれば、自動では送らない
   ④ 失敗した／候補が0件だったら社内用の Discord に知らせる（自動ではやり直さない）
   ⑤ 次に配信する日時（12/1（火）12:00）を画面に返す
   ⑥ 設定は pj-sync の値だけで動く・自動配信がオフなら何もしない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import SA from '../shared/subauto.js';
const T=harness('Worker：会員向けの自動配信を週に1回（8.107）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('subweekly');

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

const TUE_12=Date.parse('2026-12-01T03:10:00Z');   // 12/1（火）12:10 JST
const TUE_20=Date.parse('2026-12-01T11:10:00Z');   // 12/1（火）20:10 JST
const WED_12=Date.parse('2026-12-02T03:10:00Z');   // 12/2（水）12:10 JST
const SAT_12=Date.parse('2026-12-05T03:10:00Z');   // 12/5（土）12:10 JST
const iso=(ms)=>new Date(ms).toISOString();
const WEEK={ subAutoEvery:'week' };
const postCard=(env,atMs,jan)=>env.DB._db.prepare(`INSERT INTO sub_post (jan,ch,plan,msg_id,price,qty,at,created_at)
  VALUES (?,?,?,?,?,?,?,?)`).run(jan||'4902370551999',CH,'monitor','m'+atMs,2000,1,iso(atMs),iso(atMs));
const newCards=()=>dc.filter((x)=>x.method==='POST'&&/^\d+$/.test(x.ch)&&!x.msg).length;

console.log('=== ① ⚙ の読み方（shared/subauto.js）===');
{
  const d=SA.schedOf({});
  ok(d.every==='day'&&d.dow===2&&d.hour===12,'★★★既定は「毎日」（今の動き）。毎週の既定は 火曜・12時');
  const w=SA.schedOf({ subAutoEvery:'week', subAutoWeekDow:'5', subAutoWeekHour:'3' });
  ok(w.every==='week'&&w.dow===5&&w.hour===12,'★★夜中（0〜7時）の時刻は使わず既定の 12時');
  ok(SA.dueSched(SA.schedOf(WEEK),{ dow:2, hour:12 })&&!SA.dueSched(SA.schedOf(WEEK),{ dow:2, hour:20 })
     &&!SA.dueSched(SA.schedOf(WEEK),{ dow:3, hour:12 }),'★★★毎週は選んだ曜日・時刻の回だけ（火曜 20時・水曜 12時は配信しない）');
  ok(SA.dueSched(SA.schedOf({ subAutoEvery:'week', subAutoWeekDow:6, subAutoWeekend:false }),{ dow:6, hour:12 })
     &&!SA.dueSched(SA.schedOf({ subAutoWeekend:false }),{ dow:6, hour:12 }),
     '★★「土日も配信する」は毎日のときだけ効く（毎週で土曜を選べば土曜に出る）');
  const n=SA.nextSched(SA.schedOf(WEEK),Date.parse('2026-11-27T03:00:00Z'),0);
  ok(n.text==='12/1（火）12:00'&&!n.skip_week,'★★★次に配信する日時（11/27（金）から見て 12/1（火）12:00）');
  const n2=SA.nextSched(SA.schedOf(WEEK),Date.parse('2026-12-01T01:00:00Z'),Date.parse('2026-12-01T00:30:00Z'));
  ok(n2.text==='12/8（火）12:00'&&n2.skip_week,'★★その週にもう配信してあれば、次の週の日時');
  const n3=SA.nextSched(SA.schedOf(WEEK),Date.parse('2026-12-01T01:00:00Z'),Date.parse('2026-11-30T14:00:00Z'));
  ok(n3.text==='12/1（火）12:00','★★前の週（月曜 23:00）の配信はその週に数えない（月曜 23:59 締めの次の週）');
}

console.log('\n=== ② 毎週：選んだ曜日・時刻の回だけ ===');
{
  reset(); const env=env0(); await setCfg(env,WEEK); await seed(env,4);
  const a=await W.jobSubAuto(env,{ now:iso(TUE_20) });
  const b=await W.jobSubAuto(env,{ now:iso(WED_12) });
  const c=await W.jobSubAuto(env,{ now:iso(SAT_12) });
  ok(a.ran===false&&b.ran===false&&c.ran===false&&/時刻ではありません/.test(a.why)
     &&newCards()===0&&shop.length===0,
     '★★★火曜 20時・水曜 12時・土曜 12時は何もしない（Discord にも Shopify にも送らない）');
  const d=await W.jobSubAuto(env,{ now:iso(TUE_12) });
  console.log('   火曜 12時：'+JSON.stringify({ ran:d.ran, sent:d.sent, why:d.why }));
  ok(d.ran===true&&d.sent>0&&newCards()>0,'★★★火曜 12時の回で配信する');
  const sent1=newCards();
  const e=await W.jobSubAuto(env,{ now:iso(TUE_12+60000) });
  ok(e.ran===false&&newCards()===sent1,'★★同じ回を二度走らせない');
}

console.log('\n=== ③ その週に手で配信してあれば送らない ===');
{
  reset(); const env=env0(); await setCfg(env,WEEK); await seed(env,4);
  postCard(env,Date.parse('2026-12-01T01:00:00Z'));          // 火曜 10:00 JST に手で配信
  const r=await W.jobSubAuto(env,{ now:iso(TUE_12) });
  console.log('   '+r.why);
  ok(r.ran===false&&/今週の分はもう配信してあります/.test(r.why)&&newCards()===0&&shop.length===0,
     '★★★「毎週」に切り替えた週に手で配信済みなら、同じ週に二重に送らない');
  reset(); const env2=env0(); await setCfg(env2,WEEK); await seed(env2,4);
  postCard(env2,Date.parse('2026-11-30T13:00:00Z'));         // 月曜 22:00 JST（前の週）
  const r2=await W.jobSubAuto(env2,{ now:iso(TUE_12) });
  ok(r2.ran===true&&r2.sent>0,'★★前の週（月曜）の配信は数えない（火曜に配信する）');
  reset(); const env3=env0(); await setCfg(env3,WEEK); await seed(env3,4);
  postCard(env3,Date.parse('2026-12-01T01:00:00Z'),'one-12');  // 1点もの
  const r3=await W.jobSubAuto(env3,{ now:iso(TUE_12) });
  ok(r3.ran===true,'★1点ものの配信は週のリストに数えない');
}

console.log('\n=== ④ 失敗・候補0件は社内用の Discord に知らせる（やり直さない）===');
{
  reset(); const env=env0(); await setCfg(env,WEEK);           // 候補なし
  const r=await W.jobSubAuto(env,{ now:iso(TUE_12) });
  console.log('   '+JSON.stringify({ ran:r.ran, sent:r.sent, cand:r.cand_n }));
  ok(r.ran===true&&r.sent===0&&notes.some((t)=>/週1回の配信が空でした/.test(t)&&/候補が0件/.test(t)),
     '★★★候補が0件なら社内用の Discord に知らせる');
  ok(notes.some((t)=>/自動ではやり直しません/.test(t)),'★★自動ではやり直さない（二重に送らない）と書く');
  reset();
  const r2=await W.jobSubAuto(env,{ now:iso(TUE_12+3600000) });
  ok(r2.ran===false&&notes.length===0,'★★★1時間後の回でやり直さない');
  reset(); const env2=env0({ DISCORD_BOT_TOKEN:'' }); await setCfg(env2,WEEK); await seed(env2,4);
  const r3=await W.jobSubAuto(env2,{ now:iso(TUE_12) });
  ok(r3.error==='no_token'&&notes.some((t)=>/週1回の配信がうまくいきませんでした/.test(t)),'★★失敗したら知らせる');
  /* 毎日のときは今までどおり（この知らせは出さない）。 */
  reset(); const env3=env0(); await setCfg(env3,{});
  await W.jobSubAuto(env3,{ now:iso(TUE_12) });
  ok(!notes.some((t)=>/週1回の配信/.test(t)),'★毎日のときは週1回の知らせを出さない');
}

console.log('\n=== ⑤ 自動配信がオフ・毎日は今までどおり ===');
{
  reset(); const env=env0(); await setCfg(env,{ subAutoOn:false, subAutoEvery:'week' }); await seed(env,4);
  const r=await W.jobSubAuto(env,{ now:iso(TUE_12) });
  ok(r.ran===false&&/オフ/.test(r.why)&&newCards()===0&&shop.length===0,'★★★自動配信がオフなら何も送らない');
  reset(); const env2=env0(); await setCfg(env2,{}); await seed(env2,4);
  const d1=await W.jobSubAuto(env2,{ now:iso(TUE_20) });
  ok(d1.ran===true,'★★毎日（既定）は今までどおり 12時・20時の回で配信する');
}

console.log('\n=== ⑥ 画面の「次の回」（GET /sub/auto）===');
{
  reset(); const env=env0(); await setCfg(env,WEEK);
  const s=(await asJson(await worker.fetch(get('/sub/auto'),env,{}))).body;
  console.log('   '+JSON.stringify({ every:s.every, sched:s.sched_text, next:s.next_text }));
  ok(s.ok&&s.every==='week'&&s.sched_text==='毎週 火曜 12時'&&/^\d+\/\d+（火）12:00$/.test(s.next_text),
     '★★★配信の間隔と、次に配信する日時（◯/◯（火）12:00）を返す');
  /* その週にもう配信してあれば、次の週の日時と「配信済み」を返す。 */
  postCard(env,Date.now()-60000);
  const s2=(await asJson(await worker.fetch(get('/sub/auto'),env,{}))).body;
  const ws=SA.weekStartMs(SA.schedOf(WEEK),Date.now());
  const thisSlot=ws+12*3600000;
  ok(Date.now()<thisSlot?(s2.next_skip_week===true&&!!s2.last_post):true,
     '★★その週に配信済みなら「今週はもう配信してある」（次の週の日時）');
}

T.done();
