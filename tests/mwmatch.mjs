/* 共有・Worker：MW と Amazon の「商品違いの疑い」（8.101・v349）

   カジの報告（2026-11-25）MW の JAN 4573102666987「EG ULTRAMAN（ULTRAMAN: RISING）」
   （定価 1,500円）が、Amazon の B09VGGZCKM「BANDAI SPIRITS スター・ウォーズ
   マンダロリアン」（売値 5,000円）につながっていた（Amazon 側の JAN の登録違い）。
   ① shared/mwmatch.js：名前に共通する言葉がほとんどない／売値が定価×倍率超
   ② POST /mw/same（管理者だけ）で「同じ商品」を JAN ごとに控える（ASIN つき）
   ③ /mw/amz・/mw/list が控え（same_asin）と Amazon の名前・売値を返す
   ④ 会員向けの配信（subRows・自動配信の候補）から外す
   ⑤ MW 無在庫の仕入れ値に疑いの Amazon の値段を使わない
   ⑥ 「どこで買うか」のおすすめから外す */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import MM from '../shared/mwmatch.js';
const T=harness('共有・Worker：商品違いの疑い（8.101）');
const ok=T.ok;
const { worker, T:W }=await loadWorker('mwmatch');
let notes=[];
globalThis.fetch=async(u,i)=>{
  const url=String(u&&u.url?u.url:u);
  if(/discord/.test(url)){ notes.push(JSON.parse((i&&i.body)||'{}').content||''); return new Response(null,{status:204}); }
  return new Response('{}',{status:200});
};

console.log('=== ① 見立て（shared/mwmatch.js）===');
{
  const j=MM.judge({ mw_name:'EG ULTRAMAN（ULTRAMAN: RISING）',
    amz_name:'BANDAI SPIRITS スター・ウォーズ マンダロリアン', list_price:1500, price:5000, asin:'B09VGGZCKM' });
  console.log('   '+JSON.stringify(j));
  ok(j.bad&&j.why.join()==='name,price'&&j.ratio===3.33&&j.score===0,
     '★★★JAN 4573102666987 の例は疑い（共通の言葉 0・定価の 3.33倍）');
  ok(/共通する言葉がほとんどありません/.test(MM.whyText(j))&&/3\.33倍/.test(MM.whyText(j)),'★理由の文');
  const tk=Object.keys(MM.tokens('BANDAI SPIRITS HG 1/144 ガンダム 色分け済みプラモデル'));
  ok(tk.indexOf('bandai')<0&&tk.indexOf('spirits')<0&&tk.join().indexOf('プラ')<0
     &&tk.indexOf('144')<0&&tk.indexOf('hg')>=0&&tk.indexOf('ガン')>=0,
     '★★★メーカー名・「プラモデル」「色分け済み」・縮尺は数えない（型番・作品名は数える）');
  ok(Object.keys(MM.tokens('ALTERNATE')).indexOf('alternate')>=0,'★英語は語の区切りで取る（alter で alternate を削らない）');
  const same=(a,b)=>!MM.judge({ mw_name:a, amz_name:b, list_price:0, price:0, asin:'B0X' }).bad;
  ok(same('ゼルダの伝説 ティアーズ オブ ザ キングダム','ゼルダの伝説　ティアーズ オブ ザ キングダム -Switch')
     &&same('ねんどろいど 初音ミク','ねんどろいど キャラクター・ボーカル・シリーズ01 初音ミク ノンスケール 塗装済み可動フィギュア')
     &&same('EG ULTRAMAN（ULTRAMAN: RISING）','BANDAI SPIRITS ENTRY GRADE ULTRAMAN (ULTRAMAN: RISING) 色分け済みプラモデル'),
     '★★★同じ商品（全角半角・記号・付け足しの違い）は疑わない');
  ok(!same('マリオカート8 デラックス','スーパーマリオブラザーズ ワンダー -Switch'),'★★同じシリーズでも別の商品は疑う');
  ok(same('EG','スター・ウォーズ マンダロリアン'),'★言葉が少なすぎる名前では名前で判断しない');
  ok(MM.judge({ mw_name:'a', amz_name:'b', list_price:1000, price:2600, asin:'B0X' }).bad
     &&!MM.judge({ mw_name:'a', amz_name:'b', list_price:1000, price:2500, asin:'B0X' }).bad
     &&!MM.judge({ mw_name:'a', amz_name:'b', list_price:1000, price:2600, asin:'B0X' },{ x:3 }).bad,
     '★★★売値が定価の 2.5倍を**超えたら**疑い（倍率は変えられる）');
  ok(!MM.judge({ mw_name:'a', amz_name:'b', list_price:0, price:9999, asin:'B0X' }).bad,'★定価が無ければ値段では判断しない');
  ok(!MM.judge({ mw_name:'EG ULTRAMAN', amz_name:'スター・ウォーズ マンダロリアン', list_price:1500, price:5000,
       asin:'B09VGGZCKM', same_asin:'B09VGGZCKM' }).bad
     &&MM.judge({ mw_name:'EG ULTRAMAN', amz_name:'スター・ウォーズ マンダロリアン', list_price:1500, price:5000,
       asin:'B0OTHER001', same_asin:'B09VGGZCKM' }).bad,
     '★★★「同じ商品」の控えは、その ASIN のときだけ効く（ASIN が変われば見立て直す）');
  ok(MM.xOf('')===2.5&&MM.xOf('3')===3&&MM.xOf('0.5')===2.5,'★倍率の既定は 2.5（おかしな値は既定）');
}

const env0=()=>makeEnv({ STAFF_KEY:'staff-key-123' });
const api=async(env,path,body,key)=>{
  const r=body?post(path,body):get(path);
  if(key)r.headers.set('X-PJ-Key',key);
  return await asJson(await worker.fetch(r,env,{}));
};
const NOW=new Date().toISOString();
const J='4573102666987', J2='4902370550467';
const seed=(env)=>{
  const st=(jan,name,lp)=>env.DB._db.prepare(`INSERT INTO mw_stock (jan,sha,idx,kishu,name,list_price,cond,wholesale,
    stock,ship_days,row_hash,pick,seen_at,created_at) VALUES (?,'M200',0,'figure',?,?,'新品',1020,5,0,'h',1,?,?)`)
    .run(jan,name,lp,NOW,NOW);
  const az=(jan,asin,name,px)=>env.DB._db.prepare(`INSERT INTO mw_amz (jan,asin,name,price,low,price_at,size_g,
    fee_total,checked_at,created_at) VALUES (?,?,?,?,?,?,400,600,?,?)`).run(jan,asin,name,px,px,NOW,NOW,NOW);
  st(J,'EG ULTRAMAN（ULTRAMAN: RISING）',1500); az(J,'B09VGGZCKM','BANDAI SPIRITS スター・ウォーズ マンダロリアン',5000);
  st(J2,'ゼルダの伝説 ティアーズ オブ ザ キングダム',7900); az(J2,'B0ZELDA001','ゼルダの伝説 ティアーズ オブ ザ キングダム -Switch',6800);
};

console.log('\n=== ② POST /mw/same ・ ③ 一覧に控えを返す ===');
{
  const env=env0(); seed(env);
  const a0=(await api(env,'/mw/amz')).body;
  const r0=a0.rows.filter((x)=>x.jan===J)[0];
  ok(r0&&r0.same_asin===''&&W.mwMisOf(r0).bad,'★★/mw/amz：控えが無いので疑い');
  const l0=(await api(env,'/mw/list')).body;
  const m0=l0.rows.filter((x)=>x.jan===J)[0];
  ok(m0&&/スター・ウォーズ/.test(m0.amz_name)&&m0.amz_price===5000&&m0.same_asin===''&&W.mwMisOf(m0).bad,
     '★★★/mw/list（無在庫）にも Amazon の名前・売値・控えを返す（候補から外せる）');
  const sf=await api(env,'/mw/same',{ jan:J, asin:'B09VGGZCKM', on:true },'staff-key-123');
  ok(sf.status===403,'★★★作業者のキーでは控えられない（管理者だけ）');
  ok((await api(env,'/mw/same',{ jan:'123', asin:'B09VGGZCKM' })).body.error==='bad_jan'
     &&(await api(env,'/mw/same',{ jan:J, asin:'x' })).body.error==='bad_asin','★JAN・ASIN の形を確かめる');
  const s1=(await api(env,'/mw/same',{ jan:J, asin:'b09vggzckm', on:true })).body;
  ok(s1.ok&&s1.asin==='B09VGGZCKM','★★★「同じ商品」を控える');
  const r1=(await api(env,'/mw/amz')).body.rows.filter((x)=>x.jan===J)[0];
  ok(r1.same_asin==='B09VGGZCKM'&&!W.mwMisOf(r1).bad,'★★★控えたあとは疑わない（/mw/amz が same_asin を返す）');
  const s2=(await api(env,'/mw/same',{ jan:J, on:false })).body;
  const r2=(await api(env,'/mw/amz')).body.rows.filter((x)=>x.jan===J)[0];
  ok(s2.ok&&r2.same_asin===''&&W.mwMisOf(r2).bad,'★控えを外すとまた疑う');
  /* 表が無い D1 でも一覧は落ちない（「表がある」の控えが残らないよう、別に読み込んだ Worker で）。 */
  const { worker:w2 }=await loadWorker('mwmatch-notable');
  const api2=async(env,path,body)=>await asJson(await w2.fetch(body?post(path,body):get(path),env,{}));
  const env2=env0(); env2.DB._db.exec('DROP TABLE mw_same'); seed(env2);
  const a2=await api2(env2,'/mw/amz');
  const t2=(await api2(env2,'/mw/same',{ jan:J, asin:'B09VGGZCKM' })).body;
  const l2=await api2(env2,'/mw/list');
  console.log('   表なし: '+a2.status+' '+JSON.stringify(t2)+' list '+l2.status);
  ok(a2.status===200&&a2.body.rows.length===2&&l2.status===200&&t2.table_ok===false&&/0074/.test(t2.why),
     '★★表が無い（migrate-0074 の前）でも一覧は出る・控えは理由を返す');
}

console.log('\n=== ④ 会員向けの配信から外す ===');
{
  const cfg={ misX:2.5 };
  const base={ jan:J, mw_name:'EG ULTRAMAN（ULTRAMAN: RISING）', amz_name:'BANDAI SPIRITS スター・ウォーズ マンダロリアン',
    list_price:1500, amz_price:5000, asin:'B09VGGZCKM', same_asin:'', price:1500, max_qty:3, stock:5 };
  ok(W.subRowMap(base,cfg).mis===true,'★★★配信の行（subRowMap）に疑いの印');
  ok(W.subRowMap(Object.assign({},base,{ same_asin:'B09VGGZCKM' }),cfg).mis===false,'★★「同じ商品」なら外さない');
  ok(W.subRowMap(Object.assign({},base,{ jan:J2, mw_name:'ゼルダの伝説 ティアーズ オブ ザ キングダム',
    amz_name:'ゼルダの伝説 ティアーズ オブ ザ キングダム -Switch', list_price:7900, amz_price:6800, asin:'B0ZELDA001' }),cfg).mis===false,
     '★同じ商品の行は印なし');
  /* 配信できる商品（印・読み込み済み）から外れる。 */
  const env=env0(); seed(env);
  for(const j of [J,J2])env.DB._db.prepare(`INSERT INTO mw_sub (jan,on_sale,max_qty,price,loaded_at,at,created_at)
    VALUES (?,1,3,2000,?,?,?)`).run(j,NOW,NOW,NOW);
  const rows=await W.subRows(env,cfg);
  ok(rows.length===1&&rows[0].jan===J2,'★★★印を付けて Shopify に読み込んだ品でも、疑いの品は配信しない');
  await api(env,'/mw/same',{ jan:J, asin:'B09VGGZCKM', on:true });
  ok((await W.subRows(env,cfg)).length===2,'★★「同じ商品」を押せば配信に戻る');
  await api(env,'/mw/same',{ jan:J, on:false });
  /* 自動配信の候補（mw_stock から引く行）も理由「商品違いの疑い」で止まる。 */
  const c=await W.subAutoCands(env,cfg,{});
  const cj=c.filter((x)=>x.jan===J)[0];
  ok(cj&&cj.list_price===1500&&cj.same_asin==='','★★自動配信の候補にも定価と控えを引く');
  const x=W.subRowMap(cj,cfg);
  const SA=(await import('../shared/subauto.js')).default;
  const why=SA.gate(Object.assign({},x,{ amz_price:5000, fee_total:600, price:2000, fit:true, ship_sure:true }),{});
  ok(why.indexOf('mis')>=0&&/商品違いの疑い/.test(SA.whyText(why,x)),'★★★自動配信の判定で「商品違いの疑い」として止める');
}

console.log('\n=== ⑤ MW 無在庫の仕入れ値に使わない ===');
{
  const S={ mwShipFee:176 };
  const mw={ name:'EG ULTRAMAN（ULTRAMAN: RISING）', list_price:1500, wholesale:1020 };
  const amz={ asin:'B09VGGZCKM', amz_name:'BANDAI SPIRITS スター・ウォーズ マンダロリアン', amz_price:5000,
              amz_low:900, amz_at:NOW };
  const c1=W.mwDropCost(S,mw,amz,{});
  ok(c1.src==='mw'&&c1.amz===0&&/商品違いの疑い/.test(c1.why),
     '★★★疑いの Amazon の値段（¥900）は仕入れ値に使わない（MW の ¥1,298 のまま）');
  const c2=W.mwDropCost(S,mw,Object.assign({},amz,{ same_asin:'B09VGGZCKM' }),{});
  ok(c2.src==='amz'&&c2.amz===900,'★★「同じ商品」なら今までどおり安いほう（Amazon）');
  const c3=W.mwDropCost(S,{ wholesale:1020 },{ amz_low:900, amz_at:NOW },{});
  ok(c3.src==='amz','★名前と売値が無い行（今までの呼び方）は今までどおり');
}

console.log('\n=== ⑥ 「どこで買うか」のおすすめから外す ===');
{
  const x={ orderId:'1', jan:J, qty:1, usd:40, name:'EG ULTRAMAN（ULTRAMAN: RISING）',
    mw:{ cost:1298, wholesale:1020, fee:176, stock:5, gone:false, profit:2000, url:'https://matchingworld.asia/buy/?q='+J },
    amz:{ asin:'B09VGGZCKM', low:900, profit:2300, mis:true, name:'BANDAI SPIRITS スター・ウォーズ マンダロリアン' },
    warn:['**Amazon は商品違いの疑い**（…）。おすすめから外しました'] };
  ok(W.buyPick(x)==='mw','★★★Amazon のほうが安くても、疑いならおすすめにしない');
  const t=W.buyNoteText(x);
  ok(/おすすめ：\*\*MW\*\*/.test(t)&&/🔴 \*\*商品違いの疑い\*\*/.test(t)&&/Amazon の商品名：BANDAI SPIRITS スター・ウォーズ/.test(t)
     &&/MW の商品名：EG ULTRAMAN/.test(t),'★★知らせに疑いと両方の商品名を出す');
  ok(W.buyPick(Object.assign({},x,{ mw:Object.assign({},x.mw,{ stock:0 }) }))==='','★MW が在庫0なら、疑いの Amazon もすすめない（なし）');
}

T.done();
