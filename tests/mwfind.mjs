/* Worker：一覧の絞り込みと並べ替えを pj-sync でやる（7.128・【V の続き】）

   ① GET /mw/amz/find … 全件を見て、条件に合った行だけを返す
      （黒字のみ・出品者2人以上・Amazon本体なし・出品できる行だけ・利益率・
        ジャンル・順位の基準・JAN重複・検索）
   ② 並べ替え（粗利・利益率・順位・ジャンル・売れる速さ・在庫処分）と、
      offset で続きを取っても**重複・抜けが出ない**こと
   ③ counts=1 で ジャンルの件数・「外すと +n件」・JAN の一覧も返す
   ④ 利益の式は shared/mwamz.js（画面と同じ）を使う
   ⑤ 値段の取り直しは**大事な行を24時間**で対象に入れる（【V の続き】の5）
   ⑥ GET /mw/fee/why … 送り方を変えて聞き、原因を切り分ける */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import MWAMZ from '../shared/mwamz.js';
const T=harness('Worker：一覧の絞り込みと並べ替えを pj-sync でやる（7.128）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwfind');

let sent=[], feeMode='ng';
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/discord/.test(url))return new Response(null,{status:204});
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),
                        {status:200});
  if(/feesEstimate/.test(url)){
    const b=JSON.parse(String(o.body||'[]'));
    sent.push(b);
    const req=(b[0]||{}).FeesEstimateRequest||{};
    const fba=req.IsAmazonFulfilled;
    const amt=((req.PriceToEstimateFees||{}).ListingPrice||{}).Amount;
    /* FBA のときだけだめ（＝この ASIN は FBA の見積もりが出せない）。 */
    const bad=(feeMode==='ng')&&(fba===true)&&(amt!==1000);
    if(bad)
      return new Response(JSON.stringify([{ Status:'ClientError',
        FeesEstimateIdentifier:{ IdValue:String(b[0].IdValue||'') },
        Error:{ Type:'Sender', Code:'InvalidParameterValue',
          Message:'The value for IsAmazonFulfilled is not valid for this ASIN.' }
      }]),{status:200});
    return new Response(JSON.stringify([{ Status:'Success',
      FeesEstimateIdentifier:{ IdValue:String(b[0].IdValue||'') },
      FeesEstimate:{ TotalFeesEstimate:{ Amount:1500 },
        FeeDetailList:[{ FeeType:'ReferralFee', FinalFee:{ Amount:1000 } },
                       { FeeType:'FBAFees', FinalFee:{ Amount:400 } },
                       { FeeType:'Tax', FinalFee:{ Amount:100 } }] } }]),
      {status:200});
  }
  return new Response('{}',{status:200});
};
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123', SP_SELLER_ID:'A1SELLER' });
const put=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,list_price,release,cond,
     wholesale,stock,note,ship_text,ship_days,row_hash,pick,seen_at,gone_at,
     created_at)
   VALUES (?1,'いろは商会',0,?2,?3,7678,'','新品',?4,9,?5,'即日',0,'h',1,?6,NULL,?6)`)
  .bind(o.jan, o.kishu||'NS2', o.name||('商品'+o.jan), o.wholesale||3000,
        o.note||'', '2026-11-10T00:00:00Z').run();
const amz=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,basis,new_n,amz,rank,rank_cat,
     checked_at,fee_total,fee_ref,fee_fba,fee_tax,fee_base,size_tier,price_at)
   VALUES (?1,?2,?3,?4,'カート',?5,?6,?7,?8,?9,?10,?11,?12,?13,?4,'m',?14)`)
  .bind(o.jan, o.asin, o.name||'Amazon名', o.price,
        o.new_n===undefined?3:o.new_n, o.amz||0, o.rank||1200,
        o.rank_cat||'ゲーム', '2026-11-10T00:00:00Z',
        o.fee_total||null, o.fee_ref||null, o.fee_fba||null, o.fee_tax||null,
        o.price_at||'2026-11-10T00:00:00Z').run();
const jan=(i)=>'49023711'+String(10000+i).slice(-5);
const find=async(env,q)=>(await asJson(await worker.fetch(
  get('/mw/amz/find?'+q),env,{}))).body;

console.log('=== ① 条件に合った行だけ返す ===');
{
  const env=env0();
  /* 黒字10件・赤字20件／出品者1人5件（黒字のうち）／Amazon本体2件 */
  for(let i=0;i<10;i++){ await put(env,{ jan:jan(i) });
    await amz(env,{ jan:jan(i), asin:'B0FIN'+String(10000+i).slice(-5),
      price:9000, new_n:(i<5?1:3), amz:(i<2?1:0) }); }
  for(let i=10;i<30;i++){ await put(env,{ jan:jan(i) });
    await amz(env,{ jan:jan(i), asin:'B0FIN'+String(10000+i).slice(-5),
      price:3200 }); }
  const a=await find(env,'limit=100');
  console.log('   ぜんぶ '+a.n+'／scan '+a.scan+'／計算できた '+a.calc_n);
  ok(a.ok===true&&a.n===30&&a.scan===30,'★★★値段のある行をぜんぶ見る');
  const b=await find(env,'limit=100&win=1');
  ok(b.n===10,'★★★黒字のみ（pj-sync 側で絞る）');
  const c=await find(env,'limit=100&win=1&multi=1');
  ok(c.n===5,'★★★新品出品者が2人以上');
  const d=await find(env,'limit=100&win=1&noAmz=1');
  ok(d.n===8,'★★★Amazon本体なし');
  const e=await find(env,'limit=100&win=1&minM=99');
  ok(e.n===0,'★★★利益率の下限');
  const f=await find(env,'limit=5&win=1');
  console.log('   '+f.rows.length+'件返す／n '+f.n+'／more '+f.more);
  ok(f.rows.length===5&&f.n===10&&f.more===true,
     '★★★頁ぶんだけ返し、全件数と「続きがある」も返す');
  ok(f.rows[0].mw_name&&f.rows[0].asin&&f.rows[0].fee_total!==undefined,
     '★★★行は一覧と同じ列を返す（画面がそのまま出せる）');
}

console.log('\n=== ② 並べ替えと、続きの取り方 ===');
{
  const env=env0();
  for(let i=0;i<25;i++){ await put(env,{ jan:jan(i),
      kishu:(i<10?'NS2':'zzz') });
    await amz(env,{ jan:jan(i), asin:'B0SRT'+String(10000+i).slice(-5),
      price:9000, rank:(i%5===0?50:5000) }); }
  const p1=await find(env,'limit=10&sort=net');
  const p2=await find(env,'limit=10&offset=10&sort=net');
  const p3=await find(env,'limit=10&offset=20&sort=net');
  const all=p1.rows.concat(p2.rows).concat(p3.rows).map((r)=>r.jan);
  const u={}; all.forEach((x)=>{ u[x]=1; });
  console.log('   '+p1.rows.length+'＋'+p2.rows.length+'＋'+p3.rows.length
    +'＝'+all.length+'（別の商品 '+Object.keys(u).length+'）');
  ok(all.length===25&&Object.keys(u).length===25,
     '★★★同じ値段ばかりでも、続きで重複・抜けが出ない（JAN で最後を決める）');
  const rk=await find(env,'limit=5&sort=rank');
  ok(rk.rows.every((r,i,a)=>!i||(+a[i-1].rank)<=(+r.rank)),
     '★★★順位順（小さいほど売れている）');
  const gn=await find(env,'limit=25&sort=genre');
  ok(gn.rows[0].kishu==='NS2'&&gn.rows[24].kishu==='zzz',
     '★★ジャンルごと（ゲーム→フィギュア→その他）');
  const mg=await find(env,'limit=5&sort=margin');
  ok(mg.ok===true&&mg.sort==='margin','★利益率順も受ける');
  const bad=await find(env,'limit=5&sort=ほげ');
  ok(bad.sort==='net','★知らない並べ替えは粗利順にする');
}

console.log('\n=== ① 検索・ジャンル・順位の基準・JAN重複 ===');
{
  const env=env0();
  for(let i=0;i<10;i++){ await put(env,{ jan:jan(i),
      kishu:(i<4?'NS2':'zzz'), name:(i===0?'スチーム・ハーツ':'商品'+i) });
    await amz(env,{ jan:jan(i), asin:'B0QQQ'+String(10000+i).slice(-5),
      price:9000, rank:(i<2?50:5000), rank_cat:'ゲーム' }); }
  /* JAN重複（候補2件・まだ選んでいない）を1件。 */
  await env.DB.prepare(
    `INSERT INTO jan_map (jan,cand_n,cands,asin,at,cand_at)
     VALUES (?1,2,'[]',NULL,?2,?2)`)
    .bind(jan(0),'2026-11-10T00:00:00Z').run();
  const q=await find(env,'limit=10&q='+encodeURIComponent('スチーム'));
  console.log('   検索 '+q.n+'件：'+q.rows.map((r)=>r.mw_name).join('/'));
  ok(q.n===1&&/スチーム/.test(q.rows[0].mw_name),'★★★検索も pj-sync 側で');
  const g=await find(env,'limit=10&genre='+encodeURIComponent('ゲーム'));
  ok(g.n===4,'★★★ジャンルで絞る');
  const cap=await find(env,'limit=10&caps='+encodeURIComponent('{"ゲーム":100}'));
  console.log('   順位の基準 '+cap.n+'件／隠した '+cap.hid.rank+'件');
  ok(cap.n===2&&cap.hid.rank===8,'★★★順位の基準で隠し、隠した数も返す');
  const nr=await find(env,'limit=10&caps='+encodeURIComponent('{"ゲーム":100}')
    +'&norank=1');
  ok(nr.n===2,'★★順位が取れている行だけなら「順位が無い行も表示」は効かない');
  const dp=await find(env,'limit=10&dup=1');
  ok(dp.n===1&&dp.rows[0].jan===jan(0),'★★★JAN重複だけ');
}

console.log('\n=== ③ counts=1：ジャンルの件数・外すと +n件・JAN の一覧 ===');
{
  const env=env0();
  for(let i=0;i<10;i++){ await put(env,{ jan:jan(i), kishu:'NS2' });
    await amz(env,{ jan:jan(i), asin:'B0CNT'+String(10000+i).slice(-5),
      price:9000 }); }
  for(let i=10;i<30;i++){ await put(env,{ jan:jan(i), kishu:'zzz' });
    await amz(env,{ jan:jan(i), asin:'B0CNT'+String(10000+i).slice(-5),
      price:(i<13?9000:3200) }); }
  const d=await find(env,'limit=5&win=1&counts=1');
  console.log('   '+JSON.stringify({ n:d.n, genres:d.genres,
    total:d.genre_total, plus:d.plus, jans:(d.jans||[]).length }));
  ok(d.n===13,'★黒字は13件');
  ok(d.genres.some((x)=>x.g==='ゲーム'&&x.n===10&&x.all===10),
     '★★★ジャンルの件数は「絞り込みのあと／全件」');
  ok(d.genres.some((x)=>x.g==='その他'&&x.n===3&&x.all===20),
     '★★★全件（20件）も返すので「3件（全 20件）」と出せる');
  ok(d.genre_total===13,'★★「すべて」の件数');
  ok(d.plus.win===17,'★★★「黒字のみを外すと +17件」');
  ok(d.plus.multi===null&&d.plus.noAmz===null,
     '★★入れていない絞り込みは null（画面は何も出さない）');
  ok((d.jans||[]).length===13&&d.jans_cut===0,
     '★★★条件に合った JAN をぜんぶ返す（コピーと CSV に使う）');
  const d2=await find(env,'limit=5&win=1');
  ok(d2.genres===undefined&&d2.jans===undefined,
     '★counts=1 でなければ数え直さない（軽くするため）');
}

console.log('\n=== ④ 利益の式は画面と同じ（shared/mwamz.js）===');
{
  const env=env0();
  await worker.fetch(post('/settings',{ at:'2026-11-10T00:00:00Z',
    settings:{ mwShipFee:'176', mwAmzFeeGame:'15', mwFbaShipM:'425',
               mwFbaStoreM:'16', mwFbaSizeGame:'m', mwProfitMode:'mw',
               mwNetMode:'sedori' } }),env,{});
  await put(env,{ jan:jan(0), kishu:'NS2', wholesale:3000 });
  await amz(env,{ jan:jan(0), asin:'B0SAME0001', price:9000 });
  const S=MWAMZ.fromSettings({ mwShipFee:'176', mwAmzFeeGame:'15',
    mwFbaShipM:'425', mwFbaStoreM:'16', mwFbaSizeGame:'m',
    mwProfitMode:'mw', mwNetMode:'sedori' });
  const want=MWAMZ.calc({ kishu:'NS2', price:9000, wholesale:3000,
    size_tier:'m' },S);
  console.log('   粗利（税抜）'+want.net+'／利益率 '+want.margin+'%');
  const d=await find(env,'limit=5&win=1&minM='+Math.ceil(want.margin));
  ok(d.n===1,'★★★⚙の設定を読んで、画面と同じ利益率で絞る');
  const d2=await find(env,'limit=5&win=1&minM='+(Math.floor(want.margin)+1));
  ok(d2.n===0,'★★★0.1%の違いまで画面とそろう');
  /* 設定を変えると結果も変わる（送料を大きくすると赤字になる）。 */
  await worker.fetch(post('/settings',{ at:'2026-11-10T01:00:00Z',
    settings:{ mwShipFee:'99999', mwAmzFeeGame:'15', mwFbaShipM:'425',
               mwFbaStoreM:'16', mwFbaSizeGame:'m' } }),env,{});
  const d3=await find(env,'limit=5&win=1');
  ok(d3.n===0,'★★★⚙を変えたら pj-sync の絞り込みもすぐ変わる');
}

console.log('\n=== ⑤ 大事な行は24時間で取り直す ===');
{
  const env=env0();
  const old=new Date(Date.now()-30*3600000).toISOString();   // 30時間前
  /* ① 仕入れる印あり ② 粗利が大きい ③ ふつう（粗利が小さい） */
  await put(env,{ jan:jan(0), wholesale:3000 });
  await amz(env,{ jan:jan(0), asin:'B0HOT00001', price:4200, price_at:old,
    fee_total:1500, fee_ref:1000, fee_fba:400, fee_tax:100 });
  await env.DB.prepare(
    `INSERT INTO mw_buy (jan,qty,by_role,at,created_at) VALUES (?1,1,'admin',?2,?2)`)
    .bind(jan(0),'2026-11-01T00:00:00Z').run();
  await put(env,{ jan:jan(1), wholesale:3000 });
  await amz(env,{ jan:jan(1), asin:'B0HOT00002', price:9000, price_at:old,
    fee_total:1500, fee_ref:1000, fee_fba:400, fee_tax:100 });
  await put(env,{ jan:jan(2), wholesale:3000 });
  await amz(env,{ jan:jan(2), asin:'B0COL00003', price:4200, price_at:old,
    fee_total:1500, fee_ref:1000, fee_fba:400, fee_tax:100 });
  const st=await W.mwScanPrice(env,W.newRun('t'),
    { kishu:'', new_only:1, ship_max:3, stock_min:1, limit:0, order:'auto' },
    Date.now()-1);
  console.log('   対象 '+st.asked+'件');
  ok(st.asked===2,
     '★★★30時間前の値段のうち、**大事な行だけ**が対象に入る（3日を待たない）');
  ok(W.MW_AMZ_TTL_HOT_H===24&&W.MW_HOT_YEN===1000,
     '★★大事な行は24時間・粗利の目安は1,000円');
  /* 3日たてば、ふつうの行も入る。 */
  await env.DB.prepare(`UPDATE mw_amz SET price_at=?1 WHERE jan=?2`)
    .bind(new Date(Date.now()-4*86400000).toISOString(),jan(2)).run();
  const st2=await W.mwScanPrice(env,W.newRun('t'),
    { kishu:'', new_only:1, ship_max:3, stock_min:1, limit:0, order:'auto' },
    Date.now()-1);
  ok(st2.asked===3,'★★★3日たてばふつうの行も対象に入る（今までどおり）');
}

console.log('\n=== ⑥ GET /mw/fee/why（原因の切り分け）===');
{
  const env=env0();
  sent=[]; feeMode='ng';
  const d=(await asJson(await worker.fetch(
    get('/mw/fee/why?asin=B0DV5D74ZQ&price=8800'),env,{}))).body;
  console.log('   '+(d.tried||[]).map((x)=>x.label+':'+(x.ok?'○':'×'))
    .join('／'));
  console.log('   '+String(d.why||''));
  ok(d.ok===true&&(d.tried||[]).length===4,'★★★送り方を4通り試す');
  ok(sent.length===4,'★★★Amazon に4回だけ聞く');
  ok(sent[0][0].FeesEstimateRequest.IsAmazonFulfilled===true
     &&sent[1][0].FeesEstimateRequest.IsAmazonFulfilled===false
     &&sent[2][0].FeesEstimateRequest.IsAmazonFulfilled===undefined,
     '★★★FBA あり／なし／指定なし を試す');
  ok(((sent[3][0].FeesEstimateRequest.PriceToEstimateFees||{})
      .ListingPrice||{}).Amount===1000,'★★★値段だけ変えた回も試す');
  ok(d.tried[0].ok===false&&d.tried[1].ok===true,
     '★★★どれなら通るかを返す');
  ok(/FBA（Amazon から出す）の見積もりが出せません/.test(String(d.why)),
     '★★★「この ASIN は FBA の見積もりが出せない」と言い当てる');
  ok(/pj からは直せません/.test(String(d.fix)),'★★直し方も日本語で出す');
  ok(d.mp&&/^A[0-9A-Z]+$/.test(String(d.mp)),'★送っている市場も返す');
  /* ぜんぶ通るときは「そのときだけの失敗」。 */
  sent=[]; feeMode='ok';
  const d2=(await asJson(await worker.fetch(
    get('/mw/fee/why?asin=B0DV5D74ZQ&price=8800'),env,{}))).body;
  ok(d2.tried[0].ok===true&&/もう一度/.test(String(d2.fix)),
     '★★通ったときはそう言う');
  const bad=(await asJson(await worker.fetch(
    get('/mw/fee/why?asin=ABC&price=100'),env,{}))).body;
  ok(bad.ok===false&&bad.error==='bad_asin','★ASIN の形が違えば断る');
  /* 作業者のキーでは動かせない。 */
  const r=await worker.fetch(
    new Request('https://x/mw/fee/why?asin=B0DV5D74ZQ&price=100',
      { headers:{ 'X-PJ-Key':'staff-key-123' } }),env,{});
  ok(r.status===403,'★★★作業者のキーでは動かせない');
}
T.done();
