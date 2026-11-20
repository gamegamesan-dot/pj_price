/* 画面：横長の写真を正方形にする（8.78・カジの依頼）
   MW の画像には横長のもの（600×338）があり、eBay の一覧のサムネ（正方形の枠）で
   小さく見える。横÷縦が 1.2 を超える横長だけ、上下に白を足して正方形にする。
   ・長辺はそのまま（拡大・トリミングなし）。縦長・正方形はいまのまま
   ・取り込み（mwImgTake。まとめて貼る取り込みも同じ口を通る）で自動
   ・出品済みの行は「探す」→「写真を正方形にして Revise 用 CSV を書き出す」
     （CSV は ItemID と PicURL だけ。PicURL は eBay 保管（EPS）の URL） */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：横長の写真を正方形にする（8.78）');
const ok = T.ok;

(async()=>{
const p=await T.open();
let dlg=[];
p.on('dialog',async d=>{ dlg.push(d.message()); await d.accept(); });
await p.click('#tabD');
await openCsvBoxes(p);

/* 試験用の画像を作る道具（画面の中で）。色つきの絵を JPEG にする。 */
await p.evaluate(()=>{
  window.mkImg=function(w,h,color){
    return new Promise(function(res){
      var c=document.createElement('canvas'); c.width=w; c.height=h;
      var x=c.getContext('2d'); x.fillStyle=color||'#cc0000'; x.fillRect(0,0,w,h);
      c.toBlob(function(b){ res(b); },'image/jpeg',0.95);
    });
  };
  window.b64Of=function(blob){
    return blob.arrayBuffer().then(function(buf){
      var a=new Uint8Array(buf), s='';
      for(var i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);
      return btoa(s);
    });
  };
  /* Blob の縦横と、上端・真ん中・下端の色。 */
  window.look=function(blob){
    return createImageBitmap(blob).then(function(bm){
      var c=document.createElement('canvas'); c.width=bm.width; c.height=bm.height;
      var x=c.getContext('2d'); x.drawImage(bm,0,0);
      var px=function(yy){ var d=x.getImageData(Math.floor(bm.width/2),yy,1,1).data;
        return [d[0],d[1],d[2]]; };
      return { w:bm.width, h:bm.height, top:px(2), mid:px(Math.floor(bm.height/2)),
               bot:px(bm.height-3), type:blob.type };
    });
  };
});

console.log('=== ① 正方形にするかどうかの決まり ===');
const one=await p.evaluate(()=>({
  wide:picSqPlan(600,338), tall:picSqPlan(370,600), sq:picSqPlan(600,600),
  edge:picSqPlan(600,500), just:picSqPlan(601,500), bad:picSqPlan(0,0),
  text:picSqText(picSqPlan(600,338)), none:picSqText(picSqPlan(370,600)) }));
ok(one.wide.sq&&one.wide.side===600&&one.wide.y===131&&one.wide.x===0,
   '★★★600×338 は 600×600 にする（上下に 131px ずつ）');
ok(!one.tall.sq,'★★★縦長（370×600）は変えない');
ok(!one.sq.sq,'★★正方形は変えない');
ok(!one.edge.sq&&one.just.sq,'★★ちょうど 1.2 は変えない・1.2 を超えたら正方形にする');
ok(!one.bad.sq,'★大きさが分からないものは触らない');
ok(one.text==='正方形にしました（600×338 → 600×600）'&&one.none==='',
   '★★結果の文：'+one.text);

console.log('=== ② 実際の画像（canvas）===');
const two=await p.evaluate(async()=>{
  var wide=await mkImg(600,338,'#cc0000');
  var q=await picSqBlob(wide);
  var a=await look(q.blob);
  var tall=await mkImg(370,600,'#0000cc');
  var q2=await picSqBlob(tall);
  var sq=await mkImg(600,600,'#00aa00');
  var q3=await picSqBlob(sq);
  var junk=await picSqBlob(new Blob(['not an image'],{type:'image/jpeg'}));
  return { q:{ sq:q.sq, w:q.w, h:q.h, side:q.side }, a:a,
           tallSame:(q2.blob===tall)&&!q2.sq, tallWH:q2.w+'x'+q2.h,
           sqSame:(q3.blob===sq)&&!q3.sq,
           junk:{ sq:junk.sq, same:junk.blob.size===12, err:!!junk.err } };
});
ok(two.q.sq&&two.a.w===600&&two.a.h===600,
   '★★★600×338 の画像が 600×600 になる（'+two.a.w+'×'+two.a.h+'）');
const white=(c)=>c[0]>245&&c[1]>245&&c[2]>245;
const red=(c)=>c[0]>150&&c[1]<80&&c[2]<80;
ok(white(two.a.top)&&white(two.a.bot),'★★★上下は白（#FFFFFF）の帯');
ok(red(two.a.mid),'★★★真ん中は元の絵のまま（拡大・トリミングなし）');
ok(two.a.type==='image/jpeg','★JPEG で出す');
ok(two.tallSame&&two.tallWH==='370x600','★★★縦長（370×600）は元の画像のまま');
ok(two.sqSame,'★★正方形も元の画像のまま');
ok(!two.junk.sq&&two.junk.same&&two.junk.err,
   '★★読めない画像は元のまま返す（取り込みを止めない）');

console.log('=== ③ 写真の取り込み（mwImgTake）で自動で正方形にする ===');
const three=await p.evaluate(async()=>{
  var wide=await mkImg(600,338,'#cc0000'), tall=await mkImg(370,600,'#0000cc');
  var bW=await b64Of(wide), bT=await b64Of(tall);
  mwRows=[{ jan:'4582692253712', sha:'MC02', name:'Hunter x Hunter Nen x Impact',
            wholesale:5000, stock:5, ship_days:0, pics_ok:0, pics_n:0 }];
  mwAmzRows=[]; mwBuyRows=[];
  var ups=[], posts=[];
  var oldPost=mwPost, oldUp=csvPicUpload;
  mwPost=function(path,body){
    posts.push({ path:path, saved:body&&body.saved });
    if(body&&body.ids)
      return Promise.resolve({ ok:true, n:2, good:2, bad:0, rows:[
        { pos:0, mw_id:'10839628', ok:true, w:600, h:338, long:600, b64:bW, ct:'image/jpeg' },
        { pos:1, mw_id:'10839629', ok:true, w:370, h:600, long:600, b64:bT, ct:'image/jpeg' }] });
    return Promise.resolve({ ok:true, n:2 });
  };
  csvPicUpload=function(blob){
    return look(blob).then(function(a){
      ups.push(a.w+'x'+a.h);
      return { url:'https://img.test/i/20261120/0000000'+ups.length
        +'-2222-3333-4444-555555555555.jpg' };
    });
  };
  $('csvImgBase').value='https://img.test'; $('csvImgToken').value='T';
  var out={ innerHTML:'' };
  var z=await mwImgTake('4582692253712',['10839628','10839629'],out);
  mwPost=oldPost; csvPicUpload=oldUp;
  var live=(document.getElementById('mwImgOut_4582692253712')||{}).textContent||out.innerHTML;
  return { ups:ups.join(','), saved:z?z.saved.length:0, txt:live,
           okN:mwRows[0].pics_ok };
});
ok(three.ups==='600x600,370x600',
   '★★★上げる画像：横長は 600×600・縦長は 370×600 のまま（'+three.ups+'）');
ok(three.saved===2&&three.okN===2,'★★取り込みそのものは今までどおり（2枚・その場で写真あり）');
ok(/正方形にしました（600×338 → 600×600）/.test(three.txt),
   '★★★取り込みの結果の表に「正方形にしました（600×338 → 600×600）」と出す');
ok((three.txt.match(/正方形にしました/g)||[]).length===1,'★★縦長の行には出さない');

console.log('=== ④ 出品済みの行：横長を探す → Revise 用 CSV ===');
const four=await p.evaluate(async()=>{
  var wide=await mkImg(600,338,'#cc0000'), tall=await mkImg(370,600,'#0000cc');
  var U=function(n){ return 'https://img.test/i/20261101/'+n
    +'aaaaaaa-2222-3333-4444-555555555555.jpg'; };
  var src={}; src[U(1)]=wide; src[U(2)]=tall; src[U(3)]=tall;
  /* pj-img の写真を返す（取りに行かない）。 */
  var oldFetch=window.fetch;
  window.fetch=function(u){
    var b=src[String(u)];
    if(b)return Promise.resolve({ ok:true, status:200, blob:function(){ return Promise.resolve(b); } });
    return Promise.resolve({ ok:false, status:404, blob:function(){ return Promise.resolve(new Blob([])); } });
  };
  /* 縦横を見るところ（<img>）は、試験では同じ表から答える。 */
  var oldMeasure=picSqMeasure;
  picSqMeasure=function(u){
    var b=src[String(u)];
    if(!b)return Promise.resolve({ w:0, h:0, err:1 });
    return createImageBitmap(b).then(function(bm){ return { w:bm.width, h:bm.height }; });
  };
  var mk=function(id,item,pics){
    return { id:id, src:'mw', jan:'458269225371'+id, asin:'B0PIC0000'+id,
      titleJa:'テスト'+id, titleEn:'Test '+id, cat:'261055', catFixed:true, catDone:true,
      condId:1000, cost:1000, qty:1, weight:200, itemId:item,
      pics:pics.map(function(u){ return { url:u, key:u.split('/i/')[1] }; }),
      descHtml:'<p>d</p>', specs:{ origin:'China' }, buySource:'mw', dropship:true,
      zeroAct:'hold', price:30, titleStatus:'', titleCands:[], titleNote:'' };
  };
  csvList=[ mk('1','168874294220',[U(1),U(2)]),     // メインが横長
            mk('2','168874294221',[U(3)]),          // 縦長だけ
            mk('3','',[U(1)]) ];                    // まだ出品していない
  csvPick={}; csvSaveList(); csvRender();
  var o={ has:!!$('csvPicSqFind')&&!!$('csvPicSqRun'),
          adm:$('csvPicSqBox').className.indexOf('admcfg')>=0 };
  picSqFind();
  await new Promise(function(r){ setTimeout(r,400); });
  o.wide=[csvRowById('1').picWide,csvRowById('2').picWide,csvRowById('3').picWide];
  o.note1=$('csvPicSqNote').textContent;
  o.filter=CSV_FILTERS.filter(function(x){ return x.v==='picwide'; })
    .map(function(x){ return csvList.filter(x.f).map(function(r){ return r.id; }).join(','); })[0];
  /* 書き出し。写真の上げ直しと EPS への預けは差し替える。 */
  window.__dl=[];
  var oldDl=csvDownload, oldUp=csvPicUpload, oldPost=syncJsonPost, ups=[], eps=[];
  csvDownload=function(name,text){ window.__dl.push({ name:name, text:text }); return true; };
  csvPicUpload=function(blob){
    return look(blob).then(function(a){
      ups.push(a.w+'x'+a.h);
      return { url:'https://img.test/i/20261120/9999999'+ups.length
        +'-2222-3333-4444-555555555555.jpg' };
    });
  };
  syncJsonPost=function(path,body,onOk){
    eps.push({ path:path, url:body.url });
    onOk({ ok:true, eps_url:'https://i.ebayimg.com/images/g/x'+eps.length+'/s-l1600.jpg' });
  };
  syncRole='admin'; $('syncApi').value='https://sync.test'; $('syncKey').value='K';
  $('csvImgBase').value='https://img.test'; $('csvImgToken').value='T';
  picSqRun();
  await new Promise(function(r){ setTimeout(r,600); });
  csvDownload=oldDl; csvPicUpload=oldUp; syncJsonPost=oldPost;
  window.fetch=oldFetch; picSqMeasure=oldMeasure;
  var f=window.__dl[0]||{ name:'', text:'' };
  var lines=f.text.split('\r\n').filter(Boolean);
  o.name=f.name; o.lines=lines; o.ups=ups.join(',');
  o.eps=eps.map(function(x){ return x.path+' '+(/20261120\/9999999/.test(x.url)?'new':'old'); });
  var r1=csvRowById('1');
  o.pics1=r1.pics.map(function(x){ return /20261120/.test(x.url)?'new':'old'; }).join(',');
  o.key1=r1.pics[0].key;
  o.orig=(r1.picsOrig||[]).length; o.wideAfter=r1.picWide; o.sqAt=!!r1.picSqAt;
  o.note2=$('csvPicSqNote').textContent;
  return o;
});
ok(four.has&&four.adm,'★ボタンがある（管理者だけに出す）');
ok(four.wide[0]===1&&four.wide[1]===0&&four.wide[2]===undefined,
   '★★★出品済みの行の写真を調べ、横長の枚数を控える（まだ出していない行は見ない）');
ok(/横長の写真がある出品 1件/.test(four.note1),'★★件数を出す：'+four.note1.slice(0,60));
ok(four.filter==='1','★★★絞り込み「写真が横長の出品」で選べる');
ok(dlg.some((m)=>/ItemID と PicURL だけ/.test(m)),'★★書き出す前に確認を出す');
ok(/^ebay-pic-revise-\d{8}-1\.csv$/.test(four.name),'★ファイル名：'+four.name);
ok(four.lines.length===3&&/^Info,/.test(four.lines[0]),'★File Exchange の形（Info 行＋見出し＋1件）');
ok(/^\*Action\([^)]*\),ItemID,PicURL$/.test(four.lines[1]),
   '★★★列は Action・ItemID・PicURL だけ：'+four.lines[1].replace(/\(.*\)/,'(…)'));
ok(/^Revise,168874294220,https:\/\/i\.ebayimg\.com\/[^,|]+\|https:\/\/i\.ebayimg\.com\/[^,|]+$/
   .test(four.lines[2]),
   '★★★ItemID 168874294220 の写真を差し替える行（PicURL は EPS の URL・2枚）');
ok(!/img\.test/.test(four.lines[2]),'★★★PicURL に pj-img の URL を入れない（EPS の URL だけ）');
ok(four.ups==='600x600','★★★上げ直すのは横長の1枚だけ（600×600）。縦長は上げ直さない');
ok(four.eps.join('|')==='/eps/test new|/eps/test old',
   '★★ぜんぶの写真を eBay に預ける（正方形にした1枚＋そのままの1枚）');
ok(four.pics1==='new,old'&&four.orig===2&&four.wideAfter===0&&four.sqAt
   &&/^20261120\//.test(four.key1),
   '★★行の写真も正方形のほうに入れ替え、元の並びは控える');
ok(/書き出しました/.test(four.note2)&&/正方形にした写真 1枚/.test(four.note2),
   '★結果を出す：'+four.note2.slice(0,70));

console.log('=== ⑤ 守ること ===');
const five=await p.evaluate(()=>{
  var src=picSqRun.toString()+picSqRowDo.toString()+picSqBlob.toString()
         +picSqFind.toString()+picSqCsv.toString();
  return { amz:/amazon/i.test(src), log:/console\.log/.test(src),
           hand:/picSq/.test((typeof csvPicsSend==='function')?csvPicsSend.toString():'') };
});
ok(!five.amz,'★★★Amazon の画像は使わない（MW の画像・行の写真だけ）');
ok(!five.log,'★★キーや URL をログに出さない');
ok(!five.hand,'★自分で撮った写真の取り込みには手を入れない');

await T.done();
})();
