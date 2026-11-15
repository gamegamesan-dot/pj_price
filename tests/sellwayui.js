/* 画面：赤字にならない売値を売り方ごとに（8.37・カジの依頼・v296）
   ① ⚙に「売り方・手数料・送料・梱包材」の欄があり、既定が入っている
   ② ⚙を変えるとカードの売値が変わり、この端末に覚える
   ③ ⚙の値は pj-sync にも送る（Worker がカードを作るので要る）
   ④ #はじめに の文が売り方ごとの説明になり、変えると
      「貼り直しが要るもの」に出る */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：赤字にならない売値を売り方ごとに（8.37）');
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
    if(/\/settings/.test(url)){
      if(String((i||{}).method||'')==='POST')
        window.__q.push({ u:'settings', b:JSON.parse(String(b||'{}')) });
      return res({ ok:true, at:'', settings:{} });
    }
    if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, n:0, rows:[] });
    if(/\/sub\/plan/.test(url))return res({ ok:true, plans:[] });
    return res({ ok:true });
  };
  syncRole='admin'; roleApply();
});
await openCsvBoxes(p);

const ROW={ price:3645, amz_price:9000, fee_rate:0.088, fee_fba:410,
  fee_total:1200, rank:12000, rank_cat:'ゲーム', new_n:4, amz:0, size_g:110,
  kishu:'NS', gross:4155, amz_at:new Date().toISOString() };

console.log('=== ① ⚙の欄と既定 ===');
{
  const t=await p.evaluate(()=>({
    ids:['gdWays','gdFeeMercari','gdFeeYahoo','gdAmzClose','gdPack','gdFbaIn',
         'gdShipCp','gdShipLetter','gdShipCompact','gdShipBox60','gdShipBox80',
         'gdShipBox'].map((x)=>({ id:x, el:!!$(x), v:$(x)?$(x).value:'' })),
    mod:typeof PJ_SELLWAY!=='undefined',
    def:(typeof PJ_SELLWAY!=='undefined')
      ?PJ_SELLWAY.listOf(gdCfg()).map((x)=>x.key).join():'' }));
  console.log('   '+JSON.stringify(t.ids.map((x)=>x.id+'='+x.v)));
  ok(t.mod,'★★★shared/sellway.js を読み込んでいる');
  ok(t.ids.every((x)=>x.el),'★★★⚙に売り方・手数料・送料・梱包材の欄がある');
  ok(t.def==='amz_self,mercari,yahoo',
     '★★★既定は Amazon 自己配送・メルカリ・ヤフオク');
  const by={}; t.ids.forEach((x)=>{ by[x.id]=x.v; });
  ok(by.gdFeeMercari==='10'&&by.gdFeeYahoo==='10',
     '★★メルカリ・ヤフオクの手数料の既定は 10%');
  ok(+by.gdShipCp>0&&+by.gdShipBox>+by.gdShipCp,
     '★★送料は区分ごとに入っている（大きいほど高い）');
  ok(+by.gdPack>0&&+by.gdFbaIn>0,'★★梱包材と倉庫までの送料も⚙にある');
}

console.log('=== ② ⚙を変えるとカードの売値が変わる ===');
{
  const t=await p.evaluate((ROW)=>{
    const card=()=>{
      const e=PJ_SUBCARD.card(ROW,{ domain:'x.myshopify.com', maxQty:3,
        planKey:'premium', guide:gdCfg(), gameG:110 });
      return (e.fields.filter((f)=>f.name==='赤字にならない売値')[0]||{}).value
        ||'';
    };
    const before=card();
    $('gdFeeMercari').value='20'; $('gdShipCp').value='500';
    $('gdWays').value='amz_self,amz_fba,mercari';
    ['gdFeeMercari','gdShipCp','gdWays'].forEach((id)=>{
      $(id).dispatchEvent(new Event('input',{bubbles:true})); });
    const after=card();
    let kept='';
    try{ kept=String((JSON.parse(localStorage.getItem('pj:csvcfg:v1')||'{}')
      ||{}).gdShipCp||''); }catch(e){}
    $('gdFeeMercari').value='10'; $('gdShipCp').value='185'; $('gdWays').value='';
    ['gdFeeMercari','gdShipCp','gdWays'].forEach((id)=>{
      $(id).dispatchEvent(new Event('input',{bubbles:true})); });
    return { before:before, after:after, kept:kept, back:card() };
  },ROW);
  console.log('   前：'+t.before.replace(/\n/g,' ／ '));
  console.log('   後：'+t.after.replace(/\n/g,' ／ '));
  ok(/Amazon 自己配送/.test(t.before)&&/メルカリ/.test(t.before)
     &&/ヤフオク/.test(t.before),'★★★カードに売り方ごとの売値が出る');
  ok(/Amazon FBA/.test(t.after)&&!/ヤフオク/.test(t.after),
     '★★★⚙でどの売り方を出すか変えられる');
  ok(t.after!==t.before,'★★★⚙の手数料・送料を変えると売値も変わる');
  ok(t.kept==='500','★★★⚙はこの端末に覚える');
  ok(t.back===t.before,'★戻すと元の売値に戻る');
}

console.log('=== ③ pj-sync にも送る（Worker がカードを作る）===');
{
  const t=await p.evaluate(()=>{
    const keys=['gdWays','gdFeeMercari','gdFeeYahoo','gdAmzClose','gdPack',
                'gdFbaIn','gdShipCp','gdShipLetter','gdShipCompact',
                'gdShipBox60','gdShipBox80','gdShipBox'];
    return { adv:keys.filter((k)=>ADV_SUB.indexOf(k)<0),
             cfg:keys.filter((k)=>!(k in gdCfg())) };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.adv.length===0,'★★★⚙の値を pj-sync に送る一覧（ADV_SUB）に入っている');
  ok(t.cfg.length===0,'★★★gdCfg() が売り方の⚙もそのまま渡す');
}

console.log('=== ④ #はじめに の文 ===');
{
  const t=await p.evaluate(()=>{
    const list=gdPinList();
    const c=(list.filter((x)=>x.id==='common')[0]||{}).text||'';
    const line=c.split('\n').filter((x)=>/赤字にならない売値/.test(x))[0]||'';
    $('gdWays').value='amz_fba';
    $('gdWays').dispatchEvent(new Event('input',{bubbles:true}));
    const c2=(gdPinList().filter((x)=>x.id==='common')[0]||{}).text||'';
    $('gdWays').value='';
    $('gdWays').dispatchEvent(new Event('input',{bubbles:true}));
    return { line:line, same:PJ_SUBGUIDE.hashOf(c)===PJ_SUBGUIDE.hashOf(c2),
             line2:c2.split('\n').filter((x)=>/赤字にならない売値/.test(x))[0]
               ||'' };
  });
  console.log('   '+t.line);
  ok(/Amazon 自己配送/.test(t.line)&&/メルカリ/.test(t.line)
     &&/ヤフオク/.test(t.line),
     '★★★共通の文の説明も売り方ごとになる（カジの依頼5）');
  ok(/相場は見ていません/.test(t.line),
     '★★★メルカリ・ヤフオクの相場は見ていないと書く');
  ok(!t.same&&/Amazon FBA/.test(t.line2),
     '★★★⚙で売り方を変えると文も変わる（指紋も変わる）');
}

console.log('=== ⑤ 貼り直しが要ると分かる ===');
{
  const t=await p.evaluate(()=>{
    /* いまの文を「貼った」ことにしてから、⚙を変える。 */
    const now=gdPinList();
    now.forEach((x)=>gdPinSeenSet(x.id,PJ_SUBGUIDE.hashOf(x.text)));
    gdPinGo();
    const ok1=($('gdPinNote').textContent||'');
    /* 出す売り方を変えると、共通の文の説明も変わる＝貼り直しが要る。
       （送料の金額はカードに出るもので、共通の文には書かないので
       金額を変えても貼り直しは要らない。） */
    $('gdWays').value='amz_fba,mercari';
    $('gdWays').dispatchEvent(new Event('input',{bubbles:true}));
    gdPinGo();
    const ng=($('gdPinNote').textContent||'');
    $('gdWays').value='';
    $('gdWays').dispatchEvent(new Event('input',{bubbles:true}));
    return { ok1:ok1.replace(/\s+/g,' '), ng:ng.replace(/\s+/g,' ') };
  });
  console.log('   '+t.ng.slice(0,120));
  ok(/ぜんぶ貼ってあるものと同じ/.test(t.ok1),'★★貼ったあとは「同じ」と出る');
  ok(/貼り直しが要るもの/.test(t.ng)&&/共通/.test(t.ng),
     '★★★売り方を変えると「貼り直しが要るもの」に共通の文が出る（カジの依頼5）');
}

await T.done();
})();
