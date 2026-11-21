/* 画面：1点ものの写真を複数枚（8.87）

   カジの依頼（2026-11-22）
     1. 写真を複数枚（最大10枚）。一度に何枚でも選べる・選ぶたびに足す
     2. 小さな画像の一覧・×で削除・←→で並べ替え・1枚目がメインと分かる
     3. 登録済みの1点ものも「1点ものの一覧」から開いて直せる
     4. Shopify 用 CSV は Image Src／Image Position・Discord は1枚目だけ
     5. 縮めて保存・長辺 500px 未満は注意・横長は正方形（8.78 と同じ）
   守ること：写真を消しても、もう Shopify に出ている商品には自動で反映しない */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：1点ものの写真を複数枚（8.87）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });
await openCsvBoxes(p);

const IMG='https://pj-img.example.workers.dev';
const U=(n)=>IMG+'/i/20261122/'+String(n).padStart(8,'0')+'-0000-4000-8000-000000000000.jpg';
const ROW=(o)=>Object.assign({ one_id:1, handle:'one-1',
  name:'ガンダム RG νガンダム', real_jan:'', asin:'', cond:'中古',
  cond_note:'箱にスレ', cost:2000, price:4800, qty:1, sold:0, left:1,
  ship_kind:'box', note:'開封済み', pic:false, pic_n:0, pic_old:false, pics:[],
  pics_changed:false, pic_type:'', amz_price:9000, amz_fee:1200, gross:5800,
  basis:'カート', pre_at:'', open_at:'', loaded_at:'', put_at:'', off:0,
  at:'2026-11-14T00:00:00Z', at_jst:'11/14 09:00' },o||{});

const setup=async(o)=>await p.evaluate((o)=>{
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('csvImgBase').value=o.IMG; $('csvImgToken').value='tok';
  window.__q=[]; window.__dl=[]; window.__up=[]; window.__del=[];
  window.dl=(name,text)=>{ window.__dl.push({ name:name, text:text }); return true; };
  const real=window.__realFetch||window.fetch; window.__realFetch=real;
  let n=100;
  window.fetch=async(u,i)=>{
    const url=String(u), b=(i||{}).body, m=String((i||{}).method||'GET');
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(url.indexOf(o.IMG+'/upload')===0){
      if(o.upFail&&window.__up.length===o.upFail-1){ window.__up.push({ fail:1 });
        return new Response('{"error":"x"}',{status:500}); }
      /* 上がってきた写真の縦横を読む（縮めた・正方形にしたかを見る）。 */
      const bm=await createImageBitmap(b);
      n++;
      const key='20261122/'+String(n).padStart(8,'0');
      window.__up.push({ w:bm.width, h:bm.height, type:b.type, size:b.size, key:key });
      return res({ url:o.IMG+'/i/20261122/'+String(n).padStart(8,'0')
        +'-0000-4000-8000-000000000000.jpg', key:key });
    }
    if(url.indexOf(o.IMG+'/i/')===0&&m==='DELETE'){ window.__del.push(url); return res({ ok:true }); }
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    if(/\/one\/pic/.test(url))return res(o.old||{ ok:true, b64:'', type:'' });
    if(/\/one\/mark/.test(url)){ window.__q.push({ u:'mark', b:JSON.parse(String(b||'{}')) });
      return res({ ok:true, n:1 }); }
    if(/\/one/.test(url)&&m==='POST'){ window.__q.push({ u:'put', b:JSON.parse(String(b||'{}')) });
      return res({ ok:true, id:1, handle:'one-1' }); }
    if(/\/one/.test(url)){ window.__q.push({ u:'list' });
      return res({ ok:true, table_ok:true, n:(o.rows||[]).length, rows:o.rows||[],
        pre_grades:'premium', open_grades:'standard,premium', hours:24 }); }
    if(/\/settings/.test(url))return res({ok:true,at:'',settings:{}});
    return res({ ok:true });
  };
  syncRole='admin'; roleApply(); oneFormClear();
  /* 仕入れタブ（刈取）を出して、1点ものの囲みを開く（押せるように）。 */
  switchTab('F');
  let d=$('onePicBox');
  while(d){ if(d.tagName==='DETAILS')d.open=true; d=d.parentElement; }
},Object.assign({ IMG },o||{}));
/* 写真の File を作る（w×h・JPEG）。 */
const files=async(list)=>await p.evaluate(async(list)=>{
  const out=[];
  for(const [w,h,name] of list){
    const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
    const cx=cv.getContext('2d'); cx.fillStyle='#c33'; cx.fillRect(0,0,w,h);
    const blob=await new Promise((r)=>cv.toBlob(r,'image/jpeg',0.9));
    out.push(new File([blob],name||('p'+w+'x'+h+'.jpg'),{ type:'image/jpeg' }));
  }
  window.__files=out; return out.length;
},list);
const thumbs=async()=>await p.evaluate(()=>Array.prototype.map.call(
  document.querySelectorAll('#onePicBox [data-onepic]'),(d)=>({
    src:d.querySelector('img').getAttribute('src'), txt:d.textContent.replace(/\s+/g,' '),
    main:/1 メイン/.test(d.textContent), outline:d.style.outline })));

console.log('=== ① 写真の欄（一度に何枚でも・カメラと写真ライブラリ）===');
await setup();
{
  const t=await p.evaluate(()=>{ const f=$('onePicFile');
    return { multi:f.multiple, cap:f.hasAttribute('capture'), acc:f.accept,
             cnt:$('onePicCount').textContent, help:document.querySelector('[data-exp="oneBox"]').textContent }; });
  ok(t.multi&&!t.cap&&t.acc==='image/*',
     '★★★一度に何枚でも選べる（multiple）・カメラ固定にしない（スマホはカメラと写真ライブラリの両方）');
  ok(t.cnt==='0','★いまの枚数（0／10枚）');
  ok(/10枚まで/.test(t.help)&&/1枚目がメイン/.test(t.help)&&/実物の写真だけ/.test(t.help),
     '★★説明に 10枚・1枚目がメイン・実物の写真だけ と書いてある');
}

console.log('\n=== ② 足す（置き換えない）・縮める・正方形・小さい写真の注意 ===');
{
  await files([[3200,3200,'a.jpg'],[2400,1350,'wide.jpg'],[1200,1600,'b.jpg']]);
  /* 本物の「ファイルを選択」と同じように、input に入れて change を起こす。 */
  await p.evaluate(()=>{ const dt=new DataTransfer(); window.__files.forEach((f)=>dt.items.add(f));
    const el=$('onePicFile'); el.files=dt.files; el.dispatchEvent(new Event('change',{bubbles:true})); });
  await p.waitForFunction(()=>!onePicBusy&&onePics.length===3,null,{ timeout:20000 });
  const up=await p.evaluate(()=>window.__up.slice());
  console.log('   上げた写真 '+up.map((x)=>x.w+'×'+x.h).join('／'));
  ok(up.length===3&&up.every((x)=>x.type==='image/jpeg'),'★★★選んだ3枚を上げる（JPEG）');
  ok(up[0].w===1600&&up[0].h===1600,'★★★大きすぎる写真は長辺 1600px に縮める（今と同じ設定）');
  ok(up[1].w===1600&&up[1].h===1600,'★★★横長の写真は正方形にする（8.78 と同じ・1600×900 → 1600×1600）');
  ok(up[2].w===1200&&up[2].h===1600,'★★縦長・小さめの写真はそのまま');
  let t=await thumbs();
  ok(t.length===3&&t[0].main&&/2px solid/.test(t[0].outline)&&!t[1].main,
     '★★★小さな画像の一覧・1枚目に「1 メイン」の印');
  ok(await p.evaluate(()=>$('onePicCount').textContent)==='3','★枚数が 3 になる');
  /* 追加で選ぶと足す（置き換えない）。小さい写真は注意。 */
  await files([[400,300,'small.jpg']]);
  await p.evaluate(()=>onePicAdd(window.__files));
  t=await thumbs();
  const note=await p.evaluate(()=>$('onePicNote').textContent);
  console.log('   '+note.replace(/\s+/g,' ').slice(0,120));
  ok(t.length===4&&t[0].src===await p.evaluate(()=>onePics[0].url),
     '★★★追加で選んだときは、今ある写真に足す（置き換えない）');
  ok(/長辺 500px 未満の写真が 1枚あります/.test(note)&&/長辺 400px/.test(t[3].txt),
     '★★★長辺 500px 未満の写真は、付けるときに注意を出す（一覧にも出る）');
  ok(/1枚を足しました（いま 4／10枚）/.test(note),'★何枚足したか・いまの枚数');
}

console.log('\n=== ③ 並べ替え（←→）・削除（×）===');
{
  const before=await p.evaluate(()=>onePics.map((x)=>x.url));
  const sz=await p.evaluate(()=>{ const b=document.querySelector('[data-onepicdel="0"]').getBoundingClientRect();
    return { w:b.width, h:b.height, over:document.documentElement.scrollWidth>window.innerWidth }; });
  ok(sz.w>=34&&sz.h>=34,'★★スマホでも押しやすい大きさ（'+Math.round(sz.w)+'×'+Math.round(sz.h)+'px）');
  ok(!sz.over,'★★画面の幅からはみ出さない（横に動かない）');
  const dis=await p.evaluate(()=>[document.querySelector('[data-onepicmv="0:-1"]').disabled,
    document.querySelector('[data-onepicmv="3:1"]').disabled]);
  ok(dis[0]&&dis[1],'★先頭の「←」と最後の「→」は押せない');
  await p.click('[data-onepicmv="2:-1"]');
  await p.click('[data-onepicmv="1:-1"]');
  let now=await p.evaluate(()=>onePics.map((x)=>x.url));
  ok(now[0]===before[2]&&now[1]===before[0]&&now[2]===before[1]&&now[3]===before[3],
     '★★★「←」を押すと前へ（3枚目を2回押して1枚目＝メインにした）');
  ok((await thumbs())[0].main&&/メインにしました/.test(await p.evaluate(()=>$('onePicNote').textContent)),
     '★★新しい1枚目に「メイン」の印・メインにしたと出る');
  await p.click('[data-onepicmv="0:1"]');
  now=await p.evaluate(()=>onePics.map((x)=>x.url));
  ok(now[0]===before[0]&&now[1]===before[2],'★★「→」でうしろへ');
  const key3=await p.evaluate(()=>onePics[3].key);
  await p.click('[data-onepicdel="3"]');
  now=await p.evaluate(()=>onePics.map((x)=>x.url));
  const del=await p.evaluate(()=>window.__del.slice());
  ok(now.length===3&&now.indexOf(before[3])<0,'★★★「×」で1枚ずつ消せる');
  ok(del.length===1&&del[0].indexOf(key3)>0,'★★まだ保存していない写真は、画像サーバーからも消す');
}

console.log('\n=== 保存（並べた順に送る）===');
{
  await p.evaluate(()=>{ $('oneName').value='テストの1点もの'; $('onePrice').value='4800'; });
  const order=await p.evaluate(()=>onePics.map((x)=>x.url));
  await p.evaluate(()=>oneSaveGo());
  await p.waitForTimeout(400);
  const b=await p.evaluate(()=>(window.__q.filter((x)=>x.u==='put')[0]||{}).b||{});
  ok(Array.isArray(b.pics)&&b.pics.map((x)=>x.url).join()===order.join(),
     '★★★並べた順のまま送る（1枚目がメイン）');
  ok(b.pics.every((x)=>Object.keys(x).sort().join()==='h,key,url,w')&&b.pic===undefined,
     '★★送るのは URL・大きさだけ（写真そのものは送らない）');
  ok(await p.evaluate(()=>onePics.length===0&&$('onePicCount').textContent==='0'),
     '★保存したら欄が空になる');
}

console.log('\n=== 10枚まで ===');
{
  await setup();
  const l=[]; for(let i=0;i<12;i++)l.push([800,800,'p'+i+'.jpg']);
  await files(l);
  await p.evaluate(()=>onePicAdd(window.__files));
  const t=await p.evaluate(()=>({ n:onePics.length, up:window.__up.length,
    note:$('onePicNote').textContent }));
  ok(t.n===10&&t.up===10,'★★★10枚まで（11枚目からは上げない）');
  ok(/10枚を超える 2枚は足していません/.test(t.note),'★★足さなかった枚数を出す');
  await files([[800,800]]);
  await p.evaluate(()=>onePicAdd(window.__files));
  ok(/10枚までです/.test(await p.evaluate(()=>$('onePicNote').textContent))
     &&await p.evaluate(()=>window.__up.length)===10,'★★10枚あるときは、もう足さない');
  /* 上げられなかった写真。 */
  await setup({ upFail:2 });
  await files([[800,800],[800,800],[800,800]]);
  await p.evaluate(()=>onePicAdd(window.__files));
  ok(await p.evaluate(()=>onePics.length)===2
     &&/1枚は上げられませんでした/.test(await p.evaluate(()=>$('onePicNote').textContent)),
     '★★上げられなかった写真は数えない・知らせる');
  /* 画像サーバーの設定が無いとき。 */
  await setup();
  await p.evaluate(()=>{ $('csvImgBase').value=''; });
  await files([[800,800]]);
  await p.evaluate(()=>onePicAdd(window.__files));
  ok(await p.evaluate(()=>onePics.length)===0
     &&/画像サーバーURL/.test(await p.evaluate(()=>$('onePicNote').textContent)),
     '★画像サーバーの設定が無ければ、そう言う');
}

console.log('\n=== ④ 登録済みの1点ものを開いて直す ===');
{
  const rows=[ROW({ one_id:5, handle:'one-5', pic:true, pic_n:3, loaded_at:'2026-11-20T00:00:00Z',
    pics:[{ url:U(1), key:'k1', w:1600, h:1600 },{ url:U(2), key:'k2', w:1600, h:1600 },
          { url:U(3), key:'k3', w:400, h:300 }] }),
    ROW({ one_id:6, handle:'one-6', name:'前の形の品', pic:true, pic_n:1, pic_old:true, pics:[] })];
  await setup({ rows, old:{ ok:true, b64:'', type:'' } });
  await p.evaluate(()=>oneListGo());
  await p.waitForTimeout(300);
  const lst=await p.evaluate(()=>$('oneList').textContent.replace(/\s+/g,' '));
  ok(/写真 3枚/.test(lst)&&/直す・写真/.test(lst),'★★一覧に写真の枚数と「直す・写真」');
  await p.evaluate(()=>oneEdit(5));
  let t=await thumbs();
  const n=await p.evaluate(()=>$('oneNote2').textContent);
  ok(t.length===3&&t[0].src===U(1)&&t[0].main&&/長辺 400px/.test(t[2].txt),
     '★★★開くと、いまの写真が並ぶ（1枚目がメイン・小さい写真の印）');
  ok(/自動では変えません/.test(n),'★★読み込み済みの品は「Shopify の写真は自動では変えない」と出す');
  await files([[1000,1000]]);
  await p.evaluate(()=>onePicAdd(window.__files));
  await p.click('[data-onepicdel="0"]');
  await p.click('[data-onepicmv="2:-1"]');
  const del=await p.evaluate(()=>window.__del.slice());
  ok(del.length===0,'★★★保存してある写真を外しても、画像サーバーからは消さない');
  await p.evaluate(()=>oneSaveGo()); await p.waitForTimeout(400);
  const b=await p.evaluate(()=>(window.__q.filter((x)=>x.u==='put')[0]||{}).b||{});
  ok(b.id===5&&b.pics.length===3&&b.pics[0].url===U(2)&&b.pics[2].url===U(3)&&b.pics[1].url!==U(1),
     '★★★追加・削除・並べ替えが送られる（2枚目→メイン・新しい1枚・3枚目）');
  /* 写真に触らずに保存すると、写真は送らない（いまのまま）。 */
  await p.evaluate(()=>{ window.__q=[]; oneEdit(5); $('onePrice').value='5000'; return oneSaveGo(); });
  await p.waitForTimeout(400);
  const b2=await p.evaluate(()=>(window.__q.filter((x)=>x.u==='put')[0]||{}).b||{});
  ok(b2.price===5000&&b2.pics===undefined,'★★写真に触らなければ、写真の並びは送らない');
}

console.log('\n=== 前の形の写真（1枚）の品 ===');
{
  const rows=[ROW({ one_id:6, handle:'one-6', name:'前の形の品', pic:true, pic_n:1, pic_old:true, pics:[] })];
  const b64=await p.evaluate(async()=>{ const cv=document.createElement('canvas'); cv.width=900; cv.height=600;
    cv.getContext('2d').fillRect(0,0,900,600);
    return cv.toDataURL('image/jpeg',0.8).replace(/^data:[^;]*;base64,/,''); });
  await setup({ rows, old:{ ok:true, b64:b64, type:'image/jpeg' } });
  await p.evaluate(()=>oneListGo()); await p.waitForTimeout(200);
  await p.evaluate(()=>oneEdit(6)); await p.waitForTimeout(300);
  const t=await thumbs();
  ok(t.length===1&&/^data:image\/jpeg;base64,/.test(t[0].src)&&/前の写真/.test(t[0].txt)&&t[0].main,
     '★★★前の写真を読んで、1枚目（メイン）に出す');
  await files([[800,800]]);
  await p.evaluate(()=>onePicAdd(window.__files));
  await p.evaluate(()=>oneSaveGo()); await p.waitForTimeout(800);
  const b=await p.evaluate(()=>(window.__q.filter((x)=>x.u==='put')[0]||{}).b||{});
  const up=await p.evaluate(()=>window.__up.slice());
  ok(b.pics&&b.pics.length===2&&up.length===2&&up[1].w===900&&up[1].h===900,
     '★★★保存するとき、前の写真も画像サーバーに上げ直す（横長は正方形にして）');
  ok(b.pics.every((x)=>x.url.indexOf(IMG+'/i/')===0),'★送る並びは画像サーバーの URL だけ');
}

console.log('\n=== Shopify 用 CSV（まだの品は写真を入れる・読み込み済みは写真の列を出さない）===');
{
  const rows=[ROW({ one_id:1, handle:'one-1', pic:true, pic_n:2,
      pics:[{ url:U(1), w:1600, h:1600 },{ url:U(2), w:1600, h:1600 }] }),
    ROW({ one_id:2, handle:'one-2', name:'読み込み済み', loaded_at:'2026-11-20T00:00:00Z',
      pics_changed:true, pic:true, pic_n:1, pics:[{ url:U(3), w:1600, h:1600 }] }),
    ROW({ one_id:3, handle:'one-3', name:'全部外した', loaded_at:'2026-11-20T00:00:00Z',
      pics_changed:true, pics:[] })];
  await setup({ rows });
  await p.evaluate(()=>oneCsvGo()); await p.waitForTimeout(500);
  const t=await p.evaluate(()=>({ dl:window.__dl.slice(), note:$('oneNote2').textContent.replace(/\s+/g,' ') }));
  console.log('   '+t.dl.map((x)=>x.name).join('／'));
  ok(t.dl.length===2&&/-new\.csv$/.test(t.dl[0].name)&&/-loaded\.csv$/.test(t.dl[1].name),
     '★★★まだの品と、読み込み済みの品でファイルを分ける');
  const a=await p.evaluate((x)=>PJ_SHOPCSV.splitCsv(x),t.dl[0].text);
  const h=a[0];
  ok(a.length===3&&a[1][h.indexOf('Image Src')]===U(1)&&a[1][h.indexOf('Image Position')]==='1'
     &&a[2][h.indexOf('Handle')]==='one-1'&&a[2][h.indexOf('Image Src')]===U(2)
     &&a[2][h.indexOf('Image Position')]==='2',
     '★★★まだの品：2枚目は同じ Handle の行に Image Src と Image Position（1, 2）');
  ok(t.dl[1].text.indexOf('Image Src')<0&&/one-2/.test(t.dl[1].text),
     '★★★読み込み済みの品は写真の列を出さない（Shopify の写真はそのまま＝自動で反映しない）');
  ok(/写真 2枚を CSV に入れました/.test(t.note)&&/写真の列を入れていません/.test(t.note),
     '★★何をしたかを出す');
  /* 一覧の印。 */
  await p.evaluate(()=>oneListGo()); await p.waitForTimeout(300);
  ok(await p.evaluate(()=>document.querySelectorAll('[data-onepicchg]').length)===2,
     '★★★読み込んだあとに写真を変えた品に「写真を変えた（Shopify は前のまま）」');
  /* 写真の直しCSV は押したときだけ。 */
  await p.evaluate(()=>{ window.__dl=[]; window.__q=[]; return oneImgCsvGo(); });
  await p.waitForTimeout(500);
  const f=await p.evaluate(()=>({ dl:window.__dl.slice(), q:window.__q.slice(),
    note:$('oneNote2').textContent.replace(/\s+/g,' ') }));
  ok(f.dl.length===1&&f.dl[0].text==='Handle,Image Src,Image Position\none-2,'+U(3)+',1\n',
     '★★★写真の直しCSV：変えた品だけ・Handle と写真の列だけ');
  ok(/全部外した 1件/.test(f.note)&&/one-3/.test(f.note)&&f.dl[0].text.indexOf('one-3')<0,
     '★★写真を全部外した品は CSV に入れず、Shopify で消すように出す');
  const mk=f.q.filter((x)=>x.u==='mark')[0];
  ok(mk&&mk.b.pics_put===1&&JSON.stringify(mk.b.ids)==='[2]','★直しCSV を作った品に印を付ける');
}

console.log('\n=== 作業者は使えない・版 ===');
{
  await setup();
  await p.evaluate(()=>{ syncRole='staff'; roleApply(); window.__q=[]; return oneImgCsvGo(); });
  await p.waitForTimeout(200);
  ok(await p.evaluate(()=>window.__q.length)===0,'★★作業者のキーでは写真の直しCSV を作れない');
  const fs=require('fs'), path=require('path');
  const v=await p.evaluate(()=>APP_V);
  const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  ok(sw.indexOf("'pj-pricing-"+v+"'")>=0&&+v.slice(1)>=336,'★sw.js と APP_V がそろっている（'+v+'）');
}
await T.done();
})();
