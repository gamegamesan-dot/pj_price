/* 英題の末尾に産地の語を付ける（6.57）
   ・「 Japan Import」が80文字に収まれば付ける
   ・入らなければ「 Japan」、それも入らなければ何も付けない（本体は削らない）
   ・すでに Japan がある題名（ゲームの「Japan Ver.」など）には重ねず、
     収まるときだけ「 Import」を足す
   ・状態の語（Cartridge Only / Loose No Box）より後ろ＝一番最後に付く
   ・編集済みの行は変えない。文字数カウンターは付けたあとの長さで出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('英題の末尾に Japan / Japan Import を付ける');
const ok = T.ok;
(async()=>{
const p=await T.open();

const game=async(name,used,cart)=>await p.evaluate((a)=>
  gameTitleFrom(a.used!==false,'Nintendo Switch',a.name,!!a.cart),
  {name:name,used:used,cart:cart});
const fig=async(o)=>await p.evaluate((o)=>figTitleFrom(true,o.p,!!o.loose),o);

console.log('=== ゲーム：3通りの長さ ===');
/* 「Used Nintendo Switch 」で21文字。ソフト名の長さで3通りを作る。 */
let g=await game('Super Mario Odyssey');
console.log('   '+g.text+'（'+g.text.length+'）');
ok(/ Japan Import$/.test(g.text)&&g.text.length<=80,
   '★★短い題名には「Japan Import」が付く');
ok(g.dropped.length===0,'★何も省いていない');

g=await game('Super Mario Odyssey Deluxe Collectors Edition Set');
console.log('   '+g.text+'（'+g.text.length+'）');
ok(/ Japan$/.test(g.text)&&!/Import/.test(g.text)&&g.text.length<=80,
   '★★「Japan Import」が入らない長さなら「Japan」だけ付く');
ok(g.dropped.join()==='Import','★入らなかった語だけを知らせる');

g=await game('Super Mario Odyssey Deluxe Collectors Special Edition Set');
console.log('   '+g.text+'（'+g.text.length+'）');
ok(!/Japan/.test(g.text)&&g.text.length<=80,
   '★★どちらも入らなければ何も付けない（本体は削らない）');
ok(g.dropped.join()==='Japan Import','★付けられなかったことを知らせる');

console.log('\n=== ゲーム：Japan Ver. が入っている ===');
g=await game('Dragon Quest XI Japan Ver.');
console.log('   '+g.text+'（'+g.text.length+'）');
ok(/Japan Ver\. Import$/.test(g.text),
   '★★Japan を重ねず、末尾に「Import」だけ足す');
ok((g.text.match(/Japan/g)||[]).length===1,'★★Japan は1回だけ');
g=await game('Dragon Quest XI Super Deluxe Collectors Edition Japan Ver.');
console.log('   '+g.text+'（'+g.text.length+'）');
ok(/Japan Ver\.$/.test(g.text)&&!/Import/.test(g.text),
   '★入らなければ Import も付けない');

console.log('\n=== 状態の語より後ろに付く ===');
g=await game('Pokemon Scarlet',true,true);
console.log('   '+g.text+'（'+g.text.length+'）');
ok(/Cartridge Only Japan Import$/.test(g.text),
   '★★「Cartridge Only」の後ろ（一番最後）に付く');
ok(/^Used /.test(g.text),'★先頭の Used は今までどおり');

console.log('\n=== フィギュア ===');
let f=await fig({p:{brand:'Bandai',series:'Gundam',chara:'Satan Gundam',line:'SDX'}});
console.log('   '+f.text+'（'+f.text.length+'）');
ok(/ Japan Import$/.test(f.text)&&f.text.length<=80,'★★フィギュアにも付く');
ok(/Figure Japan Import$/.test(f.text),'★★末尾の Figure より後ろに付く');
f=await fig({p:{brand:'Bandai Spirits',series:'Mobile Suit Gundam SEED Destiny',
  chara:'Strike Freedom',line:'Metal Build'}});
console.log('   '+f.text+'（'+f.text.length+'）');
ok(/ Japan$/.test(f.text)&&!/Import/.test(f.text)&&f.text.length<=80,
   '★★長いときは「Japan」だけ付く');
f=await fig({p:{brand:'Bandai Spirits',series:'Mobile Suit Gundam SEED Destiny',
  chara:'Strike Freedom Gundam',line:'Metal Build'}});
console.log('   '+f.text+'（'+f.text.length+'）');
ok(!/Japan/.test(f.text)&&f.text.length<=80,'★★入らなければ付けない');
f=await fig({p:{brand:'Good Smile',series:'Japan Racing Miku',chara:'Hatsune Miku',
  line:'Nendoroid'}});
console.log('   '+f.text+'（'+f.text.length+'）');
ok(/ Import$/.test(f.text)&&(f.text.match(/Japan/g)||[]).length===1,
   '★★作品名に Japan があるときも重ねない');
f=await fig({p:{brand:'Bandai',series:'Gundam',chara:'Satan Gundam',line:'SDX'},
  loose:true});
console.log('   '+f.text+'（'+f.text.length+'）');
ok(/Loose No Box Japan Import$/.test(f.text),
   '★★箱なしの印より後ろ（一番最後）に付く');

console.log('\n=== 組み立て直しと文字数カウンター ===');
const row=async()=>await p.evaluate(()=>{
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8';
  $('csvShipProfile').value='W1000'; $('csvRetProfile').value='R';
  $('csvPayProfile').value='P'; $('csvLocation').value='Tokyo';
  csvList=[
   {id:'j1',src:'sedori',sku:'game-20261018-UG-B0JPT00001-1200',asin:'B0JPT00001',
    jan:'4900001',titleJa:'テストゲーム',titleEn:'',cat:'139973',catFixed:true,
    condId:5000,condSrc:'良い',cost:1200,qty:1,weight:150,pics:[{url:'u1'}],
    specs:{platform:'Nintendo Switch',gameName:'Super Mario Odyssey'},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',sold:'',amzLow:'',dropship:false,
    titleStatus:'ok',titleCands:[],titleNote:'',titleManual:false},
   {id:'j2',src:'sedori',sku:'game-20261018-UG-B0JPT00002-1200',asin:'B0JPT00002',
    jan:'4900002',titleJa:'手で直したゲーム',
    titleEn:'My Own Hand Written Title',cat:'139973',catFixed:true,
    condId:5000,condSrc:'良い',cost:1200,qty:1,weight:150,pics:[{url:'u1'}],
    specs:{platform:'Nintendo Switch',gameName:'Super Mario Odyssey'},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',sold:'',amzLow:'',dropship:false,
    titleStatus:'ok',titleCands:[],titleNote:'',titleManual:true}];
  csvPick={}; syncData=null;
  /* 英語名（KV に残っているのはこれだけ）から組み立て直す。 */
  csvApplyName(csvRowById('j1'),'Super Mario Odyssey');
  csvList.forEach(csvRecalc); csvSaveList();
  switchTab('D'); csvRender();
  const d=document.querySelector('#csvList [data-row="j1"]');
  return { en:csvRowById('j1').titleEn, manual:csvRowById('j2').titleEn,
    ta:d.querySelector('[data-ten]').value,
    count:d.querySelector('[data-ten]').parentNode.nextSibling.textContent };
});
const r=await row();
console.log('   '+JSON.stringify(r));
ok(/ Japan Import$/.test(r.en),
   '★★英語名から組み立て直すだけで新しい決まりが効く（KV は英語名だけ）');
ok(r.manual==='My Own Hand Written Title','★★編集済みの行は変えない');
ok(r.ta===r.en&&r.count.indexOf(String(r.en.length)+' / 80')===0,
   '★★文字数カウンターは付けたあとの長さで出す');

console.log('\n=== 書き出す題名も同じ ===');
const csv=await p.evaluate(()=>csvRowFor(csvRowById('j1'))['*Title']);
console.log('   '+csv);
ok(/ Japan Import$/.test(csv),'★CSVに書き出す題名にも付く');

T.done();
})();
