/* Worker：自動の取り直し（毎時37分）が動いているか（7.122・【R】）

   起きたこと：⚙はオンなのに、一覧の「前回の取得」が 2026-11-08 20:03 のまま
   11/09 11:50 まで動かなかった（手で押すと進む）。

   原因（4つ）
   ① 「前回の取得」は **mw_amz_runs（手で押した回）しか見ていなかった**
      → 自動の回がどれだけ動いてもこの時刻は動かない
   ② 自動の回の記録は **ぜんぶ通ったときだけ**残していた
      → 落ちた回・オフだった回は1行も残らず、動いたのかが分からない
   ③ 自動の回だけ**段ごとの持ち時間の割り当てが無かった**
      → ①ASIN に持ち時間ぜんぶを渡していた
   ④ 可否が**最後**だったので、緑になった行の値段を同じ回で取れず、
      しかも可否には時間が残っていなかった
   直したこと＋「2回続けて飛んだら Discord」＋⚙の記録 */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：自動の取り直しが動いているか（7.122）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwauto2');
W.SP_GAP.getItemOffersBatch=0;      // 本物は 0.1回/秒。テストでは待たせない
W.SP_GAP.getMyFeesEstimates=0;
W.SP_GAP.getListingsRestrictions=0;

let sent=[], calls=[];
/* ふだんの作り物。途中で差し替えたら必ず戻す（戻し忘れると、
   そのあとの塊が「ネットワークが切れた」まま動いて嘘の結果になる）。 */
const mainFetch=async(u,i)=>{
  const url=String(u), o=i||{};
  calls.push({ url, method:String(o.method||'GET') });
  if(/discord/.test(url)){
    sent.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response(null,{status:204});
  }
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  if(/catalog\/2022-04-01\/items/.test(url)){
    const ids=(new URL(url).searchParams.get('identifiers')||'').split(',');
    return new Response(JSON.stringify({ items:ids.map((j,k)=>({
      asin:'B0AUTO'+String(1000+k).slice(-4),
      identifiers:[{ identifiers:[{ identifier:j, identifierType:'EAN' }] }],
      salesRanks:[{ displayGroupRanks:[{ title:'ゲーム', rank:1200 }] }],
      summaries:[{ itemName:'カタログの名前' }] })) }),{status:200});
  }
  if(/listings\/2021-08-01\/restrictions/.test(url))
    return new Response(JSON.stringify({ restrictions:[] }),{status:200});
  if(/batches\/products\/pricing\/v0\/itemOffers/.test(url)){
    const reqs=(JSON.parse(String(o.body||'{}')).requests)||[];
    return new Response(JSON.stringify({ responses:reqs.map((q)=>{
      const a=(/\/items\/([A-Z0-9]{10})\/offers/.exec(String(q.uri||''))||[])[1]||'';
      return { request:q, status:{statusCode:200},
        body:{ payload:{ ASIN:a, ItemCondition:q.ItemCondition,
          Summary:{ TotalOfferCount:1 },
          Offers:[{ SubCondition:'new',
            ListingPrice:{ Amount:9000, CurrencyCode:'JPY' },
            Shipping:{ Amount:0, CurrencyCode:'JPY' } }] } } };
    }) }),{status:200});
  }
  /* 本物と同じ形（本文も応答も**配列**。7.104）。 */
  if(/products\/fees\/v0\/feesEstimate/.test(url)){
    const b=JSON.parse(String(o.body||'[]'));
    if(!Array.isArray(b))
      return new Response(JSON.stringify({ errors:[{ code:'InvalidInput',
        message:'This is an invalid request.' }] }),{status:400});
    return new Response(JSON.stringify(b.map((q)=>({
      FeesEstimateIdentifier:{ IdType:'ASIN', IdValue:q.IdValue },
      Status:'Success',
      FeesEstimate:{ TotalFeesEstimate:{ CurrencyCode:'JPY', Amount:1500 },
        FeeDetailList:[
          { FeeType:'ReferralFee', FinalFee:{ CurrencyCode:'JPY', Amount:975 } },
          { FeeType:'FBAFees', FinalFee:{ CurrencyCode:'JPY', Amount:425 } },
          { FeeType:'ReferralFeeTax', FinalFee:{ CurrencyCode:'JPY', Amount:100 } }
        ] } }))),{status:200});
  }
  return new Response('{}',{status:200});
};
globalThis.fetch=mainFetch;
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123',
  LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs', LWA_REFRESH_TOKEN:'rt',
  SP_SELLER_ID:'A1SELLER9999' });
const stock=(env,i)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,list_price,release,cond,
     wholesale,stock,note,ship_text,ship_days,row_hash,seen_at,created_at,pick)
   VALUES (?1,'いろは商会',0,'NS2',?2,20000,'','新品',3000,9,'','即日',0,'h',
           ?3,?3,1)`)
  .bind('49023705'+String(10000+i).slice(-5),'商品'+i,'2026-11-09T00:00:00Z').run();
const cfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES (?1,?2,?3)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v`)
  .bind('ui.settings', JSON.stringify({ at:new Date().toISOString(),
    settings:o||{} }), new Date().toISOString()).run();
const autoRow=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_auto_runs (at,kind,price_n,fee_n,rst_n,calls,left_n,note,
     asin_n,ms,stopped,err,mode,per_hour,fee_ng,fee_left,asin_left,created_at)
   VALUES (?1,?2,0,0,0,0,0,'',0,0,?3,?4,'on',100,0,0,0,?1)`)
  .bind(o.at, o.kind||'cron', o.stopped||null, o.err||null).run();

console.log('=== ③ 段ごとの持ち時間の割り当て ===');
{
  const sh=W.mwAutoShare(90000);
  console.log('   '+JSON.stringify(sh));
  ok(sh.asin+sh.rst+sh.price+sh.fee<=90000,
     '★★★4つの段を足しても持ち時間を超えない');
  ok(sh.asin>0&&sh.rst>0&&sh.price>0&&sh.fee>0,
     '★★★どの段にも持ち時間が割り当てられる（可否が0秒にならない）');
  ok(sh.price>sh.asin&&sh.price>sh.rst,
     '★★価格にいちばん長く割り当てる（10.5秒に1回しか呼べないため）');
  const p=W.mwAutoPlan(100,90000);
  ok(p.share_ms&&p.share_ms.price===sh.price,
     '★★見込み（plan）も同じ割り当てを返す');
  ok(p.price>0&&p.rst>0,'★★価格と可否の件数が0にならない');
  ok(W.MW_AUTO_CRON_MS>W.MW_AUTO_BUDGET_MS,
     '★★★Cron の回は画面から押すときより長く使える（待ち時間は CPU ではない）');
  /* 45秒（画面から押す回）でも可否に時間が残る。 */
  const s2=W.mwAutoShare(45000);
  ok(s2.rst>=4000,'★★45秒の回でも可否に数秒は残る');
}

console.log('\n=== ④ 段の順は手で押す回と同じ（ASIN→可否→価格→手数料）===');
{
  const env=env0();
  await cfg(env,{ mwAutoMode:'100' });
  for(let i=0;i<3;i++)await stock(env,i);
  calls=[];
  const d=await W.jobMwAuto(env,{ kind:'hand' });
  const seq=calls.map((c)=>
    /catalog/.test(c.url)?'asin'
    :(/restrictions/.test(c.url)?'rst'
      :(/itemOffers/.test(c.url)?'price'
        :(/feesEstimate/.test(c.url)?'fee':'')))).filter(Boolean);
  const first=(k)=>seq.indexOf(k);
  console.log('   '+seq.join(' → '));
  console.log('   '+JSON.stringify({ asin:d.asin_n, rst:d.rst_n,
    price:d.price_n, fee:d.fee_n, ms:d.ms, stopped:d.stopped }));
  ok(d.ok===true,'★動いた');
  ok(first('asin')>=0&&first('rst')>=0&&first('price')>=0&&first('fee')>=0,
     '★★★4つの段ぜんぶが動く（可否が飛ばされない）');
  ok(first('asin')<first('rst'),'★★ASIN が先');
  ok(first('rst')<first('price'),
     '★★★可否が価格より先（緑になった行の値段を同じ回で取れる）');
  ok(first('price')<first('fee'),'★★手数料は最後');
  ok(d.asin_n===3&&d.rst_n>0&&d.price_n===3&&d.fee_n>0,
     '★★★どの段も件数が進む');
}

console.log('\n=== ② どんな終わり方でも記録を1行残す ===');
{
  const env=env0();
  await cfg(env,{ mwAutoMode:'100' });
  for(let i=0;i<2;i++)await stock(env,i);
  await W.jobMwAuto(env,{ kind:'cron' });
  const d=(await asJson(await worker.fetch(get('/mw/auto?limit=10'),env,{}))).body;
  console.log('   '+JSON.stringify(d).slice(0,420));
  ok(d.ok===true&&d.rows.length===1,'★★★動いた回の記録が残る');
  const r=d.rows[0];
  ok(r.kind==='cron','★★★自動の回だと分かる');
  ok(+r.asin_n===2,'★★★ASIN引きの件数が残る（v244 では残していなかった）');
  ok(+r.rst_n>=0&&+r.price_n===2&&+r.fee_n>=0,
     '★★★可否・価格・手数料の件数も残る');
  ok(+r.ms>=0,'★★★かかった時間が残る');
  ok(r.mode==='on'&&+r.per_hour===100,'★★そのときの⚙の設定も残る');
  ok(r.at_jst,'★日時（日本時間）も出せる');
  ok(d.full===true,'★新しい列が揃っている');
}
{
  /* オフの回も残す（「動かさなかった」が分かるように）。 */
  const env=env0();
  await cfg(env,{ mwAutoMode:'off' });
  const r=await W.jobMwAuto(env,{ kind:'cron' });
  const d=(await asJson(await worker.fetch(get('/mw/auto?limit=10'),env,{}))).body;
  console.log('   '+JSON.stringify(d.rows[0]).slice(0,200));
  ok(r.mode==='off'&&r.stopped==='off','★★オフだと分かる');
  ok(d.rows.length===1&&d.rows[0].stopped==='off',
     '★★★オフだった回も記録に残す（v244 では1行も残らなかった）');
}
{
  /* 落ちた回も残す。 */
  const env=env0();
  await cfg(env,{ mwAutoMode:'100' });
  await stock(env,0);
  globalThis.fetch=async(u)=>{
    if(/discord/.test(String(u)))return new Response(null,{status:204});
    throw new Error('ネットワークが切れました');
  };
  const r=await W.jobMwAuto(env,{ kind:'cron' });
  globalThis.fetch=mainFetch;            // ★必ず戻す
  const d=(await asJson(await worker.fetch(get('/mw/auto?limit=10'),env,{}))).body;
  console.log('   '+JSON.stringify(d.rows[0]).slice(0,260));
  ok(r.ok!==true&&!!r.error,'★落ちた');
  ok(d.rows.length===1&&!!d.rows[0].err,
     '★★★落ちた回も記録に残し、理由（例外の文）も残す');
  ok(d.rows[0].stopped==='例外','★★「止まった理由」も入る');
}

console.log('\n=== 7.124：記録は絶対に落とさない ===');
{
  /* 走り始めに1行残し、終わったらその行を書き替える（増やさない）。 */
  const env=env0();
  await cfg(env,{ mwAutoMode:'100' });
  await stock(env,0);
  const id=await W.mwAutoStart(env,'cron');
  ok(id>0,'★★★走り始めに1行残す（id が返る）');
  let d=(await asJson(await worker.fetch(get('/mw/auto?limit=5'),env,{}))).body;
  ok(d.rows.length===1&&/走っています/.test(String(d.rows[0].note||'')),
     '★★★打ち切られても「走った」ことが記録に残る');
  await W.mwAutoLog(env,{ price_n:5, fee_n:6, rst_n:7, calls:8, left:9,
    note:'おわり', asin_n:10, ms:1234, stopped:'', error:'', mode:'on',
    per_hour:100, fee_ng:0, fee_left:0, asin_left:0 },'cron',id);
  d=(await asJson(await worker.fetch(get('/mw/auto?limit=5'),env,{}))).body;
  console.log('   '+JSON.stringify(d.rows).slice(0,200));
  ok(d.rows.length===1,'★★★終わったら同じ行を書き替える（2行にしない）');
  ok(+d.rows[0].price_n===5&&+d.rows[0].asin_n===10&&+d.rows[0].ms===1234,
     '★★★中身が入れ替わる');
  ok(!/走っています/.test(String(d.rows[0].note||'')),'★★「走っています」は消える');
}
{
  /* jobMwAuto も、走り始めの行を使い回す（記録は1本の回で1行）。 */
  const env=env0();
  await cfg(env,{ mwAutoMode:'100' });
  await stock(env,0);
  const r=await W.jobMwAuto(env,{ kind:'cron' });
  ok(r.log_id>0,'★★走り始めの行を使う');
  const d=(await asJson(await worker.fetch(get('/mw/auto?limit=9'),env,{}))).body;
  ok(d.rows.length===1,'★★★1回につき記録は1行');
  ok(+d.rows[0].asin_n===1&&+d.rows[0].ms>=0,'★中身が入る');
}
{
  /* 新しい列が無いデータベースでも、短い形で入れ直して必ず残す。
     （v245 は colOk がいつも「ある」と答えたせいで、長い形で落ちて
       1行も残らなかった。13:37 の記録が無かったのはこれ） */
  const env=env0();
  await cfg(env,{ mwAutoMode:'100' });
  await env.DB._db.exec('DROP TABLE mw_auto_runs');
  await env.DB._db.exec(`CREATE TABLE mw_auto_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, price_n INTEGER,
    fee_n INTEGER, rst_n INTEGER, calls INTEGER, left_n INTEGER, note TEXT,
    created_at TEXT)`);
  await W.mwAutoLog(env,{ price_n:3, fee_n:0, rst_n:0, calls:1, left:0,
    note:'短い形', asin_n:9, ms:50, stopped:'', error:'', mode:'on',
    per_hour:100, fee_ng:0, fee_left:0, asin_left:0 },'cron',0);
  const d=(await asJson(await worker.fetch(get('/mw/auto?limit=5'),env,{}))).body;
  console.log('   '+JSON.stringify(d).slice(0,220));
  ok(d.ok===true&&d.rows.length===1&&+d.rows[0].price_n===3,
     '★★★新しい列が無くても記録が残る（短い形で入れ直す）');
  ok(d.full===false,'★★★列が足りないことを画面に伝える');
  ok(d.rows[0].asin_n===undefined||d.rows[0].asin_n===null,
     '★古い形なので段ごとの件数は入らない');
}

console.log('\n=== ① 「前回の取得」が自動の回も数える ===');
{
  const env=env0();
  await cfg(env,{ mwAutoMode:'100' });
  await stock(env,0);
  /* 手で押した回を古い時刻で入れる（カジの 11/08 20:03 の状況）。 */
  await env.DB.prepare(
    `INSERT INTO mw_amz_runs (at,asked,done,asin_ok,asin_ng,priced,none,failed,
       left_n,calls_cat,calls_prc,note,created_at)
     VALUES (?1,1,1,1,0,1,0,0,0,1,1,'手で押した',?1)`)
    .bind('2026-11-08T11:03:00Z').run();
  let d=(await asJson(await worker.fetch(get('/mw/amz?limit=10'),env,{}))).body;
  ok(d.last&&d.last.src==='hand'&&String(d.last.at).indexOf('2026-11-08')===0,
     '★手で押した回だけのときは、その時刻を返す');
  /* そのあと自動の回が動いたら、**そちらが新しい**ので「前回の取得」も動く。 */
  await autoRow(env,{ at:'2026-11-09T02:37:00Z', kind:'cron' });
  d=(await asJson(await worker.fetch(get('/mw/amz?limit=10'),env,{}))).body;
  console.log('   '+JSON.stringify(d.last).slice(0,200));
  ok(d.last&&d.last.src==='auto',
     '★★★自動の回が新しければ、そちらを「前回の取得」にする（直った点）');
  ok(String(d.last.at).indexOf('2026-11-09')===0,'★★★時刻も自動の回のもの');
  /* 手で押した回がもっと新しければ、そちらに戻る。 */
  await env.DB.prepare(
    `INSERT INTO mw_amz_runs (at,asked,done,asin_ok,asin_ng,priced,none,failed,
       left_n,calls_cat,calls_prc,note,created_at)
     VALUES (?1,1,1,1,0,1,0,0,0,1,1,'手で押した',?1)`)
    .bind('2026-11-09T03:00:00Z').run();
  d=(await asJson(await worker.fetch(get('/mw/amz?limit=10'),env,{}))).body;
  ok(d.last&&d.last.src==='hand','★★★新しいほうを返す（手で押した回）');
}

console.log('\n=== 2回続けて飛んだら Discord ===');
{
  ok(W.mwAutoMissN('2026-11-09T01:00:00Z',
     new Date('2026-11-09T01:30:00Z').getTime())===0,
     '★★30分後はまだ飛んでいない');
  ok(W.mwAutoMissN('2026-11-09T01:00:00Z',
     new Date('2026-11-09T02:20:00Z').getTime())===1,
     '★★1時間すぎたら1回ぶん');
  ok(W.mwAutoMissN('2026-11-09T01:00:00Z',
     new Date('2026-11-09T03:20:00Z').getTime())===2,
     '★★★2時間すぎたら2回ぶん');
  ok(W.MW_AUTO_MISS_WARN===2,'★★2回で知らせる');
}
{
  const env=env0();
  await cfg(env,{ mwAutoMode:'100' });
  sent=[];
  /* 3時間前に動いたのが最後。 */
  await autoRow(env,{ at:new Date(Date.now()-3*3600000).toISOString() });
  const m=await W.mwAutoMiss(env,W.newRun('t'));
  console.log('   '+JSON.stringify(m)+' / '+sent.join(' ').slice(0,260));
  ok(m.miss>=2&&m.warned===true,'★★★2回ぶん飛んでいたら知らせる');
  ok(/自動の取り直しが動いていません/.test(sent.join('')),'★★★そう書く');
  ok(/最後に動いたのは/.test(sent.join('')),'★★最後に動いた時刻を書く');
  ok(/オン（1時間に 100件）/.test(sent.join('')),'★★⚙の設定も書く');
  ok(/自動の回の記録を見る/.test(sent.join('')),'★★どこを見ればよいか書く');
  /* 7.125：pj へのリンクと「長押し →Safari で開く」は**出さない**
     （Discord の中のブラウザはキーを持っていないので役に立たない）。 */
  ok(!/github\.io\/pj_price/.test(sent.join(''))
     &&!/長押し/.test(sent.join('')),
     '★★★pj へのリンクと「長押し →Safari で開く」は出さない（7.125）');
  /* 1日1回まで。 */
  sent=[];
  const m2=await W.mwAutoMiss(env,W.newRun('t'));
  ok(sent.length===0&&m2.miss>=2,'★★★同じことを毎時言わない（1日1回）');
}
{
  /* オフのときは言わない（止めてあるのだから当たり前）。 */
  const env=env0();
  await cfg(env,{ mwAutoMode:'off' });
  sent=[];
  await autoRow(env,{ at:new Date(Date.now()-5*3600000).toISOString() });
  const m=await W.mwAutoMiss(env,W.newRun('t'));
  ok(m.mode==='off'&&sent.length===0,'★★★オフのときは知らせない');
}
{
  /* ちゃんと動いていれば言わないし、印も消す。 */
  const env=env0();
  await cfg(env,{ mwAutoMode:'100' });
  sent=[];
  await autoRow(env,{ at:new Date(Date.now()-10*60000).toISOString() });
  const m=await W.mwAutoMiss(env,W.newRun('t'));
  ok(m.miss===0&&sent.length===0,'★★★さっき動いていれば知らせない');
}

console.log('\n=== ⚙に返すいまの様子 ===');
{
  const env=env0();
  await cfg(env,{ mwAutoMode:'100' });
  await autoRow(env,{ at:'2026-11-09T02:37:00Z' });
  const d=(await asJson(await worker.fetch(get('/mw/auto?limit=5'),env,{}))).body;
  console.log('   '+JSON.stringify({ mode:d.mode, per:d.per_hour,
    next:d.next_jst, last:d.last_cron_jst, miss:d.miss }));
  ok(d.mode==='on'&&d.per_hour===100,'★★いまの⚙の設定を返す');
  ok(d.last_cron_jst,'★★★最後に自動で動いた時刻を返す');
  ok(!!d.next_at&&d.cron_min===37,'★★★次の自動の回（毎時37分）を返す');
  ok(d.miss>=0&&d.miss_warn===2,'★飛んだ回数も返す');
  ok(d.plan&&+d.plan.price>0,'★1回に進む見込みも返す');
  /* 次の回は毎時37分（UTC）。 */
  ok(W.mwAutoNextAt(new Date('2026-11-09T02:10:00Z').getTime())
     ==='2026-11-09T02:37:00.000Z','★★次の回を正しく出す');
  ok(W.mwAutoNextAt(new Date('2026-11-09T02:40:00Z').getTime())
     ==='2026-11-09T03:37:00.000Z','★★すぎていれば次の時間');
}
{
  /* 作業者でも記録は見られる（見るだけ）。動かすのは管理者だけ。 */
  const env=env0();
  await cfg(env,{ mwAutoMode:'100' });
  const H2={'X-PJ-Key':'staff-key-123','content-type':'application/json'};
  const r=await worker.fetch(new Request('https://x/mw/auto?limit=5',
    { headers:H2 }),env,{});
  ok(r.status===200,'★★作業者の鍵でも記録を見られる');
  const r2=await worker.fetch(new Request('https://x/mw/auto',
    { method:'POST', headers:H2, body:'{}' }),env,{});
  ok(r2.status===403,'★★★動かすのは管理者だけ');
}

console.log('\n=== 「次回」に回した手数料を、自動の回でも取りに行く ===');
{
  const env=env0();
  await cfg(env,{ mwAutoMode:'100' });
  /* 値段は取れているのに手数料がまだ（＝前の回で「次回」に回した行）。 */
  for(let i=0;i<3;i++){
    await stock(env,i);
    await env.DB.prepare(
      `INSERT INTO mw_amz (jan,asin,name,price,basis,new_n,checked_at,price_at)
       VALUES (?1,?2,'名前',9000,'カート',1,?3,?3)`)
      .bind('49023705'+String(10000+i).slice(-5),
            'B0FEE0000'+i,'2026-11-09T00:00:00Z').run();
  }
  /* 1件だけは手数料が取れている（取り直さない）。 */
  await env.DB.prepare(
    `UPDATE mw_amz SET fee_total=1500, fee_ref=975, fee_fba=425, fee_tax=100,
       fee_base=9000, fee_at=?2 WHERE asin=?1`)
    .bind('B0FEE00000','2026-11-09T00:00:00Z').run();
  const d=await W.jobMwAuto(env,{ kind:'cron' });
  console.log('   '+JSON.stringify({ fee:d.fee_n, ng:d.fee_ng, left:d.fee_left }));
  ok(d.fee_n===2,
     '★★★手数料がまだの2件を、自動の回でも取りに行く（手で押す回と同じ）');
  const got=await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mw_amz WHERE COALESCE(fee_total,0)>0`).first();
  ok(+got.n===3,'★★★取れたぶんは控える');
  ok(d.fee_left===0,'★残りは0になる');
}
{
  /* 1回目で取れなかった分（手数料が失敗した行）が、次の回で取れること。
     「次回に回る」理由は 持ち時間切れ でも 失敗 でも同じ列（fee_at / fee_err）
     で見ているので、ここでは失敗で確かめる。 */
  const env=env0();
  await cfg(env,{ mwAutoMode:'100' });
  for(let i=0;i<4;i++){
    await stock(env,i);
    await env.DB.prepare(
      `INSERT INTO mw_amz (jan,asin,name,price,basis,new_n,checked_at,price_at)
       VALUES (?1,?2,'名前',9000,'カート',1,?3,?3)`)
      .bind('49023705'+String(10000+i).slice(-5),
            'B0LEFT000'+i,'2026-11-09T00:00:00Z').run();
  }
  /* 1回目：手数料だけ取れない。 */
  globalThis.fetch=async(u,i)=>{
    if(/products\/fees\/v0\/feesEstimate/.test(String(u)))
      return new Response('ng',{status:503});
    return mainFetch(u,i);
  };
  const d1=await W.jobMwAuto(env,{ kind:'cron' });
  globalThis.fetch=mainFetch;            // ★必ず戻す
  const left1=await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mw_amz WHERE COALESCE(fee_total,0)=0`).first();
  console.log('   1回目：取れた '+d1.fee_n+'件／だめ '+d1.fee_ng
    +'件／手数料がまだ '+(+left1.n)+'件');
  ok(d1.fee_n===0&&(+left1.n)===4,
     '★★★手数料が取れなかった回は、4件とも「次回」に回る');
  /* 2回目：ふつうに取れる。 */
  const d2=await W.jobMwAuto(env,{ kind:'cron' });
  const left2=await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mw_amz WHERE COALESCE(fee_total,0)=0`).first();
  console.log('   2回目：取れた '+d2.fee_n+'件／手数料がまだ '+(+left2.n)+'件');
  ok(d2.fee_n===4&&(+left2.n)===0,
     '★★★「次回」に回した手数料は、次の自動の回でちゃんと取りに行く');
}

await T.done();
