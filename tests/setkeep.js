/* 画面：⚙の設定が消えないようにする（6.149）
   v234 で「ランキングの上限が 0 に戻る・種類の表が空・自動の取り直しがオフ」
   になった。原因は2つ重なっていた。
   ・画面は advGet() の**全項目**（空の欄も）を送っていた
   ・Worker は「送られてきた設定で丸ごと置き換え」だった
   そのため、一覧をまだ読み込んでいない端末で絞り込みを触るだけで、
   上限・種類・自動が 0／空／オフで上書きされて消えた。
   ここで見張ること：
   ・送るのは**変えた項目だけ**（空の欄は送らない）
   ・種類の表は空でも既定の2種類（FIGURINE・ABIS_VIDEO_GAMES）が印付きで出る
   ・自動の取り直しは件数で選ぶ（既定 オン・100件/時）
   ・⚙で書き込みの履歴が見られ、「戻す」で直前の値に戻る */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：設定が消えない（差分送信・履歴・戻す）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

/* pj-sync の代わり。**Worker と同じようにマージする**（7.109）。 */
const setup=async(role,srv)=>await p.evaluate(([role,srv])=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__put=[]; window.__log=[]; window.__undo=[];
  window.__srv={ at:(srv&&srv.at)||'', settings:(srv&&srv.settings)||{} };
  const NOBLANK=['mwRankCaps','mwDgTypes'];
  const blank=(v)=>v===''||v===undefined||v===null
    ||(typeof v==='string'&&/^\s*\{\s*\}\s*$/.test(v));
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:role,staff_key_set:true}),
        {status:200});
    if(/\/settings\/log/.test(url)){
      if(role!=='admin')return new Response('{"error":"forbidden_staff"}',{status:403});
      return new Response(JSON.stringify({ok:true,rows:window.__log.slice().reverse()}),
        {status:200});
    }
    if(/\/settings\/undo/.test(url)){
      if(role!=='admin')return new Response('{"error":"forbidden_staff"}',{status:403});
      window.__undo.push(b&&b.id);
      const row=window.__log.filter((x)=>x.id===(b&&b.id))[0];
      if(!row)return new Response('{"ok":false,"error":"not_found"}',{status:200});
      Object.keys(row.before).forEach((k)=>{
        if(row.before[k]===null)delete window.__srv.settings[k];
        else window.__srv.settings[k]=row.before[k];
      });
      window.__srv.at=new Date().toISOString();
      return new Response(JSON.stringify({ok:true,undone:row.id,
        keys:Object.keys(row.before),at:window.__srv.at,
        settings:window.__srv.settings}),{status:200});
    }
    if(/\/settings/.test(url)){
      if(i&&i.method==='POST'){
        if(role!=='admin')
          return new Response(JSON.stringify({error:'forbidden_staff'}),{status:403});
        window.__put.push(b);
        const before={}, keys=[];
        Object.keys(b.settings).forEach((k)=>{
          const v=b.settings[k];
          /* null は「消す」（7.109）。 */
          if(v===null){
            if(!(k in window.__srv.settings))return;
            before[k]=window.__srv.settings[k]; keys.push(k);
            delete window.__srv.settings[k];
            return;
          }
          if(NOBLANK.indexOf(k)>=0&&blank(v)&&!blank(window.__srv.settings[k]))return;
          if(JSON.stringify(window.__srv.settings[k])===JSON.stringify(v))return;
          before[k]=(window.__srv.settings[k]===undefined)
            ?null:window.__srv.settings[k];
          keys.push(k);
          window.__srv.settings[k]=v;
        });
        window.__srv.at=b.at;
        if(keys.length)window.__log.push({ id:window.__log.length+1, at:b.at,
          at_jst:'2026-11-07 '+(10+window.__log.length)+':00', role:'admin',
          keys_n:keys.length, keys:keys, before:before,
          after:keys.reduce((o,k)=>(o[k]=window.__srv.settings[k],o),{}) });
        return new Response(JSON.stringify({ok:true,stored:true,at:b.at,
          settings:window.__srv.settings,changed:keys}),{status:200});
      }
      return new Response(JSON.stringify(Object.assign({ok:true},window.__srv)),
        {status:200});
    }
    if(/\/mw\/ptypes/.test(url))
      return new Response(JSON.stringify({ok:true,seen:[],all:[]}),{status:200});
    if(/\/mw\/(buy|amz)/.test(url))
      return new Response(JSON.stringify({ok:true,rows:[],n:0}),{status:200});
    return real(u,i);
  };
  syncRole=role; roleApply();
},[role,srv]);

/* 管理者がすでに入れてある値（D1 の中身）。 */
const SRV={ at:'2026-11-06T01:00:00.000Z', settings:{
  mwRankCaps:'{"ホビー":900000,"ゲーム":80000}',
  mwDgTypes:'{"FIGURINE":1,"ABIS_VIDEO_GAMES":1}',
  mwAutoMode:'100', mwAutoPerHour:'100', baseProfit:'2500' } };

console.log('=== 開いたときは D1 の値を採る ===');
await setup('admin',SRV);
await p.evaluate(()=>advPull());
await p.waitForTimeout(300);
let v=await p.evaluate(()=>({ caps:$('mwRankCaps').value, dg:$('mwDgTypes').value,
  mode:$('mwAutoMode').value, per:$('mwAutoPerHour').value,
  base:$('baseProfit').value, sent:!!advSent }));
console.log('   '+JSON.stringify(v));
ok(v.caps==='{"ホビー":900000,"ゲーム":80000}','★ランキングの上限が入る');
ok(v.mode==='100'&&v.per==='100','★自動の取り直しは「100件/時」で入る');
ok(v.sent===true,'★差分の基準（advSent）を控える');

console.log('\n=== まず1回そろえる（この端末と D1 が同じ値になる）===');
await p.evaluate(()=>advSyncNow());
await p.waitForTimeout(400);
let put0=await p.evaluate(()=>window.__put);
ok(put0.length===1&&Object.keys(put0[0].settings).length>5,
   '★まだ D1 に無い項目は最初の1回でまとめて送る');
ok((await p.evaluate(()=>window.__srv.settings.mwRankCaps))
   ==='{"ホビー":900000,"ゲーム":80000}','★そのときも上限は消えない');

console.log('\n=== 絞り込みを触っただけ（v234 で消えていた操作）===');
await p.evaluate(()=>{
  /* 一覧をまだ読み込んでいない端末。隠し欄は空のまま。 */
  $('mwRankCaps').value=''; $('mwDgTypes').value='';
  $('csvMwAmzMinM').value='10';
  $('csvMwAmzMinM').dispatchEvent(new Event('input',{bubbles:true}));
  advSyncNow();
});
await p.waitForTimeout(300);
let put=await p.evaluate(()=>window.__put);
let srv=await p.evaluate(()=>window.__srv.settings);
console.log('   送った項目：'+JSON.stringify(Object.keys(put[1].settings)));
ok(put.length===2&&Object.keys(put[1].settings).length===1
   &&put[1].settings.csvMwAmzMinM==='10','★送るのは変えた1項目だけ');
ok(!('mwRankCaps' in put[1].settings)&&!('mwDgTypes' in put[1].settings),
   '★空の隠し欄は送らない');
ok(srv.mwRankCaps==='{"ホビー":900000,"ゲーム":80000}',
   '★D1 のランキングの上限は消えない');
ok(srv.mwDgTypes==='{"FIGURINE":1,"ABIS_VIDEO_GAMES":1}','★種類の表も消えない');
ok(srv.mwAutoMode==='100','★自動の取り直しも消えない');

console.log('\n=== 上限を変えたときは、その項目だけ送る ===');
await p.evaluate(()=>{
  $('mwRankCaps').value='{"ホビー":500000,"ゲーム":80000}';
  advSyncNow();
});
await p.waitForTimeout(300);
put=await p.evaluate(()=>window.__put);
srv=await p.evaluate(()=>window.__srv.settings);
console.log('   送った項目：'+JSON.stringify(Object.keys(put[2].settings)));
ok(Object.keys(put[2].settings).length===1
   &&put[2].settings.mwRankCaps==='{"ホビー":500000,"ゲーム":80000}',
   '★変えた上限だけ送る');
ok(srv.baseProfit==='2500','★ほかの項目（下限利益）はそのまま');
const same=await p.evaluate(()=>{ advSyncNow();
  return $('advSyncNote').textContent; });
await p.waitForTimeout(200);
put=await p.evaluate(()=>window.__put);
console.log('   同じ値のとき：'+same);
ok(put.length===3,'★変わっていなければ送らない');

console.log('\n=== 人が空にしたときは「消す」として送れる ===');
/* 空の欄を送らないだけだと、種類の表の最後の1つを外しても
   D1 に残ってしまう。人が触って空にしたときは null（＝消す）で送る。 */
await p.evaluate(()=>{ switchTab('G'); mwDgSeen=[{ptype:'TOY_VEHICLE',n:1,def_safe:0}];
  $('mwDgTypes').value='{"TOY_VEHICLE":1}'; advSyncNow(); });
await p.waitForTimeout(400);
await p.evaluate(()=>{ mwDgTypeSet({}); advSyncNow(); });
await p.waitForTimeout(400);
put=await p.evaluate(()=>window.__put);
srv=await p.evaluate(()=>window.__srv.settings);
const lastPut=put[put.length-1];
console.log('   '+JSON.stringify(lastPut.settings)+' / srv='
  +JSON.stringify(srv.mwDgTypes));
ok(lastPut.settings.mwDgTypes===null,'★人が空にした表は null（消す）で送る');
ok(srv.mwDgTypes===undefined,'★pj-sync からも消える（既定の2種類だけになる）');

console.log('\n=== 作業者の端末は書き込まない ===');
await setup('staff',SRV);
await p.evaluate(()=>{ $('mwRankCaps').value='{}';
  $('mwAutoMode').value='off'; advSyncNow(); });
await p.waitForTimeout(300);
v=await p.evaluate(()=>({ put:window.__put.length,
  note:$('advSyncNote').textContent, srv:window.__srv.settings }));
console.log('   '+JSON.stringify(v.note));
ok(v.put===0,'★作業者の端末からは /settings に送らない');
ok(v.srv.mwRankCaps==='{"ホビー":900000,"ゲーム":80000}'
   &&v.srv.mwAutoMode==='100','★D1 の上限・自動はそのまま');
ok(/作業者/.test(v.note),'★画面にも「この端末だけに保存」と出る');

console.log('\n=== 種類の表：空でも既定の2種類が印付きで出る（6.149）===');
await setup('admin',{ at:'2026-11-06T01:00:00.000Z', settings:{} });
await p.evaluate(()=>{ switchTab('G'); $('mwDgTypes').value=''; mwDgSeen=[];
  mwDgTypeRender(); });
let dg=await p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('#mwDgTypeBox input[data-dgpt]'),
  (el)=>({ pt:el.getAttribute('data-dgpt'), on:el.checked })));
console.log('   '+JSON.stringify(dg));
ok(dg.length>=2,'★表が空でも行が出る');
ok(dg.some((x)=>x.pt==='FIGURINE'&&x.on),'★FIGURINE が印付きで出る');
ok(dg.some((x)=>x.pt==='ABIS_VIDEO_GAMES'&&x.on),
   '★ABIS_VIDEO_GAMES も印付きで出る');
ok(await p.evaluate(()=>mwDgTypeOn({ptype:'FIGURINE'})===true
  &&mwDgTypeOn({ptype:'ABIS_VIDEO_GAMES'})===true),
   '★判定でも既定の2種類は「自動でよい」');
ok(await p.evaluate(()=>{ $('mwDgTypes').value='{"FIGURINE":0}';
  return mwDgTypeOn({ptype:'FIGURINE'})===false; }),
   '★⚙で外したときは外れる（既定より手で外したほうが強い）');

console.log('\n=== 自動の取り直し：件数を選ぶ（既定 オン・100件/時）===');
v=await p.evaluate(()=>{
  const el=$('mwAutoMode');
  return { def:el.querySelector('option[selected]')
    ?el.querySelector('option[selected]').value:'',
    opts:Array.prototype.map.call(el.options,(o)=>o.value) };
});
console.log('   '+JSON.stringify(v));
ok(v.opts.join(',')==='off,20,50,100,200','★選択肢は オフ／20／50／100／200件');
ok(v.def==='100','★既定は オン・100件/時');
v=await p.evaluate(()=>{ $('mwAutoMode').value='20';
  $('mwAutoMode').dispatchEvent(new Event('change',{bubbles:true}));
  return { per:$('mwAutoPerHour').value, on:mwAutoOn(), hour:mwAutoHour(),
           amz:amzAutoPerHour() }; });
await p.waitForTimeout(1500);
console.log('   '+JSON.stringify(v));
ok(v.per==='20'&&v.hour===20&&v.amz===20,'★選んだ件数が Worker に送る欄に入る');
ok(v.on===true,'★オフ以外はオン');
put=await p.evaluate(()=>window.__put);
console.log('   送った項目：'+JSON.stringify(put.map((x)=>Object.keys(x.settings))));
ok(put.some((x)=>x.settings.mwAutoMode==='20'&&x.settings.mwAutoPerHour==='20'),
   '★自動の取り直しも pj-sync に送る（Worker が読む設定）');
v=await p.evaluate(()=>{ $('mwAutoMode').value='off';
  $('mwAutoMode').dispatchEvent(new Event('change',{bubbles:true}));
  return { on:mwAutoOn(), hour:mwAutoHour(), per:$('mwAutoPerHour').value }; });
console.log('   '+JSON.stringify(v));
ok(v.on===false,'★オフを選べる');
ok(v.hour===20&&v.per==='20','★オフにしても、選んでおいた件数は覚えている');

console.log('\n=== 書き込みの履歴と「戻す」（6.149）===');
await setup('admin',{ at:'2026-11-06T01:00:00.000Z', settings:{
  mwRankCaps:'{"ホビー":900000}' } });
await p.evaluate(()=>advPull());
await p.waitForTimeout(200);
await p.evaluate(()=>{ $('mwRankCaps').value='{}'; advSent=null; advSyncNow(); });
await p.waitForTimeout(300);
await p.evaluate(()=>{ $('mwRankCaps').value='{"ホビー":1}'; advSyncNow(); });
await p.waitForTimeout(300);
await p.evaluate(()=>{ $('advLogBtn').click(); });
await p.waitForTimeout(400);
v=await p.evaluate(()=>({ n:document.querySelectorAll('#advLogBox [data-advundo]').length,
  text:($('advLogBox').innerText||'').replace(/\s+/g,' ').slice(0,200),
  note:$('advLogNote').textContent }));
console.log('   '+JSON.stringify(v));
ok(v.n>=1,'★履歴が行で出て、行ごとに「戻す」が付く');
ok(/mwRankCaps/.test(v.text),'★どの項目を変えたかが出る');
ok(/管理者の端末/.test(v.text),'★どの端末（管理者／作業者）かが出る');
ok(/\d{4}-\d\d-\d\d|\d\d:\d\d/.test(v.text),'★いつ変えたかが出る');
await p.evaluate(()=>{
  document.querySelector('#advLogBox [data-advundo]').click(); });
await p.waitForTimeout(400);
v=await p.evaluate(()=>({ caps:$('mwRankCaps').value,
  srv:window.__srv.settings.mwRankCaps, undo:window.__undo,
  note:$('advLogNote').textContent }));
console.log('   '+JSON.stringify(v));
ok(v.srv==='{"ホビー":900000}','★直前の値に戻る（pj-sync 側）');
ok(v.caps==='{"ホビー":900000}','★画面の欄にも戻った値が入る');
await T.done();
})();
