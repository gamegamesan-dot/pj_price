/* 英題のWorker（proxy-title）：機種の読み取り（6.28）
   pj_price が「対象外機種」をやめ、どの機種でも英題を作るようになったので、
   ドリームキャスト・セガサターン・ゲームキューブも読めないと
   機種違いの候補を落とせない。 */
import path from 'node:path';
import { harness, ROOT } from './lib.mjs';
const T=harness('英題のWorker：機種の読み取り');
const ok=T.ok;
const m=await import('file://'+path.join(ROOT,'proxy-title/worker.js')+'?t='+Date.now());
const { platformKey, platformsIn, filterCandidates }=m.__test;

console.log('=== pj_price から届く Platform を読む ===');
const want={
  'Sega Dreamcast':'dc','Sega Saturn':'ss','Nintendo GameCube':'gc',
  'Microsoft Xbox 360':'xbox360','Microsoft Xbox One':'xboxone',
  'Nintendo Wii':'wii','Nintendo Wii U':'wiiu',
  'Sony PlayStation':'ps1','Sony PlayStation 2':'ps2','Sony PlayStation 5':'ps5',
  'Sony PlayStation Vita':'psvita','Sony PSP':'psp',
  'Nintendo Switch':'switch','Nintendo Switch 2':'switch2','Nintendo 3DS':'3ds'
};
Object.keys(want).forEach(k=>{
  const got=platformKey(k);
  console.log('   '+k+' → '+got);
  ok(got===want[k],'★'+k+' → '+want[k]);
});

console.log('\n=== 和名からも読む ===');
[['Kanon カノン ドリームキャスト','dc'],['グランディア セガサターン','ss'],
 ['ピクミン ゲームキューブ','gc'],['テイルズ Xbox 360','xbox360']].forEach(([t,k])=>{
  ok(platformKey(t)===k,'★「'+t+'」→ '+k);
});

console.log('\n=== 機種違いの候補を落とす ===');
const r=filterCandidates([
  'Kanon Sega Dreamcast Japan Import',
  'Kanon PlayStation 2 Japan',
  'Kanon Nintendo Switch Japanese Version',
  'Kanon Japan Import'],{platform:'Sega Dreamcast',ja_title:'Kanon カノン'});
console.log('   残した: '+JSON.stringify(r.kept));
console.log('   落とした: '+JSON.stringify(r.dropped));
ok(r.kept.length===2,'★ドリームキャストの候補と、機種が書かれていない候補だけ残す');
ok(r.dropped.length===2&&r.dropped.every(x=>/機種違い/.test(x[1])),
   '★PS2・Switch の候補は「機種違い」で落とす');
const r2=filterCandidates(['Kanon PlayStation 2 Japan'],
  {platform:'Sony PlayStation 2',ja_title:'Kanon'});
ok(r2.kept.length===1,'同じ機種の候補は残す');
const r3=filterCandidates(['Final Fantasy X PlayStation 2'],
  {platform:'Sony PlayStation',ja_title:'ファイナルファンタジーX'});
console.log('   PS1 と PS2: '+JSON.stringify(r3.dropped));
ok(r3.kept.length===0,'★「Sony PlayStation」(PS1) と PS2 を取り違えない');
T.done();
