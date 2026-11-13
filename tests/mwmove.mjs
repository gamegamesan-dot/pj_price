/* Worker：MW 在庫の動きの記録と目安（7.126・【T】）

   ① 取り込みのたびに、掲載数が**変わった行だけ**を mw_move に残す
      （変わらない回は1行も書かない）／合計は mw_stat に積む
   ② 目安：売れる速さ（直近7日・全期間）・欠品までの見込み・
      再入荷の回数と数・欠品していた日数・在庫処分の印・記録の少なさ
   ③ GET /mw/move … 1商品の記録と目安
   ④ GET /mw/week … まとめ（よく売れる／在庫処分で再入荷なし／再入荷が多い）
   ⑤ Discord：1通目は要約（件数と注目の商品）、詳しい一覧は10件ずつ
      （スレッドID を入れたらそこへ）。そのほかの欠品も商品ごとに出す
   ⑥ 古い記録は90日で捨てる（合計は残る）
   ⑦ 表が無い（migrate-0049 の前）でも取り込みは止まらない */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import MWSTAT from '../shared/mwstat.js';
const T=harness('Worker：MW 在庫の動きの記録と目安（7.126）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwmove');

let sent=[], emb=[], msgs=[], urls=[];
const embText=()=>emb.map((e)=>[e.title,e.url,e.description||'']
  .concat((e.fields||[]).map((f)=>f.name+' '+f.value)).join(' ')).join('\n');
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/discord/.test(url)){
    const b=JSON.parse(String(o.body||'{}'));
    sent.push(b.content||''); emb.push(...((b.embeds)||[])); msgs.push(b);
    urls.push(url);
    return new Response(null,{status:204});
  }
  return new Response('{}',{status:200});
};
const reset=()=>{ sent=[]; emb=[]; msgs=[]; urls=[]; };
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123' });
/* 取り込み（画面と同じ口）。rows は {jan,sha,stock,...}。 */
const impo=async(env,at,rows,extra)=>(await asJson(await worker.fetch(
  post('/mw/stock',Object.assign({ at:at, part:1, parts:1,
    rows_in:rows.length, rows:rows },extra||{})),env,{}))).body;
const row=(o)=>Object.assign({ sha:'いろは商会', idx:0, kishu:'NS2',
  name:'商品'+o.jan, list_price:7678, release:'', cond:'新品',
  wholesale:3000, note:'', ship_text:'即日', ship_days:0 },o);
const moves=async(env)=>((await env.DB.prepare(
  `SELECT at,jan,sha,prev,cur,d,kind FROM mw_move ORDER BY id`).all())
  .results)||[];
const stat=async(env,jan)=>(await env.DB.prepare(
  `SELECT * FROM mw_stat WHERE jan=?1`).bind(jan).first())||null;
const J1='4902370550001', J2='4902370550002', J3='4902370550003';
/* 「直近7日」の窓に入るよう、**いまから n 日前**の日時を作る。 */
const ago=(d)=>new Date(Date.now()-d*86400000).toISOString()
  .replace(/\.\d+Z$/,'Z');
/* 3割の歯止め（MW_DROP_WARN）が効かないように入れておく行。 */
const fill=(n)=>{ const a=[]; for(let i=0;i<(n||12);i++)
  a.push(row({ jan:'49023709'+String(i).padStart(5,'0'), stock:9 })); return a; };

console.log('=== ① 変わった行だけ記録する ===');
{
  const env=env0();
  await impo(env,'2026-11-01T00:00:00Z',[row({jan:J1,stock:12}),
                                         row({jan:J2,stock:5})]);
  let m=await moves(env);
  console.log('   1回目: '+JSON.stringify(m.map((x)=>x.kind+' '+x.d)));
  ok(m.length===2&&m.every((x)=>x.kind==='new'),
     '★★★はじめて出てきた行は「new」で残す');
  /* 7.134（【T】の直し）はじめての行は**基準**。前の数が無いので
     差は 0 にして、出来事（減った・増えた）には数えない。 */
  ok(m[0].prev===null&&+m[0].cur===12&&+m[0].d===0,
     '★★★はじめての行は基準（前の数は空・差は0）');
  const s0=await stat(env,J1);
  ok(+s0.down_n===0&&+s0.down_qty===0&&+s0.up_n===0&&+s0.up_qty===0
     &&+s0.back_n===0&&+s0.gone_n===0,
     '★★★基準は「戻った・増えた・減った」に1つも数えない');
  ok(+s0.base_qty===12,'★★★基準の数（はじめて記録したときの掲載数）を控える');
  /* 同じ数でもう一度取り込む → 1行も増えない */
  await impo(env,'2026-11-02T00:00:00Z',[row({jan:J1,stock:12}),
                                         row({jan:J2,stock:5})]);
  ok((await moves(env)).length===2,'★★★数が変わらない回は1行も書かない');
  /* 減った・増えた */
  await impo(env,'2026-11-03T00:00:00Z',[row({jan:J1,stock:9}),
                                         row({jan:J2,stock:8})]);
  m=await moves(env);
  const d=m.filter((x)=>x.kind==='down')[0]||{};
  const u=m.filter((x)=>x.kind==='up')[0]||{};
  console.log('   3回目: '+JSON.stringify(m.slice(2).map(
    (x)=>x.kind+' '+x.prev+'→'+x.cur)));
  ok(+d.prev===12&&+d.cur===9&&+d.d===-3,'★★★減った行は「down」（12→9）');
  ok(+u.prev===5&&+u.cur===8&&+u.d===3,'★★★増えた行は「up」（補充）');
  const s1=await stat(env,J1);
  console.log('   合計: '+JSON.stringify(s1));
  ok(+s1.down_n===1&&+s1.down_qty===3,'★★★合計に「減った数」を積む');
  ok(+s1.up_qty===0,'★★★減った数に補充は入れない');
  ok((await stat(env,J2)).up_qty==='3'||+(await stat(env,J2)).up_qty===3,
     '★★補充は別に積む');
  ok(s1.first_at==='2026-11-01T00:00:00Z'
     &&s1.last_at==='2026-11-03T00:00:00Z',
     '★★はじめて記録した日時と最後に動いた日時');
}

console.log('\n=== ① 欠品と、欠品から戻ったとき ===');
{
  const env=env0();
  /* 3割の歯止め（MW_DROP_WARN）が効かないよう、消えない行を入れておく。 */
  const F=fill(12);
  await impo(env,'2026-11-01T00:00:00Z',F.concat([row({jan:J1,stock:12}),
                                                  row({jan:J2,stock:7})]));
  /* J1 が CSV から消える（欠品）。 */
  await impo(env,'2026-11-02T00:00:00Z',F.concat([row({jan:J2,stock:7})]));
  let m=await moves(env);
  const g=m.filter((x)=>x.kind==='gone')[0]||{};
  console.log('   '+JSON.stringify(m.map((x)=>x.jan.slice(-1)+':'+x.kind)));
  ok(g.jan===J1&&+g.prev===12&&g.cur===null&&+g.d===-12,
     '★★★欠品は「gone」で、**消える前の数**を残す（12→欠品）');
  ok(+(await stat(env,J1)).gone_n===1,'★★欠品の回数を積む');
  /* 7.141（【2】）**CSV から行がなくなった回は「売れた」と数えない**
     （買い占め・取り下げ・CSV の抜けのどれか）。v268 までは消える前の
     掲載数をまるごと down_qty に足していたので、415点が消えた商品が
     「売れる速さ 64.3点/日」と出ていた。 */
  ok(+(await stat(env,J1)).down_qty===0,
     '★★★欠品のぶんは「減った数（売れた数の目安）」に入れない（7.141）');
  ok(+(await stat(env,J1)).wipe_n===1&&+(await stat(env,J1)).wipe_qty===12,
     '★★★「一度に消えた」として別に控える');
  /* 2日半あとに戻ってくる */
  await impo(env,'2026-11-04T12:00:00Z',F.concat([row({jan:J1,stock:6}),
                                                  row({jan:J2,stock:7})]));
  m=await moves(env);
  const b=m.filter((x)=>x.kind==='back')[0]||{};
  /* 7.134：戻った行の**前の数は 0**（欠品していたので0点だった）。
     v248 は空（NULL）にしていたので「初回の記録」と見分けがつかず、
     記録がまだ無い商品でも「戻った1回・欠品N日」に数えていた。 */
  ok(b.jan===J1&&+b.prev===0&&+b.cur===6,'★★★戻った行は「back」（前の数は0）');
  const s=await stat(env,J1);
  console.log('   戻り: '+s.back_n+'回 '+s.back_qty+'点 欠品 '+s.gone_days+'日');
  ok(+s.back_n===1&&+s.back_qty===6,'★★★戻った回数と、戻ったときの数');
  ok(Math.abs(+s.gone_days-2.5)<0.02,'★★★欠品していた日数（2.5日）');
}

console.log('\n=== ② 目安の計算（shared/mwstat.js）===');
{
  const now=Date.parse('2026-11-09T00:00:00Z');
  const c=MWSTAT.calc({ stock:12, note:'在庫処分', mv_first:'2026-08-01T00:00:00Z',
    mv_down:60, mv_down_n:20, mv7_down:7 },{ now:now });
  console.log('   '+c.label);
  ok(c.per7===1&&c.speed===1&&c.speedSrc==='week',
     '★★★直近7日の「1日あたりに減った数」');
  ok(c.perAll===0.6,'★★全期間の「1日あたりに減った数」');
  ok(c.outDays===12,'★★★欠品までの見込み（12点 ÷ 1点/日）');
  ok(c.sale===true&&c.noBack===true,
     '★★★在庫処分で、戻ったことがない＝刈り切る候補');
  ok(c.thin===false&&c.days===100,'★記録が十分なら「参考程度」は出さない');
  const t=MWSTAT.calc({ stock:3, mv_first:'2026-11-05T00:00:00Z', mv_down:3,
    mv7_down:3 },{ now:now });
  ok(t.thin===true&&/記録 4日分・目安は参考程度/.test(t.label),
     '★★★記録が少ないうちは「参考程度」と出す');
  ok(MWSTAT.calc({},{ now:now }).label==='記録なし','★記録が無ければ「記録なし」');
  const r=MWSTAT.calc({ stock:0, mv_first:'2026-08-01T00:00:00Z', mv_gone_n:4,
    mv_back_n:3, mv_back_qty:24, mv_gone_days:9 },{ now:now });
  ok(r.backN===3&&r.backAvg===8&&r.goneAvg===2.3,
     '★★★再入荷の回数・平均の数・平均の欠品日数');
  ok(MWSTAT.saleHit('※在庫処分品です')==='在庫処分','★備考の言葉で見つける');
  ok(MWSTAT.saleHit('ふつうの備考')===''
     &&MWSTAT.saleHit('きずあり','きずあり')==='きずあり',
     '★★言葉は設定で変えられる');
}

console.log('\n=== ③ GET /mw/move（1商品の記録と目安）===');
{
  const env=env0();
  await impo(env,'2026-11-01T00:00:00Z',[row({jan:J1,stock:12,note:'在庫処分'}),
                                         row({jan:J2,stock:7})]);
  await impo(env,'2026-11-05T00:00:00Z',[row({jan:J1,stock:4,note:'在庫処分'}),
                                         row({jan:J2,stock:7})]);
  const d=(await asJson(await worker.fetch(
    get('/mw/move?jan='+J1),env,{}))).body;
  console.log('   '+d.rows.length+'行／'+(d.stat||{}).label);
  ok(d.ok===true&&d.jan===J1&&d.rows.length===2,'★★★その商品の記録を返す');
  ok(d.rows[0].kind==='down'&&d.rows[0].at_jst,'★★新しい順・日本時間つき');
  ok(d.stat&&d.stat.sale===true,'★★★目安（在庫処分の印）も返す');
  ok(+d.stock===4,'★★いまの在庫数を返す');
  ok(d.keep_days===90,'★詳しい記録を残す日数も返す');
  const bad=(await asJson(await worker.fetch(
    get('/mw/move?jan=123'),env,{}))).body;
  ok(bad.ok===false&&bad.error==='bad_jan','★JAN の形が違えば断る');
}

console.log('\n=== ③ 一覧にも目安の列を足す（/mw/nt・/mw/amz・/mw/list）===');
{
  const env=env0();
  const F5=fill(12);
  await impo(env,'2026-11-01T00:00:00Z',F5.concat([row({jan:J1,stock:12}),
                                                   row({jan:J2,stock:7})]));
  await impo(env,'2026-11-05T00:00:00Z',F5.concat([row({jan:J1,stock:4}),
                                                   row({jan:J2,stock:7})]));
  const AT='2026-11-06T00:00:00Z';
  await impo(env,AT,F5.concat([row({jan:J2,stock:7})]));   // J1 が欠品
  const nt=(await asJson(await worker.fetch(
    get('/mw/nt?at='+AT+'&kind=gone'),env,{}))).body;
  const r=nt.rows[0]||{};
  console.log('   /mw/nt: '+JSON.stringify({ mv_down:r.mv_down,
    mv7:r.mv7_down, first:r.mv_first }));
  /* 7.141（【2】）12→4 の 8点だけが「減った（売れた）」。
     4→欠品の 4点は「一度に消えた」なので入らない。 */
  ok(+r.mv_down===8&&+r.mv_down_n===1,'★★★/mw/nt に減った合計と回数を返す');
  ok(+r.mv_wipe_n===1&&+r.mv_wipe===4,
     '★★★一度に消えた回（欠品のぶん）も返す');
  ok(r.mv_first==='2026-11-01T00:00:00Z','★★はじめて記録した日時も返す');
  ok(+r.mv_prev===4&&+r.mv_cur===0,'★★★その回の在庫の変化（4→0）も返す');
  const li=(await asJson(await worker.fetch(
    get('/mw/list?limit=10'),env,{}))).body;
  ok((li.rows||[]).length&&li.rows[0].mv_first!==undefined,
     '★★★/mw/list にも目安の列を足す');
  const az=(await asJson(await worker.fetch(
    get('/mw/amz?limit=10'),env,{}))).body;
  ok((az.rows||[]).length&&az.rows[0].mv_down!==undefined,
     '★★★/mw/amz（刈取）にも目安の列を足す');
}

console.log('\n=== ④ GET /mw/week（まとめ）===');
{
  const env=env0();
  /* よく売れる（J1）・在庫処分で戻らない（J2）・再入荷が多い（J3）。
     日時は**いまから n 日前**にして「直近7日」の窓に入れる。 */
  const F=fill(14);
  await impo(env,ago(6),F.concat([row({jan:J1,stock:30}),
    row({jan:J2,stock:4,note:'在庫処分'}), row({jan:J3,stock:3})]));
  await impo(env,ago(5),F.concat([row({jan:J1,stock:10}),
    row({jan:J2,stock:4,note:'在庫処分'}), row({jan:J3,stock:3})]));
  /* J2 と J3 が欠品 → J3 だけ戻る（2回） */
  await impo(env,ago(4),F.concat([row({jan:J1,stock:10})]));
  await impo(env,ago(3),F.concat([row({jan:J1,stock:10}),
                                  row({jan:J3,stock:5})]));
  await impo(env,ago(2),F.concat([row({jan:J1,stock:10})]));
  await impo(env,ago(1),F.concat([row({jan:J1,stock:10}),
                                  row({jan:J3,stock:6})]));
  const w=(await asJson(await worker.fetch(get('/mw/week'),env,{}))).body;
  console.log('   よく売れる: '+(w.hot||[]).map((x)=>x.jan.slice(-1)+':'
    +x.stat.down).join('/')+'／再入荷なし: '+(w.none||[]).map((x)=>x.jan.slice(-1))
    +'／再入荷が多い: '+(w.many||[]).map((x)=>x.jan.slice(-1)+':'+x.stat.backN));
  ok(w.ok===true,'★まとめを返す');
  ok((w.hot[0]||{}).jan===J1,'★★★よく売れる商品の上位（直近7日に減った数）');
  ok((w.none||[]).some((x)=>x.jan===J2)&&!(w.none||[]).some((x)=>x.jan===J3),
     '★★★在庫処分で**再入荷がない**商品だけを出す');
  ok((w.many[0]||{}).jan===J3&&w.many[0].stat.backN===2,
     '★★★再入荷が多い商品（戻った回数）');
  ok(w.rows>0&&w.keep_days===90,'★記録の行数と残す日数も返す');
  /* いますぐ Discord に送る */
  reset();
  const run=(await asJson(await worker.fetch(
    post('/mw/week/run',{}),env,{}))).body;
  console.log('   '+sent.join(' | ').slice(0,180));
  ok(run.ok===true&&run.sent>0,'★★★POST /mw/week/run で Discord に送る');
  const txt=sent.join('\n');
  ok(/MW 在庫の目安まとめ（週に1回）/.test(txt),'★★見出し');
  ok(/よく売れている商品/.test(txt)&&/在庫処分で\*\*再入荷がない\*\*商品/.test(txt)
     &&/再入荷が多い商品/.test(txt),'★★★3つの区分を出す');
  ok(txt.indexOf(J1)>0&&txt.indexOf(J2)>0&&txt.indexOf(J3)>0,
     '★★商品名と JAN を出す');
}

console.log('\n=== ④ 自動は日本時間の月曜9時台に1回だけ ===');
{
  const env=env0();
  await impo(env,ago(2),fill(4).concat([row({jan:J1,stock:5})]));
  reset();
  const r1=(await asJson(await worker.fetch(
    post('/mw/week/run',{}),env,{}))).body;   // 手で押せばいつでも送る
  ok(r1.sent>0,'★手で押せばいつでも送る');
  /* 自動は時刻を見る。いまが月曜9時台（JST）でなければ送らない。 */
  const d=new Date();
  const isTime=(d.getUTCDay()===1&&d.getUTCHours()===0);
  reset();
  const r2=await W.jobMwWeek(env,{ src:'auto' });
  console.log('   いまは'+(isTime?'月曜9時台':'それ以外')+'：'+(r2.why||'送った'));
  ok(isTime?(r2.sent>0||r2.why==='done'):(r2.why==='not_time'&&!sent.length),
     '★★★自動は月曜9時台（JST）だけ');
  if(isTime){
    reset();
    const r3=await W.jobMwWeek(env,{ src:'auto' });
    ok(r3.why==='done'&&!sent.length,'★★★同じ週は2回送らない');
  } else ok(true,'★★★同じ週は2回送らない（時刻が来たときに効く）');
}

console.log('\n=== ⑤ 知らせ：1通目は要約、詳しい一覧は10件ずつ ===');
{
  const env=env0();
  /* 20件を入荷 → 次の回で 11件が欠品（関わりのない欠品） */
  const many=[];
  for(let i=0;i<40;i++)
    many.push(row({ jan:'4902370560'+String(i).padStart(3,'0'), stock:3,
                    list_price:1000, wholesale:900 }));
  await impo(env,ago(2),many);
  reset();
  /* 11本だけ消す（40行の 27.5%。3割の歯止めは効かない）。 */
  await impo(env,ago(1),many.slice(11));
  console.log('   通数 '+msgs.length+'／1通目: '+String(sent[0]||'').slice(0,120));
  ok(/MW の在庫CSVを取り込みました/.test(String(sent[0]||''))
     &&!(msgs[0].embeds||[]).length,
     '★★★1通目は**要約だけ**（埋め込みは入れない）');
  ok(msgs.length>=2,'★★詳しい一覧は別の通で送る');
  ok(msgs.slice(1).every((m)=>(m.embeds||[]).length<=10),
     '★★★1通に10件まで');
  ok(/そのほかの欠品/.test(sent.join('\n')),
     '★★★「そのほかの欠品」も商品ごとに出す（件数だけにしない）');
  ok(emb.length===11,'★★★11件ぜんぶを商品ごとに出す');
  const t=embText();
  ok(/売れる速さ/.test(t)&&/在庫の変化/.test(t),
     '★★★埋め込みに在庫の変化と売れる速さを出す');
  ok(/3 → 0 点/.test(t),'★★★在庫の変化は「3 → 0 点」の形');
  ok(/記録/.test(t)&&/目安は参考程度/.test(t),
     '★★★記録が少ないうちは「参考程度」と添える');
}

console.log('\n=== ⑤ 注目の商品を要約に出す ===');
{
  const env=env0();
  const F2=fill(14);
  await impo(env,ago(40),F2.concat([row({jan:J1,stock:9,note:'在庫処分'}),
    row({jan:J2,stock:9}), row({jan:J3,stock:9})]));
  await impo(env,ago(39),F2.concat([row({jan:J2,stock:9}),
    row({jan:J3,stock:9})]));                       // J1 欠品
  reset();
  await impo(env,ago(1),F2.concat([row({jan:J2,stock:0}),
    row({jan:J3,stock:9})]));
  const head=String(sent[0]||'');
  console.log('   '+head.slice(0,200));
  ok(/注目：/.test(head),'★★★注目の商品を1通目に出す');
  ok(/新しく欠品/.test(head)&&/新しく出てきた/.test(head)
     &&/欠品から戻った/.test(head),'★★件数も出す');
}

console.log('\n=== ⑤ スレッドに流す（mwNtThread）===');
{
  const env=env0();
  await worker.fetch(post('/settings',{ at:'2026-11-09T00:00:00Z',
    settings:{ mwNtThread:'1234567890123' } }),env,{});
  const F3=fill(14);
  await impo(env,ago(2),F3.concat([row({jan:J1,stock:9,list_price:30000,
    wholesale:3000}), row({jan:J2,stock:9})]));
  reset();
  await impo(env,ago(1),F3.concat([row({jan:J2,stock:9})]));
  console.log('   '+urls.map((u)=>/thread_id/.test(u)?'thread':'main').join('/'));
  ok(urls.length>=2&&!/thread_id/.test(urls[0]),
     '★★★1通目（要約）は #一般 のまま');
  ok(urls.slice(1).every((u)=>/thread_id=1234567890123/.test(u)),
     '★★★詳しい一覧はスレッドへ送る');
  ok(/くわしくはスレッドに10件ずつ/.test(String(sent[0]||'')),
     '★★要約にその案内を入れる');
}

console.log('\n=== ⑤ 件数だけに戻せる（mwNtRest をオフ）===');
{
  const env=env0();
  await worker.fetch(post('/settings',{ at:'2026-11-09T00:00:00Z',
    settings:{ mwNtRest:'off' } }),env,{});
  const F4=fill(14);
  await impo(env,ago(2),F4.concat([row({jan:J1,stock:9,list_price:1000,
    wholesale:900}), row({jan:J2,stock:9})]));
  reset();
  await impo(env,ago(1),F4.concat([row({jan:J2,stock:9})]));
  ok(/そのほかの欠品 1件（/.test(sent.join('\n')),
     '★★★オフにすれば今までどおり件数だけ');
  ok(!emb.length,'★★そのときは埋め込みを出さない');
}

console.log('\n=== ⑥ 古い記録は90日で捨てる（合計は残る）===');
{
  const env=env0();
  await impo(env,'2026-11-01T00:00:00Z',[row({jan:J1,stock:9}),
                                         row({jan:J2,stock:9})]);
  await env.DB.prepare(
    `INSERT INTO mw_move (at,jan,sha,idx,prev,cur,d,kind,created_at)
     VALUES ('2026-01-01T00:00:00Z',?1,'いろは商会',0,20,10,-10,'down',
             '2026-01-01T00:00:00Z')`).bind(J1).run();
  ok((await moves(env)).length===3,'★古い記録を1行入れた');
  await W.mwMoveSweep(env,null);
  const left=await moves(env);
  console.log('   残り '+left.length+'行');
  ok(left.length===2&&!left.some((x)=>x.at==='2026-01-01T00:00:00Z'),
     '★★★90日より前の記録は捨てる');
  ok(+(await stat(env,J1)).down_qty>=0,'★★★合計（mw_stat）は残る');
  ok(W.MW_MOVE_KEEP_DAYS===90,'★残す日数は90日');
}

console.log('\n=== ⑦ 表が無くても取り込みは止まらない ===');
{
  /* colOk は「ある」を覚えるので、**まっさらな worker** で確かめる
     （本番では表を消さないので、この覚え方でよい）。 */
  const { worker:w2, T:W2 }=await loadWorker('mwmove-no');
  const env=env0();
  await env.DB.prepare(`DROP TABLE mw_move`).run();
  await env.DB.prepare(`DROP TABLE mw_stat`).run();
  const r=(await asJson(await w2.fetch(post('/mw/stock',{ at:'2026-11-01T00:00:00Z',
    part:1, parts:1, rows_in:1, rows:[row({jan:J1,stock:9})] }),env,{}))).body;
  console.log('   '+JSON.stringify({ ok:r.ok, added:r.added, moved:r.moved }));
  ok(r.ok===true&&r.added===1,'★★★表が無くても取り込みは通る');
  ok(r.moved===0,'★★記録は0件');
  const d=(await asJson(await w2.fetch(
    get('/mw/move?jan='+J1),env,{}))).body;
  ok(d.ok===false&&d.error==='no_table','★★口は「表がありません」と答える');
  const nt=(await asJson(await w2.fetch(
    get('/mw/nt?at=2026-11-01T00:00:00Z&kind=gone'),env,{}))).body;
  ok(nt.ok===true,'★★★/mw/nt も落ちない（目安の列だけ出ない）');
  const w=(await asJson(await w2.fetch(get('/mw/week'),env,{}))).body;
  ok(w.ok===false&&w.error==='no_table','★★まとめも「表がありません」と答える');
}

console.log('\n=== D1 の見積もり（書き込みの量）===');
{
  const env=env0();
  /* 400行のうち20行だけ数が変わる回 → 文は 400（seen_at）＋20×2 */
  const base=[], next=[];
  for(let i=0;i<400;i++){
    base.push(row({ jan:'49023707'+String(i).padStart(5,'0'), stock:9 }));
    next.push(row({ jan:'49023707'+String(i).padStart(5,'0'),
                    stock:(i<20?8:9) }));
  }
  await impo(env,'2026-11-01T00:00:00Z',base);
  const r=await impo(env,'2026-11-02T00:00:00Z',next);
  console.log('   400行のうち動いた '+r.moved+'行');
  ok(r.moved===20,'★★★数が動いた行だけ記録する（400行→20行）');
  ok(W.MOVE_MAX===4000,'★1回に残す上限（D1 の歯止め）');
}
T.done();
