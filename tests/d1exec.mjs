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

console.log('\n=== 失敗したら理由をぜんぶ出す（7.88）===');
import { runFile, findWrangler, winUnsafe, makeExec, DONE_RE }
  from '../proxy-sync/d1-exec.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
const SQL=path.join(DIR,'migrate-0031-jan-dup-fees.sql');
const lines=[];
const log=(x)=>lines.push(String(x));
/* ① Windows で .cmd を shell なしで起動したときの形（status も出力も null） */
lines.length=0;
let res=runFile(SQL,{ log:log, how:{kind:'node',path:'x',tries:[]},
  exec:()=>({ status:null, signal:null,
    error:Object.assign(new Error('spawnSync npx.cmd EINVAL'),{code:'EINVAL'}),
    stdout:'', stderr:'', file:'npx.cmd', args:['--yes','wrangler'] }) });
let t=lines.join('\n');
console.log('   '+t.split('\n').slice(1,7).join(' / ').slice(0,200));
ok(res.ok===false&&res.at===1,'★1文目で止まる');
ok(/終了コード: なし/.test(t),'★★★終了コードが無いことを出す（null を隠さない）');
ok(/起動そのものに失敗: EINVAL/.test(t),'★★★起動の例外（EINVAL）をそのまま出す');
ok(/\.cmd を shell なしで起動できません/.test(t),
   '★★★Windows の落とし穴だと分かるように書く');
ok(/npm i -D wrangler/.test(t),'★★★直し方を出す');
ok(/起動した中身: npx\.cmd/.test(t),'★★何を起動したかを出す');
/* ② 見つからないとき（ENOENT） */
lines.length=0;
runFile(SQL,{ log:log, how:{kind:'node',path:'x',tries:[]},
  exec:()=>({ status:null, signal:null,
    error:Object.assign(new Error('spawnSync node ENOENT'),{code:'ENOENT'}),
    stdout:'', stderr:'', file:'node', args:[] }) });
t=lines.join('\n');
ok(/ENOENT/.test(t)&&/見つかりません/.test(t),'★★ENOENT も分かるように出す');
/* ③ wrangler が stderr に理由を出して落ちたとき */
lines.length=0;
runFile(SQL,{ log:log, how:{kind:'node',path:'x',tries:[]},
  exec:()=>({ status:1, signal:null, error:undefined,
    stdout:'🌀 Executing on remote database',
    stderr:'✘ [ERROR] Authentication error [code: 10000]',
    file:'node', args:['wrangler.js'] }) });
t=lines.join('\n');
console.log('   '+t.split('\n').slice(2,8).join(' / ').slice(0,200));
ok(/終了コード: 1/.test(t),'★★★終了コードを出す');
ok(/--- stderr ---/.test(t)&&/code: 10000/.test(t),
   '★★★wrangler の stderr をそのまま出す');
ok(/--- stdout ---/.test(t)&&/Executing on remote/.test(t),
   '★★stdout も出す');
/* ④ 何も出力しなかったとき */
lines.length=0;
runFile(SQL,{ log:log, how:{kind:'node',path:'x',tries:[]},
  exec:()=>({ status:7, signal:null, error:undefined, stdout:'', stderr:'',
    file:'node', args:[] }) });
ok(/何も出力しませんでした/.test(lines.join('\n'))
   &&/--debug/.test(lines.join('\n')),
   '★★出力が無いときは --debug を案内する');
/* ⑤ 済みは飛ばして最後まで進む */
lines.length=0;
res=runFile(SQL,{ log:log, how:{kind:'node',path:'x',tries:[]},
  exec:(st)=>(/ALTER TABLE/.test(st)
    ? ({ status:1, stderr:'duplicate column name: cands', stdout:'' })
    : ({ status:0, stderr:'', stdout:'ok' })) });
console.log('   '+JSON.stringify({ok:res.ok,ran:res.ran,done:res.done}));
ok(res.ok===true&&res.done===12&&res.ran===5,
   '★★★すでにある列は済みとして飛ばし、最後まで進む');

console.log('\n=== Windows で .cmd を通さない形にする（7.88）===');
/* node_modules/wrangler/bin/wrangler.js があれば node で直に動かす */
const tmp=mkdtempSync(path.join(os.tmpdir(),'d1x-'));
mkdirSync(path.join(tmp,'node_modules','wrangler','bin'),{recursive:true});
const fake=path.join(tmp,'node_modules','wrangler','bin','wrangler.js');
writeFileSync(fake,
  'const a=process.argv.slice(2);\n'
  +'if(a.indexOf("--command")<0){console.error("no command");process.exit(2);}\n'
  +'const sql=a[a.indexOf("--command")+1];\n'
  +'if(/cand_n/.test(sql)){console.error("duplicate column name: cand_n");'
  +'process.exit(1);}\n'
  +'console.log("ran: "+sql);\n');
let how=findWrangler(tmp);
console.log('   '+JSON.stringify({kind:how.kind,hit:how.path===fake}));
ok(how.kind==='node','★★★node_modules の wrangler を見つける');
ok(how.path===fake,'★★その中身（JS）のパスを返す');
/* 実際に node で動かす（.cmd も shell も通らない） */
lines.length=0;
res=runFile(SQL,{ log:log, how:how, from:tmp, db:'pj-sync' });
t=lines.join('\n');
console.log('   '+JSON.stringify({ok:res.ok,ran:res.ran,done:res.done}));
ok(res.ok===true,'★★★本当に1文ずつ流せる（偽の wrangler で通す）');
ok(res.done===2,'★★duplicate は済みとして飛ばす（cand_n の2文）');
ok(res.ran===15,'★残りは流す');
ok(/node で直に動かす/.test(t),'★★どちらの方法で動かしたかを出す');
/* 引数に SQL がそのまま渡っていること（引用符が壊れない） */
const ex=makeExec(how,'pj-sync',false,false);
let one=ex("INSERT INTO t VALUES ('a;b', 'it''s')");
console.log('   '+one.stdout.trim());
ok(one.status===0,'★★★引用符や ; が入った文も渡せる');
ok(/a;b/.test(one.stdout)&&/it''s/.test(one.stdout),
   '★★★中身がそのまま渡る（shell を通さないので壊れない）');
ok(one.file===process.execPath,'★★node で起動している（.cmd ではない）');
ok(one.args[0]===fake&&one.args.indexOf('--remote')>=0,'★引数の並び');
ok(one.args.indexOf('--file')<0,'★★★--file は使わない');
/* 見つからないときは shell にする */
const none=findWrangler(mkdtempSync(path.join(os.tmpdir(),'d1y-')));
ok(none.kind==='shell','★★見つからなければ shell 経由にする');
ok(none.tries.length>=2,'★どこを探したかを残す');

console.log('\n=== shell 経由でも壊れない囲み方 ===');
/* shell:true のとき Node は引数を囲んでくれないので、自分で囲む。 */
import { shQuote } from '../proxy-sync/d1-exec.mjs';
console.log('   win: '+shQuote("a ' b (c)",true));
console.log('   sh : '+shQuote("a ' b (c)",false));
ok(shQuote('a b',true)==='"a b"','★★Windows は " で囲む');
ok(shQuote('say "hi"',true)==='"say ""hi"""','★★★" は2つ重ねる');
ok(shQuote("it's",false)==="'it'\\''s'",'★★Mac/Linux は \' を外して付け直す');
ok(shQuote("a b",false)==="'a b'",'★空白を含む引数を囲む');
/* 実際に shell 経由で動かして、SQL がそのまま届くことを見る */
const shDir=mkdtempSync(path.join(os.tmpdir(),'d1sh-'));
writeFileSync(path.join(shDir,'fake.mjs'),
  'console.log("GOT:"+process.argv.slice(2).join("|"));\n');
{
  const { spawnSync }=await import('node:child_process');
  const q=(v)=>shQuote(v,process.platform==='win32');
  const stmt="INSERT INTO t VALUES ('a;b', 'it''s', 'x y')";
  const r=spawnSync(process.execPath,
    [q(path.join(shDir,'fake.mjs')),q('--command'),q(stmt)],
    {encoding:'utf8',shell:true});
  console.log('   '+String(r.stdout||'').trim());
  ok(r.status===0,'★shell 経由で動く');
  ok(String(r.stdout||'').indexOf(stmt)>=0,
     '★★★囲めば SQL がそのまま届く（; も \' もそのまま）');
}

console.log('\n=== cmd の % は断る ===');
/* Windows の cmd は " で囲んでも %…% を展開してしまう。 */
const save=process.platform;
ok(typeof winUnsafe==='function','★判定がある');
ok(winUnsafe("SELECT 1")===false,'★ふつうの文は通す');
/* 実物で % を含むのは backfill-0023 と migrate-0022 */
const pct=files.filter((f)=>/%/.test(readFileSync(path.join(DIR,f),'utf8')));
console.log('   % を含む: '+JSON.stringify(pct));
ok(pct.length===2,'★★% を含むマイグレーションは2本（0022 と backfill-0023）');
ok(pct.indexOf('migrate-0031-jan-dup-fees.sql')<0,
   '★★★0031 には % が無い（そのまま流せる）');

console.log('\n=== 置き場（リポジトリの作り）===');
/* wrangler はリポジトリの**いちばん上**に1回入れる（package.json）。
   node_modules は上の階層へたどって見つかるので、proxy-sync からでも当たる。 */
{
  const top=mkdtempSync(path.join(os.tmpdir(),'d1top-'));
  mkdirSync(path.join(top,'node_modules','wrangler','bin'),{recursive:true});
  writeFileSync(path.join(top,'node_modules','wrangler','bin','wrangler.js'),'');
  mkdirSync(path.join(top,'proxy-sync'),{recursive:true});
  const h=findWrangler(path.join(top,'proxy-sync'));
  console.log('   proxy-sync から: '+h.kind);
  ok(h.kind==='node','★★★上の階層に入れた wrangler を proxy-sync から見つける');
  ok(h.path===path.join(top,'node_modules','wrangler','bin','wrangler.js'),
     '★★いちばん上の node_modules を使う');
}
/* package.json と package-lock.json は入れる。node_modules は入れない。 */
{
  const pkg=JSON.parse(readFileSync(path.join(ROOT,'package.json'),'utf8'));
  console.log('   wrangler: '+pkg.devDependencies.wrangler);
  ok(pkg.private===true,'★★private（間違って npm publish しない）');
  ok(!!pkg.devDependencies.wrangler,'★★★wrangler の版を package.json で決める');
  ok(/^\d+\.\d+\.\d+$/.test(pkg.devDependencies.wrangler),
     '★★版を固定する（^ や ~ を付けない）');
  ok(pkg.scripts.test==='sh tests/run.sh','★npm test でテストが走る');
  /* package.json に "type" を**書かない**（6.111／7.89）。
     "type":"module" にすると tests/*.js（CommonJS・require）が全部壊れ、
     "type":"commonjs" にすると Node の ESM の自動判別が止まって
     proxy-sync/worker.js（export default）を読めなくなる。
     書かなければ、.mjs は ESM、.js は中身で判別、という今の形のまま。 */
  ok(pkg.type===undefined,
     '★★★package.json に "type" を書かない（.js と .mjs の両方が動く形）');
  const lock=JSON.parse(readFileSync(path.join(ROOT,'package-lock.json'),'utf8'));
  ok(lock.lockfileVersion>=3,'★★package-lock.json がある');
  ok(lock.packages['node_modules/wrangler'].version
     ===pkg.devDependencies.wrangler,
     '★★★lock の版が package.json と同じ');
  const ig=readFileSync(path.join(ROOT,'.gitignore'),'utf8');
  ok(/^node_modules\/$/m.test(ig),'★★★.gitignore に node_modules/');
  ok(/^\.wrangler\/$/m.test(ig),'★.wrangler/ も');
}

console.log('\n=== 流し直せること（済みは飛ばす）===');
const src=readFileSync(path.join(DIR,'d1-exec.mjs'),'utf8');
ok(/duplicate column name/.test(src),
   '★★★「すでに同じ列がある」は済みとして飛ばす');
ok(/already exists/.test(src),'★★「すでにある」も飛ばす');
ok(/--remote/.test(src)&&/--local/.test(src),'★本番と手元のどちらにも流せる');
ok(/spawnSync/.test(src)&&/process\.execPath/.test(src),
   '★★いま動いている node で wrangler の中身を直に起動する');
ok(/--file/.test(src)===false||/--file をまったく使わず/.test(src),
   '★★★--file（import の API）は使わない');

await T.done();
