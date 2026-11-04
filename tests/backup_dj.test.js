'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn}=require('node:child_process');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const srv=net.createServer();srv.listen(0,'127.0.0.1',()=>{const p=srv.address().port;srv.close(()=>resolve(p))})});
function entries(zip){
 const out=new Map();let at=0;
 while(at+30<=zip.length&&zip.readUInt32LE(at)===0x04034b50){
  const size=zip.readUInt32LE(at+18),len=zip.readUInt16LE(at+26),extra=zip.readUInt16LE(at+28);
  const name=zip.subarray(at+30,at+30+len).toString();
  const begin=at+30+len+extra;
  out.set(name,zip.subarray(begin,begin+size));
  at=begin+size;
 }
 assert.equal(zip.readUInt32LE(at),0x02014b50,'central ZIP directory must exist');
 assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50,'ZIP end record must exist');
 return out;
}
test('admin backup and DJ packages contain names and media bytes with role guards',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eventflow-export-')),port=await freePort();
 const server=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),
  env:{...process.env,EVENTFLOW_DATA:dir,HOST:'127.0.0.1',PORT:String(port),EVENTFLOW_ADMIN_PASSWORD:'testPassword123'},stdio:'pipe'});
 t.after(()=>{server.kill();fs.rmSync(dir,{recursive:true,force:true})});
 const base='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await delay(75)}
 assert.ok(ready,'test server started');
 async function request(url,method='GET',body,cookie){
  const result=await fetch(base+url,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined});
  return {response:result,cookie:result.headers.get('set-cookie')?.split(';')[0]};
 }
 const auth=await request('/api/login','POST',{username:'admin',password:'testPassword123'});
 assert.equal(auth.response.status,200);const admin=auth.cookie;
 const created=await request('/api/events','POST',{title:'DJ Package Night',date:'2026-11-14',start:'18:00'},admin);
 const eid=(await created.response.json()).event.id;
 const lease=await request('/api/events/'+eid+'/lease','POST',{},admin);
 const rev=(await lease.response.json()).event.revision;
 const prog=await request('/api/events/'+eid+'/programs','POST',{title:'Dance Show',type:'Solo Dance',duration:120,gap:10,revision:rev,sourceType:'none'},admin);
 const added=(await prog.response.json()),pid=added.programs[0].id;
 const media=Buffer.from('DJ test media actual bytes');
 const uploaded=await fetch(base+'/api/events/'+eid+'/media?program='+pid+'&filename=song.mp3&revision='+added.event.revision,
  {method:'POST',headers:{Cookie:admin},body:media});
 assert.equal(uploaded.status,200);
 const uploadResult=await uploaded.json();
 const full=await request('/api/backup/full','GET',undefined,admin);
 assert.equal(full.response.status,200);
 assert.match(full.response.headers.get('content-disposition'),/attachment/);
 const fullEntries=entries(Buffer.from(await full.response.arrayBuffer()));
 assert.ok(fullEntries.has('data.json'));
 assert.ok(fullEntries.has('media/'+uploadResult.program.source));
 assert.deepEqual(fullEntries.get('media/'+uploadResult.program.source),media);
 const db=JSON.parse(fullEntries.get('data.json').toString());
 assert.ok(db.users[0].password.includes(':'));
 const dj=await request('/api/events/'+eid+'/dj-package','GET',undefined,admin);
 assert.equal(dj.response.status,200);
 const djEntries=entries(Buffer.from(await dj.response.arrayBuffer()));
 const manifest=JSON.parse(djEntries.get('DJ_MANIFEST.json').toString());
 assert.equal(manifest.programs.length,1);
 assert.equal(manifest.programs[0].title,'Dance Show');
 const name=manifest.programs[0].media[0].filename;
 assert.match(name,/Dance_Show/);
 assert.deepEqual(djEntries.get(name),media);
 assert.ok(djEntries.get('DJ_RUNNING_ORDER.csv').toString().includes('Dance Show'));
 assert.equal((await fetch(base+'/api/backup/full')).status,401);
 assert.equal((await fetch(base+'/api/events/'+eid+'/dj-package')).status,401);
 const viewer=await request('/api/users','POST',{username:'reportviewer',name:'Viewer',password:'testPassword456',role:'viewer'},admin);
 assert.equal(viewer.response.status,201);
 const viewerLogin=await request('/api/login','POST',{username:'reportviewer',password:'testPassword456'});
 const viewerCookie=viewerLogin.cookie;
 assert.equal((await fetch(base+'/api/backup/full',{headers:{Cookie:viewerCookie}})).status,403);
 assert.equal((await fetch(base+'/api/events/'+eid+'/dj-package',{headers:{Cookie:viewerCookie}})).status,403);
});
