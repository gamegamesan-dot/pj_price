/* 画面：会員に配信する商品を海外向け（os-）にも出す（8.113・v364）
   ・刈取の行の「海外向けにも出す」の印（POST /mw/os）
   ・書き出すのは印があり、会員向けのカードを送ってから⚙の日数（既定7日）たった品だけ
   ・在庫＝MW の在庫 −（販売数の上限 − 会員がもう買った数）。0以下は出さない
   ・CSV はいまの os- と同じ形（Handle os-<JAN>・tags に export・member-list／grade- は付かない・値段は 8.94）
   ・出品リストには足さない（eBay に出さない） */
const { harness } = require('./lib');
const T = harness('画面：会員の品を海外向け（os-）にも出す（8.113）');
const ok = T.ok;
(async()=>{
const p=await T.open();
const ago=(d)=>new Date(Date.now()-d*86400000).toISOString();
await p.evaluate((A)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('csvTitleApi').value='https://title.example'; $('csvTitleKey').value='t';
  window.__post=[]; window.__dl=[];
  csvDownload=function(name,text){ window.__dl.push({name,text}); return true; };
  const res=(v)=>new Response(JSON.stringify(v),{status:200});
  const real=window.fetch;
  window.fetch=async(u,i)=>{ const url=String(u), o=i||{}; const body=o.body?JSON.parse(String(o.body)):null;
    if(/\/whoami/.test(url))return res({ ok:true, role:'admin', staff_key_set:true });
    if(/\/settings/.test(url))return res({ ok:true, at:'', settings:{} });
    if(/\/mw\/os$/.test(url)){ window.__post.push({ u:'os', body }); return res({ ok:true, n:1 }); }
    if(/\/mw\/img\?/.test(url))return res({ rows:[{ ok:1, url:'https://pj-img.example/mw/'+url.split('jan=')[1]+'-1.jpg', w:800, h:800 }] });
    if(/\/os\/put/.test(url)){ window.__post.push({ u:'osput', body }); return res({ ok:true }); }
    if(/\/figure-titles$|\/titles$/.test(url)){ window.__post.push({ u:'title', body });
      return res({ results:body.items.map(()=>({ status:'ok', english_name:'Super Game', candidates:[], note:'',
        fields:{ brand:'Nintendo', series:'Super Game', chara:'', item_name:'', item_type:'figure', origin:'Japan' } })) }); }
    if(/\/shop\/os\/jp/.test(url))return res({ ok:true, n:3, jp:1, not_jp:2, jp_handles:['os-4902370550901'], profiles:{}, prof_ok:false });
    return real(u,i); };
  switchTab('G'); syncRole='admin'; roleApply();
  const mk=(jan,o)=>Object.assign({ jan, name:'ゲーム'+jan.slice(-2), mw_name:'ゲーム'+jan.slice(-2), kishu:'NS',
    stock:20, wholesale:3000, asin:'B0TEST'+jan.slice(-4), size_g:120 },o||{});
  mwAmzRows=[ mk('4902370550901'), mk('4902370550902'), mk('4902370550903'), mk('4902370550904',{ stock:5 }),
              mk('4902370550905') ];
  mwSubMap={
    '4902370550901':{ on:1, max_qty:6, price:3645, os_on:1, posted_at:A.d9, sold:2 },   // 出す：20 −（6−2）＝16
    '4902370550902':{ on:1, max_qty:6, price:3645, os_on:1, posted_at:A.d2, sold:0 },   // 7日たっていない
    '4902370550903':{ on:1, max_qty:6, price:3645, os_on:1, posted_at:'', sold:0 },     // まだ配信していない
    '4902370550904':{ on:1, max_qty:6, price:3645, os_on:1, posted_at:A.d9, sold:0 },   // 5 − 6 ≦ 0
    '4902370550905':{ on:1, max_qty:6, price:3645, os_on:0, posted_at:A.d9, sold:0 } }; // 印なし
  csvList=[]; csvSaveList();
},{ d9:ago(9), d2:ago(2) });

console.log('=== ① 行の印・⚙ ===');
const a=await p.evaluate(()=>{ const h=mwSubLine(mwAmzRows[0]); const d=document.createElement('div'); d.innerHTML=h;
  return { chk:!!d.querySelector('#mwOsChk_4902370550901'), on:d.querySelector('#mwOsChk_4902370550901').checked,
    when:d.textContent, days:$('osSubDays').value, adv:ADV_SUB.indexOf('osSubDays')>=0 }; });
ok(a.chk&&a.on,'★★★刈取の行に「海外向けにも出す」の印');
ok(/海外向けに出せます/.test(a.when),'★配信から7日たった行は「海外向けに出せます」');
ok(a.days==='7'&&a.adv,'★★⚙「会員に配信してから◯日後」は既定7日・pj-sync に送る設定');
const tg=await p.evaluate(async()=>{ const d=document.createElement('div'); d.innerHTML=mwSubLine(mwAmzRows[4]); document.body.appendChild(d);
  const c=document.getElementById('mwOsChk_4902370550905'); c.checked=true; await mwOsToggle('4902370550905');
  return { post:window.__post.filter((x)=>x.u==='os').slice(-1)[0], map:mwSubMap['4902370550905'].os_on }; });
ok(tg.post&&tg.post.body.jan==='4902370550905'&&tg.post.body.on===1&&tg.map===1,'★★★印を付けると pj-sync に保存する（POST /mw/os）');
await p.evaluate(()=>{ mwSubMap['4902370550905'].os_on=0; });

console.log('\n=== ② 書き出す ===');
await p.evaluate(()=>mwOsCsvGo());
await p.waitForFunction(()=>window.__dl.length>0||/書き出せる品がありません|⚠/.test($('mwOsNote').textContent),null,{timeout:8000});
const b=await p.evaluate(()=>({ dl:window.__dl.slice(-1)[0], note:$('mwOsNote').textContent, list:csvList.length,
  put:window.__post.filter((x)=>x.u==='osput').slice(-1)[0] }));
const lines=(b.dl&&b.dl.text||'').trim().split(/\r?\n/);
const head=(lines[0]||'').split(',');
const row=(lines[1]||'');
console.log('   '+b.note);
console.log('   '+row.slice(0,220));
ok(!!b.dl&&lines.length===2,'★★★書き出すのは条件に合う1件だけ');
ok(/^os-4902370550901,/.test(row),'★★★Handle は os-<JAN>（いまの os- と同じ）');
const H=(k)=>{ const i=head.indexOf(k); return i; };
ok(H('Variant Inventory Qty')>=0&&/,16,/.test(row),'★★★在庫＝MW の在庫 −（上限 − 会員がもう買った数）＝ 20 −（6 − 2）＝ 16');
ok(/export/.test(row)&&!/member-list|grade-/.test(row),'★★★タグは export（会員の印は付かない）');
const px=await p.evaluate(()=>{ const w={ jan:'4902370550901', titleEn:'x', wholesale:3000, qty:1, pics:[{url:'u'}] };
  return OSS.priceOf(w,osOpt()); });
ok(row.indexOf(','+px+',')>=0,'★★★値段はいまの os- と同じ決め方（8.94・卸値（税込）＋目標利益＋決済手数料）＝ '+px+'円');
ok(!/amazon|ebay/i.test(row)&&/pj-img\.example\/mw\//.test(row),'★★出品文に Amazon・eBay の言葉は入らず、画像は MW の画像');
ok(/7日たっていません 1件/.test(b.note)&&/まだ会員に配信していません 1件/.test(b.note)&&/在庫が残りません 1件/.test(b.note),
   '★★★出さなかった品の理由（7日たっていない・まだ配信していない・会員の分を引くと在庫が残らない）');
ok(b.list===0,'★★★出品リストには足さない（eBay に出さない）');
ok(b.put&&b.put.body.items.length===1&&b.put.body.items[0].qty===16,'★★書き出した os- を pj-sync に控える（品切れの追従のため）');

console.log('\n=== ③ 出品リストに同じ JAN の MW の行があればそれを使う ===');
const c=await p.evaluate(async()=>{
  csvList=[{ id:'m1', src:'mw', buySource:'mw', jan:'4902370550901', asin:'', titleJa:'ゲーム01', titleEn:'Own Title From List Japan Import New',
    cat:'139973', catFixed:true, condId:1000, specs:{ platform:'Nintendo Switch' }, pics:[{url:'https://pj-img.example/own.jpg'}],
    qty:1, mwWholesale:3000, mwStock:20, dropship:true, itemId:'' }];
  window.__dl=[]; window.__post=[];
  await mwOsCsvGo();
  return { row:(window.__dl[0]||{}).text||'', title:window.__post.filter((x)=>x.u==='title').length, own:csvList[0].qty };
});
ok(/Own Title From List/.test(c.row)&&c.title===0,'★★出品リストの行の英題をそのまま使う（作り直さない）');
ok(c.own===1,'★出品リストの行は書き換えない（写しで作る）');

console.log('\n=== ④ (C) 日本で売られていないか ===');
const d=await p.evaluate(async()=>{ await mwOsJpGo(); return $('mwOsNote').textContent; });
ok(/日本のお客さんに出ている os- があります：1件/.test(d),'★★★日本に出ている os- があればそう出す');
T.done();
})();
