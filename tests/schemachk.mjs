/* Worker：D1 の作りを確かめる窓口と、500 のときの文面（7.103）
   行のボタンが HTTP 500 になる原因のほとんどは、マイグレーションの流し漏れ。
   ・GET /schema/check が、足りない表・列と「流すマイグレーション」を返す
   ・worker.js の一覧（SCHEMA_TABLES／SCHEMA_ITEM_COLS）が schema.sql と一致する
     （片方だけ増えて気付かない、を防ぐ）
   ・items の列が1つ足りないと、行のボタン**全部**が 500 になる
   ・amz_drop 表（migrate-0037）が無いと、一覧と Amazon無在庫だけが 500 になる
   ・500 の本文に error・where・detail・hint が入り、キーは入らない */
import { harness, loadWorker, makeEnv, post, get, asJson, SCHEMA } from './lib.mjs';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const T=harness('Worker：D1 の作りを確かめる');
const ok=T.ok;
const { worker, T:W }=await loadWorker('schemachk');
const now=new Date().toISOString();

const mk=async(breaker)=>{
  const env=makeEnv();
  await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,
    ebay_qty,ebay_price,ebay_seen_at,on_hand,one_off,one_off_known,dropship,mark_stop,
    restocking,updated_at) VALUES ('B07MLZ2JKF','cart','ebay','ヨッシー',
    'E-B07MLZ2JKF-C','168774702258',1,37.71,?1,0,0,1,0,0,0,?1)`).bind(now).run();
  if(breaker)env.DB._db.exec(breaker);
  return env;
};
const send=async(env,o)=>await asJson(await worker.fetch(
  post('/listings',{items:[Object.assign({asin:'B07MLZ2JKF',cond:'cart',title:'ヨ'},o)]}),env));
const chk=async(env)=>await asJson(await worker.fetch(get('/schema/check'),env));

console.log('=== 一覧が schema.sql と一致している ===');
const db=new DatabaseSync(':memory:');
db.exec(fs.readFileSync(SCHEMA,'utf8'));
const tabs=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all().map((x)=>x.name).filter((x)=>x!=='sqlite_sequence');
const cols=db.prepare("SELECT name FROM pragma_table_info('items')").all().map((x)=>x.name);
ok(JSON.stringify(W.SCHEMA_TABLES.slice().sort())===JSON.stringify(tabs),
  '★★表の一覧が schema.sql と同じ（'+tabs.length+'表）');
ok(JSON.stringify(W.SCHEMA_ITEM_COLS)===JSON.stringify(cols),
  '★★items の列の一覧が schema.sql と同じ（'+cols.length+'列・並びまで同じ）');
ok(cols.length===100,'★items はちょうど100列（D1 の上限。これ以上は別表に持つ）');
ok(W.SCHEMA_ITEM_COLS.indexOf('mark_stop')>=0,
  '★mark_stop は items の**列**（別表ではない）');
ok(W.SCHEMA_TABLES.indexOf('amz_drop')>=0&&cols.indexOf('amz_drop')<0,
  '★Amazon 無在庫の印は**別表**（amz_drop）。items には足していない');

console.log('=== 正常な D1 ===');
let env=await mk(null);
let r=await chk(env);
ok(r.status===200&&r.body.ok===true,'★ok:true を返す');
ok((r.body.missing_tables||[]).length===0&&(r.body.missing_item_cols||[]).length===0,
  '★足りないものは無い');
ok(r.body.item_cols===100&&r.body.item_cols_max===100,'★列数と上限を返す');
ok((await send(env,{mark_stop:true})).status===200,'★値下げしないは 200');

console.log('=== items の列が足りない（migrate-0023 未実行） ===');
env=await mk('ALTER TABLE items DROP COLUMN sold_keep');
r=await chk(env);
ok(r.body.ok===false,'★ok:false');
ok(JSON.stringify(r.body.missing_item_cols)==='["sold_keep"]','★★足りない列の名前を返す');
ok(JSON.stringify(r.body.run)==='["cd proxy-sync && node d1-exec.mjs migrate-0023-sold-keep.sql"]',
  '★★流すマイグレーションと実行の仕方を返す（d1-exec.mjs の形）');
const fields=[['値下げしない',{mark_stop:true}],['手元在庫',{on_hand:true}],
  ['一点物',{one_off:true}],['無在庫',{dropship:true}],['在庫0時',{mode:'restock'}],
  ['eBay優先',{ebay_first:true}],['Amazon無在庫',{amz_drop:true}]];
let all500=true, body500=null;
for(const [name,o] of fields){
  const x=await send(env,o);
  if(x.status!==500)all500=false;
  if(!body500)body500=x.body;
}
ok(all500,'★★列が1つ足りないと、行のボタン**全部**が 500 になる（'
  +fields.map((x)=>x[0]).join('・')+'）');
ok(body500.error==='server_error'&&body500.where==='/listings',
  '★★本文に error と where（どの窓口か）が入る');
ok(/no such column: sold_keep/.test(String(body500.detail||'')),
  '★★本文に足りない列の名前が入る（画面にそのまま出せる）');
ok(/名簿の保存/.test(String(body500.detail||'')),'★どこで落ちたかも入る');
ok(/schema\/check/.test(String(body500.hint||'')),'★確かめ方（hint）も入る');
const j500=JSON.stringify(body500);
ok(!/X-PJ-Key|PJ_ACCESS_KEY|STAFF_KEY|SP_|AWS|secret|token/i.test(j500)
  &&!/[A-Za-z0-9_\-]{20,}/.test(j500),
  '★★キーの名前・長い文字列（秘密になりうるもの）は本文に入らない');
ok(String(body500.detail||'').length<=300,'★文面は短く切る（300字まで）');

console.log('=== amz_drop 表が無い（migrate-0037 未実行） ===');
env=await mk('DROP TABLE amz_drop');
r=await chk(env);
ok(JSON.stringify(r.body.missing_tables)==='["amz_drop"]','★★足りない表の名前を返す');
ok(JSON.stringify(r.body.run)==='["cd proxy-sync && node d1-exec.mjs migrate-0037-amz-drop.sql"]',
  '★★0037 を流せと返す');
ok((await send(env,{mark_stop:true})).status===200,
  '★★この場合「値下げしない」は 200（別表を触らないため）');
ok((await send(env,{on_hand:true})).status===200,'★手元在庫も 200');
ok((await send(env,{amz_drop:true})).status===500,'★Amazon無在庫だけ 500');
ok((await asJson(await worker.fetch(get('/status?limit=5'),env))).status===500,
  '★★一覧（/status）は 500（表を見るため）');

console.log('=== 名前からマイグレーションを引く ===');
ok(W.schemaFixOf('amz_drop')==='migrate-0037-amz-drop.sql','★表の名前で引ける');
ok(W.schemaFixOf('rk_want')==='migrate-0022-restock-price.sql','★列の名前の頭で引ける');
ok(W.schemaFixOf('mark_stop')==='migrate-0016-auto-markdown.sql','★mark_stop も引ける');
ok(W.schemaFixOf('nazono_hashira')==='','★分からないものは空');

T.done();
