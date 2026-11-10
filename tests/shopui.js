/* 画面：会員に出す印と Shopify 用 CSV（6.170・【U の改】の1〜3）
   ① 刈取の行に「会員に出す」の印・販売数の上限・販売価格（おすすめ値）が出る
   ② 印を付けると pj-sync に控える。上限か価格が無いと付けない
   ③ 「Shopify 用 CSV を書き出す」が公式の列名で出す
   ④ 在庫CSV（ロケーション名が要る）
   ⑤ 英語：Shopify から出した翻訳CSVに英題を書き込む
   ⑥ mw_sub が無い（migrate-0051 の前）ときは印を出さず、どれを流すか出す */
const { harness } = require('./lib');
const T = harness('画面：会員に出す印と Shopify 用 CSV（6.170）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const row=(i,x)=>Object.assign({
  jan:'49023715'+String(10000+i).slice(-5), sha:'いろは商会', kishu:'NS2',
  mw_name:'【新品】商品'+i+' ★', amz_name:'商品'+i, cond:'新品',
  list_price:7678, wholesale:3000, stock:12, note:'店長おすすめ',
  ship_text:'即日', ship_days:0,
  asin:'B0KND'+String(10000+i).slice(-5), rank:1200, rank_cat:'ゲーム',
  price:6000, basis:'カート', new_n:3, amz:0,
  fee_total:900, fee_ref:600, fee_fba:200, fee_tax:100,
  fee_fba_ship:200, fee_fba_store:16, size_tier:'s', size_g:110,
  price_at:'2026-11-10T00:00:00Z', amz_at:'2026-11-10T00:00:00Z',
  fee_at:'2026-11-10T00:00:00Z', fee_base:6000,
  sub_on:0, sub_max:null, sub_price:null, sub_grades:'', sub_put_at:null,
  pics_ok:1, pics_n:1, buy_qty:0, rst:'ok'
},x||{});

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('csvTitleApi').value='https://title.example'; $('csvTitleKey').value='tk';
  $('fx').value='160'; $('mwShipFee').value='176';
  $('mwAmzFeeGame').value='15'; $('mwAmzFbaGame').value='530';
  $('csvMwAmzWin').checked=false;
  if($('csvMwAmzFbaNg'))$('csvMwAmzFbaNg').checked=false;
  window.__q=[]; window.__dl=[];
  const rows=o.rows||[];
  const sub=o.sub||{ ok:true, table_ok:true, n:0, rows:[] };
  const real=window.fetch;
  /* 書き出しは受け止めて中身を見る（本当にダウンロードはしない）。 */
  window.csvDownload=(name,text)=>{ window.__dl.push({ name:name, text:text });
    return true; };
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body;
    const res=(x,st)=>new Response(JSON.stringify(x),{status:st||200});
    if(/\/whoami/.test(url))
      return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/mw\/sub\/put/.test(url)){
      window.__q.push({ u:'subput', b:JSON.parse(String(b||'{}')) });
      return res({ ok:true, n:1 });
    }
    if(/\/mw\/sub/.test(url)&&(i||{}).method==='POST'){
      const body=JSON.parse(String(b||'{}'));
      window.__q.push({ u:'subpost', b:body });
      return res(o.subpost||{ ok:true, n:1, table_ok:true, rows:[body] });
    }
    if(/\/mw\/sub/.test(url)){
      window.__q.push({ u:'subget', url:url });
      return res(sub);
    }
    if(/\/titles/.test(url)){
      const body=JSON.parse(String(b||'{}'));
      window.__q.push({ u:'titles', b:body });
      return res({ results:(body.items||[]).map((x)=>({
        english_name:'EN '+x.ja_title, status:'ok' })) });
    }
    if(/\/mw\/fee\/ng/.test(url))return res({ok:true,n:0,all:0,rows:[]});
    if(/\/mw\/amz/.test(url)){
      return res({ ok:true, n:rows.length, rows:rows, seen:rows.length,
        priced:rows.length, left:0, per_run:120,
        fee:{ n:rows.length, ok:rows.length, ng:0, none:0 } });
    }
    if(/\/mw\/buy/.test(url))return res({ok:true,rows:[],n:0,qty:0,yen:0,gone:0});
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return real(u,i);
  };
  syncRole='admin'; roleApply();
},o||{});
const load=async()=>{ await p.evaluate(async()=>{ switchTab('F');
  await mwAmzLoad(); }); await p.waitForTimeout(400); };
const cellOf=(text,r,name)=>{
  const rows=require('../shared/shopcsv.js').splitCsv(text);
  const i=rows[0].indexOf(name);
  return i<0?undefined:rows[r][i];
};

console.log('=== ① 行に「会員に出す」の欄が出る ===');
await setup({ rows:[row(0),row(1)] });
await load();
{
  const t=await p.evaluate(()=>({
    txt:($('csvMwAmzList').textContent||'').replace(/\s+/g,' '),
    chk:!!document.getElementById('mwSubChk_4902371510000'),
    qty:($('mwSubQty_4902371510000')||{}).value,
    px:($('mwSubPx_4902371510000')||{}).value }));
  console.log('   上限 '+t.qty+'／価格 '+t.px);
  ok(t.chk,'★★★「会員に出す」のチェックが行にある');
  ok(/会員に出す/.test(t.txt),'★★見出しも出る');
  ok(t.px==='4300',
     '★★★販売価格のおすすめ値が入る（卸値3,000×1.1×1.3＝4,290→4,300）');
  ok(t.qty==='10','★★★上限のおすすめ値（在庫12・プランの上限10 の小さいほう）');
  ok(/会員の粗利の目安/.test(t.txt),
     '★★★会員から見た粗利の目安を出す（実売−手数料−販売価格）');
  /* 手数料は画面と同じ出し方（⚙の在庫管理手数料ぶんを足す・6.145）。
     600＋200＋8（在庫管理の目安）＋100＝908 なので 6,000−908−4,300＝792。 */
  const g=await p.evaluate(()=>mwSubGrossOf({ price:6000, fee_total:900,
    fee_ref:600, fee_fba:200, fee_tax:100 },4300));
  ok(g===792,'★★★粗利＝実売−手数料（⚙の在庫管理ぶんも足す）−販売価格');
  ok(await p.evaluate(()=>mwSubGrossOf({ price:6000 },4300))===null,
     '★★★手数料が取れていない行は目安を出さない（仮の値では出さない）');
  ok(await p.evaluate(()=>mwSubGrossOf({ price:6000, fee_mfn:1, fee_ref:264,
    fee_tax:26, size_tier:'s' },4300))!==null,
     '★★FBA 不可の行（販売手数料が実額）は出す');
}
{
  const m=await p.evaluate(()=>{
    $('mwSubMarkup').value='1.5';
    return mwSubSuggest({ wholesale:3000 });
  });
  ok(m===5000,'★★★掛け率を変えるとおすすめ値も変わる（3,300×1.5＝4,950→5,000）');
  await p.evaluate(()=>{ $('mwSubMarkup').value='1.3'; });
  ok(await p.evaluate(()=>mwSubSuggest({ wholesale:0 }))===0,
     '★卸値が無ければ0');
}

console.log('\n=== ①の2 重さが取れていない行は注意を出す（6.171）===');
{
  await setup({ rows:[row(0),row(1,{ size_g:0, size_tier:'' })] });
  await load();
  const t=await p.evaluate(()=>({
    txt:($('csvMwAmzList').textContent||'').replace(/\s+/g,' '),
    noG:mwSubNoG({ size_g:0 }), g:mwSubNoG({ size_g:110 }) }));
  ok(t.noG===true&&t.g===false,'★★重さが無い行だけ見分ける');
  ok(/重さ未取得（送料の段がずれます）/.test(t.txt),
     '★★★重さの無い行に注意を出す');
  ok((t.txt.match(/重さ未取得/g)||[]).length===1,
     '★★重さのある行には出さない');
}
{
  /* 書き出したあとにも件数で知らせる。 */
  const SUBG={ ok:true, table_ok:true, n:2, rows:[
    { jan:'4902370550467', name:'重さあり', asin:'B0D1GSZJ8T', kishu:'Switch',
      price:5300, max_qty:3, grades:'', size_tier:'s', size_g:110 },
    { jan:'4948872415019', name:'重さなし', asin:'B0CW1GB9VN', kishu:'Switch',
      price:3800, max_qty:5, grades:'', size_tier:'', size_g:0 }] };
  await setup({ rows:[row(0)], sub:SUBG });
  await load();
  const d=await p.evaluate(async()=>{
    window.__dl=[]; mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,400));
    return { note:($('mwSubNote').textContent||'').replace(/\s+/g,' '),
             text:(window.__dl[0]||{}).text };
  });
  console.log('   '+d.note);
  ok(/重さが取れていない行が 1件/.test(d.note),
     '★★★書き出したあとに件数で知らせる');
  ok(/Amazonで調べる/.test(d.note),'★★★どうすれば直るか書く');
  ok(cellOf(d.text,2,'Weight value (grams)')==='0',
     '★重さが無い行は 0 で出る（だから注意が要る）');
}

console.log('\n=== ② 印を付けると pj-sync に控える ===');
await setup({ rows:[row(0),row(1)] });
await load();
{
  const q=await p.evaluate(async()=>{
    window.__q=[];
    $('mwSubChk_4902371510000').checked=true;
    mwSubToggle('4902371510000');
    await new Promise((x)=>setTimeout(x,200));
    return window.__q.filter((x)=>x.u==='subpost').map((x)=>x.b);
  });
  console.log('   '+JSON.stringify(q));
  ok(q.length===1&&q[0].on===1,'★★★印を送る');
  ok(q[0].max_qty===10&&q[0].price===4300,'★★★上限と価格も一緒に送る');
  ok(q[0].jan==='4902371510000','★★JAN を送る');
}
{
  const r=await p.evaluate(async()=>{
    window.__q=[];
    $('mwSubPx_4902371510001').value='0';
    $('mwSubChk_4902371510001').checked=true;
    mwSubToggle('4902371510001');
    await new Promise((x)=>setTimeout(x,150));
    return { n:window.__q.filter((x)=>x.u==='subpost').length,
             note:($('mwSubNote').textContent||''),
             chk:$('mwSubChk_4902371510001').checked };
  });
  console.log('   '+r.note);
  ok(r.n===0,'★★★価格が無いまま印は送らない');
  ok(/販売数の上限と販売価格を入れて/.test(r.note),'★★★何が足りないか出す');
  ok(r.chk===false,'★★チェックも戻す');
}
{
  const bar=await p.evaluate(async()=>{
    mwSubMap={ a:{ on:1, max_qty:3, price:5300 },
               b:{ on:1, max_qty:5, price:3800 }, c:{ on:0 } };
    mwSubBarRender();
    return { txt:($('mwSubBar').textContent||'').replace(/\s+/g,' '),
             show:$('mwSubBar').style.display };
  });
  console.log('   '+bar.txt);
  ok(/会員に出す 2件/.test(bar.txt),'★★★印の件数をまとめて出す');
  ok(/のべ 8点/.test(bar.txt)&&/9,100/.test(bar.txt),
     '★★のべの点数と販売価格の合計も出す');
}

console.log('\n=== ③ Shopify 用 CSV を書き出す ===');
const SUB={ ok:true, table_ok:true, n:2, rows:[
  { jan:'4902370550467', name:'スーパーマリオパーティ ジャンボリー',
    asin:'B0D1GSZJ8T', kishu:'Switch', price:5300, max_qty:3, grades:'',
    size_tier:'s', size_g:110, size_long:19 },
  { jan:'4948872415019', name:'ドラゴンボール カードゲーム',
    asin:'B0CW1GB9VN', kishu:'TCG', price:3800, max_qty:5,
    grades:'premium,monitor', size_tier:'s', size_g:180, size_long:14 }] };
await setup({ rows:[row(0)], sub:SUB });
await load();
{
  const d=await p.evaluate(async()=>{
    $('mwSubType').value='ゲームソフト';
    $('mwSubCollection').value='';
    window.__dl=[]; window.__q=[];
    mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,400));
    return { dl:window.__dl, note:($('mwSubNote').textContent||'')
      .replace(/\s+/g,' '), q:window.__q.filter((x)=>x.u==='subput') };
  });
  console.log('   '+d.dl[0].name+'：'+d.note);
  ok(d.dl.length===1,'★★★1つのファイルを書き出す');
  ok(/^shopify-products-\d{8}\.csv$/.test(d.dl[0].name),
     '★★ファイル名に日付が入る');
  const t=d.dl[0].text;
  ok(cellOf(t,1,'URL handle')==='sub-4902370550467','★★★Handle は sub-<JAN>');
  ok(cellOf(t,1,'Title')==='スーパーマリオパーティ ジャンボリー','★★★Title');
  ok(cellOf(t,1,'Price')==='5300','★★★販売価格');
  ok(cellOf(t,1,'Inventory quantity')==='3','★★★上限が在庫数になる');
  ok(cellOf(t,1,'Continue selling when out of stock')==='deny',
     '★★★売り切れで止める');
  ok(cellOf(t,1,'Weight value (grams)')==='110','★★★重さ（送料に効く）');
  ok(cellOf(t,1,'Barcodes')==='4902370550467','★★JAN は Barcodes');
  ok(cellOf(t,1,'Type')==='ゲームソフト','★★Type は⚙から');
  ok(/member-list/.test(cellOf(t,1,'Tags'))
     &&/ship-small/.test(cellOf(t,1,'Tags')),'★★★タグが付く');
  ok(/grade-premium/.test(cellOf(t,2,'Tags'))
     &&!/grade-light/.test(cellOf(t,2,'Tags')),
     '★★★選んだプランだけ grade-* が付く');
  ok(t.indexOf('Image')<0,'★★★画像の列は出さない');
  ok(!/卸値|いろは|店長おすすめ/.test(t),
     '★★★卸値・社・備考は出さない');
  ok(t.indexOf('Collection')<0,
     '★★★Collection が空なら列ごと出さない（空で上書きしないため）');
  ok(/Overwrite products with matching handles/.test(d.note),
     '★★★読み込みのときのチェックを案内する');
  ok(d.q.length===1&&(d.q[0].b.jans||[]).length===2,
     '★★「出した印」を pj-sync に送る');
}
{
  const t=await p.evaluate(async()=>{
    $('mwSubCollection').value='会員リスト';
    window.__dl=[]; mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,400));
    return window.__dl[0].text;
  });
  ok(cellOf(t,1,'Collection')==='会員リスト',
     '★★★Collection を入れたら出る（自動コレクションの条件に使える）');
}
{
  const n=await p.evaluate(async()=>{
    window.__dl=[];
    const old=window.fetch;
    window.fetch=async(u,i)=>(/\/mw\/sub/.test(String(u))&&(i||{}).method!=='POST')
      ? new Response(JSON.stringify({ ok:true, table_ok:true, n:0, rows:[] }))
      : old(u,i);
    mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,300));
    window.fetch=old;
    return { dl:window.__dl.length, note:($('mwSubNote').textContent||'') };
  });
  ok(n.dl===0&&/印の付いた行がありません/.test(n.note),
     '★★★印が1つも無いときは書き出さず、そう言う');
}

console.log('\n=== ④ 在庫CSV（ロケーション名が要る）===');
{
  const a=await p.evaluate(async()=>{
    $('mwSubLoc').value='';
    mwSubInvGo();
    await new Promise((x)=>setTimeout(x,200));
    return { note:($('mwSubNote').textContent||''), dl:window.__dl.length };
  });
  ok(/ロケーション名/.test(a.note),'★★★ロケーション名が無いときは言う');
  const b=await p.evaluate(async()=>{
    $('mwSubLoc').value='本社'; $('mwSubInvFirst').checked=true;
    window.__dl=[]; mwSubInvGo();
    await new Promise((x)=>setTimeout(x,400));
    return window.__dl[0];
  });
  console.log('   '+b.name);
  ok(/^shopify-inventory-\d{8}\.csv$/.test(b.name),'★★在庫CSV を書き出す');
  ok(cellOf(b.text,1,'Location')==='本社','★★★ロケーション名が入る');
  ok(cellOf(b.text,1,'On hand (new)')==='3','★★★新しい在庫数が入る');
  ok(cellOf(b.text,1,'On hand (current)')==='Not stocked',
     '★★★初めて置くときは Not stocked');
}

console.log('\n=== ⑤ 英語：翻訳CSVに英題を書き込む ===');
{
  const TR='Type,Identification,Field,Locale,Market,Status,'
    +'Default content,Translated content\n'
    +'Product,gid://shopify/Product/111,title,en,,,'
    +'スーパーマリオパーティ ジャンボリー,\n'
    +'Product,gid://shopify/Product/111,body_html,en,,,<p>説明</p>,\n';
  const d=await p.evaluate(async(TR)=>{
    window.__dl=[]; window.__q=[];
    /* ファイルを選んだことにする。 */
    const f=new File([TR],'translations.csv',{ type:'text/csv' });
    const dt=new DataTransfer(); dt.items.add(f);
    $('mwSubTrFile').files=dt.files;
    mwSubTransGo();
    await new Promise((x)=>setTimeout(x,800));
    return { dl:window.__dl, note:($('mwSubTrNote').textContent||'')
      .replace(/\s+/g,' '), titles:window.__q.filter((x)=>x.u==='titles') };
  },TR);
  console.log('   '+d.note);
  ok(d.titles.length===1,'★★★英題は /titles（既存の英題生成）で作る');
  ok((d.titles[0].b.items||[])[0].ja_title==='スーパーマリオパーティ ジャンボリー',
     '★★★MW の癖を外した名前で聞く');
  ok((d.titles[0].b.items||[])[0].condition==='new','★新品として聞く');
  ok(d.dl.length===1&&d.dl[0].name==='shopify-translations-filled.csv',
     '★★★埋めた CSV を書き出す');
  const t=d.dl[0].text;
  ok(cellOf(t,1,'Translated content')
     ==='EN スーパーマリオパーティ ジャンボリー',
     '★★★Translated content に英題が入る');
  ok(cellOf(t,2,'Translated content')==='',
     '★★★title 以外の行（body_html）は触らない');
  ok(cellOf(t,1,'Identification')==='gid://shopify/Product/111',
     '★★★Shopify の内部ID はそのまま残す（これで行が決まる）');
  ok(/1件に英題を入れました/.test(d.note),'★★何件入れたか出す');
  ok(/設定→言語 → インポート/.test(d.note),'★★★次にどうするか案内する');
}
{
  const n=await p.evaluate(async()=>{
    const f=new File(['Type,Identification\nProduct,1\n'],'x.csv');
    const dt=new DataTransfer(); dt.items.add(f);
    $('mwSubTrFile').files=dt.files;
    window.__dl=[]; mwSubTransGo();
    await new Promise((x)=>setTimeout(x,800));
    return { dl:window.__dl.length, note:($('mwSubTrNote').textContent||'') };
  });
  ok(n.dl===0&&/Default content/.test(n.note),
     '★★★違うファイルを選んだら、どの列が無いか言う');
}

console.log('\n=== ⑥ mw_sub が無い（migrate-0051 の前）===');
await setup({ rows:[row(0,{ sub_on:undefined, sub_max:undefined,
  sub_price:undefined, sub_grades:undefined, sub_put_at:undefined })],
  sub:{ ok:true, table_ok:false, n:0, rows:[], fix:'migrate-0051-mw-sub.sql' } });
await load();
{
  const t=await p.evaluate(()=>({
    chk:!!document.getElementById('mwSubChk_4902371510000'),
    txt:($('csvMwAmzList').textContent||'').replace(/\s+/g,' ') }));
  ok(t.chk===false,'★★★印の欄を出さない（押しても保存できないので）');
  ok(!/会員に出す/.test(t.txt),'★★見出しも出さない');
  const n=await p.evaluate(async()=>{
    window.__dl=[]; mwSubCsvGo();
    await new Promise((x)=>setTimeout(x,300));
    return { dl:window.__dl.length, note:($('mwSubNote').textContent||'') };
  });
  console.log('   '+n.note);
  ok(n.dl===0&&/migrate-0051/.test(n.note),
     '★★★どの migrate を流せばよいか出す');
}
T.done();
})();
