/* Worker：会員チャンネルの「今週の一覧（目次）」（8.46・カジの依頼）

   A … 固定の1通（ページが増えれば数通）をピン留めして、配信のたびに
       **書き換える**（PATCH＝通知は鳴らない）
   B … 配信した日に「今週の新着 ◯件＋一覧へのリンク」を1通
       （その日の最初だけ POST・2回目からは書き換え＝通知は1日1回。
        モニターは「今週の配信」に混ぜるので出さない）
   ・受付終了・完売・残り0・カードが消えた品は一覧に出さない
   ・ページが減ったら「（このページは空です）」に書き換える（**消さない**）
   ・GET /sub/index は**予定**（何件・何ページ）だけ返す（何も出さない） */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：会員チャンネルの一覧（8.46）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('subindexw');

let dc=[], pins=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/\/api\/webhooks\//.test(url))return new Response(null,{status:204});
  if(/discord\.com\/api/.test(url)){
    const pn=/\/channels\/(\d+)\/pins\/(\d+)/.exec(url);
    if(pn){ pins.push({ ch:pn[1], msg:pn[2], method:String(o.method||'') });
      return new Response(null,{status:204}); }
    const cc=/\/channels\/(\d+)$/.exec(url);
    if(cc)return new Response(JSON.stringify({ id:cc[1], name:'ch-'+cc[1],
      guild_id:'555000555' }),
      {status:200,headers:{'content-type':'application/json'}});
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    const b=o.body?JSON.parse(String(o.body)):null;
    dc.push({ method:String(o.method||'GET'), ch:m[1]||'', msg:m[2]||'',
              body:b });
    return new Response(JSON.stringify({ id:String(900000+dc.length) }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  return new Response('{}',{status:200});
};
const LI='2222222222', MO='1111111111';
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  DISCORD_BOT_TOKEN:'bot-token-xyz' });
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subOnMonitor:false,
      subOnLight:true, subChLight:LI, subChMonitor:MO, subNLight:50,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const jan=(i)=>'490237055'+String(2000+i);
const add=async(env,i,o)=>{
  const j=jan(i), at=new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,
       created_at) VALUES (?1,'いろは',0,?2,?3,20,'h',?4,?4)`)
    .bind(j,(o||{}).kishu||'NS',(o||{}).name||('ゲーム'+i),at).run();
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,rank,rank_cat,
       new_n,checked_at,basis,price_at)
     VALUES (?1,'B0D1GSZJ8T',?2,9000,1200,'s',12000,'ゲーム',3,?3,'カート',?3)`)
    .bind(j,(o||{}).name||('Amazon'+i),at).run();
  await env.DB.prepare(
    `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,
       at,created_at) VALUES (?1,1,?2,?3,'light,standard,premium',?4,?4,?4,?4)`)
    .bind(j,(o||{}).qty===undefined?2:(o||{}).qty,
          (o||{}).price||3645,at).run();
  return j;
};
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
const cards=()=>dc.filter((x)=>x.body&&(x.body.embeds||[]).length
  &&/受付終了|今週の一覧|（このページは空です）/
    .test(JSON.stringify(x.body))===false);
const idx=()=>dc.filter((x)=>x.body&&/今週の一覧/.test(String(
  (x.body||{}).content||'')));

console.log('=== ① 配信のあとに一覧が出て、ピン留めされる ===');
let env=env0();
{
  await setCfg(env,{});
  for(let i=0;i<3;i++)await add(env,i);
  dc=[]; pins=[];
  const r=await api(env,'/sub/send',{ approve:true });
  const one=idx();
  console.log('   '+JSON.stringify((r.index||{}).chs||[]));
  console.log('   '+String(((one[0]||{}).body||{}).embeds[0].description||'')
    .split('\n')[0]);
  ok(one.length===1&&one[0].method==='POST'&&one[0].ch===LI,
     '★★★配信のあと、そのチャンネルに一覧を1通出す');
  ok(/今週の一覧/.test(String(((one[0]||{}).body||{}).content||'')),
     '★★一覧だと分かる見出し');
  const e0=((one[0]||{}).body||{}).embeds[0]||{};
  ok(/ゲーム（3件）/.test(String(e0.title||'')),
     '★★★カテゴリの見出しと件数');
  ok(/¥3,645/.test(String(e0.description||''))
     &&/残り2/.test(String(e0.description||'')),
     '★★★仕入れ値と残り数を出す');
  ok(/discord\.com\/channels\/555000555\/2222222222\/90000/
     .test(String(e0.description||'')),
     '★★★カードへのリンク（サーバー/部屋/メッセージ）');
  ok(!/卸値|いろは|MW|仕入原価/.test(JSON.stringify(one[0].body)),
     '★★★卸値・仕入れ先・MW のことは1つも入らない（8.2）');
  ok(pins.length===1&&pins[0].method==='PUT'&&pins[0].ch===LI,
     '★★★1ページめをピン留めする');
  ok((r.index||{}).add===1,'★出した数を返す');
}

console.log('\n=== ② 2回目は書き換えだけ（通知は鳴らない）===');
{
  dc=[]; pins=[];
  const r=await api(env,'/sub/send',{ approve:true });
  console.log('   '+JSON.stringify((r.index||{}).chs||[]));
  ok(idx().length===0&&(r.index||{}).same===1,
     '★★★中身が同じなら触らない（そのまま）');
  ok(pins.length===0,'★★ピン留めは1回だけ');
  /* 値段が変われば一覧も書き換える（PATCH＝通知なし）。 */
  await env.DB.prepare(`UPDATE mw_sub SET price=4000 WHERE jan=?1`)
    .bind(jan(0)).run();
  dc=[];
  const r2=await api(env,'/sub/send',{ approve:true });
  const ed=dc.filter((x)=>/今週の一覧/.test(String((x.body||{}).content||'')));
  console.log('   '+JSON.stringify(ed.map((x)=>x.method)));
  ok(ed.length===1&&ed[0].method==='PATCH'&&(r2.index||{}).edit===1,
     '★★★中身が変わったら書き換える（PATCH＝通知は鳴らない）');
  ok(ed.filter((x)=>x.method==='POST').length===0,
     '★★★新しく出し直さない（通知を鳴らさない）');
}

console.log('\n=== ③ 受付終了・完売・残り0は一覧から外す ===');
{
  /* 1件を完売にする（注文を取り込んだ形）。 */
  await env.DB.prepare(
    `INSERT INTO sub_order (order_no,sku,jan,qty,price,at,created_at)
     VALUES ('#2001',?1,?2,2,3645,?3,?3)`)
    .bind('SUB-'+jan(1)+'-20261116',jan(1),new Date().toISOString()).run();
  dc=[];
  const r=await api(env,'/sub/send',{ approve:true });
  const ed=dc.filter((x)=>/今週の一覧/.test(String((x.body||{}).content||'')));
  const body=String((((ed[0]||{}).body||{}).embeds||[{}])[0].description||'');
  console.log('   '+JSON.stringify((r.index||{}).chs||[]));
  ok(((r.index||{}).chs||[])[0].n===2,
     '★★★残り0（完売）の品は一覧に出さない');
  ok(/ゲーム（2件）/.test(String((((ed[0]||{}).body||{})
     .embeds||[{}])[0].title||'')),'★★件数も2件になる');
  ok(body.indexOf('ゲーム1')<0,'★その品の行が消えている');
}

console.log('\n=== ④ ページが減ったら「空です」に書き換える（消さない）===');
{
  /* 配信そのものは①〜③で見たので、ここは**一覧だけ**を見る
     （カードの控えを直に入れて POST /sub/index を押す。
     1枚ずつ送ると Discord の間隔で時間がかかるため）。 */
  const e2=env0();
  await setCfg(e2,{ gdIdxName:60 });
  const long='あ'.repeat(58);
  const at=new Date().toISOString();
  for(let i=0;i<70;i++){
    const j=await add(e2,i,{ name:long+i });
    await e2.DB.prepare(
      `INSERT INTO sub_post (jan,ch,plan,msg_id,price,qty,sold,sold_out,at,
         created_at) VALUES (?1,?2,'light',?3,3645,2,0,0,?4,?4)`)
      .bind(j,LI,String(910000+i),at).run();
  }
  dc=[]; pins=[];
  const r=await api(e2,'/sub/index',{});
  const n1=(r.chs||[])[0]||{};
  console.log('   ページ '+n1.pages+'／件数 '+n1.n);
  ok(n1.pages>=2,'★★★1通に入らなければページを分ける');
  ok(idx().length===n1.pages&&idx().every((x)=>x.method==='POST'),
     '★★★ページのぶんだけ出す');
  ok(/今週の一覧（1\//.test(String(((idx()[0]||{}).body||{}).content||'')),
     '★★見出しに「1/◯」を入れる');
  ok(pins.length===1&&pins[0].method==='PUT'&&pins[0].ch===LI,
     '★★★ピン留めは1ページめだけ');
  /* 半分を取り下げて、ページが1つに減る。 */
  await e2.DB.prepare(`UPDATE mw_sub SET on_sale=0 WHERE jan > ?1`)
    .bind(jan(34)).run();
  dc=[];
  const r2=await api(e2,'/sub/index',{});
  const ed=dc.filter((x)=>/今週の一覧|このページは空です/
    .test(JSON.stringify(x.body||{})));
  console.log('   '+JSON.stringify(ed.map((x)=>x.method))
    +' empty='+((r2.chs||[])[0]||{}).empty);
  ok(ed.length>0&&ed.every((x)=>x.method==='PATCH'),
     '★★★減ったときも書き換えだけ（新しく出さない）');
  ok(/このページは空です/.test(JSON.stringify(ed.map((x)=>x.body)))
     &&((r2.chs||[])[0]||{}).empty>0,
     '★★★余ったページは「（このページは空です）」に書き換える');
  ok(dc.filter((x)=>x.method==='DELETE').length===0,
     '★★★メッセージは消さない');
}

console.log('\n=== ⑤ B：配信した日の「今週の新着」1通 ===');
{
  const e3=env0();
  await setCfg(e3,{});
  await add(e3,0);
  dc=[];
  await api(e3,'/sub/send',{ approve:true });
  const wk=dc.filter((x)=>/今週の新着/.test(String((x.body||{}).content||'')));
  console.log('   '+String(((wk[0]||{}).body||{}).content||'')
    .replace(/\n/g,' ／ '));
  ok(wk.length===1&&wk[0].method==='POST'&&wk[0].ch===LI,
     '★★★配信した日に「今週の新着」を1通出す');
  ok(/今週の新着 1件/.test(String(((wk[0]||{}).body||{}).content||'')),
     '★★★その日に新しく出た件数');
  ok(/ぜんぶの一覧 →/.test(String(((wk[0]||{}).body||{}).content||''))
     &&/discord\.com\/channels\//.test(String(((wk[0]||{}).body||{}).content||'')),
     '★★★固定の一覧へのリンクを入れる');
  ok(!/@everyone|@here/.test(JSON.stringify((wk[0]||{}).body||{})),
     '★★★@everyone・@here は使わない');
  /* 2回目は書き換え（通知は1日1回）。 */
  await add(e3,1);
  dc=[];
  await api(e3,'/sub/send',{ approve:true });
  const wk2=dc.filter((x)=>/今週の新着/.test(String((x.body||{}).content||'')));
  ok(wk2.length===1&&wk2[0].method==='PATCH',
     '★★★同じ日の2回目は書き換え（通知は鳴らない）');
  /* 新しく出なかった回は出さない。 */
  dc=[];
  await api(e3,'/sub/send',{ approve:true });
  ok(dc.filter((x)=>/今週の新着/.test(String((x.body||{}).content||'')))
     .length===0,'★★新しく出ていない回は触らない');
}

console.log('\n=== ⑥ GET /sub/index は予定だけ（何も出さない）===');
{
  dc=[];
  const d=await api(env,'/sub/index');
  console.log('   '+JSON.stringify(d.chs));
  ok(d.ok===true&&dc.length===0,'★★★押す前の予定では何も出さない');
  ok((d.chs||[])[0].n===2&&(d.chs||[])[0].pages===1,
     '★★★件数とページ数を返す');
  ok(((d.chs||[])[0].cats||[])[0].cat==='ゲーム',
     '★★カテゴリごとの件数も返す');
  ok(d.on===true&&d.auto===true&&d.week===true,
     '★★⚙（一覧を出す・配信のあと・新着の1通）も返す');
  ok((d.chs||[])[0].pin===true,'★ピン留めしてあるかも返す');
}

console.log('\n=== ⑦ ⚙で止められる・作業者のキーでは動かせない ===');
{
  const e4=env0();
  await setCfg(e4,{ gdIdxOn:false });
  await add(e4,0);
  dc=[];
  const r=await api(e4,'/sub/send',{ approve:true });
  ok(!r.index&&dc.filter((x)=>/今週の一覧/
    .test(String((x.body||{}).content||''))).length===0,
     '★★★⚙を切れば一覧を出さない');
  const r2=await api(e4,'/sub/index',{});
  ok(r2.ok===true&&/オフ/.test(String(r2.why||'')),
     '★★オフのときは理由を返す');
  const req=(path,body)=>new Request('https://x'+path,
    { method:body?'POST':'GET',
      headers:Object.assign({'X-PJ-Key':'staff-key-123'},
        body?{'content-type':'application/json'}:{}),
      body:body?JSON.stringify(body):undefined });
  const z=await asJson(await worker.fetch(req('/sub/index',{}),env,{}));
  ok(z.status===403,'★★★動かすのは管理者だけ');
}
T.done();
