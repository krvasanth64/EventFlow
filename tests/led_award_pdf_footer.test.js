'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const net=require('node:net'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {buildPdf}=require('../report-pdf');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const port=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
test('PDF page numbers never generate standalone footer-only pages',async()=>{
 const programs=Array.from({length:33},(_,i)=>({
  id:'p'+i,programCode:'P'+String(i+1).padStart(4,'0'),order:i,
  title:(i===25?'Unit 2 | Performer & Team | Group Dance2':'Team '+(i+1)+' | Solo Dance Performance'),
  type:'Group Dance',duration:240,gap:30,presenter:'Stage Team '+(i+1),
  status:'pending',sourceType:'none',participants:[{name:'A',checkedIn:false}]
 }));
 const sample={event:{title:'Day Event 2026',date:'2026-11-06',venue:'Outdoor'},programs,awards:[]};
 const columns=[
  ['order',5],['programCode',8],['title',35],['type',12],['duration',8],
  ['presenter',18],['status',9],['sourceType',9],['participants',10],['ready',7]
 ].map(([key,width])=>({key,width}));
 const data=await buildPdf('programs',sample,{fontSize:8,orientation:'landscape',columns});
 assert.equal(data.subarray(0,5).toString(),'%PDF-');
 const pages=[...data.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
 assert.equal(pages,2,'33 dense program rows should occupy two pages without footer-only pages');
 const awards=Array.from({length:10},(_,i)=>({
  id:'a'+i,awardCode:'A'+String(i+1).padStart(4,'0'),
  awardName:'Best Performer',winnerName:'Winner '+i,category:'Excellence',status:'pending'
 }));
 const short=await buildPdf('awards',{...sample,awards},{fontSize:8,orientation:'landscape'});
 assert.equal([...short.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,1,
  '10 award rows should occupy exactly one page without extra footer');
});
test('award recipient check-in governs LED readiness and persists with role enforcement',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eventflow-award-ready-')),n=await port();
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{
  ...process.env,HOST:'127.0.0.1',PORT:String(n),EVENTFLOW_DATA:dir,EVENTFLOW_ADMIN_PASSWORD:'localTestPassword123'
 },stdio:'pipe'});
 t.after(()=>{child.kill();fs.rmSync(dir,{recursive:true,force:true})});
 const base='http://127.0.0.1:'+n;let up=false;
 for(let i=0;i<90;i++){try{if((await fetch(base+'/api/health')).ok){up=true;break}}catch{}await delay(75)}
 assert.ok(up,'test server starts');
 async function req(route,method='GET',body,cookie){
  const res=await fetch(base+route,{method,headers:{
   ...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})
  },body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 const login=await req('/api/login','POST',{username:'admin',password:'localTestPassword123'});
 const admin=login.cookie;
 const created=await req('/api/events','POST',{title:'Award Stage Rehearsal',date:'2026-11-06',start:'18:00'},admin);
 assert.equal(created.status,201);
 const id=created.data.event.id;
 const lease=await req('/api/events/'+id+'/lease','POST',{},admin);
 const first=await req('/api/events/'+id+'/awards','POST',{
  revision:lease.data.event.revision,category:'Recognition',awardName:'Best Team',winnerName:'Demo Winner',
  presenter:'Chief Guest'
 },admin);
 assert.equal(first.status,201);
 let c=first.data,a=c.awards[0];assert.equal(a.awardCode,'A0001');
 assert.equal(a.participants.length,1);
 const original=a.participants[0].id;
 const two=await req('/api/events/'+id+'/awards/'+a.id+'/participants','PUT',{
  revision:c.event.revision,participants:[
   {...a.participants[0],employeeCode:'E001',name:'Demo Winner'},
   {employeeCode:'E002',name:'Second Winner',contact:'9000012345'}
  ]
 },admin);
 assert.equal(two.status,200);c=two.data;a=c.awards[0];
 assert.equal(a.participants[0].id,original);
 const register=await req('/api/users','POST',{username:'stage',name:'Stage Controller',
  role:'live_controller',password:'localStagePassword123'},admin);
 assert.equal(register.status,201);
 const operator=(await req('/api/login','POST',{username:'stage',password:'localStagePassword123'})).cookie;
 const cannotEdit=await req('/api/events/'+id+'/awards/'+a.id+'/participants','PUT',{
  revision:c.event.revision,participants:[{name:'Tamper'}]
 },operator);
 assert.equal(cannotEdit.status,403);
 const checked=await req('/api/events/'+id+'/awards/'+a.id+'/participants/'+original+'/check','POST',{
  revision:c.event.revision,checkedIn:true
 },operator);
 assert.equal(checked.status,200);c=checked.data;a=c.awards[0];
 assert.equal(a.participants.filter(x=>x.checkedIn).length,1);
 const script=fs.readFileSync(path.join(__dirname,'../public/v20.js'),'utf8');
 assert.ok(script.includes('ef20ReadyAwards'),'LED must filter by recipient readiness');
 const second=await req('/api/events/'+id+'/awards/'+a.id+'/participants/'+a.participants[1].id+'/check','POST',{
  revision:c.event.revision,checkedIn:true
 },operator);
 assert.equal(second.status,200);c=second.data;a=c.awards[0];
 assert.equal(a.participants.filter(x=>x.checkedIn).length,2);
 assert.equal(a.status,'pending','checking recipients must not mark award presented');
 const marked=await req('/api/events/'+id+'/awards/'+a.id,'PATCH',{revision:c.event.revision,status:'presented'},operator);
 assert.equal(marked.status,200);c=marked.data;
 assert.equal(c.awards[0].status,'presented');
 const denied=await req('/api/events/'+id+'/awards/'+a.id+'/participants/'+original+'/check','POST',{
  revision:c.event.revision,checkedIn:false
 },operator);
 assert.equal(denied.status,409,'presented awards cannot be unchecked');
});
