/* 決まり＋Worker：モニターは3週間・週1回・毎回新しい5件（8.43・カジの依頼1／3）

   ・1回に**新しく**出すのは ⚙ の件数（既定5）。前から出している品は数えない
   ・候補は**通常版のゲーム**で、**速く売れる品**だけ
     速さの下限 ＝ ⚙／空なら **人数 ÷ 日数**（5人・2日＝1日2.5点以上）
   ・**前の週までにモニターへ出した品は選ばない**
   ・**1週目は速い順**、2週目からは候補から**ランダム**
     （「週＋JAN」で決まるので、同じ週なら押し直しても同じ品）
   ・足りない週は**下限を一段下げて埋め**（印を付ける）、
     それでも足りなければ**そのまま少なく出す**
   ・購入期限（既定7日）が過ぎたカードは「受付終了」に**書き換える**
     （消さない・ほかのプランでは売り続ける）
   ・モニターのチャンネルに「**今週の配信**」を1通（件数だけ・商品名や
     価格は出さない・@everyone は使わない） */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import SUBPLAN from '../shared/subplan.js';
const T=harness('決まり：モニターの3週間（8.43）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('submon');

const row=(o)=>Object.assign({ jan:'4902370550001', name:'ゲーム', fit:true,
  rst:'ok', amz:0, buy_qty:0, price:2000, qty:1, gross:800, speed:3,
  stock:9, is_game:true, grades:'', no_back:false, one_off:false },o);
const rows=(n,f)=>{ const a=[]; for(let i=0;i<n;i++)
  a.push(row(Object.assign({ jan:'49023705500'+(10+i), name:'ゲーム'+i },
    f?f(i):{}))); return a; };
const mon=()=>SUBPLAN.plan('monitor');
const W1=Date.parse('2026-11-16T09:00:00+09:00');
const W2=Date.parse('2026-11-23T09:00:00+09:00');

console.log('=== ① 速さの下限は⚙の固定値（8.45・既定 0.5点/日）===');
{
  const o=SUBPLAN.pickOpt({});
  /* 8.43 では「人数 ÷ 日数」だったが、カジの実データ（2026-11-16）で
     2.5点/日 に届く品が1件しか無かったので、⚙の固定値を主にした。 */
  ok(SUBPLAN.monSpeed(o)===0.5,'★★★既定は 1日 0.5点');
  ok(SUBPLAN.monSpeed(SUBPLAN.pickOpt({ subMonSpeedMin:'1.5' }))===1.5,
     '★★★⚙で下限を決める');
  ok(SUBPLAN.monSpeed(SUBPLAN.pickOpt({ subMonSpeedMin:'' }))===0.5,
     '★★★空なら既定の 0.5点/日');
  ok(SUBPLAN.monSpeed(SUBPLAN.pickOpt({ subMonPeople:10 }))===0.5,
     '★★★人数を変えても下限は動かない（お一人1点と出せる数で抑える）');
  ok(SUBPLAN.pickOpt({ subMonPeople:10 }).monPeople===10
     &&SUBPLAN.pickOpt({}).monPeople===10,
     '★人数は⚙のまま返す（既定10人）');
  ok(SUBPLAN.monSpeed(o,true)===0.25,'★★足りないときは半分まで下げる（既定50%）');
}

console.log('=== ①-2 モニターの対象（8.45・クリックポストまで広げる）===');
{
  const o=SUBPLAN.pickOpt({});
  ok(o.monWide===true,'★★★既定でクリックポストの品まで広げる');
  const g=row({ is_game:true, name:'ふつうのゲーム', ship:'クリックポスト' });
  const fig=row({ is_game:false, name:'フィギュア',
                  ship:'クリックポスト' });
  const box=row({ is_game:false, name:'大きい箱',
                  ship:'宅配便（60サイズ）' });
  const ltd=row({ is_game:true, name:'◯◯ 限定版', ship:'クリックポスト' });
  ok(SUBPLAN.monKind(g,mon(),o)===true,'★通常版のゲームは今までどおり');
  ok(SUBPLAN.monKind(fig,mon(),o)===true,
     '★★★クリックポストで送れるフィギュア・グッズも入る');
  ok(SUBPLAN.monKind(box,mon(),o)===false,
     '★★★クリックポストで送れない箱ものは入らない');
  ok(SUBPLAN.monKind(ltd,mon(),o)===false,
     '★★★広げても、ゲームソフトは通常版だけ（8.21）');
  ok(SUBPLAN.monKind(fig,mon(),SUBPLAN.pickOpt({ subMonWide:false }))===false,
     '★★★⚙を切れば通常版のゲームだけに戻る');
  ok(SUBPLAN.monKind({ name:'フィギュア' },mon(),o,undefined,false,
     'クリックポスト')===true,
     '★★種類と送り方は外からも渡せる（pj-sync 用）');
}

console.log('=== ② 1週目は速い順・新しく5件 ===');
{
  const a=SUBPLAN.monPick(rows(9,(i)=>({ speed:3+i*0.1 })),mon(),
    SUBPLAN.pickOpt({}),[],W1);
  console.log('   '+JSON.stringify(a.items.map((x)=>x.jan+':'+x.speed)));
  ok(a.items.length===5,'★★★新しく5件（⚙の件数）');
  ok(a.first===true,'★★★1枚も出していない回は「1週目」');
  ok(a.items[0].speed>=a.items[1].speed
     &&a.items[1].speed>=a.items[4].speed,
     '★★★1週目はいちばん速く売れる品から出す');
  ok(a.low===0&&a.short===0,'★下限を下げずに足りている');
  const slow=SUBPLAN.monPick(rows(9,(i)=>({ speed:0.05+i*0.001 })),mon(),
    SUBPLAN.pickOpt({}),[],W1);
  ok(slow.items.length===0&&slow.short===5,
     '★★★遅い品しかない週は出さない（お試しの約束を守る）');
}

console.log('=== ③ 2週目からはランダム・前の週は選ばない ===');
{
  const list=rows(9,(i)=>({ speed:3+i*0.1 }));
  const a=SUBPLAN.monPick(list,mon(),SUBPLAN.pickOpt({}),[],W1);
  const was=a.items.map((x)=>x.jan);
  const b=SUBPLAN.monPick(list,mon(),SUBPLAN.pickOpt({}),was,W2);
  console.log('   2週目 '+JSON.stringify(b.items.map((x)=>x.jan)));
  ok(b.items.length===4&&b.first===false,
     '★★★残りの候補から出す（前の週の5件は選ばない）');
  ok(b.items.every((x)=>was.indexOf(x.jan)<0),
     '★★★前の週までに出した品は1つも入らない');
  /* 同じ週なら何度押しても同じ5件（ランダムでも決まった順）。 */
  const b2=SUBPLAN.monPick(list,mon(),SUBPLAN.pickOpt({}),was,W2);
  ok(b.items.map((x)=>x.jan).join()===b2.items.map((x)=>x.jan).join(),
     '★★★同じ週なら押し直しても同じ品');
  /* 候補がたくさんある週は5件そろい、並びは速い順とは限らない。 */
  const big=rows(20,(i)=>({ jan:'49023705503'+(10+i), speed:3+i*0.1 }));
  const c=SUBPLAN.monPick(big,mon(),SUBPLAN.pickOpt({}),['x'],W2);
  ok(c.first===false&&c.items.length===5,'★2週目も5件は出せる');
  const fast=big.slice().sort((x,y)=>y.speed-x.speed).slice(0,5)
    .map((x)=>x.jan).join();
  ok(c.items.map((x)=>x.jan).join()!==fast,
     '★★2週目は速い順とは限らない（ランダム）');
}

console.log('=== ④ 足りない週は下限を下げて埋める ===');
{
  /* 速い品2件＋少し遅い品5件（下限 0.5／下げると 0.25）。 */
  const list=rows(2,(i)=>({ speed:3+i })).concat(
    rows(5,(i)=>({ jan:'49023705502'+(10+i), speed:0.3+i*0.01 })));
  const a=SUBPLAN.monPick(list,mon(),SUBPLAN.pickOpt({}),[],W1);
  console.log('   '+JSON.stringify(a.items.map((x)=>x.jan+':'+x.speed
    +(x.mon_low?'（下げた）':''))));
  ok(a.items.length===5,'★★★下限を下げて5件そろえる');
  ok(a.low===3,'★★★下げて埋めた件数を返す');
  ok(a.items.filter((x)=>x.mon_low).length===3,
     '★★★下げて入れた品に印を付ける（案に出す）');
  ok(a.items.filter((x)=>!x.mon_low).every((x)=>x.speed>=0.5),
     '★★印の無い品は下限を満たしている');
  /* ⚙で「下げない」にもできる。 */
  const b=SUBPLAN.monPick(list,mon(),SUBPLAN.pickOpt({ subMonShort:0 }),[],W1);
  ok(b.items.length===2&&b.short===3,
     '★★★⚙で 0% にすれば下げずに少なく出す');
}

console.log('=== ⑤ 通常版のゲームだけ ===');
{
  const list=[row({ jan:'4902370550011', speed:5 }),
    row({ jan:'4902370550012', speed:5, is_game:false }),
    row({ jan:'4902370550013', speed:5, name:'ゲーム 限定版' }),
    row({ jan:'4902370550014', speed:5, one_off:true }),
    row({ jan:'4902370550015', speed:5, qty:0 }),
    row({ jan:'4902370550016', speed:5, amz:1 })];
  const a=SUBPLAN.monPick(list,mon(),SUBPLAN.pickOpt({}),[],W1);
  console.log('   '+JSON.stringify(a.items.map((x)=>x.jan)));
  ok(a.items.length===1&&a.items[0].jan==='4902370550011',
     '★★★ゲーム以外・限定版・1点もの・数が無い行・Amazon本体ありは入らない');
}

console.log('=== ⑥ 分布（線引きを決めるため）===');
{
  const list=rows(8,(i)=>({ gross:500+i*500, speed:0.5+i*0.5 }));
  const st=SUBPLAN.statsOf(list,SUBPLAN.pickOpt({}));
  console.log('   '+JSON.stringify(st));
  ok(st.n===8,'★★候補の数を数える');
  ok(st.gross.q1>0&&st.gross.med>=st.gross.q1&&st.gross.q3>=st.gross.med,
     '★★★粗利の 下位25%／中央／上位25%');
  ok(st.speed.med>0&&st.gxs.med>0,'★★★速さと「粗利×速さ」も出す');
  ok(st.monOk>0&&st.monOk<=8,'★★★モニターの条件に合う件数も出す');
}

console.log('=== ⑦ 「今週の配信」の1通 ===');
{
  const cfg={ monNote:true, pick:SUBPLAN.pickOpt({}),
    plans:SUBPLAN.list({ subChMonitor:'111' }) };
  /* 件数は「その日に新しく出たカード」をプランごとに数えたもの
     （subMonToday が D1 から作る）。 */
  const by={ monitor:5, light:7, standard:12, premium:9, n:33 };
  const t=W.subMonText(cfg,by,'2026-11-16T09:00:00+09:00');
  console.log('   '+t.replace(/\n/g,' ／ '));
  ok(/ライト 7件/.test(t)&&/スタンダード 12件/.test(t)&&/プレミアム 9件/.test(t),
     '★★★上のプランの件数を出す');
  ok(/モニターの \*\*5件\*\*/.test(t),'★★モニター自身の件数も出す');
  ok(/11\/23 まで/.test(t),'★★★購入期限の日付を出す（7日後）');
  ok(!/¥|JAN|\d{13}/.test(t),
     '★★★商品名・JAN・価格は出さない');
  ok(!/@everyone|@here/.test(t),'★★★@everyone・@here は使わない');
  const t2=W.subMonText(cfg,{ monitor:5, n:5 },
    '2026-11-16T09:00:00+09:00');
  ok(/上のプランへの配信はありません/.test(t2),'★上に出なかった週の文');
}

console.log('=== ⑧ 配信：新しく出すのは⚙の件数だけ ===');
{
  const CH='1111111111';
  const now=()=>new Date().toISOString();
  let dc=[];
  globalThis.fetch=async(u,i)=>{
    const url=String(u), o=i||{};
    if(/discord\.com\/api/.test(url)){
      const m=/\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(url)||[];
      const b=JSON.parse(String(o.body||'{}'));
      dc.push({ method:String(o.method||'GET'), ch:m[1]||'', msg:m[2]||'',
                content:String(b.content||''), embeds:(b.embeds||[]).length });
      return new Response(JSON.stringify({ id:String(900000+dc.length) }),
        {status:200,headers:{'content-type':'application/json'}});
    }
    return new Response('{}',{status:200});
  };
  const env=makeEnv({ STAFF_KEY:'staff-key-123',
    DISCORD_BOT_TOKEN:'bot-token-xyz' });
  await env.DB.prepare(
    `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)`)
    .bind(JSON.stringify({ at:now(), settings:{ subOn:true, subOnMonitor:true,
      subChMonitor:CH, subMonSpeedMin:'0.1', subMonNew:2,
      subDomain:'x.myshopify.com' } }),now()).run();
  /* ゲーム4件を「会員に出す」印つきで入れる。 */
  for(let i=0;i<4;i++){
    const jan='490237055010'+i;
    await env.DB.prepare(
      `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,
         created_at) VALUES (?1,'いろは',0,'NS',?2,20,'h',?3,?3)`)
      .bind(jan,'ゲーム'+i,now()).run();
    await env.DB.prepare(
      `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,checked_at,
         basis,price_at) VALUES (?1,'B0D1GSZJ8T',?2,9000,1200,'s',?3,'カート',?3)`)
      .bind(jan,'Amazon'+i,now()).run();
    await env.DB.prepare(
      `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,
         at,created_at) VALUES (?1,1,1,3645,'monitor,light,standard,premium',
         ?2,?2,?2,?2)`).bind(jan,now()).run();
  }
  const api=async(path,body)=>(await asJson(await worker.fetch(
    body?post(path,body):get(path),env,{}))).body;
  dc=[];
  const r1=await api('/sub/send',{ approve:true });
  const mon1=(r1.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
  console.log('   1回目 '+JSON.stringify({ add:mon1.add, keep:mon1.keep })
    +' / POST '+dc.filter((x)=>x.method==='POST'&&x.embeds).length);
  ok(mon1.add===2,'★★★1回目に新しく出すのは⚙の2件だけ（ほかは出さない）');
  /* 「今週の配信」の1通は、その日の**最初の1回だけ POST**（通知が鳴る）。 */
  const note1=dc.filter((x)=>x.ch===CH&&x.content&&!x.embeds);
  console.log('   1通：'+(note1[0]||{}).content);
  ok(note1.length===1&&note1[0].method==='POST'&&!note1[0].msg,
     '★★★新しく出した回に、モニターへ文だけの1通を出す');
  ok(/今週の配信/.test((note1[0]||{}).content||''),'★★「今週の配信」の文');
  ok(!/¥|\d{13}/.test((note1[0]||{}).content||''),
     '★★★商品名・JAN・価格は出さない');
  ok(r1.mon_note===1,'★出したことを返す');
  dc=[];
  const r2=await api('/sub/send',{ approve:true });
  const mon2=(r2.plans||[]).filter((x)=>x.key==='monitor')[0]||{};
  console.log('   2回目 '+JSON.stringify({ add:mon2.add, keep:mon2.keep })
    +' / 1通 '+JSON.stringify(dc.filter((x)=>x.ch===CH&&x.content&&!x.embeds)
      .map((x)=>x.method+':'+x.msg)));
  ok(mon2.add===2,'★★★2回目も新しく2件（前の2件は件数に数えない）');
  /* 同じ日の2回目からは**書き換え**（PATCH＝通知は鳴らない）。
     「全プランに配る」はプランごとに1回ずつ頼むので、
     1日に何通も出さないため（8.36）。 */
  const note2=dc.filter((x)=>x.ch===CH&&x.content&&!x.embeds);
  ok(note2.length===1&&note2[0].method==='PATCH'&&!!note2[0].msg,
     '★★★同じ日の2回目は、同じ1通を書き換える（通知は鳴らない）');
  ok(r2.mon_note===2,'★書き換えたことを返す');
  ok(/4件/.test((note2[0]||{}).content||''),
     '★★★件数は「その日に新しく出たカード」ぜんぶ（2＋2＝4件）');
  const n=Number(((await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sub_post WHERE ch=?1`).bind(CH).first())||{})
    .n||0);
  ok(n===4,'★★★2回で4件がモニターに出ている');

  console.log('=== ⑨ 期限が過ぎたら受付終了（カードは残す）===');
  /* 1件を8日前に出したことにする。 */
  await env.DB.prepare(
    `UPDATE sub_post SET at=?2 WHERE ch=?1 AND jan='4902370550100'`)
    .bind(CH,new Date(Date.now()-8*86400000).toISOString()).run();
  dc=[];
  const r3=await api('/sub/send',{ approve:true });
  const off=dc.filter((x)=>x.method==='PATCH');
  console.log('   受付終了：'+JSON.stringify(r3.off||r3.retire||{})
    +' / PATCH '+off.length);
  const row=await env.DB.prepare(
    `SELECT off_at FROM sub_post WHERE ch=?1 AND jan='4902370550100'`)
    .bind(CH).first();
  ok(!!String((row||{}).off_at||''),
     '★★★期限が過ぎたカードは受付終了になる（控えに日時が入る）');
  ok(dc.filter((x)=>x.method==='DELETE').length===0,
     '★★★カードは消さない（履歴として残す）');
  dc=[];
  await api('/sub/send',{ approve:true, redo:true });
  const row2=await env.DB.prepare(
    `SELECT off_at FROM sub_post WHERE ch=?1 AND jan='4902370550100'`)
    .bind(CH).first();
  ok(!!String((row2||{}).off_at||''),
     '★★★書き直しでも受付終了のカードは商品カードに戻さない');

  console.log('=== ⑩ 新しく出していない回と /sub/mon ===');
  dc=[];
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,
       created_at) VALUES ('4902370550999','いろは',0,'NS','ゲーム新',20,'h',
       ?1,?1)`).bind(now()).run();
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,checked_at,
       basis,price_at) VALUES ('4902370550999','B0D1GSZJ8T','Amazon新',9000,
       1200,'s',?1,'カート',?1)`).bind(now()).run();
  await env.DB.prepare(
    `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,
       at,created_at) VALUES ('4902370550999',1,1,3645,
       'monitor,light,standard,premium',?1,?1,?1,?1)`).bind(now()).run();
  const r5=await api('/sub/send',{ approve:true });
  const note5=dc.filter((x)=>x.ch===CH&&x.content&&!x.embeds);
  console.log('   1通：'+JSON.stringify(note5.map((x)=>x.method))
    +' '+(note5[0]||{}).content);
  ok(note5.length===1&&note5[0].method==='PATCH',
     '★★★そのあとも、新しく出るたびに同じ1通を書き直す（POST しない）');
  ok(r5.mon_note===2,'★書き換えたことを返す');
  dc=[];
  const r6=await api('/sub/send',{ approve:true });
  ok(dc.filter((x)=>x.ch===CH&&x.content&&!x.embeds).length===0,
     '★★★新しく出していない回は、出しも書き直しもしない');
  ok(!r6.mon_note,'★出していないことも返す');
  const got=await api('/sub/mon');
  console.log('   /sub/mon '+JSON.stringify({ n:got.n, ch:got.ch,
    new_n:got.new_n, limit:got.limit_days }));
  ok(got.ok&&got.n>=3&&got.ch===CH,
     '★★★/sub/mon がモニターに出した商品を返す（案が同じ品を選ばないため）');
  ok(got.new_n===2&&got.limit_days===7&&got.people===10,
     '★★⚙（新しく◯件・期限・人数）も返す');
  ok(Array.isArray(got.sent)&&got.sent.every((x)=>/^\d+$/.test(x)),
     '★JAN だけを返す');

  console.log('=== ⑪ モニターの開始日（8.44・カジの確認3）===');
  /* 正式に始める前のテスト配信を数え直せるように、⚙に開始日を置く。 */
  ok(SUBPLAN.monDay('2026-11-16')==='2026-11-16'
     &&SUBPLAN.monDay('2026-11-16T09:00:00Z')==='2026-11-16'
     &&SUBPLAN.monDay('いつか')===''&&SUBPLAN.monDay('')==='',
     '★★日付の形（YYYY-MM-DD）だけ受ける');
  ok(SUBPLAN.pickOpt({ subMonFrom:'2026-11-16' }).monFrom==='2026-11-16'
     &&SUBPLAN.pickOpt({}).monFrom==='','★★⚙から読む（既定は空）');
  ok(SUBPLAN.monWeek('2026-11-16T09:00:00+09:00','2026-11-16')===0
     &&SUBPLAN.monWeek('2026-11-22T23:00:00+09:00','2026-11-16')===0
     &&SUBPLAN.monWeek('2026-11-23T09:00:00+09:00','2026-11-16')===1
     &&SUBPLAN.monWeek('2026-12-07T09:00:00+09:00','2026-11-16')===3,
     '★★★開始日から7日ずつ数え直す（開始日から7日間が1週目）');
  ok(SUBPLAN.monWeek('2026-11-10T09:00:00+09:00','2026-11-16')===0,
     '★開始日より前は1週目のまま');
  /* 開始日があれば、控えが残っていても**1週目は速い順**。 */
  const row3=(jan,sp)=>({ jan:jan, name:'ゲーム'+jan, fit:true, rst:'ok',
    amz:0, buy_qty:0, price:3000, qty:1, gross:800, speed:sp, stock:9,
    is_game:true, grades:'' });
  const mp=SUBPLAN.monPick([row3('4902370550201',3),row3('4902370550202',5)],
    null,SUBPLAN.pickOpt({ subMonFrom:'2026-11-16', subMonNew:2 }),
    ['4902370550999'],Date.parse('2026-11-18T09:00:00+09:00'));
  ok(mp.first===true&&mp.items[0].jan==='4902370550202',
     '★★★開始日から1週目のあいだは、控えがあっても速い順');
  const mp2=SUBPLAN.monPick([row3('4902370550201',3),row3('4902370550202',5)],
    null,SUBPLAN.pickOpt({ subMonFrom:'2026-11-16', subMonNew:2 }),
    [],Date.parse('2026-11-25T09:00:00+09:00'));
  ok(mp2.first===false&&mp2.week===1,
     '★★★次の週からは2週目（ランダム）になる');
  /* pj-sync は、開始日より前に出したカードを「出した品」に数えない。 */
  const day0=(d)=>new Date(Date.now()+d*86400000).toISOString().slice(0,10);
  const setFrom=async(v)=>{ await env.DB.prepare(
    `UPDATE sync_state SET v=?1 WHERE k='ui.settings'`)
    .bind(JSON.stringify({ at:now(), settings:{ subOn:true,
      subOnMonitor:true, subChMonitor:CH, subMonSpeedMin:'0.1',
      subMonNew:2, subMonFrom:v, subDomain:'x.myshopify.com' } })).run(); };
  await setFrom(day0(3));
  const g2=await api('/sub/mon');
  console.log('   開始日 '+g2.from+' → '+g2.n+'件');
  ok(g2.from===day0(3)&&g2.n===0&&g2.sent.length===0,
     '★★★開始日より前に出したカード（テスト配信）は数えない');
  await setFrom(day0(-3));
  const g3=await api('/sub/mon');
  ok(g3.from===day0(-3)&&g3.n>=3,'★★★開始日より後に出したカードは数える');
  await setFrom('');
  const g4=await api('/sub/mon');
  ok(g4.from===''&&g4.n>=3,'★★空のままなら今までどおりぜんぶ数える');
}

await T.done();
