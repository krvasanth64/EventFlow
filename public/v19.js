'use strict';
// V1.4.9 live timeline: stage-first pagination and lightweight readiness badges.
// Full checklists remain exclusively on the Backstage Preparation page.
const ef19PageSizes=[10,20,30,50,100,200,'all'];
let ef19Paging={key:null,size:10,page:0,focusId:null};
const ef19CanQueue=p=>p.status!=='skipped';
function ef19Focus(rows){
 return rows.find(p=>['running','paused'].includes(p.status))||
  rows.find(p=>['pending','ready','stopped'].includes(p.status))||
  rows[rows.length-1]||null;
}
function ef19InitialPage(rows){
 const focus=ef19Focus(rows),index=focus?rows.findIndex(p=>p.id===focus.id):0;
 return ef19Paging.size==='all'?0:Math.floor(Math.max(index,0)/ef19Paging.size);
}
function ef19Navigation(host,filtered,activePage,totalPages){
 const first=filtered.length?(ef19Paging.size==='all'?1:activePage*ef19Paging.size+1):0;
 const last=filtered.length?(ef19Paging.size==='all'?filtered.length:Math.min(filtered.length,(activePage+1)*ef19Paging.size)):0;
 const wrap=document.createElement('div');wrap.id='ef19Pagination';wrap.className='ef19-pagination';
 wrap.innerHTML='<div class="ef19-page-summary">Showing <strong>'+first+'–'+last+'</strong> of <strong>'+filtered.length+'</strong> programs</div>'+
 '<div class="ef19-page-actions"><label for="ef19PageSize">Show</label><select id="ef19PageSize" aria-label="Programs per page">'+
 ef19PageSizes.map(n=>'<option value="'+n+'" '+(String(ef19Paging.size)===String(n)?'selected':'')+'>'+String(n).toUpperCase()+'</option>').join('')+
 '</select><button type="button" class="secondary" id="ef19Prev" '+(activePage<=0?'disabled':'')+'>Previous</button>'+
 '<span class="ef19-page-index">Page '+(activePage+1)+' / '+totalPages+'</span>'+
 '<button type="button" class="secondary" id="ef19Next" '+(activePage>=totalPages-1?'disabled':'')+'>Next</button>'+
 '<button type="button" class="secondary" id="ef19Stage" title="Jump to live or next upcoming program">Go to Live</button></div>';
 host.insertAdjacentElement('beforebegin',wrap);
 $('#ef19PageSize').onchange=e=>{
  ef19Paging.size=e.target.value==='all'?'all':Number(e.target.value);
  ef19Paging.page=ef19InitialPage(filtered);
  v12RenderQueue();
 };
 $('#ef19Prev').onclick=()=>{ef19Paging.page=Math.max(0,ef19Paging.page-1);v12RenderQueue()};
 $('#ef19Next').onclick=()=>{ef19Paging.page=Math.min(totalPages-1,ef19Paging.page+1);v12RenderQueue()};
 $('#ef19Stage').onclick=()=>{ef19Paging.page=ef19InitialPage(filtered);v12RenderQueue()};
}
const ef19QueueBefore=v12RenderQueue;
v12RenderQueue=function(){
 const c=current(),host=$('#v12LiveQueue');if(!c||!host)return;
 const all=c.programs||[],forecast=efForecast(c.event,all),active=all.find(efActive);
 const filtered=all.filter(p=>ef19CanQueue(p)&&(!v12LiveFilter||(p.category||'General')===v12LiveFilter));
 const key=c.event.id+'|'+(v12LiveFilter||'*');
 const focus=ef19Focus(filtered);
 if(ef19Paging.key!==key){
  ef19Paging.key=key;ef19Paging.page=ef19InitialPage(filtered);ef19Paging.focusId=focus?.id||null;
 }else if(ef19Paging.focusId!==(focus?.id||null)){
  // Follow meaningful stage transitions; ordinary SSE revisions must not reset manual page browsing.
  ef19Paging.focusId=focus?.id||null;
  ef19Paging.page=ef19InitialPage(filtered);
 }
 const totalPages=ef19Paging.size==='all'?1:Math.max(1,Math.ceil(filtered.length/ef19Paging.size));
 ef19Paging.page=Math.max(0,Math.min(totalPages-1,ef19Paging.page));
 const page=ef19Paging.page,items=ef19Paging.size==='all'?filtered:
  filtered.slice(page*ef19Paging.size,(page+1)*ef19Paging.size);
 host.innerHTML=items.map(p=>v12QueueRow(p,all.indexOf(p),forecast,active)).join('')||
 '<div class="empty"><strong>No programs on this page</strong>Try another category or restore a skipped program.</div>';
 $('#ef19Pagination')?.remove();
 ef19Navigation(host,filtered,page,totalPages);
 $$('.v12-live-row',host).forEach(row=>{
  const p=all.find(x=>x.id===row.dataset.id);if(!p)return;
  ef14StyleRow(row,p);
  // Readiness summary is informational. Manage individual checkmarks on Backstage only.
  if(['pending','ready','stopped'].includes(p.status)){
   const people=Array.isArray(p.participants)?p.participants:[];
   const ready=people.filter(x=>x.checkedIn).length;
   const badge=document.createElement('span');badge.className='ef19-ready-count'+(people.length&&ready===people.length?' ef19-all-ready':'');
   badge.textContent=ready+'/'+people.length+' Ready';
   badge.title=people.length?'Stage check-in is maintained on Backstage Preparation':'No participants recorded';
   const info=row.querySelector('.v12-live-info');
   info?.append(badge);
  }
  $$('[data-cmd]',row).forEach(button=>button.onclick=()=>v12QueueCommand(p,button.dataset.cmd));
  if(['pending','ready','stopped'].includes(p.status)&&ef14RoleCanOperate()){
   const actions=row.querySelector('.v12-row-actions');
   if(actions&&!actions.querySelector('.ef14-skip')){
    const skip=document.createElement('button');skip.type='button';skip.className='ef14-skip';skip.textContent='Skip';
    skip.onclick=()=>{if(confirm('Skip '+p.title+'? It will be moved to the Skipped section.'))v12QueueCommand(p,'skip')};
    actions.append(skip);
   }
  }
  if(!efCanOperate()||['running','paused','done','skipped'].includes(p.status))return;
  row.addEventListener('dragstart',event=>{
   event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',p.id);
   row.classList.add('ef13-dragging');
  });
  row.addEventListener('dragend',()=>row.classList.remove('ef13-dragging'));
  row.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='move';row.classList.add('ef13-drop-target')});
  row.addEventListener('dragleave',()=>row.classList.remove('ef13-drop-target'));
  row.addEventListener('drop',event=>{
   event.preventDefault();row.classList.remove('ef13-drop-target');
   const from=event.dataTransfer.getData('text/plain');
   if(from&&from!==p.id)ef13PersistOrder(from,p.id);
  });
 });
 ef15SkippedPanel();
};
