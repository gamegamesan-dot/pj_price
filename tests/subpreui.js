/* 画面：自動の回の様子・受付終了・今週のねらい目（8.31・カジの依頼5）
   ① ⚙（受付終了から消すまで・今週のねらい目の入／切・曜日・件数）
   ② 「予定」と「全プランに配る」の確認の画面に、
      自動の回で何が起きるか（新しく◯件・書き換え◯件・予告を出すか）を出す
   ③ 「今週のねらい目を今すぐ出す（お試し）」 */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：自動の回の様子と今週のねらい目（8.31）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[];
p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });

const PLAN=(auto)=>({ ok:true, table_ok:true, token:true, day:'2026-11-15',
  skip:false, on:true, hour:8, pre:true, domain:'x.myshopify.com', rows:2,
  auto:auto,
  plans:[{ key:'monitor', name:'モニター', on:true, ch:'111',
    ch_name:'リスト-モニター', n:10, q:1, kinds:'game', add:1, edit:1, keep:2,
    why:'', items:[
      { jan:'4902370550001', name:'商品A', price:3645, qty:1, left:1,
        gross:1255, sent:false, same:false, ship:'クリックポスト',
        ship_text:'クリックポスト', ship_sure:true, ship_warn:'', warns:[],
        badge:'◎', badge_name:'ねらい目', badge_why:'よく売れています',
        badge_ok:true }] }] });

await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__q=[];
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body;
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/sub\/plan/.test(url))return res(window.__plan);
    if(/\/sub\/hot/.test(url)){
      window.__q.push({ u:'hot', b:JSON.parse(String(b||'{}')) });
      return res(window.__hot||{ ok:true, sent:1,
        plans:[{ key:'monitor', name:'モニター', n:2 }] });
    }
    if(/\/sub\/send/.test(url))return res({ ok:true, sent:1, edited:0,
      skipped:0, fail:0, left:0 });
    if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, n:0, rows:[] });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
});
await openCsvBoxes(p);

console.log('=== ① ⚙ ===');
{
  const t=await p.evaluate(()=>{
    const r={ off:!!$('subOffDays'), on:!!$('subHotOn'),
              dow:!!$('subHotDow'), n:!!$('subHotN'),
              offv:$('subOffDays').value, nv:$('subHotN').value,
              dowv:$('subHotDow').value, checked:$('subHotOn').checked };
    $('subHotOn').checked=true; subOnTxt();
    r.txtOn=($('subHotTxt').textContent||'');
    $('subHotOn').checked=false; subOnTxt();
    r.txtOff=($('subHotTxt').textContent||'');
    return r;
  });
  ok(t.off&&t.on&&t.dow&&t.n,'★★★⚙の欄がある');
  ok(t.offv==='0','★★★受付終了から消すまでの既定は 0（消さない）');
  ok(t.checked===false,'★★★今週のねらい目の既定はオフ');
  ok(t.nv==='3'&&t.dowv==='0','★既定は日曜・3件');
  ok(t.txtOn==='出します'&&t.txtOff==='いまは止めています',
     '★★入れると「出します」に変わる');
}

console.log('=== ② 自動の回で何が起きるか ===');
{
  const t=await p.evaluate(async(a)=>{
    window.__plan=a;
    await subPlanGo(true);
    subTabSet('all'); subPlanRender();
    return ($('subPlanList').textContent||'').replace(/\s+/g,' ');
  },PLAN({ on:true, hour:8, pre_on:true, add:1, edit:1, pre:true, pre_n:1,
           pre_plans:['モニター'], hot_on:true, hot_dow:0, hot_n:3,
           off_days:0 }));
  console.log('   '+t.slice(0,220));
  ok(/自動の回（平日 08:00）/.test(t),'★★★自動の回の時刻を出す');
  ok(/新しく 1件・書き換え 1件/.test(t),
     '★★★新しく出る数と書き換える数を出す');
  ok(/予告：出します（1件・モニター）/.test(t),
     '★★★予告を出すかと件数・プランを出す');
  ok(/今週のねらい目：出します（日曜・最大 3件）/.test(t),
     '★★今週のねらい目の⚙も出す');
  ok(/受付終了のカードは残します/.test(t),
     '★★★受付終了のカードをどうするかも出す');
  /* 予告を出さない日・自動を止めている日の出し方。 */
  const t2=await p.evaluate(async(a)=>{
    window.__plan=a;
    await subPlanGo(true); subPlanRender();
    return ($('subPlanList').textContent||'').replace(/\s+/g,' ');
  },PLAN({ on:false, hour:8, pre_on:true, add:0, edit:2, pre:false, pre_n:0,
           pre_plans:[], hot_on:false, hot_dow:0, hot_n:3, off_days:7 }));
  console.log('   '+t2.slice(0,200));
  ok(/⚙で自動配信を止めています/.test(t2),'★★★止めているときはそう出す');
  ok(/予告：出しません（翌朝に新しく出るカードがありません）/.test(t2),
     '★★★予告を出さない理由まで出す');
  ok(/今週のねらい目：止めています/.test(t2),'★★オフならそう出す');
  ok(/受付終了のカードは 7日で消します/.test(t2),
     '★★★消す日数を入れているときはそう出す');
  /* 「全プランに配る」の確認の画面にも出る。 */
  const t3=await p.evaluate(async(a)=>{
    window.__plan=a;
    await subAllOpen();
    return ($('subAllBox').textContent||'').replace(/\s+/g,' ');
  },PLAN({ on:true, hour:8, pre_on:true, add:1, edit:1, pre:true, pre_n:1,
           pre_plans:['モニター'], hot_on:false, hot_dow:0, hot_n:3,
           off_days:0 }));
  await p.waitForTimeout(200);
  ok(/自動の回（平日 08:00）/.test(t3)&&/新しく 1件/.test(t3),
     '★★★確認の画面にも出す（手で送る前に見える）');
}

console.log('=== ③ 今週のねらい目を今すぐ出す ===');
{
  dlg=[];
  const t=await p.evaluate(async()=>{
    window.__q=[];
    await subHotGo();
    return ($('subHotNote').textContent||'').replace(/\s+/g,' ');
  });
  await p.waitForTimeout(200);
  const q=await p.evaluate(()=>window.__q.filter((x)=>x.u==='hot')[0]||{});
  console.log('   '+t);
  ok(q.b&&q.b.force===true,'★★★force を付けて出す（⚙がオフでも試せる）');
  ok(dlg.some((m)=>/いま/.test(m)&&/新しいカードは作りません/.test(m)),
     '★★★確認の文に「新しいカードは作らない」と出す');
  ok(dlg.some((m)=>/@everyone は使いません/.test(m)),
     '★★★@everyone を使わないと確認の文にも書く');
  ok(/1通 出しました/.test(t)&&/モニター 2件/.test(t),
     '★★★結果（何通・何件）を出す');
  /* 出せなかったときは理由を出す。 */
  const t2=await p.evaluate(async()=>{
    window.__hot={ ok:true, sent:0, why:'◎ の商品がありません（今週は出しません）',
                   plans:[] };
    await subHotGo();
    return ($('subHotNote').textContent||'');
  });
  ok(/の商品がありません/.test(t2),'★★★出さなかった理由を出す');
  /* 作業者のキーでは出せない。 */
  const t3=await p.evaluate(async()=>{
    syncRole='staff'; roleApply();
    window.__q=[];
    await subHotGo();
    const r={ n:window.__q.filter((x)=>x.u==='hot').length,
              note:($('subHotNote').textContent||'') };
    syncRole='admin'; roleApply();
    return r;
  });
  ok(t3.n===0,'★★★作業者のキーでは出せない');
}

await T.done();
})();
