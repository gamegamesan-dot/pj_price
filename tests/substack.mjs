/* 決まり：プランは積み上げ型（8.35・カジの依頼・v293）

   いままで mw_sub.grades に1つのプランだけを入れていたので、
   ライトに振り分けた商品はモニターにもプレミアムにも出なかった
   （「ほかのプランに振り分けてあります」）。そのため
     ・ライトにはゲームソフトが1件しか残らない
     ・プレミアムでもモニターの商品が見られない
   ということになっていた。

   これからは**下のプランに出す商品は、上のプランにも出す**。
     ・ライト      … モニターの商品＋ゲームソフト全部（限定版も）
     ・スタンダード … ゲームソフト全部＋ほかの商品
     ・プレミアム  … 全部＋1点ものの先行
   1人あたりの購入数・1回の件数は**プランごと**のまま。 */
import { harness, loadWorker, makeEnv, asJson, get, post } from './lib.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const S=require('../shared/subplan.js');
const SHOPCSV=require('../shared/shopcsv.js');
const T=harness('決まり：プランは積み上げ型（8.35）');
const ok=T.ok;
const ROOT=path.resolve(new URL('.',import.meta.url).pathname,'..');
const pl=(k)=>S.list({}).filter((p)=>p.key===k)[0];
const GAME={ name:'ふつうのゲーム', kishu:'NS' };
const LTD={ name:'限定版ゲーム 限定版', kishu:'NS' };
const FIG={ name:'S.H.Figuarts ◯◯', kishu:'figure' };

console.log('=== ① 積み上げの作り方 ===');
{
  ok(S.ORDER.join(',')==='monitor,light,standard,premium',
     '★★★プランの順（モニター < ライト < スタンダード < プレミアム）');
  ok(S.upFrom('monitor').join(',')==='monitor,light,standard,premium',
     '★★★モニターを選んだら上を全部');
  ok(S.upFrom('light').join(',')==='light,standard,premium',
     '★★ライトからなら3つ');
  ok(S.upFrom('premium').join(',')==='premium','★プレミアムは1つ');
  ok(S.upFrom('nope').length===0,'★知らないプランは空');
  ok(S.gradesOf('monitor')==='monitor,light,standard,premium',
     '★★★「◯◯から上」を選ぶと grades に上を全部入れる');
  ok(S.gradesOf('only:light')==='light',
     '★★★「◯◯だけ」を選ぶとそのプランだけ');
  ok(S.gradesOf('all')===''&&S.gradesOf('')==='',
     '★★「ぜんぶのプラン」は空（どのプランにも出る）');
  ok(S.lowestOf('standard,premium')==='standard',
     '★★いちばん下のプランが分かる');
  ok(S.stacked('monitor,light,standard,premium')===true
     &&S.stacked('monitor')===false&&S.stacked('')===true,
     '★★★積み上げ型になっているかが分かる');
}

console.log('=== ② 下のプランの商品が上のプランにも出る ===');
{
  const g=S.gradesOf('monitor');
  ok(S.fits(pl('monitor'),{ ...GAME, grades:g },true)
     &&S.fits(pl('light'),{ ...GAME, grades:g },true)
     &&S.fits(pl('standard'),{ ...GAME, grades:g },true)
     &&S.fits(pl('premium'),{ ...GAME, grades:g },true),
     '★★★モニターの商品はライト・スタンダード・プレミアムにも出る');
  /* ライト＝モニターの商品＋ゲームソフト全部（限定版も）。 */
  const gl=S.gradesOf('light');
  ok(S.fits(pl('light'),{ ...LTD, grades:gl },true),
     '★★★限定版のゲームはライトに出る');
  ok(!S.fits(pl('monitor'),{ ...LTD, grades:gl },true),
     '★★★その商品はモニターには出ない（下には流れない）');
  ok(/ライトから上に出す商品です/.test(
       S.fitWhy(pl('monitor'),{ ...LTD, grades:gl },true)),
     '★★★モニターで出ない理由が「ライトから上に出す商品です」');
  ok(S.fits(pl('standard'),{ ...LTD, grades:gl },true)
     &&S.fits(pl('premium'),{ ...LTD, grades:gl },true),
     '★★スタンダード・プレミアムにも出る');
  /* スタンダード＝ゲームソフト全部＋ほかの商品。 */
  const gs=S.gradesOf('standard');
  ok(S.fits(pl('standard'),{ ...FIG, grades:gs },false)
     &&S.fits(pl('premium'),{ ...FIG, grades:gs },false),
     '★★★フィギュアはスタンダードとプレミアムに出る');
  ok(!S.fits(pl('light'),{ ...FIG, grades:gs },false),
     '★★ライトには出ない');
  ok(/ゲームソフトだけのプランです/.test(
       S.fitWhy(pl('light'),{ ...FIG, grades:S.gradesOf('monitor') },false)),
     '★★★ライトはゲームソフトだけ（grades が通っても種類で外れる）');
  /* 「◯◯だけ」は上にも出さない。 */
  const go=S.gradesOf('only:light');
  ok(S.fits(pl('light'),{ ...GAME, grades:go },true)
     &&!S.fits(pl('premium'),{ ...GAME, grades:go },true),
     '★★★「ライトだけ」はプレミアムにも出さない');
  ok(/このプランには出さない商品です/.test(
       S.fitWhy(pl('premium'),{ ...GAME, grades:go },true)),
     '★★その理由を出す');
  /* ぜんぶのプラン（空）は、種類が合えばどこでも。 */
  ok(S.fits(pl('monitor'),{ ...GAME, grades:'' },true)
     &&S.fits(pl('premium'),{ ...GAME, grades:'' },true),
     '★★「ぜんぶのプラン」はどこにも出る');
}

console.log('=== ③ 1人あたりの数・1回の件数はプランごと ===');
{
  const l=S.list({});
  const q=l.map((p)=>p.key+':'+p.q+'点/'+p.n+'件').join(' ');
  console.log('   '+q);
  ok(pl('monitor').q===1&&pl('light').q===2&&pl('standard').q===5
     &&pl('premium').q===5,
     '★★★お一人◯点まではプランごと（積み上げても変わらない）');
  ok(pl('monitor').n===10&&pl('premium').n===100,
     '★★1回の件数もプランごと');
}

console.log('=== ④ Shopify のタグも上のプランまで ===');
{
  const g=S.gradesOf('monitor');
  const tags=SHOPCSV.gradeTags(g);
  console.log('   '+tags.join(','));
  ok(tags.join(',')==='grade-monitor,grade-light,grade-standard,grade-premium',
     '★★★タグも grade-monitor,grade-light,grade-standard,grade-premium');
  ok(SHOPCSV.gradeTags(S.gradesOf('only:light')).join(',')==='grade-light',
     '★★★「ライトだけ」は grade-light だけ');
  ok(SHOPCSV.gradeTags(S.gradesOf('all')).length===4,
     '★★「ぜんぶのプラン」は4つ付く（どのプランでも見える）');
  /* CSV の中身でも同じになるか。 */
  const row=SHOPCSV.rowOf({ jan:'4902370550467', name:'ふつうのゲーム',
    kishu:'NS', price:3645, max_qty:1, grades:g },{ date:new Date() });
  console.log('   Tags: '+row['Tags']);
  ok(String(row['Tags']).indexOf('grade-monitor')>=0
     &&String(row['Tags']).indexOf('grade-light')>=0
     &&String(row['Tags']).indexOf('grade-standard')>=0
     &&String(row['Tags']).indexOf('grade-premium')>=0,
     '★★★商品CSV の Tags にも上のプランまで入る');
}

console.log('=== ⑤ 選択肢（画面に出す言い方）===');
{
  const ps=S.picks({});
  console.log('   '+ps.map((x)=>x.v).join(' / '));
  ok(ps.length===8,'★★選択肢は「から上」4つ＋「だけ」3つ＋ぜんぶ');
  ok(ps[0].v==='monitor'&&/から上/.test(ps[0].label)
     &&/モニター・ライト・スタンダード・プレミアム/.test(ps[0].label),
     '★★★「モニターから上（モニター・ライト・…）」と出す');
  ok(ps.filter((x)=>x.v==='premium')[0].label==='プレミアムだけ',
     '★プレミアムは上が無いので「だけ」');
  ok(ps.filter((x)=>x.v==='only:monitor').length===1,
     '★★★「モニターだけ」も選べる（1つのプランだけに出す）');
  ok(ps[ps.length-1].v==='all','★最後は「ぜんぶのプラン」');
}

console.log('=== ⑥ pj-sync（配信）でも積み上げで出る ===');
{
  let dc=[];
  let mon=[];        // 8.43 モニターへの「今週の配信」
  globalThis.fetch=async(u,i)=>{
    const url=String(u), o=i||{};
    if(/discord\.com\/api/.test(url)){
      const cc=/\/channels\/(\d+)$/.exec(url);
      if(cc)return new Response(JSON.stringify({ id:cc[1], name:'ch',
        guild_id:'1' }),{status:200,headers:{'content-type':'application/json'}});
      const m=/\/channels\/(\d+)\/messages/.exec(url)||[];
      const bd=(()=>{ try{ return JSON.parse(String(o.body||'{}')); }
                      catch(e){ return {}; } })();
    /* 8.43 モニターへの「今週の配信」は**カードではない**（文だけの1通）。
       カードの数を見るので、別に取っておく（中身は tests/submon.mjs）。 */
      (((!bd.embeds)&&bd.content)?mon:dc).push({ ch:m[1]||'',
        method:String(o.method||'GET') });
      return new Response(JSON.stringify({ id:String(900000+dc.length) }),
        {status:200,headers:{'content-type':'application/json'}});
    }
    return new Response('{}',{status:200});
  };
  const { worker }=await loadWorker('substack');
  const env=makeEnv({ STAFF_KEY:'s', DISCORD_BOT_TOKEN:'bot' });
  const at=new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO sync_state (k,v,updated_at) VALUES ('ui.settings',?1,?2)`)
    .bind(JSON.stringify({ settings:{ subOn:true, subChMonitor:'111',
      subOnLight:true, subChLight:'222',
      subOnPremium:true, subChPremium:'444',
      subDomain:'x.myshopify.com' } }),at).run();
  await env.DB.prepare(
    `INSERT INTO mw_stock (jan,sha,idx,kishu,name,stock,row_hash,seen_at,created_at)
     VALUES ('4902370550467','いろは',0,'NS','ふつうのゲーム',9,'h',?1,?1)`)
    .bind(at).run();
  await env.DB.prepare(
    `INSERT INTO mw_amz (jan,asin,name,price,fee_total,size_tier,checked_at,
       basis,price_at) VALUES ('4902370550467','B0D1GSZJ8T','ゲーム',9000,
       1200,'s',?1,'カート',?1)`).bind(at).run();
  /* モニターから上（積み上げ型）。 */
  await env.DB.prepare(
    `INSERT INTO mw_sub (jan,on_sale,max_qty,price,grades,put_at,loaded_at,
       at,created_at) VALUES ('4902370550467',1,1,3645,?1,?2,?2,?2,?2)`)
    .bind(S.gradesOf('monitor'),at).run();
  const d=(await asJson(await worker.fetch(get('/sub/plan'),env,{}))).body;
  const n=(k)=>((d.plans||[]).filter((p)=>p.key===k)[0]||{ items:[] })
    .items.length;
  console.log('   モニター '+n('monitor')+'／ライト '+n('light')
    +'／プレミアム '+n('premium'));
  ok(n('monitor')===1&&n('light')===1&&n('premium')===1,
     '★★★同じ商品が3つのプランの予定に出る（積み上げ型）');
  dc=[];
  const r=(await asJson(await worker.fetch(
    post('/sub/send',{ approve:true }),env,{}))).body;
  console.log('   送った：'+dc.map((x)=>x.ch).join(',')+'（'+r.sent+'件）');
  ok(r.sent===3&&['111','222','444'].every((c)=>dc.some((x)=>x.ch===c)),
     '★★★3つのチャンネルにカードが出る');
  ok(dc.filter((x)=>x.method==='POST').length===3,
     '★★★上のプランには「新しいカード」として出る（通知が鳴る）');
}

console.log('=== ⑦ 画面と手順書 ===');
{
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  ok(/SUBPLAN\.picks\(/.test(html)&&/SUBPLAN\.gradesOf\(/.test(html),
     '★★★画面も shared/subplan.js の決まりを読む');
  ok(/subStackGo/.test(html)&&/積み上げ型に直す/.test(html),
     '★★★「出すプランを積み上げ型に直す」ボタンがある');
  ok(/通知が鳴ります/.test(html),
     '★★★新しいカードは通知が鳴ると画面に出す');
  const md=fs.readFileSync(
    path.join(ROOT,'pj_price_追加仕様_会員向けDiscord.md'),'utf8');
  ok(/8\.35/.test(md)&&/積み上げ/.test(md),'★★手順書に書いてある');
}

T.done();
