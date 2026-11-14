/* 決まり：会員用商品の鍵（8.24・カジの依頼・Shopify のテーマ Liquid）

   SHOPLOCK（顧客タグ member-list があるかだけ見る）をやめて、
   テーマの Liquid で「プラン（grade-◯◯）まで見る鍵」にする。
   判定は shared/mgate.js（pj）と shopify/snippets/member-gate.liquid
   （Shopify）の**2か所に同じ順で**書いてあるので、ここで
   ・組み合わせの表（見られる／見られない）
   ・pj が書き出す CSV のタグが、その決まりと合っているか
   ・Liquid に決まりがそのまま入っているか（文字で確かめる）
   を当たる。 */
import { harness } from './lib.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const M=require('../shared/mgate.js');
const SHOPCSV=require('../shared/shopcsv.js');
const OSSCSV=require('../shared/osscsv.js');
const SUBPLAN=require('../shared/subplan.js');
const T=harness('決まり：会員用商品の鍵（8.24）');
const ok=T.ok;
const ROOT=path.resolve(new URL('.',import.meta.url).pathname,'..');

/* 顧客：null＝ログインしていない／[]＝ログイン済みでタグなし */
const NOLOGIN=null, PLAIN=[], MEMBER=['member-list'];
const MON=['member-list','grade-monitor'];
const LIG=['member-list','grade-light'];
const STD=['member-list','grade-standard'];
const PRE=['member-list','grade-premium'];
const STAFF=['member-staff'];
const STAFF2=['member-list','member-staff','grade-monitor'];

console.log('=== 組み合わせの表（カジの4）===');
{
  const rows=[
    ['会員用でない（サービス・os-）', 'export,Nintendo Switch', NOLOGIN, true],
    ['会員用でない（ログイン済み）',  'export',                 PLAIN,   true],
    ['会員用・ログインなし',          'member-list,grade-monitor', NOLOGIN, false],
    ['会員用・会員でない',            'member-list,grade-monitor', PLAIN,   false],
    ['モニター商品・モニター会員',    'member-list,grade-monitor', MON,     true],
    ['モニター商品・ライト会員',      'member-list,grade-monitor', LIG,     false],
    ['プレミアム商品・モニター会員',  'member-list,grade-premium', MON,     false],
    ['プレミアム商品・プレミアム会員','member-list,grade-premium', PRE,     true],
    ['モニター＋スタンダード・スタンダード',
      'member-list,grade-monitor,grade-standard', STD, true],
    ['モニター＋スタンダード・ライト',
      'member-list,grade-monitor,grade-standard', LIG, false],
    ['ぜんぶのプラン（grade 4つ）・ライト',
      'member-list,grade-monitor,grade-light,grade-standard,grade-premium',
      LIG, true],
    ['grade が無い会員用商品・会員',  'member-list', MEMBER, true],
    ['grade が無い会員用商品・会員でない','member-list', PLAIN, false],
    ['社内（member-staff だけ）',     'member-list,grade-premium', STAFF, true],
    ['社内（会員タグも持つ）',        'member-list,grade-premium', STAFF2, true],
  ];
  let bad=[];
  rows.forEach((r)=>{
    const g=M.gateOf(r[1],r[2],{ url:'/products/sub-1' });
    const line='   '+(g.ok?'○':'×')+' '+r[0]
      +(g.ok?'':('　→ '+g.to));
    console.log(line);
    if(g.ok!==r[3])bad.push(r[0]);
  });
  ok(!bad.length,'★★★組み合わせの表どおりに判定する'
     +(bad.length?('（違う：'+bad.join('／')+'）'):''));
}

console.log('=== 飛ばす先 ===');
{
  const a=M.gateOf('member-list',NOLOGIN,{ url:'/products/sub-4902370550467' });
  ok(a.why==='login','★★★ログインしていない人はログインへ');
  ok(a.to.indexOf('/account/login')===0,'★★/account/login に飛ばす');
  ok(/return_to=%2Fproducts%2Fsub-4902370550467/.test(a.to),
     '★★★ログインのあと元の商品ページに戻れるようにする');
  const b=M.gateOf('member-list',PLAIN,{});
  ok(b.why==='not-member'&&b.to==='/pages/members-only',
     '★★★会員でない人は /pages/members-only');
  const c=M.gateOf('member-list,grade-premium',MON,{});
  ok(c.why==='plan'&&c.to==='/pages/members-only?why=plan',
     '★★★プランが合わない人は ?why=plan を付けて飛ばす');
  ok(M.whyJa('plan')==='このプランではご覧いただけません',
     '★★文言（このプランではご覧いただけません）');
  ok(M.gateOf('member-list',MON,{}).to==='','★見られる人は飛ばさない');
}

console.log('=== タグの読み方 ===');
{
  ok(M.isMemberItem('a, member-list ,b')===true,'★前後の空白を気にしない');
  ok(M.isMemberItem('MEMBER-LIST')===true,'★大文字小文字を気にしない');
  ok(M.isMemberItem('member-listing')===false,
     '★★似た名前のタグ（member-listing）では開かない');
  ok(M.gradesOf('member-list,grade-monitor,ship-small').join(',')
     ==='grade-monitor','★★grade- のタグだけ拾う');
  ok(M.gradesOf(['grade-Premium']).join(',')==='grade-premium',
     '★大文字でもそろえる');
  ok(M.canSee('member-list,grade-monitor',MON)===true
     &&M.canSee('member-list,grade-monitor',LIG)===false,
     '★★一覧用（canSee）も同じ判定');
}

console.log('=== pj の CSV のタグが決まりと合っているか（カジの3）===');
{
  const cell=(text,name)=>{
    const rows=SHOPCSV.splitCsv(text);
    const i=rows[0].indexOf(name);
    return i<0?undefined:rows[1][i];
  };
  /* ① 会員用（sub-）：モニターに振り分けた商品 */
  const mon=SHOPCSV.build([{ jan:'4902370550467', name:'ゲーム', kishu:'NS',
    price:3400, max_qty:5, size_g:110, grades:'monitor' }],{});
  const tMon=cell(mon,'Tags');
  console.log('   モニター商品のタグ：'+tMon);
  ok(/member-list/.test(tMon),'★★★会員用CSVに member-list が付く');
  ok(/grade-monitor/.test(tMon),'★★★モニター用の商品に grade-monitor が付く');
  ok(!/grade-light/.test(tMon)&&!/grade-standard/.test(tMon)
     &&!/grade-premium/.test(tMon),
     '★★★モニターだけに振り分けた商品に、ほかのプランの印は付かない');
  ok(M.canSee(tMon,MON)===true,'★★★モニター会員は見られる');
  ok(M.canSee(tMon,LIG)===false&&M.canSee(tMon,STD)===false
     &&M.canSee(tMon,PRE)===false,
     '★★★ほかのプランの会員は見られない');
  ok(M.canSee(tMon,STAFF)===true,'★★社内は見られる');
  ok(M.canSee(tMon,NOLOGIN)===false,'★ログインなしは見られない');
  /* ② 会員用：「ぜんぶのプラン」（grades が空） */
  const all=SHOPCSV.build([{ jan:'4902370550468', name:'ゲーム2', kishu:'NS',
    price:3400, max_qty:5, size_g:110, grades:'' }],{});
  const tAll=cell(all,'Tags');
  ok(/grade-monitor/.test(tAll)&&/grade-premium/.test(tAll),
     '★★★「ぜんぶのプラン」はプランの印を4つ付ける');
  ok([MON,LIG,STD,PRE].every((c)=>M.canSee(tAll,c)),
     '★★★どのプランの会員も見られる');
  ok(M.canSee(tAll,PLAIN)===false,'★★会員でない人は見られない');
  /* ③ 1点もの（one-）：先行のあいだ */
  const pre=SHOPCSV.oneBuild([{ id:3, name:'ガンダム', price:4800, qty:1,
    cond:'中古', grades:SUBPLAN.oneGrades({},false) }],{});
  const tPre=cell(pre,'Tags');
  console.log('   1点もの（先行）のタグ：'+tPre);
  ok(/grade-premium/.test(tPre)&&!/grade-standard/.test(tPre)
     &&!/grade-monitor/.test(tPre)&&!/grade-light/.test(tPre),
     '★★★1点ものは先行中 grade-premium だけ');
  ok(M.canSee(tPre,PRE)===true&&M.canSee(tPre,STD)===false,
     '★★★先行中はプレミアムだけ見られる');
  /* ④ 1点もの：先行があいたあと */
  const open=SHOPCSV.oneBuild([{ id:3, name:'ガンダム', price:4800, qty:1,
    cond:'中古', grades:SUBPLAN.oneGrades({},true) }],{});
  const tOpen=cell(open,'Tags');
  console.log('   1点もの（先行あけ）のタグ：'+tOpen);
  ok(M.canSee(tOpen,PRE)===true&&M.canSee(tOpen,STD)===true,
     '★★★先行があいたらスタンダードも見られる');
  ok(M.canSee(tOpen,MON)===false&&M.canSee(tOpen,LIG)===false,
     '★★★モニター・ライトは見られない（⚙のとおり）');
  /* ⑤ 海外向け（os-）は会員用ではない＝だれでも見られる */
  const os=OSSCSV.build([{ jan:'4902370550467', titleEn:'Game', kishu:'NS',
    descHtml:'<p>x</p>', usd:49.99, qty:1, grams:210, cost:3300,
    pics:[{url:'https://img.example.jp/a.jpg'}] }],{ fx:160 });
  const oRows=SHOPCSV.splitCsv(os);
  const tOs=oRows[1][oRows[0].indexOf('Tags')];
  console.log('   海外向けのタグ：'+tOs);
  ok(!/member-list/.test(tOs)&&!/grade-/.test(tOs),
     '★★★海外向け（os-）に会員の印は付かない');
  ok(M.canSee(tOs,NOLOGIN)===true,
     '★★★海外向けはログインしていなくても見られる（鍵の対象外）');
}

console.log('=== 検索・サイトマップから隠す（カジの7）===');
{
  const col='Metafield: seo.hidden [number_integer]';
  const t=SHOPCSV.build([{ jan:'4902370550467', name:'ゲーム', kishu:'NS',
    price:3400, max_qty:5, size_g:110, grades:'monitor' }],{ seoHidden:col });
  const rows=SHOPCSV.splitCsv(t);
  const i=rows[0].indexOf(col);
  ok(i>=0,'★★★⚙に列の名前を入れると seo.hidden の列が出る');
  ok(rows[1][i]==='1','★★★値は 1（検索・サイトマップから外す）');
  ok(SHOPCSV.build([{ jan:'4902370550467', name:'ゲーム', kishu:'NS',
    price:3400, max_qty:5, size_g:110 }],{}).indexOf('seo.hidden')<0,
     '★★★空のときは列を出さない（今までどおり）');
  const one=SHOPCSV.oneBuild([{ id:3, name:'ガンダム', price:4800, qty:1,
    grades:'premium' }],{ seoHidden:col });
  ok(SHOPCSV.splitCsv(one)[0].indexOf(col)>=0,
     '★★1点ものの CSV にも足せる');
}

console.log('=== Liquid に同じ決まりが入っているか ===');
{
  const g=fs.readFileSync(path.join(ROOT,'shopify/snippets/member-gate.liquid'),'utf8');
  const c=fs.readFileSync(path.join(ROOT,'shopify/snippets/member-can-see.liquid'),'utf8');
  ok(/member-list/.test(g)&&/member-staff/.test(g),
     '★★★member-list と member-staff を見ている');
  ok(/routes\.account_login_url/.test(g)&&/return_to/.test(g),
     '★★★ログインへ飛ばす（戻り先つき）');
  ok(/\/pages\/members-only/.test(g)&&/why=plan/.test(g),
     '★★★会員でない人とプラン違いの行き先');
  ok(/slice: 0, 6/.test(g)&&/'grade-'/.test(g),
     '★★★grade- のタグだけで見比べる');
  ok(/customer\.tags contains t/.test(g),
     '★★★商品の grade と顧客の grade を見比べる');
  ok(!/product\.title|product\.price|product\.description/.test(g),
     '★★★鍵の部品は商品名・価格・説明を出さない');
  ok(/{{ gate }}/.test(g),'★出すのは飛ばす先だけ');
  ok(/'yes'/.test(c)&&/'no'/.test(c),'★★一覧用は yes／no だけ出す');
  ok(/member-staff/.test(c)&&/slice: 0, 6/.test(c),
     '★★★一覧用も同じ決まり（社内・grade）');
  const page=fs.readFileSync(path.join(ROOT,'shopify/pages/members-only.html'),'utf8');
  ok(/このプランではご覧いただけません/.test(page),
     '★★★案内のページに「このプランではご覧いただけません」がある');
  ok(/why=plan/.test(page),'★★?why=plan で文を切り替える');
}



/* ===== プラン外の購入（Worker・8.24 の【穴】の代わり）===== */
{
  const { loadWorker, makeEnv, asJson, get, post }=await import('./lib.mjs');
  const { worker, T:W }=await loadWorker('mgate');
  let notes=[];
  globalThis.fetch=async(u,i)=>{
    const url=String(u), o=i||{};
    if(/discord/.test(url)){
      notes.push(String(JSON.parse(String(o.body||'{}')).content||''));
      return new Response(null,{status:204});
    }
    return new Response('{}',{status:200});
  };
  const env=makeEnv({ DISCORD_WEBHOOK_URL:'https://discord.com/api/webhooks/1/a' });
  const api=async(path,body)=>(await asJson(await worker.fetch(
    body?post(path,body):get(path),env,{}))).body;
  const now=new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,pick,row_hash,seen_at,created_at)
     VALUES (?1,'いろは商会',0,'NS','ゲーム',9,1,'h',?2,?2)`)
    .bind('4902370550467',now).run();
  await env.DB.prepare(
    `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
     VALUES (?1,1,5,3400,'premium',?2,?2,?2,?2)`)
    .bind('4902370550467',now).run();
  const sku='SUB-4902370550467-20261114';
  console.log('\n=== プラン外の購入を見つける ===');
  notes=[];
  const r=await api('/sub/orders',{ name:'o.csv',
    text:'Name,Lineitem quantity,Lineitem sku,Tags\n'
      +'#1001,1,'+sku+',"member-list, grade-monitor"\n' });
  ok(r.ok===true,'★取り込みは通る');
  ok(r.off_plan===1,'★★★プレミアム商品をモニター会員が買ったら見つける');
  ok(/プラン外の購入/.test(notes.join('\n')),
     '★★★社内用の Discord に知らせる');
  ok(/grade-monitor/.test(notes.join('\n'))&&/grade-premium/.test(notes.join('\n')),
     '★★商品のプランと買った人のプランを出す');
  ok(!/@|住所|様/.test(notes.join('\n')),
     '★★★氏名・住所・メールは出さない');
  /* 合っている買い物は知らせない。 */
  notes=[];
  const r2=await api('/sub/orders',{ name:'o2.csv',
    text:'Name,Lineitem quantity,Lineitem sku,Tags\n'
      +'#1002,1,'+sku+',"member-list, grade-premium"\n' });
  ok(r2.off_plan===0&&!/プラン外/.test(notes.join('\n')),
     '★★★プランが合っていれば知らせない');
  /* タグが無い（Flow を入れていない）ときは静かにする。 */
  notes=[];
  const r3=await api('/sub/orders',{ name:'o3.csv',
    text:'Name,Lineitem quantity,Lineitem sku\n#1003,1,'+sku+'\n' });
  ok(r3.off_plan===0&&r3.off_plan_no_tag===1,
     '★★★注文のタグが無いときは「分からない」として黙っている');
  /* 2行目以降の注文（タグの欄が空）も、同じ注文のタグを使う。 */
  const rows=W.subOrderRows('Name,Lineitem quantity,Lineitem sku,Tags\n'
    +'#1004,1,'+sku+',"grade-monitor"\n'
    +'#1004,1,ONE-3-20261114,\n');
  ok(rows.rows.length===2&&rows.rows[1].tags==='grade-monitor',
     '★★★同じ注文の2行目にも注文のタグを配る');
  ok(rows.rows[1].jan==='one-3','★1点ものの SKU も読める');
}

T.done();
