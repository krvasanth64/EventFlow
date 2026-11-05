'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
test('login loads event chooser and waits for explicit event selection',()=>{
 const source=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
 const auth=source.slice(source.indexOf('async function initialize()'),source.indexOf("$('#logout')"));
 assert.ok(auth.includes("navigate('dashboard')"));
 assert.ok(auth.includes('await refreshEvents()'));
 assert.ok(!auth.includes('restoreLastEvent()'),'login must not auto-load the previous full event');
 assert.ok(source.includes("if(page==='manage'"));
 const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 assert.ok(html.includes('data-page="manage"')&&html.includes('id="pageManage"'));
});
test('other-user changes warn on Live Control of selected event only',()=>{
 const source=fs.readFileSync(path.join(root,'public/v22.js'),'utf8');
 const notices=[];const state={page:'live',user:{username:'admin'},current:{event:{id:'e1'}}};
 const ctx=vm.createContext({state,renderLive:()=>{},toast:x=>notices.push(x),esc:x=>x,
  current:()=>state.current,document:{querySelector:()=>null}});
 vm.runInContext(source,ctx);
 const report=vm.runInContext('ef22ReportEventChange',ctx);
 const old={event:{id:'e1',revision:3},history:[{id:'h3',user:'admin',action:'live.start'}]};
 const fresh={event:{id:'e1',revision:4},history:[{id:'h4',user:'stage',action:'live.finish'}]};
 report(old,fresh,'stage');
 assert.equal(notices.length,1);
 state.page='planner';report(old,{...fresh,event:{id:'e1',revision:5},history:[{id:'h5',user:'stage',action:'live.finish'}]},'stage');
 assert.equal(notices.length,1);
 state.page='live';report(old,{...fresh,event:{id:'e2',revision:4}},'stage');
 assert.equal(notices.length,1);
 report(old,{...fresh,event:{id:'e1',revision:6},history:[{id:'h6',user:'admin',action:'live.finish'}]},'admin');
 assert.equal(notices.length,1);
});
