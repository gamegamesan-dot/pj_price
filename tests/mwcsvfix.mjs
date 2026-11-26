/* Worker：MW の在庫CSV の取り込みが止まった件の直し（8.103・v351）

   カジの報告（2026-11-26）
   ・仕入れタブに「前回の取り込み 11-25 02:08（自動）41時間前」。1時間ごとの確認は
     動いているのに取り込まれていない
   ・手動の取り込みも 31便目で「D1 DB is overloaded. Too many resources consumed
     within a 10 second window」で落ちた（12,462行）
   直し
   ① 中身が同じ行の seen_at を1行ずつではなく **id で 90行ずつ**まとめて直す
   ② D1 が混み合ったら待ってやり直す（batch は1トランザクションなので安全）
   ③ 自動取り込みは15分ごとの回に移す・便と便のあいだをあける
   ④ 途中で切られた回（取り込み中の印が古いまま）は失敗として数えて知らせ、すぐ取り直す
   ⑤ Actions の「いますぐ取り込む」（mwcsv.kick）は止めた印・間隔を見ずに取り込む
   ⑥ 取り込みが6時間止まったら運営用の Discord に（6時間に1回・mwdrop.mjs） */
import { harness, loadWorker, makeEnv, asJson, post } from './lib.mjs';
const T=harness('Worker：MW の在庫CSV の取り込みの直し（8.103）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwcsvfix');

/* ---- Shift_JIS に符号化する（逆引きの表を1回だけ作る）---- */
const SJ=(()=>{
  const m=new Map(), d=new TextDecoder('shift_jis',{fatal:true});
  /* 改行（0x0D・0x0A）も入れる。入れ忘れると全部が1行になる。 */
  for(let b=0;b<0x80;b++)m.set(String.fromCharCode(b),[b]);
  for(let hi=0x81;hi<=0xFC;hi++)for(let lo=0x40;lo<=0xFC;lo++){
    if(lo===0x7F)continue;
    try{ const c=d.decode(new Uint8Array([hi,lo]));
      if(c.length===1&&!m.has(c))m.set(c,[hi,lo]); }catch(e){}
  }
  return m;
})();
function sjis(text){
  const out=[];
  for(const c of String(text)){
    const b=SJ.get(c);
    if(b)out.push(...b); else out.push(0x3F);     // 表に無い文字は ?
  }
  return new Uint8Array(out);
}
const HEAD_LINE='JAN,社,機種,商品名,定価,発売日,新・中,卸値,掲載数,備考,出荷日';
/* 在庫CSVを作る。pad で1行を太らせて、本物（1.75MB）に近い大きさにする。
   「小さすぎるファイルは取り込まない」の歯止め（200KB）に引っかからないよう、
   行数が少ない回は pad を大きくして渡す。 */
function makeCsv(n,pad){
  const lines=[HEAD_LINE];
  const p=(pad===undefined)?60:pad;
  for(let i=0;i<n;i++){
    const jan='49023705'+String(10000+i).slice(-5);
    const name='商品の名前'+i+'　'.repeat(p);
    lines.push(['"'+jan+'"','"いろは商会"','"NS2"','"'+name+'"','"7678"',
      '"2025-01-01"','"新品"','"'+(3000+i)+'"','"9"','""','"即日"'].join(','));
  }
  return sjis(lines.join('\r\n')+'\r\n');
}

/* ---- 外向きの通信の差し替え ---- */
let calls=[], srv={};
function reset(s){
  calls=[];
  srv=Object.assign({ etag:'"v1"', mod:'Tue, 04 Nov 2026 01:00:00 GMT',
    status:200, headStatus:200, body:makeCsv(2000), headNo:false,
    ct:'text/csv' },s||{});
}
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  calls.push({ url, method:String(o.method||'GET').toUpperCase(),
    headers:Object.assign({},o.headers||{}) });
  if(/discord/.test(url))return new Response(null,{status:204});
  const h=new Headers();
  if(srv.etag)h.set('etag',srv.etag);
  if(srv.mod)h.set('last-modified',srv.mod);
  h.set('content-type',srv.ct);
  if(String(o.method||'GET').toUpperCase()==='HEAD'){
    if(srv.headNo)return new Response('',{status:405});
    h.set('content-length',String(srv.body.length));
    return new Response(null,{status:srv.headStatus,headers:h});
  }
  /* 条件付き GET。送られてきた If-None-Match が今の ETag と同じなら 304。 */
  const inm=(o.headers||{})['If-None-Match']||'';
  if(srv.status===200&&inm&&srv.etag&&inm===srv.etag&&srv.c304!==false)
    return new Response(null,{status:304,headers:h});
  if(srv.status!==200)return new Response('だめ',{status:srv.status,headers:h});
  h.set('content-length',String(srv.body.length));
  return new Response(srv.body,{status:200,headers:h});
};
const URL_OK='https://matchingworld.asia/stocks.csv';
/* ⚙の設定を D1 に直に入れる（画面から POST /settings するのと同じ置き場）。 */
async function cfg(env,o){
  await env.DB.prepare(
    `INSERT INTO sync_state (k,v,updated_at) VALUES (?1,?2,?3)
     ON CONFLICT(k) DO UPDATE SET v=excluded.v`)
    .bind('ui.settings', JSON.stringify({ at:new Date().toISOString(),
      settings:Object.assign({ mwCsvAuto:'on', mwCsvUrl:URL_OK },o||{}) }),
      new Date().toISOString()).run();
}
const state=(env,k)=>env.DB.prepare('SELECT v FROM sync_state WHERE k=?1')
  .bind(k).first().then((r)=>r?r.v:'');
const setState=(env,k,v)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES (?1,?2,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v`).bind(k,String(v)).run();
const gets=(m)=>calls.filter((c)=>c.method===m&&/stocks\.csv/.test(c.url));
const disc=()=>calls.filter((c)=>/discord/.test(c.url));


/* D1 の batch を数える・混み合いを起こす。 */
function spy(env){
  const db=env.DB, b0=db.batch.bind(db);
  const o={ calls:0, stmts:0, busy:0 };
  db.batch=async(l)=>{
    o.calls++; o.stmts+=l.length;
    if(o.busy>0){ o.busy--; throw new Error('D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window.'); }
    return b0(l);
  };
  return o;
}
const row=(jan,o)=>Object.assign({ jan:jan, sha:'いろは商会', idx:0, kishu:'NS2', name:'商品 '+jan,
  list_price:7678, release:'2025-01-01', cond:'新品', wholesale:3000, stock:9, note:'',
  ship_text:'即日', ship_days:0 },o||{});
const NOW=new Date().toISOString();

console.log('=== ① 中身が同じ行の seen_at はまとめて直す ===');
{
  const env=makeEnv();
  const rows=[]; for(let i=0;i<400;i++)rows.push(row('49023705'+String(10000+i).slice(-5)));
  let r=await asJson(await worker.fetch(post('/mw/stock',{ at:'2026-11-26T00:00:00Z', part:1, parts:1, rows:rows }),env,{}));
  ok(r.body.added===400,'★はじめは 400行を足す');
  const sp=spy(env);
  r=await asJson(await worker.fetch(post('/mw/stock',{ at:'2026-11-26T01:00:00Z', part:1, parts:2, rows:rows }),env,{}));
  console.log('   同じ 400行 → batch '+sp.calls+'回・文 '+sp.stmts);
  ok(r.body.same===400&&sp.stmts<=10,'★★★中身が同じ 400行は、1行ずつ（400文）ではなく 90行ずつ（5文）で直す');
  const n=env.DB._db.prepare("SELECT COUNT(*) AS n FROM mw_stock WHERE seen_at='2026-11-26T01:00:00Z'").get().n;
  ok(n===400,'★★★400行ぜんぶの seen_at が新しくなる（欠品の判定はいままでどおり）');
  /* 変わった行はいままでどおり1行ずつ書く。 */
  const rows2=rows.map((x,i)=>i<3?row(x.jan,{ stock:2 }):x);
  r=await asJson(await worker.fetch(post('/mw/stock',{ at:'2026-11-26T02:00:00Z', part:1, parts:2, rows:rows2 }),env,{}));
  ok(r.body.changed===3&&r.body.same===397,'★★変わった行は数えて書く');
  const s3=env.DB._db.prepare("SELECT stock FROM mw_stock WHERE jan=?").get(rows[0].jan).stock;
  ok(s3===2,'★★変わった中身（在庫数）が入る');
}

console.log('\n=== ①′ JAN ごとの代表は、変わる行だけを書く ===');
{
  const env=makeEnv();
  const rows=[];
  for(let i=0;i<30;i++){
    const jan='49023707'+String(10000+i).slice(-5);
    rows.push(row(jan,{ sha:'A', wholesale:3000 }));
    rows.push(row(jan,{ sha:'B', wholesale:2000 }));     // 安いほう（B）が代表
  }
  let r=await asJson(await worker.fetch(post('/mw/stock',{ at:'2026-11-26T00:00:00Z', part:1, parts:1, rows:rows }),env,{}));
  const pk=env.DB._db.prepare("SELECT jan, sha FROM mw_stock WHERE pick=1 ORDER BY jan").all();
  ok(r.body.picked===30&&pk.length===30&&pk.every((x)=>x.sha==='B'),'★★★JAN ごとに1つ（安いほう）を代表にする（数も返す）');
  const run0=env.DB._db.prepare("SELECT at, picked FROM mw_runs ORDER BY id DESC LIMIT 1").get();
  ok(run0&&run0.at==='2026-11-26T00:00:00Z'&&run0.picked===30,'★★取り込みの記録（mw_runs）が入る');
  /* 同じ中身でもう一度。代表は変わらないので、pick を書く行は 0。 */
  let changes=-1;
  const pr0=env.DB.prepare.bind(env.DB);
  env.DB.prepare=(sql)=>{ const st=pr0(sql);
    if(/UPDATE mw_stock\s+SET pick =/.test(sql)){ const r0=st.run.bind(st);
      st.run=async()=>{ const x=await r0(); changes=Number(x.meta.changes); return x; }; }
    return st; };
  r=await asJson(await worker.fetch(post('/mw/stock',{ at:'2026-11-26T01:00:00Z', part:1, parts:1, rows:rows }),env,{}));
  env.DB.prepare=pr0;
  console.log('   2回目の pick の書き込み '+changes+'行（v350 までは 30＋30行）');
  ok(changes===0&&r.body.picked===30,'★★★代表が変わらなければ pick は1行も書かない（v350 までは毎回 全部を2回）');
  /* A のほうが安くなったら、変わる2行だけ書く。 */
  const rows2=rows.map((x,i)=>i===0?row(x.jan,{ sha:'A', wholesale:1000 }):x);
  changes=-1;
  env.DB.prepare=(sql)=>{ const st=pr0(sql);
    if(/UPDATE mw_stock\s+SET pick =/.test(sql)){ const r0=st.run.bind(st);
      st.run=async()=>{ const x=await r0(); changes=Number(x.meta.changes); return x; }; }
    return st; };
  r=await asJson(await worker.fetch(post('/mw/stock',{ at:'2026-11-26T02:00:00Z', part:1, parts:1, rows:rows2 }),env,{}));
  env.DB.prepare=pr0;
  const p0=env.DB._db.prepare("SELECT sha FROM mw_stock WHERE pick=1 AND jan=?").get(rows[0].jan);
  ok(changes===2&&p0.sha==='A'&&r.body.picked===30,'★★代表が入れ替わったら、その2行だけ書く');
}

console.log('\n=== ② D1 が混み合ったら待ってやり直す ===');
{
  const env=makeEnv();
  const rows=[]; for(let i=0;i<50;i++)rows.push(row('49023706'+String(10000+i).slice(-5)));
  const sp=spy(env); sp.busy=1;
  const t0=Date.now();
  const r=await asJson(await worker.fetch(post('/mw/stock',{ at:'2026-11-26T00:00:00Z', part:1, parts:2, rows:rows }),env,{}));
  console.log('   '+(Date.now()-t0)+'ms '+JSON.stringify({ added:r.body.added, error:r.body.error||'' }));
  ok(!r.body.error&&r.body.added===50,'★★★「D1 DB is overloaded」は待ってやり直し、取り込みを止めない');
  ok(env.DB._db.prepare('SELECT COUNT(*) AS n FROM mw_stock').get().n===50,'★★★やり直しても行が二重にならない（batch は1トランザクション）');
  ok(W.d1Busy(new Error('D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window.'))
     &&!W.d1Busy(new Error('D1_ERROR: no such column: x')),'★混み合いのエラーだけをやり直す（ほかのエラーはすぐ返す）');
  const sp2=spy(env); sp2.busy=9;
  const r2=await asJson(await worker.fetch(post('/mw/stock',{ at:'2026-11-26T01:00:00Z', part:1, parts:2, rows:rows }),env,{}));
  ok(!!r2.body.error&&/overloaded/.test(r2.body.error),'★混み合いが続いたら（4回まで待って）理由を返す');
}

console.log('\n=== ④ 途中で切られた回を見つけて、すぐ取り直す ===');
{
  reset(); const env=makeEnv(); await cfg(env);
  /* 50分前に始めた回の印が残っている（Cron の時間切れで切られた）。 */
  await setState(env,'mwcsv.running',new Date(Date.now()-50*60000).toISOString());
  await setState(env,'mwcsv.body_at',new Date(Date.now()-50*60000).toISOString());
  await setState(env,'mwcsv.etag','"v0"');
  const d=await W.jobMwCsv(env,{ src:'auto' });
  console.log('   '+JSON.stringify({ ok:d.ok, fail:d.fail, why:String(d.why||'').slice(0,40), rows:d.rows_in }));
  ok(d.fail===1&&!!d.cut_before,'★★★途中で切られた回は失敗として数える（黙って続けない）');
  ok(disc().length>=1,'★★★知らせる');
  ok(gets('GET').length===1&&d.rows_in===2000&&d.ok,'★★★3時間待たずに、その回で本体を取り直して取り込む');
  ok(await state(env,'mwcsv.running')==='','★★取り込み終わりに印を消す');
}
{
  reset(); const env=makeEnv(); await cfg(env);
  /* 5分前に始めた回（いま取り込み中）なら、二重に始めない。 */
  await setState(env,'mwcsv.running',new Date(Date.now()-5*60000).toISOString());
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(/取り込み中の回があります/.test(d.why)&&gets('GET').length===0,'★★取り込み中の回があるときは始めない');
}

console.log('\n=== ⑤ いますぐ取り込む（Actions の kick）===');
{
  reset(); const env=makeEnv(); await cfg(env);
  await setState(env,'mwcsv.auto_off','2026-11-25 止めた');
  await setState(env,'mwcsv.checked_at',new Date(Date.now()-5*60000).toISOString());
  await setState(env,'mwcsv.body_at',new Date(Date.now()-10*60000).toISOString());
  const d0=await W.jobMwCsv(env,{ src:'auto' });
  ok(d0.ran===false&&gets('GET').length===0,'★止めた印があれば、ふだんの回は取りに行かない');
  const d=await W.jobMwCsv(env,{ src:'auto', kick:true });
  console.log('   '+JSON.stringify({ ok:d.ok, rows:d.rows_in, parts:d.parts }));
  ok(d.ok&&d.rows_in===2000&&gets('GET').length===1,'★★★kick は止めた印・間隔を見ずに本体を取って取り込む');
  ok(await state(env,'mwcsv.auto_off')==='','★★取り込めたら止めた印を外す（自動に戻る）');
  /* 15分ごとの回で kick を拾う。 */
  reset(); const env2=makeEnv(); await cfg(env2);
  await setState(env2,'mwcsv.kick',NOW);
  await setState(env2,'mwcsv.checked_at',new Date(Date.now()-5*60000).toISOString());
  const waits=[];
  await worker.scheduled({ cron:'*/15 * * * *' },env2,{ waitUntil:(p)=>waits.push(p) });
  await Promise.allSettled(waits);
  ok(gets('GET').length===1&&await state(env2,'mwcsv.kick')==='','★★★15分ごとの回で kick を拾って取り込み、印を消す');
  const n=env2.DB._db.prepare('SELECT COUNT(*) AS n FROM mw_stock').get().n;
  ok(n===2000,'★★2,000行が入る');
}

console.log('\n=== ④′ 取り込めたことを先に控え、付け足し（知らせなど）はあと（8.104）===');
{
  reset(); const env=makeEnv(); await cfg(env);
  /* 付け足しの知らせ（Discord）が返ってこない（止まる）ようにする。 */
  const f0=globalThis.fetch;
  globalThis.fetch=async(u,i)=>{ if(/discord/.test(String(u)))return new Promise(()=>{}); return f0(u,i); };
  W.jobMwCsv(env,{ src:'auto', kick:true });      // 待たない（付け足しで止まる）
  let done=false;
  for(let k=0;k<120&&!done;k++){
    await new Promise((r)=>setTimeout(r,500));
    done=(await state(env,'mwcsv.etag'))==='"v1"'&&(await state(env,'mwcsv.running'))==='';
  }
  globalThis.fetch=f0;
  const lg=env.DB._db.prepare('SELECT took, rows_in, ok FROM mw_csv_runs ORDER BY id DESC LIMIT 1').get();
  const mr=env.DB._db.prepare('SELECT rows_in FROM mw_runs ORDER BY id DESC LIMIT 1').get();
  console.log('   '+JSON.stringify({ done, lg, mr }));
  ok(done&&lg&&lg.took===1&&lg.ok===1&&lg.rows_in===2000&&mr&&mr.rows_in===2000,
     '★★★付け足し（知らせ）で止まっても、取り込み・記録・ETag・印の片付けは済んでいる（2026-11-26 12:31 の回の形）');
}

console.log('\n=== ③ 15分ごとの回（毎時の回では取り込まない）===');
{
  reset(); const env=makeEnv(); await cfg(env);
  const waits=[];
  await worker.scheduled({ cron:'*/15 * * * *' },env,{ waitUntil:(p)=>waits.push(p) });
  await Promise.allSettled(waits);
  ok(gets('HEAD').length===1,'★★★15分ごとの回で確かめる（間隔は jobMwCsv が守る）');
  reset();
  const w2=[];
  await worker.scheduled({ cron:'*/15 * * * *' },env,{ waitUntil:(p)=>w2.push(p) });
  await Promise.allSettled(w2);
  ok(gets('HEAD').length===0,'★★1時間たつまでは確かめ直さない（MW への当たりは今までどおり1時間に1回）');
  ok(W.MW_CSV_GAP_MS>=1000&&W.MW_SEEN_IDS===90,'★便と便のあいだ（1.5秒）・まとめる行数（90）');
}

console.log('\n=== Actions の道具（proxy-sync/d1-diag.mjs）===');
{
  const DG=await import('../proxy-sync/d1-diag.mjs');
  const env=makeEnv();
  const qs=[DG.Q_RUNS,DG.Q_STATE,DG.Q_IMPORTS,DG.Q_JOBS,DG.Q_LEFT,DG.Q_MATCH,DG.Q_X];
  let good=0;
  for(const q of qs){ try{ env.DB._db.prepare(q).all(); good++; }catch(e){ console.log('   '+e.message); } }
  ok(good===qs.length,'★★記録を読む問い合わせが D1 の作りに合っている');
  ok(qs.every((q)=>/^SELECT /.test(q)&&!/\b(UPDATE|DELETE|INSERT)\b|\bDROP\s+TABLE/i.test(q)),'★★★記録を見るのは読むだけ（書き込まない）');
  ok(!/name|title|url/i.test(DG.Q_RUNS+DG.Q_IMPORTS+DG.Q_LEFT),'★★★商品名・URL は引かない（公開のログに出さない）');
  ok(DG.clean('取れませんでした https://matchingworld.asia/stocks.csv 404')==='取れませんでした （URL） 404','★★URL は伏せて出す');
  /* 欠品なのに eBay で在庫ありの無在庫の出品を数える。 */
  env.DB._db.prepare(`INSERT INTO items (asin,cond,scope,ebay_item_id,ebay_sku,ebay_qty,updated_at)
    VALUES ('W4902370550001','new','ebay','111','W-4902370550001',1,'x'),
           ('W4902370550002','new','ebay','222','W-4902370550002',1,'x')`).run();
  env.DB._db.prepare(`INSERT INTO mw_stock (jan,sha,idx,row_hash,seen_at,created_at,gone_at,stock,pick)
    VALUES ('4902370550001','A',0,'h','x','x','2026-11-25',5,0),('4902370550002','A',0,'h','x','x',NULL,5,1)`).run();
  ok(env.DB._db.prepare(DG.Q_LEFT).get().n===1,'★★欠品なのに eBay で在庫ありの無在庫の出品を数えられる');
  /* 8.105 商品違いの疑いを数える（画面と同じ見立て・件数だけ・例に卸値は入れない）。 */
  env.DB._db.prepare(`INSERT INTO mw_stock (jan,sha,idx,name,list_price,wholesale,row_hash,seen_at,created_at,stock,pick)
    VALUES ('4902370550011','A',0,'EG ULTRAMAN（ULTRAMAN: RISING）',1500,1020,'h','x','x',5,1),
           ('4902370550012','A',0,'クリスタルコット2',500,350,'h','x','x',5,1),
           ('4902370550013','A',0,'刀剣乱舞 ちゅんコレ',8000,6000,'h','x','x',5,1)`).run();
  env.DB._db.prepare(`INSERT INTO mw_amz (jan,asin,name,price,checked_at,created_at) VALUES
    ('4902370550011','B09VGGZCKM','BANDAI SPIRITS スター・ウォーズ マンダロリアン',5000,'x','x'),
    ('4902370550012','B0QTY00001','クリスタルコット2 10個',4000,'x','x'),
    ('4902370550013','B0BOX00001','刀剣乱舞 ちゅんコレ BOX',11570,'x','x')`).run();
  const mrows=env.DB._db.prepare(DG.Q_MATCH).all();
  const mc=DG.matchCount(mrows,'');
  console.log('   '+JSON.stringify({ rows:mc.rows, bad:mc.bad, name_price:mc.name_price, qty:mc.qty, words:mc.qtyWords }));
  ok(mc.rows===3&&mc.bad===2&&mc.name_price===1&&mc.qty===1&&mc.qtyWords['N個']===1,
     '★★★Actions で、刈取と同じ行に同じ見立てで数える（理由ごと・入り数の言葉ごと）');
  ok(mc.examples.length===1&&!('wholesale' in mc.examples[0])&&mc.examples[0].list===500&&mc.examples[0].price===4000,
     '★★入り数違いの例は MW 名・Amazon 名・定価・売値だけ（卸値は入れない）');
  ok(!/name/i.test(DG.Q_X),'★設定（倍率）を読む問い合わせ');
  const k=DG.kickSql('2026-11-26T10:00:00Z');
  env.DB._db.exec(k);
  ok(await state(env,'mwcsv.kick')==='2026-11-26T10:00:00Z','★★「いますぐ取り込む」の印を置ける');
}

T.done();
