/* 在庫CSVの読み方：メーカーコードとメーカー名の列（8.68・カジの依頼）
   MPN には**メーカーの型番**を入れる（JAN を入れるのは誤り）。
   MW の在庫CSVにその列があれば使い、無ければ空のままにする（推測しない）。
   どの列を使っていないかも返して、取り込みの結果に出せるようにする。 */
import MW from '../shared/mwcsv.js';
import { harness } from './lib.mjs';
const T=harness('在庫CSV：メーカーコードとメーカー名の列');
const ok=T.ok;

const HEAD='JAN,社,機種,商品名,定価,発売日,新・中,卸値,掲載数,備考,出荷日';
const ROW='4528272010290,キーズファクトリー,Switch2,カードポッド,1500,'
  +'2026/06/05,新,1200,10,,即日';

console.log('=== 今までの列（メーカーコードなし）===');
{
  const d=MW.parse(HEAD+'\n'+ROW+'\n');
  ok(d.rows.length===1,'★行は今までどおり読める');
  ok(d.has_maker_code===false&&d.rows[0].maker_code==='',
     '★★★メーカーコードの列が無ければ空（JAN を入れない）');
  ok(d.has_maker===false&&d.rows[0].maker==='',
     '★メーカー名の列が無ければ空（社をメーカー名として使う）');
  ok(d.rows[0].sha==='キーズファクトリー','★★社（メーカー名）は今までどおり');
  ok((d.extra||[]).length===0,'★使っていない列は無い');
}

console.log('\n=== メーカーコードの列があるとき ===');
['メーカーコード','メーカー品番','メーカー型番','品番','型番','商品コード']
  .forEach((nm)=>{
    const d=MW.parse(HEAD+','+nm+'\n'+ROW+',KCP-004-1\n');
    ok(d.has_maker_code===true&&d.maker_code_col===nm
       &&d.rows[0].maker_code==='KCP-004-1','★「'+nm+'」を読む');
  });
{
  const d=MW.parse(HEAD+',メーカー\n'+ROW+',キーズファクトリー\n');
  ok(d.has_maker===true&&d.rows[0].maker==='キーズファクトリー',
     '★★メーカー名の列も読む');
}

console.log('\n=== 使っていない列の名前を返す ===');
{
  const d=MW.parse(HEAD+',謎の列,もう1つ\n'+ROW+',x,y\n');
  ok((d.extra||[]).join('／')==='謎の列／もう1つ',
     '★★★使っていない列の名前を返す（MW が列を増やしたら気づける）');
  ok((d.head||[]).length===13,'★★見出しの名前もそのまま返す');
  ok(d.rows.length===1,'★使っていない列があっても行は読める');
}
{
  /* 列が増えた行は「列が多い行」として数えない（見出しも増えているため）。 */
  const d=MW.parse(HEAD+',メーカーコード\n'+ROW+',KCP-004-1\n');
  ok((d.many||0)===0&&(d.few||0)===0,'★★列が合わない行として数えない');
}

console.log('\n=== 型番が空のときは空のまま ===');
{
  const d=MW.parse(HEAD+',メーカーコード\n'+ROW+',\n');
  ok(d.rows[0].maker_code==='','★★★空欄は空のまま（JAN を入れない）');
  ok(!/4528272010290/.test(String(d.rows[0].maker_code)),
     '★★★型番に JAN は入らない');
}

T.done();
