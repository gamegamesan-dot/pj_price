/* Worker：同じ JAN が2行返る不具合と、残り数（6.194・7.144・カジの報告）

   カジの報告（2026-11-13）「9件を選んで CSV を書き出し、Shopify に
   読み込んだら 7件しか入らなかった」。
   原因は mw_stock が **1つの JAN に社ごと複数行**あり、
   `LEFT JOIN mw_stock s ON s.jan = b.jan` が同じ JAN を何行も返していたこと。
   Shopify は同じ Handle・同じ Option1 Value の行を同じ商品の別バリアントと
   して読むので、その商品がまるごと入らないことがある。

   ① GET /mw/sub は 1つの JAN につき1行だけ返す（代表の行でつなぐ）
   ② 欠品した商品でも名前・機種が消えない
   ③ 取り込んだ注文の点数（sold）と残り数（left）を返す
   ④ 配信の行（subRows）も同じく1行だけ */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import SHOPCSV from '../shared/shopcsv.js';
const T=harness('Worker：同じ JAN が2行返らない（7.144）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('subdup');
globalThis.fetch=async()=>new Response(null,{status:204});

const env0=()=>makeEnv({});
const api=async(env,path,body)=>(await asJson(await worker.fetch(
  body?post(path,body):get(path),env,{}))).body;
const row=(o)=>Object.assign({ sha:'いろは商会', idx:0, kishu:'NS',
  name:'商品', list_price:7678, release:'', cond:'新品',
  wholesale:3000, note:'', ship_text:'即日', ship_days:0 },o);
const impo=async(env,at,rows)=>await api(env,'/mw/stock',
  { at:at, part:1, parts:1, rows_in:rows.length, rows:rows });
const fill=(n)=>{ const a=[]; for(let i=0;i<(n||12);i++)
  a.push(row({ jan:'49023709'+String(i).padStart(5,'0'), stock:9 })); return a; };
const F=fill(12);
const J='4570101051127';
const NAME='薔薇と椿 〜お豪華絢爛版〜 -Switch【特典】お表裏ジャケット、お取扱';

console.log('=== ① 同じ JAN を2社が扱っていても1行 ===');
{
  const env=env0();
  await impo(env,'2026-11-13T00:00:00Z',[...F,
    row({ jan:J, stock:5, sha:'いろは商会', name:NAME }),
    row({ jan:J, stock:3, sha:'ろはに商事', name:NAME, wholesale:3200 })]);
  await api(env,'/mw/sub',{ items:[{ jan:J, on:1, max_qty:5, price:3400,
                                     grades:'monitor' }] });
  const d=await api(env,'/mw/sub?limit=2000');
  console.log('   行数：'+d.n);
  ok(d.n===1,'★★★2社が扱う商品でも1行だけ返す');
  ok(String(d.rows[0].jan)===J,'★その JAN の行');
  ok(d.rows[0].stock===5,'★★代表（pick）の在庫を返す（安いほうの社）');
  /* CSV にすると Handle が1つだけ出る（Shopify が読める形）。 */
  const csv=SHOPCSV.build(d.rows,{});
  const hit=(csv.match(/sub-4570101051127/g)||[]).length;
  ok(hit===1,'★★★CSV に同じ Handle の行が2つ出ない');
  const sp=SHOPCSV.split(d.rows,{});
  ok(sp.go.length===1&&sp.no.length===0,'★★外す行は出ない');
}

console.log('=== ② 欠品しても名前と機種が消えない ===');
{
  const env=env0();
  await impo(env,'2026-11-13T00:00:00Z',[...F,
    row({ jan:J, stock:5, name:NAME })]);
  await api(env,'/mw/sub',{ items:[{ jan:J, on:1, max_qty:5, price:3400 }] });
  await impo(env,'2026-11-13T06:00:00Z',F);     // MW の CSV から消える＝欠品
  const d=await api(env,'/mw/sub?limit=2000');
  ok(d.n===1,'★★欠品でも1行返る');
  ok(String(d.rows[0].kishu||'')==='NS','★★★欠品でも機種が消えない');
  ok(String(d.rows[0].name||'').indexOf('薔薇と椿')>=0,
     '★★★欠品でも名前が消えない');
  ok(Number(d.rows[0].stock)===0,'★MW在庫は0');
}

console.log('=== ③ 取り込んだ注文の点数と残り数（【4】）===');
{
  const env=env0();
  await impo(env,'2026-11-13T00:00:00Z',[...F,row({ jan:J, stock:9, name:NAME })]);
  await api(env,'/mw/sub',{ items:[{ jan:J, on:1, max_qty:5, price:3400 }] });
  const sku='SUB-'+J+'-20261113';
  await api(env,'/sub/orders',{ name:'orders.csv',
    text:'Name,Lineitem quantity,Lineitem sku\n#1001,1,'+sku+'\n' });
  const d=await api(env,'/mw/sub?limit=2000');
  ok(Number(d.rows[0].sold)===1,'★★★取り込んだ注文の点数を返す');
  ok(Number(d.rows[0].left)===4,'★★★残り数＝上限 − 注文（5−1）');
  const csv=SHOPCSV.build(d.rows,{});
  const cells=SHOPCSV.splitCsv(csv);
  const i=cells[0].indexOf('Variant Inventory Qty');
  ok(cells[1][i]==='4',
     '★★★CSV の在庫も残り（pj の残りと Shopify を合わせる）');
}

console.log('=== ④ 配信の行も1行だけ ===');
{
  const env=env0();
  await impo(env,'2026-11-13T00:00:00Z',[...F,
    row({ jan:J, stock:5, sha:'いろは商会', name:NAME }),
    row({ jan:J, stock:3, sha:'ろはに商事', name:NAME })]);
  await api(env,'/mw/sub',{ items:[{ jan:J, on:1, max_qty:5, price:3400,
                                     grades:'monitor' }] });
  await api(env,'/sub/loaded',{ jans:[J] });
  const rows=await W.subRows(env);
  ok(rows.filter((x)=>String(x.jan)===J).length===1,
     '★★★配信の行も同じ JAN は1行だけ（カードを二重に送らない）');
}

console.log('=== 商品名の掃除とカード（【3】）===');
{
  ok(SHOPCSV.titleOf(NAME)==='薔薇と椿 〜お豪華絢爛版〜',
     '★★★Shopify の Title から MW の付け足しを外す');
  const SUBCARD=(await import('../shared/subcard.js')).default;
  ok(SUBCARD.nameJa(NAME)==='薔薇と椿 〜お豪華絢爛版〜',
     '★★★Discord のカードの商品名も同じに掃除する');
  const c=SUBCARD.card({ jan:J, name:NAME, price:3400, left:4, qty:5,
                         kishu:'NS' },{},{});
  ok(c.title==='薔薇と椿 〜お豪華絢爛版〜','★★カードの見出しも掃除した名前');
  ok(SUBCARD.CARD_V!=='8.17',
     '★★カードの版を上げる（次の配信で古いカードも書き換わる）');
}

T.done();
