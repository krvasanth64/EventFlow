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
 const urlValue='https://example.org/watch?v=123&playlist=yes';
 const online=await request('/api/events/'+eid+'/programs','POST',
  {title:'Online Song',type:'Solo Singing',duration:180,gap:5,revision:uploadResult.revision,sourceType:'url',source:urlValue},admin);
 assert.equal(online.response.status,201);
 const onlineBody=await online.response.json();
 const hostRef=await request('/api/events/'+eid+'/programs','POST',
  {title:'Host Reference',type:'Speech',duration:120,gap:0,revision:onlineBody.event.revision,sourceType:'linked',source:'D:/DJ/host-track.mp3'},admin);
 assert.equal(hostRef.response.status,201);
 const urlsCSV=await request('/api/events/'+eid+'/dj-links.csv','GET',undefined,admin);
 assert.equal(urlsCSV.response.status,200);
 assert.match(urlsCSV.response.headers.get('content-disposition'),/\.csv/);
 const textCSV=await urlsCSV.response.text();
 assert.ok(textCSV.includes(urlValue),'URL csv preserves exact online link');
 assert.ok(textCSV.includes('D:/DJ/host-track.mp3'),'URL csv preserves linked host path');
 const urlsHTML=await request('/api/events/'+eid+'/dj-links.html','GET',undefined,admin);
 assert.equal(urlsHTML.response.status,200);
 const textHTML=await urlsHTML.response.text();
 assert.ok(textHTML.includes('https://example.org/watch?v=123&amp;playlist=yes'),'HTML source URL is escaped and clickable');
 assert.ok(textHTML.includes('Host reference: D:/DJ/host-track.mp3'),'host paths stay text-only');
 assert.ok(textHTML.includes('rel="noopener noreferrer"'),'external links use safe new tab');
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
 assert.equal(manifest.programs.length,3);
 assert.equal(manifest.programs[0].title,'Dance Show');
 const name=manifest.programs[0].media[0].filename;
 assert.match(name,/Dance_Show/);
 assert.deepEqual(djEntries.get(name),media);
 assert.ok(djEntries.get('DJ_RUNNING_ORDER.csv').toString().includes('Dance Show'));
 const djLinks=djEntries.get('DJ_EXTERNAL_URLS.csv').toString();
 assert.ok(djLinks.includes(urlValue),'external URL exported in DJ ZIP');
 assert.ok(djLinks.includes('D:/DJ/host-track.mp3'),'linked host reference exported in DJ ZIP');
 const djHTML=djEntries.get('DJ_LINK_SHEET.html').toString();
 assert.ok(djHTML.includes('https://example.org/watch?v=123&amp;playlist=yes'),'ZIP HTML escapes external URL');
 assert.ok(djHTML.includes('DJ_Media/'),'ZIP HTML links locally bundled media');
 assert.ok(!djHTML.includes('href="D:/DJ/host-track.mp3"'),'host linked paths never guessed playable');

 assert.equal((await fetch(base+'/api/backup/full')).status,401);
 assert.equal((await fetch(base+'/api/events/'+eid+'/dj-package')).status,401);
 assert.equal((await fetch(base+'/api/events/'+eid+'/dj-links.csv')).status,401);
 assert.equal((await fetch(base+'/api/events/'+eid+'/dj-links.html')).status,401);
 const viewer=await request('/api/users','POST',{username:'reportviewer',name:'Viewer',password:'testPassword456',role:'viewer'},admin);
 assert.equal(viewer.response.status,201);
 const viewerLogin=await request('/api/login','POST',{username:'reportviewer',password:'testPassword456'});
 const viewerCookie=viewerLogin.cookie;
 assert.equal((await fetch(base+'/api/backup/full',{headers:{Cookie:viewerCookie}})).status,403);
 assert.equal((await fetch(base+'/api/events/'+eid+'/dj-package',{headers:{Cookie:viewerCookie}})).status,403);
 assert.equal((await fetch(base+'/api/events/'+eid+'/dj-links.csv',{headers:{Cookie:viewerCookie}})).status,403);
 assert.equal((await fetch(base+'/api/events/'+eid+'/dj-links.html',{headers:{Cookie:viewerCookie}})).status,403);
});
