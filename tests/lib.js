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
/* 出品CSVタブの畳んである欄（在庫・数量／売値の見直し）を開く。
   ボタンは畳まれていると Playwright から押せないので、押す前に呼ぶ。 */
async function openCsvBoxes(page){
  await page.evaluate(()=>{
    ['csvStockBox','csvReviewBox','csvListBox'].forEach(function(id){
      var el=document.getElementById(id); if(el)el.open=true;
    });
  });
  await page.waitForTimeout(80);
}
module.exports={ ROOT, PAGE, harness, loadPlaywright, chromePath, openCsvBoxes };
