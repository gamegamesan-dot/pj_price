/* 画面：使い方マニュアル（6.122）
   ・⚙設定の中にあり、**章ごとに開閉**できる（スマホで一度に長い文を見せない）
   ・機能の羅列ではなく「いつ・何をするか」の順。章は5つ
   ・タブの名前と並び（出品CSV／販売連携／eBay／Amazon刈取／⚙）に合っている
   ・管理者だけの操作には、作業者用の端末（STAFF_KEY）で「管理者だけ」の印が出る */
const { harness } = require('./lib');
const T = harness('画面：使い方マニュアル');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const open=async()=>await p.evaluate(()=>{
  switchTab('G');
  $('cfgManBox').open=true;
  document.querySelectorAll('#cfgManBox details.manc')
    .forEach(function(d){ d.open=true; });
});
const chap=(n)=>p.evaluate((n)=>{
  const d=document.querySelectorAll('#cfgManBox details.manc')[n];
  return d?{ sum:d.querySelector('summary').textContent.trim(),
    h5:Array.prototype.map.call(d.querySelectorAll('h5'),
      (h)=>h.textContent.replace(/管理者だけ/g,'').trim()),
    text:(d.innerText||'').replace(/\s+/g,' ') }:null;
},n);

await open();

console.log('=== 章立て ===');
const sums=await p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('#cfgManBox details.manc>summary'),
  (x)=>x.textContent.trim()));
console.log('   '+JSON.stringify(sums));
ok(sums.length===5,'★★★章は5つ');
ok(/^1\. 毎日の作業/.test(sums[0]),'★★1章は「毎日の作業」（まずこれを見る）');
ok(/Amazon刈取/.test(sums[1]),'★★2章は Amazon刈取');
ok(/eBay 出品/.test(sums[2]),'★★3章は eBay 出品');
ok(/販売連携/.test(sums[3]),'★★4章は 販売連携（売れたとき）');
ok(/困ったとき/.test(sums[4]),'★★5章は 困ったとき');
/* 畳んだ状態から始める（開くのは読みたい章だけ）。 */
const shut=await p.evaluate(()=>{
  document.querySelectorAll('#cfgManBox details.manc')
    .forEach(function(d){ d.open=false; });
  const d=document.querySelector('#cfgManBox details.manc');
  d.querySelector('summary').click();
  const r={ one:d.open,
    others:Array.prototype.filter.call(
      document.querySelectorAll('#cfgManBox details.manc'),(x)=>x.open).length };
  return r;
});
console.log('   '+JSON.stringify(shut));
ok(shut.one===true&&shut.others===1,'★★★章は1つずつ開ける（タップで開閉）');
await open();

console.log('\n=== タブの名前と並びに合っている ===');
const all=await p.evaluate(()=>($('cfgManBox').innerText||'').replace(/\s+/g,' '));
ok(/出品CSV/.test(all)&&/販売連携/.test(all)&&/Amazon刈取/.test(all),
   '★★いまのタブの名前で書いている');
ok(!/Shopee/.test(all),'★★タブから外した Shopee は書かない');
ok(!/出品文タブ/.test(all),'★無くなった「出品文」タブは書かない');

console.log('\n=== 1章：毎日の作業の順 ===');
let c=await chap(0);
console.log('   '+JSON.stringify(c.h5));
ok(/朝/.test(c.h5[0])&&/MW の在庫CSV/.test(c.h5[0]),'★★★まず MW の在庫CSVの取り込み');
ok(/取り込んだあと/.test(c.h5[1]),'★★次に「取り込んだあとにすること」');
ok(/Discord/.test(c.h5[2]),'★★そのあと Discord の通知の見方');
ok(/画面を開いたまま/.test(c.text),'★★取り込み中は画面を開いたまま、と書いてある');
ok(/24時間/.test(c.text)&&/催促/.test(c.text),'★★24時間の催促のことが書いてある');
ok(/一覧を出す/.test(c.text)&&/Amazonで調べる/.test(c.text)
   &&/MWで欠品/.test(c.text),
   '★★★取り込んだあとの3つ（一覧の更新・Amazonで調べる・欠品の確認）');
['売り越しの恐れ','フェイズB','数量を0にしました','MWで欠品',
 'MW に注文してください','在庫補充'].forEach(function(s){
  ok(c.text.indexOf(s)>=0,'★通知：'+s);
});

console.log('\n=== 2章：Amazon刈取の流れ ===');
c=await chap(1);
console.log('   '+JSON.stringify(c.h5));
ok(/Amazonで調べる/.test(c.h5[0]),'★★①は「Amazonで調べる」');
ok(/一覧の見方/.test(c.h5[1]),'★★②は一覧の見方');
ok(/仕入れる/.test(c.h5[2])&&/注文/.test(c.h5[2]),'★★③は仕入れる印から注文まで');
ok(/Amazon に登録/.test(c.h5[3]),'★★④は Amazon への登録');
ok(/自動の取り直し/.test(c.h5[4]),'★★⑤は自動の取り直し');
ok(/①10秒/.test(c.text)&&/②5秒/.test(c.text)&&/③40秒/.test(c.text),
   '★★★段ごとの持ち時間（10／5／40秒）');
ok(/残りが0になるまで押す/.test(c.text),'★★押す回数の目安');
ok(/夜中3時前後/.test(c.text),'★★★夜中3時前後は避ける');
ok(/せどりすと方式/.test(c.text)&&/仮の手数料/.test(c.text),
   '★★粗利は せどりすと方式・手数料は実際の値（取れない行は仮）');
ok(/ランキングは大分類/.test(c.text)&&/948,040位/.test(c.text),
   '★★★ランキングは大分類（例つき）');
ok(/JAN重複/.test(c.text)&&/自動では決めない/.test(c.text),
   '★★JAN重複の選び方');
ok(/緑/.test(c.text)&&/黄/.test(c.text)&&/赤/.test(c.text),'★★緑・黄・赤');
ok(/送料無料/.test(c.text)&&/50,000/.test(c.text),'★★送料無料までの残り');
ok(/JAN をコピー/.test(c.text)&&/注文用CSV/.test(c.text)&&/吉田/.test(c.text),
   '★★★JANコピー・注文用CSV・吉田さんに頼む');
ok(/1件だけ送る/.test(c.text)&&/在庫管理/.test(c.text)
   &&/残りをまとめて送る/.test(c.text),
   '★★★登録は1件 → セラーセントラルで確認 → 残りをまとめて');
ok(/納品/.test(c.text)&&/マカド/.test(c.text)&&/納品が完了してから/.test(c.text),
   '★★★納品はセラーセントラル・価格改定はマカド（納品完了後に反映）');
ok(/既定はオフ/.test(c.text)&&/在庫CSVの取り込みは手動/.test(c.text),
   '★★自動の取り直しは既定オフ・CSV の取り込みは手動のまま');

console.log('\n=== 3章：eBay 出品の流れ ===');
c=await chap(2);
console.log('   '+JSON.stringify(c.h5));
ok(/せどりすとCSV/.test(c.h5[0])&&/英題/.test(c.h5[1])&&/写真/.test(c.h5[2])
   &&/File Exchange/.test(c.h5[3])&&/結果/.test(c.h5[4]),
   '★★★取り込み → 英題 → 写真 → 書き出し → 結果 の順');
ok(/一点物/.test(c.text)&&/特典/.test(c.text),'★★中古フィギュアは自動で一点物');
ok(/相場を調べる/.test(c.text)&&/7日/.test(c.text),'★★MW 無在庫の相場の調べ方');
ok(/MW が利用を許諾した画像だけ/.test(c.text)
   &&/Amazon の画像は使わない/.test(c.text),
   '★★★写真は MW が許諾したものだけ（Amazon の画像は使わない）');
ok(/出品リストに入れる/.test(c.text),'★★出品リストに入れる');
ok(/配送ポリシー/.test(c.text)&&/W2000/.test(c.text),'★★無在庫用の配送ポリシー');

console.log('\n=== 4章：売れたとき ===');
c=await chap(3);
console.log('   '+JSON.stringify(c.h5));
ok(/探す/.test(c.h5[0]),'★★まず「商品を探す」');
ok(/ItemID/.test(c.text)&&/📷/.test(c.text),'★★検索欄と📷');
ok(/フェイズB/.test(c.text)&&/数量0/.test(c.text)&&/再調達/.test(c.text),
   '★★★FBA で売れたとき（数量0・再調達）');
ok(/在庫補充/.test(c.text)&&/売れた値段のまま/.test(c.text),
   '★★eBay で売れたとき（在庫補充）');
ok(/手元在庫の印/.test(c.text)&&/名簿を送る/.test(c.text),
   '★★手元在庫の印の付き方');
ok(/印を付ける/.test(c.text)&&/元に戻す/.test(c.text),
   '★★★付け忘れたときの直し方（印を付ける ▾・元に戻す）');
ok(/終了せず数量0/.test(c.h5[4]||'')||/数量0で残す/.test(c.text),
   '★★★出品は終了せず数量0で残す');
ok(/ItemID が消えて/.test(c.text),'★★終了するとどうなるかも書く');

console.log('\n=== 5章：困ったとき ===');
c=await chap(4);
console.log('   '+JSON.stringify(c.h5));
ok(/版/.test(c.h5[0]),'★★版の確かめ方と更新');
ok(/ヘッダー/.test(c.text)&&/更新があります/.test(c.text),'★★ヘッダーの版と更新の帯');
ok(/Load failed/.test(c.text)&&/続きから送り直す/.test(c.text),
   '★★★取り込みの Load failed の直し方');
ok(/10000/.test(c.text)&&/7403/.test(c.text)&&/wrangler login/.test(c.text),
   '★★★wrangler の 10000／7403 は npx wrangler login');
ok(/d1-exec\.mjs/.test(c.text),'★★★マイグレーションは d1-exec.mjs');
ok(/git pull/.test(c.text)&&/wrangler deploy/.test(c.text)
   &&/必ずデプロイの前/.test(c.text),
   '★★★デプロイの手順（pull → マイグレーション → deploy）');

console.log('\n=== 管理者だけの印（作業者用の端末）===');
const adm=await p.evaluate(()=>{
  const q=document.querySelectorAll('#cfgManBox .admonly');
  return { n:q.length, shown:getComputedStyle(q[0]).display,
    near:Array.prototype.map.call(q,(x)=>
      (x.closest('li')||x.closest('h5')||x).textContent.replace(/\s+/g,' ')
        .slice(0,24)) };
});
console.log('   '+adm.n+'個 / '+adm.shown);
ok(adm.n>=7,'★★管理者だけの操作に印が付いている');
ok(adm.shown==='none','★★管理者の端末では印を出さない（全部押せるので）');
const staff=await p.evaluate(()=>{
  localStorage.setItem('pj:role:v1','staff');
  syncRole='staff'; roleApply();
  const q=document.querySelectorAll('#cfgManBox .admonly');
  return { body:document.body.className, shown:getComputedStyle(q[0]).display,
    text:q[0].textContent.trim() };
});
console.log('   '+JSON.stringify(staff));
ok(/staff/.test(staff.body),'作業者用の端末にする');
ok(staff.shown!=='none'&&staff.text==='管理者だけ',
   '★★★作業者用の端末では「管理者だけ」と出る');
const where=await p.evaluate(()=>{
  const t=[];
  document.querySelectorAll('#cfgManBox .admonly').forEach(function(x){
    const h=x.closest('h5'), l=x.closest('li');
    t.push(((h||l||x).textContent||'').replace(/\s+/g,' ').slice(0,30));
  });
  return t;
});
console.log('   '+JSON.stringify(where));
const j=where.join('｜');
ok(/Amazonで調べる/.test(j),'★★★「Amazonで調べる」は管理者だけ');
ok(/Amazon に登録/.test(j),'★★★「Amazon に登録する」は管理者だけ');
ok(/自動の取り直し/.test(j),'★★自動の取り直しは管理者だけ');
ok(/フェイズB/.test(j),'★★フェイズBは管理者だけ');
ok(/デプロイ/.test(j),'★★デプロイは管理者だけ');
await T.done();
})();
