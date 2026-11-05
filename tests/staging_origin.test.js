'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))})});
test('staging origin guard denies missing/foreign Origin on mutation without blocking health',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eventflow-origin-'));
 const port=await freePort();
 const publicOrigin='https://staging-eventflow.example.org';
 const server=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),stdio:'pipe',
  env:{...process.env,EVENTFLOW_DATA:dir,HOST:'127.0.0.1',PORT:String(port),
   EVENTFLOW_ADMIN_PASSWORD:'testPassword123',EVENTFLOW_PUBLIC_ORIGIN:publicOrigin}});
 t.after(()=>{server.kill();fs.rmSync(dir,{recursive:true,force:true})});
 const base='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<80;i++){
  try{if((await fetch(base+'/api/health')).status===200){ready=true;break}}catch{}
  await sleep(75);
 }
 assert.ok(ready);
 const credentials={username:'admin',password:'testPassword123'};
 const login=async origin=>{
  const headers={'Content-Type':'application/json'};
  if(origin)headers.Origin=origin;
  return fetch(base+'/api/login',{method:'POST',headers,body:JSON.stringify(credentials)});
 };
 assert.equal((await login(undefined)).status,403);
 assert.equal((await login('https://evil.example.org')).status,403);
 const allowed=await login(publicOrigin);
 assert.equal(allowed.status,200);
 const cookie=allowed.headers.get('set-cookie').split(';')[0];
 const createEvent=(origin)=>{
  const headers={Cookie:cookie,'Content-Type':'application/json'};
  if(origin)headers.Origin=origin;
  return fetch(base+'/api/events',{method:'POST',headers,
   body:JSON.stringify({title:'Origin Guard Sample',date:'2026-11-05',start:'18:00'})});
 };
 assert.equal((await createEvent('https://evil.example.org')).status,403);
 assert.equal((await createEvent(undefined)).status,403);
 const accepted=await createEvent(publicOrigin);
 assert.equal(accepted.status,201);
 const events=await fetch(base+'/api/events',{headers:{Cookie:cookie}});
 assert.equal(events.status,200,'safe authenticated reads remain available');
});
