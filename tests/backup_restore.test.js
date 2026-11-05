'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {inspectArchive,restoreArchive}=require('../scripts/verify-backup');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const port=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p))})});
test('complete ZIP backup restores only into a new runtime and supports valid login and media',async t=>{
 const baseDir=fs.mkdtempSync(path.join(os.tmpdir(),'eventflow-restore-test-'));
 const runtime=path.join(baseDir,'original'),recovery=path.join(baseDir,'recovered');
 const originalPort=await port(),recoveryPort=await port();
 let origin,recovered;
 t.after(()=>{origin?.kill();recovered?.kill();fs.rmSync(baseDir,{recursive:true,force:true})});
 const launch=async (directory,number)=>{
  const processHandle=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{
   ...process.env,EVENTFLOW_DATA:directory,HOST:'127.0.0.1',PORT:String(number),EVENTFLOW_ADMIN_PASSWORD:'testPassword123'
  },stdio:'pipe'});
  for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:'+number+'/api/health')).ok)return processHandle}catch{}await pause(60)}
  processHandle.kill();throw Error('server did not boot');
 };
 const request=async (number,route,method='GET',body,cookie)=>{
  const response=await fetch('http://127.0.0.1:'+number+route,{method,headers:{
   ...(cookie?{Cookie:cookie}:{}),...(body&&!(body instanceof Buffer)?{'Content-Type':'application/json'}:{})
  },body:body?(body instanceof Buffer?body:JSON.stringify(body)):undefined});
  const type=response.headers.get('content-type')||'';
  return {status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0],
   body:type.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer())};
 };
 origin=await launch(runtime,originalPort);
 const login=await request(originalPort,'/api/login','POST',{username:'admin',password:'testPassword123'});
 assert.equal(login.status,200);const auth=login.cookie;
 const event=await request(originalPort,'/api/events','POST',{title:'Recovery Rehearsal',date:'2026-11-05',start:'18:00'},auth);
 assert.equal(event.status,201);const id=event.body.event.id;
 const lease=await request(originalPort,'/api/events/'+id+'/lease','POST',{},auth);
 const program=await request(originalPort,'/api/events/'+id+'/programs','POST',{revision:lease.body.event.revision,
  title:'Media Test',type:'Group Dance',category:'Dance',duration:120,gap:5,sourceType:'none'},auth);
 assert.equal(program.status,201);const p=program.body.programs[0];
 const media=Buffer.from('original-media-bytes-for-rehearsal');
 const uploaded=await request(originalPort,'/api/events/'+id+'/media?program='+p.id+'&filename=test.mp3&revision='+program.body.event.revision,'POST',media,auth);
 assert.equal(uploaded.status,200);
 const backup=await request(originalPort,'/api/backup/full','GET',undefined,auth);
 assert.equal(backup.status,200);
 const zipFile=path.join(baseDir,'full-backup.zip');fs.writeFileSync(zipFile,backup.body);
 const inspected=inspectArchive(zipFile);
 assert.equal(inspected.summary.events,1);
 assert.equal(inspected.summary.programs,1);
 assert.equal(inspected.summary.media,1);
 const result=restoreArchive(zipFile,recovery);
 assert.equal(result.events,1);
 assert.ok(fs.existsSync(path.join(recovery,'data.json')));
 assert.throws(()=>restoreArchive(zipFile,recovery),/already exists/,'restore never overwrites');
 const corrupted=Buffer.from(backup.body);
 const mediaPosition=corrupted.indexOf(media);
 assert.ok(mediaPosition>0);
 corrupted[mediaPosition+2]^=0xff;
 const badFile=path.join(baseDir,'bad-backup.zip');fs.writeFileSync(badFile,corrupted);
 assert.throws(()=>inspectArchive(badFile),/CRC mismatch/);
 assert.equal(fs.existsSync(path.join(baseDir,'bad-backup-restored')),false);
 assert.throws(()=>restoreArchive(badFile,path.join(baseDir,'bad-backup-restored')),/CRC mismatch/);
 recovered=await launch(recovery,recoveryPort);
 const recoveredLogin=await request(recoveryPort,'/api/login','POST',{username:'admin',password:'testPassword123'});
 assert.equal(recoveredLogin.status,200);
 const c=await request(recoveryPort,'/api/events/'+id,'GET',undefined,recoveredLogin.cookie);
 assert.equal(c.status,200);
 assert.equal(c.body.programs[0].id,p.id,'stable program UUID restored');
 assert.equal(c.body.programs[0].programCode,'P0001','stable display code restored');
 assert.equal(c.body.programs[0].sourceType,'file');
 const restoredMedia=await request(recoveryPort,'/media/'+c.body.programs[0].source,'GET',undefined,recoveredLogin.cookie);
 assert.equal(restoredMedia.status,200);
 assert.deepEqual(restoredMedia.body,media);
});
