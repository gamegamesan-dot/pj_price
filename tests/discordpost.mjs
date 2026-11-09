/* Discord：ボット自身にロールを付けて、案内文とリストを投稿できるようにする（8.8）
   ・スクリプトの最後にボット自身へ「配信ボット」のロールを付ける
   ・案内のチャンネルも「配信ボット」が投稿とピン留めできる
   ・投稿の 403 は「手でやってほしいこと」にも出す
   ・--dry-run で、ボットが書けないチャンネルを先に見つけて出す */
import fs from "node:fs";
import path from "node:path";
import { harness } from "./lib.mjs";
import { setup, planText, overwritesFor, permBits, permJa, errJa,
         chanPerms, canWriteCh, INVITE_PERMS, PERM }
  from "../discord/setup-discord.mjs";
const T=harness('Discord：ボット自身にロールを付けて投稿できるように（8.8）');
const ok=T.ok;
const CFG=JSON.parse(fs.readFileSync(
  path.join(process.cwd(),'discord/server.config.json'),'utf8'));
const GUILD='999000111222333444';
const BOT='555000111';
const INV=permBits(INVITE_PERMS);

/* ---- 偽サーバー（チャンネルの権限を本当に見る）----
   投稿・ピン留めは、そのチャンネルでボットに権限があるかを
   Discord と同じ順（全体 →@everyone→ 自分のロール）で確かめ、
   足りなければ 403（50013）で断る。 */
function fake(opt){
  const o=opt||{};
  const botPerms=o.botPerms===undefined?INV:o.botPerms;
  const g={ roles:[{ id:GUILD, name:'@everyone', permissions:'0', position:0 }],
            channels:[], msgs:{}, pins:{}, calls:[], next:1000, botRoles:[] };
  const br={ id:String(g.next++), name:'刈り取り配信', managed:true,
             permissions:String(botPerms), position:1 };
  g.roles.push(br); g.botRoles=[br.id];
  const botTop=()=>Math.max.apply(null,g.roles
    .filter((r)=>g.botRoles.indexOf(r.id)>=0)
    .map((r)=>Number(r.position||0)).concat([0]));
  const deny=(m,pth)=>{ throw new Error(errJa(m,pth,403,
    '{"message":"Missing Permissions","code":50013}')); };
  const canDo=(id,names)=>{
    const c=g.channels.filter((x)=>x.id===String(id))[0];
    if(!c) return false;
    return canWriteCh(c.permission_overwrites||[],g.botRoles,botPerms,GUILD,
                      names||[]);
  };
  const api={
    calls:g.calls,
    roles:async()=>{ g.calls.push('GET roles');
      return g.roles.map((r)=>Object.assign({},r)); },
    roleAdd:async(_g,b)=>{ g.calls.push('POST role '+b.name);
      g.roles.forEach((x)=>{ if(x.id!==GUILD)
        x.position=Number(x.position||0)+1; });
      const r=Object.assign({ id:String(g.next++), position:1 },b);
      g.roles.push(r); return r; },
    roleEdit:async(_g,id,b)=>{ g.calls.push('PATCH role '+b.name);
      const r=g.roles.filter((x)=>x.id===String(id))[0];
      if(r)Object.assign(r,b); return r; },
    roleOrder:async(_g,b)=>{ g.calls.push('PATCH roles order x'+b.length);
      b.forEach((x)=>{ const r=g.roles.filter((y)=>y.id===String(x.id))[0];
        if(r)r.position=Number(x.position); }); return b; },
    memberRoleAdd:async(_g,uid,rid)=>{ g.calls.push('PUT member role');
      if(o.grantFail) deny('PUT','/guilds/'+GUILD+'/members/'+uid+'/roles/'+rid);
      const r=g.roles.filter((x)=>x.id===String(rid))[0];
      if(!r) throw new Error('no role');
      if(Number(r.position||0)>=botTop())
        deny('PUT','/guilds/'+GUILD+'/members/'+uid+'/roles/'+rid);
      g.botRoles.push(String(rid)); return null; },
    channels:async()=>{ g.calls.push('GET channels');
      return g.channels.map((c)=>Object.assign({},c)); },
    chAdd:async(_g,b)=>{ g.calls.push('POST channel '+b.name);
      const c=Object.assign({ id:String(g.next++), permission_overwrites:[] },b);
      g.channels.push(c); return c; },
    chEdit:async(id,b)=>{ g.calls.push('PATCH channel '+b.name);
      const c=g.channels.filter((x)=>x.id===String(id))[0];
      if(c)Object.assign(c,b); return c; },
    msgs:async(id)=>{ g.calls.push('GET msgs'); return (g.msgs[id]||[]).slice(); },
    msgAdd:async(id,b)=>{ g.calls.push('POST msg');
      if(!canDo(id)) deny('POST','/channels/'+id+'/messages');
      const m={ id:String(g.next++), content:b.content };
      (g.msgs[id]=g.msgs[id]||[]).push(m); return m; },
    pins:async(id)=>{ g.calls.push('GET pins'); return (g.pins[id]||[]).slice(); },
    pinAdd:async(ch,id)=>{ g.calls.push('PUT pin');
      if(!canDo(ch,['MANAGE_MESSAGES'])) deny('PUT','/channels/'+ch+'/pins/'+id);
      (g.pins[ch]=g.pins[ch]||[]).push({ id:String(id) }); return null; },
    me:async()=>({ id:BOT }),
    member:async()=>({ user:{ id:BOT }, roles:g.botRoles.slice() }),
  };
  return { g, api, canDo };
}
const run=async(f,dry,cfg)=>await setup({ config:cfg||CFG, api:f.api,
  guild:GUILD, dryRun:!!dry, log:()=>{} });
const man=(p,k)=>(p.manual||[]).filter((x)=>!k||x.kind===k);
const chOf=(g,n)=>g.channels.filter((c)=>c.name===n)[0]||{};

console.log('=== 設定：案内も配信ボットが書ける ===');
const info=CFG.categories.filter((c)=>c.key==='info')[0];
console.log('   '+info.channels.map((c)=>c.name+':'+c.send.join('+')).join('／'));
ok(info.channels.every((c)=>(c.send||[]).indexOf('bot')>=0),
   '★★★案内の4本すべてに配信ボットを入れる（案内文を投稿するため）');
ok(info.channels.every((c)=>(c.send||[]).indexOf('@everyone')<0),
   '★★会員は案内に書けないまま');

console.log('\n=== overwrites：配信ボットはピン留めもできる ===');
let rows=overwritesFor(info.channels[0],CFG,
  { '@everyone':GUILD, admin:'a', staff:'s', bot:'b' });
const row=(id)=>rows.filter((r)=>r.id===id)[0]||{ allow:'0', deny:'0' };
ok((BigInt(row('b').allow)&PERM.SEND_MESSAGES)===PERM.SEND_MESSAGES,
   '★★★配信ボットは「メッセージを送信」ができる');
ok((BigInt(row('b').allow)&PERM.MANAGE_MESSAGES)===PERM.MANAGE_MESSAGES,
   '★★★配信ボットは「メッセージの管理」（ピン留め）もできる');
ok((BigInt(row(GUILD).deny)&PERM.SEND_MESSAGES)===PERM.SEND_MESSAGES,
   '★★@everyone は書けないまま');
rows=overwritesFor(CFG.categories.filter((c)=>c.key==='list')[0].channels[0],
  CFG,{ '@everyone':GUILD, admin:'a', staff:'s', bot:'b', light:'L' });
const rl=rows.filter((r)=>r.id==='L')[0]||{ allow:'0' };
ok((BigInt(rl.allow)&PERM.MANAGE_MESSAGES)!==PERM.MANAGE_MESSAGES,
   '★★★会員には「メッセージの管理」を付けない');

console.log('\n=== 権限の計算（chanPerms・canWriteCh）===');
const owRows=[{ id:GUILD, allow:permBits(['VIEW_CHANNEL']).toString(),
                deny:permBits(['SEND_MESSAGES']).toString() },
              { id:'b', allow:permBits(['SEND_MESSAGES']).toString(), deny:'0' }];
ok(!canWriteCh(owRows,['z'],permBits(['VIEW_CHANNEL','SEND_MESSAGES']),GUILD),
   '★★★@everyone で止められていれば書けない');
ok(canWriteCh(owRows,['b'],permBits(['VIEW_CHANNEL','SEND_MESSAGES']),GUILD),
   '★★★自分のロールに許可があれば書ける');
ok(canWriteCh([],['z'],PERM.ADMINISTRATOR,GUILD),'★管理者なら書ける');
ok(!canWriteCh(owRows,['b'],permBits(['VIEW_CHANNEL','SEND_MESSAGES']),GUILD,
   ['MANAGE_MESSAGES']),'★★ピン留めには「メッセージの管理」が要る');
ok((chanPerms(owRows,['b'],0n,GUILD)&PERM.VIEW_CHANNEL)===PERM.VIEW_CHANNEL,
   '★@everyone の許可も足される');

console.log('\n=== 本実行：ボット自身にロールを付けて投稿まで通る ===');
let f=fake({});
let plan=await run(f,false);
console.log('   PUT member role '+f.g.calls.filter((c)=>c==='PUT member role').length
  +'回／投稿 '+Object.keys(f.g.msgs).length+'本／ピン '+Object.keys(f.g.pins).length+'本');
ok(f.g.calls.filter((c)=>c==='PUT member role').length===1,
   '★★★ボット自身に「配信ボット」のロールを付ける');
ok((plan.roles||[]).some((x)=>x.act==='grant'&&x.name==='配信ボット'),
   '★★一覧に「付ける 配信ボット」を出す');
ok(f.g.botRoles.length===2,'★★ボットのロールが2つになる（連携＋配信ボット）');
ok(Object.keys(f.g.msgs).length===3,'★★★案内文3通が投稿できる（403 にならない）');
ok(Object.keys(f.g.pins).length===3,'★★★3通ともピン留めできる');
ok((plan.fails||[]).length===0,'★★★失敗なし');
ok(man(plan,'投稿').length===0&&man(plan,'書けない').length===0,
   '★★★「書けない」「投稿」の手作業は出ない');
ok(/付ける 配信ボット/.test(planText(plan,false)),'★一覧の文');

console.log('\n=== リストのチャンネルにも配信できる ===');
const lp=chOf(f.g,'リスト-プレミアム');
ok(f.canDo(lp.id),'★★★リスト-プレミアムにボットが書ける（配信できる）');
await f.api.msgAdd(lp.id,{ content:'テストの配信' });
ok((f.g.msgs[lp.id]||[]).length===1,'★★実際に投稿できる');
ok(!f.canDo(chOf(f.g,'スタッフ連絡').id),
   '★★スタッフ連絡にはボットを入れない（設定どおり）');

console.log('\n=== もう一度実行しても二重に付けない ===');
f.g.calls.length=0;
const again=await run(f,false);
console.log('   '+JSON.stringify({ roles:again.roles.length,
  ch:again.channels.length, posts:again.posts.length }));
ok(f.g.calls.filter((c)=>c==='PUT member role').length===0,
   '★★★すでに付いていればロール付けを送らない');
ok(again.posts.length===0,'★★案内文を二重に投稿しない');
ok(again.roles.length===0&&again.channels.length===0,'★★「変更なし」');

console.log('\n=== ロール付けが断られても止まらない ===');
f=fake({ grantFail:true });
plan=await run(f,false);
console.log('   手で '+man(plan).map((x)=>x.kind+':'+x.name).join('／'));
ok(man(plan,'ロール付け').some((x)=>x.name==='配信ボット'
   &&/手で付けて/.test(x.how)),
   '★★★付けられなければ「手で付けてください」と出す');
ok(man(plan,'投稿').length===3,
   '★★★投稿の 403 も「手でやってほしいこと」に3件出る（「なし」にしない）');
ok(man(plan,'投稿').every((x)=>/メッセージを送信/.test(x.how)
   &&/もう一度実行/.test(x.how)),'★★直し方を日本語で書く');
ok((plan.fails||[]).length>=4&&plan.fails.some((x)=>/50013/.test(x.msg)),
   '★★「できなかったこと」に原因つきで残す');
ok(f.g.channels.filter((c)=>c.type===0).length===14,
   '★★★投稿できなくてもチャンネルは全部作る');
ok(/手でやってほしいこと：\d+件/.test(planText(plan,false))
   &&/［投稿］/.test(planText(plan,false)),'★★一覧にも出る');

console.log('\n=== dry-run：書けないチャンネルを先に見つける ===');
/* 案内から bot を外した設定（昔の設定）で、先に気づけるか */
const OLD=JSON.parse(JSON.stringify(CFG));
OLD.categories.filter((c)=>c.key==='info')[0].channels
  .forEach((c)=>{ c.send=['admin']; });
f=fake({});
plan=await run(f,true,OLD);
console.log('   '+man(plan,'書けない').map((x)=>x.name).join('／'));
ok(f.g.calls.filter((c)=>/^(POST|PATCH|PUT)/.test(c)).length===0,
   '★★★--dry-run では1回も書き込まない');
ok(man(plan,'書けない').length===1
   &&(man(plan,'書けない')[0].items||[]).length===3,
   '★★★案内文を貼る3本を「書けない」として先に出す');
ok(/はじめに/.test(man(plan,'書けない')[0].name)
   &&/お知らせ/.test(man(plan,'書けない')[0].name),
   '★★チャンネルの名前を出す');
ok(/403 \/ 50013/.test(man(plan,'書けない')[0].how)
   &&/メッセージを送信/.test(man(plan,'書けない')[0].how),
   '★★★原因（403/50013）と直し方を書く');
ok(/書けない/.test(planText(plan,true)),'★一覧にも出る');
/* 今の設定なら dry-run でも「書けない」は出ない */
f=fake({});
plan=await run(f,true);
ok(man(plan,'書けない').length===0,
   '★★★今の設定なら「書けない」は出ない（配信ボットを付ける前提で見る）');
ok((plan.roles||[]).some((x)=>x.act==='grant'),
   '★★dry-run でもロール付けの予定を出す');

console.log('\n=== ピン留めだけできないときも出す ===');
const NOPIN=JSON.parse(JSON.stringify(CFG));
/* 配信ボットの「メッセージの管理」が無い＝ボットの権限から外した場合 */
f=fake({ botPerms:permBits(["MANAGE_CHANNELS","MANAGE_ROLES","SEND_MESSAGES",
  "VIEW_CHANNEL","READ_MESSAGE_HISTORY","EMBED_LINKS","ATTACH_FILES",
  "ADD_REACTIONS","CREATE_PUBLIC_THREADS","SEND_MESSAGES_IN_THREADS"]) });
plan=await run(f,true,NOPIN);
console.log('   '+man(plan,'ピン留め').map((x)=>x.name).join('／'));
ok(man(plan,'ピン留め').length===1
   &&(man(plan,'ピン留め')[0].items||[]).length===3,
   '★★★ピン留めできない3本を先に出す');
ok(/メッセージの管理/.test(man(plan,'ピン留め')[0].how),
   '★★要る権限を書く');

console.log('\n=== 権限が読めないときは手でお願いする ===');
f=fake({});
f.api.member=async()=>{ throw new Error('読めません'); };
plan=await run(f,false);
ok(man(plan,'ロール付け').some((x)=>x.name==='配信ボット'),
   '★★★ボットが分からないときは「手で付けて」と出す');
ok(f.g.calls.filter((c)=>c==='PUT member role').length===0,
   '★★当てずっぽうで送らない');

console.log('\n=== README の案内 ===');
const rd=fs.readFileSync('README.md','utf8');
ok(/配信ボット/.test(rd)&&/ボット自身/.test(rd),
   '★★ボット自身にロールを付けることを書く');
T.done();
