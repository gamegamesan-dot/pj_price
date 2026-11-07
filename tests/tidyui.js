/* 画面の整理（6.150）
   機能が増えて、目的のボタンや一覧まで長くスクロールするようになった。
   機能は削らず、置き場所と見え方だけを変える。
   ・Amazon刈取タブを「仕入れ」タブにし、中を「刈取（Amazon FBA）」と
     「無在庫（eBay）」のサブタブに分ける（MW の無在庫は出品CSVから移す）
   ・取り込み欄は仕入れ先を選べる形（いまは MW だけなので選択欄は出さない）
   ・MW の写真のブックマークレットは、貼り付け欄と同じ場所（⚙から移す）
   ・長い一覧は既定10件＋「さらに10件」「すべて表示」。件数・検索は全件に効く
   ・長い説明は「説明 ▸」に畳む
   ・開閉と表示件数は端末に覚える
   ・各タブの上に目次を置く
   ・使い方マニュアルは manual.html に分ける */
const fs=require('fs');
const path=require('path');
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面の整理（仕入れタブ・10件ずつ・目次・マニュアル）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });
await p.waitForTimeout(400);

console.log('=== 仕入れタブ（刈取／無在庫）===');
let v=await p.evaluate(()=>{
  switchTab('F');
  return { name:$('tabF').textContent,
    subs:Array.prototype.map.call($('buySubBar').querySelectorAll('button'),
      (b)=>b.textContent),
    mwInBuy:!!document.querySelector('#tabBuyMw #csvMwBox'),
    mwInCsv:!!document.querySelector('#tabCsv #csvMwBox'),
    amzInBuy:!!document.querySelector('#tabAmz #csvMwAmzList') };
});
console.log('   '+JSON.stringify(v));
ok(v.name==='仕入れ','★タブの名前は「仕入れ」（ほかの問屋も足せるように）');
ok(v.subs.length===2&&/刈取/.test(v.subs[0])&&/無在庫/.test(v.subs[1]),
   '★★サブタブは「刈取（Amazon FBA）」「無在庫（eBay）」');
ok(v.mwInBuy&&!v.mwInCsv,'★★MW の無在庫は仕入れタブに移った（出品CSVには無い）');
ok(v.amzInBuy,'★刈取の一覧はそのまま');

console.log('\n=== 取り込み欄は仕入れ先を選べる形（いまは MW だけ）===');
v=await p.evaluate(()=>({
  n:BUY_SRC.length, id:buySrcNow().id,
  sel:getComputedStyle($('buySrcSel')).display,
  top:$('mwTopImport').textContent, inTab:$('csvMwImport').textContent,
  file:buySrcNow().file }));
console.log('   '+JSON.stringify(v));
ok(v.n===1&&v.id==='mw','★いまの仕入れ先は MW だけ');
ok(v.sel==='none','★1つだけのときは選択欄を出さない（今までの見た目）');
ok(v.top==='MWの在庫CSVを取り込む'&&v.inTab===v.top,
   '★ボタンの名前は仕入れ先から作る（2つのボタンは同じ名前）');
ok(v.file==='csvMwFile','★ファイル選択は仕入れ先ごとに持つ');
/* 問屋を足したときに選択欄が出て、ボタンの名前が変わること。 */
v=await p.evaluate(()=>{
  BUY_SRC.push({ id:'xx', name:'ためしの問屋', short:'XX', file:'csvMwFile',
                 enc:'shift_jis' });
  buySrcRender();
  $('buySrcSel').value='xx';
  $('buySrcSel').dispatchEvent(new Event('change',{bubbles:true}));
  const r={ sel:getComputedStyle($('buySrcSel')).display,
    opts:Array.prototype.map.call($('buySrcSel').options,(o)=>o.value),
    btn:$('mwTopImport').textContent, now:buySrcNow().id };
  BUY_SRC.pop();
  try{ localStorage.removeItem('pj:buysrc:v1'); }catch(e){}
  buySrcRender();
  return r;
});
console.log('   '+JSON.stringify(v));
ok(v.sel!=='none'&&v.opts.join()==='mw,xx','★★2つ以上あれば選択欄が出る');
ok(v.btn==='XXの在庫CSVを取り込む'&&v.now==='xx',
   '★★選んだ仕入れ先の名前になる（今回は MW だけで動く）');

console.log('\n=== ブックマークレットは貼り付け欄と同じ場所 ===');
v=await p.evaluate(()=>({
  inBuy:!!document.querySelector('#mwPicPasteBox #mwMarkCopy'),
  inCfg:!!document.querySelector('#cfgAmzBox #mwMarkCopy'),
  cfgNote:(document.querySelector('#cfgAmzBox')||{}).textContent||'' }));
ok(v.inBuy&&!v.inCfg,'★★ブックマークレットは仕入れタブの「MW の写真」にある');
ok(/仕入れタブ/.test(v.cfgNote),'★⚙には移した先の案内だけ残す');

console.log('\n=== 長い一覧は既定10件＋「さらに10件」「すべて表示」===');
const seed=async(n)=>await p.evaluate((n)=>{
  csvTrash=[];
  for(let i=0;i<n;i++)csvTrash.push({ at:'2026-11-07T00:00:00Z',
    r:{ id:'t'+i, sku:'SKU'+i, cat:'act', pics:[], titleJa:'商品'+i } });
  switchTab('G'); csvTrashRender();
  return true;
},n);
await seed(26);
const trash=()=>p.evaluate(()=>({
  rows:document.querySelectorAll('#csvTrashList .lcard').length,
  sum:$('csvTrashSum').textContent,
  more:!!document.querySelector('#csvTrashList [data-listmore]'),
  all:!!document.querySelector('#csvTrashList [data-listall]'),
  cnt:(document.querySelector('#csvTrashList .cnt')||{}).textContent||'' }));
v=await trash();
console.log('   '+JSON.stringify(v));
ok(v.rows===10,'★★既定は10件だけ出す');
ok(/ゴミ箱（26件）/.test(v.sum),'★★件数は全件（26件）で出す');
ok(v.more&&v.all,'★「さらに10件」「すべて表示」が出る');
ok(/全 26件中 10件まで/.test(v.cnt),'★どこまで出しているかを書く');
await p.evaluate(()=>document.querySelector('#csvTrashList [data-listmore]').click());
v=await trash();
console.log('   さらに10件: '+v.rows+'件');
ok(v.rows===20,'★★「さらに10件」で20件になる');
await p.evaluate(()=>document.querySelector('#csvTrashList [data-listall]').click());
v=await trash();
ok(v.rows===26&&!v.more,'★★「すべて表示」で全部出る');
/* 表示件数は端末に覚える（開き直しても同じ）。 */
const saved=await p.evaluate(()=>localStorage.getItem('pj:listn:v1')||'');
console.log('   覚えた件数: '+saved);
ok(/"csvtrash":\d+/.test(saved),'★★表示件数を端末に覚える');
await p.reload(); await p.waitForTimeout(400);
await seed(26);
v=await trash();
ok(v.rows===26,'★★開き直しても広げたまま');

console.log('\n=== 一覧（出品リスト）も10件＋広げられる ===');
v=await p.evaluate(()=>{
  localStorage.removeItem('pj:listn:v1');
  csvList=[];
  for(let i=0;i<25;i++)csvList.push({ id:'r'+i, sku:'S'+i, cat:'act', pics:[],
    titleJa:'行'+i, cost:1000, weight:300, cond:'sealed' });
  csvSaveList(); switchTab('D'); csvRender();
  return { per:$('csvPerPage').value,
    rows:document.querySelectorAll('#csvList .lcard').length,
    more:!!document.querySelector('#csvPagerTop [data-pagemore]'),
    all:!!document.querySelector('#csvPagerTop [data-pageall]'),
    cnt:($('csvPagerTop').textContent||'').replace(/\s+/g,' ') };
});
console.log('   '+JSON.stringify(v));
ok(v.per==='10','★1ページの件数の既定は10件');
ok(v.more&&v.all,'★ページ送りの帯にも「さらに10件」「すべて表示」が出る');
ok(/全 25件中 1〜10件目/.test(v.cnt),'★件数は全件で出す');
v=await p.evaluate(()=>{
  document.querySelector('#csvPagerTop [data-pagemore]').click();
  return { rows:document.querySelectorAll('#csvList .lcard').length,
    per:$('csvPerPage').value };
});
console.log('   '+JSON.stringify(v));
ok(v.rows===20,'★★「さらに10件」で20件出る（⚙の件数は10件のまま）');
ok(v.per==='10','★⚙の「1ページの件数」は変えない');
v=await p.evaluate(()=>{
  document.querySelector('#csvPagerTop [data-pageall]').click();
  return document.querySelectorAll('#csvList .lcard').length;
});
ok(v===25,'★★「すべて表示」で全部出る');

console.log('\n=== 長い説明は畳んである ===');
v=await p.evaluate(()=>{
  const d=Array.prototype.slice.call(document.querySelectorAll('details.exp[data-exp]'));
  return { n:d.length, open:d.filter((x)=>x.open).length,
    keys:d.map((x)=>x.getAttribute('data-exp')).slice(0,40) };
});
console.log('   説明 '+v.n+'か所／開いている '+v.open+'か所');
ok(v.n>=20,'★長い説明は「説明 ▸」に畳んである（'+v.n+'か所）');
ok(v.open===0,'★★既定はぜんぶ畳んだ状態');
ok(v.keys.indexOf('cfgRankCap')>=0&&v.keys.indexOf('cfgDgType')>=0,
   '★⚙の長い説明も畳む（ランキングの上限・自動申告の種類）');

console.log('\n=== 各タブの上に目次 ===');
v=await p.evaluate(()=>{
  const out={};
  [['D','tocCsv'],['E','tocSync'],['F','tocAmz'],['M','tocBuyMw'],
   ['B','tocListing'],['G','cfgToc']].forEach(([t,n])=>{
    switchTab(t);
    out[t]=Array.prototype.map.call(document.querySelectorAll('#'+n+' button'),
      (b)=>b.textContent);
  });
  return out;
});
console.log('   '+JSON.stringify(v));
ok(v.D.length>=4&&v.E.length>=5&&v.F.length>=4&&v.M.length>=3&&v.G.length===5,
   '★★どのタブにも目次が出る');
ok(v.G.join('|')==='1. 値付け|2. 自動|3. 仕入れ|4. 出品の既定値|5. ほぼ触らない',
   '★★⚙は5つのまとまり');
/* 押すとその欄へ飛び、畳んでいた欄は開く。 */
v=await p.evaluate(()=>{
  switchTab('D');
  const box=$('csvLogBox'); box.open=false;
  const b=Array.prototype.slice.call(document.querySelectorAll('#tocCsv button'))
    .filter((x)=>/書き出し済みログ/.test(x.textContent))[0];
  b.click();
  return { open:box.open };
});
ok(v.open===true,'★★目次を押すと、畳んであった欄も開く');

console.log('\n=== 使い方マニュアルは別のページ ===');
const man=fs.readFileSync(path.join(__dirname,'..','manual.html'),'utf8');
ok(/使い方マニュアル/.test(man),'★manual.html がある');
ok(/1\. 毎日の作業/.test(man)&&/2\. 仕入れ（刈取/.test(man)
   &&/3\. eBay 出品/.test(man)&&/4\. 販売連携/.test(man)&&/5\. 困ったとき/.test(man),
   '★★5つの章がぜんぶ移っている（機能・文章は削らない）');
ok(/manual\.html/.test(fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8')),
   '★★sw.js のキャッシュに入れた（オフラインでも読める）');
v=await p.evaluate(()=>{
  switchTab('G');
  const a=document.querySelector('#cfgManBox a[href="manual.html"]');
  return { link:!!a, body:!!document.querySelector('#cfgManBox details.manc'),
    text:(a?a.textContent:'') };
});
ok(v.link&&!v.body,'★★⚙にはリンクだけ（本文は index.html から外した）');
ok(/マニュアルを開く/.test(v.text),'★リンクの名前');
/* マニュアルのページが開けて、章が畳んである。 */
const mp=await p.context().newPage();
await mp.goto('file://'+path.join(__dirname,'..','manual.html'));
const mv=await mp.evaluate(()=>({
  n:document.querySelectorAll('details.manc').length,
  open:Array.prototype.filter.call(document.querySelectorAll('details.manc'),
    (d)=>d.open).length,
  back:!!document.querySelector('a[href="index.html"]') }));
console.log('   '+JSON.stringify(mv));
ok(mv.n===5,'★★ページを開くと5つの章が出る');
ok(mv.open===0,'★章は畳んである（タップで開く）');
ok(mv.back,'★「pj に戻る」がある');
await mp.close();
await T.done();
})();
