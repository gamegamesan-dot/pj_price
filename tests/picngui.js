/* 画面：写真が使えなかった JAN を出品候補の後ろに回す（8.90）
   ① 候補一覧を読むとき、GET /mw/picng（記録の一覧）も読む
   ② 記録のある JAN は、相場で出品候補（ok）でも①②の先頭に来ない。
      「写真なし（7日間は後ろ）」の区分にして、②のあとに出す
   ③ 使える写真を控えてある行・7日を過ぎた記録は、元の区分のまま
   ④ 記録の一覧と件数を、出品候補の画面の上に出す
   ⑤ 「JAN:」だけで番号が無い行（MW に写真が無い）を POST /mw/picng で記録する
      （pj の候補にある JAN だけ。写真がもうある JAN は送らない）
   ⑥ 取り込んで使える写真が無ければ、その場で「後ろに回す」と言う */
const { harness, openCsvBoxes }=require('./lib');
const T=harness('画面：写真が使えなかった JAN（8.90）');
const ok=T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',async d=>{ await d.accept(); });

const J1='4902370550467', J2='4902370550474', J3='4580416924740', J4='4970381909444';
const R=(jan,o)=>Object.assign({ jan:jan, sha:'M200', idx:0, kishu:'NS', name:'商品'+jan.slice(-3),
  cond:'新品', wholesale:3000, stock:5, ship_days:0, ship_text:'即日出荷',
  mkt_n:12, mkt_n_new:8, mkt_low:75, mkt_low_any:40, mkt_ship:0, mkt_cur:'USD',
  mkt_url:'https://www.ebay.com/itm/1', mkt_no_ship:0, mkt_err:'',
  mkt_at:'2026-11-20T01:00:00Z', pics_ok:0 },o||{});
const ROWS=[R(J1),R(J2,{ pics_ok:2 }),
  R(J3,{ kishu:'figure', wholesale:16082, mkt_n:0, mkt_n_new:0, mkt_low:null,
         mkt_low_any:null, mkt_ship:null }),
  R(J4)];
const LIST={ ok:true, n:4, rows:ROWS, mkt:{ seen:4, hit:3, none:1, left:0, over:1.15 },
  last:{ at:'2026-11-22T00:00:00Z', at_jst:'2026-11-22 09:00' }, limit:500 };
const day=(d)=>new Date(Date.now()+d*86400000).toISOString();
const NG={ ok:true, days:7, n:4, rows:[
  { jan:J1, why:'small', long:480, n:2, name:'商品467', at:day(-1), at_jst:'11/21 09:00',
    until:day(6), until_jst:'11/28 09:00' },
  { jan:J2, why:'small', long:400, n:1, name:'商品474', at:day(-1), at_jst:'11/21 09:00',
    until:day(6), until_jst:'11/28 09:00' },
  { jan:J3, why:'none', long:0, n:0, name:'商品740', at:day(-2), at_jst:'11/20 09:00',
    until:day(5), until_jst:'11/27 09:00' },
  { jan:'4902370559999', why:'none', long:0, n:0, name:'', at:day(-8), at_jst:'11/14 09:00',
    until:day(-1), until_jst:'11/21 09:00' }] };

const setup=async(o)=>await p.evaluate((o)=>{
  $('fx').value='160'; $('baseProfit').value='1000'; $('linkRate').value='30';
  $('saleRate').value='15'; $('usTaxRate').value='8'; $('autoAdRate').value='6';
  $('fee').value='13.6'; $('intlFee').value='1.35'; $('feeTax').value='10';
  $('fixed').value='0.40'; $('pack').value='150'; $('shipCharge').value='15';
  $('targetMode').value='auto';
  $('syncWeightGame').value='150'; $('syncWeight').value='400';
  $('mwShipFee').value='176'; $('mwShipMax').value='4'; $('mwStockMin').value='2';
  $('mwKishu').value='NS,NS2,P5,P4,figure,b2cchara_figure';
  $('mwNewOnly').checked=true;
  $('syncApi').value='https://sync.example'; $('syncKey').value='k';
  $('csvImgBase').value='https://img.example'; $('csvImgToken').value='tok';
  const real=window.fetch;
  window.__q=[];
  window.fetch=async(u,i)=>{
    const url=String(u), m=String((i&&i.method)||'GET');
    const body=(i&&typeof i.body==='string')?JSON.parse(i.body):null;
    const res=(x)=>new Response(JSON.stringify(x),{status:200});
    if(/\/mw\/picng/.test(url)){
      window.__q.push({ u:'picng', m:m, b:body });
      if(m==='POST')return res({ ok:true, n:(body.jans||[]).length });
      return res(o.ng||{ ok:true, days:7, n:0, rows:[] });
    }
    if(/\/mw\/img/.test(url)){
      window.__q.push({ u:'img', b:body });
      if(m!=='POST')return res({ ok:true, rows:[] });
      return res(o.img||{ ok:true });
    }
    if(/\/mw\/list/.test(url)){ window.__q.push({ u:'list' }); return res(o.list); }
    if(/\/whoami/.test(url))return res({ok:true,role:'admin',staff_key_set:true});
    return res({ ok:true });
  };
  switchTab('D'); roleCheck(); csvRender();
},o||{});
const txt=async()=>(await p.evaluate(()=>$('csvMwList').textContent||'')).replace(/\s+/g,' ');

console.log('=== ① 候補一覧と一緒に記録を読む ===');
await setup({ list:LIST, ng:NG });
await openCsvBoxes(p);
await p.evaluate(()=>$('csvMwLoad').click());
await p.waitForTimeout(900);
{
  const q=await p.evaluate(()=>window.__q.map((x)=>x.u+':'+x.m));
  ok(q.indexOf('picng:GET')>=0,'★★★候補一覧を読むとき、記録（GET /mw/picng）も読む');
}

console.log('\n=== ② ③ 写真なしの区分（②のあと）===');
{
  const t=await txt();
  const html=await p.evaluate(()=>$('csvMwList').innerHTML);
  console.log('   '+t.slice(0,260));
  ok(/① 出品候補（相場の115%以内） 2件/.test(t),
     '★★★記録のある J1 は①から外れる（①は J2・J4 の2件）');
  ok(/② 相場なし（eBayに出品なし） 0件/.test(t)||!/② 相場なし（eBayに出品なし） 1件/.test(t),
     '★★★記録のある J3（相場なし）も②から外れる');
  ok(/写真なし（7日間は後ろ） 2件/.test(t),'★★★「写真なし（7日間は後ろ）」に J1・J3 の2件');
  const sect=await p.evaluate(()=>{ const s=$('mwPicNgSect'); return s?s.textContent:''; });
  ok(/商品467/.test(sect)&&/商品740/.test(sect)&&!/商品474/.test(sect),
     '★★★使える写真を控えてある J2 は、記録があっても元の区分のまま');
  ok(/長辺 480px（500px 未満）/.test(sect)&&/MW に写真がありません/.test(sect)&&/11\/28 09:00 まで/.test(sect),
     '★★行に理由と、いつまで後ろに回すかを出す');
  const iSect=html.indexOf('id="mwPicNgSect"');
  const i2=html.indexOf('② 相場なし');
  const i3=html.indexOf('③ 後回し');
  ok(iSect>0&&(i2<0||iSect>i2)&&(i3<0||iSect<i3),'★★★②のあと（③の前）に出す');
  const firstOk=await p.evaluate(()=>{
    const el=$('csvMwList'); const t=el.innerHTML; const a=t.indexOf('① 出品候補');
    const b=t.indexOf('id="mwPicNgSect"'); return t.slice(a,b); });
  ok(firstOk.indexOf('商品467')<0,'★★★記録のある JAN は①の先頭にも中にも来ない');
}

console.log('\n=== ④ 記録の一覧と件数 ===');
{
  const box=await p.evaluate(()=>({ t:($('mwPicNgBox')||{}).textContent||'',
    rows:Array.prototype.map.call(document.querySelectorAll('#mwPicNgBox [data-picng]'),
      (el)=>el.getAttribute('data-picng')) }));
  console.log('   '+box.t.replace(/\s+/g,' ').slice(0,200));
  ok(/写真が使えなかった JAN（7日間） 3件/.test(box.t),'★★★件数を出す（7日を過ぎた記録は数えない）');
  ok(box.rows.join()===[J1,J2,J3].join(),'★★★一覧に JAN ごとの行（期限切れは出さない）');
  ok(/商品467/.test(box.t)&&/11\/21 09:00/.test(box.t)&&/11\/28 09:00/.test(box.t),
     '★★商品名・記録した日・戻る日を出す');
  ok(/7日たつと記録を消して/.test(box.t),'★★7日で候補に戻ることを書く');
}

console.log('\n=== ⑤ 「JAN:」だけの行を記録する ===');
{
  const e=await p.evaluate((a)=>({
    a:mwPicEmptyOf(a[0]+':\n'+a[1]+':10921742.10921743\n'+a[2]+':#メーカー\n'+a[3]+'\n'),
    b:mwPicEmptyOf('JAN '+a[0]+': | '+a[1]+':') }),[J4,J1,J3,J2]);
  console.log('   読めた '+JSON.stringify(e));
  ok(e.a.join()===[J4,J3].join(),'★★★番号が無い「JAN:」だけを拾う（番号のある行・コロンの無い行は拾わない）');
  ok(e.b.join()===[J4,J1].join(),'★「|」区切りでも読む');
  await p.evaluate((a)=>{ window.__q=[];
    $('mwPicIn').value=a.join(':\n')+':\n4902370551234:\n';
    return mwPicPasteGo(); },[J4,J2,J1]);
  await p.waitForTimeout(500);
  const post=await p.evaluate(()=>(window.__q.filter((x)=>x.u==='picng'&&x.m==='POST')[0]||{}).b);
  console.log('   送った '+JSON.stringify(post));
  ok(post&&post.jans.indexOf(J4)>=0&&post.jans.indexOf(J1)>=0,
     '★★★候補の JAN（MW に写真が無い）を記録に送る');
  ok(post.jans.indexOf(J2)<0,'★★使える写真がもうある JAN は送らない');
  ok(post.jans.indexOf('4902370551234')<0,'★★★pj の候補に無い JAN は送らない');
  const q=await p.evaluate(()=>window.__q.map((x)=>x.u+':'+x.m));
  ok(q.lastIndexOf('picng:GET')>q.indexOf('picng:POST'),'★記録したあと一覧を読み直す');
}

console.log('\n=== ⑥ 取り込みで使える写真が無かった ===');
await setup({ list:LIST, ng:NG, img:{ ok:true, n:1, good:0, bad:1, min_long:500, max:12,
  pic_ng:'small', rows:[{ pos:0, mw_id:'10921743', w:400, h:300, long:400, ok:false,
    err:'長辺500px未満のため使えません', ct:'image/jpeg' }] } });
await p.evaluate((L)=>{ mwRows=L.rows; mwMkt=L.mkt; mwListRender(); },LIST);
await p.evaluate((j)=>{ window.__q=[]; $('mwImgIn_'+j).value='10921743'; mwImgTake(j); },J4);
await p.waitForTimeout(700);
{
  const t=await p.evaluate((j)=>({ out:($('mwImgOut_'+j)||{}).textContent||'',
    q:window.__q.map((x)=>x.u+':'+x.m) }),J4);
  console.log('   '+t.out.replace(/\s+/g,' ').slice(0,140));
  ok(/使える写真がありませんでした/.test(t.out)&&/7日間は出品候補の後ろに回します/.test(t.out),
     '★★★使える写真が無ければ、7日間は後ろに回すと言う');
  ok(t.q.indexOf('picng:GET')>=0,'★★記録の一覧を読み直す');
}
/* 記録が無ければ「写真なし」の区分は出ない。 */
await setup({ list:LIST, ng:{ ok:true, days:7, n:0, rows:[] } });
await p.evaluate((L)=>{ mwPicNg={}; mwPicNgList=[]; mwRows=L.rows; mwMkt=L.mkt; mwListRender(); },LIST);
{
  const t=await txt();
  ok(/① 出品候補（相場の115%以内） 3件/.test(t)&&!/写真なし（7日間は後ろ）/.test(t)
     &&/写真が使えなかった JAN（7日間） 0件/.test(t),'★★記録が無ければ今までどおり（件数は 0件）');
}

await T.done();
})();
