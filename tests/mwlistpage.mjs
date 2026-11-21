/* Worker：MW の候補一覧を 500件より先まで読む（8.84・カジの依頼）

   カジの報告
   「MW の候補の読み込みが 500件で頭打ち。未出品370件のうち出品候補は5件しか
     残っておらず、毎回10件に届かない」

   ・GET /mw/list は1回に 500件まで（今までどおり）。続きは offset で読む
   ・ページをつないでも**抜け・重なりが出ない**（同じ卸値の行の順番を固定）
   ・lite=1 の続きのページは、行と件数だけ返す（数え直さない）
   ・offset を付けない呼び方は今までと同じ中身を返す
   ・相場の調査（POST /mw/market）は今までどおり**候補ぜんぶ**から 120件ずつ。
     500件より先の行も「未調査」として拾う */
import { harness, loadWorker, makeEnv, get, asJson } from './lib.mjs';
const T=harness('Worker：MW の候補一覧のページ読み（8.84）');
const ok=T.ok;
const { worker }=await loadWorker('mwlistpage');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  EBAY_CLIENT_ID:'cid', EBAY_CLIENT_SECRET:'sec' });
let browseCalls=[];
globalThis.fetch=async(u)=>{
  const url=String(u);
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({ access_token:'tok', expires_in:7200 }),{status:200});
  if(/item_summary\/search/.test(url)){
    browseCalls.push(new URL(url).searchParams.get('gtin'));
    return new Response(JSON.stringify({ total:0, itemSummaries:[] }),{status:200});
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
const put=async(path,body)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
const list=async(q)=>(await asJson(await worker.fetch(get('/mw/list'+q),env))).body;

/* 1,230件の候補を入れる。卸値は 40種類だけにして、**同じ卸値の行が
   ページの境目にまたがる**ようにする（順番が決まっていないと重なる）。 */
const N=1230;
const jan=(i)=>'49'+String(10000000000+i);
const rows=[];
for(let i=0;i<N;i++)
  rows.push({ jan:jan(i), sha:'MC02', idx:0, kishu:'NS', name:'商品'+i,
    list_price:5000, release:'2025/01/01', cond:'新品',
    wholesale:1000+(i%40)*50, stock:9, note:'', ship_text:'即日出荷', ship_days:0 });
console.log('=== 在庫を入れる（'+N+'件）===');
{
  const CH=400;
  let res=null;
  for(let i=0;i<rows.length;i+=CH){
    res=await put('/mw/stock',{ rows:rows.slice(i,i+CH), begin:i===0,
      done:i+CH>=rows.length, total:rows.length, part:Math.floor(i/CH) });
    if(res.status!==200){ console.log('   '+JSON.stringify(res.body).slice(0,300)); break; }
  }
  ok(res&&res.status===200,'★在庫を入れられた');
}
const Q='?kishu=NS&ship_max=4&stock_min=2';

console.log('\n=== ① 今までの呼び方（offset なし）は 500件まで ===');
const p0=await list(Q+'&limit=500');
console.log('   n='+p0.n+' rows='+p0.rows.length+' limit='+p0.limit+' offset='+p0.offset);
ok(p0.n===N,'★★★候補の件数は全部（'+N+'件）を返す');
ok(p0.rows.length===500&&p0.limit===500,'★★★1回に返すのは 500件まで（今までどおり）');
ok(p0.offset===0,'★offset は 0');
ok(!!p0.mkt&&p0.alive===N&&'last' in p0&&'csv' in p0,
   '★★1ページ目は相場の進み具合・前回の取り込みも返す（今までどおり）');
{
  const big=await list(Q+'&limit=99999');
  ok(big.rows.length===500,'★★★limit を大きく書いても1回 500件で止まる');
}

console.log('\n=== ② 続きを offset で読む ===');
const p1=await list(Q+'&limit=500&offset=500&lite=1');
const p2=await list(Q+'&limit=500&offset=1000&lite=1');
const p3=await list(Q+'&limit=500&offset=1500&lite=1');
console.log('   '+[p1,p2,p3].map((d)=>d.rows.length+'件').join(' / '));
ok(p1.rows.length===500&&p2.rows.length===230,'★★★2ページ目 500件・3ページ目 230件');
ok(p3.rows.length===0&&p3.ok===true,'★★終わりの先は 0件（落ちない）');
ok(p1.n===N&&p1.lite===true&&p1.offset===500,'★続きのページも件数と offset を返す');
ok(p1.mkt===undefined&&p1.csv===undefined&&p1.last===undefined,
   '★★lite=1 は数え直さない（相場の進み具合などは1ページ目だけ）');
{
  const all=p0.rows.concat(p1.rows,p2.rows);
  const set=new Set(all.map((r)=>r.jan));
  console.log('   つないだ行 '+all.length+'／JAN の種類 '+set.size);
  ok(all.length===N&&set.size===N,
     '★★★つないで '+N+'件・重なりも抜けも無い（同じ卸値がまたがっても）');
  let sorted=true;
  for(let i=1;i<all.length;i++)
    if(all[i-1].wholesale>all[i].wholesale)sorted=false;
  ok(sorted,'★★★並びは今までどおり卸値の安い順');
  ok(all[600].name!==undefined&&'mkt_at' in all[600]&&'pics_ok' in all[600],
     '★★続きのページの行も、1ページ目と同じ列を持つ');
}
{
  const a=await list(Q+'&limit=500&offset=abc');
  ok(a.offset===0&&a.rows.length===500,'★おかしな offset は 0 として読む');
}

console.log('\n=== ③ 相場の調査は今までどおり 120件ずつ・候補ぜんぶから ===');
{
  const r=(await put('/mw/market',{ kishu:'NS', ship_max:4, stock_min:2 })).body;
  console.log('   asked='+r.asked+' done='+r.done+' left='+r.left+' stopped='+r.stopped);
  ok(r.asked===N,'★★★未調査は候補ぜんぶ（500件より先も入る）');
  ok(r.done===120&&r.limit===120,'★★★1回に調べるのは 120件（変えていない）');
  ok(r.left===N-120,'★残りを返す');
  /* 500件より先の行だけを残して調べ終わったことにすると、次の回はそこを拾う。 */
  const firstJans=p0.rows.map((x)=>x.jan);
  const now=new Date().toISOString();
  for(const j of firstJans)
    await env.DB.prepare(
      `INSERT INTO mw_market (jan,n,err,checked_at,created_at) VALUES (?1,0,'',?2,?2)
       ON CONFLICT(jan) DO UPDATE SET checked_at=excluded.checked_at, err=''`)
      .bind(j,now).run();
  browseCalls=[];
  const r2=(await put('/mw/market',{ kishu:'NS', ship_max:4, stock_min:2 })).body;
  const firstSet=new Set(firstJans);
  const beyond=browseCalls.filter((j)=>!firstSet.has(j)).length;
  console.log('   2回目 done='+r2.done+'／うち 500件より先の行 '+beyond);
  ok(r2.done===120&&beyond===120,
     '★★★500件より先の行が「未調査」として順に調べられる');
  ok(browseCalls.filter((j)=>firstSet.has(j)).length===0,
     '★★★調べたばかりの行（7日以内）は調べ直さない');
  const d=await list(Q+'&limit=500');
  ok(d.mkt.per_run===120&&d.mkt.ttl_days===7,'★★画面に渡す値も 120件・7日のまま');
}
T.done();
