'use strict';
function ef15SkippedPanel(){
 const c=current(),queue=$('#v12LiveQueue');if(!c||!queue)return;
 let section=$('#ef15SkippedPanel');
 if(!section){
  section=document.createElement('section');
  section.id='ef15SkippedPanel';section.className='card ef15-skipped-panel';
  queue.closest('.card')?.insertAdjacentElement('afterend',section);
 }
 const items=c.programs.filter(p=>p.status==='skipped');
 section.innerHTML='<div class="card-title"><h3>Skipped programs ('+items.length+')</h3><span class="muted tiny">Separate from live running order</span></div>'+
 (items.length?'<div class="v12-queue">'+items.map(p=>
 '<div class="v12-live-row ef14-status-row ef14-skipped"><span class="program-num">'+(p.order+1)+'</span>'+
 '<div class="v12-live-info"><strong>'+esc(p.title)+'</strong><small>'+esc(p.category||'General')+' · '+esc(p.type||'Program')+'</small></div>'+
 '<span class="ef14-status ef14-status-skipped">Skipped</span>'+
 (ef14RoleCanOperate()?'<button type="button" class="secondary" data-restore="'+esc(p.id)+'">Restore to Upcoming</button>':'')+
 '</div>').join('')+'</div>':'<p class="muted tiny">No skipped programs.</p>');
 $$('[data-restore]',section).forEach(btn=>btn.onclick=()=>act(async()=>{
  btn.disabled=true;
  const currentView=current(),item=currentView?.programs.find(x=>x.id===btn.dataset.restore);
  if(!item||item.status!=='skipped')return;
  const response=await api('/api/events/'+currentView.event.id+'/programs/'+item.id+'/restore','POST',{revision:currentView.event.revision});
  state.current=response;renderLive();toast('Restored '+item.title+' to Upcoming.');
 }));
}
const ef15OldQueue=v12RenderQueue;
v12RenderQueue=function(){ef15OldQueue();ef15SkippedPanel()};
