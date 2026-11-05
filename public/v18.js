'use strict';
// EventFlow V1.4.8 - PDF layout editor and existing-event Excel section imports.
const ef18Defs={
 programs:[
  ['order','Order',5],['programCode','Program ID',8],['title','Program',23],['type','Type',12],
  ['category','Category',11],['presenter','Presenter',14],['duration','Duration',8],
  ['gap','Gap',7],['status','Status',9],['sourceType','Media Type',10],['source','Source URL / File',22],
  ['participants','Participants',9],['ready','Ready',7],['notes','Instructions',18]],
 awards:[
  ['order','Order',5],['awardCode','Award ID',8],['category','Category',15],
  ['awardName','Award Title',25],['winnerName','Winner',18],['presenter','Presented By',16],
  ['status','Status',9],['recipientDetails','Winner Details',20],
  ['employeeId','Employee Code',12],['contact','Contact',12],['notes','Notes',19]]
};
const ef18Default={
 programs:['order','programCode','title','type','duration','presenter','status'],
 awards:['order','awardCode','category','awardName','winnerName','presenter','status']
};
function ef18Layout(kind){
 const key='eventflow-pdf-layout-'+kind;
 let saved=null;try{saved=JSON.parse(localStorage.getItem(key)||'null')}catch{}
 const dict=new Map(ef18Defs[kind].map(x=>[x[0],x]));
 let cols=(Array.isArray(saved?.columns)?saved.columns:ef18Default[kind].map(key=>({key})))
  .filter(x=>dict.has(x.key)).map(x=>({key:x.key,width:Math.min(80,Math.max(4,Number(x.width)||dict.get(x.key)[2]))}));
 if(!cols.length)cols=ef18Default[kind].map(key=>({key,width:dict.get(key)[2]}));
 return {columns:cols,orientation:saved?.orientation==='portrait'?'portrait':'landscape',fontSize:saved?.fontSize||8};
}
function ef18EditReport(kind){
 if(!current())return toast('Select an event first.');
 const data=ef18Layout(kind),defs=ef18Defs[kind],names=new Map(defs.map(d=>[d[0],d[1]]));
 let all=defs.map(d=>({key:d[0],width:data.columns.find(x=>x.key===d[0])?.width||d[2]}));
 let chosen=data.columns.map(x=>x.key);
 modal((kind==='programs'?'Program List':'Award Winners')+' · PDF Layout',
  '<p class="muted">Select columns, arrange the column order, and increase or decrease widths. Preview the actual PDF before downloading.</p>'+
  '<div class="ef18-report-settings"><label>Page layout<select id="ef18Orientation"><option value="landscape">A4 Landscape</option><option value="portrait">A4 Portrait</option></select></label>'+
  '<label>Text size<select id="ef18FontSize">'+[6,7,8,9,10,11].map(n=>'<option value="'+n+'">'+n+' pt</option>').join('')+'</select></label></div>'+
  '<div class="ef18-column-list" id="ef18Columns"></div>'+
  '<div class="form-actions"><button class="secondary" id="ef18Reset" type="button">Reset</button>'+
  '<button class="secondary" id="ef18Preview" type="button">View PDF</button>'+
  '<button class="primary" id="ef18Download" type="button">Download PDF</button></div>',
  ()=>{
   $('#ef18Orientation').value=data.orientation;$('#ef18FontSize').value=String(data.fontSize);
   const paint=()=>{
    const ordered=[...chosen,...all.map(x=>x.key).filter(key=>!chosen.includes(key))];
    $('#ef18Columns').innerHTML=ordered.map((key,index)=>{
     const col=all.find(x=>x.key===key),enabled=chosen.includes(key);
     return '<div class="ef18-column"><label><input type="checkbox" data-ef18-check="'+esc(key)+'" '+(enabled?'checked':'')+'>'+
      '<span>'+esc(names.get(key))+'</span></label>'+
      '<label class="ef18-width">Width <input type="number" min="4" max="80" step="1" value="'+col.width+'" data-ef18-width="'+esc(key)+'"></label>'+
      '<button type="button" class="secondary" data-ef18-up="'+esc(key)+'" title="Move column left">↑</button>'+
      '<button type="button" class="secondary" data-ef18-down="'+esc(key)+'" title="Move column right">↓</button></div>';
    }).join('');
    $$('[data-ef18-check]').forEach(el=>el.onchange=()=>{
     if(el.checked&&!chosen.includes(el.dataset.ef18Check))chosen.push(el.dataset.ef18Check);
     if(!el.checked)chosen=chosen.filter(k=>k!==el.dataset.ef18Check);
     paint();
    });
    $$('[data-ef18-width]').forEach(el=>el.onchange=()=>{
     const n=Number(el.value),col=all.find(x=>x.key===el.dataset.ef18Width);
     if(col&&Number.isFinite(n))col.width=Math.min(80,Math.max(4,n));
    });
    const move=(key,delta)=>{const n=chosen.indexOf(key),next=n+delta;if(n<0||next<0||next>=chosen.length)return;
     [chosen[n],chosen[next]]=[chosen[next],chosen[n]];paint()};
    $$('[data-ef18-up]').forEach(el=>el.onclick=()=>move(el.dataset.ef18Up,-1));
    $$('[data-ef18-down]').forEach(el=>el.onclick=()=>move(el.dataset.ef18Down,1));
   };
   paint();
   $('#ef18Reset').onclick=()=>{const layout=ef18Default[kind];chosen=[...layout];all=defs.map(x=>({key:x[0],width:x[2]}));paint()};
   const generate=async(download)=>{
    if(!chosen.length)throw Error('Select at least one column.');
    const cfg={orientation:$('#ef18Orientation').value,fontSize:Number($('#ef18FontSize').value),
     columns:chosen.map(key=>({key,width:all.find(x=>x.key===key).width}))};
    const c=current();
    const previewTab=download?null:window.open('','_blank');
    try{localStorage.setItem('eventflow-pdf-layout-'+kind,JSON.stringify(cfg))}catch{}
    const res=await fetch('/api/events/'+c.event.id+'/reports/'+kind+'.pdf',{method:'POST',
      credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});
    if(!res.ok){let msg=await res.text();try{msg=JSON.parse(msg).error||msg}catch{}throw Error(msg)}
    const blob=await res.blob(),url=URL.createObjectURL(blob);
    if(download){
      const a=document.createElement('a');a.href=url;a.download=(c.event.title.replace(/[^a-zA-Z0-9_-]/g,'_')+'_'+kind+'.pdf');
      document.body.append(a);a.click();a.remove();
    }else if(previewTab)previewTab.location.href=url;
    else toast('The browser blocked the preview tab. Use Download PDF instead.');
    setTimeout(()=>URL.revokeObjectURL(url),30000);
   };
   $('#ef18Preview').onclick=()=>act(()=>generate(false));
   $('#ef18Download').onclick=()=>act(()=>generate(true));
  },'REPORT COLUMN DESIGNER');
}
function ef18Import(kind){
 const c=current();
 if(!c)return toast('Select an event first.');
 if(!state.editing)return toast('Acquire edit control for this event before importing.');
 const id=c.event.id,revision=c.event.revision;
 let file=null,valid=false;
 modal('Import '+(kind==='programs'?'Programs & Participants':'Awards')+' from Excel',
  '<p class="muted">Append new '+kind+' to <strong>'+esc(c.event.title)+'</strong>. Existing rows remain unchanged, and permanent IDs are generated automatically.</p>'+
  '<div class="ef18-import-buttons"><a id="ef18Template" class="secondary" href="/api/events/'+id+'/import/'+kind+'/template">Download '+(kind==='programs'?'Programs + Participants':'Awards')+' Excel template</a></div>'+
  '<label>Choose completed XLSX file<input id="ef18File" type="file" accept=".xlsx"></label>'+
  '<div id="ef18Validation" class="muted tiny">No file previewed.</div>'+
  '<div class="form-actions"><button class="secondary" id="ef18Check">Preview & Validate</button>'+
  '<button class="primary" id="ef18Commit" disabled>Append to this Event</button></div>',
  ()=>{
   $('#ef18File').onchange=ev=>{file=ev.target.files?.[0]||null;valid=false;
    $('#ef18Commit').disabled=true;$('#ef18Validation').textContent=file?file.name:'No file selected'};
   const request=async(verb)=>{
    if(!file)throw Error('Select a workbook first.');
    if(file.size>8*1024*1024)throw Error('Workbook must be under 8 MB.');
    const url='/api/events/'+id+'/import/'+kind+'/'+verb+'?revision='+revision;
    const result=await fetch(url,{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/octet-stream'},body:file});
    const body=await result.json();if(!result.ok)throw Error(body.error||'Import error');
    return body;
   };
   $('#ef18Check').onclick=()=>act(async()=>{
    const data=await request('preview');valid=!!data.valid;
    const count=kind==='programs'?data.counts.programs+' programs / '+data.counts.participants+' participants':data.counts.awards+' awards';
    $('#ef18Validation').innerHTML='<strong>'+esc(count)+'</strong> · '+(valid?'Validation passed':'Validation failed')+
      (data.errors.length?'<div class="ef18-validation-errors">'+data.errors.map(e=>'<p>'+esc(e)+'</p>').join('')+'</div>':'');
    $('#ef18Commit').disabled=!valid;
   });
   $('#ef18Commit').onclick=()=>act(async()=>{
    if(!valid||!confirm('Append these '+kind+' to the selected event?'))return;
    state.current=await request('apply');closeModal();render();toast('Imported '+kind+' successfully');
   });
  },'EXISTING EVENT IMPORT');
}
const ef18Reports=renderReports;
renderReports=function(){
 ef18Reports();
 const host=$('#pageReports');if(!host||!current())return;
 const button=$('#printReport');if(button){
  const clean=button.cloneNode(true);button.replaceWith(clean);
  clean.textContent='Configure & Download Program PDF';clean.onclick=()=>ef18EditReport('programs');
 }
 const extra=document.createElement('button');extra.className='secondary';extra.type='button';
 extra.textContent='Configure & Download Award PDF';extra.onclick=()=>ef18EditReport('awards');
 host.querySelector('.head-actions')?.append(extra);
};
const ef18Awards=renderAwards;
renderAwards=function(){
 ef18Awards();
 const button=$('#efAwardPrint');if(button){button.textContent='Configure Award PDF';button.onclick=()=>ef18EditReport('awards')}
 if(state.editing){
  const btn=document.createElement('button');btn.className='secondary';btn.textContent='Import Awards XLSX';
  btn.onclick=()=>ef18Import('awards');$('#pageAwards .head-actions')?.append(btn);
 }
};
const ef18Planner=renderPlanner;
renderPlanner=function(){
 ef18Planner();
 if(state.editing){
  const btn=document.createElement('button');btn.className='secondary';btn.textContent='Import Programs XLSX';
  btn.onclick=()=>ef18Import('programs');$('#pagePlanner .head-actions')?.append(btn);
 }
};
