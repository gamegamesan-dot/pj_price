/* Worker：調べるための窓口（7.41）
   ・GET /ebay/item?id=… … GetItem の PictureDetails を、1枚目とそれ以降に分けて返す
   ・POST /eps/test {url} … R2 の写真1枚を Media API（createImageFromUrl）で預けてみる
   ・どちらも管理者だけ（作業者キーは 403）
   ・許可表：GetItem は読み取りに、Media API の create は書き込み（write:true）に足した
   ・UploadSiteHostedPictures は 2026-09-30 廃止なので使わない（許可表にも入れない） */
import { harness, makeEnv, get, post, asJson } from './lib.mjs';
const T=harness('Worker：写真の調査窓口（GetItem・EPS 試し打ち）');
const ok=T.ok;
const m=await import('file://'+process.cwd()+'/proxy-sync/worker.js?eps=1');
const worker=m.default, W=m.__test;
const env=makeEnv({ STAFF_KEY:'staff-key-123',
  EBAY_CLIENT_ID:'cid', EBAY_CLIENT_SECRET:'sec', EBAY_USER_REFRESH_TOKEN:'rt' });
const H=(k)=>({'X-PJ-Key':k,'content-type':'application/json'});
const req=(path,key,body)=>new Request('https://x'+path,
  body?{method:'POST',headers:H(key),body:JSON.stringify(body)}:{headers:H(key)});
const call=async(path,key,body)=>asJson(await worker.fetch(req(path,key,body),env));
const PIC='https://pj-img.example.workers.dev/i/20261017/'
  +'0123abcd-4567-89ab-cdef-0123456789ab.jpg';

/* eBay への通信を差し替える。calls に残して、何をどう呼んだかを見る。 */
let calls=[], epsStatus=201, getBody=null, r2=null;
const jpeg=(w,h)=>{ // 最小限の JPEG（SOF0 に縦横が入る）
  const b=[0xff,0xd8,0xff,0xc0,0,17,8,(h>>8)&255,h&255,(w>>8)&255,w&255,3,1,0x11,0,2,0x11,1,3,0x11,1];
  return new Uint8Array(b);
};
globalThis.fetch=async(u,i)=>{
  const url=String(u), o=i||{};
  calls.push({url:url,method:o.method||'GET',headers:o.headers||{},body:o.body||''});
  if(/identity\/v1\/oauth2\/token/.test(url))
    return new Response(JSON.stringify({access_token:'tok',expires_in:7200}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/ws\/api\.dll/.test(url)){
    const name=(o.headers||{})['X-EBAY-API-CALL-NAME']||'';
    if(name!=='GetItem')throw new Error('想定外の呼び出し: '+name);
    return new Response('<GetItemResponse><Ack>Success</Ack><Item>'
      +'<Title>テスト出品</Title><SellingStatus><ListingStatus>Active</ListingStatus>'
      +'</SellingStatus><PictureDetails><GalleryType>Gallery</GalleryType>'
      +'<PhotoDisplay>None</PhotoDisplay><PictureSource>Vendor</PictureSource>'
      +'<GalleryURL>https://pj-img.example.workers.dev/i/20261017/aaa.jpg</GalleryURL>'
      +'<PictureURL>https://pj-img.example.workers.dev/i/20261017/aaa.jpg</PictureURL>'
      +'<PictureURL>https://i.ebayimg.com/00/s/MTYwMFgxMjAw/z/bbb.jpg</PictureURL>'
      +'<ExternalPictureURL>https://pj-img.example.workers.dev/i/20261017/aaa.jpg'
      +'</ExternalPictureURL></PictureDetails></Item></GetItemResponse>',
      {status:200,headers:{'content-type':'text/xml'}});
  }
  if(/\/i\/\d{8}\//.test(url)){
    if(r2)return r2;
    return new Response(jpeg(1600,1200),{status:200,
      headers:{'content-type':'image/jpeg','cache-control':'public, max-age=31536000, immutable',
               'etag':'"abc"'}});
  }
  if(/create_image_from_url/.test(url)){
    if(epsStatus===403)
      return new Response(JSON.stringify({errors:[{errorId:1100,
        message:'Access denied',longMessage:'Insufficient permissions to fulfill the request.'}]}),
        {status:403,headers:{'content-type':'application/json'}});
    return new Response('',{status:201,headers:{
      'location':'https://apim.ebay.com/commerce/media/v1_beta/image/IMG-123456'}});
  }
  if(/\/image\/IMG-123456$/.test(url))
    return new Response(JSON.stringify(getBody||{
      imageUrl:'https://i.ebayimg.com/00/s/MTYwMFgxMjAw/z/zzz.jpg',
      maxDimensionImageUrl:'https://i.ebayimg.com/00/s/MzIwMFgyNDAw/z/zzz.jpg',
      expirationDate:'2026-11-16T01:00:00.000Z'}),
      {status:200,headers:{'content-type':'application/json'}});
  if(/discord/.test(url))return new Response('',{status:204});
  throw new Error('想定外の通信: '+url);
};

console.log('=== 許可表（増えたのは GetItem と Media API だけ）===');
const guard=(mth,url,call,write)=>{
  try{ W.assertReadOnly(url,mth,call?{'X-EBAY-API-CALL-NAME':call}:null,!!write); return 'ok'; }
  catch(e){ return 'blocked'; }
};
const TR='https://api.ebay.com/ws/api.dll';
const CRE='https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_url';
const GETI='https://apim.ebay.com/commerce/media/v1_beta/image/IMG-1';
console.log('   GetItem: '+guard('POST',TR,'GetItem',false)
  +'／UploadSiteHostedPictures: '+guard('POST',TR,'UploadSiteHostedPictures',true)
  +'／create(write): '+guard('POST',CRE,null,true)
  +'／create(write無し): '+guard('POST',CRE,null,false)
  +'／getImage: '+guard('GET',GETI,null,false));
ok(guard('POST',TR,'GetItem',false)==='ok','★GetItem（読み取り）を足した');
ok(guard('POST',TR,'UploadSiteHostedPictures',true)==='blocked',
   '★★廃止された UploadSiteHostedPictures は通らない（許可表に入れていない）');
ok(guard('POST',CRE,null,true)==='ok','★Media API の create は write:true でだけ通る');
ok(guard('POST',CRE,null,false)==='blocked','★write を付けない呼び出しは通らない');
ok(guard('GET',GETI,null,false)==='ok','★getImage（読み取り）は通る');
ok(guard('GET','https://pj-img.example.workers.dev/i/20261017/'
  +'0123abcd-4567-89ab-cdef-0123456789ab.jpg',null,false)==='ok',
   '★pj-img の写真は読み取りで取れる');
ok(guard('GET','https://example.com/secret.txt',null,false)==='blocked',
   '★関係ないURLは通らない');

console.log('\n=== 管理者だけ ===');
let r=await call('/ebay/item?id=880025406600','staff-key-123');
ok(r.status===403&&r.body.error==='forbidden_for_staff','★作業者キーでは GetItem を見られない');
r=await call('/eps/test','staff-key-123',{url:PIC});
ok(r.status===403,'★作業者キーでは試し打ちもできない');
r=await call('/ebay/item?id=880025406600','zzz');
ok(r.status===401,'★違うキーは 401');

console.log('\n=== GET /ebay/item（GetItem の読み取り）===');
calls=[];
r=await call('/ebay/item?id=880025406600','k');
console.log('   '+JSON.stringify({ack:r.body.ack,title:r.body.title,
  n:r.body.pictures.n,source:r.body.pictures.picture_source,
  display:r.body.pictures.photo_display}));
console.log('   メイン: '+r.body.pictures.main);
console.log('   2枚目以降: '+JSON.stringify(r.body.pictures.rest));
ok(r.status===200&&r.body.ok===true&&r.body.ack==='Success','★GetItem が通る');
ok(calls.some(c=>/ws\/api\.dll/.test(c.url)
  &&(c.headers['X-EBAY-API-CALL-NAME']==='GetItem')),'★呼ぶのは GetItem だけ');
ok(/<ItemID>880025406600<\/ItemID>/.test(
   (calls.find(c=>/ws\/api\.dll/.test(c.url))||{}).body||''),'★ItemID をそのまま送る');
ok(r.body.pictures.picture_source==='Vendor'&&r.body.pictures.photo_display==='None',
   '★★PictureSource・PhotoDisplay を返す（Self Hosted かどうかが分かる）');
ok(r.body.pictures.n===2&&r.body.pictures.main.indexOf('pj-img')>=0
   &&r.body.pictures.rest.length===1,'★★1枚目とそれ以降を分けて返す');
ok(r.body.pictures.main_is_eps===false&&r.body.pictures.rest_all_eps===true,
   '★★メインだけ R2（自前）で、ほかは eBay 保管…という違いが分かる');
ok((r.body.pictures.external_picture_url||[]).length===1,
   '★ExternalPictureURL も返す');
ok(/PictureDetails|PhotoDisplay/.test(r.body.pictures.raw||''),'★元のXMLも控えで返す');
r=await call('/ebay/item?id=abc','k');
ok(r.status===400&&r.body.error==='bad_item_id','★ItemID の形が違えば 400');

console.log('\n=== 写真の縦横を読む（長辺500pxの確認）===');
const sz=W.imageSize(jpeg(1600,1200).buffer);
console.log('   '+JSON.stringify(sz));
ok(sz.type==='jpeg'&&sz.w===1600&&sz.h===1200,'★JPEGの縦横を読める');
const png=new Uint8Array(32); png.set([0x89,0x50,0x4e,0x47],0);
new DataView(png.buffer).setUint32(16,800); new DataView(png.buffer).setUint32(20,600);
ok(W.imageSize(png.buffer).w===800,'★PNGの縦横も読める');

console.log('\n=== POST /eps/test（R2 → Media API の試し打ち）===');
calls=[]; epsStatus=201; r2=null;
r=await call('/eps/test','k',{url:PIC});
console.log('   R2: '+JSON.stringify(r.body.probe));
console.log('   create: '+JSON.stringify(r.body.create));
console.log('   EPS: '+r.body.eps_url+'（期限 '+r.body.expiration+'）');
ok(r.status===200&&r.body.ok===true,'★試し打ちが通る');
ok(r.body.probe.status===200&&r.body.probe.width===1600&&r.body.probe.height===1200
   &&r.body.probe.ok_for_ebay===true,
   '★★R2 の写真の状態・Content-Type・縦横（長辺500px以上か）を返す');
ok(r.body.probe.headers['content-type']==='image/jpeg'
   &&!!r.body.probe.headers['cache-control']&&r.body.probe.redirected===false,
   '★ヘッダーとリダイレクトの有無も返す');
const cre=calls.find(c=>/create_image_from_url/.test(c.url));
console.log('   送った中身: '+cre.body);
ok(cre&&JSON.parse(cre.body).imageUrl===PIC,'★R2 の URL をそのまま渡す');
ok(String(cre.headers['authorization']||'').indexOf('Bearer ')===0,
   '★Bearer トークンで呼ぶ（Trading の IAF ではない）');
ok(r.body.image_id==='IMG-123456','★Location から image_id を取る');
ok(r.body.eps_url.indexOf('i.ebayimg.com')>=0,'★★i.ebayimg.com の URL が返る');
ok(r.body.expiration==='2026-11-16T01:00:00.000Z','★★期限（expirationDate）も返す');
ok(!!r.body.max_dimension_url,'★いちばん大きい版のURLも返す');

console.log('\n=== スコープが足りないとき（403）===');
calls=[]; epsStatus=403;
r=await call('/eps/test','k',{url:PIC});
console.log('   '+JSON.stringify({ok:r.body.ok,status:r.body.create.status,
  error:r.body.error}));
console.log('   本文: '+r.body.create.body);
ok(r.body.ok===false&&r.body.create.status===403
   &&/スコープ不足の可能性/.test(r.body.error||''),
   '★★403 ならそう知らせる（本文もそのまま返すので、足りないスコープが分かる）');
ok(/Insufficient permissions/.test(r.body.create.body||''),'★eBay の本文をそのまま返す');
ok(!calls.some(c=>/\/image\/IMG/.test(c.url)),'★403 のときは先へ進まない');

console.log('\n=== R2 が取れないとき ===');
epsStatus=201;
r2=new Response('not found',{status:404});
calls=[];
r=await call('/eps/test','k',{url:PIC});
console.log('   '+JSON.stringify(r.body.probe));
ok(r.body.probe.status===404&&r.body.probe.width===0,
   '★R2 が 404 ならそのまま返す（eBay には預けに行くが結果で分かる）');
r2=null;
r=await call('/eps/test','k',{url:'https://example.com/a.jpg'});
ok(r.status===400&&r.body.error==='bad_url','★pj-img の形でないURLは 400');

console.log('\n=== 出品の中身は変えない ===');
ok(!calls.some(c=>/ReviseFixedPriceItem|ReviseInventoryStatus|AddItem/.test(
   JSON.stringify(c.headers)+c.body)),
   '★★この窓口は出品を変える呼び出しを1回もしない');

T.done();
