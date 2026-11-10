/* Discord：ロールごとのテスト配信（8.9・【W】の1）
   ・送り先と件数は server.config.json の test.posts どおり
   ・出す項目は §8.2 の「会員用」だけ（卸値・社・MW在庫・備考・画像は出さない）
   ・先頭に「🧪 テスト配信」、色は本番と変える
   ・--dry-run は1件も送らない／--channel で1か所だけ／--delete で消せる
   ・ボットが書けないチャンネルは --dry-run でも先に出す */
import fs from "node:fs";
import path from "node:path";
import { harness, loadWorker } from "./lib.mjs";
import { permBits, INVITE_PERMS, PERM, errJa, canWriteCh }
  from "../discord/setup-discord.mjs";
import { post, planText, targets, plansOfChannel, qtyOfChannel, pickItems, testEmbed,
         splitEmbeds, sellPrice, memberGross, shipTier, shipJa, amzUrl,
         fetchRows, SAMPLE, MEMBER_NG, TEST_MARK, TEST_COLOR, TEST_HEAD,
         EMB_MAX, IDS_KEY }
  from "../discord/test-post.mjs";
const T=harness('Discord：ロールごとのテスト配信（8.9）');
const ok=T.ok;
const CFG=JSON.parse(fs.readFileSync(
  path.join(process.cwd(),'discord/server.config.json'),'utf8'));
const GUILD='999000111222333444';
const BOT='555000111';
const INV=permBits(INVITE_PERMS);

/* ---- 偽の Discord（チャンネルの権限を本当に見る）---- */
function fake(opt){
  const o=opt||{};
  const g={ roles:[{ id:GUILD, name:'@everyone', permissions:'0', position:0 }],
            channels:[], msgs:{}, calls:[], next:7000, botRoles:[] };
  const br={ id:String(g.next++), name:'配信ボット', managed:true,
             permissions:String(o.botPerms===undefined?INV:o.botPerms),
             position:9 };
  g.roles.push(br); g.botRoles=[br.id];
  /* 設計のチャンネルをぜんぶ作っておく（setup 済みのサーバーのつもり）。 */
  for(const cat of CFG.categories)for(const ch of cat.channels){
    const rows=[];
    /* 会員のリストは @everyone が書けない形（本番と同じ）。 */
    rows.push({ id:GUILD, type:0, allow:'0',
                deny:permBits(['SEND_MESSAGES']).toString() });
    if((o.noBot||[]).indexOf(ch.name)<0)
      rows.push({ id:br.id, type:0,
        allow:permBits(['VIEW_CHANNEL','SEND_MESSAGES','EMBED_LINKS',
                        'READ_MESSAGE_HISTORY']).toString(), deny:'0' });
    g.channels.push({ id:String(g.next++), name:ch.name, type:0,
                      permission_overwrites:rows });
  }
  const deny=(m,pth)=>{ throw new Error(errJa(m,pth,403,
    '{"message":"Missing Permissions","code":50013}')); };
  const api={
    calls:g.calls,
    roles:async()=>{ g.calls.push('GET roles');
      return g.roles.map((r)=>Object.assign({},r)); },
    channels:async()=>{ g.calls.push('GET channels');
      return g.channels.map((c)=>Object.assign({},c)); },
    me:async()=>({ id:BOT }),
    member:async()=>({ user:{ id:BOT }, roles:g.botRoles.slice() }),
    msgAdd:async(id,b)=>{ g.calls.push('POST msg');
      const c=g.channels.filter((x)=>x.id===String(id))[0];
      if(!c||!canWriteCh(c.permission_overwrites||[],g.botRoles,
          o.botPerms===undefined?INV:o.botPerms,GUILD,['EMBED_LINKS']))
        deny('POST','/channels/'+id+'/messages');
      const m={ id:String(g.next++), content:b.content, embeds:b.embeds };
      (g.msgs[id]=g.msgs[id]||[]).push(m); return m; },
    msgDel:async(ch,id)=>{ g.calls.push('DELETE msg '+id);
      if((o.delFail||[]).indexOf(String(id))>=0)
        deny('DELETE','/channels/'+ch+'/messages/'+id);
      if((o.delGone||[]).indexOf(String(id))>=0)
        throw new Error(errJa('DELETE','/channels/'+ch+'/messages/'+id,404,
          '{"message":"Unknown Message","code":10008}'));
      g.msgs[ch]=(g.msgs[ch]||[]).filter((m)=>m.id!==String(id)); return null; },
  };
  return { g, api };
}
const chId=(f,name)=>(f.g.channels.filter((c)=>c.name===name)[0]||{}).id;
const run=(f,o)=>post(Object.assign({ config:CFG, api:f.api, guild:GUILD,
  log:()=>{} },o||{}));
const man=(p,k)=>(p.manual||[]).filter((x)=>!k||x.kind===k);
const sendOf=(p,name)=>(p.sends||[]).filter((x)=>x.name===name)[0]||null;

console.log('=== 設計：送り先と件数（server.config.json の test）===');
const tg=targets(CFG,{});
console.log('   '+tg.map((x)=>x.name+' '+x.n+'件').join('／'));
ok(tg.length===5,'★★★送り先は5か所');
const n=(nm)=>(tg.filter((x)=>x.name===nm)[0]||{}).n;
ok(n('リスト-ライト')===3&&n('リスト-スタンダード')===5
   &&n('リスト-プレミアム')===8,'★★★3件・5件・8件');
ok(n('目玉商品-先行')===1&&n('目玉商品')===1,'★★目玉商品は1件');
const q=(nm)=>(tg.filter((x)=>x.name===nm)[0]||{}).maxQty;
ok(q('リスト-ライト')===2&&q('リスト-スタンダード')===5
   &&q('リスト-プレミアム')===10,
   '★★★購入できる数はプランの表（max_qty）から出す');
ok(q('目玉商品')===0,
   '★★★全員が見るチャンネルはプランごとに数が違うので「お一人n点」を出さない');
ok(qtyOfChannel(CFG,{ view:['standard','monitor'] })===5,
   '★★★スタンダードとモニターはどちらも5点なので出す');
ok(qtyOfChannel(CFG,{ view:['light','premium'] })===0,
   '★★数が違う組み合わせは出さない');
ok(plansOfChannel(CFG,{ view:['@members'] }).length===4,
   '★@members はプラン4つに当たる');
ok(targets(CFG,{ channel:'リスト-ライト' }).length===1,
   '★★★--channel で1か所だけにできる');
ok(targets(CFG,{ channel:'list-premium' }).length===1,'★★key でも指せる');
ok(targets(CFG,{ channel:'#目玉商品' }).length===1,'★# つきでも指せる');
ok(targets(CFG,{ channel:'ないチャンネル' }).length===0,'★無いものは0件');
ok(targets(CFG,{ channel:'リスト-ライト', n:2 })[0].n===2,
   '★★--n で件数を変えられる');

console.log('\n=== 会員用の項目だけ出す（8.2）===');
const IT=SAMPLE[0];
let e=testEmbed(IT,{ maxQty:2 });
const names=e.fields.map((f)=>f.name);
console.log('   '+names.join('／'));
ok(names.indexOf('JAN')===0,'★★★JAN を先に出す');
ok(/^```\n4902370550467\n```$/.test(e.fields[0].value),
   '★★★JAN はコードの書式で1行に単独（長押しでコピーできる）');
ok(names.indexOf('販売価格（税込）')>=0
   &&names.indexOf('見込みの Amazon 粗利')>=0
   &&names.indexOf('購入できる数')>=0
   &&names.indexOf('送料の区分')>=0
   &&names.indexOf('購入リンク')>=0,'★★★頼まれた項目がぜんぶある');
ok(MEMBER_NG.every((x)=>names.indexOf(x)<0),
   '★★★卸値・社・MW在庫・備考・画像は項目に出さない');
const flat=JSON.stringify(e);
ok(!/wholesale|卸値|"sha"|MW在庫|商品番号/.test(flat),
   '★★★箱の中に卸値・社・MW在庫・MW の商品番号が1つも無い');
ok(!e.image&&!e.thumbnail,'★★★画像は入れない（MW・Amazon の画像は使わない）');
ok(/Amazon の商品ページ|dp\//.test(e.url)&&e.url==='https://www.amazon.co.jp/dp/B0D1GSZJ8T',
   '★★★見出しは Amazon の商品ページへのリンク');
ok(/^🧪 テスト配信｜/.test(e.title),'★★★見出しの先頭に「🧪 テスト配信」');
ok(e.color===TEST_COLOR&&e.color!==0x2ecc71&&e.color!==0xe74c3c
   &&e.color!==0xf1c40f,'★★★色は本番（緑・赤・黄）と変える');
ok(/🧪 テスト配信/.test(e.footer.text),'★★下にもテスト配信と書く');
ok(/お一人 2点まで／残り 6点/.test(
     e.fields.filter((f)=>f.name==='購入できる数')[0].value),
   '★★★購入できる数と残り数を出す');
ok(/準備中/.test(e.fields.filter((f)=>f.name==='購入リンク')[0].value),
   '★★★購入リンクは今はダミーで「準備中」');
e=testEmbed(IT,{ buyUrl:'https://shop.example.com/products/sub-{jan}' });
ok(/\(https:\/\/shop\.example\.com\/products\/sub-4902370550467\)/
     .test(e.fields.filter((f)=>f.name==='購入リンク')[0].value),
   '★★buyUrl を入れたら本物のリンクになる（{jan} を置き換える）');
ok(!/お一人/.test(testEmbed(IT,{}).fields
     .filter((f)=>f.name==='購入できる数')[0].value),
   '★★プランが決まらないときは残り数だけ');

console.log('\n=== 出してはいけない項目の名前は §8.2 と同じ ===');
{
  const { T:W }=await loadWorker('dtest');
  console.log('   worker: '+JSON.stringify(W.NT_MEMBER_NG)
    +' / script: '+JSON.stringify(MEMBER_NG));
  ok(JSON.stringify(W.NT_MEMBER_NG)===JSON.stringify(MEMBER_NG),
     '★★★NT_MEMBER_NG と同じ（片方に足し忘れない）');
}

console.log('\n=== 送料の区分（Amazon のサイズ区分から）===');
ok(shipTier({ size_tier:'s' })==='s'&&shipTier({ size_tier:'M' })==='m'
   &&shipTier({ size_tier:'l' })==='l','★★区分はそのまま使う');
ok(shipTier({ size_g:200 })==='s'&&shipTier({ size_g:3000 })==='m'
   &&shipTier({ size_g:12000 })==='l','★★採寸が無いときは重さで見る');
ok(shipTier({})==='unknown','★★★何も無ければ「まだ採寸していません」');
ok(/クリックポスト/.test(shipJa({ size_tier:'s' })),'★★小型の言い方');
ok(/レターパック/.test(shipJa({ size_tier:'m' })),'★★レターパックの言い方');
ok(shipJa({ size_tier:'s' },{ s:'ゆうパケット' })==='ゆうパケット',
   '★★★設定（test.ship）で言い方を変えられる');
ok(/採寸/.test(shipJa({})),'★分からないときもそう書く');

console.log('\n=== 仮の販売価格と、会員から見た粗利 ===');
ok(sellPrice({ wholesale:3000 })===4300,
   '★★★卸値3,000（税抜）→ 3,300×1.3＝4,290 → 100円単位で 4,300');
ok(sellPrice({ wholesale:3000 },1.5)===5000,'★★掛け率を変えられる');
ok(sellPrice({ wholesale:0 })===0,'★卸値が無ければ0');
ok(memberGross({ price:6000, fee_total:900 },4300)===800,
   '★★★粗利＝Amazon の実売 − 手数料 − 販売価格');
ok(memberGross({ price:6000, fee_total:0 },4300)===null,
   '★★手数料が取れていない行は出さない');

console.log('\n=== pj-sync の実データから、粗利の高い順に選ぶ ===');
const ROWS=[
  { jan:'4900000000011', amz_name:'もうけが大きい', asin:'B000000011',
    kishu:'Switch', wholesale:2000, price:6000, fee_total:800, stock:5,
    size_tier:'s', size_g:100 },
  { jan:'4900000000028', amz_name:'もうけが小さい', asin:'B000000028',
    wholesale:2000, price:3700, fee_total:600, stock:5 },
  { jan:'4900000000080', amz_name:'赤字', asin:'B000000080',
    wholesale:2000, price:3000, fee_total:600, stock:5 },
  { jan:'4900000000035', amz_name:'FBA 不可', asin:'B000000035',
    wholesale:2000, price:9000, fee_total:800, stock:5, fee_kind:'fba_ng' },
  { jan:'4900000000042', amz_name:'出品できない（赤）', asin:'B000000042',
    wholesale:2000, price:9000, fee_total:800, stock:5, rst:'blocked' },
  { jan:'4900000000059', amz_name:'在庫なし', asin:'B000000059',
    wholesale:2000, price:9000, fee_total:800, stock:0 },
  { jan:'4900000000066', amz_name:'手数料が取れていない', asin:'B000000066',
    wholesale:2000, price:9000, fee_total:0, stock:5 },
  { jan:'4900000000073', amz_name:'まんなか', asin:'B000000073',
    wholesale:2000, price:5000, fee_total:700, stock:2 },
];
const picked=pickItems(ROWS,{});
console.log('   '+picked.map((x)=>x.name+' '+x.gross).join('／'));
ok(picked.length===3,'★★★FBA不可・赤・在庫なし・手数料なしは出さない');
ok(picked[0].name==='もうけが大きい'&&picked[1].name==='まんなか'
   &&picked[2].name==='もうけが小さい','★★★粗利の高い順');
ok(picked.every((x)=>x.gross>0)
   &&!picked.some((x)=>x.name==='赤字'),'★★★粗利が0以下の行も出さない');
ok(!('wholesale' in picked[0])&&!('sha' in picked[0])
   &&!('note' in picked[0]),
   '★★★箱に渡す品物に卸値・社・備考を入れない（うっかり出せないように）');
ok(picked[0].name==='もうけが大きい'&&picked[0].asin==='B000000011',
   '★★商品名は Amazon の名前を使う');

console.log('\n=== pj-sync から取る（ページをたどる・キーは出さない）===');
{
  const seen=[];
  const fk=async(u,o)=>{
    seen.push(u);
    const k=((o||{}).headers||{})['X-PJ-Key'];
    return { ok:true, json:async()=>({ ok:true,
      rows:[{ jan:'49000000000'+(seen.length+10), amz_name:'x'+k,
              wholesale:2000, price:6000, fee_total:800, stock:5 }],
      more:seen.length<2 }) };
  };
  const got=await fetchRows({ url:'https://s/', key:'KEY-SECRET', fetch:fk,
                              rows:3000 });
  console.log('   '+seen.join(' / '));
  ok(/\/mw\/amz\?priced=1&limit=1500&offset=0$/.test(seen[0]),
     '★★★GET /mw/amz（値段ありだけ）で取る');
  ok(seen.length===2&&/offset=1$/.test(seen[1]),
     '★★★more が立っていれば続きも取る');
  ok(got.rows.length===2&&!got.why,'★★2ページぶん取れる');
  const bad=await fetchRows({ url:'https://s', key:'KEY-SECRET',
    fetch:async()=>({ ok:false, status:401 }) });
  ok(/HTTP 401/.test(bad.why)&&!/KEY-SECRET/.test(bad.why),
     '★★★失敗の文にキーを出さない');
  const no=await fetchRows({});
  ok(!no.rows.length&&/URL とキー/.test(no.why),
     '★URL とキーが無ければ取りに行かない');
}

console.log('\n=== --dry-run は1件も送らない（中身だけ出す）===');
{
  const f=fake({});
  const plan=await run(f,{ dryRun:true });
  ok(f.g.calls.filter((c)=>c==='POST msg').length===0,
     '★★★1件も送らない');
  ok((plan.sends||[]).length===5,'★★★5か所ぶんの中身を作る');
  ok(sendOf(plan,'リスト-ライト').n===3
     &&sendOf(plan,'リスト-プレミアム').n===8,'★★件数も設計どおり');
  ok(/見本/.test(plan.src),'★★★pj-sync が無ければ見本で出す');
  const t=planText(plan,true);
  ok(/--dry-run（1件も送りません）/.test(t),'★★見出しに出す');
  ok(/#リスト-プレミアム … 8件（プレミアム・お一人 10点まで）/.test(t),
     '★★★送り先と件数とプランを出す');
  ok(/#リスト-スタンダード … 5件（スタンダード・モニター・お一人 5点まで）/
       .test(t),'★★★モニターも同じリストを見ることが分かる');
  ok(/#目玉商品 … 1件（ライト・スタンダード・プレミアム・モニター）/.test(t),
     '★★数が決まらないチャンネルは「お一人n点」を出さない');
  ok(/🧪 テスト配信/.test(t)&&/販売価格（税込）：¥/.test(t),
     '★★★送る中身（箱の文字）も出す');
  ok(!/卸値|MW在庫/.test(t),'★★★一覧にも卸値と MW在庫を出さない');
}

console.log('\n=== 本実行：送って ID を控える ===');
{
  const f=fake({});
  const plan=await run(f,{});
  console.log('   POST '+f.g.calls.filter((c)=>c==='POST msg').length
    +'通／控え '+plan.posts.length+'件');
  ok(f.g.calls.filter((c)=>c==='POST msg').length===5,
     '★★★5か所に1通ずつ送る（8件は1通に入る）');
  ok(plan.posts.length===5&&plan.posts.every((p)=>p.id&&p.ch&&p.name&&p.at),
     '★★★送った ID を控える（--delete で消すため）');
  const m=(f.g.msgs[chId(f,'リスト-プレミアム')]||[])[0];
  ok(m.embeds.length===8,'★★★プレミアムは8件');
  ok(/🧪 \*\*?テスト配信/.test(m.content)||/🧪 テスト配信/.test(m.content),
     '★★★1通目の先頭に「🧪 テスト配信」と書く');
  ok(/購入はできません/.test(m.content),'★★買えないことも書く');
  ok((f.g.msgs[chId(f,'リスト-ライト')]||[])[0].embeds.length===3,
     '★★ライトは3件');
  ok((f.g.msgs[chId(f,'目玉商品')]||[])[0].embeds.length===1,
     '★★目玉商品は1件');
  ok(IDS_KEY==='test:posts','★★控えは ids.json の test:posts に入れる');
}

console.log('\n=== --channel で1か所だけ送る ===');
{
  const f=fake({});
  const plan=await run(f,{ channel:'リスト-ライト' });
  ok(f.g.calls.filter((c)=>c==='POST msg').length===1,'★★★1通だけ');
  ok(plan.sends.length===1&&plan.sends[0].name==='リスト-ライト',
     '★★★指した1か所だけ');
  const p2=await run(fake({}),{ channel:'ないチャンネル' });
  ok(man(p2,'確認').some((x)=>/送り先がありません/.test(x.name)),
     '★★当たらないときは「送り先がありません」と出す');
}

console.log('\n=== 10件を超えたら通を分ける（6,000字の決まり）===');
{
  const es=[];
  for(let i=0;i<23;i++)es.push(testEmbed(
    Object.assign({},SAMPLE[0],{ jan:'490000000'+String(1000+i) }),{}));
  const msgs=splitEmbeds(es);
  console.log('   '+msgs.map((m)=>m.embeds.length).join('+'));
  ok(msgs.every((m)=>m.embeds.length<=EMB_MAX),'★★★1通は10個まで');
  ok(msgs.reduce((a,m)=>a+m.embeds.length,0)===23,'★★落とさない');
  ok(msgs[0].content&&!msgs[1].content,
     '★★★先頭の文は1通目だけ（同じ文を何度も出さない）');
}

console.log('\n=== ボットが書けないチャンネルは --dry-run でも先に出す（8.8）===');
{
  const f=fake({ noBot:['リスト-プレミアム','目玉商品'] });
  const plan=await run(f,{ dryRun:true });
  console.log('   '+man(plan,'書けない').map((x)=>x.name).join('／'));
  ok(man(plan,'書けない').length===2,
     '★★★書けない2本を先に見つける（送る前に）');
  ok(/メッセージを送信|埋め込みリンク/.test(man(plan,'書けない')[0].how),
     '★★要る権限を書く');
  ok(/setup-discord/.test(man(plan,'書けない')[0].how),
     '★★★直し方（send に bot を足して setup をやり直す）を書く');
  ok(plan.sends.length===3,'★★★書けるところはちゃんと出す（止めない）');
}

console.log('\n=== 送れなくても止めず、手でやってほしいことに出す ===');
{
  const f=fake({});
  f.api.msgAdd=async(id)=>{ f.g.calls.push('POST msg');
    throw new Error(errJa('POST','/channels/'+id+'/messages',403,
      '{"message":"Missing Permissions","code":50013}')); };
  const plan=await run(f,{});
  ok(plan.fails.length===5,'★★★5か所ぶん「できなかったこと」に残す');
  ok(man(plan,'投稿').length===5,'★★★「手でやってほしいこと」にも出す');
  ok(!/Bot |authorization/.test(JSON.stringify(plan.fails)),
     '★★★失敗の文にトークンを出さない');
  ok(/原因/.test(JSON.stringify(plan.fails))
     &&/直し方/.test(JSON.stringify(plan.fails)),
     '★★原因と直し方を日本語で出す');
}

console.log('\n=== --delete：控えたぶんだけ消す ===');
{
  const f=fake({});
  const made=await run(f,{});
  const rec=made.posts.slice();
  /* テスト以外の投稿（人が書いたもの）も混ぜておく。 */
  const ch=chId(f,'リスト-ライト');
  f.g.msgs[ch].push({ id:'人の投稿', content:'これは消さない' });
  const plan=await run(f,{ del:true, recorded:rec });
  console.log('   消した '+plan.dels.length+'件／残り '+plan.left.length+'件');
  ok(plan.dels.length===5&&plan.left.length===0,'★★★控えた5件を消す');
  ok((f.g.msgs[ch]||[]).length===1
     &&f.g.msgs[ch][0].id==='人の投稿',
     '★★★ほかの投稿には触らない');
  ok(f.g.calls.filter((c)=>/^DELETE msg/.test(c)).length===5,
     '★★消すのも控えた数だけ');
  const t=planText(plan,false);
  ok(/消したテストの投稿：5件/.test(t),'★★何を消したか出す');
}

console.log('\n=== --delete：消せなかったものは控えに残す ===');
{
  const f=fake({});
  const made=await run(f,{});
  const bad=made.posts[0].id;
  const f2=fake({ delFail:[bad] });
  const plan=await run(f2,{ del:true, recorded:made.posts });
  ok(plan.left.length===1&&plan.left[0].id===bad,
     '★★★消せなかった1件だけ控えに残す（次にもう一度消せる）');
  ok(plan.dels.length===4,'★★ほかの4件は消す');
  ok(plan.fails.length===1&&/テストの投稿を消す/.test(plan.fails[0].what),
     '★★できなかったことに出す');
  const f3=fake({ delGone:[bad] });
  const p3=await run(f3,{ del:true, recorded:made.posts });
  ok(p3.left.length===0&&p3.dels.length===5,
     '★★★すでに手で消されていた（10008）ぶんは控えからも外す');
  const p4=await run(fake({}),{ del:true, recorded:made.posts, dryRun:true });
  ok(p4.dels.length===5,'★--dry-run でも何を消すかは出す');
  ok(fake({}).g.calls.filter((c)=>/^DELETE/.test(c)).length===0,
     '★★--dry-run は1件も消さない');
}

console.log('\n=== 設計にないチャンネルを指したとき ===');
{
  const f=fake({});
  f.g.channels=f.g.channels.filter((c)=>c.name!=='リスト-ライト');
  const plan=await run(f,{ dryRun:true });
  ok(man(plan,'ない').some((x)=>x.name==='リスト-ライト'),
     '★★★サーバーに無いチャンネルは「先に setup を」と出す');
  ok(plan.sends.length===4,'★★残りは進める');
}

console.log('\n=== README の案内 ===');
const rd=fs.readFileSync('README.md','utf8');
ok(/test-post\.mjs/.test(rd),'★★★テスト配信の手順を README に書く');
ok(/ロールで表示/.test(rd),
   '★★★ロールの見え方の確かめ方（「ロールで表示」）を書く');
ok(/--delete/.test(rd),'★★消し方も書く');
T.done();
