/* Worker：会員に配信する商品を海外向け（os-）にも出す（8.113・v364）
   ・刈取の行の「海外向けにも出す」の印（os_pick・管理者だけ）
   ・GET /mw/sub に印と「会員向けのカードを最初に送った日時」と会員の注文の点数
   ・os- の在庫の直し：海外向けにも出している JAN は、会員がまだ買える分（上限 − 注文）を MW の在庫から先に引く
   ・(C) os- が日本で売られる設定になっていないか（publishedInContext country JP・読むだけ） */
import fs from 'node:fs';
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
const T=harness('Worker：会員の品を海外向け（os-）にも出す（8.113）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('ospick');
let gq=[], jpMap={}, profDeny=false;
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/\/admin\/oauth\/access_token/.test(url))
    return new Response(JSON.stringify({access_token:'shpat_t',scope:'read_products',expires_in:86399}),{status:200});
  if(/\/admin\/api\/.*graphql/.test(url)){
    const b=JSON.parse(o.body); gq.push(b);
    if(profDeny&&/deliveryProfile/.test(b.query))
      return new Response(JSON.stringify({errors:[{message:'Access denied for deliveryProfile field. Required access: `read_shipping`'}]}),{status:200});
    const nodes=Object.keys(jpMap).map((h)=>({ handle:h, status:'ACTIVE', publishedInContext:jpMap[h],
      variants:{ nodes:[{ deliveryProfile:{ name:h.startsWith('os-')?'海外のみ':'General' } }] } }));
    return new Response(JSON.stringify({data:{products:{nodes}}}),{status:200});
  }
  return new Response('{}',{status:200});
};
const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123', SHOPIFY_CLIENT_ID:'cid', SHOPIFY_CLIENT_SECRET:'csec' });
const api=async(env,path,body,key)=>{ const h={'X-PJ-Key':key||'k','content-type':'application/json'};
  return await asJson(await worker.fetch(new Request('https://x'+path,body?{method:'POST',headers:h,body:JSON.stringify(body)}:{headers:h}),env,{})); };
const J='4902370550901', J2='4902370550902';
const now=new Date().toISOString(), ago=(d)=>new Date(Date.now()-d*86400000).toISOString();

console.log('=== ① 海外向けにも出す印 ===');
const env=env0();
await env.DB.prepare(`INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,wholesale,row_hash,pick,seen_at,created_at)
  VALUES (?1,'い',0,'NS','ゲーム',20,3000,'h',1,?2,?2),(?3,'い',0,'NS','ゲーム2',5,3000,'h',1,?2,?2)`).bind(J,now,J2).run();
await env.DB.prepare(`INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,at,created_at)
  VALUES (?1,1,6,3645,'',?2,?2,?2,?2),(?3,1,6,3645,'',?2,?2,?2,?2)`).bind(J,now,J2).run();
let r=await api(env,'/mw/os',{ jan:J, on:1 },'staff-key-123');
ok(r.status===403,'★★印を付けるのは管理者だけ');
r=await api(env,'/mw/os',{ jan:J, on:1 });
ok(r.body.ok&&r.body.n===1,'★★★印を付ける（os_pick）');
const row=await env.DB.prepare(`SELECT * FROM os_pick WHERE jan=?1`).bind(J).first();
ok(!!row&&row.on_===1&&!!row.at,'★印を D1 に控える（PC とスマホで同じ）');
ok(!/price|wholesale|name/.test(fs.readFileSync(new URL('../proxy-sync/migrate-0078-os-pick.sql',import.meta.url),'utf8').replace(/--.*$/gm,'')),
   '★印の表に値段・卸値・商品名は持たない');

console.log('\n=== ② 会員の一覧に印・配信した日時・注文の点数 ===');
await env.DB.prepare(`INSERT INTO sub_post (jan,ch,plan,msg_id,price,qty,at,created_at) VALUES (?1,'111','monitor','m1',3645,6,?2,?2),(?1,'222','light','m2',3645,6,?3,?3)`)
  .bind(J,ago(9),ago(2)).run();
await env.DB.prepare(`INSERT INTO sub_order (order_no,sku,jan,qty,at,created_at) VALUES ('#1001','SUB-'||?1,?1,2,?2,?2)`).bind(J,now).run();
const l=await api(env,'/mw/sub?all=1');
const x=l.body.rows.find((z)=>z.jan===J), x2=l.body.rows.find((z)=>z.jan===J2);
console.log('   '+JSON.stringify({os_on:x.os_on,posted_at:x.posted_at,sold:x.sold,left:x.left}));
ok(x.os_on===1&&x2.os_on===0,'★★★一覧に「海外向けにも出す」の印');
ok(x.posted_at===ago(9).slice(0,10)+x.posted_at.slice(10)||Date.parse(x.posted_at)<Date.now()-8*86400000,
   '★★★会員向けのカードを最初に送った日時（いちばん早い日）');
ok(x.sold===2&&x.left===4,'★★会員がもう買った数と残り（上限6・注文2）');
ok(!('wholesale' in x),'★卸値は返さない（今までどおり）');

console.log('\n=== ③ os- の在庫の直しで会員の分を先に引く ===');
await env.DB.prepare(`INSERT INTO os_item (jan,handle,sku,name,price,qty,wholesale,at,created_at,updated_at)
  VALUES (?1,'os-'||?1,'os-'||?1,'Game',9000,16,3000,?2,?2,?2)`).bind(J,now).run();
/* MW の在庫が 20 → 6 に減った。会員の残り 4 を引くと 2。 */
await env.DB.prepare(`UPDATE mw_stock SET stock=6 WHERE jan=?1`).bind(J).run();
let c=await W.osCheck(env,W.newRun('t'),{});
let fx=await env.DB.prepare(`SELECT fix_why, fix_qty FROM os_item WHERE jan=?1`).bind(J).first();
console.log('   '+JSON.stringify(fx));
ok(!fx.fix_why,'★★6 − 4 ＝ 2 残るうちは品切れにしない（今までどおり、品切れと値段の変化だけ印を付ける）');
/* MW の在庫が会員の残り以下（4）になったら os- は0（品切れ） */
await env.DB.prepare(`UPDATE mw_stock SET stock=4 WHERE jan=?1`).bind(J).run();
await env.DB.prepare(`UPDATE os_item SET fix_at=NULL, fix_why=NULL WHERE jan=?1`).bind(J).run();
c=await W.osCheck(env,W.newRun('t'),{});
fx=await env.DB.prepare(`SELECT fix_why, fix_qty FROM os_item WHERE jan=?1`).bind(J).first();
ok(fx.fix_why==='gone'&&fx.fix_qty===0,'★★★会員の分を引いて0以下なら os- は品切れにする');
/* 印を外せば今までどおり（MW の在庫だけで見る） */
await api(env,'/mw/os',{ jan:J, on:0 });
await env.DB.prepare(`UPDATE os_item SET fix_at=NULL, fix_why=NULL, qty=16 WHERE jan=?1`).bind(J).run();
c=await W.osCheck(env,W.newRun('t'),{});
fx=await env.DB.prepare(`SELECT fix_why, fix_qty FROM os_item WHERE jan=?1`).bind(J).first();
ok(!fx.fix_why||fx.fix_why!=='gone','★印の無い os- は今までどおり（会員の分は引かない）');
ok(W.osFixOf({ live:1, now_stock:10, qty:8, wholesale:1000, now_px:1000 },1).qty===8
   &&W.osFixOf({ live:1, now_stock:10, mem_left:6, qty:8, wholesale:1000, now_px:1000 },1).qty===4,
   '★決まり：会員の残りを引いた在庫と、いまの os- の数の少ないほう（増やさない）');

console.log('\n=== ④ (C) os- が日本で売られていないか（読むだけ）===');
const e2=env0();
await e2.DB.prepare(`INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)`)
  .bind(JSON.stringify({ at:now, settings:{ subShopAdmin:'pj-test.myshopify.com' } }),now).run();
jpMap={ 'os-1':true, 'os-2':false, 'os-3':false, 'sub-9':false };
gq=[];
let jp=await api(e2,'/shop/os/jp');
console.log('   '+JSON.stringify(jp.body));
ok(jp.body.ok&&jp.body.n===3&&jp.body.jp===1&&jp.body.not_jp===2&&jp.body.jp_handles[0]==='os-1',
   '★★★日本のお客さんに出ている os- の件数と例（sub- は数えない）');
ok(/publishedInContext\(context: \{ country: JP \}\)/.test(gq[0].query)&&gq[0].variables.q==='tag:export',
   '★★Shopify の publishedInContext（国＝JP）で見る・tag:export の商品');
ok(jp.body.prof_ok&&jp.body.profiles['海外のみ']===3,'★配送プロファイルが読めるときは名前ごとの件数');
ok(!gq.some((b)=>/mutation/.test(b.query)),'★★★読むだけ（Shopify に書き込まない）');
profDeny=true; gq=[];
jp=await api(e2,'/shop/os/jp');
ok(jp.body.ok&&!jp.body.prof_ok&&!/deliveryProfile/.test(gq[gq.length-1].query)&&jp.body.n===3,
   '★配送プロファイルを読めないときは、それを外して聞き直す');
profDeny=false;
const st=await api(e2,'/shop/os/jp',null,'staff-key-123');
ok(st.status===403,'★★管理者だけ');
const e3=makeEnv(); const nk=await api(e3,'/shop/os/jp');
ok(nk.body.ok===false&&(nk.body.error==='no_host'||nk.body.error==='no_key'),'★宛先や鍵が無いときはそう言う');
ok(W.schemaFixOf('os_pick')==='migrate-0078-os-pick.sql','★表が無いときに流すマイグレーション');
T.done();
