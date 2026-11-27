/* 英題の決まり（shared/titlefit.js）と pj-title のキャラクターの別名（8.108・v358）

   カジの指示：商品に関係のない言葉や、ほかのブランド名を入れない／「Free Shipping」「L@@K」などの
   宣伝の言葉、記号の飾り、全部大文字は入れない／単語の途中で切らない／日本語の商品名から
   分からない情報を作り出さない。 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { harness, ROOT } from './lib.mjs';
const T=harness('英題の決まり・キャラクターの別名（8.108）');
const ok=T.ok;
const F=createRequire(import.meta.url)('../shared/titlefit.js');

console.log('=== 宣伝の言葉・記号の飾り・全部大文字 ===');
ok(F.tidy('BANPRESTO ONE PIECE Luffy Figure FREE SHIPPING L@@K!!')==='Banpresto One Piece Luffy Figure','★★★宣伝の言葉を落とし、全部大文字を直す');
ok(F.tidy('★Rare!! Hatsune Miku Figure** Fast Shipping')==='Hatsune Miku Figure','★★記号の飾りを落とす');
ok(F.tidy('POP UP PARADE Frieren')==='Pop Up Parade Frieren','★★大文字の並び（POP UP PARADE）はまとめて直す');
ok(F.tidy('SEGA Luminasta HG DXF')==='SEGA Luminasta HG DXF','★★略号・社名の決まった書き方（SEGA・HG・DXF）は残す');
ok(F.tidy('Mobile Suit Gundam SEED Destiny')==='Mobile Suit Gundam SEED Destiny','★SEED も残す');
ok(F.tidy('Dragon Quest XI S')==='Dragon Quest XI S','★ローマ数字は残す');
ok(F.tidy("Frieren: Beyond Journey's End")==="Frieren: Beyond Journey's End",'★ふつうの記号（: \'）は残す');
ok(F.tidy('Look Up Naruto')==='Look Up Naruto','★商品ラインの名前（Look Up）は宣伝の言葉にしない');
ok(F.promoHits('Free Shipping L@@K').length>=2,'★宣伝の言葉を見つけられる');

console.log('\n=== 種類の語（日本語の商品名から）===');
const n=(ja,o)=>F.nounOf(ja,o||{}).noun;
ok(n('ハズビン・ホテル アラスター フィギュア',{brand:'Banpresto'})==='Prize Figure','★★★Banpresto のフィギュアは Prize Figure');
ok(n('ワンピース ルフィ フィギュア',{brand:'Bandai Spirits',line:'Grandista'})==='Prize Figure','★★プライズの商品ライン（Grandista）');
ok(n('初音ミク ちょこのせ プライズ',{brand:'SEGA'})==='Prize Figure','★★日本語の「プライズ」「ちょこのせ」');
ok(n('一番くじ ワンピース A賞 ルフィ',{brand:'Banpresto',line:'Ichiban Kuji'})==='Figure','★★一番くじはプライズと書かない');
ok(n('ねんどろいど フリーレン',{brand:'Good Smile Company',line:'Nendoroid'})==='Figure','★★ふつうのフィギュアは Figure');
ok(n('ちいかわ ハチワレ ぬいぐるみ',{itemType:'figure'})==='Plush','★★ぬいぐるみ → Plush');
ok(n('ブルアカ シロコ アクスタ',{itemType:'other'})==='Acrylic Stand','★★アクスタ → Acrylic Stand');
ok(n('呪術廻戦 缶バッジ',{itemType:'other'})==='Can Badge','★缶バッジ → Can Badge');
ok(n('呪術廻戦 アクリルキーホルダー',{itemType:'other'})==='Acrylic Keychain','★アクキー → Acrylic Keychain');
ok(n('ガンダム HG プラモデル',{itemType:'model_kit'})==='','★プラモデルは呼び出し側の決まり（Plastic Model Kit）');
ok(n('なにかの小物',{itemType:'other'})==='','★★★分からないものは作り出さない');

console.log('\n=== 単語の途中で切らない ===');
const c=F.cutWords('Bandai Spirits Mobile Suit Gundam SEED Destiny Strike Freedom Gundam Metal Build Figure',60);
ok(c.length<=60&&'Bandai Spirits Mobile Suit Gundam SEED Destiny Strike Freedom Gundam Metal Build Figure'.indexOf(c)===0
   &&/ Strike$/.test(c),'★★★後ろの語から落とす（単語の途中で切らない）');
ok(F.MAX===80&&F.AIM===70,'★上限80字・目安70字');

console.log('\n=== pj-title：キャラクターの別名 ===');
const m=await import('file://'+path.join(ROOT,'proxy-title/worker.js')+'?t='+Date.now());
const { figAliasClean, FIG_SYSTEM, FIG_FIELDS }=m.__test;
const base={chara:'Alastor',chara_short:'Alastor',series:'Hazbin Hotel',brand:'Banpresto'};
ok(figAliasClean('Radio Demon',base)==='Radio Demon','★★★よく使われる別名は残す');
ok(figAliasClean('Alastor',base)===''&&figAliasClean('Alastor the Radio Demon',base)==='','★★名前と同じ・名前を含むものは捨てる');
ok(figAliasClean('Hazbin Hotel',base)==='','★作品名は別名にしない');
ok(figAliasClean('Bandai',base)===''&&figAliasClean('Disney Villain',base)==='','★★★ほかの社名・ブランド名は入れない');
ok(figAliasClean('Free Shipping',base)===''&&figAliasClean('Rare',base)===''&&figAliasClean('L@@K',base)==='','★★宣伝の言葉は入れない');
ok(figAliasClean('A very long nickname that goes on and on',base)==='','★長すぎるものは捨てる');
ok(figAliasClean('ラジオデーモン',base)==='','★英数字以外は捨てる');
ok(FIG_FIELDS.includes('chara_alias')&&/chara_alias/.test(FIG_SYSTEM),'★★pj-title が別名も返す');
ok(/certain/.test(FIG_SYSTEM)&&/another company's or brand's name/.test(FIG_SYSTEM),'★★確かなときだけ・ほかのブランド名は入れない、と指示する');
const src=(await import('node:fs')).readFileSync(path.join(ROOT,'proxy-title/worker.js'),'utf8');
ok(/"fig:v4:"/.test(src)&&/hit\.fields\.chara_alias !== undefined/.test(src),'★別名の無い古いキャッシュは使い回さない（v4）');
T.done();
