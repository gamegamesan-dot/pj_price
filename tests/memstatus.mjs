/* 決まり・Worker：会員用・1点ものの Status（8.88）

   カジの報告（2026-11-22）1点もの（one-）と会員用（sub-）の Shopify 用 CSV を
   取り込むと、一般のストアの一覧・検索・海外向けカタログに出てしまった。
   原因：CSV に Status の列が無いと、Shopify は新しい商品を active にする。
   CSV の Status に入れられるのは active／draft／archived だけ（unlisted は無い）。
   カジの決定：CSV は draft で出し、取り込んだあと pj-sync が管理 API で
   UNLISTED にする（海外向けカタログからも外す）。

   ① CSV：まだ入れていない商品は Status＝draft・読み込み済みは Status の列なし
   ② 海外向けの os- の CSV は変えない
   ③ POST /shop/unlist：確かめるだけ（何も変えない）／直す（UNLISTED・
      オンラインストアに公開・海外向けカタログから外す）・ARCHIVED と
      Shopify に無い商品は触らない・os- は見ない・続きから・作業者は使えない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const S=require('../shared/shopcsv.js');
const O=require('../shared/osscsv.js');
const T=harness('決まり・Worker：会員用・1点ものの Status（8.88）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('memstatus');

const cells=(t)=>S.splitCsv(t);
const col=(t,name)=>{ const r=cells(t), i=r[0].indexOf(name);
  return i<0?null:r.slice(1).map((x)=>x[i]); };
const IT={ jan:'4902370550467', name:'スーパーマリオパーティ ジャンボリー',
  asin:'B0D1GSZJ8T', kishu:'NS', price:5300, max_qty:3, size_g:110, grades:'light' };
const ONE={ id:3, name:'秋葉原の1点もの', cond:'中古', price:4800, qty:1,
  ship_kind:'small', grades:'premium', pics:[] };

console.log('=== ① CSV の Status ===');
{
  const a=S.build([IT],{ status:S.MEMBER_STATUS });
  const b=S.oneBuild([ONE],{ status:S.MEMBER_STATUS, images:true });
  console.log('   sub-（まだ）Status='+JSON.stringify(col(a,'Status'))
    +'　one-（まだ）Status='+JSON.stringify(col(b,'Status')));
  ok(S.MEMBER_STATUS==='draft','★★★会員用・1点ものの Status は draft（CSV に入れられる値）');
  ok(JSON.stringify(col(a,'Status'))==='["draft"]','★★★sub-：まだ入れていない商品は Status＝draft');
  ok(JSON.stringify(col(b,'Status'))==='["draft"]','★★★one-：まだ入れていない商品も Status＝draft');
  const h=cells(a)[0];
  ok(h.indexOf('Status')===h.indexOf('Published')+1,'★Status は Published のすぐうしろ');
  ok(col(S.build([IT],{}),'Status')===null&&col(S.oneBuild([ONE],{}),'Status')===null,
     '★★★読み込み済みの商品の CSV には Status の列を出さない（いまの非公開を崩さない）');
  ok(S.statusOf({ status:'unlisted' })===''&&col(S.build([IT],{ status:'unlisted' }),'Status')===null,
     '★★★CSV に入れられない値（unlisted）は出さない（取り込みが失敗しないように）');
  ok(S.statusOf({ status:'Draft' })==='draft','★大文字でも読む');
  /* 1点ものの写真の行には Status を入れない（空）。 */
  const c=S.oneBuild([Object.assign({},ONE,{ pics:[
    { url:'https://pj-img.example.workers.dev/i/20261122/00000001-0000-4000-8000-000000000000.jpg' },
    { url:'https://pj-img.example.workers.dev/i/20261122/00000002-0000-4000-8000-000000000000.jpg' }] })],
    { status:'draft', images:true });
  ok(JSON.stringify(col(c,'Status'))==='["draft",""]','★写真だけの行の Status は空（商品の行だけ）');
  ok(S.INV_COLS.indexOf('Status')<0,'★在庫CSV は今までどおり Status を触らない');
}

console.log('\n=== ② 海外向けの os- は変えない ===');
{
  const it={ jan:'4902370550467', titleEn:'Super Mario Party Jamboree Nintendo Switch Japan',
    kishu:'NS', vendor:'Nintendo', type:'Video Game', usd:49.99, qty:1, grams:120, cost:3000,
    pics:[{ url:'https://pj-img.example.workers.dev/i/20261122/00000001-0000-4000-8000-000000000000.jpg' }] };
  const act=O.build([it],{ fx:150, pct:100, status:'active' });
  const dr=O.build([it],{ fx:150, pct:100 });
  console.log('   os-（⚙ 公開）Status='+JSON.stringify(col(act,'Status'))
    +'　os-（⚙ 既定）Status='+JSON.stringify(col(dr,'Status')));
  ok(col(act,'Status')[0]==='active','★★★os- は⚙「公開」のとき今までどおり active');
  ok(col(dr,'Status')[0]==='draft','★os- の既定（⚙ 下書き）も今までどおり');
  ok(!/member-list|grade-/.test(act),'★os- に会員の印は付かない');
}

/* ---- 作り物の Shopify ---- */
let gql=[], prods={}, failUpd={};
const OVER='gid://shopify/Publication/3', ONLINE='gid://shopify/Publication/9';
const J=(v,st)=>new Response(JSON.stringify(v),{status:st||200,
  headers:{'content-type':'application/json'}});
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/myshopify\.com\/admin\/oauth\/access_token/.test(url))
    return J({ access_token:'shpat-SECRET', expires_in:86399, scope:'x' });
  if(/myshopify\.com\/admin\/api\//.test(url)){
    const b=JSON.parse(String(o.body||'{}'));
    const name=(/(?:query|mutation)\s+(\w+)/.exec(b.query)||[])[1]||'';
    gql.push({ name, v:b.variables, q:b.query });
    if(name==='pjReady')return J({ data:{ shop:{ name:'店' },
      locations:{ nodes:[{ id:'gid://shopify/Location/1', name:'本店' }] },
      publications:{ nodes:[
        { id:ONLINE, supportsFuturePublishing:true, catalog:{ title:'オンラインストア' } },
        { id:OVER, supportsFuturePublishing:false, catalog:{ title:'Overseas products' } }] } } });
    if(name==='pjStat'){
      const h=b.variables.identifier.handle, p=prods[h];
      if(!p)return J({ data:{ productByIdentifier:null } });
      return J({ data:{ productByIdentifier:{ id:'gid://shopify/Product/'+h, handle:h,
        status:p.status, ov0:!!p.over } } });
    }
    if(name==='pjUnlist'){
      const h=b.variables.product.id.split('/').pop();
      if(failUpd[h])return J({ data:{ productUpdate:{ product:null,
        userErrors:[{ field:['status'], message:'Status is invalid' }] } } });
      prods[h].status=b.variables.product.status;
      return J({ data:{ productUpdate:{ product:{ id:b.variables.product.id,
        status:prods[h].status }, userErrors:[] } } });
    }
    if(name==='pjPub'){ const h=b.variables.id.split('/').pop(); prods[h].online=true;
      return J({ data:{ publishablePublish:{ userErrors:[] } } }); }
    if(name==='pjUnpub'){ const h=b.variables.id.split('/').pop();
      if(b.variables.pub===OVER)prods[h].over=false;
      return J({ data:{ publishableUnpublish:{ userErrors:[] } } }); }
    return J({ data:{} });
  }
  return J({});
};
const NOW=new Date().toISOString();
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123', WORKER_KEY:'worker-key-999',
  SHOPIFY_CLIENT_ID:'cid', SHOPIFY_CLIENT_SECRET:'csec-SECRET' });
const setCfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:NOW, settings:Object.assign({
    subDomain:'omakase-ship.myshopify.com' },o||{}) }),NOW).run();
const api=async(env,path,body,key)=>{
  const r=body?post(path,body):get(path);
  if(key)r.headers.set('X-PJ-Key',key);
  return await asJson(await worker.fetch(r,env,{}));
};
const sub=async(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
   VALUES (?1,?2,3,3645,'light',?3,?4,?5,?5)`)
  .bind(jan,(o||{}).on===0?0:1,(o||{}).put===false?null:NOW,(o||{}).loaded?NOW:null,NOW).run();
const one=async(env,id,o)=>env.DB.prepare(
  `INSERT INTO one_item (id,handle,name,price,qty,off,at,created_at)
   VALUES (?1,?2,'1点もの',4800,1,?3,?4,?4)`).bind(id,'one-'+id,(o||{}).off?1:0,NOW).run();

console.log('\n=== ③ 非公開（Unlisted）にそろえる ===');
{
  const env=env0(); await setCfg(env,{});
  await sub(env,'4902370550467',{ loaded:true });
  await sub(env,'4902370550474');
  await sub(env,'4902370550481');
  await sub(env,'4902370550498',{ on:0 });                // 印を外した商品は見ない
  await sub(env,'4902370550504',{ put:false });           // まだ CSV に出していない
  await one(env,1); await one(env,2); await one(env,9,{ off:1 });
  prods={ 'sub-4902370550467':{ status:'ACTIVE', over:true },     // 出てしまった商品
          'sub-4902370550474':{ status:'DRAFT', over:true },      // draft で取り込んだ
          'sub-4902370550481':{ status:'UNLISTED', over:false },  // もう非公開
          'one-1':{ status:'ACTIVE', over:true },
          'one-2':{ status:'ARCHIVED', over:false },
          'os-4902370550467':{ status:'ACTIVE', over:true } };   // 海外向け（触らない）
  gql=[];
  let r=(await api(env,'/shop/unlist',{ kind:'all', approve:false })).body;
  console.log('   確かめる '+JSON.stringify({ all:r.all, unlisted:r.unlisted, active:r.active,
    draft:r.draft, archived:r.archived, missing:r.missing, over_in:r.over_in, need:r.need }));
  ok(r.ok&&r.approve===false,'★確かめるだけの返り');
  ok(r.all===5&&r.active===2&&r.draft===1&&r.unlisted===1&&r.archived===1&&r.missing===0,
     '★★★sub-（印あり・CSV に出したもの）と one-（取り下げ以外）の状態を数える');
  ok(r.need===3&&r.over_in===3,'★★★直す必要がある 3件（active 2・draft 1）・海外向けカタログに 3件');
  ok(gql.every((x)=>/^(pjReady|pjStat)$/.test(x.name)),'★★★確かめるときは読むだけ（何も変えない）');
  ok(gql.filter((x)=>x.name==='pjStat').every((x)=>/^(sub|one)-\d+$/.test(x.v.identifier.handle)),
     '★★★見るのは sub-・one- の Handle だけ（os- は見ない）');
  ok(prods['sub-4902370550467'].status==='ACTIVE','★まだ何も変わっていない');
  gql=[];
  r=(await api(env,'/shop/unlist',{ kind:'all', approve:true })).body;
  console.log('   直す '+JSON.stringify({ done:r.done, fail:r.fail, left:r.left }));
  ok(r.ok&&r.done===3&&r.fail===0,'★★★3件を直す');
  ok(prods['sub-4902370550467'].status==='UNLISTED'&&prods['sub-4902370550474'].status==='UNLISTED'
     &&prods['one-1'].status==='UNLISTED','★★★active・draft → 非公開（UNLISTED）');
  ok(prods['sub-4902370550467'].over===false&&prods['sub-4902370550474'].over===false
     &&prods['one-1'].over===false,'★★★海外向けカタログから外す');
  ok(prods['sub-4902370550467'].online===true,'★★リンクで開けるよう、オンラインストアには公開する');
  ok(prods['one-2'].status==='ARCHIVED','★★アーカイブの商品は触らない');
  ok(prods['os-4902370550467'].status==='ACTIVE'&&prods['os-4902370550467'].over===true,
     '★★★海外向けの os- の商品は今までどおり active（触らない）');
  ok(gql.filter((x)=>x.name==='pjUnlist').every((x)=>Object.keys(x.v.product).sort().join()==='id,status'
     &&x.v.product.status==='UNLISTED'),'★★送るのは Status だけ（値段・在庫・説明は触らない）');
  const again=(await api(env,'/shop/unlist',{ kind:'all', approve:false })).body;
  ok(again.need===0&&again.unlisted===4,'★★★直したあとは直す必要が 0件');
  /* kind で絞る */
  prods['one-1'].status='ACTIVE';
  const s1=(await api(env,'/shop/unlist',{ kind:'sub', approve:false })).body;
  const o1=(await api(env,'/shop/unlist',{ kind:'one', approve:false })).body;
  ok(s1.all===3&&s1.need===0&&o1.all===2&&o1.need===1,'★★sub- だけ・one- だけでも見られる');
  /* Shopify に無い商品（まだ取り込んでいない） */
  delete prods['sub-4902370550481'];
  const m=(await api(env,'/shop/unlist',{ kind:'sub', approve:true })).body;
  ok(m.missing===1&&m.fail===0,'★★Shopify に無い商品は飛ばす（数だけ出す）');
  /* 直せなかったとき */
  prods['sub-4902370550467'].status='ACTIVE'; failUpd['sub-4902370550467']=1;
  const f=(await api(env,'/shop/unlist',{ kind:'sub', approve:true })).body;
  ok(f.fail===1&&/Status is invalid/.test(f.errors.join(''))&&prods['sub-4902370550467'].status==='ACTIVE',
     '★★できなかった商品は理由を返す');
  failUpd={};
  /* 作業者のキー */
  const w=await api(env,'/shop/unlist',{ kind:'all', approve:true },'worker-key-999');
  ok(w.status===403||w.status===401||(w.body&&w.body.ok===false),'★★★作業者のキーでは使えない');
  /* 鍵が無いとき */
  W.shopReset();                       // 前の店の控え（10分）を消す
  const env2=makeEnv({ STAFF_KEY:'staff-key-123' }); await setCfg(env2,{});
  const k=(await api(env2,'/shop/unlist',{ kind:'all', approve:true })).body;
  ok(k.ok===false&&k.error==='shop'&&!/csec-SECRET|shpat-SECRET/.test(JSON.stringify(k)),
     '★★Shopify の鍵が無ければ、そう言う（鍵は出さない）');
}

console.log('\n=== 続きから（多いとき）===');
{
  const env=env0(); await setCfg(env,{});
  prods={};
  for(let i=0;i<6;i++){ const j='49023705'+String(60000+i); await sub(env,j);
    prods['sub-'+j]={ status:'ACTIVE', over:false }; }
  const r1=(await api(env,'/shop/unlist',{ kind:'sub', approve:true, from:0 })).body;
  ok(r1.done===6&&r1.left===0&&r1.next===6,'★次の番号（next）と残り（left）を返す');
  const r2=(await api(env,'/shop/unlist',{ kind:'sub', approve:false, from:4 })).body;
  ok(r2.checked===2&&r2.next===6,'★★from から続きを見る');
}
T.done();
