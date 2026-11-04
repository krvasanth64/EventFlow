'use strict';
/* EventFlow V1.4 — add independently authorized live control. */
const efCanOperate=()=>['admin','editor','live_controller'].includes(state.user?.role);
const efCanEdit=()=>state.editing&&['admin','editor'].includes(state.user?.role);
const EF13_DEFAULT = {
 programTypes:['Solo Dance','Group Dance','Drama','Magic Show','Stand-up Comedy','Speech','Karaoke Singing','Solo Singing','Group Singing','Instrumental Music','DJ Performance','Mime','Awards Ceremony','Welcome Address','Vote of Thanks','Other','speech','dance','music','video','ceremony','break','other'],
 programCategories:['General','Cultural','Music','Dance','Speech','Entertainment','Awards','Ceremony','Break'],
 awardCategories:['General','Excellence','Performance','Service','Team','Special Recognition'],
 awardTitles:['Best Performer','Best Team','Long Service','Outstanding Achievement','Special Recognition'],
 presenters:['Chief Guest','Managing Director','HR Head','Event Host'],
 mediaTypes:['none','file','url','linked']
};
const EF13_LABELS={programTypes:'Program types',programCategories:'Program categories',awardCategories:'Award categories',awardTitles:'Award titles',presenters:'Presenters / Presented by',mediaTypes:'Media source options'};
const EF13_MEDIA={none:'No source',file:'Upload file',url:'Web URL',linked:'Host file reference'};
const ef13Cats=()=>{const stored=current()?.event?.catalogs||{};return Object.fromEntries(Object.entries(EF13_DEFAULT).map(([k,values])=>[k,(stored[k]?.length?stored[k]:values.map(name=>({name,enabled:true}))).map(x=>typeof x==='string'?{name:x,enabled:true}:x)]));};
const ef13Values=(key,existing='')=>{const enabled=ef13Cats()[key].filter(x=>x.enabled).map(x=>x.name);if(existing&&!enabled.includes(existing))enabled.push(existing);return enabled;};
const ef13Options=(key,selected)=>ef13Values(key,selected).map(v=>'<option value="'+esc(v)+'" '+(v===selected?'selected':'')+'>'+esc(key==='mediaTypes'?(EF13_MEDIA[v]||v):v)+'</option>').join('');
function ef13CatalogDialog(){
 const c=current();if(!c)return toast('Choose an event first.');
 if(!state.editing)return toast('Acquire editing control before changing event settings.');
 const catalogs=ef13Cats();
 modal('Event dropdown settings','<div class="ef13-catalogs">'+Object.keys(EF13_DEFAULT).map(k=>'<section class="ef13-catalog" data-catalog="'+k+'">'+
 '<div class="card-title"><h3>'+esc(EF13_LABELS[k])+'</h3><button class="secondary" data-add="'+k+'">+ Add option</button></div>'+
 '<div class="ef13-catalog-list">'+catalogs[k].map(x=>ef13CatalogRow(x)).join('')+'</div></section>').join('')+'</div>'+
 '<div class="form-actions"><button class="secondary" id="ef13CancelCat">Cancel</button><button class="primary" id="ef13SaveCat">Save dropdown settings</button></div>',()=>{
   $('#ef13CancelCat').onclick=closeModal;
   $$('[data-add]').forEach(b=>b.onclick=()=>{
     const host=b.closest('.ef13-catalog').querySelector('.ef13-catalog-list');
     host.insertAdjacentHTML('beforeend',ef13CatalogRow({name:'',enabled:true}));
     host.lastElementChild.querySelector('input[type=text]').focus();
   });
   $('#ef13SaveCat').onclick=()=>act(async()=>{
     const payload={};
     $$('.ef13-catalog').forEach(section=>{
       const name=section.dataset.catalog;
       payload[name]=$$('.ef13-catalog-entry',section).map(row=>({
         name:row.querySelector('input[type=text]').value.trim(),
         enabled:row.querySelector('input[type=checkbox]').checked
       })).filter(x=>x.name);
     });
     const c=current();
     await api('/api/events/'+c.event.id,'PATCH',{revision:c.event.revision,catalogs:payload});
     closeModal();await loadEvent(c.event.id);toast('Event dropdown settings saved.');
   });
 },'CONFIGURATION');
}
function ef13CatalogRow(x){
 return '<div class="ef13-catalog-entry"><input type="text" maxlength="90" aria-label="Option name" value="'+esc(x.name)+'">'+
 '<label class="ef13-toggle"><input type="checkbox" '+(x.enabled?'checked':'')+'> Enabled</label>'+
 '<button class="secondary ef13-remove" type="button" onclick="this.closest(\'.ef13-catalog-entry\').remove()">×</button></div>';
}
function ef13EnhanceProgramDialog(p){
 const type=$('#programForm select[name=type]'),cat=$('#programForm [name=category]'),presenter=$('#programForm [name=presenter]'),media=$('#programForm [name=sourceType]');
 if(!type||!cat)return;
 type.innerHTML=ef13Options('programTypes',p?.type||'Speech');
 type.value=p?.type||ef13Values('programTypes')[0]||'Speech';
 const newCat=document.createElement('select');newCat.name='category';newCat.innerHTML=ef13Options('programCategories',p?.category||'General');
 cat.replaceWith(newCat);
 const newPresenter=document.createElement('select');newPresenter.name='presenter';newPresenter.innerHTML='<option value="">Not assigned</option>'+ef13Options('presenters',p?.presenter||'');presenter.replaceWith(newPresenter);
 media.innerHTML=ef13Options('mediaTypes',p?.sourceType||'none');
 media.value=p?.sourceType||'none';media.dispatchEvent(new Event('change'));
 const form=$('#programForm'),script=form.querySelector('[name=scriptUpload]');
 const scriptLabel=script?.closest('label');
 if(scriptLabel){
   scriptLabel.classList.add('ef13-script-input');
   const toggle=document.createElement('label');toggle.className='wide ef13-script-toggle';
   toggle.innerHTML='<span><input type="checkbox" id="ef13ScriptEnabled" '+(p?.scriptSource?'checked':'')+'> Attach reading-script photo/PDF (optional)</span>';
   scriptLabel.before(toggle);
   scriptLabel.classList.toggle('hidden',!p?.scriptSource);
   $('#ef13ScriptEnabled').onchange=ev=>scriptLabel.classList.toggle('hidden',!ev.target.checked);
 }
 if(p){
   const extra=document.createElement('section');extra.className='wide ef13-existing-sources';
   extra.innerHTML='<h3>Currently attached sources</h3>'+
    '<div class="ef13-source-info"><b>Media</b><span>'+esc(p.sourceType==='file'?(p.sourceName||p.source||'File'):(p.sourceType==='url'?p.source:'No file uploaded'))+'</span>'+
    (p.sourceType==='file'&&p.source?'<button type="button" class="secondary" data-archive-kind="media">Archive media</button>':'')+'</div>'+
    '<div class="ef13-source-info"><b>Reading script</b><span>'+esc(p.scriptName||'No script attached')+'</span>'+
    (p.scriptSource?'<button type="button" class="secondary" data-archive-kind="script">Archive script</button>':'')+'</div>'+
    '<p class="muted tiny">Replacing a managed file archives its old version. Archived files remain stored until an administrator cleans them up.</p>';
   form.querySelector('.form-grid').append(extra);
   $$('[data-archive-kind]',extra).forEach(btn=>btn.onclick=()=>act(async()=>{
     if(!confirm('Archive this '+btn.dataset.archiveKind+'? The stored file will be retained.'))return;
     const c=current();
     const next=await api('/api/events/'+c.event.id+'/programs/'+p.id+'/archive','POST',{kind:btn.dataset.archiveKind,revision:c.event.revision});
     state.current=next;closeModal();render();toast('Source archived.');programDialog(next.programs.find(x=>x.id===p.id));
   }));
 }
}
const ef13BaseProgramDialog=programDialog;
programDialog=function(p){ef13BaseProgramDialog(p);ef13EnhanceProgramDialog(p);};
const ef13BaseAwardModal=efAwardModal;
efAwardModal=function(a){
 ef13BaseAwardModal(a);
 const form=$('#efAwardForm');if(!form)return;
 for(const [field,key,selected] of [['category','awardCategories',a?.category||'General'],['awardName','awardTitles',a?.awardName||''],['presenter','presenters',a?.presenter||'']]){
   const input=form.querySelector('[name='+field+']');
   if(!input)continue;
   const select=document.createElement('select');select.name=field;
   select.innerHTML=(field==='presenter'||field==='awardName'?'<option value="">Select '+field+'</option>':'')+ef13Options(key,selected);
   select.value=selected;
   input.replaceWith(select);
 }
};
function ef13ConditionalActions(p,editor,active){
 const canPlay=!active||active.id===p.id;
 const isRunning=p.status==='running',isPaused=p.status==='paused';
 let h='';
 if(p.sourceType==='file'&&p.source)h+='<button data-cmd="preview">Preview</button><button data-cmd="open">Open ↗</button>';
 else if(p.sourceType==='url'&&p.source)h+='<button data-cmd="open">Open URL ↗</button>';
 else if(p.sourceType==='linked'&&p.source)h+='<button data-cmd="open">File reference</button>';
 if(p.scriptSource)h+='<button data-cmd="script">Read script</button>';
 if(!editor)return h;
 if(efCanEdit())h+='<button data-cmd="edit">Edit</button>';
 h+='<button data-cmd="up" title="Move program up">↑</button><button data-cmd="down" title="Move program down">↓</button>';
 if(isRunning)h+='<button data-cmd="pause">Pause</button><button data-cmd="finish">Finish</button>';
 else if(isPaused)h+='<button data-cmd="resume">Resume</button><button data-cmd="stop">Stop</button>';
 else if(canPlay&&['done','skipped'].includes(p.status))h+='<button data-cmd="replay">Replay</button>';
 else if(canPlay&&['pending','ready','stopped'].includes(p.status))h+='<button data-cmd="start">Play</button>';
 return h;
}
v12QueueRow=function(p,i,forecast,active){
 const scheduled=forecast.rows.find(x=>x.id===p.id);
 return '<div class="v12-live-row ef13-compact-row" data-id="'+esc(p.id)+'" draggable="'+efCanOperate()+'">'+
 '<span class="grip" draggable="'+efCanOperate()+'" title="Drag program to a new position">⠿</span><span class="program-num">'+(i+1)+'</span>'+
 '<div class="v12-live-info"><strong title="'+esc(p.title)+'">'+esc(p.title)+'</strong>'+
 '<small>'+esc(p.category||'General')+' · '+esc(p.employeeName||p.presenter||'—')+' · '+esc(p.contact||'')+'</small>'+
 '<small>'+efTime(scheduled.forecastStart)+'–'+efTime(scheduled.forecastEnd)+' · '+duration(p.duration)+'</small></div>'+
 '<span class="tag '+(efActive(p)?'live':'')+'">'+esc(p.status)+'</span>'+
 '<div class="v12-row-actions">'+ef13ConditionalActions(p,efCanOperate(),active)+'</div></div>';
};
function ef13PersistOrder(from,to){
 const c=current(),all=c?.programs||[];if(!c||!efCanOperate())return;
 const ids=all.map(x=>x.id),fromIndex=ids.indexOf(from),toIndex=ids.indexOf(to);
 if(fromIndex<0||toIndex<0||fromIndex===toIndex)return;
 ids.splice(fromIndex,1);ids.splice(toIndex,0,from);
 act(async()=>{
   const result=await api('/api/events/'+c.event.id+'/reorder','POST',{revision:c.event.revision,ids});
   state.current=result;renderLive();toast('Running order saved.');
 });
}
v12RenderQueue=function(){
 const c=current(),host=$('#v12LiveQueue');if(!c||!host)return;
 const all=c.programs,forecast=efForecast(c.event,all),active=all.find(efActive);
 const filtered=all.filter(p=>!v12LiveFilter||(p.category||'General')===v12LiveFilter);
 host.innerHTML=filtered.map(p=>v12QueueRow(p,all.indexOf(p),forecast,active)).join('')||'<div class="empty"><strong>No programs in this category</strong>Choose All categories to view all programs.</div>';
 $$('.v12-live-row',host).forEach(row=>{
   const p=all.find(x=>x.id===row.dataset.id);
   $$('[data-cmd]',row).forEach(btn=>btn.onclick=()=>v12QueueCommand(p,btn.dataset.cmd));
   if(!efCanOperate())return;
   row.addEventListener('dragstart',event=>{
     event.dataTransfer.effectAllowed='move';
     event.dataTransfer.setData('text/plain',p.id);
     row.classList.add('ef13-dragging');
   });
   row.addEventListener('dragend',()=>row.classList.remove('ef13-dragging'));
   row.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='move';row.classList.add('ef13-drop-target')});
   row.addEventListener('dragleave',()=>row.classList.remove('ef13-drop-target'));
   row.addEventListener('drop',event=>{
     event.preventDefault();row.classList.remove('ef13-drop-target');
     ef13PersistOrder(event.dataTransfer.getData('text/plain'),p.id);
   });
 });
};
v12QueueCommand=function(p,action){
 if(action==='preview')return v12Preview(p);
 if(action==='script')return v12Preview(p,true);
 if(action==='open')return v12OpenReference(p);
 if(action==='edit')return efCanEdit()?programDialog(p):toast('Editor permission required.');
 if(action==='up'||action==='down'){
   const items=current().programs,idx=items.findIndex(x=>x.id===p.id),next=items[idx+(action==='up'?-1:1)];
   return next?ef13PersistOrder(p.id,next.id):undefined;
 }
 if(['start','replay','pause','resume','stop','finish','skip'].includes(action)){
   if(action==='replay')return act(async()=>{
     const c=current(),player=$('#efSourcePlayer');if(player)player.pause();
     const x=await api('/api/events/'+c.event.id+'/live','POST',{programId:p.id,action:'replay',revision:c.event.revision});
     state.current=x;renderLive();
   });
   return efLiveAction(p,action);
 }
};
let ef13MediaTransition=false;
async function ef13PlayProgram(p,action){
 const c=current();if(!c||!efCanOperate())return toast('Live-control permission required.');
 if(p.sourceType==='url'&&!confirm('External URL playback cannot be detected. Start the program clock now?'))return;
 const player=$('#efSourcePlayer'),onStage=$('#v12LiveRoot')?.dataset.program===p.id;
 ef13MediaTransition=true;
 try{
   // Current on-stage media can be started by a direct user gesture.
   if(p.sourceType==='file'&&onStage&&player){
     try{if(action!=='resume')player.currentTime=0;await player.play();}
     catch{toast('Media could not play. The program timer has not started.');return;}
   }
   const result=await api('/api/events/'+c.event.id+'/live','POST',{programId:p.id,action,revision:c.event.revision});
   state.current=result;renderLive();
   if(p.sourceType==='file'&&!onStage){
     const next=$('#efSourcePlayer');
     try{if(!next)throw Error('Preview unavailable');await next.play();}
     catch{
       const fresh=current();
       const paused=await api('/api/events/'+fresh.event.id+'/live','POST',{programId:p.id,action:'pause',revision:fresh.event.revision});
       state.current=paused;renderLive();
       toast('Browser blocked automatic media playback. Program timer paused. Use the media Play control to resume.');
     }
   }
 }catch(err){player?.pause();toast(err.message);try{await loadEvent(c.event.id)}catch{}}
 finally{ef13MediaTransition=false;}
}
const ef13OldLiveAction=efLiveAction;
efLiveAction=function(p,action){
 if(['start','replay','resume'].includes(action))return ef13PlayProgram(p,action);
 ef13MediaTransition=true;
 return Promise.resolve(ef13OldLiveAction(p,action)).finally(()=>{ef13MediaTransition=false;});
};
function ef13BindPlayback(){
 const media=$('#efSourcePlayer'),id=$('#v12LiveRoot')?.dataset.program;
 if(!media||!id||media.dataset.ef13Bound)return;
 media.dataset.ef13Bound='1';
 const sendAction=action=>{
   if(ef13MediaTransition||!efCanOperate())return;
   const p=current()?.programs?.find(x=>x.id===id);
   if(p)efLiveAction(p,action);
 };
 media.addEventListener('pause',()=>{
   const p=current()?.programs?.find(x=>x.id===id);
   if(p?.status==='running')sendAction('pause');
 });
 media.addEventListener('ended',()=>{
   const p=current()?.programs?.find(x=>x.id===id);
   if(p?.status==='running')sendAction('pause');
 });
 media.addEventListener('play',()=>{
   const p=current()?.programs?.find(x=>x.id===id);
   if(p?.status==='paused')sendAction('resume');
   else if(['pending','ready','stopped'].includes(p?.status))sendAction('start');
 });
}
const ef13BaseRenderLive=renderLive;
renderLive=function(){
 ef13BaseRenderLive();
 ef13BindPlayback();
 const c=current(),host=$('#pageLive');if(!c||!host)return;
 const head=host.querySelector('.head-actions');
 if(state.editing&&head&&!head.querySelector('#ef13EventSettings')){
   const button=document.createElement('button');button.id='ef13EventSettings';button.className='secondary';button.textContent='Event dropdown settings';
   button.onclick=ef13CatalogDialog;head.prepend(button);
 }
 const active=c.programs.find(p=>p.status==='running'||p.status==='paused')||c.programs.find(p=>!['done','skipped'].includes(p.status));
 const script=$('#v12ReadScript'),source=$('#v12OpenSource');
 if(script)script.classList.toggle('hidden',!active?.scriptSource);
 if(source)source.classList.toggle('hidden',!(active&&(active.sourceType==='file'&&active.source||active.sourceType==='url'&&active.source)));
 const externalHint=host.querySelector('#ef13ExternalClockHint');
 if(active?.sourceType==='url'&&active.source&&!externalHint){
   const mediaHost=host.querySelector('.ef-source-card');
   if(mediaHost){const hint=document.createElement('p');hint.id='ef13ExternalClockHint';hint.className='muted tiny';hint.textContent='External URLs cannot report playback state. Start the on-air timer only when external playback begins.';mediaHost.append(hint);}
 }
 const note=host.querySelector('.v12-filter-row .muted.tiny');
 if(note)note.textContent='Drag any program to reorder. Playback stays attached to the current program ID.';
};
const ef13BasePlanner=renderPlanner;
renderPlanner=function(){
 ef13BasePlanner();
 const head=$('#pagePlanner .head-actions');
 if(head&&state.editing&&!head.querySelector('#ef13EventSettingsPlanner')){
   const b=document.createElement('button');b.id='ef13EventSettingsPlanner';b.className='secondary';b.textContent='Dropdown settings';
   b.onclick=ef13CatalogDialog;head.prepend(b);
 }
};
const ef13BaseRenderAwards=renderAwards;
renderAwards=function(){
 ef13BaseRenderAwards();
 const head=$('#pageAwards .head-actions');
 if(head&&state.editing&&!head.querySelector('#ef13EventSettingsAwards')){
   const b=document.createElement('button');b.id='ef13EventSettingsAwards';b.className='secondary';b.textContent='Dropdown settings';
   b.onclick=ef13CatalogDialog;head.prepend(b);
 }
};
const ef13BaseReports=renderReports;
renderReports=function(){
 ef13BaseReports();
 const head=$('#pageReports .head-actions'),c=current();
 if(!c||!head)return;
 if(!head.querySelector('#ef13AwardPDF')){
   const b=document.createElement('button');b.id='ef13AwardPDF';b.className='secondary';b.textContent='Award Winners PDF';
   b.onclick=efPrintAwards;head.append(b);
 }
 const container=$('#pageReports .card');
 if(container&&!container.querySelector('.ef13-report-awards')){
   const div=document.createElement('div');div.className='ef13-report-awards';
   div.innerHTML='<h3>Award Winners ('+(c.awards||[]).length+')</h3>'+
   '<div class="report-preview"><table><thead><tr><th>#</th><th>Category</th><th>Award</th><th>Winner</th><th>Presented by</th></tr></thead><tbody>'+
   (c.awards||[]).map((a,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(a.category)+'</td><td>'+esc(a.awardName)+'</td><td>'+esc(a.winnerName)+'</td><td>'+esc(a.presenter)+'</td></tr>').join('')+'</tbody></table></div>';
   container.after(div);
 }
};
