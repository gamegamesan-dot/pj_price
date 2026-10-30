/* 画面：ランキングの上限を大分類ごとに決める（6.124）
   大分類ごとに売れ行きが違うので、1つの値では使えない
   （ホビーの90万位とゲームの90万位は意味が違う）。
   ・⚙設定の「Amazon刈取」に表を置く。行は**いまのデータにある大分類**を
     件数の多い順に並べ、件数も添える。0 か空なら、その分類は制限なし
   ・新しい大分類が出てきたら自動で行を足す（既定は制限なし）
   ・絞り込みは**行ごとに自分の大分類の上限**で見る
   ・設定は端末ではなく **pj-sync（/settings）に保存**する。
     作業者用の端末でも同じ基準で絞り込まれ、変更は管理者だけ
   ・一覧の上に「ランキングの基準で隠した行 n件」を出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：ランキングの上限（大分類ごと）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const base={ sha:'M200', cond:'新品', stock:9, note:'', ship_text:'即日出荷',
  ship_days:0, basis:'カート', new_n:4, low_n:1, amz:0, fba_n:3, amz_err:'',
  amz_at:'2026-10-29T01:00:00Z', rst:'ok', list_price:9800, wholesale:3000,
  price:9000 };
/* ホビー3件・ゲーム2件・おもちゃ1件・順位なし1件。 */
const ROWS=[
 Object.assign({},base,{ jan:'4580033110113', kishu:'figure',
   mw_name:'ホビーA', asin:'B00HOBBY01', amz_name:'ホビーA',
   rank:948040, rank_cat:'ホビー', rank_sub:11481,
   rank_sub_cat:'ロボットのプラモデル・模型' }),
 Object.assign({},base,{ jan:'4580033110114', kishu:'figure',
   mw_name:'ホビーB', asin:'B00HOBBY02', amz_name:'ホビーB',
   rank:120000, rank_cat:'ホビー' }),
 Object.assign({},base,{ jan:'4580033110115', kishu:'figure',
   mw_name:'ホビーC', asin:'B00HOBBY03', amz_name:'ホビーC',
   rank:3000, rank_cat:'ホビー' }),
 Object.assign({},base,{ jan:'4902370550467', kishu:'NS',
   mw_name:'ゲームA', asin:'B00GAME001', amz_name:'ゲームA',
   rank:1200, rank_cat:'ゲーム' }),
 Object.assign({},base,{ jan:'4902370550468', kishu:'NS',
   mw_name:'ゲームB', asin:'B00GAME002', amz_name:'ゲームB',
   rank:90000, rank_cat:'ゲーム' }),
 Object.assign({},base,{ jan:'4988611224878', kishu:'NS',
   mw_name:'おもちゃA', asin:'B00TOY0001', amz_name:'おもちゃA',
   rank:50000, rank_cat:'おもちゃ' }),
 Object.assign({},base,{ jan:'4970381909444', kishu:'NS',
   mw_name:'順位なし', asin:'B00NORANK1', amz_name:'順位なし',
   rank:null, rank_cat:'' })];
const META={ ok:true, n:7, rows:ROWS, seen:7, priced:7, left:0, per_run:120,
  ttl_days:3, limit:3000 };

const setup=async(role)=>await p.evaluate(([META,role])=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='5';
  $('mwKishu').value='NS,figure'; $('mwNewOnly').checked=true;
  $('mwNoteAll').checked=false; $('mwNoteNg').value='';
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  $('mwAmzFeeHobby').value='10'; $('mwAmzFbaHobby').value='580';
  window.__put=[]; window.__srv={ at:'', settings:{} };
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:role,staff_key_set:true}),
        {status:200});
    if(/\/settings/.test(url)){
      if(i&&i.method==='POST'){
        /* Worker は作業者用のキーでは 403（価格の設定は管理者だけ）。 */
        if(role!=='admin')
          return new Response(JSON.stringify({error:'forbidden_staff'}),{status:403});
        window.__put.push(b);
        window.__srv={ at:b.at, settings:b.settings };
        return new Response(JSON.stringify({ok:true,stored:true,at:b.at,
          settings:b.settings}),{status:200});
      }
      return new Response(JSON.stringify(Object.assign({ok:true},window.__srv)),
        {status:200});
    }
    if(/\/mw\/buy/.test(url))
      return new Response(JSON.stringify({ok:true,rows:[],n:0}),{status:200});
    if(/\/mw\/amz/.test(url))
      return new Response(JSON.stringify(META),{status:200});
    return real(u,i);
  };
  syncRole=role; roleApply();
},[META,role]);
const load=async()=>{
  await p.evaluate(()=>switchTab('F'));
  await p.evaluate(()=>{ $('csvMwAmzLoad').click(); });
  await p.waitForTimeout(500);
};
const table=()=>p.evaluate(()=>{
  switchTab('G');
  return Array.prototype.map.call(
    document.querySelectorAll('#mwRankCapBox input[data-rankcap]'),
    (el)=>({ cat:el.getAttribute('data-rankcap'),
      cap:el.value, off:el.disabled,
      label:(el.closest('.row').querySelector('label').textContent||'')
        .replace(/\s+/g,' ') }));
});
const names=()=>p.evaluate(()=>{
  switchTab('F');
  return Array.prototype.map.call(
    document.querySelectorAll('#csvMwAmzList > div'),
    (el)=>((el.innerText||'').match(/\b\d{13}\b/)||[''])[0]).filter(Boolean);
});
const setCap=async(cat,v)=>await p.evaluate(([cat,v])=>{
  switchTab('G');
  const el=document.querySelector('#mwRankCapBox input[data-rankcap="'+cat+'"]');
  if(!el)return false;
  el.value=String(v);
  el.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
},[cat,v]);

console.log('=== ⚙の表：件数の多い順に並ぶ ===');
await setup('admin');
await openCsvBoxes(p);
await load();
let t=await table();
console.log('   '+JSON.stringify(t.map((x)=>x.cat+':'+x.label.replace(x.cat,''))));
ok(t.length===3,'★★★いまのデータにある大分類だけ並ぶ（順位なしの行は数えない）');
ok(t[0].cat==='ホビー'&&t[1].cat==='ゲーム'&&t[2].cat==='おもちゃ',
   '★★★件数の多い順（ホビー3・ゲーム2・おもちゃ1）');
ok(/3件/.test(t[0].label)&&/2件/.test(t[1].label)&&/1件/.test(t[2].label),
   '★★★件数も添える');
ok(t.every((x)=>x.cap==='0'),'★★はじめはどの分類も 0（制限なし）');
ok(t.every((x)=>x.off===false),'★管理者の端末では入れられる');

console.log('\n=== 分類ごとに別の値で絞り込む ===');
ok((await names()).length===7,'★制限なしなら7行とも出る');
await setCap('ホビー',100000);
await p.waitForTimeout(300);
let v=await names();
console.log('   ホビー 10万位まで: '+JSON.stringify(v));
ok(v.indexOf('4580033110113')<0,'★★★ホビーの 948,040位は隠れる');
ok(v.indexOf('4580033110114')<0,'★★ホビーの 120,000位も上限を超えるので隠れる');
ok(v.indexOf('4580033110115')>=0,'★★ホビーの 3,000位は残る');
ok(v.indexOf('4902370550467')>=0&&v.indexOf('4902370550468')>=0,
   '★★★ゲームは制限なしなので 90,000位も残る（分類ごとに別の値）');
ok(v.indexOf('4970381909444')<0,'★★上限を入れたので、順位が無い行は隠れる');
await setCap('ゲーム',50000);
await p.waitForTimeout(300);
v=await names();
console.log('   ＋ゲーム 5万位まで: '+JSON.stringify(v));
ok(v.indexOf('4902370550468')<0,'★★★ゲームの 90,000位が隠れる');
ok(v.indexOf('4902370550467')>=0,'★ゲームの 1,200位は残る');
ok(v.indexOf('4988611224878')>=0,'★★おもちゃは制限なしなので 50,000位も残る');
let note=await p.evaluate(()=>($('csvMwAmzListNote').textContent||'')
  .replace(/\s+/g,' '));
console.log('   '+note.slice(note.indexOf('ランキング')).slice(0,30));
ok(/ランキングの基準で隠した行 4件/.test(note),
   '★★★一覧の上に隠した件数（ホビー2件＋ゲーム1件＋順位なし1件＝4件）');
await setCap('ホビー',0);
await p.waitForTimeout(300);
v=await names();
console.log('   ホビーを0（制限なし）に: '+JSON.stringify(v));
ok(v.indexOf('4580033110113')>=0,'★★★0 に戻すと、その分類は制限なしになる');

console.log('\n=== pj-sync に保存する（端末ではない）===');
await p.waitForTimeout(1200);
const put=await p.evaluate(()=>window.__put.map((x)=>x.settings.mwRankCaps));
console.log('   送った: '+JSON.stringify(put.slice(-1)));
ok(put.length>=1,'★★★変えると pj-sync に送る');
const last=JSON.parse(put[put.length-1]||'{}');
console.log('   '+JSON.stringify(last));
ok(last['ゲーム']===50000,'★★★分類ごとの値が入っている');
ok(!('ホビー' in last),'★★0（制限なし）は持たない');

console.log('\n=== 新しい大分類は自動で行を足す ===');
await p.evaluate(()=>{
  mwAmzRows.push({ jan:'4571224570000', sha:'M200', kishu:'figure',
    mw_name:'新しい分類', asin:'B00NEWCAT1', amz_name:'新しい分類',
    rank:4000, rank_cat:'ベビー＆マタニティ', cond:'新品', stock:9,
    ship_days:0, ship_text:'即日出荷', wholesale:3000, price:9000,
    basis:'カート', new_n:4, amz:0, rst:'ok', list_price:9800 });
  mwAmzRender();
});
t=await table();
console.log('   '+JSON.stringify(t.map((x)=>x.cat)));
ok(t.some((x)=>x.cat==='ベビー＆マタニティ'),
   '★★★新しい大分類の行が自動で足される');
ok(t.filter((x)=>x.cat==='ベビー＆マタニティ')[0].cap==='0',
   '★★足した行は制限なしで始まる');
ok((await names()).indexOf('4571224570000')>=0,'★制限なしなので一覧に出る');

console.log('\n=== 作業者用の端末：同じ基準で絞り込み、変更はできない ===');
/* 別の端末（作業者用）として開く。端末の控えは持っていない。 */
await p.evaluate(()=>{ try{ localStorage.clear(); }catch(e){} });
await p.reload(); await p.waitForTimeout(400);
await setup('staff');
/* pj-sync に入っている値（管理者が入れた分）を返す。 */
await p.evaluate(()=>{ window.__srv={ at:new Date().toISOString(),
  settings:{ mwRankCaps:JSON.stringify({ 'ホビー':100000, 'ゲーム':50000 }) } }; });
await p.evaluate(()=>advPull());
await p.waitForTimeout(500);
await openCsvBoxes(p);
await load();
const held=await p.evaluate(()=>mwRankCaps());
console.log('   受け取った基準: '+JSON.stringify(held));
ok(held['ホビー']===100000&&held['ゲーム']===50000,
   '★★★作業者用の端末も pj-sync から同じ基準を受け取る');
v=await names();
console.log('   '+JSON.stringify(v));
ok(v.indexOf('4580033110113')<0&&v.indexOf('4902370550468')<0,
   '★★★同じ基準で絞り込まれる');
t=await table();
console.log('   欄: '+JSON.stringify(t.map((x)=>x.cat+(x.off?'（押せない）':''))));
ok(t.length>=2&&t.every((x)=>x.off===true),
   '★★★作業者用の端末では欄を押せない（見るだけ）');
const noteS=await p.evaluate(()=>($('mwRankCapNote').textContent||''));
ok(/変更は管理者だけ/.test(noteS),'★★見るだけだと書いてある');
await p.evaluate(()=>{ window.__put=[];
  const el=document.querySelector('#mwRankCapBox input[data-rankcap]');
  el.disabled=false; el.value='1';            // 無理に書き換えても
  el.dispatchEvent(new Event('input',{bubbles:true}));
});
await p.waitForTimeout(1200);
const sent=await p.evaluate(()=>window.__put.length);
const after=await p.evaluate(()=>mwRankCaps());
console.log('   送った '+sent+' / いまの基準 '+JSON.stringify(after));
ok(sent===0,'★★★作業者用の端末からは送らない');
ok(after['ホビー']===100000,'★★★基準も変わらない');
await T.done();
})();
