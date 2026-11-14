/* 画面：1点ものの登録と配信（8.22・カジの依頼【2】）
   ① 登録の欄（商品名／JAN・ASIN／状態／仕入原価／販売価格／数量／
      送料の区分／メモ／写真）
   ② Amazon の値段・手数料・見込みの粗利を取る
   ③ 一覧と印（読み込みました・取り下げ・直す）
   ④ Shopify 用 CSV（one-<連番>・写真は入れない・先行は grade-premium だけ）
   ⑤ 配信の予定に #目玉商品-先行／#目玉商品 が出て、1つずつ送れる */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：1点ものの登録と配信（8.22）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const ROW=(o)=>Object.assign({ one_id:1, handle:'one-1',
  name:'ガンダム RG νガンダム', real_jan:'', asin:'', cond:'中古',
  cond_note:'箱にスレ', cost:2000, price:4800, qty:1, sold:0, left:1,
  ship_kind:'box', note:'開封済み', pic:false, pic_type:'',
  amz_price:9000, amz_fee:1200, gross:5800, basis:'カート',
  pre_at:'', open_at:'', loaded_at:'', put_at:'', off:0,
  at:'2026-11-14T00:00:00Z', at_jst:'11/14 09:00' },o||{});

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__q=[]; window.__dl=[];
  window.dl=(name,text)=>{ window.__dl.push({ name:name, text:text });
    return true; };
  const real=window.fetch;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body, m=String((i||{}).method||'GET');
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/one\/amz/.test(url)&&m==='GET'){
      window.__q.push({ u:'amz', url:url });
      return res(o.amz||{ ok:true, jan:'4902370550467', asin:'B0D1GSZJ8T',
        price:9000, fee:1200, gross:5800, basis:'カート', src:'mw_amz' });
    }
    if(/\/one\/mark/.test(url)){
      window.__q.push({ u:'mark', b:JSON.parse(String(b||'{}')) });
      return res({ ok:true, n:1 });
    }
    if(/\/one/.test(url)&&m==='POST'){
      window.__q.push({ u:'put', b:JSON.parse(String(b||'{}')) });
      return res({ ok:true, id:1, handle:'one-1' });
    }
    if(/\/one/.test(url)){
      window.__q.push({ u:'list' });
      return res({ ok:true, table_ok:true, n:(o.rows||[]).length,
        rows:o.rows||[], pre_grades:'premium',
        open_grades:'standard,premium', hours:24 });
    }
    if(/\/sub\/plan/.test(url))return res(o.plan||{ ok:true, plans:[] });
    if(/\/sub\/send/.test(url)){
      window.__q.push({ u:'send', b:JSON.parse(String(b||'{}')) });
      return res({ ok:true, sent:1, edited:0, skipped:0, plans:[] });
    }
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
  switchTab('F');
},o||{});

console.log('=== ① 登録の欄 ===');
await setup({ rows:[] });
await openCsvBoxes(p);
{
  const t=await p.evaluate(()=>({
    ids:['oneName','oneJan','oneAsin','oneCond','oneCondNote','oneCost',
         'onePrice','oneQty','oneShip','oneNote','onePicFile']
      .map((x)=>!!document.getElementById(x)),
    qty:$('oneQty').value, ship:$('oneShip').value,
    ships:Array.prototype.map.call($('oneShip').options,(o)=>o.value) }));
  ok(t.ids.every(Boolean),'★★★商品名・JAN・ASIN・状態・仕入原価・販売価格・'
     +'数量・送料の区分・メモ・写真の欄がある');
  ok(t.qty==='1','★★数量の既定は 1');
  ok(t.ships.join(',')==='small,letter,box','★送料の区分を選べる');
}
await p.evaluate(()=>{
  $('oneName').value='ガンダム RG νガンダム';
  $('oneCond').value='中古'; $('oneCondNote').value='箱にスレ';
  $('oneCost').value='2000'; $('onePrice').value='4800';
  $('oneNote').value='開封済み';
  return oneSaveGo();
});
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>({
    b:(window.__q.filter((x)=>x.u==='put')[0]||{}).b,
    note:($('oneNote2').textContent||'') }));
  ok(t.b&&t.b.name==='ガンダム RG νガンダム','★★★商品名を送る');
  ok(t.b.cost===2000&&t.b.price===4800&&t.b.qty===1,'★★値段と数量を送る');
  ok(t.b.cond==='中古'&&t.b.cond_note==='箱にスレ','★★状態を送る');
  ok(t.b.jan===''&&t.b.asin==='','★★★JAN も ASIN も無くても登録できる');
  ok(/one-1/.test(t.note),'★結果を出す');
}
{
  await p.evaluate(()=>{ window.__q=[]; $('oneName').value='';
                         return oneSaveGo(); });
  await p.waitForTimeout(200);
  const t=await p.evaluate(()=>({ n:window.__q.filter((x)=>x.u==='put').length,
    note:($('oneNote2').textContent||'') }));
  ok(t.n===0&&/商品名を入れて/.test(t.note),'★名前が無ければ送らない');
}

console.log('=== ② Amazon の値段 ===');
await p.evaluate(()=>{ $('oneName').value='商品'; $('oneJan').value='4902370550467';
                       $('oneCost').value='2000'; window.__q=[];
                       return oneAmzGo(); });
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>({
    url:(window.__q.filter((x)=>x.u==='amz')[0]||{}).url,
    note:($('oneAmzNote').textContent||'').replace(/\s+/g,' '),
    asin:$('oneAsin').value }));
  ok(/jan=4902370550467/.test(t.url)&&/cost=2000/.test(t.url),
     '★★★JAN と仕入原価を渡して聞く');
  ok(/¥9,000/.test(t.note)&&/¥1,200/.test(t.note),
     '★★★Amazon の販売価格と手数料が出る');
  ok(/見込みの粗利 ¥5,800/.test(t.note),'★★★見込みの粗利が出る');
  ok(t.asin==='B0D1GSZJ8T','★★取れた ASIN を欄に入れる');
  await p.evaluate(()=>{ $('oneJan').value=''; $('oneAsin').value='';
                         return oneAmzGo(); });
  await p.waitForTimeout(200);
  ok(/JAN か ASIN/.test(await p.evaluate(()=>$('oneAmzNote').textContent||'')),
     '★どちらも無ければ断る');
}

console.log('=== ③ 一覧と印 ===');
await setup({ rows:[ROW({}),ROW({ one_id:2, handle:'one-2', name:'フィギュア',
  loaded_at:'2026-11-14T01:00:00Z', pre_at:'2026-11-14T02:00:00Z',
  pre_at_jst:'11/14 11:00', pic:true })] });
await p.evaluate(()=>oneListGo());
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>({
    txt:($('oneList').textContent||'').replace(/\s+/g,' '),
    html:$('oneList').innerHTML }));
  console.log('   '+t.txt.slice(0,160));
  ok(/1点もの 2件/.test(t.txt),'★★件数が出る');
  ok(/one-1/.test(t.txt)&&/one-2/.test(t.txt),'★★★Handle が出る');
  ok(/未読み込み/.test(t.txt)&&/読み込み済み/.test(t.txt),
     '★★★Shopify に読み込んだかが分かる');
  ok(/写真/.test(t.txt),'★★写真ありが分かる');
  ok(/先行 11\/14 11:00/.test(t.txt),'★★先行に出した時刻が出る');
  ok(/残り 1／1点/.test(t.txt),'★残りが出る');
}
await p.evaluate(()=>{ window.__q=[]; return oneMarkGo(1,'loaded',1); });
await p.waitForTimeout(300);
{
  const t=await p.evaluate(()=>(window.__q.filter((x)=>x.u==='mark')[0]||{}).b);
  ok(t&&t.ids[0]===1&&t.loaded===1,'★★★「読み込みました」の印を送る');
}
await p.evaluate(()=>{ window.__q=[]; return oneMarkGo(2,'off',1); });
await p.waitForTimeout(300);
{
  const t=await p.evaluate(()=>(window.__q.filter((x)=>x.u==='mark')[0]||{}).b);
  ok(t&&t.off===1,'★★取り下げも送る');
}
await p.evaluate(()=>oneEdit(1));
{
  const t=await p.evaluate(()=>({ id:oneEditId, name:$('oneName').value,
    cond:$('oneCondNote').value, btn:$('oneSaveBtn').textContent }));
  ok(t.id===1&&t.name==='ガンダム RG νガンダム'&&t.cond==='箱にスレ',
     '★★★「直す」で欄に入る');
  ok(/one-1 を直す/.test(t.btn),'★★ボタンの文も変わる');
}
await p.evaluate(()=>oneFormClear());
ok(await p.evaluate(()=>oneEditId===0&&$('oneName').value===''),
   '★「欄を空にする」で新しく登録に戻る');

console.log('=== ④ Shopify 用 CSV ===');
await setup({ rows:[ROW({ one_id:1, handle:'one-1' }),
  ROW({ one_id:2, handle:'one-2', name:'先行があいた品',
        pre_at:new Date(Date.now()-30*3600*1000).toISOString() }),
  ROW({ one_id:3, handle:'one-3', name:'取り下げ', off:1 })] });
await p.evaluate(()=>oneCsvGo());
await p.waitForTimeout(500);
{
  const t=await p.evaluate(()=>({
    name:(window.__dl[0]||{}).name, text:(window.__dl[0]||{}).text||'',
    note:($('oneNote2').textContent||'').replace(/\s+/g,' ') }));
  const rows=await p.evaluate((x)=>PJ_SHOPCSV.splitCsv(x),t.text);
  const col=(n)=>rows[0].indexOf(n);
  console.log('   '+t.name+'：'+t.note.slice(0,120));
  ok(/^shopify-one-\d{8}\.csv$/.test(String(t.name)),'★★ファイル名');
  ok(rows.length-1===2,'★★★取り下げた商品は出さない');
  ok(rows[1][col('Handle')]==='one-1','★★★Handle は one-<連番>');
  ok(/^ONE-1-\d{8}$/.test(rows[1][col('Variant SKU')]),'★★SKU は ONE-…');
  ok(/member-list/.test(rows[1][col('Tags')])
     &&/grade-premium/.test(rows[1][col('Tags')]),
     '★★★タグは member-list と grade-premium');
  ok(!/grade-standard/.test(rows[1][col('Tags')]),
     '★★★先行のあいだは premium だけ');
  ok(/grade-standard/.test(rows[2][col('Tags')]),
     '★★★先行があいた商品は ⚙ のプランも足す');
  ok(t.text.indexOf('Image Src')<0,'★★★写真は CSV に入れない');
  ok(/書き出した 2件/.test(t.note),'★★まとめを出す');
  ok(/Shopify の商品ページ/.test(t.note),'★写真の入れ方を案内する');
}

console.log('=== ⑤ 配信の予定（#目玉商品-先行／#目玉商品）===');
await setup({ rows:[], plan:{ ok:true, table_ok:true, token:true,
  day:'2026-11-14', on:false, hour:8, pre:true, domain:'x.myshopify.com',
  rows:0, plans:[
    { key:'monitor', name:'モニター', on:true, ch:'111', add:0, edit:0,
      keep:0, items:[], why:'配信できる商品がありません' },
    { key:'one_pre', name:'目玉商品-先行（プレミアム）', on:true, ch:'777',
      one:true, add:1, edit:0, keep:0, why:'',
      items:[{ jan:'one-1', one_id:1, name:'ガンダム RG νガンダム',
               price:4800, qty:1, left:1, gross:5800, sent:false,
               same:false }] },
    { key:'one_open', name:'目玉商品（スタンダード以上）', on:true, ch:'888',
      one:true, add:0, edit:0, keep:0, items:[],
      why:'先行のあと 20時間待ちです 1件' }] } });
/* 8.23：予定はプランのタブで分かれたので、［目玉商品］のタブで見る。 */
await p.evaluate(()=>{ subTabSet('one'); return subPlanGo(); });
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>({
    txt:($('subPlanList').textContent||'').replace(/\s+/g,' '),
    btn:Array.prototype.map.call(
      document.querySelectorAll('#subPlanList button:not(.tabbtn)'),
      (b)=>b.textContent.replace(/\s+/g,' ')) }));
  console.log('   '+t.txt.slice(0,200));
  ok(/目玉商品-先行（プレミアム） 1件/.test(t.txt),
     '★★★#目玉商品-先行 が予定に出る');
  ok(/ガンダム RG νガンダム/.test(t.txt),'★★商品名が出る');
  ok(/0件：先行のあと 20時間待ちです/.test(t.txt),
     '★★★#目玉商品 は理由（あと何時間か）を出す');
  ok(t.btn.some((x)=>/目玉商品-先行（プレミアム）だけ送る/.test(x)),
     '★★★「目玉商品-先行だけ送る」のボタンが出る');
  ok(!t.btn.some((x)=>/目玉商品（スタンダード以上）だけ送る/.test(x)),
     '★★送るものが無いほうにはボタンを出さない');
}
await p.evaluate(()=>{ window.__q=[]; return subSendGo('one_pre'); });
await p.waitForTimeout(400);
{
  const t=await p.evaluate(()=>(window.__q.filter((x)=>x.u==='send')[0]||{}).b);
  ok(t&&t.plan==='one_pre','★★★1点ものだけを送れる（plan を付ける）');
}

await T.done();
})();
