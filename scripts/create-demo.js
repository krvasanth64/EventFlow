'use strict';
// Opt-in local demo seed: uses public API and never replaces existing data.
// Usage: EVENTFLOW_URL=http://127.0.0.1:8765 EVENTFLOW_USER=admin EVENTFLOW_PASSWORD=... node scripts/create-demo.js
const base=(process.env.EVENTFLOW_URL||'http://127.0.0.1:8765').replace(/\/$/,'');
const username=process.env.EVENTFLOW_USER||'admin';
const password=process.env.EVENTFLOW_PASSWORD;
if(!password){console.error('Set EVENTFLOW_PASSWORD in this terminal.');process.exit(1)}
let cookie='';
async function call(route,method='GET',payload){
 const result=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});
 if(route==='/api/login')cookie=(result.headers.get('set-cookie')||'').split(';')[0];
 const body=await result.json();if(!result.ok)throw Error(route+': '+(body.error||result.status));
 return body;
}
const samples=[
 ['Welcome Address','Welcome Address','Ceremony',240,'none'],
 ['Opening Solo Dance','Solo Dance','Dance',330,'none'],
 ['Live Karaoke Performance','Karaoke Singing','Music',300,'none'],
 ['Guest Speech','Speech','Speech',450,'none'],
 ['Group Dance Showcase','Group Dance','Dance',420,'none'],
 ['Magic Show','Magic Show','Entertainment',540,'none'],
 ['Stand-up Comedy','Stand-up Comedy','Entertainment',360,'none'],
 ['Vote of Thanks','Vote of Thanks','Ceremony',180,'none']
];
async function main(){
 await call('/api/login','POST',{username,password});
 const stamp=new Date().toISOString().slice(0,10);
 const name='EventFlow DJ Demo '+stamp+' '+Math.random().toString(36).slice(2,6);
 const created=await call('/api/events','POST',{title:name,date:stamp,start:'18:00',venue:'Demo Auditorium',organizer:'EventFlow QA',description:'Sample data only; all programs use timer-only until media is uploaded.'});
 const id=created.event.id;let state=await call('/api/events/'+id+'/lease','POST',{});
 for(const [title,type,category,duration,sourceType] of samples){
  state=await call('/api/events/'+id+'/programs','POST',{revision:state.event.revision,title,type,category,duration,gap:30,presenter:'Demo Team',sourceType,notes:'Sample DJ rehearsal item.'});
 }
 const awards=[
 ['Excellence','Best Performer','Demo Winner A','Chief Guest'],
 ['Team','Best Team','Demo Team B','Managing Director'],
 ['Service','Long Service','Demo Winner C','HR Head'],
 ['Special Recognition','Outstanding Achievement','Demo Winner D','Event Host']
 ];
 for(const [category,awardName,winnerName,presenter] of awards){
  state=await call('/api/events/'+id+'/awards','POST',{revision:state.event.revision,category,awardName,winnerName,presenter});
 }
 console.log(JSON.stringify({created:true,event:name,eventId:id,programs:state.programs.length,awards:state.awards.length,url:base},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
