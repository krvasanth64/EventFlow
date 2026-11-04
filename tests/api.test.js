'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const delay = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((resolve,reject) => {
  const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});
});
test('authentication, independent event leases, revision conflicts, program ordering, persisted media', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eventflow-test-'));
  const port=await freePort();
  const server=spawn(process.execPath,['server.js'],{
    cwd:path.join(__dirname,'..'),
    env:{...process.env,EVENTFLOW_DATA:dir,EVENTFLOW_ADMIN_PASSWORD:'testPassword123',HOST:'127.0.0.1',PORT:String(port)},
    stdio:'pipe'
  });
  t.after(()=>{server.kill();fs.rmSync(dir,{force:true,recursive:true});});
  const base='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<80;i++){
    try{const r=await fetch(base+'/api/health');if(r.ok){ready=true;break;}}catch{}
    await delay(75);
  }
  assert.equal(ready,true,'test server started');
  const request=async (url,method='GET',body,cookie='')=>{
    const headers={};
    if(cookie)headers.Cookie=cookie;
    if(body!==undefined)headers['Content-Type']='application/json';
    const r=await fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const data=await r.json();
    return {code:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  const first=await request('/api/login','POST',{username:'admin',password:'testPassword123'});
  assert.equal(first.code,200);
  const a=first.cookie;
  assert.ok(a.startsWith('ef_session='));
  const addUser=await request('/api/users','POST',{username:'editor2',name:'Editor Two',role:'editor',password:'editorPassword123'},a);
  assert.equal(addUser.code,201);
  const second=await request('/api/login','POST',{username:'editor2',password:'editorPassword123'});
  assert.equal(second.code,200);
  const b=second.cookie;
  const eventA=(await request('/api/events','POST',{title:'Celebration A',date:'2026-11-12',start:'09:00'},a)).data.event;
  const eventB=(await request('/api/events','POST',{title:'Celebration B',date:'2026-11-12',start:'10:00'},a)).data.event;
  assert.ok(eventA.id&&eventB.id);
  assert.equal((await request('/api/events/'+eventA.id+'/lease','POST',{},a)).code,200);
  assert.equal((await request('/api/events/'+eventA.id+'/lease','POST',{},b)).code,423,'second user cannot edit same event');
  assert.equal((await request('/api/events/'+eventB.id+'/lease','POST',{},b)).code,200,'can edit different event');
  const saved=await request('/api/events/'+eventA.id+'/programs','POST',{
    revision:eventA.revision,title:'Opening Speech',type:'speech',duration:600,gap:120,sourceType:'none'
  },a);
  assert.equal(saved.code,201);
  const prog=saved.data.programs[0];
  assert.equal(prog.title,'Opening Speech');
  assert.equal((await request('/api/events/'+eventA.id+'/programs/'+prog.id,'PATCH',{revision:eventA.revision,title:'Stale'},a)).code,409,'stale edit is rejected');
  assert.equal((await request('/api/events/'+eventA.id+'/programs','POST',{
    revision:saved.data.event.revision,title:'Opening Speech',type:'speech',duration:100,gap:0,sourceType:'none'
  },a)).code,409,'duplicate title blocked');
  const later=await request('/api/events/'+eventA.id+'/programs','POST',{
    revision:saved.data.event.revision,title:'Video',type:'video',duration:200,gap:0,sourceType:'none'
  },a);
  assert.equal(later.code,201);
  const ids=later.data.programs.map(p=>p.id).reverse();
  const sorted=await request('/api/events/'+eventA.id+'/reorder','POST',{revision:later.data.event.revision,ids},a);
  assert.equal(sorted.code,200);
  assert.deepEqual(sorted.data.programs.map(p=>p.id),ids);
  const savedDisk=JSON.parse(fs.readFileSync(path.join(dir,'data.json'),'utf8'));
  assert.equal(savedDisk.events.length,2);
  assert.equal(savedDisk.programs.length,2);
  assert.ok(savedDisk.users.every(u=>u.password.includes(':')&&!u.password.includes('testPassword123')));
});
