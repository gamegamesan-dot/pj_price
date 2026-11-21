/* 画面：Discord の配信の3点の直し（8.86）

   カジの依頼（2026-11-21）
     1. 今週の一覧の行（金額にラベル・「…」は1つ）
     2. カードの共通の説明を #はじめに へ（外す前に、書き換わる枚数を出す）
     3. チャンネルの説明文（トピック）を上限から作る
   ここで見ること
     ① ⚙の欄（説明を外す＝既定オフ／トピックを合わせる＝既定オン）
     ② 予定の画面：書き換わるカードの枚数・トピックの食い違い
     ③ 「説明文を確かめる」「いま合わせる」
     ④ 読み方の固定メッセージの文（#はじめに・各リスト）と、貼り直しの印
     ⑤ 画面も同じ決まり（一覧の行・トピックの文）を読む */
const { harness, openCsvBoxes } = require('./lib');
const T = harness('画面：Discord の配信の3点の直し（8.86）');
const ok = T.ok;
(async()=>{
const p=await T.open();
p.on('dialog',(d)=>d.accept());
await openCsvBoxes(p);

console.log('=== ① ⚙の欄 ===');
{
  const t=await p.evaluate(()=>({
    slim:!!$('subCardSlim')&&$('subCardSlim').checked===false,
    topic:!!$('subTopicOn')&&$('subTopicOn').checked===true,
    chk:ADV_SUBCHK.indexOf('subCardSlim')>=0&&ADV_SUBCHK.indexOf('subTopicOn')>=0,
    n1:$('subCardSlimNote').textContent, n2:$('subTopicCfgNote').textContent,
    b:[$('subTopicChkBtn').textContent,$('subTopicGoBtn').textContent] }));
  ok(t.slim,'★★★「カードの共通の説明文を外す」は既定オフ（出ているカードを勝手に書き換えない）');
  ok(t.topic,'★★★「チャンネルの説明文を上限に合わせる」は既定オン');
  ok(t.chk,'★★pj-sync に送るまとまりに入っている');
  ok(/#はじめに の「カードの読み方」/.test(t.n1)&&/何枚書き換わるか/.test(t.n1),
     '★★説明に、移す先と「先に枚数を見る」ことを書いてある');
  ok(/上限を変えると次の配信で説明文も変わります/.test(t.n2)&&/チャンネルの管理/.test(t.n2),
     '★★トピックは上限から作ること・要る権限を書いてある');
  ok(/確かめる（何も変えない）/.test(t.b[0])&&/いま合わせる/.test(t.b[1]),'★ボットが2つある');
}

console.log('\n=== ② 予定の画面 ===');
{
  const t=await p.evaluate(()=>{
    var plans=[{ key:'light', name:'ライト', on:true, ch:'2', n:5, q:1, items:[] }];
    var box=function(h){ var d=document.createElement('div'); d.innerHTML=h; return d; };
    var a=box(subSlimHtml({ plans:plans, slim:{ on:false, total:12,
      plans:[{ key:'light', name:'ライト', n:8 },{ key:'standard', name:'スタンダード', n:4 },
             { key:'premium', name:'プレミアム', n:0 }] } })).textContent;
    var b=box(subSlimHtml({ slim:{ on:true, total:0, plans:[] } })).textContent;
    var c=subSlimHtml({});
    var tp={ on:true, n:4, diff:1, rows:[
      { ch:'4', names:'プレミアム', same:false, why:'',
        want:'プレミアムの商品リスト。お一人5点まで／1回50件まで。',
        was:'お一人5点まで／1回 100件まで' }] };
    var d=box(subTopicHtml({ topic:tp })).textContent;
    var e=box(subTopicHtml({ topic:{ on:true, n:4, diff:0, rows:[{ ch:'1', same:true }] } })).textContent;
    var f=box(subTopicHtml({ topic:{ on:false, n:4, diff:2, rows:[{ ch:'1' }] } })).textContent;
    subPlanData={ ok:true, plans:plans, slim:{ on:false, total:3,
      plans:[{ key:'light', name:'ライト', n:3 }] }, topic:tp };
    subPlanRender();
    return { a:a, b:b, c:c, d:d, e:e, f:f,
      live:[!!$('subSlimLine'),!!$('subTopicLine'),
            ($('subSlimLine')||{}).textContent||''] };
  });
  console.log('   '+t.a);
  console.log('   '+t.d);
  ok(/オンにすると、出ているカードが 12枚 書き換わります（ライト：8枚／スタンダード：4枚）/.test(t.a),
     '★★★外すと書き換わるカードの枚数（プランごと）を、オンにする前に出す');
  ok(!/プレミアム/.test(t.a)&&/先に #はじめに/.test(t.a),'★★0枚のプランは並べない・順番（先に #はじめに）を書く');
  ok(/外してあります/.test(t.b)&&t.c==='','★オンのあと・件数が無いときの形');
  ok(/4か所のうち 1か所が食い違っています（次の配信で合わせます）/.test(t.d),
     '★★★トピックの食い違いの数を出す');
  ok(/ぜんぶ合っています/.test(t.e)&&/がオフです/.test(t.f),'★★合っているとき・⚙がオフのときの形');
  ok(t.live[0]&&t.live[1]&&/3枚/.test(t.live[2]),'★★★予定の画面に2行とも出る');
}

console.log('\n=== ③ 説明文を確かめる／いま合わせる ===');
{
  const t=await p.evaluate(async()=>{
    $('syncApi').value='https://sync.example'; $('syncKey').value='k';
    syncRole='admin'; roleApply();
    var calls=[]; var real=window.fetch;
    var rows=[{ ch:'4', names:'プレミアム', same:false, why:'',
                want:'プレミアムの商品リスト。お一人5点まで／1回50件まで。書き込みはできません（質問は #質問 へ）。',
                was:'お一人5点まで／1回 100件まで' },
              { ch:'2', names:'ライト', same:true, why:'',
                want:'ライトの商品リスト。お一人1点まで／1回5件まで。', was:'ライトの商品リスト。お一人1点まで／1回5件まで。' }];
    window.fetch=async function(u,i){
      var url=String(u), m=String((i||{}).method||'GET');
      if(/\/sub\/topic/.test(url)){
        calls.push(m);
        if(m==='GET')return new Response(JSON.stringify({ ok:true, approve:false,
          on:true, n:2, diff:1, rows:rows }),{status:200});
        return new Response(JSON.stringify({ ok:true, approve:true, on:true, n:2,
          edit:1, same:1, fail:1, why:'権限がありません（ボットに「チャンネルの管理」が要ります）',
          rows:[{ ch:'4', names:'プレミアム', ok:true, edit:true, want:rows[0].want, was:rows[0].was },
                { ch:'3', names:'スタンダード', ok:false, want:'x',
                  why:'権限がありません（ボットに「チャンネルの管理」が要ります）' }] }),{status:200});
      }
      return real(u,i);
    };
    var out={};
    await subTopicGo(false);
    out.chk={ note:$('subTopicNote').textContent, box:$('subTopicBox').textContent,
              n:document.querySelectorAll('[data-topic]').length };
    await subTopicGo(true);
    out.go={ note:$('subTopicNote').textContent, box:$('subTopicBox').textContent };
    out.calls=calls.slice();
    syncRole='staff'; roleApply(); calls.length=0;
    try{ await subTopicGo(true); }catch(e){}
    out.staff=calls.length;
    syncRole='admin'; roleApply();
    window.fetch=real;
    return out;
  });
  console.log('   '+t.chk.note);
  ok(/確かめました（何も変えていません）：2か所のうち 1か所が食い違っています/.test(t.chk.note),
     '★★★「確かめる」は読むだけで、食い違いの数を出す');
  ok(t.chk.n===2&&/いまの文：お一人5点まで／1回 100件まで/.test(t.chk.box)
     &&/入れる文：プレミアムの商品リスト。お一人5点まで／1回50件まで。/.test(t.chk.box)
     &&/ライト\s*合っています/.test(t.chk.box),
     '★★★チャンネルごとに、いまの文と入れる文を並べて出す');
  ok(/書き換え 1か所・合っていた 1か所・できなかった 1か所：権限がありません/.test(t.go.note)
     &&/書き換えました/.test(t.go.box)&&/チャンネルの管理/.test(t.go.box),
     '★★★「いま合わせる」の結果と、できなかった理由を出す');
  ok(t.calls.join()==='GET,POST','★確かめるは GET・合わせるは POST');
  ok(t.staff===0,'★★★作業者のキーでは押せない');
}

console.log('\n=== ④ 読み方の固定メッセージの文 ===');
{
  const t=await p.evaluate(()=>{
    $('gdPinCh').value='123456789012345678';
    var L=gdPinList();
    var by={}; L.forEach(function(x){ by[x.id]=x.text; });
    gdPinGo();
    return { common:by.common, light:by.light, premium:by.premium, monitor:by.monitor,
             note:$('gdPinNote').textContent };
  });
  ok(/\*\*カードの読み方\*\*/.test(t.common)
     &&(t.common.match(/Amazon FBA で売った場合/g)||[]).length===1,
     '★★★#はじめに の文に「カードの読み方」が入り、説明は1回だけ');
  ok(/お一人 1点まで\*\*／1回 5件まで/.test(t.light)&&/お一人 5点まで\*\*／1回 50件まで/.test(t.premium),
     '★★★各リストの短い文の数字も新しい上限（ライト 1点・5件／プレミアム 5点・50件）');
  ok([t.light,t.premium,t.monitor].every((x)=>
       /粗利\*\*は \*\*Amazon FBA で売った場合\*\*の見込みです/.test(x)
       &&(x.match(/<#123456789012345678>/g)||[]).length===1),
     '★★★各リストの短い文に、短い説明と #はじめに へのリンクが1つ');
  ok(/貼り直し|貼って|まだ/.test(t.note),'★文が変わったので、貼り直しが要ると出る：'+t.note.slice(0,40));
}

console.log('\n=== ⑤ 画面も同じ決まりを読む ===');
{
  const t=await p.evaluate(()=>({
    line:SUBINDEX.lineOf({ jan:'4902370550001', name:'ゲームA', kishu:'NS',
      price:5210, gross:2186, left:3, msg_id:'900001', mark:'◎' },{ guild:'555' },'222'),
    topic:PJ_SUBGUIDE.topicOf(SUBPLAN.list(subCfgAll()).filter(function(x){
      return x.key==='premium'; })),
    v:APP_V }));
  console.log('   '+t.line);
  ok(t.line==='◎ **ゲームA**／仕入れ ¥5,210／粗利 ¥2,186／残り3／[カード](https://discord.com/channels/555/222/900001)',
     '★★★一覧の1行（金額にラベル・「…」なし）');
  ok(/^プレミアムの商品リスト。お一人5点まで／1回50件まで。/.test(t.topic),
     '★★★トピックの文は⚙の上限から');
  const fs=require('fs'), path=require('path');
  const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  ok(sw.indexOf("'pj-pricing-"+t.v+"'")>=0&&+t.v.slice(1)>=335,'★sw.js と APP_V がそろっている（'+t.v+'）');
}
await T.done();
})();
