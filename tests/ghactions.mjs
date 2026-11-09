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
import os from 'node:os';
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
/* 最後は**いちばん番号の大きいファイル**。番号を直に書くと
   マイグレーションを足すたびにここが落ちるので、番号で見る。 */
const noOf=(f)=>+(/^migrate-(\d+)/.exec(f)||[0,0])[1];
ok(noOf(files[files.length-1])===Math.max(...files.map(noOf)),
   '★★いちばん大きい番号が最後（'+files[files.length-1]+'）');
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

console.log('\n=== もう当たっているかの判定（空振りの SELECT・7.117）===');
/* sqlite_master と pragma_table_info は Cloudflare の API に断られる
   （2026-11-08 runs/42489949958：45本ぜんぶ「流す」になった原因）。
   ふだんの SELECT で「その表・その列があるか」を確かめる。 */
ok(M.probeTableSql('amz_drop')==='SELECT 1 FROM "amz_drop" LIMIT 0',
   '★★★表があるかは SELECT 1 FROM … LIMIT 0 で確かめる');
/* 7.123：列は**必ず「表.列」**で名指しする。
   素の `SELECT "列"` だと、SQLite の古い仕様（DQS）で**無い列が文字列になり、
   エラーにならない**（D1 では DQS が有効）。そのため列だけを足すファイルが
   ぜんぶ「済み」と誤判定され、記録だけされて流れていなかった。 */
ok(M.probeColsSql('mw_amz',['used_low','used_n'])
   ==='SELECT "mw_amz"."used_low","mw_amz"."used_n" FROM "mw_amz" LIMIT 0',
   '★★★列は「表.列」で名指しする（DQS で文字列にならないように）');
ok(!/SELECT "used_low"/.test(M.probeColsSql('mw_amz',['used_low'])),
   '★★★素の "列" では確かめない（無い列でも通ってしまう）');
ok(M.probeTableSql('a"b').indexOf('"a""b"')>0
   &&M.probeColsSql('t',['a"b']).indexOf('"a""b"')>0,
   '★★名前の " をエスケープする');
ok(!/sqlite_master|pragma_table_info/.test(
     M.probeTableSql('t')+M.probeColsSql('t',['c'])),
   '★★★sqlite_master と pragma_table_info は使わない');
ok(M.missKind('Error: no such table: amz_drop')==='table','★「表が無い」を読む');
ok(M.missKind('Error: no such column: used_low')==='column','★「列が無い」を読む');
ok(M.missKind('has no column named kind')==='column','★別の言い方も読む');
ok(M.missKind('A request to the Cloudflare API failed')==='',
   '★★★それ以外（API の失敗など）は「無い」と決めつけない');

/* judgeFile：作りものの probe で、4つの状態を確かめる。 */
const mkProbe=(opt)=>{
  const o=opt||{};
  const have=Object.assign({},o.tables||{});
  const cols=o.columns||{};
  const seen=[];
  return { seen, probe:async(sql)=>{
    seen.push(sql);
    if(o.apiNg)return { ok:false, err:'A request to the Cloudflare API failed' };
    const m=/FROM "([^"]+)" LIMIT 0$/.exec(sql);
    const t=m?m[1]:'';
    if(!have[t])return { ok:false, err:'Error: no such table: '+t };
    const want=(sql.match(/"([^"]+)"/g)||[]).map((x)=>x.slice(1,-1))
      .filter((x)=>x!==t);
    for(const c of want)
      if(!(cols[t]||{})[c])
        return { ok:false, err:'Error: no such column: '+c };
    return { ok:true, err:'' };
  } };
};
let P=mkProbe({ tables:{ mw_amz:1 },
  columns:{ mw_amz:{ used_low:1, used_n:1, used_at:1 } } });
let g=await M.judgeFile({ tables:[], indexes:[], other:0,
  columns:[{table:'mw_amz',column:'used_low'},{table:'mw_amz',column:'used_n'}] },
  P.probe);
console.log('   '+JSON.stringify(g)+' 問い合わせ '+P.seen.length+'回');
ok(g.state==='done','★★★列が揃っていれば「済み」');
ok(P.seen.length===1,
   '★★★揃っているときは表ごとに1回だけ聞く（遅くならない）');
P=mkProbe({ tables:{ mw_amz:1 }, columns:{ mw_amz:{ used_low:1 } } });
g=await M.judgeFile({ tables:[], indexes:[], other:0,
  columns:[{table:'mw_amz',column:'used_low'},{table:'mw_amz',column:'used_n'},
           {table:'mw_amz',column:'used_at'}] },P.probe);
console.log('   '+JSON.stringify(g));
ok(g.state==='todo','★★★1つでも無ければ「未適用」');
ok(JSON.stringify(g.miss)==='["mw_amz.used_n","mw_amz.used_at"]',
   '★★★足りないものを**名前で**返す（1列ずつ聞き直す）');
ok(/足りないもの：mw_amz\.used_n・mw_amz\.used_at/.test(g.why),
   '★★そのまま出せる文も返す');
P=mkProbe({ tables:{} });
g=await M.judgeFile({ tables:['amz_drop'], columns:[], indexes:[], other:0 },
  P.probe);
ok(g.state==='todo'&&g.miss[0]==='表 amz_drop','★★★表が無い行も分かる');
P=mkProbe({ tables:{ amz_drop:1 } });
g=await M.judgeFile({ tables:['amz_drop'], columns:[], indexes:['ix'], other:0 },
  P.probe);
ok(g.state==='done','★★索引は判定に使わない（CREATE INDEX IF NOT EXISTS なので）');
g=await M.judgeFile({ tables:[], columns:[], indexes:[], other:1 },P.probe);
ok(g.state==='data'&&/UPDATE/.test(g.why),
   '★★★UPDATE などが入るファイルは「要確認」');
g=await M.judgeFile({ tables:[], columns:[], indexes:['ix'], other:0 },P.probe);
ok(g.state==='data','★★索引しか足さないファイルも「要確認」（確かめられない）');
P=mkProbe({ apiNg:true });
g=await M.judgeFile({ tables:['amz_drop'], columns:[], indexes:[], other:0 },
  P.probe);
console.log('   '+JSON.stringify(g));
ok(g.state==='unknown'&&/Cloudflare/.test(g.why),
   '★★★確かめられなかったときは「判定できない」（勝手に流さない）');
/* 同じ問い合わせは1回だけ（memo）。 */
P=mkProbe({ tables:{ t:1 }, columns:{ t:{ a:1 } } });
const memo={};
await M.judgeFile({ tables:['t'], columns:[{table:'t',column:'a'}], indexes:[],
  other:0 },P.probe,memo);
const n1=P.seen.length;
await M.judgeFile({ tables:['t'], columns:[{table:'t',column:'a'}], indexes:[],
  other:0 },P.probe,memo);
ok(P.seen.length===n1,'★★同じ問い合わせは控えから返す（ファイル間でも）');

console.log('\n=== 「この番号までは済み」（baseline）===');
ok(M.baseNo('0039')===39&&M.baseNo('39')===39,'★★番号で指定できる');
ok(M.baseNo('migrate-0039-fba-split.sql')===39,'★ファイル名でも指定できる');
ok(M.baseNo('')===0&&M.baseNo(null)===0&&M.baseNo('なにか')===0,
   '★★空や読めない値は「指定なし」');

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
    /* 7.123：流したら**本物と同じように作りが増える**（表・列）。
       ここを増やさないと、流した直後の確かめ（verify）で
       「まだ足りない」と出てしまい、作り物だけが現実と食い違う。 */
    let a=/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z0-9_]+)/i.exec(s);
    if(a)st.tables[a[1]]=1;
    a=/^ALTER\s+TABLE\s+["'`]?([A-Za-z0-9_]+)["'`]?\s+ADD\s+(?:COLUMN\s+)?["'`]?([A-Za-z0-9_]+)/i
      .exec(s);
    if(a){ st.columns[a[1]]=st.columns[a[1]]||{}; st.columns[a[1]][a[2]]=1; }
    a=/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z0-9_]+)/i
      .exec(s);
    if(a)st.indexes[a[1]]=1;
    return { status:0, stdout:'', stderr:'' };
  };
  const query=async(sql)=>{
    if(sql===M.SQL_LEDGER){
      if(o.noLedger)throw new Error('no such table: _migrations');
      return Object.keys(st.ledger).map((f)=>({ file:f }));
    }
    return [];
  };
  /* 7.117：空振りの SELECT で表・列の有無を答える。 */
  st.probed=[];
  const probe=async(sql)=>{
    st.probed.push(sql);
    if(o.apiNg)return { ok:false, err:'A request to the Cloudflare API failed' };
    const m=/FROM "([^"]+)" LIMIT 0$/.exec(sql);
    const t=m?m[1]:'';
    if(!st.tables[t])return { ok:false, err:'Error: no such table: '+t };
    const want=(sql.match(/"([^"]+)"/g)||[]).map((x)=>x.slice(1,-1))
      .filter((x)=>x!==t);
    for(const c of want)
      if(!(st.columns[t]||{})[c])
        return { ok:false, err:'Error: no such column: '+c };
    return { ok:true, err:'' };
  };
  return { st, exec, query, probe };
};
/* お試しの置き場所。**リポジトリの外**に作る
   （途中で落ちても .pjmig-… が散らからないように）。 */
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'pjmig-'));
fs.writeFileSync(path.join(TMP,'migrate-0001-a.sql'),
  'ALTER TABLE items ADD COLUMN aa TEXT;\nALTER TABLE items ADD COLUMN ab TEXT;\n');
fs.writeFileSync(path.join(TMP,'migrate-0002-b.sql'),
  'CREATE TABLE IF NOT EXISTS bb (id INTEGER);\n');
fs.writeFileSync(path.join(TMP,'migrate-0003-c.sql'),
  'ALTER TABLE items ADD COLUMN cc TEXT;\n');
const quiet=()=>{};

console.log('\n=== 未適用だけを流す（控えにあるものは飛ばす）===');
/* 7.123：控えで「済み」のファイルは**作りも揃っている**ことにする
   （揃っていなければ未適用に戻るのが新しいふるまい。下の塊で確かめる）。 */
let d=mkDb({ ledger:{ 'migrate-0001-a.sql':1 },
  columns:{ items:{ aa:1, ab:1 } } });
let r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query, probe:d.probe,
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
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query, probe:d.probe,
  log:quiet });
console.log('   '+JSON.stringify({ok:r.ok,pending:r.pending,note:r.note}));
ok(r.ok===true&&!r.pending.length,'★★★2回目は未適用が0本');
ok(d.st.ran.length===2,'★★★SQL を1文も流さない');
ok(/流すものはありません/.test(r.note),'★そう書く');

console.log('\n=== PC で流したぶんも飛ばす（同じ控えを見る）===');
/* 7.123：PC がほんとうに流してあるので、0002 の表 bb はもうある
   （無ければ「控えでは済みだが作りが足りない」として流し直すのが正しい）。 */
d=mkDb({ ledger:{}, tables:{ items:1, bb:1 } });
/* 手元の d1-exec.mjs が書く文と、d1-migrate.mjs が書く文が同じであること。 */
ok(X.markSql('f.sql','t','pc')===M.sqlMark('f.sql','t','pc'),
   '★★★PC と Actions が**同じ表に同じ書き方**で記録する');
ok(X.LEDGER_NEW===M.SQL_LEDGER_NEW,'★★控えの表を作る文も同じ');
d.exec(X.markSql('migrate-0002-b.sql','2026-11-07T00:00:00Z','pc'));
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query, probe:d.probe,
  log:quiet });
console.log('   '+JSON.stringify({ran:r.ran,marked:r.marked}));
ok(r.ran.indexOf('migrate-0002-b.sql')<0,
   '★★★PC（src=pc）で流したファイルは Actions で流さない');
ok(r.ran.indexOf('migrate-0003-c.sql')>=0,'★残りは流す');

console.log('\n=== はじめての実行：もう当たっているものは記録だけ ===');
/* 控えが空で、0001 の列と 0002 の表はすでに D1 にある場面。 */
d=mkDb({ ledger:{}, tables:{ bb:1 }, columns:{ items:{ aa:1, ab:1 } } });
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query, probe:d.probe,
  log:quiet });
console.log('   '+JSON.stringify({marked:r.marked,ran:r.ran}));
ok(JSON.stringify(r.marked)==='["migrate-0001-a.sql","migrate-0002-b.sql"]',
   '★★★すでに当たっている2本は**記録だけ**（流し直さない）');
ok(JSON.stringify(r.ran)==='["migrate-0003-c.sql"]',
   '★★★当たっていない1本だけ流す');
ok(d.st.ran.length===1,'★★流した文も1つだけ');
ok(d.st.marked.length===3,'★3本ぜんぶ控えに入る');
/* 2回目は何もしない。 */
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query, probe:d.probe,
  log:quiet });
ok(!r.pending.length,'★★次からは未適用が0本');

console.log('\n=== 確かめだけ（dry run）は何も変えない ===');
d=mkDb({ ledger:{} , tables:{ bb:1 }, columns:{ items:{ aa:1, ab:1 } } });
r=await M.migrate({ dir:TMP, src:'actions', dry:true, exec:d.exec,
  query:d.query, probe:d.probe, log:quiet });
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
  query:d.query, probe:d.probe, log:quiet });
ok(r.ok===true&&r.pending.length===3,'★★控えの表が無くても確かめられる');

console.log('\n=== 途中で失敗したら止める（デプロイに進まない）===');
d=mkDb({ ledger:{}, failAt:/ADD COLUMN cc/, failMsg:'Error: near "cc": syntax error' });
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query, probe:d.probe,
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
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query, probe:d.probe,
  log:quiet });
ok(r.ok===true&&r.ran.length===3,
   '★★★「duplicate column name」は済みとして飛ばし、止まらない');

console.log('\n=== 控えに記録できなかったときは止める ===');
d=mkDb({ ledger:{}, markFail:'migrate-0002-b.sql' });
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query, probe:d.probe,
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
   '★★★基本の入力は3つ（確かめだけ・D1・デプロイ）');
/* 7.123：控えを信じずに作りを確かめる（verify）と、名指しの流し直し（rerun）。 */
ok(/\n      verify:/.test(y)&&/\n      rerun:/.test(y),
   '★★★控えの確かめ（verify）と流し直し（rerun）の入力がある');
/* 既定が true なのは「確かめだけ」「D1」「デプロイ」「控えの確かめ」の4つ。
   いちばん安全な側（何も壊さない側）が既定であること。 */
const defs=(y.match(/default: true/g)||[]).length;
ok(defs===4,'★★★既定が true なのは4つ（'+defs+'つ）');
ok(/verify:[\s\S]{0,200}?default: true/.test(y),
   '★★★控えの確かめは既定オン（控えは「流したつもり」の記録にすぎない）');
ok(/allow_data:[\s\S]{0,200}?default: false/.test(y),
   '★★UPDATE を流すのは既定オフ');
ok(/VERIFY: \$\{\{ inputs\.verify \}\}/.test(y)
   &&/--no-verify/.test(y)&&/--rerun/.test(y),
   '★★★入力を d1-migrate.mjs に渡している');
/* 7.117：あとから足した2つ。 */
ok(/baseline_to:/.test(y)&&/type: string/.test(y)&&/default: ''/.test(y),
   '★★★「この番号までは済み」の入力があり、既定は空');
ok(/allow_data:/.test(y)&&/default: false/.test(y),
   '★★★「UPDATE が入るファイルも流す」の入力があり、既定はオフ');
ok(/--baseline \$BASE/.test(y)&&/--allow-data/.test(y),
   '★★その2つを d1-migrate.mjs に渡す');
ok(/--summary mig-summary\.txt/.test(y)&&/cat mig-summary\.txt/.test(y),
   '★★★知らせは d1-migrate.mjs が書いた短い文を使う');
ok(/CODE=\$\?/.test(y)&&/exit "\$CODE"/.test(y),
   '★★★失敗しても知らせを出してから、同じ終了コードで終わる');
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

console.log('\n=== UPDATE が入るファイルは、初回は流さずに止める（7.117）===');
/* 作りものの置き場所に、UPDATE が入るファイルを1本足す。 */
fs.writeFileSync(path.join(TMP,'backfill-0002-b.sql'),
  "UPDATE items SET aa='x' WHERE ab IS NULL;\n");
d=mkDb({ ledger:{}, tables:{ bb:1 }, columns:{ items:{ aa:1, ab:1, cc:1 } } });
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
  probe:d.probe, log:quiet });
console.log('   '+JSON.stringify({ok:r.ok,failed:r.failed,data:r.data,
  marked:r.marked.length,ran:r.ran}));
ok(r.ok===false,'★★★0 以外で終わる（デプロイに進まない）');
ok(JSON.stringify(r.data)==='["backfill-0002-b.sql"]',
   '★★★UPDATE が入るファイルを「要確認」として挙げる');
ok(/データを動かす文/.test(r.failed),'★★なぜ止めたかを返す');
ok(/「データを動かすファイルも流す」/.test(r.note)&&/baseline/.test(r.note),
   '★★★どうすればよいか（allow_data か baseline）も返す');
ok(d.st.ran.length===0&&d.st.marked.length===0,
   '★★★止めたときは SQL も記録も1つも書かない');
/* 見たうえで allowData を付ければ流せる。 */
d=mkDb({ ledger:{}, tables:{ bb:1 }, columns:{ items:{ aa:1, ab:1, cc:1 } } });
r=await M.migrate({ dir:TMP, src:'actions', allowData:true, exec:d.exec,
  query:d.query, probe:d.probe, log:quiet });
console.log('   '+JSON.stringify({ok:r.ok,ran:r.ran,marked:r.marked}));
ok(r.ok===true&&JSON.stringify(r.ran)==='["backfill-0002-b.sql"]',
   '★★★allow_data を付けると流す');
ok(r.marked.length===3,'★ほかの3本は記録だけ');
/* 判定できないファイルがあるときは、1本も流さない。 */
d=mkDb({ ledger:{}, apiNg:true });
r=await M.migrate({ dir:TMP, src:'actions', allowData:true, exec:d.exec,
  query:d.query, probe:d.probe, log:quiet });
console.log('   '+JSON.stringify({ok:r.ok,failed:r.failed,
  unknown:r.unknown.length}));
ok(r.ok===false&&r.unknown.length===3,
   '★★★D1 の作りを確かめられないときは「判定できない」');
ok(d.st.ran.length===0&&d.st.marked.length===0,
   '★★★そのときも1本も流さない（勝手に流し直さない）');
ok(/確かめられない/.test(r.failed),'★★理由を返す');

console.log('\n=== 「この番号までは済み」（baseline）で記録だけにする ===');
d=mkDb({ ledger:{}, apiNg:true });      // 作りが読めなくても baseline は効く
r=await M.migrate({ dir:TMP, src:'actions', baselineTo:'0002', exec:d.exec,
  query:d.query, probe:d.probe, log:quiet });
console.log('   '+JSON.stringify({ok:r.ok,marked:r.marked,unknown:r.unknown}));
ok(JSON.stringify(r.marked)==='["migrate-0001-a.sql","migrate-0002-b.sql",'
  +'"backfill-0002-b.sql"]',
   '★★★0002 以下は（UPDATE が入るものも）記録だけ');
ok(r.unknown.length===1&&r.unknown[0]==='migrate-0003-c.sql',
   '★★★0002 より上は今までどおり確かめる');
ok(d.st.probed.every((q)=>/migrate-0003|items|\bcc\b/.test(q))
   ||d.st.probed.length<=2,
   '★★baseline のぶんは D1 に聞かない（速い）');
/* baseline で済みになった行は src 付きで控えに入る。 */
d=mkDb({ ledger:{}, tables:{ bb:1 }, columns:{ items:{ aa:1, ab:1, cc:1 } } });
r=await M.migrate({ dir:TMP, src:'actions', baselineTo:'0045', exec:d.exec,
  query:d.query, probe:d.probe, log:quiet,
  now:()=>'2026-11-08T06:00:00Z' });
console.log('   '+JSON.stringify({ok:r.ok,marked:r.marked.length,ran:r.ran,
  probed:d.st.probed.length}));
ok(r.ok===true&&r.marked.length===4&&!r.ran.length,
   '★★★大きい番号を入れればぜんぶ記録だけになる');
ok(d.st.probed.length===0,'★★★そのときは D1 に1回も聞かない');
ok(d.st.marked.length===4&&d.st.marked[0].src==='actions'
   &&d.st.marked[0].at==='2026-11-08T06:00:00Z','★控えの中身も入る');
ok(r.judge.every((x)=>x.state==='base'),'★★判定は「baseline」と出す');
/* 次に押したときは、控えにあるので何もしない。 */
r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
  probe:d.probe, log:quiet });
ok(r.ok===true&&!r.pending.length,'★★★baseline のあとは未適用が0本');
fs.unlinkSync(path.join(TMP,'backfill-0002-b.sql'));

console.log('\n=== 判定の結果をファイルごとに返す（知らせに出す）===');
d=mkDb({ ledger:{}, tables:{ bb:1 }, columns:{ items:{ aa:1, ab:1 } } });
r=await M.migrate({ dir:TMP, src:'actions', dry:true, exec:d.exec,
  query:d.query, probe:d.probe, log:quiet });
const st2={}; r.judge.forEach((x)=>{ st2[x.file]=x; });
console.log('   '+JSON.stringify(r.judge));
ok(st2['migrate-0001-a.sql'].state==='done'
   &&/表・列が揃っている/.test(st2['migrate-0001-a.sql'].why),
   '★★★済みは「表・列が揃っている」と返す');
ok(st2['migrate-0003-c.sql'].state==='todo'
   &&/足りないもの：items\.cc/.test(st2['migrate-0003-c.sql'].why),
   '★★★未適用は「足りないもの：○○」と返す');
const sum=M.summaryText(r);
console.log('   --- 知らせ ---\n'+sum);
ok(/済みとして記録だけ 2本/.test(sum),'★★知らせに件数を出す');
ok(/▶ migrate-0003-c\.sql/.test(sum)&&/items\.cc/.test(sum),
   '★★★知らせに「流す」行と足りないものを出す');
ok(!/migrate-0001-a\.sql/.test(sum),
   '★★済みの行は並べない（長くなるので件数だけ）');
ok(M.SUMMARY_MAX===30,'★並べるのは30本まで');

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
