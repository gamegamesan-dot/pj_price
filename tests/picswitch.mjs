/* Worker：写真を eBay 保管（EPS）に切り替える（7.42）
   ・POST /ebay/pics/switch … 出品の写真を EPS だけにして、自前ホストの紐づけを外す
   ・mode=auto は「預け直さない（reuse）」→ だめなら「預け直す（fresh）」
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
const EPS=(n)=>'https://i.ebayimg.com/00/s/MTYwMFgxMjAw/z/old'+n+'/$_1.JPG?set_id=88';
let calls=[], state=null, reuseWorks=true, reviseAck='Success', newId=0;
const reset=(o)=>{
  calls=[]; newId=0; reuseWorks=(o&&'reuseWorks' in o)?o.reuseWorks:true;
  reviseAck=(o&&o.ack)||'Success';
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
      if(!same||reuseWorks){ state.pics=sent; state.ext=[]; state.source='EPS'; }
      return new Response('<ReviseFixedPriceItemResponse><Ack>Success</Ack>'
        +'</ReviseFixedPriceItemResponse>',{status:200,headers:{'content-type':'text/xml'}});
    }
    throw new Error('想定外の呼び出し: '+name);
  }
  if(/create_image_from_url/.test(url)){
    newId++;
    return new Response('',{status:201,headers:{'location':
      'https://apim.ebay.com/commerce/media/v1_beta/image/NEW-'+newId}});
  }
  if(/\/image\/NEW-\d+$/.test(url)){
    const n=url.split('-').pop();
    return new Response(JSON.stringify({
      imageUrl:'https://i.ebayimg.com/00/s/MTYwMFgxMjAw/z/new'+n+'/$_1.JPG?set_id=88',
      maxDimensionImageUrl:'https://i.ebayimg.com/00/s/MzIwMA/z/new'+n+'/$_57.JPG',
      expirationDate:'2026-11-17T00:00:00.000Z'}),
      {status:200,headers:{'content-type':'application/json'}});
  }
  if(/^https:\/\/i\.ebayimg\.com\//.test(url))
    return new Response(new Uint8Array([0xff,0xd8]),{status:200,
      headers:{'content-type':'image/jpeg'}});
  if(/discord/.test(url))return new Response('',{status:204});
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
ok(W.PICS_MAX===5,'★1回の上限は5件');

console.log('\n=== 預け直さないで直る場合（reuse）===');
reset({});
let r=await call({item_id:'880025406600',mode:'auto'});
const it=r.body.items[0];
console.log('   前: '+JSON.stringify({n:it.before.n,ext:it.before.ext_n,
  source:it.before.picture_source}));
console.log('   後: '+JSON.stringify({n:it.after.n,ext:it.after.ext_n,
  source:it.after.picture_source}));
console.log('   直し方: '+it.fixed_by+'／試した回数 '+it.tries.length
  +'／預け直し '+creates().length+'件');
ok(r.status===200&&r.body.ok===true&&it.done===true,'★切り替えられた');
ok(it.fixed_by==='reuse','★★預け直さずに直った（どちらで直ったかが分かる）');
ok(it.tries.length===1&&creates().length===0,
   '★★reuse で直ったら Media API は呼ばない');
ok(it.before.ext_n===1&&it.before.picture_source==='Vendor',
   '★前は自前ホストの紐づけが1件（メイン画像）');
ok(it.after.ext_n===0&&it.after.eps_only===true&&it.after.picture_source==='EPS',
   '★★後は紐づけが消えて eBay 保管だけになる');
ok(it.after.n===3,'★写真は3枚のまま（並びも変えない）');
ok(it.after.main===it.before.main,'★★メイン画像は入れ替わらない');
ok(revises().length===1,'★Revise は1回だけ');
ok(!/StartPrice|Quantity|<Title>/.test(revises()[0].body),
   '★★実際に送った中身にも価格・数量・タイトルは入らない');
ok(calls.filter((c)=>c.headers['X-EBAY-API-CALL-NAME']==='GetItem').length===2,
   '★前と後で GetItem を1回ずつ（結果を並べて出せる）');

console.log('\n=== 預け直さないと効かない場合は預け直す（auto → fresh）===');
reset({reuseWorks:false});
r=await call({item_id:'880025406600',mode:'auto'});
const it2=r.body.items[0];
console.log('   試した方式: '+it2.tries.map((t)=>t.mode+(t.done?'○':'×')).join(' → '));
console.log('   預け直し: '+creates().length+'件／新しい写真: '
  +JSON.stringify(it2.tries[1].sent));
ok(it2.done===true&&it2.fixed_by==='fresh','★★reuse が効かなければ fresh で直す');
ok(it2.tries.length===2&&it2.tries[0].done===false,'★reuse を先に試している');
ok(creates().length===3,'★★写真3枚ぶんを Media API で預け直す');
ok(it2.tries[1].sent.every((u)=>/i\.ebayimg\.com\/.*new/.test(u)),
   '★★新しい EPS の URL を送る（URL が変わるので eBay が変更と認識する）');
ok(it2.tries[1].eps.every((e)=>e.ok&&e.source.indexOf('i.ebayimg.com')>=0),
   '★元画像は eBay に今ある写真（R2 の記録が無くても預け直せる）');
ok(it2.expiration==='2026-11-17T00:00:00.000Z','★預けた写真の期限も返す');
ok(it2.after.ext_n===0&&it2.after.eps_only===true,'★★紐づけが消える');
ok(revises().length===2,'★Revise は reuse と fresh で1回ずつ');
ok(!revises().some((c)=>/StartPrice|Quantity|<Title>/.test(c.body)),
   '★★どちらの Revise にも価格・数量・タイトルは入らない');

console.log('\n=== もう eBay 保管だけの出品は触らない ===');
reset({ext:[],source:'EPS'});
r=await call({item_id:'880025406600',mode:'auto'});
console.log('   '+JSON.stringify({done:r.body.items[0].done,
  fixed_by:r.body.items[0].fixed_by,note:r.body.items[0].tries[0].note}));
ok(r.body.items[0].done===true&&r.body.items[0].fixed_by==='already',
   '★★すでに eBay 保管だけなら「もともと」と返す');
ok(revises().length===0,'★★出品を書き換えない');

console.log('\n=== 自前ホストの写真が残っている出品 ===');
reset({pics:[R2,EPS(2)],reuseWorks:false});
r=await call({item_id:'880025406600',mode:'reuse'});
console.log('   '+JSON.stringify({done:r.body.items[0].done,error:r.body.items[0].error}));
ok(r.body.items[0].done===false
   &&/預け直さない方式では切り替えられません/.test(r.body.items[0].error||''),
   '★★混在（Error 20004）になる形は reuse では送らない');
ok(revises().length===0,'★送る前に止める');

console.log('\n=== eBay が断ったとき ===');
reset({ack:'Failure'});
r=await call({item_id:'880025406600',mode:'reuse'});
console.log('   '+JSON.stringify({ok:r.body.ok,error:r.body.items[0].error}));
ok(r.body.ok===false&&/20004|ReviseFixedPriceItem が失敗/.test(r.body.items[0].error||''),
   '★★失敗の理由（エラーコードと文）をそのまま返す');

console.log('\n=== まとめて（確認つき・上限あり）===');
reset({});
r=await call({item_ids:['880025406600','880025406601'],mode:'auto',confirm:true});
console.log('   '+JSON.stringify({n:r.body.n,done:r.body.done}));
ok(r.status===200&&r.body.n===2&&r.body.done===2,'★2件まとめて切り替えられる');
r=await call({item_ids:['880025406600','880025406601'],mode:'auto'});
ok(r.status===400&&r.body.error==='need_confirm',
   '★★2件以上は confirm:true が無いと動かない');
r=await call({item_ids:['880025406600','880025406601','880025406602',
                        '880025406603','880025406604','880025406605'],confirm:true});
ok(r.status===400&&r.body.error==='too_many'&&r.body.max===5,
   '★★1回6件以上は 400（上限5件）');
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

T.done();
