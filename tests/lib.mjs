/* 確認用テストの共通部分（Worker を Node で動かすもの）。
   Cloudflare の D1 を node:sqlite で、KV を Map で代わりにする。
   外に出る通信（fetch）は必ず差し替えてから使う（本物のAPIは呼ばない）。 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const WORKER=path.join(ROOT,'proxy-sync/worker.js');
export const SCHEMA=path.join(ROOT,'proxy-sync/schema.sql');

// worker.js を読み込む。同じセッションで何度も読めるよう問い合わせ文字を付ける。
export async function loadWorker(tag){
  const m=await import('file://'+WORKER+'?t='+(tag||Date.now()));
  return { worker:m.default, T:m.__test };
}
/* D1 の代わり。prepare().bind().run()/first()/all() と batch() を満たす。
   D1 は1文に100個までしか値を渡せないので、超えたら同じように失敗させる。 */
export function makeDB(){
  const db=new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(SCHEMA,'utf8'));
  const norm=(a)=>a.map((v)=>v===undefined?null:(typeof v==='boolean'?(v?1:0):v));
  const mk=(sql)=>{
    let args=[];
    const o={
      bind(...a){ args=norm(a);
        if(args.length>100)throw new Error('D1_ERROR: too many SQL variables');
        return o; },
      async run(){ return { meta:db.prepare(sql).run(...args) }; },
      async first(){ const r=db.prepare(sql).all(...args);
        return r.length?{...r[0]}:null; },
      async all(){ return { results:db.prepare(sql).all(...args).map((x)=>({...x})) }; }
    };
    return o;
  };
  return { _db:db, prepare:mk, async batch(l){ for(const s of l)await s.run(); return []; } };
}
// KV の代わり
export function makeKV(){
  return { _m:new Map(),
    async get(k){ return this._m.get(k)||null; },
    async put(k,v){ this._m.set(k,v); } };
}
/* Worker に渡す env。鍵は 'k' 固定。
   Discord の宛先は本物の形にしておく（読み取り専用の見張りが宛先を見るため）。 */
export function makeEnv(extra){
  return Object.assign({ PJ_ACCESS_KEY:'k', DB:makeDB(), SYNC_CACHE:makeKV(),
    DISCORD_WEBHOOK_URL:'https://discord.com/api/webhooks/1/abc' },extra||{});
}
export const H={'X-PJ-Key':'k','content-type':'application/json'};
export const get=(p)=>new Request('https://x'+p,{headers:H});
export const post=(p,b)=>new Request('https://x'+p,{method:'POST',headers:H,
  body:(typeof b==='string')?b:JSON.stringify(b)});
export const asJson=async(r)=>({status:r.status,body:JSON.parse(await r.text())});

/* テスト1本の入り口。ブラウザ側の harness と同じ使い方にそろえてある。 */
export function harness(title){
  let ng=0, okN=0;
  const ok=(b,l)=>{ if(b)okN++; else ng++; console.log('  '+(b?'✅':'❌')+' '+l); };
  const done=()=>{
    // まとめ実行（tests/run.sh）が読む行。✅❌の文字は数えさせないので入れない
    console.log('RESULT '+okN+' '+ng+' '+title);
    if(ng)process.exitCode=1;
  };
  return { ok, done };
}
