/* 確認用テストの共通部分（ブラウザで動かすもの）。
   どの端末でも同じコマンドで走るように、次の3つをここで吸収する。
   ・リポジトリの場所（このファイルの1つ上）
   ・playwright の置き場所（NODE_PATH が通っていない環境でも探す）
   ・Chromium の実行ファイル（PLAYWRIGHT_BROWSERS_PATH に入っているもの） */
const fs=require('fs');
const path=require('path');

const ROOT=path.resolve(__dirname,'..');
const PAGE='file://'+path.join(ROOT,'index.html');

// playwright は端末ごとに置き場所が違うので、よくある場所を順に見る
function loadPlaywright(){
  const tries=['playwright'];
  const globals=['/opt/node22/lib/node_modules','/usr/lib/node_modules',
    '/usr/local/lib/node_modules','/opt/homebrew/lib/node_modules'];
  globals.forEach(function(d){ tries.push(path.join(d,'playwright')); });
  for(const t of tries){ try{ return require(t); }catch(e){} }
  throw new Error('playwright が見つかりません。'
    +'npm i -g playwright するか、NODE_PATH に置き場所を入れてください。');
}
/* Chromium の実行ファイル。PJ_CHROME で明示できる。
   見つからなければ playwright に任せる（undefined を返す）。 */
function chromePath(){
  if(process.env.PJ_CHROME)return process.env.PJ_CHROME;
  const base=process.env.PLAYWRIGHT_BROWSERS_PATH||'/opt/pw-browsers';
  const names=['chrome-linux/chrome','chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-win/chrome.exe'];
  let dirs=[];
  try{ dirs=fs.readdirSync(base).filter(function(d){ return /^chromium/.test(d); }).sort(); }
  catch(e){ return undefined; }
  for(let i=dirs.length-1;i>=0;i--)
    for(const n of names){
      const p=path.join(base,dirs[i],n);
      if(fs.existsSync(p))return p;
    }
  return undefined;
}

/* テスト1本の入り口。
   open() でページを開き、ok() で1項目ずつ確かめ、done() で後片付けと集計をする。
   ❌ が1つでもあれば終了コードを1にするので、まとめ実行で落ちたことが分かる。 */
function harness(title){
  let ng=0, okN=0;
  const errs=[];
  const say=(s)=>console.log(s);
  const ok=(b,l)=>{ if(b)okN++; else ng++; console.log('  '+(b?'✅':'❌')+' '+l); };
  let browser=null, page=null;
  async function open(opt){
    const {chromium}=loadPlaywright();
    browser=await chromium.launch({executablePath:chromePath()});
    const ctx=await browser.newContext(Object.assign({viewport:{width:390,height:900}},
      (opt&&opt.context)||{}));
    page=await ctx.newPage();
    page.on('pageerror',(e)=>errs.push(e.message));
    await page.goto(PAGE);
    return page;
  }
  async function done(){
    console.log('\npageerror: '+JSON.stringify(errs));
    if(errs.length)ng+=errs.length;
    // まとめ実行（tests/run.sh）が読む行。✅❌の文字は数えさせないので入れない
    console.log('RESULT '+okN+' '+ng+' '+title);
    if(browser)await browser.close();
    if(ng)process.exitCode=1;
  }
  return { ok:ok, say:say, open:open, done:done, errs:errs,
           get page(){ return page; } };
}
/* 畳んである欄を開く（出品CSVタブの「その他」・一覧、販売連携タブの価格の操作など）。
   ボタンは畳まれていると Playwright から押せないので、押す前に呼ぶ。
   カードの「計算の詳細」（6.48）もここで開く（仕入値・英題・数量の欄が中にある）。 */
async function openCsvBoxes(page){
  await page.evaluate(()=>{
    ['csvListBox','csvTrashBox','syncPriceBox','syncMoreBox',
     'syncListBox','csvStockBox','csvReviewBox'].forEach(function(id){
      var el=document.getElementById(id); if(el)el.open=true;
    });
    Array.prototype.forEach.call(document.querySelectorAll('details[data-det]'),
      function(d){ d.open=true; });
    // ⚙設定のグループ（6.50）も開く
    /* 開いたことを端末に覚えさせない（data-cfgauto はアプリ側の仕組み）。 */
    Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
      function(d){ if(!d.open){ d.setAttribute('data-cfgauto','1'); d.open=true; } });
  });
  await page.waitForTimeout(80);
}
/* カードの「計算の詳細」だけを開く（一覧を作り直したあとに呼ぶ）。 */
async function openRowDet(page){
  await page.evaluate(()=>{
    Array.prototype.forEach.call(document.querySelectorAll('details[data-det]'),
      function(d){ d.open=true; });
  });
  await page.waitForTimeout(60);
}
/* ⚙設定に移したボタン（6.46：英題の作り直し・無在庫オンオフ・配送ポリシー変更CSV・
   数量更新CSV・ゴミ箱）を押す。畳んであるタブのボタンは Playwright から押せないので、
   設定画面を出して押し、終わったら元のタブ（既定は出品CSV）に戻す。
   動きは画面の置き場所が変わっただけで、ボタン自体は今までと同じ。
   back に false を渡すと設定画面に残る（出品CSVタブに戻ると一覧と結果の文を
   作り直すので、結果の文を読みたいときはこちらを使う）。 */
async function clickCfg(page,sel,back){
  await page.evaluate(()=>{
    switchTab('G');
    /* ⚙設定は使う頻度でグループに畳んである（6.50）。
       押したいボタンが中にあるので、設定画面の折りたたみは全部開く。 */
    /* 開いたことを端末に覚えさせない（data-cfgauto はアプリ側の仕組み）。 */
    Array.prototype.forEach.call(document.querySelectorAll('#tabCfg details'),
      function(d){ if(!d.open){ d.setAttribute('data-cfgauto','1'); d.open=true; } });
  });
  // 設定画面とボタンが出るのを待ってから押す（遅い端末でも落ちないように）
  await page.waitForSelector('#tabCfg',{state:'visible'});
  await page.waitForSelector(sel,{state:'visible'});
  await page.click(sel);
  await page.waitForTimeout(120);
  if(back!==false){
    await page.evaluate((b)=>{ switchTab(b); },back||'D');
    await page.waitForTimeout(80);
  }
}
module.exports={ ROOT, PAGE, harness, loadPlaywright, chromePath, openCsvBoxes,
                 openRowDet, clickCfg };
