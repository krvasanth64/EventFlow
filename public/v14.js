'use strict';
/* EventFlow V1.4: presenter/LED-safe view without editorial controls. */
function ef14Timeline(){
 const c=current(),host=$('#pageTimeline');if(!host)return;
 if(!c){host.innerHTML='<div class="empty">Select an event from the event picker.</div>';return;}
 const arr=c.programs||[],active=arr.find(p=>['running','paused'].includes(p.status));
 const next=arr.filter(p=>['pending','ready','stopped'].includes(p.status)).slice(0,2);
 const previous=arr.filter(p=>['done','skipped'].includes(p.status)).slice(-2).reverse();
 const line=(p,kind)=>'<div class="card" style="padding:20px;margin:8px 0;min-width:0"><div class="eyebrow">'+kind+'</div><h2 style="font-size:clamp(20px,3vw,38px);overflow-wrap:anywhere">'+esc(p?.title||'—')+'</h2>'+(p?'<p>'+esc(p.type||'')+' · '+esc(p.category||'')+'</p>':'')+'</div>';
 const live=active?line(active,'ON AIR · '+active.status.toUpperCase()):'<div class="card" style="padding:24px"><h2>Ready for the next program</h2></div>';
 host.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap"><div><div class="eyebrow">EVENTFLOW · LIVE TIMELINE</div><h1>'+esc(c.event.title)+'</h1></div><button class="secondary" id="ef14Full">Full screen</button></div>'+
 '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px;margin-top:16px">'+
 '<section><h3>Previous · Completed</h3>'+previous.map(p=>line(p,p.status)).join('')+'</section>'+
 '<section><h3>Live</h3>'+live+'<div class="card" style="text-align:center;padding:22px"><div class="eyebrow">ELAPSED TIME</div><div id="ef14Clock" style="font-size:clamp(36px,6vw,86px);font-variant-numeric:tabular-nums;font-weight:800">00:00</div></div></section>'+
 '<section><h3>Upcoming · Next 2</h3>'+next.map(p=>line(p,'UPCOMING')).join('')+'</section></div>';
 $('#ef14Full').onclick=()=>{const el=$('#pageTimeline');if(document.fullscreenElement)document.exitFullscreen?.();else el.requestFullscreen?.()};
 ef14Tick();
}
function ef14Tick(){
 if(state.page!=='timeline')return;
 const currentProgram=current()?.programs?.find(p=>['running','paused'].includes(p.status));
 const seconds=Math.floor(currentProgram?efSec(currentProgram):0);
 const clock=$('#ef14Clock');if(clock)clock.textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
}
const ef14OriginalRender=render;
render=function(){if(state.page==='timeline')return ef14Timeline();return ef14OriginalRender()};
setInterval(ef14Tick,1000);
