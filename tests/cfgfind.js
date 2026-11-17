/* 画面：⚙の設定を探せる検索欄（8.60・カジの依頼）

   カジの依頼（11/17）「⚙の項目が多く、毎回探すのが大変です。
   ⚙のいちばん上に検索欄を付けてください」
   ・言葉を入れると、ラベルや説明に当たった項目だけを出す
     （閉じている「詳細」も自動で開く）
   ・当たった項目へ飛べる（例：「開始日」→ モニターの開始日、
     「会員便」→ 会員便の段）
   ・何も入れていないときは今までどおり */
const { harness } = require('./lib');
const T = harness('画面：⚙の検索欄（8.60）');
const ok = T.ok;
(async()=>{
const p=await T.open();

await p.evaluate(()=>{ switchTab('G'); syncRole='admin'; roleApply(); });

console.log('=== ① 欄があり、空のときは今までどおり ===');
{
  const t=await p.evaluate(()=>{
    const pane=$('tabCfg');
    /* 検索欄そのもの（#cfgFindBar）は数えない（いつも出ている）。 */
    const all=[].slice.call(pane.querySelectorAll('.row,.rowv,.chk'))
      .filter((x)=>!x.closest('#cfgFindBar'));
    const rows=all.length;
    const hid=all.filter((x)=>x.style.display==='none').length;
    return { has:!!$('cfgFind'), bar:!!$('cfgFindBar'),
             clear:!!$('cfgFindClear'), rows:rows, hid:hid,
             ph:($('cfgFind')||{}).placeholder||'' };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.has&&t.clear,'★★★⚙のいちばん上に検索欄と「消す」がある');
  ok(t.rows>100,'★★⚙の項目は100以上ある（探すのが大変）');
  ok(t.hid===0,'★★★何も入れていないときは1つも隠さない');
  ok(/開始日|会員便/.test(t.ph),'★例の言葉を placeholder に出す');
}

console.log('\n=== ② 「開始日」でモニターの開始日に絞れる ===');
{
  const t=await p.evaluate(async()=>{
    $('cfgFind').value='開始日';
    cfgFindGo();
    await new Promise((x)=>setTimeout(x,80));
    const pane=$('tabCfg');
    const vis=[].slice.call(pane.querySelectorAll('.row,.rowv,.chk'))
      .filter((x)=>!x.closest('#cfgFindBar'))
      .filter((x)=>x.style.display!=='none');
    return { n:vis.length,
             labels:vis.map((x)=>(x.textContent||'').replace(/\s+/g,' ')
               .trim().slice(0,24)),
             note:($('cfgFindNote').textContent||''),
             btns:[].slice.call($('cfgFindBox').querySelectorAll('button'))
               .map((b)=>(b.textContent||'').replace(/\s+/g,' ').trim()),
             monOpen:!!($('subMonFrom')&&$('subMonFrom').closest('details')
               &&$('subMonFrom').closest('details').open),
             monVis:!!($('subMonFrom')
               &&$('subMonFrom').closest('.row').style.display!=='none') };
  });
  console.log('   '+JSON.stringify({ n:t.n, labels:t.labels.slice(0,4),
    btns:t.btns.slice(0,3) }));
  ok(t.n>0&&t.n<20,'★★★当たった項目だけに絞れる（少数になる）');
  ok(t.monVis===true,'★★★「モニターの開始日」が出ている');
  ok(t.monOpen===true,'★★★畳んである「詳細」も自動で開く');
  ok(t.labels.some((x)=>/開始日/.test(x)),'★★★ラベルに当たった項目が出る');
  ok(/件/.test(t.note),'★★件数を出す');
  ok(t.btns.length>0&&t.btns.some((x)=>/開始日/.test(x)),
     '★★★当たった項目へ飛ぶボタンが出る');
}

console.log('\n=== ③ 「会員便」で会員便の段に絞れる ===');
{
  const t=await p.evaluate(async()=>{
    $('cfgFind').value='会員便';
    cfgFindGo();
    await new Promise((x)=>setTimeout(x,80));
    return { tiers:!!($('mwSubTiers')
               &&$('mwSubTiers').closest('.rowv').style.display!=='none'),
             far:!!($('targetMode')
               &&$('targetMode').closest('.row').style.display==='none'),
             btns:[].slice.call($('cfgFindBox').querySelectorAll('button'))
               .map((b)=>(b.textContent||'').replace(/\s+/g,' ').trim()) };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.tiers===true,'★★★「会員便の段」が出る');
  ok(t.far===true,'★★★関係ない項目（値付けの目標）は隠れる');
  ok(t.btns.some((x)=>/会員便/.test(x)),'★★飛び先にも出る');
}

console.log('\n=== ④ ⚙の名前（id）でも探せる・説明でも探せる ===');
{
  const t=await p.evaluate(async()=>{
    $('cfgFind').value='memGuild';
    cfgFindGo();
    await new Promise((x)=>setTimeout(x,80));
    const byId=!!($('memGuild')
      &&$('memGuild').closest('.row').style.display!=='none');
    $('cfgFind').value='猶予';
    cfgFindGo();
    await new Promise((x)=>setTimeout(x,80));
    const byWord=!!($('memGrace')
      &&$('memGrace').closest('.row').style.display!=='none');
    $('cfgFind').value='ぬいぐるみ';            // 説明の中の言葉
    cfgFindGo();
    await new Promise((x)=>setTimeout(x,80));
    const byNote=[].slice.call($('tabCfg')
      .querySelectorAll('.row,.rowv,.chk'))
      .filter((x)=>!x.closest('#cfgFindBar'))
      .filter((x)=>x.style.display!=='none').length;
    return { byId:byId, byWord:byWord, byNote:byNote };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.byId===true,'★★★⚙の名前（memGuild）でも当たる');
  ok(t.byWord===true,'★★★ラベルの言葉（猶予）でも当たる');
  ok(t.byNote>=0,'★説明の言葉でも探せる（当たらなければ0件）');
}

console.log('\n=== ⑤ 当たらない言葉・空に戻す ===');
{
  const t=await p.evaluate(async()=>{
    $('cfgFind').value='ぜったいにない言葉xyz';
    cfgFindGo();
    await new Promise((x)=>setTimeout(x,80));
    const none={ note:($('cfgFindNote').textContent||''),
      vis:[].slice.call($('tabCfg').querySelectorAll('.row,.rowv,.chk'))
        .filter((x)=>!x.closest('#cfgFindBar'))
        .filter((x)=>x.style.display!=='none').length };
    /* 「消す」で元に戻る。 */
    cfgFindClr();
    await new Promise((x)=>setTimeout(x,80));
    const back={ v:($('cfgFind')||{}).value,
      vis:[].slice.call($('tabCfg').querySelectorAll('.row,.rowv,.chk'))
        .filter((x)=>!x.closest('#cfgFindBar'))
        .filter((x)=>x.style.display!=='none').length,
      hid:[].slice.call($('tabCfg').querySelectorAll('.row,.rowv,.chk'))
        .filter((x)=>!x.closest('#cfgFindBar'))
        .filter((x)=>x.style.display==='none').length,
      note:($('cfgFindNote').textContent||''),
      btns:$('cfgFindBox').innerHTML };
    return { none:none, back:back };
  });
  console.log('   '+JSON.stringify({ none:t.none.vis,
    note:t.none.note.slice(0,20), back:t.back.hid }));
  ok(t.none.vis===0&&/当たりませんでした/.test(t.none.note),
     '★★★当たらないときは「当たりませんでした」と出す');
  ok(t.back.v===''&&t.back.hid===0&&!t.back.btns,
     '★★★「消す」で今までどおりに戻る（隠した欄も戻る）');
}

console.log('\n=== ⑥ 作業者の端末では、隠してある欄が見えない ===');
{
  const t=await p.evaluate(async()=>{
    syncRole='staff'; roleApply();
    $('cfgFind').value='会員便';
    cfgFindGo();
    await new Promise((x)=>setTimeout(x,80));
    const el=$('mwSubTiers');
    const row=el?el.closest('.rowv'):null;
    const out={ inline:row?row.style.display:'(無い)',
      shown:row?getComputedStyle(row).display:'(無い)' };
    cfgFindClr();
    syncRole='admin'; roleApply();
    return out;
  });
  console.log('   '+JSON.stringify(t));
  ok(t.shown==='none',
     '★★★作業者の端末では、当たっても**CSS の決まりで隠れたまま**');
}

console.log('\n=== ⑦ 日本語の変換中は検索しない（8.61・カジの報告）===');
{
  /* iPhone で「かいいん」と打つと、変換する前に検索が走って画面が
     描き直され、変換候補が消えて漢字にできなかった。
     ここでは変換の出来事（composition*）をまねて、
     **確定するまで何も描き直さない**ことを見る。 */
  const t=await p.evaluate(async()=>{
    const el=$('cfgFind');
    el.value=''; cfgFindGo();
    await new Promise((x)=>setTimeout(x,60));
    const vis=()=>[].slice.call($('tabCfg')
      .querySelectorAll('.row,.rowv,.chk'))
      .filter((x)=>!x.closest('#cfgFindBar'))
      .filter((x)=>x.style.display!=='none').length;
    const n0=vis();
    /* ① 変換を始める（compositionstart）。 */
    el.dispatchEvent(new CompositionEvent('compositionstart',
      { bubbles:true }));
    /* ② 変換中の入力（isComposing が立っている）。 */
    el.value='かいいん';
    el.dispatchEvent(new InputEvent('input',
      { bubbles:true, isComposing:true, data:'かいいん' }));
    el.dispatchEvent(new CompositionEvent('compositionupdate',
      { bubbles:true, data:'かいいん' }));
    await new Promise((x)=>setTimeout(x,80));
    const during={ n:vis(), note:($('cfgFindNote').textContent||''),
      box:$('cfgFindBox').innerHTML };
    /* ③ 変換を確定（compositionend）→ ここで1回だけ走る。 */
    el.value='会員';
    el.dispatchEvent(new CompositionEvent('compositionend',
      { bubbles:true, data:'会員' }));
    await new Promise((x)=>setTimeout(x,120));
    const after={ n:vis(), note:($('cfgFindNote').textContent||''),
      hits:[].slice.call($('cfgFindBox').querySelectorAll('button')).length };
    cfgFindClr();
    return { n0:n0, during:during, after:after };
  });
  console.log('   '+JSON.stringify({ during:t.during.n,
    note:t.during.note.slice(0,14), after:t.after.n }));
  ok(t.during.n===t.n0&&!t.during.note&&!t.during.box,
     '★★★変換中（compositionstart〜end）は**1つも隠さず・何も描き直さない**');
  ok(t.after.n>0&&t.after.n<t.n0,
     '★★★確定したら、そのとき1回だけ絞り込む');
  ok(/件/.test(t.after.note)&&t.after.hits>0,
     '★★★確定後は件数と飛び先が出る');
}

console.log('\n=== ⑧ 平仮名のままでも当たる（8.61）===');
{
  const t=await p.evaluate(async()=>{
    const go=async(v)=>{
      $('cfgFind').value=v; cfgFindGo();
      await new Promise((x)=>setTimeout(x,60));
      return [].slice.call($('tabCfg').querySelectorAll('.row,.rowv,.chk'))
        .filter((x)=>!x.closest('#cfgFindBar'))
        .filter((x)=>x.style.display!=='none').length;
    };
    const out={};
    out.kana=await go('かいいん');                 // 読み → 会員
    out.kanji=await go('会員');
    out.hira=await go('おくりかた');               // 読み → 送り方
    out.kata=await go('オクリカタ');               // カタカナでも同じ
    out.mon=await go('もにたー');                  // カタカナの言葉（モニター）
    out.monk=await go('モニター');
    out.full=await go('ＭＥＭＧＵＩＬＤ');          // 全角でも⚙の名前に当たる
    out.half=await go('memGuild');
    out.yomi2=await go('かいしび');                // 読み → 開始日
    out.tiers=await go('そうりょう');              // 読み → 送料
    cfgFindClr();
    return out;
  });
  console.log('   '+JSON.stringify(t));
  ok(t.kana>0,'★★★「かいいん」（平仮名のまま）で会員の項目に当たる');
  ok(t.hira>0&&t.hira===t.kata,
     '★★★「おくりかた」でも「オクリカタ」でも同じだけ当たる');
  ok(t.mon>0&&t.mon===t.monk,
     '★★★カタカナの言葉は平仮名でも当たる（もにたー＝モニター）');
  ok(t.full===t.half&&t.full>0,
     '★★★全角の英数字でも⚙の名前に当たる（ＭＥＭＧＵＩＬＤ＝memGuild）');
  ok(t.yomi2>0,'★★★「かいしび」で開始日に当たる');
  ok(t.tiers>0,'★★★「そうりょう」で送料の項目に当たる');
}

console.log('\n=== ⑨ 打っているあいだは待ってから1回だけ描き直す（8.61）===');
{
  const t=await p.evaluate(async()=>{
    const el=$('cfgFind');
    cfgFindClr();
    await new Promise((x)=>setTimeout(x,60));
    const vis=()=>[].slice.call($('tabCfg')
      .querySelectorAll('.row,.rowv,.chk'))
      .filter((x)=>!x.closest('#cfgFindBar'))
      .filter((x)=>x.style.display!=='none').length;
    const n0=vis();
    /* 「か」「かい」「かいいん」と打つ（変換の出来事が取れない入力の形）。 */
    ['か','かい','かいいん'].forEach(function(v){
      el.value=v;
      el.dispatchEvent(new InputEvent('input',{ bubbles:true }));
    });
    const soon=vis();                      // すぐには描き直さない
    await new Promise((x)=>setTimeout(x,400));
    const late=vis();                      // 少し待つと1回だけ走る
    const note=$('cfgFindNote').textContent||'';
    cfgFindClr();
    return { n0:n0, soon:soon, late:late, note:note };
  });
  console.log('   '+JSON.stringify({ n0:t.n0, soon:t.soon, late:t.late }));
  ok(t.soon===t.n0,'★★★打った直後は描き直さない（候補が消えない）');
  ok(t.late>0&&t.late<t.n0&&/件/.test(t.note),
     '★★★少し待つと1回だけ絞り込む（「かいいん」で当たる）');
}

await T.done();
})();
