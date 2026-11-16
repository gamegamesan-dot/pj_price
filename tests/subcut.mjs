/* 決まり：新しい足切り（率 かつ 粗利）（8.48・カジの②・簡単な版）

   ・新しい足切りは**1本だけ**
       会員の利益率（粗利 ÷ **会員が払う額**）が ⚙以上
       **かつ** 会員の粗利が ⚙以上（既定 15%・¥700）
   ・いまの決まり（粗利¥800 **または**（率30%かつ粗利¥300））は
     **そのまま**。新しい足切りは**まず数えるだけ**に使う
   ・率は**仕入れ値（会員が払う額）に対する率**。
     仕入れタブの絞り込み（売上に対する率）とは分母が違う */
import { harness } from './lib.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const S=require('../shared/subprice.js');
const T=harness('決まり：新しい足切り（率 かつ 粗利）（8.48）');
const ok=T.ok;
/* 会員が払う額 ¥4,000・Amazon の手数料 ¥250 のとき、
   Amazon の実売を動かして粗利と率を作る。 */
const cut=(amz,o)=>S.cutOf(amz,250,4000,o||{});

console.log('=== ① 既定（率15% かつ 粗利¥700）===');
{
  ok(S.CUT_RATE===0.15&&S.CUT_GROSS===700,'★★★既定は 15%・¥700');
  ok(S.cutMin({})===0.15&&S.cutMin({ cutRate:25 })===0.25
     &&S.cutMin({ cutRate:0.2 })===0.2,
     '★★⚙は「15」でも「0.15」でも受ける');
  const a=cut(5000);
  console.log('   '+JSON.stringify(a));
  ok(a.gross===750&&a.pct===19,'★★★粗利 ¥750・率 19%（4,000円に対して）');
  ok(a.ok===true&&a.why==='','★★★率も粗利も足りていれば通る');
}

console.log('\n=== ② 両方を満たすこと（かつ）===');
{
  /* 粗利は足りるが率が足りない（粗利¥700・率17.5%→⚙を上げて落とす）。 */
  const r=cut(4950,{ cutRate:20 });
  console.log('   率だけ足りない '+JSON.stringify({ g:r.gross, p:r.pct,
    why:r.why }));
  ok(r.ok===false&&r.why==='rate',
     '★★★粗利が足りても率が足りなければ外れる');
  /* 率は足りるが粗利が足りない（⚙の粗利を上げる）。 */
  const g=cut(5000,{ cutGross:1000 });
  ok(g.ok===false&&g.why==='gross',
     '★★★率が足りても粗利が足りなければ外れる');
  const b=cut(4400);
  ok(b.ok===false&&b.why==='both',
     '★★★どちらも足りなければ「どちらも」');
  ok(cut(0).why==='no_fee'&&cut(0).gross===null,
     '★★★手数料・値段が無い行は「出せません」（当てずっぽうにしない）');
  /* カジの例：7,000円で仕入れ・粗利700円（10%）→ 外れる。 */
  const k=S.cutOf(7000+700+250,250,7000);
  console.log('   カジの例 '+JSON.stringify({ g:k.gross, p:k.pct,
    ok:k.ok, why:k.why }));
  ok(k.gross===700&&k.pct===10&&k.ok===false&&k.why==='rate',
     '★★★カジの例（7,000円仕入れ・粗利700円＝10%）は外れる');
}

console.log('\n=== ③ 境目 ===');
{
  ok(cut(4950).ok===true,'★★★ちょうど粗利¥700・率17.5% は通る');
  ok(S.cutOf(4950,250,4000,{ cutGross:700 }).ok===true,
     '★★「以上」なのでちょうどの数は通る');
  ok(S.cutOf(4850,250,4000,{ cutGross:600, cutRate:15 }).ok===true,
     '★★★⚙を下げれば通る（粗利¥600・率15%）');
  ok(S.cutOf(4849,250,4000,{ cutGross:600, cutRate:15 }).ok===false,
     '★1円下がると外れる（率が15%に届かない）');
}

console.log('\n=== ④ いまの決まりとの違い ===');
{
  /* いまの決まりは「粗利¥800 または（率30%かつ粗利¥300）」。 */
  const o={};
  /* 粗利¥750・率19%：いまは外れる（800未満・30%未満）が、新しいでは通る。 */
  ok(S.fitOf(5000,250,4000,o).ok===false&&cut(5000).ok===true,
     '★★★粗利¥750・率19% は「いま外れて・新しいで通る」（増える品）');
  /* 粗利¥1,000・率10%（会員が払う額が大きい品）：いまは通るが新しいでは外れる。 */
  ok(S.fitOf(11250,250,10000,o).ok===true
     &&S.cutOf(11250,250,10000,o).ok===false,
     '★★★粗利¥1,000・率10% は「いま通って・新しいで外れる」（減る品）');
  ok(S.cutOf(11250,250,10000,o).why==='rate',
     '★★その理由は「率だけ足りない」');
}
T.done();
