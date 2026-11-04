'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('live awards selectors, skipped restore UI, and V1.4.3 asset wiring contract',()=>{
 const awards=read('public/v12.js');
 const skipped=read('public/v15.js');
 const html=read('public/index.html');
 const server=read('server.js');
 for(const name of ['edit','done','pending']){
  assert.ok(awards.includes("$$('[data-award-"+name+"]',list).forEach("),'award action uses list selector '+name);
  assert.ok(!awards.includes("$('[data-award-"+name+"]',list).forEach("),'no nullable single-node forEach '+name);
 }
 assert.ok(awards.includes('application/x-eventflow-award'),'drag/drop uses distinct award MIME key');
 assert.ok(skipped.includes('ef15SkippedPanel'),'separate skipped panel is installed');
 assert.ok(skipped.includes('Restore to Upcoming'),'restore action exists');
 assert.ok(html.includes('/v15.js?v=1.4.3-beta'),'new script is included');
 assert.ok(server.includes('v15\\.js'),'new script is served');
});
