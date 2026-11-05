'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const ExcelJS=require('exceljs');
const {createTemplate,parseWorkbook}=require('../workbook');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{
 const server=net.createServer();
 server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))});
});
async function newServer(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ef-excel-')),port=await freePort();
 const server=spawn(process.execPath,['server.js'],{
  cwd:path.join(__dirname,'..'),
  env:{...process.env,PORT:String(port),HOST:'127.0.0.1',EVENTFLOW_DATA:dir,
   EVENTFLOW_ADMIN_PASSWORD:'testPassword123'},stdio:'pipe'});
 t.after(()=>{server.kill();fs.rmSync(dir,{recursive:true,force:true})});
 const url='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<80;i++){
  try{if((await fetch(url+'/api/health')).ok){ready=true;break}}catch{}
  await pause(70);
 }
 assert.ok(ready,'server should start');
 return {url,dir};
}
async function req(base,route,cookie,method='GET',data){
 const res=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),
  ...(data instanceof Buffer?{'Content-Type':'application/octet-stream'}:data?{'Content-Type':'application/json'}:{})},
  body:data===undefined?undefined:data instanceof Buffer?data:JSON.stringify(data)});
 const contentType=res.headers.get('content-type')||'';
 return {status:res.status,body:contentType.includes('json')?await res.json():Buffer.from(await res.arrayBuffer()),
  cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
test('Excel template and strict preview validates programs, participants, awards, URLs and formulas',async()=>{
 const bytes=await createTemplate(true);
 assert.ok(bytes.length>5000);
 const parsed=await parseWorkbook(bytes);
 assert.equal(parsed.valid,true,parsed.errors.join('; '));
 assert.equal(parsed.counts.programs,8);
 assert.equal(parsed.counts.awards,4);
 assert.ok(parsed.counts.participants>10);
 assert.equal(parsed.programs[2].sourceType,'url');
 assert.equal(parsed.programs[2].source,'https://example.com/replace-with-your-media');
 assert.equal(parsed.programs[1].sourceType,'none','file media must be uploaded after import');
 const bad=new ExcelJS.Workbook();await bad.xlsx.load(bytes);
 bad.getWorksheet('Programs').getCell('B2').value={formula:'1+1',result:2};
 const result=await parseWorkbook(Buffer.from(await bad.xlsx.writeBuffer()));
 assert.equal(result.valid,false);
 assert.ok(result.errors.some(x=>x.includes('formulas')));
 const duplicate=new ExcelJS.Workbook();await duplicate.xlsx.load(bytes);
 duplicate.getWorksheet('Programs').getCell('A3').value='REF-01';
 const dup=await parseWorkbook(Buffer.from(await duplicate.xlsx.writeBuffer()));
 assert.equal(dup.valid,false);
 assert.ok(dup.errors.some(x=>x.includes('Program Ref')));
});
test('new-event XLSX import, admin demo creation, visibility and permissions',async t=>{
 const {url,dir}=await newServer(t);
 let result=await req(url,'/api/login',null,'POST',{username:'admin',password:'testPassword123'});
 assert.equal(result.status,200);const admin=result.cookie;
 const template=await req(url,'/api/import/template?sample=full',admin);
 assert.equal(template.status,200);
 assert.ok(template.body.length>5000);
 const preview=await req(url,'/api/import/preview',admin,'POST',template.body);
 assert.equal(preview.status,200);
 assert.equal(preview.body.valid,true,JSON.stringify(preview.body.errors));
 assert.equal(preview.body.counts.programs,8);
 const imported=await req(url,'/api/import/apply',admin,'POST',template.body);
 assert.equal(imported.status,201,JSON.stringify(imported.body));
 const eid=imported.body.event.id;
 const data=await req(url,'/api/events/'+eid,admin);
 assert.equal(data.body.programs.length,8);
 assert.equal(data.body.awards.length,4);
 assert.equal(data.body.programs[0].programCode,'P0001');
 assert.ok(data.body.programs[0].participants.length>=2);
 assert.equal(data.body.programs[2].sourceType,'url');
 const again=await req(url,'/api/import/apply',admin,'POST',template.body);
 assert.equal(again.status,409,'duplicate event title must not overwrite anything');
 const viewer=await req(url,'/api/users',admin,'POST',{
  username:'viewerx',name:'Viewer X',password:'testPassword456',role:'viewer'
 });
 assert.equal(viewer.status,201);
 result=await req(url,'/api/login',null,'POST',{username:'viewerx',password:'testPassword456'});
 const vc=result.cookie;
 assert.equal((await req(url,'/api/import/template',vc)).status,403);
 assert.equal((await req(url,'/api/import/preview',vc,'POST',template.body)).status,403);
 assert.equal((await req(url,'/api/import/apply',vc,'POST',template.body)).status,403);
 assert.equal((await req(url,'/api/demo/create',vc,'POST',{})).status,403);
 const off=await req(url,'/api/demo/settings',admin);
 assert.equal(off.body.enabled,false);
 const createOff=await req(url,'/api/demo/create',admin,'POST',{});
 assert.equal(createOff.status,409);
 const on=await req(url,'/api/demo/settings',admin,'PUT',{enabled:true});
 assert.equal(on.body.enabled,true);
 const demo=await req(url,'/api/demo/create',admin,'POST',{});
 assert.equal(demo.status,201,JSON.stringify(demo.body));
 assert.equal(demo.body.counts.programs,8);
 assert.equal(demo.body.counts.media,2);
 const did=demo.body.event.id;
 const demoData=await req(url,'/api/events/'+did,admin);
 assert.equal(demoData.body.programs.length,8);
 assert.equal(demoData.body.awards.length,4);
 const file=demoData.body.programs.find(p=>p.sourceType==='file');
 assert.ok(file);
 const media=await req(url,'/media/'+file.source,admin);
 assert.equal(media.status,200);
 assert.equal(media.body.subarray(0,4).toString(),'RIFF');
 assert.equal((await req(url,'/api/events/'+did,vc)).status,200);
 const disabled=await req(url,'/api/demo/settings',admin,'PUT',{enabled:false});
 assert.equal(disabled.body.enabled,false);
 const list=await req(url,'/api/events',vc);
 assert.equal(list.body.events.some(e=>e.id===did),false);
 assert.equal((await req(url,'/api/events/'+did,vc)).status,404);
 assert.equal((await req(url,'/api/events/'+did,admin)).status,200,'admin can still inspect hidden demo');
 assert.ok(fs.existsSync(path.join(dir,'media',did)));
});
