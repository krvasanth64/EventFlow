'use strict';
// Excel import wizard + demo studio + high-contrast backstage operations.
let ef17File=null,ef17Preview=null;
const ef17Text=v=>esc(v??'');
const ef17Operator=()=>['admin','editor','live_controller'].includes(state.user?.role);
function ef17Badge(kind,text){return '<span class="ef17-chip ef17-'+kind+'">'+ef17Text(text)+'</span>'}
async function ef17DownloadTemplate(full=false){
 const url='/api/import/template'+(full?'?sample=full':'');
 const response=await fetch(url,{credentials:'same-origin'});
 if(!response.ok)throw Error('Template download failed: '+response.status);
 const blob=await response.blob(),href=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=href;a.download=full?'EventFlow_Full_Example.xlsx':'EventFlow_Import_Template.xlsx';
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),1200);
}
function ef17PreviewMarkup(data){
 if(!data)return '<p class="muted">Choose the completed XLSX workbook. Preview validates the event before saving.</p>';
 const rows=data.errors||[];
 return '<div class="ef17-preview">'+
 '<div class="ef17-preview-heading"><div><strong>'+ef17Text(data.event?.title||'Untitled Event')+'</strong><small>'+ef17Text(data.event?.date||'')+' · '+ef17Text(data.event?.start||'')+'</small></div>'+
 ef17Badge(data.valid?'good':'danger',data.valid?'Ready for import':rows.length+' issue(s)')+'</div>'+
 '<div class="ef17-metrics"><div><strong>'+data.counts.programs+'</strong><small>Programs</small></div><div><strong>'+data.counts.participants+'</strong><small>Participants</small></div><div><strong>'+data.counts.awards+'</strong><small>Awards</small></div></div>'+
 (rows.length?'<div class="ef17-errors"><h4>Correct these workbook issues</h4>'+rows.map(err=>'<p>'+ef17Text(err)+'</p>').join('')+'</div>':
 '<p class="ef17-success">Validation passed. Import will create a new event; existing events will not be modified.</p>')+
 '</div>';
}
function ef17RenderImport(){
 const host=$('#pageImport');if(!host)return;
 if(!['admin','editor'].includes(state.user?.role)){host.innerHTML='<div class="empty">Admin or Editor permission required.</div>';return}
 host.innerHTML=pageHead('EXCEL EVENT IMPORT','Import & Demo Studio','Create a fully structured event from Excel, or generate rehearsal data without touching real events.')+
 '<div class="ef17-import-layout"><section class="card ef17-workbook"><div class="ef17-step">01 · DOWNLOAD TEMPLATE</div><h3>Excel workbook template</h3>'+
 '<p class="muted">Four connected sheets: Event, Programs, Participants and Awards. Program Ref links participant rows, while the app creates permanent P#### and A#### codes.</p>'+
 '<div class="ef17-buttons"><button id="ef17Template" class="secondary">Download template .xlsx</button><button id="ef17Example" class="secondary">Full sample workbook</button></div>'+
 '<div class="ef17-step">02 · UPLOAD & VALIDATE</div><h3>Choose your Excel file</h3>'+
 '<label class="ef17-filepicker"><input type="file" id="ef17File" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><span>Choose XLSX file (max 8 MB)</span></label>'+
 '<div class="ef17-buttons"><button class="primary" id="ef17Validate">Preview & validate</button><button class="secondary" id="ef17Reset">Clear</button></div>'+
 '<div class="ef17-step">03 · REVIEW & IMPORT</div><div id="ef17Preview">'+ef17PreviewMarkup(ef17Preview)+'</div>'+
 '<button class="primary" id="ef17Apply" '+(!ef17Preview?.valid?'disabled':'')+'>Create Event from Excel</button>'+
 '<p class="muted tiny">Source URLs and linked paths are imported as references. Excel cannot contain uploaded media bytes: upload audio/video in the program editor after import.</p>'+
 '</section><aside class="card ef17-demo"><div class="ef17-step">DEMO STUDIO</div><h3>Full event rehearsal</h3>'+
 '<p class="muted">Generate an independent demo event with 8 programs, 4 awards, participant rosters, example URLs and two original WAV test media files.</p>'+
 '<div id="ef17DemoSettings" class="ef17-demo-settings">Loading demo settings…</div></aside></div>';
 $('#ef17Template').onclick=()=>act(()=>ef17DownloadTemplate(false));
 $('#ef17Example').onclick=()=>act(()=>ef17DownloadTemplate(true));
 $('#ef17File').onchange=ev=>{ef17File=ev.target.files?.[0]||null;ef17Preview=null;$('#ef17Preview').innerHTML=ef17PreviewMarkup(null);$('#ef17Apply').disabled=true};
 $('#ef17Reset').onclick=()=>{ef17File=null;ef17Preview=null;$('#ef17File').value='';$('#ef17Preview').innerHTML=ef17PreviewMarkup(null);$('#ef17Apply').disabled=true};
 $('#ef17Validate').onclick=()=>act(async()=>{
  if(!ef17File)throw Error('Select an .xlsx workbook first.');
  if(ef17File.size>8*1024*1024)throw Error('Maximum file size is 8 MB.');
  const result=await fetch('/api/import/preview',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream'},body:ef17File});
  const data=await result.json();if(!result.ok)throw Error(data.error||'Preview failed');
  ef17Preview=data;$('#ef17Preview').innerHTML=ef17PreviewMarkup(data);$('#ef17Apply').disabled=!data.valid;
 });
 $('#ef17Apply').onclick=()=>act(async()=>{
  if(!ef17File||!ef17Preview?.valid)throw Error('Preview a valid workbook first.');
  if(!confirm('Create a NEW Event from this workbook? Existing events will remain unchanged.'))return;
  const response=await fetch('/api/import/apply',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream'},body:ef17File});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Import failed');
  ef17File=null;ef17Preview=null;
  toast('Imported '+data.counts.programs+' programs and '+data.counts.awards+' awards.');
  await loadEvents();await loadEvent(data.event.id);navigate('planner');
 });
 ef17LoadDemoSettings();
}
async function ef17LoadDemoSettings(){
 const node=$('#ef17DemoSettings');if(!node)return;
 try{
  const data=await api('/api/demo/settings');
  if(!node.isConnected)return;
  if(state.user.role!=='admin'){
   node.innerHTML=ef17Badge(data.enabled?'good':'muted',data.enabled?'Demo enabled':'Demo hidden')+'<p class="muted tiny">Only an Admin can manage demo events.</p>';
   return;
  }
  node.innerHTML='<div class="ef17-demo-toggle"><div><b>Demo events visibility</b><small>Disabled demo events remain stored but hidden from other users.</small></div>'+
   '<label><input id="ef17DemoToggle" type="checkbox" '+(data.enabled?'checked':'')+'><span>'+ (data.enabled?'Enabled':'Disabled')+'</span></label></div>'+
   '<button class="primary" id="ef17DemoCreate" '+(!data.enabled?'disabled':'')+'>+ Create full demo event</button>'+
   '<p class="muted tiny">Demo creation is admin-only. Demo programs include sample audio tones, not copyrighted songs.</p>';
  $('#ef17DemoToggle').onchange=ev=>act(async()=>{
   const result=await api('/api/demo/settings','PUT',{enabled:ev.target.checked});
   await loadEvents();ef17LoadDemoSettings();toast('Demo events '+(result.enabled?'enabled':'hidden'));
  });
  $('#ef17DemoCreate').onclick=()=>act(async()=>{
   if(!confirm('Create a new independent sample event?'))return;
   const result=await api('/api/demo/create','POST',{});
   await loadEvents();await loadEvent(result.event.id);navigate('prep');
   toast('Demo created: '+result.counts.programs+' programs, '+result.counts.awards+' awards.');
  });
 }catch(e){if(node.isConnected)node.textContent=e.message}
}
const ef17BaseRender=render;
render=function(){if(state.page==='import')return ef17RenderImport();return ef17BaseRender()};
const ef17BasePrep=renderPrep;
renderPrep=function(){
 ef17BasePrep();
 const host=$('#pagePrep'),c=current();if(!c||!host)return;
 const active=c.programs.find(x=>['running','paused'].includes(x.status));
 const four=ef16Upcoming(),all=four.flatMap(x=>x.participants||[]),ready=all.filter(x=>x.checkedIn).length;
 const percent=all.length?Math.round(ready/all.length*100):0;
 const existing=host.querySelector('.ef17-prep-hero');if(existing)existing.remove();
 const hero=document.createElement('section');hero.className='ef17-prep-hero';
 hero.innerHTML='<div class="ef17-prep-heading"><div><div class="ef17-kicker">STAGE OPERATIONS · LIVE READINESS</div>'+
 '<h2>Next 4 program preparation</h2><p>Check arrivals, coordinate performers and respond to running-order changes.</p></div>'+
 '<div class="ef17-prep-live">'+ef17Badge(active?'live':'muted',active?'ON AIR':'STANDBY')+
 '<strong>'+ef17Text(active?(active.programCode+' · '+active.title):'No active performance')+'</strong></div></div>'+
 '<div class="ef17-prep-stats"><div><b>'+four.length+'</b><span>Upcoming programs</span></div>'+
 '<div><b>'+all.length+'</b><span>Expected participants</span></div>'+
 '<div><b>'+ready+'</b><span>Checked in</span></div>'+
 '<div><b>'+percent+'%</b><span>Overall readiness</span></div></div>'+
 '<div class="ef17-prep-progress"><div style="width:'+percent+'%"></div></div>';
 const summary=host.querySelector('.ef16-prep-summary');if(summary)summary.replaceWith(hero);
 const cards=[...host.querySelectorAll('.ef16-prep-card')];
 cards.forEach((card,index)=>{
  const p=four[index];if(!p)return;
  card.classList.add('ef17-backstage-card');if(index===0)card.classList.add('ef17-up-next');
  const readyCount=(p.participants||[]).filter(x=>x.checkedIn).length;
  const total=(p.participants||[]).length;const complete=total>0&&readyCount===total;
  const top=card.querySelector('.ef16-prep-top');
  if(top)top.insertAdjacentHTML('afterend','<div class="ef17-card-line">'+
    ef17Badge(index===0?'live':'upcoming',index===0?'NEXT ON STAGE':'UPCOMING '+(index+1))+
    ef17Badge(complete?'good':total?'warning':'muted',complete?'All ready':total?readyCount+' waiting/ready':'No roster')+
    '</div><div class="ef17-card-progress"><span style="width:'+(total?100*readyCount/total:0)+'%"></span></div>');
 });
};
