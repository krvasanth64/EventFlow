'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});}
test('V1.3 catalogs, archived media versions and accessible source archive',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ef13-')),port=await freePort();
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),EVENTFLOW_DATA:folder,EVENTFLOW_ADMIN_PASSWORD:'testPassword123'},stdio:'pipe'});
 t.after(()=>{child.kill();fs.rmSync(folder,{recursive:true,force:true})});
 const host='http://127.0.0.1:'+port;let ready=false;
 for(let k=0;k<80;k++){try{if((await fetch(host+'/api/health')).ok){ready=true;break}}catch{}await pause(60)}
 assert.ok(ready);
 async function api(url,method='GET',data,cookie){
  const headers={};if(cookie)headers.Cookie=cookie;
  if(data!==undefined)headers['Content-Type']='application/json';
  const r=await fetch(host+url,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 const auth=await api('/api/login','POST',{username:'admin',password:'testPassword123'}),cookie=auth.cookie;
 const created=await api('/api/events','POST',{title:'Media catalog test',date:'2026-11-14',start:'10:00'},cookie),id=created.data.event.id;
 let c=await api('/api/events/'+id+'/lease','POST',{},cookie);
 const catalogs={programTypes:[{name:'Solo Dance',enabled:true},{name:'Drama',enabled:false}],
 programCategories:[{name:'Stage',enabled:true}],awardCategories:[{name:'Prizes',enabled:true}],
 awardTitles:[{name:'Best Artist',enabled:true}],presenters:[{name:'Chief Guest',enabled:true}],
 mediaTypes:[{name:'file',enabled:true},{name:'none',enabled:true}]};
 c=await api('/api/events/'+id,'PATCH',{revision:c.data.event.revision,catalogs},cookie);
 assert.equal(c.status,200);assert.equal(c.data.event.catalogs.programTypes[1].enabled,false);
 c=await api('/api/events/'+id+'/programs','POST',{revision:c.data.event.revision,title:'My Dance',type:'Solo Dance',duration:180,gap:30,sourceType:'none'},cookie);
 assert.equal(c.status,201);
 const pid=c.data.programs[0].id;
 const upload=async(file,revision)=>{
  const endpoint='/api/events/'+id+'/media?program='+pid+'&filename='+file+'&revision='+revision;
  const r=await fetch(host+endpoint,{method:'POST',headers:{Cookie:cookie},body:Buffer.from('sample media '+file)});
  return {status:r.status,data:await r.json()};
 };
 const u1=await upload('music.mp3',c.data.event.revision);
 assert.equal(u1.status,200);const first=u1.data.program.source;
 const u2=await upload('music.mp3',u1.data.revision);
 assert.equal(u2.status,200);
 assert.notEqual(u2.data.program.source,first,'replacement uses distinct path');
 assert.equal(u2.data.program.sourceArchive.length,1);
 assert.equal(u2.data.program.sourceArchive[0].path,first);
 assert.equal((await fetch(host+'/media/'+first,{headers:{Cookie:cookie}})).status,200);
 c=await api('/api/events/'+id+'/programs/'+pid+'/archive','POST',{kind:'media',revision:u2.data.revision},cookie);
 assert.equal(c.status,200);assert.equal(c.data.programs[0].sourceType,'none');
 assert.equal(c.data.programs[0].sourceArchive.length,2);
 assert.equal((await fetch(host+'/media/'+first,{headers:{Cookie:cookie}})).status,200);
 assert.equal((await fetch(host+'/v13.js')).status,200);
 assert.equal((await api('/api/health')).data.version,require('../package.json').version);
});
