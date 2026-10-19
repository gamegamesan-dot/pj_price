/* 画面：3時間ごとの最安値が上限で取り切れていないときの警告（6.72）
   ・/status の hot_pricing の left が1件以上のときだけ出す
   ・対象・取り直した件数・上限・取り切れなかった件数・前回の時刻を出す
   ・取り切れていれば出さない／pj-sync が古くて値が無ければ出さない
   ・作業者のキーでは出さない（価格を動かす話なので） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：3時間ごとの最安値の取り切れ');
const ok = T.ok;
(async()=>{
const p=await T.open();

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('autoMdMode').value='off'; $('autoRvMode').value='off'; $('pbMode').value='off';
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u);
    const res=(o2)=>Promise.resolve({ok:true,status:200,
      text:()=>Promise.resolve(JSON.stringify(o2)), json:()=>Promise.resolve(o2)});
    if(/\/whoami/.test(url))return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/status/.test(url))return res({counts:{},items:[],last_runs:[],sold_recent:[],
      hot_pricing:o.hot===undefined?null:o.hot});
    return real(u,i);
  };
  syncData={at:new Date().toISOString(),counts:{},items:[],
    hot_pricing:(o.hot===undefined?null:o.hot)};
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E'); roleCheck(); syncRender();
},o||{});
const view=async()=>await p.evaluate(()=>({
  show:getComputedStyle($('syncHotWarn')).display,
  txt:$('syncHotWarn').textContent }));

console.log('=== 取り切れていないとき ===');
await setup({hot:{at:'2026-10-19T15:00:00Z',picked:45,rows:40,left:5,max:40,wrote:40}});
await openCsvBoxes(p);
let v=await view();
console.log('   '+v.txt);
ok(v.show!=='none','★★警告を出す');
ok(/対象 45件のうち 40件だけ取り直しました/.test(v.txt),'★★内訳を出す');
ok(/上限 40件/.test(v.txt),'★★上限を出す');
ok(/取り切れなかった 5件は次の回に回ります/.test(v.txt),'★★取り切れなかった件数を出す');
ok(/前回 2026-10-19 15:00/.test(v.txt),'★前回の時刻を出す');
ok(/上限（PRICING_HOT_MAX）を上げてください/.test(v.txt),'★上限を上げるよう促す');

console.log('=== 取り切れているとき ===');
await setup({hot:{at:'2026-10-19T15:00:00Z',picked:18,rows:18,left:0,max:40,wrote:18}});
await openCsvBoxes(p);
v=await view();
console.log('   '+JSON.stringify(v));
ok(v.show==='none'&&v.txt==='','★★警告は出さない');

console.log('=== pj-sync に結果が無いとき ===');
await setup({hot:null});
await openCsvBoxes(p);
v=await view();
ok(v.show==='none','★★古い pj-sync でも警告は出さない');
await setup({});
await openCsvBoxes(p);
v=await view();
ok(v.show==='none','★項目そのものが無くても落ちない');

console.log('=== 取り込みで控えに入る ===');
await setup({hot:{at:'2026-10-19T15:00:00Z',picked:45,rows:40,left:5,max:40,wrote:40}});
let got=await p.evaluate(()=>{
  syncData=null;
  return new Promise(function(done){
    syncLoadRun(function(){ done({ h:syncData&&syncData.hot_pricing,
      show:getComputedStyle($('syncHotWarn')).display }); },true);
  });
});
console.log('   '+JSON.stringify(got));
ok(got.h&&got.h.left===5,'★★「状況を取り込む」で hot_pricing を控える');
ok(got.show!=='none','★★取り込んだ直後から警告が出る');

console.log('=== 作業者のキー ===');
await setup({role:'staff',
  hot:{at:'2026-10-19T15:00:00Z',picked:45,rows:40,left:5,max:40,wrote:40}});
await openCsvBoxes(p);
v=await view();
ok(v.show==='none','★★作業者のキーでは出さない（価格を動かす話）');

await T.done();
})();
