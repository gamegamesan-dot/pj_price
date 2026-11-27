/* Worker：英題の作り直しの候補（8.108・v358）

   カジの依頼（2026-11-27）「まず50件だけで試す。選び方は、閲覧が少なく、まだ1つも売れて
   いない出品から。売れた実績のある出品は今回は対象から外す」。
   ・出品中リストの取り込みで、無在庫（W-）のいまの題名・売れた数・ウォッチの数を ebay_stat に控える
     （items はもう100列なので別の表・migrate-0075）
   ・GET /titlefix/cands：W-・ItemID あり・在庫あり・売れた数 0・eBay の注文なし・14日以上前の出品。
     閲覧数（GetItem の HitCount）を取って少ない順。MW の商品名を返すので管理者だけ */
import fs from 'node:fs';
import { harness, loadWorker, makeEnv, asJson } from './lib.mjs';
const T=harness('Worker：英題の作り直しの候補（8.108）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('titlefix');
const env=makeEnv({ STAFF_KEY:'staff-key-123', EBAY_CLIENT_ID:'c', EBAY_CLIENT_SECRET:'x', EBAY_USER_REFRESH_TOKEN:'r' });
const db=env.DB._db;
const old=new Date(Date.now()-30*86400000).toISOString();
const fresh=new Date(Date.now()-2*86400000).toISOString();
const J=(n)=>'49000000000'+String(n).padStart(2,'0');
/* eBay への通信を差し替える */
let active=[], hits={}, getItemN=0, noHits=false;
const itemXml=(x)=>'<Item><ItemID>'+x.id+'</ItemID><SKU>'+x.sku+'</SKU>'
  +'<Title>'+x.title+'</Title><Quantity>'+(1+(x.sold||0))+'</Quantity>'
  +'<SellingStatus><QuantitySold>'+(x.sold||0)+'</QuantitySold>'
  +'<CurrentPrice currencyID="USD">20.00</CurrentPrice></SellingStatus>'
  +(x.watch===undefined?'':('<WatchCount>'+x.watch+'</WatchCount>'))
  +'<ListingDetails><StartTime>'+(x.start||old)+'</StartTime></ListingDetails>'
  +'<QuantityAvailable>1</QuantityAvailable></Item>';
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),{status:200});
  if(/ws\/api\.dll/.test(url)){
    const name=(o.headers||{})['X-EBAY-API-CALL-NAME']||'';
    if(name==='GetMyeBaySelling')
      return new Response('<GetMyeBaySellingResponse><Ack>Success</Ack><ActiveList>'
        +'<PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages></PaginationResult><ItemArray>'
        +active.map(itemXml).join('')+'</ItemArray></ActiveList></GetMyeBaySellingResponse>',{status:200});
    if(name==='GetItem'){
      getItemN++;
      const id=/<ItemID>(\d+)<\/ItemID>/.exec(String(o.body))[1];
      const a=active.find((x)=>x.id===id)||{};
      return new Response('<GetItemResponse><Ack>Success</Ack><Item><ItemID>'+id+'</ItemID>'
        +'<SKU>'+(a.sku||'')+'</SKU><Title>'+(a.title||'')+'</Title><Quantity>2</Quantity>'
        +(noHits?'':('<HitCount>'+(hits[id]||0)+'</HitCount>'))
        +'<WatchCount>'+(a.watch||0)+'</WatchCount>'
        +'<SellingStatus><QuantitySold>'+(a.getSold||a.sold||0)+'</QuantitySold>'
        +'<CurrentPrice currencyID="USD">20.00</CurrentPrice><ListingStatus>Active</ListingStatus>'
        +'</SellingStatus></Item></GetItemResponse>',{status:200});
    }
    return new Response('<x><Ack>Success</Ack></x>',{status:200});
  }
  if(/discord/.test(url))return new Response('',{status:204});
  throw new Error('想定外の通信: '+url);
};
/* 出品：1〜5 は候補、6 は売れた（QuantitySold 1）、7 は eBay の注文あり、
   8 は出したばかり、9 は E-（W- でない）、10 は GetItem で売れていたと分かる */
active=[
  {id:'101',sku:'W-'+J(1),title:'Banpresto Hazbin Hotel Alastor Figure',watch:0},
  {id:'102',sku:'W-'+J(2),title:'Title Two',watch:3},
  {id:'103',sku:'W-'+J(3),title:'Title Three',watch:1},
  {id:'104',sku:'W-'+J(4),title:'Title Four',watch:0},
  {id:'105',sku:'W-'+J(5),title:'Title Five'},
  {id:'106',sku:'W-'+J(6),title:'Sold One',sold:1,watch:0},
  {id:'107',sku:'W-'+J(7),title:'Ordered One',watch:0},
  {id:'108',sku:'W-'+J(8),title:'Fresh One',watch:0,start:fresh},
  {id:'109',sku:'E-B0TESTTEST',title:'Amazon One',watch:0},
  {id:'110',sku:'W-'+J(10),title:'Sold Later',watch:0,getSold:2},
];
hits={'101':12,'102':3,'103':40,'104':7,'105':0,'110':1};
db.prepare(`INSERT INTO orders (channel,order_id,line_id,sku,asin,cond,qty,created_at)
  VALUES ('ebay','O7','L1','W-${J(7)}','W${J(7)}','new',1,'x')`).run();
for(const n of [1,2,3,4,5,6,7,8,10])
  db.prepare(`INSERT INTO mw_stock (jan,sha,idx,kishu,name,row_hash,seen_at,created_at,pick,stock)
    VALUES (?,?,0,?,?,'h','x','x',1,3)`).run(J(n),'A',n===2?'NS':'b2cchara_figure','MW の商品 '+n);

console.log('=== 出品中リストの取り込みで ebay_stat に控える ===');
await W.syncEbayActive(env,W.newRun('ebay'));
const st=db.prepare("SELECT asin,item_id,title,sold,watch FROM ebay_stat ORDER BY asin").all();
console.log('   '+st.length+'件 '+JSON.stringify(st[0]));
ok(st.length===9,'★★★無在庫（W-）の出品だけ控える（E- は控えない）');
const s1=st.find((x)=>x.asin==='W'+J(1)), s6=st.find((x)=>x.asin==='W'+J(6)), s5=st.find((x)=>x.asin==='W'+J(5));
ok(s1.title==='Banpresto Hazbin Hotel Alastor Figure'&&s1.item_id==='101','★★いまの eBay の題名と ItemID');
ok(s6.sold===1&&s1.sold===0,'★★その出品で売れた数（QuantitySold）');
ok(s1.watch===0&&st.find((x)=>x.asin==='W'+J(2)).watch===3&&s5.watch===null,'★ウォッチの数（返らない出品は空のまま）');
/* 題名を Revise で直したら次の取り込みで入れ替わる。items.title は最初の題名のまま */
active[0].title='Banpresto Hazbin Hotel Alastor Radio Demon Prize Figure Japan Import New';
await W.syncEbayActive(env,W.newRun('ebay'));
const s1b=db.prepare("SELECT title FROM ebay_stat WHERE asin=?").get('W'+J(1));
const it1=db.prepare("SELECT title FROM items WHERE asin=?").get('W'+J(1));
ok(s1b.title===active[0].title&&it1.title==='Banpresto Hazbin Hotel Alastor Figure',
   '★★題名を直したら ebay_stat は新しい題名・items.title は最初の題名のまま');
active[0].title='Banpresto Hazbin Hotel Alastor Figure';
await W.syncEbayActive(env,W.newRun('ebay'));

console.log('\n=== GET /titlefix/cands ===');
const ask=async(q,key)=>asJson(await worker.fetch(new Request('https://x/titlefix/cands'+(q||''),
  {headers:{'X-PJ-Key':key||'k'}}),env,{waitUntil(){}}));
let r=await ask('?n=50','staff-key-123');
ok(r.status===403,'★★★作業者のキーでは使えない（MW の商品名を返すので管理者だけ）');
r=await ask('?n=50');
const ids=(r.body.rows||[]).map((x)=>x.item_id);
console.log('   '+JSON.stringify({n:r.body.n,pool:r.body.pool,sort:r.body.sort,ids,views:(r.body.rows||[]).map((x)=>x.views)}));
ok(r.body.ok&&ids.join()==='105,102,104,101,103','★★★閲覧数の少ない順（0・3・7・12・40）');
ok(!ids.includes('106'),'★★★売れた実績のある出品（その出品で売れた数）は外す');
ok(!ids.includes('107'),'★★★eBay の注文がある出品も外す');
ok(!ids.includes('110'),'★★GetItem で売れていたと分かった出品も外す');
ok(!ids.includes('108'),'★★出したばかり（14日未満）の出品は選ばない（閲覧が少ないのは当たり前なので）');
ok(!ids.includes('109'),'★W- でない出品は選ばない');
const c1=r.body.rows.find((x)=>x.item_id==='101');
ok(c1.mw_name==='MW の商品 1'&&c1.jan===J(1)&&c1.kishu==='b2cchara_figure'&&c1.title==='Banpresto Hazbin Hotel Alastor Figure',
   '★★作り直しに使う MW の商品名・JAN・機種・いまの題名を返す');
const v=db.prepare("SELECT views,views_at FROM ebay_stat WHERE asin=?").get('W'+J(3));
ok(v.views===40&&!!v.views_at,'★★閲覧数（HitCount）を ebay_stat に控える');
const n1=getItemN;
r=await ask('?n=2');
ok(getItemN===n1,'★24時間以内に取った閲覧数は使い回す（eBay に聞き直さない）');
ok(r.body.rows.length===2&&r.body.rows[0].item_id==='105','★件数（n）の分だけ返す');
r=await ask('?n=50&min_days=0');
ok(r.body.rows.some((x)=>x.item_id==='108'),'★min_days=0 なら出したばかりも選べる');
/* 閲覧数が返らない（HitCount なし）ときはウォッチの少ない順 */
db.prepare("UPDATE ebay_stat SET views=NULL, views_at=NULL").run();
noHits=true;
r=await ask('?n=50');
console.log('   '+JSON.stringify({sort:r.body.sort,ids:r.body.rows.map((x)=>x.item_id)}));
ok(r.body.sort==='watch'&&r.body.views_missing>0,'★★閲覧数が返らないときはそう分かる（ウォッチの少ない順で選ぶ）');
ok(r.body.rows.map((x)=>x.item_id).slice(0,3).join()==='101,104,105','★ウォッチの少ない順・古い順');
noHits=false;
/* 表が無い（migrate-0075 の前）ときは理由を返す */
/* 列の有無の控えは Worker ごとなので、別の Worker で見る（本番の D1 は1つ） */
const { worker:worker2, T:W2 }=await loadWorker('titlefix-noTable');
const env2=makeEnv(); env2.DB._db.exec('DROP TABLE ebay_stat');
const r2=await asJson(await worker2.fetch(new Request('https://x/titlefix/cands',{headers:{'X-PJ-Key':'k'}}),env2,{waitUntil(){}}));
ok(r2.body.ok===false&&/migrate-0075/.test(r2.body.why),'★★表が無いときは「migrate-0075 を流して」と返す');
let syncOk=true; try{ active=[{id:'201',sku:'W-'+J(21),title:'X',watch:0}]; await W2.syncEbayActive(env2,W2.newRun('ebay')); }catch(e){ syncOk=false; console.log('   '+e.message); }
ok(syncOk&&!!env2.DB._db.prepare("SELECT 1 FROM items WHERE asin=?").get('W'+J(21)),'★★★表が無くても出品中リストの取り込みは今までどおり動く');

console.log('\n=== D1 の作り・eBay に書き込まない ===');
const mig=fs.readFileSync(new URL('../proxy-sync/migrate-0075-title-fix.sql',import.meta.url),'utf8');
ok(/CREATE TABLE IF NOT EXISTS ebay_stat/.test(mig)&&!/ALTER TABLE items/.test(mig),'★★別の表を足すだけ（items は100列の上限）');
ok(W.schemaFixOf('ebay_stat')==='migrate-0075-title-fix.sql','★表が無いときに流すマイグレーション');
const src=fs.readFileSync(new URL('../proxy-sync/worker.js',import.meta.url),'utf8');
const fn=src.slice(src.indexOf('async function titlefixCands'),src.indexOf('/* ---- POST /ebay/link ----'));
ok(!/Revise|ReviseItem|ReviseFixedPriceItem|EndItem|AddItem/.test(fn),'★★★候補を選ぶだけで eBay には書き込まない');
T.done();
