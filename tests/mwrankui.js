/* 画面：Amazon刈取のランキングは「大きい分類」（6.121）
   せどりすと と同じ見え方にそろえる。小分類だと売れ行きが良く見えすぎて、
   仕入れの判断に使えない。
     例：チョイプラ アモデウス 948,040位（ホビー）／小分類 11,481位
   ・一覧は大分類の順位と分類名を主に出す。小分類は小さく添えるだけ
   ・並べ替え「ランキング順（大分類・売れている順）」
   ・絞り込み「ランキングがこれ以下」（0 なら見ない） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：ランキングは大分類');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const base={ sha:'M200', kishu:'NS', cond:'新品', stock:9, note:'',
  ship_text:'即日出荷', ship_days:0, basis:'カート', new_n:4, low_n:1,
  amz:0, fba_n:3, amz_err:'', amz_at:'2026-10-27T01:00:00Z',
  rst:'ok', list_price:9800 };
const ROWS=[
 /* 実例。せどりすと は 948,040位（ホビー）と出す。 */
 Object.assign({},base,{ jan:'4580033110113', mw_name:'チョイプラ アモデウス',
   kishu:'figure', asin:'B0D1CHOI01', amz_name:'チョイプラ アモデウス',
   wholesale:1200, price:2500, rank:948040, rank_cat:'ホビー',
   rank_sub:11481, rank_sub_cat:'ロボットのプラモデル・模型' }),
 /* 大分類の順位が良い（売れている）行 */
 Object.assign({},base,{ jan:'4902370550467', mw_name:'よく売れるソフト',
   asin:'B00NS00001', amz_name:'よく売れるソフト',
   wholesale:3000, price:9000, rank:1200, rank_cat:'ゲーム',
   rank_sub:30, rank_sub_cat:'Nintendo Switch ソフト' }),
 /* 大分類が無い商品（小分類だけ） */
 Object.assign({},base,{ jan:'4988611224878', mw_name:'大分類がない商品',
   asin:'B00SUB0001', amz_name:'大分類がない商品',
   wholesale:3000, price:9500, rank:649, rank_cat:'Nintendo Switch ソフト',
   rank_sub:null, rank_sub_cat:'' }),
 /* 順位がまだ取れていない行 */
 Object.assign({},base,{ jan:'4970381909444', mw_name:'順位がない商品',
   asin:'B00NORANK1', amz_name:'順位がない商品',
   wholesale:3000, price:9200, rank:null, rank_cat:'',
   rank_sub:null, rank_sub_cat:'' })];
const META={ ok:true, n:4, rows:ROWS, seen:4, priced:4, left:0, per_run:120,
  ttl_days:3, limit:3000 };

await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='5';
  $('mwKishu').value='NS,NS2,P5,figure'; $('mwNewOnly').checked=true;
  $('mwNoteAll').checked=false; $('mwNoteNg').value='ダメージ,訳あり';
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  $('mwAmzFeeHobby').value='10'; $('mwAmzFbaHobby').value='580';
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u);
    if(/\/mw\/buy/.test(url))
      return new Response(JSON.stringify({ok:true,rows:[],n:0}),{status:200});
    if(/\/mw\/amz/.test(url))
      return new Response(JSON.stringify(META),{status:200});
    return real(u,i);
  };
  switchTab('F'); roleApply();
},META);
await openCsvBoxes(p);
await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
await p.waitForTimeout(500);

/* 行の見分けは JAN（札に出ている）で。 */
const names=()=>p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('#csvMwAmzList > div'),
  (el)=>((el.innerText||'').match(/\b\d{13}\b/)||[''])[0])
  .filter(Boolean));
const txt=(jan)=>p.evaluate((jan)=>{
  const el=Array.prototype.filter.call(
    document.querySelectorAll('#csvMwAmzList > div'),
    (x)=>(x.innerText||'').indexOf(jan)>=0)[0];
  return el?(el.innerText||'').replace(/\s+/g,' '):'';
},jan);
const setF=(id,v)=>p.evaluate(([id,v])=>{
  $(id).value=v;
  $(id).dispatchEvent(new Event('input'));    // 保存はこちら
  $(id).dispatchEvent(new Event('change'));   // 出し直しはこちら
},[id,v]);

console.log('=== 一覧は大分類の順位を出す ===');
let all=await names();
console.log('   '+JSON.stringify(all));
ok(all.length===4,'4行とも出ている');
let t=await txt('4580033110113');
console.log('   '+t.slice(0,160));
ok(/948,040位/.test(t),'★★★大分類の順位を出す（せどりすと と同じ数）');
ok(/（ホビー）/.test(t),'★★★分類名も出す');
ok(t.indexOf('948,040位')<t.indexOf('11,481'),'★★大分類が先（主に出す）');
ok(/小分類 11,481位/.test(t),'★★小分類は「小分類」と添えるだけ');
ok(/ロボットのプラモデル/.test(t),'★小分類の分類名も添える');
t=await txt('4988611224878');
console.log('   '+t);
ok(/649位（Nintendo Switch ソフト）/.test(t),
   '★★大分類が無い商品は小分類を出す（今までどおり）');
ok(!/小分類/.test(t),'★★★同じ順位を二重に出さない');
t=await txt('4970381909444');
ok(/ランキング —/.test(t),'★順位がまだ取れていない行は —');

console.log('\n=== 並べ替え：ランキング順（大分類） ===');
ok(await p.evaluate(()=>Array.prototype.some.call(
     $('csvMwAmzSort').options,(o)=>o.value==='rank')),
   '★★並べ替えに「ランキング順」がある');
await setF('csvMwAmzSort','rank');
await p.waitForTimeout(300);
let ord=await names();
console.log('   '+JSON.stringify(ord));
ok(ord[0]==='4988611224878'&&ord[1]==='4902370550467',
   '★★★順位が小さい（売れている）順に並ぶ：649 → 1,200');
ok(ord[2]==='4580033110113','★★大分類の順位で並ぶ（小分類 11,481 では3番目）');
ok(ord[3]==='4970381909444','★★★順位が取れていない行は後ろにまとめる');

console.log('\n=== 絞り込み：大分類ごとの上限（6.124）===');
/* 上限は⚙設定の表（大分類ごと）。細かい確かめは tests/mwrankcap.js。 */
await setF('csvMwAmzSort','net');
const caps=(o)=>p.evaluate((o)=>{
  mwRankCapSet(o); mwAmzRender();
}, o);
await caps({});
await p.waitForTimeout(200);
ok((await names()).length===4,'★★★どの分類も制限なしなら全部出す');
await caps({ 'ホビー':2000 });
await p.waitForTimeout(200);
let few=await names();
console.log('   ホビー 2,000位まで: '+JSON.stringify(few));
ok(few.indexOf('4580033110113')<0,
   '★★★ホビーの上限（2,000位）を超えた 948,040位は隠れる');
ok(few.indexOf('4902370550467')>=0,
   '★★★ゲームは制限なしなので、同じ上限では隠れない（行ごとに自分の分類で見る）');
ok(few.indexOf('4970381909444')<0,
   '★★上限を入れているあいだは、順位が無い行は隠す');
let hid=await p.evaluate(()=>($('csvMwAmzListNote').textContent||'')
  .replace(/\s+/g,' '));
console.log('   '+hid.slice(hid.indexOf('ランキング')).slice(0,40));
ok(/ランキングの基準で隠した行 2件/.test(hid),
   '★★★一覧の上に「ランキングの基準で隠した行 n件」を出す');
await p.evaluate(()=>{ $('csvMwAmzNoRank').checked=true;
  $('csvMwAmzNoRank').dispatchEvent(new Event('change')); });
await p.waitForTimeout(200);
let withNo=await names();
console.log('   順位が無い行も表示: '+JSON.stringify(withNo));
ok(withNo.indexOf('4970381909444')>=0,
   '★★★「順位が無い行も表示」で、順位が無い行を出せる');
ok(withNo.indexOf('4580033110113')<0,'★上限を超えた行は出さないまま');
await p.evaluate(()=>{ $('csvMwAmzNoRank').checked=false;
  $('csvMwAmzNoRank').dispatchEvent(new Event('change')); });
await caps({ 'ホビー':1000000, 'ゲーム':1000 });
await p.waitForTimeout(200);
let two=await names();
console.log('   ホビー100万・ゲーム1,000: '+JSON.stringify(two));
ok(two.indexOf('4580033110113')>=0,'★★★ホビーは100万位までなので残る');
ok(two.indexOf('4902370550467')<0,'★★★ゲームは1,000位までなので 1,200位は隠れる');
ok(two.indexOf('4988611224878')>=0,
   '★大分類が無い（Nintendo Switch ソフト）行は、その名前の上限が無いので残る');
await caps({});
await p.waitForTimeout(200);
ok((await names()).length===4,'★上限を消せば全部戻る');

console.log('\n=== ①の知らせ：前の ASIN をそのまま使った件数 ===');
/* 引き直しで引けなかった行は、前の ASIN・順位をそのまま使う（6.121・7.91）。 */
const note=await p.evaluate(()=>{
  const d={ok:true,left:0,stopped:'',ms:3000,
    share_ms:{asin:10000,rst:5000,price:40000},
    asin:{asked:9,done:9,ok_n:6,ng:3,dup:0,kept:2,calls:1,left:0,
          stopped:'',ms:900},
    rst:{asked:0,done:0,ok_n:0,approval:0,blocked:0,failed:0,calls:0,left:0,
         stopped:'',rows:[],fails:[],why:'',ms:0},
    price:{asked:0,done:0,priced:0,none:0,skipped_red:0,calls:0,left:0,
           stopped:'',ms:0}};
  $('csvMwAmzNote').innerHTML=mwScanNote(d);
  return ($('csvMwAmzNote').textContent||'').replace(/\s+/g,' ');
});
console.log('   '+note.slice(0,120));
ok(/前の ASIN のまま 2/.test(note),
   '★★★引き直せなかった行の数を出す（前の ASIN をそのまま使った）');
const note0=await p.evaluate(()=>{
  const d={ok:true,left:0,stopped:'',ms:3000,
    share_ms:{asin:10000,rst:5000,price:40000},
    asin:{asked:9,done:9,ok_n:9,ng:0,dup:0,kept:0,calls:1,left:0,
          stopped:'',ms:900},
    rst:{asked:0,done:0,ok_n:0,approval:0,blocked:0,failed:0,calls:0,left:0,
         stopped:'',rows:[],fails:[],why:'',ms:0},
    price:{asked:0,done:0,priced:0,none:0,skipped_red:0,calls:0,left:0,
           stopped:'',ms:0}};
  return (mwScanNote(d)||'').replace(/<[^>]*>/g,'');
});
ok(!/前の ASIN のまま/.test(note0),'★0件のときは出さない');

await T.done();
})();
