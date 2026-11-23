/* 決まり・Worker：海外向け Shopify（os-）の販売元（Vendor）（8.85）

   カジの依頼（2026-11-21）「販売元（Vendor）が空のときに『Omakase Ship』が
   入っています」
     1. 販売元は、eBay 用に入れている Brand（ゲームなら発売元）。
        それも分からないときは空欄（店の名前は入れない）
     2. もう Shopify に出ている os- の商品を直す「直しCSV」（Handle と Vendor だけ）
     3. eBay 用の CSV や会員用（sub-）の商品は変えない

   ① 販売元の決め方（shared/osscsv.js の vendorPick の1か所）
   ② 商品CSV：⚙の代わりの名前はもう入れない・分からなければ空欄
   ③ 説明（Body）の「Brand」の行は今までどおり
   ④ 直しCSV は Handle と Vendor の2列だけ・会員向けは混ぜない
   ⑤ 会員用（sub-）の CSV の販売元は変えない
   ⑥ pj-sync：GET /os/list（読むだけ・管理者だけ・卸値は返さない） */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
const OSS=require('../shared/osscsv.js');
const SHOPCSV=require('../shared/shopcsv.js');
const T=harness('決まり・Worker：海外向け Shopify の販売元（8.85）');
const ok=T.ok;
const { worker }=await loadWorker('osvendor');
const read=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
globalThis.fetch=async()=>new Response('{}',{status:200});

const J='4902370550467';
const item=(o)=>Object.assign({ jan:J, titleEn:'Nintendo Switch Super Mario Party Jamboree Japan',
  kishu:'NS', vendor:'Nintendo', brand:'', type:'Video Game',
  platform:'Nintendo Switch', cond:'new', stockPhoto:true, notes:[],
  usd:49.99, qty:1, grams:120, cost:3000,
  pics:[{ url:'https://img.test/i/20261121/a.jpg' }] },o||{});
const OPT={ fx:150, pct:100, vendor:'Omakase Ship', type:'', status:'draft' };

console.log('=== ① 販売元の決め方 ===');
{
  const P=OSS.vendorPick;
  ok(P({ game:true, publisher:'Nintendo', brand:'' })==='Nintendo',
     '★★★ゲームは発売元（eBay の Publisher）');
  ok(P({ game:true, publisher:'', brand:'Keys Factory' })==='Keys Factory',
     '★★ゲームで発売元が無ければ、その行のブランド');
  ok(P({ game:false, publisher:'', brand:'Bandai Spirits' })==='Bandai Spirits',
     '★★★ゲーム以外は eBay の Brand');
  ok(P({ game:false, publisher:'Sega', brand:'' })==='Sega',
     '★ブランドが無く発売元が分かる行は発売元');
  ok(P({ game:true, publisher:'', brand:'' })===''&&P({})===''&&P(null)==='',
     '★★★どちらも分からなければ空欄');
  ok(['Does not apply','N/A','Unbranded','unknown','None','—']
       .every((w)=>P({ game:false, brand:w })===''&&P({ game:true, publisher:w })===''),
     '★★★「分からない」を表す決まり文句は、販売元に入れない（空欄）');
  ok(P({ game:true, publisher:'67979822694563', brand:'' })==='',
     '★数字だけの値（ID の取り違え）も入れない');
  ok(P({ game:true, publisher:'  Bandai   Namco  ' })==='Bandai Namco',
     '★前後と途中の空白はそろえる');
}

console.log('\n=== ② 商品CSV：店の名前は入れない ===');
{
  const r=OSS.rowOf(item(),OPT);
  ok(r['Vendor']==='Nintendo','★★★販売元は行の値（発売元）');
  const r2=OSS.rowOf(item({ vendor:'' }),OPT);
  console.log('   分からない行の Vendor：「'+r2['Vendor']+'」');
  ok(r2['Vendor']==='','★★★分からない行は空欄（⚙に「Omakase Ship」と入っていても入れない）');
  const csv=OSS.build([item({ vendor:'' }),item({ jan:'4902370550474', vendor:'Sega' })],OPT);
  ok(csv.indexOf('Omakase Ship')<0,'★★★CSV のどこにも店の名前が出ない');
  ok(OSS.rowOf(item({ vendor:'Does not apply' }),OPT)['Vendor']==='',
     '★★eBay の「Does not apply」は販売元に入れない');
  ok(OSS.vendorOf.length===1&&!/opt\)\.vendor/.test(read('shared/osscsv.js')),
     '★★⚙の代わりの名前（opt.vendor）は、もう読まない');
  ok(OSS.rowOf(item({ type:'' }),Object.assign({},OPT,{ type:'Toy' }))['Type']==='Toy',
     '★Type の⚙の代わりは今までどおり');
}

console.log('\n=== ③ 説明の「Brand」の行は今までどおり ===');
{
  const b1=OSS.rowOf(item({ vendor:'Nintendo', brand:'' }),OPT)['Body (HTML)'];
  ok(!/<li>Brand:/.test(b1),
     '★★★ゲーム（ブランドが空）の説明に、発売元を「Brand」として足さない');
  const b2=OSS.rowOf(item({ vendor:'Keys Factory', brand:'Keys Factory' }),OPT)['Body (HTML)'];
  ok(/<li>Brand: Keys Factory<\/li>/.test(b2),'★★ブランドがある行は今までどおり出る');
  const x=item({ vendor:'Bandai Spirits' }); delete x.brand;
  ok(/<li>Brand: Bandai Spirits<\/li>/.test(OSS.rowOf(x,OPT)['Body (HTML)']),
     '★brand を渡さない呼び方（前の形）は、今までどおり vendor を出す');
}

console.log('\n=== ④ 直しCSV（Handle と Vendor の2列だけ）===');
{
  /* 8.98 Title（必須）はいまの Shopify の題名。分からない行は出さない。 */
  const items=[{ jan:J, vendor:'Nintendo', title:'Game A' },
               { jan:'4902370550474', vendor:'', title:'Game B' },
               { jan:'4902370550481', vendor:'Bandai Namco Entertainment, Inc.', title:'Game C' },
               { jan:J, vendor:'重複', title:'Game A' },
               { jan:'4902370550528', vendor:'NoTitle' },
               { jan:'4902370550498', vendor:'X', member:true },
               { jan:'4902370550504', vendor:'Y', handle:'sub-4902370550504' },
               { jan:'4902370550511', vendor:'Z', handle:'one-12' },
               { jan:'abc', vendor:'W' }];
  const csv=OSS.vendCsv(items);
  console.log(csv.trim().split('\n').map((l)=>'   '+l).join('\n'));
  const rows=SHOPCSV.splitCsv(csv);
  ok(rows[0].join('|')==='Handle|Title|Vendor'&&OSS.VEND_COLS.join('|')==='Handle|Title|Vendor',
     '★★★列は Handle・Title（いまの題名のまま）・Vendor だけ（ほかの項目を上書きしない・8.98）');
  ok(rows.length===4,'★★行は3つ（重複・会員向け・JAN でない行・題名が分からない行は入れない）');
  ok(rows[1][0]==='os-'+J&&rows[1][1]==='Game A'&&rows[1][2]==='Nintendo','★★★Handle は os-<JAN>・Title・Vendor は発売元');
  ok(rows[2][0]==='os-4902370550474'&&rows[2][2]==='',
     '★★★分からない行は Vendor を空欄で出す（店の名前を消す）');
  ok(rows[3][2]==='Bandai Namco Entertainment, Inc.','★カンマの入った名前も壊れない');
  ok(rows.every((r)=>r.length===3),'★どの行も3列');
  ok(!/sub-|one-/.test(csv),'★★★会員用（sub-）・1点もの（one-）は混ぜない');
  ok(OSS.vendName(new Date('2026-11-21T03:00:00Z'),2,15)==='shopify-os-vendor-20261121-02-15.csv',
     '★ファイル名に日付・通し番号・件数が入る');
  ok(OSS.vendCsv([])==='Handle,Title,Vendor\n','★0件でも見出しだけは出る');
}

console.log('\n=== ⑤ 会員用（sub-）の CSV は変えない ===');
{
  const row={ jan:J, name:'テストのゲーム', kishu:'NS', price:3645, max_qty:3,
              grades:'light', size_tier:'s', size_g:110 };
  const o={ vendor:'Omakase Stock', type:'ゲームソフト', date:new Date('2026-11-21') };
  const r=SHOPCSV.rowOf(row,o);
  const vk=Object.keys(r).filter((k)=>/^Vendor$/i.test(k))[0];
  ok(vk&&r[vk]==='Omakase Stock','★★★会員用の商品の販売元は、今までどおり⚙の値');
  ok(SHOPCSV.apiOf(row,o).input.vendor==='Omakase Stock',
     '★★自動配信が作る会員用の商品も同じ');
  const src=read('shared/shopcsv.js');
  ok(!/vendorPick|brandWord|VEND_COLS/.test(src),
     '★★★会員用の CSV の作り（shared/shopcsv.js）には手を入れていない');
  ok(SHOPCSV.handleOf(J)==='sub-'+J&&OSS.handleOf(J)==='os-'+J,'★Handle も別のまま');
}

console.log('\n=== ⑥ pj-sync：GET /os/list ===');
{
  const env=makeEnv({ STAFF_KEY:'staff-key-123', WORKER_KEY:'worker-key-999' });
  const api=async(path,body,key)=>{
    const q=body?post(path,body):get(path);
    if(key)q.headers.set('X-PJ-Key',key);
    return await asJson(await worker.fetch(q,env,{}));
  };
  let r=(await api('/os/list')).body;
  ok(r.ok===true&&r.n===0,'★まだ何も書き出していなければ 0件');
  await api('/os/put',{ at:'2026-11-20T01:00:00.000Z', items:[
    { jan:J, name:'Super Mario Party Jamboree', usd:49.99, fx:150, pct:100,
      price:7499, qty:1, wholesale:3000, stock:5 },
    { jan:'4902370550474', name:'Game B', usd:39.99, fx:150, pct:100,
      price:5999, qty:1, wholesale:2500, stock:2 }] });
  const before=JSON.stringify((await env.DB.prepare(
    `SELECT * FROM os_item ORDER BY jan`).all()).results);
  r=(await api('/os/list')).body;
  console.log('   '+JSON.stringify(r.rows[0]));
  ok(r.ok===true&&r.n===2,'★★★書き出した os- の商品を返す（2件）');
  ok(r.rows.every((x)=>/^os-\d{13}$/.test(x.handle)&&x.jan&&x.name&&x.at),
     '★★JAN・Handle・名前・書き出した日時');
  /* 8.98 いまの Shopify の題名・状態（shop）も返す（直しCSV の Title に使う）。 */
  ok(r.rows.every((x)=>Object.keys(x).sort().join()==='at,handle,jan,name,shop'),
     '★★★卸値・値段・在庫は返さない（Shopify の題名・状態だけ足す）');
  const after=JSON.stringify((await env.DB.prepare(
    `SELECT * FROM os_item ORDER BY jan`).all()).results);
  ok(before===after,'★★★読むだけ（控えは何も変えない）');
  const w=await api('/os/list',null,'worker-key-999');
  ok(w.status===403||w.status===401||(w.body&&w.body.ok===false&&!w.body.rows),
     '★★★作業者のキーでは読めない');
}

console.log('\n=== eBay 用の CSV の作りに手を入れていない ===');
{
  const h=read('index.html');
  const a=h.indexOf('function csvRowFor('), b=h.indexOf('function csvBuild(');
  const src=h.slice(a,b);
  ok(a>0&&b>a&&/o\['C:Publisher'\]=sp\.publisher\|\|'';/.test(src)
     &&/o\['C:Brand'\]=sp\.brand\|\|'';/.test(src),
     '★★★eBay 用の Brand／Publisher の入れ方は今までどおり');
  ok(!/csvOsVendorOf|vendorPick/.test(src),'★★eBay 用の行を作る所から、新しい決め方を呼んでいない');
  ok(!/id="osVendor"/.test(h),'★★⚙の「Vendor（代わりの名前）」の欄はやめた');
  ok(!/Omakase Ship/.test(read('shared/osscsv.js')),'★店の名前をコードに持たない');
}
T.done();
