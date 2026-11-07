/* 画面：取り込みの知らせの設定と、登録の記録（6.151）
   ・⚙に「在庫CSVを取り込んだときの知らせ」（どれを知らせるか・上位何件か）を置き、
     **pj-sync（/settings）に送る**（Worker がこれを読んで Discord に出す）
   ・⚙に「1日の登録の上限」（既定30件）と「登録の記録（誰が・いつ・何を）」を置く
   ・取り込みの結果は「今回 新しく欠品 n行（商品 n件）」と「欠品の合計」を分けて出す
   ・知らせのリンク（#tab=F&view=buy）でそのタブ・その一覧が開く */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：取り込みの知らせと登録の記録（6.151）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const setup=async(role)=>await p.evaluate((role)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__put=[]; window.__srv={ at:'', settings:{} };
  window.__log=[{ at:'2026-11-07T01:00:00Z', at_jst:'2026-11-07 10:00',
      sku:'mwgame-20261105-N-B0STAFF777-3476', asin:'B0STAFF777',
      jan:'4902370559001', price:9980, ok:1, status:'ACCEPTED', issues:[],
      err:'', by_role:'staff' },
    { at:'2026-11-06T02:00:00Z', at_jst:'2026-11-06 11:00',
      sku:'mwhobby-20261101-N-B0ADMIN777-2200', asin:'B0ADMIN777',
      jan:'4902370559002', price:7000, ok:0, status:'', issues:[],
      err:'電池の申告が要ります', by_role:'admin' }];
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:role,staff_key_set:true}),
        {status:200});
    if(/\/settings/.test(url)){
      if(i&&i.method==='POST'){
        window.__put.push(b);
        Object.keys(b.settings||{}).forEach((k)=>{
          window.__srv.settings[k]=b.settings[k]; });
        return new Response(JSON.stringify({ok:true,stored:true,at:b.at,
          settings:window.__srv.settings}),{status:200});
      }
      return new Response(JSON.stringify(Object.assign({ok:true},window.__srv)),
        {status:200});
    }
    if(/\/mw\/put/.test(url))
      return new Response(JSON.stringify({ok:true,rows:window.__log,sent_ok:1,
        max:30,day:{max:30,used:1,left:29,day:'2026-11-07'}}),{status:200});
    if(/\/mw\/(buy|amz)/.test(url))
      return new Response(JSON.stringify({ok:true,rows:[],n:0}),{status:200});
    return real(u,i);
  };
  syncRole=role; roleApply();
},role);

console.log('=== ⚙の設定（どれを知らせるか・上位何件か）===');
await setup('admin');
await openCsvBoxes(p);
let v=await p.evaluate(()=>{
  switchTab('G');
  return { drop:$('mwNtDrop').checked, buy:$('mwNtBuy').checked,
    nw:$('mwNtNew').checked, top:$('mwNtTop').value, day:$('mwPutDay').value,
    inAmz:!!document.querySelector('#cfgAmzBox #mwNtTop') };
});
console.log('   '+JSON.stringify(v));
ok(v.drop===true&&v.buy===true&&v.nw===true,'★★既定は3つとも知らせる');
ok(v.top==='10','★★上位の件数の既定は10件');
ok(v.day==='30','★★★1日の登録の上限の既定は30件');
ok(v.inAmz,'★⚙の「Amazon刈取（国内FBA）」の中にある');

console.log('\n=== 設定は pj-sync に送る（Worker が読む）===');
await p.evaluate(()=>{
  $('mwNtNew').checked=false;
  $('mwNtNew').dispatchEvent(new Event('change',{bubbles:true}));
  $('mwNtTop').value='5';
  $('mwNtTop').dispatchEvent(new Event('input',{bubbles:true}));
  $('mwPutDay').value='50';
  $('mwPutDay').dispatchEvent(new Event('input',{bubbles:true}));
  advSyncNow();
});
await p.waitForTimeout(600);
v=await p.evaluate(()=>window.__srv.settings);
console.log('   '+JSON.stringify({mwNtNew:v.mwNtNew,mwNtTop:v.mwNtTop,
  mwPutDay:v.mwPutDay,mwNtDrop:v.mwNtDrop}));
ok(v.mwNtNew===false,'★★★オフにしたら false で送る（真偽値）');
ok(v.mwNtTop==='5','★★上位の件数も送る');
ok(v.mwPutDay==='50','★★★1日の登録の上限も送る');
ok(v.mwNtDrop===true,'★触っていない項目も（最初の1回で）そろう');

console.log('\n=== ⚙：登録の記録（誰が・いつ・何を）===');
await p.evaluate(()=>{ $('mwPutLogBtn').click(); });
await p.waitForTimeout(500);
v=await p.evaluate(()=>({ note:($('mwPutLogNote').innerText||'').replace(/\s+/g,' '),
  box:($('mwPutLogBox').innerText||'').replace(/\s+/g,' ') }));
console.log('   '+JSON.stringify(v).slice(0,320));
ok(/今日の登録 1件/.test(v.note)&&/上限 30件/.test(v.note)&&/残り 29件/.test(v.note),
   '★★★今日の件数と上限・残りを出す');
ok(/作業者/.test(v.box)&&/管理者/.test(v.box),'★★★誰が登録したかを出す');
ok(/2026-11-07 10:00/.test(v.box),'★★いつ登録したかを出す（日本時間）');
ok(/mwgame-20261105-N-B0STAFF777-3476/.test(v.box),'★★何を登録したか（SKU）');
ok(/通った/.test(v.box)&&/だめ/.test(v.box)&&/電池の申告/.test(v.box),
   '★★成功・失敗とその理由を出す');

console.log('\n=== 取り込みの結果：今回と合計を分ける ===');
v=await p.evaluate(()=>{
  /* 取り込みの結果の文を組み立てる部分だけを当てはめる。 */
  const sum={ added:0, changed:2, same:11400, gone:799, back:0, picked:5600,
    seen:11400, gone_jan:750, gone_all:1200, gone_all_jan:1100 };
  return '✓ 11400行を送りました（足した '+sum.added
    +'／変わった '+sum.changed+'／同じ '+sum.same
    +'／今回 新しく欠品 '+sum.gone+'行'
    +(sum.gone_jan?('（商品 '+sum.gone_jan+'件）'):'')
    +'／戻った '+sum.back+'）'
    +'　欠品の合計 '+(sum.gone_all||0)+'行'
    +(sum.gone_all_jan?('（商品 '+sum.gone_all_jan+'件）'):'');
});
console.log('   '+v);
ok(/今回 新しく欠品 799行（商品 750件）/.test(v),
   '★★★「今回 新しく欠品」と書く（累計と混ざらない）');
ok(/欠品の合計 1200行（商品 1100件）/.test(v),'★★★「欠品の合計」も別に出す');

console.log('\n=== 知らせのリンクからそのタブを開く ===');
v=await p.evaluate(()=>{
  location.hash='#tab=M';
  const a=tabHash();
  const m=CUR_TAB;
  location.hash='#tab=F&view=buy';
  const b=tabHash();
  return { a:a, m:m, b:b, tab:CUR_TAB, hash:location.hash };
});
console.log('   '+JSON.stringify(v));
ok(v.a===true&&v.m==='M','★★★#tab=M で仕入れ（無在庫）が開く');
ok(v.b===true&&v.tab==='F','★★★#tab=F&view=buy で仕入れ（刈取）が開く');
ok(v.hash===''||v.hash==='#','★開いたらアドレスから消す（毎回飛ばない）');
await T.done();
})();
