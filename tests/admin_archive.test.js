'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const port=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
test('archived events hidden from viewers and permanent deletion restricted to admin',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ef-archive-')),n=await port();
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{
  ...process.env,HOST:'127.0.0.1',PORT:String(n),EVENTFLOW_DATA:dir,EVENTFLOW_ADMIN_PASSWORD:'testPassword123'
 }});
 t.after(()=>{child.kill();fs.rmSync(dir,{recursive:true,force:true})});
 const base='http://127.0.0.1:'+n;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await delay(60)}
 async function req(route,method='GET',data,cookie){
  const res=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),
   ...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  return {status:res.status,json:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 const admin=(await req('/api/login','POST',{username:'admin',password:'testPassword123'})).cookie;
 await req('/api/users','POST',{username:'viewer',name:'Viewer',role:'viewer',password:'viewerPassword123'},admin);
 const viewer=(await req('/api/login','POST',{username:'viewer',password:'viewerPassword123'})).cookie;
 const created=await req('/api/events','POST',{title:'Event Archive QA',date:'2026-11-12',start:'10:00'},admin);
 assert.equal(created.status,201);const event=created.json.event,id=event.id;
 const url='/api/events/'+id+'/admin/archive';
 assert.equal((await req(url,'POST',{revision:event.revision,archived:true},viewer)).status,403);
 assert.equal((await req(url,'POST',{revision:event.revision,archived:true},admin)).status,200);
 assert.ok(!(await req('/api/events','GET',undefined,viewer)).json.events.some(e=>e.id===id));
 assert.equal((await req('/api/events/'+id,'GET',undefined,viewer)).status,404);
 const summary=(await req('/api/admin/events','GET',undefined,admin)).json.events.find(e=>e.id===id);
 assert.equal(summary.isArchived,true);assert.equal(summary.revision,2);
 assert.equal((await req('/api/admin/events','GET',undefined,viewer)).status,403);
 assert.equal((await req('/api/events/'+id,'DELETE',{revision:2},admin)).status,405);
 assert.equal((await req('/api/events/'+id+'/admin/purge','POST',{revision:2,confirmTitle:'Incorrect'},admin)).status,400);
 assert.equal((await req(url,'POST',{revision:2,archived:false},admin)).status,200);
 assert.ok((await req('/api/events','GET',undefined,viewer)).json.events.some(e=>e.id===id));
 assert.equal((await req(url,'POST',{revision:3,archived:true},admin)).status,200);
 assert.equal((await req('/api/events/'+id+'/admin/purge','POST',{revision:4,confirmTitle:'Event Archive QA'},admin)).status,200);
 assert.ok(!(await req('/api/admin/events','GET',undefined,admin)).json.events.some(e=>e.id===id));
 assert.ok(fs.readdirSync(path.join(dir,'backups')).some(x=>x.startsWith('DELETED_')));
});
