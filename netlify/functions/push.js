const https=require('https'),url=require('url'),crypto=require('crypto');
function b2u(b){return Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')}
function u2b(s){const b=s.replace(/-/g,'+').replace(/_/g,'/');return Buffer.from(b+'='.repeat((4-b.length%4)%4),'base64')}
exports.handler=async(event)=>{
if(event.httpMethod!=='POST')return{statusCode:405,body:'Method Not Allowed'};
const PUB=process.env.VAPID_PUBLIC_KEY,PRV=process.env.VAPID_PRIVATE_KEY,EMAIL=process.env.VAPID_EMAIL||'office@oxyhelp.com';
if(!PUB||!PRV)return{statusCode:500,body:'VAPID keys missing'};
let bd;try{bd=JSON.parse(event.body)}catch{return{statusCode:400,body:'Bad JSON'}};
const{subscription:sub,title,body:msg,data}=bd;
if(!sub)return{statusCode:400,body:'No subscription'};
try{
const sd=JSON.parse(sub),ep=sd.endpoint,pu=new url.URL(ep),aud=pu.protocol+'//'+pu.host;
const now=Math.floor(Date.now()/1000);
const hdr=b2u(Buffer.from(JSON.stringify({typ:'JWT',alg:'ES256'})));
const cls=b2u(Buffer.from(JSON.stringify({aud,exp:now+43200,sub:'mailto:'+EMAIL})));
const si=hdr+'.'+cls;
const pk=crypto.createPrivateKey({key:Buffer.concat([Buffer.from('308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420','hex'),u2b(PRV)]),format:'der',type:'pkcs8'});
const sg=crypto.createSign('SHA256');sg.update(si);const der=sg.sign(pk);
const rl=der[3],r=der.slice(4,4+rl).slice(-32),sl2=der[4+rl+1],s=der.slice(4+rl+2,4+rl+2+sl2).slice(-32);
const jwt=si+'.'+b2u(Buffer.concat([Buffer.alloc(32-r.length),r,Buffer.alloc(32-s.length),s]));
const p256=u2b(sd.keys.p256dh),auth=u2b(sd.keys.auth);
const lk=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
const lpr=lk.publicKey.export({type:'spki',format:'der'}).slice(-65);
const rk=crypto.createPublicKey({key:Buffer.concat([Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200','hex'),p256]),format:'der',type:'spki'});
const sec=crypto.diffieHellman({privateKey:lk.privateKey,publicKey:rk});
const prk=Buffer.from(crypto.hkdfSync('sha256',sec,auth,Buffer.concat([Buffer.from('WebPush: info\0'),p256,lpr]),32));
const salt=crypto.randomBytes(16);
const cek=Buffer.from(crypto.hkdfSync('sha256',prk,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16));
const iv=Buffer.from(crypto.hkdfSync('sha256',prk,salt,Buffer.from('Content-Encoding: nonce\0'),12));
const pl=Buffer.concat([Buffer.from(JSON.stringify({title,body:msg,data})),Buffer.from([2])]);
const ci=crypto.createCipheriv('aes-128-gcm',cek,iv);
const enc=Buffer.concat([ci.update(pl),ci.final(),ci.getAuthTag()]);
const rs=Buffer.alloc(4);rs.writeUInt32BE(4096,0);
const body=Buffer.concat([salt,rs,Buffer.from([lpr.length]),lpr,enc]);
await new Promise((res,rej)=>{
const rq=https.request({hostname:pu.hostname,path:pu.pathname+pu.search,method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm','Content-Length':body.length,'TTL':'86400','Authorization':'vapid t='+jwt+',k='+PUB}},(r2)=>{
let d='';r2.on('data',c=>d+=c);r2.on('end',()=>r2.statusCode<300?res():rej(new Error(r2.statusCode+' '+d)));
});rq.on('error',rej);rq.write(body);rq.end();
});
return{statusCode:200,body:JSON.stringify({ok:true})};
}catch(e){console.error(e.message);return{statusCode:500,body:e.message}}
};