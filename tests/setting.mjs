/* Worker：画面の設定を端末をまたいで同じにする（GET/POST /settings）
   古い時刻の書き込みを退けること、おかしな中身を断ること、
   壊れた保存値から立て直せることを見張る。 */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：設定の同期（/settings）');
const ok=T.ok;
const { worker }=await loadWorker('set');
const env=makeEnv();
const j=asJson;

const ADV=(o)=>Object.assign({targetMode:'auto',baseProfit:'1000',linkRate:'30',
  saleRate:'15',usTaxRate:'8'},o||{});

console.log('=== まだ何も保存していないとき ===');
let r=await j(await worker.fetch(get('/settings'),env));
console.log('   '+JSON.stringify(r));
ok(r.status===200&&r.body.ok===true&&r.body.at===''
   &&JSON.stringify(r.body.settings)==='{}','★空で返る（端末の値がそのまま使われる）');

console.log('\n=== 保存して読み直す ===');
const t1='2026-10-08T01:00:00.000Z';
r=await j(await worker.fetch(post('/settings',
  {at:t1,settings:ADV({baseProfit:'2500',linkRate:'45'})}),env));
console.log('   POST: '+JSON.stringify(r.body));
ok(r.body.ok===true&&r.body.stored===true,'★保存できる');
r=await j(await worker.fetch(get('/settings'),env));
console.log('   GET: '+JSON.stringify(r.body));
ok(r.body.at===t1&&r.body.settings.baseProfit==='2500'&&r.body.settings.linkRate==='45',
   '★別の端末からも同じ値が読める');
const row=env.DB._db.prepare("SELECT k,v FROM sync_state WHERE k='ui.settings'").get();
console.log('   D1: '+JSON.stringify(row));
ok(!!row&&/2500/.test(row.v),'★D1（sync_state）に入る');

console.log('\n=== 新しく変えたほうを使う ===');
const t2='2026-10-08T02:00:00.000Z';
r=await j(await worker.fetch(post('/settings',
  {at:t2,settings:ADV({baseProfit:'3000'})}),env));
console.log('   新しい書き込み: '+JSON.stringify(r.body));
ok(r.body.stored===true&&r.body.settings.baseProfit==='3000','★時刻が新しければ上書きする');
// 古い端末（開いたままだった iPhone など）からの書き込みは退ける
r=await j(await worker.fetch(post('/settings',
  {at:t1,settings:ADV({baseProfit:'1000'})}),env));
console.log('   古い書き込み: '+JSON.stringify(r.body));
ok(r.body.ok===true&&r.body.stored===false,'★古い時刻の書き込みは退ける');
ok(r.body.at===t2&&r.body.settings.baseProfit==='3000',
   '★退けたときは、いま入っている設定を返す（端末がそちらに合わせられる）');
r=await j(await worker.fetch(get('/settings'),env));
ok(r.body.settings.baseProfit==='3000','★古い値で上書きされていない');
// 同じ時刻なら、あとから来た書き込みを採る（取りこぼさない）
r=await j(await worker.fetch(post('/settings',
  {at:t2,settings:ADV({baseProfit:'3100'})}),env));
ok(r.body.stored===true&&r.body.settings.baseProfit==='3100','同じ時刻なら新しい書き込みを採る');

console.log('\n=== 初期値に戻した状態も保存される ===');
const t3='2026-10-08T03:00:00.000Z';
r=await j(await worker.fetch(post('/settings',{at:t3,settings:ADV()}),env));
r=await j(await worker.fetch(get('/settings'),env));
console.log('   '+JSON.stringify(r.body.settings));
ok(r.body.settings.baseProfit==='1000'&&r.body.settings.linkRate==='30'
   &&r.body.settings.targetMode==='auto','★既定値に戻した状態もそのまま返る');

console.log('\n=== おかしな中身は断る ===');
for(const [b,label] of [
  [{settings:ADV()},'時刻が無い'],
  [{at:'きのう',settings:ADV()},'時刻の形が違う'],
  [{at:t3},'設定が無い'],
  [{at:t3,settings:'おかしい'},'設定が文字列'],
  [{at:t3,settings:[1,2]},'設定が配列']]){
  const x=await j(await worker.fetch(post('/settings',b),env));
  console.log('   '+label+': '+x.status+' '+JSON.stringify(x.body));
  ok(x.status===400&&x.body.ok===false,'★'+label+'ときは断る（400）');
}
const big=await j(await worker.fetch(post('/settings',
  {at:t3,settings:{junk:'x'.repeat(9000)}}),env));
console.log('   大きすぎる: '+JSON.stringify(big.body));
ok(big.status===400&&big.body.error==='too_large','★大きすぎる設定は断る');
const broken=await j(await worker.fetch(post('/settings','{壊れた'),env));
ok(broken.status===400,'JSONが壊れていたら400');
r=await j(await worker.fetch(get('/settings'),env));
ok(r.body.at===t3&&r.body.settings.baseProfit==='1000','断ったあとも中身は壊れていない');

console.log('\n=== 鍵が無ければ触れない ===');
const noKey=await worker.fetch(new Request('https://x/settings'),env);
console.log('   '+noKey.status);
ok(noKey.status===401,'★キーなしのGETは401');
const noKey2=await worker.fetch(new Request('https://x/settings',{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify({at:t3,settings:ADV()})}),env);
ok(noKey2.status===401,'★キーなしのPOSTも401');

console.log('\n=== 壊れた保存値から立て直せる ===');
env.DB._db.prepare("UPDATE sync_state SET v='これはJSONではない' WHERE k='ui.settings'").run();
r=await j(await worker.fetch(get('/settings'),env));
console.log('   '+JSON.stringify(r.body));
ok(r.body.ok===true&&r.body.at===''&&JSON.stringify(r.body.settings)==='{}',
   '★読めない保存値は空として返す（画面を止めない）');
r=await j(await worker.fetch(post('/settings',{at:t1,settings:ADV({saleRate:'20'})}),env));
ok(r.body.stored===true,'★そのあと保存し直せる');
T.done();
