/* 決まり：商品ごとの送料の文（8.27・カジの依頼）

   起きていたこと（2026-11-14 のカジの報告）
     #リスト-プレミアム のカードで、フィギュア（S.H.Figuarts・
     フィギュアーツZERO など）にも
     「クリックポスト（1本 ¥200／2本以上 ¥600）」と出ていた。
     クリックポストは 34×25cm・厚さ3cm・1kg までなので箱は送れない。
     原因は、送料の**名前まで「重さの段」から取っていた**こと
     （段の名前が「クリックポスト」だった）。

   ここで当たること
     ・送り方（区分）は**商品の形**で決まる（採寸＞機種＞容積の目安）
     ・**金額は Shopify の会員便の段**から取る（⚙で直せる）
     ・大きさが分からない行は区分を**名乗らない**
     ・ゲームソフト以外は「本」ではなく「点」
     ・カードの文と CSV のタグ・Shopify に出す重さが**食い違わない**
     ・すでに送ったカードが次の配信で書き換わる（CARD_V が上がっている） */
import { harness } from './lib.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const A=require('../shared/shopcsv.js');
const C=require('../shared/subcard.js');
const T=harness('決まり：商品ごとの送料の文（8.27）');
const ok=T.ok;
const ROOT=path.resolve(new URL('.',import.meta.url).pathname,'..');

/* ---- 1. 送り方（区分）の判定 ---- */
{
  /* ゲームソフト（機種がゲーム機）＝薄物。 */
  const g=A.shipWay({ kishu:'NS' });
  ok(g.key==='cp'&&g.name==='クリックポスト'&&g.thin&&g.sure,
     '★★★機種がゲーム機ならクリックポスト');
  ok(A.shipWay({ kishu:'NS2' }).key==='cp'
     &&A.shipWay({ kishu:'PS5' }).key==='cp',
     '★NS2・PS5 も薄物');
  /* フィギュア（採寸なし）＝名乗らない。 */
  const f=A.shipWay({ kishu:'figure', size_g:200 });
  ok(!f.sure&&!f.name,'★★★フィギュアで採寸が無ければ区分を名乗らない');
  ok(/採寸/.test(f.why),'★なぜ決まらないかを返す');
  /* 採寸があれば入るいちばん小さい送り方。 */
  ok(A.shipWay({ kishu:'figure', size_long:19, size_wid:13.5, size_hei:1.5,
                 size_g:110 }).key==='cp',
     '★★★3cm 以内・1kg 以内ならクリックポスト（機種は見ない）');
  ok(A.shipWay({ kishu:'figure', size_long:18, size_wid:11, size_hei:7,
                 size_g:350 }).key==='letter',
     '★★★A4 に入る厚いものはレターパックプラス');
  ok(A.shipWay({ kishu:'figure', size_long:24, size_wid:19, size_hei:4.5,
                 size_g:600 }).key==='letter',
     '★厚さ5cm 未満でも A4 に入ればレターパックプラス');
  ok(A.shipWay({ kishu:'figure', size_long:25, size_wid:20, size_hei:5,
                 size_g:4500 }).key==='compact',
     '★★★4kg を超えたらレターパックプラスは使えない（宅急便コンパクト）');
  ok(A.shipWay({ kishu:'figure', size_long:30, size_wid:20, size_hei:20,
                 size_g:1200 }).key==='box80',
     '★★★三辺合計 70cm は 80サイズ');
  ok(A.shipWay({ kishu:'figure', size_long:20, size_wid:20, size_hei:15,
                 size_g:1500 }).key==='box60',
     '★三辺合計 55cm・2kg 以内は 60サイズ');
  ok(A.shipWay({ kishu:'figure', size_long:50, size_wid:40, size_hei:30,
                 size_g:8000 }).key==='box',
     '★大きいものは 100サイズ以上');
  /* 1kg を超えた薄物はクリックポストに入らない。 */
  ok(A.shipWay({ kishu:'NS', size_long:19, size_wid:13.5, size_hei:1.5,
                 size_g:1500 }).key!=='cp',
     '★★★1kg を超えたらクリックポストではない');
  /* 限定版の箱（機種はゲームでも採寸が勝つ）。 */
  const ltd=A.shipWay({ kishu:'NS', size_long:30, size_wid:25, size_hei:8,
                        size_g:900 });
  ok(ltd.key!=='cp'&&!ltd.thin,
     '★★★機種がゲームでも、限定版の箱は宅配便（採寸が優先）');
  /* 容積だけのとき（厚さが分からない）＝目安・名乗らない。 */
  const e=A.shipWay({ kishu:'figure', size_cm3:4000, size_g:400 });
  ok(e.name&&!e.sure&&/容積/.test(e.why),
     '★★★容積だけのときは目安（要確認）として出す');
}

/* ---- 2. 手で上書き・⚙ ---- */
{
  const h=A.shipWay({ kishu:'figure', size_g:400, ship_way:'compact' });
  ok(h.key==='compact'&&h.sure&&/手/.test(h.why),
     '★★★手で選んだ区分が最優先');
  ok(A.shipWay({ kishu:'figure', size_long:30, size_wid:20, size_hei:20,
                 ship_way:'cp' }).key==='cp',
     '★手で選べば採寸より強い');
  /* ⚙で機種を足す／外す。 */
  ok(A.shipWay({ kishu:'GF' },{ thinKishu:'GF,FIG' }).key==='cp',
     '★★★⚙で薄物の機種を足せる');
  ok(A.shipWay({ kishu:'NS2' },{ thinKishu:'-NS2' }).sure===false,
     '★★★⚙で薄物から外せる（- を付ける）');
  ok(A.isThinKind({ kishu:'ns' },{ thinKishu:'NS' }),
     '★機種の大文字小文字は区別しない');
  ok(A.wayOf('small').key==='cp'&&A.wayOf('宅急便コンパクト').key==='compact'
     &&A.wayOf('nope')===null,
     '★区分の言い方（1点ものの small も）を受け取れる');
}

/* ---- 3. 単位（本／点） ---- */
{
  ok(A.shipUnit({ kishu:'NS' })==='本','★★★ゲームソフトは「本」');
  ok(A.shipUnit({ kishu:'figure' })==='点',
     '★★★ゲームソフト以外は「点」');
  const st=A.shipSteps(350,{ unit:'点' });
  ok(st.text.indexOf('点')>=0&&st.text.indexOf('本')<0,
     '★★★段の文の単位も変わる');
}

/* ---- 4. 会員便の段（⚙） ---- */
{
  const d=A.tiersOf('');
  ok(d===A.SHIP_TIERS,'★空なら既定の段');
  const x=A.tiersOf('250:200／350:300／0:600');
  ok(x.length===3&&x[0].g===250&&x[0].yen===200&&x[2].g===0&&x[2].yen===600,
     '★★★⚙の段を読める（全角の／も）');
  const y=A.tiersOf('500:300,250:150');
  ok(y[0].g===250&&y[1].g===500&&y[2].g===0,
     '★★★軽い順にそろえ、上限なしの段を足す');
  ok(A.tiersOf('あ:い')===A.SHIP_TIERS,'★読めない文字は既定に戻す');
  /* 金額は段から取る（コードに直書きしない）。 */
  const s2=A.shipSteps(100,{ tiers:A.tiersOf('250:250／0:900') });
  ok(/¥250/.test(s2.text)&&/¥900/.test(s2.text)
     &&!/¥200/.test(s2.text),
     '★★★カードの金額は⚙の段から出す');
}

/* ---- 5. カードに出る文 ---- */
{
  const ship=(x,o)=>{
    const e=C.card(x,o||{});
    return e.fields.filter((y)=>y.name==='送料')[0].value;
  };
  const game={ jan:'4500000000001', name:'ゲーム', kishu:'NS', price:5000,
               qty:3 };
  ok(ship(game,{ gameG:100 })
     ==='クリックポスト（1〜2本 ¥200／3本 ¥300／4本以上 ¥600）',
     '★★★ゲームソフトは今までの文のまま');
  const fig={ jan:'4500000000002', name:'S.H.Figuarts', kishu:'figure',
              price:9000, qty:2, size_g:350, size_long:18, size_wid:11,
              size_hei:7 };
  const t=ship(fig,{});
  ok(t.indexOf('クリックポスト')<0,
     '★★★フィギュアの箱に「クリックポスト」と出さない（カジの報告）');
  ok(t.indexOf('レターパックプラス')===0&&t.indexOf('点')>0,
     '★★★採寸から区分を出し、単位は「点」');
  const fig2=Object.assign({},fig,{ size_long:0, size_wid:0, size_hei:0 });
  ok(ship(fig2,{})===A.SHIP_UNSURE
     &&/お会計/.test(ship(fig2,{})),
     '★★★大きさが分からない行は「送料はお会計で表示」');
  /* プランごとの⚙の文は**薄物だけ**に使う。 */
  const pl='クリックポスト（1〜2本 ¥200／3本以上 送料無料）';
  ok(ship(game,{ gameG:100, shipText:pl })===pl,
     '★★★⚙の文はゲームソフトにはそのまま使う');
  ok(ship(fig,{ shipText:pl })!==pl,
     '★★★⚙の文を箱ものには使わない（これも「クリックポスト」の元だった）');
  /* 1点もの（カジが区分を選んだ行）はその名前をそのまま出す。 */
  ok(ship({ jan:'', one_id:3, name:'1点もの', price:3000, qty:1,
            ship_kind:'box' },{ shipText:A.oneShipName('box') })==='宅配便',
     '★1点ものはカジが選んだ区分をそのまま出す');
}

/* ---- 6. CSV・Shopify と食い違わないか（カジの依頼4） ---- */
{
  const rows=[
    { jan:'4500000000001', kishu:'NS', size_g:118 },
    { jan:'4500000000002', kishu:'NS', size_long:30, size_wid:25, size_hei:8,
      size_g:900 },
    { jan:'4500000000003', kishu:'figure', size_long:18, size_wid:11,
      size_hei:7, size_g:350 },
    { jan:'4500000000004', kishu:'figure', size_long:30, size_wid:20,
      size_hei:20, size_g:1200 },
    { jan:'4500000000005', kishu:'figure', size_g:200 },
    { jan:'4500000000006', kishu:'figure', size_long:19, size_wid:13.5,
      size_hei:1.5, size_g:110 }
  ];
  const o={ gameG:100, tiers:A.tiersOf('250:200／350:300／0:600') };
  let bad=[], money=[], unit=[];
  for(const r of rows){
    const w=A.shipWay(r,o);
    const tag=A.shipTag(r,o);
    if(w.sure&&w.name&&((w.thin?A.SHIP_SMALL:A.SHIP_BOX)!==tag))
      bad.push(r.jan);
    /* カードの文の金額が、Shopify に出す重さの段と合っているか。 */
    const g=A.weightOf(r,o);
    const line=A.shipLine(r,o);
    if(w.sure&&g>0){
      const yen=A.tierOf(g,o.tiers).yen;
      if(line.indexOf('¥'+yen)<0)money.push(r.jan);
      const u=A.shipUnit(r,o);
      if(line.indexOf('1'+u)<0&&line.indexOf('〜')<0)unit.push(r.jan);
    }
  }
  ok(!bad.length,'★★★カードの区分と CSV のタグ（ship-small／ship-box）が合う'
     +(bad.length?('：'+bad.join(',')):''));
  ok(!money.length,
     '★★★カードの金額が Shopify に出す重さの段と合う'
     +(money.length?('：'+money.join(',')):''));
  ok(!unit.length,'★1点ぶんの額が必ず入っている'
     +(unit.length?('：'+unit.join(',')):''));
  /* Shopify に出す重さ。箱と分かった行は一律にしない。 */
  ok(A.weightOf({ kishu:'NS', size_g:118 },{ gameG:100 })===100,
     '★★★ゲームソフトは一律 100g のまま（6.183）');
  ok(A.weightOf({ kishu:'NS', size_long:30, size_wid:25, size_hei:8,
                  size_g:900 },{ gameG:100 })===900,
     '★★★採寸で箱と分かったゲームは一律にしない（段が実費とずれるため）');
  /* タグ。 */
  ok(A.shipTag({ kishu:'figure', size_long:18, size_wid:11, size_hei:7,
                 size_g:350 })===A.SHIP_BOX,
     '★厚い箱は ship-box');
  ok(A.tagsOf({ jan:'4500000000003', kishu:'figure', size_long:18,
                size_wid:11, size_hei:7, size_g:350 },{})
       .indexOf(A.SHIP_BOX)>=0,
     '★★★CSV のタグにも ship-box が入る');
}

/* ---- 7. すでに送ったカード（カジの依頼5） ---- */
{
  /* 版は上がり続けるので、**8.27 の前（6.194）より新しい**ことで見る
     （次の直しで版を上げてもこのテストは落ちない）。 */
  ok(parseFloat(C.CARD_V)>6.194,
     '★★★カードの形の版を上げた（次の配信で古いカードも書き換わる）');
  ok(C.CARD_V!=='6.194','★前の版と違う（同じだと書き換わらない）');
}

/* ---- 8. 決まりが1か所にあるか ---- */
{
  /* コメント（説明文）は見ない。**動くコード**に直書きしていないかを見る。 */
  const bare=(f)=>fs.readFileSync(path.join(ROOT,f),'utf8')
    .replace(/\/\*[\s\S]*?\*\//g,' ').replace(/^\s*\/\/.*$/gm,' ');
  const card=bare('shared/subcard.js');
  ok(!/クリックポスト（/.test(card),
     '★★★subcard.js に送料の文を直書きしない（表は shopcsv.js の1か所）');
  ok(/shipLine/.test(card),'★カードは shipLine を呼ぶ');
  const w=bare('proxy-sync/worker.js');
  ok(/SHOPCSV\.shipWay/.test(w)&&/SHOPCSV\.shipLine/.test(w),
     '★pj-sync も同じ判定を使う');
  ok(!/クリックポスト/.test(w),
     '★★★worker.js に送り方の名前を直書きしない');
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  ok(/mwSubTiers/.test(html)&&/mwSubThinKishu/.test(html)
     &&/mwSubBoxMin/.test(html),
     '★★★⚙に段・薄物の機種・箱ものの下限の欄がある');
  ok(/PJ_SHOPCSV\.shipWay/.test(html)&&/PJ_SHOPCSV\.shipUnit/.test(html),
     '★画面も同じ判定を使う');
  const mig=fs.readFileSync(
    path.join(ROOT,'proxy-sync/migrate-0060-ship-way.sql'),'utf8');
  ok(/mw_sub ADD COLUMN ship_way/.test(mig)
     &&/mw_amz ADD COLUMN size_wid/.test(mig)
     &&/mw_amz ADD COLUMN size_hei/.test(mig),
     '★★★migrate-0060 で手の上書きと採寸（短辺・厚さ）を足す');
  const sch=fs.readFileSync(path.join(ROOT,'proxy-sync/schema.sql'),'utf8');
  ok(/ship_way/.test(sch)&&/size_wid/.test(sch)&&/size_hei/.test(sch),
     '★schema.sql にも入っている');
}

T.done();
