/* 販売連携：この行の売値を直すボタンと、大事な行の最安値の帯（6.172・v254）
   ① 「売値の見直し $64.96 → $55.25」は表示だけだったので、
      行から1回で eBay の売値を直せるボタンにする（確認してから送る）
   ② 再調達中の行にも出す（自動反映の対象外なので、ここが唯一の手段だった）
   ③ 下げを保留している行も、人が押すなら下げられる（下限は pj-sync が守る）
   ④ 売値は pj-sync が計算するので、画面の数字は送らない
   ⑤ 帯に「大事な行が24時間以上取り直せていません」を出す */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('販売連携：この行の売値を直す（6.172）');
const ok = T.ok;
(async()=>{
const p=await T.open();
let dlg=[], cancel=false;
p.on('dialog',async d=>{ dlg.push(d.message()); if(cancel)await d.dismiss();
                         else await d.accept(); });

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://pj-sync.example.workers.dev'; $('syncKey').value='k';
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('targetMode').value='auto';
  $('autoRvMode').value='confirm'; $('autoMdMode').value='off'; $('pbMode').value='off';
  $('autoRkMode').value='auto';
  $('syncSkipAcc').checked=true; $('syncTol').value='200';
  window.__sync=[];
  const real=window.fetch;
  window.fetch=function(u,i){
    const url=String(u), body=(i&&i.body)?JSON.parse(i.body):null;
    const res=(o2,st)=>Promise.resolve({ok:!st||st<400,status:st||200,
      text:()=>Promise.resolve(JSON.stringify(o2)), json:()=>Promise.resolve(o2)});
    if(/\/whoami/.test(url))return res({ok:true,role:o.role||'admin',staff_key_set:true});
    if(/\/status/.test(url))return res({counts:{},items:[],last_runs:[]});
    if(/\/settings/.test(url))return res({ok:true,stored:true});
    if(/\/listings/.test(url))return res({accepted:0,rejected:0});
    if(/\/sync/.test(url)){
      window.__sync.push(body);
      return res(o.reply||{ ok:true, from:64.96, to:55.25, floor:40,
        under:false, why:'' });
    }
    return real(u,i);
  };
  const it=(asin,x)=>Object.assign({asin:asin,cond:'used',scope:'ebay',prefix:'game',
    ebay_sku:'E-'+asin+'-U',ebay_item_id:'77'+asin.slice(-4),ebay_qty:1,
    ebay_price:64.96,title:asin+'の商品',cost_yen:3980,weight_g:150,
    one_off:0,one_off_known:1,dropship:0,restocking:1,on_hand:0,mode:'restock',
    restock_price:64.96,restock_max_cost:2500,
    fba_available:0,fba_inbound:0,fba_reserved:0,fba_res_cust:null,
    fba_res_trans:null,fba_res_proc:null,fba_seen_at:new Date().toISOString(),
    mark_at:null,mark_stop:0,ebay_first:0,ebay_sold_at:null,ebay_bo:0,ebay_sale:0,
    md_step:null,md_start:null,md_floor:null,md_n:null,md_done:0,
    rv_want:null,rv_floor:null,rv_kind:null,rv_max_cost:null,rv_fail:0,revise_err:null,
    rk_want:null,rk_floor:null,rk_low:null,rk_n:null,rk_max_cost:null,
    rk_want_at:null,rk_fail:0,
    pics_eps:1,pb_act:null,pb_why:null,pb_skip:0,pb_fail:0,pb_want:null,
    amazon_lowest:5000,amazon_offers:3,
    amazon_offers_json:'[{"p":5000,"c":"good"},{"p":5100,"c":"verygood"},'
      +'{"p":5150,"c":"good"}]',
    amazon_lowest_at:new Date().toISOString(),
    sold_usd:null,warnings:[],notes:[],state:'ok'},x||{});
  syncData={at:new Date().toISOString(),counts:{},
    items:(o.items||[
      it('B075LC617B',{title:'マリオオデッセイ 箱付き中古'}),
      /* 1人だけの安値 → 下げを保留する行 */
      it('B0PX000002',{ebay_price:200,amazon_offers:1,
        amazon_offers_json:'[{"p":5000,"c":"good"}]'}),
      /* セール中の行 */
      it('B0PX000003',{ebay_sale:1}),
      /* 数量0の行 */
      it('B0PX000004',{ebay_qty:0}),
      /* 出品していない行 */
      it('B0PX000005',{ebay_item_id:''}),
      /* 再調達中でない（売値の見直しで出る）行 */
      it('B0PX000006',{restocking:0,mode:'',ebay_price:120,sold_usd:60})
    ]),
    hot_pricing:o.hot||null };
  csvList=[]; csvSaveList(); syncPick={};
  syncUndoList=[]; syncUndoSave(); syncUndoHide();
  switchTab('E'); roleCheck(); syncRender();
},o||{});

const btn=async(asin)=>await p.evaluate((a)=>{
  const el=document.querySelector('#syncList [data-spx="'+a+'|used"]');
  return el?{ txt:el.textContent, dis:el.disabled }:null; },asin);
const click=async(asin)=>{
  await p.evaluate((a)=>{
    document.querySelector('#syncList [data-spx="'+a+'|used"]').click(); },asin);
  await p.waitForTimeout(300);
};

console.log('=== ① 再調達中の行にボタンが出る ===');
await setup({});
await openCsvBoxes(p);
{
  const b=await btn('B075LC617B');
  console.log('   '+(b&&b.txt));
  ok(!!b,'★★★行にボタンが出る');
  ok(/この行の売値を直す/.test(b.txt),'★★★押せるボタンになっている');
  ok(/\$64\.96 → \$/.test(b.txt),'★★★いまの売値と直す先を出す');
}
{
  const t=await p.evaluate(()=>{
    const el=document.querySelector('#syncList [data-srow="B075LC617B|used"]');
    return el?el.innerText.replace(/\s+/g,' '):''; });
  ok(/再調達中の売値を更新|再調達中/.test(t),'★★行の案内も今までどおり出る');
}

console.log('\n=== ② 押すと確認してから送る ===');
{
  dlg=[];
  await click('B075LC617B');
  console.log('   '+(dlg[0]||'').replace(/\n/g,' / '));
  ok(dlg.length===1,'★★★確認を出す');
  ok(/eBay の売値を直します/.test(dlg[0]),'★★★何をするか書く');
  ok(/マリオオデッセイ 箱付き中古/.test(dlg[0]),'★★★どの商品かも書く');
  ok(/\$64\.96 → \$/.test(dlg[0]),'★★★いくらにするかも書く');
  ok(/最低売値より下げません/.test(dlg[0]),'★★★下限は守ると書く');
  const s=await p.evaluate(()=>JSON.parse(JSON.stringify(window.__sync)));
  console.log('   '+JSON.stringify(s));
  ok(s.length===1&&s[0].kind==='price-one','★★★kind:price-one を送る');
  ok(s[0].asin==='B075LC617B'&&s[0].cond==='used','★★★行だけを送る');
  ok(s[0].price===undefined&&s[0].to===undefined,
     '★★★売値は送らない（pj-sync が計算する）');
}
{
  const n=await p.evaluate(()=>($('syncFixNote').textContent||''));
  console.log('   '+n);
  ok(/\$64\.96 → \$55\.25 に直しました/.test(n),'★★★結果を出す');
  const px=await p.evaluate(()=>{
    const r=(syncData.items||[]).filter((x)=>x.asin==='B075LC617B')[0];
    return { px:r.ebay_price, rs:r.restock_price }; });
  ok(Math.abs(px.px-55.25)<0.01,
     '★★★行の売値もその場で新しくする（取り込み直しを待たせない）');
  ok(Math.abs(px.rs-55.25)<0.01,'★★再調達中の行は出し直した売値もそろえる');
}

console.log('\n=== ③ 取り消したら送らない ===');
{
  await setup({});
  await openCsvBoxes(p);
  cancel=true; dlg=[];
  await click('B075LC617B');
  cancel=false;
  const s=await p.evaluate(()=>JSON.parse(JSON.stringify(window.__sync)));
  ok(dlg.length===1&&s.length===0,'★★★確認で「いいえ」なら送らない');
}

console.log('\n=== ④ 下げを保留している行も、人が押せば下げられる ===');
{
  const b=await btn('B0PX000002');
  console.log('   '+(b&&b.txt));
  ok(!!b,'★★★保留の行にもボタンを出す');
  ok(/\$200\.00 → \$/.test(b.txt),'★★いまの売値から下げる形で出す');
  const t=await p.evaluate(()=>{
    const el=document.querySelector('#syncList [data-srow="B0PX000002|used"]');
    return el?el.innerText.replace(/\s+/g,' '):''; });
  ok(/下げを保留/.test(t),'★★自動では保留のままだと分かる');
}

console.log('\n=== ④の2 自動が見送る行にも出す（6.174）===');
/* v254 では、再調達中の行で「再調達中の売値の追従」が見送ると
   ボタンが消えていた。推奨売値が画面に出ているのに押せなかった
   （E-B075LC617B-U：無在庫・最安値が4日古い）。 */
{
  const old=new Date(Date.now()-96*3600000).toISOString();
  await setup({ items:null });
  await openCsvBoxes(p);
  const r=await p.evaluate((old)=>{
    const base=(syncData.items||[]).filter((x)=>x.asin==='B075LC617B')[0];
    const cases={
      drop:{ dropship:1 },
      oneoff:{ one_off:1 },
      oldlow:{ amazon_lowest_at:old },
      nolow:{ amazon_lowest_at:'' }
    };
    const out={};
    for(const k in cases){
      const row=Object.assign({},base,cases[k]);
      const rk=syncRkTargetOf(row);
      const t=syncPriceOneTarget(row);
      out[k]={ why:rk.why||'', btn:!!t, next:(t||{}).next||0,
               old:!!(t||{}).old, drop:!!(t||{}).drop,
               label:(t||{}).why||'' };
    }
    return out;
  },old);
  console.log('   '+JSON.stringify(r));
  ok(r.drop.btn,'★★★無在庫（dropship=1）の行にもボタンを出す');
  /* 7.132（v257）で無在庫も自動追従の対象になったので、
     この行のラベルは「自動では見送り」ではなく追従の目標になる。 */
  ok(/再調達中の売値/.test(r.drop.label),
     '★★★無在庫は自動でも追従するので、追従の目標を出す（7.132）');
  ok(r.drop.drop===true,'★★無在庫だと分かる印を返す');
  ok(r.oneoff.btn,'★★★一点物の行にもボタンを出す');
  ok(/一点物/.test(r.oneoff.label),'★★理由を添える');
  ok(r.oldlow.btn,'★★★最安値が4日古い行にもボタンを出す');
  ok(r.oldlow.old===true,'★★★「最安値が古い」の印を返す');
  ok(/最安値が古い/.test(r.oldlow.label),'★★理由を添える');
  ok(r.nolow.btn&&r.nolow.old===true,'★★★最安値が未取得の行にも出す');
  ok(r.drop.next>0&&r.oldlow.next>0,'★★どの場合も推奨売値を出す');
  /* ⚙「無在庫の行も追従する」をオフにすると、自動は見送るがボタンは出る。
     再調達中の印が付いている行は⚙に関わらず追従するので、
     ここは「再調達中ではない無在庫の行」で見る。 */
  const off=await p.evaluate(()=>{
    const base=(syncData.items||[]).filter((x)=>x.asin==='B075LC617B')[0];
    const row=Object.assign({},base,{ restocking:0, dropship:1,
      mode:'' });
    $('autoRkDrop').checked=false;
    const t=syncPriceOneTarget(row);
    const why=syncRkTargetOf(row).why||'';
    $('autoRkDrop').checked=true;
    return { btn:!!t, label:(t||{}).why||'', why:why };
  });
  console.log('   ⚙オフ: '+JSON.stringify(off));
  ok(off.btn,'★★★⚙をオフにしてもボタンは出る（人が直せる）');
  ok(off.label==='売値の見直し',
     '★★★オフの行は追従の対象外なので、ふつうの「売値の見直し」で出す');
  ok(/無在庫/.test(off.why)&&/オフ/.test(off.why),
     '★★★行の案内には「⚙がオフ」と理由が出る');
}
{
  /* ボタンの文と確認の文に「最安値が古い」が出る。 */
  const old=new Date(Date.now()-96*3600000).toISOString();
  await setup({ items:null });
  await openCsvBoxes(p);
  await p.evaluate((old)=>{
    syncData.items.forEach((x)=>{ if(x.asin==='B075LC617B')
      x.amazon_lowest_at=old; });
    syncRender();
  },old);
  const b=await btn('B075LC617B');
  console.log('   '+(b&&b.txt));
  ok(b&&/※最安値が古い/.test(b.txt),
     '★★★押す前にボタンに「最安値が古い」と出す');
  dlg=[];
  await click('B075LC617B');
  console.log('   '+(dlg[0]||'').replace(/\n/g,' / '));
  ok(/Amazon最安値が古い/.test(dlg[0]||''),'★★★確認にも注意を出す');
  ok(/最安値を今すぐ取り直す/.test(dlg[0]||''),
     '★★★先に取り直すよう案内する');
  const s=await p.evaluate(()=>JSON.parse(JSON.stringify(window.__sync)));
  ok(s.length===1&&s[0].kind==='price-one','★★それでも押せば送る');
}
{
  /* 無在庫の行は段取り D の注意も出す。 */
  await setup({ items:null });
  await openCsvBoxes(p);
  await p.evaluate(()=>{
    syncData.items.forEach((x)=>{ if(x.asin==='B075LC617B')x.dropship=1; });
    syncRender();
  });
  dlg=[];
  await click('B075LC617B');
  ok(/段取り D/.test(dlg[0]||''),
     '★★★無在庫の行は「段取り D で変わることがある」と出す');
}

console.log('\n=== ⑤ 触らない行にはボタンを出さない ===');
{
  ok(await btn('B0PX000003')===null,'★★★セール中の行には出さない');
  ok(await btn('B0PX000004')===null,'★★★数量0の行には出さない');
  ok(await btn('B0PX000005')===null,'★★★出品していない行には出さない');
}

console.log('\n=== ⑥ 再調達中でない行は「売値の見直し」で出す ===');
{
  const b=await btn('B0PX000006');
  const t=await p.evaluate(()=>syncPriceOneTarget(
    (syncData.items||[]).filter((x)=>x.asin==='B0PX000006')[0]));
  console.log('   '+JSON.stringify(t)+'／'+(b&&b.txt));
  if(t){
    ok(t.from==='rv','★★★再調達中でない行は「売値の見直し」の値を使う');
    ok(!!b,'★★ボタンも出る');
  }else{
    ok(true,'★（この行は見直しの対象外。しきい値の設定によります）');
    ok(b===null,'★★対象でなければボタンも出さない');
  }
}

console.log('\n=== ⑦ 直せなかったときは理由を出す ===');
{
  await setup({ reply:{ ok:false, why:'eBayのセール中です（印を立てました）' } });
  await openCsvBoxes(p);
  dlg=[];
  await click('B075LC617B');
  const n=await p.evaluate(()=>($('syncFixNote').textContent||''));
  console.log('   '+n);
  ok(/直せませんでした/.test(n)&&/セール中/.test(n),
     '★★★pj-sync が返した理由をそのまま出す');
  const b=await btn('B075LC617B');
  ok(b&&b.dis===false,'★★ボタンは押せる状態に戻す');
}

console.log('\n=== ⑧ 最低売値で止まったときもそう出す ===');
{
  await setup({ reply:{ ok:true, from:64.96, to:40, floor:40, under:true } });
  await openCsvBoxes(p);
  dlg=[];
  await click('B075LC617B');
  const n=await p.evaluate(()=>($('syncFixNote').textContent||''));
  console.log('   '+n);
  ok(/最低売値で止めました/.test(n),'★★★下限で止めたことを出す');
}

console.log('\n=== ⑨ 作業者のキーでは押しても送らない ===');
{
  await setup({ role:'staff' });
  await openCsvBoxes(p);
  const b=await btn('B075LC617B');
  if(b){
    dlg=[];
    await click('B075LC617B');
    const s=await p.evaluate(()=>JSON.parse(JSON.stringify(window.__sync)));
    ok(s.length===0,'★★★作業者のキーでは送らない');
  }else{
    ok(true,'★★★作業者にはボタン自体を出さない（cfgprice で隠れる）');
  }
}

console.log('\n=== ⑩ 帯：大事な行が24時間以上古いとき ===');
{
  await setup({ hot:{ at:new Date().toISOString(), picked:200, rows:60,
    left:140, max:60, wrote:60, pri:70, pri_rows:60, pri_old:70,
    pri_old_after:10 } });
  await openCsvBoxes(p);
  const t=await p.evaluate(()=>({
    show:getComputedStyle($('syncHotWarn')).display,
    txt:($('syncHotWarn').textContent||'').replace(/\s+/g,' ') }));
  console.log('   '+t.txt);
  ok(t.show!=='none','★★★帯を出す');
  ok(/再調達中・Amazon無在庫の行 10件/.test(t.txt),
     '★★★古いまま残った件数を出す');
  ok(/売値の追従が止まる/.test(t.txt),'★★★何が起きるかも書く');
  ok(/大事な行 70件のうち 60件/.test(t.txt),'★★大事な行の様子も出す');
}
{
  await setup({ hot:{ at:new Date().toISOString(), picked:50, rows:50,
    left:0, max:60, wrote:50, pri:10, pri_rows:10, pri_old:0,
    pri_old_after:0 } });
  await openCsvBoxes(p);
  const t=await p.evaluate(()=>getComputedStyle($('syncHotWarn')).display);
  ok(t==='none','★★★取り切れていて古い行も無ければ帯は出さない');
}
T.done();
})();
