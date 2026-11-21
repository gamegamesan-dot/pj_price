/* 決まり・Worker：1点ものの写真を複数枚（8.87）

   カジの依頼（2026-11-22）「1点ものを登録する」で写真を複数枚（最大10枚）
     ・1枚目がメイン（Discord のカードと Shopify の商品の最初の写真）
     ・Shopify 用 CSV は、2枚目から同じ Handle の行に Image Src と Image Position
     ・Discord のカードは今までどおり1枚目だけ
     ・写真を消しても、もう Shopify に出ている商品には自動で反映しない
   守ること：実物の写真だけ（Amazon・メーカーの画像を自動で入れない）・
     会員向けのカードに仕入れ先が分かる情報を出さない

   ① 写真の並びの決まり（shared/shopcsv.js：10枚・pj-img の URL だけ・長辺 500px）
   ② Shopify 用 CSV（写真の列・2枚目からの行）と、写真の直しCSV
   ③ 登録：並びを控える（10枚を超える・ほかの URL は断る・前の写真は片づける）
   ④ 一覧：枚数・読み込んだあとに写真を変えたか
   ⑤ 前の形の写真（KV の1枚）を読む口
   ⑥ Discord：メインの1枚だけを添付・メインを入れ替えるとカードの写真も替わる・
      写真を全部外すと添付も外す・前の形の品はそのまま・読めなければ送らない
   ⑦ migrate-0071 がまだでも落ちない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const S=require('../shared/shopcsv.js');
const T=harness('決まり・Worker：1点ものの写真を複数枚（8.87）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('onepics');
const read=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');

const IMG='https://pj-img.example.workers.dev';
const U=(n)=>IMG+'/i/20261122/'+String(n).padStart(8,'0')+'-0000-4000-8000-000000000000.jpg';
const P=(n,o)=>Object.assign({ url:U(n), key:'20261122/'+n, w:1600, h:1600 },o||{});

/* ---- 作り物の Discord と画像サーバー ---- */
let dc=[], img=[], imgDown=false;
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/\/api\/webhooks\//.test(url))return new Response(null,{status:204});
  if(/discord\.com\/api/.test(url)){
    if(/\/channels\/\d+$/.test(url))
      return new Response(JSON.stringify({ id:'1', guild_id:'5' }),
        {status:200,headers:{'content-type':'application/json'}});
    const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
    const body=o.body;
    const form=(typeof FormData!=='undefined'&&body instanceof FormData);
    const files=[];
    if(form)for(const [k,v] of body.entries())
      if(/^files\[/.test(k))files.push({ name:v.name, size:v.size,
        bytes:Buffer.from(await v.arrayBuffer()).toString('hex') });
    dc.push({ method:String(o.method||'GET'), ch:m[1]||'', msg:m[2]||'', form,
      payload:form?JSON.parse(String(body.get('payload_json')||'{}'))
                  :JSON.parse(String(body||'{}')), files });
    return new Response(JSON.stringify({ id:String(900000+dc.length) }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  return new Response('{}',{status:200});
};
/* pj-img（サービスバインディング）。URL ごとに違う中身を返す。 */
const IMG_SVC={ fetch:async(u)=>{
  img.push(String(u));
  if(imgDown)return new Response('no',{status:503});
  const n=Number((/\/i\/\d{8}\/(\d{8})-/.exec(String(u))||[])[1]||0);
  return new Response(new Uint8Array([0xff,0xd8,0xff,n&255,0xd9]),
    {status:200,headers:{'content-type':'image/jpeg'}});
} };
const CH={ pre:'777', hot:'888' };
const env0=(extra)=>makeEnv(Object.assign({ STAFF_KEY:'staff-key-123',
  WORKER_KEY:'worker-key-999', DISCORD_BOT_TOKEN:'bot-token-xyz', IMG_SVC },extra||{}));
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(),
    settings:Object.assign({ subOn:true, subChPre:CH.pre, subChHot:CH.hot,
      gdIdxOn:false, subTopicOn:false,
      subDomain:'omakase-ship.myshopify.com' },o||{}) }),
    new Date().toISOString()).run();
const api=async(env,path,body,key)=>{
  const r=body?post(path,body):get(path);
  if(key)r.headers.set('X-PJ-Key',key);
  return (await asJson(await worker.fetch(r,env,{}))).body;
};
const ITEM={ name:'ガンダム RG νガンダム', cond:'中古', cond_note:'箱にスレ',
  cost:2000, price:4800, qty:1, ship_kind:'box', note:'開封済み' };
const rowOf=async(env,id)=>((await api(env,'/one?all=1')).rows||[])
  .filter((x)=>x.one_id===id)[0]||{};
const cards=()=>dc.filter((x)=>x.method!=='GET'&&/\/?/.test(x.ch));

console.log('=== ⑦ migrate-0071 がまだの D1（列が無い）===');
{
  const env=env0();
  await env.DB.prepare(`ALTER TABLE one_item DROP COLUMN pics`).run();
  await env.DB.prepare(`ALTER TABLE one_item DROP COLUMN pics_put`).run();
  const r=await api(env,'/one',{ ...ITEM, pics:[P(1)] });
  ok(r.ok===false&&r.error==='no_cols'&&/migrate-0071/.test(r.detail),
     '★★★写真の並びを送ると、migrate-0071 がまだだと分かる');
  const d=await api(env,'/one?all=1');
  ok(d.ok===true&&d.rows.length===1&&Array.isArray(d.rows[0].pics)&&d.rows[0].pics.length===0,
     '★★一覧は落ちない（写真の並びは空）');
  const m=await api(env,'/one/mark',{ ids:[d.rows[0].one_id], loaded:1 });
  ok(m.ok===true,'★印も付けられる');
}

console.log('\n=== ① 写真の並びの決まり ===');
{
  ok(S.ONE_PICS_MAX===10&&S.ONE_PIC_MIN===500,'★★★10枚まで・長辺 500px');
  const a=S.onePicsOf([P(1),P(2),P(1),{ url:'https://m.media-amazon.com/images/I/x.jpg' },
    { url:'https://img.mw-site.example/a.jpg' },'not-url',P(3,{ w:400, h:300 })]);
  ok(a.length===3&&a[0].url===U(1)&&a[2].w===400,
     '★★★画像サーバー（pj-img）に上げた写真だけ・同じ写真は1つ・並びはそのまま');
  ok(S.onePicsOf(JSON.stringify([P(1)])).length===1&&S.onePicsOf('壊れた')
     .length===0&&S.onePicsOf(null).length===0,'★JSON の文字でも読める・壊れていても落ちない');
  const many=[]; for(let i=1;i<=13;i++)many.push(P(i));
  ok(S.onePicsOf(many).length===10,'★★10枚を超えるぶんは持たない');
  ok(S.onePicSmall({ w:400, h:300 })&&!S.onePicSmall({ w:500, h:300 })
     &&!S.onePicSmall({}),'★★長辺 500px 未満だけ「小さい」（大きさが分からなければ言わない）');
  ok(S.onePicsSig([P(1),P(2)])!==S.onePicsSig([P(2),P(1)]),'★並びが変われば指紋も変わる');
}

console.log('\n=== ② Shopify 用 CSV ===');
{
  const it={ id:7, name:'ガンダム RG νガンダム', price:4800, qty:1, grades:'premium',
             pics:[P(1),P(2),P(3)] };
  const csv=S.oneBuild([it,{ id:8, name:'写真なし', price:1000, qty:1, pics:[] }],
    { images:true, date:new Date('2026-11-22'), seoHidden:'Metafield: seo.hidden [integer]' });
  const rows=S.splitCsv(csv), h=rows[0], c=(r,n)=>rows[r][h.indexOf(n)];
  console.log(rows.map((r)=>'   '+[r[0],r[1]].concat([c(rows.indexOf(r),'Image Src'),
    c(rows.indexOf(r),'Image Position')]).join(' | ')).join('\n'));
  ok(h.indexOf('Image Src')>0&&h.indexOf('Image Position')>0,'★★★写真の列（Image Src・Image Position）');
  ok(c(1,'Handle')==='one-7'&&c(1,'Title')==='ガンダム RG νガンダム'
     &&c(1,'Image Src')===U(1)&&c(1,'Image Position')==='1',
     '★★★1枚目（メイン）は商品の行に・位置 1');
  ok(c(2,'Handle')==='one-7'&&c(2,'Title')===''&&c(2,'Image Src')===U(2)&&c(2,'Image Position')==='2'
     &&c(3,'Image Src')===U(3)&&c(3,'Image Position')==='3',
     '★★★2枚目からは同じ Handle の行に Image Src と Image Position（2, 3）');
  ok([2,3].every((i)=>rows[i].every((v,k)=>['Handle','Image Src','Image Position'].indexOf(h[k])>=0||v==='')),
     '★★写真の行には Handle と写真の列だけ（ほかは空）');
  ok(c(1,'Metafield: seo.hidden [integer]')==='1'&&c(2,'Metafield: seo.hidden [integer]')==='',
     '★検索から隠す列は商品の行だけ（写真の行には入れない）');
  ok(c(4,'Handle')==='one-8'&&c(4,'Image Src')===''&&rows.length===5,
     '★写真が無い品は写真の列が空・写真の行も無い');
  const nope=S.oneBuild([it],{ date:new Date('2026-11-22') });
  ok(nope.indexOf('Image Src')<0,'★★★写真の列を出さない形も作れる（読み込み済みの品に使う）');
  const fix=S.oneImgCsv([it,{ id:8, pics:[] },{ id:7, pics:[P(9)] }],{});
  console.log(fix.trim().split('\n').map((l)=>'   '+l).join('\n'));
  ok(fix.split('\n')[0]==='Handle,Image Src,Image Position'
     &&fix.trim().split('\n').length===4&&fix.indexOf('one-8')<0,
     '★★★写真の直しCSV は Handle と写真の列だけ（写真が無い品・重なりは入れない）');
  ok(!/amazon|media-amazon|mw/i.test(csv+fix),'★★Amazon・MW の画像は入らない');
}

console.log('\n=== ③ 登録：写真の並びを控える ===');
let env=env0(), ID=0;
{
  await setCfg(env,{});
  const r=await api(env,'/one',{ ...ITEM, pics:[P(1),P(2),P(3,{ w:400, h:300 })] });
  ID=r.id;
  ok(r.ok&&r.pics===3,'★★★写真3枚を登録できる');
  const x=await rowOf(env,ID);
  ok(x.pics.map((p)=>p.url).join()===[U(1),U(2),U(3)].join()&&x.pic===true&&x.pic_n===3,
     '★★★並べた順のまま控える（1枚目がメイン）');
  ok(x.pics[2].w===400&&x.pics[2].h===300,'★大きさも控える');
  const many=[]; for(let i=1;i<=11;i++)many.push(P(i));
  const r2=await api(env,'/one',{ id:ID, ...ITEM, pics:many });
  ok(r2.ok===false&&r2.error==='pics_many'&&/10枚/.test(r2.detail),'★★★11枚は断る');
  const r3=await api(env,'/one',{ id:ID, ...ITEM,
    pics:[P(1),{ url:'https://m.media-amazon.com/images/I/abc.jpg' }] });
  ok(r3.ok===false&&r3.error==='pics_url','★★★画像サーバー以外の写真（Amazon など）は断る');
  ok((await rowOf(env,ID)).pics.length===3,'★断ったときは前の並びのまま');
  /* 並べ替え・消す */
  await api(env,'/one',{ id:ID, ...ITEM, pics:[P(3),P(1)] });
  const y=await rowOf(env,ID);
  ok(y.pics.map((p)=>p.url).join()===[U(3),U(1)].join(),'★★★並べ替えと削除が入る');
  /* 写真の並びを送らなければ、いまの写真のまま。 */
  await api(env,'/one',{ id:ID, ...ITEM, price:5000 });
  const z=await rowOf(env,ID);
  ok(z.pics.length===2&&z.price===5000,'★★写真を送らなければ、いまの写真のまま（値段だけ直る）');
  /* 前の形の写真（KV）がある品に並びを送ると、前の写真は片づける。 */
  const o=await api(env,'/one',{ ...ITEM, name:'前の形', pic:'iVBORw0KGgo=', pic_type:'image/png' });
  ok(!!(await env.SYNC_CACHE.get('one:pic:'+o.id)),'★用意：前の形の写真（KV）');
  const pv=await api(env,'/one/pic?id='+o.id);
  ok(pv.ok&&pv.b64==='iVBORw0KGgo='&&pv.type==='image/png',
     '★★★⑤ 前の形の写真を読める（画面が上げ直すため）');
  await api(env,'/one',{ id:o.id, ...ITEM, name:'前の形', pics:[P(5),P(6)] });
  const q=await rowOf(env,o.id);
  ok(!(await env.SYNC_CACHE.get('one:pic:'+o.id))&&q.pic_old===false&&q.pics.length===2,
     '★★★並びを送ったら、前の形の写真（KV）は片づける');
  ok((await api(env,'/one/pic?id='+o.id)).b64==='','★片づけたあとは前の写真は無い');
  const w=await asJson(await worker.fetch((()=>{ const g=get('/one/pic?id='+o.id);
    g.headers.set('X-PJ-Key','worker-key-999'); return g; })(),env,{}));
  ok(w.status===403||w.status===401||(w.body&&w.body.ok===false&&!w.body.b64),
     '★★作業者のキーでは写真を読めない');
}

console.log('\n=== ④ 読み込んだあとに写真を変えたか ===');
{
  let x=await rowOf(env,ID);
  ok(x.pics_changed===false,'★まだ読み込んでいない品は「変えた」にならない');
  await api(env,'/one/mark',{ ids:[ID], loaded:1 });
  x=await rowOf(env,ID);
  ok(x.loaded_at&&x.pics_changed===false,'★★★読み込んだときの並びを控える');
  await api(env,'/one',{ id:ID, ...ITEM, pics:[P(1),P(3),P(4)] });
  x=await rowOf(env,ID);
  ok(x.pics_changed===true,'★★★読み込んだあとに写真を変えると「変えた（Shopify は前のまま）」');
  const m=await api(env,'/one/mark',{ ids:[ID], pics_put:1 });
  x=await rowOf(env,ID);
  ok(m.ok&&x.pics_changed===false,'★★写真の直しCSV を作った印で、また同じになる');
}

console.log('\n=== ⑥ Discord のカード ===');
{
  env=env0();
  await setCfg(env,{});
  const r=await api(env,'/one',{ ...ITEM, pics:[P(1),P(2),P(3)] });
  const id=r.id;
  await api(env,'/one/mark',{ ids:[id], loaded:1 });
  dc=[]; img=[];
  await api(env,'/sub/send',{ approve:true });
  const c1=dc.filter((x)=>x.ch===CH.pre&&x.method==='POST');
  console.log('   添付 '+JSON.stringify(c1[0]&&c1[0].files.map((f)=>f.name)));
  ok(c1.length===1&&c1[0].form&&c1[0].files.length===1,'★★★カードは1枚・添付は1枚だけ');
  ok(c1[0].files[0].bytes==='ffd8ff01d9','★★★添付はメイン（1枚目）の写真');
  const e=c1[0].payload.embeds[0];
  ok(e.image&&e.image.url==='attachment://'+c1[0].files[0].name
     &&/^pic-[0-9a-f]{8}\.jpg$/.test(c1[0].files[0].name),'★★カードの写真は添付を指す');
  const txt=JSON.stringify(c1[0].payload);
  ok(txt.indexOf('pj-img')<0&&txt.indexOf('/i/20261122/')<0,
     '★★★カードに画像サーバー（pj）の URL を出さない');
  ok(!/2,?000|仕入原価|いろは|MW|matchingworld/.test(txt)&&!/@everyone|@here/.test(txt),
     '★★仕入れ先が分かる情報・仕入原価を出さない');
  ok(img.length===1&&img[0]===U(1),'★画像サーバーから読むのはメインの1枚だけ');
  /* 2枚目以降を入れ替えても、カードは書き換えない（メインが同じ）。 */
  await api(env,'/one',{ id, ...ITEM, pics:[P(1),P(3)] });
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  ok(dc.filter((x)=>x.method==='PATCH').length===0,'★★2枚目からを変えても、カードは書き換えない');
  /* メインを入れ替えると、カードの写真も替わる。 */
  await api(env,'/one',{ id, ...ITEM, pics:[P(3),P(1)] });
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  const c2=dc.filter((x)=>x.method==='PATCH');
  ok(c2.length===1&&c2[0].files.length===1&&c2[0].files[0].bytes==='ffd8ff03d9'
     &&JSON.stringify(c2[0].payload.attachments)===JSON.stringify([{ id:0, filename:c2[0].files[0].name }]),
     '★★★メインを入れ替えると、カードの写真も新しいメインに替わる（前の添付と置き換え）');
  /* 写真を全部外すと、添付も外す。 */
  await api(env,'/one',{ id, ...ITEM, pics:[] });
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  const c3=dc.filter((x)=>x.method==='PATCH');
  ok(c3.length===1&&!c3[0].form&&JSON.stringify(c3[0].payload.attachments)==='[]'
     &&!c3[0].payload.embeds[0].image,'★★★写真を全部外すと、カードの写真と添付も外す');
  /* 読めないときは送らない（写真の無いカードにしない）。 */
  const r2=await api(env,'/one',{ ...ITEM, name:'読めない品', pics:[P(8)] });
  await api(env,'/one/mark',{ ids:[r2.id], loaded:1 });
  imgDown=true; dc=[];
  const s2=await api(env,'/sub/send',{ approve:true });
  imgDown=false;
  ok(dc.filter((x)=>x.method==='POST'&&JSON.stringify(x.payload).indexOf('読めない品')>=0).length===0,
     '★★★メインの写真を読めないときは、写真の無いカードで出さない（次の回に回す）');
  ok(s2.ok!==false,'★ほかの配信は止めない');
  dc=[];
  await api(env,'/sub/send',{ approve:true });
  ok(dc.filter((x)=>x.method==='POST'&&JSON.stringify(x.payload).indexOf('読めない品')>=0
     &&x.files.length===1).length===1,'★★読めるようになれば、次の回に写真つきで出る');
  /* 前の形（KV の1枚）の品は今までどおり（出ているカードを書き換えない）。 */
  const env2=env0();
  await setCfg(env2,{});
  const o=await api(env2,'/one',{ ...ITEM, name:'前の形', pic:'iVBORw0KGgo=', pic_type:'image/png' });
  await api(env2,'/one/mark',{ ids:[o.id], loaded:1 });
  dc=[];
  await api(env2,'/sub/send',{ approve:true });
  const c4=dc.filter((x)=>x.method==='POST');
  ok(c4.length===1&&c4[0].files.length===1&&c4[0].files[0].name==='pic.png',
     '★★★前の形の写真の品は今までどおり（pic.png を添付）');
  dc=[];
  await api(env2,'/sub/send',{ approve:true });
  ok(dc.filter((x)=>x.method==='PATCH').length===0,'★★★前の形の品のカードは書き換えない');
  ok(o.ok,'★');
}

console.log('\n=== 決まりを2か所に持たない ===');
{
  const w=read('proxy-sync/worker.js'), h=read('index.html');
  ok(/SHOPCSV\.onePicsOf\(/.test(w)&&!/function onePicsOf/.test(w)&&!/function onePicsOf/.test(h),
     '★★★写真の並びの決まりは shared/shopcsv.js の1か所');
  ok(/SHOPCSV\.ONE_PICS_MAX/.test(w)&&/PJ_SHOPCSV\.ONE_PICS_MAX/.test(h),'★★10枚の数も1か所');
  const mg=read('proxy-sync/migrate-0071-one-pics.sql');
  ok(/ADD COLUMN pics TEXT/.test(mg)&&/ADD COLUMN pics_put TEXT/.test(mg)
     &&!/UPDATE|DELETE|DROP/.test(mg.replace(/--.*$/gm,'')),'★★migrate-0071 は列を足すだけ');
}
T.done();
