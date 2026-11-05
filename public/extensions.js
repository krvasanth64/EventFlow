'use strict';
// EventFlow V1.1: live operator console and independently ordered awards.
const efClock = date => { const d=new Date(date);return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); };
const efSec = (program,now=Date.now()) => Math.max(0,Number(program.elapsedSeconds)||0)+(program.status==='running'&&(program.resumedAt||(program.elapsedSeconds===undefined&&program.actualStart))?Math.max(0,(now-Date.parse(program.resumedAt||program.actualStart))/1000):0);
const efTime = ms => efClock(ms);
const efActive = p => ['running','paused'].includes(p.status);
function efForecast(e,programs,now=Date.now()) {
  const original=schedule(e,programs);
  let cursor=Date.parse(e.date+'T'+e.start+':00');
  const isLive=e.status==='live';
  let delay=0;
  const rows=original.map((p,i)=>{
    const remaining=Math.max(0,Number(p.duration)-efSec(p,now));
    const fixed=['done','skipped'].includes(p.status);
    let start,end;
    if(fixed){
      start=p.actualStart?Date.parse(p.actualStart):Math.max(cursor,p.plannedStart);
      end=p.actualEnd?Date.parse(p.actualEnd):start+(p.status==='skipped'?0:Math.min(Number(p.duration),efSec(p,now)))*1000;
      if(!Number.isFinite(end))end=now;
      cursor=end+Number(i===programs.length-1?0:p.gap)*1000;
    }else if(efActive(p)){
      start=p.actualStart?Date.parse(p.actualStart):now;
      end=now+remaining*1000;
      cursor=end+Number(i===programs.length-1?0:p.gap)*1000;
    }else{
      start=isLive?Math.max(cursor,now):cursor;
      end=start+Number(p.duration)*1000;
      cursor=end+Number(i===programs.length-1?0:p.gap)*1000;
    }
    if(!fixed)delay=Math.max(delay,start-p.plannedStart);
    return {...p,forecastStart:start,forecastEnd:end,remaining,plannedStart:p.plannedStart,plannedEnd:p.plannedEnd};
  });
  const plannedFinish=finalTime(e,programs);
  const forecastFinish=rows.length?rows[rows.length-1].forecastEnd:plannedFinish;
  return {rows,plannedFinish,forecastFinish,delaySeconds:Math.round((forecastFinish-plannedFinish)/1000)};
}
function efFormatDelta(sec){
  const n=Math.round(sec);
  if(n===0)return 'On schedule';
  return (n>0?'+':'−')+duration(Math.abs(n))+(n>0?' late':' early');
}
function efMediaMarkup(p){
  if(!p)return '<div class="ef-no-media">No program selected.</div>';
  if(p.sourceType==='file'&&p.source){
    const ext=p.source.split('.').pop().toLowerCase();
    const url='/media/'+p.source.split('/').map(encodeURIComponent).join('/');
    const audio=['mp3','wav','ogg','m4a'].includes(ext);
    return '<div class="ef-media-wrap"><'+(audio?'audio':'video')+' id="efSourcePlayer" class="ef-source-player" controls playsinline preload="metadata" src="'+esc(url)+'"></'+(audio?'audio':'video')+'><div class="ef-media-caption">Managed media · '+esc(p.sourceName||p.source)+'</div></div>';
  }
  if(p.sourceType==='url'){
    return '<div class="ef-no-media"><div class="ef-source-symbol">↗</div><strong>External media source</strong><p>Open the source in a separate tab. Some websites prevent embedded playback.</p><a href="'+esc(p.source)+'" target="_blank" rel="noopener noreferrer">Open source URL ↗</a></div>';
  }
  if(p.sourceType==='linked'){
    return '<div class="ef-no-media"><div class="ef-source-symbol">▧</div><strong>Linked file reference</strong><p>'+esc(p.source||'No file path supplied')+'</p><small>For remote playback, upload a managed copy to EventFlow.</small></div>';
  }
  return '<div class="ef-no-media"><div class="ef-source-symbol">♬</div><strong>Live / speech program</strong><p>No audio or video file required.</p></div>';
}
function efSyncLiveUi(){
  const c=current();if(!c||state.page!=='live')return;
  const e=c.event,programs=c.programs;
  const now=programs.find(p=>efActive(p))||programs.find(p=>!['done','skipped'].includes(p.status));
  const forecast=efForecast(e,programs);
  const panel=$('#efLiveRoot');
  if(!panel||panel.dataset.event!==e.id||panel.dataset.program!==(now?.id||'')||panel.dataset.editing!==String(state.editing))return renderLive();
  const item=forecast.rows.find(p=>p.id===now?.id);
  const running=now?.status==='running',paused=now?.status==='paused';
  const time=$('#efLiveRemaining');if(time)time.textContent=now?duration(item.remaining):'00:00';
  const elapsed=$('#efLiveElapsed');if(elapsed)elapsed.textContent=now?duration(efSec(now)):'0s';
  const prog=$('#efLiveProgress');if(prog)prog.style.width=now?Math.min(100,100*efSec(now)/Math.max(now.duration,1))+'%':'0%';
  const stateBadge=$('#efLiveState');if(stateBadge)stateBadge.textContent=now?now.status.toUpperCase():'COMPLETE';
  const next=forecast.rows.find(p=>p.order>(now?.order??-1)&&!['done','skipped'].includes(p.status));
  const nextLabel=$('#efLiveNext');if(nextLabel)nextLabel.textContent=next?next.title:'Event finish';
  const eta=$('#efLiveETA');if(eta)eta.textContent=efTime(forecast.forecastFinish);
  const delta=$('#efLiveDelta');if(delta)delta.textContent=efFormatDelta(forecast.delaySeconds);
  const actionHost=$('#efLiveActions');
  if(actionHost){
    actionHost.innerHTML=state.editing&&now?
      (running?'<button class="secondary" data-live-action="pause">Ⅱ Pause</button>':
       paused?'<button class="primary" data-live-action="resume">▶ Resume</button>':
       '<button class="primary" data-live-action="start">▶ Play / Start</button>')+
      (running||paused?'<button class="secondary" data-live-action="stop">■ Stop & Reset</button><button class="primary" data-live-action="finish">✓ Finish & Next</button>':
       '<button class="secondary" data-live-action="skip">Skip Program</button>'):
      '<span class="muted">View-only mode. Acquire the event edit lock to operate.</span>';
    $$('[data-live-action]',actionHost).forEach(b=>b.onclick=()=>efLiveAction(now,b.dataset.liveAction));
  }
  const list=$('#efLiveForecast');
  if(list)list.innerHTML=forecast.rows.map((p,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(p.title)+'</td><td>'+esc(p.status)+'</td><td>'+efTime(p.plannedStart)+'</td><td>'+efTime(p.forecastStart)+'</td><td>'+efTime(p.forecastEnd)+'</td></tr>').join('');
}
async function efLiveAction(p,action){
  const c=current();if(!c||!['admin','editor','live_controller'].includes(state.user?.role))return toast('Live-control permission required.');
  const player=$('#efSourcePlayer');
  if(action==='pause'||action==='stop'||action==='finish'){if(player)player.pause();}
  if(action==='stop'&&player){try{player.currentTime=0}catch{}}
  if(['start','resume'].includes(action)&&player){
    // Initiate playback inside a user gesture; browsers may block automatic playback.
    if(action==='start'){try{player.currentTime=0}catch{}}
    player.play().catch(()=>toast('Browser blocked playback. Use the media player Play control.'));
  }
  try{
    await api('/api/events/'+c.event.id+'/live','POST',{programId:p.id,action,revision:c.event.revision});
    await loadEvent(c.event.id,false);
    efSyncLiveUi();
  }catch(err){if(player)player.pause();toast(err.message);await loadEvent(c.event.id,false);efSyncLiveUi();}
}
renderLive=function(){
  const c=current();if(!c){showEventChooser('live','Choose an event for live control');return;}
  const e=c.event,programs=c.programs,now=programs.find(p=>efActive(p))||programs.find(p=>!['done','skipped'].includes(p.status));
  const page=$('#pageLive'),key=now?.id||'';
  if($('#efLiveRoot',page)?.dataset.event===e.id&&$('#efLiveRoot',page)?.dataset.program===key&&$('#efLiveRoot',page)?.dataset.editing===String(state.editing)){
    efSyncLiveUi();return;
  }
  const item=now;
  const markup=pageHead('ON-AIR CONTROL',esc(e.title),'Live forecasts update from the current clock, completed programs and remaining durations.',editorButtons())+
  banner()+'<div id="efLiveRoot" data-event="'+esc(e.id)+'" data-program="'+esc(key)+'" data-editing="'+String(state.editing)+'">'+
  '<div class="ef-live-grid"><section class="ef-stage"><div class="ef-stage-head"><span class="tag live">● ON AIR</span><span id="efLiveState" class="ef-stage-state"></span></div><p class="ef-overline">NOW PRESENTING</p><h2 class="ef-stage-title">'+esc(now?.title||'All programs complete')+'</h2>'+
  '<div class="ef-countdown"><span id="efLiveRemaining">—</span><small>Remaining planned time</small></div><div class="live-progress"><span id="efLiveProgress"></span></div><div class="ef-stage-stats"><span>Elapsed <b id="efLiveElapsed">0s</b></span><span>Next <b id="efLiveNext">—</b></span></div><div id="efLiveActions" class="ef-live-actions"></div></section>'+
  '<section class="card ef-source-card"><div class="card-title"><h3>On-Air Media Preview</h3><span class="muted">Plays on this device</span></div>'+efMediaMarkup(item)+'<p class="muted tiny">Other viewers can open their own preview; audio playback does not automatically broadcast to their devices.</p></section></div>'+
  '<div class="ef-forecast-head"><div><div class="eyebrow">LIVE REFORECAST</div><h3>Running order & expected finish</h3></div><div class="ef-forecast-metrics"><div>Estimated finish <b id="efLiveETA">—</b></div><div>Against original plan <b id="efLiveDelta">—</b></div></div></div>'+
  '<div class="card report-preview"><table><thead><tr><th>#</th><th>Program</th><th>Status</th><th>Planned start</th><th>Revised start</th><th>Revised end</th></tr></thead><tbody id="efLiveForecast"></tbody></table></div></div>';
  page.innerHTML=markup;
  wireLock();
  clearInterval(state.clock);
  efSyncLiveUi();
  state.clock=setInterval(()=>{if(state.page==='live')efSyncLiveUi();else clearInterval(state.clock)},1000);
};
function efAwardModal(a){
  const record=a||{category:'',awardName:'',winnerName:'',recipientDetails:'',presenter:'',notes:''};
  modal(a?'Edit Award Winner':'Add Award Winner',
    '<form id="efAwardForm"><div class="form-grid">'+
    '<label>Category<input name="category" required maxlength="100" value="'+esc(record.category)+'" placeholder="Excellence Awards"></label>'+
    '<label>Award title<input name="awardName" required maxlength="160" value="'+esc(record.awardName)+'" placeholder="Best Performance"></label>'+
    '<label class="wide">Winner / recipient name<input name="winnerName" required maxlength="160" value="'+esc(record.winnerName)+'"></label>'+
    '<label>Recipient details<input name="recipientDetails" value="'+esc(record.recipientDetails)+'" placeholder="Department, group, designation"></label>'+
    '<label>Presented by<input name="presenter" value="'+esc(record.presenter)+'" placeholder="Guest or presenter"></label>'+
    '<label class="wide">Instructions / remarks<textarea name="notes">'+esc(record.notes)+'</textarea></label>'+
    '</div><div class="form-actions"><button type="button" class="secondary" id="efAwardCancel">Cancel</button><button class="primary">Save Winner</button></div></form>',
    ()=>{
      $('#efAwardCancel').onclick=closeModal;
      $('#efAwardForm').onsubmit=ev=>{ev.preventDefault();act(async()=>{
        const c=current(),body={...Object.fromEntries(new FormData(ev.target)),revision:c.event.revision};
        await api('/api/events/'+c.event.id+'/awards'+(a?'/'+a.id:''),a?'PATCH':'POST',body);
        closeModal();await loadEvent(c.event.id);toast('Award saved.');
      })};
    },'AWARD PRESENTATION');
}
async function efAwardAction(award,action){
  const c=current();if(!c||!(action==='delete'?state.editing:['admin','editor','live_controller'].includes(state.user?.role)))return;
  try{
    if(action==='delete'&&!confirm('Delete this award entry?'))return;
    await api('/api/events/'+c.event.id+'/awards/'+award.id,action==='delete'?'DELETE':'PATCH',
      {revision:c.event.revision,...(action==='delete'?{}:{status:action})});
    await loadEvent(c.event.id);
  }catch(e){toast(e.message)}
}
async function efAwardReorder(ids){
  const c=current();try{
    await api('/api/events/'+c.event.id+'/awards/reorder','POST',{revision:c.event.revision,ids});
    await loadEvent(c.event.id);
  }catch(e){toast(e.message)}
}
function efMoveAward(id,delta){
  const ids=current().awards.map(a=>a.id),from=ids.indexOf(id),to=from+delta;
  if(from<0||to<0||to>=ids.length)return;
  [ids[from],ids[to]]=[ids[to],ids[from]];efAwardReorder(ids);
}
function efPrintAwards(){
  const c=current();if(!c)return;
  $('#printSheet')?.remove();
  const doc=document.createElement('section');doc.id='printSheet';doc.className='print-only';
  doc.innerHTML='<h1>'+esc(c.event.title)+' — Award Winners</h1><p>'+esc(c.event.date)+' · '+esc(c.event.venue||'')+'</p><table><thead><tr><th>#</th><th>Award ID</th><th>Category</th><th>Award</th><th>Winner</th><th>Details</th><th>Presented by</th><th>Status</th></tr></thead><tbody>'+
  (c.awards||[]).map((a,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(a.awardCode||'')+'</td><td>'+esc(a.category)+'</td><td>'+esc(a.awardName)+'</td><td>'+esc(a.winnerName)+'</td><td>'+esc(a.recipientDetails)+'</td><td>'+esc(a.presenter)+'</td><td>'+esc(a.status)+'</td></tr>').join('')+'</tbody></table><p class="print-sub">Total awards: '+(c.awards||[]).length+'</p>';
  document.body.append(doc);window.addEventListener('afterprint',()=>doc.remove(),{once:true});window.print();
}
function renderAwards(){
  const c=current();if(!c){showEventChooser('awards','Choose an event for awards');return;}
  const e=c.event,awards=c.awards||[],done=awards.filter(a=>a.status==='presented').length;
  $('#pageAwards').innerHTML=pageHead('AWARD WINNER PLANNER',esc(e.title)+' · Awards',
    'A separate, ordered presentation list. Reordering awards does not change the event program timeline.',
    (state.editing?'<button class="primary" id="efAddAward">+ Add Winner</button>':'')+
    '<button class="secondary" id="efAwardPrint">Print / PDF</button>'+editorButtons())+banner()+
    '<div class="stats">'+stat('Total awards',awards.length,'Recipient entries')+stat('Presented',done,'Already presented')+
    stat('Remaining',awards.length-done,'Pending or skipped')+stat('Event date',esc(e.date),'Award ceremony')+'</div>'+
    '<div class="card"><div class="card-title"><h3>Award presentation order</h3><span class="muted">Drag to reorder or use ↑ / ↓</span></div>'+
    '<div class="program-list" id="efAwardsList">'+(awards.map((a,i)=>
      '<div class="ef-award-item" data-award="'+esc(a.id)+'" draggable="'+state.editing+'">'+
      '<span class="grip" title="Drag award to reorder">⠿</span><span class="program-num">'+String(i+1).padStart(2,'0')+'</span>'+
      '<div class="ef-award-desc"><strong>'+esc(a.awardName)+'</strong><small>'+esc(a.category)+' · Winner: '+esc(a.winnerName)+(a.recipientDetails?' · '+esc(a.recipientDetails):'')+'</small>'+
      '<small>Presented by: '+esc(a.presenter||'Not assigned')+'</small></div><span class="tag '+(a.status==='presented'?'live':'')+'">'+esc(a.status)+'</span>'+
      (state.editing?'<div class="ef-award-actions"><button data-award-action="up" title="Move up">↑</button><button data-award-action="down" title="Move down">↓</button><button data-award-action="edit">Edit</button>'+
      (a.status!=='presented'?'<button data-award-action="presented">Mark presented</button>':'<button data-award-action="pending">Reopen</button>')+
      '<button data-award-action="delete" class="danger" title="Remove winner">×</button></div>':'')+'</div>'
    ).join('')||'<div class="empty"><strong>No awards registered</strong>Add winners to organize the award presentation order.</div>')+'</div></div>';
  wireLock();
  $('#efAddAward')?.addEventListener('click',()=>efAwardModal());
  $('#efAwardPrint').onclick=efPrintAwards;
  $$('.ef-award-item').forEach(el=>{
    const a=awards.find(x=>x.id===el.dataset.award);
    $$('[data-award-action]',el).forEach(b=>b.onclick=()=>{
      const action=b.dataset.awardAction;
      if(action==='edit')efAwardModal(a);
      else if(action==='up'||action==='down')efMoveAward(a.id,action==='up'?-1:1);
      else efAwardAction(a,action);
    });
    if(state.editing){
      el.addEventListener('dragstart',ev=>ev.dataTransfer.setData('text/plain',a.id));
      el.addEventListener('dragover',ev=>ev.preventDefault());
      el.addEventListener('drop',ev=>{
        ev.preventDefault();const from=ev.dataTransfer.getData('text/plain'),ids=awards.map(x=>x.id);
        if(!ids.includes(from)||from===a.id)return;ids.splice(ids.indexOf(from),1);ids.splice(ids.indexOf(a.id),0,from);efAwardReorder(ids);
      });
    }
  });
}
