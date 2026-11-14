/* 画面：買うかどうかの目安（8.29・カジの依頼・v287）
   ① ⚙（しきい値・出し方・プランごとの項目）を読む
   ② 「今日の配信の案」に総合の札が出る
   ③ 「全プランに配る」の確認の画面と「予定」にも札が出る
   ④ 読み方の固定メッセージの文を作れる（チャンネルごと・コピーできる） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：買うかどうかの目安（8.29）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__q=[];
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body;
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/sub\/plan/.test(url))return res(window.__plan||{ ok:true, plans:[] });
    if(/\/sub\/send/.test(url)){
      window.__q.push({ u:'send', b:JSON.parse(String(b||'{}')) });
      return res({ ok:true, sent:1, edited:0, skipped:0, fail:0, left:0 });
    }
    if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, n:0, rows:[] });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
});
await openCsvBoxes(p);

console.log('=== ① ⚙ を読む ===');
{
  const t=await p.evaluate(()=>{
    const o=gdCfg();
    const G=PJ_SUBGUIDE;
    const row={ rank:12000, rank_cat:'ゲーム', new_n:4, amz:0, price:3645,
      amz_price:5800, fee_total:900, fee_rate:0.15, gross:1255,
      px_min:5200, px_avg:6100, px_days:40,
      amz_at:new Date().toISOString() };
    const a=G.badgeOf(row,o);
    $('gdRankA').value='1000'; $('gdRivalA').value='1'; $('gdRateA').value='90';
    const b=G.badgeOf(row,gdCfg());
    $('gdRankA').value='30000'; $('gdRivalA').value='5'; $('gdRateA').value='25';
    $('gdMode').value='num';
    const num=G.cardOf(row,gdCfg(),'premium').lines.map((x)=>x.value).join('｜');
    $('gdMode').value='word';
    const word=G.cardOf(row,gdCfg(),'premium').lines
      .map((x)=>x.value).join('｜');
    return { mode:o.gdMode, mark:a.mark, mark2:b.mark, num:num, word:word,
             mon:G.cardOf(row,gdCfg(),'monitor').lines.length };
  });
  ok(t.mode==='word','★★★⚙の既定は「加工した表現だけ」');
  ok(t.mark==='◎','★★★⚙の既定のしきい値で ◎ が出る');
  ok(t.mark2!=='◎','★★★⚙を厳しくすると札が下がる');
  ok(/12,000位/.test(t.num)&&!/12,000位/.test(t.word),
     '★★★「数字も出す」に変えると数字が入る');
  ok(t.mon===1,'★★モニターは短い（⚙のとおり）');
}

console.log('=== ② 案に札を出す ===');
{
  const t=await p.evaluate(()=>{
    const mk=(o)=>Object.assign({ jan:'4902370550001', name:'商品A',
      price:3645, qty:1, gross:1255, rate:34, speed:1, stock:9, sale:false,
      ship:'クリックポスト', ship_sure:true, ship_text:'クリックポスト',
      ship_warn:'' },o||{});
    subDraftData={ at:'2026-11-14T00:00:00Z', rows:3,
      opt:{ stockPct:30, qtyDays:2, wantQty:5 }, plans:[
      { key:'premium', name:'プレミアム', on:true, ch:'444', over:0, items:[
        mk({ badge:'◎', badge_name:'ねらい目',
             badge_why:'よく売れています、ライバルが少ないです',
             badge_ok:true }),
        mk({ jan:'4902370550002', name:'商品B', badge:'△',
             badge_name:'慎重に', badge_why:'ライバルが多いです',
             badge_ok:true }),
        mk({ jan:'4902370550003', name:'商品C', badge:'—',
             badge_name:'データ確認中', badge_why:'', badge_ok:false })] }] };
    subTabSet('all');
    $('subDraftBox').innerHTML=subDraftHtml(subDraftData.plans);
    return ($('subDraftBox').textContent||'').replace(/\s+/g,' ');
  });
  console.log('   '+t.slice(0,200));
  ok(/◎ ねらい目/.test(t),'★★★案に ◎ の札が出る');
  ok(/よく売れています、ライバルが少ないです/.test(t),
     '★★★一言の理由も出る');
  ok(/△ 慎重に/.test(t),'★★△ の札も出る');
  ok(/— データ確認中/.test(t),'★★★データ確認中の行も分かる');
}

console.log('=== ③ 確認の画面と予定にも札 ===');
{
  const t=await p.evaluate(async()=>{
    const it=(o)=>Object.assign({ jan:'4902370550001', name:'商品A',
      price:3645, qty:1, left:1, gross:1255, sent:false, same:false,
      ship:'クリックポスト', ship_text:'クリックポスト', ship_sure:true,
      ship_warn:'', warns:[], badge:'◎', badge_name:'ねらい目',
      badge_why:'よく売れています', badge_ok:true },o||{});
    window.__plan={ ok:true, table_ok:true, token:true, day:'2026-11-14',
      skip:false, on:true, hour:8, pre:true, domain:'x.myshopify.com', rows:1,
      plans:[{ key:'premium', name:'プレミアム', on:true, ch:'444',
        ch_name:'リスト-プレミアム', n:100, q:5, kinds:'all', add:1, edit:0,
        keep:0, why:'', items:[it({})] }] };
    await subAllOpen();
    subTabSet('all'); subPlanRender();
    return { all:($('subAllBox').textContent||'').replace(/\s+/g,' '),
             plan:($('subPlanList').textContent||'').replace(/\s+/g,' ') };
  });
  await p.waitForTimeout(300);
  console.log('   '+t.all.slice(0,160));
  ok(/◎ ねらい目/.test(t.all),
     '★★★「全プランに配る」の確認の画面に札が出る');
  ok(/◎ ねらい目/.test(t.plan),'★★★「予定」にも札が出る');
}

console.log('=== ④ 読み方の固定メッセージ ===');
{
  const t=await p.evaluate(()=>{
    gdPinGo();
    return { html:$('gdPinBox').innerHTML,
             mon:$('gdPinTxt0').value, pre:$('gdPinTxt3').value,
             note:($('gdPinNote').textContent||'') };
  });
  console.log('   '+t.mon.replace(/\n/g,' / ').slice(0,200));
  ok(/#リスト-モニター/.test(t.html)&&/#リスト-プレミアム/.test(t.html)
     &&/#目玉商品-先行/.test(t.html),
     '★★★チャンネルごとに文を作る');
  ok(/コピー/.test(t.html),'★★コピーできる');
  ok(/目安/.test(t.mon)&&/保証するものではありません/.test(t.mon),
     '★★★「目安であって利益の保証ではない」と書く');
  ok(/総合の札/.test(t.mon)&&/売れ行き/.test(t.mon),
     '★★★モニターの文には札と売れ行きの読み方が入る');
  ok(!/値動き/.test(t.mon),'★★モニターに出さない項目は書かない');
  ok(/値動き/.test(t.pre)&&/赤字にならない売値/.test(t.pre)
     &&/アカウントごとに違います/.test(t.pre),
     '★★★プレミアムの文にはぜんぶ入る');
  ok(/アカウントごとに違います/.test(t.mon),
     '★★★出品制限の注意は、項目に無いプランでも必ず書く');
  ok(!/卸値|仕入原価|MW|matchingworld/.test(t.pre),
     '★★★仕入れ先・卸値のことは書かない');
}

await T.done();
})();
