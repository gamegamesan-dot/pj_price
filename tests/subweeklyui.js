/* 画面：会員向けの自動配信を週に1回にする（8.107・v356）
   ⚙「配信の間隔」（毎日／毎週）・毎週の曜日（既定 火）と時刻（既定 12時）・
   毎日のときだけ時刻と「土日も配信する」を出す・pj-sync に送る設定の一覧に入る・
   「次の回」の欄に次に配信する日時を出す・既定は自動配信オフのまま。 */
const { harness }=require('./lib');
const T=harness('画面：自動配信を週に1回（8.107）');
const ok=T.ok;
(async()=>{
const p=await T.open();
const r=await p.evaluate(()=>{
  const o={};
  o.on=$('subAutoOn').checked;
  o.every=$('subAutoEvery').value; o.dow=$('subAutoWeekDow').value; o.hour=$('subAutoWeekHour').value;
  o.listA=ADV_SUB.indexOf('subAutoEvery')>=0&&ADV_SUB.indexOf('subAutoWeekDow')>=0&&ADV_SUB.indexOf('subAutoWeekHour')>=0;
  subAutoEveryUi();
  o.dayShow=$('subAutoDayBox').style.display!=='none'; o.weekHide=$('subAutoWeekBox').style.display==='none';
  $('subAutoEvery').value='week'; subAutoEveryUi();
  o.weekShow=$('subAutoWeekBox').style.display!=='none'; o.dayHide=$('subAutoDayBox').style.display==='none';
  o.wkLabel=/毎日のときだけ/.test($('subAutoWeekend').parentNode.textContent);
  /* 「次の回」の欄。 */
  subAxStat({ ok:true, on:false, every:'week', sched_text:'毎週 火曜 12時', next_text:'12/1（火）12:00',
    next_skip_week:false, hours:[12,20], hours_text:'12時・20時', weekend:true, max:20, shop:{}, bot:true, ops:true });
  o.stat=$('subAutoStat').textContent;
  subAxStat({ ok:true, on:true, every:'week', sched_text:'毎週 火曜 12時', next_text:'12/8（火）12:00',
    next_skip_week:true, last_post:'2026-12-01 10:00', hours:[], weekend:true, max:20, shop:{}, bot:true, ops:true });
  o.stat2=$('subAutoStat').textContent;
  $('subAutoEvery').value='day'; subAutoEveryUi();
  return o;
});
console.log('   '+r.stat.replace(/\s+/g,' ').slice(0,160));
ok(r.on===false,'★★★既定は自動配信オフのまま');
ok(r.every==='day'&&r.dow==='2'&&r.hour==='12','★★★配信の間隔の既定は「毎日」（今の動き）・毎週の既定は 火曜・12時');
ok(r.listA,'★★★間隔・曜日・時刻は pj-sync に送る設定に入る（pj-sync の値だけで動く）');
ok(r.dayShow&&r.weekHide&&r.weekShow&&r.dayHide,'★★毎日のときは時刻と土日、毎週のときは曜日と時刻を出す');
ok(r.wkLabel,'★「土日も配信する」は毎日のときだけ');
ok(/毎週 火曜 12時/.test(r.stat)&&/次に配信する日時：12\/1（火）12:00/.test(r.stat)&&!/配信する時刻がありません/.test(r.stat),
   '★★★「次の回」に配信の間隔と次に配信する日時（12/1（火）12:00）を出す');
ok(/12\/8（火）12:00/.test(r.stat2)&&/今週はもう配信してあるので次の週/.test(r.stat2),'★★その週に配信済みなら次の週と出す');
await T.done();
})();
