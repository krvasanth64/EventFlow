'use strict';
// V1.5.0 beta: LED stage-view and award recipient readiness. No completed-program LED column.
const ef20Ready=rows=>{
 const persons=Array.isArray(rows)?rows:[];
 const checked=persons.filter(p=>p.checkedIn).length;
 return {checked,total:persons.length,ready:persons.length>0&&checked===persons.length};
};
const ef20UpcomingPrograms=programs=>(programs||[]).filter(p=>['pending','ready','stopped'].includes(p.status)).slice(0,4);
const ef20ReadyAwards=awards=>(awards||[]).filter(a=>
 !['presented','skipped'].includes(a.status)&&ef20Ready(a.participants).ready
);
const ef20AwardCard=a=>{
 const r=ef20Ready(a.participants);
 return '<article class="ef20-led-award">'+
 '<div class="ef20-led-award-id">'+esc(a.awardCode||'Award')+'</div>'+
 '<div class="ef20-led-award-title">'+esc(a.awardName||'Award')+'</div>'+
 '<div class="ef20-led-award-winner">'+esc(a.winnerName||'Recipient')+'</div>'+
 '<div class="ef20-led-award-ready">'+r.checked+'/'+r.total+' Recipients ready</div>'+
 '</article>';
};
ef14Timeline=function(){
 const c=current(),host=$('#pageTimeline');if(!host)return;
 if(!c){host.innerHTML='<div class="empty">Select an event first.</div>';return;}
 const programs=c.programs||[],active=programs.find(p=>['running','paused'].includes(p.status));
 const upcoming=ef20UpcomingPrograms(programs),awards=ef20ReadyAwards(c.awards).slice(0,4);
 const card=(p,i)=>{
  const ready=ef20Ready(p.participants);
  return '<article class="ef20-led-program">'+
   '<div class="ef20-led-program-top"><span class="ef20-led-number">'+(i+1)+'</span>'+
   '<span class="ef20-led-code">'+esc(p.programCode||'')+'</span>'+
   '<span class="ef20-led-ready '+(ready.ready?'ef20-led-ready-full':'')+'">'+ready.checked+'/'+ready.total+' Ready</span></div>'+
   '<h2>'+esc(p.title)+'</h2><p>'+esc(p.type||'Program')+' · '+esc(p.category||'General')+'</p></article>';
 };
 host.innerHTML='<section class="ef14-led-shell ef20-led-shell">'+
 '<header class="ef14-led-header"><div><div class="ef14-kicker">EVENTFLOW · LED LIVE TIMELINE</div>'+
 '<h1>'+esc(c.event.title)+'</h1></div>'+
 '<button class="secondary" id="ef14Full" type="button">Full screen</button></header>'+
 '<div class="ef20-led-main-grid">'+
 '<section class="ef20-led-stage"><div class="ef20-led-stage-label">ON STAGE · LIVE</div>'+
 (active?'<div class="ef20-led-live-code">'+esc(active.programCode||'')+' · '+esc(active.status.toUpperCase())+'</div>'+
 '<h2>'+esc(active.title)+'</h2><p>'+esc(active.type||'Program')+' · '+esc(active.category||'General')+'</p>':
 '<h2>Awaiting next program</h2><p>Stage standby</p>')+
 '<div class="ef14-led-clock"><div>ELAPSED</div><strong id="ef14Clock">00:00</strong>'+
 '<div>REMAINING</div><strong id="ef14Remaining">00:00</strong></div></section>'+
 '<section class="ef20-led-upcoming"><h3>NEXT 4 PROGRAMS</h3>'+
 (upcoming.map(card).join('')||'<div class="ef14-led-empty">No upcoming programs</div>')+
 '</section></div>'+
 '<section class="ef20-led-awards"><div class="ef20-led-awards-heading"><h3>AWARDS · READY FOR PRESENTATION</h3>'+
 '<span>'+awards.length+' ready</span></div>'+
 '<div class="ef20-led-awards-grid">'+(awards.map(ef20AwardCard).join('')||
 '<div class="ef14-led-empty">Awaiting recipient check-in at Backstage</div>')+'</div></section>'+
 '</section>';
 $('#ef14Full').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen?.();else host.requestFullscreen?.()};
 ef14Tick();
};
function ef20AwardStatus(a){
 const result=ef20Ready(a.participants);
 return result.checked+'/'+result.total+(result.ready?' Ready':' Checked in');
}
function ef20AwardList(){
 const c=current(),host=$('#pagePrep');if(!c||!host)return;
 host.querySelector('#ef20AwardPrep')?.remove();
 const pending=(c.awards||[]).filter(a=>!['presented','skipped'].includes(a.status));
 const panel=document.createElement('section');
 panel.id='ef20AwardPrep';panel.className='ef20-award-prep';
 panel.innerHTML='<div class="ef20-backstage-title"><div><div class="ef17-kicker">AWARD PRESENTATION PREPARATION</div>'+
 '<h2>Award recipient check-in</h2><p class="muted">Mark recipients ready here. Fully checked-in awards appear on the LED display automatically.</p></div>'+
 '<span class="ef20-award-total">'+pending.filter(a=>ef20Ready(a.participants).ready).length+' ready / '+pending.length+'</span></div>'+
 '<div class="ef20-award-prep-grid">'+(pending.map(a=>{
  const result=ef20Ready(a.participants);
  return '<article class="ef20-award-prep-card" data-award-prep="'+esc(a.id)+'">'+
  '<div class="ef20-award-prep-head"><div><span class="ef16-code">'+esc(a.awardCode||'')+'</span>'+
  '<h3>'+esc(a.awardName)+'</h3><small>'+esc(a.category||'General')+'</small></div>'+
  '<span class="ef17-chip '+(result.ready?'ef17-good':'ef17-warning')+'">'+ef20AwardStatus(a)+'</span></div>'+
  '<p class="ef20-award-winner">Winner: '+esc(a.winnerName||'Not assigned')+'</p>'+
  '<div class="ef20-award-people">'+(Array.isArray(a.participants)&&a.participants.length?
    a.participants.map(person=>
      '<label class="ef16-person '+(person.checkedIn?'ef16-person-ready':'')+'">'+
      '<input type="checkbox" data-award-check="'+esc(a.id)+'" data-award-person="'+esc(person.id)+'"'+
      (person.checkedIn?' checked':'')+(efCanOperate()?'':' disabled')+'>'+
      '<span class="ef16-person-details"><strong>'+esc(person.name)+'</strong>'+
      '<small>'+esc(person.employeeCode||'')+(person.contact?' · '+esc(person.contact):'')+'</small></span>'+
      '<span class="ef16-person-status">'+(person.checkedIn?'Ready':'Waiting')+'</span></label>'
    ).join(''):'<p class="muted tiny">No recipient assigned</p>')+'</div>'+
  (state.editing?'<button type="button" class="secondary ef20-edit-award-roster" data-award-edit="'+esc(a.id)+'">Edit recipients</button>':'')+
  '</article>';
 }).join('')||'<div class="empty">No awards awaiting presentation.</div>')+'</div>';
 host.append(panel);
 $$('[data-award-check]',panel).forEach(input=>input.onchange=()=>{
  const checked=input.checked;input.disabled=true;
  act(async()=>{
   const stateNow=current(),award=stateNow.awards.find(a=>a.id===input.dataset.awardCheck);
   if(!award)throw Error('Award changed; refresh.');
   const result=await api('/api/events/'+stateNow.event.id+'/awards/'+award.id+
    '/participants/'+input.dataset.awardPerson+'/check','POST',
    {revision:stateNow.event.revision,checkedIn:checked});
   state.current=result;renderPrep();
  }).finally(()=>{if(input.isConnected)input.disabled=false});
 });
 $$('[data-award-edit]',panel).forEach(btn=>btn.onclick=()=>{
  const award=current()?.awards?.find(a=>a.id===btn.dataset.awardEdit);
  if(award)ef20EditAwardRecipients(award);
 });
}
function ef20EditAwardRecipients(award){
 if(!state.editing)return toast('Acquire event editing control to manage award recipients.');
 const rows=(award.participants||[]).map(p=>({...p}));
 modal('Award recipients · '+esc(award.awardCode||''),
  '<p class="muted">Edit recipient list for '+esc(award.awardName)+'. Preserve the existing rows to keep check-in status.</p>'+
  '<div class="ef16-editor-head"><span>Employee code</span><span>Recipient name</span><span>Contact</span></div>'+
  '<div id="ef20AwardRows" class="ef16-editor-list"></div>'+
  '<div class="form-actions"><button type="button" class="secondary" id="ef20AddAwardPerson">+ Add recipient</button>'+
  '<button type="button" class="primary" id="ef20SaveAwardPeople">Save recipients</button></div>',
 ()=>{
  const list=$('#ef20AwardRows');
  const makeRow=row=>{
   const el=document.createElement('div');el.className='ef16-editor-row';
   el.dataset.id=row?.id||'';
   el.innerHTML='<input data-field="employeeCode" maxlength="60" placeholder="Employee code" value="'+esc(row?.employeeCode||'')+'">'+
    '<input data-field="name" maxlength="160" placeholder="Recipient name *" value="'+esc(row?.name||'')+'">'+
    '<input data-field="contact" maxlength="50" placeholder="Contact" value="'+esc(row?.contact||'')+'">'+
    '<button type="button" class="secondary" title="Remove recipient">×</button>';
   el.querySelector('button').onclick=()=>el.remove();
   return el;
  };
  rows.forEach(row=>list.append(makeRow(row)));
  $('#ef20AddAwardPerson').onclick=()=>list.append(makeRow(null));
  $('#ef20SaveAwardPeople').onclick=()=>act(async()=>{
   const entries=[...list.children].map(el=>({
    id:el.dataset.id||undefined,
    employeeCode:el.querySelector('[data-field="employeeCode"]').value.trim(),
    name:el.querySelector('[data-field="name"]').value.trim(),
    contact:el.querySelector('[data-field="contact"]').value.trim()
   }));
   if(entries.some(x=>!x.name))throw Error('Every recipient requires a name.');
   const c=current();
   state.current=await api('/api/events/'+c.event.id+'/awards/'+award.id+'/participants',
    'PUT',{revision:c.event.revision,participants:entries});
   closeModal();renderPrep();toast('Award recipients saved.');
  });
 },'AWARD READINESS');
}
const ef20OldPrep=renderPrep;
renderPrep=function(){ef20OldPrep();ef20AwardList()};
