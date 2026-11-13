/* Worker：「一度に消えた」を売れた数に数えない（7.141・【1】〜【3】）

   2026-11-13 の不具合（カジ）
     彩京 SHOOTING LIBRARY Vol.1（JAN 4571442047206）の社内用カードに
       「在庫の変化 415 → 0点」「MW在庫 415点」
       「売れる速さ 64.3点/日（直近7日）」
     と出ていた。

   原因
     ① CSV から行がなくなった商品の「MW在庫」に、**消える前の掲載数**を
        出していた（もう買えないので今の数は 0）
     ② CSV から行がなくなった回の掲載数を、まるごと「減った＝売れた」として
        down_qty に足していた。415点が1回で「売れた」ことになり、
        売れる速さが 64.3点/日 になっていた

   直し
     ① MW在庫は**今の数**（CSV から消えた行は 0点・消える前の数も書く）
     ② 1回の確認で大量に減って0になった回（⚙のしきい値）と、
        CSV から行がなくなった回は「一度に消えた」として別に記録・表示し、
        **売れる速さ・欠品までの見込みには入れない**
     ③ CSV から行がなくなった商品が**同じ数で**戻ってきたら、
        「戻った」「再入荷」に数えない（消えたときの記録も取り消す） */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import MWSTAT from '../shared/mwstat.js';
const T=harness('Worker：一度に消えた（7.141）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwwipe');

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
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123' });
const cfg=(env,o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:'2026-11-13T00:00:00Z', settings:o||{} }),
        '2026-11-13T00:00:00Z').run();
const impo=async(env,at,rows)=>(await asJson(await worker.fetch(
  post('/mw/stock',{ at:at, part:1, parts:1, rows_in:rows.length, rows:rows }),
  env,{}))).body;
const row=(o)=>Object.assign({ sha:'いろは商会', idx:0, kishu:'NS2',
  name:'商品'+o.jan, list_price:7678, release:'', cond:'新品',
  wholesale:3000, note:'', ship_text:'即日', ship_days:0 },o);
const stat=async(env,jan)=>(await env.DB.prepare(
  `SELECT * FROM mw_stat WHERE jan=?1`).bind(jan).first())||{};
const moves=async(env,jan)=>((await env.DB.prepare(
  `SELECT kind,prev,cur,d FROM mw_move WHERE jan=?1 ORDER BY id`)
  .bind(jan).all()).results)||[];
const J='4571442047206', J2='4902370550002';
const fill=(n)=>{ const a=[]; for(let i=0;i<(n||12);i++)
  a.push(row({ jan:'49023709'+String(i).padStart(5,'0'), stock:9 })); return a; };
const F=fill(12);

console.log('=== ① しきい値（⚙で変えられる）===');
{
  ok(W.MW_WIPE_PCT===80&&W.MW_WIPE_MIN===50,
     '★★★既定は「前の数の80%以上」かつ「50点以上」');
  const d=W.mwWipeOpt({});
  ok(d.pct===80&&d.min===50,'★⚙が空なら既定');
  const o=W.mwWipeOpt({ mwWipePct:50, mwWipeMin:10 });
  ok(o.pct===50&&o.min===10,'★★★⚙で変えられる');
  ok(W.mwWipeHit(415,0,d)===true,'★★★415 → 0 は「一度に消えた」');
  ok(W.mwWipeHit(60,0,d)===true,'★★50点以上なら当たる');
  ok(W.mwWipeHit(40,0,d)===false,
     '★★★50点に届かない行はふつうの「減った」（売れたと数える）');
  ok(W.mwWipeHit(415,10,d)===false,
     '★★★0 になっていない回は「一度に消えた」ではない');
  ok(W.mwWipeHit(0,0,d)===false,'★前が0なら数えない');
  ok(W.mwWipeHit(40,0,{ pct:80, min:10 })===true,'★★⚙を下げれば当たる');
}

console.log('\n=== ② 1回で大量に減って0（CSV には残っている）===');
{
  const env=env0();
  await cfg(env,{});
  await impo(env,'2026-11-01T00:00:00Z',F.concat([row({jan:J,stock:415})]));
  await impo(env,'2026-11-02T00:00:00Z',F.concat([row({jan:J,stock:0})]));
  const m=await moves(env,J);
  const s=await stat(env,J);
  console.log('   '+JSON.stringify(m)+' '+JSON.stringify({ down:s.down_qty,
    wipe_n:s.wipe_n, wipe_q:s.wipe_qty }));
  ok(m.some((x)=>x.kind==='wipe'),'★★★「wipe」として記録する');
  ok(+s.down_qty===0,'★★★「減った数（売れた数の目安）」には入れない');
  ok(+s.wipe_n===1&&+s.wipe_qty===415,'★★★一度に消えた回数と数を控える');
  /* 売れる速さ・欠品までの見込みに入らない。 */
  const r=(await asJson(await worker.fetch(get('/mw/move?jan='+J),env,{}))).body;
  console.log('   '+JSON.stringify({ speed:(r.stat||{}).speed,
    out:(r.stat||{}).outDays, wipeN:(r.stat||{}).wipeN }));
  ok((r.stat||{}).speed===null||(r.stat||{}).speed===0,
     '★★★売れる速さに入らない（64.3点/日 と出ていた）');
  ok((r.stat||{}).outDays===null,'★★★欠品までの見込みにも入らない');
  ok(+(r.stat||{}).wipeN===1&&+(r.stat||{}).wipeQty===415,
     '★★★目安には「一度に消えた」として出る');
}

console.log('\n=== ③ ふつうの減りは今までどおり「売れた」===');
{
  const env=env0();
  await cfg(env,{});
  await impo(env,'2026-11-01T00:00:00Z',F.concat([row({jan:J,stock:40})]));
  await impo(env,'2026-11-02T00:00:00Z',F.concat([row({jan:J,stock:30})]));
  await impo(env,'2026-11-03T00:00:00Z',F.concat([row({jan:J,stock:0})]));
  const s=await stat(env,J);
  console.log('   '+JSON.stringify({ down:s.down_qty, wipe:s.wipe_qty }));
  /* 40→30 は 10点の「減った」。30→0 は 30点で 50点に届かないので
     これも「減った」（売れたと数える）。 */
  ok(+s.down_qty===40&&+s.wipe_n===0,
     '★★★しきい値に届かない減りは今までどおり売れた数に入れる');
}

console.log('\n=== ④ CSV から行がなくなった回（大きさを問わない）===');
{
  const env=env0();
  await cfg(env,{});
  await impo(env,'2026-11-01T00:00:00Z',F.concat([row({jan:J,stock:415})]));
  /* 取り込みの最後に知らせを送るので、その回の埋め込みをそのまま見る。 */
  emb=[];
  await impo(env,'2026-11-02T00:00:00Z',F);           // J が CSV から消える
  const s=await stat(env,J);
  console.log('   '+JSON.stringify({ down:s.down_qty, wipe_n:s.wipe_n,
    wipe_q:s.wipe_qty, gone:s.gone_n }));
  ok(+s.down_qty===0,'★★★売れた数には数えない');
  ok(+s.wipe_n===1&&+s.wipe_qty===415,'★★★一度に消えた扱いで控える');
  ok(+s.gone_n===1,'★欠品の回数は今までどおり積む');
  /* 知らせのカード（社内用）。 */
  console.log('   埋め込み '+emb.length+'個：'
    +emb.map((e)=>e.title).join('／'));
  const card=emb.filter((e)=>String(e.title||'').indexOf(J)>=0
    ||String(e.title||'').indexOf('商品'+J)>=0)[0]||emb[0]||{};
  const fv=(n)=>((card.fields||[]).filter((f)=>f.name===n)[0]||{}).value||'';
  console.log('   MW在庫 '+JSON.stringify(fv('MW在庫'))
    +' 速さ '+JSON.stringify(fv('売れる速さ'))
    +' 一度に '+JSON.stringify(fv('一度に消えた')));
  ok(/0点/.test(fv('MW在庫'))&&!/415点（/.test(fv('MW在庫').slice(0,6)),
     '★★★MW在庫は「今の数」＝0点（415点 と出ていた）');
  ok(/消える前 415点/.test(fv('MW在庫')),
     '★★★消える前の数も書く（どれだけ消えたか分かるように）');
  ok(/一度に消えた/.test(JSON.stringify(card.fields||[])),
     '★★★「一度に消えた」の欄を出す');
  ok(/415点/.test(fv('一度に消えた'))
     &&/売れた数には数えていません/.test(fv('一度に消えた')),
     '★★★数と「売れた数には数えていません」を書く');
  ok(!/点\/日/.test(fv('売れる速さ')),
     '★★★売れる速さに 64.3点/日 と出さない');
  ok(/一度に消えた回しかありません/.test(fv('売れる速さ')),
     '★★「減っていません」ではなく、出せない理由を書く');
}

console.log('\n=== ⑤ CSV の抜けから同じ数で戻った回（【3】）===');
{
  const env=env0();
  await cfg(env,{});
  await impo(env,'2026-11-01T00:00:00Z',F.concat([row({jan:J,stock:415})]));
  await impo(env,'2026-11-02T00:00:00Z',F);                   // 行が抜ける
  await impo(env,'2026-11-03T00:00:00Z',F.concat([row({jan:J,stock:415})]));
  const m=await moves(env,J);
  const s=await stat(env,J);
  console.log('   '+JSON.stringify(m.map((x)=>x.kind))+' '
    +JSON.stringify({ back:s.back_n, back_q:s.back_qty, gone:s.gone_n,
      gone_d:s.gone_days, wipe_n:s.wipe_n, wipe_q:s.wipe_qty }));
  ok(m.some((x)=>x.kind==='csvback'),'★★★「csvback」として記録する');
  ok(+s.back_n===0&&+s.back_qty===0,
     '★★★「戻った」「再入荷」に数えない（CSV の抜けなので）');
  ok(+s.gone_days===0,'★★★欠品していた日数にも足さない');
  ok(+s.gone_n===0&&+s.wipe_n===0&&+s.wipe_qty===0,
     '★★★消えたときに数えた「欠品1回」「一度に消えた」も取り消す');
  ok(+s.down_qty===0,'★売れた数にも入らない');
  /* 数が違って戻ったときは、今までどおり「戻った」。 */
  const e2=env0();
  await cfg(e2,{});
  await impo(e2,'2026-11-01T00:00:00Z',F.concat([row({jan:J2,stock:415})]));
  await impo(e2,'2026-11-02T00:00:00Z',F);
  await impo(e2,'2026-11-03T00:00:00Z',F.concat([row({jan:J2,stock:300})]));
  const s2=await stat(e2,J2);
  console.log('   '+JSON.stringify({ back:s2.back_n, back_q:s2.back_qty,
    gone:s2.gone_n, wipe_n:s2.wipe_n }));
  ok(+s2.back_n===1&&+s2.back_qty===300,
     '★★★数が違って戻ったときは今までどおり「戻った」');
  ok(+s2.gone_n===1&&+s2.wipe_n===1,'★★そのときは欠品の記録も残る');
}

console.log('\n=== ⑥ 列が無い D1（migrate-0055 の前）でも落ちない ===');
{
  const w2=await loadWorker('mwwipe-nocol');
  const e3=env0();
  await e3.DB.prepare('ALTER TABLE mw_stat DROP COLUMN wipe_n').run();
  await e3.DB.prepare('ALTER TABLE mw_stat DROP COLUMN wipe_qty').run();
  const im=async(at,rows)=>(await asJson(await w2.worker.fetch(
    post('/mw/stock',{ at:at, part:1, parts:1, rows_in:rows.length,
      rows:rows }),e3,{}))).body;
  let r=await im('2026-11-01T00:00:00Z',F.concat([row({jan:J,stock:415})]));
  ok(r.ok===true,'★★★取り込みが通る');
  r=await im('2026-11-02T00:00:00Z',F.concat([row({jan:J,stock:0})]));
  console.log('   '+JSON.stringify({ ok:r.ok, moved:r.moved }));
  ok(r.ok===true&&r.moved>0,'★★★記録も続く（列が無いぶんだけ控えない）');
  const s=await e3.DB.prepare(
    `SELECT down_qty FROM mw_stat WHERE jan=?1`).bind(J).first();
  ok(+(s||{}).down_qty===0,
     '★★★列が無くても「売れた数」には入れない（ここが大事）');
  const z=(await asJson(await w2.worker.fetch(get('/mw/move?jan='+J),e3,{}))).body;
  ok(z.ok===true,'★★一覧の口も落ちない');
}
T.done();
