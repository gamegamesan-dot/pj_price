/* Discord：ボットの権限が足りないときも最後まで通す（8.7）
   ・ボットが持っていない権限は**付けずに**ロールを作る
   ・付けられなかった権限は「手でやってほしいこと」に出す
   ・ボットのロールより**上には並べ替えない**（管理者は手で案内）
   ・並び替えに失敗しても止まらず、チャンネルと案内文まで進む
   ・--dry-run でも、これらを**先に**見つけて出す
   ・失敗の文に原因と直し方を日本語で出す（トークンは出さない） */
import fs from "node:fs";
import path from "node:path";
import { harness } from "./lib.mjs";
import { setup, planText, overwritesFor, permBits, permNames, permJa,
         maskPerms, errJa, botState, botTopOf, PERM, INVITE_PERMS }
  from "../discord/setup-discord.mjs";
const T=harness('Discord：権限が足りないときも最後まで通す（8.7）');
const ok=T.ok;
const CFG=JSON.parse(fs.readFileSync(
  path.join(process.cwd(),'discord/server.config.json'),'utf8'));
const GUILD='999000111222333444';
const BOT='555000111';
const INV=permBits(INVITE_PERMS);              /* 招待の権限（管理者なし） */
const EIGHT=permBits(["MANAGE_CHANNELS","MANAGE_ROLES","SEND_MESSAGES",
  "MANAGE_MESSAGES","VIEW_CHANNEL","READ_MESSAGE_HISTORY","EMBED_LINKS",
  "ATTACH_FILES"]);                            /* 今のカジのボット（8つ） */

/* ---- 偽サーバー（Discord のふるまいをまねる）----
   ・ロールを作ると position=1 に入り、ほかは1つ上に押し上げられる
   ・botPerms に無い権限を付けようとしたら 403（50013）で断る
   ・ボットのロールより上のロールを直す・動かすと 403（50013）で断る */
function fake(opt){
  const o=opt||{};
  const botPerms=o.botPerms===undefined?EIGHT:o.botPerms;
  const g={ roles:[{ id:GUILD, name:'@everyone', permissions:'0', position:0 }],
            channels:[], msgs:{}, pins:{}, calls:[], next:1000,
            botRole:'' , orderFail:!!o.orderFail, chFail:o.chFail||'' };
  /* ボットの連携ロール（いちばん上） */
  const br={ id:String(g.next++), name:'刈り取り配信', managed:true,
             permissions:String(botPerms), position:1 };
  g.roles.push(br); g.botRole=br.id;
  (o.roles||[]).forEach((r)=>{
    g.roles.forEach((x)=>{ if(x.id!==GUILD) x.position=Number(x.position||0)+1; });
    g.roles.push(Object.assign({ id:String(g.next++), permissions:'0', color:0,
      hoist:false, mentionable:false, position:1 },r));
  });
  const botTop=()=>Math.max.apply(null,g.roles.filter((r)=>r.id===g.botRole)
    .map((r)=>Number(r.position||0)).concat([0]));
  const miss=(bits)=>{
    const b=BigInt(bits||0), bot=BigInt(botPerms);
    if((bot&PERM.ADMINISTRATOR)===PERM.ADMINISTRATOR) return 0n;
    return b & ~bot;
  };
  const deny=(m,pth)=>{ const e=new Error(errJa(m,pth,403,
    '{"message":"Missing Permissions","code":50013}')); throw e; };
  const api={
    calls:g.calls,
    roles:async()=>{ g.calls.push('GET roles'); return g.roles.map((r)=>
      Object.assign({},r)); },
    roleAdd:async(_g,b)=>{ g.calls.push('POST role '+b.name);
      if(miss(b.permissions)) deny('POST','/guilds/'+GUILD+'/roles');
      g.roles.forEach((x)=>{ if(x.id!==GUILD)
        x.position=Number(x.position||0)+1; });
      const r=Object.assign({ id:String(g.next++), position:1 },b);
      g.roles.push(r); return r; },
    roleEdit:async(_g,id,b)=>{ g.calls.push('PATCH role '+b.name);
      const r=g.roles.filter((x)=>x.id===String(id))[0];
      if(!r) throw new Error('no role');
      if(Number(r.position||0)>=botTop()) deny('PATCH','/guilds/'+GUILD+'/roles/'+id);
      if(miss(BigInt(b.permissions||'0')&~BigInt(r.permissions||'0')))
        deny('PATCH','/guilds/'+GUILD+'/roles/'+id);
      Object.assign(r,b); return r; },
    roleOrder:async(_g,b)=>{ g.calls.push('PATCH roles order x'+b.length);
      if(g.orderFail) deny('PATCH','/guilds/'+GUILD+'/roles');
      for(const x of b){
        const r=g.roles.filter((y)=>y.id===String(x.id))[0];
        if(!r) continue;
        if(Number(x.position)>=botTop()||Number(r.position||0)>=botTop())
          deny('PATCH','/guilds/'+GUILD+'/roles');
      }
      b.forEach((x)=>{ const r=g.roles.filter((y)=>y.id===String(x.id))[0];
        if(r)r.position=Number(x.position); }); return b; },
    channels:async()=>{ g.calls.push('GET channels');
      return g.channels.map((c)=>Object.assign({},c)); },
    chAdd:async(_g,b)=>{ g.calls.push('POST channel '+b.name);
      if(g.chFail&&g.chFail===b.name) deny('POST','/guilds/'+GUILD+'/channels');
      for(const ow of b.permission_overwrites||[])
        if(miss(BigInt(ow.allow||'0')|BigInt(ow.deny||'0')))
          deny('POST','/guilds/'+GUILD+'/channels');
      const c=Object.assign({ id:String(g.next++), permission_overwrites:[] },b);
      g.channels.push(c); return c; },
    chEdit:async(id,b)=>{ g.calls.push('PATCH channel '+b.name);
      const c=g.channels.filter((x)=>x.id===String(id))[0];
      if(c)Object.assign(c,b); return c; },
    msgs:async(id)=>{ g.calls.push('GET msgs'); return (g.msgs[id]||[]).slice(); },
    msgAdd:async(id,b)=>{ g.calls.push('POST msg '+id);
      const m={ id:String(g.next++), content:b.content };
      (g.msgs[id]=g.msgs[id]||[]).push(m); return m; },
    pins:async(id)=>{ g.calls.push('GET pins'); return (g.pins[id]||[]).slice(); },
    pinAdd:async(ch,id)=>{ g.calls.push('PUT pin '+ch);
      (g.pins[ch]=g.pins[ch]||[]).push({ id:String(id) }); return null; },
    me:async()=>{ g.calls.push('GET me'); return { id:BOT }; },
    member:async(_g,uid)=>{ g.calls.push('GET member');
      if(String(uid)!==BOT) throw new Error('no member');
      if(o.noMember) throw new Error(errJa('GET','/guilds/x/members/y',403,
        '{"message":"Missing Access","code":50001}'));
      return { user:{ id:BOT }, roles:[g.botRole] }; },
  };
  return { g, api };
}
const run=async(f,dry)=>await setup({ config:CFG, api:f.api, guild:GUILD,
  dryRun:!!dry, log:()=>{} });

console.log('=== 権限の絞り込み（maskPerms）===');
ok(maskPerms(['VIEW_CHANNEL','ADMINISTRATOR'],EIGHT).bits===PERM.VIEW_CHANNEL,
   '★★★持っていない権限は付けない（ビットから外す）');
ok(maskPerms(['VIEW_CHANNEL','ADMINISTRATOR'],EIGHT).dropped
   .join(',')==='ADMINISTRATOR','★★落とした権限を名前で返す');
ok(maskPerms(['ADMINISTRATOR'],PERM.ADMINISTRATOR).dropped.length===0,
   '★★ボットが管理者なら何でも付けられる');
ok(maskPerms(['ADMINISTRATOR'],undefined).bits===PERM.ADMINISTRATOR
   &&maskPerms(['ADMINISTRATOR'],undefined).dropped.length===0,
   '★★権限が読めなかったときは絞らない（今までどおり）');
let bad=''; try{ maskPerms(['NO_SUCH'],EIGHT); }catch(e){ bad=e.message; }
ok(/知らない権限/.test(bad),'★知らない権限の名前はエラーにする');
ok(permNames(EIGHT).length===8&&permNames(INV).length===11,
   '★★ビット→名前の一覧（招待の権限は11個）');
ok(permJa('ADD_REACTIONS')==='リアクションの追加（ADD_REACTIONS）',
   '★日本語の権限名を出す');
ok(INVITE_PERMS.indexOf('ADD_REACTIONS')>=0
   &&INVITE_PERMS.indexOf('CREATE_PUBLIC_THREADS')>=0
   &&INVITE_PERMS.indexOf('SEND_MESSAGES_IN_THREADS')>=0,
   '★★★読むだけのチャンネルに要る3つを招待の権限に入れる');
ok(INVITE_PERMS.indexOf('ADMINISTRATOR')<0,
   '★★★管理者はボットに持たせない');

console.log('\n=== 失敗の文（原因と直し方を日本語で）===');
const e13=errJa('POST','/guilds/1/roles',403,
  '{"message":"Missing Permissions","code":50013}');
console.log('   '+e13.split('\n').slice(0,2).join(' / '));
ok(/HTTP 403/.test(e13)&&/50013/.test(e13),'★HTTP と Discord の番号を出す');
ok(/原因：/.test(e13)&&/直し方：/.test(e13),'★★★原因と直し方を日本語で出す');
ok(/自分が持っていない権限は付けられない/.test(e13)
   &&/上のロールは直せない/.test(e13),'★★Discord の2つの決まりを書く');
ok(/いちばん上に動かして/.test(e13),'★★ボットのロールを上に動かす案内');
ok(e13.indexOf('ひみつ')<0&&!/Bot /.test(e13),'★★★トークンは出さない');
ok(/Reset Token/.test(errJa('GET','/users/@me',401,'{}')),
   '★401 はトークンの入れ直しを案内');
ok(/招待 URL/.test(errJa('GET','/guilds/1/roles',404,'{}')),
   '★404 は招待とサーバーIDを案内');
ok(/チャンネルを見る/.test(errJa('GET','/channels/1/messages',403,
   '{"message":"Missing Access","code":50001}')),'★50001 はチャンネルの権限');

console.log('\n=== ボット自身の権限と位置（botState）===');
let f=fake({});
let st=await botState(f.api,GUILD,await f.api.roles(GUILD));
console.log('   '+st.topName+' position='+st.top+'／権限 '+permNames(st.perms).length+'個');
ok(st.id===BOT&&st.topName==='刈り取り配信','★★ボットのロールが分かる');
ok(st.top===1&&!st.admin&&!st.unknown,'★★position と管理者かどうかが分かる');
ok(st.perms===EIGHT,'★★★持っている権限が分かる（@everyone ＋ 自分のロール）');
ok(botTopOf([{id:'7',position:5},{id:'8',position:9}],['8']).top===9,
   '★★いちばん上のロールの position を探す');
const fu=fake({ noMember:true });
const su=await botState(fu.api,GUILD,await fu.api.roles(GUILD));
ok(su.unknown&&/50001/.test(su.why),'★★★読めないときは unknown（止めない）');

console.log('\n=== --dry-run：先に問題を見つける ===');
f=fake({});
let plan=await run(f,true);
const man=(p,k)=>(p.manual||[]).filter((x)=>!k||x.kind===k);
console.log('   手でやってほしいこと '+man(plan).length+'件：'
  +man(plan).map((x)=>x.kind+':'+x.name).join('／'));
ok(f.g.calls.filter((c)=>/^(POST|PATCH|PUT)/.test(c)).length===0,
   '★★★--dry-run では1回も書き込まない');
ok(man(plan,'権限').some((x)=>x.name==='管理者'
   &&(x.items||[]).join()==='ADMINISTRATOR'),
   '★★★dry-run で「管理者に ADMINISTRATOR を手で」と先に出す');
ok(man(plan,'並び').some((x)=>x.name==='管理者'&&/より\*\*上\*\*に手で/.test(x.how)),
   '★★★dry-run で「管理者はボットより上に手で」と先に出す');
ok(man(plan,'権限').some((x)=>x.name==='ボット自身'
   &&(x.items||[]).indexOf('ADD_REACTIONS')>=0),
   '★★★dry-run でチャンネルに書けない権限も先に出す');
ok(man(plan,'権限').some((x)=>x.name==='スタッフ'
   &&(x.items||[]).indexOf('CREATE_PUBLIC_THREADS')>=0),
   '★★スタッフの足りない権限も出す');
const txt=planText(plan,true);
ok(/手でやってほしいこと：\d+件/.test(txt),'★★一覧に「手でやってほしいこと」を出す');
ok(/ボットの権限：/.test(txt)&&/ボットのロール：刈り取り配信/.test(txt),
   '★★一覧にボットの権限と位置を出す');
ok(/もう一度このコマンドを実行/.test(txt),'★済んだらもう一度と書く');

console.log('\n=== 本実行：権限を落として作り、最後まで進む ===');
f=fake({});
plan=await run(f,false);
const roleOf=(n)=>f.g.roles.filter((r)=>r.name===n)[0]||{};
console.log('   ロール '+(f.g.roles.length-2)+'／チャンネル '+f.g.channels.length
  +'／手で '+man(plan).length+'件／できなかった '+(plan.fails||[]).length+'件');
ok(f.g.roles.filter((r)=>r.name==='管理者').length===1,
   '★★★管理者ロールは作る（権限なしで）');
ok(BigInt(roleOf('管理者').permissions||'0')===0n,
   '★★★持っていない権限（ADMINISTRATOR）は付けずに作る');
ok(BigInt(roleOf('スタッフ').permissions||'0')
   ===permBits(['VIEW_CHANNEL','SEND_MESSAGES','READ_MESSAGE_HISTORY',
                'MANAGE_MESSAGES']),
   '★★★スタッフは付けられる4つだけで作る（残りは手で）');
ok(f.g.channels.filter((c)=>c.type===4).length===5
   &&f.g.channels.filter((c)=>c.type===0).length===14,
   '★★★ロールでつまずいてもチャンネルは全部作る');
ok(Object.keys(f.g.msgs).length===3,'★★★案内文の投稿まで進む');
ok((plan.fails||[]).length===0,'★断られる送信は**そもそも送らない**');
ok(f.g.calls.filter((c)=>/^PATCH roles order/.test(c)).length===0,
   '★★★作った順でもう正しい並びなら、並べ替えを送らない（400 を出さない）');

console.log('\n=== 並び：ボットより上には並べ替えない ===');
const posOf=(n)=>Number(roleOf(n).position||0);
const botPos=Number((f.g.roles.filter((r)=>r.id===f.g.botRole)[0]||{}).position||0);
console.log('   '+CFG.roles.map((r)=>r.name+':'+posOf(r.name)).join(' ')
  +'／刈り取り配信:'+botPos);
ok(CFG.roles.every((r)=>posOf(r.name)<botPos),
   '★★★全部ボットのロールより下に置く（上には動かさない）');
ok(posOf('スタッフ')>posOf('プレミアム')&&posOf('プレミアム')>posOf('スタンダード')
   &&posOf('スタンダード')>posOf('ライト')&&posOf('ライト')>posOf('モニター')
   &&posOf('モニター')>posOf('配信ボット'),
   '★★★管理者以外は上から順に強く並べる');
ok(man(plan,'並び').some((x)=>x.name==='管理者'
   &&/管理者 ＞ スタッフ/.test(x.how)),
   '★★★管理者は「手でこの順に並べて」と案内する');

console.log('\n=== 並び替えが断られても止まらない ===');
/* わざと**逆の順**で先に作ってあるサーバー（並べ替えが必要になる）。 */
const REV=CFG.roles.slice().reverse().map((r)=>({ name:r.name }));
f=fake({ orderFail:true, roles:REV });
plan=await run(f,false);
console.log('   できなかった '+(plan.fails||[]).length+'件／1つずつ '
  +f.g.calls.filter((c)=>c==='PATCH roles order x1').length+'回');
ok(f.g.calls.filter((c)=>c==='PATCH roles order x1').length>0,
   '★★★まとめて断られたら1つずつ試す');
ok((plan.fails||[]).length>0&&/50013/.test(plan.fails[0].msg),
   '★★できなかったことを原因つきで残す');
ok(f.g.channels.filter((c)=>c.type===0).length===14,
   '★★★並び替えに失敗してもチャンネルを作る');
ok((plan.roles||[]).some((x)=>x.act==='order'),
   '★★並べ替えが必要なことは一覧に出す');
ok(Object.keys(f.g.msgs).length===3,
   '★★★並び替えに失敗しても案内文を投稿する');
ok(/できなかったこと（止めずに進めました）/.test(planText(plan,false)),
   '★★一覧に「できなかったこと」を出す');

console.log('\n=== すでにある管理者ロールの権限を**外さない** ===');
f=fake({ roles:[{ name:'管理者', color:0xe53935, hoist:true,
                  permissions:String(PERM.ADMINISTRATOR) }] });
/* 手で管理者をボットより上に動かしてある状態にする */
(function(){ const r=f.g.roles.filter((x)=>x.name==='管理者')[0];
  const b=f.g.roles.filter((x)=>x.id===f.g.botRole)[0];
  const t=r.position; r.position=b.position+1; b.position=t; })();
plan=await run(f,false);
ok(BigInt(roleOf('管理者').permissions)===PERM.ADMINISTRATOR,
   '★★★手で付けた管理者権限を**勝手に外さない**');
ok(!(plan.roles||[]).some((x)=>x.act==='fix'&&x.name==='管理者'),
   '★★ボットより上のロールは直そうとしない（断られる送信をしない）');
ok(f.g.channels.filter((c)=>c.type===0).length===14,'★★チャンネルは作る');
ok(!man(plan,'権限').some((x)=>x.name==='管理者'),
   '★★★手で付け終わった権限は、もう頼まない');
ok(!man(plan,'並び').some((x)=>x.name==='管理者'),
   '★★★手でボットより上に動かし終わったら、もう頼まない');

console.log('\n=== ボットが管理者なら今までどおり ===');
f=fake({ botPerms:PERM.ADMINISTRATOR });
plan=await run(f,false);
ok(BigInt(roleOf('管理者').permissions)===PERM.ADMINISTRATOR,
   '★★★ボットが管理者なら ADMINISTRATOR も付けられる');
ok(man(plan,'権限').length===0,'★★そのときは「手で」は出さない');

console.log('\n=== 権限が読めないときも進む ===');
f=fake({ noMember:true });
plan=await run(f,true);
ok(man(plan,'確認').some((x)=>/読めません/.test(x.name)),
   '★★★読めないことを一覧に出す');
ok((plan.roles||[]).filter((x)=>x.act==='add').length===7,
   '★★それでも作る予定は出す');

console.log('\n=== チャンネル1本が断られても残りは作る ===');
f=fake({ chFail:'よくある質問' });
plan=await run(f,false);
console.log('   チャンネル '+f.g.channels.filter((c)=>c.type===0).length+'本');
ok(f.g.channels.filter((c)=>c.type===0).length===13,
   '★★★1本だけ失敗して、残り13本は作る');
ok(man(plan,'作る').some((x)=>x.name==='よくある質問'),
   '★★作れなかったチャンネルを「手で」に出す');
ok(Object.keys(f.g.msgs).length===3,'★★案内文の投稿まで進む');

console.log('\n=== overwrites も持っていない権限は書かない ===');
const drop=[];
const rows=overwritesFor({ name:'x', view:['@everyone'], send:[] },CFG,
  { '@everyone':GUILD, admin:'1', staff:'2' },EIGHT,drop);
ok(rows.every((r)=>(BigInt(r.allow)|BigInt(r.deny))===
   ((BigInt(r.allow)|BigInt(r.deny))&EIGHT)),
   '★★★allow も deny もボットの権限の中だけ');
ok(drop.indexOf('ADD_REACTIONS')>=0,'★★書けなかった権限をためる');
const rows2=overwritesFor({ name:'x', view:['@everyone'], send:[] },CFG,
  { '@everyone':GUILD, admin:'1', staff:'2' });
ok(rows2.some((r)=>(BigInt(r.deny)&PERM.ADD_REACTIONS)===PERM.ADD_REACTIONS),
   '★渡さなければ今までどおり（絞らない）');

console.log('\n=== README の案内 ===');
const rd=fs.readFileSync('README.md','utf8');
ok(rd.indexOf('permissions='+permBits(INVITE_PERMS).toString())>0,
   '★★★招待 URL の権限が11個ぶんに更新されている');
ok(/管理者（Administrator）は入れません/.test(rd),
   '★★ボットに管理者は持たせないと書く');
ok(/いちばん上/.test(rd)&&/50013/.test(rd),
   '★★★ボットのロールをいちばん上に、と原因つきで書く');
ok(/手でやってほしいこと/.test(rd),'★★「手でやってほしいこと」の説明がある');
ok(/途中で止まりません/.test(rd),'★★止まらないと書く');
ok(/1 → 2 → 3 → 4/.test(rd),'★手順は4つ（dry-run →実行→手作業→もう一度）');
T.done();
