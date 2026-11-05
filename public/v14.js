'use strict';
/* V1.4.1: precise clock, on-air status, safe reordering, LED view and mobile drawer. */
const ef14Time=seconds=>{
 const n=Math.max(0,Math.ceil(Number(seconds)||0));
 return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
};
const ef14RoleCanOperate=()=>['admin','editor','live_controller'].includes(state.user?.role);
const ef14Status=p=>p.status==='running'?'running':p.status==='paused'?'paused':
 p.status==='done'||p.status==='presented'?'done':p.status==='skipped'?'skipped':'upcoming';
const ef14Badge=p=>'<span class="ef14-status ef14-status-'+ef14Status(p)+'">'+esc(p.status)+'</span>';
function ef14Timeline(){
 const c=current(),host=$('#pageTimeline');if(!host)return;
 if(!c){host.innerHTML='<div class="empty">Select an event from the event picker.</div>';return;}
 const arr=c.programs||[],active=arr.find(p=>['running','paused'].includes(p.status));
 const previous=arr.filter(p=>p.status==='done').slice(-2).reverse();
 const next=arr.filter(p=>['pending','ready','stopped'].includes(p.status)).slice(0,2);
 const card=(p,kind)=>'<article class="ef14-led-card ef14-'+ef14Status(p)+'"><div class="ef14-led-label">'+esc(kind)+'</div><h2>'+esc(p.title)+'</h2><p>'+esc(p.type||'Program')+' · '+esc(p.category||'General')+'</p></article>';
 const empty=label=>'<div class="ef14-led-empty">'+esc(label)+'</div>';
 host.innerHTML='<section class="ef14-led-shell"><header class="ef14-led-header"><div><div class="ef14-kicker">EVENTFLOW · LIVE DISPLAY</div><h1>'+esc(c.event.title)+'</h1></div><button class="secondary" id="ef14Full" type="button">Full screen</button></header>'+
 '<div class="ef14-led-grid"><section class="ef14-led-column"><h3>Previous · Completed</h3>'+(previous.map(p=>card(p,'COMPLETED')).join('')||empty('No completed programs yet'))+'</section>'+
 '<section class="ef14-led-column ef14-led-main"><h3>Live now</h3>'+(active?card(active,active.status==='paused'?'PAUSED':'ON AIR'):empty('Awaiting the next program'))+
 '<div class="ef14-led-clock"><div>ELAPSED</div><strong id="ef14Clock">00:00</strong><div>REMAINING</div><strong id="ef14Remaining">00:00</strong></div></section>'+
 '<section class="ef14-led-column"><h3>Upcoming · Next 2</h3>'+(next.map(p=>card(p,'UP NEXT')).join('')||empty('No upcoming programs'))+'</section></div></section>';
 $('#ef14Full').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen?.();else host.requestFullscreen?.()};
 ef14Tick();
}
function ef14Tick(){
 const c=current();if(!c)return;
 const active=c.programs?.find(p=>['running','paused'].includes(p.status));
 if(state.page==='timeline'){
  const clock=$('#ef14Clock'),remain=$('#ef14Remaining');
  if(clock)clock.textContent=ef14Time(Math.floor(active?efSec(active):0));
  if(remain)remain.textContent=ef14Time(Math.max(0,(active?.duration||0)-(active?efSec(active):0)));
 }
 if(state.page==='live'){
  const live=c.programs.find(p=>['running','paused'].includes(p.status))||
   c.programs.find(p=>['pending','ready','stopped'].includes(p.status));
  const remain=$('#v12Remain'),elapsed=$('#v12Elapsed');
  if(remain)remain.textContent=ef14Time(Math.max(0,(live?.duration||0)-(live?efSec(live):0)));
  if(elapsed)elapsed.textContent=ef14Time(Math.floor(live?efSec(live):0));
 }
}
const ef14OldUpdateLive=v12UpdateLive;
v12UpdateLive=function(){ef14OldUpdateLive();ef14Tick()};
function ef14StyleRow(row,p){
 row.classList.add('ef14-status-row','ef14-'+ef14Status(p));
 const tag=row.querySelector('.tag');
 if(tag){tag.className='ef14-status ef14-status-'+ef14Status(p);tag.textContent=p.status;}
}
const ef14OldRenderQueue=v12RenderQueue;
v12RenderQueue=function(){
 ef14OldRenderQueue();
 const c=current();if(!c)return;
 const host=$('#v12LiveQueue');if(!host)return;
 for(const row of [...host.querySelectorAll('[data-id]')]){
  const p=c.programs.find(x=>x.id===row.dataset.id);if(!p)continue;
  ef14StyleRow(row,p);
  if(p.status==='skipped'){row.remove();continue;}
  if(['pending','ready','stopped'].includes(p.status)&&ef14RoleCanOperate()){
   const actions=row.querySelector('.v12-row-actions');
   if(actions&&!actions.querySelector('.ef14-skip')){
    const skip=document.createElement('button');skip.type='button';skip.className='ef14-skip';
    skip.textContent='Skip';skip.title='Remove from live running order (retains history)';
    skip.onclick=()=>{if(confirm('Skip '+p.title+'? It will be removed from the active running order.'))v12QueueCommand(p,'skip')};
    actions.append(skip);
   }
  }
 }
};
const ef14OldRenderAwards=v12RenderLiveAwards;
v12RenderLiveAwards=function(){
 ef14OldRenderAwards();
 const host=$('#v12LiveAwards'),c=current();if(!host||!c)return;
 const awards=(c.awards||[]).filter(a=>!v12LiveAwardFilter||a.category===v12LiveAwardFilter);
 [...host.querySelectorAll('.v12-live-row')].forEach((row,i)=>{
  const a=awards[i];if(a)ef14StyleRow(row,{status:a.status==='presented'?'done':a.status});
 });
};
const ef14OldOrder=ef13PersistOrder;
ef13PersistOrder=function(from,to){
 const c=current();if(!c)return;
 const all=c.programs||[],ids=all.map(p=>p.id),a=ids.indexOf(from),z=ids.indexOf(to);
 if(a<0||z<0||a===z)return;
 ids.splice(a,1);ids.splice(z,0,from);
 const active=all.find(p=>['running','paused'].includes(p.status));
 const pos=active?ids.indexOf(active.id):-1;
 const toSkip=pos<0?[]:ids.slice(0,pos).map(id=>all.find(p=>p.id===id)).filter(p=>['pending','ready','stopped'].includes(p.status));
 if(toSkip.length&&!confirm('This move puts '+toSkip.length+' pending program(s) before the live program. Mark them SKIPPED and remove them from the live queue?'))return;
 act(async()=>{
  const result=await api('/api/events/'+c.event.id+'/reorder','POST',{revision:c.event.revision,ids,skipBeforeActive:toSkip.length>0});
  state.current=result;renderLive();toast(toSkip.length?'Order saved; earlier programs marked skipped.':'Running order saved.');
 });
};
const ef14OldRender=render;
render=function(){if(state.page==='timeline')return ef14Timeline();return ef14OldRender()};
function ef14CloseMenu(){
 document.body.classList.remove('ef14-menu-open');
 $('#ef14Menu')?.setAttribute('aria-expanded','false');
}
function ef14InstallMobileMenu(){
 if($('#ef14Menu'))return;
 const top=$('.topbar');if(!top)return;
 const btn=document.createElement('button');btn.id='ef14Menu';btn.className='ef14-menu-trigger';
 btn.type='button';btn.textContent='☰';btn.setAttribute('aria-label','Open navigation menu');
 btn.setAttribute('aria-controls','nav');btn.setAttribute('aria-expanded','false');
 btn.onclick=()=>{const opened=document.body.classList.toggle('ef14-menu-open');btn.setAttribute('aria-expanded',String(opened))};
 top.prepend(btn);
 const shade=document.createElement('button');shade.id='ef14Shade';shade.type='button';shade.className='ef14-menu-shade';shade.setAttribute('aria-label','Close menu');shade.onclick=ef14CloseMenu;
 $('#app').append(shade);
 $$('#nav [data-page]').forEach(b=>b.addEventListener('click',ef14CloseMenu));
 $('#logout')?.addEventListener('click',ef14CloseMenu);
 document.addEventListener('keydown',ev=>{if(ev.key==='Escape')ef14CloseMenu()});
}
ef14InstallMobileMenu();
setInterval(ef14Tick,1000);
