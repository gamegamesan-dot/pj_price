/* Discord：会員向けサーバーの自動構築（8.1）
   ・設計は server.config.json だけ。スクリプトはそれを読んで作る
   ・**何度実行しても二重に作らない**（名前で照合し、あれば直すだけ）
   ・**既存のチャンネル・ロール・書き込みは消さない**
     （設定に無いものは「設定にないもの」として一覧に出すだけ）
   ・--dry-run は一覧だけ（1回も書き込まない）
   ・ロールは上から順に強く並べる
   ・@everyone は「案内」だけ見える／リストは会員が書き込めない
   ・案内文は空のチャンネルにだけ投稿してピン留め
   ・作った ID を ids.json に書く（トークンは出さない） */
import fs from "node:fs";
import path from "node:path";
import { harness } from "./lib.mjs";
import { setup, makeApi, overwritesFor, permBits, PERM, colorNum,
         inviteUrl, planText, expandKeys, INVITE_PERMS }
  from "../discord/setup-discord.mjs";
const T=harness('Discord：会員向けサーバーの自動構築（8.1）');
const ok=T.ok;
const CFG=JSON.parse(fs.readFileSync(
  path.join(process.cwd(),'discord/server.config.json'),'utf8'));
const GUILD='999000111222333444';

/* ---- Discord の代わり（覚えておくだけの偽サーバー）---- */
function fakeGuild(seed){
  const g={ roles:[{ id:GUILD, name:'@everyone', permissions:'0', color:0 }],
            channels:[], msgs:{}, pins:{}, calls:[], next:1000 };
  (seed&&seed.roles||[]).forEach((r)=>g.roles.push(Object.assign(
    { id:String(g.next++), permissions:'0', color:0, hoist:false,
      mentionable:false },r)));
  (seed&&seed.channels||[]).forEach((c)=>g.channels.push(Object.assign(
    { id:String(g.next++), type:0, permission_overwrites:[], topic:'' },c)));
  return g;
}
function fakeApi(g){
  const calls=g.calls;
  const api={
    calls,
    roles:async()=>{ calls.push('GET roles'); return g.roles.slice(); },
    roleAdd:async(_g,b)=>{ calls.push('POST role '+b.name);
      const r=Object.assign({ id:String(g.next++) },b); g.roles.push(r); return r; },
    roleEdit:async(_g,id,b)=>{ calls.push('PATCH role '+b.name);
      const r=g.roles.filter((x)=>x.id===String(id))[0];
      if(r)Object.assign(r,b); return r; },
    roleOrder:async(_g,b)=>{ calls.push('PATCH roles order');
      b.forEach((x)=>{ const r=g.roles.filter((y)=>y.id===String(x.id))[0];
        if(r)r.position=x.position; }); return b; },
    channels:async()=>{ calls.push('GET channels'); return g.channels.slice(); },
    chAdd:async(_g,b)=>{ calls.push('POST channel '+b.name);
      const c=Object.assign({ id:String(g.next++), permission_overwrites:[] },b);
      g.channels.push(c); return c; },
    chEdit:async(id,b)=>{ calls.push('PATCH channel '+b.name);
      const c=g.channels.filter((x)=>x.id===String(id))[0];
      if(c)Object.assign(c,b); return c; },
    msgs:async(id)=>{ calls.push('GET msgs'); return (g.msgs[id]||[]).slice(); },
    msgAdd:async(id,b)=>{ calls.push('POST msg '+id);
      const m={ id:String(g.next++), content:b.content };
      (g.msgs[id]=g.msgs[id]||[]).push(m); return m; },
    pins:async(id)=>{ calls.push('GET pins'); return (g.pins[id]||[]).slice(); },
    pinAdd:async(ch,id)=>{ calls.push('PUT pin '+ch);
      (g.pins[ch]=g.pins[ch]||[]).push({ id:String(id) }); return null; },
    me:async()=>({ id:'1' }),
  };
  return api;
}
const run=async(g,dry)=>await setup({ config:CFG, api:fakeApi(g), guild:GUILD,
  dryRun:!!dry });

console.log('=== 設定（server.config.json）===');
ok(CFG.roles.length===7,'★ロールは7つ');
ok(CFG.roles.map((r)=>r.name).join('>')
   ==='管理者>スタッフ>プレミアム>スタンダード>ライト>モニター>配信ボット',
   '★★上から順に強い並びで書いてある');
ok(CFG.categories.map((c)=>c.name).join('/')==='案内/リスト/注文/会員/管理',
   '★★カテゴリは 案内・リスト・注文・会員・管理');
const chNames=[];
CFG.categories.forEach((c)=>c.channels.forEach((x)=>chNames.push(x.name)));
console.log('   '+chNames.join('／'));
ok(chNames.length===14,'★★チャンネルは14本（表のとおり）');
ok(chNames.indexOf('はじめに')>=0&&chNames.indexOf('リスト-プレミアム')>=0
   &&chNames.indexOf('目玉商品-先行')>=0&&chNames.indexOf('スタッフ連絡')>=0,
   '★★★表のチャンネルがぜんぶある');
ok(!CFG.categories.some((c)=>c.channels.some((x)=>Number(x.type)===2)),
   '★★通話チャンネルは作らない');
ok(CFG.plans.length===4&&CFG.plans[2].deal==='24時間先行',
   '★プランの表も JSON に持つ（配信の設定で使う）');

console.log('\n=== --dry-run は1回も書き込まない ===');
let g=fakeGuild();
let plan=await run(g,true);
console.log('   '+plan.roles.length+'ロール／'+plan.channels.length+'チャンネル');
ok(g.calls.filter((c)=>/^(POST|PATCH|PUT)/.test(c)).length===0,
   '★★★--dry-run では1回も作らない・直さない');
ok(plan.roles.filter((x)=>x.act==='add').length===7,'★★作るロールを数える');
ok(plan.channels.filter((x)=>x.act==='add').length===19,
   '★★作るカテゴリ5＋チャンネル14を数える');
ok(plan.posts.length===3,'★★案内文を入れるチャンネルは3本（はじめに・ルール・お知らせ）');
ok(/--dry-run（何も変えません）/.test(planText(plan,true)),'★一覧の見出し');
ok(g.roles.length===1&&g.channels.length===0,'★★★サーバーは何も変わっていない');

console.log('\n=== 本実行：作られる ===');
g=fakeGuild();
plan=await run(g,false);
const names=g.channels.map((c)=>c.name);
console.log('   ロール '+(g.roles.length-1)+'／チャンネル '+g.channels.length);
ok(g.roles.length===8,'★★★ロール7つを作る（@everyone は触らない）');
ok(g.channels.filter((c)=>c.type===4).length===5,'★★★カテゴリ5つ');
ok(g.channels.filter((c)=>c.type===0).length===14,'★★★チャンネル14本');
ok(names.indexOf('はじめに')>=0,'★名前のとおりに作る');
/* 並び順（上から強い）。position が大きいほど上。 */
const posOf=(n)=>(g.roles.filter((r)=>r.name===n)[0]||{}).position;
console.log('   並び: '+CFG.roles.map((r)=>r.name+':'+posOf(r.name)).join(' '));
ok(posOf('管理者')>posOf('スタッフ')&&posOf('スタッフ')>posOf('プレミアム')
   &&posOf('プレミアム')>posOf('スタンダード')&&posOf('スタンダード')>posOf('ライト')
   &&posOf('ライト')>posOf('モニター')&&posOf('モニター')>posOf('配信ボット'),
   '★★★上から順に強く並べる');
/* 色と権限。 */
const roleOf=(n)=>g.roles.filter((r)=>r.name===n)[0]||{};
ok(roleOf('管理者').color===colorNum('#e53935'),'★★色を付ける');
ok(BigInt(roleOf('管理者').permissions)===PERM.ADMINISTRATOR,
   '★★★管理者は全権限');
ok(BigInt(roleOf('ライト').permissions)===0n,
   '★★会員のロールは権限を持たない（見えるかはチャンネル側で決める）');

console.log('\n=== 案内文：投稿してピン留め ===');
const chOf=(n)=>g.channels.filter((c)=>c.name===n)[0]||{};
const start=chOf('はじめに');
console.log('   '+String((g.msgs[start.id]||[])[0]||{}).slice(0,0)
  +((g.msgs[start.id]||[])[0]||{}).content.slice(0,40)+'…');
ok((g.msgs[start.id]||[]).length===1,'★★★#はじめに に1通だけ投稿する');
ok(/ようこそ。このサーバーでは/.test((g.msgs[start.id][0]||{}).content),
   '★★本文は設定 JSON のもの');
ok(/#質問 に書いてください/.test((g.msgs[start.id][0]||{}).content),
   '★★3つの手順と注意も入る');
ok((g.pins[start.id]||[]).length===1,'★★★ピン留めする');
ok((g.msgs[chOf('ルール・規約').id]||[]).length===1
   &&(g.msgs[chOf('お知らせ').id]||[]).length===1,
   '★★ルール・規約 と お知らせ にも入れる');
ok(!(g.msgs[chOf('よくある質問').id]||[]).length,
   '★本文を書いていないチャンネルには投稿しない');

console.log('\n=== 権限：誰が見られる・書けるか ===');
const ow=(n)=>{
  const c=chOf(n), out={};
  (c.permission_overwrites||[]).forEach((x)=>{
    const name=(x.id===GUILD)?'@everyone'
      :(g.roles.filter((r)=>r.id===x.id)[0]||{}).name;
    out[name]={ allow:BigInt(x.allow), deny:BigInt(x.deny) };
  });
  return out;
};
const canSee=(o,n)=>!!(o[n]&&(o[n].allow&PERM.VIEW_CHANNEL));
const noSee=(o,n)=>!!(o[n]&&(o[n].deny&PERM.VIEW_CHANNEL));
const canWrite=(o,n)=>!!(o[n]&&(o[n].allow&PERM.SEND_MESSAGES));
const noWrite=(o,n)=>!!(o[n]&&(o[n].deny&PERM.SEND_MESSAGES));
let o=ow('はじめに');
ok(canSee(o,'@everyone')&&noWrite(o,'@everyone'),
   '★★★#はじめに は全員が見られて、書けない');
ok(canWrite(o,'管理者'),'★★管理者は書ける');
o=ow('リスト-ライト');
console.log('   リスト-ライト: '+Object.keys(o).join('/'));
ok(noSee(o,'@everyone'),'★★★リストは @everyone に見せない');
ok(canSee(o,'ライト')&&noWrite(o,'ライト'),
   '★★★ライトは見られるが**書けない**');
ok(!!(o['ライト'].deny&PERM.ADD_REACTIONS),'★★★リアクションもできない');
ok(canWrite(o,'配信ボット')&&canWrite(o,'管理者'),'★★★配信ボットと管理者は書ける');
ok(canSee(o,'スタッフ'),'★★★スタッフはすべてのチャンネルを見られる');
ok(!canSee(o,'スタンダード')&&!canSee(o,'プレミアム'),
   '★★ほかのプランには見せない');
o=ow('リスト-スタンダード');
ok(canSee(o,'スタンダード')&&canSee(o,'モニター'),
   '★★★モニターはスタンダードと同じものが見える');
o=ow('目玉商品-先行');
ok(canSee(o,'プレミアム')&&!canSee(o,'スタンダード'),
   '★★★目玉商品-先行はプレミアムだけ');
o=ow('目玉商品');
ok(canSee(o,'ライト')&&canSee(o,'スタンダード')&&canSee(o,'プレミアム')
   &&canSee(o,'モニター'),'★★★目玉商品は会員すべて');
o=ow('質問');
ok(canSee(o,'ライト')&&canWrite(o,'ライト'),'★★★#質問 は会員が書ける');
ok(!!(o['ライト'].allow&PERM.CREATE_PUBLIC_THREADS),
   '★★スレッドも作れる（返信はスレッドで）');
o=ow('管理-ログ');
ok(noSee(o,'@everyone')&&!canSee(o,'ライト')&&canSee(o,'スタッフ')
   &&canWrite(o,'配信ボット'),'★★★管理-ログは管理者・スタッフとボットだけ');
o=ow('スタッフ連絡');
ok(canWrite(o,'スタッフ')&&!canSee(o,'プレミアム'),
   '★★スタッフ連絡はスタッフが書ける');

console.log('\n=== もう一度実行しても「変更なし」 ===');
g.calls.length=0;
const again=await run(g,false);
console.log('   '+JSON.stringify({roles:again.roles.length,
  ch:again.channels.length,posts:again.posts.length}));
ok(again.channels.length===0,'★★★チャンネルは作り直さない・直さない');
ok(again.roles.length===0,
   '★★★ロールも作り直さない（並び順もそろっているので触らない）');
ok(again.posts.length===0,'★★★案内文を二重に投稿しない');
ok(g.channels.length===19&&g.roles.length===8,'★★★増えていない');
ok(g.calls.filter((c)=>/^POST/.test(c)).length===0,'★★作る呼び出しは0回');
ok(g.calls.filter((c)=>/^PATCH/.test(c)).length===0,
   '★★★直す呼び出しも0回（まるごと「変更なし」）');

console.log('\n=== 既存のものは消さない ===');
g=fakeGuild({ roles:[{ name:'おためしロール' }],
  channels:[{ name:'雑談' },{ name:'はじめに' }] });
g.msgs[g.channels.filter((c)=>c.name==='はじめに')[0].id]=[{ id:'9', content:'前からある書き込み' }];
plan=await run(g,false);
console.log('   設定にないもの: '+JSON.stringify(plan.extra));
ok(g.channels.some((c)=>c.name==='雑談'),'★★★設定にないチャンネルは消さない');
ok(g.roles.some((r)=>r.name==='おためしロール'),'★★★設定にないロールは消さない');
ok(plan.extra.some((x)=>x.name==='雑談'&&x.kind==='チャンネル')
   &&plan.extra.some((x)=>x.name==='おためしロール'&&x.kind==='ロール'),
   '★★★「設定にないもの」として一覧に出すだけ');
ok(/設定にないもの（消していません）/.test(planText(plan,false)),
   '★★一覧にもそう書く');
const keep=g.channels.filter((c)=>c.name==='はじめに')[0];
ok((g.msgs[keep.id]||[]).length===1
   &&g.msgs[keep.id][0].content==='前からある書き込み',
   '★★★前からある書き込みには足さない（二重投稿しない）');
ok(g.channels.filter((c)=>c.name==='はじめに').length===1,
   '★★同じ名前のチャンネルを作り直さない（あるものを使う）');

console.log('\n=== ID の控え（ids.json に書く中身）===');
console.log('   '+Object.keys(plan.ids).slice(0,6).join('/')+'…');
ok(plan.ids.guild===GUILD,'★サーバーID を入れる');
ok(/^\d+$/.test(String(plan.ids['role:premium']||'')),
   '★★★ロールの ID を入れる（あとでロール付けに使う）');
ok(/^\d+$/.test(String(plan.ids['ch:list-premium']||'')),
   '★★★チャンネルの ID を入れる（あとで配信に使う）');
ok(Object.keys(plan.ids).length>=1+7+5+14,'★★ロール・カテゴリ・チャンネルぜんぶ');
ok(!JSON.stringify(plan.ids).match(/[A-Za-z0-9_-]{24,}\./),
   '★★★トークンのようなものは入れない');

console.log('\n=== 招待 URL（README に出す）===');
const url=inviteUrl('123456789');
console.log('   '+url);
ok(/client_id=123456789/.test(url)&&/scope=bot/.test(url),'★ボットの招待 URL');
ok(url.indexOf(permBits(INVITE_PERMS).toString())>0,'★★必要な権限だけ入れる');
ok(INVITE_PERMS.indexOf('MANAGE_CHANNELS')>=0
   &&INVITE_PERMS.indexOf('MANAGE_ROLES')>=0
   &&INVITE_PERMS.indexOf('SEND_MESSAGES')>=0
   &&INVITE_PERMS.indexOf('MANAGE_MESSAGES')>=0,
   '★★★チャンネルの管理・ロールの管理・送信・管理（ピン留め）');
ok(INVITE_PERMS.indexOf('MESSAGE_CONTENT')<0,
   '★★★メッセージを読む権限（特権インテント）は入れない');

console.log('\n=== 混み合ったとき（429）は待ってやり直す ===');
let n=0;
const api2=makeApi('（出さない）',{ sleep:async()=>{},
  fetch:async()=>{
    n++;
    if(n===1)return new Response(JSON.stringify({ retry_after:0.1 }),{ status:429 });
    return new Response(JSON.stringify([{ id:'1', name:'@everyone' }]),{ status:200 });
  } });
const got=await api2.roles(GUILD);
ok(n===2&&Array.isArray(got),'★★429 のときは待ってもう一度送る');
/* 失敗の文にトークンを出さない。 */
const api3=makeApi('ひみつのトークン',{ sleep:async()=>{},
  fetch:async()=>new Response('{"message":"Missing Permissions"}',{ status:403 }) });
let msg='';
try{ await api3.roles(GUILD); }catch(e){ msg=String(e.message||''); }
console.log('   '+msg);
ok(/HTTP 403/.test(msg)&&msg.indexOf('ひみつのトークン')<0,
   '★★★失敗の文にトークンを出さない');

console.log('\n=== README の手順 ===');
const rd=fs.readFileSync('README.md','utf8');
ok(/会員向け Discord サーバーを作る/.test(rd),'★README に手順がある（日本語）');
ok(/New Application/.test(rd)&&/Reset Token/.test(rd),'★★ボットの作り方');
ok(rd.indexOf('permissions='+permBits(INVITE_PERMS).toString())>0,
   '★★★招待 URL の権限の数が、スクリプトの必要権限と**同じ**');
ok(/PowerShell/.test(rd)&&/--dry-run/.test(rd)&&/もう一度/.test(rd),
   '★★実行手順（PowerShell・dry-run → 実行 → もう一度）');
ok(/ids\.json/.test(rd)&&/\.gitignore/.test(rd),'★ids.json のことも書く');
ok(/ライト \| 未定 \| 20件/.test(rd.replace(/\s*\|\s*/g,' | ')),
   '★★プランの表を README に残す');
ok(/特権インテント/.test(rd),'★★特権インテントは要らないと書く');

console.log('\n=== 置き場所と .gitignore ===');
ok(fs.existsSync('discord/setup-discord.mjs')&&fs.existsSync('discord/server.config.json'),
   '★discord/ に2つのファイルがある');
const gi=fs.readFileSync('.gitignore','utf8');
ok(/discord\/ids\.json/.test(gi),'★★★ids.json は .gitignore に入れる');
const src=fs.readFileSync('discord/setup-discord.mjs','utf8');
ok(/DISCORD_BOT_TOKEN/.test(src)&&!/[A-Za-z0-9]{24}\.[A-Za-z0-9_-]{6}\./.test(src),
   '★★★トークンはコードに書かない（環境変数から読む）');
ok(!/require\(|from "discord/.test(src.replace(/from "\.\.?\//g,'')),
   '★外部ライブラリを使わない（Node の fetch だけ）');
T.done();
