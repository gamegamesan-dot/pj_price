/* 道具＋Worker：列の有無の確かめ方（7.123・【v245 の直し】）

   起きたこと
     deploy-pj-sync の dry_run で migrate-0048-mw-auto.sql が
     「済み（表・列が揃っている）→ 記録だけ」と判定された。
     実際には列が無く、⚙「自動の回の記録を見る」は
     「pj-sync 側の D1 に記録の表がありません。」と出ていた。

   原因
     SQLite には「二重引用符の中が列として見つからなければ**文字列**として
     扱う」という古い仕様（DQS）があり、**D1 ではこれが有効**。
       SELECT "asin_n" FROM "mw_auto_runs" LIMIT 0   → 成功（文字列を返す）
       SELECT "mw_auto_runs"."asin_n" FROM … LIMIT 0 → no such column
     実機（wrangler d1 execute --json）で確かめた：
       素の "列"  … 終了コード0・success
       表.列      … 終了コード1・no such column: mw_auto_runs.asin_n
     そのため
       ・d1-migrate.mjs の probeColsSql（列だけを足すファイルがぜんぶ「済み」）
       ・worker.js の colOk（列が無くても「ある」と答える）
     の両方が壊れていた。**node:sqlite は DQS が切ってある**ので、
     テストだけ正しく落ちていて気づけなかった。

   直したこと
     ・どちらも「表.列」で名指しする
     ・tests/lib.mjs の作り物も **D1 と同じふるまい**にした（dqsProbe）
     ・控えで「済み」のファイルも作りを確かめ、足りなければ未適用に戻す（verify）
     ・名指しで流し直せるようにした（rerun） */
import { harness, loadWorker, makeEnv, dqsProbe, makeDB } from './lib.mjs';
import * as M from '../proxy-sync/d1-migrate.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const T=harness('道具：列の有無の確かめ方（7.123）');
const ok=T.ok;
const { T:W }=await loadWorker('dqs');

console.log('=== 作り物が D1 と同じふるまいをする（これが無いと気づけない）===');
ok(dqsProbe('SELECT "asin_n","ms" FROM "mw_auto_runs" LIMIT 0')===true,
   '★★★素の "列" だけの空振りの SELECT を見分ける');
ok(dqsProbe('SELECT "mw_auto_runs"."asin_n" FROM "mw_auto_runs" LIMIT 0')===false,
   '★★★「表.列」は見分けの対象にしない（こちらは DQS が効かない）');
ok(dqsProbe('SELECT 1 FROM "mw_auto_runs" LIMIT 0')===false,
   '★表の確かめ（SELECT 1）は別');
ok(dqsProbe('SELECT "a" FROM "t"')===false,'★LIMIT 0 でなければ対象外');
{
  const db=makeDB();
  const a=await db.prepare('SELECT "nope" FROM "items" LIMIT 0').all();
  ok(a&&Array.isArray(a.results)&&!a.results.length,
     '★★★素の "列" は**無い列でも通る**（D1 と同じ）');
  let err='';
  try{ await db.prepare('SELECT "items"."nope" FROM "items" LIMIT 0').all(); }
  catch(e){ err=String(e.message||e); }
  ok(/no such column/.test(err),'★★★「表.列」なら無い列で落ちる');
  let ok2=true;
  try{ await db.prepare('SELECT "items"."asin" FROM "items" LIMIT 0').all(); }
  catch(e){ ok2=false; }
  ok(ok2===true,'★★ある列なら通る');
}

console.log('\n=== d1-migrate：列は「表.列」で名指しする ===');
ok(M.probeColsSql('mw_auto_runs',['asin_n','ms'])
   ==='SELECT "mw_auto_runs"."asin_n","mw_auto_runs"."ms" FROM "mw_auto_runs" LIMIT 0',
   '★★★表で修飾した名前で確かめる');
ok(!dqsProbe(M.probeColsSql('mw_auto_runs',['asin_n'])),
   '★★★DQS で素通りする形になっていない');
ok(M.probeTableSql('mw_auto_runs')==='SELECT 1 FROM "mw_auto_runs" LIMIT 0',
   '★表の確かめは今までどおり');
/* 引用符を含む名前でも壊れない。 */
ok(M.probeColsSql('a"b',['c"d'])
   ==='SELECT "a""b"."c""d" FROM "a""b" LIMIT 0','★引用符は二重にして逃がす');

console.log('\n=== worker：colOk も「表.列」で聞く ===');
{
  const env=makeEnv();
  const asked=[];
  const real=env.DB.prepare.bind(env.DB);
  env.DB.prepare=(sql)=>{ asked.push(String(sql)); return real(sql); };
  /* schema.sql にある列。 */
  const yes=await W.colOk(env,'mw_auto_runs','per_hour');
  /* 無い列。 */
  const no=await W.colOk(env,'mw_auto_runs','ありません');
  console.log('   '+asked.join(' / ').slice(0,200));
  ok(asked.every((s)=>!dqsProbe(s)),
     '★★★素の "列" では聞かない（聞くと無い列でも「ある」になる）');
  ok(asked.some((s)=>/"mw_auto_runs"\."per_hour"/.test(s)),
     '★★★「表.列」で聞く');
  ok(yes===true,'★★ある列は true');
  ok(no===false,'★★★無い列は false（v244 は true になっていた）');
  /* 無い表も false。 */
  ok(await W.colOk(env,'そんな表','x')===false,'★★無い表も false');
  /* 「ある」は覚えるが、「無い」は覚えない（流した直後に効くように）。 */
  asked.length=0;
  await W.colOk(env,'mw_auto_runs','per_hour');
  ok(asked.length===0,'★★「ある」は覚えて二度聞かない');
  asked.length=0;
  await W.colOk(env,'mw_auto_runs','ありません');
  ok(asked.length>0,'★★★「無い」は覚えない（流した直後に効く）');
}

console.log('\n=== 列だけを足すファイルが「済み」と誤判定されないこと ===');
/* 本物の D1 と同じ probe（DQS あり）を作り、
   「表はあるが列が無い」場面で judgeFile が何と言うかを見る。 */
const d1probe=(have)=>async(sql)=>{
  /* 表の確かめ。 */
  let m=/^SELECT 1 FROM "([^"]+)" LIMIT 0$/.exec(sql);
  if(m)return have[m[1]]?{ ok:true, err:'' }
    :{ ok:false, err:'Error: no such table: '+m[1] };
  /* 素の "列" … D1 はここで**通してしまう**（DQS）。 */
  if(dqsProbe(sql))return { ok:true, err:'' };
  /* 表.列 … ちゃんと見る。 */
  m=/FROM "([^"]+)" LIMIT 0$/.exec(sql);
  const t=m?m[1]:'';
  if(!have[t])return { ok:false, err:'Error: no such table: '+t };
  const cols=(sql.match(/"[^"]+"\."([^"]+)"/g)||[])
    .map((x)=>x.replace(/^.*\."/,'').replace(/"$/,''));
  for(const c of cols)
    if(!have[t][c])
      return { ok:false, err:'Error: no such column: '+t+'.'+c };
  return { ok:true, err:'' };
};
{
  /* mw_auto_runs はあるが、0048 が足す列は無い（本番と同じ場面）。 */
  const have={ mw_auto_runs:{ at:1, kind:1, price_n:1 } };
  const objs=M.sqlObjects(
    fs.readFileSync('proxy-sync/migrate-0048-mw-auto.sql','utf8'));
  console.log('   0048 が足す列 '+objs.columns.length+'個');
  ok(objs.columns.length===9&&!objs.tables.length,
     '★0048 は列だけを足すファイル（表は作らない）');
  const g=await M.judgeFile(objs,d1probe(have),{});
  console.log('   '+JSON.stringify(g).slice(0,200));
  ok(g.state==='todo','★★★列が無ければ「未適用」と言う（v245 では done だった）');
  ok(/mw_auto_runs\.asin_n/.test(g.miss.join('・')),
     '★★★足りない列を名前で出す');
  /* 列が揃っていれば「済み」。 */
  const have2={ mw_auto_runs:Object.assign({ at:1 },
    Object.fromEntries(objs.columns.map((c)=>[c.column,1]))) };
  const g2=await M.judgeFile(objs,d1probe(have2),{});
  ok(g2.state==='done','★★★揃っていれば「済み」');
}
{
  /* 0047 も同じ（mw_stock.back_at ほか）。 */
  const objs=M.sqlObjects(
    fs.readFileSync('proxy-sync/migrate-0047-mw-nt.sql','utf8'));
  const have={ mw_stock:{ jan:1 }, mw_buy:{ jan:1 }, mw_csv_runs:{ at:1 } };
  const g=await M.judgeFile(objs,d1probe(have),{});
  ok(g.state==='todo'&&/mw_stock\.back_at/.test(g.miss.join('・')),
     '★★★0047 も「未適用」と分かる');
}
{
  /* リポジトリのぜんぶのファイルで、列だけを足すものがいくつあるか。
     どれも同じ間違いで「済み」になっていたので、数を見張る。 */
  const files=M.fileList('proxy-sync');
  let colOnly=0;
  for(const f of files){
    const o=M.sqlObjects(fs.readFileSync('proxy-sync/'+f,'utf8'));
    if(o.other===0&&!o.tables.length&&o.columns.length)colOnly++;
  }
  console.log('   列だけを足すファイル '+colOnly+'本／'+files.length+'本');
  ok(colOnly>=20,
     '★★★列だけを足すファイルは '+colOnly+'本ある（ぜんぶ誤判定されていた）');
}

console.log('\n=== 控えで「済み」でも、作りが足りなければ未適用に戻す（verify）===');
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'pjdqs-'));
fs.writeFileSync(path.join(TMP,'migrate-0001-a.sql'),
  'ALTER TABLE items ADD COLUMN aa TEXT;\n');
fs.writeFileSync(path.join(TMP,'migrate-0002-b.sql'),
  'CREATE TABLE IF NOT EXISTS bb (id INTEGER);\n');
const mk=(have,ledger)=>{
  const st={ have:JSON.parse(JSON.stringify(have)), ran:[], marked:[],
    ledger:Object.assign({},ledger||{}) };
  const exec=(stmt)=>{
    const s=String(stmt);
    let m=/^INSERT OR REPLACE INTO _migrations \(file, at, src\) VALUES \('([^']+)'/
      .exec(s);
    if(m){ st.ledger[m[1]]=1; st.marked.push(m[1]); return { status:0 }; }
    if(/^CREATE TABLE IF NOT EXISTS _migrations/.test(s))return { status:0 };
    st.ran.push(s);
    let a=/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/i.exec(s);
    if(a)st.have[a[1]]=st.have[a[1]]||{ id:1 };
    a=/^ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+ADD\s+COLUMN\s+([A-Za-z0-9_]+)/i.exec(s);
    if(a){ st.have[a[1]]=st.have[a[1]]||{}; st.have[a[1]][a[2]]=1; }
    return { status:0 };
  };
  return { st, exec,
    query:async(sql)=>(sql===M.SQL_LEDGER
      ? Object.keys(st.ledger).map((f)=>({ file:f })) : []),
    probe:(sql)=>d1probe(st.have)(sql) };
};
const quiet=()=>{};
{
  /* 控えには 0001 が「済み」と書いてあるが、items.aa が無い場面
     （これがカジの D1 の 0047／0048 と同じ状態）。 */
  const d=mk({ items:{ asin:1 }, bb:{ id:1 } },{ 'migrate-0001-a.sql':1 });
  const r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
    probe:d.probe, log:quiet, now:()=>'2026-11-09T05:00:00Z' });
  console.log('   '+JSON.stringify({ ok:r.ok, relist:r.relist, ran:r.ran,
    marked:r.marked }));
  ok(r.ok===true,'★通る');
  ok(JSON.stringify(r.relist)==='["migrate-0001-a.sql"]',
     '★★★控えでは済みでも、作りが足りなければ未適用に戻す');
  ok(r.ran.indexOf('migrate-0001-a.sql')>=0,'★★★戻した分を流す');
  ok(d.st.have.items.aa===1,'★★★列がちゃんと増える');
  ok(/ALTER TABLE items ADD COLUMN aa/.test(d.st.ran.join(' ')),
     '★★SQL が流れている');
  /* もう一度やれば、何も流さない。 */
  const r2=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
    probe:d.probe, log:quiet });
  ok(r2.ok===true&&!r2.relist.length&&!r2.ran.length,
     '★★★揃ったあとは何も流さない（二重に流さない）');
}
{
  /* --no-verify なら今までどおり控えを信じる。 */
  const d=mk({ items:{ asin:1 }, bb:{ id:1 } },{ 'migrate-0001-a.sql':1 });
  const r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
    probe:d.probe, log:quiet, verify:false });
  ok(!r.relist.length&&r.ran.indexOf('migrate-0001-a.sql')<0,
     '★★★--no-verify のときは控えを信じて飛ばす');
}
{
  /* データを動かすファイルは、控えにあるなら触らない（二重に流さない）。 */
  fs.writeFileSync(path.join(TMP,'migrate-0003-d.sql'),
    "UPDATE items SET asin='x';\n");
  const d=mk({ items:{ asin:1 }, bb:{ id:1 } },
    { 'migrate-0001-a.sql':1, 'migrate-0002-b.sql':1, 'migrate-0003-d.sql':1 });
  d.st.have.items.aa=1;
  const r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
    probe:d.probe, log:quiet });
  console.log('   '+JSON.stringify({ relist:r.relist, ran:r.ran,
    data:r.data, note:r.note }));
  ok(!r.relist.length&&!r.ran.length,
     '★★★UPDATE が入るファイルは控えにあれば触らない（二重に流さない）');
  fs.unlinkSync(path.join(TMP,'migrate-0003-d.sql'));
}

console.log('\n=== 名指しで流し直す（rerun）===');
{
  const d=mk({ items:{ asin:1, aa:1 }, bb:{ id:1 } },
    { 'migrate-0001-a.sql':1, 'migrate-0002-b.sql':1 });
  /* 作りは揃っているので、ふつうなら何も流さない。 */
  let r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
    probe:d.probe, log:quiet });
  ok(!r.ran.length,'★ふだんは何も流さない');
  /* 番号で指す。 */
  r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
    probe:d.probe, log:quiet, rerun:'0001' });
  console.log('   '+JSON.stringify({ rerun:r.rerun, ran:r.ran }));
  ok(JSON.stringify(r.rerun)==='["migrate-0001-a.sql"]'
     &&r.ran.indexOf('migrate-0001-a.sql')>=0,
     '★★★番号（0001）で流し直せる');
  /* 「48」のように0を落としても効く。 */
  r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
    probe:d.probe, log:quiet, rerun:'1' });
  ok(r.ran.indexOf('migrate-0001-a.sql')>=0,'★★0を落とした番号でも効く');
  /* 名前の一部でも指せる。 */
  r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
    probe:d.probe, log:quiet, rerun:'0002-b' });
  ok(r.ran.indexOf('migrate-0002-b.sql')>=0,'★★★名前の一部でも指せる');
  /* 無い名前は、何も流さずに止める（黙って無視しない）。 */
  r=await M.migrate({ dir:TMP, src:'actions', exec:d.exec, query:d.query,
    probe:d.probe, log:quiet, rerun:'9999' });
  ok(r.ok!==true&&/見つかりません/.test(r.failed)&&!r.ran.length,
     '★★★無い指定は止める（間違いに気づけるように）');
}

console.log('\n=== 知らせの文に「戻した分」を出す ===');
{
  const t=M.summaryText({ dry:true, pending:['a.sql'], marked:[],
    relist:['migrate-0047-mw-nt.sql','migrate-0048-mw-auto.sql'],
    rerun:[], todo:['a.sql'], judge:[{ file:'a.sql', state:'todo', why:'x' }],
    note:'確かめだけ' });
  console.log('   '+t.replace(/\n/g,' ⏎ '));
  ok(/控えでは済みだが作りが足りない 2本/.test(t),
     '★★★「流したつもりで流れていなかった」件数を出す');
  ok(/migrate-0047-mw-nt\.sql/.test(t)&&/migrate-0048-mw-auto\.sql/.test(t),
     '★★★ファイル名も出す');
  const t2=M.summaryText({ dry:false, pending:[], marked:[], relist:[],
    rerun:['migrate-0048-mw-auto.sql'], ran:['migrate-0048-mw-auto.sql'],
    judge:[], note:'流した 1本' });
  ok(/流し直す指定 1本/.test(t2),'★★流し直した分も出す');
}

try{ fs.rmSync(TMP,{ recursive:true, force:true }); }catch(e){}
await T.done();
