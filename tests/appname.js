/* ホーム画面の名前とアイコン（6.53）
   ・manifest：name「Play Japan 出品ツール」／short_name「PJ出品」
   ・apple-mobile-web-app-title「PJ出品」／<title> と画面上部の見出しも新しい名前
   ・アイコン4つ（192・512・apple-touch・favicon-32）が中身のあるPNGで、
     manifest と sw.js の先読みにも入っている
   ・色はアプリと同じ黄色（#f5d400）と黒（#1b1a17）だけ */
const { harness, ROOT } = require('./lib');
const T = harness('ホーム画面の名前とアイコン');
const ok = T.ok;
const fs=require('fs');
const path=require('path');
(async()=>{
const p=await T.open();
await p.waitForTimeout(200);

console.log('=== 名前 ===');
const name=await p.evaluate(()=>({
  title:document.title,
  apple:(document.querySelector('meta[name="apple-mobile-web-app-title"]')||{}).content,
  /* 版をタイトルの横に出したので（6.104）、見出しそのものは .t2n を見る。 */
  head:$('tabCfg')?document.querySelector('header .t2n').textContent:'',
  ver:(document.querySelector('header #appVer')||{}).textContent||'',
  t1:document.querySelector('header .t1').textContent,
  manifest:(document.querySelector('link[rel="manifest"]')||{}).getAttribute('href') }));
console.log('   '+JSON.stringify(name));
ok(name.title==='Play Japan 出品ツール','★<title> は「Play Japan 出品ツール」');
ok(name.apple==='PJ出品','★★iPhoneのホーム画面の名前は「PJ出品」');
ok(name.head==='Play Japan 出品ツール','★★画面上部の見出しも「Play Japan 出品ツール」');
ok(/^v\d+$/.test(name.ver),'★★見出しの横に版が出る（6.104・くわしくは appver.js）');
ok(!/値付け計算機/.test(name.title+name.apple+name.head),'★古い名前は残っていない');

console.log('\n=== manifest ===');
const mf=JSON.parse(fs.readFileSync(path.join(ROOT,'manifest.webmanifest'),'utf8'));
console.log('   '+JSON.stringify({name:mf.name,short:mf.short_name}));
ok(mf.name==='Play Japan 出品ツール','★正式名（name）');
ok(mf.short_name==='PJ出品','★★ホーム画面の名前（short_name）は「PJ出品」');
ok(mf.icons.length===3&&mf.icons.some(x=>x.purpose==='maskable'),
   '★アイコンは192・512・maskable の3つ');
ok(mf.theme_color==='#1b1a17'&&mf.background_color==='#1b1a17',
   '★背景・テーマ色はアプリと同じ黒');

console.log('\n=== アイコンのPNG ===');
const want={'icon-192.png':192,'icon-512.png':512,'apple-touch-icon.png':180,
            'favicon-32.png':32};
const png=(f)=>{
  const b=fs.readFileSync(path.join(ROOT,f));
  // PNGの先頭8バイト＋IHDR（幅・高さ）
  const sig=b.slice(0,8).toString('hex')==='89504e470d0a1a0a';
  return { sig:sig, w:b.readUInt32BE(16), h:b.readUInt32BE(20), size:b.length };
};
Object.keys(want).forEach(f=>{
  const i=png(f);
  console.log('   '+f+': '+i.w+'×'+i.h+'（'+i.size+'バイト）');
  ok(i.sig&&i.w===want[f]&&i.h===want[f]&&i.size>300,
     '★'+f+' は '+want[f]+'px のPNG');
});

console.log('\n=== 使う色（黄色と黒だけ）===');
/* PNG を Node だけで読む（zlib）。8bit の RGB/RGBA だけ扱えれば足りる。 */
function pngPixels(file){
  const zlib=require('zlib');
  const b=fs.readFileSync(path.join(ROOT,file));
  const w=b.readUInt32BE(16), h=b.readUInt32BE(20);
  const depth=b[24], type=b[25];
  if(depth!==8||(type!==2&&type!==6))throw new Error('想定外のPNG: depth='+depth+' type='+type);
  const ch=(type===6)?4:3;
  let i=8, idat=[];
  while(i<b.length){
    const len=b.readUInt32BE(i), tag=b.slice(i+4,i+8).toString('ascii');
    if(tag==='IDAT')idat.push(b.slice(i+8,i+8+len));
    i+=12+len;
  }
  const raw=zlib.inflateSync(Buffer.concat(idat));
  const out=Buffer.alloc(w*h*ch);
  const stride=w*ch;
  let prev=Buffer.alloc(stride);
  for(let y=0;y<h;y++){
    const f=raw[y*(stride+1)];
    const line=raw.slice(y*(stride+1)+1,y*(stride+1)+1+stride);
    const cur=Buffer.alloc(stride);
    for(let x=0;x<stride;x++){
      const a=(x>=ch)?cur[x-ch]:0, bb=prev[x], c=(x>=ch)?prev[x-ch]:0, v=line[x];
      let val;
      if(f===0)val=v;
      else if(f===1)val=v+a;
      else if(f===2)val=v+bb;
      else if(f===3)val=v+((a+bb)>>1);
      else{ const pp=a+bb-c, pa=Math.abs(pp-a), pb=Math.abs(pp-bb), pc=Math.abs(pp-c);
            val=v+((pa<=pb&&pa<=pc)?a:(pb<=pc?bb:c)); }
      cur[x]=val&255;
    }
    cur.copy(out,y*stride);
    prev=cur;
  }
  return { w:w, h:h, ch:ch, px:out };
}
const im=pngPixels('icon-192.png');
const hit={ yellow:0, ink:0, edge:0, other:0 };
for(let i=0;i<im.px.length;i+=im.ch){
  const r=im.px[i], g=im.px[i+1], b2=im.px[i+2];
  const near=(x,y,z)=>Math.abs(r-x)<26&&Math.abs(g-y)<26&&Math.abs(b2-z)<26;
  if(near(0xf5,0xd4,0x00))hit.yellow++;
  else if(near(0x1b,0x1a,0x17))hit.ink++;
  else if(near(0xd4,0xb8,0x00))hit.edge++;
  else hit.other++;
}
const total=im.w*im.h;
console.log('   '+im.w+'×'+im.h+' '+JSON.stringify(hit));
ok(hit.yellow>8000&&hit.ink>5000,'★黄色と黒が主役');
ok(hit.edge>200,'★下の縁（#d4b800）も入っている（アプリの値札の帯と同じ）');
ok(hit.other/total<0.12,
   '★★ほかの色はほとんど無い（境目のぼかしだけ。eBayの4色は使っていない）');
const src=fs.readFileSync(path.join(ROOT,'icon-src.svg'),'utf8');
const cols=[...new Set((src.match(/#[0-9a-fA-F]{6}/g)||[]).map(x=>x.toLowerCase()))].sort();
console.log('   SVGの色: '+JSON.stringify(cols));
ok(cols.join()==='#1b1a17,#d4b800,#f5d400',
   '★★元のSVGも「黄色・縁・黒」の3色だけ');
// 絵の部分（コメントを除く）に eBay の文字が無いこと
const draw=src.replace(/<!--[\s\S]*?-->/g,'');
ok(!/ebay/i.test(draw)&&!/<image|xlink:href/.test(draw),
   '★eBay の名前やロゴは使っていない（外から画像も持ってこない）');

console.log('\n=== sw.js の先読み ===');
const sw=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
['icon-192.png','icon-512.png','apple-touch-icon.png','favicon-32.png',
 'manifest.webmanifest'].forEach(f=>{
  ok(sw.indexOf("'./"+f+"'")>=0,'★sw.js が '+f+' を先読みする');
});
const m=/const V = '(pj-pricing-v\d+)'/.exec(sw);
const av=/var APP_V='(v\d+)'/.exec(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'));
console.log('   '+m[1]+' / '+av[1]);
ok(m[1]==='pj-pricing-'+av[1],'★sw.js と APP_V が同じ番号');

await T.done();
})();
