/* D1 の「結果は100列まで」を超えないこと（7.55）
   v176 で items が100列になり、全列を並べた SELECT が
   「too many columns in result set: SQLITE_ERROR」で落ちた。
   /status だけでなく Cron のジョブ（jobOrders・jobHourly・jobMarkdown・
   jobReview・jobPhaseB・jobRkPrice・jobSoldKeep）もまとめて止まった。

   ここで見張るのは2つ。
   ① 列数が上限より十分少ないこと（余裕を残す。列が増えたらここで落ちる）
   ② 読む列が落ちていないこと
      shared/pricing.js と index.html と worker.js が行から読む列名を数え上げ、
      それぞれのリストに入っていることを確かめる */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { harness, loadWorker } from './lib.mjs';
const T=harness('D1：SELECT の列数');
const ok=T.ok;
const { T:W }=await loadWorker('d1cols');

const db=new DatabaseSync(':memory:');
db.exec(readFileSync('proxy-sync/schema.sql','utf8'));
const nOf=(sql)=>db.prepare(sql).columns().length;
const tableCols=(t)=>db.prepare(`SELECT name FROM pragma_table_info('${t}')`)
  .all().map((r)=>r.name);
const items=tableCols('items');

console.log('=== 上限と余裕 ===');
console.log('   items の実列：'+items.length+'列 / D1 の上限：'+W.D1_MAX_COLS+'列');
ok(W.D1_MAX_COLS===100,'★D1 が1つの結果に返せるのは100列');
ok(W.D1_COLS_WARN<W.D1_MAX_COLS,'★★テストは上限より手前で落ちる（余裕を残す）');
ok(items.length>=W.D1_COLS_WARN,
   '★★items の実列はすでに警告線を超えている（だから全列は並べられない）');

console.log('\n=== 実際に使う形で数える ===');
/* 使っている形をそのまま並べる。ジョブが足す副問い合わせも入れる。 */
const SOLD_AT=`,
  (SELECT MAX(o.ordered_at) FROM orders o
    WHERE o.channel='ebay' AND o.asin=items.asin AND o.cond=items.cond) AS ebay_sold_at`;
const SOLD_N=`,
  (SELECT COALESCE(SUM(qty),0) FROM orders o2
    WHERE o2.channel='ebay' AND o2.asin=items.asin AND o2.cond=items.cond) AS ebay_sold`;
const shapes=[
  ['ITEM_COLS（itemsByKeys・restockWatch・jobReview・jobPhaseB・rkPlanRows・skPlanRows）',
   `SELECT ${W.ITEM_COLS} FROM items`],
  ['ITEM_COLS ＋ ebay_sold_at（jobMarkdown）',
   `SELECT ${W.ITEM_COLS}${SOLD_AT} FROM items`],
  ['STATUS_COLS ＋ ebay_sold ＋ ebay_sold_at（GET /status）',
   `SELECT ${W.STATUS_COLS}${SOLD_N}${SOLD_AT} FROM items`],
];
for (const [name,sql] of shapes){
  let n=0, err='';
  try { n=nOf(sql); } catch(e){ err=e.message; }
  console.log('   '+n+'列  '+name);
  ok(!err,'★'+name+' が組み立てられる'+(err?('：'+err):''));
  ok(n>0&&n<=W.D1_COLS_WARN,
     '★★'+n+'列 ≦ '+W.D1_COLS_WARN+'列（上限 '+W.D1_MAX_COLS+' に余裕がある）');
}

console.log('\n=== 全列を並べたら本当に落ちること（上限の確認）===');
let over='';
try { nOf(`SELECT ${items.join(',')}${SOLD_AT}${SOLD_N} FROM items`); }
catch(e){ over=e.message; }
console.log('   '+(items.length+2)+'列 → '+(over||'（SQLite は通る）'));
ok(items.length+2>W.D1_MAX_COLS,
   '★★全列＋副問い合わせは '+(items.length+2)+'列で、D1 の上限を超える');

console.log('\n=== 読む列が落ちていないこと ===');
/* 行から値を読む書き方（r.col / x["col"] / r['col']）を数え上げる。
   SQL の中の列名（SET や WHERE）は SELECT の列数に関係しないので拾わない。 */
const readCols=(src)=>{
  const set={};
  for (const c of items)
    if (new RegExp('[.\\[\'"]'+c+'\\b').test(src)) set[c]=1;
  return Object.keys(set);
};
const listOf=(cols)=>{
  const set={};
  String(cols).replace(/\/\*[\s\S]*?\*\//g,' ')      // コメントは外す
    .split(/[\s,()]+/).forEach((w)=>{ if(w)set[w]=1; });
  return set;
};
const itemList=listOf(W.ITEM_COLS), stList=listOf(W.STATUS_COLS);
const pricing=readCols(readFileSync('shared/pricing.js','utf8'));
const screen=readCols(readFileSync('index.html','utf8'));
const wsrc=readFileSync('proxy-sync/worker.js','utf8')
  .replace(/const ITEM_COLS = `[\s\S]*?`;/,'').replace(/const STATUS_COLS = `[\s\S]*?`;/,'');
const worker=readCols(wsrc);
console.log('   式が読む：'+pricing.length+'列／画面が読む：'+screen.length
  +'列／Worker が読む：'+worker.length+'列');

const miss=(need,have)=>need.filter((c)=>!have[c]);
const m1=miss(pricing,itemList), m2=miss(worker,itemList);
console.log('   ITEM_COLS に足りない：'+(m1.concat(m2).join(' ')||'なし'));
ok(m1.length===0,'★★値付けの式が読む列はぜんぶ ITEM_COLS にある');
ok(m2.length===0,'★★Worker が読む列はぜんぶ ITEM_COLS にある');
const m3=miss(pricing,stList), m4=miss(screen,stList);
console.log('   STATUS_COLS に足りない：'+(m3.concat(m4).join(' ')||'なし'));
ok(m3.length===0,'★★値付けの式が読む列はぜんぶ STATUS_COLS にある（画面も式を使う）');
ok(m4.length===0,'★★画面が読む列はぜんぶ STATUS_COLS にある');

console.log('\n=== どちらにも入れない列（書くだけの列）===');
const never=items.filter((c)=>!itemList[c]&&!stList[c]);
console.log('   '+never.join(' '));
ok(never.length>0,'★読まない列は並べない（その分の余裕ができる）');
ok(never.every((c)=>pricing.indexOf(c)<0&&screen.indexOf(c)<0&&worker.indexOf(c)<0),
   '★★外した列は、どこからも読まれていない');
/* ebay_bo_decline は画面の JS では読んでいないが、ベストオファーの設定を
   そろえて返す決まりなので STATUS_COLS に入れてある（tests/pricesrc.mjs）。 */
ok(!!stList['ebay_bo_decline']&&!itemList['ebay_bo_decline'],
   '★ebay_bo_decline は /status だけが返す（自動処理は読まない）');

console.log('\n=== worker.js の SELECT を全部数える ===');
/* 列リストを当てはめて組み立てられる SELECT は、ぜんぶ数えて上限と比べる。
   将来どこかに広い SELECT が増えても、ここで気づける。 */
{
  let src=wsrc.replace(/const SKU_COLS = `[\s\S]*?`;/,'');
  const lits=[...src.matchAll(/`([^`]*SELECT[^`]*)`/gi)].map((m)=>m[1]);
  const got=[];
  for (const raw of lits){
    let sql=raw.replace(/\$\{ITEM_COLS\}/g,W.ITEM_COLS)
               .replace(/\$\{STATUS_COLS\}/g,W.STATUS_COLS)
               .replace(/\$\{SKU_COLS\}/g,W.SKU_COLS);
    if (/\$\{/.test(sql)) sql=sql.replace(/\$\{[^}]*\}/g,'1');
    sql=sql.replace(/\?\d+/g,'?').replace(/--[^\n]*/g,' ').replace(/;\s*$/,'');
    if (!/^\s*SELECT/i.test(sql)) continue;
    try { got.push([nOf(sql), sql.replace(/\s+/g,' ').slice(0,60)]); } catch (e) {}
  }
  got.sort((a,b)=>b[0]-a[0]);
  console.log('   数えられた SELECT：'+got.length+'本／最大 '+((got[0]||[0])[0])+'列');
  got.slice(0,3).forEach(([n,q])=>console.log('     '+String(n).padStart(3)+'列  '+q));
  ok(got.length>=20,'★おおよその本数を数えられている（当てはめが壊れていない）');
  const bad=got.filter((x)=>x[0]>W.D1_COLS_WARN);
  ok(bad.length===0,'★★'+W.D1_COLS_WARN+'列を超える SELECT が1本も無い'
     +(bad.length?('：'+bad.map((x)=>x[0]+'列 '+x[1]).join(' / ')):''));
}

console.log('\n=== 行を引く SELECT に items の全列を並べていないこと ===');
const wide=[...wsrc.matchAll(/SELECT\s+\*\s+FROM\s+items/gi)].length;
ok(wide===0,'★★SELECT * FROM items は無い');
ok(/\$\{STATUS_COLS\}/.test(wsrc),'★★/status は STATUS_COLS を使う');
ok(!/`SELECT \$\{ITEM_COLS\},\s*\n\s*\(SELECT COALESCE\(SUM\(qty\)/.test(wsrc),
   '★★/status が ITEM_COLS を使っていない（画面が読まない列を返さない）');

await T.done();
