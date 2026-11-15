/* 決まり：赤字にならない売値を売り方ごとに出す（8.37・カジの依頼・v296）

   理由（カジ）
     ゲーム数本だと FBA は**倉庫までの送料**で利益が消えるので、会員の
     多くは Amazon 自己配送・メルカリ・ヤフオクで売る。いままでの
     「赤字にならない売値」は Amazon の手数料だけで、送料が別だった。

   ここで当たること
     ・売り方ごとに「この値段以上なら赤字にならない」を出す
         Amazon 自己配送 … 販売手数料（カテゴリー別）＋成約料＋送料＋梱包材
         Amazon FBA      … 販売手数料＋FBA 配送代行＋倉庫までの送料
         メルカリ        … 販売手数料（⚙・既定10%）＋送料
         ヤフオク        … 落札システム利用料（⚙・既定10%）＋送料
     ・**率も金額もぜんぶ⚙**（コードに数字を書かない）
     ・送料は**送り方の区分**から⚙の金額を引く。分からない行は足さない
     ・Amazon の率が取れていない行は、**Amazon の売り方を出さない**
     ・⚙でどの売り方を出すか選べる（既定は自己配送・メルカリ・ヤフオク）
     ・**メルカリ・ヤフオクの相場は取りに行かない**（通信しない）
     ・カードと #はじめに の文が、売り方に合わせて変わる */
import { harness } from './lib.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const W=require('../shared/sellway.js');
const G=require('../shared/subguide.js');
const C=require('../shared/subcard.js');
const T=harness('決まり：赤字にならない売値を売り方ごとに（8.37）');
const ok=T.ok;
const ROOT=path.resolve(new URL('.',import.meta.url).pathname,'..');
const NOW='2026-11-15T09:00:00.000Z';
/* 会員価格 3,645／Amazon 9,000／率 8.8%／FBA 配送代行 410 */
const ROW={ price:3645, amz_price:9000, fee_rate:0.088, fee_fba:410,
  fee_total:1200, rank:12000, rank_cat:'ゲーム', new_n:4, amz:0,
  amz_at:'2026-11-15T06:00:00.000Z', size_g:110, kishu:'NS' };
const r0=(v)=>Math.round(v);

console.log('=== ① 売り方ごとの売値 ===');
{
  const sh={ shipKey:'cp', shipSure:true, shipName:'クリックポスト' };
  const self=W.floorOf('amz_self',ROW,sh,W.shipOf('cp',{}));
  const fba=W.floorOf('amz_fba',ROW,sh,W.shipOf('cp',{}));
  const mer=W.floorOf('mercari',ROW,sh,W.shipOf('cp',{}));
  const yah=W.floorOf('yahoo',ROW,sh,W.shipOf('cp',{}));
  console.log('   自己配送 '+self.yen+'／FBA '+fba.yen
    +'／メルカリ '+mer.yen+'／ヤフオク '+yah.yen);
  /* 自己配送 (3645 + 成約料0 + 送料185 + 梱包材20) / (1-0.088) = 4,221.5 → 4,230 */
  ok(self.ok&&self.yen===4230,
     '★★★Amazon 自己配送＝販売手数料＋送料＋梱包材を引いても残る値段');
  /* FBA (3645 + 410 + 倉庫まで50) / (1-0.088) = 4,501.1 → 4,510 */
  ok(fba.ok&&fba.yen===4510,
     '★★★Amazon FBA＝販売手数料＋FBA 配送代行＋倉庫までの送料');
  /* メルカリ・ヤフオク (3645 + 185) / (1-0.10) = 4,255.6 → 4,260 */
  ok(mer.ok&&mer.yen===4260,'★★★メルカリ＝販売手数料10%＋送料');
  ok(yah.ok&&yah.yen===4260,'★★★ヤフオク＝落札システム利用料10%＋送料');
  ok(fba.yen>self.yen,
     '★★★ゲーム1点では FBA のほうが高く売らないと赤字になる（カジの理由）');
  ok(/販売手数料/.test(self.parts.join())&&/梱包材/.test(self.parts.join()),
     '★引いたものを持っている（画面にも出せる）');
}

console.log('=== ② 金額も率もぜんぶ⚙ ===');
{
  const sh=(o)=>W.shipOf('cp',o);
  const o={ gdFeeMercari:'6.6', gdShipCp:'300', gdPack:'50', gdAmzClose:'80',
            gdFbaIn:'120' };
  const mer=W.floorOf('mercari',ROW,o,sh(o));
  /* (3645 + 300) / (1-0.066) = 4,223.8 → 4,230 */
  ok(mer.ok&&mer.yen===4230,'★★★メルカリの手数料も送料も⚙で変わる');
  const self=W.floorOf('amz_self',ROW,o,sh(o));
  /* (3645 + 80 + 300 + 50) / (1-0.088) = 4,468.2 → 4,470 */
  ok(self.ok&&self.yen===4470,'★★★成約料・梱包材・送料も⚙で変わる');
  const fba=W.floorOf('amz_fba',ROW,o,sh(o));
  /* (3645 + 410 + 120) / (1-0.088) = 4,577.9 → 4,580 */
  ok(fba.ok&&fba.yen===4580,'★★★倉庫までの送料も⚙で変わる');
  /* 率は「10」でも「0.1」でも受ける。 */
  ok(W.floorOf('mercari',ROW,{ gdFeeMercari:'0.1' },0).yen
     ===W.floorOf('mercari',ROW,{ gdFeeMercari:'10' },0).yen,
     '★「10」でも「0.1」でも同じに読む');
  /* コードに数字を書かない＝既定はぜんぶ D にある。 */
  ok(W.D.gdFeeMercari===10&&W.D.gdFeeYahoo===10&&W.D.gdShipCp>0
     &&W.D.gdPack>0&&W.D.gdFbaIn>0,
     '★★★既定値は1か所（shared/sellway.js の D）にまとまっている');
}

console.log('=== ③ 送料は送り方の区分から ===');
{
  ok(W.shipOf('cp',{})===W.D.gdShipCp
     &&W.shipOf('letter',{})===W.D.gdShipLetter
     &&W.shipOf('compact',{})===W.D.gdShipCompact
     &&W.shipOf('box60',{})===W.D.gdShipBox60
     &&W.shipOf('box80',{})===W.D.gdShipBox80
     &&W.shipOf('box',{})===W.D.gdShipBox,
     '★★★区分（クリックポスト〜宅配便）ごとに⚙の金額を引く');
  ok(W.shipOf('',{})===0&&W.shipOf('nazo',{})===0,
     '★★★分からない区分は 0（当てずっぽうの送料を足さない）');
  const a=W.linesOf(ROW,{ shipKey:'box80', shipSure:true,
                          shipName:'宅配便（80サイズ）' });
  const b=W.linesOf(ROW,{ shipKey:'cp', shipSure:true });
  ok(a.items[0].yen>b.items[0].yen,'★★大きい荷物ほど売値が高くなる');
  const c=W.linesOf(ROW,{ shipKey:'cp', shipSure:false });
  console.log('   区分が分からないとき：'+c.text.split('\n').pop());
  ok(c.ok&&/送料は別/.test(c.text)&&c.ship===0,
     '★★★区分を名乗れない行は送料を足さず「送料は別」と書く');
}

console.log('=== ④ 取れていないものは出さない ===');
{
  const no=W.linesOf({ ...ROW, fee_rate:0 },{ shipKey:'cp', shipSure:true });
  console.log('   '+no.text.replace(/\n/g,' ／ '));
  ok(no.ok&&!/Amazon/.test(no.text),
     '★★★Amazon の手数料が取れていない行は Amazon の売り方を出さない');
  ok(/メルカリ/.test(no.text)&&/ヤフオク/.test(no.text),
     '★★メルカリ・ヤフオクは⚙の率だけで出せる');
  ok(!W.floorOf('amz_fba',{ ...ROW, fee_fba:0, fee_total:0 },{},0).ok,
     '★★★FBA の配送代行手数料が取れていない行は FBA を出さない');
  /* fee_fba が無くても、手数料の合計から残りを出せるときは出す。 */
  const g=W.floorOf('amz_fba',{ ...ROW, fee_fba:0 },{},0);
  ok(g.ok&&g.yen>0,'★合計から固定ぶんを出せるときは FBA も出す');
  ok(!W.linesOf({ ...ROW, price:0 },{}).ok,'★会員価格が無い行は出さない');
}

console.log('=== ⑤ ⚙でどの売り方を出すか選ぶ ===');
{
  ok(W.listOf({}).map((x)=>x.key).join()==='amz_self,mercari,yahoo',
     '★★★既定は Amazon 自己配送・メルカリ・ヤフオク');
  ok(W.listOf({ gdWays:'amz_fba,mercari' }).map((x)=>x.key).join()
     ==='amz_fba,mercari','★★★⚙で選べる');
  ok(W.listOf({ gdWays:'なぞ' }).map((x)=>x.key).join()
     ==='amz_self,mercari,yahoo','★読めない⚙は既定に戻す');
  const t=W.linesOf(ROW,{ gdWays:'amz_self,amz_fba,mercari,yahoo',
                          shipKey:'cp', shipSure:true,
                          shipName:'クリックポスト' });
  ok(t.items.length===4&&t.text.split('\n').length===5,
     '★★4つぜんぶ出しても「売り方の行＋注意の1行」になる');
}

console.log('=== ⑥ カードと #はじめに の文 ===');
{
  const card=C.card({ ...ROW, gross:4155 },
                    { domain:'x.myshopify.com', maxQty:3, planKey:'premium',
                      guide:{}, gameG:110 });
  const fv=(n)=>(card.fields.filter((f)=>f.name===n)[0]||{}).value||'';
  const fl=fv('赤字にならない売値');
  console.log('   '+fl.replace(/\n/g,' ／ '));
  ok(/Amazon 自己配送/.test(fl)&&/メルカリ/.test(fl)&&/ヤフオク/.test(fl),
     '★★★カードに売り方ごとの売値が出る');
  ok(/送料 ¥/.test(fl),
     '★★★ゲームソフト（薄物）はクリックポストの送料を引いたあとで出る');
  ok(/Amazon FBA で売った場合/.test(fv('見込みの Amazon 粗利')),
     '★★★「見込みの粗利」にどの売り方の計算かを書く（カジの依頼3）');
  ok(parseFloat(C.CARD_V)>6.197,
     '★★★カードの版が上がる（配ってあるカードも書き換わる）');
  const pin=G.pinCommon({ gdItemsPremium:'badge,sell,px,rival,floor' },[]);
  console.log('   '+(pin.split('\n').filter((x)=>/赤字/.test(x))[0]||''));
  ok(/Amazon 自己配送/.test(pin)&&/メルカリ/.test(pin)&&/ヤフオク/.test(pin),
     '★★★#はじめに の説明も売り方ごとになる（カジの依頼5）');
  ok(/相場は見ていません/.test(pin),
     '★★★メルカリ・ヤフオクの相場は見ていないと書く');
  /* 文が変わる＝指紋が変わる＝⚙に「貼り直しが要るもの」が出る。 */
  const h1=G.hashOf(pin);
  const h2=G.hashOf(G.pinCommon({ gdItemsPremium:'badge,sell,px,rival,floor',
                                  gdWays:'amz_fba' },[]));
  ok(h1!==h2,'★★★売り方を変えると文の指紋も変わる（貼り直しが要ると分かる）');
}

console.log('=== ⑦ 相場は取りに行かない ===');
{
  const src=fs.readFileSync(path.join(ROOT,'shared/sellway.js'),'utf8');
  ok(!/fetch\(|https?:\/\//.test(src),
     '★★★メルカリ・ヤフオクに通信しない（規約で機械的な読み取りが禁止）');
  ok(!/mercari\.com|auctions\.yahoo/.test(src),
     '★★★相場を取りに行く先も書かない');
  /* 会員に見せない項目（§8.2）が混ざっていないこと。 */
  ok(!/卸値|wholesale/.test(src),'★★★卸値は出てこない');
}

await T.done();
