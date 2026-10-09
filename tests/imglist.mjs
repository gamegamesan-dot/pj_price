/* 画像のWorker（proxy-img）：その日に上げた写真の一覧（復旧用・6.27）
   行を消すと写真のURLも一緒に消えるので、日付から探せるようにした。
   読み取りだけ・トークン必須。 */
import path from 'node:path';
import { harness, ROOT } from './lib.mjs';
const T=harness('画像のWorker：/list（復旧用）');
const ok=T.ok;
const m=await import('file://'+path.join(ROOT,'proxy-img/worker.js')+'?t='+Date.now());
const worker=m.default;

// R2 の代わり。list / get / put / delete だけ満たす。
function makeR2(keys){
  const m=new Map();
  (keys||[]).forEach((k,i)=>m.set(k,{key:k,size:100+i,
    uploaded:new Date(Date.UTC(2026,9,9,i,0,0))}));
  return {
    _m:m,
    async list(o){
      const pre=(o&&o.prefix)||'', lim=(o&&o.limit)||1000;
      const all=Array.from(m.values()).filter(x=>x.key.indexOf(pre)===0);
      return { objects:all.slice(0,lim), truncated:all.length>lim };
    },
    async get(k){ return m.get(k)?{body:'x',writeHttpMetadata(){},httpEtag:'"e"'}:null; },
    async put(k,v){ m.set(k,{key:k,size:1,uploaded:new Date()}); },
    async delete(k){ m.delete(k); }
  };
}
/* キーは本物と同じ形（YYYYMMDD/<uuid>.<拡張子>）にする。
   公開配信（/i/…）がこの形しか受け付けないため。 */
const U=(n)=>'0000000'+n+'-1111-4222-8333-444444444444';
const env={ UPLOAD_TOKEN:'tok',
  IMG:makeR2(['20261009/'+U(1)+'.jpg','20261009/'+U(2)+'.jpg','20261009/'+U(3)+'.png',
              '20261008/'+U(4)+'.jpg']) };
const ORIGIN='https://gamegamesan-dot.github.io';
const req=(p,o)=>new Request('https://img.example.workers.dev'+p,
  Object.assign({headers:{'Authorization':'Bearer tok','Origin':ORIGIN}},o||{}));
const j=async r=>({status:r.status,body:JSON.parse(await r.text())});

console.log('=== その日の写真を返す ===');
let r=await j(await worker.fetch(req('/list?day=20261009'),env));
console.log('   '+JSON.stringify(r.body).slice(0,220));
ok(r.status===200&&r.body.ok===true,'★200で返る');
ok(r.body.n===3,'★その日の3枚だけ（前の日は混ざらない）');
ok(r.body.items.every(x=>/^https:\/\/img\.example\.workers\.dev\/i\/20261009\//.test(x.url)),
   '★そのまま使える公開URLを返す');
ok(r.body.items[0].at>r.body.items[2].at,'★新しい順に並べる');
ok(r.body.items.every(x=>x.key&&x.size>0&&x.at),'キー・大きさ・上げた時刻も返す');
ok(r.body.truncated===false,'多すぎないときは truncated=false');

console.log('\n=== 日付の指定 ===');
r=await j(await worker.fetch(req('/list?day=2026-10-09'),env));
console.log('   区切り付き: '+r.status+' n='+r.body.n);
ok(r.status===200&&r.body.n===3,'★「2026-10-09」のような書き方でも読む');
for(const [q,label] of [['','日付なし'],['?day=2026','短すぎる'],['?day=abc','数字でない']]){
  const x=await j(await worker.fetch(req('/list'+q),env));
  console.log('   '+label+': '+x.status+' '+JSON.stringify(x.body));
  ok(x.status===400&&x.body.error==='bad_day','★'+label+'ときは断る（400）');
}
r=await j(await worker.fetch(req('/list?day=20261001'),env));
ok(r.status===200&&r.body.n===0,'その日に無ければ0件（エラーにしない）');

console.log('\n=== 件数の上限 ===');
// 1枚ずつ違うキーにする（同じキーだと1枚として数えられてしまう）
const UN=(i)=>'00000000-1111-4222-8333-'+String(i).padStart(12,'0');
const many=[]; for(let i=0;i<40;i++)many.push('20261009/'+UN(i)+'.jpg');
const env2={ UPLOAD_TOKEN:'tok', IMG:makeR2(many) };
r=await j(await worker.fetch(req('/list?day=20261009&limit=10'),env2));
console.log('   limit=10 → n='+r.body.n+' truncated='+r.body.truncated);
ok(r.body.n===10&&r.body.truncated===true,'★limit で絞り、続きがあることを知らせる');
r=await j(await worker.fetch(req('/list?day=20261009&limit=9999'),env2));
ok(r.body.n===40,'大きすぎる limit でも落ちない（上限は500）');

console.log('\n=== 鍵と呼び出し元 ===');
let x=await worker.fetch(new Request('https://img.example.workers.dev/list?day=20261009',
  {headers:{'Origin':ORIGIN}}),env);
console.log('   トークンなし: '+x.status);
ok(x.status===401,'★トークンが無ければ401（写真の一覧を誰にでも見せない）');
x=await worker.fetch(new Request('https://img.example.workers.dev/list?day=20261009',
  {headers:{'Authorization':'Bearer wrong-token','Origin':ORIGIN}}),env);
ok(x.status===401,'★トークンが違っても401');
x=await worker.fetch(new Request('https://img.example.workers.dev/list?day=20261009',
  {headers:{'Authorization':'Bearer tok','Origin':'https://evil.example.com'}}),env);
console.log('   ほかのサイトから: '+x.status);
ok(x.status===403,'★許していないサイトからは403');

console.log('\n=== 写真は消さない（読み取りだけ）===');
const n0=env.IMG._m.size;
await worker.fetch(req('/list?day=20261009'),env);
ok(env.IMG._m.size===n0,'★一覧を取っても写真は減らない');
console.log('\n=== これまでの口は変わっていない ===');
const pub=await worker.fetch(new Request(
  'https://img.example.workers.dev/i/20261009/'+U(1)+'.jpg'),env);
ok(pub.status===200,'公開配信（/i/…）は認証なしのまま');
const bad=await worker.fetch(new Request(
  'https://img.example.workers.dev/i/20261009/'+U(9)+'.jpg'),env);
ok(bad.status===404,'無いキーは404');
T.done();
