/* 画面をシンプルにする（6.46）
   ・販売連携タブのまとめ（値下げの予定・警告の理由）は先頭3件だけ出し、
     「すべて表示（n件）」で開く。開閉はこの端末に保存する。
   ・⚙設定の「値付けの目標」は初期から開いている。
   ・URL・キー・トークンは「接続設定」1つに畳む。空のときだけ開いて目立たせる。
   ・⚙設定に「使い方マニュアル」を置き、画面から外した説明文をまとめる。 */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面のシンプル化（まとめ・接続設定・マニュアル）');
const ok = T.ok;
(async()=>{
const p=await T.open();

/* 値下げの時期になっている行を5件（先頭3件だけ出るか見るため）。
   警告の理由も5種類そろえる。 */
const seed=async()=>await p.evaluate(()=>{
  $('autoMdMode').value='plan'; $('autoMdMax').value='200';
  $('csvMarkDays').value='3'; $('csvMarkTimes').value='10'; $('csvMarkStep').value='1';
  const old=new Date(Date.now()-5*86400000).toISOString();
  const it=(n,o)=>Object.assign({asin:'B0SMP0000'+n,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-SMP'+n,ebay_item_id:'7700'+n,ebay_qty:1,ebay_price:85,
    title:'商品'+n,cost_yen:1200,weight_g:150,one_off:0,dropship:0,restocking:0,
    mark_at:old,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:1,
    md_step:2.5,md_start:85,md_floor:60,md_n:10,md_done:n-1,
    amazon_lowest:0,amazon_offers_json:'[]',
    fba_available:1,fba_inbound:0,fba_reserved:0,warnings:[],notes:[],state:'ok'},o||{});
  syncData={at:new Date().toISOString(),counts:{},items:[
    it(1,{warnings:['FBA在庫なし']}),
    it(2,{warnings:['予約済み（内訳不明）']}),
    it(3,{warnings:['写真が500px未満']}),
    it(4,{warnings:['在庫の数が合いません']}),
    it(5,{warnings:['FBAに出庫中']}),
  ]};
  csvList=[]; csvSaveList(); syncPick={};
  switchTab('E'); syncRender();
});
const view=async()=>await p.evaluate(()=>({
  list:$('syncMdList').innerText, listHtml:$('syncMdList').innerHTML,
  brk:$('syncWarnBreak').innerText,
  n:(($('syncMdList').innerText.match(/^・/gm)||[]).length),
  saved:localStorage.getItem('pj:syncmore:v1')||'' }));

console.log('=== 販売連携：まとめは先頭3件だけ出す ===');
await seed(); await openCsvBoxes(p);
let v=await view();
console.log('   予定の一覧: '+v.list.replace(/\n/g,' / '));
ok(v.n===3,'★値下げの予定は先頭3件だけ出す（5件のうち）');
ok(/すべて表示（5件）/.test(v.list),'★「すべて表示（5件）」を出す');
console.log('   警告の理由: '+v.brk.replace(/\n/g,' / '));
ok(/対応が必要 5件/.test(v.brk),'★件数は全部の数で出す');
ok((v.brk.match(/件\s*／/g)||[]).length===2&&/すべて表示（5件）/.test(v.brk),
   '★警告の理由も3つだけ＋「すべて表示（5件）」');

console.log('\n=== 「すべて表示」で開く ===');
await p.click('#syncMdList a[data-more="mdplan"]');
await p.waitForTimeout(200);
v=await view();
console.log('   '+v.list.replace(/\n/g,' / '));
ok(v.n===5,'★押すと5件ぜんぶ出る');
ok(/折りたたむ/.test(v.list)&&!/すべて表示/.test(v.list),'★「折りたたむ」に変わる');
console.log('   保存: '+v.saved);
ok(/"mdplan":true/.test(v.saved),'★開いた状態をこの端末に保存する');

console.log('\n=== 開き直しても開いたまま ===');
await p.reload(); await p.waitForTimeout(400);
await seed(); await openCsvBoxes(p);
v=await view();
console.log('   '+v.list.replace(/\n/g,' / '));
ok(v.n===5&&/折りたたむ/.test(v.list),'★開き直しても開いたまま');
await p.click('#syncMdList a[data-more="mdplan"]'); await p.waitForTimeout(200);
v=await view();
ok(v.n===3&&/"mdplan":false/.test(v.saved),'★畳んだ状態も残る');

console.log('\n=== 3件以下のときはリンクを出さない ===');
const few=await p.evaluate(()=>{
  syncData.items=syncData.items.slice(0,2); syncRender();
  return { list:$('syncMdList').innerText, brk:$('syncWarnBreak').innerText };
});
console.log('   '+few.list.replace(/\n/g,' / ')+' ｜ '+few.brk.replace(/\n/g,' / '));
ok(!/すべて表示|折りたたむ/.test(few.list)&&!/すべて表示|折りたたむ/.test(few.brk),
   '★2件なら今までどおり全部出す（リンクなし）');

console.log('\n=== ⚙設定：値付けの目標は初期から開いている ===');
await p.reload(); await p.waitForTimeout(400);
const cfg=await p.evaluate(()=>{
  switchTab('G');
  return { adv:$('advBox').open, man:$('cfgManBox').open,
    conn:$('cfgConnBox').open, sum:$('cfgConnSum').innerText,
    note:$('cfgConnNote').innerText,
    red:getComputedStyle($('cfgConnSum')).color };
});
console.log('   '+JSON.stringify({adv:cfg.adv,man:cfg.man,conn:cfg.conn}));
ok(cfg.adv===true,'★「値付けの目標」は開いた状態で始まる');
ok(cfg.man===false,'★「使い方マニュアル」は畳んでおく（読みたいときだけ開く）');

console.log('\n=== ⚙設定：接続設定は空のときだけ開いて目立たせる ===');
console.log('   '+cfg.sum+' ／ '+cfg.note);
ok(cfg.conn===true,'★キーが空のときは開く');
ok(/要対応 6件/.test(cfg.sum),'★足りない数を出す（グループの見出しに）');
ok(/英語タイトル生成のURL/.test(cfg.note)&&/動きません/.test(cfg.note),
   '★何が空かと、動かない機能を書く');
ok(/rgb\(/.test(cfg.red)&&cfg.red!=='rgb(0, 0, 0)','★色を変えて目立たせる');

const filled=await p.evaluate(()=>{
  localStorage.setItem('pj:csvcfg:v1',JSON.stringify({
    csvTitleApi:'https://pj-title.example.workers.dev',csvTitleKey:'k',
    csvImgBase:'https://pj-img.example.workers.dev',csvImgToken:'t',
    syncApi:'https://pj-sync.example.workers.dev',syncKey:'k'}));
});
await p.reload(); await p.waitForTimeout(400);
const f=await p.evaluate(()=>{
  switchTab('G');
  return { conn:$('cfgConnBox').open, sum:$('cfgConnSum').innerText,
    ids:['csvTitleApi','csvTitleKey','csvImgBase','csvImgToken','syncApi','syncKey']
      .map(id=>$('cfgConnBox').contains($(id))) };
});
console.log('   '+JSON.stringify(f));
ok(f.conn===false,'★ぜんぶ入っていれば畳んだままで始まる');
ok(/接続設定/.test(f.sum)&&!/要対応/.test(f.sum),'★入れたら見出しの印が消える');
ok(f.ids.every(Boolean),'★URL・キー・トークンの6つは接続設定の中にまとめる');

// pj-sync のキーは空なら英題生成のキーを使う決まりなので、足りない数に入れない
const one=await p.evaluate(()=>{
  $('syncKey').value=''; cfgConnRender();
  return { sum:$('cfgConnSum').innerText, open:$('cfgConnBox').open };
});
console.log('   '+JSON.stringify(one));
ok(one.open===false&&!/要対応/.test(one.sum),
   '★pj-sync のキーだけ空なら（英題のキーで足りるので）開かない');

console.log('\n=== ⚙設定：使い方マニュアル ===');
/* 中身（章立て・作業の流れ・管理者だけの印）は tests/manual.js で見る。
   ここでは置き場所と「畳んである」ことだけ確かめる。 */
const man=await p.evaluate(()=>{
  switchTab('G'); $('cfgManBox').open=true;
  const box=$('cfgManBox');
  return { inCfg:$('tabCfg').contains(box),
    inCsv:$('tabCsv').contains(box),
    chaps:Array.from(box.querySelectorAll('details.manc>summary'))
      .map(x=>x.textContent.trim()),
    shut:Array.from(box.querySelectorAll('details.manc')).every(d=>!d.open),
    lis:box.querySelectorAll('li').length,
    long:Array.from(box.querySelectorAll('li')).filter(x=>x.textContent.length>260).length,
    /* 畳んだままだと innerText に出ないので、中身を読むときだけ開ける。 */
    text:(function(){
      box.querySelectorAll('details.manc').forEach(function(d){ d.open=true; });
      const t=box.innerText;
      box.querySelectorAll('details.manc').forEach(function(d){ d.open=false; });
      return t;
    })() };
});
console.log('   章: '+JSON.stringify(man.chaps));
ok(man.inCfg&&!man.inCsv,'★⚙設定の中にある');
ok(man.chaps.length===5,'★★章は5つ（毎日／Amazon刈取／eBay出品／販売連携／困ったとき）');
ok(man.shut,'★★章は畳んである（スマホで長い文を一度に見せない）');
ok(man.lis>=40&&man.long===0,'★短い箇条書きで書く（長すぎる行なし）');
ok(/Shift_JIS/.test(man.text)&&/File Exchange/.test(man.text)&&/500px/.test(man.text),
   '★画面から外した説明（文字コード・File Exchange・写真の大きさ）が入っている');

await T.done();
})();
