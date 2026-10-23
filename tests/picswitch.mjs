/* Worker：写真を eBay 保管（EPS）に切り替える（7.42）
   ・POST /ebay/pics/switch … 出品の写真を EPS だけにして、自前ホストの紐づけを外す
   ・方式は「預け直す（fresh）」だけ（7.44）。預け直さない方式は写真が落ちるのでやめた
   ・切り替えたあとに写真が減っていたら「写真が減りました」と出して止める
   ・urls を渡すと、その写真（順番そのまま）で入れ替える（落ちた写真を戻す）
   ・送るのは PictureDetails だけ（価格・数量・タイトルは1つも送らない）
   ・管理者だけ／2件以上は confirm:true／1回 PICS_MAX 件まで */
import { harness, makeEnv, asJson } from './lib.mjs';
const T=harness('Worker：写真を eBay 保管に切り替え');
const ok=T.ok;
const m=await import('file://'+process.cwd()+'/proxy-sync/worker.js?pics=1');
const worker=m.default, W=m.__test;
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  EBAY_CLIENT_ID:'cid', EBAY_CLIENT_SECRET:'sec', EBAY_USER_REFRESH_TOKEN:'rt' });
const H=(k)=>({'X-PJ-Key':k,'content-type':'application/json'});
const call=async(body,key)=>asJson(await worker.fetch(
  new Request('https://x/ebay/pics/switch',
    {method:'POST',headers:H(key||'k'),body:JSON.stringify(body)}),env));

/* eBay の持ち方をまねる。
   ・pics … いま出品に入っている写真（PictureURL）
   ・ext  … 自前ホストの紐づけ（ExternalPictureURL）。これが残っているあいだ、
            アプリの Revise はメイン画像を取り直そうとして失敗する
   ・reuseWorks … 同じURLを送り直したときに eBay が変更と認識するか
     （KB 5091 の注意。認識しないと紐づけは消えない） */
const R2='https://pj-img.example.workers.dev/i/20261017/'
  +'9113905f-e34f-44b5-9671-54f525b28e49.jpg';
const B64=(w,h)=>Buffer.from(w+'X'+h,'utf8').toString('base64');
const EPS=(n)=>'https://i.ebayimg.com/00/s/'+B64(1600,1200)+'/z/old'+n+'/$_1.JPG?set_id=88';
let calls=[], state=null, reuseWorks=true, reviseAck='Success', newId=0, drop=0;
let made={}, srcs=[], notes=[];
const reset=(o)=>{
  calls=[]; newId=0; made={}; srcs=[]; notes=[]; reuseWorks=(o&&'reuseWorks' in o)?o.reuseWorks:true;
  reviseAck=(o&&o.ack)||'Success';
  drop=(o&&o.drop)||0;
  state={ pics:(o&&o.pics)||[EPS(1),EPS(2),EPS(3)],
          ext:(o&&'ext' in o)?o.ext:[R2],
          source:(o&&o.source)||'Vendor' };
};
const getItemXml=()=>'<GetItemResponse><Ack>Success</Ack><Item>'
  +'<Title>Satan Gundam SDX Figure</Title>'
  +'<SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus>'
  +'<PictureDetails><GalleryType>Gallery</GalleryType>'
  +'<PictureSource>'+state.source+'</PictureSource>'
  +state.pics.map((u)=>'<PictureURL>'+u+'</PictureURL>').join('')
  +state.ext.map((u)=>'<ExternalPictureURL>'+u+'</ExternalPictureURL>').join('')
  +'</PictureDetails></Item></GetItemResponse>';
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  calls.push({url,method:o.method||'GET',headers:o.headers||{},body:String(o.body||'')});
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/ws\/api\.dll/.test(url)){
    const name=o.headers['X-EBAY-API-CALL-NAME'];
    if(name==='GetItem')
      return new Response(getItemXml(),{status:200,headers:{'content-type':'text/xml'}});
    if(name==='ReviseFixedPriceItem'){
      if(reviseAck!=='Success')
        return new Response('<ReviseFixedPriceItemResponse><Ack>Failure</Ack>'
          +'<Errors><ErrorCode>20004</ErrorCode>'
          +'<ShortMessage>A mixture of Self Hosted and EPS pictures are not allowed.'
          +'</ShortMessage></Errors></ReviseFixedPriceItemResponse>',
          {status:200,headers:{'content-type':'text/xml'}});
      const sent=[...String(o.body).matchAll(/<PictureURL>([^<]+)<\/PictureURL>/g)]
        .map((x)=>x[1]);
      const same=sent.length===state.pics.length
        &&sent.every((u,k)=>u===state.pics[k]);
      /* 写真が変わったとき（または eBay が同じURLでも変更と認めたとき）だけ、
         自前ホストの紐づけが消えて EPS 扱いになる。 */
      if(!same||reuseWorks){
        /* drop を立てると、eBay が1枚目を落とす（880025406600 で起きたこと）。 */
        state.pics=drop?sent.slice(drop):sent;
        state.ext=[]; state.source='EPS';
      }
      return new Response('<ReviseFixedPriceItemResponse><Ack>Success</Ack>'
        +'</ReviseFixedPriceItemResponse>',{status:200,headers:{'content-type':'text/xml'}});
    }
    throw new Error('想定外の呼び出し: '+name);
  }
  if(/create_image_from_url/.test(url)){
    newId++;
    /* 本物と同じ挙動：$_1.JPG を渡すと小さい版（400×300）、
       $_57.JPG を渡すと大きい版（1600×1200）が取り込まれる（7.45）。 */
    const src=JSON.parse(String(o.body||'{}')).imageUrl||'';
    const sz=W.epsSize(src);
    made[newId]=(/i\.ebayimg\.com/.test(src)&&!/\$_57\./.test(src))
      ? {w:400,h:300}                                  // 小さい版を取り込む
      : ((sz.w>0)?sz:{w:1600,h:1200});                 // 指定どおりの大きさ
    srcs.push(src);
    return new Response('',{status:201,headers:{'location':
      'https://apim.ebay.com/commerce/media/v1_beta/image/NEW-'+newId}});
  }
  if(/\/image\/NEW-\d+$/.test(url)){
    const n=url.split('-').pop();
    const sz=made[n]||{w:1600,h:1200};
    return new Response(JSON.stringify({
      imageUrl:'https://i.ebayimg.com/00/s/'+B64(sz.w,sz.h)+'/z/new'+n
        +'/$_1.JPG?set_id=88',
      maxDimensionImageUrl:'https://i.ebayimg.com/00/s/'+B64(sz.w,sz.h)+'/z/new'+n
        +'/$_57.JPG',
      expirationDate:'2026-11-17T00:00:00.000Z'}),
      {status:200,headers:{'content-type':'application/json'}});
  }
  if(/^https:\/\/i\.ebayimg\.com\//.test(url))
    return new Response(new Uint8Array([0xff,0xd8]),{status:200,
      headers:{'content-type':'image/jpeg'}});
  if(/discord/.test(url)){ notes.push(JSON.parse(String(o.body||'{}')).content||'');
    return new Response(null,{status:204}); }
  throw new Error('想定外の通信: '+url);
};
const revises=()=>calls.filter((c)=>/ws\/api\.dll/.test(c.url)
  &&c.headers['X-EBAY-API-CALL-NAME']==='ReviseFixedPriceItem');
const creates=()=>calls.filter((c)=>/create_image_from_url/.test(c.url));

console.log('=== 送るのは写真だけ（picsBody）===');
const body=W.picsBody('880025406600',['https://i.ebayimg.com/a.jpg']);
console.log('   '+body.replace(/^<\?xml[^>]*>/,''));
ok(/<ItemID>880025406600<\/ItemID>/.test(body),'★ItemID を送る');
ok(/<PictureDetails><PictureURL>https:\/\/i\.ebayimg\.com\/a\.jpg<\/PictureURL>/
   .test(body),'★PictureURL を送る');
ok(!/StartPrice|Quantity|<Title>|ListingDetails|PictureSource|ExternalPictureURL/
   .test(body),
   '★★価格・数量・タイトル・PictureSource・ExternalPictureURL は送らない');
ok(W.PICS_MAX===10,'★1回の上限は10件');

console.log('\n=== 預け直して切り替える（fresh だけ）===');
reset({});
let r=await call({item_id:'880025406600'});
const it=r.body.items[0];
console.log('   前: '+JSON.stringify({n:it.before.n,ext:it.before.ext_n,
  source:it.before.picture_source}));
console.log('   後: '+JSON.stringify({n:it.after.n,ext:it.after.ext_n,
  source:it.after.picture_source}));
console.log('   直し方: '+it.fixed_by+'／預け直し '+creates().length+'件'
  +'／送った写真 '+JSON.stringify(it.tries[0].sent));
ok(r.status===200&&r.body.ok===true&&it.done===true,'★切り替えられた');
ok(it.fixed_by==='fresh'&&r.body.mode==='fresh','★★方式は預け直し（fresh）だけ');
ok(creates().length===3,'★★写真3枚ぶんを Media API で預け直す');
ok(it.tries[0].sent.every((u)=>/i\.ebayimg\.com\/.*new/.test(u)),
   '★★新しい EPS の URL を送る（URL が変わるので eBay が変更と認識する）');
ok(it.tries.length===1,'★★預け直さない方式は試さない（写真が落ちるため）');
ok(it.before.ext_n===1&&it.before.picture_source==='Vendor',
   '★前は自前ホストの紐づけが1件（メイン画像）');
ok(it.after.ext_n===0&&it.after.eps_only===true&&it.after.picture_source==='EPS',
   '★★後は紐づけが消えて eBay 保管だけになる');
ok(it.after.n===3&&it.n_before===3&&it.n_after===3,'★枚数は変わらない');
ok(r.body.items[0].changed===true,'★送ったときは「送った」と分かる形で返す');
ok(revises().length===1,'★Revise は1回だけ');
ok(!/StartPrice|Quantity|<Title>/.test(revises()[0].body),
   '★★実際に送った中身にも価格・数量・タイトルは入らない');
ok(calls.filter((c)=>c.headers['X-EBAY-API-CALL-NAME']==='GetItem').length===2,
   '★前と後で GetItem を1回ずつ（結果を並べて出せる）');

console.log('\n=== eBay の写真は「いちばん大きい版」に直して渡す（7.45）===');
console.log('   直し方: '+W.epsMaxUrl(EPS(1)));
ok(/\/\$_57\.JPG\?set_id=88$/.test(W.epsMaxUrl(EPS(1))),
   '★★i.ebayimg.com の $_1.JPG は $_57.JPG（最大サイズ）に直す');
ok(W.epsMaxUrl(R2)===R2,'★pj-img の写真はそのまま渡す');
console.log('   大きさ: '+JSON.stringify(W.epsSize(EPS(1)))
  +'／'+JSON.stringify(W.epsSize('https://i.ebayimg.com/00/s/NDAwWDMwMA==/z/a/$_1.JPG')));
ok(W.epsSize(EPS(1)).w===1600&&W.epsSize(EPS(1)).h===1200,
   '★★URL の /s/ から大きさを読める');
ok(W.epsSize('https://i.ebayimg.com/00/s/NDAwWDMwMA==/z/a/$_1.JPG').w===400,
   '★小さい版（400×300）も読める');
reset({});
r=await call({item_id:'880025406600'});
console.log('   渡した元画像: '+JSON.stringify(srcs));
console.log('   預かった写真: '+JSON.stringify(
  r.body.items[0].tries[0].eps.map((e)=>e.w+'×'+e.h)));
ok(srcs.every((u)=>/\$_57\./.test(u)),'★★元画像は $_57.JPG で渡す');
ok(r.body.items[0].done===true
   &&r.body.items[0].tries[0].eps.every((e)=>e.long===1600),
   '★★大きい版（1600×1200）で預かれる');

console.log('\n=== 小さくなったら Revise を送らない（7.45）===');
reset({});
/* 直さずに $_1.JPG のまま渡すと 400×300 になる、という状況を作る。 */
const keep=W.epsMaxUrl;
r=await call({item_id:'880025406600',
  urls:['https://i.ebayimg.com/00/s/'+B64(400,300)+'/z/small/$_57.JPG']});
const sm=r.body.items[0];
console.log('   '+JSON.stringify({done:sm.done,error:sm.error,
  eps:sm.tries[0].eps.map((e)=>e.w+'×'+e.h)}));
ok(sm.done===false&&/写真が小さくなりました/.test(sm.error||''),
   '★★長辺500px未満なら「写真が小さくなりました」と止める');
ok(r.body.items[0].changed===false&&!r.body.items[0].after,
   '★★eBay に送っていないことが分かる形で返す（画面で「送っていません」と出す）');
ok(/400×300/.test(sm.error||''),'★大きさも出す');
ok(revises().length===0,'★★Revise は送らない（21919137 を出さない）');

console.log('\n=== 写真が減ったら止める（7.44）===');
reset({drop:1});
r=await call({item_id:'880025406600'});
const it2=r.body.items[0];
console.log('   '+JSON.stringify({done:it2.done,n_sent:it2.tries[0].n_sent,
  n_after:it2.n_after,error:it2.error}));
ok(it2.done===false&&r.body.ok===false,'★★減ったときは「できました」と言わない');
ok(/写真が減りました/.test(it2.error||''),'★★「写真が減りました」と出す');
ok(/前 3枚・送った 3枚 → 後 2枚/.test(it2.error||''),'★★枚数も出す');

console.log('\n=== 落ちた写真を元の URL から戻す（7.44）===');
reset({pics:[EPS(2),EPS(3)],ext:[R2]});   // メインが落ちて2枚になった状態
r=await call({item_id:'880025406600',urls:[R2,EPS(2),EPS(3)]});
const it3=r.body.items[0];
console.log('   送った写真: '+JSON.stringify(it3.tries[0].sent));
console.log('   元画像: '+JSON.stringify(it3.tries[0].eps.map((e)=>e.source)));
ok(it3.done===true&&it3.n_before===2&&it3.n_after===3,
   '★★2枚から3枚に戻せる（増えるのは止めない）');
ok(it3.tries[0].eps[0].source===R2,'★★1枚目は指定した R2 の URL（メインに戻る）');
ok(creates().length===3,'★指定した3枚を預け直す');
ok(it3.after.ext_n===0&&it3.after.picture_source==='EPS','★自前ホストの紐づけも消える');
r=await call({item_id:'880025406600',urls:['https://example.com/a.jpg']});
ok(r.status===400&&r.body.error==='bad_url','★関係ないURLは 400');
r=await call({item_ids:['880025406600','880025406601'],urls:[R2],confirm:true});
ok(r.status===400&&r.body.error==='urls_one_item','★写真を指定できるのは1件のときだけ');

console.log('\n=== もう eBay 保管だけの出品は触らない ===');
reset({ext:[],source:'EPS'});
r=await call({item_id:'880025406600'});
console.log('   '+JSON.stringify({done:r.body.items[0].done,
  fixed_by:r.body.items[0].fixed_by,note:r.body.items[0].tries[0].note}));
ok(r.body.items[0].done===true&&r.body.items[0].fixed_by==='already',
   '★★すでに eBay 保管だけなら「もともと」と返す');
ok(revises().length===0,'★★出品を書き換えない');

console.log('\n=== 自前ホストの写真が残っている出品も直せる ===');
reset({pics:[R2,EPS(2)]});
r=await call({item_id:'880025406600'});
console.log('   '+JSON.stringify({done:r.body.items[0].done,
  sent:r.body.items[0].tries[0].sent}));
ok(r.body.items[0].done===true,'★★R2 の写真もそのまま預け直して切り替えられる');
ok(r.body.items[0].tries[0].eps[0].source===R2,'★元画像は R2 の写真');
ok(r.body.items[0].tries[0].sent.every((u)=>/i\.ebayimg\.com/.test(u)),
   '★★送るのは EPS の URL だけ（混在にしない）');

console.log('\n=== eBay が断ったとき ===');
reset({ack:'Failure'});
r=await call({item_id:'880025406600'});
console.log('   '+JSON.stringify({ok:r.body.ok,error:r.body.items[0].error}));
ok(r.body.ok===false&&/20004|ReviseFixedPriceItem が失敗/.test(r.body.items[0].error||''),
   '★★失敗の理由（エラーコードと文）をそのまま返す');

console.log('\n=== 切り替えた出品に「eBay 保管済み」の印を付ける（7.46）===');
await env.DB.prepare(`INSERT INTO items (asin,cond,scope,ebay_item_id,ebay_qty,
  updated_at) VALUES ('B0PSW00001','used','ebay','880025406600',1,'2026-10-19T00:00:00Z')`)
  .run();
reset({});
r=await call({item_id:'880025406600'});
let mark=await env.DB.prepare(
  `SELECT pics_eps,pics_eps_at,pics_n FROM items WHERE asin='B0PSW00001'`).first();
console.log('   '+JSON.stringify(mark)+'／返し: '+r.body.items[0].pics_eps);
ok(Number(mark.pics_eps)===1&&Number(mark.pics_n)===3&&!!mark.pics_eps_at,
   '★★通った出品には印と枚数を残す（二度切り替えない）');
ok(r.body.items[0].pics_eps===1,'★結果にも印を返す');
reset({ack:'Failure'});
await env.DB.prepare(`UPDATE items SET pics_eps=0 WHERE asin='B0PSW00001'`).run();
r=await call({item_id:'880025406600'});
mark=await env.DB.prepare(
  `SELECT pics_eps FROM items WHERE asin='B0PSW00001'`).first();
ok(Number(mark.pics_eps)===0,'★★失敗したときは印を付けない');

console.log('\n=== 写真が抜けているとき（7.46）===');
reset({pics:[EPS(2),EPS(3)],ext:[R2]});     // eBay は2枚、手元は3枚
r=await call({item_id:'880025406600',urls:[R2,EPS(2),EPS(3)]});
const ms=r.body.items[0];
console.log('   '+JSON.stringify({missing:ms.missing,restore:ms.restore,
  n_before:ms.n_before,n_after:ms.n_after}));
ok(ms.missing===2&&ms.restore===3,
   '★★「eBay 2枚／元 3枚」と分かる形で返す');
ok(ms.done===true&&ms.n_after===3,'★★手元の全枚数で戻せる');

console.log('\n=== まとめて（確認つき・上限あり）===');
reset({});
r=await call({item_ids:['880025406600','880025406601'],confirm:true});
console.log('   '+JSON.stringify({n:r.body.n,done:r.body.done}));
ok(r.status===200&&r.body.n===2&&r.body.done===2,'★2件まとめて切り替えられる');
r=await call({item_ids:['880025406600','880025406601']});
ok(r.status===400&&r.body.error==='need_confirm',
   '★★2件以上は confirm:true が無いと動かない');
r=await call({item_ids:['880025406600','880025406601','880025406602',
                        '880025406603','880025406604','880025406605',
                        '880025406606','880025406607','880025406608',
                        '880025406609','880025406610'],confirm:true});
ok(r.status===400&&r.body.error==='too_many'&&r.body.max===10,
   '★★1回11件以上は 400（上限10件）');
reset({});
r=await call({item_ids:['880025406600','880025406600'],confirm:true});
ok(r.body.n===1,'★同じ ItemID は1回だけ');
r=await call({item_id:'abc'});
ok(r.status===400&&r.body.error==='bad_item_id','★ItemID の形が違えば 400');

console.log('\n=== 管理者だけ ===');
r=await call({item_id:'880025406600'},'staff-key-123');
ok(r.status===403&&r.body.error==='forbidden_for_staff','★★作業者キーでは切り替えられない');
r=await call({item_id:'880025406600'},'zzz');
ok(r.status===401,'★違うキーは 401');
reset({});
r=await call({item_id:'880025406600'},'staff-key-123');
ok(revises().length===0&&creates().length===0,
   '★★作業者キーのときは eBay を1回も呼ばない');

console.log('\n=== 行ごとに写真を渡して1回で送る（items・7.57）===');
reset({});
r=await call({items:[{item_id:'880000000001',urls:[R2]},
                     {item_id:'880000000002',urls:[R2]}],confirm:true});
console.log('   '+JSON.stringify({n:r.body.n,done:r.body.done,
  ids:(r.body.items||[]).map((x)=>x.item_id)}));
ok(r.status===200&&r.body.n===2,'★★1回の呼び出しで2件');
ok(revises().length===2,'★★出品ごとに Revise を送る');
ok((r.body.items||[])[0].item_id==='880000000001'
   &&(r.body.items||[])[1].item_id==='880000000002','★★結果も出品ごとに返す');
reset({});
r=await call({items:[{item_id:'880000000001',urls:[R2]},
                     {item_id:'880000000002',urls:[R2]}]});
ok(r.status===400&&r.body.error==='need_confirm','★2件以上は confirm が要る');
r=await call({items:[{item_id:'880000000001',urls:['https://example.com/a.jpg']}]});
ok(r.status===400&&r.body.error==='bad_url','★★写真のURLの形は items でも確かめる');
r=await call({items:[{item_id:'abc',urls:[R2]}]});
ok(r.status===400&&r.body.error==='bad_item_id','★ItemID の形も確かめる');
r=await call({items:new Array(11).fill(0).map((_,i)=>
  ({item_id:'88000000001'+i,urls:[R2]})),confirm:true});
ok(r.status===400&&r.body.error==='too_many','★★上限は items でも10件');
ok(W.picsUrlOk(R2)&&W.picsUrlOk(EPS(1))
   &&!W.picsUrlOk('https://example.com/a.jpg'),
   '★★使える写真のURLの決まりは1か所（picsUrlOk）');

console.log('\n=== Discord（notify）===');
reset({});
r=await call({items:[{item_id:'880000000001'}],
              confirm:true,notify:true,fresh:true});
console.log('   '+(notes[0]||'').split('\n').join(' / '));
ok(r.body.done===1,'★写真を指定しなければ、いまの写真を作り直す');
ok(notes.length===1,'★★1回の呼び出しで1通だけ');
ok(/🆕 出品しました（1件）/.test(notes[0]||''),'★★「出品しました」で出す');
ok(/eBayアプリで編集しないでください/.test(notes[0]||''),
   '★★「eBayアプリで編集しないでください」を必ず入れる');
ok(/メイン画像が抜けます/.test(notes[0]||''),'★★何が起きるかも書く');
reset({});
r=await call({items:[{item_id:'880000000001'}],confirm:true});
ok(notes.length===0,'★★notify が無ければ出さない');
/* 切り替えられなかったとき（まだ編集してはいけない）。 */
reset({ack:'Failure'});
r=await call({items:[{item_id:'880000000001',urls:[R2]}],
              confirm:true,notify:true,fresh:true});
console.log('   '+(notes[0]||'').split('\n').join(' / '));
ok(/できなかった 1件/.test(notes[0]||''),'★★できなかった件数を出す');
ok(/まだ\*\*切り替え待ち\*\*/.test(notes[0]||'')
   ||/まだ.*切り替え待ち/.test(notes[0]||''),'★★まだ待ちだと書く');
ok(/eBayアプリで編集しないでください/.test(notes[0]||''),'★注意は必ず付く');
/* 文だけを直に見る（picsNotifyText）。 */
const txt=W.picsNotifyText([{item_id:'1',done:true,title:'T',n_after:3,
  missing:2,restore:3}],true);
console.log('   '+txt.split('\n').join(' / '));
ok(/写真が抜けていたので 3枚に戻しました/.test(txt),'★★戻した枚数も出す');
ok(W.picsNotifyText([],true)==='','★0件なら何も出さない');

console.log('\n=== GetItem でも写真の枚数を控える（7.57）===');
reset({});
await env.DB.prepare(`INSERT INTO items (asin,cond,scope,title,ebay_item_id,
  ebay_qty,pics_eps,pics_n,updated_at) VALUES ('B0PIC00001','used','ebay','x',
  '880000000009',1,0,NULL,'2026-10-01T00:00:00Z')`).run();
let g=await asJson(await worker.fetch(new Request(
  'https://x/ebay/item?id=880000000009',{headers:H('k')}),env));
let row=await env.DB.prepare(
  `SELECT pics_n,pics_eps,substr(pics_eps_at,1,10) AS at FROM items
    WHERE asin='B0PIC00001'`).first();
console.log('   '+JSON.stringify({n:g.body.pictures&&g.body.pictures.n,row:row}));
ok(g.status===200&&g.body.ok===true,'★GetItem が通る');
ok(Number(row.pics_n)===3,'★★いまの写真の枚数を D1 に控える');
ok(Number(row.pics_eps)===0,'★自前ホストのままなら印は付けない');
reset({ext:[],source:'EPS'});
await worker.fetch(new Request('https://x/ebay/item?id=880000000009',
  {headers:H('k')}),env);
row=await env.DB.prepare(
  `SELECT pics_n,pics_eps,pics_eps_at FROM items WHERE asin='B0PIC00001'`).first();
ok(Number(row.pics_eps)===1&&!!row.pics_eps_at,
   '★★eBay 保管だけになっていれば印と日時も付ける');

T.done();
