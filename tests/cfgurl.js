/* 画面：⚙の URL の3つ（英語タイトル生成・画像サーバー・pj-sync）が空に戻る件（8.109・v360）

   カジの報告（2026-11-27）iPhone の pj で、⚙の URL の3つが入れても空に戻る。キーは残っている。
   ・11/27 23:48 に3つとも空 → 入れ直した → ②で CSV を書き出し → Safari で Shopify に取り込み →
     pj に戻るとまた3つとも空。PC では残っている
   原因：キーの欄には「別アプリから戻ったときにブラウザが空にした欄で、保存済みの値を消さない」
   守りがあったが、URL の欄には無かった。URL の欄はそれぞれキーの欄のすぐ上にあり、
   iPhone がユーザー名とパスワードの組と見なして一緒に空にすることがある。空のまま保存が走ると
   保存済みの URL まで空で上書きされていた。
   直し：URL の欄も同じ守りに入れる（入力のたびに保存・空にできるのは触っている本人だけ・
   戻ったら入れ直す）。URL の欄は type="url"・自動入力なし。空のときは「既定値を入れる」。 */
const { harness } = require('./lib');
const T = harness('画面：⚙の URL が空に戻る件（8.109）');
const ok = T.ok;
const KEY='pj:csvcfg:v1';
const DEF={ csvTitleApi:'https://pj-title.gamegamesan.workers.dev',
            csvImgBase:'https://pj-img.gamegamesan.workers.dev',
            syncApi:'https://pj-sync.gamegamesan.workers.dev' };
(async()=>{
const p=await T.open();
const saved=()=>p.evaluate((k)=>JSON.parse(localStorage.getItem(k)||'{}'),KEY);
const ids=['csvTitleApi','csvImgBase','syncApi'];
/* ⚙（設定タブ）の「接続設定」を開く */
const openCfg=async()=>{ await p.evaluate(()=>{ switchTab('G'); var d=$('cfgConnBox'); if(d)d.open=true; });
  await p.waitForTimeout(120); };
await openCfg();

console.log('=== ① 欄の作り ===');
const attrs=await p.evaluate((ids)=>ids.map((id)=>{ const e=document.getElementById(id);
  return { id, type:e.type, ac:e.getAttribute('autocomplete'), cap:e.getAttribute('autocapitalize') }; }),ids);
console.log('   '+JSON.stringify(attrs));
ok(attrs.every((a)=>a.type==='url'&&a.ac==='off'&&a.cap==='off'),
   '★★URL の欄は type="url"・自動入力なし（iPhone がユーザー名の欄と見なさないように）');

console.log('\n=== ② 入力のたびに保存する（キーと同じ）===');
for(const id of ids)await p.fill('#'+id,'https://'+id+'.example.workers.dev');
await p.fill('#syncKey','KEY-1');
let s=await saved();
ok(ids.every((id)=>s[id]==='https://'+id+'.example.workers.dev'),'★★★URL は入力のたびに（input）端末に保存される（'+KEY+'）');
ok(s.syncKey==='KEY-1','★キーも同じ保存先');

console.log('\n=== ③ 別アプリから戻ったら欄が空になっていた（iPhone）===');
const back=await p.evaluate((ids)=>{
  /* ブラウザが欄を空にした（人が触っていない・input も飛ばない） */
  ids.concat(['syncKey']).forEach((id)=>{ document.getElementById(id).value=''; });
  /* 戻る前に、ほかの操作で保存が走る（CSV の書き出しなど） */
  csvSaveCfg();
  const afterSave=JSON.parse(localStorage.getItem('pj:csvcfg:v1')||'{}');
  /* 画面に戻った */
  window.dispatchEvent(new Event('pageshow'));
  return { afterSave, fields:ids.map((id)=>document.getElementById(id).value),
           key:document.getElementById('syncKey').value };
},ids);
console.log('   '+JSON.stringify(back.fields));
ok(ids.every((id)=>back.afterSave[id]==='https://'+id+'.example.workers.dev'),
   '★★★欄が空のまま保存が走っても、保存済みの URL を空で上書きしない（今回の不具合）');
ok(back.fields.every((v,i)=>v==='https://'+ids[i]+'.example.workers.dev')&&back.key==='KEY-1',
   '★★★画面に戻ったら URL もキーも入れ直す');
await p.reload(); await p.waitForTimeout(300); await openCfg();
const rl=await p.evaluate((ids)=>ids.map((id)=>document.getElementById(id).value),ids);
ok(rl.every((v,i)=>v==='https://'+ids[i]+'.example.workers.dev'),'★★開き直しても（版の切り替えの読み直しも）残る');

console.log('\n=== ④ 自分で消したときは消える ===');
await p.fill('#csvImgBase','');
s=await saved();
ok(s.csvImgBase==='','★★その欄を触って空にしたときだけ消える');
const shown=await p.evaluate(()=>getComputedStyle(document.getElementById('cfgUrlDefBox')).display!=='none');
ok(shown,'★★URL が空のときは「既定値を入れる」を出す');

console.log('\n=== ⑤ 既定値を入れる ===');
await p.evaluate(()=>{ document.getElementById('csvTitleApi').value='';
  csvSecretKeep('csvTitleApi',''); csvSaveCfg(); cfgUrlDefRender(); });
await p.click('#cfgUrlDef');
const d=await p.evaluate((ids)=>({ f:ids.map((id)=>document.getElementById(id).value),
  shown:getComputedStyle(document.getElementById('cfgUrlDefBox')).display!=='none',
  note:document.getElementById('cfgUrlDefNote').textContent,
  key:document.getElementById('syncKey').value }),ids);
console.log('   '+JSON.stringify(d));
ok(d.f[0]===DEF.csvTitleApi&&d.f[1]===DEF.csvImgBase,'★★★空の欄に既定の URL を一度で入れる');
ok(d.f[2]==='https://syncApi.example.workers.dev','★★入っている欄は変えない');
ok(!d.shown&&/2件/.test(d.note),'★入れたらボタンを隠し、何件入れたかを出す');
ok(d.key==='KEY-1','★キーは入れない（そのまま）');
s=await saved();
ok(s.csvTitleApi===DEF.csvTitleApi&&s.csvImgBase===DEF.csvImgBase,'★★入れた URL はすぐ端末に保存する');
/* 3つとも空の端末（今回の iPhone）でも一度で入る */
await p.evaluate((ids)=>{ ids.forEach((id)=>{ document.getElementById(id).value=''; csvSecretKeep(id,''); });
  csvSaveCfg(); cfgUrlDefRender(); },ids);
await p.click('#cfgUrlDef');
const all=await p.evaluate((ids)=>ids.map((id)=>document.getElementById(id).value),ids);
ok(all[0]===DEF.csvTitleApi&&all[1]===DEF.csvImgBase&&all[2]===DEF.syncApi,
   '★★★3つとも空でも一度で入る（pj-title・pj-img・pj-sync）');
await p.reload(); await p.waitForTimeout(300); await openCfg();
const hid=await p.evaluate(()=>getComputedStyle(document.getElementById('cfgUrlDefBox')).display==='none');
ok(hid,'★URL が入っていればボタンは出さない');
T.done();
})();
