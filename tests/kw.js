/* 相場を調べる検索語（6.42）
   メルカリ・ヤフオクは「商品ライン＋キャラクター名」だけで引く。
   ゲームは「ソフト名＋機種」。手で直した検索語は D1 に残して両方のタブで使う。 */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('検索語（商品ライン＋キャラクター名）');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.click('#tabD');

console.log('=== フィギュア・ホビー（依頼の4例）===');
const fig=await p.evaluate(()=>{
  const f=(t)=>csvKwFig(t);
  return {
    a:f('TAMASHII NATIONS S.H.フィギュアーツ ドラゴンボール超 スーパーヒーロー ピッコロ'
       +' SUPER HERO（再販版） 約160mm PVC&ABS製 塗装済み可動フィギュア'),
    b:f('S.H.フィギュアーツ ONE PIECE ナミ -冒険の夜明け- 約145mm ABS&PVC製'
       +' 塗装済み可動フィギュア'),
    c:f('ねんどろいど リコリス・リコイル 錦木千束 ノンスケール ABS&PVC製'
       +' 塗装済み可動フィギュア'),
    d:f('TAMASHII NATIONS 魂EFFECT SMOKE White Ver. for S.H.Figuarts 約135mm'
       +' PVC&ABS製 塗装済みエフェクトパーツ'),
    e:f('グッドスマイルカンパニー POP UP PARADE 鬼滅の刃 竈門炭治郎 ノンスケール'
       +' PVC製 塗装済み完成品フィギュア'),
    g:f('TAMASHII NATIONS S.H.フィギュアーツmini 鬼滅の刃 竈門禰豆子 約90mm PVC&ABS製'),
    h:f('バンプレスト ヌードルストッパーフィギュア 五等分の花嫁∬ 中野三玖 約140mm PVC製'),
    i:f('セガ 初音ミク Project DIVA MEGA39\'s ルミナスタ シュープリーム ノンスケール'
       +' ABS&PVC製 塗装済み完成品フィギュア'),
    // 辞書に無い商品ライン（ARTFX J）
    j:f('コトブキヤ ARTFX J 呪術廻戦 五条悟 1/8スケール PVC製 塗装済み完成品フィギュア'),
    // 版の言葉だけの行（キャラが取れない）
    k:f('S.H.フィギュアーツ（真骨彫製法） 仮面ライダーBLACK RX 約150mm PVC&ABS製')
  };
});
Object.keys(fig).forEach(k=>console.log('   '+k+': '+fig[k]));
ok(fig.a==='フィギュアーツ ピッコロ','★「S.H.フィギュアーツ …ピッコロ…」→ フィギュアーツ ピッコロ');
ok(fig.b==='フィギュアーツ ナミ','★「ONE PIECE ナミ -冒険の夜明け-」→ フィギュアーツ ナミ');
ok(fig.c==='ねんどろいど 錦木千束','★「リコリス・リコイル 錦木千束」→ ねんどろいど 錦木千束');
ok(fig.d==='魂EFFECT SMOKE','★「魂EFFECT SMOKE White Ver.」→ 魂EFFECT SMOKE');
ok(fig.e==='POP UP PARADE 竈門炭治郎','★POP UP PARADE は辞書の表記のまま');
ok(fig.g==='フィギュアーツmini 竈門禰豆子','★figuarts mini は「フィギュアーツmini」');
ok(fig.h==='ヌードルストッパー 中野三玖','★プライズ系（ヌードルストッパー）も辞書から');
ok(fig.i.indexOf('Luminasta')===0,'★ルミナスタ → Luminasta');
ok(!/コトブキヤ/.test(fig.j)&&!/スケール/.test(fig.j)&&!/PVC/.test(fig.j),
   '★辞書に無いラインでも、メーカー名・サイズ・素材は消える');
ok(fig.j==='ARTFX J 呪術廻戦 五条悟','★辞書に無いラインは短くしすぎない（掃除だけ）');
ok(fig.k.indexOf('フィギュアーツ')===0&&!/真骨彫/.test(fig.k),
   '★（…）の中は落とす');
ok(Object.keys(fig).every(k=>!/TAMASHII|NATIONS|mm|PVC|ABS|塗装済み|再販|Ver/i.test(fig[k])),
   '★メーカー名・サイズ・素材・塗装済み・再販・Ver. はどの行にも残らない');

console.log('\n=== ゲーム（ソフト名＋機種）===');
const game=await p.evaluate(()=>{
  const g=(t)=>csvKwGame(t);
  return {
    a:g('お姉チャンバラ vorteX（Xbox 360）'),
    b:g('ポケットモンスター シャイニングパール -Switch'),
    c:g('【CEROレーティング「Z」】ペルソナ5 ザ・ロイヤル プラチナコレクション - PS4'),
    d:g('星のカービィ ディスカバリー -Switch 特典なし'),
    e:g('三国志大戦DS'),
    f:g('ファイナルファンタジーX HD リマスター PlayStation2 the Best - PS3'),
    // 機種が商品名に無い行は、eBayの機種名（specs.platform）から付ける
    h:csvKwGame('メタルギアソリッド3','Sony PlayStation 2')
  };
});
Object.keys(game).forEach(k=>console.log('   '+k+': '+game[k]));
ok(game.a==='お姉チャンバラ vorteX Xbox360','★「お姉チャンバラ vorteX Xbox360」');
ok(game.b==='ポケットモンスター シャイニングパール Switch','★機種は短い表記で1つだけ');
ok(game.c==='ペルソナ5 ザ・ロイヤル PS4',
   '★【CERO…】と廉価版名（プラチナコレクション）を落とす');
ok(game.d==='星のカービィ ディスカバリー Switch','★特典の説明を落とす');
ok(game.e==='三国志大戦 DS',
   '★区切りなしの機種名（三国志大戦DS）でも、ソフト名を削らずに DS を付ける');
ok(!/the Best/i.test(game.f)&&/PS3$/.test(game.f),'★廉価版名（the Best）を落とす');
ok(game.h==='メタルギアソリッド3 PS2',
   '★商品名に機種が無ければ eBay の機種名から付ける');

console.log('\n=== 行の検索語（出品CSVタブ）===');
const setup=async()=>await p.evaluate(()=>{
  $('fx').value='160'; $('syncApi').value='https://pj-sync.example.workers.dev';
  $('syncKey').value='k';
  window.__posts=[];
  const real=window.fetch;
  window.fetch=function(u,i){
    if(/\/listings/.test(String(u))){
      window.__posts.push(JSON.parse(i.body).items);
      return Promise.resolve({ok:true,json:()=>Promise.resolve({accepted:1,rejected:0})});
    }
    return real(u,i);
  };
  csvList=[{id:'K1',src:'sedori',sku:'hobby-20260101-UG-B0KW000001-2500',
    asin:'B0KW000001',jan:'4901',
    titleJa:'TAMASHII NATIONS S.H.フィギュアーツ ONE PIECE ナミ -冒険の夜明け-'
      +' 約145mm ABS&PVC製 塗装済み可動フィギュア',
    titleEn:'Used Bandai S.H.Figuarts One Piece Nami Figure Japan Import',
    cat:'261055',catFixed:true,condId:3000,condSrc:'良い',cost:2500,qty:1,weight:400,
    pics:[{url:'u'}],descHtml:'<p>d</p>',specs:{origin:'Japan'},
    zeroAct:'hold',fba:true,oneOff:false,itemId:'',dropship:false,mercKw:'',
    titleStatus:'',titleCands:[],titleNote:'',titleManual:false}];
  csvPick={}; syncData=null;
  csvList.forEach(csvRecalc);
  csvSaveList(); csvRender(); $('csvListBox').open=true;
});
await setup();
const box=await p.evaluate(()=>({
  val:document.querySelector('#csvList [data-kw="K1"]').value,
  auto:csvKwOf(csvRowById('K1')), manual:csvKwManual(csvRowById('K1')) }));
console.log('   欄の値: '+JSON.stringify(box));
ok(box.val==='フィギュアーツ ナミ','★欄に短い検索語が最初から入っている');
ok(box.manual===false,'まだ手で直していない');

console.log('\n=== 手で直すと D1 に残る ===');
const edit=await p.evaluate(()=>{
  const el=document.querySelector('#csvList [data-kw="K1"]');
  el.value='フィギュアーツ ナミ 冒険の夜明け';
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return { posts:window.__posts, kw:csvKwOf(csvRowById('K1')),
    manual:csvKwManual(csvRowById('K1')),
    saved:(JSON.parse(localStorage.getItem('pj:csvlist:v1')||'[]')[0]||{}).mercKw };
});
console.log('   送った内容: '+JSON.stringify(edit.posts));
ok(edit.posts.length===1&&edit.posts[0][0].search_kw==='フィギュアーツ ナミ 冒険の夜明け'
   &&edit.posts[0][0].asin==='B0KW000001'&&edit.posts[0][0].cond==='used',
   '★D1（search_kw）に送る');
ok(edit.kw==='フィギュアーツ ナミ 冒険の夜明け'&&edit.manual===true,
   '★その行の検索語になる');
ok(edit.saved==='フィギュアーツ ナミ 冒険の夜明け','★この端末にも残る（再読み込み後も）');

console.log('\n=== 空にすると自動で作り直す ===');
const clr=await p.evaluate(()=>{
  const el=document.querySelector('#csvList [data-kw="K1"]');
  el.value='';
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return { kw:csvKwOf(csvRowById('K1')), posts:window.__posts.length,
    last:window.__posts[window.__posts.length-1][0].search_kw };
});
console.log('   '+JSON.stringify(clr));
ok(clr.kw==='フィギュアーツ ナミ','★自動の検索語に戻る');
ok(clr.last==='','★D1 にも空を送って消す');

console.log('\n=== D1 に残した検索語は両方のタブで同じ ===');
const both=await p.evaluate(()=>{
  // 出品CSVの行は手直しを消し、D1（販売連携の取り込み）に検索語がある状態にする
  csvRowById('K1').mercKw='';
  syncData={at:new Date().toISOString(),counts:{},items:[
    {asin:'B0KW000001',cond:'used',scope:'ebay',prefix:'hobby',
     ebay_sku:'E-B0KW000001-U',ebay_item_id:'550001',ebay_qty:1,ebay_price:70,
     title:'TAMASHII NATIONS S.H.フィギュアーツ ONE PIECE ナミ -冒険の夜明け- 約145mm',
     search_kw:'フィギュアーツ ナミ（手直し）',
     one_off:0,dropship:0,restocking:0,warnings:[],notes:[],state:'ok',
     fba_available:1,fba_inbound:0,fba_reserved:0},
    {asin:'B0KW000002',cond:'used',scope:'ebay',prefix:'game',
     ebay_sku:'E-B0KW000002-U',ebay_item_id:'550002',ebay_qty:1,ebay_price:30,
     title:'お姉チャンバラ vorteX（Xbox 360）',search_kw:null,
     one_off:0,dropship:0,restocking:0,warnings:[],notes:[],state:'ok',
     fba_available:1,fba_inbound:0,fba_reserved:0}]};
  csvRender();
  const r1=syncData.items[0], r2=syncData.items[1];
  return { csv:csvKwOf(csvRowById('K1')), sync:syncKwOf(r1),
    auto:syncKwAuto(r1), game:syncKwOf(r2),
    csvManual:csvKwManual(csvRowById('K1')) };
});
console.log('   '+JSON.stringify(both));
ok(both.sync==='フィギュアーツ ナミ（手直し）','★販売連携タブは D1 の検索語を使う');
ok(both.csv==='フィギュアーツ ナミ（手直し）'&&both.csvManual===true,
   '★出品CSVタブも同じ検索語になる（D1 から引く）');
ok(both.auto==='フィギュアーツ ナミ','D1 に無ければ商品名から作る');
ok(both.game==='お姉チャンバラ vorteX Xbox360',
   '★販売連携タブのゲームの行も「ソフト名＋機種」');

console.log('\n=== 販売連携タブの欄でも直せる ===');
await p.evaluate(()=>{ switchTab('E'); syncRender(); });
await openCsvBoxes(p);
const sedit=await p.evaluate(()=>{
  window.__posts=[];
  const el=document.querySelector('#syncList [data-skw^="B0KW000002"]');
  el.value='お姉チャンバラ vorteX';
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  const r2=syncData.items.find(x=>x.asin==='B0KW000002');
  const card=Array.from(document.querySelectorAll('#syncList > div'))
    .find(d=>(d.getAttribute('data-srow')||'').indexOf('B0KW000002')===0);
  return { posts:window.__posts, kw:syncKwOf(r2),
    links:Array.from(card.querySelectorAll('a.btn')).map(a=>a.textContent),
    merc:(Array.from(card.querySelectorAll('a.btn'))
      .find(a=>a.textContent==='メル 売切')||{}).href };
});
console.log('   送った内容: '+JSON.stringify(sedit.posts));
console.log('   '+sedit.merc);
ok(sedit.posts.length===1&&sedit.posts[0][0].search_kw==='お姉チャンバラ vorteX',
   '★販売連携タブからも D1 に送る');
ok(sedit.kw==='お姉チャンバラ vorteX','★その場で検索語が変わる');
ok(sedit.merc.indexOf(encodeURIComponent('お姉チャンバラ vorteX'))>=0,
   '★リンクもその場で作り直される');
ok(sedit.links.indexOf('元の名前で検索')>=0,'★「元の名前で検索」も出る');
await T.done();
})();
