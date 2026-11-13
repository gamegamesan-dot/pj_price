/* 画面：スマホの幅（375px）で操作欄が右にはみ出さない（6.192）

   カジ（iPhone・幅 375px）
     仕入れタブの「注文を取り込む」と「英題を入れる」が画面の右に
     はみ出していて、横にずらせず、文字が途中で切れている。

   原因
     ・どちらも「ファイルを選ぶ欄（flex:1）＋ボタン（flex:0 0 auto）」を
       横に並べていた。iPhone の「ファイルを選択」は幅が広いので、
       ボタンが押し出されていた
     ・⚙の <select> は**いちばん長い選択肢**の幅になるので、
       箱からあふれていた（自動値下げ・再調達・売値の自動反映・
       粗利の基準・自動の取り直し・列名の形）

   直し
     ・ファイルの行は**縦に積む**（.stackrow）。ボタンは全幅
     ・<select>・<input>・<button> は max-width:100%／min-width:0 で止める
     ・取り込みの結果は**ボタンのすぐ下**に目立つ箱（.okbox）で出す
   この版からは、**ぜんぶのタブを 375px で機械的に見張る**。 */
const { harness } = require('./lib');
const T = harness('画面：375px で右にはみ出さない（6.192）');
const ok = T.ok;
(async()=>{
const p=await T.open();
await p.setViewportSize({ width:375, height:800 });
/* 隠してあるタブ（Shopee・eBay）も見る。 */
await p.evaluate(()=>{
  try{ $('uiHideShopee').checked=false; $('uiHideEbay').checked=false;
       uiTabsApply(); }catch(e){}
});

const scan=async(tab)=>{
  await p.evaluate((t)=>{ try{ switchTab(t); }catch(e){}
    /* 説明や⚙の折りたたみも開いて、中の操作欄まで見る。 */
    document.querySelectorAll('details').forEach((d)=>{ d.open=true; });
  },tab);
  await p.waitForTimeout(220);
  return await p.evaluate((t)=>{
    const W=document.documentElement.clientWidth;
    const out=[];
    document.querySelectorAll('button,input,select,textarea').forEach((el)=>{
      const st=window.getComputedStyle(el);
      if(st.display==='none'||st.visibility==='hidden')return;
      const r=el.getBoundingClientRect();
      if(!r.width&&!r.height)return;
      if(r.right>W+0.6||r.left<-0.6)
        out.push({ tab:t, id:el.id||'', tag:el.tagName,
          txt:(el.textContent||el.value||'').trim().slice(0,20),
          right:Math.round(r.right), W:W });
    });
    return out;
  },tab);
};

console.log('=== ① ぜんぶのタブの操作欄が画面の中に収まる ===');
{
  const tabs=await p.evaluate(()=>Object.keys(TAB_OK||{}).concat(['G']));
  console.log('   見るタブ：'+tabs.join('・'));
  let bad=[];
  for(const t of tabs)bad=bad.concat(await scan(t));
  console.log('   はみ出し '+bad.length+'件'
    +(bad.length?('：'+bad.map((x)=>x.tab+' #'+(x.id||x.tag)+'「'+x.txt
      +'」right='+x.right+'>'+x.W).join('／')):''));
  ok(bad.length===0,
     '★★★375px でどのタブも操作欄が右にはみ出さない'
     +(bad.length?('：'+bad.slice(0,4).map((x)=>x.tab+' #'+(x.id||x.tag)
       +'「'+x.txt+'」').join('／')):''));
  ok(tabs.length>=6,'★タブをぜんぶ見ている（'+tabs.length+'つ）');
}

console.log('\n=== ② 画面が横に動かない（横スクロールが出ない）===');
{
  const t=await p.evaluate(()=>{
    const d=document.documentElement;
    return { sw:d.scrollWidth, cw:d.clientWidth, bw:document.body.scrollWidth };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.sw<=t.cw+1&&t.bw<=t.cw+1,'★★★ページが横に動かない');
}

console.log('\n=== ③ ファイルの行は縦に積んで、ボタンは全幅 ===');
await p.evaluate(()=>{ switchTab('F');
  document.querySelectorAll('details').forEach((d)=>{ d.open=true; }); });
await p.waitForTimeout(250);
{
  const t=await p.evaluate(()=>{
    const pick=(id)=>{
      const el=document.getElementById(id);
      if(!el)return null;
      const r=el.getBoundingClientRect();
      const box=el.parentNode;
      return { w:Math.round(r.width), right:Math.round(r.right),
        left:Math.round(r.left),
        col:window.getComputedStyle(box).flexDirection,
        boxw:Math.round(box.getBoundingClientRect().width) };
    };
    return { ord:pick('subOrdBtn'), ordF:pick('subOrdFile'),
             tr:pick('mwSubTrBtn'), trF:pick('mwSubTrFile'),
             W:document.documentElement.clientWidth };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.ord.col==='column'&&t.tr.col==='column',
     '★★★ファイルの行とボタンを縦に積む');
  ok(t.ord.w>=t.ord.boxw-2&&t.tr.w>=t.tr.boxw-2,
     '★★★ボタンは全幅（文字が切れない）');
  ok(t.ord.right<=t.W&&t.tr.right<=t.W,'★★★右にはみ出さない');
  ok(t.ordF.right<=t.W&&t.trF.right<=t.W,
     '★★「ファイルを選択」の欄も収まる');
  ok(t.ord.left>=0&&t.tr.left>=0,'★左にもはみ出さない');
}

console.log('\n=== ④ 取り込みの結果はボタンのすぐ下に目立つように ===');
{
  const t=await p.evaluate(()=>{
    const btn=document.getElementById('subOrdBtn');
    const note=document.getElementById('subOrdNote');
    /* 結果の見た目を確かめる（取り込みはしない）。 */
    subOrdSay('<b>✓ 3件を取り込みました</b>（二重 1件）'
      +'<br><b>残り数を書き換えたカード 2件</b>・完売にしたカード 1件'
      +'<br>会員の注文 <b>3点</b>','ok');
    const rb=btn.getBoundingClientRect(), rn=note.getBoundingClientRect();
    return { cls:note.className, below:rn.top>=rb.bottom-1,
      gap:Math.round(rn.top-rb.bottom), txt:note.textContent,
      bg:window.getComputedStyle(note).backgroundColor,
      bd:window.getComputedStyle(note).borderTopWidth,
      right:Math.round(rn.right), W:document.documentElement.clientWidth };
  });
  console.log('   '+JSON.stringify(t));
  ok(/okbox/.test(t.cls)&&/ok/.test(t.cls),'★★★目立つ箱（.okbox）で出す');
  ok(t.below&&t.gap<=14,'★★★ボタンのすぐ下に出る');
  ok(t.bd!=='0px','★★枠が付いている（note2 のままではない）');
  ok(/3件を取り込みました/.test(t.txt)&&/残り数を書き換えたカード 2件/.test(t.txt)
     &&/会員の注文 3点/.test(t.txt),
     '★★★何件取り込んだか・残り数をどう変えたかを出す');
  ok(t.right<=t.W,'★結果の箱も収まる');
  /* 失敗したときは赤。 */
  const t2=await p.evaluate(()=>{
    subOrdSay('⚠ 取り込めませんでした：だめでした','ng');
    const n=document.getElementById('subOrdNote');
    return { cls:n.className, bd:window.getComputedStyle(n).borderTopColor };
  });
  ok(/ng/.test(t2.cls),'★★失敗は赤い箱で出す');
}

console.log('\n=== ⑤ ⚙の長い選択肢（select）も収まる ===');
{
  const t=await p.evaluate(()=>{
    switchTab('G');
    document.querySelectorAll('details').forEach((d)=>{ d.open=true; });
    const W=document.documentElement.clientWidth;
    const out=[];
    ['autoMdMode','pbRestock','autoRvMode','mwProfitMode','mwAutoMode',
     'mwSubCols'].forEach((id)=>{
      const el=document.getElementById(id); if(!el)return;
      const r=el.getBoundingClientRect();
      out.push({ id:id, right:Math.round(r.right), w:Math.round(r.width) });
    });
    return { out:out, W:W };
  });
  console.log('   '+JSON.stringify(t));
  ok(t.out.length>=5,'★長い選択肢の欄を見ている');
  ok(t.out.every((x)=>x.right<=t.W+0.6),
     '★★★いちばん長い選択肢でも右にはみ出さない');
}
await T.done();
})();
