/* GitHub Pages（公開）が壊れないか（8.25・2026-11-14 の不具合）

   pj は素の HTML なので Jekyll は要らない。ところが .md に Shopify の
   Liquid（{% render %} など）を書いたら、Jekyll がそれを**自分の Liquid**
   として読んで公開のビルドが落ちた
   （pages build and deployment #313：Unknown tag 'render'）。

   ① リポジトリ直下に .nojekyll がある（Jekyll を通さない）
   ② .md の中の Liquid は {% raw %} 〜 {% endraw %} の中にある
      （.nojekyll が外れても壊れないように）
   ③ Jekyll が要るもの（_config.yml・_layouts など）が無い
   ④ 公開に要るファイル（index.html・sw.js・shared/*.js）がある */
import { harness } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
const T=harness('GitHub Pages が壊れないか（8.25）');
const ok=T.ok;
const ROOT=path.resolve(new URL('.',import.meta.url).pathname,'..');
const R=(p)=>path.join(ROOT,p);
const has=(p)=>fs.existsSync(R(p));

console.log('=== ① .nojekyll ===');
ok(has('.nojekyll'),'★★★リポジトリ直下に .nojekyll がある（Jekyll を通さない）');
ok(fs.statSync(R('.nojekyll')).size===0,'★中身は空でよい');

console.log('=== ③ Jekyll の設定が無い（素の HTML で公開している）===');
['_config.yml','_config.yaml','_layouts','_includes','Gemfile'].forEach((x)=>{
  ok(!has(x),'★'+x+' は無い（Jekyll は要らない）');
});

console.log('=== ④ 公開に要るファイル ===');
['index.html','manual.html','sw.js','manifest.webmanifest',
 'shared/pricing.js','shared/shopcsv.js','shared/mgate.js'].forEach((x)=>{
  ok(has(x),'★'+x+' がある');
});

console.log('=== ② .md の中の Liquid は raw の中だけ ===');
{
  const mds=fs.readdirSync(ROOT).filter((f)=>f.endsWith('.md'));
  console.log('   見た .md：'+mds.length+'件');
  let bad=[];
  mds.forEach((f)=>{
    const s=fs.readFileSync(R(f),'utf8');
    /* raw 〜 endraw を取り除いた残りに Liquid があったら、公開が落ちる。 */
    const out=s.replace(/\{%\s*raw\s*%\}[\s\S]*?\{%\s*endraw\s*%\}/g,'');
    out.split('\n').forEach((l,i)=>{
      if(/\{%/.test(l)||/\{\{/.test(l))bad.push(f+':'+(i+1)+'　'+l.trim().slice(0,60));
    });
    /* raw の数が合っているか（閉じ忘れると、そこから下がぜんぶ raw になる）。 */
    const a=(s.match(/\{%\s*raw\s*%\}/g)||[]).length;
    const b=(s.match(/\{%\s*endraw\s*%\}/g)||[]).length;
    if(a!==b)bad.push(f+'　raw '+a+'個・endraw '+b+'個');
  });
  if(bad.length)console.log('   '+bad.join('\n   '));
  ok(!bad.length,'★★★raw の外に Liquid が無い（Jekyll が読んでも落ちない）');
  /* 手順書には Liquid が入っている（この見張りが効いていることの確かめ）。 */
  const g=fs.readFileSync(R('pj_price_追加仕様_Shopify会員用の鍵.md'),'utf8');
  ok(/\{%\s*raw\s*%\}/.test(g),'★★手順書は raw で囲んである');
  ok(/render 'member-gate'/.test(g),'★★手順書に Liquid が入っている');
}

console.log('=== shopify/ のファイル（公開されても困らないか）===');
{
  const dir=R('shopify');
  const list=[];
  const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).forEach((e)=>{
    const p=path.join(d,e.name);
    if(e.isDirectory())walk(p); else list.push(p);
  });
  walk(dir);
  console.log('   '+list.map((x)=>path.relative(ROOT,x)).join('／'));
  ok(list.length>=3,'★貼るファイルがある');
  const all=list.map((x)=>fs.readFileSync(x,'utf8')).join('\n');
  /* 鍵・トークン・Webhook は入れない（【L】【N】【Y】の決まり）。 */
  ok(!/(shpat_|shpca_|shppa_|Bot\s+[A-Za-z0-9._-]{30,})/.test(all),
     '★★★Shopify・Discord のトークンが入っていない');
  ok(!/discord\.com\/api\/webhooks\//.test(all),
     '★★★Webhook の URL が入っていない');
  ok(!/@gmail\.com|@ocean/.test(all),'★★メールアドレスが入っていない');
  ok(!/matchingworld|マッチングワールド/i.test(all),
     '★★★仕入れ先（MW）の名前が入っていない（会員に見せない・§8.2）');
}

T.done();
