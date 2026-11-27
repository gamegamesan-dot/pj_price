/* Actions の道具：出品済みの無在庫（W-）の題名の長さを数える（8.108・v357）

   カジの依頼（2026-11-27）「出品済みの無在庫（itemId あり・W- の SKU）について、
   タイトルの文字数の分布（40字未満／40〜59字／60〜80字の件数）」。
   このリポジトリは公開なので、ログに出すのは**数だけ**（題名は出さない）。 */
import { harness, makeEnv } from './lib.mjs';
const T=harness('Actions：無在庫の題名の長さを数える（8.108）');
const ok=T.ok;
const DG=await import('../proxy-sync/d1-diag.mjs');
const env=makeEnv();
const db=env.DB._db;
const q=DG.qTitleLen(true);
ok(/^SELECT /.test(q)&&!/\b(UPDATE|DELETE|INSERT)\b|\bDROP\s+TABLE/i.test(q),'★★★読むだけ（書き込まない）');
ok(!/(^|,)\s*(COALESCE\([^)]*\)|[it]\.title)\s+AS\s+\w+/i.test(q.replace(/length\(COALESCE\([^)]*\)[^)]*\)/g,'L')),
   '★★★題名そのものは引かない（長さと件数だけ）');
const t=(n)=>'x'.repeat(n);
const ins=db.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_item_id,ebay_sku,ebay_qty,updated_at)
  VALUES (?,?,?,?,?,?,?,?)`);
const rows=[
  ['W4900000000001',t(37),'111','W-4900000000001'],   // 40字未満・売れた
  ['W4900000000002',t(39),'112','W-4900000000002'],   // 40字未満
  ['W4900000000003',t(40),'113','W-4900000000003'],   // 40〜59字
  ['W4900000000004',t(59),'114','W-4900000000004'],   // 40〜59字
  ['W4900000000005',t(60),'115','W-4900000000005'],   // 60〜80字
  ['W4900000000006',t(80),'116','W-4900000000006'],   // 60〜80字
  ['W4900000000007',t(30),'','W-4900000000007'],      // 出品していない（数えない）
  ['B0TESTTEST',t(30),'118','E-B0TESTTEST']           // W- でない（数えない）
];
for(const r of rows)ins.run(r[0],'new','ebay',r[1],r[2],r[3],1,'x');
/* いまの eBay の題名（ebay_stat）。1件は Revise で 62字に直したもの・1件は売れた数 1。 */
db.prepare(`INSERT INTO ebay_stat (asin,cond,item_id,title,sold,updated_at) VALUES
  ('W4900000000002','new','112','${'y'.repeat(62)}',0,'x'),
  ('W4900000000004','new','114','${'y'.repeat(59)}',1,'x')`).run();
db.prepare(`INSERT INTO orders (channel,order_id,line_id,sku,asin,cond,qty,created_at)
  VALUES ('ebay','O1','L1','W-4900000000001','W4900000000001','new',1,'x'),
         ('ebay','O2','L1','','W4900000000005','new',1,'x'),
         ('amazon','O3','L1','W-4900000000003','W4900000000003','new',1,'x')`).run();
let res=null, err='';
try{ res=db.prepare(q).all(); }catch(e){ err=e.message; }
ok(!!res,'★★問い合わせが D1 の作りに合っている '+err);
const c=DG.titleLenSum(res||[]);
console.log('   '+JSON.stringify(c));
ok(c.total===6,'★★出品済み（ItemID あり）の W- だけを数える（未出品・W- 以外は数えない）');
ok(c.a.all===1&&c.b.all===2&&c.c.all===3&&c.d.all===0,'★★★40字未満／40〜59字／60〜80字に分ける（40 は 40〜59・60 と 80 は 60〜80）');
ok(c.c.all===3,'★★★いまの eBay の題名（ebay_stat）があればそちらの長さで数える（Revise で直した出品）');
ok(c.a.sold===1&&c.c.sold===1&&c.b.sold===1,'★★eBay の注文がある出品・その出品で売れた数がある出品を「売れた実績あり」に数える');
ok(c.b.unsold===1,'★Amazon の注文は eBay の売れた実績に数えない');
/* ebay_stat が無い D1 でも数えられる（最初に取り込んだ題名 items.title で数える）。 */
let r2=null; try{ r2=db.prepare(DG.qTitleLen(false)).all(); }catch(e){}
const c2=DG.titleLenSum(r2||[]);
ok(!!r2&&c2.total===6&&c2.a.all===2,'★ebay_stat が無いときは items.title で数える（migrate-0075 の前）');
const wf=(await import('node:fs')).readFileSync(new URL('../.github/workflows/deploy-pj-sync.yml',import.meta.url),'utf8');
ok(/d1-diag\.mjs --mw-csv --mw-match --title-len/.test(wf),'★★Actions の「記録を見る」で一緒に数える');
T.done();
