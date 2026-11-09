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
/* 1文が**いくつ値を欲しがるか**（7.118）。
   `?N` を使う文は **max(N)** 個（番号に抜けがあっても max まで）。
   `?` だけの文はその個数。D1（本物の SQLite）はこの数と渡した数が
   合わないと「Wrong number of parameter bindings for SQL query」で落ちる。
   文字列やコメントの中の ? は数えない。 */
export function wantBinds(sql){
  const s=String(sql||'');
  let out='', q=0, i=0;
  while(i<s.length){
    const c=s[i];
    /* SQL の文字列は **バックスラッシュでは逃がせない**（'' だけ）。
       ここを JS と同じに扱うと ESCAPE '\' のところで閉じ忘れて、
       そのあとの ? を数えなくなる。 */
    if(q){ out+=' ';
      if(c===q){ if(s[i+1]===q){ out+=' '; i+=2; continue; } q=0; }
      i++; continue; }
    if(c==="'"||c==='"'){ q=c; out+=' '; i++; continue; }
    if(c==='-'&&s[i+1]==='-'){ while(i<s.length&&s[i]!=='\n'){out+=' ';i++;} continue; }
    if(c==='/'&&s[i+1]==='*'){ const e=s.indexOf('*/',i);
      const n=(e<0?s.length:e+2)-i; out+=' '.repeat(n); i+=n; continue; }
    out+=c; i++;
  }
  /* SQLite の数え方：`?N` はその番号。番号なしの `?` は
     「いままでに出たいちばん大きい番号＋1」。全体で要る数は max。
     （この repo では混ぜない決まりだが、本物と同じに数えておく） */
  let max=0;
  const re=/\?(\d*)/g;
  let m;
  while((m=re.exec(out))){
    max = m[1] ? Math.max(max, Number(m[1])) : (max + 1);
  }
  return max;
}
/* D1 の代わり。prepare().bind().run()/first()/all() と batch() を満たす。
   D1 は1文に100個までしか値を渡せないので、超えたら同じように失敗させる。
   7.118：**値の数が合わないときも本物と同じように落とす**。
   node:sqlite は `?N` に抜けがあっても渡した順に当てはめてしまうので、
   このテストだけ通って本番で 500 になっていた
   （v226 の `?45`：D1 は45個、コードは42個）。 */
/* ---- D1 の「二重引用符の落とし穴」（DQS・7.123）----
   SQLite には「二重引用符の中が列として見つからなければ**文字列**として扱う」
   という古い仕様（double-quoted string literal）がある。
   **D1 ではこれが有効**なので
     SELECT "asin_n" FROM "mw_auto_runs" LIMIT 0
   は、asin_n という列が無くても**文字列 'asin_n' を返して成功する**。
   いっぽう **node:sqlite はこれを切ってある**ので、同じ文がエラーになる。

   そのため「素の "列" で列の有無を確かめる」コードは、
   **テストだけ正しく動いて本番ではいつも「ある」**になっていた
   （2026-11-09：migrate-0047／0048 がぜんぶ「済み」と誤判定され、
     流れていなかった。worker.js の colOk も同じ）。
   同じ間違いを二度としないため、**作り物も D1 と同じふるまい**にする。
   列を確かめるときは必ず「表.列」と書く（そちらは DQS が効かない）。 */
export function dqsProbe(sql){
  return /^\s*SELECT\s+"[A-Za-z0-9_]+"(\s*,\s*"[A-Za-z0-9_]+")*\s+FROM\s+"[A-Za-z0-9_]+"\s+LIMIT\s+0\s*$/i
    .test(String(sql||''));
}
export function makeDB(){
  const db=new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(SCHEMA,'utf8'));
  const norm=(a)=>a.map((v)=>v===undefined?null:(typeof v==='boolean'?(v?1:0):v));
  const mk=(sql)=>{
    /* 7.123：D1 と同じく、素の "列" だけの空振りの SELECT は
       **列が無くても通る**（文字列として読まれる）。
       この1行があるおかげで、素の "列" で列の有無を確かめるコードは
       テストでも本番と同じに「いつも ある」と答える＝間違いが見つかる。 */
    if(dqsProbe(sql)){
      const o0={ bind(){ return o0; }, async run(){ return { meta:{} }; },
        async first(){ return null; }, async all(){ return { results:[] }; } };
      return o0;
    }
    let args=[];
    const o={
      bind(...a){ args=norm(a);
        if(args.length>100)throw new Error('D1_ERROR: too many SQL variables');
        const want=wantBinds(sql);
        if(args.length!==want)
          throw new Error('D1_ERROR: Wrong number of parameter bindings for SQL query.'
            +'（この文は '+want+'個ほしいのに '+args.length+'個渡しています）');
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
