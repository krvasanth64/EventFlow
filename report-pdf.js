'use strict';
// Server-generated A4 PDF with configurable/reorderable columns and relative widths.
const PDFDocument=require('pdfkit');
const COLUMNS={
 programs:[
  ['programCode','Program ID',8],['order','Order',5],['title','Program',22],['type','Type',12],
  ['category','Category',12],['presenter','Presenter',14],['duration','Duration',8],
  ['gap','Gap',7],['status','Status',9],['sourceType','Media Type',10],['source','Source URL / File',22],
  ['participants','Participants',8],['ready','Ready',6],['notes','Instructions',18]
 ],
 awards:[
  ['awardCode','Award ID',8],['order','Order',5],['awardName','Award Title',25],
  ['category','Category',15],['winnerName','Winner',18],['presenter','Presented By',16],
  ['status','Status',9],['recipientDetails','Winner Details',20],['employeeId','Employee Code',12],
  ['contact','Contact',12],['notes','Notes',19]
 ]
};
const DEFAULT={
 programs:['order','programCode','title','type','duration','presenter','status'],
 awards:['order','awardCode','category','awardName','winnerName','presenter','status']
};
function normalizeConfig(kind,input={}){
 const cols=COLUMNS[kind];if(!cols)throw Error('Invalid report type.');
 const choices=Array.isArray(input.columns)?input.columns:DEFAULT[kind].map(key=>({key}));
 if(!choices.length||choices.length>cols.length)throw Error('Choose at least one report column.');
 const seen=new Set();
 const columns=choices.map(c=>{
  const key=typeof c==='string'?c:c?.key,definition=cols.find(x=>x[0]===key);
  if(!definition||seen.has(key))throw Error('Unknown or duplicate report column.');
  seen.add(key);
  const width=Number(c?.width??definition[2]);
  if(!Number.isFinite(width)||width<4||width>80)throw Error('Column width must be between 4 and 80.');
  return {key,title:definition[1],width};
 });
 return {columns,orientation:input.orientation==='portrait'?'portrait':'landscape',
  fontSize:Math.max(6,Math.min(11,Number(input.fontSize)||8))};
}
function rowsFor(kind,record){
 const data=kind==='programs'?record.programs:record.awards;
 return data.map((x,index)=>({
  ...x,order:index+1,
  participants:(x.participants||[]).length,
  ready:(x.participants||[]).filter(p=>p.checkedIn).length,
  duration:kind==='programs'?Math.round(Number(x.duration||0)/60*10)/10:'',
  gap:kind==='programs'?Math.round(Number(x.gap||0)/60*10)/10:'',
  source:x.sourceType==='none'?'':x.source||''
 }));
}
function buildPdf(kind,record,configInput={}){
 const cfg=normalizeConfig(kind,configInput),doc=new PDFDocument({
  size:'A4',layout:cfg.orientation,margin:32,bufferPages:true,
  info:{Title:record.event.title+' - '+(kind==='programs'?'Program List':'Award List'),
    Author:'EventFlow'}
 });
 const chunks=[];doc.on('data',c=>chunks.push(c));
 const pageWidth=doc.page.width,space=pageWidth-64;
 const total=cfg.columns.reduce((n,c)=>n+c.width,0);
 const widths=cfg.columns.map(c=>space*c.width/total);
 const title=kind==='programs'?'Program Running Order':'Award Winners';
 const header=()=>{
  doc.fillColor('#243657').font('Helvetica-Bold').fontSize(16)
   .text(String(record.event.title||'Event').slice(0,140),32,30,{width:space});
  doc.font('Helvetica').fontSize(9).fillColor('#4b5a72')
   .text(title+'  |  '+String(record.event.date||'')+'  |  '+String(record.event.venue||''),32,54,{width:space});
  const y=77,headerHeight=32;doc.rect(32,y,space,headerHeight).fill('#243657');
  let x=32;cfg.columns.forEach((c,i)=>{
   doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(Math.max(6,cfg.fontSize-.3))
    .text(c.title,x+4,y+7,{width:Math.max(2,widths[i]-8),height:headerHeight-10,ellipsis:true});
   x+=widths[i];
  });
  return y+headerHeight;
 };
 let y=header(),index=0;const rows=rowsFor(kind,record);
 for(const row of rows){
  const values=cfg.columns.map(c=>String(row[c.key]??'').replace(/[\r\n]+/g,' ').slice(0,1800));
  doc.font('Helvetica').fontSize(cfg.fontSize);
  const heights=values.map((value,i)=>doc.heightOfString(value,{width:Math.max(5,widths[i]-10),lineGap:1}));
  const h=Math.max(23,Math.min(180,Math.max(...heights)+12));
  if(y+h>doc.page.height-44){doc.addPage();y=header();}
  if(index%2===0)doc.rect(32,y,space,h).fill('#f3f6fc');
  let x=32;cfg.columns.forEach((c,i)=>{
   doc.fillColor('#223049').font('Helvetica').fontSize(cfg.fontSize).text(values[i],x+5,y+6,{
    width:Math.max(5,widths[i]-10),height:h-10,ellipsis:true,lineGap:1
   });
   x+=widths[i];
  });
  doc.moveTo(32,y+h).lineTo(32+space,y+h).lineWidth(.3).strokeColor('#dbe3ef').stroke();
  y+=h;index++;
 }
 doc.font('Helvetica').fontSize(9).fillColor('#66768d').text('Total '+title.toLowerCase()+': '+rows.length,32,Math.min(y+14,doc.page.height-35));
 const pages=doc.bufferedPageRange().count;
 for(let i=0;i<pages;i++){
  doc.switchToPage(i);
  doc.font('Helvetica').fontSize(8).fillColor('#71809a')
   .text('EventFlow  |  Page '+(i+1)+' / '+pages,32,doc.page.height-24,{width:space,align:'right'});
 }
 return new Promise((resolve,reject)=>{doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.end()});
}
module.exports={buildPdf,normalizeConfig,COLUMNS,DEFAULT};
