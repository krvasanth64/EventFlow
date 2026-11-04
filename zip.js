'use strict';
// Small, dependency-free ZIP32 streaming writer. Stored entries keep media bytes unchanged.
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');
const TABLE=Array.from({length:256},(_,i)=>{let c=i;for(let n=0;n<8;n++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c>>>0});
function updateCRC(crc,buffer){for(const byte of buffer)crc=TABLE[(crc^byte)&255]^(crc>>>8);return crc>>>0}
function u16(b,o,n){b.writeUInt16LE(n,o)}
function u32(b,o,n){b.writeUInt32LE(n>>>0,o)}
function dosDate(){const d=new Date(),year=Math.max(1980,d.getFullYear());return {date:((year-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate(),time:(d.getHours()<<11)|(d.getMinutes()<<5)|(Math.floor(d.getSeconds()/2))}}
function validName(name){
 if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..')||/[\x00-\x1f]/.test(name))throw Error('Unsafe archive path');
 return name;
}
async function fileCRC(file){
 let crc=0xFFFFFFFF;
 for await(const part of fs.createReadStream(file))crc=updateCRC(crc,part);
 return (crc^0xFFFFFFFF)>>>0;
}
function mediaFiles(root){
 const found=[];
 if(!fs.existsSync(root))return found;
 const walk=(dir,prefix)=>{
  for(const item of fs.readdirSync(dir,{withFileTypes:true})){
   if(item.isSymbolicLink())throw Error('Symlink in archive source is not allowed.');
   const rel=prefix?prefix+'/'+item.name:item.name;
   if(item.isDirectory())walk(path.join(dir,item.name),rel);
   else if(item.isFile())found.push({name:rel,file:path.join(dir,item.name)});
  }
 };
 walk(root,'');return found;
}
async function streamZip(res,entries,filename){
 if(!Array.isArray(entries)||entries.length>65535)throw Error('Too many ZIP entries');
 const names=new Set(),parts=[];let offset=0,totalSize=0;
 for(const raw of entries){
  const name=validName(raw.name);
  if(names.has(name))throw Error('Duplicate archive entry: '+name);
  names.add(name);
  const nameBuf=Buffer.from(name,'utf8');
  if(nameBuf.length>65535)throw Error('Archive name too long');
  const file=raw.file;
  if(file){const st=fs.lstatSync(file);if(!st.isFile())throw Error('Archive file unavailable: '+name);}
  const size=file?fs.statSync(file).size:Buffer.byteLength(raw.content||'');
  if(!Number.isSafeInteger(size)||size>0xFFFFFFFF)throw Error('ZIP32 file size limit exceeded');
  totalSize+=size+nameBuf.length+110;
  if(totalSize>0xFFFFFFFF)throw Error('ZIP32 archive limit exceeded');
  parts.push({name,nameBuf,file,content:file?null:Buffer.from(raw.content||''),size});
 }
 async function write(chunk){if(!res.write(chunk))await once(res,'drain');offset+=chunk.length}
 const now=dosDate(),central=[];
 res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="'+filename.replace(/[^a-zA-Z0-9._-]/g,'_')+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 try{
  for(const part of parts){
   const crc=part.file?await fileCRC(part.file):(updateCRC(0xFFFFFFFF,part.content)^0xFFFFFFFF)>>>0;
   const start=offset;
   const local=Buffer.alloc(30);
   u32(local,0,0x04034b50);u16(local,4,20);u16(local,6,0x0800);u16(local,8,0);
   u16(local,10,now.time);u16(local,12,now.date);u32(local,14,crc);u32(local,18,part.size);u32(local,22,part.size);u16(local,26,part.nameBuf.length);
   await write(local);await write(part.nameBuf);
   if(part.file){for await(const chunk of fs.createReadStream(part.file))await write(chunk)}
   else await write(part.content);
   const c=Buffer.alloc(46);u32(c,0,0x02014b50);u16(c,4,20);u16(c,6,20);u16(c,8,0x0800);u16(c,10,0);
   u16(c,12,now.time);u16(c,14,now.date);u32(c,16,crc);u32(c,20,part.size);u32(c,24,part.size);u16(c,28,part.nameBuf.length);u32(c,42,start);
   central.push({header:c,name:part.nameBuf});
  }
  const centralStart=offset;
  for(const item of central){await write(item.header);await write(item.name)}
  const end=Buffer.alloc(22);u32(end,0,0x06054b50);u16(end,8,central.length);u16(end,10,central.length);
  u32(end,12,offset-centralStart);u32(end,16,centralStart);
  res.end(end);
 }catch(e){res.destroy(e)}
}
module.exports={streamZip,mediaFiles};
