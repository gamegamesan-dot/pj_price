/* 画面：国内 Amazon FBA で見る（6.91）
   ・利益＝販売価格−（販売手数料＋FBA手数料）−仕入値（式は画面で持つ）
   ・粗利（税抜）＝粗利×10/11 も出す
   ・ランキング・新品出品者数・Amazon本体の有無を出す
   ・ジャンル（ゲーム／フィギュア／その他）で手数料率が変わる
   ・CSV は 10/7 の利益計算ファイルと同じ列で書き出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：MW×Amazon FBA');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const ROWS=[
 { jan:'4595120538169', sha:'M200', kishu:'NS', mw_name:'千銃士：Rhodoknight 限定版',
   list_price:22800, cond:'新品', wholesale:12000, stock:9, note:'',
   ship_text:'即日出荷', ship_days:0, asin:'B0FVLXGFMH',
   amz_name:'千銃士:Rhodoknight for Nintendo Switch 限定版', rank:649,
   rank_cat:'Nintendo Switch ソフト', price:24829, basis:'カート', low:24829,
   buybox:24829, new_n:4, low_n:1, amz:1, fba_n:3, amz_err:'',
   amz_at:'2026-10-27T01:00:00Z' },
 { jan:'4582292602828', sha:'MC02', kishu:'b2cchara_figure',
   mw_name:'グリザイア:ファントムトリガー トーカ', list_price:18700, cond:'新品',
   wholesale:16082, stock:4, note:'◎値引き商品（2024/10/17）',
   ship_text:'ご注文より3．4営業日', ship_days:4, asin:'B0B98TXLKY',
   amz_name:'オーキッドシード グリザイア トーカ 1/6スケール', rank:2310,
   rank_cat:'フィギュア', price:26799, basis:'カート', low:27000, buybox:26799,
   new_n:11, low_n:1, amz:0, fba_n:5, amz_err:'', amz_at:'2026-10-27T01:00:00Z' },
 { jan:'4988611224878', sha:'E027', kishu:'NS', mw_name:'赤字になる商品',
   list_price:3000, cond:'新品', wholesale:9000, stock:3, note:'',
   ship_text:'翌営業日', ship_days:1, asin:'B00REDAAAA',
   amz_name:'赤字', rank:50000, rank_cat:'ゲーム', price:5000, basis:'最安',
   low:5000, buybox:0, new_n:2, low_n:1, amz:0, fba_n:0, amz_err:'',
   amz_at:'2026-10-27T01:00:00Z' },
 { jan:'4970381909444', sha:'Q061', kishu:'seal', mw_name:'値段が取れていない',
   list_price:500, cond:'新品', wholesale:300, stock:200, note:'',
   ship_text:'即日出荷', ship_days:0, asin:'', amz_name:'', rank:null,
   price:null, basis:'', new_n:0, amz:0, amz_err:'ASINが見つかりません',
   amz_at:'2026-10-27T01:00:00Z' }];
const META={ ok:true, n:4, rows:ROWS, seen:4, priced:3, left:0, per_run:120,
  ttl_days:3, last:{ at:'2026-10-27T01:00:00Z', at_jst:'2026-10-27 10:00',
  asked:4, done:4, asin_ok:3, asin_ng:1, priced:3, none:0, left_n:0,
  calls_cat:1, calls_prc:1 }, limit:3000 };

const setup=async()=>await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='2';
  $('mwKishu').value='NS,NS2,P5,b2cchara_figure,figure,seal';
  $('mwNewOnly').checked=true; $('mwNoteAll').checked=false;
  $('mwNoteNg').value='ダメージ,引き上げ,箱潰れ,訳あり,難あり,ジャンク,外箱不良,パッケージ不良';
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  $('mwAmzFeeHobby').value='10'; $('mwAmzFbaHobby').value='580';
  $('amzFeeRate').value='15'; $('amzFbaFee').value='400';
  window.__posts=[]; window.__dl=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/mw\/amz/.test(url)){
      window.__posts.push({url:url,body:b});
      if(i&&i.method==='POST')
        return new Response(JSON.stringify({ok:true,asked:4,done:4,asin_ok:3,
          asin_ng:1,priced:3,none:0,failed:0,left:120,calls_cat:1,calls_prc:1}),{status:200});
      return new Response(JSON.stringify(META),{status:200});
    }
    return real(u,i);
  };
  /* ダウンロードを受け取る */
  /* Blob.text() は先頭の BOM を落とすので、バイト列でも控える。 */
  window.csvDownloadBlob=function(name,blob){
    return blob.arrayBuffer().then(function(ab){
      const u=new Uint8Array(ab);
      window.__dl.push({ name:name,
        text:new TextDecoder('utf-8').decode(u),
        bom:(u[0]===0xEF&&u[1]===0xBB&&u[2]===0xBF) });
    });
  };
  switchTab('D'); roleCheck(); csvRender();
},META);

console.log('=== ボタンが結ばれているか ===');
await setup();
await openCsvBoxes(p);
let b=await p.evaluate(()=>({ go:typeof $('csvMwAmz').onclick==='function',
  load:typeof $('csvMwAmzLoad').onclick==='function',
  csv:typeof $('csvMwAmzCsv').onclick==='function' }));
ok(b.go&&b.load&&b.csv,'★★3つのボタンが結ばれている');

console.log('\n=== 実売価格を取るボタン ===');
await p.evaluate(()=>{ $('csvMwAmz').click(); });
await p.waitForTimeout(500);
let posts=await p.evaluate(()=>window.__posts);
let pp=posts.filter((x)=>x.body)[0];
console.log('   送った: '+JSON.stringify(pp&&pp.body));
ok(!!pp,'★★押すと /mw/amz を呼ぶ');
ok(pp.body.kishu.indexOf('NS')>=0&&pp.body.ship_max===4&&pp.body.stock_min===2,
   '★★候補と同じ絞り込みを送る');
ok(pp.body.note_ng.indexOf('ダメージ')>=0&&pp.body.note_all===0,
   '★★備考の除外も同じ条件で送る');
let n=await p.evaluate(()=>$('csvMwAmzNote').textContent);
console.log('   '+n.replace(/\s+/g,' '));
ok(/調べた/.test(n)&&/ASIN が引けた 3/.test(n),'★ASIN の結果を出す');
ok(/呼び出し/.test(n)&&/値段 1回/.test(n),'★★呼び出し回数を出す');
ok(/まだ 120件/.test(n),'★★残りと押し直しを知らせる');

console.log('\n=== 利益の計算（ジャンルで手数料が変わる）===');
let c=await p.evaluate((R)=>{
  mwAmzRows=R; const f=(jan)=>{
    const r=R.filter((x)=>x.jan===jan)[0];
    const z=mwAmzCalc(r);
    return z?{genre:z.genre,rate:z.rate,fba:z.fba,fee:z.fee,cost:z.cost,
      profit:z.profit,net:z.net,margin:z.margin,price:z.price}:null; };
  return { game:f('4595120538169'), fig:f('4582292602828'),
           red:f('4988611224878'), none:f('4970381909444') };
},ROWS);
console.log('   ゲーム: '+JSON.stringify(c.game));
console.log('   フィギュア: '+JSON.stringify(c.fig));
ok(c.game.genre==='ゲーム'&&c.game.rate===15&&c.game.fba===530,
   '★★ゲームは 15%＋FBA530円');
ok(c.fig.genre==='フィギュア'&&c.fig.rate===10&&c.fig.fba===580,
   '★★フィギュアは 10%＋FBA580円');
/* 10/7 の利益計算ファイルの実例と合うか（仕入れ送料176円のぶんだけ differ） */
ok(c.game.cost===Math.round(12000*1.1)+176,
   '★★仕入値＝卸値×1.1＋仕入れ送料176円');
ok(c.game.fee===Math.round(24829*0.15)+530,'★★手数料＝販売価格×率＋FBA');
ok(c.game.profit===24829-c.game.fee-c.game.cost,
   '★★粗利＝販売価格−手数料−仕入値');
ok(c.game.net===Math.round(c.game.profit*10/11),
   '★★★粗利（税抜）＝粗利×10/11');
ok(c.game.net<c.game.profit,'★税抜は税込より小さい');
ok(c.game.margin===Math.round(c.game.profit/24829*1000)/10,'★利益率');
ok(c.red.profit<0,'★★赤字の行は赤字と出る');
ok(c.none===null,'★★値段が取れていない行は計算しない');
/* 10/7 のファイルの数字との突き合わせ（粗利 7375・手数料 4254・仕入 13200）。
   いまは仕入れ送料176円を足すので、そのぶん粗利が減るのが正しい。 */
console.log('   10/7 のファイル: 粗利7375 手数料4254 仕入13200');
console.log('   いま:            粗利'+c.game.profit+' 手数料'+c.game.fee
  +' 仕入'+c.game.cost+'（＋176円）');
ok(c.game.fee===4254,'★★手数料が 10/7 のファイルと一致する');
ok(c.game.profit===7375-176,
   '★★粗利は 10/7 のファイルから仕入れ送料176円ぶん少ない（式どおり）');

console.log('\n=== 一覧 ===');
await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
await p.waitForTimeout(500);
let q=await p.evaluate(()=>window.__posts.filter((x)=>/priced=1/.test(x.url))[0]);
ok(!!q,'★★一覧は値段が取れた行だけを求める（priced=1）');
let t=await p.evaluate(()=>$('csvMwAmzList').textContent);
let note2=await p.evaluate(()=>$('csvMwAmzListNote').textContent);
console.log('   '+note2.replace(/\s+/g,' '));
ok(/2件を表示/.test(note2),'★★表示している件数を出す');
ok(/値段あり 3件のうち/.test(note2),'★★値段がある件数も出す');
ok(/粗利（税抜）の高い順/.test(t),'★★既定は粗利（税抜）順（全ジャンル）');
ok(/税抜/.test(t),'★★税抜の額を出す');
ok(/Amazon本体あり/.test(t),'★★Amazon本体ありの印を出す');
ok(/ランキング/.test(t)&&/649/.test(t),'★★ランキングを出す');
ok(/新品出品者 4人/.test(t),'★★新品出品者数を出す');
ok(/カート/.test(t),'★価格の基準を出す');
ok(/B0FVLXGFMH/.test(t),'★ASIN を出す');
let hrefs=await p.evaluate(()=>Array.prototype.map.call(
  $('csvMwAmzList').querySelectorAll('a'),(a)=>a.getAttribute('href')));
ok(hrefs.some((h)=>/amazon\.co\.jp\/dp\/B0FVLXGFMH/.test(h)),
   '★★Amazon のページに飛べる');
ok(!/赤字になる商品/.test(t),'★★赤字の行は一覧に出さない（黒字だけ）');

console.log('\n=== CSV の書き出し（10/7 のファイルと同じ列）===');
await p.evaluate(()=>{ $('csvMwAmzCsv').click(); });
await p.waitForTimeout(500);
let dl=await p.evaluate(()=>window.__dl);
ok(dl.length===1,'★★1つのファイルを書き出す');
console.log('   名前: '+dl[0].name);
ok(/^mw_fba_\d{8}\.csv$/.test(dl[0].name),'★★日付入りの名前');
/* ="…" の欄には " が入るので、ちゃんと読む（split では割れない）。 */
const parseCsv=(t)=>{
  const rows=[]; let row=[], cur='', q=false;
  for(let i=0;i<t.length;i++){
    const c=t[i];
    if(q){ if(c==='"'){ if(t[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=c; }
    else if(c==='"')q=true;
    else if(c===','){ row.push(cur); cur=''; }
    else if(c==='\r'&&t[i+1]==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; i++; }
    else cur+=c;
  }
  if(cur!==''||row.length){ row.push(cur); rows.push(row); }
  return rows;
};
const cells=parseCsv(dl[0].text.replace(/^\ufeff/,'').replace(/\r\n$/,''));
const lines=cells;
const head=cells[0];
console.log('   列: '+head.join(','));
const WANT=['出荷区分','注意','ジャンル','粗利','粗利（税抜）','粗利率','販売価格',
  '価格の基準','手数料','仕入（税込・送料込）','卸値','定価','ランキング',
  '新品出品者数','Amazon本体','JAN','ASIN','商品名（MW）','Amazon商品名',
  '新・中','社','掲載数','出荷日','備考','状態','URL'];
ok(head.join()===WANT.join(),
   '★★★10/7 の利益計算ファイルと同じ列（＋粗利（税抜））');
ok(head.indexOf('粗利（税抜）')===4,'★★粗利（税抜）が粗利の隣にある');
ok(dl[0].bom===true,'★★BOM 付き（Excel で開ける）');
ok(lines.length===4,'★見出し＋3行（値段が取れた行すべて・赤字も入れる）');
const c1=cells[1];
console.log('   1行目: '+c1.slice(0,12).join(' | '));
ok(c1[head.indexOf('ジャンル')]==='ゲーム','★ジャンル');
ok(+c1[head.indexOf('粗利')]===c.game.profit,'★★粗利');
ok(+c1[head.indexOf('粗利（税抜）')]===c.game.net,'★★★粗利（税抜）');
ok(c1[head.indexOf('Amazon本体')]==='あり','★★Amazon本体');
ok(+c1[head.indexOf('新品出品者数')]===4,'★★新品出品者数');
ok(+c1[head.indexOf('ランキング')]===649,'★★ランキング');
ok(c1[head.indexOf('JAN')]==='="4595120538169"',
   '★★JAN は ="…" の形（Excel で桁が落ちない）');
ok(c1[head.indexOf('出荷区分')]==='即日','★出荷区分');
ok(c1[head.indexOf('価格の基準')]==='カート','★価格の基準');
ok(c1[head.indexOf('状態')]==='OK','★黒字は OK');
ok(/amazon\.co\.jp\/dp\//.test(c1[head.indexOf('URL')]),'★URL');
const red=cells.filter((x)=>x.indexOf('赤字になる商品')>=0)[0];
ok(red[head.indexOf('状態')]==='赤字','★★赤字の行は「赤字」と入れて残す');
ok(red[head.indexOf('ジャンル')]==='ゲーム','★赤字の行もジャンルが入る');

console.log('\n=== 手数料を変えると取り直さずに計算し直せる ===');
let again=await p.evaluate((R)=>{
  $('mwAmzFeeGame').value='8'; $('mwAmzFbaGame').value='0';
  const z=mwAmzCalc(R.filter((x)=>x.jan==='4595120538169')[0]);
  return { rate:z.rate, fba:z.fba, fee:z.fee, profit:z.profit, net:z.net };
},ROWS);
console.log('   '+JSON.stringify(again));
ok(again.rate===8&&again.fba===0,
   '★★⚙設定の値がそのまま効く（**0 を入れても既定値に戻らない**）');
ok(again.fee===Math.round(24829*0.08),'★★手数料が計算し直される');
ok(again.profit>c.game.profit,'★★利益も計算し直される（取り直し不要）');
ok(again.net===Math.round(again.profit*10/11),'★税抜も付いてくる');

await T.done();
})();
