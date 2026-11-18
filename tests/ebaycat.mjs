/* Worker：eBay の出品カテゴリを⚙から足す（8.65・カジの依頼）

   新しい種類の商品（Switch 2 のカードポッドなど）を出すたびに、
   **コードを直さずカテゴリを足せる**ようにする。
   ・一覧は D1（ebay_cat）に持つ（PC とスマホで同じものが見える）
   ・探す … Taxonomy API の getCategorySuggestions（英語の商品名で候補）
   ・足す … getItemAspectsForCategory で 名前・道筋・必須の Item specifics
   ・eBay の呼び出しは相場調べと同じアプリの認証（client_credentials）
   ・読み取りだけ（出品はしない）・鍵はログに出さない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：eBay の出品カテゴリ（8.65）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('ebaycat');
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  EBAY_CLIENT_ID:'cid', EBAY_CLIENT_SECRET:'sec' });
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
/* eBay の返りをまねる。 */
let calls=[], tokenNg=0, aspNg=0;
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  calls.push({ url:url, m:String(o.method||'GET'),
               auth:String((o.headers||{}).authorization||'') });
  if(/identity\/v1\/oauth2\/token/.test(url)){
    if(tokenNg)return new Response('no',{status:401});
    return new Response(JSON.stringify({ access_token:'tok-abc',
      expires_in:7200 }),{status:200,
      headers:{'content-type':'application/json'}});
  }
  if(/get_category_suggestions/.test(url)){
    const q=new URL(url).searchParams.get('q')||'';
    return new Response(JSON.stringify({ categorySuggestions:[
      { category:{ categoryId:'183455', categoryName:'Cases, Bags & Travel' },
        categoryTreeNodeAncestors:[
          { categoryName:'Video Game Accessories' },
          { categoryName:'Video Games & Consoles' }] },
      { category:{ categoryId:'139973', categoryName:'Video Games' },
        categoryTreeNodeAncestors:[
          { categoryName:'Video Games & Consoles' }] }],
      q:q }),{status:200,headers:{'content-type':'application/json'}});
  }
  if(/get_item_aspects_for_category/.test(url)){
    if(aspNg)return new Response('ng',{status:404});
    return new Response(JSON.stringify({ aspects:[
      { localizedAspectName:'Brand',
        aspectConstraint:{ aspectRequired:true },
        aspectValues:[{ localizedValue:'Nintendo' },
                      { localizedValue:'Hori' }] },
      { localizedAspectName:'Type',
        aspectConstraint:{ aspectRequired:true },
        aspectValues:[{ localizedValue:'Case' }] },
      { localizedAspectName:'Compatible Platform',
        aspectConstraint:{ aspectRequired:false },
        aspectValues:[{ localizedValue:'Nintendo Switch 2' }] },
      { localizedAspectName:'Color',
        aspectConstraint:{ aspectRequired:false }, aspectValues:[] }] }),
      {status:200,headers:{'content-type':'application/json'}});
  }
  return new Response('{}',{status:200});
};

console.log('=== ① はじめの3つが入っている（初期データ）===');
let env=env0();
{
  const d=await api(env,'/ebay/cat');
  console.log('   '+JSON.stringify((d.rows||[]).map((r)=>r.code+':'+r.ja)));
  ok(d.ok===true&&d.n===3,'★★★はじめから3つ入っている');
  const by={}; (d.rows||[]).forEach((r)=>{ by[r.code]=r; });
  ok(by['139973'].ja==='ゲーム'&&by['261055'].ja==='フィギュア（非可動）'
     &&by['261068'].ja==='フィギュア（可動）',
     '★★★いまの3つ（ゲーム・フィギュア2つ）が名前つきで入っている');
  ok(by['139973'].need.join(',')==='Game Name,Platform',
     '★★ゲームの必須は Game Name と Platform');
  ok(by['261055'].tpl==='261055'&&by['139973'].tpl==='139973',
     '★★はじめの3つは自分の列ヘッダのひな形を使う');
  ok(by['139973'].seed===true,'★はじめから入っている印');
}

console.log('\n=== ② 英語の商品名で候補を探す（getCategorySuggestions）===');
{
  calls=[];
  const d=await api(env,'/ebay/cat/find',
    { q:'Nintendo Switch 2 Card Pod card case' });
  console.log('   '+JSON.stringify(d.rows));
  ok(d.ok===true&&(d.rows||[]).length===2,'★★★候補が返る');
  ok(d.rows[0].code==='183455'
     &&d.rows[0].name==='Cases, Bags & Travel',
     '★★★いちばん上の候補（番号と名前）');
  ok(d.rows[0].path
     ==='Video Games & Consoles > Video Game Accessories > Cases, Bags & Travel',
     '★★★カテゴリの道筋を上から並べる');
  const u=calls.filter((x)=>/get_category_suggestions/.test(x.url))[0]||{};
  ok(/category_tree\/0\//.test(u.url),'★★アメリカのツリー（0）を見る');
  ok(/q=Nintendo\+Switch\+2/.test(u.url)||/q=Nintendo%20Switch/.test(u.url),
     '★★探す言葉を渡す');
  ok(u.auth==='Bearer tok-abc',
     '★★★相場調べと同じアプリの認証（client_credentials）を使う');
  ok(calls.some((x)=>/identity\/v1\/oauth2\/token/.test(x.url)),
     '★★トークンはその場で取る（コードに書かない）');
  ok(!JSON.stringify(d).includes('cid')&&!JSON.stringify(d).includes('sec'),
     '★★★返りに鍵は入らない');
}

console.log('\n=== ③ カテゴリを足す（必須の Item specifics も控える）===');
{
  const d=await api(env,'/ebay/cat/add',{ code:'183455',
    name:'Cases, Bags & Travel', ja:'ゲーム：ケース類',
    path:'Video Games & Consoles > Video Game Accessories > Cases, Bags & Travel' });
  console.log('   '+JSON.stringify({ need:d.need, opt:d.opt }));
  ok(d.ok===true&&d.code==='183455','★★★足せる');
  ok(d.need.join(',')==='Brand,Type',
     '★★★必須の Item specifics（Brand・Type）を取る');
  ok(d.opt.join(',')==='Compatible Platform,Color',
     '★★そのほかの項目も取る');
  const l=await api(env,'/ebay/cat');
  const r=(l.rows||[]).filter((x)=>x.code==='183455')[0]||{};
  console.log('   '+JSON.stringify(r));
  ok(l.n===4&&r.ja==='ゲーム：ケース類','★★★一覧に出る（名前つき）');
  ok(r.need.join(',')==='Brand,Type','★★★一覧でも必須が分かる');
  ok(r.opt.indexOf('Compatible Platform')>=0,
     '★★一覧でそのほかの項目も分かる（列ヘッダに使う）');
  ok(r.path.indexOf('Video Game Accessories')>=0,'★★道筋も残る');
  ok(r.seed===false,'★はじめから入っていない印');
  ok(!!r.at,'★取り直した時刻が入る');
}

console.log('\n=== ④ もう一度足すと取り直す（名前は消さない）===');
{
  const d=await api(env,'/ebay/cat/add',{ code:'183455' });
  ok(d.ok===true,'★★取り直せる');
  const l=await api(env,'/ebay/cat');
  const r=(l.rows||[]).filter((x)=>x.code==='183455')[0]||{};
  ok(r.ja==='ゲーム：ケース類'&&r.name==='Cases, Bags & Travel',
     '★★★名前を渡さなければ、前の名前を残す');
  ok(l.n===4,'★★増えない（同じ番号は1行）');
}

console.log('\n=== ⑤ 外せる（はじめの3つは外せない）===');
{
  const a=await api(env,'/ebay/cat/del',{ code:'139973' });
  ok(a.error==='seed','★★★はじめから入っている3つは外せない');
  const b=await api(env,'/ebay/cat/del',{ code:'183455' });
  ok(b.ok===true,'★★★足したカテゴリは外せる');
  const l=await api(env,'/ebay/cat');
  ok(l.n===3,'★★一覧から消える');
}

console.log('\n=== ⑥ だめなときは理由を返す ===');
{
  const a=await api(env,'/ebay/cat/find',{ q:'' });
  ok(a.error==='bad_q','★★探す言葉が空なら理由を返す');
  const b=await api(env,'/ebay/cat/add',{ code:'' });
  ok(b.error==='bad_code','★★カテゴリ番号が空なら理由を返す');
  aspNg=1;
  const c=await api(env,'/ebay/cat/add',{ code:'999999' });
  console.log('   '+JSON.stringify(c));
  ok(c.error==='api'&&/404/.test(String(c.detail||'')),
     '★★★eBay が断ったら、そのことを返す（登録しない）');
  const l=await api(env,'/ebay/cat');
  ok((l.rows||[]).filter((x)=>x.code==='999999').length===0,
     '★★★取れなかったカテゴリは登録しない');
  aspNg=0;
  /* トークンは控えてあるので、**新しい env**（控えが空）で確かめる。 */
  tokenNg=1;
  const e3=env0();
  const d=await api(e3,'/ebay/cat/find',{ q:'card case' });
  console.log('   '+JSON.stringify(d).slice(0,200));
  ok(d.error==='api'&&/認証/.test(String(d.detail||'')),
     '★★★アプリの認証が取れないときも理由を返す');
  ok(!JSON.stringify(d).includes('sec'),'★★★理由に鍵は入らない');
  tokenNg=0;
}

console.log('\n=== ⑦ 変えるのは管理者だけ（見るのは作業者でもよい）===');
{
  const req=(path,body)=>new Request('https://x'+path,
    { method:body?'POST':'GET',
      headers:Object.assign({'X-PJ-Key':'staff-key-123'},
        body?{'content-type':'application/json'}:{}),
      body:body?JSON.stringify(body):undefined });
  const a=await asJson(await worker.fetch(req('/ebay/cat'),env,{}));
  ok(a.status===200&&a.body.ok===true,
     '★★★一覧は作業者でも見られる（出品CSV を出すのに要る）');
  const b=await asJson(await worker.fetch(req('/ebay/cat/add',
    { code:'183455' }),env,{}));
  ok(b.status===403,'★★★足すのは管理者だけ');
  const c=await asJson(await worker.fetch(req('/ebay/cat/del',
    { code:'183455' }),env,{}));
  ok(c.status===403,'★★★外すのも管理者だけ');
  /* 候補を探すのは作業者でもよい（③「写真・原産国・カテゴリ」の仕事なので、
     作業者の端末で使えないと流れが止まる。番号と項目の名前だけで、
     値段も会員の情報も出ない）。 */
  const d=await asJson(await worker.fetch(req('/ebay/cat/find',
    { q:'card case' }),env,{}));
  ok(d.status===200&&d.body.ok===true,
     '★★★候補を探すのは作業者でもよい（値段は出ない）');
}

console.log('\n=== ⑧ 表が無い D1 でも落ちない ===');
{
  const { worker:w2 }=await loadWorker('ebaycat-notable');
  const e2=env0();
  await e2.DB.prepare(`DROP TABLE IF EXISTS ebay_cat`).run();
  const d=(await asJson(await w2.fetch(get('/ebay/cat'),e2,{}))).body;
  ok(d.error==='no_table'&&/migrate-0066/.test(String(d.detail||'')),
     '★★★表が無ければ、流すマイグレーションを教える');
}

console.log('\n=== ⑨ 許可表（読み取りだけ）===');
{
  const okUrl=(m,u)=>{ try{ W.assertReadOnly(u,m,{},false); return true; }
                       catch(e){ return false; } };
  ok(okUrl('GET','https://api.ebay.com/commerce/taxonomy/v1/category_tree/0'
    +'/get_category_suggestions?q=card%20case'),
     '★★★候補を探す口は許可表に入っている');
  ok(okUrl('GET','https://api.ebay.com/commerce/taxonomy/v1/category_tree/0'
    +'/get_item_aspects_for_category?category_id=183455'),
     '★★★項目を取る口も入っている');
  ok(!okUrl('POST','https://api.ebay.com/commerce/taxonomy/v1/category_tree/0'
    +'/get_category_suggestions?q=x'),
     '★★★POST は許していない（読み取りだけ）');
}

T.done();
