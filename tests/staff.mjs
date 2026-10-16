/* Worker：作業者用のキー（STAFF_KEY・7.40）
   ・管理者（PJ_ACCESS_KEY）は今までどおり全部できる
   ・作業者（STAFF_KEY）ができる：取り込み（読み取り）・名簿の送信・英題生成・写真
   ・作業者ができない：設定の送信／手動実行（まとめて実行）／見直しの目標と
     自動値下げの設定 → 403 forbidden_for_staff
   ・どちらとも違うキー・キー無しは 401（今までどおり） */
import { harness, makeEnv, makeKV, get, post, asJson } from './lib.mjs';
import { DatabaseSync } from 'node:sqlite';
const T=harness('Worker：作業者用のキー（STAFF_KEY）');
const ok=T.ok;
const sync=await import('file://'+process.cwd()+'/proxy-sync/worker.js?staff=1');
const title=await import('file://'+process.cwd()+'/proxy-title/worker.js?staff=1');
const img=await import('file://'+process.cwd()+'/proxy-img/worker.js?staff=1');

const env=makeEnv({ STAFF_KEY:'staff-key-123' });   // 管理者は 'k'（makeEnv の既定）
const now=new Date().toISOString();
await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_item_id,ebay_qty,
  ebay_price,updated_at) VALUES ('B0STAFF001','used','ebay','テスト商品','771234',1,20,?1)`)
  .bind(now).run();

const H=(k)=>({'X-PJ-Key':k,'content-type':'application/json'});
const req=(path,key,body)=>new Request('https://x'+path,
  body?{method:'POST',headers:H(key),body:JSON.stringify(body)}:{headers:H(key)});
const call=async(path,key,body)=>asJson(await sync.default.fetch(req(path,key,body),env));
const ADMIN='k', STAFF='staff-key-123';

console.log('=== キーの役割（keyRole）===');
const role=(k)=>sync.__test.keyRole(new Request('https://x',{headers:{'X-PJ-Key':k}}),env);
console.log('   admin: '+JSON.stringify(role(ADMIN))+'／staff: '+JSON.stringify(role(STAFF))
  +'／違うキー: '+JSON.stringify(role('zzz'))+'／空: '+JSON.stringify(role('')));
ok(role(ADMIN)==='admin','★管理者のキーは admin');
ok(role(STAFF)==='staff','★作業者のキーは staff');
ok(role('zzz')===''&&role('')==='','★違うキー・空はどちらでもない');
ok(sync.__test.keyRole(new Request('https://x',{headers:{'X-PJ-Key':'staff-key-123'}}),
   makeEnv())==='' ,'★STAFF_KEY を登録していない Worker では作業者キーは通らない');
ok(sync.__test.eqKey('abc','abc')===true&&sync.__test.eqKey('abc','abd')===false
   &&sync.__test.eqKey('abc','abcd')===false&&sync.__test.eqKey('','')===false,
   '★キーの照合は長さも中身も見る（空は通さない）');

console.log('\n=== /whoami でどちらのキーかを返す ===');
let r=await call('/whoami',STAFF);
console.log('   staff: '+JSON.stringify(r.body));
ok(r.status===200&&r.body.role==='staff'&&r.body.staff_key_set===true,
   '★作業者のキーなら role=staff を返す');
r=await call('/whoami',ADMIN);
ok(r.status===200&&r.body.role==='admin','★管理者のキーなら role=admin');
r=await call('/whoami','zzz');
ok(r.status===401&&r.body.error==='unauthorized','★違うキーは 401');
ok(!JSON.stringify(r.body).includes('staff-key-123')
   &&!JSON.stringify((await call('/whoami',STAFF)).body).includes('staff-key-123'),
   '★キーそのものは返さない');

console.log('\n=== 作業者ができること ===');
r=await call('/status',STAFF);
console.log('   /status: '+r.status+'（'+(r.body.items||[]).length+'件）');
ok(r.status===200&&(r.body.items||[]).length===1,'★状況の取り込み（読み取り）はできる');
r=await call('/runs',STAFF);
ok(r.status===200,'★実行ログの読み取りもできる');
r=await call('/settings',STAFF);
ok(r.status===200&&r.body.ok===true,
   '★設定の**読み取り**はできる（同じ値付けで計算するため）');
r=await call('/listings',STAFF,{items:[{sku:'game-20260101-UG-B0STAFF001-1200',
  asin:'B0STAFF001',cond:'used',item_id:'771234',title:'テスト商品',
  on_hand:true,weight_g:150,cost_yen:1200,sold_usd:30}]});
console.log('   名簿: '+r.status+' '+JSON.stringify(r.body.accepted));
ok(r.status===200&&r.body.accepted===1,'★名簿の送信（実重量・仕入値・相場つき）はできる');
const row=await env.DB.prepare(
  'SELECT on_hand,weight_g,cost_yen,sold_usd FROM items WHERE asin=?1')
  .bind('B0STAFF001').first();
console.log('   入った値: '+JSON.stringify(row));
ok(row.weight_g===150&&row.cost_yen===1200&&row.sold_usd===30,
   '★送った名簿の中身は今までどおり入る');
r=await call('/lowest',STAFF,{items:[]});
ok(r.status===200,'★最安値の取り寄せ（読み取り）もできる');

console.log('\n=== 作業者ができないこと（403）===');
r=await call('/settings',STAFF,{at:new Date(Date.now()+1000).toISOString(),
  settings:{autoMdMode:'on',autoRvMode:'auto'}});
console.log('   /settings: '+r.status+' '+JSON.stringify(r.body));
ok(r.status===403&&r.body.error==='forbidden_for_staff','★設定の送信は 403');
ok(/管理者用のキーが必要/.test(r.body.detail||''),'★理由を返す');
const st=await sync.__test.settingsGet(env);
ok(!st.settings.autoMdMode,'★断った設定は D1 に入らない');
for(const kind of ['markdown','review','orders','onhand-clean','notify']){
  r=await call('/sync',STAFF,{kind:kind});
  ok(r.status===403&&r.body.error==='forbidden_for_staff','★手動実行（'+kind+'）は 403');
}
r=await call('/sync',STAFF,{kind:'review',approve:true});
ok(r.status===403,'★「まとめて実行」（approve）も 403');
r=await call('/listings',STAFF,{items:[{asin:'B0STAFF001',cond:'used',
  item_id:'771234',rv_want:30.28,rv_floor:26.59,rv_kind:'none',rv_max_cost:2560}]});
console.log('   見直しの目標: '+r.status+' '+JSON.stringify(r.body));
ok(r.status===403&&r.body.error==='forbidden_for_staff','★見直しの目標の送信は 403');
ok((r.body.fields||[]).join()==='rv_want,rv_floor,rv_kind,rv_max_cost',
   '★どの項目が断られたかを返す');
r=await call('/listings',STAFF,{items:[{asin:'B0STAFF001',cond:'used',
  item_id:'771234',md_step:2.5,md_start:85,md_floor:60,md_n:10}]});
ok(r.status===403&&(r.body.fields||[]).indexOf('md_step')>=0,
   '★自動値下げの設定の送信も 403');
const keep=await env.DB.prepare('SELECT rv_want,md_step FROM items WHERE asin=?1')
  .bind('B0STAFF001').first();
console.log('   D1: '+JSON.stringify(keep));
ok(keep.rv_want===null&&keep.md_step===null,'★断った回は D1 に1件も書かない');
r=await call('/listings',STAFF,{items:[{asin:'B0STAFF001',cond:'used',item_id:'771234',
  title:'テスト商品',on_hand:true},{asin:'B0STAFF001',cond:'used',rv_want:30}]});
ok(r.status===403,'★名簿に1件でも混ざっていたら、その回ぜんぶを断る');

console.log('\n=== 管理者は今までどおり ===');
r=await call('/settings',ADMIN,{at:new Date(Date.now()+2000).toISOString(),
  settings:{autoMdMode:'plan',autoRvMode:'confirm'}});
ok(r.status===200&&r.body.stored===true,'★設定の送信ができる');
r=await call('/listings',ADMIN,{items:[{asin:'B0STAFF001',cond:'used',
  item_id:'771234',rv_want:30.28,rv_floor:26.59,rv_kind:'none',rv_max_cost:2560}]});
const adm=await env.DB.prepare('SELECT rv_want,rv_kind FROM items WHERE asin=?1')
  .bind('B0STAFF001').first();
console.log('   '+r.status+' '+JSON.stringify(adm));
ok(r.status===200&&adm.rv_want===30.28&&adm.rv_kind==='none',
   '★見直しの目標も送れる（D1 に入る）');
globalThis.fetch=async(u)=>{ throw new Error('外には出ない: '+u); };
r=await call('/sync',ADMIN,{kind:'review'});
ok(r.status===200,'★手動実行もできる');

console.log('\n=== pj-title：英題の生成は作業者も使える ===');
const tRole=(k,e)=>title.__test.keyRole(new Request('https://x',
  {headers:{'X-PJ-Key':k}}),e||{PJ_ACCESS_KEY:'k',STAFF_KEY:'staff-key-123'});
console.log('   admin: '+tRole('k')+'／staff: '+tRole('staff-key-123')
  +'／違うキー: '+JSON.stringify(tRole('zzz')));
ok(tRole('k')==='admin'&&tRole('staff-key-123')==='staff'&&tRole('zzz')==='',
   '★管理者・作業者のどちらのキーも通る（違うキーは通らない）');
const tEnv={ PJ_ACCESS_KEY:'k', STAFF_KEY:'staff-key-123', TITLE_CACHE:makeKV() };
const tRes=await title.default.fetch(new Request('https://x/titles',
  {method:'POST',headers:H('staff-key-123'),body:JSON.stringify({items:[]})}),tEnv);
console.log('   /titles（作業者・APIキー未設定の環境）: '+tRes.status);
ok(tRes.status!==401,'★作業者のキーで 401 にならない（先に進む）');
const tNg=await title.default.fetch(new Request('https://x/titles',
  {method:'POST',headers:H('zzz'),body:'{}'}),tEnv);
ok(tNg.status===401,'★違うキーは 401');

console.log('\n=== pj-img：写真の送信は作業者も使える ===');
const iEnv={ UPLOAD_TOKEN:'tok', STAFF_KEY:'staff-key-123',
  IMG:{ _m:new Map(),
    async put(k,v,o){ this._m.set(k,{v:v,o:o}); },
    async list(){ return { objects:[], truncated:false }; },
    async delete(k){ this._m.delete(k); },
    async get(){ return null; } } };
const bearer=(t)=>({ 'Authorization':'Bearer '+t });
const iRole=(t)=>img.__test.tokenRole(new Request('https://x',{headers:bearer(t)}),iEnv);
console.log('   admin: '+iRole('tok')+'／staff: '+iRole('staff-key-123')
  +'／違うトークン: '+JSON.stringify(iRole('zzz')));
ok(iRole('tok')==='admin'&&iRole('staff-key-123')==='staff'&&iRole('zzz')==='',
   '★アップロードトークンと作業者キーのどちらでも通る');
const up=await img.default.fetch(new Request('https://pj-img.example.workers.dev/upload',
  {method:'POST',headers:Object.assign({'content-type':'image/jpeg'},
    bearer('staff-key-123')),body:new Uint8Array([1,2,3])}),iEnv);
const upBody=JSON.parse(await up.text());
console.log('   /upload: '+up.status+' '+JSON.stringify(upBody.key?'key あり':upBody));
ok(up.status===200&&!!upBody.key,'★作業者のキーで写真を送れる');
const ls=await img.default.fetch(new Request(
  'https://pj-img.example.workers.dev/list?day=20261016',{headers:bearer('staff-key-123')}),
  iEnv);
ok(ls.status===200,'★一覧（探し直し）も使える');
const del=await img.default.fetch(new Request(
  // キーはサーバが決めた形（日付/uuid.jpg）でないと受け取らない
  'https://pj-img.example.workers.dev/i/20261016/'
  +'0123abcd-4567-89ab-cdef-0123456789ab.jpg',
  {method:'DELETE',headers:bearer('staff-key-123')}),iEnv);
ok(del.status===200,'★差し替えのための削除も使える');
const ng=await img.default.fetch(new Request('https://pj-img.example.workers.dev/upload',
  {method:'POST',headers:Object.assign({'content-type':'image/jpeg'},bearer('zzz')),
   body:new Uint8Array([1])}),iEnv);
ok(ng.status===401,'★違うトークンは 401');

T.done();
