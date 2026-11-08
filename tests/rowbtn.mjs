/* Worker：行ボタンの保存（POST /listings）が全パターンで通る（7.118）
   2026-11-09：販売連携の行ボタンを押すと
   「HTTP 500 server_error /listings 名簿の保存（items の書き替え）で失敗：
     D1_ERROR: Wrong number of parameter bindings for SQL query.」
   原因：items の UPDATE が `?45` を使っているのに、bind は42個しか渡していなかった。
   SQLite は **いちばん大きい番号**で「いくつ要るか」を数えるので、
   番号に抜け（42・43・44）があると「45個よこせ」になり、ぜんぶ落ちる。
   ・?N は 1 から詰めて使う（抜けを作らない・番号なしの ? と混ぜない）
   ・画面の行ボタンが送る中身を**ぜんぶ**押して、200 で通ることを確かめる
   ・区分（新品・中古・-U・-C・-L・W-）を変えても同じことを確かめる */
import { harness, loadWorker, makeEnv, post, asJson, wantBinds, WORKER }
  from './lib.mjs';
import fs from 'node:fs';
const T=harness('Worker：行ボタンの保存（/listings）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('rowbtn');
const src=fs.readFileSync(WORKER,'utf8');

console.log('=== ? の数を数える（本物の SQLite と同じ）===');
ok(wantBinds('UPDATE t SET a=?45 WHERE b=?1')===45,
   '★★★番号に抜けがあると「いちばん大きい番号」ぶん要る（これが原因だった）');
ok(wantBinds('UPDATE t SET a=?3 WHERE b=?1 AND c=?2')===3,'★詰めてあれば番号の数');
ok(wantBinds('INSERT INTO t VALUES (?,?,?)')===3,'★番号なしは個数');
ok(wantBinds("SELECT '?9', ?1 FROM t")===1,'★★文字列の中の ? は数えない');
ok(wantBinds("SELECT ?1 FROM t WHERE a NOT LIKE ? ESCAPE '\\' AND b=?")===3,
   "★★★ESCAPE '\\' のあとも数えられる（SQL の文字列は \\ では逃がせない）");
ok(wantBinds('SELECT ?1 /* ?9 */ FROM t')===1
   &&wantBinds('SELECT ?1 -- ?9\n FROM t')===1,'★★コメントの中も数えない');
ok(wantBinds('SELECT 1 FROM t')===0,'★? が無ければ0');

console.log('\n=== worker.js の SQL ぜんぶ：番号に抜けが無い（7.118）===');
/* バッククォートの中の SQL をぜんぶ見る。?N を使う文は 1..max が揃っていること。 */
const sqls=[];
{
  const re=/`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  let m;
  while((m=re.exec(src))){
    const s=m[1];
    if(!/\?/.test(s))continue;
    if(!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(s))continue;
    sqls.push({ sql:s, line:src.slice(0,m.index).split('\n').length });
  }
}
console.log('   ? を使う SQL：'+sqls.length+'本');
ok(sqls.length>=150,'★SQL をぜんぶ拾えている（'+sqls.length+'本）');
const holes=[], mixed=[];
for(const x of sqls){
  const nums=[...new Set((x.sql.match(/\?(\d+)/g)||[]).map((y)=>+y.slice(1)))]
    .sort((a,b)=>a-b);
  if(!nums.length)continue;
  const max=nums[nums.length-1];
  for(let i=1;i<=max;i++)
    if(nums.indexOf(i)<0){ holes.push('行'+x.line+' ?'+i+' が無い（max ?'+max+'）'); }
  if(/\?(?!\d)/.test(x.sql))mixed.push('行'+x.line);
}
console.log('   '+JSON.stringify({holes:holes.slice(0,5),mixed:mixed.slice(0,5)}));
ok(holes.length===0,
   '★★★番号に抜けのある SQL が無い（抜けると D1 がぜんぶ落ちる）'
   +(holes.length?('：'+holes.slice(0,3).join('／')):''));
ok(mixed.length===0,
   '★★★?N と番号なしの ? を混ぜている SQL が無い'
   +(mixed.length?('：'+mixed.slice(0,3).join('／')):''));

/* ---- 画面の行ボタンが送る中身（index.html から写したもの）---- */
const BTN=[
  { name:'手元在庫 オン', body:{ on_hand:true }, col:'on_hand', want:1 },
  { name:'手元在庫 オフ', body:{ on_hand:false }, col:'on_hand', want:0 },
  { name:'手元の数 3', body:{ hand_qty:3 }, col:'hand_qty', want:3 },
  { name:'手元の数 0', body:{ hand_qty:0 }, col:'hand_qty', want:0 },
  { name:'一点物 オン', body:{ one_off:true }, col:'one_off', want:1 },
  { name:'一点物 オフ', body:{ one_off:false }, col:'one_off', want:0 },
  { name:'無在庫 オン', body:{ dropship:true }, col:'dropship', want:1 },
  { name:'無在庫 オフ', body:{ dropship:false }, col:'dropship', want:0 },
  { name:'値下げしない オン', body:{ mark_stop:true }, col:'mark_stop', want:1 },
  { name:'値下げしない オフ', body:{ mark_stop:false }, col:'mark_stop', want:0 },
  { name:'eBay優先 オン', body:{ ebay_first:true }, col:'ebay_first', want:1 },
  { name:'eBay優先 オフ', body:{ ebay_first:false }, col:'ebay_first', want:0 },
  { name:'今回は動かさない オン', body:{ pb_skip:true }, col:'pb_skip', want:1 },
  { name:'今回は動かさない オフ', body:{ pb_skip:false }, col:'pb_skip', want:0 },
  { name:'在庫0時：寝かせる', body:{ mode:'hold' }, col:'mode', want:'hold' },
  { name:'在庫0時：再調達', body:{ mode:'restock' }, col:'mode', want:'restock' },
  { name:'在庫0時：終了', body:{ mode:'end' }, col:'mode', want:'end' },
  { name:'在庫0時：未設定に戻す', body:{ mode:'' }, col:'mode', want:null },
  { name:'FBA連動 オン', body:{ fba_link:true }, col:'fba_link', want:1 },
  { name:'値下げを再開（sold_keep=false）', body:{ sold_keep:false },
    col:'sold_keep', want:0 },
  /* 手元在庫をオフにしたときの「Amazon 無在庫で続ける」（6.139）。 */
  { name:'手元在庫オフ＋Amazon無在庫', body:{ on_hand:0, amz_drop:1 },
    col:'restocking', want:1 },
  { name:'手元在庫オフ＋数量0', body:{ on_hand:0, amz_drop:0 },
    col:'on_hand', want:0 },
  /* 再調達中にする／解除（6.67）。付けるときは監視用の数字も一緒に送る。 */
  { name:'再調達中にする', body:{ restocking:true, restock_price:37.71,
    restock_max_cost:2800, restock_skip_acc:1 }, col:'restocking', want:1 },
  { name:'再調達中 解除', body:{ restocking:false }, col:'restocking', want:0 },
  /* 名簿の送信（出品リスト）。価格の元データが一緒に来る形。 */
  { name:'名簿（価格の元データつき）', body:{ weight_g:150, cost_yen:3980,
    sold_usd:60, mark_at:'2026-11-01', search_kw:'mario', one_off:true,
    fba_link:true, mode:'hold', hand_qty:1 }, col:'weight_g', want:150 },
  /* 見直しの目標・自動値下げの設定（管理者だけ。/listings の同じ文を通る）。 */
  { name:'見直しの目標', body:{ rv_want:40, rv_floor:30, rv_max_cost:2500,
    rv_kind:'up' }, col:'rv_want', want:40 },
  { name:'自動値下げの設定', body:{ md_step:1, md_floor:20, md_n:10,
    md_start:58 }, col:'md_step', want:1 },
  { name:'フェイズBの目標', body:{ pb_want:45, pb_max_cost:3000 },
    col:'pb_want', want:45 },
  { name:'再調達中の目標', body:{ rk_want:42, rk_floor:33, rk_low:3000,
    rk_n:2, rk_max_cost:2600 }, col:'rk_want', want:42 },
  { name:'アップロード失敗を消す', body:{ revise_err:'' },
    col:'revise_err', want:null },
];
/* 区分ちがいの行（CustomLabel の形もいっしょに変える）。 */
const ROWS=[
  { name:'新品（E-）', asin:'B0ROW000N1', cond:'new', label:'E-B0ROW000N1' },
  { name:'中古（E-…-U）', asin:'B0035WV8CY', cond:'used',
    label:'E-B0035WV8CY-U' },
  { name:'カートリッジのみ（-C）', asin:'B0ROW000C1', cond:'cart',
    label:'E-B0ROW000C1-C' },
  { name:'フィギュアのみ（-L）', asin:'B0ROW000L1', cond:'loose',
    label:'E-B0ROW000L1-L' },
  { name:'Amazon 無在庫（M-）', asin:'B0ROW000M1', cond:'new',
    label:'M-B0ROW000M1' },
  { name:'MW 無在庫（W-）', asin:'W4562475323733', cond:'new',
    label:'W-4562475323733' },
  { name:'せどりすとSKU', asin:'B0ROW000S1', cond:'used',
    label:'E-B0ROW000S1-U', sku:'game-20261101-UG-B0ROW000S1-2000' },
  { name:'CustomLabel なし（ASIN 指定）', asin:'B0ROW000A1', cond:'new',
    label:'' },
];
const env=makeEnv({ STAFF_KEY:'staff-key-123' });
const col=async(asin,cond,c)=>{
  const r=await env.DB.prepare(
    'SELECT '+c+' AS v FROM items WHERE asin=?1 AND cond=?2').bind(asin,cond).first();
  return r?r.v:undefined;
};

console.log('\n=== 行ボタンぜんぶ × 区分ぜんぶ ===');
let ng=0, ran=0, seen={};
for(const row of ROWS){
  for(const b of BTN){
    const item=Object.assign({ asin:row.asin, cond:row.cond,
      custom_label:row.label, title:row.name }, row.sku?{ sku:row.sku }:{},
      b.body);
    const r=await asJson(await worker.fetch(post('/listings',{ items:[item] }),env));
    ran++;
    if(r.status!==200||r.body.accepted!==1){
      ng++;
      if(ng<=5)console.log('   ❌ '+row.name+' / '+b.name+'：'
        +r.status+' '+JSON.stringify(r.body).slice(0,200));
      continue;
    }
    seen[b.name]=1;
  }
}
console.log('   押した回数 '+ran+'（区分 '+ROWS.length+'×ボタン '+BTN.length+'）'
  +'／失敗 '+ng);
ok(ran===ROWS.length*BTN.length,'★ぜんぶ押した（'+ran+'回）');
ok(ng===0,'★★★どの区分でも、どの行ボタンでも 200 で通る（失敗 '+ng+'件）');
ok(Object.keys(seen).length===BTN.length,'★★すべてのボタンが1回は通った');

console.log('\n=== 押した結果がちゃんと入る ===');
for(const row of ROWS.slice(0,3)){
  for(const b of BTN){
    const item=Object.assign({ asin:row.asin, cond:row.cond,
      custom_label:row.label, title:row.name }, row.sku?{ sku:row.sku }:{},
      b.body);
    await worker.fetch(post('/listings',{ items:[item] }),env);
    const v=await col(row.asin,row.cond,b.col);
    const good=(b.want===null) ? (v===null||v===undefined)
      : (String(v)===String(b.want));
    if(!good){
      ng++;
      console.log('   ❌ '+row.name+' / '+b.name+'：'+b.col+'='
        +JSON.stringify(v)+'（ほしいのは '+JSON.stringify(b.want)+'）');
    }
  }
}
ok(ng===0,'★★★押した項目が items に入る（ずれ '+ng+'件）');

console.log('\n=== この不具合そのもの（マリ 1/6・E-B0035WV8CY）===');
/* ユーザーが押した行とボタン。一点物 オン／手元在庫オン・手元の数は空。 */
const mari={ asin:'B0035WV8CY', cond:'used', custom_label:'E-B0035WV8CY-U',
  title:'マリ 1/6', one_off:true };
let r=await asJson(await worker.fetch(post('/listings',{ items:[mari] }),env));
console.log('   '+JSON.stringify(r.body).slice(0,160));
ok(r.status===200&&r.body.accepted===1,
   '★★★「一点物」を押すと 200 で通る（500 にならない）');
ok(!/Wrong number of parameter bindings/.test(JSON.stringify(r.body)),
   '★★★「Wrong number of parameter bindings」が出ない');
ok(Number(await col('B0035WV8CY','used','one_off'))===1,'★★印が立つ');
ok(Number(await col('B0035WV8CY','used','one_off_known'))===1,
   '★「人が決めた」印も立つ');

console.log('\n=== 1回に何件も送っても通る（名簿の送信）===');
const many=ROWS.map((x,i)=>({ asin:x.asin, cond:x.cond, custom_label:x.label,
  title:x.name, one_off:(i%2===0), mode:'hold', weight_g:100+i,
  cost_yen:1000+i, hand_qty:i }));
r=await asJson(await worker.fetch(post('/listings',{ items:many }),env));
console.log('   '+JSON.stringify(r.body).slice(0,160));
ok(r.status===200&&r.body.accepted===ROWS.length,
   '★★★名簿をまとめて送っても通る（'+ROWS.length+'件）');

console.log('\n=== 作業者のキーでも行ボタンは通る（価格の設定だけ 403）===');
const staff=async(body)=>asJson(await worker.fetch(new Request('https://x/listings',
  {method:'POST',headers:{'X-PJ-Key':'staff-key-123',
   'content-type':'application/json'},body:JSON.stringify(body)}),env));
r=await staff({ items:[{ asin:'B0035WV8CY', cond:'used',
  custom_label:'E-B0035WV8CY-U', title:'マリ', one_off:true }] });
ok(r.status===200&&r.body.accepted===1,'★★作業者でも「一点物」は通る');
r=await staff({ items:[{ asin:'B0035WV8CY', cond:'used', rv_want:40 }] });
ok(r.status===403,'★★価格を動かす項目は 403（今までどおり）');

T.done();
