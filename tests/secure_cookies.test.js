'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function port(){return new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})}
test('HTTPS staging flags Secure on login and logout cookies',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eventflow-cookie-'));
 const p=await port();
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,EVENTFLOW_DATA:dir,EVENTFLOW_ADMIN_PASSWORD:'testPassword123',HOST:'127.0.0.1',PORT:String(p),EVENTFLOW_SECURE_COOKIES:'1'},stdio:'pipe'});
 t.after(()=>{child.kill();fs.rmSync(dir,{recursive:true,force:true})});
 const host='http://127.0.0.1:'+p;
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(host+'/api/health')).ok){ready=true;break}}catch{}await delay(80)}
 assert.ok(ready);
 const login=await fetch(host+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'testPassword123'})});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie');
 assert.match(cookie,/; Secure(?:;|$)/);
 assert.match(cookie,/HttpOnly/);
 assert.match(cookie,/SameSite=Lax/);
 const logout=await fetch(host+'/api/logout',{method:'POST',headers:{Cookie:cookie.split(';')[0]}});
 assert.equal(logout.status,200);
 assert.match(logout.headers.get('set-cookie'),/; Secure(?:;|$)/);
});
