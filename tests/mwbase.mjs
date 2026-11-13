/* Worker：在庫の記録の「基準」と、入ってしまった誤りの取り除き
   （7.134・【T】の直し）

   v248 の作りでは mw_move・mw_stat を「掲載数が変わった回だけ」書いていたので、
   商品ごとの**基準**（はじめて見た日と、そのときの数）がどこにも残らず、
   その商品の**最初の変化が「初回の記録」**になっていた。
   記録のある日数が 0日（＝1日として扱う）なので、その1回の減りが
   そのまま「20点/日」になり、「欠品までの見込み 1日」「記録 1日分」と出た。

   ① はじめての行は基準（前の数は空・差は0）。出来事に1つも数えない
   ② 欠品から戻った行は「前の数＝0」。出来事として数える
   ③ 記録が1日に届かないうちは「1日あたり」を出さない（shared/mwstat.js）
   ④ 基準（前の数が無い記録）は「在庫の変化」として出さない
   ⑤ POST /mw/move/fix … 基準を控え直して、合計を積み直す（管理者だけ）
   ⑥ 変化のない行は知らせに出さない（ほかの社に在庫が残っている商品） */
import { harness, loadWorker, makeEnv, asJson, post } from './lib.mjs';
import MWSTAT from '../shared/mwstat.js';
const T=harness('Worker：在庫の記録の基準（7.134・【T】の直し）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwbase');

let emb=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/discord/.test(url)){
    const b=JSON.parse(String(o.body||'{}'));
    emb.push(...((b.embeds)||[]));
    return new Response(null,{status:204});
  }
  return new Response('{}',{status:200});
};
const embText=()=>emb.map((e)=>[e.title,e.description||'']
  .concat((e.fields||[]).map((f)=>f.name+' '+f.value)).join(' ')).join('\n');
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123' });
const impo=async(env,at,rows)=>(await asJson(await worker.fetch(
  post('/mw/stock',{ at:at, part:1, parts:1, rows_in:rows.length, rows:rows }),
  env,{}))).body;
const row=(o)=>Object.assign({ sha:'いろは商会', idx:0, kishu:'NS2',
  name:'商品'+o.jan, list_price:7678, release:'', cond:'新品',
  wholesale:3000, note:'', ship_text:'即日', ship_days:0 },o);
const stat=async(env,jan,sha)=>(await env.DB.prepare(
  `SELECT * FROM mw_stat WHERE jan=?1`+(sha?` AND sha=?2`:``))
  .bind(...(sha?[jan,sha]:[jan])).first())||null;
const moves=async(env)=>((await env.DB.prepare(
  `SELECT at,jan,sha,prev,cur,d,kind FROM mw_move ORDER BY id`).all())
  .results)||[];
const J1='4902370553901', J2='4902370550002';
const fill=(n)=>{ const a=[]; for(let i=0;i<(n||12);i++)
  a.push(row({ jan:'49023709'+String(i).padStart(5,'0'), stock:9 })); return a; };
const ago=(d)=>new Date(Date.now()-d*86400000).toISOString()
  .replace(/\.\d+Z$/,'Z');

console.log('=== ① 基準は出来事に数えない ===');
{
  const env=env0();
  await impo(env,ago(3),[row({jan:J1,stock:20})]);
  const m=await moves(env);
  ok(m.length===1&&m[0].kind==='new'&&m[0].prev===null&&+m[0].d===0,
     '★★★はじめての行は基準（前の数は空・差は0）');
  const s=await stat(env,J1);
  ok(+s.down_n===0&&+s.down_qty===0&&+s.up_n===0&&+s.back_n===0
     &&+s.gone_n===0&&+s.gone_days===0,
     '★★★基準は「戻った・増えた・減った」に1つも数えない');
  ok(+s.base_qty===20,'★★★基準の数を控える（20点）');
  ok(String(s.first_at)===ago(3).slice(0,19)+'Z'||String(s.first_at).length>10,
     '★はじめて記録した日時を残す');
  /* 2日後に 20→15 … これは基準があるので「減った」に数える */
  await impo(env,ago(1),[row({jan:J1,stock:15})]);
  const s2=await stat(env,J1);
  ok(+s2.down_n===1&&+s2.down_qty===5,'★★★2回目からは「減った」に数える');
}

console.log('\n=== ② 戻った行の前の数は 0 ===');
{
  const env=env0();
  const F=fill(12);
  await impo(env,ago(5),F.concat([row({jan:J1,stock:20})]));
  await impo(env,ago(4),F);                       // J1 が消える（欠品）
  /* 7.141（【3】）**同じ数で戻った回は CSV の抜け**とみなして「戻った」に
     数えないので、ここは数が変わって戻る形にする（18点）。 */
  await impo(env,ago(2),F.concat([row({jan:J1,stock:18})]));  // 戻る
  const b=(await moves(env)).filter((x)=>x.kind==='back')[0]||{};
  ok(+b.prev===0&&+b.cur===18,'★★★戻った行は 0 → 18（前の数は 0）');
  const s=await stat(env,J1);
  console.log('   '+JSON.stringify({ back_n:s.back_n, back_qty:s.back_qty,
    gone_n:s.gone_n, gone_days:s.gone_days }));
  ok(+s.back_n===1&&+s.back_qty===18,'★★戻った回数と数を数える');
  ok(Math.abs(+s.gone_days-2)<0.05,'★★欠品していた日数（2日）');
  /* 7.141（【3】）同じ数で戻った回は「戻った」に数えない。 */
  const e2=env0();
  await impo(e2,ago(5),F.concat([row({jan:J1,stock:20})]));
  await impo(e2,ago(4),F);
  await impo(e2,ago(2),F.concat([row({jan:J1,stock:20})]));
  const s3=await stat(e2,J1);
  console.log('   同じ数で戻った: '+JSON.stringify({ back_n:s3.back_n,
    gone_n:s3.gone_n, wipe_n:s3.wipe_n }));
  ok(+s3.back_n===0&&+s3.gone_n===0,
     '★★★同じ数で戻った回は「戻った・欠品」に数えない（7.141・CSV の抜け）');
}

console.log('\n=== ③ 記録が1日に届かないうちは1日あたりを出さない ===');
{
  const now=Date.now();
  /* 記録を控えた3時間後に20点減った、という形 */
  const c=MWSTAT.calc({ stock:20, mv_first:new Date(now-3*3600000).toISOString(),
    mv_down:20, mv_down_n:1, mv7_down:20, mv_base:20 },{ now:now });
  console.log('   '+c.label);
  ok(c.tooNew===true,'★★★記録が1日に届いていないことが分かる');
  ok(c.speed===null&&c.per7===null&&c.perAll===null,
     '★★★1日あたりの数は出さない（20点/日 と出していた）');
  ok(c.outDays===null,'★★★「欠品までの見込み」も出さない（1日 と出していた）');
  ok(c.base===20,'★基準の数を返す');
  ok(/記録を控えたところ/.test(c.label)&&!/20点\/日/.test(c.label),
     '★★文にも「1日あたり」を出さない');
  /* 2日分たまれば、ふだんどおり出す */
  const d=MWSTAT.calc({ stock:20, mv_first:new Date(now-2*86400000).toISOString(),
    mv_down:20, mv_down_n:1, mv7_down:20 },{ now:now });
  ok(d.tooNew===false&&d.speed===10,'★★★2日分あれば 1日 10点（20÷2）');
}

console.log('\n=== ④ 基準は「在庫の変化」として出さない ===');
{
  const env=env0();
  const at=ago(1);
  await impo(env,at,[row({jan:J1,stock:20})]);
  const mvq=await W.mwStatSql(env,'s');
  const q=await env.DB.prepare(
    /* mvq.chg は ?1 を取り込みの日時として使うので、JAN は ?2（7.118）。 */
    `SELECT s.jan AS jan${mvq.chg} FROM mw_stock s WHERE s.jan=?2`)
    .bind(at,J1).all();
  console.log('   '+JSON.stringify((q.results||[])[0]));
  const r=(q.results||[])[0]||{};
  ok(r.mv_prev===null&&r.mv_cur===null,
     '★★★基準の回は変化を出さない（「0 → 20」と出していた）');
}

console.log('\n=== ⑤ 基準を控え直して合計を積み直す（/mw/move/fix）===');
{
  const env=env0();
  /* v248 のまずい記録を手で入れる（前の数が無い「戻った」と「新しく出た」）。 */
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,name,stock,row_hash,seen_at,created_at)
     VALUES (?1,'いろは商会',0,'あつまれ どうぶつの森',20,'h',?2,?3)`)
    .bind(J1,ago(1),ago(40)).run();
  await env.DB.prepare(
    `INSERT INTO mw_move (at,jan,sha,idx,prev,cur,d,kind,created_at)
     VALUES (?1,?2,'いろは商会',0,NULL,20,20,'back',?1)`)
    .bind(ago(1),J1).run();
  await env.DB.prepare(
    `INSERT INTO mw_move (at,jan,sha,idx,prev,cur,d,kind,created_at)
     VALUES (?1,?2,'いろは商会',0,20,NULL,-20,'gone',?1)`)
    .bind(ago(1),J1).run();
  await env.DB.prepare(
    `INSERT INTO mw_stat (jan,sha,first_at,last_at,down_n,down_qty,up_n,up_qty,
       gone_n,back_n,back_qty,gone_days,created_at)
     VALUES (?1,'いろは商会',?2,?2,1,20,0,0,1,1,20,1.4,?2)`)
    .bind(J1,ago(1)).run();
  const before=await stat(env,J1);
  console.log('   直す前: '+JSON.stringify({ first_at:before.first_at,
    back_n:before.back_n, back_qty:before.back_qty,
    gone_days:before.gone_days, down_qty:before.down_qty }));
  const res=await W.mwBaseFix(env,null);
  console.log('   '+JSON.stringify(res));
  ok(res.ok===true,'★作り直せる');
  const s=await stat(env,J1);
  console.log('   直した後: '+JSON.stringify({ first_at:s.first_at,
    base_qty:s.base_qty, back_n:s.back_n, back_qty:s.back_qty,
    gone_days:s.gone_days, down_qty:s.down_qty, gone_n:s.gone_n }));
  ok(+s.back_n===0&&+s.back_qty===0,
     '★★★前の数が無い「戻った」は数えない（戻った1回・20点を取り除く）');
  ok(+s.gone_days===0,'★★★初回ぶんの欠品日数（1.4日）を取り除く');
  /* 7.142：欠品（CSV から行がなくなった回）は「一度に消えた」なので、
     売れた数（down_qty）には入れず wipe に入れる。欠品の回数は残る。 */
  ok(+s.gone_n===1&&+s.down_qty===0&&+s.wipe_qty===20,
     '★★前の数がある「欠品」は欠品のまま数え、売れた数には入れない（7.142）');
  ok(String(s.first_at)===String(ago(40)),
     '★★★はじめて見た日（mw_stock の created_at）まで戻す');
  ok(+s.base_qty===20,'★★★基準の数を控える');
  ok(res.moved===1,'★初回あつかいの記録の数を返す');
  /* 「記録のある日数」が40日になるので、目安がまともに出る。 */
  const mvq=await W.mwStatSql(env,'s',true);
  const g=await env.DB.prepare(
    `SELECT s.jan AS jan, SUM(COALESCE(s.stock,0)) AS stock${mvq.cols}
       FROM mw_stock s${mvq.join} WHERE s.jan=?1 GROUP BY s.jan`)
    .bind(J1).first();
  const c=MWSTAT.calc(g,{});
  console.log('   '+c.label);
  ok(c.days>=39&&c.tooNew===false,'★★★記録のある日数が 40日になる');
  /* 直近7日の窓で割るので 20÷7＝2.9点/日。v248 は記録が1日分しか
     無かったので 20÷1＝20点/日 と出ていた。 */
  ok(c.speed===2.9&&c.speedSrc==='week',
     '★★★売れる速さが「20点/日」ではなくなる（20÷7日＝2.9点/日）');
}

console.log('\n=== ⑥ 変化のない行は知らせに出さない ===');
{
  const env=env0();
  const F=fill(12);
  /* 同じ JAN を2社が持っている。社Bだけが CSV から消える。 */
  const A=(o)=>row(Object.assign({ sha:'いろは商会', idx:0 },o));
  const B=(o)=>row(Object.assign({ sha:'にほへ商事', idx:0 },o));
  await impo(env,ago(2),F.concat([A({jan:J1,stock:20}),B({jan:J1,stock:20})]));
  emb=[];
  const r=await impo(env,ago(1),F.concat([A({jan:J1,stock:20})]));
  console.log('   欠品の行 '+r.gone+'／知らせに出さなかった '+(r.note_same||0));
  ok(+r.gone===1,'★社Bの行は欠品になる');
  ok(!/あつまれ|商品4902370553901/.test(embText()),
     '★★★ほかの社に在庫が残っている商品は「欠品」として出さない');
  /* 両方消えれば、ふだんどおり欠品として出す。 */
  emb=[];
  await impo(env,ago(0.5),F);
  ok(/商品4902370553901/.test(embText()),
     '★★★全部の社から消えたら欠品として出す');
}

T.done();
