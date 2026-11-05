'use strict';
// EventFlow performance cache: ONLY versioned, public static UI assets.
// Sensitive APIs, sessions, SSE, media, reports and live state are NEVER cached.
const CACHE='eventflow-static-v1.5.1';
const PUBLIC_PATHS=new Set([
 '/style.css','/app.js','/extensions.js','/v12.js','/v13.js','/v14.js',
 '/v15.js','/v16.js','/v17.js','/v18.js','/v19.js','/v20.js','/v21.js',
 '/icon.svg','/manifest.webmanifest'
]);
self.addEventListener('install',event=>{event.waitUntil(self.skipWaiting())});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('eventflow-static-')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.origin!==self.location.origin)return;
 // Never cache HTML or dynamic/private endpoints; preserve authentication semantics.
 if(!PUBLIC_PATHS.has(url.pathname))return;
 const versioned=url.searchParams.has('v');
 if(!versioned&&url.pathname!=='/icon.svg'&&url.pathname!=='/manifest.webmanifest')return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  const found=await cache.match(req);
  if(found)return found;
  const response=await fetch(req);
  if(response.ok&&response.type==='basic'&&response.headers.get('Cache-Control')?.includes('public')){
   event.waitUntil(cache.put(req,response.clone()));
  }
  return response;
 })());
});
