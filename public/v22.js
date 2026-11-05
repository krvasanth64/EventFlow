'use strict';
// V1.5.2 — Fast event-first login, event-scoped multi-user warnings,
// and admin-only event lifecycle. No database conversion.
let ef22Alert=null,ef22LastAlertKey='';
const ef22LiveActions=new Set([
 'live.start','live.pause','live.resume','live.stop','live.finish',
 'live.skip','live.replay','live.restore','live.reorder','award.status',
 'award.presented','award.reordered','program.reordered'
]);
function ef22RelevantChange(action){
 const a=String(action||'');
 return a.startsWith('live.')||a.startsWith('program.')||
  a.startsWith('award.')||a==='event.reorder'||a==='event.section.import';
}
function ef22ReportEventChange(before,after,actor){
 if(!before||!after||before.event?.id!==after.event?.id)return;
 if(state.page!=='live')return; // Changes on other screens are silently synchronized.
 if(before.event.revision===after.event.revision)return;
 const oldTop=before.history?.[0]?.id;
 const latest=after.history?.[0];
 if(!latest||latest.id===oldTop||!ef22RelevantChange(latest.action))return;
 const who=actor||latest.user;
 if(!who||who===state.user?.username||who==='system')return;
 const token=after.event.id+'|'+after.event.revision+'|'+latest.id;
 if(ef22LastAlertKey===token)return;
 ef22LastAlertKey=token;
 ef22Alert={eventId:after.event.id,actor:who,action:latest.action,
   at:Date.now(),message:'Another operator ('+who+') updated this event. The Live Control data was refreshed.'};
 toast(ef22Alert.message);
}
function ef22ShowNotice(){
 const root=document.querySelector('#v12LiveRoot');
 const page=document.querySelector('#pageLive');
 const old=page?.querySelector('#ef22LiveNotice');
 if(!root||!page){old?.remove();return;}
 if(!ef22Alert||ef22Alert.eventId!==current()?.event?.id||
   Date.now()-ef22Alert.at>120000){old?.remove();return;}
 const notice=old||document.createElement('div');
 notice.id='ef22LiveNotice';notice.className='ef22-live-notice';
 notice.innerHTML='<span><strong>Other operator update:</strong> '+
   esc(ef22Alert.message)+' <small>Review the current order before making the next change.</small></span>'+
   '<button type="button" class="secondary" id="ef22DismissNotice">Dismiss</button>';
 if(!old)root.parentNode.insertBefore(notice,root);
 notice.querySelector('button').onclick=()=>{ef22Alert=null;notice.remove()};
}
const ef22RenderLiveOriginal=renderLive;
renderLive=function(){ef22RenderLiveOriginal();ef22ShowNotice()};

let ef22ManageFetch=0;
function ef22RenderEventManagement(){
 if(state.user?.role!=='admin')return;
 const host=document.querySelector('#pageManage');if(!host)return;
 const token=++ef22ManageFetch;
 host.innerHTML=pageHead('ADMINISTRATION','Event Management',
   'Archive completed events, restore inactive events, or permanently delete archived events.')+
   '<div class="card"><div class="card-title"><h3>All events</h3>'+
   '<button class="secondary" id="ef22BackupAll" type="button">Download full backup</button></div>'+
   '<div id="ef22ManageRows" class="ef22-manage-rows"><p class="muted">Loading event summaries…</p></div></div>';
 document.querySelector('#ef22BackupAll').onclick=()=>
   window.open('/api/backup/full','_blank','noopener');
 act(async()=>{
  const x=await api('/api/admin/events');
  if(token!==ef22ManageFetch||state.page!=='manage')return;
  const rows=host.querySelector('#ef22ManageRows');if(!rows)return;
  const data=x.events||[];
  rows.innerHTML=data.length?data.map(e=>
   '<article class="ef22-manage-row" data-event-id="'+esc(e.id)+'">'+
   '<div class="ef22-manage-main"><div class="ef22-manage-title"><strong>'+esc(e.title)+'</strong>'+
   '<span class="ef22-state '+(e.isArchived?'ef22-archived':'ef22-active')+'">'+
     (e.isArchived?'Archived':'Active')+'</span></div>'+
   '<p class="muted tiny">'+esc(e.date)+' · '+esc(e.status)+' · '+
      Number(e.programCount||0)+' Programs · '+Number(e.awardCount||0)+' Awards</p></div>'+
   '<div class="ef22-manage-actions">'+
   (e.isArchived?
    '<button class="secondary" type="button" data-restore="'+esc(e.id)+'">Restore</button>'+
    '<button class="ef22-delete" type="button" data-purge="'+esc(e.id)+'">Permanently delete</button>':
    '<button class="secondary" type="button" data-archive="'+esc(e.id)+'"'+
    (e.status==='live'?' disabled title="Finish live event first"':'')+'>Archive / Inactive</button>')+
   '</div></article>').join(''):
   '<div class="empty">No events registered.</div>';
  async function perform(id,archived){
   const event=data.find(x=>x.id===id);if(!event)return;
   const verb=archived?'archive':'restore';
   if(!confirm('Do you want to '+verb+' "'+event.title+'"?'))return;
   await api('/api/events/'+id+'/admin/archive','POST',{revision:event.revision,archived});
   if(archived&&state.current?.event.id===id){
    state.current=null;state.editing=false;state.selected=null;
    try{localStorage.removeItem('eventflow.activeEvent')}catch{}
   }
   await refreshEvents();ef22RenderEventManagement();toast('Event '+(archived?'archived':'restored')+'.');
  }
  rows.querySelectorAll('[data-archive]').forEach(btn=>btn.onclick=()=>act(()=>perform(btn.dataset.archive,true)));
  rows.querySelectorAll('[data-restore]').forEach(btn=>btn.onclick=()=>act(()=>perform(btn.dataset.restore,false)));
  rows.querySelectorAll('[data-purge]').forEach(btn=>btn.onclick=()=>act(async()=>{
   const event=data.find(x=>x.id===btn.dataset.purge);if(!event)return;
   const name=prompt('PERMANENT DELETE: First download the full event backup.\n'+
     'All event records and uploaded media may be lost.\n\nType the EXACT event title to confirm:', '');
   if(name===null)return;
   if(name!==event.title){toast('Event title did not match. Nothing was deleted.');return;}
   if(!confirm('Final confirmation: permanently delete "'+event.title+'"? This cannot be undone.'))return;
   await api('/api/events/'+event.id+'/admin/purge','POST',
     {revision:event.revision,confirmTitle:name});
   if(state.current?.event.id===event.id){
    state.current=null;state.editing=false;state.selected=null;
    try{localStorage.removeItem('eventflow.activeEvent')}catch{}
   }
   await refreshEvents();ef22RenderEventManagement();toast('Event permanently deleted.');
  }));
 });
}
