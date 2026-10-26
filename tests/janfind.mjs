/* Worker：JAN から ASIN を引く（7.67）
   ・items は**すでにちょうど100列**（D1 の上限）なので jan の列を足せない。
     そのため別表 jan_map に持つ
   ・控えにあれば **Catalog を呼ばない**
   ・見つからなかった控えは7日たったら調べ直す
   ・MW で分かっている分（mw_amz）も使う */
import { harness, loadWorker, makeEnv, get, asJson } from './lib.mjs';
const T=harness('Worker：JAN→ASIN');
const ok=T.ok;
const { worker, T:W }=await loadWorker('janfind');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  LWA_CLIENT_ID:'a', LWA_CLIENT_SECRET:'b', LWA_REFRESH_TOKEN:'c' });
let calls=[], cat={};
globalThis.fetch=async(u,i)=>{
  const url=String(u); calls.push(url);
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  if(/catalog\/2022-04-01/.test(url)){
    const ids=new URL(url).searchParams.get('identifiers').split(',');
    return new Response(JSON.stringify({ items:ids.map((j)=>cat[j]).filter(Boolean) }),{status:200});
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
const mk=(jan,asin,name,rank)=>({ asin:asin,
  identifiers:[{ identifiers:[{ identifierType:'EAN', identifier:jan }] }],
  summaries:[{ itemName:name }],
  salesRanks:[{ classificationRanks:[{ title:'ゲーム', rank:rank*10 },
    { title:'Switch ソフト', rank:rank }] }] });
const find=async(q)=>(await asJson(await worker.fetch(get('/find'+q),env))).body;

console.log('=== items に jan の列が無いこと（設計の前提）===');
const cols=(await env.DB.prepare(
  "SELECT name FROM pragma_table_info('items')").all()).results.map((r)=>r.name);
console.log('   items の列数: '+cols.length);
ok(cols.length===100,'★★items はちょうど100列（D1 の上限）＝列を足せない');
ok(!cols.some((c)=>/^(jan|gtin|ean|upc)$/i.test(c)),
   '★★items に JAN の列は無い（だから jan_map を別に持つ）');
ok(cols.length<=W.D1_MAX_COLS,'★上限を超えていない');

console.log('\n=== 形の検査 ===');
ok(W.janOk('4902370550467')===true,'★13桁は通る');
ok(W.janOk('490237055046')===false&&W.janOk('')===false,'★★13桁でないものは通さない');
ok(W.janOk('="4902370550467"')===true,'★★="…" の形でも数字だけ見る');

console.log('\n=== 初めての JAN は Catalog を呼ぶ ===');
cat['4902370550467']=mk('4902370550467','B00GAME001','ベヨネッタ3',649);
calls=[];
let d=await find('?jan=4902370550467');
console.log('   '+JSON.stringify(d.rows)+'　呼び出し '+d.calls);
ok(d.ok===true&&d.rows.length===1,'★返る');
ok(d.rows[0].asin==='B00GAME001','★★ASIN が引ける');
ok(d.rows[0].rank===649&&d.rows[0].rank_cat==='Switch ソフト',
   '★★ランキングはいちばん細かい分類');
ok(d.looked===1&&d.calls===1,'★★控えに無いので1回呼ぶ');

console.log('\n=== 2回目は呼ばない（控えを使う）===');
calls=[];
d=await find('?jan=4902370550467');
console.log('   呼び出し '+calls.filter((u)=>/catalog/.test(u)).length+'回');
ok(d.rows[0].asin==='B00GAME001','★同じ答え');
ok(d.cached===1&&d.looked===0,'★★控えから返す');
ok(calls.filter((u)=>/catalog/.test(u)).length===0,'★★★Catalog を呼ばない');

console.log('\n=== 見つからない JAN ===');
calls=[];
d=await find('?jan=4999999999994');
ok(d.rows[0].asin===''&&/見つかりません/.test(d.rows[0].err),'★★理由を返す');
ok(d.looked===1,'★1回は調べる');
calls=[];
d=await find('?jan=4999999999994');
ok(d.cached===1&&calls.filter((u)=>/catalog/.test(u)).length===0,
   '★★見つからなかった控えも使い回す（毎回呼ばない）');
ok(W.JAN_MISS_TTL_D===7,'★調べ直すのは7日後');
await env.DB.prepare("UPDATE jan_map SET at=?1 WHERE jan='4999999999994'")
  .bind(new Date(Date.now()-8*86400000).toISOString()).run();
calls=[];
d=await find('?jan=4999999999994');
ok(calls.filter((u)=>/catalog/.test(u)).length>=1,'★★8日たったら調べ直す');

console.log('\n=== まとめて引く ===');
cat['4580416924740']=mk('4580416924740','B00FIG0001','グリザイア',2310);
calls=[];
d=await find('?jans=4902370550467,4580416924740,490237055046');
console.log('   '+JSON.stringify(d.rows.map((x)=>x.jan+':'+(x.asin||'—'))));
ok(d.asked===2,'★★13桁でないものは数えない');
ok(d.rows.length===2,'★2件返る');
ok(d.cached===1&&d.looked===1,'★★控えにある分は呼ばない');
ok(calls.filter((u)=>/catalog/.test(u)).length>=1,'★足りない分だけ引く');
let many=await find('?jans='+new Array(30).fill(0)
  .map((_,i)=>String(4900000000000+i)).join(','));
ok(many.asked===20,'★★1回に20件まで');

console.log('\n=== MW で分かっている分も使う ===');
await env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,rank,rank_cat,checked_at,created_at)
   VALUES ('4988611224878','B00MW00001','MWで分かった商品',1234,'CD','x','x')`).run();
calls=[];
d=await find('?jan=4988611224878');
console.log('   '+JSON.stringify(d.rows[0]));
ok(d.rows[0].asin==='B00MW00001','★★mw_amz の ASIN を使う');
ok(d.rows[0].src==='mw','★どこで分かったかを返す');
ok(calls.filter((u)=>/catalog/.test(u)).length===0,'★★★Catalog を呼ばない');

console.log('\n=== MW の取り込みが控えをためる ===');
cat['4970381909444']=mk('4970381909444','B00SEAL001','ちいかわシール',5000);
const run={ kind:'t', subrequests:0, pages:0, errors:0, notes:[], rows:0 };
await W.mwAsinFind(env,run,['4970381909444','4999999999995']);
let jm=(await env.DB.prepare(
  "SELECT jan,asin,src,err FROM jan_map WHERE jan IN ('4970381909444','4999999999995') ORDER BY jan").all()).results;
console.log('   '+JSON.stringify(jm));
ok(jm.length===2,'★★MW の ASIN 引きでも控えに入る');
ok(jm.filter((x)=>x.jan==='4970381909444')[0].asin==='B00SEAL001','★引けた分');
ok(jm.filter((x)=>x.jan==='4999999999995')[0].asin===null,'★★引けなかった分も控える');
calls=[];
d=await find('?jan=4970381909444');
ok(calls.filter((u)=>/catalog/.test(u)).length===0,
   '★★MW で引いた分は /find でも呼ばずに済む');

console.log('\n=== おかしな値 ===');
d=await find('?jan=abc');
ok(d.error==='bad_jan','★★13桁でなければ断る');
let dl=await asJson(await worker.fetch(new Request('https://x/find?jan=4902370550467',
  {headers:{'X-PJ-Key':'staff-key-123'}}),env));
ok(dl.status===200,'★★作業者のキーでも引ける（読み取りだけ）');

await T.done();
