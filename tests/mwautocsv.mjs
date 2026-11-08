/* Worker：MW の在庫CSVを pj-sync が自分で取り込む（7.120・【P】）

   ・読み方は画面と**同じ** shared/mwcsv.js（行数・出荷日数がずれない）
   ・Shift_JIS を読めること（workerd でも `TextDecoder('shift_jis')` が
     使えることは実機で確かめてある。ここでは node の同じ API で見る）
   ・MW への当たりを抑える
       ① 既定は1時間に1回、**HEAD** で変わったかだけを見る（本体は取らない）
       ② 変わっていなければ本体を取らない
       ③ 本体を取るのは多くても3時間に1回（⚙で変更可）
       ④ 名乗る（メールアドレスは入れない）
       ⑤ 既定はオフ
   ・失敗に強い：404・HTML（ログイン画面）・小さすぎる・行が少なすぎるときは
     取り込まずに知らせる。3回続けて失敗したら自動を止める
   ・差分・欠品・3割の歯止め・段取りD の数量0 は手動とまったく同じ口
     （mwStockPut）を通る */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：MW の在庫CSVの自動取り込み');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwcsv');

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

console.log('=== 読み方は画面と同じ・Shift_JIS が読める ===');
ok(typeof W.MWCSV.parse==='function'&&typeof W.MWCSV.decode==='function',
   '★★★Worker も shared/mwcsv.js を読んでいる（画面と同じ式）');
ok(W.MWCSV.sjisOk()!=='','★★★Shift_JIS を読める（TextDecoder が受け付ける）');
ok(W.MWCSV.SJIS_LABELS.indexOf('cp932')<0,
   '★cp932 は使わない（workerd が受け付けない名前）');
{
  const d=W.MWCSV.decode(makeCsv(3,0));
  ok(d.enc==='shift_jis'&&!d.garbled,'★★★Shift_JIS のバイト列を文字にできる');
  const p=W.MWCSV.parse(d.text);
  ok(p.rows.length===3&&p.rows[0].name.indexOf('商品の名前0')===0,
     '★★★商品名（漢字）も読める');
  ok(p.rows[0].ship_days===0&&p.rows[0].cond==='新品',
     '★★出荷日「即日」=0・新品も読める');
  /* UTF-8 として読むと化ける。化けていたら取り込まない。 */
  ok(W.MWCSV.garbled(new TextDecoder('utf-8').decode(makeCsv(3,0))),
     '★★★Shift_JIS を UTF-8 で読むと「化けている」と分かる');
}

console.log('\n=== 既定はオフ（カジがオンにしてから動く）===');
{
  reset(); const env=makeEnv();
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(d.ran===false&&/オフ/.test(d.why),'★★★設定がなければ動かない（既定オフ）');
  ok(gets('HEAD').length===0&&gets('GET').length===0,
     '★★★MW にはまったく当たらない');
  ok(W.mwCsvCfg({}).on===false,'★★mwCsvCfg の既定もオフ');
  ok(W.mwCsvCfg({}).everyH===1&&W.mwCsvCfg({}).bodyH===3,
     '★★既定は「1時間に1回確かめる・本体は3時間に1回」');
}

console.log('\n=== 取得先の URL は⚙に置く（コードに直書きしない）===');
{
  reset(); const env=makeEnv();
  await cfg(env,{ mwCsvUrl:'' });
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(/URL を⚙に入れて/.test(d.why),'★★★URL が無ければ取りに行かない');
  ok(gets('HEAD').length===0,'★MW には当たらない');
}
{
  /* ⚙に別のアドレスを入れても、読み取りの見張り（ALLOWED）が止める。 */
  ok((()=>{ try{ W.assertReadOnly('https://matchingworld.asia/buy/?q=1','GET',{},false);
    return false; }catch(e){ return /blocked_by_readonly_guard/.test(e.message); } })(),
     '★★★会員サイトのページは取りに行けない（ALLOWED に無い）');
  ok((()=>{ try{ W.assertReadOnly('https://example.com/stocks.csv','GET',{},false);
    return false; }catch(e){ return true; } })(),
     '★★★ほかのサイトの stocks.csv も取りに行けない');
  ok((()=>{ try{ W.assertReadOnly(URL_OK,'GET',{},false); return true; }
    catch(e){ return false; } })(),'★★MW の stocks.csv は GET できる');
  ok((()=>{ try{ W.assertReadOnly(URL_OK,'HEAD',{},false); return true; }
    catch(e){ return false; } })(),'★★HEAD（変わったかを見るだけ）もできる');
  ok((()=>{ try{ W.assertReadOnly(URL_OK,'POST',{},true); return false; }
    catch(e){ return true; } })(),'★★★書き込み（POST）はできない');
}

console.log('\n=== ① まず HEAD で「変わったか」だけを見る ===');
{
  reset(); const env=makeEnv();
  await cfg(env);
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(d.ok===true&&d.took===true,'★★初回は本体を取る');
  ok(gets('HEAD').length===1,'★★★先に HEAD を1回だけ投げる');
  const ua=gets('HEAD')[0].headers['User-Agent']||'';
  ok(ua===W.MW_CSV_UA&&/pj-sync/.test(ua),'★★★名乗って取りに行く');
  ok(!/@/.test(ua),'★★★User-Agent にメールアドレスを入れない');
  ok(d.rows_in===2000&&d.added===2000,'★★★2000行を取り込んだ');
  const n=await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM mw_stock WHERE gone_at IS NULL').first();
  ok(+n.n===2000,'★★★mw_stock に入っている');
  const r=await env.DB.prepare(
    'SELECT src,rows_in FROM mw_runs ORDER BY id DESC LIMIT 1').first();
  ok(r&&r.src==='auto','★★★mw_runs に「自動」と残る');
  const pick=await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM mw_stock WHERE pick=1').first();
  ok(+pick.n===2000,'★JANごとの代表も選ばれる（手動と同じ口を通る）');
}

console.log('\n=== ② 変わっていなければ本体を取らない ===');
{
  reset(); const env=makeEnv();
  await cfg(env);
  await W.jobMwCsv(env,{ src:'auto' });        // 1回目（控えを作る）
  await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
  await setState(env,'mwcsv.body_at','2000-01-01T00:00:00Z');
  calls=[];
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(d.changed===false&&d.took===false,'★★★変わっていないと分かる');
  ok(/変わっていません/.test(d.why),'★★そう書く');
  ok(gets('HEAD').length===1,'★★HEAD は投げる（1回だけ）');
  ok(gets('GET').length===0,'★★★本体（GET）はまったく取らない');
  ok(d.rows_in===0,'★取り込まない');
}
{
  /* ETag が変わったら取りに行く。 */
  reset(); const env=makeEnv();
  await cfg(env);
  await W.jobMwCsv(env,{ src:'auto' });
  await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
  await setState(env,'mwcsv.body_at','2000-01-01T00:00:00Z');
  srv.etag='"v2"'; srv.body=makeCsv(2001);
  calls=[];
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(d.changed===true&&d.took===true,'★★★ETag が変わったら本体を取る');
  ok(d.added===1&&d.same===2000,'★★★差分だけ書く（足した1行・同じ2000行）');
}
{
  /* ETag が無いサイトでも、Last-Modified と大きさ・中身で見分ける。 */
  reset({ etag:'', c304:false }); const env=makeEnv();
  await cfg(env);
  await W.jobMwCsv(env,{ src:'auto' });
  await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
  await setState(env,'mwcsv.body_at','2000-01-01T00:00:00Z');
  calls=[];
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(d.took===false&&/変わっていません/.test(d.why),
     '★★★ETag が無くても Last-Modified で見分ける（本体を取らない）');
}
{
  /* 手がかりが何も無いサイト。本体を取っても、中身が同じなら取り込まない。 */
  reset({ etag:'', mod:'', c304:false }); const env=makeEnv();
  await cfg(env);
  await W.jobMwCsv(env,{ src:'auto' });
  await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
  await setState(env,'mwcsv.body_at','2000-01-01T00:00:00Z');
  calls=[];
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(d.took===false&&/変わっていません/.test(d.why),
     '★★大きさが同じなら本体を取らない');
  await setState(env,'mwcsv.bytes','1');        // 大きさの控えだけ違わせる
  await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
  await setState(env,'mwcsv.body_at','2000-01-01T00:00:00Z');
  calls=[];
  const d2=await W.jobMwCsv(env,{ src:'auto' });
  ok(d2.took===true&&/中身が前回と同じ/.test(d2.why),
     '★★★本体を取っても、中身のハッシュが同じなら取り込まない');
  ok(d2.added===0,'★書き込まない');
}
{
  reset(); const env=makeEnv();
  await cfg(env);
  /* 条件付き GET が 304 を返す場合（HEAD が使えないサイト）。 */
  await setState(env,'mwcsv.etag','"v1"');
  srv.headNo=true;
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(/304/.test(d.why)&&d.took===false,
     '★★★HEAD が使えないサイトでも、条件付き GET の 304 で分かる');
}

console.log('\n=== ③ 本体を取るのは多くても3時間に1回 ===');
{
  reset(); const env=makeEnv();
  await cfg(env);
  await W.jobMwCsv(env,{ src:'auto' });             // 本体を取った
  await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
  srv.etag='"v2"'; srv.body=makeCsv(2001);
  calls=[];
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(d.changed===true&&d.took===false,
     '★★★変わっていても、3時間たっていなければ本体を取らない');
  ok(/3時間に1回/.test(d.why),'★★そう書く');
  ok(gets('GET').length===0,'★★★本体は取らない');
  /* ⚙で間隔を変えられる。 */
  await cfg(env,{ mwCsvBodyH:'1' });
  await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
  await setState(env,'mwcsv.body_at',
    new Date(Date.now()-2*3600000).toISOString());
  calls=[];
  const d2=await W.jobMwCsv(env,{ src:'auto' });
  ok(d2.took===true,'★★★⚙で「1時間に1回」にすれば2時間後には取る');
}

console.log('\n=== 確かめる間隔（既定1時間）===');
{
  reset(); const env=makeEnv();
  await cfg(env);
  await W.jobMwCsv(env,{ src:'auto' });
  calls=[];
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(d.ran===false&&/まだ 1時間/.test(d.why),
     '★★★1時間たつまでは確かめもしない');
  ok(gets('HEAD').length===0,'★★★MW にまったく当たらない');
  /* 手で押したときは待たない。 */
  const d2=await W.jobMwCsv(env,{ src:'hand' });
  ok(d2.ran===true,'★★★⚙のボタン（手で押した）は間隔を待たない');
  ok(W.mwCsvNextAt('2026-11-08T00:00:00Z',1)==='2026-11-08T01:00:00.000Z',
     '★★次に確かめる時刻を出せる（画面に出す）');
}

console.log('\n=== 「すぐ止める」スイッチ ===');
{
  reset(); const env=makeEnv();
  await cfg(env,{ mwCsvStop:true });
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(d.ran===false&&/すぐ止める/.test(d.why),'★★★オンにすると動かない');
  ok(gets('HEAD').length===0,'★★★MW に当たらない');
  const d2=await W.jobMwCsv(env,{ src:'hand' });
  ok(d2.ran===false,'★★★⚙のボタンからも動かない');
}

console.log('\n=== 失敗に強く：取り込まずに知らせる ===');
const badCase=async(s,wantRe,label)=>{
  reset(s); const env=makeEnv();
  await cfg(env);
  await setState(env,'mwcsv.bytes','300000');      // 前回の大きさ
  const d=await W.jobMwCsv(env,{ src:'auto' });
  const n=await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM mw_stock').first();
  ok(d.ok!==true&&wantRe.test(String(d.why||'')),label+'（'+(d.why||'')+'）');
  ok(+n.n===0,'　└ 取り込まない');
  ok(disc().length===1,'　└ Discord に知らせる');
  return d;
};
await badCase({ status:404, etag:'' },/404/,
  '★★★404 のときは取り込まない');
await badCase({ body:sjis('<!doctype html><html><body>ログインしてください'),
  ct:'text/html', etag:'' },/HTML/,
  '★★★ログイン画面（HTML）が返ったら取り込まない');
await badCase({ body:makeCsv(5), etag:'' },/大きさ/,
  '★★★小さすぎるファイルでは取り込まない');
await badCase({ body:makeCsv(500), etag:'' },/半分未満|大きさ/,
  '★★★前回の半分未満の大きさでは取り込まない');
{
  /* 行数が少なすぎる（大きさはあるのに中身が足りない）。 */
  reset({ body:makeCsv(900,120), etag:'' }); const env=makeEnv();
  await cfg(env);
  await setState(env,'mwcsv.bytes','100');
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(d.ok!==true&&/読めた行が 900行/.test(String(d.why||'')),
     '★★★行数が少なすぎるときは取り込まない');
  const n=await env.DB.prepare('SELECT COUNT(*) AS n FROM mw_stock').first();
  ok(+n.n===0,'　└ 取り込まない');
}
{
  /* 在庫CSVではない CSV（列が足りない）。 */
  reset({ body:sjis(['あ,い,う'].concat(
    new Array(3000).fill('1,2,3,'+'x'.repeat(100))).join('\r\n')), etag:'' });
  const env=makeEnv();
  await cfg(env);
  await setState(env,'mwcsv.bytes','100');
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(/JAN・社・卸値の列が見つかりません/.test(String(d.why||'')),
     '★★★在庫CSVでなければ取り込まない');
}

console.log('\n=== 3回続けて失敗したら自動を止める ===');
{
  reset({ status:404, etag:'' }); const env=makeEnv();
  await cfg(env);
  for(let i=0;i<2;i++){
    await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
    const d=await W.jobMwCsv(env,{ src:'auto' });
    ok(d.auto_off!==true,'★'+(i+1)+'回目はまだ止めない');
  }
  await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
  const d3=await W.jobMwCsv(env,{ src:'auto' });
  ok(d3.auto_off===true,'★★★3回目で自動を止める');
  ok(await state(env,'mwcsv.auto_off')!=='','★★止めた印が残る');
  const last=disc()[disc().length-1];
  ok(!!last,'★★★止めたことを Discord に知らせる');
  /* 止まっているあいだは MW に当たらない。 */
  await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
  calls=[];
  const d4=await W.jobMwCsv(env,{ src:'auto' });
  ok(d4.ran===false&&d4.auto_off===true,'★★★止まっているあいだは動かない');
  ok(gets('HEAD').length===0,'★★★MW にまったく当たらない');
  /* ⚙の「もう一度動かす」で戻る。 */
  const r=await worker.fetch(post('/mw/csv/on',{}),env,{});
  ok((await asJson(r)).body.ok===true,'★★「もう一度動かす」が通る');
  ok(await state(env,'mwcsv.auto_off')==='','★★★止めた印が消える');
  srv.status=200; srv.etag='"v9"';
  await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
  const d5=await W.jobMwCsv(env,{ src:'auto' });
  ok(d5.ok===true&&d5.took===true,'★★★戻したら、また取りに行く');
}
{
  /* 取り込めたら失敗の数は0に戻る（たまたま1回失敗しても止まらない）。 */
  reset(); const env=makeEnv();
  await cfg(env);
  await setState(env,'mwcsv.fail','2');
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(d.ok===true&&await state(env,'mwcsv.fail')==='0',
     '★★★取り込めたら「続けて失敗」は0に戻る');
}

console.log('\n=== 3割の歯止め（手動とまったく同じ口）===');
{
  reset(); const env=makeEnv();
  await cfg(env);
  await W.jobMwCsv(env,{ src:'auto' });              // 2000行
  await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
  await setState(env,'mwcsv.body_at','2000-01-01T00:00:00Z');
  srv.etag='"v2"'; srv.body=makeCsv(1200);           // 4割減った
  const d=await W.jobMwCsv(env,{ src:'auto' });
  ok(d.ok===true&&/少ないため、欠品にしていません/.test(String(d.warn||'')),
     '★★★行が3割以上減ったら欠品にしない（取得ミスとみなす）');
  ok(d.gone===0,'★★★欠品にしていない');
  const alive=await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM mw_stock WHERE gone_at IS NULL').first();
  ok(+alive.n===2000,'★★★生きている行はそのまま（売り越しを作らない）');
  /* 少しだけ減ったときは、ちゃんと欠品にする。 */
  await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
  await setState(env,'mwcsv.body_at','2000-01-01T00:00:00Z');
  srv.etag='"v3"'; srv.body=makeCsv(1900);
  const d2=await W.jobMwCsv(env,{ src:'auto' });
  ok(d2.gone===100&&!d2.warn,'★★★1割減なら欠品にする（100行）');
}

console.log('\n=== 記録（⚙の「最近の取得」）===');
{
  reset(); const env=makeEnv();
  await cfg(env);
  await W.jobMwCsv(env,{ src:'auto' });
  await setState(env,'mwcsv.checked_at','2000-01-01T00:00:00Z');
  await setState(env,'mwcsv.body_at','2000-01-01T00:00:00Z');
  await W.jobMwCsv(env,{ src:'auto' });               // 変わっていない回
  const r=await worker.fetch(get('/mw/csv?limit=10'),env,{});
  const d=(await asJson(r)).body;
  ok(d.ok===true&&d.rows.length===2,'★★★取りに行った回が記録に残る');
  ok(d.rows[0].changed===0&&d.rows[0].took===0,
     '★★★「変わっていない」回も残る（取らなかったことが分かる）');
  ok(d.rows[1].took===1&&+d.rows[1].rows_in===2000&&+d.rows[1].added===2000,
     '★★★行数・足した・変わった・新しく欠品が残る');
  ok(+d.rows[1].elapsed_ms>=0&&d.rows[1].at_jst,
     '★★★かかった時間と日時（日本時間）も出せる');
  ok(d.on===true&&d.every_h===1&&d.body_h===3&&d.url_set===true,
     '★★いまの設定も返す');
  ok(!!d.next_at&&!!d.next_jst,'★★★次に取りに行く予定の時刻を返す');
  ok(d.ua===W.MW_CSV_UA&&!/@/.test(d.ua),'★★名乗る文字も返す（メールなし）');
  /* 「動かさなかった」だけの回は記録を増やさない（記録が流れないように）。 */
  await W.jobMwCsv(env,{ src:'auto' });               // 間隔を待っている回
  const d2=(await asJson(await worker.fetch(get('/mw/csv?limit=10'),env,{}))).body;
  ok(d2.rows.length===2,'★★「まだ1時間たっていない」回は記録に残さない');
}
{
  /* 一覧の「前回の取り込み」にも自動／手動と次の予定が出る。 */
  reset(); const env=makeEnv();
  await cfg(env);
  await W.jobMwCsv(env,{ src:'auto' });
  const d=(await asJson(await worker.fetch(get('/mw/list?limit=1'),env,{}))).body;
  ok(d.last&&d.last.src==='auto','★★★/mw/list が「自動」を返す');
  ok(d.csv&&d.csv.on===true&&!!d.csv.next_jst,
     '★★★/mw/list が次に取りに行く予定を返す');
}

console.log('\n=== 作業者の鍵では動かせない ===');
{
  reset(); const env=makeEnv({ STAFF_KEY:'staff-9' });
  await cfg(env);
  const H2={'X-PJ-Key':'staff-9','content-type':'application/json'};
  const r=await worker.fetch(new Request('https://x/mw/csv/run',
    { method:'POST', headers:H2, body:'{}' }),env,{});
  ok(r.status===403,'★★★作業者の鍵では取りに行かせない');
  const r2=await worker.fetch(new Request('https://x/mw/csv/on',
    { method:'POST', headers:H2, body:'{}' }),env,{});
  ok(r2.status===403,'★★「もう一度動かす」も管理者だけ');
  const r3=await worker.fetch(new Request('https://x/mw/csv?limit=5',
    { headers:H2 }),env,{});
  ok(r3.status===200,'★記録を見るのは作業者でもできる');
}

console.log('\n=== 中身の見張り（mwCsvBad）===');
ok(/空/.test(W.mwCsvBad(new Uint8Array(0),'',0)),'★空は止める');
ok(/HTML/.test(W.mwCsvBad(new Uint8Array(300000),
  '  <!DOCTYPE html><html>',0)),'★★先頭が HTML なら止める');
ok(/HTML/.test(W.mwCsvBad(new Uint8Array(300000),
  '<form action="/login">',0)),'★★ログインの form も止める');
ok(W.mwCsvBad(new Uint8Array(300000),'JAN,社,卸値\n...',0)==='',
  '★★ふつうの CSV は通す');
ok(/半分未満/.test(W.mwCsvBad(new Uint8Array(300000),'JAN,社',1000000)),
  '★★★前回の半分未満は止める');
ok(W.MW_CSV_MIN_RATIO===0.5&&W.MW_CSV_FAIL_STOP===3,
   '★決まりの数（半分・3回）');

await T.done();
