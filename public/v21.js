'use strict';
// Safe fast-start on HTTPS: cache only immutable UI files, never event data/media/sessions.
if('serviceWorker' in navigator &&
   (location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
 window.addEventListener('load',()=>{
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
 },{once:true});
}
window.addEventListener('offline',()=>{
 const connection=document.querySelector('#connectionStatus');
 if(connection)connection.textContent='Offline — changes unavailable';
});
window.addEventListener('online',()=>{
 const connection=document.querySelector('#connectionStatus');
 if(connection&&state?.user)connection.textContent='Reconnecting…';
});
