/* Worker：Discord の知らせを 1商品＝1つの埋め込みにする（7.125・【S】）

   Discord の決まり（公式の資料で確かめた・2026-11）
   ・1通に埋め込み（embed）は **10個まで**
   ・1通の埋め込みぜんぶ合わせて **6,000字まで**
   ・**ふつうの Webhook では「押せるボタン」は出せない**
     （`with_components` を付けても出せるのは押せないリンクボタンだけ。
       押したことはそのメッセージを持つアプリに届くので Webhook では受けられない）
     → JAN のコピーは**コードの書式**で出す（長押しでコピー）

   ほかに
   ・pj へのリンク（#tab=…）と「長押し →Safari で開く」は**出さない**
   ・項目の出し分け（社内用／会員用）は⚙ mwNtAudience で切り替える */
import { harness, loadWorker, makeEnv } from './lib.mjs';
const T=harness('Worker：知らせの埋め込み（7.125）');
const ok=T.ok;
const { T:W }=await loadWorker('ntembed');

let msgs=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  if(/discord/.test(url)){
    msgs.push(JSON.parse(String(o.body||'{}')));
    return new Response(null,{status:204});
  }
  return new Response('{}',{status:200});
};
const env=makeEnv();
const row=(x)=>Object.assign({ jan:'4902370550001', name:'ゼルダの伝説',
  sha:'いろは商会', kishu:'NS2', stock:9, wholesale:3160, hope:3226,
  asin:'B0TEST0001', amz_price:9000, fee_total:1500, gross:2024 },x||{});
const fieldOf=(e,n)=>((e.fields||[]).filter((f)=>f.name===n)[0]||{}).value;

console.log('=== 1商品＝1つの埋め込み（社内用）===');
{
  const e=W.mwNtEmbed(row(),'new','staff');
  console.log('   '+JSON.stringify(e).slice(0,420));
  ok(e.title==='ゼルダの伝説','★★★見出しは商品名');
  ok(e.url==='https://www.amazon.co.jp/s?k=4902370550001',
     '★★★見出しをタップすると Amazon の JAN 検索が開く');
  ok(e.color===W.EMB_COLOR['new'],'★★★区分で色を変える（新入荷＝緑）');
  /* JAN は**コードの書式で1行に単独**。 */
  const j=fieldOf(e,'JAN');
  console.log('   JAN の欄：'+JSON.stringify(j));
  ok(/^```\n4902370550001\n```$/.test(String(j)),
     '★★★JAN はコードの書式で1行に単独（長押しでコピーできる形）');
  ok((e.fields||[]).filter((f)=>f.name==='JAN')[0].inline===false,
     '★★JAN は1行を使う（横に並べない）');
  ok(fieldOf(e,'機種')==='NS2','★★★機種を出す');
  ok(/¥3,160/.test(String(fieldOf(e,'卸値'))),'★★★卸値を出す');
  ok(fieldOf(e,'社')==='いろは商会','★★★社を出す');
  ok(/9点/.test(String(fieldOf(e,'MW在庫'))),'★★★MW在庫を出す');
  const g=String(fieldOf(e,'見込み粗利'));
  console.log('   見込み粗利：'+JSON.stringify(g));
  ok(/¥2,024/.test(g),'★★★見込み粗利を出す');
  /* 7.137：実額のときは「Amazon ¥9,000 − 手数料」。 */
  ok(/Amazon ¥9,000 − 手数料/.test(g)&&!/手数料の目安/.test(g),
     '★★★出どころも出す（実額）');
  const lk=String(fieldOf(e,'リンク'));
  ok(/\[Amazon\]\(https:\/\/www\.amazon\.co\.jp\/dp\/B0TEST0001\)/.test(lk),
     '★★★下に Amazon のリンク（ASIN が分かれば商品のページ）');
  ok(/\[Keepa\]\(https:\/\/keepa\.com\/#!product\/5-B0TEST0001\)/.test(lk),
     '★★★下に Keepa のリンク（amazon.co.jp は 5）');
  ok((e.fields||[]).length<=25,'★欄は25個まで（Discord の決まり）');
}
{
  /* ASIN が分からない行は、どちらも JAN で探す形にする。 */
  const e=W.mwNtEmbed(row({ asin:'', amz_price:0, fee_total:0, gross:null }),
    'gone','staff');
  const lk=String(fieldOf(e,'リンク'));
  ok(/amazon\.co\.jp\/s\?k=4902370550001/.test(lk),
     '★★ASIN が無ければ Amazon は JAN の検索');
  ok(/keepa\.com\/#!search\/5-4902370550001/.test(lk),
     '★★ASIN が無ければ Keepa も JAN の検索');
  /* 7.137：Amazon の値段が無い行は、欄の名前も「（未確認）」で分け、
     「Amazon 未確認」と必ず書く（定価の目安は高く出すぎるため）。 */
  const h=String(fieldOf(e,'見込み粗利（未確認）'));
  ok(/¥3,226/.test(h)&&/定価からの目安/.test(h),
     '★★★Amazon の値段が無い行は「定価からの目安」と書く');
  ok(/Amazon 未確認/.test(h),'★★★「Amazon 未確認」と必ず書く');
  ok(!fieldOf(e,'見込み粗利'),'★★欄の名前も「（未確認）」で分ける');
}

console.log('\n=== 区分ごとの色 ===');
ok(W.EMB_COLOR['new']===0x2ecc71,'★★★新入荷＝緑');
ok(W.EMB_COLOR['gone']===0xe74c3c,'★★★欠品＝赤');
ok(W.EMB_COLOR['buy']===0xf1c40f,'★★★仕入れるの印の売り切れ＝黄');
ok(W.mwNtEmbed(row(),'gone','staff').color===0xe74c3c,'★赤になる');
ok(W.mwNtEmbed(row(),'buy','staff').color===0xf1c40f,'★黄になる');

console.log('\n=== 出し分け（社内用／会員用）===');
{
  const m=W.mwNtEmbed(row(),'new','member');
  const names=(m.fields||[]).map((f)=>f.name);
  console.log('   会員用の欄：'+names.join('／'));
  ok(W.NT_MEMBER_NG.every((n)=>names.indexOf(n)<0),
     '★★★会員用では 卸値・社・MW在庫・備考・画像 を出さない');
  ok(names.indexOf('販売価格')>=0&&/¥9,000/.test(String(fieldOf(m,'販売価格'))),
     '★★★会員用は販売価格を出す');
  ok(names.indexOf('見込みの Amazon 粗利')>=0
     &&/¥2,024/.test(String(fieldOf(m,'見込みの Amazon 粗利'))),
     '★★★会員用は見込みの Amazon 粗利を出す');
  ok(/9点/.test(String(fieldOf(m,'購入できる数'))),
     '★★★会員用は「購入できる数」を出す');
  ok(names.indexOf('JAN')>=0&&names.indexOf('機種')>=0
     &&names.indexOf('リンク')>=0,
     '★★JAN・機種・リンクはどちらでも出す');
  /* 中身にも卸値が漏れていないこと。 */
  const all=JSON.stringify(m);
  ok(all.indexOf('3,160')<0&&all.indexOf('いろは商会')<0,
     '★★★会員用の箱に卸値と社の値が1つも入っていない');
}
ok(W.mwNtAud({})==='staff','★★★既定は社内用');
ok(W.mwNtAud({ mwNtAudience:'member' })==='member','★★会員用に切り替えられる');
ok(W.mwNtAud({ mwNtAudience:'ほげ' })==='staff','★知らない値は社内用');

console.log('\n=== 1通10個まで・6,000字まで ===');
ok(W.EMB_MAX===10,'★★★1通に入れる埋め込みは10個まで');
ok(W.EMB_CHARS<6000,'★★★字数は 6,000 の手前で切る（'+W.EMB_CHARS+'字）');
{
  msgs=[];
  const list=[];
  for(let i=0;i<23;i++)
    list.push(W.mwNtEmbed(row({ jan:'490237055'+String(1000+i),
      name:'商品'+i }),'new','staff'));
  const n=await W.notifyEmbeds(env,W.newRun('t'),'先頭の文','見出し',list);
  const per=msgs.map((m)=>(m.embeds||[]).length);
  console.log('   '+n+'通　'+per.join('/')+'個');
  ok(n===3&&per.join(',')==='10,10,3','★★★10個ずつ3通に分ける');
  ok(msgs.every((m)=>(m.embeds||[]).length<=10),'★★★どの通も10個以内');
  ok(/先頭の文/.test(String(msgs[0].content||'')),'★★1通目に先頭の文を出す');
  ok(!/先頭の文/.test(String(msgs[1].content||'')),'★★2通目には出さない');
  ok(/見出し（1\/3通）/.test(String(msgs[0].content||''))
     &&/見出し（3\/3通）/.test(String(msgs[2].content||'')),
     '★★★毎通に見出しと「n/m通」を出す');
  /* どの通も字数が収まっている。 */
  const len=(m)=>(m.embeds||[]).reduce((a,e)=>a+W.mwNtEmbedLen(e),0);
  ok(msgs.every((m)=>len(m)<=6000),'★★★どの通も 6,000字に収まる');
}
{
  /* 1つが大きいときは、**個数が10に届かなくても**字数で分ける。 */
  msgs=[];
  const big=[];
  for(let i=0;i<6;i++)
    big.push({ title:'あ'.repeat(200), color:1,
      fields:[{ name:'x', value:'い'.repeat(900), inline:false }] });
  await W.notifyEmbeds(env,W.newRun('t'),'','見出し',big);
  const per=msgs.map((m)=>(m.embeds||[]).length);
  console.log('   '+msgs.length+'通　'+per.join('/')+'個　'
    +'1つ '+W.mwNtEmbedLen(big[0])+'字');
  ok(msgs.length>=2&&per.every((n)=>n<10),
     '★★★字数で先に分かれることもある（個数が10に届かなくても）');
  const len=(m)=>(m.embeds||[]).reduce((a,e)=>a+W.mwNtEmbedLen(e),0);
  ok(msgs.every((m)=>len(m)<=6000),'★★★それでも 6,000字に収まる');
  ok(msgs.reduce((a,m)=>a+(m.embeds||[]).length,0)===6,
     '★★1つも落とさない');
}
{
  /* 1件も無ければ送らない。 */
  msgs=[];
  const n=await W.notifyEmbeds(env,W.newRun('t'),'先頭','見出し',[]);
  ok(n===0&&!msgs.length,'★★1件も無ければ送らない');
}
{
  /* 文だけの知らせは今までどおり（embeds は付けない）。 */
  msgs=[];
  await W.notifyRaw(env,W.newRun('t'),'文だけ',null);
  ok(msgs.length===1&&!msgs[0].embeds&&/文だけ/.test(msgs[0].content),
     '★★★文だけの知らせは今までどおり');
  ok(/日本時間/.test(String(msgs[0].content||'')),'★時刻は日本時間で添える');
}

console.log('\n=== Discord の宛先は読み取りの見張りを通る ===');
ok((()=>{ try{ W.assertReadOnly('https://discord.com/api/webhooks/1/abc',
  'POST',{},false); return true; }catch(e){ return false; } })(),
  '★Discord への POST は許可表にある');

await T.done();
