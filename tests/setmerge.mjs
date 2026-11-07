/* Worker：⚙の設定は「変えた項目だけ」上書きする（7.109）
   v234 までは /settings が「送られてきた設定で丸ごと置き換え」だったので、
   画面側が空の欄も送ると、ランキングの上限・自動申告の種類・自動の取り直しが
   0／空／オフで上書きされて消えていた。
   ・送られてきた項目だけ書き替える（ほかはそのまま）
   ・mwRankCaps／mwDgTypes は**空では上書きしない**
   ・作業者用のキーからは価格・上限・自動・種類の表を書き込めない
   ・書き込みの履歴（settings_log）が残り、直前の値に戻せる */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：設定はマージして上書き・履歴・戻す（7.109）');
const ok=T.ok;
const { worker }=await loadWorker('setmerge');
const env=makeEnv({ STAFF_KEY:'s' });
const j=asJson;
const sget=(p)=>new Request('https://x'+p,{headers:{'X-PJ-Key':'s'}});
const spost=(p,b)=>new Request('https://x'+p,{method:'POST',
  headers:{'X-PJ-Key':'s','content-type':'application/json'},
  body:JSON.stringify(b)});
const T1='2026-11-07T01:00:00.000Z';
const T2='2026-11-07T02:00:00.000Z';
const T3='2026-11-07T03:00:00.000Z';
const T4='2026-11-07T04:00:00.000Z';

console.log('=== 管理者が上限・種類・自動を入れる ===');
let r=await j(await worker.fetch(post('/settings',{at:T1,settings:{
  mwRankCaps:'{"ホビー":900000,"ゲーム":80000}',
  mwDgTypes:'{"FIGURINE":1,"ABIS_VIDEO_GAMES":1}',
  mwAutoMode:'100', mwAutoPerHour:'100', baseProfit:'2500'}}),env));
console.log('   '+JSON.stringify(r.body.changed));
ok(r.body.ok===true&&r.body.stored===true,'★保存できる');
ok((r.body.changed||[]).length===5,'★変わった項目を5つ返す');

console.log('\n=== 絞り込みだけ触った端末の書き込み（これが消していた）===');
r=await j(await worker.fetch(post('/settings',{at:T2,settings:{
  csvMwAmzSort:'profit', csvMwAmzMinM:'10'}}),env));
console.log('   '+JSON.stringify(r.body.settings));
ok(r.body.settings.mwRankCaps==='{"ホビー":900000,"ゲーム":80000}',
   '★送っていないランキングの上限はそのまま残る');
ok(r.body.settings.mwDgTypes==='{"FIGURINE":1,"ABIS_VIDEO_GAMES":1}',
   '★送っていない種類の表もそのまま残る');
ok(r.body.settings.mwAutoMode==='100','★送っていない自動の取り直しもそのまま残る');
ok(r.body.settings.csvMwAmzSort==='profit','★送った項目は入る');

console.log('\n=== 空（未読み込み）では上書きしない ===');
r=await j(await worker.fetch(post('/settings',{at:T3,settings:{
  mwRankCaps:'', mwDgTypes:'{}', baseProfit:'2600'}}),env));
console.log('   skipped: '+JSON.stringify(r.body.skipped_blank));
ok(r.body.settings.mwRankCaps==='{"ホビー":900000,"ゲーム":80000}',
   '★空文字の mwRankCaps では消えない');
ok(r.body.settings.mwDgTypes==='{"FIGURINE":1,"ABIS_VIDEO_GAMES":1}',
   '★空の塊（{}）の mwDgTypes でも消えない');
ok((r.body.skipped_blank||[]).length===2,'★空で送られた2項目を返す（画面に出せる）');
ok(r.body.settings.baseProfit==='2600','★ほかの項目はふつうに入る');

console.log('\n=== はっきり消したいときは null ===');
r=await j(await worker.fetch(post('/settings',{at:T4,settings:{baseProfit:null}}),env));
ok(r.body.settings.baseProfit===undefined,'★null を送った項目は消える');
r=await j(await worker.fetch(post('/settings',
  {at:T4,settings:{replace:0,mwRankCaps:'{"ゲーム":1}'},replace:true}),env));
console.log('   replace: '+JSON.stringify(r.body.settings));
ok(r.body.settings.mwAutoMode===undefined&&r.body.settings.mwRankCaps==='{"ゲーム":1}',
   '★replace:true のときだけ丸ごと置き換える');

console.log('\n=== 作業者用のキーからは価格・上限・自動・種類を書き込めない ===');
const st=await worker.fetch(spost('/settings',{at:'2026-11-07T05:00:00.000Z',
  settings:{mwRankCaps:'{}',mwAutoMode:'off'}}),env);
console.log('   '+st.status);
ok(st.status===403,'★POST /settings は作業者には 403');
const stl=await worker.fetch(sget('/settings/log'),env);
ok(stl.status===403,'★履歴も作業者には 403');
const stu=await worker.fetch(spost('/settings/undo',{id:1}),env);
ok(stu.status===403,'★戻すのも作業者には 403');

console.log('\n=== 書き込みの履歴（いつ・どの端末・どの項目）===');
r=await j(await worker.fetch(get('/settings/log?limit=20'),env));
const rows=r.body.rows||[];
console.log('   '+rows.length+'件：'+JSON.stringify((rows[0]||{}).keys));
ok(r.body.ok===true&&rows.length>=4,'★書き込みごとに履歴が残る');
ok(rows[0].at>rows[1].at||rows[0].id>rows[1].id,'★新しい順で返る');
ok(!!rows[0].at_jst&&/\d/.test(rows[0].at_jst),'★日本時間の列が付く');
ok(rows.every((x)=>x.role==='admin'),'★どの端末（役割）かが分かる');
const caps=rows.filter((x)=>x.keys.indexOf('mwRankCaps')>=0);
ok(caps.length>=1&&'mwRankCaps' in caps[0].before,
   '★前の値（before）も残る（戻せる）');

console.log('\n=== 直前の値に戻す ===');
/* いまは replace で mwRankCaps が '{"ゲーム":1}' になっている。
   その書き込みを戻せば、前の値（上限2つ）に帰る。 */
const last=rows[0];
r=await j(await worker.fetch(post('/settings/undo',{id:last.id}),env));
console.log('   '+JSON.stringify(r.body.settings));
ok(r.body.ok===true&&r.body.undone===last.id,'★戻せる');
ok(r.body.settings.mwRankCaps==='{"ホビー":900000,"ゲーム":80000}',
   '★消える前の上限に戻る');
const miss=await j(await worker.fetch(post('/settings/undo',{id:99999}),env));
ok(miss.body.ok===false&&miss.body.error==='not_found','無い履歴は断る');
const bad=await j(await worker.fetch(post('/settings/undo',{}),env));
ok(bad.body.ok===false&&bad.body.error==='bad_id','id が無ければ断る');

console.log('\n=== 古い履歴は捨てる（直近200件だけ残す）===');
for(let i=0;i<30;i++)
  await j(await worker.fetch(post('/settings',
    {at:new Date(Date.parse('2026-11-08T00:00:00.000Z')+i*60000).toISOString(),
     settings:{baseProfit:String(3000+i)}}),env));
const cnt=env.DB._db.prepare('SELECT COUNT(*) n FROM settings_log').get();
const mx=env.DB._db.prepare('SELECT MAX(id) m FROM settings_log').get();
console.log('   '+JSON.stringify(cnt)+' '+JSON.stringify(mx));
ok(cnt.n<=200,'★履歴は200件までしか溜めない');
ok(mx.m>=30,'★新しい履歴は残る');

console.log('\n=== 自動の取り直しは件数で選ぶ（既定 オン・100件/時）===');
const { T:TT }=await loadWorker('setmerge2');
for(const [m,on,per] of [['','on',100],['100','on',100],['20','on',20],
                         ['200','on',200],['on','on',100],['off','off',100]]){
  const e2=makeEnv();
  if(m!=='')await j(await worker.fetch(post('/settings',
    {at:T1,settings:{mwAutoMode:m}}),e2));
  const s2=await TT.mwAutoSettings(e2);
  console.log('   mwAutoMode='+JSON.stringify(m)+' → '+s2.mode+'・'+s2.plan.per+'件/時');
  ok(s2.mode===on&&s2.plan.per===per,
     '★'+(m===''?'未設定':('「'+m+'」'))+' → '+on+'・'+per+'件/時');
}
T.done();
