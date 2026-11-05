'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {buildPdf}=require('../report-pdf');
const root=path.join(__dirname,'..');
test('live timeline starts on running/upcoming page and supports all page sizes',()=>{
 const code=fs.readFileSync(path.join(root,'public/v19.js'),'utf8');
 const c=vm.createContext({v12RenderQueue:()=>{}});
 vm.runInContext(code,c);
 const arr=Array.from({length:85},(_,i)=>({id:'p'+i,status:i<46?'done':i===46?'running':'pending'}));
 assert.equal(vm.runInContext('ef19Paging.size',c),10);
 assert.equal(vm.runInContext('JSON.stringify(ef19PageSizes)',c),JSON.stringify([10,20,30,50,100,200,'all']));
 c.programs=arr;
 assert.equal(vm.runInContext('ef19InitialPage(programs)',c),4,'skip pages of completed programs on initial view');
 vm.runInContext('ef19Paging.size=20',c);
 assert.equal(vm.runInContext('ef19InitialPage(programs)',c),2);
 vm.runInContext("ef19Paging.size='all'",c);
 assert.equal(vm.runInContext('ef19InitialPage(programs)',c),0);
 const onlyUpcoming=Array.from({length:41},(_,i)=>({id:'n'+i,status:i<27?'done':'pending'}));
 c.programs=onlyUpcoming;
 vm.runInContext('ef19Paging.size=10',c);
 assert.equal(vm.runInContext('ef19InitialPage(programs)',c),2,'first upcoming is chosen when nothing is running');
 const source=fs.readFileSync(path.join(root,'public/v16.js'),'utf8');
 assert.ok(source.includes("renderLive=function(){ef16OldLive();$('#ef16LivePreparation')?.remove()}"),
   'Live Control must not render the duplicate participant checklist');
 assert.ok(code.includes("badge.textContent=ready+'/'+people.length+' Ready'"),
   'timeline displays concise checked-in/total readiness');
 assert.ok(code.includes("ef15SkippedPanel()"),'skipped list remains available');
});
test('smaller PDF font yields shorter adaptive rows and fewer pages without removing IDs',async()=>{
 const programs=Array.from({length:160},(_,i)=>({
  id:'internal-'+i,programCode:'P'+String(i+1).padStart(4,'0'),order:i,title:'Program '+(i+1),
  type:'Dance',category:'Show',duration:120,gap:15,presenter:'Stage',
  status:'pending',participants:[],sourceType:'none'
 }));
 const event={event:{title:'PDF Row Density Acceptance',date:'2026-11-05',venue:'Hall'},programs,awards:[]};
 const cols=[{key:'programCode',width:10},{key:'title',width:25},{key:'type',width:12}];
 const small=await buildPdf('programs',event,{fontSize:6,columns:cols});
 const big=await buildPdf('programs',event,{fontSize:11,columns:cols});
 assert.equal(small.subarray(0,5).toString(),'%PDF-');
 assert.equal(big.subarray(0,5).toString(),'%PDF-');
 const count=bytes=>[...bytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
 assert.ok(count(small)>0&&count(big)>0);
 assert.ok(count(small)<count(big),'compact font must produce fewer printed pages for same rows');
});
