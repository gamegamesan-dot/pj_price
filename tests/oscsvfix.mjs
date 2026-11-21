/* 海外向け Shopify の商品CSV（os-）の直し（8.73・カジの報告）
   MW 無在庫の本格出品（18件）で見つかったこと。
   ・Vendor／Type に会員プランのバリアント番号（数字）が入っていた
     → Vendor＝その行のブランド、Type＝その行の商品の種類。数字だけの値は出さない
   ・Status=active／Published=true だった → 既定は draft／false（⚙で切り替え）
   ・Body が eBay 用の出品文そのままだった → Shopify 用の説明を別に組み立てる
   ・Tags に日本語（フィギュア）が入っていた → 英語にする
   あわせて 8.74（メーカー名は商品名の末尾の【 】）と、英題の Worker（8.75・8.76）。 */
import path from 'node:path';
import OSS from '../shared/osscsv.js';
import MWFEE from '../shared/mwfee.js';
import MWCSV from '../shared/mwcsv.js';
import { harness, ROOT } from './lib.mjs';
const T=harness('海外向け Shopify の商品CSV の直し・メーカー名・英題の Worker');
const ok=T.ok;

const item=(x)=>Object.assign({ jan:'4528272010290',
  titleEn:'Keys Factory Card Pod Collection Splatoon Raiders Nintendo Switch 2 Japan',
  vendor:'Keys Factory', type:'Video Game Accessory', platform:'Nintendo Switch 2',
  cond:'new', stockPhoto:true, kishu:'NS2H', usd:30, qty:1, grams:200, cost:1200,
  pics:[{url:'https://img.test/i/20261118/a.jpg'}],
  descHtml:'<div><p>message us through eBay first</p></div>' },x||{});
/* カジの⚙に入っていた値（会員プランのバリアント番号）。 */
const BAD={ fx:150, pct:100, vendor:'67979822694563', type:'67979822727331' };

console.log('=== Vendor と Type ===');
{
  const r=OSS.rowOf(item(),BAD);
  ok(r['Vendor']==='Keys Factory','★★★Vendor はその行のブランド');
  ok(r['Type']==='Video Game Accessory','★★★Type はその行の商品の種類');
  const r2=OSS.rowOf(item({vendor:'',type:''}),BAD);
  ok(r2['Vendor']===''&&r2['Type']==='',
     '★★★行に無くても、⚙の**数字だけの値**（ID の取り違え）は出さない');
  const r3=OSS.rowOf(item({vendor:'',type:''}),{fx:150,pct:100,vendor:'Play Japan',type:'Toy'});
  /* 8.85（カジの依頼）販売元は、行に無ければ**空欄**（⚙の代わりの名前は
     もう使わない）。Type は今までどおり⚙の値を使う。 */
  ok(r3['Vendor']===''&&r3['Type']==='Toy',
     '★★行に無いとき：Type は⚙の値（言葉）・Vendor は空欄（8.85）');
  ok(OSS.word('67979822694563')===''&&OSS.word('30MM')==='30MM'&&OSS.word('2024')==='2024',
     '★★数字だけの長い値だけを捨てる（30MM・2024 は残す）');
}

console.log('\n=== Status と Published ===');
{
  const r=OSS.rowOf(item(),BAD);
  ok(r['Status']==='draft'&&r['Published']==='false',
     '★★★既定は下書き・非公開（draft／false）');
  const r2=OSS.rowOf(item(),Object.assign({},BAD,{status:'active'}));
  ok(r2['Status']==='active'&&r2['Published']==='true','★★⚙で「公開」にすると active／true');
  /* 直しの CSV：⚙が下書きのあいだは公開にしない。品切れは下書き。 */
  const u=OSS.updRowOf(item({qty:2}),BAD), u0=OSS.updRowOf(item({qty:0}),BAD);
  ok(u['Status']==='draft','★★★直しCSV も、⚙が下書きのあいだは公開にしない');
  ok(u0['Status']==='draft','★品切れは下書き（今までどおり）');
  const ua=OSS.updRowOf(item({qty:2}),Object.assign({},BAD,{status:'active'}));
  ok(ua['Status']==='active','★★⚙が「公開」なら、在庫が戻った商品は公開（今までどおり）');
}

console.log('\n=== 説明（Shopify 用を別に作る）===');
{
  const b=OSS.rowOf(item(),BAD)['Body (HTML)'];
  console.log('   '+b.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,260));
  ok(!/ebay/i.test(b),'★★★eBay の文が1つも入らない（message us through eBay など）');
  ok(!/shopify/i.test(b),'★★★Shopify の名前も入れない');
  ok(!/best offer|shipping and payments|this listing|import duties/i.test(b),
     '★★eBay の画面の言葉（Best Offer・Shipping and payments・関税の前払い）が無い');
  ok(b.includes('Keys Factory Card Pod Collection Splatoon Raiders'),'★★商品名が入る');
  ok(/Brand: Keys Factory/.test(b)&&/Type: Video Game Accessory/.test(b)
     &&/Platform: Nintendo Switch 2/.test(b)&&/Condition: Brand new/.test(b),
     '★★ブランド・種類・機種・状態（行が持っている事実だけ）');
  ok(/not photographs of the individual copy/.test(b),
     '★★★無在庫の行は「写真は届く1点のものではない」と書く');
  ok(!/inspected by hand|checked by hand|hand inspection/i.test(b),
     '★★★「手で検品した」とは書かない');
  ok(/contact us first/.test(b)&&/shown at checkout/.test(b),'★困ったときと配送の案内');
  const b2=OSS.rowOf(item({vendor:'',type:'',platform:'',stockPhoto:false}),BAD)['Body (HTML)'];
  ok(!/Brand:|Type:|Platform:/.test(b2),'★★★分からない項目は行ごと出さない（推測で埋めない）');
  ok(!/67979822/.test(b2),'★★ID の取り違えが説明にも出ない');
  const b3=OSS.rowOf(item({notes:['Region locked to Japanese systems.',
    'Ask via eBay messages.']}),BAD)['Body (HTML)'];
  ok(/Region locked/.test(b3)&&!/eBay/.test(b3),'★★注意書きは持ち込むが、eBay の名前が入ったものは外す');
  ok(OSS.whyNot(item({descHtml:''}),BAD)==='',
     '★★eBay の出品文が無くても Shopify 用は作れる（別に作るため）');
}

console.log('\n=== Tags（英語）===');
{
  const t=(k)=>OSS.rowOf(item({kishu:k}),BAD)['Tags'];
  ok(t('b2cchara_figure')==='export, Figure','★★★フィギュア → Figure（日本語を出さない）');
  ok(t('plasticmodel')==='export, Model Kit','★★プラモデル → Model Kit');
  ok(t('NS2H')==='export, Nintendo Switch 2','★★NS2H → Nintendo Switch 2');
  ok(t('3DS')==='export, Nintendo 3DS','★3DS も英語（ニンテンドー3DS と出さない）');
  ok(t('謎の機種')==='export','★★英語の呼び名が分からない記号は付けない');
  ok(!/[^\x20-\x7E]/.test(t('figure')+t('WIN')+t('PV')),'★★★どのタグにも日本語が入らない');
  ok(!/member-list|grade-/.test(t('NS')),'★会員の印は付けない（今までどおり）');
  ok(MWFEE.kishuPlat('P5')==='ps5'&&MWFEE.kishuPlat('NS2H')==='switch2'
     &&MWFEE.kishuPlat('XB')==='','★★機種 → ゲーム機の印（はっきり決まるものだけ）');
}

console.log('\n=== メーカー名は商品名の末尾の【 】（8.74）===');
{
  ok(MWCSV.makerOf('カードポッド スプラトゥーン【キーズファクトリー 】')==='キーズファクトリー',
     '★★★末尾の【 】を読む（中の空白は落とす）');
  ok(MWCSV.makerOf('アニメ BD【エイベックス・ピクチャーズ 】　')==='エイベックス・ピクチャーズ',
     '★★後ろに空白があっても読む');
  ok(MWCSV.makerOf('【特典付き】ソフト名')==='','★★★途中・先頭の【 】は読まない');
  ok(MWCSV.makerOf('ただの商品名')==='','★無ければ空');
  ok(MWCSV.nameNoMaker('カードポッド【キーズファクトリー 】')==='カードポッド',
     '★メーカー名を外した商品名');
  const d=MWCSV.parse('JAN,社,機種,商品名,定価,発売日,新・中,卸値,掲載数,備考,出荷日\n'
    +'4528272010290,MC02,NS2H,カードポッド【キーズファクトリー 】,1500,2026/06/05,新,1200,10,,即日\n'
    +'4528272010306,ST00,NS,ソフト名,1500,2026/06/05,新,1200,10,,即日\n');
  ok(d.rows[0].sha==='MC02'&&d.rows[0].maker==='キーズファクトリー',
     '★★★「社」は売主のコードのまま・メーカー名は商品名から');
  ok(d.rows[1].maker==='','★【 】が無い行は空');
  ok(d.maker_from_name===1&&d.maker_examples[0]==='キーズファクトリー',
     '★★読めた行の数と例を返す（取り込みの結果に出す）');
}

console.log('\n=== 英題の Worker（8.75・8.76）===');
{
  const m=await import('file://'+path.join(ROOT,'proxy-title/worker.js')+'?t='+Date.now());
  const { figCodesIn, figCodeFill, figBrand, FIG_SYSTEM }=m.__test;
  ok(figBrand('エイベックス・ピクチャーズ')==='Avex Pictures',
     '★★★エイベックス・ピクチャーズ → Avex Pictures（A-Pictures にしない）');
  ok(figBrand('キーズファクトリー')==='Keys Factory','★★キーズファクトリー → Keys Factory');
  ok(/model_kit/.test(FIG_SYSTEM)&&/NEVER drop it/.test(FIG_SYSTEM)
     &&/never write "Figure"/.test(FIG_SYSTEM),
     '★★★指示文：プラモデルは Figure と書かない・かっこの中を落とさない');
  ok(/LAST 【 】/.test(FIG_SYSTEM)&&/Avex Pictures/.test(FIG_SYSTEM),
     '★★指示文：末尾の【 】はメーカー名・別の会社の名前にしない');
  const codes=figCodesIn('30MM 1/144 オプションパーツセット（bEXM-40）[グリーン]【BANDAI SPIRITS 】');
  ok(codes.join(',')==='bEXM-40','★★★かっこの中の型番を拾う：'+codes.join(','));
  ok(figCodesIn('ソフト名（PS5）【Ver2】').length===0,
     '★★PS5・Ver2 のような語は型番と取り違えない');
  ok(figCodesIn('商品【KCP-004-1】').length===0,
     '★★末尾の【 】（メーカー名の場所）は型番として見ない');
  ok(figCodesIn('カードポッド（KCP-004-1）【キーズファクトリー 】').join(',')==='KCP-004-1',
     '★ハイフンが2つの型番も拾う');
  const f={brand:'Bandai Spirits',series:'',chara:'',item_name:'',variant:'Green',line:'30MM'};
  const add=figCodeFill(f,'30MM（bEXM-40）[グリーン]');
  ok(add.join(',')==='bEXM-40'&&f.variant==='Green bEXM-40',
     '★★★AI が落とした型番を版に足す：'+f.variant);
  const f2={brand:'',series:'',chara:'',item_name:'bEXM-40 Option Parts',variant:'',line:''};
  ok(figCodeFill(f2,'30MM（bEXM-40）').length===0&&f2.variant==='',
     '★★もう入っている型番は二重に足さない');
}

T.done();
