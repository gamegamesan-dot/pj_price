/* アイコンのPNGを書き出す（6.53）。
   使い方: node tools/make-icons.js
   icon-src.svg / icon-src-32.svg を Chromium で開いて、必要な大きさで撮る。
   PNG はリポジトリに入れてあるので、ふだんはこれを走らせる必要はない
   （デザインを変えたときだけ走らせて、出てきたPNGも一緒にコミットする）。 */
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
function loadPlaywright(){
  const tries=['playwright','/opt/node22/lib/node_modules/playwright',
    '/usr/lib/node_modules/playwright','/usr/local/lib/node_modules/playwright'];
  for(const t of tries){ try{ return require(t); }catch(e){} }
  throw new Error('playwright が見つかりません');
}
function chromePath(){
  if(process.env.PJ_CHROME)return process.env.PJ_CHROME;
  const base=process.env.PLAYWRIGHT_BROWSERS_PATH||'/opt/pw-browsers';
  let dirs=[];
  try{ dirs=fs.readdirSync(base).filter(d=>/^chromium/.test(d)).sort(); }catch(e){ return undefined; }
  for(let i=dirs.length-1;i>=0;i--){
    const p=path.join(base,dirs[i],'chrome-linux/chrome');
    if(fs.existsSync(p))return p;
  }
  return undefined;
}
const OUT=[
  { svg:'icon-src.svg',    png:'icon-512.png',         size:512 },
  { svg:'icon-src.svg',    png:'icon-192.png',         size:192 },
  { svg:'icon-src.svg',    png:'apple-touch-icon.png', size:180 },
  { svg:'icon-src-32.svg', png:'favicon-32.png',       size:32  },
];
(async()=>{
  const {chromium}=loadPlaywright();
  const browser=await chromium.launch({executablePath:chromePath()});
  for(const o of OUT){
    const page=await browser.newPage({viewport:{width:o.size,height:o.size},
      deviceScaleFactor:1});
    const svg=fs.readFileSync(path.join(ROOT,o.svg),'utf8');
    await page.setContent('<!doctype html><html><body style="margin:0">'
      +'<div style="width:'+o.size+'px;height:'+o.size+'px">'
      +svg.replace(/width="512" height="512"/,'width="'+o.size+'" height="'+o.size+'"')
      +'</div></body></html>');
    await page.waitForTimeout(120);
    await page.screenshot({path:path.join(ROOT,o.png),
      clip:{x:0,y:0,width:o.size,height:o.size},omitBackground:false});
    await page.close();
    console.log('  '+o.png+'（'+o.size+'px）を書き出しました');
  }
  await browser.close();
})();
