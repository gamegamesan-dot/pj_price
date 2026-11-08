/* 道具：GitHub Actions から D1 とデプロイを押せるようにする（7.116・【N】）
   ・未適用のマイグレーションだけが番号順に流れる
   ・PC で流したぶんは飛ばす（控え `_migrations` を見る。二重に流さない）
   ・はじめての実行（控えが空）は、もう当たっているファイルを**記録だけ**する
   ・途中で失敗したらそこで止める（デプロイに進まない）
   ・秘密（トークン・webhook）はログに出さない
   ・ワークフローの形（手動だけ・入力の既定・concurrency・main だけ・版の固定） */
import { harness, ROOT } from './lib.mjs';
import * as M from '../proxy-sync/d1-migrate.mjs';
import * as X from '../proxy-sync/d1-exec.mjs';
import fs from 'node:fs';
import path from 'node:path';
const T=harness('道具：GitHub Actions からの D1 とデプロイ');
const ok=T.ok;
const DIR=path.join(ROOT,'proxy-sync');
const YML=path.join(ROOT,'.github/workflows/deploy-pj-sync.yml');

console.log('=== 流す順（番号順・backfill は同じ番号の後ろ）===');
const files=M.fileList(DIR);
console.log('   '+files.length+'本：'+files.slice(0,3).join(' / ')+' … '
  +files.slice(-2).join(' / '));
ok(files.length>=44,'★リポジトリのマイグレーションをぜんぶ見つける（'+files.length+'本）');
ok(files[0]==='migrate-0002-sales-channel.sql','★★いちばん小さい番号が先');
ok(files.indexOf('migrate-0045-migrations.sql')===files.length-1,
   '★★いちばん大きい番号が最後');
const i23=files.indexOf('migrate-0023-sold-keep.sql');
ok(files[i23+1]==='backfill-0023-sold-keep.sql',
   '★★★backfill は同じ番号の migrate の**すぐ後ろ**（列を作ってから埋める）');
ok(M.fileNo('migrate-0031-jan-dup-fees.sql').no===31,'★番号を読む');
ok(M.fileNo('README.md')===null&&M.fileNo('d1-exec.mjs')===null,
   '★★マイグレーションでないファイルは混ぜない');
/* 番号順は文字の並びとは違う（0009 と 0010 など）。 */
ok(M.fileList(DIR).every((f,i,a)=>!i||M.fileNo(a[i-1]).no<=M.fileNo(f).no),
   '★★番号が増える順になっている');

console.log('\n=== そのファイルが足すもの（表・列・索引）===');
let o=M.sqlObjects(fs.readFileSync(
  path.join(DIR,'migrate-0044-reg-price.sql'),'utf8'));
console.log('   '+JSON.stringify(o));
ok(o.columns.length===6&&o.other===0,'★★ALTER TABLE … ADD COLUMN を読む');
ok(o.columns.some((c)=>c.table==='mw_amz'&&c.column==='used_low'),
   '★★表と列の名前を読む');
o=M.sqlObjects(fs.readFileSync(
  path.join(DIR,'migrate-0045-migrations.sql'),'utf8'));
ok(o.tables.indexOf('_migrations')>=0&&o.indexes.length===1,
   '★★CREATE TABLE と CREATE INDEX を読む');
o=M.sqlObjects("UPDATE items SET x=1 WHERE y=2");
ok(o.other===1&&!o.tables.length,'★★作りを変えない文は other に数える');

console.log('\n=== もう当たっているかの判定 ===');
const SC={ tables:{ mw_amz:1, _migrations:1 },
  columns:{ mw_amz:{ used_low:1, used_n:1, used_at:1 } },
  indexes:{ idx_migrations_at:1 } };
ok(M.appliedAlready({ tables:[], columns:[{table:'mw_amz',column:'used_low'}],
  indexes:[], other:0 },SC)===true,'★★★列が揃っていれば「当たっている」');
ok(M.appliedAlready({ tables:[], columns:[{table:'mw_amz',column:'nope'}],
  indexes:[], other:0 },SC)===false,'★★★1つでも無ければ「当たっていない」');
ok(M.appliedAlready({ tables:['_migrations'], columns:[],
  indexes:['idx_migrations_at'], other:0 },SC)===true,'★表と索引も見る');
ok(M.appliedAlready({ tables:[], columns:[], indexes:[], other:1 },SC)===false,
   '★★★UPDATE などが入っているファイルは勝手に「済み」にしない');
ok(M.appliedAlready({ tables:[], columns:[], indexes:[], other:0 },SC)===false,
   '★★足すものが無いファイルも「済み」にしない');

/* ---- 作りものの D1 で、流れ方を確かめる ---- */
const mkDb=(opt)=>{
  const o=opt||{};
  const st={ ledger:Object.assign({},o.ledger||{}), ran:[], marked:[],
    tables:Object.assign({ items:1 },o.tables||{}),
    columns:Object.assign({},o.columns||{}),
    indexes:Object.assign({},o.indexes||{}) };
  const exec=(stmt)=>{
    const s=String(stmt);
    let m=/^INSERT OR REPLACE INTO _migrations \(file, at, src\) VALUES \('([^']+)','([^']+)','([^']+)'\)$/
      .exec(s);
    if(m){
      if(o.markFail&&o.markFail===m[1])return { status:1, stdout:'', stderr:'mark ng' };
      st.ledger[m[1]]=1; st.marked.push({ file:m[1], at:m[2], src:m[3] });
      return { status:0, stdout:'', stderr:'' };
    }
    if(/^CREATE TABLE IF NOT EXISTS _migrations/.test(s))
      return { status:0, stdout:'', stderr:'' };
    st.ran.push(s);
    if(o.failAt&&o.failAt.test&&o.failAt.test(s))
      return { status:1, stdout:'', stderr:o.failMsg||'Error: だめ' };
    if(o.doneAt&&o.doneAt.test&&o.doneAt.test(s))
      return { status:1, stdout:'', stderr:'duplicate column name: x' };
    return { status:0, stdout:'', stderr:'' };
  };
  const query=async(sql)=>{
    if(sql===M.SQL_LEDGER){
      if(o.noLedger)throw new Error('no such table: _migrations');
      return Object.keys(st.ledger).map((f)=>({ file:f }));
    }
    if(sql===M.SQL_TABLES)
      return Object.keys(st.tables).map((n)=>({ name:n }));
    if(sql===M.SQL_INDEXES)
      return Object.keys(st.indexes).map((n)=>({ name:n }));
    const m=/pragma_table_info\('([^']+)'\)/.exec(sql);
    if(m)return Object.keys(st.columns[m[1]]||{}).map((n)=>({ name:n }));
    return [];
  };
  return { st, exec, query };
};
/* 2本だけのお試しの置き場所を作る。 */
const TMP=fs.mkdtempSync(path.join(ROOT,'.pjmig-'));
fs.writeFileSync(path.join(TMP,'migrate-0001-a.sql'),
  'ALTER TABLE items ADD COLUMN aa TEXT;\nALTER TABLE items ADD COLUMN ab TEXT;\n');
fs.writeFileSync(path.join(TMP,'migrate-0002-b.sql'),
  'CREATE TABLE IF NOT EXISTS bb (id INTEGER);\n');
fs.writeFileSync(path.join(TMP,'migrate-0003-c.sql'),
  'ALTER TABLE items ADD COLUMN cc TEXT;\n');
const quiet=()=>{};

console.log('\n=== 未適用だけを流す（控えにあるものは飛ばす）===');
let d=mkDb({ ledger:{ 'migrate-0001-a.sql':1 } });
let r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
  log:quiet, now:()=>'2026-11-08T05:00:00Z' });
console.log('   '+JSON.stringify({ok:r.ok,pending:r.pending,ran:r.ran,
  marked:r.marked}));
ok(r.ok===true,'★通る');
ok(JSON.stringify(r.pending)==='["migrate-0002-b.sql","migrate-0003-c.sql"]',
   '★★★控えにある 0001 は未適用に入れない');
ok(JSON.stringify(r.ran)==='["migrate-0002-b.sql","migrate-0003-c.sql"]',
   '★★★未適用だけを番号順に流す');
ok(d.st.ran.length===2,'★★流した文は2つ（0001 の2文は流さない）');
ok(d.st.marked.length===2&&d.st.marked[0].file==='migrate-0002-b.sql',
   '★★★流したら控えに記録する');
ok(d.st.marked[0].src==='actions','★★★流した場所（actions）も記録する');
ok(d.st.marked[0].at==='2026-11-08T05:00:00Z','★日時も記録する');

console.log('\n=== 二重に流さない（もう一度押しても何もしない）===');
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
  log:quiet });
console.log('   '+JSON.stringify({ok:r.ok,pending:r.pending,note:r.note}));
ok(r.ok===true&&!r.pending.length,'★★★2回目は未適用が0本');
ok(d.st.ran.length===2,'★★★SQL を1文も流さない');
ok(/流すものはありません/.test(r.note),'★そう書く');

console.log('\n=== PC で流したぶんも飛ばす（同じ控えを見る）===');
d=mkDb({ ledger:{} });
/* 手元の d1-exec.mjs が書く文と、d1-migrate.mjs が書く文が同じであること。 */
ok(X.markSql('f.sql','t','pc')===M.sqlMark('f.sql','t','pc'),
   '★★★PC と Actions が**同じ表に同じ書き方**で記録する');
ok(X.LEDGER_NEW===M.SQL_LEDGER_NEW,'★★控えの表を作る文も同じ');
d.exec(X.markSql('migrate-0002-b.sql','2026-11-07T00:00:00Z','pc'));
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
  log:quiet });
console.log('   '+JSON.stringify({ran:r.ran,marked:r.marked}));
ok(r.ran.indexOf('migrate-0002-b.sql')<0,
   '★★★PC（src=pc）で流したファイルは Actions で流さない');
ok(r.ran.indexOf('migrate-0003-c.sql')>=0,'★残りは流す');

console.log('\n=== はじめての実行：もう当たっているものは記録だけ ===');
/* 控えが空で、0001 の列と 0002 の表はすでに D1 にある場面。 */
d=mkDb({ ledger:{}, tables:{ bb:1 }, columns:{ items:{ aa:1, ab:1 } } });
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
  log:quiet });
console.log('   '+JSON.stringify({marked:r.marked,ran:r.ran}));
ok(JSON.stringify(r.marked)==='["migrate-0001-a.sql","migrate-0002-b.sql"]',
   '★★★すでに当たっている2本は**記録だけ**（流し直さない）');
ok(JSON.stringify(r.ran)==='["migrate-0003-c.sql"]',
   '★★★当たっていない1本だけ流す');
ok(d.st.ran.length===1,'★★流した文も1つだけ');
ok(d.st.marked.length===3,'★3本ぜんぶ控えに入る');
/* 2回目は何もしない。 */
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
  log:quiet });
ok(!r.pending.length,'★★次からは未適用が0本');

console.log('\n=== 確かめだけ（dry run）は何も変えない ===');
d=mkDb({ ledger:{} , tables:{ bb:1 }, columns:{ items:{ aa:1, ab:1 } } });
r=await M.migrate({ dir:TMP, src:'actions', dry:true, exec:d.exec,
  query:d.query, log:quiet });
console.log('   '+JSON.stringify({ok:r.ok,todo:r.todo,marked:r.marked,
  note:r.note}));
ok(r.ok===true&&r.dry===true,'★通る');
ok(JSON.stringify(r.todo)==='["migrate-0003-c.sql"]',
   '★★★流すものの一覧を出す');
ok(d.st.ran.length===0&&d.st.marked.length===0,
   '★★★SQL も記録も1つも書かない');
ok(/確かめだけ/.test(r.note),'★そう書く');
/* 控えの表がまだ無くても、確かめだけは通る。 */
d=mkDb({ noLedger:true });
r=await M.migrate({ dir:TMP, src:'actions', dry:true, exec:d.exec,
  query:d.query, log:quiet });
ok(r.ok===true&&r.pending.length===3,'★★控えの表が無くても確かめられる');

console.log('\n=== 途中で失敗したら止める（デプロイに進まない）===');
d=mkDb({ ledger:{}, failAt:/ADD COLUMN cc/, failMsg:'Error: near "cc": syntax error' });
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
  log:quiet });
console.log('   '+JSON.stringify({ok:r.ok,ran:r.ran,at:r.at,failed:r.failed,
  note:r.note}));
ok(r.ok===false,'★★★0 以外で終わる（＝デプロイの手順に進まない）');
ok(r.at==='migrate-0003-c.sql','★★どのファイルで止まったかを返す');
ok(/migrate-0003-c\.sql/.test(r.failed)&&/1\/1/.test(r.failed),
   '★★どの文で止まったかも返す');
ok(/syntax error/.test(r.note),'★★エラーの短い文を返す');
ok(r.ran.indexOf('migrate-0003-c.sql')<0,
   '★★★止まったファイルは控えに入れない（次にやり直せる）');
ok(d.st.ledger['migrate-0003-c.sql']!==1,'★控えにも入っていない');
ok(d.st.ledger['migrate-0002-b.sql']===1,
   '★★そこまでに通ったファイルは控えに入っている（やり直しで飛ばす）');

console.log('\n=== すでに当たっている文は「済み」として進む ===');
d=mkDb({ ledger:{}, doneAt:/ADD COLUMN ab/ });
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
  log:quiet });
ok(r.ok===true&&r.ran.length===3,
   '★★★「duplicate column name」は済みとして飛ばし、止まらない');

console.log('\n=== 控えに記録できなかったときは止める ===');
d=mkDb({ ledger:{}, markFail:'migrate-0002-b.sql' });
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
  log:quiet });
console.log('   '+JSON.stringify({ok:r.ok,failed:r.failed}));
ok(r.ok===false&&/記録できませんでした/.test(r.failed),
   '★★控えに書けないまま進まない（二重に流す元になる）');

console.log('\n=== エラーの文に秘密を入れない ===');
let e=M.shortErr({ status:1,
  stdout:'Using CLOUDFLARE_API_TOKEN=abcdef123456\nAuthorization: Bearer zzz',
  stderr:'✘ [ERROR] Authentication error [code: 10000]' });
console.log('   '+e);
ok(/10000/.test(e),'★エラーの中身は出す');
ok(!/abcdef123456/.test(e)&&!/CLOUDFLARE_API_TOKEN/.test(e),
   '★★★トークンの行は落とす');
ok(!/Bearer/.test(e)&&!/zzz/.test(e),'★★★Authorization の行も落とす');
ok(e.length<=300,'★★長すぎる出力は切る');
e=M.shortErr({ status:null, stdout:'', stderr:'' });
ok(/終了コード なし/.test(e),'★終了コードが無いときもそう書く');

console.log('\n=== wrangler --json の読み取り ===');
let j=M.parseJsonRows('🌀 Executing...\n[{"results":[{"file":"a.sql"},'
  +'{"file":"b.sql"}],"success":true}]');
console.log('   '+JSON.stringify(j));
ok(j.rows.length===2&&j.rows[0].file==='a.sql',
   '★★★飾りの行が混ざっても行を取り出せる');
ok(M.parseJsonRows('{"results":[{"name":"items"}]}').rows.length===1,
   '★★配列でなくても読める');
ok(M.parseJsonRows('こわれています').rows.length===0,
   '★読めないときは空（例外にしない）');
ok(M.SQL_COLS("it'ems").indexOf("it''ems")>0,
   '★★表の名前の ʼ をエスケープする');
ok(M.sqlMark("a'b.sql",'t','pc').indexOf("a''b.sql")>0,
   '★★記録する文もエスケープする');

console.log('\n=== ワークフローの形 ===');
const y=fs.readFileSync(YML,'utf8');
ok(/^name: deploy-pj-sync$/m.test(y),'★名前は deploy-pj-sync');
ok(/workflow_dispatch:/.test(y),'★★★手で押して実行できる');
ok(!/^\s*push:/m.test(y),
   '★★★main への push では動かない（いまは手動だけ）');
ok(/#\s*push:/.test(y)&&/branches: \[main\]/.test(y),
   '★★あとで自動にする書き方をコメントで残してある');
ok(/dry_run:/.test(y)&&/run_migrations:/.test(y)&&/deploy:/.test(y),
   '★★★入力は3つ');
const defs=(y.match(/default: true/g)||[]).length;
ok(defs===3,'★★★3つとも既定は true（'+defs+'つ）');
ok(/type: boolean/.test(y),'★スマホで選べるように boolean');
ok(/concurrency:/.test(y)&&/group: deploy-pj-sync/.test(y),
   '★★★同時に2本走らせない');
ok(/cancel-in-progress: false/.test(y),
   '★★走っている途中のものは止めない（D1 の作業を中断させない）');
ok(/if: github\.ref == 'refs\/heads\/main'/.test(y),
   '★★★main のときだけ動く');
ok(/permissions:\s*\n\s*contents: read/.test(y),
   '★★読み取りの権限だけ');
ok(/working-directory: proxy-sync/.test(y),
   '★★対象は pj-sync だけ（proxy-sync の中だけで動く）');
ok(!/proxy-img|proxy-title|\bproxy\b\/wrangler/.test(y),
   '★★pj-img・pj-title・pj-price は触らない');

console.log('\n=== 外部のアクションは版を固定する ===');
const uses=(y.match(/uses: *\S+/g)||[]).map((x)=>x.replace(/uses: */,''));
console.log('   '+JSON.stringify(uses));
ok(uses.length===2,'★使うのは2つ');
ok(uses.every((u)=>/@(v\d+\.\d+\.\d+|[0-9a-f]{40})$/.test(u)),
   '★★★どれも版（x.y.z か 40桁のコミット）で固定されている');
ok(!uses.some((u)=>/@(main|master|v\d+)$/.test(u)),
   '★★★@main・@v4 のような動く指定は使わない');

console.log('\n=== 秘密の扱い ===');
ok(/secrets\.CLOUDFLARE_API_TOKEN/.test(y)
  &&/secrets\.CLOUDFLARE_ACCOUNT_ID/.test(y)
  &&/secrets\.DISCORD_WEBHOOK_URL/.test(y),
   '★★★3つとも Secrets から読む');
/* 秘密は env 経由だけで渡す（run の中に直接書かない）。 */
const runLines=y.split(/\r?\n/).filter((l)=>/\$\{\{ *secrets\./.test(l));
console.log('   '+JSON.stringify(runLines.map((l)=>l.trim())));
ok(runLines.every((l)=>/^\s*[A-Z_]+: \$\{\{ *secrets\./.test(l)),
   '★★★秘密は env に入れるだけ（コマンドの中には書かない）');
ok(!/echo .*\$\{\{ *secrets\./.test(y)&&!/echo .*\$(HOOK|CLOUDFLARE)/.test(y),
   '★★★秘密を echo しない');
ok(/curl[\s\S]{0,200}> *\/dev\/null/.test(y),
   '★★curl の出力は捨てる（URL を含む応答を残さない）');
ok(!/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}/.test(y),
   '★★★ファイルに生のトークンらしい文字列が無い');
ok(!/discord\.com\/api\/webhooks\/\d/.test(y),
   '★★★webhook の URL をファイルに書かない');

console.log('\n=== 知らせの中身 ===');
ok(/if: always\(\)/.test(y),'★★★成功でも失敗でも知らせる');
ok(/job\.status/.test(y),'★★成功／失敗を入れる');
ok(/steps\.migrate\.outputs\.summary/.test(y),
   '★★★流したマイグレーションを入れる');
ok(/steps\.deploy\.outputs\.version/.test(y),
   '★★★デプロイした版（Version ID）を入れる');
ok(/dry run/.test(y),'★★確かめだけかどうかを入れる');
ok(/止まった手順/.test(y),'★★★失敗したときはどの手順で止まったかを入れる');
ok(/jq -Rs/.test(y),
   '★★文字列として JSON に入れる（中身で JSON が壊れない）');

console.log('\n=== シェルの書き方（set -e で落ちない形）===');
/* GitHub の run: は `bash -e` で動くので、`[ … ] && 代入` は
   条件が false のときにそこで**ステップが失敗**する（よくある落とし穴）。
   ぜんぶ if で書いてあること。 */
const runs=[];
{
  let cur=null;
  for(const line of y.split(/\r?\n/)){
    if(/^\s*run: \|/.test(line)){ cur=[]; runs.push(cur); continue; }
    if(cur===null)continue;
    if(/^\s{0,8}- name:|^\s{0,6}[a-z_]+:$/.test(line)&&!/^\s{10}/.test(line)){
      cur=null; continue;
    }
    cur.push(line);
  }
}
const body=runs.map((x)=>x.join('\n')).join('\n');
ok(runs.length>=4,'★run: の中身を取り出せた（'+runs.length+'か所）');
ok(!/\[[^\]]*\]\s*&&\s*[A-Za-z_]+=/.test(body),
   '★★★`[ … ] && 代入` を使わない（set -e でステップが落ちる形）');
ok(/if \[ "\$RESULT" = "success" \]; then/.test(body),
   '★★if で書いてある');
ok(/set -o pipefail/.test(body),
   '★★tee でつないだ失敗を見落とさない（pipefail）');
ok(!/\$\{\{ *inputs\.[a-z_]+ *\}\}/.test(body),
   '★★★入力をコマンドの中に直接書かない（env 経由で渡す）');
ok(/DRY: \$\{\{ inputs\.dry_run \}\}/.test(y),
   '★★env で渡している');

console.log('\n=== デプロイは確かめだけのときは走らない ===');
ok(/if: inputs\.deploy && !inputs\.dry_run/.test(y),
   '★★★dry_run のときはデプロイしない');
ok(/if: inputs\.run_migrations/.test(y),
   '★★マイグレーションは入力で切れる');
ok(/Version ID/.test(y),'★デプロイの出力から版を読む');
ok(/timeout-minutes:/.test(y),'★時間の上限がある');

/* 片付け */
fs.rmSync(TMP,{ recursive:true, force:true });
T.done();
