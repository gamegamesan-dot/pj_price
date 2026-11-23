/* 共有・Worker：海外向け Shopify（os-）の値段を卸値から出す（8.94）

   カジの依頼（v342）os- の値段が「eBay の売値（送料込み USD）× 為替 × ◯%」で、
   ストアはチェックアウトで重さ別のエアメール送料を別にもらうので、送料が二重・
   eBay の手数料と広告費の分も上乗せされて高すぎた（オクトパストラベラー0 が ¥12,222）。
   ① 値段 ＝（卸値（税込）＋目標利益）÷（1 − 決済手数料率）。為替は使わない
   ② GET /os/px … Shopify に出した os- の商品と、いまの MW の卸値（管理者だけ）
   ③ POST /os/px … 値段の直しCSV を作った値段と卸値を控える（数量・品切れの印は触らない）
   ④ 値段の直しCSV は Handle・Option1・SKU・Variant Price だけ（卸値・仕入れ先は入れない） */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import OSS from '../shared/osscsv.js';
const T=harness('共有・Worker：os- の値段を卸値から出す（8.94）');
const ok=T.ok;
const { worker }=await loadWorker('ospx');
globalThis.fetch=async()=>new Response(null,{status:204});

const OPT={ profitBase:1000, profitRate:30, pay:3.6 };
console.log('=== ① 式（shared/osscsv.js の pxOf の1か所）===');
{
  const rows=[2000,3500,5000,7000,10000].map((w)=>OSS.pxOf({ wholesale:w },OPT));
  rows.forEach((z)=>console.log('   卸値 '+z.wholesale+' → 税込 '+z.cost+' ＋ 送料 '+z.ship+' ＋ 梱包 '+z.pack+' ＋ 利益 '+z.profit
    +' ＋ 手数料 '+z.fee+' ＝ '+z.price));
  ok(rows.every((z)=>z.price===Math.ceil((z.cost+176+50+z.profit)/0.964)),
     '★★★（卸値（税込）＋MW 仕入れ送料 176＋梱包材 50＋目標利益）÷（1 − 3.6%）を切り上げ');
  ok(rows.every((z)=>z.cost===Math.round(z.wholesale*1.1)),'★★★卸値は税込（×1.1）');
  ok(rows.every((z)=>z.price===z.cost+z.ship+z.pack+z.profit+z.fee),'★★内訳の合計が値段');
  ok(rows.every((z)=>z.fee>=Math.floor(z.price*0.036)&&z.fee<=Math.ceil(z.price*0.036)+1),
     '★★決済手数料は値段の 3.6%（手数料を引いても目標利益が残る）');
  const a=OSS.pxOf({ wholesale:5000, usd:80 },Object.assign({ fx:150, pct:100 },OPT));
  ok(a.price===8689,'★★★卸値 ¥5,000 → ¥8,689（為替・eBay の売値は使わない）');
}

const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123', WORKER_KEY:'worker-key-999' });
const api=async(env,path,body,key)=>{
  const r=body?post(path,body):get(path);
  if(key)r.headers.set('X-PJ-Key',key);
  return await asJson(await worker.fetch(r,env,{}));
};
const NOW=new Date().toISOString();
const stock=(env,jan,w,o)=>env.DB.prepare(
  `INSERT INTO mw_stock (jan,sha,idx,kishu,name,wholesale,stock,row_hash,pick,seen_at,created_at,gone_at)
   VALUES (?1,'いろは商会',0,'NS','商品',?2,5,'h',1,?3,?3,?4)`)
  .bind(jan,w,NOW,(o||{}).gone?NOW:null).run();
const J1='4902370550467', J2='4902370550474', J3='4902370550481';

console.log('\n=== ② GET /os/px ===');
{
  const env=env0();
  await api(env,'/os/put',{ items:[
    { jan:J1, name:'Octopath Traveler 0', usd:76.39, fx:160, pct:100, price:12222, qty:1, wholesale:5000, stock:5 },
    { jan:J2, name:'Game 2', usd:40, fx:160, pct:100, price:6400, qty:2, wholesale:3000, stock:5 },
    { jan:J3, name:'Game 3', usd:40, fx:160, pct:100, price:6400, qty:0, wholesale:3000, stock:0 }] });
  await stock(env,J1,5200); await stock(env,J2,3000); await stock(env,J3,3000,{ gone:true });
  await env.DB.prepare(`UPDATE os_item SET fix_at=?1, fix_why='gone', fix_qty=0 WHERE jan=?2`).bind(NOW,J3).run();
  await env.DB.prepare(`UPDATE os_item SET fix_at=?1, fix_why='price', fix_qty=1 WHERE jan=?2`).bind(NOW,J1).run();
  const r=await api(env,'/os/px');
  const d=r.body;
  console.log('   '+JSON.stringify(d.rows.map((x)=>[x.jan,x.price,x.wholesale,x.now_px,x.why])));
  ok(d.ok&&d.n===3,'★★★Shopify に出した os- の商品を返す');
  const x1=d.rows.filter((x)=>x.jan===J1)[0], x3=d.rows.filter((x)=>x.jan===J3)[0];
  ok(x1.price===12222&&x1.wholesale===5000&&x1.now_px===5200,'★★★控えた値段・控えた卸値・いまの MW の卸値');
  ok(x3.now_px===0&&x3.wholesale===3000,'★★品切れ（MW に無い）の商品は now_px が 0（控えた卸値で出せる）');
  ok(!JSON.stringify(d).includes('いろは商会'),'★★仕入れ先の名前は返さない');
  const w=await api(env,'/os/px',null,'staff-key-123');
  ok(w.status===403||(w.body&&w.body.ok===false),'★★★作業者のキーでは使えない（卸値を返すので）');

  console.log('\n=== ③ POST /os/px ===');
  const z1=OSS.pxOf({ wholesale:5200 },OPT), z3=OSS.pxOf({ wholesale:3000 },OPT);
  const s=(await api(env,'/os/px',{ items:[{ jan:J1, price:z1.price, wholesale:5200 },
    { jan:J3, price:z3.price, wholesale:3000 }, { jan:'12', price:100 }, { jan:J2, price:0 }] })).body;
  ok(s.ok&&s.n===2,'★★値段と卸値を控える（JAN がおかしい・値段0 は飛ばす）');
  const o1=await env.DB.prepare(`SELECT * FROM os_item WHERE jan=?1`).bind(J1).first();
  const o3=await env.DB.prepare(`SELECT * FROM os_item WHERE jan=?1`).bind(J3).first();
  ok(o1.price===z1.price&&o1.wholesale===5200&&!o1.fix_at&&!o1.fix_why,
     '★★★値段・卸値を控え、「値段を直す」の印は消す');
  ok(o3.price===z3.price&&o3.fix_why==='gone'&&!!o3.fix_at&&o3.qty===0,
     '★★★品切れの印と数量は触らない（在庫の直しCSV は今までどおり）');
  const o2=await env.DB.prepare(`SELECT * FROM os_item WHERE jan=?1`).bind(J2).first();
  ok(o2.price===6400&&o2.qty===2,'★送っていない商品はそのまま');
  /* 卸値が動けば、いままでどおり「値段を直す」の印が付く。 */
  const n=(await api(env,'/os/check',{})).body;
  ok(n.ok,'★見張りはいままでどおり動く');
}

console.log('\n=== ④ 値段の直しCSV ===');
{
  const go=[{ jan:J1, price:8668, wholesale:5200, title:'Octopath Traveler 0' },{ jan:J2, price:5488, wholesale:3000, title:'Game 2' }];
  const csv=OSS.pxCsv(go,OPT);
  console.log('   '+csv.replace(/\n/g,' | '));
  ok(csv.split('\n')[0]==='Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Price',
     '★★★列は Handle・Title・Option1・SKU・Variant Price だけ（8.98）');
  ok(!/5200|3000|wholesale|いろは/.test(csv),'★★★卸値・仕入れ先は CSV に入らない');
  ok(/os-4902370550467,Octopath Traveler 0,Title,Default Title,W-4902370550467,8668/.test(csv),'★★Handle と SKU で突き合わせる');
}

T.done();
