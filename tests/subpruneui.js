/* 画面：会員向け Discord の買えなくなったカードを消す（8.111・v362）
   ・⚙「買えなくなったカードを毎時自動で消す」（既定オン・pj-sync に送る設定）
   ・「残っている古いカードをまとめて消す」：まず数えて、確認の画面に
     「消すカード ◯件（チャンネルごと・理由ごと）」を出してから消す */
const { harness } = require('./lib');
const T = harness('画面：買えなくなったカードを消す（8.111）');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__post=[]; window.__conf=[];
  window.__plan={ ok:true, n:5, max:300, table_ok:true, token:true, bulk:true,
    by:{ test:3, gone:1, closed:1 },
    chs:[ { ch:'2222222222', key:'light', name:'ライト', n:3, by:{ test:2, gone:1 } },
          { ch:'1111111111', key:'monitor', name:'モニター', n:2, by:{ test:1, closed:1 } } ] };
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), o=i||{};
    const body=o.body?JSON.parse(String(o.body)):null;
    if(/\/whoami/.test(url))return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    if(/\/sub\/prune/.test(url)){
      if(String(o.method||'GET')==='GET'){ window.__post.push({ u:'plan', url }); return res(window.__plan); }
      window.__post.push({ u:'run', body });
      return res({ ok:true, del:5, gone:0, fail:0, left:0, by:{ test:3, gone:1, closed:1 }, all:true });
    }
    return real(u,i);
  };
  switchTab('G'); syncRole='admin'; roleApply();
});
const a=await p.evaluate(()=>({ on:$('subPruneOn').checked, btn:!!$('subPruneBulk'),
  sent:ADV_SUBCHK.indexOf('subPruneOn')>=0, offHidden:$('subOffDays').parentNode.style.display==='none'&&!$('subOffDays').closest('.row') }));
ok(a.on,'★★⚙「買えなくなったカードを毎時自動で消す」は既定オン');
ok(a.sent,'★★pj-sync に送る設定に入る（自動配信がオフでも pj-sync が見回る）');
ok(a.btn,'★★「残っている古いカードをまとめて消す」がある');
ok(a.offHidden,'★使わなくなった「受付終了から消すまで」は隠す');
/* やめたときは消さない */
const c1=await p.evaluate(async()=>{ window.confirm=(t)=>{ window.__conf.push(t); return false; };
  await subPruneBulk(); return { conf:window.__conf.slice(-1)[0]||'', post:window.__post.slice(), note:$('subPruneNote').textContent }; });
console.log('   '+c1.conf.replace(/\n/g,' / '));
ok(/消します：5件/.test(c1.conf)&&/ライト：3件（テスト配信（モニターの開始日より前） 2・リストから外れた 1）/.test(c1.conf)
   &&/モニター：2件（テスト配信（モニターの開始日より前） 1・受付終了にしてあった 1）/.test(c1.conf),
   '★★★押す前に「消すカード ◯件（チャンネルごと・理由ごと）」を確認の画面に出す');
ok(c1.post.length===1&&c1.post[0].u==='plan'&&/bulk=1/.test(c1.post[0].url)&&/何も消していません/.test(c1.note),
   '★★★やめたら何も消さない（数えただけ）');
const c2=await p.evaluate(async()=>{ window.confirm=()=>true; window.__post=[];
  await subPruneBulk(); return { post:window.__post, note:$('subPruneNote').textContent }; });
ok(c2.post.some((x)=>x.u==='run'&&x.body&&x.body.bulk===true),'★★★「はい」でまとめて消す（POST /sub/prune bulk）');
ok(/消しました：5件/.test(c2.note)&&/毎時自動で消します/.test(c2.note),'★結果を出す');
const c3=await p.evaluate(async()=>{ window.__plan={ ok:true, n:0, chs:[], by:{}, table_ok:true };
  window.__post=[]; await subPruneBulk(); return { post:window.__post, note:$('subPruneNote').textContent }; });
ok(c3.post.length===1&&/消すカードはありません/.test(c3.note),'★消すカードが無ければそう出す');
T.done();
})();
