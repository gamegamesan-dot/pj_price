/* Worker：MW の欠品を、在庫CSVの取り込みのたびに eBay の数量0にする（8.97・v345）

   カジの依頼（2026-11-23）欠品が見つかってから eBay の数量が0になるまでを短くしたい。
   7.73 から取り込みの最後の便で「数量0だけ」（jobMwDrop only:"zero"）を書き込んで
   いたが、次を足した。
   ① ⚙「欠品は取り込みのたびに数量0にする」（mwZeroOnImport・既定オン）。オフなら日次だけ
   ② 1回 60件（MW_D_MAX）まで。超えたぶんと失敗したぶんは**次の取り込み**でやり直す
      （欠品が新しく出ていない回でも走らせる）
   ③ 歯止め：数量0にする出品が、いま数量1以上の W- の出品の3割以上かつ10件以上なら
      書き込まない（予定だけ）。3割の歯止め（取り込めた行が3割以上少ない）は今までどおり
   ④ 取り込みの知らせ（📥 の1通）に「eBay の数量を0にした ◯件」。別の知らせは増やさない
   ⑤ 直し：eBay で失敗した行を「変えた」と数えていた（ebayReviseInv の返りの見方の誤り）
   ⑥ 日次の段取り D（approve・歯止めなし）は変えない */
import { harness, loadWorker, makeEnv, asJson } from './lib.mjs';
const T=harness('Worker：欠品は取り込みのたびに数量0（8.97）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwzero');

let sent=[], notes=[], failIds={};
globalThis.fetch=async(u,i)=>{
  const url=String(u);
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),{status:200});
  if(/ws\/api\.dll/.test(url)){
    const body=String(i.body||'');
    sent.push(body);
    const ids=[...body.matchAll(/<ItemID>(\d+)<\/ItemID>/g)].map((m)=>m[1]);
    const good=ids.filter((x)=>!failIds[x]), bad=ids.filter((x)=>failIds[x]);
    return new Response('<?xml version="1.0"?><ReviseInventoryStatusResponse>'
      +'<Ack>'+(bad.length?'Warning':'Success')+'</Ack>'
      +good.map((x)=>'<InventoryStatus><ItemID>'+x+'</ItemID><Quantity>0</Quantity></InventoryStatus>').join('')
      +bad.map((x)=>'<Errors><ErrorCode>21916</ErrorCode><ShortMessage>失敗</ShortMessage>'
        +'<ErrorParameters ParamID="0"><Value>'+x+'</Value></ErrorParameters></Errors>').join('')
      +'</ReviseInventoryStatusResponse>',{status:200});
  }
  if(/discord/.test(url)){
    const b=JSON.parse(i.body); notes.push(String(b.content||'')+JSON.stringify(b.embeds||''));
    return new Response(null,{status:204});
  }
  throw new Error('外へ出てはいけない: '+url);
};
const mkEnv=async(ui)=>{
  const env=makeEnv({ STAFF_KEY:'staff-key-123', EBAY_CLIENT_ID:'ci', EBAY_CLIENT_SECRET:'cs',
    EBAY_REFRESH_TOKEN:'rt', DISCORD_WEBHOOK_URL:'https://discord.com/api/webhooks/1/x' });
  await env.DB.prepare(`INSERT INTO sync_state (k,v,updated_at) VALUES ('settings',?1,'x')`)
    .bind(JSON.stringify({ fx:160, fee:13.6, intlFee:1.35, autoAdRate:6, feeTax:10,
      fixed:0.40, pack:150, shipCharge:15, usTaxRate:8, baseProfit:1000,
      linkRate:30, saleRate:15, targetMode:'auto', mwShipFee:176 })).run();
  if(ui)await env.DB.prepare(`INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,'x')`)
    .bind(JSON.stringify({ at:'x', settings:ui })).run();
  return env;
};
const row=(jan)=>({jan:jan,sha:'M200',idx:0,kishu:'NS',name:jan+'の商品',
  list_price:5000,release:'2025/01/01',cond:'新品',wholesale:3000,stock:9,
  note:'',ship_text:'即日出荷',ship_days:0});
const put=async(env,at,rows)=>(await asJson(await worker.fetch(new Request('https://x/mw/stock',
  {method:'POST',headers:{'X-PJ-Key':'k','content-type':'application/json'},
   body:JSON.stringify({ at:at, part:1, parts:1, rows:rows })}),env))).body;
const JAN=(i)=>String(4950000000000+i);
/* n 行の MW の在庫と、そのうち k 件を eBay に出している状態を作る。 */
const setup=async(env,n,k)=>{
  const all=new Array(n).fill(0).map((_,i)=>row(JAN(i)));
  await put(env,'2026-11-01T00:00:00Z',all);
  const st=[];
  for(let i=0;i<k;i++)st.push(env.DB.prepare(
    `INSERT INTO items (asin,cond,scope,title,ebay_item_id,ebay_sku,ebay_qty,ebay_price,weight_g,updated_at)
     VALUES (?1,'new','ebay',?2,?3,?4,1,60,150,'x')`)
    .bind('B0Z'+String(i).padStart(7,'0'),'出品'+i,String(180000000+i),'W-'+JAN(i)));
  for(let i=0;i<st.length;i+=50)await env.DB.batch(st.slice(i,i+50));
  return all;
};
const qty=async(env,i)=>(await env.DB.prepare(`SELECT ebay_qty FROM items WHERE ebay_sku=?1`)
  .bind('W-'+JAN(i)).first()).ebay_qty;
const drop=(all,set)=>all.filter((x,i)=>!set(i));

console.log('=== ④ 知らせの1行（mwZeroLines）===');
{
  const a=W.mwZeroLines({ zero_on:true, zeroed:3, zero_left:2, zero_failed:1 });
  const b=W.mwZeroLines({ zero_on:true, zeroed:0 });
  const c=W.mwZeroLines({ warn:'x' });
  const d=W.mwZeroLines({ zero_on:true, zero_guard:'数量0にする出品が多すぎる' });
  const e=W.mwZeroLines({ zero_on:false, gone_jan:2 });
  console.log('   '+a.lines.join(' / '));
  ok(/eBay の数量を0にした 3件/.test(a.lines[0])&&/上限 60件を超えた 2件は次の取り込みで/.test(a.lines[0])
     &&/失敗 1件（次の取り込みでやり直します）/.test(a.lines[0])&&a.must,'★★★「数量0にした ◯件」・次に回した件数・失敗');
  ok(/数量を0にした 0件/.test(b.lines[0])&&!b.must,'★★0件でも1行は出す（知らせが出るときだけ）');
  ok(c.must&&/eBay の数量0も書き込んでいません/.test(c.lines[0]),'★★★3割の歯止めの回は必ず知らせる');
  ok(d.must&&/多すぎる/.test(d.lines[0]),'★★★数量0の歯止めの回も必ず知らせる');
  ok(!e.must&&/日次/.test(e.lines[0]),'★⚙ オフなら日次で書くことを出す');
  ok(W.MW_Z_GUARD_RATE===0.3&&W.MW_Z_GUARD_MIN===10,'★歯止めは 3割・10件');
}

console.log('\n=== ① ② 取り込みのたびに数量0（上限・次の取り込みで残り）===');
{
  const env=await mkEnv(null);
  const all=await setup(env,300,300);
  /* 65件が欠品（行は 21.7% 減るので3割の歯止めには当たらない。
     W- の出品 300件の 21.7% なので数量0の歯止めにも当たらない）。 */
  sent=[]; notes=[];
  const t0=Date.now();
  const r=await put(env,'2026-11-02T00:00:00Z',drop(all,(i)=>i<65));
  const ms=Date.now()-t0;
  console.log('   '+JSON.stringify({ gone:r.gone, zeroed:r.zeroed, left:r.zero_left, need:r.zero_need,
    calls:sent.length, warn:r.warn||'' })+' '+ms+'ms');
  ok(r.gone===65&&r.zeroed===60&&r.zero_left===5,'★★★1回 60件まで数量0（残り 5件は次の回）');
  ok(sent.length===15,'★★eBay の呼び出しは 15回（4件ずつ）＝1回の上限に収まる');
  ok(await qty(env,0)===0&&await qty(env,59)===0&&await qty(env,64)===1&&await qty(env,65)===1,
     '★★★D1 の数量も合わせる（残りと生きている出品は1のまま）');
  const m=notes.join('\n');
  ok(/📥 MW の在庫CSVを取り込みました/.test(m)&&/eBay の数量を0にした 60件/.test(m)
     &&/上限 60件を超えた 5件は次の取り込みで/.test(m),'★★★取り込みの知らせに「数量0にした 60件」と残り');
  ok(!/MWで欠品した出品の数量を0にしました|MW無在庫の見見直し|🏷/.test(m),'★★★別の知らせは増やさない');
  /* 次の取り込み（CSV は同じ＝新しい欠品なし）でも、残りを数量0にする。 */
  sent=[]; notes=[];
  const r2=await put(env,'2026-11-02T03:00:00Z',drop(all,(i)=>i<65));
  ok(r2.gone===0&&r2.zeroed===5&&await qty(env,64)===0,'★★★次の取り込みで残りの 5件を数量0（新しい欠品が無くても）');
  sent=[]; notes=[];
  const r3=await put(env,'2026-11-02T06:00:00Z',drop(all,(i)=>i<65));
  ok(r3.zeroed===0&&sent.length===0,'★★もう数量0にするものが無ければ eBay を呼ばない');
}

console.log('\n=== ⑤ 失敗した行は次の取り込みでやり直す ===');
{
  const env=await mkEnv(null);
  const all=await setup(env,40,20);
  failIds={ '180000001':1 };
  sent=[]; notes=[];
  const r=await put(env,'2026-11-02T00:00:00Z',drop(all,(i)=>i<2));
  console.log('   '+JSON.stringify({ zeroed:r.zeroed, failed:r.zero_failed }));
  ok(r.zeroed===1&&r.zero_failed===1,'★★★eBay で失敗した行は「変えた」に数えない（v344 までの誤りの直し）');
  ok(await qty(env,0)===0&&await qty(env,1)===1,'★★★失敗した行の D1 の数量は1のまま（次の回の対象に残る）');
  const e=await env.DB.prepare(`SELECT revise_err FROM items WHERE ebay_sku=?1`).bind('W-'+JAN(1)).first();
  ok(/21916/.test(e.revise_err||''),'★失敗の理由を控える');
  ok(/失敗 1件（次の取り込みでやり直します）/.test(notes.join('\n')),'★★知らせに失敗の件数');
  failIds={};
  const r2=await put(env,'2026-11-02T03:00:00Z',drop(all,(i)=>i<2));
  ok(r2.zeroed===1&&await qty(env,1)===0,'★★★次の取り込みでやり直して数量0');
}

console.log('\n=== ③ 歯止め：数量0にする出品が多すぎる回は書き込まない ===');
{
  const env=await mkEnv(null);
  const all=await setup(env,100,30);
  /* 行は 12% しか減らない（3割の歯止めには当たらない）が、出品 30件のうち 12件（40%）。 */
  sent=[]; notes=[];
  const r=await put(env,'2026-11-02T00:00:00Z',drop(all,(i)=>i<12));
  console.log('   '+JSON.stringify({ gone:r.gone, zeroed:r.zeroed, guard:(r.zero_guard||'').slice(0,40) }));
  ok(r.gone===12&&r.zeroed===0&&sent.length===0,'★★★eBay に書き込まない（予定だけ）');
  ok(/12件/.test(r.zero_guard)&&/30件の 40%/.test(r.zero_guard),'★★理由（件数と割合）を返す');
  ok(await qty(env,0)===1,'★★D1 の数量も変えない');
  const m=notes.join('\n');
  ok(/📥 MW の在庫CSVを取り込みました/.test(m)&&/⚠ 数量0にする出品が 12件/.test(m)&&/書き込んでいません/.test(m),
     '★★★取り込みの知らせ（1通）で言う');
  ok(notes.length===1||notes.every((x)=>!/🏷/.test(x)),'★★別の「確認」の知らせは出さない');
  /* 9件なら（10件未満）書き込む。 */
  const env2=await mkEnv(null);
  const all2=await setup(env2,100,20);
  sent=[];
  const r2=await put(env2,'2026-11-02T00:00:00Z',drop(all2,(i)=>i<9));
  ok(r2.zeroed===9&&!r2.zero_guard,'★★10件未満なら（割合が高くても）書き込む');
  /* ⑥ 日次の段取り D（歯止めなし）は今までどおり書き込む。 */
  sent=[];
  const d=await W.jobMwDrop(env,{ approve:true });
  ok(d.zero===12&&sent.length===3,'★★★日次（approve・歯止めなし）は今までどおり数量0にする');
}

console.log('\n=== 3割の歯止め（取り込めた行が3割以上少ない）===');
{
  const env=await mkEnv(null);
  const all=await setup(env,20,5);
  sent=[]; notes=[];
  const r=await put(env,'2026-11-02T00:00:00Z',all.slice(0,10));
  ok(!!r.warn&&r.gone===0&&r.zeroed===0&&sent.length===0,'★★★欠品にしない・eBay を呼ばない（今までどおり）');
  ok(/eBay の数量0も書き込んでいません/.test(notes.join('\n')),'★★★その回も取り込みの知らせで言う（v344 までは何も出なかった）');
}

console.log('\n=== ① ⚙ でオフ ===');
{
  const env=await mkEnv({ mwZeroOnImport:false });
  const all=await setup(env,40,20);
  sent=[]; notes=[];
  const r=await put(env,'2026-11-02T00:00:00Z',drop(all,(i)=>i<2));
  ok(r.gone===2&&r.zeroed===0&&sent.length===0&&r.zero_on===false,'★★★オフなら取り込みでは数量0にしない');
  ok(await qty(env,0)===1,'★★数量はそのまま（日次で書く）');
  ok(/日次（JST 3時台）に書き込みます/.test(notes.join('\n')),'★知らせに日次で書くと出す');
  sent=[];
  const d=await W.jobMwDrop(env,{ approve:true });
  ok(d.zero===2,'★★日次は今までどおり');
}

console.log('\n=== 手動の取り込み（画面）も同じ口 ===');
{
  const env=await mkEnv(null);
  const all=await setup(env,40,20);
  sent=[];
  /* 画面は 400行ずつ part／parts で送る。最後の便でだけ数量0。 */
  const rest=drop(all,(i)=>i===3);
  const a=(await asJson(await worker.fetch(new Request('https://x/mw/stock',{method:'POST',
    headers:{'X-PJ-Key':'k','content-type':'application/json'},
    body:JSON.stringify({ at:'2026-11-02T00:00:00Z', part:1, parts:2, rows:rest.slice(0,20) })}),env))).body;
  ok(a.zeroed===0&&sent.length===0,'★途中の便では書き込まない');
  const b=(await asJson(await worker.fetch(new Request('https://x/mw/stock',{method:'POST',
    headers:{'X-PJ-Key':'k','content-type':'application/json'},
    body:JSON.stringify({ at:'2026-11-02T00:00:00Z', part:2, parts:2, rows:rest.slice(20) })}),env))).body;
  ok(b.gone===1&&b.zeroed===1&&await qty(env,3)===0,'★★★最後の便で数量0（手動の取り込みも同じ）');
}

T.done();
