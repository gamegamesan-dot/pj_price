/* Worker：知らせの見込み粗利と「売れる速さ」（7.137・v262）

   起きていたこと（ガンダムブレイカー4［Switch版］・JAN 4582747891760）
     ・見込み粗利 ¥3,685（定価からの目安）… 実際の Amazon 最安値は ¥4,980 で、
       手数料を引けば ¥1,009 ほど。定価×0.85 の目安は**高く出すぎていた**
     ・在庫の変化 48 → 0 点 なのに 売れる速さ「減っていません」

   ① 見込み粗利は3段
      実額 … Amazon の値段 − 実額の手数料
      目安 … Amazon の値段 − 手数料の目安（shared/mwfee.js・⚙の率とFBA）
      未確認 … Amazon の値段が無い行だけ定価からの目安。「Amazon 未確認」と書く
   ② 手数料の目安の式は shared/mwfee.js の1か所だけ（画面と同じもの）
   ③ 売れる速さは、記録を控えたばかりなら「減っていません」と出さない
   ④ 基準の控え直し（7.134）は取り込みのときにも一度だけ走る */
import { harness, loadWorker, makeEnv, asJson, post } from './lib.mjs';
import MWFEE from '../shared/mwfee.js';
const T=harness('Worker：知らせの見込み粗利と売れる速さ（7.137）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwgross');

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
const fields=(t)=>{
  const e=emb.filter((x)=>String(x.title||'').indexOf(t)>=0)[0];
  const m={};
  for(const f of ((e||{}).fields||[]))m[f.name]=String(f.value||'');
  return m;
};
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123' });
const impo=async(env,at,rows)=>(await asJson(await worker.fetch(
  post('/mw/stock',{ at:at, part:1, parts:1, rows_in:rows.length, rows:rows }),
  env,{}))).body;
const row=(o)=>Object.assign({ sha:'Q086', idx:0, kishu:'NS',
  name:'商品'+o.jan, list_price:7700, release:'', cond:'新品',
  wholesale:2600, note:'', ship_text:'即日', ship_days:0 },o);
const amz=(env,jan,o)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,low,fee_total,size_tier,fee_kind,
     checked_at,price_at)
   VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)`)
  .bind(jan,(o.asin||'B0GUN00001'),'ガンダムブレイカー4',
        o.price||null,o.low||null,o.fee||null,o.tier||null,o.kind||'',
        new Date().toISOString()).run();
const JAN='4582747891760';
const fill=(n)=>{ const a=[]; for(let i=0;i<(n||12);i++)
  a.push(row({ jan:'49023709'+String(i).padStart(5,'0'), stock:9 })); return a; };
const ago=(d)=>new Date(Date.now()-d*86400000).toISOString()
  .replace(/\.\d+Z$/,'Z');

console.log('=== ① 手数料の目安（shared/mwfee.js）===');
{
  const g=MWFEE.guess({ kishu:'NS', price:4980 },{});
  console.log('   '+JSON.stringify(g));
  ok(g.rate===15,'★★ゲームの販売手数料は 15%（⚙ mwAmzFeeGame）');
  ok(g.ref===747,'★★★販売手数料＝4,980×15%＝747');
  ok(g.tax===75,'★★手数料の消費税 10%（せどりすと と同じ・6.145）');
  ok(g.fba===289,'★★FBA は小型の目安（配送代行288＋在庫管理1）');
  ok(g.fee===1111,'★★★手数料の目安は 1,111円');
  ok(g.real===false,'★実額ではないと分かる');
  ok(MWFEE.guess({ kishu:'NS' },{})===null,'★値段が無ければ出さない');
  ok(MWFEE.genreOf({ kishu:'FIG' })==='フィギュア','★フィギュアも見分ける');
  ok(MWFEE.guess({ kishu:'FIG', price:4980 },{}).rate===10,
     '★★フィギュアは 10%');
  ok(MWFEE.sizeOf({ kishu:'NS', size_tier:'l' },{})==='l',
     '★★★寸法から出た区分を優先する');
  ok(MWFEE.guess({ kishu:'NS', price:4980 },{ feeGame:8 }).ref===398,
     '★★⚙で率を変えられる');
}

console.log('\n=== ② 粗利の3段（mwNtGrossOf）===');
{
  const r={ wholesale:2600, list_price:7700, kishu:'NS' };
  /* 実額の手数料がある行 */
  const a=W.mwNtGrossOf(Object.assign({},r,{ amz_price:4980, fee_total:1200 }),{});
  console.log('   実額: '+JSON.stringify(a));
  ok(a.src==='real'&&a.gross===920,'★★★実額＝4,980−1,200−2,860');
  /* 値段はあるが手数料が無い行 → 手数料の目安を使う */
  const b=W.mwNtGrossOf(Object.assign({},r,{ amz_price:4980, fee_total:0 }),{});
  console.log('   目安: '+JSON.stringify(b));
  ok(b.src==='guess'&&b.gross===1009,
     '★★★目安＝4,980−1,111−2,860（定価の目安 3,685 ではない）');
  /* カート価格が無くても最安値があれば使う */
  const c=W.mwNtGrossOf(Object.assign({},r,{ amz_price:0, amz_low:4980 }),{});
  ok(c.src==='guess'&&c.price===4980,'★★★カート価格が無ければ最安値を使う');
  /* どちらも無い行だけ定価からの目安 */
  const d=W.mwNtGrossOf(r,{});
  console.log('   未確認: '+JSON.stringify(d));
  ok(d.src==='hope'&&d.gross===null&&d.hope===3685,
     '★★★Amazon が未確認の行だけ定価からの目安（3,685）');
  ok(W.mwNtGrossOf(Object.assign({},r,{ amz_price:4980, fee_total:0 }),
     { mwAmzFeeGame:8 }).gross>1009,'★★⚙の率が知らせにも効く');
}

console.log('\n=== ③ 知らせの文（Discord）===');
{
  const env=env0();
  const F=fill(12);
  await impo(env,ago(3),F.concat([row({jan:JAN,stock:48})]));
  await amz(env,JAN,{ price:4980, low:4980, tier:'s' });   // 手数料は取れていない
  emb=[];
  await impo(env,ago(1),F);                                // JAN が消える（欠品）
  const f=fields('商品'+JAN);
  console.log('   '+JSON.stringify(f));
  ok(/1,009/.test(f['見込み粗利']||''),
     '★★★Amazon 4,980 − 手数料の目安 で出す');
  ok(/手数料の目安/.test(f['見込み粗利']||''),'★★★目安だと分かるように書く');
  ok(!/3,685/.test(JSON.stringify(f)),'★★★定価からの目安は出さない');
  ok(/48 → 0/.test(f['在庫の変化']||''),'★★在庫の変化は 48 → 0');
  ok(!/減っていません/.test(f['売れる速さ']||''),
     '★★★48 → 0 なのに「減っていません」と出さない');
  console.log('   売れる速さ: '+(f['売れる速さ']||''));
  ok(/点\/日/.test(f['売れる速さ']||''),
     '★★★基準（はじめて見た日）から数えて1日あたりを出す');
}

console.log('\n=== ④ Amazon が未確認の行は「未確認」と書く ===');
{
  const env=env0();
  const F=fill(12);
  await impo(env,ago(3),F.concat([row({jan:JAN,stock:48})]));
  emb=[];
  await impo(env,ago(1),F);
  const f=fields('商品'+JAN);
  console.log('   '+JSON.stringify(f));
  ok(/3,685/.test(f['見込み粗利（未確認）']||''),
     '★★★値段が取れていない行だけ定価からの目安');
  ok(/Amazon 未確認/.test(f['見込み粗利（未確認）']||''),
     '★★★「Amazon 未確認」と必ず書く');
  ok(!f['見込み粗利'],'★★欄の名前も「（未確認）」で分ける');
}

console.log('\n=== ⑤ 取り込みのときにも基準を控え直す（7.134）===');
{
  const env=env0();
  const F=fill(12);
  await impo(env,ago(3),F.concat([row({jan:JAN,stock:48})]));
  const t=await env.DB.prepare(
    `SELECT v FROM sync_state WHERE k=?1`).bind(W.MW_BASE_KEY).first();
  console.log('   '+JSON.stringify(t));
  ok(!!t,'★★★取り込みの最後に一度だけ走る（日次を待たない）');
  const st=await env.DB.prepare(
    `SELECT first_at,base_qty FROM mw_stat WHERE jan=?1`).bind(JAN).first();
  console.log('   '+JSON.stringify(st));
  ok(!!st&&!!st.first_at,'★★基準の日時が入る');
}

T.done();
