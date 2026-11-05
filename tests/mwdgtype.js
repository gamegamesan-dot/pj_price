/* 画面：自動で「電池なし・危険物に該当しない」にする種類の表（6.128）
   v214 では、種類の名前（FIGURINE・ABIS_VIDEO_GAMES）が pj の表に無かったため
   全部「選んでください」になった。Amazon の種類の名前は公開されていないので、
   **出てきた名前を読んで表にし、チェックで足し引きできる**ようにする。
   ・⚙「Amazon刈取」に表を置く。「種類を読み込む」で GET /mw/ptypes
   ・既定（Worker と同じ判定）に印が付いた状態で出る。件数と「既定」も添える
   ・印を変えると pj-sync（/settings）に保存する（端末ごとではない）
   ・作業者用の端末では見るだけ（変更は管理者だけ）
   ・名前で足せる（Amazon の種類の一覧から選ぶ） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：自動で申告を付ける種類の表');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

/* Worker が返す形（GET /mw/ptypes）。実際に返ってきた名前を使う。 */
const PT={ ok:true, over:{},
  seen:[
    { ptype:'FIGURINE', n:412, safe:1, def_safe:1, need_batt:true, need_dg:true,
      err:'', at:'2026-11-05T01:00:00Z' },
    { ptype:'ABIS_VIDEO_GAMES', n:118, safe:1, def_safe:1, need_batt:false,
      need_dg:false, err:'', at:'2026-11-05T01:00:00Z' },
    { ptype:'HOME_FURNITURE_AND_DECOR', n:7, safe:0, def_safe:0,
      need_batt:true, need_dg:true, err:'', at:'2026-11-05T01:00:00Z' }],
  all:['ABIS_DRUGSTORE','ABIS_VIDEO_GAMES','FIGURINE',
       'HOME_FURNITURE_AND_DECOR','TOY_FIGURE'],
  all_at:'2026-11-05T01:00:00Z', all_err:'' };

const setup=async(role)=>await p.evaluate(([PT,role])=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__put=[]; window.__srv={ at:'', settings:{} }; window.__pt=0;
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:role,staff_key_set:true}),
        {status:200});
    if(/\/mw\/ptypes/.test(url)){
      window.__pt++;
      return new Response(JSON.stringify(PT),{status:200});
    }
    if(/\/settings/.test(url)){
      if(i&&i.method==='POST'){
        if(role!=='admin')
          return new Response(JSON.stringify({error:'forbidden_staff'}),{status:403});
        window.__put.push(b); window.__srv={ at:b.at, settings:b.settings };
        return new Response(JSON.stringify({ok:true,stored:true,at:b.at,
          settings:b.settings}),{status:200});
      }
      return new Response(JSON.stringify(Object.assign({ok:true},window.__srv)),
        {status:200});
    }
    if(/\/mw\/buy/.test(url))
      return new Response(JSON.stringify({ok:true,rows:[],n:0}),{status:200});
    if(/\/mw\/amz/.test(url))
      return new Response(JSON.stringify({ok:true,n:0,rows:[]}),{status:200});
    return real(u,i);
  };
  syncRole=role; roleApply();
},[PT,role]);
const loadTypes=async()=>{
  await p.evaluate(()=>{ switchTab('G'); $('mwDgTypeBtn').click(); });
  await p.waitForTimeout(400);
};
const table=()=>p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('#mwDgTypeBox input[data-dgpt]'),
  (el)=>({ pt:el.getAttribute('data-dgpt'), on:el.checked, off:el.disabled,
    label:(el.closest('.row').querySelector('label').textContent||'')
      .replace(/\s+/g,' ').trim() })));

console.log('=== 読み込む前 ===');
await setup('admin');
await openCsvBoxes(p);
let v=await p.evaluate(()=>{ switchTab('G');
  return ($('mwDgTypeBox').innerText||'').replace(/\s+/g,' '); });
console.log('   '+v);
ok(/種類を読み込む/.test(v),'★★まだ読んでいないときは、押すものを案内する');
ok(await p.evaluate(()=>!!$('mwDgTypeBtn')),'★ボタンがある');

console.log('\n=== 種類を読み込む ===');
await loadTypes();
let t=await table();
console.log('   '+JSON.stringify(t));
ok(await p.evaluate(()=>window.__pt)===1,
   '★★★押すと GET /mw/ptypes を1回だけ呼ぶ');
ok(t.length===3,'★★★出てきた種類が並ぶ');
ok(t[0].pt==='FIGURINE'&&t[1].pt==='ABIS_VIDEO_GAMES',
   '★★★件数の多い順（Worker の並びのまま）');
ok(/412件/.test(t[0].label),'★★件数も添える');
ok(/既定/.test(t[0].label),'★★既定で自動になる種類だと分かる');
ok(/必須：電池・危険物/.test(t[0].label),
   '★★その種類で電池・危険物が必須だったかも添える');
ok(t[0].on===true&&t[1].on===true,
   '★★★FIGURINE・ABIS_VIDEO_GAMES は印が付いている（v214 の取りこぼし）');
ok(t[2].on===false,'★★家具は印が付かない（人が選ぶ）');
ok(t.every((x)=>x.off===false),'★管理者は変えられる');

console.log('\n=== 印を変えると pj-sync に保存する ===');
await p.evaluate(()=>{
  const el=document.querySelector('#mwDgTypeBox input[data-dgpt="HOME_FURNITURE_AND_DECOR"]');
  el.checked=true; el.dispatchEvent(new Event('change',{bubbles:true}));
});
await p.waitForTimeout(1600);
let put=await p.evaluate(()=>window.__put.map((x)=>x.settings.mwDgTypes));
console.log('   送った設定: '+JSON.stringify(put));
ok(put.length>=1,'★★★pj-sync（POST /settings）に送る');
let last=put[put.length-1];
if(typeof last==='string')last=JSON.parse(last);
ok(last&&last.HOME_FURNITURE_AND_DECOR===1,
   '★★★足した種類を {種類:1} の形で保存する');
v=await p.evaluate(()=>($('mwDgTypeNote').innerText||'').replace(/\s+/g,' '));
console.log('   '+v);
ok(/足した種類：HOME_FURNITURE_AND_DECOR/.test(v),'★★足した種類を下に出す');
ok(/pj-sync に保存/.test(v),'★★端末ごとではないと書く');
/* 既定と同じ向きに戻したら、足し引きは消す（既定に任せる）。 */
await p.evaluate(()=>{
  const el=document.querySelector('#mwDgTypeBox input[data-dgpt="HOME_FURNITURE_AND_DECOR"]');
  el.checked=false; el.dispatchEvent(new Event('change',{bubbles:true}));
});
await p.waitForTimeout(1600);
put=await p.evaluate(()=>window.__put.map((x)=>x.settings.mwDgTypes));
last=put[put.length-1];
if(typeof last==='string')last=JSON.parse(last);
console.log('   '+JSON.stringify(last));
ok(!last||!('HOME_FURNITURE_AND_DECOR' in last),
   '★★既定と同じ向きに戻したら、足し引きは持たない');
/* 既定の種類を外すこともできる（印を外す＝人が選ぶ）。 */
await p.evaluate(()=>{
  const el=document.querySelector('#mwDgTypeBox input[data-dgpt="FIGURINE"]');
  el.checked=false; el.dispatchEvent(new Event('change',{bubbles:true}));
});
await p.waitForTimeout(1600);
put=await p.evaluate(()=>window.__put.map((x)=>x.settings.mwDgTypes));
last=put[put.length-1];
if(typeof last==='string')last=JSON.parse(last);
ok(last&&last.FIGURINE===0,'★★★既定の種類を外すと {種類:0} で保存する');
v=await p.evaluate(()=>($('mwDgTypeNote').innerText||'').replace(/\s+/g,' '));
ok(/外した種類：FIGURINE/.test(v),'★★外した種類も下に出す');

console.log('\n=== 名前で足す ===');
ok(await p.evaluate(()=>!!$('mwDgTypeAdd')),'★★名前で足す欄がある');
ok(await p.evaluate(()=>
   document.querySelectorAll('#mwDgTypeAllList option').length===5),
   '★★★Amazon の種類の一覧から選べる（searchDefinitionsProductTypes）');
await p.evaluate(()=>{
  const el=$('mwDgTypeAdd');
  el.value='abis_drugstore'; el.dispatchEvent(new Event('change',{bubbles:true}));
});
await p.waitForTimeout(1600);
put=await p.evaluate(()=>window.__put.map((x)=>x.settings.mwDgTypes));
last=put[put.length-1];
if(typeof last==='string')last=JSON.parse(last);
console.log('   '+JSON.stringify(last));
ok(last&&last.ABIS_DRUGSTORE===1,'★★★小文字で書いても大文字でそろえて足す');
t=await table();
ok(t.some((x)=>x.pt==='ABIS_DRUGSTORE'&&x.on===true),
   '★★足した種類は表にも出る（まだ出てきていない種類でも）');
ok(await p.evaluate(()=>$('mwDgTypeAdd').value===''),'★足したら欄は空に戻る');

console.log('\n=== 作業者用の端末では見るだけ ===');
await p.evaluate(()=>{ try{ localStorage.clear(); }catch(e){} });
await p.reload(); await p.waitForTimeout(300);
await setup('staff');
await openCsvBoxes(p);
await loadTypes();
t=await table();
console.log('   '+JSON.stringify(t.map((x)=>x.pt+(x.off?'（押せない）':''))));
ok(t.length===3,'★★★作業者用の端末でも表は見られる');
ok(t.every((x)=>x.off===true),'★★★作業者は変えられない（見るだけ）');
ok(await p.evaluate(()=>!$('mwDgTypeAdd')),'★名前で足す欄も出さない');
v=await p.evaluate(()=>($('mwDgTypeNote').innerText||'').replace(/\s+/g,' '));
ok(/変更は管理者だけ/.test(v),'★★「管理者だけ」と書く');
await T.done();
})();
