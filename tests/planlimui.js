/* 画面：会員プランの上限の⚙と、予定の画面の件数（8.82）

   カジの依頼（2026-11-20）「会員プランの上限を変更してください」
     モニター 5件・1点／ライト 5件・1点／スタンダード 20件・2点／プレミアム 50件・5点
   ここで見ること
     ① ⚙の欄（新しい名前・新しい既定）。前の欄は無い
     ② 欄の数が、案・予定・pj-sync に送る設定に同じ形で入る（1か所）
     ③ 予定の画面：プランの上限と、上限より多いカードの件数
     ④ 自動配信の「試し」にも同じ行が出る
     ⑤ 画面に仕入れ元や金額（月額）を出さない */
const { harness } = require('./lib');
const fs=require('fs');
const path=require('path');
const T = harness('画面：会員プランの上限（8.82）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',(d)=>d.accept());

console.log('=== ① ⚙の欄（新しい名前・新しい既定）===');
{
  const t=await p.evaluate(()=>{
    const v=(id)=>($(id)||{}).value;
    return {
      mon:[v('subMonNew'),v('subQMonitor')],
      li:[v('subLimNLight'),v('subLimQLight')],
      st:[v('subLimNStandard'),v('subLimQStandard')],
      pr:[v('subLimNPremium'),v('subLimQPremium')],
      old:['subNLight','subQLight','subNStandard','subQStandard','subNPremium',
           'subQPremium'].filter((id)=>!!$(id)),
      fix:!!$('subQFix')&&$('subQFix').checked===false,
      note:($('subLimNote')||{}).textContent||'',
      adv:['subLimNLight','subLimQLight','subLimNStandard','subLimQStandard',
           'subLimNPremium','subLimQPremium','subQMonitor','subMonNew']
        .every((id)=>ADV_SUB.indexOf(id)>=0&&CSV_CFG_IDS.indexOf(id)>=0),
      advOld:['subNLight','subQLight','subNStandard','subQStandard','subNPremium',
              'subQPremium'].filter((id)=>ADV_SUB.indexOf(id)>=0
                ||CSV_CFG_IDS.indexOf(id)>=0),
      chk:ADV_SUBCHK.indexOf('subQFix')>=0,
      table:SUBPLAN.PLANS.map((x)=>x.key+':'+x.n+'/'+x.q).join(' ') };
  });
  console.log('   '+JSON.stringify({ mon:t.mon, li:t.li, st:t.st, pr:t.pr }));
  ok(t.mon[0]==='5'&&t.mon[1]==='1','★★★モニター 5件・1点（今のまま）');
  ok(t.li[0]==='5'&&t.li[1]==='1','★★★ライト 5件・1点');
  ok(t.st[0]==='20'&&t.st[1]==='2','★★★スタンダード 20件・2点');
  ok(t.pr[0]==='50'&&t.pr[1]==='5','★★★プレミアム 50件・5点');
  ok(t.table==='monitor:5/1 light:5/1 standard:20/2 premium:50/5',
     '★★★欄の既定は共有の表（shared/subplan.js）と同じ');
  ok(t.old.length===0&&t.advOld.length===0,
     '★★★前の欄（subN*・subQ*）は無い（前の数を引き継がない）');
  ok(t.fix,'★★★「出ているカードも書き換える」は既定オフ');
  ok(t.adv&&t.chk,'★★pj-sync に送るまとまり・設定の書き出しに入っている');
  ok(/モニター 5件・1点／ライト 5件・1点／スタンダード 20件・2点／プレミアム 50件・5点/
     .test(t.note)&&/今の並びのまま上から/.test(t.note),
     '★★欄の上に、上限と選び方を書いてある');
}

console.log('\n=== ② 欄の数が、案・設定に同じ形で入る ===');
{
  const t=await p.evaluate(()=>{
    const pl=(k)=>SUBPLAN.list(subCfgAll()).filter((x)=>x.key===k)[0];
    const a={ li:[pl('light').n,pl('light').q], st:[pl('standard').n,pl('standard').q],
              pr:[pl('premium').n,pl('premium').q], mon:[pl('monitor').n,pl('monitor').q] };
    $('subLimNStandard').value='30'; $('subLimQStandard').value='3';
    $('subLimNLight').value='7';
    const c=subCfgAll();
    const b={ li:[pl('light').n,pl('light').q], st:[pl('standard').n,pl('standard').q] };
    const keys={ n:c.subLimNStandard, q:c.subLimQStandard, l:c.subLimNLight,
                 fix:c.subQFix, old:('subNStandard' in c)||('subQStandard' in c) };
    $('subQFix').checked=true;
    const fix2=subCfgAll().subQFix;
    $('subQFix').checked=false;
    /* 案（今日の配信の案）が同じ上限で切る。 */
    const rows=[]; for(let i=0;i<40;i++)rows.push({ jan:'49023705'+String(50000+i),
      name:'商品'+i, fit:true, rst:'ok', amz:0, buy_qty:0, price:2000, qty:2,
      gross:300+i*7, speed:1+i%4, stock:9, is_game:true, grades:'',
      no_back:false, one_off:false });
    $('subOnLight').checked=true;
    const d=SUBPLAN.draft(rows,SUBPLAN.list(subCfgAll()),subCfgAll());
    const n=d.plans.filter((x)=>x.key==='light')[0].items.length;
    $('subOnLight').checked=false;
    $('subLimNStandard').value='20'; $('subLimQStandard').value='2';
    $('subLimNLight').value='5';
    return { a, b, keys, fix2, n };
  });
  console.log('   既定 '+JSON.stringify(t.a)+'　変えたあと '+JSON.stringify(t.b));
  ok(JSON.stringify(t.a)==='{"li":[5,1],"st":[20,2],"pr":[50,5],"mon":[5,1]}',
     '★★★欄のままの上限が、案の決まりに入る');
  ok(t.b.st[0]===30&&t.b.st[1]===3&&t.b.li[0]===7,
     '★★★⚙の欄を変えると、上限が変わる');
  ok(t.keys.n==='30'&&t.keys.q==='3'&&t.keys.l==='7'&&t.keys.old===false,
     '★★新しい名前で渡す（前の名前では渡さない）');
  ok(t.keys.fix===false&&t.fix2===true,'★「出ているカードも書き換える」も渡す');
  ok(t.n===7,'★★★今日の配信の案も、⚙の上限（7件）で切る');
}

console.log('\n=== ③ 予定の画面：上限と、上限より多いカードの件数 ===');
{
  const plans=[
    { key:'monitor', name:'モニター', on:true, ch:'1', n:5, q:1, items:[] },
    { key:'light', name:'ライト', on:true, ch:'2', n:5, q:1, items:[] },
    { key:'standard', name:'スタンダード', on:true, ch:'3', n:20, q:2, items:[] },
    { key:'premium', name:'プレミアム', on:false, ch:'', n:50, q:5, items:[],
      why:'止めています' }];
  const show=async(q_over)=>await p.evaluate((a)=>{
    const d={ ok:true, plans:a.plans, q_over:a.q_over };
    const h=subLimHtml(d);
    const box=document.createElement('div'); box.innerHTML=h;
    const g=(id)=>{ const e=box.querySelector('#'+id); return e?e.textContent:''; };
    return { lim:g('subLimLine'), over:g('subQOverLine'), col:g('subQColLine'),
             red:/color:var\(--bad\)/.test((box.querySelector('#subQOverLine')||{})
               .outerHTML||''), html:h };
  },{ plans, q_over });
  const t0=await show({ total:0, fix:false, col:true, plans:[] });
  console.log('   '+t0.lim);
  console.log('   '+t0.over);
  ok(/モニター 5件・1点／ライト 5件・1点／スタンダード 20件・2点／プレミアム 50件・5点（止めています）/
     .test(t0.lim),'★★★プランの上限を1行で出す（止めているプランも分かる）');
  ok(/0件/.test(t0.over)&&!t0.red,'★★★上限より多いカードが無ければ「0件」');
  const t1=await show({ total:12, fix:false, col:true, plans:[
    { key:'monitor', name:'モニター', now:1, n:0, cards:9, by:{} },
    { key:'light', name:'ライト', now:1, n:8, cards:8, by:{ 2:8 } },
    { key:'standard', name:'スタンダード', now:2, n:4, cards:6, by:{ 5:3, 3:1 } }] });
  console.log('   '+t1.over);
  ok(/12件/.test(t1.over)&&t1.red,'★★★上限より多いカードの件数を赤で出す（12件）');
  ok(/ライト 8件（いまの上限 1点／カードは 2点まで 8件）/.test(t1.over),
     '★★★プランごとの件数と、カードに書いてある数');
  ok(/スタンダード 4件（いまの上限 2点／カードは 5点まで 3件・3点まで 1件）/
     .test(t1.over),'★★数が混ざっていても分けて出す');
  ok(!/モニター 0件/.test(t1.over),'★0件のプランは並べない');
  ok(/前の数のまま/.test(t1.over)&&/オンにして配信/.test(t1.over),
     '★★★いまは書き換えていないことと、直し方を出す');
  const t2=await show({ total:12, fix:true, col:true, plans:[
    { key:'light', name:'ライト', now:1, n:12, cards:12, by:{ 2:12 } }] });
  ok(/オンです。次の配信で新しい上限に書き換えます/.test(t2.over),
     '★★⚙がオンなら、次の配信で書き換えると出す');
  const t3=await show({ total:3, fix:false, col:false, plans:[
    { key:'light', name:'ライト', now:1, n:3, cards:3, by:{ 2:3 } }] });
  ok(/migrate-0069/.test(t3.col)&&/前の数のまま/.test(t3.col),
     '★★★D1 に migrate-0069 がまだなら、そのことを出す');
  ok(t0.col===''&&t1.col==='','★列があるときは出さない');
  const t4=await show(null);
  ok(t4.lim!==''&&t4.over==='','★件数が返らないときは上限の行だけ（落ちない）');
  /* 実際の予定の画面にも出る。 */
  const t5=await p.evaluate((a)=>{
    subPlanData={ ok:true, plans:a, q_over:{ total:2, fix:false, col:true,
      plans:[{ key:'light', name:'ライト', now:1, n:2, cards:2, by:{ 2:2 } }] } };
    subPlanRender();
    const e=$('subQOverLine');
    return { has:!!$('subLimLine'), over:e?e.textContent:'',
             n:document.querySelectorAll('#subQOverLine').length };
  },plans);
  ok(t5.has&&/2件/.test(t5.over)&&t5.n===1,'★★★予定の画面（一覧の予定）に出る');
}

console.log('\n=== ④ 自動配信の「試し」にも同じ行が出る ===');
{
  const t=await p.evaluate(()=>{
    subAxData={ ok:true, dry:true, ran:true, on:true, slot:'2026-11-20@12',
      hours:[12,20], cand_n:30, ok_n:20, sent:14, edited:0, sold_out:0,
      max:20, cut:0, plans:[], shop:{ ready:true }, stops_all:[],
      limits:[{ key:'monitor', name:'モニター', n:5, q:1 },
              { key:'light', name:'ライト', n:5, q:1 },
              { key:'standard', name:'スタンダード', n:20, q:2 }],
      q_over:{ total:3, fix:false, col:true,
        plans:[{ key:'standard', name:'スタンダード', now:2, n:3, cards:3,
                 by:{ 5:3 } }] } };
    subAxRender();
    const g=(id)=>{ const e=$(id); return e?e.textContent:''; };
    return { lim:g('subAxLimLine'), over:g('subAxQOverLine'),
             dup:document.querySelectorAll('#subLimLine').length };
  });
  console.log('   '+t.lim);
  ok(/モニター 5件・1点／ライト 5件・1点／スタンダード 20件・2点/.test(t.lim)
     &&!/止めています/.test(t.lim),'★★★試しの結果に、この回が使う上限を出す');
  ok(/3件/.test(t.over)&&/スタンダード 3件/.test(t.over),
     '★★上限より多いカードの件数も出す');
  ok(t.dup<=1,'★予定の行と id が重ならない');
}

console.log('\n=== ⑤ 仕入れ元・月額を出さない ===');
{
  const h=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const a=h.indexOf('function subLimHtml'), b=h.indexOf('function subPlanRender');
  const src=h.slice(a,b);
  ok(a>0&&b>a&&!/wholesale|卸値|sha\b|mw_stock/.test(src),
     '★★★上限の行は仕入れ元の情報を読まない');
  const cfgBlock=h.slice(h.indexOf('id="subLimNote"'),h.indexOf('id="subShipPremium"'));
  ok(!/1,?980|4,?980|9,?800/.test(cfgBlock),'★★★月額の金額を画面に持たない');
  const v=await p.evaluate(()=>APP_V);
  const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  ok(sw.indexOf("'pj-pricing-"+v+"'")>=0,'★sw.js と APP_V がそろっている（'+v+'）');
}
await T.done();
})();
