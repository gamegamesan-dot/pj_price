/* 道具：D1 のマイグレーションを1文ずつ流す（7.87）
   `wrangler d1 execute --remote --file=…` は D1 の **import の API** を使い、
   そこだけスコープが足りず「Authentication error [code: 10000]」で落ちることがある
   （--command で使う query の API は通るのに）。
   そこで SQL を1文ずつに分けて --command で流す。分け方がここの要点。
   ・文字列（'…'）の中の ; や -- で切らない
   ・-- の行コメントと /* *­/ のブロックコメントを落とす
   ・各文は1行に詰める（Windows の npx.cmd に渡すときの引用符の事故を避ける） */
import { harness } from './lib.mjs';
import { splitSql } from '../proxy-sync/d1-exec.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const T=harness('道具：D1 を1文ずつ流す');
const ok=T.ok;
const ROOT=path.join(path.dirname(new URL(import.meta.url).pathname),'..');
const DIR=path.join(ROOT,'proxy-sync');

console.log('=== 基本 ===');
let a=splitSql("CREATE TABLE t (a TEXT);\nCREATE INDEX i ON t(a);");
console.log('   '+JSON.stringify(a));
ok(a.length===2,'★2文に分ける');
ok(a[0]==='CREATE TABLE t (a TEXT)','★★末尾の ; は入れない');
ok(splitSql("SELECT 1;").length===1,'★最後の ; で空の文を作らない');
ok(splitSql("").length===0,'★空なら0文');
ok(splitSql("-- これだけ\n\n").length===0,'★コメントだけなら0文');

console.log('\n=== コメントを落とす ===');
a=splitSql("-- 説明\nALTER TABLE t ADD COLUMN x TEXT;  -- 末尾の説明\n");
console.log('   '+JSON.stringify(a));
ok(a.length===1&&a[0]==='ALTER TABLE t ADD COLUMN x TEXT',
   '★★★-- の行コメントを落とす');
a=splitSql("/* 複数行の\n   説明 */ SELECT 1;");
ok(a.length===1&&a[0]==='SELECT 1','★★★ブロックコメントを落とす');

console.log('\n=== 文字列の中は切らない ===');
a=splitSql("INSERT INTO t VALUES ('a;b');\nSELECT 2;");
console.log('   '+JSON.stringify(a));
ok(a.length===2,'★★★文字列の中の ; で切らない');
ok(a[0]==="INSERT INTO t VALUES ('a;b')",'★★中身をそのまま残す');
a=splitSql("INSERT INTO t VALUES ('a--b');");
console.log('   '+JSON.stringify(a));
ok(a.length===1&&a[0]==="INSERT INTO t VALUES ('a--b')",
   '★★★文字列の中の -- をコメントにしない');
a=splitSql("INSERT INTO t VALUES ('it''s;ok');");
console.log('   '+JSON.stringify(a));
ok(a.length===1&&a[0]==="INSERT INTO t VALUES ('it''s;ok')",
   "★★★'' （文字としての '）をまたいで切らない");
a=splitSql("UPDATE t SET x='/*';\nSELECT 3;");
ok(a.length===2,'★★文字列の中の /* をコメントにしない');

console.log('\n=== 1行に詰める ===');
a=splitSql("CREATE TABLE t (\n  a TEXT,\n  b INTEGER\n);");
console.log('   '+JSON.stringify(a));
ok(a[0]==='CREATE TABLE t ( a TEXT, b INTEGER )',
   '★★★改行を空白に詰める（npx.cmd の引用符の事故を避ける）');
ok(a[0].indexOf('\n')<0&&a[0].indexOf('\r')<0,'★★改行を残さない');
ok(splitSql("SELECT  1 ;")[0]==='SELECT 1','★続いた空白は1つに');

console.log('\n=== 実物のマイグレーションぜんぶ ===');
const files=readdirSync(DIR).filter((f)=>/^(migrate|backfill)-.*\.sql$/.test(f)).sort();
console.log('   '+files.length+'本');
ok(files.length>=31,'★マイグレーションが並んでいる');
let bad=[];
for(const f of files){
  const st=splitSql(readFileSync(path.join(DIR,f),'utf8'));
  if(!st.length){ bad.push(f+'：0文'); continue; }
  for(const x of st){
    if(/\n|\r/.test(x))bad.push(f+'：改行が残っている');
    if(/^--/.test(x))bad.push(f+'：コメントが文になっている');
    if(x.indexOf(';')>=0&&!/'/.test(x))bad.push(f+'：; が残っている');
    /* 文字列の ' の数が偶数（途中で切れていない） */
    const n=(x.match(/'/g)||[]).length;
    if(n%2)bad.push(f+'：\' が奇数（文字列の途中で切れた）');
  }
}
console.log('   '+(bad.length?JSON.stringify(bad.slice(0,5)):'問題なし'));
ok(bad.length===0,'★★★どのマイグレーションも正しく分かれる');
/* 件数の見当（v204 のぶん） */
const n31=splitSql(readFileSync(path.join(DIR,'migrate-0031-jan-dup-fees.sql'),'utf8'));
console.log('   0031: '+n31.length+'文');
ok(n31.length===17,'★★0031 は17文（列12・索引4・表1）');
ok(n31.filter((x)=>/^ALTER TABLE/.test(x)).length===12,'★★ALTER が12文');
ok(n31.some((x)=>/^CREATE TABLE IF NOT EXISTS mw_auto_runs/.test(x)),
   '★表を作る文がある');

console.log('\n=== 流し直せること（済みは飛ばす）===');
const src=readFileSync(path.join(DIR,'d1-exec.mjs'),'utf8');
ok(/duplicate column name/.test(src),
   '★★★「すでに同じ列がある」は済みとして飛ばす');
ok(/already exists/.test(src),'★★「すでにある」も飛ばす');
ok(/--remote/.test(src)&&/--local/.test(src),'★本番と手元のどちらにも流せる');
ok(/spawnSync/.test(src)&&/npx\.cmd/.test(src),
   '★★引数は配列で渡す（Windows でも引用符の事故が無い）');
ok(/--file/.test(src)===false||/--file をまったく使わず/.test(src),
   '★★★--file（import の API）は使わない');

await T.done();
