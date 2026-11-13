/* 画面：会員向け配信の⚙が、入れたらすぐ保存される（8.16・【1】〜【4】）

   2026-11-13 の不具合（カジ・iPhone の Safari／ホーム画面の pj・管理者）
     ⚙「3. 仕入れ」→「会員向け Discord の配信」の「Shopify のドメイン」と
     「モニター：チャンネルID」に値を入れても、⚙ を閉じて開き直すと空に戻る。
     仕入れタブの「会員に配信する」も「⚙の Shopify のドメインが空です」
     「モニター チャンネルID なし」のまま。

   原因
     ① 配信の⚙（subDomain・subCh*・subN*・subQ*・subHour・subPre・subOn*）は
        **ADV のどのまとまりにも入っておらず、pj-sync に1つも送っていなかった**。
        Worker はこの設定を読んで動くので、pj-sync 側はずっと空＝
        仕入れタブの表示も直らない
     ② チェック欄（subOn・subPre・subOn*）を CSV_CFG_IDS に入れていた。
        この一覧は `.value` で控えるので 'on' という文字が入るだけで、
        開き直すと入／切が戻らなかった
     ③ 端末に保存できなかったとき（iPhone の保存の空きが足りないとき）に
        try/catch で**黙って捨てていた**

   直し
     ① ADV_SUB／ADV_SUBCHK を作って pj-sync に送る（advCsvCfg／advChecks）
     ② チェック欄は真偽値で控える（csvCfgChecks）
     ③ 保存できたか・できなかったかを**欄のそば**に出す
     ④ ドメインは https:// や末尾の / が付いていても受け付ける
     ⑤ 仕入れタブは「届いていない」と「まだ入れていない」を出し分ける */
const { harness } = require('./lib');
const T = harness('画面：会員向け配信の⚙がすぐ保存される（8.16）');
const ok = T.ok;
(async()=>{
const p=await T.open();

const CH='123456789012345678';
const setup=async()=>await p.evaluate(()=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  window.__post=[]; window.__srv={ at:'2026-11-13T00:00:00Z', settings:{} };
  const real=window.fetch;
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  window.fetch=async(u,i)=>{
    const url=String(u), op=i||{};
    if(/\/whoami/.test(url))
      return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url)){
      if(String(op.method||'')==='POST'){
        const b=JSON.parse(String(op.body||'{}'));
        window.__post.push(b);
        if(window.__srvFail)return new Response('{"ok":false}',{status:500});
        Object.assign(window.__srv.settings,b.settings||{});
        window.__srv.at=b.at||window.__srv.at;
        return res({ ok:true, at:window.__srv.at,
                     settings:window.__srv.settings });
      }
      return res({ ok:true, at:window.__srv.at,
                   settings:window.__srv.settings });
    }
    if(/\/mw\/sub/.test(url))return res({ ok:true, table_ok:true, n:0, rows:[] });
    if(/\/mw\/(amz|buy)/.test(url))return res({ ok:true, rows:[], n:0 });
    return real(u,i);
  };
  syncRole='admin'; roleApply();
});
await setup();

console.log('=== ① 配信の⚙が pj-sync に送られる（いちばんの原因）===');
{
  const t=await p.evaluate(()=>({
    sub:ADV_SUB.indexOf('subDomain')>=0&&ADV_SUB.indexOf('subChMonitor')>=0
        &&ADV_SUB.indexOf('subHour')>=0&&ADV_SUB.indexOf('subNMonitor')>=0
        &&ADV_SUB.indexOf('subQPremium')>=0,
    chk:ADV_SUBCHK.indexOf('subOn')>=0&&ADV_SUBCHK.indexOf('subPre')>=0
        &&ADV_SUBCHK.indexOf('subOnMonitor')>=0,
    inCsv:advCsvCfg().indexOf('subDomain')>=0,
    inChk:advChecks().indexOf('subPre')>=0,
    ship:advCsvCfg().indexOf('mwSubShip')>=0,
    /* チェック欄は .value の一覧から外す（'on' が入るだけだった）。 */
    notInIds:CSV_CFG_IDS.indexOf('subOn')<0&&CSV_CFG_IDS.indexOf('subPre')<0
             &&CSV_CFG_IDS.indexOf('subOnMonitor')<0 }));
  console.log('   '+JSON.stringify(t));
  ok(t.sub&&t.chk,'★★★配信の⚙をまとまり（ADV_SUB／ADV_SUBCHK）に入れた');
  ok(t.inCsv&&t.inChk,'★★★pj-sync に送る一覧（advCsvCfg／advChecks）に入る');
  ok(t.ship,'★★★会員価格の MW 送料（mwSubShip）も送る（Worker が読む）');
  ok(t.notInIds,'★★★チェック欄は .value の一覧から外した');
}

console.log('\n=== ② 入れたらすぐ pj-sync に送る（ドメイン・チャンネルID）===');
{
  const t=await p.evaluate(async(CH)=>{
    window.__post=[];
    $('subDomain').value='omakase-ship.myshopify.com';
    $('subDomain').dispatchEvent(new Event('input',{bubbles:true}));
    $('subChMonitor').value=CH;
    $('subChMonitor').dispatchEvent(new Event('input',{bubbles:true}));
    $('subHour').value='9';
    $('subHour').dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise((x)=>setTimeout(x,1500));
    return { n:window.__post.length, srv:window.__srv.settings,
             note:$('subCfgNote').textContent };
  },CH);
  console.log('   '+JSON.stringify(t));
  ok(t.n>=1,'★★★pj-sync に送る');
  ok(t.srv.subDomain==='omakase-ship.myshopify.com',
     '★★★ドメインが pj-sync に入る');
  ok(t.srv.subChMonitor===CH,'★★★チャンネルID が pj-sync に入る');
  ok(+t.srv.subHour===9,'★★配信の時刻も入る');
  ok(/pj-sync にも保存しました/.test(t.note),
     '★★★欄のそばに「pj-sync にも保存しました」と出す');
}

console.log('\n=== ③ チェック欄（配信を使う・予告・プランの入／切）===');
{
  const t=await p.evaluate(async()=>{
    window.__post=[];
    $('subOn').checked=true;
    $('subOn').dispatchEvent(new Event('change',{bubbles:true}));
    $('subPre').checked=false;
    $('subPre').dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise((x)=>setTimeout(x,1500));
    let o={}; try{ o=JSON.parse(localStorage.getItem(CSV_CFG_KEY)||'{}'); }catch(e){}
    return { srvOn:window.__srv.settings.subOn,
             srvPre:window.__srv.settings.subPre,
             locOn:o.subOn, locPre:o.subPre };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.srvOn===true&&t.srvPre===false,
     '★★★入／切が真偽値で pj-sync に入る（文字の on ではない）');
  ok(t.locOn===true&&t.locPre===false,'★★★端末にも真偽値で控える');
}

console.log('\n=== ④ 開き直しても残る（端末の控え）===');
{
  await p.reload({ waitUntil:'load' });
  await p.waitForTimeout(400);
  const t=await p.evaluate(()=>({
    dom:$('subDomain').value, ch:$('subChMonitor').value,
    hour:$('subHour').value, on:$('subOn').checked, pre:$('subPre').checked }));
  console.log('   '+JSON.stringify(t));
  ok(t.dom==='omakase-ship.myshopify.com','★★★ドメインが残る');
  ok(t.ch==='123456789012345678','★★★チャンネルID が残る');
  ok(t.hour==='9','★★配信の時刻も残る');
  ok(t.on===true,'★★★「配信を使う」の入が残る');
  ok(t.pre===false,'★★★「予告」の切が残る（ここが戻っていた）');
}
await setup();

console.log('\n=== ⑤ pj-sync に届かなかったら、黙らずに赤で出す ===');
{
  const t=await p.evaluate(async()=>{
    window.__srvFail=1;
    advSent={};                    // 差分の基準（送る中身があるように）
    $('subDomain').value='other.myshopify.com';
    $('subDomain').dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise((x)=>setTimeout(x,1500));
    window.__srvFail=0;
    const el=$('subCfgNote');
    return { note:el.textContent, color:el.style.color };
  });
  console.log('   '+JSON.stringify(t));
  ok(/pj-sync が受け取りませんでした|pj-sync に届きませんでした/.test(t.note),
     '★★★届かなかったことを出す');
  ok(/bad/.test(t.color),'★★★赤で出す');
}

console.log('\n=== ⑥ 端末に保存できないときも黙らない ===');
{
  const t=await p.evaluate(async()=>{
    const real=localStorage.setItem.bind(localStorage);
    localStorage.setItem=function(k){
      if(k===CSV_CFG_KEY)throw new Error('QuotaExceededError');
      return real.apply(localStorage,arguments);
    };
    $('subChLight').value='999888777666555444';
    $('subChLight').dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise((x)=>setTimeout(x,200));
    const el=$('subCfgNote');
    const out={ note:el.textContent, color:el.style.color, err:csvCfgErr };
    localStorage.setItem=real;
    return out;
  });
  console.log('   '+JSON.stringify(t));
  ok(/この端末に保存できませんでした/.test(t.note),
     '★★★端末に保存できなかったことを出す（try/catch で捨てない）');
  ok(/Quota/.test(String(t.err||'')),'★★理由も控える');
  ok(/bad/.test(t.color),'★赤で出す');
}

console.log('\n=== ⑦ ドメインは https:// や末尾の / が付いていても受け付ける ===');
{
  const t=await p.evaluate(async()=>{
    $('subDomain').value=' https://Omakase-Ship.myshopify.com/ ';
    $('subDomain').dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise((x)=>setTimeout(x,300));
    return { v:$('subDomain').value, srv:window.__srv.settings.subDomain };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.v==='omakase-ship.myshopify.com',
     '★★★欄の値を整える（https://・末尾の /・空白・大文字）');
}

console.log('\n=== ⑧ 仕入れタブ：届いていないのか、まだ入れていないのか ===');
{
  const t=await p.evaluate(()=>{
    /* ⚙には入っているが pj-sync は空、という状態。 */
    $('subDomain').value='omakase-ship.myshopify.com';
    $('subChMonitor').value='123456789012345678';
    subPlanData={ table_ok:true, rows:0, on:false, pre:true, skip:false,
      token:true, domain:'', hour:8,
      plans:[{ key:'monitor', name:'モニター', on:true, ch:'', items:[],
               add:0, edit:0, keep:0 }] };
    subBarRender();
    return $('subBar').textContent;
  });
  console.log('   '+t.replace(/\s+/g,' ').slice(0,200));
  ok(/ドメインが pj-sync に届いていません/.test(t),
     '★★★⚙に入っているのに届いていないときは、そう出す');
  ok(/チャンネルID が pj-sync に届いていません/.test(t),
     '★★★チャンネルID も同じように出す');
  const t2=await p.evaluate(()=>{
    $('subDomain').value=''; $('subChMonitor').value='';
    subBarRender();
    return $('subBar').textContent;
  });
  ok(/ドメインが空です/.test(t2)&&/チャンネルID なし/.test(t2),
     '★★まだ入れていないときは今までどおり「空です」「なし」');
}

console.log('\n=== ⑨ ⚙のほかの欄も残る（4）===');
{
  const t=await p.evaluate(async()=>{
    $('csvRevisePrice').checked=true;
    $('csvRevisePrice').dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise((x)=>setTimeout(x,200));
    let o={}; try{ o=JSON.parse(localStorage.getItem(CSV_CFG_KEY)||'{}'); }catch(e){}
    return o.csvRevisePrice;
  });
  ok(t===true,'★★★「数量更新CSVに売値も含める」も控える（戻っていた）');
  /* ⚙の中の値の欄が、ぜんぶどこかに控えられていること。 */
  const miss=await p.evaluate(()=>{
    const pane=document.getElementById('tabCfg');
    const known={};
    const add=(a)=>(a||[]).forEach((x)=>{ known[x]=1; });
    add(CSV_CFG_IDS); add(FIELDS); add(CHECKS); add(ADV_FIELDS); add(ADV_CALC);
    add(ADV_CHECK); add(ADV_AMZCHK); add(ADV_SUBCHK); add(advCsvCfg());
    /* その回だけの道具の欄（控える意味がないもの）。 */
    add(['spFx','spFeeSale','spFeeTxn','spFeeOther','spFeeTech','spSls',
         'mwFeeTestAsin','mwFeeTestPrice','mwFeeNgN','mwFeeWhyN','mwNtFind',
         'mwMoveJan','mwFixSku','mwFixPrice',
         'syncOnHand','csvPriceChangedOnly','csvBoCols','csvAutoParse',
         'mwNewOnly','mwNoteAll','csvShowNew','uiHideShopee','uiHideEbay',
         'csvRevisePrice']);
    return Array.prototype.slice.call(
      (pane||document).querySelectorAll('input[id],select[id],textarea[id]'))
      .filter((el)=>!known[el.id]&&el.type!=='file'&&el.type!=='button')
      .map((el)=>el.id);
  });
  console.log('   控えていない欄：'+JSON.stringify(miss));
  ok(miss.length===0,
     '★★★⚙の欄に「入れても消える」ものが残っていない'
     +(miss.length?('：'+miss.join('／')):''));
}
await T.done();
})();
