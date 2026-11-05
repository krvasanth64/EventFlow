'use strict';
/* EventFlow V1.2: live queue, reference scripts, contacts, categories and compact print. */
let v12ProgramFilter='';
let v12AwardFilter='';
let v12LiveFilter='';
let v12LiveAwardFilter='';
function v12RenderLiveAwards(){
 const c=current(),list=$('#v12LiveAwards');if(!c||!list)return;
 const awards=(c.awards||[]).filter(a=>!v12LiveAwardFilter||a.category===v12LiveAwardFilter);
 list.innerHTML=awards.map(a=>'<div class="v12-live-row" data-award-id="'+esc(a.id)+'" draggable="'+(efCanOperate()&&a.status!=='presented')+'">'+
 '<span class="grip" title="Drag award to reorder">⠿</span><span class="program-num">'+(a.order+1)+'</span>'+
 '<div class="v12-live-info"><strong>'+esc(a.awardName)+' — '+esc(a.winnerName)+'</strong>'+
 '<small>'+esc(a.category||'General')+' · '+esc(a.employeeName||'')+' · '+esc(a.contact||'No contact')+'</small>'+
 '<small>Presented by: '+esc(a.presenter||'Unassigned')+'</small></div>'+
 '<span class="tag '+(a.status==='presented'?'live':'')+'">'+esc(a.status)+'</span>'+
 (efCanOperate()?'<div class="v12-row-actions">'+(efCanEdit()?'<button data-award-edit="'+esc(a.id)+'">Edit</button>':'')+
 (a.status!=='presented'?'<button data-award-done="'+esc(a.id)+'">Mark presented</button>':'<button data-award-pending="'+esc(a.id)+'">Reopen</button>')+'</div>':'')+
 '</div>').join('')||'<div class="empty"><strong>No awards for this category</strong>Choose another category or add an award.</div>';
 $$('[data-award-edit]',list).forEach(b=>b.onclick=()=>efAwardModal((c.awards||[]).find(a=>a.id===b.dataset.awardEdit)));
 $$('[data-award-done]',list).forEach(b=>b.onclick=()=>efAwardAction((c.awards||[]).find(a=>a.id===b.dataset.awardDone),'presented'));
 $$('[data-award-pending]',list).forEach(b=>b.onclick=()=>efAwardAction((c.awards||[]).find(a=>a.id===b.dataset.awardPending),'pending'));
 if(!efCanOperate())return;
 const all=c.awards||[];
 const reorder=(from,to)=>act(async()=>{
  const moving=all.find(a=>a.id===from),target=all.find(a=>a.id===to);
  if(!moving||!target||from===to)return;
  if(moving.status==='presented'||target.status==='presented')return toast('Presented awards stay in their completed position.');
  const ids=all.map(a=>a.id);
  ids.splice(ids.indexOf(from),1);ids.splice(ids.indexOf(to),0,from);
  const next=await api('/api/events/'+c.event.id+'/awards/reorder','POST',{revision:c.event.revision,ids});
  state.current=next;renderLive();toast('Award running order saved.');
 });
 [...list.querySelectorAll('[data-award-id]')].forEach(row=>{
  const award=all.find(a=>a.id===row.dataset.awardId);if(!award||award.status==='presented')return;
  row.addEventListener('dragstart',ev=>{
   ev.dataTransfer.effectAllowed='move';
   ev.dataTransfer.setData('application/x-eventflow-award',award.id);
   row.classList.add('ef13-dragging');
  });
  row.addEventListener('dragend',()=>row.classList.remove('ef13-dragging'));
  row.addEventListener('dragover',ev=>{ev.preventDefault();ev.dataTransfer.dropEffect='move';row.classList.add('ef13-drop-target')});
  row.addEventListener('dragleave',()=>row.classList.remove('ef13-drop-target'));
  row.addEventListener('drop',ev=>{ev.preventDefault();row.classList.remove('ef13-drop-target');const from=ev.dataTransfer.getData('application/x-eventflow-award');if(from)reorder(from,award.id)});
  const actions=row.querySelector('.v12-row-actions');if(!actions)return;
  for(const [direction,delta] of [['up',-1],['down',1]]){
   const button=document.createElement('button');button.type='button';button.textContent=delta<0?'↑':'↓';button.title='Move award '+direction;
   button.onclick=()=>{const index=all.findIndex(a=>a.id===award.id),target=all[index+delta];if(target)reorder(award.id,target.id)};
   actions.prepend(button);
  }
 });
}

const v12Url=source=>'/media/'+String(source).split('/').map(encodeURIComponent).join('/');
const v12FileName=p=>{if(p.sourceType==='file')return p.sourceName||String(p.source||'').split('/').pop()||'—';if(p.sourceType==='linked')return String(p.source||'').split(/[\\/]/).pop()||'—';if(p.sourceType==='url'){try{const name=decodeURIComponent(new URL(p.source).pathname.split('/').filter(Boolean).pop()||'');return /\.[a-z0-9]{2,6}$/i.test(name)?name:'Web link'}catch{return 'Web link'}}return '—'};
function v12CategoryOptions(items,selected){
 const opts=[...new Set(items.map(p=>String(p.category||'General').trim()||'General'))].sort((a,b)=>a.localeCompare(b));
 return '<option value="">All categories</option>'+opts.map(c=>'<option value="'+esc(c)+'" '+(selected===c?'selected':'')+'>'+esc(c)+'</option>').join('');
}
function v12OpenReference(p,script=false){
 const source=script?p.scriptSource:(p.sourceType==='file'?p.source:null);
 if(source){window.open(v12Url(source),'_blank','noopener,noreferrer');return;}
 if(!script&&p.sourceType==='url'){window.open(p.source,'_blank','noopener,noreferrer');return;}
 toast('No accessible source file is attached.');
}
function v12ReferenceMarkup(p,script=false){
 const source=script?p.scriptSource:(p.sourceType==='file'?p.source:null);
 if(!source)return script?'<div class="ef-no-media"><strong>No reading script attached</strong><p>Upload a photo or PDF from Edit Program.</p></div>':efMediaMarkup(p);
 const ext=source.split('.').pop().toLowerCase(),url=v12Url(source);
 if(['jpg','jpeg','png','webp'].includes(ext))return '<img class="v12-script-img" alt="Reading script for '+esc(p.title)+'" src="'+esc(url)+'">';
 if(ext==='pdf')return '<iframe class="v12-script-pdf" src="'+esc(url)+'" title="Reading script"></iframe>';
 return '<div class="ef-media-wrap">'+efMediaMarkup({...p,sourceType:'file',source})+'</div>';
}
function v12Preview(p,script=false){
 modal((script?'Reading script — ':'Source preview — ')+p.title,
  '<div class="v12-preview">'+v12ReferenceMarkup(p,script)+'</div><div class="form-actions"><button class="secondary" id="v12OpenTab">Open in new tab</button><button class="secondary" id="v12Close">Close</button></div>',()=>{
  $('#v12OpenTab').onclick=()=>v12OpenReference(p,script);
  $('#v12Close').onclick=closeModal;
 },script?'SCRIPT / READING REFERENCE':'MEDIA REFERENCE');
}
const v12BasePlanner=renderPlanner;
renderPlanner=function(){
 v12BasePlanner();
 const c=current();if(!c)return;
 const items=c.programs,host=$('#programList');if(!host)return;
 const wrapper=document.createElement('div');wrapper.className='v12-filter-row';
 wrapper.innerHTML='<label>Program category<select id="v12ProgramFilter">'+v12CategoryOptions(items,v12ProgramFilter)+'</select></label><span class="muted tiny">Filter does not change the saved running order</span>';
 host.parentElement.insertBefore(wrapper,host);
 const filter=$('#v12ProgramFilter');
 const apply=()=>$$('.program-item',host).forEach(el=>{
   const p=items.find(x=>x.id===el.dataset.id);
   el.classList.toggle('hidden',!!v12ProgramFilter&&(p?.category||'General')!==v12ProgramFilter);
 });
 filter.onchange=()=>{v12ProgramFilter=filter.value;apply()};apply();
};
const v12BaseDetail=renderDetail;
renderDetail=function(){
 v12BaseDetail();
 const c=current(),p=c?.programs.find(x=>x.id===state.selected),host=$('#detailPanel');
 if(!p||!host)return;
 const section=document.createElement('div');section.className='v12-detail-extra';
 section.innerHTML='<div class="detail-row"><span>Category</span><b>'+esc(p.category||'General')+'</b></div>'+
 '<div class="detail-row"><span>Employee</span><b>'+esc([p.employeeId,p.employeeName].filter(Boolean).join(' · ')||'—')+'</b></div>'+
 '<div class="detail-row"><span>Contact</span><b>'+esc(p.contact||'—')+'</b></div>'+
 '<div class="detail-actions"><button class="secondary" id="v12DetailPreview">Preview source</button><button class="secondary" id="v12DetailScript">Read script</button></div>';
 host.append(section);
 $('#v12DetailPreview').onclick=()=>v12Preview(p);
 $('#v12DetailScript').onclick=()=>v12Preview(p,true);
};
function v12QueueRow(p,i,forecast,active){
 const scheduled=forecast.rows.find(x=>x.id===p.id);
 const locked=['running','paused','done','skipped'].includes(p.status);
 const canEdit=state.editing;
 const canStart=!active||active.id===p.id;
 const nextStatus=['done','skipped'].includes(p.status)?'replay':'start';
 return '<div class="v12-live-row" data-id="'+esc(p.id)+'" draggable="'+(canEdit&&!locked)+'">'+
 '<span class="grip" title="Drag an upcoming program">⠿</span><span class="program-num">'+(i+1)+'</span>'+
 '<div class="v12-live-info"><strong>'+esc(p.title)+'</strong><small>'+esc(p.category||'General')+' · '+esc(p.employeeName||p.presenter||'—')+' · '+esc(p.contact||'No phone')+'</small>'+
 '<small>Start '+efTime(scheduled.forecastStart)+' · End '+efTime(scheduled.forecastEnd)+' · '+duration(p.duration)+'</small></div>'+
 '<span class="tag '+(efActive(p)?'live':'')+'">'+esc(p.status)+'</span>'+
 '<div class="v12-row-actions"><button data-cmd="preview" title="Preview media">Preview</button><button data-cmd="script" title="Read script">Script</button>'+
 (p.sourceType==='url'||p.sourceType==='file'?'<button data-cmd="open" title="Open source in another tab">Open ↗</button>':'')+
 (canEdit?'<button data-cmd="edit">Edit</button>'+
 (!locked?'<button data-cmd="up" title="Move up">↑</button><button data-cmd="down" title="Move down">↓</button>':'')+
 (canStart?'<button data-cmd="'+nextStatus+'">'+(nextStatus==='replay'?'Replay':p.status==='running'?'On Air':p.status==='paused'?'Paused':'Play')+'</button>':''):'')+'</div></div>';
}
function v12RenderQueue(){
 const c=current();if(!c)return;
 const host=$('#v12LiveQueue');if(!host)return;
 const all=c.programs,forecast=efForecast(c.event,all),active=all.find(efActive);
 const filtered=all.filter(p=>!v12LiveFilter||(p.category||'General')===v12LiveFilter);
 host.innerHTML=filtered.map(p=>v12QueueRow(p,all.indexOf(p),forecast,active)).join('')||'<div class="empty"><strong>No programs in this category</strong>Choose All categories to see every program.</div>';
 $$('.v12-live-row',host).forEach(el=>{
   const p=all.find(x=>x.id===el.dataset.id);
   $$('[data-cmd]',el).forEach(b=>b.onclick=()=>v12QueueCommand(p,b.dataset.cmd));
   if(state.editing&&!['running','paused','done','skipped'].includes(p.status)){
     el.addEventListener('dragstart',ev=>ev.dataTransfer.setData('text/plain',p.id));
     el.addEventListener('dragover',ev=>ev.preventDefault());
     el.addEventListener('drop',ev=>{
       ev.preventDefault();const from=ev.dataTransfer.getData('text/plain'),ids=all.map(x=>x.id);
       if(!ids.includes(from)||from===p.id)return;
       ids.splice(ids.indexOf(from),1);ids.splice(ids.indexOf(p.id),0,from);saveOrder(ids);
     });
   }
 });
}
function v12QueueCommand(p,action){
 if(action==='preview')return v12Preview(p);
 if(action==='script')return v12Preview(p,true);
 if(action==='open')return v12OpenReference(p);
 if(action==='edit')return programDialog(p);
 if(action==='up'||action==='down'){
   const all=current().programs,at=all.findIndex(x=>x.id===p.id),to=at+(action==='up'?-1:1);
   if(to<0||to>=all.length)return;
   if(['running','paused','done','skipped'].includes(all[to].status))return toast('On-air and completed slots cannot be moved.');
   return moveBy(p.id,action==='up'?-1:1);
 }
 if(action==='start'&&p.status==='running')return;
 if(action==='start'&&p.status==='paused')return toast('Use Resume on the current program.');
 if(action==='replay')return act(async()=>{
   const c=current();
   const x=await api('/api/events/'+c.event.id+'/live','POST',{programId:p.id,action:'replay',revision:c.event.revision});
   state.current=x;renderLive();
 });
 if(action==='start')return efLiveAction(p,'start');
}
function v12UpdateLive(){
 const c=current();if(!c||state.page!=='live')return;
 const programs=c.programs,now=programs.find(efActive)||programs.find(p=>!['done','skipped'].includes(p.status));
 const root=$('#v12LiveRoot');
 if(!root||root.dataset.event!==c.event.id||root.dataset.program!==(now?.id||'')||root.dataset.editing!==String(state.editing)){renderLive();return;}
 const forecast=efForecast(c.event,programs);
 const currentRow=forecast.rows.find(p=>p.id===now?.id);
 const put=(id,value)=>{const node=$(id);if(node)node.textContent=value;};
 put('#v12Remain',now?duration(currentRow.remaining):'0s');
 put('#v12Elapsed',now?duration(efSec(now)):'0s');
 put('#v12End',now?efTime(currentRow.forecastEnd):efTime(forecast.forecastFinish));
 put('#v12Finish',efTime(forecast.forecastFinish));
 put('#v12Delta',efFormatDelta(forecast.delaySeconds));
 put('#v12NowStatus',now?now.status.toUpperCase():'COMPLETE');
 const bar=$('#v12Progress');if(bar)bar.style.width=now?Math.min(100,100*efSec(now)/Math.max(now.duration,1))+'%':'0%';
 const btnHost=$('#v12OnAirActions');
 if(btnHost){
   const controls=efCanOperate()&&now?
     (now.status==='running'?'<button class="secondary" data-live="pause">Ⅱ Pause</button>':
      now.status==='paused'?'<button class="primary" data-live="resume">▶ Resume</button>':
      '<button class="primary" data-live="start">▶ Start / Play</button>')+
     (efActive(now)?'<button class="secondary" data-live="stop">■ Stop & Reset</button><button class="primary" data-live="finish">✓ Finish</button>':'<button class="secondary" data-live="skip">Skip</button>'):
     '<span class="muted">Viewing only — live-control permission required.</span>';
   if(btnHost.dataset.mode!==controls){btnHost.innerHTML=controls;btnHost.dataset.mode=controls;$$('[data-live]',btnHost).forEach(b=>b.onclick=()=>efLiveAction(now,b.dataset.live));}
 }
 if(root.dataset.revision!==String(c.event.revision)){
   root.dataset.revision=String(c.event.revision);
   v12RenderQueue();
   v12RenderLiveAwards();
 }
}
renderLive=function(){
 const c=current();if(!c){showEventChooser('live','Choose an event for live control');return;}
 const programs=c.programs,now=programs.find(efActive)||programs.find(p=>!['done','skipped'].includes(p.status));
 const page=$('#pageLive'),old=$('#v12LiveRoot');
 if(old?.dataset.event===c.event.id&&old.dataset.program===(now?.id||'')&&old.dataset.editing===String(state.editing)){v12UpdateLive();return;}
 page.innerHTML=pageHead('LIVE EVENT CONTROL',esc(c.event.title),'Operate, preview, reorder upcoming programs and adjust the forecast while the show is running.',editorButtons())+
 banner()+'<div id="v12LiveRoot" data-event="'+esc(c.event.id)+'" data-program="'+esc(now?.id||'')+'" data-editing="'+String(state.editing)+'" data-revision="">'+
 '<div class="ef-live-grid"><section class="ef-stage"><div class="ef-stage-head"><span class="tag live">● ON AIR</span><span id="v12NowStatus">—</span></div>'+
 '<p class="ef-overline">CURRENT PROGRAM</p><h2 class="ef-stage-title">'+esc(now?.title||'All programs finished')+'</h2>'+
 '<div class="ef-countdown"><span id="v12Remain">—</span><small>Remaining</small></div><div class="live-progress"><span id="v12Progress"></span></div>'+
 '<div class="ef-stage-stats"><span>Elapsed <b id="v12Elapsed">—</b></span><span>Estimated program end <b id="v12End">—</b></span></div>'+
 '<div class="ef-live-actions" id="v12OnAirActions"></div></section>'+
 '<section class="card ef-source-card"><div class="card-title"><h3>On-air source</h3><span class="muted">Operator preview</span></div>'+efMediaMarkup(now)+
 '<div class="v12-source-tools">'+(now?'<button class="secondary" id="v12ReadScript">Read script</button><button class="secondary" id="v12OpenSource">Open source ↗</button>':'')+(now?.sourceType==='file'&&efCanOperate()?'<a class="secondary" style="display:inline-block;padding:10px 14px;text-decoration:none" href="/api/events/'+encodeURIComponent(c.event.id)+'/programs/'+encodeURIComponent(now.id)+'/download">Download DJ media</a>':'')+'</div>'+
 '<p class="muted tiny">Source playback runs on this device. Status and ETA synchronize to viewers.</p></section></div>'+
 '<div class="ef-forecast-head"><div><div class="eyebrow">DYNAMIC TIMELINE</div><h3>Live running order</h3></div>'+
 '<div class="ef-forecast-metrics"><div>Expected event finish <b id="v12Finish">—</b></div><div>Schedule variance <b id="v12Delta">—</b></div></div></div>'+
 '<div class="card"><div class="v12-filter-row"><label>Program category<select id="v12LiveFilter">'+v12CategoryOptions(programs,v12LiveFilter)+'</select></label>'+
 (efCanEdit()?'<button id="v12AddProgram" class="primary">+ Add program</button>':'')+
 '<span class="muted tiny">Upcoming programs can be reordered while on air.</span></div><div id="v12LiveQueue" class="v12-queue"></div></div>'+
 '<div class="card"><div class="card-title"><h3>Award winners — live preparation</h3>'+
 '<button class="secondary" id="v12OpenAwards">Full award planner</button></div>'+
 '<div class="v12-filter-row"><label>Award category<select id="v12LiveAwardFilter">'+v12CategoryOptions(c.awards||[],v12LiveAwardFilter)+'</select></label></div>'+
 '<div id="v12LiveAwards" class="v12-queue"></div></div></div>';
 wireLock();
 $('#v12ReadScript')?.addEventListener('click',()=>v12Preview(now,true));
 $('#v12OpenSource')?.addEventListener('click',()=>v12OpenReference(now));
 $('#v12AddProgram')?.addEventListener('click',()=>programDialog());
 $('#v12OpenAwards').onclick=()=>navigate('awards');
 $('#v12LiveAwardFilter').onchange=ev=>{v12LiveAwardFilter=ev.target.value;v12RenderLiveAwards()};
 $('#v12LiveFilter').onchange=ev=>{v12LiveFilter=ev.target.value;v12RenderQueue()};
 clearInterval(state.clock);
 v12UpdateLive();
 state.clock=setInterval(()=>{if(state.page==='live')v12UpdateLive();else clearInterval(state.clock)},1000);
};
const v12OriginalAwardModal=efAwardModal;
efAwardModal=function(a){
 v12OriginalAwardModal(a);
 const f=$('#efAwardForm');
 if(!f)return;
 const fields=f.querySelector('.form-grid');
 const target=document.createElement('div');
 target.className='v12-employee-grid';
 target.innerHTML='<label>Employee ID (optional)<input name="employeeId" value="'+esc(a?.employeeId||'')+'"></label>'+
 '<label>Employee name (optional)<input name="employeeName" value="'+esc(a?.employeeName||'')+'"></label>'+
 '<label>Contact number<input type="tel" name="contact" value="'+esc(a?.contact||'')+'"></label>';
 fields.append(target);
};
const v12OriginalRenderAwards=renderAwards;
renderAwards=function(){
 v12OriginalRenderAwards();
 const c=current(),host=$('#efAwardsList');if(!c||!host)return;
 const wrap=document.createElement('div');wrap.className='v12-filter-row';
 wrap.innerHTML='<label>Award category<select id="v12AwardFilter">'+v12CategoryOptions(c.awards||[],v12AwardFilter)+'</select></label><span class="muted tiny">Filter affects display only; saved order stays unchanged</span>';
 host.parentElement.insertBefore(wrap,host);
 $('#v12AwardFilter').onchange=ev=>{v12AwardFilter=ev.target.value;v12FilterAwards()};
 v12FilterAwards();
};
function v12FilterAwards(){
 const c=current();if(!c)return;
 $$('.ef-award-item').forEach(row=>{
   const a=(c.awards||[]).find(x=>x.id===row.dataset.award);
   row.classList.toggle('hidden',!!v12AwardFilter&&(a?.category||'General')!==v12AwardFilter);
   if(a&&!row.querySelector('.v12-award-contact')){
     const details=row.querySelector('.ef-award-desc');
     if(details){const extra=document.createElement('small');extra.className='v12-award-contact';
       extra.textContent='Employee: '+([a.employeeId,a.employeeName].filter(Boolean).join(' · ')||'—')+' | Contact: '+(a.contact||'—');
       details.append(extra);}
   }
 });
}
const v12PrintCss=''; // Print layout is controlled by style.css.
function v12PrintTable(title,subtitle,heads,rows,foot){
 $('#printSheet')?.remove();
 const section=document.createElement('section');section.id='printSheet';section.className='print-only';
 const rowText=rows.map(cols=>'<tr>'+cols.map(v=>'<td title="'+esc(v)+'">'+esc(v)+'</td>').join('')+'</tr>').join('');
 section.innerHTML='<h1>'+esc(title)+'</h1><p>'+esc(subtitle)+'</p><table class="v12-print-table"><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rowText+'</tbody></table><p class="print-sub">'+esc(foot)+'</p>';
 document.body.append(section);
 window.addEventListener('afterprint',()=>section.remove(),{once:true});
 window.print();
}
printSheet=function(){
 const c=current();if(!c)return toast('Choose an event first.');
 const rows=schedule(c.event,c.programs);
 v12PrintTable(c.event.title,c.event.date+' | '+(c.event.venue||'')+' | Starts '+c.event.start,
 ['#','Category','Program','Start','End','Dur.','Gap','Employee / Presenter','Contact','File name'],
 rows.map((p,i)=>[i+1,p.category||'General',p.title,efTime(p.plannedStart),efTime(p.plannedEnd),duration(p.duration),
 duration(i===rows.length-1?0:p.gap),p.employeeName||p.presenter||'',p.contact||'',v12FileName(p)]),
 'Total programs: '+rows.length+' | Planned event end: '+efTime(finalTime(c.event,c.programs)));
};
efPrintAwards=function(){
 const c=current();if(!c)return;
 v12PrintTable(c.event.title+' — Award Winners',c.event.date+' | '+(c.event.venue||''),
 ['#','Category','Award','Winner','Employee ID','Employee Name','Contact','Presented by','Status'],
 (c.awards||[]).map((a,i)=>[i+1,a.category,a.awardName,a.winnerName,a.employeeId||'',a.employeeName||'',a.contact||'',a.presenter||'',a.status]),
 'Total awards: '+(c.awards||[]).length);
};
