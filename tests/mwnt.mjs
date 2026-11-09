/* Worker：取り込みの知らせの中身と、売り切れの誤報（7.121・【Q】）

   ① 取り込みの各回の中身を一覧で返す（GET /mw/nt）
      gone … 新しく欠品／new … 新しく出てきた／back … 欠品から戻った
      画面が相場の区分と見込み粗利を出せるよう、候補一覧と同じ名前で返す
   ② 「注文前に売り切れました」の誤報をなくす
      ・pj が Amazon に登録したら、その場で mw_buy の「登録済み」も立てる
        （v243 までは立てていなかったので、薔薇と椿で誤報が出た）
      ・「注文した」の印（日付つき）が付いた行は知らせの対象から外す
      ・mw_reg_log が通った行・mw… の SKU が在庫にある行も外す
   ③ 欠品は「eBay 出品中・仕入れるの印・刈取の見込みあり」だけ並べ、
      関係のないものは件数だけ
   ④ Discord のリンクに**キーを入れない**／「長押し →Safari で開く」を添える
   ⑤ 1通 2000字に入らないときは分けて送る */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：取り込みの知らせと売り切れの誤報（7.121）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwnt');

let sent=[], emb=[], msgs=[];
/* 埋め込みの中の文をぜんぶつないだもの（探しやすくするため）。 */
const embText=()=>emb.map((e)=>[e.title,e.url,e.description||'']
  .concat((e.fields||[]).map((f)=>f.name+' '+f.value)).join(' ')).join('\n');
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/discord/.test(url)){
    /* 7.125：埋め込み（embeds）も見る。 */
    const b=JSON.parse(String(o.body||'{}'));
    sent.push(b.content||'');
    emb.push(...((b.embeds)||[]));
    msgs.push(b);
    return new Response(null,{status:204});
  }
  if(/o2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'t',expires_in:3600}),{status:200});
  return new Response('{}',{status:200});
};
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123' });
/* MW の在庫の1行を入れる。 */
const put=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,list_price,release,cond,
     wholesale,stock,note,ship_text,ship_days,row_hash,seen_at,gone_at,
     back_at,created_at)
   VALUES (?1,?2,0,?3,?4,?5,'',?6,?7,?8,'',?9,?10,'h',?11,?12,?13,?14)`)
  .bind(o.jan, o.sha||'いろは商会', o.kishu||'NS2', o.name||('商品'+o.jan),
        o.list_price||7678, o.cond||'新品', o.wholesale||3000,
        (o.stock===undefined?9:o.stock), o.ship_text||'即日',
        (o.ship_days===undefined?0:o.ship_days),
        o.seen_at||'2026-11-09T00:00:00Z', o.gone_at||null, o.back_at||null,
        o.created_at||'2026-11-01T00:00:00Z').run();
const buy=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_buy (jan,qty,by_role,at,created_at,asin,name,sha,wholesale,
     reg_state,reg_sku,reg_at,ordered_at,ordered_by)
   VALUES (?1,?2,'admin',?3,?3,?4,?5,'いろは商会',3000,?6,?7,?8,?9,?10)`)
  .bind(o.jan, (o.qty===undefined?1:o.qty), '2026-11-01T00:00:00Z',
        o.asin||null, o.name||null, o.reg_state||'', o.reg_sku||null,
        o.reg_at||null, o.ordered_at||null, o.ordered_by||null).run();
const item=(env,jan)=>env.DB.prepare(
  `INSERT INTO items (asin,cond,scope,title,ebay_sku,ebay_item_id,updated_at)
   VALUES (?1,'new','ebay','x',?2,'1234567890',?3)`)
  .bind('W'+jan, 'W-'+jan, '2026-11-09T00:00:00Z').run();
const amz=(env,o)=>env.DB.prepare(
  `INSERT INTO mw_amz (jan,asin,name,price,basis,new_n,checked_at,
     fee_total,fee_ref,fee_fba,fee_tax,size_tier)
   VALUES (?1,?2,?3,?4,'カート',3,?5,?6,?7,?8,?9,'m')`)
  .bind(o.jan, o.asin||'B0TEST0001', o.name||'Amazon の名前',
        o.price||9000, '2026-11-09T00:00:00Z', o.fee_total||1500,
        975, 425, 97).run();
const AT='2026-11-09T01:00:00Z';

console.log('=== ① 取り込みの各回の中身（GET /mw/nt）===');
{
  const env=env0();
  await put(env,{ jan:'4902370550001', name:'欠品した商品', gone_at:AT });
  await put(env,{ jan:'4902370550002', name:'新しく出てきた商品',
    created_at:AT, seen_at:AT });
  await put(env,{ jan:'4902370550003', name:'戻ってきた商品', back_at:AT });
  await put(env,{ jan:'4902370550004', name:'関係のない商品' });
  const g=(await asJson(await worker.fetch(
    get('/mw/nt?at='+AT+'&kind=gone'),env,{}))).body;
  console.log('   '+JSON.stringify(g.rows.map((r)=>r.name)));
  ok(g.ok===true&&g.rows.length===1&&g.rows[0].name==='欠品した商品',
     '★★★新しく欠品になった商品を返す');
  ok(g.jans===1&&g.kind==='gone'&&g.at_jst,'★★件数と日時（日本時間）も返す');
  const n=(await asJson(await worker.fetch(
    get('/mw/nt?at='+AT+'&kind=new'),env,{}))).body;
  ok(n.rows.length===1&&n.rows[0].name==='新しく出てきた商品',
     '★★★新しく出てきた商品を返す');
  const b=(await asJson(await worker.fetch(
    get('/mw/nt?at='+AT+'&kind=back'),env,{}))).body;
  ok(b.rows.length===1&&b.rows[0].name==='戻ってきた商品',
     '★★★欠品から戻った商品を返す');
  /* 関係のない商品は、どの区分にも出ない。 */
  ok(!g.rows.concat(n.rows).concat(b.rows)
      .some((r)=>r.name==='関係のない商品'),
     '★★★その回に動いていない商品は返さない');
  const bad=(await asJson(await worker.fetch(
    get('/mw/nt?at=ほげ&kind=gone'),env,{}))).body;
  ok(bad.ok===false&&bad.error==='bad_at','★日時の形が違えば断る');
}
{
  /* 画面が相場の区分と見込み粗利を出せる形で返すこと。 */
  const env=env0();
  await put(env,{ jan:'4902370550011', name:'欠品', gone_at:AT });
  await amz(env,{ jan:'4902370550011' });
  await env.DB.prepare(
    `INSERT INTO mw_market (jan,n,n_new,low,low_any,low_ship,cur,checked_at,created_at)
     VALUES (?1,3,2,60,60,0,'USD',?2,?2)`)
    .bind('4902370550011','2026-11-09T00:00:00Z').run();
  await env.DB.prepare(
    `INSERT INTO mw_img (jan,pos,mw_id,url,w,h,long_px,bytes,ct,ok,err,at,created_at)
     VALUES (?1,0,'1','u',1200,1200,1200,1,'image/jpeg',1,'',?2,?2)`)
    .bind('4902370550011','2026-11-09T00:00:00Z').run();
  const d=(await asJson(await worker.fetch(
    get('/mw/nt?at='+AT+'&kind=gone'),env,{}))).body;
  const r=d.rows[0]||{};
  console.log('   '+JSON.stringify(Object.keys(r)).slice(0,300));
  ok(r.jan&&r.sha&&r.kishu&&r.name!==undefined,
     '★★★商品名・JAN・社・機種を返す');
  ok(+r.wholesale===3000,'★★★卸値を返す');
  ok(+r.mkt_n===3&&+r.mkt_low===60&&r.mkt_at,
     '★★★相場（候補一覧と同じ名前）を返す＝画面が区分を出せる');
  ok(r.asin==='B0TEST0001'&&+r.price===9000&&+r.fee_total===1500
     &&r.size_tier==='m',
     '★★★Amazon の値段と手数料（刈取と同じ名前）を返す＝見込み粗利が出せる');
  ok(+r.pics_ok===1,'★写真の枚数も返す');
  ok(r.ordered_at===''&&r.reg_state===''&&+r.reg_ok===0&&+r.ebay===0,
     '★★なぜ知らせに出たのかが分かる項目を返す');
  ok(d.over===W.MW_OVER,'★相場の115%の決まりも返す（画面と同じ判定に）');
}
{
  /* 作業者でも見られる（見るだけ）。 */
  const env=env0();
  await put(env,{ jan:'4902370550021', gone_at:AT });
  const r=await worker.fetch(new Request('https://x/mw/nt?at='+AT+'&kind=gone',
    { headers:{'X-PJ-Key':'staff-key-123'} }),env,{});
  ok(r.status===200,'★★作業者の鍵でも中身を見られる');
}

console.log('\n=== ② 「注文前に売り切れました」の誤報 ===');
{
  /* 薔薇と椿：MW の在庫を全部注文して CSV から消え、Amazon にも登録済み。 */
  const env=env0();
  const JAN='4570101051127';
  await put(env,{ jan:JAN, name:'薔薇と椿', gone_at:AT });
  await buy(env,{ jan:JAN, asin:'B0BARA0001' });   // reg_state は '' のまま
  await env.DB.prepare(
    `INSERT INTO mw_reg_log (at,sku,asin,jan,price,cond,ok,status,created_at)
     VALUES (?1,'mwhobby-20261108-N-B0BARA0001-3476','B0BARA0001',?2,8920,
             'new_new',1,'ACCEPTED',?1)`).bind('2026-11-08T00:00:00Z',JAN).run();
  const g=await W.mwNtGone(env,AT);
  console.log('   '+JSON.stringify(g));
  ok(g.length===1&&g[0].buy===false,
     '★★★mw_reg_log が通っていれば「注文前に売り切れ」にしない（誤報の原因）');
}
{
  /* mw… の SKU が在庫にあるとき。 */
  const env=env0();
  const JAN='4570101051128';
  await put(env,{ jan:JAN, gone_at:AT });
  await buy(env,{ jan:JAN, asin:'B0BARA0002' });
  await env.DB.prepare(
    `INSERT INTO skus (seller_sku,asin,cond,prefix,buy_src,jan,scope,active,updated_at)
     VALUES ('mwhobby-20261108-N-B0BARA0002-3476','B0BARA0002','new','mwhobby',
             'mw',?1,'ebay',1,?2)`).bind(JAN,'2026-11-08T00:00:00Z').run();
  const g=await W.mwNtGone(env,AT);
  ok(g.length===1&&g[0].buy===false,
     '★★★mw… の SKU が在庫にあれば「注文前に売り切れ」にしない');
}
{
  /* 「注文した」の印。 */
  const env=env0();
  const JAN='4570101051129';
  await put(env,{ jan:JAN, gone_at:AT });
  await buy(env,{ jan:JAN, ordered_at:'2026-11-08T00:00:00Z',
    ordered_by:'admin' });
  const g=await W.mwNtGone(env,AT);
  ok(g.length===1&&g[0].buy===false,
     '★★★「注文した」の印が付いていれば知らせの対象から外す');
}
{
  /* まだ何もしていない行は、今までどおり知らせる。 */
  const env=env0();
  const JAN='4570101051130';
  await put(env,{ jan:JAN, gone_at:AT });
  await buy(env,{ jan:JAN });
  const g=await W.mwNtGone(env,AT);
  ok(g.length===1&&g[0].buy===true,
     '★★★注文も登録もまだの行は、ちゃんと「注文前に売り切れ」で知らせる');
}
{
  /* 在庫0になった行（CSV には残っている）でも同じ。 */
  const env=env0();
  const JAN='4570101051131';
  await put(env,{ jan:JAN, stock:0, seen_at:AT });
  await buy(env,{ jan:JAN, ordered_at:'2026-11-08T00:00:00Z' });
  const z=await W.mwNtZero(env,AT);
  ok(z.length===1&&z[0].buy===false,
     '★★★在庫0になった行でも「注文した」なら知らせない');
}

/* ②の根っこ（Amazon に登録が通ったら mw_buy も「登録済み」にする）は、
   登録の口をまるごと動かす tests/mwput.mjs で確かめている。 */

console.log('\n=== ③ 欠品は関わりのあるものだけ並べる ===');
{
  const env=env0();
  sent=[];
  /* eBay 出品中・仕入れる印・刈取の見込みあり・関係なし を1件ずつ。 */
  await put(env,{ jan:'4902370550101', name:'eBayに出していた', gone_at:AT });
  await item(env,'4902370550101');
  await put(env,{ jan:'4902370550102', name:'仕入れる印あり', gone_at:AT });
  await buy(env,{ jan:'4902370550102' });
  await put(env,{ jan:'4902370550103', name:'刈取の見込みあり', gone_at:AT,
    list_price:20000, wholesale:3000 });
  await put(env,{ jan:'4902370550104', name:'関係ない1', gone_at:AT,
    list_price:3000, wholesale:2900 });
  await put(env,{ jan:'4902370550105', name:'関係ない2', gone_at:AT,
    list_price:3000, wholesale:2900 });
  const res={ gone_jan:5, gone_all_jan:5, added_jan:0, back_jan:0, zeroed:1 };
  emb=[]; msgs=[];
  const n=await W.mwImportNotify(env,W.newRun('t'),AT,res);
  const txt=sent.join('\n'), et=embText();
  console.log('   '+txt.replace(/\n/g,' ⏎ ').slice(0,300));
  console.log('   埋め込み '+emb.length+'個：'+emb.map((e)=>e.title).join('／'));
  ok(n>=1,'★知らせを送った');
  ok(emb.some((e)=>e.title==='eBayに出していた'),
     '★★★eBay に出していた商品は並べる');
  ok(emb.some((e)=>e.title==='仕入れる印あり'),
     '★★★仕入れる印の商品は並べる');
  ok(/刈取の見込みがあった商品が売り切れました/.test(txt)
     &&emb.some((e)=>e.title==='刈取の見込みあり'),
     '★★★刈取の見込みがあった商品も並べる');
  /* 7.126（【T】）：関係のない欠品も**商品ごとに**出す（いちばん下の区分）。
     件数だけに戻したいときは ⚙ mwNtRest をオフにする。 */
  ok(/そのほかの欠品/.test(txt)
     &&emb.some((e)=>/関係ない/.test(String(e.title||''))),
     '★★★関係のない欠品も商品ごとに出す（7.126）');
  ok(emb.filter((e)=>/関係ない/.test(String(e.title||''))).length===2,
     '★★★2件ぜんぶ出す');
  ok(res.note_hope===1&&res.note_rest===2,'★★内訳を返す');
  ok(/新しく欠品 5件/.test(txt)&&/欠品から戻った 0件/.test(txt),
     '★★先頭に件数を出す（戻ったも）');
  ok(/社 いろは商会/.test(et),'★★★埋め込みに社も出す');
}
{
  /* 新しく出てきた商品は全件（10件を超えたら上位10件と件数）。 */
  const env=env0();
  sent=[];
  for(let i=0;i<14;i++)
    await put(env,{ jan:'490237055'+String(1000+i), name:'新入荷'+i,
      created_at:AT, seen_at:AT, list_price:20000, wholesale:3000 });
  const res={ gone_jan:0, gone_all_jan:0, added_jan:14, back_jan:0 };
  emb=[]; msgs=[];
  await W.mwImportNotify(env,W.newRun('t'),AT,res);
  const txt=sent.join('\n');
  const n2=emb.filter((e)=>/^新入荷\d+$/.test(String(e.title||''))).length;
  console.log('   埋め込み '+n2+'個　通数 '+msgs.length);
  /* 7.126（【T】）：既定を 100件に上げたので 14件は**ぜんぶ**出る。 */
  ok(n2===14,'★★★14件ぜんぶ出す（既定 100件・7.126）');
  ok(msgs.every((m)=>((m.embeds||[]).length<=W.EMB_MAX)),
     '★★★1通に入れる埋め込みは10個まで（Discord の決まり）');
  ok(!/ほか \d+件/.test(txt),'★★★既定の件数に収まれば「ほか n件」は出ない');
  ok(W.MW_NT_TOP===100&&W.MW_NT_MAX===200,
     '★★既定は100件・上限は200件（⚙で変えられる）');
  ok(/新しく出てきた 14件/.test(txt),'★★先頭に全件数を出す');
  ok(emb.every((e)=>e.color===W.EMB_COLOR['new']),
     '★★★新入荷は緑');
}

console.log('\n=== ④ Discord のリンク ===');
{
  const env=env0();
  sent=[];
  await put(env,{ jan:'4902370550201', name:'eBayに出していた', gone_at:AT });
  await item(env,'4902370550201');
  await W.mwImportNotify(env,W.newRun('t'),AT,
    { gone_jan:1, gone_all_jan:1, added_jan:0, back_jan:0 });
  const txt=sent.join('\n'), et=embText();
  /* 7.125（【S】の2）：pj へのリンクと「長押し →Safari で開く」は**出さない**。
     Discord の中のブラウザはキーを持っていないので役に立たない。 */
  ok(!/github\.io\/pj_price/.test(txt)&&!/github\.io\/pj_price/.test(et),
     '★★★pj へのリンクは出さない（キーが無くて役に立たない）');
  ok(!/#tab=/.test(txt)&&!/#tab=/.test(et),'★★★#tab=… も出さない');
  ok(!/長押し/.test(txt)&&!/Safari/.test(txt),
     '★★★「長押し →Safari で開く」も出さない');
  /* `?k=` は Amazon の検索の綴りなので除く（pj のキーは key= / x-pj-key）。 */
  ok(!/x-pj-key|X-PJ-Key|[?&]key=|pj_key/i.test(txt+et),
     '★★★キーはどこにも入れない（Discord の履歴に鍵を残さない）');
  /* そのぶん、埋め込みの中に商品のリンク（Amazon・Keepa）を出す。 */
  ok(/amazon\.co\.jp/.test(et)&&/keepa\.com/.test(et),
     '★★★代わりに Amazon と Keepa のリンクを出す');
}

console.log('\n=== ⑤ 長い知らせは分けて送る ===');
{
  const env=env0();
  sent=[];
  const long=[];
  for(let i=0;i<4;i++){
    const b=['','見出し'+i];
    for(let k=0;k<12;k++)b.push('  '+'あ'.repeat(60)+i+k);
    long.push(b);
  }
  const n=await W.notifyBlocks(env,W.newRun('t'),['先頭'],long);
  console.log('   '+n+'通　長さ '+sent.map((x)=>x.length).join('/'));
  ok(n>=2,'★★★1通に入らないときは分けて送る');
  ok(sent.every((x)=>x.length<=W.NOTIFY_MAX),
     '★★★どの通も Discord の上限（'+W.NOTIFY_MAX+'字）に収まる');
  ok(/先頭/.test(sent[0]),'★★1通目に先頭の行を出す');
  ok(/（1\/\d+通）/.test(sent[0]),'★★何通目かを出す');
  const all=sent.join('\n');
  ok([0,1,2,3].every((i)=>new RegExp('見出し'+i).test(all)),
     '★★★どの塊も落とさない');
  /* 塊の途中で切るときは見出しを繰り返す。 */
  sent=[];
  const one=['','ひとつの長い塊'];
  for(let k=0;k<60;k++)one.push('  '+'い'.repeat(60)+k);
  await W.notifyBlocks(env,W.newRun('t'),[],[one]);
  ok(sent.length>1&&/（つづき）/.test(sent.join('\n')),
     '★★★塊が1通に入らないときは見出しに「（つづき）」を付ける');
  ok(sent.every((x)=>/ひとつの長い塊/.test(x)),'★★どの通にも見出しを出す');
}
{
  /* 短い知らせは1通のまま。 */
  const env=env0();
  sent=[];
  const n=await W.notifyBlocks(env,W.newRun('t'),['先頭'],[['','見出し','  行']]);
  ok(n===1&&sent.length===1&&!/\d\/\d通/.test(sent[0]),
     '★★★短いときは1通のまま（「n/m通」も付けない）');
}

await T.done();
