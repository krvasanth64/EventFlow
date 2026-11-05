'use strict';
/* EventFlow V1.4.5: event-scoped permanent codes and participant stage preparation. */
const ef16Code=p=>p.programCode||p.awardCode||'—';
const ef16Upcoming=()=>current()?.programs?.filter(p=>['pending','ready','stopped'].includes(p.status)).slice(0,4)||[];
const ef16Label=p=>'<span class="ef16-code">'+esc(ef16Code(p))+'</span>';
function ef16ParticipantRow(row,p){
 const canCheck=efCanOperate();
 return '<label class="ef16-person '+(row.checkedIn?'ef16-person-ready':'')+'">'+
 '<input type="checkbox" data-ready-program="'+esc(p.id)+'" data-ready-person="'+esc(row.id)+'" '+(row.checkedIn?'checked ':'')+(canCheck?'':'disabled ')+
 ' aria-label="Mark '+esc(row.name)+' ready">'+
 '<span class="ef16-person-details"><strong>'+esc(row.name)+'</strong><small>'+esc(row.employeeCode||'No employee code')+
 (row.contact?' · '+esc(row.contact):'')+'</small></span>'+
 '<span class="ef16-person-status">'+(row.checkedIn?'Ready':'Waiting')+'</span></label>';
}
function ef16PrepCard(p,i){
 const people=Array.isArray(p.participants)?p.participants:[];
 const checked=people.filter(x=>x.checkedIn).length;
 return '<article class="ef16-prep-card" data-prep-id="'+esc(p.id)+'">'+
 '<div class="ef16-prep-top"><div class="ef16-prep-title"><span class="ef16-position">'+(i+1)+'</span>'+
 '<div><div>'+ef16Label(p)+' <span class="muted tiny">'+esc(p.category||'General')+'</span></div><h3>'+esc(p.title)+'</h3></div></div>'+
 '<span class="ef16-count '+(people.length&&checked===people.length?'ef16-all-ready':'')+'">'+checked+'/'+people.length+' Ready</span></div>'+
 '<div class="ef16-people">'+(people.length?people.map(row=>ef16ParticipantRow(row,p)).join(''):
 '<p class="muted tiny">No participants registered. An editor can add them in Program Planner.</p>')+'</div>'+
 (state.editing?'<button type="button" class="secondary ef16-add-people" data-edit-people="'+esc(p.id)+'">Edit participants</button>':'')+
 '</article>';
}
function ef16BindPrep(root){
 $$('[data-ready-person]',root).forEach(input=>input.onchange=()=>{
  const checked=input.checked;input.disabled=true;
  act(async()=>{
   const c=current(),p=c.programs.find(x=>x.id===input.dataset.readyProgram);
   if(!p)throw Error('Program has changed. Refresh.');
   const result=await api('/api/events/'+c.event.id+'/programs/'+p.id+'/participants/'+input.dataset.readyPerson+'/check','POST',
    {revision:c.event.revision,checkedIn:checked});
   state.current=result;
   if(state.page==='prep')renderPrep();else if(state.page==='live')ef16RefreshLivePrep();
  }).finally(()=>{if(input.isConnected)input.disabled=false});
 });
 $$('[data-edit-people]',root).forEach(button=>button.onclick=()=>{
  const p=current()?.programs.find(x=>x.id===button.dataset.editPeople);
  if(p)ef16EditParticipants(p);
 });
}
function renderPrep(){
 const c=current(),host=$('#pagePrep');if(!host)return;
 if(!c){showEventChooser('prep','Select an event to prepare participants');return;}
 const four=ef16Upcoming();
 host.innerHTML=pageHead('BACKSTAGE PREPARATION',esc(c.event.title),'Next four upcoming programs · participant check-in and readiness',
  '<button class="secondary" id="ef16GoLive" type="button">Go to Live Control</button>')+
 '<div class="ef16-prep-summary"><strong>'+four.length+' upcoming programs</strong><span class="muted">Check each participant as they arrive at the stage. Order follows Live Control.</span></div>'+
 '<div class="ef16-prep-grid">'+(four.length?four.map(ef16PrepCard).join(''):
 '<div class="empty">No upcoming programs are available.</div>')+'</div>';
 $('#ef16GoLive').onclick=()=>navigate('live');
 ef16BindPrep(host);
}
function ef16RefreshLivePrep(){
 const c=current(),queue=$('#v12LiveQueue');if(!c||!queue)return;
 const root=$('#v12LiveRoot');if(!root)return;
 let panel=$('#ef16LivePreparation');
 if(!panel){
  panel=document.createElement('section');panel.id='ef16LivePreparation';panel.className='card ef16-live-prep';
  const skipped=$('#ef15SkippedPanel');
  if(skipped)skipped.insertAdjacentElement('afterend',panel);
  else queue.closest('.card')?.insertAdjacentElement('afterend',panel);
 }
 if(panel.dataset.revision===String(c.event.revision))return;
 panel.dataset.revision=String(c.event.revision);
 const four=ef16Upcoming();
 panel.innerHTML='<div class="card-title"><h3>Upcoming 4 · Participant readiness</h3>'+
 '<button type="button" class="secondary" id="ef16OpenPrep">Open preparation board</button></div>'+
 '<div class="ef16-prep-grid ef16-live-grid">'+(four.map(ef16PrepCard).join('')||
 '<p class="muted">No upcoming programs</p>')+'</div>';
 $('#ef16OpenPrep').onclick=()=>navigate('prep');
 ef16BindPrep(panel);
}
function ef16EditParticipants(p){
 if(!state.editing)return toast('Acquire editing control to manage participants.');
 const rows=(p.participants||[]).map(x=>({...x}));
 const makeRow=row=>{
  const el=document.createElement('div');el.className='ef16-editor-row';
  el.dataset.personId=row?.id||'';
  el.innerHTML='<input placeholder="Employee code" aria-label="Employee code" data-ef16-field="employeeCode" value="'+esc(row?.employeeCode||'')+'" maxlength="60">'+
   '<input placeholder="Participant name *" aria-label="Participant name" data-ef16-field="name" value="'+esc(row?.name||'')+'" maxlength="160">'+
   '<input placeholder="Contact number" aria-label="Contact number" data-ef16-field="contact" value="'+esc(row?.contact||'')+'" maxlength="50">'+
   '<button type="button" class="secondary danger" data-remove-person aria-label="Remove participant">×</button>';
  $('[data-remove-person]',el).onclick=()=>el.remove();
  return el;
 };
 modal('Program Participants · '+ef16Code(p),
  '<p class="muted">Manage participants for <strong>'+esc(p.title)+'</strong>. Existing checkmarks are retained for unchanged rows.</p>'+
  '<div class="ef16-editor-head"><span>Employee code</span><span>Name</span><span>Contact</span><span></span></div>'+
  '<div id="ef16EditorRows" class="ef16-editor-list"></div>'+
  '<div class="form-actions"><button type="button" class="secondary" id="ef16AddRow">+ Add participant</button>'+
  '<button type="button" class="secondary" id="ef16Cancel">Cancel</button>'+
  '<button type="button" class="primary" id="ef16Save">Save participants</button></div>',()=>{
   const list=$('#ef16EditorRows');
   for(const row of rows)list.append(makeRow(row));
   $('#ef16AddRow').onclick=()=>list.append(makeRow(null));
   $('#ef16Cancel').onclick=closeModal;
   $('#ef16Save').onclick=()=>act(async()=>{
    const c=current(),payload=[...list.children].map(el=>{
     const input=name=>el.querySelector('[data-ef16-field="'+name+'"]').value.trim();
     return {id:el.dataset.personId||undefined,employeeCode:input('employeeCode'),name:input('name'),contact:input('contact')};
    });
    if(payload.some(x=>!x.name))throw Error('Every participant must have a name.');
    const result=await api('/api/events/'+c.event.id+'/programs/'+p.id+'/participants','PUT',
      {revision:c.event.revision,participants:payload});
    state.current=result;closeModal();render();toast('Participants saved for '+ef16Code(p));
   });
  },'PARTICIPANT ROSTER');
}
const ef16OriginalProgramDialog=programDialog;
programDialog=function(p){
 ef16OriginalProgramDialog(p);
 const form=$('#programForm');
 if(!form)return;
 for(const field of ['employeeId','employeeName','contact'])form.querySelector('[name="'+field+'"]')?.closest('label')?.classList.add('hidden');
 const section=document.createElement('div');section.className='wide ef16-program-participants';
 section.innerHTML='<h3>Program participants '+(p?ef16Label(p):'')+'</h3>'+
 '<p class="muted tiny">'+(p?'Register employees/participants as child rows, then mark ready from Preparation or Live Control.':
 'Save the new program first, then reopen it to add the participant roster.')+'</p>'+
 (p?'<button type="button" class="secondary" id="ef16ManageRoster">Manage participants ('+(p.participants?.length||0)+')</button>':'');
 form.querySelector('.form-grid')?.append(section);
 $('#ef16ManageRoster')?.addEventListener('click',()=>ef16EditParticipants(p));
};
const ef16OriginalQueueRow=v12QueueRow;
v12QueueRow=function(p,i,forecast,active){
 return ef16OriginalQueueRow(p,i,forecast,active).replace('<div class="v12-live-info">',
  ef16Label(p)+'<div class="v12-live-info">');
};
const ef16OriginalAwardList=v12RenderLiveAwards;
v12RenderLiveAwards=function(){
 ef16OriginalAwardList();
 const c=current(),list=$('#v12LiveAwards');if(!c||!list)return;
 $$('[data-award-id]',list).forEach(row=>{
  const a=c.awards.find(x=>x.id===row.dataset.awardId);
  if(a&&!row.querySelector('.ef16-code'))row.querySelector('.v12-live-info')?.insertAdjacentHTML('afterbegin',ef16Label(a));
 });
};
const ef16OriginalPlanner=renderPlanner;
renderPlanner=function(){
 ef16OriginalPlanner();
 const c=current();if(!c)return;
 $$('.program-item[data-id]','#pagePlanner').forEach(item=>{
  const p=c.programs.find(x=>x.id===item.dataset.id);
  if(p&&!item.querySelector('.ef16-code'))item.querySelector('.program-text')?.insertAdjacentHTML('afterbegin',ef16Label(p));
 });
};
const ef16OriginalDetails=renderDetail;
renderDetail=function(){
 ef16OriginalDetails();
 const p=current()?.programs?.find(x=>x.id===state.selected);
 if(!p)return;
 const node=$('#detailPanel h3');if(node&&!$('#detailPanel .ef16-code'))node.insertAdjacentHTML('beforebegin',ef16Label(p));
 const actions=$('#detailPanel .detail-actions');
 if(actions&&state.editing){
  const btn=document.createElement('button');btn.type='button';btn.className='secondary';
  btn.textContent='Participants ('+(p.participants?.length||0)+')';btn.onclick=()=>ef16EditParticipants(p);
  actions.prepend(btn);
 }
};
const ef16OriginalAwards=renderAwards;
renderAwards=function(){
 ef16OriginalAwards();
 const c=current();if(!c)return;
 $$('.ef-award-item[data-award]','#pageAwards').forEach(item=>{
  const a=c.awards.find(x=>x.id===item.dataset.award);
  if(a&&!item.querySelector('.ef16-code'))item.querySelector('.ef-award-desc')?.insertAdjacentHTML('afterbegin',ef16Label(a));
 });
};
const ef16OldLive=renderLive;
renderLive=function(){ef16OldLive();ef16RefreshLivePrep()};
const ef16OriginalRender=render;
render=function(){if(state.page==='prep')return renderPrep();return ef16OriginalRender()};
