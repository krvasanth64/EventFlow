'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const {createSectionTemplate}=require('../workbook');
const {normalizeConfig}=require('../report-pdf');
const freePort=()=>new Promise(resolve=>{const srv=net.createServer();srv.listen(0,'127.0.0.1',()=>{const p=srv.address().port;srv.close(()=>resolve(p))})});
const wait=ms=>new Promise(done=>setTimeout(done,ms));
test('section Excel append preserves permanent IDs, blocks duplicate and PDF supports selected columns',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ef-sections-')),port=await freePort();
 const server=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),
  EVENTFLOW_DATA:root,EVENTFLOW_ADMIN_PASSWORD:'testPassword123'},stdio:'pipe'});
 t.after(()=>{server.kill();fs.rmSync(root,{recursive:true,force:true})});
 const base='http://127.0.0.1:'+port;
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await wait(75)}
 assert.ok(ready);
 async function req(route,method='GET',data,cookie){
  const isBinary=Buffer.isBuffer(data);
  const res=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),
   ...(data?{'Content-Type':isBinary?'application/octet-stream':'application/json'}:{})},body:data?(isBinary?data:JSON.stringify(data)):undefined});
  const ct=res.headers.get('content-type')||'';
  return {status:res.status,body:ct.includes('application/json')?await res.json():Buffer.from(await res.arrayBuffer()),
   cookie:res.headers.get('set-cookie')?.split(';')[0]};
 }
 const login=await req('/api/login','POST',{username:'admin',password:'testPassword123'});assert.equal(login.status,200);
 const cookie=login.cookie;
 const created=await req('/api/events','POST',{title:'Section Import Rehearsal',date:'2026-11-05',start:'18:00'},cookie);assert.equal(created.status,201);
 const id=created.body.event.id;
 const lease=await req('/api/events/'+id+'/lease','POST',{},cookie);assert.equal(lease.status,200);
 let revision=lease.body.event.revision;
 const programBook=await createSectionTemplate('programs');
 const preview=await req('/api/events/'+id+'/import/programs/preview?revision='+revision,'POST',programBook,cookie);
 assert.equal(preview.status,200);assert.equal(preview.body.valid,true,JSON.stringify(preview.body.errors));
 assert.equal(preview.body.counts.programs,8);
 const imported=await req('/api/events/'+id+'/import/programs/apply?revision='+revision,'POST',programBook,cookie);
 assert.equal(imported.status,201,JSON.stringify(imported.body));
 revision=imported.body.event.revision;
 assert.equal(imported.body.programs.length,8);
 assert.equal(imported.body.programs[0].programCode,'P0001');
 assert.equal(imported.body.programs[7].programCode,'P0008');
 assert.ok(imported.body.programs[0].participants.length>=2);
 assert.equal((await req('/api/events/'+id+'/import/programs/apply?revision='+revision,'POST',programBook,cookie)).status,422,'duplicates denied');
 const awardsBook=await createSectionTemplate('awards');
 const awardPreview=await req('/api/events/'+id+'/import/awards/preview?revision='+revision,'POST',awardsBook,cookie);
 assert.equal(awardPreview.status,200);assert.equal(awardPreview.body.valid,true,JSON.stringify(awardPreview.body.errors));
 assert.equal(awardPreview.body.counts.awards,4);
 const awards=await req('/api/events/'+id+'/import/awards/apply?revision='+revision,'POST',awardsBook,cookie);
 assert.equal(awards.status,201,JSON.stringify(awards.body));
 assert.equal(awards.body.awards.length,4);
 assert.equal(awards.body.awards[0].awardCode,'A0001');
 assert.equal(awards.body.programs[0].programCode,'P0001');
 const cols=[{key:'programCode',width:12},{key:'title',width:50},{key:'source',width:30}];
 const pdf=await req('/api/events/'+id+'/reports/programs.pdf','POST',{columns:cols,orientation:'landscape'},cookie);
 assert.equal(pdf.status,200);
 assert.equal(pdf.body.subarray(0,5).toString(),'%PDF-');
 assert.ok(pdf.body.length>500);
 const awardPDF=await req('/api/events/'+id+'/reports/awards.pdf','POST',{
  columns:[{key:'awardCode',width:9},{key:'awardName',width:40},{key:'winnerName',width:27}]},cookie);
 assert.equal(awardPDF.status,200);assert.equal(awardPDF.body.subarray(0,5).toString(),'%PDF-');
 const invalid=await req('/api/events/'+id+'/reports/programs.pdf','POST',{columns:[{key:'unknown'}]},cookie);
 assert.equal(invalid.status,400);
 assert.throws(()=>normalizeConfig('programs',{columns:[{key:'programCode'},{key:'programCode'}]}),/duplicate/);
 const viewerCreate=await req('/api/users','POST',{username:'readonly',name:'Read Only',password:'testPassword456',role:'viewer'},cookie);
 assert.equal(viewerCreate.status,201);
 const viewerLogin=await req('/api/login','POST',{username:'readonly',password:'testPassword456'});
 assert.equal((await req('/api/events/'+id+'/import/programs/preview','POST',programBook,viewerLogin.cookie)).status,403);
 const viewerPdf=await req('/api/events/'+id+'/reports/programs.pdf','POST',{columns:[{key:'programCode'},{key:'title'}]},viewerLogin.cookie);
 assert.equal(viewerPdf.status,200,'Viewer can download readable reports');
});
