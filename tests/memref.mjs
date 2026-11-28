/* Worker：会員の紹介者と紹介のお礼（8.118・カジの依頼）

   ・紹介者は呼び名か紹介コードだけ（氏名・住所・メールは入れない）。英字は大文字にそろえる
   ・「手でつなぐ」で入れられる（空なら今の紹介者のまま）・一覧の各行から直せる（POST /mem/ref）
   ・「本人」＝紹介者なし（本人）の印。…5347 は移行で「本人」に（その会員が1人のときだけ）
   ・紹介者ごとの集計：紹介した人数・いま有料の人数・プラン別
   ・お礼：有料プランの支払いの注文の金額 × ⚙の率（既定40%）、会員ごとに最初の有料の支払いから
     ⚙の最長の月数（既定12）まで。モニターは数えない。月は日本時間の支払いの月。
     金額が分からない注文は足さずに数だけ */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：会員の紹介者と紹介のお礼（8.118）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('memref');
globalThis.fetch=async()=>new Response('{}',{status:200});
const env=makeEnv({ STAFF_KEY:'staff-key-123' });
const api=async(path,body)=>(await asJson(await worker.fetch(body?post(path,body):get(path),env,{}))).body;
const setCfg=(o)=>env.DB.prepare(
  `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)
   ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`)
  .bind(JSON.stringify({ at:new Date().toISOString(), settings:Object.assign({ memOn:false }, o||{}) }),
        new Date().toISOString()).run();
await setCfg();
const iso=(d)=>new Date(Date.now()+d*86400000).toISOString();

console.log('=== ① 紹介者の欄の確かめ ===');
{
  ok(W.memRefNorm('nakano').ref==='NAKANO','★★英字は大文字にそろえる（同じ人を1つに数える）');
  ok(W.memRefNorm('ＮＡＫＡＮＯ').ref==='NAKANO','★全角も半角にそろえる');
  ok(W.memRefNorm('本人').ref==='（本人）','★★★「本人」は紹介者なし（本人）の印');
  ok(W.memRefNorm('').ok&&W.memRefNorm('').ref==='','★空はまだ入れていない');
  ok(!W.memRefNorm('taro@example.com').ok,'★★★メールは入れられない');
  ok(!W.memRefNorm('山田 太郎').ok,'★★★空白の入った名前（氏名）は入れられない');
  ok(!W.memRefNorm('東京都新宿区1-2-3 ビル').ok,'★★住所のような長い文は入れられない');
  ok(W.memRefNorm('ナカノ').ok&&W.memRefNorm('K_2').ok,'★呼び名（かな）・記号の少ないコードは入れられる');
}

console.log('=== ② 手でつなぐ・一覧から直す ===');
{
  let r=await api('/mem/link',{ cust:'7000000001', dc:'111', plan:'monitor', ref:'nakano' });
  ok(r.ok&&r.row&&r.row.ref_code==='NAKANO','★★★手でつなぐときに紹介者を入れられる');
  r=await api('/mem/link',{ cust:'7000000001', dc:'111', plan:'light' });
  ok(r.ok&&r.row.ref_code==='NAKANO','★★★紹介者を空のままつなぎ直しても、今の紹介者は消えない');
  r=await api('/mem/link',{ cust:'7000000009', dc:'999', ref:'a@b.jp' });
  ok(r.error==='bad_ref'&&!(await env.DB.prepare(`SELECT 1 FROM mem WHERE cust='7000000009'`).first()),
     '★★★メールなどを入れたら断って、つながない');
  r=await api('/mem/ref',{ cust:'7000000001', ref:'Sato' });
  ok(r.ok&&r.ref==='SATO','★★★一覧の行から紹介者を直せる');
  const log=await env.DB.prepare(`SELECT kind FROM mem_log WHERE cust='7000000001' AND kind='ref'`).first();
  ok(!!log,'★直したことを記録に残す');
  r=await api('/mem/ref',{ cust:'7000000001', ref:'' });
  ok(r.ok&&!(await env.DB.prepare(`SELECT ref_code FROM mem WHERE cust='7000000001'`).first()).ref_code,
     '★★空にすると紹介者を消せる');
  r=await api('/mem/ref',{ cust:'7999999999', ref:'X' });
  ok(r.error==='no_mem','★いない会員は直せない');
}

console.log('=== ③ 紹介者ごとの集計 ===');
const mem=async(c,plan,state,to,ref)=>env.DB.prepare(
  `INSERT INTO mem (cust,dc,plan,paid_to,state,mon_from,ref_code,at,created_at)
   VALUES (?1,?1,?2,?3,?4,?5,?6,?7,?7) ON CONFLICT(cust) DO UPDATE SET plan=excluded.plan,
   paid_to=excluded.paid_to, state=excluded.state, ref_code=excluded.ref_code`)
  .bind(c,plan,to,state,plan==='monitor'?iso(-2):'',ref,iso(-1)).run();
await mem('7000000001','light','active',iso(20),'NAKANO');
await mem('7000000002','premium','active',iso(10),'NAKANO');
await mem('7000000003','standard','active',iso(-30),'NAKANO');      // 期限切れ（いま有料ではない）
await mem('7000000004','monitor','active',iso(19),'NAKANO');       // モニター
await mem('7000000005','standard','active',iso(5),'SATO');
await mem('7000005347','premium','active',iso(25),'（本人）');
await mem('7000000006','light','active',iso(25),null);
let d=await api('/mem');
const nk=(d.refs.list||[]).filter((x)=>x.ref==='NAKANO')[0]||{};
console.log('   '+JSON.stringify(d.refs));
ok(d.ref_col===true&&nk.n===4,'★★★紹介者ごとに紹介した人数（NAKANO 4人）');
ok(nk.paid===2&&nk.plans.light===1&&nk.plans.premium===1&&nk.plans.standard===0,
   '★★★いま有料プランの人数とプラン別（期限切れは数えない）');
ok(nk.plans.monitor===1,'★モニターは有料には数えず、別に出す');
ok(d.refs.self===1&&!(d.refs.list||[]).some((x)=>x.ref==='（本人）'),'★★紹介者なし（本人）は集計に入れず、人数だけ');
ok((d.rows||[]).some((r)=>r.cust4==='5347'&&r.ref==='（本人）'),'★★一覧の各行に紹介者を出す');

console.log('=== ④ お礼（月ごと・率40%・最長12か月・モニターは数えない）===');
{
  const ord=(id,c,plan,yen,at)=>env.DB.prepare(
    `INSERT INTO mem_order (order_id,cust,plan,yen,at,created_at) VALUES (?1,?2,?3,?4,?5,?5)`)
    .bind(id,c,plan,yen,at).run();
  /* …0001：ライト ¥1,980 を14か月（13か月目からは数えない） */
  for(let i=0;i<14;i++){
    const m=new Date(Date.UTC(2025,10+i,10,3,0,0)).toISOString();
    await ord('o1-'+i,'7000000001','light',1980,m);
  }
  /* …0002：2026-11 にプレミアム ¥9,800・月末の夜（日本時間では12月） */
  await ord('o2-a','7000000002','premium',9800,'2026-11-05T03:00:00Z');
  await ord('o2-b','7000000002','premium',9800,'2026-11-30T16:30:00Z');
  /* …0004：モニターの注文（数えない） */
  await ord('o4-a','7000000004','monitor',500,'2026-11-05T03:00:00Z');
  /* …0005：スタンダード（金額が分からない注文） */
  await ord('o5-a','7000000005','standard',0,'2026-11-06T03:00:00Z');
  await ord('o5-b','7000000005','standard',4980,'2026-10-06T03:00:00Z');
  /* …5347：本人（お礼の対象外） */
  await ord('o9-a','7000005347','premium',9800,'2026-11-05T03:00:00Z');
  d=await api('/mem');
  const ms=d.ref_pay.months||[];
  const M=(m)=>ms.filter((x)=>x.month===m)[0]||{ rows:[] };
  const R=(m,ref)=>(M(m).rows||[]).filter((x)=>x.ref===ref)[0]||{};
  console.log('   '+ms.slice(0,5).map((m)=>m.month+' ¥'+m.pay+' '+m.rows.map((r)=>r.ref+':'+r.pay+'/'+r.n+'/'+r.yen+'/'+r.unknown).join(',')).join(' ／ '));
  ok(d.ref_rate===40&&d.ref_months===12,'★★★⚙の既定は率40%・最長12か月');
  ok(R('2026-10','NAKANO').yen===1980&&R('2026-10','NAKANO').pay===Math.round(1980*0.4)
     &&R('2026-11','NAKANO').yen===9800&&R('2026-11','NAKANO').pay===Math.round(9800*0.4),
     '★★★月ごとに紹介者ごとのお礼（支払いの金額 × 40%）');
  ok(R('2026-12','NAKANO').n===1&&R('2026-12','NAKANO').yen===9800,'★★月は日本時間の支払いの月（11/30 の夜は12月）');
  const all1=ms.reduce((t,m)=>t+((m.rows||[]).filter((r)=>r.ref==='NAKANO').reduce((u,r)=>u+r.n,0)),0);
  ok(all1===12+2,'★★★会員ごとに最長12か月まで（…0001 は14回払っても12回、…0002 は2回）');
  ok(R('2026-11','NAKANO').n===1&&R('2025-11','NAKANO').n===1,'★★★…0001 は 2025-11 から12回（2026-10 まで）。13回目の 2026-11 は数えない');
  ok(!ms.some((m)=>(m.rows||[]).some((r)=>r.yen===500||r.yen===9800+500)),'★★★モニターの注文は数えない');
  ok(R('2026-11','SATO').unknown===1&&R('2026-11','SATO').yen===0&&M('2026-11').unknown===1,
     '★★金額が分からない支払いは足さずに件数だけ（推測で入れない）');
  ok(R('2026-10','SATO').pay===Math.round(4980*0.4),'★スタンダードの月');
  ok(!ms.some((m)=>(m.rows||[]).some((r)=>r.ref==='（本人）')),'★★★紹介者なし（本人）はお礼の対象外');
  ok(M('2026-11').pay===(M('2026-11').rows||[]).reduce((t,r)=>t+r.pay,0),'★月の合計');
  await setCfg({ memRefRate:30, memRefMonths:1 });
  d=await api('/mem');
  const all2=(d.ref_pay.months||[]).reduce((t,m)=>t+((m.rows||[]).filter((r)=>r.ref==='NAKANO').reduce((u,r)=>u+r.n,0)),0);
  ok(d.ref_rate===30&&all2===2,'★★⚙で率と最長の月数を変えられる（1か月なら …0001 と …0002 の最初の1回ずつ）');
  await setCfg();
}

console.log('=== ⑤ 移行（…5347 だけ本人）・残さないもの ===');
{
  const sql=fs.readFileSync(new URL('../proxy-sync/migrate-0079-mem-ref.sql',import.meta.url),'utf8');
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE mem (cust TEXT PRIMARY KEY, plan TEXT)`);
  db.exec(`INSERT INTO mem (cust,plan) VALUES ('1111115347','light'),('2222220001','premium'),('3333330002','monitor')`);
  db.exec(sql);
  const rows=db.prepare(`SELECT cust, ref_code FROM mem ORDER BY cust`).all();
  ok(rows[0].ref_code==='（本人）'&&!rows[1].ref_code&&!rows[2].ref_code,'★★★…5347 だけ「紹介者なし（本人）」・ほかは空のまま');
  const db2=new DatabaseSync(':memory:');
  db2.exec(`CREATE TABLE mem (cust TEXT PRIMARY KEY, plan TEXT)`);
  db2.exec(`INSERT INTO mem (cust,plan) VALUES ('1111115347','light'),('9999995347','light')`);
  db2.exec(sql);
  ok(db2.prepare(`SELECT COUNT(*) AS n FROM mem WHERE ref_code IS NOT NULL`).get().n===0,
     '★★下4桁が 5347 の会員が2人いたら、どちらにも入れない（取り違えない）');
  ok(!/name|mail|address|price/i.test(sql.replace(/--.*$/gm,'')),'★★★氏名・メール・住所・金額の列は作らない');
  ok(W.schemaFixOf('ref_code')==='migrate-0079-mem-ref.sql','★列が無いときに流すマイグレーション');
  const src=fs.readFileSync(new URL('../proxy-sync/worker.js',import.meta.url),'utf8');
  ok(!/1980|4980|9800/.test(src.slice(src.indexOf('===== 8.118'),src.indexOf('async function memDel'))),
     '★★★月額の金額は pj に持たせない（お礼は支払いの注文の金額から）');
}
T.done();
