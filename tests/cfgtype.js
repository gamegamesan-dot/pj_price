/* 画面：⚙設定の数字の欄に、1文字ずつ打てること（6.130）
   iPhone の Safari で「ランキングの上限（大分類ごと）」に 30000 を入れようとすると、
   1文字入れるたびに欄から外れて入れられなかった。
   原因は**入力のたびに保存して表を作り直していた**こと（innerHTML を入れ替えると
   欄が別のものに替わるので、打っている途中で外れる）。
   ・保存と作り直しは**入力が終わったとき（change・Enter）**だけ
   ・入力中は表を作り直さない
   ・数字の欄は inputmode="numeric"（iPhone で数字のキーボードが出る）
   ・⚙のほかの数字の欄も同じ作りになっていないか確かめる */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：⚙の数字の欄に1文字ずつ打てる');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const base={ sha:'M200', cond:'新品', stock:9, note:'', ship_text:'即日出荷',
  ship_days:0, basis:'カート', new_n:4, low_n:1, amz:0, fba_n:3, amz_err:'',
  amz_at:'2026-11-04T01:00:00Z', rst:'ok', list_price:9800, wholesale:3000,
  price:9000 };
const ROWS=[
 Object.assign({},base,{ jan:'4580033110113', kishu:'figure',
   mw_name:'ホビーA', asin:'B00HOBBY01', amz_name:'ホビーA',
   rank:948040, rank_cat:'ホビー' }),
 Object.assign({},base,{ jan:'4902370550467', kishu:'NS',
   mw_name:'ゲームA', asin:'B00GAME001', amz_name:'ゲームA',
   rank:1200, rank_cat:'ゲーム' })];
const META={ ok:true, n:2, rows:ROWS, seen:2, priced:2, left:0, per_run:120,
  ttl_days:3, limit:3000 };

await p.evaluate((META)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('mwKishu').value='NS,figure';
  window.__put=[]; window.__srv={ at:'', settings:{} };
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i&&i.body&&typeof i.body==='string')?JSON.parse(i.body):null;
    if(/\/whoami/.test(url))
      return new Response(JSON.stringify({ok:true,role:'admin',staff_key_set:true}),
        {status:200});
    if(/\/settings/.test(url)){
      if(i&&i.method==='POST'){
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
      return new Response(JSON.stringify(META),{status:200});
    return real(u,i);
  };
  syncRole='admin'; roleApply();
},META);
await openCsvBoxes(p);
/* 一覧を出して、⚙の表に大分類の行を作る。 */
await p.evaluate(()=>{ switchTab('F'); $('csvMwAmzLoad').click(); });
await p.waitForTimeout(500);
await p.evaluate(()=>switchTab('G'));
await p.waitForTimeout(150);

/* 1文字ずつ打つ（人が打つのと同じ）。打つたびに
   「まだ同じ欄にいるか」「そこまでの文字が残っているか」を見る。 */
const typeOne=async(sel,text)=>{
  await p.click(sel);
  const steps=[];
  for(const c of String(text)){
    await p.keyboard.type(c,{delay:30});
    steps.push(await p.evaluate((sel)=>{
      const el=document.querySelector(sel);
      return { v:String(el.value||''), on:document.activeElement===el };
    },sel));
  }
  return steps;
};

console.log('=== ランキングの上限に 30000 を入れる ===');
const sel='#mwRankCapBox input[data-rankcap="ホビー"]';
ok(await p.evaluate((s)=>!!document.querySelector(s),sel),
   '★大分類の行が出ている');
await p.evaluate((s)=>{ document.querySelector(s).value=''; },sel);
let st=await typeOne(sel,'30000');
console.log('   '+JSON.stringify(st));
ok(st.every((x)=>x.on===true),
   '★★★1文字ごとに欄から外れない（打っているあいだ同じ欄にいる）');
ok(st[st.length-1].v==='30000','★★★5桁の数字がそのまま入る');
/* 打っているあいだは保存していない（表を作り直していない）。 */
let put=await p.evaluate(()=>window.__put.length);
ok(put===0,'★★★入力中は保存しない（1文字ごとに送らない）');
ok(await p.evaluate(()=>mwRankCaps()['ホビー']===undefined),
   '★★入力中は値も控えない');

console.log('\n=== 入力が終わったら保存する ===');
await p.evaluate((s)=>{
  const el=document.querySelector(s);
  el.dispatchEvent(new Event('change',{bubbles:true}));
},sel);
await p.waitForTimeout(1600);
let o=await p.evaluate(()=>mwRankCaps());
console.log('   '+JSON.stringify(o));
ok(+o['ホビー']===30000,'★★★欄から外れたときに保存する（change）');
put=await p.evaluate(()=>window.__put.map((x)=>x.settings.mwRankCaps));
console.log('   送った設定: '+JSON.stringify(put));
let last=put[put.length-1];
if(typeof last==='string')last=JSON.parse(last);
ok(!!last&&+last['ホビー']===30000,'★★★pj-sync にも1回で送る');
let note=await p.evaluate(()=>($('mwRankCapNote').innerText||'').replace(/\s+/g,' '));
ok(/ホビー 30,000位まで/.test(note),'★★知らせも入れ替わる');

console.log('\n=== Enter でも確定できる ===');
await p.evaluate((s)=>{ document.querySelector(s).value=''; },sel);
await typeOne(sel,'45000');
await p.keyboard.press('Enter');
await p.waitForTimeout(1600);
o=await p.evaluate(()=>mwRankCaps());
console.log('   '+JSON.stringify(o));
ok(+o['ホビー']===45000,'★★★Enter でも保存される（キーボードが閉じる）');
ok(await p.evaluate((s)=>document.activeElement!==document.querySelector(s),sel),
   '★★Enter で欄から外れる（iPhone の数字キーボードが閉じる）');

console.log('\n=== 打っているあいだは表を作り直さない ===');
await p.click(sel);
const before=await p.evaluate((s)=>{
  const el=document.querySelector(s); el.__mark=1; return el.__mark===1;
},sel);
/* 一覧の作り直し（mwAmzRender）が走っても、打っている欄は替えない。 */
await p.evaluate(()=>{ try{ mwAmzRender(); }catch(e){} });
const after=await p.evaluate((s)=>{
  const el=document.querySelector(s);
  return { same:el.__mark===1, on:document.activeElement===el };
},sel);
console.log('   '+JSON.stringify({before:before,after:after}));
ok(after.same===true&&after.on===true,
   '★★★入力中に一覧を作り直しても、欄はそのまま（外れない）');
await p.evaluate((s)=>document.querySelector(s).blur(),sel);
await p.waitForTimeout(100);
ok(await p.evaluate(()=>{
     mwAmzRender();
     return !!document.querySelector('#mwRankCapBox input[data-rankcap]');
   }),'★★打ち終われば作り直す（新しい大分類も出る）');

console.log('\n=== ⚙のほかの数字の欄も同じか ===');
/* ⚙の代表的な数字の欄。1文字ずつ打って、外れず全部入ることを見る。 */
const FIELDS=[['linkRate','連動率','25'],['baseProfit','下限利益','12000'],
  ['mwStockMin','MW在庫の下限','10'],['autoAdRate','広告料率','8'],
  ['mwAmzFbaHobby','FBA手数料（ホビー）','580'],['syncLimit','取り込み上限','2000'],
  ['csvMarkStep','値下げの最低額','3'],['mwShipFee','MWの送料','176'],
  ['amzFeeRate','Amazon手数料','15'],['fx','為替','158']];
for(const f of FIELDS){
  const s2='#'+f[0];
  await p.evaluate((s)=>{ const el=document.querySelector(s); el.value=''; },s2);
  const r2=await typeOne(s2,f[2]);
  const okAll=r2.every((x)=>x.on===true)&&r2[r2.length-1].v===f[2];
  ok(okAll,'★'+f[1]+'（'+f[0]+'）に '+f[2]+' が1文字ずつ入る');
}

console.log('\n=== 数字のキーボードが出る（inputmode）===');
const nums=await p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('input[type=number]'),
  (el)=>({ id:el.id||el.getAttribute('data-rankcap')||'(名前なし)',
    im:el.getAttribute('inputmode')||'' })));
const bad=nums.filter((x)=>!/^(numeric|decimal)$/.test(x.im));
console.log('   数字の欄 '+nums.length+'件 / inputmode なし '+bad.length+'件 '
  +JSON.stringify(bad.slice(0,5)));
ok(nums.length>=60,'★数字の欄をまとめて見ている');
ok(bad.length===0,
   '★★★すべての数字の欄に inputmode（numeric か decimal）が付いている');
const cap=nums.filter((x)=>x.id==='ホビー')[0];
ok(!!cap&&cap.im==='numeric',
   '★★★ランキングの上限の欄は inputmode="numeric"');
await T.done();
})();
