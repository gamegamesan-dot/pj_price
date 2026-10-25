/* Worker：MW の在庫CSV（7.60・段取りA）
   ・主キーは連番。差分の突き合わせは (jan, sha, idx)。同じ (jan,社) の行も残る
   ・変わった行だけ UPSERT（row_hash）。同じ行は seen_at だけ新しくする
   ・欠品は「今回の取り込みに現れなかった行」。30%以上減ったら欠品にせず警告
   ・JAN ごとに1つ選ぶ（出荷4営業日以内 → 卸値が安い → 在庫が多い → 出荷が早い）
   ・候補一覧は 4章の1〜4（機種・新品・出荷・在庫）で絞った代表の行だけ
   ・作業者のキーでは取り込めない */
import { harness, loadWorker, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：MW の在庫');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwstock');
const env=makeEnv({ STAFF_KEY:'staff-key-123' });
globalThis.fetch=async(u)=>{ throw new Error('外へ出てはいけない: '+u); };

const put=async(body,key)=>asJson(await worker.fetch(new Request('https://x/mw/stock',
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
const list=async(q)=>(await asJson(await worker.fetch(
  get('/mw/list'+(q||'')),env))).body;
const row=(jan,sha,x)=>Object.assign({jan:jan,sha:sha,idx:0,kishu:'NS',
  name:jan+'の商品',list_price:5000,release:'2025/01/01',cond:'新品',
  wholesale:3000,stock:5,note:'',ship_text:'即日出荷',ship_days:0},x||{});
const all=async()=>(await env.DB.prepare(
  `SELECT jan,sha,idx,wholesale,stock,pick,seen_at,gone_at FROM mw_stock
    ORDER BY jan,sha,idx`).all()).results;

console.log('=== 1行ぶんの整え方（mwRow）===');
ok(W.mwRow({jan:'4902370550467',sha:'M200'})!==null,'★13桁のJANは通る');
ok(W.mwRow({jan:'49023705504',sha:'M200'})===null,'★★13桁でないJANは落とす');
ok(W.mwRow({jan:'4902370550467',sha:''})===null,'★★社が空の行は落とす');
ok(W.mwRow({jan:'="4902370550467"',sha:'M200'})!==null,
   '★★利益CSVの ="…" の形も読める');
const h1=W.mwHash(W.mwRow(row('4902370550467','M200')));
const h2=W.mwHash(W.mwRow(row('4902370550467','M200',{stock:9})));
ok(h1!==h2,'★★中身が変わればハッシュも変わる');
ok(h1===W.mwHash(W.mwRow(row('4902370550467','M200'))),'★同じ中身は同じハッシュ');

console.log('\n=== はじめての取り込み ===');
let r=await put({ at:'2026-10-25T01:00:00Z', part:1, parts:1, rows:[
  row('4902370550467','M200'),
  row('4902370550467','Co52',{wholesale:2800,stock:1,ship_days:2}),
  row('4902370550467','M200',{idx:1,wholesale:3100,stock:300}),   // 同じ(jan,社)
  row('4573591750617','M200',{wholesale:4034,kishu:'NS',stock:12}),
  row('4580416924740','MC02',{wholesale:16082,kishu:'b2cchara_figure',
    stock:4,ship_text:'ご注文より3．4営業日',ship_days:4}),
  row('4970381909444','Q061',{wholesale:300,kishu:'seal',stock:200}),
], rows_in:6, unreadable:0 });
console.log('   '+JSON.stringify({added:r.body.added,same:r.body.same,
  picked:r.body.picked,taken:r.body.taken}));
ok(r.status===200&&r.body.added===6,'★★6行すべて足す');
ok(r.body.taken===6&&r.body.skipped===0,'★落ちた行は無い');
let rows=await all();
ok(rows.length===6,'★★同じ (jan,社) の行も消えずに残る（idx で分ける）');
ok(rows.filter((x)=>x.jan==='4902370550467').length===3,'★★同じJANの3行が残る');

console.log('\n=== JANごとに1つ選ぶ ===');
let pick=rows.filter((x)=>x.pick===1);
console.log('   代表: '+JSON.stringify(pick.map((x)=>x.jan+'/'+x.sha+'/'+x.wholesale)));
ok(pick.length===4,'★★JANの数（4）だけ選ばれる');
const p1=pick.find((x)=>x.jan==='4902370550467');
ok(p1.sha==='Co52'&&p1.wholesale===2800,
   '★★出荷4営業日以内のうち卸値が安い社（Co52 2800円）を選ぶ');

console.log('\n=== 同じ中身をもう一度送る（差分書き込み）===');
r=await put({ at:'2026-10-25T04:00:00Z', part:1, parts:1, rows:[
  row('4902370550467','M200'),
  row('4902370550467','Co52',{wholesale:2800,stock:1,ship_days:2}),
  row('4902370550467','M200',{idx:1,wholesale:3100,stock:300}),
  row('4573591750617','M200',{wholesale:4034,kishu:'NS',stock:12}),
  row('4580416924740','MC02',{wholesale:16082,kishu:'b2cchara_figure',
    stock:4,ship_text:'ご注文より3．4営業日',ship_days:4}),
  row('4970381909444','Q061',{wholesale:300,kishu:'seal',stock:200}),
], rows_in:6 });
console.log('   '+JSON.stringify({added:r.body.added,changed:r.body.changed,
  same:r.body.same,gone:r.body.gone}));
ok(r.body.same===6&&r.body.added===0&&r.body.changed===0,
   '★★中身が同じ行は書き換えない（seen_at だけ）');
ok(r.body.gone===0,'★欠品にしない');

console.log('\n=== 卸値が変わった行だけ書く ===');
r=await put({ at:'2026-10-25T07:00:00Z', part:1, parts:1, rows:[
  row('4902370550467','M200'),
  row('4902370550467','Co52',{wholesale:2500,stock:1,ship_days:2}),  // 下がった
  row('4902370550467','M200',{idx:1,wholesale:3100,stock:300}),
  row('4573591750617','M200',{wholesale:4034,kishu:'NS',stock:12}),
  row('4580416924740','MC02',{wholesale:16082,kishu:'b2cchara_figure',
    stock:4,ship_text:'ご注文より3．4営業日',ship_days:4}),
  row('4970381909444','Q061',{wholesale:300,kishu:'seal',stock:200}),
], rows_in:6 });
console.log('   '+JSON.stringify({changed:r.body.changed,same:r.body.same}));
ok(r.body.changed===1&&r.body.same===5,'★★変わった1行だけ書き換える');
rows=await all();
ok(rows.find((x)=>x.sha==='Co52').wholesale===2500,'★新しい卸値になる');

console.log('\n=== 欠品（CSV から消えた行）===');
r=await put({ at:'2026-10-25T10:00:00Z', part:1, parts:1, rows:[
  row('4902370550467','M200'),
  row('4902370550467','Co52',{wholesale:2500,stock:1,ship_days:2}),
  row('4902370550467','M200',{idx:1,wholesale:3100,stock:300}),
  row('4573591750617','M200',{wholesale:4034,kishu:'NS',stock:12}),
  row('4580416924740','MC02',{wholesale:16082,kishu:'b2cchara_figure',
    stock:4,ship_text:'ご注文より3．4営業日',ship_days:4}),
], rows_in:5 });   // seal の1行が消えた（6行→5行＝17%減なので欠品にする）
console.log('   '+JSON.stringify({gone:r.body.gone,warn:r.body.warn}));
ok(r.body.gone===1&&!r.body.warn,'★★消えた1行を欠品にする');
rows=await all();
ok(!!rows.find((x)=>x.jan==='4970381909444').gone_at,'★欠品の時刻が入る');
ok(rows.filter((x)=>x.pick===1).length===3,'★★欠品した行は代表から外れる');

console.log('\n=== 行数が30%以上減ったら欠品にしない（取得ミス）===');
r=await put({ at:'2026-10-25T13:00:00Z', part:1, parts:1, rows:[
  row('4902370550467','M200'),
], rows_in:1 });
console.log('   '+(r.body.warn||'').slice(0,80));
ok(r.body.gone===0&&/欠品にしていません/.test(r.body.warn||''),
   '★★欠品にせず警告だけ出す');
rows=await all();
ok(rows.filter((x)=>x.gone_at).length===1,'★★前の欠品1行のまま（増えない）');

console.log('\n=== 欠品から戻る ===');
r=await put({ at:'2026-10-25T16:00:00Z', part:1, parts:1, rows:[
  row('4902370550467','M200'),
  row('4902370550467','Co52',{wholesale:2500,stock:1,ship_days:2}),
  row('4902370550467','M200',{idx:1,wholesale:3100,stock:300}),
  row('4573591750617','M200',{wholesale:4034,kishu:'NS',stock:12}),
  row('4580416924740','MC02',{wholesale:16082,kishu:'b2cchara_figure',
    stock:4,ship_text:'ご注文より3．4営業日',ship_days:4}),
  row('4970381909444','Q061',{wholesale:300,kishu:'seal',stock:200}),
], rows_in:6 });
console.log('   '+JSON.stringify({back:r.body.back,changed:r.body.changed}));
ok(r.body.back===1,'★★戻った行を数える');
rows=await all();
ok(!rows.find((x)=>x.jan==='4970381909444').gone_at,'★欠品の時刻が消える');

console.log('\n=== 分けて送る（part / parts）===');
await env.DB.prepare('DELETE FROM mw_stock').run();
await env.DB.prepare('DELETE FROM mw_runs').run();
const AT='2026-10-25T19:00:00Z';
r=await put({ at:AT, part:1, parts:2, rows:[row('4902370550467','M200')],
  rows_in:2 });
ok(r.body.picked===0,'★★途中の便では代表選びをしない');
r=await put({ at:AT, part:2, parts:2, rows:[row('4573591750617','M200')],
  rows_in:2 });
console.log('   '+JSON.stringify({picked:r.body.picked,seen:r.body.seen}));
ok(r.body.picked===2,'★★最後の便で代表を選ぶ');
ok(r.body.seen===2,'★今回現れた行数を返す');
let runs=(await env.DB.prepare(
  `SELECT at,rows_in,added,picked FROM mw_runs ORDER BY id DESC LIMIT 1`).first());
ok(runs.at===AT&&runs.rows_in===2&&runs.picked===2,'★★取り込みの記録を残す');

console.log('\n=== 候補一覧（4章の1〜4）===');
await env.DB.prepare('DELETE FROM mw_stock').run();
await put({ at:'2026-10-26T01:00:00Z', part:1, parts:1, rows:[
  row('4902370550467','M200',{kishu:'NS',cond:'新品',stock:5,ship_days:0}),
  row('4573591750617','M200',{kishu:'NS',cond:'新品',stock:1,ship_days:0}),  // 在庫1
  row('4580416924740','MC02',{kishu:'b2cchara_figure',cond:'新品',stock:4,
    ship_days:4}),
  row('4970381909444','Q061',{kishu:'seal',cond:'新品',stock:200,ship_days:0}),
  row('4988611224878','E027',{kishu:'NS',cond:'新古',stock:8,ship_days:0}),
  row('4560228206524','MC02',{kishu:'NS',cond:'新品',stock:9,ship_days:6}),
], rows_in:6 });
let d=await list('?kishu=NS,NS2,NS2H,P5,P4,b2cchara_figure&new_only=1'
  +'&ship_max=4&stock_min=2&limit=100');
console.log('   '+JSON.stringify({n:d.n,alive:d.alive,picked:d.picked,
  jans:d.rows.map((x)=>x.jan+'/'+x.kishu+'/'+x.stock+'/'+x.ship_days)}));
ok(d.n===2,'★★機種・新品・出荷4以内・在庫2以上の2件だけ');
ok(d.rows.some((x)=>x.jan==='4902370550467')
   &&d.rows.some((x)=>x.jan==='4580416924740'),'★★その2件が返る');
ok(!d.rows.some((x)=>x.kishu==='seal'),'★★対象外の機種は出ない');
ok(!d.rows.some((x)=>x.cond==='新古'),'★★新古は出ない（既定）');
ok(!d.rows.some((x)=>x.ship_days>4),'★★出荷が5営業日以上は出ない');
ok(!d.rows.some((x)=>x.stock<2),'★★在庫1点は出ない');
ok(d.alive===6&&d.picked===6,'★生きている行と代表の数も返す');
ok(!!d.last&&!!d.last.at_jst,'★★前回の取り込みを日本時間で返す');
d=await list('?new_only=0&ship_max=99&stock_min=1&limit=100');
ok(d.n===6,'★★条件を緩めれば全部出る');

console.log('\n=== 作業者のキー ===');
r=await put({ at:'2026-10-26T04:00:00Z', part:1, parts:1,
  rows:[row('4902370550467','M200')] },'staff-key-123');
console.log('   '+JSON.stringify(r.body));
ok(r.status===403&&r.body.error==='forbidden_for_staff',
   '★★作業者のキーでは取り込めない');
let dl=await asJson(await worker.fetch(new Request('https://x/mw/list',
  {headers:{'X-PJ-Key':'staff-key-123'}}),env));
ok(dl.status===200,'★候補一覧は読めてよい（読み取りだけ）');

console.log('\n=== 1回に送れる行数 ===');
ok(W.MW_CHUNK===400,'★1回400行まで');
r=await put({ at:'2026-10-26T07:00:00Z', part:1, parts:1,
  rows:new Array(401).fill(0).map((_,i)=>row(
    String(4900000000000+i),'M200')) });
ok(r.body.error==='too_many','★★超えたら断る');

await T.done();
