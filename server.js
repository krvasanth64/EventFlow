'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const ROOT = path.resolve(process.env.EVENTFLOW_DATA || path.join(__dirname, 'runtime'));
const DB = path.join(ROOT, 'data.json');
const MEDIA = path.join(ROOT, 'media');
const BACKUPS = path.join(ROOT, 'backups');
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '127.0.0.1';
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
const fresh = () => ({ version: 1, revision: 0, users: [], events: [], programs: [], history: [] });
let db = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : fresh();
// Backward-compatible additions: existing runtime/data.json requires no migration.
if (!Array.isArray(db.awards)) db.awards = [];
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
const seedAdmin = process.env.EVENTFLOW_ADMIN_PASSWORD;
if (!db.users.length && seedAdmin) {
  db.users.push({ id: uid(), username: process.env.EVENTFLOW_ADMIN_USER || 'admin', name: 'Administrator', role: 'admin', active: true, password: hash(seedAdmin) });
  persist();
  console.log('Initial admin account created. Remove the password variable from future startup configurations.');
}
if (!db.users.length) console.warn('SETUP REQUIRED: Set EVENTFLOW_ADMIN_PASSWORD before starting. No default password is embedded.');
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
function userOf(req) {
  const token = cookie(req, 'ef_session');
  const s = sessions.get(token);
  if (!s || s.expiry < time()) return null;
  return db.users.find(x => x.id === s.userId && x.active) || null;
}
function send(res, status, body, headers = {}) {
  const isObject = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isObject ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers });
  res.end(isObject ? JSON.stringify(body) : body);
}
const fail = (status, message) => { const err = new Error(message); err.status = status; throw err; };
function need(user, roles) {
  if (!user) fail(401, 'Please sign in.');
  if (roles && !roles.includes(user.role)) fail(403, 'Insufficient permission.');
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
const liveElapsed = (p, now = time()) => Math.max(0, Number(p.elapsedSeconds)||0) + (p.status==='running' && p.resumedAt ? Math.max(0,(now-Date.parse(p.resumedAt))/1000) : 0);
const awardInput = b => {
  const category=String(b.category||'').trim().slice(0,100);
  const awardName=String(b.awardName||'').trim().slice(0,160);
  const winnerName=String(b.winnerName||'').trim().slice(0,160);
  if (!category || !awardName || !winnerName) fail(400,'Category, award name, and winner are required.');
  return {category,awardName,winnerName,recipientDetails:String(b.recipientDetails||'').slice(0,200),
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
  if (!['speech','dance','music','video','ceremony','break','other'].includes(p.type)) fail(400,'Invalid program type.');
  if (!['none','file','url','linked'].includes(p.sourceType)) fail(400,'Invalid source type.');
  if (p.sourceType === 'url' && !/^https?:\/\//i.test(String(p.source || ''))) fail(400, 'Enter an http/https URL.');
}
function eventResponse(id, user, req) {
  const e = byEvent(id); if (!e) fail(404,'Event not found.');
  const lock = leaseOf(id);
  return { event:e, programs:eventPrograms(id), awards:eventAwards(id), history:db.history.filter(h => h.eventId === id).slice(0,30),
    lock: lock ? { user:db.users.find(u => u.id===lock.userId)?.name || 'Unknown', mine:isEditor(user,id,cookie(req,'ef_session')), expires:lock.expires } : null };
}
const mime = ext => ({ '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.mp3':'audio/mpeg','.mp4':'video/mp4','.webm':'video/webm','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4','.mov':'video/quicktime','.pdf':'application/pdf','.webmanifest':'application/manifest+json' })[ext] || 'application/octet-stream';
function streamFile(req, res, file, allowRange=false) {
  const stat = fs.statSync(file); const type = mime(path.extname(file).toLowerCase());
  const h = { 'Content-Type':type, 'Accept-Ranges': allowRange ? 'bytes':'none', 'X-Content-Type-Options':'nosniff' };
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
    const user = userOf(req);
    if (route === '/api/health') return send(res,200,{ ok:true, users:db.users.length, revision:db.revision });
    if (route === '/api/login' && req.method==='POST') {
      const body = await jsonBody(req);
      const u = db.users.find(u => u.username.toLowerCase() === String(body.username || '').toLowerCase() && u.active);
      if (!u || !checkPassword(body.password, u.password)) fail(401,'Invalid username or password.');
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token,{userId:u.id,expiry:time()+SESSION_AGE});
      return send(res,200,{user:publicUser(u)}, {'Set-Cookie':'ef_session='+token+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200'});
    }
    if (route === '/api/logout' && req.method==='POST') {
      sessions.delete(cookie(req,'ef_session'));
      for(const [id,l] of leases) if(l.token===cookie(req,'ef_session')) { leases.delete(id); broadcast(id); }
      return send(res,200,{ok:true},{'Set-Cookie':'ef_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
    }
    if (route === '/api/me') { need(user); return send(res,200,{user:publicUser(user), settings:{port:PORT, mediaRoot:MEDIA}}); }
    if (route === '/api/events' && req.method==='GET') { need(user); return send(res,200,{events:db.events.map(e=>({...e,programCount:eventPrograms(e.id).length})).sort((a,b)=>b.date.localeCompare(a.date))}); }
    if (route === '/api/events' && req.method==='POST') {
      need(user,['admin','editor']); const b=await jsonBody(req);
      if(!String(b.title||'').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date||'')) || !/^\d{2}:\d{2}$/.test(String(b.start||''))) fail(400,'Title, date, and start time are required.');
      if(db.events.some(e=>e.title.toLowerCase()===b.title.trim().toLowerCase())) fail(409,'Event title must be unique.');
      const e={id:uid(),title:b.title.trim().slice(0,120),date:b.date,start:b.start,venue:String(b.venue||'').slice(0,150),organizer:String(b.organizer||'').slice(0,150),description:String(b.description||'').slice(0,1200),status:'draft',revision:1, createdAt:new Date().toISOString()};
      db.events.push(e); audit('event.created',user,e.id,e.title);persist();broadcast(e.id);return send(res,201,{event:e});
    }
    const eventMatch = /^\/api\/events\/([a-f0-9-]+)(?:\/(.*))?$/.exec(route);
    if (eventMatch) {
      need(user);const id=eventMatch[1], action=eventMatch[2] || '';
      const e=byEvent(id);if(!e) fail(404,'Event not found.');
      if (!action && req.method==='GET') return send(res,200,eventResponse(id,user,req));
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
      if (action==='media' && req.method==='POST') {
        requireEditor(user,id,req);
        const expectedRevision=Number(url.searchParams.get('revision'));
        if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==e.revision) fail(409,'The event changed during upload. Refresh and retry.');
        const programId=url.searchParams.get('program');
        const p=db.programs.find(p=>p.id===programId&&p.eventId===id);
        if(!p) fail(404,'Program not found.');
        const raw=url.searchParams.get('filename')||'media.bin';
        const ext=path.extname(raw).toLowerCase();
        if(!['.mp3','.mp4','.webm','.wav','.ogg','.m4a','.mov'].includes(ext)) fail(400,'Unsupported audio/video extension.');
        const length=Number(req.headers['content-length']);
        if(!Number.isSafeInteger(length)||length<1||length>MAX_UPLOAD) fail(413,'Upload must have a valid Content-Length and fit within size limit.');
        const folder=path.join(MEDIA,id);fs.mkdirSync(folder,{recursive:true});
        const fileName=safe(p.id.slice(0,8)+'_'+p.title)+ext;const target=path.join(folder,fileName);const temp=target+'.part-'+uid();
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
        p.sourceType='file';p.source=path.relative(MEDIA,target).replace(/\\/g,'/');p.sourceName=raw.slice(0,255);e.revision++;audit('media.uploaded',user,id,p.title);persist();broadcast(id);
        return send(res,200,{program:p,revision:e.revision});
      }
      // Award plan is independent of the chronological program schedule.
      if (action==='awards' && req.method==='POST') {
        requireEditor(user,id,req);const b=await jsonBody(req);revision(b,e);
        const details=awardInput(b);
        const award={id:uid(),eventId:id,order:eventAwards(id).length,...details,status:'pending',presentedAt:null};
        db.awards.push(award);e.revision++;audit('award.created',user,id,award.awardName);
        persist();broadcast(id);return send(res,201,eventResponse(id,user,req));
      }
      if (action==='awards/reorder' && req.method==='POST') {
        requireEditor(user,id,req);const b=await jsonBody(req);revision(b,e);
        const awards=eventAwards(id);
        if(!Array.isArray(b.ids)||b.ids.length!==awards.length||new Set(b.ids).size!==b.ids.length||
          !b.ids.every(x=>awards.some(a=>a.id===x)))fail(400,'Award order must include every award exactly once.');
        b.ids.forEach((awardId,i)=>db.awards.find(a=>a.id===awardId).order=i);
        e.revision++;audit('awards.reordered',user,id);persist();broadcast(id);
        return send(res,200,eventResponse(id,user,req));
      }
      const awardMatch=/^awards\/([a-f0-9-]+)$/.exec(action);
      if(awardMatch && ['PATCH','DELETE'].includes(req.method)) {
        requireEditor(user,id,req);const b=await jsonBody(req);revision(b,e);
        const a=db.awards.find(x=>x.eventId===id&&x.id===awardMatch[1]);if(!a)fail(404,'Award not found.');
        if(req.method==='DELETE'){
          db.awards=db.awards.filter(x=>x.id!==a.id);
          eventAwards(id).forEach((x,i)=>x.order=i);
          audit('award.deleted',user,id,a.awardName);
        }else{
          if(['pending','ready','presented','skipped'].includes(b.status)) {
            a.status=b.status;a.presentedAt=b.status==='presented'?(a.presentedAt||ISO()):null;
          }
          if(['category','awardName','winnerName','recipientDetails','presenter','notes'].some(k=>b[k]!==undefined)){
            Object.assign(a,awardInput({...a,...b}));
          }
          audit('award.updated',user,id,a.awardName);
        }
        e.revision++;persist();broadcast(id);return send(res,200,eventResponse(id,user,req));
      }
      if (action==='live' && req.method==='POST') {
        requireEditor(user,id,req);const b=await jsonBody(req);revision(b,e);
        const programs=eventPrograms(id);
        const p=programs.find(x=>x.id===b.programId);if(!p)fail(404,'Program not found.');
        const actionName=String(b.action||'');
        const active=programs.find(x=>x.status==='running' || x.status==='paused');
        const now=ISO();
        if(actionName==='start'){
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
          if(active && active.id!==p.id)fail(409,'Stop or finish the active program first.');
          if(!['pending','ready','stopped','paused','running'].includes(p.status))fail(409,'Program cannot be skipped.');
          p.elapsedSeconds=liveElapsed(p);p.resumedAt=null;p.actualEnd=now;p.status='skipped';
        }else fail(400,'Invalid live action.');
        if(!programs.some(x=>['pending','ready','running','paused','stopped'].includes(x.status)))e.status='completed';
        e.revision++;audit('live.'+actionName,user,id,p.title);persist();broadcast(id);
        return send(res,200,eventResponse(id,user,req));
      }
      if (action==='reorder' && req.method==='POST') {
        requireEditor(user,id,req);const b=await jsonBody(req);revision(b,e);
        const current=eventPrograms(id);const ids=b.ids;
        if(!Array.isArray(ids)||ids.length!==current.length||new Set(ids).size!==ids.length||!ids.every(x=>current.some(p=>p.id===x))) fail(400,'The order must contain every program exactly once.');
        ids.forEach((pid,i)=>db.programs.find(p=>p.id===pid).order=i);
        e.revision++;audit('programs.reordered',user,id);persist();broadcast(id);
        return send(res,200,eventResponse(id,user,req));
      }
      if (action==='programs' && req.method==='POST') {
        requireEditor(user,id,req);const b=await jsonBody(req);revision(b,e);validProgram(b);
        if(eventPrograms(id).some(p=>p.title.toLowerCase()===b.title.trim().toLowerCase())) fail(409,'Program title must be unique in this event.');
        const p={id:uid(),eventId:id,order:eventPrograms(id).length,title:b.title.trim().slice(0,150),type:b.type,duration:Number(b.duration),gap:Number(b.gap),presenter:String(b.presenter||'').slice(0,120),notes:String(b.notes||'').slice(0,1000),sourceType:b.sourceType,source:b.sourceType==='url'||b.sourceType==='linked'?String(b.source||'').slice(0,2000):'',actualStart:null,actualEnd:null,status:'pending'};
        db.programs.push(p);e.revision++;audit('program.created',user,id,p.title);persist();broadcast(id);return send(res,201,eventResponse(id,user,req));
      }
      const programMatch=/^programs\/([a-f0-9-]+)$/.exec(action);
      if(programMatch && ['PATCH','DELETE'].includes(req.method)) {
        requireEditor(user,id,req);const p=db.programs.find(p=>p.id===programMatch[1]&&p.eventId===id);
        if(!p) fail(404,'Program not found.');const b=await jsonBody(req);revision(b,e);
        if(req.method==='DELETE') {db.programs=db.programs.filter(x=>x.id!==p.id);eventPrograms(id).forEach((x,i)=>x.order=i);audit('program.deleted',user,id,p.title);}
        else {
          const changed={...p,...b};validProgram(changed);
          if(eventPrograms(id).some(x=>x.id!==p.id && x.title.toLowerCase()===changed.title.trim().toLowerCase())) fail(409,'Program title must be unique in this event.');
          Object.assign(p,{title:changed.title.trim().slice(0,150),type:changed.type,duration:Number(changed.duration),gap:Number(changed.gap),presenter:String(changed.presenter||'').slice(0,120),notes:String(changed.notes||'').slice(0,1000),sourceType:changed.sourceType,source:changed.sourceType==='url'||changed.sourceType==='linked'?String(changed.source||'').slice(0,2000):changed.sourceType==='file'?p.source:'',status:['pending','ready','running','done','skipped'].includes(changed.status)?changed.status:p.status,actualStart:changed.actualStart===undefined?p.actualStart:changed.actualStart,actualEnd:changed.actualEnd===undefined?p.actualEnd:changed.actualEnd});
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
        if(!['admin','editor','viewer'].includes(b.role)) fail(400,'Invalid role.');
        const u={id:uid(),username,name:String(b.name||username).slice(0,100),password:hash(b.password),role:b.role,active:true};
        db.users.push(u);audit('user.created',user,null,username);persist();return send(res,201,{user:publicUser(u)});
      }
    }
    const uMatch=/^\/api\/users\/([a-f0-9-]+)$/.exec(route);
    if(uMatch&&req.method==='PATCH'){
      need(user,['admin']);const u=db.users.find(x=>x.id===uMatch[1]);if(!u)fail(404,'User not found.');
      const b=await jsonBody(req);
      if(b.role!==undefined){if(!['admin','editor','viewer'].includes(b.role))fail(400,'Invalid role.');if(u.id===user.id&&b.role!=='admin')fail(400,'Cannot remove your own admin role.');u.role=b.role;}
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
      if(!db.programs.some(p=>p.sourceType==='file'&&p.source===relative)) fail(404,'File not registered.');
      const file=path.join(MEDIA,relative);if(!fs.existsSync(file))fail(404,'Missing file.');
      return streamFile(req,res,file,true);
    }
    if(['GET','HEAD'].includes(req.method) && (route==='/' || /^\/(index\.html|manifest\.webmanifest|app\.js|extensions\.js|style\.css|icon\.svg)$/.test(route))) {
      const name=route==='/'?'index.html':route.slice(1);
      const file=path.join(PUBLIC,name);if(!fs.existsSync(file))fail(404,'Asset not found.');
      return streamFile(req,res,file);
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
