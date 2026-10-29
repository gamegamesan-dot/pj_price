/* Worker：ランキングは「大きい分類」の順位（7.91）
   せどりすと と同じ見え方にそろえる。小分類だと売れ行きが良く見えすぎる。
     例：チョイプラ アモデウス（JAN 4580033110113）
         pj（小分類）11,481位（ロボットのプラモデル・模型）
         せどりすと（大分類）948,040位（ホビー）
   ・displayGroupRanks（ホビー・ゲームなど）を rank・rank_cat に入れる
   ・classificationRanks（小分類）は rank_sub・rank_sub_cat に添えるだけ
   ・大分類が無い商品は、今までどおり小分類を rank に入れる（二重には出さない）
   ・ランキングと商品名は3日ごとに引き直す（既存の行の大分類を埋めるため）
   ・引き直しても、人が選んだ ASIN は選び直しに戻さない */
import { harness, loadWorker, makeEnv, get, asJson } from './lib.mjs';
const T=harness('Worker：ランキングは大分類');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwrank');
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  LWA_CLIENT_ID:'ci', LWA_CLIENT_SECRET:'cs', LWA_REFRESH_TOKEN:'rt' });

let calls=[], cat={};
globalThis.fetch=async(u)=>{
  const url=String(u); calls.push(url);
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  if(/catalog\/2022-04-01\/items/.test(url)){
    const ids=new URL(url).searchParams.get('identifiers').split(',');
    const items=[];
    ids.forEach((j)=>{ (cat[j]||[]).forEach((x)=>items.push(x)); });
    return new Response(JSON.stringify({items}),{status:200});
  }
  if(/itemOffers/.test(url))
    return new Response(JSON.stringify({responses:[]}),{status:200});
  if(/feesEstimate/.test(url))
    return new Response(JSON.stringify({FeesEstimateResultList:[]}),{status:200});
  if(/restrictions/.test(url))
    return new Response(JSON.stringify({restrictions:[]}),{status:200});
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
/* 大分類（grp）と小分類（sub）を好きに組める作り。 */
const mk=(jan,asin,name,grp,sub)=>{
  const sr={};
  if(grp)sr.displayGroupRanks=grp;
  if(sub)sr.classificationRanks=sub;
  return { asin:asin,
    identifiers:[{ identifiers:[{ identifierType:'EAN', identifier:jan }] }],
    summaries:[{ itemName:name }],
    salesRanks:(grp||sub)?[sr]:[] };
};
const row=(jan,x)=>Object.assign({jan:jan,sha:'M200',idx:0,kishu:'FIG',
  name:jan+'の商品',list_price:5000,release:'2025/01/01',cond:'新品',
  wholesale:3000,stock:9,note:'',ship_text:'即日出荷',ship_days:0},x||{});
const post=async(path,body,key)=>asJson(await worker.fetch(new Request('https://x'+path,
  {method:'POST',headers:{'X-PJ-Key':key||'k','content-type':'application/json'},
   body:JSON.stringify(body)}),env));
const stock=async(rows)=>post('/mw/stock',
  {at:'2026-11-06T00:00:00Z',part:1,parts:1,rows:rows});
const am=async(jan)=>await env.DB.prepare(
  'SELECT * FROM mw_amz WHERE jan=?1').bind(jan).first();
const jm=async(jan)=>await env.DB.prepare(
  'SELECT * FROM jan_map WHERE jan=?1').bind(jan).first();
const list=async(q)=>(await asJson(await worker.fetch(get('/mw/amz'+(q||'')),env))).body;
const aged=async(jan,days)=>await env.DB.prepare(
  'UPDATE mw_amz SET asin_at=?2, checked_at=?2 WHERE jan=?1')
  .bind(jan,new Date(Date.now()-days*86400000).toISOString()).run();

console.log('=== rankPick：大分類を主に取る ===');
/* 実例そのまま。せどりすと は 948,040位（ホビー）と出す。 */
let k=W.rankPick(mk('4580033110113','B0D1CHOI01','チョイプラ アモデウス',
  [{ title:'ホビー', rank:948040 }],
  [{ title:'おもちゃ', rank:92000 },
   { title:'ロボットのプラモデル・模型', rank:11481 }]));
console.log('   '+JSON.stringify(k));
ok(k.rank===948040&&k.rank_cat==='ホビー',
   '★★★大分類（displayGroupRanks）を rank に入れる');
ok(k.rank_sub===11481&&k.rank_sub_cat==='ロボットのプラモデル・模型',
   '★★★小分類は rank_sub に添える（一番細かいもの）');

console.log('\n=== 大分類が無い商品は小分類で代用（二重には出さない）===');
k=W.rankPick(mk('x','B1','小分類だけ',null,
  [{ title:'ゲーム', rank:6490 }, { title:'Nintendo Switch ソフト', rank:649 }]));
console.log('   '+JSON.stringify(k));
ok(k.rank===649&&k.rank_cat==='Nintendo Switch ソフト',
   '★★大分類が無ければ小分類を rank に入れる（今までどおり）');
ok(k.rank_sub===0&&k.rank_sub_cat==='',
   '★★★同じ順位を小分類にも出さない（二重に見えてしまう）');
k=W.rankPick(mk('x','B1','大分類だけ',[{ title:'ホビー', rank:12345 }],null));
ok(k.rank===12345&&k.rank_cat==='ホビー'&&k.rank_sub===0,
   '★小分類が無い商品も出せる');
k=W.rankPick(mk('x','B1','順位なし',null,null));
ok(k.rank===0&&k.rank_cat===''&&k.rank_sub===0,'★順位が無ければ0（空）');
k=W.rankPick({});
ok(k.rank===0&&k.rank_cat==='','★salesRanks ごと無くても落ちない');
k=W.rankPick(mk('x','B1','0は使わない',
  [{ title:'だめ', rank:0 }, { title:'ホビー', rank:77 }],
  [{ title:'ゲーム', rank:5 }, { title:'だめ', rank:0 }]));
console.log('   '+JSON.stringify(k));
ok(k.rank===77&&k.rank_cat==='ホビー','★★0の分類は飛ばして次を見る');
ok(k.rank_sub===5&&k.rank_sub_cat==='ゲーム','★小分類も0は飛ばす');
k=W.rankPick(mk('x','B1','長い名前',[{ title:'あ'.repeat(90), rank:9 }],null));
ok(k.rank_cat.length===60,'★分類名は60文字で切る（列を太らせない）');

console.log('\n=== 取り込んで調べると、大分類で入る ===');
const CHOI='4580033110113', NS='4902370550467';
await stock([row(CHOI),row(NS)]);
cat[CHOI]=[mk(CHOI,'B0D1CHOI01','チョイプラ アモデウス',
  [{ title:'ホビー', rank:948040 }],
  [{ title:'ロボットのプラモデル・模型', rank:11481 }])];
cat[NS]=[mk(NS,'B00NS00001','Switch のソフト',null,
  [{ title:'Nintendo Switch ソフト', rank:649 }])];
let r=await post('/mw/amz',{ kishu:'FIG', stock_min:5 });
console.log('   ①'+JSON.stringify(r.body.asin));
ok(r.body.asin.ok_n===2,'2件とも ASIN が入る');
let a=await am(CHOI);
console.log('   '+JSON.stringify({rank:a.rank,cat:a.rank_cat,
  sub:a.rank_sub,sub_cat:a.rank_sub_cat}));
ok(a.rank===948040&&a.rank_cat==='ホビー','★★★mw_amz に大分類の順位が入る');
ok(a.rank_sub===11481&&a.rank_sub_cat==='ロボットのプラモデル・模型',
   '★★小分類も控える');
let n=await am(NS);
ok(n.rank===649&&n.rank_cat==='Nintendo Switch ソフト'&&!n.rank_sub,
   '★大分類が無い商品は小分類が rank に入る');
let d=await jm(CHOI);
ok(d&&d.rank===948040&&d.rank_cat==='ホビー'&&d.rank_sub===11481,
   '★★jan_map にも同じように控える');
let L=await list('?kishu=FIG&stock_min=5');
let lc=(L.rows||[]).filter((x)=>x.jan===CHOI)[0];
console.log('   一覧: '+JSON.stringify({rank:lc.rank,cat:lc.rank_cat,
  sub:lc.rank_sub,sub_cat:lc.rank_sub_cat}));
ok(lc.rank===948040&&lc.rank_cat==='ホビー','★★★一覧も大分類を返す');
ok(lc.rank_sub===11481&&lc.rank_sub_cat==='ロボットのプラモデル・模型',
   '★★★一覧は小分類も返す（画面に小さく添えるため）');

console.log('\n=== ランキング・商品名は3日ごとに引き直す ===');
calls=[];
r=await post('/mw/amz',{ kishu:'FIG', stock_min:5 });
console.log('   すぐ: '+JSON.stringify({asked:r.body.asin.asked}));
ok(r.body.asin.asked===0,'★★取り直したばかりの行は①で呼ばない');
await aged(CHOI,4); await aged(NS,1);
cat[CHOI]=[mk(CHOI,'B0D1CHOI01','チョイプラ アモデウス（新名）',
  [{ title:'ホビー', rank:812000 }],
  [{ title:'ロボットのプラモデル・模型', rank:9800 }])];
calls=[];
r=await post('/mw/amz',{ kishu:'FIG', stock_min:5 });
console.log('   4日後: '+JSON.stringify({asked:r.body.asin.asked,
  ok_n:r.body.asin.ok_n}));
ok(r.body.asin.asked===1,'★★★3日を過ぎた行だけ引き直す（1日の行は呼ばない）');
a=await am(CHOI);
console.log('   '+JSON.stringify({rank:a.rank,sub:a.rank_sub,name:a.name}));
ok(a.rank===812000,'★★★大分類の順位が新しくなる');
ok(a.rank_sub===9800,'★小分類も新しくなる');
ok(/新名/.test(String(a.name||'')),'★★Amazon の商品名も引き直す');
ok(a.asin==='B0D1CHOI01','ASIN は変わらない');

console.log('\n=== 引き直しても、人が選んだ ASIN は守る ===');
const DUP='4573102666987';
await stock([row(CHOI),row(NS),row(DUP)]);
cat[DUP]=[mk(DUP,'B00ULTRA01','ウルトラマン ソフビ',[{ title:'ホビー', rank:300000 }]),
          mk(DUP,'B00STARW01','スター・ウォーズ',[{ title:'ホビー', rank:400000 }])];
r=await post('/mw/amz',{ kishu:'FIG', stock_min:5 });
ok(r.body.asin.dup===1,'まず「JAN重複（要確認）」になる');
r=await post('/mw/jan-pick',{ jan:DUP, asin:'B00STARW01' });
ok(r.body.ok===true,'人が「スター・ウォーズ」を選ぶ');
await aged(DUP,4);
calls=[];
r=await post('/mw/amz',{ kishu:'FIG', stock_min:5 });
console.log('   '+JSON.stringify({asked:r.body.asin.asked,ok_n:r.body.asin.ok_n,
  dup:r.body.asin.dup}));
ok(r.body.asin.asked===1&&r.body.asin.ok_n===1,'★★3日を過ぎたので引き直す');
ok(r.body.asin.dup===0,'★★★候補が2件あっても「要確認」に戻さない');
a=await am(DUP);
console.log('   '+JSON.stringify({asin:a.asin,rank:a.rank,err:a.err}));
ok(a.asin==='B00STARW01','★★★人が選んだ ASIN のまま');
ok(a.rank===400000&&a.rank_cat==='ホビー','★★選んだ商品の大分類が入る');
ok(!/JAN重複/.test(String(a.err||'')),'★「要確認」の印は付けない');

console.log('\n=== 引き直せなくても、前の ASIN は消さない ===');
/* Catalog が一時的に返さないことがある。消すと値段も可否も手数料も失う。 */
await aged(NS,4);
const keepRank=(await am(NS)).rank;
cat[NS]=[];                      // 何も返らない
r=await post('/mw/amz',{ kishu:'FIG', stock_min:5 });
console.log('   '+JSON.stringify({asked:r.body.asin.asked,ng:r.body.asin.ng}));
ok(r.body.asin.asked>=1&&r.body.asin.ng>=1,'引けなかった行として数える');
n=await am(NS);
console.log('   '+JSON.stringify({asin:n.asin,rank:n.rank,err:String(n.err||'')}));
ok(n.asin==='B00NS00001','★★★前の ASIN は消さない（値段も可否も失わない）');
ok(n.rank===keepRank,'★★前のランキングもそのまま');
ok(/前の ASIN を使います/.test(String(n.err||'')),'★★引けなかったことは控える');
calls=[];
r=await post('/mw/amz',{ kishu:'FIG', stock_min:5 });
ok(r.body.asin.asked===0,'★★時刻は進めるので、すぐには呼び直さない（3日後）');
cat[NS]=[mk(NS,'B00NS00001','Switch のソフト',[{ title:'ゲーム', rank:4400 }],null)];

console.log('\n=== 自動の取り直し（毎時 :37）も①を回す ===');
console.log('   MW_AUTO_ASIN_N='+W.MW_AUTO_ASIN_N);
ok(W.MW_AUTO_ASIN_N===20,'★1回に20件（既存の処理とぶつからない件数）');
await post('/settings',{ at:new Date(Date.now()+60000).toISOString(),
  settings:{ mwAutoMode:'on', mwKishu:'FIG', mwShipMax:4, mwStockMin:5,
    mwNoteNg:'', pbMode:'off', autoMdMode:'off', autoRvMode:'off' } });
await aged(CHOI,4);
cat[CHOI]=[mk(CHOI,'B0D1CHOI01','チョイプラ アモデウス',
  [{ title:'ホビー', rank:701000 }],null)];
const auto=await post('/mw/auto',{});
console.log('   '+JSON.stringify({mode:auto.body.mode,asin:auto.body.asin_n,
  price:auto.body.price_n,note:String(auto.body.note||'').slice(0,40)}));
ok(auto.body.mode==='on','オン');
ok(auto.body.asin_n>=1,'★★★自動の回でも ASIN・順位を引き直す');
ok(/ASIN・順位/.test(String(auto.body.note||'')),'★記録に件数を残す');
a=await am(CHOI);
ok(a.rank===701000,'★★★自動の回で大分類の順位が新しくなる');
await T.done();
