/* 画面：管理者と作業者で、Amazon刈取の一覧が同じ条件になること（6.142）
   候補は同じ 1237件なのに、管理者 28件・作業者 51件 しか出ていなかった。
   原因は「作業者の端末が pj-sync の設定を採らなくなる」こと。
   ・作業者は設定を送れない（Worker が 403）ので、その端末で何かを変えると
     advAt だけが新しくなり、以後ずっと D1 の設定を採らなかった
   ・そのためランキングの上限・手数料・為替が管理者と違っていた
   ここで見張ること：
   ・作業者の端末は、端末の時刻が新しくても **pj-sync の設定を採る**
   ・管理者の端末は、いままでどおり「あとから変えたほう」を採る
   ・一覧の絞り込み（黒字のみ・出品できる行だけ・利益率・新品2人以上など）も
     pj-sync に送る／受け取る
   ・「ランキングの基準で隠した行 n件」は作業者にも出る（言い方だけ変える） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：管理者と作業者で同じ条件');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>await d.accept());

/* pj-sync が持っている設定（管理者が決めたもの）。 */
const D1 = { at:'2026-11-01T00:00:00.000Z', settings:{
  mwRankCaps:'{"ホビー":900000,"ゲーム":80000}',
  csvMwAmzSort:'rank', csvMwAmzMinM:'15',
  csvMwAmzWin:true, csvMwAmzMulti:true, csvMwAmzNoAmz:false,
  csvMwAmzRstOk:true, csvMwAmzDup:false, csvMwAmzNoRank:false,
  mwAmzFeeGame:'10', amzFeeRate:'15' } };

const setup=async(role,localAt)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  window.__posted=[];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u);
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:o.role}),{status:200});
    if(/\/settings/.test(url)){
      if((i||{}).method==='POST'){
        window.__posted.push(JSON.parse(i.body));
        if(o.role==='staff')return new Response(JSON.stringify({error:'forbidden'}),{status:403});
        return new Response(JSON.stringify({ok:true,stored:true,at:JSON.parse(i.body).at}),{status:200});
      }
      return new Response(JSON.stringify(Object.assign({ok:true},o.d1)),{status:200});
    }
    return real(u,i);
  };
  syncRole=o.role; roleApply();
  /* この端末のほうが「あとから変えた」状態を作る（作業者の実機と同じ）。 */
  advAt=o.localAt||'';
  $('mwRankCaps').value='';            // 作業者の端末は上限を持っていない
  $('csvMwAmzMinM').value='0';
  $('csvMwAmzMulti').checked=false;
  $('csvMwAmzRstOk').checked=false;
},{role,localAt,d1:D1});

/* ---- 1. 作業者の端末：自分のほうが新しくても D1 を採る ---- */
await setup('staff','2026-11-06T09:00:00.000Z');   // 端末のほうが新しい
await p.evaluate(()=>advPull());
await p.waitForTimeout(200);
let g=await p.evaluate(()=>({ caps:$('mwRankCaps').value,
  sort:$('csvMwAmzSort').value, minM:$('csvMwAmzMinM').value,
  multi:$('csvMwAmzMulti').checked, rstOk:$('csvMwAmzRstOk').checked,
  noAmz:$('csvMwAmzNoAmz').checked, fee:$('mwAmzFeeGame').value,
  posted:window.__posted.length }));
console.log('   '+JSON.stringify(g));
ok(/ホビー/.test(g.caps)&&/80000/.test(g.caps),
   '★★★作業者の端末もランキングの上限を受け取る（これが空で51件出ていた）');
ok(g.sort==='rank'&&g.minM==='15','★★並べ替えと利益率の既定値も受け取る');
ok(g.multi===true&&g.rstOk===true,'★★★チェックの絞り込みも受け取る');
ok(g.noAmz===false,'★オフはオフのまま受け取る');
ok(g.fee==='10','★手数料など計算に入る設定も受け取る（黒字の判定が同じになる）');
ok(g.posted===0,'★作業者は送らない（Worker が 403 なので押し付けない）');

/* ---- 2. 管理者の端末：あとから変えたほうを採る（いままでどおり）---- */
await setup('admin','2026-11-06T09:00:00.000Z');   // 端末のほうが新しい
await p.evaluate(()=>advPull());
await p.waitForTimeout(200);
g=await p.evaluate(()=>({ caps:$('mwRankCaps').value, posted:window.__posted.length }));
ok(g.caps===''&&g.posted===1,
   '★★管理者で端末のほうが新しいときは、端末の値を pj-sync に送る');

await setup('admin','2026-10-01T00:00:00.000Z');   // D1 のほうが新しい
await p.evaluate(()=>advPull());
await p.waitForTimeout(200);
g=await p.evaluate(()=>({ caps:$('mwRankCaps').value, minM:$('csvMwAmzMinM').value }));
ok(/ホビー/.test(g.caps)&&g.minM==='15','★管理者も D1 が新しければ合わせる');

/* ---- 3. 送る中身に絞り込みが入っている ---- */
await setup('admin','2026-11-06T09:00:00.000Z');
await p.evaluate(()=>{
  $('csvMwAmzWin').checked=true; $('csvMwAmzMulti').checked=true;
  $('csvMwAmzMinM').value='12'; $('csvMwAmzSort').value='margin';
  advPush();
});
await p.waitForTimeout(200);
const body=await p.evaluate(()=>window.__posted[0]||null);
ok(!!body&&body.settings.csvMwAmzMinM==='12'&&body.settings.csvMwAmzSort==='margin',
   '★★並べ替えと利益率を送る');
ok(body.settings.csvMwAmzWin===true&&body.settings.csvMwAmzMulti===true,
   '★★★チェックの絞り込みを真偽値で送る');
ok(body.settings.mwRankCaps!==undefined,'★ランキングの上限も一緒に送る');

/* ---- 4. 「ランキングの基準で隠した行」は作業者にも出る ---- */
const rows=async(role)=>await p.evaluate(async(role)=>{
  syncRole=role; roleApply();
  $('mwRankCaps').value='{"ゲーム":80000}';
  $('csvMwAmzWin').checked=false; $('csvMwAmzMulti').checked=false;
  $('csvMwAmzRstOk').checked=false; $('csvMwAmzDup').checked=false;
  $('csvMwAmzMinM').value='0'; $('csvMwAmzNoRank').checked=false;
  const mk=(jan,rank)=>({ jan:jan, asin:'B0'+jan.slice(0,8), name:'品 '+jan,
    kishu:'Switch', cond:'新品', stock:5, ship_days:1, wholesale:1000,
    list_price:3000, price:3000, rank:rank, rank_cat:'ゲーム',
    fee_total:400, fee_ref:300, fee_fba:100, fee_tax:0, fee_base:3000,
    rst_ok:1, rst_at:new Date().toISOString(), note:'' });
  mwAmzRows=[mk('4902370550001',1000),mk('4902370550002',90000),
             mk('4902370550003',95000)];
  mwAmzMeta={ n:1237, seen:1237, priced:1237 };
  mwAmzRender();
  const note=$('csvMwAmzListNote').textContent;
  return { note:note, hid:mwRankHid,
    shown:document.querySelectorAll('#csvMwAmzList [data-mwrow]').length };
},role);
let ad=await rows('admin');
let st=await rows('staff');
console.log('   管理者: hid='+ad.hid+' / 作業者: hid='+st.hid);
ok(ad.hid===2&&st.hid===2,'★★★同じ上限なら隠す件数も同じ');
ok(/ランキングの基準で隠した行 2件/.test(ad.note),'★管理者に出る');
ok(/ランキングの基準で隠した行 2件/.test(st.note),
   '★★★作業者にも「隠した行 n件」が出る（出ていなかった）');
ok(/管理者が⚙で決めた基準/.test(st.note),'★★作業者には言い方を変える');
ok(/⚙設定の「Amazon刈取」/.test(ad.note),'★管理者には変え方を出す');

await T.done();
})();
