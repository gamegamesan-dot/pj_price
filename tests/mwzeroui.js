/* 画面：⚙「欠品は取り込みのたびに eBay の数量を0にする」（8.97・v345）
   ・既定オン・pj-sync が読む設定として送る（端末をまたいで同じ）
   ・何をするか（1回 60件・3割かつ10件の歯止め・日次との違い）が書いてある */
const { harness }=require('./lib');
const T=harness('画面：欠品は取り込みのたびに数量0（8.97）');
const ok=T.ok;
(async()=>{
const p=await T.open();
const t=await p.evaluate(()=>{
  const el=$('mwZeroOnImport');
  const lab=(document.querySelector('label[for="mwZeroOnImport"]')||{}).textContent||'';
  const note=el?(el.parentNode.nextElementSibling||{}).textContent||'':'';
  return { has:!!el, on:!!(el&&el.checked), lab:lab, note:note,
    chk:csvCfgChecks().indexOf('mwZeroOnImport')>=0,
    adv:(typeof advCheckIds==='function'?advCheckIds():[]).indexOf('mwZeroOnImport')>=0
      ||ADV_AMZCHK.indexOf('mwZeroOnImport')>=0 };
});
console.log('   '+t.lab.slice(0,60));
ok(t.has&&t.on,'★★★⚙「欠品は取り込みのたびに eBay の数量を0にする」があり、既定オン');
ok(t.chk&&t.adv,'★★★この端末に控え、pj-sync にも送る（pj-sync が読む）');
ok(/日次/.test(t.lab)&&/値上げ・数量1に戻すのは今までどおり日次/.test(t.lab),'★★オフのとき・値上げと数量1は日次のままと書く');
ok(/60件/.test(t.note)&&/3割以上かつ10件以上/.test(t.note),'★★1回の上限と歯止めを書く');
await T.done();
})();
