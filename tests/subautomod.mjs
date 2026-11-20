/* 共有：会員向けの自動配信の決まり（8.80・shared/subauto.js）

   カジの依頼（2026-11-20）「会員向けの商品リスト配信（Discord）を自動にする」
     ① 配信の時刻は1日2回（既定 12時と20時）。⚙で変えられる。
        **夜中（0:00〜8:00）は配信しない**
     ② 配信前のチェック（1つでも当たった行は配信しない）
        利益がマイナス／目標利益の下限を下回る／相場が取れていない／
        写真がない（⚙・既定オフ）／商品名が崩れている（英数字だけ・極端に短い）／
        採寸がない／ポスター／MW で在庫切れ
     ③ 1回の配信件数の上限（商品の数。プランを順に1件ずつ）
     ④ 積み上げ型：同じ商品はいちばん下のプランに寄せる
     ⑤ 運営への報告（プラン別の件数・止めた件数と理由・売り切れ・失敗）。
        **@everyone・@here は使わない**
     ⑥ 会員価格の⚙の読み方（shared/subprice.js の optOf）は画面と同じ
     ⑦ Shopify に送る商品の形（shared/shopcsv.js の apiOf）は
        **非公開（UNLISTED）**・画像なし・卸値や仕入れ元を入れない */
import { harness } from './lib.mjs';
import fs from 'node:fs';
import SUBAUTO from '../shared/subauto.js';
import SUBPX from '../shared/subprice.js';
import SHOPCSV from '../shared/shopcsv.js';
import SUBPLAN from '../shared/subplan.js';
const T=harness('共有：会員向けの自動配信の決まり（8.80）');
const ok=T.ok;
const A=SUBAUTO;

console.log('=== ① 配信の時刻と夜中の止め ===');
{
  const d=A.hoursOf('');
  console.log('   既定 '+JSON.stringify(d.hours));
  ok(d.hours.join(',')==='12,20'&&d.dflt===true,
     '★★★空（未設定）なら 12時と20時の1日2回');
  ok(A.hoursOf('9, 15,21').hours.join(',')==='9,15,21','★★⚙で時刻を変えられる');
  ok(A.hoursOf('20時・12時').hours.join(',')==='12,20',
     '★「12時」「・」の書き方でも読める（小さい順にそろえる）');
  ok(A.hoursOf('12:00 20:30').hours.join(',')==='12,20','★「12:00」も読める');
  const n=A.hoursOf('0,3,7,8,23');
  console.log('   0,3,7,8,23 → '+JSON.stringify(n));
  ok(n.hours.join(',')==='8,23'&&n.night.join(',')==='0,3,7',
     '★★★0〜7時（夜中）は使わない。8時からは使う');
  ok(A.hoursOf('12,12,20').hours.length===2,'★同じ時刻は1回だけ');
  const b=A.hoursOf('12,abc,25');
  ok(b.hours.join(',')==='12'&&b.bad.length===2,'★読めない言葉は使わずに返す');
  ok(A.hoursOf('8,9,10,11,12,13,14,15').hours.length===A.HOURS_MAX,
     '★1日の回数に上限がある（'+A.HOURS_MAX+'回）');
  for(let h=0;h<8;h++)
    if(!A.isNight(h)){ ok(false,'夜中の判定 '+h); }
  ok([0,1,2,3,4,5,6,7].every((h)=>A.isNight(h))&&!A.isNight(8)&&!A.isNight(23),
     '★★★夜中は 0:00〜8:00');
  ok(A.dueOf([12,20],{hour:12,dow:3})===true,'★★配信の時刻なら走る');
  ok(A.dueOf([12,20],{hour:13,dow:3})===false,'★★時刻でなければ走らない');
  ok(A.dueOf([3,12],{hour:3,dow:3})===false,
     '★★★夜中の時刻が紛れ込んでも走らない（二重の歯止め）');
  ok(A.dueOf([12],{hour:12,dow:6},false)===false
     &&A.dueOf([12],{hour:12,dow:0},false)===false
     &&A.dueOf([12],{hour:12,dow:1},false)===true,
     '★⚙「土日も配信する」を切ると土日は走らない');
  ok(A.dueOf([12],{hour:12,dow:6})===true,'★既定は土日も走る');
  ok(A.slotOf('2026-11-20',9)==='2026-11-20@09','★回の印は 日＋時');
  const nx=A.nextOf([12,20],{hour:13,dow:5},true);
  ok(nx&&nx.add===0&&nx.hour===20,'★次の回：今日の20時');
  const nx2=A.nextOf([12,20],{hour:21,dow:5},false);
  ok(nx2&&nx2.add===3&&nx2.hour===12&&nx2.dow===1,
     '★次の回：金曜の夜→（土日を飛ばして）月曜の12時');
  ok(A.nextOf([],{hour:1,dow:1},true)===null,'★時刻が無ければ次の回も無い');
  ok(A.maxOf('')===A.MAX_DEF&&A.maxOf(0)===A.MAX_DEF&&A.maxOf(7)===7
     &&A.maxOf(9999)===A.MAX_CAP,'★★1回の上限は⚙（空なら '+A.MAX_DEF+'件）');
}

console.log('\n=== ② 配信前のチェック ===');
const good={ stock:8, gone:0, amz_price:9000, fee_total:1200, price:3500,
             fit:true, net:1200, gross:4300, name:'テストのゲームソフト 通常版',
             ship_sure:true, pics_ok:0, ng_kind:'' };
const g=(o,opt)=>A.gate(Object.assign({},good,o),opt||{});
{
  ok(g({}).length===0,'★★★どれにも当たらない行は配信してよい');
  ok(g({net:-50,fit:false}).join()==='loss','★★★利益がマイナス → 止める');
  ok(g({net:200,fit:false}).join()==='low',
     '★★★目標利益の下限を下回る → 止める');
  ok(g({net:null,gross:-10,fit:false}).join()==='loss',
     '★手残りを使わない設定のときは粗利で見る');
  ok(g({amz_price:0}).join()==='no_px','★★★相場（Amazon の値段）が無い → 止める');
  ok(g({fee_total:0}).join()==='no_px','★★手数料が取れていない → 止める');
  ok(g({price:0}).join()==='no_px','★会員価格が出せない → 止める');
  ok(g({net_unknown:true,net:null}).join()==='no_px',
     '★手残りが出せなかった行は 0円と混ぜずに止める');
  ok(g({pics_ok:0}).length===0,
     '★★★写真が無くても、既定では止めない（カードに写真を載せていないため）');
  ok(g({pics_ok:0},{needPic:true}).join()==='no_pic',
     '★★★⚙を入れたら、写真が無い行を止める');
  ok(g({pics_ok:2},{needPic:true}).length===0,'★写真があれば通る');
  ok(g({name:'ABC-123 XZ'}).join()==='name','★★★英数字だけの名前 → 止める');
  ok(g({name:'ゲーム'}).join()==='name','★★★極端に短い名前 → 止める');
  ok(A.nameBad('ABC-123 XZ')==='ascii'&&A.nameBad('ゲーム')==='short'
     &&A.nameBad('ﾃｽﾄのｹﾞｰﾑｿﾌﾄ')===''&&A.nameBad('Ｓｗｉｔｃｈ用ソフト')==='',
     '★半角カナ・全角英数の名前は崩れていると見なさない');
  ok(g({ship_sure:false}).join()==='no_dim','★★★採寸がない → 止める');
  ok(g({name:'テストのゲーム B2ポスター付き'}).join()==='poster',
     '★★★ポスター → 止める');
  ok(g({ng_kind:'タペストリー'}).join()==='ng_kind',
     '★⚙「出さない種類」に当たった品も止める');
  ok(g({stock:0}).indexOf('no_stock')===0&&g({gone:1}).indexOf('no_stock')===0,
     '★★★MW で在庫切れ（0点・CSV から消えた）→ 止める');
  const many=g({stock:0,amz_price:0,name:'X1',ship_sure:false},{needPic:true});
  console.log('   いくつも当たる行 '+JSON.stringify(many));
  ok(many.join()==='no_stock,no_px,name,no_dim,no_pic',
     '★★1行にいくつも当たれば、ぜんぶ返す（見る順に並ぶ）');
  const txt=A.whyText(['name','no_dim'],{ name:'AB' });
  console.log('   文 '+txt);
  ok(txt==='商品名が崩れている（短すぎる）／採寸がない','★理由の文');
  ok(A.whyText(['ng_kind'],{ ng_kind:'タペストリー' })==='出さない種類（タペストリー）',
     '★出さない種類は言葉も出す');
  const want=['利益がマイナス','目標利益の下限を下回る','相場が取れていない',
              '写真がない','商品名が崩れている','採寸がない','ポスター',
              'MW で在庫切れ'];
  ok(want.every((w)=>A.WHY.some((x)=>x.ja===w)),
     '★★★カジの8つの条件が、ぜんぶ表にある');
  const t=A.tally([{why:['no_dim']},{why:['no_dim','no_pic']},{why:['low']}]);
  ok(t.no_dim===2&&t.no_pic===1&&t.low===1,'★理由ごとの件数');
  ok(A.tallyLines(t).join('|')==='・目標利益の下限を下回る：1件|・採寸がない：2件|・写真がない：1件',
     '★件数の行は表の並びで出す');
}

console.log('\n=== ③ 1回の配信件数の上限 ===');
{
  const it=(k,n)=>Array.from({length:n},(_,i)=>({ jan:k+String(i) }));
  const plans=[{key:'monitor',items:it('m',3)},{key:'light',items:it('l',5)},
               {key:'standard',items:it('s',5)}];
  const c=A.capPick(plans,6);
  console.log('   '+c.plans.map((p)=>p.key+'='+p.items.length).join(' ')
    +' 外した '+c.cut);
  ok(c.jans.length===6,'★★★新しく出す商品は上限まで');
  ok(c.plans.every((p)=>p.items.length===2),
     '★★プランを順に1件ずつ取る（どのプランも0件にならない）');
  ok(c.cut===13-6,'★外した件数を返す');
  /* 同じ商品が2つのプランにあるときは1件と数える。 */
  const c2=A.capPick([{key:'light',items:[{jan:'a'},{jan:'b'}]},
                      {key:'standard',items:[{jan:'a'},{jan:'c'}]}],2);
  console.log('   同じ商品 '+JSON.stringify(c2.plans.map((p)=>p.items.map((x)=>x.jan))));
  ok(c2.jans.sort().join()==='a,b'
     &&c2.plans[1].items.map((x)=>x.jan).join()==='a',
     '★★★同じ商品は1件と数え、上のプランにも残る');
  ok(A.capPick(plans,999).cut===0,'★上限に届かなければ外さない');
}

console.log('\n=== ④ 積み上げ型：いちばん下のプランに寄せる ===');
{
  const low=A.lowest([{key:'premium',items:[{jan:'a'},{jan:'b'}]},
                      {key:'light',items:[{jan:'a'}]},
                      {key:'standard',items:[{jan:'b'},{jan:'c'}]}],SUBPLAN.ORDER);
  const by={}; low.forEach((x)=>{ by[x.jan]=x.plan; });
  console.log('   '+JSON.stringify(by));
  ok(by.a==='light'&&by.b==='standard'&&by.c==='standard',
     '★★★同じ商品は下のプランに寄せる');
  ok(SUBPLAN.gradesOf(by.a)==='light,standard,premium',
     '★★★そこから上のプランにも出る（積み上げ型）');
  ok(low.length===3,'★商品は1つずつ');
}

console.log('\n=== ⑤ 運営への報告 ===');
{
  const rep=A.report({ slot:'2026-11-20@12', sent:7, edited:2, stop_n:40,
    sold_out:3, act_n:35,
    plans:[{name:'モニター',add:5,edit:0},{name:'ライト',add:2,edit:2},
           {name:'プレミアム',add:0,edit:0}],
    tally:{ low:30, no_dim:8, poster:2 },
    skip:{ 'Amazon 本体あり':4 },
    shop:{ made:6, fail:1, zero:3, back:0 },
    errors:['Shopify：Shopify の返事が HTTP 500 でした（1件）'],
    stops:Array.from({length:30},(_,i)=>({ jan:'49000000000'+String(10+i),
      name:'採寸の無いフィギュア その'+i, why:['no_dim'] })) });
  const all=rep.head.concat(...rep.blocks).join('\n');
  console.log(all.split('\n').slice(0,14).map((x)=>'   '+x).join('\n'));
  ok(/配信した件数：\*\*7件\*\*（モニター 5件／ライト 2件（書き換え 2件））/.test(all),
     '★★★配信した件数（プラン別）');
  ok(/止めた件数：\*\*40件\*\*/.test(all)&&/目標利益の下限を下回る：30件/.test(all)
     &&/採寸がない：8件/.test(all),'★★★止めた件数と理由');
  ok(/売り切れにした件数：\*\*3件\*\*/.test(all),'★★★売り切れにした件数');
  ok(/呼び出しの失敗/.test(all)&&/HTTP 500/.test(all),
     '★★★Discord・Shopify の呼び出しの失敗も知らせる');
  ok(/作った 6件／作れなかった 1件／在庫を0にした 3件/.test(all),
     '★Shopify の件数');
  ok(/…ほか 5件/.test(all),'★一覧は '+A.LIST_MAX+'行まで（残りは件数）');
  ok(/Amazon 本体あり：4件/.test(all),'★振り分けの決まりで対象外の件数');
  ok(!/受付終了にした件数/.test(all)
     &&/受付終了にした件数（出しておく上限を超えた古い品）：\*\*4件\*\*/
       .test(A.report({ trim:4 }).head.join('\n')),
     '★上限を超えて受付終了にした件数は、あったときだけ出す');
  ok(!/@everyone|@here/.test(all),'★★★@everyone・@here を使わない');
  const dry=A.report({ dry:true, sent:1, stop_n:0, sold_out:0 });
  ok(/試し・投稿していません/.test(dry.head[0]),'★試しの回は見出しで分かる');
  ok(A.report({}).head.length>=4,'★中身が空でも落ちない');
}

console.log('\n=== ⑥ 上乗せの乱数（その日のあいだは同じ）===');
{
  const a=A.seedRnd('4902370551010','2026-11-20');
  ok(a===A.seedRnd('4902370551010','2026-11-20'),
     '★★同じ日・同じ商品なら同じ数（試しと本番で値段が同じ）');
  ok(a!==A.seedRnd('4902370551010','2026-11-21'),'★日が変われば変わる');
  const v=[]; for(let i=0;i<50;i++)v.push(A.seedRnd('49023705510'+String(10+i),'2026-11-20'));
  const lo=Math.min(...v), hi=Math.max(...v);
  console.log('   50商品の幅 '+lo.toFixed(3)+'〜'+hi.toFixed(3));
  ok(v.every((x)=>x>=0&&x<1)&&lo<0.15&&hi>0.85,
     '★★末尾しか違わない JAN でも、数がばらける');
}

console.log('\n=== ⑦ 会員価格の⚙の読み方（画面と pj-sync で同じ1か所）===');
{
  const d=SUBPX.optOf({});
  console.log('   既定 '+JSON.stringify(d));
  ok(d.ship===SUBPX.SHIP_YEN&&d.pack===SUBPX.PACK_YEN&&d.addMin===SUBPX.ADD_MIN
     &&d.addMax===SUBPX.ADD_MAX&&d.grossMin===SUBPX.GROSS_MIN
     &&d.grossFloor===SUBPX.GROSS_FLOOR,'★★空の欄は既定');
  ok(Math.abs(d.cardFee-SUBPX.CARD_FEE*100)<1e-9&&d.rateMin===SUBPX.RATE_MIN*100,
     '★率は%で持つ');
  const o=SUBPX.optOf({ mwSubShip:'0', mwSubPack:'0', mwSubAddMin:'20',
                        mwSubAddMax:'40', mwSubCardFee:'0' });
  ok(o.ship===0&&o.pack===0&&o.addMin===20&&o.addMax===40,
     '★★0 と入れた欄は 0 のまま（既定に戻さない）');
  ok(Math.abs(o.cardFee-SUBPX.CARD_FEE*100)<1e-9,
     '★カード決済手数料だけは 0 を既定に戻す');
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  ok(/function mwSubPxOpt\(\)\{[\s\S]{0,700}return SUBPX\.optOf\(o\);/.test(html),
     '★★★画面も同じ optOf を通す（読み方が2か所に分かれない）');
  const wk=fs.readFileSync(new URL('../proxy-sync/worker.js',import.meta.url),'utf8');
  ok(/px: SUBPX\.optOf\(st\)/.test(wk),'★★★pj-sync も同じ optOf を通す');
}

console.log('\n=== ⑧ Shopify に送る商品の形（非公開・画像なし）===');
{
  const it={ jan:'4902370551234', name:'【新品】テストのゲーム 通常版',
             price:5480, max_qty:3, sold:1, kishu:'NS', asin:'B0ABCDEFGH',
             cost:4000, grades:'light,standard,premium', wholesale:3600,
             sha:'いろは商会', note:'備考', mw_id:'99999' };
  const a=SHOPCSV.apiOf(it,{ type:'ゲームソフト', gameG:100,
    locationId:'gid://shopify/Location/1', date:'2026-11-20T03:00:00Z' });
  const j=JSON.stringify(a);
  console.log('   handle '+a.handle+' status '+a.input.status+' tags '
    +a.input.tags.join(','));
  ok(a.handle==='sub-4902370551234'&&a.input.handle===a.handle,
     '★★★handle は sub-<JAN>（カードのリンク先と同じ）');
  ok(a.input.status==='UNLISTED','★★★非公開（UNLISTED）で作る');
  ok(a.input.title===SHOPCSV.titleOf(it.name)&&a.input.title==='テストのゲーム 通常版',
     '★★商品名は CSV と同じ掃除を通す');
  const row=SHOPCSV.rowOf(it,{ type:'ゲームソフト', gameG:100,
    date:'2026-11-20T03:00:00Z' });
  const v=a.input.variants[0];
  ok(v.sku===row['SKU']&&v.price===row['Price']&&v.barcode===row['Barcodes']
     &&a.input.descriptionHtml===row['Description']
     &&a.input.tags.join(', ')===row['Tags']
     &&String(v.inventoryItem.measurement.weight.value)===row['Weight value (grams)']
     &&v.inventoryItem.cost===row['Cost per item'],
     '★★★中身は商品CSV の1行と同じ（SKU・値段・説明・タグ・重さ・仕入原価）');
  ok(v.inventoryQuantities[0].quantity===2
     &&v.inventoryQuantities[0].locationId==='gid://shopify/Location/1'
     &&v.inventoryQuantities[0].name==='available',
     '★★★在庫は「上限 − 取り込んだ注文の点数」');
  ok(v.inventoryPolicy==='DENY'&&v.inventoryItem.tracked===true,
     '★在庫を追い、在庫切れでは売らない');
  ok(a.input.tags.indexOf('grade-light')>=0&&a.input.tags.indexOf('grade-monitor')<0
     &&a.input.tags.indexOf('member-list')>=0,'★★プランのタグ（積み上げ型）');
  ok(!/"files"|"media"|image|\.jpg|\.png/i.test(j),'★★★画像は入れない');
  ok(j.indexOf('3600')<0&&j.indexOf('いろは商会')<0&&j.indexOf('備考')<0
     &&j.indexOf('99999')<0&&!/matchingworld/i.test(j),
     '★★★卸値・社・備考・MW の商品番号・MW の URL を入れない');
  ok(a.input.vendor===undefined,'★Vendor は⚙に入れたときだけ送る');
  ok(SHOPCSV.apiOf(it,{ vendor:'OMAKASE' }).input.vendor==='OMAKASE'
     &&SHOPCSV.apiOf(it,{}).input.variants[0].inventoryQuantities===undefined,
     '★置き場所が決まらないうちは在庫の数を送らない');
}
T.done();
