/* Worker：写真が使えなかった JAN を7日間覚える（8.90）

   カジの依頼（2026-11-22）MW 無在庫の出品候補で、「JAN:番号」で写真を
   取り込んでも使えなかった商品が、毎回候補の先頭に来る。
   ① 取り込み（POST /mw/img）で使える写真が1枚も無ければ記録する
      small … 長辺 500px 未満　none … MW に写真が無い（404 など）
   ② 使える写真が取れたら、その場で記録を消す。測るだけ（probe）は記録しない
   ③ 7日たったら記録を消す（MW の写真が差し替わっていることがあるため）
   ④ GET /mw/picng … 一覧と件数（はじめての1回だけ、これまでの控え mw_img から
      7日以内の「使える写真が無かった」JAN を記録に入れる）
   ⑤ POST /mw/picng … 「JAN:」だけで番号が無かった JAN（MW に写真が無い）
   ⑥ 表が無い D1 でも落ちない */
import { harness, loadWorker, makeEnv, get, asJson } from './lib.mjs';
const T=harness('Worker：写真が使えなかった JAN（8.90）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('picng');

let imgs={};
globalThis.fetch=async(u)=>{
  const url=String(u);
  if(/matchingworld\.asia/.test(url)){
    const v=imgs[url];
    if(v===undefined)return new Response('nf',{status:404});
    return new Response(v,{status:200,headers:{'content-type':'image/jpeg'}});
  }
  if(/discord/.test(url))return new Response(null,{status:204});
  throw new Error('外へ出てはいけない: '+url);
};
function jpeg(w,h,pad){
  const head=[0xff,0xd8,0xff,0xc0,0x00,0x11,0x08,(h>>8)&255,h&255,(w>>8)&255,w&255,
    0x03,0x01,0x11,0x00,0x02,0x11,0x01,0x03,0x11,0x01];
  const a=new Uint8Array(head.length+(pad||0));
  a.set(head,0); for(let i=head.length;i<a.length;i++)a[i]=0x5a;
  return a;
}
const U=(id)=>W.mwImgUrl(id);
imgs[U(10921742)]=jpeg(1600,1200,400);     // 使える
imgs[U(10921743)]=jpeg(400,300,100);       // 小さすぎる
imgs[U(10921745)]=jpeg(480,320,100);       // 小さすぎる
const call=async(env,path,body,wk)=>asJson(await (wk||worker).fetch(body
  ?new Request('https://x'+path,{method:'POST',headers:{'X-PJ-Key':'k',
    'content-type':'application/json'},body:JSON.stringify(body)})
  :get(path),env));
const rec=async(env,jan)=>await env.DB.prepare(`SELECT * FROM mw_pic_ng WHERE jan=?1`)
  .bind(jan).first();
const J1='4902370550467', J2='4580416924740', J3='4988611224878', J4='4970381909444';
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123' });

console.log('=== ① ② 取り込みで記録する・取れたら消す ===');
{
  const env=env0();
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,created_at)
     VALUES (?1,'いろは商会',0,'NS','小さい写真の商品',0,'h',?2,?2)`)
    .bind(J1,new Date().toISOString()).run();
  /* はじめての一覧（これまでの控えから入れる1回）を先に済ませておく。 */
  ok((await call(env,'/mw/picng')).body.backfill===0,'★控えが無ければ何も入れない');
  let r=(await call(env,'/mw/img',{ jan:J1, ids:['10921743','10921745'] })).body;
  let x=await rec(env,J1);
  console.log('   長辺 '+JSON.stringify(r.rows.map((y)=>y.long))+' → 記録 '+JSON.stringify(x&&{ why:x.why, long:x.long_px, n:x.n }));
  ok(r.ok&&r.good===0&&r.pic_ng==='small','★★★長辺500px未満しか無ければ「small」として記録');
  ok(x&&x.why==='small'&&x.long_px===480&&x.n===2,'★★★いちばん大きい長辺（480px）と枚数を控える');
  r=(await call(env,'/mw/img',{ jan:J2, ids:['10921799'] })).body;
  x=await rec(env,J2);
  ok(r.good===0&&r.pic_ng==='none'&&x&&x.why==='none'&&x.long_px===0,
     '★★★MW に写真が無い（404）→「none」として記録');
  r=(await call(env,'/mw/img',{ jan:J3, ids:['10921799'], probe:true })).body;
  ok(!r.pic_ng&&!(await rec(env,J3)),'★★測るだけ（probe）は記録しない');
  r=(await call(env,'/mw/img',{ jan:J2, ids:['10921742'] })).body;
  ok(r.good===1&&!(await rec(env,J2)),'★★★使える写真が取れたら、その場で記録を消す');

  console.log('\n=== ④ 一覧と件数 ===');
  const d=(await call(env,'/mw/picng')).body;
  console.log('   件数 '+d.n+' '+JSON.stringify(d.rows.map((y)=>y.jan+':'+y.why+':'+y.until_jst)));
  ok(d.ok&&d.n===1&&d.rows[0].jan===J1&&d.days===7,'★★★記録の一覧と件数を返す');
  const y=d.rows[0];
  ok(y.name==='小さい写真の商品'&&y.long===480&&!!y.at_jst&&!!y.until_jst,
     '★★商品名・長辺・記録した日・戻る日を出す');
  ok(Math.abs(Date.parse(y.until)-Date.parse(y.at)-7*86400000)<1000,'★★★戻る日は記録の7日後');
  ok(!/matchingworld|いろは商会/.test(JSON.stringify(d)),'★MW の URL・社は返さない');

  console.log('\n=== ③ 7日たったら消す ===');
  await env.DB.prepare(`UPDATE mw_pic_ng SET at=?2 WHERE jan=?1`)
    .bind(J1,new Date(Date.now()-7*86400000-60000).toISOString()).run();
  const e=(await call(env,'/mw/picng')).body;
  ok(e.ok&&e.n===0&&e.expired===1&&!(await rec(env,J1)),'★★★7日を過ぎた記録は消す（候補に戻る）');
  /* 6日前の記録は残る。 */
  await W.mwPicNgPut(env,J4,'none',0,0);
  await env.DB.prepare(`UPDATE mw_pic_ng SET at=?2 WHERE jan=?1`)
    .bind(J4,new Date(Date.now()-6*86400000).toISOString()).run();
  ok((await call(env,'/mw/picng')).body.n===1,'★★7日たつまでは残す');
}

console.log('\n=== ④ はじめての1回だけ、これまでの控えから入れる ===');
{
  const env=env0();
  const at=(d)=>new Date(Date.now()-d*86400000).toISOString();
  const img=(jan,pos,ok1,lg,d)=>env.DB.prepare(
    `INSERT INTO mw_img (jan,pos,mw_id,src,w,h,long_px,bytes,ct,ok,err,at,created_at)
     VALUES (?1,?2,1,'x',?4,?4,?4,1,'image/jpeg',?3,'',?5,?5)`).bind(jan,pos,ok1,lg,at(d)).run();
  await img(J1,0,0,400,2); await img(J1,1,0,300,2);   // 小さいだけ（2日前）
  await img(J2,0,1,1600,1);                           // 使える写真あり
  await img(J3,0,0,450,10);                           // 10日前（7日を過ぎた）
  await img(J4,0,0,0,3);                              // 404（3日前）
  const d=(await call(env,'/mw/picng')).body;
  console.log('   入れた '+d.backfill+'件 → '+JSON.stringify(d.rows.map((y)=>y.jan+':'+y.why+':'+y.long)));
  ok(d.backfill===2&&d.n===2,'★★★7日以内で使える写真が無かった JAN（2件）を入れる');
  ok(d.rows.some((y)=>y.jan===J1&&y.why==='small'&&y.long===400)
     &&d.rows.some((y)=>y.jan===J4&&y.why==='none'),'★★長辺が分かれば small・無ければ none');
  ok(!d.rows.some((y)=>y.jan===J2||y.jan===J3),'★★使える写真がある JAN・7日を過ぎた JAN は入れない');
  const r1=d.rows.filter((y)=>y.jan===J1)[0];
  ok(Math.abs(Date.parse(r1.at)-Date.parse(at(2)))<5000,'★★★記録した日は取り込んだ日（7日はそこから数える）');
  await env.DB.prepare(`DELETE FROM mw_pic_ng`).run();
  const d2=(await call(env,'/mw/picng')).body;
  ok(d2.backfill===0&&d2.n===0,'★★入れるのは1回だけ（消したあとに戻さない）');
}

console.log('\n=== ⑤ 「JAN:」だけで番号が無かった JAN ===');
{
  const env=env0();
  await env.DB.prepare(
    `INSERT INTO mw_img (jan,pos,mw_id,src,w,h,long_px,bytes,ct,ok,err,at,created_at)
     VALUES (?1,0,1,'x',1600,1200,1600,1,'image/jpeg',1,'',?2,?2)`)
    .bind(J2,new Date().toISOString()).run();
  const r=(await call(env,'/mw/picng',{ jans:[J1,J2,'123','abc'] })).body;
  ok(r.ok&&r.n===1&&(await rec(env,J1)).why==='none','★★★MW に写真が無い JAN として記録');
  ok(!(await rec(env,J2)),'★★もう使える写真を控えてある JAN は記録しない');
  ok((await call(env,'/mw/picng',{})).body.n===0,'★空でも落ちない');
}

console.log('\n=== ⑥ 表が無い D1 ===');
{
  /* 「表がある」は worker のなかで覚えている（COL_OK）ので、別の worker を読む。 */
  const { worker:w2 }=await loadWorker('picng-notable');
  const env=env0();
  await env.DB.prepare(`DROP TABLE mw_pic_ng`).run();
  const d=(await call(env,'/mw/picng',null,w2)).body;
  ok(d.ok===false&&d.table_ok===false&&/0072/.test(d.detail),'★★表が無いと言う（migrate-0072）');
  imgs[U(10921743)]=jpeg(400,300,100);
  const r=(await call(env,'/mw/img',{ jan:J1, ids:['10921743'] },w2)).body;
  ok(r.ok===true&&r.good===0,'★★★表が無くても写真の取り込みは止めない');
  ok(W.MW_PIC_NG_DAYS===7,'★7日');
}

T.done();
