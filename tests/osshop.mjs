/* Worker：直しCSV のために os- の商品を Shopify から読む（8.98・v346）

   カジの報告（2026-11-23）
   ① 上書きインポートは Title が必須（無いと「商品名の列は必須です」）
   ③ GET /os/px に、ストアで公開していない商品（4260650747380）が入っていた
      → os_item は「Shopify 用CSV を書き出したとき」に控えるので、下書きのまま・
        読み込んでいない・消した商品も残る
   直し：GET /os/px・/os/diff・/os/list に、いまの Shopify の題名・状態・オンラインストアへの
   公開（shop）を足す。読むだけ（何も書き込まない）。os- だけ（会員用は扱わない）。 */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：os- の商品を Shopify から読む（8.98）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('osshop');

let gql=[], prods={}, pageSize=2;
const ONLINE='gid://shopify/Publication/9';
const J=(v)=>new Response(JSON.stringify(v),{status:200,headers:{'content-type':'application/json'}});
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/oauth\/access_token/.test(url))return J({ access_token:'shpat-SECRET', expires_in:86399, scope:'read_products' });
  if(/myshopify\.com\/admin\/api\//.test(url)){
    const b=JSON.parse(String(o.body||'{}'));
    const name=(/(?:query|mutation)\s+(\w+)/.exec(b.query)||[])[1]||'';
    gql.push({ name, v:b.variables, q:b.query });
    if(name==='pjReady')return J({ data:{ shop:{ name:'店' },
      locations:{ nodes:[{ id:'gid://shopify/Location/1', name:'本店' }] },
      publications:{ nodes:[{ id:ONLINE, supportsFuturePublishing:true, catalog:{ title:'オンラインストア' } }] } } });
    if(name==='pjOsList'){
      /* タグ export の商品（会員用が混じっていても os- だけを使う）。 */
      const all=Object.keys(prods).filter((h)=>prods[h].tag!==false).sort();
      const from=b.variables.after?+b.variables.after:0;
      const page=all.slice(from,from+pageSize);
      return J({ data:{ products:{ nodes:page.map((h)=>({ handle:h, title:prods[h].title,
        status:prods[h].status, on:prods[h].on!==false })),
        pageInfo:{ hasNextPage:from+pageSize<all.length, endCursor:String(from+pageSize) } } } });
    }
    if(name==='pjOsOne'){
      const h=b.variables.identifier.handle, p=prods[h];
      return J({ data:{ productByIdentifier:p?{ handle:h, title:p.title, status:p.status, on:p.on!==false }:null } });
    }
    return J({ data:{} });
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  return J({});
};
const env0=(x)=>makeEnv(Object.assign({ STAFF_KEY:'staff-key-123',
  SHOPIFY_CLIENT_ID:'cid', SHOPIFY_CLIENT_SECRET:'csec-SECRET' },x||{}));
const setCfg=(env)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,'x')
   ON CONFLICT(k) DO UPDATE SET v=excluded.v`)
  .bind(JSON.stringify({ at:'x', settings:{ subDomain:'omakase-ship.myshopify.com' } })).run();
const api=async(env,path,body)=>(await asJson(await worker.fetch(body?post(path,body):get(path),env,{}))).body;
const JS=['4902370550467','4902370550474','4260650747380','4902370550481','4902370550498'];
const seed=async(env)=>{
  await api(env,'/os/put',{ items:JS.map((j,i)=>({ jan:j, name:'Game '+i+' '+'x'.repeat(130), usd:40, fx:160,
    pct:100, price:6400, qty:1, wholesale:3000, stock:5 })) });
};

console.log('=== GET /os/px に Shopify の題名・状態 ===');
{
  W.shopReset(); gql=[];
  prods={
    'os-4902370550467':{ title:'Octopath Traveler 0 Nintendo Switch Japan, Long Title', status:'ACTIVE' },
    'os-4902370550474':{ title:'Game Two', status:'ACTIVE', on:false },          // オンラインストアに出ていない
    'os-4260650747380':{ title:'Draft One', status:'DRAFT' },                   // 下書きのまま
    'os-4902370550481':{ title:'Untagged', status:'ACTIVE', tag:false },         // タグが無い（1件ずつ見る）
    'sub-4902370550467':{ title:'会員用', status:'UNLISTED' } };                // 会員用（扱わない）
  /* os-4902370550498 は Shopify に無い。 */
  const env=env0(); await setCfg(env); await seed(env);
  const d=await api(env,'/os/px');
  const by=(j)=>d.rows.filter((x)=>x.jan===j)[0].shop;
  console.log('   '+JSON.stringify(d.rows.map((x)=>x.jan.slice(-3)+':'+(x.shop&&x.shop.status)+':'+(x.shop&&x.shop.live))));
  ok(d.ok&&d.shop_ok===true,'★★Shopify の状態を読めた');
  ok(by(JS[0]).status==='ACTIVE'&&by(JS[0]).live===true
     &&by(JS[0]).title==='Octopath Traveler 0 Nintendo Switch Japan, Long Title',
     '★★★公開中（ACTIVE・オンラインストア）といまの題名（控えの 120文字で切れた名前ではない）');
  ok(by(JS[1]).live===false&&by(JS[1]).on===false,'★★オンラインストアに出ていない商品は公開ではない');
  ok(by(JS[2]).status==='DRAFT'&&by(JS[2]).live===false,'★★★下書き（4260650747380 のような商品）は公開ではない');
  ok(by(JS[3]).status==='ACTIVE'&&by(JS[3]).title==='Untagged','★★タグが無い商品も Handle で1件ずつ見つける');
  ok(by(JS[4]).status==='MISSING'&&by(JS[4]).live===false,'★★Shopify に無い商品は MISSING');
  ok(gql.filter((x)=>x.name==='pjOsList').length===2,'★まとめて読む（ページに分けて続きも読む）');
  ok(gql.every((x)=>/^query /.test(String(x.q||'').trim())),'★★★読むだけ（何も書き込まない）');
  ok(gql.filter((x)=>x.name==='pjOsList').every((x)=>x.v.q==='tag:export'),'★Shopify 用CSV が付けるタグ（export）で読む');
  ok(!JSON.stringify(d).includes('会員用'),'★★★会員用（sub-）は扱わない');
  ok(!/shpat-SECRET|csec-SECRET/.test(JSON.stringify(d)),'★★鍵は返さない');
  /* /os/list・/os/diff にも題名を付ける。 */
  const l=await api(env,'/os/list');
  ok(l.ok&&l.shop_ok&&l.rows.filter((x)=>x.jan===JS[0])[0].shop.title.indexOf('Octopath')===0,'★★/os/list にも題名（販売元の直しCSV の Title）');
  await env.DB.prepare(`UPDATE os_item SET fix_at='x', fix_why='gone', fix_qty=0 WHERE jan=?1`).bind(JS[0]).run();
  const df=await api(env,'/os/diff');
  ok(df.ok&&df.shop_ok&&df.rows[0].shop.title.indexOf('Octopath')===0,'★★/os/diff にも題名（在庫の直しCSV の Title）');
}

console.log('\n=== Shopify の鍵が無いとき ===');
{
  W.shopReset();
  const env=makeEnv({ STAFF_KEY:'staff-key-123' }); await setCfg(env); await seed(env);
  const d=await api(env,'/os/px');
  ok(d.ok===true&&d.shop_ok===false&&/鍵/.test(d.shop_why)&&d.rows.every((x)=>x.shop===null),
     '★★★読めないときは shop_ok=false と理由（画面は値段の直しCSV を作らない）');
}

console.log('\n=== osShopOf ===');
{
  const m={ 'os-1':{ status:'ACTIVE', title:'A', on:true }, 'os-2':{ status:'UNLISTED', title:'B', on:true } };
  ok(W.osShopOf(m,'OS-1').live===true&&W.osShopOf(m,'os-2').live===false&&W.osShopOf(m,'os-3').live===false,
     '★★公開＝ACTIVE かつオンラインストア（非公開・無い商品は公開ではない）');
}

T.done();
