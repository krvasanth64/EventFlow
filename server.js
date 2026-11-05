'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { URL } = require('node:url');
const {streamZip,mediaFiles}=require('./zip');
const {createTemplate,parseWorkbook,createSectionTemplate,parseSectionWorkbook}=require('./workbook');
const {buildPdf}=require('./report-pdf');

const ROOT = path.resolve(process.env.EVENTFLOW_DATA || path.join(__dirname, 'runtime'));
const DB = path.join(ROOT, 'data.json');
const MEDIA = path.join(ROOT, 'media');
const BACKUPS = path.join(ROOT, 'backups');
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '127.0.0.1';
const APP_VERSION = '1.5.1-beta';
const SECURE_COOKIES = process.env.EVENTFLOW_SECURE_COOKIES === '1';
const PUBLIC_ORIGIN = String(process.env.EVENTFLOW_PUBLIC_ORIGIN||'').replace(/\/$/,'');
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 1024) * 1024 * 1024;
const SESSION_AGE = 12 * 3600 * 1000;
const LEASE_MS = 90 * 1000;
for (const p of [ROOT, MEDIA, BACKUPS]) fs.mkdirSync(p, { recursive: true });

const uid = () => crypto.randomUUID();
const time = () => Date.now();
const safe = s => String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 75);
const hash = (password, salt = crypto.randomBytes(16).toString('hex')) =>
  salt + ':' + crypto.scryptSync(String(password), salt, 64).toString('hex');
function checkPassword(password, stored) {
  try {
    const [salt, value] = stored.split(':');
    const a = Buffer.from(value, 'hex');
    const b = crypto.scryptSync(String(password), salt, a.length);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}
const defaultCatalogs = () => ({
 programTypes: ['Solo Dance','Group Dance','Drama','Magic Show','Stand-up Comedy','Speech','Karaoke Singing','Solo Singing','Group Singing','Instrumental Music','DJ Performance','Mime','Awards Ceremony','Welcome Address','Vote of Thanks','Other','speech','dance','music','video','ceremony','break','other'].map(name=>({name,enabled:true})),
 programCategories: ['General','Cultural','Music','Dance','Speech','Entertainment','Awards','Ceremony','Break'].map(name=>({name,enabled:true})),
 awardCategories: ['General','Excellence','Performance','Service','Team','Special Recognition'].map(name=>({name,enabled:true})),
 awardTitles: ['Best Performer','Best Team','Long Service','Outstanding Achievement','Special Recognition'].map(name=>({name,enabled:true})),
 presenters: ['Chief Guest','Managing Director','HR Head','Event Host'].map(name=>({name,enabled:true})),
 mediaTypes: ['none','file','url','linked'].map(name=>({name,enabled:true}))
});
function cleanCatalogs(value){
 const fallback=defaultCatalogs(),out={};
 for(const key of Object.keys(fallback)){
   const rows=Array.isArray(value?.[key])?value[key]:fallback[key];
   if(rows.length>100)fail(400,'Too many catalog entries in '+key);
   const seen=new Set();
   out[key]=rows.map(row=>({
     name:String(typeof row==='string'?row:row?.name||'').trim().slice(0,90),
     enabled:typeof row==='string'?true:row?.enabled!==false
   })).filter(x=>x.name&&!seen.has(x.name.toLowerCase())&&seen.add(x.name.toLowerCase()));
   if(!out[key].length)out[key]=fallback[key];
 }
 return out;
}
function archiveSource(p,kind){
 const script=kind==='script';
 const source=script?p.scriptSource:p.sourceType==='file'?p.source:'';
 if(source){
   if(!Array.isArray(p.sourceArchive))p.sourceArchive=[];
   p.sourceArchive.push({id:uid(),kind:script?'script':'media',path:source,name:script?p.scriptName:p.sourceName,archivedAt:ISO()});
 }
 if(script){p.scriptSource='';p.scriptName='';}
 else {p.source='';p.sourceName='';p.sourceType='none';}
}
const fresh = () => ({ version: 1, revision: 0, users: [], events: [], programs: [], awards:[], history: [] });
let db = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : fresh();
// Backward-compatible additions: existing runtime/data.json requires no migration.
if (!Array.isArray(db.awards)) db.awards = [];
if(!db.settings)db.settings={demoEnabled:false};
let sessions = new Map();
let clients = new Set();
let leases = new Map();
let writeCount = 0;

function persist() {
  db.revision += 1;
  const temp = DB + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(temp, DB);
  writeCount++;
  if (writeCount % 20 === 0) {
    fs.copyFileSync(DB, path.join(BACKUPS, 'events-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'));
    const copies = fs.readdirSync(BACKUPS).sort();
    for (const old of copies.slice(0, Math.max(0, copies.length - 30))) fs.unlinkSync(path.join(BACKUPS, old));
  }
}
if (!fs.existsSync(DB)) persist();

function migrateCodes(){
 let changed=false;
 for(const event of db.events){
  for(const config of [
   {items:db.programs,field:'programCode',prefix:'P',counter:'nextProgramNumber'},
   {items:db.awards,field:'awardCode',prefix:'A',counter:'nextAwardNumber'}
  ]){
   const items=config.items.filter(item=>item.eventId===event.id);
   const existing=new Set();
   let max=0;
   for(const item of items){
    const value=item[config.field];
    const valid=typeof value==='string'&&value.startsWith(config.prefix)&&value.length===5&&
      /^[0-9]{4}$/.test(value.slice(1))&&Number(value.slice(1))>0&&!existing.has(value);
    if(valid){existing.add(value);max=Math.max(max,Number(value.slice(1)))}
    else if(value!=null){item[config.field]=null;changed=true}
   }
   let number=Math.max(max+1,Number(event[config.counter])||1);
   const missing=items.filter(item=>!item[config.field]).sort((a,b)=>(a.order||0)-(b.order||0)||a.id.localeCompare(b.id));
   for(const item of missing){
    if(number>9999)throw Error('Event display ID limit reached during migration');
    item[config.field]=config.prefix+String(number++).padStart(4,'0');
    changed=true;
   }
   if(event[config.counter]!==number){event[config.counter]=number;changed=true}
  }
  for(const program of db.programs.filter(item=>item.eventId===event.id)){
   if(!Array.isArray(program.participants)){
    program.participants=program.employeeName?[{
      id:uid(),employeeCode:String(program.employeeId||''),name:String(program.employeeName),
      contact:String(program.contact||''),checkedIn:false,checkedAt:null,checkedBy:null
    }]:[];
    changed=true;
   }
  }
  for(const award of db.awards.filter(item=>item.eventId===event.id)){
   if(!Array.isArray(award.participants)){
    award.participants=award.winnerName?[{
      id:uid(),employeeCode:String(award.employeeId||''),name:String(award.winnerName),
      contact:String(award.contact||''),checkedIn:false,checkedAt:null,checkedBy:null
    }]:[];
    changed=true;
   }
  }
 }
 return changed;
}
function nextDisplayCode(event,prefix){
 const field=prefix==='P'?'nextProgramNumber':'nextAwardNumber';
 const number=event[field]||1;
 if(number>9999)fail(409,'Event display ID limit reached.');
 event[field]=number+1;
 return prefix+String(number).padStart(4,'0');
}
function cleanParticipants(rows,previous=[]){
 if(!Array.isArray(rows)||rows.length>250)fail(400,'Participants must contain at most 250 rows.');
 const existing=new Map(previous.map(p=>[p.id,p])),usedIds=new Set(),usedCodes=new Set();
 return rows.map((row,index)=>{
  if(!row||typeof row!=='object'||Array.isArray(row))fail(400,'Invalid participant row.');
  const name=String(row.name||'').trim().slice(0,160);
  const employeeCode=String(row.employeeCode||'').trim().slice(0,60);
  const contact=String(row.contact||'').trim().slice(0,50);
  if(!name)fail(400,'Participant name is required in row '+(index+1));
  if(employeeCode&&usedCodes.has(employeeCode.toLowerCase()))fail(409,'Duplicate employee code.');
  if(employeeCode)usedCodes.add(employeeCode.toLowerCase());
  const old=existing.get(row.id);
  const id=old?old.id:uid();
  if(usedIds.has(id))fail(409,'Duplicate participant row.');
  usedIds.add(id);
  return {id,employeeCode,name,contact,checkedIn:!!old?.checkedIn,
    checkedAt:old?.checkedAt||null,checkedBy:old?.checkedBy||null};
 });
}
if(migrateCodes())persist();
const seedAdmin = process.env.EVENTFLOW_ADMIN_PASSWORD;
if (!db.users.length && seedAdmin) {
  db.users.push({ id: uid(), username: process.env.EVENTFLOW_ADMIN_USER || 'admin', name: 'Administrator', role: 'admin', active: true, password: hash(seedAdmin) });
  persist();
  console.log('Initial admin account created. Remove the password variable from future startup configurations.');
}
if (!db.users.length) {
  console.error('STARTUP BLOCKED: This data directory contains no users. Verify EVENTFLOW_DATA or set EVENTFLOW_ADMIN_PASSWORD only for a brand-new installation.');
  process.exit(1);
}
const cookieFlags = '; HttpOnly; SameSite=Lax; Path=/' + (SECURE_COOKIES ? '; Secure' : '');
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
function userOf(req) {
  const token = cookie(req, 'ef_session');
  const s = sessions.get(token);
  if (!s || s.expiry < time()) return null;
  return db.users.find(x => x.id === s.userId && x.active) || null;
}
function send(res, status, body, headers = {}) {
  const isObject = typeof body !== 'string' && !Buffer.isBuffer(body);
  const payload = isObject ? JSON.stringify(body) : body;
  const base = {'Content-Type':isObject?'application/json; charset=utf-8':'text/plain; charset=utf-8',
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',...headers};
  // Compress JSON only; never compress already encoded ZIP/PDF/Excel or media streams.
  // Response-specific no-store remains in place for ALL authenticated user data.
  const accept=String(res.req?.headers?.['accept-encoding']||'');
  const compressible=isObject&&Buffer.byteLength(payload)>1024&&/\bgzip\b/.test(accept)&&status>=200&&status<300;
  if(compressible){
    const output=zlib.gzipSync(payload,{level:zlib.constants.Z_BEST_SPEED});
    res.writeHead(status,{...base,'Content-Encoding':'gzip','Vary':'Accept-Encoding',
      'Content-Length':output.length});
    return res.end(output);
  }
  res.writeHead(status,base);
  return res.end(payload);
}
const fail = (status, message) => { const err = new Error(message); err.status = status; throw err; };
function need(user, roles) {
  if (!user) fail(401, 'Please sign in.');
  if (roles && !roles.includes(user.role)) fail(403, 'Insufficient permission.');
}
function binaryBody(req,max=8*1024*1024){
 return new Promise((resolve,reject)=>{
  const parts=[];let length=0;
  req.on('data',part=>{
   length+=part.length;
   if(length>max){const e=new Error('File too large (8 MB maximum).');e.status=413;reject(e);req.destroy();}
   else parts.push(part);
  });
  req.on('end',()=>resolve(Buffer.concat(parts)));
  req.on('error',reject);
 });
}
function demoWav(){
 const sampleRate=16000,duration=4,frames=sampleRate*duration;
 const buf=Buffer.alloc(44+frames*2);
 buf.write('RIFF',0);buf.writeUInt32LE(buf.length-8,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);
 buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(sampleRate,24);
 buf.writeUInt32LE(sampleRate*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);
 buf.write('data',36);buf.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++){
  const fade=Math.min(1,i/1800,(frames-i)/2000),v=Math.round(3500*Math.sin(i*2*Math.PI*440/sampleRate)*Math.max(0,fade));
  buf.writeInt16LE(v,44+i*2);
 }
 return buf;
}
function jsonBody(req, max = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', chunk => { size += chunk.length; if (size > max) { reject(Object.assign(new Error('Request too large'), { status:413 })); req.destroy(); } else parts.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { status:400 })); } });
    req.on('error', reject);
  });
}
const publicUser = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active });
const byEvent = id => db.events.find(e => e.id === id);
const eventPrograms = id => db.programs.filter(p => p.eventId === id).sort((a,b) => a.order - b.order);
const eventAwards = id => db.awards.filter(a => a.eventId === id).sort((a,b) => a.order - b.order);
const ISO = () => new Date().toISOString();
const liveElapsed = (p, now = time()) => Math.max(0, Number(p.elapsedSeconds)||0) + (p.status==='running' && (p.resumedAt || (p.elapsedSeconds===undefined && p.actualStart)) ? Math.max(0,(now-Date.parse(p.resumedAt || p.actualStart))/1000) : 0);
const personFields = b => ({ employeeId:String(b.employeeId||'').trim().slice(0,60),employeeName:String(b.employeeName||'').trim().slice(0,160),contact:String(b.contact||'').trim().slice(0,40) });
const awardInput = b => {
  const category=String(b.category||'').trim().slice(0,100);
  const awardName=String(b.awardName||'').trim().slice(0,160);
  const winnerName=String(b.winnerName||'').trim().slice(0,160);
  if (!category || !awardName || !winnerName) fail(400,'Category, award name, and winner are required.');
  return {category,awardName,winnerName,...personFields(b),recipientDetails:String(b.recipientDetails||'').slice(0,200),
    presenter:String(b.presenter||'').slice(0,120),notes:String(b.notes||'').slice(0,1000)};
};
function broadcast(eventId) {
  const packet = 'data: ' + JSON.stringify({ eventId, revision: db.revision }) + '\n\n';
  for (const c of clients) { try { c.write(packet); } catch { clients.delete(c); } }
}
function leaseOf(id) {
  const lock = leases.get(id);
  if (lock && lock.expires <= time()) { leases.delete(id); return null; }
  return lock || null;
}
function isEditor(user, id, token) {
  const lock = leaseOf(id);
  return user?.role === 'admin' && !lock ? false : !!(lock && lock.userId === user?.id && lock.token === token);
}
function requireLiveOperator(user, id) {
  need(user, ['admin','editor','live_controller']);
  if (!byEvent(id)) fail(404,'Event not found.');
}
function requireEditor(user, id, req) {
  need(user, ['admin','editor']);
  if (!byEvent(id)) fail(404,'Event not found.');
  if (!isEditor(user, id, cookie(req, 'ef_session'))) fail(423, 'This event is not currently checked out for editing on your session.');
}
function revision(body, event) {
  if (body.revision !== event.revision) fail(409, 'The event changed. Refresh before saving.');
}
function audit(action, user, eventId, details='') {
  db.history.unshift({ id:uid(), at: new Date().toISOString(), action, user: user?.username || 'system', eventId, details });
  db.history = db.history.slice(0, 300);
}
function minutes(x) { const n = Number(x); return Number.isFinite(n) && n >= 0 && n <= 86400 ? n : null; }
function validProgram(p) {
  if (!String(p.title || '').trim()) fail(400, 'Program title is required.');
  if (minutes(p.duration) === null || minutes(p.gap) === null) fail(400,'Duration and gap must be valid nonnegative seconds.');
  if (!String(p.type||'').trim()||String(p.type).length>90) fail(400,'Invalid program type.');
  if (!['none','file','url','linked'].includes(p.sourceType)) fail(400,'Invalid source type.');
  if (p.sourceType === 'url' && !/^https?:\/\//i.test(String(p.source || ''))) fail(400, 'Enter an http/https URL.');
}
function eventResponse(id, user, req) {
  const e = byEvent(id); if (!e) fail(404,'Event not found.');
  const lock = leaseOf(id);
  return { event:e, programs:eventPrograms(id), awards:eventAwards(id), history:db.history.filter(h => h.eventId === id).slice(0,30),
    lock: lock ? { user:db.users.find(u => u.id===lock.userId)?.name || 'Unknown', mine:isEditor(user,id,cookie(req,'ef_session')), expires:lock.expires } : null };
}
const mime = ext => ({ '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.mp3':'audio/mpeg','.mp4':'video/mp4','.webm':'video/webm','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4','.mov':'video/quicktime','.pdf':'application/pdf','.webmanifest':'application/manifest+json' })[ext] || 'application/octet-stream';
function streamFile(req, res, file, allowRange=false, staticAsset=false) {
  const stat = fs.statSync(file); const type = mime(path.extname(file).toLowerCase());
  const longCache=staticAsset&&req.url.includes('?')&&new URL(req.url,'http://localhost').searchParams.has('v');
  const h = { 'Content-Type':type, 'Accept-Ranges': allowRange ? 'bytes':'none',
    'X-Content-Type-Options':'nosniff','Cache-Control':longCache?'public, max-age=604800, immutable':'no-store' };
  if (allowRange && req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match) return send(res,416,'Invalid range',{ 'Content-Range':'bytes */'+stat.size });
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!match[1] && match[2]) { start = Math.max(0, stat.size - Number(match[2])); end = stat.size-1; }
    if (start > end || start >= stat.size) return send(res,416,'Out of range',{ 'Content-Range':'bytes */'+stat.size });
    end = Math.min(end, stat.size-1);
    res.writeHead(206,{ ...h,'Content-Length':end-start+1,'Content-Range':'bytes '+start+'-'+end+'/'+stat.size });
    if(req.method==='HEAD') return res.end();
    return fs.createReadStream(file,{start,end}).pipe(res);
  }
  res.writeHead(200,{ ...h,'Content-Length':stat.size });
  if(req.method==='HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost');
    const route = url.pathname;
    // Opt-in same-origin gate for HTTPS staging; configure the public canonical origin.
    // This prevents cross-site browser forms from mutating event state.
    if(PUBLIC_ORIGIN&&['POST','PUT','PATCH','DELETE'].includes(req.method)){
      if(req.headers.origin!==PUBLIC_ORIGIN)fail(403,'Request origin is not authorized.');
    }
    const user = userOf(req);
    if (route === '/api/health') return send(res,200,{ ok:true, version:APP_VERSION, host:HOST, users:db.users.length, revision:db.revision });
    if (route === '/api/login' && req.method==='POST') {
      const body = await jsonBody(req);
      const u = db.users.find(u => u.username.toLowerCase() === String(body.username || '').toLowerCase() && u.active);
      if (!u || !checkPassword(body.password, u.password)) fail(401,'Invalid username or password.');
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token,{userId:u.id,expiry:time()+SESSION_AGE});
      return send(res,200,{user:publicUser(u)}, {'Set-Cookie':'ef_session='+token+cookieFlags+'; Max-Age=43200'});
    }
    if (route === '/api/logout' && req.method==='POST') {
      sessions.delete(cookie(req,'ef_session'));
      for(const [id,l] of leases) if(l.token===cookie(req,'ef_session')) { leases.delete(id); broadcast(id); }
      return send(res,200,{ok:true},{'Set-Cookie':'ef_session='+cookieFlags+'; Max-Age=0'});
    }
    if (route === '/api/backup/full' && req.method==='GET') {
      need(user,['admin']);
      const files=mediaFiles(MEDIA).map(x=>({name:'media/'+x.name,file:x.file}));
      const oldCopies=mediaFiles(BACKUPS).map(x=>({name:'backups/'+x.name,file:x.file}));
      const snapshot=JSON.stringify(db,null,2);
      const entries=[
        {name:'data.json',content:snapshot},
        {name:'BACKUP_README.txt',content:'EventFlow complete runtime backup. PRIVATE: contains password hashes and user information.\\nStop the server before restoring. Extract data.json and media/ into EVENTFLOW_DATA. Do not commit backup to GitHub.\\n'},
        ...files,...oldCopies
      ];
      const stamp=ISO().replace(/[:.]/g,'-');
      return await streamZip(res,entries,'EventFlow_FULL_'+stamp+'.zip');
    }
    if(route==='/api/import/template'&&req.method==='GET'){
      need(user,['admin','editor']);
      const workbook=await createTemplate(url.searchParams.get('sample')==='full');
      return send(res,200,workbook,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'Content-Disposition':'attachment; filename="EventFlow_Import_Template.xlsx"'});
    }
    if(route==='/api/import/preview'&&req.method==='POST'){
      need(user,['admin','editor']);
      const data=await parseWorkbook(await binaryBody(req));
      return send(res,200,data);
    }
    if(route==='/api/import/apply'&&req.method==='POST'){
      need(user,['admin','editor']);
      const payload=await parseWorkbook(await binaryBody(req));
      if(!payload.valid)fail(422,'Workbook has '+payload.errors.length+' validation error(s). Review preview.');
      if(db.events.some(x=>x.title.toLowerCase()===payload.event.title.toLowerCase()))
        fail(409,'An event with this title already exists. Rename it or use a new workbook.');
      const e={id:uid(),catalogs:defaultCatalogs(),...payload.event,status:'draft',revision:1,createdAt:ISO(),
        nextProgramNumber:payload.programs.length+1,nextAwardNumber:payload.awards.length+1};
      const programs=payload.programs.map((p,i)=>({
        id:uid(),eventId:e.id,order:i,programCode:'P'+String(i+1).padStart(4,'0'),
        title:p.title,type:p.type,category:p.category,duration:p.duration,gap:p.gap,
        presenter:p.presenter,sourceType:p.sourceType,source:p.source,notes:p.notes,
        status:'pending',actualStart:null,actualEnd:null,
        participants:p.participants.map(person=>({id:uid(),employeeCode:person.employeeCode,
          name:person.name,contact:person.contact,checkedIn:false,checkedAt:null,checkedBy:null}))
      }));
      const awards=payload.awards.map((a,i)=>({
        id:uid(),eventId:e.id,order:i,awardCode:'A'+String(i+1).padStart(4,'0'),
        category:a.category,awardName:a.awardName,winnerName:a.winnerName,
        presenter:a.presenter,employeeId:a.employeeId||'',employeeName:'',contact:a.contact||'',
        recipientDetails:'',notes:a.notes||'',status:'pending',presentedAt:null,
         participants:cleanParticipants([{name:a.winnerName,employeeCode:a.employeeId||'',contact:a.contact||''}])
      }));
      db.events.push(e);db.programs.push(...programs);db.awards.push(...awards);
      audit('event.imported',user,e.id,'Excel '+programs.length+' programs and '+awards.length+' awards');
      persist();broadcast(e.id);
      return send(res,201,{event:e,counts:payload.counts});
    }
    if(route==='/api/demo/settings'&&req.method==='GET'){
      need(user);
      return send(res,200,{enabled:!!db.settings.demoEnabled});
    }
    if(route==='/api/demo/settings'&&req.method==='PUT'){
      need(user,['admin']);
      const body=await jsonBody(req);
      if(typeof body.enabled!=='boolean')fail(400,'Enabled must be boolean.');
      db.settings.demoEnabled=body.enabled;
      audit('demo.visibility',user,'system',String(body.enabled));persist();
      return send(res,200,{enabled:body.enabled});
    }
    if(route==='/api/demo/create'&&req.method==='POST'){
      need(user,['admin']);
      if(!db.settings.demoEnabled)fail(409,'Enable demo events before creating a demo.');
      const title='EventFlow Full Demo '+ISO().replace(/[:.]/g,'-');
      const event={id:uid(),title,date:ISO().slice(0,10),start:'18:00',
        venue:'Demo Auditorium',organizer:'EventFlow Demo',description:'Synthetic rehearsal data. Not a real event.',
        catalogs:defaultCatalogs(),status:'draft',isDemo:true,revision:1,createdAt:ISO(),
        nextProgramNumber:9,nextAwardNumber:5};
      const specs=[
       ['Opening Welcome','Welcome Address','Ceremony',240,'none',''],
       ['Group Dance','Group Dance','Dance',360,'file',''],
       ['Karaoke Singing','Karaoke Singing','Music',300,'url','https://example.com/replace-this-demo-url'],
       ['Guest Speech','Speech','Speech',420,'none',''],
       ['Magic Show','Magic Show','Entertainment',420,'none',''],
       ['Solo Singing','Solo Singing','Music',300,'file',''],
       ['Standup Comedy','Stand-up Comedy','Entertainment',360,'none',''],
       ['Grand Finale','Group Dance','Dance',480,'none','']
      ];
      const dir=path.join(MEDIA,event.id);fs.mkdirSync(dir,{recursive:true});
      const wav=demoWav();const files=[];
      const programs=specs.map((spec,i)=>{
       const [title,type,category,duration,kind,urlRef]=spec;
       const id=uid(),n=i+1,programCode='P'+String(n).padStart(4,'0');
       let sourceType=kind,source=kind==='url'?urlRef:'';
       if(kind==='file'){
         const filename=programCode+'_SampleTone.wav';
         const filepath=path.join(dir,filename);fs.writeFileSync(filepath,wav);files.push(filepath);
         source=event.id+'/'+filename;
       }
       return {id,eventId:event.id,programCode,order:i,title,type,category,duration,gap:30,
         presenter:'Demo Stage Team',sourceType,source,sourceName:kind==='file'?'SampleTone.wav':'',
         notes:'Rehearsal only',status:'pending',actualStart:null,actualEnd:null,
         participants:Array.from({length:i%3+2},(_,j)=>({
           id:uid(),employeeCode:'DEMO'+String(i*5+j+1).padStart(4,'0'),
           name:'Sample Participant '+(i+1)+'-'+(j+1),contact:'',checkedIn:false,checkedAt:null,checkedBy:null
         }))};
      });
      const awardSpecs=[['Excellence','Best Performer','Demo Winner One','Chief Guest'],
       ['Team','Best Group','Demo Team','Managing Director'],['Service','Long Service','Demo Winner Two','HR Head'],
       ['Special Recognition','Outstanding Achievement','Demo Winner Three','Event Host']];
      const awards=awardSpecs.map(([category,awardName,winnerName,presenter],i)=>({
        id:uid(),eventId:event.id,awardCode:'A'+String(i+1).padStart(4,'0'),order:i,
        category,awardName,winnerName,presenter,status:'pending',presentedAt:null,
         participants:cleanParticipants([{name:winnerName,employeeCode:'',contact:''}])
      }));
      db.events.push(event);db.programs.push(...programs);db.awards.push(...awards);
      audit('demo.created',user,event.id,event.title);persist();broadcast(event.id);
      return send(res,201,{event,counts:{programs:8,participants:programs.reduce((n,p)=>n+p.participants.length,0),
        awards:4,media:files.length}});
    }
    if (route === '/api/me') { need(user); return send(res,200,{user:publicUser(user), settings:{port:PORT, mediaRoot:MEDIA}}); }
    if (route === '/api/events' && req.method==='GET') { need(user); return send(res,200,{events:db.events.filter(e=>!e.isDemo||db.settings.demoEnabled||user.role==='admin').map(e=>({...e,programCount:eventPrograms(e.id).length})).sort((a,b)=>b.date.localeCompare(a.date))}); }
    if (route === '/api/events' && req.method==='POST') {
      need(user,['admin','editor']); const b=await jsonBody(req);
      if(!String(b.title||'').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date||'')) || !/^\d{2}:\d{2}$/.test(String(b.start||''))) fail(400,'Title, date, and start time are required.');
      if(db.events.some(e=>e.title.toLowerCase()===b.title.trim().toLowerCase())) fail(409,'Event title must be unique.');
      const e={id:uid(),catalogs:defaultCatalogs(),title:b.title.trim().slice(0,120),date:b.date,start:b.start,venue:String(b.venue||'').slice(0,150),organizer:String(b.organizer||'').slice(0,150),description:String(b.description||'').slice(0,1200),status:'draft',revision:1, createdAt:new Date().toISOString()};
      db.events.push(e); audit('event.created',user,e.id,e.title);persist();broadcast(e.id);return send(res,201,{event:e});
    }
    const eventMatch = /^\/api\/events\/([a-f0-9-]+)(?:\/(.*))?$/.exec(route);
    if (eventMatch) {
      need(user);const id=eventMatch[1], action=eventMatch[2] || '';
      const e=byEvent(id);if(!e||e.isDemo&& !db.settings.demoEnabled&&user.role!=='admin') fail(404,'Event not found.');
      if (!action && req.method==='GET') return send(res,200,eventResponse(id,user,req));
      const sectionMatch=/^import\/(programs|awards)\/(template|preview|apply)$/.exec(action);
      if(sectionMatch){
        need(user,['admin','editor']);
        const kind=sectionMatch[1],verb=sectionMatch[2];
        if(verb==='template'&&req.method==='GET'){
          const bytes=await createSectionTemplate(kind);
          return send(res,200,bytes,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition':'attachment; filename="EventFlow_'+kind+'_Template.xlsx"'});
        }
        if(['preview','apply'].includes(verb)&&req.method==='POST'){
          requireEditor(user,id,req);
          const parsed=await parseSectionWorkbook(await binaryBody(req),kind);
          const conflicts=kind==='programs'?
            parsed.programs.filter(x=>eventPrograms(id).some(p=>p.title.toLowerCase()===x.title.toLowerCase()))
              .map(x=>'Existing program title: '+x.title):
            parsed.awards.filter(a=>eventAwards(id).some(x=>
               x.awardName.toLowerCase()===a.awardName.toLowerCase()&&
               x.winnerName.toLowerCase()===a.winnerName.toLowerCase()))
              .map(a=>'Existing award and winner: '+a.awardName+' / '+a.winnerName);
          if(kind==='awards'){
            const pairs=new Set();
            for(const a of parsed.awards){
              const pair=a.awardName.toLowerCase()+'|'+a.winnerName.toLowerCase();
              if(pairs.has(pair))conflicts.push('Duplicate award/winner pair in Excel: '+a.awardName);
              pairs.add(pair);
            }
          }
          parsed.errors.push(...conflicts);parsed.valid=parsed.errors.length===0;
          if(verb==='preview')return send(res,200,{valid:parsed.valid,errors:parsed.errors,counts:parsed.counts,kind});
          if(!parsed.valid)fail(422,parsed.errors.join('; ').slice(0,1200));
          if(Number(url.searchParams.get('revision'))!==e.revision)fail(409,'The event changed. Preview again.');
          if(kind==='programs'){
            const initial=eventPrograms(id).length;
            for(const [index,item] of parsed.programs.entries()){
              const p={id:uid(),eventId:id,programCode:nextDisplayCode(e,'P'),
                order:initial+index,title:item.title,type:item.type,category:item.category,
                duration:item.duration,gap:item.gap,presenter:item.presenter,notes:item.notes,
                sourceType:item.sourceType,source:item.source,status:'pending',actualStart:null,actualEnd:null,
                participants:cleanParticipants(item.participants)};
              validProgram(p);db.programs.push(p);
            }
          }else{
            const initial=eventAwards(id).length;
            for(const [index,item] of parsed.awards.entries()){
              const details=awardInput({category:item.category,awardName:item.awardName,
                winnerName:item.winnerName,presenter:item.presenter,employeeId:item.employeeId,
                contact:item.contact,notes:item.notes});
              db.awards.push({id:uid(),eventId:id,awardCode:nextDisplayCode(e,'A'),
                order:initial+index,...details,status:'pending',presentedAt:null,
                 participants:cleanParticipants([{name:details.winnerName,employeeCode:details.employeeId||'',contact:details.contact||''}])});
            }
          }
          e.revision++;audit('event.section.import',user,id,kind+' '+(kind==='programs'?parsed.programs.length:parsed.awards.length));
          persist();broadcast(id);
          return send(res,201,eventResponse(id,user,req));
        }
      }
      const pdfMatch=/^reports\/(programs|awards)\.pdf$/.exec(action);
      if(pdfMatch&&req.method==='POST'){
        need(user);
        const options=await jsonBody(req,100*1024);
        let pdf;
        try{pdf=await buildPdf(pdfMatch[1],eventResponse(id,user,req),options)}
        catch(err){fail(400,err.message)}
        const base=String(e.title||'Event').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,70);
        return send(res,200,pdf,{'Content-Type':'application/pdf',
          'Content-Disposition':'attachment; filename="'+base+'_'+pdfMatch[1]+'.pdf"'});
      }
      if (action==='lease' && req.method==='POST') {
        need(user,['admin','editor']); const token=cookie(req,'ef_session');const lock=leaseOf(id);
        const body=await jsonBody(req);
        if(lock && lock.token!==token && !(user.role==='admin' && body.takeover===true)) fail(423,'Currently edited by '+(db.users.find(u=>u.id===lock.userId)?.name||'another user'));
        leases.set(id,{userId:user.id,token,expires:time()+LEASE_MS});broadcast(id);return send(res,200,eventResponse(id,user,req));
      }
      if (action==='lease' && req.method==='DELETE') {
        const lock=leaseOf(id);
        if(lock && (lock.token===cookie(req,'ef_session') || user.role==='admin')){leases.delete(id);broadcast(id);}
        return send(res,200,{ok:true});
      }
      if (action==='lease/renew' && req.method==='POST') {
        requireEditor(user,id,req); const l=leases.get(id);l.expires=time()+LEASE_MS;return send(res,200,{expires:l.expires});
      }
      if (['dj-links.csv','dj-links.html'].includes(action) && req.method==='GET') {
        need(user,['admin','editor','live_controller']);
        const rows=eventPrograms(id).map((p,i)=>({
          order:i+1,programCode:p.programCode,id:p.id,title:p.title,status:p.status,type:p.type,
          category:p.category||'',sourceType:p.sourceType||'none',
          sourceURL:p.sourceType==='url'&&/^https?:\/\//i.test(String(p.source||''))?p.source:'',
          linkedReference:p.sourceType==='linked'?p.source||'':'',
          fileName:p.sourceType==='file'?p.sourceName||path.basename(p.source||''):'',
          durationSeconds:Number(p.duration)||0
        }));
        const escapeCSV=v=>{
          const value=String(v??'').replace(/\r?\n/g,' ');
          const protectedValue=/^[\s]*[=+\-@\t\r]/.test(value)?"'"+value:value;
          return '"'+protectedValue.replace(/"/g,'""')+'"';
        };
        const csv=[['Order','Program Code','Program ID','Program Title','Status','Category','Program Type','Source Type','External URL','Linked Reference','Uploaded File','Duration Seconds'].map(escapeCSV).join(','),
          ...rows.map(p=>[p.order,p.programCode,p.id,p.title,p.status,p.category,p.type,p.sourceType,p.sourceURL,p.linkedReference,p.fileName,p.durationSeconds].map(escapeCSV).join(','))].join('\r\n');
        const filename=safe(e.title)+'_'+id.slice(0,8)+'_DJ_URLS';
        if(action==='dj-links.csv')
          return send(res,200,csv,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="'+filename+'.csv"'});
        const escHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const body='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
          '<title>'+escHtml(e.title)+' — DJ Links</title><style>body{font:16px system-ui;margin:2rem auto;padding:0 1rem;max-width:1100px;color:#18223a}h1{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #d8e0eb;text-align:left;padding:12px 9px;overflow-wrap:anywhere}th{background:#f2f5fc}a{color:#2356b9}small{color:#5f6e83}@media(max-width:650px){table{font-size:13px}th,td{padding:8px 4px}}</style></head><body>'+
          '<h1>'+escHtml(e.title)+' — DJ Link Sheet</h1><small>Program order and external references. Internet access may be required. Only http(s) source URLs are clickable; local linked references must be opened on their own host.</small>'+
          '<table><thead><tr><th>#</th><th>Program</th><th>Status</th><th>Source</th></tr></thead><tbody>'+
          rows.map(p=>'<tr><td>'+p.order+'</td><td><strong>'+escHtml(p.programCode||'')+' · '+escHtml(p.title)+'</strong><br><small>'+escHtml(p.category)+'</small></td><td>'+escHtml(p.status)+'</td><td>'+
            (p.sourceURL?'<a href="'+escHtml(p.sourceURL)+'" target="_blank" rel="noopener noreferrer">Open URL</a><br><small>'+escHtml(p.sourceURL)+'</small>':
             p.fileName?'Uploaded media: '+escHtml(p.fileName):
             p.linkedReference?'Host reference: '+escHtml(p.linkedReference):'No media')+'</td></tr>').join('')+
          '</tbody></table></body></html>';
        return send(res,200,body,{'Content-Type':'text/html; charset=utf-8','Content-Disposition':'attachment; filename="'+filename+'.html"','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"});
      }
      if (action==='dj-package' && req.method==='GET') {
        need(user,['admin','editor','live_controller']);
        const programs=eventPrograms(id),awards=eventAwards(id);
        const manifest={format:'EventFlow-DJ-package-v1',event:{id:e.id,title:e.title,date:e.date,start:e.start,venue:e.venue},createdAt:ISO(),programs:[],awards};
        const entries=[],names=new Set();
        let num=0;
        for(const program of programs){
          num++;
          const item={id:program.id,programCode:program.programCode,title:program.title,order:num,status:program.status,type:program.type,
            category:program.category,durationSeconds:program.duration,media:[],script:[],externalSource:null};
          if(['url','linked'].includes(program.sourceType))item.externalSource={type:program.sourceType,reference:program.source};
          const sources=[];
          if(program.sourceType==='file'&&program.source)sources.push({kind:'media',ref:program.source,archived:false});
          if(program.scriptSource)sources.push({kind:'script',ref:program.scriptSource,archived:false});
          for(const a of program.sourceArchive||[])if(a.path)sources.push({kind:a.kind==='script'?'script':'media',ref:a.path,archived:true});
          let seq=0;
          for(const source of sources){
            const candidate=path.resolve(MEDIA,source.ref);
            if(!candidate.startsWith(path.resolve(MEDIA)+path.sep)||!fs.existsSync(candidate)||!fs.statSync(candidate).isFile())fail(409,'DJ package cannot be completed: missing source for '+program.title);
            const ext=path.extname(candidate).toLowerCase(),name='DJ_Media/'+safe(program.programCode||String(num).padStart(3,'0'))+'_'+safe(program.title)+'_'+program.id.slice(0,8)+'_'+(++seq)+(source.archived?'_ARCHIVED':'')+ext;
            if(names.has(name))fail(409,'Duplicate file name during export');
            names.add(name);
            entries.push({name,file:candidate});
            item[source.kind].push({filename:name,archived:source.archived,originalSource:source.ref});
          }
          manifest.programs.push(item);
        }
        const csvCell=value=>{const val=String(value??'').replace(/\r?\n/g,' ');return '"'+(/^\s*[=+\-@]/.test(val)?"'"+val:val).replace(/"/g,'""')+'"'};
        const columns=['Order','Program Code','Program ID','Title','Status','Type','Duration (seconds)','Current media filename','External source'];
        const csv=[columns.map(csvCell).join(','),...manifest.programs.map(p=>[p.order,p.programCode,p.id,p.title,p.status,p.type,p.durationSeconds,p.media.filter(x=>!x.archived).map(x=>x.filename).join('; '),p.externalSource?.reference||''].map(csvCell).join(','))].join('\\r\\n');
        const contents=[
          {name:'DJ_MANIFEST.json',content:JSON.stringify(manifest,null,2)},
          {name:'DJ_RUNNING_ORDER.csv',content:csv},
          {name:'DJ_EXTERNAL_URLS.csv',content:[
            ['Order','Program Code','Program ID','Program Title','Status','Source Type','External URL','Linked Reference'].map(csvCell).join(','),
            ...manifest.programs.map(p=>[p.order,p.programCode,p.id,p.title,p.status,p.externalSource?.type||'none',
              p.externalSource?.type==='url'?p.externalSource.reference:'',
              p.externalSource?.type==='linked'?p.externalSource.reference:''].map(csvCell).join(','))
          ].join('\r\n')},
          {name:'DJ_LINK_SHEET.html',content:(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
            '<title>DJ Links</title><style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#18223a}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #d8e0eb;padding:12px 8px;text-align:left;overflow-wrap:anywhere}th{background:#f2f5fc}a{color:#2356b9}</style></head><body>'+
            '<h1>'+String(e.title).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+' — DJ Link Sheet</h1><p>External sources need connectivity. Uploaded files are linked relative to the DJ ZIP folder.</p>'+
            '<table><thead><tr><th>Order</th><th>Program</th><th>Source</th></tr></thead><tbody>'+
            manifest.programs.map(p=>{
              const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
              const url=p.externalSource?.type==='url'&&/^https?:\/\//i.test(p.externalSource.reference)?p.externalSource.reference:null;
              const local=p.media.find(x=>!x.archived)?.filename;
              return '<tr><td>'+p.order+'</td><td>'+escapeHtml(p.programCode||'')+' · '+escapeHtml(p.title)+'</td><td>'+
                (url?'<a target="_blank" rel="noopener noreferrer" href="'+escapeHtml(url)+'">Open URL</a><br>'+escapeHtml(url):
                 local?'<a href="'+escapeHtml(local)+'">Open media file</a>':
                 p.externalSource?.type==='linked'?'Linked host reference: '+escapeHtml(p.externalSource.reference):'No media')+
                '</td></tr>';
            }).join('')+'</tbody></table></body></html>'
          )},
          {name:'README.txt',content:'EventFlow DJ package. Play media files from DJ_Media. External URLs and linked host paths are references only. Archived versions are named ARCHIVED.\\n'},
          ...entries
        ];
        return await streamZip(res,contents,'DJ_'+safe(e.title)+'_'+id.slice(0,8)+'.zip');
      }
      if (action==='export' && req.method==='GET') {
        need(user,['admin','editor']);
        const snapshot={format:'EventFlow-event-json',version:1,exportedAt:ISO(),
          event:e,programs:eventPrograms(id),awards:eventAwards(id),
          notice:'Media binaries are not included. Use a complete runtime backup for recovery.'};
        const body=JSON.stringify(snapshot,null,2);
        return send(res,200,body,{'Content-Type':'application/json; charset=utf-8',
          'Content-Disposition':'attachment; filename="'+safe(e.title)+'_'+id.slice(0,8)+'.json"'});
      }
      const downloadMatch=/^programs\/([a-f0-9-]+)\/download$/.exec(action);
      if(downloadMatch && req.method==='GET'){
        need(user,['admin','editor','live_controller']);
        const p=db.programs.find(x=>x.id===downloadMatch[1]&&x.eventId===id);
        if(!p||p.sourceType!=='file'||!p.source)fail(404,'Uploaded media not available.');
        const file=path.resolve(MEDIA,p.source);
        if(!file.startsWith(path.resolve(MEDIA)+path.sep)||!fs.existsSync(file))fail(404,'Media file missing.');
        const ext=path.extname(file).toLowerCase();
        const filename=safe(p.title)+'_'+p.id.slice(0,8)+ext;
        res.setHeader('Content-Disposition','attachment; filename="'+filename+'"');
        return streamFile(req,res,file,true);
      }
      if (action==='media' && req.method==='POST') {
        requireEditor(user,id,req);
        const expectedRevision=Number(url.searchParams.get('revision'));
        if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==e.revision) fail(409,'The event changed during upload. Refresh and retry.');
        const programId=url.searchParams.get('program');
        const p=db.programs.find(p=>p.id===programId&&p.eventId===id);
        if(!p) fail(404,'Program not found.');
        const raw=url.searchParams.get('filename')||'media.bin';
        const isScript=url.searchParams.get('kind')==='script';
        const ext=path.extname(raw).toLowerCase();
        if(!(isScript?['.png','.jpg','.jpeg','.webp','.pdf']:['.mp3','.mp4','.webm','.wav','.ogg','.m4a','.mov']).includes(ext)) fail(400,'Unsupported file extension.');
        const length=Number(req.headers['content-length']);
        if(!Number.isSafeInteger(length)||length<1||length>MAX_UPLOAD) fail(413,'Upload must have a valid Content-Length and fit within size limit.');
        const folder=path.join(MEDIA,id);fs.mkdirSync(folder,{recursive:true});
        const fileName=safe(p.id.slice(0,8)+'_'+(isScript?'script_':'')+p.title+'_'+uid().slice(0,8))+ext;const target=path.join(folder,fileName);const temp=target+'.part-'+uid();
        let size=0;
        try {
          await new Promise((resolve,reject)=>{
            const out=fs.createWriteStream(temp,{flags:'wx'});
            req.on('data',c=>{size+=c.length;if(size>MAX_UPLOAD){req.destroy();reject(new Error('Upload too large'));}});
            req.on('error',reject);out.on('error',reject);out.on('finish',resolve);req.pipe(out);
          });
          if(size!==length) fail(400,'Incomplete upload.');
          // A parallel request may have changed the event while data was streaming.
          requireEditor(user,id,req);
          if(expectedRevision!==e.revision) fail(409,'The event changed during upload. Refresh and retry.');
          fs.renameSync(temp,target);
        } finally { if(fs.existsSync(temp)) fs.unlinkSync(temp); }
        if(isScript){if(p.scriptSource)archiveSource(p,'script');p.scriptSource=path.relative(MEDIA,target).replace(/\\/g,'/');p.scriptName=raw.slice(0,255);}else{if(p.sourceType==='file'&&p.source)archiveSource(p,'media');p.sourceType='file';p.source=path.relative(MEDIA,target).replace(/\\/g,'/');p.sourceName=raw.slice(0,255);}e.revision++;audit(isScript?'script.uploaded':'media.uploaded',user,id,p.title);persist();broadcast(id);
        return send(res,200,{program:p,revision:e.revision});
      }
      // Award plan is independent of the chronological program schedule.
      if (action==='awards' && req.method==='POST') {
        requireEditor(user,id,req);const b=await jsonBody(req);revision(b,e);
        const details=awardInput(b);
        const award={id:uid(),eventId:id,awardCode:nextDisplayCode(e,'A'),order:eventAwards(id).length,...details,status:'pending',presentedAt:null,participants:cleanParticipants([{name:details.winnerName,employeeCode:details.employeeId||'',contact:details.contact||''}])};
        db.awards.push(award);e.revision++;audit('award.created',user,id,award.awardName);
        persist();broadcast(id);return send(res,201,eventResponse(id,user,req));
      }
      if (action==='awards/reorder' && req.method==='POST') {
        requireLiveOperator(user,id);const b=await jsonBody(req);revision(b,e);
        const awards=eventAwards(id);
        if(!Array.isArray(b.ids)||b.ids.length!==awards.length||new Set(b.ids).size!==b.ids.length||
          !b.ids.every(x=>awards.some(a=>a.id===x)))fail(400,'Award order must include every award exactly once.');
        for(let i=0;i<awards.length;i++)
          if(awards[i].status==='presented'&&b.ids[i]!==awards[i].id)
            fail(409,'Presented awards cannot be moved during live reordering.');
        b.ids.forEach((awardId,i)=>db.awards.find(a=>a.id===awardId).order=i);
        e.revision++;audit('awards.reordered',user,id);persist();broadcast(id);
        return send(res,200,eventResponse(id,user,req));
      }
      const awardRoster=/^awards\/([a-f0-9-]+)\/participants$/.exec(action);
      if(awardRoster&&req.method==='PUT'){
        requireEditor(user,id,req);const body=await jsonBody(req);revision(body,e);
        const award=db.awards.find(a=>a.eventId===id&&a.id===awardRoster[1]);
        if(!award)fail(404,'Award not found.');
        if(award.status==='presented')fail(409,'Presented awards are locked.');
        award.participants=cleanParticipants(body.participants,award.participants||[]);
        e.revision++;audit('award.participants.updated',user,id,award.awardCode);
        persist();broadcast(id);return send(res,200,eventResponse(id,user,req));
      }
      const awardCheck=/^awards\/([a-f0-9-]+)\/participants\/([a-f0-9-]+)\/check$/.exec(action);
      if(awardCheck&&req.method==='POST'){
        requireLiveOperator(user,id);const body=await jsonBody(req);revision(body,e);
        if(typeof body.checkedIn!=='boolean')fail(400,'checkedIn must be boolean.');
        const award=db.awards.find(a=>a.eventId===id&&a.id===awardCheck[1]);
        if(!award)fail(404,'Award not found.');
        if(['presented','skipped'].includes(award.status))fail(409,'This award cannot be checked in.');
        const person=(award.participants||[]).find(x=>x.id===awardCheck[2]);
        if(!person)fail(404,'Award recipient not found.');
        if(person.checkedIn!==body.checkedIn){
          person.checkedIn=body.checkedIn;person.checkedAt=body.checkedIn?ISO():null;
          person.checkedBy=body.checkedIn?user.username:null;
          e.revision++;audit('award.participant.'+(body.checkedIn?'checked':'unchecked'),user,id,award.awardCode+' '+person.name);
          persist();broadcast(id);
        }
        return send(res,200,eventResponse(id,user,req));
      }
      const awardMatch=/^awards\/([a-f0-9-]+)$/.exec(action);
      if(awardMatch && ['PATCH','DELETE'].includes(req.method)) {
        const b=await jsonBody(req);revision(b,e);
        if(req.method==='PATCH' && Object.keys(b).every(k=>['revision','status'].includes(k))) requireLiveOperator(user,id);
        else requireEditor(user,id,req);
        const a=db.awards.find(x=>x.eventId===id&&x.id===awardMatch[1]);if(!a)fail(404,'Award not found.');
        if(req.method==='DELETE'){
          db.awards=db.awards.filter(x=>x.id!==a.id);
          eventAwards(id).forEach((x,i)=>x.order=i);
          audit('award.deleted',user,id,a.awardName);
        }else{
          if(['pending','ready','presented','skipped'].includes(b.status)) {
            a.status=b.status;a.presentedAt=b.status==='presented'?(a.presentedAt||ISO()):null;
          }
          if(['category','awardName','winnerName','recipientDetails','presenter','notes','employeeId','employeeName','contact'].some(k=>b[k]!==undefined)){
            Object.assign(a,awardInput({...a,...b}));
          }
          audit('award.updated',user,id,a.awardName);
        }
        e.revision++;persist();broadcast(id);return send(res,200,eventResponse(id,user,req));
      }
      if (action==='live' && req.method==='POST') {
        requireLiveOperator(user,id);const b=await jsonBody(req);revision(b,e);
        const programs=eventPrograms(id);
        const p=programs.find(x=>x.id===b.programId);if(!p)fail(404,'Program not found.');
        const actionName=String(b.action||'');
        const active=programs.find(x=>x.status==='running' || x.status==='paused');
        const now=ISO();
        if(actionName==='replay'){
          if(active)fail(409,'Finish or stop the active program before replaying another.');
          if(!['done','skipped','stopped'].includes(p.status))fail(409,'Only completed, skipped or stopped programs may be replayed.');
          p.actualStart=now;p.actualEnd=null;p.elapsedSeconds=0;p.resumedAt=now;p.status='running';e.status='live';
        }else if(actionName==='start'){
          if(active && active.id!==p.id)fail(409,'Finish or stop the active program before starting another.');
          if(!['pending','ready','stopped'].includes(p.status))fail(409,'Program cannot start from '+p.status+'.');
          p.actualStart=now;p.actualEnd=null;p.elapsedSeconds=0;p.resumedAt=now;p.status='running';e.status='live';
        }else if(actionName==='pause'){
          if(p.status!=='running')fail(409,'Only a running program can be paused.');
          p.elapsedSeconds=liveElapsed(p);p.resumedAt=null;p.status='paused';
        }else if(actionName==='resume'){
          if(active && active.id!==p.id)fail(409,'Another program is active.');
          if(p.status!=='paused')fail(409,'Only a paused program can be resumed.');
          p.resumedAt=now;p.status='running';
        }else if(actionName==='stop'){
          if(!['running','paused'].includes(p.status))fail(409,'Only an active program can be stopped.');
          p.elapsedSeconds=0;p.resumedAt=null;p.actualStart=null;p.actualEnd=null;p.status='stopped';
        }else if(actionName==='finish'){
          if(!['running','paused'].includes(p.status))fail(409,'Start a program before finishing it.');
          p.elapsedSeconds=liveElapsed(p);p.resumedAt=null;p.actualEnd=now;p.status='done';
        }else if(actionName==='skip'){
          if(active && active.id!==p.id && !['pending','ready','stopped'].includes(p.status))fail(409,'Stop or finish the active program first.');
          if(!['pending','ready','stopped','paused','running'].includes(p.status))fail(409,'Program cannot be skipped.');
          p.elapsedSeconds=liveElapsed(p);p.resumedAt=null;p.actualEnd=now;p.status='skipped';
        }else fail(400,'Invalid live action.');
        if(!programs.some(x=>['pending','ready','running','paused','stopped'].includes(x.status)))e.status='completed';
        e.revision++;audit('live.'+actionName,user,id,p.title);persist();broadcast(id);
        return send(res,200,eventResponse(id,user,req));
      }
      if (action==='reorder' && req.method==='POST') {
        requireLiveOperator(user,id);const b=await jsonBody(req);revision(b,e);
        const current=eventPrograms(id);const ids=b.ids;
        if(!Array.isArray(ids)||ids.length!==current.length||new Set(ids).size!==ids.length||!ids.every(x=>current.some(p=>p.id===x))) fail(400,'The order must contain every program exactly once.');
        // Moving a pending program ahead of the on-air program is an explicit skip,
        // never an implicit consequence of an ordinary reorder request.
        const active=current.find(p=>['running','paused'].includes(p.status));
        const activeIndex=active?ids.indexOf(active.id):-1;
        const skipBefore=activeIndex<0?[]:ids.slice(0,activeIndex).map(pid=>current.find(p=>p.id===pid))
          .filter(p=>['pending','ready','stopped'].includes(p.status));
        if(skipBefore.length && b.skipBeforeActive!==true)
          fail(409,'Moving pending programs ahead of the live program requires confirmation to skip them.');
        const now=ISO();
        for(const item of skipBefore){
          item.status='skipped';item.actualEnd=now;item.resumedAt=null;
          audit('live.skip.reorder',user,id,item.title);
        }
        ids.forEach((pid,i)=>db.programs.find(p=>p.id===pid).order=i);
        e.revision++;audit('programs.reordered',user,id);persist();broadcast(id);
        return send(res,200,eventResponse(id,user,req));
      }
      if (action==='programs' && req.method==='POST') {
        requireEditor(user,id,req);const b=await jsonBody(req);revision(b,e);validProgram(b);
        if(eventPrograms(id).some(p=>p.title.toLowerCase()===b.title.trim().toLowerCase())) fail(409,'Program title must be unique in this event.');
        const p={id:uid(),eventId:id,programCode:nextDisplayCode(e,'P'),participants:[],order:eventPrograms(id).length,title:b.title.trim().slice(0,150),type:b.type,duration:Number(b.duration),gap:Number(b.gap),presenter:String(b.presenter||'').slice(0,120),category:String(b.category||'General').slice(0,100),...personFields(b),notes:String(b.notes||'').slice(0,1000),sourceType:b.sourceType,source:b.sourceType==='url'||b.sourceType==='linked'?String(b.source||'').slice(0,2000):'',actualStart:null,actualEnd:null,status:'pending'};
        db.programs.push(p);e.revision++;audit('program.created',user,id,p.title);persist();broadcast(id);return send(res,201,eventResponse(id,user,req));
      }
      const participantListMatch=/^programs\/([a-f0-9-]+)\/participants$/.exec(action);
      if(participantListMatch&&req.method==='PUT'){
        requireEditor(user,id,req);const body=await jsonBody(req);revision(body,e);
        const p=db.programs.find(x=>x.eventId===id&&x.id===participantListMatch[1]);
        if(!p)fail(404,'Program not found.');
        p.participants=cleanParticipants(body.participants,p.participants||[]);
        e.revision++;audit('participants.updated',user,id,p.programCode+' '+p.title);persist();broadcast(id);
        return send(res,200,eventResponse(id,user,req));
      }
      const checkMatch=/^programs\/([a-f0-9-]+)\/participants\/([a-f0-9-]+)\/check$/.exec(action);
      if(checkMatch&&req.method==='POST'){
        requireLiveOperator(user,id);const body=await jsonBody(req);revision(body,e);
        if(typeof body.checkedIn!=='boolean')fail(400,'checkedIn must be a boolean.');
        const p=db.programs.find(x=>x.eventId===id&&x.id===checkMatch[1]);
        if(!p)fail(404,'Program not found.');
        const row=(p.participants||[]).find(x=>x.id===checkMatch[2]);
        if(!row)fail(404,'Participant not found.');
        if(row.checkedIn!==body.checkedIn){
          row.checkedIn=body.checkedIn;
          row.checkedAt=body.checkedIn?ISO():null;
          row.checkedBy=body.checkedIn?user.username:null;
          e.revision++;audit('participant.'+(body.checkedIn?'checked':'unchecked'),user,id,p.programCode+' '+row.name);persist();broadcast(id);
        }
        return send(res,200,eventResponse(id,user,req));
      }
      const restoreMatch=/^programs\/([a-f0-9-]+)\/restore$/.exec(action);
      if(restoreMatch && req.method==='POST'){
        requireLiveOperator(user,id);const b=await jsonBody(req);revision(b,e);
        const all=eventPrograms(id),p=all.find(x=>x.id===restoreMatch[1]);
        if(!p)fail(404,'Program not found.');
        if(p.status!=='skipped')fail(409,'Only skipped programs can be restored to upcoming.');
        const active=all.find(x=>['running','paused'].includes(x.status));
        const remaining=all.filter(x=>x.id!==p.id);
        let position=active?remaining.findIndex(x=>x.id===active.id)+1:
          remaining.findIndex(x=>['pending','ready','stopped'].includes(x.status));
        if(position<0)position=remaining.length;
        remaining.splice(position,0,p);
        p.status='pending';p.actualStart=null;p.actualEnd=null;p.resumedAt=null;p.elapsedSeconds=0;
        remaining.forEach((item,index)=>item.order=index);
        if(e.status==='completed')e.status='ready';
        e.revision++;audit('live.restore',user,id,p.title);persist();broadcast(id);
        return send(res,200,eventResponse(id,user,req));
      }
      const archiveMatch=/^programs\/([a-f0-9-]+)\/archive$/.exec(action);
      if(archiveMatch && req.method==='POST'){
        requireEditor(user,id,req);const b=await jsonBody(req);revision(b,e);
        const p=db.programs.find(x=>x.id===archiveMatch[1]&&x.eventId===id);
        if(!p)fail(404,'Program not found.');
        if(!['media','script'].includes(b.kind))fail(400,'Invalid archive kind.');
        archiveSource(p,b.kind);
        e.revision++;audit('source.archived',user,id,p.title+' '+b.kind);persist();broadcast(id);
        return send(res,200,eventResponse(id,user,req));
      }
      const programMatch=/^programs\/([a-f0-9-]+)$/.exec(action);
      if(programMatch && ['PATCH','DELETE'].includes(req.method)) {
        requireEditor(user,id,req);const p=db.programs.find(p=>p.id===programMatch[1]&&p.eventId===id);
        if(!p) fail(404,'Program not found.');const b=await jsonBody(req);revision(b,e);
        if(req.method==='DELETE') {db.programs=db.programs.filter(x=>x.id!==p.id);eventPrograms(id).forEach((x,i)=>x.order=i);audit('program.deleted',user,id,p.title);}
        else {
          const changed={...p,...b};validProgram(changed);
          if(eventPrograms(id).some(x=>x.id!==p.id && x.title.toLowerCase()===changed.title.trim().toLowerCase())) fail(409,'Program title must be unique in this event.');
          if(p.sourceType==='file'&&p.source&&changed.sourceType!=='file')archiveSource(p,'media');
          Object.assign(p,{title:changed.title.trim().slice(0,150),type:changed.type,duration:Number(changed.duration),gap:Number(changed.gap),presenter:String(changed.presenter||'').slice(0,120),category:String(changed.category||'General').slice(0,100),...personFields(changed),notes:String(changed.notes||'').slice(0,1000),sourceType:changed.sourceType,source:changed.sourceType==='url'||changed.sourceType==='linked'?String(changed.source||'').slice(0,2000):changed.sourceType==='file'?p.source:'',status:['pending','ready','running','done','skipped'].includes(changed.status)?changed.status:p.status,actualStart:changed.actualStart===undefined?p.actualStart:changed.actualStart,actualEnd:changed.actualEnd===undefined?p.actualEnd:changed.actualEnd});
          audit('program.updated',user,id,p.title);
        }
        e.revision++;persist();broadcast(id);return send(res,200,eventResponse(id,user,req));
      }
      if (!action && req.method==='PATCH') {
        requireEditor(user,id,req);const b=await jsonBody(req);revision(b,e);
        if(b.title!==undefined) {
          if(!String(b.title).trim()) fail(400,'Title cannot be blank.');
          if(db.events.some(x=>x.id!==id&&x.title.toLowerCase()===String(b.title).trim().toLowerCase())) fail(409,'Event title must be unique.');
          e.title=String(b.title).trim().slice(0,120);
        }
        for(const f of ['date','start','venue','organizer','description']) if(b[f]!==undefined)e[f]=String(b[f]).slice(0,1200);
        if(b.status!==undefined&&['draft','ready','live','completed'].includes(b.status)) e.status=b.status;
        if(b.catalogs!==undefined)e.catalogs=cleanCatalogs(b.catalogs);
        e.revision++;audit('event.updated',user,id);persist();broadcast(id);return send(res,200,eventResponse(id,user,req));
      }
      if(!action&&req.method==='DELETE'){
        requireEditor(user,id,req);const b=await jsonBody(req);revision(b,e);
        db.events=db.events.filter(x=>x.id!==id);db.programs=db.programs.filter(x=>x.eventId!==id);db.awards=db.awards.filter(x=>x.eventId!==id);leases.delete(id);audit('event.deleted',user,id,e.title);persist();broadcast(id);return send(res,200,{ok:true});
      }
    }
    if (route==='/api/users') {
      need(user,['admin']);
      if(req.method==='GET') return send(res,200,{users:db.users.map(publicUser)});
      if(req.method==='POST') {
        const b=await jsonBody(req);
        const username=String(b.username||'').trim();
        if(!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)||String(b.password||'').length<8) fail(400,'Username must be 3–32 safe characters; password must be at least 8 characters.');
        if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase())) fail(409,'Username already exists.');
        if(!['admin','editor','live_controller','viewer'].includes(b.role)) fail(400,'Invalid role.');
        const u={id:uid(),username,name:String(b.name||username).slice(0,100),password:hash(b.password),role:b.role,active:true};
        db.users.push(u);audit('user.created',user,null,username);persist();return send(res,201,{user:publicUser(u)});
      }
    }
    const uMatch=/^\/api\/users\/([a-f0-9-]+)$/.exec(route);
    if(uMatch&&req.method==='PATCH'){
      need(user,['admin']);const u=db.users.find(x=>x.id===uMatch[1]);if(!u)fail(404,'User not found.');
      const b=await jsonBody(req);
      if(b.role!==undefined){if(!['admin','editor','live_controller','viewer'].includes(b.role))fail(400,'Invalid role.');if(u.id===user.id&&b.role!=='admin')fail(400,'Cannot remove your own admin role.');u.role=b.role;}
      if(b.active!==undefined){if(u.id===user.id&&b.active===false)fail(400,'Cannot disable yourself.');u.active=!!b.active;}
      if(b.name!==undefined)u.name=String(b.name).slice(0,100);
      if(b.password!==undefined){if(String(b.password).length<8)fail(400,'Password requires at least 8 characters.');u.password=hash(b.password);}
      audit('user.updated',user,null,u.username);persist();return send(res,200,{user:publicUser(u)});
    }
    if(route==='/api/stream') {
      need(user);
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.write('event: ready\ndata: {"connected":true}\n\n');
      clients.add(res);
      // IncomingMessage 'close' may fire as soon as the request is fully received.
      // Track the response lifetime, otherwise event subscribers vanish immediately.
      res.on('close',()=>clients.delete(res));
      return;
    }
    const mediaMatch=/^\/media\/([a-f0-9-]+)\/([a-zA-Z0-9._-]+)$/.exec(route);
    if(mediaMatch&&['GET','HEAD'].includes(req.method)) {
      need(user);
      const relative=mediaMatch[1]+'/'+mediaMatch[2];
      if(!db.programs.some(p=>{
       const event=db.events.find(e=>e.id===p.eventId);
       if(event?.isDemo&&!db.settings.demoEnabled&&user.role!=='admin')return false;
       return (p.sourceType==='file'&&p.source===relative)||p.scriptSource===relative||
         (p.sourceArchive||[]).some(a=>a.path===relative);
      })) fail(404,'File not registered.');
      const file=path.join(MEDIA,relative);if(!fs.existsSync(file))fail(404,'Missing file.');
      return streamFile(req,res,file,true);
    }
    if(['GET','HEAD'].includes(req.method) && (route==='/' || /^\/(index\.html|manifest\.webmanifest|app\.js|extensions\.js|v12\.js|v13\.js|v14\.js|v15\.js|v16\.js|v17\.js|v18\.js|v19\.js|v20\.js|v21\.js|sw\.js|style\.css|icon\.svg)$/.test(route))) {
      const name=route==='/'?'index.html':route.slice(1);
      const file=path.join(PUBLIC,name);if(!fs.existsSync(file))fail(404,'Asset not found.');
      return streamFile(req,res,file,false,route!=='/'&&route!=='/index.html'&&route!=='/sw.js');
    }
    return send(res,404,{error:'Route not found.'});
  } catch(err) {
    console.error(err.status||500,err.message);
    if(!res.headersSent)send(res,err.status||500,{error:err.status?err.message:'Internal server error.'});
    else res.destroy();
  }
});
server.listen(PORT,HOST,()=>console.log('EventFlow at http://'+HOST+':'+PORT+' | data: '+ROOT));
setInterval(()=>{for(const [token,s] of sessions)if(s.expiry<time())sessions.delete(token);for(const [id] of leases)if(!leaseOf(id))broadcast(id);for(const c of clients){try{c.write(': ping\n\n');}catch{clients.delete(c);}}},30000).unref();
