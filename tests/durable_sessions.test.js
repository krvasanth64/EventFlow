'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn}=require('node:child_process');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const port=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
test('multiple accounts keep independent sessions through Node restart',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ef-sessions-')),n=await port();
 const base='http://127.0.0.1:'+n;let proc=null;
 async function start(first){
  proc=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{
   ...process.env,HOST:'127.0.0.1',PORT:String(n),EVENTFLOW_DATA:folder,
   ...(first?{EVENTFLOW_ADMIN_PASSWORD:'testPassword123'}:{})
  }});
  for(let i=0;i<100;i++){
   try{if((await fetch(base+'/api/health')).ok)return}catch{}
   await wait(60);
  }throw Error('Server unavailable');
 }
 async function stop(){if(proc){const p=proc;proc=null;p.kill();await Promise.race([
  new Promise(resolve=>p.once('exit',resolve)),wait(1500)])}}
 t.after(async()=>{await stop();fs.rmSync(folder,{recursive:true,force:true})});
 async function req(url,method='GET',body,cookie){
  const res=await fetch(base+url,{method,headers:{...(cookie?{Cookie:cookie}:{}),
   ...(body?{'Content-Type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 await start(true);
 const admin=(await req('/api/login','POST',{username:'admin',password:'testPassword123'})).cookie;
 assert.equal((await req('/api/users','POST',{username:'audience',name:'Remote Viewer',role:'viewer',password:'viewerPassword123'},admin)).status,201);
 const viewer=(await req('/api/login','POST',{username:'audience',password:'viewerPassword123'})).cookie;
 assert.notEqual(admin,viewer);
 assert.equal((await req('/api/me','GET',undefined,viewer)).status,200);
 const records=JSON.parse(fs.readFileSync(path.join(folder,'sessions.json'),'utf8'));
 assert.equal(records.length,2);assert.ok(records.every(x=>x.key.length===64));
 await stop();await start(false);
 assert.equal((await req('/api/me','GET',undefined,admin)).status,200);
 assert.equal((await req('/api/me','GET',undefined,viewer)).status,200);
});
