'use strict';
// Native Excel workbook templates, strict preview and import parser.
// Never evaluates formulas or retrieves remote URLs.
const ExcelJS=require('exceljs');
const HEADERS={
 Event:['Title','Date (YYYY-MM-DD)','Start (HH:MM)','Venue','Organizer','Description'],
 Programs:['Program Ref','Title','Program Type','Category','Duration Minutes','Gap Minutes','Presenter','Source Type','Source URL or Path','Instructions'],
 Participants:['Program Ref','Employee Code','Participant Name','Contact'],
 Awards:['Category','Award Title','Winner Name','Presented By','Employee Code','Contact','Notes']
};
const clean=v=>{
 if(v===null||v===undefined)return '';
 if(v instanceof Date)return v.toISOString().slice(0,10);
 if(typeof v==='object'){
  if(v.formula||v.sharedFormula)throw Error('Excel formulas are not accepted; paste values only.');
  if(v.hyperlink)return String(v.text||v.hyperlink).trim();
  if(Array.isArray(v.richText))return v.richText.map(x=>x.text).join('').trim();
  if(v.result!==undefined)return String(v.result).trim();
 }
 return String(v).trim();
};
function makeSheet(book,name,data){
 const ws=book.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});
 ws.addRow(HEADERS[name]);
 for(const row of data)ws.addRow(row);
 ws.getRow(1).height=29;
 ws.getRow(1).eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'},size:11};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF243655'}};cell.alignment={vertical:'middle',wrapText:true}});
 ws.columns=HEADERS[name].map(h=>({width:Math.max(18,Math.min(h.length+5,32))}));
 for(let i=2;i<=ws.rowCount;i++){ws.getRow(i).height=24;ws.getRow(i).eachCell(c=>{c.font={color:{argb:'FF1855A2'}};c.alignment={vertical:'middle'};if(i%2===0)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F6FC'}}})}
 ws.autoFilter={from:{row:1,column:1},to:{row:1,column:HEADERS[name].length}};
}
function exampleData(full=false){
 const programs=[
 ['REF-01','Opening Welcome','Welcome Address','Ceremony',4,0.5,'Event Host','none','','Welcome the audience'],
 ['REF-02','Classical Group Dance','Group Dance','Dance',6,1,'Stage Team','file','','Upload the sample media separately'],
 ['REF-03','Karaoke Performance','Karaoke Singing','Music',5,0.5,'Music Team','url','https://example.com/replace-with-your-media','Replace this placeholder URL'],
 ['REF-04','Guest Address','Speech','Speech',8,1,'Chief Guest','none','','Microphone check'],
 ['REF-05','Magic Performance','Magic Show','Entertainment',8,1,'Stage Team','none','','Prepare stage equipment'],
 ['REF-06','Solo Singing','Solo Singing','Music',4,1,'Music Team','none','','Check stage microphone'],
 ['REF-07','Comedy Program','Stand-up Comedy','Entertainment',5,1,'Event Host','none','',''],
 ['REF-08','Grand Finale','Group Dance','Dance',7,0,'Production Team','none','','']
 ];
 const participants=programs.flatMap((p,i)=>Array.from({length:(i%3)+2},(_,j)=>[p[0],'DEMO-'+String(i*4+j+1).padStart(4,'0'),'Sample Participant '+(i+1)+'-'+(j+1),'']));
 const awards=[
 ['Excellence','Best Performer','Demo Winner One','Chief Guest','EMP001','',''],
 ['Team','Best Group','Demo Team','Managing Director','','',''],
 ['Service','Long Service','Demo Winner Two','HR Head','EMP002','',''],
 ['Special Recognition','Outstanding Achievement','Demo Winner Three','Event Host','','','']
 ];
 return {Event:[['EventFlow Excel Import Sample','2026-11-22','18:00','Demo Auditorium','Event Team','Replace sample data before real import']],Programs:full?programs:programs.slice(0,3),Participants:full?participants:participants.filter(x=>['REF-01','REF-02','REF-03'].includes(x[0])),Awards:full?awards:awards.slice(0,2)};
}
async function createTemplate(full=false){
 const wb=new ExcelJS.Workbook();
 wb.creator='EventFlow';wb.title='EventFlow Event Import';
 const data=exampleData(full);
 for(const key of Object.keys(HEADERS))makeSheet(wb,key,data[key]);
 const guide=wb.addWorksheet('Instructions');
 [['EVENTFLOW EXCEL IMPORT',''],['1','Fill Event sheet row 2 with title, date, time, location.'],['2','Programs: Program Ref is unique within the sheet and links Participants; it is NOT the permanent P#### code.'],['3','Source Type: none, url, linked, or file. File media must be uploaded after import.'],['4','Only http(s) URLs are accepted for url type. Example links are placeholders.'],['5','Participant Name is required; employee code and contact are optional.'],['6','Import creates a NEW event; it never overwrites a current event.'],['7','Preview first, then confirm. Save a full backup before importing important data.'],['8','Do not add formulas to imported cells.'],['9','Maximum: 200 programs, 1000 participants and 200 awards.']].forEach(r=>guide.addRow(r));
 guide.getColumn(1).width=28;guide.getColumn(2).width=110;
 guide.getRow(1).font={bold:true,size:15};
 return Buffer.from(await wb.xlsx.writeBuffer());
}
function errorsFromWorkbook(wb){
 const errors=[],rows={};
 for(const [name,headers] of Object.entries(HEADERS)){
  const sheet=wb.getWorksheet(name);if(!sheet){errors.push('Missing sheet '+name);rows[name]=[];continue}
  const actual=headers.map((_,i)=>clean(sheet.getRow(1).getCell(i+1).value));
  if(actual.some((v,i)=>v!==headers[i]))errors.push('Invalid headers on '+name+' sheet');
  const data=[];
  sheet.eachRow((row,n)=>{
   if(n===1)return;
   try{
    const values=headers.map((_,i)=>clean(row.getCell(i+1).value));
    if(values.every(v=>!v))return;
    data.push({number:n,values});
   }catch(e){errors.push(name+' row '+n+': '+e.message)}
  });
  rows[name]=data;
 }
 return {rows,errors};
}
async function parseWorkbook(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length>8*1024*1024)throw Error('Excel file must be under 8 MB.');
 const wb=new ExcelJS.Workbook();
 try{await wb.xlsx.load(buffer)}catch{throw Error('Invalid XLSX file. Download and complete the EventFlow template.')}
 const {rows,errors}=errorsFromWorkbook(wb);
 const allowedTypes=new Set(['none','url','linked','file']);
 if(rows.Event.length!==1)errors.push('Event sheet must contain exactly one data row.');
 const ev=rows.Event[0]?.values||[];
 const event={title:ev[0]||'',date:ev[1]||'',start:ev[2]||'',venue:ev[3]||'',organizer:ev[4]||'',description:ev[5]||''};
 if(!event.title||event.title.length>120)errors.push('Event title is required (maximum 120 characters).');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(event.date)||Number.isNaN(Date.parse(event.date)))errors.push('Event date must be YYYY-MM-DD.');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(event.start))errors.push('Start time must be HH:MM (24-hour).');
 const programs=[],refs=new Set(),byRef=new Map();
 if(rows.Programs.length>200)errors.push('Maximum 200 programs per import.');
 for(const row of rows.Programs.slice(0,200)){
  const [ref,title,type,category,dur,gap,presenter,sourceType,source,notes]=row.values;
  const prefix='Programs row '+row.number+': ';
  if(!ref||refs.has(ref.toLowerCase()))errors.push(prefix+'Program Ref must be unique and nonempty.');
  refs.add(ref.toLowerCase());
  const duration=Number(dur),transition=Number(gap||0);
  if(!title||title.length>150||!type||type.length>90)errors.push(prefix+'Title and type are required.');
  if(!Number.isFinite(duration)||duration<0||duration>1440||!Number.isFinite(transition)||transition<0||transition>1440)errors.push(prefix+'Invalid minutes.');
  const kind=sourceType.toLowerCase()||'none';
  if(!allowedTypes.has(kind))errors.push(prefix+'Source Type must be none/url/linked/file.');
  if(kind==='url'&&!/^https?:\/\//i.test(source))errors.push(prefix+'URL must begin with http:// or https://.');
  if(kind==='file'&&source)errors.push(prefix+'File source must be uploaded after import, not read from a local path.');
  const p={ref,title,type,category:category||'General',duration:Math.round(duration*60),gap:Math.round(transition*60),presenter,sourceType:kind==='file'?'none':kind,source:kind==='url'||kind==='linked'?source:'',notes,participants:[]};
  programs.push(p);byRef.set(ref.toLowerCase(),p);
 }
 const titles=new Set();for(const p of programs){if(titles.has(p.title.toLowerCase()))errors.push('Duplicate program title: '+p.title);titles.add(p.title.toLowerCase())}
 if(!programs.length)errors.push('At least one program is required.');
 if(rows.Participants.length>1000)errors.push('Maximum 1000 participants per import.');
 for(const row of rows.Participants.slice(0,1000)){
  const [ref,employeeCode,name,contact]=row.values,p=byRef.get(ref.toLowerCase());
  if(!p){errors.push('Participants row '+row.number+': unknown Program Ref '+ref);continue}
  if(!name)errors.push('Participants row '+row.number+': Name is required.');
  if(employeeCode&&p.participants.some(x=>x.employeeCode.toLowerCase()===employeeCode.toLowerCase()))errors.push('Participants row '+row.number+': duplicate employee code.');
  p.participants.push({employeeCode,name,contact});
  if(p.participants.length>250)errors.push('Program '+p.title+' exceeds 250 participants.');
 }
 if(rows.Awards.length>200)errors.push('Maximum 200 awards per import.');
 const awards=rows.Awards.slice(0,200).map(row=>{
  const [category,awardName,winnerName,presenter,employeeId,contact,notes]=row.values;
  if(!category||!awardName||!winnerName)errors.push('Awards row '+row.number+': Category, Award Title and Winner required.');
  return {category,awardName,winnerName,presenter,employeeId,contact,notes};
 });
 return {event,programs,awards,errors:errors.slice(0,100),counts:{programs:programs.length,participants:programs.reduce((x,p)=>x+p.participants.length,0),awards:awards.length},valid:errors.length===0};
}
module.exports={createTemplate,parseWorkbook,HEADERS};
